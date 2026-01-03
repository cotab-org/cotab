import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { logDebug, logError } from '../utils/logger';
import { convertURLToIP } from './llmUtils';
import { serverManager } from '../managers/serverManager';

export interface CompletionParams {
	systemPrompt?: string;
	userPrompt: string;
	assistantPrompt?: string;
	abortSignal?: vscode.CancellationToken;
	checkAborted?: () => boolean;
	maxLines?: number; // Maximum line limit (default: 15)
	maxTokens?: number; // Maximum token limit (default: 256)
	stops?: string[]; // Stop tokens
	onUpdate?: (partial: string) => boolean; // Callback to receive partial output sequentially
	onComplete?: (reason: CompletionEndReason, finalResult?: string) => void; // Callback that returns completion reason
	streamCount?: number; // Streaming count

	model?: string;
	temperature?: number;
	top_p?: number; // eslint-disable-line @typescript-eslint/naming-convention
	top_k?: number; // eslint-disable-line @typescript-eslint/naming-convention
}

export interface AiClient {
	chatCompletions(params: CompletionParams): Promise<string>;
	getModels(): Promise<string[]>;
	isActive(): Promise<boolean>;
}

// Type definition for completion reason
export type CompletionEndReason = 'maxLines' | 'streamEnd' | 'aborted' | 'exceedContextSize' | 'error';

export function registerLlmProvider(disposables: vscode.Disposable[]) {
    // Clear context checkpoints when text document changes
    disposables.push(vscode.workspace.onDidChangeTextDocument((_evt: vscode.TextDocumentChangeEvent) => {
        clearContextCheckpoints();
    }));
}

/**
 * Clear context checkpoints
 */
export function clearContextCheckpoints(): void {
	contextCheckpoints.messages = [];
}

function toAbortSignal(token?: vscode.CancellationToken): { signal?: AbortSignal; dispose: () => void } {
	if (!token) return { signal: undefined, dispose: () => {} };
	const controller = new AbortController();
	const disposable = token.onCancellationRequested(() => controller.abort());
	return {
		signal: controller.signal,
		dispose: () => disposable.dispose(),
	};
}

// Function to process streaming response and stop at specified line count
async function processStreamingResponse(
	response: any, // eslint-disable-line @typescript-eslint/no-explicit-any
	signal: AbortSignal | undefined, 
	params: CompletionParams
): Promise<string> {
	// Axios streaming response is a Node.js stream object
	const stream = response.data;
	let buffer = '';
	let lineCount = 0;
	let result = '';
	const startTime = Date.now();
	let firstDataReceived = false;

	return new Promise((resolve, reject) => {
		let onCompleteCalled = false; // Flag indicating whether onComplete was called
		
		const callOnComplete = (reason: CompletionEndReason) => {
			if (!onCompleteCalled) {
				onCompleteCalled = true;
				params.onComplete?.(reason, result);
			}
		};

		const processLines = (lines: string[]) => {
			const processError = (parsed: any): boolean => {// eslint-disable-line @typescript-eslint/no-explicit-any
				// exceed context size (Llama.cpp specialization)
				if (parsed.error) {
					const code = parsed.error.code ?? 0;
					const type = (parsed.error?.type?? '');
					if (code === 400 && type === 'exceed_context_size_error') {
						const n_ctx = parsed.error?.n_ctx; // eslint-disable-line @typescript-eslint/naming-convention
						const n_prompt_tokens = parsed.error?.n_prompt_tokens; // eslint-disable-line @typescript-eslint/naming-convention
						if (0 < n_ctx && 0 < n_prompt_tokens) {
							result = JSON.stringify({
								contextSize: n_ctx,
								promptSize: n_prompt_tokens,
							});
							callOnComplete('exceedContextSize');
						}
					}
					return true;
				}
				else {
					return false;
				}
			}

			for (const line of lines) {
				if (line.trim() === '') continue;
				
				// exceed context size (Llama.cpp specialization)
				if (line.startsWith('{"error":')) {
					const parsed = JSON.parse(line);
					processError(parsed);
				}
				else if (line.startsWith('data: ')) {
					const data = line.slice(6);
					if (data === '[DONE]') {
						callOnComplete('streamEnd');
						resolve(result);
						stream.destroy();
						return;
					}
					try {
						const parsed = JSON.parse(data);
						const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.text || '';
						if (content) {
							result += content;
							let isAbort = false;
							if (params.onUpdate) {
								if (!params.onUpdate(result))
								{
									isAbort = true;
								}
							}
							
							// Count lines by newline characters
							const newLines = content.split('\n').length - 1;
							lineCount += newLines;
							
							// Exit when specified line count is reached
							if (isAbort || (params.maxLines && params.maxLines <= lineCount)) {
								callOnComplete('maxLines');
								resolve(result);
								stream.destroy();
								return;
							}
						}
						// exceed context size (Llama.cpp specialization)
						else if (processError(parsed)) {
							continue;
						}
					} catch (_e) {
						// Ignore JSON parse errors
					}
				}
			}
		};

		stream.on('data', async (chunk: Buffer) => {
			serverManager.keepalive(); // Start heartbeat to keep server alive

			if (!firstDataReceived) {
				const timeToFirstData = Date.now() - startTime;
				logDebug(`Time to first data reception: ${params.streamCount}th time ${timeToFirstData}ms`);
				firstDataReceived = true;
			}

			if (signal?.aborted ||
				(params.checkAborted && params.checkAborted())) {
				callOnComplete('aborted');
				resolve(result);
				stream.destroy();
				return;
			}

			buffer += chunk.toString();
			const lines = buffer.split('\n');
			buffer = lines.pop() || ''; // Keep last incomplete line in buffer

			processLines(lines);
		});

		stream.on('end', () => {
			// Process remaining buffer
			const lines = buffer.split('\n');
			processLines(lines);

			// 
			callOnComplete('streamEnd');
			resolve(result);
		});

		stream.on('error', (error: unknown) => {
			callOnComplete('error');
			reject(error);
		});

		// Exit immediately if already cancelled
		if (params.checkAborted && params.checkAborted()) {
			callOnComplete('aborted');
			resolve(result);
			stream.destroy();
			return;
		}
		// Monitor cancel signal
		else if (signal) {
			signal.addEventListener('abort', async () => {
				callOnComplete('aborted');
				resolve(result);
				stream.destroy();
				return;
			});
		}
	});
}

// llama.cppの現在の実装で、LFM2などのサイクル型コンテキストキャッシュを使うモデルは、
// コンテキストキャッシュがリクエスト単位で作られるため、
// 一度区切りでChatCompletionを呼び出して、llama.cpp内部のコンテキストキャッシュのチェックポイントを作成させる必要がある。
class ContextCheckpoints {
	public messages: any[] = [];

	async createCheckpoints(
		http: AxiosInstance,
		endpoint: string,
		orgArgs: any,
		orgParams: CompletionParams,
		signal: AbortSignal | undefined) {
			
		try {
			// Clone params
			const newParams = { ...orgParams };
			newParams.onUpdate = (partial) => {
				logDebug(`Context checkpoint update received: ${partial}`);
				return true;
			};
			newParams.onComplete = (reason, finalResult) => {
				logDebug(`Completion reason: ${reason}, result: ${finalResult}`);
			};
			
			// Loop from the end of orgArgs.messages, discard all entries that do not contain '<|CONTEXT_CHECKPOINT|>'.
			// Once an entry containing '<|CONTEXT_CHECKPOINT|>' is found, keep all entries before it.
			let lastNum = orgArgs.messages.length - 1;
			for (const orgMessage of [...orgArgs.messages].reverse()) {
				if (orgMessage.content.includes('<|CONTEXT_CHECKPOINT|>')) {
					break;
				}
				lastNum--;
			}
			let checkMessages = [];
			for (let i = 0; i <= lastNum; i++) {
				checkMessages.push({ ...orgArgs.messages[i] });
			}

			// Clone args
			const newArgs = { ...orgArgs };
			newArgs.max_tokens = 1;
			newArgs.messages = [];

			let orgMessageIdx = -1;
			for (const orgMessage of checkMessages) {
				orgMessageIdx++;
				const newMessage = { ...orgMessage };
				newMessage.content = "";
				newArgs.messages.push(newMessage);

				let orgContentpartIdx = -1;
				const orgContentParts = orgMessage.content.split('<|CONTEXT_CHECKPOINT|>');
				for (const orgContentpart of orgContentParts) {
					orgContentpartIdx++;
					// Do not cache the last context
					if (orgMessageIdx == checkMessages.length - 1 &&
						orgContentpartIdx == orgContentParts.length - 1) {
						return;
					}
					
					newMessage.content += orgContentpart;
					
					// Check cachecheckpoint
					let isCached = true;
					const len = Math.min(this.messages.length, newArgs.messages.length);
					if (this.messages.length < newArgs.messages.length) {
						isCached = false;
					}
					else {
						for (let i = 0; i < len; i++) {
							if (this.messages[i].content !== newArgs.messages[i].content) {
								isCached = false;
								break;
							}
						}
					}
					
					if (! isCached)
					{
						const res = await http.post(endpoint, newArgs, { 
							// If cancel signal is sent too early and communication ends, llama-server may miss task cancellation,
							// so don't pass signal directly
							signal, // fix b7037
							responseType: 'stream',
							validateStatus: () => true,	// no exception for status code 400
						});
						logDebug(`Chat response reception started ${orgParams.streamCount}th time`);
						await processStreamingResponse(res, signal, newParams);

						// Update cache
						this.messages = newArgs.messages;
					}
				}
			}
		} catch (error) {
			logError(`Error in createCheckpoints: ${error}`);
		}
	}
}

const contextCheckpoints: ContextCheckpoints = new ContextCheckpoints();

// Base class - provides common functionality
abstract class BaseAiClient implements AiClient {
	protected readonly model: string;
	protected readonly maxTokens: number;
	protected readonly temperature: number;
	protected readonly top_p: number; // eslint-disable-line @typescript-eslint/naming-convention
	protected readonly top_k: number; // eslint-disable-line @typescript-eslint/naming-convention
	protected readonly timeoutMs: number;
	protected readonly originalBaseURL: string;
	protected resolvedBaseURL: string | null = null;
	protected readonly stopEditingHereSymbol: string;
	protected readonly apiKey?: string;

	constructor(baseURL: string, model: string, maxTokens: number,
		temperature: number,
		top_p: number, // eslint-disable-line @typescript-eslint/naming-convention
		top_k: number, // eslint-disable-line @typescript-eslint/naming-convention
		timeoutMs: number,
		apiKey?: string) {
		this.model = model;
		this.maxTokens = maxTokens;
		this.temperature = temperature;
		this.top_p = top_p;
		this.top_k = top_k;
		this.timeoutMs = timeoutMs;
		this.originalBaseURL = baseURL;
		this.stopEditingHereSymbol = getConfig().stopEditingHereSymbol;
		this.apiKey = apiKey?.trim() || undefined;
	}

	// Get URL resolved to IP address
	protected async getResolvedURL(): Promise<string> {
		if (this.resolvedBaseURL) {
			return this.resolvedBaseURL;
		}
		
		this.resolvedBaseURL = await convertURLToIP(this.originalBaseURL);
		return this.resolvedBaseURL;
	}

	// Abstract methods - implemented in subclasses
	protected abstract getApiBaseURL(resolvedURL: string): string;
	protected abstract getCompletionsEndpoint(): string;
	protected abstract getChatEndpoint(): string;
	protected abstract getModelsEndpoint(): string;

	async createHttp(timeout: number = -1): Promise<AxiosInstance> {
		// Resolve to IP address at actual connection time
		const resolvedURL = await this.getResolvedURL();
		const apiBaseURL = this.getApiBaseURL(resolvedURL);

		if (timeout <= 0) {
			timeout = this.timeoutMs;
		}

		//logDebug(`axios.create`);
		const http = axios.create({
			baseURL: apiBaseURL,
			timeout,
			headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : undefined,
		});

		return http;
	}

	async chatCompletions(params: CompletionParams): Promise<string> {
		const { signal, dispose } = toAbortSignal(params.abortSignal);
		
		// Exit immediately if already cancelled
		if (params.checkAborted && params.checkAborted()) {
			params.onComplete?.('aborted', '');
			return '';
		}

		const http = await this.createHttp();

		serverManager.keepalive(); // Start heartbeat to keep server alive
		
		try {
			// Normal chat
			const messages = [
				...(params.systemPrompt ? [{ role: 'system', content: params.systemPrompt }] : []),
				{ role: 'user', content: params.userPrompt },
				...(params.assistantPrompt ? [{ role: 'assistant', content: params.assistantPrompt }] : []),
			];
			logDebug(`Chat request sending started ${params.streamCount}th time`);
			const args: any = {// eslint-disable-line @typescript-eslint/no-explicit-any
				model: params.model ?? this.model,
				messages,
				max_tokens: params.maxTokens ?? this.maxTokens, // eslint-disable-line @typescript-eslint/naming-convention
				stream: true,
				stop: params.stops,
			};
			// if 0 <= x, make parameter
			const temperature: number = params.temperature ?? this.temperature;
			const top_p: number = params.top_p ?? this.top_p; // eslint-disable-line @typescript-eslint/naming-convention
			const top_k: number = params.top_k ?? this.top_k; // eslint-disable-line @typescript-eslint/naming-convention
			if (0 <= temperature) args.temperature = temperature;
			if (0 <= top_p) args.top_p = top_p;
			if (0 <= top_k) args.top_k = top_k;
			
			const config = getConfig();
			// if (config.isEnableCheckpoint) // 常に実行してもそこまで害はない。
			{
				await contextCheckpoints.createCheckpoints(
					http,
					this.getChatEndpoint(),
					args,
					params,
					signal);
			}
			// Remove checkpoint from messages
			for (let message of args.messages) {
				message.content = message.content.split('<|CONTEXT_CHECKPOINT|>').join('');
			}

			const res = await http.post(this.getChatEndpoint(), args, { 
				// If cancel signal is sent too early and communication ends, llama-server may miss task cancellation,
				// so don't pass signal directly
				signal, // fix b7037
				responseType: 'stream',
				validateStatus: () => true,	// no exception for status code 400
			});
			logDebug(`Chat response reception started ${params.streamCount}th time`);
			return await processStreamingResponse(res, signal, params);
		} catch (error) {
			logError(`Error in chatCompletions: ${error}`);
			// auto-start on completion only for localhost.
			await serverManager.autoStartOnCompletion();
			return "";
		} finally {
			dispose();
		}
	}

	async getModels(): Promise<string[]> {
		//logDebug(`call llmprovider:getModels`);

		const http = await this.createHttp(500);
		
		let response;
		try {
			response = await http.get(this.getModelsEndpoint());
		} catch {
			return [];
		}
		
		// Extract model names from the response
		const models = response.data?.data?.map((model: any) => model.id) || // eslint-disable-line @typescript-eslint/no-explicit-any
			response.data?.models?.map((model: any) => model.name) || // eslint-disable-line @typescript-eslint/no-explicit-any
			[];

		return models;
	}

	async isActive(): Promise<boolean> {
		const models = await this.getModels();

		return 0 < models.length;
	}
}

class OpenAICompatibleClient extends BaseAiClient {
	protected getApiBaseURL(resolvedURL: string): string {
		return resolvedURL;
	}

	protected getCompletionsEndpoint(): string {
		return '/completions';
	}

	protected getChatEndpoint(): string {
		return '/chat/completions';
	}

	protected getModelsEndpoint(): string {
		return '/models';
	}
}

export function getAiClient(): AiClient {
	const config = getConfig();
	let baseURL: string;
	
	if (config.provider === 'OpenAICompatible') {
		baseURL = config.apiBaseURL;
	} else {
		baseURL = config.apiBaseURL;
	}
	
	// Convert URL to IP address (async processing, actual conversion done in each client)
	//logDebug(`Configured baseURL: ${baseURL}`);
	
	if (config.provider === 'OpenAICompatible') {
		return new OpenAICompatibleClient(baseURL, config.model, config.maxTokens,
											config.temperature,
											config.top_p,
											config.top_k,
											config.timeoutMs,
											config.apiKey);
	} else {
		return new OpenAICompatibleClient(baseURL, config.model, config.maxTokens,
											config.temperature,
											config.top_p,
											config.top_k,
											config.timeoutMs,
											config.apiKey);
	}
}



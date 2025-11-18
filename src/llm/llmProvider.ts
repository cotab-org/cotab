import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { logInfo, logDebug, logWarning, logError } from '../utils/logger';
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

	temperature?: number;
	top_p?: number;
	top_k?: number;
}

export interface AiClient {
	chatCompletions(params: CompletionParams): Promise<string>;
	getModels(): Promise<string[]>;
	isActive(): Promise<boolean>;
}

// Type definition for completion reason
export type CompletionEndReason = 'maxLines' | 'streamEnd' | 'aborted' | 'exceedContextSize' | 'error';

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
	response: any, 
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

	return new Promise(async (resolve, reject) => {
		let onCompleteCalled = false; // Flag indicating whether onComplete was called
		
		const callOnComplete = (reason: CompletionEndReason) => {
			if (!onCompleteCalled) {
				onCompleteCalled = true;
				params.onComplete?.(reason, result);
			}
		};

		const processLines = (lines: string[]) => {
			const processError = (parsed: any): boolean => {
				// exceed context size (Llama.cpp specialization)
				if (parsed.error) {
					const code = parsed.error.code ?? 0;
					const type = (parsed.error?.type?? '');
					if (code === 400 && type === 'exceed_context_size_error') {
						const n_ctx = parsed.error?.n_ctx;
						const n_prompt_tokens = parsed.error?.n_prompt_tokens;
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
							let is_abort = false;
							if (params.onUpdate) {
								if (!params.onUpdate(result))
								{
									is_abort = true;
								}
							}
							
							// Count lines by newline characters
							const newLines = content.split('\n').length - 1;
							lineCount += newLines;
							
							// Exit when specified line count is reached
							if (is_abort || (params.maxLines && params.maxLines <= lineCount)) {
								callOnComplete('maxLines');
								resolve(result);
								stream.destroy();
								return;
							}
						}
						// exceed context size (Llama.cpp specialization)
						else if (processError(parsed)) {
						}
					} catch (e) {
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

		stream.on('error', (error: any) => {
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

/*
class ContextCheckpoints {
	public messages: any[] = [];

	async createCheckpoints(
		http: AxiosInstance,
		endpoint: string,
		arg: any,
		params: CompletionParams,
		signal: AbortSignal | undefined) {
			
		// Clone params
		const checkpointParams = { ...params };
		checkpointParams.onUpdate = (partial) => {
			logDebug(`Context checkpoint update received: ${partial}`);
			return true;
		};
		checkpointParams.onComplete = (reason, finalResult) => {
			logDebug(`Completion reason: ${reason}, result: ${finalResult}`);
		};

		// Clone args
		const checkpointArgs = { ...arg };
		checkpointArgs.max_tokens = 1;
		
		const orgMessages = arg.messages;
		checkpointArgs.messages = [];
		for (const orgMessage of orgMessages) {
			const checkpointMessage = { ...orgMessage };
			checkpointMessage.content = "";
			checkpointArgs.messages.push(checkpointMessage);

			const orgContentParts = orgMessage.content.split('<|CONTEXT_CHECKPOINT|>');
			for (const part of orgContentParts) {
				checkpointMessage.content += part;
				
				let isCached = true;
				const len = Math.min(this.messages.length, checkpointArgs.messages.length);
				if (this.messages.length < checkpointArgs.messages.length) {
					isCached = false;
				}
				else {
					for (let i = 0; i < len; i++) {
						if (this.messages[i].content !== checkpointArgs.messages[i].content) {
							isCached = false;
							break;
						}
					}
				}
				
				if (! isCached)
				{
					this.messages = checkpointArgs.messages;
					const res = await http.post(endpoint, checkpointArgs, { 
						// If cancel signal is sent too early and communication ends, llama-server may miss task cancellation,
						// so don't pass signal directly
			//				signal,
						responseType: 'stream'
					});
					logDebug(`Chat response reception started ${params.streamCount}th time`);
					await processStreamingResponse(res, signal, checkpointParams);
				}
			}
		}
	}
}

const contextCheckpoints: ContextCheckpoints = new ContextCheckpoints();
*/

// Base class - provides common functionality
abstract class BaseAiClient implements AiClient {
	protected readonly model: string;
	protected readonly maxTokens: number;
	protected readonly temperature: number;
	protected readonly top_p: number;
	protected readonly top_k: number;
	protected readonly timeoutMs: number;
	protected readonly originalBaseURL: string;
	protected resolvedBaseURL: string | null = null;
	protected readonly stopEditingHereSymbol: string;

	constructor(baseURL: string, model: string, maxTokens: number,
		temperature: number,
		top_p: number,
		top_k: number,
		timeoutMs: number) {
		this.model = model;
		this.maxTokens = maxTokens;
		this.temperature = temperature;
		this.top_p = top_p;
		this.top_k = top_k;
		this.timeoutMs = timeoutMs;
		this.originalBaseURL = baseURL;
		this.stopEditingHereSymbol = getConfig().stopEditingHereSymbol;
	}

	// Get URL resolved to IP address
	protected async getResolvedURL(): Promise<string> {
		if (this.resolvedBaseURL) {
			return this.resolvedBaseURL;
		}
		
		this.resolvedBaseURL = await convertURLToIP(this.originalBaseURL);
		return this.resolvedBaseURL;
	}

	// Check if the URL is localhost
	protected isLocalhost(): boolean {
		const url = this.originalBaseURL.toLowerCase();
		return url.includes('localhost') || 
			   url.includes('127.0.0.1') || 
			   url.includes('::1') ||
			   url.startsWith('http://localhost') ||
			   url.startsWith('https://localhost') ||
			   url.startsWith('http://127.0.0.1') ||
			   url.startsWith('https://127.0.0.1');
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
		const http = axios.create({ baseURL: apiBaseURL, timeout });

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
			const arg: any = {
				model: this.model,
				messages,
				max_tokens: params.maxTokens ?? this.maxTokens,
				stream: true,
				stop: params.stops,
			};
			// if 0 <= x, make parameter
			const temperature: number = params.temperature ?? this.temperature;
			const top_p: number = params.top_p ?? this.top_p;
			const top_k: number = params.top_k ?? this.top_k;
			if (0 <= temperature) arg.temperature = temperature;
			if (0 <= top_p) arg.top_p = top_p;
			if (0 <= top_k) arg.top_k = top_k;
			
			/*
			{
				await contextCheckpoints.createCheckpoints(
					http,
					this.getChatEndpoint(),
					arg,
					params,
					signal);
			}
			// Remove checkpoint from messages
			for (let message of arg.messages) {
				message.content = message.content.split('<|CONTEXT_CHECKPOINT|>').join('');
			}
			*/

			const res = await http.post(this.getChatEndpoint(), arg, { 
				// If cancel signal is sent too early and communication ends, llama-server may miss task cancellation,
				// so don't pass signal directly
//				signal,
				responseType: 'stream',
				validateStatus: () => true,	// no exception for status code 400
			});
			logDebug(`Chat response reception started ${params.streamCount}th time`);
			return await processStreamingResponse(res, signal, params);
		} catch (error) {
			logError(`Error in chatCompletions: ${error}`);
			// auto-start on completion only for localhost.
			if (this.isLocalhost()) {
				await serverManager.autoStartOnCompletion();
			}
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
		const models = response.data?.data?.map((model: any) => model.id) || 
					  response.data?.models?.map((model: any) => model.name) || 
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

class OllamaClient extends BaseAiClient {
	protected getApiBaseURL(resolvedURL: string): string {
		return `${resolvedURL}/v1`;
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
											config.timeoutMs);
	} else {
		return new OpenAICompatibleClient(baseURL, config.model, config.maxTokens,
											config.temperature,
											config.top_p,
											config.top_k,
											config.timeoutMs);
	}
}



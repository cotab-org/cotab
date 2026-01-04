import * as vscode from 'vscode';
import { getAiClient, CompletionEndReason } from '../llm/llmProvider';
import { buildCompletionPrompts } from '../llm/completionPrompts';
import { codeBlockBuilder } from '../llm/codeBlockBuilder';
import { getEditorContext } from '../utils/editorContext';
// diff util no longer directly used here
import { clearSuggestions, LineEdit, SuggestionData, NextEditLineData } from './suggestionStore';
import { clearAllDecorations, setupRenderer, disposeRenderer } from './suggestionRenderer';
import { largeFileManager } from '../managers/largeFileManager';
import { processDiffAndApplyEdits } from '../diff/lineDiff';
import { updateSuggestionsAndDecorations } from './suggestionUtils';
import { getConfig, CotabConfig } from '../utils/config';
import { logInfo, logError, logDebug } from '../utils/logger';
import { showProgress, hideProgress, moveProgress } from '../utils/cotabUtil';
import { serverManager } from '../managers/serverManager';

export function registerSuggestionManager(disposables: vscode.Disposable[]) {
    suggestionManager = new SuggestionManager();
    disposables.push(suggestionManager);
}

export let suggestionManager: SuggestionManager;

const maxRequestsPerSecond = 3;
const requestWindowMs = 1000;

interface InlineCompletionResult {
    document: vscode.TextDocument;
    position: vscode.Position;
    items: vscode.InlineCompletionItem[];
};

// Class that actually sends chat requests to LLM and generates candidates
export class SuggestionManager implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];

    // Inline completion change event
    public readonly onDidChangeInlineCompletionsEmitter = new vscode.EventEmitter<void>();

    // Previous AbortController
    private prevAbortController: { abort: () => void } | null = null;

    // Request frequency control
    private requestTimestamps: number[] = [];

    // Lock to prevent concurrent execution
    private isExecuting = false;

    // Stream call count
    public streamCount = 0;

    private prevResult: InlineCompletionResult | undefined;

    constructor() {
        setupRenderer();
        
        // Support Untitled/new files
        const selector: vscode.DocumentSelector = [
            { scheme: 'file' },
            { scheme: 'untitled' },
        ];
    
        // Register provider
        const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
            selector,
            this.createInlineEditProvider(),
        );

        this.disposables.push(providerDisposable);
    }

    // Generate inline completion provider
    public createInlineEditProvider(): vscode.InlineCompletionItemProvider {
        // Core logic is extracted to external function, only delegation is done here
        return {
            onDidChangeInlineCompletionItems: this.onDidChangeInlineCompletionsEmitter.event,
            provideInlineCompletionItems: this.provideInlineCompletionItems.bind(this),
        } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    dispose(): void {
        this.cancelCurrentRequest();
        if (vscode.window.activeTextEditor) {
            clearAllDecorations(vscode.window.activeTextEditor);
        }
        disposeRenderer();
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    // 
    private isMultiSelection(): boolean {
        const activeEditor = vscode.window.activeTextEditor;
        if (! activeEditor) return false;

        let isMultiLine = false;
        if (1 < activeEditor.selections.length) {
            isMultiLine = true;
        }
        else if (activeEditor.selections.length === 1 &&
                activeEditor.selections[0].start.line !== activeEditor.selections[0].end.line) {
            isMultiLine = true;
        }
        return isMultiLine;
    }

    private async waitExecution() {
        if (! this.isExecuting) return;

        logDebug(`provideInlineCompletionItemsInternal lock acquisition started`);
        while (this.isExecuting) {
            await new Promise(r => setTimeout(r, 10));
        }
        logDebug(`provideInlineCompletionItemsInternal lock acquisition completed`);
    }
   
    /**
     * Inline completion entry point called from VS Code.
     * Internally calls provideInlineCompletionItemsInternal.
     */
    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[]> {
        logDebug(`called: provideInlineCompletionItems`);

        // Reuse previous result if position is the same
        if (this.prevResult) {
            if (this.prevResult.document.uri === document.uri &&
                this.prevResult.position.line === position.line &&
                this.prevResult.position.character === position.character) {
                // Reuse previous result if position is the same
                return this.prevResult.items;
            }
            this.prevResult = undefined;
        }
        
        const startTime = Date.now();

        // Cancel if there's an existing request
        this.cancelCurrentRequest();

        // Skip completion when multiple selections (multiple cursors/selection) and exit
        if (this.isMultiSelection()) {
            logDebug('Skipping completion due to multiple selection/multiple cursor detection');
            clearSuggestions(document.uri);
            clearAllDecorations(vscode.window.activeTextEditor!);
            hideProgress();
            return [];
        }

        const config = getConfig();
        if (!config.isCurrentEnabled()) {
            return [];
        }

        // create aborted flag and control
        let aborted = false;
        const cancellationTokenSource = new vscode.CancellationTokenSource();
        const checkAborted = () => aborted;
        this.prevAbortController = {
            abort: () => {
                logDebug(`complete: Cancel signal received`);
                aborted = true;
                cancellationTokenSource.cancel();
            }
        };

        // Check if there were 3 or more requests in the last 1 second
        const currentTime = Date.now();
        this.requestTimestamps = this.requestTimestamps.filter(ts => currentTime - ts < requestWindowMs);
        this.requestTimestamps.push(currentTime);
        const isTooManyRequests = maxRequestsPerSecond <= this.requestTimestamps.length;

        moveProgress(position);

        // wait execution for cancel prev execution
        await this.waitExecution();
        
        if (isTooManyRequests) {
            await new Promise(r => setTimeout(r, 500));
        }

        // check if already canceled
        if (checkAborted()) {
            clearSuggestions(document.uri);
            clearAllDecorations(vscode.window.activeTextEditor!);
            hideProgress();
            return [];
        }

        try {
            this.isExecuting = true;
            const result = await this.provideInlineCompletionItemsInternal(
                config,
                document,
                position,
                context,
                token,
                cancellationTokenSource,
                checkAborted,
                startTime,
            );
            this.prevResult = { document, position, items: result };
            return result;
        } finally {
            this.isExecuting = false;

            logDebug(`called: provideInlineCompletionItems end`);
        }
    }

    /**
     * Core processing that receives completion results from LLM via streaming while performing diff calculation and decoration.
     */
    private async provideInlineCompletionItemsInternal(
        config: CotabConfig,
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
        cancellationTokenSource: vscode.CancellationTokenSource,
        checkAborted: () => boolean,
        startTime: number,
    ): Promise<vscode.InlineCompletionItem[]> {
        const client = getAiClient();

        // Simple async function that waits until suggestions for the cursor line are ready
        const currentCursorLine = position.line;
        let cursorLineReady = false;
        let cursorLineInlineCompletions: vscode.InlineCompletionItem[] = [];
        const waitForCursorLine = async (): Promise<vscode.InlineCompletionItem[]> => {
            const startWaitMs = Date.now();
            const maxWaitMs = 30000; // safety timeout to avoid infinite wait
            while (!cursorLineReady) {
                // break out if cancelled externally
                if (checkAborted() || cancellationTokenSource.token.isCancellationRequested) {
                    logDebug('waitForCursorLine aborted');
                    cursorLineReady = true;
                    break;
                }
                // break out on timeout (as a last resort)
                if (Date.now() - startWaitMs > maxWaitMs) {
                    logError('waitForCursorLine timed out');
                    cursorLineReady = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 50));
            }
            return cursorLineInlineCompletions;
        };

        // Progress display (spinner next to cursor + status bar)
        //showProgress('analyzing', position);

        const editorContext = getEditorContext(document, position);
        if (!editorContext) return [];

        // Early exit if already canceled
        if (checkAborted()) {
            logDebug(`provideInlineCompletionItemsInternal early exit due to cancellation (before buildCodeBlocks)`);
            clearSuggestions(document.uri);
            clearAllDecorations(vscode.window.activeTextEditor!);
            hideProgress();
            return [];
        }

        // Use CodeBlockBuilder to build code blocks
        // Analysis takes a long time.
        const cancellationAnalysisTokenSource = new vscode.CancellationTokenSource();
        /*
        const cancelAnalysis = () => {
            cancellationAnalysisTokenSource.cancel();
            clearSuggestions(document.uri);
            clearAllDecorations(vscode.window.activeTextEditor!);
            hideProgress();
        }
        */
        const codeBlocks = await codeBlockBuilder.buildCodeBlocks(
                            client,
                            editorContext,
                            currentCursorLine,
                            cancellationAnalysisTokenSource.token,
                            () : boolean => { return false; }
                        );

        // 

        const {
            systemPrompt,
            userPrompt,
            assistantPrompt,
            beforePlaceholderWithLF,
            yamlConfigMode,
            handlebarsContext,
        } = buildCompletionPrompts(editorContext, codeBlocks, document.uri.toString());

        serverManager.checkArgAndRestartServer(yamlConfigMode);
        
        const isOutput = true;
        if (isOutput) {
            logDebug(`
########################################
# SYSTEM PROMPT
########################################
${systemPrompt ?? '(none)'}
########################################
# USER PROMPT
########################################
${userPrompt}
########################################
# ASSISTANT PROMPT
########################################
${assistantPrompt}
########################################`);
        }
        // Callback to process partial responses received via streaming
        let firstUpdate = true;
        
        const maxOutputLines = yamlConfigMode.maxOutputLines ?? config.maxOutputLines;

        const applySuggestions = (llmOutputText: string,
            checkCompleteLine: boolean): {
            edits: LineEdit[],
            isCompletedFirstLine: boolean,
            isStopped: boolean,
            isCompletedCursorLine: boolean,
            isAbort: boolean,
            nextEditLine: NextEditLineData | undefined,
        } => {
            // Detect differences and create edit data
            const { originalDiffOperations,
                edits,
                trimed,
                finalLineNumber,
                isAbort,
                nextEditLine } = processDiffAndApplyEdits(
                llmOutputText,
                beforePlaceholderWithLF,
                editorContext,
                yamlConfigMode,
                document.uri,
                checkCompleteLine,
                maxOutputLines
            );

            const isStopped = yamlConfigMode.isNoCheckStopSymbol ?? !trimed;

            const enableNextEditJump = (config.nextEditJump) && (yamlConfigMode.nextEditJump ?? true);

            const suggestionData: SuggestionData = {
				originalDiffOperations,
				edits,
				checkCompleteLine: checkCompleteLine ? currentCursorLine : -1,
				isStopped,
				isDispOverwrite: yamlConfigMode.isDispOverwrite ?? false,
                isNoHighligh: yamlConfigMode.isNoHighligh ?? false,
                isForceOverlay: yamlConfigMode.isForceOverlay ?? false,
                isNoItalic: yamlConfigMode.isNoItalic ?? false,
                nextEditLine: (enableNextEditJump ? nextEditLine : undefined),
			};
            
			const {isCompletedFirstLine, inlineCompletionItems} = updateSuggestionsAndDecorations(
                document.uri,
                suggestionData);

            if (inlineCompletionItems.length) {
                cursorLineInlineCompletions = inlineCompletionItems;
            }
            return {
                edits,
                isCompletedFirstLine,
                isStopped: !trimed,
                isCompletedCursorLine: currentCursorLine <= finalLineNumber,
                isAbort,
                nextEditLine
             };
        }

        const completionStartTime = Date.now();
        const receiveStreamingResponse = (partial: string): boolean => {
            // Clear existing suggestions on first response
            if (firstUpdate) {
                firstUpdate = false;
                showProgress('firstGenerating', position);
            }
//return true; // no stream debug
//process.stdout.write(partial);
            const { isCompletedCursorLine } = applySuggestions(partial, true);
            
            // Detect if suggestions for the cursor line are ready
            if (isCompletedCursorLine) {
                if (!cursorLineReady) {
                    cursorLineReady = true;
                    showProgress('secondGenerating', position);
                    logInfo(`Time to first line suggestion: ${Date.now() - completionStartTime}ms`);
                }
            }

            // Continue reasoning without aborting to determine the next edit line
            return true;//!isAbort;
        };
        
        // Early exit if already canceled
        if (checkAborted()) {
            logDebug(`provideInlineCompletionItemsInternal early exit due to cancellation (before chatCompletions)`);
            clearSuggestions(document.uri);
            clearAllDecorations(vscode.window.activeTextEditor!);
            hideProgress();
            return [];
        }

        const streamCount = this.streamCount + 1;
		logDebug(`Time to pre process reception: ${streamCount}th time ${Date.now() - startTime}ms`);
        try {
            this.streamCount++;
            const maxTokens = yamlConfigMode.maxTokens ?? config.maxTokens;
            const model = yamlConfigMode.model ?? config.model;
            const temperature = yamlConfigMode.temperature ?? config.temperature;
            const top_p = yamlConfigMode.topP ?? config.top_p; // eslint-disable-line @typescript-eslint/naming-convention
            const top_k = yamlConfigMode.topK ?? config.top_k; // eslint-disable-line @typescript-eslint/naming-convention
            
            // Start LLM call in background
            logInfo(`Completion generation started - Output up to ${maxOutputLines} lines (${streamCount}th time)`);
            // From after analysis until first char arrival
            showProgress('prompting', position);
            client.chatCompletions({
                systemPrompt,
                userPrompt,
                assistantPrompt,
                abortSignal: cancellationTokenSource.token,
                checkAborted,
                maxLines: maxOutputLines,
                maxTokens,
                model,
                temperature,
                top_p, // eslint-disable-line @typescript-eslint/naming-convention
                top_k, // eslint-disable-line @typescript-eslint/naming-convention
                stops: ['```', '... existing code ...'],	// this.stopEditingHereSymbol
                onUpdate: receiveStreamingResponse,
                onComplete: (reason: CompletionEndReason, finalResult?: string) => {
                    logInfo(`Completion generation ended - Reason: ${reason}, ${streamCount}th time, Final result:\n${finalResult ? finalResult : 'None'}`);
                    
                    if (reason === 'streamEnd' || reason === 'maxLines') {
                        applySuggestions(finalResult ?? '', false);
                        if (! finalResult) {
                            clearSuggestions(document.uri);
                            clearAllDecorations(vscode.window.activeTextEditor!);
                        }
                    }
                    else if (reason === 'exceedContextSize') {
						const obj = JSON.parse(finalResult ?? '');
                        if (0 < obj.contextSize && obj.promptSize) {
                            largeFileManager.setExceedContextSize(document.uri.toString(),
                                                                    editorContext.documentText.trancatedCursor,
                                                                    codeBlocks,
                                                                    [systemPrompt, userPrompt, assistantPrompt,],
                                                                    handlebarsContext,
                                                                    obj.contextSize,
                                                                    obj.promptSize);
                        }
                        clearSuggestions(document.uri);
                        clearAllDecorations(vscode.window.activeTextEditor!);
                    }
                    // reason === 'error' || reason === 'aborted'
                    else {
                        clearSuggestions(document.uri);
                        clearAllDecorations(vscode.window.activeTextEditor!);
                    }

                    // Set cursor line ready flag when completion generation ends
                    cursorLineReady = true;

                    // Hide progress
                    hideProgress();
                },
                streamCount,
            }).catch((error) => {
                logError(`Error occurred during completion generation: ${streamCount}th time ${error}`);
                cursorLineReady = true; // Set flag even on error to release wait
                clearSuggestions(document.uri);
                clearAllDecorations(vscode.window.activeTextEditor!);
                hideProgress();
            });

            // Wait until suggestions for the cursor line are ready
            return await waitForCursorLine();
        } catch (error) {
            logError(`Error occurred in LLM call: ${streamCount}th time ${error}`);
            clearSuggestions(document.uri);
            clearAllDecorations(vscode.window.activeTextEditor!);
            hideProgress();
            return [];
        }
    }

    /**
     * Cancels the currently ongoing completion request and also clears the progress display.
     */
    public cancelCurrentRequest(): void {
        if (this.prevAbortController) {
            this.prevAbortController.abort();
            this.prevAbortController = null;
        }
        hideProgress();
    }
}

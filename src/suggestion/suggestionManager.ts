import * as vscode from 'vscode';
import { getAiClient, CompletionEndReason } from '../llm/llmProvider';
import { buildCompletionPrompts } from '../llm/completionPrompts';
import { codeBlockBuilder } from '../llm/codeBlockBuilder';
import { getEditorContext } from '../utils/editorContext';
// diff util no longer directly used here
import { setSuggestions, clearSuggestions, LineEdit } from './suggestionStore';
import { clearAllDecorations } from './suggestionRenderer';
import { processDiffAndApplyEdits } from '../diff/lineDiff';
import { updateSuggestionsAndDecorations } from './suggestionUtils';
import { getConfig, CotabConfig } from '../utils/config';
import { logInfo, logError, logDebug } from '../utils/logger';
import { showProgress, hideProgress, moveProgress } from '../utils/cotabUtil';

export function registerSuggestionManager(disposables: vscode.Disposable[]) {
    suggestionManager = new SuggestionManager();
    disposables.push(suggestionManager);
}

export let suggestionManager: SuggestionManager;

const maxRequestsPerSecond = 3;
const requestWindowMs = 1000;

// Class that actually sends chat requests to LLM and generates candidates
export class SuggestionManager implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];

    // Inline completion change event
    public readonly onDidChangeInlineCompletionsEmitter = new vscode.EventEmitter<void>();

    // Previous AbortController
    private prevAbortController: AbortController | null = null;

    // Request frequency control
    private requestTimestamps: number[] = [];

    // Lock to prevent concurrent execution
    private isExecuting = false;

    // Stream call count
    public streamCount = 0;

    constructor() {
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
        } as any;
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

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

        // Cancel if there's an existing request
        this.cancelCurrentRequest();

        // Skip completion when multiple selections (multiple cursors/selection) and exit
        if (this.isMultiSelection()) {
            logDebug('Skipping completion due to multiple selection/multiple cursor detection');
            return [];
        }

        const cfg = getConfig();
        if (!cfg.isCurrentEnabled()) {
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
        } as any;

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
            return [];
        }

        try {
            this.isExecuting = true;
            const result = await this.provideInlineCompletionItemsInternal(
                cfg,
                document,
                position,
                context,
                token,
                cancellationTokenSource,
                checkAborted,
            );
            return result;
        } finally {
            this.isExecuting = false;
        }
    }

    /**
     * Core processing that receives completion results from LLM via streaming while performing diff calculation and decoration.
     */
    private async provideInlineCompletionItemsInternal(
        cfg: CotabConfig,
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
        cancellationTokenSource: vscode.CancellationTokenSource,
        checkAborted: () => boolean,
    ): Promise<vscode.InlineCompletionItem[]> {
        const client = getAiClient();

        // Simple async function that waits until suggestions for the cursor line are ready
        let currentCursorLine = position.line;
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
            hideProgress();
            return [];
        }

        // Use CodeBlockBuilder to build code blocks
        // Analysis takes a long time.
        const cancellationAnalysisTokenSource = new vscode.CancellationTokenSource();
        const cancelAnalysis = () => {
            cancellationAnalysisTokenSource.cancel();
            hideProgress();
        }
        const { sourceAnalysis, symbolCodeBlock, editHistoryCodeBlock } =
                await codeBlockBuilder.buildCodeBlocks(
                                        client,
                                        editorContext,
                                        currentCursorLine,
                                        cancellationAnalysisTokenSource.token,
                                        () : boolean => { return false; }
                                    );

        // 

        const { systemPrompt, userPrompt, assistantPrompt, beforePlaceholderWithLF } =
                        buildCompletionPrompts(editorContext,
                                                sourceAnalysis,
                                                symbolCodeBlock,
                                                editHistoryCodeBlock,
                                                document.uri.toString());
        
        const isOutput = true;
        if (isOutput) {
            logDebug(`System prompt:\n${systemPrompt ?? '(none)'}`);
            logDebug(`User prompt BEGIN\n${userPrompt}\nUser prompt END`);
            logDebug(`Assistant prompt:\n${assistantPrompt}`);
            logDebug(`Edit History:\n${editHistoryCodeBlock}`);
        }
        // Callback to process partial responses received via streaming
        let firstUpdate = true;

        const applySuggestions = (llmOutputText: string, checkCompleteLine: boolean): {
            edits: LineEdit[],
            isCompletedFirstLine: boolean,
            isStoped: boolean,
            isCompletedCursorLine: boolean
        } => {
            // Detect differences and create edit data
            const { originalDiffOperations, edits, trimed, finalLineNumber } = processDiffAndApplyEdits(
                llmOutputText,
                beforePlaceholderWithLF,
                editorContext,
                document.uri,
                checkCompleteLine,
            );

            const {isCompletedFirstLine, inlineCompletionItems} = updateSuggestionsAndDecorations(
                originalDiffOperations,
                edits,
                document.uri,
                checkCompleteLine ? currentCursorLine : -1,
                !trimed);

            if (inlineCompletionItems.length) {
                cursorLineInlineCompletions = inlineCompletionItems;
            }
            return { edits, isCompletedFirstLine, isStoped: !trimed, isCompletedCursorLine: currentCursorLine <= finalLineNumber };
        }

        const startTime = Date.now();
        const receiveStreamingResponse = (partial: string): boolean => {
            // Clear existing suggestions on first response
            if (firstUpdate) {
                firstUpdate = false;
                showProgress('firstGenerating', position);
            }
//return true; // no stream debug
//process.stdout.write(partial);
            const {edits, isCompletedFirstLine: firstLineComplete, isStoped: is_stoped, isCompletedCursorLine} = applySuggestions(partial, true);
            
            // Detect if suggestions for the cursor line are ready
            if (isCompletedCursorLine) {
                if (!cursorLineReady) {
                    cursorLineReady = true;
                    showProgress('secondGenerating', position);
                    logInfo(`Time to first line suggestion: ${Date.now() - startTime}ms`);
                }
            }

            // Don't stop because marker position might shift in output
            return true;//!is_stoped;
        };
        
        // Early exit if already canceled
        if (checkAborted()) {
            logDebug(`provideInlineCompletionItemsInternal early exit due to cancellation (before chatCompletions)`);
            return [];
        }

        let streamCount = this.streamCount + 1;
        try {
            this.streamCount++;
            const maxOutputLines = cfg.maxOutputLines;			
            
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
                stops: ['```', '... existing code ...'],	// this.stopEditingHereSymbol
                onUpdate: receiveStreamingResponse,
                onComplete: (reason: CompletionEndReason, finalResult?: string) => {
                    logInfo(`Completion generation ended - Reason: ${reason}, ${streamCount}th time, Final result:\n${finalResult ? finalResult : 'None'}`);
                    if (reason === 'error' || reason === 'aborted') {
                        clearSuggestions(document.uri);
                        clearAllDecorations(vscode.window.activeTextEditor!);
                    }
                    else {
                        const { edits, isCompletedFirstLine: firstLineComplete, isStoped: is_stoped, isCompletedCursorLine } = 
                                applySuggestions(finalResult ?? '', false);
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
                hideProgress();
            });

            // Wait until suggestions for the cursor line are ready
            return await waitForCursorLine();
        } catch (error) {
            logError(`Error occurred in LLM call: ${streamCount}th time ${error}`);
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

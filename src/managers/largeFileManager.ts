import * as vscode from 'vscode';
import { logDebug, logInfo } from '../utils/logger';
import { EditorDocumentText } from '../utils/editorContext';
import { CodeBlocks } from '../llm/codeBlockBuilder';
import { getConfig } from '../utils/config';

export function registerLargeFileManager(disposables: vscode.Disposable[]) {
    largeFileManager = new LargeFileManager();
    disposables.push(largeFileManager);
}

// Singleton instance
export let largeFileManager: LargeFileManager;


export interface LargeFileEntry {
    contextSize: number;
    systemPromptSize: number;
    textToPromptScale: number;
    adjustScale: number;
}

export const beforeTruncatedText = '### CODE TRUNCATED FOR LENGTH: PREVIOUS PART NOT INCLUDED ###';
export const afterTruncatedText  = '### CODE TRUNCATED FOR LENGTH: REMAINING PART NOT INCLUDED ###';

class LargeFileManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private fileMap: Map<string, LargeFileEntry> = new Map();

    constructor() {
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.fileMap.clear();
    }

    public getDocumentText(
        document: vscode.TextDocument,
        position: vscode.Position
    ): EditorDocumentText {
        const editorDocument: EditorDocumentText = {
            fullText: document.getText().replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
            trancatedTop: '',
            trancatedCursor: '',
            position,
            trancationDocumentTextLen: 0,
            trancationPositionStart: 0,
        }
        editorDocument.trancatedTop = editorDocument.fullText;
        editorDocument.trancatedCursor = editorDocument.fullText;

        const entry = this.fileMap.get(document.uri.toString());
        if (entry) {
            const budgetContextSize = (entry.contextSize - entry.systemPromptSize) * entry.adjustScale;
            const requirePromptSize = editorDocument.fullText.length * entry.textToPromptScale;

            // If the required prompt size exceeds the available context budget, truncate the document text
            if (budgetContextSize < requirePromptSize) {
                const trancationDocumentTextLen = Math.floor(budgetContextSize / entry.textToPromptScale);
                let trancationPositionStart = 0;
                let trancationPositionEnd = 0;

                // trancate top of page
                {
                    const substr = editorDocument.fullText.substring(0, trancationDocumentTextLen);
                    editorDocument.trancatedTop = `${substr}\n\n${afterTruncatedText}`;
                }
                // trancate around cursor
                {
                    // Find the character index of the cursor line
                    let lineStartIndex = 0;
                    const lines = editorDocument.fullText.split('\n');
                    for(let i = 0; i < position.line; i++) {
                        lineStartIndex += lines[i].length + 1;
                    }
                    
                    // Center around the cursor position to extract context
                    trancationPositionStart = lineStartIndex - trancationDocumentTextLen / 2;
                    trancationPositionEnd = lineStartIndex + trancationDocumentTextLen / 2;

                    // Calculate the overflow length from the end and expand the beginning if it overflows  
                    const afterStuckOut = Math.max(0, trancationPositionEnd - editorDocument.fullText.length);
                    trancationPositionEnd = Math.min(trancationPositionEnd, editorDocument.fullText.length);

                    trancationPositionStart -= afterStuckOut;
                    trancationPositionStart = Math.max(0, trancationPositionStart);

                    // Extract context around the cursor
                    const sbstr = editorDocument.fullText.substring(trancationPositionStart, trancationPositionEnd);
                    editorDocument.trancatedCursor = `${beforeTruncatedText}\n\n${sbstr}\n\n${afterTruncatedText}`;
                }

                // -3 because `${beforeTruncatedText}\n\n`
                const startLine = editorDocument.fullText.substring(0, trancationPositionStart).split('\n').length - 3;
                editorDocument.trancationDocumentTextLen = trancationDocumentTextLen;
                editorDocument.trancationPositionStart = startLine;
            }
        }
        return editorDocument;
    }

    public setExceedContextSize(
        documentUri: string,
        documentText: string,
        codeBlocks: CodeBlocks,
        messages: string[],
        handlebarsContext: any,
        contextSize: number,
        promptSize: number,
    ) {
        const config = getConfig();
        let totalTextLength = 0;
        for (const message of messages) {
            totalTextLength += message.length;
        }
        
        // without symbol block
        totalTextLength -= (codeBlocks.symbolCodeBlock?.length || 0);
        contextSize -= config.maxSymbolCharNum * 0.266;  // Qwen3:4b-Instruct-2507 case, token count is approximately 1/4

        if (totalTextLength < 1024) {
            totalTextLength = 1024;
        }
        let sourceRatio = (handlebarsContext.sourceCodeBlock?.length || totalTextLength) / totalTextLength;
        sourceRatio = Math.min(Math.max(sourceRatio, 0), 1);
        const codePromptSize = promptSize * sourceRatio;
        const systemPromptSize = promptSize * (1 - sourceRatio);
        let textToPromptScale = (codePromptSize / totalTextLength) || 1;
        let adjustScale = 0.9;

        const entry = this.fileMap.get(documentUri);
        if (entry) {
            adjustScale = entry.adjustScale * 0.9;
            textToPromptScale = Math.max(0.1, Math.max(entry.textToPromptScale, textToPromptScale));
        }
        this.fileMap.set(documentUri, {
            contextSize,
            systemPromptSize,
            textToPromptScale,
            adjustScale,
        });
    }
}

import * as vscode from 'vscode';
import { logDebug, logInfo } from '../utils/logger';
import { EditorDocumentText } from '../utils/editorContext';

export function registerLargeFileManager(disposables: vscode.Disposable[]) {
    largeFileManager = new LargeFileManager();
    disposables.push(largeFileManager);
}

// Singleton instance
export let largeFileManager: LargeFileManager;


export interface LargeFileEntry {
    contextSize: number;
    textToPromptScale: number;
    adjustScale: number;
}

const systemPromptSize = 5*1024;
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
            const budgetContextSize = Math.max(entry.contextSize - systemPromptSize, 8192) * entry.adjustScale;
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

    public setExceedContextSize(documentUri: string, documentText: string, contextSize: number, promptSize: number) {        
        const codePromptSize = Math.max(promptSize - systemPromptSize, 8192);
        let textToPromptScale = (codePromptSize / documentText.length) || 1;
        let adjustScale = 0.9;

        const entry = this.fileMap.get(documentUri);
        if (entry) {
            adjustScale = entry.adjustScale * 0.9;
            textToPromptScale = Math.max(0.1, Math.max(entry.textToPromptScale, textToPromptScale));
        }
        this.fileMap.set(documentUri, {
            contextSize,
            textToPromptScale,
            adjustScale,
        });
    }
}

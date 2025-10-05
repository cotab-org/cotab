import * as vscode from 'vscode';
import { EditorContext } from '../utils/editorContext';
import { LineDiff, computeLineDiff, diffOperationsToLineEdits, processMaxLinesDiffOperations } from './lineDiffUtils';
import { preprocessLLMOutput } from './lineDiffUtils';
import { LineEdit } from '../suggestion/suggestionStore';

export interface DiffProcessResult {
    originalDiffOperations: LineDiff[];
    edits: LineEdit[];
    trimed: boolean;
    finalLineNumber: number;
}
/*
function test() {
    const origLines: string = 
`                blocks.push_back(Block(x, y));
            }
        }
    }

    void update()
    {
        if (gameOver || gameWon)
            return;

        // Ball movement
        ball.move();

        // When ball falls down
        if (ball.y >= HEIGHT)
        {
            gameOver = true;
            return;
        }`

const newLines: string = 
`                blocks.push_back(Block(x, y));
        }`;
    const diffOps = computeLineDiff(origLines.split("\n"), newLines.split("\n"));
    return diffOps;
}
*/

/**
 * Receives LLM output, calculates differences, and generates LineEdit.
 */
export function processDiffAndApplyEdits(
    llmOutputText: string,
    beforePlaceholderWithLF: string,
    editorContext: EditorContext,
    documentUri: vscode.Uri,
    checkCompleteLine: boolean,
): DiffProcessResult {
    //test();
    const withPrefix = beforePlaceholderWithLF + llmOutputText;
    const { cleaned, is_stoped } = preprocessLLMOutput(withPrefix);
    if (!cleaned.trim()) return { originalDiffOperations: [], edits: [], trimed: false, finalLineNumber: 0 };

    let baseLine = editorContext.aroundFromLine;
    const documentTexts = editorContext.documentText.split('\n');
    let origLines = documentTexts.slice(editorContext.aroundFromLine, editorContext.aroundMergeToLine);
    let newLines = cleaned.split(/\n/);

    if (origLines.length && newLines.length) {

        // First line with characters in upward direction
        let orgUpperHeadIdx = -1;
        let orgUpperHead = '';
        for(let i = editorContext.aroundFromLine - 1; i >= 0; i--) {
            if (documentTexts[i].trim() !== '') {
                orgUpperHeadIdx = i;
                orgUpperHead = documentTexts[i].replace(/^\s+/, '');
                break;
            }
        }
        // First line with characters
        const origTrimIdx = origLines.findIndex(l => l.trim() !== '');
        const newTrimIdx = newLines.findIndex(l => l.trim() !== '');

        if (0 <= origTrimIdx && 0 <= newTrimIdx) {
            const origHead = origLines[origTrimIdx];//.replace(/^\s+/, '');
            const newHead = newLines[newTrimIdx];//.replace(/^\s+/, '');

            // There's a possibility of incorrectly outputting the line above
            if (0 <= orgUpperHeadIdx && orgUpperHead === newHead) {
                newLines = newLines.slice(1);
            }
        }
    }
    if (origLines.length && newLines.length) {

        // First line with characters
        const origTrimIdx = origLines.findIndex(l => l.trim() !== '');
        const newTrimIdx = newLines.findIndex(l => l.trim() !== '');

        if (0 <= origTrimIdx && 0 <= newTrimIdx) {
            const origHead = origLines[origTrimIdx].replace(/^\s+/, '');
            const newHead = newLines[newTrimIdx].replace(/^\s+/, '');
            
            // Simple correction for leading empty line misalignment etc.
            const minLen = Math.min(origHead.length, newHead.length, 5);
            if (origHead.slice(0, minLen) === newHead.slice(0, minLen) && 0 < origTrimIdx) {
                origLines = origLines.slice(origTrimIdx);
                baseLine += origTrimIdx;
            }
        }
    }
    if (origLines.length && newLines.length) {

        // First line with characters
        const origTrimIdx = origLines.findIndex(l => l.trim() !== '');
        const newTrimIdx = newLines.findIndex(l => l.trim() !== '');

        if (0 <= origTrimIdx && 0 <= newTrimIdx) {
            const newHead = newLines[newTrimIdx];//.replace(/^\s+/, '');

            // Sometimes the current line is ignored and output starts from code below, so correct for this
            // Find a line where the first line matches exactly
            for(let i = 0; i < Math.max(origLines.length, 5); i++) {
                const orgLine = origLines[i];//.replace(/^\s+/, '');
                if (orgLine === newHead) {
                    // And check same next line
                    if (i + 1 < Math.max(origLines.length, 6)) {
                        if (origLines[i + 1] === newLines[newTrimIdx + 1]) {
                            origLines = origLines.slice(i);
                            baseLine += i;
                        }
                    }
                    break;
                }
            }
        }
    }

    // Ignore the last line of newLines as it may be incomplete output
    const newLinesNonLast = (checkCompleteLine && newLines.length > 0) ? newLines.slice(0, -1) : newLines;

    // Execute diff
    const diffOps = computeLineDiff(origLines, newLinesNonLast);

    // Fluctuation suppression: discard everything after 'keep' appears following changes
    const filteredOps: LineDiff[] = [];
    let foundChange = false;
    let foundKeepAfterChange = false;
    for (const op of diffOps) {
        if (op.type === 'keep') {
            if (foundChange) {
                foundKeepAfterChange = true;
                break;
            }
        } else {
            foundChange = true;
            filteredOps.push(op);
        }
    }

    const trimmedOps = (foundKeepAfterChange) ? filteredOps : processMaxLinesDiffOperations(filteredOps, origLines);
    const edits = diffOperationsToLineEdits(trimmedOps, baseLine);

    const originalIndexedOps = diffOps.map(op => ({
        ...op,
        originalIndex: op.originalIndex !== undefined ? op.originalIndex + baseLine : undefined,
        newIndex: op.newIndex !== undefined ? op.newIndex + baseLine : undefined,
    }));

    // Calculate final line number (baseLine + processed lines)
    const finalLineNumber = baseLine + newLinesNonLast.length - 1;
    
    return { originalDiffOperations: originalIndexedOps, edits, trimed: !is_stoped, finalLineNumber };
}

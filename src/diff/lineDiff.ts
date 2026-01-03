import * as vscode from 'vscode';
import { EditorContext } from '../utils/editorContext';
import { YamlConfigMode } from '../utils/yamlConfig';
import { computeCharDiff } from './charDiff';
import { LineDiff, computeLineDiff, diffOperationsToLineEdits, processMaxLinesDiffOperations } from './lineDiffUtils';
import { preprocessLLMOutput } from './lineDiffUtils';
import { LineEdit } from '../suggestion/suggestionStore';

export interface DiffProcessResult {
    originalDiffOperations: LineDiff[];
    edits: LineEdit[];
    trimed: boolean;
    finalLineNumber: number;
    isAbort: boolean;
    nextEditLine: number;
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
    yamlConfigMode: YamlConfigMode,
    documentUri: vscode.Uri,
    checkCompleteLine: boolean,
): DiffProcessResult {
    //test();
    const withPrefix = beforePlaceholderWithLF + llmOutputText;
    const { cleaned, isStopedSymbol, stoppedLineNo, isStopedExistingComment } = preprocessLLMOutput(yamlConfigMode, withPrefix);
    if (!cleaned.trim()) {
        return {
            originalDiffOperations: [],
            edits: [],
            trimed: false,
            finalLineNumber: 0,
            isAbort: false,
            nextEditLine: -1
        };
    }

    let baseLine = editorContext.aroundFromLine;
    const lastLineLine = editorContext.aroundToLine;
    const documentTexts = editorContext.documentText.fullText.split('\n');
    let origLines = documentTexts.slice(editorContext.aroundFromLine, editorContext.aroundMergeToLine);
    let newLines = cleaned.split(/\n/);
    

    // In the case of Qwen3-Coder-30b-3b using recent llama.cpp,
    // the initial output may sometimes not have leading whitespace.
    // ※This issue was not present in the 2025 summer version, so it seems that some inference part has changed due to optimizations after that.
    // Therefore, when the original has leading whitespace and the output does not, we correct the diff.
    // By the way, for some reason, indents appear in the output starting from the second line,
    // so it appears to be a compatibility issue between the model, assistant prompt, and llama.cpp implementation.
    if (0 < origLines.length && 0 < newLines.length) {
        const orgLine = origLines[0];
        const newLine = newLines[0];

        const isOrgLineFirstSpace = orgLine.length > 0 && /\s/.test(orgLine[0]);
        const isNewLineFirstSpace = newLine.length > 0 && /\s/.test(newLine[0]);
        if (isOrgLineFirstSpace && !isNewLineFirstSpace) {
            // Correct leading spaces
            const orgLeadingSpaces = orgLine.length - orgLine.trimStart().length;
            newLines[0] = orgLine.substring(0, orgLeadingSpaces) + newLine;
        }
    }

    if (origLines.length && newLines.length) {

        // First line with characters in upward direction
        let orgUpperHeadIdx = -1;
        let orgUpperHead = '';
        for(let i = editorContext.aroundFromLine - 1; i >= 0; i--) {
            if (documentTexts[i].trim() !== '') {
                orgUpperHeadIdx = i;
                orgUpperHead = documentTexts[i];//.replace(/^\s+/, '');
                break;
            }
        }
        // First line with characters
        const origTrimIdx = origLines.findIndex(l => l.trim() !== '');
        const newTrimIdx = newLines.findIndex(l => l.trim() !== '');

        if (0 <= origTrimIdx && 0 <= newTrimIdx) {
            //const origHead = origLines[origTrimIdx];//.replace(/^\s+/, '');
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
            //const minLen = Math.min(origHead.length, newHead.length, 5);
            //if (origHead.slice(0, minLen) === newHead.slice(0, minLen) && 0 < origTrimIdx) {
            if (origHead === newHead && 0 < origTrimIdx) {
                origLines = origLines.slice(origTrimIdx);
                newLines = newLines.slice(newTrimIdx);
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
    
    // Early exit if all operations up to lastLineLine were keeps.
    let isAbort = false;
    if (diffOps.length >= lastLineLine - baseLine &&
        diffOps.slice(0, lastLineLine - baseLine).every(op => op.type === 'keep')) {
        isAbort = true;
    }
    
    // If the pattern is only consecutive keeps followed by consecutive deletes, it means no changes were made and the output was simply insufficient
    let diffOpsNoChecked = diffOps;
    {
        let foundKeep = false;
        let foundDelete = false;
        for (const op of diffOps) {
            if (op.type === 'keep') {
                foundKeep = true;
                if (foundDelete) {
                    // reset
                    foundKeep = false;
                    foundDelete = false;
                    break;
                }
            }
            else if (op.type === 'delete') {
                foundDelete = true;
                if (! foundKeep) {
                    // reset
                    foundKeep = false;
                    foundDelete = false;
                    break;
                }
            }
            else {
                break;
            }
        }
        if (foundKeep && foundDelete) {
            diffOpsNoChecked = [];
        }
    }

    // Fluctuation suppression: discard everything after 'keep' appears following changes
    const filteredOps: LineDiff[] = [];
    let foundChange = false;
    let foundKeepAfterChange = false;
    // TODO: once buildSvgDataUriWithShiki supports separated lines, re-introduce the skip branch.
    for (const op of diffOpsNoChecked) {
        if (op.type === 'keep') {
            if (foundChange) {
                foundKeepAfterChange = true;
                break;
            }
        }
        else {
            foundChange = true;
            filteredOps.push(op);
        }
    }

    let trimmedOps = (foundKeepAfterChange &&
                            ! isStopedExistingComment 
                            // &&  ! yamlConfigMode.isNoCheckStopSymbol  // @todo because buildSvgDataUriWithShiki is not supported sepalated line
                        ) ? filteredOps : processMaxLinesDiffOperations(filteredOps, origLines);

    // If the first line only and only contains whitespace, do nothing
    if (trimmedOps.length === 1 && trimmedOps[0].originalText?.trim() === '' && trimmedOps[0].newText?.trim() === '') {
        trimmedOps = [];
    }

    const preEdits = diffOperationsToLineEdits(trimmedOps, baseLine);

    // If there is no stop symbol and five or more 'delete' operations follow consecutively, consider it a diff error and disable it.
    if (! isStopedSymbol &&
        3 <= preEdits.length &&
        preEdits[0].type === 'delete' &&
        preEdits[1].type === 'delete' &&
        preEdits[2].type === 'delete' &&
        preEdits[3].type === 'delete' &&
        preEdits[4].type === 'delete'
    ) {
        preEdits.length = 0;
    }

    /*
    // When the stop symbol is encountered and the edit line number is within the range, it is considered valids
    if (0 < preEdits.length && isStopedSymbol && stoppedLineNo !== undefined) {
        if (baseLine + stoppedLineNo <= preEdits[0].line) {
            preEdits.length = 0;
        }
    }
    */
   /*
   let isAbort = false;
    if (0 < preEdits.length && editorContext.aroundToLine < preEdits[0].line) {
        preEdits.length = 0;
        isAbort = true;
    }
    */

    let nextEditLine = -1;
    // If the first edit line is out of range, do nothing.
    if (isAbort) {
        if (0 < preEdits.length && preEdits[0].newText !== '') {
            nextEditLine = preEdits[0].line;
        }
        preEdits.length = 0;
    }
    
    // ignore if out of range that first edit line
    const isValidFirstLines = lastLineLine + editorContext.aroundLatestAddAfterLines;
    const isValidEdits = (0 < preEdits.length && preEdits[0].line < isValidFirstLines);
    const edits = isValidEdits ? preEdits : [];

    const originalIndexedOps = diffOpsNoChecked.map(op => ({
        ...op,
        originalIndex: op.originalIndex !== undefined ? op.originalIndex + baseLine : undefined,
        newIndex: op.newIndex !== undefined ? op.newIndex + baseLine : undefined,
    }));

    /**
     * If there is no stop symbol, insertion cannot be correctly detected.
     * Even then, the system treats only the first line as a valid line to capture as much AI output as possible.
     * As a result, the first line that should be inserted is mistakenly considered a replace,
     * causing it to delete a line that shouldn't be removed.
     * Because Diff lacks information for subsequent lines, we treat this as an insertion under conditions where major issues are unlikely.
     */
    if (! yamlConfigMode.isNoCheckStopSymbol &&
        ! isStopedSymbol &&
        edits.length > 0 &&
        edits[0].type === 'change' &&
        newLinesNonLast.length > 0) {
        const newText = edits[0].newText.trim();
        const orgText = documentTexts[edits[0].line].trim();
        if (0 < orgText.length) {
            const segs = computeCharDiff(orgText, newText);
            let deleteLength = 0;
            let isInsertionJudgment = false;
            for (const seg of segs) {
                if (seg.type === 'delete') {
                    deleteLength += (seg.delete??0);
                    
                    if (deleteLength === orgText.length ||
                        (deleteLength / orgText.length) >= 0.5) {
                        isInsertionJudgment = true;
                    }
                }
            }

            // 
            if (isInsertionJudgment) {
                edits[0].type = 'add';
            }
        }
    }

    // Calculate final line number (baseLine + processed lines)
    const finalLineNumber = baseLine + newLinesNonLast.length - 1;
    
    return {
        originalDiffOperations: originalIndexedOps,
        edits,
        trimed: !isStopedSymbol,
        finalLineNumber,
        isAbort,
        nextEditLine
    };
}

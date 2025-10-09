import { getConfig } from '../utils/config';
import { withoutLineNumber } from '../llm/llmUtils'

export interface LineDiff {
    type: 'keep' | 'add' | 'delete' | 'change';
    originalIndex?: number;
    newIndex?: number;
    originalText?: string;
    newText?: string;
}

/**
 * Computes the difference between two string arrays using the LCS algorithm.
 */
export function computeLineDiff(originalLines: string[], newLines: string[]): LineDiff[] {
    const m = originalLines.length;
    const n = newLines.length;

    // Special handling for first line: treat partial match changes at line start as 'change'
    let firstLineMatch = false;
    let firstLineChange: LineDiff | null = null;
    if (m > 0 && n > 0) {
        const origFirst = originalLines[0];
        const newFirst = newLines[0];
        if (newFirst.startsWith(origFirst) && newFirst !== origFirst) {
            firstLineMatch = true;
            firstLineChange = {
                type: 'change',
                originalIndex: 0,
                newIndex: 0,
                originalText: origFirst,
                newText: newFirst,
            };
        }
    }

    // Shift LCS calculation target as needed
    let remainingOrigLines = originalLines;
    let remainingNewLines = newLines;
    let offsetOrig = 0;
    let offsetNew = 0;
    if (firstLineMatch) {
        remainingOrigLines = originalLines.slice(1);
        remainingNewLines = newLines.slice(1);
        offsetOrig = 1;
        offsetNew = 1;
    }

    const remainingM = remainingOrigLines.length;
    const remainingN = remainingNewLines.length;

    const dp: number[][] = Array.from({ length: remainingM + 1 }, () => Array(remainingN + 1).fill(0));

    // Calculate LCS length
    for (let i = 1; i <= remainingM; i++) {
        for (let j = 1; j <= remainingN; j++) {
            if (remainingOrigLines[i - 1] === remainingNewLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Build difference operation sequence
    const operations: LineDiff[] = [];
    let i = remainingM;
    let j = remainingN;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && remainingOrigLines[i - 1] === remainingNewLines[j - 1]) {
            operations.unshift({
                type: 'keep',
                originalIndex: i - 1 + offsetOrig,
                newIndex: j - 1 + offsetNew,
                originalText: remainingOrigLines[i - 1],
                newText: remainingNewLines[j - 1],
            });
            i--; j--;
        } else if (i > 0 && (j === 0 || dp[i - 1][j] > dp[i][j - 1])) {
            // Prefer moving "up" only when it strictly improves the LCS length.
            // When the LCS length is the same (tie), move "left" so that we keep the earlier
            // original line instead of skipping it. This results in the earlier occurrence
            // of duplicated lines (e.g., closing braces) being treated as 'keep'.
            operations.unshift({
                type: 'delete',
                originalIndex: i - 1 + offsetOrig,
                originalText: remainingOrigLines[i - 1],
            });
            i--;
        } else if (j > 0) {
            const insertPos = i; // Insertion occurs just before current i
            operations.unshift({
                type: 'add',
                originalIndex: insertPos + offsetOrig,
                newIndex: j - 1 + offsetNew,
                newText: remainingNewLines[j - 1],
            });
            j--;
        }
    }

    if (firstLineChange) {
        operations.unshift(firstLineChange);
    }

    const merged = mergeDeleteAddChange(operations);

    // Prefer earlier occurrence when identical lines appear as delete followed by keep
    for (let i = 0; i < merged.length; i++) {
        const del = merged[i];
        if (del.type !== 'delete') continue;

        for (let j = i + 1; j < merged.length; j++) {
            const keep = merged[j];
            if (keep.type === 'keep' && keep.originalText === del.originalText) {
                // swap types to keep earlier line
                merged[i] = {
                    type: 'keep',
                    originalIndex: del.originalIndex,
                    newIndex: keep.newIndex,
                    originalText: del.originalText,
                    newText: keep.newText,
                };
                merged[j] = {
                    type: 'delete',
                    originalIndex: keep.originalIndex,
                    originalText: keep.originalText,
                };
                break;
            }
            // Stop scanning if we encounter a change/add/keep of different text
            if (keep.type !== 'delete') break;
        }
    }

    return merged;
}

/**
 * Post-processing to merge delete+add combinations into change operations.
 */
export function mergeDeleteAddChange(ops: LineDiff[]): LineDiff[] {
    const res: LineDiff[] = [...ops];
    for (let i = 0; i < res.length; i++) {
        const cur = res[i];
        for (let j = i + 1; j < res.length; j++) {
            const target = res[j];
            // delete followed by add  --> change
            if (cur.type === 'delete' && target.type === 'add' && cur.originalIndex === target.newIndex) {
                res[i] = {
                    type: 'change',
                    originalIndex: cur.originalIndex,
                    newIndex: target.newIndex,
                    originalText: cur.originalText,
                    newText: target.newText,
                };
                res.splice(j, 1);
                break;
            }
            // add followed by delete at same position  --> swap order or merge
            if (cur.type === 'add' && target.type === 'delete' && target.originalIndex === cur.originalIndex) {
                // Prefer merging to change for consistency
                res[i] = {
                    type: 'change',
                    originalIndex: target.originalIndex,
                    newIndex: cur.newIndex,
                    originalText: target.originalText,
                    newText: cur.newText,
                };
                res.splice(j, 1);
                break;
            }
        }
    }
    return res;
}

export interface LineEdit {
    line: number; // Line number (0-based)
    newText: string;
    type: 'add' | 'delete' | 'change';
}

/**
 * Converts DiffOperation array to LineEdit array for easier handling in VSCode.
 */
export function diffOperationsToLineEdits(operations: LineDiff[], baseLine: number): LineEdit[] {
    const edits: LineEdit[] = [];
    for (const op of operations) {
        switch (op.type) {
            case 'add': {
                const targetLine = baseLine + (op.originalIndex ?? 0);
                const existing = edits.find(e => e.line === targetLine);
                if (existing) {
                    existing.newText += '\n' + (op.newText ?? '');
                } else {
                    edits.push({ line: targetLine, newText: op.newText ?? '', type: 'add' });
                }
                break;
            }
            case 'delete': {
                edits.push({ line: baseLine + (op.originalIndex ?? 0), newText: '', type: 'delete' });
                break;
            }
            case 'change': {
                edits.push({ line: baseLine + (op.originalIndex ?? 0), newText: op.newText ?? '', type: 'change' });
                break;
            }
            default:
                break;
        }
    }
    return edits;
}

/**
 * Post-processing when terminated early by maxLines, converting trailing deletes to keeps.
 */
export function processMaxLinesDiffOperations(diffOperations: LineDiff[], origLines: string[]): LineDiff[] {
    const lastOrigIndex = origLines.length - 1;
    let filtered = diffOperations.filter(op => op.originalIndex === undefined || op.originalIndex < lastOrigIndex);

    // Convert consecutive deletes from the end to keeps
    for (let k = filtered.length - 1; k >= 0; k--) {
        if (filtered[k].type === 'delete') {
            filtered[k] = {
                type: 'keep',
                originalIndex: filtered[k].originalIndex,
                newIndex: filtered[k].originalIndex,
                originalText: filtered[k].originalText,
                newText: filtered[k].originalText,
            };
        } else {
            break;
        }
    }
    return filtered;
}

/**
 * Preprocesses LLM output text and formats it for difference calculation.
 */
export function preprocessLLMOutput(text: string): {
    cleaned: string;
    isStopedSymbol: boolean;
    isStopedExistingComment: boolean;
} {
    const config = getConfig();
    const startEditingHereSymbol = config.startEditingHereSymbol;
    const stopEditingHereSymbol = config.stopEditingHereSymbol;
    const completeHereSymbol = config.completeHereSymbol;

    let cleaned = text;

    // unwrap line number
    cleaned = withoutLineNumber(cleaned);

    // Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove everything before ###START_EDITING_HERE###
    cleaned = cleaned.replace(new RegExp(`^[\s\S]*${startEditingHereSymbol}`, 'g'), '');

    const isStopedSymbol = cleaned.includes(stopEditingHereSymbol);

    // Remove ###STOP_EDITING_HERE### lines (don't remove subsequent content)
    cleaned = cleaned.replace(new RegExp(`\n${stopEditingHereSymbol}`, 'g'), '');

    // Remove "... existing code ..." line and everything after it
    cleaned = cleaned.replace(new RegExp(`\n.*?\.\.\. existing code \.\.\.[\s\S]*`, 'g'), '');

    // Remove __COMPLETE_HERE__
    cleaned = cleaned.replace(completeHereSymbol, '');

    // Convert lines with only whitespace at the beginning to empty lines
    cleaned = cleaned.replace(/^\s+?\n/g, '\n');

    // last output is "... existing code ..."
    const isStopedExistingComment = cleaned.endsWith('... existing code ...');

    // Remove "// ... existing code"
    cleaned = cleaned.replace(new RegExp(`\n// \.\.\. existing code \.\.\.[\s\S]*`, 'g'), '');

    // Remove trailing newline
    if (cleaned.endsWith('\n')) {
        cleaned = cleaned.slice(0, -1);
    }

    return { cleaned: cleaned.trim() === '' ? '' : cleaned, isStopedSymbol, isStopedExistingComment };
}

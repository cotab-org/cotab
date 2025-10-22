import * as vscode from 'vscode';
import { computeCharDiff, CharDiffSegment } from '../diff/charDiff';

export function registerEditHistory(disposables: vscode.Disposable[]) {
    editHistoryManager = new EditHistoryManager();
    disposables.push(editHistoryManager);
}

// Represents a single edit operation
export interface EditOperation {
	type: 'add' | 'delete' | 'modify' | 'rename' | 'copy';
    
	// Text before editing
	sourceOriginalText: string;

	// Text before editing
	originalText: string;

	// Text after editing
	newText: string;

    // Range of edit
    range: vscode.Range;

    // Document being edited
    document: vscode.TextDocument;

	// Timestamp when edit occurred (ms)
	timestamp: number;
}

// Singleton instance
export let editHistoryManager: EditHistoryManager;

/**
 * Singleton that manages edit history & clipboard history
 */
class EditHistoryManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

	// Maximum number of edits to save
	private static readonly MAX_EDIT_HISTORY = 5;

    // Edit history
	private readonly edits: EditOperation[] = [];

    // Line cache manager
    private readonly lineCacheManager: LineCacheManager = new LineCacheManager();

    constructor() {
        // Update edit history
        this.disposables.push(vscode.workspace.onDidChangeTextDocument((evt: vscode.TextDocumentChangeEvent) => {
            const ops = inferEditOperation(evt);
            for (const op of ops) {
                this.addEdit(op);
            }
        }));
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

	/**
	 *  Add new edit
	 *  Merge with previous edit if needed, discard old ones when history limit is exceeded.
	 */
	addEdit(op: EditOperation) {

		let last = this.edits[this.edits.length - 1];

		if (last) {

            // Same text means likely reverted.
            if (op.originalText === op.newText) {
                // If original text of this line matches, it was reverted.
                if (last.sourceOriginalText === op.sourceOriginalText) {
                    this.edits.splice(this.edits.length - 1, 1);
                    return;
                }
            }

            // Merge if last.range and op.range overlap
            if (last.document.uri.toString() === op.document.uri.toString() &&
                last.range.start.line - 1 <= op.range.start.line &&
                op.range.end.line <= last.range.end.line + 1) {
                // Create new Range by taking min/max of start/end positions of last.range and op.range
                const start = last.range.start.isBefore(op.range.start) ? last.range.start : op.range.start;
                const end = last.range.end.isAfter(op.range.end) ? last.range.end : op.range.end;
                last.range = new vscode.Range(start, end);

                // Get merge range
                const readRange = new vscode.Range(
                    new vscode.Position(last.range.start.line, 0),
                    new vscode.Position(last.range.end.line, 99999)
                );

                // For delete operations, get original text from cache, new text is empty string
                let originalText: string;
                let newText: string;

                let isNewOperation = false;
                
                originalText = this.lineCacheManager.getCacheText(op.document, readRange).replace(/\r?\n/g, '\n').replace(/\n$/, '');
                newText = op.document.getText(readRange).replace(/\r?\n/g, '\n').replace(/\n$/, '');

                const segments = computeCharDiff(originalText, newText);
                let opType: 'add' | 'delete' | 'modify' | 'rename' | 'copy' = 'add';
                {
                    const filterdSegments = segments.filter(seg => seg.type !== 'keep');
                    if (1 < filterdSegments.length) {
                        opType = 'modify';
                    } else {
                        opType = (filterdSegments[0].type === 'add') ? 'add' : 'delete';
                    }
                }
                
                // For multiple lines, examine differences and count non-eq items
                if (readRange.start.line !== readRange.end.line) {

                    // Exclude segments with only whitespace
                    const filterdSegments = segments.filter(seg => seg.type !== 'keep' || seg.text.trim() !== '');

                    // Count edit segments
                    let diffCount = 0;
                    let prevSegment: CharDiffSegment | null = null;
                    for (const segment of filterdSegments) {
                        if (segment.type !== 'keep') {
                            // Don't count if consecutive
                            const isContinue = (prevSegment && prevSegment.type === segment.type);
                            if (!isContinue) {
                                diffCount++;
                            }
                        }
                        prevSegment = segment;
                    }
                    if (1 < diffCount) {
                        // Multiple sections separated, so this deletion is a separate item.
                        isNewOperation = true;
                    }
                }
                // New
                if (isNewOperation) {
                    // Ignore if no letters (English, Japanese, etc.) are included
                    if (/[\p{L}]/u.test(op.originalText) || /[\p{L}]/u.test(op.newText)) {
                        // Detect and apply rename
                        detectRenameAndApply(op);

                        this.edits.push(op);
                    }
                }
                // Merge
                else {
                    if (op.type !== 'copy') {
                        last.type = opType;
                        last.originalText = originalText;
                        last.newText = newText;

                        // Detect and apply rename
                        detectRenameAndApply(last);
                    } else {
                        last.newText = op.newText;
                    }
                    last.timestamp = op.timestamp; // Update final timestamp
                }
            } else {
                // Ignore if no letters (English, Japanese, etc.) are included
                if (/[\p{L}]/u.test(op.originalText) || /[\p{L}]/u.test(op.newText)) {
                    // Detect and apply rename
                    detectRenameAndApply(op);

                    this.edits.push(op);
                }
            }
		} else {
            // Same means newline was added at the beginning.
            if (op.originalText === op.newText) {
                return;
            }
            // Ignore if no letters (numbers, Japanese, etc.) are included
            if (/[\p{L}]/u.test(op.originalText) || /[\p{L}]/u.test(op.newText)) {

                // Detect and apply rename
                detectRenameAndApply(op);

			    this.edits.push(op);
            }
		}
        if (EditHistoryManager.MAX_EDIT_HISTORY < this.edits.length) {
            this.edits.shift(); // Remove from oldest
        }
	}

	getEdits(): Readonly<EditOperation[]> {
		return this.edits;
	}

	clearEdits() {
		this.edits.length = 0;
	}

    getCacheText(doc: vscode.TextDocument, range: vscode.Range): string {
        return this.lineCacheManager.getCacheText(doc, range);
    }

    adjustAddCacheLine(doc: vscode.TextDocument, addLine: number, text: string) {
        this.lineCacheManager.adjustAddCacheLine(doc, addLine, text);
    }

    adjustDelCacheLine(doc: vscode.TextDocument, range: vscode.Range) {
        this.lineCacheManager.adjustDelCacheLine(doc, range);
    }

    updateLineCache(doc: vscode.TextDocument,
        position: vscode.Position,
        startPosition: vscode.Position) {
        this.lineCacheManager.updateLineCache(doc, position, startPosition, this);
    }
}


/**
 * Class that manages cursor line text cache, storing it so that pre-edit text can be referenced
 */
class LineCacheManager {
    private lineCacheMap = new Map<string, Map<number, string>>();

    /**
     * Get text from cache
     */
    getCacheText(doc: vscode.TextDocument, range: vscode.Range): string {
        const cache = this.lineCacheMap.get(doc.uri.toString());
        if (!cache) {
            return '';
        }
        
        let text = '';
        for (let i = range.start.line; i <= range.end.line; i++) {
            if (range.start.line < i) {
                text += '\n';
            }
            text += cache.get(i) || '';
        }
        text = text.replace(/\r?\n/g, '\n');
        return text;
    }

    /**
     * Detect newlines and shift lines
     */
    adjustAddCacheLine(doc: vscode.TextDocument, addLine: number, text: string) {
        const cache = this.lineCacheMap.get(doc.uri.toString());
        if (!cache) {
            return;
        }

        const addLineCount = text.replace(/\r?\n/g, '\n').split('\n').length - 1;

        // Reduce line numbers after the line
        if (0 < addLineCount) {
            let newCache = new Map<number, string>();
            for(let [line, text] of cache) {
                if (addLine < line) {
                    line += addLineCount;
                }
                newCache.set(line, text);
            }
            this.lineCacheMap.set(doc.uri.toString(), newCache);
        }
    }

    /**
     * Adjust cache for deleted lines
     */
    adjustDelCacheLine(doc: vscode.TextDocument, range: vscode.Range) {
        const cache = this.lineCacheMap.get(doc.uri.toString());
        if (!cache) {
            return;
        }

        // Merge lines in deletion range and consolidate into first line
        for (let i = range.start.line + 1; i <= range.end.line; i++) {
            cache.set(range.start.line, (cache.get(range.start.line) || '') + '\n' + (cache.get(i) || ''));
            cache.delete(i);
        }

        // Reduce line numbers after deletion line
        const delLineNum = range.end.line - range.start.line;
        let newCache = new Map<number, string>();
        for(let [line, text] of cache) {
            if (range.start.line < line) {
                line -= delLineNum;
            }
            newCache.set(line, text);
        }
        this.lineCacheMap.set(doc.uri.toString(), newCache);
    }

    /**
     * Called when cursor moves, caches current line text
     */
    updateLineCache(doc: vscode.TextDocument,
        position: vscode.Position,
        startPosition: vscode.Position,
        editHistoryManager: EditHistoryManager) {
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') {
            return;
        }
        if (position.line < 0 || doc.lineCount <= position.line) {
            return;
        }

        // Compare position and startPosition to create Range in appropriate order
        let range: vscode.Range;
        if (position.isBefore(startPosition)) {
            // If position is smaller than startPosition, use position as start, startPosition as end
            range = new vscode.Range(position, startPosition);
        } else {
            // Normal case: use startPosition as start, position as end
            range = new vscode.Range(startPosition, position);
        }

        let cache = this.lineCacheMap.get(doc.uri.toString());
        if (!cache) {
            cache = new Map<number, string>();
            this.lineCacheMap.set(doc.uri.toString(), cache);
        }

        for(let i = range.start.line; i <= range.end.line; i++) {
            // Don't update baseline if recent edit is in same document and within that range
            const edits = editHistoryManager.getEdits();
            const latest = edits[edits.length - 1];
            if (latest && latest.document.uri.toString() === doc.uri.toString()) {
                if (latest.range.start.line <= i && i <= latest.range.end.line) {
                    continue;
                }
            }

            const lineText = doc.lineAt(i).text.replace(/\r?\n/g, '\n');
            cache.set(i, lineText);
        }
    }
}

//###########################################################################
// helper functions
//###########################################################################

/**
 * Extract one word that the specified index belongs to.
 * Here, word refers to "sequence of consecutive alphanumeric characters + underscores".
 *
 * Specifications:
 * - If idx is on whitespace, return left word (e.g., idx=3 in "ABC DEF" returns "ABC")
 * - If idx is at string end, return word that previous character belongs to
 * - If no word is found, return empty string
 */
function extractWordAtIndex(text: string, index: number): {word: string, start: number, end: number} {
	if (!text) {
		return {word: '', start: 0, end: 0};
	}

	// Range normalization
	if (index < 0) index = 0;
	if (text.length < index) index = text.length;

	// If exactly at end, use previous position as reference
	let i = index;
	if (i === text.length && 0 < i) {
		i -= 1;
	}

	const isWordChar = (ch: string) => /[A-Za-z0-9_]/u.test(ch);

	// If not on symbol, move left to find symbol character position
	while (0 <= i && !isWordChar(text[i])) {
		i -= 1;
	}
	if (i < 0) {
		return {word: '', start: 0, end: 0};
	}

	// Search left end
	let start = i;
	while (0 <= start - 1 && isWordChar(text[start - 1])) {
		start -= 1;
	}

	// Search right end
	let end = i;
	while (end + 1 < text.length && isWordChar(text[end + 1])) {
		end += 1;
	}

	return {
        word: text.slice(start, end + 1),
        start: start,
        end: end + 1
    };
}

/**
 * Detect and apply rename.
 * Returns false if no rename is found.
 */
function detectRenameAndApply(op: EditOperation): boolean {
    // Examine differences
    const segments = computeCharDiff(op.originalText, op.newText);

    // Ignore eq
    const filterdSegments = segments.filter(seg => seg.type !== 'keep');
    if (filterdSegments.length === 0) {
        return false;
    }

    const seg = filterdSegments[0];
    const {word: originalWord, start: originalStart, end: originalEnd} = extractWordAtIndex(op.originalText, seg.orgIdx);
    const {word: newWord, start: newStart, end: newEnd} = extractWordAtIndex(op.newText, seg.orgIdx);
    if (originalWord.trim() === '' || newWord.trim() === '') {
        return false;
    }

    if (op.originalText.slice(0, originalStart) !== op.newText.slice(0, newStart) ||
        op.originalText.slice(originalEnd) !== op.newText.slice(newEnd)) {
        return false;
    }

    // However, don't judge as rename for programmatic keywords.
    if (isCodeKeyword(originalWord) || isCodeKeyword(newWord)) {
        return false;
    }

    // Everything except the first word matches completely, so judge as rename
    op.type = 'rename';
    op.originalText = originalWord;
    op.newText = newWord;
    return true;
}

// Common programming language reserved word list
const codeKeywords = new Set([
    // JavaScript/TypeScript
    'abstract', 'arguments', 'await', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'double', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'final', 'finally', 'float', 'for', 'function', 'goto', 'if', 'implements', 'import', 'in', 'instanceof', 'int', 'interface', 'let', 'long', 'native', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'typeof', 'var', 'void', 'volatile', 'while', 'with', 'yield',
    
    // Python
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
    
    // Java
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
    
    // C/C++
    'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'int', 'long', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while',
    
    // C#
    'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params', 'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual', 'void', 'volatile', 'while',
    
    // PHP
    'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue', 'declare', 'default', 'die', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'eval', 'exit', 'extends', 'final', 'finally', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'require', 'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor',
    
    // Ruby
    'BEGIN', 'END', 'alias', 'and', 'begin', 'break', 'case', 'class', 'def', 'defined?', 'do', 'else', 'elsif', 'end', 'ensure', 'false', 'for', 'if', 'in', 'module', 'next', 'nil', 'not', 'or', 'redo', 'rescue', 'retry', 'return', 'self', 'super', 'then', 'true', 'undef', 'unless', 'until', 'when', 'while', 'yield',
    
    // Go
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
    
    // Rust
    'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
    
    // Swift
    'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while', 'as', 'Any', 'catch', 'false', 'is', 'nil', 'super', 'self', 'Self', 'throw', 'throws', 'true', 'try'
]);

function isCodeKeyword(word: string): boolean {
    return codeKeywords.has(word);
}

/**
 * Helper to infer EditOperation from VSCode TextDocumentChangeEvent
 */
function inferEditOperation(evt: vscode.TextDocumentChangeEvent): EditOperation[] {
    // Only target normal files or untitled, ignore Output etc.
    const scheme = evt.document.uri.scheme;
    if (scheme !== 'file' && scheme !== 'untitled') {
        return [];
    }

    // Also ignore if doesn't match current active editor
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (!activeDoc || activeDoc.uri.toString() !== evt.document.uri.toString()) {
        return [];
    }

	const result: EditOperation[] = [];
	const now = Date.now();
	for (const change of evt.contentChanges) {
        let range = change.range;

        // Determine if delete or insert operation
        let type: 'add' | 'delete' | 'rename' = 'add';
        if (change.text === '') {
            // If new text is empty string, it's a delete operation
            type = 'delete';
        }

        // For delete operations, get original text from cache
        let text = '';
        const originalText = editHistoryManager.getCacheText(evt.document, range);
        if (type === 'delete') {
            editHistoryManager.adjustDelCacheLine(evt.document, range);
            text = evt.document.lineAt(range.start.line).text;
            // And make range just the start line
            range = new vscode.Range(range.start, range.start);
        } else {
            editHistoryManager.adjustAddCacheLine(evt.document, range.start.line, change.text);
            for (let i = range.start.line; i <= range.end.line; i++) {
                text += evt.document.lineAt(i).text;
                if (range.start.line < i) {
                    text += '\n';
                }
            }
            text = text.replace(/\r?\n/g, '\n');
        }

        if (originalText !== text || 0 < text.length) {
            result.push({
                type,
                sourceOriginalText: originalText,
                originalText: originalText,
                newText: text,
                range,
                document: evt.document,
                timestamp: now
            });
        }
	}
	return result;
}

import * as vscode from 'vscode';
import { LineDiff } from '../diff/lineDiffUtils';
import { clearAcceptingSuggestion } from './suggestionCommands';

export interface LineEdit {
	line: number;
	newText: string;
	type: 'add' | 'delete' | 'change';
	
	editedLine?: number;
}

const store = new Map<string, {originalDiffOperations: LineDiff[], edits: LineEdit[], checkCompleteLine: number, is_stoped: boolean}>();

function toKey(uri: vscode.Uri | string): string {
	return typeof uri === 'string' ? uri : uri.toString();
}

export function setSuggestions(uri: vscode.Uri | string, originalDiffOperations: LineDiff[], edits: LineEdit[], checkCompleteLine: number, is_stoped: boolean): void {
	store.set(toKey(uri), {originalDiffOperations, edits, checkCompleteLine, is_stoped});
}

export function getSuggestions(uri: vscode.Uri | string): {originalDiffOperations: LineDiff[], edits: LineEdit[], checkCompleteLine: number, is_stoped: boolean} {
	return store.get(toKey(uri)) ?? {originalDiffOperations: [], edits: [], checkCompleteLine: -1, is_stoped: false};
}

export function getMergedSuggestions(uri: vscode.Uri | string, isFullAccept: boolean):
 {originalDiffOperations: LineDiff[], edits: Map<number, LineEdit[]>, checkCompleteLine: number, is_stoped: boolean} {
	// Group edits for the same line
	const lineGroups = new Map<number, LineEdit[]>();

	const data = getSuggestions(uri);
	for (const s of data.edits) {
		if (!lineGroups.has(s.line)) {
			lineGroups.set(s.line, []);
		}
		lineGroups.get(s.line)!.push(s);
		if (!isFullAccept) {
			break;
		}
	}

	return {originalDiffOperations: data.originalDiffOperations, edits: lineGroups, checkCompleteLine: data.checkCompleteLine, is_stoped: data.is_stoped};
}

// export function removeSuggestion(uri: vscode.Uri | string, line: number): void {
// 	const k = toKey(uri);
// 	const arr = store.get(k)?.edits;
// 	if (!arr) return;
// 	const idx = arr.findIndex(e => e.line === line);
// 	if (0 <= idx) {
// 		arr.splice(idx, 1);
// 		store.set(k, {originalDiffOperations: store.get(k)?.originalDiffOperations ?? [], edits: arr, checkCompleteLine: store.get(k)?.checkCompleteLine ?? -1, is_stoped: store.get(k)?.is_stoped ?? false});
// 	}
// }

// export function findSuggestion(uri: vscode.Uri | string, line: number): LineEdit[] | undefined {
// 	return getMergedSuggestions(uri).edits.get(line) ?? [];
// }

// export function nextSuggestion(uri: vscode.Uri | string, currentLine: number): LineEdit | undefined {
// 	const list = getSuggestions(uri).edits.slice().sort((a, b) => a.line - b.line);
// 	if (!list.length) return undefined;
// 	for (const e of list) {
// 		if (currentLine < e.line) return e;
// 	}
// 	return list[0]; // wrap around
// }

export function clearSuggestions(uri: vscode.Uri | string) {
	clearAcceptingSuggestion();
	
	const key = toKey(uri);
	
	// Do nothing if suggestions don't exist (suppresses unnecessary event chains)
	if (!store.has(key)) {
		return;
	}
	
	store.delete(key);
}

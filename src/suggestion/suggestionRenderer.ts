import * as vscode from 'vscode';
import { getMergedSuggestions, LineEdit } from './suggestionStore';
import { computeCharDiff } from '../diff/charDiff';
import { logInfo, logDebug } from '../utils/logger';
import { getVisualWidth } from './suggestionUtils';
import { isDarkTheme } from '../utils/cotabUtil';
import { renderSvgOverlays, clearSvgOverlays, disposeSvgDecorationTypes, OverlaySegment } from './suggestionSvgRenderer';

let renderTimer: NodeJS.Timeout | null = null;

const inlineDecorationTypeDark = vscode.window.createTextEditorDecorationType({
	after: { color: '#ffffffb5'/*, fontStyle: 'italic'*/, backgroundColor: '#eeff0022' },
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});
const inlineDecorationTypeLight = vscode.window.createTextEditorDecorationType({
	after: { color: '#000000b5'/*, fontStyle: 'italic'*/, backgroundColor: '#bbff0033' },
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

function getInlineDecorationType() {
	return isDarkTheme() ? inlineDecorationTypeDark : inlineDecorationTypeLight;
}

const deleteDecorationType = vscode.window.createTextEditorDecorationType({
	backgroundColor: '#ff000050',
	border: 'none'
});

function makeOverlaySuggestions(editor: vscode.TextEditor,
	suggestionList: LineEdit[],
	suggestionCount: number,
	isDispOverwrite: boolean
): {
	overlaySegments: OverlaySegment[],
	deleteOptions: vscode.DecorationOptions[],
	invisibleOptions: vscode.DecorationOptions[],
} {
	const tabSize = (editor.options.tabSize as number) ?? 4;
	const overlaySegments: OverlaySegment[] = [];
	const deleteOptions: vscode.DecorationOptions[] = [];
	const invisibleOptions: vscode.DecorationOptions[] = [];
	const getVisualWidthHelper = (text: string) => getVisualWidth(text, tabSize, 0);
	
	// Calculate maximum character count (based on display width)
	let dispMaxWidth = -1;
	let dispMinLeftSpaceWidth = -1;
	for (let j = suggestionCount; j < suggestionList.length; j++) {
		const suggestion = suggestionList[j];
		const line = suggestion.editedLine ?? suggestion.line;

		const newText = suggestion.newText.replace(/ /g, '\u00A0');
		const {newText: visualText, width: visualWidth} = getVisualWidthHelper(newText);
		dispMaxWidth = Math.max(dispMaxWidth, visualWidth);

		// Calculate number of spaces from beginning
		const leftSpaceWidth = visualText.match(/^\s*/)?.[0]?.length ?? 0;
		dispMinLeftSpaceWidth = (0 <= dispMinLeftSpaceWidth) ? Math.min(dispMinLeftSpaceWidth, leftSpaceWidth) : leftSpaceWidth;
	}
	
	dispMaxWidth -= dispMinLeftSpaceWidth;
	
	// Maximum character count at edit location (display to the right of this longest line)
	let visualOrgMaxWidth = 0;
	if (! isDispOverwrite)
	{
		for (let j = suggestionCount; j < suggestionList.length; j++) {
			const suggestion = suggestionList[j];

			// If it's an addition, it doesn't affect existing lines, so it's not relevant.
			if (suggestion.type === 'add') continue;

			const line = suggestion.line;
			if (line < 0 || editor.document.lineCount <= line) continue;

			const lineText = editor.document.lineAt(line).text.replace(/ /g, '\u00A0');
			const visualWidth = getVisualWidthHelper(lineText).width;
			if (visualOrgMaxWidth < visualWidth) {
				visualOrgMaxWidth = visualWidth;
			}
		}
	}
	let visualDispPos = (visualOrgMaxWidth == 0) ? visualOrgMaxWidth : visualOrgMaxWidth + 1;	// Display to the right of longest line
	visualDispPos += (tabSize - (visualDispPos % tabSize)) % tabSize;	// Consider tab stops

	for (;suggestionCount < suggestionList.length; suggestionCount++) {
		const suggestion = suggestionList[suggestionCount];
		const line = suggestion.editedLine ?? suggestion.line;
		if (line < 0 || editor.document.lineCount <= line) continue;

		const origLine = editor.document.lineAt(line).text.replace(/ /g, '\u00A0');
		const origeditLine = editor.document.lineAt(suggestion.line).text.replace(/ /g, '\u00A0');
		const newLine = suggestion.newText.replace(/ /g, '\u00A0');
		const {newText: visualOrgTextWithSpace, width: visualOrigLineWidth} = getVisualWidthHelper(origLine);
		const visualOrgText = visualOrgTextWithSpace.slice(dispMinLeftSpaceWidth);
		const visualInsWidth = Math.min(visualDispPos, visualOrigLineWidth);
		let insIdx = 0;
		let visualInsIdx = 0;
		for (let i = 0; i <= origLine.length; i++) {
			insIdx = i;
			visualInsIdx = getVisualWidthHelper(origLine.slice(0, i)).width;
			if (visualInsWidth <= visualInsIdx) {
				break;
			}
		}

		// Remove common leading whitespace.
		const {newText: visualNewTextWithSpace, width: visualWidthWithSpace} = getVisualWidthHelper(newLine);
		const visualNewText = visualNewTextWithSpace.slice(dispMinLeftSpaceWidth);
		const visualWidth = visualWidthWithSpace - dispMinLeftSpaceWidth;
		const range = new vscode.Range(line, insIdx, line, insIdx);
		// Remove leading whitespace and put the count of that whitespace in paddingLeft.
		const paddingLeft = visualNewText.match(/^\s*/)?.[0]?.length ?? 0;
		const paddingRight = dispMaxWidth - visualWidth;
		const marginLeft = visualDispPos - visualInsIdx;
		const decolateText = visualNewText.slice(paddingLeft);
		
		// Build overlay segment for SVG renderer
		const overlaySegment: OverlaySegment = {
			line: line,
			column: insIdx,
			text: decolateText,
			paddingLeftCh: paddingLeft,
			paddingRightCh: paddingRight,
			marginLeftCh: Math.max(dispMinLeftSpaceWidth, visualDispPos),
			visualDiffSegments: []
		};
		
		if (insIdx < origLine.length)
		{
			invisibleOptions.push({
				range: new vscode.Range(line, insIdx, line, insIdx + origLine.length),
			});
		}

		// If it's an addition, it doesn't affect existing lines, so it's not relevant.
		if (suggestion.type !== 'add')
		{
			// highlight delete char
			const charDiffSegments = computeCharDiff(origeditLine, newLine);
			for (const seg of charDiffSegments)
			{
				if (seg.type === 'delete') {
					deleteOptions.push({range: new vscode.Range(suggestion.line, seg.orgIdx, suggestion.line, seg.orgIdx + (seg.delete ?? 0))});
				}
			}
			overlaySegment.visualDiffSegments = computeCharDiff(visualOrgText, visualNewText);
		}
		else
		{
			overlaySegment.visualDiffSegments = computeCharDiff('', visualNewText);
		}
		overlaySegments.push(overlaySegment);
	}
	return {overlaySegments, deleteOptions, invisibleOptions};
}

interface RenderData {
	inlineCompletionItems: vscode.InlineCompletionItem[];
	inlineOptions: vscode.DecorationOptions[],
	overlaySegments: OverlaySegment[],
	deleteOptions: vscode.DecorationOptions[],
	invisibleOptions: vscode.DecorationOptions[],

	noFinished: boolean;

	// option
	isNoHighligh: boolean;
};

let prevRenderData: RenderData;

export function renderSuggestions(editor: vscode.TextEditor): {
	inlineCompletionItems: vscode.InlineCompletionItem[],
	isCompletedFirstLine: boolean
} {
	const mergedData = getMergedSuggestions(editor.document.uri, true);
	const activeEditor = vscode.window.activeTextEditor;
	const activeLine = activeEditor?.selection.active.line ?? -1;
	const activeCharacter = activeEditor?.selection.active.character ?? 0;
	const renderData: RenderData = {
		inlineCompletionItems: [],
		inlineOptions: [],
		overlaySegments: [],
		invisibleOptions: [],
		deleteOptions: [],
		noFinished: false,
		isNoHighligh: mergedData.isNoHighligh,
	};

	// test
	//let segs = computeInsertSegmentsForLine("   UE_LOG(,,,);t", "   UE_LOG(ab,cd,ef); // comment");

	let appendLineNum = 0;
	let suggestionList: LineEdit[] = [];
	for (const [line, suggestions] of mergedData.edits) {
		for (let i = 0; i < suggestions.length; i++)
		{
			const suggestion = suggestions[i];
			const lines = suggestion.newText.split('\n')
			if (i != 0)
			{
				appendLineNum++;
			}
			for (let j = 0; j < lines.length; j++)
			{
				if (j != 0)
				{
					appendLineNum++;
				}
				const line = lines[j];
				suggestionList.push({
					line: suggestion.line,
					newText: line,
					type: suggestion.type,
					editedLine: suggestion.line + appendLineNum
				});
			}
		}
	}

	const isOnlyCursorLine = 0 <= mergedData.checkCompleteLine;
	let isCompletedFirstLine = false;
	let isOverlay = false;
	let completedCursorLine = false;
	let isDispOverlay = false;
	
	let suggestionCount = 0;
	for (suggestionCount = 0; suggestionCount < suggestionList.length; suggestionCount++) {
		const suggestion = suggestionList[suggestionCount];
		const line = suggestion.editedLine ?? suggestion.line;
		if (line < 0 || editor.document.lineCount <= line) continue;
//		if (isOnlyCursorLine && isCompletedFirstLine) break;	// End because cursor line is already complete.

		// If editing location is single line and single process, use inline decoration display
		// Once overlay is determined, always use overlay display thereafter
		if (!isOverlay && suggestion.line === suggestion.editedLine) {
			let prevType = '';
			if (suggestion.type === 'add') {
				prevType = 'add'
			}
			else {
				const origLine = editor.document.lineAt(suggestion.line).text;
				const segs = computeCharDiff(origLine, suggestion.newText);
				for (const seg of segs)
				{
					if (seg.type === 'keep') continue;
					if (prevType === '') {
						prevType = seg.type;
					}
					else if (seg.type !== prevType) {
						isOverlay = true;
						break;
					}
				}
			}

				// First difference after cursor
			if (mergedData.checkCompleteLine <= line && prevType !== '') {
				// If there are lines after the output.
				const existNext = mergedData.originalDiffOperations.find(
									d => d.type !== 'delete' &&
									d.originalIndex !== undefined &&
									line < d.originalIndex);
				//if (existNext)
				{
					isCompletedFirstLine = true;
				}
			}
		}
		if (!isOverlay && suggestion.line === suggestion.editedLine &&
			suggestion.line !== activeLine &&
			suggestion.type === 'add') {
			isOverlay = true;
		}
		if (!isOverlay && suggestion.line === suggestion.editedLine) {
			if (mergedData.isForceOverlay) {
				isDispOverlay = true;
			}
			else {
				const origLine = editor.document.lineAt(suggestion.line).text;
				const segs = computeCharDiff(origLine, suggestion.newText);
				
				let isInlineCompletionItem = false;
				if (suggestion.line === activeLine) {
					isInlineCompletionItem = true;

					// VS Code inline completion only works when there is a single add at one location
					let hasAdd = false;
					let firstAddPos = 0;
					for (const seg of segs) {
						if (seg.type === 'keep') continue;
						if (seg.type === 'add') {
							if (hasAdd) {
								isInlineCompletionItem = false;
								break;
							}
							else {
								hasAdd = true;
								firstAddPos = seg.orgIdx;
							}
						}
						else {
							isInlineCompletionItem = false;
							break;
						}
					}
					if (isInlineCompletionItem) {
						if (firstAddPos != 0) {
							// VSCode's default inline completion only works after the cursor position.
							if (firstAddPos < activeCharacter) {
								isInlineCompletionItem = false;
							}
							// Enable inline completion when completion position is at the end of the line
							else if (firstAddPos == origLine.length) {
								// nop
							}
							// Disable inline completion if the cursor is before the insertion point
							// Because VSCode's default inline completion changes text color but not background color, which reduces readability.
							else if (activeCharacter < firstAddPos) {
								isInlineCompletionItem = false;
							}
						}
					}
				}
				if (isInlineCompletionItem) {
					renderData.inlineCompletionItems.push(new vscode.InlineCompletionItem(suggestion.newText,
						new vscode.Range(line, 0, line, suggestion.newText.length)
					));
				}
				else {
					// if exist nextline(becouse now line completed for llm output)
					//if (suggestionCount + 1 < suggestionList.length)
					{
						for (const seg of segs)
						{
							if (seg.type === 'add') {
								renderData.inlineOptions.push({range : new vscode.Range(line, seg.orgIdx, line, seg.orgIdx),
									renderOptions: { after: { contentText: seg.text } },
								});
							} else if (seg.type === 'delete') {
								renderData.deleteOptions.push({range: new vscode.Range(line, seg.orgIdx, line, seg.orgIdx + (seg.delete ?? 0))});
							}
						}
					}
				}
			}

			// Only the first one inline.
			isOverlay = true;
			completedCursorLine = true;
		} else {
			if (! isCompletedFirstLine && !completedCursorLine) {
				break;
			}

			// Separated into another function because it was long.
			isDispOverlay = true;
			break;
		}
	}

	if (isDispOverlay)
	{
		// If cut in the middle, only the first line
		if (!mergedData.isStopped)
		{
			if (suggestionCount == 0) {
				suggestionList = suggestionList.slice(0, 1);
			} else {
				isDispOverlay = false;
			}
		}
	}
	if (isDispOverlay)
	{
		// If the first line is included in the overlay suggestion, reset suggestion count to 0
		if (mergedData.isForceOverlay) {
			suggestionCount = 0;
		}
		
		const {overlaySegments: overlaysSegs,
				deleteOptions: deletes,
				invisibleOptions: invisibles} = makeOverlaySuggestions(editor, suggestionList, suggestionCount, mergedData.isDispOverwrite);
		renderData.overlaySegments.push(...overlaysSegs);
		renderData.deleteOptions.push(...deletes);
		renderData.invisibleOptions.push(...invisibles);
	}

	// Don't show inline suggestions if not completed.
	if (!isCompletedFirstLine) {
		renderData.inlineOptions.length = 0;
		renderData.overlaySegments.length = 0;
		renderData.deleteOptions.length = 0;
		renderData.invisibleOptions.length = 0;
		renderData.inlineCompletionItems.length = 0;
	}
	renderData.noFinished = isOnlyCursorLine;
	renderSuggestionsInternal(editor, renderData);
	prevRenderData = renderData;
	
	return {inlineCompletionItems:renderData.inlineCompletionItems, isCompletedFirstLine};
}

export function reRenderSuggestions(editor: vscode.TextEditor,
					dispIdx: number = 0)
{
	renderSuggestionsInternal(editor, prevRenderData, dispIdx);
}

function renderSuggestionsInternal(editor: vscode.TextEditor,
					renderData: RenderData,
					dispIdx: number = 0) {
	
			// Execute decoration settings asynchronously (prevent infinite loops)
	renderTimer = setTimeout(() => {
		renderTimer = null;
		//logDebug(`updateDecorations: ${renderData.inlineCompletionItems.length} ${renderData.inlineOptions.length} ${renderData.deleteOptions.length} ${renderData.invisibleOptions.length}`);
		editor.setDecorations(getInlineDecorationType(), renderData.inlineOptions);

		renderSvgOverlays(editor, renderData.overlaySegments, { unfinished: renderData.noFinished, dispIdx, isNoHighligh: renderData.isNoHighligh });
		editor.setDecorations(deleteDecorationType, renderData.deleteOptions);
		
		//logDebug('cotab.dispSuggestions true');
		const hasSuggestions =
			(renderData.inlineOptions.length + renderData.deleteOptions.length + renderData.invisibleOptions.length) > 0
			|| renderData.overlaySegments.length > 0
			|| renderData.inlineCompletionItems.length > 0;
		vscode.commands.executeCommand('setContext', 'cotab.dispSuggestions', hasSuggestions);
	}, 0);
}

export function disposeDecorationTypes() {
	inlineDecorationTypeDark.dispose();
	inlineDecorationTypeLight.dispose();
	deleteDecorationType.dispose();
	disposeSvgDecorationTypes();
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}
}

	// Clear all decorations immediately and reset context
export function clearAllDecorations(editor: vscode.TextEditor) {
	//console.log('clearAllDecorations called for:', editor.document.uri.toString());
	
	// Clear each decoration type with empty arrays
	editor.setDecorations(inlineDecorationTypeDark, []);
	editor.setDecorations(inlineDecorationTypeLight, []);
	editor.setDecorations(deleteDecorationType, []);
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}
	clearSvgOverlays(editor);
	
	// Also disable context
	//logDebug('cotab.dispSuggestions false');
	vscode.commands.executeCommand('setContext', 'cotab.dispSuggestions', false);
}



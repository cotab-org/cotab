import { EditorContext } from '../utils/editorContext';
import { getConfig } from '../utils/config';
import { logDebug } from '../utils/logger';
import { withLineNumberCodeBlock } from './llmUtils';
import { getYamlConfigMode, YamlConfigMode } from '../utils/yamlConfig';
import { parseHandlebarsTemplate } from '../utils/cotabUtil';
import { CodeBlocks, EditHistoryAction, makeYamlFromEditHistoryActions } from '../llm/codeBlockBuilder';
import { beforeTruncatedText, afterTruncatedText } from '../managers/largeFileManager'

// Prompt cache type definition
interface PromptCache {
	aroundFromLine: number;
	aroundToLine: number;
	inputCode: string;
	inputCodeStartLine: number;
	inputCodeValidLen: number; // size is trancate code if over context size
	timestamp: number;
}

// Prompt cache (per document URI)
const promptCache = new Map<string, PromptCache>();
const CACHE_DURATION = 5 * 60 * 1000; // Cache for 5 minutes

// Prompt cache for cursor line position
interface CursorLineCache {
	documentUri: string;
	cursorLine: number;
	text: string;
};

let cursorLineCache: CursorLineCache | undefined = undefined;

// Function to get inputCode from cache
function getCachedInputCodeInternal(
	documentUri: string,
	cursorLine: number,
	sourceCodeValidLen: number
): PromptCache | null {
	const cached = promptCache.get(documentUri);
	if (!cached) {
		logDebug(`Cache miss: Cache doesn't exist (${documentUri})`);
		return null;
	}
	
	// Check cache expiration
	const now = Date.now();
	if (CACHE_DURATION < now - cached.timestamp) {
		logDebug(`Cache miss: Expired (${documentUri})`);
		promptCache.delete(documentUri);
		return null;
	}
	
	// Check if cursor is within aroundRange
	if (cursorLine < cached.aroundFromLine || cached.aroundToLine < cursorLine) {
		logDebug(`Cache miss: Cursor is outside aroundRange (${documentUri}, cursor: ${cursorLine}, range: ${cached.aroundFromLine}-${cached.aroundToLine})`);
		return null;
	}

	// Check equal sourceCodeValidLen
	if (sourceCodeValidLen !== cached.inputCodeValidLen) {
		logDebug(`Cache miss: Invalid len (${sourceCodeValidLen} !== ${cached.inputCodeValidLen})`);
		promptCache.delete(documentUri);
		return null;
	}
	
	logDebug(`Cache hit: Got inputCode from cache (${documentUri})`);
	return cached;
}

// Function to save inputCode to cache
function cacheInputCode(
	documentUri: string,
	aroundFromLine: number,
	aroundToLine: number,
	inputCode: string,
	inputCodeStartLine: number,
	inputCodeValidLen: number,
): void {
	promptCache.set(documentUri, {
		aroundFromLine,
		aroundToLine,
		inputCode,
		inputCodeStartLine,
		inputCodeValidLen,
		timestamp: Date.now()
	});
	logDebug(`Saved inputCode to cache (${documentUri})`);
}

// Function to insert placeholder at cursor position and return 4 texts: before/after cursor line, previous line, next line
function insertCursorHere(
	aroundSnippet: string,
	cursorLine: number,
	cursorCharacter: number,
	startLine: number,
	placeholder: string
): { aroundSnippetWithPlaceholder: string;
	beforePlaceholderWithLF: string;
	cursorLineBefore: string;
	cursorLineAfter: string;
	afterPlaceholder: string } {
	const aroundSnippetWithPlaceholder = aroundSnippet.split('\n');
	const cursorIndex = cursorLine - startLine;
	let beforePlaceholderWithLF = '';
	let cursorLineBefore = '';
	let cursorLineAfter = '';
	let afterPlaceholder = '';
	
	if (0 <= cursorIndex && cursorIndex < aroundSnippetWithPlaceholder.length) {
		const line = aroundSnippetWithPlaceholder[cursorIndex];
		const beforeCursor = line.slice(0, cursorCharacter);
		const afterCursor = line.slice(cursorCharacter);
		aroundSnippetWithPlaceholder[cursorIndex] = beforeCursor + placeholder + afterCursor;

		// Get lines before cursor
		if (0 < cursorIndex) {
			const linesBefore = aroundSnippetWithPlaceholder.slice(0, cursorIndex);
			beforePlaceholderWithLF = linesBefore.join('\n') + '\n';
		}
		
		// Separate before/after cursor line
		cursorLineBefore = beforeCursor;
		cursorLineAfter = afterCursor;
		
		// Get lines after cursor
		const linesAfter = aroundSnippetWithPlaceholder.slice(cursorIndex + 1);
		afterPlaceholder = linesAfter.join('\n');
	}
	
	return {
		aroundSnippetWithPlaceholder: aroundSnippetWithPlaceholder.join('\n'),
		beforePlaceholderWithLF,
		afterPlaceholder,
		cursorLineBefore,
		cursorLineAfter,
	};
}

function getCachedSourceCode(documentUri: string | undefined,
	editorContext: EditorContext,
	startEditingHere?: string,
	stopEditingHere?: string
): {
		sourceCode: string[];	// latest original
		cachedSourceCode: string;	// cached
		startPosition: number;
		cachedStartPosition: number;
		latestBeforeOutsideLines: string[];
		latestAroundSnippetLines: string[];
		latestAfterOutsideLines: string[];
		latestFirstLineCode: string;
	} {
	let cachedSourceCode = '';
	let cachedSourceCodeStartPosition = 0;

	const {
		sourceCode,
		trancatedSourceCode,
		sourceCodeStartLine,
		sourceCodeValidLen,
		latestBeforeOutsideLines,
		latestAroundSnippetLines,
		latestAfterOutsideLines,
		latestFirstLineCode
	} = editorContext.getSurroundingCodeBlocks();

	const find = documentUri ? getCachedInputCodeInternal(documentUri,
										editorContext.cursorLine,
										sourceCodeValidLen) : null;
	if (find) {
		cachedSourceCode = find.inputCode;
		cachedSourceCodeStartPosition = find.inputCodeStartLine;
	}
	else {
		// Source code without cursor snippet
		const beforeOutside = trancatedSourceCode.slice(0, editorContext.aroundCacheFromLine - sourceCodeStartLine).join('\n');
		const aroundSnippet = trancatedSourceCode.slice(editorContext.aroundCacheFromLine - sourceCodeStartLine, editorContext.aroundCacheToLine - sourceCodeStartLine).join('\n');
		const afterOutside = trancatedSourceCode.slice(editorContext.aroundCacheToLine - sourceCodeStartLine).join('\n');
		const startSymbol = (startEditingHere)?('\n' + startEditingHere) : ''
		const stopSymbol = (stopEditingHere)?('\n' + stopEditingHere) : '';
		const inputCode =
`${beforeOutside}${startSymbol}
${aroundSnippet}${stopSymbol}
${afterOutside}`
		if (documentUri) {
			cacheInputCode(documentUri,
							editorContext.aroundCacheFromLine,
							editorContext.aroundCacheToLine,
							inputCode,
							sourceCodeStartLine,
							sourceCodeValidLen);
		}
		cachedSourceCode = inputCode;
		cachedSourceCodeStartPosition = sourceCodeStartLine;
	}
	return {
		sourceCode,
		cachedSourceCode,
		startPosition: sourceCodeStartLine,
		cachedStartPosition: cachedSourceCodeStartPosition,
		latestBeforeOutsideLines,
		latestAroundSnippetLines,
		latestAfterOutsideLines,
		latestFirstLineCode
	};
}

export function buildCompletionPrompts(editorContext: EditorContext,
	codeBlocks: CodeBlocks,
	documentUri?: string): {
		systemPrompt: string;
		userPrompt: string;
		assistantPrompt: string;
		beforePlaceholderWithLF: string;
		yamlConfigMode: YamlConfigMode;
		handlebarsContext: any;
	} {
	const config = getConfig();
	let placeholder = config.completeHereSymbol;
	const startEditingHereSymbol = config.startEditingHereSymbol;
	const stopEditingHereSymbol = config.stopEditingHereSymbol;

	// Get YAML configuration
	const yamlConfigMode = getYamlConfigMode(editorContext.relativePath);
	const cursorAlwaysHead = yamlConfigMode.cursorAlwaysHead !== undefined ? yamlConfigMode.cursorAlwaysHead : false;
	placeholder = (yamlConfigMode.placeholderSymbol !== undefined) ? yamlConfigMode.placeholderSymbol : placeholder;
	const systemPrompt = yamlConfigMode.systemPrompt || '';
	const userPrompt = yamlConfigMode.userPrompt || '';
	const assistantPrompt = yamlConfigMode.assistantPrompt || '';
	const appendThinkPromptNewScope = yamlConfigMode.appendThinkPromptNewScope || '';
	const appendThinkPromptRefactoring = yamlConfigMode.appendThinkPromptRefactoring || '';
	const appendThinkPromptAddition = yamlConfigMode.appendThinkPromptAddition || '';
	const appendThinkPromptReject = yamlConfigMode.appendThinkPromptReject || '';
	const appendThinkPromptError = yamlConfigMode.appendThinkPromptError || '';
	const appendOutputPromptReject = yamlConfigMode.appendOutputPromptReject || '';

	// Code blocks & Latest surrounding code blocks & Cached source code
	const {
		sourceCode,
		cachedSourceCode,
		startPosition,
		cachedStartPosition,
		latestBeforeOutsideLines,
		latestAroundSnippetLines,
		latestAfterOutsideLines,
		latestFirstLineCode
	} = getCachedSourceCode(documentUri, editorContext,
							yamlConfigMode.isNoInsertStartStopSymbol ? undefined : startEditingHereSymbol,
							yamlConfigMode.isNoInsertStartStopSymbol ? undefined : stopEditingHereSymbol);
	const cachedSourceCodeWithLine = withLineNumberCodeBlock(
										cachedSourceCode,
										cachedStartPosition,
										[
											{ key: startEditingHereSymbol },
											{ key: stopEditingHereSymbol },
											{ key: beforeTruncatedText, isAddSpace: true },
											{ key: afterTruncatedText, isAddSpace: true },
										]
									).CodeBlock;
//===============================================
const sourceCodeBlock =
//===============================================
`\`\`\`${editorContext.languageId} title=${editorContext.relativePath}
${cachedSourceCodeWithLine}
\`\`\``
//===============================================
	
	// Extract last 5 lines of beforeOutside
	const latestBeforeOutsideLast = latestBeforeOutsideLines.slice(-editorContext.aroundLatestAddBeforeLines).join('\n');
	const latestAfterOutsideFirst = latestAfterOutsideLines.slice(0, editorContext.aroundLatestAddAfterLines).join('\n');
	const {
		CodeBlock: latestBeforeOutsideLastWithLine,
		LastLineNumber: latestBeforeOutsideLastWithLineNumber
	} = withLineNumberCodeBlock(latestBeforeOutsideLast, editorContext.aroundFromLine-editorContext.aroundLatestAddBeforeLines);
	const latestAfterOutsideFirstWithLine = withLineNumberCodeBlock(latestAfterOutsideFirst, editorContext.aroundToLine).CodeBlock;
	
	// Insert placeholder at cursor position
	let { aroundSnippetWithPlaceholder,
		beforePlaceholderWithLF,
		cursorLineBefore,
		cursorLineAfter,
		afterPlaceholder
	} = insertCursorHere(latestAroundSnippetLines.join('\n'),
						editorContext.cursorLine, (cursorAlwaysHead) ? 0 :editorContext.cursorCharacter, editorContext.aroundFromLine,
						placeholder);
	const aroundSnippetWithPlaceholderWithLine = withLineNumberCodeBlock(aroundSnippetWithPlaceholder, editorContext.aroundFromLine).CodeBlock;
	let aroundSnippetWithPlaceholderWithLineWithCache = aroundSnippetWithPlaceholderWithLine;
	let latestCursorLineText = '';
	
	// Whether to make code up to cursor position column already output to Assistant
	// Note: Can guarantee characters before cursor but can't complete at positions before cursor.
	const orgCursorLineBefore = cursorLineBefore;
	const outputedCursorLineBefore = false;
	if (!outputedCursorLineBefore) {
		cursorLineBefore = '';
	}

	// addend LineNumber Text
	if (config.withLineNumber) {
		cursorLineBefore = `${latestBeforeOutsideLastWithLineNumber+1}|${cursorLineBefore}`;
	}

	//###########################
	// latest source code block
	//###########################
	// apply cursor line cache
	{
		const tmpLines = aroundSnippetWithPlaceholderWithLine.split('\n')
		const tmpCursorIdx = editorContext.cursorLine - editorContext.aroundFromLine;
		latestCursorLineText = tmpLines[tmpCursorIdx];

		// check valid cursor line cache
		if (cursorLineCache) {
			if (cursorLineCache.documentUri !== editorContext.documentUri ||
				cursorLineCache.cursorLine !== editorContext.cursorLine) {
				cursorLineCache = undefined;
			}
		}

		if (cursorLineCache) {
			tmpLines[tmpCursorIdx] = cursorLineCache.text;
			aroundSnippetWithPlaceholderWithLineWithCache = tmpLines.join('\n');
		} else {
			cursorLineCache = {
				documentUri: editorContext.documentUri,
				cursorLine: editorContext.cursorLine,
				text: latestCursorLineText
			};
		}
	}
//===============================================
const latestSourceCode =
//===============================================
`
// ... existing code ...

${latestBeforeOutsideLastWithLine}${(yamlConfigMode.isNoInsertStartStopSymbolLatest) ? '' : ('\n'+startEditingHereSymbol)}
${aroundSnippetWithPlaceholderWithLine}${(yamlConfigMode.isNoInsertStartStopSymbolLatest) ? '' : ('\n'+stopEditingHereSymbol)}
${latestAfterOutsideFirstWithLine}

// ... existing code ...
`;
//===============================================

//===============================================
const latestSourceCodeBlock =
//===============================================
`\`\`\`${editorContext.languageId} title=${editorContext.relativePath}
${latestSourceCode}
\`\`\``;
//===============================================

//===============================================
const latestSourceCodeWithCache =
//===============================================
`
// ... existing code ...

${latestBeforeOutsideLastWithLine}${(yamlConfigMode.isNoInsertStartStopSymbolLatest) ? '' : ('\n'+startEditingHereSymbol)}
${aroundSnippetWithPlaceholderWithLineWithCache}${(yamlConfigMode.isNoInsertStartStopSymbolLatest) ? '' : ('\n'+stopEditingHereSymbol)}
${latestAfterOutsideFirstWithLine}

// ... existing code ...
`;
//===============================================

//===============================================
const latestSourceCodeBlockWithCache =
//===============================================
`\`\`\`${editorContext.languageId} title=${editorContext.relativePath}
${latestSourceCodeWithCache}
\`\`\``;
//===============================================

//===============================================
const assistantSourceCodeBlockBforeCursor = 
//===============================================
`\`\`\`${editorContext.languageId} title=${editorContext.relativePath}

// ... existing code ...

${latestBeforeOutsideLastWithLine}${(yamlConfigMode.isNoInsertStartStopSymbolLatest) ? '' : ('\n'+startEditingHereSymbol)}
${cursorLineBefore}`;
//===============================================


	let lastAction = '';
	let lastActionWithoutReject = '';
	let rejectContent = '';
	if (codeBlocks.editHistoryActions && 0 < codeBlocks.editHistoryActions.length) {
		lastAction = codeBlocks.editHistoryActions[codeBlocks.editHistoryActions.length - 1].action;
		for (let i = codeBlocks.editHistoryActions.length - 1; i >= 0; i--) {
			const action = codeBlocks.editHistoryActions[i];
			if (action.action === 'reject') {
				if (action.content) {
					let line = '';
					if (action.lines && 0 < action.lines.length) {
						line = `${action.lines[0]}|`;
					}
					if (rejectContent !== '') {
						rejectContent += '\n';
					}
					rejectContent += line + action.content;
				}
			}
			else {
				lastActionWithoutReject = action.action;
				break;
			}
		}
	}
	
	// Create Handlebars context
	let handlebarsContext = {
		// Basic information
		"languageId": editorContext.languageId,
		"relativePath": editorContext.relativePath,
		"placeholder": placeholder,
		"startEditingHere": startEditingHereSymbol,
		"stopEditingHere": stopEditingHereSymbol,
		"commentLanguage": config.commentLanguage,
		
		// Code blocks
		"sourceCodeBlock": sourceCodeBlock,
		"symbolCodeBlock": codeBlocks.symbolCodeBlock,
		"editHistoryCodeBlock": makeYamlFromEditHistoryActions(codeBlocks.editHistoryActions),
		"oldEditHistoryCodeBlock": makeYamlFromEditHistoryActions(codeBlocks.editHistoryActions.slice(0, -1)),
		"lastEditHistoryCodeBlock": makeYamlFromEditHistoryActions(codeBlocks.editHistoryActions.slice(-1)),
		"sourceAnalysis": codeBlocks.sourceAnalysis,
		"latestSourceCodeBlock": latestSourceCodeBlock,
		"latestSourceCodeBlockWithCache": latestSourceCodeBlockWithCache,
		"latestCursorLineText": latestCursorLineText,
		"aroundSnippetWithPlaceholderWithLine": aroundSnippetWithPlaceholderWithLine,
		"latestAfterOutsideFirstWithLine": latestAfterOutsideFirstWithLine,
		"assistantSourceCodeBlockBforeCursor": assistantSourceCodeBlockBforeCursor,
		"cursorLineBefore": orgCursorLineBefore,
		"cursorLineBeforeWithLine": cursorLineBefore,
		"firstLineCode": latestFirstLineCode,
		
		// Additional prompts
		"additionalSystemPrompt": config.additionalSystemPrompt ? '\n' + config.additionalSystemPrompt : '',
		"additionalUserPrompt": config.additionalUserPrompt ? '\n' + config.additionalUserPrompt : '',
		"additionalAssistantThinkPrompt": config.additionalAssistantThinkPrompt ? '\n' + config.additionalAssistantThinkPrompt : '',
		"additionalAssistantOutputPrompt": config.additionalAssistantOutputPrompt ? '\n' + config.additionalAssistantOutputPrompt : '',
		
		// Thinking prompt
		"thinkErrorPrompt": "",
		"appendThinkPrompt": "",
		"rejectContent": rejectContent,
		"errorCodeBlock": codeBlocks.diagnosticsCodeBlock,

		// Output
		"appendOutputPrompt": "",
	};
	
	// Decide appendThinkPrompt by simple rules
	let parsedThinkErrorPrompt = '';
	{
		// error prompt
		if (codeBlocks.diagnosticsCodeBlock !== '') {
			parsedThinkErrorPrompt = parseHandlebarsTemplate(appendThinkPromptError, handlebarsContext);
		}
	}
	let parsedAppendThinkPrompt = '';
	let parsedAppendOutputPrompt = '';
	{
		let appendThinkPrompt = '';
		let appendOutputPrompt = '';
		const cursorIndex = editorContext.cursorLine - editorContext.aroundFromLine;
		const cursorLineText = (0 <= cursorIndex && cursorIndex < latestAroundSnippetLines.length)
			? latestAroundSnippetLines[cursorIndex]
			: '';
		const isCursorLineBlank = cursorLineText.trim().length === 0;
		if (isCursorLineBlank) {
			appendThinkPrompt = appendThinkPromptNewScope;
		} else {
			// Determine by the LAST action in edit history (delete/rename/modify => refactor)
			if (lastActionWithoutReject === 'delete') {
				appendThinkPrompt = appendThinkPromptRefactoring;
			} else if (lastActionWithoutReject === 'rename') {
				appendThinkPrompt = appendThinkPromptRefactoring;
			} else if (lastActionWithoutReject === 'modify') {
				appendThinkPrompt = appendThinkPromptRefactoring;
			} else {
				appendThinkPrompt = appendThinkPromptAddition;
			}
		}
		// Append reject prompt if the last action was 'reject'
		if (lastAction === 'reject') {
			appendThinkPrompt += '\n' + appendThinkPromptReject;
			appendOutputPrompt += appendOutputPromptReject;
		}

		parsedAppendThinkPrompt = parseHandlebarsTemplate(appendThinkPrompt, handlebarsContext);
		parsedAppendOutputPrompt = parseHandlebarsTemplate(appendOutputPrompt, handlebarsContext);
	}

	// Thinking prompt
	handlebarsContext.thinkErrorPrompt = parsedThinkErrorPrompt;
	handlebarsContext.appendThinkPrompt = parsedAppendThinkPrompt;
	handlebarsContext.appendOutputPrompt = parsedAppendOutputPrompt;
	
	// Parse Handlebars templates
	const parsedSystemPrompt = parseHandlebarsTemplate(systemPrompt, handlebarsContext);
	const parsedUserPrompt = parseHandlebarsTemplate(userPrompt, handlebarsContext);
	const parsedAssistantPrompt = parseHandlebarsTemplate(assistantPrompt, handlebarsContext);

	return {
		systemPrompt: parsedSystemPrompt,
		userPrompt: parsedUserPrompt,
		assistantPrompt: parsedAssistantPrompt,
		beforePlaceholderWithLF: cursorLineBefore,
		yamlConfigMode,
		handlebarsContext,
	};
}



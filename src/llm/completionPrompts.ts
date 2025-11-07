import { EditorContext } from '../utils/editorContext';
import { getConfig } from '../utils/config';
import { logDebug } from '../utils/logger';
import { withLineNumberCodeBlock } from './llmUtils';
import { getYamlConfigMode, YamlConfigMode } from '../utils/yamlConfig';
import { parseHandlebarsTemplate } from '../utils/cotabUtil';
import { EditHistoryAction, makeYamlFromEditHistoryActions } from '../llm/codeBlockBuilder';

// Surrounding code line count
const LATEST_AROUND_CODE_LINES = 15;

// Prompt cache type definition
interface PromptCache {
	aroundFromLine: number;
	aroundToLine: number;
	inputCode: string;
	timestamp: number;
}

// Prompt cache (per document URI)
const promptCache = new Map<string, PromptCache>();
const CACHE_DURATION = 5 * 60 * 1000; // Cache for 5 minutes


// Function to get inputCode from cache
function getCachedInputCodeInternal(
	documentUri: string,
	cursorLine: number
): string | null {
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
	
	logDebug(`Cache hit: Got inputCode from cache (${documentUri})`);
	return cached.inputCode;
}

// Function to save inputCode to cache
function cacheInputCode(
	documentUri: string,
	aroundFromLine: number,
	aroundToLine: number,
	inputCode: string
): void {
	promptCache.set(documentUri, {
		aroundFromLine,
		aroundToLine,
		inputCode,
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
	sourceCode: string[],
	ctx: EditorContext,
	startEditingHere?: string,
	stopEditingHere?: string
): string {
	let cachedSourceCode: string | null = null;

	const find = documentUri ? getCachedInputCodeInternal(documentUri, ctx.cursorLine) : null;
	if (find) {
		cachedSourceCode = find;
	}
	else {
		// Source code without cursor snippet
		const beforeOutside = sourceCode.slice(0, ctx.aroundCacheFromLine).join('\n');
		const aroundSnippet = sourceCode.slice(ctx.aroundCacheFromLine, ctx.aroundCacheToLine).join('\n');
		const afterOutside = sourceCode.slice(ctx.aroundCacheToLine).join('\n');
		const startSymbol = (startEditingHere)?('\n' + startEditingHere) : ''
		const stopSymbol = (stopEditingHere)?('\n' + stopEditingHere) : '';
		const inputCode =
`${beforeOutside}${startSymbol}
${aroundSnippet}${stopSymbol}
${afterOutside}`
		if (documentUri) {
			cacheInputCode(documentUri, ctx.aroundCacheFromLine, ctx.aroundCacheToLine, inputCode);
		}
		cachedSourceCode = inputCode;
	}
	return cachedSourceCode;
}

export function buildCompletionPrompts(ctx: EditorContext,
	sourceAnalysis?: string,
	symbolCodeBlock?: string,
	editHistoryActions?: EditHistoryAction[],
	documentUri?: string): {
		systemPrompt: string;
		userPrompt: string;
		assistantPrompt: string;
		beforePlaceholderWithLF: string;
		yamlConfigMode: YamlConfigMode;
	} {
	const config = getConfig();
	let placeholder = config.completeHereSymbol;
	const startEditingHereSymbol = config.startEditingHereSymbol;
	const stopEditingHereSymbol = config.stopEditingHereSymbol;
	sourceAnalysis = sourceAnalysis ?? '';
	symbolCodeBlock = symbolCodeBlock ?? '';

	// Get YAML configuration
	const yamlConfigMode = getYamlConfigMode(ctx.relativePath);
	const cursorAlwaysHead = yamlConfigMode.cursorAlwaysHead !== undefined ? yamlConfigMode.cursorAlwaysHead : false;
	placeholder = (yamlConfigMode.placeholderSymbol !== undefined) ? yamlConfigMode.placeholderSymbol : placeholder;
	const systemPrompt = yamlConfigMode.systemPrompt || '';
	const userPrompt = yamlConfigMode.userPrompt || '';
	const assistantPrompt = yamlConfigMode.assistantPrompt || '';
	const appendThinkPromptNewScope = yamlConfigMode.appendThinkPromptNewScope || '';
	const appendThinkPromptRefactoring = yamlConfigMode.appendThinkPromptRefactoring || '';
	const appendThinkPromptAddition = yamlConfigMode.appendThinkPromptAddition || '';
	const appendThinkPromptReject = yamlConfigMode.appendThinkPromptReject || '';
	const appendOutputPromptReject = yamlConfigMode.appendOutputPromptReject || '';

	// Code blocks
	const sourceCode = ctx.documentText.split('\n');

	// Cached source code
	const cachedSourceCode = getCachedSourceCode(documentUri, sourceCode, ctx,
		yamlConfigMode.isNoInsertStartStopSymbol ? undefined : startEditingHereSymbol,
		yamlConfigMode.isNoInsertStartStopSymbol ? undefined : stopEditingHereSymbol);
	const cachedSourceCodeWithLine = withLineNumberCodeBlock(cachedSourceCode, 0, [startEditingHereSymbol, stopEditingHereSymbol]).CodeBlock;
	const sourceCodeBlock =
`\`\`\`${ctx.languageId} title=${ctx.relativePath}
${cachedSourceCodeWithLine}
\`\`\``

	// Latest surrounding code blocks
	const latestBeforeOutsideLines = sourceCode.slice(0, ctx.aroundFromLine);
	const latestAroundSnippetLines = sourceCode.slice(ctx.aroundFromLine, ctx.aroundToLine);
	const latestAfterOutsideLines = sourceCode.slice(ctx.aroundToLine);
	
	// Extract last 5 lines of beforeOutside
	const latestBeforeOutsideLast = latestBeforeOutsideLines.slice(-LATEST_AROUND_CODE_LINES).join('\n');
	const latestAfterOutsideFirst = latestAfterOutsideLines.slice(0, LATEST_AROUND_CODE_LINES).join('\n');
	const {CodeBlock: latestBeforeOutsideLastWithLine, LastLineNumber: latestBeforeOutsideLastWithLineNumber} = withLineNumberCodeBlock(latestBeforeOutsideLast, ctx.aroundFromLine-LATEST_AROUND_CODE_LINES);
	const latestAfterOutsideFirstWithLine = withLineNumberCodeBlock(latestAfterOutsideFirst, ctx.aroundToLine).CodeBlock;
	
	// Insert placeholder at cursor position
	let { aroundSnippetWithPlaceholder,
		beforePlaceholderWithLF,
		cursorLineBefore,
		cursorLineAfter,
		afterPlaceholder
	} = insertCursorHere(latestAroundSnippetLines.join('\n'),
						ctx.cursorLine, (cursorAlwaysHead) ? 0 :ctx.cursorCharacter, ctx.aroundFromLine,
						placeholder);
	const aroundSnippetWithPlaceholderWithLine = withLineNumberCodeBlock(aroundSnippetWithPlaceholder, ctx.aroundFromLine).CodeBlock;
	
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
	const latestSourceCode =
`
// ... existing code ...

${latestBeforeOutsideLastWithLine}
${startEditingHereSymbol}
${aroundSnippetWithPlaceholderWithLine}
${stopEditingHereSymbol}
${latestAfterOutsideFirstWithLine}

// ... existing code ...
`;
	const latestSourceCodeBlock =
`\`\`\`${ctx.languageId} title=${ctx.relativePath}
${latestSourceCode}
\`\`\``

	const assistantSourceCodeBlockBforeCursor = 
`\`\`\`${ctx.languageId} title=${ctx.relativePath}

// ... existing code ...

${latestBeforeOutsideLastWithLine}
${startEditingHereSymbol}
${cursorLineBefore}`;


	let lastAction = '';
	let lastActionWithoutReject = '';
	let rejectContent = '';
	if (editHistoryActions && 0 < editHistoryActions.length) {
		lastAction = editHistoryActions[editHistoryActions.length - 1].action;
		for (let i = editHistoryActions.length - 1; i >= 0; i--) {
			const action = editHistoryActions[i];
			if (action.action === 'reject') {
				if (action.content) {
					let line = '';
					if (action.lines && 0 < action.lines.length) {
						line = `${action.lines[0]}|`;
					}
					rejectContent = line + action.content;
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
		"languageId": ctx.languageId,
		"relativePath": ctx.relativePath,
		"placeholder": placeholder,
		"startEditingHere": startEditingHereSymbol,
		"stopEditingHere": stopEditingHereSymbol,
		"commentLanguage": config.commentLanguage,
		
		// Code blocks
		"sourceCodeBlock": sourceCodeBlock,
		"symbolCodeBlock": symbolCodeBlock,
		"editHistoryCodeBlock": makeYamlFromEditHistoryActions(editHistoryActions??[]),
		"sourceAnalysis": sourceAnalysis,
		"latestSourceCodeBlock": latestSourceCodeBlock,
		"assistantSourceCodeBlockBforeCursor": assistantSourceCodeBlockBforeCursor,
		"cursorLineBefore": orgCursorLineBefore,
		"cursorLineBeforeWithLine": cursorLineBefore,
		
		// Additional prompts
		"additionalSystemPrompt": config.additionalSystemPrompt ? '\n' + config.additionalSystemPrompt : '',
		"additionalUserPrompt": config.additionalUserPrompt ? '\n' + config.additionalUserPrompt : '',
		"additionalAssistantThinkPrompt": config.additionalAssistantThinkPrompt ? '\n' + config.additionalAssistantThinkPrompt : '',
		"additionalAssistantOutputPrompt": config.additionalAssistantOutputPrompt ? '\n' + config.additionalAssistantOutputPrompt : '',
		
		// Thinking prompt
		"appendThinkPrompt": "",
		"rejectContent": rejectContent,

		// Output
		"appendOutputPrompt": "",
	};
	
	// Decide appendThinkPrompt by simple rules
	let parsedAppendThinkPrompt = '';
	let parsedAppendOutputPrompt = '';
	{
		let appendThinkPrompt = '';
		let appendOutputPrompt = '';
		const cursorIndex = ctx.cursorLine - ctx.aroundFromLine;
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
			// Append reject prompt if the last action was 'reject'
			if (lastAction === 'reject') {
				appendThinkPrompt += '\n' + appendThinkPromptReject;
				appendOutputPrompt += appendOutputPromptReject;
			}
		}
		parsedAppendThinkPrompt = parseHandlebarsTemplate(appendThinkPrompt, handlebarsContext);
		parsedAppendOutputPrompt = parseHandlebarsTemplate(appendOutputPrompt, handlebarsContext);
	}

	// Thinking prompt
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
	};
}


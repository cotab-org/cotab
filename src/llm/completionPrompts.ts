import { EditorContext } from '../utils/editorContext';
import { getConfig } from '../utils/config';
import { logDebug } from '../utils/logger';
import { withLineNumberCodeBlock } from './llmUtils';
import { getYamlConfigPrompt } from '../utils/yamlConfig';
import { parseHandlebarsTemplate } from '../utils/cotabUtil';

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
	startEditingHere: string,
	stopEditingHere: string
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
		const inputCode =
`${beforeOutside}
${startEditingHere}
${aroundSnippet}
${stopEditingHere}
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
	editHistoryCodeBlock?: string,
	documentUri?: string): {
		systemPrompt: string;
		userPrompt: string;
		assistantPrompt: string;
		beforePlaceholderWithLF: string } {
	const config = getConfig();
	let placeholder = config.completeHereSymbol;
	const startEditingHereSymbol = config.startEditingHereSymbol;
	const stopEditingHereSymbol = config.stopEditingHereSymbol;
	sourceAnalysis = sourceAnalysis ?? '';
	symbolCodeBlock = symbolCodeBlock ?? '';
	editHistoryCodeBlock = editHistoryCodeBlock ?? '';

	// Get YAML configuration
	const yamlPrompt = getYamlConfigPrompt(ctx.relativePath);
	const cursorAlwaysHead = yamlPrompt.cursorAlwaysHead !== undefined ? yamlPrompt.cursorAlwaysHead : false;
	placeholder = (yamlPrompt.placeholderSymbol !== undefined) ? yamlPrompt.placeholderSymbol : placeholder;
	const systemPrompt = yamlPrompt.systemPrompt || '';
	const userPrompt = yamlPrompt.userPrompt || '';
	const assistantPrompt = yamlPrompt.assistantPrompt || '';
	const appendThinkPromptNewScope = yamlPrompt.appendThinkPromptNewScope || '';
	const appendThinkPromptRefactoring = yamlPrompt.appendThinkPromptRefactoring || '';
	const appendThinkPromptAddition = yamlPrompt.appendThinkPromptAddition || '';

	// Code blocks
	const sourceCode = ctx.documentText.split('\n');

	// Cached source code
	const cachedSourceCode = getCachedSourceCode(documentUri, sourceCode, ctx, startEditingHereSymbol, stopEditingHereSymbol);
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
		"editHistoryCodeBlock": editHistoryCodeBlock,
		"sourceAnalysis": sourceAnalysis,
		"latestSourceCodeBlock": latestSourceCodeBlock,
		"assistantSourceCodeBlockBforeCursor": assistantSourceCodeBlockBforeCursor,
		"cursorLineBefore": orgCursorLineBefore,
		
		// Additional prompts
		"additionalSystemPrompt": config.additionalSystemPrompt ? '\n' + config.additionalSystemPrompt : '',
		"additionalUserPrompt": config.additionalUserPrompt ? '\n' + config.additionalUserPrompt : '',
		"additionalAssistantThinkPrompt": config.additionalAssistantThinkPrompt ? '\n' + config.additionalAssistantThinkPrompt : '',
		"additionalAssistantOutputPrompt": config.additionalAssistantOutputPrompt ? '\n' + config.additionalAssistantOutputPrompt : '',
		
		// Thinking prompt
		"appendThinkPrompt": ""
	};
	
	// Decide appendThinkPrompt by simple rules
	let parsedAppendThinkPrompt = '';
	{
		let appendThinkPrompt = '';
		const cursorIndex = ctx.cursorLine - ctx.aroundFromLine;
		const cursorLineText = (0 <= cursorIndex && cursorIndex < latestAroundSnippetLines.length)
			? latestAroundSnippetLines[cursorIndex]
			: '';
		const isCursorLineBlank = cursorLineText.trim().length === 0;
		if (isCursorLineBlank) {
			appendThinkPrompt = appendThinkPromptNewScope;
		} else {
			// Determine by the LAST action in edit history (delete/rename/modify => refactor)
			const historyText = editHistoryCodeBlock || '';
			const matches = Array.from(historyText.matchAll(/-\s*action:\s*(\w+)/gi));
			const lastAction = (0 < matches.length) ? (matches[matches.length - 1][1] || '').toLowerCase() : '';
			const isRefactorAction = lastAction === 'delete' || lastAction === 'rename' || lastAction === 'modify';
			appendThinkPrompt = isRefactorAction ? appendThinkPromptRefactoring : appendThinkPromptAddition;
		}
		parsedAppendThinkPrompt = parseHandlebarsTemplate(appendThinkPrompt, handlebarsContext);
	}

	// Thinking prompt
	handlebarsContext.appendThinkPrompt = parsedAppendThinkPrompt;
	
	// Parse Handlebars templates
	const parsedSystemPrompt = parseHandlebarsTemplate(systemPrompt, handlebarsContext);
	const parsedUserPrompt = parseHandlebarsTemplate(userPrompt, handlebarsContext);
	const parsedAssistantPrompt = parseHandlebarsTemplate(assistantPrompt, handlebarsContext);

	return {
		systemPrompt: parsedSystemPrompt,
		userPrompt: parsedUserPrompt,
		assistantPrompt: parsedAssistantPrompt,
		beforePlaceholderWithLF: cursorLineBefore
	};
}


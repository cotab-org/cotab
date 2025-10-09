import { EditorContext } from '../utils/editorContext';
import { getConfig } from '../utils/config';
import { logDebug } from '../utils/logger';
import { withLineNumberCodeBlock } from './llmUtils';
import * as vscode from 'vscode';

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
	const placeholder = config.completeHereSymbol;
	const startEditingHere = config.startEditingHereSymbol;
	const stopEditingHere = config.stopEditingHereSymbol;
	sourceAnalysis = sourceAnalysis ?? '';
	symbolCodeBlock = symbolCodeBlock ?? '';
	editHistoryCodeBlock = editHistoryCodeBlock ?? '';

	// Code blocks
	const sourceCode = ctx.documentText.split('\n');

	// Cached source code
	const cachedSourceCode = getCachedSourceCode(documentUri, sourceCode, ctx, startEditingHere, stopEditingHere);
	const cachedSourceCodeWithLine = withLineNumberCodeBlock(cachedSourceCode, 0, [startEditingHere, stopEditingHere]).CodeBlock;
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
						ctx.cursorLine, ctx.cursorCharacter, ctx.aroundFromLine,
						placeholder);
	const aroundSnippetWithPlaceholderWithLine = withLineNumberCodeBlock(aroundSnippetWithPlaceholder, ctx.aroundFromLine).CodeBlock;
	
	// Whether to make code up to cursor position column already output to Assistant
	// ※Can guarantee characters before cursor but can't complete at positions before cursor.
	const outputedCursorLineBefore = false;
	if (!outputedCursorLineBefore) {
		cursorLineBefore = '';
	}

	// addend LineNumber Text
	if (getConfig().withLineNumber) {
		cursorLineBefore = `${latestBeforeOutsideLastWithLineNumber+1}|${cursorLineBefore}`;
	}

	// Comment language
	const commentLanguage = getConfig().commentLanguage;

	// Customize prompt
	const overrideSystemPrompt = getConfig().overrideSystemPrompt;
	const overrideUserPrompt = getConfig().overrideUserPrompt;
	const overrideAssistantThinkPrompt = getConfig().overrideAssistantThinkPrompt;
	const overrideAssistantOutputPrompt = getConfig().overrideAssistantOutputPrompt;
	const additionalSystemPrompt = getConfig().additionalSystemPrompt ? '\n' + getConfig().additionalSystemPrompt : '';
	const additionalUserPrompt = getConfig().additionalUserPrompt ? '\n' + getConfig().additionalUserPrompt : '';
	const additionalAssistantThinkPrompt = getConfig().additionalAssistantThinkPrompt ? '\n' + getConfig().additionalAssistantThinkPrompt : '';
	const additionalAssistantOutputPrompt = getConfig().additionalAssistantOutputPrompt ? '\n' + getConfig().additionalAssistantOutputPrompt : '';
	//logDebug(`commentLanguage: ${commentLanguage}`);

	const latestSourceCode =
`
// ... existing code ...

${latestBeforeOutsideLastWithLine}
${startEditingHere}
${aroundSnippetWithPlaceholderWithLine}
${stopEditingHere}
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
${startEditingHere}
${cursorLineBefore}`;

	//#######################################################################################
	// System Prompt
	//#######################################################################################
	const systemPrompt = overrideSystemPrompt ? overrideSystemPrompt :
`You are an expert "${ctx.languageId}" code editor.
Your task is to propose a minimal inline edit to improve or continue the code at the cursor.

RULES:
- Only write code valid in "${ctx.languageId}".
- Never declare or redefine any type (struct/class/enum/etc.) that already exists in the code.
- Do not remove or rename any existing identifier.
- Do not modify any code outside the "${startEditingHere}" ... "${stopEditingHere}" block.
- The completed code must compile or run without errors in "${ctx.languageId}".
- All whitespace and formatting must remain identical to the original, except for your changes within the edit block.
- Do not output explanations, comments, or extra text outside of code.
- Respond with only the full edited code block.${additionalSystemPrompt}`;

	//#######################################################################################
	// User Prompt
	//#######################################################################################
	const userPrompt = overrideUserPrompt ? overrideUserPrompt :
`Your task is to complete the code at the "${placeholder}" location in the given code block.
Follow the instructions and write the code the user intends to write.
Think step by step when writing the code.
You must add code at the "${placeholder}" location.
If you fail to add it, a significant penalty will be applied.
It is important to follow "SYMBOL_RULES" and "IMPORTANT".
The completed code must be exact and error-free.
A single typo or formatting change can cause compilation or runtime errors.
Unless explicitly instructed to modify other parts, output the input code exactly as provided.

<INSTRUCTIONS>
1. Carefully examine the input code block and understand what it is intended to do.
2. Refer to the edit history to understand what the user has recently done.
3. Pay close attention to the area around "${placeholder}" and, while considering the edit history to the fullest, deeply reason about and predict what should be written at the "${placeholder}" location. You must not modify already existing characters. Continue from them as they are.
4. Re-check whether your output contradicts the user’s intention, whether the program will be complete, and whether it introduces errors.
5. Output the flawless and complete code you verified, continuing from "${placeholder}".
6. Finally, confirm that the output code does not cause errors and does not contradict the user’s intent. If there are no issues, finalize it.
7. You must always output "${stopEditingHere}" exactly as is.
8. If necessary, you may also complete sections outside of "${placeholder}".
</INSTRUCTIONS>

<SYMBOL_RULES>
- Variable names, function names, etc. must always be treated as valid identifiers.
- If a symbol name seems unnatural, carefully check the surrounding code and provide an appropriate name.
- If a proper symbol name cannot be provided, the code quality will significantly degrade. Half-baked naming is not allowed.
- Refer to "SYMBOL_CONTEXT" for symbols defined in external files.
</SYMBOL_RULES>

<IMPORTANT>
- You MUST output the entire "${startEditingHere}" block exactly once.
- You MUST preserve all lines outside the edit block exactly as provided.
- Do not output comments with explanations or examples. Output only the implementation code.
</IMPORTANT>

<SYMBOL_CONTEXTS>
- The "<SYMBOL_CONTEXT>" section encodes a structural summary of a file in YAML format.
- Each top-level item corresponds to a declared symbol (e.g., interface, class, function, or variable).
- Indented items represent that symbol’s members, such as properties, methods, constructors, and local variables.
- This structure provides a high-level map of the file’s API surface and internal relationships, not the full source code.
${symbolCodeBlock}
</SYMBOL_CONTEXTS>

<CODE_SUMMARY>
${sourceAnalysis}
</CODE_SUMMARY>

<EDIT_HISTORY>
The most recent edits are at the bottom.
Since the following edit history may be outdated, always make sure to check the latest version when referring to it.
\`\`\`yaml
# Since this may be outdated, you must always verify the latest state when referring to it.
\`\`\`
</EDIT_HISTORY>

<CODE_INPUT>
Since the following source code may be outdated, always make sure to check the latest version when referring to it.
${sourceCodeBlock}
</CODE_INPUT>

When you reach "${stopEditingHere}", end your output immediately without adding extra text.
Follow typical coding style conventions for "${ctx.languageId}".
Program comments must be written in "${commentLanguage}".${additionalUserPrompt}`;

	//#######################################################################################
	// Assistant thinking output Prompt
	//#######################################################################################
	const appendThinkPromptNewScope = `I have checked the latest source code. The editing position is within an empty scope, and it is highly likely that the user intends to write new code.Therefore, we implement the new code inferred from the surrounding implementation at the editing position.`
	const appendThinkPromptRefactoring = `I have checked the latest source code and edit history. Since some code has been deleted or modified, I will determine the necessary refactoring based on those changes and update the existing code accordingly.`;
	const appendThinkPromptAddition = `I have checked the latest source code and edit history. Since some code has been added or modified, I will implement the remaining necessary code based on those additions and changes.`;

	// Decide appendThinkPrompt by simple rules
	let appendThinkPrompt = '';
	{
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
	}


	const assistantThinkPrompt = overrideAssistantThinkPrompt ? overrideAssistantThinkPrompt :
`<think>
Okey, I will carefully review the code and provide a minimal inline edit to improve it. I will only modify the code within the "${startEditingHere}" ... "${stopEditingHere}" block provided in the code snippet and I will not output anything outside that block. After finishing edits within the allowed range I will always output "${stopEditingHere}" to indicate the end, and I will exercise maximum care to ensure I do not output outside the editable range. I will ensure the output is valid "${ctx.languageId}" code and free of compilation or runtime errors, and I will preserve all whitespace and formatting exactly as in the original source. That means I will not change any spaces, tabs, or line breaks when outputting the original code. I will keep indentation consistent and pay the utmost attention to the spaces, tabs, and line breaks I output. I MUST replace code with "${placeholder}" exactly where required.
I will complete partially written symbol names with the names you are likely to write and I will predict and write the implementation or definition that you are likely to write in the case of a blank line. I will never modify existing characters and no matter how incomplete the code below is I will not treat characters as deleted. I will only output characters that can be inferred from the existing characters. I will actively infer and complete the remaining characters on the cursor line because it is likely the user is in the middle of typing a word, and I will perform autocomplete treating the cursor position as being within a partially typed word so I complete that incomplete word and ensure extremely high output quality. I will avoid redefining or redeclaring the same symbol name to prevent compilation errors. I will proactively reference external symbols defined in "SYMBOL_CONTEXT".
I will improve output quality by using context-aware completions. For example, where "${placeholder}" appears in a scope with several classes, structs, or functions already declared, I will output an appropriate declaration such as "class Child" if the surrounding code implies a Parent/Child relationship. The same context-driven reasoning applies to variable names, control structures like if and for, and language keywords. I will treat a blank line as an intention to write new code and use the surrounding or immediately preceding code as the primary signal. For example, if an undefined variable appears nearby, I will output code that defines that variable to improve the result.
Because "${stopEditingHere}" is a critical merging marker, I will take the utmost care to never output code that comes after "${stopEditingHere}" before emitting this marker itself. I will also prefer to use unused variables from surrounding or previous code where doing so improves quality, and even if no unused variables exist I will prioritize using variables or symbols defined immediately prior or recently used, since surrounding code is always informative. The same principle governs functions, classes, and structs. I will always check the entire source code when defining function, variable, class, or struct symbol names to ensure there are no duplicates and to avoid accidentally copying an existing definition.
As the provided edit history and source code may be outdated, we will obtain the latest information before making any edits.
The retrieved latest edit history is as follows:
<EDIT_HISTORY>
${editHistoryCodeBlock}
</EDIT_HISTORY>
The provided source code may also be outdated, so I must retrieve the latest version. I am required to always refer to this latest source code.
<CODE_INPUT>
${latestSourceCodeBlock}
</CODE_INPUT>
${appendThinkPrompt}${additionalAssistantThinkPrompt}
I will write program comments in "${commentLanguage}".
</think>

`;

	//#######################################################################################
	// Assistant output Prompt
	//#######################################################################################
const assistantOutputPrompt = overrideAssistantOutputPrompt ? overrideAssistantOutputPrompt :
`Sure! I will output only the code block. and I will not forget to also output "${stopEditingHere}".${additionalAssistantOutputPrompt}
Here is the complete edited code block:
${assistantSourceCodeBlockBforeCursor}`;

	return {
		systemPrompt,
		userPrompt,
		assistantPrompt: assistantThinkPrompt + assistantOutputPrompt,
		beforePlaceholderWithLF: cursorLineBefore
	};
}

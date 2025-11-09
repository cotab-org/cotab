import { YamlConfigMode } from '../utils/yamlConfig';

/**
 * Default prompts for code completion and analysis
 */

//#######################################################################################
// Completion Prompts
//#######################################################################################

// System Prompt for completion (comment insertion mode)
const defaultSystemPrompt =
`You are an expert "{{languageId}}" code reviewer.
Your task is to insert clear, concise explanatory comments into the code at the cursor without changing behavior.

RULES:
- Only add comments using the correct comment syntax for "{{languageId}}".
- Do not change, reorder, or delete any existing code or whitespace.
- Do not rename identifiers or alter semantics.
- Insert comments only within the "{{startEditingHere}}" ... "{{stopEditingHere}}" block.
- Within the edit block, focus your comments on code that follows the cursor (i.e., lines below the insertion position). Only annotate code above the cursor when strictly necessary to clarify the behavior of the following lines.
- When multiple options exist, prefer annotating the nearest statements immediately after the insertion position over earlier lines.
- Prefer high-signal comments: purpose, inputs/outputs, invariants, non-obvious logic, side-effects, complexity, caveats, and TODOs.
- Keep comments short and actionable (1-2 lines each). Avoid restating obvious code.
- Use idiomatic formats (e.g., docstrings for Python, JSDoc/TSDoc for TypeScript, block comments for functions/classes when appropriate).
- Program comments must be written in "{{commentLanguage}}".
- Do not output explanations outside of code.
- Respond with only the full edited code block.{{additionalSystemPrompt}}`;

// User Prompt for completion (comment insertion mode)
const defaultUserPrompt =
`Your task is to analyze the given code and insert explanatory comments at the "{{placeholder}}" location in the code block.
Think step by step about what would most help a reader, then add only comments.
You must add comments at the "{{placeholder}}" location.
If you fail to add them, a significant penalty will be applied.
It is important to follow "SYMBOL_RULES" and "IMPORTANT".
The output must not change program behavior.
A single formatting change outside comments can cause issues; preserve original text exactly except for added comments within the edit block.

<INSTRUCTIONS>
1. Carefully examine the input code block and understand intent, data flow, and invariants.
2. Refer to the edit history to understand recent changes that may need clarification.
3. Around "{{placeholder}}", focus on the code that comes after this insertion point within the edit block. Reason deeply about what is non-obvious in the following lines and insert comments there. Do not annotate code that is entirely above the insertion point unless it is essential context for the lines below. Do not modify existing characters; only insert comments using the correct syntax.
4. Prefer comments that explain purpose, pre/post-conditions, edge cases, complexity, side-effects, and rationale behind tricky parts.
5. Keep comments concise (1-2 lines each) and avoid restating obvious code.
6. Confirm your comments do not contradict the user's intent and do not alter behavior.
7. You must always output "{{stopEditingHere}}" exactly as is.
8. If helpful, you may insert additional comments within the "{{startEditingHere}}" block, but nowhere else.
</INSTRUCTIONS>

<SYMBOL_RULES>
- Variable names, function names, etc. must always be treated as valid identifiers.
- Never rename or redefine any identifier.
- Refer to "SYMBOL_CONTEXT" for symbols defined in external files.
</SYMBOL_RULES>

<IMPORTANT>
- You MUST output the entire "{{startEditingHere}}" block exactly once.
- You MUST preserve all lines outside the edit block exactly as provided.
- Output only comments; do NOT add or change executable code.
- Focus comments on the code below the insertion point within the edit block; do not summarize or comment earlier sections unless strictly required to understand what follows.
</IMPORTANT>

<SYMBOL_CONTEXTS>
- The "<SYMBOL_CONTEXT>" section encodes a structural summary of a file in YAML format.
- Each top-level item corresponds to a declared symbol (e.g., interface, class, function, or variable).
- Indented items represent that symbol's members, such as properties, methods, constructors, and local variables.
- This structure provides a high-level map of the file's API surface and internal relationships, not the full source code.
{{symbolCodeBlock}}
</SYMBOL_CONTEXTS>

<CODE_SUMMARY>
{{sourceAnalysis}}
</CODE_SUMMARY>

<EDIT_HISTORY>
The "<EDIT_HISTORY>" section encodes a list of edit operations in YAML format. The latest edit is at the bottom.
The types of actions are as follows:
- "add": Code was added. "after" is the text after the insertion. The user is actively writing new code, so you must continue by completing the code that follows.
- "delete": Code was removed. "after" is the text after the deletion. The user is refactoring; do not restore the deleted code. Instead, rewrite the code by moving or refactoring what was removed.
- "modify": Code was changed. "after" is the revised text. The user is refactoring; understand the change and rewrite the code accordingly to perform any necessary refactoring.
- "rename": A symbol was renamed. "after" is the new name. The user is performing a rename refactor; propagate the rename to all dependent locations.
- "copy": Code was copied. "content" is the copied text. The user intends to code using this text; implement behavior consistent with the contents of this text.
- "reject": Your completion was rejected. "content" is the text of your rejected suggestion. Do not make the same suggestion again; instead, propose different code that diverges from this content.
And the other parameters are defined as follows:
- "file": "current" refers to "<CODE_INPUT>", while "external" refers to edits in an external file.
- "lines": the line number of the edited "<CODE_INPUT>".
Since the following edit history may be outdated, always make sure to check the latest version when referring to it.
\`\`\`yaml
# Since this may be outdated, you must always verify the latest state when referring to it.
\`\`\`
</EDIT_HISTORY>

<CODE_INPUT>
Since the following source code may be outdated, always make sure to check the latest version when referring to it.
{{sourceCodeBlock}}
</CODE_INPUT>

When you reach "{{stopEditingHere}}", end your output immediately without adding extra text.
Follow typical coding style conventions for "{{languageId}}".
Program comments must be written in "{{commentLanguage}}".{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for completion (comment insertion mode)
const defaultAssistantPrompt =
`<think>
Okey, I will carefully review the code and insert explanatory comments without changing behavior. I will only modify the content within the "{{startEditingHere}}" ... "{{stopEditingHere}}" block and I will not output anything outside that block. After finishing within the allowed range I will always output "{{stopEditingHere}}" to indicate the end. I will preserve all whitespace and formatting of existing code exactly. I MUST insert comments at "{{placeholder}}" exactly where required, using the correct comment syntax for "{{languageId}}" and writing in "{{commentLanguage}}".
I will not add any executable statements. I will avoid renaming or redefining identifiers. I will prioritize annotating code located after the insertion point within the edit block, preferring the nearest statements immediately following the cursor. I will not add comments about code that is entirely above the insertion point unless it is necessary context for understanding subsequent lines. I will prefer high-signal, concise comments that explain purpose, preconditions, edge cases, complexity, side-effects, and rationale behind non-obvious logic. When appropriate, I will use idiomatic documentation forms (e.g., docstrings, JSDoc/TSDoc) and otherwise line comments near the relevant code. I will proactively reference external symbols defined in "SYMBOL_CONTEXT" to ensure accurate commentary.
As the provided edit history and source code may be outdated, I will obtain the latest information before making any edits.
The retrieved latest edit history is as follows:
<EDIT_HISTORY>
{{editHistoryCodeBlock}}
</EDIT_HISTORY>
The provided source code may also be outdated, so I must retrieve the latest version. I am required to always refer to this latest source code.
<CODE_INPUT>
{{latestSourceCodeBlock}}
This latest code must be referenced, and any lines outside this range must be referenced to the original code provided by the user.
</CODE_INPUT>
{{appendThinkPrompt}}{{additionalAssistantThinkPrompt}}
I will write program comments in "{{commentLanguage}}".
</think>

Sure! I will output only the code block.
I will always keep "{{stopEditingHere}}" in the same position as in the original code.
I will also keep all non-comment code exactly as it is in the original.
Each line will always be prefixed with a line number. {{appendOutputPrompt}}{{additionalAssistantOutputPrompt}}
Here is the complete edited code block:
{{assistantSourceCodeBlockBforeCursor}}`;

const defaultAppendThinkPromptNewScope = `Okey, I have checked the latest source code. The editing position is within an empty scope. Instead of adding new executable code, I will add a concise high-level comment block that documents the intended behavior, inputs/outputs, and edge cases.`;
const defaultAppendThinkPromptRefactoring = `Okey, I have checked the latest source code and edit history. Since some code has been deleted or modified, I will insert comments that explain the refactoring rationale, behavioral invariants, and migration notes.`;
const defaultAppendThinkPromptAddition = `Okey, I have checked the latest source code and edit history. Since some code has been added or modified, I will add comments after \`\`\`{{cursorLineBefore}}\`\`\` to describe remaining TODOs, assumptions, and potential pitfalls.`;
const defaultAppendThinkPromptReject = 
`And the user rejected the following comments:
\`\`\`
{{rejectContent}}
\`\`\`
so I must provide improved, different comments.`
const defaultAppendOutputPromptReject = 
`The user rejected the following comments:
\`\`\`
{{rejectContent}}
\`\`\`
so I must provide improved, different comments.`

//#######################################################################################
// Analysis Prompts
//#######################################################################################

// System Prompt for analysis
const defaultAnalyzeSystemPrompt =
`You are a "{{languageId}}" code-analysis expert.
Summarize the given source code from a big-picture, architectural perspective rather than implementation details.
Emphasize purpose, separation of responsibilities, relationships among major components, I/O boundaries, and areas that are easy to extend. Avoid enumerating functions or variables and avoid step-by-step procedural explanations.
Keep each item brief and at a decision-making level of abstraction.
Use only the minimum necessary jargon and be concise.
Output in Markdown format, using bullet points under each heading.

Prohibited:
- Step-by-step procedures, pseudocode, or long lists of function/variable names
- Fine details of conditionals or exception handling, and algorithm implementation details`;

// User Prompt for analysis
const defaultAnalyzeUserPrompt =
`Below is source code in "{{languageId}}". Summarize it focusing only on the "overall structure and intent" to help plan edits and new feature additions.

\`\`\`{{languageId}}:{{filename}}
{{sourceCode}}
\`\`\`

Output format:
\`\`\`markdown
# Purpose and Background
- (Detailed explanation of what this code solves/enables)
# Functional Blocks
- 3-5 major functions (role names only, no fine-grained explanations)
# Key Characteristics and Design Choices
- (Algorithms, design patterns, extension points, etc.)
# Advice for Future Extensions
- (Candidate extension points, how to manage dependencies, refactoring guidelines, testing strategy, etc.)
# Assumptions & Constraints: Preconditions and Environment Dependencies
- (Optional)
\`\`\`
Output the result in "English".`;

//#######################################################################################
// YAML Configuration Creator
//#######################################################################################

/**
 * Creates default YAML configuration prompt
 */
export function getYamlDefaultCommentPrompt(): YamlConfigMode {
	return {
		mode: 'Comment',
		extensions: ['*'],
		isDispOverwrite: true,
		isNoHighligh: true,
		isForceOverlay: true,
		isNoCheckStopSymbol: true,
		isNoInsertStartStopSymbol: true,
		maxOutputLines: 30,	// default lines x2
		maxTokens: 512,	// default tokens x2
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
		appendThinkPromptNewScope: defaultAppendThinkPromptNewScope,
		appendThinkPromptRefactoring: defaultAppendThinkPromptRefactoring,
		appendThinkPromptAddition: defaultAppendThinkPromptAddition,
		appendThinkPromptReject: defaultAppendThinkPromptReject,
		appendOutputPromptReject: defaultAppendOutputPromptReject,
		analyzeSystemPrompt: defaultAnalyzeSystemPrompt,
		analyzeUserPrompt: defaultAnalyzeUserPrompt
	};
}

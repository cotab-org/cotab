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
5. Keep comments concise (1-2 lines each) and avoid restating obvious code, and ensure comments are properly line-broken — use separate comment lines rather than long single-line blocks.
6. Confirm your comments do not contradict the user's intent and do not alter behavior.
7. You must always output "{{stopEditingHere}}" exactly as is.
</INSTRUCTIONS>

<SYMBOL_RULES>
- Variable names, function names, etc. must always be treated as valid identifiers.
- Never rename or redefine any identifier.
- Refer to "SYMBOL_CONTEXT" for symbols defined in external files.
</SYMBOL_RULES>

<IMPORTANT>
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
Okey, I will carefully review the code and insert explanatory comments without changing behavior. I will preserve all whitespace and formatting of existing code exactly. I MUST insert comments at "{{placeholder}}" exactly where required, using the correct comment syntax for "{{languageId}}" and writing in "{{commentLanguage}}".
I will not add any executable statements. I will avoid renaming or redefining identifiers. I will prioritize annotating code located after the insertion point within the edit block, preferring the nearest statements immediately following the cursor. I will not add comments about code that is entirely above the insertion point unless it is necessary context for understanding subsequent lines. I will prefer high-signal, concise comments that explain purpose, preconditions, edge cases, complexity, side-effects, and rationale behind non-obvious logic. When appropriate, I will use idiomatic documentation forms (e.g., docstrings, JSDoc/TSDoc) and otherwise line comments near the relevant code. I will proactively reference external symbols defined in "SYMBOL_CONTEXT" to ensure accurate commentary.
I must ensure that all inserted comments are properly line-broken, meaning they must be split at natural sentence boundaries or punctuation rather than written as long uninterrupted lines.
I will write program comments in "{{commentLanguage}}".

The provided source code may also be outdated, so I must retrieve the latest version. I am required to always refer to this latest source code.
The retrieved latest source code is as follows:
<CODE_INPUT>
{{latestSourceCodeBlock}}
This latest code must be referenced, and any lines outside this range must be referenced to the original code provided by the user.
</CODE_INPUT>
Okey, I have checked the latest source code. Replace “{{placeholder}}” and insert a comment about {{firstLineCode}} immediately after it.
{{appendThinkPrompt}}{{additionalAssistantThinkPrompt}}
</think>

Sure! I will output only the code block.
I will always keep "{{stopEditingHere}}" in the same position as in the original code.
I will also keep all non-comment code exactly as it is in the original.
Each line will always be prefixed with a line number. {{appendOutputPrompt}}{{additionalAssistantOutputPrompt}}
Here is the complete edited code block:
{{assistantSourceCodeBlockBforeCursor}}`;

/*
const defaultAppendThinkPromptReject = 
`<PROHIBITED_OUTPUT_RULES>
The following block contains prohibited output.
It is provided only so you can avoid producing anything similar.
You must NOT quote, copy, reuse, transform, summarize, or paraphrase any portion of it.
You must generate completely new and different comments.
If your output resembles the content below, it is considered a failure.
\`\`\`
{{rejectContent}}
\`\`\`
</PROHIBITED_OUTPUT_RULES>`

const defaultAppendOutputPromptReject = "";
*/

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
    	placeholderSymbol: "<|INSERT_AN_EXPLANATION_OF_THE_CODE_STARTING_FROM_THE_NEXT_LINE_BELOW_THIS_MARKER|>",
		isDispOverwrite: true,
		isNoHighligh: true,
		isForceOverlay: true,
		isNoCheckStopSymbol: true,
		isNoInsertStartStopSymbol: true,
		isNoInsertStartStopSymbolLatest: true,
		isNoItalic: true,
		maxOutputLines: 30,	// default lines x2
		maxTokens: 512,	// default tokens x2
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
//	appendThinkPromptReject: defaultAppendThinkPromptReject,	// Qwen3:4b-Instruct-2507 does not react to rejection almost, so omitted.
//	appendOutputPromptReject: defaultAppendOutputPromptReject,
//	analyzeSystemPrompt: defaultAnalyzeSystemPrompt,
//	analyzeUserPrompt: defaultAnalyzeUserPrompt
	};
}

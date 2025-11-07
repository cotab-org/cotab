import { YamlConfigMode } from '../utils/yamlConfig';

/**
 * Default prompts for translating plain comment text into code-comments
 */

//#######################################################################################
// Translation Prompts
//#######################################################################################

// System Prompt for translation
const defaultSystemPrompt =
`You are an expert "{{languageId}}" code editor assistant.
Your task is to insert a **translated comment** at the cursor location by converting the provided plain comment text into a valid "{{languageId}}" comment using the correct comment syntax.

RULES:
- Only write a comment valid in "{{languageId}}". Use the correct comment syntax for the language (line or block comment as appropriate).
- The content of the inserted comment must be a faithful translation of the provided source comment text "{{commentToTranslate}}", rendered in "{{commentLanguage}}".
- Do not add new information, interpretations, or explanations beyond faithfully translating the given comment text; keep paraphrasing minimal while ensuring natural phrasing in "{{commentLanguage}}".
- Do not insert or modify executable code. The only content you may add inside the edit block is the translated comment at the "{{placeholder}}" location.
- Never declare or redefine any type (struct/class/enum/etc.) that already exists in the code.
- Do not remove or rename any existing identifier.
- Do not modify any code outside the "{{startEditingHere}}" ... "{{stopEditingHere}}" block.
- Preserve all whitespace, formatting, and existing characters exactly as they are outside the allowed insertion point.
- Keep the translated comment concise (preferably 1–4 lines) and faithful to the original meaning.
- Do not output explanations, metadata, or any extra text outside of the edited code block.
- Respond with only the full edited code block (the entire "{{startEditingHere}}" block content exactly once, with your translated comment inserted).{{additionalSystemPrompt}}`;

// User Prompt for translation
const defaultUserPrompt =
`Your task is to translate the provided plain comment text into a comment in the given code block at the "{{placeholder}}" location.
You will be given the source plain comment text in "{{sourceCommentFieldName}}" (placeholder: "{{commentToTranslate}}"). Translate it faithfully into "{{commentLanguage}}" and render it using the proper "{{languageId}}" comment syntax.
Think about clarity and idiomatic phrasing in "{{commentLanguage}}" but do not add new technical claims or details that are not present in the source comment.
You must add the translated comment at the "{{placeholder}}" location.
If you fail to add it, a significant penalty will be applied.
It is important to follow "TRANSLATION_RULES" and "IMPORTANT".
The translation must be exact and free of misleading statements.
Unless explicitly instructed to modify other parts, output the input code exactly as provided.

<INSTRUCTIONS>
1. Carefully read the source comment text provided at "{{commentToTranslate}}" (and any adjacent context) to understand the exact meaning to translate.
2. Preserve technical terms and symbol names verbatim (do not translate identifiers, function names, or type names).
3. Translate the text into "{{commentLanguage}}", keeping tone concise and suitable for an inline code comment.
4. At the "{{placeholder}}" location, insert the translated comment in the correct "{{languageId}}" comment syntax (line or block comment as appropriate).
5. Keep the comment concise (preferably 1–4 lines). Do not expand the original content with additional explanation.
6. Do not add executable code, change identifiers, or alter code outside the edit block.
7. Always output the entire "{{startEditingHere}}" block exactly once, with your translated comment inserted at "{{placeholder}}".
8. When finished, output "{{stopEditingHere}}" immediately (no extra text).
</INSTRUCTIONS>

<TRANSLATION_RULES>
- Preserve identifiers, function names, types, file paths, error codes, and other code tokens exactly; do not translate them.
- If the source contains ambiguous wording, prefer a literal/neutral translation rather than adding assumptions.
- If the source contains shorthand, abbreviations, or non-grammatical notes, normalize them only as needed for clarity while preserving meaning.
</TRANSLATION_RULES>

<IMPORTANT>
- You MUST output the entire "{{startEditingHere}}" block exactly once.
- You MUST preserve all lines outside the edit block exactly as provided.
- Do not output any non-comment text inside the edit block except the single translated comment at "{{placeholder}}".
- Do not output comments with long explanations; be concise and faithful to the source.
- The inserted comment should be helpful to a maintainer reading the code for the first time, but must not add technical claims not present in the source.
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
The most recent edits are at the bottom.
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
Program comments must be written in "{{commentLanguage}}".{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for translation
const defaultAssistantPrompt =
`<think>
I will carefully read the provided source comment text "{{commentToTranslate}}" and produce a faithful translation into "{{commentLanguage}}", rendered using valid "{{languageId}}" comment syntax.
I will not add new information or technical claims beyond the source comment; if something is ambiguous I will prefer a neutral literal rendering.
I will preserve all code tokens (identifiers, types, function names, error codes) exactly.
I will insert only the translated comment (no executable code or extra text) at the "{{placeholder}}" location inside the "{{startEditingHere}}" ... "{{stopEditingHere}}" block.
I will output the entire edited "{{startEditingHere}}" block exactly once and then immediately emit "{{stopEditingHere}}".
The provided source code may also be outdated, so I must retrieve the latest version when available.
<CODE_INPUT>
{{latestSourceCodeBlock}}
</CODE_INPUT>
</think>

I will output only the code block with the inserted translated comment and no other text.{{additionalAssistantOutputPrompt}}
Here is the complete edited code block:
{{assistantSourceCodeBlockBforeCursor}}`;

//#######################################################################################
// Analysis Prompts (kept similar — optional for structural summarization)
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
 * Creates default YAML configuration prompt for translation
 */
export function getYamlDefaultTranslatePrompt(): YamlConfigMode {
	return {
		mode: 'Translate',
		extensions: ['*'],
		cursorAlwaysHead: true,
		placeholderSymbol: '',
		isDispOverwrite: true,
		isNoHighligh: true,
		isForceOverlay: true,
		isNoInsertStartStopSymbol: true,
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
		appendThinkPromptNewScope: "",
		appendThinkPromptRefactoring: "",
		appendThinkPromptAddition: "",
		analyzeSystemPrompt: defaultAnalyzeSystemPrompt,
		analyzeUserPrompt: defaultAnalyzeUserPrompt
	};
}

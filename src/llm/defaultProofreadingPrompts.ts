import { YamlPrompt } from '../utils/yamlConfig';

/**
 * Default prompts for code completion and analysis
 */

//#######################################################################################
// Completion Prompts
//#######################################################################################

// System Prompt for completion
const defaultSystemPrompt =
`You are an expert "{{languageId}}" document editor and proofreader.
Your task is to propose a minimal inline edit to correct spelling mistakes, typographical errors, and obvious orthographic/typographical inconsistencies at the cursor or within the editable block, while preserving the author's original phrasing, intent, and content.

RULES:
- Only perform edits that fix typos, spelling mistakes, obvious punctuation errors, and simple spacing issues.
- The text must be written in "{{commentLanguage}}".
- Do not invent new sentences, add new factual content, or introduce new arguments or examples.
- Do not change the author's tone, register, or intended meaning.
- Do not remove or rename named entities unless they are clear misspellings (e.g., "Micosoft" -> "Microsoft").
- Do not modify any text outside the "{{startEditingHere}}" ... "{{stopEditingHere}}" block.
- Preserve all formatting, line breaks, and paragraph structure exactly as the original, except for your changes within the edit block.
- Do not change tabs, indentation, heading levels, bullet list markers, or any other document formatting characters or structure; preserve them exactly.
- Do not output explanations, comments, or extra text outside of the edited text.
- Respond with only the full edited text block.{{additionalSystemPrompt}}`;

// User Prompt for completion
const defaultUserPrompt =
`Your task is to correct typographical and orthographic errors at the "{{placeholder}}" location in the given document block.
Follow the instructions and make only the minimal edits necessary to fix typos and clear mistakes.
Think carefully about preserving the original meaning and style.
You must apply edits inside the "{{placeholder}}" location or within the allowed edit block.
If you fail to make the requested spelling/typo corrections, the result will be considered incorrect.
It is important to follow "SPELLING_RULES" and "IMPORTANT".
Even small changes can alter meaning—choose conservative corrections.
Unless explicitly instructed to rewrite larger passages, output the input document exactly as provided.

<INSTRUCTIONS>
1. Carefully read the input text and identify only clear typos, misspellings, punctuation errors, doubled words, spacing issues, and obvious grammatical slips that do not require rewriting.
2. Refer to recent edit context if available to preserve the author's intent.
3. Make only the minimal character-level edits necessary to correct the error(s). You must not modify already-correct text.
4. Re-check whether your edits change meaning or tone; if they do, revert to a more conservative correction.
5. Output the flawless and minimal edited text, keeping all original content outside the edit block unchanged.
6. Finally, confirm by producing only the edited block and immediately end output at "{{stopEditingHere}}".
7. You must always output "{{stopEditingHere}}" exactly as is.
8. If necessary, you may also fix adjacent small errors within the allowed edit block, but do not perform stylistic rewrites.
</INSTRUCTIONS>

<SPELLING_RULES>
- Preserve proper nouns and branded names unless the original is an obvious misspelling.
- Preserve domain-specific terminology even if uncommon—only correct if clearly misspelled.
- Do not expand abbreviations or acronyms.
- Correct double words (e.g., "the the") and accidental character repeats.
- Fix misplaced punctuation that changes sentence structure only when the intended structure is obvious.
- Do not change measurements, dates, numbers, or code snippets unless they are obviously typographical errors (e.g., "20225" -> "2025").
</SPELLING_RULES>

<IMPORTANT>
- You MUST output the entire "{{startEditingHere}}" block exactly once.
- You MUST preserve all lines outside the edit block exactly as provided.
- Do not output comments with explanations or examples. Output only the edited document content.
- You MUST NOT change tabs, indentation, heading levels, bullet list markers, or any other document formatting outside the edit block.
</IMPORTANT>

<TEXT_SUMMARY>
{{sourceAnalysis}}
</TEXT_SUMMARY>

<TEXT_INPUT>
Since the following source text may be outdated, always make sure to check the latest version when referring to it.
{{sourceCodeBlock}}
</TEXT_INPUT>

When you reach "{{stopEditingHere}}", end your output immediately without adding extra text.
Preserve the document's original voice and formatting as much as possible.{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for completion
const defaultAssistantPrompt =
`<think>
Okay, I will carefully review the document and provide a minimal inline edit to correct typographical and obvious orthographic errors. I will only modify text within the "{{startEditingHere}}" ... "{{stopEditingHere}}" block provided in the snippet and I will not output anything outside that block. After finishing edits within the allowed range I will always output "{{stopEditingHere}}" to indicate the end, and I will exercise maximum care to ensure I do not output outside the editable range. I will ensure the output preserves the author's original meaning, tone, and formatting except for the corrected characters. That means I will not change paragraphing, line breaks, tabs, indentation, headings, bullet markers, or add/delete sentences unless absolutely necessary to correct a clear typographical error. I will not provide explanatory comments or notes. I will avoid substituting synonyms or paraphrasing; only character-level or minimal punctuation edits are allowed.
I will fix only obvious mistakes such as single-word misspellings, doubled words, stray characters, obvious punctuation slips, or spacing errors. I will not invent new content, add examples, or expand on the text. If a correction could plausibly change meaning, I will choose the more conservative correction or leave the original text unchanged.
The provided source text may also be outdated, so I must retrieve the latest version. I am required to always refer to this latest source text.
<TEXT_INPUT>
{{latestSourceCodeBlock}}
</TEXT_INPUT>
I have checked the latest source text. Check the number of lines and make sure to refer to this latest text for the relevant lines, never referencing the same lines in the main text.
Since some wording has been removed or modified, I will determine minimal rephrasing that restores clarity and politeness without adding content.
{{additionalAssistantThinkPrompt}}
I will all text will be written in "{{commentLanguage}}".
</think>

Sure! I will output only the edited text block and I will not forget to also output "{{stopEditingHere}}".{{additionalAssistantOutputPrompt}}
Here is the complete edited text block:
{{assistantSourceCodeBlockBforeCursor}}`;

//#######################################################################################
// Analysis Prompts
//#######################################################################################

// System Prompt for analysis
const defaultAnalyzeSystemPrompt =
`You are a document-analysis expert.
Summarize the given text from a high-level editorial perspective rather than implementation details.
Emphasize purpose, register, target audience, and sections that are sensitive to meaning changes.
Keep each item brief and at an editorial decision-making level of abstraction.
Use only the minimum necessary jargon and be concise.
Output in Markdown format, using bullet points under each heading.

Prohibited:
- Long lists of micro-level edits, step-by-step rewriting, or stylistic rewording suggestions.`;

// User Prompt for analysis
const defaultAnalyzeUserPrompt =
`Below is a text document. Summarize it focusing only on the "overall tone, audience, and high-level issues" to help plan minimal proofreading edits.

{{sourceCode}}

Output format:
\`\`\`
# Purpose and Audience
- (What the text aims to do and who it's for)
# High-level Issues
- (Tone inconsistencies, clarity risks, sensitive factual claims)
# Quick Proofreading Targets
- (Likely spots for typos, repeated words, inconsistent punctuation)
# Advice for Minimal Edits
- (Conservative rules to follow when making corrections)
\`\`\`
Output the result in "English".`;

//#######################################################################################
// YAML Configuration Creator
//#######################################################################################

/**
 * Creates default YAML configuration prompt
 */
export function getYamlDefaultProofreadingPrompt(): YamlPrompt {
	return {
		mode: 'Proofreading(experimental)',
		extensions: ['*'],
		cursorAlwaysHead: true,
		placeholderSymbol: '',
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
		analyzeSystemPrompt: defaultAnalyzeSystemPrompt,
		analyzeUserPrompt: defaultAnalyzeUserPrompt
	};
}

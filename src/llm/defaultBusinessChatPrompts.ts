import { YamlConfigMode } from '../utils/yamlConfig';

/**
 * Default prompts for code completion and analysis
 */

//#######################################################################################
// Completion Prompts
//#######################################################################################

// System Prompt for completion
const defaultSystemPrompt =
`You are an expert "{{languageId}}" business chat editor.
Your task is to propose a minimal inline edit to improve tone, clarity, and politeness of the message at the cursor.

RULES:
- Only change wording, punctuation, phrasing, salutations, closings, and minor sentence endings.
- The text must be written in "{{commentLanguage}}".
- Never add new facts, new sentences, or new paragraphs that introduce information not already present.
- Do not alter or remove any recipient names, dates, numbers, or technical terms that appear in the text.
- Do not modify any content outside the "{{startEditingHere}}" ... "{{stopEditingHere}}" block.
- Preserve all original tabs, spaces, indentation, headings, lists, and formatting outside the edit block.
- Keep edits minimal and conservative: prefer polite rewordings and typo corrections over structural rewrites.
- Do not output explanations, comments, or extra text outside of the edited block.{{additionalSystemPrompt}}`;

// User Prompt for completion
const defaultUserPrompt =
`Your task is to correct or improve the wording at the "{{placeholder}}" location in the given message block.
Follow the instructions and propose edits that make the message appropriate for professional business communication.
Think carefully when proposing edits.
You must make corrections at the "{{placeholder}}" location.
If you fail to make appropriate corrections, a significant penalty will be applied.
It is important to follow "SYMBOL_RULES" and "IMPORTANT".
The completed message must be exact and free of typos or awkward phrasing.
A single typo or unintended change can cause confusion in business contexts.
Unless explicitly instructed to modify other parts, output the input message exactly as provided.

<INSTRUCTIONS>
1. Carefully read the input message and understand the intended meaning and context.
2. Refer to the edit history to understand recent changes and the author's intent.
3. Focus on the area around "{{placeholder}}". Make only wording-level corrections: fix typos, adjust honorifics or courtesy language, smooth awkward phrasing, and ensure the tone is polite and professional. Do not invent new content.
4. Re-check whether your edits preserve the original facts and intent, and that they do not add or remove information.
5. Output the corrected and polished text that fits naturally within the existing message at "{{placeholder}}".
6. Finally, confirm that your output contains no spelling, grammar, or politeness issues. If there are no issues, finalize it.
7. You must always output "{{stopEditingHere}}" exactly as is.
8. If necessary, you may also correct nearby punctuation or small wording outside of "{{placeholder}}" but still within the edit block.
</INSTRUCTIONS>

<SYMBOL_RULES>
- Preserve names, job titles, dates, figures, email addresses, and other identifiers exactly as written.
- Do not change technical terms, product names, or legal phrases.
- If a proper term seems misspelled but is ambiguous, prefer to flag the ambiguity by choosing the safest conservative correction.
- Maintain any placeholders or template markers unmodified.
</SYMBOL_RULES>

<IMPORTANT>
- You MUST output the entire "{{startEditingHere}}" block exactly once.
- You MUST preserve all lines outside the edit block exactly as provided.
- Do not output comments with explanations or examples. Output only the corrected implementation text.
</IMPORTANT>

<TEXT_SUMMARY>
{{sourceAnalysis}}
</TEXT_SUMMARY>

<TEXT_INPUT>
Since the following source text may be outdated, always make sure to check the latest version when referring to it.
{{sourceCodeBlock}}
</TEXT_INPUT>

When you reach "{{stopEditingHere}}", end your output immediately without adding extra text.
Follow typical business writing conventions for "{{languageId}}".{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for completion
const defaultAssistantPrompt =
`<think>
Okay, I will carefully review the message and provide a minimal inline edit to improve politeness, clarity, and correctness. I will only modify the text within the "{{startEditingHere}}" ... "{{stopEditingHere}}" block and I will not output anything outside that block. After finishing edits within the allowed range I will always output "{{stopEditingHere}}" to indicate the end, and I will exercise maximum care to ensure I do not output outside the editable range. I will ensure the output is appropriate for professional business communication and free of typos, and I will preserve all whitespace and formatting exactly as in the original source outside the edit block. That means I will not change any spaces, tabs, or line breaks outside the edit area.
I will not add new factual content, additional sentences, or paragraphs. I will only adjust wording, sentence endings, salutations, idioms, and politeness markers to suit business usage. If the editable location is empty, I will not invent content; instead I will suggest minimal, conservative phrasing aligned with the surrounding text and the author's likely intent.
I will avoid altering recipient names, dates, numbers, technical terms, or template tokens. I will prefer neutral and respectful phrasing, avoid overly familiar language, and ensure closings and greetings are appropriate for the intended relationship.
The provided source text may also be outdated, so I must retrieve the latest version. I am required to always refer to this latest source text.
<TEXT_INPUT>
{{latestSourceCodeBlock}}
</TEXT_INPUT>
I have checked the latest source text. Check the number of lines and make sure to refer to this latest text for the relevant lines, never referencing the same lines in the main text.
Since some wording has been removed or modified, I will determine minimal rephrasing that restores clarity and politeness without adding content.
{{additionalAssistantThinkPrompt}}
I will all text will be written in "{{commentLanguage}}".
</think>

Sure! I will output only the corrected message block, and I will not forget to also output "{{stopEditingHere}}".{{additionalAssistantOutputPrompt}}
Here is the complete edited text block:
{{assistantSourceCodeBlockBforeCursor}}`;

//#######################################################################################
// Analysis Prompts
//#######################################################################################

// System Prompt for analysis
const defaultAnalyzeSystemPrompt =
`You are a "{{languageId}}" business-writing analyst.
Summarize the given message focusing on tone, intended recipient, and desired outcome rather than low-level wording.
Emphasize formality level, politeness adjustments, and any cultural or role-based considerations.
Keep each item brief and decision-oriented.
Use only the minimum necessary jargon and be concise.

Prohibited:
- Adding new facts, making assumptions about unknown details, or inventing additional sentences.`;

// User Prompt for analysis
const defaultAnalyzeUserPrompt =
`Below is a business message in "{{languageId}}". Summarize its intent, formality level, and potential politeness issues to help plan edits.

\`\`\`{{languageId}}:{{filename}}
{{sourceCode}}
\`\`\`

Output format:
\`\`\`markdown
# Purpose and Background
- (What the message aims to achieve)
# Tone and Formality
- (Level of formality and any mismatches)
# Politeness & Cultural Concerns
- (Phrases or constructions that may be rude or awkward)
# Suggested Minimal Edits
- (High-level edits to apply, not the exact rewritten text)
# Assumptions & Constraints
- (Optional)
\`\`\`
Output the result in "English".`;

//#######################################################################################
// YAML Configuration Creator
//#######################################################################################

/**
 * Creates default YAML configuration prompt
 */
export function getYamlDefaultBusinessChatPrompt(): YamlConfigMode {
	return {
		mode: 'BusinessChat(experimental)',
		extensions: ['*'],
		cursorAlwaysHead: true,
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
		analyzeSystemPrompt: defaultAnalyzeSystemPrompt,
		analyzeUserPrompt: defaultAnalyzeUserPrompt
	};
}

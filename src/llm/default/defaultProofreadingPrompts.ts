import { YamlConfigMode } from '../../utils/yamlConfig';

/**
 * Default prompts for code completion and analysis
 */

//#######################################################################################
// Completion Prompts
//#######################################################################################

// System Prompt for completion
const defaultSystemPrompt =
`You are an expert document editor and proofreader.
Your task is to minimally correct spelling, typographical, and obvious orthographic errors.`;

// User Prompt for completion
const defaultUserPrompt =
`Your task is to correct typographical and orthographic errors in the provided "TEXT_INPUT" written in "{{commentLanguage}}".
It is important to follow "EDITING_RULES".
Think conservatively and preserve the author's original phrasing, intent, tone, and formatting.
Do not add new content or modify meaning.
Unless explicitly instructed, output the input document exactly as provided, except for minimal corrections.

<EDITING_RULES>
- Only fix clear typos, misspellings, duplicated words, spacing issues, and obvious punctuation errors.
- Do not rewrite sentences, paraphrase, or improve style.
- Preserve proper nouns, technical terms, abbreviations, numbers, dates, and code snippets unless they are clearly incorrect.
- Do not modify named entities unless the original spelling is obviously wrong.
- Do not change tone, register, or level of formality.
- Do not introduce new facts, arguments, examples, or explanations.
- Do not change tabs, indentation, line breaks, heading levels, or bullet markers.
- Preserve all formatting exactly as-is, except for the minimal corrected characters.
</EDITING_RULES>

<TEXT_INPUT>
\`\`\`
{{aroundSnippetWithPlaceholderWithLine}}
{{latestAfterOutsideFirstWithLine}}
\`\`\`
</TEXT_INPUT>

You will output only the complete TEXT_INPUT with minimal corrections applied.
Do not output explanations, comments, or any text outside the edited document block.{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for completion
const defaultAssistantPrompt =
`{{additionalAssistantOutputPrompt}}\`\`\`
{{cursorLineBeforeWithLine}}`;

//#######################################################################################
// YAML Configuration Creator
//#######################################################################################

/**
 * Creates default YAML configuration prompt
 */
export function getYamlDefaultProofreadingPrompt(): YamlConfigMode {
	return {
		mode: 'Proofreading(experimental)',
		extensions: ['*'],
		cursorAlwaysHead: true,
		placeholderSymbol: '',
		isNoCheckStopSymbol: true,
		isNoInsertStartStopSymbolLatest: true,
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt
	};
}

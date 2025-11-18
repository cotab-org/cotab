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
Your task is translated comment.`;

// User Prompt for translation
const defaultUserPrompt =
`Your task is to translate the provided "CODE_INPUT" into "{{commentLanguage}}".
It is important to follow "TRANSLATION_RULES" and "IMPORTANT".
Think about clarity and idiomatic phrasing in "{{commentLanguage}}" but do not add new technical claims or details that are not present in the source comment.
The translation must be exact and free of misleading statements.
Unless explicitly instructed to modify other parts, output the input code exactly as provided.

<TRANSLATION_RULES>
- Preserve identifiers, function names, types, file paths, error codes, and other code tokens exactly; do not translate them.
- If the source contains ambiguous wording, prefer a literal/neutral translation rather than adding assumptions.
- If the source contains shorthand, abbreviations, or non-grammatical notes, normalize them only as needed for clarity while preserving meaning.
</TRANSLATION_RULES>

<IMPORTANT>
- You MUST preserve all lines outside the edit block exactly as provided.
- Do not output comments with long explanations; be concise and faithful to the source.
- The translated comment should be helpful to a maintainer reading the code for the first time, but must not add technical claims not present in the source.
</IMPORTANT>

<CODE_INPUT>
\`\`\`{{languageId}}
{{aroundSnippetWithPlaceholderWithLine}}
{{latestAfterOutsideFirstWithLine}}
\`\`\`
</CODE_INPUT>

{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for translation
const defaultAssistantPrompt =
`Sure! I will output only the code block with the translated comment in "CODE_INPUT" and no other text.{{additionalAssistantOutputPrompt}}
Here is the complete edited code in the {{CODE_INPUT}} block translated into "{{commentLanguage}}":
\`\`\`{{languageId}}
{{cursorLineBeforeWithLine}}`;

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
		isNoCheckStopSymbol: true,
		isNoInsertStartStopSymbolLatest: true,
		maxTokens: 512,	// default tokens x2
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
	};
}

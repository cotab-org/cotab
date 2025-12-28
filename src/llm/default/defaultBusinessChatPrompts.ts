import { YamlConfigMode } from '../../utils/yamlConfig';

/**
 * Default prompts for code completion and analysis
 */

//#######################################################################################
// Completion Prompts
//#######################################################################################

// System Prompt for completion
const defaultSystemPrompt =
`You are an expert business chat editor.
Your task is to minimally improve tone, clarity, and politeness for professional communication.`;

// User Prompt for completion
const defaultUserPrompt =
`Your task is to revise the provided "TEXT_INPUT" to be appropriate for professional business communication in "{{commentLanguage}}".
It is important to follow "EDITING_RULES".
Think conservatively and preserve the author's original intent, content, and structure.
Do not add new information or remove existing facts.
Unless explicitly instructed, output the input message exactly as provided, except for minimal improvements.

<EDITING_RULES>
- Only adjust wording, honorifics, punctuation, salutations, closings, and minor sentence endings.
- Fix typos or awkward phrasing only when it improves politeness or clarity.
- Do not add new sentences, paragraphs, facts, or implications.
- Preserve all names, job titles, dates, numbers, email addresses, identifiers, and technical terms exactly.
- Do not modify placeholders, template markers, or symbols.
- Do not change tone beyond making it neutral, polite, and business-appropriate.
- Preserve all formatting, line breaks, indentation, lists, and spacing exactly as-is.
</EDITING_RULES>

<TEXT_INPUT>
\`\`\`
{{aroundSnippetWithPlaceholderWithLine}}
{{latestAfterOutsideFirstWithLine}}
\`\`\`
</TEXT_INPUT>

You will output only the complete TEXT_INPUT with minimal, conservative corrections applied.
Do not output explanations, comments, or any text outside the corrected message block.{{additionalUserPrompt}}`;

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
export function getYamlDefaultBusinessChatPrompt(): YamlConfigMode {
	return {
		mode: 'BusinessChat(experimental)',
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

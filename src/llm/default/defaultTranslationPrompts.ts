import { YamlConfigMode } from '../../utils/yamlConfig';

/**
 * Default prompts for translating plain comment text into code-comments
 */
//#######################################################################################
// Translation Prompts
//#######################################################################################

// System Prompt for translation
const defaultSystemPrompt =
`You are an expert "{{languageId}}" code editor assistant.
Your task is translated text and comment.`;

// User Prompt for translation
const defaultUserPrompt =
`Your task is to translate the provided "CODE_INPUT" into "{{commentLanguage}}".
It is important to follow "TRANSLATION_RULES".
Think about clarity and idiomatic phrasing in "{{commentLanguage}}" but do not add new technical claims or details that are not present in the source comment or string literal.
The translation must be exact and free of misleading statements.
Unless explicitly instructed to modify other parts, output the input code exactly as provided.

<TRANSLATION_RULES>
- Preserve identifiers, function names, types, file paths, error codes, and other code tokens exactly; do not translate them.
- Translate comments, string literals, and other textual content.
- If the input contains ambiguous wording, prefer a literal/neutral translation rather than adding assumptions.
- If the input contains shorthand, abbreviations, or non-grammatical notes, normalize them only as needed for clarity while preserving meaning.
</TRANSLATION_RULES>

<CODE_INPUT>
\`\`\`{{languageId}}
{{aroundSnippetWithPlaceholderWithLine}}
{{latestAfterOutsideFirstWithLine}}
\`\`\`
</CODE_INPUT>

You will output only the code block with the translated text and comment in "CODE_INPUT" and no other text and comment.
Please output only the complete {{CODE_INPUT}} block translated into "{{commentLanguage}}".{{additionalUserPrompt}}`;

// Assistant thinking output Prompt for translation
const defaultAssistantPrompt =
`{{additionalAssistantOutputPrompt}}\`\`\`{{languageId}}
{{cursorLineBeforeWithLine}}`;


//#######################################################################################
// Translation Prompts
//#######################################################################################

// System Prompt for translation
const defaultTextSystemPrompt =
`You are an expert translation assistant.`;

// User Prompt for translation
const defaultTextUserPrompt =
`Your task is to translate the provided "TEXT_INPUT" into "{{commentLanguage}}".
It is important to follow "TRANSLATION_RULES".
Think about clarity and idiomatic phrasing in "{{commentLanguage}}" but do not add new technical claims or details that are not present in the "TEXT_INPUT".
The translation must be exact and free of misleading statements.

<TRANSLATION_RULES>
- If the input contains ambiguous wording, prefer a literal/neutral translation rather than adding assumptions.
- If the input contains shorthand, abbreviations, or non-grammatical notes, normalize them only as needed for clarity while preserving meaning.
- Even if multiple languages are mixed, translate all of them into "{{commentLanguage}}".
</TRANSLATION_RULES>

<TEXT_INPUT>
\`\`\`{{languageId}}
{{aroundSnippetWithPlaceholderWithLine}}
{{latestAfterOutsideFirstWithLine}}
\`\`\`
</TEXT_INPUT>

You will output only the translated block in "{{commentLanguage}}".`;

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
		isNoItalic: true,
		maxTokens: 512,	// default tokens x2
		systemPrompt: defaultSystemPrompt,
		userPrompt: defaultUserPrompt,
		assistantPrompt: defaultAssistantPrompt,
	};
}

export function getYamlDefaultTextTranslatePrompt(): YamlConfigMode {
	const mode = getYamlDefaultTranslatePrompt();
	mode.extensions = ["txt"];
	mode.systemPrompt = defaultTextSystemPrompt;
	mode.userPrompt = defaultTextUserPrompt;
	return mode;
}

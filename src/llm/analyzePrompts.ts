import { getYamlConfigPrompt } from '../utils/yamlConfig';
import { parseHandlebarsTemplate } from '../utils/cotabUtil';

/**
 * Generates prompts for source code analysis.
 * @param languageId Language ID e.g. 'typescript', 'python'
 * @param sourceCode Target source code full text
 */
export function buildAnalyzePrompts(languageId: string, filename: string, sourceCode: string): { systemPrompt: string; userPrompt: string } {

	// Create Handlebars context
	const handlebarsContext = {
		languageId,
		filename,
		sourceCode
	};

	// Get YAML prompt
	const yamlPrompt = getYamlConfigPrompt(filename);
	const systemPrompt = yamlPrompt.analyzeSystemPrompt || '';
	const userPrompt = yamlPrompt.analyzeUserPrompt || '';

	// Parse Handlebars templates
	const parsedSystemPrompt = parseHandlebarsTemplate(systemPrompt, handlebarsContext);
	const parsedUserPrompt = parseHandlebarsTemplate(userPrompt, handlebarsContext);

	return {
		systemPrompt: parsedSystemPrompt,
		userPrompt: parsedUserPrompt,
	};
}


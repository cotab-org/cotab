import { getYamlConfigPrompt } from '../utils/yamlConfig';
import { parseHandlebarsTemplate } from '../utils/cotabUtil';
import { getDefaultYamlConfigPrompt } from './defaultPrompts';

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
	const defaultPrompt = getDefaultYamlConfigPrompt();
	const systemPrompt = yamlPrompt?.analyzeSystemPrompt || defaultPrompt.analyzeSystemPrompt || '';
	const userPrompt = yamlPrompt?.analyzeUserPrompt || defaultPrompt.analyzeUserPrompt || '';

	// Parse Handlebars templates
	const parsedSystemPrompt = parseHandlebarsTemplate(systemPrompt, handlebarsContext);
	const parsedUserPrompt = parseHandlebarsTemplate(userPrompt, handlebarsContext);

	return {
		systemPrompt: parsedSystemPrompt,
		userPrompt: parsedUserPrompt,
	};
}


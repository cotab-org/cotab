
/**
 * Generates prompts for source code analysis.
 * @param languageId Language ID e.g. 'typescript', 'python'
 * @param sourceCode Target source code full text
 */
export function buildAnalyzePrompts(languageId: string, filename: string, sourceCode: string): { systemPrompt: string; userPrompt: string } {
const systemPrompt =
`You are a "${languageId}" code-analysis expert.
Summarize the given source code from a big-picture, architectural perspective rather than implementation details.
Emphasize purpose, separation of responsibilities, relationships among major components, I/O boundaries, and areas that are easy to extend. Avoid enumerating functions or variables and avoid step-by-step procedural explanations.
Keep each item brief and at a decision-making level of abstraction.
Use only the minimum necessary jargon and be concise.
Output in Markdown format, using bullet points under each heading.

Prohibited:
- Step-by-step procedures, pseudocode, or long lists of function/variable names
- Fine details of conditionals or exception handling, and algorithm implementation details`;

const userPrompt =
`Below is source code in "${languageId}". Summarize it focusing only on the "overall structure and intent" to help plan edits and new feature additions.

\`\`\`${languageId}:${filename}
${sourceCode}
\`\`\`

Output format:
\`\`\`markdown
# Purpose and Background
- (Detailed explanation of what this code solves/enables)
# Functional Blocks
- 3–5 major functions (role names only, no fine-grained explanations)
# Key Characteristics and Design Choices
- (Algorithms, design patterns, extension points, etc.)
# Advice for Future Extensions
- (Candidate extension points, how to manage dependencies, refactoring guidelines, testing strategy, etc.)
# Assumptions & Constraints: Preconditions and Environment Dependencies
- (Optional)
\`\`\`
Output the result in "English".`;

	return { systemPrompt, userPrompt };
}

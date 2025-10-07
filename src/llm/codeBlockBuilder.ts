import * as vscode from 'vscode';
import { buildAnalyzePrompts } from './analyzePrompts';
import { editHistoryManager } from '../managers/editHistoryManager';
import { logInfo, logError, logWarning } from '../utils/logger';
import { AiClient } from './llmProvider';
import { getSymbolYaml, symbolManager } from '../managers/symbolManager';
import { EditorContext } from '../utils/editorContext';
import { getConfig } from '../utils/config';
import { showProgress, hideProgress, lockProgress } from '../utils/cotabUtil';

const ANALYSIS_MIN_LINE_COUNT = 10;
const CACHE_EXPIRE_TIME = 1000 * 60 * 5;
const EDIT_HISTORY_MIN_LINE_COUNT = 10;

interface CacheData {
    // Cached data body
    data: string;
    // Cache acquisition time (Unix time ms)
    cachedTime: number;
    // Target document version
    version: number;
    // Supplementary information
    extraData?: string;
}

export interface CodeBlocks {
	sourceAnalysis: string;
	symbolCodeBlock: string;
	editHistoryCodeBlock: string;
}

class CodeBlockBuilder {	
    public sourceAnalysisCache = new Map<string, CacheData>();
    public symbolCodeBlockCache = new Map<string, CacheData>();

	async buildCodeBlocks(
		client: AiClient,
		editorContext: EditorContext,
		currentCursorLine: number,
		token: vscode.CancellationToken,
		checkAborted?: () => boolean
	): Promise<CodeBlocks> {

		// Build source analysis
		const sourceAnalysis = await this.buildSourceAnalysis(client, editorContext, currentCursorLine, token, checkAborted);

		// Build symbol code block
		const symbolCodeBlock = this.buildSymbolCodeBlock(editorContext);

		// Build edit history code block
		const editHistoryCodeBlock = this.buildEditHistoryCodeBlock(editorContext, currentCursorLine);

		return {
			sourceAnalysis,
			symbolCodeBlock,
			editHistoryCodeBlock
		};
	}

	private async buildSourceAnalysis(
		client: AiClient,
		editorContext: EditorContext,
		currentCursorLine: number,
		token: vscode.CancellationToken,
		checkAborted?: () => boolean
	): Promise<string> {
		// Get description of entire source on first run
		const cachedAnalysis = this.sourceAnalysisCache.get(editorContext.documentUri);

        let isRefresh = false;

        if (cachedAnalysis && cachedAnalysis.version !== editorContext.version) {
            const cachedFullSourceCode = cachedAnalysis.extraData ?? '';
            const fullSourceCode = editorContext.documentText;
            // Whether 5+ minutes have passed or character count differs by 10% or more
            if (cachedAnalysis.cachedTime + CACHE_EXPIRE_TIME < Date.now() &&
                cachedFullSourceCode.length * 0.1 < Math.abs(cachedFullSourceCode.length - fullSourceCode.length)) {
                isRefresh = true;
            }
        }

		if (!cachedAnalysis || isRefresh) {
            const fullSourceCode = editorContext.documentText;
			const lineCount = fullSourceCode.replace(/\r?\n/g, '\n').split('\n').filter(line => line.trim() !== '').length;
			if (ANALYSIS_MIN_LINE_COUNT < lineCount) {
				const { systemPrompt, userPrompt } = buildAnalyzePrompts(editorContext.languageId,
																editorContext.relativePath, fullSourceCode);
	
				try {
					showProgress('analyzing', new vscode.Position(currentCursorLine, 0));
					lockProgress(true);
					logInfo(`Source analysis started ${editorContext.documentUri}`);
					let sourceAnalysis = await client.chatCompletions({
						systemPrompt,
						userPrompt,
						maxTokens: 2048,
						maxLines: 128,
						// Don't cancel analysis as it's infrequent.
						// abortSignal: token,
						checkAborted,
					});
					sourceAnalysis = sourceAnalysis.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
					const cacheData: CacheData = {
						data: sourceAnalysis,
						cachedTime: Date.now(),
						version: editorContext.version
					};
					this.sourceAnalysisCache.set(editorContext.documentUri, cacheData);
					logInfo(`Source analysis completed ${editorContext.documentUri} Result:\n${sourceAnalysis}`);
				}
				catch (error) {
					logError(`Error occurred during source analysis: ${error}`);
				}
				finally {
					lockProgress(false);
					hideProgress();
				}
			}
		}
		const analysisData = this.sourceAnalysisCache.get(editorContext.documentUri);
		return analysisData ? analysisData.data : 'The source code has no summary.';
	}

	private buildSymbolCodeBlock(editorContext: EditorContext): string {
		const cachedSymbols = symbolManager.getFilesByLanguageId(editorContext.languageId);

		const { maxSymbolCount } = getConfig();
		let symbolCodeBlocks: string[] = [];
		let symbolTotalCount = 0;
		for (const cachedSymbol of cachedSymbols) {
			const isSourceFile = cachedSymbol.extname === 'c' ||
				cachedSymbol.extname === 'cpp' ||
				cachedSymbol.extname === 'cc' ||
				cachedSymbol.extname === 'cxx';

			// Exclude self, exclude if no symbols, exclude source files
			if (cachedSymbol.symbols.length === 0 ||
				cachedSymbol.documentUri === editorContext.documentUri ||
				isSourceFile) {
				continue;
			}
			const { codeBlock, count: symbolCount } = getSymbolYaml(cachedSymbol);
			symbolCodeBlocks.push(codeBlock);
			symbolTotalCount += symbolCount;

			if (getConfig().maxSymbolCount < symbolTotalCount) {
				break;
			}
		}
		
		logInfo(`Symbols: ${cachedSymbols.length} files, ${symbolTotalCount} symbols`);

		const totalCodeBlock =
`\`\`\`yaml
${symbolCodeBlocks.join('\n\n')}
\`\`\``;
		const cacheData: CacheData = {
			data: totalCodeBlock,
			cachedTime: Date.now(),
			version: editorContext.version
		};
		this.symbolCodeBlockCache.set(editorContext.documentUri, cacheData);
		return totalCodeBlock || '# There are no symbols.';
	}

	private buildEditHistoryCodeBlock(editorContext: EditorContext, currentCursorLine: number): string {
		let histories: string[] = [];
		const editHistory = editHistoryManager.getEdits();
		logInfo(`Edit history: ${editHistory.length} items`);

		for (const edit of editHistory) {
			// // Ignore recent edits for prompt cache efficiency
			// if (edit.range.start.line - 10 < currentCursorLine &&
			// 	currentCursorLine < edit.range.end.line + 10) {
			// 	//continue;
			// }

            const originalTexts = edit.originalText.split('\n').map(text => text.trim()).filter(text => 0 < text.length).slice(0, EDIT_HISTORY_MIN_LINE_COUNT);
			const originalContent = (1 < originalTexts.length ? "|\n    " : "") + originalTexts.join('\n    ');

			const newTexts = edit.newText.split('\n').map(text => text.trim()).filter(text => 0 < text.length).slice(0, EDIT_HISTORY_MIN_LINE_COUNT);
			const newContent = (1 < newTexts.length ? "|\n    " : "") +  newTexts.join('\n    ');

			// Ignore if no letters (English, Japanese, etc.) are included
			if (!/[\p{L}]/u.test(originalContent) && !/[\p{L}]/u.test(newContent)) {
				continue;
			}

			// file
			const isCurrent = (editorContext.documentUri === edit.document.uri.toString());
			const fileContent = isCurrent ? 'current' : 'other';

			// lines
			const lineArr = Array.from({length: edit.range.end.line - edit.range.start.line + 1});
			const linesContent = '[' + lineArr.map((_, i) => `${1 + i + edit.range.start.line}`).join(',') + ']';
			const linesOption = isCurrent ? `\n  lines: ${linesContent}` : ``;

			const action = (edit.type === 'copy')
? `- action: ${edit.type}
  content: ${newContent}`
: `- action: ${edit.type}${linesOption}
  file: ${fileContent}
  before: ${originalContent}
  after: ${newContent}`;
			histories.push(action);
		}

		const codeBlock = histories.join('\n') || '# There are no edit histories.';
		const editHistoryCodeBlock =
`\`\`\`yaml
${codeBlock}
\`\`\``;
		return editHistoryCodeBlock;
	}
}

export const codeBlockBuilder = new CodeBlockBuilder();

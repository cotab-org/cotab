import * as vscode from 'vscode';
import { buildAnalyzePrompts } from './analyzePrompts';
import { editHistoryManager } from '../managers/editHistoryManager';
import { logInfo, logError, logWarning } from '../utils/logger';
import { AiClient } from './llmProvider';
import { getSymbolYaml, symbolManager } from '../managers/symbolManager';
import { EditorContext } from '../utils/editorContext';
import { getConfig } from '../utils/config';
import { showProgress, hideProgress, lockProgress } from '../utils/cotabUtil';
import { diagnosticsManager } from '../managers/diagnosticsManager';

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
	editHistoryActions: EditHistoryAction[];
	errorContext: DiagnosticsContext;
}

export interface EditHistoryAction {
	action: string;
	file?: string;
	lines?: number[];
	before?: string;
	after?: string;
	content?: string;
}

type DiagnosticsType = [number, string, vscode.Diagnostic];

export interface DiagnosticsContext {
	cursorError: DiagnosticsType[];
	otherErrors: DiagnosticsType[];
}

export function makeYamlFromEditHistoryActions(editHistoryActions: EditHistoryAction[]): string {
	const codeBlocks: string[] = [];

	for (const action of editHistoryActions) {
		let codeBlock = '';
		if (action.action === 'copy') {
			codeBlock += `- action: ${action.action}`;
			codeBlock += `\n  content: ${action.content}`;
		}
		else if (action.action === 'reject') {
			codeBlock += `- action: ${action.action}`;
			codeBlock += `\n  content: ${action.content}`;
		}
		else {
			codeBlock += `- action: ${action.action}`;
			codeBlock += `\n  file: ${action.file}`;
			if (action.file === 'current') {
				codeBlock += `\n  lines: [${action.lines?.join(',')}]`;
			}
			codeBlock += `\n  before: ${action.before}`;
			codeBlock += `\n  after: ${action.after}`;
		}

		codeBlocks.push(codeBlock);
	}
	const text = (0 < codeBlocks.length) ? codeBlocks.join('\n') : '# There are no edit histories.';
	return `\`\`\`yaml\n${text.replace(/```/g, '\\`\\`\\`')}\n\`\`\``;
}

export function makeYamlFromErrors(editorContext: EditorContext, diagnosticsContext: DiagnosticsContext):
{cursorErrorCodeBlock: string, otherErrorCodeBlock: string} {
	let cursorErrorYaml = '';
	let otherErrorYaml = '';

	const makeContent = (uri: string, diag: vscode.Diagnostic) => {
		const isCurrent = editorContext.documentUri === uri.toString();

		// ignore cannot open source file. because referencing libraries etc. always causes this.
		if (diag.message.includes('cannot open source file')) return '';
		if (diag.message.includes('#include errors detected')) return '';

		let yaml = '';
		yaml += `- file: ${isCurrent ? 'current' : 'other'}\n`;
		yaml += `  message: ${diag.message}\n`;
		if (isCurrent) {
			yaml += `  line: ${diag.range.start.line + 1}\n`;
		}
		return yaml;
	}

	for (const [_, documentUri, diag] of diagnosticsContext.cursorError) {
		cursorErrorYaml += makeContent(documentUri, diag);
	}

	for (const [_, documentUri, diag] of diagnosticsContext.otherErrors) {
		otherErrorYaml += makeContent(documentUri, diag);
	}

// If no cursor-related errors were found, skip generating the block to avoid empty output
const cursorErrorCodeBlock = (cursorErrorYaml === '') ? '' :
`\`\`\`yaml
${cursorErrorYaml.replace(/```/g, '\\`\\`\\`')}
\`\`\``;

const otherErrorCodeBlock = (otherErrorYaml === '') ? '' :
`\`\`\`yaml
${otherErrorYaml.replace(/```/g, '\\`\\`\\`')}
\`\`\``;
	
	return { cursorErrorCodeBlock, otherErrorCodeBlock };
}

class CodeBlockBuilder {	
    public sourceAnalysisCache = new Map<string, CacheData>();
    public symbolCodeBlockCache = new Map<string, CacheData>();

	async buildCodeBlocks(
		client: AiClient,
		editorContext: EditorContext,
		currentCursorLine: number,
		token: vscode.CancellationToken,
		checkAborted?: () => boolean,
	): Promise<CodeBlocks> {

		// Build source analysis
		const sourceAnalysis = await this.buildSourceAnalysis(client, editorContext, currentCursorLine, token, checkAborted);

		// Build symbol code block
		const symbolCodeBlock = this.buildSymbolCodeBlock(editorContext);

		// Build edit history code block
		const editHistoryActions = this.buildEditHistoryActions(editorContext, currentCursorLine);

		// Build diagnostics code block
		const errorContext = this.buildErrorContext(editorContext, currentCursorLine);

		return {
			sourceAnalysis,
			symbolCodeBlock,
			editHistoryActions,
			errorContext
		};
	}

	private async buildSourceAnalysis(
		client: AiClient,
		editorContext: EditorContext,
		currentCursorLine: number,
		token: vscode.CancellationToken,
		checkAborted?: () => boolean
	): Promise<string> {
		if (! getConfig().enableCodeSummary) {
			return 'The source code has no summary.';
		}
		// Get description of entire source on first run
		const cachedAnalysis = this.sourceAnalysisCache.get(editorContext.documentUri);

        let isRefresh = false;

        if (cachedAnalysis && cachedAnalysis.version !== editorContext.version) {
            const cachedFullSourceCode = cachedAnalysis.extraData ?? '';
            const fullSourceCode = editorContext.documentText.fullText;
            // Whether 5+ minutes have passed or character count differs by 10% or more
            if (cachedAnalysis.cachedTime + CACHE_EXPIRE_TIME < Date.now() &&
                cachedFullSourceCode.length * 0.1 < Math.abs(cachedFullSourceCode.length - fullSourceCode.length)) {
                isRefresh = true;
            }
        }

		if (!cachedAnalysis || isRefresh) {
            const fullSourceCode = editorContext.documentText.trancatedTop;
			const lineCount = fullSourceCode.replace(/\r?\n/g, '\n').split('\n').filter(line => line.trim() !== '').length;
			if (ANALYSIS_MIN_LINE_COUNT < lineCount) {
				const { systemPrompt, userPrompt } = buildAnalyzePrompts(editorContext.languageId,
																editorContext.relativePath, fullSourceCode);
	
				if (systemPrompt || userPrompt) {
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
		}
		const analysisData = this.sourceAnalysisCache.get(editorContext.documentUri);
		return analysisData ? analysisData.data : 'The source code has no summary.';
	}

	private buildSymbolCodeBlock(editorContext: EditorContext): string {
		const cachedSymbols = symbolManager.getFilesByLanguageId(editorContext.languageId);

		const config = getConfig();
		const symbolCodeBlocks: string[] = [];
		let charTotalCount = 0;
		for (const cachedSymbol of cachedSymbols) {
			if (cachedSymbol.symbols.length === 0) continue;

			if (! editorContext.isTrancatedCode()) {
				const isSourceFile = cachedSymbol.extname === 'c' ||
					cachedSymbol.extname === 'cpp' ||
					cachedSymbol.extname === 'cc' ||
					cachedSymbol.extname === 'cxx';

				// Exclude self, exclude if no symbols, exclude source files
				if (cachedSymbol.documentUri === editorContext.documentUri ||
					isSourceFile) {
					continue;
				}
			}
			const { codeBlock, useCharCount: charCount } = getSymbolYaml(cachedSymbol, config.maxSymbolCharNum);

			if (config.maxSymbolCharNum < charTotalCount + charCount) {
				break;
			}
			symbolCodeBlocks.push(codeBlock);
			charTotalCount += charCount;
		}
		
		logInfo(`Symbols: ${cachedSymbols.length} files, ${charTotalCount} symbols`);

		const totalCodeBlock = symbolCodeBlocks
			.map(block =>
`<SYMBOL_CONTEXT>
\`\`\`yaml
${block.replace(/```/g, '\\`\\`\\`')}
\`\`\`
</SYMBOL_CONTEXT>`).join('\n');
		const cacheData: CacheData = {
			data: totalCodeBlock,
			cachedTime: Date.now(),
			version: editorContext.version
		};
		this.symbolCodeBlockCache.set(editorContext.documentUri, cacheData);
		return totalCodeBlock || '# There are no symbols.';
	}

	private buildEditHistoryActions(editorContext: EditorContext, currentCursorLine: number): EditHistoryAction[] {
		const histories: string[] = [];
		const editHistory = editHistoryManager.getEdits();
		logInfo(`Edit history: ${editHistory.length} items`);

		const editHistoryActions : EditHistoryAction[] = [];
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
			const lines = lineArr.map((_, i) => 1 + i + edit.range.start.line);
			const linesContent = '[' + lines.join(',') + ']';
			const linesOption = isCurrent ? `\n  lines: ${linesContent}` : ``;

			if (edit.type === 'copy') {
				editHistoryActions.push({
					action: edit.type,
					content: newContent,
				});
			}
			else if (edit.type === 'reject') {
				if (newContent !== '') {
					editHistoryActions.push({
						action: edit.type,
						file: fileContent,
						lines: isCurrent ? lines : undefined,
						// content: newContent,
						content: edit.newText.split('\n').filter(text => 0 < text.length).slice(0, 1).join('\n'),
					});
				}
			}
			else {
				editHistoryActions.push({
					action: edit.type,
					file: fileContent,
					lines: isCurrent ? lines : undefined,
					before: originalContent,
					after: newContent,
				});
			}
		}

		return editHistoryActions;
	}

	private buildErrorContext(editorContext: EditorContext, currentCursorLine: number): DiagnosticsContext {
		const diagnosticsMap = diagnosticsManager.getErrors(editorContext.document, currentCursorLine);
		
		const errorContext: DiagnosticsContext = {
			cursorError: [],
			otherErrors: []
		};

		if (!diagnosticsMap || diagnosticsMap.size === 0) return errorContext;

		let addIdx = 0;
		const sortedErrorList: DiagnosticsType[] = [];
		// first: current file
		if (diagnosticsMap.has(editorContext.documentUri)) {
			const diagnostics = diagnosticsMap.get(editorContext.documentUri)!;
			// sorted from cursor line 
			const sortedFromCursorLine = diagnostics.sort((a, b) => {
				const aFromCursor = Math.abs(a.range.start.line - currentCursorLine);
				const bFromCursor = Math.abs(b.range.start.line - currentCursorLine);
				return aFromCursor - bFromCursor;
			});
			for (const diag of sortedFromCursorLine) {
				sortedErrorList.push([addIdx++, editorContext.documentUri, diag]);
			}
		}
		// then: other files
		for (const [documentUri, diagnostics] of diagnosticsMap) {
			if (documentUri === editorContext.documentUri) continue;
			for (const diag of diagnostics) {
				sortedErrorList.push([addIdx++, documentUri, diag]);
			}
		}

		// top 6
		const topErrorList = sortedErrorList.slice(0, 6);

		// cursor line 
		const cursorError = [];
		for(const error of topErrorList) {
			if (error[1] === editorContext.documentUri &&
			error[2].range.start.line === currentCursorLine) {
				cursorError.push(error);
			}
		}

		// other
		const otherErrors = topErrorList.slice(cursorError.length);

		// sort
		const sortedOtherErrors = otherErrors.sort((a, b) => {
			if (a[1] === b[1] && a[1] === editorContext.documentUri) {
				return a[2].range.start.line - b[2].range.start.line;
			}
			else {
				return (a[0] as number) - (b[0] as number);
			}
		});

		errorContext.cursorError = cursorError;
		errorContext.otherErrors = sortedOtherErrors;
		return errorContext;
	}

	private severityToString(sev: vscode.DiagnosticSeverity): string {
		switch (sev) {
			case vscode.DiagnosticSeverity.Error:
				return 'Error';
			case vscode.DiagnosticSeverity.Warning:
				return 'Warning';
			case vscode.DiagnosticSeverity.Information:
				return 'Information';
			case vscode.DiagnosticSeverity.Hint:
				return 'Hint';
			default:
				return 'Unknown';
		}
	}
}

export const codeBlockBuilder = new CodeBlockBuilder();





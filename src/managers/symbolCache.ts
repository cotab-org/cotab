import * as vscode from 'vscode';
import * as path from 'path';
import { logDebug, logInfo } from '../utils/logger';
import { tabHistoryManager } from './TabHistoryManager';

export interface CachedSymbol {
	filePath: string;	// full path
	fileName: string;	// only filename
	extname: string;	// file extension(no dot:filename.ext -> ext)
	relativePath: string;	// relative path from workspace
	documentUri: string;	// document uri
	languageId: string;	// language id
	version: number;	// document version
	symbols: vscode.DocumentSymbol[];
	cachedAt: number; // Unix timestamp
	lastAccessed: number; // Unix timestamp
}

export interface SymbolMetaInfo {
	type: string;
	name: string;
	content: string;
	line: number;
	column: number;
	children?: SymbolMetaInfo[];
}

export interface SymbolSignatureInfo {
	name: string;
	//signature?: string;
	definition?: string;
	//parameters?: string[];
	//returnType?: string;
	documentation?: string;
	sourceLanguage?: string;
}

export type ExtendedDocumentSymbol = vscode.DocumentSymbol & {
	signatureInfo?: SymbolSignatureInfo;
};

export class SymbolCacheManager {
	private cache = new Map<string, CachedSymbol>();
	private accessOrder: string[] = []; // URI list in latest access order

	/**
	 * Cache document symbol information
	 */
	async cacheDocumentSymbols(uri: vscode.Uri, document?: vscode.TextDocument): Promise<void> {
		const uriString = uri.toString();
		const doc = document || await vscode.workspace.openTextDocument(uri);
		
		let symbols: vscode.DocumentSymbol[] = [];
		try {
			symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
												'vscode.executeDocumentSymbolProvider',
												uri);
			if (symbols && 0 < symbols.length) {
				await this.enrichSymbolsWithHover(uri, symbols, doc.languageId);
			}
		} catch (error) {
			logDebug(`Failed to cache symbols for ${uriString}: ${error}`);
		}

		if (symbols && 0 < symbols.length) {				
			logDebug(`Cached ${symbols.length} symbols for ${uriString} (${doc.languageId})`);
		}
		const basicSymbol: CachedSymbol = {
			filePath: uri.fsPath,
			fileName: path.basename(uri.fsPath),
			extname: path.extname(uri.fsPath).slice(1),
			relativePath: vscode.workspace.asRelativePath(uri),
			documentUri: uriString,
			languageId: doc.languageId,
			version: doc.version,
			symbols: (symbols && 0 < symbols.length) ? symbols : [],
			cachedAt: Date.now(),
			lastAccessed: Date.now()
		};
		this.cache.set(uriString, basicSymbol);
		this.updateAccessOrder(uriString);
	}

	/**
	 * Get symbol information from cache
	 */
	getCachedSymbols(uri: vscode.Uri | string): CachedSymbol | undefined {
		const uriString = typeof uri === 'string' ? uri : uri.toString();
		const cached = this.cache.get(uriString);
		
		if (cached) {
			cached.lastAccessed = Date.now();
			this.updateAccessOrder(uriString);
		}
		
		return cached;
	}

	/**
	 * List files with the same language as the currently open code in latest access order
	 */
	getFilesByLanguageId(languageId: string): CachedSymbol[] {
		const result: CachedSymbol[] = [];
		
		// Collect files with the specified language according to access order
		for (const uriString of this.accessOrder) {
			const cached = this.cache.get(uriString);
			if (cached && cached.languageId === languageId) {
				result.push(cached);
			}
		}

		// Sort using TabHistoryManager
		const tabHistory = tabHistoryManager.getHistory();
		result.sort((a, b) => {
			let aIndex = tabHistory.findIndex((h) => h.uri.toString() === a.documentUri);
			if (aIndex < 0) {
				aIndex = this.accessOrder.findIndex((s) => s === a.documentUri);
				if (aIndex < 0) {
					aIndex = 9999;
				}
			}
			let bIndex = tabHistory.findIndex((h) => h.uri.toString() === b.documentUri);
			if (bIndex < 0) {
				bIndex = this.accessOrder.findIndex((s) => s === b.documentUri);
				if (bIndex < 0) {
					bIndex = 9999;
				}
			}
			return aIndex - bIndex;
		});
		
		return result;
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cache.clear();
		this.accessOrder = [];
		logInfo('Symbol cache cleared');
	}

	/**
	 * Remove specific URI from cache
	 */
	removeFromCache(uri: vscode.Uri | string): void {
		const uriString = typeof uri === 'string' ? uri : uri.toString();
		this.cache.delete(uriString);
		
		// Also remove from access order
		const index = this.accessOrder.indexOf(uriString);
		if (-1 < index) {
			this.accessOrder.splice(index, 1);
		}
	}

	/**
	 * Remove old cache entries (those not accessed for a certain period)
	 */
	cleanupOldCache(maxAgeHours: number = 24): void {
		const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);
		const toRemove: string[] = [];
		
		for (const [uriString, cached] of this.cache.entries()) {
			if (cached.lastAccessed < cutoffTime) {
				toRemove.push(uriString);
			}
		}
		
		for (const uriString of toRemove) {
			this.removeFromCache(uriString);
		}
		
		if (0 < toRemove.length) {
			logInfo(`Cleaned up ${toRemove.length} old cache entries`);
		}
	}

	/**
	 * Update access order
	 */
	private updateAccessOrder(uriString: string): void {
		// Remove existing entry
		const index = this.accessOrder.indexOf(uriString);
		if (-1 < index) {
			this.accessOrder.splice(index, 1);
		}
		
		// Add to the beginning (latest access)
		this.accessOrder.unshift(uriString);
	}



	private readonly functionLikeKinds = new Set<vscode.SymbolKind>([
		vscode.SymbolKind.Function,
		vscode.SymbolKind.Method,
		vscode.SymbolKind.Constructor
	]);

	private async enrichSymbolsWithHover(uri: vscode.Uri, symbols: vscode.DocumentSymbol[], languageId: string): Promise<void> {
		for (const symbol of symbols) {
			const info = await this.fetchSignatureInfo(uri, symbol as ExtendedDocumentSymbol, languageId);
			if (info) {
				const extended = symbol as ExtendedDocumentSymbol;
				extended.signatureInfo = info;
			}
			// recursible call of children
			// function type, it does not use recursion.
			if (! this.functionLikeKinds.has(symbol.kind) &&
				symbol.children && symbol.children.length) {
				await this.enrichSymbolsWithHover(uri, symbol.children, languageId);
			}
		}
	}

	private async fetchSignatureInfo(uri: vscode.Uri, symbol: ExtendedDocumentSymbol, languageId: string): Promise<SymbolSignatureInfo | undefined> {
		try {
			const position = symbol.selectionRange.start;
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
				'vscode.executeHoverProvider',
				uri,
				position
			);

			if (!hovers || hovers.length === 0) {
				return undefined;
			}

			const hoverData = this.extractHoverContents(hovers);
			for (const entry of hoverData) {
				
				// one line function definition
				let match: RegExpExecArray | null;
				let definition: string | undefined = undefined;
				const codeBlockRegex = /```[\w+-]*\n([\s\S]*?)```/g;
				while ((match = codeBlockRegex.exec(entry.text))) {
					definition = match[1].replace(/\r?\n/g, '\n').trim();
					definition = definition.replace(/^\(.*?\)\s*/g, '');	// remove status in "(loading...) symbolname" format.
					break;
				}

				if (!definition) {
					return undefined;
				}

				const info: SymbolSignatureInfo = {
					name: symbol.name,
					definition,
					documentation: entry.documentation?.trim() || undefined,
					sourceLanguage: entry.language || languageId
				};

				return info;
			}
		} catch (error) {
			logDebug(`Failed to fetch signature via hover for ${uri.toString()}#${symbol.name}: ${error}`);
		}

		return undefined;
	}

	private extractHoverContents(hovers: vscode.Hover[]): { text: string; documentation?: string; language?: string }[] {
		const results: { text: string; documentation?: string; language?: string }[] = [];

		for (const hover of hovers) {
			for (const content of hover.contents) {
				let value = '';
				let language: string | undefined;

				if ((content as vscode.MarkdownString).value !== undefined) {
					const markdown = content as vscode.MarkdownString;
					value = markdown.value ?? '';
				}

				if (!value && typeof (content as unknown as { value?: string }).value === 'string') {
					value = (content as unknown as { value?: string }).value ?? '';
				}

				if (!value && typeof (content as unknown as { language?: string; value?: string }).value === 'string') {
					const marked = content as unknown as { language?: string; value?: string };
					value = marked.value ?? '';
					language = marked.language;
				}

				if (!value && typeof content === 'string') {
					value = content;
				}

				if (!value) {
					continue;
				}

				const documentation = this.extractNonCodeDocumentation(value);
				if (!language) {
					const fenceMatch = value.match(/```(\w+)/);
					if (fenceMatch) {
						language = fenceMatch[1];
					}
				}

				results.push({
					text: value,
					documentation,
					language
				});
			}
		}

		return results;
	}
	
	private extractNonCodeDocumentation(markdownText: string): string | undefined {
		const lines = markdownText.split(/\r?\n/);
		let inCodeBlock = false;
		const docLines: string[] = [];

		for (const line of lines) {
			if (line.trim().startsWith('```')) {
				inCodeBlock = !inCodeBlock;
				continue;
			}

			if (inCodeBlock) {
				continue;
			}

			const trimmed = line.trim();
			if (trimmed.length === 0) {
				continue;
			}

			docLines.push(trimmed);
		}

		if (docLines.length === 0) {
			return undefined;
		}

		return docLines.join(' ');
	}

	/**
	 * Update cache when document is modified
	 */
	async updateCacheOnDocumentChange(uri: vscode.Uri, document: vscode.TextDocument): Promise<void> {
		const uriString = uri.toString();
		const cached = this.cache.get(uriString);
		
		// Only update cache when version changes
		if (!cached || cached.version !== document.version) {
			await this.cacheDocumentSymbols(uri, document);
		}
	}
}


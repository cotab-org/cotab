import * as vscode from 'vscode';
import { SymbolCacheManager, CachedSymbol, ExtendedDocumentSymbol, SymbolMetaInfo } from './symbolCache';
import { logDebug, logInfo } from '../utils/logger';

export function registerSymbolManager(disposables: vscode.Disposable[]) {
	symbolManager = new SymbolManager();
	disposables.push(symbolManager);
}

// Singleton instance
export let symbolManager: SymbolManager;

// Cache manages symbols of open files and returns them in viewing order
class SymbolManager implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];
	private timeoutHandle: NodeJS.Timeout | undefined;

	private documentChangeTimers = new Map<string, NodeJS.Timeout>();

	private readonly symbolCacheManager: SymbolCacheManager = new SymbolCacheManager();

	constructor() {
		// Initialization processing right after startup
		this.timeoutHandle = setTimeout(() => {
			this.initializeLazily();
		}, 1500); // Initialize after 1.5 seconds
		
		this.disposables.push(
			new vscode.Disposable(() => clearTimeout(this.timeoutHandle))
		);
	}

	dispose(): void {
		// Clear document change timers
		for (const timer of this.documentChangeTimers.values()) {
			clearTimeout(timer);
		}
		this.documentChangeTimers.clear();

		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.disposables = [];
		logInfo('Symbol Cache Manager disposed');
	}

	// Symbol provider initialization takes time, so initialize lazily.
	initializeLazily(): void {
		logInfo('Initializing Symbol Cache Manager');

		// Event when active editor changes
		const activeEditorChange = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (editor) {
				await this.handleActiveEditorChange(editor);
			}
		});

		// Event when document changes
		const documentChange = vscode.workspace.onDidChangeTextDocument(async (event) => {
			await this.handleDocumentChange(event);
		});

		// Event when document is saved
		const documentSave = vscode.workspace.onDidSaveTextDocument(async (document) => {
			await this.handleDocumentSave(document);
		});

		// Event when document is closed
		const documentClose = vscode.workspace.onDidCloseTextDocument((document) => {
			this.handleDocumentClose(document);
		});

		// Periodic cache cleanup
		const cleanupInterval = setInterval(() => {
			this.symbolCacheManager.cleanupOldCache(24); // Remove entries not accessed for 24+ hours
		}, 60 * 60 * 1000); // Every hour

		// Cache symbols of currently active editor
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			this.handleActiveEditorChange(activeEditor);
		}

		// Cache symbols of open tabs
		this.cacheOpenTabs();

		this.disposables.push(
			activeEditorChange,
			documentChange,
			documentSave,
			documentClose,
			{ dispose: () => clearInterval(cleanupInterval) }
		);

		logInfo('Symbol Cache Manager initialized');
	}

	/**
	 * Processing when active editor changes
	 */
	private async handleActiveEditorChange(editor: vscode.TextEditor): Promise<void> {
		const uri = editor.document.uri;
		const cached = this.symbolCacheManager.getCachedSymbols(uri);

		// Update if cache doesn't exist or is old
		if (!cached || cached.version !== editor.document.version) {
			logDebug(`Caching symbols for active editor: ${uri.toString()}`);
			await this.symbolCacheManager.cacheDocumentSymbols(uri, editor.document);
		}
	}

	/**
	 * Processing when document changes
	 */
	private async handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
		const uri = event.document.uri;
		const uriString = uri.toString();
		const cached = this.symbolCacheManager.getCachedSymbols(uri);

		// Only update cache when version changes
		if (cached && cached.version !== event.document.version) {
			// Clear existing timer if present
			if (this.documentChangeTimers.has(uriString)) {
				clearTimeout(this.documentChangeTimers.get(uriString)!);
			}

			// Set timer to update cache after 1 second
			const timer = setTimeout(async () => {
				//logDebug(`Document changed, updating cache for: ${uriString}`);
				await this.symbolCacheManager.updateCacheOnDocumentChange(uri, event.document);
				// Remove from map after timer completion
				this.documentChangeTimers.delete(uriString);
			}, 1000);

			// Save timer to map
			this.documentChangeTimers.set(uriString, timer);
		}
	}

	/**
	 * Processing when document is saved
	 */
	private async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
		logDebug(`Document saved, updating cache for: ${document.uri.toString()}`);
		await this.symbolCacheManager.cacheDocumentSymbols(document.uri, document);
	}

	/**
	 * Processing when document is closed
	 */
	private handleDocumentClose(document: vscode.TextDocument): void {
		// Remove from cache (optional)
		this.symbolCacheManager.removeFromCache(document.uri);
		logDebug(`Document closed: ${document.uri.toString()}`);
	}

	/**
	 * Cache symbols of open tabs
	 */
	private async cacheOpenTabs(): Promise<void> {
		const openTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
		
		for (const tab of openTabs) {
			if (tab.input instanceof vscode.TabInputText) {
				const uri = tab.input.uri;
				if (uri) {
					try {
						await this.symbolCacheManager.cacheDocumentSymbols(uri);
					} catch (error) {
						logDebug(`Failed to cache symbols for open tab: ${uri.toString()}`);
					}
				}
			}
		}
	}

	/**
	 * Get list of cached files for specified language
	 */
	getFilesByLanguageId(languageId: string): CachedSymbol[] {
		return this.symbolCacheManager.getFilesByLanguageId(languageId);
	}

	/**
	 * Manually clear cache
	 */
	clearCache(): void {
		this.symbolCacheManager.clearCache();
	}

	/**
	 * Remove cache for specific file
	 */
	removeFromCache(uri: vscode.Uri | string): void {
		this.symbolCacheManager.removeFromCache(uri);
	}

	/**
	 * Manually update cache for specific editor
	 */
	async refreshCacheForEditor(editor: vscode.TextEditor): Promise<void> {
		await this.handleActiveEditorChange(editor);
	}
}

/**
 * Convert symbol information to meta information format
 */
function convertSymbolsToMetaInfo(symbols: vscode.DocumentSymbol[]): SymbolMetaInfo[] {
	const result: SymbolMetaInfo[] = [];
	
	for (const symbol of symbols) {
		const metaInfo: SymbolMetaInfo = {
			type: getSymbolType(symbol.kind),
			name: symbol.name,
			content: symbol.name,
			line: symbol.range.start.line, // 0-based line numbers
			column: symbol.range.start.character, // 0-based column numbers
		};

		// Function/Method argments/return by Cotab extended symbol
		const extended = symbol as ExtendedDocumentSymbol;
		if (extended.signatureInfo && extended.signatureInfo.definition) {
			if (extended.signatureInfo.definition) {
				metaInfo.content = extended.signatureInfo.definition;
			}
		}
		
		if(symbol.children && 0 < symbol.children.length) {
			metaInfo.children = convertSymbolsToMetaInfo(symbol.children);
		}
		
		result.push(metaInfo);
	}
	
	return result;
}

	/**
	 * Convert meta information to string format
	 */
function formatMetaInfoAsString(metaInfo: SymbolMetaInfo[], maxCount: number, indent: string = ''): {
	yaml: string;
	count: number;
} {
	let yaml = '';
	let count = 0;
	
	for (const info of metaInfo) {
		if (maxCount <= count) break;

		//result += `${indent}${info.type}: ${info.name} [${info.line}:${info.column}]\n`;
		yaml += `${indent}- ${info.type}: ${info.content}\n`;
		count++;
		
		if (info.children && 0 < info.children.length) {
			const leftCount = maxCount - count;
			const { yaml: result, count: n } = formatMetaInfoAsString(info.children, leftCount, indent + '  ');
			yaml += result + '\n';
			count += n;
		}
	}

			// Remove final newline
	yaml = yaml.replace(/\n$/, '');

	return { yaml, count };
}

export function getSymbolYaml(cachedSymbol: CachedSymbol, maxCount: number): {
	codeBlock: string;
	count: number;
} {
	const metaInfo = convertSymbolsToMetaInfo(cachedSymbol.symbols);
	const { yaml, count } = formatMetaInfoAsString(metaInfo, maxCount);
	const codeBlock = `# ${cachedSymbol.relativePath}\n${yaml}`;
	return { codeBlock, count };
}

/**
 * Convert symbol type to string
 */
function getSymbolType(kind: vscode.SymbolKind): string {
	switch (kind) {
		case vscode.SymbolKind.File: return 'File';
		case vscode.SymbolKind.Module: return 'Module';
		case vscode.SymbolKind.Namespace: return 'Namespace';
		case vscode.SymbolKind.Package: return 'Package';
		case vscode.SymbolKind.Class: return 'Class';
		case vscode.SymbolKind.Method: return 'Method';
		case vscode.SymbolKind.Property: return 'Property';
		case vscode.SymbolKind.Field: return 'Field';
		case vscode.SymbolKind.Constructor: return 'Constructor';
		case vscode.SymbolKind.Enum: return 'Enum';
		case vscode.SymbolKind.Interface: return 'Interface';
		case vscode.SymbolKind.Function: return 'Function';
		case vscode.SymbolKind.Variable: return 'Variable';
		case vscode.SymbolKind.Constant: return 'Constant';
		case vscode.SymbolKind.String: return 'String';
		case vscode.SymbolKind.Number: return 'Number';
		case vscode.SymbolKind.Boolean: return 'Boolean';
		case vscode.SymbolKind.Array: return 'Array';
		case vscode.SymbolKind.Object: return 'Object';
		case vscode.SymbolKind.Key: return 'Key';
		case vscode.SymbolKind.Null: return 'Null';
		case vscode.SymbolKind.EnumMember: return 'EnumMember';
		case vscode.SymbolKind.Struct: return 'Struct';
		case vscode.SymbolKind.Event: return 'Event';
		case vscode.SymbolKind.Operator: return 'Operator';
		case vscode.SymbolKind.TypeParameter: return 'TypeParameter';
		default: return 'Unknown';
	}
}


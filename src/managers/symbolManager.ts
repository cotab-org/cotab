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
						logDebug(`Failed to cache symbols for open tab: ${uri.toString()}. Error: ${error}`);
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
			types: getSymbolTypes(symbol.kind),
			hasChildType: hasSymbolChild(symbol.kind),
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
// type definition for meta information tree structure
type MetaTreeNode = {
	content: string;
	children?: MetaTree;
};
type MetaTreeEntry = {
	type: string;
	nodes: MetaTreeNode[];
};
type MetaTree = MetaTreeEntry[];

// Version of sortMetaInfo corrected
function makeMetaTree(metaInfo?: SymbolMetaInfo[]): MetaTree | undefined {
	if (!metaInfo || metaInfo.length === 0) {
		return undefined;
	}

	const metaTree: MetaTree = [];

	for (const info of metaInfo) {
		if (info.content === '') continue;

		// find or create entry
		let typeEntry = metaTree.find((entry) => entry.type === info.types);
		if (!typeEntry) {
			typeEntry = {
				type: info.types,
				nodes: []
			};
			metaTree.push(typeEntry);
		}

		// check existing
		if (typeEntry.nodes.some(node => node.content === info.content)) {
			continue;
		}

		typeEntry.nodes.push({
			content: info.content,
			children: info.hasChildType ? makeMetaTree(info.children) : undefined // Recursive call to create child nodes
		});
	}

	return (0 < metaTree.length) ? metaTree : undefined;
}

// Revised version of formatMetaInfoAsString
function formatMetaInfoAsString(
	metaInfo: SymbolMetaInfo[],
	remaining: number,
	indent: string = ''
): { yaml: string; useCharCount: number } {

	const metaTree = makeMetaTree(metaInfo);
	if (!metaTree) return { yaml: '', useCharCount: 0 };

	// Recursively traverse the tree to generate YAML helper
	const traverse = (
		metaTree: MetaTree | undefined,
		outerContents: string[],
		indent: string,
		remaining: number
	): { yaml: string; useCharCount: number } => {
		let yaml = '';
		let useCharCount = 0;

		if (!metaTree) return { yaml, useCharCount };
		for (const { type, nodes } of metaTree) {
			let isFirst = true;
			for (const node of nodes) {
				let typesLine = '';
				if (isFirst) {
					isFirst = false;
					typesLine = `${indent}${type}:\n`;
				}

				const memberIndent = `  ${indent}`;

				const removedHeadkeyword = removeHeadKeyword(node.content.replace(/\r?\n/g, ''));
				const lineContent = removeOuterScope(outerContents, removedHeadkeyword);
				const line = `${memberIndent}- ${lineContent}\n`;
				if (remaining < useCharCount + line.length + typesLine.length) {
					continue;
				}

				// Append one line
				yaml += typesLine;
				yaml += line;
				useCharCount += typesLine.length + line.length;

				// If child nodes exist, process them recursively
				if (node.children && node.children.length > 0) {
					const left = remaining - useCharCount;
					const { yaml: childYaml, useCharCount: childCnt } =
						traverse(node.children,
							[...outerContents, lineContent],
							memberIndent + '  ',
							left);
					yaml += childYaml;
					useCharCount += childCnt;
				}
			}
		}

		return { yaml, useCharCount };
	};

	const result = traverse(metaTree, [], indent, remaining);

	// Remove trailing whitespace newline
	const finalYaml = result.yaml.replace(/\n$/, '');

	return { yaml: finalYaml, useCharCount: result.useCharCount };
}

export function getSymbolYaml(cachedSymbol: CachedSymbol, maxCharCount: number): {
	codeBlock: string;
	useCharCount: number;
} {
	const metaInfo = convertSymbolsToMetaInfo(cachedSymbol.symbols);
	const { yaml, useCharCount } = formatMetaInfoAsString(metaInfo, maxCharCount);
	const codeBlock = `# ${cachedSymbol.relativePath}\n${yaml}`;
	return { codeBlock, useCharCount: useCharCount };
}

// Language specific leading keywords to strip (case-insensitive)
const KEYWORDS = [
	'export', 'declare', 'default',
	'interface', 'type', 'enum', 'class',
	'function', 'namespace', 'module',
	'var', 'let', 'const',
	'import', 'from', 'as',
	'const', 'let', 'var',
	'public', 'private', 'protected',
	'static', 'async', 'await',
	'get', 'set',
	'yield', 'break', 'continue',
	'throw', 'try', 'catch', 'finally',
	'if', 'else', 'for', 'while',
	'switch', 'case', 'default',
	'do', 'with', 'typeof',
	'new', 'this', 'super',
	'extends', 'implements', 'interface',
	'package', 'protected', 'private',
	'public', 'abstract', 'final',
	'static', 'synchronized', 'volatile',
	'inline',
];

// remove head keyword
const LEADING_KEYWORD_REGEX = new RegExp(`^(?:${KEYWORDS.join('|')})\\b`, 'i');

function removeHeadKeyword(content: string): string {
	// Trim whitespace at both ends
	let result = content.trim();

	let match = result.match(LEADING_KEYWORD_REGEX);
	while (match) {
		result = result.slice(match[0].length).trimStart();
		match = result.match(LEADING_KEYWORD_REGEX);
	}

	return result;
}

function removeOuterScope(outerContents: string[], content: string): string {
    // Return unchanged if there is no parent scope information
    if (!outerContents || outerContents.length === 0) {
        return content;
    }

    // Escape RegExp meta‑characters in each parent scope string to safely build a pattern
    const escaped = outerContents.map(name =>
        name.replace(/[\\[\]^$.*+?(){}|]/g, '\\$&')
    );

    // Separator pattern that matches a dot (.) or double colon (::)
    const sep = '(?:\\.|::)';

    // Build a regex that matches the outer‑scope prefix at the start of the string.
    // It allows any combination of "." or "::" between each segment and an optional
    // trailing connector after the last segment.
    const prefixPattern = `(^|\\s)${escaped.join(sep)}${sep}?`;
    const regex = new RegExp(prefixPattern);

    // Remove the outer scope prefix if present
	const removed = content.replace(regex, '$1');
    return removed;
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
function hasSymbolChild(kind: vscode.SymbolKind): boolean {
	switch (kind) {
		case vscode.SymbolKind.Class:
		case vscode.SymbolKind.Interface:
		case vscode.SymbolKind.Namespace:
		case vscode.SymbolKind.Module:
		case vscode.SymbolKind.Package:
		case vscode.SymbolKind.Struct:
		case vscode.SymbolKind.Enum:
			return true;
		default:
			return false;
	}
}
function getSymbolTypes(kind: vscode.SymbolKind): string {
	switch (kind) {
		case vscode.SymbolKind.File: return 'files';
		case vscode.SymbolKind.Module: return 'modules';
		case vscode.SymbolKind.Namespace: return 'namespaces';
		case vscode.SymbolKind.Package: return 'packages';
		case vscode.SymbolKind.Class: return 'classes';
		case vscode.SymbolKind.Method: return 'methods';
		case vscode.SymbolKind.Property: return 'properties';
		case vscode.SymbolKind.Field: return 'fields';
		case vscode.SymbolKind.Constructor: return 'constructors';
		case vscode.SymbolKind.Enum: return 'enums';
		case vscode.SymbolKind.Interface: return 'interfaces';
		case vscode.SymbolKind.Function: return 'functions';
		case vscode.SymbolKind.Variable: return 'variables';
		case vscode.SymbolKind.Constant: return 'constants';
		case vscode.SymbolKind.String: return 'strings';
		case vscode.SymbolKind.Number: return 'numbers';
		case vscode.SymbolKind.Boolean: return 'booleans';
		case vscode.SymbolKind.Array: return 'arrays';
		case vscode.SymbolKind.Object: return 'objects';
		case vscode.SymbolKind.Key: return 'keys';
		case vscode.SymbolKind.Null: return 'nulls';
		case vscode.SymbolKind.EnumMember: return 'enumMembers';
		case vscode.SymbolKind.Struct: return 'structs';
		case vscode.SymbolKind.Event: return 'events';
		case vscode.SymbolKind.Operator: return 'operators';
		case vscode.SymbolKind.TypeParameter: return 'typeParameters';
		default: return 'unknowns';
	}
}


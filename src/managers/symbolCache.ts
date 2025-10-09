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
	line: number;
	column: number;
	children?: SymbolMetaInfo[];
}

export class SymbolCacheManager {
	private cache = new Map<string, CachedSymbol>();
	private accessOrder: string[] = []; // URI list in latest access order

	/**
	 * Resolve URIs of workspace dependency files imported/included by the specified document
	 */
	/*
	private async getDependencyUris(document: vscode.TextDocument): Promise<Set<string>> {
		const specifiers = this.extractDependencySpecifiers(document);
		const resolved = new Set<string>();
		for (const spec of specifiers) {
			const uris = await this.resolveSpecifierToUris(document, spec);
			for (const u of uris) {
				resolved.add(u.toString());
			}
		}
		return resolved;
	}
	*/

	/**
	 * Extract import/include reference strings for each language
	 */
	/*
	private extractDependencySpecifiers(document: vscode.TextDocument): string[] {
		const text = document.getText();
		const specs: string[] = [];
		const lang = document.languageId;

		// TS/JS family
		if (lang === 'typescript' || lang === 'javascript' || lang === 'typescriptreact' || lang === 'javascriptreact') {
			const importFrom = /import\s+[^'"\n;]*from\s+['"]([^'"]+)['"]/g;
			const importOnly = /import\s+['"]([^'"]+)['"]/g;
			const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
			const dynamicImport = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
			let m: RegExpExecArray | null;
			while ((m = importFrom.exec(text))) specs.push(m[1]);
			while ((m = importOnly.exec(text))) specs.push(m[1]);
			while ((m = requireRe.exec(text))) specs.push(m[1]);
			while ((m = dynamicImport.exec(text))) specs.push(m[1]);
		}

		// C/C++ family
		if (lang === 'cpp' || lang === 'c') {
			const includeQuote = /^\s*#\s*include\s+"([^"]+)"/gm; // Only local headers
			let m: RegExpExecArray | null;
			while ((m = includeQuote.exec(text))) specs.push(m[1]);
		}

		return specs;
	}
	*/

	/**
	 * Resolve reference strings to file URIs within the workspace (relative paths only)
	 */
	/*
	private async resolveSpecifierToUris(document: vscode.TextDocument, spec: string): Promise<vscode.Uri[]> {
		const results: vscode.Uri[] = [];
		const isRelative = spec.startsWith('./') || spec.startsWith('../');
		if (!isRelative) return results; // External modules and <...> are excluded

		const baseDir = path.dirname(document.uri.fsPath);
		const targetNoExt = path.normalize(path.resolve(baseDir, spec));

		// Candidate extensions for each language
		const lang = document.languageId;
		const tsJsExts = ['', '.ts', '.tsx', '.js', '.jsx', '.d.ts'];
		const cppExts = ['', '.h', '.hpp', '.hh', '.hxx', '.c', '.cc', '.cpp', '.cxx'];
		const exts = (lang === 'cpp' || lang === 'c') ? cppExts : tsJsExts;

		// Main body candidates
		for (const ext of exts) {
			const filePath = targetNoExt.endsWith(ext) ? targetNoExt : targetNoExt + ext;
			const uri = vscode.Uri.file(filePath);
			if (await this.exists(uri)) {
				results.push(uri);
			}
		}

		// index.* candidates (when specifying a directory)
		for (const ext of exts) {
			const filePath = path.join(targetNoExt, 'index' + ext);
			const uri = vscode.Uri.file(filePath);
			if (await this.exists(uri)) {
				results.push(uri);
			}
		}

		return results;
	}
	*/

	/*
	private async exists(uri: vscode.Uri): Promise<boolean> {
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	}
	*/

	/**
	 * Returns only cached files that the specified source depends on (in latest access order)
	 */
	/*
	async getCachedSymbolsForDependencies(source: vscode.Uri | vscode.TextDocument): Promise<CachedSymbol[]> {
		const doc = (source as vscode.TextDocument).uri ? (source as vscode.TextDocument) : await vscode.workspace.openTextDocument(source as vscode.Uri);
		const deps = await this.getDependencyUris(doc);
		if (deps.size === 0) return [];

		// Filter based on accessOrder sorted by latest access
		const result: CachedSymbol[] = [];
		for (const uriString of this.accessOrder) {
			if (!deps.has(uriString)) continue;
			const cached = this.cache.get(uriString);
			if (cached) result.push(cached);
		}
		return result;
	}
	*/

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



	/**
	 * Create basic symbol information for C++ files
	 */
	private createBasicSymbolsForCpp(document: vscode.TextDocument): vscode.SymbolInformation[] {
		const symbols: vscode.SymbolInformation[] = [];
		const text = document.getText();
		const lines = text.split('\n');
		
		// Detect symbols using basic pattern matching
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			
			// Class definition
			if (line.match(/^class\s+(\w+)/)) {
				const match = line.match(/^class\s+(\w+)/);
				if (match) {
					symbols.push(new vscode.SymbolInformation(
						match[1],
						vscode.SymbolKind.Class,
						'',
						new vscode.Location(document.uri, new vscode.Position(i, 0))
					));
				}
			}
			
			// Function definition
			if (line.match(/^(\w+)\s+(\w+)\s*\(/)) {
				const match = line.match(/^(\w+)\s+(\w+)\s*\(/);
				if (match) {
					symbols.push(new vscode.SymbolInformation(
						match[2],
						vscode.SymbolKind.Function,
						'',
						new vscode.Location(document.uri, new vscode.Position(i, 0))
					));
				}
			}
			
			// Struct definition
			if (line.match(/^struct\s+(\w+)/)) {
				const match = line.match(/^struct\s+(\w+)/);
				if (match) {
					symbols.push(new vscode.SymbolInformation(
						match[1],
						vscode.SymbolKind.Struct,
						'',
						new vscode.Location(document.uri, new vscode.Position(i, 0))
					));
				}
			}
		}
		
		return symbols;
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


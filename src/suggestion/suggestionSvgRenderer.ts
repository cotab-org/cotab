import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as shiki from 'shiki';
import { transformerNotationHighlight, transformerNotationWordHighlight } from '@shikijs/transformers';
import { logDebug } from '../utils/logger';
import { JSDOM } from 'jsdom';
import { measureTextsWidthPx } from '../utils/textMeasurer';
import { getConfig } from '../utils/config';
import { SimpleLocker } from '../utils/cotabUtil';
import { CharDiffSegment } from '../diff/charDiff';

export interface OverlaySegment {
	line: number;
	column: number;
	text: string;
	paddingLeftCh: number;
	paddingRightCh: number;
	marginLeftCh: number;
	textWidthCh?: number;
	visualDiffSegments: CharDiffSegment[];
}

// Color scheme aligned with existing suggestion overlay styles
const colors = {
	fontColor: '#ffffffb5',
	unfinishedFontColor: '#ffffff70',
	backgroundColor: '#38422260',
	borderColor: '#666666',
};

const svgOverlayDecorationType = vscode.window.createTextEditorDecorationType({
	before: { margin: '0 0 0 0' },
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const svgOverlayUnfinishedDecorationType = vscode.window.createTextEditorDecorationType({
	before: { margin: '0 0 0 0' },
	rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

const simpleLocker = new SimpleLocker();

export function renderSvgOverlays(
	editor: vscode.TextEditor,
	segments: OverlaySegment[],
	options?: { unfinished?: boolean; dispIdx?: number }) {	
	
	setTimeout(async () => {
		const isUnfinished = options?.unfinished ?? false;
		if (isUnfinished && simpleLocker.isLocked()) {
			return;
		}

		await simpleLocker.acquireLock();
		{
			//const startTimeMs = Date.now();
			await renderSvgOverlaysInternal(editor, segments, options);
			//logDebug(`renderSvgOverlays duration: ${Date.now() - startTimeMs} ms`);
		}
		simpleLocker.releaseLock();
	}, 0);
}
async function renderSvgOverlaysInternal(
	editor: vscode.TextEditor,
	segments: OverlaySegment[],
	options?: { unfinished?: boolean; dispIdx?: number }) {
	const cfg = getConfig();
	const isUnfinished = options?.unfinished ?? false;
	const dispIdx = options?.dispIdx ?? 0;

	if (!segments || segments.length === 0) {
		editor.setDecorations(svgOverlayDecorationType, []);
		editor.setDecorations(svgOverlayUnfinishedDecorationType, []);
		return;
	}

	try {
		const sorted = segments.slice().sort((a, b) => a.line - b.line || a.column - b.column);
		const sliced = sorted.slice(dispIdx);

		const themeName = getConfig().theme;
		const languageId = editor.document.languageId;
		const highlighter = await getOrCreateHighlighter(themeName, languageId);
		const defaultColor = tryGetDefaultForeground(highlighter) || (isUnfinished ? colors.unfinishedFontColor : colors.fontColor);

		const decos: vscode.DecorationOptions[] = [];
		const svgUri = await buildSvgDataUriWithShiki(
				sliced,
				isUnfinished,
				languageId
			);
		const svgData = svgUri;
		const iconUri = svgData.uri;
		const startline = sliced[0].line;
		const marginLeftCh = sliced[0].marginLeftCh;
		const endLine = sliced[sliced.length - 1].line;
		
		// Get half-width character width and calculate margin
		const marginText = ' '.repeat(marginLeftCh);
		const marginWidth = await getTextWidth(marginText, editor);
		
		decos.push({
			range: new vscode.Range(startline, 0, endLine, 0),
			renderOptions: {
				before: {
					contentIconPath: iconUri,
					width: `${Math.ceil(svgData.width)}px`,
					height: `${Math.ceil(svgData.height)}px`,
					textDecoration: `;
						position: absolute;
						z-index: 2147483647`,
					margin: `0 0 0 ${Math.ceil(marginWidth)}px`
				},
			},
		});

		//logDebug(`renderSvgOverlays: ${decos.length} (unfinished=${isUnfinished})`);
		if (isUnfinished) {
			editor.setDecorations(svgOverlayDecorationType, []);
			editor.setDecorations(svgOverlayUnfinishedDecorationType, decos);
		} else {
			editor.setDecorations(svgOverlayDecorationType, decos);
			editor.setDecorations(svgOverlayUnfinishedDecorationType, []);
		}
	} catch (err) {
		logDebug(`renderSvgOverlays error: ${String(err)}`);
	}
}

export function clearSvgOverlays(editor: vscode.TextEditor): void {
	editor.setDecorations(svgOverlayDecorationType, []);
	editor.setDecorations(svgOverlayUnfinishedDecorationType, []);
}

export function disposeSvgDecorationTypes(): void {
	svgOverlayDecorationType.dispose();
	svgOverlayUnfinishedDecorationType.dispose();
}

type ShikiHighlighter = any;

async function buildSvgDataUriWithShiki(
	segments: OverlaySegment[],
	unfinished: boolean,
	languageId: string): Promise<{ uri: vscode.Uri; width: number; height: number }> {
	const cfg = getConfig();

	let texts = '';
	let computedWidth = 0;
	let computedHeight = 0;
	
	const decorateds: shiki.DecorationItem[] = [];
	const code = segments.map(segment => { return ' '.repeat(segment.paddingLeftCh) + segment.text.replace(/\u00A0/g, ' '); }).join("\n");
	const charDiffs = segments.map(segment => { return segment.visualDiffSegments; });
	const html = await generateHighlightedHtml(code, decorateds, getConfig().shikiTheme, languageId);
	const conv = await convertShikiHtmlToSvgGut(html, charDiffs, (unfinished ? 'italic' : 'normal'), (unfinished ? 0.7 : 1));
	texts += conv.guts;
	computedWidth = Math.ceil(conv.maxWidth);
	computedHeight = Math.ceil(conv.totalHeight);

	const width = Math.max(1, computedWidth);
	const height = Math.max(1, computedHeight);
	const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
<rect x="0" y="0" width="${width}" height="${height}" fill="${cfg.backgroundColor}" stroke="${colors.borderColor}" stroke-width="1" />
${texts}
</svg>`;
	const encoded = encodeURIComponent(svg)
		.replace(/'/g, '%27')
		.replace(/"/g, '%22');
	return { uri: vscode.Uri.parse(`data:image/svg+xml;utf8,${encoded}`), width, height };
}

async function generateHighlightedHtml(code: string,
    decorations: shiki.DecorationItem[],
    themeName: string,
    languageId: string): Promise<string> {

    // Initialize Shiki highlighter
    const highlighter = await getOrCreateHighlighter(themeName, languageId);
    if (!highlighter) {
        return '';
    }

    const shikiLang = mapLanguageIdToShikiLang(languageId);

    // HTML generation
	let html = '';
	try {
		html = highlighter.codeToHtml(code, {
			lang: shikiLang,
			theme: themeName,
			decorations,
			/*
			transformers: [transformerNotationHighlight(),
							transformerNotationWordHighlight()],
			*/
		});
	} catch (error) {
		logDebug(`Error codeToHtml with lang '${shikiLang}': ${error}`);
		
		// Fallback to C language if C++ error occurs
		if (shikiLang === 'cpp' || shikiLang === 'c++') {
			try {
				logDebug(`Trying fallback to 'c' language for C++ code`);
				html = highlighter.codeToHtml(code, {
					lang: 'c',
					theme: themeName,
					decorations,
				});
			} catch (fallbackError) {
				logDebug(`Fallback to 'c' also failed: ${fallbackError}`);
				// Finally process as plain text
				const lines = code.split('\n').map((line) => `<span class="line">${escapeXml(line)}</span>`).join('\n');
				html = `<pre><code>${lines}</code></pre>`;
			}
		} else {
			// Process as plain text if error occurs in other languages
			const lines = code.split('\n').map((line) => `<span class="line">${escapeXml(line)}</span>`).join('\n');
			html = `<pre><code>${lines}</code></pre>`;
		}
	}
	return html;
}

const TEXT_Y_RATIO = 0.72;

async function convertShikiHtmlToSvgGut(shikiHtml: string, charDiffSegmentsList: CharDiffSegment[][], fontStyle: string, fontOpacity: number): Promise<{
	guts: string; maxWidth: number; totalHeight: number }> {
	const dom = new JSDOM(shikiHtml);
	const document = dom.window.document;
    const cfg = getConfig();

	const lines = Array.from(document.querySelectorAll(".line")) as Element[];
	let maxWidth = 0;
	const svgLines = await Promise.all(lines.map(async (line, index) => {
		const spans = Array.from(line.childNodes).map((node) => {
			if (node.nodeType === 3) {
				return `<tspan xml:space="preserve">${escapeForSVG(node.textContent ?? "")}</tspan>`;
			}

			const el = node as HTMLElement;
			const style = el.getAttribute("style") || "";
			const colorMatch = style.match(/color:\s*(#[0-9a-fA-F]{6})/);
			const classes = el.getAttribute("class") || "";
			let fill = colorMatch ? ` fill="${colorMatch[1]}"` : "";
			if (classes.includes("highlighted")) {
				fill = ` fill="${colors.backgroundColor}"`;
			}

			const content = el.textContent || "";
			return `<tspan xml:space="preserve"${fill}>${escapeForSVG(content)}</tspan>`;
		}).join("");

		const charDiffSegments = charDiffSegmentsList[index];
		const lineContent = line.textContent || "";
		const width = await getTextWidth(lineContent);
		if (width > maxWidth) maxWidth = width;

		const rectY = index * cfg.lineHeight;
		const textY = rectY + Math.round(cfg.lineHeight * TEXT_Y_RATIO);
        // const rect = `<rect x="0" y="${rectY}" width="${width}" height="${cfg.lineHeight}" fill="${colors.backgroundColor}" />`;
		// const rects = [rect];
		const rects: string[] = [];
		for(const segment of charDiffSegments) {
			if (segment.type !== 'add') continue;
			const diffX = await getTextWidth(lineContent.slice(0, segment.newIdx));
			const diffWidth = await getTextWidth(segment.text);
			rects.push(`<rect x="${diffX}" y="${rectY}" width="${diffWidth}" height="${cfg.lineHeight}" fill="${colors.backgroundColor}" />`);
		}
        const text = `<text x="0" y="${textY}" font-family="${cfg.fontFamily}" font-size="${cfg.fontSize}" font-weight="${cfg.fontWeight}" font-style="${fontStyle}" style="opacity:${fontOpacity}" dominant-baseline="alphabetic" xml:space="preserve" shape-rendering="crispEdges">${spans}</text>`;
		return `${rects.join("\n")}\n${text}`;
	}));

	const totalHeight = lines.length * cfg.lineHeight;

	return {
		guts: svgLines.join("\n"),
		maxWidth,
		totalHeight,
	};
}

let highlighterCache: Map<string, Promise<ShikiHighlighter>> | undefined;

async function getOrCreateHighlighter(themeName: string, languageId: string): Promise<ShikiHighlighter> {
	if (!highlighterCache) {
        highlighterCache = new Map();
    }
    
	const lang = mapLanguageIdToShikiLang(languageId);
	const key = `${themeName}::${lang}`;
	let p = highlighterCache.get(key);
	if (!p) {
		p = (async () => {
			const themeObj = await tryLoadThemeObject(themeName);
			try {
				const highlighter = await shiki.createHighlighter({ themes: [themeObj ?? themeName], langs: [lang] });
				try { highlighter.setTheme((themeObj as any)?.name ?? themeName); } catch {}
				return highlighter;
			} catch (e) {
				logDebug(`Failed to create highlighter for lang '${lang}': ${e}`);
				
				// Fallback to C language if C++ error occurs
				if (lang === 'cpp' || lang === 'c++') {
					try {
						logDebug(`Trying fallback to 'c' language for highlighter`);
						const fallbackTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'light-plus' : 'dark-plus';
						const highlighter = await shiki.createHighlighter({ themes: [fallbackTheme], langs: ['c'] });
						try { highlighter.setTheme(fallbackTheme); } catch {}
						return highlighter;
					} catch (fallbackError) {
						logDebug(`Fallback to 'c' also failed: ${fallbackError}`);
					}
				}
				
				// Finally create a highlighter for plain text
				const fallback = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'light-plus' : 'dark-plus';
				const highlighter = await shiki.createHighlighter({ themes: [fallback], langs: ['text'] });
				try { highlighter.setTheme(fallback); } catch {}
				return highlighter;
			}
		})();
		highlighterCache.set(key, p);
	}
	return p;
}

function parseJsoncLoose(text: string, fallbackName?: string): any | null {
	try {
		// Remove block comments
		let s = text.replace(/\/\*[\s\S]*?\*\//g, '');
		// Remove line comments (naive, not inside strings)
		s = s.replace(/(^|\s)\/\/.*$/gm, '$1');
		// Remove trailing commas in objects/arrays
		s = s.replace(/,\s*([}\]])/g, '$1');
		const obj = JSON.parse(s);
		if (obj && !obj.name && fallbackName) obj.name = fallbackName;
		return obj;
	} catch {
		return null;
	}
}

async function tryLoadThemeObject(themeName: string): Promise<any | null> {
	try {
		for (const ext of vscode.extensions.all) {
			const pkg: any = (ext as any).packageJSON;
			const themes: any[] = pkg?.contributes?.themes || [];
			for (const t of themes) {
				const label: string = t.label || '';
				const id: string = t.id || '';
				const keyLabel = normalizeThemeKey(label);
				const keyId = normalizeThemeKey(id);
				const target = normalizeThemeKey(themeName);
				if (label === themeName || id === themeName || keyLabel === target || keyId === target) {
					const relPath: string = t.path;
					const absPath = path.join(ext.extensionPath, relPath);
					const txt = fs.readFileSync(absPath, 'utf-8');
					const obj: any = parseJsoncLoose(txt, label || id || themeName);
					return obj;
				}
			}
		}
	} catch {}
	return null;
}

function tryGetDefaultForeground(highlighter: any): string | undefined {
	try {
		return highlighter.getForegroundColor?.();
	} catch {}
	return undefined;
}

function escapeXml(unsafe: string): string {
	return unsafe
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeForSVG(text: string): string {
  return text
    .replace(/&/g, "&amp;") // must be first
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\n/g, "\\n") // newlines
    .replace(/\t/g, "\\t") // tabs
    .replace(/\r/g, "\\r"); // carriage returns
}

async function getTextWidth(text: string, editor?: vscode.TextEditor): Promise<number> {
	const cfg = getConfig();
	try {
		const ed = editor || vscode.window.activeTextEditor;
		if (!ed) return 0;
		const widths = await measureTextsWidthPx(cfg.fontFamily, cfg.fontSize, cfg.fontWeight, cfg.fontStyle, [text], ed);
		return widths[0] ?? 0;
	} catch {
		return 0;
	}
}

function normalizeThemeKey(name: string): string {
	try {
		return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
	} catch {
		return name;
	}
}

function mapLanguageIdToShikiLang(languageId: string): string {
	const map: Record<string, string> = {
		'javascriptreact': 'jsx',
		'typescriptreact': 'tsx',
		'csharp': 'cs',
		'plaintext': 'txt',
		'cpp': 'c', // Treat C++ as C (avoid regex errors)
		'c': 'c',
		'c++': 'c',
	};
	return map[languageId] || languageId;
}



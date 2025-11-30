import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as shiki from 'shiki';
import { transformerNotationHighlight, transformerNotationWordHighlight } from '@shikijs/transformers';
import { logDebug } from '../utils/logger';
import { JSDOM } from 'jsdom';
import { measureTextsWidthPx } from '../utils/textMeasurer';
import { getConfig } from '../utils/config';
import { SimpleLocker, isDarkTheme } from '../utils/cotabUtil';
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
function getOverlayColors() {
	if (isDarkTheme()) {
		return {
			fontColor: '#ffffffb5',
			unfinishedFontColor: '#ffffff70',
			backgroundColor: '#eeff0022',
			borderColor: '#666666',
		};
	}
	else {
		return {
			fontColor: '#000000b5',
			unfinishedFontColor: '#00000070',
			backgroundColor: '#bbff0033',
			borderColor: '#999999',
		};
	}
}

let svgOverlayDecorationType: vscode.TextEditorDecorationType;
let simpleLocker: SimpleLocker;
let renderTimer: NodeJS.Timeout | null = null;

export function setupSvgRenderer(): void {
	svgOverlayDecorationType = vscode.window.createTextEditorDecorationType({
		before: { margin: '0 0 0 0' },
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
	});
	
	simpleLocker = new SimpleLocker();
}

export function disposeSvgRenderer(): void {
	svgOverlayDecorationType.dispose();
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}
}

export function renderSvgOverlays(
	editor: vscode.TextEditor,
	segments: OverlaySegment[],
	options: { unfinished: boolean; dispIdx: number, isNoHighligh: boolean }) {	
	
	renderTimer = setTimeout(async () => {
		renderTimer = null;
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
	options: { unfinished: boolean; dispIdx: number, isNoHighligh: boolean }) {
	const isUnfinished = options.unfinished ?? false;
	const dispIdx = options.dispIdx ?? 0;

	if (!segments || segments.length === 0) {
		editor.setDecorations(svgOverlayDecorationType, []);
		return;
	}

	try {
		const sorted = segments.slice().sort((a, b) => a.line - b.line || a.column - b.column);
		const sliced = sorted.slice(dispIdx);

		const themeName = getConfig().theme;
		const languageId = editor.document.languageId;
		const highlighter = await getOrCreateHighlighter(themeName, languageId);
		const overlayColors = getOverlayColors();
		const defaultColor = tryGetDefaultForeground(highlighter) || (isUnfinished ? overlayColors.unfinishedFontColor : overlayColors.fontColor);

		const decos: vscode.DecorationOptions[] = [];
		const svgUri = await buildSvgDataUriWithShiki(
				sliced,
				isUnfinished,
				languageId,
				options.isNoHighligh
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

		editor.setDecorations(svgOverlayDecorationType, decos);
	} catch (err) {
		logDebug(`renderSvgOverlays error: ${String(err)}`);
	}
}

export function clearSvgOverlays(editor: vscode.TextEditor): void {
	editor.setDecorations(svgOverlayDecorationType, []);
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}
}

type ShikiHighlighter = any;

async function buildSvgDataUriWithShiki(
	segments: OverlaySegment[],
	unfinished: boolean,
	languageId: string,
	isNoHighligh: boolean): Promise<{ uri: vscode.Uri; width: number; height: number }> {
	const config = getConfig();
	const bgColor = config.backgroundColor;

	let texts = '';
	let computedWidth = 0;
	let computedHeight = 0;
	
	const decorateds: shiki.DecorationItem[] = [];
	const code = segments.map(segment => { return ' '.repeat(segment.paddingLeftCh) + segment.text.replace(/\u00A0/g, ' '); }).join("\n");
	const charDiffs = segments.map(segment => { return segment.visualDiffSegments; });
	const html = await generateHighlightedHtml(code, decorateds, getConfig().shikiTheme, languageId);
	const conv = await convertShikiHtmlToSvgGut(html, charDiffs, (unfinished ? 'italic' : 'normal'), (unfinished ? 0.7 : 1), isNoHighligh);
	texts += conv.guts;
	computedWidth = Math.ceil(conv.maxWidth);
	computedHeight = Math.ceil(conv.totalHeight);

	const width = Math.max(1, computedWidth);
	const height = Math.max(1, computedHeight);
	
	// make background color
	const tonedownBackgroundColor = isDarkTheme()
									? `rgb(${parseInt(bgColor.slice(1, 3), 16) * 0.9}, ${parseInt(bgColor.slice(3, 5), 16) * 0.9}, ${parseInt(bgColor.slice(5, 7), 16) * 0.9})`
									: `rgb(${parseInt(bgColor.slice(1, 3), 16) * 0.98}, ${parseInt(bgColor.slice(3, 5), 16) * 0.98}, ${parseInt(bgColor.slice(5, 7), 16) * 0.98})`;


	const overlayColors = getOverlayColors();
	const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
	<rect x="0" y="0" width="${width}" height="${height}" fill="${tonedownBackgroundColor}" stroke="${overlayColors.borderColor}" stroke-width="1" />
${texts}
</svg>`;
	const encoded = encodeURIComponent(svg)
		.replace(/'/g, '%27')
		.replace(/"/g, '%22');
	return { uri: vscode.Uri.parse(`data:image/svg+xml;utf8,${encoded}`), width, height };
}

/**
 * Generates highlighted HTML from source code using Shiki highlighter.
 * The generated HTML is later converted to SVG via convertShikiHtmlToSvgGut().
 */
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

// Converts highlighted HTML to SVG content with proper text positioning and character diff rendering
async function convertShikiHtmlToSvgGut(
	shikiHtml: string,
	charDiffSegmentsList: CharDiffSegment[][],
	fontStyle: string,
	fontOpacity: number,
	isNoHighligh: boolean): Promise<{
	guts: string; maxWidth: number; totalHeight: number }> {
	const dom = new JSDOM(shikiHtml);
	const document = dom.window.document;
    const config = getConfig();
    const overlayColors = getOverlayColors();
	const defaultColor = extractDefaultTextColor(document);
	const defaultColorAttr = defaultColor ? ` style="color:${defaultColor}"` : "";

	const lines = Array.from(document.querySelectorAll(".line")) as Element[];
	let maxWidth = 0;
	const svgLines = await Promise.all(lines.map(async (line, index) => {
		// code texts
		const spans = Array.from(line.childNodes).map((node) => {
			if (node.nodeType === 3) {
				return `<tspan xml:space="preserve"${defaultColorAttr}>${escapeForSVG(node.textContent ?? "")}</tspan>`;
			}

			const el = node as HTMLElement;
			const style = el.getAttribute("style") || "";
			const colorMatch = extractColorFromStyle(style);
			const classes = el.getAttribute("class") || "";
			let appendStyle = (defaultColorAttr && ! colorMatch) ? defaultColorAttr : "";
			let fillColor = colorMatch || defaultColor;
			let fill = fillColor ? ` fill="${fillColor}"` : "";
			if (classes.includes("highlighted")) {
				fill = ` fill="${overlayColors.backgroundColor}"`;
			}

			const content = el.textContent || "";
			return `<tspan${appendStyle} xml:space="preserve"${fill}>${escapeForSVG(content)}</tspan>`;
		}).join("");

		const charDiffSegments = charDiffSegmentsList[index];
		const lineContent = line.textContent || "";
		const width = await getTextWidth(lineContent);
		if (width > maxWidth) maxWidth = width;

		const rectY = index * config.lineHeight;
		const textY = rectY + Math.round(config.lineHeight * TEXT_Y_RATIO);
		
		// highlighted bg
		const rects: string[] = [];
		if (! isNoHighligh) {
			for(const segment of charDiffSegments) {
				if (segment.type !== 'add') continue;
				const diffX = await getTextWidth(lineContent.slice(0, segment.newIdx));
				const diffWidth = await getTextWidth(segment.text);
				rects.push(`<rect x="${diffX}" y="${rectY}" width="${diffWidth}" height="${config.lineHeight}" fill="${overlayColors.backgroundColor}" />`);
			}
		}

		// code(span) to text tag
        const text = `<text x="0" y="${textY}" font-family="${config.fontFamily}" font-size="${config.fontSize}" font-weight="${config.fontWeight}" font-style="${fontStyle}" style="opacity:${fontOpacity}" dominant-baseline="alphabetic" xml:space="preserve" shape-rendering="crispEdges">${spans}</text>`;

		// marge highlighted bg and code text
		return `${rects.join("\n")}\n${text}`;
	}));

	const totalHeight = lines.length * config.lineHeight;

	return {
		guts: svgLines.join("\n"),
		maxWidth,
		totalHeight,
	};
}

function extractDefaultTextColor(document: Document): string | null {
	const candidates = [document.querySelector('code'), document.querySelector('pre')];
	for (const el of candidates) {
		const color = extractColorFromStyle(el?.getAttribute('style') || '');
		if (color) {
			return color;
		}
	}
	return null;
}
function extractColorFromStyle(style: string): string | null {
	if (!style) return null;

	const declarations = style.split(';');
	for (const decl of declarations) {
		const parts = decl.split(':');
		if (parts.length < 2) continue;

		const property = parts[0].trim().toLowerCase();
		if (property === 'color') {
			// Join the value parts with ':' and trim. It's okay if the value contains a colon.
			const value = parts.slice(1).join(':').trim();
			return value || null;
		}
	}

	return null;
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
						const fallbackTheme = isDarkTheme() ? 'dark-plus' : 'light-plus';
						const highlighter = await shiki.createHighlighter({ themes: [fallbackTheme], langs: ['c'] });
						try { highlighter.setTheme(fallbackTheme); } catch {}
						return highlighter;
					} catch (fallbackError) {
						logDebug(`Fallback to 'c' also failed: ${fallbackError}`);
					}
				}
				
				// Finally create a highlighter for plain text
				const fallback = isDarkTheme() ? 'dark-plus' : 'light-plus';
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
	const config = getConfig();
	try {
		const ed = editor || vscode.window.activeTextEditor;
		if (!ed) return 0;
		const widths = await measureTextsWidthPx(config.fontFamily, config.fontSize, config.fontWeight, config.fontStyle, [text], ed);
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



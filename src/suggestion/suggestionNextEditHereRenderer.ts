import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { isDarkTheme } from '../utils/cotabUtil';
import { measureTextsWidthPx } from '../utils/textMeasurer';
import { logDebug } from '../utils/logger';
import { getTextWidth } from './suggestionSvgRenderer';
import { NextEditLineData } from './suggestionStore';

const LABEL_TEXT = 'TAB to jump here';
const PADDING_X_L = 2;
const PADDING_X_R = 10;
const TAB_PADDING = 2;
const ARROW_WIDTH = 2;
const ARROW_PADDING = 4;
const TEXT_Y_RATIO = 0.72;

type NextEditColors = {
	background: string;
	barColor: string;
	border: string;
	text: string;
	tabBackground: string;
	shadow: string;
};

let decorationType: vscode.TextEditorDecorationType | undefined;
let renderTimer: NodeJS.Timeout | null = null;

export function setupNextEditHereRenderer(): void {
	if (decorationType) {
		return;
	}
	decorationType = vscode.window.createTextEditorDecorationType({
		rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		after: {
			margin: '0 0 0 6px',
		},
	});
}

export function disposeNextEditHereRenderer(): void {
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}
	if (decorationType) {
		decorationType.dispose();
		decorationType = undefined;
	}
}

export function clearNextEditHere(editor: vscode.TextEditor): void {
	if (!decorationType) {
		return;
	}
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}
	editor.setDecorations(decorationType, []);
}

export function renderNextEditHere(editor: vscode.TextEditor, nextEditLineData: NextEditLineData | undefined): void {
	if (!decorationType) {
		setupNextEditHereRenderer();
	}
	if (!decorationType) {
		return;
	}
	if (renderTimer) {
		clearTimeout(renderTimer);
		renderTimer = null;
	}

	renderTimer = setTimeout(async () => {
		renderTimer = null;
		if (nextEditLineData === undefined ||
			nextEditLineData.line < 0 || nextEditLineData.line >= editor.document.lineCount) {
			clearNextEditHere(editor);
			return;
		}

		try {
			const svgData = await buildNextEditHereSvg(editor);
			const line = nextEditLineData.line;
			const lineEnd = editor.document.lineAt(line).range.end;

			const marginWidth = await getTextWidth(' ', editor) ?? 0;

			const decorations: vscode.DecorationOptions[] = [{
				range: new vscode.Range(line, lineEnd.character, line, lineEnd.character),
				renderOptions: {
					after: {
						contentIconPath: svgData.uri,
						width: `${Math.ceil(svgData.width)}px`,
						height: `${Math.ceil(svgData.height)}px`,
						textDecoration: `;
							position: absolute;
							z-index: 2147483647`,
						margin: `0 0 0 ${marginWidth}px`
					},
				},
			}];
			editor.setDecorations(decorationType!, decorations);
		} catch (error) {
			logDebug(`renderNextEditHere error: ${String(error)}`);
		}
	}, 0);
}

function getColors(): NextEditColors {
	if (isDarkTheme()) {
		return {
			background: '#2d2d30',
			barColor: '#007acc',
			border: '#3e3e42',
			text: '#cccccc',
			tabBackground: '#1d1d1fff',
			shadow: 'rgba(0,0,0,0.3)',
		};
	}
	return {
		background: '#f3f3f3',
		barColor: '#0078d4',
		border: '#d0d0d0',
		text: '#333333',
		tabBackground: '#e0e0e0',
		shadow: 'rgba(0,0,0,0.1)',
	};
}

async function buildNextEditHereSvg(editor: vscode.TextEditor): Promise<{ uri: vscode.Uri; width: number; height: number }> {
	const config = getConfig();
	const colors = getColors();
	const fontSize = config.fontSize;
	const fontFamily = config.fontFamily;
	const fontWeight = config.fontWeight;
	const fontStyle = config.fontStyle;

	let textWidth = 0;
	try {
		const widths = await measureTextsWidthPx(fontFamily, fontSize, fontWeight, fontStyle, [LABEL_TEXT], editor);
		textWidth = widths[0] ?? 0;
	} catch (error) {
		logDebug(`buildNextEditHereSvg measure error: ${String(error)}`);
		textWidth = LABEL_TEXT.length * fontSize * 0.6;
	}

	const height = config.lineHeight;//Math.max(Math.round(config.lineHeight * 0.85), fontSize + PADDING_Y * 2);
	const width = Math.max(Math.round(textWidth + PADDING_X_L + PADDING_X_R + ARROW_WIDTH), 80);
	const radius = Math.min(8, height / 2);
	const textY = Math.round(height * TEXT_Y_RATIO);
	const textX = ARROW_WIDTH + ARROW_PADDING + PADDING_X_L;

	// Measure "TAB" width
	let tabWidth = 0;
	const tabText = 'TAB';
	const restText = ' to jump here';
	try {
		const tabWidths = await measureTextsWidthPx(fontFamily, fontSize, fontWeight, fontStyle, [tabText], editor);
		tabWidth = tabWidths[0] ?? 0;
	} catch (error) {
		logDebug(`buildNextEditHereSvg tab width measure error: ${String(error)}`);
		tabWidth = tabText.length * fontSize * 0.6;
	}
	tabWidth += TAB_PADDING * 2;
	const tabBackgroundY = TAB_PADDING;
	const tabBackgroundHeight = height - TAB_PADDING * 2;

	const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
	<defs>
		<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
			<feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="${colors.shadow}"/>
		</filter>
	</defs>
	<rect x="0" y="0" width="${ARROW_WIDTH}" height="${height}" fill="${colors.barColor}"/>
	<path d="M ${ARROW_WIDTH + ARROW_PADDING + 2},0 L ${width - radius},0 A ${radius},${radius} 0 0,1 ${width},${radius} L ${width},${height - radius} A ${radius},${radius} 0 0,1 ${width - radius},${height} L ${ARROW_WIDTH + ARROW_PADDING + 2},${height} A 2,2 0 0,1 ${ARROW_WIDTH + ARROW_PADDING},${height - 2} L ${ARROW_WIDTH + ARROW_PADDING},2 A 2,2 0 0,1 ${ARROW_WIDTH + ARROW_PADDING + 2},0 Z" fill="${colors.background}" stroke="${colors.border}" stroke-width="1" filter="url(#shadow)" />
	<rect x="${textX - TAB_PADDING}" y="${tabBackgroundY}" width="${tabWidth}" height="${tabBackgroundHeight}" rx="2" ry="2" fill="${colors.tabBackground}"/>
	<text x="${textX}" y="${textY}" fill="${colors.text}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" font-style="${fontStyle}" dominant-baseline="alphabetic" xml:space="preserve" shape-rendering="crispEdges"><tspan>${tabText}</tspan><tspan font-style="italic">${restText}</tspan></text>
</svg>`;

	const encoded = encodeURIComponent(svg)
		.replace(/'/g, '%27')
		.replace(/"/g, '%22');
	return {
		uri: vscode.Uri.parse(`data:image/svg+xml;utf8,${encoded}`),
		width,
		height,
	};
}


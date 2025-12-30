import * as vscode from 'vscode';
import { SimpleLocker } from './cotabUtil';
import { logDebug } from './logger';

type PendingEntry = {
	resolve: (widths: number[]) => void;
	reject: (error: unknown) => void;
};

let panelInstance: vscode.WebviewPanel | undefined;
let panelCreatingPromise: Promise<vscode.WebviewPanel | undefined> | undefined;
let requestIdCounter = 1;
const bridgePromises = new Map<number, PendingEntry>();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const IDLE_DISPOSE_MS = 15000; // Wait time until idle disposal

const locker = new SimpleLocker();
const fontCaches = new Map<string, LruMap<string, number>>();
const charWidthCaches = new Map<string, { singleByteWidth: number; doubleByteWidth: number }>();

class LruMap<K, V> {
	private map: Map<K, V>;
	constructor(private capacity: number) {
		this.map = new Map();
	}
	get(key: K): V | undefined {
		if (!this.map.has(key)) return undefined;
		const value = this.map.get(key)!;
		// Update to most recently used
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}
	has(key: K): boolean {
		return this.map.has(key);
	}
	set(key: K, value: V): void {
		if (this.map.has(key)) {
			this.map.delete(key);
		}
		this.map.set(key, value);
		if (this.map.size > this.capacity) {
			// Remove the first (oldest) entry
			const oldestKey = this.map.keys().next().value as K | undefined;
			if (oldestKey !== undefined) this.map.delete(oldestKey);
		}
	}
}

function getFontKey(fontFamily: string, fontSize: number, fontWeight: string, fontStyle: string): string {
	return `${fontFamily}|${fontWeight}|${fontStyle}|${fontSize}`;
}

function getCacheForFont(fontKey: string): LruMap<string, number> {
	let cache = fontCaches.get(fontKey);
	if (!cache) {
		cache = new LruMap<string, number>(2000);
		fontCaches.set(fontKey, cache);
	}
	return cache;
}

function getCharWidthCache(fontKey: string): { singleByteWidth: number; doubleByteWidth: number } | undefined {
	return charWidthCaches.get(fontKey);
}

function setCharWidthCache(fontKey: string, data: { singleByteWidth: number, doubleByteWidth: number }): void {
	charWidthCaches.set(fontKey, data);
}

function disposePanelSafely(reason: string): void {
	try {
		panelInstance?.dispose();
	} catch (error) {
		logDebug(`Failed to dispose text measurer panel (${reason}): ${error}`);
	}
}

function kickIdleTimer(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		disposePanelSafely('idle timeout');
	}, IDLE_DISPOSE_MS);
}

async function ensurePanel(): Promise<vscode.WebviewPanel | undefined> {
	if (panelInstance) return panelInstance;
	if (panelCreatingPromise) return panelCreatingPromise;

	panelCreatingPromise = new Promise<vscode.WebviewPanel | undefined>((resolve) => {
		panelInstance = vscode.window.createWebviewPanel(
			'cotabTextMeasurer',
			'Cotab Text Measurer',
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{ enableScripts: true, retainContextWhenHidden: true }
		);

		panelInstance.webview.html = getHtml();

		panelInstance.webview.onDidReceiveMessage((message) => {
			if (!message || typeof message.id !== 'number') return;
			const pending = bridgePromises.get(message.id);
			if (!pending) return;
			if (message.type === 'measureResult' && Array.isArray(message.widths)) {
				pending.resolve(message.widths);
				bridgePromises.delete(message.id);
				// Close immediately for character width measurement. Otherwise dispose on idle
				if (message.isCharWidthMeasurement) {
					setTimeout(() => disposePanelSafely('char width measurement complete'), 100);
				} else {
					kickIdleTimer();
				}
			} else if (message.type === 'measureError') {
				pending.reject(new Error(String(message.error || 'measure error')));
				bridgePromises.delete(message.id);
				kickIdleTimer();
			}
		});

		panelInstance.onDidDispose(() => {
			for (const [id, p] of Array.from(bridgePromises.entries())) {
				p.reject(new Error('Text measurer webview disposed'));
				bridgePromises.delete(id);
			}
			if (idleTimer) {
				clearTimeout(idleTimer);
				idleTimer = undefined;
			}
			panelInstance = undefined;
			resolve(undefined);
		});

		resolve(panelInstance);
	}).finally(() => {
		panelCreatingPromise = undefined;
	});

	return panelCreatingPromise;
}

function disposePanel(): void {
	if (panelInstance) {
		panelInstance.dispose();
		panelInstance = undefined;
	}
}

function getHtml(): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root, body, html { margin:0; padding:0; overflow:hidden; width:1px; height:1px; background: transparent; }
  #off { position: fixed; top: -10000px; left: -10000px; visibility: hidden; }
  canvas { width: 1px; height: 1px; }
  /* Keep layout elements invisible */
</style>
</head>
<body>
<div id="off"></div>
<canvas id="c"></canvas>
<script>
  const vscode = acquireVsCodeApi();
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'measure') return;
    try {
      const canvas = document.getElementById('c');
      const ctx = canvas.getContext('2d');
      const fontFamily = msg.fontFamily || 'monospace';
      const fontSize = msg.fontSize || 14;
      const fontWeight = msg.fontWeight || 'normal';
      const fontStyle = msg.fontStyle || 'normal';
      ctx.font = fontStyle + ' ' + fontWeight + ' ' + fontSize + 'px ' + fontFamily;
      const widths = msg.texts.map(t => ctx.measureText(String(t ?? '')).width);
      vscode.postMessage({ type: 'measureResult', id: msg.id, widths, isCharWidthMeasurement: msg.isCharWidthMeasurement });
    } catch (e) {
      vscode.postMessage({ type: 'measureError', id: msg.id, error: String(e) });
    }
  });
</script>
</body>
</html>`;
}

// Measure 1/2-byte width briefly in Webview when needed and cache
async function getCharData(fontFamily: string, fontSize: number, fontWeight: string, fontStyle: string):
    Promise<{ singleByteWidth: number; doubleByteWidth: number }> {
	const fontKey = getFontKey(fontFamily, fontSize, fontWeight, fontStyle);
	let charCache = getCharWidthCache(fontKey);
	if (!charCache) {
		try {
			// lock
			await locker.acquireLock();

			const checkOneMore = getCharWidthCache(fontKey);
			if (!checkOneMore) {
				// create webview
				const panel = await ensurePanel();
				const idChar = requestIdCounter++;
				const promise = new Promise<number[]>((resolve, reject) => {
					bridgePromises.set(idChar, { resolve, reject });
				});
				kickIdleTimer();

				// Calculate width in webview
				panel?.webview.postMessage({ type: 'measure', id: idChar, fontFamily, fontSize, fontWeight, fontStyle, texts: ['A', 'あ'], isCharWidthMeasurement: true });
				const [singleByteWidth, doubleByteWidth] = await promise.then(ws => [ws[0] ?? 0, ws[1] ?? 0]);
				const data: { singleByteWidth: number, doubleByteWidth: number } = {
					singleByteWidth, doubleByteWidth
				}
				setCharWidthCache(fontKey, data);
				charCache = data;
			} else {
				charCache = checkOneMore;
			}
		} finally {
            disposePanel();
			locker.releaseLock();
		}
	}
	return charCache || { singleByteWidth: fontSize/2, doubleByteWidth: fontSize };
}

export async function measureTextsWidthPx(fontFamily: string, fontSize: number, fontWeight: string, fontStyle: string,
										texts: string[], editor: vscode.TextEditor): Promise<number[]> {
	if (!texts || texts.length === 0) return [];

	const fontKey = getFontKey(fontFamily, fontSize, fontWeight, fontStyle);
	const charData = await getCharData(fontFamily, fontSize, fontWeight, fontStyle);
	// String width cache & deduplication
	const cache = getCacheForFont(fontKey);
	const normalized = texts.map(t => String(t ?? ''));
	const result = new Array<number>(normalized.length);
	const valueToPositions = new Map<string, number[]>();
	const uniqueToMeasure: string[] = [];

	for (let i = 0; i < normalized.length; i++) {
		const value = normalized[i];
		const cached = cache.get(value);
		if (typeof cached === 'number') {
			result[i] = cached;
			continue;
		}
		let pos = valueToPositions.get(value);
		if (!pos) {
			pos = [];
			valueToPositions.set(value, pos);
			uniqueToMeasure.push(value);
		}
		pos.push(i);
	}

	if (uniqueToMeasure.length === 0) {
		return result.map(v => (typeof v === 'number' ? v : 0));
	}

	// Calculate uncached items locally (using 1/2-byte width cache)
	const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : parseInt(String(editor.options.tabSize || 4), 10) || 4;
	for (const text of uniqueToMeasure) {
		let widthPx = 0;
		let column = 0;
		for (let i = 0; i < text.length; i++) {
			const cp = text.codePointAt(i)!;
			if (cp > 0xffff) i++;
			if (cp === 0x0d || cp === 0x0a) continue;
			if (cp === 0x09) { // tab
				const nextTab = tabSize - (column % tabSize);
				widthPx += nextTab * charData.singleByteWidth;
				column += nextTab;
				continue;
			}
			const isFull = (
				(cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a ||
				(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
				(cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
				(cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
				(cp >= 0xffe0 && cp <= 0xffe6)
			);
			const chWidthPx = isFull ? charData.doubleByteWidth : charData.singleByteWidth;
			widthPx += chWidthPx;
			column += isFull ? 2 : 1;
		}
		cache.set(text, widthPx);
		const positions = valueToPositions.get(text) || [];
		for (const idx of positions) result[idx] = widthPx;
	}

	for (let i = 0; i < result.length; i++) if (typeof result[i] !== 'number') result[i] = 0;
	return result;
}


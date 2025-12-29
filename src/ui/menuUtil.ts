import { Buffer } from 'buffer';

export function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function buildLinkButtonSvgDataUri(label: string, bgColor: string, fgColor: string): string {
    // eslint-disable-next-line no-useless-escape -- literal [ ] ( ) and backslash must be escaped for removal
    const text = label.replace(/[\[\]()\\`]/g, '');
    const paddingX = 14;
    const fontSize = 12;
    const approxCharW = 7; // Approximate width
    const textWidth = Math.max(40, Math.ceil(text.length * approxCharW));
    const width = textWidth + paddingX * 2;
    const height = 22;
    const radius = 6;

    const svg = `<?xml version='1.0' encoding='UTF-8'?>`
        + `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`
        + `<rect x='0' y='0' width='${width}' height='${height}' rx='${radius}' ry='${radius}' fill='${bgColor}'/>`
        + `<text x='${width / 2}' y='${Math.round(height / 2 + 4)}' text-anchor='middle'`
        + ` font-family='-apple-system,Segoe UI,Ubuntu,Helvetica,Arial,sans-serif'`
        + ` font-size='${fontSize}' fill='${fgColor}'>${escapeXml(text)}</text>`
        + `</svg>`;
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    return 'data:image/svg+xml;base64,' + base64;
}

type NetworkServerLabelTheme = 'green' | 'blue' | 'red' | 'yellow' | 'cyan' | 'purple' | 'gray';

const NETWORK_LABEL_GRADIENTS: Record<NetworkServerLabelTheme, { start: string; end: string }> = {
    green: { start: '#1a7032', end: '#20ab6c' },
    blue: { start: '#1a4d8c', end: '#2d7dd2' },
    red: { start: '#b02a37', end: '#d63384' },
    yellow: { start: '#b8860b', end: '#d4a017' },
    cyan: { start: '#0f6674', end: '#20a2a8' },
    purple: { start: '#5a2d91', end: '#7c3aed' },
    gray: { start: '#4b4b4bff', end: '#6e6e6eff' },
};

/**
 * Check if a character is a full-width character (Japanese, Chinese, Korean, etc.)
 * Based on the comprehensive check used in textMeasurer.ts
 */
function isFullWidthChar(char: string): boolean {
    const cp = char.codePointAt(0)!;
    // Comprehensive check for full-width characters:
    // - Hangul Jamo: 0x1100-0x115F
    // - CJK Radicals Supplement, CJK Unified Ideographs Extension A, CJK Unified Ideographs: 0x2E80-0xA4CF (excluding 0x303F)
    // - Hangul Syllables: 0xAC00-0xD7A3
    // - CJK Compatibility Ideographs: 0xF900-0xFAFF
    // - Vertical Forms: 0xFE10-0xFE19
    // - CJK Compatibility Forms: 0xFE30-0xFE6F
    // - Fullwidth ASCII, Fullwidth Digits: 0xFF00-0xFF60
    // - Fullwidth Symbols: 0xFFE0-0xFFE6
    // - Special brackets: 0x2329, 0x232A
    // - Hiragana: 0x3040-0x309F
    // - Katakana: 0x30A0-0x30FF
    // - CJK Symbols and Punctuation: 0x3000-0x303F
    return (
        (cp >= 0x1100 && cp <= 0x115F) || // Hangul Jamo
        cp === 0x2329 || cp === 0x232A || // Angle brackets
        (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) || // CJK Radicals, Extension A, Unified Ideographs
        (cp >= 0xAC00 && cp <= 0xD7A3) || // Hangul Syllables
        (cp >= 0xF900 && cp <= 0xFAFF) || // CJK Compatibility Ideographs
        (cp >= 0xFE10 && cp <= 0xFE19) || // Vertical Forms
        (cp >= 0xFE30 && cp <= 0xFE6F) || // CJK Compatibility Forms
        (cp >= 0xFF00 && cp <= 0xFF60) || // Fullwidth ASCII and Digits
        (cp >= 0xFFE0 && cp <= 0xFFE6) || // Fullwidth Symbols
        (cp >= 0x3040 && cp <= 0x309F) || // Hiragana
        (cp >= 0x30A0 && cp <= 0x30FF) || // Katakana
        (cp >= 0x3000 && cp <= 0x303F)    // CJK Symbols and Punctuation
    );
}

export function buildNetworkServerLabelSvgDataUri(
    text: string = 'Network Server Running',
    theme: NetworkServerLabelTheme = 'green',
): string {
    const paddingX = 8;
    const height = 28;
    const fontSize = 12;
    const approxCharW = 7; // Half-width character width
    const approxFullWidthCharW = 14; // Full-width character width (Japanese, Chinese, etc.)
    
    // Calculate text width considering full-width characters
    let textWidth = 0;
    for (let i = 0; i < text.length; i++) {
        if (isFullWidthChar(text[i])) {
            textWidth += approxFullWidthCharW;
        } else {
            textWidth += approxCharW;
        }
    }
    
    // Ensure minimum width for short text
    textWidth = Math.max(80, Math.ceil(textWidth));
    const width = textWidth + paddingX * 2;
    const radius = 8;

    const gradient = NETWORK_LABEL_GRADIENTS[theme] ?? NETWORK_LABEL_GRADIENTS.green;

    const svg = `<?xml version='1.0' encoding='UTF-8'?>`
        + `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`
        + `<defs>`
        + `<linearGradient id='networkGradient' x1='0%' y1='0%' x2='100%' y2='0%'>`
        + `<stop offset='0%' style='stop-color:${gradient.start};stop-opacity:1' />`
        + `<stop offset='100%' style='stop-color:${gradient.end};stop-opacity:1' />`
        + `</linearGradient>`
        + `<filter id='glow'>`
        + `<feGaussianBlur stdDeviation='2' result='coloredBlur'/>`
        + `<feMerge>`
        + `<feMergeNode in='coloredBlur'/>`
        + `<feMergeNode in='SourceGraphic'/>`
        + `</feMerge>`
        + `</filter>`
        + `</defs>`
        + `<rect x='0' y='0' width='${width}' height='${height}' rx='${radius}' ry='${radius}' fill='url(#networkGradient)' filter='url(#glow)'/>`
        + `<text x='${width / 2}' y='${Math.round(height / 2 + 4)}' text-anchor='middle'`
        + ` font-family='-apple-system,Segoe UI,Ubuntu,Helvetica,Arial,sans-serif'`
        + ` font-size='${fontSize}' font-weight='500' fill='#ffffff'`
        + ` text-shadow='0 1px 2px rgba(0,0,0,0.3)'>${escapeXml(text)}</text>`
        + `</svg>`;
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    return 'data:image/svg+xml;base64,' + base64;
}



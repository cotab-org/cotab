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
    const text = label.replace(/[`\\\[\]\(\)]/g, '');
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

export function buildNetworkServerLabelSvgDataUri(text: string = 'Network Server Running'): string {
    const paddingX = 8;
    const height = 28;
    const fontSize = 12;
    const approxCharW = 7;
    const textWidth = Math.ceil(text.length * approxCharW);
    const width = textWidth + paddingX * 2;
    const radius = 8;

    const svg = `<?xml version='1.0' encoding='UTF-8'?>`
        + `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`
        + `<defs>`
        + `<linearGradient id='networkGradient' x1='0%' y1='0%' x2='100%' y2='0%'>`
        + `<stop offset='0%' style='stop-color:#28a745;stop-opacity:1' />`
        + `<stop offset='100%' style='stop-color:#20c997;stop-opacity:1' />`
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



import * as vscode from 'vscode';
import { getConfig, setConfigEnabled } from '../utils/config';
import { statusBarManager } from './statusBarManager';
import { terminalCommand } from '../utils/terminalCommand';
import { getAiClient } from '../llm/llmProvider';
import { onChangedEnableExtension } from '../extension';

// Singleton instance ------------------------------------------------------
export let menuIndicator: MenuIndicator;

export function registerMenuIndicator(disposables: vscode.Disposable[]): void {
    menuIndicator = new MenuIndicator();
    disposables.push(menuIndicator);
}

export function requestUpdateCotabMenu() {
    UpdateCotabMenu();
}

class MenuIndicator implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.registerCommands();

        requestUpdateCotabMenu();
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    // ------------------------------------------------------------------
    private registerCommands() {
        // Show Cotab menu
        setTimeout(() => { void requestUpdateCotabMenu(); }, 0);   // update after launch
        setTimeout(() => { void requestUpdateCotabMenu(); }, 3000);// update after launch
        /*
        this.disposables.push(vscode.commands.registerCommand('cotab.showMenu', async () => {
            await requestUpdateCotabMenu();
        }));
        */

        // enable/disable
        this.disposables.push(vscode.commands.registerCommand('cotab.toggleEnabled', async () =>{
            await toggleEnabledCmd();
        }));
        
        // install llama.cpp
        this.disposables.push(vscode.commands.registerCommand('cotab.server.install', async () => {
            await installLlamaServer();
        }));

        // uninstall llama.cpp
        this.disposables.push(vscode.commands.registerCommand('cotab.server.uninstall', async () => {
            await uninstallLlamaServer();
        }));

        /*
        // update llama.cpp
        this.disposables.push(vscode.commands.registerCommand('cotab.server.update', async () => {
            await updateLlamaServer();
        }));
        */

        // Server commands (used by markdown links)
        this.disposables.push(vscode.commands.registerCommand('cotab.server.start', async () => {
            await startLlamaServer();
        }));
        this.disposables.push(vscode.commands.registerCommand('cotab.server.stop', async () => {
            await stopLlamaServer();
        }));

        // Toggle enable
        this.disposables.push(vscode.commands.registerCommand('cotab.openCommand', async () => {
            await vscode.commands.executeCommand('workbench.action.quickOpen', '>cotab: [Server] ');
        }));
    }
}

// ---------------- existing functional implementation below ----------------

async function CloseCotabMenu() {
    await UpdateCotabMenu(true);
}

let isUpdatingMenu = false;
let prevTooltip: string;
async function UpdateCotabMenu(isReset: boolean = false): Promise<string> {
    if (isUpdatingMenu) return prevTooltip;
    isUpdatingMenu = true;

    try {
        // Show rich tooltip-like popup with command links
        if (isReset) {
            statusBarManager.setTooltip("");
            prevTooltip = "";
            return prevTooltip;
        }
        else {
            const md = await buildMainMenuMarkdown();
            statusBarManager.setTooltip(md);
            prevTooltip = md.value;
            return prevTooltip;
        }
    } finally {
        isUpdatingMenu = false;
    }
}



// メニューのツールチップが変化するまで定期的にチェックして更新する（最大30秒）
export function requestUpdateCotabMenuUntilChanged(maxMillis: number = 30000, intervalMs: number = 100): void {
	const startedAt = Date.now();
	const baseline = prevTooltip ?? '';

	const timer = setInterval(async () => {
		if (Date.now() - startedAt >= maxMillis) {
			clearInterval(timer);
			return;
		}

		const current = await UpdateCotabMenu();
		if (current !== baseline) {
			clearInterval(timer);
		}
	}, intervalMs);
}


async function buildMainMenuMarkdown(): Promise<vscode.MarkdownString> {
    const config = getConfig();
    const isEnabled = config.enabled;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;

    // Header
    md.appendMarkdown(`Code Completions\n`);

    // Enable/disable toggle with checkbox style
    const enableCheckbox = checkboxControl('Enable autocomplete', isEnabled, 'command:cotab.toggleEnabled');
    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`${enableCheckbox}\n`);

    // Server
    let serverStatus;
    if (await terminalCommand.isRunningLocalLlamaServer()) {
        serverStatus = linkButton('Stop Server', 'command:cotab.server.stop', '#d83b01', '#ffffff');
    }
    else if (await isServerRunning()) {
        serverStatus = createNetworkServerLabel();
    }
    else if (await terminalCommand.isInstalledLocalLlamaServer()) {
        serverStatus = linkButton('Start Server', 'command:cotab.server.start', '#007acc', '#ffffff');
    }
    else {
        serverStatus = linkButton('Install Server', 'command:cotab.server.install', '#2ea043', '#ffffff');
    }
    
    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`${serverStatus}`);
    
    
    // Add command palette and settings icons
    const terminalIcon = `[$(terminal)](command:cotab.openCommand)`;
    const gearIcon = `[$(gear)](command:workbench.action.openSettings?%5B%22>cotab%22%5D)`;
    md.appendMarkdown(`\n\n---\n\n`);
    md.appendMarkdown(`${terminalIcon} | ${gearIcon}`);
    
    return md;
}


/**
 * Generate button-style SVG as data URI image and return Markdown link to specified command.
 */
function linkButton(label: string, commandLink: string, bgColor: string, fgColor: string): string {
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
    const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    return `[![](${uri})](${commandLink})`;
}

function escapeXml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Checkbox-style link (visual only, executes command on click)
function checkboxLink(label: string, checked: boolean, commandLink: string): string {
    const box = checked ? '[x]' : '[ ]';
    const text = `${box} ${label}`;
    return `[${text}](${commandLink})`;
}

// VS Code-style checkbox (SVG) + make entire label clickable
function checkboxControl(label: string, checked: boolean, commandLink: string): string {
    const icon = checkboxSvg(checked);
    const img = `![](${icon})`;
    // Use markdown with proper spacing to align icon and text
    return `[${img}](${commandLink}) ${label}`;
}

function checkboxSvg(checked: boolean): string {
    const size = 14; // Small size to match VS Code style
    const radius = 3;
    const stroke = '#3c3c3c';
    const bg = '#1f1f1f';
    const fg = '#ffffff';
    const accent = '#0e639c'; // VS Code accent
    
    const standardSize = 14;
    const shift = (size - standardSize) / 2;

    const boxFill = checked ? accent : bg;
    const boxStroke = checked ? accent : stroke;
    const check = checked
        ? `<path d='M${3.2 + shift} ${7.3 + shift} L${6 + shift} ${10.1 + shift} L${10.8 + shift} ${4.6 + shift}' stroke='${fg}' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round' />`
        : '';

    const svg = `<?xml version='1.0' encoding='UTF-8'?>`
        + `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' style='vertical-align: middle;'>`
        + `<rect x='0.5' y='0.5' width='${size - 1}' height='${size - 1}' rx='${radius}' ry='${radius}' fill='${boxFill}' stroke='${boxStroke}'/>`
        + `${check}`
        + `</svg>`;

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/**
 * Create a stylish network server label with gradient background and status indicator
 */
function createNetworkServerLabel(): string {
    const text = 'Network Server Running';
    const paddingX = 8;
    const paddingY = 8;
    const fontSize = 12;
    const approxCharW = 7;
    const textWidth = Math.ceil(text.length * approxCharW);
    const width = textWidth + paddingX * 2;
    const height = 28;
    const radius = 8;

    // Gradient background and status indicator
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
    
    const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
    return `![](${uri})`;
}

async function setEnabledCmd(enabled: boolean) {
    // Set config enabled
	await setConfigEnabled(enabled);
    
    // Notify extension that enable changed
    onChangedEnableExtension(enabled);

    statusBarManager.reset();

    requestUpdateCotabMenu();

    //const message = newValue ? 'Cotab has been enabled' : 'Cotab has been disabled';
    //vscode.window.showInformationMessage(message);
}

async function toggleEnabledCmd() {
    // Hide immediately for best click response
    await CloseCotabMenu();
    
	await setEnabledCmd(!getConfig().enabled);
}

async function installLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await CloseCotabMenu();
    
    try {
        vscode.window.showInformationMessage('Installing Server (llama.cpp) ...');
        
        // Check if llama.cpp is already installed
        const isInstalled = await checkLlamaCppInstalled();
        if (isInstalled) {
            const choice = await vscode.window.showInformationMessage(
                'Server (llama.cpp) is already installed. Do you want to update?',
                'Yes', 'No'
            );
            if (choice !== 'Yes') {
                return;
            }
        }

        // Download and install llama.cpp
        const result = await terminalCommand.installLocalLlamaCpp();
        if (result) {
            await startLlamaServer();
        }

        // Update menu until changed
        requestUpdateCotabMenuUntilChanged();
        
    }
    catch (error) {
        vscode.window.showErrorMessage(`Server (llama.cpp) install failed: ${error}`);
    }
}

async function uninstallLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await CloseCotabMenu();
    
    try {
        vscode.window.showInformationMessage('Uninstalling Server (llama.cpp) ...');
        
        // Uninstall llama.cpp
        await terminalCommand.uninstallLocalLlamaCpp();

        // Update menu until changed
        requestUpdateCotabMenuUntilChanged();
    }
    catch (error) {
        vscode.window.showErrorMessage(`Server (llama.cpp) uninstall failed: ${error}`);
    }
}

/*
async function updateLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await CloseCotabMenu();
    
    try {
        vscode.window.showInformationMessage('Updating Server (llama.cpp) ...');
        
        // Check if llama.cpp is already installed
        const isInstalled = await checkLlamaCppInstalled();
        if (isInstalled) {
            const choice = await vscode.window.showInformationMessage(
                'Do you want to update Server (llama.cpp)?',
                'Yes', 'No'
            );
            if (choice !== 'Yes') {
                return;
            }
        }

        // Download and install llama.cpp
        await terminalCommand.installLocalLlamaCpp();
        
        // Update menu until changed
        requestUpdateCotabMenuUntilChanged();
    }
    catch (error) {
        vscode.window.showErrorMessage(`Server (llama.cpp) install failed: ${error}`);
    }
}
*/

async function checkLlamaCppInstalled(): Promise<boolean> {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        await execAsync('llama-server --version');
        return true;
    }
    catch {
        return false;
    }
}

async function startLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await CloseCotabMenu();
    
    const config = getConfig();
    const url = new URL(config.apiBaseURL);
    const host = url.hostname || 'localhost';
    const port = url.port || '8080';
    
    // Check if server is already running
    const isRunning = await isServerRunning();
    if (isRunning) {
        const choice = await vscode.window.showInformationMessage(
            `Server is already running on ${host}:${port}. Do you want to restart it?`,
            'Yes', 'No'
        );
        if (choice !== 'Yes') {
            return;
        }
        await stopLlamaServer();
    }
    
    // no await
    const args = config.localServerArg.split(' ');
    terminalCommand.runLocalLlamaServer(args)

    // Update menu until changed
    requestUpdateCotabMenuUntilChanged();
    
    vscode.window.showInformationMessage(`Starting llama-server with command: ${args}`);
}

async function stopLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await CloseCotabMenu();
    
    try {
        // no await
        terminalCommand.stopLocalLlamaServer();

        // Update menu until changed
        requestUpdateCotabMenuUntilChanged();

        vscode.window.showInformationMessage('Llama server stopped');
    }
    catch (error) {
        vscode.window.showErrorMessage(`Failed to stop llama-server: ${error}`);
    }
}

async function isServerRunning(): Promise<boolean> {
    const client = getAiClient();
    return await client.isActive();
}

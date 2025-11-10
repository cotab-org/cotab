import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { onChangedEnableExtension } from '../extension';
import { getConfig, setConfigGlobalEnabled, setConfigExtensionEnabled, setConfigSelectedPromptMode } from '../utils/config';
import { statusBarManager } from './statusBarManager';
import { terminalCommand } from '../utils/terminalCommand';
import { getAiClient } from '../llm/llmProvider';
import { serverManager } from '../managers/serverManager';
import { getYamlConfig, onDidChangeYamlConfig, getYamlConfigPromptModes, openYamlConfig } from '../utils/yamlConfig';
import { buildLinkButtonSvgDataUri, buildNetworkServerLabelSvgDataUri } from './menuUtil';
const execAsync = promisify(exec);

// Singleton instance ------------------------------------------------------
export let menuIndicator: MenuIndicator;

export function registerMenuIndicator(disposables: vscode.Disposable[]): void {
    menuIndicator = new MenuIndicator();
    disposables.push(menuIndicator);
    
    disposables.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            setTimeout(() => {
                requestUpdateCotabMenu();
            }, 200);
        })
    );

    // refreash cotab menu
	const refreashTimer = setInterval(async () => {
        requestUpdateCotabMenu();
	}, 10000);
    disposables.push({
        dispose: () => {
			clearInterval(refreashTimer);
        }
    });
}

export function requestUpdateCotabMenu() {
    updateCotabMenu();
}

// Periodically check and update until menu tooltip changes (max 30 seconds)
export function requestUpdateCotabMenuUntilChanged(maxMillis: number = 30000, intervalMs: number = 1000): void {
	const startedAt = Date.now();
	const baseline = prevTooltip ?? '';

	const timer = setInterval(async () => {
		if (Date.now() - startedAt >= maxMillis) {
			clearInterval(timer);
			return;
		}

		const current = await updateCotabMenu();
		if (current !== baseline) {
			clearInterval(timer);
		}
	}, intervalMs);
}

class MenuIndicator implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private promptModeDisposables: vscode.Disposable[] = [];

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
        this.disposables.push(vscode.commands.registerCommand('cotab.toggleGlobalEnabled', async () =>{
            await toggleGlobalEnabledCmd();
        }));

        // disable for extension
        this.disposables.push(vscode.commands.registerCommand('cotab.toggleExtensionEnabled', async () => {
            await toggleExtensionEnabledCmd();
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

        this.disposables.push(vscode.commands.registerCommand('cotab.openYamlConfig', async () => {
            await openYamlConfig();
        }));

        // Toggle enable
        this.disposables.push(vscode.commands.registerCommand('cotab.openCommand', async () => {
            await vscode.commands.executeCommand('workbench.action.quickOpen', '>cotab: [Server] ');
        }));

        this.disposables.push(onDidChangeYamlConfig(() => {
            this.refreshRegisterSelectPromptModeCommands();
            requestUpdateCotabMenu();
        }));
        
        this.refreshRegisterSelectPromptModeCommands();
    }

    private refreshRegisterSelectPromptModeCommands() {
        // dispose commands
        this.promptModeDisposables.forEach(d => {
            this.disposables.splice(this.disposables.indexOf(d), 1);
            d.dispose()
        });
        this.promptModeDisposables.length = 0;
        
        // register commands
        for (const mode of getYamlConfigPromptModes()) {
            const disposable = vscode.commands.registerCommand(`cotab.selectedPromptMode${mode}`, async () => {
                closeCotabMenu();
                await setConfigSelectedPromptMode(mode);
                requestUpdateCotabMenu();
            });
            this.disposables.push(disposable);
            this.promptModeDisposables.push(disposable);
        }
    }
}

// ---------------- existing functional implementation below ----------------

async function closeCotabMenu() {
    await updateCotabMenu(true);
}

let isUpdatingMenu = false;
let prevTooltip: string;
async function updateCotabMenu(isReset: boolean = false): Promise<string> {
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

async function buildMainMenuMarkdown(): Promise<vscode.MarkdownString> {
    const config = getConfig();
    const isEnabled = config.enabled;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;

    //###########################################################
    // Header
    //###########################################################
    md.appendMarkdown(`Code Completions\n`);

    //###########################################################
    // Enable/disable toggle with checkbox style
    //###########################################################
    md.appendMarkdown(`\n\n---\n\n`);
    const globalEnabledCheckbox = checkboxControl('Enable globally', isEnabled, 'command:cotab.toggleGlobalEnabled');
    md.appendMarkdown(`${globalEnabledCheckbox}\n\n`);

    const languageId: string = vscode.window.activeTextEditor?.document.languageId || '';
    if (languageId) {
        const extensionEnabledCheckbox = checkboxControl(`Enable for ${languageId}`,
                                            getConfig().isExtensionEnabled(languageId),
                                            'command:cotab.toggleExtensionEnabled');
        md.appendMarkdown(`${extensionEnabledCheckbox}\n\n`);
    }

    //###########################################################
    // Completion type section
    //###########################################################
    md.appendMarkdown(`\n\n---\n\n`);
    const selectedPromptMode = getConfig().selectedPromptMode || 'Coding';
    for (const mode of getYamlConfigPromptModes()) {
        const isEnabled = (mode === selectedPromptMode);
        const promptRadio = radioControl(`${mode}`, isEnabled, `command:cotab.selectedPromptMode${mode}`);
        md.appendMarkdown(`${promptRadio}\n\n`);
    }

    //###########################################################
    // Server section
    //###########################################################
    md.appendMarkdown(`\n\n---\n\n`);
    let serverStatus;
    if (await terminalCommand.isRunningLocalLlamaServer()) {
        serverStatus = createStopServerLabel();
    }
    else if (await isServerRunning()) {
        serverStatus = createNetworkServerLabel();
    }
    else if (await terminalCommand.isInstalledLocalLlamaServer()) {
        serverStatus = createStartServerLabel();
    }
    else {
        serverStatus = createInstallServerLabel();
    }
    
    md.appendMarkdown(`${serverStatus}`);
    
    
    //###########################################################
    // Add command palette and settings icons
    //###########################################################
    md.appendMarkdown(`\n\n---\n\n`);
    const openYamlConfig = `[$(comment)](command:cotab.openYamlConfig)`;
    const openCommand = `[$(terminal)](command:cotab.openCommand)`;
    const openSettings = `[$(gear)](command:cotab.gettingStarted.show)`;
    md.appendMarkdown(`${openYamlConfig} | ${openCommand} | ${openSettings}`);
    
    return md;
}


/**
 * Generate button-style SVG as data URI image and return Markdown link to specified command.
 */
function linkButton(label: string, commandLink: string, bgColor: string, fgColor: string): string {
	const uri = buildLinkButtonSvgDataUri(label, bgColor, fgColor);
	return `[![](${uri})](${commandLink})`;
}

// escapeXml is provided by shared module via SVG builders

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
    return `[${img} ${label}](${commandLink})`;
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

// VS Code-style radio button (SVG) + make entire label clickable
function radioControl(label: string, selected: boolean, commandLink: string): string {
    const icon = radioSvg(selected);
    const img = `![](${icon})`;
    return `[${img} ${label}](${commandLink})`;
}

function radioSvg(selected: boolean): string {
    const size = 14;
    const stroke = '#3c3c3c';
    const bg = '#1f1f1f';
    const accent = '#0e639c';
    const dot = '#ffffff';
    const center = size / 2;
    const outerRadius = (size - 1) / 2;

    const dotSvg = selected
        ? `<circle cx='${center}' cy='${center}' r='${size/2/2.5}' fill='${dot}' />`
        : '';

    const svg = `<?xml version='1.0' encoding='UTF-8'?>`
        + `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' style='vertical-align: middle;'>`
        + `<circle cx='${center}' cy='${center}' r='${outerRadius}' fill='${selected ? accent : bg}' stroke='${selected ? accent : stroke}' />`
        + `${dotSvg}`
        + `</svg>`;

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/**
 * Create a stylish network server label with gradient background and status indicator
 */
function createNetworkServerLabel(): string {
	const uri = buildNetworkServerLabelSvgDataUri('Network Server Running', 'purple');
	return `![](${uri})`;
}
function createStopServerLabel(): string {
    //return linkButton('Stop Server', 'command:cotab.server.stop', '#d83b01', '#ffffff');
	const uri = buildNetworkServerLabelSvgDataUri('Stop Server', 'red');
	return `[![](${uri})](command:cotab.server.stop)`;
}
function createStartServerLabel(): string {
    //return linkButton('Start Server', 'command:cotab.server.start', '#007acc', '#ffffff');
	const uri = buildNetworkServerLabelSvgDataUri('Start Local Server', 'blue');
	return `[![](${uri})](command:cotab.server.start)`;
}
function createInstallServerLabel(): string {
    //return linkButton('Install Server', 'command:cotab.server.install', '#2ea043', '#ffffff');
	const uri = buildNetworkServerLabelSvgDataUri('Install Server', 'green');
	return `[![](${uri})](command:cotab.server.install)`;
}

async function setGlobalEnabledCmd(enabled: boolean) {
    // Set config enabled
	await setConfigGlobalEnabled(enabled);
    
    // Notify extension that enable changed
    onChangedEnableExtension(enabled);

    statusBarManager.reset();

    requestUpdateCotabMenu();

    //const message = newValue ? 'Cotab has been enabled' : 'Cotab has been disabled';
    //vscode.window.showInformationMessage(message);
}

async function toggleGlobalEnabledCmd() {
    // Hide immediately for best click response
    await closeCotabMenu();
    
	await setGlobalEnabledCmd(!getConfig().enabled);
}

async function setExtensionEnabledCmd(extensionId: string, enabled: boolean) {
    // Set config enabled
	await setConfigExtensionEnabled(extensionId, enabled);

    statusBarManager.reset();

    requestUpdateCotabMenu();

    //const message = newValue ? 'Cotab has been enabled' : 'Cotab has been disabled';
    //vscode.window.showInformationMessage(message);
}

async function toggleExtensionEnabledCmd() {
    // Hide immediately for best click response
    await closeCotabMenu();
    
    const languageId: string = vscode.window.activeTextEditor?.document.languageId || '';
    if (languageId) {
        const enabled = getConfig().isExtensionEnabled(languageId);
        await setExtensionEnabledCmd(languageId, !enabled);
    }
}

async function installLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await closeCotabMenu();
    
    try {
        vscode.window.showInformationMessage('Installing Server (llama.cpp) ...');
        
        // Check if llama.cpp is already installed
        const isInstalled = await terminalCommand.isInstalledLocalLlamaServer();
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
        
    }
    catch (error) {
        vscode.window.showErrorMessage(`Server (llama.cpp) install failed: ${error}`);
    }
}

async function uninstallLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await closeCotabMenu();
    
    try {
        const isInstalled = await terminalCommand.isInstalledLocalLlamaServer();
        if (! isInstalled) {
            vscode.window.showInformationMessage('not installed Server (llama.cpp)');
            return;
        }
        const choice = await vscode.window.showInformationMessage(
            'Really uninstall the server (llama.cpp)?',
            'Yes', 'No'
        );
        if (choice !== 'Yes') {
            return;
        }
        vscode.window.showInformationMessage('Uninstalling Server (llama.cpp) ...');
        
        // Uninstall llama.cpp
        await terminalCommand.uninstallLocalLlamaCpp();

        vscode.window.showInformationMessage('Uninstalled Server (llama.cpp)');
    }
    catch (error) {
        vscode.window.showErrorMessage(`Server (llama.cpp) uninstall failed: ${error}`);
    }
}

async function startLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await closeCotabMenu();
    
    try {
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
        serverManager.startServer();

        vscode.window.showInformationMessage(`Start llama-server`);
    }
    catch (_) {
        
    }
}

async function stopLlamaServer(): Promise<void> {
    // Hide immediately for best click response
    await closeCotabMenu();
    
    // no await
    serverManager.stopServer(true);
    
    vscode.window.showInformationMessage('Stop llama-server');
}

async function isServerRunning(): Promise<boolean> {
    const client = getAiClient();
    return await client.isActive();
}

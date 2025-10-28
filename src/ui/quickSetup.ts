import * as vscode from 'vscode';
import { getConfig, setConfigHideOnSetup, setConfigShowProgressSpinner, setConfigApiBaseURL } from '../utils/config';
import { terminalCommand } from '../utils/terminalCommand';
import { getAiClient } from '../llm/llmProvider';
import { buildLinkButtonSvgDataUri, buildNetworkServerLabelSvgDataUri } from './menuUtil';

export function registerQuickSetup(disposables: vscode.Disposable[], context: vscode.ExtensionContext): void {
    disposables.push(vscode.commands.registerCommand('cotab.quickSetup.show', async () => {
        await showQuickSetup(context);
    }));

    // On setup, auto-show (only if hideOnSetup is off)
    const hide = getConfig().hideOnSetup;
    if (!hide) {
        // Delayed display (wait for initialization to complete after setup)
        setTimeout(() => { void showQuickSetup(context); }, 500);
    }
}

/**
 * Auto refresh manager for webview panels
 */
class AutoRefreshManager {
    private refreshTimer: NodeJS.Timeout | null = null;
    private isPanelActive = true;
    private readonly refreshInterval = 5000; // 5 seconds

    constructor(
        private panel: vscode.WebviewPanel,
        private getStateCallback: () => Promise<{ kind: 'stop' | 'network' | 'start' | 'install'; label: string; command?: string; }>
    ) {
        this.setupEventListeners();
        this.startAutoRefresh();
    }

    public async refresh() {
        if (this.isPanelActive) {
            const state = await this.getStateCallback();
            this.panel.webview.postMessage({ type: 'state', state });
        }
    }

    private setupEventListeners(): void {
        // Panel visibility change handler
        this.panel.onDidChangeViewState((e) => {
            this.isPanelActive = e.webviewPanel.visible;
            if (this.isPanelActive) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        });

        // Cleanup timer when panel is disposed
        this.panel.onDidDispose(() => {
            this.stopAutoRefresh();
        });
    }

    private startAutoRefresh(): void {
        this.stopAutoRefresh();
        if (this.isPanelActive) {
            this.refreshTimer = setInterval(async () => {
                await this.refresh();
            }, this.refreshInterval);
        }
    }

    private stopAutoRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    public dispose(): void {
        this.stopAutoRefresh();
    }
}

let autoRefreshManager: AutoRefreshManager | null = null;

async function getServerSectionState(): Promise<{ kind: 'stop' | 'network' | 'start' | 'install'; label: string; command?: string; }> {
    if (await terminalCommand.isRunningLocalLlamaServer()) {
        return { kind: 'stop', label: 'Local Server Running' };
    }
    else if (await isServerRunning()) {
        return { kind: 'network', label: 'Network Server Running' };
    } else if (await terminalCommand.isInstalledLocalLlamaServer()) {
        return { kind: 'start', label: 'Start Server', command: 'cotab.server.start' };
    } else {
        return { kind: 'install', label: 'Install Server', command: 'cotab.server.install' };
    }
}

async function isServerRunning(): Promise<boolean> {
    const client = getAiClient();
    return await client.isActive();
}

async function showQuickSetup(context: vscode.ExtensionContext): Promise<void> {
    // Create webview panel
    const panel = vscode.window.createWebviewPanel(
        'cotab.quickSetup',
        'Cotab Quick Setup',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Initialize auto refresh manager
    autoRefreshManager = new AutoRefreshManager(panel, getServerSectionState);

    // get state
    const config = getConfig();
    const apiBaseURL = config.apiBaseURL;
    const hideOnSetup = config.hideOnSetup;
    const showProgressSpinner = config.showProgressSpinner;
    const initial = await getServerSectionState();
    const iconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png'));
    const tutorial1Uri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'doc', 'asset', 'cotab-tutorial-autocomplete1.gif'));
    const spinnerAnalyzeUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'dot-spinner-0.svg')).toString();
    const spinnerRedUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'spinner-red-0.svg')).toString();
    const spinnerNormalUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'spinner-0.svg')).toString();

    // view contents
    panel.webview.html = getHtml({
        apiBaseURL,
        hideOnSetup,
        initial,
        iconUri,
        tutorial1Uri,
        spinnerAnalyzeUri,
        spinnerRedUri,
        spinnerNormalUri,
        showProgressSpinner
    });

    // Handle webview command
    panel.webview.onDidReceiveMessage(async (msg) => {
        await handleWebviewMessage(panel, msg);
    }, undefined, []);
}

/**
 * Handle messages from webview
 */
async function handleWebviewMessage(panel: vscode.WebviewPanel, msg: any): Promise<void> {
    if (msg?.type === 'saveApiBaseURL') {
        const value = String(msg.value || '').trim();
        await setConfigApiBaseURL(value);
        panel.webview.postMessage({ type: 'saved', key: 'apiBaseURL', value });
            // Refresh state after command execution
            setTimeout(async () => {
                autoRefreshManager?.refresh();
            }, 500);
    }
    else if (msg?.type === 'setHideOnSetup') {
        const value = Boolean(msg.value);
        await setConfigHideOnSetup(value);
        panel.webview.postMessage({ type: 'saved', key: 'hideOnSetup', value });
    }
    else if (msg?.type === 'setShowProgressSpinner') {
        const value = Boolean(msg.value);
        await setConfigShowProgressSpinner(value);
        panel.webview.postMessage({ type: 'saved', key: 'showProgressSpinner', value });
    }
    else if (msg?.type === 'executeCommand') {
        const command = String(msg.command || '');
        const args = Array.isArray(msg.args)
            ? msg.args
            : msg.args !== undefined
                ? [msg.args]
                : [];
        if (command) {
            await vscode.commands.executeCommand(command, ...args);
            // Refresh state after command execution
            setTimeout(async () => {
                autoRefreshManager?.refresh();
            }, 1000);
        }
    }
}

function getHtml(params: {
    apiBaseURL: string;
    hideOnSetup: boolean;
    initial: { kind: string; label: string; command?: string; };
    iconUri: vscode.Uri;
    tutorial1Uri: vscode.Uri;
    spinnerAnalyzeUri: string;
    spinnerRedUri: string;
    spinnerNormalUri: string;
    showProgressSpinner: boolean;
}): string {
    const nonce = String(Date.now());
    const apiBaseURL = escapeHtml(params.apiBaseURL || '');
    const hideOnSetup = params.hideOnSetup ? 'checked' : '';
    const showProgressSpinner = params.showProgressSpinner ? 'checked' : '';
    const initialState = JSON.stringify(params.initial);
    // Prepare shared SVG URIs for consistent UI
    const assetsJson = JSON.stringify({
        startBtn: buildNetworkServerLabelSvgDataUri('Start Local Server', 'blue'),
        stopBtn: buildNetworkServerLabelSvgDataUri('Local Server Running', 'red'),
        installBtn: buildNetworkServerLabelSvgDataUri('Install Local Server', 'green'),
        networkLbl: buildNetworkServerLabelSvgDataUri('Network Server Running', 'purple')
    });
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cotab Quick Setup</title>
    <style>
        body { font-family: -apple-system, Segoe UI, Ubuntu, Helvetica, Arial, sans-serif; padding: 16px; padding-bottom: 96px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        *, *::before, *::after { box-sizing: border-box; }
        h1 { font-size: 16px; margin: 0 0 12px; }
        label { display: block; margin-bottom: 6px; }
        input[type="text"] { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
        .row { display: flex; gap: 8px; align-items: center; }
        .grow { flex: 1; }
        button { padding: 6px 12px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-radius: 4px; cursor: pointer; }
        .muted { opacity: 0.8; }
        .checkbox { display: flex; align-items: center; gap: 8px; }
        .btnimg { display:inline-flex; }
        .btnimg img { display: block; }
        .center { text-align: center; }
        .section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin: 0 auto 12px;
            background: var(--vscode-editor-background);
            max-width: 600px;
            text-align: center;
            justify-content: center;
        }
        .started-section {
            display: flex;
            align-items: stretch;
            justify-content: center;
            gap: 24px;
            flex-wrap: wrap;
            padding: 24px;
            background: linear-gradient(135deg, rgba(83, 98, 148, 0.35) 0%, rgba(33, 38, 56, 0.2) 40%, rgba(21, 23, 34, 0.35) 100%);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            box-shadow: 0 16px 32px rgba(0, 0, 0, 0.22);
        }
        .started-section > h3 {
            flex-basis: 100%;
            width: 100%;
            margin: 0 0 12px;
            font-size: clamp(18px, 2.6vw, 22px);
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1.6px;
            text-align: center;
            color: rgba(255, 255, 255, 0.9);
        }
        .started-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            min-width: 140px;
            padding: 16px 18px;
            border-radius: 12px;
            background: rgba(15, 18, 28, 0.45);
            border: 1px solid rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(6px);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }
        .started-icon {
            width: 72px;
            height: 72px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
        }
        .started-spinner {
            display: block;
            width: 48px;
            height: 48px;
        }
        .started-label {
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.85);
        }
        .status-options {
            display: flex;
            justify-content: center;
            flex-basis: 100%;
            width: 100%;
        }
        .status-options .checkbox {
            margin: 0;
            font-size: 14px;
            font-weight: 500;
            letter-spacing: 0.4px;
            text-transform: none;
            color: rgba(255, 255, 255, 0.85);
        }
        .status-options input[type="checkbox"] {
            transform: scale(1);
        }
        .section.started-hero {
            width: min(960px, 100%);
            max-width: 960px;
            padding: clamp(24px, 4vw, 36px) clamp(20px, 5vw, 40px);
            background: linear-gradient(150deg, rgba(96, 110, 165, 0.45) 0%, rgba(42, 48, 74, 0.42) 35%, rgba(16, 19, 30, 0.55) 100%);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 28px 60px rgba(0, 0, 0, 0.32);
        }
        .started-section.started-hero {
            flex-direction: column;
            gap: 32px;
            padding: 0;
            background: none;
            border: none;
            box-shadow: none;
        }
        .started-hero-item {
            width: clamp(280px, 100%, 840px);
            margin: 0 auto;
            padding: clamp(20px, 3vw, 32px);
            border-radius: 18px;
            background: rgba(12, 16, 28, 0.55);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 22px 48px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(8px);
        }
        .started-hero-media {
            width: 100%;
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            box-shadow: 0 24px 52px rgba(0, 0, 0, 0.4);
        }
        .started-hero-media::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(0, 0, 0, 0) 35%, rgba(0, 0, 0, 0.12) 100%);
            pointer-events: none;
        }
        .started-hero-gif {
            display: block;
            width: 100%;
            height: auto;
        }
        .started-hero-label-group {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            margin-top: 20px;
        }
        .started-hero-label {
            display: block;
            font-size: clamp(16px, 2.2vw, 18px);
            font-weight: 600;
            letter-spacing: 1px;
            text-transform: none;
            color: rgba(255, 255, 255, 0.92);
        }
        @media (max-width: 520px) {
            .section.started-hero {
                padding: 20px;
                border-radius: 16px;
            }
            .started-hero-item {
                padding: 18px;
                border-radius: 14px;
            }
            .started-hero-media {
                border-radius: 12px;
            }
            .section.started-section {
                margin-left: auto;
                margin-right: auto;
            }
        }
        .section .center { text-align: center; justify-content: center; }
        .spacer { height: 8px; }
        .separator {
            flex: 1;
            height: 1px;
            margin-top: 16px;
            margin-bottom: 16px;
            background-color:
            currentColor;
            opacity: 0.35;
        }
        .server-section {
            display: flex;
            max-width: 600px;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            text-align: center;
            padding: 16px;
            border-radius: 10px;
            background: linear-gradient(140deg, rgba(56, 69, 90, 0.25) 0%, rgba(21, 25, 35, 0.15) 50%, rgba(56, 69, 90, 0.25) 100%);
            border: 1px solid rgba(255,255,255,0.04); box-shadow: 0 10px 24px rgba(0,0,0,0.18); max-width: 600px; margin-left: auto; margin-right: auto;
        }
        .floating-controls {
            position: fixed;
            bottom: 16px;
            right: 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 10px 12px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16);
            min-width: 180px;
        }
        .floating-controls .floating-label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
            font-size: 12px;
            letter-spacing: 0.1px;
            color: var(--vscode-foreground);
            opacity: 0.85;
        }
        .floating-controls input[type="checkbox"] {
            transform: scale(1);
        }
        .floating-controls .floating-divider {
            height: 1px;
            background: rgba(255, 255, 255, 0.08);
            border-radius: 1px;
        }
        .floating-controls .floating-settings-btn {
            background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 12px;
            letter-spacing: 0.2px;
            box-shadow: none;
            transition: background-color 120ms ease, transform 120ms ease;
        }
        .floating-controls .floating-settings-btn:hover {
            transform: translateY(-1px);
            background: var(--vscode-button-hoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background)));
        }
        .floating-controls .floating-settings-btn:active {
            transform: translateY(0);
        }
        .server-action { display: inline-flex; }
        .server-action img { display: block; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35)); }
        .server-or { display: flex; align-items: center; gap: 12px; width: 100%; font-size: 16px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
        .server-or-line { flex: 1; height: 1px; background-color: currentColor; opacity: 0.35; }
        .server-hint { font-size: 12px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
        /* Title alignment */
        .title-wrapper { display: flex; flex-direction: column; align-items: center; margin: 24px 0 16px; }
        .title-head { display: flex; align-items: center; justify-content: center; font-size: 40px; }
        .title-head::after { content: ''; display: block; width: 56px; height: 0; flex: 0 0 56px; }
        .title-head img { width: 56px; height: 56px; display: block; }
        .title-head .title-text { font-size: 48px; font-weight: bold; letter-spacing: 2px; }
        h2 { margin-top: 16px; margin-bottom: 16px; }
    </style>
    </head>
    <body>
        <div class="title-wrapper">
            <h1 class="title-head">
                <img src="${params.iconUri}" alt="Cotab" />
                <span class="title-text">Cotab</span>
            </h1>
        </div>
        <h2 class="center">Quick Setup</h2>
        <div class="server-section">
            <div class="spacer"></div>
            <div id="serverLabel" class="muted"></div>
            <a id="serverAction" class="btnimg server-action" style="display:none;" href="#" title="server action"></a>
            <div class="spacer"></div>
            <div class="server-or">
                <span class="server-or-line"></span>
                <span>OR</span>
                <span class="server-or-line"></span>
            </div>
            <div class="spacer"></div>
            <label for="apiBaseURL">OpenAI compatible Base URL</label>
            <div class="row">
                <input id="apiBaseURL" type="text" class="grow" value="${apiBaseURL}" placeholder="http://localhost:8080/v1" />
            </div>
            <div class="spacer"></div>
        </div>
        <div class="separator"></div>
        <h2 class="center">Getting started</h2>
        <div class="section started-section started-hero">
            <div class="started-hero-item">
                <div class="started-hero-media">
                    <img src="${params.tutorial1Uri}" class="started-hero-gif" alt="Cotabのチュートリアルフロー" />
                </div>
                <div class="started-hero-label-group">
                    <span class="started-hero-label">ACCEPT : TAB</span>
                    <span class="started-hero-label">ACCEPT (Only First Line) : SHIFT + TAB</span>
                </div>
            </div>
        </div>
        <div class="separator"></div>
        <h2 class="center">Status</h2>
        <div class="section started-section">
            <div class="started-item">
                <div class="started-icon">
                    <img src="${params.spinnerAnalyzeUri}" class="started-spinner" />
                </div>
                <span class="started-label">Analyzing</span>
            </div>
            <div class="started-item">
                <div class="started-icon">
                    <img src="${params.spinnerRedUri}" class="started-spinner" />
                </div>
                <span class="started-label">Completing<br>current line</span>
            </div>
            <div class="started-item">
                <div class="started-icon">
                    <img src="${params.spinnerNormalUri}" class="started-spinner"/>
                </div>
                <span class="started-label">Completing<br>after current line</span>
            </div>
            <div class="status-options">
                <label class="checkbox"><input id="showProgressSpinner" type="checkbox" ${showProgressSpinner}/>Show progress spinner</label>
            </div>
        </div>
        <div class="floating-controls">
            <label class="checkbox floating-label"><input id="hideNext" type="checkbox" ${hideOnSetup}/>Don't show this again</label>
            <div class="floating-divider"></div>
            <button id="openSettingsBtn" class="floating-settings-btn" type="button" title="Open Cotab Settings">Open Settings</button>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let state = ${initialState};
            const serverLabel = document.getElementById('serverLabel');
            const serverAction = document.getElementById('serverAction');
            const apiBaseURLInput = document.getElementById('apiBaseURL');
            const hideNext = document.getElementById('hideNext');
            const showProgressSpinnerCheckbox = document.getElementById('showProgressSpinner');
            const openSettingsBtn = document.getElementById('openSettingsBtn');
            const assets = ${assetsJson};
            console.log('[cotab] quickSetup assets loaded', assets);

            function setImage(container, uri, alt) {
                container.innerHTML = '';
                const img = document.createElement('img');
                img.alt = alt;
                img.src = uri;
                img.style.display = 'block';
                img.style.maxWidth = '320px';
                img.addEventListener('error', () => {
                    container.textContent = alt;
                });
                container.appendChild(img);
            }

            function render() {
                serverLabel.innerHTML = '';
                serverAction.innerHTML = '';
                serverAction.dataset.cmd = '';

                console.log('[cotab] quickSetup render state', state);
                if (state?.kind === 'network') {
                    setImage(serverLabel, assets.networkLbl, 'Network Server Running');
                    serverAction.style.display = 'none';
                } else if (state?.kind === 'start' && state?.command) {
                    serverAction.style.display = '';
                    serverLabel.textContent = '';
                    setImage(serverAction, assets.startBtn, 'Start Server');
                    serverAction.dataset.cmd = state.command;
                } else if (state?.kind === 'stop') {
                    setImage(serverLabel, assets.stopBtn, 'Local Server Running');
                    serverAction.style.display = 'none';
                } else if (state?.kind === 'install' && state?.command) {
                    serverAction.style.display = '';
                    serverLabel.textContent = '';
                    setImage(serverAction, assets.installBtn, 'Install Server');
                    serverAction.dataset.cmd = state.command;
                } else {
                    serverLabel.textContent = '';
                    serverAction.style.display = 'none';
                }
            }

            render();

            window.addEventListener('message', (event) => {
                const msg = event.data || {};
                if (msg.type === 'state' && msg.state) {
                    state = msg.state;
                    render();
                }
            });

            let saveTimer = null;
            apiBaseURLInput.addEventListener('input', () => {
                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(() => {
                    const value = String(apiBaseURLInput.value || '').trim();
                    vscode.postMessage({ type: 'saveApiBaseURL', value });
                }, 400);
            });

            hideNext.addEventListener('change', () => {
                vscode.postMessage({ type: 'setHideOnSetup', value: hideNext.checked });
            });

            if (showProgressSpinnerCheckbox instanceof HTMLInputElement) {
                showProgressSpinnerCheckbox.addEventListener('change', () => {
                    vscode.postMessage({ type: 'setShowProgressSpinner', value: showProgressSpinnerCheckbox.checked });
                });
            }

            if (openSettingsBtn) {
                openSettingsBtn.addEventListener('click', () => {
                    vscode.postMessage({ type: 'executeCommand', command: 'workbench.action.openSettings', args: ['>cotab'] });
                });
            }

            serverAction.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = serverAction.dataset.cmd;
                if (cmd) {
                    vscode.postMessage({ type: 'executeCommand', command: cmd });
                }
            });
        </script>
    </body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}



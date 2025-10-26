import * as vscode from 'vscode';
import { getConfig, setConfigHideOnStartup } from '../utils/config';
import { setConfigApiBaseURL } from '../utils/config';
import { terminalCommand } from '../utils/terminalCommand';
import { getAiClient } from '../llm/llmProvider';
import { buildLinkButtonSvgDataUri, buildNetworkServerLabelSvgDataUri } from './menuUtil';

export function registerQuickStartup(disposables: vscode.Disposable[], context: vscode.ExtensionContext): void {
    disposables.push(vscode.commands.registerCommand('cotab.quickStartup.show', async () => {
        await showQuickStartup(context);
    }));

    // On startup, auto-show (only if hideOnStartup is off)
    const hide = getConfig().hideOnStartup;
    if (!hide) {
        // Delayed display (wait for initialization to complete after startup)
        setTimeout(() => { void showQuickStartup(context); }, 500);
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

async function showQuickStartup(context: vscode.ExtensionContext): Promise<void> {
    // Create webview panel
    const panel = vscode.window.createWebviewPanel(
        'cotab.quickStartup',
        'Cotab Quick Startup',
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
    const hideOnStartup = config.hideOnStartup;
    const initial = await getServerSectionState();
    const iconUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png'));

    // view contents
    panel.webview.html = getHtml({ apiBaseURL, hideOnStartup, initial, iconUri });

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
    else if (msg?.type === 'setHideOnStartup') {
        const value = Boolean(msg.value);
        await setConfigHideOnStartup(value);
        panel.webview.postMessage({ type: 'saved', key: 'hideOnStartup', value });
    }
    else if (msg?.type === 'executeCommand') {
        const command = String(msg.command || '');
        if (command) {
            await vscode.commands.executeCommand(command);
            // Refresh state after command execution
            setTimeout(async () => {
                autoRefreshManager?.refresh();
            }, 1000);
        }
    }
}

function getHtml(params: { apiBaseURL: string; hideOnStartup: boolean; initial: { kind: string; label: string; command?: string; }; iconUri: vscode.Uri }): string {
    const nonce = String(Date.now());
    const apiBaseURL = escapeHtml(params.apiBaseURL || '');
    const hideOnStartup = params.hideOnStartup ? 'checked' : '';
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
    <title>Cotab Quick Startup</title>
    <style>
        body { font-family: -apple-system, Segoe UI, Ubuntu, Helvetica, Arial, sans-serif; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
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
        .section .center { text-align: center; justify-content: center; }
        .spacer { height: 8px; }
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
        <h2 class="center">Quick Startup</h2>
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
        <div class="spacer"></div>
        <div class="section">
            <label class="checkbox center"><input id="hideNext" type="checkbox" ${hideOnStartup}/> 次回からは表示しない</label>
        </div>
        <h2 class="center">Tutorial</h2>
        <div class="section">
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let state = ${initialState};
            const serverLabel = document.getElementById('serverLabel');
            const serverAction = document.getElementById('serverAction');
            const apiBaseURLInput = document.getElementById('apiBaseURL');
            const hideNext = document.getElementById('hideNext');
            const assets = ${assetsJson};
            console.log('[cotab] quickStartup assets loaded', assets);

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

                console.log('[cotab] quickStartup render state', state);
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
                vscode.postMessage({ type: 'setHideOnStartup', value: hideNext.checked });
            });

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



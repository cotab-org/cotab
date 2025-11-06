import * as vscode from 'vscode';
import { getConfig, setConfigHideOnSetup, setConfigShowProgressSpinner, setConfigApiBaseURL, setConfigCommentLanguage, setConfigLocalServerContextSize } from '../utils/config';
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
        return { kind: 'stop', label: 'Stop Server', command: 'cotab.server.stop' };
    }
    else if (await isServerRunning()) {
        return { kind: 'network', label: 'Network Server Running' };
    }
    else if (await terminalCommand.isInstalledLocalLlamaServer()) {
        return { kind: 'start', label: 'Start Server', command: 'cotab.server.start' };
    }
    else {
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

    // view contents
    panel.webview.html = getHtml({
        apiBaseURL: config.apiBaseURL,
        hideOnSetup: config.hideOnSetup,
        initial: await getServerSectionState(),
        iconUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png')),
        tutorial1Uri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'doc', 'asset', 'cotab-tutorial-autocomplete1.gif')),
        tutorial2Uri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'doc', 'asset', 'cotab-tutorial-open-quick-setup.gif')),
        spinnerAnalyzeUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'dot-spinner-0.svg')).toString(),
        spinnerRedUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'spinner-red-0.svg')).toString(),
        spinnerNormalUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'spinner-0.svg')).toString(),
        showProgressSpinner: config.showProgressSpinner,
        settingCommentLanguage: config.settingCommentLanguage,
        defaultCommentLanguage: config.defaultCommentLanguage,
        localServerContextSize: config.localServerContextSize
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
    else if (msg?.type === 'saveCommentLanguage') {
        const value = String(msg.value || '').trim();
        await setConfigCommentLanguage(value);
        panel.webview.postMessage({ type: 'saved', key: 'commentLanguage', value });
    }
    else if (msg?.type === 'saveLocalServerContextSize') {
        const rawValue = Number(msg.value);
        const value = Number.isFinite(rawValue) ? rawValue : 32768;
        
        await setConfigLocalServerContextSize(value);
        panel.webview.postMessage({ type: 'saved', key: 'localServerContextSize', value });
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
    tutorial2Uri: vscode.Uri;
    spinnerAnalyzeUri: string;
    spinnerRedUri: string;
    spinnerNormalUri: string;
    showProgressSpinner: boolean;
    settingCommentLanguage: string;
    defaultCommentLanguage: string;
    localServerContextSize: number;
}): string {
    const nonce = String(Date.now());
    const apiBaseURL = escapeHtml(params.apiBaseURL || '');
    const hideOnSetup = params.hideOnSetup ? 'checked' : '';
    const showProgressSpinner = params.showProgressSpinner ? 'checked' : '';
    const commentLanguage = escapeHtml(params.settingCommentLanguage || '');
    const defaultCommentLanguage = escapeHtml(params.defaultCommentLanguage || '');
    const localServerContextSize = Number.isFinite(params.localServerContextSize) ? params.localServerContextSize : 32768;
    const initialState = JSON.stringify(params.initial);
    // Prepare shared SVG URIs for consistent UI
    const assetsJson = JSON.stringify({
        startBtn: buildNetworkServerLabelSvgDataUri('Start Local Server', 'blue'),
        stopBtn: buildNetworkServerLabelSvgDataUri('Stop Local Server', 'red'),
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
        input[type="text"],
        input[type="number"] { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
        input[type="number"] { -moz-appearance: textfield; }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="range"] { flex: 1; cursor: pointer; }
        .row { display: flex; gap: 8px; align-items: center; }
        .grow { flex: 1; }
        .context-size-input { width: 64px !important; min-width: 64px; text-align: left; }
        button { padding: 6px 12px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-radius: 4px; cursor: pointer; }
        .muted { opacity: 0.8; }
        .helper-text { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 6px; text-align: left; }
        .checkbox { display: flex; align-items: center; gap: 8px; }
        .center { text-align: center; }
        .setup-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin: 0 auto 12px;
            background: var(--vscode-editor-background);
            max-width: 600px;
            text-align: center;
            justify-content: center;
        }
        .setup-card--status {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            text-align: center;
            padding: 16px;
            border-radius: 10px;
            background: linear-gradient(140deg, rgba(56, 69, 90, 0.25) 0%, rgba(21, 25, 35, 0.15) 50%, rgba(56, 69, 90, 0.25) 100%);
            border: 1px solid rgba(255, 255, 255, 0.04);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
            max-width: 600px;
        }
        .setup-card--spinners {
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
        .setup-card--hero {
            width: min(960px, 100%);
            max-width: 960px;
            padding: clamp(24px, 4vw, 36px) clamp(20px, 5vw, 40px);
            background: linear-gradient(150deg, rgba(96, 110, 165, 0.45) 0%, rgba(42, 48, 74, 0.42) 35%, rgba(16, 19, 30, 0.55) 100%);
            border-radius: 20px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 28px 60px rgba(0, 0, 0, 0.32);
            display: flex;
            flex-direction: column;
            gap: 32px;
        }
        .setup-card__content-block {
            width: clamp(280px, 100%, 840px);
            margin: 0 auto;
            padding: clamp(20px, 3vw, 32px);
            border-radius: 18px;
            background: rgba(12, 16, 28, 0.55);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: 0 22px 48px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(8px);
        }
        .setup-card__media {
            width: 100%;
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            box-shadow: 0 24px 52px rgba(0, 0, 0, 0.4);
        }
        .setup-card__media::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(0, 0, 0, 0) 35%, rgba(0, 0, 0, 0.12) 100%);
            pointer-events: none;
        }
        .setup-card__media-image {
            display: block;
            width: 100%;
            height: auto;
        }
        .setup-card__caption-group {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            margin-top: 20px;
        }
        .setup-card__caption {
            display: block;
            font-size: clamp(16px, 2.2vw, 18px);
            font-weight: 600;
            letter-spacing: 1px;
            text-transform: none;
            color: rgba(255, 255, 255, 0.92);
        }
        .setup-checkbox {
            display: flex;
            align-items: center;
            gap: 16px;
            margin: 0;
            font-size: clamp(16px, 2.2vw, 18px);
            font-weight: 600;
            letter-spacing: 0.8px;
            text-transform: none;
            color: rgba(255, 255, 255, 0.92);
        }
        .setup-checkbox input[type="checkbox"] {
            transform: scale(1.1);
        }
        .setup-checkbox__label {
            display: block;
            font-size: inherit;
            font-weight: inherit;
            letter-spacing: inherit;
            color: inherit;
        }
        .spinner-card {
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
        .spinner-card__icon {
            width: 72px;
            height: 72px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
        }
        .spinner-card__image {
            display: block;
            width: 48px;
            height: 48px;
        }
        .spinner-card__label {
            font-size: 14px;
            font-weight: 600;
            letter-spacing: 0.6px;
            text-transform: uppercase;
            color: rgba(255, 255, 255, 0.85);
            text-align: center;
        }
        @media (max-width: 520px) {
            .setup-card--hero {
                padding: 20px;
                border-radius: 16px;
            }
            .setup-card__content-block {
                padding: 18px;
                border-radius: 14px;
            }
            .setup-card__media {
                border-radius: 12px;
            }
            .setup-card--spinners {
                margin-left: auto;
                margin-right: auto;
            }
        }
        .spacer { height: 8px; }
        .separator {
            flex: 1;
            height: 1px;
            margin-top: 16px;
            margin-bottom: 16px;
            background-color: currentColor;
            opacity: 0.35;
        }
        .status-divider {
            display: flex;
            align-items: center;
            gap: 12px;
            width: 100%;
            font-size: 16px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
        }
        .status-divider__line {
            flex: 1;
            height: 1px;
            background-color: currentColor;
            opacity: 0.35;
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
        .server-action-link { display: inline-flex; }
        .server-action-link img { display: block; filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.35)); }
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
        <section class="setup-card setup-card--status">
            <div class="spacer"></div>
            <div id="serverStatus" class="muted"></div>
            <a id="serverActionButton" class="server-action-link" style="display:none;" href="#" title="server action"></a>
            <div id="context-size-container" title="Required:&#10; - set 16k (16384) or more.&#10;&#10;Recommended:&#10; - set 32k (32768) or more.&#10;&#10;Reason:&#10; - The system prompt uses about 5k, and 1,000 lines of code use about 12k more.&#10; - so please set the context window to 20k (20480) or more.&#10;&#10;The default model (qwen3-4b-2507) VRAM usage:&#10; - 16k: about 4 GB&#10; - 32k: about 5.5 GB">
                <div class="spacer"></div>
                <div class="row">
                    <label for="localServerContextSlider">Context Size</label>
                    <input id="localServerContextSlider" type="range" class="range-input" min="8192" max="131072" step="4096" value="${localServerContextSize}" />
                    <input id="localServerContextInput" type="number" class="context-size-input" inputmode="numeric" value="${localServerContextSize}" />
                </div>
            </div>
            <div class="spacer"></div>
            <div class="status-divider">
                <span class="status-divider__line"></span>
                <span>OR</span>
                <span class="status-divider__line"></span>
            </div>
            <div class="spacer"></div>
            <label for="apiBaseURL">OpenAI compatible Base URL</label>
            <div class="row">
                <input id="apiBaseURL" type="text" class="grow" value="${apiBaseURL}" placeholder="http://localhost:8080/v1" />
            </div>
            <div class="spacer"></div>
        </section>
        <section class="setup-card setup-card--status">
            <div class="spacer"></div>
            <label for="commentLanguage">Comment Language</label>
            <div class="row">
                <input id="commentLanguage" type="text" class="grow" value="${commentLanguage}" placeholder="${defaultCommentLanguage}" />
            </div>
            <div class="helper-text">(e.g. 'English', '日本語', '简体中文', 'Français')</div>
            <div class="spacer"></div>
        </section>
        <div class="separator"></div>
        <h2 class="center">Getting started</h2>
        <section class="setup-card setup-card--hero">
            <div class="setup-card__content-block">
                <div class="setup-card__media">
                    <img src="${params.tutorial1Uri}" class="setup-card__media-image" alt="Cotab Tutorial" />
                </div>
                <div class="setup-card__caption-group">
                    <span class="setup-card__caption">ACCEPT : TAB</span>
                    <span class="setup-card__caption">ACCEPT (Only First Line) : SHIFT + TAB</span>
                </div>
            </div>
        </section>
        <div class="separator"></div>
        <h2 class="center">Progress Icon</h2>
        <section class="setup-card setup-card--spinners">
            <div class="spinner-card">
                <div class="spinner-card__icon">
                    <img src="${params.spinnerAnalyzeUri}" class="spinner-card__image" alt="Analyzing" />
                </div>
                <span class="spinner-card__label">Analyzing</span>
            </div>
            <div class="spinner-card">
                <div class="spinner-card__icon">
                    <img src="${params.spinnerRedUri}" class="spinner-card__image" alt="Completing current line" />
                </div>
                <span class="spinner-card__label">Completing<br>current line</span>
            </div>
            <div class="spinner-card">
                <div class="spinner-card__icon">
                    <img src="${params.spinnerNormalUri}" class="spinner-card__image" alt="Completing after current line" />
                </div>
                <span class="spinner-card__label">Completing<br>after current line</span>
            </div>
            <div class="setup-card__caption-group">
                <label class="setup-checkbox">
                    <input id="showProgressSpinner" type="checkbox" ${showProgressSpinner}/>
                    <span class="setup-checkbox__label">Show progress icon</span>
                </label>
            </div>
        </section>
        <div class="separator"></div>
        <h2 class="center">Show This Page Again</h2>
        <section class="setup-card setup-card--hero">
            <div class="setup-card__content-block">
                <div class="setup-card__media">
                    <img src="${params.tutorial2Uri}" class="setup-card__media-image" alt="Show progress spinner preview" />
                </div>
                <div class="setup-card__caption-group">
                    <span class="setup-card__caption">Hover over the status bar. Don't click!</span>
                    <label class="setup-checkbox">
                        <input id="hideNextInline" type="checkbox" ${hideOnSetup}/>
                        <span class="setup-checkbox__label">Don't show this again</span>
                    </label>
                </div>
            </div>
        </section>
        <div class="floating-controls">
            <label class="checkbox floating-label"><input id="hideNext" type="checkbox" ${hideOnSetup}/>Don't show this again</label>
            <div class="floating-divider"></div>
            <button id="openSettingsBtn" class="floating-settings-btn" type="button" title="Open Cotab Settings">Open Settings</button>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let state = ${initialState};
            const serverStatusContainer = document.getElementById('serverStatus');
            const serverActionLink = document.getElementById('serverActionButton');
            const apiBaseURLInput = document.getElementById('apiBaseURL');
            const commentLanguageInput = document.getElementById('commentLanguage');
            const localServerContextSlider = document.getElementById('localServerContextSlider');
            const localServerContextInput = document.getElementById('localServerContextInput');
            const hideNext = document.getElementById('hideNext');
            const hideNextInline = document.getElementById('hideNextInline');
            const showProgressSpinnerCheckbox = document.getElementById('showProgressSpinner');
            const openSettingsBtn = document.getElementById('openSettingsBtn');
            const assets = ${assetsJson};
            console.log('[cotab] quickSetup assets loaded', assets);

            function renderSvgImage(container, uri, alt) {
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

            function renderServerState() {
                if (!serverStatusContainer || !serverActionLink) {
                    return;
                }

                serverStatusContainer.innerHTML = '';
                serverActionLink.innerHTML = '';
                delete serverActionLink.dataset.command;

                console.log('[cotab] quickSetup render state', state);
                if (state?.kind === 'network') {
                    renderSvgImage(serverStatusContainer, assets.networkLbl, 'Network Server Running');
                    serverActionLink.style.display = 'none';
                    document.getElementById('context-size-container').style.display = 'none';
                } else if (state?.kind === 'start' && state?.command) {
                    serverActionLink.style.display = '';
                    serverStatusContainer.textContent = '';
                    renderSvgImage(serverActionLink, assets.startBtn, 'Start Server');
                    serverActionLink.dataset.command = state.command;
                    document.getElementById('context-size-container').style.display = 'block';
                } else if (state?.kind === 'stop') {
                    serverActionLink.style.display = '';
                    serverStatusContainer.textContent = '';
                    renderSvgImage(serverActionLink, assets.stopBtn, 'Stop Server');
                    serverActionLink.dataset.command = state.command;
                    document.getElementById('context-size-container').style.display = 'block';
                } else if (state?.kind === 'install' && state?.command) {
                    serverActionLink.style.display = '';
                    serverStatusContainer.textContent = '';
                    renderSvgImage(serverActionLink, assets.installBtn, 'Install Server');
                    serverActionLink.dataset.command = state.command;
                    document.getElementById('context-size-container').style.display = 'block';
                } else {
                    serverStatusContainer.textContent = '';
                    serverActionLink.style.display = 'none';
                    document.getElementById('context-size-container').style.display = 'block';
                }
            }

            renderServerState();

            window.addEventListener('message', (event) => {
                const msg = event.data || {};
                if (msg.type === 'state' && msg.state) {
                    state = msg.state;
                    renderServerState();
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

            let commentLanguageSaveTimer = null;
            if (commentLanguageInput instanceof HTMLInputElement) {
                commentLanguageInput.addEventListener('input', () => {
                    if (commentLanguageSaveTimer) clearTimeout(commentLanguageSaveTimer);
                    commentLanguageSaveTimer = setTimeout(() => {
                        const value = String(commentLanguageInput.value || '').trim();
                        vscode.postMessage({ type: 'saveCommentLanguage', value });
                    }, 400);
                });
            }

            let localServerContextSaveTimer = null;

            function normalizeLocalServerContextSize(value) {
                return Number.isFinite(value) ? value : 32768;
            }

            function syncLocalServerContextSize(value, options = {}) {
                const { updateSlider = true, updateInput = true } = options;
                if (updateSlider && localServerContextSlider instanceof HTMLInputElement) {
                    localServerContextSlider.value = String(value);
                }
                if (updateInput && localServerContextInput instanceof HTMLInputElement) {
                    localServerContextInput.value = String(value);
                }
            }

            if (localServerContextSlider instanceof HTMLInputElement && localServerContextInput instanceof HTMLInputElement) {
                let currentLocalServerContextSize = normalizeLocalServerContextSize(Number(localServerContextSlider.value)) ?? 32768;
                syncLocalServerContextSize(currentLocalServerContextSize);

                const scheduleLocalServerContextSave = (value) => {
                    if (localServerContextSaveTimer) clearTimeout(localServerContextSaveTimer);
                    localServerContextSaveTimer = setTimeout(() => {
                        vscode.postMessage({ type: 'saveLocalServerContextSize', value });
                    }, 300);
                };

                localServerContextSlider.addEventListener('input', () => {
                    const normalized = normalizeLocalServerContextSize(Number(localServerContextSlider.value));
                    if (normalized === null) {
                        return;
                    }
                    currentLocalServerContextSize = normalized;
                    syncLocalServerContextSize(normalized, { updateSlider: false });
                    scheduleLocalServerContextSave(normalized);
                });

                const commitLocalServerContextInput = () => {
                    if (!(localServerContextInput instanceof HTMLInputElement)) {
                        return;
                    }
                    if (localServerContextInput.value === '') {
                        localServerContextInput.value = String(currentLocalServerContextSize);
                        return;
                    }
                    const normalized = normalizeLocalServerContextSize(Number(localServerContextInput.value));
                    if (normalized === null) {
                        localServerContextInput.value = String(currentLocalServerContextSize);
                        return;
                    }
                    currentLocalServerContextSize = normalized;
                    syncLocalServerContextSize(normalized, { updateInput: false });
                    scheduleLocalServerContextSave(normalized);
                };

                localServerContextInput.addEventListener('change', commitLocalServerContextInput);
                localServerContextInput.addEventListener('blur', commitLocalServerContextInput);
                localServerContextInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        commitLocalServerContextInput();
                    }
                });
                localServerContextInput.addEventListener('input', () => {
                    if (localServerContextInput.value === '') {
                        return;
                    }
                    const normalized = normalizeLocalServerContextSize(Number(localServerContextInput.value));
                    if (normalized === null) {
                        return;
                    }
                    currentLocalServerContextSize = normalized;
                    syncLocalServerContextSize(normalized, { updateInput: false });
                });
            }

            function syncHideOnSetupCheckboxes(value) {
                if (hideNext instanceof HTMLInputElement) {
                    hideNext.checked = value;
                }
                if (hideNextInline instanceof HTMLInputElement) {
                    hideNextInline.checked = value;
                }
            }

            function handleHideOnSetupChange(event) {
                const target = event.currentTarget;
                if (!(target instanceof HTMLInputElement)) {
                    return;
                }
                const value = target.checked;
                syncHideOnSetupCheckboxes(value);
                vscode.postMessage({ type: 'setHideOnSetup', value });
            }

            if (hideNext instanceof HTMLInputElement) {
                hideNext.addEventListener('change', handleHideOnSetupChange);
            }

            if (hideNextInline instanceof HTMLInputElement) {
                hideNextInline.addEventListener('change', handleHideOnSetupChange);
            }

            const initialHideValue = hideNext instanceof HTMLInputElement
                ? hideNext.checked
                : hideNextInline instanceof HTMLInputElement
                    ? hideNextInline.checked
                    : false;
            syncHideOnSetupCheckboxes(Boolean(initialHideValue));

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

            if (serverActionLink) {
                serverActionLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    const commandId = serverActionLink.dataset.command;
                    if (commandId) {
                        vscode.postMessage({ type: 'executeCommand', command: commandId });
                    }
                });
            }
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



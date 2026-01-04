import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as path from 'path';
import { getConfig, setConfigHideOnStartup, setConfigShowProgressSpinner, setConfigApiBaseURL, setConfigApiKey, setConfigCommentLanguage, setConfigLocalServerContextSize, setConfigModel, setConfigLocalServerPreset, setConfigLocalServerCustom, setConfigShowAllPresets, setConfigShowOnSuggestConflict, isConfigShowOnSuggestConflict } from '../utils/config';
import { terminalCommand } from '../utils/terminalCommand';
import { getAiClient } from '../llm/llmProvider';
import { getOsInfo } from '../utils/cotabUtil';
import { buildNetworkServerLabelSvgDataUri } from './menuUtil';
import { localServerPresetArgs, LOCAL_SERVER_PRESETS, isLocalServerPreset, LocalServerPreset, localServerPresetVisibility } from '../utils/localServerPresets';

// Configure nls and load message bundle
// NOTE:
// When bundled by webpack, vscode-nls can't always infer the caller file path.
// Provide a stable, synthetic path so it can resolve messages from nls.metadata/header + nls.bundle.*.json.
//
// IMPORTANT (VS Code language pack mode):
// When VS Code runs with language packs, vscode-nls may prefer external extension translations (downloaded via Marketplace).
// If they are missing, it can fall back to the default (English) instead of using in-the-box `nls.bundle.<locale>.json`.
// Force "standalone" bundle usage so our packaged `nls.bundle.ja.json` is used.
const localize = nls.config({ bundleFormat: nls.BundleFormat.standalone })(path.join(__dirname, 'ui/gettingStartedView'));

const LOCAL_SERVER_PRESET_TOOLTIPS: Record<LocalServerPreset, string> = LOCAL_SERVER_PRESETS.reduce((acc, preset) => {
    acc[preset] = localServerPresetArgs[preset] ?? '';
    return acc;
}, {} as Record<LocalServerPreset, string>);

export function registerGettingStartedView(
    disposables: vscode.Disposable[],
    context: vscode.ExtensionContext,
    _prevVersion: string | undefined, 
    _currentVersion: string): void {
    disposables.push(vscode.commands.registerCommand('cotab.gettingStarted.show', async () => {
        await showGettingStartedView(context);
    }));

    // On setup, auto-show (only if hideOnStartup is off)
    const show = ! getConfig().hideOnStartup;
    //const additionalHtmlPromise = GetNewVersionNotice(prevVersion, currentVersion);
    if (show) {
        // Delayed display (wait for initialization to complete after setup)
        setTimeout(() => { void showGettingStartedView(context); }, 500);
    }
}
/*
async function GetNewVersionNotice(prevVersion: string | undefined, currentVersion: string): Promise<string> {
    let additionalHtml = '';
    if (prevVersion !== '' && prevVersion !== '0') {
        if (getConfig().llamaCppVersion === 'Stable') {
            // Check if llama.cpp is installed
            const installedVersion = await terminalCommand.getInstalledLocalLlamaCppVersion();
            if (installedVersion !== '' && `b${installedVersion}` !== StablellamaCppVersion) {
                additionalHtml = `
    <style>
        .reinstall-warning {
            background: linear-gradient(135deg, var(--vscode-textBlockQuote-background) 0%, var(--vscode-textBlockQuote-background) 100%);
            border: 2px solid var(--vscode-textLink-foreground);
            border-radius: 12px;
            padding: 30px;
            margin: 30px 0;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .warning-title {
            font-size: 24px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin: 0 0 15px 0;
            border: none;
            padding: 0;
        }
        .warning-message {
            font-size: 16px;
            margin: 0 0 25px 0;
            line-height: 1.6;
        }
        .install-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            background: linear-gradient(135deg, var(--vscode-button-background) 0%, var(--vscode-button-hoverBackground) 100%);
            color: var(--vscode-button-foreground);
            border: 2px solid var(--vscode-button-border);
            border-radius: 8px;
            padding: 16px 32px;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            text-decoration: none;
        }
        .install-button:hover {
            background: linear-gradient(135deg, var(--vscode-button-hoverBackground) 0%, var(--vscode-button-background) 100%);
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }
        .install-button:active {
            transform: translateY(0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .button-icon {
            font-size: 24px;
        }
        .button-text {
            font-size: 18px;
        }
    </style>
                    <div class="reinstall-warning">
                        <h2 class="warning-title">${localize('gettingStarted.reinstallWarning.title', '⚠️ Please Reinstall the Server !')}</h2>
                        <p class="warning-message">
                            ${localize('gettingStarted.reinstallWarning.message', 'The latest version of Server (llama.cpp) has a performance issue and the completion speed is significantly reduced. <br>\nPlease reinstall to get better performance. <br>\nCurrent version: "{0}". Stable version: "{1}"', `b${installedVersion}`, StablellamaCppVersion)}
                        </p>
                        <button class="install-button" onclick="executeCommand('cotab.server.install')">
                            <span class="button-icon">🔧</span>
                            <span class="button-text">${localize('gettingStarted.reinstallWarning.button', 'Click to Reinstall Server')}</span>
                        </button>
                    </div>
                `;
            }
        }
    }
    return additionalHtml;
}
*/

/**
 * Auto refresh manager for webview panels
 */
class AutoRefreshManager {
    private refreshTimer: NodeJS.Timeout | null = null;
    private isPanelActive = true;
    private readonly refreshInterval = 5000; // 5 seconds

    constructor(
        private panel: vscode.WebviewPanel,
        private getStateCallback: () => Promise<{ kind: 'stop' | 'network' | 'start' | 'install' | 'unsupported'; label: string; command?: string; }>
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

async function getServerSectionState(): Promise<{ kind: 'stop' | 'network' | 'start' | 'install' | 'unsupported'; label: string; command?: string; }> {
    if (await terminalCommand.isRunningLocalLlamaServer()) {
        return { kind: 'stop', label: localize('gettingStarted.server.stop', 'Stop Server'), command: 'cotab.server.stop' };
    }
    else if (await isServerRunning()) {
        return { kind: 'network', label: localize('gettingStarted.server.network', 'Network Server Running') };
    }
    else if (await terminalCommand.isInstalledLocalLlamaServer()) {
        return { kind: 'start', label: localize('gettingStarted.server.start', 'Start Server'), command: 'cotab.server.start' };
    }
    else if (! (terminalCommand.isSupportMyInstall(await getOsInfo()))) {
        return { kind: 'unsupported', label: localize('gettingStarted.server.unsupported', 'Install Not Supported') };
    }
    else {
        return { kind: 'install', label: localize('gettingStarted.server.install', 'Install Server'), command: 'cotab.server.install' };
    }
}

async function isServerRunning(): Promise<boolean> {
    const client = getAiClient();
    return await client.isActive();
}

async function showGettingStartedView(context: vscode.ExtensionContext): Promise<void> {
    // Create webview panel
    const panel = vscode.window.createWebviewPanel(
        'cotab.gettingStarted',
        localize('gettingStarted.title', 'Cotab Getting Started'),
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
        apiBaseURL: config.settingApiBaseURL,
        apiKey: config.apiKey,
        model: config.model,
        hideOnStartup: config.hideOnStartup,
        initial: await getServerSectionState(),
        iconUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png')),
        tutorialAutocompleteUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'doc', 'asset', 'cotab-tutorial-autocomplete1.gif')),
        tutorialOpenGettingStartedUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'doc', 'asset', 'cotab-tutorial-open-getting-started.gif')),
        spinnerAnalyzeUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'dot-spinner-0.svg')).toString(),
        spinnerRedUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'spinner-red-0.svg')).toString(),
        spinnerNormalUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'spinner-0.svg')).toString(),
        showProgressSpinner: config.showProgressSpinner,
        settingCommentLanguage: config.settingCommentLanguage,
        defaultCommentLanguage: config.defaultCommentLanguage,
        localServerContextSize: config.localServerContextSize,
        localServerPreset: config.localServerPreset,
        localServerCustom: config.localServerCustom,
        showAllPresets: config.showAllPresets,
        isConfigShowOnSuggestConflict: isConfigShowOnSuggestConflict()
    });

    // Handle webview command
    panel.webview.onDidReceiveMessage(async (msg) => {
        await handleWebviewMessage(panel, msg);
    }, undefined, []);
}

/**
 * Handle messages from webview
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleWebviewMessage(panel: vscode.WebviewPanel, msg: any): Promise<void> {
    try {
        if (msg?.type === 'saveApiBaseURL') {
            const value = String(msg.value || '').trim();
            await setConfigApiBaseURL(value);
            panel.webview.postMessage({ type: 'saved', key: 'apiBaseURL', value });
            // Refresh state after command execution
            setTimeout(async () => {
                autoRefreshManager?.refresh();
            }, 500);
        }
        else if (msg?.type === 'saveApiKey') {
            const value = String(msg.value || '').trim();
            await setConfigApiKey(value);
            panel.webview.postMessage({ type: 'saved', key: 'apiKey', value });
        }
        else if (msg?.type === 'saveModel') {
            const value = String(msg.value || '').trim();
            await setConfigModel(value);
            panel.webview.postMessage({ type: 'saved', key: 'model', value });
        }
        else if (msg?.type === 'setHideOnStartup') {
            const value = Boolean(msg.value);
            await setConfigHideOnStartup(value);
            panel.webview.postMessage({ type: 'saved', key: 'hideOnStartup', value });
        }
        else if (msg?.type === 'setShowProgressSpinner') {
            const value = Boolean(msg.value);
            await setConfigShowProgressSpinner(value);
            panel.webview.postMessage({ type: 'saved', key: 'showProgressSpinner', value });
        }
        else if (msg?.type === 'setShowOnSuggestConflict') {
            const value = Boolean(msg.value);
            await setConfigShowOnSuggestConflict(value);
            panel.webview.postMessage({ type: 'saved', key: 'showOnSuggestConflict', value });
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
        else if (msg?.type === 'saveLocalServerPreset') {
            const rawValue = String(msg.value || '');
            const value: LocalServerPreset = isLocalServerPreset(rawValue) ? rawValue : 'Custom';
            await setConfigLocalServerPreset(value);
            panel.webview.postMessage({ type: 'saved', key: 'localServerPreset', value });
        }
        else if (msg?.type === 'saveLocalServerCustom') {
            const value = String(msg.value ?? '');
            await setConfigLocalServerCustom(value);
            panel.webview.postMessage({ type: 'saved', key: 'localServerCustom', value });
        }
        else if (msg?.type === 'setShowAllPresets') {
            const value = Boolean(msg.value);
            await setConfigShowAllPresets(value);
            panel.webview.postMessage({ type: 'saved', key: 'showAllPresets', value });
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
        else if (msg?.type === 'openExternal') {
            const url = String(msg.url || '');
            if (url) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[cotab] Failed to save setting:', errorMessage);
        vscode.window.showErrorMessage(
            localize('gettingStarted.saveError', '設定の保存に失敗しました: {0}', errorMessage)
        );
        const settingKey = msg?.type ? 
            msg.type.replace(/^save|^set/, '').replace(/^[A-Z]/, (c: string) => c.toLowerCase()) : 
            'unknown';
        panel.webview.postMessage({ 
            type: 'error', 
            key: settingKey,
            error: errorMessage 
        });
    }
}

function getHtml(params: {
    apiBaseURL: string;
    apiKey: string;
    model: string;
    hideOnStartup: boolean;
    initial: { kind: string; label: string; command?: string; };
    iconUri: vscode.Uri;
    tutorialAutocompleteUri: vscode.Uri;
    tutorialOpenGettingStartedUri: vscode.Uri;
    spinnerAnalyzeUri: string;
    spinnerRedUri: string;
    spinnerNormalUri: string;
    showProgressSpinner: boolean;
    settingCommentLanguage: string;
    defaultCommentLanguage: string;
    localServerContextSize: number;
    localServerPreset: LocalServerPreset;
    localServerCustom: string;
    showAllPresets: boolean;
    isConfigShowOnSuggestConflict: boolean;
}): string {
    const nonce = String(Date.now());
    const apiBaseURL = escapeHtml(params.apiBaseURL || '');
    const apiKey = escapeHtml(params.apiKey || '');
    const model = escapeHtml(params.model || '');
    const hideOnStartup = params.hideOnStartup ? 'checked' : '';
    const showProgressSpinner = params.showProgressSpinner ? 'checked' : '';
    const showAllPresets = params.showAllPresets ? 'checked' : '';
    const isConfigShowOnSuggestConflict = params.isConfigShowOnSuggestConflict ? 'checked' : '';
    const commentLanguage = escapeHtml(params.settingCommentLanguage || '');
    const defaultCommentLanguage = escapeHtml(params.defaultCommentLanguage || '');
    const localServerContextSize = Number.isFinite(params.localServerContextSize) ? params.localServerContextSize : 32768;
    const localServerPresetValue = isLocalServerPreset(params.localServerPreset) ? params.localServerPreset : 'Custom';
    const presetTooltipMap = LOCAL_SERVER_PRESETS.reduce((acc, preset) => {
        acc[preset] = LOCAL_SERVER_PRESET_TOOLTIPS[preset] || '';
        return acc;
    }, {} as Record<LocalServerPreset, string>);
    const presetTooltipMapJson = JSON.stringify(presetTooltipMap);
    const presetVisibilityMapJson = JSON.stringify(localServerPresetVisibility);
    const localServerPresetOptions = LOCAL_SERVER_PRESETS.map((preset) => {
        const label = escapeHtml(preset);
        const selected = preset === localServerPresetValue ? 'selected' : '';
        const tooltip = escapeHtml(presetTooltipMap[preset] || '');
        const visible = localServerPresetVisibility[preset] ?? true;
        return `<option value="${label}" ${selected} title="${tooltip}" data-tooltip="${tooltip}" data-visible="${visible}" data-preset-key="${escapeHtml(preset)}">${label}</option>`;
    }).join('');
    const localServerCustom = escapeHtml(params.localServerCustom || '');
    const isCustomPreset = localServerPresetValue === 'Custom';
    const presetArgsValue = isCustomPreset ? localServerCustom : (presetTooltipMap[localServerPresetValue] || '');
    
    // Generate README link based on language
    const language = vscode.env.language || 'en';
    let readmeFile = 'README.md';
    let anchor = 'about-available-models';
    if (language.startsWith('ja')) {
        readmeFile = 'README.ja.md';
        anchor = '%E5%88%A9%E7%94%A8%E3%83%A2%E3%83%87%E3%83%AB%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6';
    } else if (language.startsWith('zh')) {
        readmeFile = 'README.zh-cn.md';
        anchor = '%E5%85%B3%E4%BA%8E%E5%8F%AF%E7%94%A8%E6%A8%A1%E5%9E%8B';
    }
    const readmeUrl = `https://github.com/cotab-org/cotab/blob/main/${readmeFile}#${anchor}`;
    
    // Generate README link for Remote Servers section
    let readmeRemoteServersFile = 'README.md';
    let remoteServersAnchor = 'using-remote-servers';
    if (language.startsWith('ja')) {
        readmeRemoteServersFile = 'README.ja.md';
        remoteServersAnchor = '%E3%83%AA%E3%83%A2%E3%83%BC%E3%83%88%E3%82%B5%E3%83%BC%E3%83%90%E3%83%BC%E3%81%AE%E5%88%A9%E7%94%A8';
    } else if (language.startsWith('zh')) {
        readmeRemoteServersFile = 'README.zh-cn.md';
        remoteServersAnchor = '%E4%BD%BF%E7%94%A8%E8%BF%9C%E7%A8%8B%E6%9C%8D%E5%8A%A1%E5%99%A8';
    }
    const readmeRemoteServersUrl = `https://github.com/cotab-org/cotab/blob/main/${readmeRemoteServersFile}#${remoteServersAnchor}`;
    const initialState = JSON.stringify(params.initial);
    // Prepare shared SVG URIs for consistent UI
    const assetsJson = JSON.stringify({
        startBtn: buildNetworkServerLabelSvgDataUri(localize('gettingStarted.server.start', 'Start Server'), 'blue'),
        stopBtn: buildNetworkServerLabelSvgDataUri(localize('gettingStarted.server.stop', 'Stop Server'), 'red'),
        installBtn: buildNetworkServerLabelSvgDataUri(localize('gettingStarted.server.install', 'Install Server'), 'green'),
        networkLbl: buildNetworkServerLabelSvgDataUri(localize('gettingStarted.server.network', 'Network Server Running'), 'purple'),
        unsupportedLbl: buildNetworkServerLabelSvgDataUri(localize('gettingStarted.server.unsupported', 'Install Not Supported'), 'gray')
    });
    const readmeUrlJson = JSON.stringify(readmeUrl);
    const readmeRemoteServersUrlJson = JSON.stringify(readmeRemoteServersUrl);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: vscode-resource:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cotab Getting Started</title>
    <style>
        body { font-family: -apple-system, Segoe UI, Ubuntu, Helvetica, Arial, sans-serif; padding: 16px; padding-bottom: 96px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        *, *::before, *::after { box-sizing: border-box; }
        h1 { font-size: 16px; margin: 0 0 12px; }
        h2 { font-size: 32px; font-weight: bold; margin-top: 24px; margin-bottom: 24px; }
        h3 { font-size: 24px; font-weight: bold; margin-top: 32px; margin-bottom: 32px; }
        .header-fill {
            border-top: 1px solid var(--vscode-panel-border);
            border-bottom: 1px solid var(--vscode-panel-border);
            border-color: color-mix(in srgb, currentColor 35%, transparent);
            padding-top: 24px;
            padding-bottom: 24px;
            margin-top: 64px;
            margin-bottom: 32px;
            background: linear-gradient(90deg, rgba(41, 48, 74, 0.42) 0%, rgb(66 87 115 / 45%) 35%, rgb(66 87 115 / 45%) 65%, rgba(41, 48, 74, 0.42) 100%);
        }
        label { display: block; margin-bottom: 6px; }
        input[type="text"],
        input[type="number"] { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
        .setting-group select {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
        }
        input[type="number"] { -moz-appearance: textfield; }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type="range"] { flex: 1; cursor: pointer; }
        .row { display: flex; gap: 8px; align-items: center; }
        .grow { flex: 1; }
        .context-size-input { width: 64px !important; min-width: 64px; text-align: left; }
        .setting-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 16px;
            margin-bottom: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 8px;
            transition: all 0.2s ease;
        }
        .setting-group:hover {
            background: rgba(255, 255, 255, 0.05);
            border-color: rgba(255, 255, 255, 0.12);
        }
        .setting-group label {
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
            opacity: 0.9;
        }
        .setting-group .row {
            width: 100%;
        }
        .setting-group input[type="text"] {
            margin: 0;
        }
        .setting-group .helper-text {
            margin-top: 6px;
            margin-bottom: 0;
        }
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
        .setup-card--hero .helper-text {
            font-size: 14px;
            text-align: center;
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
        .setting-group .setup-checkbox {
            align-self: center;
            margin: 0 auto;
        }
        .setting-group .helper-text {
            align-self: center;
            margin: 0 auto;
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
            margin-top: 64px;
            margin-bottom: 32px;
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
            color: var(--vscode-foreground);
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
        .title-wrapper { display: flex; flex-direction: column; align-items: center; margin: 64px 0 64px; }
        .title-head { display: flex; align-items: center; justify-content: center; font-size: 40px; }
        .title-head::after { content: ''; display: block; width: 56px; height: 0; flex: 0 0 56px; }
        .title-head img { width: 56px; height: 56px; display: block; }
        .title-head .title-text { font-size: 48px; font-weight: bold; letter-spacing: 2px; }
        .shortcut-table {
            width: auto;
            border-collapse: collapse;
            border: 1px solid var(--vscode-foreground);
            overflow: hidden;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }
        #context-size-container {
            margin-top: 8px;
        }

        .shortcut-table th {
            background-color: #cccccc;
            color: #222;
            font-weight: 600;
            text-align: left;
            padding: 8px 12px;
        }

        .shortcut-table td {
            text-align: left;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-foreground);
        }

        .shortcut-table tr:last-child td {
            border-bottom: none;
        }
    </style>
    </head>
    <body>
        <div class="title-wrapper">
            <h1 class="title-head">
                <img src="${params.iconUri}" alt="Cotab" />
                <span class="title-text">Cotab</span>
            </h1>
        </div>
        <h2 class="center header-fill">${localize('gettingStarted.gettingStarted', 'Getting Started')}</h2>
        <h3 class="center">${localize('gettingStarted.setupServer', 'Setup Server')}</h3>
        <section class="setup-card setup-card--status">
            <div class="spacer"></div>
            <div id="serverStatus" class="muted"></div>
            <a id="serverActionButton" class="server-action-link" style="display:none;" href="javascript:void(0)" title="${escapeHtml(localize('gettingStarted.server.autoStartTooltip', 'If you use auto-start, the "OpenAI compatible Base URL" setting must be blank.'))}"></a>
            <div class="spacer"></div>
            <div id="local-server-preset-container" class="setting-group">
                <label for="localServerPresetSelect">${localize('gettingStarted.preset', 'Preset')}</label>
                <div class="row">
                    <select id="localServerPresetSelect" class="grow">
                        ${localServerPresetOptions}
                    </select>
                </div>
                <div class="row" id="localServerCustomGroup">
                    <input id="localServerCustomInput" type="text" class="grow" value="${presetArgsValue}" placeholder="${escapeHtml(localize('gettingStarted.customArgsPlaceholder', 'Enter custom llama-server arguments'))}" ${isCustomPreset ? '' : 'disabled'} />
                </div>
                <div class="row" style="justify-content: center; margin-top: 8px;">
                    <label class="checkbox">
                        <input id="showAllPresets" type="checkbox" ${showAllPresets} />
                        <span>${localize('gettingStarted.showAllPresets', 'Show All')}</span>
                    </label>
                </div>
                <div class="row" style="justify-content: center; margin-top: 8px;">
                    <a id="aboutAvailableModelsLink" href="javascript:void(0)" style="color: var(--vscode-textLink-foreground); text-decoration: none; font-size: 13px;">${localize('gettingStarted.aboutAvailableModels', 'About Available Models')}</a>
                </div>
            </div>
            <div id="context-size-container" class="setting-group" title="${escapeHtml(localize('gettingStarted.contextSizeTooltip', 'Required:\n - set 16k (16384) or more.\n\nRecommended:\n - set 32k (32768) or more.\n\nReason:\n - The system prompt uses about 5k, and 1,000 lines of code use about 12k more.\n - so please set the context window to 20k (20480) or more.\n\nThe default model (Qwen3-4B-Instruct-2507) VRAM usage:\n - 16k: about 4 GB\n - 32k: about 5.5 GB'))}">
                <label for="localServerContextSlider">${localize('gettingStarted.contextSize', 'Context Size')}</label>
                <div class="row">
                    <input id="localServerContextSlider" type="range" class="range-input" min="8192" max="131072" step="4096" value="${localServerContextSize}" />
                    <input id="localServerContextInput" type="number" class="context-size-input" inputmode="numeric" value="${localServerContextSize}" />
                </div>
            </div>
            <div class="status-divider">
                <span class="status-divider__line"></span>
                <span>${localize('gettingStarted.or', 'OR')}</span>
                <span class="status-divider__line"></span>
            </div>
            <div class="spacer"></div>
            <div class="setting-group" title="${escapeHtml(localize('gettingStarted.apiBaseURLTooltip', 'If you use auto-start the Local Server, leave it blank.'))}">
                <label for="apiBaseURL">${localize('gettingStarted.apiBaseURL', 'OpenAI compatible Base URL')}</label>
                <div class="row">
                    <input id="apiBaseURL" type="text" class="grow" value="${apiBaseURL}" placeholder="http://localhost:8080/v1" />
                </div>
                <div class="row" style="justify-content: center; margin-top: 8px;">
                    <a id="aboutRemoteServersLink" href="javascript:void(0)" style="color: var(--vscode-textLink-foreground); text-decoration: none; font-size: 13px;">${localize('gettingStarted.aboutRemoteServers', 'About Remote Servers')}</a>
                </div>
            </div>
            <div class="setting-group">
                <label for="model">${localize('gettingStarted.model', 'Model')}</label>
                <div class="row">
                    <input id="model" type="text" class="grow" value="${model}" placeholder="qwen3-4b-2507" />
                </div>
            </div>
            <div class="setting-group">
                <label for="apiKey">${localize('gettingStarted.apiKey', 'API Key')}</label>
                <div class="row">
                    <input id="apiKey" type="password" class="grow" value="${apiKey}" placeholder="sk-... (Optional)" autocomplete="off" spellcheck="false" />
                </div>
            </div>
            <div class="spacer"></div>
        </section>
        <div class="separator"></div>
        <h3 class="center">${localize('gettingStarted.letsGetAutocompleting', 'Let\'s Get Autocompleting!')}</h3>
        <section class="setup-card setup-card--hero">
            <div class="setup-card__content-block">
                <div class="setup-card__media">
                    <img src="${params.tutorialAutocompleteUri}" class="setup-card__media-image" alt="Cotab Tutorial" />
                </div>
            </div>
            <div class="spacer"></div>
            <table class="shortcut-table" style="margin: 0 auto;">
                <thead>
                    <tr><th>${localize('gettingStarted.command', 'Command')}</th><th>${localize('gettingStarted.keybinding', 'Keybinding')}</th></tr>
                </thead>
                <tbody>
                    <tr><td>${localize('gettingStarted.acceptAll', 'Accept All')}</td><td>Tab</td></tr>
                    <tr><td>${localize('gettingStarted.acceptFirstLine', 'Accept First Line')}</td><td>Shift + Tab</td></tr>
                    <tr><td>${localize('gettingStarted.reject', 'Reject')}</td><td>Esc</td></tr>
                </tbody>
            </table>
            <div class="helper-text">
                ${localize('gettingStarted.rejectNote', 'Note: By rejecting, you can change the next completion candidates.')}
            </div>
        </section>
        <div class="separator"></div>
        <h3 class="center">${localize('gettingStarted.showThisPageAgain', 'Show This Page Again')}</h3>
        <section class="setup-card setup-card--hero">
            <div class="setup-card__content-block">
                <div class="setup-card__media">
                    <img src="${params.tutorialOpenGettingStartedUri}" class="setup-card__media-image" alt="Show progress spinner preview" />
                </div>
                <div class="setup-card__caption-group">
                    <span class="setup-card__caption">${localize('gettingStarted.hoverStatusBar', 'Hover over the status bar. Don\'t click!')}</span>
                    <label class="setup-checkbox">
                        <input id="hideNextInline" type="checkbox" ${hideOnStartup}/>
                        <span class="setup-checkbox__label">${localize('gettingStarted.dontShowAgain', 'Don\'t show this again')}</span>
                    </label>
                </div>
            </div>
        </section>
        <h2 class="center header-fill">${localize('gettingStarted.learnMore', 'Learn More')}</h2>
        <h3 class="center">${localize('gettingStarted.progressIconDescription', 'Progress Icon Description')}</h3>
        <section class="setup-card setup-card--spinners">
            <div class="spinner-card">
                <div class="spinner-card__icon">
                    <img src="${params.spinnerAnalyzeUri}" class="spinner-card__image" alt="${escapeHtml(localize('gettingStarted.analyzing', 'Analyzing'))}" />
                </div>
                <span class="spinner-card__label">${localize('gettingStarted.analyzing', 'Analyzing')}</span>
            </div>
            <div class="spinner-card">
                <div class="spinner-card__icon">
                    <img src="${params.spinnerRedUri}" class="spinner-card__image" alt="${escapeHtml(localize('gettingStarted.completingCurrentLine', 'Completing current line'))}" />
                </div>
                <span class="spinner-card__label">${localize('gettingStarted.completingCurrentLine', 'Completing<br>current line')}</span>
            </div>
            <div class="spinner-card">
                <div class="spinner-card__icon">
                    <img src="${params.spinnerNormalUri}" class="spinner-card__image" alt="${escapeHtml(localize('gettingStarted.completingAfterCurrentLine', 'Completing after current line'))}" />
                </div>
                <span class="spinner-card__label">${localize('gettingStarted.completingAfterCurrentLine', 'Completing<br>after current line')}</span>
            </div>
            <div class="setup-card__caption-group">
                <label class="setup-checkbox">
                    <input id="showProgressSpinner" type="checkbox" ${showProgressSpinner}/>
                    <span class="setup-checkbox__label">${localize('gettingStarted.showProgressIcon', 'Show progress icon')}</span>
                </label>
            </div>
        </section>
        <div class="separator"></div>
        <h3 class="center">${localize('gettingStarted.detailSettings', 'Detail Settings')}</h3>
        <section class="setup-card setup-card--status">
            <div class="spacer"></div>
            <div class="setting-group">
                <label for="commentLanguage">${localize('gettingStarted.commentLanguage', 'Comment Language')}</label>
                <div class="row">
                    <input id="commentLanguage" type="text" class="grow" value="${commentLanguage}" placeholder="${defaultCommentLanguage}" />
                </div>
                <div class="helper-text">(e.g. 'English', '日本語', '简体中文', 'Français')</div>
            </div>
            <div class="setting-group">
                <label class="setup-checkbox">
                    <input id="showOnSuggestConflict" type="checkbox" ${isConfigShowOnSuggestConflict}/>
                    <span class="setup-checkbox__label">${localize('gettingStarted.showOnSuggestConflict', 'Use VS Code inline suggestion display')}</span>
                </label>
                <div class="helper-text">${localize('gettingStarted.showOnSuggestConflictHelperText', "When enabled,<br>'showOnSuggestConflict' is set to 'always'.")}</div>
            </div>
            <div class="spacer"></div>
        </section>
        <div class="floating-controls">
            <label class="checkbox floating-label"><input id="hideNext" type="checkbox" ${hideOnStartup}/>${localize('gettingStarted.dontShowAgain', 'Don\'t show this again')}</label>
            <div class="floating-divider"></div>
            <button id="openSettingsBtn" class="floating-settings-btn" type="button" title="${escapeHtml(localize('gettingStarted.openSettingsTooltip', 'Open Cotab Settings'))}">${localize('gettingStarted.openSettings', 'Open Settings')}</button>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let state = ${initialState};
            const serverStatusContainer = document.getElementById('serverStatus');
            const serverActionLink = document.getElementById('serverActionButton');
            const apiBaseURLInput = document.getElementById('apiBaseURL');
            const apiKeyInput = document.getElementById('apiKey');
            const modelInput = document.getElementById('model');
            const commentLanguageInput = document.getElementById('commentLanguage');
            const localServerContextSlider = document.getElementById('localServerContextSlider');
            const localServerContextInput = document.getElementById('localServerContextInput');
            const contextSizeContainer = document.getElementById('context-size-container');
            const localServerPresetContainer = document.getElementById('local-server-preset-container');
            const localServerPresetSelect = document.getElementById('localServerPresetSelect');
            const localServerCustomGroup = document.getElementById('localServerCustomGroup');
            const localServerCustomInput = document.getElementById('localServerCustomInput');
            const hideNext = document.getElementById('hideNext');
            const hideNextInline = document.getElementById('hideNextInline');
            const showProgressSpinnerCheckbox = document.getElementById('showProgressSpinner');
            const showOnSuggestConflictCheckbox = document.getElementById('showOnSuggestConflict');
            const openSettingsBtn = document.getElementById('openSettingsBtn');
            const presetTooltipMap = ${presetTooltipMapJson};
            const presetVisibilityMap = ${presetVisibilityMapJson};
            const assets = ${assetsJson};
            const readmeUrl = ${readmeUrlJson};
            const readmeRemoteServersUrl = ${readmeRemoteServersUrlJson};
            console.log('[cotab] quickSetup assets loaded', assets);
            
            // Keep the custom value entered by the user
            let savedCustomValue = ${JSON.stringify(localServerCustom)};
            // Initialize savedCustomValue from the input if it's Custom preset
            if (localServerCustomInput instanceof HTMLInputElement && ${JSON.stringify(isCustomPreset)}) {
                savedCustomValue = String(localServerCustomInput.value || '').trim();
            }

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

            function setLocalServerControlsVisible(visible) {
                const display = visible ? 'block' : 'none';
                if (contextSizeContainer instanceof HTMLElement) {
                    contextSizeContainer.style.display = display;
                }
                if (localServerPresetContainer instanceof HTMLElement) {
                    localServerPresetContainer.style.display = display;
                }
            }

            function updateLocalServerPresetTooltip(presetValue) {
                if (!(localServerPresetSelect instanceof HTMLSelectElement)) {
                    return;
                }
                const presetKey = presetValue || localServerPresetSelect.value || 'Custom';
                const presetTooltip = (presetTooltipMap && typeof presetTooltipMap === 'object')
                    ? (presetTooltipMap[presetKey] || '')
                    : '';
                let tooltip = presetTooltip || '';
                if (presetKey === 'Custom' && localServerCustomInput instanceof HTMLInputElement) {
                    const customValue = String(localServerCustomInput.value || '').trim();
                    if (customValue) {
                        tooltip = customValue;
                        localServerCustomInput.title = customValue;
                    } else {
                        localServerCustomInput.removeAttribute('title');
                    }
                } else if (localServerCustomInput instanceof HTMLInputElement) {
                    localServerCustomInput.removeAttribute('title');
                }
                if (tooltip) {
                    localServerPresetSelect.title = tooltip;
                } else {
                    localServerPresetSelect.removeAttribute('title');
                }
            }

            function toggleLocalServerCustomInput(presetValue) {
                const isCustom = presetValue === 'Custom';
                if (localServerCustomGroup instanceof HTMLElement) {
                    localServerCustomGroup.style.display = '';
                }
                if (localServerCustomInput instanceof HTMLInputElement) {
                    if (isCustom) {
                        // Restore saved custom value when switching back to Custom
                        localServerCustomInput.disabled = false;
                        localServerCustomInput.value = savedCustomValue;
                    } else {
                        // Show preset args but keep custom value saved
                        localServerCustomInput.disabled = true;
                        const presetKey = presetValue || 'Custom';
                        const presetArgs = (presetTooltipMap && typeof presetTooltipMap === 'object')
                            ? (presetTooltipMap[presetKey] || '')
                            : '';
                        localServerCustomInput.value = presetArgs;
                    }
                }
                updateLocalServerPresetTooltip(presetValue);
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
                    setLocalServerControlsVisible(false);
                } else if (state?.kind === 'start' && state?.command) {
                    serverActionLink.style.display = '';
                    serverStatusContainer.textContent = '';
                    renderSvgImage(serverActionLink, assets.startBtn, 'Start Server');
                    serverActionLink.dataset.command = state.command;
                    setLocalServerControlsVisible(true);
                } else if (state?.kind === 'stop') {
                    serverActionLink.style.display = '';
                    serverStatusContainer.textContent = '';
                    renderSvgImage(serverActionLink, assets.stopBtn, 'Stop Server');
                    serverActionLink.dataset.command = state.command;
                    setLocalServerControlsVisible(true);
                } else if (state?.kind === 'install' && state?.command) {
                    serverActionLink.style.display = '';
                    serverStatusContainer.textContent = '';
                    renderSvgImage(serverActionLink, assets.installBtn, 'Install Server');
                    serverActionLink.dataset.command = state.command;
                    setLocalServerControlsVisible(false);
                } else if (state?.kind === 'unsupported') {
                    renderSvgImage(serverStatusContainer, assets.unsupportedLbl, 'Install Not Supported');
                    serverActionLink.style.display = 'none';
                    setLocalServerControlsVisible(false);
                } else {
                    serverStatusContainer.textContent = '';
                    serverActionLink.style.display = 'none';
                    setLocalServerControlsVisible(true);
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

            let apiBaseURLSaveTimer = null;
            if (apiBaseURLInput instanceof HTMLInputElement) {
                apiBaseURLInput.addEventListener('input', () => {
                    if (apiBaseURLSaveTimer) clearTimeout(apiBaseURLSaveTimer);
                    apiBaseURLSaveTimer = setTimeout(() => {
                        const value = String(apiBaseURLInput.value || '').trim();
                        vscode.postMessage({ type: 'saveApiBaseURL', value });
                    }, 400);
                });
            }

            let apiKeySaveTimer = null;
            if (apiKeyInput instanceof HTMLInputElement) {
                apiKeyInput.addEventListener('input', () => {
                    if (apiKeySaveTimer) clearTimeout(apiKeySaveTimer);
                    apiKeySaveTimer = setTimeout(() => {
                        const value = String(apiKeyInput.value || '').trim();
                        vscode.postMessage({ type: 'saveApiKey', value });
                    }, 400);
                });
            }

            let modelSaveTimer = null;
            if (modelInput instanceof HTMLInputElement) {
                modelInput.addEventListener('input', () => {
                    if (modelSaveTimer) clearTimeout(modelSaveTimer);
                    modelSaveTimer = setTimeout(() => {
                        const value = String(modelInput.value || '').trim();
                        vscode.postMessage({ type: 'saveModel', value });
                    }, 400);
                });
            }

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
            let localServerCustomSaveTimer = null;

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

            function filterPresetOptions(showAll) {
                if (!(localServerPresetSelect instanceof HTMLSelectElement)) {
                    return;
                }
                const currentValue = localServerPresetSelect.value;
                const options = Array.from(localServerPresetSelect.options);
                options.forEach((option) => {
                    const presetKey = option.getAttribute('data-preset-key') || option.value;
                    const isVisible = presetVisibilityMap && typeof presetVisibilityMap === 'object' 
                        ? (presetVisibilityMap[presetKey] ?? true)
                        : true;
                    if (showAll || isVisible) {
                        option.style.display = '';
                    } else {
                        option.style.display = 'none';
                    }
                });
                // If the currently selected option becomes hidden, select the first visible option
                const selectedOption = localServerPresetSelect.options[localServerPresetSelect.selectedIndex];
                if (selectedOption && selectedOption.style.display === 'none') {
                    const firstVisibleOption = options.find(opt => opt.style.display !== 'none');
                    if (firstVisibleOption) {
                        localServerPresetSelect.value = firstVisibleOption.value;
                        toggleLocalServerCustomInput(firstVisibleOption.value);
                        vscode.postMessage({ type: 'saveLocalServerPreset', value: firstVisibleOption.value });
                    }
                }
            }

            const showAllPresetsCheckbox = document.getElementById('showAllPresets');
            if (showAllPresetsCheckbox instanceof HTMLInputElement) {
                filterPresetOptions(showAllPresetsCheckbox.checked);
                showAllPresetsCheckbox.addEventListener('change', () => {
                    const value = showAllPresetsCheckbox.checked;
                    filterPresetOptions(value);
                    vscode.postMessage({ type: 'setShowAllPresets', value });
                });
            }

            if (localServerPresetSelect instanceof HTMLSelectElement) {
                toggleLocalServerCustomInput(localServerPresetSelect.value);
                localServerPresetSelect.addEventListener('change', () => {
                    const value = localServerPresetSelect.value;
                    toggleLocalServerCustomInput(value);
                    if (value === 'Custom' && localServerCustomInput instanceof HTMLInputElement) {
                        localServerCustomInput.focus();
                    }
                    if (localServerCustomSaveTimer) {
                        clearTimeout(localServerCustomSaveTimer);
                        localServerCustomSaveTimer = null;
                    }
                    vscode.postMessage({ type: 'saveLocalServerPreset', value });
                });
            } else {
                toggleLocalServerCustomInput('Custom');
            }

            if (localServerCustomInput instanceof HTMLInputElement) {
                const scheduleLocalServerCustomSave = () => {
                    updateLocalServerPresetTooltip('Custom');
                    if (!(localServerPresetSelect instanceof HTMLSelectElement) || localServerPresetSelect.value !== 'Custom') {
                        return;
                    }
                    // Save the custom value to the variable
                    savedCustomValue = String(localServerCustomInput.value || '').trim();
                    if (localServerCustomSaveTimer) {
                        clearTimeout(localServerCustomSaveTimer);
                    }
                    localServerCustomSaveTimer = setTimeout(() => {
                        vscode.postMessage({
                            type: 'saveLocalServerCustom',
                            value: savedCustomValue
                        });
                    }, 400);
                };
                localServerCustomInput.addEventListener('input', scheduleLocalServerCustomSave);
                localServerCustomInput.addEventListener('blur', scheduleLocalServerCustomSave);
                localServerCustomInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        scheduleLocalServerCustomSave();
                    }
                });
            }

            function syncHideOnStartupCheckboxes(value) {
                if (hideNext instanceof HTMLInputElement) {
                    hideNext.checked = value;
                }
                if (hideNextInline instanceof HTMLInputElement) {
                    hideNextInline.checked = value;
                }
            }

            function handleHideOnStartupChange(event) {
                const target = event.currentTarget;
                if (!(target instanceof HTMLInputElement)) {
                    return;
                }
                const value = target.checked;
                syncHideOnStartupCheckboxes(value);
                vscode.postMessage({ type: 'setHideOnStartup', value });
            }

            if (hideNext instanceof HTMLInputElement) {
                hideNext.addEventListener('change', handleHideOnStartupChange);
            }

            if (hideNextInline instanceof HTMLInputElement) {
                hideNextInline.addEventListener('change', handleHideOnStartupChange);
            }

            const initialHideValue = hideNext instanceof HTMLInputElement
                ? hideNext.checked
                : hideNextInline instanceof HTMLInputElement
                    ? hideNextInline.checked
                    : false;
            syncHideOnStartupCheckboxes(Boolean(initialHideValue));

            if (showProgressSpinnerCheckbox instanceof HTMLInputElement) {
                showProgressSpinnerCheckbox.addEventListener('change', () => {
                    vscode.postMessage({ type: 'setShowProgressSpinner', value: showProgressSpinnerCheckbox.checked });
                });
            }

            if (showOnSuggestConflictCheckbox instanceof HTMLInputElement) {
                showOnSuggestConflictCheckbox.addEventListener('change', () => {
                    vscode.postMessage({ type: 'setShowOnSuggestConflict', value: showOnSuggestConflictCheckbox.checked });
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

            const aboutAvailableModelsLink = document.getElementById('aboutAvailableModelsLink');
            if (aboutAvailableModelsLink) {
                aboutAvailableModelsLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    vscode.postMessage({ type: 'openExternal', url: readmeUrl });
                });
            }

            const aboutRemoteServersLink = document.getElementById('aboutRemoteServersLink');
            if (aboutRemoteServersLink) {
                aboutRemoteServersLink.addEventListener('click', (event) => {
                    event.preventDefault();
                    vscode.postMessage({ type: 'openExternal', url: readmeRemoteServersUrl });
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



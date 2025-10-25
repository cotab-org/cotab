import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { setConfigApiBaseURL } from '../utils/config';
import { terminalCommand } from '../utils/terminalCommand';
import { getAiClient } from '../llm/llmProvider';
import { buildLinkButtonSvgDataUri, buildNetworkServerLabelSvgDataUri } from './menuUtil';

export function registerQuickStartup(disposables: vscode.Disposable[], context: vscode.ExtensionContext): void {
    disposables.push(vscode.commands.registerCommand('cotab.quickStartup.show', async () => {
        await showQuickStartup(context);
    }));

    // 起動時、自動表示（設定がオフの場合のみ表示）
    const cfg = vscode.workspace.getConfiguration();
    const hide = cfg.get<boolean>('cotab.quickStartup.hideOnStartup', false);
    if (!hide) {
        // 遅延して表示（起動直後の初期化完了を待つ）
        setTimeout(() => { void showQuickStartup(context); }, 500);
    }
}

async function showQuickStartup(context: vscode.ExtensionContext): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
        'cotab.quickStartup',
        'Cotab Quick Startup',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    const apiBaseURL = getConfig().apiBaseURL;
    const hideOnStartup = vscode.workspace.getConfiguration().get<boolean>('cotab.quickStartup.hideOnStartup', false);
    const initial = await getServerSectionState();

    panel.webview.html = getHtml({ apiBaseURL, hideOnStartup, initial });

    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === 'saveApiBaseURL') {
            const value = String(msg.value || '').trim();
            await setConfigApiBaseURL(value);
            panel.webview.postMessage({ type: 'saved', key: 'apiBaseURL', value });
        }
        else if (msg?.type === 'setHideOnStartup') {
            const value = Boolean(msg.value);
            await vscode.workspace.getConfiguration()
                .update('cotab.quickStartup.hideOnStartup', value, vscode.ConfigurationTarget.Global);
            panel.webview.postMessage({ type: 'saved', key: 'hideOnStartup', value });
        }
        else if (msg?.type === 'executeCommand') {
            const command = String(msg.command || '');
            if (command) {
                await vscode.commands.executeCommand(command);
                setTimeout(async () => {
                    const state = await getServerSectionState();
                    panel.webview.postMessage({ type: 'state', state });
                }, 1000);
            }
        }
        else if (msg?.type === 'refresh') {
            const state = await getServerSectionState();
            panel.webview.postMessage({ type: 'state', state });
        }
    }, undefined, []);
}

async function getServerSectionState(): Promise<{ kind: 'stop' | 'network' | 'start' | 'install'; label: string; command?: string; }>{
    if (await terminalCommand.isRunningLocalLlamaServer()) {
        return { kind: 'stop', label: 'Local Server Running' };
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

function getHtml(params: { apiBaseURL: string; hideOnStartup: boolean; initial: { kind: string; label: string; command?: string; }; }): string {
    const nonce = String(Date.now());
    const apiBaseURL = escapeHtml(params.apiBaseURL || '');
    const hideOnStartup = params.hideOnStartup ? 'checked' : '';
    const initialState = JSON.stringify(params.initial);
    // Prepare shared SVG URIs for consistent UI
    const assetsJson = JSON.stringify({
        startBtn: buildLinkButtonSvgDataUri('Start Server', '#007acc', '#ffffff'),
        stopBtn: buildNetworkServerLabelSvgDataUri('Local Server Running'),
        installBtn: buildNetworkServerLabelSvgDataUri('Install Local Server'),
        networkLbl: buildNetworkServerLabelSvgDataUri('Network Server Running')
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
    .section { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; margin-bottom: 12px; background: var(--vscode-editor-background); }
    label { display: block; margin-bottom: 6px; }
    input[type="text"] { width: 100%; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; }
    .row { display: flex; gap: 8px; align-items: center; }
    .grow { flex: 1; }
    button { padding: 6px 12px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-radius: 4px; cursor: pointer; }
    .muted { opacity: 0.8; }
    .checkbox { display: flex; align-items: center; gap: 8px; }
    .btnimg { display:inline-flex; }
    .btnimg img { display: block; }
    .server-section { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 16px; border-radius: 10px; background: linear-gradient(140deg, rgba(56, 69, 90, 0.25) 0%, rgba(21, 25, 35, 0.15) 50%, rgba(56, 69, 90, 0.25) 100%); border: 1px solid rgba(255,255,255,0.04); box-shadow: 0 10px 24px rgba(0,0,0,0.18); }
    .server-action { display: inline-flex; }
    .server-action img { display: block; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.35)); }
    .server-or { display: flex; align-items: center; gap: 12px; width: 100%; font-size: 16px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
    .server-or-line { flex: 1; height: 1px; background-color: currentColor; opacity: 0.35; }
    .server-hint { font-size: 12px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
  </style>
  </head>
  <body>
    <h1>Cotab Quick Startup</h1>
    <div class="section" id="server">
      <div class="server-section">
        <div style="height:8px;"></div>
        <div id="serverLabel" class="muted"></div>
        <a id="serverAction" class="btnimg server-action" style="display:none;" href="#" title="server action"></a>
        <div style="height:8px;"></div>
        <div class="server-or">
          <span class="server-or-line"></span>
          <span>OR</span>
          <span class="server-or-line"></span>
        </div>
        <div style="height:8px;"></div>
        <label for="apiBaseURL">OpenAI compatible Base URL</label>
        <div class="row">
          <input id="apiBaseURL" type="text" class="grow" value="${apiBaseURL}" placeholder="http://localhost:8080/v1" />
        </div>
        <div style="height:8px;"></div>
      </div>
    </div>
    <div class="section">
      <label class="checkbox"><input id="hideNext" type="checkbox" ${hideOnStartup}/> 次回からは表示しない</label>
    </div>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      let state = ${initialState};
      const serverLabel = document.getElementById('serverLabel');
      const serverAction = document.getElementById('serverAction');
      const apiBaseURLInput = document.getElementById('apiBaseURL');
      const hideNext = document.getElementById('hideNext');
      let refreshTimer = null;
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

      function startAutoRefresh() {
        stopAutoRefresh();
        refreshTimer = setInterval(() => {
          vscode.postMessage({ type: 'refresh' });
        }, 5000);
      }
      function stopAutoRefresh() {
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      }

      window.addEventListener('focus', startAutoRefresh);
      window.addEventListener('blur', stopAutoRefresh);
      startAutoRefresh();
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



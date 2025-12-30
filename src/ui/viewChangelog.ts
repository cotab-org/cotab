import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
//import { setOnUpdatedPlugin } from '../utils/systemConfig';
import { terminalCommand } from '../utils/terminalCommand';

let changelogPanel: vscode.WebviewPanel | undefined = undefined;
let extensionContext: vscode.ExtensionContext | undefined = undefined;

/**
 * Register viewChangelog with extension context
 */
export function registerViewChangelog(
    context: vscode.ExtensionContext,
    prevVersion: string | undefined, 
    currentVersion: string): void {
    extensionContext = context;
    // Set callback for plugin version update
    onUpdatedPlugin(prevVersion, currentVersion);
}

/**
 * Callback function to be called when plugin version is updated
 * This will show the changelog view
 */
export async function onUpdatedPlugin(oldVersion: string | undefined, newVersion: string): Promise<void> {
    let additionalHtml = '';
    const [oldMajor, oldMinor, oldPatch] = oldVersion?.split('.').map(x => parseInt(x, 10)) ?? [0, 0, 0];
    const oldVersionNumber = oldMajor * 10000 + oldMinor * 100 + oldPatch;
    
//  const [newMajor, newMinor, newPatch] = newVersion.split('.').map(x => parseInt(x, 10)) ?? [0, 0, 0];
//  const newVersionNumber = newMajor * 10000 + newMinor * 100 + newPatch;
    /*
    if (getConfig().llamaCppVersion === 'Stable') {
        // Check if llama.cpp is installed
        const installedVersion = await terminalCommand.getInstalledLocalLlamaCppVersion();
        if (installedVersion !== '' && `b${installedVersion}` !== StablellamaCppVersion) {
            additionalHtml = `
                <div class="reinstall-warning">
                    <h2 class="warning-title">⚠️ Please Reinstall the Server !</h2>
                    <p class="warning-message">
                        The latest version of Server (llama.cpp) has a performance issue and the completion speed is significantly reduced. <br>
                        Please reinstall to get better performance. <br>
                        Current version: "b${installedVersion}". Stable version: "${StablellamaCppVersion}"
                    </p>
                    <button class="install-button" onclick="executeCommand('cotab.server.install')">
                        <span class="button-icon">🔧</span>
                        <span class="button-text">Click to Reinstall Server</span>
                    </button>
                </div>
            `;
        }
    }
    */
   if (oldVersionNumber === 0) {
        const installedVersion = await terminalCommand.getInstalledLocalLlamaCppVersion();
        if (installedVersion !== '') {
            additionalHtml = `
            <div class="reinstall-warning">
                <h2 class="warning-title">⚠️ Sorry to those who installed the server!</h2>
                <p class="warning-message">
                    If you installed the server after November 13, 2025, the performance was poor. <br>
                    <strong>We fixed it. Please experience fast response!</strong>
                </p>
            </div>
            `;
        }
        if (additionalHtml !== '') {
            await showChangelogView(oldVersion || '', newVersion, additionalHtml);
        }
    }
}

/**
 * Show changelog view in a webview panel
 */
async function showChangelogView(oldVersion: string, newVersion: string, additionalHtml: string = ''): Promise<void> {
    // If panel already exists, reveal it
    if (changelogPanel) {
        changelogPanel.reveal();
        return;
    }

    // Get extension path
    let extensionPath: string | undefined;
    if (extensionContext) {
        extensionPath = extensionContext.extensionUri.fsPath;
    } else {
        extensionPath = vscode.extensions.getExtension('cotab.cotab')?.extensionPath;
    }
    
    if (!extensionPath) {
        vscode.window.showErrorMessage('Failed to get extension path');
        return;
    }

    // Read CHANGELOG.md
    const changelogPath = path.join(extensionPath, 'CHANGELOG.md');
    let changelogContent = '';
    try {
        changelogContent = fs.readFileSync(changelogPath, 'utf8');
    } catch (error) {
        changelogContent = `# Changelog\n\nFailed to load changelog: ${error}`;
    }

    // Create webview panel
    changelogPanel = vscode.window.createWebviewPanel(
        'cotabChangelog',
         `Cotab Changelog (${(oldVersion === '' ? newVersion : oldVersion + '→' + newVersion)})`,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // Convert markdown to HTML (simple conversion)
    const htmlContent = convertMarkdownToHtml(changelogContent);

    changelogPanel.webview.html = getWebviewContent(htmlContent, oldVersion, newVersion, additionalHtml);

    // Handle webview messages
    changelogPanel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'executeCommand') {
            const command = String(message.command || '');
            if (command) {
                await vscode.commands.executeCommand(command);
            }
        }
    });

    // Handle panel disposal
    changelogPanel.onDidDispose(() => {
        changelogPanel = undefined;
    });
}

/**
 * Convert markdown to HTML (simple conversion)
 */
function convertMarkdownToHtml(markdown: string): string {
    let html = markdown;
    
    // Convert headers
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    
    // Convert list items
    html = html.replace(/^- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/^(\d+)\. (.*$)/gim, '<li>$2</li>');
    
    // Wrap consecutive list items in ul tags
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    
    // Convert line breaks
    html = html.replace(/\n/g, '<br>');
    
    return html;
}

/**
 * Get webview HTML content
 */
function getWebviewContent(changelogHtml: string, oldVersion: string, newVersion: string, additionalHtml: string = ''): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cotab Updated ${(oldVersion === '' ? newVersion : oldVersion + '→' + newVersion)}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        h1 {
            color: var(--vscode-textLink-foreground);
            border-bottom: 2px solid var(--vscode-textLink-foreground);
            padding-bottom: 10px;
        }
        h2 {
            color: var(--vscode-textLink-foreground);
            margin-top: 30px;
            margin-bottom: 15px;
            border-bottom: 1px solid var(--vscode-textLink-foreground);
            padding-bottom: 5px;
        }
        h3 {
            color: var(--vscode-textLink-foreground);
            margin-top: 20px;
            margin-bottom: 10px;
        }
        ul {
            margin-left: 20px;
            margin-bottom: 15px;
        }
        li {
            margin-bottom: 5px;
            line-height: 1.6;
        }
        .version-info {
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textLink-foreground);
            padding: 15px;
            margin-bottom: 20px;
        }
        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
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
    <script>
        const vscode = acquireVsCodeApi();
        function executeCommand(command) {
            vscode.postMessage({
                type: 'executeCommand',
                command: command
            });
        }
    </script>
</head>
<body>
    <h1>Cotab Updated ${(oldVersion === '' ? newVersion : oldVersion + '→' + newVersion)}</h1>
    ${additionalHtml}
    <p><a href="https://github.com/cotab-org/cotab/blob/main/CHANGELOG.md" target="_blank">View Changelog on Github</a></p>
    <div>
        ${changelogHtml}
    </div>
</body>
</html>`;
}


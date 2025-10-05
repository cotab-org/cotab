import * as vscode from 'vscode';
import { logDebug, logInfo } from '../utils/logger';

export function registerTabHistory(disposables: vscode.Disposable[]) {
    tabHistoryManager = new TabHistoryManager();
    disposables.push(tabHistoryManager);
}

// Singleton instance
export let tabHistoryManager: TabHistoryManager;


/**
 * Class that manages tab (editor) browsing history.
 * Since VS Code doesn't have an API to directly get history,
 * it hooks onDidChangeActiveTextEditor / Tab API events and accumulates them independently.
 */
export interface TabHistoryEntry {
    // URI of the document associated with the tab
    uri: vscode.Uri;
    // Timestamp when it became active (ms)
    timestamp: number;
}

class TabHistoryManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];

    // History map with URI string as key
    private historyMap: Map<string, TabHistoryEntry> = new Map();

    constructor() {
        logInfo('Initializing Tab History Manager');

        // Active editor change
        const activeChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.touch(editor.document.uri);
            }
        });

        // Supplement with Tab API (VS Code 1.64+)
        const tabChange = vscode.window.tabGroups.onDidChangeTabs((e) => {
            // Add active tabs from opened/changed tabs to history
            [...e.opened, ...e.changed].forEach((tab) => {
                if (tab.isActive && tab.input instanceof vscode.TabInputText && tab.input.uri) {
                    this.touch(tab.input.uri);
                }
            });

            // Remove closed tabs from history
            e.closed.forEach((tab) => {
                if (tab.input instanceof vscode.TabInputText && tab.input.uri) {
                    this.historyMap.delete(tab.input.uri.toString());
                }
            });
        });

        // Also add active editor right after startup
        if (vscode.window.activeTextEditor) {
            this.touch(vscode.window.activeTextEditor.document.uri);
        }

        this.disposables.push(activeChange, tabChange);
        logInfo('Tab History Manager initialized');
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.historyMap.clear();
    }

    // Update timestamp
    private touch(uri: vscode.Uri) {
        const key = uri.toString();
        const now = Date.now();
        this.historyMap.set(key, { uri, timestamp: now });

        logDebug(`TabHistory update: ${key}`);
    }

    // Get history sorted by access order
    getHistory(): TabHistoryEntry[] {
        return Array.from(this.historyMap.values()).sort((a, b) => b.timestamp - a.timestamp);
    }
}

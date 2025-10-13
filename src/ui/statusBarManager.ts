import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { requestUpdateCotabMenu } from './menuIndicator';

export function registerStatusBarManager(disposables: vscode.Disposable[]): void {
    statusBarManager = new StatusBarManager();
    disposables.push(statusBarManager);
}

// Singleton instance
export let statusBarManager: StatusBarManager;

// Type for status bar phase
export type StatusBarPhase = 'idle' | 'analyzing' | 'prompting' | 'firstGenerating' | 'secondGenerating' | 'disable';

/**
 * Manages Cotab status bar item on the bottom-right.
 */
class StatusBarManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private item: vscode.StatusBarItem | undefined;
    private prevPhase: StatusBarPhase | undefined;

    constructor() {
        this.reset();
        this.disposables.push(vscode.commands.registerCommand('cotab.statusBar.click', async () => {
            await requestUpdateCotabMenu();
        }));
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
        this.item = undefined;
    }

    // Public API ----------------------------------------------------

    /**
     * Shows the Cotab menu. When spinning is true, a spinner icon is displayed.
     */
    public showMenu(spinning = true): void {
        const it = this.ensureItem();
        it.text = `${spinning ? '$(sync~spin) ' : ''}Cotab`;
        // Tooltip is set externally by menuIndicator to provide a rich popup-like UI
        it.show();
    }

    /**
     * Updates the status bar item according to the given phase.
     */
    public setPhase(phase: StatusBarPhase): void {
        if (this.prevPhase == phase) return;
        this.prevPhase = phase;

        const it = this.ensureItem();
        switch (phase) {
            case 'analyzing':
                it.text = '$(gear~spin) Cotab Analizing';
                it.color = undefined;
                //it.tooltip = 'Analyzing source code';
                break;
            case 'prompting':
                it.text = '$(sync~spin) Cotab Prompting';
                it.color = undefined;
                //it.tooltip = 'Sending prompt to LLM';
                break;
            case 'firstGenerating':
                it.text = '$(loading~spin) Cotab Generating';
                it.color = undefined;
                //it.tooltip = 'Generating first completion';
                break;
            case 'secondGenerating':
                it.text = '$(loading~spin) Cotab Generating';
                it.color = undefined;
                //it.tooltip = 'Generating second completion';
                break;
            case 'idle':
            default:
                it.text = 'Cotab';
                it.color = undefined;
                // Tooltip is managed externally
                break;
            case 'disable':
                it.text = '$(circle-slash) Cotab';
                it.color = new vscode.ThemeColor('disabledForeground');
                break;
        }
        it.show();
    }

    /**
     * Stops spinner and shows idle menu.
     */
    public reset(): void {
        const phase = getConfig().isCurrentEnabled() ? 'idle' : 'disable';
        this.setPhase(phase);
    }

    // Internal helpers ---------------------------------------------
    private ensureItem(): vscode.StatusBarItem {
        if (!this.item) {
            this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
            this.item.command = 'cotab.statusBar.click';
            this.disposables.push(this.item);
        }
        return this.item;
    }

    /**
     * Sets markdown tooltip for the status bar item to simulate popup menu.
     */
    public setTooltip(markdown: vscode.MarkdownString | string): void {
        const it = this.ensureItem();

        // No-op when content does not change
        const current = it.tooltip;
        const currentValue = typeof current === 'string' ? current : (current ? current.value : '');
        const nextValue = typeof markdown === 'string' ? markdown : markdown.value;
        if (currentValue === nextValue) {
            return;
        }
        // Close current hover by hiding the item briefly
        it.hide();

        if (typeof markdown === 'string') {
            it.tooltip = markdown;
        } else {
            markdown.isTrusted = true; // allow command: links
            it.tooltip = markdown;
        }

        // Re-show on next tick to reflect updated tooltip immediately
            it.show();
        setTimeout(() => {
        }, 0);
    }
}


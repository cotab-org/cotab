import * as vscode from 'vscode';
import { getConfig } from '../utils/config';

export function registerProgressGutterIcon(disposables: vscode.Disposable[]) {
    progressGutterIconManager = new ProgressGutterIconManager();
    disposables.push(progressGutterIconManager);
}

// Singleton instance
export let progressGutterIconManager: ProgressGutterIconManager;

export type GutterIconPhase = 'analyzing' | 'stream' | 'firstGenerating';

// Spinner icons for gutter (multiple frames) by phase
const spinnerDecorationTypesMap: { [K in GutterIconPhase]?: vscode.TextEditorDecorationType[] } = {};

class ProgressGutterIconManager implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = [];
    private state: {
        editor: vscode.TextEditor;
        timer?: NodeJS.Timeout;
        frame: number;
        range: vscode.Range;
        phase: GutterIconPhase;
        dispDecoration?: vscode.TextEditorDecorationType | null;
    } | null = null;

    constructor() {
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('cotab.ui.showProgressSpinner')) {
                const isEnabled = vscode.workspace.getConfiguration().get<boolean>('cotab.ui.showProgressSpinner', true);
                if (!isEnabled) {
                    this.hide();
                }
            }
        }));
    }

    dispose(): void {
        this.disposeProgressDecoration();
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    // Public wrappers --------------------------------------------------------
    public show(pos: vscode.Position, phase: GutterIconPhase | undefined) {
        const editor = vscode.window.activeTextEditor;
        if (!phase || !editor || !getConfig().showProgressSpinner) {
            this.hide();
            return;
        }

        const line = pos.line;
        const col = Math.min(pos.character, editor.document.lineAt(line).text.length);
        const range = new vscode.Range(line, col, line, col);
        if (this.state?.timer) {
            this.state.range = range;
            this.state.phase = phase;
            this.startUpdate();
        }
        else {
            this.state = { editor, frame: 0, range, phase };
            this.startUpdate();
        }
    }

    private onUpdateTimer() {
        if (!this.state) return;

        if (!getConfig().showProgressSpinner) {
            this.hide();
            return;
        }
        
        const editor = this.state.editor;

        // crear prev decorations
        if (this.state.dispDecoration) {
            editor.setDecorations(this.state.dispDecoration, []);
        }

        // set current decorations
        const spinnerDecorationTypes = this.ensureSpinnerDecorationTypes(this.state.phase);
        const dispIndex = this.state.frame % spinnerDecorationTypes.length;
        const dispDecoration = spinnerDecorationTypes[dispIndex];
        editor.setDecorations(dispDecoration, [this.state.range]);
        this.state.dispDecoration = dispDecoration;
        this.state.frame = (this.state.frame + 1) % spinnerDecorationTypes.length;
    }
    
    private startUpdate() {
        if (!this.state) return;

        if (!getConfig().showProgressSpinner) {
            this.hide();
            return;
        }

        this.clearTimer();
        this.onUpdateTimer();
        this.state.timer = setInterval(() => { this.onUpdateTimer(); }, 120);
    }

    private clearTimer(): void {
        if (this.state?.timer) {
            clearInterval(this.state.timer);
            this.state.timer = undefined;
        }
    }

    public hide() {
        if (!this.state) return;
        
        this.clearTimer();
        
        const currentEditor = this.state?.editor ?? vscode.window.activeTextEditor!;
        for (const phase of ['analyzing', 'stream', 'firstGenerating'] as GutterIconPhase[]) {
            const dts = spinnerDecorationTypesMap[phase];
            if (dts) {
                for (const dt of dts) {
                    currentEditor.setDecorations(dt, []);
                }
            }
        }
        this.state = null;
    }

    // Internal helpers -------------------------------------------------------
    private getExtensionUri(): vscode.Uri | null {
        const ext = vscode.extensions.getExtension('cotab.cotab');
        return ext?.extensionUri ?? null;
    }

    private getIconPathes(phase: GutterIconPhase) : string[] {
        if (phase === 'stream') {
            return ['spinner-0.svg', 'spinner-1.svg', 'spinner-2.svg', 'spinner-3.svg'];
        }
        else if (phase === 'firstGenerating') {
            return ['spinner-red-0.svg', 'spinner-red-1.svg', 'spinner-red-2.svg', 'spinner-red-3.svg'];
        }
        else {
            return ['dot-spinner-0.svg', 'dot-spinner-1.svg', 'dot-spinner-2.svg', 'dot-spinner-3.svg', 'dot-spinner-4.svg', 'dot-spinner-5.svg', 'dot-spinner-6.svg', 'dot-spinner-7.svg'];
        }
    }

    private ensureSpinnerDecorationTypes(phase: GutterIconPhase): vscode.TextEditorDecorationType[] {
        if (spinnerDecorationTypesMap[phase]) {
            return spinnerDecorationTypesMap[phase];
        }
        
        const extUri = this.getExtensionUri();
        if (!extUri) {
            spinnerDecorationTypesMap[phase] = [vscode.window.createTextEditorDecorationType({})];
            return spinnerDecorationTypesMap[phase];
        }

        // load icon and create decoration type for each frame
        const frames = this.getIconPathes(phase);
        spinnerDecorationTypesMap[phase] = frames.map((fname) => {
            const iconUri = vscode.Uri.joinPath(extUri, 'media', fname);
            return vscode.window.createTextEditorDecorationType({
                gutterIconPath: iconUri,
                gutterIconSize: '12px',
                rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            });
        });

        return spinnerDecorationTypesMap[phase];
    }

    private disposeProgressDecoration() {
        // Stop all active timers
        if (this.state?.timer) clearInterval(this.state.timer);
        this.state = null;

        // Dispose decoration types
        for (const phase of ['analyzing', 'stream', 'firstGenerating'] as GutterIconPhase[]) {
            const dts = spinnerDecorationTypesMap[phase];
            if (dts) {
                for (const dt of dts) dt.dispose();
                delete spinnerDecorationTypesMap[phase];
            }
        }
    }
}

import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { terminalCommand } from '../utils/terminalCommand';

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
    private activeStackFrameLocation: { fsPath: string; line: number } | null = null;
    private stackFrameLocationRequestId = 0;
    /** True while fetching stack frame (e.g. right after debug step). Spinner is not drawn during this time. */
    private stackFrameUpdatePending = false;
    /** ID used so that only the latest startUpdate() starts the timer when show() is called repeatedly. */
    private startUpdateId = 0;
    /** Cache of whether a line has code actions (lightbulb). Used for synchronous conflict check. */
    private cachedCodeActionAtLine: { uri: string; line: number; hasActions: boolean } | null = null;

    constructor() {
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('cotab.ui.showProgressSpinner')) {
                const isEnabled = vscode.workspace.getConfiguration().get<boolean>('cotab.ui.showProgressSpinner', true);
                if (!isEnabled) {
                    this.hide();
                }
            }
        }));
        this.disposables.push(vscode.debug.onDidChangeActiveStackItem(() => {
            this.stackFrameUpdatePending = true;
            void this.updateActiveStackFrameLocation();
        }));
        void this.updateActiveStackFrameLocation();
    }

    dispose(): void {
        this.disposeProgressDecoration();
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    // Public wrappers --------------------------------------------------------
    public show(pos: vscode.Position, phase: GutterIconPhase | undefined) {
        const editor = vscode.window.activeTextEditor;
        if (!phase || !editor || !getConfig().showProgressSpinner || ! terminalCommand.isEnableServerLazy()) {
            this.hide();
            return;
        }

        const line = pos.line;
        const col = Math.min(pos.character, editor.document.lineAt(line).text.length);
        const range = new vscode.Range(line, col, line, col);
        if (this.state?.timer) {
            this.state.range = range;
            this.state.phase = phase;
            void this.startUpdate();
        }
        else {
            this.state = { editor, frame: 0, range, phase };
            void this.startUpdate();
        }
    }

    private onUpdateTimer() {
        if (!this.state) return;

        if (!getConfig().showProgressSpinner) {
            this.hide();
            return;
        }
        
        const editor = this.state.editor;

        // Do not draw while stack frame is being updated (avoids brief flash on F10 step)
        if (this.stackFrameUpdatePending) {
            if (this.state.dispDecoration) {
                editor.setDecorations(this.state.dispDecoration, []);
                this.state.dispDecoration = null;
            }
            return;
        }

        const hasGutterConflict = this.hasGutterIconConflict(editor, this.state.range);

        // clear prev decorations
        if (this.state.dispDecoration) {
            editor.setDecorations(this.state.dispDecoration, []);
            this.state.dispDecoration = null;
        }

        if (hasGutterConflict) {
            return;
        }

        // set current decorations
        const spinnerDecorationTypes = this.ensureSpinnerDecorationTypes(this.state.phase);
        const dispIndex = this.state.frame % spinnerDecorationTypes.length;
        const dispDecoration = spinnerDecorationTypes[dispIndex];
        editor.setDecorations(dispDecoration, [this.state.range]);
        this.state.dispDecoration = dispDecoration;
        this.state.frame = (this.state.frame + 1) % spinnerDecorationTypes.length;
    }
    
    private async startUpdate(): Promise<void> {
        if (!this.state) return;

        if (!getConfig().showProgressSpinner) {
            this.hide();
            return;
        }

        const myId = ++this.startUpdateId;
        this.clearTimer();

        // When debugging, fetch stack frame before drawing to avoid brief spinner flash after step
        if (vscode.debug.activeDebugSession) {
            await this.updateActiveStackFrameLocation();
            if (!this.state) return;
        }

        // Fetch code action (lightbulb) state before drawing so spinner does not overlap it
        //await this.ensureCodeActionCache(this.state.editor, this.state.range.start.line);
        //if (!this.state) return;

        // When multiple startUpdate() run in parallel due to rapid show() calls, only the latest one starts the timer
        // (otherwise onUpdateTimer() is invoked synchronously multiple times and the spinner appears to rotate faster)
        if (myId !== this.startUpdateId) return;

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

    private hasGutterIconConflict(editor: vscode.TextEditor, range: vscode.Range): boolean {
        const document = editor.document;
        const documentUri = document.uri.toString();
        const documentFsPath = document.uri.fsPath;
        const targetLine = range.start.line;

        if (this.hasBreakpointIcon(documentUri, targetLine)) {
            return true;
        }

        if (this.hasTraceIcon(documentFsPath, targetLine)) {
            return true;
        }

        // if (this.hasCodeActionIcon(documentUri, targetLine)) {
        //     return true;
        // }

        return false;
    }

    private hasCodeActionIcon(documentUri: string, targetLine: number): boolean {
        const c = this.cachedCodeActionAtLine;
        if (!c || c.uri !== documentUri || c.line !== targetLine) {
            return false;
        }
        return c.hasActions;
    }

    private async ensureCodeActionCache(editor: vscode.TextEditor, line: number): Promise<void> {
        const uri = editor.document.uri.toString();
        if (this.cachedCodeActionAtLine?.uri === uri && this.cachedCodeActionAtLine?.line === line) {
            return;
        }
        try {
            const lineRange = editor.document.lineAt(line).range;
            // Only fetch Quick Fix; refactors etc. may not show the lightbulb, so we match actual lightbulb visibility
            const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
                'vscode.executeCodeActionProvider',
                editor.document.uri,
                lineRange,
                vscode.CodeActionKind.QuickFix
            );
            this.cachedCodeActionAtLine = { uri, line, hasActions: Array.isArray(actions) && actions.length > 0 };
        } catch {
            this.cachedCodeActionAtLine = { uri, line, hasActions: false };
        }
    }

    private hasBreakpointIcon(documentUri: string, targetLine: number): boolean {
        for (const breakpoint of vscode.debug.breakpoints) {
            if (!(breakpoint instanceof vscode.SourceBreakpoint)) continue;
            const location = breakpoint.location;
            if (!location) continue;
            if (location.uri.toString() !== documentUri) continue;
            if (location.range.start.line === targetLine) {
                return true;
            }
        }
        return false;
    }

    private hasTraceIcon(documentFsPath: string, targetLine: number): boolean {
        const location = this.activeStackFrameLocation;
        if (!location) return false;

        return location.fsPath === documentFsPath && location.line === targetLine;
    }

    private async updateActiveStackFrameLocation(): Promise<void> {
        const requestId = ++this.stackFrameLocationRequestId;
        const stackItem = vscode.debug.activeStackItem;

        if (!(stackItem instanceof vscode.DebugStackFrame)) {
            this.activeStackFrameLocation = null;
            this.stackFrameUpdatePending = false;
            return;
        }

        try {
            const response = await stackItem.session.customRequest('stackTrace', {
                threadId: stackItem.threadId,
                startFrame: 0,
                levels: 200,
            });

            if (requestId !== this.stackFrameLocationRequestId) {
                return;
            }

            const frames = response?.stackFrames as Array<{ id: number; line?: number; source?: { path?: string } }> | undefined;
            const targetFrame = frames?.find((frame) => frame.id === stackItem.frameId) ?? frames?.[0];

            if (!targetFrame) {
                this.activeStackFrameLocation = null;
                this.stackFrameUpdatePending = false;
                return;
            }

            const sourcePath = targetFrame.source?.path;
            const frameLine = typeof targetFrame.line === 'number' ? Math.max(0, targetFrame.line - 1) : undefined; // DAP is 1-based

            if (!sourcePath || frameLine === undefined) {
                this.activeStackFrameLocation = null;
                this.stackFrameUpdatePending = false;
                return;
            }

            this.activeStackFrameLocation = { fsPath: vscode.Uri.file(sourcePath).fsPath, line: frameLine };
        }
        catch {
            if (requestId === this.stackFrameLocationRequestId) {
                this.activeStackFrameLocation = null;
            }
        }
        this.stackFrameUpdatePending = false;
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

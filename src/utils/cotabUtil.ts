
import * as vscode from 'vscode';
import { statusBarManager, StatusBarPhase } from '../ui/statusBarManager';
import { progressGutterIconManager, GutterIconPhase } from '../ui/progressGutterIconManager';
import * as Handlebars from 'handlebars';
import { logError } from './logger';

export class SimpleLocker {
    private locked = false;
    public async acquireLock() {
        while (this.locked) {
            await new Promise(r => setTimeout(r, 10)); // wait
        }
        this.locked = true;
    }
    public releaseLock() {
        this.locked = false;
    }

    public isLocked(): boolean {
        return this.locked;
    }
};

let isPhaseLock = false;
let prevPhase: GutterIconPhase | undefined;;
export function lockProgress(isLock: boolean) {
    isPhaseLock = isLock;
}
export function moveProgress(pos: vscode.Position) {
    progressGutterIconManager?.show(pos, prevPhase);
}
export function showProgress(phase: StatusBarPhase, pos: vscode.Position) {
    if (isPhaseLock) {
        // update position only
        progressGutterIconManager?.show(pos, prevPhase);
    }
    else {
        const gutterIconPhase = StatusBarPhaseToGutterIconPhase(phase);
        progressGutterIconManager?.show(pos, gutterIconPhase);
        statusBarManager?.setPhase(phase);

        prevPhase = gutterIconPhase;
    }
}

export function hideProgress() {
    if (isPhaseLock) return;

    progressGutterIconManager?.hide();
    statusBarManager?.reset();
}

function StatusBarPhaseToGutterIconPhase(phase: StatusBarPhase): GutterIconPhase | undefined {
    let gutterIconPhase: GutterIconPhase | undefined = undefined;
    switch (phase) {
        case 'analyzing': gutterIconPhase = 'analyzing'; break;
        case 'prompting': gutterIconPhase = 'firstGenerating'; break;
        case 'firstGenerating': gutterIconPhase = 'firstGenerating'; break;
        case 'secondGenerating': gutterIconPhase = 'stream'; break;
        default: break;
    }
    return gutterIconPhase;
}

/**
 * Parse Handlebars template and generate string
 * @param template Handlebars template string
 * @param context Context to pass to template
 * @returns Parsed string
 */
export function parseHandlebarsTemplate(template: string, context: any): string {
	try {
		const compiledTemplate = Handlebars.compile(template, {
			noEscape: true
		});
		const result = compiledTemplate(context);
		return result;
	} catch (error) {
		logError(`Handlebars template parsing failed: ${error}`);
		return template;
	}
}


import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as Handlebars from 'handlebars';
import { statusBarManager, StatusBarPhase } from '../ui/statusBarManager';
import { progressGutterIconManager, GutterIconPhase } from '../ui/progressGutterIconManager';
import { logError } from './logger';
import { platform } from 'os';

//################################################################

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

//###########################################################################

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

//#####################################################################################

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

//######################################################################################

export function isDarkTheme(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    const isLight = (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight);
    return !isLight;
}

//######################################################################################

export interface OSInfo {
    platform: 'win' | 'ubuntu' | 'macos' | 'other';
    gpu: 'cuda' | 'vulkan' | 'cpu' | 'none' | 'other';
    cpu: 'x64' | 'arm64' | 'other';
};

let cachedOsInfo: OSInfo = {
    platform: 'other',
    gpu: 'none',
    cpu: 'other',
};

let isOsInfocached = false;

export async function GetOSInfo(): Promise<OSInfo> {
    if (isOsInfocached) return cachedOsInfo;

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const isUbuntu = !isWin && !isMac;  // @todo
    const hasNvidia = await isWindowsNvidiaGpuPresent();
    const hasAmd = await isWindowsAmdGpuPresent();

    if (isWin) cachedOsInfo.platform = 'win';
    else if (isUbuntu) cachedOsInfo.platform = 'ubuntu';
    else if (isMac) cachedOsInfo.platform = 'macos';

    if (hasNvidia) cachedOsInfo.gpu = 'cuda';
    else if (hasAmd) cachedOsInfo.gpu = 'vulkan';
    else if (isUbuntu) cachedOsInfo.gpu = 'vulkan';

    cachedOsInfo.cpu = 'x64';
    
    isOsInfocached = true;
    return cachedOsInfo;
}

async function isWindowsNvidiaGpuPresent(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
        const exec = util.promisify(cp.exec);
        const { stdout } = await exec(`powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Where-Object Name -match 'NVIDIA' | Select-Object -First 1 -ExpandProperty Name)"`);
        return (stdout || '').trim().length > 0;
    } catch (_) {
        return false;
    }
}

async function isWindowsAmdGpuPresent(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
        const exec = util.promisify(cp.exec);
        const { stdout } = await exec(`powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Where-Object Name -match 'AMD|Radeon' | Select-Object -First 1 -ExpandProperty Name)"`);
        return (stdout || '').trim().length > 0;
    } catch (_) {
        return false;
    }
}



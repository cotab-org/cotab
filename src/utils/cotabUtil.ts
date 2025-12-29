
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as Handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';
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
}

//###########################################################################

let isPhaseLock = false;
let prevPhase: GutterIconPhase | undefined;
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

type PlatformType = 'win' | 'ubuntu' | 'macos' | 'unknown';
type GpuType = 'cuda' | 'vulkan' | 'none' | 'unknown';
type CpuType = 'x64' | 'arm64' | 'unknown';

export interface OSInfo {
    platform: PlatformType;
    gpu: GpuType;
    cpu: CpuType;
}

const cachedOsInfo: OSInfo = {
    platform: 'unknown',
    gpu: 'unknown',
    cpu: 'unknown',
};

let isOsInfocached = false;

export async function GetOSInfo(): Promise<OSInfo> {
    if (isOsInfocached) return cachedOsInfo;

    cachedOsInfo.platform = await detectPlatform();
    cachedOsInfo.gpu = await detectGpu();
    cachedOsInfo.cpu = await detectCpu();
    
    isOsInfocached = true;
    return cachedOsInfo;
}

async function detectPlatform(): Promise<PlatformType> {
    const label = (await detectPlatformInternal()).platformLabel;
    switch(label) {
        case 'Windows': return 'win';
        case 'macOS': return 'macos';
        case 'Ubuntu': return 'ubuntu';
        default: return 'unknown';
    }
}

async function detectPlatformInternal(): Promise<{
  platformLabel: 'Windows' | 'macOS' | 'Ubuntu' | 'Linux-other' | 'Unknown';
  isWSL: boolean;
  distro?: string | null;
}> {
  const nodePlatform = process.platform; // 'win32' | 'darwin' | 'linux' | ...
  if (nodePlatform === 'win32') {
    return { platformLabel: 'Windows', isWSL: false, distro: null };
  }
  if (nodePlatform === 'darwin') {
    return { platformLabel: 'macOS', isWSL: false, distro: null };
  }
  if (nodePlatform === 'linux') {
    // check WSL via env or /proc/version
    const env = process.env;
    let isWSL = false;
    if (env.WSL_DISTRO_NAME) {
      isWSL = true;
    } else {
      // try /proc/version indicator
      isWSL = await procVersionIndicatesWSL();
    }

    // Detect distro via WSL_DISTRO_NAME or /etc/os-release
    let distro: string | null = null;
    if (env.WSL_DISTRO_NAME) {
      distro = env.WSL_DISTRO_NAME;
    }

    const osReleaseRaw = await readFileIfExists('/etc/os-release');
    if (osReleaseRaw) {
      const parsed = parseOsRelease(osReleaseRaw);
      // prefer ID or NAME
      if (parsed.ID) distro = distro ?? parsed.ID;
      else if (parsed.NAME) distro = distro ?? parsed.NAME;
    }

    const distroLower = (distro ?? '').toLowerCase();
    const isUbuntu = distroLower.includes('ubuntu');

    return {
      platformLabel: isUbuntu ? 'Ubuntu' : 'Linux-other',
      isWSL,
      distro: distro ?? null,
    };
  }

  return { platformLabel: 'Unknown', isWSL: false, distro: null };
}

function detectCpu(): CpuType {
    return detectCpuInternal().archLabel;
}

function detectCpuInternal(): { archLabel: CpuType; raw: string } {
  const arch = process.arch; // 'x64' | 'arm64' | 'ia32' | 'arm' | ...
  if (arch === 'x64') return { archLabel: 'x64', raw: arch };
  if (arch === 'arm64') return { archLabel: 'arm64', raw: arch };
  return { archLabel: 'unknown', raw: arch };
}

async function detectGpu(): Promise<GpuType> {
    const osType = await detectPlatform();
    switch(osType) {
        case 'win': {
            const hasNvidia = await isWindowsNvidiaGpuPresent();
            return hasNvidia ? 'cuda' : 'vulkan';
        }
        case 'macos':
            return 'none';
        case 'ubuntu':
            return 'vulkan';
        default:
            return 'unknown';
    }
}


/**
 * read file, return null if error;
 */
async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(filePath, 'utf8');
    return buf;
  } catch (e) {
    return null;
  }
}

/**
 * Check if /proc/version contains 'microsoft' (an indicator of WSL)
 */
async function procVersionIndicatesWSL(): Promise<boolean> {
  const content = await readFileIfExists('/proc/version');
  if (!content) return false;
  return /microsoft/i.test(content);
}

/**
 * parse /etc/os-release.
 */
function parseOsRelease(content: string): Record<string, string> {
  const lines = content.split(/\r?\n/);
  const result: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    // Remove quotes from value if present
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
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

/*
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
*/



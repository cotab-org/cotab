import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getConfig } from '../utils/config';
import { logInfo, logDebug, logWarning, logError } from '../utils/logger';
import { terminalCommand } from '../utils/terminalCommand';

export function registerServerManager(disposables: vscode.Disposable[], context: vscode.ExtensionContext) {
    serverManager = new ServerManager(context);
    disposables.push(serverManager);
}

export function autoStopServerOnExit() {
    serverManager!.autoStopServerOnExit();
}

// Singleton instance
export let serverManager: ServerManager;

class KeepaliveEditor implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private dir: string | null = null;
    private filePath: string | null = null;
    private timer: NodeJS.Timeout | null = null;
    private instanceId: string = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    private readonly intervalMs = 60000; // 60s
    private readonly staleMs = 70000; // 70s considered dead
    
    constructor(context: vscode.ExtensionContext) {
        this.init(context);
        this.start();

        this.disposables.push({
            dispose: () => {
                this.stop();
            }
        });
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    /**
     * Check if other VSCode instances are running.
     */
    public isOtherVSCodeRunning(): boolean {
        try {
            const count = this.getActiveInstanceCount();
            // Check if there are other VS Code instances running (=2 instances)
            return count >= 2;
        }
        catch (error) {
            logDebug(`Failed to check other VSCode instances: ${error}`);
            return false;
        }
    }

    private start() {
        if (!this.filePath) return;
        const writeOnce = () => {
                try {
                    // Create the file if it does not exist
                    if (!fs.existsSync(this.filePath!)) {
                        fs.writeFileSync(this.filePath!, '');
                    }
                    // Update timestamp only
                    fs.utimesSync(this.filePath!, new Date(), new Date());
                } catch (e) {
                    logDebug(`keepalive update failed: ${e}`);
                }
            };
        
        writeOnce();
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.timer = setInterval(writeOnce, this.intervalMs);
    }

    private stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.filePath) {
            try { fs.unlinkSync(this.filePath); } catch {}
        }
    }
    
    private init(context: vscode.ExtensionContext) {
        try {
            const base = context.globalStorageUri?.fsPath || path.join(os.tmpdir(), 'cotab');
            const dir = path.join(base, 'keepalive');
            fs.mkdirSync(dir, { recursive: true });
            this.dir = dir;
            this.filePath = path.join(dir, `instance-${this.instanceId}.hb`);
        }
        catch (e) {
            logDebug(`initKeepaliveEditor failed: ${e}`);
        }
    }

    private getActiveInstanceCount(): number {
        if (!this.dir) {
            return 1;
        }

        try {
            const files = fs.readdirSync(this.dir).filter(f => /^instance-.*\.hb$/.test(f));
            const now = Date.now();
            const active: string[] = [];
            
            files.forEach(f => {
                try {
                    const full = path.join(this.dir!, f);
                    const stat = fs.statSync(full);
                    const isActive = now - stat.mtimeMs <= this.staleMs;
                    
                    if (isActive) {
                        active.push(f);
                    }
                    else {
                        // Remove stale files
                        fs.unlinkSync(full);
                        logDebug(`Removed stale keepalive file: ${f}`);
                    }
                }
                catch (e) {
                    logDebug(`Failed to process keepalive file ${f}: ${e}`);
                }
            });
            
            return Math.max(active.length, 1);
        }
        catch (e) {
            logDebug(`getActiveInstanceCount failed: ${e}`);
            return 1;
        }
    }
};

class KeepaliveServer implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private filePath: string | null = null;
    private readonly aliveMs = 60000; // 60s
    
    constructor(context: vscode.ExtensionContext) {
        this.init(context);
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    private keepaliveTime: number = 0;
    public async keepalive(): Promise<void> {
        const now = Date.now();
        if ((now - this.keepaliveTime) < 1 * 1000) return;
        this.keepaliveTime = now;
        try {
            // Check if the file exists
            try {
                await fs.promises.access(this.filePath!);
            }
            catch {
                // File does not exist, create it
                await fs.promises.writeFile(this.filePath!, '');
            }
            // Update timestamp only
            await fs.promises.utimes(this.filePath!, new Date(), new Date());
        }
        catch (e) {
            logDebug(`keepalive update failed: ${e}`);
        }
    }

    public async isAlive(): Promise<boolean> {
        // Check if the server is alive by verifying the file exists and is not stale
        const now = Date.now();
        try {
            const stat = await fs.promises.stat(this.filePath!);
            const alive = (now - stat.mtimeMs) <= getConfig().serverAutoStopOnIdleTime * 1000;
            return alive;
        } catch (e) {
            logDebug(`Failed to check server alive status: ${e}`);
        }
        return false;
    }

    private init(context: vscode.ExtensionContext) {
        try {
            const base = context.globalStorageUri?.fsPath || path.join(os.tmpdir(), 'cotab');
            const dir = path.join(base, 'keepalive');
            fs.mkdirSync(dir, { recursive: true });
            this.filePath = path.join(dir, `server`);
        }
        catch (e) {
            logDebug(`initKeepalive failed: ${e}`);
        }
    }
};

class ServerManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private keepaliveEditor: KeepaliveEditor | null = null;
    private keepaliveServer: KeepaliveServer | null = null;
    private isManualStoped: boolean = false;
    private autoStopServerTimer: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.keepaliveEditor = new KeepaliveEditor(context);
        this.disposables.push(this.keepaliveEditor);

        this.keepaliveServer = new KeepaliveServer(context);
        this.disposables.push(this.keepaliveServer);

        this.startAutoStopServer();
        this.disposables.push({
            dispose: () => {
                this.stopAutoStopServer();
            }
        })
    }

    public dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables.length = 0;
    }

    /**
     * Auto-stop handling (when VSCode exits)
     * Ensure no failure due to disposal order; called from extension.ts.
     */
    public autoStopServerOnExit() {
        if (getConfig().serverAutoStart) {
            if (!this.keepaliveEditor!.isOtherVSCodeRunning()) {
                logInfo('This is the last VS Code instance, stopping server...');
                this.stopServerForceSync();
            }
        }
    }

    public async startServer() {
        if (! await terminalCommand.isRunningLocalLlamaServer()) {
            terminalCommand.runLocalLlamaServer();
        }
        this.keepaliveServer!.keepalive();
        this.isManualStoped = false;    // clear flug
    }
    
    public async stopServer(fromManual: boolean = false) {
        this.isManualStoped = fromManual;

        if (!(await terminalCommand.isRunningLocalLlamaServer())) {
            return;
        }

        await terminalCommand.stopLocalLlamaServer();
    }
    
    private stopServerForceSync() {
        this.isManualStoped = false;

        terminalCommand.stopLocalLlamaServerSync();
    }

    public keepalive() {
        this.keepaliveServer!.keepalive();
    }

    /**
     * Auto-start during completion
     */
    public async autoStartOnCompletion() {
        if (getConfig().serverAutoStart && !this.isManualStoped) {
            if (!(await terminalCommand.isRunningLocalLlamaServerWithCache())) {
                logInfo('Auto-starting server for completion...');
                await this.startServer();
            }
        }
    }

    private startAutoStopServer() {
        this.autoStopServerTimer = setInterval(async () => {
            if ((await terminalCommand.isRunningLocalLlamaServerWithCache()) &&
                ! (await this.keepaliveServer!.isAlive())) {
                logInfo('Automatically stops the server...');
                this.stopServer();
            }
        }, 10000);
    }

    private stopAutoStopServer() {
        if (this.autoStopServerTimer) {
            clearTimeout(this.autoStopServerTimer);
            this.autoStopServerTimer = null;
        }
    }
}


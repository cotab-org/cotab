import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import axios from 'axios';
import { logInfo, logWarning, logError, logServer, logTerminal, showLogWindow } from './logger';

// Register helper (mirrors progressGutterIconManager)
export function registerTerminalCommand(disposables: vscode.Disposable[]): void {
    terminalCommand = new TerminalCommand();
    disposables.push(terminalCommand);
}

export let terminalCommand: TerminalCommand;

// Singleton instance (created eagerly so that external calls work even if not registered)
class TerminalCommand implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private InstallTerminal: vscode.Terminal | undefined;
    private ServerProcess!: cp.ChildProcessWithoutNullStreams;
    
    private async isWindowsNvidiaGpuPresent(): Promise<boolean> {
        if (process.platform !== 'win32') return false;
        try {
            const exec = util.promisify(cp.exec);
            const { stdout } = await exec(`powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Where-Object Name -match 'NVIDIA' | Select-Object -First 1 -ExpandProperty Name)"`);
            return (stdout || '').trim().length > 0;
        } catch (_) {
            return false;
        }
    }

    private async isWindowsAmdGpuPresent(): Promise<boolean> {
        if (process.platform !== 'win32') return false;
        try {
            const exec = util.promisify(cp.exec);
            const { stdout } = await exec(`powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Where-Object Name -match 'AMD|Radeon' | Select-Object -First 1 -ExpandProperty Name)"`);
            return (stdout || '').trim().length > 0;
        } catch (_) {
            return false;
        }
    }

    private getInstallBaseDir(): string {
        if (process.platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
            return path.join(localAppData, 'Cotab', 'llama-cpp');
        }
        if (process.platform === 'darwin') {
            return path.join(os.homedir(), 'Library', 'Application Support', 'Cotab', 'llama-cpp');
        }
        return path.join(os.homedir(), '.local', 'share', 'Cotab', 'llama-cpp');
    }

    private async getLatestLlamaCppRelease(): Promise<any> {
        try {
            const response = await axios.get('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest');
            return response.data;
        } catch (error) {
            logError(`Failed to fetch latest llama.cpp release: ${error}`);
            throw error;
        }
    }

    private async downloadFile(url: string, filePath: string): Promise<void> {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const writer = fs.createWriteStream(filePath);
        try {
            const response = await axios.get(url, {
                responseType: 'stream',
                headers: {
                    'User-Agent': 'cotab-extension',
                    'Accept': 'application/octet-stream'
                },
                maxRedirects: 5,
                timeout: 600000 // 10 minutes
            });

            await new Promise<void>((resolve, reject) => {
                response.data.pipe(writer);
                let finished = false;
                writer.on('finish', () => { finished = true; resolve(); });
                writer.on('error', (err) => { if (!finished) reject(err); });
                response.data.on('error', (err: any) => { if (!finished) reject(err); });
            });
        } catch (error) {
            try { writer.close(); } catch (_) {}
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
            throw error;
        }
    }

    private async extractZip(zipPath: string, extractPath: string): Promise<void> {
        try {
            const exec = util.promisify(cp.exec);
            if (process.platform === 'win32') {
                // Use PowerShell to extract zip
                await exec(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`);
            } else {
                // Use unzip for Unix-like systems
                await exec(`unzip -o '${zipPath}' -d '${extractPath}'`);
            }
        } catch (error) {
            logError(`Failed to extract zip file: ${error}`);
            throw error;
        }
    }

    private findFileRecursive(rootDir: string, targetFileName: string): string | undefined {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(rootDir, entry.name);
            if (entry.isFile() && entry.name.toLowerCase() === targetFileName.toLowerCase()) {
                return fullPath;
            }
        }
        for (const entry of entries) {
            const fullPath = path.join(rootDir, entry.name);
            if (entry.isDirectory()) {
                const found = this.findFileRecursive(fullPath, targetFileName);
                if (found) return found;
            }
        }
        return undefined;
    }

    private async downloadAndInstallWindowsBinaries(kind: 'cuda' | 'vulkan' | 'cpu'): Promise<boolean> {
        try {
            // show log window for installation progress
            try { showLogWindow(true); } catch (_) {}
            logTerminal('[Install] Fetching latest llama.cpp release information...');
            const release = await this.getLatestLlamaCppRelease();

            let mainBinary: any | undefined;
            let cudartBinary: any | undefined;

            if (kind === 'cuda') {
                mainBinary = release.assets.find((asset: any) =>
                    !asset.name.includes('cudart-llama-bin-win-cuda-') &&
                    asset.name.includes('llama-b') &&
                    asset.name.includes('bin-win-cuda-') &&
                    asset.name.includes('-x64.zip')
                );
                cudartBinary = release.assets.find((asset: any) =>
                    asset.name.includes('cudart-llama-bin-win-cuda-') &&
                    asset.name.includes('-x64.zip')
                );
                if (!mainBinary || !cudartBinary) {
                    throw new Error('CUDA binaries not found in latest release');
                }
            } else if (kind === 'vulkan') {
                mainBinary = release.assets.find((asset: any) =>
                    asset.name.includes('llama-b') &&
                    asset.name.includes('bin-win-vulkan-x64.zip')
                );
                if (!mainBinary) {
                    throw new Error('Vulkan binaries not found in latest release');
                }
            }

            // fallback to CPU
            if (kind === 'cpu') {
                mainBinary = mainBinary || release.assets.find((asset: any) =>
                    asset.name.includes('llama-b') &&
                    asset.name.includes('bin-win-cpu-x64.zip')
                );
                if (!mainBinary) {
                    throw new Error('Windows x64 CPU binaries not found in latest release');
                }
            }

            // Create user install directory for llama.cpp binaries (clean first)
            const installDir = this.getInstallBaseDir();
            try {
                if (fs.existsSync(installDir)) {
                    logTerminal('[Install] Cleaning existing install directory...');
                    fs.rmSync(installDir, { recursive: true, force: true });
                }
            } catch (_) {}
            fs.mkdirSync(installDir, { recursive: true });

            // Download llama.cpp binary
            logTerminal(`[Install] Downloading ${mainBinary.name}...`);
            const mainZipPath = path.join(installDir, mainBinary.name);
            await this.downloadFile(mainBinary.browser_download_url, mainZipPath);

            // Extract llama.cpp binary
            logTerminal('[Install] Extracting llama.cpp archive...');
            await this.extractZip(mainZipPath, installDir);
            
            try { fs.unlinkSync(mainZipPath); } catch (_) {}

            // Download CUDA runtime
            if (kind === 'cuda' && cudartBinary) {
                logTerminal(`[Install] Downloading ${cudartBinary.name}...`);
                const cudartZipPath = path.join(installDir, cudartBinary.name);
                await this.downloadFile(cudartBinary.browser_download_url, cudartZipPath);
                
                // Extract CUDA runtime
                const serverExePath = this.findFileRecursive(installDir, 'llama-server.exe');
                if (!serverExePath) throw new Error('Extracted llama.cpp archive does not contain llama-server executable');
                const serverDir = path.dirname(serverExePath);

                logTerminal('[Install] Extracting CUDA runtime into server directory...');
                await this.extractZip(cudartZipPath, serverDir);
                
                try { fs.unlinkSync(cudartZipPath); } catch (_) {}
            }

            logTerminal('[Install] llama.cpp installation successfully!');
            return true;
        } catch (error) {
            logError(`[Install] Failed to install llama.cpp: ${error}`);
            return false;
        }
    }
    
    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables.length = 0;
    }
    
    killInstallTerminal(): void {
        if (this.InstallTerminal) {
            this.InstallTerminal.dispose();
            this.InstallTerminal = undefined;
        }
    }

    async command(terminal: vscode.Terminal | undefined, command: string, waitable: boolean = false):
        Promise<{ success: boolean, stdout: string; stderr: string; terminal: vscode.Terminal | undefined }> {
        //this.kill();
        //let terminal = vscode.window.terminals.find((t) => t.name === termName);
        if (!terminal) {
            terminal = vscode.window.createTerminal('Cotab');
        }
        terminal.show(true);
        terminal.sendText(`echo "Executing: ${command} (please wait until internal processing completes)"`);
        
        try {
            if (waitable) {
                const exec = util.promisify(cp.exec);
                // Execute command programmatically for reliable output
                const { stdout, stderr } = await exec(command);
                // Show output in   terminal
                terminal.sendText(`echo "Command completed successfully"`);
                terminal.sendText(`echo "Output: ${stdout.trim()}"`);
                
                return { success: true, stdout, stderr, terminal };
            }
            else {
                terminal.sendText(command);

                const stdout = "";
                const stderr = "";
                return { success: true, stdout, stderr, terminal };
            }
        }
        catch (error: any) {
            terminal.sendText(`echo "Command failed: ${error.message}"`);
            const stdout = error.stdout + '\n' + error.stderr;
            terminal.sendText(`echo "Output: ${stdout.trim()}"`);
            return { success: false, stdout, stderr: error.message, terminal };
        }
        finally {
        }
    }

    async isExistCommand(cmd: string): Promise<boolean> {
        try {
            const exec = util.promisify(cp.exec);
            let checkCommand: string;
            
            if (process.platform === 'win32') {
                // Use where command for Windows
                checkCommand = `where ${cmd}`;
            } else {
                // Use which command for Unix-like systems
                checkCommand = `which ${cmd}`;
            }
            
            const { stdout, stderr } = await exec(checkCommand);
            
            // If command is found, path is output to stdout
            // If error occurs or command is not found, output goes to stderr
            return stdout.trim().length > 0 && stderr.trim().length === 0;
        }
        catch (error) {
            // Exception occurs when command is not found
            return false;
        }
    }

    public async isInstalledLocalLlamaServer(): Promise<boolean> {
        try {
            // Prefer user-installed CUDA binaries on Windows
            if (process.platform === 'win32') {
                const installDir = this.getInstallBaseDir();
                const serverPath = this.findFileRecursive(installDir, 'llama-server.exe');
                if (serverPath && fs.existsSync(serverPath)) {
                    return true;
                }
                // Fallback: system PATH
                if (await this.isExistCommand('llama-server.exe')) return true;
                return await this.isExistCommand('llama-server');
            }
            // Non-Windows: check system PATH
            return await this.isExistCommand('llama-server');
        } catch (_) {
            return false;
        }
    }

    /**
     * Install llama.cpp via integrated terminal
     * not waitable command. because terminal is not visible to user. so user input is required.
     */
    public async installLocalLlamaCpp() {
        if (process.platform != 'darwin' && process.platform != 'win32') {
            vscode.window.showInformationMessage("Automatic install/upgrade is supported only for Mac and Windows for now. Download llama.cpp package manually and add the folder to the path. Visit github.com/ggml-org/llama.vscode/wiki for details.");
            return false;
        }
        else {
            await this.killInstallTerminal();
            await this.stopLocalLlamaServer();
            let terminalCommand = process.platform === 'darwin' ? "brew install llama.cpp" : process.platform === 'win32' ? "winget install llama.cpp" : "";
            const isWin = process.platform === 'win32';
            const hasNvidia = await this.isWindowsNvidiaGpuPresent();
            const hasAmd = await this.isWindowsAmdGpuPresent();
            if (isWin && hasNvidia) {
                // Download CUDA binaries for Windows with NVIDIA GPU
                const success = await this.downloadAndInstallWindowsBinaries('cuda');
                if (success) {
                    return true;
                } else {
                    logError(`Failed to download CUDA binaries.`);
                    return false;
                }
            } else if (isWin && hasAmd) {
                // Download Vulkan (or CPU fallback) binaries for Windows with AMD/Radeon GPU
                const success = await this.downloadAndInstallWindowsBinaries('vulkan');
                if (success) {
                    return true;
                } else {
                    logError(`Failed to download Vulkan/CPU binaries.`);
                    return false;
                }
            }
            else {
                // not waitable command. because terminal is not visible to user. so user input is required.
                const {success, stdout, terminal} = await this.command(this.InstallTerminal, terminalCommand, false);
                terminal?.sendText(`echo "##############################"`);
                terminal?.sendText(`echo "Installation process completed!"`);
                terminal?.sendText(`echo "Please click the 'Start Local Server' button"`);
                terminal?.sendText(`echo "from the Cotab status bar menu to start the server!"`);
                terminal?.sendText(`echo "##############################"`);
                this.InstallTerminal = terminal;
            }
            return true;
        }
    }

    public async updateLocalLlamaCpp() {
        await this.installLocalLlamaCpp();
    }

    /**
     * Uninstall llama.cpp via integrated terminal
     * not waitable command. because terminal is not visible to user. so user input is required.
     */
    public async uninstallLocalLlamaCpp() {
        if (process.platform != 'darwin' && process.platform != 'win32') {
            vscode.window.showInformationMessage("Automatic uninstall is supported only for Mac and Windows for now. Please uninstall llama.cpp manually. Visit github.com/ggml-org/llama.vscode/wiki for details.");
            return false;
        }
        else {
            await this.killInstallTerminal();
            await this.stopLocalLlamaServer();

            // Prefer removing user-installed directory first (all platforms)
            const installDir = this.getInstallBaseDir();
            try { showLogWindow(true); } catch (_) {}
            if (fs.existsSync(installDir)) {
                try {
                    logTerminal(`[Uninstall] Uninstalling llama.cpp from user install directory: ${installDir}`);
                    fs.rmSync(installDir, { recursive: true, force: true });
                    logTerminal(`[Uninstall] Uninstalled llama.cpp from user install directory.`);
                    return true;
                } catch (err) {
                    logError(`[Uninstall] Failed to uninstall llama.cpp from user install directory: ${err}`);
                    return false;
                }
            }
            else {
                // If on macOS/Windows, also attempt package-manager uninstall to clean system installs
                let terminalCommand = process.platform === 'darwin' ? "brew uninstall llama.cpp" : process.platform === 'win32' ? "winget uninstall llama.cpp" : "";
                if (terminalCommand) {
                    const {success, stdout, terminal} = await this.command(this.InstallTerminal, terminalCommand, false);
                    terminal?.sendText(`echo "##############################"`);
                    terminal?.sendText(`echo "Uninstallation process completed!"`);
                    terminal?.sendText(`echo "llama.cpp has been removed from your system."`);
                    terminal?.sendText(`echo "##############################"`);
                    this.InstallTerminal = terminal;
                    return success;
                }
            }
            return true;
        }
    }

    public runLocalLlamaServer(args: string[]) {
        let command: string;
        let cwd: string | undefined;
        
        if (process.platform === 'win32') {
            // Prefer user-installed server (CUDA/Vulkan/CPU) in install dir
            const installDir = this.getInstallBaseDir();
            const serverPath = this.findFileRecursive(installDir, 'llama-server.exe');

            if (serverPath && fs.existsSync(serverPath)) {
                command = serverPath;
                cwd = path.dirname(serverPath);
                logInfo('Using user-installed llama-server');
            } else {
                command = 'llama-server.exe';
                logInfo('Using system llama-server');
            }
        } else {
            command = 'llama-server';
        }
        
        this.ServerProcess = cp.spawn(command, args, {
            detached: false,
            stdio: 'pipe',
            shell: process.platform === 'win32',
            cwd: cwd
        });

        this.ServerProcess.on('error', (err) => {
            logError(`llama-server spawn error: ${err?.message || err}`);
            vscode.window.showErrorMessage(`llama-server execution error: ${err?.message || err}`);
        });
        this.ServerProcess.on('exit', (code, signal) => {
            logWarning(`llama-server exited: code=${code} signal=${signal}`);
        });
        if (this.ServerProcess.stdout) {
            this.ServerProcess.stdout.on('data', (data: Buffer) => {
                const text = process.platform === 'win32' 
                    ? data.toString('utf8') 
                    : data.toString();
                logServer(`${text}`);
            });
        }
        if (this.ServerProcess.stderr) {
            this.ServerProcess.stderr.on('data', (data: Buffer) => {
                const text = process.platform === 'win32' 
                    ? data.toString('utf8') 
                    : data.toString();
                logServer(`${text}`);
            });
        }
    }

    public detacheLocalLlamaServer() {
        if (this.ServerProcess && !this.ServerProcess.killed) {
            this.ServerProcess.unref();
        }
    }

    public async isRunningLocalLlamaServer(): Promise<boolean> {
        try {
            const exec = util.promisify(cp.exec);
            if (process.platform === 'win32') {
                const { stdout } = await exec('tasklist /FI "IMAGENAME eq llama-server.exe"');
                return stdout?.toLowerCase().includes('llama-server.exe') ?? false;
            } else {
                // Unix-like: check presence of process
                await exec('pgrep -f llama-server');
                return true;
            }
        }
        catch (_) {
            return false;
        }
    }

    public async stopLocalLlamaServer(): Promise<void> {
        try {
            const exec = util.promisify(cp.exec);
            if (process.platform === 'win32') {
                await exec('taskkill /IM llama-server.exe /F');
            } else {
                await exec('pkill -f llama-server');
            }
        }
        catch (_) {
            // Ignore if process does not exist
        }
    }
}

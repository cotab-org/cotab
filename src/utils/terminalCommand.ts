import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import axios from 'axios';
import { getConfig } from '../utils/config';
import { isLocalhost } from '../llm/llmUtils';
import { OSInfo, GetOSInfo } from '../utils/cotabUtil';
import { logInfo, logWarning, logError, logServer, logTerminal, showLogWindow } from './logger';
import { requestUpdateCotabMenuUntilChanged } from '../ui/menuIndicator';

// Register helper (mirrors progressGutterIconManager)
export function registerTerminalCommand(disposables: vscode.Disposable[]): void {
    terminalCommand = new TerminalCommand();
    disposables.push(terminalCommand);
}

export let terminalCommand: TerminalCommand;

const llamaServerExe = (process.platform === 'win32') ? 'llama-server.exe' : 'llama-server';

// Singleton instance (created eagerly so that external calls work even if not registered)
class TerminalCommand implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private InstallTerminal: vscode.Terminal | undefined;
    private ServerProcess!: cp.ChildProcessWithoutNullStreams;
    private serverRunningCache: { result: boolean; timestamp: number } | null = null;

    private getInstallBaseDir(): string {
        if (process.platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
            return path.join(localAppData, 'Cotab', 'llama.cpp');
        }
        if (process.platform === 'darwin') {
            return path.join(os.homedir(), 'Library', 'Application Support', 'Cotab', 'llama.cpp');
        }
        return path.join(os.homedir(), '.local', 'share', 'Cotab', 'llama.cpp');
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

    public isSupportMyInstall(osInfo: OSInfo): boolean {
        const releaseLlamacppName = this.GetReleaseLlamaCppName(osInfo);
        return releaseLlamacppName !== '' ? true : false;
    }

    private GetReleaseLlamaCppName(osInfo: OSInfo): string {
        if (osInfo.platform === 'win') {
            if (osInfo.cpu === 'x64') {
                if (osInfo.gpu === 'cuda' || osInfo.gpu === 'vulkan' || osInfo.gpu === 'none') {
                    return `bin-${osInfo.platform}-${osInfo.gpu}-${osInfo.cpu}.zip`;
                }
            }
        }
        else if (osInfo.platform === 'macos') {
            if (osInfo.cpu === 'x64' || osInfo.cpu === 'arm64') {
                return `bin-${osInfo.platform}-${osInfo.cpu}.zip`;
            }
        }
        else if (osInfo.platform === 'ubuntu') {
            if (osInfo.cpu === 'x64') {
                return `bin-${osInfo.platform}-vulkan-${osInfo.cpu}.zip`;
            }
        }
        return '';
    }
    private getDownloadBinName(osInfo: OSInfo): {
        mainName: string;
        cudartName: string;
    } {
        const cudaVer = '-12.4';
        
        ///// win
        // like `b7216/cudart-llama-bin-win-cuda-12.4-x64.zip`
        // like `b7216/llama-b7216-bin-win-cuda-12.4-x64.zip`
        // like `b7216/llama-b7216-bin-win-vulkan-x64.zip`
        ///// mac
        // like `b7216/llama-b7216-bin-macos-x64.zip`
        ///// ubuntu
        // like `llama-b7216-bin-ubuntu-vulkan-x64.zip`
        
        const platform = `-${osInfo.platform}`;
        let gpu = (osInfo.gpu === 'none' || osInfo.gpu === 'unknown') ? '' : `-${osInfo.gpu}`;
        const cpu = `-${osInfo.cpu}`;
        let ext = '.zip'
        let cudartName = '';
        if (osInfo.platform === 'win' && osInfo.gpu === 'cuda') {
            gpu = `-${osInfo.gpu}${cudaVer}`;

            cudartName = `bin${platform}${gpu}${cpu}${ext}`;
            
        }
        else if (osInfo.platform === 'ubuntu') {
            //ext = '.tar.gz';
        }

        const mainName = `bin${platform}${gpu}${cpu}${ext}`;
        return {mainName, cudartName};
    }

    private async getDownloadURL(osInfo: OSInfo): Promise<{
        mainBinary: any | undefined;
        cudartBinary: any | undefined;
    }> {
        const config = getConfig();
        if (config.llamaCppVersion === 'Stable') {
            let mainBinary: any | undefined;
            let cudartBinary: any | undefined;
            
            //const tag = 'b6989';
            const tag = 'b7010';

            const baseUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/';

            const {mainName, cudartName} = this.getDownloadBinName(osInfo);

            if (cudartName !== '') {
                const cudartDLName = `${tag}/cudart-llama-${cudartName}`;
                cudartBinary = {
                    name: cudartDLName,
                    browser_download_url: baseUrl + cudartDLName,
                }
            }

            const dlName = `${tag}/llama-${tag}-${mainName}`;
            mainBinary = {
                name: dlName,
                browser_download_url: baseUrl + dlName,
            }

            return {mainBinary, cudartBinary};
        }
        else {
            return this.getDownloadURLInternal(osInfo);
        }
    }

    private async getDownloadURLInternal(osInfo: OSInfo): Promise<{
        mainBinary: any | undefined;
        cudartBinary: any | undefined;
    }> {
        let mainBinary: any | undefined;
        let cudartBinary: any | undefined;

        const release = await this.getLatestLlamaCppRelease();

        if (osInfo.platform === 'win' && osInfo.gpu === 'cuda') {
            mainBinary = release.assets.find((asset: any) =>
                !asset.name.includes(`cudart-llama-bin-${osInfo.platform}-${osInfo.gpu}-`) &&
                asset.name.includes('llama-b') &&
                asset.name.includes(`bin-${osInfo.platform}-${osInfo.gpu}-`) && // cuda is included version
                asset.name.includes(`-${osInfo.cpu}.zip`)
            );
            cudartBinary = release.assets.find((asset: any) =>
                asset.name.includes(`cudart-llama-bin-${osInfo.platform}-${osInfo.gpu}-`) && // cuda is included version
                asset.name.includes(`-${osInfo.cpu}.zip`)
            );
            if (!mainBinary || !cudartBinary) {
                throw new Error('CUDA binaries not found in latest release');
            }
        }
        else {
            const releaseLlamacppName = this.GetReleaseLlamaCppName(osInfo);
            mainBinary = release.assets.find((asset: any) =>
                asset.name.includes('llama-b') &&
                asset.name.includes(releaseLlamacppName)
            );
            if (!mainBinary) {
                throw new Error(`${osInfo.platform}-${osInfo.gpu}-${osInfo.cpu} binaries not found in latest release`);
            }
        }
        
        return { mainBinary, cudartBinary };
    }

    private async downloadAndInstallWindowsBinaries(osInfo: OSInfo): Promise<'success' | 'error' | 'notsupported'> {
        try {
            if (! this.isSupportMyInstall(osInfo)) {
                return 'notsupported';
            }

            // show log window for installation progress
            showLogWindow(true);
            logTerminal('[Install] Fetching latest llama.cpp release information...');

            const {mainBinary, cudartBinary} = await this.getDownloadURL(osInfo);

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
            if (osInfo.gpu === 'cuda' && cudartBinary) {
                logTerminal(`[Install] Downloading ${cudartBinary.name}...`);
                const cudartZipPath = path.join(installDir, cudartBinary.name);
                await this.downloadFile(cudartBinary.browser_download_url, cudartZipPath);
                
                // Extract CUDA runtime
                const serverExePath = this.findFileRecursive(installDir, llamaServerExe);
                if (!serverExePath) throw new Error('Extracted llama.cpp archive does not contain llama-server executable');
                const serverDir = path.dirname(serverExePath);

                logTerminal('[Install] Extracting CUDA runtime into server directory...');
                await this.extractZip(cudartZipPath, serverDir);
                
                try { fs.unlinkSync(cudartZipPath); } catch (_) {}
            }

            logTerminal('[Install] ########################################');
            logTerminal('[Install] # llama.cpp installation successfully! #');
            logTerminal('[Install] ########################################');
            return 'success';
        } catch (error) {
            logError(`[Install] Failed to install llama.cpp: ${error}`);
            return 'error';
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
            const osInfo = await GetOSInfo();
            // Prefer user-installed CUDA binaries on Windows
            if (this.isSupportMyInstall(osInfo)) {
                const installDir = this.getInstallBaseDir();
                const serverPath = this.findFileRecursive(installDir, llamaServerExe);
                if (serverPath && fs.existsSync(serverPath)) {
                    return true;
                }
                // Fallback: system PATH
                if (await this.isExistCommand(llamaServerExe)) return true;
                return await this.isExistCommand('llama-server');
            }
            // Non-Windows: check system PATH
            return await this.isExistCommand(llamaServerExe);
        } catch (_) {
            return false;
        }
    }

    /**
     * Install llama.cpp via integrated terminal
     * not waitable command. because terminal is not visible to user. so user input is required.
     */
    public async installLocalLlamaCpp(): Promise<boolean> {
        try {
            await this.killInstallTerminal();
            await this.stopLocalLlamaServer();

            const osInfo = await GetOSInfo();
            const result = (this.isSupportMyInstall(osInfo))
                            ? await this.downloadAndInstallWindowsBinaries(osInfo)
                            : 'notsupported';
            
            if (result === 'success') {
                return true;
            }
            else if (result === 'error') {
                logError(`[Install] Failed to download binaries.`);
                return false;
            }
            else if (result === 'notsupported' && osInfo.platform === 'macos') {
                // not waitable command. because terminal is not visible to user. so user input is required.
                const terminalCommand = process.platform === 'darwin' ? "brew install llama.cpp" : process.platform === 'win32' ? "winget install llama.cpp" : "";
                const {success, stdout, terminal} = await this.command(this.InstallTerminal, terminalCommand, false);
                terminal?.sendText(`echo "##############################"`);
                terminal?.sendText(`echo "Installation process completed!"`);
                terminal?.sendText(`echo "Please click the 'Start Local Server' button"`);
                terminal?.sendText(`echo "from the Cotab status bar menu to start the server!"`);
                terminal?.sendText(`echo "##############################"`);
                this.InstallTerminal = terminal;

                return false;   // must false;
            }
            else {
                vscode.window.showInformationMessage("Automatic install/upgrade is supported only for Mac and Windows for now. Download llama.cpp package manually and add the folder to the path. Visit github.com/ggml-org/llama.vscode/wiki for details.");
                return false;
            }
        } finally {
            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
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
        try {
            const osInfo = await GetOSInfo();
            const isMyInstallSupported = this.isSupportMyInstall(osInfo);

            await this.killInstallTerminal();
            await this.stopLocalLlamaServer();
            
            if (isMyInstallSupported) {
                // Prefer removing user-installed directory first (all platforms)
                const installDir = this.getInstallBaseDir();
                showLogWindow(true);
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
            }
            else if (osInfo.platform === 'macos') {
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
            else {
                vscode.window.showInformationMessage("Automatic uninstall is supported only for Mac and Windows for now. Please uninstall llama.cpp manually. Visit github.com/ggml-org/llama.vscode/wiki for details.");
                return false;
            }
            return true;
        }
        finally {
            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
        }
    }

    public runLocalLlamaServer(): void {
        const config = getConfig();
        const args = config.localServerArg.split(' ');
        if (!args.includes('-c') && !args.includes('--ctx-size')) {
            const contextSize = config.localServerContextSize;
            args.push(`-c`, `${contextSize}`);
        }
        this.runLocalLlamaServerInternal(args);
    }

    public async runLocalLlamaServerInternal(args: string[]) {
        try {
            let command: string;
            let cwd: string | undefined;
            
            const osInfo = await GetOSInfo();
            if (osInfo.platform === 'win' ||
                osInfo.platform === 'ubuntu' ||
                osInfo.platform === 'macos') {
                // Prefer user-installed server (CUDA/Vulkan/CPU) in install dir
                const installDir = this.getInstallBaseDir();
                const serverPath = this.findFileRecursive(installDir, llamaServerExe);

                if (serverPath && fs.existsSync(serverPath)) {
                    command = serverPath;
                    cwd = path.dirname(serverPath);
                    logInfo('Using user-installed llama-server');
                } else {
                    command = llamaServerExe;
                    logInfo('Using system llama-server');
                }
            } else {
                command = llamaServerExe;
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
        } finally {
            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
        }
    }

    public detacheLocalLlamaServer() {
        if (this.ServerProcess && !this.ServerProcess.killed) {
            this.ServerProcess.unref();
        }
    }

    public async isRunningLocalLlamaServer(): Promise<boolean> {
        const result = await this.isRunningLocalLlamaServerInternal();
        // Save the result to cache
        this.serverRunningCache = {
            result: result,
            timestamp: Date.now()
        };
        return result;
    }
    private async isRunningLocalLlamaServerInternal(): Promise<boolean> {
        try {
            const exec = util.promisify(cp.exec);
            if (process.platform === 'win32') {
                const { stdout } = await exec(`tasklist /FI "IMAGENAME eq ${llamaServerExe}"`);
                return stdout?.toLowerCase().includes(llamaServerExe) ?? false;
            }
            else {
                // Unix-like: check presence of process by inspecting stdout, not exception
                const cmd = process.platform === 'darwin'
                    ? 'ps -axo pid=,comm=,command='
                    : 'ps -eo pid=,comm=,args=';
                const { stdout } = await exec(cmd);
                const lines = (stdout || '').split('\n');
                for (const line of lines) {
                    const text = line.trim();
                    if (!text) continue;
                    if (text.includes(llamaServerExe)) {
                        return true;
                    }
                }
                return false;
            }
        }
        catch (_) {
            return false;
        }
    }
    
    public async isRunningLocalLlamaServerWithCache(): Promise<boolean> {
        const { valid, result } = this.isRunningLocalLlamaServerCache();

        if (valid) {
            return result;
        }
        else {
            // If cache is invalid or not present, perform the actual check
            return await this.isRunningLocalLlamaServer();
        }
    }
    
    private isRunningLocalLlamaServerCache(): {valid: boolean; result: boolean}  {
        const cacheTimeout = 10 * 1000; // 10 seconds
        
        // If cache is valid, return the cached result
        if (this.serverRunningCache && (Date.now() - this.serverRunningCache.timestamp) < cacheTimeout) {
            return { valid: true, result: this.serverRunningCache.result };
        }
        return { valid: false, result: false };
    }

    private getApiBaseURL(): string {
        const config = getConfig();
        if (config.provider === 'OpenAICompatible') {
            return config.apiBaseURL;
        } else {
            return config.apiBaseURL;
        }
    }

    private isEnableServerLayCache: boolean | undefined = undefined;

    // get server status
    public isEnableServerLazy(): boolean {
        const isBaseURLLocalHost = isLocalhost(this.getApiBaseURL());

        // If the API base URL is not localhost, server enabled.
        if (!isBaseURLLocalHost) {
            this.isEnableServerLayCache = true;
        }
        else {
            // use cache result.
            const { valid, result } = this.isRunningLocalLlamaServerCache();
            if (valid) {
                this.isEnableServerLayCache = result;
            }
            // If cache is stale, schedule a background check to refresh the server status
            // And return the prev result.
            else {
                // call check for update cache.
                setTimeout(async () => { this.isRunningLocalLlamaServer(); }, 0);
            }
        }
        return this.isEnableServerLayCache ?? false;
    }

    public async stopLocalLlamaServer(): Promise<void> {
        try {
            const exec = util.promisify(cp.exec);
            if (process.platform === 'win32') {
                await exec('taskkill /IM llama-server.exe /F');
            } else {
                await exec('pkill -f llama-server');
                await new Promise(r => setTimeout(r, 2000));
            }
            logInfo('Server stopped successfully');
        }
        catch (_) {
            // Ignore if process does not exist
            return;
        }
        finally {
            // call check for update cache.
            this.isRunningLocalLlamaServer();

            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
        }
    }

    public stopLocalLlamaServerSync(): void {
        try {
            if (process.platform === 'win32') {
                cp.execSync('taskkill /IM llama-server.exe /F', { stdio: 'ignore' });
            } else {
                cp.execSync('pkill -f llama-server', { stdio: 'ignore' });
            }
            logInfo('Server stopped successfully');
        }
        catch (_) {
            // Ignore if process does not exist
            return;
        }
        finally {
            // Note: isRunningLocalLlamaServer() is async, so we skip it in sync version
            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
        }
    }
}

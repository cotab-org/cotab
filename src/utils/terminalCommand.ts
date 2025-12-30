import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import * as cp from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { getConfig } from '../utils/config';
import { localServerPresetArgs } from './localServerPresets';
import { isCotabLocalhost } from '../llm/llmUtils';
import { OSInfo, getOsInfo } from '../utils/cotabUtil';
import { logInfo, logWarning, logError, logServer, logTerminal, showLogWindow } from './logger';
import { requestUpdateCotabMenuUntilChanged } from '../ui/menuIndicator';
import { updateLlamaCppVersion } from './systemConfig';
import { YamlConfigMode } from '../utils/yamlConfig';

// Configure nls and load message bundle
const localize = nls.config({ bundleFormat: nls.BundleFormat.standalone })(path.join(__dirname, 'utils/terminalCommand'));

// Register helper (mirrors progressGutterIconManager)
export function registerTerminalCommand(disposables: vscode.Disposable[]): void {
    terminalCommand = new TerminalCommand();
    disposables.push(terminalCommand);
}

export let terminalCommand: TerminalCommand;

export const stableLlamaCppVersion = 'b7314';

const llamaServerExe = (process.platform === 'win32') ? 'llama-server.exe' : 'llama-server';

// Singleton instance (created eagerly so that external calls work even if not registered)
class TerminalCommand implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private installTerminal: vscode.Terminal | undefined;
    private serverProcess!: cp.ChildProcessWithoutNullStreams;
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

    private async getLatestLlamaCppRelease(): Promise<any> {// eslint-disable-line @typescript-eslint/no-explicit-any
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
                    'User-Agent': 'cotab-extension',    // eslint-disable-line @typescript-eslint/naming-convention
                    'Accept': 'application/octet-stream'// eslint-disable-line @typescript-eslint/naming-convention
                },
                maxRedirects: 5,
                timeout: 600000 // 10 minutes
            });

            await new Promise<void>((resolve, reject) => {
                response.data.pipe(writer);
                let finished = false;
                writer.on('finish', () => { finished = true; resolve(); });
                writer.on('error', (err) => { if (!finished) reject(err); });
                response.data.on('error', (err: any) => { if (!finished) reject(err); });// eslint-disable-line @typescript-eslint/no-explicit-any
            });
        } catch (error) {
            try {
                writer.close();
            } catch (closeError) {
                logWarning(`Failed to close download stream: ${closeError}`);
            }
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch (cleanupError) {
                logWarning(`Failed to remove incomplete download '${filePath}': ${cleanupError}`);
            }
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
        const releaseLlamacppName = this.getReleaseLlamaCppName(osInfo);
        return releaseLlamacppName !== '' ? true : false;
    }

    private getReleaseLlamaCppName(osInfo: OSInfo): string {
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
        const ext = '.zip'
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
        mainBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any
        cudartBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any
        version: string;
    }> {
        const config = getConfig();
        if (config.llamaCppVersion === 'Stable' || config.llamaCppVersion === 'Custom') {
            let cudartBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any

            const baseUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/';

            const {mainName, cudartName} = this.getDownloadBinName(osInfo);

            const tag = config.llamaCppVersion === 'Stable' ? stableLlamaCppVersion : config.customLlamaCppVersion;
            
            if (cudartName !== '') {
                const name = `cudart-llama-${cudartName}`
                const url = `${baseUrl}/${tag}/${name}`;
                cudartBinary = {
                    name: name,
                    browser_download_url: url, // eslint-disable-line @typescript-eslint/naming-convention
                }
            }

            const name = `llama-${tag}-${mainName}`;
            const dlUrl = `${baseUrl}/${tag}/${name}`;
            const mainBinary = {
                name: name,
                browser_download_url: dlUrl, // eslint-disable-line @typescript-eslint/naming-convention
            }

            return {mainBinary, cudartBinary, version: tag};
        }
        else {
            return this.getDownloadURLInternal(osInfo);
        }
    }

    private async getDownloadURLInternal(osInfo: OSInfo): Promise<{
        mainBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any
        cudartBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any
        version: string;
    }> {
        let mainBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any
        let cudartBinary: any | undefined;// eslint-disable-line @typescript-eslint/no-explicit-any

        const release = await this.getLatestLlamaCppRelease();

        if (osInfo.platform === 'win' && osInfo.gpu === 'cuda') {
            mainBinary = release.assets.find((asset: any) =>// eslint-disable-line @typescript-eslint/no-explicit-any
                !asset.name.includes(`cudart-llama-bin-${osInfo.platform}-${osInfo.gpu}-`) &&
                asset.name.includes('llama-b') &&
                asset.name.includes(`bin-${osInfo.platform}-${osInfo.gpu}-`) && // cuda is included version
                asset.name.includes(`-${osInfo.cpu}.zip`)
            );
            cudartBinary = release.assets.find((asset: any) =>// eslint-disable-line @typescript-eslint/no-explicit-any
                asset.name.includes(`cudart-llama-bin-${osInfo.platform}-${osInfo.gpu}-`) && // cuda is included version
                asset.name.includes(`-${osInfo.cpu}.zip`)
            );
            if (!mainBinary || !cudartBinary) {
                throw new Error('CUDA binaries not found in latest release');
            }
        }
        else {
            const releaseLlamacppName = this.getReleaseLlamaCppName(osInfo);
            mainBinary = release.assets.find((asset: any) =>// eslint-disable-line @typescript-eslint/no-explicit-any
                asset.name.includes('llama-b') &&
                asset.name.includes(releaseLlamacppName)
            );
            if (!mainBinary) {
                throw new Error(`${osInfo.platform}-${osInfo.gpu}-${osInfo.cpu} binaries not found in latest release`);
            }
        }
        
        // Extract version from mainBinary.name (e.g., "llama-b7216-bin-win-vulkan-x64.zip" -> "b7216")
        let version = ''; // fallback to tag_name
        if (mainBinary && mainBinary.name) {
            const versionMatch = mainBinary.name.match(/llama-(b\d+)/);
            if (versionMatch && versionMatch[1]) {
                version = versionMatch[1];
            }
        }
        
        return { mainBinary, cudartBinary, version };
    }

    private async downloadAndInstallWindowsBinaries(osInfo: OSInfo): Promise<'success' | 'error' | 'notsupported'> {
        try {
            if (! this.isSupportMyInstall(osInfo)) {
                return 'notsupported';
            }

            // show log window for installation progress
            showLogWindow(true);
            logTerminal('[Install] Fetching latest llama.cpp release information...');

            const {mainBinary, cudartBinary, version} = await this.getDownloadURL(osInfo);
            if (!mainBinary) {
                throw new Error('Main llama.cpp binary not found');
            }

            // Create user install directory for llama.cpp binaries (clean first)
            const installDir = this.getInstallBaseDir();
            try {
                if (fs.existsSync(installDir)) {
                    logTerminal('[Install] Cleaning existing install directory...');
                    fs.rmSync(installDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                logWarning(`[Install] Failed to clean install directory: ${cleanupError}`);
            }
            fs.mkdirSync(installDir, { recursive: true });

            // Download llama.cpp binary
            logTerminal(`[Install] Downloading ${mainBinary.name}...`);
            const mainZipPath = path.join(installDir, mainBinary.name);
            await this.downloadFile(mainBinary.browser_download_url, mainZipPath);

            // Extract llama.cpp binary
            logTerminal('[Install] Extracting llama.cpp archive...');
            await this.extractZip(mainZipPath, installDir);
            
            try {
                fs.unlinkSync(mainZipPath);
            } catch (removeError) {
                logWarning(`[Install] Failed to remove archive ${mainZipPath}: ${removeError}`);
            }

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
                
                try {
                    fs.unlinkSync(cudartZipPath);
                } catch (removeCudaError) {
                    logWarning(`[Install] Failed to remove CUDA archive ${cudartZipPath}: ${removeCudaError}`);
                }
            }

            logTerminal('[Install] ########################################');
            logTerminal('[Install] # llama.cpp installation successfully! #');
            logTerminal('[Install] ########################################');
            
            // Update llama.cpp version in system config
            updateLlamaCppVersion(version);
            
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
        if (this.installTerminal) {
            this.installTerminal.dispose();
            this.installTerminal = undefined;
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
        catch (error: any) {// eslint-disable-line @typescript-eslint/no-explicit-any
            terminal.sendText(`echo "Command failed: ${error.message}"`);
            const stdout = error.stdout + '\n' + error.stderr;
            terminal.sendText(`echo "Output: ${stdout.trim()}"`);
            return { success: false, stdout, stderr: error.message, terminal };
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
        catch (_error) {
            // Exception occurs when command is not found
            return false;
        }
    }

    public async isInstalledLocalLlamaServer(): Promise<boolean> {
        try {
            const osInfo = await getOsInfo();
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

    public async getInstalledLocalLlamaCppVersion(): Promise<string | undefined> {
        const isInstalled = await this.isInstalledLocalLlamaServer();
        if (! isInstalled) {
            return "";
        }
        const logs = await this.runLocalLlamaServerInternal(['--version'], true);
        
        if (!logs || logs.length === 0) {
            return "";
        }
        
        // Join all log lines
        const logText = logs.join('\n');
        
        // Extract version from "version: xxx" pattern
        const versionMatch = logText.match(/version:\s*(\d+)/i);
        if (versionMatch && versionMatch[1]) {
            return versionMatch[1];
        }
        
        return "";
    }

    /**
     * Install llama.cpp via integrated terminal
     * not waitable command. because terminal is not visible to user. so user input is required.
     */
    public async installLocalLlamaCpp(): Promise<boolean> {
        try {
            await this.killInstallTerminal();
            await this.stopLocalLlamaServer();

            const osInfo = await getOsInfo();
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
                const { terminal } = await this.command(this.installTerminal, terminalCommand, false);
                terminal?.sendText(`echo "##############################"`);
                terminal?.sendText(`echo "Installation process completed!"`);
                terminal?.sendText(`echo "Please click the 'Start Local Server' button"`);
                terminal?.sendText(`echo "from the Cotab status bar menu to start the server!"`);
                terminal?.sendText(`echo "##############################"`);
                this.installTerminal = terminal;

                return false;   // must false;
            }
            else {
                vscode.window.showInformationMessage(localize('terminalCommand.installNotSupported', 'Automatic install/upgrade is supported only for Mac and Windows for now. Download llama.cpp package manually and add the folder to the path. Visit github.com/ggml-org/llama.vscode/wiki for details.'));
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
            const osInfo = await getOsInfo();
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
                        
                        // Clear llama.cpp version in system config
                        updateLlamaCppVersion(undefined);
                        
                        return true;
                    } catch (err) {
                        logError(`[Uninstall] Failed to uninstall llama.cpp from user install directory: ${err}`);
                        return false;
                    }
                }
            }
            else if (osInfo.platform === 'macos') {
                // If on macOS/Windows, also attempt package-manager uninstall to clean system installs
                const terminalCommand = process.platform === 'darwin' ? "brew uninstall llama.cpp" : process.platform === 'win32' ? "winget uninstall llama.cpp" : "";
                if (terminalCommand) {
                    const {success, terminal} = await this.command(this.installTerminal, terminalCommand, false);
                    terminal?.sendText(`echo "##############################"`);
                    terminal?.sendText(`echo "Uninstallation process completed!"`);
                    terminal?.sendText(`echo "llama.cpp has been removed from your system."`);
                    terminal?.sendText(`echo "##############################"`);
                    this.installTerminal = terminal;
                    
                    if (success) {
                        // Clear llama.cpp version in system config
                        updateLlamaCppVersion(undefined);
                    }
                    
                    return success;
                }
            }
            else {
                vscode.window.showInformationMessage(localize('terminalCommand.uninstallNotSupported', 'Automatic uninstall is supported only for Mac and Windows for now. Please uninstall llama.cpp manually. Visit github.com/ggml-org/llama.vscode/wiki for details.'));
                return false;
            }
            
            // If we reach here without uninstalling, clear version anyway
            updateLlamaCppVersion(undefined);
            return true;
        }
        finally {
            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
        }
    }

    public makeLocalLlamaServerArgs(yamlConfigMode: YamlConfigMode): string[] {
        const config = getConfig();
        let argsStr = yamlConfigMode.localServerCustom;
        if (! argsStr) {
            if (config.localServerPreset === 'Custom') {
                argsStr = config.localServerCustom;
            }
            else {
                argsStr = localServerPresetArgs[config.localServerPreset];
            }
            if (! argsStr) {
                argsStr = config.localServerCustom;
            }
        }
        const contextSize = yamlConfigMode.localServerContextSize || config.localServerContextSize;
        const cacheRam = yamlConfigMode.localServerCacheRam || config.localServerCacheRam;
        const args = argsStr.split(' ');
        if (!args.includes('-c') && !args.includes('--ctx-size')) {
            args.push(`-c`, `${contextSize}`);
        }
        if (!args.includes('-kvu') && !args.includes('--kv-unified')) {
            args.push(`-kvu`);
        }
        if (!args.includes('-cram') && !args.includes('--cache-ram')) {
            args.push(`-cram`, `${cacheRam}`);
        }
        args.push('--host', '127.0.0.1');
        args.push('--port', `${config.localServerPort}`);
        return args;
    }

    public runLocalLlamaServer(args: string[]): void {
        this.runLocalLlamaServerInternal(args);
    }

    private getUnixProcessListCommand(): string {
        return process.platform === 'darwin'
            ? 'ps -axo pid=,comm=,command='
            : 'ps -eo pid=,comm=,args=';
    }

    private extractUnixLocalLlamaServerPids(psOutput: string, normalizedBaseDirLower: string): number[] {
        const pids: number[] = [];
        const lines = (psOutput || '').split(/\r?\n/);
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (!line.includes(llamaServerExe)) continue;
            const match = line.match(/^(\d+)\s+(.+)$/);
            if (!match) continue;
            const pid = parseInt(match[1], 10);
            if (Number.isNaN(pid)) continue;
            const commandWithArgsLower = match[2].toLowerCase();
            if (commandWithArgsLower.includes(normalizedBaseDirLower) &&
                commandWithArgsLower.includes(llamaServerExe)) {
                pids.push(pid);
            }
        }
        return pids;
    }

    private escapePathForPowerShell(pathValue: string): string {
        // PowerShell single-quoted strings only need single quotes escaped.
        return pathValue.replace(/'/g, "''");
    }

    private async runLocalLlamaServerInternal(args: string[], returnLogs: boolean = false): Promise<string[] | void> {
        const logs: string[] = [];
        
        try {
            let command: string;
            let cwd: string | undefined;
            
            const osInfo = await getOsInfo();
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
            
            this.serverProcess = cp.spawn(command, args, {
                detached: false,
                stdio: 'pipe',
                shell: process.platform === 'win32',
                cwd: cwd
            });

            this.serverProcess.on('error', (err) => {
                const errorMsg = `llama-server spawn error: ${err?.message || err}`;
                logError(errorMsg);
                if (returnLogs) {
                    logs.push(errorMsg);
                }
                vscode.window.showErrorMessage(`llama-server execution error: ${err?.message || err}`);
            });
            this.serverProcess.on('exit', (code, signal) => {
                const exitMsg = `llama-server exited: code=${code} signal=${signal}`;
                logWarning(exitMsg);
                if (returnLogs) {
                    logs.push(exitMsg);
                }
            });
            if (this.serverProcess.stdout) {
                this.serverProcess.stdout.on('data', (data: Buffer) => {
                    const text = process.platform === 'win32' 
                        ? data.toString('utf8') 
                        : data.toString();
                    if (returnLogs) {
                        logs.push(text);
                    } else {
                        logServer(`${text}`);
                    }
                });
            }
            if (this.serverProcess.stderr) {
                this.serverProcess.stderr.on('data', (data: Buffer) => {
                    const text = process.platform === 'win32' 
                        ? data.toString('utf8') 
                        : data.toString();
                    if (returnLogs) {
                        logs.push(text);
                    } else {
                        logServer(`${text}`);
                    }
                });
            }
            
            // If returnLogs is true, wait for initial output and return logs
            if (returnLogs) {
                // Wait for initial output (e.g., 3 seconds) or until process exits
                return new Promise<string[]>((resolve) => {
                    const timeout = setTimeout(() => {
                        resolve(logs);
                    }, 3000);
                    
                    this.serverProcess?.on('exit', () => {
                        clearTimeout(timeout);
                        resolve(logs);
                    });
                });
            }
        } finally {
            // Update menu until changed
            requestUpdateCotabMenuUntilChanged();
        }
    }

    public detacheLocalLlamaServer() {
        if (this.serverProcess && !this.serverProcess.killed) {
            this.serverProcess.unref();
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
            const installBaseDir = this.getInstallBaseDir();
            const normalizedInstallBaseDir = path.normalize(installBaseDir);
            const normalizedInstallBaseDirLower = normalizedInstallBaseDir.toLowerCase();
            
            if (process.platform === 'win32') {
                const windowsProcessName = llamaServerExe.replace('.exe', '');
                const { stdout } = await exec(`powershell -NoProfile -Command "Get-Process -Name '${windowsProcessName}' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | ForEach-Object { $_.Path }"`);
                const processPaths = (stdout || '').split(/\r?\n/).map((p) => p.trim()).filter((p) => p.length > 0);
                for (const processPath of processPaths) {
                    const normalizedPath = path.normalize(processPath);
                    if (normalizedPath.toLowerCase().startsWith(normalizedInstallBaseDirLower)) {
                        return true;
                    }
                }
                return false;
            }
            else {
                const cmd = this.getUnixProcessListCommand();
                const { stdout } = await exec(cmd);
                const pids = this.extractUnixLocalLlamaServerPids(stdout, normalizedInstallBaseDirLower);
                return pids.length > 0;
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

    private isEnableServerLayCache: boolean | undefined = undefined;

    // get server status
    public isEnableServerLazy(): boolean {
        const isBaseURLLocalHost = isCotabLocalhost(getConfig().apiBaseURL);

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
            const installBaseDir = this.getInstallBaseDir();
            
            if (process.platform === 'win32') {
                const escapedBaseDir = this.escapePathForPowerShell(installBaseDir);
                const windowsProcessName = llamaServerExe.replace('.exe', '');
                await exec(`powershell -NoProfile -Command "Get-Process -Name '${windowsProcessName}' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '${escapedBaseDir}*' } | Stop-Process -Force"`);
            } else {
                const cmd = this.getUnixProcessListCommand();
                const { stdout } = await exec(cmd);
                const normalizedBaseDirLower = path.normalize(installBaseDir).toLowerCase();
                const pidsToKill = this.extractUnixLocalLlamaServerPids(stdout, normalizedBaseDirLower);

                if (pidsToKill.length === 0) {
                    logInfo('Local llama-server is not running under install directory');
                } else {
                    for (const pid of pidsToKill) {
                        try {
                            process.kill(pid, 'SIGKILL');
                        } catch (_) {
                            // Ignore if process already terminated
                        }
                    }
                    await new Promise(r => setTimeout(r, 2000));
                }
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
            const installBaseDir = this.getInstallBaseDir();
            
            if (process.platform === 'win32') {
                const escapedBaseDir = this.escapePathForPowerShell(installBaseDir);
                const windowsProcessName = llamaServerExe.replace('.exe', '');
                const psCommand = `powershell -NoProfile -Command "Get-Process -Name '${windowsProcessName}' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '${escapedBaseDir}*' } | Stop-Process -Force"`;
                cp.execSync(psCommand, { stdio: 'ignore' });
            } else {
                const cmd = this.getUnixProcessListCommand();
                const stdout = cp.execSync(cmd, { encoding: 'utf8' });
                const normalizedBaseDirLower = path.normalize(installBaseDir).toLowerCase();
                const pidsToKill = this.extractUnixLocalLlamaServerPids(stdout, normalizedBaseDirLower);

                if (pidsToKill.length === 0) {
                    logInfo('Local llama-server is not running under install directory');
                } else {
                    for (const pid of pidsToKill) {
                        try {
                            process.kill(pid, 'SIGKILL');
                        } catch (_) {
                            // Ignore if process already terminated
                        }
                    }
                }
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

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
import { logInfo, logWarning, logError } from './logger';

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
        return this.isExistCommand('llama-server');
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
            // not waitable command. because terminal is not visible to user. so user input is required.
            const {success, stdout, terminal} = await this.command(this.InstallTerminal, terminalCommand, false);
            terminal?.sendText(`echo "##############################"`);
            terminal?.sendText(`echo "Installation process completed!"`);
            terminal?.sendText(`echo "Please click the 'Start Local Server' button"`);
            terminal?.sendText(`echo "from the Cotab status bar menu to start the server!"`);
            terminal?.sendText(`echo "##############################"`);

            this.InstallTerminal = terminal;
            return success;
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
            let terminalCommand = process.platform === 'darwin' ? "brew uninstall llama.cpp" : process.platform === 'win32' ? "winget uninstall llama.cpp" : "";
            // not waitable command. because terminal is not visible to user. so user input is required.
            const {success, stdout, terminal} = await this.command(this.InstallTerminal, terminalCommand, false);
            terminal?.sendText(`echo "##############################"`);
            terminal?.sendText(`echo "Uninstallation process completed!"`);
            terminal?.sendText(`echo "llama.cpp has been removed from your system."`);
            terminal?.sendText(`echo "##############################"`);

            this.InstallTerminal = terminal;
            return success;
        }
    }

    public runLocalLlamaServer(args: string[]) {
        const command = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
        this.ServerProcess = cp.spawn(command, args, {
            detached: false,
            stdio: 'pipe',
            shell: process.platform === 'win32'
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
                logInfo(`llama-server: ${text}`);
            });
        }
        if (this.ServerProcess.stderr) {
            this.ServerProcess.stderr.on('data', (data: Buffer) => {
                const text = process.platform === 'win32' 
                    ? data.toString('utf8') 
                    : data.toString();
                logError(`llama-server: ${text}`);
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

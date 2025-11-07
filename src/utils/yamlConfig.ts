import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { parse } from 'yaml';
import { logDebug, logError } from './logger';
import { getConfig } from './config';
import { getYamlDefaultCodingPrompt } from '../llm/defaultCodingPrompts';
import { getYamlDefaultCommentPrompt } from '../llm/defaultCommentPrompts';
import { getYamlDefaultTranslatePrompt } from '../llm/defaultTranslationPrompts';
import { getYamlDefaultProofreadingPrompt } from '../llm/defaultProofreadingPrompts';
import { getYamlDefaultBusinessChatPrompt } from '../llm/defaultBusinessChatPrompts';

export function registerYamlConfig(disposables: vscode.Disposable[]) {
    // Update edit history
    disposables.push(vscode.workspace.onDidChangeTextDocument((evt: vscode.TextDocumentChangeEvent) => {
        if (yamlConfigCache ) {
            yamlConfigCache.lastAccessed = 0;
        }
    }));
}

// Cache interface
interface YamlConfigCache {
    config: YamlConfig;
    filePath: string;
    lastModified: number;
    lastAccessed: number; // Last access time (milliseconds)
}

export interface YamlConfigMode {
    mode: string;
    extensions: string[];
    cursorAlwaysHead?: boolean;
    placeholderSymbol?: string;
    isDispOverwrite?: boolean;
    isNoHighligh?: boolean;
    isForceOverlay?: boolean;
    isNoCheckStopSymbol?: boolean;
    isNoInsertStartStopSymbol?: boolean; // insert start&stop symbol for cached code block?
    maxOutputLines?: number;
    maxTokens?: number;
    systemPrompt?: string;
    userPrompt?: string;
    assistantPrompt?: string;
    appendThinkPromptNewScope?: string;
    appendThinkPromptRefactoring?: string;
    appendThinkPromptAddition?: string;
    appendThinkPromptReject?: string;
    appendOutputPromptReject?: string;
    analyzeSystemPrompt?: string;
    analyzeUserPrompt?: string;
}

export interface YamlConfig {
    modes: YamlConfigMode[];
}



// Global cache
let yamlConfigCache: YamlConfigCache | null = null;
let onDidChangeConfigs: (() => void)[] = [];

/**
 * Load YAML configuration from home directory .cotab/config.yaml
 * @returns YamlConfig
 */
export function getYamlConfig(): YamlConfig {
    try {
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.cotab', 'config.yaml');
        
        // Get current timestamp
        const now = Date.now();
        
        // Return cache immediately if accessed within 5 seconds (skip file I/O)
        if (yamlConfigCache && 
            yamlConfigCache.filePath === configPath && 
            (now - yamlConfigCache.lastAccessed) < 5000) {
            //logDebug('YAML config loaded from cache (time-based)');
            yamlConfigCache.lastAccessed = now; // Update access time
            return yamlConfigCache.config;
        }
        
        // Check if file exists
        if (!fs.existsSync(configPath)) {
            logDebug('YAML config file does not exist, using defaults');
            // Clear cache when file doesn't exist
            yamlConfigCache = null;
            return getDefaultYamlConfig();
        }
        
        // Get file modification time
        const stats = fs.statSync(configPath);
        const lastModified = stats.mtime.getTime();
        
        // Check if cache is valid based on file modification time
        if (yamlConfigCache && 
            yamlConfigCache.filePath === configPath && 
            yamlConfigCache.lastModified === lastModified) {
            logDebug('YAML config loaded from cache (file-based)');
            yamlConfigCache.lastAccessed = now; // Update access time
            return yamlConfigCache.config;
        }
        
        logDebug(`Loading YAML config from: ${configPath}`);
        
        // Read and parse the file
        const readYamlContent = fs.readFileSync(configPath, 'utf8');
        const readYamlConfig = parse(readYamlContent) as YamlConfig;

        // Merge the prompt configurations from the YAML file into the default config
        const yamlConfig = getDefaultYamlConfig();
        for (const readMode of readYamlConfig.modes) {
            const modeIndex = yamlConfig.modes.findIndex(m => m.mode === readMode.mode);
            if (modeIndex !== -1) {
                yamlConfig.modes[modeIndex] = { ...yamlConfig.modes[modeIndex], ...readMode };
            } else {
                yamlConfig.modes.push({ ...readMode });
            }
        }
        
        // Trigger config change callback if file has been modified since last cache
        let configChanged = false;
        if (yamlConfigCache &&
            yamlConfigCache.filePath === configPath && 
            yamlConfigCache.lastModified !== lastModified
        ) {
            configChanged = true;
        }

        // remove last crlf
        for (const mode of yamlConfig.modes) {
            mode.systemPrompt = mode.systemPrompt?.replace(/\n+$/, '');
            mode.userPrompt = mode.userPrompt?.replace(/\n+$/, '');
            mode.assistantPrompt = mode.assistantPrompt?.replace(/\n+$/, '');
            mode.appendThinkPromptNewScope = mode.appendThinkPromptNewScope?.replace(/\n+$/, '');
            mode.appendThinkPromptRefactoring = mode.appendThinkPromptRefactoring?.replace(/\n+$/, '');
            mode.appendThinkPromptAddition = mode.appendThinkPromptAddition?.replace(/\n+$/, '');
            mode.appendThinkPromptReject = mode.appendThinkPromptReject?.replace(/\n+$/, '');
            mode.appendOutputPromptReject = mode.appendOutputPromptReject?.replace(/\n+$/, '');
            mode.analyzeSystemPrompt = mode.analyzeSystemPrompt?.replace(/\n+$/, '');
            mode.analyzeUserPrompt = mode.analyzeUserPrompt?.replace(/\n+$/, '');
        }

        // Update cache with new data
        yamlConfigCache = {
            config: yamlConfig,
            filePath: configPath,
            lastModified,
            lastAccessed: now
        };
        
        logDebug('YAML config loaded successfully and cached');
        
        // Trigger config change callbacks if file has been modified
        if (configChanged) {
            callDidChangeConfig();
        }
        return yamlConfig;
    } catch (error) {
        logError(`Failed to load YAML config: ${error}`);
        // Clear cache on error
        yamlConfigCache = null;
        return getDefaultYamlConfig();
    }
}

function getDefaultYamlConfig(): YamlConfig {
    return {
        modes: [
            getYamlDefaultCodingPrompt(),
            getYamlDefaultCommentPrompt(),
            getYamlDefaultTranslatePrompt(),
            getYamlDefaultProofreadingPrompt(),
            getYamlDefaultBusinessChatPrompt(),
        ]
    };
}

export function getYamlConfigPromptModes(): string[] {
    let modes: string[] = [];
    for (const mode of getYamlConfig().modes) {
        if (mode.mode) {
            if (!modes.includes(mode.mode)) {
                modes.push(mode.mode);
            }
        }
    }
    return modes;
}

/**
 * Find matching YamlConfigMode based on file extension
 */
export function getYamlConfigMode(filePath: string): YamlConfigMode {
    const selectedPromptMode = getConfig().selectedPromptMode || 'Coding';
    const yamlConfigMode = getYamlConfigPromptInternal(selectedPromptMode, filePath);

    // Return the matching prompt or fallback to default if none found
    return yamlConfigMode || getDefaultYamlConfig().modes[0];
}

function getYamlConfigPromptInternal(promptMode: string, filePath: string): YamlConfigMode | null {
    const yamlConfig = getYamlConfig();
    if (!yamlConfig || !yamlConfig.modes) {
        return null;
    }

    // Extract file extension
    const extension = path.extname(filePath).substring(1).toLowerCase();

    // Find matching prompt configuration
    for (const mode of yamlConfig.modes) {
        if (mode.mode !== promptMode) {
            continue;
        }
        if (mode.extensions && mode.extensions.length > 0) {
            for (const extPattern of mode.extensions) {
                try {
                    // Handle wildcard patterns first
                    if (extPattern === '*') {
                        logDebug(`Found matching prompt for extension '${extension}' using wildcard pattern '*'`);
                        return mode;
                    }
                    
                    // Check if the pattern is a regex (contains regex special characters, but not just '*')
                    const isRegex = /[.*+?^${}()|[\]\\]/.test(extPattern) && extPattern !== '*';
                    
                    if (isRegex) {
                        // Use regex matching
                        const regex = new RegExp(extPattern, 'i');
                        if (regex.test(extension)) {
                            logDebug(`Found matching prompt for extension '${extension}' using regex pattern '${extPattern}'`);
                            return mode;
                        }
                    } else {
                        // Use exact string matching (case insensitive)
                        if (extPattern.toLowerCase() === extension) {
                            logDebug(`Found matching prompt for extension '${extension}' using exact match`);
                            return mode;
                        }
                    }
                } catch (error) {
                    logError(`Invalid regex pattern '${extPattern}': ${error}`);
                    // Fallback to exact string matching if regex is invalid
                    if (extPattern.toLowerCase() === extension) {
                        logDebug(`Found matching prompt for extension '${extension}' using fallback exact match`);
                        return mode;
                    }
                }
            }
        }
    }

    logDebug(`No matching prompt found for extension '${extension}'`);
    return null;
}

/**
 * Clear YAML configuration cache
 * Call this when the configuration file has been modified
 */
export function clearYamlConfigCache(): void {
    yamlConfigCache = null;
    logDebug('YAML config cache cleared');
}

export function onDidChangeYamlConfig(callback: () => void): vscode.Disposable {
    onDidChangeConfigs.push(callback);
    
    // Return a disposable to unregister the callback
    let disposed = false;
    return {
        dispose: () => {
            if (disposed) { return; }
            disposed = true;
            const idx = onDidChangeConfigs.indexOf(callback);
            if (idx !== -1) {
                onDidChangeConfigs.splice(idx, 1);
            }
        }
    };
}

function callDidChangeConfig() {
    logDebug('Config changed, triggering cache refresh');
    onDidChangeConfigs.forEach(callback => callback?.());
}

/**
 * Open YAML configuration file in editor
 * If file doesn't exist, create a template with all parameters commented out
 */
export async function openYamlConfig(): Promise<void> {
    try {
        const homeDir = os.homedir();
        const configDir = path.join(homeDir, '.cotab');
        const configPath = path.join(configDir, 'config.yaml');
        
        // Create .cotab directory if it doesn't exist
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // If config file doesn't exist, create a template
        if (!fs.existsSync(configPath)) {
            const template = generateYamlConfigTemplate();
            fs.writeFileSync(configPath, template, 'utf8');
            logDebug(`Created YAML config template at: ${configPath}`);
        }
        
        // Open the file in VS Code editor
        const uri = vscode.Uri.file(configPath);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
        
        logDebug(`Opened YAML config file: ${configPath}`);
    } catch (error) {
        logError(`Failed to open YAML config: ${error}`);
        vscode.window.showErrorMessage(`設定ファイルを開けませんでした: ${error}`);
    }
}

/**
 * Generate YAML configuration template with all parameters commented out
 */
function generateYamlConfigTemplate(): string {
    const config = getYamlConfig();
    
    let yamlContent = `# Cotab YAML Configuration
# This file contains prompt configurations for different file types
# Uncomment and modify the parameters you want to use
# (You can select rectangular regions in VS Code by holding Alt+Shift and clicking, or using Alt+Shift+Ctrl+arrow keys)
# 
# Prompt format is handlebars template.

modes:
`;

    for (let i = 0; i < config.modes.length; i++) {
        const mode = config.modes[i];
        yamlContent += `#  - mode: "${mode.mode}"\n`;
        yamlContent += `#    extensions: [${mode.extensions.map(ext => `"${ext}"`).join(', ')}]\n`;
        if (mode.cursorAlwaysHead !== undefined) {
            yamlContent += `#    cursorAlwaysHead: ${mode.cursorAlwaysHead}\n`;
        }
        if (mode.placeholderSymbol !== undefined) {
            yamlContent += `#    placeholderSymbol: "${mode.placeholderSymbol}"\n`;
        }
        if (mode.isDispOverwrite !== undefined) {
            yamlContent += `#    isDispOverwrite: "${mode.isDispOverwrite}"\n`;
        }
        if (mode.isNoHighligh !== undefined) {
            yamlContent += `#    isNoHighligh: "${mode.isNoHighligh}"\n`;
        }
        if (mode.isForceOverlay !== undefined) {
            yamlContent += `#    isForceOverlay: "${mode.isForceOverlay}"\n`;
        }
        if (mode.isNoCheckStopSymbol !== undefined) {
            yamlContent += `#    isNoCheckStopSymbol: ${mode.isNoCheckStopSymbol}\n`;
        }
        if (mode.isNoInsertStartStopSymbol !== undefined) {
            yamlContent += `#    isNoInsertStartStopSymbol: ${mode.isNoInsertStartStopSymbol}\n`;
        }
        if (mode.maxOutputLines !== undefined) {
            yamlContent += `#    maxOutputLines: "${mode.maxOutputLines}"\n`;
        }
        if (mode.maxTokens !== undefined) {
            yamlContent += `#    maxTokens: "${mode.maxTokens}"\n`;
        }
        
        if (mode.systemPrompt) {
            yamlContent += `#    systemPrompt: |\n`;
            yamlContent += `#      ${mode.systemPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.userPrompt) {
            yamlContent += `#    userPrompt: |\n`;
            yamlContent += `#      ${mode.userPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.assistantPrompt) {
            yamlContent += `#    assistantPrompt: |\n`;
            yamlContent += `#      ${mode.assistantPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.appendThinkPromptNewScope) {
            yamlContent += `#    appendThinkPromptNewScope: |\n`;
            yamlContent += `#      ${mode.appendThinkPromptNewScope.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.appendThinkPromptRefactoring) {
            yamlContent += `#    appendThinkPromptRefactoring: |\n`;
            yamlContent += `#      ${mode.appendThinkPromptRefactoring.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.appendThinkPromptAddition) {
            yamlContent += `#    appendThinkPromptAddition: |\n`;
            yamlContent += `#      ${mode.appendThinkPromptAddition.replace(/\n/g, '\n#      ')}\n`;
        }

        if (mode.appendThinkPromptReject) {
            yamlContent += `#    appendThinkPromptReject: |\n`;
            yamlContent += `#      ${mode.appendThinkPromptReject.replace(/\n/g, '\n#      ')}\n`;
        }

        if (mode.appendOutputPromptReject) {
            yamlContent += `#    appendOutputPromptReject: |\n`;
            yamlContent += `#      ${mode.appendOutputPromptReject.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.analyzeSystemPrompt) {
            yamlContent += `#    analyzeSystemPrompt: |\n`;
            yamlContent += `#      ${mode.analyzeSystemPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (mode.analyzeUserPrompt) {
            yamlContent += `#    analyzeUserPrompt: |\n`;
            yamlContent += `#      ${mode.analyzeUserPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
    }
    
    return yamlContent;
}



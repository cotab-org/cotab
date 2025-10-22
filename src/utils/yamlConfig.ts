import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { parse } from 'yaml';
import { logDebug, logError } from './logger';
import { getConfig } from './config';
import { getYamlDefaultCodingPrompt } from '../llm/defaultCodingPrompts';
import { getYamlDefaultCommentPrompt } from '../llm/defaultCommentPrompts';
import { getYamlDefaultProofreadingPrompt } from '../llm/defaultProofreadingPrompts';
import { getYaml}

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

export interface YamlPrompt {
    name: string;
    mode: string;
    extensions: string[];
    systemPrompt?: string;
    userPrompt?: string;
    assistantPrompt?: string;
    appendThinkPromptNewScope?: string;
    appendThinkPromptRefactoring?: string;
    appendThinkPromptAddition?: string;
    analyzeSystemPrompt?: string;
    analyzeUserPrompt?: string;
}

export interface YamlConfig {
    prompts: YamlPrompt[];
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
        const yamlContent = fs.readFileSync(configPath, 'utf8');
        const fullConfig = parse(yamlContent) as YamlConfig;

        // Check if prompts array is empty and add default prompt if needed
        if (fullConfig.prompts.length == 0) {
            fullConfig.prompts = getDefaultYamlConfig().prompts;
        }
        
        // Trigger config change callback if file has been modified since last cache
        let configChanged = false;
        if (yamlConfigCache &&
            yamlConfigCache.filePath === configPath && 
            yamlConfigCache.lastModified !== lastModified
        ) {
            configChanged = true;
        }

        // Update cache with new data
        yamlConfigCache = {
            config: fullConfig,
            filePath: configPath,
            lastModified,
            lastAccessed: now
        };
        
        logDebug('YAML config loaded successfully and cached');
        
        // Trigger config change callbacks if file has been modified
        if (configChanged) {
            callDidChangeConfig();
        }
        return fullConfig;
    } catch (error) {
        logError(`Failed to load YAML config: ${error}`);
        // Clear cache on error
        yamlConfigCache = null;
        return getDefaultYamlConfig();
    }
}

function getDefaultYamlConfig(): YamlConfig {
    return {
        prompts: [
            getYamlDefaultCodingPrompt(),
            getYamlDefaultCommentPrompt(),
            getYamlDefaultProofreadingPrompt(),
        ]
    };
}

export function getYamlConfigPromptModes(): string[] {
    let modes: string[] = [];
    for (const prompt of getYamlConfig().prompts) {
        if (prompt.mode) {
            if (!modes.includes(prompt.mode)) {
                modes.push(prompt.mode);
            }
        }
    }
    return modes;
}

/**
 * Find matching YamlPrompt based on file extension
 */
export function getYamlConfigPrompt(filePath: string): YamlPrompt {
    const selectedPromptMode = getConfig().selectedPromptMode || 'Coding';
    const yamlPrompt = getYamlConfigPromptInternal(selectedPromptMode, filePath);

    // Return the matching prompt or fallback to default if none found
    return yamlPrompt || getDefaultYamlConfig().prompts[0];
}

function getYamlConfigPromptInternal(promptMode: string, filePath: string): YamlPrompt | null {
    const yamlConfig = getYamlConfig();
    if (!yamlConfig || !yamlConfig.prompts) {
        return null;
    }

    // Extract file extension
    const extension = path.extname(filePath).substring(1).toLowerCase();

    // Find matching prompt configuration
    for (const prompt of yamlConfig.prompts) {
        if (prompt.mode !== promptMode) {
            continue;
        }
        if (prompt.extensions && prompt.extensions.length > 0) {
            for (const extPattern of prompt.extensions) {
                try {
                    // Handle wildcard patterns first
                    if (extPattern === '*') {
                        logDebug(`Found matching prompt for extension '${extension}' using wildcard pattern '*'`);
                        return prompt;
                    }
                    
                    // Check if the pattern is a regex (contains regex special characters, but not just '*')
                    const isRegex = /[.*+?^${}()|[\]\\]/.test(extPattern) && extPattern !== '*';
                    
                    if (isRegex) {
                        // Use regex matching
                        const regex = new RegExp(extPattern, 'i');
                        if (regex.test(extension)) {
                            logDebug(`Found matching prompt for extension '${extension}' using regex pattern '${extPattern}'`);
                            return prompt;
                        }
                    } else {
                        // Use exact string matching (case insensitive)
                        if (extPattern.toLowerCase() === extension) {
                            logDebug(`Found matching prompt for extension '${extension}' using exact match`);
                            return prompt;
                        }
                    }
                } catch (error) {
                    logError(`Invalid regex pattern '${extPattern}': ${error}`);
                    // Fallback to exact string matching if regex is invalid
                    if (extPattern.toLowerCase() === extension) {
                        logDebug(`Found matching prompt for extension '${extension}' using fallback exact match`);
                        return prompt;
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

prompts:
`;

    for (let i = 0; i < config.prompts.length; i++) {
        const prompt = config.prompts[i];
        yamlContent += `#  - name: "${prompt.name}"\n`;
        yamlContent += `#    mode: "${prompt.mode}"\n`;
        yamlContent += `#    extensions: [${prompt.extensions.map(ext => `"${ext}"`).join(', ')}]\n`;
        
        if (prompt.systemPrompt) {
            yamlContent += `#    systemPrompt: |\n`;
            yamlContent += `#      ${prompt.systemPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.userPrompt) {
            yamlContent += `#    userPrompt: |\n`;
            yamlContent += `#      ${prompt.userPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.assistantPrompt) {
            yamlContent += `#    assistantPrompt: |\n`;
            yamlContent += `#      ${prompt.assistantPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.appendThinkPromptNewScope) {
            yamlContent += `#    appendThinkPromptNewScope: |\n`;
            yamlContent += `#      ${prompt.appendThinkPromptNewScope.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.appendThinkPromptRefactoring) {
            yamlContent += `#    appendThinkPromptRefactoring: |\n`;
            yamlContent += `#      ${prompt.appendThinkPromptRefactoring.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.appendThinkPromptAddition) {
            yamlContent += `#    appendThinkPromptAddition: |\n`;
            yamlContent += `#      ${prompt.appendThinkPromptAddition.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.analyzeSystemPrompt) {
            yamlContent += `#    analyzeSystemPrompt: |\n`;
            yamlContent += `#      ${prompt.analyzeSystemPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (prompt.analyzeUserPrompt) {
            yamlContent += `#    analyzeUserPrompt: |\n`;
            yamlContent += `#      ${prompt.analyzeUserPrompt.replace(/\n/g, '\n#      ')}\n`;
        }
        
        if (i < config.prompts.length - 1) {
            yamlContent += '\n';
        }
    }
    
    return yamlContent;
}



import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { parse } from 'yaml';
import { logDebug, logError } from './logger';
import { getConfig } from './config';
import { getYamlDefaultCodingPrompt } from '../llm/default/defaultCodingPrompts';
import { getYamlDefaultCommentPrompt } from '../llm/default/defaultCommentPrompts';
import { getYamlDefaultTranslatePrompt, getYamlDefaultTextTranslatePrompt } from '../llm/default/defaultTranslationPrompts';
import { getYamlDefaultProofreadingPrompt } from '../llm/default/defaultProofreadingPrompts';
import { getYamlDefaultBusinessChatPrompt } from '../llm/default/defaultBusinessChatPrompts';

export function registerYamlConfig(disposables: vscode.Disposable[]) {
    // Update edit history
    disposables.push(vscode.workspace.onDidChangeTextDocument((_evt: vscode.TextDocumentChangeEvent) => {
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
    // Represents the name of the prompt mode.
    // This name appears in the menu
    mode: string;

    // An array of strings that specify which file extensions or patterns the mode applies to.
    // each mode's extensions list is matched against the current file name to determine the applicable configuration.
    extensions: string[];

    nextEditJump?: boolean;

    localServerCustom?: string;
    localServerContextSize?: number;
    localServerCacheRam?: number;
    model?: string;
    temperature?: number;
    topP?: number;
    topK?: number;

    // Sets the maximum token count for an LLM request.
    // default: 256
    maxTokens?: number;

    // Limits the number of lines that the assistant may return in a response.
    // Responses exceeding this count are truncated or cut off.
    maxOutputLines?: number;

    // Whether to send the cursor position to the head when sending to AI.
    // By setting it to the head, the AI will attempt to edit from the beginning of the line.
    cursorAlwaysHead?: boolean;

    // The placeholder string inserted into the user prompt to denote where the editor should place the cursor for further input.
    // Typical values include templated markers like <|__EDITING_HERE__|>. The string should be one that AI will not judge as part of the code.
    placeholderSymbol?: string;
    // true: Display over the source code to be replaced
    // false: Display at the right end without overlapping
    isDispOverwrite?: boolean;

    // Determines if syntax highlighting for newly added or edited sections should be disabled.
    // When set to true, inserted or modified code is shown without highlight.
    isNoHighligh?: boolean;

    // true: Whether to display overlay from the first line without using inline suggestions
    isForceOverlay?: boolean;

    // If true, the system skips checking for stop-symbol delimiters (e.g., {{stopEditingHere}}) in the assistant's output.
    // This allows processing even when the delimiter is absent.
    // Set to true if you want it to be displayed sequentially for translation purposes or other uses
    isNoCheckStopSymbol?: boolean;

    // not insert start&stop symbol for cached code block?
    isNoInsertStartStopSymbol?: boolean;

    // not insert start&stop symbol for latest code block?
    isNoInsertStartStopSymbolLatest?: boolean;

    // not display italic when overlay
    isNoItalic?: boolean;

    //
    systemPrompt?: string;

    //
    userPrompt?: string;

    //
    assistantPrompt?: string;

    // Additional prompt material appended when a new code scope is created.
    // Guides the assistant's internal reasoning during this action.
    appendThinkPromptNewScope?: string;

    // Supplementary prompt used while the assistant is performing refactoring operations.
    // Provides context for the assistant to adjust its output accordingly.
    // Used when a symbol rename is detected.
    appendThinkPromptRefactoring?: string;

    // Prompt added when extra code is inserted.
    // Helps the assistant keep track of incremental changes.
    appendThinkPromptAddition?: string;

    // Prompt text presented when a user rejects a prior assistant suggestion, prompting a different answer.
    appendThinkPromptReject?: string;

    // Prompt text when existing errors.
    appendThinkPromptError?: string;

    // Prompt text when cursor error.
    appendThinkPromptCursorError?: string;

    // Replacement prompt used to generate new output after the user has dismissed an earlier response.
    appendOutputPromptReject?: string;

    // System prompt for analyzing code.
    analyzeSystemPrompt?: string;

    // user prompt for analyzing code
    analyzeUserPrompt?: string;
}

export interface YamlConfig {
    // Order of display modes in the UI; defines the sequence in which prompt modes are presented to users.
    orderDisplayModes?: string[];

    // List of mode names to disable;
    // if a mode's name is in this list, it will be excluded from the active modes list
    diableModes?: string[];

    // Declare the array of prompt modes that define behavior for different file types and editing scenarios
    modes: YamlConfigMode[];
}



// Global cache
let yamlConfigCache: YamlConfigCache | null = null;
const onDidChangeConfigs: (() => void)[] = [];

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
            //logDebug('YAML config loaded from cache (file-based)');
            yamlConfigCache.lastAccessed = now; // Update access time
            return yamlConfigCache.config;
        }
        
        logDebug(`Loading YAML config from: ${configPath}`);
        
        // Read and parse the file
        const readYamlContent = fs.readFileSync(configPath, 'utf8');
        const readYamlConfig = parse(readYamlContent) as YamlConfig;

        // Merge the prompt configurations from the YAML file into the default config
        const defaultYamlConfig = getDefaultYamlConfig();

        const yamlConfig = readYamlConfig;
        if (! yamlConfig.orderDisplayModes) {
            yamlConfig.orderDisplayModes = defaultYamlConfig.orderDisplayModes;
        }
        if (! yamlConfig.diableModes) {
            yamlConfig.diableModes = defaultYamlConfig.diableModes;
        }
        if (! yamlConfig.modes) {
            yamlConfig.modes = [];
        }
        yamlConfig.modes.push(...defaultYamlConfig.modes);

        // remove disable entry
        if (yamlConfig.diableModes && yamlConfig.diableModes.length > 0) {
            yamlConfig.modes = yamlConfig.modes.filter(
                m => !yamlConfig.diableModes!.includes(m.mode)
            );
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
            mode.appendThinkPromptError = mode.appendThinkPromptError?.replace(/\n+$/, '');
            mode.appendThinkPromptCursorError = mode.appendThinkPromptCursorError?.replace(/\n+$/, '');
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
    const modes: YamlConfigMode[] = [
        getYamlDefaultCodingPrompt(),
        getYamlDefaultCommentPrompt(),
        getYamlDefaultTextTranslatePrompt(),    // specific plaintext
        getYamlDefaultTranslatePrompt(),
        getYamlDefaultProofreadingPrompt(),
        getYamlDefaultBusinessChatPrompt(),
    ];
    // make orderDisplayModes
    const orderDisplayModes: string[] = [];
    for (const mode of modes) {
        if (!orderDisplayModes.includes(mode.mode)) {
            orderDisplayModes.push(mode.mode);
        }
    }
    return {
        orderDisplayModes,
        modes
    };
}
export function getYamlConfigPromptModes(): string[] {
    const yamlConfig = getYamlConfig();
    const modes: string[] = [];
    for (const mode of yamlConfig.modes) {
        if (mode.mode) {
            if (!modes.includes(mode.mode)) {
                modes.push(mode.mode);
            }
        }
    }
    // sort
    if (yamlConfig.orderDisplayModes && yamlConfig.orderDisplayModes.length > 0) {
        modes.sort((a, b) => {
            const indexA = yamlConfig.orderDisplayModes!.indexOf(a);
            const indexB = yamlConfig.orderDisplayModes!.indexOf(b);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
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
        vscode.window.showErrorMessage(`Failed to open config file: ${error}`);
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
        if (mode.nextEditJump !== undefined) {
            yamlContent += `#    nextEditJump: ${mode.nextEditJump}\n`;
        }
        if (mode.localServerCustom !== undefined) {
            yamlContent += `#    localServerCustom: "${mode.localServerCustom}"\n`;
        }
        if (mode.localServerContextSize !== undefined) {
            yamlContent += `#    localServerContextSize: ${mode.localServerContextSize}\n`;
        }
        if (mode.localServerCacheRam !== undefined) {
            yamlContent += `#    localServerCacheRam: ${mode.localServerCacheRam}\n`;
        }
        if (mode.model !== undefined) {
            yamlContent += `#    model: "${mode.model}"\n`;
        }
        if (mode.temperature !== undefined) {
            yamlContent += `#    temperature: ${mode.temperature}\n`;
        }
        if (mode.topP !== undefined) {
            yamlContent += `#    topP: ${mode.topP}\n`;
        }
        if (mode.topK !== undefined) {
            yamlContent += `#    topK: ${mode.topK}\n`;
        }
        if (mode.maxTokens !== undefined) {
            yamlContent += `#    maxTokens: ${mode.maxTokens}\n`;
        }
        if (mode.maxOutputLines !== undefined) {
            yamlContent += `#    maxOutputLines: ${mode.maxOutputLines}\n`;
        }
        if (mode.cursorAlwaysHead !== undefined) {
            yamlContent += `#    cursorAlwaysHead: ${mode.cursorAlwaysHead}\n`;
        }
        if (mode.placeholderSymbol !== undefined) {
            yamlContent += `#    placeholderSymbol: "${mode.placeholderSymbol}"\n`;
        }
        if (mode.isDispOverwrite !== undefined) {
            yamlContent += `#    isDispOverwrite: ${mode.isDispOverwrite}\n`;
        }
        if (mode.isNoHighligh !== undefined) {
            yamlContent += `#    isNoHighligh: ${mode.isNoHighligh}\n`;
        }
        if (mode.isForceOverlay !== undefined) {
            yamlContent += `#    isForceOverlay: ${mode.isForceOverlay}\n`;
        }
        if (mode.isNoCheckStopSymbol !== undefined) {
            yamlContent += `#    isNoCheckStopSymbol: ${mode.isNoCheckStopSymbol}\n`;
        }
        if (mode.isNoInsertStartStopSymbol !== undefined) {
            yamlContent += `#    isNoInsertStartStopSymbol: ${mode.isNoInsertStartStopSymbol}\n`;
        }
        if (mode.isNoInsertStartStopSymbolLatest !== undefined) {
            yamlContent += `#    isNoInsertStartStopSymbolLatest: ${mode.isNoInsertStartStopSymbolLatest}\n`;
        }
        if (mode.isNoItalic !== undefined) {
            yamlContent += `#    isNoItalic: ${mode.isNoItalic}\n`;
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

        if (mode.appendThinkPromptError) {
            yamlContent += `#    appendThinkPromptError: |\n`;
            yamlContent += `#      ${mode.appendThinkPromptError.replace(/\n/g, '\n#      ')}\n`;
        }

        if (mode.appendThinkPromptCursorError) {
            yamlContent += `#    appendThinkPromptCursorError: |\n`;
            yamlContent += `#      ${mode.appendThinkPromptCursorError.replace(/\n/g, '\n#      ')}\n`;
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



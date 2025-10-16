import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'yaml';
import { logDebug, logError } from './logger';

// Cache interface
interface YamlConfigCache {
    config: YamlConfig | null;
    filePath: string;
    lastModified: number;
    lastAccessed: number; // Last access time (milliseconds)
}

export interface YamlPrompt {
    name: string;
    extensions: string[];
    systemPrompt?: string;
    userPrompt?: string;
    assistantThinkPrompt?: string;
    assistantOutputPrompt?: string;
    analyzeSystemPrompt?: string;
    analyzeUserPrompt?: string;
}

export interface YamlConfig {
    prompts: YamlPrompt[];
}



// Global cache
let yamlConfigCache: YamlConfigCache | null = null;

/**
 * Load YAML configuration from home directory .cotab/config.yaml
 * @returns YamlConfig | null
 */
export function getYamlConfig(): YamlConfig | null {
    try {
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.cotab', 'config.yaml');
        
        // Get current timestamp
        const now = Date.now();
        
        // Return cache immediately if accessed within 1 second (skip file I/O)
        if (yamlConfigCache && 
            yamlConfigCache.filePath === configPath && 
            (now - yamlConfigCache.lastAccessed) < 1000) {
            logDebug('YAML config loaded from cache (time-based)');
            yamlConfigCache.lastAccessed = now; // Update access time
            return yamlConfigCache.config;
        }
        
        // Check if file exists
        if (!fs.existsSync(configPath)) {
            logDebug('YAML config file does not exist, using defaults');
            // Clear cache when file doesn't exist
            yamlConfigCache = null;
            return null;
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
        
        // Update cache with new data
        yamlConfigCache = {
            config: fullConfig,
            filePath: configPath,
            lastModified,
            lastAccessed: now
        };
        
        logDebug('YAML config loaded successfully and cached');
        return fullConfig;
    } catch (error) {
        logError(`Failed to load YAML config: ${error}`);
        // Clear cache on error
        yamlConfigCache = null;
        return null;
    }
}

/**
 * Find matching YamlPrompt based on file extension
 * Supports regex patterns in extensions array
 * @param filePath The file path to get extension from
 * @returns YamlPrompt | null
 */
export function getYamlConfigPrompt(filePath: string): YamlPrompt | null {
    const yamlConfig = getYamlConfig();
    if (!yamlConfig || !yamlConfig.prompts) {
        return null;
    }

    // Extract file extension
    const fileExtension = path.extname(filePath).toLowerCase();
    if (!fileExtension) {
        return null;
    }

    // Remove the dot from extension for matching
    const extension = fileExtension.substring(1);

    // Find matching prompt configuration
    for (const prompt of yamlConfig.prompts) {
        if (prompt.extensions && prompt.extensions.length > 0) {
            for (const extPattern of prompt.extensions) {
                try {
                    // Check if the pattern is a regex (contains regex special characters)
                    const isRegex = /[.*+?^${}()|[\]\\]/.test(extPattern);
                    
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


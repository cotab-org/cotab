import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse } from 'yaml';
import { logDebug, logError } from './logger';

// キャッシュ用のインターフェース
interface YamlConfigCache {
    config: YamlConfig | null;
    filePath: string;
    lastModified: number;
    lastAccessed: number; // 最終アクセス時間（ミリ秒）
}

export interface YamlPromptItem {
    name: string;
    extensions: string[];
    systemPrompt?: string;
    userPrompt?: string;
    assistantThinkPrompt?: string;
    assistantOutputPrompt?: string;
}

export interface YamlConfig {
    prompts: YamlPromptItem[];
}

// グローバルキャッシュ
let yamlConfigCache: YamlConfigCache | null = null;

/**
 * ホームディレクトリの.cotab/config.yamlからプロンプト設定を読み取る
 * ファイルの日付が変わっていない場合はキャッシュを返す
 * @returns YamlConfig | null
 */
export function loadYamlPromptConfig(): YamlConfig | null {
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
 * Clear YAML configuration cache
 * Call this when the configuration file has been modified
 */
export function clearYamlConfigCache(): void {
    yamlConfigCache = null;
    logDebug('YAML config cache cleared');
}


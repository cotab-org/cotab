import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import packageJson from '../../package.json';
import { logDebug, logError } from './logger';

// Callback type for plugin update notification
//export type OnUpdatedPluginCallback = (oldVersion: string, newVersion: string) => void | Promise<void>;

// Global callback for plugin update
//let onUpdatedPluginCallback: OnUpdatedPluginCallback | null = null;

/**
 * Set callback function to be called when plugin version is updated
 */
//export function setOnUpdatedPlugin(callback: OnUpdatedPluginCallback): void {
//    onUpdatedPluginCallback = callback;
//}

// Cache interface
interface SystemConfigCache {
    config: SystemConfig;
    filePath: string;
    lastModified: number;
    lastAccessed: number; // Last access time (milliseconds)
}

export interface SystemConfig {
    pluginVersion?: string;
    llamaCppVersion?: string;
}

// Global cache
let systemConfigCache: SystemConfigCache | null = null;

/**
 * Load system configuration from home directory .cotab/system-config.json
 * @returns SystemConfig
 */
export function getSystemConfig(): SystemConfig {
    try {
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.cotab', 'system-config.json');
        
        // Get current timestamp
        const now = Date.now();
        
        // Return cache immediately if accessed within 5 seconds (skip file I/O)
        if (systemConfigCache && 
            systemConfigCache.filePath === configPath && 
            (now - systemConfigCache.lastAccessed) < 5000) {
            systemConfigCache.lastAccessed = now; // Update access time
            return systemConfigCache.config;
        }
        
        // Check if file exists
        if (!fs.existsSync(configPath)) {
            logDebug('System config file does not exist, using defaults');
            // Clear cache when file doesn't exist
            systemConfigCache = null;
            return {};
        }
        
        // Get file modification time
        const stats = fs.statSync(configPath);
        const lastModified = stats.mtime.getTime();
        
        // Check if cache is valid based on file modification time
        if (systemConfigCache && 
            systemConfigCache.filePath === configPath && 
            systemConfigCache.lastModified === lastModified) {
            systemConfigCache.lastAccessed = now; // Update access time
            return systemConfigCache.config;
        }
        
        logDebug(`Loading system config from: ${configPath}`);
        
        // Read and parse the file
        const readJsonContent = fs.readFileSync(configPath, 'utf8');
        const systemConfig = JSON.parse(readJsonContent) as SystemConfig;

        // Update cache with new data
        systemConfigCache = {
            config: systemConfig,
            filePath: configPath,
            lastModified,
            lastAccessed: now
        };
        
        logDebug('System config loaded successfully and cached');
        return systemConfig;
    } catch (error) {
        logError(`Failed to load system config: ${error}`);
        // Clear cache on error
        systemConfigCache = null;
        return {};
    }
}

/**
 * Save system configuration to file
 */
export function saveSystemConfig(config: SystemConfig): void {
    try {
        const homeDir = os.homedir();
        const configDir = path.join(homeDir, '.cotab');
        const configPath = path.join(configDir, 'system-config.json');
        
        // Create .cotab directory if it doesn't exist
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        // Write JSON file
        const jsonContent = JSON.stringify(config, null, 2);
        fs.writeFileSync(configPath, jsonContent, 'utf8');
        
        // Clear cache to force reload on next access
        systemConfigCache = null;
        
        logDebug(`System config saved to: ${configPath}`);
    } catch (error) {
        logError(`Failed to save system config: ${error}`);
    }
}

/**
 * Update plugin version in system config
 */
export function updatePluginVersion(version: string): void {
    const config = getSystemConfig();
    config.pluginVersion = version;
    saveSystemConfig(config);
}

/**
 * Update llama.cpp version in system config
 */
export function updateLlamaCppVersion(version: string | undefined): void {
    const config = getSystemConfig();
    config.llamaCppVersion = version;
    saveSystemConfig(config);
}

/**
 * Check plugin version on startup and call OnUpdatedPlugin if version changed
 */
export function checkAndUpdatePluginVersion(): {
    prevVersion: string | undefined;
    currentVersion: string;
} {
    
	const currentVersion = packageJson.version;
    
    const config = getSystemConfig();
    const savedVersion = config.pluginVersion;
    
    /*
    if (! savedVersion || savedVersion !== currentVersion) {
        // Version changed, call callback
        if (onUpdatedPluginCallback) {
            logInfo(`Plugin version changed from ${savedVersion||"0"} to ${currentVersion}`);
            await onUpdatedPluginCallback(savedVersion||"0", currentVersion);
        }
    }
    */
    
    // Update to current version
    updatePluginVersion(currentVersion);

    return {prevVersion: savedVersion, currentVersion};
}

/**
 * Clear system configuration cache
 */
export function clearSystemConfigCache(): void {
    systemConfigCache = null;
    logDebug('System config cache cleared');
}


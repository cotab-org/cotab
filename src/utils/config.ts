import * as vscode from 'vscode';
import { BundledTheme } from "shiki";
import { execSync } from 'child_process';
import { isDarkTheme } from './cotabUtil';
import { logDebug, LogLevel } from './logger';
import type { LocalServerPreset } from './localServerPresets';
import { DEFAULT_LOCAL_SERVER_CUSTOM_ARGS, DEFAULT_LOCAL_SERVER_PRESET } from './localServerPresets';

export type { LocalServerPreset } from './localServerPresets';

let configCache: CotabConfig | null = null;

export type LlamaCppVersion = 'Stable' | 'Latest' | 'Custom';

export interface CotabConfig {
    // editor
    documentUri: vscode.Uri | undefined;
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    lineHeight: number;
    backgroundColor: string;
    theme: string;
    shikiTheme: string;
    
    // basic
    enabled: boolean;
    disableForExtensions: string;
    serverAutoStart: boolean;
    serverAutoStopOnIdleTime: number;
    commentLanguage: string;        // use language for comments
    settingCommentLanguage: string; // user-specified language for comments
    defaultCommentLanguage: string; // system language (fallback)
    selectedPromptMode: string;
    hideOnStartup: boolean;

    // llm
    llamaCppVersion: LlamaCppVersion;
    customLlamaCppVersion: string;  // like "b7010"
    provider: 'OpenAICompatible';
    settingApiBaseURL: string;
    apiBaseURL: string;
    apiKey: string;
    localServerPreset: LocalServerPreset;
    localServerCustom: string;
    localServerPort: number;
    localServerContextSize: number;
    // set the maximum cache size in MiB (default: 8192, -1 - no limit, 0 - disable) https://github.com/ggml-org/llama.cpp/pull/16391
    localServerCacheRam: number; 
    model: string;
    temperature: number;
    top_p: number; // eslint-disable-line @typescript-eslint/naming-convention
    top_k: number; // eslint-disable-line @typescript-eslint/naming-convention
    maxTokens: number;
    maxOutputLines: number;
    timeoutMs: number;

    // prompt
    additionalSystemPrompt: string;
    additionalUserPrompt: string;
    additionalAssistantThinkPrompt: string;
    additionalAssistantOutputPrompt: string;

    // promptDetail
    startEditingHereSymbol: string;
    stopEditingHereSymbol: string;
    completeHereSymbol: string;
    aroundBeforeLines: number;  // Number of lines around cursor
    aroundAfterLines: number;   // Number of lines around cursor
    aroundMergeAfterLines: number;   // Number of lines around cursor used during merge
    aroundCacheBeforeLines: number;  // Number of lines around cursor for cache utilization
    aroundCacheAfterLines: number;   // Number of lines around cursor for cache utilization
    aroundLatestAddBeforeLines: number;
    aroundLatestAddAfterLines: number;

    // Code block
    // Maximum number of characters for symbols to include in symbol code blocks.
    // Approximately 1000 characters allow for 20 symbol inputs.
    // In Qwen3:4b-Instruct-2507, approximately 1000 characters use about 250 tokens.
    maxSymbolCharNum: number;
    enableCodeSummary: boolean; // Enable source code summary feature
    withLineNumber: boolean; // The number of lines to include in the line number so that llm can determine

    // ui
    showProgressSpinner: boolean;

    // detail
    logLevel: LogLevel;

    isCurrentEnabled(): boolean;
    isExtensionEnabled(extensionId: string): boolean;
}

// Clear cache when configuration changes
export function registerConfigWatcher(disposables: vscode.Disposable[],
                                        onEnabledChange: () => void): void {
    disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (
            // detect cotab configuration change
            event.affectsConfiguration('cotab') ||
            // detect theme change
            event.affectsConfiguration('workbench.colorTheme') ||
            event.affectsConfiguration('workbench.colorCustomizations') ||
            event.affectsConfiguration('workbench.preferredDarkColorTheme') ||
            event.affectsConfiguration('workbench.preferredLightColorTheme')
        ) {
            const prevEnable = getConfig().enabled;
            configCache = null;
            const nowEnable = getConfig().enabled;
            if (prevEnable !== nowEnable) {
                onEnabledChange();
            }
        }
    }));
}

export function getConfig(): CotabConfig {
    // Invalidate cache if editor URI changes (to ensure prompt context is up-to-date)
    if (configCache && configCache.documentUri !== vscode.window.activeTextEditor?.document.uri) {
        configCache = null;
    }
    if (!configCache) {
        configCache = getConfigRaw();
    }
    return configCache;
}

const LINE_HEIGHT_RATIO = 1.28;

function getConfigRaw(): CotabConfig {
    const uri = vscode.window.activeTextEditor?.document.uri;
    const editorCfg = vscode.workspace.getConfiguration('editor', uri);
    const cfg = vscode.workspace.getConfiguration();
    
    const settingCommentLanguage = cfg.get<string>('cotab.basic.commentLanguage', '').trim();
    //const editorLanguage = commentLanguage || getDisplayLanguageName(getUiLocale());
    const defaultCommentLanguage = getDisplayLanguageName(getOsLocale());
    const commentLanguage = settingCommentLanguage || defaultCommentLanguage;
    const configuredLineHeight = Number(cfg.get<number>('lineHeight') || 0);
    const fontSize = Number(cfg.get<number>('fontSize') || 14);
    const lineHeight = configuredLineHeight > 0 ? configuredLineHeight : Math.round(fontSize * LINE_HEIGHT_RATIO);
    const themeName = getActiveThemeName();
    const settingApiBaseURL = cfg.get<string>('cotab.llm.apiBaseURL', '').trim();
    const localServerPort = cfg.get<number>('cotab.llm.localServerPort', 9339);
    const apiBaseURL = (settingApiBaseURL !== '') ? settingApiBaseURL : `http://127.0.0.1:${localServerPort}/v1`;
    const logLevelStr = cfg.get<string>('cotab.detail.logLevel', 'INFO');
    const logLevel = logLevelStr === 'ERROR' ? LogLevel.error :
                    logLevelStr === 'WARNING' ? LogLevel.warning :
                    logLevelStr === 'INFO' ? LogLevel.info :
                    logLevelStr === 'DEBUG' ? LogLevel.debug :
                    LogLevel.info;

    return {
        // editor
        documentUri: uri,
        fontFamily: String(editorCfg.get<string>('fontFamily') || 'monospace'),
        fontSize: Number(editorCfg.get<number>('fontSize') || 14),
        fontWeight: String(editorCfg.get<string>('fontWeight') || 'normal'),
        fontStyle: String(editorCfg.get<string>('fontStyle') || 'normal'),
        lineHeight: lineHeight,
        backgroundColor: getEditorBackgroundColor(),
        theme: themeName,
        shikiTheme: toShikiThemeName(themeName),
        
        // basic
        enabled: cfg.get<boolean>('cotab.basic.enabled', true),
        disableForExtensions: cfg.get<string>('cotab.basic.disableForExtensions', ''),
        serverAutoStart: cfg.get<boolean>('cotab.basic.autoStart', true),
        serverAutoStopOnIdleTime: cfg.get<number>('cotab.basic.autoStopOnIdleTime', 300),
        selectedPromptMode: cfg.get<string>('cotab.basic.selectedPromptMode', 'auto'),
        hideOnStartup: cfg.get<boolean>('cotab.gettingStarted.hideOnStartup', false),

        // llm
        llamaCppVersion: cfg.get<LlamaCppVersion>('cotab.llm.llamaCppVersion', 'Stable'),
        customLlamaCppVersion: cfg.get<string>('cotab.llm.customLlamaCppVersion', 'b7314'),
        provider: cfg.get<'OpenAICompatible'>('cotab.llm.provider', 'OpenAICompatible'),
        settingApiBaseURL,
        apiBaseURL,
        apiKey: cfg.get<string>('cotab.llm.apiKey', '').trim(),
        localServerPreset: cfg.get<LocalServerPreset>('cotab.llm.localServerPreset', DEFAULT_LOCAL_SERVER_PRESET),
        localServerCustom: cfg.get<string>('cotab.llm.localServerCustom', DEFAULT_LOCAL_SERVER_CUSTOM_ARGS),
        localServerPort,
        localServerContextSize: cfg.get<number>('cotab.llm.localServerContextSize', 32768),
        localServerCacheRam: cfg.get<number>('cotab.llm.localServerCacheRam', 4096),
        model: cfg.get<string>('cotab.llm.model', 'qwen3-4b-2507'),
        temperature: cfg.get<number>('cotab.llm.temperature', 0.1),
        top_p: cfg.get<number>('cotab.llm.top_p', -1), // eslint-disable-line @typescript-eslint/naming-convention
        top_k: cfg.get<number>('cotab.llm.top_k', -1), // eslint-disable-line @typescript-eslint/naming-convention
        maxTokens: cfg.get<number>('cotab.llm.maxTokens', 256),
        maxOutputLines: cfg.get<number>('cotab.llm.maxOutputLines', 15),
        timeoutMs: cfg.get<number>('cotab.llm.timeoutMs', 30000),

        // prompt
        commentLanguage,
        settingCommentLanguage,
        defaultCommentLanguage,
        additionalSystemPrompt: cfg.get<string>('cotab.prompt.additionalSystemPrompt', ''),
        additionalUserPrompt: cfg.get<string>('cotab.prompt.additionalUserPrompt', ''),
        additionalAssistantThinkPrompt: cfg.get<string>('cotab.prompt.additionalAssistantThinkPrompt', ''),
        additionalAssistantOutputPrompt: cfg.get<string>('cotab.prompt.additionalAssistantOutputPrompt', ''),

        // promptDetail
        startEditingHereSymbol: cfg.get<string>('cotab.promptDetail.startEditingHereSymbol', '###START_EDITING_HERE###'),
        stopEditingHereSymbol: cfg.get<string>('cotab.promptDetail.stopEditingHereSymbol', '###STOP_EDITING_HERE###'),
        completeHereSymbol: cfg.get<string>('cotab.promptDetail.completeHereSymbol', '<|__EDITING_HERE__|>'),
        aroundBeforeLines: cfg.get<number>('cotab.promptDetail.aroundBeforeLines', 0),
        aroundAfterLines: cfg.get<number>('cotab.promptDetail.aroundAfterLines', 5),
        aroundMergeAfterLines: cfg.get<number>('cotab.promptDetail.aroundMergeAfterLines', 20),
        aroundCacheBeforeLines: cfg.get<number>('cotab.promptDetail.aroundCacheBeforeLines', 5),
        aroundCacheAfterLines: cfg.get<number>('cotab.promptDetail.aroundCacheAfterLines', 15),
        aroundLatestAddBeforeLines: cfg.get<number>('cotab.promptDetail.aroundLatestAddBeforeLines', 15),
        aroundLatestAddAfterLines: cfg.get<number>('cotab.promptDetail.aroundLatestAddAfterLines', 15),
        maxSymbolCharNum: cfg.get<number>('cotab.promptDetail.maxSymbolCharNum', 12000),
        enableCodeSummary: cfg.get<boolean>('cotab.promptDetail.enableCodeSummary', false),
        withLineNumber: true,   // line number for code block

        // ui
        showProgressSpinner: cfg.get<boolean>('cotab.ui.showProgressSpinner', true),

        // detail
        logLevel: logLevel,
        
        isCurrentEnabled(): boolean {
            const languageId: string = vscode.window.activeTextEditor?.document.languageId || '';
            return getConfig().enabled && this.isExtensionEnabled(languageId);
        },
        isExtensionEnabled(extensionId: string): boolean {
            const extensions = this.disableForExtensions.split(',');
            return !extensions.includes(extensionId);
        },
    };
}

export async function setConfigGlobalEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.basic.enabled', enabled, vscode.ConfigurationTarget.Global);
}

export async function setConfigExtensionEnabled(extensionId: string, enabled: boolean) {
    const disable = !enabled;
    const disables = getConfig().disableForExtensions.split(',');
    if (disable) {
        if (! disables.includes(extensionId)) {
            disables.push(extensionId);
        }
    }
    else {
        if (disables.includes(extensionId)) {
            disables.splice(disables.indexOf(extensionId), 1);
        }
    }

    await vscode.workspace.getConfiguration()
        .update('cotab.basic.disableForExtensions', disables.join(','), vscode.ConfigurationTarget.Global);
}

export async function setConfigSelectedPromptMode(mode: string): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.basic.selectedPromptMode', mode, vscode.ConfigurationTarget.Global);
}

export async function setConfigApiBaseURL(url: string): Promise<void> {
    const trimed = url.trim();
    const val = (trimed !== '') ? trimed : undefined;
    await vscode.workspace.getConfiguration()
        .update('cotab.llm.apiBaseURL', val, vscode.ConfigurationTarget.Global);
}

export async function setConfigApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    const val = trimmed !== '' ? trimmed : undefined;
    await vscode.workspace.getConfiguration()
        .update('cotab.llm.apiKey', val, vscode.ConfigurationTarget.Global);
}

export async function setConfigModel(model: string): Promise<void> {
    const trimmed = String(model || '').trim();
    const val = trimmed !== '' ? trimmed : undefined;
    await vscode.workspace.getConfiguration()
        .update('cotab.llm.model', val, vscode.ConfigurationTarget.Global);
}

export async function setConfigHideOnStartup(hide: boolean): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.gettingStarted.hideOnStartup', hide, vscode.ConfigurationTarget.Global);
}

export async function setConfigShowProgressSpinner(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.ui.showProgressSpinner', enabled, vscode.ConfigurationTarget.Global);
}

export async function setConfigCommentLanguage(language: string): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.basic.commentLanguage', language.trim(), vscode.ConfigurationTarget.Global);
}

export async function setConfigLocalServerContextSize(size: number): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.llm.localServerContextSize', size, vscode.ConfigurationTarget.Global);
}

export async function setConfigLocalServerPreset(preset: LocalServerPreset): Promise<void> {
    await vscode.workspace.getConfiguration()
        .update('cotab.llm.localServerPreset', preset, vscode.ConfigurationTarget.Global);
}

export async function setConfigLocalServerCustom(custom: string): Promise<void> {
    const value = String(custom ?? '');
    await vscode.workspace.getConfiguration()
        .update('cotab.llm.localServerCustom', value, vscode.ConfigurationTarget.Global);
}


// Get VS Code UI locale
function getUiLocale(): string {
	const locale = vscode.env.language || 'en';
	return locale.toLowerCase();
}

// Get OS locale
function getOsLocale(): string {
	// 1) Try to get locale from Unix environment variables first
	const envLocale =
		process.env.LC_ALL ||
		process.env.LC_MESSAGES ||
		process.env.LANG ||
		process.env.LANGUAGE ||
		process.env.LC_CTYPE;

	let candidate = envLocale;

		// 2) Fallback to OS locale detection for Windows/macOS/Electron
		if (!candidate) {
			try {
				// For Windows, try to get OS locale from system
				if (process.platform === 'win32') {
					// Get Windows locale from registry
					const locale = execSync('powershell -Command "Get-Culture | Select-Object -ExpandProperty Name"', { encoding: 'utf8' }).trim();
					if (locale) {
						candidate = locale;
					}
				} else {
					// For macOS/Linux, try Intl API as fallback
					candidate = new Intl.DateTimeFormat().resolvedOptions().locale;
				}
			} catch (localeError) {
				logDebug(`Failed to detect OS locale: ${localeError}`);
			}
		}

	// 3) Final fallback to VS Code UI language
	if (!candidate) return getUiLocale();

	// Normalize to BCP47 and extract language subtag only
	try {
		const normalized = Intl.getCanonicalLocales(
			candidate.replace('_', '-').split('.')[0] // ja_JP.UTF-8 -> ja-JP
		)[0] || '';
		const primary = normalized.split('-')[0].toLowerCase();

		// Handle C/POSIX locale fallback
		if (primary === 'c' || primary === 'posix' || primary === '') return 'en';

		return primary;
	} catch {
		return getUiLocale();
	}
}

// Get language name (autonym) from UI locale
function getDisplayLanguageName(locale: string): string {
	try {
		// Get autonym if Intl.DisplayNames is available
		const dn = new (Intl as any).DisplayNames([locale], { type: 'language' }); // eslint-disable-line @typescript-eslint/no-explicit-any
		const name = dn?.of(locale);
		if (typeof name === 'string' && 0 < name.length) return name;
	} catch (displayNameError) {
		logDebug(`Failed to resolve display language name: ${displayNameError}`);
	}

	// Fallback (major languages only)
	const autonyms: Record<string, string> = {
		'en': 'English',
		'ja': '日本語',
		'zh-cn': '简体中文', // eslint-disable-line @typescript-eslint/naming-convention
		'zh-tw': '繁體中文', // eslint-disable-line @typescript-eslint/naming-convention
		'zh': '中文',
		'ko': '한국어',
		'fr': 'Français',
		'de': 'Deutsch',
		'es': 'Español',
		'it': 'Italiano',
		'pt-br': 'Português (Brasil)', // eslint-disable-line @typescript-eslint/naming-convention
		'pt': 'Português',
		'ru': 'Русский',
		'nl': 'Nederlands',
		'pl': 'Polski',
		'vi': 'Tiếng Việt',
		'hi': 'हिन्दी',
		'ar': 'العربية',
		'he': 'עברית',
	};
	const key = autonyms[locale] ? locale : (locale.split('-')[0] || 'en');
	return autonyms[key] || 'English';
}

function getActiveThemeName(): string {
	try {
		const cfg = vscode.workspace.getConfiguration('workbench');
		const theme = cfg.get<string>('colorTheme');
		if (theme && theme.length) return theme;
	} catch (themeError) {
		logDebug(`Failed to read active theme: ${themeError}`);
	}
    
	return isDarkTheme() ? 'Dark+ (default dark)' : 'Light+ (default light)';
}

function getEditorBackgroundColor(): string {
	try {
		// Get background color from VS Code color theme
		const colorTheme = vscode.window.activeColorTheme;
		
		// Get editor background color (considering workbench.colorCustomizations)
		const editorBackground = vscode.window.activeTextEditor?.document.uri 
			? vscode.workspace.getConfiguration('workbench', vscode.window.activeTextEditor.document.uri)
				.get('colorCustomizations') as any // eslint-disable-line @typescript-eslint/no-explicit-any
			: null;
		
		// Get default background color
		const defaultBackground = colorTheme.kind === vscode.ColorThemeKind.Light 
			? '#ffffff' 
			: '#1e1e1e';
		
		// Use customized background color if available
		if (editorBackground?.editor?.background) {
			return editorBackground.editor.background;
		}
		
		// Get theme background color
		// VS Code's ColorTheme API doesn't allow direct access to colors property,
		// so use default background color
		
		return defaultBackground;
	} catch (_error) {
		//logDebug(`Error getting editor background color: ${error}`);
		// Return default background color as fallback
		return vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light 
			? '#ffffff' 
			: '#1e1e1e';
	}
}

function toKebabCase(str: string): string {
    return str
        .toLowerCase()
        .replace(/[\s_]+/g, "-") // replace spaces and underscores with hyphens
        .replace(/\(|\)/g, ""); // remove parentheses
}

function isShikiThemeExists(themeNameKebab: string): themeNameKebab is BundledTheme {
    const themeArray: BundledTheme[] = [
        "andromeeda",
        "aurora-x",
        "ayu-dark",
        "catppuccin-frappe",
        "catppuccin-latte",
        "catppuccin-macchiato",
        "catppuccin-mocha",
        "dark-plus",
        "dracula",
        "dracula-soft",
        "everforest-dark",
        "everforest-light",
        "github-dark",
        "github-dark-default",
        "github-dark-dimmed",
        "github-dark-high-contrast",
        "github-light",
        "github-light-default",
        "github-light-high-contrast",
        "gruvbox-dark-hard",
        "gruvbox-dark-medium",
        "gruvbox-dark-soft",
        "gruvbox-light-hard",
        "gruvbox-light-medium",
        "gruvbox-light-soft",
        "houston",
        "kanagawa-dragon",
        "kanagawa-lotus",
        "kanagawa-wave",
        "laserwave",
        "light-plus",
        "material-theme",
        "material-theme-darker",
        "material-theme-lighter",
        "material-theme-ocean",
        "material-theme-palenight",
        "min-dark",
        "min-light",
        "monokai",
        "night-owl",
        "nord",
        "one-dark-pro",
        "one-light",
        "plastic",
        "poimandres",
        "red",
        "rose-pine",
        "rose-pine-dawn",
        "rose-pine-moon",
        "slack-dark",
        "slack-ochin",
        "snazzy-light",
        "solarized-dark",
        "solarized-light",
        "synthwave-84",
        "tokyo-night",
        "vesper",
        "vitesse-black",
        "vitesse-dark",
        "vitesse-light",
    ];

    return themeArray.includes(themeNameKebab as BundledTheme);
}

export function toShikiThemeName(themeName: string): string {
    const kebabTheme = toKebabCase(themeName);
    // check default theme
    if (themeName === "Default Dark Modern") {
        return "dark-plus";
    }
    else if (themeName === "Default Light Modern") {
        return "light-plus";
    }
    // check shiki theme
    else if ( isShikiThemeExists(kebabTheme) ) {
      return kebabTheme;
    }
    // Faullback to dark or light character
    else if (themeName.toLowerCase().includes('dark')) {
        return "dark-plus";
    }
    else if (themeName.toLowerCase().includes('light')) {
        return "light-plus";
    }
    // Fallback to default theme for unsupported themes.
    else {
      return "dark-plus";
    }
}

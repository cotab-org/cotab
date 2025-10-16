import * as vscode from 'vscode';
import { BundledTheme } from "shiki";
import { extensions } from 'vscode';

let configCache: CotabConfig | null = null;

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
    autoTriggerOnCursorMove: boolean;

    // llm
    provider: 'OpenAICompatible';
    apiBaseURL: string;
    localServerArg: string;
    model: string;
    temperature: number;
    top_p: number;
    top_k: number;
    maxTokens: number;
    maxOutputLines: number;
    timeoutMs: number;

    // prompt
    overrideSystemPrompt: string;
    additionalSystemPrompt: string;
    overrideUserPrompt: string;
    additionalUserPrompt: string;
    overrideAssistantThinkPrompt: string;
    additionalAssistantThinkPrompt: string;
    overrideAssistantOutputPrompt: string;
    additionalAssistantOutputPrompt: string;
    // When empty, uses vscode.env.language. Settings take priority if specified
    commentLanguage: string;

    // promptDetail
    startEditingHereSymbol: string;
    stopEditingHereSymbol: string;
    completeHereSymbol: string;
    aroundBeforeLines: number;  // Number of lines around cursor
    aroundAfterLines: number;   // Number of lines around cursor
    aroundMergeAfterLines: number;   // Number of lines around cursor used during merge
    aroundCacheBeforeLines: number;  // Number of lines around cursor for cache utilization
    aroundCacheAfterLines: number;   // Number of lines around cursor for cache utilization

    // Code block
    maxSymbolCount: number; // Maximum number of symbols to include in symbol code blocks
    withLineNumber: boolean; // The number of lines to include in the line number so that llm can determine

    // detail
    logLevel: string;

    // server management
    serverAutoStart: boolean;
    serverAutoStopOnIdleTime: number;

    isCurrentEnabled(): boolean;
    isExtensionEnabled(extensionId: string): boolean;
}

// Clear cache when configuration changes
export function registerConfigWatcher(disposables: vscode.Disposable[],
                                        onEnabledChange: () => void): void {
    let prevEnable = getConfig().enabled;
    const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('cotab')) {
            configCache = null;

            const nowEnable = getConfig().enabled;
            if (prevEnable !== nowEnable) {
                prevEnable = nowEnable;
                onEnabledChange();
            }
        }
    });
    
    // Add to disposables to manage with extension lifecycle
    disposables.push(disposable);
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
    
    const commentLanguage = cfg.get<string>('cotab.prompt.commentLanguage', '').trim();
    const editorLanguage = commentLanguage || getDisplayLanguageName(getUiLocale());
    const configuredLineHeight = Number(cfg.get<number>('lineHeight') || 0);
    const fontSize = Number(cfg.get<number>('fontSize') || 14);
    const lineHeight = configuredLineHeight > 0 ? configuredLineHeight : Math.round(fontSize * LINE_HEIGHT_RATIO);
    const themeName = getActiveThemeName();
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
        autoTriggerOnCursorMove: cfg.get<boolean>('cotab.basic.autoTriggerOnCursorMove', true),

        // llm
        provider: cfg.get<'OpenAICompatible'>('cotab.llm.provider', 'OpenAICompatible'),
        apiBaseURL: cfg.get<string>('cotab.llm.apiBaseURL', 'http://localhost:8080/v1'),
        localServerArg: cfg.get<string>('cotab.llm.localServerArg', '-hf unsloth/Qwen3-4B-Instruct-2507-GGUF --temp 0.7 --top-p 0.8 --top-k 20 --min-p 0.01 --repeat-penalty 1.05 --jinja -fa on -ngl 999 -c 32768 -ctk q8_0 -ctv q8_0'),
        model: cfg.get<string>('cotab.llm.model', 'qwen3-4b-2507'),
        temperature: cfg.get<number>('cotab.llm.temperature', 0.1),
        top_p: cfg.get<number>('cotab.llm.top_p', -1),
        top_k: cfg.get<number>('cotab.llm.top_k', -1),
        maxTokens: cfg.get<number>('cotab.llm.maxTokens', 256),
        maxOutputLines: cfg.get<number>('cotab.llm.maxOutputLines', 15),
        timeoutMs: cfg.get<number>('cotab.llm.timeoutMs', 30000),

        // prompt
        commentLanguage: editorLanguage,
        overrideSystemPrompt: cfg.get<string>('cotab.prompt.overrideSystemPrompt', ''),
        additionalSystemPrompt: cfg.get<string>('cotab.prompt.additionalSystemPrompt', ''),
        overrideUserPrompt: cfg.get<string>('cotab.prompt.overrideUserPrompt', ''),
        additionalUserPrompt: cfg.get<string>('cotab.prompt.additionalUserPrompt', ''),
        overrideAssistantThinkPrompt: cfg.get<string>('cotab.prompt.overrideAssistantThinkPrompt', ''),
        additionalAssistantThinkPrompt: cfg.get<string>('cotab.prompt.additionalAssistantThinkPrompt', ''),
        overrideAssistantOutputPrompt: cfg.get<string>('cotab.prompt.overrideAssistantOutputPrompt', ''),
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
        maxSymbolCount: cfg.get<number>('cotab.promptDetail.maxSymbolCount', 300),
        withLineNumber: true,   // line number for code block

        // detail
        logLevel: cfg.get<string>('cotab.detail.logLevel', 'INFO'),

        // server management
        serverAutoStart: cfg.get<boolean>('cotab.server.autoStart', true),
        serverAutoStopOnIdleTime: cfg.get<number>('cotab.server.autoStopOnIdleTime', 300),
        
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


// Get VS Code UI locale
function getUiLocale(): string {
	const locale = vscode.env.language || 'en';
	return locale.toLowerCase();
}

// Get language name (autonym) from UI locale
function getDisplayLanguageName(locale: string): string {
	try {
		// Get autonym if Intl.DisplayNames is available
		const dn = new (Intl as any).DisplayNames([locale], { type: 'language' });
		const name = dn?.of(locale);
		if (typeof name === 'string' && 0 < name.length) return name;
	} catch {}

	// Fallback (major languages only)
	const autonyms: Record<string, string> = {
		'en': 'English',
		'ja': '日本語',
		'zh-cn': '简体中文',
		'zh-tw': '繁體中文',
		'zh': '中文',
		'ko': '한국어',
		'fr': 'Français',
		'de': 'Deutsch',
		'es': 'Español',
		'it': 'Italiano',
		'pt-br': 'Português (Brasil)',
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
	} catch {}
	const kind = vscode.window.activeColorTheme.kind;
	return kind === vscode.ColorThemeKind.Light ? 'Light+ (default light)' : 'Dark+ (default dark)';
}

function getEditorBackgroundColor(): string {
	try {
		// Get background color from VS Code color theme
		const colorTheme = vscode.window.activeColorTheme;
		
		// Get editor background color (considering workbench.colorCustomizations)
		const editorBackground = vscode.window.activeTextEditor?.document.uri 
			? vscode.workspace.getConfiguration('workbench', vscode.window.activeTextEditor.document.uri)
				.get('colorCustomizations') as any
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
	} catch (error) {
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
    if ( isShikiThemeExists(kebabTheme) || themeName === "Default Dark Modern" ) {
      return themeName === "Default Dark Modern" ? "dark-plus" : kebabTheme;
    } else {
      return "dark-plus";   // Fallback to default theme for unsupported themes.
    }
}

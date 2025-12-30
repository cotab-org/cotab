import * as vscode from 'vscode';
import { registerLargeFileManager } from './managers/largeFileManager';
import { registerSuggestionManager } from './suggestion/suggestionManager';
import { registerSuggestionCommands } from './suggestion/suggestionCommands';
import { registerAutoSuggestionTrigger } from './suggestion/suggestionTriggerRegister';
import { registerSymbolManager } from './managers/symbolManager';
import { registerEditHistory } from './managers/editHistoryManager';
import { registerDiagnosticsManager } from './managers/diagnosticsManager';
import { registerConfigWatcher, getConfig } from './utils/config';
import { registerClipboardDetection } from './managers/clipboardManager';
import { registerTabHistory } from './managers/TabHistoryManager';
import { registerStatusBarManager, statusBarManager } from './ui/statusBarManager';
import { registerProgressGutterIcon } from './ui/progressGutterIconManager';
import { registerMenuIndicator } from './ui/menuIndicator';
import { registerTerminalCommand } from './utils/terminalCommand';
import { registerServerManager, stopServerOnExit } from './managers/serverManager';
import { registerYamlConfig } from './utils/yamlConfig';
import { registerGettingStartedView } from './ui/gettingStartedView';
import { checkAndUpdatePluginVersion } from './utils/systemConfig';
import { registerViewChangelog } from './ui/viewChangelog';

const cotabDisposables: vscode.Disposable[] = [];
let cotabPrevEnabled: boolean = false;

export function onChangedEnableExtension(enabled: boolean) {
	if (enabled != cotabPrevEnabled) {
		if (enabled) {
			cotabActive();
		}
		else {
			cotabDeactive();
		}
	}
	cotabPrevEnabled = enabled;
}

export function activate(context: vscode.ExtensionContext) {
	// Module that enables activation even when auto-complete is disabled
	activateBasic(context);
	
	// Activate Cotab Enable Modules
	onChangedEnableExtension(getConfig().enabled);

	// Display welcome message
	activateWelcomeModule(context);
}

function activateBasic(context: vscode.ExtensionContext): void {

	// watch config enable change
	registerConfigWatcher(context.subscriptions, () => {
		onChangedEnableExtension(getConfig().enabled)
	});

	registerYamlConfig(context.subscriptions);

	registerTerminalCommand(context.subscriptions);

	// Always display bottom-right status bar menu
	registerStatusBarManager(context.subscriptions);
	
	// Register menu indicator
	registerMenuIndicator(context.subscriptions);
	
    // Register server manager
    registerServerManager(context.subscriptions, context);
}

function activateWelcomeModule(context: vscode.ExtensionContext): void {

	// Check plugin version on startup
	const { prevVersion, currentVersion } = checkAndUpdatePluginVersion();

    // GettingStartedView	
    registerGettingStartedView(context.subscriptions, context, prevVersion, currentVersion);

	// Register viewChangelog
	registerViewChangelog(context, prevVersion, currentVersion);
}

export function deactivate() {
	stopServerOnExit();

	cotabDeactive();
}

function cotabActive() {
	registerLargeFileManager(cotabDisposables);

	registerSuggestionManager(cotabDisposables);

	registerSuggestionCommands(cotabDisposables);

	registerAutoSuggestionTrigger(cotabDisposables);

	registerEditHistory(cotabDisposables);

	registerDiagnosticsManager(cotabDisposables);

	// Start clipboard detection
	registerClipboardDetection(cotabDisposables);

	registerSymbolManager(cotabDisposables);

	registerTabHistory(cotabDisposables);

	// spinner icon. line left decoration
	registerProgressGutterIcon(cotabDisposables);
}

function cotabDeactive() {
	statusBarManager.reset();

	cotabDisposables.forEach(disposable => disposable.dispose());
	cotabDisposables.length = 0;
}

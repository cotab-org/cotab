import * as vscode from 'vscode';
import { registerSuggestionManager } from './suggestion/suggestionManager';
import { logDebug, logInfo } from './utils/logger';
import { registerSuggestionCommands } from './suggestion/suggestionCommands';
import { registerAutoSuggestionTrigger } from './suggestion/suggestionTriggerRegister';
import { registerSymbolManager } from './managers/symbolManager';
import { registerEditHistory } from './managers/editHistoryManager';
import { registerConfigWatcher, getConfig } from './utils/config';
import { registerClipboardDetection } from './managers/clipboardManager';
import { registerTabHistory } from './managers/TabHistoryManager';
import { registerStatusBarManager, statusBarManager } from './ui/statusBarManager';
import { registerProgressGutterIcon } from './ui/progressGutterIconManager';
import { registerMenuIndicator } from './ui/menuIndicator';
import { registerTerminalCommand } from './utils/terminalCommand';
import { registerServerManager, autoStopServerOnExit } from './managers/serverManager';
import { registerYamlConfig } from './utils/yamlConfig';
import { registerQuickSetup } from './ui/quickSetup';

const cotabDisposables: vscode.Disposable[] = [];
let cotabContext: vscode.ExtensionContext;
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
	// watch config enable change
	registerConfigWatcher(context.subscriptions, () => {
		onChangedEnableExtension(getConfig().enabled)
	});

	registerYamlConfig(cotabDisposables);

	registerTerminalCommand(cotabDisposables);

	// Always display bottom-right status bar menu
	registerStatusBarManager(context.subscriptions);
	
	// Register menu indicator
	registerMenuIndicator(context.subscriptions);

    // Quick Setup
    registerQuickSetup(context.subscriptions, context);
	
	cotabContext = context;

	onChangedEnableExtension(getConfig().enabled);
	
    // Register server manager
    registerServerManager(context.subscriptions, context);
}

export function deactivate() {
	autoStopServerOnExit();

	cotabDeactive();
}

function cotabActive() {
		
	registerSuggestionManager(cotabDisposables);

	registerSuggestionCommands(cotabDisposables);

	registerAutoSuggestionTrigger(cotabDisposables);

	registerEditHistory(cotabDisposables);

	// Start clipboard detection
	registerClipboardDetection(cotabDisposables);

	registerSymbolManager(cotabDisposables);

	registerTabHistory(cotabDisposables);

	// spinner icon. line left decoration
	registerProgressGutterIcon(cotabDisposables);
}

function cotabDeactive() {
	cotabDisposables.forEach(disposable => disposable.dispose());
	cotabDisposables.length = 0;

	statusBarManager.reset();
}

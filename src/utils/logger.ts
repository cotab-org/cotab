import * as vscode from 'vscode';
import { getConfig } from '../utils/config';

const channel = vscode.window.createOutputChannel('Cotab');

// Log levels
export enum LogLevel {
	error = 0,
	warning = 1,
	info = 2,
	debug = 3,
	
	server = info,
	terminal = info,
}

// Get current log level
function getCurrentLogLevel(): LogLevel {
	const config = getConfig();
	const levelStr = config.logLevel;
	
	switch (levelStr.toUpperCase()) {
		case 'ERROR': return LogLevel.error;
		case 'WARNING': return LogLevel.warning;
		case 'INFO': return LogLevel.info;
		case 'DEBUG': return LogLevel.debug;
		case 'SERVER': return LogLevel.server;
		default: return LogLevel.info;
	}
}

// Log output function
function log(level: LogLevel, prefix: string, message: string, isForce: boolean = false) {
	if (isForce || level <= getCurrentLogLevel()) {
		channel.appendLine(`${prefix} ${message}`);
	}
}

export function logError(message: string) {
	log(LogLevel.error, '[ERROR]', message);
}

export function logWarning(message: string) {
	log(LogLevel.warning, '[WARNING]', message);
}

export function logInfo(message: string) {
	log(LogLevel.info, '[INFO]', message);
}

export function logDebug(message: string) {
	log(LogLevel.debug, '[DEBUG]', message);
}

export function logServer(message: string) {
	log(LogLevel.server, '[SERVER]', message);
}

export function logTerminal(message: string) {
	log(LogLevel.terminal, '[TERMINAL]', message, true);
}

export function showLogWindow(preserveFocus: boolean = false) {
	try {
		channel.show(preserveFocus);
	} catch (error) {
		logDebug(`Failed to show log window: ${error}`);
	}
}




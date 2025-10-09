import * as vscode from 'vscode';
import { getConfig } from '../utils/config';

const channel = vscode.window.createOutputChannel('Cotab');

// Log levels
export enum LogLevel {
	ERROR = 0,
	WARNING = 1,
	INFO = 2,
	DEBUG = 3,
	
	SERVER = INFO,
	TERMINAL = INFO,
}

// Get current log level
function getCurrentLogLevel(): LogLevel {
	const config = getConfig();
	const levelStr = config.logLevel;
	
	switch (levelStr.toUpperCase()) {
		case 'ERROR': return LogLevel.ERROR;
		case 'WARNING': return LogLevel.WARNING;
		case 'INFO': return LogLevel.INFO;
		case 'DEBUG': return LogLevel.DEBUG;
		case 'SERVER': return LogLevel.SERVER;
		default: return LogLevel.INFO;
	}
}

// Log output function
function log(level: LogLevel, prefix: string, message: string, isForce: boolean = false) {
	if (isForce || level <= getCurrentLogLevel()) {
		channel.appendLine(`${prefix} ${message}`);
	}
}

export function logError(message: string) {
	log(LogLevel.ERROR, '[ERROR]', message);
}

export function logWarning(message: string) {
	log(LogLevel.WARNING, '[WARNING]', message);
}

export function logInfo(message: string) {
	log(LogLevel.INFO, '[INFO]', message);
}

export function logDebug(message: string) {
	log(LogLevel.DEBUG, '[DEBUG]', message);
}

export function logServer(message: string) {
	log(LogLevel.SERVER, '[SERVER]', message);
}

export function logTerminal(message: string) {
	log(LogLevel.TERMINAL, '[TERMINAL]', message, true);
}

export function showLogWindow(preserveFocus: boolean = false) {
	channel.show(preserveFocus);
}




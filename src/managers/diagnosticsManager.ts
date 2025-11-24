import * as vscode from 'vscode';
import { logDebug } from '../utils/logger';

export function registerDiagnosticsManager(disposables: vscode.Disposable[]) {
    diagnosticsManager = new DiagnosticsManager();
    disposables.push(diagnosticsManager);
}

export let diagnosticsManager: DiagnosticsManager;

interface DiagnosticsCache {
    lastUpdated: number;
    lastAccessed: number;
    diagnosticsMap: Map<string, vscode.Diagnostic[]>;
}

class DiagnosticsManager implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private cache: DiagnosticsCache | undefined;

    constructor() {}

    dispose() {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
        this.cache = undefined;
    }
    
    public getErrors(document: vscode.TextDocument, line: number): Map<string, vscode.Diagnostic[]> {
        // Check if the cached diagnostics are still valid (based on version or timestamp)
        if (this.cache && (Date.now() - this.cache.lastUpdated < 1000)) {
            return this.cache.diagnosticsMap;
        }

        const diagnosticsAll = vscode.languages.getDiagnostics();

        const startLine = Math.max(line - 0, 0);
        const endLine = line + 3;
        
        let diagnosticsMap = new Map<string, vscode.Diagnostic[]>();
        for (const [uri, diagnotics] of diagnosticsAll) {
            // Check same document language
            const diagnosticsDocument = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
            if (!diagnosticsDocument) continue;
            if (diagnosticsDocument.languageId !== document.languageId)　continue;

            const filteredDiagnostics: vscode.Diagnostic[] = [];
            for(const diagnotic of diagnotics) {
                // Only Error
                if (diagnotic.severity !== vscode.DiagnosticSeverity.Error) continue;
                
                //if (diagnotic.range.end.line < startLine || diagnotic.range.start.line > endLine) continue;

                
                filteredDiagnostics.push(diagnotic);
            }
            diagnosticsMap.set(uri.toString(), filteredDiagnostics);
        }
        
        // Set cache
        this.cache = {
            lastUpdated: Date.now(),
            lastAccessed: Date.now(),
            diagnosticsMap: diagnosticsMap,
        };

        return diagnosticsMap;
    }
}
// src/types/lsp.ts

import {
  Diagnostic,
  Location,
  LocationLink,
  Position,
  TextEdit,
} from 'vscode-languageserver-protocol';

export interface TypeScriptPreferences {
  importModuleSpecifierPreference?: 'relative' | 'non-relative';
  includeCompletionsForModuleExports?: boolean;
  includeCompletionsForImportStatements?: boolean;
  includeCompletionsWithSnippetText?: boolean;
  includeAutomaticOptionalChainCompletions?: boolean;
  includeInlayParameterNameHints?: 'all' | 'literals' | 'none';
  includeInlayPropertyDeclarationTypeHints?: boolean;
  includeInlayFunctionLikeReturnTypeHints?: boolean;
}

export interface TypeScriptServerInitializationOptions {
  preferences?: TypeScriptPreferences;
}

export interface LSPManager {
  startServer(languageId: string): Promise<void>;
  stopServer(languageId: string): Promise<void>;
  getServer(languageId: string): Promise<LanguageServer>;
  validateDocument(
    uri: string,
    content: string,
    languageId: string
  ): Promise<Diagnostic[]>;
}

export interface LanguageServer {
  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // Document sync
  didOpen(uri: string, content: string, version: number): Promise<void>;
  didChange(uri: string, changes: TextEdit[], version: number): Promise<void>;
  didClose(uri: string): Promise<void>;

  // Features
  validateDocument(uri: string, content: string): Promise<Diagnostic[]>;
  formatDocument(uri: string, content: string): Promise<TextEdit[]>;
  getDefinition(
    uri: string,
    position: Position
  ): Promise<Location[] | LocationLink[]>;
}

export interface DiagnosticHandler {
  (diagnostics: Diagnostic[]): void;
}

export interface DiagnosticHandlers {
  [uri: string]: DiagnosticHandler[];
}

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

/**
 * Service for managing LSP servers
 */
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

/**
 * Represents a language server instance
 */
export interface LanguageServer {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  validateDocument(uri: string, content: string): Promise<Diagnostic[]>;
  formatDocument(uri: string, content: string): Promise<TextEdit[]>;
  getDefinition(
    uri: string,
    position: Position
  ): Promise<Location[] | LocationLink[]>;
}

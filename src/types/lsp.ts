// src/types/lsp.ts
import { TextEdit, Position, Diagnostic, Location } from "vscode-languageserver-protocol";

/**
 * Service for managing LSP servers
 */
export interface LSPManager {
  startServer(languageId: string): Promise<void>;
  stopServer(languageId: string): Promise<void>;
  getServer(languageId: string): Promise<LanguageServer>;
  validateDocument(uri: string, content: string): Promise<Diagnostic[]>;
}

/**
 * Represents a language server instance
 */
export interface LanguageServer {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  validateDocument(uri: string, content: string): Promise<Diagnostic[]>;
  formatDocument(uri: string, content: string): Promise<TextEdit[]>;
  getDefinition(uri: string, position: Position): Promise<Location[]>;
}
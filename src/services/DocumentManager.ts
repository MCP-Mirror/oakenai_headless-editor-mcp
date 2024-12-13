// src/services/DocumentManager.ts
import {
  Diagnostic,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { BaseError } from '../types/errors.js';
import { LSPManager } from '../types/lsp.js';
import { FileSystemManager } from '../utils/fs.js';
import { Logger } from '../utils/logger.js';

export class DocumentError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `DOCUMENT_${code}`, details);
  }
}

interface DocumentState {
  version: number;
  isDirty: boolean;
  lastModified: number;
  diagnostics: Diagnostic[];
}

interface DocumentOptions {
  languageId: string;
  version?: number;
}

export class DocumentManager {
  private documents: Map<string, TextDocument>;
  private documentStates: Map<string, DocumentState>;

  constructor(
    private readonly fs: FileSystemManager,
    private readonly lspManager: LSPManager,
    private readonly logger: Logger
  ) {
    this.documents = new Map();
    this.documentStates = new Map();
  }

  /**
   * Opens a document and initializes its state
   */
  async openDocument(
    uri: string,
    options: DocumentOptions
  ): Promise<TextDocument> {
    try {
      // Validate URI
      const parsedUri = URI.parse(uri);
      const filePath = parsedUri.fsPath;

      // Check if document already exists
      if (this.documents.has(uri)) {
        throw new DocumentError('Document already open', 'ALREADY_OPEN', {
          uri,
        });
      }

      // Read file content
      const content = await this.fs.readFile(filePath);

      // Create text document
      const document = TextDocument.create(
        uri,
        options.languageId,
        options.version || 1,
        content
      );

      // Initialize document state
      const state: DocumentState = {
        version: document.version,
        isDirty: false,
        lastModified: Date.now(),
        diagnostics: [],
      };

      // Store document and state
      this.documents.set(uri, document);
      this.documentStates.set(uri, state);

      // Initialize language server
      const server = await this.lspManager.getServer(options.languageId);
      await server.validateDocument(uri, content);

      this.logger.info('Opened document', {
        uri,
        languageId: options.languageId,
        version: document.version,
      });

      return document;
    } catch (error) {
      this.logger.error('Failed to open document', error as Error, { uri });
      throw error;
    }
  }

  /**
   * Gets an open document
   */
  getDocument(uri: string): TextDocument {
    const document = this.documents.get(uri);
    if (!document) {
      throw new DocumentError('Document not found', 'NOT_FOUND', { uri });
    }
    return document;
  }

  /**
   * Applies edits to a document
   */
  async applyEdits(uri: string, edits: TextEdit[]): Promise<TextDocument> {
    try {
      const document = this.getDocument(uri);
      const state = this.getDocumentState(uri);

      // Apply edits
      const newContent = TextDocument.applyEdits(document, edits);
      const newVersion = state.version + 1;

      // Create new document with changes
      const updatedDocument = TextDocument.create(
        uri,
        document.languageId,
        newVersion,
        newContent
      );

      // Update state
      const updatedState: DocumentState = {
        ...state,
        version: newVersion,
        isDirty: true,
        lastModified: Date.now(),
      };

      // Store updates
      this.documents.set(uri, updatedDocument);
      this.documentStates.set(uri, updatedState);

      // Validate changes
      const server = await this.lspManager.getServer(document.languageId);
      const diagnostics = await server.validateDocument(uri, newContent);

      updatedState.diagnostics = diagnostics;

      this.logger.debug('Applied document edits', {
        uri,
        version: newVersion,
        editsCount: edits.length,
        diagnosticsCount: diagnostics.length,
      });

      return updatedDocument;
    } catch (error) {
      this.logger.error('Failed to apply edits', error as Error, { uri });
      throw error;
    }
  }

  /**
   * Saves document changes to disk
   */
  async saveDocument(uri: string): Promise<void> {
    try {
      const document = this.getDocument(uri);
      const state = this.getDocumentState(uri);

      if (!state.isDirty) {
        return;
      }

      // Parse URI to get file path
      const parsedUri = URI.parse(uri);
      const filePath = parsedUri.fsPath;

      // Write to file
      await this.fs.writeFile(filePath, document.getText());

      // Update state
      state.isDirty = false;
      this.documentStates.set(uri, state);

      this.logger.info('Saved document', {
        uri,
        version: state.version,
      });
    } catch (error) {
      this.logger.error('Failed to save document', error as Error, { uri });
      throw error;
    }
  }

  /**
   * Closes a document and cleans up resources
   */
  async closeDocument(uri: string): Promise<void> {
    try {
      // Check if document needs saving
      const state = this.getDocumentState(uri);
      if (state.isDirty) {
        await this.saveDocument(uri);
      }

      // Remove document and state
      this.documents.delete(uri);
      this.documentStates.delete(uri);

      this.logger.info('Closed document', { uri });
    } catch (error) {
      this.logger.error('Failed to close document', error as Error, { uri });
      throw error;
    }
  }

  /**
   * Updates document diagnostics
   */
  async updateDiagnostics(
    uri: string,
    diagnostics: Diagnostic[]
  ): Promise<void> {
    const state = this.getDocumentState(uri);
    state.diagnostics = diagnostics;
    this.documentStates.set(uri, state);

    this.logger.debug('Updated document diagnostics', {
      uri,
      diagnosticsCount: diagnostics.length,
    });
  }

  /**
   * Gets current document state
   */
  private getDocumentState(uri: string): DocumentState {
    const state = this.documentStates.get(uri);
    if (!state) {
      throw new DocumentError('Document state not found', 'STATE_NOT_FOUND', {
        uri,
      });
    }
    return state;
  }

  /**
   * Gets document content range
   */
  getRange(uri: string, range: Range): string {
    const document = this.getDocument(uri);
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    return document.getText().substring(start, end);
  }

  /**
   * Gets document position from offset
   */
  getPosition(uri: string, offset: number): Position {
    const document = this.getDocument(uri);
    return document.positionAt(offset);
  }

  /**
   * Gets document offset from position
   */
  getOffset(uri: string, position: Position): number {
    const document = this.getDocument(uri);
    return document.offsetAt(position);
  }

  /**
   * Validates a document
   */
  async validateDocument(uri: string): Promise<Diagnostic[]> {
    try {
      const document = this.getDocument(uri);
      const server = await this.lspManager.getServer(document.languageId);
      const diagnostics = await server.validateDocument(
        uri,
        document.getText()
      );

      await this.updateDiagnostics(uri, diagnostics);

      return diagnostics;
    } catch (error) {
      this.logger.error('Failed to validate document', error as Error, { uri });
      throw error;
    }
  }

  /**
   * Gets all currently open documents
   */
  getDocuments(): Map<string, TextDocument> {
    return new Map(this.documents);
  }

  /**
   * Checks if a document is open
   */
  hasDocument(uri: string): boolean {
    return this.documents.has(uri);
  }

  /**
   * Gets document version
   */
  getVersion(uri: string): number {
    const state = this.getDocumentState(uri);
    return state.version;
  }

  /**
   * Checks if document has unsaved changes
   */
  isDirty(uri: string): boolean {
    const state = this.getDocumentState(uri);
    return state.isDirty;
  }

  /**
   * Gets document diagnostics
   */
  getDiagnostics(uri: string): Diagnostic[] {
    const state = this.getDocumentState(uri);
    return state.diagnostics;
  }

  /**
   * Dispose of the document manager
   */
  async dispose(): Promise<void> {
    // Save and close all open documents
    const uris = Array.from(this.documents.keys());
    await Promise.all(uris.map((uri) => this.closeDocument(uri)));

    this.documents.clear();
    this.documentStates.clear();

    this.logger.info('Disposed document manager');
  }
}

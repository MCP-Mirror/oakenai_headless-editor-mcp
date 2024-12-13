// src/services/languages/typescript.ts
import { ChildProcess, spawn } from 'child_process';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  CodeAction,
  CodeActionRequest,
  Command,
  CompletionItem,
  CompletionRequest,
  createProtocolConnection,
  DefinitionRequest,
  Diagnostic,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  InitializeParams,
  InitializeRequest,
  Location,
  LocationLink,
  Position,
  ProtocolConnection,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol';
import {
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node.js';
import { URI } from 'vscode-uri';
import { BaseError } from '../../types/errors.js';
import { Logger } from '../../utils/logger.js';

export class TypeScriptServerError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `TS_SERVER_${code}`, details);
  }
}

interface TypeScriptServerConfig {
  rootPath: string;
  tsconfigPath?: string;
  maxTsServerMemory?: number;
  preferences?: {
    importModuleSpecifierPreference?: 'relative' | 'non-relative';
    includeCompletionsForModuleExports?: boolean;
    includeCompletionsForImportStatements?: boolean;
    includeCompletionsWithSnippetText?: boolean;
    includeAutomaticOptionalChainCompletions?: boolean;
  };
}

export class TypeScriptServer {
  private serverProcess?: ChildProcess;
  private connection?: ProtocolConnection;
  private initialized: boolean = false;
  private documentVersions: Map<string, number> = new Map();
  private diagnosticHandlers: Map<
    string,
    ((params: { uri: string; diagnostics: Diagnostic[] }) => void)[]
  > = new Map();
  // Track normalized URIs to avoid repeated normalization
  private normalizedUris: Map<string, string> = new Map();

  constructor(
    private readonly config: TypeScriptServerConfig,
    private readonly logger: Logger
  ) {}

  private async getTsServerPath(): Promise<string> {
    try {
      // Use import.meta.resolve for ES modules
      const tsPath = await import.meta.resolve('typescript');
      if (!tsPath) {
        throw new TypeScriptServerError(
          'Could not resolve typescript package',
          'RESOLVE_FAILED'
        );
      }

      const tsDir = dirname(fileURLToPath(tsPath));
      return `${tsDir}/lib/tsserver.js`;
    } catch (error) {
      this.logger.error('Failed to resolve tsserver path', error as Error);
      throw new TypeScriptServerError(
        'Failed to resolve tsserver path',
        'RESOLVE_FAILED',
        { error }
      );
    }
  }

  private normalizeUri(uri: string): string {
    // Check if we've already normalized this URI
    const cached = this.normalizedUris.get(uri);
    if (cached) {
      return cached;
    }

    // Convert to file:// URI if it's not already
    const normalized = !uri.startsWith('file://')
      ? URI.file(uri).toString()
      : uri;
    this.normalizedUris.set(uri, normalized);
    return normalized;
  }

  private async initializeServer(): Promise<void> {
    if (!this.connection) {
      throw new TypeScriptServerError(
        'No connection available',
        'NO_CONNECTION'
      );
    }

    const initializeResult = await this.connection.sendRequest(
      InitializeRequest.type,
      {
        processId: process.pid,
        rootUri: URI.file(this.config.rootPath).toString(),
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: true,
              willSave: true,
              willSaveWaitUntil: true,
              didSave: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
            },
            codeAction: {
              dynamicRegistration: true,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: [
                    'quickfix',
                    'refactor',
                    'refactor.extract',
                    'refactor.inline',
                    'refactor.rewrite',
                    'source',
                    'source.organizeImports',
                  ],
                },
              },
            },
          },
          workspace: {
            didChangeConfiguration: {
              dynamicRegistration: true,
            },
          },
        },
        initializationOptions: this.config.preferences,
      }
    );

    this.logger.debug(
      'Server initialized with capabilities:',
      initializeResult
    );
  }

  /**
   * Initializes the TypeScript language server
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Get tsserver path
      const tsServerPath = await this.getTsServerPath();

      this.logger.debug('Initializing TypeScript server', {
        tsServerPath,
        config: this.config,
      });

      // Start the server process
      this.serverProcess = spawn('typescript-language-server', ['--stdio'], {
        env: {
          ...process.env,
          TSS_PATH: tsServerPath,
          TSS_MAX_MEMORY: String(this.config.maxTsServerMemory || 3072),
          NODE_OPTIONS: '--max-old-space-size=4096',
        },
      });

      if (!this.serverProcess.stdout || !this.serverProcess.stdin) {
        throw new TypeScriptServerError(
          'Failed to start TypeScript server',
          'START_FAILED'
        );
      }

      // Create connection
      const reader = new StreamMessageReader(this.serverProcess.stdout);
      const writer = new StreamMessageWriter(this.serverProcess.stdin);
      this.connection = createProtocolConnection(reader, writer);

      // Set up error handlers
      this.serverProcess.stderr?.on('data', (data) => {
        this.logger.error('TypeScript server error:', data.toString());
      });

      this.serverProcess.on('error', (error) => {
        this.logger.error('TypeScript server process error:', error);
      });

      // Set up connection error handler
      this.connection.onError((error) => {
        const [message, ...context] = error;
        this.logger.error('TypeScript server connection error:', message);
      });

      // Set up diagnostic handler
      this.connection.onNotification(
        'textDocument/publishDiagnostics',
        (params: { uri: string; diagnostics: Diagnostic[] }) => {
          this.logger.debug('Received diagnostic notification', {
            uri: params.uri,
            diagnosticsCount: params.diagnostics.length,
          });

          const handlers = this.diagnosticHandlers.get(params.uri);
          if (handlers) {
            handlers.forEach((handler) => handler(params));
          }
        }
      );

      this.connection.listen();
      await this.initializeServer();

      this.initialized = true;
      this.logger.info('TypeScript server initialized successfully', {
        serverState: this.debugInfo,
      });
    } catch (error) {
      this.logger.error(
        'Failed to initialize TypeScript server',
        error as Error
      );
      throw new TypeScriptServerError(
        'Failed to initialize TypeScript server',
        'INIT_FAILED',
        { error }
      );
    }
  }

  /**
   * Opens a document in the language server
   */
  async openDocument(
    uri: string,
    text: string,
    version: number
  ): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    try {
      await this.connection.sendNotification(
        DidOpenTextDocumentNotification.type,
        {
          textDocument: {
            uri,
            languageId: 'typescript',
            version,
            text,
          },
        }
      );

      this.documentVersions.set(uri, version);
      this.logger.debug('Opened document', { uri, version });
    } catch (error) {
      this.logger.error('Failed to open document', error as Error, { uri });
      throw new TypeScriptServerError(
        'Failed to open document',
        'OPEN_FAILED',
        {
          uri,
          error,
        }
      );
    }
  }

  /**
   * Updates a document in the language server
   */
  async updateDocument(
    uri: string,
    changes: TextEdit[],
    version: number
  ): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    try {
      await this.connection.sendNotification(
        DidChangeTextDocumentNotification.type,
        {
          textDocument: {
            uri,
            version,
          },
          contentChanges: changes.map((change) => ({
            range: change.range,
            text: change.newText,
          })),
        }
      );

      this.documentVersions.set(uri, version);
      this.logger.debug('Updated document', { uri, version });
    } catch (error) {
      this.logger.error('Failed to update document', error as Error, { uri });
      throw new TypeScriptServerError(
        'Failed to update document',
        'UPDATE_FAILED',
        { uri, error }
      );
    }
  }

  /**
   * Gets completions at a position
   */
  async getCompletions(
    uri: string,
    position: Position
  ): Promise<CompletionItem[]> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    try {
      const result = await this.connection.sendRequest(CompletionRequest.type, {
        textDocument: { uri },
        position,
      });

      return Array.isArray(result) ? result : result?.items || [];
    } catch (error) {
      this.logger.error('Failed to get completions', error as Error, {
        uri,
        position,
      });
      throw new TypeScriptServerError(
        'Failed to get completions',
        'COMPLETION_FAILED',
        { uri, position, error }
      );
    }
  }

  /**
   * Gets available code actions
   */
  async getCodeActions(
    uri: string,
    range: Range,
    diagnostics: Diagnostic[]
  ): Promise<CodeAction[]> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    try {
      const result = await this.connection.sendRequest(CodeActionRequest.type, {
        textDocument: { uri },
        range,
        context: {
          diagnostics,
        },
      });

      return (Array.isArray(result) ? result : []).filter(
        (item): item is CodeAction =>
          !!(item as CodeAction).kind || !!(item as Command).command
      );
    } catch (error) {
      this.logger.error('Failed to get code actions', error as Error, {
        uri,
        range,
      });
      throw new TypeScriptServerError(
        'Failed to get code actions',
        'CODE_ACTIONS_FAILED',
        { uri, range, error }
      );
    }
  }

  async didOpen(uri: string, content: string, version: number): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    const normalizedUri = this.normalizeUri(uri);

    try {
      await this.connection.sendNotification(
        DidOpenTextDocumentNotification.type,
        {
          textDocument: {
            uri: normalizedUri,
            languageId: 'typescript',
            version,
            text: content,
          },
        }
      );

      this.documentVersions.set(normalizedUri, version);
      this.logger.debug('Document opened', { uri: normalizedUri, version });
    } catch (error) {
      this.logger.error('Failed to open document', error as Error);
      throw error;
    }
  }

  async didChange(
    uri: string,
    changes: TextEdit[],
    version: number
  ): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    const normalizedUri = this.normalizeUri(uri);

    try {
      await this.connection.sendNotification(
        DidChangeTextDocumentNotification.type,
        {
          textDocument: {
            uri: normalizedUri,
            version,
          },
          contentChanges: changes.map((change) => ({
            range: change.range,
            text: change.newText,
          })),
        }
      );

      this.documentVersions.set(normalizedUri, version);
      this.logger.debug('Document changed', {
        uri: normalizedUri,
        version,
        changes,
      });
    } catch (error) {
      this.logger.error('Failed to process document change', error as Error);
      throw error;
    }
  }

  async didClose(uri: string): Promise<void> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    const normalizedUri = this.normalizeUri(uri);

    try {
      await this.connection.sendNotification(
        DidCloseTextDocumentNotification.type,
        {
          textDocument: { uri: normalizedUri },
        }
      );

      this.documentVersions.delete(normalizedUri);
      this.diagnosticHandlers.delete(normalizedUri);
      this.logger.debug('Document closed', { uri: normalizedUri });
    } catch (error) {
      this.logger.error('Failed to close document', error as Error);
      throw error;
    }
  }

  private get debugInfo() {
    return {
      initialized: this.initialized,
      hasConnection: !!this.connection,
      processRunning: !!this.serverProcess?.pid,
      documentsTracked: Array.from(this.documentVersions.keys()),
      activeHandlers: Array.from(this.diagnosticHandlers.keys()),
    };
  }

  /**
   * Validates a document
   */
  async validateDocument(uri: string, content: string): Promise<Diagnostic[]> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    const normalizedUri = this.normalizeUri(uri);

    // Only log the URI mapping once when it's first seen
    if (!this.normalizedUris.has(uri)) {
      this.logger.debug('URI mapping', {
        original: uri,
        normalized: normalizedUri,
      });
    }

    return new Promise<Diagnostic[]>(async (resolve, reject) => {
      try {
        let resolvedDiagnostics = false;

        const diagnosticCallback = (params: {
          uri: string;
          diagnostics: Diagnostic[];
        }) => {
          if (params.uri === normalizedUri) {
            resolvedDiagnostics = true;
            // Only log diagnostic count, not full diagnostics
            this.logger.debug('Received diagnostics', {
              uri: normalizedUri,
              diagnosticsCount: params.diagnostics.length,
              errorCount: params.diagnostics.filter((d) => d.severity === 1)
                .length,
            });
            resolve(params.diagnostics);
          }
        };

        // Add handler for diagnostic notifications
        const handlers = this.diagnosticHandlers.get(normalizedUri) || [];
        handlers.push(diagnosticCallback);
        this.diagnosticHandlers.set(normalizedUri, handlers);

        // Ensure document is opened
        const version = this.documentVersions.get(normalizedUri) || 1;
        await this.didOpen(normalizedUri, content, version);

        if (!this.connection) {
          throw new TypeScriptServerError(
            'Server not initialized',
            'NOT_INITIALIZED'
          );
        }

        // Send a change to trigger validation
        await this.connection.sendNotification(
          DidChangeTextDocumentNotification.type,
          {
            textDocument: {
              uri: normalizedUri,
              version: version + 1,
            },
            contentChanges: [{ text: content }],
          }
        );

        this.documentVersions.set(normalizedUri, version + 1);

        // Set timeout
        setTimeout(() => {
          if (!resolvedDiagnostics) {
            this.logger.error('Validation timeout', {
              uri: normalizedUri,
              serverInfo: {
                initialized: this.initialized,
                hasHandlers: (this.diagnosticHandlers.get(normalizedUri) || [])
                  .length,
              },
            });
            reject(new Error('Validation timeout'));

            // Clean up handler
            const currentHandlers = this.diagnosticHandlers.get(normalizedUri);
            if (currentHandlers) {
              const index = currentHandlers.indexOf(diagnosticCallback);
              if (index > -1) {
                currentHandlers.splice(index, 1);
              }
              if (currentHandlers.length === 0) {
                this.diagnosticHandlers.delete(normalizedUri);
              }
            }
          }
        }, 3000);
      } catch (error) {
        this.logger.error('Validation error', error as Error);
        reject(error);
      }
    });
  }

  /**
   * Formats a document
   */
  async formatDocument(uri: string): Promise<TextEdit[]> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    try {
      const result = await this.connection.sendRequest(
        DocumentFormattingRequest.type,
        {
          textDocument: { uri },
          options: {
            tabSize: 2,
            insertSpaces: true,
          },
        }
      );

      return Array.isArray(result) ? result : [];
    } catch (error) {
      this.logger.error('Failed to format document', error as Error, { uri });
      throw new TypeScriptServerError(
        'Failed to format document',
        'FORMAT_FAILED',
        { uri, error }
      );
    }
  }

  async getDefinition(
    uri: string,
    position: Position
  ): Promise<Location[] | LocationLink[]> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    try {
      const result = await this.connection.sendRequest(DefinitionRequest.type, {
        textDocument: { uri },
        position,
      });

      if (Array.isArray(result)) {
        return result;
      } else if (result) {
        return [result];
      }

      return [];
    } catch (error) {
      this.logger.error('Failed to get definition', error as Error, {
        uri,
        position,
      });
      throw new TypeScriptServerError(
        'Failed to get definition',
        'GET_DEFINITION_FAILED',
        { uri, position, error }
      );
    }
  }

  /**
   * Shuts down the language server
   */
  async shutdown(): Promise<void> {
    if (!this.connection || !this.serverProcess || !this.initialized) {
      return;
    }

    try {
      await this.connection.sendRequest('shutdown');
      this.serverProcess.kill();
      this.initialized = false;
      this.documentVersions.clear();

      this.logger.info('TypeScript server shut down');
    } catch (error) {
      this.logger.error('Failed to shutdown TypeScript server', error as Error);
      throw new TypeScriptServerError(
        'Failed to shutdown TypeScript server',
        'SHUTDOWN_FAILED',
        { error }
      );
    }
  }
}

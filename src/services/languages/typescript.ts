// src/services/languages/typescript.ts
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
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
  Hover,
  HoverRequest,
  InitializeParams,
  InitializeRequest,
  Location,
  Position,
  ProtocolConnection,
  Range,
  ReferencesRequest,
  RenameRequest,
  SymbolInformation,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit,
  WorkspaceSymbolRequest,
} from 'vscode-languageserver-protocol';
import {
  MessageReader,
  MessageWriter,
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
  private diagnosticHandlers: Map<string, (diagnostics: Diagnostic[]) => void> =
    new Map();
  constructor(
    private readonly config: TypeScriptServerConfig,
    private readonly logger: Logger
  ) {}

  /**
   * Initializes the TypeScript language server
   */
  async initialize(): Promise<void> {
    try {
      if (this.initialized) {
        return;
      }

      // Start the server process
      this.serverProcess = spawn('typescript-language-server', ['--stdio'], {
        env: {
          ...process.env,
          TSS_MAX_MEMORY: String(this.config.maxTsServerMemory || 3072),
        },
      });

      if (!this.serverProcess.stdout || !this.serverProcess.stdin) {
        throw new TypeScriptServerError(
          'Failed to start TypeScript server',
          'START_FAILED'
        );
      }

      // Create connection with proper message reader/writer
      const reader = new StreamMessageReader(this.serverProcess.stdout);
      const writer = new StreamMessageWriter(this.serverProcess.stdin);
      this.connection = createProtocolConnection(reader, writer);

      // Initialize connection
      const initializeParams: InitializeParams = {
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
            completion: {
              dynamicRegistration: true,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
                deprecatedSupport: true,
                preselectSupport: true,
              },
              completionItemKind: {
                valueSet: [
                  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
                  19, 20, 21, 22, 23, 24, 25,
                ],
              },
              contextSupport: true,
            },
            hover: {
              dynamicRegistration: true,
              contentFormat: ['markdown', 'plaintext'],
            },
            signatureHelp: {
              dynamicRegistration: true,
              signatureInformation: {
                documentationFormat: ['markdown', 'plaintext'],
              },
            },
            definition: {
              dynamicRegistration: true,
              linkSupport: true,
            },
            references: {
              dynamicRegistration: true,
            },
            codeAction: {
              dynamicRegistration: true,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: [
                    '',
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
            rename: {
              dynamicRegistration: true,
              prepareSupport: true,
            },
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
            didChangeConfiguration: {
              dynamicRegistration: true,
            },
          },
        },
        workspaceFolders: [
          {
            name: path.basename(this.config.rootPath),
            uri: URI.file(this.config.rootPath).toString(),
          },
        ],
        initializationOptions: {
          preferences: this.config.preferences,
          tsserver: {
            path: require.resolve('typescript/lib/tsserver.js'),
            maxTsServerMemory: this.config.maxTsServerMemory,
            tsconfig: this.config.tsconfigPath,
          },
        },
      };

      if (!this.connection) {
        throw new TypeScriptServerError(
          'Connection not established',
          'CONNECTION_FAILED'
        );
      }

      // Set up diagnostic notification handler
      this.connection.onNotification(
        'textDocument/publishDiagnostics',
        (params: { uri: string; diagnostics: Diagnostic[] }) => {
          const handlers = this.diagnosticHandlers.get(params.uri);
          if (handlers && Array.isArray(handlers)) {
            handlers.forEach((handler) => handler(params.diagnostics));
          }
        }
      );

      await this.connection.sendRequest(
        InitializeRequest.type,
        initializeParams
      );

      this.connection.listen();
      this.initialized = true;

      this.logger.info('TypeScript server initialized', {
        rootPath: this.config.rootPath,
        tsconfigPath: this.config.tsconfigPath,
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

  /**
   * Validates a document
   */
  async validateDocument(uri: string): Promise<Diagnostic[]> {
    if (!this.connection || !this.initialized) {
      throw new TypeScriptServerError(
        'Server not initialized',
        'NOT_INITIALIZED'
      );
    }

    return new Promise<Diagnostic[]>((resolve, reject) => {
      const handler = (diagnostics: Diagnostic[]) => {
        clearTimeout(timeoutId);
        const handlers = this.diagnosticHandlers.get(uri) || [];

        if (!handlers) {
          this.logger.error('No handlers found for URI');
          reject(new Error('No handlers found for URI'));
          return;
        }

        // @ts-ignore
        const index = handlers.indexOf(handler);
        if (index > -1) {
          // @ts-ignore
          handlers.splice(index, 1);
        }
        if (handlers.length === 0) {
          this.diagnosticHandlers.delete(uri);
        } else {
          // @ts-ignore
          this.diagnosticHandlers.set(uri, handlers);
        }
        resolve(diagnostics);
      };

      // Register handler
      const handlers = this.diagnosticHandlers.get(uri) || [];

      if (!handlers || !Array.isArray(handlers)) {
        this.logger.error('No handlers found for URI');
        reject(new Error('No handlers found for URI'));
        return;
      }

      // @ts-ignore
      handlers.push(handler);
      // @ts-ignore
      this.diagnosticHandlers.set(uri, handlers);

      // Set timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        handler([]);
      }, 2000);

      this.logger.debug('Requested document validation', { uri });
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

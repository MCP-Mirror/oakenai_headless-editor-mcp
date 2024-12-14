// src/services/LSPManager.ts
import { ChildProcess, spawn } from 'child_process';
import path from 'path';
import { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';
import {
  createProtocolConnection,
  DefinitionRequest,
  Diagnostic,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentFormattingRequest,
  InitializeParams,
  InitializeRequest,
  LocationLink,
  Position,
  ProtocolConnection,
  ServerCapabilities,
  TextEdit,
} from 'vscode-languageserver-protocol';
import {
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver-protocol/node.js';
import { Location } from 'vscode-languageserver-types';
import { BaseError } from '../types/errors.js';
import { ProjectContext, TypeScriptOptions } from '../types/language.js';
import {
  LanguageServer,
  LSPManager,
  TypeScriptServerInitializationOptions,
} from '../types/lsp.js';
import { FileSystemManager } from '../utils/fs.js';
import { Logger } from '../utils/logger.js';
import { TypeScriptServer } from './languages/typescript.js';

/**
 * Configuration for a language server
 */
interface LSPServerConfig {
  /** Command to start the server */
  command: string;
  /** Command arguments */
  args: string[];
  /** Server initialization options */
  initializationOptions?: Record<string, unknown>;
  /** Root configuration for the server */
  rootUri: string | null;
  /** Workspace folders */
  workspaceFolders: string[];
}

/**
 * Error specific to LSP operations
 */
export class LSPError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `LSP_${code}`, details);
  }
}

/**
 * Default server configurations for supported languages
 */
const DEFAULT_SERVER_CONFIGS: Record<
  string,
  Omit<LSPServerConfig, 'rootUri' | 'workspaceFolders'>
> = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    initializationOptions: {
      preferences: {
        includeInlayParameterNameHints: 'all',
        includeInlayPropertyDeclarationTypeHints: true,
        includeInlayFunctionLikeReturnTypeHints: true,
      },
    },
  },
  javascript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
  },
};

export class LSPManagerImpl implements LSPManager {
  private servers: Map<string, LanguageServer>;
  private languageServers: Map<string, TypeScriptServer>;
  private configs: Map<string, LSPServerConfig>;
  private processes: Map<string, ChildProcess>;

  constructor(
    private readonly logger: Logger,
    private readonly fs: FileSystemManager,
    private readonly allowedDirectories: string[]
  ) {
    this.processes = new Map();
    this.servers = new Map();
    this.languageServers = new Map();
    this.configs = new Map();

    // Register default TypeScript configuration
    this.configs.set('typescript', {
      command: 'typescript-language-server',
      args: ['--stdio'],
      rootUri: null, // Will be set during initialization
      workspaceFolders: [],
      initializationOptions: {
        preferences: {
          includeInlayParameterNameHints: 'all',
          includeInlayPropertyDeclarationTypeHints: true,
          includeInlayFunctionLikeReturnTypeHints: true,
        },
      },
    });
  }

  /**
   * Creates a protocol connection for a language server process
   */
  private createConnection(process: ChildProcess): ProtocolConnection {
    if (!process.stdout || !process.stdin) {
      throw new LSPError(
        'Failed to create connection',
        'FAILED_TO_CREATE_CONNECTION',
        { process }
      );
    }

    const reader = new StreamMessageReader(process.stdout);
    const writer = new StreamMessageWriter(process.stdin);

    // Handle stream errors
    reader.onError((error) => {
      this.logger.error('LSP reader error', error as Error);
    });

    writer.onError((error) => {
      const [message, ...context] = error;
      this.logger.error('LSP writer error', message);
    });

    const connection = createProtocolConnection(reader, writer, this.logger);

    // Handle connection errors
    connection.onError((error) => {
      this.logger.error('LSP connection error', error[0]);
    });

    // Handle connection close
    connection.onClose(() => {
      this.logger.info('LSP connection closed');
    });

    return connection;
  }

  /**
   * Starts a language server for the specified language
   */
  async startServer(language: string): Promise<void> {
    if (this.servers.has(language)) {
      throw new LSPError(
        `Server already running for ${language}`,
        'SERVER_EXISTS',
        { language }
      );
    }

    const config = this.configs.get(language);
    if (!config) {
      throw new LSPError(
        `No configuration found for ${language}`,
        'NO_CONFIG',
        { language }
      );
    }

    try {
      // For testing, use the config from test fixtures directory
      if (process.env.NODE_ENV === 'test') {
        this.logger.info('Using test fixtures directory for LSP server');
        const testFixturesDir = this.allowedDirectories.find((dir) =>
          dir.endsWith('test-fixtures')
        );
        if (testFixturesDir) {
          config.rootUri = testFixturesDir;
        }
      }

      // Initialize the language server with proper configuration
      const initParams = await this.initializeLanguageServer(language, config);
      const server = await this.createServer(language, config, initParams);
      this.servers.set(language, server);

      this.logger.info(`Started LSP server for ${language}`);
    } catch (error) {
      const details =
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              code: (error as any).code,
              stack: error.stack,
              command: (error as any).command,
              spawnargs: (error as any).spawnargs,
            }
          : error;

      this.logger.error('Failed to start language server', {
        language,
        error: details,
      });

      this.logger.error(
        `Failed to start LSP server for ${language}`,
        error as Error,
        {
          language,
          error: error instanceof Error ? error.stack : error,
        }
      );
      throw new LSPError(
        `Failed to start server for ${language}`,
        'START_FAILED',
        { language, error }
      );
    }
  }

  private getServerPath(command: string): string {
    try {
      return require.resolve(command);
    } catch {
      return command; // Fallback to command name if not found in node_modules
    }
  }

  /**
   * Creates and initializes a language server instance
   */
  private async createServer(
    language: string,
    config: LSPServerConfig,
    initParams: InitializeParams
  ): Promise<LanguageServer> {
    try {
      // For TypeScript/JavaScript, use TypeScriptServer
      if (language === 'typescript' || language === 'javascript') {
        const tsServer = new TypeScriptServer(
          {
            rootPath: process.cwd(), // Or get from config
            preferences: (initParams.initializationOptions as any)?.typescript
              ?.preferences,
          },
          this.logger
        );

        await tsServer.initialize();
        this.languageServers.set(language, tsServer);

        // Return LanguageServer interface implementation
        return {
          async initialize(): Promise<void> {
            // Already initialized
          },

          async shutdown(): Promise<void> {
            await tsServer.shutdown();
          },

          async validateDocument(
            uri: string,
            content: string
          ): Promise<Diagnostic[]> {
            return tsServer.validateDocument(uri, content);
          },

          async formatDocument(
            uri: string,
            content: string
          ): Promise<TextEdit[]> {
            return tsServer.formatDocument(uri);
          },

          async getDefinition(
            uri: string,
            position: Position
          ): Promise<Location[] | LocationLink[]> {
            return tsServer.getDefinition(uri, position);
          },

          async didOpen(
            uri: string,
            content: string,
            version: number
          ): Promise<void> {
            return tsServer.didOpen(uri, content, version);
          },

          async didChange(
            uri: string,
            changes: TextEdit[],
            version: number
          ): Promise<void> {
            return tsServer.didChange(uri, changes, version);
          },

          async didClose(uri: string): Promise<void> {
            return tsServer.didClose(uri);
          },
        };
      }

      // For other languages, use the generic LSP implementation
      return this.createGenericServer(language, config);
    } catch (error) {
      this.logger.error(
        `Failed to create server for ${language}`,
        error as Error
      );
      throw new LSPError(
        `Failed to create server for ${language}`,
        'CREATE_FAILED',
        { language, error }
      );
    }
  }

  private async createGenericServer(
    language: string,
    config: LSPServerConfig
  ): Promise<LanguageServer> {
    const serverPath = this.getServerPath(config.command);
    const serverProcess = spawn(serverPath, config.args);
    const connection = this.createConnection(serverProcess);

    // Add error handler for the process
    serverProcess.on('error', (error) => {
      this.logger.error(`LSP server process error for ${language}`, error);
      throw new LSPError(
        `Failed to start LSP server for ${language}`,
        'PROCESS_START_FAILED',
        { language, error }
      );
    });

    // Handle server exit
    serverProcess.on('exit', (code) => {
      this.logger.info(`LSP server for ${language} exited with code ${code}`);
      this.servers.delete(language);
    });

    // Check if process started successfully
    if (!serverProcess.pid) {
      throw new LSPError(
        `Failed to start LSP server for ${language}`,
        'PROCESS_START_FAILED',
        { language }
      );
    }

    try {
      connection.listen();

      // Initialize the server
      const initializeParams: InitializeParams = {
        processId: process.pid,
        rootUri: config.rootUri,
        workspaceFolders: config.workspaceFolders.map((folder) => ({
          uri: folder,
          name: folder.split('/').pop() || '',
        })),
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
                documentationFormat: ['markdown', 'plaintext'],
              },
            },
            diagnostic: {
              dynamicRegistration: true,
            },
          },
          workspace: {
            workspaceFolders: true,
            configuration: true,
          },
        },
        initializationOptions: config.initializationOptions,
      };

      await connection.sendRequest(InitializeRequest.type, initializeParams);

      return {
        async initialize(): Promise<void> {
          await connection.sendRequest(
            InitializeRequest.type,
            initializeParams
          );
        },

        async shutdown(): Promise<void> {
          await connection.sendRequest('shutdown');
          serverProcess.kill();
        },

        async validateDocument(
          uri: string,
          content: string
        ): Promise<Diagnostic[]> {
          return new Promise<Diagnostic[]>((resolve) => {
            let results: Diagnostic[] = [];

            connection.onNotification(
              'textDocument/publishDiagnostics',
              (params) => {
                if (params.uri === uri) {
                  results = params.diagnostics;
                  resolve(results);
                }
              }
            );

            setTimeout(() => resolve(results), 2000);
          });
        },

        async didOpen(
          uri: string,
          content: string,
          version: number
        ): Promise<void> {
          await connection.sendNotification(
            DidOpenTextDocumentNotification.type,
            {
              textDocument: {
                uri,
                languageId: language,
                version,
                text: content,
              },
            }
          );
        },

        async didChange(
          uri: string,
          changes: TextEdit[],
          version: number
        ): Promise<void> {
          await connection.sendNotification(
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
        },

        async didClose(uri: string): Promise<void> {
          await connection.sendNotification(
            DidCloseTextDocumentNotification.type,
            {
              textDocument: { uri },
            }
          );
        },

        async formatDocument(
          uri: string,
          content: string
        ): Promise<TextEdit[]> {
          const result = await connection.sendRequest(
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
        },

        async getDefinition(
          uri: string,
          position: Position
        ): Promise<Location[]> {
          const result = await connection.sendRequest(DefinitionRequest.type, {
            textDocument: { uri },
            position,
          });

          if (
            result &&
            Array.isArray(result) &&
            result.every((item) => 'uri' in item && 'range' in item)
          ) {
            return result as Location[];
          }
          return [];
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to create generic server for ${language}`,
        error as Error
      );
      throw new LSPError(
        `Failed to create server for ${language}`,
        'CREATE_FAILED',
        { language, error }
      );
    }
  }

  private async initializeTypeScriptServer(
    baseParams: InitializeParams,
    projectContext: ProjectContext
  ): Promise<InitializeParams> {
    const tsOptions = projectContext.languageOptions
      ?.specificOptions as TypeScriptOptions;

    if (!tsOptions) {
      throw new LSPError(
        'TypeScript options not found in project context',
        'INVALID_CONFIG'
      );
    }

    // Add TypeScript-specific client capabilities
    const tsClientCapabilities: ClientCapabilities = {
      ...baseParams.capabilities,
      textDocument: {
        ...baseParams.capabilities.textDocument,
        typeDefinition: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        implementation: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        semanticTokens: {
          dynamicRegistration: true,
          requests: {
            full: {
              delta: true,
            },
            range: true,
          },
        },
        inlayHint: {
          dynamicRegistration: true,
          resolveSupport: {
            properties: ['tooltip', 'textEdits', 'label.tooltip'],
          },
        },
      },
    };

    return {
      ...baseParams,
      capabilities: tsClientCapabilities,
      initializationOptions: {
        typescript: {
          tsdk: path.join(
            projectContext.rootPath,
            'node_modules',
            'typescript',
            'lib'
          ),
          preferences: {
            importModuleSpecifierPreference: 'relative',
            includeCompletionsForModuleExports: true,
            includeCompletionsWithSnippetText: true,
            includeAutomaticOptionalChainCompletions: true,
            includeInlayParameterNameHints: 'all',
            includeInlayPropertyDeclarationTypeHints: true,
            includeInlayFunctionLikeReturnTypeHints: true,
          },
          tsserver: {
            maxTsServerMemory: 4096,
            useSyntaxServer: 'auto',
          },
          ...tsOptions.compilerOptions,
        },
      },
    };
  }

  private async initializeLanguageServer(
    language: string,
    config: LSPServerConfig
  ): Promise<InitializeParams> {
    const projectContext = await this.createProjectContext(language, config);

    // Define client capabilities that we support
    const clientCapabilities: ClientCapabilities = {
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
            documentationFormat: ['markdown', 'plaintext'],
          },
        },
        hover: {
          dynamicRegistration: true,
          contentFormat: ['markdown', 'plaintext'],
        },
        definition: {
          dynamicRegistration: true,
          linkSupport: true,
        },
        references: {
          dynamicRegistration: true,
        },
        documentFormatting: {
          dynamicRegistration: true,
        },
        documentSymbol: {
          dynamicRegistration: true,
          hierarchicalDocumentSymbolSupport: true,
        },
      },
      workspace: {
        workspaceFolders: true,
        configuration: true,
        didChangeConfiguration: {
          dynamicRegistration: true,
        },
        didChangeWatchedFiles: {
          dynamicRegistration: true,
        },
      },
    };

    // Base initialization parameters
    const baseParams: InitializeParams = {
      processId: process.pid,
      rootUri: projectContext.rootPath,
      workspaceFolders: config.workspaceFolders.map((folder) => ({
        uri: folder,
        name: path.basename(folder),
      })),
      capabilities: clientCapabilities,
    };

    // Language-specific initialization
    switch (language) {
      case 'typescript':
        return this.initializeTypeScriptServer(baseParams, projectContext);
      default:
        return baseParams;
    }
  }

  private async createProjectContext(
    language: string,
    config: LSPServerConfig
  ): Promise<ProjectContext> {
    const context: ProjectContext = {
      rootPath: config.rootUri || process.cwd(),
      workspacePath: config.workspaceFolders[0],
      languageOptions: {
        formatOptions: {
          tabSize: 2,
          insertSpaces: true,
        },
      },
    };

    if (language === 'typescript') {
      context.languageOptions!.specificOptions = {
        languageId: 'typescript',
        compilerOptions: {
          jsx: 'react',
          esModuleInterop: true,
          lib: ['dom', 'dom.iterable', 'esnext'],
          strict: true,
        },
      } as TypeScriptOptions;
    }

    // Find language-specific config files
    context.configPath = await this.findConfig(
      context.rootPath,
      language === 'typescript' ? ['tsconfig.json'] : []
    );

    return context;
  }

  private async findConfig(
    rootPath: string,
    configFiles: string[]
  ): Promise<string | undefined> {
    for (const file of configFiles) {
      const configPath = path.join(rootPath, file);
      if (await this.fs.exists(configPath)) {
        return configPath;
      }
    }
    return undefined;
  }

  /**
   * Stops a language server
   */
  async stopServer(language: string): Promise<void> {
    const server = this.servers.get(language);
    if (!server) {
      throw new LSPError(
        `No running server found for ${language}`,
        'SERVER_NOT_FOUND',
        { language }
      );
    }

    try {
      await server.shutdown();
      this.servers.delete(language);
      this.logger.info(`Stopped LSP server for ${language}`);
    } catch (error) {
      this.logger.error(
        `Failed to stop LSP server for ${language}`,
        error as Error
      );
      throw new LSPError(
        `Failed to stop server for ${language}`,
        'STOP_FAILED',
        { language, error }
      );
    }
  }

  /**
   * Gets a running language server instance
   */
  async getServer(language: string): Promise<LanguageServer> {
    const server = this.servers.get(language);
    if (!server) {
      await this.startServer(language);
      return this.servers.get(language)!;
    }
    return server;
  }

  /**
   * Validates a document using the appropriate language server
   */
  async validateDocument(
    uri: string,
    content: string,
    language: string
  ): Promise<Diagnostic[]> {
    const server = await this.getServer(language);
    return server.validateDocument(uri, content);
  }

  /**
   * Disposes of all server instances
   */
  async dispose(): Promise<void> {
    // Clean up all processes
    for (const [language, process] of this.processes) {
      try {
        process.kill();
        this.logger.info(`Killed LSP server process for ${language}`);
      } catch (error) {
        this.logger.error(
          `Failed to kill LSP server process for ${language}`,
          error as Error
        );
      }
    }

    this.processes.clear();
    this.servers.clear();
  }
}

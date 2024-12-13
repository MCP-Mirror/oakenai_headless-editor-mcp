// src/services/LSPManager.ts

import { ChildProcess, spawn } from 'child_process';
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
  Message,
  MessageReader,
  MessageWriter,
  Position,
  ProtocolConnection,
  ReadableStreamMessageReader,
  TextEdit,
  WriteableStreamMessageWriter,
} from 'vscode-languageserver-protocol';
import { Location } from 'vscode-languageserver-types';
import { BaseError } from '../types/errors.js';
import { LanguageServer, LSPManager } from '../types/lsp.js';
import { Logger } from '../utils/logger.js';

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
  private configs: Map<string, LSPServerConfig>;
  private logger: Logger;

  constructor(
    logger: Logger,
    rootUri: string | null = null,
    workspaceFolders: string[] = []
  ) {
    this.servers = new Map();
    this.configs = new Map();
    this.logger = logger;
    // Initialize default configs
    Object.entries(DEFAULT_SERVER_CONFIGS).forEach(([language, config]) => {
      this.configs.set(language, {
        ...config,
        rootUri,
        workspaceFolders,
      });
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

    // @ts-ignore
    const reader = new ReadableStreamMessageReader(process.stdout);
    // @ts-ignore
    const writer = new WriteableStreamMessageWriter(process.stdin);

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
      const server = await this.createServer(language, config);
      this.servers.set(language, server);

      this.logger.info(`Started LSP server for ${language}`);
    } catch (error) {
      this.logger.error(
        `Failed to start LSP server for ${language}`,
        error as Error
      );
      throw new LSPError(
        `Failed to start server for ${language}`,
        'START_FAILED',
        { language, error }
      );
    }
  }

  /**
   * Creates and initializes a language server instance
   */
  private async createServer(
    language: string,
    config: LSPServerConfig
  ): Promise<LanguageServer> {
    const serverProcess = spawn(config.command, config.args);
    const connection = this.createConnection(serverProcess);

    // Handle process errors
    serverProcess.on('error', (error) => {
      this.logger.error(`LSP server process error for ${language}`, error);
    });

    // Handle server exit
    serverProcess.on('exit', (code) => {
      this.logger.info(`LSP server for ${language} exited with code ${code}`);
      this.servers.delete(language);
    });

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
    connection.listen();

    return {
      async getDefinition(
        uri: string,
        position: Position
      ): Promise<Location[]> {
        try {
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

          throw new LSPError(
            'Failed to get definition',
            'FAILED_TO_GET_DEFINITION',
            { uri, position }
          );
        } catch (error) {
          throw new LSPError(
            'Failed to get definition',
            'FAILED_TO_GET_DEFINITION',
            { uri, position }
          );
        }
      },
      async initialize(): Promise<void> {
        await connection.sendRequest(InitializeRequest.type, initializeParams);
      },
      async formatDocument(uri: string, content: string): Promise<TextEdit[]> {
        const result = await connection.sendRequest(
          DocumentFormattingRequest.type,
          {
            textDocument: { uri },
            options: { tabSize: 2, insertSpaces: true },
          }
        );
        if (result && Array.isArray(result)) {
          return result as TextEdit[];
        }
        throw new LSPError(
          'Failed to format document',
          'FAILED_TO_FORMAT_DOCUMENT',
          { uri }
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
        // Notify the server about the document
        await connection.sendNotification(
          DidOpenTextDocumentNotification.type,
          {
            textDocument: {
              uri,
              languageId: language,
              version: 1,
              text: content,
            },
          }
        );

        // Request diagnostics
        const diagnostics = await new Promise<Diagnostic[]>((resolve) => {
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

          // Set a timeout for diagnostic collection
          setTimeout(() => resolve(results), 1000);
        });

        // Close the document
        await connection.sendNotification(
          DidCloseTextDocumentNotification.type,
          {
            textDocument: { uri },
          }
        );

        return diagnostics;
      },
    };
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
    const languages = Array.from(this.servers.keys());
    await Promise.all(languages.map((lang) => this.stopServer(lang)));
    this.logger.info('Disposed LSP manager');
  }
}

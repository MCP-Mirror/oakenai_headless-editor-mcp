// src/server.ts
import fs from 'fs';
import path from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DocumentManager } from './services/DocumentManager.js';
import { EditOperationManager } from './services/EditOperationManager.js';
import { LSPManagerImpl } from './services/LSPManager.js';
import { SessionManager } from './services/SessionManager.js';
import { BaseError } from './types/errors.js';
import { LocalFileSystemManager } from './utils/fs.js';
import { EnhancedLogger, Logger, LogLevel } from './utils/logger.js';

// Validation schemas for tool arguments
const StartSessionArgsSchema = z.object({
  filePath: z.string(),
  languageId: z.string(),
});

const EditCodeArgsSchema = z.object({
  sessionId: z.string(),
  operation: z.object({
    type: z.enum(['insert', 'delete', 'replace']),
    content: z.string().optional(),
    position: z
      .object({
        line: z.number(),
        character: z.number(),
      })
      .optional(),
    range: z
      .object({
        start: z.object({
          line: z.number(),
          character: z.number(),
        }),
        end: z.object({
          line: z.number(),
          character: z.number(),
        }),
      })
      .optional(),
  }),
});

const ValidateCodeArgsSchema = z.object({
  sessionId: z.string(),
});

export class HeadlessEditorServer {
  private readonly server: Server;
  private readonly fs: LocalFileSystemManager;
  private readonly lspManager: LSPManagerImpl;
  private readonly documentManager: DocumentManager;
  private readonly sessionManager: SessionManager;
  private readonly editManager: EditOperationManager;
  private readonly logger: Logger;
  private readonly allowedDirectories: string[];

  constructor(allowedDirectories: string[]) {
    // Normalize and validate allowed directories
    this.allowedDirectories = allowedDirectories.map((dir) => {
      const normalized = path.resolve(dir);
      if (!fs.existsSync(normalized)) {
        throw new Error(`Directory does not exist: ${dir}`);
      }
      if (!fs.statSync(normalized).isDirectory()) {
        throw new Error(`Not a directory: ${dir}`);
      }
      return normalized;
    });

    this.fs = new LocalFileSystemManager(this.allowedDirectories);

    let logDir = process.env.LOG_DIR;

    if (!logDir) {
      logDir = this.allowedDirectories[0] + '/logs';
    } else {
      // check if logDir is in allowedDirectories
      if (!this.allowedDirectories.includes(logDir)) {
        throw new Error(
          `Log directory ${logDir} is not in allowed directories`
        );
      }
    }

    this.logger = new EnhancedLogger(
      {
        minLevel:
          process.env.NODE_ENV === 'production'
            ? LogLevel.INFO
            : LogLevel.DEBUG,
        logDir: logDir,
        filename: process.env.LOG_FILE ?? 'app-%DATE%.log',
        console: process.env.NODE_ENV !== 'production',
      },
      this.fs
    );

    this.lspManager = new LSPManagerImpl(
      this.logger,
      this.fs,
      this.allowedDirectories
    );
    this.documentManager = new DocumentManager(
      this.fs,
      this.lspManager,
      this.logger
    );
    this.sessionManager = new SessionManager(
      this.fs,
      this.lspManager,
      this.logger,
      this.allowedDirectories
    );
    this.editManager = new EditOperationManager(
      this.sessionManager,
      this.lspManager,
      this.logger
    );

    this.server = new Server(
      {
        name: 'headless-code-editor',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupRequestHandlers();
    this.setupErrorHandler();
  }

  private setupRequestHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'start_session',
          description: 'Start a new editing session for a file',
          inputSchema: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'Path to the file to edit',
              },
              languageId: {
                type: 'string',
                description:
                  'Language identifier (e.g., typescript, javascript, python)',
              },
            },
            required: ['filePath', 'languageId'],
          },
        },
        {
          name: 'edit_code',
          description: 'Apply an edit operation to the code',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'ID of the editing session',
              },
              operation: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['insert', 'delete', 'replace'],
                  },
                  content: {
                    type: 'string',
                  },
                  position: {
                    type: 'object',
                    properties: {
                      line: { type: 'number' },
                      character: { type: 'number' },
                    },
                  },
                  range: {
                    type: 'object',
                    properties: {
                      start: {
                        type: 'object',
                        properties: {
                          line: { type: 'number' },
                          character: { type: 'number' },
                        },
                      },
                      end: {
                        type: 'object',
                        properties: {
                          line: { type: 'number' },
                          character: { type: 'number' },
                        },
                      },
                    },
                  },
                },
                required: ['type'],
              },
            },
            required: ['sessionId', 'operation'],
          },
        },
        {
          name: 'validate_code',
          description: 'Validate the current code state',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'ID of the editing session',
              },
            },
            required: ['sessionId'],
          },
        },
        {
          name: 'close_session',
          description: 'Close and clean up an editing session',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'ID of the editing session to close',
              },
            },
            required: ['sessionId'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'start_session': {
            const validatedArgs = StartSessionArgsSchema.parse(args);
            const session = await this.sessionManager.createSession(
              validatedArgs.filePath,
              validatedArgs.languageId
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    sessionId: session.id,
                    filePath: session.filePath,
                    languageId: session.languageId,
                  }),
                },
              ],
            };
          }

          case 'edit_code': {
            const validatedArgs = EditCodeArgsSchema.parse(args);
            const result = await this.editManager.applyEdit(
              validatedArgs.sessionId,
              validatedArgs.operation
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
            };
          }

          case 'validate_code': {
            const validatedArgs = ValidateCodeArgsSchema.parse(args);
            const session = await this.sessionManager.getSession(
              validatedArgs.sessionId
            );
            const diagnostics = await this.lspManager.validateDocument(
              session.document.uri,
              session.document.getText(),
              session.languageId
            );

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ diagnostics }),
                },
              ],
            };
          }

          case 'close_session': {
            const validatedArgs = z
              .object({
                sessionId: z.string(),
              })
              .parse(args);

            await this.sessionManager.closeSession(validatedArgs.sessionId);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success: true }),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.logger.error('Tool execution failed', error as Error);

        if (error instanceof BaseError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: {
                    message: error.message,
                    code: error.code,
                    details: error.details,
                  },
                }),
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                },
              }),
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandler(): void {
    this.server.onerror = (error: Error): void => {
      this.logger.error('[MCP Server Error]', error);
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Headless Code Editor Server running on stdio');
  }

  async stop(): Promise<void> {
    await this.sessionManager.dispose();
    await this.documentManager.dispose();
    await this.lspManager.dispose();
    await this.server.close();
    this.logger.info('Server stopped');
  }
}

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
import { BaseError } from './types/errors.js';
import { LocalFileSystemManager } from './utils/fs.js';

export class HeadlessEditorServer {
  private readonly server: Server;
  private readonly fs: LocalFileSystemManager;
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

    this.fs = new LocalFileSystemManager();

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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'start_session',
          description: 'Start a new editing session for a file',
          inputSchema: {},
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case 'start_session': {
            // TODO: implement this
            return {
              content: [
                {
                  type: 'text',
                  text: 'Session started',
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof BaseError) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${error.message}\nCode: ${error.code}${
                  error.details
                    ? `\nDetails: ${JSON.stringify(error.details, null, 2)}`
                    : ''
                }`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandler(): void {
    this.server.onerror = (error: Error): void => {
      console.error('[MCP Server Error]', error);
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Headless Code Editor Server running on stdio');
  }

  async stop(): Promise<void> {
    // TODO: implement this
    // this.sessionManager.dispose();
    await this.server.close();
  }
}

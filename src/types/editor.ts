// src/types/index.ts

import {
  Diagnostic,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Represents a session for editing code
 */
export interface EditSession {
  /** Unique identifier for the session */
  id: string;

  /** Path to the file being edited */
  filePath: string;

  /** Current document state */
  document: TextDocument;

  /** Language identifier (e.g., 'typescript', 'python') */
  languageId: string;

  /** Creation timestamp */
  createdAt: number;

  /** Last activity timestamp */
  lastActivity: number;
}

/**
 * Describes the target location for an edit operation
 */
export interface CodeTarget {
  /** Type of target (e.g., 'symbol', 'component', 'function') */
  type: CodeTargetType;

  /** Name of the target (e.g., component name, function name) */
  name?: string;

  /** Specific range in the document */
  range?: Range;

  /** Additional target properties */
  properties?: Record<string, unknown>;
}

/**
 * Valid code target types
 */
export type CodeTargetType =
  | 'symbol'
  | 'component'
  | 'function'
  | 'class'
  | 'interface'
  | 'import'
  | 'range';

/**
 * Represents an edit operation to be applied
 */
export interface EditOperation {
  /** Type of edit operation */
  type: EditOperationType;

  /** Content to insert or replace */
  content?: string;

  /** Position or range information */
  position?: Position;
  range?: Range;

  /** Format preservation options */
  format?: FormatOptions;
}

/**
 * Valid edit operation types
 */
export type EditOperationType =
  | 'insert'
  | 'delete'
  | 'replace'
  | 'move'
  | 'wrap'
  | 'addImport'
  | 'addProp'
  | 'addHook';

/**
 * Options for preserving code formatting
 */
export interface FormatOptions {
  /** Whether to preserve indentation */
  preserveIndent?: boolean;

  /** Whether to add trailing comma */
  trailingComma?: boolean;

  /** Line ending style */
  lineEnding?: 'lf' | 'crlf';
}

/**
 * Result of an edit operation
 */
export interface EditResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Any validation diagnostics */
  diagnostics: Diagnostic[];

  /** Applied changes */
  changes?: TextEdit[];

  /** Error details if operation failed */
  error?: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Service for managing edit sessions
 */
export interface SessionManager {
  createSession(filePath: string, languageId: string): Promise<EditSession>;
  getSession(sessionId: string): Promise<EditSession>;
  updateSession(
    sessionId: string,
    changes: Partial<EditSession>
  ): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  cleanupInactiveSessions(maxInactiveTime: number): Promise<void>;
}

/**
 * Log levels for the system
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Interface for system logging
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): void;
  setLevel(level: LogLevel): void;
}

// src/types/index.ts

import {
  Diagnostic,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';

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

// Track state of language server connection
export interface LanguageServerState {
  connected: boolean;
  capabilities: Record<string, unknown>;
  lastError?: {
    message: string;
    timestamp: number;
  };
}

// Track individual edit operations
export interface EditOperationState {
  timestamp: number;
  changes: TextEdit[];
  documentVersion: number;
}

// Track validation state
export interface ValidationState {
  lastChecked: number;
  diagnostics: Diagnostic[];
  isValid: boolean;
  inProgress: boolean;
}

// Enhanced edit history tracking
export interface EditHistory {
  operations: EditOperationState[];
  currentIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

// Enhanced session state
export interface SessionState {
  editHistory: EditHistory;
  validationState: ValidationState;
  languageServerState: LanguageServerState;
  lastModified: number;
  isSaving: boolean;
  isDirty: boolean;
}

/**
 * Represents a session for editing code
 */
export interface EditSession {
  id: string;
  filePath: string;
  document: TextDocument;
  languageId: string;
  createdAt: number;
  lastActivity: number;
  state: SessionState;
}

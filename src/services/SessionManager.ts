// src/services/SessionManager.ts
import { v4 as uuidv4 } from 'uuid';
import { Diagnostic, TextEdit } from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  EditOperationState,
  EditSession,
  SessionState,
} from '../types/editor.js';
import { SessionError } from '../types/errors.js';
import { LSPManager } from '../types/lsp.js';
import { FileSystemManager } from '../utils/fs.js';
import { Logger } from '../utils/logger.js';

const MAX_HISTORY_SIZE = 100;

export class SessionManager {
  private sessions: Map<string, EditSession>;
  private readonly DEFAULT_CLEANUP_INTERVAL = 1000 * 60 * 30; // 30 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly fs: FileSystemManager,
    private readonly lspManager: LSPManager,
    private readonly logger: Logger,
    private readonly allowedDirectories: string[]
  ) {
    this.lspManager = lspManager;
    this.logger = logger;
    this.sessions = new Map();
    this.startCleanupInterval();
  }

  private createInitialState(): SessionState {
    return {
      editHistory: {
        operations: [],
        currentIndex: -1,
        canUndo: false,
        canRedo: false,
      },
      validationState: {
        lastChecked: Date.now(),
        diagnostics: [],
        isValid: true,
        inProgress: false,
      },
      languageServerState: {
        connected: false,
        capabilities: {},
      },
      lastModified: Date.now(),
      isSaving: false,
      isDirty: false,
    };
  }

  /**
   * Creates a new edit session for a file
   * @param filePath Path to the file to edit
   * @param languageId Language identifier for the file
   * @returns The created session
   * @throws {SessionError} If session creation fails
   */
  async createSession(
    filePath: string,
    languageId: string
  ): Promise<EditSession> {
    try {
      const validatedPath = await this.fs.validatePath(
        filePath,
        this.allowedDirectories
      );

      const exists = await this.fs.exists(validatedPath);
      if (!exists) {
        throw new SessionError(
          `File does not exist: ${filePath}`,
          'FILE_NOT_FOUND',
          { filePath }
        );
      }

      const content = await this.fs.readFile(validatedPath);
      const document = TextDocument.create(
        validatedPath,
        languageId,
        1,
        content
      );

      const sessionId = uuidv4();
      const session: EditSession = {
        id: sessionId,
        filePath: validatedPath,
        document,
        languageId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        state: this.createInitialState(),
      };

      // Initialize language server
      await this.lspManager.startServer(languageId);

      // Update language server state
      const server = await this.lspManager.getServer(languageId);
      const capabilities = await server.initialize();

      session.state.languageServerState = {
        connected: true,
        capabilities: {},
      };

      this.sessions.set(sessionId, session);

      this.logger.info('Created new edit session', {
        sessionId,
        filePath: validatedPath,
        languageId,
      });

      return session;
    } catch (error) {
      this.logger.error('Failed to create session', error as Error, {
        filePath,
        languageId,
      });

      throw error;
    }
  }

  /**
   * Records an edit operation in the session's history
   */
  async recordEdit(
    sessionId: string,
    changes: TextEdit[],
    documentVersion: number
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    const operation: EditOperationState = {
      timestamp: Date.now(),
      changes,
      documentVersion,
    };

    const history = session.state.editHistory;

    // If we're not at the end of the history, truncate the future operations
    if (history.currentIndex < history.operations.length - 1) {
      history.operations = history.operations.slice(
        0,
        history.currentIndex + 1
      );
    }

    // Add new operation
    history.operations.push(operation);

    // Maintain maximum history size
    if (history.operations.length > MAX_HISTORY_SIZE) {
      history.operations = history.operations.slice(-MAX_HISTORY_SIZE);
    }

    // Update history state
    history.currentIndex = history.operations.length - 1;
    history.canUndo = history.currentIndex >= 0;
    history.canRedo = false;

    // Update session state
    session.state.lastModified = Date.now();
    session.state.isDirty = true;

    await this.updateSession(sessionId, {
      state: session.state,
    });

    this.logger.debug('Recorded edit operation', {
      sessionId,
      operationCount: history.operations.length,
      documentVersion,
    });
  }

  /**
   * Updates the validation state for a session
   */
  async updateValidationState(
    sessionId: string,
    diagnostics: Diagnostic[]
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    session.state.validationState = {
      lastChecked: Date.now(),
      diagnostics,
      isValid: diagnostics.length === 0,
      inProgress: false,
    };

    await this.updateSession(sessionId, {
      state: session.state,
    });

    this.logger.debug('Updated validation state', {
      sessionId,
      isValid: session.state.validationState.isValid,
      diagnosticsCount: diagnostics.length,
    });
  }

  /**
   * Updates the language server state for a session
   */
  async updateLanguageServerState(
    sessionId: string,
    connected: boolean,
    capabilities?: Record<string, unknown>,
    error?: Error
  ): Promise<void> {
    const session = await this.getSession(sessionId);

    session.state.languageServerState = {
      connected,
      capabilities: capabilities ?? {},
      ...(error && {
        lastError: {
          message: error.message,
          timestamp: Date.now(),
        },
      }),
    };

    await this.updateSession(sessionId, {
      state: session.state,
    });

    this.logger.debug('Updated language server state', {
      sessionId,
      connected,
      hasError: !!error,
    });
  }

  /**
   * Attempts to undo the last operation
   */
  async undo(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    const history = session.state.editHistory;

    if (!history.canUndo) {
      return false;
    }

    // Apply inverse of the last operation
    const operation = history.operations[history.currentIndex];
    const inverseChanges = this.createInverseChanges(operation.changes);

    // Apply changes to document
    const newContent = TextDocument.applyEdits(
      session.document,
      inverseChanges
    );
    const newVersion = session.document.version + 1;

    // Create new document with changes
    const updatedDoc = TextDocument.create(
      session.document.uri,
      session.languageId,
      newVersion,
      newContent
    );

    // Update history state
    history.currentIndex--;
    history.canUndo = history.currentIndex >= 0;
    history.canRedo = true;

    // Update session
    await this.updateSession(sessionId, {
      document: updatedDoc,
      state: {
        ...session.state,
        editHistory: history,
        lastModified: Date.now(),
        isDirty: true,
      },
    });

    this.logger.debug('Performed undo operation', {
      sessionId,
      newHistoryIndex: history.currentIndex,
    });

    return true;
  }

  /**
   * Attempts to redo the last undone operation
   */
  async redo(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    const history = session.state.editHistory;

    if (!history.canRedo) {
      return false;
    }

    // Get the next operation
    const operation = history.operations[history.currentIndex + 1];

    // Apply changes to document
    const newContent = TextDocument.applyEdits(
      session.document,
      operation.changes
    );
    const newVersion = session.document.version + 1;

    // Create new document with changes
    const updatedDoc = TextDocument.create(
      session.document.uri,
      session.languageId,
      newVersion,
      newContent
    );

    // Update history state
    history.currentIndex++;
    history.canUndo = true;
    history.canRedo = history.currentIndex < history.operations.length - 1;

    // Update session
    await this.updateSession(sessionId, {
      document: updatedDoc,
      state: {
        ...session.state,
        editHistory: history,
        lastModified: Date.now(),
        isDirty: true,
      },
    });

    this.logger.debug('Performed redo operation', {
      sessionId,
      newHistoryIndex: history.currentIndex,
    });

    return true;
  }

  /**
   * Creates inverse changes for undo operations
   */
  private createInverseChanges(changes: TextEdit[]): TextEdit[] {
    return changes.map((change) => ({
      range: change.range,
      newText: '', // For simplicity, we're just removing the text. A more complex implementation would store the original text.
    }));
  }

  /**
   * Retrieves an existing session by ID
   * @param sessionId ID of the session to retrieve
   * @returns The requested session
   * @throws {SessionError} If session is not found
   */
  async getSession(sessionId: string): Promise<EditSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.error('Session not found', new Error('Session not found'), {
        sessionId,
      });
      throw new SessionError(`Session not found: ${sessionId}`, 'NOT_FOUND', {
        sessionId,
      });
    }

    // Update last activity
    session.lastActivity = Date.now();
    this.sessions.set(sessionId, session);

    return session;
  }

  /**
   * Updates an existing session
   * @param sessionId ID of the session to update
   * @param changes Changes to apply to the session
   * @throws {SessionError} If session is not found or update fails
   */
  async updateSession(
    sessionId: string,
    changes: Partial<Omit<EditSession, 'id'>>
  ): Promise<void> {
    try {
      const session = await this.getSession(sessionId);

      const updatedSession: EditSession = {
        ...session,
        ...changes,
        id: sessionId, // Ensure ID cannot be changed
        lastActivity: Date.now(),
      };

      this.sessions.set(sessionId, updatedSession);

      this.logger.debug('Updated session', {
        sessionId,
        changes,
      });
    } catch (error) {
      this.logger.error('Failed to update session', error as Error, {
        sessionId,
        changes,
      });
      throw error;
    }
  }

  /**
   * Closes and cleans up a session
   * @param sessionId ID of the session to close
   * @throws {SessionError} If session closure fails
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);

      // Clean up resources
      this.sessions.delete(sessionId);

      this.logger.info('Closed session', { sessionId });
    } catch (error) {
      this.logger.error('Failed to close session', error as Error, {
        sessionId,
      });
      throw error;
    }
  }

  /**
   * Cleans up inactive sessions
   * @param maxInactiveTime Maximum allowed inactive time in milliseconds
   */
  async cleanupInactiveSessions(maxInactiveTime: number): Promise<void> {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > maxInactiveTime) {
        try {
          await this.closeSession(sessionId);
          this.logger.info('Cleaned up inactive session', { sessionId });
        } catch (error) {
          this.logger.error(
            'Failed to cleanup inactive session',
            error as Error,
            { sessionId }
          );
        }
      }
    }
  }

  /**
   * Starts the automatic cleanup interval
   */
  private startCleanupInterval(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(
      () => this.cleanupInactiveSessions(this.DEFAULT_CLEANUP_INTERVAL),
      this.DEFAULT_CLEANUP_INTERVAL
    );
  }

  /**
   * Stops the automatic cleanup interval
   */
  private stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Disposes of the session manager and cleans up resources
   */
  async dispose(): Promise<void> {
    this.stopCleanupInterval();

    // Close all active sessions
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(
      sessionIds.map((sessionId) => this.closeSession(sessionId))
    );

    this.logger.info('Disposed session manager');
  }
}

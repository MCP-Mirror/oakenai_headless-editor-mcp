// src/services/SessionManager.ts

import { v4 as uuidv4 } from 'uuid';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { EditSession } from '../types/editor.js';
import { Logger } from '../utils/logger.js';
import { SessionError } from '../types/errors.js';
import { FileSystemManager } from '../utils/fs.js';

export class SessionManager {
  private sessions: Map<string, EditSession>;
  private readonly DEFAULT_CLEANUP_INTERVAL = 1000 * 60 * 30; // 30 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly fs: FileSystemManager,
    private logger: Logger,
    private readonly allowedDirectories: string[],
  ) {
    this.logger = logger;
    this.sessions = new Map();
    this.startCleanupInterval();
  }

  /**
   * Creates a new edit session for a file
   * @param filePath Path to the file to edit
   * @param languageId Language identifier for the file
   * @returns The created session
   * @throws {SessionError} If session creation fails
   */
  async createSession(filePath: string, languageId: string): Promise<EditSession> {
    try {
      // Validate file path is within allowed directories
      const validatedPath = await this.fs.validatePath(filePath, this.allowedDirectories);
      
      // Check if file exists
      const exists = await this.fs.exists(validatedPath);
      if (!exists) {
        throw new SessionError(
          `File does not exist: ${filePath}`,
          'FILE_NOT_FOUND',
          { filePath }
        );
      }

      // Read file content
      const content = await this.fs.readFile(validatedPath);

      // Create text document
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
        lastActivity: Date.now()
      };

      this.sessions.set(sessionId, session);

      this.logger.info('Created new edit session', {
        sessionId,
        filePath: validatedPath,
        languageId
      });

      return session;
    } catch (error) {
      this.logger.error('Failed to create session', error as Error, {
        filePath,
        languageId
      });
      
      if (error instanceof SessionError) {
        throw error;
      }
      
      throw new SessionError(
        'Failed to create edit session',
        'CREATE_FAILED',
        { filePath, error }
      );
    }
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
      this.logger.error('Session not found', new Error('Session not found'), { sessionId });
      throw new SessionError(
        `Session not found: ${sessionId}`,
        'NOT_FOUND',
        { sessionId }
      );
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
        lastActivity: Date.now()
      };

      this.sessions.set(sessionId, updatedSession);

      this.logger.debug('Updated session', {
        sessionId,
        changes
      });
    } catch (error) {
      this.logger.error('Failed to update session', error as Error, {
        sessionId,
        changes
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
      this.logger.error('Failed to close session', error as Error, { sessionId });
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
          this.logger.error('Failed to cleanup inactive session', error as Error, { sessionId });
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
      sessionIds.map(sessionId => this.closeSession(sessionId))
    );
    
    this.logger.info('Disposed session manager');
  }
}
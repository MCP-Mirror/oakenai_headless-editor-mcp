// src/services/__tests__/SessionManager.test.ts
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SessionManager } from '../services/SessionManager.js';
import { EditSession } from '../types/editor.js';
import { SessionError } from '../types/errors.js';
import { FileSystemManager } from '../utils/fs.js';
import { Logger } from '../utils/logger.js';

// Mock implementations
const mockFs: jest.Mocked<FileSystemManager> = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  exists: jest.fn(),
  isDirectory: jest.fn(),
  validatePath: jest.fn(),
  rename: jest.fn(),
  unlink: jest.fn(),
};

const mockLogger: jest.Mocked<Logger> = {
  debug: jest.fn(),
  info: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn(),
};

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  const allowedDirectories = ['/allowed/path'];
  const validFilePath = '/allowed/path/test.ts';
  const invalidFilePath = '/invalid/path/test.ts';

  beforeEach(() => {
    jest.clearAllMocks();
    sessionManager = new SessionManager(mockFs, mockLogger, allowedDirectories);

    // Default mock implementations
    mockFs.validatePath.mockImplementation(async (path) => {
      if (path.startsWith('/allowed/path')) {
        return path;
      }
      throw new Error('Invalid path');
    });

    mockFs.exists.mockResolvedValue(true);
    mockFs.readFile.mockResolvedValue('// Test content');
  });

  afterEach(async () => {
    await sessionManager.dispose();
  });

  describe('createSession', () => {
    it('should create a new session successfully', async () => {
      const session = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );

      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.filePath).toBe(validFilePath);
      expect(session.languageId).toBe('typescript');
      expect(session.document).toBeDefined();
      expect(session.createdAt).toBeDefined();
      expect(session.lastActivity).toBeDefined();

      expect(mockFs.validatePath).toHaveBeenCalledWith(
        validFilePath,
        allowedDirectories
      );
      expect(mockFs.exists).toHaveBeenCalledWith(validFilePath);
      expect(mockFs.readFile).toHaveBeenCalledWith(validFilePath);
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should throw error for invalid file path', async () => {
      await expect(
        sessionManager.createSession(invalidFilePath, 'typescript')
      ).rejects.toThrow(SessionError);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should throw error if file does not exist', async () => {
      mockFs.exists.mockResolvedValueOnce(false);

      await expect(
        sessionManager.createSession(validFilePath, 'typescript')
      ).rejects.toThrow(SessionError);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle file read errors', async () => {
      mockFs.readFile.mockRejectedValueOnce(new Error('Read error'));

      await expect(
        sessionManager.createSession(validFilePath, 'typescript')
      ).rejects.toThrow(SessionError);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    let testSession: EditSession;

    beforeEach(async () => {
      testSession = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );
    });

    it('should retrieve an existing session', async () => {
      const session = await sessionManager.getSession(testSession.id);

      expect(session).toBeDefined();
      expect(session.id).toBe(testSession.id);
      expect(session.lastActivity).toBeGreaterThanOrEqual(
        testSession.lastActivity
      );
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        sessionManager.getSession('non-existent-id')
      ).rejects.toThrow(SessionError);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('updateSession', () => {
    let testSession: EditSession;

    beforeEach(async () => {
      testSession = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );
    });

    it('should update session with new document', async () => {
      const newDocument = TextDocument.create(
        validFilePath,
        'typescript',
        2,
        '// Updated content'
      );

      await sessionManager.updateSession(testSession.id, {
        document: newDocument,
      });

      const updatedSession = await sessionManager.getSession(testSession.id);
      expect(updatedSession.document).toBe(newDocument);
      expect(updatedSession.lastActivity).toBeGreaterThanOrEqual(
        testSession.lastActivity
      );
    });

    it('should throw error when updating non-existent session', async () => {
      await expect(
        sessionManager.updateSession('non-existent-id', {})
      ).rejects.toThrow(SessionError);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not allow updating session id', async () => {
      const originalId = testSession.id;
      await sessionManager.updateSession(originalId, {
        id: 'new-id',
      } as any);

      const session = await sessionManager.getSession(originalId);
      expect(session.id).toBe(originalId);
    });
  });

  describe('closeSession', () => {
    let testSession: EditSession;

    beforeEach(async () => {
      testSession = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );
    });

    it('should close session successfully', async () => {
      await sessionManager.closeSession(testSession.id);

      await expect(sessionManager.getSession(testSession.id)).rejects.toThrow(
        SessionError
      );

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should throw error when closing non-existent session', async () => {
      await expect(
        sessionManager.closeSession('non-existent-id')
      ).rejects.toThrow(SessionError);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('cleanupInactiveSessions', () => {
    let testSession: EditSession;

    beforeEach(async () => {
      testSession = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );
    });

    it('should cleanup inactive sessions', async () => {
      // Fast-forward time
      jest.useFakeTimers();
      const inactiveTime = 1000 * 60 * 31; // 31 minutes
      jest.advanceTimersByTime(inactiveTime);

      await sessionManager.cleanupInactiveSessions(1000 * 60 * 30); // 30 minutes

      await expect(sessionManager.getSession(testSession.id)).rejects.toThrow(
        SessionError
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaned up inactive session',
        expect.any(Object)
      );

      jest.useRealTimers();
    });

    it('should not cleanup active sessions', async () => {
      jest.useFakeTimers();

      // Update session to keep it active
      await sessionManager.updateSession(testSession.id, {});

      // Fast-forward time but less than cleanup threshold
      jest.advanceTimersByTime(1000 * 60 * 15); // 15 minutes

      await sessionManager.cleanupInactiveSessions(1000 * 60 * 30); // 30 minutes

      // Session should still exist
      const session = await sessionManager.getSession(testSession.id);
      expect(session).toBeDefined();

      jest.useRealTimers();
    });
  });

  describe('dispose', () => {
    it('should cleanup all sessions and resources', async () => {
      // Create multiple sessions
      const session1 = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );
      const session2 = await sessionManager.createSession(
        validFilePath,
        'typescript'
      );

      await sessionManager.dispose();

      // Verify all sessions are closed
      await expect(sessionManager.getSession(session1.id)).rejects.toThrow(
        SessionError
      );
      await expect(sessionManager.getSession(session2.id)).rejects.toThrow(
        SessionError
      );

      expect(mockLogger.info).toHaveBeenCalledWith('Disposed session manager');
    });
  });
});

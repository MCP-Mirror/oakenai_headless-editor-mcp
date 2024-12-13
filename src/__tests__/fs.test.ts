import fs from 'fs/promises';
import { FileSystemError } from '../types/errors.js';
import { LocalFileSystemManager } from '../utils/fs.js';

jest.mock('fs/promises');

describe('LocalFileSystemManager', () => {
  let manager: LocalFileSystemManager;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    manager = new LocalFileSystemManager();
    jest.clearAllMocks();
  });

  describe('readFile', () => {
    it('should read file contents successfully', async () => {
      const content = 'test content';
      mockFs.readFile.mockResolvedValue(content);

      const result = await manager.readFile('test.txt');
      expect(result).toBe(content);
    });

    it('should throw FileSystemError on read failure', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Read failed'));

      await expect(manager.readFile('test.txt')).rejects.toThrow(
        FileSystemError
      );
    });
  });

  describe('validatePath', () => {
    const allowedDirs = ['/allowed/dir1', '/allowed/dir2'];

    it('should validate path within allowed directory', async () => {
      const testPath = '/allowed/dir1/test.txt';
      mockFs.realpath.mockResolvedValue(testPath);

      const result = await manager.validatePath(testPath, allowedDirs);
      expect(result).toBe(testPath);
    });

    it('should reject path outside allowed directories', async () => {
      const testPath = '/not/allowed/test.txt';

      await expect(manager.validatePath(testPath, allowedDirs)).rejects.toThrow(
        FileSystemError
      );
    });

    it('should reject symlink to outside allowed directories', async () => {
      const testPath = '/allowed/dir1/test.txt';
      mockFs.realpath.mockResolvedValue('/not/allowed/real.txt');

      await expect(manager.validatePath(testPath, allowedDirs)).rejects.toThrow(
        FileSystemError
      );
    });
  });
});

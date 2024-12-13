// src/utils/fs.ts
import fs from 'fs/promises';
import path from 'path';
import { FileSystemError } from '../types/errors.js';

export interface FileSystemManager {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  validatePath(path: string, allowedDirs: string[]): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

// TODO: update this to use memfs
export class LocalFileSystemManager implements FileSystemManager {
  async readFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      throw new FileSystemError(
        `Failed to read file: ${filePath}`,
        'READ_ERROR',
        { path: filePath, error }
      );
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
    } catch (error) {
      throw new FileSystemError(
        `Failed to write file: ${filePath}`,
        'WRITE_ERROR',
        { path: filePath, error }
      );
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Implement in LocalFileSystemManager
  async rename(oldPath: string, newPath: string): Promise<void> {
    try {
      await fs.rename(oldPath, newPath);
    } catch (error) {
      throw new FileSystemError(
        `Failed to rename file from ${oldPath} to ${newPath}`,
        'RENAME_ERROR',
        { oldPath, newPath, error }
      );
    }
  }

  async unlink(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch (error) {
      throw new FileSystemError(
        `Failed to delete file: ${path}`,
        'DELETE_ERROR',
        { path, error }
      );
    }
  }

  async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async validatePath(
    requestedPath: string,
    allowedDirs: string[]
  ): Promise<string> {
    const normalized = path.normalize(requestedPath).toLowerCase();
    const absolute = path.resolve(normalized);

    // Check if path is within allowed directories
    const isAllowed = allowedDirs.some((dir) =>
      normalized.startsWith(path.normalize(dir).toLowerCase())
    );

    if (!isAllowed) {
      throw new FileSystemError(
        'Path is outside allowed directories',
        'INVALID_PATH',
        { path: requestedPath, allowedDirs }
      );
    }

    // Check for symlinks
    try {
      const realPath = await fs.realpath(absolute);
      const normalizedReal = path.normalize(realPath).toLowerCase();

      const isRealPathAllowed = allowedDirs.some((dir) =>
        normalizedReal.startsWith(path.normalize(dir).toLowerCase())
      );

      if (!isRealPathAllowed) {
        throw new FileSystemError(
          'Symlink target is outside allowed directories',
          'INVALID_SYMLINK',
          { path: requestedPath, realPath }
        );
      }

      return realPath;
    } catch (error) {
      throw new FileSystemError('Failed to validate path', 'VALIDATION_ERROR', {
        path: requestedPath,
        error,
      });
    }
  }
}

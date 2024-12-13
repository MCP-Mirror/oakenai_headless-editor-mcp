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
  createDirectory(dir: string): Promise<void>;
  removeDirectory(dir: string): Promise<void>;
}

// TODO: update this to use memfs
export class LocalFileSystemManager implements FileSystemManager {
  private readonly allowedDirs: Set<string>;

  constructor(allowedDirs: string[]) {
    this.allowedDirs = new Set(allowedDirs);
  }

  async readFile(filePath: string): Promise<string> {
    await this.validatePath(filePath);
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
    this.isInAllowedDirs(filePath);
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

  async createDirectory(dir: string): Promise<void> {
    const isDir = await this.isDirectory(dir);
    try {
      if (!isDir) {
        await fs.mkdir(dir);
      }
    } catch (error) {
      throw new FileSystemError(
        `Failed to create directory: ${dir}`,
        'CREATE_DIR_ERROR',
        { dir, error }
      );
    }
  }

  async exists(filePath: string): Promise<boolean> {
    await this.validatePath(filePath);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Implement in LocalFileSystemManager
  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.validatePath(newPath);
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
    await this.validatePath(path);
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
    this.isInAllowedDirs(filePath);
    try {
      const stats = await fs.stat(filePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  isInAllowedDirs(requestedPath: string) {
    // Normalize and resolve the requested path
    const resolvedPath = path.resolve(requestedPath);

    // Convert allowed dirs to resolved absolute paths
    const resolvedAllowedDirs = Array.from(this.allowedDirs).map((dir) =>
      path.resolve(dir)
    );

    // Check if path is within allowed directories using resolved paths
    const isAllowed = resolvedAllowedDirs.some((allowedDir) => {
      return resolvedPath.startsWith(allowedDir);
    });

    if (!isAllowed) {
      throw new FileSystemError(
        'Path is outside allowed directories',
        'INVALID_PATH',
        { path: requestedPath, allowedDirs: Array.from(this.allowedDirs) }
      );
    }

    return isAllowed;
  }

  async removeDirectory(dir: string): Promise<void> {
    await this.validatePath(dir);

    try {
      // Check if path exists and is a directory
      const isDir = await this.isDirectory(dir);
      if (!isDir) {
        throw new FileSystemError(
          `Path is not a directory: ${dir}`,
          'NOT_A_DIRECTORY',
          { path: dir }
        );
      }

      // Use recursive option to remove directory and all contents
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      if (error instanceof FileSystemError) {
        throw error;
      }
      throw new FileSystemError(
        `Failed to remove directory: ${dir}`,
        'REMOVE_DIR_ERROR',
        { dir, error }
      );
    }
  }

  async validatePath(requestedPath: string): Promise<string> {
    // Normalize and resolve the requested path
    const resolvedPath = path.resolve(requestedPath);

    if (!this.isInAllowedDirs(resolvedPath)) {
      throw new FileSystemError(
        'Path is outside allowed directories',
        'INVALID_PATH',
        { path: requestedPath, allowedDirs: Array.from(this.allowedDirs) }
      );
    }

    // Check for symlinks
    try {
      const realPath = await fs.realpath(resolvedPath);

      // Convert allowed dirs to resolved absolute paths
      const resolvedAllowedDirs = Array.from(this.allowedDirs).map((dir) =>
        path.resolve(dir)
      );

      // Check if real path is within any of the allowed directories
      const isRealPathAllowed = resolvedAllowedDirs.some((allowedDir) =>
        path.resolve(realPath).startsWith(allowedDir)
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

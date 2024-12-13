// src/types/errors.ts

export class BaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class FileSystemError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `FS_${code}`, details);
  }
}

export class SessionError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `SESSION_${code}`, details);
  }
}

export class ValidationError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `VALIDATION_${code}`, details);
  }
}

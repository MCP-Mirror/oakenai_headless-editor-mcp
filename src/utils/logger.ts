// src/utils/logger.ts
/**
 * Log levels for the system
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

/**
 * Interface for system logging
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
}

/**
 * Options for configuring the logger
 */
interface LoggerOptions {
  /** Minimum log level to output */
  minLevel?: LogLevel;
  
  /** Whether to include timestamps */
  timestamps?: boolean;
  
  /** Whether to include log level in output */
  showLevel?: boolean;
  
  /** Custom output function (defaults to console) */
  output?: (message: string) => void;
}

/**
 * Format context object for logging
 */
function formatContext(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  return `\nContext: ${JSON.stringify(context, null, 2)}`;
}

/**
 * Format error object for logging
 */
function formatError(error: Error): string {
  return `\nError: ${error.message}${error.stack ? `\nStack: ${error.stack}` : ''}`;
}

export class SystemLogger implements Logger {
  private level: LogLevel = LogLevel.INFO;
  private readonly timestamps: boolean;
  private readonly showLevel: boolean;
  private readonly output: (message: string) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.minLevel ?? LogLevel.INFO;
    this.timestamps = options.timestamps ?? true;
    this.showLevel = options.showLevel ?? true;
    this.output = options.output ?? console.error;
  }

  /**
   * Sets the minimum log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Checks if a given log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3
    };

    return levels[level] >= levels[this.level];
  }

  /**
   * Formats a log message with timestamp and level if enabled
   */
  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];

    if (this.timestamps) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    if (this.showLevel) {
      parts.push(`[${level.toUpperCase()}]`);
    }

    parts.push(message);

    return parts.join(' ');
  }

  /**
   * Outputs a log message if it meets the minimum level requirement
   */
  private log(level: LogLevel, message: string): void {
    if (this.shouldLog(level)) {
      this.output(this.formatMessage(level, message));
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(
      LogLevel.DEBUG,
      `${message}${formatContext(context)}`
    );
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(
      LogLevel.INFO,
      `${message}${formatContext(context)}`
    );
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(
      LogLevel.WARN,
      `${message}${formatContext(context)}`
    );
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(
      LogLevel.ERROR,
      `${message}${error ? formatError(error) : ''}${formatContext(context)}`
    );
  }
}

/**
 * Creates a no-op logger that doesn't output anything
 */
export class NoopLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  setLevel(): void {}
}

/**
 * Default logger instance for the system
 */
export const logger = new SystemLogger({
  minLevel: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  timestamps: true,
  showLevel: true
});
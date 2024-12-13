import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { FileSystemManager } from './fs.js';

type LogContext = Error | Record<string, unknown> | string | null | undefined;

export interface Logger {
  log(message: string, ...context: LogContext[]): void;
  debug(message: string, ...context: LogContext[]): void;
  info(message: string, ...context: LogContext[]): void;
  warn(message: string, ...context: LogContext[]): void;
  error(message: string, ...context: LogContext[]): void;
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export interface LoggerConfig {
  minLevel?: LogLevel;
  logDir?: string;
  filename?: string;
  maxSize?: string;
  maxDays?: number;
  compress?: boolean;
  console?: boolean;
  format?: winston.Logform.Format;
  timestamps?: boolean;
  datePattern?: string;
}

export class EnhancedLogger implements Logger {
  private logger?: winston.Logger;
  private config: LoggerConfig;
  private fsManager: FileSystemManager;
  private initPromise: Promise<void>;
  private ready: boolean = false;

  constructor(config: LoggerConfig = {}, fsManager: FileSystemManager) {
    this.config = {
      minLevel: config.minLevel ?? LogLevel.INFO,
      logDir: config.logDir ?? 'logs',
      filename: config.filename ?? 'app-%DATE%.log',
      maxSize: config.maxSize ?? '10m',
      maxDays: config.maxDays ?? 14,
      compress: config.compress ?? true,
      console: config.console ?? true,
      timestamps: config.timestamps ?? true,
      datePattern: config.datePattern ?? 'YYYY-MM-DD',
    };

    this.fsManager = fsManager;
    this.initPromise = this.initLogger();
  }

  private async waitForInit(): Promise<void> {
    if (!this.ready) {
      await this.initPromise;
      this.ready = true;
    }
  }

  private async safeLog(
    level: string,
    message: string,
    metadata?: LogContext
  ): Promise<void> {
    try {
      await this.waitForInit();
      if (this.logger) {
        if (metadata instanceof Error) {
          metadata = {
            error: {
              stack: metadata.stack,
              ...metadata,
            },
          };
        }
        this.logger.log(level, message, metadata);
      }
    } catch (error) {
      console.error('Logging failed:', error);
      // Fallback to console
      console.log(`[${level.toUpperCase()}] ${message}`, metadata);
    }
  }

  private async initLogger(): Promise<void> {
    const transports: winston.transport[] = [];

    // Create log directory if it doesn't exist
    const logDir = this.config.logDir!;
    const isDir = await this.fsManager.isDirectory(logDir).catch(() => false);
    if (!isDir) {
      await this.fsManager.createDirectory(logDir);
    }

    // Configure file rotation transport
    const fileRotateTransport = new DailyRotateFile({
      filename: path.join(logDir, this.config.filename!),
      datePattern: this.config.datePattern,
      maxSize: this.config.maxSize,
      maxFiles: `${this.config.maxDays}d`,
      zippedArchive: this.config.compress,
      format: this.getLogFormat(),
    });

    transports.push(fileRotateTransport);

    // Add console transport if enabled
    if (this.config.console) {
      transports.push(
        new winston.transports.Console({
          format: this.getLogFormat(true),
        })
      );
    }

    // Create Winston logger instance
    this.logger = winston.createLogger({
      level: this.config.minLevel,
      levels: {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
        critical: 4,
      },
      transports,
    });

    // Handle rotation events
    fileRotateTransport.on('rotate', (oldFilename, newFilename) => {
      this.logger?.info('Rotating log files', {
        oldFile: oldFilename,
        newFile: newFilename,
      });
    });
  }

  private getLogFormat(colorize: boolean = false): winston.Logform.Format {
    const formats: winston.Logform.Format[] = [];

    if (colorize) {
      formats.push(winston.format.colorize());
    }

    if (this.config.timestamps) {
      formats.push(winston.format.timestamp());
    }

    formats.push(
      winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let log = `${timestamp ? `[${timestamp}] ` : ''}[${level}]: ${message}`;

        if (Object.keys(metadata).length > 0) {
          log += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
        }

        return log;
      })
    );

    return winston.format.combine(...formats);
  }

  async log(message: string): Promise<void> {
    await this.safeLog('info', message);
  }

  async debug(message: string, metadata?: LogContext): Promise<void> {
    await this.safeLog('debug', message, metadata);
  }

  async info(message: string, metadata?: LogContext): Promise<void> {
    await this.safeLog('info', message, metadata);
  }

  async warn(message: string, metadata?: LogContext): Promise<void> {
    await this.safeLog('warn', message, metadata);
  }

  async error(message: string, metadata?: LogContext): Promise<void> {
    await this.safeLog('error', message, metadata);
  }

  async critical(
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const errorMetadata = error
      ? {
          error: {
            stack: error.stack,
            ...error,
          },
          ...metadata,
        }
      : metadata;

    await this.safeLog('critical', message, errorMetadata);
  }

  async setLevel(level: LogLevel): Promise<void> {
    await this.waitForInit();
    if (this.logger) {
      this.logger.level = level;
    }
  }

  async updateConfig(config: Partial<LoggerConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await this.initLogger();
  }

  async child(
    defaultMetadata: Record<string, unknown>
  ): Promise<EnhancedLogger> {
    await this.waitForInit();
    const childLogger = new EnhancedLogger(this.config, this.fsManager);
    if (this.logger) {
      childLogger.logger = this.logger.child(defaultMetadata);
    }
    return childLogger;
  }
}

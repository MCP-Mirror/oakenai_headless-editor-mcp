// src/utils/__tests__/logger.test.ts
import { SystemLogger, NoopLogger, LogLevel } from '../utils/logger.js';

describe('SystemLogger', () => {
  let outputMock: jest.Mock;
  let logger: SystemLogger;

  beforeEach(() => {
    outputMock = jest.fn();
    logger = new SystemLogger({ 
      output: outputMock,
      timestamps: false, // Disable timestamps for easier testing
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('log levels', () => {
    it('should respect minimum log level', () => {
      logger.setLevel(LogLevel.WARN);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(outputMock).not.toHaveBeenCalledWith(expect.stringContaining('Debug message'));
      expect(outputMock).not.toHaveBeenCalledWith(expect.stringContaining('Info message'));
      expect(outputMock).toHaveBeenCalledWith(expect.stringContaining('Warning message'));
      expect(outputMock).toHaveBeenCalledWith(expect.stringContaining('Error message'));
    });

    it('should output all levels when set to DEBUG', () => {
      logger.setLevel(LogLevel.DEBUG);

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      expect(outputMock).toHaveBeenCalledTimes(4);
    });
  });

  describe('formatting', () => {
    it('should format context objects', () => {
      const context = { key: 'value' };
      logger.info('Message with context', context);

      expect(outputMock).toHaveBeenCalledWith(
        expect.stringContaining('Message with context\nContext: {\n  "key": "value"\n}')
      );
    });

    it('should format error objects', () => {
      const error = new Error('Test error');
      logger.error('Error occurred', error);

      expect(outputMock).toHaveBeenCalledWith(
        expect.stringContaining('Error occurred\nError: Test error\nStack:')
      );
    });

    it('should include timestamps when enabled', () => {
      logger = new SystemLogger({ 
        output: outputMock,
        timestamps: true 
      });

      logger.info('Test message');

      expect(outputMock).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*\].*Test message/)
      );
    });
  });
});

describe('NoopLogger', () => {
  it('should not output anything', () => {
    const consoleSpy = jest.spyOn(console, 'error');
    const logger = new NoopLogger();

    logger.debug();
    logger.info();
    logger.warn();  
    logger.error();
    logger.setLevel();

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
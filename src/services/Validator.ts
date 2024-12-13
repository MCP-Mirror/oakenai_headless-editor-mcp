import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver-protocol';
import { EditOperation } from '../types/editor.js';
import { LSPManager } from '../types/lsp.js';
import { ValidationError, ValidationResult } from '../types/validator.js';
import { Logger } from '../utils/logger.js';

export class Validator {
  constructor(
    private readonly lspManager: LSPManager,
    private readonly logger: Logger
  ) {}

  /**
   * Validates syntax of code content using appropriate language server
   * @param content Code content to validate
   * @param languageId Language identifier
   * @param uri Document URI
   */
  async validateSyntax(
    content: string,
    languageId: string,
    uri: string
  ): Promise<Diagnostic[]> {
    try {
      this.logger.debug('Starting syntax validation', {
        languageId,
        uri,
        contentLength: content.length,
      });

      const startTime = Date.now();

      // Get server instance
      const server = await this.lspManager.getServer(languageId);

      // Make sure we're sending the content to validate
      const diagnostics = await server.validateDocument(uri, content);

      this.logger.debug('Completed syntax validation', {
        languageId,
        uri,
        diagnosticsCount: diagnostics.length,
        duration: Date.now() - startTime,
      });

      return diagnostics;
    } catch (error) {
      this.logger.error('Syntax validation failed', error as Error, {
        languageId,
        uri,
      });
      throw new ValidationError(
        'Failed to validate syntax',
        'SYNTAX_VALIDATION_FAILED',
        { languageId, uri, error }
      );
    }
  }

  /**
   * Validates an edit operation before it's applied
   * @param operation Edit operation to validate
   * @param document Current document state
   * @param languageId Language identifier
   */
  async validateEdit(
    operation: EditOperation,
    content: string,
    languageId: string,
    uri: string
  ): Promise<ValidationResult> {
    try {
      this.logger.debug('Starting edit validation', {
        operationType: operation.type,
        uri,
      });

      const startTime = Date.now();
      const errors: ValidationError[] = [];
      const warnings: string[] = [];

      // 1. Validate operation structure
      this.validateOperationStructure(operation, errors);

      // 2. Validate ranges and positions
      this.validateRanges(operation, content, errors);

      // 3. Validate content if present
      if (operation.content) {
        this.validateContent(operation.content, warnings);
      }

      // 4. Simulate the edit and validate resulting syntax
      const simulatedContent = await this.simulateEdit(operation, content);

      // Important: Always validate the simulated content
      const diagnostics = await this.validateSyntax(
        simulatedContent,
        languageId,
        uri
      );

      const isValid =
        errors.length === 0 &&
        !diagnostics.some((d) => d.severity === DiagnosticSeverity.Error);

      const result: ValidationResult = {
        isValid,
        diagnostics,
        ...(errors.length > 0 && { errors }),
        ...(warnings.length > 0 && { warnings }),
      };

      this.logger.debug('Completed edit validation', {
        operationType: operation.type,
        uri,
        isValid,
        errorsCount: errors.length,
        warningsCount: warnings.length,
        diagnosticsCount: diagnostics.length,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Edit validation failed', error as Error, {
        operation,
        uri,
      });
      throw new ValidationError(
        'Failed to validate edit operation',
        'EDIT_VALIDATION_FAILED',
        { operation, uri, error }
      );
    }
  }

  /**
   * Validates operation structure and required fields
   */
  private validateOperationStructure(
    operation: EditOperation,
    errors: ValidationError[]
  ): void {
    // Validate operation type
    if (!operation.type) {
      errors.push(
        new ValidationError('Missing operation type', 'INVALID_OPERATION_TYPE')
      );
      return;
    }

    // Validate required fields based on operation type
    switch (operation.type) {
      case 'insert':
        if (!operation.position && !operation.range) {
          errors.push(
            new ValidationError(
              'Insert operation requires position or range',
              'MISSING_POSITION'
            )
          );
        }
        if (!operation.content) {
          errors.push(
            new ValidationError(
              'Insert operation requires content',
              'MISSING_CONTENT'
            )
          );
        }
        break;

      case 'delete':
        if (!operation.range) {
          errors.push(
            new ValidationError(
              'Delete operation requires range',
              'MISSING_RANGE'
            )
          );
        }
        break;

      case 'replace':
        if (!operation.range) {
          errors.push(
            new ValidationError(
              'Replace operation requires range',
              'MISSING_RANGE'
            )
          );
        }
        if (!operation.content) {
          errors.push(
            new ValidationError(
              'Replace operation requires content',
              'MISSING_CONTENT'
            )
          );
        }
        break;

      default:
        errors.push(
          new ValidationError(
            `Unsupported operation type: ${operation.type}`,
            'UNSUPPORTED_OPERATION'
          )
        );
    }
  }

  /**
   * Validates operation ranges against document content
   */
  private validateRanges(
    operation: EditOperation,
    content: string,
    errors: ValidationError[]
  ): void {
    const lines = content.split('\n');
    const lastLine = lines.length - 1;
    const lastLineLength = lines[lastLine].length;

    // Helper function to validate position
    const validatePosition = (range: Range): boolean => {
      return (
        range.start.line >= 0 &&
        range.start.line <= lastLine &&
        range.start.character >= 0 &&
        range.start.character <=
          (range.start.line === lastLine
            ? lastLineLength
            : lines[range.start.line].length) &&
        range.end.line >= 0 &&
        range.end.line <= lastLine &&
        range.end.character >= 0 &&
        range.end.character <=
          (range.end.line === lastLine
            ? lastLineLength
            : lines[range.end.line].length)
      );
    };

    if (operation.range) {
      if (!validatePosition(operation.range)) {
        errors.push(
          new ValidationError(
            'Invalid range: position outside document bounds',
            'INVALID_RANGE'
          )
        );
      }
    }

    if (operation.position) {
      const positionRange: Range = {
        start: operation.position,
        end: operation.position,
      };
      if (!validatePosition(positionRange)) {
        errors.push(
          new ValidationError(
            'Invalid position: outside document bounds',
            'INVALID_POSITION'
          )
        );
      }
    }
  }

  /**
   * Validates operation content for potential issues
   */
  private validateContent(content: string, warnings: string[]): void {
    // Check for very large content
    if (content.length > 100000) {
      warnings.push('Large content size may impact performance');
    }

    // Check for mixed line endings
    if (content.includes('\r\n') && content.includes('\n')) {
      warnings.push('Mixed line endings detected in content');
    }

    // Check for trailing whitespace
    if (/[ \t]+$/m.test(content)) {
      warnings.push('Trailing whitespace detected in content');
    }
  }

  /**
   * Simulates applying the edit operation to get resulting content
   */
  private async simulateEdit(
    operation: EditOperation,
    content: string
  ): Promise<string> {
    const lines = content.split('\n');

    switch (operation.type) {
      case 'insert': {
        if (operation.position) {
          const before = lines
            .slice(0, operation.position.line)
            .concat(
              lines[operation.position.line]?.slice(
                0,
                operation.position.character
              ) || ''
            )
            .join('\n');
          const after =
            (lines[operation.position.line]?.slice(
              operation.position.character
            ) || '') +
            '\n' +
            lines.slice(operation.position.line + 1).join('\n');
          return Promise.resolve(before + (operation.content || '') + after);
        }
        if (operation.range) {
          const before = lines
            .slice(0, operation.range.start.line)
            .concat(
              lines[operation.range.start.line]?.slice(
                0,
                operation.range.start.character
              ) || ''
            )
            .join('\n');
          const after =
            (lines[operation.range.end.line]?.slice(
              operation.range.end.character
            ) || '') +
            '\n' +
            lines.slice(operation.range.end.line + 1).join('\n');
          return Promise.resolve(before + (operation.content || '') + after);
        }
        break;
      }

      case 'delete': {
        if (operation.range) {
          const before = lines
            .slice(0, operation.range.start.line)
            .concat(
              lines[operation.range.start.line].slice(
                0,
                operation.range.start.character
              )
            )
            .join('\n');
          const after =
            lines[operation.range.end.line].slice(
              operation.range.end.character
            ) +
            '\n' +
            lines.slice(operation.range.end.line + 1).join('\n');
          return before + after;
        }
        break;
      }

      case 'replace': {
        if (operation.range) {
          const before = lines
            .slice(0, operation.range.start.line)
            .concat(
              lines[operation.range.start.line].slice(
                0,
                operation.range.start.character
              )
            )
            .join('\n');
          const after =
            lines[operation.range.end.line].slice(
              operation.range.end.character
            ) +
            '\n' +
            lines.slice(operation.range.end.line + 1).join('\n');
          return before + (operation.content || '') + after;
        }
        break;
      }
    }

    return Promise.resolve(content);
  }
}

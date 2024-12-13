// src/services/EditOperationManager.ts

import { Position, Range, TextEdit } from 'vscode-languageserver-protocol';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { CodeTarget, EditOperation, EditResult } from '../types/editor.js';
import { BaseError } from '../types/errors.js';
import { LSPManager } from '../types/lsp.js';
import { Logger } from '../utils/logger.js';
import { SessionManager } from './SessionManager.js';

export class EditError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `EDIT_${code}`, details);
  }
}

export class EditOperationManager {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly lspManager: LSPManager,
    private readonly logger: Logger
  ) {}

  /**
   * Applies an edit operation to a document
   */
  async applyEdit(
    sessionId: string,
    operation: EditOperation
  ): Promise<EditResult> {
    try {
      // Get session
      const session = await this.sessionManager.getSession(sessionId);
      const { document, languageId } = session;

      // Create edit
      const edit = await this.createEdit(document, operation);

      // Apply edit to document
      const newContent = TextDocument.applyEdits(document, [edit]);
      const newVersion = document.version + 1;

      // Create new document with changes
      const updatedDoc = TextDocument.create(
        document.uri,
        languageId,
        newVersion,
        newContent
      );

      // Validate changes
      const diagnostics = await this.lspManager.validateDocument(
        document.uri,
        newContent,
        languageId
      );

      // Update session with new document
      await this.sessionManager.updateSession(sessionId, {
        document: updatedDoc,
      });

      const success = diagnostics.length === 0;

      this.logger.info('Applied edit operation', {
        sessionId,
        operationType: operation.type,
        success,
        diagnosticsCount: diagnostics.length,
      });

      return {
        success,
        diagnostics,
        changes: [edit],
      };
    } catch (error) {
      this.logger.error('Failed to apply edit', error as Error, {
        sessionId,
        operation,
      });

      if (error instanceof EditError) {
        throw error;
      }

      throw new EditError(
        'Failed to apply edit operation',
        'OPERATION_FAILED',
        { sessionId, operation, error }
      );
    }
  }

  /**
   * Creates a TextEdit from an EditOperation
   */
  private async createEdit(
    document: TextDocument,
    operation: EditOperation
  ): Promise<TextEdit> {
    switch (operation.type) {
      case 'insert':
        if (!operation.position || !operation.content) {
          throw new EditError(
            'Missing required fields for insert operation',
            'INVALID_OPERATION',
            { operation }
          );
        }
        return {
          range: Range.create(operation.position, operation.position),
          newText: operation.content,
        };

      case 'delete':
        if (!operation.range) {
          throw new EditError(
            'Missing range for delete operation',
            'INVALID_OPERATION',
            { operation }
          );
        }
        return {
          range: operation.range,
          newText: '',
        };

      case 'replace':
        if (!operation.range || !operation.content) {
          throw new EditError(
            'Missing required fields for replace operation',
            'INVALID_OPERATION',
            { operation }
          );
        }
        return {
          range: operation.range,
          newText: operation.content,
        };

      default:
        throw new EditError(
          `Unsupported operation type: ${operation.type}`,
          'UNSUPPORTED_OPERATION',
          { operation }
        );
    }
  }

  /**
   * Validates an edit operation before applying it
   */
  private async validateOperation(operation: EditOperation): Promise<void> {
    // Validate operation type
    if (!operation.type) {
      throw new EditError('Missing operation type', 'INVALID_OPERATION', {
        operation,
      });
    }

    // Validate content for operations that require it
    if (
      (operation.type === 'insert' || operation.type === 'replace') &&
      !operation.content
    ) {
      throw new EditError(
        'Missing content for operation',
        'INVALID_OPERATION',
        { operation }
      );
    }

    // Validate position/range
    if (operation.type === 'insert' && !operation.position) {
      throw new EditError(
        'Missing position for insert operation',
        'INVALID_OPERATION',
        { operation }
      );
    }

    if (
      (operation.type === 'delete' || operation.type === 'replace') &&
      !operation.range
    ) {
      throw new EditError('Missing range for operation', 'INVALID_OPERATION', {
        operation,
      });
    }
  }
}

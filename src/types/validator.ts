import { Diagnostic } from 'vscode-languageserver-protocol';
import { BaseError } from './errors.js';

export class ValidationError extends BaseError {
  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message, `VALIDATION_${code}`, details);
  }
}

export interface ValidationResult {
  isValid: boolean;
  diagnostics: Diagnostic[];
  errors?: ValidationError[];
  warnings?: string[];
}

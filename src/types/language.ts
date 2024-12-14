// src/types/language.ts
export interface LanguageOptions {
  // Generic options that apply to all languages
  formatOptions?: {
    tabSize: number;
    insertSpaces: boolean;
    trimTrailingWhitespace?: boolean;
    insertFinalNewline?: boolean;
  };

  // Language-specific options as a union type
  specificOptions?: TypeScriptOptions | PythonOptions | JavaOptions;
}

// Language-specific option interfaces
export interface TypeScriptOptions {
  languageId: 'typescript';
  compilerOptions?: {
    target?: string;
    module?: string;
    jsx?: 'react' | 'react-jsx' | 'preserve';
    strict?: boolean;
    // other TS-specific options
  };
}

// TODO: Add Python options
export interface PythonOptions {
  languageId: 'python';
  pythonPath?: string;
  venvPath?: string;
  analysis?: {
    typeCheckingMode?: 'off' | 'basic' | 'strict';
    useLibraryCodeForTypes?: boolean;
  };
}

// TODO: Add Java options
export interface JavaOptions {
  languageId: 'java';
  javaHome?: string;
  projectRoot?: string;
  buildTool?: 'maven' | 'gradle';
}

// Project context becomes language-agnostic
export interface ProjectContext {
  rootPath: string;
  configPath?: string;
  workspacePath?: string;
  languageOptions?: LanguageOptions;
}

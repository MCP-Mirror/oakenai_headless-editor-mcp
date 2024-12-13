# Headless Code Editor MCP Server - MVP Implementation Plan

## Phase 1: Core Infrastructure (5-7 days)

### 1.1 Project Setup (1 day)
1. Project initialization
```bash
# Initialize project
npm init -y

# Install core dependencies
npm install @modelcontextprotocol/sdk vscode-languageserver vscode-languageserver-textdocument monaco-editor-core memfs
npm install typescript @types/node -D

# Setup TypeScript
npx tsc --init
```

2. Project structure
```
src/
├── server.ts          # Main MCP server
├── services/          # Core services
├── types/            # Type definitions
├── utils/            # Utility functions
└── tests/            # Test files
```

### 1.2 LSP Integration (2-3 days)
1. Implement LSP manager
```typescript
// src/services/lspManager.ts
class LSPManager {
  async initialize(): Promise<void>;
  async startServer(language: string): Promise<void>;
  async stopServer(language: string): Promise<void>;
}
```

2. Add TypeScript server support
```typescript
// src/services/languages/typescript.ts
class TypeScriptServer {
  async initialize(): Promise<void>;
  async validateDocument(uri: string): Promise<Diagnostic[]>;
  async formatDocument(uri: string): Promise<string>;
}
```

### 1.3 Document Management (2-3 days)
1. Implement document manager
```typescript
// src/services/documentManager.ts
class DocumentManager {
  async openDocument(uri: string): Promise<void>;
  async updateDocument(uri: string, content: string): Promise<void>;
  async closeDocument(uri: string): Promise<void>;
}
```

## Phase 2: Basic Editing Features (7-10 days)

### 2.1 Session Management (2-3 days)
1. Implement session handler
```typescript
// src/services/sessionManager.ts
interface EditSession {
  id: string;
  document: TextDocument;
  server: LanguageServer;
}

class SessionManager {
  async createSession(filePath: string): Promise<string>;
  async getSession(sessionId: string): Promise<EditSession>;
  async closeSession(sessionId: string): Promise<void>;
}
```

2. Add session tool
```typescript
// Example usage
editor.registerTool('start_session', {
  handler: async (args) => {
    const sessionId = await sessionManager.createSession(args.path);
    return { sessionId };
  }
});
```

### 2.2 Basic Edit Operations (3-4 days)
1. Implement core edit operations
```typescript
// src/services/editOperations.ts
interface EditOperation {
  type: 'insert' | 'delete' | 'replace';
  range: Range;
  content?: string;
}

class EditOperationHandler {
  async applyEdit(sessionId: string, operation: EditOperation): Promise<EditResult>;
  async validateEdit(sessionId: string, operation: EditOperation): Promise<boolean>;
}
```

2. Add edit tool
```typescript
editor.registerTool('edit_code', {
  handler: async (args) => {
    const result = await editHandler.applyEdit(args.sessionId, args.operation);
    return result;
  }
});
```

### 2.3 Validation (2-3 days)
1. Implement validation service
```typescript
// src/services/validator.ts
class Validator {
  async validateSyntax(content: string): Promise<Diagnostic[]>;
  async validateEdit(operation: EditOperation): Promise<ValidationResult>;
}
```

2. Add validation tool
```typescript
editor.registerTool('validate_code', {
  handler: async (args) => {
    const diagnostics = await validator.validateSyntax(args.content);
    return { diagnostics };
  }
});
```

## Phase 3: Rich Targeting (7-10 days)

### 3.1 Basic Target Resolution (3-4 days)
1. Implement target resolver
```typescript
// src/services/targetResolver.ts
interface CodeTarget {
  type: 'symbol' | 'range';
  name?: string;
  range?: Range;
}

class TargetResolver {
  async resolveTarget(target: CodeTarget): Promise<Location>;
  async validateTarget(target: CodeTarget): Promise<boolean>;
}
```

### 3.2 Component Recognition (2-3 days)
1. Implement React component detection
```typescript
// src/services/frameworks/react.ts
interface ComponentTarget extends CodeTarget {
  type: 'component';
  name: string;
  props?: Record<string, any>;
}

class ReactSupport {
  async findComponent(name: string): Promise<Location>;
  async analyzeProps(location: Location): Promise<PropAnalysis>;
}
```

### 3.3 Format Preservation (2-3 days)
1. Implement format handler
```typescript
// src/services/formatHandler.ts
class FormatHandler {
  async preserveFormat(range: Range): Promise<FormatContext>;
  async applyFormat(content: string, format: FormatContext): Promise<string>;
}
```

## Phase 4: Testing & Integration (5-7 days)

### 4.1 Test Infrastructure (2-3 days)
1. Setup test framework
```typescript
// src/tests/setup.ts
import { TestServer } from './utils/testServer';

function setupTestEnvironment(): TestServer;
```

2. Add core test suites
```typescript
// src/tests/edit.test.ts
describe('Edit Operations', () => {
  test('should apply basic edits', async () => {});
  test('should validate edits', async () => {});
  test('should preserve formatting', async () => {});
});
```

### 4.2 Integration Tests (2-3 days)
1. Implement end-to-end tests
```typescript
// src/tests/integration.test.ts
describe('Integration', () => {
  test('complete edit workflow', async () => {
    // Start session
    // Make edits
    // Validate
    // Commit changes
  });
});
```

### 4.3 Documentation (1 day)
1. API documentation
2. Usage examples
3. Setup guide

## Testing Strategy

### Unit Tests
```typescript
// Example test suite
describe('SessionManager', () => {
  test('creates new session', async () => {
    const manager = new SessionManager();
    const sessionId = await manager.createSession('test.ts');
    expect(sessionId).toBeDefined();
  });
});
```

### Integration Tests
```typescript
describe('Edit Workflow', () => {
  test('handles component update', async () => {
    // Create session
    const sessionId = await server.createSession('Button.tsx');
    
    // Apply edit
    const result = await server.applyEdit(sessionId, {
      target: { type: 'component', name: 'Button' },
      operation: { type: 'addProp', content: 'loading?: boolean' }
    });
    
    expect(result.success).toBe(true);
  });
});
```

## MVP Success Criteria

1. Core Features:
   - Create/manage edit sessions
   - Basic text editing operations
   - Syntax validation
   - Format preservation

2. TypeScript/React Support:
   - Component detection
   - Prop analysis
   - Basic refactoring

3. Performance:
   - Sub-second response time
   - Memory usage under 200MB
   - Support files up to 1MB

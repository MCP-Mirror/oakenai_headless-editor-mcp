# Headless Code Editor MCP Server

A robust, language-agnostic headless code editor that leverages the Language Server Protocol (LSP) for code intelligence and the Model Context Protocol (MCP) for AI-assisted code manipulation.

## Features

- LSP integration for language intelligence
- Secure file system operations with strict access controls
- Session-based editing with state management
- TypeScript/JavaScript language support with in-depth analysis
- React component detection and manipulation
- Format-preserving edit operations
- Comprehensive logging and error tracking

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Usage

### Starting the Server

```bash
# Start with allowed directory
node build/index.js /path/to/workspace

# Start with multiple allowed directories
node build/index.js /path/to/workspace1 /path/to/workspace2
```

### MCP Tools

1. `start_session`: Create a new editing session
2. `edit_code`: Apply edits to code
3. `validate_code`: Validate current code state
4. `close_session`: Clean up and close a session

### Example Integration

```typescript
const client = new Client(
  { name: "example-client", version: "1.0.0" },
  { capabilities: {} }
);

// Connect to server
const transport = new StdioClientTransport({
  command: "node",
  args: ["./build/index.js", "/workspace"]
});

await client.connect(transport);

// Start session
const result = await client.request({
  method: "tools/call",
  params: {
    name: "start_session",
    arguments: {
      filePath: "/workspace/example.ts",
      languageId: "typescript"
    }
  }
});
```

## Architecture

- **LSP Manager**: Coordinates language server lifecycle and communication
- **Document Manager**: Handles document state and synchronization
- **Session Manager**: Manages editing sessions and state
- **Edit Operation Manager**: Processes and validates code edits
- **File System Manager**: Provides secure file system access

## Security Features

- Path validation and normalization
- Access control through allowed directories
- Input sanitization
- File system operation boundaries
- Symlink security checks

## Incomplete Tasks

### Language Support
- [ ] Python language server integration
- [ ] Java language server integration
- [ ] Support for additional language servers

### Framework Support
- [ ] Component state analysis
- [ ] Hook dependencies tracking
- [ ] Automatic import management
- [ ] Type-aware refactoring

### Edit Operations
- [ ] Multi-file edit operations
- [ ] Complex refactoring operations
- [ ] Workspace-wide changes
- [ ] Conflict resolution system

### Performance
- [ ] Operation batching
- [ ] Incremental update optimization
- [ ] Memory usage optimization
- [ ] Large file handling improvements

### Testing
- [ ] End-to-end test suite
- [ ] Performance benchmarks
- [ ] Load testing
- [ ] Cross-platform testing

### Documentation
- [ ] API documentation
- [ ] Integration guides
- [ ] Deployment guide
- [ ] Troubleshooting guide

### Infrastructure
- [ ] Remote server support
- [ ] Configuration system
- [ ] Plugin architecture
- [ ] Workspace indexing

### Monitoring
- [ ] Performance metrics
- [ ] Operation analytics
- [ ] Health monitoring
- [ ] Resource usage tracking

## Contributing

1. Fork the repository
2. Create your feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Documentation

### Architecture and Design
- [Core Architecture](docs/core-architecture-docs.md): Foundational architecture and system design
- [LSP Smart Editor Architecture](docs/lsp-smart-editor-architecture.md): Language Server Protocol integration details
- [Framework Integration Guide](docs/framework-integration-guide.md): Framework-specific support and integration patterns
- [Language Server Integration](docs/language-server-integration.md): Language server implementation and configuration
- [MVP Implementation Plan](docs/mvp-implementation-plan.md): Development roadmap and implementation stages

Our documentation covers:
- System architecture and design principles
- Component interactions and dependencies
- Framework integration patterns
- Language server specifications
- Implementation guidelines and best practices
- Security considerations
- Performance optimization strategies

For additional documentation needs, see our Incomplete Tasks section.

## License

MIT

## Development Status

Currently in alpha stage (v0.0.10) with basic TypeScript/JavaScript support and React component analysis. See the Incomplete Tasks section for planned features.
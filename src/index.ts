#!/usr/bin/env node
import { HeadlessEditorServer } from './server.js';

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    'Usage: headless-editor-mcp/build/index.js <allowed-directory> [additional-directories...]'
  );
  process.exit(1);
}

// Start server
const server = new HeadlessEditorServer(args);
server.start().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});

// Handle process signals
process.on('SIGINT', async () => {
  await server.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});

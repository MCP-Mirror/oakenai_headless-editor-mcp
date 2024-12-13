// src/scripts/test-headless-editor.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { LocalFileSystemManager } from '../src/utils/fs.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fs = new LocalFileSystemManager([__dirname]);

// Define schema for tool responses
const ToolResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string()
    })
  ),
  isError: z.boolean().optional()
});


async function setupTestFiles() {
  const fixturesDir = path.join(__dirname, 'test-fixtures');
  const currentDir = path.join(__dirname);
  await fs.createDirectory(fixturesDir);

  // Create a sample React component file
  const componentFile = path.join(fixturesDir, 'Button.tsx');
  const componentContent = `import React from 'react';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  variant = 'primary'
}) => {
  const buttonClass = \`button \${variant}\`;
  
  return (
    <button 
      className={buttonClass}
      onClick={onClick}
    >
      {label}
    </button>
  );
};
`.trim();

  await fs.writeFile(componentFile, componentContent);
  return { fixturesDir, componentFile, currentDir };
}

async function runTest(
  client: Client,
  testName: string,
  action: () => Promise<any>
): Promise<any> {
  console.log(`\n=== Testing: ${testName} ===`);
  try {
    const result = await action();
    // console.log('Result:', result.content[0].text);
    const parsedResult = JSON.parse(result.content[0].text);
    
    if (result.isError || (parsedResult.error && !testName.includes('Error'))) {
      console.error("Test failed:", parsedResult);
      const {diagnostics, ...rest} = parsedResult;
      console.error(JSON.stringify(rest, null, 2));
      if (diagnostics) {
        console.error("\nDiagnostics:");
        console.error(JSON.stringify(diagnostics, null, 2));
      }
      return null;
    }

    console.log("Test success:");
    console.log(JSON.stringify(parsedResult, null, 2));

    return parsedResult;
  } catch (error) {
    console.error('Test error:', error);
    return null;
  }
}



async function cleanup(client: Client, sessionId?: string, fixturesDir?: string) {
  if (sessionId) {
    try {
      await client.request({
        method: "tools/call",
        params: {
          name: "close_session",
          arguments: { sessionId }
        }
      }, ToolResultSchema);
      console.log("Session closed successfully");
    } catch (error) {
      console.error("Error closing session:", error);
    }
  }

  if (fixturesDir) {
    try {
      await fs.removeDirectory(fixturesDir);
      console.log("Test files cleaned up");
    } catch (error) {
      console.error("Error cleaning up test files:", error);
    }
  }
}

async function main() {
  let sessionId: string | undefined;
    // Setup test files
    const { fixturesDir, componentFile, currentDir } = await setupTestFiles();

    console.log("Current dir:", currentDir);
    console.log("Fixtures dir:", fixturesDir);
     // Create transport
     const transport = new StdioClientTransport({
      command: "node",
      args: ["./build/index.js", currentDir],
    });

    // Create client
    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(transport);

  try {
   
    // Test 1: Start editing session
    const sessionResult = await runTest(client, "Start Session", async () => {
      return client.request({
        method: "tools/call",
        params: {
          name: "start_session",
          arguments: {
            filePath: componentFile,
            languageId: "typescript"
          }
        }
      }, ToolResultSchema);
    });

    if (sessionResult) {
      sessionId = sessionResult.sessionId;
      console.log("Session ID:", sessionId);
    }

    if (!sessionId) {
      console.error("Session ID not found");
      return;
    }
    
    // Test 2: Edit with intentional error
    const editResult = await runTest(client, "Edit Code with Error", async () => {
      return client.request({
        method: "tools/call",
        params: {
          name: "edit_code",
          arguments: {
            sessionId,
            operation: {
              type: "insert",
              //content: "\n  size?: 'small' | 'medium' | 'large';\n",
              content: " // comment",
              position: {
                line: 5,
                character: 100
              }
            }
          }
        },
      }, ToolResultSchema);
    });

    // Test 3: Validate code
    const validateResult = await runTest(client, "Validate Code", async () => {
      return client.request({
        method: "tools/call",
        params: {
          name: "validate_code",
          arguments: {
            sessionId
          }
        }
      }, ToolResultSchema);
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    if (sessionId) {
      try {
        await cleanup(client, sessionId, fixturesDir);
        await client.close();
        console.log("Client closed");
      } catch (error) {
        console.error("Error closing session:", error);
        // Force exit if cleanup fails
        process.exit(1);
      }
    } else {
      const isDir = await fs.isDirectory(fixturesDir);
      if (isDir) {
        // Cleanup test files
        await fs.removeDirectory(fixturesDir);
      }
    }
  }
}

// Handle process signals
process.on('SIGINT', async () => {
  console.log("\nReceived SIGINT, cleaning up...");
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log("\nReceived SIGTERM, cleaning up...");
  process.exit(0);
});


// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
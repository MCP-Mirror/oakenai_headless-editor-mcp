// src/scripts/test-headless-editor.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { z } from 'zod';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  await fs.mkdir(fixturesDir, { recursive: true });

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
  return { fixturesDir, componentFile };
}

async function runTest(
  client: Client,
  testName: string,
  action: () => Promise<any>
) {
  console.log(`\n=== Testing: ${testName} ===`);
  try {
    const result = await action();
    console.log('Result:', result.content[0].text);
    if (result.isError) {
      console.error("Test failed:", JSON.parse(result.content[0].text));
      return null;
    }
    return JSON.parse(result.content[0].text);
  } catch (error) {
    console.error('Test error:', error);
    return null;
  }
}

async function main() {
  // Setup test files
  const { fixturesDir, componentFile } = await setupTestFiles();

  // Create transport
  const transport = new StdioClientTransport({
    command: "node",
    args: ["./build/index.js", fixturesDir],
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

  try {
    await client.connect(transport);

   
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

    if (!sessionResult) {
      throw new Error("Failed to start session");
    }

    const sessionId = sessionResult.sessionId;
    console.log("Session ID:", sessionId);

    // Test 2: Insert new prop
    const editResult = await runTest(client, "Edit Code", async () => {
      return client.request({
        method: "tools/call",
        params: {
          name: "edit_code",
          arguments: {
            sessionId,
            operation: {
              type: "insert",
              content: "\n  size?: 'small' | 'medium' | 'large';",
              position: {
                line: 5,  // Insert after the variant prop
                character: 0
              }
            }
          }
        },
      }, ToolResultSchema);
    });

    if (!editResult) {
      throw new Error("Failed to apply edit");
    }

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

    if (!validateResult) {
      throw new Error("Failed to validate code");
    }

    // Print final results
    console.log("\nTest Results:");
    console.log("Session created:", !!sessionResult);
    console.log("Edit applied:", !!editResult);
    console.log("Validation completed:", !!validateResult);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await client.close();
    // Cleanup test files
    await fs.rm(fixturesDir, { recursive: true, force: true });
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
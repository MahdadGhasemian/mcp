import ollama, { Message, Tool } from 'ollama'

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const OLLAMA_MODEL = process.env.OLLAMA_MODEL;

if (!OLLAMA_MODEL) {
  throw new Error("OLLAMA_MODEL is not set");
}

// Client Structure
class MCPClient {
  private mcp: Client;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];

  constructor() {
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  // Connection Management
  async connectToServer(serverScriptPath: string) {
    try {
      this.transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverScriptPath],
      });
      this.mcp.connect(this.transport);

      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as {
              type: string;
              properties?: {
                [key: string]: {
                  type?: string | string[];
                  items?: any;
                  description?: string;
                  enum?: any[];
                };
              };
              required?: string[];
            }
          }
        };
      });
      console.log(
        "Connected to server with tools:",
        this.tools.map((t) => t.function.name)
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  // Query Processing Logic
  async processQuery(query: string) {
    const messages: Message[] = [
      {
        role: "user",
        content: query,
      },
    ];

    const response = await ollama.chat({
      model: OLLAMA_MODEL!,
      messages,
      tools: this.tools,
    });

    const finalText: string[] = [];

    if (!response.message.tool_calls) {
      finalText.push(response.message.content);
    } else {
      for (const tool of response.message.tool_calls) {
        const toolName = tool.function.name;
        const toolArgs = tool.function.arguments as { [x: string]: unknown } | undefined;

        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });

        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        );

        messages.push({
          role: "user",
          content: JSON.stringify(result.content),
        });

        try {
          const response = await ollama.chat({
            model: OLLAMA_MODEL!,
            messages,
          });
          finalText.push(response.message.content || "");
        } catch (error) {
          finalText.push("\nEn error occured.\n");
          console.log(error)
          finalText.push("\n");
        }
      }
    }

    return finalText.join("\n");
  }

  // Interactive Chat interface
  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }
}

// Main Entry Point
async function main() {
  if (process.argv.length < 3) {
    console.log("Usage: node index.ts <path_to_server_script>");
    return;
  }
  const mcpClient = new MCPClient();
  try {
    await mcpClient.connectToServer(process.argv[2]);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

// Run
main();

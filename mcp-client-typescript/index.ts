import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam as AnthropicMessage,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import ollama, { Message as OllamaMessage, Tool as OllamaTool } from 'ollama'

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import readline from "readline/promises";
import dotenv from "dotenv";

dotenv.config();

const LLM_PROVIDER = process.env.LLM_PROVIDER;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
const ANTHROPIC_MAX_TOKENS = process.env.ANTHROPIC_MAX_TOKENS || 1000;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL;

if (LLM_PROVIDER === "OLLAMA" && !OLLAMA_MODEL) {
  throw new Error("OLLAMA_MODEL is not set");
}

if (LLM_PROVIDER === "ANTHROPIC" && !ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

if (LLM_PROVIDER === "ANTHROPIC" && !ANTHROPIC_MODEL) {
  throw new Error("ANTHROPIC_MODEL is not set");
}

// Client Structure
class MCPClient {
  private mcp: Client;
  private anthropic: Anthropic;
  private transport: StdioClientTransport | null = null;
  private anthropicTools: AnthropicTool[] = [];
  private ollamaTool: OllamaTool[] = [];

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
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

      if (LLM_PROVIDER === "ANTHROPIC") {
        this.anthropicTools = toolsResult.tools.map((tool) => {
          return {
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          };
        });
        console.log(
          "Connected to server with tools:",
          this.anthropicTools.map(({ name }) => name)
        );
      }
      if (LLM_PROVIDER === "OLLAMA") {
        this.ollamaTool = toolsResult.tools.map((tool) => {
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
          this.ollamaTool.map((t) => t.function.name)
        );
      }

      console.log(
        `LLM Provider: ${LLM_PROVIDER}`
      );
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  // Query Processing Logic Anthropic
  async processQueryAnthropic(query: string) {
    const messages: AnthropicMessage[] = [
      {
        role: "user",
        content: query,
      },
    ];

    const response = await this.anthropic.messages.create({
      model: ANTHROPIC_MODEL!,
      max_tokens: +ANTHROPIC_MAX_TOKENS,
      messages,
      tools: this.anthropicTools,
    });

    const finalText = [];
    const toolResults = [];

    for (const content of response.content) {
      if (content.type === "text") {
        finalText.push(content.text);
      } else if (content.type === "tool_use") {
        const toolName = content.name;
        const toolArgs = content.input as { [x: string]: unknown } | undefined;

        const result = await this.mcp.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        toolResults.push(result);
        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        );

        messages.push({
          role: "user",
          content: result.content as string,
        });

        const response = await this.anthropic.messages.create({
          model: ANTHROPIC_MODEL!,
          max_tokens: +ANTHROPIC_MAX_TOKENS,
          messages,
        });

        finalText.push(
          response.content[0].type === "text" ? response.content[0].text : ""
        );
      }
    }

    return finalText.join("\n");
  }

  // Query Processing Logic Ollama
  async processQueryOllama(query: string) {
    const messages: OllamaMessage[] = [
      {
        role: "user",
        content: query,
      },
    ];

    const response = await ollama.chat({
      model: OLLAMA_MODEL!,
      messages,
      tools: this.ollamaTool,
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

        const response = (LLM_PROVIDER === "ANTHROPIC") ?
          await this.processQueryAnthropic(message) :
          await this.processQueryOllama(message)

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

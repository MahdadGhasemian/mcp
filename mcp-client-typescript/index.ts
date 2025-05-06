import { Anthropic } from "@anthropic-ai/sdk";
import {
  MessageParam as AnthropicMessage,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import ollama, { Message as OllamaMessage, Tool as OllamaTool } from 'ollama'
import { FunctionCallingConfigMode, FunctionDeclaration, GenerateContentConfig, GoogleGenAI, Type } from "@google/genai";

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL;

export enum LLMProvider {
  OLLAMA = 'OLLAMA',
  ANTHROPIC = 'ANTHROPIC',
  GEMINI = 'GEMINI',
}

// Client Structure
class MCPClient {
  private mcp: Client;
  private llmProvider: LLMProvider;
  private anthropic: Anthropic | null = null;
  private gemini: GoogleGenAI | null = null;
  private transport: StdioClientTransport | null = null;
  private anthropicTools: AnthropicTool[] = [];
  private ollamaTool: OllamaTool[] = [];
  private geminiTools: FunctionDeclaration[] = [];
  private geminiConfig: GenerateContentConfig = {};

  constructor() {
    this.llmProvider = LLM_PROVIDER as LLMProvider;

    if (this.llmProvider === LLMProvider.ANTHROPIC) {
      if (!ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is required when using the Anthropic provider.");
      }
      if (!ANTHROPIC_MODEL) {
        throw new Error("ANTHROPIC_MODEL is required when using the Anthropic provider.");
      }
      this.anthropic = new Anthropic({
        apiKey: ANTHROPIC_API_KEY,
      });
    }

    if (this.llmProvider === LLMProvider.OLLAMA) {
      if (!OLLAMA_MODEL) {
        throw new Error("OLLAMA_MODEL is required when using the Ollama provider.");
      }
    }

    if (this.llmProvider === LLMProvider.GEMINI) {
      if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is required when using the Gemini provider.");
      }

      this.gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    }

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

      if (this.llmProvider === LLMProvider.ANTHROPIC) {
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
      else if (this.llmProvider === LLMProvider.OLLAMA) {
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
      else if (this.llmProvider === LLMProvider.GEMINI) {
        this.geminiTools = toolsResult.tools.map((tool) => {
          return {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: Type.OBJECT,
              properties: tool.inputSchema.properties as {
                [key: string]: {
                  type?: Type;
                  description?: string;
                };
              }
            },
          };
        });

        this.geminiConfig = {
          tools: [{ functionDeclarations: this.geminiTools }],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
              // mode: FunctionCallingConfigMode.ANY,
              // allowedFunctionNames: this.geminiTools.map(tool => tool.name || ""),
            }
          },
        };

        console.log(
          "Connected to server with tools:",
          this.geminiTools.map((t) => t.name)
        );
      }

      console.log(
        `LLM Provider: ${this.llmProvider}`
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

    if (!this.anthropic) return;

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

  // Query Processing Logic Gemini
  async processQueryGemini(query: string) {
    if (!this.gemini) return;

    const chatOptions = {
      history: [
        {
          role: "user",
          parts: [
            { text: "Hi there!" },
          ]
        },
        {
          role: "model",
          parts: [
            { text: "Great to meet you. What would you like to know?" },
          ]
        },
        {
          role: "user",
          parts: [
            { text: "I've created two usfull functions 'get-alerts', 'get-forecast' which is used to get weather conditions!" },
          ]
        },
        {
          role: "model",
          parts: [
            { text: "Thats Great!" },
          ]
        },
      ],
      config: {
        ...this.geminiConfig,
      },
    };

    // Create a chat session
    const chat = this.gemini.chats.create({
      model: GEMINI_MODEL!,
      ...chatOptions
    });
    const response = await chat.sendMessage({ message: query });


    const finalText = [];
    const toolResults = [];

    // Extract function call generated by the model
    const functionCalls = response?.functionCalls;
    if (functionCalls?.length) {
      for (const call of functionCalls) {
        const toolName = call.name;
        const toolArgs = call.args as { [x: string]: unknown } | undefined;

        const result = await this.mcp.callTool({
          name: toolName!,
          arguments: toolArgs,
        });
        toolResults.push(result);
        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`
        );

        const response = await chat.sendMessage({ message: JSON.stringify(result.content) as string });

        finalText.push(
          response.text ? response.text : ""
        );

      }
    } else {
      const parts = response.candidates ? response.candidates[0].content?.parts : [{ text: "" }];
      const text = parts ? parts[0].text : ''
      finalText.push(text);
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

        let response;

        if (this.llmProvider === LLMProvider.ANTHROPIC) {
          response =
            await this.processQueryAnthropic(message)
        } else if (this.llmProvider === LLMProvider.OLLAMA) {
          response =
            await this.processQueryOllama(message)
        } else if (this.llmProvider === LLMProvider.GEMINI) {
          response =
            await this.processQueryGemini(message)
        }

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

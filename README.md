# MCP Typescript

## Introduction

MCP is an open protocol that standardizes how applications provide context to LLMs. Think of MCP like a USB-C port for AI applications. Just as USB-C provides a standardized way to connect your devices to various peripherals and accessories, MCP provides a standardized way to connect AI models to different data sources and tools.

## Getting Started

### Clone the repository

```bash
git clone git@github.com:MahdadGhasemian/mcp-typescript-example.git
cd mcp-typescript-example
```

### Set up your environment variables

Copy the example environment file and create your .env file:

```bash
cp .env.example .env
```

Edit the .env file and replace the `ANTHROPIC_API_KEY` with your API key.
You can also modify `ANTHROPIC_MODEL` and `ANTHROPIC_MAX_TOKENS` if needed.

### Build and Running

```bash
npm run install-dependencies
npm run dev
```

## Query example

Give me the weather forecast for Los Angeles, California.

## MCP Server Debugging

```bash
npx @modelcontextprotocol/inspector node ./weather-server-typescript/build/index.js
```

## Docs

[Anthropic API Key Manage](https://console.anthropic.com/settings/keys)
[Anthropic Model Pricing](https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table)

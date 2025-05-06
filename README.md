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

Open the .env file and set the `LLM_PROVIDER` variable to either `OLLAMA`, `ANTHROPIC` or `GEMINI`, depending on which provider you want to use:

* **If you choose the `Ollama`**:
Set the `OLLAMA_MODEL` variable to match the model installed in your system.

* **If you choose the `Anthropic`**:
Set the `ANTHROPIC_API_KEY` with your API key.
You can also modify `ANTHROPIC_MODEL` and `ANTHROPIC_MAX_TOKENS` as needed.

* **If you choose the `Gemini`**:
Set the `GEMINI_API_KEY` with you API key.

### Build and Running

```bash
npm run install-dependencies
npm run dev
```

## Query example

Give me the weather forecast for Los Angeles, California.

## If needed

Sure! The approximate latitude and longitude for Los Angeles, California are: Latitude: 34.0522° N Longitude: 118.2437° W

## MCP Server Debugging

```bash
npx @modelcontextprotocol/inspector node ./weather-server-typescript/build/index.js

cd weather-server-typescript && npm run build-test && cd .. && npx @modelcontextprotocol/inspector node ./weather-server-typescript/build/test.js
```

## Docs

* [Anthropic API Key Manage](https://console.anthropic.com/settings/keys)
* [Anthropic Model Pricing](https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table)
* [Ollama](https://ollama.com/)
* [Gemini](https://ai.google.dev/gemini-api/docs/)
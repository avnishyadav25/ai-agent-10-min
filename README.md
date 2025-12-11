# AI Agent Coach (LangChain + Node.js)

A small CLI project that demonstrates a lightweight AI agent coach built with LangChain and Node.js. The agent uses an OpenAI-based chat model to help developers learn and build AI agents with short, practical JavaScript examples.

## Features
- Minimal CLI loop to prompt the agent and display replies
- Uses `@langchain/openai` and `@langchain/core` for prompt composition
- Easy to extend with more chains, tools, or instruction tuning

## Files
- `agent.js` — main script. Loads environment variables, constructs a prompt template and a Chat model, then starts a simple readline-based chat loop.
- `.env` — environment variables (should contain your API key). This file is ignored by `.gitignore`.

## Prerequisites
- Node.js 18+ (or compatible LTS)
- npm or yarn
- An OpenAI API key

## Setup
1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root with your OpenAI key:

```text
OPENAI_API_KEY=sk-xxxxxxx
```

3. Run the agent:

```bash
node agent.js
```

Type questions into the CLI. Type `exit` to quit.

## Usage tips
- The current system prompt (in `agent.js`) instructs the agent to act as an "AI Agent Coach". Modify that prompt to change behavior.
- Adjust `modelName` and `temperature` in `agent.js` to control model selection and creativity.

## Security
- Do not commit your `.env` file or API keys to version control. This repo includes a `.gitignore` entry to ignore `.env`.

## Troubleshooting
- If you see authentication errors, verify `OPENAI_API_KEY` is set and valid.
- If dependencies fail, remove `node_modules` and run `npm install` again.

## Extending
- Add tools (web, file access) or create more complex LangChain chains/prompts to build a richer agent.

---
If you want, I can also create a `package.json` script (e.g., `start`) or commit these files for you.

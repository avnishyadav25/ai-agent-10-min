// A minimal AI agent: Claude + a tool-use loop + short-term memory.
// Companion code for "How to Build an AI Agent in 10 Minutes" (https://avnishyadav.com).
require('dotenv').config({ quiet: true });
const readline = require('node:readline/promises');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 5; // safety break, as in the post

// 1. Tools: what Claude may ask us to run. The description tells Claude when to use it.
const tools = [
  {
    name: 'get_current_time',
    description:
      'Returns the current local date and time of the machine running the agent. ' +
      'Use this to answer questions about the current time or date.',
    input_schema: { type: 'object', properties: {} }, // no input needed
  },
];

// 2. The code that actually runs each tool, by name.
const toolFunctions = {
  get_current_time: () => {
    const now = new Date();
    return `The current time is ${now.toLocaleTimeString()} on ${now.toDateString()}.`;
  },
};

// Run every tool_use block in a response; ALL results go back in ONE user message.
async function runTools(content, impls = toolFunctions) {
  const results = [];
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    try {
      const fn = impls[block.name];
      if (!fn) throw new Error(`Tool "${block.name}" not found.`);
      const output = await fn(block.input);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: String(output) });
    } catch (err) {
      // Tell Claude the tool failed instead of crashing; it can explain or try something else.
      results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
    }
  }
  return results;
}

const textOf = (content) =>
  content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

// 3. The agent: memory (the messages array) + the loop.
function createAgent({ client, model = DEFAULT_MODEL, maxTokens = 16000, impls = toolFunctions, log = () => {} }) {
  const conversationHistory = []; // short-term memory, sent with every request

  async function chat(message) {
    const turnStart = conversationHistory.length;
    const rollback = () => { conversationHistory.length = turnStart; };
    conversationHistory.push({ role: 'user', content: message });

    try {
      for (let round = 0; ; round++) {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          messages: conversationHistory,
          tools,
        });
        const toolCalls = response.content.filter((b) => b.type === 'tool_use');

        if (response.stop_reason === 'refusal') {
          rollback(); // don't keep a declined request in memory
          const category = response.stop_details?.category;
          return `(Claude declined this request${category ? `: ${category}` : ''}.)`;
        }
        if (response.stop_reason === 'max_tokens' && toolCalls.length) {
          rollback(); // a cut-off tool call can't be answered
          return '(Reply cut off mid tool call: raise max_tokens and ask again.)';
        }

        // Keep the FULL assistant content (text, thinking and tool_use blocks), unchanged.
        conversationHistory.push({ role: 'assistant', content: response.content });

        if (response.stop_reason !== 'tool_use') {
          const text = textOf(response.content);
          return response.stop_reason === 'max_tokens' ? `${text}\n(Reply cut off: max_tokens reached.)` : text;
        }

        if (round >= MAX_TOOL_ROUNDS) {
          // Answer the pending calls so the history stays valid, then stop.
          conversationHistory.push({
            role: 'user',
            content: toolCalls.map((b) => ({
              type: 'tool_result', tool_use_id: b.id, content: 'Tool limit reached.', is_error: true,
            })),
          });
          return '(Stopped: too many tool calls in a row.)';
        }

        for (const b of toolCalls) log(`[tool] ${b.name} ${JSON.stringify(b.input)}`);
        conversationHistory.push({ role: 'user', content: await runTools(response.content, impls) });
      }
    } catch (err) {
      rollback(); // API failed: never leave a half-finished exchange in memory
      throw err;
    }
  }

  return { chat, history: conversationHistory };
}

// 4. Turn SDK errors into a short, useful message (most specific first).
function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Authentication failed (401): check ANTHROPIC_API_KEY.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Permission denied (403) for this key or model.';
  if (err instanceof Anthropic.NotFoundError) return 'Not found (404): check ANTHROPIC_MODEL.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited (429): wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `Bad request (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API: check your network.';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  return `Unexpected error: ${err.message}`;
}

// 5. A small terminal chat, or `--demo` to replay three scripted messages.
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.');
    process.exitCode = 1;
    return;
  }
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const agent = createAgent({ client: new Anthropic(), model, log: (line) => console.log(line) });

  const ask = async (question) => {
    try {
      console.log(`Agent: ${await agent.chat(question)}\n`);
    } catch (err) {
      console.error(`${describeError(err)}\n`);
    }
  };

  if (process.argv.includes('--demo')) {
    for (const q of ['Hi there, my name is Avnish.', "What's the current time?", 'What did I tell you my name was?']) {
      console.log(`You: ${q}`);
      await ask(q);
    }
    return;
  }

  console.log(`AI agent ready (${model}). Type a message, or "exit" to quit.\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => process.exit(0)); // Ctrl+D / Ctrl+C
  for (;;) {
    const question = (await rl.question('You: ')).trim();
    if (question.toLowerCase() === 'exit') break;
    if (question) await ask(question);
  }
  rl.close();
}

if (require.main === module) main();

module.exports = { createAgent, describeError, runTools, tools, toolFunctions, DEFAULT_MODEL };

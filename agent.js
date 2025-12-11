import 'dotenv/config';
import readline from 'readline';
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// 1. Initialize the model
const model = new ChatOpenAI({
  modelName: "gpt-4o-mini", // or gpt-4o / gpt-4.1 / gpt-3.5 depending on access
  temperature: 0.4,         // lower = more focused, higher = more creative
});

// 2. Define the prompt template (our “agent brain”)
const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `
You are an AI Agent Coach.

Your job:
- Help developers build and understand AI agents using LangChain and Node.js.
- Explain concepts clearly with short, practical examples.
- When showing code, use JavaScript (Node.js).
- If user asks something unrelated to AI agents, briefly answer but gently bring it back to the topic.

Rules:
- Be honest if you don't know something.
- Prefer simple language over jargon.
- Keep answers under 300 words unless user asks for more detail.
    `.trim(),
  ],
  ["human", "{input}"],
]);

// 3. Create a simple "chain": prompt -> model
const chain = prompt.pipe(model);

// 4. Small CLI loop so we can chat with the agent
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function ask(question) {
  const response = await chain.invoke({ input: question });
  console.log("\nAgent:\n", response.content, "\n");
}

function startChat() {
  rl.question("You: ", async (question) => {
    if (question.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    await ask(question);
    startChat();
  });
}

console.log("🤖 AI Agent ready! Type your question (or 'exit' to quit):\n");
startChat();

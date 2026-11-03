#!/usr/bin/env node
// Chat with islam-gpt.org in the terminal.
//   node bin/chat.js                 interactive: type a question, the answer streams in
//   node bin/chat.js "apa itu puasa" one question, then exit
// In the chat: /refs shows the sources of the last answer, /exit (or Ctrl+D) quits.
import { createInterface } from "node:readline/promises";
import { chat } from "../src/islam.js";

let lastRefs = [];

async function answer(question) {
  try {
    const { references } = await chat(question, { onChunk: (t) => process.stdout.write(t) });
    lastRefs = references;
    process.stdout.write(`\n${references.length ? `(${references.length} sources, /refs to show)\n` : ""}`);
  } catch (e) {
    console.error(`\nerror: ${e.message}`);
  }
}

const arg = process.argv.slice(2).join(" ").trim();
if (arg) {
  await answer(arg);
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("islam-gpt chat. /refs = sources of the last answer, /exit = quit.");
rl.on("close", () => process.exit(0));
for (;;) {
  const line = (await rl.question("\n> ")).trim();
  if (!line) continue;
  if (line === "/exit") break;
  if (line === "/refs") {
    lastRefs.forEach((r, i) => console.log(`[${i + 1}] ${r.source}: ${String(r.content).slice(0, 160)}...`));
    continue;
  }
  await answer(line);
}
rl.close();

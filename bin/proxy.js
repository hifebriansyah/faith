#!/usr/bin/env node
// Local web-tools proxy for the browser UI (index.html): keeps BRAVE_API_KEY and the search/fetch code on the server.
//   BRAVE_API_KEY=... node bin/proxy.js        listens on 127.0.0.1:8787 (PORT to change)
// POST /agent {question, deviceId, persona?} streams SSE in the islam-gpt shape: {type:"tool"}, {type:"document",title,markdown}, {type:"chunk",text}, {type:"references"}, {type:"done"}.
// Only localhost origins may call it (ALLOWED_ORIGINS="https://a.com,https://b.com" to add more).
import { createServer } from "node:http";
import { agentChat } from "../src/agent.js";

const PORT = Number(process.env.PORT ?? 8787);
const EXTRA = (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
const MAX_BODY = 20_000;
const allowed = (o) => !!o && (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) || EXTRA.includes(o));

createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!allowed(origin)) return res.writeHead(403).end("origin not allowed");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method !== "POST" || req.url !== "/agent") return res.writeHead(404).end();

  let body = "";
  for await (const c of req) if ((body += c).length > MAX_BODY) return res.writeHead(413).end("too large");
  let question, deviceId, persona;
  try {
    ({ question, deviceId, persona } = JSON.parse(body));
    if (typeof question !== "string" || !question.trim()) throw new Error();
  } catch {
    return res.writeHead(400).end("need JSON {question}");
  }

  const ac = new AbortController();
  res.on("close", () => ac.abort());
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  try {
    const { references } = await agentChat(question, {
      deviceId: typeof deviceId === "string" ? deviceId : undefined,
      persona: typeof persona === "string" ? persona.slice(0, 6000) : "",
      onDocument: (d) => send({ type: "document", ...d }),
      onToolStart: ({ name, args }) => send({ type: "tool", phase: "start", name, args }),
      signal: ac.signal,
      onChunk: (text) => send({ type: "chunk", text }),
      onTool: ({ name, args, error, image }) => {
        send({ type: "tool", phase: "end", name, args, error });
        if (image) send({ type: "image", ...image });
      },
    });
    send({ type: "references", data: references });
  } catch (e) {
    if (!ac.signal.aborted) send({ type: "error", message: e.message });
  }
  send({ type: "done" });
  res.end();
}).listen(PORT, "127.0.0.1", () => console.log(`faith proxy on http://127.0.0.1:${PORT} (search: ${process.env.BRAVE_API_KEY ? "Brave" : "DuckDuckGo"})`));

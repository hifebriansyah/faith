// Local web UI for the islam-gpt.org chat: serves index.html and POST /api/chat, which asks the question and relays the
// answer stream to the browser as SSE (so the browser needs no CORS and the deviceId stays on the server).
//   node server.js        then open http://localhost:3000   (PORT=... to change)
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { ask, stream } from "./src/islam.js";

const PORT = Number(process.env.PORT ?? 3000);
const INDEX = await readFile(new URL("index.html", import.meta.url));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(INDEX);
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/chat" || url.pathname === "/api/chat.php")) {
    let body = "";
    for await (const c of req) body += c;
    let question;
    try {
      question = String(JSON.parse(body).question ?? "").trim();
    } catch {}
    if (!question) {
      res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"question is required"}');
      return;
    }
    const ctrl = new AbortController();
    res.on("close", () => ctrl.abort()); // the browser went away: stop reading the upstream stream
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    try {
      const shareId = await ask(question, { signal: ctrl.signal });
      for await (const ev of stream(shareId, { signal: ctrl.signal })) send(ev);
    } catch (e) {
      if (!ctrl.signal.aborted) send({ type: "error", message: e.message });
    }
    res.end();
    return;
  }
  res.writeHead(404).end("not found");
});

server.listen(PORT, () => console.log(`islam chat: http://localhost:${PORT}`));

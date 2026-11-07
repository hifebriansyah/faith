import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { answerChat, islamPatient } from "../src/answer.js";
import { agentChat } from "../src/agent.js";

/** A stand-in for islam-gpt.org: POST /api/questions gives a shareId; GET /api/stream/<id> does what `mode` says. */
function fakeIslam(mode) {
  const server = createServer((req, res) => {
    if (req.method === "POST") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ shareId: "abc123" })); return; }
    res.setHeader("Content-Type", "text/event-stream");
    if (mode === "silent") { res.write(""); return; } // headers are sent, then nothing: the real service's failure
    if (mode === "stalls") { res.write('data: {"type":"chunk","text":"Iman adalah"}\n\n'); return; } // an answer that stops in the middle
    if (mode === "empty") { res.end('data: {"type":"references","data":[]}\n\ndata: {"type":"done"}\n\n'); return; }
    res.write('data: {"type":"references","data":[]}\n\n');
    setTimeout(() => res.end('data: {"type":"chunk","text":"Iman adalah keyakinan."}\n\ndata: {"type":"done"}\n\n'), 20);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => server.closeAllConnections() || server.close() })));
}

test("islamPatient: an answer that arrives is returned as it was; one that never starts, stops in the middle, or is empty throws", async () => {
  let s = await fakeIslam("ok");
  const ok = await islamPatient("Apa itu iman?", { baseUrl: s.baseUrl, deviceId: "d" });
  assert.equal(ok.text, "Iman adalah keyakinan.");
  s.close();
  s = await fakeIslam("silent");
  await assert.rejects(islamPatient("x", { baseUrl: s.baseUrl, firstByteMs: 80 }), /no answer in time/);
  s.close();
  s = await fakeIslam("stalls");
  await assert.rejects(islamPatient("x", { baseUrl: s.baseUrl, firstByteMs: 500, idleMs: 80 }), /no answer in time/);
  s.close();
  s = await fakeIslam("empty");
  await assert.rejects(islamPatient("x", { baseUrl: s.baseUrl }), /empty answer/);
  s.close();
});

test("answerChat: islam-gpt first; when it fails the same question goes to quran-gpt; a visitor who left is not an answer; both failing says both", async () => {
  const asked = [];
  const islamOk = async (q) => { asked.push("islam"); return { text: "dari islam", references: [] }; };
  const islamDown = async () => { asked.push("islam"); throw new Error("islam-gpt: no answer in time"); };
  const quranOk = async (q) => { asked.push("quran:" + q); return { text: "dari quran", references: [] }; };
  const quranDown = async () => { throw new Error("quran-gpt: HTTP 502"); };

  let r = await answerChat("Apa itu iman?", { islam: islamOk, quran: quranOk });
  assert.equal(r.text, "dari islam"); assert.deepEqual(asked.splice(0), ["islam"], "quran is not asked when islam answers");

  r = await answerChat("Apa itu iman?", { islam: islamDown, quran: quranOk });
  assert.equal(r.text, "dari quran"); assert.equal(r.via, "quran-gpt"); assert.match(r.fellBackFrom, /no answer in time/);
  assert.deepEqual(asked.splice(0), ["islam", "quran:Apa itu iman?"]);

  const gone = new AbortController(); gone.abort();
  await assert.rejects(answerChat("x", { signal: gone.signal, islam: async () => { throw new Error("aborted"); }, quran: quranOk }), /aborted/);
  assert.deepEqual(asked.splice(0), [], "nobody is asked for a visitor who left");

  await assert.rejects(answerChat("x", { islam: islamDown, quran: quranDown }), /islam-gpt: no answer in time; quran-gpt: HTTP 502/);
});

test("the agent uses it by default: a dead islam-gpt still gives the visitor a reply (and the tool loop works on the fallback's text)", async () => {
  const chunks = [];
  const res = await agentChat("Apa itu iman?", {
    onChunk: (t) => chunks.push(t),
    chatFn: (q, o) => answerChat(q, { ...o, islam: async () => { throw new Error("islam-gpt: no answer in time"); }, quran: async () => ({ text: "Iman adalah keyakinan.", references: [] }) }),
  });
  assert.equal(res.text, "Iman adalah keyakinan.");
  assert.deepEqual(chunks, ["Iman adalah keyakinan."]);
});

import { readFileSync } from "node:fs";
import { parseAgentBody, runAgent } from "../src/serve.js";

test("the request says which source the visitor chose; quran-gpt asks only quran-gpt, the default asks islam-gpt first", async () => {
  assert.equal(parseAgentBody(JSON.stringify({ question: "x" })).provider, "islam");
  assert.equal(parseAgentBody(JSON.stringify({ question: "x", provider: "quran" })).provider, "quran");
  assert.equal(parseAgentBody(JSON.stringify({ question: "x", provider: "bukan-sumber" })).provider, "islam", "anything else is the default");
  const events = [];
  const realFetch = globalThis.fetch, urls = [];
  globalThis.fetch = async (url, init) => { urls.push(String(url)); if (String(url).includes("quran-gpt")) return new Response(JSON.stringify({ response: "Jawaban dari quran." }), { status: 200 }); throw new Error("islam-gpt must not be asked"); };
  try {
    await runAgent(parseAgentBody(JSON.stringify({ question: "Apa itu iman?", provider: "quran" })), { send: (e) => events.push(e) });
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(urls, ["https://quran-gpt.netlify.app/api/gemini"]);
  assert.equal(events.find((e) => e.type === "chunk").text, "Jawaban dari quran.");
  assert.equal(events.at(-1).type, "done");
});

test("the page: a source menu, quran-gpt and the internet go through the Worker, and a silent islam-gpt is not waited for", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<select id="provider" class="provider"[^>]*><option value="islam">islam-gpt<\/option><option value="quran">quran-gpt<\/option><\/select>/);
  assert.match(html, /const useWorker = webOn \|\| provider === "quran"/);
  assert.match(html, /message: text\.trim\(\), provider \}\)/, "the Worker is told which source");
  assert.match(html, /localStorage\.setItem\("islam-chat:provider", provider\)/, "the choice is remembered");
  assert.match(html, /setTimeout\(\(\) => silence\.abort\(\), FIRST_BYTE_MS\)/);
  assert.match(html, /islam-gpt tidak menjawab\. Pilih quran-gpt di menu/, "the visitor is told what to do");
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// what tools/deploy_worker.py fills in
globalThis.__SKILLS__ = [{ name: "writing-md", description: "Write docs", triggers: ["catatan"], body: "SKILL BODY" }];
const worker = (await import("../worker/faith.js")).default;

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

const ORIGIN = "https://faith.situs.id";
const baseEnv = { ALLOWED_ORIGINS: `${ORIGIN},http://localhost`, TIMEZONE_OFFSET_MINUTES: "420", AXIOM_TOKEN: "t", AXIOM_DATASET: "faith.test", AXIOM_URL: "https://axiom.test" };

/** A fake internet: islam-gpt.org answers from `replies` in order, DuckDuckGo refuses, Wikipedia finds one page, Axiom records its lines. */
function fakeNet(replies) {
  const net = { logs: [], prompts: [] };
  const stream = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    if (url.endsWith("/api/questions")) {
      net.prompts.push(JSON.parse(init.body).question);
      const id = "share" + stream.size + "xxxxxxxx";
      stream.set(id, replies.shift());
      return Response.json({ shareId: id });
    }
    if (url.includes("/api/stream/")) {
      const text = stream.get(url.split("/").pop());
      const sse = [{ type: "references", data: [] }, { type: "chunk", text }, { type: "done" }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
      return new Response(sse, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.includes("duckduckgo.com")) return new Response("blocked", { status: 202 }); // the bot check
    if (url.includes("wikipedia.org/w/api.php")) return Response.json({ query: { search: [{ title: "Rukun Islam", snippet: "lima <span>rukun</span>" }] } });
    if (url.startsWith("https://axiom.test/")) { net.logs.push(...JSON.parse(init.body)); return new Response("{}"); }
    throw new Error("unexpected fetch " + url);
  };
  return net;
}

async function call(body, { env = baseEnv, origin = ORIGIN, method = "POST", path = "/agent" } = {}) {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  const res = await worker.fetch(new Request("https://faith-worker.test" + path, { method, headers: { Origin: origin, "CF-Connecting-IP": "1.2.3.4" }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }), env, ctx);
  const text = await res.text();
  await Promise.all(pending);
  return { res, text, events: text.startsWith("data:") ? text.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.slice(6))) : [] };
}

test("worker: runs a tool through the keyless search fallback and streams the events, logging one line", async () => {
  const net = fakeNet(['TOOL: {"name":"web_search","args":{"query":"rukun islam"}}', "Ada lima rukun."]);
  const { res, events } = await call({ question: "User's first message: apa rukun islam?", message: "apa rukun islam?", persona: "You are Fira, a friend." });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.deepEqual(events.map((e) => e.type + (e.phase ? ":" + e.phase : "")), ["tool:start", "tool:end", "chunk", "references", "done"]);
  assert.equal(events.find((e) => e.type === "chunk").text, "Ada lima rukun.");
  assert.match(net.prompts[1], /Rukun Islam/); // the Wikipedia result went back into the second prompt
  const line = net.logs.find((l) => l.kind === "agent");
  assert.deepEqual({ w: line.worker, a: line.agent, m: line.message, ip: line.ip, steps: line.steps, tools: line.tools }, { w: "faith", a: "Fira", m: "apa rukun islam?", ip: "1.2.3.4", steps: 1, tools: [{ name: "web_search", arg: "rukun islam", via: "wikipedia" }] });
  assert.equal(line.chars, 15);
  assert.ok(!JSON.stringify(line).includes("Ada lima rukun"), "the answer text is not logged");
});

test("worker: the bundled skill is preloaded by its trigger word, and a document event is sent", async () => {
  const net = fakeNet(['Siap!\n<document title="Catatan">\n# Catatan\nisi\n</document>']);
  const { events } = await call({ question: "buatkan catatan", message: "buatkan catatan singkat" });
  assert.match(net.prompts[0], /Skill "writing-md" applies[\s\S]*SKILL BODY/);
  assert.deepEqual(events.find((e) => e.type === "document"), { type: "document", title: "Catatan", markdown: "# Catatan\nisi" });
  assert.equal(events.find((e) => e.type === "chunk").text, "Siap!");
});

test("worker: refuses other origins, preflight follows the origin, unknown paths, bad bodies", async () => {
  fakeNet([]);
  assert.equal((await call({ question: "x" }, { origin: "https://evil.example" })).res.status, 403);
  assert.equal((await call(null, { method: "OPTIONS" })).res.status, 204);
  assert.equal((await call(null, { method: "OPTIONS", origin: "https://evil.example" })).res.status, 403);
  assert.equal((await call({ question: "x" }, { path: "/other" })).res.status, 404);
  assert.equal((await call("not json")).res.status, 400);
  assert.equal((await call({ question: "   " })).res.status, 400);
  assert.equal((await call({ question: "x".repeat(25_000) })).res.status, 413);
  assert.notEqual((await call({ question: "x" }, { origin: "http://localhost:8080" })).res.status, 403); // a localhost port is allowed
});

test("worker: the rate limits answer 429 before any work is done", async () => {
  const net = fakeNet([]);
  const deny = { limit: async () => ({ success: false }) }, allow = { limit: async () => ({ success: true }) };
  const one = await call({ question: "x" }, { env: { ...baseEnv, LIMITER: deny } });
  assert.equal(one.res.status, 429);
  assert.match(one.text, /too many questions/);
  const all = await call({ question: "x" }, { env: { ...baseEnv, LIMITER: allow, LIMITER_ALL: deny } });
  assert.equal(all.res.status, 429);
  assert.equal(net.prompts.length, 0);
  assert.ok(net.logs.some((l) => l.kind === "request" && l.status === 429));
});

test("worker: an islam-gpt failure becomes an error event, then done", async () => {
  globalThis.fetch = async (input) => (String(input?.url ?? input).startsWith("https://axiom") ? new Response("{}") : new Response("down", { status: 502 }));
  const { events } = await call({ question: "x" });
  assert.deepEqual(events.map((e) => e.type), ["error", "done"]);
  assert.match(events[0].message, /502/);
});

test("worker: loading the modules does no I/O, timers or random values (Workers refuse them in the global scope)", async () => {
  const { execFileSync } = await import("node:child_process");
  const url = new URL("../worker/faith.js", import.meta.url).href;
  const code = `
    globalThis.__SKILLS__ = [];
    const boom = (what) => () => { throw new Error(what + " called while loading"); };
    globalThis.fetch = boom("fetch"); globalThis.setTimeout = boom("setTimeout"); globalThis.setInterval = boom("setInterval");
    crypto.getRandomValues = boom("crypto.getRandomValues"); Math.random = boom("Math.random");
    const m = await import(${JSON.stringify(url)});
    if (typeof m.default.fetch !== "function") throw new Error("no fetch handler");`;
  execFileSync(process.execPath, ["--input-type=module", "-e", code], { stdio: "pipe" }); // throws with the message when a module does one of them
});

test("worker: a typical request uses little CPU on a cold start (the free plan kills a request at about 10 ms of CPU: it was 503 for ordinary messages)", async () => {
  const { execFileSync } = await import("node:child_process");
  const here = (p) => JSON.stringify(new URL(p, import.meta.url).href);
  const code = `
    import { loadSkills } from ${here("../src/skills-fs.js")};
    globalThis.__SKILLS__ = [...loadSkills().values()];
    const refs = JSON.stringify({ type: "references", data: Array.from({ length: 4 }, (_, i) => ({ source: "S" + i, content: "x".repeat(900) })) });
    const answer = "Test case adalah satu set kondisi, langkah, dan hasil yang diharapkan untuk memeriksa sebuah fitur. ".repeat(12);
    const sse = [refs, ...[...answer].map((c) => JSON.stringify({ type: "chunk", text: c })), '{"type":"done"}'].map((d) => "data: " + d).join("\\n\\n") + "\\n\\n";
    globalThis.fetch = async (u) => String(u).endsWith("/api/questions") ? Response.json({ shareId: "abcdefgh12345678" }) : new Response(sse);
    const worker = (await import(${here("../worker/faith.js")})).default;
    const persona = "You are Sinta, a QA engineer. ".repeat(80);
    const env = { ALLOWED_ORIGINS: "https://faith.situs.id", TIMEZONE_OFFSET_MINUTES: "420" };
    const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
    // Node loads its fetch, Request and Response code lazily on first use (about 11 ms); a Worker has them built in. Touch them before timing, so only our code is measured.
    new Request("https://w/"); new Response("x"); Response.json({}); new TransformStream(); new TextEncoder(); new AbortController(); AbortSignal.timeout(1); crypto.getRandomValues(new Uint8Array(4));
    const t = cpu();
    const pending = [];
    const res = await worker.fetch(new Request("https://w/agent", { method: "POST", headers: { Origin: "https://faith.situs.id" }, body: JSON.stringify({ deviceId: "x", question: "Halo, apa itu test case?", message: "Halo, apa itu test case?", persona }) }), env, { waitUntil: (p) => pending.push(p) });
    const text = await res.text(); await Promise.all(pending);
    console.log(JSON.stringify({ ms: cpu() - t, ok: text.includes('"type":"chunk"') && text.includes("Test case adalah") }));`;
  const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }));
  assert.ok(out.ok, "the request still produced the answer");
  assert.ok(out.ms < 8, `a cold request took ${out.ms.toFixed(1)} ms of CPU`);
});

test("worker: AXIOM_LOG=0 sends no log lines (and costs no subrequest); otherwise a line per question", async () => {
  const off = fakeNet(["Satu."]);
  await call({ question: "x" }, { env: { ...baseEnv, AXIOM_LOG: "0" } });
  await call({ question: "x" }, { env: { ...baseEnv, AXIOM_LOG: "0" }, origin: "https://evil.example" }); // refused requests are not logged either
  assert.equal(off.logs.length, 0);
  const on = fakeNet(["Dua."]);
  await call({ question: "x" });
  assert.ok(on.logs.some((l) => l.kind === "agent"));
});

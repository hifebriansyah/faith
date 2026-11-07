// Where an answer comes from. islam-gpt.org is the first choice; when it does not answer (it can accept a question and then send nothing at all,
// not even its references block) the same question goes to quran-gpt.netlify.app instead, so a visitor gets a reply rather than a spinner.
//   islam-gpt must send its first bytes within FIRST_BYTE_MS, and must not go quiet for longer than IDLE_MS in the middle of an answer.
//   Anything else (an error, an empty answer, those timeouts) falls back. A visitor who leaves (the request's signal) is not an error and does not fall back.
import { ask, BASE_URL, parseAnswerText } from "./islam.js";
import { quranChat } from "./quran.js";

export const FIRST_BYTE_MS = 15_000;
export const IDLE_MS = 30_000;

/** islam-gpt, read as it arrives so that silence can be noticed. Resolves to {shareId, text, references} like chatBuffered; throws when it goes quiet. */
export async function islamPatient(question, { references = false, signal, firstByteMs = FIRST_BYTE_MS, idleMs = IDLE_MS, ...opts } = {}) {
  const ac = new AbortController();
  const onAbort = () => ac.abort(signal.reason);
  if (signal) { if (signal.aborted) ac.abort(signal.reason); else signal.addEventListener("abort", onAbort, { once: true }); }
  let timer, quiet = false;
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { quiet = true; ac.abort(); }, ms); };
  try {
    arm(firstByteMs);
    const shareId = await ask(question, { ...opts, signal: ac.signal });
    const res = await fetch(`${opts.baseUrl ?? BASE_URL}/api/stream/${shareId}`, { headers: { Accept: "text/event-stream" }, signal: ac.signal });
    if (!res.ok) throw new Error(`GET /api/stream/${shareId}: HTTP ${res.status}`);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let body = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      body += dec.decode(value, { stream: true });
      arm(idleMs);
    }
    const answer = parseAnswerText(body, { references });
    if (!answer.text.trim()) throw new Error("islam-gpt: empty answer");
    return { shareId, ...answer };
  } catch (e) {
    if (quiet) throw new Error("islam-gpt: no answer in time");
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** The chat function of the agent: islam-gpt, then quran-gpt. opts.islam / opts.quran replace the two sources (tests). */
export async function answerChat(question, { islam = islamPatient, quran = quranChat, ...opts } = {}) {
  try {
    return await islam(question, opts);
  } catch (e) {
    if (opts.signal?.aborted) throw e; // the visitor left
    const first = String(e?.message ?? e);
    try {
      const res = await quran(question, { signal: opts.signal });
      return { ...res, via: "quran-gpt", fellBackFrom: first };
    } catch (e2) {
      throw new Error(`${first}; quran-gpt: ${String(e2?.message ?? e2).replace(/^quran-gpt:\s*/, "")}`);
    }
  }
}

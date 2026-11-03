// Web tools the agent loop (agent.js) can call: web_search, fetch_url and show_image.
// web_search uses Brave Search when BRAVE_API_KEY is set, else DuckDuckGo's HTML page (no key, but fragile).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const UA = "Mozilla/5.0 (compatible; faith-agent/0.1)";
const MAX_PAGE_CHARS = 3000;

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
const strip = (html) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Page HTML to plain text: scripts, styles and tags removed, whitespace collapsed. */
export function htmlToText(html) {
  return strip(html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " "));
}

/** DuckDuckGo result links are redirects (//duckduckgo.com/l/?uddg=<real url>); unwrap them. */
const unwrapDdg = (href) => {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    return u.searchParams.get("uddg") ?? u.href;
  } catch {
    return href;
  }
};

/** Parse DuckDuckGo's html.duckduckgo.com result page into [{title, url, snippet}]. */
export function parseDdg(html, limit = 5) {
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(html)) && out.length < limit; ) {
    out.push({ title: strip(m[2]), url: unwrapDdg(decode(m[1])), snippet: strip(m[3]) });
  }
  return out;
}

async function braveSearch(query, limit, signal) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY },
    signal,
  });
  if (!res.ok) throw new Error(`Brave search: HTTP ${res.status}`);
  const { web } = await res.json();
  return (web?.results ?? []).slice(0, limit).map((r) => ({ title: strip(r.title ?? ""), url: r.url, snippet: strip(r.description ?? "") }));
}

async function ddgSearch(query, limit, signal) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": UA }, signal });
  if (!res.ok) throw new Error(`DuckDuckGo search: HTTP ${res.status}`);
  return parseDdg(await res.text(), limit);
}

/** Search the web: [{title, url, snippet}]. */
export async function webSearch({ query }, { limit = 5, signal } = {}) {
  if (!query || typeof query !== "string") throw new Error("web_search needs a query string");
  return process.env.BRAVE_API_KEY ? braveSearch(query, limit, signal) : ddgSearch(query, limit, signal);
}

/**
 * Find one picture on Wikimedia Commons (free, no key, licensed) to show in the reply: {url, title, credit, page}.
 * This is a search for an existing photo, it does not generate anything.
 */
export async function showImage({ query }, { signal } = {}) {
  if (!query || typeof query !== "string") throw new Error("show_image needs a query string");
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=640`;
  const res = await fetch(api, { headers: { "User-Agent": UA }, signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Wikimedia Commons: HTTP ${res.status}`);
  const pages = Object.values((await res.json()).query?.pages ?? {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const i = p.imageinfo?.[0];
    if (!i || !/^image\/(jpeg|png|webp)$/.test(i.mime) || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(i.thumburl ?? "")) continue;
    const meta = i.extmetadata ?? {};
    const credit = [strip(meta.Artist?.value ?? ""), meta.LicenseShortName?.value].filter(Boolean).join(", ");
    return { url: i.thumburl, title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""), credit: credit.slice(0, 120), page: i.descriptionurl };
  }
  throw new Error(`no picture found for "${query}"`);
}

const isPrivate = (ip) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === "::1" || /^(fc|fd|fe80)/i.test(ip) || ip.startsWith("::ffff:");

/** The model picks the URL, so refuse anything that is not public http(s): no localhost, LAN, or metadata endpoints. */
export async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) URLs");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("private host");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.some((a) => isPrivate(a.address))) throw new Error("private address");
  return u;
}

/** Fetch a page and return its readable text, cut to MAX_PAGE_CHARS. */
export async function fetchUrl({ url }, { signal } = {}) {
  let u = await assertPublicUrl(url);
  let res;
  for (let hops = 0; hops < 4; hops++) {
    res = await fetch(u, { headers: { "User-Agent": UA }, redirect: "manual", signal: signal ?? AbortSignal.timeout(15_000) });
    if (res.status < 300 || res.status >= 400) break;
    u = await assertPublicUrl(new URL(res.headers.get("location") ?? "", u)); // re-check every redirect hop
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/|json|xml/.test(type)) throw new Error(`not a text page (${type || "unknown type"})`);
  const body = (await res.text()).slice(0, 500_000);
  const text = /html/.test(type) ? htmlToText(body) : body;
  return { url: u.href, text: text.slice(0, MAX_PAGE_CHARS) };
}

export const TOOLS = {
  web_search: { run: webSearch, usage: '{"query": "search terms"}', does: "search the web, returns titles, URLs and snippets" },
  show_image: { run: showImage, image: true, usage: '{"query": "what the picture shows, e.g. Kaaba Mecca"}', does: "show ONE real photo to the user inside your reply (shown automatically, do not paste its URL); use it only when a picture clearly helps, e.g. a place, object or person" },
  fetch_url: { run: fetchUrl, usage: '{"url": "https://..."}', does: "read the text of one web page" },
};

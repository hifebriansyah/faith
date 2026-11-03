# faith

Chat with the [islam-gpt.org](https://www.islam-gpt.org) API from the terminal.

1. `POST /api/questions` with `{ deviceId, question }` returns `{ "shareId": "..." }`.
2. `GET /api/stream/<shareId>` streams the answer as SSE: `references` (sources), many `chunk` (`text`), then `done`.

```bash
node bin/chat.js                    # interactive chat (/refs = sources, /exit = quit)
node bin/chat.js "apa itu puasa"    # one question
open index.html                 # web UI (WhatsApp-like, chat with 7 gurus and 7 friends; personas in personas/*.md): static, calls islam-gpt.org from the browser
npm test                            # unit tests + live tests against the API
npm run test:offline                # unit tests only
```

Env: `ISLAM_DEVICE_ID` (default: a random id per run), `ISLAM_BASE_URL`. The API has no chat history field, so the web UI puts the last turns inside each question (index.html, withHistory). The CLI sends each question on its own.

## Internet access (web tools)

islam-gpt.org has no tool calling, so `src/agent.js` runs a text loop: the model answers `TOOL: {"name":"web_search","args":{...}}`, we run it (`src/tools.js`: `web_search`, `fetch_url`, `show_image`) and ask again with the result inside (max 3 rounds).

```bash
node bin/chat.js --web "question"          # CLI (or /web inside the chat)
BRAVE_API_KEY=... node bin/proxy.js        # local proxy on 127.0.0.1:8787 for the web UI; the globe button in the chat header turns it on
```

Search is Brave when `BRAVE_API_KEY` is set, else DuckDuckGo's HTML page (no key, fragile). The proxy only accepts localhost origins (`ALLOWED_ORIGINS` adds more). Needs Node 20+.

`show_image` finds one existing photo on Wikimedia Commons (free, no key, licensed) and shows it under the reply with its credit; the CLI prints `[image] title (credit) url`. It searches for a photo, it never generates one.

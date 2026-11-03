# islam

Chat with the [islam-gpt.org](https://www.islam-gpt.org) API from the terminal.

1. `POST /api/questions` with `{ deviceId, question }` returns `{ "shareId": "..." }`.
2. `GET /api/stream/<shareId>` streams the answer as SSE: `references` (sources), many `chunk` (`text`), then `done`.

```bash
node bin/chat.js                    # interactive chat (/refs = sources, /exit = quit)
node bin/chat.js "apa itu puasa"    # one question
open index.html                 # web UI (WhatsApp-like, chat with Fira or Lucy; personas in personas/*.md): static, calls islam-gpt.org from the browser
npm test                            # unit tests + live tests against the API
npm run test:offline                # unit tests only
```

Env: `ISLAM_DEVICE_ID` (default: a random id per run), `ISLAM_BASE_URL`. The API has no chat history field, so the web UI puts the last turns inside each question (index.html, withHistory). The CLI sends each question on its own.

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

islam-gpt.org has no tool calling, so `src/agent.js` runs a text loop: the model answers `TOOL: {"name":"web_search","args":{...}}`, we run it (`src/tools.js`: `web_search`, `fetch_url`, `show_image`) and ask again with the result inside (max 3 rounds). The globe button in the chat header turns it on.

The loop runs in a **Cloudflare Worker**, `worker/faith.js` at https://faith-worker.situs.id (the page's `WORKER` constant), so it also works on GitHub Pages and from `http://localhost`. It is deployed like `../guru`:

```bash
python3 tools/deploy_worker.py             # upload it (CLOUDFLARE_API_TOKEN/ACCOUNT_ID and AXIOM_TOKEN come from ../.env)
python3 tools/deploy_worker.py --dry-run   # build the upload and list it, sends nothing
node bin/chat.js --web "question"          # the same loop in the terminal (or /web inside the chat)
node bin/proxy.js                          # the same /agent on 127.0.0.1:8787, only to develop the Worker code; open the page once with ?proxy=http://127.0.0.1:8787 to use it (?proxy= goes back to the Worker)
```

- One copy of the logic: the Worker, `bin/proxy.js` and the CLI all run `src/`; the deploy follows the Worker's imports and uploads those files. Nothing in `src/` may do I/O, timers or random values while loading (Workers refuse that; a test checks it).
- **Search needs no key**: DuckDuckGo's HTML page (POST, then GET), then Wikipedia's search. `BRAVE_API_KEY` (paid) is optional: if it is set as a secret it goes first. Each result says which backend answered (`via`), and the log records it.
- Limits (worker/faith.jsonc): 6 questions a minute per IP address, 60 a minute for everybody; only `faith.situs.id` and localhost origins may call it.
- Request log in Axiom (dataset `faith.situs.id`, secret `AXIOM_TOKEN`): one line per question with who (IP, country, browser), which agent, the user's message, the tools used, steps, size and time. The answer text is not logged. The page tells the user (the globe's tooltip) that messages are logged.
- `npm test` also runs `test/worker.test.js`: the whole Worker in Node with a fake network.

`show_image` finds one existing photo on Wikimedia Commons (free, no key, licensed) and shows it under the reply; the CLI prints `[image] title (credit) url`. It searches for a photo, it never generates one.

Chat bubbles render Markdown like the document panel: `inline code`, fenced code blocks, lists, headings, quotes and tables (plain text with only inline marks keeps its line breaks). A message becomes one bubble per paragraph, except that blank lines inside a code fence do not split it and a list stays together; `test/bubbles.test.js` checks the splitting.

## Skills

`skills/<name>/SKILL.md` follows the Agent Skills format: frontmatter (`name`, `description`, optional `triggers:` comma list) then plain-markdown instructions. The prompt lists only name and description; the model reads a skill with the `load_skill` tool. If the user's message contains a trigger word, the skill is put in the prompt up front instead of waiting for the model to choose it. Skills are read on every request, so edits apply without restarting the proxy.

- `writing-md`: the AI writes a Markdown document inside `<document title="...">`; the web UI shows it in a panel on the right (copy, download .md, close), with a card in the chat to reopen it. The CLI prints it after the answer. Needs the globe on (the Worker).
- Persona files say "plain text, no lists" (WhatsApp style); the skill's output format overrides that for the document only.

## Avatars

Each agent (guru or friend) has a picture, `personas/<name>.jpg`, shown round in the chat list and header (a missing file falls back to the first letter). Make new ones small and square with the tool; it keeps your originals in `personas/originals/` (git-ignored) and can be re-run with another size:

```bash
python3 tools/make_image.py personas/*.jpg              # 256x256 JPEG, in place
python3 tools/make_image.py personas/maria.jpg --size 128 --quality 75
```

Needs `pip install pillow`. Options: `--size`, `--quality`, `--focus` (where a crop sits, 0 top to 1 bottom), `--format jpg|webp`, `--out DIR`, `--no-backup`.

## Logo and app icons

`logo.svg` is the logo (a circuit line that forms an F, with two amber dots). `python3 tools/make_icons.py` (needs Pillow) draws it as `logo.png` (1024) and writes the icons in `icons/` (app icon 192 and 512, a maskable one inside the safe zone, the iOS apple-touch-icon, the 48 px favicon), `favicon.ico` and `og-image.png`. All of them have a transparent background. `manifest.webmanifest` and the `<head>` of `index.html` use them, so the page can be installed as an app (Chrome: install; iPhone: Add to Home Screen). Change the colours in `logo.svg` and in `tools/make_icons.py` together, then run the script.

**Cache busting:** browsers keep favicons for a very long time, so every icon address carries `?v=<hash of the file>`. `tools/stamp_icons.py` (standard library only) sets it: `make_icons.py` runs it on the repo files, and the Pages workflow runs it on the published copy on every deploy, so a changed icon always gets a new address even if nobody reran the script. The hash is from the file's content, so unchanged icons stay cached. A test fails when the repo's pages hold a stale hash.

## Share image

`og-image.png` (1200x630) is the picture shown when the address is shared. `tools/make_icons.py` draws it (the logo and the tagline on the dark page colour); the Open Graph and Twitter tags in `index.html` point at it with an absolute address (`https://faith.situs.id/og-image.png?v=<hash>`, stamped like the icons, so a changed picture is fetched again by chat apps and crawlers). The tagline is the same everywhere (description, share tags, manifest, the picture, `TAGLINE` in `make_icons.py`) and a test fails if one of them drifts. After a deploy, the preview can be checked with a link-preview tool (for example Facebook's Sharing Debugger or LinkedIn's Post Inspector); those caches are theirs, and the `?v=` is what makes them refetch.

## Palette

The colours of the page come from the logo: its three ambers (`#f59e0b` the line, `#fbbf24` and `#d97706` the dots) on warm stone greys. They are CSS variables at the top of `index.html`, a light set and a dark set (it follows the system setting):

| | light | dark |
|---|---|---|
| page / sidebar / headers | `#e7e2da` / `#ffffff` / `#f7f3ec` | `#0c0a09` / `#1c1917` / `#292524` |
| text / muted text | `#1c1917` / `#655e58` | `#fafaf9` / `#a8a29e` |
| `--accent` (buttons) with `--on-accent` text | `#f59e0b` with `#1c1917` | the same |
| `--ink` (icons) / `--link` | `#b45309` / `#92400e` | `#fbbf24` / `#fbbf24` |
| my bubble / their bubble / chat background | `#fadf8f` / `#ffffff` / `#f6efe3` | `#512409` / `#292524` / `#14110f` |

The pairs were checked for WCAG contrast (text 4.5:1 or more on every surface and bubble, on-accent 8:1). The same colours are in `manifest.webmanifest` and the `theme-color` tags. Use the variables, not hex values, in new CSS.

**Light / dark:** the page follows the system setting. The sun / moon button in the header (next to "Chat") switches it by hand, and the choice is remembered in `localStorage` (`islam-chat:theme`). A small script in `<head>` applies a saved choice before the first paint, so there is no flash of the other theme; `data-theme="light"|"dark"` on `<html>` is what the CSS reads, and the browser's address-bar colour follows. The dark colours are written twice in the CSS (once for the system setting, once for a chosen dark theme): `test/theme.test.js` fails if the two copies differ.


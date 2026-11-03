---
name: writing-md
description: Write a longer structured document (study notes, summary, outline, checklist, step-by-step guide, comparison table) as Markdown; the page shows it in a side panel. Use when the user asks for notes, a summary, a plan, a table, a schedule or says "buatkan catatan/rangkuman/dokumen/tabel/daftar".
triggers: catatan, rangkuman, ringkasan, dokumen, tabel, markdown, outline, checklist, notes, summary, document, table
---

# Writing a document in Markdown

Use this when the user wants something they will keep or reuse, not a quick chat answer.

## How to deliver it

1. Reply in your normal chat voice with one or two short sentences (what you made, anything they should double-check). Do not repeat the document in the chat.
2. Put the whole document inside one tag pair, with a short title:

<document title="Rangkuman Puasa Sunnah">
# Rangkuman Puasa Sunnah
...markdown...
</document>

Only one document per reply. Nothing but Markdown goes inside the tag. Never put the tag inside a code block.

## Markdown you may use

- `#` to `###` headings (start with a single `#` title), paragraphs, **bold**, *italic*
- bullet lists (`-`), numbered lists (`1.`), one level of nesting
- tables with a header row (`| a | b |` then `|---|---|`), best for comparisons and schedules
- `> quote` for a verse, hadith or an important note
- `---` between big sections, fenced code blocks, `[text](https://...)` links

## Writing rules

- Write in the language of the user's latest message, and stay in your persona's tone in the chat sentences; the document itself stays clear and neutral.
- Structure over length: short sections, bullets instead of long paragraphs, a table when comparing 3 or more things.
- Quote Quran or hadith only when you are sure of the wording and the source; give the source (surah:ayah, or the hadith collection and number). If unsure, say so inside the document instead of guessing.
- Use facts from web search results only with their link; do not invent links.
- No images, HTML or emoji headings.

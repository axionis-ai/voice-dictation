# Changelog

All notable changes to Axionis Voice, newest first.

## 0.9.1
- **Fix:** clicking the status icon no longer opened settings (regression from 0.9.0 — `-webkit-app-region: drag` was also swallowing normal clicks on the same element). Dragging is now built manually via mousedown/mousemove/mouseup.
- Status icon reduced in size by 25%.
- Window inner padding reduced from 36px to 16px (the gap left when dragging to the screen edge).

## 0.9.0
- Status icon can now be freely dragged to a new position; the position is remembered. New "Reset position" button in settings.

## 0.8.0
- Maximum recording duration is now configurable (1–120 minutes, default 30 min) — previously a fixed 60 seconds.

## 0.7.0
- Glossary field for proper nouns/technical terms that ElevenLabs Scribe should recognize with a preferred spelling (via the `keyterms` parameter) — e.g. correct spelling of product names.

## 0.6.2
- Enlarged the soundwave bars inside the recording pill.

## 0.6.1
- Shrunk the recording pill; the processing light-ring now hugs the circle's edge directly.

## 0.6.0
- Reworked the soundwave visualization shown while recording (denser, symmetric, logo hidden during recording). The processing ring now rotates outside the circle (same "beam" technique used on the website). Bugfix: fixed a visible rectangle artifact caused by `filter: drop-shadow`.

## 0.5.0
- Hover tooltip on the status icon (later removed again in 0.9.1), visual polish, on/off toggle for the status icon.

## 0.4.0
- New, always-visible status icon in the bottom-right corner (shows recording/processing/error live), clicking it opens settings.

## 0.3.0
- Configurable hotkey (instead of fixed Win+Y), configurable pause-before-auto-stop, ElevenLabs affiliate link. Bugfix: the dev build and the installed build were using different config folders.

## 0.2.0
- First public release: settings window for your own API keys (replaces `.env`), Windows installer (NSIS) instead of a portable .exe, Axionis branding (bolt logo, website colors), Windows-encrypted key storage.

## 0.1.x (internal, pre-release)
- Original personal tool: Win+Y → ElevenLabs Scribe (batch) → Groq polish → paste.
- Critical finding and fix: the polishing AI would sometimes answer dictated text that sounded like a request (e.g. "write me a summary of...") instead of just cleaning it up — fixed with a `<dictation>`-style delimiter plus an anti-hijack instruction in the prompt, and a length-plausibility check as a safety net.

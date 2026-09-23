# Architecture — Axionis Dictate

Internal technical documentation. For usage instructions, see [README.md](../README.md).

## Overview

Axionis Dictate is an Electron tray app for Windows (no backend, no server, no Axionis-owned
infrastructure involved beyond the NSIS installer for distribution). It runs entirely locally and
only talks to two external APIs: ElevenLabs (speech-to-text) and, optionally, Groq (LLM text
polishing).

```
Win+Y ──▶ recorder-renderer.js (mic + VAD)
              │  (stops on: silence detected, OR hotkey, OR max duration reached)
              ▼
         main.js: recorder:recording (audio buffer)
              │
              ▼
         scribe.js ──▶ ElevenLabs /v1/speech-to-text (+ keyterms from the glossary)
              │
              ▼
         clean.js (rule-based, free: filler words, repeated words)
              │
              ▼ (only if AI polish is enabled)
         polish.js ──▶ Groq /chat/completions (optional)
              │
              ▼
         voiceCommands.js (voice commands → punctuation: "comma" → ",", ...)
              │
              ▼
         inserter.js (back up clipboard → paste → restore clipboard)
```

## Processes / windows

Electron separates the main process (main.js) from renderer processes (BrowserWindows). This app
has four BrowserWindows, all using `nodeIntegration: true, contextIsolation: false` (no preload
script needed — kept deliberately simple, since only local, self-authored code is ever loaded,
never remote/third-party content):

| Window | Purpose | Visible? |
|---|---|---|
| `recorder.html` + `recorder-renderer.js` | `getUserMedia`/`MediaRecorder`, voice-activity detection (VAD), start/stop beep | never (1×1px, hidden) |
| `settings.html` + `settings-renderer.js` | settings mask | on demand (tray menu, status-icon click, first run without a key) |
| `widget.html` + `widget-renderer.js` | always-visible status icon in the bottom-right corner | always (can be disabled) |
| Tray (`Tray` API, not a BrowserWindow) | context menu, tooltip with status | always |

## State machine (main.js)

`state` ∈ `idle | recording | transcribing | polishing | error`, held centrally in `main.js`.
`setStatus()` is the single place that changes `state` — it automatically updates the tray tooltip
(`updateTray()`) and the status icon (`notifyWidget()`) on every change. Exception: entering
"lock mode" (caps-lock-style recording, triggered by double-tapping Win+Y) happens outside
`setStatus()` and therefore calls `updateTray()`/`notifyWidget()` explicitly itself.

`lockMode` (bool): true = silence-based auto-stop is disabled, recording continues until the next
hotkey press or until `maxRecordMs` is reached (the same value applies in both normal and lock
mode).

## Configuration (`settings.js`)

The single source of truth for user settings. Storage location: `app.getPath('userData')/config.json`
(Windows: `%AppData%\Axionis Dictate\config.json`). Important: `app.setName('Axionis Dictate')` is set
explicitly in main.js, because Electron uses the `name` field from package.json for the userData
path in **dev mode** (`electron .`), but `productName` in the **packaged** app — without that
`setName()` call, the dev build and the installed build would read/write to two different folders
(see [LESSONS-LEARNED.md](LESSONS-LEARNED.md)).

Secrets (ElevenLabs/Groq keys) are never stored in plain text: `safeStorage.encryptString()`
(Windows DPAPI, tied to the respective Windows account) before writing, `decryptString()` when
reading. The settings mask's renderer only ever receives booleans (`hasElevenLabsKey`, etc.) when
loading — never the plaintext key.

All fields: `elevenLabsKey`, `llmPolishEnabled`, `llmApiKey`, `llmBaseUrl`, `llmModel`, `silenceMs`,
`hotkey`, `showWidget`, `glossary` (array), `maxRecordMs`, `widgetX`/`widgetY` (position, `null` =
default bottom-right).

## Status icon / widget (`widget.html`, `widget-renderer.js`)

Its own always-visible `BrowserWindow` (frameless, transparent, `alwaysOnTop`, `skipTaskbar`).
Design decisions, with reasoning:

- **Freely draggable, but no `-webkit-app-region: drag`**: this attribute made normal click events
  on the same element unreliable in practice (see Lessons Learned). Dragging is therefore built
  manually: `mousedown` records the starting position (window + mouse via `screenX/screenY`),
  `mousemove` computes the delta and sends the new window position via IPC (`widget:drag-to`),
  `mouseup` only fires `widget:open-settings` if the movement stayed under a threshold (4px) —
  otherwise it was a drag, not a click.
- **Position persistence**: `widgetWin.on('moved', ...)` saves (debounced, 400ms) the new position
  to `settings.js`. The first 1.5s after the window is created are ignored, because Windows itself
  often fires a `moved` event right when the window is created (position/DPI finalization), which
  would otherwise get saved as if the user had dragged it.
- **No `filter: drop-shadow`**: renders as a visible rectangle instead of a soft glow inside a
  `transparent: true` window. All glow effects go through `box-shadow` or the mask-based "beam"
  technique (conic-gradient + `mask-composite: exclude`), identical to the light effects on
  axionisconsulting.com (`css/effects.css`, `.beam` class).
- **Generous CSS padding** (16px) around the visible content: needed so `box-shadow` doesn't get
  hard-clipped at the window edge (`overflow: hidden`) — a trade-off, since this padding also means
  the pill can never be dragged all the way flush against the screen edge.

## Security / prompt hardening (`polish.js`)

The dictated text is never sent to the polishing model as a bare user turn. Reason: a chat model
will otherwise interpret text that sounds like a request ("write me...", "list... for me") as an
instruction and answer it, instead of just cleaning it up — reproducibly verified (see CHANGELOG
0.1.x). Countermeasures (both together, not just one):

1. **Prompt hardening**: the text sits between `<dictation>` tags, the system prompt explicitly
   states that any questions/commands inside must never be carried out.
2. **Length-plausibility check** (defense in depth, `MAX_GROWTH_RATIO = 1.6`): if the response is
   drastically longer than the input, it's discarded and `main.js` automatically falls back to the
   rule-based cleaned text (the same mechanism used for an API timeout/error).

## ElevenLabs glossary (`scribe.js`)

The `keyterms` parameter of the Scribe API (a list of terms to bias recognition towards).
**Not documented anywhere officially** (verified live against the endpoint): multiple terms must
be sent as a repeated `keyterms` multipart field (one per term), not as a JSON-array string in a
single field (that gets rejected as one single, overly long term with "invalid characters", since
`[`/`]` are on the list of forbidden characters). `buildMultipart()` therefore supports array
values specifically for this case (one field name → multiple form-data parts).

## Build/Distribution

`electron-builder` with the NSIS target (`npm run dist`), icon rendered by hand
(`tools/make-icon.js`, pixel-by-pixel with no external image library — the bolt polygon is derived
from the real website SVG path, see the comments in that file). No code signing (paid certificate)
— the SmartScreen warning on first launch is expected behavior for unsigned freeware.

Release process: `npm run dist` → `gh release create vX.Y.Z <exe>`. The landing page
(axionisconsulting.com/voice/) links to `.../releases/latest`, never a fixed filename — it stays
current automatically with every release, without needing to touch the page.

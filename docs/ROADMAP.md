# Roadmap — Next Steps

Ideas for further development, meant to be picked up in a fresh session. Each item is scoped
enough to start directly; no further discovery should be needed before writing code.

## 1. Auto-update (electron-updater)

Right now every new version requires manually downloading and rerunning the installer. Add
`electron-updater` + a GitHub Releases provider (`electron-builder.yml` → `publish: { provider:
github, owner: axionis-ai, repo: voice-dictation }`) and check on startup.

**Agreed UX (decided 2026-09-23) — quiet, never blocking:**

1. Check silently on startup. If there's nothing new, the user never notices anything.
2. If an update exists, show a **brief, self-dismissing notice** ("Update available") — it appears,
   it goes away on its own, it never steals focus or interrupts dictation.
3. The durable affordance lives in the **tray menu**: an entry like "Update to v0.11.0 — install
   now". That stays until it's used, so a missed notice costs nothing.
4. Installing is always an explicit click. Never install silently underneath the user.

**Blocked on item 5 (code signing):** every update is an unsigned .exe. Before shipping this to
customers, verify what Windows actually does when electron-updater launches the downloaded
installer — an update that surprises a customer with an "Unknown publisher" warning costs more
trust than it gains. Test this first, don't assume either outcome.

## 2. Realtime/streaming transcription

Currently batch: record fully, then send the whole audio file to `/v1/speech-to-text` once
recording stops. ElevenLabs also offers a WebSocket streaming endpoint. Would remove the ~1–2s
post-recording latency (transcription would already be done, or nearly done, by the time the user
stops talking). Bigger architectural change than it looks — `scribe.js` would need a persistent
WebSocket connection instead of one-shot HTTP calls, and the VAD/silence-detection logic in
`recorder-renderer.js` would need to feed audio chunks incrementally instead of one final blob.
Worth a spike first to confirm the streaming endpoint's real latency/accuracy trade-off before
committing to the rewrite.

## 3. Usage/cost visibility

ElevenLabs and Groq are both metered APIs; the user currently has no visibility into consumption
from inside the app. Add a small "Usage this month" section to `settings.html` — ElevenLabs
exposes a `/v1/user` subscription-usage endpoint; Groq doesn't have a usage API, so that side would
need local estimation (track request count / rough token counts in `config.json`).

## 4. Custom polish tone/style

The polish prompt is fixed at "clean up, don't rewrite". Some users may want a lighter touch
(minimal cleanup) or a stronger one (formalize). Add a "Polish style" dropdown in settings (e.g.
Minimal / Standard / Formal) that swaps in a different system-prompt variant, keeping the
`<dictation>` delimiter + anti-hijack instructions and the `MAX_GROWTH_RATIO` safety check
unchanged in all variants — those exist for security, not style.

The language half of this item is **done as of 0.10.0**: the prompt is no longer German-only, it
follows the language Scribe detected and never translates.

## 5. Code signing

Removes the "Unknown publisher" SmartScreen warning on first install, and is close to a
prerequisite for silent/seamless auto-updates (item 1). Requires purchasing a code-signing
certificate (EV or OV) — a cost/business decision, not a technical one. Flag to the user before
starting.

## 6. Android

Originally requested at project start, not pursued yet. Would be a separate app, not a port —
Electron doesn't target Android. Realistically a new React Native / Kotlin project reusing only
the API-integration logic (ElevenLabs + Groq calls), sharing no UI code with the desktop app. Scope
this as its own brainstorming/design session rather than a roadmap line item — it's a new product,
not an increment.

## Explicitly considered and deferred

- **Language-selection dropdown**: not needed. Scribe auto-detects the spoken language and, since
  0.10.0, the app no longer sends a language hint at all — a manual picker would only add a setting
  nobody needs to touch. Worth revisiting only if auto-detection turns out to misfire on a specific
  language pair in practice.

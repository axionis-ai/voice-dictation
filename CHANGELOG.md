# Changelog

All notable changes to Axionis Dictate, newest first.

## 0.14.0
- **Renamed from "Axionis Voice" to "Axionis Dictate".** *Axionis Voice* is the name of the product line covering everything speech-related — voice agents and phone agents are planned under it — so the dictation tool needed its own name rather than occupying the umbrella.
- Your settings carry over automatically. The rename moves the config folder (Electron derives it from the product name), so on first start the app picks up the previous folder's config — API keys, hotkey, glossary and the saved-time counter all survive.
- Entries below this line still describe the same tool under its old name.

## 0.13.0
- **Automatic update check.** The app now checks GitHub for a newer version shortly after starting (and every 6 hours, since it often runs for days via autostart). A new version downloads quietly in the background; once it's ready, a brief Windows notification says so and the tray menu gains an entry **"Update auf vX.Y.Z — jetzt installieren"**.
- Nothing installs without your click, and nothing is installed silently on quit. A failed check (no connection, GitHub unreachable) is ignored — it must never interrupt dictation.
- Note: this only works **from this version onward**. An older installation cannot know about updates, because the checking code is what's new here.

## 0.12.0
- **Guided first run.** On the very first start (no key stored yet), the settings window now opens with a clear notice that the tool cannot do anything without an ElevenLabs key, plus a 4-step walkthrough of exactly where to get one — sign up, profile picture → API Keys → "Create API Key", paste, save. It disappears once a key is stored.
- The Groq hint now names the exact click path too, instead of just linking to the site.
- Website: the setup section now explains where both keys come from, and that they stay encrypted on your own machine.

## 0.11.0
- **Typing time saved** is now shown in the settings window: how many dictations and characters you've recorded, and how much typing that spared you. Counted **honestly** — the time you spent speaking is subtracted from the time typing would have taken (assuming 200 keystrokes/minute, stated in the app so the number can be judged).
- The counters live only in your local config file. No telemetry, nothing is transmitted, we cannot see them.

## 0.10.1
- Settings window now has a footer: what data goes where (in short), a link to the full privacy page, the website, and the running version number.
- **Privacy page** at [axionisconsulting.com/voice/datenschutz](https://axionisconsulting.com/voice/datenschutz): exactly which data reaches ElevenLabs and Groq, their retention/training/location terms with sources, and what Axionis receives (nothing — there is no Axionis server involved).
- Settings window is now resizable and no longer asks for more height than the screen actually offers.

## 0.10.0
- **Real language auto-detection.** The app previously always sent `language_code=de` to ElevenLabs. Since that parameter is only a hint, other languages were still recognized — but the German bias is now gone entirely: the parameter is no longer sent at all, so Scribe detects the spoken language on its own.
- **AI polish now follows the spoken language.** The polish prompt used to assume German, so dictating in English or Spanish got German grammar rules applied to foreign-language text. The language detected by Scribe is now passed to the polish step, which cleans up the text in that language and never translates. Verified live in German, English and Spanish — including that the anti-hijack protection still holds in each.
- **Status icon expands symmetrically.** When recording starts, the circle now grows into the pill in both directions instead of only to the left.
- **The soundwave reacts to your actual voice.** The bars used to be a fixed animation; they now scale with the live microphone level measured during recording.
- **Softer state transitions.** Bolt and soundwave cross-fade into each other, and the processing ring fades in instead of popping.
- **Visible confirmation after insertion.** A short ember pulse confirms the text was inserted, instead of the icon silently snapping back to idle.

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

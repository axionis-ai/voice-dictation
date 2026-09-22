# ⚡ Axionis Voice

Free Windows dictation tool. Press `Win+Y` once to start recording, press it again to stop —
the audio gets transcribed and the text is pasted directly into whatever window is currently
focused (editor, browser, Word, chat — anywhere with a text field).

Built and given away for free by [Axionis Consulting](https://axionisconsulting.com).

## Installation

1. Download the latest `Axionis Voice Setup.exe` from [Releases](../../releases).
2. Run the installer. Windows SmartScreen may warn ("Unknown publisher") on first launch — that's normal for free, unsigned software. Click **"More info"** → **"Run anyway"**.
3. On the very first start, a settings window opens automatically.

## Setup (one-time)

The tool uses [ElevenLabs Scribe](https://elevenlabs.io) for speech recognition — you'll need your **own, free** ElevenLabs account:

1. Sign up via [try.elevenlabs.io](https://try.elevenlabs.io/2igpd7r1n610) (the free tier is enough to try it out — this is an Axionis Consulting affiliate link, it costs you nothing extra).
2. Get your API key under *Settings → API Keys*.
3. Enter the key in the Axionis Voice settings window and save.

Optional: **AI polish** automatically improves grammar/punctuation — enter a free [Groq](https://console.groq.com/keys) key for that. Your keys are stored only locally and encrypted (Windows' own encryption, tied to your user account) on your machine — they never leave your device except directly to ElevenLabs/Groq.

Settings are accessible any time via the tray icon or the status icon in the bottom-right corner → **Settings...** — also configurable there:
- **Pause before auto-stop:** how long you're allowed to pause while dictating before the recording stops automatically (1–30 seconds).
- **Maximum recording duration:** a safety limit for the whole recording (1–120 minutes, default 30 min).
- **Hotkey:** set your own key combination instead of `Win+Y`.
- **Glossary:** proper nouns/technical terms that otherwise get misspelled (e.g. product names), comma-separated.
- **Status icon:** the small, freely movable icon in the bottom-right corner that shows the recording status live — can be turned off if you don't want it.

## Usage

1. Focus the target field (editor, chat, textarea, ...).
2. Press `Win+Y` once → tray shows `● REC`.
3. Speak.
4. Press `Win+Y` again → the text appears in the field ~1–2 s later.

Tray context menu → **Test-Paste** inserts a test string (checks clipboard+paste without an API call).

## Language

Axionis Voice works in any language ElevenLabs Scribe supports — just speak, no configuration
needed. The app doesn't lock recognition to one language: [ElevenLabs' `language_code` parameter
is only a hint, not an enforced setting](https://elevenlabs.io/docs/api-reference/speech-to-text/convert) —
without it, Scribe auto-detects the spoken language. Confirmed in practice speaking English and
Spanish. AI polish (if enabled) uses a German prompt, so grammar cleanup is currently tuned for
German text — the transcription itself is multilingual either way.

## Hotkey

- Default `Win+Y`, toggle mode (1st press starts, 2nd stops) — freely changeable in settings (must include at least one modifier key like Ctrl/Alt/Shift/Win).
- Caps-lock mode: tap the hotkey twice quickly → recording keeps running until you press it again (no automatic stop on silence).
- If the chosen combination is already taken by Windows: the tray shows an error, the previous hotkey stays active.

## How it works

- **Recording:** hidden Electron window with `getUserMedia` + `MediaRecorder`.
- **Speech recognition:** `POST https://api.elevenlabs.io/v1/speech-to-text` (ElevenLabs Scribe).
- **Cleanup:** rule-based (filler words, stutters) + optional AI polish (Groq).
- **Insertion:** back up the clipboard → write the text into it → simulate Ctrl+V → restore the previous clipboard content.

## Known limitations

- **Elevated (Run as administrator) windows:** text can't be pasted automatically into elevated target windows — it's left on the clipboard for a manual Ctrl+V instead.
- **Latency:** ~1–2 seconds after stopping the recording (cloud processing).
- Windows only, for now.

## Build it yourself

```bash
git clone https://github.com/axionis-ai/voice-dictation.git
cd voice-dictation
npm install
npm start          # development mode
npm run dist       # builds dist/Axionis Voice Setup *.exe
```

## More docs

- [CHANGELOG.md](CHANGELOG.md) — version history
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — technical design, decisions
- [docs/LESSONS-LEARNED.md](docs/LESSONS-LEARNED.md) — debugging insights from development
- [docs/ROADMAP.md](docs/ROADMAP.md) — ideas for further development

## License

MIT — see [LICENSE](LICENSE). Use, modify and redistribute it freely.

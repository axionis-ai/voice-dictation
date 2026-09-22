# ⚡ Axionis Voice

Kostenloses Windows-Diktat-Tool. `Win+Y` einmal → Aufnahme startet, nochmal `Win+Y` → stoppt, transkribiert und fügt den Text ins gerade fokussierte Fenster ein (Editor, Browser, Word, Chat — überall wo ein Textfeld ist).

Von [Axionis Consulting](https://axionisconsulting.com) gebaut und kostenlos zur Verfügung gestellt.

## Installation

1. Aktuelle `Axionis Voice Setup.exe` unter [Releases](../../releases) herunterladen.
2. Installer ausführen. Windows SmartScreen warnt beim ersten Start eventuell ("Nicht verifizierter Herausgeber") — das ist bei kostenloser, unsignierter Software normal. Auf **"Weitere Informationen"** → **"Trotzdem ausführen"** klicken.
3. Beim allerersten Start öffnet sich automatisch ein Einstellungsfenster.

## Einrichtung (einmalig)

Das Tool nutzt [ElevenLabs Scribe](https://elevenlabs.io) für die Spracherkennung — dafür brauchst du einen **eigenen, kostenlosen** ElevenLabs-Account:

1. Account anlegen auf [elevenlabs.io](https://elevenlabs.io) (kostenloses Kontingent reicht zum Testen).
2. API-Key holen unter *Settings → API Keys*.
3. Key ins Einstellungsfenster von Axionis Voice eintragen, speichern.

Optional: **KI-Politur** verbessert Grammatik/Zeichensetzung automatisch, dafür einen kostenlosen [Groq](https://console.groq.com/keys)-Key eintragen. Deine Keys werden ausschließlich lokal und verschlüsselt (Windows-eigene Verschlüsselung, an dein Nutzerkonto gebunden) auf deinem Rechner gespeichert — sie verlassen dein Gerät nie außer direkt an ElevenLabs/Groq.

Einstellungen jederzeit über das Tray-Icon → **Einstellungen...** änderbar.

## Benutzung

1. Fokus ins Zielfeld (Editor, Chat, Textarea, ...).
2. `Win+Y` einmal → Tray zeigt `● REC`.
3. Sprechen.
4. `Win+Y` nochmal → ~1–2 s später steht der Text im Feld.

Tray-Kontextmenü → **Test-Paste** fügt einen Testtext ein (prüft Clipboard+Paste ohne API-Aufruf).

## Hotkey

- `Win+Y`, Toggle-Modus (1× Start, 2× Stop).
- Feststelltaste: zweimal schnell `Win+Y` tippen → Aufnahme läuft, bis erneut `Win+Y` gedrückt wird (kein automatischer Stopp bei Stille).
- Falls `Win+Y` von Windows belegt ist: Tray zeigt einen Fehler.

## Wie es funktioniert

- **Aufnahme:** verstecktes Electron-Fenster mit `getUserMedia` + `MediaRecorder`.
- **Spracherkennung:** `POST https://api.elevenlabs.io/v1/speech-to-text` (ElevenLabs Scribe).
- **Bereinigung:** regelbasiert (Füllwörter, Stotterer) + optional KI-Politur (Groq).
- **Einfügen:** Zwischenablage sichern → Text hineinschreiben → Ctrl+V simulieren → alte Zwischenablage wiederherstellen.

## Bekannte Grenzen

- **Als-Administrator-Fenster:** Text lässt sich nicht automatisch in erhöhte (elevated) Fenster einfügen — er liegt dann in der Zwischenablage für manuelles Ctrl+V.
- **Latenz:** ~1–2 Sekunden nach Stopp der Aufnahme (Cloud-Verarbeitung).
- Aktuell nur Windows.

## Selbst bauen

```bash
git clone https://github.com/axionis-ai/voice-dictation.git
cd voice-dictation
npm install
npm start          # Entwicklungsmodus
npm run dist       # baut dist/Axionis Voice Setup *.exe
```

## Lizenz

MIT — siehe [LICENSE](LICENSE). Nutze, verändere und verteile es frei.

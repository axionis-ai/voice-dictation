# Changelog

Alle nennenswerten Änderungen an Axionis Voice, neueste zuerst.

## 0.9.1
- **Fix:** Klick auf das Status-Icon öffnete keine Einstellungen mehr (Regression aus 0.9.0 — `-webkit-app-region: drag` hatte auf demselben Element auch normale Klicks verschluckt). Ziehen jetzt manuell per mousedown/mousemove/mouseup gebaut.
- Status-Icon um 25 % verkleinert.
- Fenster-Innenpolster von 36px auf 16px reduziert (Lücke beim Ziehen an den Bildschirmrand).

## 0.9.0
- Status-Icon frei verschiebbar (per Ziehen), Position wird gespeichert. "Position zurücksetzen"-Button in den Einstellungen.

## 0.8.0
- Maximale Aufnahmedauer einstellbar (1–120 Minuten, Standard 30 min) — vorher fest 60 Sekunden.

## 0.7.0
- Glossar-Feld für Eigennamen/Fachbegriffe, die ElevenLabs Scribe per `keyterms`-Parameter bevorzugt erkennt (z. B. korrekte Schreibweise von Produktnamen).

## 0.6.2
- Soundwave-Balken in der Aufnahme-Pille vergrößert.

## 0.6.1
- Aufnahme-Pille verkleinert, Licht-Ring sitzt jetzt direkt am Rand der Kugel.

## 0.6.0
- Soundwave-Visualisierung während der Aufnahme überarbeitet (dichter, symmetrisch, Logo während der Aufnahme ausgeblendet). Verarbeitungs-Ring rotiert jetzt außerhalb der Kugel ("Beam"-Technik wie auf der Website). Bugfix: sichtbares Rechteck-Artefakt durch `filter: drop-shadow` behoben.

## 0.5.0
- Hover-Tooltip am Status-Icon (später in 0.9.1 wieder entfernt), optische Politur, Ein/Aus-Schalter für das Status-Icon.

## 0.4.0
- Neues, immer sichtbares Status-Icon unten rechts (zeigt Aufnahme/Verarbeitung/Fehler live), Klick öffnet Einstellungen.

## 0.3.0
- Einstellbarer Hotkey (statt fest Win+Y), einstellbare Pause bis Auto-Stopp, ElevenLabs-Affiliate-Link. Bugfix: Dev- und installierte Version nutzten unterschiedliche Config-Ordner.

## 0.2.0
- Erstes öffentliches Release: Einstellungsfenster für eigene API-Keys (ersetzt `.env`), Windows-Installer (NSIS) statt portabler .exe, Axionis-Branding (Blitz-Logo, Website-Farben), Windows-verschlüsselte Key-Speicherung.

## 0.1.x (intern, vor Veröffentlichung)
- Ursprüngliches persönliches Tool: Win+Y → ElevenLabs Scribe (Batch) → Groq-Politur → Einfügen.
- Kritischer Fund und Fix: Die Politur-KI hat diktierte Texte, die wie eine Anfrage klangen (z. B. "Schreibe mir eine Zusammenfassung..."), inhaltlich beantwortet statt sie nur zu bereinigen — mit `<diktat>`-Markierung + Anti-Hijack-Anweisung im Prompt sowie einer Längen-Plausibilitätsprüfung als Sicherheitsnetz behoben.

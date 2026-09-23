# Lessons Learned

Technical findings from development that will save time on the next Electron project (or on
further work on this one). Each of these caused a real, sometimes confusing debugging session in
practice — recorded here with root cause, not just the symptom.

## 1. OneDrive and `node_modules` don't mix well

A project folder that's live-synced by OneDrive ended up with a structurally corrupted
`node_modules` installation (individual packages were missing files, e.g. `fs-extra`'s
`copy-sync/index.js`) — most likely caused by write conflicts while OneDrive was syncing in
parallel. `npm install` alone does **not** reliably fix this, since npm won't re-download package
folders that already exist (even if incomplete). Fix: delete `node_modules` entirely, then
reinstall from scratch. Recommendation: develop Node projects outside live-synced folders where
possible, or exclude the folder from syncing.

## 2. `ELECTRON_RUN_AS_NODE=1` silently turns Electron into a plain Node process

When this environment variable is set (e.g. inherited from a parent dev tool/terminal),
`electron.exe` behaves like a regular Node.js binary: `require('electron')` then returns only a
path string instead of the real API — `app`, `BrowserWindow`, `Tray`, `safeStorage`, etc. are all
`undefined`, often without an obvious error at the point of failure. The symptom was initially
hard to distinguish from "Electron just isn't starting". Fix: `env -u ELECTRON_RUN_AS_NODE` before
every launch when using an automated shell/CI environment for real GUI testing.

**This applies to launching the *installed* app too, not just test runs.** It bit us a second time
(2026-09-23) when starting the freshly installed app for the user via `Start-Process` from an
automated shell: the variable was inherited, the app exited immediately, and the user was left
with no running tool at all. Test scripts had the guard; the "just start the app" call did not.
Strip the variable in *every* path that launches the binary — in PowerShell,
`Remove-Item Env:ELECTRON_RUN_AS_NODE` before `Start-Process`. A normal launch by the user from
the Start menu is never affected, which is exactly what makes this easy to misdiagnose as a
broken build.

## 3. `app.getName()` returns different values in dev vs. packaged builds

In dev mode (`electron .`), Electron uses the `name` field from `package.json` for the `userData`
path (`app.getPath('userData')`). In the app built with `electron-builder`, it uses `productName`
instead. Without a workaround, the dev build's and the installed build's config files end up in
two different folders — the tool appears to randomly "forget" saved settings depending on how it
was launched. Fix: call `app.setName(...)` explicitly and early in `main.js`, with the same value
as `productName`.

## 4. `filter: drop-shadow()` in a transparent Electron window can render as a visible rectangle

CSS `filter` effects (here: a glow on an SVG icon) occasionally rendered with a visible rectangular
edge instead of a soft gradient inside a `transparent: true` BrowserWindow — likely a GPU
compositing edge case specific to transparent windows. `box-shadow` and mask-based techniques
(`mask-composite`, conic-gradient) are not affected. Rule of thumb: avoid `filter` in transparent
windows altogether.

## 5. `-webkit-app-region: drag` and a click handler on the same element don't mix reliably

An element with `-webkit-app-region: drag` (the standard technique for making frameless windows
draggable) made normal `click` events on that same element unreliable in practice — after the
first drag attempt, a click would no longer register reliably. More robust replacement: build
dragging manually via `mousedown`/`mousemove`/`mouseup`, with a small movement threshold (4px here)
that decides whether a gesture was a click or a drag — no `-webkit-app-region` needed.

## 6. `webContents.sendInputEvent()` always reports `screenX`/`screenY` as 0

When testing the drag logic via synthetic mouse events (`sendInputEvent`), the resulting DOM
`MouseEvent`'s `screenX`/`screenY` stayed constantly `0`, regardless of the coordinates passed in.
Logic that depends on absolute screen coordinates (e.g. window dragging via deltas) **cannot** be
verified this way — that's a limitation of the testing tool, not evidence of a bug in real-world
behavior with actual mouse input. Consequence: verify such logic through code review plus a single
real human test, not through automated synthetic mouse-event tests.

## 7. CSS transitions/animations can stay frozen in a `show: false` window

In an invisible (`show: false`) `BrowserWindow`, a running `transition` (e.g. a width change) never
animated past its starting value — `getComputedStyle()` kept returning the initial value, even
though the matching CSS rule was verifiably correct (confirmed via `element.matches(selector)` and
`cssRules[i].cssText`). Likely cause: Chromium pauses the rendering/compositor pipeline for
invisible windows, so the transition never gets a second frame. Consequence: `getComputedStyle()`
of a transitioning property from a hidden test window is unreliable — check the underlying CSS
rule directly instead (selector match + rule text), not the animated value.

## 8. ElevenLabs Scribe `keyterms`: encoding undocumented, verified live

The API docs mention the `keyterms` parameter (a list of terms to improve recognition of) but no
example shows how to encode multiple terms in a `multipart/form-data` request. A JSON-array string
in one field (`["Bionix","Axionis"]`) gets rejected with `"Some keyword contains invalid
characters"`, because `[`/`]` are on the list of forbidden characters for keyterms. The correct
approach (confirmed live against the real API, including a synthesized-speech before/after
comparison): repeat the `keyterms` field, one term per form part.

## 9. Windows fires a `moved` event right when a window is created

Even without any user interaction, simply creating a `BrowserWindow` on Windows sometimes
immediately fires a `moved` event (likely position/DPI finalization by the window manager).
Without a safeguard, this gets incorrectly saved as "the user moved the window". Fix: ignore
`moved` events for the first 1–2 seconds after the window is created.

## 10. ElevenLabs `language_code` is a hint, and sending one costs you something

Scribe's `language_code` parameter is not an enforced setting — passing `de` and then speaking
English still yields correct English transcription, which makes a wrong value easy to miss for a
long time. It isn't free, though: it biases recognition, which matters most on short or ambiguous
utterances. If an app is meant to be multilingual, the right move is to omit the parameter
entirely rather than pass a "primary" language, because omitting it is what actually enables
detection instead of merely tolerating it.

## Process lesson: small screenshots lie

Sizes/shapes were misjudged from tiny (~150×80px) screenshots more than once (e.g. a correctly
44px-wide element was mistaken for "too wide"). When in doubt about dimensions/colors: query
`getComputedStyle()`/`matches()` directly instead of eyeballing a small image.

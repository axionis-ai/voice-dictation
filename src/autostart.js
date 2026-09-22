// autostart.js — Windows-Autostart via Electrons setLoginItemSettings (Registry Run-Key).
// Ersetzt die alte .vbs-basierte Loesung, die "npm start" aufrief und dadurch bei
// jedem installierten (nicht-Dev-)Nutzer ins Leere gelaufen waere.
const { app } = require('electron');
const path = require('path');

function isEnabled() {
  return app.getLoginItemSettings().openAtLogin;
}

function enable() {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  } else {
    // Dev-Betrieb: electron.exe direkt mit Projektordner als Argument starten.
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: [path.join(__dirname, '..')],
    });
  }
}

function disable() {
  app.setLoginItemSettings({ openAtLogin: false });
}

module.exports = { isEnabled, enable, disable };

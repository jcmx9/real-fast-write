# real-fast-write

> Ruhiger Markdown-Editor für Kundentermine, der schon beim Tippen aussieht wie das PDF von real-fast-document.

**Version:** 26.10.0-dev.0 · [English](README.en.md)

[![CI](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Beschreibung

`rf-write` ist der Editor zu [real-fast-document](https://github.com/jcmx9/real-fast-document) (`rf-document`). Er dient zum Mitschreiben im Kundentermin bei geteiltem Bildschirm. Das PDF erzeugt ausschließlich rf-document. Die Markdown-Datei bleibt Byte für Byte so, wie sie getippt wurde.

## Status

In Entwicklung. Vorhanden: Tabs, Autosave mit atomarem Schreiben, Umbenennen, Wiederherstellen der Sitzung, Erkennen externer Änderungen und PDF-Export über rf-document. Noch nicht vorhanden: die PDF-Optik in der Vorschau, der Präsentationsmodus, Snippets und die Installation per Einzeiler.

## Voraussetzungen (Entwicklung)

- Node.js ≥ 22.12 (CI: 24)
- npm, Git
- für den Export: real-fast-document

## Verwendung

```bash
rf-write                 # letzte Sitzung oder neue Notiz
rf-write notiz.md        # Datei öffnen (bei laufender Instanz als Tab)
rf-write --version
rf-write --help
```

Der Befehl `rf-write` steht nach der Installation zur Verfügung (ein One-Line-Installer ist geplant); in der Entwicklung startet `npm run dev` die App. Die Einstellungen liegen in `settings.json` im App-Datenordner (macOS `~/Library/Application Support/rf-write`, Windows `%APPDATA%\rf-write`, Linux `~/.config/rf-write`).

| Kürzel | Aktion |
|--------|--------|
| Mod+N | Neue Notiz im Standardordner (`JJJJ-MM-TT_HH-mm-ss.md`) |
| Mod+O | Öffnen |
| Mod+Shift+R | Umbenennen |
| Mod+W | Tab schließen |
| Mod+E | PDF exportieren |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Tabs wechseln |
| Mod+Z / Mod+Shift+Z, Mod+X/C/V, Mod+A | Widerrufen/Wiederholen, Ausschneiden/Kopieren/Einfügen, Alles auswählen |

`Mod` = Cmd unter macOS, sonst Ctrl. Die Auswahl mit Shift bzw. Mod+Shift und den Pfeiltasten übernimmt CodeMirror.

## Entwicklung

```bash
git clone git@github.com:jcmx9/real-fast-write.git
cd real-fast-write
npm ci
npm run dev                       # App mit Hot Reload
npm run lint && npm run typecheck
npm test                          # Unit-Tests (Vitest)
npx vitest run tests/unit/main/files.test.ts   # einzelne Testdatei
npm run test:e2e                  # Ende-zu-Ende (Playwright + Electron)
```

## Projektstruktur

```
src/main/       Main-Prozess: Dateien, Export, Sitzung, Menü, Fenster
src/preload/    sichere Brücke window.rfw
src/renderer/   Editor (CodeMirror 6), Tabs, Oberfläche
src/shared/     gemeinsame Typen und IPC-Kanäle
tests/          Unit- und Ende-zu-Ende-Tests
docs/           Spezifikation und Pläne
```

## Versionierung

[CalVer](https://calver.org/) im Format `YY.M.MICRO`. Die einzige Quelle ist `package.json`.

## Mitwirken

Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Sicherheit

Sicherheitslücken bitte nicht als öffentliches Issue melden, siehe [SECURITY.md](SECURITY.md).

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

## Lizenz

MIT – siehe [LICENSE](LICENSE).

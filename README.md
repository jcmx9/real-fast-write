# real-fast-write

> Ruhiger Markdown-Editor für Kundentermine, der schon beim Tippen aussieht wie das PDF von real-fast-document.

**Version:** 26.10.0-dev.0 · [English](README.en.md)

[![CI](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Beschreibung

`rf-write` ist der Editor zu [real-fast-document](https://github.com/jcmx9/real-fast-document) (`rf-document`). Er dient zum Mitschreiben im Kundentermin bei geteiltem Bildschirm. Das PDF erzeugt ausschließlich rf-document. Die Markdown-Datei bleibt Byte für Byte so, wie sie getippt wurde.

## Status

In Entwicklung. Vorhanden: Tabs, Autosave mit atomarem Schreiben, Umbenennen, Wiederherstellen der Sitzung, Erkennen externer Änderungen (auch gelöschte oder nicht lesbare Notizen, ohne stilles Überschreiben) und PDF-Export über rf-document sowie die PDF-Optik in der Vorschau. Der Präsentationsmodus (Vollbild, größerer Text, Infozeile) und Snippets sind verfügbar. Noch nicht vorhanden: die Installation per Einzeiler.

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

Symbolische Links auf einzelne Notizen öffnen die verlinkte Datei (Tab-Name, Umbenennen und Export beziehen sich auf sie); verlinkte Ordner sind davon nicht betroffen.

Der Befehl `rf-write` steht nach der Installation zur Verfügung (ein One-Line-Installer ist geplant); in der Entwicklung startet `npm run dev` die App. Die Einstellungen liegen in `settings.json` im App-Datenordner (macOS `~/Library/Application Support/rf-write`, Windows `%APPDATA%\rf-write`, Linux `~/.config/rf-write`); bearbeitet werden sie unter „Einstellungen …“ (macOS Cmd+, im App-Menü, sonst Ctrl+, im Menü „Datei“).

Die Preview nutzt die Schriften von rf-document aus dessen Installationsordner und fällt andernfalls auf Systemschriften zurück. Fließtext wird wie im PDF von rf-document im Blocksatz ohne Silbentrennung gesetzt; getrennt wird erst beim Export durch Typst.

| Kürzel | Aktion |
|--------|--------|
| Mod+N | Neue Notiz im Standardordner (`JJJJ-MM-TT_HH-mm-ss.md`) |
| Mod+O | Öffnen |
| Mod+Shift+R | Umbenennen |
| Mod+W | Tab schließen |
| Mod+E | PDF exportieren |
| Mod+Shift+M | Code-Ansicht ein/aus (Preview ist Standard) |
| Mod+Shift+H | YAML-Header in der Preview ein-/ausblenden (ausgeblendet erscheint der Titelblock wie im PDF) |
| Mod+Shift+O | Gliederung ein/aus (je Modus gemerkt) |
| macOS Cmd+Alt+[ / ], sonst Ctrl+Shift+[ / ] | Abschnitt ein-/ausklappen |
| macOS Ctrl+Alt+[ / ], sonst Alt+0 / Alt+Shift+0 | Alle Abschnitte ein-/ausklappen |
| Mod+Shift+P, Esc | Präsentieren ein/aus (Vollbild, nur Text und Infozeile, auf Wunsch mit Gliederung) |
| Mod+Enter | Seitenumbruch einfügen (`<!-- pagebreak -->`, wie rf-document) |
| Mod+Plus / Mod+- / Mod+0 | Vergrößern / Verkleinern / Originalgröße (je Modus gespeichert) |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Tabs wechseln |
| Mod+Z / Mod+Shift+Z, Mod+X/C/V, Mod+A | Widerrufen/Wiederholen, Ausschneiden/Kopieren/Einfügen, Alles auswählen |

`Mod` = Cmd unter macOS, sonst Ctrl. Die Auswahl mit Shift bzw. Mod+Shift und den Pfeiltasten übernimmt CodeMirror.

## Gliederung

Eine Seitenleiste rechts listet die Überschriften H1 und H2 der Notiz. Der Pfeil vor einem Eintrag mit Inhalt (H1 oder H2) klappt den Abschnitt im Text und in der Gliederung gleichzeitig ein oder aus; „Alle ein-/ausklappen“ wirkt ebenso auf beide. Ein Klick auf einen Eintrag springt im Text zur Überschrift, der Fokus bleibt im Editor. Mod+Shift+O blendet die Gliederung ein oder aus; die Einstellung wird getrennt für Edit und Present gemerkt.

## Snippets

Tippe `:` am Zeilenanfang oder nach einem Leerzeichen und mindestens einen Buchstaben (z. B. `:mee`), dann erscheint die Liste der Snippets; Strg+Leertaste zeigt nach einem einzelnen `:` alle. Unter macOS kann Strg+Leertaste von der Eingabequellen-Umschaltung belegt sein; dann einfach `:` und einen Buchstaben tippen. Enter oder Tab fügt das Snippet ein, Tab / Shift+Tab springen durch die Felder. Prosa wie `Hinweis:`, `10:30` oder `:D` löst nichts aus.

In einem Snippet beendet Esc zuerst den Feldmodus; im Präsentationsmodus verlässt erst ein weiteres Esc die Präsentation. Header-Snippets (`:meeting`, `:telefonnotiz`, `:header`) lassen im Präsentationsmodus den YAML-Header offen, solange ein Feld darin aktiv ist; danach klappt er zum Titelblock zu. Folgezeilen eines mehrzeiligen Snippets übernehmen die Einrückung der aktuellen Zeile, und Tabs am Zeilenanfang einer Vorlage werden zu zwei Leerzeichen.

| Snippet | Inhalt |
|---------|--------|
| `:meeting` | Meeting-Notiz mit Header, Teilnehmern, Agenda, Mitschrift und Aufgaben |
| `:telefonnotiz` | Telefonnotiz |
| `:aufgabe` | Aufgabenzeile `- [ ] Aufgabe – Name, bis Datum` |
| `:header` | YAML-Header mit allen rf-document-Schlüsseln |
| `:newpage` | Seitenumbruch `<!-- pagebreak -->` |

Eigene Snippets sind Dateien `name.tpl.md` im Snippet-Ordner (Standard `~/Documents/rf-write/snippets`, Einstellung `snippetFolder`). Ein eigenes Snippet mit demselben Namen ersetzt das eingebaute. Neue Dateien werden beim nächsten Fokus des Fensters erkannt. Unterstützte Syntax: `$1`, `${1:Vorgabe}`, `$0` (Endposition) sowie `$CURRENT_YEAR`, `$CURRENT_MONTH`, `$CURRENT_DATE`, `$CURRENT_HOUR`, `$CURRENT_MINUTE`, `$CURRENT_SECOND` (auch in der Form `${CURRENT_YEAR}`). `\$` ergibt ein wörtliches `$`, `\\` einen Backslash, und in einer Vorgabe ergibt `\}` eine wörtliche geschweifte Klammer `}`.

## Entwicklung

```bash
git clone git@github.com:jcmx9/real-fast-write.git
cd real-fast-write
npm ci
npm run dev                       # App mit Hot Reload  (macOS: Menüleiste zeigt "rf-write", per postinstall)
npm run lint && npm run typecheck
npm test                          # Unit-Tests (Vitest)
npx vitest run tests/unit/main/files.test.ts   # einzelne Testdatei
npm run test:e2e                  # Ende-zu-Ende (Playwright + Electron)
```

In der Entwicklung (`npm run dev`) nutzt rf-write einen eigenen App-Datenordner `rf-write-dev` neben `rf-write` (z. B. macOS `~/Library/Application Support/rf-write-dev`). So teilen eine installierte App und die Entwicklungsversion nie Einstellungen, Sitzung oder Single-Instance-Sperre. `RFW_USER_DATA` (Tests) überschreibt den Ordner.

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

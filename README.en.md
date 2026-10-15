# real-fast-write

> Calm Markdown editor for client meetings that already looks like the real-fast-document PDF while you type.

**Version:** 26.10.0-dev.0 · [Deutsch](README.md)

[![CI](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Description

`rf-write` is the editor for [real-fast-document](https://github.com/jcmx9/real-fast-document) (`rf-document`). It is meant for note-taking in client meetings while the screen is shared. Only rf-document produces the PDF. The Markdown file stays byte for byte as it was typed.

## Status

In development. Available: tabs, autosave with atomic writes, rename, session restore, detection of external changes (including deleted or unreadable notes, never silently overwritten) and PDF export via rf-document, and the PDF look in the preview. Presentation mode (fullscreen, larger text, info line) and snippets are available. Not yet available: one-line installation.

## Prerequisites (development)

- Node.js ≥ 22.12 (CI: 24)
- npm, Git
- for export: real-fast-document

## Usage

```bash
rf-write                 # last session or a new note
rf-write note.md         # open a file (as a tab in a running instance)
rf-write --version
rf-write --help
```

Symbolic links to single notes open the linked file (tab name, rename and export refer to it); linked folders are not affected.

The `rf-write` command is available after installation (a one-line installer is planned); in development, `npm run dev` starts the app. Settings live in `settings.json` in the app data folder (macOS `~/Library/Application Support/rf-write`, Windows `%APPDATA%\rf-write`, Linux `~/.config/rf-write`); edit them under „Einstellungen …“ (macOS Cmd+, in the app menu, otherwise Ctrl+, in the „Datei“ menu).

The preview uses rf-document's fonts from its install folder and otherwise falls back to system fonts. Body text is set justified without hyphenation, like the PDF from rf-document; Typst hyphenates only on export.

| Shortcut | Action |
|----------|--------|
| Mod+N | New note in the default folder (`YYYY-MM-DD_HH-mm-ss.md`) |
| Mod+O | Open |
| Mod+Shift+R | Rename |
| Mod+W | Close tab |
| Mod+E | Export PDF |
| Mod+Shift+M | Toggle code view (preview is the default) |
| Mod+Shift+H | Show/hide the YAML header in the preview (hidden, the title block appears as in the PDF) |
| Mod+Shift+O | Toggle outline (remembered per mode) |
| macOS Cmd+Alt+[ / ], otherwise Ctrl+Shift+[ / ] | Fold/unfold section |
| macOS Ctrl+Alt+[ / ], otherwise Alt+0 / Alt+Shift+0 | Fold/unfold all sections |
| Mod+Shift+P, Esc | Toggle presentation (fullscreen, text and info line only, optionally with the outline) |
| Mod+Enter | Insert a page break (`<!-- pagebreak -->`, as in rf-document) |
| Mod+Plus / Mod+- / Mod+0 | Zoom in / out / reset (stored per mode) |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Switch tabs |
| Mod+Z / Mod+Shift+Z, Mod+X/C/V, Mod+A | Undo/Redo, Cut/Copy/Paste, Select all |

`Mod` = Cmd on macOS, Ctrl elsewhere. Selecting with Shift or Mod+Shift and the arrow keys is handled by CodeMirror.

## Outline

A sidebar on the right lists the H1 and H2 headings of the note. The chevron in front of an entry with content (H1 or H2) folds or unfolds the section in the text and in the outline at the same time; fold/unfold all acts on both as well. Clicking an entry jumps to the heading in the text, and focus stays in the editor. Mod+Shift+O toggles the outline; the setting is remembered separately for Edit and Present.

## Snippets

Type `:` at the start of a line or after a space, plus at least one letter (e.g. `:mee`), to show the snippet list; Ctrl+Space shows all of them after a bare `:`. On macOS, Ctrl+Space may be taken by input-source switching; then just type `:` and a letter. Enter or Tab inserts the snippet, Tab / Shift+Tab move through its fields. Prose such as `Hinweis:`, `10:30` or `:D` triggers nothing.

Inside a snippet, Esc first ends the field mode; in presentation mode only a further Esc leaves the presentation. Header snippets (`:meeting`, `:telefonnotiz`, `:header`) keep the YAML header open in presentation mode while a field in it is active; afterwards it collapses to the title block. Following lines of a multi-line snippet take the indentation of the current line, and tabs at the start of a template line become two spaces.

| Snippet | Content |
|---------|---------|
| `:meeting` | Meeting note with header, attendees, agenda, minutes and tasks |
| `:telefonnotiz` | Phone note |
| `:aufgabe` | Task line `- [ ] Aufgabe – Name, bis Datum` |
| `:header` | YAML header with all rf-document keys |
| `:newpage` | Page break `<!-- pagebreak -->` |

Own snippets are files `name.tpl.md` in the snippet folder (default `~/Documents/rf-write/snippets`, setting `snippetFolder`). An own snippet with the same name replaces the built-in one. New files are picked up the next time the window gets focus. Supported syntax: `$1`, `${1:default}`, `$0` (final position) and `$CURRENT_YEAR`, `$CURRENT_MONTH`, `$CURRENT_DATE`, `$CURRENT_HOUR`, `$CURRENT_MINUTE`, `$CURRENT_SECOND` (also in the form `${CURRENT_YEAR}`). `\$` gives a literal `$`, `\\` a backslash, and inside a default `\}` gives a literal `}`.

## Development

```bash
git clone git@github.com:jcmx9/real-fast-write.git
cd real-fast-write
npm ci
npm run dev                       # app with hot reload  (macOS: menu bar shows "rf-write", via postinstall)
npm run lint && npm run typecheck
npm test                          # unit tests (Vitest)
npx vitest run tests/unit/main/files.test.ts   # single test file
npm run test:e2e                  # end-to-end (Playwright + Electron)
```

In development (`npm run dev`) rf-write uses its own app data folder `rf-write-dev` next to `rf-write` (e.g. macOS `~/Library/Application Support/rf-write-dev`), so an installed app and the development build never share settings, session or the single-instance lock. `RFW_USER_DATA` (tests) overrides the folder.

## Project Structure

```
src/main/       main process: files, export, session, menu, window
src/preload/    secure bridge window.rfw
src/renderer/   editor (CodeMirror 6), tabs, UI
src/shared/     shared types and IPC channels
tests/          unit and end-to-end tests
docs/           spec and plans
```

## Versioning

[CalVer](https://calver.org/) in the format `YY.M.MICRO`. The single source is `package.json`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please do not report vulnerabilities as public issues, see [SECURITY.md](SECURITY.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT – see [LICENSE](LICENSE).

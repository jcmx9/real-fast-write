# real-fast-write

> Calm Markdown editor for client meetings that already looks like the real-fast-document PDF while you type.

**Version:** 26.10.0-dev.0 · [Deutsch](README.md)

[![CI](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Description

`rf-write` is the editor for [real-fast-document](https://github.com/jcmx9/real-fast-document) (`rf-document`). It is meant for note-taking in client meetings while the screen is shared. Only rf-document produces the PDF. The Markdown file stays byte for byte as it was typed.

## Status

In development. Available: tabs, autosave with atomic writes, rename, session restore, detection of external changes and PDF export via rf-document, and the PDF look in the preview. Presentation mode (fullscreen, larger text, info line) is available. Not yet available: snippets and one-line installation.

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

The `rf-write` command is available after installation (a one-line installer is planned); in development, `npm run dev` starts the app. Settings live in `settings.json` in the app data folder (macOS `~/Library/Application Support/rf-write`, Windows `%APPDATA%\rf-write`, Linux `~/.config/rf-write`).

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
| macOS Cmd+Alt+[ / ], otherwise Ctrl+Shift+[ / ] | Fold/unfold section |
| macOS Ctrl+Alt+[ / ], otherwise Alt+0 / Alt+Shift+0 | Fold/unfold all sections |
| Mod+Shift+P, Esc | Toggle presentation (fullscreen, text and info line only) |
| Mod+Plus / Mod+- / Mod+0 | Zoom in / out / reset (stored per mode) |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Switch tabs |
| Mod+Z / Mod+Shift+Z, Mod+X/C/V, Mod+A | Undo/Redo, Cut/Copy/Paste, Select all |

`Mod` = Cmd on macOS, Ctrl elsewhere. Selecting with Shift or Mod+Shift and the arrow keys is handled by CodeMirror.

## Development

```bash
git clone git@github.com:jcmx9/real-fast-write.git
cd real-fast-write
npm ci
npm run dev                       # app with hot reload
npm run lint && npm run typecheck
npm test                          # unit tests (Vitest)
npx vitest run tests/unit/main/files.test.ts   # single test file
npm run test:e2e                  # end-to-end (Playwright + Electron)
```

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

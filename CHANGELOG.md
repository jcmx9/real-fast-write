# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Electron app with tabs and a CodeMirror 6 Markdown editor
- Autosave with atomic, byte-exact writes (BOM, CRLF and mixed line endings kept)
- New notes as `YYYY-MM-DD_HH-mm-ss.md` in a default folder, rename without overwrite
- Session restore, recent files, single instance (`rf-write file.md` opens in the running app)
- Detection of external changes
- Clipboard editing, select all and keyboard selection via CodeMirror
- External-change conflict banner that pauses autosave for that note
- PDF export via rf-document with readable error messages
- CI on macOS, Windows and Linux with a real rf-document export

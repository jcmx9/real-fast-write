# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- A note opened under two path spellings (symlink, case, 8.3 name) uses one tab
- External changes that are not UTF-8 or delete the note are reported and never silently overwritten
- A failed folder watcher re-arms itself
- Closing while typing saves every keystroke or asks
- Present recovers when the OS refuses fullscreen; fast toggles keep the last intent

### Added
- Outline sidebar with H1/H2, folding in sync with the editor, per-mode visibility
- Insert a page break (`<!-- pagebreak -->`) from the Edit menu or with Mod+Enter
- Snippets: `:meeting`, `:telefonnotiz`, `:aufgabe`, `:header`, `:newpage` and own `*.tpl.md` templates, triggered with `:`
- A fold opens when the cursor moves into it
- Present mode: fullscreen, larger text, title block, info line with clock, tabs, zoom and save state; Esc returns to Edit
- Zoom per mode (Edit/Present), restored after restart
- Electron app with tabs and a CodeMirror 6 Markdown editor
- Autosave with atomic, byte-exact writes (BOM, CRLF and mixed line endings kept)
- New notes as `YYYY-MM-DD_HH-mm-ss.md` in a default folder, rename without overwrite
- Session restore, recent files, single instance (`rf-write file.md` opens in the running app)
- Detection of external changes
- Clipboard editing, select all and keyboard selection via CodeMirror
- External-change conflict banner that pauses autosave for that note
- PDF export via rf-document with readable error messages
- CI on macOS, Windows and Linux with a real rf-document export
- Preview in the PDF look: rf-document fonts, headings, lists with squares, clickable checkboxes, alert boxes, striped tables, code blocks with Typst colours
- Tables like the PDF (columns, alignment, stripes), editable as Markdown on click
- Code/Preview switch, YAML header that collapses into the PDF title block, section folding (single and all)

### Changed
- Body text is justified without hyphenation on every platform (hyphenation only in the PDF)

# rf-write MVP – Design

Status: draft for review · 2026-10-14 · source brief: `PROMPT.md`

## 1. Purpose

`rf-write` is a calm, presentation-ready Markdown editor for live note-taking in client meetings while the screen is shared. It looks like the PDF that **real-fast-document** (`rf-document`) produces from the same file. It replaces the Zettlr setup in `jcmx9/zettlr_rfdoc-Export`.

Success means you can start a meeting note with one shortcut and a snippet, write it in presentation mode with nothing else on screen, and export the PDF with one shortcut. No byte of the Markdown source may change unless the user typed it.

## 2. Stack decisions

| Area | Decision | Reason |
|---|---|---|
| Shell | **Electron** | Identical Chromium rendering on macOS, Windows and Linux. Tauri's three system webviews (WebKitGTK font-weight and Wayland bugs) are not acceptable for a client-facing view. The whole codebase stays TypeScript. |
| Editor | **CodeMirror 6** + `@lezer/markdown` | Keeps the source byte-exact and renders the preview as decorations. ProseMirror, Milkdown and TipTap re-serialize Markdown, and Monaco is not built for prose. |
| UI | Plain TypeScript, no framework | The UI is small (tab bar, info line, settings dialog). Native Electron menus handle the rest. |
| Build | `electron-vite`, `electron-builder` (archives only) | |
| Quality | TypeScript strict, Biome, Vitest, Playwright (Electron) | |

Security posture: the app shows only local Markdown as text, never remote content or raw HTML. The renderer runs with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` and a strict CSP. Electron updates follow Dependabot at a relaxed cadence.

## 3. Scope

### MVP

1. Multiple files as **tabs** in **one window**.
2. Modes **Edit** and **Present**. Edit has two views, **Code** and **Preview**.
3. Preview looks like the PDF and stays editable. Markdown marks recede until the cursor reaches them.
4. YAML header toggle in Edit/Preview. The header is always hidden in Present.
5. Section folding by heading, per section or all at once.
6. Snippets triggered with `:`, ported from Zettlr, plus user snippets.
7. Autosave with atomic writes. Default folder and timestamp name for new files. Rename.
8. Export via `rf-document`. rf-document owns the output name and opens the PDF.
9. View menu with mode, view, header, folding and zoom. File menu with new, open, close, rename, export and recent files. Settings.
10. Fonts loaded from the rf-document install folder, with fallback.
11. One-line install, update and uninstall via bootstrap scripts, like rf-document.

### Later

Outline sidebar, search, image preview, Mermaid, dark mode, folder view, task table view, code signing.

### Non-goals

Vault or library management, plugins, sync, own PDF rendering, and re-implementing rf-document features. Gaps go to rf-document.

## 4. Window, modes and views

There is exactly one window. All modes share one `EditorView` and one document per tab. A mode or view switch reconfigures CodeMirror extensions through `Compartment`s and never touches the text. Undo history, cursor and scroll are preserved.

### Edit

- Tab bar on top. An unsaved-changes dot appears per tab.
- Status line at the bottom: file name, save state, **Export** button.
- **Code view:** raw Markdown with syntax colors in Source Code, line numbers, flush-left, header always visible.
- **Preview view:** PDF look (§5). Header collapsible.

### Present

- The window goes fullscreen (`setFullScreen`), which hides the dock and menu bar on macOS and the taskbar on Windows. On Linux this depends on the window manager.
- Only the text and the **info line** remain.
- The view is Preview with a larger font (configurable factor, adjustable with zoom), a line length of about 70ch, centered.
- The **YAML header** shows rf-document's title block, as when it is hidden in Preview (decided 2026-10-15). Without any title fields it shows nothing at all. The header is read-only, and the cursor cannot enter it.
- Editing stays fully available.
- Info line at the bottom, unobtrusive: **clock**, **tabs** (click to switch), **switch to Edit**, **zoom − / +**, **save state**. There is no export button in Present.
- `Esc` returns to Edit.

### Zoom

Zoom is stored separately for Edit and Present. In Edit, 100 % equals the PDF's 10 pt body size on screen. Zoom only scales the CSS; it is not Electron page zoom.

### Outline

- A sidebar on the right lists the note's H1 and H2 headings (H2 indented under its H1). It is available in Code, Preview and Present and is toggled with „Gliederung ein/aus“ (View menu, Mod+Shift+O). The on/off state is kept **per mode** (Edit, Present) in the session.
- Each entry with a non-empty section has a `>` chevron. It folds or unfolds that section in the text; an H1's H2 entries are hidden while the H1 is folded. Outline and editor folds are always in sync: folding from the menu, the keyboard or „Alle ein-/ausklappen“ updates the outline, and the chevron folds the text.
- Clicking an entry scrolls to the heading and puts the cursor at its end; a folded section stays folded; focus returns to the text.
- The entry of the section containing the cursor is highlighted.
- Entries never wrap: the sidebar fits the longest entry (at least about 14 characters, at most a third of the window); longer entries end in „…“ with the full text as a tooltip.
- The sidebar uses the chrome font and does not scale with the text zoom.

## 5. Preview rendering

- The decorations come from the Lezer syntax tree and are recomputed for the visible ranges only.
- Headings, emphasis, lists, quotes, inline code, links: styled. Their marks (`#`, `**`, `>`, `` ` ``, link URLs) are dimmed or hidden unless the cursor is inside the element.
- Task items `- [ ]` render as clickable checkboxes. A click changes exactly one character (`[ ]` ↔ `[x]`).
- Alerts `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` get a left bar and tinted background in rf-document colors.
- Tables look like the PDF (decided 2026-10-15): a block widget shows real columns, a centred bold head, alignment from the delimiter row (otherwise numbers right-aligned), every second data row striped, vertical rules and a rule under the head. A click on the table, or the cursor entering it, shows the Markdown text for editing. The widget never changes the text.
- Fenced code blocks get Typst-like syntax colors.
- Body text is justified without hyphenation on every OS (decided 2026-10-15). rf-document sets `par(justify: true)`, and Typst hyphenates only in the PDF. Headings, tables, code, the title block and the front matter stay flush-left, as in the PDF.
- **Theme values:** all sizes, spacings, colors and font features come from `zettlr_rfdoc-Export/zettlr/rfdoc-zettlr.css`. They become CSS custom properties in `src/renderer/theme.css`, which names rf-document's `template.typ` as its source of truth. Only the values are ported. Zettlr's selectors (`.cm-header-1`, `.rendered-bullet`, …) do not apply.
- Sizes: body 10 pt; `#` 14 pt with a hairline; `##` 12 pt; `###` underlined; `####` and below italic. Oldstyle figures in body text (`font-variant-numeric: oldstyle-nums`).

### YAML header toggle (Edit/Preview)

- A replace decoration collapses the front matter into rf-document's title block (decided 2026-10-15). It shows the client (small capitals), the title, the subtitle and "date · author", each only when set and with dates formatted like the PDF. Without any of these fields it shows a muted `⋯ YAML-Header` line.
- `atomicRanges` makes the cursor skip the collapsed block.
- If the cursor is inside the header when it collapses, it moves to the first position after the header.
- The state is kept per tab and persisted with the session.

### Section folding

- Folding is based on `@codemirror/lang-markdown` heading sections. A section runs to the next heading of the same or higher level.
- It is available in Code, Preview and Present. Fold arrows appear on hover in Edit only.
- Commands: fold or unfold the section at the cursor, fold all, unfold all. They are in the View menu and on the keyboard (§10).
- The YAML header is separate from folding and has its own toggle.
- Moving the cursor into a folded range, for example to a snippet tab stop, unfolds it.
- Fold state is per tab while the tab is open. It is **not** persisted: files always open unfolded.

## 6. Files

- **New file:** `<default folder>/YYYY-MM-DD_HH-mm-ss.md` with local time. If the name exists, `_2`, `_3`, … is appended. The file is created on the first save, so closing an untouched new tab leaves nothing on disk.
- **Default folder:** setting, default `~/Documents/rf-write`, created on demand.
- **Atomic write:** write to `<name>.<random>.tmp` in the same folder, `fsync`, then `rename` over the target. On Windows, `EPERM`/`EBUSY` from virus scanners or indexers are retried with backoff.
- **Autosave:** 1 s after the last edit, plus on tab switch, window blur, tab close and quit.
- **Save failure:** the tab stays dirty, the status shows a prominent warning, and autosave keeps retrying. Closing or quitting with a dirty tab asks first. Data is never dropped silently.
- **Rename:** a dialog with the file name, in the same folder. It refuses if the target exists and never overwrites. Rename means a file rename plus a tab path update.
- **External changes:** each open file is watched. Own writes are recognized by content hash. If the tab is clean, the file reloads. If the tab is dirty, a banner offers "Reload (discard mine)" or "Keep mine". The latter then overwrites on the next save.
- **Encoding:** UTF-8. Line endings and a BOM are preserved as found. New files use `\n`.

## 7. Session and start

- The session is stored in the app data folder and covers open tab paths, active tab, view, header toggles, zoom and outline visibility per mode. The app always starts in Edit, never in fullscreen Present.
- `rf-write` without an argument restores the session. An empty session opens a new note.
- `rf-write file.md` restores the session and opens or focuses `file.md`.
- **Single instance:** a second start hands its arguments to the running window (`requestSingleInstanceLock` / `second-instance`, macOS `open-file`).
- `rf-write --version` / `-V` prints the version and `rf-write --help` prints the usage, both without opening a window.
- Missing files in the session are skipped with a notice.
- Closing the last tab shows an empty state with "New" and "Open". On macOS the app keeps running; elsewhere the window stays open.
- The File menu lists recent files (last 10).

## 8. Snippets

- **Trigger:** `:` at line start or after whitespace opens autocompletion (`@codemirror/autocomplete`). Typing filters the list (`:mee`), and Enter or Tab inserts.
- **Built-in:** the five templates from `zettlr_rfdoc-Export/zettlr/snippets/*.tpl.md`, copied verbatim: `:meeting`, `:telefonnotiz`, `:aufgabe`, `:header`, `:newpage`. The name is the file name without `.tpl.md`.
- **User snippets:** `*.tpl.md` in the snippet folder (setting, default `<default folder>/snippets`). The folder is rescanned on focus. A user snippet overrides a built-in one with the same name.
- **Syntax (VS Code / Zettlr subset):** `$n`, `${n:default}`, `$0`, and multi-digit `n` (`$10`, `${16:false}`). Variables: `$CURRENT_YEAR`, `$CURRENT_MONTH`, `$CURRENT_DATE`, `$CURRENT_HOUR`, `$CURRENT_MINUTE`, `$CURRENT_SECOND`. A variable can appear inside a default (`${5:$CURRENT_YEAR-…}`).
- **Implementation:** an own parser expands the variables at insert time and translates the result to CodeMirror's `snippet()` template. Literal `$` without a valid placeholder stays literal.
- **Behaviour:** the first tab stop is selected after insert, Tab moves forward, Shift+Tab moves back, and `$0` ends the session.

## 9. Export

1. The export button and its shortcut work in Edit only.
2. The active tab is saved first. If saving fails, the export is aborted.
3. **Locate `rf-document`**:
   1. the settings path
   2. `RF_DOCUMENT`
   3. `~/.local/bin/rf-document`
   4. `/opt/homebrew/bin/rf-document`
   5. `/usr/local/bin/rf-document`
   6. `%LOCALAPPDATA%\Microsoft\WindowsApps\rf-document.cmd`
   7. `PATH`

   The result is cached and re-resolved on failure.
4. Run `spawn(rfDocument, [absolutePath])` without a shell. On Windows the `.cmd` is called via `cmd.exe /d /s /c` with proper quoting. There are no flags and no `RFD_NO_OPEN`, because rf-document chooses the output name, reads options from front matter, and opens the PDF.
5. While the export runs, the button shows a spinner and repeated triggers are ignored.
6. **Exit 0:** a short toast shows rf-document's stdout line.
7. **Exit ≠ 0:** a dismissible, copyable panel shows stderr verbatim. rf-document's messages are German and meant for users.
8. **rf-document not found:** a panel lists the searched locations and the bootstrap one-liner.

## 10. Menus and shortcuts

`Mod` = Cmd on macOS, Ctrl elsewhere. These are proposals and may be adjusted during review.

| Menu | Item | Shortcut |
|---|---|---|
| File | New | Mod+N |
| | Open… | Mod+O |
| | Recent files › | – |
| | Rename… | Mod+Shift+R |
| | Close tab | Mod+W |
| | Export PDF | Mod+E |
| | Settings… (macOS: app menu) | Mod+, |
| Edit | Undo/redo, cut/copy/paste, select all | standard |
| View | Edit / Present | Mod+Shift+P, `Esc` leaves Present |
| | Code / Preview | Mod+Shift+M |
| | YAML header show/hide | Mod+Shift+H |
| | Fold / unfold section | macOS Cmd+Alt+[ / ], else Ctrl+Shift+[ / ] |
| | Fold all / unfold all | macOS Ctrl+Alt+[ / ], else Alt+0 / Alt+Shift+0 (Ctrl+Alt is AltGr there and types `[` / `]`) |
| | Outline show/hide | Mod+Shift+O |
| | Zoom in / out / 100 % | Mod+Plus (also Mod+= ) / Mod+- / Mod+0 |
| Window | Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 |

## 11. Settings

The settings are stored as JSON in the app data folder:

- default folder for new files
- snippet folder
- rf-document path (empty = auto)
- Present font factor (default 1.6)

The dialog also shows a read-only status: whether rf-document and the fonts were found, with path and version (`rf-document --version`).

## 12. Fonts

- Fonts are looked up in `~/.local/share/real-fast-document/fonts/`, or `%LOCALAPPDATA%\real-fast-document\fonts\` on Windows.
- Files: `SourceSans3VF-*`, `SourceSerif4Variable-*`, `SourceCodeVF-*`, `NotoEmoji[wght].ttf`.
- They are served to the renderer via a privileged custom protocol, `rfw-font://`, and registered at runtime via the FontFace API (`new FontFace(…)` + `document.fonts.add`), not with `@font-face`.
- If they are missing, rf-write uses system fallbacks (`system-ui`, `Georgia`, `ui-monospace`) and shows a notice once per session.

## 13. Architecture

```
src/
  main/        app (lifecycle, single instance), window, menu, files (atomic write,
               naming, rename, watch), session, settings, export (locate + run),
               fonts (lookup + protocol), snippets (load built-in + user)
  preload/     typed contextBridge API `window.rfw`
  renderer/
    editor/    setup, compartments, preview decorations, code view, header toggle,
               folding, snippets (parser + completion), present view
    tabs/      tab model (EditorState per tab, path, saved hash, dirty)
    ui/        tab bar, status line, info line, settings dialog, panels/toasts
    theme.css  values ported from rfdoc-zettlr.css
  shared/      IPC types and channel names
resources/snippets/   built-in *.tpl.md
scripts/      bootstrap.sh, bootstrap.ps1, release.sh
```

- The **main process** owns the disk, processes, menus and the window.
- The **renderer** owns the text and the editor state.
- **IPC** is request/response (`invoke`) for file operations, export and settings. Main sends events for menu commands, the second-instance open and external file changes.
- **Tabs:** one `EditorView`. Each tab keeps its own `EditorState`, which is swapped in with `setState` and holds per-tab undo, selection and folds.

## 14. Installation and release

- **One-liner, like rf-document:**
  - `curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.sh | bash`
  - `irm https://raw.githubusercontent.com/jcmx9/real-fast-write/main/scripts/bootstrap.ps1 | iex`
- The bootstrap downloads the latest **GitHub Release archive** for the OS and architecture. It does not clone and build.
  - **macOS:** it extracts `rf-write.app` to `~/Applications` and removes the quarantine attribute.
  - **Linux:** it puts the AppImage in `~/.local/share/real-fast-write/` and adds a `.desktop` entry.
  - **Windows:** it extracts the app to `%LOCALAPPDATA%\real-fast-write\` and adds a Start menu shortcut.
- It installs the `rf-write` command (`~/.local/bin/rf-write`, or `rf-write.cmd` on Windows). No admin rights are needed.
- Re-running the bootstrap updates the app. `--uninstall` / `-Uninstall` removes everything, after a safety check that the target folder is an rf-write install.
- If `rf-document` is missing, the bootstrap runs rf-document's bootstrap.
- The release is **unsigned** in the MVP. Signing and notarization come later.
- **Versioning:** CalVer `YY.M.MICRO` with `package.json` as the single source. Dev versions use the SemVer form `YY.M.MICRO-dev.N`, as required by electron-builder.
- **Branches:** `main` (PR only, green CI), `dev`, `feature/…` and `fix/…`. Squash into `dev`, rebase into `main`. A `v*` tag triggers the release workflow.
- `scripts/release.sh dev|prod` aborts on any error and verifies the version on `main` before tagging.

## 15. Testing

- **Unit tests (Vitest):**
  - **Snippet parser:** tab stops, defaults, multi-digit, variables, nested variable in default, literal `$`.
  - **`:header` keys:** they must equal the keys of rf-document's `header.md` (key pattern `^[a-z][a-z0-9_-]*:` covers `h1_break` and `logo-height`). CI checks out `jcmx9/real-fast-document` for the file.
  - **Files:**
    - new-file naming and collisions
    - rename without overwrite
    - atomic write, including a simulated crash between the tmp file and the rename
    - line-ending and BOM preservation
  - **rf-document locator:** with a fake filesystem and environment.
  - **Export runner:** with a fake `rf-document` (exit 0 with stdout, exit 1 with stderr, missing binary, paths with spaces).
- **Editor tests** at the `EditorState` level, without a DOM:
  - a mode or view switch leaves `doc.toString()` byte-identical
  - collapsing the header with the cursor inside moves the cursor out
  - Present hides the header and makes it unreachable
  - a checkbox toggle changes exactly one character
  - fold all and unfold all
- **End-to-end tests (Playwright with Electron, all three OSes):**
  - new note, `:meeting`, tab through the stops
  - autosave reaches the disk
  - second tab, tab switch
  - Present on and off
  - **real export** with rf-document installed by its bootstrap, then assert that the PDF exists
  - **screenshots** of Preview and Present uploaded as CI artifacts
- **Coverage:** at least 80 % for `main/` and the snippet parser.

## 16. CI

- **Matrix:** `macos-latest`, `windows-latest`, `ubuntu-latest` (Linux under `xvfb`).
- **Steps:** install, Biome check, `tsc --noEmit`, Vitest, build, Playwright E2E with the real rf-document, archive build.
- **Bootstrap test:** install from the built archive, then `rf-write --version`, then uninstall.
- **Release workflow on `v*`:** build the archives on all three OSes and attach them to the GitHub Release.
- **Dependabot:** npm and GitHub Actions, targeting `dev`.

# rf-write Plan 6 – Pre-release Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** close the deferred findings collected since plan 1 that a release must not ship with: duplicate tabs for one file, silently ignored external changes, a watcher that stops for good, lost keystrokes on close, Present/fullscreen edge cases, and debuggable E2E failures.

**Architecture:** fixes stay in the module that owns the behaviour — main owns paths, files and the watcher; `App` owns tabs, conflicts and closing; `FullScreenOwner` owns fullscreen intent. No new UI beyond banners in the existing notice style.

**Tech Stack:** Electron 44, Node fs, CodeMirror 6, TypeScript strict, Vitest, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md` §6 (files: atomic write, external changes, "data is never dropped silently"), §7 (single instance, session), §4 (Present). The findings are listed in the project memory `plan1-followups` and in the ledgers of plans 1–5.

**Builds on:** `dev` at `6b5efdc` (plans 1–5). Relevant code:
- `src/main/context.ts`: `AppContext` — `allow()/assertAllowed()` (path allowlist), `openPaths()`, `startup()`, window close → `Ch.beforeClose`.
- `src/main/ipc.ts`: `readNote`, `saveNote`, `renameNote`, `newNotePath`, `openDialog` handlers.
- `src/main/files.ts`: `readNote` (throws `NotUtf8Error`), `renameNote`, `sameFile`.
- `src/main/watcher.ts`: `NoteWatcher` (directory watchers, `{accepted, latest}` hashes, `check()` ignores read errors, `w.on('error')` drops the watcher).
- `src/main/fullscreen.ts`: `FullScreenOwner` (`request`, `pendingLeaves`), `src/main/menu.ts` (`KEY_REPEAT_MS = 500` guard for toggle-present).
- `src/renderer/app.ts`: `openPath()`, `externalChange()`, conflicts + banners, `beforeClose()` with `MAX_SAVE_ROUNDS`.
- `src/renderer/tabs/tab-store.ts`: `findByPath` (exact string match).
- `tests/e2e/helpers.ts`: `launch()` (no tracing; `use.trace` has no effect for `_electron.launch`).

## Global Constraints

- **Branch:** `fix/prerelease` from `dev`. PR into `dev`; merge only with green CI on all three OSes and the user's approval.
- **Data safety first:** no change may make a write less atomic or let an external edit be overwritten without the user's choice. Byte-exact saving stays untouched.
- **Paths:** canonical form = `fs.realpathSync.native(path)` for existing files (resolves symlinks, 8.3 names and the file system's stored case on macOS/Windows); for a not-yet-existing new note: `realpath` of its folder + the file name. The allowlist, the watcher, tab identity and the session use the canonical form only.
- **UI strings German**, code/commits/docs English, Conventional Commits, no AI attribution, author `jcmx9`. README de/en parity. Local `CLAUDE.md` never committed.
- **Checks before each commit:** `npm run lint && npm run typecheck && npm test`.

## Review Focus

1. **Same file, two spellings** (`/tmp` vs `/private/tmp` on macOS, symlinked folder, `C:\Notes\a.md` vs `c:\notes\A.md` on Windows): one tab, one watcher entry, saves never fight.
2. **External change that is not UTF-8 or deletes the file:** the user sees a banner; autosave never silently overwrites it; for a deleted file the next save recreates it only after the user saw the notice.
3. **Watcher folder disappears and comes back** (network share, renamed folder restored): watching resumes on its own within seconds.
4. **Closing while typing fast:** every typed character is either on disk or the user was asked to discard.
5. **Fullscreen refused by the OS / double-press of Mod+Shift+P:** Present and fullscreen never stay out of sync for the rest of the session.

---

### Task 1: Canonical paths — one file, one tab

**Files:** `src/main/files.ts` (new `canonicalPath(path): Promise<string>`), `src/main/context.ts`, `src/main/ipc.ts`, `src/main/index.ts` (CLI/second-instance/open-file paths), tests `tests/unit/main/files.test.ts`, `tests/unit/main/context-paths.test.ts` (or extend an existing context test), E2E `tests/e2e/basics.spec.ts`.

**Interfaces:** Produces `export async function canonicalPath(path: string): Promise<string>` — existing file → `fs.promises.realpath(path)` (native variant: `fs.realpath.native`); missing file → `join(await realpath(dirname(path)), basename(path))`; missing folder → `resolve(path)`.

- [ ] **Step 1: Failing tests:** symlinked folder and the direct folder give the same canonical path; on case-insensitive volumes (detect at test time by creating `a.md` and statting `A.md`; skip otherwise) `A.MD` canonicalises to the stored `a.md`; a missing new note under a symlinked folder canonicalises its folder; `AppContext.openPaths` with two spellings of one file sends one canonical path and the allowlist accepts both spellings' canonical form only.
- [ ] **Step 2: Implement:** every path entering main (CLI args, `second-instance`, macOS `open-file`, open dialog, session restore, `newNotePath`, rename result) is canonicalised before `allow()`, `watcher.setFiles()`, or being sent to the renderer. `assertAllowed()` canonicalises the incoming path before the lookup (a renderer-supplied path that canonicalises to an allowed one is fine). Session restore drops duplicates after canonicalisation (keep the first, merge `headerHidden` by keeping the first).
- [ ] **Step 3: E2E** (`basics.spec.ts`): open a note via a symlinked folder path and via its real path (two `rf-write` args) → one tab. On macOS also `/tmp/...` vs `/private/tmp/...` is covered by `makeDirs()` realpath already — add the symlink case.
- [ ] **Step 4: Gate, commit** — `fix(files): canonical paths so one file never opens in two tabs`

---

### Task 2: External changes that cannot be loaded (not UTF-8, deleted)

**Files:** `src/main/watcher.ts`, `src/shared/types.ts` (`ExternalChange` union), `src/shared/ipc.ts`/`preload` (payload type only), `src/renderer/app.ts`, tests `tests/unit/main/watcher.test.ts`, E2E `tests/e2e/editing.spec.ts` (or a new `external.spec.ts`).

**Interfaces:** `export type ExternalChange = { kind: 'changed'; note: NoteFile } | { kind: 'unreadable'; path: string; reason: 'encoding' | 'error'; message: string } | { kind: 'deleted'; path: string }`. `onExternalChange(cb: (change: ExternalChange) => void)`.

Behaviour:
- Watcher `check()`: `NotUtf8Error` → `unreadable/encoding` (once per distinct on-disk hash, using the raw bytes' hash so a repeated event for the same bytes is not reported twice); `ENOENT` → `deleted` (once until the file reappears); other read errors → `unreadable/error` once.
- Renderer: for `unreadable` and `deleted`, the tab is held exactly like a conflict (no autosave, status shows the warning) regardless of dirty state, with a banner:
  - unreadable: „„x.md“ wurde außerhalb geändert und ist kein gültiges UTF-8. rf-write speichert nicht darüber.“ Actions: „Meine Fassung speichern (überschreiben)“ → clears the hold and saves; „Tab schließen“ → closes the tab without saving (no discard prompt for this choice — the user just chose it).
  - deleted: „„x.md“ wurde außerhalb gelöscht.“ Actions: „Erneut speichern“ → clears the hold and saves (recreates); „Tab schließen“.
  - a later `changed` event for a held path replaces the hold with the normal conflict/reload logic.
- [ ] **Steps:** failing watcher tests (invalid UTF-8 written externally → one `unreadable` event; same bytes again → no second event; delete → one `deleted`; recreate with valid text → `changed`), failing renderer/E2E (external ANSI write while clean → banner, no autosave overwrite after typing; „Meine Fassung speichern“ writes UTF-8), implement, gate, commit — `fix(watch): report unreadable and deleted notes instead of ignoring them`

---

### Task 3: Watcher re-arms after a folder error

**Files:** `src/main/watcher.ts` (inject `watch` + timers for tests), `tests/unit/main/watcher.test.ts`.

Behaviour: when a directory watcher errors or `watch()` throws for a needed folder, retry with backoff 1 s, 2 s, 4 s … capped at 30 s while the folder is still needed; on success, re-check every watched file in that folder once (an external change during the gap is still reported). `setFiles()` cancels retries for folders no longer needed; `close()` cancels all.
- [ ] **Steps:** failing tests with a fake `watch` that throws twice then succeeds (fake timers): retries at 1 s and 2 s, then a `check` of each file; a folder removed from `setFiles` stops retrying; implement, gate, commit — `fix(watch): re-arm a failed folder watcher with backoff`

---

### Task 4: Closing while typing never loses keystrokes

**Files:** `src/renderer/app.ts` (`beforeClose`), `src/renderer/editor/setup.ts` or `mode.ts` (a `closingCompartment` / `EditorState.readOnly` + `EditorView.editable` switch), tests (unit for the freeze helper; E2E in `editing.spec.ts`).

Behaviour: `beforeClose()` first freezes input on every tab (`EditorView.editable.of(false)` and `EditorState.readOnly.of(true)` via a compartment on the shown view; stored states of other tabs cannot receive input anyway), then flushes and saves until no tab is dirty or a save fails. Success → close. Failure → discard prompt; if the user cancels, unfreeze. No round limit is needed once input is frozen (keep a safety cap of 10 rounds that then falls back to the discard prompt, never to `true`).
- [ ] **Steps:** failing test: simulate typing between save rounds (a fake `saveAll` that makes the tab dirty again unless frozen) → `beforeClose` returns `true` only when the tab is clean; with a failing save → prompt; cancel → editable again. E2E: type continuously with `page.keyboard.type` in a loop while triggering close → after close the file contains every typed character up to the freeze. Commit — `fix(close): freeze input while closing so every keystroke is saved or confirmed`

---

### Task 5: Present/fullscreen residuals

**Files:** `src/main/fullscreen.ts`, `src/main/ipc.ts`, `src/main/menu.ts`, `src/renderer/app.ts`, tests `tests/unit/main/fullscreen.test.ts`, `tests/unit/main/menu.test.ts`, E2E `tests/e2e/present.spec.ts`.

- **Refused enter:** after an app-requested `setFullScreen(true)`, if neither `enter-full-screen` fires nor `isFullScreen()` is true within 2 s, reset the owner's intent (`pendingLeaves = 0`, not app-owned) and tell the renderer through a new event `fullScreenRefused`. Present keeps running windowed and shows the toast „Vollbild nicht verfügbar – Präsentation im Fenster“ (ruling: a meeting must not lose Present because the OS refused fullscreen). Test with a fake window that never enters.
- **Toggle during the enter animation:** instead of dropping a second `toggle-present` while a request is in flight, remember the latest intent and apply it when the in-flight request settles (last intent wins). Unit test the renderer queue (or the helper it uses).
- **Repeat guard:** only suppress `toggle-present` repeats when the previous press was < 500 ms ago **and** the key is still held — Electron has no repeat flag, so lower the window to 250 ms (auto-repeat starts at ≥ 250 ms on all three OSes) and document why. Test: presses 300 ms apart both toggle.
- **Esc with multiple selections in Present:** first Esc collapses the selection (CodeMirror), second leaves Present. E2E pin.
- [ ] **Steps:** failing tests first for each bullet, implement, gate, commit — `fix(present): recover from refused fullscreen; last toggle wins; shorter repeat guard`

---

### Task 6: E2E traces and docs

**Files:** `tests/e2e/helpers.ts` (start `app.context().tracing.start({ screenshots: true, snapshots: true })` in `launch`; a `test.afterEach` hook in a shared fixture or each spec that stops tracing to `test-results/traces/<test>.zip` only on failure), `playwright.config.ts` (remove the ineffective `use.trace`), `CHANGELOG.md` (`Fixed` section), `README.md`/`README.en.md` only if behaviour visible to users changed (external-change banners), local `CLAUDE.md`.
- [ ] **Steps:** verify with a deliberately failing local test that a trace zip is written (then delete the test), gate incl. full E2E, commit — `test(e2e): real traces on failure; changelog for the pre-release fixes`

CHANGELOG `Fixed`: "A note opened under two path spellings (symlink, case, 8.3 name) uses one tab", "External changes that are not UTF-8 or delete the note are reported and never silently overwritten", "A failed folder watcher re-arms itself", "Closing while typing saves every keystroke or asks", "Present recovers when the OS refuses fullscreen; fast toggles keep the last intent".

## Not in this plan (manual or upstream)

- Manual on a German Windows keyboard: AltGr `[`/`]`, Ctrl+`+`/numpad zoom (one step per press), Ctrl+Shift+P held, menu bar after Present from user fullscreen — done by the user after the Distribution plan provides an installer.
- rf-document on Windows not finding typst right after winget install — upstream in real-fast-document.
- App name "Electron" in dev mode and the header-default preference — Distribution plan (packaging + settings dialog).

---

### Task 7: App name "rf-write" in development on macOS (user request 2026-10-15)

**Files:** Create `scripts/dev-app-name.mjs`; modify `package.json` (`"postinstall": "node scripts/dev-app-name.mjs"`), `tests/unit/scripts/dev-app-name.test.ts`, README de/en Development section (one line), CHANGELOG `Fixed`.

Behaviour:
- On macOS only (`process.platform === 'darwin'`), set `CFBundleName` and `CFBundleDisplayName` in `node_modules/electron/dist/Electron.app/Contents/Info.plist` to the `productName` from `package.json` (`rf-write`). Elsewhere: exit 0 without doing anything.
- Use `/usr/bin/plutil -replace CFBundleName -string <name> <plist>` (and the same for `CFBundleDisplayName`) via `execFileSync` (no shell). Idempotent. Missing Electron (e.g. `--ignore-scripts`, optional deps) → print a one-line notice and exit 0; never fail `npm install`/`npm ci`.
- Then `touch` the `.app` bundle directory so LaunchServices refreshes the cached name.
- Do not rename the bundle or the binary (electron's `path.txt` must stay valid; `require('electron')` returns the binary path).
- Test: the pure function that computes the plutil argument lists from `package.json` and the plist path, plus a darwin-only integration test on a temp copy of an Info.plist (skipped on other OSes). Manual check: `npm run dev` shows "rf-write" in the menu bar, Dock and Cmd-Tab (after quitting any running dev instance).

Commit: `fix(dev): show rf-write instead of Electron as the app name on macOS`

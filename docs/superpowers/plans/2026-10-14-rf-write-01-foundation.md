# rf-write Plan 1 – Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Electron app with tabs, a Markdown code view, autosave with atomic writes, rename, single instance, session restore, file watching and PDF export through rf-document, tested on macOS, Windows and Linux in CI.

**Architecture:**
- The main process owns the disk, processes, menus and the window. The sandboxed renderer owns the text, in one CodeMirror `EditorView` with one `EditorState` per tab.
- The typed preload bridge `window.rfw` is the only connection between them.
- Pure modules (files, rename, locate, export, store, cli, menu, watcher, tab store, autosave, editor setup) are unit-tested. The Electron wiring is covered by Playwright end-to-end tests.

**Tech Stack:** Electron 44, electron-vite 6, Vite 8, TypeScript 7 (strict), CodeMirror 6 (`@codemirror/*`, `@lezer/markdown`), Biome 2, Vitest 5 (+ happy-dom, coverage-v8), Playwright 1.64 (Electron).

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md`

### Roadmap (one plan each, in order)

1. **Foundation**: this plan.
2. **Preview**: theme from `rfdoc-zettlr.css`, fonts via `rfw-font://`, preview decorations, Code/Preview switch, YAML header toggle, section folding.
3. **Present**: fullscreen, info line, zoom, Present font factor, hidden header.
4. **Snippets**: parser, `:` completion, built-in and user snippets, `:header` key check against rf-document.
5. **Distribution**: settings dialog, bootstrap scripts, release archives, `scripts/release.sh`, release workflow.

## Global Constraints

- **Author identity:** `jcmx9` everywhere (package.json, LICENSE, git). Never the real name.
- **Commit messages:** Conventional Commits in English. **No** `Co-Authored-By` or other AI attribution lines.
- **Branches:** work on `feature/foundation` (from `dev`) and open a PR into `dev`. No direct pushes to `main`.
- **Version:** CalVer, with `package.json` `version` as the single source. Start at `26.10.0-dev.0`.
- **Node:** ≥ 22.12 (Electron 44 requirement). CI uses Node 24.
- **Renderer security:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no remote content, navigation and `window.open` denied.
- **Byte-exact files:** what is on disk changes only by what the user typed. BOM, line endings and invalid UTF-8 are never altered silently.
- **Child processes:** `spawn` without a shell. A Windows `.cmd` file is the only exception and runs via `cmd.exe /d /s /c` with explicit quoting.
- **Language:** German UI strings, English code, comments and docs.
- **README parity:** `README.md` (de) and `README.en.md` (en) have identical content and link to each other.
- **No `rf-document` features are re-implemented.** rf-document picks the PDF name, reads options from front matter and opens the PDF.

## Review Focus

1. **A CRLF file, a file with a BOM, or a file with mixed line endings** must round-trip byte-exact when it is edited and saved. Tests: Task 2 (`readNote`/`writeNote`), Task 11 (`serializeDoc`), Task 14 (E2E with CRLF + BOM).
2. **A file that is not valid UTF-8** must be refused, not opened lossily and saved back. Test: Task 2.
3. **A note that is a symlink** must be written through the link, which keeps the link intact. Test: Task 2.
4. **Rename to an existing name, or a case-only rename** (`notiz.md` → `Notiz.md`) must never overwrite another file. Test: Task 3.
5. **Typing while a save is in flight** must leave the tab dirty, and the next autosave must save the rest. Tests: Task 12 (`markSaved` with an older doc), Task 13 (chained runs).

## File Structure

```
package.json, tsconfig.json, biome.json, vitest.config.ts, playwright.config.ts,
electron.vite.config.ts, .gitignore, LICENSE
src/shared/types.ts        all cross-process types (NoteFile, Settings, Session, results, RfwApi)
src/shared/ipc.ts          IPC channel names (Ch)
src/preload/index.ts       contextBridge → window.rfw
src/main/index.ts          entry: userData override, CLI, single-instance, app events
src/main/context.ts        AppContext: settings, session, allowed paths, window, menu, export cache
src/main/ipc.ts            ipcMain handlers (thin, validate input, delegate)
src/main/window.ts         BrowserWindow factory with hardened webPreferences
src/main/files.ts          timestamp names, readNote, atomic write, rename
src/main/locate.ts         rf-document candidates + lookup
src/main/export.ts         run rf-document, collect result
src/main/store.ts          settings/session defaults, sanitizing, JSON load/save
src/main/cli.ts            argv parsing, help text, recent list
src/main/menu.ts           native menu template (pure)
src/main/watcher.ts        directory watchers, external change detection
src/renderer/index.html, main.ts, styles.css, env.d.ts
src/renderer/app.ts        App controller (tabs ↔ editor ↔ IPC ↔ UI)
src/renderer/editor/setup.ts     EditorState factory, view compartment, EOL handling
src/renderer/editor/autosave.ts  AutosaveScheduler
src/renderer/tabs/tab-store.ts   TabStore
src/renderer/ui/tabbar.ts, statusline.ts, notices.ts, prompt.ts
src/renderer/util/path.ts  fileName()
tests/helpers/fake-rf-document.ts
tests/unit/**              Vitest
tests/e2e/**               Playwright (Electron)
.github/workflows/ci.yml, .github/dependabot.yml, CODEOWNERS
README.md, README.en.md, CHANGELOG.md, CONTRIBUTING.md, SECURITY.md
```

---

### Task 1: Repository, toolchain, shared types and an empty window

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `electron.vite.config.ts`, `.gitignore`, `LICENSE`
- Create: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`
- Create: `src/main/index.ts` (temporary minimal version, replaced in Task 10)
- Create: `src/renderer/index.html`, `src/renderer/main.ts` (temporary), `src/renderer/env.d.ts`
- Test: `tests/unit/shared/ipc.test.ts`

**Interfaces:**
- Produces: every type in `src/shared/types.ts` and `Ch` in `src/shared/ipc.ts`, exactly as written below. All later tasks import from them.

- [ ] **Step 1: Initialise git and branches**

Ask the user to confirm before creating the GitHub repository. The local steps run without confirmation:

```bash
cd ~/GitHub/real-fast-write
git init -b main
git config user.name jcmx9
git config user.email jcmx9@tutamail.com
git add PROMPT.md CLAUDE.md docs/
git commit -m "docs: add project brief, spec and foundation plan"
git checkout -b dev
git checkout -b feature/foundation
```

After the user confirms, create the remote. Ask whether it should be public or private:

```bash
gh repo create jcmx9/real-fast-write --public --source . --remote origin
git push -u origin main dev
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "real-fast-write",
  "productName": "rf-write",
  "version": "26.10.0-dev.0",
  "description": "Calm Markdown editor that looks like the real-fast-document PDF while you type.",
  "license": "MIT",
  "author": "jcmx9",
  "homepage": "https://github.com/jcmx9/real-fast-write",
  "repository": { "type": "git", "url": "git+https://github.com/jcmx9/real-fast-write.git" },
  "main": "./out/main/index.js",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "lint": "biome check .",
    "format": "biome check --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "electron-vite build && playwright test"
  }
}
```

- [ ] **Step 3: Install dependencies**

Everything is a devDependency. The renderer bundles CodeMirror, and the main process has no runtime dependencies.

```bash
npm install -D electron@^44.7.2 electron-vite@^6.0.0 vite@^8.3.4 typescript@^7.0.2 \
  @biomejs/biome@^2.5.15 vitest@^5.0.4 @vitest/coverage-v8@^5.0.4 happy-dom \
  @playwright/test@^1.64.1 @types/node@^24 \
  @codemirror/state@^6.7.6 @codemirror/view@^6.43.14 @codemirror/commands@^6.11.1 \
  @codemirror/language@^6.13.1 @codemirror/lang-markdown@^6.5.2 @lezer/markdown@^1.8.0
```

Expected: `package-lock.json` is created and there are no peer-dependency errors.

- [ ] **Step 4: Write the config files**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src", "tests", "*.config.ts"]
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded" } },
  "linter": { "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/renderer/**/*.ts', 'src/shared/**/*.ts'],
      // Electron/DOM wiring is covered by the Playwright suite.
      exclude: [
        'src/main/index.ts',
        'src/main/context.ts',
        'src/main/ipc.ts',
        'src/main/window.ts',
        'src/renderer/main.ts',
        'src/renderer/app.ts',
        'src/renderer/ui/**',
        'src/renderer/env.d.ts',
      ],
      thresholds: { lines: 80, branches: 80 },
    },
  },
})
```

`electron.vite.config.ts`. The defaults already cover `src/main/index.ts`, `src/preload/index.ts` and `src/renderer/index.html`:

```ts
import { defineConfig } from 'electron-vite'

export default defineConfig({ main: {}, preload: {}, renderer: {} })
```

`.gitignore`:

```gitignore
node_modules/
out/
dist/
coverage/
test-results/
playwright-report/
*.log
.DS_Store
Thumbs.db
.env
.vscode/
.idea/
```

`LICENSE`: the MIT text from the global template, with the line `Copyright (c) 2026 jcmx9`.

- [ ] **Step 5: Write the shared types**

`src/shared/types.ts`:

```ts
/** Line-ending style of a note. 'mixed' keeps every byte as found. */
export type Eol = '\n' | '\r\n' | 'mixed'

export interface NoteFile {
  path: string
  /** Text without BOM. */
  text: string
  bom: boolean
  eol: Eol
  /** sha256 of the bytes on disk. */
  hash: string
}

export interface Settings {
  defaultFolder: string
  snippetFolder: string
  /** Empty = locate automatically. */
  rfDocumentPath: string
  presentFontFactor: number
}

export type Mode = 'edit' | 'present'
export type View = 'code' | 'preview'

export interface SessionTab {
  path: string
  headerHidden: boolean
}

export interface Session {
  tabs: SessionTab[]
  activeIndex: number
  mode: Mode
  view: View
  zoom: { edit: number; present: number }
  recent: string[]
}

export type SessionPatch = Partial<Pick<Session, 'tabs' | 'activeIndex' | 'mode' | 'view' | 'zoom'>>

export interface StartupState {
  session: Session
  openPaths: string[]
  settings: Settings
}

export type SaveResult = { ok: true; hash: string } | { ok: false; error: string }
export type RenameResult = { ok: true; path: string } | { ok: false; error: string }
export type ExportResult =
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; code: number | null; stderr: string }
  | { kind: 'not-found'; searched: string[] }

export type MenuCommand =
  | 'new'
  | 'open'
  | 'rename'
  | 'close-tab'
  | 'export'
  | 'next-tab'
  | 'prev-tab'
  | 'undo'
  | 'redo'

export interface RfwApi {
  startup(): Promise<StartupState>
  readNote(path: string): Promise<NoteFile | { error: string }>
  newNotePath(): Promise<string>
  releasePath(path: string): Promise<void>
  saveNote(path: string, text: string, bom: boolean): Promise<SaveResult>
  renameNote(from: string, newName: string): Promise<RenameResult>
  showOpenDialog(): Promise<string[]>
  exportPdf(path: string): Promise<ExportResult>
  saveSession(patch: SessionPatch): Promise<void>
  watch(paths: string[]): Promise<void>
  confirmDiscard(names: string[]): Promise<boolean>
  onMenu(cb: (cmd: MenuCommand) => void): void
  onOpenPaths(cb: (paths: string[]) => void): void
  onExternalChange(cb: (note: NoteFile) => void): void
  /** cb resolves true when the window may close. */
  onBeforeClose(cb: () => Promise<boolean>): void
}
```

`src/shared/ipc.ts`:

```ts
export const Ch = {
  startup: 'rfw:startup',
  readNote: 'rfw:read-note',
  newNotePath: 'rfw:new-note-path',
  releasePath: 'rfw:release-path',
  saveNote: 'rfw:save-note',
  renameNote: 'rfw:rename-note',
  openDialog: 'rfw:open-dialog',
  exportPdf: 'rfw:export-pdf',
  saveSession: 'rfw:save-session',
  watch: 'rfw:watch',
  confirmDiscard: 'rfw:confirm-discard',
  menu: 'rfw:menu',
  openPaths: 'rfw:open-paths',
  externalChange: 'rfw:external-change',
  beforeClose: 'rfw:before-close',
  closeReady: 'rfw:close-ready',
} as const
```

- [ ] **Step 6: Write the failing test for the channel table**

`tests/unit/shared/ipc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Ch } from '../../../src/shared/ipc'

describe('IPC channels', () => {
  it('are unique and namespaced', () => {
    const values = Object.values(Ch)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^rfw:[a-z-]+$/)
  })
})
```

Run: `npx vitest run tests/unit/shared/ipc.test.ts`
Expected: PASS. The table already exists, so this test guards later edits; there is no red phase.

- [ ] **Step 7: Preload bridge**

`src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { Ch } from '../shared/ipc'
import type { MenuCommand, NoteFile, RfwApi } from '../shared/types'

const api: RfwApi = {
  startup: () => ipcRenderer.invoke(Ch.startup),
  readNote: (path) => ipcRenderer.invoke(Ch.readNote, path),
  newNotePath: () => ipcRenderer.invoke(Ch.newNotePath),
  releasePath: (path) => ipcRenderer.invoke(Ch.releasePath, path),
  saveNote: (path, text, bom) => ipcRenderer.invoke(Ch.saveNote, path, text, bom),
  renameNote: (from, newName) => ipcRenderer.invoke(Ch.renameNote, from, newName),
  showOpenDialog: () => ipcRenderer.invoke(Ch.openDialog),
  exportPdf: (path) => ipcRenderer.invoke(Ch.exportPdf, path),
  saveSession: (patch) => ipcRenderer.invoke(Ch.saveSession, patch),
  watch: (paths) => ipcRenderer.invoke(Ch.watch, paths),
  confirmDiscard: (names) => ipcRenderer.invoke(Ch.confirmDiscard, names),
  onMenu: (cb) => {
    ipcRenderer.on(Ch.menu, (_e, cmd: MenuCommand) => cb(cmd))
  },
  onOpenPaths: (cb) => {
    ipcRenderer.on(Ch.openPaths, (_e, paths: string[]) => cb(paths))
  },
  onExternalChange: (cb) => {
    ipcRenderer.on(Ch.externalChange, (_e, note: NoteFile) => cb(note))
  },
  onBeforeClose: (cb) => {
    ipcRenderer.on(Ch.beforeClose, async () => {
      let ok = false
      try {
        ok = await cb()
      } finally {
        ipcRenderer.send(Ch.closeReady, ok)
      }
    })
  },
}

contextBridge.exposeInMainWorld('rfw', api)
```

`src/renderer/env.d.ts`:

```ts
import type { RfwApi } from '../shared/types'

declare global {
  interface Window {
    rfw: RfwApi
  }
}
```

- [ ] **Step 8: Temporary main and renderer (replaced in Tasks 10 and 14)**

`src/main/index.ts`:

```ts
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
```

`src/renderer/index.html`. This is the final version and is kept:

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' rfw-font:; img-src 'self' data:"
    />
    <title>rf-write</title>
  </head>
  <body>
    <div id="app">
      <nav id="tabbar" role="tablist"></nav>
      <main id="workspace">
        <div id="editor"></div>
        <div id="empty" hidden>
          <p>Keine Notiz geöffnet.</p>
          <button type="button" data-action="new">Neue Notiz</button>
          <button type="button" data-action="open">Öffnen …</button>
        </div>
      </main>
      <footer id="status"></footer>
    </div>
    <div id="notices" aria-live="polite"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/renderer/main.ts` (temporary):

```ts
document.getElementById('status')?.append('rf-write')
```

- [ ] **Step 9: Verify the toolchain**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass, and `out/main/index.js`, `out/preload/index.js` and `out/renderer/index.html` exist.

Run: `npm run dev`
Expected: a window opens with "rf-write" at the bottom. Close it.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "chore: scaffold electron-vite project with shared IPC types"
```

---

### Task 2: Note files – naming, reading, atomic writing

**Files:**
- Create: `src/main/files.ts`
- Test: `tests/unit/main/files.test.ts`

**Interfaces:**
- Consumes: `Eol`, `NoteFile` from `src/shared/types.ts`
- Produces:
  - `timestampName(now: Date): string`
  - `newNotePath(dir: string, now: Date, reserved: ReadonlySet<string>): Promise<string>`
  - `detectEol(text: string): Eol`
  - `hashBytes(bytes: Uint8Array): string`
  - `noteBytes(text: string, bom: boolean): Buffer`
  - `readNote(path: string): Promise<NoteFile>`
  - `writeFileAtomic(path: string, data: Uint8Array, deps?: AtomicDeps): Promise<void>`
  - `writeNoteBytes(path: string, bytes: Uint8Array): Promise<void>`
  - `writeNote(path: string, text: string, bom: boolean): Promise<string>` (returns the hash)
  - `interface AtomicDeps { rename(from: string, to: string): Promise<void>; sleep(ms: number): Promise<void> }`
  - `class NotUtf8Error extends Error`

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/files.test.ts`:

```ts
import { lstat, mkdtemp, readdir, readFile, readlink, stat, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  detectEol,
  hashBytes,
  newNotePath,
  NotUtf8Error,
  noteBytes,
  readNote,
  timestampName,
  writeFileAtomic,
  writeNote,
} from '../../../src/main/files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-files-'))
})

const posixOnly = process.platform === 'win32' ? it.skip : it

describe('timestampName', () => {
  it('formats local time with zero padding', () => {
    expect(timestampName(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02_03-04-05.md')
  })
})

describe('newNotePath', () => {
  const now = new Date(2026, 9, 14, 9, 30, 0)

  it('creates the folder and returns the timestamp name', async () => {
    const folder = join(dir, 'neu', 'tief')
    expect(await newNotePath(folder, now, new Set())).toBe(join(folder, '2026-10-14_09-30-00.md'))
    expect((await stat(folder)).isDirectory()).toBe(true)
  })

  it('appends _2, _3 when the name exists on disk or is reserved', async () => {
    await writeFile(join(dir, '2026-10-14_09-30-00.md'), '')
    const reserved = new Set([join(dir, '2026-10-14_09-30-00_2.md')])
    expect(await newNotePath(dir, now, reserved)).toBe(join(dir, '2026-10-14_09-30-00_3.md'))
  })
})

describe('detectEol', () => {
  it.each([
    ['', '\n'],
    ['a\nb\n', '\n'],
    ['a\r\nb\r\n', '\r\n'],
    ['a\r\nb\n', 'mixed'],
    ['a\rb', 'mixed'],
  ] as const)('%j → %j', (text, eol) => {
    expect(detectEol(text)).toBe(eol)
  })
})

describe('readNote / writeNote', () => {
  it('strips and reports a BOM, keeps CRLF, hashes the raw bytes', async () => {
    const path = join(dir, 'bom.md')
    const bytes = Buffer.from('﻿# Titel\r\nText\r\n', 'utf8')
    await writeFile(path, bytes)
    const note = await readNote(path)
    expect(note).toEqual({ path, text: '# Titel\r\nText\r\n', bom: true, eol: '\r\n', hash: hashBytes(bytes) })
  })

  it('round-trips byte-exact', async () => {
    const path = join(dir, 'rt.md')
    const original = Buffer.from('﻿a\r\nb\nc\rd', 'utf8')
    await writeFile(path, original)
    const note = await readNote(path)
    const hash = await writeNote(path, note.text, note.bom)
    expect(Buffer.compare(await readFile(path), original)).toBe(0)
    expect(hash).toBe(hashBytes(original))
  })

  it('refuses invalid UTF-8', async () => {
    const path = join(dir, 'latin1.md')
    await writeFile(path, Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))
    await expect(readNote(path)).rejects.toBeInstanceOf(NotUtf8Error)
  })

  it('creates a new file and leaves no temp files', async () => {
    const path = join(dir, 'neu.md')
    await writeNote(path, 'Hallo', false)
    expect(await readFile(path, 'utf8')).toBe('Hallo')
    expect(await readdir(dir)).toEqual(['neu.md'])
  })

  posixOnly('writes through a symlink and keeps the link', async () => {
    const target = join(dir, 'echt.md')
    const link = join(dir, 'link.md')
    await writeFile(target, 'alt')
    await symlink(target, link)
    await writeNote(link, 'neu', false)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readlink(link)).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('neu')
  })

  posixOnly('keeps the file mode', async () => {
    const path = join(dir, 'mode.md')
    await writeFile(path, 'x')
    await chmod(path, 0o600)
    await writeNote(path, 'y', false)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('writeFileAtomic', () => {
  it('retries EBUSY and then succeeds', async () => {
    const path = join(dir, 'retry.md')
    let calls = 0
    const { rename } = await import('node:fs/promises')
    await writeFileAtomic(path, noteBytes('ok', false), {
      rename: async (a, b) => {
        calls++
        if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        await rename(a, b)
      },
      sleep: async () => undefined,
    })
    expect(calls).toBe(3)
    expect(await readFile(path, 'utf8')).toBe('ok')
  })

  it('keeps the original and removes the temp file when the rename fails', async () => {
    const path = join(dir, 'orig.md')
    await writeFile(path, 'original')
    await expect(
      writeFileAtomic(path, noteBytes('neu', false), {
        rename: async () => {
          throw Object.assign(new Error('io'), { code: 'EIO' })
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('io')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(await readdir(dir)).toEqual(['orig.md'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/files.test.ts`
Expected: FAIL, because `src/main/files.ts` cannot be resolved.

- [ ] **Step 3: Implement**

`src/main/files.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Eol, NoteFile } from '../shared/types'

const BOM = '﻿'
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const MAX_RETRIES = 5
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export class NotUtf8Error extends Error {
  constructor(path: string) {
    super(`„${basename(path)}“ ist kein gültiges UTF-8 und wird nicht geöffnet, damit die Datei unverändert bleibt.`)
    this.name = 'NotUtf8Error'
  }
}

export interface AtomicDeps {
  rename(from: string, to: string): Promise<void>
  sleep(ms: number): Promise<void>
}

const defaultDeps: AtomicDeps = {
  rename: (from, to) => fs.rename(from, to),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export function timestampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
  const time = `${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
  return `${date}_${time}.md`
}

export async function newNotePath(
  dir: string,
  now: Date,
  reserved: ReadonlySet<string>,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true })
  const name = timestampName(now)
  const stem = name.slice(0, -'.md'.length)
  for (let i = 1; ; i++) {
    const candidate = join(dir, i === 1 ? name : `${stem}_${i}.md`)
    if (!reserved.has(candidate) && !(await exists(candidate))) return candidate
  }
}

export function detectEol(text: string): Eol {
  const cr = text.split('\r').length - 1
  if (cr === 0) return '\n'
  const lf = text.split('\n').length - 1
  const crlf = text.split('\r\n').length - 1
  return crlf === lf && crlf === cr ? '\r\n' : 'mixed'
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function noteBytes(text: string, bom: boolean): Buffer {
  return Buffer.from((bom ? BOM : '') + text, 'utf8')
}

export async function readNote(path: string): Promise<NoteFile> {
  const bytes = await fs.readFile(path)
  let raw: string
  try {
    raw = decoder.decode(bytes)
  } catch {
    throw new NotUtf8Error(path)
  }
  const bom = raw.startsWith(BOM)
  const text = bom ? raw.slice(1) : raw
  return { path, text, bom, eol: detectEol(text), hash: hashBytes(bytes) }
}

/** Writes via temp file + fsync + rename; never leaves a half-written target. */
export async function writeFileAtomic(
  path: string,
  data: Uint8Array,
  deps: AtomicDeps = defaultDeps,
): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const mode = await fs.stat(path).then(
    (s) => s.mode & 0o777,
    () => undefined,
  )
  const handle = await fs.open(tmp, 'wx', mode)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } catch (err) {
    await handle.close()
    await fs.rm(tmp, { force: true })
    throw err
  }
  await handle.close()
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await deps.rename(tmp, path)
        return
      } catch (err) {
        const code = errorCode(err)
        if (attempt >= MAX_RETRIES || code === undefined || !RETRY_CODES.has(code)) throw err
        await deps.sleep(50 * 2 ** attempt)
      }
    }
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

async function realTarget(path: string): Promise<string> {
  try {
    return await fs.realpath(path)
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return path
    throw err
  }
}

export async function writeNoteBytes(path: string, bytes: Uint8Array): Promise<void> {
  await writeFileAtomic(await realTarget(path), bytes)
}

export async function writeNote(path: string, text: string, bom: boolean): Promise<string> {
  const bytes = noteBytes(text, bom)
  await writeNoteBytes(path, bytes)
  return hashBytes(bytes)
}
```

`fs.open(tmp, 'wx', mode)` applies the umask to `mode`, so the test sets `0o600`, which no umask changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/files.test.ts`
Expected: PASS. The symlink and mode tests are skipped on Windows.

- [ ] **Step 5: Commit**

```bash
git add src/main/files.ts tests/unit/main/files.test.ts
git commit -m "feat(files): add timestamp names, byte-exact reading and atomic writes"
```

---

### Task 3: Rename without overwrite

**Files:**
- Modify: `src/main/files.ts` (append)
- Test: `tests/unit/main/rename.test.ts`

**Interfaces:**
- Consumes: `exists`, `errorCode` from Task 2
- Produces:
  - `class RenameError extends Error`
  - `validateNewName(name: string): string` (returns the name with `.md`)
  - `renameNote(from: string, newName: string): Promise<string>` (returns the new absolute path)

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/rename.test.ts`:

```ts
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RenameError, renameNote, validateNewName } from '../../../src/main/files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-rename-'))
})

describe('validateNewName', () => {
  it.each([
    ['Kickoff', 'Kickoff.md'],
    ['  Kickoff.md ', 'Kickoff.md'],
    ['Notiz.MD', 'Notiz.MD'],
  ])('%j → %j', (input, out) => expect(validateNewName(input)).toBe(out))

  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'a?b', 'a*b', 'a<b', 'a|b', 'a"b', 'tab\tname'])(
    'rejects %j',
    (input) => expect(() => validateNewName(input)).toThrow(RenameError),
  )
})

describe('renameNote', () => {
  it('renames within the same folder', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A')
    const to = await renameNote(from, 'Kickoff')
    expect(to).toBe(join(dir, 'Kickoff.md'))
    expect(await readdir(dir)).toEqual(['Kickoff.md'])
    expect(await readFile(to, 'utf8')).toBe('A')
  })

  it('never overwrites an existing file', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A')
    await writeFile(join(dir, 'b.md'), 'B')
    await expect(renameNote(from, 'b')).rejects.toThrow(/existiert bereits/)
    expect(await readFile(from, 'utf8')).toBe('A')
    expect(await readFile(join(dir, 'b.md'), 'utf8')).toBe('B')
  })

  it('supports a case-only rename', async () => {
    const from = join(dir, 'notiz.md')
    await writeFile(from, 'N')
    const to = await renameNote(from, 'Notiz')
    expect(await readdir(dir)).toEqual(['Notiz.md'])
    expect(await readFile(to, 'utf8')).toBe('N')
  })

  it('refuses a case-only rename onto a different existing file (case-sensitive FS)', async () => {
    await writeFile(join(dir, 'x.md'), 'lower')
    await writeFile(join(dir, 'X.md'), 'upper')
    const caseSensitive = (await readdir(dir)).length === 2
    if (!caseSensitive) return
    await expect(renameNote(join(dir, 'x.md'), 'X')).rejects.toThrow(RenameError)
    expect(await readFile(join(dir, 'X.md'), 'utf8')).toBe('upper')
  })

  it('returns the same path when the name is unchanged', async () => {
    const from = join(dir, 'same.md')
    await writeFile(from, 'S')
    expect(await renameNote(from, 'same')).toBe(from)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/rename.test.ts`
Expected: FAIL, because `RenameError` is not exported.

- [ ] **Step 3: Implement (append to `src/main/files.ts`)**

```ts
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are invalid in file names
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'])

export class RenameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RenameError'
  }
}

export function validateNewName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..' || INVALID_NAME.test(trimmed)) {
    throw new RenameError(`„${name}“ ist kein gültiger Dateiname.`)
  }
  return /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)])
  return sa.ino === sb.ino && sa.dev === sb.dev
}

/** Renames in the same folder; never replaces another file. */
export async function renameNote(from: string, newName: string): Promise<string> {
  const name = validateNewName(newName)
  const to = join(dirname(from), name)
  if (to === from) return from
  const taken = () => new RenameError(`„${name}“ existiert bereits.`)

  if (to.toLowerCase() === from.toLowerCase()) {
    if ((await exists(to)) && !(await sameFile(from, to))) throw taken()
    await fs.rename(from, to)
    return to
  }
  try {
    // link() fails with EEXIST instead of replacing: an atomic no-clobber rename.
    await fs.link(from, to)
  } catch (err) {
    const code = errorCode(err)
    if (code === 'EEXIST') throw taken()
    if (code === undefined || !LINK_UNSUPPORTED.has(code)) throw err
    if (await exists(to)) throw taken()
    await fs.rename(from, to)
    return to
  }
  await fs.unlink(from)
  return to
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/rename.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/files.ts tests/unit/main/rename.test.ts
git commit -m "feat(files): rename notes without ever overwriting"
```

---

### Task 4: Locate rf-document

**Files:**
- Create: `src/main/locate.ts`
- Test: `tests/unit/main/locate.test.ts`

**Interfaces:**
- Produces:
  - `interface LocateOptions { platform: NodeJS.Platform; env: Record<string, string | undefined>; home: string; configured: string; isFile(path: string): Promise<boolean> }`
  - `candidates(o: LocateOptions): string[]`
  - `locateRfDocument(o: LocateOptions): Promise<{ found: string | null; searched: string[] }>`
  - `isExecutableFile(path: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/locate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { candidates, type LocateOptions, locateRfDocument } from '../../../src/main/locate'

const mac = (over: Partial<LocateOptions> = {}): LocateOptions => ({
  platform: 'darwin',
  env: { PATH: '/usr/bin:/bin:/usr/bin' },
  home: '/Users/u',
  configured: '',
  isFile: async () => false,
  ...over,
})

const win = (over: Partial<LocateOptions> = {}): LocateOptions => ({
  platform: 'win32',
  env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', Path: 'C:\\Tools;C:\\Bin' },
  home: 'C:\\Users\\u',
  configured: '',
  isFile: async () => false,
  ...over,
})

describe('candidates', () => {
  it('follows the spec order on macOS/Linux and dedupes PATH', () => {
    expect(candidates(mac({ configured: '/opt/x/rf-document', env: { RF_DOCUMENT: '/env/rf-document', PATH: '/usr/bin:/usr/bin' } }))).toEqual([
      '/opt/x/rf-document',
      '/env/rf-document',
      '/Users/u/.local/bin/rf-document',
      '/opt/homebrew/bin/rf-document',
      '/usr/local/bin/rf-document',
      '/usr/bin/rf-document',
    ])
  })

  it('uses WindowsApps and .cmd/.exe on Windows', () => {
    expect(candidates(win())).toEqual([
      'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\rf-document.cmd',
      'C:\\Tools\\rf-document.cmd',
      'C:\\Tools\\rf-document.exe',
      'C:\\Bin\\rf-document.cmd',
      'C:\\Bin\\rf-document.exe',
    ])
  })

  it('works without PATH', () => {
    expect(candidates(mac({ env: {} }))).toHaveLength(3)
  })
})

describe('locateRfDocument', () => {
  it('returns the first existing candidate', async () => {
    const existing = new Set(['/opt/homebrew/bin/rf-document', '/usr/bin/rf-document'])
    const r = await locateRfDocument(mac({ isFile: async (p) => existing.has(p) }))
    expect(r.found).toBe('/opt/homebrew/bin/rf-document')
  })

  it('reports everything searched when nothing exists', async () => {
    const r = await locateRfDocument(mac())
    expect(r.found).toBeNull()
    expect(r.searched).toContain('/Users/u/.local/bin/rf-document')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/locate.test.ts`
Expected: FAIL, because the module cannot be found.

- [ ] **Step 3: Implement**

`src/main/locate.ts`:

```ts
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface LocateOptions {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  /** Path from the settings; empty = not configured. */
  configured: string
  isFile(path: string): Promise<boolean>
}

/** Search order from the spec (§9). GUI apps start with a minimal PATH, so fixed paths come first. */
export function candidates(o: LocateOptions): string[] {
  const win = o.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const list: string[] = []
  if (o.configured) list.push(o.configured)
  if (o.env.RF_DOCUMENT) list.push(o.env.RF_DOCUMENT)
  if (win) {
    const local = o.env.LOCALAPPDATA ?? p.join(o.home, 'AppData', 'Local')
    list.push(p.join(local, 'Microsoft', 'WindowsApps', 'rf-document.cmd'))
  } else {
    list.push(
      p.join(o.home, '.local', 'bin', 'rf-document'),
      '/opt/homebrew/bin/rf-document',
      '/usr/local/bin/rf-document',
    )
  }
  const names = win ? ['rf-document.cmd', 'rf-document.exe'] : ['rf-document']
  const pathVar = o.env.PATH ?? o.env.Path ?? ''
  for (const dir of pathVar.split(p.delimiter).filter(Boolean)) {
    for (const name of names) list.push(p.join(dir, name))
  }
  return [...new Set(list)]
}

export async function locateRfDocument(
  o: LocateOptions,
): Promise<{ found: string | null; searched: string[] }> {
  const searched = candidates(o)
  for (const candidate of searched) {
    if (await o.isFile(candidate)) return { found: candidate, searched }
  }
  return { found: null, searched }
}

export async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) return false
    if (process.platform !== 'win32') await fs.access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/locate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/locate.ts tests/unit/main/locate.test.ts
git commit -m "feat(export): locate rf-document like a GUI app with minimal PATH"
```

---

### Task 5: Run rf-document

**Files:**
- Create: `src/main/export.ts`, `tests/helpers/fake-rf-document.ts`
- Test: `tests/unit/main/export.test.ts`

**Interfaces:**
- Consumes: `ExportResult` from shared types
- Produces:
  - `buildCommand(bin: string, note: string, platform: NodeJS.Platform, comspec?: string): { file: string; args: string[]; verbatim: boolean }`
  - `runRfDocument(bin: string, note: string, opts?: { timeoutMs?: number }): Promise<ExportResult>`
  - test helper `makeFakeRfDocument(dir: string, o?: FakeOptions): Promise<{ bin: string; argsFile: string }>` with `interface FakeOptions { stdout?: string; stderr?: string; code?: number; sleepSeconds?: number }`. Task 14 reuses it.

- [ ] **Step 1: Write the fake rf-document helper**

`tests/helpers/fake-rf-document.ts`:

```ts
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FakeOptions {
  stdout?: string
  stderr?: string
  code?: number
  sleepSeconds?: number
}

/** Writes a stand-in for rf-document that records its first argument. Keep messages ASCII (cmd.exe code pages). */
export async function makeFakeRfDocument(
  dir: string,
  o: FakeOptions = {},
): Promise<{ bin: string; argsFile: string }> {
  const argsFile = join(dir, 'args.txt')
  if (process.platform === 'win32') {
    const bin = join(dir, 'rf-document.cmd')
    const lines = ['@echo off', `>"${argsFile}" echo %~1`]
    if (o.sleepSeconds) lines.push(`ping -n ${o.sleepSeconds + 1} 127.0.0.1 >nul`)
    if (o.stdout) lines.push(`echo ${o.stdout}`)
    if (o.stderr) lines.push(`echo ${o.stderr} 1>&2`)
    lines.push(`exit /b ${o.code ?? 0}`)
    await writeFile(bin, `${lines.join('\r\n')}\r\n`)
    return { bin, argsFile }
  }
  const bin = join(dir, 'rf-document')
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const lines = ['#!/bin/sh', `printf '%s' "$1" > ${q(argsFile)}`]
  if (o.sleepSeconds) lines.push(`sleep ${o.sleepSeconds}`)
  if (o.stdout) lines.push(`printf '%s\\n' ${q(o.stdout)}`)
  if (o.stderr) lines.push(`printf '%s\\n' ${q(o.stderr)} >&2`)
  lines.push(`exit ${o.code ?? 0}`)
  await writeFile(bin, `${lines.join('\n')}\n`)
  await chmod(bin, 0o755)
  return { bin, argsFile }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/main/export.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCommand, runRfDocument } from '../../../src/main/export'
import { makeFakeRfDocument } from '../../helpers/fake-rf-document'

let dir: string
let note: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-export-'))
  note = join(dir, 'Notiz mit Leerzeichen.md')
  await writeFile(note, '# Test\n')
})

describe('buildCommand', () => {
  it('runs a binary directly on POSIX', () => {
    expect(buildCommand('/bin/rf-document', '/n/a b.md', 'darwin')).toEqual({
      file: '/bin/rf-document',
      args: ['/n/a b.md'],
      verbatim: false,
    })
  })

  it('wraps a .cmd in cmd.exe with explicit quoting', () => {
    expect(buildCommand('C:\\A B\\rf-document.cmd', 'C:\\N\\a b.md', 'win32', 'C:\\Windows\\cmd.exe')).toEqual({
      file: 'C:\\Windows\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\A B\\rf-document.cmd" "C:\\N\\a b.md""'],
      verbatim: true,
    })
  })
})

describe('runRfDocument', () => {
  it('passes the note path intact and returns the last stdout line', async () => {
    const { bin, argsFile } = await makeFakeRfDocument(dir, { stdout: 'OK erzeugt' })
    expect(await runRfDocument(bin, note)).toEqual({ kind: 'ok', message: 'OK erzeugt' })
    expect((await readFile(argsFile, 'utf8')).trim()).toBe(note)
  })

  it('returns stderr and exit code on failure', async () => {
    const { bin } = await makeFakeRfDocument(dir, { stderr: 'Fehler kaputt', code: 3 })
    expect(await runRfDocument(bin, note)).toEqual({ kind: 'failed', code: 3, stderr: 'Fehler kaputt' })
  })

  it('explains a failure without stderr', async () => {
    const { bin } = await makeFakeRfDocument(dir, { code: 2 })
    expect(await runRfDocument(bin, note)).toEqual({
      kind: 'failed',
      code: 2,
      stderr: 'rf-document endete mit Code 2.',
    })
  })

  it('reports a missing binary', async () => {
    const r = await runRfDocument(join(dir, 'gibt-es-nicht'), note)
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') expect(r.code).toBeNull()
  })

  it('kills a hanging process after the timeout', async () => {
    const { bin } = await makeFakeRfDocument(dir, { sleepSeconds: 5 })
    const r = await runRfDocument(bin, note, { timeoutMs: 300 })
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') expect(r.stderr).toMatch(/Zeitüberschreitung/)
  })

  it.skipIf(process.platform === 'win32')('handles umlauts in the path', async () => {
    const umlaut = join(dir, 'Übergabe Grüße.md')
    await writeFile(umlaut, '# Ü\n')
    const { bin, argsFile } = await makeFakeRfDocument(dir, { stdout: 'OK' })
    await runRfDocument(bin, umlaut)
    expect(await readFile(argsFile, 'utf8')).toBe(umlaut)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/export.test.ts`
Expected: FAIL, because `src/main/export.ts` is missing.

- [ ] **Step 4: Implement**

`src/main/export.ts`:

```ts
import { type ChildProcess, spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { ExportResult } from '../shared/types'

const DEFAULT_TIMEOUT_MS = 120_000

export function buildCommand(
  bin: string,
  note: string,
  platform: NodeJS.Platform,
  comspec = process.env.ComSpec ?? 'cmd.exe',
): { file: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    // /s strips the outer quotes; the inner pair keeps paths with spaces intact.
    return { file: comspec, args: ['/d', '/s', '/c', `""${bin}" "${note}""`], verbatim: true }
  }
  return { file: bin, args: [note], verbatim: false }
}

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  )
}

function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}

/** Runs `rf-document <note>`; rf-document names the PDF, reads front matter options and opens it. */
export function runRfDocument(
  bin: string,
  note: string,
  opts: { timeoutMs?: number } = {},
): Promise<ExportResult> {
  const { file, args, verbatim } = buildCommand(bin, note, process.platform)
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(file, args, {
      cwd: dirname(note),
      env: process.env,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    })
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ kind: 'failed', code: null, stderr: `rf-document konnte nicht gestartet werden: ${err.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        const seconds = Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)
        resolve({ kind: 'failed', code: null, stderr: `${stderr.trim()}\nZeitüberschreitung: rf-document wurde nach ${seconds} s abgebrochen.`.trim() })
      } else if (code === 0) {
        resolve({ kind: 'ok', message: lastLine(stdout) || 'PDF erzeugt.' })
      } else {
        resolve({ kind: 'failed', code, stderr: stderr.trim() || `rf-document endete mit Code ${code}.` })
      }
    })
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/export.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/export.ts tests/helpers/fake-rf-document.ts tests/unit/main/export.test.ts
git commit -m "feat(export): run rf-document without a shell and report its result"
```

---

### Task 6: Settings and session store

**Files:**
- Create: `src/main/store.ts`
- Test: `tests/unit/main/store.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic` (Task 2), `Settings`, `Session`, `SessionTab` types
- Produces:
  - `DEFAULT_SESSION: Session`
  - `MAX_RECENT = 10`
  - `defaultSettings(documentsDir: string): Settings`
  - `sanitizeSettings(raw: unknown, defaults: Settings): Settings`
  - `sanitizeSession(raw: unknown): Session`
  - `loadJson(path: string): Promise<unknown>`
  - `saveJson(path: string, data: unknown): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/store.test.ts`:

```ts
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION,
  defaultSettings,
  loadJson,
  sanitizeSession,
  sanitizeSettings,
  saveJson,
} from '../../../src/main/store'

const docs = resolve('/home/u/Documents')
const defaults = defaultSettings(docs)

describe('settings', () => {
  it('has spec defaults', () => {
    expect(defaults).toEqual({
      defaultFolder: join(docs, 'rf-write'),
      snippetFolder: join(docs, 'rf-write', 'snippets'),
      rfDocumentPath: '',
      presentFontFactor: 1.6,
    })
  })

  it('keeps valid values and derives the snippet folder from a custom default folder', () => {
    const custom = resolve('/data/notes')
    expect(sanitizeSettings({ defaultFolder: custom, presentFontFactor: 2 }, defaults)).toEqual({
      ...defaults,
      defaultFolder: custom,
      snippetFolder: join(custom, 'snippets'),
      presentFontFactor: 2,
    })
  })

  it('drops relative paths, wrong types and clamps numbers', () => {
    expect(
      sanitizeSettings({ defaultFolder: 'relativ', rfDocumentPath: 42, presentFontFactor: 99 }, defaults),
    ).toEqual({ ...defaults, presentFontFactor: 3 })
    expect(sanitizeSettings('kaputt', defaults)).toEqual(defaults)
  })
})

describe('session', () => {
  it('defaults for garbage', () => {
    expect(sanitizeSession(null)).toEqual(DEFAULT_SESSION)
  })

  it('filters tabs, clamps index and zoom, trims recent', () => {
    const a = resolve('/n/a.md')
    const raw = {
      tabs: [{ path: a, headerHidden: true }, { path: 'rel.md' }, 7],
      activeIndex: 5,
      mode: 'present',
      view: 'code',
      zoom: { edit: 10, present: 'x' },
      recent: [...Array.from({ length: 12 }, (_, i) => resolve(`/r/${i}.md`)), 'rel'],
    }
    const s = sanitizeSession(raw)
    expect(s.tabs).toEqual([{ path: a, headerHidden: true }])
    expect(s.activeIndex).toBe(0)
    expect(s.mode).toBe('present')
    expect(s.view).toBe('code')
    expect(s.zoom).toEqual({ edit: 3, present: 1 })
    expect(s.recent).toHaveLength(10)
  })
})

describe('loadJson / saveJson', () => {
  it('round-trips and creates the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-store-'))
    const file = join(dir, 'sub', 'settings.json')
    await saveJson(file, { a: 1 })
    expect(await loadJson(file)).toEqual({ a: 1 })
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true)
  })

  it('returns undefined for a missing file', async () => {
    expect(await loadJson(join(tmpdir(), 'rfw-gibt-es-nicht.json'))).toBeUndefined()
  })

  it('moves a corrupt file aside and returns undefined', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-store-'))
    const file = join(dir, 'session.json')
    await writeFile(file, '{kaputt')
    expect(await loadJson(file)).toBeUndefined()
    expect(await readdir(dir)).toEqual(['session.json.corrupt'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/store.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`src/main/store.ts`:

```ts
import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { Session, SessionTab, Settings } from '../shared/types'
import { writeFileAtomic } from './files'

export const MAX_RECENT = 10

export const DEFAULT_SESSION: Session = {
  tabs: [],
  activeIndex: 0,
  mode: 'edit',
  view: 'preview',
  zoom: { edit: 1, present: 1 },
  recent: [],
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const absPath = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' && isAbsolute(v) ? v : null
const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

export function defaultSettings(documentsDir: string): Settings {
  const defaultFolder = join(documentsDir, 'rf-write')
  return {
    defaultFolder,
    snippetFolder: join(defaultFolder, 'snippets'),
    rfDocumentPath: '',
    presentFontFactor: 1.6,
  }
}

export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const o = isObj(raw) ? raw : {}
  const defaultFolder = absPath(o.defaultFolder) ?? defaults.defaultFolder
  return {
    defaultFolder,
    snippetFolder: absPath(o.snippetFolder) ?? join(defaultFolder, 'snippets'),
    rfDocumentPath: absPath(o.rfDocumentPath) ?? '',
    presentFontFactor: clamp(o.presentFontFactor, 1, 3, defaults.presentFontFactor),
  }
}

export function sanitizeSession(raw: unknown): Session {
  const o = isObj(raw) ? raw : {}
  const tabs: SessionTab[] = Array.isArray(o.tabs)
    ? o.tabs.flatMap((t) => {
        if (!isObj(t)) return []
        const path = absPath(t.path)
        return path ? [{ path, headerHidden: t.headerHidden === true }] : []
      })
    : []
  const zoom = isObj(o.zoom) ? o.zoom : {}
  return {
    tabs,
    activeIndex: tabs.length ? Math.trunc(clamp(o.activeIndex, 0, tabs.length - 1, 0)) : 0,
    mode: o.mode === 'present' ? 'present' : 'edit',
    view: o.view === 'code' ? 'code' : 'preview',
    zoom: { edit: clamp(zoom.edit, 0.5, 3, 1), present: clamp(zoom.present, 0.5, 3, 1) },
    recent: Array.isArray(o.recent)
      ? o.recent
          .map(absPath)
          .filter((p): p is string => p !== null)
          .slice(0, MAX_RECENT)
      : [],
  }
}

/** Missing → undefined. Corrupt → moved to `<file>.corrupt`, undefined. */
export async function loadJson(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(raw)
  } catch {
    await fs.rename(path, `${path}.corrupt`).catch(() => undefined)
    return undefined
  }
}

export async function saveJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.ts tests/unit/main/store.test.ts
git commit -m "feat(store): sanitize and persist settings and session"
```

---

### Task 7: Command line and recent files

**Files:**
- Create: `src/main/cli.ts`
- Test: `tests/unit/main/cli.test.ts`

**Interfaces:**
- Produces:
  - `type CliAction = { kind: 'version' } | { kind: 'help' } | { kind: 'open'; paths: string[] }`
  - `HELP_TEXT: string`
  - `argsFromArgv(argv: readonly string[], isPackaged: boolean): string[]`
  - `parseCli(args: readonly string[], cwd: string): CliAction`
  - `addRecent(list: readonly string[], path: string, max?: number): string[]`
  - `replaceRecent(list: readonly string[], from: string, to: string): string[]`

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/cli.test.ts`:

```ts
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addRecent, argsFromArgv, parseCli, replaceRecent } from '../../../src/main/cli'

describe('argsFromArgv', () => {
  it('drops only the executable when packaged', () => {
    expect(argsFromArgv(['/A/rf-write', 'a.md'], true)).toEqual(['a.md'])
  })

  it('drops the executable and the app path in development, even after injected flags', () => {
    expect(argsFromArgv(['electron', '--inspect=0', '.', 'a.md', '-V'], false)).toEqual([
      '--inspect=0',
      'a.md',
      '-V',
    ])
  })
})

describe('parseCli', () => {
  const cwd = resolve('/work')

  it.each([['--version'], ['-V']])('%s → version', (flag) => {
    expect(parseCli(['a.md', flag], cwd)).toEqual({ kind: 'version' })
  })

  it.each([['--help'], ['-h']])('%s → help', (flag) => {
    expect(parseCli([flag], cwd)).toEqual({ kind: 'help' })
  })

  it('resolves paths against cwd and ignores unknown flags (macOS -psn_, Chromium switches)', () => {
    expect(parseCli(['notiz.md', '-psn_0_123', '--inspect=0', resolve('/abs/x.md')], cwd)).toEqual({
      kind: 'open',
      paths: [resolve(cwd, 'notiz.md'), resolve('/abs/x.md')],
    })
  })
})

describe('recent list', () => {
  it('moves an existing entry to the front and caps the length', () => {
    expect(addRecent(['b', 'a', 'c'], 'a', 3)).toEqual(['a', 'b', 'c'])
    expect(addRecent(['b', 'c', 'd'], 'a', 3)).toEqual(['a', 'b', 'c'])
  })

  it('replaces a renamed entry in place', () => {
    expect(replaceRecent(['x', 'old', 'y'], 'old', 'new')).toEqual(['x', 'new', 'y'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/cli.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/main/cli.ts`:

```ts
import { resolve } from 'node:path'
import { MAX_RECENT } from './store'

export type CliAction = { kind: 'version' } | { kind: 'help' } | { kind: 'open'; paths: string[] }

export const HELP_TEXT = `rf-write – Markdown-Editor für real-fast-document

Aufruf:
  rf-write [datei.md …]    Dateien öffnen (bei laufender Instanz dort als Tab)
  rf-write --version, -V   Version ausgeben
  rf-write --help, -h      Diese Hilfe
`

/** Strips the executable (and, unpackaged, the app path) from process.argv. */
export function argsFromArgv(argv: readonly string[], isPackaged: boolean): string[] {
  const rest = argv.slice(1)
  if (isPackaged) return rest
  const appIndex = rest.findIndex((a) => !a.startsWith('-'))
  return appIndex < 0 ? rest : [...rest.slice(0, appIndex), ...rest.slice(appIndex + 1)]
}

export function parseCli(args: readonly string[], cwd: string): CliAction {
  if (args.includes('--version') || args.includes('-V')) return { kind: 'version' }
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' }
  return {
    kind: 'open',
    paths: args.filter((a) => !a.startsWith('-')).map((a) => resolve(cwd, a)),
  }
}

export function addRecent(list: readonly string[], path: string, max = MAX_RECENT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max)
}

export function replaceRecent(list: readonly string[], from: string, to: string): string[] {
  return list.map((p) => (p === from ? to : p))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/cli.ts tests/unit/main/cli.test.ts
git commit -m "feat(cli): parse --version, --help and file arguments"
```

---

### Task 8: Native menu template

**Files:**
- Create: `src/main/menu.ts`
- Test: `tests/unit/main/menu.test.ts`

**Interfaces:**
- Consumes: `MenuCommand`
- Produces:
  - `interface MenuDeps { platform: NodeJS.Platform; isDev: boolean; recent: readonly string[]; command(c: MenuCommand): void; openRecent(path: string): void; clearRecent(): void }`
  - `buildMenuTemplate(d: MenuDeps): MenuItemConstructorOptions[]`
  - Every command item has `id` equal to its `MenuCommand`. The E2E tests click items by id.

Plans 2–5 add entries to the View menu and the settings item. Undo and redo go to CodeMirror as commands, because the native `undo` role does not reach CodeMirror's history.

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/menu.test.ts`:

```ts
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate, type MenuDeps } from '../../../src/main/menu'

const deps = (over: Partial<MenuDeps> = {}): MenuDeps => ({
  platform: 'darwin',
  isDev: false,
  recent: [],
  command: vi.fn(),
  openRecent: vi.fn(),
  clearRecent: vi.fn(),
  ...over,
})

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])])
}
const byId = (items: MenuItemConstructorOptions[], id: string) => flatten(items).find((i) => i.id === id)
const click = (item: MenuItemConstructorOptions | undefined) =>
  (item?.click as unknown as () => void)()

describe('buildMenuTemplate', () => {
  it.each([
    ['new', 'CmdOrCtrl+N'],
    ['open', 'CmdOrCtrl+O'],
    ['rename', 'CmdOrCtrl+Shift+R'],
    ['close-tab', 'CmdOrCtrl+W'],
    ['export', 'CmdOrCtrl+E'],
    ['undo', 'CmdOrCtrl+Z'],
    ['redo', 'CmdOrCtrl+Shift+Z'],
    ['next-tab', 'Ctrl+Tab'],
    ['prev-tab', 'Ctrl+Shift+Tab'],
  ])('%s has accelerator %s and sends its command', (id, accelerator) => {
    const d = deps()
    const item = byId(buildMenuTemplate(d), id)
    expect(item?.accelerator).toBe(accelerator)
    click(item)
    expect(d.command).toHaveBeenCalledWith(id)
  })

  it('has an app menu on macOS and a quit item elsewhere', () => {
    expect(buildMenuTemplate(deps())[0]?.role).toBe('appMenu')
    const winItems = flatten(buildMenuTemplate(deps({ platform: 'win32' })))
    expect(winItems.some((i) => i.role === 'appMenu')).toBe(false)
    expect(winItems.some((i) => i.role === 'quit')).toBe(true)
  })

  it('lists recent files and can clear them', () => {
    const d = deps({ recent: ['/n/a.md', '/n/b.md'] })
    const items = flatten(buildMenuTemplate(d))
    click(items.find((i) => i.label === '/n/b.md'))
    expect(d.openRecent).toHaveBeenCalledWith('/n/b.md')
    click(items.find((i) => i.label === 'Liste leeren'))
    expect(d.clearRecent).toHaveBeenCalled()
  })

  it('shows a disabled placeholder without recent files', () => {
    const item = flatten(buildMenuTemplate(deps())).find((i) => i.label === 'Keine Einträge')
    expect(item?.enabled).toBe(false)
  })

  it('offers dev tools only in development', () => {
    const has = (isDev: boolean) =>
      flatten(buildMenuTemplate(deps({ isDev }))).some((i) => i.role === 'toggleDevTools')
    expect(has(true)).toBe(true)
    expect(has(false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/menu.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/main/menu.ts`:

```ts
import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export interface MenuDeps {
  platform: NodeJS.Platform
  isDev: boolean
  recent: readonly string[]
  command(c: MenuCommand): void
  openRecent(path: string): void
  clearRecent(): void
}

export function buildMenuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  const mac = d.platform === 'darwin'
  const item = (id: MenuCommand, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    click: () => d.command(id),
  })
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const recent: MenuItemConstructorOptions[] = d.recent.length
    ? [
        ...d.recent.map((p): MenuItemConstructorOptions => ({ label: p, click: () => d.openRecent(p) })),
        sep,
        { label: 'Liste leeren', click: () => d.clearRecent() },
      ]
    : [{ label: 'Keine Einträge', enabled: false }]

  const file: MenuItemConstructorOptions = {
    label: 'Datei',
    submenu: [
      item('new', 'Neu', 'CmdOrCtrl+N'),
      item('open', 'Öffnen …', 'CmdOrCtrl+O'),
      { label: 'Zuletzt geöffnet', submenu: recent },
      sep,
      item('rename', 'Umbenennen …', 'CmdOrCtrl+Shift+R'),
      item('close-tab', 'Tab schließen', 'CmdOrCtrl+W'),
      sep,
      item('export', 'PDF exportieren', 'CmdOrCtrl+E'),
      ...(mac ? [] : [sep, { role: 'quit', label: 'Beenden' } as MenuItemConstructorOptions]),
    ],
  }

  const edit: MenuItemConstructorOptions = {
    label: 'Bearbeiten',
    submenu: [
      item('undo', 'Widerrufen', 'CmdOrCtrl+Z'),
      item('redo', 'Wiederholen', 'CmdOrCtrl+Shift+Z'),
      sep,
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfügen' },
      { role: 'selectAll', label: 'Alles auswählen' },
    ],
  }

  const view: MenuItemConstructorOptions = {
    label: 'Ansicht',
    submenu: d.isDev ? [{ role: 'reload' }, { role: 'toggleDevTools' }] : [],
  }

  const window: MenuItemConstructorOptions = {
    label: 'Fenster',
    submenu: [
      item('next-tab', 'Nächster Tab', 'Ctrl+Tab'),
      item('prev-tab', 'Vorheriger Tab', 'Ctrl+Shift+Tab'),
      ...(mac ? [sep, { role: 'minimize', label: 'Im Dock ablegen' } as MenuItemConstructorOptions] : []),
    ],
  }

  return [...(mac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []), file, edit, view, window]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/menu.ts tests/unit/main/menu.test.ts
git commit -m "feat(menu): add file, edit and window menus with German labels"
```

---

### Task 9: Watch open files for external changes

**Files:**
- Create: `src/main/watcher.ts`
- Test: `tests/unit/main/watcher.test.ts`

**Interfaces:**
- Consumes: `readNote` (Task 2), `NoteFile`
- Produces:
  - `class NoteWatcher`
    - `constructor(onChange: (note: NoteFile) => void, debounceMs?: number)`
    - `setFiles(paths: readonly string[]): void`
    - `expect(path: string, hash: string): void`
    - `close(): void`

The watcher works on the **directory**, not the file. Atomic saves (ours and other editors') replace the file's inode, and a file watcher would go silent after the first save.

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/watcher.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashBytes, noteBytes, writeNote } from '../../../src/main/files'
import { NoteWatcher } from '../../../src/main/watcher'
import type { NoteFile } from '../../../src/shared/types'

let dir: string
let changes: NoteFile[]
let watcher: NoteWatcher

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await sleep(50)
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-watch-'))
  changes = []
  watcher = new NoteWatcher((n) => changes.push(n), 100)
})
afterEach(() => watcher.close())

describe('NoteWatcher', () => {
  it('reports an external change with the new text', async () => {
    const path = join(dir, 'a.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('alt', false)))
    await sleep(150)
    await writeFile(path, 'neu von außen')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('neu von außen')
  })

  it('ignores its own expected write, also when atomic', async () => {
    const path = join(dir, 'b.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('eigene', false)))
    await writeNote(path, 'eigene', false)
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('keeps working after an atomic replace', async () => {
    const path = join(dir, 'c.md')
    await writeFile(path, '1')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('2', false)))
    await writeNote(path, '2', false)
    await sleep(300)
    await writeFile(path, '3 extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('3 extern')
  })

  it('ignores files that are not watched', async () => {
    const watched = join(dir, 'w.md')
    await writeFile(watched, 'w')
    watcher.setFiles([watched])
    await writeFile(join(dir, 'andere.md'), 'x')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('stops reporting after the file is removed from the set', async () => {
    const path = join(dir, 'd.md')
    await writeFile(path, 'd')
    watcher.setFiles([path])
    watcher.setFiles([])
    await writeFile(path, 'd2')
    await sleep(600)
    expect(changes).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/watcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/main/watcher.ts`:

```ts
import { type FSWatcher, watch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { NoteFile } from '../shared/types'
import { readNote } from './files'

export class NoteWatcher {
  private readonly dirs = new Map<string, FSWatcher>()
  private files = new Set<string>()
  private readonly known = new Map<string, string>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly onChange: (note: NoteFile) => void,
    private readonly debounceMs = 200,
  ) {}

  setFiles(paths: readonly string[]): void {
    this.files = new Set(paths)
    const needed = new Set(paths.map((p) => dirname(p)))
    for (const [dir, w] of this.dirs) {
      if (!needed.has(dir)) {
        w.close()
        this.dirs.delete(dir)
      }
    }
    for (const dir of needed) {
      if (this.dirs.has(dir)) continue
      try {
        const w = watch(dir, (_event, name) => {
          if (name) this.ping(join(dir, name.toString()))
        })
        w.on('error', () => {
          w.close()
          this.dirs.delete(dir)
        })
        this.dirs.set(dir, w)
      } catch {
        // Folder vanished or is not watchable: the next save surfaces any problem.
      }
    }
  }

  /** Records the hash of content that is (about to be) on disk, so it is not reported. */
  expect(path: string, hash: string): void {
    this.known.set(path, hash)
  }

  close(): void {
    for (const w of this.dirs.values()) w.close()
    this.dirs.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  private ping(path: string): void {
    if (!this.files.has(path) || basename(path).startsWith('.')) return
    const pending = this.timers.get(path)
    if (pending) clearTimeout(pending)
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path)
        void this.check(path)
      }, this.debounceMs),
    )
  }

  private async check(path: string): Promise<void> {
    if (!this.files.has(path)) return
    let note: NoteFile
    try {
      note = await readNote(path)
    } catch {
      return
    }
    if (this.known.get(path) === note.hash) return
    this.known.set(path, note.hash)
    this.onChange(note)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/watcher.test.ts`
Expected: PASS. If one test is flaky on a slow machine, raise the `waitFor` timeout. Never lower the debounce to fix it.

- [ ] **Step 5: Commit**

```bash
git add src/main/watcher.ts tests/unit/main/watcher.test.ts
git commit -m "feat(files): watch note folders and report external changes"
```

---

### Task 10: Main process wiring

**Files:**
- Create: `src/main/window.ts`, `src/main/context.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts` (replace the temporary version completely)

**Interfaces:**
- Consumes: everything from Tasks 2–9, `Ch`, shared types
- Produces: the runtime behaviour behind `RfwApi`. There are no new exports for other tasks.
- Environment hook: `RFW_USER_DATA` overrides Electron's `userData` folder. The E2E tests use it, and it also isolates the single-instance lock.

Unit tests are not practical here, because these modules need the Electron runtime. The Playwright suite in Task 14 covers them, and this task ends with a build and a manual smoke run.

- [ ] **Step 1: Window factory**

`src/main/window.ts`:

```ts
import { join } from 'node:path'
import { BrowserWindow } from 'electron'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 600,
    minHeight: 400,
    show: false,
    title: 'rf-write',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Spelling marks would distract while presenting.
      spellcheck: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}
```

- [ ] **Step 2: App context**

`src/main/context.ts`:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, type BrowserWindow, dialog, Menu } from 'electron'
import { Ch } from '../shared/ipc'
import type { ExportResult, MenuCommand, Session, SessionPatch, Settings, StartupState } from '../shared/types'
import { addRecent, replaceRecent } from './cli'
import { runRfDocument } from './export'
import { isExecutableFile, locateRfDocument } from './locate'
import { buildMenuTemplate } from './menu'
import { DEFAULT_SESSION, defaultSettings, loadJson, sanitizeSession, sanitizeSettings, saveJson } from './store'
import { NoteWatcher } from './watcher'
import { createMainWindow } from './window'

export class AppContext {
  window: BrowserWindow | null = null
  settings: Settings
  session: Session = DEFAULT_SESSION
  readonly reserved = new Set<string>()
  readonly watcher = new NoteWatcher((note) => this.send(Ch.externalChange, note))
  /** Paths the renderer may read or write: only ones the user opened or rf-write created. */
  private readonly allowed = new Set<string>()
  private readonly pending: string[] = []
  private rendererReady = false
  private closeApproved = false
  private quitting = false
  private rfDocument: string | null = null

  constructor(
    private readonly userData: string,
    documentsDir: string,
  ) {
    this.settings = defaultSettings(documentsDir)
  }

  async load(): Promise<void> {
    this.settings = sanitizeSettings(await loadJson(this.file('settings.json')), this.settings)
    this.session = sanitizeSession(await loadJson(this.file('session.json')))
    this.allow([...this.session.tabs.map((t) => t.path), ...this.session.recent])
  }

  allow(paths: readonly string[]): void {
    for (const p of paths) this.allowed.add(p)
  }

  isAllowed(path: string): boolean {
    return this.allowed.has(path)
  }

  assertAllowed(path: string): void {
    if (!this.allowed.has(path)) throw new Error(`Zugriff verweigert: ${path}`)
  }

  createWindow(): void {
    const win = createMainWindow()
    this.window = win
    this.rendererReady = false
    this.closeApproved = false
    win.on('close', (e) => {
      if (this.closeApproved) return
      e.preventDefault()
      this.send(Ch.beforeClose)
    })
    win.on('closed', () => {
      this.window = null
      this.rendererReady = false
    })
    this.installMenu()
  }

  startup(): StartupState {
    this.rendererReady = true
    return { session: this.session, openPaths: this.pending.splice(0), settings: this.settings }
  }

  /** Opens paths in the renderer now, or queues them until it has started. */
  openPaths(paths: readonly string[]): void {
    if (!paths.length) return
    this.allow(paths)
    if (this.window && this.rendererReady) this.send(Ch.openPaths, [...paths])
    else {
      this.pending.push(...paths)
      if (!this.window && app.isReady()) this.createWindow()
    }
  }

  focus(): void {
    if (!this.window) {
      if (app.isReady()) this.createWindow()
      return
    }
    if (this.window.isMinimized()) this.window.restore()
    this.window.focus()
  }

  closeReady(ok: boolean): void {
    if (!ok) {
      this.quitting = false
      return
    }
    this.closeApproved = true
    this.window?.close()
    if (this.quitting) app.quit()
  }

  markQuitting(): void {
    this.quitting = true
  }

  send(channel: string, ...args: unknown[]): void {
    this.window?.webContents.send(channel, ...args)
  }

  installMenu(): void {
    const template = buildMenuTemplate({
      platform: process.platform,
      isDev: !app.isPackaged,
      recent: this.session.recent,
      command: (c: MenuCommand) => this.send(Ch.menu, c),
      openRecent: (p) => this.openPaths([p]),
      clearRecent: () => void this.setRecent([]),
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  async rememberRecent(path: string): Promise<void> {
    await this.setRecent(addRecent(this.session.recent, path))
  }

  async renamedRecent(from: string, to: string): Promise<void> {
    await this.setRecent(replaceRecent(this.session.recent, from, to))
  }

  async updateSession(patch: SessionPatch): Promise<void> {
    const tabs = patch.tabs?.filter((t) => this.isAllowed(t.path))
    this.session = sanitizeSession({ ...this.session, ...patch, ...(tabs ? { tabs } : {}) })
    await saveJson(this.file('session.json'), this.session)
  }

  async exportPdf(note: string): Promise<ExportResult> {
    const located = await this.resolveRfDocument()
    if (!located.found) return { kind: 'not-found', searched: located.searched }
    const result = await runRfDocument(located.found, note)
    // A start failure may mean rf-document moved: look it up again next time.
    if (result.kind === 'failed' && result.code === null) this.rfDocument = null
    return result
  }

  async confirmDiscard(names: readonly string[]): Promise<boolean> {
    const options = {
      type: 'warning' as const,
      buttons: ['Abbrechen', 'Verwerfen und schließen'],
      defaultId: 0,
      cancelId: 0,
      message: 'Nicht gespeicherte Änderungen',
      detail: `Diese Notizen konnten nicht gespeichert werden:\n${names.join('\n')}`,
    }
    const { response } = this.window
      ? await dialog.showMessageBox(this.window, options)
      : await dialog.showMessageBox(options)
    return response === 1
  }

  private async resolveRfDocument(): Promise<{ found: string | null; searched: string[] }> {
    if (this.rfDocument) return { found: this.rfDocument, searched: [] }
    const result = await locateRfDocument({
      platform: process.platform,
      env: process.env,
      home: homedir(),
      configured: this.settings.rfDocumentPath,
      isFile: isExecutableFile,
    })
    this.rfDocument = result.found
    return result
  }

  private async setRecent(recent: string[]): Promise<void> {
    this.session = { ...this.session, recent }
    this.allow(recent)
    await saveJson(this.file('session.json'), this.session)
    this.installMenu()
  }

  private file(name: string): string {
    return join(this.userData, name)
  }
}
```

- [ ] **Step 3: IPC handlers**

`src/main/ipc.ts`:

```ts
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { Ch } from '../shared/ipc'
import type { NoteFile, RenameResult, SaveResult, SessionPatch } from '../shared/types'
import type { AppContext } from './context'
import { hashBytes, newNotePath, noteBytes, readNote, renameNote, writeNoteBytes } from './files'

const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new TypeError('Ungültiger Parameter.')
  return v
}
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function registerIpc(ctx: AppContext): void {
  ipcMain.handle(Ch.startup, () => ctx.startup())

  ipcMain.handle(Ch.readNote, async (_e, path: unknown): Promise<NoteFile | { error: string }> => {
    try {
      const p = str(path)
      ctx.assertAllowed(p)
      const note = await readNote(p)
      ctx.watcher.expect(p, note.hash)
      void ctx.rememberRecent(p)
      return note
    } catch (err) {
      return { error: message(err) }
    }
  })

  ipcMain.handle(Ch.newNotePath, async () => {
    const p = await newNotePath(ctx.settings.defaultFolder, new Date(), ctx.reserved)
    ctx.reserved.add(p)
    ctx.allow([p])
    return p
  })

  ipcMain.handle(Ch.releasePath, (_e, path: unknown) => {
    ctx.reserved.delete(str(path))
  })

  ipcMain.handle(
    Ch.saveNote,
    async (_e, path: unknown, text: unknown, bom: unknown): Promise<SaveResult> => {
      try {
        const p = str(path)
        ctx.assertAllowed(p)
        const bytes = noteBytes(str(text), bom === true)
        const hash = hashBytes(bytes)
        ctx.watcher.expect(p, hash)
        await writeNoteBytes(p, bytes)
        if (ctx.reserved.delete(p)) void ctx.rememberRecent(p)
        return { ok: true, hash }
      } catch (err) {
        return { ok: false, error: message(err) }
      }
    },
  )

  ipcMain.handle(Ch.renameNote, async (_e, from: unknown, newName: unknown): Promise<RenameResult> => {
    try {
      const p = str(from)
      ctx.assertAllowed(p)
      const to = await renameNote(p, str(newName))
      ctx.allow([to])
      await ctx.renamedRecent(p, to)
      return { ok: true, path: to }
    } catch (err) {
      return { ok: false, error: message(err) }
    }
  })

  ipcMain.handle(Ch.openDialog, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      defaultPath: ctx.settings.defaultFolder,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    ctx.allow(result.filePaths)
    return result.filePaths
  })

  ipcMain.handle(Ch.exportPdf, async (_e, path: unknown) => {
    const p = str(path)
    ctx.assertAllowed(p)
    return ctx.exportPdf(p)
  })

  ipcMain.handle(Ch.saveSession, async (_e, patch: unknown) => {
    if (typeof patch === 'object' && patch !== null) await ctx.updateSession(patch as SessionPatch)
  })

  ipcMain.handle(Ch.watch, (_e, paths: unknown) => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    ctx.watcher.setFiles(list.filter((p) => ctx.isAllowed(p)))
  })

  ipcMain.handle(Ch.confirmDiscard, (_e, names: unknown) =>
    ctx.confirmDiscard(Array.isArray(names) ? names.map(String) : []),
  )

  ipcMain.on(Ch.closeReady, (_e, ok: unknown) => ctx.closeReady(ok === true))
}
```

- [ ] **Step 4: Entry point**

Replace `src/main/index.ts` completely:

```ts
import { app } from 'electron'
import { argsFromArgv, HELP_TEXT, parseCli } from './cli'
import { AppContext } from './context'
import { registerIpc } from './ipc'

// Must run before requestSingleInstanceLock: the lock lives in userData.
if (process.env.RFW_USER_DATA) app.setPath('userData', process.env.RFW_USER_DATA)

const cli = parseCli(argsFromArgv(process.argv, app.isPackaged), process.cwd())

if (cli.kind === 'version') {
  process.stdout.write(`rf-write ${app.getVersion()}\n`)
  app.exit(0)
} else if (cli.kind === 'help') {
  process.stdout.write(HELP_TEXT)
  app.exit(0)
} else if (!app.requestSingleInstanceLock({ paths: cli.paths })) {
  app.exit(0)
} else {
  run(cli.paths)
}

function isPathsData(data: unknown): data is { paths: string[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { paths?: unknown }).paths)
  )
}

function run(initial: string[]): void {
  const ctx = new AppContext(app.getPath('userData'), app.getPath('documents'))
  ctx.openPaths(initial)

  app.on('open-file', (event, path) => {
    event.preventDefault()
    ctx.openPaths([path])
  })
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    ctx.openPaths(isPathsData(data) ? data.paths : [])
    ctx.focus()
  })
  app.on('before-quit', () => ctx.markQuitting())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (!ctx.window) ctx.createWindow()
  })

  void app.whenReady().then(async () => {
    await ctx.load()
    registerIpc(ctx)
    ctx.createWindow()
  })
}
```

`ctx.openPaths(initial)` runs before `load()`. `load()` only adds to the allowed set, so the queued paths stay allowed.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: everything passes.

Run: `npx electron . --version`
Expected: `rf-write 26.10.0-dev.0`

The renderer is still the temporary one, so `npm run dev` shows a window without an editor. That is expected until Task 14.

- [ ] **Step 6: Commit**

```bash
git add src/main
git commit -m "feat(main): wire window, IPC, single instance, session and close guard"
```

---

### Task 11: Editor state factory and line endings

**Files:**
- Create: `src/renderer/editor/setup.ts`, `src/renderer/util/path.ts`
- Test: `tests/unit/renderer/setup.test.ts`, `tests/unit/renderer/path.test.ts`

**Interfaces:**
- Consumes: `Eol`, `View`
- Produces:
  - `viewCompartment: Compartment`
  - `viewExtensions(view: View): Extension`. Plan 2 replaces the `'preview'` branch.
  - `createState(text: string, eol: Eol, view: View): EditorState`
  - `serializeDoc(doc: Text, eol: Eol): string`
  - `fileName(path: string): string`

**Line endings:**
- `'\n'` and `'\r\n'` files use CodeMirror's default splitting. On save, `'\r\n'` files are joined with `\r\n` again.
- `'mixed'` files get `EditorState.lineSeparator.of('\n')`. CodeMirror then splits only on `\n`, and every `\r` stays a character, so the bytes survive unchanged.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/setup.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createState, serializeDoc, viewCompartment, viewExtensions } from '../../../src/renderer/editor/setup'

describe('createState / serializeDoc', () => {
  it.each([
    ['LF', 'a\nb\n', '\n'],
    ['CRLF', 'a\r\nb\r\n', '\r\n'],
    ['mixed', 'a\r\nb\nc\rd', 'mixed'],
    ['empty', '', '\n'],
  ] as const)('%s round-trips byte-exact', (_name, text, eol) => {
    expect(serializeDoc(createState(text, eol, 'code').doc, eol)).toBe(text)
  })

  it('a new line in a CRLF file is saved as CRLF', () => {
    const state = createState('a\r\nb', '\r\n', 'code')
    const next = state.update({ changes: { from: 1, insert: '\n' } }).state
    expect(serializeDoc(next.doc, '\r\n')).toBe('a\r\n\r\nb')
  })

  it('switching the view keeps the text identical', () => {
    const state = createState('# T\r\n\r\nx', '\r\n', 'code')
    const next = state.update({ effects: viewCompartment.reconfigure(viewExtensions('preview')) }).state
    expect(serializeDoc(next.doc, '\r\n')).toBe('# T\r\n\r\nx')
  })
})
```

`tests/unit/renderer/path.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fileName } from '../../../src/renderer/util/path'

describe('fileName', () => {
  it.each([
    ['/a/b/c.md', 'c.md'],
    ['C:\\a\\b c.md', 'b c.md'],
    ['c.md', 'c.md'],
  ])('%s → %s', (p, n) => expect(fileName(p)).toBe(n))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/renderer/util/path.ts`:

```ts
export function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path
}
```

`src/renderer/editor/setup.ts`:

```ts
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view'
import type { Eol, View } from '../../shared/types'

export const viewCompartment = new Compartment()

/** Plan 2 replaces the preview branch with the PDF-look decorations. */
export function viewExtensions(view: View): Extension {
  return view === 'code'
    ? [lineNumbers(), syntaxHighlighting(defaultHighlightStyle)]
    : [syntaxHighlighting(defaultHighlightStyle)]
}

export function createState(text: string, eol: Eol, view: View): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      viewCompartment.of(viewExtensions(view)),
    ],
  })
}

export function serializeDoc(doc: Text, eol: Eol): string {
  return eol === '\r\n' ? doc.sliceString(0, doc.length, '\r\n') : doc.toString()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/editor/setup.ts src/renderer/util/path.ts tests/unit/renderer
git commit -m "feat(editor): create editor states that keep line endings byte-exact"
```

---

### Task 12: Tab store

**Files:**
- Create: `src/renderer/tabs/tab-store.ts`
- Test: `tests/unit/renderer/tab-store.test.ts`

**Interfaces:**
- Consumes: `EditorState`, `Text`, `Eol`, `SessionTab`
- Produces:
  - `interface Tab { readonly id: number; path: string; state: EditorState; savedDoc: Text; bom: boolean; eol: Eol; onDisk: boolean; headerHidden: boolean }`
  - `interface NewTab { path: string; state: EditorState; bom: boolean; eol: Eol; onDisk: boolean; headerHidden?: boolean }`
  - `class TabStore` with:
    - `all: readonly Tab[]`, `activeIndex: number`, `active: Tab | null`
    - `add(init: NewTab): Tab` (an already open path is activated instead)
    - `get(id: number): Tab | undefined`, `findByPath(path: string): Tab | undefined`
    - `activate(index: number): Tab | null`, `next(): Tab | null`, `prev(): Tab | null`
    - `close(id: number): void`
    - `updateState(id: number, state: EditorState): void`
    - `markSaved(id: number, doc: Text): void`
    - `setPath(id: number, path: string): void`
    - `isDirty(tab: Tab): boolean`
    - `toSession(): SessionTab[]`

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/tab-store.test.ts`:

```ts
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { TabStore } from '../../../src/renderer/tabs/tab-store'

const add = (store: TabStore, path: string, text = '', onDisk = true) =>
  store.add({ path, state: EditorState.create({ doc: text }), bom: false, eol: '\n', onDisk })

describe('TabStore', () => {
  it('activates new tabs and reuses an open path', () => {
    const s = new TabStore()
    const a = add(s, '/a.md')
    add(s, '/b.md')
    expect(s.activeIndex).toBe(1)
    expect(add(s, '/a.md')).toBe(a)
    expect(s.all).toHaveLength(2)
    expect(s.activeIndex).toBe(0)
  })

  it('wraps next/prev and ignores invalid indexes', () => {
    const s = new TabStore()
    add(s, '/a.md')
    add(s, '/b.md')
    expect(s.next()?.path).toBe('/a.md')
    expect(s.prev()?.path).toBe('/b.md')
    expect(s.activate(9)?.path).toBe('/b.md')
  })

  it.each([
    ['closing the active middle tab activates its right neighbour', 1, 1, '/c.md'],
    ['closing the active last tab activates the new last', 2, 2, '/b.md'],
    ['closing a tab left of the active keeps the active tab', 2, 0, '/c.md'],
    ['closing a tab right of the active keeps the active tab', 0, 2, '/a.md'],
  ])('%s', (_name, activeIdx, closeIdx, expected) => {
    const s = new TabStore()
    const tabs = [add(s, '/a.md'), add(s, '/b.md'), add(s, '/c.md')]
    s.activate(activeIdx)
    s.close(tabs[closeIdx]!.id)
    expect(s.active?.path).toBe(expected)
  })

  it('has no active tab after closing the last one', () => {
    const s = new TabStore()
    s.close(add(s, '/a.md').id)
    expect(s.active).toBeNull()
    expect(s.next()).toBeNull()
  })

  it('tracks dirty state against the saved doc', () => {
    const s = new TabStore()
    const t = add(s, '/a.md', 'x')
    expect(s.isDirty(t)).toBe(false)
    s.updateState(t.id, t.state.update({ changes: { from: 1, insert: 'y' } }).state)
    expect(s.isDirty(t)).toBe(true)
    s.markSaved(t.id, t.state.doc)
    expect(s.isDirty(t)).toBe(false)
  })

  it('stays dirty when typing continued during a save', () => {
    const s = new TabStore()
    const t = add(s, '/a.md', 'a')
    const v1 = t.state.update({ changes: { from: 1, insert: 'b' } }).state
    s.updateState(t.id, v1)
    const snapshot = v1.doc // save starts with this doc
    s.updateState(t.id, v1.update({ changes: { from: 2, insert: 'c' } }).state)
    s.markSaved(t.id, snapshot) // save finishes
    expect(s.isDirty(t)).toBe(true)
  })

  it('new empty tabs are clean and not in the session', () => {
    const s = new TabStore()
    const t = add(s, '/neu.md', '', false)
    add(s, '/a.md')
    expect(s.isDirty(t)).toBe(false)
    expect(s.toSession()).toEqual([{ path: '/a.md', headerHidden: false }])
    s.markSaved(t.id, t.state.doc)
    expect(s.toSession().map((x) => x.path)).toEqual(['/neu.md', '/a.md'])
  })

  it('updates the path on rename', () => {
    const s = new TabStore()
    const t = add(s, '/a.md')
    s.setPath(t.id, '/b.md')
    expect(s.findByPath('/b.md')).toBe(t)
    expect(s.findByPath('/a.md')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/tab-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/renderer/tabs/tab-store.ts`:

```ts
import type { EditorState, Text } from '@codemirror/state'
import type { Eol, SessionTab } from '../../shared/types'

export interface Tab {
  readonly id: number
  path: string
  state: EditorState
  /** Doc as last written to disk; dirty = state.doc differs. */
  savedDoc: Text
  bom: boolean
  eol: Eol
  /** False for a new note until its first save. */
  onDisk: boolean
  headerHidden: boolean
}

export interface NewTab {
  path: string
  state: EditorState
  bom: boolean
  eol: Eol
  onDisk: boolean
  headerHidden?: boolean
}

export class TabStore {
  private tabs: Tab[] = []
  private activeIdx = -1
  private nextId = 1

  get all(): readonly Tab[] {
    return this.tabs
  }

  get activeIndex(): number {
    return this.activeIdx
  }

  get active(): Tab | null {
    return this.tabs[this.activeIdx] ?? null
  }

  add(init: NewTab): Tab {
    const existing = this.findByPath(init.path)
    if (existing) {
      this.activeIdx = this.tabs.indexOf(existing)
      return existing
    }
    const tab: Tab = {
      id: this.nextId++,
      path: init.path,
      state: init.state,
      savedDoc: init.state.doc,
      bom: init.bom,
      eol: init.eol,
      onDisk: init.onDisk,
      headerHidden: init.headerHidden ?? false,
    }
    this.tabs.push(tab)
    this.activeIdx = this.tabs.length - 1
    return tab
  }

  get(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  findByPath(path: string): Tab | undefined {
    return this.tabs.find((t) => t.path === path)
  }

  activate(index: number): Tab | null {
    if (index >= 0 && index < this.tabs.length) this.activeIdx = index
    return this.active
  }

  next(): Tab | null {
    if (!this.tabs.length) return null
    return this.activate((this.activeIdx + 1) % this.tabs.length)
  }

  prev(): Tab | null {
    if (!this.tabs.length) return null
    return this.activate((this.activeIdx - 1 + this.tabs.length) % this.tabs.length)
  }

  close(id: number): void {
    const i = this.tabs.findIndex((t) => t.id === id)
    if (i < 0) return
    this.tabs.splice(i, 1)
    if (this.tabs.length === 0) this.activeIdx = -1
    else if (i < this.activeIdx || this.activeIdx >= this.tabs.length) this.activeIdx -= 1
  }

  updateState(id: number, state: EditorState): void {
    const tab = this.get(id)
    if (tab) tab.state = state
  }

  markSaved(id: number, doc: Text): void {
    const tab = this.get(id)
    if (!tab) return
    tab.savedDoc = doc
    tab.onDisk = true
  }

  setPath(id: number, path: string): void {
    const tab = this.get(id)
    if (tab) tab.path = path
  }

  isDirty(tab: Tab): boolean {
    return !tab.state.doc.eq(tab.savedDoc)
  }

  toSession(): SessionTab[] {
    return this.tabs
      .filter((t) => t.onDisk)
      .map((t) => ({ path: t.path, headerHidden: t.headerHidden }))
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/tab-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/tabs/tab-store.ts tests/unit/renderer/tab-store.test.ts
git commit -m "feat(tabs): add tab store with per-tab editor state and dirty tracking"
```

---

### Task 13: Autosave scheduler

**Files:**
- Create: `src/renderer/editor/autosave.ts`
- Test: `tests/unit/renderer/autosave.test.ts`

**Interfaces:**
- Produces:
  - `class AutosaveScheduler`
    - `constructor(save: () => Promise<boolean>, delayMs?: number /* 1000 */, retryMs?: number /* 5000 */)`
    - `touch(): void`: restarts the 1 s debounce
    - `flush(): Promise<boolean>`: saves now and resolves `true` when everything is on disk
    - `dispose(): void`
  - Runs never overlap. A run started during another one waits for it. A failed or throwing save schedules a retry.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/autosave.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutosaveScheduler } from '../../../src/renderer/editor/autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AutosaveScheduler', () => {
  it('saves once, 1 s after the last touch', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    await vi.advanceTimersByTimeAsync(800)
    a.touch()
    await vi.advanceTimersByTimeAsync(800)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush saves immediately and cancels the pending timer', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    expect(await a.flush()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure until it succeeds', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const a = new AutosaveScheduler(save, 1000, 5000)
    expect(await a.flush()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('treats a throwing save as failure', async () => {
    const a = new AutosaveScheduler(async () => {
      throw new Error('kaputt')
    })
    expect(await a.flush()).toBe(false)
    a.dispose()
  })

  it('never runs saves concurrently', async () => {
    let running = 0
    let maxRunning = 0
    const save = vi.fn(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 100))
      running--
      return true
    })
    const a = new AutosaveScheduler(save)
    const first = a.flush()
    const second = a.flush()
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([first, second])
    expect(save).toHaveBeenCalledTimes(2)
    expect(maxRunning).toBe(1)
  })

  it('dispose stops pending work', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    a.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/autosave.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/renderer/editor/autosave.ts`:

```ts
type Timer = ReturnType<typeof setTimeout>

export class AutosaveScheduler {
  private timer: Timer | null = null
  private retryTimer: Timer | null = null
  private chain: Promise<boolean> = Promise.resolve(true)

  constructor(
    private readonly save: () => Promise<boolean>,
    private readonly delayMs = 1000,
    private readonly retryMs = 5000,
  ) {}

  touch(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.run(), this.delayMs)
  }

  flush(): Promise<boolean> {
    return this.run()
  }

  dispose(): void {
    this.clearTimers()
  }

  private run(): Promise<boolean> {
    this.clearTimers()
    this.chain = this.chain.then(async () => {
      const ok = await this.save().catch(() => false)
      if (!ok) this.retryTimer = setTimeout(() => void this.run(), this.retryMs)
      return ok
    })
    return this.chain
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.timer = null
    this.retryTimer = null
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/autosave.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/editor/autosave.ts tests/unit/renderer/autosave.test.ts
git commit -m "feat(editor): add debounced autosave with retry and serialized runs"
```

---

### Task 14: Renderer UI, app controller and end-to-end tests

**Files:**
- Create: `src/renderer/ui/tabbar.ts`, `src/renderer/ui/statusline.ts`, `src/renderer/ui/notices.ts`, `src/renderer/ui/prompt.ts`, `src/renderer/app.ts`, `src/renderer/styles.css`
- Modify: `src/renderer/main.ts` (replace the temporary version)
- Create: `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/basics.spec.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes:
  - `TabStore`, `Tab` (Task 12)
  - `AutosaveScheduler` (Task 13)
  - `createState`, `serializeDoc` (Task 11)
  - `fileName` (Task 11)
  - `window.rfw: RfwApi` (Task 1)
  - `makeFakeRfDocument` (Task 5)
- Produces:
  - `class App { constructor(root: AppRoot); start(): Promise<void> }` with `interface AppRoot { tabbar: HTMLElement; editor: HTMLElement; empty: HTMLElement; status: HTMLElement; notices: HTMLElement }`
  - DOM hooks for the tests:
    - `[data-testid=tab]`, with `.active` and `.dirty` classes
    - `[data-testid=status-state]`
    - `[data-testid=export]`
    - `.panel`, `.toast`, `.banner`
    - `dialog.prompt input`
  - Plans 2 and 3 extend `App` (view switch, present mode) and `StatusLine`.

- [ ] **Step 1: UI components**

`src/renderer/ui/tabbar.ts`:

```ts
import type { Tab } from '../tabs/tab-store'
import { fileName } from '../util/path'

export interface TabBarActions {
  select(index: number): void
  close(id: number): void
}

export class TabBar {
  constructor(
    private readonly el: HTMLElement,
    private readonly actions: TabBarActions,
  ) {}

  render(tabs: readonly Tab[], active: number, isDirty: (t: Tab) => boolean): void {
    this.el.replaceChildren(
      ...tabs.map((tab, i) => {
        const item = document.createElement('div')
        item.className = 'tab'
        item.dataset.testid = 'tab'
        item.setAttribute('role', 'tab')
        item.setAttribute('aria-selected', String(i === active))
        item.classList.toggle('active', i === active)
        item.classList.toggle('dirty', isDirty(tab))
        item.title = tab.path
        const label = document.createElement('span')
        label.className = 'tab-label'
        label.textContent = fileName(tab.path)
        const close = document.createElement('button')
        close.type = 'button'
        close.className = 'tab-close'
        close.textContent = '×'
        close.title = 'Tab schließen'
        close.addEventListener('click', (e) => {
          e.stopPropagation()
          this.actions.close(tab.id)
        })
        item.addEventListener('click', () => this.actions.select(i))
        item.addEventListener('auxclick', (e) => {
          if (e.button === 1) this.actions.close(tab.id)
        })
        item.append(label, close)
        return item
      }),
    )
  }
}
```

`src/renderer/ui/statusline.ts`:

```ts
export type SaveState = 'saved' | 'dirty' | 'new' | 'error'

const LABEL: Record<SaveState, string> = {
  saved: 'Gespeichert',
  dirty: 'Ungespeichert',
  new: 'Neu – wird beim ersten Tippen angelegt',
  error: 'Speichern fehlgeschlagen',
}

export class StatusLine {
  private readonly name = document.createElement('span')
  private readonly state = document.createElement('span')
  private readonly exportButton = document.createElement('button')
  private busy = false

  constructor(el: HTMLElement, actions: { exportPdf(): void }) {
    this.name.className = 'file'
    this.state.className = 'state'
    this.state.dataset.testid = 'status-state'
    this.exportButton.type = 'button'
    this.exportButton.className = 'export'
    this.exportButton.dataset.testid = 'export'
    this.exportButton.addEventListener('click', () => actions.exportPdf())
    this.setExporting(false)
    el.append(this.name, this.state, this.exportButton)
  }

  get exporting(): boolean {
    return this.busy
  }

  render(file: string | null, state: SaveState, error: string | null): void {
    this.name.textContent = file ?? ''
    this.state.textContent = state === 'error' && error ? `${LABEL.error}: ${error}` : LABEL[state]
    this.state.classList.toggle('error', state === 'error')
    this.exportButton.hidden = file === null
  }

  setExporting(on: boolean): void {
    this.busy = on
    this.exportButton.disabled = on
    this.exportButton.classList.toggle('busy', on)
    this.exportButton.textContent = on ? 'Exportiere …' : 'PDF exportieren'
  }
}
```

`src/renderer/ui/notices.ts`:

```ts
export interface NoticeAction {
  label: string
  run(): void
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

export class Notices {
  constructor(private readonly el: HTMLElement) {}

  toast(message: string): void {
    const t = document.createElement('div')
    t.className = 'toast'
    t.setAttribute('role', 'status')
    t.textContent = message
    this.el.append(t)
    setTimeout(() => t.remove(), 4000)
  }

  /** Dismissible, copyable message, e.g. rf-document's stderr. */
  panel(title: string, body: string): void {
    const p = document.createElement('div')
    p.className = 'panel'
    p.setAttribute('role', 'alertdialog')
    const h = document.createElement('h2')
    h.textContent = title
    const pre = document.createElement('pre')
    pre.textContent = body
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(
      button('Kopieren', () => void navigator.clipboard.writeText(body)),
      button('Schließen', () => p.remove()),
    )
    p.append(h, pre, actions)
    this.el.append(p)
  }

  banner(message: string, actions: NoticeAction[]): void {
    const b = document.createElement('div')
    b.className = 'banner'
    b.setAttribute('role', 'alert')
    const text = document.createElement('p')
    text.textContent = message
    b.append(
      text,
      ...actions.map((a) =>
        button(a.label, () => {
          b.remove()
          a.run()
        }),
      ),
    )
    this.el.append(b)
  }
}
```

`src/renderer/ui/prompt.ts`:

```ts
/** Modal text input. Resolves null on cancel/Esc or empty input. */
export function askText(title: string, label: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'prompt'
    const form = document.createElement('form')
    form.method = 'dialog'
    const heading = document.createElement('h2')
    heading.textContent = title
    const field = document.createElement('label')
    field.textContent = label
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    input.spellcheck = false
    field.append(input)
    const ok = document.createElement('button')
    ok.type = 'submit'
    ok.value = 'ok'
    ok.textContent = 'OK'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Abbrechen'
    cancel.addEventListener('click', () => dialog.close('cancel'))
    const actions = document.createElement('div')
    actions.className = 'actions'
    actions.append(ok, cancel)
    form.append(heading, field, actions)
    dialog.append(form)
    dialog.addEventListener('close', () => {
      const accepted = dialog.returnValue === 'ok'
      dialog.remove()
      resolve(accepted ? input.value.trim() || null : null)
    })
    document.body.append(dialog)
    dialog.showModal()
    input.select()
  })
}
```

- [ ] **Step 2: App controller**

`src/renderer/app.ts`:

```ts
import { redo, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { ExportResult, MenuCommand, NoteFile, View } from '../shared/types'
import { AutosaveScheduler } from './editor/autosave'
import { createState, serializeDoc } from './editor/setup'
import { type Tab, TabStore } from './tabs/tab-store'
import { Notices } from './ui/notices'
import { askText } from './ui/prompt'
import { type SaveState, StatusLine } from './ui/statusline'
import { TabBar } from './ui/tabbar'
import { fileName } from './util/path'

const INSTALL_HINT = [
  'macOS/Linux:',
  'curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.sh | bash',
  '',
  'Windows (PowerShell):',
  'irm https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.ps1 | iex',
].join('\n')

const isMac = navigator.userAgent.includes('Mac')

export interface AppRoot {
  tabbar: HTMLElement
  editor: HTMLElement
  empty: HTMLElement
  status: HTMLElement
  notices: HTMLElement
}

export class App {
  private readonly rfw = window.rfw
  private readonly store = new TabStore()
  private readonly autosave = new AutosaveScheduler(() => this.saveAll())
  private readonly editor: EditorView
  private readonly tabBar: TabBar
  private readonly status: StatusLine
  private readonly notices: Notices
  private view: View = 'preview'
  private shownId: number | null = null
  private saveError: string | null = null
  private sessionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly root: AppRoot) {
    this.editor = new EditorView({
      parent: root.editor,
      state: createState('', '\n', this.view),
      dispatchTransactions: (trs, view) => {
        view.update(trs)
        const tab = this.store.active
        if (!tab) return
        this.store.updateState(tab.id, view.state)
        if (trs.some((tr) => tr.docChanged)) {
          this.autosave.touch()
          this.refresh()
        }
      },
    })
    this.tabBar = new TabBar(root.tabbar, {
      select: (i) => this.activate(i),
      close: (id) => void this.closeTab(id),
    })
    this.status = new StatusLine(root.status, { exportPdf: () => void this.exportPdf() })
    this.notices = new Notices(root.notices)
    root.empty.querySelector('[data-action=new]')?.addEventListener('click', () => void this.newNote())
    root.empty.querySelector('[data-action=open]')?.addEventListener('click', () => void this.open())
    this.rfw.onMenu((cmd) => void this.command(cmd))
    this.rfw.onOpenPaths((paths) => void this.openPaths(paths))
    this.rfw.onExternalChange((note) => this.externalChange(note))
    this.rfw.onBeforeClose(() => this.beforeClose())
    window.addEventListener('keydown', (e) => this.globalKeys(e))
    window.addEventListener('blur', () => void this.autosave.flush())
  }

  async start(): Promise<void> {
    const startup = await this.rfw.startup()
    this.view = startup.session.view
    for (const t of startup.session.tabs) await this.openPath(t.path, t.headerHidden)
    this.store.activate(Math.min(startup.session.activeIndex, this.store.all.length - 1))
    for (const p of startup.openPaths) await this.openPath(p)
    if (this.store.all.length === 0) await this.newNote()
    else this.show()
  }

  // ── commands ────────────────────────────────────────────────────────────

  private async command(cmd: MenuCommand): Promise<void> {
    switch (cmd) {
      case 'new':
        return this.newNote()
      case 'open':
        return this.open()
      case 'rename':
        return this.rename()
      case 'close-tab': {
        const tab = this.store.active
        if (tab) await this.closeTab(tab.id)
        return
      }
      case 'export':
        return this.exportPdf()
      case 'next-tab':
        await this.autosave.flush()
        this.store.next()
        return this.show()
      case 'prev-tab':
        await this.autosave.flush()
        this.store.prev()
        return this.show()
      case 'undo':
        undo(this.editor)
        return
      case 'redo':
        redo(this.editor)
        return
    }
  }

  private globalKeys(e: KeyboardEvent): void {
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      this.activate(Number(e.key) - 1)
    }
  }

  private activate(index: number): void {
    void this.autosave.flush()
    this.store.activate(index)
    this.show()
  }

  private async newNote(): Promise<void> {
    const path = await this.rfw.newNotePath()
    this.store.add({ path, state: createState('', '\n', this.view), bom: false, eol: '\n', onDisk: false })
    this.show()
  }

  private async open(): Promise<void> {
    await this.openPaths(await this.rfw.showOpenDialog())
  }

  private async openPaths(paths: readonly string[]): Promise<void> {
    for (const p of paths) await this.openPath(p)
    this.show()
  }

  private async openPath(path: string, headerHidden = false): Promise<boolean> {
    const open = this.store.findByPath(path)
    if (open) {
      this.store.activate(this.store.all.indexOf(open))
      return true
    }
    const res = await this.rfw.readNote(path)
    if ('error' in res) {
      this.notices.panel('Nicht geöffnet', `${path}\n\n${res.error}`)
      return false
    }
    this.store.add({
      path,
      state: createState(res.text, res.eol, this.view),
      bom: res.bom,
      eol: res.eol,
      onDisk: true,
      headerHidden,
    })
    return true
  }

  private async closeTab(id: number): Promise<void> {
    const tab = this.store.get(id)
    if (!tab) return
    if (this.store.isDirty(tab) && !(await this.saveTab(tab))) {
      if (!(await this.rfw.confirmDiscard([fileName(tab.path)]))) return
    }
    if (!tab.onDisk) await this.rfw.releasePath(tab.path)
    this.store.close(id)
    this.show()
  }

  private async rename(): Promise<void> {
    const tab = this.store.active
    if (!tab) return
    const name = await askText('Umbenennen', 'Neuer Dateiname', fileName(tab.path))
    if (!name) return
    if (!(await this.saveTab(tab, true))) {
      this.notices.panel('Umbenennen nicht möglich', `Die Notiz konnte nicht gespeichert werden:\n${this.saveError ?? ''}`)
      return
    }
    const res = await this.rfw.renameNote(tab.path, name)
    if (!res.ok) {
      this.notices.panel('Umbenennen nicht möglich', res.error)
      return
    }
    this.store.setPath(tab.id, res.path)
    this.show()
  }

  private async exportPdf(): Promise<void> {
    const tab = this.store.active
    if (!tab || this.status.exporting) return
    if (!(await this.saveTab(tab, true))) {
      this.notices.panel('Export abgebrochen', `Die Notiz konnte nicht gespeichert werden:\n${this.saveError ?? ''}`)
      return
    }
    this.status.setExporting(true)
    try {
      this.showExport(await this.rfw.exportPdf(tab.path))
    } finally {
      this.status.setExporting(false)
    }
  }

  private showExport(r: ExportResult): void {
    if (r.kind === 'ok') this.notices.toast(r.message)
    else if (r.kind === 'failed') this.notices.panel('Export fehlgeschlagen', r.stderr)
    else
      this.notices.panel(
        'rf-document nicht gefunden',
        `Gesucht in:\n${r.searched.join('\n')}\n\nInstallation:\n${INSTALL_HINT}`,
      )
  }

  // ── saving ──────────────────────────────────────────────────────────────

  /** force: also create a new note's file when it is still empty (rename, export). */
  private async saveTab(tab: Tab, force = false): Promise<boolean> {
    if (!this.store.isDirty(tab) && (tab.onDisk || !force)) return true
    const doc = tab.state.doc
    const res = await this.rfw.saveNote(tab.path, serializeDoc(doc, tab.eol), tab.bom)
    if (!res.ok) {
      this.saveError = res.error
      this.refresh()
      return false
    }
    const firstSave = !tab.onDisk
    this.store.markSaved(tab.id, doc)
    this.saveError = null
    if (firstSave) this.syncMain()
    this.refresh()
    return true
  }

  private async saveAll(): Promise<boolean> {
    let ok = true
    for (const tab of [...this.store.all]) {
      if (!(await this.saveTab(tab))) ok = false
    }
    return ok
  }

  private async beforeClose(): Promise<boolean> {
    await this.persistSession()
    if (await this.autosave.flush()) return true
    const names = this.store.all.filter((t) => this.store.isDirty(t)).map((t) => fileName(t.path))
    return this.rfw.confirmDiscard(names)
  }

  // ── external changes ────────────────────────────────────────────────────

  private externalChange(note: NoteFile): void {
    const tab = this.store.findByPath(note.path)
    if (!tab) return
    if (!this.store.isDirty(tab)) {
      this.reload(tab, note)
      return
    }
    this.notices.banner(`„${fileName(note.path)}“ wurde außerhalb von rf-write geändert.`, [
      { label: 'Neu laden (meine Änderungen verwerfen)', run: () => this.reload(tab, note) },
      { label: 'Meine behalten', run: () => undefined },
    ])
  }

  private reload(tab: Tab, note: NoteFile): void {
    const state = createState(note.text, note.eol, this.view)
    tab.bom = note.bom
    tab.eol = note.eol
    this.store.updateState(tab.id, state)
    this.store.markSaved(tab.id, state.doc)
    if (this.store.active?.id === tab.id) this.editor.setState(state)
    this.refresh()
  }

  // ── rendering ───────────────────────────────────────────────────────────

  private show(): void {
    const tab = this.store.active
    this.root.empty.hidden = tab !== null
    this.root.editor.hidden = tab === null
    if (tab && tab.id !== this.shownId) {
      this.editor.setState(tab.state)
      this.editor.focus()
    }
    this.shownId = tab?.id ?? null
    this.refresh()
    this.syncMain()
  }

  private refresh(): void {
    const tab = this.store.active
    this.tabBar.render(this.store.all, this.store.activeIndex, (t) => this.store.isDirty(t))
    let state: SaveState = 'saved'
    if (this.saveError) state = 'error'
    else if (tab && this.store.isDirty(tab)) state = 'dirty'
    else if (tab && !tab.onDisk) state = 'new'
    this.status.render(tab ? fileName(tab.path) : null, state, this.saveError)
    document.title = tab ? `${fileName(tab.path)}${state === 'dirty' ? ' •' : ''} – rf-write` : 'rf-write'
  }

  /** Tells main which files to watch and schedules a session write. */
  private syncMain(): void {
    void this.rfw.watch(this.store.all.filter((t) => t.onDisk).map((t) => t.path))
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => void this.persistSession(), 300)
  }

  private async persistSession(): Promise<void> {
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    const tabs = this.store.toSession()
    const activePath = this.store.active?.path
    const activeIndex = Math.max(0, tabs.findIndex((t) => t.path === activePath))
    await this.rfw.saveSession({ tabs, activeIndex, view: this.view })
  }
}
```

- [ ] **Step 3: Entry and styles**

Replace `src/renderer/main.ts`:

```ts
import './styles.css'
import { App } from './app'

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} fehlt in index.html`)
  return el
}

const app = new App({
  tabbar: byId('tabbar'),
  editor: byId('editor'),
  empty: byId('empty'),
  status: byId('status'),
  notices: byId('notices'),
})
void app.start()
```

`src/renderer/styles.css`. This is neutral chrome only; Plan 2 adds the PDF look:

```css
:root {
  color-scheme: light;
  --chrome-bg: #f4f4f2;
  --chrome-fg: #333;
  --chrome-muted: #888;
  --accent: #1f6f6a;
  --danger: #a4262c;
  font-family: system-ui, sans-serif;
  font-size: 13px;
}
html,
body {
  margin: 0;
  height: 100%;
  background: #fff;
  color: #222;
}
[hidden] {
  display: none !important;
}
#app {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
}
#tabbar {
  display: flex;
  gap: 2px;
  padding: 4px 6px 0;
  background: var(--chrome-bg);
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px 6px 0 0;
  color: var(--chrome-muted);
  white-space: nowrap;
  cursor: default;
}
.tab.active {
  background: #fff;
  color: var(--chrome-fg);
}
.tab.dirty .tab-label::after {
  content: " •";
  color: var(--accent);
}
.tab-close {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
}
#workspace {
  position: relative;
  min-height: 0;
}
#editor,
#editor .cm-editor {
  height: 100%;
}
#editor .cm-scroller {
  font-family: ui-monospace, monospace;
}
#empty {
  display: grid;
  place-content: center;
  gap: 8px;
  height: 100%;
}
#status {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px;
  background: var(--chrome-bg);
  color: var(--chrome-muted);
}
#status .state.error {
  color: var(--danger);
  font-weight: 600;
}
#status .export {
  margin-left: auto;
}
#notices {
  position: fixed;
  top: 40px;
  right: 12px;
  display: grid;
  gap: 8px;
  max-width: min(560px, 90vw);
  z-index: 10;
}
.toast,
.panel,
.banner {
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
}
.panel h2,
dialog.prompt h2 {
  font-size: 14px;
  margin: 0 0 6px;
}
.panel pre {
  white-space: pre-wrap;
  max-height: 40vh;
  overflow: auto;
  user-select: text;
}
.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
dialog.prompt {
  border: 1px solid #ccc;
  border-radius: 8px;
  min-width: 320px;
}
dialog.prompt label {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}
```

- [ ] **Step 4: Manual smoke check**

Run: `npm run lint && npm run typecheck && npm test && npm run dev`

Check by hand:
1. A new tab named `YYYY-MM-DD_HH-mm-ss.md` appears.
2. Type text. After about 1 s the status shows „Gespeichert“, and the file exists in `~/Documents/rf-write`.
3. Mod+N opens a second tab, and Ctrl+Tab switches between the tabs.
4. Close the window, then start again: the tabs are restored.

- [ ] **Step 5: Commit the renderer**

```bash
git add src/renderer
git commit -m "feat(renderer): add tabs, status line, notices and app controller"
```

- [ ] **Step 6: Playwright config and helpers**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results/playwright',
})
```

`tests/e2e/helpers.ts`:

```ts
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export interface Dirs {
  root: string
  notes: string
  userData: string
}

export interface Launched extends Dirs {
  app: ElectronApplication
  page: Page
}

/** Notes live in a folder with spaces; realpath expands Windows 8.3 names (RUNNER~1). */
export async function makeDirs(): Promise<Dirs> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rfw-e2e-')))
  const notes = join(root, 'Notizen mit Leerzeichen')
  const userData = join(root, 'user-data')
  await mkdir(notes, { recursive: true })
  await mkdir(userData, { recursive: true })
  return { root, notes, userData }
}

export async function launch(
  opts: { args?: string[]; settings?: Record<string, unknown>; env?: Record<string, string>; dirs?: Dirs } = {},
): Promise<Launched> {
  const dirs = opts.dirs ?? (await makeDirs())
  await writeFile(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ defaultFolder: dirs.notes, ...opts.settings }),
  )
  const env = { ...process.env, RFW_USER_DATA: dirs.userData, ...opts.env } as Record<string, string>
  const app = await electron.launch({ args: ['.', ...(opts.args ?? [])], env })
  const page = await app.firstWindow()
  await page.locator('.cm-editor').waitFor()
  await page.locator('[data-testid=tab]').first().waitFor()
  return { app, page, ...dirs }
}

/** Menu accelerators do not fire for synthetic key events, so click the item. */
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) throw new Error(`menu item ${menuId} missing`)
    item.click()
  }, id)
}

export async function waitForFile(
  path: string,
  accept: (b: Buffer) => boolean = () => true,
  timeoutMs = 5000,
): Promise<Buffer> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      const b = await readFile(path)
      if (accept(b)) return b
    } catch {
      // not there yet
    }
    if (Date.now() > end) throw new Error(`timeout waiting for ${path}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.type(text)
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join('test-results', 'screenshots', `${process.platform}-${name}.png`) })
}
```

- [ ] **Step 7: Write the basics E2E suite**

`tests/e2e/basics.spec.ts`:

```ts
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, typeInEditor, waitForFile } from './helpers'

const tabs = (page: import('@playwright/test').Page) => page.locator('[data-testid=tab]')

test('starts with a new note that is created on the first keystroke', async () => {
  const { app, page, notes } = await launch()
  await expect(tabs(page)).toHaveCount(1)
  const name = (await tabs(page).first().locator('.tab-label').textContent()) ?? ''
  expect(name).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
  expect(await readdir(notes)).toEqual([])

  await page.locator('.cm-content').click()
  await page.keyboard.type('# Hallo')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Text')
  const bytes = await waitForFile(join(notes, name), (b) => b.toString('utf8') === '# Hallo\n\nText')
  expect(bytes.toString('utf8')).toBe('# Hallo\n\nText')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await shot(page, 'edit-code')
  await app.close()
})

test('opens a file from the command line and keeps BOM and CRLF byte-exact', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'Protokoll.md')
  await writeFile(file, Buffer.from('﻿# Titel\r\n\r\nZeile\r\n', 'utf8'))
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(tabs(page).first()).toContainText('Protokoll.md')
  await typeInEditor(page, 'Neu')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Zwei')
  const expected = Buffer.from('﻿# Titel\r\n\r\nZeile\r\nNeu\r\nZwei', 'utf8')
  await waitForFile(file, (b) => b.equals(expected))
  await app.close()
})

test('opens a second tab and switches with the window menu', async () => {
  const { app, page } = await launch()
  await clickMenu(app, 'new')
  await expect(tabs(page)).toHaveCount(2)
  await expect(tabs(page).nth(1)).toHaveClass(/active/)
  await clickMenu(app, 'prev-tab')
  await expect(tabs(page).nth(0)).toHaveClass(/active/)
  await app.close()
})

test('rename refuses an existing name and then renames', async () => {
  const dirs = await makeDirs()
  const a = join(dirs.notes, 'a.md')
  await writeFile(a, 'A')
  await writeFile(join(dirs.notes, 'b.md'), 'B')
  const { app, page } = await launch({ dirs, args: [a] })

  await clickMenu(app, 'rename')
  await page.locator('dialog.prompt input').fill('b')
  await page.keyboard.press('Enter')
  await expect(page.locator('.panel')).toContainText('existiert bereits')
  expect(await readFile(join(dirs.notes, 'b.md'), 'utf8')).toBe('B')

  await clickMenu(app, 'rename')
  await page.locator('dialog.prompt input').fill('Kickoff')
  await page.keyboard.press('Enter')
  await expect(tabs(page).first()).toContainText('Kickoff.md')
  expect((await readdir(dirs.notes)).sort()).toEqual(['Kickoff.md', 'b.md'])
  await app.close()
})

test('restores open tabs after a restart', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'bleibt.md')
  await writeFile(file, 'x')
  const first = await launch({ dirs, args: [file] })
  await first.app.close()
  const second = await launch({ dirs })
  await expect(tabs(second.page)).toHaveCount(1)
  await expect(tabs(second.page).first()).toContainText('bleibt.md')
  await second.app.close()
})

test('reloads a clean tab when the file changes on disk', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'extern.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  await writeFile(file, 'neu von außen')
  await expect(page.locator('.cm-content')).toContainText('neu von außen')
  await app.close()
})

test('prints the version without opening a window', async () => {
  const { execFileSync } = await import('node:child_process')
  const electronPath = (await import('electron')).default as unknown as string
  const out = execFileSync(electronPath, ['.', '--version'], { encoding: 'utf8' })
  expect(out.trim()).toMatch(/^rf-write \d+\.\d+\.\d+/)
})
```

- [ ] **Step 8: Write the export E2E suite**

`tests/e2e/export.spec.ts`:

```ts
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { makeFakeRfDocument } from '../helpers/fake-rf-document'
import { clickMenu, launch, makeDirs, shot } from './helpers'

test('shows rf-document stderr when the export fails', async () => {
  const dirs = await makeDirs()
  const { bin } = await makeFakeRfDocument(dirs.root, { stderr: 'Fehler: Testfehler', code: 4 })
  const note = join(dirs.notes, 'notiz.md')
  await writeFile(note, '# Test\n')
  const { app, page } = await launch({ dirs, args: [note], settings: { rfDocumentPath: bin } })
  await clickMenu(app, 'export')
  await expect(page.locator('.panel')).toContainText('Fehler: Testfehler')
  await shot(page, 'export-error')
  await app.close()
})

test('passes the saved note to rf-document and shows its message', async () => {
  const dirs = await makeDirs()
  const { bin, argsFile } = await makeFakeRfDocument(dirs.root, { stdout: 'OK erzeugt' })
  const note = join(dirs.notes, 'notiz.md')
  await writeFile(note, '# Test\n')
  const { app, page } = await launch({ dirs, args: [note], settings: { rfDocumentPath: bin } })
  await page.getByTestId('export').click()
  await expect(page.locator('.toast')).toContainText('OK erzeugt')
  expect((await readFile(argsFile, 'utf8')).trim()).toBe(note)
  await app.close()
})

test('exports a real PDF with rf-document', async () => {
  test.skip(!process.env.RFW_E2E_REAL_RFD, 'set RFW_E2E_REAL_RFD=1 with rf-document installed')
  test.setTimeout(180_000)
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Echter Export.md')
  await writeFile(note, '---\ntitle: "E2E"\n---\n\n# Test\n\n- [ ] Aufgabe – Name, bis 17.10.\n')
  const { app, page } = await launch({ dirs, args: [note], env: { RFD_NO_OPEN: '1' } })
  await clickMenu(app, 'export')
  await expect(page.locator('.toast')).toBeVisible({ timeout: 150_000 })
  const pdfs = (await readdir(dirs.notes)).filter((f) => f.endsWith('.pdf'))
  expect(pdfs).toHaveLength(1)
  const head = (await readFile(join(dirs.notes, pdfs[0]!))).subarray(0, 5).toString('latin1')
  expect(head).toBe('%PDF-')
  await app.close()
})
```

- [ ] **Step 9: Run the E2E suite**

Run: `npm run test:e2e`
Expected: all tests pass. The real-export test is skipped unless `RFW_E2E_REAL_RFD=1`.

To try the real export locally, rf-document must be installed: `RFW_E2E_REAL_RFD=1 RFD_NO_OPEN=1 npm run test:e2e`

If a test fails, fix the code, not the test. Exception: a test that is genuinely wrong. Record that reason in the commit message.

- [ ] **Step 10: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test(e2e): cover new notes, byte-exact saves, tabs, rename, session and export"
```

---

### Task 15: CI on macOS, Windows and Linux

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/dependabot.yml`, `CODEOWNERS`

**Interfaces:**
- Consumes: npm scripts from Task 1, E2E suite from Task 14
- Produces: the required status check `test (<os>)`, which branch protection uses later

- [ ] **Step 1: Workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

permissions:
  contents: read

jobs:
  test:
    name: test (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
          cache: npm

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:coverage
      - run: npm run build

      - name: Install rf-document (macOS / Linux)
        if: runner.os != 'Windows'
        run: |
          set -euo pipefail
          curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.sh | bash
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"

      - name: Install rf-document (Windows)
        if: runner.os == 'Windows'
        shell: powershell
        run: |
          $ErrorActionPreference = "Stop"
          irm https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.ps1 | iex

      - name: Prepare Electron on Linux
        if: runner.os == 'Linux'
        run: |
          # Ubuntu 24.04 blocks the unprivileged user namespaces Chromium's sandbox needs.
          sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
          sudo apt-get update
          sudo apt-get install -y xvfb libgtk-3-0t64 libnss3 libgbm1 libasound2t64

      - name: End-to-end tests (Linux)
        if: runner.os == 'Linux'
        run: xvfb-run -a npx playwright test
        env:
          RFW_E2E_REAL_RFD: '1'
          RFD_NO_OPEN: '1'

      - name: End-to-end tests
        if: runner.os != 'Linux'
        run: npx playwright test
        env:
          RFW_E2E_REAL_RFD: '1'
          RFD_NO_OPEN: '1'

      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        if: always()
        with:
          name: e2e-${{ matrix.os }}
          path: test-results/
          if-no-files-found: ignore
```

On Windows the notes live under `%TEMP%` on `C:`, the same drive as rf-document. rf-document has a known issue with notes on another drive (see the zettlr_rfdoc-Export CI). Do not move the test notes to `RUNNER_TEMP`, which is on `D:`.

- [ ] **Step 2: Dependabot and code owners**

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    target-branch: "dev"
    labels: ["dependencies", "automated"]
    commit-message:
      prefix: "chore(deps)"
    groups:
      codemirror:
        patterns: ["@codemirror/*", "@lezer/*"]
      tooling:
        patterns: ["vite", "electron-vite", "vitest", "@vitest/*", "@biomejs/biome", "typescript", "@playwright/test", "happy-dom", "@types/node"]
        update-types: ["minor", "patch"]

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 5
    target-branch: "dev"
    labels: ["ci", "automated"]
    commit-message:
      prefix: "chore(ci)"
```

`CODEOWNERS`:

```
*           @jcmx9
.github/    @jcmx9
```

- [ ] **Step 3: Validate the YAML locally**

Run: `npx --yes yaml-lint .github/workflows/ci.yml .github/dependabot.yml`
Expected: no errors. If the package is unavailable, use `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/dependabot.yml`.

- [ ] **Step 4: Commit**

```bash
git add .github CODEOWNERS
git commit -m "ci: lint, typecheck, unit and e2e tests with real rf-document on three OSes"
```

---

### Task 16: Project documentation

**Files:**
- Create: `README.md`, `README.en.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the commands from Task 1 and the CI from Task 15
- Produces: docs with README parity, as the global constraints require

- [ ] **Step 1: `README.md` (German)**

````markdown
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

| Kürzel | Aktion |
|--------|--------|
| Mod+N | Neue Notiz im Standardordner (`JJJJ-MM-TT_HH-mm-ss.md`) |
| Mod+O | Öffnen |
| Mod+Shift+R | Umbenennen |
| Mod+W | Tab schließen |
| Mod+E | PDF exportieren |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Tabs wechseln |

`Mod` = Cmd unter macOS, sonst Ctrl.

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
````

- [ ] **Step 2: `README.en.md` (same structure, English)**

````markdown
# real-fast-write

> Calm Markdown editor for client meetings that already looks like the real-fast-document PDF while you type.

**Version:** 26.10.0-dev.0 · [Deutsch](README.md)

[![CI](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml/badge.svg)](https://github.com/jcmx9/real-fast-write/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Description

`rf-write` is the editor for [real-fast-document](https://github.com/jcmx9/real-fast-document) (`rf-document`). It is meant for note-taking in client meetings while the screen is shared. Only rf-document produces the PDF. The Markdown file stays byte for byte as it was typed.

## Status

In development. Available: tabs, autosave with atomic writes, rename, session restore, detection of external changes and PDF export via rf-document. Not yet available: the PDF look in the preview, presentation mode, snippets and one-line installation.

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

| Shortcut | Action |
|----------|--------|
| Mod+N | New note in the default folder (`YYYY-MM-DD_HH-mm-ss.md`) |
| Mod+O | Open |
| Mod+Shift+R | Rename |
| Mod+W | Close tab |
| Mod+E | Export PDF |
| Ctrl+Tab / Ctrl+Shift+Tab, Mod+1…9 | Switch tabs |

`Mod` = Cmd on macOS, Ctrl elsewhere.

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
````

- [ ] **Step 3: `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`**

`CHANGELOG.md`:

```markdown
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
- PDF export via rf-document with readable error messages
- CI on macOS, Windows and Linux with a real rf-document export
```

`CONTRIBUTING.md`: the global template from `~/GitHub/CLAUDE.md` §17 with these replacements:
- Prerequisites: Node.js ≥ 22.12, npm, Git, a GitHub account.
- Setup: `npm ci`. Drop pre-commit.
- Checks: `npm run lint && npm run typecheck && npm test && npm run test:e2e`.
- Code standards: TypeScript strict and Biome as the only linter/formatter. Keep the type-hints and coverage lines.
- Commit messages: Conventional Commits in English, no AI attribution lines.

`SECURITY.md`: the global template (§16), but reporting goes through **GitHub private vulnerability reporting** ("Security" tab → "Report a vulnerability") instead of an e-mail address.

- [ ] **Step 4: Update `CLAUDE.md`**

Replace the "Project status" section with the current state and add a "Commands" section. Keep the decisions and constraints that are already there:

````markdown
## Project status

Plan 1 (foundation) is implemented: `docs/superpowers/plans/2026-10-14-rf-write-01-foundation.md`.
Next plans: 2 Preview, 3 Present, 4 Snippets, 5 Distribution (see the roadmap in plan 1). Spec: `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md`.

## Commands

```bash
npm run dev            # run the app with hot reload
npm run lint           # Biome (lint + format check); npm run format to fix
npm run typecheck      # tsc --noEmit
npm test               # Vitest unit tests
npx vitest run tests/unit/main/files.test.ts -t "round-trips"   # single test
npm run test:e2e       # builds, then Playwright drives the real Electron app
RFW_E2E_REAL_RFD=1 RFD_NO_OPEN=1 npm run test:e2e              # include the real rf-document export
```

## Architecture notes

- **Process boundary:** the main process owns the disk, processes, menu and window. The sandboxed renderer owns the text. The only bridge is `window.rfw` (`src/preload/index.ts`, typed by `RfwApi` in `src/shared/types.ts`, channels in `src/shared/ipc.ts`). Adding an IPC call means touching all three, plus a handler in `src/main/ipc.ts`.
- **Path allowlist:** main only reads and writes paths the user opened or rf-write created (`AppContext.allow`). New entry points must call `allow()`.
- **One `EditorView`, one `EditorState` per tab** (`TabStore`). `dispatchTransactions` in `App` mirrors the view state into the store. Dirty = `state.doc` ≠ `savedDoc`.
- **Byte-exact saving:** `readNote` strips a BOM and detects the EOL style (`'\n'`, `'\r\n'`, `'mixed'`). `createState` and `serializeDoc` restore it, and mixed files use `EditorState.lineSeparator` so `\r` survives. Invalid UTF-8 is refused.
- **Own writes vs. external changes:** `ipc.ts` calls `watcher.expect(path, hash)` *before* writing. The watcher watches directories, because atomic renames replace inodes.
- **Testing hooks:** `RFW_USER_DATA` isolates settings, session and the single-instance lock. E2E clicks menu items by `id` (= `MenuCommand`) because synthetic keys do not trigger native accelerators.
````

- [ ] **Step 5: Verify parity and the whole suite**

Run: `diff <(grep -c '^## ' README.md) <(grep -c '^## ' README.en.md) && npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e`
Expected: the same section count in both READMEs, everything green, and coverage ≥ 80 %.

- [ ] **Step 6: Commit**

```bash
git add README.md README.en.md CHANGELOG.md CONTRIBUTING.md SECURITY.md CLAUDE.md
git commit -m "docs: add README (de/en), changelog, contributing, security and CLAUDE.md commands"
```

- [ ] **Step 7: Open the PR into `dev`**

Use the superpowers:finishing-a-development-branch skill. Ask the user before pushing, because it is outward-facing. The PR targets `dev`, has no AI attribution, and is squash-merged once CI is green on all three OSes.

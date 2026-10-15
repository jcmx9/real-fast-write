# rf-write Plan 4 – Snippets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** typing `:` plus a few letters offers snippets (`:meeting`, `:telefonnotiz`, `:aufgabe`, `:header`, `:newpage`, plus the user's own). Enter or Tab inserts one, and Tab / Shift+Tab walk its tab stops. Snippets work in Code, Preview and Present.

**Architecture:**
- **Built-in templates** live verbatim in `resources/snippets/*.tpl.md`. The renderer bundles them with Vite's `import.meta.glob(..., { query: '?raw' })`; no IPC or packaging step is needed.
- **User templates** are read by main from `settings.snippetFolder` (`listSnippets` IPC). The renderer rescans on window focus. A user snippet overrides a built-in one with the same name.
- **Parser** (`snippet-parser.ts`, pure): expands the date variables at insert time and translates VS Code/Zettlr syntax into CodeMirror's `snippet()` template, escaping everything literal.
- **Completion** (`snippets.ts`): an `autocompletion` override source plus keymap, added to every tab's `EditorState` in `createState`. A shared registry object holds the current list.
- **Folds:** a cursor or selection that lands inside a folded section unfolds it (spec §5), so a tab stop is never hidden.

**Tech Stack:** Electron 44, CodeMirror 6 (`@codemirror/autocomplete` 6.20, already installed transitively), TypeScript strict, Vitest + happy-dom, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md`. Relevant sections: §8 (Snippets), §5 (unfold on cursor), §15 (tests: parser, `:header` keys, E2E `:meeting`), §11 (snippet folder setting).

**Builds on:** `dev` at `c9c2680` (plans 1–3). Relevant existing code:
- `src/renderer/editor/setup.ts`: `createState(text, eol, view, headerHiddenInit, mode)` with the base extensions and `keymap.of([...foldBindings(), ...defaultKeymap, ...historyKeymap, indentWithTab])`.
- `src/renderer/app.ts`: `App` with `globalKeys()` (Esc leaves Present only when `!e.defaultPrevented` and no `dialog[open]`), window `blur` listener.
- `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.ts` (`Ch`), `src/shared/types.ts` (`RfwApi`, `Settings.snippetFolder`, default `<defaultFolder>/snippets` from `store.ts`).
- `src/main/context.ts`: `AppContext.settings`.
- E2E helpers `tests/e2e/helpers.ts`: `launch({ dirs, args, settings })`, `makeDirs()`, `clickMenu`, `waitForFile`, `shot`, `MOD`.
- CodeMirror 6.20 `snippet()` template syntax: `${n:default}`, `${n}`, `${0}` = final cursor (sorted last; reaching the last field ends the session). A field default must not contain `{` or `}`. Literal braces in text are written `\{` / `\}`.

## Global Constraints

- **Branch:** `feature/snippets` from `dev`. PR into `dev`; merge only with green CI on macOS, Windows and Linux and the user's approval.
- **Byte-exact source:** a snippet inserts exactly the expanded template; nothing else in the document changes. No automatic rewriting of typed text (the user explicitly declined task auto-rewrites).
- **Built-ins verbatim:** `resources/snippets/{meeting,telefonnotiz,aufgabe,header,newpage}.tpl.md` are byte-copies of `~/GitHub/zettlr_rfdoc-Export/zettlr/snippets/*.tpl.md` (use `cp`, never retype; `aufgabe` and `newpage` have no final newline).
- **Syntax subset:** `$n`, `${n}`, `${n:default}`, `$0`, multi-digit `n`, variables `$CURRENT_YEAR` (4 digits), `$CURRENT_MONTH`, `$CURRENT_DATE` (day of month), `$CURRENT_HOUR` (24 h), `$CURRENT_MINUTE`, `$CURRENT_SECOND` (all 2 digits, local time), also as `${CURRENT_YEAR}` and inside a default. Any other `$` stays literal.
- **Names:** file name without `.tpl.md`; allowed `^[\p{L}\p{N}_-]+$` (Unicode). Others are skipped.
- **User snippet files:** UTF-8 only (invalid UTF-8 skipped), at most 64 KiB, regular files only, no recursion. A missing folder yields an empty list and is never created.
- **Security:** main reads only `settings.snippetFolder`; the renderer never passes a path. Snippet text reaches the DOM only through CodeMirror (no `innerHTML`).
- **UI strings German**, code/commits/docs English, Conventional Commits, no AI attribution, author `jcmx9`. `README.md`/`README.en.md` stay content-identical. Local `CLAUDE.md` is never committed.
- **Checks before each commit:** `npm run lint && npm run typecheck && npm test`.

## Review Focus

1. **Typing a colon in normal prose** (`Uhrzeit: 10:30`, `Hinweis:` then Enter): no popup unless `:` starts a word and is followed by a letter; Enter at the end of a line never inserts a snippet by surprise. → Task 3 tests.
2. **Esc in Present while the completion list is open** closes the list and stays in Present; a second Esc leaves Present. → Task 4 test.
3. **A tab stop inside a folded section** (snippet inserted above a folded heading, or cursor moved into a fold): the fold opens, the stop is visible. → Task 4 test.
4. **Odd user templates:** non-UTF-8, huge, a directory named `x.tpl.md`, a template with literal `${`, `#{`, `\{` or an unknown `$VAR`: never crash, literals stay literal, bad files skipped. → Tasks 1 and 2 tests.
5. **`:header` drift from rf-document:** the built-in header keys must equal `header.md` keys of rf-document, in CI too. → Task 1 test + CI step.

## Rulings made while planning

- Spec §8 says `:` opens the completion. To keep prose like `Hinweis:` + Enter safe, the list opens once `:` is followed by at least one letter (`:m`); Ctrl+Space after a bare `:` shows all snippets. Cost if wrong: one extra keystroke to see the list.
- Built-ins are bundled into the renderer (`?raw`) instead of being read by main from `resources/`: no packaging path to get wrong in plan 5. The directory name `resources/snippets/` from spec §13 is kept.

---

### Task 1: Built-in templates and the snippet parser

**Files:**
- Create: `resources/snippets/*.tpl.md` (5 byte-copies), `src/renderer/editor/snippet-parser.ts`, `src/renderer/editor/builtin-snippets.ts`
- Create: `tests/unit/renderer/snippet-parser.test.ts`, `tests/unit/renderer/header-keys.test.ts`
- Modify: `.github/workflows/ci.yml` (checkout rf-document for the header test), `tsconfig*.json` / `src/renderer/env.d.ts` only if `?raw` imports need typing (`vite/client` types)

**Interfaces:**
- Produces:
  - `export interface SnippetDef { name: string; body: string; source: 'builtin' | 'user' }` in `src/shared/types.ts`
  - `export function expandVariables(text: string, now: Date): string`
  - `export function toCmTemplate(body: string, now: Date): string`
  - `export const BUILTIN_SNIPPETS: readonly SnippetDef[]` (sorted by name)
  - `export const SNIPPET_NAME_RE = /^[\p{L}\p{N}_-]+$/u` (in `src/shared/snippets.ts`, used by main and renderer)

- [ ] **Step 0: Branch and copy the templates**

```bash
git checkout dev && git pull && git checkout -b feature/snippets
mkdir -p resources/snippets
cp ~/GitHub/zettlr_rfdoc-Export/zettlr/snippets/*.tpl.md resources/snippets/
cmp resources/snippets/meeting.tpl.md ~/GitHub/zettlr_rfdoc-Export/zettlr/snippets/meeting.tpl.md
```

Check `.gitattributes`: `*.md` is forced to LF; the copies are LF already, so they stay byte-identical. Biome must not format them (check `biome.json` `files.includes`; Biome does not format Markdown).

- [ ] **Step 1: Write the failing parser tests**

`tests/unit/renderer/snippet-parser.test.ts`:

```ts
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { snippet } from '@codemirror/autocomplete'
import { describe, expect, it } from 'vitest'
import { expandVariables, toCmTemplate } from '../../../src/renderer/editor/snippet-parser'

const NOW = new Date(2026, 0, 5, 7, 8, 9) // 05.01.2026 07:08:09 local

/** Inserts the template into an empty editor and returns doc text and selected ranges. */
function insert(body: string) {
  const view = new EditorView({ state: EditorState.create({ doc: '' }) })
  snippet(toCmTemplate(body, NOW))(view, { label: 'x' }, 0, 0)
  const sel = view.state.selection.main
  const out = { text: view.state.doc.toString(), sel: view.state.sliceDoc(sel.from, sel.to), at: sel.from }
  view.destroy()
  return out
}

describe('expandVariables', () => {
  it.each([
    ['$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE', '2026-01-05'],
    ['$CURRENT_HOUR:$CURRENT_MINUTE:$CURRENT_SECOND', '07:08:09'],
    ['${CURRENT_YEAR}', '2026'],
    ['$CURRENT_DATE.$CURRENT_MONTH.$CURRENT_YEAR', '05.01.2026'],
    ['$UNKNOWN and $ and 5 $', '$UNKNOWN and $ and 5 $'],
  ])('%s → %s', (src, out) => {
    expect(expandVariables(src, NOW)).toBe(out)
  })
})

describe('toCmTemplate', () => {
  it('selects the first tab stop with its default', () => {
    expect(insert('a ${1:Kunde} b $2')).toMatchObject({ text: 'a Kunde b ', sel: 'Kunde' })
  })

  it('orders multi-digit stops numerically and puts $0 last', () => {
    const view = new EditorView({ state: EditorState.create({ doc: '' }) })
    snippet(toCmTemplate('$0|${10:z}|${2:b}|${1:a}', NOW))(view, { label: 'x' }, 0, 0)
    const order: string[] = []
    for (let i = 0; i < 4; i++) {
      const s = view.state.selection.main
      order.push(view.state.sliceDoc(s.from, s.to) || `@${s.from}`)
      // Tab = nextSnippetField
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    }
    expect(order).toEqual(['a', 'b', 'z', '@0'])
    view.destroy()
  })

  it('expands a variable inside a default', () => {
    expect(insert('date: ${5:$CURRENT_YEAR-$CURRENT_MONTH-$CURRENT_DATE}')).toMatchObject({
      text: 'date: 2026-01-05',
      sel: '2026-01-05',
    })
  })

  it('keeps literal dollars, braces, hashes and backslashes', () => {
    const body = 'Preis 5 $, ${x}, #{y}, \\{z\\}, $UNKNOWN, {a}'
    expect(insert(body).text).toBe(body)
  })

  it('keeps braces inside a default (text kept, empty stop after it)', () => {
    expect(insert('${1:a{b}c}')).toMatchObject({ text: 'a{b}c', at: 5 })
  })

  it('a repeated stop number mirrors the same field', () => {
    expect(insert('${1:x}-$1').text).toBe('x-x')
  })

  it('$0 alone puts the cursor at its place', () => {
    expect(insert('\n<!-- pagebreak -->\n\n$0')).toMatchObject({
      text: '\n<!-- pagebreak -->\n\n',
      at: '\n<!-- pagebreak -->\n\n'.length,
    })
  })
})
```

The `keydown` Tab dispatch only works if the snippet keymap is active in a bare view: `snippet()` adds `snippetKeymap` through its own state field, so it is. If happy-dom does not route the key, call `nextSnippetField(view)` from `@codemirror/autocomplete` instead and record why.

Default with braces: VS Code ends a default at the `}` matching its `${`. CodeMirror cannot hold `{`/`}` in a field default, so such a default is emitted as **literal text followed by an empty stop** `${n}` (text preserved, stop still reachable).

- [ ] **Step 2: Run, see it fail** — `npx vitest run tests/unit/renderer/snippet-parser.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/renderer/editor/snippet-parser.ts`**

```ts
const pad = (n: number): string => String(n).padStart(2, '0')

const VARS: Record<string, (d: Date) => string> = {
  CURRENT_YEAR: (d) => String(d.getFullYear()),
  CURRENT_MONTH: (d) => pad(d.getMonth() + 1),
  CURRENT_DATE: (d) => pad(d.getDate()),
  CURRENT_HOUR: (d) => pad(d.getHours()),
  CURRENT_MINUTE: (d) => pad(d.getMinutes()),
  CURRENT_SECOND: (d) => pad(d.getSeconds()),
}

/** Replaces `$CURRENT_*` / `${CURRENT_*}`; every other `$` stays as it is. */
export function expandVariables(text: string, now: Date): string {
  return text.replace(/\$(?:\{([A-Z_]+)\}|([A-Z_]+))/g, (m, braced?: string, bare?: string) => {
    const name = braced ?? bare ?? ''
    // `$CURRENT_YEARX` is not a variable: bare names must end at a non-word char.
    const fn = VARS[name]
    return fn ? fn(now) : m
  })
}
```

Note the regex for bare names is greedy over `[A-Z_]`, so `$CURRENT_YEAR` followed by `-` works; a bare name longer than a known one (e.g. `$CURRENT_YEARS`) stays literal. Add that case to the expandVariables table.

Translation (`toCmTemplate`), a small hand-written scanner over the raw body (do **not** expand variables first globally — a variable must not create a placeholder):

```ts
/**
 * Escapes literal text for CodeMirror's template. CM 6.20 un-escapes only `\{` and `\}`, so
 * braces get a backslash and everything else (also `\`, `$`, `#`) passes unchanged:
 * source `\{` → `\\{` → CM yields `\{`; source `${x}` → `$\{x\}` → no field.
 */
const lit = (s: string): string => s.replace(/[{}]/g, (c) => `\\${c}`)

export function toCmTemplate(body: string, now: Date): string {
  let out = ''
  let i = 0
  while (i < body.length) {
    const rest = body.slice(i)
    let m = /^\$(\d+)/.exec(rest)
    if (m) {
      out += `\${${m[1]}}`
      i += m[0].length
      continue
    }
    m = /^\$\{(\d+)(?::|\})/.exec(rest)
    if (m) {
      const n = m[1]
      if (m[0].endsWith('}')) {
        out += `\${${n}}`
        i += m[0].length
        continue
      }
      // Default runs to the matching `}` (nested braces counted).
      let depth = 1
      let j = i + m[0].length
      for (; j < body.length && depth > 0; j++) {
        if (body[j] === '{') depth++
        else if (body[j] === '}') depth--
      }
      if (depth === 0) {
        const def = expandVariables(body.slice(i + m[0].length, j - 1), now)
        out += /[{}]/.test(def) ? `${lit(def)}\${${n}}` : `\${${n}:${def}}`
        i = j
        continue
      }
    }
    m = /^\$(?:\{[A-Z_]+\}|[A-Z_]+)/.exec(rest)
    if (m) {
      out += lit(expandVariables(m[0], now))
      i += m[0].length
      continue
    }
    out += lit(body[i] as string)
    i++
  }
  return out
}
```

**Mirrors:** CodeMirror inserts each occurrence's own default, so `${1:x}-$1` would give `x-`. VS Code gives `x-x`. Add a pre-pass that records the first default per stop number and emit `${n:<that default>}` for every occurrence of `n` (same brace rule as above).

The "keeps literal …" test pins the escaping against the real `snippet()`; if it fails, fix `lit`, not the test.

- [ ] **Step 4: Built-in registry** `src/renderer/editor/builtin-snippets.ts`:

```ts
import type { SnippetDef } from '../../shared/types'

const files = import.meta.glob('../../../resources/snippets/*.tpl.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const BUILTIN_SNIPPETS: readonly SnippetDef[] = Object.entries(files)
  .map(([path, body]) => ({
    name: path.slice(path.lastIndexOf('/') + 1, -'.tpl.md'.length),
    body,
    source: 'builtin' as const,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))
```

Test in `snippet-parser.test.ts`: `BUILTIN_SNIPPETS.map((s) => s.name)` equals `['aufgabe', 'header', 'meeting', 'newpage', 'telefonnotiz']`, and `meeting`'s body starts with `'---\nclient: "${1:Kunde}"'` (raw, unexpanded).

`src/shared/snippets.ts`: `export const SNIPPET_NAME_RE = /^[\p{L}\p{N}_-]+$/u` and `export const SNIPPET_EXT = '.tpl.md'`.

- [ ] **Step 5: `:header` keys equal rf-document's `header.md`**

`tests/unit/renderer/header-keys.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SNIPPETS } from '../../../src/renderer/editor/builtin-snippets'

const KEY = /^([a-z][a-z0-9_-]*):/gm
const keys = (text: string): string[] => [...text.matchAll(KEY)].map((m) => m[1] as string)

const candidates = [
  process.env.RFD_HEADER,
  join(__dirname, '..', '..', '..', '..', 'real-fast-document', 'header.md'),
  join(homedir(), '.local', 'share', 'real-fast-document', 'header.md'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'real-fast-document', 'header.md'),
].filter((p): p is string => Boolean(p))
const headerMd = candidates.find((p) => existsSync(p))

describe(':header snippet', () => {
  it.skipIf(!headerMd && !process.env.CI)('has exactly the keys of rf-document header.md', () => {
    expect(headerMd, `header.md not found in ${candidates.join(', ')}`).toBeDefined()
    const header = BUILTIN_SNIPPETS.find((s) => s.name === 'header')
    expect(keys(header?.body ?? '')).toEqual(keys(readFileSync(headerMd as string, 'utf8')))
  })
})
```

Keys compared in order. If the order differs but the set is equal, the test is right to fail: the template must mirror `header.md`. (Currently both are in the same order — verify by running.)

CI (`.github/workflows/ci.yml`), before `npm run test:coverage`:

```yaml
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          repository: jcmx9/real-fast-document
          path: .rfd
          sparse-checkout: header.md
          sparse-checkout-cone-mode: false
```

and give the coverage step `env: { RFD_HEADER: ${{ github.workspace }}/.rfd/header.md }`. Add `.rfd/` to `.gitignore`, and make sure Biome and Vitest ignore it.

- [ ] **Step 6: Run** the two test files → PASS; then the gate. Coverage of `snippet-parser.ts` ≥ 95 %.

- [ ] **Step 7: Commit**

```bash
git add resources/snippets src/renderer/editor/snippet-parser.ts src/renderer/editor/builtin-snippets.ts src/shared/snippets.ts src/shared/types.ts tests/unit/renderer/snippet-parser.test.ts tests/unit/renderer/header-keys.test.ts .github/workflows/ci.yml .gitignore
git commit -m "feat(snippets): built-in templates and a VS Code-style snippet parser"
```

---

### Task 2: User snippets from the snippet folder (main + IPC)

**Files:**
- Create: `src/main/snippets.ts`, `tests/unit/main/snippets.test.ts`
- Modify: `src/shared/ipc.ts` (`listSnippets: 'rfw:list-snippets'`), `src/shared/types.ts` (`RfwApi.listSnippets(): Promise<SnippetDef[]>`), `src/preload/index.ts`, `src/main/ipc.ts`

**Interfaces:**
- Consumes: `SnippetDef`, `SNIPPET_NAME_RE`, `SNIPPET_EXT` (Task 1), `AppContext.settings.snippetFolder`.
- Produces: `export async function loadUserSnippets(dir: string): Promise<SnippetDef[]>` (sorted by name, `source: 'user'`); `window.rfw.listSnippets()`.

- [ ] **Step 1: Failing tests** `tests/unit/main/snippets.test.ts` (real temp dirs, like `files.test.ts`):

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadUserSnippets } from '../../../src/main/snippets'

async function dir(files: Record<string, string | Buffer>): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'rfw-snip-'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(d, name), body)
  return d
}

describe('loadUserSnippets', () => {
  it('reads *.tpl.md sorted by name, keeping bytes', async () => {
    const d = await dir({ 'zeta.tpl.md': 'Z $1', 'Ä-1.tpl.md': 'A\r\nB', 'note.md': 'no' })
    expect(await loadUserSnippets(d)).toEqual([
      { name: 'zeta', body: 'Z $1', source: 'user' },
      { name: 'Ä-1', body: 'A\r\nB', source: 'user' },
    ].sort((a, b) => a.name.localeCompare(b.name)))
  })

  it('returns [] for a missing folder and does not create it', async () => {
    const missing = join(tmpdir(), `rfw-none-${Date.now()}`)
    expect(await loadUserSnippets(missing)).toEqual([])
    await expect(import('node:fs/promises').then((f) => f.stat(missing))).rejects.toThrow()
  })

  it('skips invalid UTF-8, oversized files, bad names and directories', async () => {
    const d = await dir({
      'bin.tpl.md': Buffer.from([0xff, 0xfe, 0x00]),
      'big.tpl.md': 'x'.repeat(64 * 1024 + 1),
      'bad name.tpl.md': 'x',
      'ok.tpl.md': 'ok',
    })
    await mkdir(join(d, 'dir.tpl.md'))
    expect((await loadUserSnippets(d)).map((s) => s.name)).toEqual(['ok'])
  })

  it('strips a UTF-8 BOM', async () => {
    const d = await dir({ 'b.tpl.md': Buffer.from('﻿hi', 'utf8') })
    expect((await loadUserSnippets(d))[0]?.body).toBe('hi')
  })
})
```

- [ ] **Step 2: Run, see FAIL.**

- [ ] **Step 3: Implement** `src/main/snippets.ts`:

```ts
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SNIPPET_EXT, SNIPPET_NAME_RE } from '../shared/snippets'
import type { SnippetDef } from '../shared/types'

const MAX_BYTES = 64 * 1024
const utf8 = new TextDecoder('utf-8', { fatal: true })

export async function loadUserSnippets(dir: string): Promise<SnippetDef[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: SnippetDef[] = []
  for (const file of names) {
    if (!file.endsWith(SNIPPET_EXT)) continue
    const name = file.slice(0, -SNIPPET_EXT.length)
    if (!SNIPPET_NAME_RE.test(name)) continue
    try {
      const p = join(dir, file)
      const st = await stat(p)
      if (!st.isFile() || st.size > MAX_BYTES) continue
      let body = utf8.decode(await readFile(p))
      if (body.startsWith('﻿')) body = body.slice(1)
      out.push({ name, body, source: 'user' })
    } catch (err) {
      console.warn('rf-write: Snippet übersprungen', file, err)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
```

Use the same BOM literal convention as the rest of the code base (implementer rules: U+FEFF only as an escape). `TextDecoder` with `fatal: true` throws on invalid UTF-8 → caught → skipped.

IPC: `ipcMain.handle(Ch.listSnippets, () => loadUserSnippets(ctx.settings.snippetFolder))` — no renderer-supplied path. Preload: `listSnippets: () => ipcRenderer.invoke(Ch.listSnippets)`.

- [ ] **Step 4: Run tests → PASS, gate green.**

- [ ] **Step 5: Commit** — `feat(snippets): load user snippets from the snippet folder`

---

### Task 3: Snippet completion in the editor

**Files:**
- Create: `src/renderer/editor/snippets.ts`, `tests/unit/renderer/snippets.test.ts`
- Modify: `src/renderer/editor/setup.ts` (add `snippetExtensions` to the base extensions, before the default keymap), `src/renderer/theme.css` or `styles.css` (calm completion popup)

**Interfaces:**
- Consumes: `BUILTIN_SNIPPETS`, `toCmTemplate`, `SnippetDef`.
- Produces:
  - `export const snippetRegistry: { list(): readonly SnippetDef[]; setUser(user: readonly SnippetDef[]): void }` — built-ins merged with user snippets; a user snippet replaces a built-in with the same name; result sorted by name.
  - `export function snippetSource(ctx: CompletionContext): CompletionResult | null`
  - `export const snippetExtensions: Extension`

- [ ] **Step 1: Failing tests** `tests/unit/renderer/snippets.test.ts`:

```ts
import { CompletionContext, completionStatus, currentCompletions, startCompletion, acceptCompletion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { describe, expect, it, beforeEach } from 'vitest'
import { snippetRegistry, snippetSource } from '../../../src/renderer/editor/snippets'
import { createState } from '../../../src/renderer/editor/setup'

const ctx = (doc: string, explicit = false) => {
  const state = EditorState.create({ doc })
  return new CompletionContext(state, doc.length, explicit)
}
const labels = (doc: string, explicit = false) =>
  snippetSource(ctx(doc, explicit))?.options.map((o) => o.label) ?? null

beforeEach(() => snippetRegistry.setUser([]))

describe('snippetSource', () => {
  it.each([
    [':m', true],
    ['Text :me', true],
    ['- :auf', true],
    [':', false],
    ['Hinweis:', false],
    ['10:30', false],
    ['a:b', false],
    ['Uhrzeit: ', false],
  ])('%j offers snippets: %s', (doc, offered) => {
    expect(labels(doc) !== null).toBe(offered)
  })

  it('a bare colon offers all on explicit request (Ctrl+Space)', () => {
    expect(labels(':', true)).toEqual([':aufgabe', ':header', ':meeting', ':newpage', ':telefonnotiz'])
  })

  it('replaces from the colon', () => {
    expect(snippetSource(ctx('x :mee'))?.from).toBe(2)
  })

  it('user snippets override built-ins and add new ones', () => {
    snippetRegistry.setUser([
      { name: 'meeting', body: 'mine', source: 'user' },
      { name: 'zz', body: 'z', source: 'user' },
    ])
    const list = snippetRegistry.list()
    expect(list.find((s) => s.name === 'meeting')?.body).toBe('mine')
    expect(list.map((s) => s.name)).toContain('zz')
  })
})
```

Plus a view-level test (happy-dom `EditorView` with `createState('', '\n', 'preview')`): type `:mee` via `view.dispatch({ changes, userEvent: 'input.type' })`, call `startCompletion(view)`, wait for `completionStatus(view.state) === 'active'` (poll with `await new Promise(r => setTimeout(r, 0))` a few times; CodeMirror runs sources async), `acceptCompletion(view)`, then assert the doc starts with `'---\nclient: "Kunde"'` and the selection is `Kunde`. Then press Tab via `nextSnippetField` and assert the selection is `Thema`. Then assert `'Enter'` handling: with doc `'Hinweis:'` and cursor at end, `completionStatus` stays `null` after typing.

- [ ] **Step 2: Run, see FAIL.**

- [ ] **Step 3: Implement** `src/renderer/editor/snippets.ts`:

```ts
import {
  acceptCompletion,
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionKeymap,
  snippet,
} from '@codemirror/autocomplete'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { SnippetDef } from '../../shared/types'
import { BUILTIN_SNIPPETS } from './builtin-snippets'
import { toCmTemplate } from './snippet-parser'

let user: readonly SnippetDef[] = []
let merged: readonly SnippetDef[] = BUILTIN_SNIPPETS

export const snippetRegistry = {
  list: (): readonly SnippetDef[] => merged,
  setUser(next: readonly SnippetDef[]): void {
    user = next
    const byName = new Map(BUILTIN_SNIPPETS.map((s) => [s.name, s]))
    for (const s of user) byName.set(s.name, s)
    merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  },
}

const option = (s: SnippetDef): Completion => ({
  label: `:${s.name}`,
  detail: s.source === 'user' ? 'eigenes Snippet' : 'Snippet',
  type: 'text',
  // Variables are expanded when the snippet is applied, not when the list opens.
  apply: (view, completion, from, to) =>
    snippet(toCmTemplate(s.body, new Date()))(view, completion, from, to),
})

/** `:` at line start or after whitespace, followed by at least one letter (or explicit). */
export function snippetSource(ctx: CompletionContext): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s):[\p{L}\p{N}_-]*$/u)
  if (!m) return null
  const colon = m.from + m.text.indexOf(':')
  if (colon === ctx.pos - 1 && !ctx.explicit) return null
  return {
    from: colon,
    options: merged.map(option),
    validFor: /^:[\p{L}\p{N}_-]*$/u,
  }
}

export const snippetExtensions: Extension = [
  autocompletion({ override: [snippetSource], icons: false, defaultKeymap: true }),
  Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
]
```

`completionKeymap` is included by `defaultKeymap: true` (Enter, arrows, Esc, Ctrl+Space). Tab: `acceptCompletion` returns false when no list is open, so the snippet keymap (Tab = next field, installed by `snippet()` at high precedence) and `indentWithTab` still work. Verify the precedence order with a test: with an active snippet session and no open list, Tab moves to the next field instead of indenting.

In `createState` add `snippetExtensions` to the extensions array (before `keymap.of([...foldBindings(), ...])`).

Styling: the popup `.cm-tooltip-autocomplete` uses the chrome font and tokens from `styles.css` (no heavy shadow, accent for the selected row like the flat buttons, `detail` muted). It must look right in Present (larger zoom is fine; the popup uses chrome size, not body size).

- [ ] **Step 4: Run tests → PASS, gate green.**

- [ ] **Step 5: Commit** — `feat(snippets): colon-triggered snippet completion with tab stops`

---

### Task 4: App wiring, Esc in Present, unfold on cursor

**Files:**
- Modify: `src/renderer/app.ts` (load user snippets at startup and on window focus), `src/renderer/editor/setup.ts` or `sections.ts` (unfold on cursor)
- Test: `tests/unit/renderer/sections.test.ts` (unfold), `tests/unit/renderer/snippets.test.ts` (Esc), `tests/unit/renderer/app-…` only if an app-level unit harness exists; otherwise covered by E2E in Task 5

**Interfaces:**
- Consumes: `window.rfw.listSnippets()`, `snippetRegistry.setUser()`.
- Produces: `export const unfoldOnCursor: Extension` (in `sections.ts`), added to the base extensions in `createState`.

- [ ] **Step 1: Failing test — unfold on cursor** (`sections.test.ts`): a doc `'# A\ntext\n# B\nmore'`, fold section A (`foldAllSections` or `foldEffect` for the range after `# A`), then dispatch a selection inside the folded range → `foldedRanges(state).size === 0` afterwards (or the range containing the cursor is gone). Also: a selection that only touches the fold boundary does not unfold; a fold elsewhere stays folded.

- [ ] **Step 2: Implement** as a `transactionExtender` (pure, no deferred dispatch):

```ts
export const unfoldOnCursor = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection) return null
  const folded = foldedRanges(tr.state)
  const effects: StateEffect<unknown>[] = []
  for (const r of tr.newSelection.ranges) {
    folded.between(r.from, r.to, (from, to) => {
      if (r.head > from && r.head < to) effects.push(unfoldEffect.of({ from, to }))
    })
  }
  return effects.length ? { effects } : null
})
```

`tr.state` is the new state; folds are mapped already. The header collapse (`headerFold`) is not a code fold and is not affected. A selection that ends exactly at `to` (the end of the fold) stays outside, matching CodeMirror's own behaviour.

- [ ] **Step 3: Failing test — Esc with an open list stays in Present.** At the view level: with `completionStatus === 'active'`, a keydown `Escape` on `view.contentDOM` is `defaultPrevented` (CodeMirror's `closeCompletion` handles it). `App.globalKeys` already ignores prevented events, so this test pins the contract the app relies on. The full flow is the E2E in Task 5.

- [ ] **Step 4: Load user snippets in `App`**

```ts
private async reloadSnippets(): Promise<void> {
  try {
    snippetRegistry.setUser(await window.rfw.listSnippets())
  } catch (err) {
    console.error('rf-write: Snippets konnten nicht geladen werden', err)
  }
}
```

Call it once during startup (after `startup()` resolves, without blocking the first render) and on `window.addEventListener('focus', ...)`. Concurrent reloads are harmless (last result wins; both read the same folder).

- [ ] **Step 5: Gate green. Commit** — `feat(snippets): user snippets reload on focus; unfold folds the cursor enters`

---

### Task 5: End-to-end tests and docs

**Files:**
- Create: `tests/e2e/snippets.spec.ts`
- Modify: `README.md`, `README.en.md`, `CHANGELOG.md`, local `CLAUDE.md` (not committed)

- [ ] **Step 1: E2E** `tests/e2e/snippets.spec.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickMenu, launch, makeDirs, waitForFile } from './helpers'

const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

test('new note, :meeting, tab through the stops, autosaved', async () => {
  const { app, page } = await launch()
  await clickMenu(app, 'new')
  await page.locator('.cm-content').click()
  await page.keyboard.type(':mee')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('ACME')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Kickoff')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Anna')
  const path = await page.evaluate(() => document.title) // replace with the helper that reads the active tab path, see basics.spec.ts
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('- Anna'))
  const text = saved.toString('utf8')
  expect(text.startsWith(`---\nclient: "ACME"\ntitle: "Kickoff"\ndate: ${today()}\n`)).toBe(true)
  await app.close()
})
```

Find how `basics.spec.ts` obtains the path of a new note (e.g. by listing `dirs.notes` until one `.md` appears) and use the same approach; the `document.title` line above is a placeholder for that helper and must be replaced.

Further cases in the same file:
- `'Hinweis:'` then Enter → a newline, no popup, file contains `Hinweis:\n`.
- Present: `toggle-present`, type `:mee` at the end of a body line after a space, popup visible, Esc → popup gone and `body.rf-mode-present` still present; Esc again → Edit.
- User override: `launch({ settings: { snippetFolder } })` with `<snippetFolder>/meeting.tpl.md` = `Eigenes $1`, type `:meeting`, Enter → line is `Eigenes `; a new file `kunde.tpl.md` written while the app runs appears after the window regains focus (trigger with `page.evaluate(() => window.dispatchEvent(new Event('focus')))`).
- `:newpage` inserts `\n<!-- pagebreak -->\n\n` byte-exact.

- [ ] **Step 2: Docs (exact README parity).** New section „Snippets“ / "Snippets" in both READMEs after the shortcut table: trigger (`:` + letters, Ctrl+Space for all), Enter/Tab to insert, Tab/Shift+Tab through fields, the five built-ins with one line each, user snippets as `*.tpl.md` in the snippet folder (default `~/Documents/rf-write/snippets`), override by name, supported syntax (`$1`, `${1:Vorgabe}`, `$0`, `$CURRENT_YEAR` …). CHANGELOG `[Unreleased]` → `Added`: "Snippets: `:meeting`, `:telefonnotiz`, `:aufgabe`, `:header`, `:newpage` and own `*.tpl.md` templates, triggered with `:`" and "A fold opens when the cursor moves into it". Local `CLAUDE.md`: status plans 1–4; architecture note on the snippet registry, built-ins bundled via `?raw`, `listSnippets` IPC.

- [ ] **Step 3: Final gate and commit**

Run: `diff <(grep -c '^## ' README.md) <(grep -c '^## ' README.en.md) && npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e`

```bash
git add tests/e2e/snippets.spec.ts README.md README.en.md CHANGELOG.md
git commit -m "test(e2e): cover snippets end to end; document snippets"
```

---

### Task 6: Page break from the menu and Mod+Enter (user request 2026-10-15)

**Files:**
- Modify: `src/shared/types.ts` (`MenuCommand` + `'insert-pagebreak'`), `src/main/menu.ts` (Bearbeiten → „Seitenumbruch einfügen“, `CmdOrCtrl+Enter`), `src/renderer/app.ts` (handle the command), `src/renderer/editor/setup.ts` (key binding), README de/en shortcut table, CHANGELOG
- Create: `src/renderer/editor/pagebreak.ts`, `tests/unit/renderer/pagebreak.test.ts`; extend `tests/unit/main/menu.test.ts` and `tests/e2e/snippets.spec.ts`

**Interfaces:**
- Produces: `export function insertPageBreak(view: EditorView): boolean` (a CodeMirror `Command`), `export const PAGEBREAK = '<!-- pagebreak -->'`.

Behaviour (rf-document syntax: `<!-- pagebreak -->` on its own line):
- Inserts `<!-- pagebreak -->` as its own paragraph: a blank line before it unless the cursor line is empty and the line above is empty or the document start; a blank line after it unless the next line is already empty. The cursor ends on the line after the break (start of the following empty line).
- If text is selected, the selection is replaced by the break (same rules).
- A cursor in the middle of a line splits the line: text before stays, the break follows as its own paragraph, the rest of the line continues after it.
- Works in Code, Preview and Present; refused nowhere (it is plain text editing). In Present the cursor is never in the collapsed header, so the break never lands inside the front matter.
- One undo step (`userEvent: 'input.pagebreak'`). Uses the state's line break (`state.lineBreak`), so CRLF notes stay consistent.
- Key: `Mod-Enter` with higher precedence than CodeMirror's default `insertBlankLine` binding; menu accelerator `CmdOrCtrl+Enter` (E2E clicks the menu item `insert-pagebreak`). The renderer binding and the menu accelerator must not both fire (check how zoom keys avoid double handling and follow that pattern).

Tests (state/view level, parametrised): empty doc → `<!-- pagebreak -->\n` with cursor at end + correct; `Text|` → `Text\n\n<!-- pagebreak -->\n\n`; `A|B` → `A\n\n<!-- pagebreak -->\n\nB`; cursor on an empty line between paragraphs → no doubled blank lines; selection replaced; CRLF doc keeps CRLF on save (serializeDoc); undo restores the exact original. Menu test: item `insert-pagebreak` exists in Bearbeiten with accelerator `CmdOrCtrl+Enter`. E2E: menu click in a note writes `<!-- pagebreak -->` to the saved file.

Docs: README de/en shortcut row „Mod+Enter | Seitenumbruch einfügen (`<!-- pagebreak -->`, wie rf-document)“; CHANGELOG Added: "Insert a page break (`<!-- pagebreak -->`) from the Edit menu or with Mod+Enter".

Commit: `feat(edit): insert a page break from the menu or with Mod+Enter`

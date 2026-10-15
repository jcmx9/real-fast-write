# rf-write Plan 2 – Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- The editor's Preview view looks like the real-fast-document PDF while you type: rf-document's fonts, PDF sizes and colours, Markdown marks that recede, checkboxes, alert boxes, real PDF-like tables and code blocks.
- The hidden YAML header shows the PDF's title block.
- The user can switch between Code and Preview, collapse the YAML header and fold sections by heading.

**Architecture:** Everything here is renderer-side CodeMirror work except the fonts:
- **Fonts:** the main process serves rf-document's font files through a privileged `rfw-font://` protocol.
- **Front matter:** a small `@lezer/markdown` extension parses it as its own block.
- **Preview look:** a `ViewPlugin` builds the decorations from the syntax tree for the visible ranges. `buildPreview(state)` is pure and unit-tested.
- **YAML header toggle:** a `StateField` with atomic ranges.
- **Code/Preview switch:** reconfigures the existing `viewCompartment` on every tab. The text is never touched.

**Tech Stack:**
- Electron 44, CodeMirror 6 (`@codemirror/view`, `state`, `language`, `lang-markdown`, `language-data`), `@lezer/markdown`, `@lezer/highlight`
- Vitest with happy-dom, Playwright (Electron)

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md` (§4 Edit, §5 Preview rendering, YAML header toggle, Section folding, §10 menus, §12 fonts)

**Builds on:** Plan 1, merged in `dev` at `a00c6f5`. Relevant existing code:
- `src/renderer/editor/setup.ts` (`createState`, `viewCompartment`, `viewExtensions`, `serializeDoc`)
- `src/renderer/app.ts`: the `App` class. It routes editor transactions to the shown tab through `shownId`, keeps a per-tab save chain in `saving`, and holds `view: View`.
- `src/renderer/tabs/tab-store.ts`: `Tab.headerHidden` already exists and is persisted in the session.
- `src/main/menu.ts`: `buildMenuTemplate` already has an empty "Ansicht" menu, plus dev items.
- `src/main/context.ts`: `AppContext`, `startup()` returns `StartupState`.
- `src/renderer/index.html`: its CSP already allows `font-src 'self' rfw-font:`.

## Global Constraints

- **Branch:** work on `feature/preview`, branched from `dev`. Open a PR into `dev`, and merge only when CI is green on macOS, Windows and Linux.
- **Commits:** Conventional Commits in English. No `Co-Authored-By` or other AI attribution lines. The author identity is `jcmx9`; never use the real name.
- **`CLAUDE.md`** is ignored by the user's global gitignore on purpose. Update it locally and never `git add` it.
- **Byte-exact files:** switching views, toggling the header, folding and rendering never change the document. The only edit Preview makes is the checkbox click, which changes exactly one character.
- **No `innerHTML`** with document content. Widgets build DOM with `textContent`.
- **Invisible characters:** write U+FEFF as the escape `'\uFEFF'`. Never paste the literal character.
- **Language:** German UI strings, English code and comments.
- **Theme values:**
  - Values come from `~/GitHub/zettlr_rfdoc-Export/zettlr/rfdoc-zettlr.css`, which derives them from rf-document's `template.typ`. Only the values are ported; Zettlr's selectors are not reused.
  - Light theme only. Dark mode is a later item in the spec.
  - Weights in the editor are nominal: text 400, headings 560, `###` 400, bold 600.
- **Font files:** they are looked up in `$RFD_HOME/fonts`, otherwise in `${XDG_DATA_HOME:-~/.local/share}/real-fast-document/fonts`, and on Windows in `%LOCALAPPDATA%\real-fast-document\fonts`.
  - Families: `rfdoc Sans` (SourceSans3VF-Upright/Italic.otf), `rfdoc Serif` (SourceSerif4Variable-Roman/Italic.otf), `rfdoc Code` (SourceCodeVF-Upright/Italic.otf), `rfdoc Emoji` (`NotoEmoji[wght].ttf`), `rfdoc Symbols` (NotoSansSymbols2-Regular.ttf).
- **Page geometry:** the A4 text width is 145 mm, which at 10 pt body text is about 41 em. Preview uses body 10 pt, line-height 1.5, oldstyle figures, `#` 14 pt with a hairline, `##` 12 pt, `###` underlined, `####` and below italic, and code at 9 pt.
- **Tables** look like rf-document's table: real columns, a centred bold head, alignment from the delimiter row (otherwise numbers right-aligned), every second data row striped, vertical rules and a rule under the head. They become Markdown text only while the cursor is inside them.
- **The hidden YAML header** shows rf-document's title block (client, title, subtitle, "date · author") instead of the YAML lines.
- **Justified text** is used only if German `hyphens: auto` works in this Electron build, as detected at runtime. Otherwise text is set flush-left. Headings, tables and code are always flush-left.

## Review Focus

1. **The checkbox click changes exactly one character** (` ` ↔ `x`) in the right task, and nothing else on disk. Tests: Task 5 unit, Task 10 E2E with byte comparison.
2. **YAML that looks like a setext heading** (`title: x` followed by `---`) must never become a heading, a fold or a styled block. The front matter must stay a single unit. Tests: Task 3.
3. **Hiding the header while the cursor is inside it** moves the cursor out, and the cursor cannot enter the collapsed block again. The document is unchanged. Tests: Task 7.
4. **Switching Code ↔ Preview, or toggling header and folds**, leaves the bytes on disk unchanged and keeps undo history and cursor. Tests: Task 8 unit, Task 10 E2E.
5. **Missing fonts:** the app keeps working with system fonts and shows one notice. A request for any file outside the whitelist returns 404 (no path traversal through the protocol). Tests: Task 1 unit, Task 10 E2E.
6. **Table widget:** it never changes text. A click enters Markdown editing at the table, the widget returns when the cursor leaves, and cell content is rendered as text, never as HTML. Tests: Task 6 unit, Task 10 E2E.
7. **Title block:** it shows only the fields that are set and formats dates like rf-document. Raw YAML values are never interpreted as HTML. Tests: Task 7 unit, Task 10 E2E.

## Not in this plan

- **Present mode**, including always hiding the header there, plus zoom and the info line: Plan 3.
- **Unfold when the cursor moves into a folded range** (e.g. a snippet tab stop): Plan 4, together with snippets.
- **Dark mode:** a later item in the spec.
- **Open follow-ups from Plan 1** (path spellings, non-UTF-8 external change, watcher re-arm): a separate fix plan before the first release.

## File Structure

```
src/main/fonts.ts               fontDir(), FONT_FILES, fontFileFor(), fontStatus()   (pure, tested)
src/main/font-protocol.ts       registerFontScheme() before ready, handleFontProtocol(dir) after ready
src/main/index.ts               (modify) register scheme + handler
src/main/context.ts             (modify) font status in StartupState
src/main/menu.ts                (modify) Ansicht menu entries
src/shared/types.ts             (modify) FontStatus, StartupState.fonts, MenuCommand additions
src/renderer/theme.css          tokens + @font-face + Preview/Code styles
src/renderer/main.ts            (modify) import theme.css, hyphenation probe
src/renderer/ui/hyphenation.ts  supportsGermanHyphenation(document)
src/renderer/editor/frontmatter.ts  Frontmatter MarkdownConfig, frontmatterRange(), frontmatterFields()
src/renderer/editor/titleblock.ts   titleBlockData(), formatDate(), renderTitleBlock()  (PDF title block)
src/renderer/editor/inline-render.ts renderInline() – Markdown inline → DOM (no innerHTML)
src/renderer/editor/tables.ts       tableModel(), tableField (PDF-like table widget)
src/renderer/editor/highlight.ts    rfHighlight (HighlightStyle with CSS classes)
src/renderer/editor/preview.ts      buildPreview(), previewPlugin, toggleTaskAt(), widgets
src/renderer/editor/header.ts       headerHidden field, setHeaderHidden, headerFold, headerToggleSpec()
src/renderer/editor/sections.ts     sectionFoldRanges(), foldAllSections()
src/renderer/editor/setup.ts        (modify) wire everything into base/view extensions
src/renderer/app.ts                 (modify) view switch, header toggle, folding, font notice
tests/unit/main/fonts.test.ts
tests/unit/renderer/{frontmatter,preview,header,sections,setup}.test.ts
tests/e2e/preview.spec.ts, tests/fixtures/preview.md
```

---

### Task 1: Serve rf-document's fonts to the renderer

**Files:**
- Create: `src/main/fonts.ts`, `src/main/font-protocol.ts`, `tests/unit/main/fonts.test.ts`
- Modify: `src/shared/types.ts`, `src/main/index.ts`, `src/main/context.ts`, `vitest.config.ts` (exclude `font-protocol.ts` from coverage)

**Interfaces:**
- Produces:
  - `FONT_FILES: readonly string[]` and `CORE_FONT_FILES: readonly string[]` (the six Source files)
  - `fontDir(platform: NodeJS.Platform, env: Record<string, string | undefined>, home: string): string`
  - `fontFileFor(dir: string, urlPath: string): string | null`
  - `fontStatus(dir: string): Promise<FontStatus>`
  - `registerFontScheme(): void` (call before `app` is ready) and `handleFontProtocol(dir: string): void` (call after ready)
  - In `src/shared/types.ts`: `interface FontStatus { dir: string; found: boolean; missing: string[] }`, and `StartupState` gains `fonts: FontStatus`
- URL scheme: `rfw-font://fonts/<file name, URI-encoded>`

- [ ] **Step 0: Branch**

```bash
git checkout dev && git pull && git checkout -b feature/preview
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/main/fonts.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORE_FONT_FILES, FONT_FILES, fontDir, fontFileFor, fontStatus } from '../../../src/main/fonts'

describe('fontDir', () => {
  it('uses RFD_HOME when set', () => {
    expect(fontDir('darwin', { RFD_HOME: '/opt/rfd' }, '/Users/u')).toBe('/opt/rfd/fonts')
  })
  it('uses XDG_DATA_HOME, then ~/.local/share on macOS/Linux', () => {
    expect(fontDir('linux', { XDG_DATA_HOME: '/x' }, '/home/u')).toBe('/x/real-fast-document/fonts')
    expect(fontDir('darwin', {}, '/Users/u')).toBe('/Users/u/.local/share/real-fast-document/fonts')
  })
  it('uses LOCALAPPDATA on Windows', () => {
    expect(fontDir('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\real-fast-document\\fonts',
    )
    expect(fontDir('win32', {}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\real-fast-document\\fonts')
  })
})

describe('fontFileFor', () => {
  const dir = path.resolve('/fonts')
  it('maps a whitelisted, URI-encoded name into the font folder', () => {
    expect(fontFileFor(dir, '/SourceSans3VF-Upright.otf')).toBe(join(dir, 'SourceSans3VF-Upright.otf'))
    expect(fontFileFor(dir, '/NotoEmoji%5Bwght%5D.ttf')).toBe(join(dir, 'NotoEmoji[wght].ttf'))
  })
  it.each(['/../secret.otf', '/%2E%2E%2Fsecret.otf', '/evil.otf', '/', '/fonts/SourceSans3VF-Upright.otf', '/%E0%A4%A'])(
    'rejects %s',
    (p) => expect(fontFileFor(dir, p)).toBeNull(),
  )
})

describe('fontStatus', () => {
  it('reports missing core files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-fonts-'))
    await writeFile(join(dir, 'SourceSans3VF-Upright.otf'), 'x')
    const s = await fontStatus(dir)
    expect(s.found).toBe(false)
    expect(s.missing).toContain('SourceSerif4Variable-Roman.otf')
    expect(s.missing).not.toContain('SourceSans3VF-Upright.otf')
  })
  it('is found when all core files exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-fonts-'))
    for (const f of CORE_FONT_FILES) await writeFile(join(dir, f), 'x')
    expect(await fontStatus(dir)).toEqual({ dir, found: true, missing: [] })
  })
  it('lists all served files', () => {
    expect(FONT_FILES).toEqual(expect.arrayContaining([...CORE_FONT_FILES, 'NotoEmoji[wght].ttf', 'NotoSansSymbols2-Regular.ttf']))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/main/fonts.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement the pure part**

`src/main/fonts.ts`:

```ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FontStatus } from '../shared/types'

export const CORE_FONT_FILES = [
  'SourceSans3VF-Upright.otf',
  'SourceSans3VF-Italic.otf',
  'SourceSerif4Variable-Roman.otf',
  'SourceSerif4Variable-Italic.otf',
  'SourceCodeVF-Upright.otf',
  'SourceCodeVF-Italic.otf',
] as const

export const FONT_FILES: readonly string[] = [
  ...CORE_FONT_FILES,
  'NotoEmoji[wght].ttf',
  'NotoSansSymbols2-Regular.ttf',
]

/** rf-document's install folder for fonts (same rules as its bootstrap). */
export function fontDir(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (env.RFD_HOME) return p.join(env.RFD_HOME, 'fonts')
  if (platform === 'win32') {
    return p.join(env.LOCALAPPDATA ?? p.join(home, 'AppData', 'Local'), 'real-fast-document', 'fonts')
  }
  return p.join(env.XDG_DATA_HOME ?? p.join(home, '.local', 'share'), 'real-fast-document', 'fonts')
}

/** Only whitelisted file names are served; anything else (paths, traversal) is refused. */
export function fontFileFor(dir: string, urlPath: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(urlPath.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return FONT_FILES.includes(name) ? path.join(dir, name) : null
}

export async function fontStatus(dir: string): Promise<FontStatus> {
  const missing: string[] = []
  for (const f of CORE_FONT_FILES) {
    try {
      await fs.access(path.join(dir, f))
    } catch {
      missing.push(f)
    }
  }
  return { dir, found: missing.length === 0, missing }
}
```

In `src/shared/types.ts`, add the following and extend `StartupState` with `fonts: FontStatus`:

```ts
export interface FontStatus {
  dir: string
  found: boolean
  missing: string[]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/main/fonts.test.ts`
Expected: PASS.

- [ ] **Step 5: Protocol and wiring**

`src/main/font-protocol.ts`:

```ts
import { promises as fs } from 'node:fs'
import { protocol } from 'electron'
import { fontFileFor } from './fonts'

export const FONT_SCHEME = 'rfw-font'

/** Must run before the app is ready. */
export function registerFontScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: FONT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ])
}

/** Serves only whitelisted font files from `dir`. */
export function handleFontProtocol(dir: string): void {
  protocol.handle(FONT_SCHEME, async (request) => {
    const file = fontFileFor(dir, new URL(request.url).pathname)
    if (!file) return new Response('not found', { status: 404 })
    try {
      const data = await fs.readFile(file)
      const type = file.endsWith('.ttf') ? 'font/ttf' : 'font/otf'
      return new Response(data, { headers: { 'content-type': type } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
```

Changes in `src/main/index.ts`:
- Import `registerFontScheme` and `handleFontProtocol`.
- Call `registerFontScheme()` right after the `RFW_USER_DATA` line. That is top level, so it runs before ready.
- In the `whenReady` callback, after `await ctx.load()`, call `handleFontProtocol(ctx.fonts.dir)`.

Changes in `src/main/context.ts`:
- Add the field `fonts: FontStatus` with initial value `{ dir: '', found: false, missing: [] }`.
- At the end of `load()`, set `this.fonts = await fontStatus(fontDir(process.platform, process.env, homedir()))`.
- `startup()` returns `{ …existing, fonts: this.fonts }`.

In `vitest.config.ts`, add `'src/main/font-protocol.ts'` to `coverage.exclude`, because it needs the Electron runtime.

- [ ] **Step 6: Gate and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: green.

```bash
git add src/main/fonts.ts src/main/font-protocol.ts src/main/index.ts src/main/context.ts src/shared/types.ts vitest.config.ts tests/unit/main/fonts.test.ts
git commit -m "feat(fonts): serve rf-document's fonts over a whitelisted rfw-font protocol"
```

---

### Task 2: Theme stylesheet and hyphenation probe

**Files:**
- Create: `src/renderer/theme.css`, `src/renderer/ui/hyphenation.ts`
- Modify: `src/renderer/main.ts`, `src/renderer/styles.css` (remove the old `#editor .cm-scroller` monospace rule; the theme now owns editor fonts)

**Interfaces:**
- Produces:
  - The CSS classes that Tasks 4–8 emit. The class list below is the contract.
  - `supportsGermanHyphenation(doc: Document): boolean`
  - The root class `html.rf-justify`, set when hyphenation works.
- The class contract:
  - Editor: `.rf-preview` and `.rf-code` on `.cm-editor`.
  - Lines: `rf-h1` … `rf-h6`, `rf-quote`, `rf-alert` plus `rf-alert-note|tip|important|warning|caution`, `rf-table-head`, `rf-table-delim`, `rf-table-row`, `rf-table-stripe`, `rf-codeblock`, `rf-codefence`, `rf-hr`, `rf-frontmatter`.
  - Inline: `rf-mark`, `rf-strong`, `rf-em`, `rf-strike`, `rf-code-inline`, `rf-link`, `rf-comment`.
  - Widgets:
    - `rf-bullet`, `rf-task` (an input), `rf-alert-title`
    - `rf-table-wrap` › `table.rf-table` with `tr.rf-table-stripe` and cells `.rf-al-left|center|right`
    - `rf-titleblock` with `rf-tb-client`, `rf-tb-title`, `rf-tb-subtitle`, `rf-tb-meta`, and `rf-titleblock-empty`
  - Tokens: `rf-tok-heading`, `rf-tok-strong`, `rf-tok-em`, `rf-tok-link`, `rf-tok-mark`, `rf-tok-keyword`, `rf-tok-string`, `rf-tok-number`, `rf-tok-comment`, `rf-tok-function`, `rf-tok-meta`.

- [ ] **Step 1: Write `src/renderer/theme.css`**

```css
/*
 * rf-write editor theme. Every value mirrors real-fast-document's PDF
 * (template.typ), ported from zettlr_rfdoc-Export/zettlr/rfdoc-zettlr.css.
 * Weights are nominal (400/500/600): Chromium draws the variable Source
 * fonts lighter than PDF viewers, rf-document sets its PDF slightly below.
 */

@font-face { font-family: "rfdoc Sans"; font-style: normal; font-weight: 200 900; font-display: swap; src: url("rfw-font://fonts/SourceSans3VF-Upright.otf") format("opentype"); }
@font-face { font-family: "rfdoc Sans"; font-style: italic; font-weight: 200 900; font-display: swap; src: url("rfw-font://fonts/SourceSans3VF-Italic.otf") format("opentype"); }
@font-face { font-family: "rfdoc Serif"; font-style: normal; font-weight: 200 900; font-display: swap; src: url("rfw-font://fonts/SourceSerif4Variable-Roman.otf") format("opentype"); }
@font-face { font-family: "rfdoc Serif"; font-style: italic; font-weight: 200 900; font-display: swap; src: url("rfw-font://fonts/SourceSerif4Variable-Italic.otf") format("opentype"); }
@font-face { font-family: "rfdoc Code"; font-style: normal; font-weight: 200 900; font-display: swap; src: url("rfw-font://fonts/SourceCodeVF-Upright.otf") format("opentype"); }
@font-face { font-family: "rfdoc Code"; font-style: italic; font-weight: 200 900; font-display: swap; src: url("rfw-font://fonts/SourceCodeVF-Italic.otf") format("opentype"); }
@font-face { font-family: "rfdoc Emoji"; font-style: normal; font-weight: 300 700; font-display: swap; src: url("rfw-font://fonts/NotoEmoji%5Bwght%5D.ttf") format("truetype"); }
@font-face { font-family: "rfdoc Symbols"; font-style: normal; font-weight: 400; font-display: swap; src: url("rfw-font://fonts/NotoSansSymbols2-Regular.ttf") format("truetype"); }

:root {
  --rfd-font-sans: "rfdoc Sans", "rfdoc Emoji", "rfdoc Symbols", "Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif;
  --rfd-font-serif: "rfdoc Serif", "rfdoc Emoji", "rfdoc Symbols", "Source Serif 4", Georgia, serif;
  --rfd-font-code: "rfdoc Code", "rfdoc Emoji", "Source Code Pro", ui-monospace, Menlo, Consolas, monospace;

  --rfd-bg: #fff;
  --rfd-text: #212121;
  --rfd-heading: #141414;
  --rfd-chrome: #333;
  --rfd-task-border: #595959;
  --rfd-hairline: #999;
  --rfd-faint: #9e9e9e;
  --rfd-code-bg: #f5f5f5;
  --rfd-table-stripe: #f5f5f5;
  --rfd-table-rule: #ccc;
  --rfd-table-head-rule: #737373;
  --rfd-selection: #dcdcdc;

  --rfd-alert-note: #2f6aa8;
  --rfd-alert-tip: #3b7d3a;
  --rfd-alert-important: #7a4fb0;
  --rfd-alert-warning: #b05a1a;
  --rfd-alert-caution: #b5452b;

  --rfd-syntax-comment: #8a8a8a;
  --rfd-syntax-string: #298e0d;
  --rfd-syntax-keyword: #d73a49;
  --rfd-syntax-function: #4b69c6;
  --rfd-syntax-number: #b60157;

  /* template.typ: body 10pt; Plan 3 scales this for zoom/Present */
  --rf-body-size: 10pt;
  /* A4 text width 145mm at 10pt ≈ 41em */
  --rf-measure: 41em;
}

/* ── shared editor chrome ─────────────────────────────────────────────── */

.cm-editor {
  background: var(--rfd-bg);
  color: var(--rfd-text);
}
.cm-editor .cm-selectionBackground,
.cm-editor.cm-focused .cm-selectionBackground {
  background: var(--rfd-selection);
}
.cm-editor .cm-foldGutter .cm-gutterElement {
  opacity: 0;
  transition: opacity 0.15s;
}
.cm-editor .cm-gutters:hover .cm-foldGutter .cm-gutterElement {
  opacity: 1;
}
.cm-editor .cm-gutters {
  background: var(--rfd-bg);
  border: none;
  color: var(--rfd-faint);
}

/* ── Code view: the raw source ────────────────────────────────────────── */

.rf-code .cm-scroller {
  font-family: var(--rfd-font-code);
  font-size: 9pt;
  line-height: 1.5;
}
.rf-code .rf-tok-heading { font-weight: 600; color: var(--rfd-heading); }
.rf-code .rf-tok-strong { font-weight: 600; }
.rf-code .rf-tok-em { font-style: italic; }
.rf-code .rf-tok-link { text-decoration: underline dotted var(--rfd-faint); }
.rf-code .rf-tok-mark,
.rf-code .rf-tok-meta { color: var(--rfd-faint); }

/* ── Preview: the PDF look ─────────────────────────────────────────────── */

.rf-preview .cm-scroller {
  font-family: var(--rfd-font-sans);
  font-size: var(--rf-body-size);
  line-height: 1.5;
  font-weight: 400;
  font-variant-numeric: oldstyle-nums proportional-nums;
}
.rf-preview .cm-content {
  max-width: var(--rf-measure);
  margin: 0 auto;
  padding: 2em 1.5em 40vh;
}
html.rf-justify .rf-preview .cm-line {
  text-align: justify;
  hyphens: auto;
}

/* Headings: serif, flush-left */
.rf-preview .cm-line:is(.rf-h1, .rf-h2, .rf-h3, .rf-h4, .rf-h5, .rf-h6) {
  font-family: var(--rfd-font-serif);
  color: var(--rfd-heading);
  font-weight: 560;
  text-align: left;
  hyphens: manual;
}
.rf-preview .cm-line.rf-h1 { font-size: 1.4em; padding-bottom: 0.1em; border-bottom: 0.6pt solid var(--rfd-hairline); }
.rf-preview .cm-line.rf-h2 { font-size: 1.2em; }
.rf-preview .cm-line.rf-h3 { font-weight: 400; text-decoration: underline; text-decoration-thickness: 0.5pt; text-underline-offset: 2pt; }
.rf-preview .cm-line:is(.rf-h4, .rf-h5, .rf-h6) { font-weight: 400; font-style: italic; }

/* Spacing like the PDF: blank lines carry the paragraph/heading gaps */
.rf-preview .cm-line:has(> br:only-child) { line-height: 1.1em; }
.rf-preview .cm-line:has(> br:only-child):has(+ .rf-h1) { line-height: 2em; }
.rf-preview .cm-line:has(> br:only-child):has(+ .rf-h2) { line-height: 1.5em; }
.rf-preview .cm-line:has(> br:only-child):has(+ :is(.rf-h3, .rf-h4, .rf-h5, .rf-h6)) { line-height: 1.25em; }
.rf-preview .cm-line:is(.rf-h1, .rf-h2, .rf-h3, .rf-h4, .rf-h5, .rf-h6) + .cm-line:has(> br:only-child) { line-height: 0.6em; }

/* Marks recede; inline styles as in the PDF */
.rf-preview .rf-mark { color: var(--rfd-faint); }
.rf-preview .rf-strong { font-weight: 600; }
.rf-preview .rf-em { font-style: italic; }
.rf-preview .rf-strike { text-decoration: line-through; }
.rf-preview .rf-link { text-decoration: underline dotted var(--rfd-faint); }
.rf-preview .rf-code-inline { font-family: var(--rfd-font-code); font-size: 0.9em; font-variant-numeric: normal; }
.rf-preview .rf-comment { color: var(--rfd-faint); font-family: var(--rfd-font-code); font-size: 0.9em; }

/* Lists: rf-document's small square */
.rf-preview .rf-bullet {
  position: relative;
  display: inline-block;
  width: 0.72em;
}
.rf-preview .rf-bullet::before {
  position: absolute;
  top: 50%;
  left: 0.2em;
  width: 0.32em;
  height: 0.32em;
  background: var(--rfd-chrome);
  content: "";
  transform: translateY(-35%);
}
.rf-preview .rf-task {
  margin: 0 0.35em 0 0;
  vertical-align: -0.1em;
  accent-color: var(--rfd-chrome);
  cursor: pointer;
}

/* Quotes: italic, indented both sides */
.rf-preview .cm-line.rf-quote { padding-left: 2em; padding-right: 2em; font-style: italic; }

/* Alerts: 2.5pt bar left, tinted background, small spaced caps title */
.rf-preview .cm-line.rf-alert {
  padding-left: 1em;
  padding-right: 0.8em;
  border-left: 2.5pt solid var(--rf-alert-color);
  background: color-mix(in srgb, var(--rf-alert-color) 7%, var(--rfd-bg));
  font-style: normal;
}
.rf-preview .rf-alert-note { --rf-alert-color: var(--rfd-alert-note); }
.rf-preview .rf-alert-tip { --rf-alert-color: var(--rfd-alert-tip); }
.rf-preview .rf-alert-important { --rf-alert-color: var(--rfd-alert-important); }
.rf-preview .rf-alert-warning { --rf-alert-color: var(--rfd-alert-warning); }
.rf-preview .rf-alert-caution { --rf-alert-color: var(--rfd-alert-caution); }
.rf-preview .rf-alert-title {
  color: var(--rf-alert-color);
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Tables: 9pt medium, lining tabular figures, stripes, rule under head */
.rf-preview .cm-line:is(.rf-table-head, .rf-table-row, .rf-table-delim) {
  font-size: 0.9em;
  font-weight: 500;
  font-variant-numeric: lining-nums tabular-nums;
  text-align: left;
  hyphens: manual;
}
.rf-preview .cm-line.rf-table-head { font-weight: 600; border-bottom: 0.7pt solid var(--rfd-table-head-rule); }
.rf-preview .cm-line.rf-table-delim { color: var(--rfd-faint); font-size: 0.7em; line-height: 1; }
.rf-preview .cm-line.rf-table-stripe { background: var(--rfd-table-stripe); }

/* Table widget (cursor elsewhere): like rf-document's #show table */
.rf-preview .rf-table-wrap { margin: 1.2em 0 1.4em; overflow-x: auto; cursor: text; }
.rf-preview table.rf-table {
  border-collapse: collapse;
  font-size: 0.9em;
  font-weight: 500;
  letter-spacing: -0.02em;
  font-variant-numeric: lining-nums tabular-nums;
  text-align: left;
  hyphens: manual;
}
.rf-preview table.rf-table :is(th, td) { padding: 7pt 5pt; vertical-align: top; }
.rf-preview table.rf-table :is(th, td) + :is(th, td) { border-left: 0.4pt solid var(--rfd-table-rule); }
.rf-preview table.rf-table th { font-weight: 600; text-align: center; border-bottom: 0.7pt solid var(--rfd-table-head-rule); }
.rf-preview table.rf-table tr.rf-table-stripe td { background: var(--rfd-table-stripe); }
.rf-preview table.rf-table .rf-al-left { text-align: left; }
.rf-preview table.rf-table .rf-al-center { text-align: center; }
.rf-preview table.rf-table .rf-al-right { text-align: right; }
.rf-preview table.rf-table code { font-family: var(--rfd-font-code); font-size: 0.94em; font-weight: 400; }

/* Code blocks: 9pt code font on light grey, Typst syntax colours */
.rf-preview .cm-line:is(.rf-codeblock, .rf-codefence) {
  font-family: var(--rfd-font-code);
  font-size: 0.9em;
  font-variant-numeric: normal;
  background: var(--rfd-code-bg);
  text-align: left;
  hyphens: manual;
}
.rf-preview .cm-line.rf-codefence { color: var(--rfd-faint); }
.cm-editor .rf-tok-keyword { color: var(--rfd-syntax-keyword); }
.cm-editor .rf-tok-string { color: var(--rfd-syntax-string); }
.cm-editor .rf-tok-number { color: var(--rfd-syntax-number); }
.cm-editor .rf-tok-comment { color: var(--rfd-syntax-comment); }
.cm-editor .rf-tok-function { color: var(--rfd-syntax-function); }

/* Rule, front matter */
.rf-preview .cm-line.rf-hr { border-bottom: 0.6pt solid var(--rfd-hairline); line-height: 0.75em; }
.rf-preview .cm-line.rf-frontmatter {
  font-family: var(--rfd-font-code);
  font-size: 0.85em;
  color: var(--rfd-faint);
  text-align: left;
  hyphens: manual;
}
.rf-preview .rf-titleblock { margin: 0.2em 0 1.6em; text-align: center; cursor: default; }
.rf-preview .rf-tb-client { margin-bottom: 1em; font-size: 0.9em; letter-spacing: 0.12em; text-transform: uppercase; color: var(--rfd-chrome); }
.rf-preview .rf-tb-title { margin-bottom: 0.56em; font-family: var(--rfd-font-serif); font-size: 1.6em; font-weight: 560; line-height: 1.2; color: var(--rfd-heading); }
.rf-preview .rf-tb-subtitle { margin-bottom: 0.92em; font-family: var(--rfd-font-serif); font-size: 1.2em; color: var(--rfd-chrome); }
.rf-preview .rf-tb-meta { font-size: 0.9em; color: var(--rfd-chrome); }
.rf-preview .rf-titleblock-empty { margin: 0; text-align: left; font-size: 0.85em; color: var(--rfd-faint); }
```

- [ ] **Step 2: Hyphenation probe**

`src/renderer/ui/hyphenation.ts`:

```ts
/** True when this Chromium hyphenates German: a long word then wraps instead of overflowing. */
export function supportsGermanHyphenation(doc: Document): boolean {
  const probe = doc.createElement('div')
  probe.lang = 'de'
  probe.style.cssText =
    'position:absolute;visibility:hidden;left:-9999px;width:5em;font-size:16px;hyphens:auto;overflow-wrap:normal;word-break:normal'
  probe.textContent = 'Donaudampfschifffahrtsgesellschaftskapitänsmütze'
  doc.body.append(probe)
  const fits = probe.scrollWidth <= probe.clientWidth + 1
  probe.remove()
  return fits
}
```

Changes in `src/renderer/main.ts`:
- Add `import './theme.css'` after `import './styles.css'`.
- Before `new App(…)`, add:

```ts
if (supportsGermanHyphenation(document)) document.documentElement.classList.add('rf-justify')
```

- In `src/renderer/styles.css`, delete the rule `#editor .cm-scroller { font-family: ui-monospace, monospace; }`.

- [ ] **Step 3: Gate and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: green. The probe has no unit test, because happy-dom does no layout. Task 10 records its result in the E2E output.

```bash
git add src/renderer/theme.css src/renderer/ui/hyphenation.ts src/renderer/main.ts src/renderer/styles.css
git commit -m "feat(theme): add PDF-look stylesheet and runtime hyphenation probe"
```

---

### Task 3: Front matter as its own Markdown block

**Files:**
- Create: `src/renderer/editor/frontmatter.ts`, `tests/unit/renderer/frontmatter.test.ts`
- Modify: `package.json` (add `@lezer/highlight` as a devDependency; it is already transitively installed)

**Interfaces:**
- Produces:
  - `Frontmatter: MarkdownConfig` with nodes `Frontmatter` (block) and `FrontmatterMark`
  - `frontmatterRange(doc: Text): { from: number; to: number } | null` — `to` is the end of the closing delimiter line
  - `frontmatterFields(doc: Text): Record<string, string>`: flat `key: value` pairs, cleaned like rf-document's `yaml_str`. A quoted value is taken up to its closing quote, `[a, b]` becomes `a, b`, and otherwise a trailing ` # comment` is cut.
- The rule matches rf-document and pandoc: line 1 is exactly `---` (trailing spaces allowed), and the block closes at the first later line that is `---` or `...`. A block that never closes is not front matter: its lines stay normal Markdown as far as `frontmatterRange` is concerned. The parser consumes them as `Frontmatter`, so no heading is produced while the user is still typing the header.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/frontmatter.test.ts`:

```ts
// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { EditorState, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Frontmatter, frontmatterFields, frontmatterRange } from '../../../src/renderer/editor/frontmatter'

const doc = (s: string) => Text.of(s.split('\n'))

function topNodes(text: string): string[] {
  const state = EditorState.create({
    doc: text,
    extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const names: string[] = []
  const c = syntaxTree(state).topNode.firstChild
  for (let n = c; n; n = n.nextSibling) names.push(n.name)
  return names
}

describe('frontmatterRange', () => {
  it('finds a closed header', () => {
    const t = '---\ntitle: "X"\n---\n\n# Body'
    expect(frontmatterRange(doc(t))).toEqual({ from: 0, to: t.indexOf('\n\n') })
  })
  it('accepts ... as closing delimiter and trailing spaces', () => {
    expect(frontmatterRange(doc('---  \na: 1\n...\nrest'))).toEqual({ from: 0, to: 14 })
  })
  it.each(['title: x\n---', '\n---\na: 1\n---', '---\na: 1', '--- \n', '# x'])('is null for %j', (t) => {
    expect(frontmatterRange(doc(t))).toBeNull()
  })
})

describe('frontmatterFields', () => {
  it('cleans values like rf-document', () => {
    const t = [
      '---',
      'title: "Kickoff Firma X"   # Titel',
      "subtitle: 'Protokoll'",
      'client: Muster GmbH  # Kunde',
      'author: [Anna, "Ben"]',
      'date: 2026-10-14',
      'leer:',
      '---',
    ].join('\n')
    expect(frontmatterFields(doc(t))).toEqual({
      title: 'Kickoff Firma X',
      subtitle: 'Protokoll',
      client: 'Muster GmbH',
      author: 'Anna, Ben',
      date: '2026-10-14',
      leer: '',
    })
  })
  it('is empty without front matter', () => {
    expect(frontmatterFields(doc('# kein header'))).toEqual({})
  })
})

describe('Frontmatter parser', () => {
  it('parses the header as one block, never as a setext heading', () => {
    expect(topNodes('---\ntitle: x\n---\n\n# Body\n')).toEqual(['Frontmatter', 'ATXHeading1'])
  })
  it('does not treat a later --- block as front matter', () => {
    expect(topNodes('Text\n\n---\na: 1\n---\n')).not.toContain('Frontmatter')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/frontmatter.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

```bash
npm install -D @lezer/highlight@^1.2.5
```

`src/renderer/editor/frontmatter.ts`:

```ts
import type { Text } from '@codemirror/state'
import { tags as t } from '@lezer/highlight'
import type { BlockContext, Element, Line, MarkdownConfig } from '@lezer/markdown'

const OPEN = /^---\s*$/
const CLOSE = /^(---|\.\.\.)\s*$/

/** YAML front matter: only at the very start, `---` … `---`/`...` (rf-document/pandoc rule). */
export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: t.meta },
    { name: 'FrontmatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line): boolean {
        if (cx.lineStart !== 0 || !OPEN.test(line.text)) return false
        const marks: Element[] = [cx.elt('FrontmatterMark', 0, line.text.length)]
        let end = line.text.length
        while (cx.nextLine()) {
          end = cx.lineStart + line.text.length
          if (CLOSE.test(line.text)) {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, end))
            cx.nextLine()
            break
          }
        }
        // An unclosed header still forms one block, so typing it never yields setext headings.
        cx.addElement(cx.elt('Frontmatter', 0, end, marks))
        return true
      },
    },
  ],
}

export function frontmatterRange(doc: Text): { from: number; to: number } | null {
  if (doc.lines < 2 || !OPEN.test(doc.line(1).text)) return null
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (CLOSE.test(line.text)) return { from: 0, to: line.to }
  }
  return null
}

/** Flat `key: value` pairs, cleaned like rf-document's yaml_str (build.sh). */
export function frontmatterFields(doc: Text): Record<string, string> {
  const range = frontmatterRange(doc)
  const out: Record<string, string> = {}
  if (!range) return out
  const lines = doc.sliceString(range.from, range.to).split('\n').slice(1, -1)
  for (const raw of lines) {
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(raw)
    if (!m?.[1]) continue
    out[m[1]] = cleanValue(m[2] ?? '')
  }
  return out
}

function cleanValue(raw: string): string {
  const v = raw.trim()
  const quoted = /^(["'])(.*?)\1/.exec(v)
  if (quoted) return quoted[2] ?? ''
  if (v.startsWith('[')) {
    const inner = v.slice(1).split(']')[0] ?? ''
    return inner
      .replace(/["']/g, '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', ')
  }
  return v.replace(/\s#.*$/, '').trim()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/frontmatter.test.ts`
Expected: PASS.

If the `ATXHeading1` sibling name differs, for example because the blank line produces no node, adjust only the expected array. Never change the parser rule.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint && npm run typecheck && npm test
git add package.json package-lock.json src/renderer/editor/frontmatter.ts tests/unit/renderer/frontmatter.test.ts
git commit -m "feat(editor): parse YAML front matter as its own block"
```

---

### Task 4: Highlight style and inline Preview decorations

**Files:**
- Create: `src/renderer/editor/highlight.ts`, `src/renderer/editor/preview.ts`, `tests/unit/renderer/preview.test.ts`

**Interfaces:**
- Consumes: `Frontmatter` (Task 3), the class contract (Task 2)
- Produces:
  - `rfHighlight: Extension`
  - `buildPreview(state: EditorState, ranges?: readonly { from: number; to: number }[]): DecorationSet`
  - `previewPlugin: Extension`
  - Every decoration carries a spec field `rf` naming what it is: `'hide'`, `'line:<classes>'`, `'mark:<class>'`, `'bullet'`, `'task'`, `'alert-title'`. Tests and Task 5 rely on these names.
- Reveal rule:
  - Marks of an inline element (emphasis, strong, strikethrough, inline code, link) are hidden unless a selection range touches the element.
  - Heading marks are hidden unless a selection range touches the heading's line.
  - When a mark is revealed, it gets class `rf-mark` (faint).

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/preview-helper.ts` (shared by Tasks 4 and 5, not a test file itself):

```ts
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { buildPreview } from '../../../src/renderer/editor/preview'

/** Decorations as `rf@from-to`; the cursor defaults to a neutral trailing line. */
export function rf(text: string, cursor?: number): string[] {
  const doc = `${text}\n\nende`
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor ?? doc.length },
    extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  const out: string[] = []
  buildPreview(state).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}
```

`tests/unit/renderer/preview.test.ts`:

```ts
// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildPreview } from '../../../src/renderer/editor/preview'
import { rf } from './preview-helper'

describe('headings', () => {
  it('styles the line and hides "# " away from the cursor', () => {
    expect(rf('# Titel')).toEqual(expect.arrayContaining(['line:rf-h1@0-0', 'hide@0-2']))
  })
  it('shows the marks faint when the cursor is on the line', () => {
    const d = rf('## Titel', 4)
    expect(d).toContain('line:rf-h2@0-0')
    // "## " incl. its space is the mark range
    expect(d).toContain('mark:rf-mark@0-3')
    expect(d.some((x) => x.startsWith('hide@0'))).toBe(false)
  })
  it('styles #### as h4', () => {
    expect(rf('#### Klein')).toContain('line:rf-h4@0-0')
  })
})

describe('inline elements', () => {
  it('strong: style and hide **', () => {
    expect(rf('**fett**')).toEqual(expect.arrayContaining(['mark:rf-strong@0-8', 'hide@0-2', 'hide@6-8']))
  })
  it('strong: reveals ** faint with the cursor inside', () => {
    const d = rf('**fett**', 3)
    expect(d).toEqual(expect.arrayContaining(['mark:rf-strong@0-8', 'mark:rf-mark@0-2', 'mark:rf-mark@6-8']))
    expect(d.filter((x) => x.startsWith('hide'))).toEqual([])
  })
  it('emphasis, strike, inline code', () => {
    expect(rf('*kursiv*')).toEqual(expect.arrayContaining(['mark:rf-em@0-8', 'hide@0-1', 'hide@7-8']))
    expect(rf('~~weg~~')).toEqual(expect.arrayContaining(['mark:rf-strike@0-7', 'hide@0-2', 'hide@5-7']))
    expect(rf('`code`')).toEqual(expect.arrayContaining(['mark:rf-code-inline@0-6', 'hide@0-1', 'hide@5-6']))
  })
  it('link: keeps the text, hides brackets and URL', () => {
    expect(rf('[Text](https://x.de)')).toEqual(
      expect.arrayContaining(['mark:rf-link@0-20', 'hide@0-1', 'hide@5-6', 'hide@6-7', 'hide@7-19', 'hide@19-20']),
    )
  })
  it('bare URL is styled, never hidden', () => {
    const d = rf('siehe https://x.de')
    expect(d).toContain('mark:rf-link@6-18')
    expect(d.filter((x) => x.startsWith('hide'))).toEqual([])
  })
})

describe('front matter', () => {
  it('gets its own line class and no heading styles', () => {
    const d = rf('---\ntitle: x\n---')
    expect(d).toEqual(expect.arrayContaining(['line:rf-frontmatter@0-0', 'line:rf-frontmatter@4-4', 'line:rf-frontmatter@13-13']))
    expect(d.some((x) => x.startsWith('line:rf-h'))).toBe(false)
  })
})

describe('ranges', () => {
  it('only decorates the requested range', () => {
    const doc = '# Eins\n\n# Zwei'
    const state = EditorState.create({ doc: `${doc}\n\nende`, selection: { anchor: doc.length + 6 }, extensions: markdown({ base: markdownLanguage }) })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const out: number[] = []
    buildPreview(state, [{ from: 8, to: 14 }]).between(0, state.doc.length, (from) => {
      out.push(from)
    })
    expect(out.every((p) => p >= 8)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/preview.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`src/renderer/editor/highlight.ts`:

```ts
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Token classes; colours live in theme.css (Typst's default syntax colours). */
export const rfHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, class: 'rf-tok-heading' },
    { tag: t.strong, class: 'rf-tok-strong' },
    { tag: t.emphasis, class: 'rf-tok-em' },
    { tag: [t.link, t.url], class: 'rf-tok-link' },
    { tag: t.processingInstruction, class: 'rf-tok-mark' },
    { tag: t.meta, class: 'rf-tok-meta' },
    { tag: [t.keyword, t.bool, t.null], class: 'rf-tok-keyword' },
    { tag: [t.string, t.regexp], class: 'rf-tok-string' },
    { tag: [t.number, t.atom], class: 'rf-tok-number' },
    { tag: t.comment, class: 'rf-tok-comment' },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName), t.typeName, t.className, t.macroName],
      class: 'rf-tok-function',
    },
  ]),
)
```

`src/renderer/editor/preview.ts`:

```ts
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'

export type PreviewRange = { from: number; to: number }

const hide = Decoration.replace({ rf: 'hide' })
const lineDeco = (cls: string) => Decoration.line({ class: cls, rf: `line:${cls}` })
const markDeco = (cls: string) => Decoration.mark({ class: cls, rf: `mark:${cls}` })
const faint = markDeco('rf-mark')

const INLINE: Record<string, { cls: string; marks: string[] }> = {
  Emphasis: { cls: 'rf-em', marks: ['EmphasisMark'] },
  StrongEmphasis: { cls: 'rf-strong', marks: ['EmphasisMark'] },
  Strikethrough: { cls: 'rf-strike', marks: ['StrikethroughMark'] },
  InlineCode: { cls: 'rf-code-inline', marks: ['CodeMark'] },
  Link: { cls: 'rf-link', marks: ['LinkMark', 'URL', 'LinkTitle', 'LinkLabel'] },
}

/** Context passed to every node handler (Task 5 adds block handlers that use it too). */
export interface PreviewCx {
  state: EditorState
  out: Range<Decoration>[]
  /** Line starts whose text a widget already replaces: skip further replaces there. */
  replacedLines: Set<number>
  touches(from: number, to: number): boolean
  onLine(pos: number): boolean
  lines(from: number, to: number, d: Decoration): void
  hideOrFaint(from: number, to: number, reveal: boolean): void
}

function makeCx(state: EditorState, out: Range<Decoration>[]): PreviewCx {
  const doc = state.doc
  const touches = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  return {
    state,
    out,
    replacedLines: new Set(),
    touches,
    onLine(pos) {
      const l = doc.lineAt(pos)
      return touches(l.from, l.to)
    },
    lines(from, to, d) {
      for (let pos = from; pos <= to; ) {
        const l = doc.lineAt(pos)
        out.push(d.range(l.from))
        pos = l.to + 1
      }
    },
    hideOrFaint(from, to, reveal) {
      if (from >= to) return
      out.push((reveal ? faint : hide).range(from, to))
    },
  }
}

function heading(cx: PreviewCx, node: SyntaxNode, level: number): void {
  const { state } = cx
  cx.out.push(lineDeco(`rf-h${level}`).range(state.doc.lineAt(node.from).from))
  const reveal = cx.onLine(node.from)
  for (const m of node.getChildren('HeaderMark')) {
    if (m.from === node.from) {
      const space = state.doc.sliceString(m.to, m.to + 1) === ' ' ? 1 : 0
      cx.hideOrFaint(m.from, m.to + space, reveal)
    } else {
      const space = state.doc.sliceString(m.from - 1, m.from) === ' ' ? 1 : 0
      cx.hideOrFaint(m.from - space, m.to, reveal)
    }
  }
}

/** Handles one node; returns false to skip its children. Task 5 extends this. */
export function visitInline(cx: PreviewCx, ref: SyntaxNodeRef): boolean | undefined {
  const name = ref.name
  const atx = /^ATXHeading(\d)$/.exec(name)
  if (atx) {
    heading(cx, ref.node, Number(atx[1]))
    return
  }
  const setext = /^SetextHeading(\d)$/.exec(name)
  if (setext) {
    cx.out.push(lineDeco(`rf-h${setext[1]}`).range(cx.state.doc.lineAt(ref.from).from))
    for (const m of ref.node.getChildren('HeaderMark')) cx.out.push(faint.range(m.from, m.to))
    return
  }
  if (name === 'Frontmatter') {
    cx.lines(ref.from, ref.to, lineDeco('rf-frontmatter'))
    return false
  }
  const inline = INLINE[name]
  if (inline) {
    cx.out.push(markDeco(inline.cls).range(ref.from, ref.to))
    const reveal = cx.touches(ref.from, ref.to)
    for (const markName of inline.marks) {
      for (const m of ref.node.getChildren(markName)) cx.hideOrFaint(m.from, m.to, reveal)
    }
    return
  }
  if (name === 'URL' && ref.node.parent?.name !== 'Link') {
    cx.out.push(markDeco('rf-link').range(ref.from, ref.to))
    return
  }
  if (name === 'Autolink') {
    cx.out.push(markDeco('rf-link').range(ref.from, ref.to))
    return false
  }
  if (name === 'Escape') {
    cx.out.push(faint.range(ref.from, ref.from + 1))
    return
  }
  if (name === 'CommentBlock' || name === 'Comment') {
    cx.out.push(markDeco('rf-comment').range(ref.from, ref.to))
    return false
  }
  return
}

/** Node handlers, in order; the first that returns a value other than undefined decides. */
export const handlers: Array<(cx: PreviewCx, ref: SyntaxNodeRef) => boolean | undefined> = [visitInline]

export function buildPreview(
  state: EditorState,
  ranges: readonly PreviewRange[] = [{ from: 0, to: state.doc.length }],
): DecorationSet {
  const out: Range<Decoration>[] = []
  const cx = makeCx(state, out)
  const tree = syntaxTree(state)
  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        for (const h of handlers) {
          const r = h(cx, ref)
          if (r === false) return false
        }
        return undefined
      },
    })
  }
  return Decoration.set(out, true)
}

export const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildPreview(view.state, view.visibleRanges)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = buildPreview(u.state, u.view.visibleRanges)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
```

Note on `handlers`: Task 5 appends `visitBlock` to this array. Each handler only acts on the node names it knows, so their order does not matter.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/preview.test.ts`
Expected: PASS.

If an offset in a test differs, the test is wrong only when the node boundaries really differ. Check with `syntaxTree(state).toString()` and record that in the report.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/renderer/editor/highlight.ts src/renderer/editor/preview.ts tests/unit/renderer/preview.test.ts tests/unit/renderer/preview-helper.ts
git commit -m "feat(preview): render headings and inline Markdown with receding marks"
```

---

### Task 5: Block decorations – lists, tasks, quotes, alerts, tables, code

**Files:**
- Modify: `src/renderer/editor/preview.ts` (add widgets, `visitBlock`, `toggleTaskAt`, register `visitBlock` in `handlers`)
- Test: `tests/unit/renderer/preview-blocks.test.ts`

**Interfaces:**
- Consumes: `PreviewCx`, `handlers`, the `rf` naming (Task 4)
- Produces:
  - `toggleTaskAt(state: EditorState, pos: number): TransactionSpec | null`, where `pos` is the `[` of a `TaskMarker`. It changes exactly the character between the brackets.
  - The widget classes `BulletWidget`, `TaskWidget` and `AlertTitleWidget` (not exported).
- Rules:
  - **Bullet lists:** `-`, `*` and `+` become the square `BulletWidget`, unless the cursor is on that line, in which case the mark is faint.
  - **Tasks:** the bullet and its space are always hidden, and `[ ]` / `[x]` always becomes a clickable checkbox.
  - **Ordered lists** stay as they are.
  - **Quotes:** lines get `rf-quote`, and `> ` is hidden away from the cursor.
  - **Alerts** (`> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION]`):
    - All lines get `rf-alert rf-alert-<type>`.
    - Away from the cursor, the whole marker line becomes the title widget: Info, Tipp, Wichtig, Hinweis, Achtung.
  - **Tables while the cursor is inside them**: Task 6's widget shows them otherwise.
    - The first line gets `rf-table-head`, the second `rf-table-delim`, and the rest `rf-table-row`.
    - Every second data row, starting with the second as in the PDF, also gets `rf-table-stripe`.
    - `|` is faint.
    - With the cursor elsewhere, the handler skips the table.
  - **Fenced code:** fence lines get `rf-codefence`, inner lines `rf-codeblock`. Indented code gets `rf-codeblock`.
  - **Horizontal rule:** the line gets `rf-hr`, and the text is hidden away from the cursor.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/preview-blocks.test.ts`:

```ts
// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { toggleTaskAt } from '../../../src/renderer/editor/preview'
import { rf } from './preview-helper'

describe('lists and tasks', () => {
  it('replaces the bullet by a square away from the cursor', () => {
    expect(rf('- Punkt')).toContain('bullet@0-1')
    const near = rf('- Punkt', 3)
    expect(near).toContain('mark:rf-mark@0-1')
    expect(near).not.toContain('bullet@0-1')
  })
  it('turns a task into a checkbox and hides its bullet', () => {
    expect(rf('- [ ] offen')).toEqual(expect.arrayContaining(['hide@0-2', 'task@2-5']))
    expect(rf('- [x] erledigt', 8)).toEqual(expect.arrayContaining(['hide@0-2', 'task@2-5']))
  })
  it('leaves ordered lists alone', () => {
    expect(rf('1. eins').some((d) => d.startsWith('bullet'))).toBe(false)
  })
})

describe('quotes and alerts', () => {
  it('quote: line class, hidden "> "', () => {
    expect(rf('> Zitat')).toEqual(expect.arrayContaining(['line:rf-quote@0-0', 'hide@0-2']))
  })
  it('alert: classes on every line, title widget for the marker line', () => {
    const d = rf('> [!WARNING]\n> Achtung Stufe')
    expect(d).toEqual(
      expect.arrayContaining([
        'line:rf-alert rf-alert-warning@0-0',
        'line:rf-alert rf-alert-warning@13-13',
        'alert-title@0-12',
        'hide@13-15',
      ]),
    )
    expect(d).not.toContain('line:rf-quote@0-0')
  })
  it('alert: marker line shown as text when the cursor is on it', () => {
    expect(rf('> [!NOTE]\n> x', 3)).not.toContain('alert-title@0-9')
  })
})

describe('tables, code, rules', () => {
  it('table rows while editing (cursor inside)', () => {
    const d = rf('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 1)
    expect(d).toEqual(
      expect.arrayContaining([
        'line:rf-table-head@0-0',
        'line:rf-table-delim@10-10',
        'line:rf-table-row@20-20',
        'line:rf-table-row rf-table-stripe@30-30',
      ]),
    )
  })
  it('table away from the cursor is left to the widget', () => {
    expect(rf('| a | b |\n|---|---|\n| 1 | 2 |').some((d) => d.includes('rf-table'))).toBe(false)
  })
  it('fenced code', () => {
    expect(rf('```js\nlet a = 1\n```')).toEqual(
      expect.arrayContaining(['line:rf-codefence@0-0', 'line:rf-codeblock@6-6', 'line:rf-codefence@16-16']),
    )
  })
  it('horizontal rule', () => {
    expect(rf('Text\n\n***')).toEqual(expect.arrayContaining(['line:rf-hr@6-6', 'hide@6-9']))
  })
})

describe('toggleTaskAt', () => {
  const state = (doc: string) => EditorState.create({ doc })
  it('changes exactly one character, both ways', () => {
    const s = state('- [ ] a\n- [x] b')
    const on = s.update(toggleTaskAt(s, 2) ?? {}).state
    expect(on.doc.toString()).toBe('- [x] a\n- [x] b')
    const off = on.update(toggleTaskAt(on, 10) ?? {}).state
    expect(off.doc.toString()).toBe('- [x] a\n- [ ] b')
  })
  it('accepts [X] and refuses non-markers', () => {
    const s = state('- [X] a\nkein')
    expect(s.update(toggleTaskAt(s, 2) ?? {}).state.doc.toString()).toBe('- [ ] a\nkein')
    expect(toggleTaskAt(s, 8)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/preview-blocks.test.ts`
Expected: FAIL, because `toggleTaskAt` is not exported and the block decorations are missing.

- [ ] **Step 3: Implement (additions to `src/renderer/editor/preview.ts`)**

Extend the import from `@codemirror/state` with `TransactionSpec`, and the import from `@codemirror/view` with `WidgetType`. Then add:

```ts
const ALERT_TITLES: Record<string, string> = {
  note: 'Info',
  tip: 'Tipp',
  important: 'Wichtig',
  warning: 'Hinweis',
  caution: 'Achtung',
}
const ALERT_RE = /^\s*>\s*\[!(note|tip|important|warning|caution)\]\s*$/i

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'rf-bullet'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'rf-task'
    box.checked = this.checked
    box.setAttribute('aria-label', this.checked ? 'Erledigt' : 'Offen')
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // Position looked up at click time, so a reused widget never edits a stale offset.
      const spec = toggleTaskAt(view.state, view.posAtDOM(box))
      if (spec) view.dispatch(spec)
    })
    return box
  }
}

class AlertTitleWidget extends WidgetType {
  constructor(readonly title: string) {
    super()
  }
  eq(other: AlertTitleWidget): boolean {
    return other.title === this.title
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'rf-alert-title'
    s.textContent = this.title
    return s
  }
}

/** Toggles `[ ]` ↔ `[x]` at `pos` (the `[`): exactly one character changes. */
export function toggleTaskAt(state: EditorState, pos: number): TransactionSpec | null {
  const text = state.doc.sliceString(pos, pos + 3)
  if (!/^\[[ xX]\]$/.test(text)) return null
  return {
    changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' },
    userEvent: 'input.toggle-task',
  }
}

function hideQuoteMark(cx: PreviewCx, m: { from: number; to: number }): void {
  const line = cx.state.doc.lineAt(m.from)
  if (cx.replacedLines.has(line.from)) return
  const space = cx.state.doc.sliceString(m.to, m.to + 1) === ' ' ? 1 : 0
  cx.hideOrFaint(m.from, m.to + space, cx.onLine(m.from))
}

export function visitBlock(cx: PreviewCx, ref: SyntaxNodeRef): boolean | undefined {
  const { state, out } = cx
  const doc = state.doc
  switch (ref.name) {
    case 'ListMark': {
      const item = ref.node.parent
      if (item?.parent?.name !== 'BulletList') return
      if (item.getChild('Task')) {
        const space = doc.sliceString(ref.to, ref.to + 1) === ' ' ? 1 : 0
        out.push(hide.range(ref.from, ref.to + space))
      } else if (cx.onLine(ref.from)) {
        out.push(faint.range(ref.from, ref.to))
      } else {
        out.push(Decoration.replace({ widget: new BulletWidget(), rf: 'bullet' }).range(ref.from, ref.to))
      }
      return
    }
    case 'TaskMarker': {
      const checked = /x/i.test(doc.sliceString(ref.from, ref.to))
      out.push(Decoration.replace({ widget: new TaskWidget(checked), rf: 'task' }).range(ref.from, ref.to))
      return
    }
    case 'Blockquote': {
      const first = doc.lineAt(ref.from)
      const alert = ALERT_RE.exec(first.text)
      if (alert?.[1]) {
        const type = alert[1].toLowerCase()
        cx.lines(ref.from, ref.to, lineDeco(`rf-alert rf-alert-${type}`))
        if (!cx.onLine(first.from)) {
          cx.replacedLines.add(first.from)
          out.push(
            Decoration.replace({ widget: new AlertTitleWidget(ALERT_TITLES[type] ?? type), rf: 'alert-title' }).range(
              first.from,
              first.to,
            ),
          )
        }
      } else {
        cx.lines(ref.from, ref.to, lineDeco('rf-quote'))
      }
      return
    }
    case 'QuoteMark':
      hideQuoteMark(cx, ref)
      return
    case 'FencedCode': {
      const firstLine = doc.lineAt(ref.from)
      const lastLine = doc.lineAt(ref.to)
      const closed = lastLine.number > firstLine.number && /^\s*(```|~~~)/.test(lastLine.text)
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        const l = doc.line(n)
        const fence = n === firstLine.number || (closed && n === lastLine.number)
        out.push(lineDeco(fence ? 'rf-codefence' : 'rf-codeblock').range(l.from))
      }
      return false
    }
    case 'CodeBlock':
      cx.lines(ref.from, ref.to, lineDeco('rf-codeblock'))
      return false
    case 'Table': {
      const firstLine = doc.lineAt(ref.from).number
      const lastLine = doc.lineAt(Math.max(ref.from, ref.to - 1)).number
      // Away from the cursor, tableField (Task 6) shows the PDF-like widget instead.
      if (!cx.touches(doc.line(firstLine).from, doc.line(lastLine).to)) return false
      for (let n = firstLine; n <= lastLine; n++) {
        const idx = n - firstLine
        const cls =
          idx === 0
            ? 'rf-table-head'
            : idx === 1
              ? 'rf-table-delim'
              : (idx - 2) % 2 === 1
                ? 'rf-table-row rf-table-stripe'
                : 'rf-table-row'
        out.push(lineDeco(cls).range(doc.line(n).from))
      }
      return
    }
    case 'TableDelimiter':
      out.push(faint.range(ref.from, ref.to))
      return
    case 'HorizontalRule':
      out.push(lineDeco('rf-hr').range(doc.lineAt(ref.from).from))
      if (!cx.onLine(ref.from)) out.push(hide.range(ref.from, ref.to))
      return
  }
  return
}
```

Register the handler by changing `handlers` to `[visitInline, visitBlock]`. Because the array is referenced by name inside `buildPreview`, declare `visitBlock` above `handlers`, or turn `handlers` into a function that returns the list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/preview-blocks.test.ts tests/unit/renderer/preview.test.ts`
Expected: PASS.

If Lezer's GFM table emits the delimiter row as a node spanning the whole line, the `TableDelimiter` faint mark covers that line. That is fine. Only adjust a test expectation when it is verified against `syntaxTree(state).toString()`, and record it in the report.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/renderer/editor/preview.ts tests/unit/renderer/preview-blocks.test.ts
git commit -m "feat(preview): render lists, checkboxes, quotes, alerts, tables and code blocks"
```

---

### Task 6: Tables like the PDF

**Files:**
- Create: `src/renderer/editor/inline-render.ts`, `src/renderer/editor/tables.ts`, `tests/unit/renderer/inline-render.test.ts`, `tests/unit/renderer/tables.test.ts`

**Interfaces:**
- Consumes: the syntax tree with GFM `Table` nodes (Task 3 setup), the CSS classes `rf-table-wrap`, `rf-table`, `rf-table-stripe`, `rf-al-left|center|right` (Task 2)
- Produces:
  - `renderInline(text: string, parent: HTMLElement): void`: Markdown inline formatting becomes DOM elements (`strong.rf-strong`, `em.rf-em`, `code.rf-code-inline`, `s.rf-strike`, `span.rf-link`). It builds the DOM element by element and never uses `innerHTML`.
  - `splitRow(text: string): string[]`
  - `type Align = 'left' | 'center' | 'right'`
  - `interface TableModel { head: string[]; rows: string[][]; aligns: Align[] }`
  - `tableModel(lines: string[]): TableModel`, where `lines` are the raw lines of one table
  - `tableField: StateField<DecorationSet>` (Preview only). Spec field `rf: 'table'`.
- Behaviour:
  - **Rendering:**
    - A table that no selection range touches is replaced by a block widget, a real HTML table laid out like the PDF.
    - Column widths come from the content.
    - The head row is centred and bold.
    - Column alignment comes from the delimiter row (`:--`, `:-:`, `--:`). Without one, a column whose data cells are all numbers or amounts is right-aligned, otherwise left-aligned (rf-document's rule and regex).
    - Every second data row is striped, starting with the second, exactly as `rfd-table-fill`.
    - Vertical rules separate the columns, and a rule runs under the head.
  - **Editing:**
    - A click on the widget puts the cursor at the table's start, and the table shows as Markdown text for editing (Task 5's line classes).
    - When the cursor leaves the table, the widget returns.
    - The text is never changed by the widget.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/inline-render.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderInline } from '../../../src/renderer/editor/inline-render'

function render(text: string): HTMLElement {
  const el = document.createElement('div')
  renderInline(text, el)
  return el
}

describe('renderInline', () => {
  it('turns inline Markdown into elements and drops the marks', () => {
    const el = render('**fett** und *kursiv*, `code`, ~~weg~~ [Link](https://x.de)')
    expect(el.textContent).toBe('fett und kursiv, code, weg Link')
    expect(el.querySelector('strong.rf-strong')?.textContent).toBe('fett')
    expect(el.querySelector('em.rf-em')?.textContent).toBe('kursiv')
    expect(el.querySelector('code.rf-code-inline')?.textContent).toBe('code')
    expect(el.querySelector('s.rf-strike')?.textContent).toBe('weg')
    expect(el.querySelector('span.rf-link')?.textContent).toBe('Link')
  })
  it('keeps bare URLs and escapes as text', () => {
    const el = render('siehe https://x.de \\*kein\\*')
    expect(el.textContent).toBe('siehe https://x.de *kein*')
    expect(el.querySelector('span.rf-link')?.textContent).toBe('https://x.de')
  })
  it('never interprets HTML', () => {
    const el = render('<img src=x onerror=alert(1)> & <b>x</b>')
    expect(el.querySelector('img, b')).toBeNull()
    expect(el.textContent).toBe('<img src=x onerror=alert(1)> & <b>x</b>')
  })
  it('nests', () => {
    expect(render('**fett *und kursiv***').querySelector('strong em')?.textContent).toBe('und kursiv')
  })
})
```

`tests/unit/renderer/tables.test.ts`:

```ts
// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { EditorView, WidgetType } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { splitRow, tableField, tableModel } from '../../../src/renderer/editor/tables'

const TABLE = '| Produkt | Menge | Preis |\n|:--|:-:|---|\n| Espresso | 12 | 3,50 € |\n| Filter | 8 | 2 € |\n| **Neu** | | 1.200,00 EUR |'

function make(doc: string, cursor: number) {
  const s = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), tableField],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  // Rebuild once the tree is complete (a no-op transaction re-runs the field).
  return s.update({}).state
}

function tables(state: EditorState): { range: string; widget: WidgetType }[] {
  const out: { range: string; widget: WidgetType }[] = []
  state.field(tableField).between(0, state.doc.length, (from, to, d) => {
    out.push({ range: `${(d.spec as { rf: string }).rf}@${from}-${to}`, widget: d.spec.widget as WidgetType })
  })
  return out
}

describe('splitRow', () => {
  it.each([
    ['| a | b |', ['a', 'b']],
    ['a | b', ['a', 'b']],
    ['| `a|b` | c |', ['`a|b`', 'c']],
    ['| a \\| b | c |', ['a | b', 'c']],
    ['| | x |', ['', 'x']],
  ])('%j', (row, cells) => expect(splitRow(row)).toEqual(cells))
})

describe('tableModel', () => {
  it('reads head, rows, explicit and numeric alignment', () => {
    const m = tableModel(TABLE.split('\n'))
    expect(m.head).toEqual(['Produkt', 'Menge', 'Preis'])
    expect(m.rows).toEqual([
      ['Espresso', '12', '3,50 €'],
      ['Filter', '8', '2 €'],
      ['**Neu**', '', '1.200,00 EUR'],
    ])
    expect(m.aligns).toEqual(['left', 'center', 'right'])
  })
  it('pads short rows and cuts long ones to the head width', () => {
    const m = tableModel(['| a | b |', '|---|---|', '| 1 |', '| 1 | 2 | 3 |'])
    expect(m.rows).toEqual([
      ['1', ''],
      ['1', '2'],
    ])
    expect(m.aligns).toEqual(['right', 'right'])
  })
  it('mixed text column stays left', () => {
    expect(tableModel(['| x |', '|---|', '| 1 |', '| zwei |']).aligns).toEqual(['left'])
  })
})

describe('tableField', () => {
  it('replaces the table by a widget when the cursor is elsewhere', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    const t = tables(make(doc, doc.length))
    const start = doc.indexOf('| Produkt')
    expect(t.map((x) => x.range)).toEqual([`table@${start}-${start + TABLE.length}`])
  })
  it('shows the Markdown when the cursor is inside', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    expect(tables(make(doc, doc.indexOf('Espresso') + 2))).toEqual([])
  })
  it('renders a PDF-like table', () => {
    const doc = `${TABLE}\n\nende`
    const [first] = tables(make(doc, doc.length))
    const dom = first?.widget.toDOM({} as EditorView) as HTMLElement
    const table = dom.querySelector('table.rf-table') as HTMLTableElement
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Produkt', 'Menge', 'Preis'])
    const rows = table.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.classList.contains('rf-table-stripe')).toBe(false)
    expect(rows[1]?.classList.contains('rf-table-stripe')).toBe(true)
    expect(rows[2]?.querySelector('td')?.querySelector('strong.rf-strong')?.textContent).toBe('Neu')
    expect(rows[0]?.children[2]?.classList.contains('rf-al-right')).toBe(true)
    expect(rows[0]?.children[1]?.classList.contains('rf-al-center')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/inline-render.test.ts tests/unit/renderer/tables.test.ts`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`src/renderer/editor/inline-render.ts`:

```ts
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { SyntaxNode } from '@lezer/common'

const ELEMENTS: Record<string, [tag: string, cls: string]> = {
  StrongEmphasis: ['strong', 'rf-strong'],
  Emphasis: ['em', 'rf-em'],
  InlineCode: ['code', 'rf-code-inline'],
  Strikethrough: ['s', 'rf-strike'],
  Link: ['span', 'rf-link'],
}
const MARKS = new Set(['EmphasisMark', 'CodeMark', 'StrikethroughMark', 'LinkMark', 'LinkTitle', 'LinkLabel'])

/** Inline Markdown → DOM, built node by node (never innerHTML); HTML stays text. */
export function renderInline(text: string, parent: HTMLElement): void {
  const doc = parent.ownerDocument
  const tree = markdownLanguage.parser.parse(text)
  const walk = (node: SyntaxNode, from: number, to: number, into: HTMLElement): void => {
    let pos = from
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.from > pos) into.append(text.slice(pos, c.from))
      if (MARKS.has(c.name) || (c.name === 'URL' && node.name === 'Link')) {
        pos = c.to
        continue
      }
      const spec = ELEMENTS[c.name]
      if (spec) {
        const el = doc.createElement(spec[0])
        el.className = spec[1]
        walk(c, c.from, c.to, el)
        into.append(el)
      } else if (c.name === 'URL' || c.name === 'Autolink') {
        const el = doc.createElement('span')
        el.className = 'rf-link'
        el.textContent = text.slice(c.from, c.to).replace(/^<|>$/g, '')
        into.append(el)
      } else if (c.name === 'Escape') {
        into.append(text.slice(c.from + 1, c.to))
      } else {
        walk(c, c.from, c.to, into)
      }
      pos = c.to
    }
    if (to > pos) into.append(text.slice(pos, to))
  }
  walk(tree.topNode, 0, text.length, parent)
}
```

`src/renderer/editor/tables.ts`:

```ts
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { renderInline } from './inline-render'

export type Align = 'left' | 'center' | 'right'
export interface TableModel {
  head: string[]
  rows: string[][]
  aligns: Align[]
}

/** rf-document's number/amount test (template.typ number-re). */
const NUMBER_RE =
  /^[+\-−]?\s*(?:[€$£]\s*)?[0-9][0-9.,'   ]*(?:\s*(?:%|€|\$|£|EUR|CHF|USD|Std\.?|h|Tage?|Stk\.?))?$/

/** Splits a GFM table row; `\|` and pipes inside code spans stay in the cell. */
export function splitRow(text: string): string[] {
  let t = text.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  const out: string[] = []
  let cur = ''
  let inCode = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (ch === '`') inCode = !inCode
    if (ch === '|' && !inCode) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

const plain = (cell: string) => cell.replace(/[*_~`]/g, '').trim()

export function tableModel(lines: string[]): TableModel {
  const head = splitRow(lines[0] ?? '')
  const n = head.length
  const fit = (cells: string[]) => Array.from({ length: n }, (_, i) => cells[i] ?? '')
  const rows = lines.slice(2).map((l) => fit(splitRow(l)))
  const delim = fit(splitRow(lines[1] ?? ''))
  const aligns = delim.map((d, i): Align => {
    const left = d.startsWith(':')
    const right = d.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    const filled = rows.map((r) => plain(r[i] ?? '')).filter(Boolean)
    return filled.length > 0 && filled.every((c) => NUMBER_RE.test(c)) ? 'right' : 'left'
  })
  return { head, rows, aligns }
}

class TableWidget extends WidgetType {
  constructor(
    readonly model: TableModel,
    readonly source: string,
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'rf-table-wrap'
    const table = document.createElement('table')
    table.className = 'rf-table'
    const thead = table.createTHead().insertRow()
    for (const cell of this.model.head) {
      const th = document.createElement('th')
      renderInline(cell, th)
      thead.append(th)
    }
    const body = table.createTBody()
    this.model.rows.forEach((cells, k) => {
      const tr = body.insertRow()
      // rfd-table-fill: luma(96%) on even y (y = 0 is the head) → every second data row
      if (k % 2 === 1) tr.className = 'rf-table-stripe'
      cells.forEach((cell, i) => {
        const td = tr.insertCell()
        td.className = `rf-al-${this.model.aligns[i] ?? 'left'}`
        renderInline(cell, td)
      })
    })
    wrap.append(table)
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // Into the table: the field then shows the Markdown for editing.
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })
    return wrap
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === 'Frontmatter') return false
      if (n.name !== 'Table') return undefined
      const from = doc.lineAt(n.from).from
      const to = doc.lineAt(Math.max(n.from, n.to - 1)).to
      const touched = state.selection.ranges.some((r) => r.from <= to && r.to >= from)
      if (!touched) {
        const source = doc.sliceString(from, to)
        out.push(
          Decoration.replace({
            widget: new TableWidget(tableModel(source.split('\n')), source),
            block: true,
            rf: 'table',
          }).range(from, to),
        )
      }
      return false
    },
  })
  return Decoration.set(out)
}

/** Preview-only: tables as PDF-like widgets while the cursor is elsewhere. */
export const tableField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
    return tr.docChanged || tr.selection || treeChanged ? build(tr.state) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/inline-render.test.ts tests/unit/renderer/tables.test.ts`
Expected: PASS.

If the GFM parser does not produce a `Table` node for the five-row test table, for example because of the empty cell, check `syntaxTree(state).toString()`. Fix the field, not the test, and record what you found.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/renderer/editor/inline-render.ts src/renderer/editor/tables.ts tests/unit/renderer/inline-render.test.ts tests/unit/renderer/tables.test.ts
git commit -m "feat(preview): render tables like the PDF, editable as Markdown on click"
```

---

### Task 7: YAML header collapses into the PDF title block

**Files:**
- Create: `src/renderer/editor/titleblock.ts`, `src/renderer/editor/header.ts`, `tests/unit/renderer/titleblock.test.ts`, `tests/unit/renderer/header.test.ts`

**Interfaces:**
- Consumes: `frontmatterRange`, `frontmatterFields` (Task 3)
- The title block mirrors rf-document's title block (template.typ). Each part appears only when it is set, and everything is centred:
  - the client, small and letter-spaced in capitals
  - the title in 16 pt serif
  - the subtitle in 12 pt serif
  - the line "date · author", which only appears when `author` is set
- Dates in the form `YYYY-MM-DD` or `D.M.YYYY` are shown as `14. Oktober 2026` (`lang: de`, the default) or `October 14, 2026` (`lang: en`). Any other text is shown as typed.
- When the header has none of client, title, subtitle or author, the collapsed header shows a faint `⋯ YAML-Header` line instead.
- Produces:
  - `setHeaderHidden: StateEffectType<boolean>`
  - `headerHidden: StateField<boolean>`. It goes into the base extensions, so its value survives view switches. Initialise it with `headerHidden.init(() => value)`.
  - `headerFold: StateField<DecorationSet>`. It is Preview-only: it provides the decorations and `atomicRanges`, and its spec field is `rf: 'header-fold'`. Its widget renders `renderTitleBlock(titleBlockData(doc))`.
  - `interface TitleBlock { client: string; title: string; subtitle: string; meta: string }`
  - `formatDate(raw: string, lang: string): string`
  - `titleBlockData(doc: Text): TitleBlock | null`
  - `renderTitleBlock(tb: TitleBlock | null, doc?: Document): HTMLElement`
  - `headerToggleSpec(state: EditorState, hide: boolean): TransactionSpec`. When hiding, it moves a cursor that is inside the header to the start of the line after it.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/titleblock.test.ts`:

```ts
// @vitest-environment happy-dom
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { formatDate, renderTitleBlock, titleBlockData } from '../../../src/renderer/editor/titleblock'

const doc = (s: string) => Text.of(s.split('\n'))

describe('formatDate', () => {
  it.each([
    ['2026-10-14', 'de', '14. Oktober 2026'],
    ['3.1.2026', 'de', '3. Januar 2026'],
    ['2026-10-14', 'en', 'October 14, 2026'],
    ['14.10.2026, 9:30 Uhr', 'de', '14.10.2026, 9:30 Uhr'],
    ['2026-13-01', 'de', '2026-13-01'],
    ['', 'de', ''],
  ])('%j (%s) → %j', (raw, lang, out) => expect(formatDate(raw, lang)).toBe(out))
})

describe('titleBlockData', () => {
  it('builds the PDF title block parts', () => {
    const t = '---\nclient: "Muster GmbH"\ntitle: "Kickoff"\nsubtitle: "Protokoll"\nauthor: [Anna, Ben]\ndate: 2026-10-14\n---'
    expect(titleBlockData(doc(t))).toEqual({
      client: 'Muster GmbH',
      title: 'Kickoff',
      subtitle: 'Protokoll',
      meta: '14. Oktober 2026 · Anna, Ben',
    })
  })
  it('omits the meta line without author (like the PDF)', () => {
    expect(titleBlockData(doc('---\ntitle: X\ndate: 2026-10-14\n---'))?.meta).toBe('')
  })
  it('is null without any of client/title/subtitle/author', () => {
    expect(titleBlockData(doc('---\ndate: 2026-10-14\ntoc: false\n---'))).toBeNull()
  })
})

describe('renderTitleBlock', () => {
  it('renders only the parts that are set, as text', () => {
    const el = renderTitleBlock({ client: '<b>A</b>', title: 'T', subtitle: '', meta: '' })
    expect(el.className).toBe('rf-titleblock')
    expect(el.querySelector('.rf-tb-client')?.textContent).toBe('<b>A</b>')
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('.rf-tb-subtitle')).toBeNull()
    expect(el.querySelector('.rf-tb-title')?.textContent).toBe('T')
  })
  it('falls back to a faint marker line', () => {
    const el = renderTitleBlock(null)
    expect(el.classList.contains('rf-titleblock-empty')).toBe(true)
    expect(el.textContent).toBe('⋯ YAML-Header')
  })
})
```

`tests/unit/renderer/header.test.ts`:

```ts
// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { headerFold, headerHidden, headerToggleSpec } from '../../../src/renderer/editor/header'

const DOC = '---\ntitle: "Kickoff"\n---\n\n# Body'
const END = DOC.indexOf('\n\n') // end of the closing ---

function make(doc: string, hidden: boolean, cursor = 0) {
  return EditorState.create({ doc, selection: { anchor: cursor }, extensions: [headerHidden.init(() => hidden), headerFold] })
}

function collapsed(state: EditorState): string[] {
  const out: string[] = []
  state.field(headerFold).between(0, state.doc.length, (from, to, d) => {
    out.push(`${(d.spec as { rf: string }).rf}@${from}-${to}`)
  })
  return out
}

describe('headerFold', () => {
  it('collapses the whole front matter when hidden', () => {
    expect(collapsed(make(DOC, true, DOC.length))).toEqual([`header-fold@0-${END}`])
  })
  it('shows nothing when not hidden or without front matter', () => {
    expect(collapsed(make(DOC, false))).toEqual([])
    expect(collapsed(make('# Nur Text', true))).toEqual([])
  })
  it('follows edits that change the header length', () => {
    const s = make(DOC, true, DOC.length)
    const next = s.update({ changes: { from: 4, insert: 'client: A\n' } }).state
    expect(collapsed(next)).toEqual([`header-fold@0-${END + 10}`])
  })
})

describe('headerToggleSpec', () => {
  it('hiding with the cursor inside moves it after the header, text unchanged', () => {
    const s = make(DOC, false, 6)
    const next = s.update(headerToggleSpec(s, true)).state
    expect(next.field(headerHidden)).toBe(true)
    expect(next.selection.main.head).toBe(END + 1)
    expect(next.doc.toString()).toBe(DOC)
  })
  it('hiding with the cursor outside keeps it', () => {
    const s = make(DOC, false, DOC.length)
    const next = s.update(headerToggleSpec(s, true)).state
    expect(next.selection.main.head).toBe(DOC.length)
  })
  it('showing again only flips the flag', () => {
    const s = make(DOC, true, DOC.length)
    const next = s.update(headerToggleSpec(s, false)).state
    expect(next.field(headerHidden)).toBe(false)
    expect(collapsed(next)).toEqual([])
  })
  it('a document that is only a header puts the cursor at its end', () => {
    const only = '---\na: 1\n---'
    const s = make(only, false, 2)
    expect(s.update(headerToggleSpec(s, true)).state.selection.main.head).toBe(only.length)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/titleblock.test.ts tests/unit/renderer/header.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

`src/renderer/editor/titleblock.ts`:

```ts
import type { Text } from '@codemirror/state'
import { frontmatterFields } from './frontmatter'

export interface TitleBlock {
  client: string
  title: string
  subtitle: string
  /** "date · author", only when author is set (as in the PDF). */
  meta: string
}

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** rf-document's date-display: ISO or D.M.YYYY parsed, anything else verbatim. */
export function formatDate(raw: string, lang: string): string {
  const s = raw.trim()
  let ymd: [number, number, number] | null = null
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
  if (iso) ymd = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (de) ymd = [Number(de[3]), Number(de[2]), Number(de[1])]
  if (!ymd) return s
  const [y, m, d] = ymd
  if (m < 1 || m > 12 || d < 1 || d > 31) return s
  return lang.startsWith('de') ? `${d}. ${MONTHS_DE[m - 1]} ${y}` : `${MONTHS_EN[m - 1]} ${d}, ${y}`
}

export function titleBlockData(doc: Text): TitleBlock | null {
  const f = frontmatterFields(doc)
  const client = f.client ?? ''
  const title = f.title ?? ''
  const subtitle = f.subtitle ?? ''
  const author = f.author ?? ''
  if (!client && !title && !subtitle && !author) return null
  const date = formatDate(f.date ?? '', f.lang || 'de')
  return { client, title, subtitle, meta: author ? [date, author].filter(Boolean).join(' · ') : '' }
}

export function renderTitleBlock(tb: TitleBlock | null, doc: Document = document): HTMLElement {
  const el = doc.createElement('div')
  el.className = 'rf-titleblock'
  el.title = 'YAML-Header ausgeblendet'
  if (!tb) {
    el.classList.add('rf-titleblock-empty')
    el.textContent = '⋯ YAML-Header'
    return el
  }
  const part = (cls: string, text: string) => {
    if (!text) return
    const d = doc.createElement('div')
    d.className = cls
    d.textContent = text
    el.append(d)
  }
  part('rf-tb-client', tb.client)
  part('rf-tb-title', tb.title)
  part('rf-tb-subtitle', tb.subtitle)
  part('rf-tb-meta', tb.meta)
  return el
}
```

`src/renderer/editor/header.ts`:

```ts
import {
  EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { frontmatterRange } from './frontmatter'
import { type TitleBlock, renderTitleBlock, titleBlockData } from './titleblock'

export const setHeaderHidden = StateEffect.define<boolean>()

export const headerHidden = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHeaderHidden)) value = e.value
    return value
  },
})

class TitleBlockWidget extends WidgetType {
  constructor(readonly data: TitleBlock | null) {
    super()
  }
  eq(other: TitleBlockWidget): boolean {
    return JSON.stringify(other.data) === JSON.stringify(this.data)
  }
  toDOM(): HTMLElement {
    return renderTitleBlock(this.data)
  }
}

function build(state: EditorState): DecorationSet {
  if (!state.field(headerHidden, false)) return Decoration.none
  const range = frontmatterRange(state.doc)
  if (!range) return Decoration.none
  return Decoration.set([
    Decoration.replace({ widget: new TitleBlockWidget(titleBlockData(state.doc)), block: true, rf: 'header-fold' }).range(
      range.from,
      range.to,
    ),
  ])
}

/** Preview-only: the collapsed header, atomic so the cursor cannot enter it. */
export const headerFold = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const flipped = tr.startState.field(headerHidden, false) !== tr.state.field(headerHidden, false)
    return tr.docChanged || flipped ? build(tr.state) : deco
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
})

export function headerToggleSpec(state: EditorState, hide: boolean): TransactionSpec {
  const effects = setHeaderHidden.of(hide)
  const range = hide ? frontmatterRange(state.doc) : null
  if (!range) return { effects }
  const inside = state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from)
  if (!inside) return { effects }
  return {
    effects,
    selection: EditorSelection.cursor(Math.min(range.to + 1, state.doc.length)),
    scrollIntoView: true,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/renderer/titleblock.test.ts tests/unit/renderer/header.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint && npm run typecheck && npm test
git add src/renderer/editor/titleblock.ts src/renderer/editor/header.ts tests/unit/renderer/titleblock.test.ts tests/unit/renderer/header.test.ts
git commit -m "feat(editor): show the hidden YAML header as the PDF title block"
```

---

### Task 8: Section folding and editor wiring

**Files:**
- Create: `src/renderer/editor/sections.ts`, `tests/unit/renderer/sections.test.ts`
- Modify: `src/renderer/editor/setup.ts`, `tests/unit/renderer/setup.test.ts`, `package.json` (add `@codemirror/language-data`)

**Interfaces:**
- Consumes: `Frontmatter` (Task 3), `rfHighlight` and `previewPlugin` (Task 4), `headerHidden` and `headerFold` (Task 7)
- Produces:
  - `sectionFoldRanges(state: EditorState): { from: number; to: number }[]`, built from heading lines only. It uses lang-markdown's own section fold service.
  - `foldAllSections(view: EditorView): boolean`
  - `createState(text: string, eol: Eol, view: View, headerHiddenInit?: boolean): EditorState`. The new parameter defaults to `false`.
  - `viewExtensions(view)`:
    - Code view gets line numbers, the fold gutter, and `.rf-code` on the editor.
    - Preview gets the fold gutter, `.rf-preview`, `previewPlugin`, `tableField` (Task 6) and `headerFold`.
  - The base extensions add `codeFolding()`, `foldKeymap` (CodeMirror's defaults are exactly the spec's shortcuts), `rfHighlight` and `headerHidden`. Markdown is configured with `codeLanguages` from `@codemirror/language-data` and the `Frontmatter` extension.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/sections.test.ts`:

```ts
// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { sectionFoldRanges } from '../../../src/renderer/editor/sections'

function state(doc: string): EditorState {
  const s = EditorState.create({ doc, extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }) })
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s
}

describe('sectionFoldRanges', () => {
  it('one range per heading, nested sections end before the next same-or-higher heading', () => {
    const doc = '# A\ntext\n## B\nmore\n# C\nx'
    const r = sectionFoldRanges(state(doc))
    expect(r).toHaveLength(3)
    expect(r[0]?.from).toBe(3)
    expect(r[0]?.to).toBeLessThan(doc.indexOf('# C'))
    expect(r[1]?.from).toBe(doc.indexOf('## B') + 4)
    expect(r[2]).toEqual({ from: doc.indexOf('# C') + 3, to: doc.length })
  })
  it('never folds inside the front matter', () => {
    const doc = '---\ntitle: x\n---\n\n# Body\ntext'
    const r = sectionFoldRanges(state(doc))
    expect(r).toHaveLength(1)
    expect(r[0]?.from).toBe(doc.indexOf('# Body') + 6)
  })
  it('is empty without headings', () => {
    expect(sectionFoldRanges(state('nur text\n\n- liste'))).toEqual([])
  })
})
```

Add to `tests/unit/renderer/setup.test.ts`:

```ts
import { headerHidden } from '../../../src/renderer/editor/header'

describe('createState wiring', () => {
  it('starts with the given header flag and keeps it across view switches', () => {
    const s = createState('---\na: 1\n---\nx', '\n', 'preview', true)
    expect(s.field(headerHidden)).toBe(true)
    const code = s.update({ effects: viewCompartment.reconfigure(viewExtensions('code')) }).state
    expect(code.field(headerHidden)).toBe(true)
    expect(serializeDoc(code.doc, '\n')).toBe('---\na: 1\n---\nx')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/renderer/sections.test.ts tests/unit/renderer/setup.test.ts`
Expected: FAIL, because `sections.ts` is missing and `createState` has no fourth parameter.

- [ ] **Step 3: Implement**

```bash
npm install -D @codemirror/language-data@^6.5.2
```

`src/renderer/editor/sections.ts`:

```ts
import { ensureSyntaxTree, foldable, foldEffect, syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Fold ranges of every heading's section (lang-markdown's header fold service). */
export function sectionFoldRanges(state: EditorState): { from: number; to: number }[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
  const out: { from: number; to: number }[] = []
  tree.iterate({
    enter: (node) => {
      if (node.name === 'Frontmatter') return false
      if (/^(ATX|Setext)Heading\d$/.test(node.name)) {
        const line = state.doc.lineAt(node.from)
        const range = foldable(state, line.from, line.to)
        if (range) out.push(range)
        return false
      }
      return undefined
    },
  })
  return out
}

/** "Alle einklappen": every heading section, the outline stays visible. */
export function foldAllSections(view: EditorView): boolean {
  const ranges = sectionFoldRanges(view.state)
  if (!ranges.length) return false
  view.dispatch({ effects: ranges.map((r) => foldEffect.of(r)) })
  return true
}
```

Replace `src/renderer/editor/setup.ts` with:

```ts
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeFolding, foldGutter, foldKeymap } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view'
import type { Eol, View } from '../../shared/types'
import { Frontmatter } from './frontmatter'
import { headerFold, headerHidden } from './header'
import { rfHighlight } from './highlight'
import { previewPlugin } from './preview'
import { tableField } from './tables'

export const viewCompartment = new Compartment()

export function viewExtensions(view: View): Extension {
  return view === 'code'
    ? [lineNumbers(), foldGutter(), EditorView.editorAttributes.of({ class: 'rf-code' })]
    : [foldGutter(), EditorView.editorAttributes.of({ class: 'rf-preview' }), previewPlugin, tableField, headerFold]
}

export function createState(text: string, eol: Eol, view: View, headerHiddenInit = false): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      codeFolding(),
      keymap.of([...foldKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Frontmatter] }),
      rfHighlight,
      headerHidden.init(() => headerHiddenInit),
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
Expected: PASS. That includes the existing setup tests: byte-exact LF, CRLF and mixed, the CRLF newline, and the view switch.

- [ ] **Step 5: Gate and commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git add package.json package-lock.json src/renderer/editor/sections.ts src/renderer/editor/setup.ts tests/unit/renderer/sections.test.ts tests/unit/renderer/setup.test.ts
git commit -m "feat(editor): wire preview, header, folding and code languages into the editor"
```

---

### Task 9: View menu, view switch, header toggle and font notice in the app

**Files:**
- Modify: `src/shared/types.ts`, `src/main/menu.ts`, `tests/unit/main/menu.test.ts`, `src/renderer/app.ts`

**Interfaces:**
- Consumes:
  - `createState(…, headerHiddenInit)`, `viewCompartment`, `viewExtensions` (Task 8)
  - `headerHidden`, `headerToggleSpec` (Task 7)
  - `foldAllSections` (Task 8)
  - `StartupState.fonts` (Task 1)
- Produces:
  - New `MenuCommand` values: `'toggle-view' | 'toggle-header' | 'fold' | 'unfold' | 'fold-all' | 'unfold-all'`
  - View menu accelerators:

    | Command | macOS | Windows/Linux |
    |---|---|---|
    | `toggle-view` | `CmdOrCtrl+Shift+M` | same |
    | `toggle-header` | `CmdOrCtrl+Shift+H` | same |
    | `fold` / `unfold` | `Cmd+Alt+[` / `Cmd+Alt+]` | `Ctrl+Shift+[` / `Ctrl+Shift+]` |
    | `fold-all` / `unfold-all` | `Ctrl+Alt+[` / `Ctrl+Alt+]` | same |

- [ ] **Step 1: Write the failing menu tests**

In `tests/unit/main/menu.test.ts`, add these rows to the darwin `it.each` table of command items:

```ts
    ['toggle-view', 'CmdOrCtrl+Shift+M'],
    ['toggle-header', 'CmdOrCtrl+Shift+H'],
    ['fold', 'Cmd+Alt+['],
    ['unfold', 'Cmd+Alt+]'],
    ['fold-all', 'Ctrl+Alt+['],
    ['unfold-all', 'Ctrl+Alt+]'],
```

Then add a test:

```ts
  it('uses Ctrl+Shift+[ / ] for folding on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const items = flatten(buildMenuTemplate(deps({ platform })))
      expect(items.find((i) => i.id === 'fold')?.accelerator).toBe('Ctrl+Shift+[')
      expect(items.find((i) => i.id === 'unfold')?.accelerator).toBe('Ctrl+Shift+]')
    }
  })
  it('puts the view items under "Ansicht" in production too', () => {
    const view = buildMenuTemplate(deps()).find((m) => m.label === 'Ansicht')
    const ids = (view?.submenu as { id?: string }[]).map((i) => i.id).filter(Boolean)
    expect(ids).toEqual(['toggle-view', 'toggle-header', 'fold', 'unfold', 'fold-all', 'unfold-all'])
  })
```

Run: `npx vitest run tests/unit/main/menu.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement the menu**

In `src/shared/types.ts`, extend `MenuCommand` with `| 'toggle-view' | 'toggle-header' | 'fold' | 'unfold' | 'fold-all' | 'unfold-all'`.

In `src/main/menu.ts`, replace the `view` menu with:

```ts
  const foldKey = mac ? 'Cmd+Alt+' : 'Ctrl+Shift+'
  const view: MenuItemConstructorOptions = {
    label: 'Ansicht',
    submenu: [
      item('toggle-view', 'Code-Ansicht ein/aus', 'CmdOrCtrl+Shift+M'),
      item('toggle-header', 'YAML-Header ein/aus', 'CmdOrCtrl+Shift+H'),
      sep,
      item('fold', 'Abschnitt einklappen', `${foldKey}[`),
      item('unfold', 'Abschnitt ausklappen', `${foldKey}]`),
      item('fold-all', 'Alle einklappen', 'Ctrl+Alt+['),
      item('unfold-all', 'Alle ausklappen', 'Ctrl+Alt+]'),
      ...(d.isDev
        ? [sep, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions]
        : []),
    ],
  }
```

Update the existing dev-tools test only if it relied on the old empty production menu. It must still assert that dev tools appear only when `isDev` is true.

Run: `npx vitest run tests/unit/main/menu.test.ts`
Expected: PASS.

- [ ] **Step 3: App integration (`src/renderer/app.ts`)**

New imports:

```ts
import { foldCode, unfoldAll, unfoldCode } from '@codemirror/language'
import { headerHidden, headerToggleSpec } from './editor/header'
import { foldAllSections } from './editor/sections'
import { createState, serializeDoc, viewCompartment, viewExtensions } from './editor/setup'
```

The last line replaces the current import from `./editor/setup`.

Pass the header flag wherever a state is created:
- `newNote`: `createState('', '\n', this.view, false)`
- `openPath`: `createState(res.text, res.eol, this.view, headerHidden)`. That is the existing `headerHidden` parameter of `openPath`; rename it to `hideHeader` there to avoid a clash with the imported field.
- `reload`: `createState(note.text, note.eol, this.view, tab.headerHidden)`

New cases in `command()`:

```ts
      case 'toggle-view':
        return this.setView(this.view === 'code' ? 'preview' : 'code')
      case 'toggle-header':
        return this.toggleHeader()
      case 'fold':
        foldCode(this.editor)
        this.editor.focus()
        return
      case 'unfold':
        unfoldCode(this.editor)
        this.editor.focus()
        return
      case 'fold-all':
        foldAllSections(this.editor)
        this.editor.focus()
        return
      case 'unfold-all':
        unfoldAll(this.editor)
        this.editor.focus()
        return
```

New methods:

```ts
  /** Code ↔ Preview for every tab; the documents are never touched. */
  private setView(view: View): void {
    if (view === this.view) return
    this.view = view
    const effects = viewCompartment.reconfigure(viewExtensions(view))
    for (const tab of this.store.all) {
      if (tab.id === this.shownId) this.editor.dispatch({ effects })
      else this.store.updateState(tab.id, tab.state.update({ effects }).state)
    }
    this.syncMain()
    this.editor.focus()
  }

  private toggleHeader(): void {
    const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
    if (!tab) return
    if (this.view !== 'preview') {
      this.notices.toast('Der YAML-Header lässt sich nur in der Preview ausblenden.')
      return
    }
    const hide = !this.editor.state.field(headerHidden)
    this.editor.dispatch(headerToggleSpec(this.editor.state, hide))
    tab.headerHidden = hide
    this.syncMain()
    this.editor.focus()
  }
```

Font notice: in `start()`, right after `const startup = await this.rfw.startup()`, add:

```ts
    if (!startup.fonts.found) {
      this.notices.panel(
        'Schriften nicht gefunden',
        `Die Schriften von real-fast-document fehlen in:\n${startup.fonts.dir}\n\nrf-write nutzt Systemschriften, bis rf-document installiert ist.\n\n${INSTALL_HINT}`,
      )
    }
```

- [ ] **Step 4: Gate, smoke and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: green.

Run `npm run dev` and open `tests/fixtures/preview.md` from Task 10 (create it now if you want to look). Check by hand:
- Preview shows serif headings, squares, checkboxes, the alert bar and a striped table.
- Mod+Shift+M switches to Code.
- Mod+Shift+H collapses the header.
Report what you could observe.

```bash
git add src/shared/types.ts src/main/menu.ts tests/unit/main/menu.test.ts src/renderer/app.ts
git commit -m "feat(app): add view menu with code/preview switch, header toggle and folding"
```

---

### Task 10: End-to-end tests, screenshots and docs

**Files:**
- Create: `tests/fixtures/preview.md`, `tests/e2e/preview.spec.ts`
- Modify: `README.md`, `README.en.md`, `CHANGELOG.md`, local `CLAUDE.md` (do not commit it)

**Interfaces:**
- Consumes: everything above. E2E helpers `launch`, `makeDirs`, `clickMenu`, `waitForFile`, `shot` from `tests/e2e/helpers.ts`. `fontDir` from `src/main/fonts.ts`.

- [ ] **Step 1: Fixture**

`tests/fixtures/preview.md` (LF line endings):

````markdown
---
client: "Muster GmbH"
title: "Kickoff Kaffeerösterei"
subtitle: "Protokoll"
author: "Anna"
date: 2026-10-14
---

# Agenda

Ein Absatz mit **fett**, *kursiv*, `code` und einem [Link](https://example.com), damit Blocksatz und Silbentrennung sichtbar werden: Donaudampfschifffahrtsgesellschaft.

## Aufgaben

- [ ] Angebot schicken – Anna, bis 17.10.
- [x] Termin bestätigt
- Normaler Punkt

> [!WARNING]
> Lieferzeit beachten.

| Produkt | Menge | Preis |
|:--|:-:|---|
| Espresso | 12 | 3,50 € |
| Filter | 8 | 2 € |
| **Neu** | 1 | 12,00 € |

```js
const preis = 12.5 // Euro
```

### Notizen

Text unter drei Rauten.
````

- [ ] **Step 2: Write the E2E suite**

`tests/e2e/preview.spec.ts`:

```ts
import { access, copyFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { fontDir } from '../../src/main/fonts'
import { clickMenu, launch, makeDirs, shot, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')

async function openFixture(extra: { env?: Record<string, string> } = {}) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note], ...extra })
  await launched.page.locator('.cm-editor.rf-preview').waitFor()
  return { ...launched, note, original: await readFile(note) }
}

test('renders the PDF look', async () => {
  const { app, page } = await openFixture()
  await expect(page.locator('.cm-line.rf-h1')).toHaveCount(1)
  await expect(page.locator('.cm-line.rf-h2')).toHaveCount(1)
  await expect(page.locator('.rf-task')).toHaveCount(2)
  await expect(page.locator('.rf-alert-title')).toHaveText('Hinweis')
  await expect(page.locator('table.rf-table thead th')).toHaveText(['Produkt', 'Menge', 'Preis'])
  await expect(page.locator('table.rf-table tbody tr').nth(1)).toHaveClass(/rf-table-stripe/)
  await expect(page.locator('table.rf-table tbody tr').first().locator('td').nth(2)).toHaveClass(/rf-al-right/)
  await expect(page.locator('.cm-line.rf-codeblock').first()).toBeVisible()
  const justified = await page.evaluate(() => document.documentElement.classList.contains('rf-justify'))
  test.info().annotations.push({ type: 'hyphenation', description: justified ? 'justified' : 'flush-left' })
  await shot(page, 'preview')
  await app.close()
})

test('a checkbox click changes exactly one byte on disk', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('.rf-task').first().click()
  const after = await waitForFile(note, (b) => !b.equals(original))
  expect(after.length).toBe(original.length)
  const diffs = [...after].map((byte, i) => (byte === original[i] ? -1 : i)).filter((i) => i >= 0)
  expect(diffs).toHaveLength(1)
  expect(String.fromCharCode(after[diffs[0] as number] as number)).toBe('x')
  await app.close()
})

test('a table click switches to Markdown editing and back, bytes untouched', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('table.rf-table').click()
  await expect(page.locator('table.rf-table')).toHaveCount(0)
  await expect(page.locator('.cm-line.rf-table-head')).toBeVisible()
  await shot(page, 'table-editing')
  await page.locator('.cm-line.rf-h1').click()
  await expect(page.locator('table.rf-table')).toHaveCount(1)
  await page.waitForTimeout(1500)
  expect((await readFile(note)).equals(original)).toBe(true)
  await app.close()
})

test('the YAML header collapses, stays collapsed after restart, disk untouched', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-header')
  await expect(first.page.locator('.rf-titleblock .rf-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  await expect(first.page.locator('.rf-titleblock .rf-tb-client')).toHaveText('Muster GmbH')
  await expect(first.page.locator('.rf-titleblock .rf-tb-subtitle')).toHaveText('Protokoll')
  await expect(first.page.locator('.rf-titleblock .rf-tb-meta')).toHaveText('14. Oktober 2026 · Anna')
  await expect(first.page.locator('.cm-line.rf-frontmatter')).toHaveCount(0)
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await shot(first.page, 'preview-header-hidden')
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.rf-titleblock')).toBeVisible()
  await second.app.close()
})

test('code/preview switch keeps the bytes and survives a restart', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-view')
  await expect(first.page.locator('.cm-editor.rf-code')).toBeVisible()
  await expect(first.page.locator('.cm-lineNumbers')).toBeVisible()
  await shot(first.page, 'code')
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.cm-editor.rf-code')).toBeVisible()
  await clickMenu(second.app, 'toggle-view')
  await expect(second.page.locator('.cm-editor.rf-preview')).toBeVisible()
  await second.app.close()
})

test('fold all hides section bodies, unfold all brings them back', async () => {
  const { app, page } = await openFixture()
  const body = page.locator('.cm-line', { hasText: 'Text unter drei Rauten' })
  await expect(body).toHaveCount(1)
  await clickMenu(app, 'fold-all')
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  await expect(body).toHaveCount(0)
  await clickMenu(app, 'unfold-all')
  await expect(body).toHaveCount(1)
  await app.close()
})

test('loads rf-document fonts when installed', async () => {
  const dir = fontDir(process.platform, process.env, homedir())
  const installed = await access(join(dir, 'SourceSans3VF-Upright.otf')).then(
    () => true,
    () => false,
  )
  test.skip(!installed, `rf-document fonts not installed in ${dir}`)
  const { app, page } = await openFixture()
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].some((f) => f.family.includes('rfdoc Sans') && f.status === 'loaded')
  })
  expect(loaded).toBe(true)
  await app.close()
})

test('missing fonts: one notice, editing still works', async () => {
  const empty = await makeDirs()
  const { app, page } = await openFixture({ env: { RFD_HOME: empty.root } })
  await expect(page.locator('.panel')).toContainText('Schriften nicht gefunden')
  await expect(page.locator('.cm-editor.rf-preview')).toBeVisible()
  await app.close()
})
```

`__dirname` is available, because Playwright transpiles to CommonJS. If it is not available in the project's Playwright setup, use `path.resolve('tests/fixtures/preview.md')` (the cwd is the repo root) and note it.

- [ ] **Step 3: Run the E2E suite**

Run: `npm run test:e2e`
Expected: all pass. The fonts test passes locally if rf-document is installed, and on CI after the rf-document bootstrap step. Record the hyphenation annotation (justified or flush-left) in the report.

Fix code, not tests, unless a test is provably wrong (record why).

- [ ] **Step 4: Docs (exact README parity)**

Both READMEs get rows in the shortcut table. The German text goes in `README.md`, an English translation in `README.en.md`:

| Kürzel | Aktion |
|--------|--------|
| Mod+Shift+M | Code-Ansicht ein/aus (Preview ist Standard) |
| Mod+Shift+H | YAML-Header in der Preview ein-/ausblenden (ausgeblendet erscheint der Titelblock wie im PDF) |
| macOS Cmd+Alt+[ / ], sonst Ctrl+Shift+[ / ] | Abschnitt ein-/ausklappen |
| Ctrl+Alt+[ / ] | Alle Abschnitte ein-/ausklappen |

In the „Status“/"Status" sections, move "die PDF-Optik in der Vorschau" / "the PDF look in the preview" from *not yet* to *available*. Add one sentence under Usage in both READMEs: Preview uses rf-document's fonts from its install folder and otherwise falls back to system fonts.

`CHANGELOG.md` under `[Unreleased]` → `Added`:
- "Preview in the PDF look: rf-document fonts, headings, lists with squares, clickable checkboxes, alert boxes, striped tables, code blocks with Typst colours"
- "Tables like the PDF (columns, alignment, stripes), editable as Markdown on click"
- "Code/Preview switch, YAML header that collapses into the PDF title block, section folding (single and all)"

Local `CLAUDE.md`, not committed:
- Set "Project status" to plan 2.
- Add architecture notes:
  - `buildPreview` handlers and the `rf` decoration spec names
  - `headerHidden` lives in the base extensions, `headerFold` in Preview
  - fonts via `rfw-font://` with a whitelist
  - `html.rf-justify` from the hyphenation probe

- [ ] **Step 5: Final gate and commit**

Run: `diff <(grep -c '^## ' README.md) <(grep -c '^## ' README.en.md) && npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e`
Expected: green, coverage ≥ 80 %.

```bash
git add tests/fixtures/preview.md tests/e2e/preview.spec.ts README.md README.en.md CHANGELOG.md
git commit -m "test(e2e): cover preview look, checkbox, header, view switch, folding and fonts"
```

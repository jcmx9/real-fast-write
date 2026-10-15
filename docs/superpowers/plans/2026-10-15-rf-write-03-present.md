# rf-write Plan 3 – Present Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Present mode for meetings.
- The single window goes fullscreen. Only the text and one quiet info line remain: clock, tabs, back to Edit, zoom, save state.
- The text is larger and stays fully editable.
- The YAML header is shown as rf-document's title block.
- Zoom works in Edit and in Present. Body text is justified without hyphenation on every OS, as rf-document sets it.

**Architecture:**
- **Mode switch:** a new `modeCompartment` carries a `presentMode` facet into every tab's `EditorState`. The header field reads the facet: in Present it collapses the front matter into the title block (read-only, cursor kept out) regardless of the per-tab toggle. The document is never touched.
- **Fullscreen:** the main process exposes `setFullScreen` over IPC and reports a fullscreen exit that the OS initiated.
- **App controller:** `App` switches the chrome (tab bar and status line ↔ info line), drives zoom through CSS custom properties, and persists zoom per mode.

**Tech Stack:** Electron 44, CodeMirror 6, TypeScript strict, Vitest + happy-dom, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md`. Relevant sections:
- §4 (Present, Zoom), §5 (justified without hyphenation), §7 (session), §10 (View menu)
- All were updated 2026-10-15: title block in Present, app always starts in Edit, zoom keys.

**Builds on:** `dev` at `bf5d4da` (plans 1–2). Relevant existing code:
- `src/renderer/editor/header.ts`
  - `headerHidden` field and `headerFold` StateField. While collapsed, `headerFold` provides decorations, `atomicRanges`, `changeFilter` and `transactionFilter`.
  - `headerToggleSpec(state, hide)`.
- `src/renderer/editor/titleblock.ts`: `renderTitleBlock(tb, doc)`, `titleBlockData(doc)`.
- `src/renderer/editor/setup.ts`
  - `createState(text, eol, view, headerHiddenInit)`, `viewCompartment`, `viewExtensions(view)`.
  - `foldBindings()`. On Windows and Linux, fold-all is Alt+0 / Alt+Shift+0.
- `src/renderer/app.ts`: the `App` class.
  - `view`, `shownId`, `setView()` (reconfigures every tab, shown tab via `editor.dispatch`).
  - `toggleHeader()`, `refresh()`, `syncMain()`, `persistSession()`, `globalKeys()`.
- `src/main/menu.ts`: the "Ansicht" menu (toggle-view, toggle-header, fold…), and `src/main/ipc.ts` / `context.ts`.
- `src/shared/types.ts`: `Session.zoom { edit, present }` is already sanitised in main (0.5–3), and `Settings.presentFontFactor` defaults to 1.6.
- `src/renderer/theme.css`: `--rf-body-size: 10pt` on `:root`, `.rf-preview .cm-scroller { font-size: var(--rf-body-size) }`.
- `src/renderer/ui/hyphenation.ts` with the `html.rf-justify` probe. Task 1 removes it.

## Global Constraints

- **Branch:** work on `feature/present`, branched from `dev`. Open a PR into `dev`, and merge only when CI is green on macOS, Windows and Linux.
- **Commits:** Conventional Commits in English. No `Co-Authored-By` or other AI attribution lines. The author identity is `jcmx9`; never use the real name.
- **`CLAUDE.md`** stays local and is never `git add`-ed.
- **Byte-exact files:** entering and leaving Present, zooming, and the title block never change the document. Editing in Present is normal editing.
- **One window:** Present is the same window in fullscreen (`BrowserWindow.setFullScreen`). On Windows and Linux the menu bar is also hidden while presenting. Menu accelerators keep working.
- **The app always starts in Edit.** Present is never restored from the session, but zoom per mode is.
- **Zoom:**
  - Steps: 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300 %.
  - Edit 100 % = body 10 pt (code view 9 pt). Present = 10 pt × `presentFontFactor` (default 1.6) × present zoom.
  - Zoom scales CSS custom properties, never Electron's page zoom.
- **Present layout:** the text column is about 70ch, centred. No fold gutter, no tab bar, no status line, no export button.
- **Info line content:** clock (HH:MM), tabs (click to switch), "Bearbeiten" (leaves Present), zoom − / + with percentage, save state.
- **Shortcuts:**
  - Present on/off: `CmdOrCtrl+Shift+P`. `Esc` leaves Present.
  - Zoom: `CmdOrCtrl+Plus` (the renderer also accepts Mod+`=`), `CmdOrCtrl+-`, `CmdOrCtrl+0`.
- **Justified text:** body text is justified without hyphenation on every OS (`hyphens: manual`). Headings, tables, code, the title block and the front matter stay flush-left.
- **Code style:**
  - No `innerHTML` with document content.
  - U+FEFF only as `'﻿'`.
  - German UI strings, English code and comments.

## Review Focus

1. **Entering Present with the cursor inside the front matter** moves the cursor after it. In Present the header is read-only even when the per-tab toggle is off, and leaving Present restores the per-tab toggle exactly. Tests: Task 3 unit, Task 7 E2E.
2. **An OS-initiated fullscreen exit** (macOS green button, window manager) leaves Present cleanly. The chrome comes back and the mode is Edit, never a half state. Tests: Task 6 logic, Task 7 E2E (`leave-full-screen` simulated via `setFullScreen(false)` from main).
3. **Esc** leaves Present, but not while a dialog (rename prompt) is open, and not when CodeMirror consumed the key (multi-selection). Tests: Task 7 E2E.
4. **Zoom:** it never goes outside 50–300 %, it is persisted per mode and restored after a restart, and Present starts at 10 pt × factor × present zoom. Tests: Task 2 unit, Task 7 E2E.
5. **Export, the view switch and the header toggle** are refused in Present with a short notice and never act. Tests: Task 7 E2E.

## Not in this plan

- The settings dialog for the Present font factor: Plan 5. The value comes from `settings.json` until then.
- Snippets and the Esc interplay with autocompletion: Plan 4 (autocomplete must win over leaving Present).
- Open follow-ups from Plans 1–2 (path spellings, non-UTF-8 external change, watcher re-arm): a separate fix plan before the first release.

## File Structure

```
src/renderer/theme.css            (modify) justified text without hyphenation, code zoom var, Present layout
src/renderer/styles.css           (modify) flex layout for #app, info line styles
src/renderer/index.html           (modify) <footer id="infoline" hidden>
src/renderer/main.ts              (modify) remove hyphenation probe, pass #infoline
src/renderer/ui/hyphenation.ts    (delete)
src/renderer/ui/zoom.ts           ZOOM_STEPS, zoomIn, zoomOut, zoomLabel, editorSizes
src/renderer/ui/infoline.ts       InfoLine component, formatClock
src/renderer/editor/mode.ts       presentMode facet, modeCompartment, modeExtensions
src/renderer/editor/header.ts     (modify) Present collapses header; moveOutOfHeader
src/renderer/editor/titleblock.ts (modify) empty style 'marker' | 'none'
src/renderer/editor/setup.ts      (modify) createState(..., mode), modeCompartment
src/renderer/app.ts               (modify) Present mode, zoom, info line, fullscreen sync
src/shared/types.ts, src/shared/ipc.ts, src/preload/index.ts   (modify) setFullScreen, onFullScreenLeft, MenuCommands
src/main/ipc.ts, src/main/context.ts, src/main/menu.ts         (modify) fullscreen + menu items
tests/unit/renderer/{zoom,infoline,mode}.test.ts, header/setup/titleblock tests (extend)
tests/unit/main/menu.test.ts (extend)
tests/e2e/present.spec.ts, tests/e2e/preview.spec.ts (modify justify check)
```

---

### Task 1: Justified body text without hyphenation

**Files:**
- Modify: `src/renderer/theme.css`, `src/renderer/main.ts`, `tests/e2e/preview.spec.ts`
- Delete: `src/renderer/ui/hyphenation.ts`

**Interfaces:**
- Produces: body lines in Preview always have `text-align: justify; hyphens: manual`, and the root class `rf-justify` no longer exists.

- [ ] **Step 0: Branch**

```bash
git checkout dev && git pull && git checkout -b feature/present
```

- [ ] **Step 1: Change the E2E expectation first (red)**

In `tests/e2e/preview.spec.ts`, test `renders the PDF look`, replace the hyphenation annotation lines:

```ts
  const justified = await page.evaluate(() => document.documentElement.classList.contains('rf-justify'))
  test.info().annotations.push({ type: 'hyphenation', description: justified ? 'justified' : 'flush-left' })
```

with:

```ts
  // rf-document sets par(justify: true); the editor justifies without hyphenation on every OS.
  const body = page.locator('.cm-line', { hasText: 'Ein Absatz mit' })
  await expect(body).toHaveCSS('text-align', 'justify')
  await expect(body).toHaveCSS('hyphens', 'manual')
  await expect(page.locator('.cm-line.rf-h1')).toHaveCSS('text-align', 'left')
```

Run: `npm run build && npx playwright test tests/e2e/preview.spec.ts -g "renders the PDF look"`
Expected: FAIL on Windows/Linux-like conditions or when the probe returns false. On macOS it may already pass `justify` but fail `hyphens` (currently `auto`). Either way the next step makes it deterministic.

- [ ] **Step 2: Implement**

In `src/renderer/theme.css`, replace:

```css
html.rf-justify .rf-preview .cm-line {
  text-align: justify;
  hyphens: auto;
}
```

with:

```css
/* rf-document: par(justify: true). Typst hyphenates in the PDF; the editor never does. */
.rf-preview .cm-line {
  text-align: justify;
  hyphens: manual;
}
```

Keep every existing flush-left override, for headings, tables, code, front matter and the title block. Check with `grep -n "text-align: left" src/renderer/theme.css` that headings, table lines, code lines and front matter still set `text-align: left`.

In `src/renderer/main.ts`, remove the `supportsGermanHyphenation` import and the `rf-justify` line. Delete `src/renderer/ui/hyphenation.ts`.

- [ ] **Step 3: Verify and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npx playwright test tests/e2e/preview.spec.ts`
Expected: green.

```bash
git add -A src/renderer/theme.css src/renderer/main.ts src/renderer/ui/hyphenation.ts tests/e2e/preview.spec.ts docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md docs/superpowers/plans/2026-10-15-rf-write-03-present.md
git commit -m "feat(theme): justify body text without hyphenation on every platform"
```

This first commit also carries this plan file and the spec update (both are already in the working tree).

---

### Task 2: Zoom model and zoom commands in Edit

**Files:**
- Create: `src/renderer/ui/zoom.ts`, `tests/unit/renderer/zoom.test.ts`
- Modify: `src/shared/types.ts` (MenuCommand), `src/main/menu.ts`, `tests/unit/main/menu.test.ts`, `src/renderer/theme.css`, `src/renderer/app.ts`

**Interfaces:**
- Produces:
  - `ZOOM_STEPS: readonly number[]`
  - `zoomIn(z: number): number`
  - `zoomOut(z: number): number`
  - `zoomLabel(z: number): string` (e.g. `'125 %'`)
  - `editorSizes(mode: Mode, zoom: number, presentFactor: number): { body: string; code: string }` (pt strings)
  - `MenuCommand` gains `'zoom-in' | 'zoom-out' | 'zoom-reset'`
  - CSS custom properties `--rf-body-size` and `--rf-code-size`, set on `#editor`
  - App fields `mode: Mode` (still always `'edit'` in this task), `zoom: { edit: number; present: number }`, `presentFactor: number`
  - App method `applyZoom(): void`

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/zoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { editorSizes, ZOOM_STEPS, zoomIn, zoomLabel, zoomOut } from '../../../src/renderer/ui/zoom'

describe('zoom steps', () => {
  it('walks the fixed steps and clamps at both ends', () => {
    expect(ZOOM_STEPS[0]).toBe(0.5)
    expect(ZOOM_STEPS.at(-1)).toBe(3)
    expect(zoomIn(1)).toBe(1.1)
    expect(zoomOut(1)).toBe(0.9)
    expect(zoomIn(3)).toBe(3)
    expect(zoomOut(0.5)).toBe(0.5)
  })
  it('snaps an off-step value to the next step in the direction', () => {
    expect(zoomIn(1.05)).toBe(1.1)
    expect(zoomOut(1.05)).toBe(1)
  })
  it('labels as rounded percent', () => {
    expect(zoomLabel(0.67)).toBe('67 %')
    expect(zoomLabel(1.25)).toBe('125 %')
  })
})

describe('editorSizes', () => {
  it('Edit: body 10pt and code 9pt at 100 %', () => {
    expect(editorSizes('edit', 1, 1.6)).toEqual({ body: '10pt', code: '9pt' })
  })
  it('Present: body 10pt × factor × zoom', () => {
    expect(editorSizes('present', 1, 1.6)).toEqual({ body: '16pt', code: '14.4pt' })
    expect(editorSizes('present', 1.25, 1.6)).toEqual({ body: '20pt', code: '18pt' })
  })
  it('rounds to two decimals', () => {
    expect(editorSizes('edit', 0.67, 1.6)).toEqual({ body: '6.7pt', code: '6.03pt' })
  })
})
```

In `tests/unit/main/menu.test.ts`, add these rows to the darwin `it.each` command table:

```ts
    ['zoom-in', 'CmdOrCtrl+Plus'],
    ['zoom-out', 'CmdOrCtrl+-'],
    ['zoom-reset', 'CmdOrCtrl+0'],
```

Then extend the expected id list of the test `puts the view items under "Ansicht" in production too`, so zoom follows the fold items:

```ts
    expect(ids).toEqual(['toggle-view', 'toggle-header', 'fold', 'unfold', 'fold-all', 'unfold-all', 'zoom-in', 'zoom-out', 'zoom-reset'])
```

Run: `npx vitest run tests/unit/renderer/zoom.test.ts tests/unit/main/menu.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement zoom.ts**

`src/renderer/ui/zoom.ts`:

```ts
import type { Mode } from '../../shared/types'

export const ZOOM_STEPS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]
const EPS = 1e-9
const round2 = (n: number) => Math.round(n * 100) / 100

export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z + EPS) ?? (ZOOM_STEPS.at(-1) as number)
}

export function zoomOut(z: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < z - EPS) ?? (ZOOM_STEPS[0] as number)
}

export function zoomLabel(z: number): string {
  return `${Math.round(z * 100)} %`
}

/** Edit 100 % = PDF size (10pt body, 9pt code); Present multiplies by the configured factor. */
export function editorSizes(mode: Mode, zoom: number, presentFactor: number): { body: string; code: string } {
  const f = (mode === 'present' ? presentFactor : 1) * zoom
  return { body: `${round2(10 * f)}pt`, code: `${round2(9 * f)}pt` }
}
```

- [ ] **Step 3: Menu, CSS, App**

- **Types:** in `src/shared/types.ts`, extend `MenuCommand` with `| 'zoom-in' | 'zoom-out' | 'zoom-reset'`.
- **Menu:** in `src/main/menu.ts`, append to the "Ansicht" submenu, after the fold items and before the dev items:

```ts
      sep,
      item('zoom-in', 'Vergrößern', 'CmdOrCtrl+Plus'),
      item('zoom-out', 'Verkleinern', 'CmdOrCtrl+-'),
      item('zoom-reset', 'Originalgröße', 'CmdOrCtrl+0'),
```

- **Theme:** in `src/renderer/theme.css`, change the Code view rule `.rf-code .cm-scroller { … font-size: 9pt; … }` to `font-size: var(--rf-code-size, 9pt);`. Preview already uses `var(--rf-body-size)`.

In `src/renderer/app.ts`:
- **Imports:** add `import { editorSizes, zoomIn, zoomOut } from './ui/zoom'`, and `Mode` from shared types.
- **Fields:**

```ts
  private mode: Mode = 'edit'
  private zoom = { edit: 1, present: 1 }
  private presentFactor = 1.6
```

- **`start()`:** after `this.view = startup.session.view`, add:

```ts
    this.zoom = { ...startup.session.zoom }
    this.presentFactor = startup.settings.presentFontFactor
    this.applyZoom()
```

- **New methods:**

```ts
  private setZoom(next: number): void {
    this.zoom[this.mode] = Math.min(3, Math.max(0.5, next))
    this.applyZoom()
    this.syncMain()
  }

  /** Scales the editor via CSS custom properties (never Electron page zoom). */
  private applyZoom(): void {
    const { body, code } = editorSizes(this.mode, this.zoom[this.mode], this.presentFactor)
    this.root.editor.style.setProperty('--rf-body-size', body)
    this.root.editor.style.setProperty('--rf-code-size', code)
    this.editor.requestMeasure()
  }
```

- **`command()` cases:**

```ts
      case 'zoom-in':
        return this.setZoom(zoomIn(this.zoom[this.mode]))
      case 'zoom-out':
        return this.setZoom(zoomOut(this.zoom[this.mode]))
      case 'zoom-reset':
        return this.setZoom(1)
```

- **`globalKeys()`:** before the Mod+1…9 check, add the US-layout zoom-in key:

```ts
    if (mod && !e.altKey && e.key === '=') {
      e.preventDefault()
      this.setZoom(zoomIn(this.zoom[this.mode]))
      return
    }
```

- **`persistSession()`:** save the zoom too: `await this.rfw.saveSession({ tabs, activeIndex, view: this.view, zoom: this.zoom })`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/unit/renderer/zoom.test.ts tests/unit/main/menu.test.ts && npm run lint && npm run typecheck && npm test && npm run build`
Expected: green.

```bash
git add src/renderer/ui/zoom.ts tests/unit/renderer/zoom.test.ts src/shared/types.ts src/main/menu.ts tests/unit/main/menu.test.ts src/renderer/theme.css src/renderer/app.ts
git commit -m "feat(app): zoom the editor per mode with fixed steps"
```

---

### Task 3: Present layer in the editor (mode facet, header in Present)

**Files:**
- Create: `src/renderer/editor/mode.ts`, `tests/unit/renderer/mode.test.ts`
- Modify: `src/renderer/editor/header.ts`, `src/renderer/editor/titleblock.ts`, `src/renderer/editor/setup.ts`, `tests/unit/renderer/header.test.ts`, `tests/unit/renderer/titleblock.test.ts`, `tests/unit/renderer/setup.test.ts`

**Interfaces:**
- Produces:
  - `presentMode: Facet<boolean, boolean>` (true if any provider is true)
  - `modeCompartment: Compartment`
  - `modeExtensions(mode: Mode): Extension`. In Present it returns `presentMode.of(true)` plus the editor class `rf-present`; in Edit it returns `[]`.
  - `moveOutOfHeader(state: EditorState): TransactionSpec`: a selection-only spec that puts a cursor inside the front matter at `range.to + 1`, or `{}`.
  - `renderTitleBlock(tb, doc?, empty?: 'marker' | 'none')`. With `'none'` and no data it renders an empty `div.rf-titleblock.rf-titleblock-none`.
  - `createState(text, eol, view, headerHiddenInit = false, mode: Mode = 'edit')`. In Present the initial cursor is after the front matter.
- Behaviour of `headerFold` with `presentMode`:
  - The header collapses when `headerHidden || present`.
  - In Present it also collapses while a selection touches it; the clamp moves the selection out.
  - In Present a note without title fields shows nothing (`'none'`). In Edit/Preview the marker line stays.
  - The field rebuilds when the facet value changes, i.e. on a compartment reconfigure.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/mode.test.ts`:

```ts
// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { modeCompartment, modeExtensions, presentMode } from '../../../src/renderer/editor/mode'

describe('mode compartment', () => {
  it('Present sets the facet, Edit clears it', () => {
    const s = EditorState.create({ extensions: modeCompartment.of(modeExtensions('present')) })
    expect(s.facet(presentMode)).toBe(true)
    const e = s.update({ effects: modeCompartment.reconfigure(modeExtensions('edit')) }).state
    expect(e.facet(presentMode)).toBe(false)
  })
  it('defaults to false without the compartment', () => {
    expect(EditorState.create({}).facet(presentMode)).toBe(false)
  })
})
```

Add to `tests/unit/renderer/header.test.ts`. Reuse its `DOC`/`END` constants and `collapsed()` helper:

```ts
import { modeCompartment, modeExtensions } from '../../../src/renderer/editor/mode'
import { moveOutOfHeader } from '../../../src/renderer/editor/header'

function makePresent(doc: string, cursor: number, hidden = false) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [headerHidden.init(() => hidden), headerFold, modeCompartment.of(modeExtensions('present'))],
  })
}

describe('Present', () => {
  it('collapses the header even when the per-tab toggle is off', () => {
    expect(collapsed(makePresent(DOC, DOC.length))).toEqual([`header-fold@0-${END}`])
  })
  it('collapses even while the selection touches it, and clamps the selection out', () => {
    const s = makePresent(DOC, DOC.length)
    const next = s.update({ selection: { anchor: 2 } }).state
    expect(collapsed(next)).toEqual([`header-fold@0-${END}`])
    expect(next.selection.main.head).toBe(END + 1)
  })
  it('is read-only in Present', () => {
    const s = makePresent(DOC, DOC.length)
    const next = s.update({ changes: { from: 4, insert: 'x' } }).state
    expect(next.doc.toString()).toBe(DOC)
  })
  it('leaving Present restores the per-tab toggle', () => {
    const s = makePresent(DOC, DOC.length, false)
    const edit = s.update({ effects: modeCompartment.reconfigure(modeExtensions('edit')) }).state
    expect(collapsed(edit)).toEqual([])
    const hidden = makePresent(DOC, DOC.length, true)
    const edit2 = hidden.update({ effects: modeCompartment.reconfigure(modeExtensions('edit')) }).state
    expect(collapsed(edit2)).toEqual([`header-fold@0-${END}`])
  })
  it('a note without title fields shows nothing in Present', () => {
    const doc = '---\ntoc: false\n---\n\n# Body'
    const s = makePresent(doc, doc.length)
    let dom: HTMLElement | null = null
    s.field(headerFold).between(0, doc.length, (_f, _t, d) => {
      dom = (d.spec.widget as { toDOM(): HTMLElement }).toDOM()
    })
    expect((dom as HTMLElement | null)?.classList.contains('rf-titleblock-none')).toBe(true)
    expect((dom as HTMLElement | null)?.textContent).toBe('')
  })
})

describe('moveOutOfHeader', () => {
  it('moves a cursor inside the front matter after it, else does nothing', () => {
    const inside = EditorState.create({ doc: DOC, selection: { anchor: 5 } })
    expect(inside.update(moveOutOfHeader(inside)).state.selection.main.head).toBe(END + 1)
    const outside = EditorState.create({ doc: DOC, selection: { anchor: DOC.length } })
    expect(moveOutOfHeader(outside)).toEqual({})
  })
})
```

Add to `tests/unit/renderer/titleblock.test.ts`:

```ts
  it("renders nothing with empty style 'none'", () => {
    const el = renderTitleBlock(null, document, 'none')
    expect(el.className).toBe('rf-titleblock rf-titleblock-none')
    expect(el.textContent).toBe('')
  })
```

Add to `tests/unit/renderer/setup.test.ts`:

```ts
import { presentMode } from '../../../src/renderer/editor/mode'

describe('createState mode', () => {
  it('Present starts with the cursor after the header and the facet set', () => {
    const doc = '---\na: 1\n---\nx'
    const s = createState(doc, '\n', 'preview', false, 'present')
    expect(s.facet(presentMode)).toBe(true)
    expect(s.selection.main.head).toBe(13)
  })
  it('Edit keeps the old default', () => {
    expect(createState('---\na: 1\n---\nx', '\n', 'preview').selection.main.head).toBe(0)
  })
})
```

Run: `npx vitest run tests/unit/renderer`
Expected: FAIL. `mode.ts` is missing, `moveOutOfHeader` is not exported, and `createState` has no mode parameter.

- [ ] **Step 2: Implement**

`src/renderer/editor/mode.ts`:

```ts
import { Compartment, type Extension, Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Mode } from '../../shared/types'

/** True in Present: the header shows as the title block and is read-only regardless of the toggle. */
export const presentMode = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) })

export const modeCompartment = new Compartment()

export function modeExtensions(mode: Mode): Extension {
  return mode === 'present' ? [presentMode.of(true), EditorView.editorAttributes.of({ class: 'rf-present' })] : []
}
```

Changes in `src/renderer/editor/titleblock.ts`: give `renderTitleBlock` a third parameter `empty: 'marker' | 'none' = 'marker'`. When `!tb`:

```ts
  if (!tb) {
    if (empty === 'none') {
      el.classList.add('rf-titleblock-none')
      return el
    }
    el.classList.add('rf-titleblock-empty')
    el.textContent = '⋯ YAML-Header'
    return el
  }
```

Changes in `src/renderer/editor/header.ts`:
- Import `presentMode` from `./mode`.
- `TitleBlockWidget` gets a second constructor field `present: boolean`. `eq` also compares `present`, and `toDOM` returns `renderTitleBlock(this.data, document, this.present ? 'none' : 'marker')`.
- `build(state)`:

```ts
function build(state: EditorState): DecorationSet {
  const present = state.facet(presentMode)
  if (!present && !state.field(headerHidden, false)) return Decoration.none
  const range = frontmatterRange(state.doc)
  if (!range) return Decoration.none
  // Outside Present, a selection on the header (e.g. just retyped) keeps it visible.
  if (!present && state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from)) {
    return Decoration.none
  }
  return Decoration.set([
    Decoration.replace({
      widget: new TitleBlockWidget(titleBlockData(state.doc), present),
      block: true,
      rf: 'header-fold',
    }).range(range.from, range.to),
  ])
}
```

- `headerFold.update`: also rebuild when `tr.startState.facet(presentMode) !== tr.state.facet(presentMode)`.
- New export, and `headerToggleSpec` reuses it:

```ts
/** Selection-only spec: a cursor inside the front matter moves to the line after it. */
export function moveOutOfHeader(state: EditorState): TransactionSpec {
  const range = frontmatterRange(state.doc)
  if (!range) return {}
  const inside = state.selection.ranges.some((r) => r.from <= range.to && r.to >= range.from)
  if (!inside) return {}
  return { selection: EditorSelection.cursor(Math.min(range.to + 1, state.doc.length)), scrollIntoView: true }
}

export function headerToggleSpec(state: EditorState, hide: boolean): TransactionSpec {
  const effects = setHeaderHidden.of(hide)
  return hide ? { ...moveOutOfHeader(state), effects } : { effects }
}
```

Changes in `src/renderer/editor/setup.ts`:
- Import `modeCompartment` and `modeExtensions` from `./mode`, and `Mode` from shared types.
- The signature becomes `createState(text, eol, view, headerHiddenInit = false, mode: Mode = 'edit')`.
- Add `modeCompartment.of(modeExtensions(mode))` after `viewCompartment.of(…)`.
- The initial cursor rule becomes `const range = headerHiddenInit || mode === 'present' ? frontmatterRange(state.doc) : null`.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run tests/unit/renderer && npm run lint && npm run typecheck && npm test`
Expected: PASS. All existing header and setup tests stay green.

```bash
git add src/renderer/editor/mode.ts src/renderer/editor/header.ts src/renderer/editor/titleblock.ts src/renderer/editor/setup.ts tests/unit/renderer/mode.test.ts tests/unit/renderer/header.test.ts tests/unit/renderer/titleblock.test.ts tests/unit/renderer/setup.test.ts
git commit -m "feat(editor): present mode shows the header as title block, read-only"
```

---

### Task 4: Fullscreen over IPC and the Present menu item

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/ipc.ts`, `src/main/context.ts`, `src/main/menu.ts`, `tests/unit/main/menu.test.ts`

**Interfaces:**
- Produces:
  - `RfwApi.setFullScreen(on: boolean): Promise<void>` and `RfwApi.onFullScreenLeft(cb: () => void): void`
  - `Ch.setFullScreen = 'rfw:set-fullscreen'` and `Ch.fullScreenLeft = 'rfw:fullscreen-left'`
  - `MenuCommand` gains `'toggle-present'`. Menu item `item('toggle-present', 'Präsentieren ein/aus', 'CmdOrCtrl+Shift+P')` goes first in "Ansicht", followed by a separator.
- Main behaviour:
  - `setFullScreen(on)` calls `win.setFullScreen(on)`. On Windows and Linux it also calls `win.setMenuBarVisibility(!on)`.
  - The window's `leave-full-screen` event restores the menu bar on Windows/Linux and sends `Ch.fullScreenLeft`.

- [ ] **Step 1: Failing menu test**

In `tests/unit/main/menu.test.ts`, add `['toggle-present', 'CmdOrCtrl+Shift+P']` to the darwin command table. Make the "Ansicht" id list start with `'toggle-present'`:

```ts
    expect(ids).toEqual(['toggle-present', 'toggle-view', 'toggle-header', 'fold', 'unfold', 'fold-all', 'unfold-all', 'zoom-in', 'zoom-out', 'zoom-reset'])
```

Run: `npx vitest run tests/unit/main/menu.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

- `src/shared/types.ts`:
  - `MenuCommand` gains `| 'toggle-present'`.
  - `RfwApi` gains the two signatures above.
- `src/shared/ipc.ts`: add `setFullScreen: 'rfw:set-fullscreen'` and `fullScreenLeft: 'rfw:fullscreen-left'`. The existing IPC test checks uniqueness.
- `src/preload/index.ts`:

```ts
  setFullScreen: (on) => ipcRenderer.invoke(Ch.setFullScreen, on),
  onFullScreenLeft: (cb) => {
    ipcRenderer.on(Ch.fullScreenLeft, () => cb())
  },
```

- `src/main/ipc.ts`, inside `registerIpc`:

```ts
  ipcMain.handle(Ch.setFullScreen, (e, on: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    const flag = on === true
    // macOS hides the menu bar in fullscreen itself; Windows/Linux need it hidden explicitly.
    if (process.platform !== 'darwin') win.setMenuBarVisibility(!flag)
    win.setFullScreen(flag)
  })
```

- `src/main/context.ts`, in `createWindow()` after the existing `win.on('closed', …)`:

```ts
    win.on('leave-full-screen', () => {
      if (process.platform !== 'darwin') win.setMenuBarVisibility(true)
      this.send(Ch.fullScreenLeft)
    })
```

- `src/main/menu.ts`: the first entries of the "Ansicht" submenu become `item('toggle-present', 'Präsentieren ein/aus', 'CmdOrCtrl+Shift+P'), sep,`, followed by the existing items.

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run tests/unit/main/menu.test.ts tests/unit/shared/ipc.test.ts && npm run lint && npm run typecheck && npm test && npm run build`
Expected: green.

```bash
git add src/shared/types.ts src/shared/ipc.ts src/preload/index.ts src/main/ipc.ts src/main/context.ts src/main/menu.ts tests/unit/main/menu.test.ts
git commit -m "feat(main): fullscreen over IPC and a Present menu item"
```

---

### Task 5: Info line component

**Files:**
- Create: `src/renderer/ui/infoline.ts`, `tests/unit/renderer/infoline.test.ts`

**Interfaces:**
- Produces:
  - `formatClock(d: Date): string` (`'09:05'`)
  - `interface InfoLineTab { name: string; dirty: boolean }`
  - `interface InfoLineActions { selectTab(index: number): void; exitPresent(): void; zoomIn(): void; zoomOut(): void }`
  - `class InfoLine`:
    - `constructor(el: HTMLElement, actions: InfoLineActions, now?: () => Date)`
    - `start(): void`: shows the clock now and updates it every 15 s
    - `stop(): void`
    - `render(tabs: readonly InfoLineTab[], active: number, saveText: string, zoom: number): void`
- DOM hooks, as `data-testid`:
  - `il-clock`, `il-tab` (with class `active` / `dirty`), `il-edit`, `il-zoom-out`, `il-zoom`, `il-zoom-in`, `il-state`
- Every button is `type="button"` and has `tabIndex = -1`, so clicks never steal the editor's keyboard focus. All text is set with `textContent`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/renderer/infoline.test.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatClock, InfoLine } from '../../../src/renderer/ui/infoline'

const actions = () => ({ selectTab: vi.fn(), exitPresent: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() })
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid=${id}]`) as HTMLElement

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date(2026, 9, 15, 9, 5))).toBe('09:05')
    expect(formatClock(new Date(2026, 9, 15, 23, 59))).toBe('23:59')
  })
})

describe('InfoLine', () => {
  it('renders tabs, state and zoom, and calls the actions', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a, () => new Date(2026, 9, 15, 14, 30))
    line.render([{ name: 'A.md', dirty: false }, { name: 'B.md', dirty: true }], 1, 'Gespeichert', 1.25)
    const tabs = el.querySelectorAll('[data-testid=il-tab]')
    expect([...tabs].map((t) => t.textContent)).toEqual(['A.md', 'B.md'])
    expect(tabs[1]?.classList.contains('active')).toBe(true)
    expect(tabs[1]?.classList.contains('dirty')).toBe(true)
    expect(q(el, 'il-state').textContent).toBe('Gespeichert')
    expect(q(el, 'il-zoom').textContent).toBe('125 %')
    ;(tabs[0] as HTMLElement).click()
    q(el, 'il-edit').click()
    q(el, 'il-zoom-in').click()
    q(el, 'il-zoom-out').click()
    expect(a.selectTab).toHaveBeenCalledWith(0)
    expect(a.exitPresent).toHaveBeenCalledOnce()
    expect(a.zoomIn).toHaveBeenCalledOnce()
    expect(a.zoomOut).toHaveBeenCalledOnce()
  })
  it('updates the clock while started and stops cleanly', () => {
    let now = new Date(2026, 9, 15, 14, 30)
    const el = document.createElement('footer')
    const line = new InfoLine(el, actions(), () => now)
    line.start()
    expect(q(el, 'il-clock').textContent).toBe('14:30')
    now = new Date(2026, 9, 15, 14, 31)
    vi.advanceTimersByTime(15_000)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
    line.stop()
    now = new Date(2026, 9, 15, 15, 0)
    vi.advanceTimersByTime(60_000)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
  })
  it('renders names as text, never HTML', () => {
    const el = document.createElement('footer')
    new InfoLine(el, actions()).render([{ name: '<b>x</b>.md', dirty: false }], 0, '', 1)
    expect(el.querySelector('b')).toBeNull()
  })
})
```

Run: `npx vitest run tests/unit/renderer/infoline.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/renderer/ui/infoline.ts`:

```ts
import { zoomLabel } from './zoom'

export interface InfoLineTab {
  name: string
  dirty: boolean
}

export interface InfoLineActions {
  selectTab(index: number): void
  exitPresent(): void
  zoomIn(): void
  zoomOut(): void
}

export function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function button(testid: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.tabIndex = -1
  b.dataset.testid = testid
  b.textContent = text
  b.title = title
  b.addEventListener('click', onClick)
  return b
}

/** Present's only chrome: clock, tabs, back to Edit, zoom, save state. */
export class InfoLine {
  private readonly clock = document.createElement('span')
  private readonly tabs = document.createElement('span')
  private readonly zoom = document.createElement('span')
  private readonly state = document.createElement('span')
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    el: HTMLElement,
    private readonly actions: InfoLineActions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.clock.className = 'rf-il-clock'
    this.clock.dataset.testid = 'il-clock'
    this.tabs.className = 'rf-il-tabs'
    this.zoom.className = 'rf-il-zoom'
    this.zoom.dataset.testid = 'il-zoom'
    this.state.className = 'rf-il-state'
    this.state.dataset.testid = 'il-state'
    const spacer = document.createElement('span')
    spacer.className = 'rf-il-spacer'
    el.replaceChildren(
      this.clock,
      this.tabs,
      spacer,
      button('il-edit', 'Bearbeiten', 'Präsentation beenden (Esc)', () => actions.exitPresent()),
      button('il-zoom-out', '−', 'Verkleinern', () => actions.zoomOut()),
      this.zoom,
      button('il-zoom-in', '+', 'Vergrößern', () => actions.zoomIn()),
      this.state,
    )
  }

  start(): void {
    this.tick()
    if (this.timer === null) this.timer = setInterval(() => this.tick(), 15_000)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  render(tabs: readonly InfoLineTab[], active: number, saveText: string, zoom: number): void {
    this.tabs.replaceChildren(
      ...tabs.map((t, i) => {
        const b = button('il-tab', t.name, t.name, () => this.actions.selectTab(i))
        b.classList.add('rf-il-tab')
        b.classList.toggle('active', i === active)
        b.classList.toggle('dirty', t.dirty)
        return b
      }),
    )
    this.state.textContent = saveText
    this.zoom.textContent = zoomLabel(zoom)
  }

  private tick(): void {
    this.clock.textContent = formatClock(this.now())
  }
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run tests/unit/renderer/infoline.test.ts && npm run lint && npm run typecheck && npm test`
Expected: green.

```bash
git add src/renderer/ui/infoline.ts tests/unit/renderer/infoline.test.ts
git commit -m "feat(ui): add Present's info line with clock, tabs, zoom and save state"
```

---

### Task 6: Present mode in the app

**Files:**
- Modify: `src/renderer/app.ts`, `src/renderer/main.ts`, `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/theme.css`, `src/renderer/ui/statusline.ts` (export the save-state labels)

**Interfaces:**
- Consumes:
  - `modeCompartment`, `modeExtensions`, `moveOutOfHeader` (Task 3)
  - `createState(…, mode)` (Task 3)
  - `InfoLine` (Task 5)
  - `setFullScreen`, `onFullScreenLeft`, `'toggle-present'` (Task 4)
  - zoom (Task 2)
- Produces:
  - `AppRoot.infoline: HTMLElement`
  - `App.enterPresent()` and `App.exitPresent()`, both private
  - The body class `rf-mode-present`
  - `export const SAVE_STATE_LABEL: Record<SaveState, string>` from `statusline.ts`, shared with the info line
- Rules:
  - **Entering Present:**
    - All tabs switch to Preview with `presentMode`, and a cursor inside the header moves out.
    - The tab bar and status line hide and the info line shows.
    - Zoom switches to the Present value, then the window goes fullscreen.
  - **Leaving Present** (Esc, the info line button, the menu, or the OS exiting fullscreen):
    - Everything reverses, the per-tab view (Code or Preview) is restored, and fullscreen ends.
  - **In Present**, Export, Code/Preview and the header toggle only show a toast.

- [ ] **Step 1: Markup and layout**

In `src/renderer/index.html`, add `<footer id="infoline" hidden></footer>` directly after `<footer id="status"></footer>`.

In `src/renderer/styles.css`, replace the grid layout of `#app` with a flex column. Hidden elements then take no row:

```css
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
#workspace {
  position: relative;
  flex: 1;
  min-height: 0;
}
#infoline {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px;
  font-size: 12px;
  color: var(--chrome-muted);
  background: var(--rfd-bg, #fff);
}
#infoline button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}
#infoline button:hover { background: var(--chrome-bg); }
#infoline .rf-il-tab.active { color: var(--chrome-fg); font-weight: 600; }
#infoline .rf-il-tab.dirty::after { content: " •"; color: var(--accent); }
#infoline .rf-il-spacer { flex: 1; }
```

Remove the old `#app { display: grid; … }` and the old `#workspace` rule. Keep every other rule.

In `src/renderer/theme.css`, add:

```css
/* Present: larger text in a calm, centred column; no gutters */
.rf-present .cm-content {
  max-width: 70ch;
  padding-top: 3em;
}
.rf-present .cm-gutters {
  display: none;
}
```

In `src/renderer/main.ts`, pass `infoline: byId('infoline')` in the `App` root.

- [ ] **Step 2: Shared labels**

In `src/renderer/ui/statusline.ts`, export the existing label map as `export const SAVE_STATE_LABEL` (rename `LABEL` and update its uses). No behaviour change.

- [ ] **Step 3: App changes (`src/renderer/app.ts`)**

- **Imports:**

```ts
import { modeCompartment, modeExtensions } from './editor/mode'
import { moveOutOfHeader } from './editor/header'
import { InfoLine } from './ui/infoline'
import { SAVE_STATE_LABEL } from './ui/statusline'
```

- **`AppRoot`:** add `infoline: HTMLElement`.
- **Fields:** `private readonly infoLine: InfoLine`.
- **Constructor**, after `this.notices = …`:

```ts
    this.infoLine = new InfoLine(root.infoline, {
      selectTab: (i) => this.activate(i),
      exitPresent: () => void this.exitPresent(),
      zoomIn: () => this.setZoom(zoomIn(this.zoom[this.mode])),
      zoomOut: () => this.setZoom(zoomOut(this.zoom[this.mode])),
    })
    this.rfw.onFullScreenLeft(() => {
      if (this.mode === 'present') void this.exitPresent(false)
    })
```

- **Effective view helper** (Present always shows Preview):

```ts
  private effectiveView(): View {
    return this.mode === 'present' ? 'preview' : this.view
  }
```

- Every `createState(...)` call passes the effective view and the mode:
  - `newNote`: `createState('', '\n', this.effectiveView(), false, this.mode)`
  - `openPath`: `createState(res.text, res.eol, this.effectiveView(), hideHeader, this.mode)`
  - `reload`: `createState(note.text, note.eol, this.effectiveView(), tab.headerHidden, this.mode)`
- **Reconfigure all tabs:** replace the body of `setView` with a shared helper:

```ts
  private setView(view: View): void {
    if (view === this.view) return
    this.view = view
    this.reconfigureAll()
    this.syncMain()
    this.editor.focus()
  }

  /** Applies view + mode to every tab; a cursor that would end inside a collapsed header moves out. */
  private reconfigureAll(): void {
    const effects = [
      viewCompartment.reconfigure(viewExtensions(this.effectiveView())),
      modeCompartment.reconfigure(modeExtensions(this.mode)),
    ]
    const collapses = (state: EditorState) =>
      this.mode === 'present' || (this.effectiveView() === 'preview' && state.field(headerHidden))
    for (const tab of this.store.all) {
      const shown = tab.id === this.shownId
      const state = shown ? this.editor.state : tab.state
      const spec: TransactionSpec = { ...(collapses(state) ? moveOutOfHeader(state) : {}), effects }
      if (shown) this.editor.dispatch(spec)
      else this.store.updateState(tab.id, state.update(spec).state)
    }
  }
```

  (Import `type EditorState` from `@codemirror/state`.)

- **Enter and leave:**

```ts
  private async enterPresent(): Promise<void> {
    if (this.mode === 'present' || this.shownId === null) return
    this.mode = 'present'
    this.reconfigureAll()
    document.body.classList.add('rf-mode-present')
    this.root.tabbar.hidden = true
    this.root.status.hidden = true
    this.root.infoline.hidden = false
    this.infoLine.start()
    this.applyZoom()
    this.refresh()
    this.editor.focus()
    await this.rfw.setFullScreen(true)
  }

  /** fullScreen=false when the OS already left fullscreen (avoid a second toggle). */
  private async exitPresent(fullScreen = true): Promise<void> {
    if (this.mode !== 'present') return
    this.mode = 'edit'
    this.reconfigureAll()
    document.body.classList.remove('rf-mode-present')
    this.root.tabbar.hidden = false
    this.root.status.hidden = false
    this.root.infoline.hidden = true
    this.infoLine.stop()
    this.applyZoom()
    this.refresh()
    this.editor.focus()
    if (fullScreen) await this.rfw.setFullScreen(false)
  }
```

- **`command()` cases:**

```ts
      case 'toggle-present':
        return this.mode === 'present' ? this.exitPresent() : this.enterPresent()
```

  and, as the very first statement of `command()` (before the `switch`), this guard:

```ts
    if (this.mode === 'present' && (cmd === 'export' || cmd === 'toggle-view' || cmd === 'toggle-header')) {
      this.notices.toast('Im Präsentationsmodus nicht verfügbar – Esc beendet ihn.')
      return
    }
```

- **`globalKeys()`**, first lines:

```ts
    if (
      this.mode === 'present' &&
      e.key === 'Escape' &&
      !e.defaultPrevented &&
      !document.querySelector('dialog[open]')
    ) {
      e.preventDefault()
      void this.exitPresent()
      return
    }
```

- **`refresh()`:** at its end, when in Present, also render the info line:

```ts
    if (this.mode === 'present') {
      this.infoLine.render(
        this.store.all.map((t) => ({ name: fileName(t.path), dirty: this.store.isDirty(t) })),
        this.store.activeIndex,
        state === 'error' && error ? `${SAVE_STATE_LABEL.error}: ${error}` : SAVE_STATE_LABEL[state],
        this.zoom.present,
      )
    }
```

  `setZoom` must call `this.refresh()` too, so the info line's percentage updates. Add the call after `applyZoom()`.

- [ ] **Step 4: Gate and manual smoke**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`
Expected: green. The plan 1 and 2 suites stay green.

If you can observe the GUI (`npm run dev`), check the following and report what you saw:
- Mod+Shift+P goes fullscreen with the title block and only the info line.
- Typing works.
- Esc returns to Edit.

```bash
git add src/renderer/app.ts src/renderer/main.ts src/renderer/index.html src/renderer/styles.css src/renderer/theme.css src/renderer/ui/statusline.ts
git commit -m "feat(app): present mode with fullscreen, info line and per-mode zoom"
```

---

### Task 7: End-to-end tests, screenshots and docs

**Files:**
- Create: `tests/e2e/present.spec.ts`
- Modify: `README.md`, `README.en.md`, `CHANGELOG.md`, local `CLAUDE.md` (not committed)

**Interfaces:**
- Consumes:
  - E2E helpers `launch`, `makeDirs`, `clickMenu`, `waitForFile`, `shot`, `MOD`
  - The fixture `tests/fixtures/preview.md` (title block fields present)

- [ ] **Step 1: Write the E2E suite**

`tests/e2e/present.spec.ts`:

```ts
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type ElectronApplication, test } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')
const linux = process.platform === 'linux'

async function openFixture() {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.rf-preview').waitFor()
  return { ...launched, note }
}

const fullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)

const bodySize = (page: import('@playwright/test').Page) =>
  page.locator('.cm-scroller').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))

test('Present: fullscreen, title block, info line only; Esc returns', async () => {
  const { app, page } = await openFixture()
  const editSize = await bodySize(page)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await expect(page.locator('#tabbar')).toBeHidden()
  await expect(page.locator('#status')).toBeHidden()
  await expect(page.getByTestId('il-clock')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(page.locator('.cm-editor.rf-present .rf-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  await expect(page.locator('.cm-line.rf-frontmatter')).toHaveCount(0)
  expect(await bodySize(page)).toBeGreaterThan(editSize * 1.5)
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(true)
  await shot(page, 'present')
  await page.locator('.cm-line', { hasText: 'Ein Absatz mit' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)
  await expect(page.locator('#tabbar')).toBeVisible()
  await expect(page.locator('#infoline')).toBeHidden()
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  await app.close()
})

test('typing in Present is saved; the header stays untouched', async () => {
  const { app, page, note } = await openFixture()
  const original = await readFile(note, 'utf8')
  await clickMenu(app, 'toggle-present')
  await page.locator('.cm-line', { hasText: 'Text unter drei Rauten' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Neu im Termin.')
  const saved = await waitForFile(note, (b) => b.toString('utf8').includes('Neu im Termin.'))
  expect(saved.toString('utf8').startsWith(original.slice(0, original.indexOf('\n---\n') + 5))).toBe(true)
  await app.close()
})

test('Present from Code view shows Preview and returns to Code', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('.cm-editor.rf-code')).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.rf-preview.rf-present')).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.rf-code')).toBeVisible()
  await app.close()
})

test('info line: tabs switch, zoom changes and is restored after restart', async () => {
  const dirs = await makeDirs()
  const a = join(dirs.notes, 'Kickoff.md')
  const b = join(dirs.notes, 'Zweite.md')
  await copyFile(FIXTURE, a)
  await writeFile(b, '# Zweite Notiz\n\nInhalt.\n')
  const first = await launch({ dirs, args: [a, b] })
  await clickMenu(first.app, 'toggle-present')
  await expect(first.page.getByTestId('il-tab')).toHaveCount(2)
  await first.page.getByTestId('il-tab').first().click()
  await expect(first.page.locator('.rf-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  const before = await bodySize(first.page)
  await first.page.getByTestId('il-zoom-in').click()
  await expect(first.page.getByTestId('il-zoom')).toHaveText('110 %')
  expect(await bodySize(first.page)).toBeGreaterThan(before)
  await first.page.waitForTimeout(800)
  await first.app.close()
  const second = await launch({ dirs })
  await expect(second.page.locator('body.rf-mode-present')).toHaveCount(0)
  await clickMenu(second.app, 'toggle-present')
  await expect(second.page.getByTestId('il-zoom')).toHaveText('110 %')
  await second.app.close()
})

test('zoom in Edit scales the text; reset returns to 100 %', async () => {
  const { app, page } = await openFixture()
  const base = await bodySize(page)
  await clickMenu(app, 'zoom-in')
  await expect.poll(() => bodySize(page)).toBeGreaterThan(base)
  await clickMenu(app, 'zoom-reset')
  await expect.poll(() => bodySize(page)).toBe(base)
  await app.close()
})

test('export, view switch and header toggle are refused in Present', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  for (const cmd of ['export', 'toggle-view', 'toggle-header']) {
    await clickMenu(app, cmd)
    await expect(page.locator('.toast').last()).toContainText('Im Präsentationsmodus nicht verfügbar')
  }
  await expect(page.locator('.cm-editor.rf-preview.rf-present')).toBeVisible()
  await expect(page.locator('.panel')).toHaveCount(0)
  await app.close()
})

test('Esc does not leave Present while the rename dialog is open', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await clickMenu(app, 'rename')
  await expect(page.locator('dialog.prompt')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.prompt')).toHaveCount(0)
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await app.close()
})

test('an OS fullscreen exit leaves Present cleanly', async () => {
  test.skip(linux, 'no window manager fullscreen under xvfb')
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await expect.poll(() => fullScreen(app)).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(false))
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)
  await expect(page.locator('#tabbar')).toBeVisible()
  await app.close()
})
```

Run: `npm run test:e2e`
Expected: all pass. Fix code, not tests, unless a test is provably wrong; record why.

- [ ] **Step 2: Docs (exact README parity)**

Add rows to both shortcut tables, German in `README.md` and English in `README.en.md`:

| Kürzel | Aktion |
|--------|--------|
| Mod+Shift+P, Esc | Präsentieren ein/aus (Vollbild, nur Text und Infozeile) |
| Mod+Plus / Mod+- / Mod+0 | Vergrößern / Verkleinern / Originalgröße (je Modus gespeichert) |

In „Status“/"Status", move the Present mode to *available*. In Usage, add one sentence to both files: body text is set justified without hyphenation like rf-document's PDF, and Typst hyphenates on export.

`CHANGELOG.md` under `[Unreleased]` → `Added`:
- "Present mode: fullscreen, larger text, title block, info line with clock, tabs, zoom and save state; Esc returns to Edit"
- "Zoom per mode (Edit/Present), restored after restart"

Under `Changed`:
- "Body text is justified without hyphenation on every platform (hyphenation only in the PDF)"

Local `CLAUDE.md`, not committed:
- Status: plan 3.
- Architecture notes: `presentMode` facet / `modeCompartment`, `reconfigureAll`, zoom via `--rf-body-size` / `--rf-code-size`, fullscreen IPC + `leave-full-screen`.

- [ ] **Step 3: Final gate and commit**

Run: `diff <(grep -c '^## ' README.md) <(grep -c '^## ' README.en.md) && npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e`
Expected: green, coverage ≥ 80 %.

```bash
git add tests/e2e/present.spec.ts README.md README.en.md CHANGELOG.md
git commit -m "test(e2e): cover present mode, info line, zoom and refusals"
```

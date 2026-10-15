# rf-write Plan 5 – Outline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an outline sidebar on the right, built from the note's H1/H2 headings, shown in Edit (Code and Preview) and Present with a separate on/off per mode. A `>` chevron folds the section in the text and collapses the entry's children in the outline, always in sync with the editor's folds. Clicking an entry jumps to the heading.

**Architecture:**
- **Single source of truth = the editor's folds.** The outline never keeps its own collapse state: an entry is "collapsed" exactly when its section's fold range is folded in the shown tab's `EditorState`. Fold/unfold from the menu, the keyboard, fold-all or the chevron all change CodeMirror folds; the outline re-renders from them.
- **Pure model** `outlineEntries(state)` (renderer/editor/outline.ts) reads the Lezer tree: H1/H2 (ATX and Setext), skipping the front matter. Each entry carries its line, text, fold range and folded flag.
- **View component** `Outline` (renderer/ui/outline.ts) renders entries into `#outline`, updates in place (textContent only), and reports clicks through handlers; it never touches CodeMirror itself.
- **App** owns visibility per mode (persisted in the session), refreshes the outline after transactions (once per animation frame), and implements the handlers (jump, toggle fold).

**Tech Stack:** Electron 44, CodeMirror 6 (`@codemirror/language` folding), TypeScript strict, Vitest + happy-dom, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md` — Task 1 adds §4 "Outline", the session field in §7 and the shortcut in §10 (design approved by the user 2026-10-15).

**Builds on:** `dev` after plan 4 (PR #4). Relevant existing code:
- `src/renderer/editor/sections.ts`: `sectionFoldRanges(state)` (fold range per heading via `foldable`), `foldAllSections(view)`, `unfoldOnCursor`.
- `src/renderer/app.ts`: `App` — `dispatchTransactions` routes to the shown tab (`shownId`) and calls `refresh()` on doc changes; `mode` (`'edit' | 'present'`), `enterPresent()/exitPresent()`, `show()` on tab switch, `persistSession()`/`saveSession(patch)`, menu command switch, `editor` (`EditorView`).
- `src/main/menu.ts`: "Ansicht" menu with `item(id, label, accelerator)`; `src/shared/types.ts`: `MenuCommand`, `Session`, `SessionPatch`; `src/main/store.ts`: `DEFAULT_SESSION`, `sanitizeSession`.
- `src/renderer/index.html`: `#app` → `#tabbar`, `main#workspace` (`#editor`, `#empty`), `#status`, `#infoline`. `src/renderer/styles.css` holds chrome tokens and the flat button styles.
- Fold commands: `foldEffect`, `unfoldEffect`, `foldedRanges` from `@codemirror/language`.

## Global Constraints

- **Branch:** `feature/outline` from `dev`. PR into `dev`; merge only with green CI on macOS, Windows and Linux and the user's approval.
- **Byte-exact source:** the outline only reads; folding, jumping and toggling never change the document.
- **Headings:** H1 and H2 only (`#`, `##`, Setext `===` / `---`). H3+ never appear. Nothing from the YAML front matter; headings inside fenced code are not headings (Lezer already handles this).
- **Text:** entry text = the heading line without the ATX marks (`#`, optional closing `#`s) and surrounding whitespace; inline Markdown marks (`*`, `_`, backticks) are kept as typed — no rendering, `textContent` only. Empty heading → „(ohne Titel)“.
- **Sync:** collapsed ⇔ folded in the editor. No separate outline state, nothing persisted about folds (spec §5: folds are not persisted).
- **Width:** never wrap an entry. Width fits the longest entry: `width: max-content`, `min-width: 14em`, `max-width: 33vw`; beyond the max one line with ellipsis and the full text as `title` tooltip.
- **Present:** the outline uses the chrome font size (does not scale with text zoom) and shows nothing but the entries.
- **UI strings German**, code/commits/docs English, Conventional Commits, no AI attribution, author `jcmx9`. README de/en content-identical. Local `CLAUDE.md` never committed.
- **Checks before each commit:** `npm run lint && npm run typecheck && npm test`.

## Review Focus

1. **Fold sync drift:** fold via menu/keyboard, fold-all, unfold-all, undo, tab switch, typing a new heading → the chevrons and hidden children always match the editor; no stale entries after a tab switch.
2. **Folding a section that contains the cursor** via the chevron: the cursor must not stay hidden inside the fold — it moves to the end of the heading line (same as CodeMirror's `foldCode`).
3. **Long headings / many headings:** no line wrap, ellipsis + tooltip, the sidebar scrolls on its own, the active entry is scrolled into view.
4. **Focus:** clicking an entry or chevron never leaves focus in the sidebar (typing continues in the text); keyboard users can still reach it? (buttons with `tabIndex = -1`, same as the info line — the sidebar is a mouse aid; documented).
5. **Present with the outline off/on:** per-mode visibility survives restart; the app still always starts in Edit.

---

### Task 1: Spec update and the outline model

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md` (§4 new subsection "Outline", §7 session field `outline`, §10 shortcut row)
- Create: `src/renderer/editor/outline.ts`, `tests/unit/renderer/outline-model.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OutlineEntry {
    level: 1 | 2
    text: string
    /** Start and end of the heading line. */
    from: number
    to: number
    /** Section fold range (after the heading line), null when the section is empty. */
    fold: { from: number; to: number } | null
    folded: boolean
    /** H2 entries under an H1 (empty for H2 entries; H2 before the first H1 are top-level). */
    children: OutlineEntry[]
  }
  export function outlineEntries(state: EditorState): OutlineEntry[]
  export function activeEntry(entries: OutlineEntry[], pos: number): OutlineEntry | null
  ```

- [ ] **Step 0: Branch, spec text.** `git checkout dev && git pull && git checkout -b feature/outline`. Add to the spec §4 after "Zoom":

  > ### Outline
  > - A sidebar on the right lists the note's H1 and H2 headings (H2 indented under its H1). It is available in Code, Preview and Present and is toggled with „Gliederung ein/aus“ (View menu, Mod+Shift+O). The on/off state is kept **per mode** (Edit, Present) in the session.
  > - Each entry with a non-empty section has a `>` chevron. It folds or unfolds that section in the text; an H1's H2 entries are hidden while the H1 is folded. Outline and editor folds are always in sync: folding from the menu, the keyboard or „Alle ein-/ausklappen“ updates the outline, and the chevron folds the text.
  > - Clicking an entry scrolls to the heading and puts the cursor at its end; a folded section stays folded; focus returns to the text.
  > - The entry of the section containing the cursor is highlighted.
  > - Entries never wrap: the sidebar fits the longest entry (at least about 14 characters, at most a third of the window); longer entries end in „…“ with the full text as a tooltip.
  > - The sidebar uses the chrome font and does not scale with the text zoom.

  §7 session list: add "outline visibility per mode". §10 View rows: "Gliederung ein/aus | Mod+Shift+O".

- [ ] **Step 1: Failing tests** `tests/unit/renderer/outline-model.test.ts` (build states with `createState(text, '\n', 'preview')` from `setup.ts`, and fold with `foldEffect`):

  ```ts
  import { foldEffect } from '@codemirror/language'
  import { describe, expect, it } from 'vitest'
  import { activeEntry, outlineEntries } from '../../../src/renderer/editor/outline'
  import { createState } from '../../../src/renderer/editor/setup'

  const st = (text: string) => createState(text, '\n', 'preview')
  const flat = (text: string) =>
    outlineEntries(st(text)).map((e) => [e.level, e.text, e.children.map((c) => c.text)])

  describe('outlineEntries', () => {
    it('lists H1 with nested H2, ignores H3', () => {
      expect(flat('# A\n## a1\n### x\n## a2\n# B\ntext\n')).toEqual([
        [1, 'A', ['a1', 'a2']],
        [1, 'B', []],
      ])
    })
    it('Setext headings count; closing hashes and spaces are stripped', () => {
      expect(flat('Titel\n=====\n\nSub\n---\n\n#  C  ##\n')).toEqual([
        [1, 'Titel', ['Sub']],
        [1, 'C', []],
      ])
    })
    it('skips the YAML front matter and fenced code', () => {
      expect(flat('---\ntitle: x\n---\n\n```\n# not\n```\n# Real\n')).toEqual([[1, 'Real', []]])
    })
    it('H2 before the first H1 is top-level', () => {
      expect(flat('## Vorab\n# A\n')).toEqual([
        [2, 'Vorab', []],
        [1, 'A', []],
      ])
    })
    it('empty heading text', () => {
      expect(flat('#\n')).toEqual([[1, '(ohne Titel)', []]])
    })
    it('fold range null for an empty section; folded flag follows the editor', () => {
      let state = st('# A\ntext\n# B\n')
      const [a, b] = outlineEntries(state)
      expect(a?.fold).not.toBeNull()
      expect(b?.fold).toBeNull()
      state = state.update({ effects: foldEffect.of(a?.fold as { from: number; to: number }) }).state
      expect(outlineEntries(state)[0]?.folded).toBe(true)
    })
  })

  describe('activeEntry', () => {
    it('is the last entry starting at or before pos, children included', () => {
      const entries = outlineEntries(st('# A\nx\n## a1\ny\n# B\n'))
      expect(activeEntry(entries, 0)?.text).toBe('A')
      expect(activeEntry(entries, 12)?.text).toBe('a1')
      expect(activeEntry(entries, 100)?.text).toBe('B')
    })
    it('null before the first heading', () => {
      expect(activeEntry(outlineEntries(st('intro\n# A\n')), 0)).toBeNull()
    })
  })
  ```

  Verify the exact node names (`ATXHeading1`, `SetextHeading2`, `Frontmatter`, `FencedCode`) with `syntaxTree(state).toString()` before relying on them; `sectionFoldRanges` already uses the same names.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** `src/renderer/editor/outline.ts`:

  ```ts
  import { ensureSyntaxTree, foldable, foldedRanges, syntaxTree } from '@codemirror/language'
  import type { EditorState } from '@codemirror/state'

  export interface OutlineEntry { /* as in Interfaces */ }

  const HEADING = /^(ATX|Setext)Heading([12])$/

  function headingText(state: EditorState, from: number, to: number, setext: boolean): string {
    const line = state.doc.lineAt(from)
    let text = line.text
    if (!setext) text = text.replace(/^\s{0,3}#{1,6}/, '').replace(/\s+#+\s*$/, '')
    text = text.trim()
    return text || '(ohne Titel)'
  }

  export function outlineEntries(state: EditorState): OutlineEntry[] {
    const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state)
    const folded = foldedRanges(state)
    const out: OutlineEntry[] = []
    let parent: OutlineEntry | null = null
    tree.iterate({
      enter: (node) => {
        if (node.name === 'Frontmatter') return false
        const m = HEADING.exec(node.name)
        if (!m) return undefined
        const line = state.doc.lineAt(node.from)
        const fold = foldable(state, line.from, line.to)
        let isFolded = false
        if (fold) folded.between(fold.from, fold.to, (f, t) => { if (f === fold.from && t === fold.to) isFolded = true })
        const entry: OutlineEntry = {
          level: m[2] === '1' ? 1 : 2,
          text: headingText(state, node.from, node.to, m[1] === 'Setext'),
          from: line.from,
          to: line.to,
          fold,
          folded: isFolded,
          children: [],
        }
        if (entry.level === 1) { out.push(entry); parent = entry }
        else if (parent) parent.children.push(entry)
        else out.push(entry)
        return false
      },
    })
    return out
  }

  export function activeEntry(entries: OutlineEntry[], pos: number): OutlineEntry | null {
    let found: OutlineEntry | null = null
    for (const e of entries) {
      if (e.from > pos) break
      found = e
      for (const c of e.children) { if (c.from > pos) break; found = c }
    }
    return found
  }
  ```

  For a Setext heading the node spans two lines; `lineAt(node.from)` is the text line, and `foldable` on that line gives the section (check with a test; if `foldable` needs the underline line, use `state.doc.lineAt(node.to)` for the fold query and record why).

- [ ] **Step 4: PASS, gate green. Commit:** `git add docs/superpowers/specs/2026-10-14-rf-write-mvp-design.md src/renderer/editor/outline.ts tests/unit/renderer/outline-model.test.ts` → `feat(outline): spec and the H1/H2 outline model`

---

### Task 2: Outline sidebar component

**Files:**
- Create: `src/renderer/ui/outline.ts`, `tests/unit/renderer/outline-view.test.ts`
- Modify: `src/renderer/index.html` (`<nav id="outline" aria-label="Gliederung" hidden></nav>` inside `#workspace` after `#editor`), `src/renderer/styles.css`

**Interfaces:**
- Consumes: `OutlineEntry` (Task 1).
- Produces:
  ```ts
  export interface OutlineHandlers {
    jump(entry: OutlineEntry): void
    toggle(entry: OutlineEntry): void
  }
  export class Outline {
    constructor(el: HTMLElement, handlers: OutlineHandlers)
    render(entries: OutlineEntry[], active: OutlineEntry | null): void
    setVisible(on: boolean): void
  }
  ```

Rendering rules:
- One `<ul>`; each entry is `<li class="rf-ol-item rf-ol-h1|rf-ol-h2">` containing a chevron `<button class="rf-ol-chevron" aria-expanded>` (or an empty spacer of the same width when `fold === null`) and a label `<button class="rf-ol-label" title="<full text>">`. Children `<ul>` of an H1 are omitted while the H1 is folded.
- Chevron: `>` rotated 90° when expanded (CSS transform), `aria-label` „Abschnitt einklappen“ / „Abschnitt ausklappen“.
- All buttons `tabIndex = -1`; `mousedown` on the primary button calls `preventDefault()` (focus stays in the text, same contract as the info line); `click` (primary only) calls the handler.
- Update in place: keep a map keyed by `level:from:text`; reuse existing `<li>` nodes so a click during a refresh is never lost (same requirement as the info line after plan 3). A full rebuild is acceptable only when the entry list's keys changed.
- Active entry gets `.active` (accent colour, no fill) and is scrolled into view within the sidebar (`scrollIntoView({ block: 'nearest' })`) only when it changed.
- No headings: a muted `<p class="rf-ol-empty">Keine Überschriften</p>`.

CSS (styles.css, existing tokens; chrome font size):
```css
#workspace { display: flex; min-height: 0; }
#editor { flex: 1; min-width: 0; }
#outline {
  width: max-content;
  min-width: 14em;
  max-width: 33vw;
  overflow-y: auto;
  overflow-x: hidden;
  border-left: 1px solid var(--chrome-border);
  padding: 8px 4px;
  font: var(--chrome-font);
}
#outline[hidden] { display: none; }
#outline .rf-ol-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
#outline .rf-ol-h2 { padding-left: 1.2em; }
```
Use the real token names from styles.css (check them); if `#workspace` already has a display rule, integrate instead of overriding. The empty state `#empty` must still centre in the editor area.

- [ ] **Step 1: Failing tests** (happy-dom) `tests/unit/renderer/outline-view.test.ts`: renders H1/H2 structure; folded H1 hides its children; chevron click calls `toggle` with the entry, label click calls `jump`; mousedown is `defaultPrevented` for the primary button only; `title` carries the full text; re-render with the same keys reuses the `<li>` nodes (identity check) and a mousedown-refresh-click sequence still calls `jump`; `.active` moves; empty list shows „Keine Überschriften“; `setVisible(false)` sets `hidden`.
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS, gate green.**
- [ ] **Step 5: Commit** — `feat(outline): sidebar component with chevrons and in-place updates`

---

### Task 3: Wire the outline into the app (visibility per mode, sync, jump, fold)

**Files:**
- Modify: `src/shared/types.ts` (`MenuCommand` + `'toggle-outline'`; `Session.outline: { edit: boolean; present: boolean }`; `SessionPatch` includes `'outline'`), `src/main/store.ts` (`DEFAULT_SESSION.outline = { edit: false, present: false }`, sanitize to booleans), `src/main/menu.ts` (View: `item('toggle-outline', 'Gliederung ein/aus', 'CmdOrCtrl+Shift+O')` after toggle-header), `src/renderer/app.ts`
- Test: `tests/unit/main/store.test.ts`, `tests/unit/main/menu.test.ts`, `tests/unit/renderer/outline-app.test.ts` (if `App` is not unit-testable, put the fold/jump logic in a small pure module `src/renderer/editor/outline-actions.ts` and test that)

**Interfaces:**
- Produces (`outline-actions.ts`):
  ```ts
  /** Folds or unfolds the entry's section; a cursor inside the folded range moves to the heading end. */
  export function toggleEntryFold(view: EditorView, entry: OutlineEntry): void
  /** Cursor to the end of the heading line, scrolled to the top area, focus to the editor. */
  export function jumpToEntry(view: EditorView, entry: OutlineEntry): void
  ```

Behaviour:
- `App` creates `new Outline(root.outline, { jump: (e) => jumpToEntry(this.editor, e), toggle: (e) => toggleEntryFold(this.editor, e) })`.
- Refresh: schedule `outline.render(outlineEntries(state), activeEntry(...))` at most once per animation frame after any transaction of the shown tab (doc, selection, fold effects), after `show()` (tab switch), after mode/view switches, and when the outline becomes visible. Skip work while hidden.
- `toggle-outline` flips `outline[this.mode]`, persists via `saveSession({ outline })`, and calls `setVisible`. Entering/leaving Present applies that mode's flag. The app still starts in Edit.
- Present: not refused (the outline is allowed in Present).
- `toggleEntryFold`: if `entry.folded` → `unfoldEffect.of(entry.fold)`; else `foldEffect.of(entry.fold)` plus, if the main selection head is strictly inside `entry.fold`, `selection: { anchor: entry.to }` in the same transaction. No-op when `fold === null`.
- `jumpToEntry`: `view.dispatch({ selection: { anchor: entry.to }, effects: EditorView.scrollIntoView(entry.from, { y: 'start', yMargin: 24 }) })`, then `view.focus()`. The heading line is outside its own fold, so a folded section stays folded.
- Fold-all / unfold-all / fold / unfold from the menu need no outline code: the outline re-renders from the editor folds.

- [ ] **Step 1: Failing tests:** store sanitizes `outline` (missing → both false; non-boolean → false); menu has `toggle-outline` with `CmdOrCtrl+Shift+O` in Ansicht; `toggleEntryFold` folds/unfolds and moves an inside cursor to the heading end; `jumpToEntry` sets the cursor and leaves the fold intact; after `foldAllSections` every entry with a fold is `folded` (sync via the model).
- [ ] **Step 2: FAIL. Step 3: Implement. Step 4: PASS, gate green.**
- [ ] **Step 5: Commit** — `feat(outline): toggle per mode, jump and fold in sync with the editor`

---

### Task 4: End-to-end tests and docs

**Files:**
- Create: `tests/e2e/outline.spec.ts`
- Modify: `README.md`, `README.en.md`, `CHANGELOG.md`, local `CLAUDE.md` (not committed)

- [ ] **Step 1: E2E** (`launch`, `clickMenu`, fixture text written into `dirs.notes`):
  - Menu `toggle-outline` shows `#outline` with the H1/H2 entries of the note; again hides it.
  - Per mode: outline on in Edit, `toggle-present` → hidden in Present; turn it on in Present; leave Present → still on in Edit; restart (`launch({ dirs })`) → Edit on; Present on after `toggle-present`.
  - Chevron of an H1 → `.cm-foldPlaceholder` appears in the editor and the H1's H2 entries disappear from the outline; menu `unfold-all` → children back, placeholder gone.
  - Menu `fold-all` → every chevron shows the collapsed state.
  - Click an entry → the cursor line (`.cm-activeLine` or selection position via `page.evaluate`) is the heading; typing goes into the text (focus check).
  - Long heading (200 chars): the entry's `offsetHeight` equals a one-line entry's height and its `title` is the full text; the sidebar width ≤ 33 % of the window.
  - Screenshot `outline` via `shot(page, 'outline')` (Edit) and `outline-present`.
- [ ] **Step 2: Docs.** README de/en (parity): shortcut row „Mod+Shift+O | Gliederung ein/aus (je Modus gemerkt)“, a short "Gliederung"/"Outline" paragraph (H1/H2, chevron folds text and outline in sync, click jumps, per-mode toggle). CHANGELOG `Added`: "Outline sidebar with H1/H2, folding in sync with the editor, per-mode visibility". Local CLAUDE.md: status + architecture note (folds are the single source of truth; outline model/view/actions split).
- [ ] **Step 3: Final gate and commit:** `diff <(grep -c '^## ' README.md) <(grep -c '^## ' README.en.md) && npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e` → `test(e2e): cover the outline; document it`

import { foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language'
import type { EditorState, Transaction, TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { activeEntry, type OutlineEntry, outlineEntries } from './outline'

/** Folds or unfolds the entry's section; a cursor inside the folded range moves to the heading end. */
export function toggleEntryFold(view: EditorView, entry: OutlineEntry): void {
  const { fold } = entry
  // A stale entry (rendered before the latest edit) must not fold an arbitrary range.
  if (fold === null || fold.to > view.state.doc.length) return
  if (entry.folded) {
    view.dispatch({ effects: unfoldEffect.of(fold) })
    return
  }
  const spec: TransactionSpec = { effects: foldEffect.of(fold) }
  const head = view.state.selection.main.head
  if (head > fold.from && head < fold.to) spec.selection = { anchor: entry.to }
  view.dispatch(spec)
}

/** Cursor to the end of the heading line, scrolled to the top area, focus to the editor. */
export function jumpToEntry(view: EditorView, entry: OutlineEntry): void {
  if (entry.to > view.state.doc.length) return
  view.dispatch({
    selection: { anchor: entry.to },
    effects: EditorView.scrollIntoView(entry.from, { y: 'start', yMargin: 24 }),
  })
  view.focus()
}

/** True when the transaction changed the folded ranges (effects or folds cleared by the selection). */
export function foldsChanged(tr: Transaction): boolean {
  return (
    tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)) ||
    foldedRanges(tr.startState) !== foldedRanges(tr.state)
  )
}

export interface OutlineTarget {
  render(entries: OutlineEntry[], active: OutlineEntry | null): void
  setVisible(on: boolean): void
}

export interface FrameScheduler {
  request(cb: () => void): number
  cancel(id: number): void
}

const animationFrames: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
}

/**
 * Keeps the outline in step with the shown editor state. Entries are recomputed only after a
 * doc or fold change, a tab switch or when the outline becomes visible; otherwise only the
 * active entry moves. At most one render per animation frame, nothing while hidden.
 */
export class OutlineSync {
  private visible = false
  private entries: OutlineEntry[] | null = null
  private frame: number | null = null

  constructor(
    private readonly target: OutlineTarget,
    private readonly state: () => EditorState | null,
    private readonly frames: FrameScheduler = animationFrames,
    private readonly compute: (state: EditorState) => OutlineEntry[] = outlineEntries,
  ) {}

  setVisible(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    this.target.setVisible(on)
    this.entries = null
    if (on) this.schedule()
    else this.cancel()
  }

  /** After transactions of the shown tab. */
  update(trs: readonly Transaction[]): void {
    if (!this.visible) return
    if (trs.some((tr) => tr.docChanged || foldsChanged(tr))) this.entries = null
    this.schedule()
  }

  /** The shown state was replaced (tab switch, reload). */
  invalidate(): void {
    this.entries = null
    if (this.visible) this.schedule()
  }

  /** Re-render with cached entries (mode or view switch). */
  refresh(): void {
    if (this.visible) this.schedule()
  }

  private schedule(): void {
    if (this.frame !== null) return
    this.frame = this.frames.request(() => this.flush())
  }

  private cancel(): void {
    if (this.frame !== null) this.frames.cancel(this.frame)
    this.frame = null
  }

  private flush(): void {
    this.frame = null
    const state = this.state()
    if (!this.visible || !state) return
    this.entries ??= this.compute(state)
    this.target.render(this.entries, activeEntry(this.entries, state.selection.main.head))
  }
}

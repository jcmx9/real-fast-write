import {
  EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { frontmatterRange } from './frontmatter'
import { renderTitleBlock, type TitleBlock, titleBlockData } from './titleblock'

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
  override eq(other: TitleBlockWidget): boolean {
    return JSON.stringify(other.data) === JSON.stringify(this.data)
  }
  override toDOM(): HTMLElement {
    return renderTitleBlock(this.data)
  }
}

function build(state: EditorState): DecorationSet {
  if (!state.field(headerHidden, false)) return Decoration.none
  const range = frontmatterRange(state.doc)
  if (!range) return Decoration.none
  return Decoration.set([
    Decoration.replace({
      widget: new TitleBlockWidget(titleBlockData(state.doc)),
      block: true,
      rf: 'header-fold',
    }).range(range.from, range.to),
  ])
}

/** Preview-only: the collapsed header, atomic so the cursor cannot enter it. */
export const headerFold = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    const flipped = tr.startState.field(headerHidden, false) !== tr.state.field(headerHidden, false)
    return tr.docChanged || flipped ? build(tr.state) : deco
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
  ],
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

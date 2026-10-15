import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
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
export const handlers: Array<(cx: PreviewCx, ref: SyntaxNodeRef) => boolean | undefined> = [
  visitInline,
]

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
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = buildPreview(u.state, u.view.visibleRanges)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

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

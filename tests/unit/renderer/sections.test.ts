// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeFolding, ensureSyntaxTree, foldEffect, foldedRanges } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { headerFold, headerHidden } from '../../../src/renderer/editor/header'
import { sectionFoldRanges, unfoldOnCursor } from '../../../src/renderer/editor/sections'

function state(doc: string): EditorState {
  const s = EditorState.create({
    doc,
    extensions: markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
  })
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

describe('unfoldOnCursor', () => {
  const DOC = '# A\ntext\n# B\nmore'
  const make = (doc = DOC, extra: unknown[] = []) => {
    const s = EditorState.create({
      doc,
      extensions: [
        codeFolding(),
        unfoldOnCursor,
        markdown({ base: markdownLanguage, extensions: [Frontmatter] }),
        ...(extra as []),
      ],
    })
    ensureSyntaxTree(s, s.doc.length, 5000)
    return s
  }
  const foldAll = (s: EditorState) =>
    s.update({ effects: sectionFoldRanges(s).map((r) => foldEffect.of(r)) }).state
  const folds = (s: EditorState) => {
    const out: [number, number][] = []
    foldedRanges(s).between(0, s.doc.length, (f, t) => void out.push([f, t]))
    return out
  }

  it('unfolds a fold the cursor enters; other folds stay', () => {
    const s = foldAll(make())
    expect(folds(s)).toHaveLength(2)
    const s2 = s.update({ selection: { anchor: 6 } }).state
    expect(folds(s2)).toEqual([[DOC.indexOf('# B') + 3, DOC.length]])
  })
  it('does not unfold when the selection only touches the fold boundary', () => {
    const s = foldAll(make())
    const [from, to] = folds(s)[0] as [number, number]
    expect(foldedRanges(s.update({ selection: { anchor: from } }).state).size).toBe(2)
    expect(foldedRanges(s.update({ selection: { anchor: to } }).state).size).toBe(2)
  })
  it('unfolds when an inserted text moves the cursor into a fold', () => {
    const s = foldAll(make())
    const s2 = s.update({ changes: { from: 0, insert: 'x' }, selection: { anchor: 7 } }).state
    expect(folds(s2)).toHaveLength(1)
  })
  it('leaves the YAML header collapse alone', () => {
    const doc = '---\ntitle: x\n---\n\n# A\ntext'
    const s = make(doc, [headerHidden.init(() => true), headerFold])
    const folded = foldAll(s.update({ selection: { anchor: doc.length } }).state)
    expect(folded.field(headerFold).size).toBe(1)
    const end = doc.indexOf('\n\n') + 1
    const moved = folded.update({ selection: { anchor: 2 } }).state
    expect(moved.selection.main.head).toBeGreaterThanOrEqual(end)
    expect(moved.field(headerFold).size).toBe(1)
    expect(foldedRanges(moved).size).toBe(1)
  })
})

// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { sectionFoldRanges } from '../../../src/renderer/editor/sections'

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

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
    expect(rf('**fett**')).toEqual(
      expect.arrayContaining(['mark:rf-strong@0-8', 'hide@0-2', 'hide@6-8']),
    )
  })
  it('strong: reveals ** faint with the cursor inside', () => {
    const d = rf('**fett**', 3)
    expect(d).toEqual(
      expect.arrayContaining(['mark:rf-strong@0-8', 'mark:rf-mark@0-2', 'mark:rf-mark@6-8']),
    )
    expect(d.filter((x) => x.startsWith('hide'))).toEqual([])
  })
  it('emphasis, strike, inline code', () => {
    expect(rf('*kursiv*')).toEqual(
      expect.arrayContaining(['mark:rf-em@0-8', 'hide@0-1', 'hide@7-8']),
    )
    expect(rf('~~weg~~')).toEqual(
      expect.arrayContaining(['mark:rf-strike@0-7', 'hide@0-2', 'hide@5-7']),
    )
    expect(rf('`code`')).toEqual(
      expect.arrayContaining(['mark:rf-code-inline@0-6', 'hide@0-1', 'hide@5-6']),
    )
  })
  it('link: keeps the text, hides brackets and URL', () => {
    expect(rf('[Text](https://x.de)')).toEqual(
      expect.arrayContaining([
        'mark:rf-link@0-20',
        'hide@0-1',
        'hide@5-6',
        'hide@6-7',
        'hide@7-19',
        'hide@19-20',
      ]),
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
    expect(d).toEqual(
      expect.arrayContaining([
        'line:rf-frontmatter@0-0',
        'line:rf-frontmatter@4-4',
        'line:rf-frontmatter@13-13',
      ]),
    )
    expect(d.some((x) => x.startsWith('line:rf-h'))).toBe(false)
  })
})

describe('ranges', () => {
  it('only decorates the requested range', () => {
    const doc = '# Eins\n\n# Zwei'
    const state = EditorState.create({
      doc: `${doc}\n\nende`,
      selection: { anchor: doc.length + 6 },
      extensions: markdown({ base: markdownLanguage }),
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const out: number[] = []
    buildPreview(state, [{ from: 8, to: 14 }]).between(0, state.doc.length, (from) => {
      out.push(from)
    })
    expect(out.every((p) => p >= 8)).toBe(true)
  })
})

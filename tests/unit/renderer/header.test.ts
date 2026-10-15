// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { headerFold, headerHidden, headerToggleSpec } from '../../../src/renderer/editor/header'

const DOC = '---\ntitle: "Kickoff"\n---\n\n# Body'
const END = DOC.indexOf('\n\n') // end of the closing ---

function make(doc: string, hidden: boolean, cursor = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [headerHidden.init(() => hidden), headerFold],
  })
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

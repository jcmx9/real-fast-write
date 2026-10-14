// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  createState,
  serializeDoc,
  viewCompartment,
  viewExtensions,
} from '../../../src/renderer/editor/setup'

describe('createState / serializeDoc', () => {
  it.each([
    ['LF', 'a\nb\n', '\n'],
    ['CRLF', 'a\r\nb\r\n', '\r\n'],
    ['mixed', 'a\r\nb\nc\rd', 'mixed'],
    ['empty', '', '\n'],
  ] as const)('%s round-trips byte-exact', (_name, text, eol) => {
    expect(serializeDoc(createState(text, eol, 'code').doc, eol)).toBe(text)
  })

  it('a new line in a CRLF file is saved as CRLF', () => {
    const state = createState('a\r\nb', '\r\n', 'code')
    const next = state.update({ changes: { from: 1, insert: '\n' } }).state
    expect(serializeDoc(next.doc, '\r\n')).toBe('a\r\n\r\nb')
  })

  it('switching the view keeps the text identical', () => {
    const state = createState('# T\r\n\r\nx', '\r\n', 'code')
    const next = state.update({
      effects: viewCompartment.reconfigure(viewExtensions('preview')),
    }).state
    expect(serializeDoc(next.doc, '\r\n')).toBe('# T\r\n\r\nx')
  })
})

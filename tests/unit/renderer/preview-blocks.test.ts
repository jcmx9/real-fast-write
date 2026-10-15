// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { toggleTaskAt } from '../../../src/renderer/editor/preview'
import { rf } from './preview-helper'

describe('lists and tasks', () => {
  it('replaces the bullet by a square away from the cursor', () => {
    expect(rf('- Punkt')).toContain('bullet@0-1')
    const near = rf('- Punkt', 3)
    expect(near).toContain('mark:rf-mark@0-1')
    expect(near).not.toContain('bullet@0-1')
  })
  it('turns a task into a checkbox and hides its bullet', () => {
    expect(rf('- [ ] offen')).toEqual(expect.arrayContaining(['hide@0-2', 'task@2-5']))
    expect(rf('- [x] erledigt', 8)).toEqual(expect.arrayContaining(['hide@0-2', 'task@2-5']))
  })
  it('leaves ordered lists alone', () => {
    expect(rf('1. eins').some((d) => d.startsWith('bullet'))).toBe(false)
  })
})

describe('quotes and alerts', () => {
  it('quote: line class, hidden "> "', () => {
    expect(rf('> Zitat')).toEqual(expect.arrayContaining(['line:rf-quote@0-0', 'hide@0-2']))
  })
  it('alert: classes on every line, title widget for the marker line', () => {
    const d = rf('> [!WARNING]\n> Achtung Stufe')
    expect(d).toEqual(
      expect.arrayContaining([
        'line:rf-alert rf-alert-warning@0-0',
        'line:rf-alert rf-alert-warning@13-13',
        'alert-title@0-12',
        'hide@13-15',
      ]),
    )
    expect(d).not.toContain('line:rf-quote@0-0')
  })
  it('alert: marker line shown as text when the cursor is on it', () => {
    expect(rf('> [!NOTE]\n> x', 3)).not.toContain('alert-title@0-9')
  })
})

describe('tables, code, rules', () => {
  it('table rows while editing (cursor inside)', () => {
    const d = rf('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', 1)
    expect(d).toEqual(
      expect.arrayContaining([
        'line:rf-table-head@0-0',
        'line:rf-table-delim@10-10',
        'line:rf-table-row@20-20',
        'line:rf-table-row rf-table-stripe@30-30',
      ]),
    )
  })
  it('table away from the cursor is left to the widget', () => {
    expect(rf('| a | b |\n|---|---|\n| 1 | 2 |').some((d) => d.includes('rf-table'))).toBe(false)
  })
  it('fenced code', () => {
    expect(rf('```js\nlet a = 1\n```')).toEqual(
      expect.arrayContaining([
        'line:rf-codefence@0-0',
        'line:rf-codeblock@6-6',
        'line:rf-codefence@16-16',
      ]),
    )
  })
  it('horizontal rule', () => {
    expect(rf('Text\n\n***')).toEqual(expect.arrayContaining(['line:rf-hr@6-6', 'hide@6-9']))
  })
})

describe('toggleTaskAt', () => {
  const state = (doc: string) => EditorState.create({ doc })
  it('changes exactly one character, both ways', () => {
    const s = state('- [ ] a\n- [x] b')
    const on = s.update(toggleTaskAt(s, 2) ?? {}).state
    expect(on.doc.toString()).toBe('- [x] a\n- [x] b')
    const off = on.update(toggleTaskAt(on, 10) ?? {}).state
    expect(off.doc.toString()).toBe('- [x] a\n- [ ] b')
  })
  it('accepts [X] and refuses non-markers', () => {
    const s = state('- [X] a\nkein')
    expect(s.update(toggleTaskAt(s, 2) ?? {}).state.doc.toString()).toBe('- [ ] a\nkein')
    expect(toggleTaskAt(s, 8)).toBeNull()
  })
})

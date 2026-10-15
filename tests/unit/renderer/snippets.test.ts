// @vitest-environment happy-dom
import {
  acceptCompletion,
  CompletionContext,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { beforeEach, describe, expect, it } from 'vitest'
import { createState } from '../../../src/renderer/editor/setup'
import { snippetRegistry, snippetSource } from '../../../src/renderer/editor/snippets'

const ctx = (doc: string, explicit = false) => {
  const state = EditorState.create({ doc })
  return new CompletionContext(state, doc.length, explicit)
}
const labels = (doc: string, explicit = false) =>
  snippetSource(ctx(doc, explicit))?.options.map((o) => o.label) ?? null

beforeEach(() => snippetRegistry.setUser([]))

describe('snippetSource', () => {
  it.each([
    [':m', true],
    ['Text :me', true],
    ['- :auf', true],
    [':', false],
    ['Hinweis:', false],
    ['10:30', false],
    ['a:b', false],
    ['Uhrzeit: ', false],
  ])('%j offers snippets: %s', (doc, offered) => {
    expect(labels(doc) !== null).toBe(offered)
  })

  it('a bare colon offers all on explicit request (Ctrl+Space)', () => {
    expect(labels(':', true)).toEqual([
      ':aufgabe',
      ':header',
      ':meeting',
      ':newpage',
      ':telefonnotiz',
    ])
  })

  it.each([
    ['Super :D', null],
    [':P', null],
    [':me', [':meeting']],
    [':H', [':header']],
  ])('prefix filter %j -> %j', (doc, expected) => {
    expect(labels(doc)).toEqual(expected)
  })

  it('replaces from the colon', () => {
    expect(snippetSource(ctx('x :mee'))?.from).toBe(2)
  })

  it('matches combining marks like the name regex', () => {
    const name = 'cafe\u0301'
    snippetRegistry.setUser([{ name, body: 'x', source: 'user' }])
    expect(labels(`:${name}`)).toEqual([`:${name}`])
  })

  it('user snippets override built-ins and add new ones', () => {
    snippetRegistry.setUser([
      { name: 'meeting', body: 'mine', source: 'user' },
      { name: 'zz', body: 'z', source: 'user' },
    ])
    const list = snippetRegistry.list()
    expect(list.find((s) => s.name === 'meeting')?.body).toBe('mine')
    expect(list.map((s) => s.name)).toContain('zz')
  })
})

const tick = () => new Promise((r) => setTimeout(r, 0))
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) await tick()
}
// CodeMirror ignores accept keys for `interactionDelay` (75 ms) after the list opens.
async function open(view: EditorView): Promise<void> {
  await until(() => completionStatus(view.state) === 'active')
  expect(completionStatus(view.state)).toBe('active')
  await new Promise((r) => setTimeout(r, 90))
}
function mount(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ state: createState(doc, '\n', 'preview'), parent })
  view.dispatch({ selection: { anchor: doc.length } })
  return view
}
const type = (view: EditorView, text: string) => {
  const to = view.state.selection.main.head
  view.dispatch({
    changes: { from: to, insert: text },
    selection: { anchor: to + text.length },
    userEvent: 'input.type',
  })
}
const sel = (view: EditorView) => {
  const r = view.state.selection.main
  return view.state.sliceDoc(r.from, r.to)
}
const key = (view: EditorView, k: string, shiftKey = false) =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: k, shiftKey }), 'editor')

describe('snippet completion in the editor', () => {
  it('inserts :meeting, selects the first field and walks tab stops', async () => {
    const view = mount('')
    type(view, ':mee')
    startCompletion(view)
    await open(view)
    acceptCompletion(view)
    expect(view.state.doc.toString().startsWith('---\nclient: "Kunde"')).toBe(true)
    expect(sel(view)).toBe('Kunde')
    expect(key(view, 'Tab')).toBe(true)
    expect(sel(view)).toBe('Thema')
    view.destroy()
  })

  it('Tab accepts an open list; Enter does too', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString().startsWith('---\n')).toBe(true)
    view.destroy()
  })

  it('with a session and no list, Tab goes to the next field, not indent', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    acceptCompletion(view)
    expect(completionStatus(view.state)).toBeNull()
    const before = view.state.doc.toString()
    key(view, 'Tab')
    expect(sel(view)).toBe('Thema')
    expect(view.state.doc.toString()).toBe(before)
    view.destroy()
  })

  it('with neither list nor session, Tab falls through to indentWithTab', () => {
    const view = mount('abc')
    expect(completionStatus(view.state)).toBeNull()
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString()).not.toBe('abc')
    expect(indentWithTab.key).toBe('Tab')
    view.destroy()
  })

  it('Tab accepts an open list even inside an active snippet field', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    acceptCompletion(view)
    expect(sel(view)).toBe('Kunde')
    // Type a snippet trigger inside the field: list open + session active.
    type(view, ' :tel')
    startCompletion(view)
    await open(view)
    expect(key(view, 'Tab')).toBe(true)
    expect(view.state.doc.toString()).not.toContain(':tel')
    view.destroy()
  })

  it('Enter after a prose colon inserts a newline only', async () => {
    const view = mount('Hinweis:')
    expect(key(view, 'Enter')).toBe(true)
    await tick()
    expect(view.state.doc.toString()).toBe('Hinweis:\n')
    expect(completionStatus(view.state)).toBeNull()
    view.destroy()
  })

  it('a trailing colon in prose never opens the list', async () => {
    const view = mount('Hinweis')
    type(view, ':')
    // Typing-triggered completion starts after activateOnTypingDelay (100 ms).
    await new Promise((r) => setTimeout(r, 250))
    expect(completionStatus(view.state)).toBeNull()
    expect(view.state.doc.toString()).toBe('Hinweis:')
    view.destroy()
  })

  it('Escape with an open list is preventDefault-ed, so Present stays open', async () => {
    const view = mount(':mee')
    startCompletion(view)
    await open(view)
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    view.contentDOM.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(completionStatus(view.state)).toBeNull()
    const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    view.contentDOM.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    view.destroy()
  })
})

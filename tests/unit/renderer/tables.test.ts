// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { EditorView, WidgetType } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { Frontmatter } from '../../../src/renderer/editor/frontmatter'
import { splitRow, tableField, tableModel } from '../../../src/renderer/editor/tables'

const TABLE =
  '| Produkt | Menge | Preis |\n|:--|:-:|---|\n| Espresso | 12 | 3,50 € |\n| Filter | 8 | 2 € |\n| **Neu** | | 1.200,00 EUR |'

function make(doc: string, cursor: number) {
  const s = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ base: markdownLanguage, extensions: [Frontmatter] }), tableField],
  })
  ensureSyntaxTree(s, s.doc.length, 5000)
  // Rebuild once the tree is complete (a no-op transaction re-runs the field).
  return s.update({}).state
}

function tables(state: EditorState): { range: string; widget: WidgetType }[] {
  const out: { range: string; widget: WidgetType }[] = []
  state.field(tableField).between(0, state.doc.length, (from, to, d) => {
    out.push({
      range: `${(d.spec as { rf: string }).rf}@${from}-${to}`,
      widget: d.spec.widget as WidgetType,
    })
  })
  return out
}

describe('splitRow', () => {
  it.each([
    ['| a | b |', ['a', 'b']],
    ['a | b', ['a', 'b']],
    ['| `a|b` | c |', ['`a|b`', 'c']],
    ['| a \\| b | c |', ['a | b', 'c']],
    ['| | x |', ['', 'x']],
  ])('%j', (row, cells) => expect(splitRow(row)).toEqual(cells))
})

describe('tableModel', () => {
  it('reads head, rows, explicit and numeric alignment', () => {
    const m = tableModel(TABLE.split('\n'))
    expect(m.head).toEqual(['Produkt', 'Menge', 'Preis'])
    expect(m.rows).toEqual([
      ['Espresso', '12', '3,50 €'],
      ['Filter', '8', '2 €'],
      ['**Neu**', '', '1.200,00 EUR'],
    ])
    expect(m.aligns).toEqual(['left', 'center', 'right'])
  })
  it('pads short rows and cuts long ones to the head width', () => {
    const m = tableModel(['| a | b |', '|---|---|', '| 1 |', '| 1 | 2 | 3 |'])
    expect(m.rows).toEqual([
      ['1', ''],
      ['1', '2'],
    ])
    expect(m.aligns).toEqual(['right', 'right'])
  })
  it('mixed text column stays left', () => {
    expect(tableModel(['| x |', '|---|', '| 1 |', '| zwei |']).aligns).toEqual(['left'])
  })
})

describe('tableField', () => {
  it('replaces the table by a widget when the cursor is elsewhere', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    const t = tables(make(doc, doc.length))
    const start = doc.indexOf('| Produkt')
    expect(t.map((x) => x.range)).toEqual([`table@${start}-${start + TABLE.length}`])
  })
  it('shows the Markdown when the cursor is inside', () => {
    const doc = `Text\n\n${TABLE}\n\nende`
    expect(tables(make(doc, doc.indexOf('Espresso') + 2))).toEqual([])
  })
  it('renders a PDF-like table', () => {
    const doc = `${TABLE}\n\nende`
    const [first] = tables(make(doc, doc.length))
    const dom = first?.widget.toDOM({} as EditorView) as HTMLElement
    const table = dom.querySelector('table.rf-table') as HTMLTableElement
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Produkt',
      'Menge',
      'Preis',
    ])
    const rows = table.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.classList.contains('rf-table-stripe')).toBe(false)
    expect(rows[1]?.classList.contains('rf-table-stripe')).toBe(true)
    expect(rows[2]?.querySelector('td')?.querySelector('strong.rf-strong')?.textContent).toBe('Neu')
    expect(rows[0]?.children[2]?.classList.contains('rf-al-right')).toBe(true)
    expect(rows[0]?.children[1]?.classList.contains('rf-al-center')).toBe(true)
  })
})

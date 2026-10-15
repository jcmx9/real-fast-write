// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { StatusLine, saveText } from '../../../src/renderer/ui/statusline'

describe('status line', () => {
  it('shows a hold with its reason, styled like a failed save', () => {
    const el = document.createElement('div')
    const status = new StatusLine(el, { exportPdf: () => undefined })
    status.render('a.md', 'held', 'Datei außerhalb gelöscht – bitte im Hinweis entscheiden')
    const state = el.querySelector('[data-testid=status-state]')
    expect(state?.textContent).toBe(
      'Nicht gespeichert: Datei außerhalb gelöscht – bitte im Hinweis entscheiden',
    )
    expect(state?.classList.contains('error')).toBe(true)
    status.render('a.md', 'saved', null)
    expect(state?.textContent).toBe('Gespeichert')
    expect(state?.classList.contains('error')).toBe(false)
  })

  it.each([
    ['error', 'x', 'Speichern fehlgeschlagen: x'],
    ['held', 'y', 'Nicht gespeichert: y'],
    ['dirty', null, 'Ungespeichert'],
  ] as const)('saveText(%s)', (state, reason, text) => {
    expect(saveText(state, reason)).toBe(text)
  })
})

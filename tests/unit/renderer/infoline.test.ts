// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatClock, InfoLine } from '../../../src/renderer/ui/infoline'

const actions = () => ({
  selectTab: vi.fn(),
  exitPresent: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
})
const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid=${id}]`) as HTMLElement

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('formatClock', () => {
  it('pads hours and minutes', () => {
    expect(formatClock(new Date(2026, 9, 15, 9, 5))).toBe('09:05')
    expect(formatClock(new Date(2026, 9, 15, 23, 59))).toBe('23:59')
  })
})

describe('InfoLine', () => {
  it('renders tabs, state and zoom, and calls the actions', () => {
    const el = document.createElement('footer')
    const a = actions()
    const line = new InfoLine(el, a, () => new Date(2026, 9, 15, 14, 30))
    line.render(
      [
        { name: 'A.md', dirty: false },
        { name: 'B.md', dirty: true },
      ],
      1,
      'Gespeichert',
      1.25,
    )
    const tabs = el.querySelectorAll('[data-testid=il-tab]')
    expect([...tabs].map((t) => t.textContent)).toEqual(['A.md', 'B.md'])
    expect(tabs[1]?.classList.contains('active')).toBe(true)
    expect(tabs[1]?.classList.contains('dirty')).toBe(true)
    expect(q(el, 'il-state').textContent).toBe('Gespeichert')
    expect(q(el, 'il-zoom').textContent).toBe('125 %')
    ;(tabs[0] as HTMLElement).click()
    q(el, 'il-edit').click()
    q(el, 'il-zoom-in').click()
    q(el, 'il-zoom-out').click()
    expect(a.selectTab).toHaveBeenCalledWith(0)
    expect(a.exitPresent).toHaveBeenCalledOnce()
    expect(a.zoomIn).toHaveBeenCalledOnce()
    expect(a.zoomOut).toHaveBeenCalledOnce()
  })
  it('updates the clock while started and stops cleanly', () => {
    let now = new Date(2026, 9, 15, 14, 30)
    const el = document.createElement('footer')
    const line = new InfoLine(el, actions(), () => now)
    line.start()
    expect(q(el, 'il-clock').textContent).toBe('14:30')
    now = new Date(2026, 9, 15, 14, 31)
    vi.advanceTimersByTime(15_000)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
    line.stop()
    now = new Date(2026, 9, 15, 15, 0)
    vi.advanceTimersByTime(60_000)
    expect(q(el, 'il-clock').textContent).toBe('14:31')
  })
  it('renders names as text, never HTML', () => {
    const el = document.createElement('footer')
    new InfoLine(el, actions()).render([{ name: '<b>x</b>.md', dirty: false }], 0, '', 1)
    expect(el.querySelector('b')).toBeNull()
  })
})

import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { buildMenuTemplate, type MenuDeps } from '../../../src/main/menu'

const deps = (over: Partial<MenuDeps> = {}): MenuDeps => ({
  platform: 'darwin',
  isDev: false,
  recent: [],
  command: vi.fn(),
  openRecent: vi.fn(),
  clearRecent: vi.fn(),
  ...over,
})

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])])
}
const byId = (items: MenuItemConstructorOptions[], id: string) =>
  flatten(items).find((i) => i.id === id)
const click = (item: MenuItemConstructorOptions | undefined) => {
  if (!item) throw new Error('menu item not found')
  ;(item.click as unknown as () => void)()
}

describe('buildMenuTemplate', () => {
  it.each([
    ['new', 'CmdOrCtrl+N'],
    ['open', 'CmdOrCtrl+O'],
    ['rename', 'CmdOrCtrl+Shift+R'],
    ['close-tab', 'CmdOrCtrl+W'],
    ['export', 'CmdOrCtrl+E'],
    ['undo', 'CmdOrCtrl+Z'],
    ['redo', 'CmdOrCtrl+Shift+Z'],
    ['select-all', 'CmdOrCtrl+A'],
    ['insert-pagebreak', 'CmdOrCtrl+Enter'],
    ['next-tab', 'Ctrl+Tab'],
    ['prev-tab', 'Ctrl+Shift+Tab'],
    ['toggle-present', 'CmdOrCtrl+Shift+P'],
    ['toggle-view', 'CmdOrCtrl+Shift+M'],
    ['toggle-header', 'CmdOrCtrl+Shift+H'],
    ['fold', 'Cmd+Alt+['],
    ['unfold', 'Cmd+Alt+]'],
    ['fold-all', 'Ctrl+Alt+['],
    ['unfold-all', 'Ctrl+Alt+]'],
    ['zoom-in', 'CmdOrCtrl+Plus'],
    ['zoom-out', 'CmdOrCtrl+-'],
    ['zoom-reset', 'CmdOrCtrl+0'],
  ])('%s has accelerator %s and sends its command', (id, accelerator) => {
    const d = deps()
    const item = byId(buildMenuTemplate(d), id)
    expect(item?.accelerator).toBe(accelerator)
    click(item)
    expect(d.command).toHaveBeenCalledWith(id)
  })

  it('ignores toggle-present key repeats from a held shortcut', () => {
    let now = 1000
    const d = deps({ now: () => now })
    const item = byId(buildMenuTemplate(d), 'toggle-present')
    if (!item) throw new Error('menu item not found')
    const key = () =>
      (item.click as unknown as (a: unknown, b: unknown, e: unknown) => void)(null, null, {
        triggeredByAccelerator: true,
      })
    key()
    for (let i = 0; i < 20; i++) {
      now += 40 // OS key repeat while the shortcut is held
      key()
    }
    expect(d.command).toHaveBeenCalledTimes(1)
    now += 1000 // released, pressed again later
    key()
    expect(d.command).toHaveBeenCalledTimes(2)
    // Mouse clicks on the menu item are never debounced.
    click(item)
    expect(d.command).toHaveBeenCalledTimes(3)
  })

  it('has an app menu on macOS and a quit item elsewhere', () => {
    expect(buildMenuTemplate(deps())[0]?.role).toBe('appMenu')
    const winItems = flatten(buildMenuTemplate(deps({ platform: 'win32' })))
    expect(winItems.some((i) => i.role === 'appMenu')).toBe(false)
    expect(winItems.some((i) => i.role === 'quit')).toBe(true)
  })

  it('lists recent files and can clear them', () => {
    const d = deps({ recent: ['/n/a.md', '/n/b.md'] })
    const items = flatten(buildMenuTemplate(d))
    click(items.find((i) => i.label === '/n/b.md'))
    expect(d.openRecent).toHaveBeenCalledWith('/n/b.md')
    click(items.find((i) => i.label === 'Liste leeren'))
    expect(d.clearRecent).toHaveBeenCalled()
  })

  it('shows a disabled placeholder without recent files', () => {
    const item = flatten(buildMenuTemplate(deps())).find((i) => i.label === 'Keine Einträge')
    expect(item?.enabled).toBe(false)
  })

  it('offers dev tools only in development', () => {
    const has = (isDev: boolean) =>
      flatten(buildMenuTemplate(deps({ isDev }))).some((i) => i.role === 'toggleDevTools')
    expect(has(true)).toBe(true)
    expect(has(false)).toBe(false)
  })

  it('uses Ctrl+Shift+[ / ] and Alt+0 / Alt+Shift+0 for folding on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const items = flatten(buildMenuTemplate(deps({ platform })))
      expect(items.find((i) => i.id === 'fold')?.accelerator).toBe('Ctrl+Shift+[')
      expect(items.find((i) => i.id === 'unfold')?.accelerator).toBe('Ctrl+Shift+]')
      // Ctrl+Alt is AltGr there: it must stay free for typing [ and ].
      expect(items.find((i) => i.id === 'fold-all')?.accelerator).toBe('Alt+0')
      expect(items.find((i) => i.id === 'unfold-all')?.accelerator).toBe('Alt+Shift+0')
      expect(items.some((i) => String(i.accelerator ?? '').startsWith('Ctrl+Alt+'))).toBe(false)
    }
  })

  it('puts the view items under "Ansicht" in production too', () => {
    const view = buildMenuTemplate(deps()).find((m) => m.label === 'Ansicht')
    const ids = ((view?.submenu ?? []) as { id?: string }[]).map((i) => i.id).filter(Boolean)
    expect(ids).toEqual([
      'toggle-present',
      'toggle-view',
      'toggle-header',
      'fold',
      'unfold',
      'fold-all',
      'unfold-all',
      'zoom-in',
      'zoom-out',
      'zoom-reset',
    ])
  })
})

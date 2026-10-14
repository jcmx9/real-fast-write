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
    ['next-tab', 'Ctrl+Tab'],
    ['prev-tab', 'Ctrl+Shift+Tab'],
  ])('%s has accelerator %s and sends its command', (id, accelerator) => {
    const d = deps()
    const item = byId(buildMenuTemplate(d), id)
    expect(item?.accelerator).toBe(accelerator)
    click(item)
    expect(d.command).toHaveBeenCalledWith(id)
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
})

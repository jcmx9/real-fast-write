import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export interface MenuDeps {
  platform: NodeJS.Platform
  isDev: boolean
  recent: readonly string[]
  command(c: MenuCommand): void
  openRecent(path: string): void
  clearRecent(): void
}

export function buildMenuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  const mac = d.platform === 'darwin'
  const item = (
    id: MenuCommand,
    label: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    click: () => d.command(id),
  })
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const recent: MenuItemConstructorOptions[] = d.recent.length
    ? [
        ...d.recent.map(
          (p): MenuItemConstructorOptions => ({ label: p, click: () => d.openRecent(p) }),
        ),
        sep,
        { label: 'Liste leeren', click: () => d.clearRecent() },
      ]
    : [{ label: 'Keine Einträge', enabled: false }]

  const file: MenuItemConstructorOptions = {
    label: 'Datei',
    submenu: [
      item('new', 'Neu', 'CmdOrCtrl+N'),
      item('open', 'Öffnen …', 'CmdOrCtrl+O'),
      { label: 'Zuletzt geöffnet', submenu: recent },
      sep,
      item('rename', 'Umbenennen …', 'CmdOrCtrl+Shift+R'),
      item('close-tab', 'Tab schließen', 'CmdOrCtrl+W'),
      sep,
      item('export', 'PDF exportieren', 'CmdOrCtrl+E'),
      ...(mac ? [] : [sep, { role: 'quit', label: 'Beenden' } as MenuItemConstructorOptions]),
    ],
  }

  const edit: MenuItemConstructorOptions = {
    label: 'Bearbeiten',
    submenu: [
      item('undo', 'Widerrufen', 'CmdOrCtrl+Z'),
      item('redo', 'Wiederholen', 'CmdOrCtrl+Shift+Z'),
      sep,
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfügen' },
      item('select-all', 'Alles auswählen', 'CmdOrCtrl+A'),
    ],
  }

  const foldKey = mac ? 'Cmd+Alt+' : 'Ctrl+Shift+'
  const view: MenuItemConstructorOptions = {
    label: 'Ansicht',
    submenu: [
      item('toggle-view', 'Code-Ansicht ein/aus', 'CmdOrCtrl+Shift+M'),
      item('toggle-header', 'YAML-Header ein/aus', 'CmdOrCtrl+Shift+H'),
      sep,
      item('fold', 'Abschnitt einklappen', `${foldKey}[`),
      item('unfold', 'Abschnitt ausklappen', `${foldKey}]`),
      item('fold-all', 'Alle einklappen', 'Ctrl+Alt+['),
      item('unfold-all', 'Alle ausklappen', 'Ctrl+Alt+]'),
      ...(d.isDev
        ? [
            sep,
            { role: 'reload' } as MenuItemConstructorOptions,
            { role: 'toggleDevTools' } as MenuItemConstructorOptions,
          ]
        : []),
    ],
  }

  const window: MenuItemConstructorOptions = {
    label: 'Fenster',
    submenu: [
      item('next-tab', 'Nächster Tab', 'Ctrl+Tab'),
      item('prev-tab', 'Vorheriger Tab', 'Ctrl+Shift+Tab'),
      ...(mac
        ? [sep, { role: 'minimize', label: 'Im Dock ablegen' } as MenuItemConstructorOptions]
        : []),
    ],
  }

  return [
    ...(mac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    file,
    edit,
    view,
    window,
  ]
}

import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

export interface MenuDeps {
  platform: NodeJS.Platform
  isDev: boolean
  recent: readonly string[]
  command(c: MenuCommand): void
  openRecent(path: string): void
  clearRecent(): void
  /** Clock for the held-shortcut guard (tests); defaults to Date.now. */
  now?: () => number
}

/** Key repeats closer than this belong to one held shortcut. */
const KEY_REPEAT_MS = 500

/** Electron passes this as the click handler's third argument. */
interface ClickEvent {
  triggeredByAccelerator?: boolean
}

export function buildMenuTemplate(d: MenuDeps): MenuItemConstructorOptions[] {
  const mac = d.platform === 'darwin'
  const now = d.now ?? Date.now
  // A held Cmd/Ctrl+Shift+P repeats; only the first press toggles Present (no flapping).
  let lastPresentKey = Number.NEGATIVE_INFINITY
  const heldRepeat = (id: MenuCommand, event: ClickEvent | undefined): boolean => {
    if (id !== 'toggle-present' || !event?.triggeredByAccelerator) return false
    const t = now()
    const repeat = t - lastPresentKey < KEY_REPEAT_MS
    lastPresentKey = t
    return repeat
  }
  const item = (
    id: MenuCommand,
    label: string,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    click: (_item, _win, event: ClickEvent | undefined) => {
      if (!heldRepeat(id, event)) d.command(id)
    },
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
      sep,
      item('insert-pagebreak', 'Seitenumbruch einfügen', 'CmdOrCtrl+Enter'),
    ],
  }

  const foldKey = mac ? 'Cmd+Alt+' : 'Ctrl+Shift+'
  const view: MenuItemConstructorOptions = {
    label: 'Ansicht',
    submenu: [
      item('toggle-present', 'Präsentieren ein/aus', 'CmdOrCtrl+Shift+P'),
      sep,
      item('toggle-view', 'Code-Ansicht ein/aus', 'CmdOrCtrl+Shift+M'),
      item('toggle-header', 'YAML-Header ein/aus', 'CmdOrCtrl+Shift+H'),
      item('toggle-outline', 'Gliederung ein/aus', 'CmdOrCtrl+Shift+O'),
      sep,
      item('fold', 'Abschnitt einklappen', `${foldKey}[`),
      item('unfold', 'Abschnitt ausklappen', `${foldKey}]`),
      // Not Ctrl+Alt on Windows/Linux: that is AltGr, which types `[` / `]` on German layouts.
      item('fold-all', 'Alle einklappen', mac ? 'Ctrl+Alt+[' : 'Alt+0'),
      item('unfold-all', 'Alle ausklappen', mac ? 'Ctrl+Alt+]' : 'Alt+Shift+0'),
      sep,
      item('zoom-in', 'Vergrößern', 'CmdOrCtrl+Plus'),
      item('zoom-out', 'Verkleinern', 'CmdOrCtrl+-'),
      item('zoom-reset', 'Originalgröße', 'CmdOrCtrl+0'),
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

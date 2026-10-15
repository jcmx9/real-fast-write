// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isAbsolutePath,
  openSettings,
  parseFactor,
  type SettingsDialogDeps,
  statusLines,
} from '../../../src/renderer/ui/settings'
import type { Settings, SettingsStatus } from '../../../src/shared/types'

const settings: Settings = {
  defaultFolder: '/Users/u/Documents/rf-write',
  snippetFolder: '/Users/u/Documents/rf-write/snippets',
  rfDocumentPath: '',
  presentFontFactor: 1.6,
  headerDefault: 'yaml',
}

const status: SettingsStatus = {
  rfDocument: { path: '/Users/u/.local/bin/rf-document', version: '26.10.17' },
  fonts: { dir: '/Users/u/.local/share/real-fast-document/fonts', found: true, missing: [] },
}

const deps = (over: Partial<SettingsDialogDeps> = {}): SettingsDialogDeps => ({
  settings,
  status: Promise.resolve(status),
  choose: vi.fn(async () => null),
  ...over,
})

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.querySelector<T>(`[data-testid=${id}]`)
  if (!el) throw new Error(`missing ${id}`)
  return el
}
const input = (id: string) => $<HTMLInputElement>(id)
const press = (target: HTMLElement, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('settings dialog', () => {
  it('shows the current values and the status', async () => {
    void openSettings(deps())
    expect(document.querySelector('dialog.prompt h2')?.textContent).toBe('Einstellungen')
    expect(input('settings-default-folder').value).toBe(settings.defaultFolder)
    expect(input('settings-snippet-folder').value).toBe(settings.snippetFolder)
    expect(input('settings-rf-document').value).toBe('')
    expect(input('settings-rf-document').placeholder).toBe('leer = automatisch')
    expect(input('settings-factor').value).toBe('1.6')
    expect(input('settings-header-yaml').checked).toBe(true)
    expect(input('settings-header-titleblock').checked).toBe(false)
    const text = document.querySelector('dialog')?.textContent ?? ''
    for (const label of [
      'Standardordner für neue Notizen',
      'Snippet-Ordner',
      'rf-document',
      'Schriftfaktor im Präsentationsmodus',
      'YAML-Header in der Vorschau',
      'als YAML',
      'als Titelblock',
      'Wählen …',
      'Abbrechen',
      'Speichern',
    ])
      expect(text).toContain(label)
    await flush()
    expect($('settings-status-rfd').textContent).toBe(
      'rf-document: gefunden – /Users/u/.local/bin/rf-document (Version 26.10.17)',
    )
    expect($('settings-status-fonts').textContent).toBe(
      'Schriften: gefunden in /Users/u/.local/share/real-fast-document/fonts',
    )
  })

  it('Save sends only the changed values', async () => {
    const done = openSettings(deps())
    input('settings-factor').value = '2.2'
    input('settings-header-titleblock').checked = true
    input('settings-rf-document').value = '/opt/rf/rf-document'
    $('settings-save').click()
    expect(await done).toEqual({
      presentFontFactor: 2.2,
      headerDefault: 'titleblock',
      rfDocumentPath: '/opt/rf/rf-document',
    })
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('Enter saves, also from a radio button', async () => {
    const done = openSettings(deps())
    input('settings-header-titleblock').checked = true
    press(input('settings-header-titleblock'), 'Enter')
    expect(await done).toEqual({ headerDefault: 'titleblock' })
  })

  it('Esc and Abbrechen cancel without a patch', async () => {
    const first = openSettings(deps())
    input('settings-factor').value = '2'
    press(input('settings-factor'), 'Escape')
    expect(await first).toBeNull()
    expect(document.querySelector('dialog')).toBeNull()
    const second = openSettings(deps())
    $('settings-cancel').click()
    expect(await second).toBeNull()
  })

  it.each(['0.9', '3.1', 'abc', ''])('refuses the factor %j and stays open', async (value) => {
    const done = vi.fn()
    void openSettings(deps()).then(done)
    input('settings-factor').value = value
    $('settings-save').click()
    await flush()
    expect(done).not.toHaveBeenCalled()
    expect($('settings-error').textContent).toBe(
      'Schriftfaktor: bitte eine Zahl von 1.0 bis 3.0 angeben.',
    )
    expect(document.querySelector('dialog')).not.toBeNull()
  })

  it('refuses relative or empty folders', async () => {
    const done = vi.fn()
    void openSettings(deps()).then(done)
    input('settings-snippet-folder').value = 'snippets'
    $('settings-save').click()
    await flush()
    expect(done).not.toHaveBeenCalled()
    expect($('settings-error').textContent).toBe(
      'Snippet-Ordner: bitte einen absoluten Pfad angeben.',
    )
  })

  it('Wählen … fills the field with the picked path; cancel keeps it', async () => {
    const choose = vi
      .fn<SettingsDialogDeps['choose']>()
      .mockResolvedValueOnce('/Volumes/Daten/Notizen')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/opt/rf/rf-document')
    void openSettings(deps({ choose }))
    $('settings-choose-default-folder').click()
    await flush()
    expect(choose).toHaveBeenLastCalledWith('folder', settings.defaultFolder)
    expect(input('settings-default-folder').value).toBe('/Volumes/Daten/Notizen')
    $('settings-choose-snippet-folder').click()
    await flush()
    expect(input('settings-snippet-folder').value).toBe(settings.snippetFolder)
    $('settings-choose-rf-document').click()
    await flush()
    expect(choose).toHaveBeenLastCalledWith('file', '')
    expect(input('settings-rf-document').value).toBe('/opt/rf/rf-document')
  })

  it('shows when the status cannot be read', async () => {
    void openSettings(deps({ status: Promise.reject(new Error('x')) }))
    await flush()
    expect($('settings-status-rfd').textContent).toBe('Status nicht verfügbar')
  })
})

describe('statusLines', () => {
  it('rf-document missing, version unknown, fonts missing', () => {
    expect(
      statusLines({
        rfDocument: { path: null, version: null },
        fonts: { dir: '/f', found: false, missing: ['A.otf', 'B.otf'] },
      }),
    ).toEqual({
      rfDocument: 'rf-document: nicht gefunden',
      fonts: 'Schriften: fehlen: A.otf, B.otf',
    })
    expect(
      statusLines({ ...status, rfDocument: { path: '/bin/rf-document', version: null } })
        .rfDocument,
    ).toBe('rf-document: gefunden – /bin/rf-document (Version unbekannt)')
  })
})

describe('parseFactor', () => {
  it.each([
    ['1', 1],
    ['3', 3],
    ['1.6', 1.6],
    ['2,5', 2.5],
    [' 2 ', 2],
    ['0.99', null],
    ['3.01', null],
    ['', null],
    ['x', null],
    ['Infinity', null],
  ])('%j → %s', (text, value) => {
    expect(parseFactor(text)).toBe(value)
  })
})

describe('isAbsolutePath', () => {
  it.each([
    ['/Users/u', true],
    ['C:\\Users\\u', true],
    ['C:/Users/u', true],
    ['\\\\server\\share', true],
    ['relativ', false],
    ['./x', false],
    ['C:relativ', false],
    ['', false],
  ])('%j → %s', (p, abs) => {
    expect(isAbsolutePath(p)).toBe(abs)
  })
})

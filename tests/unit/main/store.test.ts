import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION,
  defaultSettings,
  loadJson,
  sanitizeSession,
  sanitizeSettings,
  saveJson,
  settingsPatch,
} from '../../../src/main/store'

const docs = resolve('/home/u/Documents')
const defaults = defaultSettings(docs)

describe('settings', () => {
  it('has spec defaults', () => {
    expect(defaults).toEqual({
      defaultFolder: join(docs, 'rf-write'),
      snippetFolder: join(docs, 'rf-write', 'snippets'),
      rfDocumentPath: '',
      presentFontFactor: 1.6,
      headerDefault: 'yaml',
    })
  })

  it('keeps a known header default and drops an unknown one', () => {
    expect(sanitizeSettings({ headerDefault: 'titleblock' }, defaults).headerDefault).toBe(
      'titleblock',
    )
    expect(sanitizeSettings({ headerDefault: 'kaputt' }, defaults).headerDefault).toBe('yaml')
  })

  it('keeps valid values and derives the snippet folder from a custom default folder', () => {
    const custom = resolve('/data/notes')
    expect(sanitizeSettings({ defaultFolder: custom, presentFontFactor: 2 }, defaults)).toEqual({
      ...defaults,
      defaultFolder: custom,
      snippetFolder: join(custom, 'snippets'),
      presentFontFactor: 2,
    })
  })

  it('drops relative paths, wrong types and clamps numbers', () => {
    expect(
      sanitizeSettings(
        { defaultFolder: 'relativ', rfDocumentPath: 42, presentFontFactor: 99 },
        defaults,
      ),
    ).toEqual({ ...defaults, presentFontFactor: 3 })
    expect(sanitizeSettings('kaputt', defaults)).toEqual(defaults)
  })
})

describe('settingsPatch', () => {
  const current = defaults

  it('applies valid values', () => {
    const folder = resolve('/data/notes')
    const snippets = resolve('/data/snippets')
    const bin = resolve('/opt/rf/rf-document')
    expect(
      settingsPatch(current, {
        defaultFolder: folder,
        snippetFolder: snippets,
        rfDocumentPath: bin,
        presentFontFactor: 2.2,
        headerDefault: 'titleblock',
      }),
    ).toEqual({
      defaultFolder: folder,
      snippetFolder: snippets,
      rfDocumentPath: bin,
      presentFontFactor: 2.2,
      headerDefault: 'titleblock',
    })
  })

  it('an empty rf-document path means automatic', () => {
    const configured = { ...current, rfDocumentPath: resolve('/opt/rf/rf-document') }
    expect(settingsPatch(configured, { rfDocumentPath: '' }).rfDocumentPath).toBe('')
  })

  it.each([
    ['relative default folder', { defaultFolder: 'notizen' }],
    ['empty default folder', { defaultFolder: '' }],
    ['relative snippet folder', { snippetFolder: './s' }],
    ['relative rf-document path', { rfDocumentPath: 'bin/rf-document' }],
    ['non-string path', { defaultFolder: 42 }],
    ['factor below range', { presentFontFactor: 0.9 }],
    ['factor above range', { presentFontFactor: 3.1 }],
    ['factor not a number', { presentFontFactor: '2' }],
    ['factor NaN', { presentFontFactor: Number.NaN }],
    ['unknown header default', { headerDefault: 'beides' }],
  ])('rejects a %s and keeps the current value', (_name, patch) => {
    expect(settingsPatch(current, patch)).toEqual(current)
  })

  it('ignores unknown keys and garbage', () => {
    expect(settingsPatch(current, { evil: 1 })).toEqual(current)
    expect(settingsPatch(current, null)).toEqual(current)
    expect(settingsPatch(current, 'x')).toEqual(current)
  })

  it('accepts the range limits', () => {
    expect(settingsPatch(current, { presentFontFactor: 1 }).presentFontFactor).toBe(1)
    expect(settingsPatch(current, { presentFontFactor: 3 }).presentFontFactor).toBe(3)
  })
})

describe('session', () => {
  it('defaults for garbage', () => {
    expect(sanitizeSession(null)).toEqual(DEFAULT_SESSION)
  })

  it('filters tabs, clamps index and zoom, trims recent', () => {
    const a = resolve('/n/a.md')
    const raw = {
      tabs: [{ path: a, headerHidden: true }, { path: 'rel.md' }, 7],
      activeIndex: 5,
      mode: 'present',
      view: 'code',
      zoom: { edit: 10, present: 'x' },
      recent: [...Array.from({ length: 12 }, (_, i) => resolve(`/r/${i}.md`)), 'rel'],
    }
    const s = sanitizeSession(raw)
    expect(s.tabs).toEqual([{ path: a, headerHidden: true }])
    expect(s.activeIndex).toBe(0)
    expect(s.mode).toBe('present')
    expect(s.view).toBe('code')
    expect(s.zoom).toEqual({ edit: 3, present: 1 })
    expect(s.recent).toHaveLength(10)
  })

  it('outline: missing → both off, booleans kept, anything else → off', () => {
    expect(DEFAULT_SESSION.outline).toEqual({ edit: false, present: false })
    expect(sanitizeSession({}).outline).toEqual({ edit: false, present: false })
    expect(sanitizeSession({ outline: { edit: true, present: true } }).outline).toEqual({
      edit: true,
      present: true,
    })
    expect(sanitizeSession({ outline: { edit: 'yes', present: 1 } }).outline).toEqual({
      edit: false,
      present: false,
    })
    expect(sanitizeSession({ outline: true }).outline).toEqual({ edit: false, present: false })
  })
})

describe('loadJson / saveJson', () => {
  it('round-trips and creates the folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-store-'))
    const file = join(dir, 'sub', 'settings.json')
    await saveJson(file, { a: 1 })
    expect(await loadJson(file)).toEqual({ a: 1 })
    expect((await readFile(file, 'utf8')).endsWith('\n')).toBe(true)
  })

  it('loads valid JSON that starts with a BOM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-store-'))
    const file = join(dir, 'settings.json')
    await writeFile(file, '\uFEFF{"a":1}')
    expect(await loadJson(file)).toEqual({ a: 1 })
    expect(await readdir(dir)).toEqual(['settings.json'])
  })

  it('returns undefined for a missing file', async () => {
    expect(await loadJson(join(tmpdir(), 'rfw-gibt-es-nicht.json'))).toBeUndefined()
  })

  it('moves a corrupt file aside and returns undefined', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-store-'))
    const file = join(dir, 'session.json')
    await writeFile(file, '{kaputt')
    expect(await loadJson(file)).toBeUndefined()
    expect(await readdir(dir)).toEqual(['session.json.corrupt'])
  })
})

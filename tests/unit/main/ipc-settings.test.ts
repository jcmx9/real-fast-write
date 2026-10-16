import { chmod, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ch } from '../../../src/shared/ipc'
import type { Settings, SettingsStatus } from '../../../src/shared/types'
import { makeFakeRfDocument } from '../../helpers/fake-rf-document'

type Handler = (e: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const showOpenDialog = vi.fn()

vi.mock('electron', () => ({
  app: { isPackaged: false, quit: vi.fn() },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showOpenDialog: (...args: unknown[]) => showOpenDialog(...args) },
  ipcMain: {
    handle: (ch: string, fn: Handler) => handlers.set(ch, fn),
    on: vi.fn(),
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}))

const { AppContext } = await import('../../../src/main/context')
const { registerIpc } = await import('../../../src/main/ipc')

const invoke = (ch: string, ...args: unknown[]) => {
  const h = handlers.get(ch)
  if (!h) throw new Error(`no handler for ${ch}`)
  return h({ sender: {} }, ...args)
}

let root: string
let userData: string
let ctx: InstanceType<typeof AppContext>

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'rfw-settings-')))
  userData = join(root, 'user-data')
  await mkdir(userData)
  handlers.clear()
  showOpenDialog.mockReset()
  ctx = new AppContext(userData, root)
  registerIpc(ctx)
})

const stored = async (): Promise<unknown> =>
  JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))

describe('settings:update', () => {
  it('persists valid values, returns them and applies them at once', async () => {
    const folder = join(root, 'Neue Notizen')
    const next = (await invoke(Ch.updateSettings, {
      defaultFolder: folder,
      presentFontFactor: 2.4,
      headerDefault: 'titleblock',
    })) as Settings
    expect(next).toMatchObject({
      defaultFolder: folder,
      presentFontFactor: 2.4,
      headerDefault: 'titleblock',
    })
    expect(ctx.settings).toEqual(next)
    expect(await stored()).toEqual(next)
    const note = (await invoke(Ch.newNotePath)) as string
    expect(note.startsWith(join(folder, ''))).toBe(true)
  })

  it('never persists invalid input', async () => {
    const before = { ...ctx.settings }
    const next = await invoke(Ch.updateSettings, {
      defaultFolder: 'relativ',
      snippetFolder: '',
      rfDocumentPath: 'rf-document',
      presentFontFactor: 7,
      headerDefault: 'xml',
    })
    expect(next).toEqual(before)
    expect(await stored()).toEqual(before)
  })

  it('a reloaded context reads the saved settings', async () => {
    await invoke(Ch.updateSettings, { presentFontFactor: 1.2, headerDefault: 'titleblock' })
    const again = new AppContext(userData, root)
    await again.load()
    expect(again.settings).toMatchObject({ presentFontFactor: 1.2, headerDefault: 'titleblock' })
  })

  it('a new rf-document path is used by the next export (no stale lookup)', async () => {
    const one = await mkdtemp(join(root, 'one-'))
    const two = await mkdtemp(join(root, 'two-'))
    const a = await makeFakeRfDocument(one, { stdout: 'erster' })
    const b = await makeFakeRfDocument(two, { stdout: 'zweiter' })
    const note = join(root, 'a.md')
    await writeFile(note, '# A\n')
    await invoke(Ch.updateSettings, { rfDocumentPath: a.bin })
    expect(await ctx.exportPdf(note)).toEqual({ kind: 'ok', message: 'erster' })
    await invoke(Ch.updateSettings, { rfDocumentPath: b.bin })
    expect(await ctx.exportPdf(note)).toEqual({ kind: 'ok', message: 'zweiter' })
  })

  it('accepts an rf-document path only for an executable file named rf-document', async () => {
    const dir = await mkdtemp(join(root, 'bin-'))
    const good = await makeFakeRfDocument(dir)
    const other = join(dir, process.platform === 'win32' ? 'evil.cmd' : 'evil')
    await writeFile(other, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n')
    await chmod(other, 0o755)
    const folder = join(dir, 'rf-document-folder', 'rf-document')
    await mkdir(folder, { recursive: true })
    const missing = join(dir, 'missing', 'rf-document')
    for (const bad of [other, folder, missing]) {
      const next = (await invoke(Ch.updateSettings, { rfDocumentPath: bad })) as Settings
      expect(next.rfDocumentPath).toBe('')
    }
    if (process.platform !== 'win32') {
      const plain = join(dir, 'plain')
      await mkdir(plain)
      const notExecutable = join(plain, 'rf-document')
      await writeFile(notExecutable, '#!/bin/sh\n')
      await chmod(notExecutable, 0o644)
      const next = (await invoke(Ch.updateSettings, { rfDocumentPath: notExecutable })) as Settings
      expect(next.rfDocumentPath).toBe('')
    }
    const ok = (await invoke(Ch.updateSettings, { rfDocumentPath: good.bin })) as Settings
    expect(ok.rfDocumentPath).toBe(good.bin)
    // A rejected change keeps the previous valid path.
    const kept = (await invoke(Ch.updateSettings, { rfDocumentPath: other })) as Settings
    expect(kept.rfDocumentPath).toBe(good.bin)
    expect(await stored()).toMatchObject({ rfDocumentPath: good.bin })
    // Empty = locate automatically, always allowed.
    const auto = (await invoke(Ch.updateSettings, { rfDocumentPath: '' })) as Settings
    expect(auto.rfDocumentPath).toBe('')
  })

  it('a snippet folder change is what listSnippets reads', async () => {
    const snippets = join(root, 'Bausteine')
    await mkdir(snippets)
    await writeFile(join(snippets, 'gruss.tpl.md'), 'Hallo')
    await invoke(Ch.updateSettings, { snippetFolder: snippets })
    expect(await invoke(Ch.listSnippets)).toEqual([
      { name: 'gruss', body: 'Hallo', source: 'user' },
    ])
  })
})

describe('settings:get-status', () => {
  it('reports the configured rf-document with its version and the font folder', async () => {
    const bin = await makeFakeRfDocument(root, { stdout: 'rf-document 26.10.17' })
    await invoke(Ch.updateSettings, { rfDocumentPath: bin.bin })
    ctx.fonts = { dir: join(root, 'fonts'), found: false, missing: [] }
    const status = (await invoke(Ch.settingsStatus)) as SettingsStatus
    expect(status.rfDocument).toEqual({ path: bin.bin, version: '26.10.17' })
    expect(status.fonts.dir).toBe(join(root, 'fonts'))
    expect(status.fonts.found).toBe(false)
    expect(status.fonts.missing).toContain('SourceSans3VF-Upright.otf')
  })

  it('reports a configured but missing rf-document as found elsewhere or not at all', async () => {
    // Only a hand-edited settings.json can name a missing file; the dialog refuses it.
    const missing = join(root, 'gibt-es-nicht', 'rf-document')
    await writeFile(join(userData, 'settings.json'), JSON.stringify({ rfDocumentPath: missing }))
    await ctx.load()
    expect(ctx.settings.rfDocumentPath).toBe(missing)
    const status = (await invoke(Ch.settingsStatus)) as SettingsStatus
    expect(status.rfDocument.path).not.toBe(missing)
    if (status.rfDocument.path === null) expect(status.rfDocument.version).toBeNull()
  })
})

describe('settings:choose-path', () => {
  it('folders: picker may create folders, returns the canonical path', async () => {
    const real = join(root, 'echt')
    const link = join(root, 'verknuepft')
    await mkdir(real)
    await symlink(real, link, 'junction')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [link] })
    expect(await invoke(Ch.choosePath, 'folder', root)).toBe(real)
    const options = showOpenDialog.mock.calls[0]?.[0] as Electron.OpenDialogOptions
    expect(options.properties).toEqual(['openDirectory', 'createDirectory'])
    expect(options.defaultPath).toBe(root)
  })

  it('file: picks a single file; cancel returns null', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await invoke(Ch.choosePath, 'file', '')).toBeNull()
    const options = showOpenDialog.mock.calls[0]?.[0] as Electron.OpenDialogOptions
    expect(options.properties).toEqual(['openFile'])
    expect(options.defaultPath).toBeUndefined()
  })

  it('rejects an unknown kind', async () => {
    await expect(Promise.resolve(invoke(Ch.choosePath, 'anything', ''))).rejects.toThrow()
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})

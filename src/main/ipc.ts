import { BrowserWindow, dialog, ipcMain } from 'electron'
import { Ch } from '../shared/ipc'
import type { NoteFile, RenameResult, SaveResult, SessionPatch } from '../shared/types'
import { type AppContext, logSessionError } from './context'
import { hashBytes, newNotePath, noteBytes, readNote, renameNote, writeNoteBytes } from './files'
import { loadUserSnippets } from './snippets'

const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new TypeError('Ungültiger Parameter.')
  return v
}
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function registerIpc(ctx: AppContext): void {
  ipcMain.handle(Ch.startup, () => ctx.startup())
  ipcMain.handle(Ch.listSnippets, () => loadUserSnippets(ctx.settings.snippetFolder))

  /**
   * The app only leaves a fullscreen it requested itself (FullScreenOwner); returns whether
   * the user had the window fullscreen before the request.
   */
  ipcMain.handle(Ch.setFullScreen, (e, on: unknown): boolean => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return false
    const flag = on === true
    const action = ctx.fullScreen.request(flag, win.isFullScreen())
    // macOS hides the menu bar in fullscreen itself; Windows/Linux need it hidden explicitly,
    // and shown again on leaving Present even when the user's own fullscreen stays.
    if (process.platform !== 'darwin') win.setMenuBarVisibility(!flag)
    if (action.set !== null) win.setFullScreen(action.set)
    return action.was
  })

  ipcMain.handle(Ch.readNote, async (_e, path: unknown): Promise<NoteFile | { error: string }> => {
    try {
      const p = str(path)
      ctx.assertAllowed(p)
      const note = await readNote(p)
      ctx.watcher.expect(p, note.hash)
      void ctx.rememberRecent(p).catch(logSessionError)
      return note
    } catch (err) {
      return { error: message(err) }
    }
  })

  ipcMain.handle(Ch.newNotePath, async () => {
    const p = await newNotePath(ctx.settings.defaultFolder, new Date(), ctx.reserved)
    ctx.reserved.add(p)
    ctx.allow([p])
    return p
  })

  ipcMain.handle(Ch.releasePath, (_e, path: unknown) => {
    ctx.reserved.delete(str(path))
  })

  ipcMain.handle(
    Ch.saveNote,
    async (_e, path: unknown, text: unknown, bom: unknown): Promise<SaveResult> => {
      try {
        const p = str(path)
        ctx.assertAllowed(p)
        const bytes = noteBytes(str(text), bom === true)
        const hash = hashBytes(bytes)
        ctx.watcher.expect(p, hash)
        await writeNoteBytes(p, bytes)
        if (ctx.reserved.delete(p)) void ctx.rememberRecent(p).catch(logSessionError)
        return { ok: true, hash }
      } catch (err) {
        return { ok: false, error: message(err) }
      }
    },
  )

  ipcMain.handle(
    Ch.renameNote,
    async (_e, from: unknown, newName: unknown): Promise<RenameResult> => {
      try {
        const p = str(from)
        ctx.assertAllowed(p)
        const to = await renameNote(p, str(newName))
        ctx.allow([to])
        await ctx.renamedRecent(p, to)
        return { ok: true, path: to }
      } catch (err) {
        return { ok: false, error: message(err) }
      }
    },
  )

  ipcMain.handle(Ch.openDialog, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      defaultPath: ctx.settings.defaultFolder,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    ctx.allow(result.filePaths)
    return result.filePaths
  })

  ipcMain.handle(Ch.exportPdf, async (_e, path: unknown) => {
    const p = str(path)
    ctx.assertAllowed(p)
    return ctx.exportPdf(p)
  })

  ipcMain.handle(Ch.saveSession, async (_e, patch: unknown) => {
    if (typeof patch === 'object' && patch !== null) await ctx.updateSession(patch as SessionPatch)
  })

  ipcMain.handle(Ch.watch, (_e, paths: unknown) => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    ctx.watcher.setFiles(list.filter((p) => ctx.isAllowed(p)))
  })

  ipcMain.handle(Ch.confirmDiscard, (_e, names: unknown) =>
    ctx.confirmDiscard(Array.isArray(names) ? names.map(String) : []),
  )

  ipcMain.on(Ch.closeReady, (_e, ok: unknown) => ctx.closeReady(ok === true))
}

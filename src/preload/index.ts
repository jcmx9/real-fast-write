import { contextBridge, ipcRenderer } from 'electron'
import { Ch } from '../shared/ipc'
import type { ExternalChange, MenuCommand, RfwApi } from '../shared/types'

const api: RfwApi = {
  startup: () => ipcRenderer.invoke(Ch.startup),
  readNote: (path) => ipcRenderer.invoke(Ch.readNote, path),
  newNotePath: () => ipcRenderer.invoke(Ch.newNotePath),
  releasePath: (path) => ipcRenderer.invoke(Ch.releasePath, path),
  saveNote: (path, text, bom) => ipcRenderer.invoke(Ch.saveNote, path, text, bom),
  renameNote: (from, newName) => ipcRenderer.invoke(Ch.renameNote, from, newName),
  showOpenDialog: () => ipcRenderer.invoke(Ch.openDialog),
  exportPdf: (path) => ipcRenderer.invoke(Ch.exportPdf, path),
  saveSession: (patch) => ipcRenderer.invoke(Ch.saveSession, patch),
  watch: (paths) => ipcRenderer.invoke(Ch.watch, paths),
  confirmDiscard: (names) => ipcRenderer.invoke(Ch.confirmDiscard, names),
  onMenu: (cb) => {
    ipcRenderer.on(Ch.menu, (_e, cmd: MenuCommand) => cb(cmd))
  },
  onOpenPaths: (cb) => {
    ipcRenderer.on(Ch.openPaths, (_e, paths: string[]) => cb(paths))
  },
  onExternalChange: (cb) => {
    ipcRenderer.on(Ch.externalChange, (_e, change: ExternalChange) => cb(change))
  },
  setFullScreen: (on) => ipcRenderer.invoke(Ch.setFullScreen, on),
  listSnippets: () => ipcRenderer.invoke(Ch.listSnippets),
  onFullScreenLeft: (cb) => {
    ipcRenderer.on(Ch.fullScreenLeft, () => cb())
  },
  onBeforeClose: (cb) => {
    ipcRenderer.on(Ch.beforeClose, async () => {
      let ok = false
      try {
        ok = await cb()
      } catch (err) {
        console.error('beforeClose failed', err)
      } finally {
        ipcRenderer.send(Ch.closeReady, ok)
      }
    })
  },
}

contextBridge.exposeInMainWorld('rfw', api)

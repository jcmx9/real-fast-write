import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, type BrowserWindow, dialog, Menu } from 'electron'
import { Ch } from '../shared/ipc'
import type {
  ExportResult,
  FontStatus,
  MenuCommand,
  Session,
  SessionPatch,
  Settings,
  StartupState,
} from '../shared/types'
import { addRecent, replaceRecent } from './cli'
import { runRfDocument } from './export'
import { fontDir, fontStatus } from './fonts'
import { LeaveTracker } from './fullscreen'
import { isExecutableFile, locateRfDocument } from './locate'
import { buildMenuTemplate } from './menu'
import {
  DEFAULT_SESSION,
  defaultSettings,
  loadJson,
  sanitizeSession,
  sanitizeSettings,
  saveJson,
} from './store'
import { NoteWatcher } from './watcher'
import { createMainWindow } from './window'

export function logSessionError(err: unknown): void {
  console.error('rf-write: Sitzung konnte nicht gespeichert werden', err)
}

export class AppContext {
  window: BrowserWindow | null = null
  /** App-requested fullscreen leaves still to come; reset with every new window. */
  fullScreenLeaves = new LeaveTracker()
  settings: Settings
  session: Session = DEFAULT_SESSION
  fonts: FontStatus = { dir: '', found: false, missing: [] }
  readonly reserved = new Set<string>()
  readonly watcher = new NoteWatcher((note) => this.send(Ch.externalChange, note))
  /** Paths the renderer may read or write: only ones the user opened or rf-write created. */
  private readonly allowed = new Set<string>()
  private readonly pending: string[] = []
  private rendererReady = false
  private closeApproved = false
  private quitting = false
  private initialized = false
  private sessionWrite: Promise<void> = Promise.resolve()
  private rfDocument: string | null = null

  constructor(
    private readonly userData: string,
    documentsDir: string,
  ) {
    this.settings = defaultSettings(documentsDir)
  }

  async load(): Promise<void> {
    this.settings = sanitizeSettings(await loadJson(this.file('settings.json')), this.settings)
    this.session = sanitizeSession(await loadJson(this.file('session.json')))
    this.allow([...this.session.tabs.map((t) => t.path), ...this.session.recent])
    this.fonts = await fontStatus(fontDir(process.platform, process.env, homedir()))
  }

  allow(paths: readonly string[]): void {
    for (const p of paths) this.allowed.add(p)
  }

  isAllowed(path: string): boolean {
    return this.allowed.has(path)
  }

  assertAllowed(path: string): void {
    if (!this.allowed.has(path)) throw new Error(`Zugriff verweigert: ${path}`)
  }

  createWindow(): void {
    const win = createMainWindow()
    this.window = win
    this.fullScreenLeaves = new LeaveTracker()
    this.rendererReady = false
    this.closeApproved = false
    win.on('close', (e) => {
      // Without a running renderer nobody could answer beforeClose: do not trap the window.
      if (this.closeApproved || !this.rendererReady) return
      e.preventDefault()
      this.send(Ch.beforeClose)
    })
    win.webContents.on('did-start-loading', () => {
      this.rendererReady = false
    })
    win.webContents.on('render-process-gone', () => {
      this.rendererReady = false
    })
    win.on('closed', () => {
      this.window = null
      this.rendererReady = false
    })
    win.on('leave-full-screen', () => {
      if (process.platform !== 'darwin') win.setMenuBarVisibility(true)
      // Only an OS-initiated leave ends Present; the app already knows about its own.
      if (this.fullScreenLeaves.onLeave()) this.send(Ch.fullScreenLeft)
    })
    this.installMenu()
  }

  startup(): StartupState {
    this.rendererReady = true
    return {
      session: this.session,
      openPaths: this.pending.splice(0),
      settings: this.settings,
      fonts: this.fonts,
    }
  }

  /** Called once settings and IPC handlers are ready; windows may be created from then on. */
  markInitialized(): void {
    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  /** Opens paths in the renderer now, or queues them until it has started. */
  openPaths(paths: readonly string[]): void {
    if (!paths.length) return
    this.allow(paths)
    if (this.window && this.rendererReady) this.send(Ch.openPaths, [...paths])
    else {
      this.pending.push(...paths)
      if (!this.window && this.initialized) this.createWindow()
    }
  }

  focus(): void {
    if (!this.initialized) return
    if (!this.window) {
      this.createWindow()
      return
    }
    if (this.window.isMinimized()) this.window.restore()
    this.window.focus()
  }

  closeReady(ok: boolean): void {
    if (!ok) {
      this.quitting = false
      return
    }
    this.closeApproved = true
    this.window?.close()
    if (this.quitting) app.quit()
  }

  markQuitting(): void {
    this.quitting = true
  }

  send(channel: string, ...args: unknown[]): void {
    this.window?.webContents.send(channel, ...args)
  }

  installMenu(): void {
    const template = buildMenuTemplate({
      platform: process.platform,
      isDev: !app.isPackaged,
      recent: this.session.recent,
      command: (c: MenuCommand) => this.send(Ch.menu, c),
      openRecent: (p) => this.openPaths([p]),
      clearRecent: () => void this.setRecent([]).catch(logSessionError),
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  async rememberRecent(path: string): Promise<void> {
    await this.setRecent(addRecent(this.session.recent, path))
  }

  async renamedRecent(from: string, to: string): Promise<void> {
    await this.setRecent(replaceRecent(this.session.recent, from, to))
  }

  async updateSession(patch: SessionPatch): Promise<void> {
    const tabs = patch.tabs?.filter((t) => this.isAllowed(t.path))
    // Copy only whitelisted keys: the renderer must never set e.g. `recent`.
    const next: Record<string, unknown> = { ...this.session }
    if (tabs) next.tabs = tabs
    if (patch.activeIndex !== undefined) next.activeIndex = patch.activeIndex
    if (patch.mode !== undefined) next.mode = patch.mode
    if (patch.view !== undefined) next.view = patch.view
    if (patch.zoom !== undefined) next.zoom = patch.zoom
    this.session = sanitizeSession(next)
    await this.persistSession()
  }

  async exportPdf(note: string): Promise<ExportResult> {
    const located = await this.resolveRfDocument()
    if (!located.found) return { kind: 'not-found', searched: located.searched }
    const result = await runRfDocument(located.found, note)
    // A start failure may mean rf-document moved: look it up again next time.
    if (result.kind === 'failed' && result.code === null) this.rfDocument = null
    return result
  }

  async confirmDiscard(names: readonly string[]): Promise<boolean> {
    const options = {
      type: 'warning' as const,
      buttons: ['Abbrechen', 'Verwerfen und schließen'],
      defaultId: 0,
      cancelId: 0,
      message: 'Nicht gespeicherte Änderungen',
      detail: `Diese Notizen konnten nicht gespeichert werden:\n${names.join('\n')}`,
    }
    const { response } = this.window
      ? await dialog.showMessageBox(this.window, options)
      : await dialog.showMessageBox(options)
    return response === 1
  }

  private async resolveRfDocument(): Promise<{ found: string | null; searched: string[] }> {
    if (this.rfDocument) return { found: this.rfDocument, searched: [] }
    const result = await locateRfDocument({
      platform: process.platform,
      env: process.env,
      home: homedir(),
      configured: this.settings.rfDocumentPath,
      isFile: isExecutableFile,
    })
    this.rfDocument = result.found
    return result
  }

  private async setRecent(recent: string[]): Promise<void> {
    this.session = { ...this.session, recent }
    this.allow(recent)
    await this.persistSession()
    this.installMenu()
  }

  /** Serializes session.json writes; a failed write does not break the chain. */
  private persistSession(): Promise<void> {
    const write = this.sessionWrite.then(() => saveJson(this.file('session.json'), this.session))
    this.sessionWrite = write.catch(logSessionError)
    return write
  }

  private file(name: string): string {
    return join(this.userData, name)
  }
}

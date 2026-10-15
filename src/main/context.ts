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
  SessionTab,
  Settings,
  StartupState,
} from '../shared/types'
import { addRecent, replaceRecent } from './cli'
import { runRfDocument } from './export'
import { canonicalPath, canonicalPaths, sameFile } from './files'
import { fontDir, fontStatus } from './fonts'
import { FullScreenOwner } from './fullscreen'
import { isExecutableFile, locateRfDocument } from './locate'
import { buildMenuTemplate, PresentKeyGuard } from './menu'
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
  /** Whether the app owns the window's fullscreen; reset with every new window. */
  fullScreen = new FullScreenOwner()
  /** Tells a held Present shortcut's auto-repeats from deliberate presses (menu.ts). */
  private readonly presentKey = new PresentKeyGuard(process.platform === 'darwin')
  settings: Settings
  session: Session = DEFAULT_SESSION
  fonts: FontStatus = { dir: '', found: false, missing: [] }
  readonly reserved = new Set<string>()
  readonly watcher = new NoteWatcher((change) => this.send(Ch.externalChange, change))
  /** Paths the renderer may read or write: only ones the user opened or rf-write created. */
  private readonly allowed = new Set<string>()
  private readonly pending: string[] = []
  private rendererReady = false
  private closeApproved = false
  /** A beforeClose was sent and not answered yet; answers without one are stale and ignored. */
  private closeRequested = false
  private quitting = false
  private initialized = false
  private sessionWrite: Promise<void> = Promise.resolve()
  /** Keeps async canonicalisation from reordering openPaths/updateSession calls. */
  private openQueue: Promise<void> = Promise.resolve()
  private sessionQueue: Promise<void> = Promise.resolve()
  private rfDocument: string | null = null

  constructor(
    private readonly userData: string,
    documentsDir: string,
  ) {
    this.settings = defaultSettings(documentsDir)
  }

  async load(): Promise<void> {
    this.settings = sanitizeSettings(await loadJson(this.file('settings.json')), this.settings)
    const raw = sanitizeSession(await loadJson(this.file('session.json')))
    const restored = await canonicalTabs(raw.tabs, raw.activeIndex)
    this.session = { ...raw, ...restored, recent: await canonicalPaths(raw.recent) }
    this.allow([...this.session.tabs.map((t) => t.path), ...this.session.recent])
    this.fonts = await fontStatus(fontDir(process.platform, process.env, homedir()))
  }

  /** Adds paths that are already canonical (see `canonicalPath`). */
  allow(paths: readonly string[]): void {
    for (const p of paths) this.allowed.add(p)
  }

  /** Exact lookup of a canonical path. */
  isAllowed(path: string): boolean {
    return this.allowed.has(path)
  }

  /**
   * Canonicalises `path` and returns the canonical form if it is allowed, else throws.
   * An allowed path whose canonical spelling now differs only in case (the note or a parent
   * folder was renamed outside, e.g. `a.md` → `A.md` in Finder or Explorer) is the same file:
   * the new spelling is allowed too and returned, so the caller can follow it.
   */
  async assertAllowed(path: string): Promise<string> {
    const canonical = await canonicalPath(path)
    if (this.allowed.has(canonical)) return canonical
    if (
      this.allowed.has(path) &&
      canonical.toLowerCase() === path.toLowerCase() &&
      (await sameFile(path, canonical))
    ) {
      this.allow([canonical])
      return canonical
    }
    throw new Error(`Zugriff verweigert: ${path}`)
  }

  createWindow(): void {
    const win = createMainWindow()
    this.window = win
    this.fullScreen = new FullScreenOwner()
    this.rendererReady = false
    this.closeApproved = false
    this.closeRequested = false
    win.on('close', (e) => {
      // Without a running renderer nobody could answer beforeClose: do not trap the window.
      if (this.closeApproved || !this.rendererReady) return
      e.preventDefault()
      this.closeRequested = true
      this.send(Ch.beforeClose)
    })
    win.webContents.on('before-input-event', (_e, input) => this.presentKey.onInput(input))
    win.webContents.on('did-start-loading', () => {
      this.rendererReady = false
    })
    win.webContents.on('render-process-gone', () => {
      this.rendererReady = false
    })
    win.on('closed', () => {
      this.fullScreen.dispose()
      this.window = null
      this.rendererReady = false
    })
    win.on('enter-full-screen', () => {
      // A refused enter that arrives after Present already ended: Edit is never fullscreen.
      if (this.fullScreen.onEnter()) win.setFullScreen(false)
    })
    win.on('leave-full-screen', () => {
      // Only an OS-initiated leave ends Present; the app already knows about its own (and
      // restored the menu bar on request, so a late leave never shows it in a new Present).
      if (!this.fullScreen.onLeave()) return
      if (process.platform !== 'darwin') win.setMenuBarVisibility(true)
      this.send(Ch.fullScreenLeft)
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

  /**
   * Opens paths in the renderer now, or queues them until it has started. Paths are
   * canonicalised first, so two spellings of one file open one tab.
   */
  openPaths(paths: readonly string[]): Promise<void> {
    const run = this.openQueue.then(async () => {
      if (!paths.length) return
      const canonical = await canonicalPaths(paths)
      this.allow(canonical)
      if (this.window && this.rendererReady) this.send(Ch.openPaths, canonical)
      else {
        this.pending.push(...canonical.filter((p) => !this.pending.includes(p)))
        if (!this.window && this.initialized) this.createWindow()
      }
    })
    this.openQueue = run.catch((err) => console.error('rf-write: Öffnen fehlgeschlagen', err))
    return run
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
    // A repeated close request is answered twice: only the first answer counts.
    if (!this.closeRequested) return
    this.closeRequested = false
    if (!ok) {
      this.quitting = false
      return
    }
    this.closeApproved = true
    if (this.window && !this.window.isDestroyed()) this.window.close()
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
      openRecent: (p) => void this.openPaths([p]).catch(() => undefined),
      clearRecent: () => void this.setRecent([]).catch(logSessionError),
      presentKey: this.presentKey,
    })
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  async rememberRecent(path: string): Promise<void> {
    await this.setRecent(addRecent(this.session.recent, path))
  }

  async renamedRecent(from: string, to: string): Promise<void> {
    await this.setRecent(replaceRecent(this.session.recent, from, to))
  }

  updateSession(patch: SessionPatch): Promise<void> {
    const run = this.sessionQueue.then(() => this.applySessionPatch(patch))
    this.sessionQueue = run.catch(() => undefined)
    return run
  }

  private async applySessionPatch(patch: SessionPatch): Promise<void> {
    // Sanitize first: the patch comes from the renderer and may be malformed.
    const clean = sanitizeSession({ tabs: patch.tabs, activeIndex: patch.activeIndex })
    const canonical = patch.tabs ? await canonicalTabs(clean.tabs, clean.activeIndex) : null
    // Copy only whitelisted keys: the renderer must never set e.g. `recent`.
    const next: Record<string, unknown> = { ...this.session }
    if (canonical) {
      const kept = canonical.tabs.filter((t) => this.isAllowed(t.path))
      const active = canonical.tabs[canonical.activeIndex]?.path
      next.tabs = kept
      next.activeIndex = Math.max(
        0,
        kept.findIndex((t) => t.path === active),
      )
    } else if (patch.activeIndex !== undefined) next.activeIndex = patch.activeIndex
    if (patch.mode !== undefined) next.mode = patch.mode
    if (patch.view !== undefined) next.view = patch.view
    if (patch.zoom !== undefined) next.zoom = patch.zoom
    if (patch.outline !== undefined) next.outline = patch.outline
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

/**
 * Canonicalises tab paths and drops later duplicates (the first keeps its `headerHidden`);
 * the active index follows its tab.
 */
async function canonicalTabs(
  tabs: readonly SessionTab[],
  activeIndex: number,
): Promise<{ tabs: SessionTab[]; activeIndex: number }> {
  const paths = await Promise.all(tabs.map((t) => canonicalPath(t.path)))
  const out: SessionTab[] = []
  const index = new Map<string, number>()
  paths.forEach((path, i) => {
    if (!index.has(path)) {
      index.set(path, out.length)
      out.push({ path, headerHidden: tabs[i]?.headerHidden === true })
    }
  })
  const active = paths[activeIndex]
  return { tabs: out, activeIndex: active === undefined ? 0 : (index.get(active) ?? 0) }
}

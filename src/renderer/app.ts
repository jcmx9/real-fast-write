import { closeCompletion } from '@codemirror/autocomplete'
import { redo, selectAll, undo } from '@codemirror/commands'
import { foldCode, unfoldAll, unfoldCode } from '@codemirror/language'
import type { EditorState, TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { ExportResult, MenuCommand, Mode, NoteFile, View } from '../shared/types'
import { AutosaveScheduler } from './editor/autosave'
import { headerHidden, headerToggleSpec, moveOutOfHeader } from './editor/header'
import { modeCompartment, modeExtensions } from './editor/mode'
import { insertPageBreak } from './editor/pagebreak'
import { foldAllSections } from './editor/sections'
import { createState, serializeDoc, viewCompartment, viewExtensions } from './editor/setup'
import { snippetRegistry } from './editor/snippets'
import { type Tab, TabStore } from './tabs/tab-store'
import { editTarget } from './ui/edit-target'
import { InfoLine } from './ui/infoline'
import { Notices } from './ui/notices'
import { askText } from './ui/prompt'
import { SAVE_STATE_LABEL, type SaveState, StatusLine } from './ui/statusline'
import { TabBar } from './ui/tabbar'
import { editorSizes, handleZoomKey, zoomIn, zoomOut } from './ui/zoom'
import { fileName } from './util/path'
import { SerialQueue } from './util/serial'

const INSTALL_HINT = [
  'macOS/Linux:',
  'curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.sh | bash',
  '',
  'Windows (PowerShell):',
  'irm https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.ps1 | iex',
].join('\n')

const CONFLICT_ERROR = 'Externe Änderung – bitte im Hinweis entscheiden'

const MAX_SAVE_ROUNDS = 3

const isMac = navigator.userAgent.includes('Mac')

export interface AppRoot {
  tabbar: HTMLElement
  editor: HTMLElement
  empty: HTMLElement
  status: HTMLElement
  infoline: HTMLElement
  notices: HTMLElement
}

export class App {
  private readonly rfw = window.rfw
  private readonly store = new TabStore()
  private readonly autosave = new AutosaveScheduler(() => this.saveAll())
  private readonly editor: EditorView
  private readonly tabBar: TabBar
  private readonly status: StatusLine
  private readonly notices: Notices
  private readonly infoLine: InfoLine
  private view: View = 'preview'
  private mode: Mode = 'edit'
  private zoom = { edit: 1, present: 1 }
  private presentFactor = 1.6
  /**
   * Serializes fullscreen requests so fast toggles reach main in order. Main owns the
   * fullscreen decision: it only leaves a fullscreen the app started (a user's own
   * fullscreen survives Present) and never reports its own leave as an OS leave.
   */
  private readonly fullScreenOps = new SerialQueue()
  private shownId: number | null = null
  private readonly saveErrors = new Map<number, string>()
  private readonly conflicts = new Set<number>()
  private readonly saving = new Map<number, Promise<boolean>>()
  private sessionTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly root: AppRoot) {
    this.editor = new EditorView({
      parent: root.editor,
      state: createState('', '\n', this.view),
      dispatchTransactions: (trs, view) => {
        view.update(trs)
        // Route to the tab actually shown, not store.active (which can run ahead of show()).
        const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
        if (!tab) return
        this.store.updateState(tab.id, view.state)
        if (trs.some((tr) => tr.docChanged)) {
          this.autosave.touch()
          this.refresh()
        }
      },
    })
    this.tabBar = new TabBar(root.tabbar, {
      select: (i) => this.activate(i),
      close: (id) => void this.closeTab(id),
    })
    this.status = new StatusLine(root.status, { exportPdf: () => void this.exportPdf() })
    this.notices = new Notices(root.notices)
    this.infoLine = new InfoLine(root.infoline, {
      selectTab: (i) => this.activate(i),
      exitPresent: () => void this.exitPresent(),
      zoomIn: () => this.setZoom(zoomIn(this.zoom[this.mode])),
      zoomOut: () => this.setZoom(zoomOut(this.zoom[this.mode])),
    })
    this.rfw.onFullScreenLeft(() => {
      if (this.mode === 'present') void this.exitPresent(false)
    })
    root.empty
      .querySelector('[data-action=new]')
      ?.addEventListener('click', () => void this.newNote())
    root.empty
      .querySelector('[data-action=open]')
      ?.addEventListener('click', () => void this.open())
    this.rfw.onMenu((cmd) => void this.command(cmd))
    this.rfw.onOpenPaths((paths) => void this.openPaths(paths))
    this.rfw.onExternalChange((note) => this.externalChange(note))
    this.rfw.onBeforeClose(() => this.beforeClose())
    window.addEventListener('keydown', (e) => this.globalKeys(e))
    window.addEventListener('blur', () => void this.autosave.flush())
    window.addEventListener('focus', () => void this.reloadSnippets())
  }

  private async reloadSnippets(): Promise<void> {
    try {
      snippetRegistry.setUser(await this.rfw.listSnippets())
    } catch (err) {
      console.error('rf-write: Snippets konnten nicht geladen werden', err)
    }
  }

  async start(): Promise<void> {
    const startup = await this.rfw.startup()
    if (!startup.fonts.found) {
      this.notices.panel(
        'Schriften nicht gefunden',
        `Die Schriften von real-fast-document fehlen in:\n${startup.fonts.dir}\n\nrf-write nutzt Systemschriften, bis rf-document installiert ist.\n\n${INSTALL_HINT}`,
      )
    }
    this.view = startup.session.view
    this.zoom = { ...startup.session.zoom }
    this.presentFactor = startup.settings.presentFontFactor
    this.applyZoom()
    for (const t of startup.session.tabs) await this.openPath(t.path, t.headerHidden)
    const activePath = startup.session.tabs[startup.session.activeIndex]?.path
    const activeTab = activePath === undefined ? undefined : this.store.findByPath(activePath)
    if (activeTab) this.store.activate(this.store.all.indexOf(activeTab))
    for (const p of startup.openPaths) await this.openPath(p)
    if (this.store.all.length === 0) await this.newNote()
    else this.show()
    void this.reloadSnippets()
  }

  // ── commands ────────────────────────────────────────────────────────────

  private async command(cmd: MenuCommand): Promise<void> {
    if (
      this.mode === 'present' &&
      (cmd === 'export' || cmd === 'toggle-view' || cmd === 'toggle-header')
    ) {
      this.notices.toast('Im Präsentationsmodus nicht verfügbar – Esc beendet ihn.')
      return
    }
    switch (cmd) {
      case 'new':
        return this.newNote()
      case 'open':
        return this.open()
      case 'rename':
        return this.rename()
      case 'close-tab': {
        const tab = this.store.active
        if (tab) await this.closeTab(tab.id)
        return
      }
      case 'export':
        return this.exportPdf()
      case 'next-tab':
        await this.autosave.flush()
        this.store.next()
        return this.show()
      case 'prev-tab':
        await this.autosave.flush()
        this.store.prev()
        return this.show()
      case 'undo':
        return this.editCommand('undo', undo)
      case 'redo':
        return this.editCommand('redo', redo)
      case 'select-all':
        return this.editCommand('selectAll', selectAll)
      case 'insert-pagebreak':
        return this.editCommand('insertPageBreak', insertPageBreak)
      case 'toggle-view':
        return this.setView(this.view === 'code' ? 'preview' : 'code')
      case 'toggle-header':
        return this.toggleHeader()
      case 'fold':
        foldCode(this.editor)
        this.editor.focus()
        return
      case 'unfold':
        unfoldCode(this.editor)
        this.editor.focus()
        return
      case 'fold-all':
        foldAllSections(this.editor)
        this.editor.focus()
        return
      case 'unfold-all':
        unfoldAll(this.editor)
        this.editor.focus()
        return
      case 'zoom-in':
        return this.setZoom(zoomIn(this.zoom[this.mode]))
      case 'zoom-out':
        return this.setZoom(zoomOut(this.zoom[this.mode]))
      case 'zoom-reset':
        return this.setZoom(1)
      case 'toggle-present':
        // A held or hammered shortcut must not flap while a fullscreen request is in flight.
        if (this.fullScreenOps.busy) return
        return this.mode === 'present' ? this.exitPresent() : this.enterPresent()
    }
  }

  /** Edit commands go to CodeMirror unless another text field (dialog, panel) has focus. */
  private editCommand(
    name: 'undo' | 'redo' | 'selectAll' | 'insertPageBreak',
    run: (v: EditorView) => unknown,
  ): void {
    const target = editTarget(
      document.activeElement,
      this.editor.dom,
      document.querySelector('dialog[open]') !== null,
    )
    if (target === 'blocked') return
    if (target === 'field') {
      // A page break only makes sense in the document; other fields ignore the shortcut.
      if (name !== 'insertPageBreak') document.execCommand(name)
      return
    }
    run(this.editor)
    this.editor.focus()
  }

  private globalKeys(e: KeyboardEvent): void {
    if (
      this.mode === 'present' &&
      e.key === 'Escape' &&
      !e.defaultPrevented &&
      !document.querySelector('dialog[open]')
    ) {
      e.preventDefault()
      void this.exitPresent()
      return
    }
    const zoomed = handleZoomKey(e, isMac, (action) => {
      const z = this.zoom[this.mode]
      this.setZoom(action === 'in' ? zoomIn(z) : action === 'out' ? zoomOut(z) : 1)
    })
    if (zoomed) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      this.activate(Number(e.key) - 1)
    }
  }

  private setZoom(next: number): void {
    this.zoom[this.mode] = Math.min(3, Math.max(0.5, next))
    this.applyZoom()
    this.refresh()
    this.syncMain()
  }

  /** Scales the editor via CSS custom properties (never Electron page zoom). */
  private applyZoom(): void {
    const { body, code } = editorSizes(this.mode, this.zoom[this.mode], this.presentFactor)
    this.root.editor.style.setProperty('--rf-body-size', body)
    this.root.editor.style.setProperty('--rf-code-size', code)
    this.editor.requestMeasure()
  }

  private activate(index: number): void {
    void this.autosave.flush()
    this.store.activate(index)
    this.show()
  }

  private async newNote(): Promise<void> {
    const path = await this.rfw.newNotePath()
    this.store.add({
      path,
      state: createState('', '\n', this.effectiveView(), false, this.mode),
      bom: false,
      eol: '\n',
      onDisk: false,
    })
    this.show()
  }

  private async open(): Promise<void> {
    await this.openPaths(await this.rfw.showOpenDialog())
  }

  private async openPaths(paths: readonly string[]): Promise<void> {
    for (const p of paths) await this.openPath(p)
    this.show()
  }

  private async openPath(path: string, hideHeader = false): Promise<boolean> {
    const open = this.store.findByPath(path)
    if (open) {
      this.store.activate(this.store.all.indexOf(open))
      return true
    }
    const res = await this.rfw.readNote(path)
    if ('error' in res) {
      this.notices.panel('Nicht geöffnet', `${path}\n\n${res.error}`)
      return false
    }
    this.store.add({
      path,
      state: createState(res.text, res.eol, this.effectiveView(), hideHeader, this.mode),
      bom: res.bom,
      eol: res.eol,
      onDisk: true,
      headerHidden: hideHeader,
    })
    return true
  }

  /** Present always shows Preview; the per-tab Code/Preview choice is kept in this.view. */
  private effectiveView(): View {
    return this.mode === 'present' ? 'preview' : this.view
  }

  /** Code <-> Preview for every tab; the documents are never touched. */
  private setView(view: View): void {
    if (view === this.view) return
    this.view = view
    this.reconfigureAll()
    this.syncMain()
    this.editor.focus()
  }

  /** Applies view + mode to every tab; a cursor that would end inside a collapsed header moves out. */
  private reconfigureAll(): void {
    const effects = [
      viewCompartment.reconfigure(viewExtensions(this.effectiveView())),
      modeCompartment.reconfigure(modeExtensions(this.mode)),
    ]
    const collapses = (state: EditorState) =>
      this.mode === 'present' || (this.effectiveView() === 'preview' && state.field(headerHidden))
    for (const tab of this.store.all) {
      const shown = tab.id === this.shownId
      const state = shown ? this.editor.state : tab.state
      const spec: TransactionSpec = { ...(collapses(state) ? moveOutOfHeader(state) : {}), effects }
      if (shown) this.editor.dispatch(spec)
      else this.store.updateState(tab.id, state.update(spec).state)
    }
  }

  private async enterPresent(): Promise<void> {
    if (this.mode === 'present' || this.shownId === null) return
    this.mode = 'present'
    this.reconfigureAll()
    document.body.classList.add('rf-mode-present')
    this.root.tabbar.hidden = true
    this.root.status.hidden = true
    this.root.infoline.hidden = false
    this.infoLine.start()
    this.applyZoom()
    this.refresh()
    this.editor.focus()
    await this.fullScreenOps.run(async () => {
      try {
        await this.rfw.setFullScreen(true)
      } catch (e) {
        console.error('setFullScreen(true) failed', e)
        this.notices.toast('Vollbild nicht verfügbar')
      }
    })
  }

  /** fullScreen=false when the OS already left fullscreen (avoid a second toggle). */
  private async exitPresent(fullScreen = true): Promise<void> {
    if (this.mode !== 'present') return
    this.mode = 'edit'
    this.reconfigureAll()
    document.body.classList.remove('rf-mode-present')
    this.root.tabbar.hidden = false
    this.root.status.hidden = false
    this.root.infoline.hidden = true
    this.infoLine.stop()
    this.applyZoom()
    this.refresh()
    this.editor.focus()
    await this.fullScreenOps.run(async () => {
      // Sent even for a user's own fullscreen: main keeps that and only restores the menu bar.
      if (!fullScreen) return
      try {
        await this.rfw.setFullScreen(false)
      } catch (e) {
        console.error('setFullScreen(false) failed', e)
      }
    })
  }

  private toggleHeader(): void {
    const tab = this.shownId === null ? undefined : this.store.get(this.shownId)
    if (!tab) return
    if (this.view !== 'preview') {
      this.notices.toast('Der YAML-Header lässt sich nur in der Preview ausblenden.')
      return
    }
    const hide = !this.editor.state.field(headerHidden)
    this.editor.dispatch(headerToggleSpec(this.editor.state, hide))
    tab.headerHidden = hide
    this.syncMain()
    this.editor.focus()
  }

  private async closeTab(id: number): Promise<void> {
    const tab = this.store.get(id)
    if (!tab) return
    let saved = true
    for (let i = 0; i < MAX_SAVE_ROUNDS && this.store.isDirty(tab); i++) {
      saved = await this.saveTab(tab)
      if (!saved) break
    }
    if (!saved || this.store.isDirty(tab)) {
      if (!(await this.rfw.confirmDiscard([fileName(tab.path)]))) return
    }
    if (!tab.onDisk) {
      try {
        await this.rfw.releasePath(tab.path)
      } catch {
        // closing must not be blocked by a failed release
      }
    }
    this.store.close(id)
    this.notices.dismiss(tab.path)
    this.saveErrors.delete(id)
    this.conflicts.delete(id)
    this.saving.delete(id)
    // Present never shows the empty state.
    if (this.mode === 'present' && this.store.all.length === 0) await this.exitPresent()
    this.show()
  }

  private async rename(): Promise<void> {
    const tab = this.store.active
    if (!tab) return
    const name = await askText('Umbenennen', 'Neuer Dateiname', fileName(tab.path))
    if (!name) return
    if (!(await this.saveTab(tab, true))) {
      this.notices.panel(
        'Umbenennen nicht möglich',
        `Die Notiz konnte nicht gespeichert werden:\n${this.saveErrors.get(tab.id) ?? ''}`,
      )
      return
    }
    // Inside the tab's save chain, so an autosave cannot interleave with the rename.
    const prev = this.saving.get(tab.id) ?? Promise.resolve(true)
    const renamed = prev.then(async () => {
      try {
        const r = await this.rfw.renameNote(tab.path, name)
        // Switch the path inside the chain: queued saves must target the new file.
        if (r.ok) this.store.setPath(tab.id, r.path)
        return r
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
      }
    })
    this.saving.set(
      tab.id,
      renamed.then(() => true),
    )
    const res = await renamed
    if (!res.ok) {
      this.notices.panel('Umbenennen nicht möglich', res.error)
      return
    }
    this.show()
  }

  private async exportPdf(): Promise<void> {
    const tab = this.store.active
    if (!tab || this.status.exporting) return
    this.status.setExporting(true)
    try {
      if (!(await this.saveTab(tab, true))) {
        this.notices.panel(
          'Export abgebrochen',
          `Die Notiz konnte nicht gespeichert werden:\n${this.saveErrors.get(tab.id) ?? ''}`,
        )
        return
      }
      this.showExport(await this.rfw.exportPdf(tab.path))
    } catch (e) {
      this.notices.panel('Export fehlgeschlagen', e instanceof Error ? e.message : String(e))
    } finally {
      this.status.setExporting(false)
    }
  }

  private showExport(r: ExportResult): void {
    if (r.kind === 'ok') this.notices.toast(r.message)
    else if (r.kind === 'failed') this.notices.panel('Export fehlgeschlagen', r.stderr)
    else
      this.notices.panel(
        'rf-document nicht gefunden',
        `Gesucht in:\n${r.searched.join('\n')}\n\nInstallation:\n${INSTALL_HINT}`,
      )
  }

  // ── saving ──────────────────────────────────────────────────────────────

  /** force: also create a new note's file when it is still empty (rename, export). */
  private saveTab(tab: Tab, force = false): Promise<boolean> {
    // Chain per tab so forced saves never overlap an autosave of the same tab.
    const prev = this.saving.get(tab.id) ?? Promise.resolve(true)
    const next = prev.then(() => this.writeTab(tab, force))
    this.saving.set(
      tab.id,
      next.catch(() => false),
    )
    return next
  }

  private async writeTab(tab: Tab, force: boolean): Promise<boolean> {
    if (!this.store.isDirty(tab) && (tab.onDisk || !force)) return true
    if (this.conflicts.has(tab.id)) {
      this.saveErrors.set(tab.id, CONFLICT_ERROR)
      this.refresh()
      return false
    }
    const doc = tab.state.doc
    let res: Awaited<ReturnType<typeof this.rfw.saveNote>>
    try {
      res = await this.rfw.saveNote(tab.path, serializeDoc(doc, tab.eol), tab.bom)
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) {
      this.saveErrors.set(tab.id, res.error)
      this.refresh()
      return false
    }
    const firstSave = !tab.onDisk
    this.store.markSaved(tab.id, doc)
    this.saveErrors.delete(tab.id)
    if (firstSave) this.syncMain()
    this.refresh()
    return true
  }

  private async saveAll(): Promise<boolean> {
    let ok = true
    for (const tab of [...this.store.all]) {
      if (!(await this.saveTab(tab))) ok = false
    }
    return ok
  }

  private async beforeClose(): Promise<boolean> {
    let saved = await this.autosave.flush()
    // Typing during the save leaves the tab dirty again: save again (bounded).
    for (let i = 0; i < MAX_SAVE_ROUNDS && this.store.all.some((t) => this.store.isDirty(t)); i++) {
      saved = await this.saveAll()
      if (!saved) break
    }
    try {
      await this.persistSession()
    } catch (e) {
      // Closing must not depend on the session write.
      console.error('persistSession failed', e)
    }
    if (saved) return true
    const names = this.store.all.filter((t) => this.store.isDirty(t)).map((t) => fileName(t.path))
    return this.rfw.confirmDiscard(names)
  }

  // ── external changes ────────────────────────────────────────────────────

  private externalChange(note: NoteFile): void {
    const tab = this.store.findByPath(note.path)
    if (!tab) return
    if (!this.store.isDirty(tab)) {
      this.clearConflict(tab.id)
      this.reload(tab, note)
      return
    }
    this.conflicts.add(tab.id)
    this.saveErrors.set(tab.id, CONFLICT_ERROR)
    this.refresh()
    this.notices.banner(
      `„${fileName(note.path)}“ wurde außerhalb von rf-write geändert.`,
      [
        {
          label: 'Neu laden (meine Änderungen verwerfen)',
          run: () => void this.reloadFromDisk(tab),
        },
        {
          label: 'Meine behalten',
          run: () => {
            this.clearConflict(tab.id)
            this.refresh()
            this.autosave.touch()
          },
        },
      ],
      note.path,
    )
  }

  private clearConflict(id: number): void {
    this.conflicts.delete(id)
    this.saveErrors.delete(id)
  }

  private async reloadFromDisk(tab: Tab): Promise<void> {
    const res = await this.rfw.readNote(tab.path)
    if ('error' in res) {
      this.notices.panel('Neu laden nicht möglich', `${tab.path}\n\n${res.error}`)
      return
    }
    this.clearConflict(tab.id)
    this.reload(tab, res)
  }

  private reload(tab: Tab, note: NoteFile): void {
    const state = createState(
      note.text,
      note.eol,
      this.effectiveView(),
      tab.headerHidden,
      this.mode,
    )
    tab.bom = note.bom
    tab.eol = note.eol
    this.store.updateState(tab.id, state)
    this.store.markSaved(tab.id, state.doc)
    if (this.shownId === tab.id) this.editor.setState(state)
    this.refresh()
  }

  // ── rendering ───────────────────────────────────────────────────────────

  private show(): void {
    const tab = this.store.active
    this.root.empty.hidden = tab !== null
    this.root.editor.hidden = tab === null
    if (tab && tab.id !== this.shownId) {
      // Close an open snippet list in the tab being left (routed to shownId), so it does not
      // reappear there later and a stray Enter inserts a snippet typed long ago.
      if (this.shownId !== null) closeCompletion(this.editor)
      this.editor.setState(tab.state)
      this.editor.focus()
    }
    this.shownId = tab?.id ?? null
    this.refresh()
    this.syncMain()
  }

  private refresh(): void {
    const tab = this.store.active
    this.tabBar.render(this.store.all, this.store.activeIndex, (t) => this.store.isDirty(t))
    const error = tab ? (this.saveErrors.get(tab.id) ?? null) : null
    let state: SaveState = 'saved'
    if (error) state = 'error'
    else if (tab && this.store.isDirty(tab)) state = 'dirty'
    else if (tab && !tab.onDisk) state = 'new'
    this.status.render(tab ? fileName(tab.path) : null, state, error)
    document.title = tab
      ? `${fileName(tab.path)}${state === 'dirty' ? ' •' : ''} – rf-write`
      : 'rf-write'
    if (this.mode === 'present') {
      this.infoLine.render(
        this.store.all.map((t) => ({ name: fileName(t.path), dirty: this.store.isDirty(t) })),
        this.store.activeIndex,
        state === 'error' && error
          ? `${SAVE_STATE_LABEL.error}: ${error}`
          : SAVE_STATE_LABEL[state],
        this.zoom.present,
      )
    }
  }

  /** Tells main which files to watch and schedules a session write. */
  private syncMain(): void {
    void this.rfw.watch(this.store.all.filter((t) => t.onDisk).map((t) => t.path))
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => void this.persistSession(), 300)
  }

  private async persistSession(): Promise<void> {
    if (this.sessionTimer) clearTimeout(this.sessionTimer)
    this.sessionTimer = null
    const tabs = this.store.toSession()
    const activePath = this.store.active?.path
    const activeIndex = Math.max(
      0,
      tabs.findIndex((t) => t.path === activePath),
    )
    await this.rfw.saveSession({ tabs, activeIndex, view: this.view, zoom: this.zoom })
  }
}

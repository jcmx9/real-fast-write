import { redo, selectAll, undo } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'
import type { ExportResult, MenuCommand, NoteFile, View } from '../shared/types'
import { AutosaveScheduler } from './editor/autosave'
import { createState, serializeDoc } from './editor/setup'
import { type Tab, TabStore } from './tabs/tab-store'
import { Notices } from './ui/notices'
import { askText } from './ui/prompt'
import { type SaveState, StatusLine } from './ui/statusline'
import { TabBar } from './ui/tabbar'
import { fileName } from './util/path'

const INSTALL_HINT = [
  'macOS/Linux:',
  'curl -fsSL https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.sh | bash',
  '',
  'Windows (PowerShell):',
  'irm https://raw.githubusercontent.com/jcmx9/real-fast-document/main/scripts/bootstrap.ps1 | iex',
].join('\n')

const CONFLICT_ERROR = 'Externe Änderung – bitte im Hinweis entscheiden'

const isMac = navigator.userAgent.includes('Mac')

export interface AppRoot {
  tabbar: HTMLElement
  editor: HTMLElement
  empty: HTMLElement
  status: HTMLElement
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
  private view: View = 'preview'
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
  }

  async start(): Promise<void> {
    const startup = await this.rfw.startup()
    this.view = startup.session.view
    for (const t of startup.session.tabs) await this.openPath(t.path, t.headerHidden)
    const activePath = startup.session.tabs[startup.session.activeIndex]?.path
    const activeTab = activePath === undefined ? undefined : this.store.findByPath(activePath)
    if (activeTab) this.store.activate(this.store.all.indexOf(activeTab))
    for (const p of startup.openPaths) await this.openPath(p)
    if (this.store.all.length === 0) await this.newNote()
    else this.show()
  }

  // ── commands ────────────────────────────────────────────────────────────

  private async command(cmd: MenuCommand): Promise<void> {
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
    }
  }

  /** Edit commands go to CodeMirror unless another text field (dialog, panel) has focus. */
  private editCommand(name: 'undo' | 'redo' | 'selectAll', run: (v: EditorView) => unknown): void {
    const el = document.activeElement
    const textField =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable && !this.editor.dom.contains(el))
    if (textField) {
      document.execCommand(name)
      return
    }
    run(this.editor)
    this.editor.focus()
  }

  private globalKeys(e: KeyboardEvent): void {
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      this.activate(Number(e.key) - 1)
    }
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
      state: createState('', '\n', this.view),
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

  private async openPath(path: string, headerHidden = false): Promise<boolean> {
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
      state: createState(res.text, res.eol, this.view),
      bom: res.bom,
      eol: res.eol,
      onDisk: true,
      headerHidden,
    })
    return true
  }

  private async closeTab(id: number): Promise<void> {
    const tab = this.store.get(id)
    if (!tab) return
    if (this.store.isDirty(tab) && !(await this.saveTab(tab))) {
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
    let res: Awaited<ReturnType<typeof this.rfw.renameNote>>
    try {
      res = await this.rfw.renameNote(tab.path, name)
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!res.ok) {
      this.notices.panel('Umbenennen nicht möglich', res.error)
      return
    }
    this.store.setPath(tab.id, res.path)
    this.show()
  }

  private async exportPdf(): Promise<void> {
    const tab = this.store.active
    if (!tab || this.status.exporting) return
    if (!(await this.saveTab(tab, true))) {
      this.notices.panel(
        'Export abgebrochen',
        `Die Notiz konnte nicht gespeichert werden:\n${this.saveErrors.get(tab.id) ?? ''}`,
      )
      return
    }
    this.status.setExporting(true)
    try {
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
    const saved = await this.autosave.flush()
    await this.persistSession()
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
    const state = createState(note.text, note.eol, this.view)
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
    await this.rfw.saveSession({ tabs, activeIndex, view: this.view })
  }
}

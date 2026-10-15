/** Line-ending style of a note. 'mixed' keeps every byte as found. */
export type Eol = '\n' | '\r\n' | 'mixed'

export interface NoteFile {
  path: string
  /** Text without BOM. */
  text: string
  bom: boolean
  eol: Eol
  /** sha256 of the bytes on disk. */
  hash: string
}

/** What the watcher reports for an open note that changed on disk. */
export type ExternalChange =
  | { kind: 'changed'; note: NoteFile }
  | { kind: 'unreadable'; path: string; reason: 'encoding' | 'error'; message: string }
  | { kind: 'deleted'; path: string }

export interface Settings {
  defaultFolder: string
  snippetFolder: string
  /** Empty = locate automatically. */
  rfDocumentPath: string
  presentFontFactor: number
}

export type Mode = 'edit' | 'present'
export type View = 'code' | 'preview'

export interface SessionTab {
  path: string
  headerHidden: boolean
}

export interface Session {
  tabs: SessionTab[]
  activeIndex: number
  mode: Mode
  view: View
  zoom: { edit: number; present: number }
  /** Outline sidebar on/off per mode. */
  outline: { edit: boolean; present: boolean }
  recent: string[]
}

export type SessionPatch = Partial<
  Pick<Session, 'tabs' | 'activeIndex' | 'mode' | 'view' | 'zoom' | 'outline'>
>

export interface FontStatus {
  dir: string
  found: boolean
  missing: string[]
}

export interface StartupState {
  session: Session
  openPaths: string[]
  settings: Settings
  fonts: FontStatus
}

export type SaveResult =
  /** path: the note's canonical path when it differs from the one passed (renamed outside). */
  | { ok: true; hash: string; path?: string }
  | { ok: false; error: string }
  /** Refused without writing: the file changed outside since the tab's base (path: see ok). */
  | { ok: false; conflict: ExternalChange; path?: string }
export type RenameResult = { ok: true; path: string } | { ok: false; error: string }
export type ExportResult =
  | { kind: 'ok'; message: string }
  | { kind: 'failed'; code: number | null; stderr: string }
  | { kind: 'not-found'; searched: string[] }

export type MenuCommand =
  | 'new'
  | 'open'
  | 'rename'
  | 'close-tab'
  | 'export'
  | 'next-tab'
  | 'prev-tab'
  | 'undo'
  | 'redo'
  | 'select-all'
  | 'insert-pagebreak'
  | 'toggle-present'
  | 'toggle-view'
  | 'toggle-header'
  | 'toggle-outline'
  | 'fold'
  | 'unfold'
  | 'fold-all'
  | 'unfold-all'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'

export interface RfwApi {
  startup(): Promise<StartupState>
  readNote(path: string): Promise<NoteFile | { error: string }>
  newNotePath(): Promise<string>
  releasePath(path: string): Promise<void>
  /**
   * base: hash of the bytes the tab last loaded or saved (null for a note not on disk yet);
   * force: the user chose to overwrite whatever is on disk.
   */
  saveNote(
    path: string,
    text: string,
    bom: boolean,
    base: string | null,
    force: boolean,
  ): Promise<SaveResult>
  renameNote(from: string, newName: string): Promise<RenameResult>
  showOpenDialog(): Promise<string[]>
  exportPdf(path: string): Promise<ExportResult>
  saveSession(patch: SessionPatch): Promise<void>
  watch(paths: string[]): Promise<void>
  confirmDiscard(names: string[]): Promise<boolean>
  onMenu(cb: (cmd: MenuCommand) => void): void
  onOpenPaths(cb: (paths: string[]) => void): void
  onExternalChange(cb: (change: ExternalChange) => void): void
  /** cb resolves true when the window may close. */
  onBeforeClose(cb: () => Promise<boolean>): void
  /** Resolves to whether the user (not the app) had the window fullscreen before the change. */
  setFullScreen(on: boolean): Promise<boolean>
  onFullScreenLeft(cb: () => void): void
  /** The OS did not enter the fullscreen the app requested; Present continues windowed. */
  onFullScreenRefused(cb: () => void): void
  listSnippets(): Promise<SnippetDef[]>
}

export interface SnippetDef {
  name: string
  body: string
  source: 'builtin' | 'user'
}

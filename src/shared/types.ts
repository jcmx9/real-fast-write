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
  recent: string[]
}

export type SessionPatch = Partial<Pick<Session, 'tabs' | 'activeIndex' | 'mode' | 'view' | 'zoom'>>

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

export type SaveResult = { ok: true; hash: string } | { ok: false; error: string }
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
  | 'toggle-present'
  | 'toggle-view'
  | 'toggle-header'
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
  saveNote(path: string, text: string, bom: boolean): Promise<SaveResult>
  renameNote(from: string, newName: string): Promise<RenameResult>
  showOpenDialog(): Promise<string[]>
  exportPdf(path: string): Promise<ExportResult>
  saveSession(patch: SessionPatch): Promise<void>
  watch(paths: string[]): Promise<void>
  confirmDiscard(names: string[]): Promise<boolean>
  onMenu(cb: (cmd: MenuCommand) => void): void
  onOpenPaths(cb: (paths: string[]) => void): void
  onExternalChange(cb: (note: NoteFile) => void): void
  /** cb resolves true when the window may close. */
  onBeforeClose(cb: () => Promise<boolean>): void
  /** Resolves to whether the window was fullscreen before the change. */
  setFullScreen(on: boolean): Promise<boolean>
  onFullScreenLeft(cb: () => void): void
}

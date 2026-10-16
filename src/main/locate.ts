import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface LocateOptions {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  /** Path from the settings; empty = not configured. */
  configured: string
  isFile(path: string): Promise<boolean>
}

/** Search order from the spec (§9). GUI apps start with a minimal PATH, so fixed paths come first. */
export function candidates(o: LocateOptions): string[] {
  const win = o.platform === 'win32'
  const p = win ? path.win32 : path.posix
  const list: string[] = []
  if (o.configured) list.push(o.configured)
  if (o.env.RF_DOCUMENT) list.push(o.env.RF_DOCUMENT)
  if (win) {
    const local = o.env.LOCALAPPDATA ?? p.join(o.home, 'AppData', 'Local')
    list.push(p.join(local, 'Microsoft', 'WindowsApps', 'rf-document.cmd'))
  } else {
    list.push(
      p.join(o.home, '.local', 'bin', 'rf-document'),
      '/opt/homebrew/bin/rf-document',
      '/usr/local/bin/rf-document',
    )
  }
  const names = win ? ['rf-document.cmd', 'rf-document.exe'] : ['rf-document']
  const pathVar = o.env.PATH ?? o.env.Path ?? ''
  for (const dir of pathVar.split(p.delimiter).filter(Boolean)) {
    for (const name of names) list.push(p.join(dir, name))
  }
  return [...new Set(list)]
}

export async function locateRfDocument(
  o: LocateOptions,
): Promise<{ found: string | null; searched: string[] }> {
  const searched = candidates(o)
  for (const candidate of searched) {
    if (await o.isFile(candidate)) return { found: candidate, searched }
  }
  return { found: null, searched }
}

export async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await fs.stat(file)).isFile()) return false
    if (process.platform !== 'win32') await fs.access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const RF_DOCUMENT_NAMES = new Set(['rf-document', 'rf-document.cmd', 'rf-document.exe'])

/** File name check for a user-chosen rf-document (case-insensitive on Windows). */
export function isRfDocumentName(
  file: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const win = platform === 'win32'
  const name = (win ? path.win32 : path.posix).basename(file)
  return RF_DOCUMENT_NAMES.has(win ? name.toLowerCase() : name)
}

/**
 * What the settings dialog may store as rf-document: an executable regular file named
 * rf-document (.cmd/.exe). Main runs this path, so the renderer cannot point it elsewhere.
 */
export async function isRfDocumentBinary(file: string): Promise<boolean> {
  return isRfDocumentName(file) && (await isExecutableFile(file))
}

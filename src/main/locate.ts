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

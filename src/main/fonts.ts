import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FontStatus } from '../shared/types'

export const CORE_FONT_FILES = [
  'SourceSans3VF-Upright.otf',
  'SourceSans3VF-Italic.otf',
  'SourceSerif4Variable-Roman.otf',
  'SourceSerif4Variable-Italic.otf',
  'SourceCodeVF-Upright.otf',
  'SourceCodeVF-Italic.otf',
] as const

export const FONT_FILES: readonly string[] = [
  ...CORE_FONT_FILES,
  'NotoEmoji[wght].ttf',
  'NotoSansSymbols2-Regular.ttf',
]

/** rf-document's install folder (same rules as its bootstrap). */
export function rfDocumentDir(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  if (env.RFD_HOME) return env.RFD_HOME
  if (platform === 'win32') {
    return p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'real-fast-document')
  }
  return p.join(env.XDG_DATA_HOME || p.join(home, '.local', 'share'), 'real-fast-document')
}

/** rf-document's install folder for fonts. */
export function fontDir(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  const p = platform === 'win32' ? path.win32 : path.posix
  return p.join(rfDocumentDir(platform, env, home), 'fonts')
}

/** Only whitelisted file names are served; anything else (paths, traversal) is refused. */
export function fontFileFor(dir: string, urlPath: string): string | null {
  let name: string
  try {
    name = decodeURIComponent(urlPath.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return FONT_FILES.includes(name) ? path.join(dir, name) : null
}

export async function fontStatus(dir: string): Promise<FontStatus> {
  const missing: string[] = []
  for (const f of CORE_FONT_FILES) {
    try {
      await fs.access(path.join(dir, f))
    } catch {
      missing.push(f)
    }
  }
  return { dir, found: missing.length === 0, missing }
}

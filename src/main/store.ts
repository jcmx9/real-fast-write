import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import type { Session, SessionTab, Settings } from '../shared/types'
import { writeFileAtomic } from './files'

export const MAX_RECENT = 10

export const DEFAULT_SESSION: Session = {
  tabs: [],
  activeIndex: 0,
  mode: 'edit',
  view: 'preview',
  zoom: { edit: 1, present: 1 },
  recent: [],
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const absPath = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' && isAbsolute(v) ? v : null
const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

export function defaultSettings(documentsDir: string): Settings {
  const defaultFolder = join(documentsDir, 'rf-write')
  return {
    defaultFolder,
    snippetFolder: join(defaultFolder, 'snippets'),
    rfDocumentPath: '',
    presentFontFactor: 1.6,
  }
}

export function sanitizeSettings(raw: unknown, defaults: Settings): Settings {
  const o = isObj(raw) ? raw : {}
  const defaultFolder = absPath(o.defaultFolder) ?? defaults.defaultFolder
  return {
    defaultFolder,
    snippetFolder: absPath(o.snippetFolder) ?? join(defaultFolder, 'snippets'),
    rfDocumentPath: absPath(o.rfDocumentPath) ?? '',
    presentFontFactor: clamp(o.presentFontFactor, 1, 3, defaults.presentFontFactor),
  }
}

export function sanitizeSession(raw: unknown): Session {
  const o = isObj(raw) ? raw : {}
  const tabs: SessionTab[] = Array.isArray(o.tabs)
    ? o.tabs.flatMap((t) => {
        if (!isObj(t)) return []
        const path = absPath(t.path)
        return path ? [{ path, headerHidden: t.headerHidden === true }] : []
      })
    : []
  const zoom = isObj(o.zoom) ? o.zoom : {}
  return {
    tabs,
    activeIndex: tabs.length ? Math.trunc(clamp(o.activeIndex, 0, tabs.length - 1, 0)) : 0,
    mode: o.mode === 'present' ? 'present' : 'edit',
    view: o.view === 'code' ? 'code' : 'preview',
    zoom: { edit: clamp(zoom.edit, 0.5, 3, 1), present: clamp(zoom.present, 0.5, 3, 1) },
    recent: Array.isArray(o.recent)
      ? o.recent
          .map(absPath)
          .filter((p): p is string => p !== null)
          .slice(0, MAX_RECENT)
      : [],
  }
}

/** Missing → undefined. Corrupt → moved to `<file>.corrupt`, undefined. */
export async function loadJson(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch {
    return undefined
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    await fs.rename(path, `${path}.corrupt`).catch(() => undefined)
    return undefined
  }
}

export async function saveJson(path: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'))
}

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { SNIPPET_EXT, SNIPPET_NAME_RE } from '../shared/snippets'
import type { SnippetDef } from '../shared/types'

const MAX_BYTES = 64 * 1024
const BOM = '﻿'
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/** Reads the user's snippet templates; a missing folder yields an empty list. */
export async function loadUserSnippets(dir: string): Promise<SnippetDef[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: SnippetDef[] = []
  for (const file of names) {
    if (!file.endsWith(SNIPPET_EXT)) continue
    const name = file.slice(0, -SNIPPET_EXT.length)
    if (!SNIPPET_NAME_RE.test(name)) continue
    try {
      const p = join(dir, file)
      const st = await stat(p)
      if (!st.isFile() || st.size > MAX_BYTES) continue
      let body = utf8.decode(await readFile(p))
      if (body.startsWith(BOM)) body = body.slice(1)
      out.push({ name, body, source: 'user' })
    } catch (err) {
      console.warn('rf-write: snippet skipped', file, err)
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

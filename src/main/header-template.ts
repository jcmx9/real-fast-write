import { promises as fs } from 'node:fs'
import path from 'node:path'

/** A header template larger than this is not a header (protects the renderer). */
const MAX_BYTES = 64 * 1024

/**
 * rf-document's `header.md` (all front-matter keys with defaults and comments) from its install
 * folder, as text without a BOM. null when it is missing, too large or not UTF-8.
 */
export async function readHeaderTemplate(rfdDir: string): Promise<string | null> {
  const file = path.join(rfdDir, 'header.md')
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_BYTES) return null
    const bytes = await fs.readFile(file)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.startsWith('﻿') ? text.slice(1) : text
  } catch {
    return null
  }
}

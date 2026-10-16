import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SNIPPETS } from '../../../src/renderer/editor/builtin-snippets'

const KEY = /^([a-z][a-z0-9_-]*):/gm
const keys = (text: string): string[] => [...text.matchAll(KEY)].map((m) => m[1] as string)

/** key -> default value: tabstops resolved to their default, comments and quotes dropped. */
function defaults(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of text.matchAll(/^([a-z][a-z0-9_-]*):[ \t]*(.*)$/gm)) {
    const value = (m[2] as string)
      .replace(/\s+#.*$/, '')
      .replace(/\$\{\d+:([^}]*)\}/g, '$1')
      .replace(/\$\d+/g, '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
    out[m[1] as string] = value
  }
  return out
}

/** Prefilled on purpose in the snippet: a title to type over and today's date. */
const PREFILLED = new Set(['title', 'date'])

const candidates = [
  process.env.RFD_HEADER,
  join(__dirname, '..', '..', '..', '..', 'real-fast-document', 'header.md'),
  join(homedir(), '.local', 'share', 'real-fast-document', 'header.md'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'real-fast-document', 'header.md'),
].filter((p): p is string => Boolean(p))
const headerMd = candidates.find((p) => existsSync(p))

describe(':header snippet', () => {
  it.skipIf(!headerMd && !process.env.CI)('has exactly the keys of rf-document header.md', () => {
    expect(headerMd, `header.md not found in ${candidates.join(', ')}`).toBeDefined()
    const header = BUILTIN_SNIPPETS.find((s) => s.name === 'header')
    expect(keys(header?.body ?? '')).toEqual(keys(readFileSync(headerMd as string, 'utf8')))
  })
  it.skipIf(!headerMd && !process.env.CI)('has the default values of rf-document header.md', () => {
    expect(headerMd, `header.md not found in ${candidates.join(', ')}`).toBeDefined()
    const header = BUILTIN_SNIPPETS.find((s) => s.name === 'header')
    const ours = defaults(header?.body ?? '')
    const theirs = defaults(readFileSync(headerMd as string, 'utf8'))
    for (const key of Object.keys(theirs)) {
      if (PREFILLED.has(key)) continue
      expect(ours[key], key).toBe(theirs[key])
    }
  })
})

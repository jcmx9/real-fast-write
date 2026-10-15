import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_SNIPPETS } from '../../../src/renderer/editor/builtin-snippets'

const KEY = /^([a-z][a-z0-9_-]*):/gm
const keys = (text: string): string[] => [...text.matchAll(KEY)].map((m) => m[1] as string)

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
})

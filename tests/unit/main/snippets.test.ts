import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadUserSnippets } from '../../../src/main/snippets'

async function dir(files: Record<string, string | Buffer>): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'rfw-snip-'))
  for (const [name, body] of Object.entries(files)) await writeFile(join(d, name), body)
  return d
}

describe('loadUserSnippets', () => {
  it('reads *.tpl.md sorted by name, keeping bytes', async () => {
    const d = await dir({ 'zeta.tpl.md': 'Z $1', 'Ä-1.tpl.md': 'A\r\nB', 'note.md': 'no' })
    expect(await loadUserSnippets(d)).toEqual(
      [
        { name: 'zeta', body: 'Z $1', source: 'user' },
        { name: 'Ä-1', body: 'A\r\nB', source: 'user' },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    )
  })

  it('returns [] for a missing folder and does not create it', async () => {
    const missing = join(tmpdir(), `rfw-none-${Date.now()}`)
    expect(await loadUserSnippets(missing)).toEqual([])
    await expect(stat(missing)).rejects.toThrow()
  })

  it('skips invalid UTF-8, oversized files, bad names and directories', async () => {
    const d = await dir({
      'bin.tpl.md': Buffer.from([0xff, 0xfe, 0x00]),
      'big.tpl.md': 'x'.repeat(64 * 1024 + 1),
      'bad name.tpl.md': 'x',
      'ok.tpl.md': 'ok',
    })
    await mkdir(join(d, 'dir.tpl.md'))
    expect((await loadUserSnippets(d)).map((s) => s.name)).toEqual(['ok'])
  })

  it('strips a UTF-8 BOM', async () => {
    const d = await dir({ 'b.tpl.md': Buffer.from('﻿hi', 'utf8') })
    expect((await loadUserSnippets(d))[0]?.body).toBe('hi')
  })

  it('normalizes NFD file names to NFC', async () => {
    const d = await dir({ [`${'A\u0308'}rger.tpl.md`]: 'x' })
    expect((await loadUserSnippets(d)).map((s) => s.name)).toEqual(['\u00C4rger'])
  })
})

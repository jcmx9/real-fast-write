import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashBytes, noteBytes, writeNote } from '../../../src/main/files'
import { NoteWatcher } from '../../../src/main/watcher'
import type { NoteFile } from '../../../src/shared/types'

let dir: string
let changes: NoteFile[]
let watcher: NoteWatcher

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timeout')
    await sleep(50)
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-watch-'))
  changes = []
  watcher = new NoteWatcher((n) => changes.push(n), 100)
})
afterEach(() => watcher.close())

describe('NoteWatcher', () => {
  it('reports an external change with the new text', async () => {
    const path = join(dir, 'a.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('alt', false)))
    await sleep(150)
    await writeFile(path, 'neu von außen')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('neu von außen')
  })

  it('ignores its own expected write, also when atomic', async () => {
    const path = join(dir, 'b.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('eigene', false)))
    await writeNote(path, 'eigene', false)
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('keeps working after an atomic replace', async () => {
    const path = join(dir, 'c.md')
    await writeFile(path, '1')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('2', false)))
    await writeNote(path, '2', false)
    await sleep(300)
    await writeFile(path, '3 extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('3 extern')
  })

  it('ignores files that are not watched', async () => {
    const watched = join(dir, 'w.md')
    await writeFile(watched, 'w')
    watcher.setFiles([watched])
    await writeFile(join(dir, 'andere.md'), 'x')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('stops reporting after the file is removed from the set', async () => {
    const path = join(dir, 'd.md')
    await writeFile(path, 'd')
    watcher.setFiles([path])
    watcher.setFiles([])
    await writeFile(path, 'd2')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('seeds a baseline so an unchanged write is not reported without expect()', async () => {
    const path = join(dir, 'e.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    await sleep(150)
    await writeFile(path, 'x')
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'y')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('y')
  })

  it('expect() wins over the seeded baseline', async () => {
    const path = join(dir, 'f.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('neu', false)))
    await sleep(150)
    await writeNote(path, 'neu', false)
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('extern')
  })

  it('re-seeds from disk when a file is re-added after an external change', async () => {
    const path = join(dir, 'g.md')
    await writeFile(path, 'alt')
    watcher.setFiles([path])
    watcher.setFiles([])
    await writeFile(path, 'geändert')
    watcher.setFiles([path])
    await sleep(150)
    await writeFile(path, 'geändert')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('ignores a stale read of the old content while our own write is in flight', async () => {
    const path = join(dir, 'h.md')
    await writeFile(path, 'x')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('neu', false)))
    // Event for the old content, whose hash is still accepted but no longer latest.
    await writeFile(path, 'x')
    await sleep(600)
    expect(changes).toEqual([])
    await writeNote(path, 'neu', false)
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'extern')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('extern')
  })

  it('reports an external revert to older content after an own write has settled', async () => {
    const path = join(dir, 'i.md')
    await writeFile(path, 'v1')
    watcher.setFiles([path])
    watcher.expect(path, hashBytes(noteBytes('v2', false)))
    await writeNote(path, 'v2', false)
    await sleep(600)
    expect(changes).toEqual([])
    await writeFile(path, 'v1')
    await waitFor(() => changes.length > 0)
    expect(changes.at(-1)?.text).toBe('v1')
  })
})

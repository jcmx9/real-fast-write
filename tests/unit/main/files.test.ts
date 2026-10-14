import {
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  detectEol,
  hashBytes,
  NotUtf8Error,
  newNotePath,
  noteBytes,
  readNote,
  timestampName,
  writeFileAtomic,
  writeNote,
} from '../../../src/main/files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-files-'))
})

const posixOnly = process.platform === 'win32' ? it.skip : it

describe('timestampName', () => {
  it('formats local time with zero padding', () => {
    expect(timestampName(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02_03-04-05.md')
  })
})

describe('newNotePath', () => {
  const now = new Date(2026, 9, 14, 9, 30, 0)

  it('creates the folder and returns the timestamp name', async () => {
    const folder = join(dir, 'neu', 'tief')
    expect(await newNotePath(folder, now, new Set())).toBe(join(folder, '2026-10-14_09-30-00.md'))
    expect((await stat(folder)).isDirectory()).toBe(true)
  })

  it('appends _2, _3 when the name exists on disk or is reserved', async () => {
    await writeFile(join(dir, '2026-10-14_09-30-00.md'), '')
    const reserved = new Set([join(dir, '2026-10-14_09-30-00_2.md')])
    expect(await newNotePath(dir, now, reserved)).toBe(join(dir, '2026-10-14_09-30-00_3.md'))
  })
})

describe('detectEol', () => {
  it.each([
    ['', '\n'],
    ['a\nb\n', '\n'],
    ['a\r\nb\r\n', '\r\n'],
    ['a\r\nb\n', 'mixed'],
    ['a\rb', 'mixed'],
  ] as const)('%j → %j', (text, eol) => {
    expect(detectEol(text)).toBe(eol)
  })
})

describe('readNote / writeNote', () => {
  it('strips and reports a BOM, keeps CRLF, hashes the raw bytes', async () => {
    const path = join(dir, 'bom.md')
    const bytes = Buffer.from('﻿# Titel\r\nText\r\n', 'utf8')
    await writeFile(path, bytes)
    const note = await readNote(path)
    expect(note).toEqual({
      path,
      text: '# Titel\r\nText\r\n',
      bom: true,
      eol: '\r\n',
      hash: hashBytes(bytes),
    })
  })

  it('round-trips byte-exact', async () => {
    const path = join(dir, 'rt.md')
    const original = Buffer.from('﻿a\r\nb\nc\rd', 'utf8')
    await writeFile(path, original)
    const note = await readNote(path)
    const hash = await writeNote(path, note.text, note.bom)
    expect(Buffer.compare(await readFile(path), original)).toBe(0)
    expect(hash).toBe(hashBytes(original))
  })

  it('refuses invalid UTF-8', async () => {
    const path = join(dir, 'latin1.md')
    await writeFile(path, Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]))
    await expect(readNote(path)).rejects.toBeInstanceOf(NotUtf8Error)
  })

  it('creates a new file and leaves no temp files', async () => {
    const path = join(dir, 'neu.md')
    await writeNote(path, 'Hallo', false)
    expect(await readFile(path, 'utf8')).toBe('Hallo')
    expect(await readdir(dir)).toEqual(['neu.md'])
  })

  posixOnly('writes through a symlink and keeps the link', async () => {
    const target = join(dir, 'echt.md')
    const link = join(dir, 'link.md')
    await writeFile(target, 'alt')
    await symlink(target, link)
    await writeNote(link, 'neu', false)
    expect((await lstat(link)).isSymbolicLink()).toBe(true)
    expect(await readlink(link)).toBe(target)
    expect(await readFile(target, 'utf8')).toBe('neu')
  })

  posixOnly('keeps the file mode', async () => {
    const path = join(dir, 'mode.md')
    await writeFile(path, 'x')
    await chmod(path, 0o600)
    await writeNote(path, 'y', false)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})

describe('writeFileAtomic', () => {
  it('retries EBUSY and then succeeds', async () => {
    const path = join(dir, 'retry.md')
    let calls = 0
    const { rename } = await import('node:fs/promises')
    await writeFileAtomic(path, noteBytes('ok', false), {
      rename: async (a, b) => {
        calls++
        if (calls < 3) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        await rename(a, b)
      },
      sleep: async () => undefined,
    })
    expect(calls).toBe(3)
    expect(await readFile(path, 'utf8')).toBe('ok')
  })

  it('keeps the original and removes the temp file when the rename fails', async () => {
    const path = join(dir, 'orig.md')
    await writeFile(path, 'original')
    await expect(
      writeFileAtomic(path, noteBytes('neu', false), {
        rename: async () => {
          throw Object.assign(new Error('io'), { code: 'EIO' })
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('io')
    expect(await readFile(path, 'utf8')).toBe('original')
    expect(await readdir(dir)).toEqual(['orig.md'])
  })
})

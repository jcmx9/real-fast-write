import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RenameError, renameNote, validateNewName } from '../../../src/main/files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-rename-'))
})

describe('validateNewName', () => {
  it.each([
    ['Kickoff', 'Kickoff.md'],
    ['  Kickoff.md ', 'Kickoff.md'],
    ['Notiz.MD', 'Notiz.MD'],
  ])('%j → %j', (input, out) => expect(validateNewName(input)).toBe(out))

  it.each([
    '',
    '   ',
    '.',
    '..',
    'a/b',
    'a\\b',
    'a:b',
    'a?b',
    'a*b',
    'a<b',
    'a|b',
    'a"b',
    'tab\tname',
  ])('rejects %j', (input) => expect(() => validateNewName(input)).toThrow(RenameError))
})

describe('renameNote', () => {
  it('renames within the same folder', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A')
    const to = await renameNote(from, 'Kickoff')
    expect(to).toBe(join(dir, 'Kickoff.md'))
    expect(await readdir(dir)).toEqual(['Kickoff.md'])
    expect(await readFile(to, 'utf8')).toBe('A')
  })

  it('never overwrites an existing file', async () => {
    const from = join(dir, 'a.md')
    await writeFile(from, 'A')
    await writeFile(join(dir, 'b.md'), 'B')
    await expect(renameNote(from, 'b')).rejects.toThrow(/existiert bereits/)
    expect(await readFile(from, 'utf8')).toBe('A')
    expect(await readFile(join(dir, 'b.md'), 'utf8')).toBe('B')
  })

  it('supports a case-only rename', async () => {
    const from = join(dir, 'notiz.md')
    await writeFile(from, 'N')
    const to = await renameNote(from, 'Notiz')
    expect(await readdir(dir)).toEqual(['Notiz.md'])
    expect(await readFile(to, 'utf8')).toBe('N')
  })

  it('refuses a case-only rename onto a different existing file (case-sensitive FS)', async () => {
    await writeFile(join(dir, 'x.md'), 'lower')
    await writeFile(join(dir, 'X.md'), 'upper')
    const caseSensitive = (await readdir(dir)).length === 2
    if (!caseSensitive) return
    await expect(renameNote(join(dir, 'x.md'), 'X')).rejects.toThrow(RenameError)
    expect(await readFile(join(dir, 'X.md'), 'utf8')).toBe('upper')
  })

  it('returns the same path when the name is unchanged', async () => {
    const from = join(dir, 'same.md')
    await writeFile(from, 'S')
    expect(await renameNote(from, 'same')).toBe(from)
  })
})

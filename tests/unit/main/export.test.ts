import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildCommand, runRfDocument } from '../../../src/main/export'
import { makeFakeRfDocument } from '../../helpers/fake-rf-document'

let dir: string
let note: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rfw-export-'))
  note = join(dir, 'Notiz mit Leerzeichen.md')
  await writeFile(note, '# Test\n')
})

describe('buildCommand', () => {
  it('runs a binary directly on POSIX', () => {
    expect(buildCommand('/bin/rf-document', '/n/a b.md', 'darwin')).toEqual({
      file: '/bin/rf-document',
      args: ['/n/a b.md'],
      verbatim: false,
    })
  })

  it('wraps a .cmd in cmd.exe with explicit quoting', () => {
    expect(
      buildCommand('C:\\A B\\rf-document.cmd', 'C:\\N\\a b.md', 'win32', 'C:\\Windows\\cmd.exe'),
    ).toEqual({
      file: 'C:\\Windows\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\A B\\rf-document.cmd" "C:\\N\\a b.md""'],
      verbatim: true,
    })
  })
})

describe('runRfDocument', () => {
  it('passes the note path intact and returns the last stdout line', async () => {
    const { bin, argsFile } = await makeFakeRfDocument(dir, { stdout: 'OK erzeugt' })
    expect(await runRfDocument(bin, note)).toEqual({ kind: 'ok', message: 'OK erzeugt' })
    expect((await readFile(argsFile, 'utf8')).trim()).toBe(note)
  })

  it('returns stderr and exit code on failure', async () => {
    const { bin } = await makeFakeRfDocument(dir, { stderr: 'Fehler kaputt', code: 3 })
    expect(await runRfDocument(bin, note)).toEqual({
      kind: 'failed',
      code: 3,
      stderr: 'Fehler kaputt',
    })
  })

  it('explains a failure without stderr', async () => {
    const { bin } = await makeFakeRfDocument(dir, { code: 2 })
    expect(await runRfDocument(bin, note)).toEqual({
      kind: 'failed',
      code: 2,
      stderr: 'rf-document endete mit Code 2.',
    })
  })

  it('reports a missing binary', async () => {
    const r = await runRfDocument(join(dir, 'gibt-es-nicht'), note)
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') expect(r.code).toBeNull()
  })

  it('kills a hanging process after the timeout', async () => {
    const { bin } = await makeFakeRfDocument(dir, { sleepSeconds: 5 })
    const r = await runRfDocument(bin, note, { timeoutMs: 300 })
    expect(r.kind).toBe('failed')
    if (r.kind === 'failed') expect(r.stderr).toMatch(/Zeitüberschreitung/)
  })

  it.skipIf(process.platform === 'win32')('handles umlauts in the path', async () => {
    const umlaut = join(dir, 'Übergabe Grüße.md')
    await writeFile(umlaut, '# Ü\n')
    const { bin, argsFile } = await makeFakeRfDocument(dir, { stdout: 'OK' })
    await runRfDocument(bin, umlaut)
    expect(await readFile(argsFile, 'utf8')).toBe(umlaut)
  })
})

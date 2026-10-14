import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { addRecent, argsFromArgv, parseCli, replaceRecent } from '../../../src/main/cli'

describe('argsFromArgv', () => {
  it('drops only the executable when packaged', () => {
    expect(argsFromArgv(['/A/rf-write', 'a.md'], true)).toEqual(['a.md'])
  })

  it('drops the executable and the app path in development, even after injected flags', () => {
    expect(argsFromArgv(['electron', '--inspect=0', '.', 'a.md', '-V'], false)).toEqual([
      '--inspect=0',
      'a.md',
      '-V',
    ])
  })
})

describe('parseCli', () => {
  const cwd = resolve('/work')

  it.each([['--version'], ['-V']])('%s → version', (flag) => {
    expect(parseCli(['a.md', flag], cwd)).toEqual({ kind: 'version' })
  })

  it.each([['--help'], ['-h']])('%s → help', (flag) => {
    expect(parseCli([flag], cwd)).toEqual({ kind: 'help' })
  })

  it('resolves paths against cwd and ignores unknown flags (macOS -psn_, Chromium switches)', () => {
    expect(parseCli(['notiz.md', '-psn_0_123', '--inspect=0', resolve('/abs/x.md')], cwd)).toEqual({
      kind: 'open',
      paths: [resolve(cwd, 'notiz.md'), resolve('/abs/x.md')],
    })
  })
})

describe('recent list', () => {
  it('moves an existing entry to the front and caps the length', () => {
    expect(addRecent(['b', 'a', 'c'], 'a', 3)).toEqual(['a', 'b', 'c'])
    expect(addRecent(['b', 'c', 'd'], 'a', 3)).toEqual(['a', 'b', 'c'])
  })

  it('replaces a renamed entry in place', () => {
    expect(replaceRecent(['x', 'old', 'y'], 'old', 'new')).toEqual(['x', 'new', 'y'])
  })
})

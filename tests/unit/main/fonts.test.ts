import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CORE_FONT_FILES,
  FONT_FILES,
  fontDir,
  fontFileFor,
  fontStatus,
} from '../../../src/main/fonts'

describe('fontDir', () => {
  it('uses RFD_HOME when set', () => {
    expect(fontDir('darwin', { RFD_HOME: '/opt/rfd' }, '/Users/u')).toBe('/opt/rfd/fonts')
  })
  it('uses XDG_DATA_HOME, then ~/.local/share on macOS/Linux', () => {
    expect(fontDir('linux', { XDG_DATA_HOME: '/x' }, '/home/u')).toBe('/x/real-fast-document/fonts')
    expect(fontDir('darwin', {}, '/Users/u')).toBe('/Users/u/.local/share/real-fast-document/fonts')
  })
  it('uses LOCALAPPDATA on Windows', () => {
    expect(fontDir('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\real-fast-document\\fonts',
    )
    expect(fontDir('win32', {}, 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\real-fast-document\\fonts',
    )
  })
})

describe('fontFileFor', () => {
  const dir = path.resolve('/fonts')
  it('maps a whitelisted, URI-encoded name into the font folder', () => {
    expect(fontFileFor(dir, '/SourceSans3VF-Upright.otf')).toBe(
      join(dir, 'SourceSans3VF-Upright.otf'),
    )
    expect(fontFileFor(dir, '/NotoEmoji%5Bwght%5D.ttf')).toBe(join(dir, 'NotoEmoji[wght].ttf'))
  })
  it.each([
    '/../secret.otf',
    '/%2E%2E%2Fsecret.otf',
    '/evil.otf',
    '/',
    '/fonts/SourceSans3VF-Upright.otf',
    '/%E0%A4%A',
  ])('rejects %s', (p) => expect(fontFileFor(dir, p)).toBeNull())
})

describe('fontStatus', () => {
  it('reports missing core files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-fonts-'))
    await writeFile(join(dir, 'SourceSans3VF-Upright.otf'), 'x')
    const s = await fontStatus(dir)
    expect(s.found).toBe(false)
    expect(s.missing).toContain('SourceSerif4Variable-Roman.otf')
    expect(s.missing).not.toContain('SourceSans3VF-Upright.otf')
  })
  it('is found when all core files exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rfw-fonts-'))
    for (const f of CORE_FONT_FILES) await writeFile(join(dir, f), 'x')
    expect(await fontStatus(dir)).toEqual({ dir, found: true, missing: [] })
  })
  it('lists all served files', () => {
    expect(FONT_FILES).toEqual(
      expect.arrayContaining([
        ...CORE_FONT_FILES,
        'NotoEmoji[wght].ttf',
        'NotoSansSymbols2-Regular.ttf',
      ]),
    )
  })
})

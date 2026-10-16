import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rfDocumentDir } from '../../../src/main/fonts'
import { readHeaderTemplate } from '../../../src/main/header-template'

const dir = () => mkdtemp(join(tmpdir(), 'rfw-header-'))

describe('readHeaderTemplate', () => {
  it('returns header.md as text without a BOM', async () => {
    const d = await dir()
    await writeFile(join(d, 'header.md'), '\uFEFF---\ntitle: ""\n---\n')
    expect(await readHeaderTemplate(d)).toBe('---\ntitle: ""\n---\n')
  })

  it('returns null when header.md is missing, not UTF-8 or too large', async () => {
    const d = await dir()
    expect(await readHeaderTemplate(d)).toBeNull()
    await writeFile(join(d, 'header.md'), Buffer.from([0x2d, 0xff, 0xfe]))
    expect(await readHeaderTemplate(d)).toBeNull()
    await writeFile(join(d, 'header.md'), 'x'.repeat(65 * 1024))
    expect(await readHeaderTemplate(d)).toBeNull()
  })
})

describe('rfDocumentDir', () => {
  it('follows rf-document’s install rules', () => {
    expect(rfDocumentDir('darwin', {}, '/Users/u')).toBe('/Users/u/.local/share/real-fast-document')
    expect(rfDocumentDir('linux', { XDG_DATA_HOME: '/x' }, '/home/u')).toBe('/x/real-fast-document')
    expect(rfDocumentDir('win32', { LOCALAPPDATA: 'C:\\L' }, 'C:\\U')).toBe(
      'C:\\L\\real-fast-document',
    )
    expect(rfDocumentDir('linux', { RFD_HOME: '/opt/rfd' }, '/home/u')).toBe('/opt/rfd')
  })
})

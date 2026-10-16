import { describe, expect, it } from 'vitest'
import {
  candidates,
  isRfDocumentName,
  type LocateOptions,
  locateRfDocument,
} from '../../../src/main/locate'

const mac = (over: Partial<LocateOptions> = {}): LocateOptions => ({
  platform: 'darwin',
  env: { PATH: '/usr/bin:/bin:/usr/bin' },
  home: '/Users/u',
  configured: '',
  isFile: async () => false,
  ...over,
})

const win = (over: Partial<LocateOptions> = {}): LocateOptions => ({
  platform: 'win32',
  env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', Path: 'C:\\Tools;C:\\Bin' },
  home: 'C:\\Users\\u',
  configured: '',
  isFile: async () => false,
  ...over,
})

describe('candidates', () => {
  it('follows the spec order on macOS/Linux and dedupes PATH', () => {
    expect(
      candidates(
        mac({
          configured: '/opt/x/rf-document',
          env: { RF_DOCUMENT: '/env/rf-document', PATH: '/usr/bin:/usr/bin' },
        }),
      ),
    ).toEqual([
      '/opt/x/rf-document',
      '/env/rf-document',
      '/Users/u/.local/bin/rf-document',
      '/opt/homebrew/bin/rf-document',
      '/usr/local/bin/rf-document',
      '/usr/bin/rf-document',
    ])
  })

  it('uses WindowsApps and .cmd/.exe on Windows', () => {
    expect(candidates(win())).toEqual([
      'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\rf-document.cmd',
      'C:\\Tools\\rf-document.cmd',
      'C:\\Tools\\rf-document.exe',
      'C:\\Bin\\rf-document.cmd',
      'C:\\Bin\\rf-document.exe',
    ])
  })

  it('works without PATH', () => {
    expect(candidates(mac({ env: {} }))).toHaveLength(3)
  })
})

describe('locateRfDocument', () => {
  it('returns the first existing candidate', async () => {
    const existing = new Set(['/opt/homebrew/bin/rf-document', '/usr/bin/rf-document'])
    const r = await locateRfDocument(mac({ isFile: async (p) => existing.has(p) }))
    expect(r.found).toBe('/opt/homebrew/bin/rf-document')
  })

  it('reports everything searched when nothing exists', async () => {
    const r = await locateRfDocument(mac())
    expect(r.found).toBeNull()
    expect(r.searched).toContain('/Users/u/.local/bin/rf-document')
  })
})

describe('isRfDocumentName', () => {
  it('accepts rf-document, rf-document.cmd and rf-document.exe only', () => {
    expect(isRfDocumentName('/opt/homebrew/bin/rf-document', 'darwin')).toBe(true)
    expect(isRfDocumentName('/x/rf-document.cmd', 'linux')).toBe(true)
    expect(isRfDocumentName('/usr/bin/python3', 'linux')).toBe(false)
    expect(isRfDocumentName('/x/rf-document-evil', 'linux')).toBe(false)
    expect(isRfDocumentName('/x/RF-DOCUMENT', 'darwin')).toBe(false)
  })
  it('on Windows: either separator, any case', () => {
    expect(isRfDocumentName('C:\\Tools\\RF-Document.CMD', 'win32')).toBe(true)
    expect(isRfDocumentName('C:/Tools/rf-document.exe', 'win32')).toBe(true)
    expect(isRfDocumentName('C:\\Windows\\System32\\cmd.exe', 'win32')).toBe(false)
  })
})

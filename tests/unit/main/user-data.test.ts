import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { userDataOverride } from '../../../src/main/user-data'

const appData = resolve('/home/u/.config')

describe('userDataOverride', () => {
  it('RFW_USER_DATA wins, packaged or not', () => {
    const custom = resolve('/tmp/rfw-test')
    expect(userDataOverride({ RFW_USER_DATA: custom }, true, appData)).toBe(custom)
    expect(userDataOverride({ RFW_USER_DATA: custom }, false, appData)).toBe(custom)
  })

  it('development uses its own folder, so it never shares settings or the lock with an install', () => {
    expect(userDataOverride({}, false, appData)).toBe(join(appData, 'rf-write-dev'))
    expect(userDataOverride({ RFW_USER_DATA: '' }, false, appData)).toBe(
      join(appData, 'rf-write-dev'),
    )
  })

  it('the packaged app keeps Electron’s default', () => {
    expect(userDataOverride({}, true, appData)).toBeNull()
  })
})

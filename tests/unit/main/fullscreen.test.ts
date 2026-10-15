import { describe, expect, it } from 'vitest'
import { LeaveTracker } from '../../../src/main/fullscreen'

describe('LeaveTracker', () => {
  it('treats an expected leave as app-requested', () => {
    const t = new LeaveTracker()
    t.expectLeave()
    expect(t.onLeave()).toBe(false)
  })

  it('treats an unexpected leave as OS-initiated', () => {
    expect(new LeaveTracker().onLeave()).toBe(true)
  })

  it('counts several expected leaves, then reports the next as OS-initiated', () => {
    const t = new LeaveTracker()
    t.expectLeave()
    t.expectLeave()
    expect([t.onLeave(), t.onLeave(), t.onLeave()]).toEqual([false, false, true])
  })
})

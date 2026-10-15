import { describe, expect, it } from 'vitest'
import { FullScreenOwner } from '../../../src/main/fullscreen'

describe('FullScreenOwner', () => {
  it('enters and leaves a fullscreen the app requested; its own leave is not reported', () => {
    const o = new FullScreenOwner()
    expect(o.request(true, false)).toEqual({ set: true, was: false })
    expect(o.request(false, true)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('counts a leave requested while the enter still animates (isFullScreen still false)', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    expect(o.request(false, false)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('a late leave from an earlier exit never ends a Present entered since', () => {
    const o = new FullScreenOwner()
    o.request(true, false) // enter, animating
    o.request(false, false) // Esc during the animation
    // Re-enter while the window is fullscreen and only waiting for the app's own leave.
    expect(o.request(true, true)).toEqual({ set: true, was: false })
    expect(o.onLeave()).toBe(false) // the late leave of the earlier exit
    // The new Present still owns fullscreen and leaves it again.
    expect(o.request(false, true)).toEqual({ set: false, was: false })
    expect(o.onLeave()).toBe(false)
  })

  it('repeated toggles never end in a fullscreen the app no longer leaves', () => {
    const o = new FullScreenOwner()
    for (let i = 0; i < 5; i++) {
      expect(o.request(true, i > 0).set).toBe(true)
      expect(o.request(false, false).set).toBe(false)
    }
    for (let i = 0; i < 5; i++) expect(o.onLeave()).toBe(false)
    expect(o.request(true, false)).toEqual({ set: true, was: false })
  })

  it('ignores duplicate requests', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    expect(o.request(true, false).set).toBeNull()
    o.request(false, true)
    expect(o.request(false, true).set).toBeNull()
    expect(o.onLeave()).toBe(false)
    expect(o.onLeave()).toBe(true)
  })

  it('reports a genuine OS leave and forgets ownership', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    expect(o.onLeave()).toBe(true)
    // Present ends; its exit request must not touch the window again.
    expect(o.request(false, false).set).toBeNull()
  })

  it('reports an OS leave after earlier app leaves have settled', () => {
    const o = new FullScreenOwner()
    o.request(true, false)
    o.request(false, true)
    expect(o.onLeave()).toBe(false)
    o.request(true, false)
    expect(o.onLeave()).toBe(true)
  })

  it('never leaves a fullscreen the user started', () => {
    const o = new FullScreenOwner()
    expect(o.request(true, true)).toEqual({ set: null, was: true })
    expect(o.request(false, true)).toEqual({ set: null, was: true })
    expect(o.onLeave()).toBe(true) // the user leaving their own fullscreen is an OS leave
  })
})

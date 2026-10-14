import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutosaveScheduler } from '../../../src/renderer/editor/autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AutosaveScheduler', () => {
  it('saves once, 1 s after the last touch', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    await vi.advanceTimersByTimeAsync(800)
    a.touch()
    await vi.advanceTimersByTimeAsync(800)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush saves immediately and cancels the pending timer', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    expect(await a.flush()).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('retries after a failure until it succeeds', async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const a = new AutosaveScheduler(save, 1000, 5000)
    expect(await a.flush()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('treats a throwing save as failure', async () => {
    const a = new AutosaveScheduler(async () => {
      throw new Error('kaputt')
    })
    expect(await a.flush()).toBe(false)
    a.dispose()
  })

  it('never runs saves concurrently', async () => {
    let running = 0
    let maxRunning = 0
    const save = vi.fn(async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await new Promise((r) => setTimeout(r, 100))
      running--
      return true
    })
    const a = new AutosaveScheduler(save)
    const first = a.flush()
    const second = a.flush()
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([first, second])
    expect(save).toHaveBeenCalledTimes(2)
    expect(maxRunning).toBe(1)
  })

  it('dispose stops pending work', async () => {
    const save = vi.fn(async () => true)
    const a = new AutosaveScheduler(save)
    a.touch()
    a.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).not.toHaveBeenCalled()
  })
})

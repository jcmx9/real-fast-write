import { describe, expect, it } from 'vitest'
import { SerialQueue } from '../../../src/renderer/util/serial'

const tick = () => new Promise((r) => setTimeout(r))

describe('SerialQueue', () => {
  it('runs ops one after another, in order', async () => {
    const q = new SerialQueue()
    const log: string[] = []
    let release = () => {}
    const first = q.run(
      () =>
        new Promise<void>((r) => {
          log.push('a start')
          release = () => {
            log.push('a end')
            r()
          }
        }),
    )
    const second = q.run(async () => {
      log.push('b')
    })
    await tick()
    expect(log).toEqual(['a start'])
    release()
    await Promise.all([first, second])
    expect(log).toEqual(['a start', 'a end', 'b'])
  })

  it('a rejected op does not block later ops', async () => {
    const q = new SerialQueue()
    const failed = q.run(async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')
    let ran = false
    await q.run(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('is busy while an op is queued or running', async () => {
    const q = new SerialQueue()
    expect(q.busy).toBe(false)
    let release = () => {}
    const p = q.run(() => new Promise<void>((r) => (release = r)))
    expect(q.busy).toBe(true)
    await tick()
    release()
    await p
    expect(q.busy).toBe(false)
  })
})

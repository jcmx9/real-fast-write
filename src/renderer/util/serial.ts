/** Runs async ops strictly one after another; a failing op never blocks the ones after it. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0

  /** An op is queued or running. */
  get busy(): boolean {
    return this.pending > 0
  }

  /** Queues op; the returned promise settles like op itself. */
  run(op: () => Promise<void>): Promise<void> {
    this.pending++
    const result = this.tail.then(op)
    const done = (): void => {
      this.pending--
    }
    this.tail = result.then(done, done)
    return result
  }
}

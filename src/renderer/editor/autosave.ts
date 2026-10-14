type Timer = ReturnType<typeof setTimeout>

export class AutosaveScheduler {
  private timer: Timer | null = null
  private retryTimer: Timer | null = null
  private chain: Promise<boolean> = Promise.resolve(true)

  constructor(
    private readonly save: () => Promise<boolean>,
    private readonly delayMs = 1000,
    private readonly retryMs = 5000,
  ) {}

  touch(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.run(), this.delayMs)
  }

  flush(): Promise<boolean> {
    return this.run()
  }

  dispose(): void {
    this.clearTimers()
  }

  private run(): Promise<boolean> {
    this.clearTimers()
    this.chain = this.chain.then(async () => {
      const ok = await this.save().catch(() => false)
      if (!ok) this.retryTimer = setTimeout(() => void this.run(), this.retryMs)
      return ok
    })
    return this.chain
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.timer = null
    this.retryTimer = null
  }
}

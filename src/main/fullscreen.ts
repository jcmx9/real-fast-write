/**
 * Tells app-requested fullscreen leaves apart from OS-initiated ones, so a late
 * 'leave-full-screen' from an earlier exit never ends a Present mode entered since.
 */
export class LeaveTracker {
  private pending = 0

  /** The app asked a fullscreen window to leave fullscreen. */
  expectLeave(): void {
    this.pending++
  }

  /** Call on 'leave-full-screen'; true when the OS (not the app) left fullscreen. */
  onLeave(): boolean {
    if (this.pending > 0) {
      this.pending--
      return false
    }
    return true
  }
}

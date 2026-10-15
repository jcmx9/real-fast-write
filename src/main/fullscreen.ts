/** What main does with the window for one renderer fullscreen request. */
export interface FullScreenAction {
  /** Call win.setFullScreen(set), or leave the window alone (null). */
  set: boolean | null
  /** The user (not the app) had the window fullscreen before the request. */
  was: boolean
}

/**
 * Tracks whether the app itself put the window into fullscreen, by intent rather than by
 * win.isFullScreen(), which lags behind while macOS animates or a Linux WM answers.
 *
 * - The app only leaves a fullscreen it requested: a user's own fullscreen survives Present.
 * - Every app-requested leave is counted, also one requested while the enter still animates,
 *   so its late 'leave-full-screen' is never reported as an OS leave that would end a Present
 *   mode entered since.
 * - A leave the app did not request (green button, OS shortcut) is reported.
 */
export class FullScreenOwner {
  /** The app requested fullscreen and has not asked to leave since. */
  private owned = false
  /** App-requested leaves whose 'leave-full-screen' is still to come. */
  private pendingLeaves = 0

  /** Records a renderer request; isFullScreen is the window's current (possibly stale) state. */
  request(on: boolean, isFullScreen: boolean): FullScreenAction {
    if (on) {
      if (this.owned) return { set: null, was: false }
      // A fullscreen that is only waiting for the app's own leave is not the user's.
      if (isFullScreen && this.pendingLeaves === 0) return { set: null, was: true }
      this.owned = true
      return { set: true, was: false }
    }
    if (!this.owned) return { set: null, was: isFullScreen && this.pendingLeaves === 0 }
    this.owned = false
    this.pendingLeaves++
    return { set: false, was: false }
  }

  /** Call on 'leave-full-screen'; true when the OS (not the app) left fullscreen. */
  onLeave(): boolean {
    if (this.pendingLeaves > 0) {
      this.pendingLeaves--
      return false
    }
    this.owned = false
    return true
  }
}

/** held: an external change blocks saving until the user answers the banner. */
export type SaveState = 'saved' | 'dirty' | 'new' | 'error' | 'held'

export const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: 'Gespeichert',
  dirty: 'Ungespeichert',
  new: 'Neu – wird beim ersten Tippen angelegt',
  error: 'Speichern fehlgeschlagen',
  held: 'Nicht gespeichert',
}

import type { View } from '../../shared/types'
import { Clock } from './clock'
import { type Mode, ModeSwitches } from './switches'

export interface StatusActions {
  exportPdf(): void
  setMode(mode: Mode): void
  setView(view: View): void
}

/** Edit's bottom line: clock, mode and view switches, file name, save state, export. */
export class StatusLine {
  private readonly clock: Clock
  private readonly switches: ModeSwitches
  private readonly name = document.createElement('span')
  private readonly state = document.createElement('span')
  private readonly exportButton = document.createElement('button')
  private busy = false

  constructor(el: HTMLElement, actions: StatusActions, now: () => Date = () => new Date()) {
    this.clock = new Clock('clock', 'status-clock', now)
    this.switches = new ModeSwitches('status', actions)
    this.name.className = 'file'
    this.state.className = 'state'
    this.state.dataset.testid = 'status-state'
    this.exportButton.type = 'button'
    this.exportButton.className = 'export'
    this.exportButton.dataset.testid = 'export'
    this.exportButton.addEventListener('click', () => actions.exportPdf())
    this.setExporting(false)
    el.append(this.clock.el, this.switches.el, this.name, this.state, this.exportButton)
    this.clock.start()
  }

  /** Stops the clock (tests; the status line lives as long as the window). */
  stop(): void {
    this.clock.stop()
  }

  get exporting(): boolean {
    return this.busy
  }

  render(file: string | null, state: SaveState, error: string | null, view: View): void {
    this.switches.render('edit', view, file !== null)
    this.name.textContent = file ?? ''
    this.state.textContent = saveText(state, error)
    // A hold is as prominent as a failed save.
    this.state.classList.toggle('error', state === 'error' || state === 'held')
    this.exportButton.hidden = file === null
  }

  setExporting(on: boolean): void {
    this.busy = on
    this.exportButton.disabled = on
    this.exportButton.classList.toggle('busy', on)
    this.exportButton.textContent = on ? 'Exportiere …' : 'PDF exportieren'
  }
}

/** The status text; a reason is appended for a failed save or a hold. */
export function saveText(state: SaveState, reason: string | null): string {
  return (state === 'error' || state === 'held') && reason
    ? `${SAVE_STATE_LABEL[state]}: ${reason}`
    : SAVE_STATE_LABEL[state]
}

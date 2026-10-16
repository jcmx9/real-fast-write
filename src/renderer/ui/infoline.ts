import { zoomLabel } from './zoom'

export interface InfoLineTab {
  name: string
  dirty: boolean
}

export interface InfoLineActions {
  selectTab(index: number): void
  exitPresent(): void
  zoomIn(): void
  zoomOut(): void
}

export function formatClock(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function button(
  testid: string,
  text: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.tabIndex = -1
  b.dataset.testid = testid
  b.textContent = text
  b.title = title
  // tabIndex -1 does not stop a mouse click from focusing the button in Chromium;
  // cancelling mousedown keeps focus in the editor while click still fires.
  b.addEventListener('mousedown', (e) => {
    if (e.button === 0) e.preventDefault()
  })
  b.addEventListener('click', onClick)
  return b
}

/** Present's only chrome: clock, tabs, back to Edit, zoom, save state. */
export class InfoLine {
  private readonly clock = document.createElement('span')
  private readonly tabs = document.createElement('span')
  private readonly zoom = document.createElement('span')
  private readonly state = document.createElement('span')
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Kept across refreshes: replacing a button between mousedown and mouseup loses the click. */
  private readonly tabButtons: HTMLButtonElement[] = []

  constructor(
    el: HTMLElement,
    private readonly actions: InfoLineActions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.clock.className = 'rf-il-clock'
    this.clock.dataset.testid = 'il-clock'
    this.tabs.className = 'rf-il-tabs'
    this.zoom.className = 'rf-il-zoom'
    this.zoom.dataset.testid = 'il-zoom'
    this.state.className = 'rf-il-state'
    this.state.dataset.testid = 'il-state'
    const spacer = document.createElement('span')
    spacer.className = 'rf-il-spacer'
    el.replaceChildren(
      this.clock,
      this.tabs,
      spacer,
      button('il-edit', 'Bearbeiten', 'Präsentation beenden (Esc)', () => actions.exitPresent()),
      button('il-zoom-out', '−', 'Verkleinern', () => actions.zoomOut()),
      this.zoom,
      button('il-zoom-in', '+', 'Vergrößern', () => actions.zoomIn()),
      this.state,
    )
  }

  start(): void {
    this.stop()
    this.tick()
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  render(tabs: readonly InfoLineTab[], active: number, saveText: string, zoom: number): void {
    // Update in place; only a changed tab count adds or removes buttons at the end.
    while (this.tabButtons.length > tabs.length) this.tabButtons.pop()?.remove()
    while (this.tabButtons.length < tabs.length) {
      const i = this.tabButtons.length
      const b = button('il-tab', '', '', () => this.actions.selectTab(i))
      b.classList.add('rf-il-tab')
      this.tabButtons.push(b)
      this.tabs.append(b)
    }
    tabs.forEach((t, i) => {
      const b = this.tabButtons[i] as HTMLButtonElement
      if (b.textContent !== t.name) b.textContent = t.name
      if (b.title !== t.name) b.title = t.name
      b.classList.toggle('active', i === active)
      b.classList.toggle('dirty', t.dirty)
    })
    this.state.textContent = saveText
    this.zoom.textContent = zoomLabel(zoom)
  }

  /** Shows the time and schedules the next tick at the next minute boundary. */
  private tick(): void {
    const d = this.now()
    this.clock.textContent = formatClock(d)
    const untilNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds())
    this.timer = setTimeout(() => this.tick(), untilNextMinute)
  }
}

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
  b.addEventListener('click', onClick)
  return b
}

/** Present's only chrome: clock, tabs, back to Edit, zoom, save state. */
export class InfoLine {
  private readonly clock = document.createElement('span')
  private readonly tabs = document.createElement('span')
  private readonly zoom = document.createElement('span')
  private readonly state = document.createElement('span')
  private timer: ReturnType<typeof setInterval> | null = null

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
    this.tick()
    if (this.timer === null) this.timer = setInterval(() => this.tick(), 15_000)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  render(tabs: readonly InfoLineTab[], active: number, saveText: string, zoom: number): void {
    this.tabs.replaceChildren(
      ...tabs.map((t, i) => {
        const b = button('il-tab', t.name, t.name, () => this.actions.selectTab(i))
        b.classList.add('rf-il-tab')
        b.classList.toggle('active', i === active)
        b.classList.toggle('dirty', t.dirty)
        return b
      }),
    )
    this.state.textContent = saveText
    this.zoom.textContent = zoomLabel(zoom)
  }

  private tick(): void {
    this.clock.textContent = formatClock(this.now())
  }
}

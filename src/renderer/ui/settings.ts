import type {
  ChooseKind,
  HeaderDefault,
  Settings,
  SettingsPatch,
  SettingsStatus,
} from '../../shared/types'

export interface SettingsDialogDeps {
  settings: Settings
  /** Resolves while the dialog is open; the status block says so until then. */
  status: Promise<SettingsStatus>
  choose(kind: ChooseKind, current: string): Promise<string | null>
}

const FACTOR_MIN = 1
const FACTOR_MAX = 3
const FACTOR_ERROR = 'Schriftfaktor: bitte eine Zahl von 1.0 bis 3.0 angeben.'

/** Present font factor from the input; accepts a German decimal comma. Null when invalid. */
export function parseFactor(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n >= FACTOR_MIN && n <= FACTOR_MAX ? n : null
}

/** POSIX, drive-letter or UNC path; the renderer has no `path` module. */
export function isAbsolutePath(p: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p)
}

export function statusLines(s: SettingsStatus): { rfDocument: string; fonts: string } {
  const r = s.rfDocument
  return {
    rfDocument: r.path
      ? `rf-document: gefunden – ${r.path} (Version ${r.version ?? 'unbekannt'})`
      : 'rf-document: nicht gefunden',
    fonts: s.fonts.found
      ? `Schriften: gefunden in ${s.fonts.dir}`
      : `Schriften: fehlen: ${s.fonts.missing.join(', ')}`,
  }
}

/** The status block gives up after this long (a stalled network drive, a hanging lookup). */
export const STATUS_TIMEOUT_MS = 15_000

export class StatusTimeout extends Error {
  constructor(readonly ms: number) {
    super(`keine Antwort nach ${Math.round(ms / 1000)} s`)
  }
}

/** Rejects with StatusTimeout unless `promise` settles within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StatusTimeout(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

interface PathField {
  key: 'defaultFolder' | 'snippetFolder' | 'rfDocumentPath'
  testid: string
  label: string
  kind: ChooseKind
  /** Empty allowed (rf-document = locate automatically). */
  optional: boolean
}

const PATH_FIELDS: readonly PathField[] = [
  {
    key: 'defaultFolder',
    testid: 'default-folder',
    label: 'Standardordner für neue Notizen',
    kind: 'folder',
    optional: false,
  },
  {
    key: 'snippetFolder',
    testid: 'snippet-folder',
    label: 'Snippet-Ordner',
    kind: 'folder',
    optional: false,
  },
  {
    key: 'rfDocumentPath',
    testid: 'rf-document',
    label: 'rf-document',
    kind: 'file',
    optional: true,
  },
]

const DROP_REASONS: Record<keyof Settings, string> = {
  defaultFolder: 'kein gültiger absoluter Pfad',
  snippetFolder: 'kein gültiger absoluter Pfad',
  rfDocumentPath: 'keine ausführbare Datei namens rf-document',
  presentFontFactor: 'ungültiger Wert',
  headerDefault: 'ungültiger Wert',
}

const FACTOR_LABEL = 'Schriftfaktor im Präsentationsmodus'

const FIELD_LABELS: Record<keyof Settings, string> = {
  ...(Object.fromEntries(PATH_FIELDS.map((f) => [f.key, f.label])) as Record<
    PathField['key'],
    string
  >),
  presentFontFactor: FACTOR_LABEL,
  headerDefault: 'YAML-Header in der Vorschau',
}

/**
 * The dialog's values that main refused (it keeps the current one instead), as
 * "<label>: <reason>" lines in dialog order. Empty when everything was stored.
 */
export function droppedFields(patch: SettingsPatch, saved: Settings): string[] {
  return (Object.keys(FIELD_LABELS) as (keyof Settings)[])
    .filter((key) => patch[key] !== undefined && patch[key] !== saved[key])
    .map((key) => `${FIELD_LABELS[key]}: ${DROP_REASONS[key]}`)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  testid?: string,
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  if (testid) node.setAttribute('data-testid', testid)
  return node
}

/**
 * Modal settings dialog (same look as the rename prompt). Resolves to the changed values, or
 * null on Abbrechen/Esc. Enter saves. Invalid input keeps the dialog open with a message;
 * main validates again before anything is stored.
 */
export function openSettings(deps: SettingsDialogDeps): Promise<SettingsPatch | null> {
  const { settings } = deps
  return new Promise((resolve) => {
    const dialog = el('dialog', { className: 'prompt settings' })
    // Own validation with German messages; native validation would silently refuse e.g. 2.2
    // (step mismatch from floating point) without a submit event.
    const form = el('form', { noValidate: true })
    const inputs = new Map<PathField['key'], HTMLInputElement>()
    const rows: HTMLElement[] = []

    for (const f of PATH_FIELDS) {
      const input = el(
        'input',
        { type: 'text', value: settings[f.key], spellcheck: false },
        `settings-${f.testid}`,
      )
      if (f.optional) input.placeholder = 'leer = automatisch'
      input.setAttribute('aria-label', f.label)
      inputs.set(f.key, input)
      const choose = el(
        'button',
        { type: 'button', textContent: 'Wählen …' },
        `settings-choose-${f.testid}`,
      )
      choose.addEventListener('click', () => {
        void deps.choose(f.kind, input.value.trim()).then((picked) => {
          if (picked) input.value = picked
        })
      })
      const row = el('div', { className: 'settings-path' })
      row.append(input, choose)
      const label = el('label', { textContent: f.label })
      label.append(row)
      rows.push(label)
    }

    const factor = el(
      'input',
      { type: 'number', value: String(settings.presentFontFactor) },
      'settings-factor',
    )
    factor.min = String(FACTOR_MIN)
    factor.max = String(FACTOR_MAX)
    factor.step = '0.1'
    const factorLabel = el('label', { textContent: FACTOR_LABEL })
    factorLabel.append(factor)

    const header = el('fieldset', { className: 'settings-header' })
    header.append(el('legend', { textContent: 'YAML-Header in der Vorschau:' }))
    const radios = new Map<HeaderDefault, HTMLInputElement>()
    for (const [value, text] of [
      ['yaml', 'als YAML'],
      ['titleblock', 'als Titelblock'],
    ] as const) {
      const radio = el(
        'input',
        { type: 'radio', name: 'headerDefault', value, checked: settings.headerDefault === value },
        `settings-header-${value}`,
      )
      radios.set(value, radio)
      const label = el('label', { className: 'settings-radio' })
      label.append(radio, ` ${text}`)
      header.append(label)
    }

    const status = el('div', { className: 'settings-status' })
    const rfd = el('div', { textContent: 'rf-document: wird geprüft …' }, 'settings-status-rfd')
    const fonts = el('div', {}, 'settings-status-fonts')
    status.append(el('h3', { textContent: 'Status' }), rfd, fonts)
    deps.status.then(
      (s) => {
        const lines = statusLines(s)
        rfd.textContent = lines.rfDocument
        fonts.textContent = lines.fonts
      },
      (e: unknown) => {
        rfd.textContent =
          e instanceof StatusTimeout
            ? `Status nicht verfügbar (${e.message})`
            : 'Status nicht verfügbar'
      },
    )

    const error = el('p', { className: 'settings-error', hidden: true }, 'settings-error')
    error.setAttribute('role', 'alert')
    const cancel = el('button', { type: 'button', textContent: 'Abbrechen' }, 'settings-cancel')
    const save = el('button', { type: 'submit', textContent: 'Speichern' }, 'settings-save')
    const actions = el('div', { className: 'actions' })
    actions.append(cancel, save)
    form.append(
      el('h2', { textContent: 'Einstellungen' }),
      ...rows,
      factorLabel,
      header,
      status,
      error,
      actions,
    )
    dialog.append(form)

    let settled = false
    const finish = (result: SettingsPatch | null) => {
      if (settled) return
      settled = true
      if (dialog.open) dialog.close()
      dialog.remove()
      resolve(result)
    }

    const fail = (message: string, focus: HTMLInputElement) => {
      error.textContent = message
      error.hidden = false
      focus.focus()
    }

    const submit = () => {
      const patch: SettingsPatch = {}
      for (const f of PATH_FIELDS) {
        const input = inputs.get(f.key) as HTMLInputElement
        const value = input.value.trim()
        if (!(f.optional && value === '') && !isAbsolutePath(value)) {
          fail(`${f.label}: bitte einen absoluten Pfad angeben.`, input)
          return
        }
        if (value !== settings[f.key]) patch[f.key] = value
      }
      const n = parseFactor(factor.value)
      if (n === null) {
        fail(FACTOR_ERROR, factor)
        return
      }
      if (n !== settings.presentFontFactor) patch.presentFontFactor = n
      const chosen = radios.get('titleblock')?.checked ? 'titleblock' : 'yaml'
      if (chosen !== settings.headerDefault) patch.headerDefault = chosen
      finish(patch)
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submit()
    })
    cancel.addEventListener('click', () => finish(null))
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(null)
      } else if (e.key === 'Enter' && !e.isComposing && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        submit()
      }
    })
    // The native cancel (Esc handled by the browser) closes the dialog: treat it as Abbrechen.
    dialog.addEventListener('close', () => finish(null))

    document.body.append(dialog)
    dialog.showModal()
    inputs.get('defaultFolder')?.focus()
  })
}

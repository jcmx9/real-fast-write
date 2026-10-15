import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron, type Page } from '@playwright/test'

export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

export interface Dirs {
  root: string
  notes: string
  userData: string
}

export interface Launched extends Dirs {
  app: ElectronApplication
  page: Page
}

/** Notes live in a folder with spaces; realpath expands Windows 8.3 names (RUNNER~1). */
export async function makeDirs(): Promise<Dirs> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rfw-e2e-')))
  const notes = join(root, 'Notizen mit Leerzeichen')
  const userData = join(root, 'user-data')
  await mkdir(notes, { recursive: true })
  await mkdir(userData, { recursive: true })
  return { root, notes, userData }
}

export async function launch(
  opts: {
    args?: string[]
    settings?: Record<string, unknown>
    env?: Record<string, string>
    dirs?: Dirs
  } = {},
): Promise<Launched> {
  const dirs = opts.dirs ?? (await makeDirs())
  await writeFile(
    join(dirs.userData, 'settings.json'),
    JSON.stringify({ defaultFolder: dirs.notes, ...opts.settings }),
  )
  const env = { ...process.env, RFW_USER_DATA: dirs.userData, ...opts.env } as Record<
    string,
    string
  >
  const app = await electron.launch({ args: ['.', ...(opts.args ?? [])], env })
  const page = await app.firstWindow()
  await page.locator('.cm-editor').waitFor()
  await page.locator('[data-testid=tab]').first().waitFor()
  return { ...dirs, app, page }
}

/** Menu accelerators do not fire for synthetic key events, so click the item. */
export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) throw new Error(`menu item ${menuId} missing`)
    item.click()
  }, id)
}

export async function waitForFile(
  path: string,
  accept: (b: Buffer) => boolean = () => true,
  timeoutMs = 5000,
): Promise<Buffer> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      const b = await readFile(path)
      if (accept(b)) return b
    } catch {
      // not there yet
    }
    if (Date.now() > end) throw new Error(`timeout waiting for ${path}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press(`${MOD}+End`)
  await page.keyboard.type(text)
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: join('test-results', 'screenshots', `${process.platform}-${name}.png`),
  })
}

import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')
const linux = process.platform === 'linux'

async function openFixture() {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.rf-preview').waitFor()
  return { ...launched, note }
}

const fullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen() ?? false)

const bodySize = (page: import('@playwright/test').Page) =>
  page.locator('.cm-scroller').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))

test('Present: fullscreen, title block, info line only; Esc returns', async () => {
  const { app, page } = await openFixture()
  const editSize = await bodySize(page)
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await expect(page.locator('#tabbar')).toBeHidden()
  await expect(page.locator('#status')).toBeHidden()
  await expect(page.getByTestId('il-clock')).toHaveText(/^\d{2}:\d{2}$/)
  await expect(page.locator('.cm-editor.rf-present .rf-tb-title')).toHaveText(
    'Kickoff Kaffeerösterei',
  )
  await expect(page.locator('.cm-line.rf-frontmatter')).toHaveCount(0)
  expect(await bodySize(page)).toBeGreaterThan(editSize * 1.5)
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(true)
  await shot(page, 'present')
  await page.locator('.cm-line', { hasText: 'Ein Absatz mit' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)
  await expect(page.locator('#tabbar')).toBeVisible()
  await expect(page.locator('#infoline')).toBeHidden()
  if (!linux) await expect.poll(() => fullScreen(app)).toBe(false)
  await app.close()
})

test('typing in Present is saved; the header stays untouched', async () => {
  const { app, page, note } = await openFixture()
  const original = await readFile(note, 'utf8')
  await clickMenu(app, 'toggle-present')
  await page.locator('.cm-line', { hasText: 'Text unter drei Rauten' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Neu im Termin.')
  const saved = await waitForFile(note, (b) => b.toString('utf8').includes('Neu im Termin.'))
  expect(
    saved.toString('utf8').startsWith(original.slice(0, original.indexOf('\n---\n') + 5)),
  ).toBe(true)
  await app.close()
})

test('Present from Code view shows Preview and returns to Code', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-view')
  await expect(page.locator('.cm-editor.rf-code')).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.rf-preview.rf-present')).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('.cm-editor.rf-code')).toBeVisible()
  await app.close()
})

test('info line: tabs switch, zoom changes and is restored after restart', async () => {
  const dirs = await makeDirs()
  const a = join(dirs.notes, 'Kickoff.md')
  const b = join(dirs.notes, 'Zweite.md')
  await copyFile(FIXTURE, a)
  await writeFile(b, '# Zweite Notiz\n\nInhalt.\n')
  const first = await launch({ dirs, args: [a, b] })
  await clickMenu(first.app, 'toggle-present')
  await expect(first.page.getByTestId('il-tab')).toHaveCount(2)
  await first.page.getByTestId('il-tab').first().click()
  await expect(first.page.locator('.rf-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  const before = await bodySize(first.page)
  await first.page.getByTestId('il-zoom-in').click()
  await expect(first.page.getByTestId('il-zoom')).toHaveText('110 %')
  expect(await bodySize(first.page)).toBeGreaterThan(before)
  await first.page.waitForTimeout(800)
  await first.app.close()
  const second = await launch({ dirs })
  await expect(second.page.locator('body.rf-mode-present')).toHaveCount(0)
  await clickMenu(second.app, 'toggle-present')
  await expect(second.page.getByTestId('il-zoom')).toHaveText('110 %')
  await second.app.close()
})

test('zoom in Edit scales the text; reset returns to 100 %', async () => {
  const { app, page } = await openFixture()
  const base = await bodySize(page)
  await clickMenu(app, 'zoom-in')
  await expect.poll(() => bodySize(page)).toBeGreaterThan(base)
  await clickMenu(app, 'zoom-reset')
  await expect.poll(() => bodySize(page)).toBe(base)
  await app.close()
})

test('export, view switch and header toggle are refused in Present', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  for (const cmd of ['export', 'toggle-view', 'toggle-header']) {
    await clickMenu(app, cmd)
    await expect(page.locator('.toast').last()).toContainText(
      'Im Präsentationsmodus nicht verfügbar',
    )
  }
  await expect(page.locator('.cm-editor.rf-preview.rf-present')).toBeVisible()
  await expect(page.locator('.panel')).toHaveCount(0)
  await app.close()
})

test('Esc does not leave Present while the rename dialog is open', async () => {
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await clickMenu(app, 'rename')
  await expect(page.locator('dialog.prompt')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.prompt')).toHaveCount(0)
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await app.close()
})

test('an OS fullscreen exit leaves Present cleanly', async () => {
  test.skip(linux, 'no window manager fullscreen under xvfb')
  const { app, page } = await openFixture()
  await clickMenu(app, 'toggle-present')
  await expect.poll(() => fullScreen(app)).toBe(true)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setFullScreen(false))
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)
  await expect(page.locator('#tabbar')).toBeVisible()
  await app.close()
})

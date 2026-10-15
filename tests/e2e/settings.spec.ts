import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { makeFakeRfDocument } from '../helpers/fake-rf-document'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')

const bodySize = (page: import('@playwright/test').Page) =>
  page.locator('.cm-scroller').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))

test('settings: status, Present font factor applies at once and persists', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const fake = await makeFakeRfDocument(dirs.root, { stdout: 'rf-document 9.9.9' })
  const { app, page, userData } = await launch({
    dirs,
    args: [note],
    settings: { rfDocumentPath: fake.bin },
  })
  const editSize = await bodySize(page)

  await clickMenu(app, 'settings')
  const dialog = page.locator('dialog.settings')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('settings-status-rfd')).toHaveText(
    `rf-document: gefunden – ${fake.bin} (Version 9.9.9)`,
  )
  await expect(page.getByTestId('settings-status-fonts')).toHaveText(/^Schriften: /)
  await expect(page.getByTestId('settings-factor')).toHaveValue('1.6')
  await shot(page, 'settings')
  await page.getByTestId('settings-factor').fill('2.5')
  await page.getByTestId('settings-factor').press('Enter')
  await expect(dialog).toHaveCount(0)

  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await expect.poll(() => bodySize(page)).toBeCloseTo(editSize * 2.5, 0)

  // Refused in Present, like the export.
  await clickMenu(app, 'settings')
  await expect(page.locator('.toast')).toContainText('Im Präsentationsmodus nicht verfügbar')
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)

  const stored = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))
  expect(stored).toMatchObject({ presentFontFactor: 2.5, rfDocumentPath: fake.bin })
  await app.close()
})

test('settings: Esc cancels; an invalid factor is refused and nothing is stored', async () => {
  const { app, page, userData } = await launch()
  await clickMenu(app, 'settings')
  await page.getByTestId('settings-factor').fill('5')
  await page.getByTestId('settings-save').click()
  await expect(page.getByTestId('settings-error')).toHaveText(
    'Schriftfaktor: bitte eine Zahl von 1.0 bis 3.0 angeben.',
  )
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.settings')).toHaveCount(0)
  const stored = JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8'))
  expect(stored.presentFontFactor).toBeUndefined()
  await app.close()
})

test('settings: header default „als Titelblock“ applies to a newly opened note', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const original = await readFile(note)
  const { app, page } = await launch({ dirs })
  await clickMenu(app, 'settings')
  await page.getByTestId('settings-header-titleblock').check()
  await page.getByTestId('settings-save').click()
  await expect(page.locator('dialog.settings')).toHaveCount(0)
  // The dialog closes before main has stored the change: open the note only afterwards.
  await waitForFile(join(dirs.userData, 'settings.json'), (b) =>
    b.toString('utf8').includes('"headerDefault": "titleblock"'),
  )

  await app.evaluate(({ app: electronApp }, path) => {
    electronApp.emit('open-file', { preventDefault: () => undefined }, path)
  }, note)
  await expect(page.locator('[data-testid=tab]')).toHaveCount(2)
  await expect(page.locator('.rf-titleblock .rf-tb-title')).toHaveText('Kickoff Kaffeerösterei')
  await expect(page.locator('.cm-line.rf-frontmatter')).toHaveCount(0)
  await page.waitForTimeout(1000)
  expect((await readFile(note)).equals(original)).toBe(true)
  await app.close()
})

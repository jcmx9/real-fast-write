import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { clickMenu, launch, MOD, makeDirs, typeInEditor, waitForFile } from './helpers'

const webContents = (
  app: import('@playwright/test').ElectronApplication,
  method: 'copy' | 'cut' | 'paste',
) =>
  app.evaluate(({ BrowserWindow }, m) => {
    BrowserWindow.getAllWindows()[0]?.webContents[m]()
  }, method)

test('select all covers a long note beyond the rendered viewport', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'lang.md')
  await writeFile(file, Array.from({ length: 2000 }, (_, i) => `Zeile ${i}`).join('\n'))
  const { app, page } = await launch({ dirs, args: [file] })
  await page.locator('.cm-content').click()
  await clickMenu(app, 'select-all')
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible()
  await page.keyboard.type('X')
  await waitForFile(file, (b) => b.toString('utf8') === 'X')
  await app.close()
})

test('copy puts the whole note on the clipboard', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'copy.md')
  await writeFile(file, 'Hallo Welt')
  const { app, page } = await launch({ dirs, args: [file] })
  await page.locator('.cm-content').click()
  await clickMenu(app, 'select-all')
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible()
  await webContents(app, 'copy')
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Hallo Welt')
  await app.close()
})

test('cut and paste move text within the note', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'cut.md')
  await writeFile(file, 'Hallo Welt')
  const { app, page } = await launch({ dirs, args: [file] })
  await typeInEditor(page, '')
  await page.keyboard.press(`${MOD}+End`)
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
  await webContents(app, 'cut')
  await page.keyboard.press(`${MOD}+Home`)
  await webContents(app, 'paste')
  await waitForFile(file, (b) => b.toString('utf8') === 'WeltHallo ')
  await app.close()
})

test('word-wise selection replaces the last word', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'wort.md')
  await writeFile(file, 'eins zwei drei')
  const { app, page } = await launch({ dirs, args: [file] })
  await typeInEditor(page, '')
  await page.keyboard.press(`Shift+${MOD === 'Meta' ? 'Alt' : 'Control'}+ArrowLeft`)
  await page.keyboard.type('vier')
  await waitForFile(file, (b) => b.toString('utf8') === 'eins zwei vier')
  await app.close()
})

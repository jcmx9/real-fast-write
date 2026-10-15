import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch, makeDirs, typeInEditor, waitForFile } from './helpers'

const tabs = (page: import('@playwright/test').Page) => page.locator('[data-testid=tab]')

async function missing(path: string): Promise<boolean> {
  return access(path).then(
    () => false,
    () => true,
  )
}

test('an external non-UTF-8 write holds the tab until the user overwrites it', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'ansi.md')
  await writeFile(file, 'alt')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('alt')
  const ansi = Buffer.from('Grüße aus Windows', 'latin1')
  await writeFile(file, ansi)
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(
    /„ansi\.md“ wurde außerhalb geändert und ist kein gültiges UTF-8\. rf-write speichert nicht darüber\./,
  )
  await expect(page.getByTestId('status-state')).toHaveClass(/error/)
  await typeInEditor(page, ' meins')
  await page.waitForTimeout(3000)
  expect((await readFile(file)).equals(ansi)).toBe(true)
  await banner.getByRole('button', { name: 'Meine Fassung speichern (überschreiben)' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'alt meins')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('overwriting unreadable bytes also works for a clean tab', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'ansi2.md')
  await writeFile(file, 'sauber')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('sauber')
  await writeFile(file, Buffer.from('ä', 'latin1'))
  await page
    .locator('.banner')
    .getByRole('button', { name: 'Meine Fassung speichern (überschreiben)' })
    .click()
  await waitForFile(file, (b) => b.toString('utf8') === 'sauber')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('a deleted note is only recreated after the user chose to save again', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'weg.md')
  await writeFile(file, 'da')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('da')
  await rm(file)
  const banner = page.locator('.banner')
  await expect(banner).toHaveText(/„weg\.md“ wurde außerhalb gelöscht\./)
  await typeInEditor(page, ' noch')
  await page.waitForTimeout(3000)
  expect(await missing(file)).toBe(true)
  await banner.getByRole('button', { name: 'Erneut speichern' }).click()
  await waitForFile(file, (b) => b.toString('utf8') === 'da noch')
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

test('„Tab schließen“ closes a held tab without asking and without saving', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'zu.md')
  const other = join(dirs.notes, 'bleibt.md')
  await writeFile(file, 'zu')
  await writeFile(other, 'bleibt')
  const { app, page } = await launch({ dirs, args: [other, file] })
  await expect(tabs(page)).toHaveCount(2)
  await expect(page.locator('.cm-content')).toContainText('zu')
  await rm(file)
  await typeInEditor(page, ' getippt')
  await page.locator('.banner').getByRole('button', { name: 'Tab schließen' }).click()
  await expect(tabs(page)).toHaveCount(1)
  await expect(page.locator('.banner')).toHaveCount(0)
  await page.waitForTimeout(1000)
  expect(await missing(file)).toBe(true)
  await app.close()
})

test('a deleted note that reappears outside replaces the hold with a reload', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'zurueck.md')
  await writeFile(file, 'eins')
  const { app, page } = await launch({ dirs, args: [file] })
  await expect(page.locator('.cm-content')).toContainText('eins')
  await rm(file)
  await expect(page.locator('.banner')).toHaveText(/wurde außerhalb gelöscht/)
  await writeFile(file, 'zwei')
  await expect(page.locator('.cm-content')).toContainText('zwei')
  await expect(page.locator('.banner')).toHaveCount(0)
  await expect(page.getByTestId('status-state')).toHaveText('Gespeichert')
  await app.close()
})

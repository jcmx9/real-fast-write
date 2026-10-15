import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { clickMenu, launch, makeDirs, waitForFile } from './helpers'

const today = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/** A new note is created on the first keystroke; wait until its .md file exists. */
async function newNotePath(notes: string): Promise<string> {
  const end = Date.now() + 5000
  for (;;) {
    const found = (await readdir(notes)).find((n) => n.endsWith('.md'))
    if (found) return join(notes, found)
    if (Date.now() > end) throw new Error('no note was created')
    await new Promise((r) => setTimeout(r, 100))
  }
}

const popup = (page: Page) => page.locator('.cm-tooltip-autocomplete')

/** Completion opens after a short delay and ignores accept keys right after opening. */
async function acceptFirst(page: Page): Promise<void> {
  await expect(popup(page)).toBeVisible()
  await expect(popup(page).locator('li[aria-selected=true]')).toHaveCount(1)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
}

test('new note, :meeting, tab through the stops, autosaved', async () => {
  const { app, page, notes } = await launch()
  await clickMenu(app, 'new')
  await page.locator('.cm-content').click()
  await page.keyboard.type(':mee')
  await expect(popup(page).locator('li')).toHaveCount(1)
  await expect(popup(page)).toContainText(':meeting')
  await acceptFirst(page)
  await page.keyboard.type('ACME')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Kickoff')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Anna')
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('- Anna'))
  expect(
    saved.toString('utf8').startsWith(`---\nclient: "ACME"\ntitle: "Kickoff"\ndate: ${today()}\n`),
  ).toBe(true)
  await app.close()
})

test('prose colons do not trigger: "Hinweis:" and ":D" followed by Enter', async () => {
  const { app, page, notes } = await launch()
  await page.locator('.cm-content').click()
  await page.keyboard.type('Hinweis:')
  await page.waitForTimeout(400)
  await expect(popup(page)).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Super :D')
  await page.waitForTimeout(400)
  await expect(popup(page)).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ende')
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('Ende'))
  expect(saved.toString('utf8')).toBe('Hinweis:\nSuper :D\nEnde')
  await app.close()
})

test('Present: first Esc closes the list, second Esc leaves Present', async () => {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Present.md')
  await writeFile(note, '# Titel\n\nText')
  const { app, page } = await launch({ dirs, args: [note] })
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await page.locator('.cm-line', { hasText: 'Text' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' :mee')
  await expect(popup(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)
  await app.close()
})

test('user snippet overrides a built-in and a new file appears after focus', async () => {
  const dirs = await makeDirs()
  const snippetFolder = join(dirs.root, 'snippets')
  await mkdir(snippetFolder)
  await writeFile(join(snippetFolder, 'meeting.tpl.md'), 'Eigenes $1')
  const { app, page, notes } = await launch({ dirs, settings: { snippetFolder } })
  await page.locator('.cm-content').click()
  await page.keyboard.type(':meeting')
  await acceptFirst(page)
  const path = await newNotePath(notes)
  await waitForFile(path, (b) => b.toString('utf8') === 'Eigenes ')

  await writeFile(join(snippetFolder, 'kunde.tpl.md'), 'Kunde: $1')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.keyboard.press('Enter')
  await page.keyboard.type(':kun')
  await expect(popup(page)).toContainText(':kunde')
  await app.close()
})

test(':newpage inserts the page break byte-exact', async () => {
  const { app, page, notes } = await launch()
  await page.locator('.cm-content').click()
  await page.keyboard.type(':newp')
  await acceptFirst(page)
  const path = await newNotePath(notes)
  const saved = await waitForFile(path, (b) => b.toString('utf8').includes('pagebreak'))
  expect(saved.toString('utf8')).toBe('\n<!-- pagebreak -->\n\n')
  await app.close()
})

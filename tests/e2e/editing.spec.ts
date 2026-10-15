import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { clickMenu, launch, MOD, makeDirs, test, typeInEditor, waitForFile } from './helpers'

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

test('select all in the rename dialog acts on the input, not the editor', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'dialog.md')
  await writeFile(file, 'Inhalt der Notiz')
  const { app, page } = await launch({ dirs, args: [file] })
  await clickMenu(app, 'rename')
  const input = page.locator('dialog.prompt input')
  await input.fill('abc')
  await clickMenu(app, 'select-all')
  await expect.poll(() => input.evaluate((el: HTMLInputElement) => el.selectionEnd)).toBe(3)
  await page.keyboard.type('neu')
  await expect(input).toHaveValue('neu')
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog.prompt')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('Inhalt der Notiz')
  expect(await readFile(file, 'utf8')).toBe('Inhalt der Notiz')
  await app.close()
})

test('select all still reaches the editor when a button has focus', async () => {
  const dirs = await makeDirs()
  const file = join(dirs.notes, 'button.md')
  await writeFile(file, 'Inhalt')
  const { app, page } = await launch({ dirs, args: [file] })
  await page.getByTestId('export').focus()
  await clickMenu(app, 'select-all')
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible()
  await page.keyboard.type('X')
  await waitForFile(file, (b) => b.toString('utf8') === 'X')
  await app.close()
})

/**
 * Types without pause, triggers `stop` in main, and checks that the file holds exactly the
 * editor text at the freeze (the renderer's last report before the window disappeared).
 */
async function typeUntilGone(
  name: string,
  stop: (app: import('@playwright/test').ElectronApplication) => Promise<void>,
): Promise<void> {
  const dirs = await makeDirs()
  const file = join(dirs.notes, name)
  await writeFile(file, 'Start')
  const { app, page } = await launch({ dirs, args: [file] })
  // The renderer reports the editor text when input freezes and when the page unloads; the
  // last report is the editor content right before the window disappeared.
  const reports: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (t.startsWith('RFW-TEXT:')) reports.push(t.slice('RFW-TEXT:'.length))
  })
  await page.evaluate(() => {
    const content = document.querySelector('.cm-content') as HTMLElement
    const text = () =>
      [...content.querySelectorAll('.cm-line')].map((l) => l.textContent ?? '').join('\n')
    new MutationObserver(() => {
      if (content.getAttribute('contenteditable') === 'false') console.log(`RFW-TEXT:${text()}`)
    }).observe(content, { attributes: true, attributeFilter: ['contenteditable'] })
    window.addEventListener('beforeunload', () => console.log(`RFW-TEXT:${text()}`))
  })
  await typeInEditor(page, ' ')
  const closed = page.waitForEvent('close')
  const typing = (async () => {
    for (let i = 0; ; i++) {
      try {
        await page.keyboard.type(`w${i}abcdefgh `)
      } catch {
        return
      }
    }
  })()
  await new Promise((r) => setTimeout(r, 400))
  await stop(app)
  await closed
  await typing
  const last = reports.at(-1)
  expect(last, 'renderer reported its text before closing').toBeDefined()
  expect(last?.length).toBeGreaterThan('Start w0'.length)
  expect(await readFile(file, 'utf8')).toBe(last)
  await app.close().catch(() => {})
}

test('closing while typing saves every keystroke typed before the freeze', async () => {
  await typeUntilGone('schnell.md', (app) =>
    app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close()
    }),
  )
})

test('quitting the app (Cmd+Q path) while typing saves every keystroke typed before the freeze', async () => {
  // app.quit() goes through before-quit and the same beforeClose handshake as the menu's Quit.
  await typeUntilGone('quit.md', (app) =>
    app.evaluate(({ app: electronApp }) => {
      electronApp.quit()
    }),
  )
})

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { makeFakeRfDocument } from '../helpers/fake-rf-document'
import { clickMenu, launch, makeDirs, shot, test } from './helpers'

test('shows rf-document stderr when the export fails', async () => {
  const dirs = await makeDirs()
  const { bin } = await makeFakeRfDocument(dirs.root, { stderr: 'Fehler: Testfehler', code: 4 })
  const note = join(dirs.notes, 'notiz.md')
  await writeFile(note, '# Test\n')
  const { app, page } = await launch({ dirs, args: [note], settings: { rfDocumentPath: bin } })
  await clickMenu(app, 'export')
  await expect(page.locator('.panel')).toContainText('Fehler: Testfehler')
  await shot(page, 'export-error')
  await app.close()
})

test('passes the saved note to rf-document and shows its message', async () => {
  const dirs = await makeDirs()
  const { bin, argsFile } = await makeFakeRfDocument(dirs.root, { stdout: 'OK erzeugt' })
  const note = join(dirs.notes, 'notiz.md')
  await writeFile(note, '# Test\n')
  const { app, page } = await launch({ dirs, args: [note], settings: { rfDocumentPath: bin } })
  await page.getByTestId('export').click()
  await expect(page.locator('.toast')).toContainText('OK erzeugt')
  expect((await readFile(argsFile, 'utf8')).trim()).toBe(note)
  await app.close()
})

test('exports a real PDF with rf-document', async () => {
  test.skip(!process.env.RFW_E2E_REAL_RFD, 'set RFW_E2E_REAL_RFD=1 with rf-document installed')
  test.setTimeout(180_000)
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Echter Export.md')
  await writeFile(note, '---\ntitle: "E2E"\n---\n\n# Test\n\n- [ ] Aufgabe – Name, bis 17.10.\n')
  const { app, page } = await launch({ dirs, args: [note], env: { RFD_NO_OPEN: '1' } })
  await clickMenu(app, 'export')
  // Wait for either outcome so a failed export reports rf-document's message at once.
  await expect(page.locator('.toast, .panel').first()).toBeVisible({ timeout: 150_000 })
  expect(await page.locator('.panel').allTextContents()).toEqual([])
  const pdfs = (await readdir(dirs.notes)).filter((f) => f.endsWith('.pdf'))
  expect(pdfs).toHaveLength(1)
  const head = (await readFile(join(dirs.notes, pdfs[0] as string)))
    .subarray(0, 5)
    .toString('latin1')
  expect(head).toBe('%PDF-')
  await app.close()
})

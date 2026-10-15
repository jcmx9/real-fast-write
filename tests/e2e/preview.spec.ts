import { access, copyFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { fontDir } from '../../src/main/fonts'
import { clickMenu, launch, makeDirs, shot, test, waitForFile } from './helpers'

const FIXTURE = join(__dirname, '..', 'fixtures', 'preview.md')

async function openFixture(extra: { env?: Record<string, string> } = {}) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Kickoff.md')
  await copyFile(FIXTURE, note)
  const launched = await launch({ dirs, args: [note], ...extra })
  await launched.page.locator('.cm-editor.rf-preview').waitFor()
  return { ...launched, note, original: await readFile(note) }
}

test('renders the PDF look', async () => {
  const { app, page } = await openFixture()
  await expect(page.locator('.cm-line.rf-h1')).toHaveCount(1)
  await expect(page.locator('.cm-line.rf-h2')).toHaveCount(1)
  await expect(page.locator('.rf-task')).toHaveCount(2)
  await expect(page.locator('.rf-alert-title')).toHaveText('Hinweis')
  await expect(page.locator('table.rf-table thead th')).toHaveText(['Produkt', 'Menge', 'Preis'])
  await expect(page.locator('table.rf-table tbody tr').nth(1)).toHaveClass(/rf-table-stripe/)
  await expect(page.locator('table.rf-table tbody tr').first().locator('td').nth(2)).toHaveClass(
    /rf-al-right/,
  )
  await expect(page.locator('.cm-line.rf-codeblock').first()).toBeVisible()
  // rf-document sets par(justify: true); the editor justifies without hyphenation on every OS.
  const body = page.locator('.cm-line', { hasText: 'Ein Absatz mit' })
  await expect(body).toHaveCSS('text-align', 'justify')
  await expect(body).toHaveCSS('hyphens', 'manual')
  await expect(page.locator('.cm-line.rf-h1')).toHaveCSS('text-align', 'left')
  await shot(page, 'preview')
  await app.close()
})

test('a checkbox click changes exactly one byte on disk', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('.rf-task').first().click()
  const after = await waitForFile(note, (b) => !b.equals(original))
  expect(after.length).toBe(original.length)
  const diffs = [...after].map((byte, i) => (byte === original[i] ? -1 : i)).filter((i) => i >= 0)
  expect(diffs).toHaveLength(1)
  expect(String.fromCharCode(after[diffs[0] as number] as number)).toBe('x')
  await app.close()
})

test('a table click switches to Markdown editing and back, bytes untouched', async () => {
  const { app, page, note, original } = await openFixture()
  await page.locator('table.rf-table').click()
  await expect(page.locator('table.rf-table')).toHaveCount(0)
  await expect(page.locator('.cm-line.rf-table-head')).toBeVisible()
  await shot(page, 'table-editing')
  await page.locator('.cm-line.rf-h1').click()
  await expect(page.locator('table.rf-table')).toHaveCount(1)
  await page.waitForTimeout(1500)
  expect((await readFile(note)).equals(original)).toBe(true)
  await app.close()
})

test('the YAML header collapses, stays collapsed after restart, disk untouched', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-header')
  await expect(first.page.locator('.rf-titleblock .rf-tb-title')).toHaveText(
    'Kickoff Kaffeerösterei',
  )
  await expect(first.page.locator('.rf-titleblock .rf-tb-client')).toHaveText('Muster GmbH')
  await expect(first.page.locator('.rf-titleblock .rf-tb-subtitle')).toHaveText('Protokoll')
  await expect(first.page.locator('.rf-titleblock .rf-tb-meta')).toHaveText(
    '14. Oktober 2026 · Anna',
  )
  await expect(first.page.locator('.cm-line.rf-frontmatter')).toHaveCount(0)
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await shot(first.page, 'preview-header-hidden')
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.rf-titleblock')).toBeVisible()
  await second.app.close()
})

test('code/preview switch keeps the bytes and survives a restart', async () => {
  const first = await openFixture()
  await clickMenu(first.app, 'toggle-view')
  await expect(first.page.locator('.cm-editor.rf-code')).toBeVisible()
  await expect(first.page.locator('.cm-lineNumbers')).toBeVisible()
  await shot(first.page, 'code')
  await first.page.waitForTimeout(1500)
  expect((await readFile(first.note)).equals(first.original)).toBe(true)
  await first.app.close()
  const second = await launch({ dirs: first })
  await expect(second.page.locator('.cm-editor.rf-code')).toBeVisible()
  await clickMenu(second.app, 'toggle-view')
  await expect(second.page.locator('.cm-editor.rf-preview')).toBeVisible()
  await second.app.close()
})

test('fold all hides section bodies, unfold all brings them back', async () => {
  const { app, page } = await openFixture()
  const body = page.locator('.cm-line', { hasText: 'Text unter drei Rauten' })
  await expect(body).toHaveCount(1)
  await clickMenu(app, 'fold-all')
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  await expect(body).toHaveCount(0)
  await clickMenu(app, 'unfold-all')
  await expect(body).toHaveCount(1)
  await app.close()
})

test('loads rf-document fonts when installed', async () => {
  const dir = fontDir(process.platform, process.env, homedir())
  const installed = await access(join(dir, 'SourceSans3VF-Upright.otf')).then(
    () => true,
    () => false,
  )
  test.skip(!installed, `rf-document fonts not installed in ${dir}`)
  const { app, page } = await openFixture()
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].some((f) => f.family.includes('rfdoc Sans') && f.status === 'loaded')
  })
  expect(loaded).toBe(true)
  await app.close()
})

test('missing fonts: one notice, editing still works', async () => {
  const empty = await makeDirs()
  const { app, page } = await openFixture({ env: { RFD_HOME: empty.root } })
  await expect(page.locator('.panel')).toContainText('Schriften nicht gefunden')
  await expect(page.locator('.cm-editor.rf-preview')).toBeVisible()
  await app.close()
})

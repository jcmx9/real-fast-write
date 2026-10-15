import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { clickMenu, launch, makeDirs, shot, waitForFile } from './helpers'

const NOTE = [
  '# Alpha',
  '',
  'Text alpha.',
  '',
  '## Alpha eins',
  '',
  'Text eins.',
  '',
  '## Alpha zwei',
  '',
  'Text zwei.',
  '',
  '# Beta',
  '',
  'Text beta.',
  '',
  '## Beta eins',
  '',
  'Text beta eins.',
  '',
].join('\n')

async function openNote(content = NOTE) {
  const dirs = await makeDirs()
  const note = join(dirs.notes, 'Gliederung.md')
  await writeFile(note, content)
  const launched = await launch({ dirs, args: [note] })
  await launched.page.locator('.cm-editor.rf-preview').waitFor()
  return { ...launched, note }
}

const outline = (page: Page) => page.locator('#outline')
const labels = (page: Page) => page.locator('#outline .rf-ol-label')
const chevrons = (page: Page) => page.locator('#outline .rf-ol-chevron')

async function sessionHas(userData: string, edit: boolean, present: boolean): Promise<void> {
  await waitForFile(join(userData, 'session.json'), (b) => {
    try {
      const o = JSON.parse(b.toString('utf8'))?.outline
      return o?.edit === edit && o?.present === present
    } catch {
      return false
    }
  })
}

test('toggle-outline shows the H1/H2 entries and hides them again', async () => {
  const { app, page } = await openNote()
  await expect(outline(page)).toBeHidden()
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await expect(labels(page)).toHaveText(['Alpha', 'Alpha eins', 'Alpha zwei', 'Beta', 'Beta eins'])
  await shot(page, 'outline')
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeHidden()
  await app.close()
})

test('visibility is remembered per mode and across restarts', async () => {
  const { app, page, userData, dirs, note } = await (async () => {
    const o = await openNote()
    return { ...o, dirs: { root: o.root, notes: o.notes, userData: o.userData } }
  })()
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(1)
  await expect(outline(page)).toBeHidden()
  await clickMenu(app, 'toggle-outline')
  await expect(outline(page)).toBeVisible()
  await shot(page, 'outline-present')
  await clickMenu(app, 'toggle-present')
  await expect(page.locator('body.rf-mode-present')).toHaveCount(0)
  await expect(outline(page)).toBeVisible()
  await sessionHas(userData, true, true)
  await app.close()

  const second = await launch({ dirs, args: [note] })
  await expect(outline(second.page)).toBeVisible()
  await clickMenu(second.app, 'toggle-present')
  await expect(second.page.locator('body.rf-mode-present')).toHaveCount(1)
  await expect(outline(second.page)).toBeVisible()
  await second.app.close()
})

test('chevron folds text and outline in sync; unfold-all and fold-all follow', async () => {
  const { app, page } = await openNote()
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(5)
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)

  await chevrons(page).first().click()
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(1)
  await expect(labels(page)).toHaveText(['Alpha', 'Beta', 'Beta eins'])
  await expect(chevrons(page).first()).toHaveAttribute('aria-expanded', 'false')

  await clickMenu(app, 'unfold-all')
  await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0)
  await expect(labels(page)).toHaveCount(5)
  await expect(chevrons(page).first()).toHaveAttribute('aria-expanded', 'true')

  await clickMenu(app, 'fold-all')
  await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible()
  const states = await chevrons(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-expanded')),
  )
  expect(states.length).toBeGreaterThan(0)
  expect(states.every((s) => s === 'false')).toBe(true)
  await app.close()
})

test('a click jumps to the heading and focus stays in the editor', async () => {
  const { app, page } = await openNote()
  await clickMenu(app, 'toggle-outline')
  await labels(page).nth(3).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? '',
      ),
    )
    .toContain('Beta')
  await expect(page.locator('.cm-content')).toBeFocused()
  await page.keyboard.type('XY')
  await expect(labels(page).nth(3)).toHaveText('BetaXY')
  await app.close()
})

test('a long heading stays one line with the full text as title', async () => {
  const long = `Lang ${'x'.repeat(195)}`
  expect(long.length).toBe(200)
  const { app, page } = await openNote(`# Kurz\n\nText.\n\n# ${long}\n\nText.\n`)
  await clickMenu(app, 'toggle-outline')
  await expect(labels(page)).toHaveCount(2)
  const short = await labels(page)
    .nth(0)
    .evaluate((el) => (el as HTMLElement).offsetHeight)
  const longEl = labels(page).nth(1)
  expect(await longEl.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(short)
  await expect(longEl).toHaveAttribute('title', long)
  const widths = await page.evaluate(() => ({
    bar: (document.querySelector('#outline') as HTMLElement).offsetWidth,
    win: window.innerWidth,
  }))
  expect(widths.bar).toBeLessThanOrEqual(widths.win * 0.33 + 1)
  await app.close()
})

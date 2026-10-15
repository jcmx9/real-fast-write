import { describe, expect, it } from 'vitest'
import { editorSizes, ZOOM_STEPS, zoomIn, zoomLabel, zoomOut } from '../../../src/renderer/ui/zoom'

describe('zoom steps', () => {
  it('walks the fixed steps and clamps at both ends', () => {
    expect(ZOOM_STEPS[0]).toBe(0.5)
    expect(ZOOM_STEPS.at(-1)).toBe(3)
    expect(zoomIn(1)).toBe(1.1)
    expect(zoomOut(1)).toBe(0.9)
    expect(zoomIn(3)).toBe(3)
    expect(zoomOut(0.5)).toBe(0.5)
  })
  it('snaps an off-step value to the next step in the direction', () => {
    expect(zoomIn(1.05)).toBe(1.1)
    expect(zoomOut(1.05)).toBe(1)
  })
  it('labels as rounded percent', () => {
    expect(zoomLabel(0.67)).toBe('67 %')
    expect(zoomLabel(1.25)).toBe('125 %')
  })
})

describe('editorSizes', () => {
  it('Edit: body 10pt and code 9pt at 100 %', () => {
    expect(editorSizes('edit', 1, 1.6)).toEqual({ body: '10pt', code: '9pt' })
  })
  it('Present: body 10pt × factor × zoom', () => {
    expect(editorSizes('present', 1, 1.6)).toEqual({ body: '16pt', code: '14.4pt' })
    expect(editorSizes('present', 1.25, 1.6)).toEqual({ body: '20pt', code: '18pt' })
  })
  it('rounds to two decimals', () => {
    expect(editorSizes('edit', 0.67, 1.6)).toEqual({ body: '6.7pt', code: '6.03pt' })
  })
})

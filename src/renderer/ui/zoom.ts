import type { Mode } from '../../shared/types'

export const ZOOM_STEPS: readonly number[] = [
  0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
]
const EPS = 1e-9
const round2 = (n: number) => Math.round(n * 100) / 100

export function zoomIn(z: number): number {
  return ZOOM_STEPS.find((s) => s > z + EPS) ?? (ZOOM_STEPS.at(-1) as number)
}

export function zoomOut(z: number): number {
  return [...ZOOM_STEPS].reverse().find((s) => s < z - EPS) ?? (ZOOM_STEPS[0] as number)
}

export function zoomLabel(z: number): string {
  return `${Math.round(z * 100)} %`
}

/** Edit 100 % = PDF size (10pt body, 9pt code); Present multiplies by the configured factor. */
export function editorSizes(
  mode: Mode,
  zoom: number,
  presentFactor: number,
): { body: string; code: string } {
  const f = (mode === 'present' ? presentFactor : 1) * zoom
  return { body: `${round2(10 * f)}pt`, code: `${round2(9 * f)}pt` }
}

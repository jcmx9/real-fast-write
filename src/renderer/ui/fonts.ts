export const FONT_FACES: ReadonlyArray<{
  family: string
  file: string
  style: 'normal' | 'italic'
  weight: string
}> = [
  { family: 'rfdoc Sans', file: 'SourceSans3VF-Upright.otf', style: 'normal', weight: '200 900' },
  { family: 'rfdoc Sans', file: 'SourceSans3VF-Italic.otf', style: 'italic', weight: '200 900' },
  {
    family: 'rfdoc Serif',
    file: 'SourceSerif4Variable-Roman.otf',
    style: 'normal',
    weight: '200 900',
  },
  {
    family: 'rfdoc Serif',
    file: 'SourceSerif4Variable-Italic.otf',
    style: 'italic',
    weight: '200 900',
  },
  { family: 'rfdoc Code', file: 'SourceCodeVF-Upright.otf', style: 'normal', weight: '200 900' },
  { family: 'rfdoc Code', file: 'SourceCodeVF-Italic.otf', style: 'italic', weight: '200 900' },
  { family: 'rfdoc Emoji', file: 'NotoEmoji[wght].ttf', style: 'normal', weight: '300 700' },
  { family: 'rfdoc Symbols', file: 'NotoSansSymbols2-Regular.ttf', style: 'normal', weight: '400' },
]

export function fontUrl(file: string): string {
  return `rfw-font://fonts/${encodeURIComponent(file)}`
}

/** Registers rf-document's fonts; missing files just fail to load (system fonts take over). */
export function registerFonts(doc: Document): void {
  for (const f of FONT_FACES) {
    const face = new FontFace(f.family, `url("${fontUrl(f.file)}")`, {
      style: f.style,
      weight: f.weight,
      display: 'swap',
    })
    doc.fonts.add(face)
  }
}

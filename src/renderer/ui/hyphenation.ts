/** True when this Chromium hyphenates German: a long word then wraps instead of overflowing. */
export function supportsGermanHyphenation(doc: Document): boolean {
  const probe = doc.createElement('div')
  probe.lang = 'de'
  probe.style.cssText =
    'position:absolute;visibility:hidden;left:-9999px;width:5em;font-size:16px;hyphens:auto;overflow-wrap:normal;word-break:normal'
  probe.textContent = 'Donaudampfschifffahrtsgesellschaftskapitänsmütze'
  doc.body.append(probe)
  const fits = probe.scrollWidth <= probe.clientWidth + 1
  probe.remove()
  return fits
}

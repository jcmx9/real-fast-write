import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

/*
 * rfw-font:// URLs in theme.css. Vite only treats `scheme://` URLs with a
 * letters-only scheme as external, so the hyphenated custom scheme would be
 * read as a file path. The PostCSS step swaps in a letters-only stand-in so
 * Vite leaves the URLs alone; the plugin below swaps the real scheme back in
 * the transformed module (dev) and the emitted CSS (build).
 */
const RFW_FONT = 'rfw-font://'
const RFW_FONT_STANDIN = 'rfwfont://'

type PostcssDecl = { value: string }
type PostcssRoot = { walkDecls: (cb: (decl: PostcssDecl) => void) => void }

const hideRfwFontScheme = {
  postcssPlugin: 'rfw-font-hide-scheme',
  Once(root: PostcssRoot) {
    root.walkDecls((decl) => {
      decl.value = decl.value.replaceAll(RFW_FONT, RFW_FONT_STANDIN)
    })
  },
}

function restoreRfwFontScheme(): Plugin {
  const restore = (text: string): string => text.replaceAll(RFW_FONT_STANDIN, RFW_FONT)
  return {
    name: 'rfw-font-restore-scheme',
    enforce: 'post',
    transform(code, id) {
      const file = id.split('?', 1)[0] ?? ''
      if (!file.endsWith('.css') || !code.includes(RFW_FONT_STANDIN)) return null
      return restore(code)
    },
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (
          asset.type === 'asset' &&
          asset.fileName.endsWith('.css') &&
          typeof asset.source === 'string'
        ) {
          asset.source = restore(asset.source)
        }
      }
    },
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    css: { postcss: { plugins: [hideRfwFontScheme] } },
    plugins: [restoreRfwFontScheme()],
  },
})

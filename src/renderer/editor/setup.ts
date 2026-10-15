import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeFolding, foldGutter, foldKeymap, unfoldAll } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import { drawSelection, EditorView, type KeyBinding, keymap, lineNumbers } from '@codemirror/view'
import type { Eol, Mode, View } from '../../shared/types'
import { Frontmatter, frontmatterRange } from './frontmatter'
import { headerFold, headerHidden } from './header'
import { rfHighlight } from './highlight'
import { modeCompartment, modeExtensions } from './mode'
import { previewPlugin } from './preview'
import { foldAllSections } from './sections'
import { tableField } from './tables'

export const viewCompartment = new Compartment()

const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/**
 * Fold keys. On Windows/Linux AltGr is Ctrl+Alt, so CodeMirror's `Ctrl-Alt-[`/`]` would swallow
 * typing `[`/`]` on German layouts: there fold-all is `Alt-0` / `Alt-Shift-0` instead.
 */
export function foldBindings(mac = isMacPlatform()): readonly KeyBinding[] {
  if (mac) return foldKeymap
  return [
    ...foldKeymap.filter((b) => b.key !== 'Ctrl-Alt-[' && b.key !== 'Ctrl-Alt-]'),
    { key: 'Alt-0', run: foldAllSections },
    { key: 'Alt-Shift-0', run: unfoldAll },
  ]
}

export function viewExtensions(view: View): Extension {
  return view === 'code'
    ? [lineNumbers(), foldGutter(), EditorView.editorAttributes.of({ class: 'rf-code' })]
    : [
        foldGutter(),
        EditorView.editorAttributes.of({ class: 'rf-preview' }),
        previewPlugin,
        tableField,
        headerFold,
      ]
}

export function createState(
  text: string,
  eol: Eol,
  view: View,
  headerHiddenInit = false,
  mode: Mode = 'edit',
): EditorState {
  const state = EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      codeFolding(),
      keymap.of([...foldBindings(), ...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Frontmatter] }),
      rfHighlight,
      headerHidden.init(() => headerHiddenInit),
      EditorView.lineWrapping,
      viewCompartment.of(viewExtensions(view)),
      modeCompartment.of(modeExtensions(mode)),
    ],
  })
  const range = headerHiddenInit || mode === 'present' ? frontmatterRange(state.doc) : null
  if (!range) return state
  // Cursor right after the collapsed (atomic) header, not inside it.
  return state.update({ selection: { anchor: Math.min(range.to + 1, state.doc.length) } }).state
}

export function serializeDoc(doc: Text, eol: Eol): string {
  return eol === '\r\n' ? doc.sliceString(0, doc.length, '\r\n') : doc.toString()
}

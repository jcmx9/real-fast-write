import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { codeFolding, foldGutter, foldKeymap } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view'
import type { Eol, View } from '../../shared/types'
import { Frontmatter, frontmatterRange } from './frontmatter'
import { headerFold, headerHidden } from './header'
import { rfHighlight } from './highlight'
import { previewPlugin } from './preview'
import { tableField } from './tables'

export const viewCompartment = new Compartment()

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
): EditorState {
  const state = EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      codeFolding(),
      keymap.of([...foldKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [Frontmatter] }),
      rfHighlight,
      headerHidden.init(() => headerHiddenInit),
      EditorView.lineWrapping,
      viewCompartment.of(viewExtensions(view)),
    ],
  })
  const range = headerHiddenInit ? frontmatterRange(state.doc) : null
  if (!range) return state
  // Cursor right after the collapsed (atomic) header, not inside it.
  return state.update({ selection: { anchor: Math.min(range.to + 1, state.doc.length) } }).state
}

export function serializeDoc(doc: Text, eol: Eol): string {
  return eol === '\r\n' ? doc.sliceString(0, doc.length, '\r\n') : doc.toString()
}

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import { drawSelection, EditorView, keymap, lineNumbers } from '@codemirror/view'
import type { Eol, View } from '../../shared/types'

export const viewCompartment = new Compartment()

/** Plan 2 replaces the preview branch with the PDF-look decorations. */
export function viewExtensions(view: View): Extension {
  return view === 'code'
    ? [lineNumbers(), syntaxHighlighting(defaultHighlightStyle)]
    : [syntaxHighlighting(defaultHighlightStyle)]
}

export function createState(text: string, eol: Eol, view: View): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [
      eol === 'mixed' ? EditorState.lineSeparator.of('\n') : [],
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      viewCompartment.of(viewExtensions(view)),
    ],
  })
}

export function serializeDoc(doc: Text, eol: Eol): string {
  return eol === '\r\n' ? doc.sliceString(0, doc.length, '\r\n') : doc.toString()
}

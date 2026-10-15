import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** Token classes; colours live in theme.css (Typst's default syntax colours). */
export const rfHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, class: 'rf-tok-heading' },
    { tag: t.strong, class: 'rf-tok-strong' },
    { tag: t.emphasis, class: 'rf-tok-em' },
    { tag: [t.link, t.url], class: 'rf-tok-link' },
    { tag: t.processingInstruction, class: 'rf-tok-mark' },
    { tag: t.meta, class: 'rf-tok-meta' },
    { tag: [t.keyword, t.bool, t.null], class: 'rf-tok-keyword' },
    { tag: [t.string, t.regexp], class: 'rf-tok-string' },
    { tag: [t.number, t.atom], class: 'rf-tok-number' },
    { tag: t.comment, class: 'rf-tok-comment' },
    {
      tag: [
        t.function(t.variableName),
        t.function(t.propertyName),
        t.typeName,
        t.className,
        t.macroName,
      ],
      class: 'rf-tok-function',
    },
  ]),
)

/** Where a menu edit command goes: the editor, a focused text field, or nowhere (dialog open). */
export type EditTarget = 'editor' | 'field' | 'blocked'

export function editTarget(
  active: Element | null,
  editorDom: Element,
  dialogOpen: boolean,
): EditTarget {
  const field =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable && !editorDom.contains(active))
  if (field) return 'field'
  // A modal dialog with focus on a button must not edit the document behind it.
  return dialogOpen ? 'blocked' : 'editor'
}

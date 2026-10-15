// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { editTarget } from '../../../src/renderer/ui/edit-target'

describe('editTarget', () => {
  const editor = document.createElement('div')
  const button = document.createElement('button')
  const input = document.createElement('input')

  it('sends the command to the editor by default', () => {
    expect(editTarget(button, editor, false)).toBe('editor')
    expect(editTarget(null, editor, false)).toBe('editor')
  })
  it('blocks it behind an open dialog when a button has focus', () => {
    expect(editTarget(button, editor, true)).toBe('blocked')
    expect(editTarget(null, editor, true)).toBe('blocked')
  })
  it('lets a focused text field keep the command', () => {
    expect(editTarget(input, editor, true)).toBe('field')
    expect(editTarget(input, editor, false)).toBe('field')
  })
})

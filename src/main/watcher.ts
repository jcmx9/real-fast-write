import { type FSWatcher, readFileSync, watch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { NoteFile } from '../shared/types'
import { hashBytes, readNote } from './files'

export class NoteWatcher {
  private readonly dirs = new Map<string, FSWatcher>()
  private files = new Set<string>()
  private readonly known = new Map<string, { accepted: Set<string>; latest: string }>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly onChange: (note: NoteFile) => void,
    private readonly debounceMs = 200,
  ) {}

  setFiles(paths: readonly string[]): void {
    const previous = this.files
    this.files = new Set(paths)
    // Forget removed files so a later re-add re-seeds from disk, not from a stale hash.
    for (const p of previous) {
      if (this.files.has(p)) continue
      this.known.delete(p)
      const pending = this.timers.get(p)
      if (pending) clearTimeout(pending)
      this.timers.delete(p)
    }
    // Baseline so pre-existing content and creation events are not reported as external changes.
    for (const p of paths) {
      if (this.known.has(p)) continue
      try {
        const seed = hashBytes(readFileSync(p))
        this.known.set(p, { accepted: new Set([seed]), latest: seed })
      } catch {
        // Missing or unreadable (e.g. a new, unsaved note): nothing to baseline.
      }
    }
    const needed = new Set(paths.map((p) => dirname(p)))
    for (const [dir, w] of this.dirs) {
      if (!needed.has(dir)) {
        w.close()
        this.dirs.delete(dir)
      }
    }
    for (const dir of needed) {
      if (this.dirs.has(dir)) continue
      try {
        const w = watch(dir, (_event, name) => {
          if (name) this.ping(join(dir, name.toString()))
        })
        w.on('error', () => {
          w.close()
          this.dirs.delete(dir)
        })
        this.dirs.set(dir, w)
      } catch {
        // Folder vanished or is not watchable: the next save surfaces any problem.
      }
    }
  }

  /** Records the hash of content that is (about to be) on disk, so it is not reported. */
  expect(path: string, hash: string): void {
    const entry = this.known.get(path)
    if (entry) {
      entry.accepted.add(hash)
      entry.latest = hash
    } else {
      this.known.set(path, { accepted: new Set([hash]), latest: hash })
    }
  }

  close(): void {
    for (const w of this.dirs.values()) w.close()
    this.dirs.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  private ping(path: string): void {
    if (!this.files.has(path) || basename(path).startsWith('.')) return
    const pending = this.timers.get(path)
    if (pending) clearTimeout(pending)
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path)
        void this.check(path)
      }, this.debounceMs),
    )
  }

  private async check(path: string): Promise<void> {
    if (!this.files.has(path)) return
    let note: NoteFile
    try {
      note = await readNote(path)
    } catch {
      return
    }
    const entry = this.known.get(path)
    if (entry?.latest === note.hash) {
      // Settled on our newest write: only that content is accepted from now on.
      entry.accepted = new Set([note.hash])
      return
    }
    if (entry?.accepted.has(note.hash)) return
    this.known.set(path, { accepted: new Set([note.hash]), latest: note.hash })
    this.onChange(note)
  }
}

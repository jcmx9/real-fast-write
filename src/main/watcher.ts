import { type FSWatcher, promises as fs, readFileSync, watch } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { ExternalChange, NoteFile } from '../shared/types'
import { decodeNote, errorCode, hashBytes, NotUtf8Error } from './files'

interface Known {
  /** Hashes of content that is not reported (own writes, the baseline, reported content). */
  accepted: Set<string>
  latest: string
  /** Set while the file is reported as deleted or unreadable; a later readable state is reported. */
  failure?: 'deleted' | 'error'
}

export class NoteWatcher {
  private readonly dirs = new Map<string, FSWatcher>()
  private files = new Set<string>()
  private readonly known = new Map<string, Known>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly onChange: (change: ExternalChange) => void,
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
      // Our own write replaces whatever made the file missing or unreadable.
      entry.failure = undefined
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
    this.schedule(path, false)
  }

  private schedule(path: string, confirmMissing: boolean): void {
    const pending = this.timers.get(path)
    if (pending) clearTimeout(pending)
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path)
        void this.check(path, confirmMissing)
      }, this.debounceMs),
    )
  }

  /** confirmMissing: the previous check already found the file missing. */
  private async check(path: string, confirmMissing = false): Promise<void> {
    if (!this.files.has(path)) return
    let bytes: Buffer
    try {
      bytes = await fs.readFile(path)
    } catch (err) {
      // The path may have been removed while the read was in flight.
      if (this.files.has(path)) this.readFailed(path, err, confirmMissing)
      return
    }
    if (!this.files.has(path)) return
    const hash = hashBytes(bytes)
    const entry = this.known.get(path)
    if (!entry?.failure) {
      if (entry?.latest === hash) {
        // Settled on our newest write: only that content is accepted from now on.
        entry.accepted = new Set([hash])
        return
      }
      if (entry?.accepted.has(hash)) return
    }
    // Accept these bytes before decoding, so the same bytes are reported only once.
    this.known.set(path, { accepted: new Set([hash]), latest: hash })
    let note: NoteFile
    try {
      note = decodeNote(path, bytes)
    } catch (err) {
      if (err instanceof NotUtf8Error) {
        this.onChange({ kind: 'unreadable', path, reason: 'encoding', message: err.message })
      }
      return
    }
    this.onChange({ kind: 'changed', note })
  }

  private readFailed(path: string, err: unknown, confirmMissing: boolean): void {
    const entry = this.known.get(path)
    if (errorCode(err) === 'ENOENT') {
      if (entry?.failure === 'deleted') return
      // A replace by delete + create (or a rename in flight) looks missing for a moment: check
      // once more after the debounce before calling it deleted.
      if (!confirmMissing) {
        this.schedule(path, true)
        return
      }
      // Nothing is accepted any more: a later file at this path is reported, unless it is ours.
      this.known.set(path, { accepted: new Set(), latest: '', failure: 'deleted' })
      this.onChange({ kind: 'deleted', path })
      return
    }
    if (entry?.failure === 'error') return
    this.known.set(path, {
      accepted: entry?.accepted ?? new Set(),
      latest: entry?.latest ?? '',
      failure: 'error',
    })
    this.onChange({
      kind: 'unreadable',
      path,
      reason: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

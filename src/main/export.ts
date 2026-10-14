import { type ChildProcess, spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { ExportResult } from '../shared/types'

const DEFAULT_TIMEOUT_MS = 120_000

export function buildCommand(
  bin: string,
  note: string,
  platform: NodeJS.Platform,
  comspec = process.env.ComSpec ?? 'cmd.exe',
): { file: string; args: string[]; verbatim: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    // /s strips the outer quotes; the inner pair keeps paths with spaces intact.
    return { file: comspec, args: ['/d', '/s', '/c', `""${bin}" "${note}""`], verbatim: true }
  }
  return { file: bin, args: [note], verbatim: false }
}

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  )
}

const KILL_GRACE_MS = 2000

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group is already gone; nothing left to signal.
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    // A failure to start taskkill must not become an unhandled error in the main process.
    killer.on('error', () => {})
    return
  }
  // The child leads its own process group (detached), so this reaches the whole tree.
  const pid = child.pid
  signalGroup(pid, 'SIGTERM')
  const escalate = setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_GRACE_MS)
  escalate.unref()
}

/** Runs `rf-document <note>`; rf-document names the PDF, reads front matter options and opens it. */
export function runRfDocument(
  bin: string,
  note: string,
  opts: { timeoutMs?: number } = {},
): Promise<ExportResult> {
  const { file, args, verbatim } = buildCommand(bin, note, process.platform)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: ExportResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawn(file, args, {
      cwd: dirname(note),
      env: process.env,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      detached: process.platform !== 'win32',
    })
    const timer = setTimeout(() => {
      killTree(child)
      const seconds = Math.round(timeoutMs / 1000)
      finish({
        kind: 'failed',
        code: null,
        stderr:
          `${stderr.trim()}\nZeitüberschreitung: rf-document wurde nach ${seconds} s abgebrochen.`.trim(),
      })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('error', (err) => {
      finish({
        kind: 'failed',
        code: null,
        stderr: `rf-document konnte nicht gestartet werden: ${err.message}`,
      })
    })
    child.on('close', (code) => {
      if (code === 0) {
        finish({ kind: 'ok', message: lastLine(stdout) || 'PDF erzeugt.' })
      } else {
        finish({
          kind: 'failed',
          code,
          stderr: stderr.trim() || `rf-document endete mit Code ${code}.`,
        })
      }
    })
  })
}

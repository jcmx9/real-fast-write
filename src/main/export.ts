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

function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}

/** Runs `rf-document <note>`; rf-document names the PDF, reads front matter options and opens it. */
export function runRfDocument(
  bin: string,
  note: string,
  opts: { timeoutMs?: number } = {},
): Promise<ExportResult> {
  const { file, args, verbatim } = buildCommand(bin, note, process.platform)
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(file, args, {
      cwd: dirname(note),
      env: process.env,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    })
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      stdout += d
    })
    child.stderr?.setEncoding('utf8').on('data', (d: string) => {
      stderr += d
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        kind: 'failed',
        code: null,
        stderr: `rf-document konnte nicht gestartet werden: ${err.message}`,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        const seconds = Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)
        resolve({
          kind: 'failed',
          code: null,
          stderr:
            `${stderr.trim()}\nZeitüberschreitung: rf-document wurde nach ${seconds} s abgebrochen.`.trim(),
        })
      } else if (code === 0) {
        resolve({ kind: 'ok', message: lastLine(stdout) || 'PDF erzeugt.' })
      } else {
        resolve({
          kind: 'failed',
          code,
          stderr: stderr.trim() || `rf-document endete mit Code ${code}.`,
        })
      }
    })
  })
}

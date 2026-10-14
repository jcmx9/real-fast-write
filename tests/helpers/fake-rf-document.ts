import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FakeOptions {
  stdout?: string
  stderr?: string
  code?: number
  sleepSeconds?: number
}

/** Writes a stand-in for rf-document that records its first argument. Keep messages ASCII (cmd.exe code pages). */
export async function makeFakeRfDocument(
  dir: string,
  o: FakeOptions = {},
): Promise<{ bin: string; argsFile: string }> {
  const argsFile = join(dir, 'args.txt')
  if (process.platform === 'win32') {
    const bin = join(dir, 'rf-document.cmd')
    const lines = ['@echo off', `>"${argsFile}" echo %~1`]
    if (o.sleepSeconds) lines.push(`ping -n ${o.sleepSeconds + 1} 127.0.0.1 >nul`)
    if (o.stdout) lines.push(`echo ${o.stdout}`)
    if (o.stderr) lines.push(`echo ${o.stderr} 1>&2`)
    lines.push(`exit /b ${o.code ?? 0}`)
    await writeFile(bin, `${lines.join('\r\n')}\r\n`)
    return { bin, argsFile }
  }
  const bin = join(dir, 'rf-document')
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const lines = ['#!/bin/sh', `printf '%s' "$1" > ${q(argsFile)}`]
  if (o.sleepSeconds) lines.push(`sleep ${o.sleepSeconds}`)
  if (o.stdout) lines.push(`printf '%s\\n' ${q(o.stdout)}`)
  if (o.stderr) lines.push(`printf '%s\\n' ${q(o.stderr)} >&2`)
  lines.push(`exit ${o.code ?? 0}`)
  await writeFile(bin, `${lines.join('\n')}\n`)
  await chmod(bin, 0o755)
  return { bin, argsFile }
}

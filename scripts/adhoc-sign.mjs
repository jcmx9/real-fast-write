// Build-time electron-builder `mac.sign` hook (not shipped: `files` only packs out/).
// electron-builder looks `identity: "-"` up as a substring of the keychain's code-signing
// identities before falling back to ad hoc, so any local certificate whose name contains a dash
// would sign the release instead. This hook pins the ad-hoc identity for every nested component
// (frameworks, helpers, dylibs) so local and CI builds are signed the same way.
import { createRequire } from 'node:module'

/**
 * The signing options electron-builder prepared, with the identity forced to ad hoc.
 * @template {Record<string, unknown>} T
 * @param {T} opts
 * @returns {T & { identity: '-', identityValidation: false }}
 */
export function adHocOptions(opts) {
  return { ...opts, identity: '-', identityValidation: false }
}

/**
 * Runs `task` up to `attempts` times (default 3), waiting `delayMs` × attempt in between.
 * codesign on CI runners fails now and then (timeouts, "resource busy"). Rethrows the last
 * error.
 * @template T
 * @param {() => Promise<T>} task
 * @param {{ attempts?: number, delayMs?: number, log?: (message: string) => void }} [o]
 * @returns {Promise<T>}
 */
export async function withRetry(task, o = {}) {
  const attempts = o.attempts ?? 3
  const delayMs = o.delayMs ?? 2000
  const log = o.log ?? ((message) => console.warn(message))
  for (let attempt = 1; ; attempt++) {
    try {
      return await task()
    } catch (err) {
      if (attempt >= attempts) throw err
      const reason = err instanceof Error ? err.message : String(err)
      log(`codesign attempt ${attempt}/${attempts} failed (${reason}); retrying`)
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
    }
  }
}

/**
 * @param {Record<string, unknown>} opts
 * @returns {Promise<void>}
 */
export default async function sign(opts) {
  // @electron/osx-sign is what electron-builder signs with (also an explicit devDependency).
  const { signAsync } = createRequire(import.meta.url)('@electron/osx-sign')
  await withRetry(() => signAsync(adHocOptions(opts)))
}

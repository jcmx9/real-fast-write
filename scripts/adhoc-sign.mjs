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
 * @param {Record<string, unknown>} opts
 * @returns {Promise<void>}
 */
export default async function sign(opts) {
  // @electron/osx-sign is what electron-builder signs with (a dependency of app-builder-lib).
  const { signAsync } = createRequire(import.meta.url)('@electron/osx-sign')
  await signAsync(adHocOptions(opts))
}

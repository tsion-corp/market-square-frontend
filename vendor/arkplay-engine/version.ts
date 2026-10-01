/* Versions. ENGINE_VERSION changes whenever rendering output changes, so caches keyed on
 * (DNA hash, engine version) invalidate themselves; DNA_VERSION lives in dna/types.ts. */

export const ENGINE_VERSION = '1.3.0'
export const ENGINE_VERSION_STRING = `arkplay-avatar-engine/${ENGINE_VERSION}`

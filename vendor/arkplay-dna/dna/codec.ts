/* Share codes: an avatar as a short, URL-safe string.
 *
 *   A2<base64url(bitstream + CRC-16)>    the default since 2026-09 (dna/packed.ts)
 *   A1<base64url(deflate(json of the params that differ from their defaults))>
 *
 * Both keep only what differs from the frozen defaults, which is why defaults are frozen
 * (README.md, DNA contract): a code must decode to the same avatar forever. A2 writes
 * every id as its position in the append-only codebook (dna/codebook.ts) and every value
 * in the fewest bits its type allows: a random humanoid is ~5x shorter than A1, the round
 * trip is exact (same dnaHash), and a CRC refuses mistyped or cut-off codes. Both formats
 * decode forever. Inline custom art is stripped — codes carry uploaded asset ids only. */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { defaultsOf, type Params } from './params.ts'
import { itemSpec, sectionsFor } from './schema/index.ts'
import { normalizeDNA, type NormalizeReport } from './normalize.ts'
import type { AvatarDNA, ItemRef } from './types.ts'
import { hashString } from '../core/rng.ts'
import { packCompact, PackError, unpackCompact, type PackFailure } from './packed.ts'

export type ShareCodeFormat = 'A1' | 'A2'

export interface ShareCodeOptions {
  /** `'A2'` (default): compact binary with a checksum. `'A1'`: the original deflated JSON. */
  format?: ShareCodeFormat
}

/** Longest code accepted (after whitespace is removed). */
const MAX_CODE = 8000

function sparseParams(values: Params, defaults: Params): Params | undefined {
  const out: Params = {}
  for (const [k, v] of Object.entries(values)) if (defaults[k] !== v) out[k] = v
  return Object.keys(out).length ? out : undefined
}

function sparseItems(items: ItemRef[]): unknown[] {
  return items
    .filter((i) => i.id !== 'custom' || i.asset?.id)
    .map((i) => {
      const spec = itemSpec(i.id)
      const p = spec ? sparseParams(i.params, defaultsOf(spec.params)) : i.params
      const o: Record<string, unknown> = { id: i.id }
      if (p) o.p = p
      if (i.asset?.id) o.a = { id: i.asset.id, w: i.asset.w, h: i.asset.h, px: i.asset.px, py: i.asset.py }
      return o
    })
}

/** The smallest JSON that normalizes back to the same DNA. */
export function compactDNA(dna: AvatarDNA): Record<string, unknown> {
  const s: Record<string, Params> = {}
  for (const spec of sectionsFor(dna.kind)) {
    const p = sparseParams(dna.sections[spec.id] ?? {}, defaultsOf(spec.params))
    if (p) s[spec.id] = p
  }
  const out: Record<string, unknown> = { v: dna.v, k: dna.kind === 'creature' ? 'c' : 'h', s: dna.seed }
  if (dna.name) out.n = dna.name
  if (Object.keys(s).length) out.x = s
  if (dna.outfit.length) out.o = sparseItems(dna.outfit)
  if (dna.accessories.length) out.a = sparseItems(dna.accessories)
  if (dna.meta?.species) out.sp = dna.meta.species
  return out
}

/** Inverse of compactDNA (the result is then normalized, filling defaults). */
export function expandDNA(c: Record<string, unknown>, report?: NormalizeReport): AvatarDNA {
  const items = (list: unknown) =>
    Array.isArray(list)
      ? list.map((i) => {
          const r = i as Record<string, unknown>
          const out: Record<string, unknown> = { id: r.id, params: r.p ?? {} }
          if (r.a) out.asset = r.a
          return out
        })
      : []
  return normalizeDNA(
    {
      v: c.v,
      kind: c.k === 'c' ? 'creature' : 'humanoid',
      seed: c.s,
      name: c.n,
      sections: c.x ?? {},
      outfit: items(c.o),
      accessories: items(c.a),
      meta: c.sp ? { species: c.sp } : undefined,
    },
    report,
  )
}

const b64u = {
  encode(bytes: Uint8Array): string {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(s: string): Uint8Array {
    const b = s.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
  /** Canonical base64url only (no stray trailing bits), or undefined. */
  decodeStrict(s: string): Uint8Array | undefined {
    if (s.length % 4 === 1) return undefined
    try {
      const bytes = b64u.decode(s)
      return b64u.encode(bytes) === s ? bytes : undefined
    } catch {
      return undefined
    }
  },
}

export class ShareCodeError extends Error {}

const FAILURES: Record<PackFailure, string> = {
  typo: 'That avatar code has a typo or is incomplete.',
  damaged: 'That avatar code is damaged or incomplete.',
  newer: 'That avatar code was made by a newer version of the studio. Reload and try again.',
}

/** An avatar as A2 bytes (the share code without its text wrapping): for binary transports
 *  such as game netcode. Normalizes first, so the bytes decode to exactly `normalizeDNA(dna)`
 *  (as far as `compactDNA` sees it: inline art and `meta.theme`/`source` are not kept). */
export function encodeAvatarBytes(dna: AvatarDNA): Uint8Array {
  return packCompact(compactDNA(normalizeDNA(dna)))
}

/** Inverse of encodeAvatarBytes. Throws ShareCodeError when the bytes fail their checksum or
 *  can't be read. */
export function decodeAvatarBytes(bytes: Uint8Array, report?: NormalizeReport): AvatarDNA {
  let compact: Record<string, unknown>
  try {
    compact = unpackCompact(bytes, (m) => report?.warnings.push(m))
  } catch (e) {
    if (e instanceof PackError) throw new ShareCodeError(FAILURES[e.reason])
    throw e
  }
  return expandDNA(compact, report)
}

export function encodeShareCode(dna: AvatarDNA, opts: ShareCodeOptions = {}): string {
  if (opts.format === 'A1') return 'A1' + b64u.encode(deflateSync(strToU8(JSON.stringify(compactDNA(dna))), { level: 9 }))
  return 'A2' + b64u.encode(encodeAvatarBytes(dna))
}

/** Reads an A1 or A2 code. Spaces and line breaks inside it (a code pasted from a chat or an
 *  email) are ignored. Throws ShareCodeError with a message fit to show the user. */
export function decodeShareCode(code: string, report?: NormalizeReport): AvatarDNA {
  if (typeof code !== 'string' || code.length > MAX_CODE * 2) throw new ShareCodeError('Not an avatar code.')
  const c = code.replace(/\s+/g, '')
  if (c.length > MAX_CODE || !/^A[12][A-Za-z0-9_-]+$/.test(c)) throw new ShareCodeError('Not an avatar code.')
  const body = c.slice(2)
  if (c[1] === '2') {
    const bytes = b64u.decodeStrict(body)
    if (!bytes) throw new ShareCodeError(FAILURES.typo)
    return decodeAvatarBytes(bytes, report)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(inflateSync(b64u.decode(body))))
  } catch {
    throw new ShareCodeError('That avatar code is damaged or incomplete.')
  }
  if (!parsed || typeof parsed !== 'object') throw new ShareCodeError('That avatar code is empty.')
  return expandDNA(parsed as Record<string, unknown>, report)
}

/** Canonical JSON (sorted keys) — for hashing and equality. */
export function canonicalJSON(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJSON).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** A stable content hash of an avatar (cache keys, ETags, "has it changed?"). */
export const dnaHash = (dna: AvatarDNA): string => {
  const s = canonicalJSON(compactDNA(dna))
  return (hashString(s).toString(36) + hashString(s + '#').toString(36)).padStart(12, '0')
}

export const dnaEquals = (a: AvatarDNA, b: AvatarDNA): boolean => canonicalJSON(compactDNA(a)) === canonicalJSON(compactDNA(b))

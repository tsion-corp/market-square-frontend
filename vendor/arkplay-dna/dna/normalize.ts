/* Turning untrusted input into valid DNA.
 *
 * `normalizeDNA` never throws: whatever arrives (an old share code, a hand-edited file, a
 * request body from a game) comes out as a complete, clamped, current-version document.
 * Everything it had to fix is reported, so the service can answer with warnings and the
 * studio can tell the user an item was dropped. */

import { coerce, normalizeParams, type AvatarKind, type Params } from './params.ts'
import { ALL_ITEMS, itemSpec, sectionsFor, slotSpec, type ItemSpec, type SlotId } from './schema/index.ts'
import { DNA_VERSION, type AvatarDNA, type CustomAsset, type ItemRef } from './types.ts'
import { migrate } from './migrate.ts'

export const LIMITS = {
  nameLength: 40,
  outfitItems: 8,
  accessories: 24,
  /** Inline custom art (data URL) — anything bigger must be uploaded to the service. */
  inlineAssetChars: 700_000,
  assetPixels: 4096,
} as const

export interface NormalizeReport {
  warnings: string[]
}

const ASSET_ID = /^as_[a-z0-9]{8,40}$/
const DATA_URL = /^data:image\/(png|svg\+xml|webp|jpeg);base64,[A-Za-z0-9+/=]+$/

/** C0/C1 controls, zero-width marks and bidi overrides: invisible characters that let
 *  names spoof one another. */
const invisible = (code: number): boolean =>
  code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || code === 0xfeff

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  // Names are displayed, never parsed: drop invisible characters and collapse whitespace.
  const kept = [...v].filter((ch) => !invisible(ch.codePointAt(0) ?? 0)).join('')
  return kept.replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeAsset(a: unknown, warn: (m: string) => void): CustomAsset | null {
  if (!a || typeof a !== 'object') return null
  const src = a as Record<string, unknown>
  const out: CustomAsset = {
    w: Math.round(Math.min(LIMITS.assetPixels, Math.max(1, Number(src.w) || 256))),
    h: Math.round(Math.min(LIMITS.assetPixels, Math.max(1, Number(src.h) || 256))),
  }
  if (typeof src.id === 'string' && ASSET_ID.test(src.id)) out.id = src.id
  if (typeof src.src === 'string') {
    if (src.src.length <= LIMITS.inlineAssetChars && DATA_URL.test(src.src)) out.src = src.src
    else warn('A custom accessory image was too large or not a PNG/SVG/WebP/JPEG data URL, so it was dropped.')
  }
  if (!out.id && !out.src) return null
  const name = cleanText(src.name, 60)
  if (name) out.name = name
  for (const k of ['px', 'py'] as const) {
    const n = Number(src[k])
    if (Number.isFinite(n)) out[k] = Math.min(1, Math.max(0, n))
  }
  return out
}

/** Applies slot capacity and "occupies" conflicts with last-added-wins semantics. */
export function resolveItems(items: ItemRef[], kind: AvatarKind): ItemRef[] {
  let kept: { ref: ItemRef; spec: ItemSpec }[] = []
  for (const ref of items) {
    const spec = itemSpec(ref.id)
    if (!spec || !spec.kinds.includes(kind)) continue
    const cap = slotSpec(spec.slot).capacity
    const claims = new Set<SlotId>([spec.slot, ...(spec.occupies ?? [])])
    // The same item twice replaces the older copy (custom art can repeat).
    if (spec.slot !== 'custom') kept = kept.filter((k) => k.ref.id !== ref.id)
    // Displace anything the new item's slots overlap with: a dress replaces top and bottom,
    // a new top removes a dress. Items sharing a multi-capacity slot can coexist.
    kept = kept.filter((k) => {
      const overlap = [k.spec.slot, ...(k.spec.occupies ?? [])].some((s) => claims.has(s))
      if (!overlap) return true
      return k.spec.slot === spec.slot && cap > 1 && !k.spec.occupies && !spec.occupies
    })
    // A full multi-slot drops its oldest item.
    const inSlot = kept.filter((k) => k.spec.slot === spec.slot)
    if (inSlot.length >= cap) kept = kept.filter((k) => k !== inSlot[0])
    kept.push({ ref, spec })
  }
  return kept.map((k) => k.ref)
}

function normalizeItemList(input: unknown, kind: AvatarKind, garment: boolean, warn: (m: string) => void): ItemRef[] {
  if (!Array.isArray(input)) return []
  const max = garment ? LIMITS.outfitItems : LIMITS.accessories
  const out: ItemRef[] = []
  for (const raw of input.slice(0, max * 2)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const spec = itemSpec(id)
    if (!spec) {
      warn(`Unknown item "${String(id).slice(0, 40)}" was removed.`)
      continue
    }
    if (!spec.kinds.includes(kind)) {
      warn(`"${spec.label}" does not fit a ${kind}, so it was removed.`)
      continue
    }
    const isGarment = slotSpec(spec.slot).kind === 'garment'
    if (isGarment !== garment) continue
    const ref: ItemRef = { id, params: normalizeParams(spec.params, r.params) }
    if (spec.slot === 'custom') {
      const asset = normalizeAsset(r.asset, warn)
      if (!asset) {
        warn('A custom accessory had no usable image and was removed.')
        continue
      }
      ref.asset = asset
    }
    out.push(ref)
  }
  return resolveItems(out, kind).slice(-max)
}

export function normalizeDNA(input: unknown, report?: NormalizeReport): AvatarDNA {
  const warn = (m: string) => report?.warnings.push(m)
  let src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  src = migrate(src, warn)

  const kind: AvatarKind = src.kind === 'creature' ? 'creature' : 'humanoid'
  const seedNum = Number(src.seed)
  const seed = Number.isFinite(seedNum) ? Math.floor(Math.abs(seedNum)) >>> 0 : 1

  const inSections = (src.sections && typeof src.sections === 'object' ? src.sections : {}) as Record<string, unknown>
  const sections: Record<string, Params> = {}
  for (const s of sectionsFor(kind)) sections[s.id] = normalizeParams(s.params, inSections[s.id])

  const dna: AvatarDNA = {
    v: DNA_VERSION,
    kind,
    seed,
    name: cleanText(src.name, LIMITS.nameLength),
    sections,
    outfit: kind === 'humanoid' ? normalizeItemList(src.outfit, kind, true, warn) : [],
    accessories: normalizeItemList(src.accessories, kind, false, warn),
  }
  if (src.meta && typeof src.meta === 'object') {
    const m = src.meta as Record<string, unknown>
    const meta: NonNullable<AvatarDNA['meta']> = {}
    for (const k of ['species', 'theme', 'source'] as const) {
      const t = cleanText(m[k], 40)
      if (t) meta[k] = t
    }
    if (Object.keys(meta).length) dna.meta = meta
  }
  return dna
}

/** Strict check for APIs: the list of problems, empty when the input is already valid. */
export function validateDNA(input: unknown): string[] {
  const report: NormalizeReport = { warnings: [] }
  if (!input || typeof input !== 'object') return ['DNA must be a JSON object.']
  const src = input as Record<string, unknown>
  if (src.v !== DNA_VERSION) report.warnings.push(`DNA version ${String(src.v)} was migrated to ${DNA_VERSION}.`)
  normalizeDNA(input, report)
  return report.warnings
}

/** Re-coerces one param value (used by editors). */
export function coerceItemParam(itemId: string, key: string, value: unknown) {
  const spec = itemSpec(itemId)?.params.find((p) => p.key === key)
  return spec ? coerce(spec, value) : undefined
}

export const KNOWN_ITEM_IDS = new Set(ALL_ITEMS.map((i) => i.id))

/* Parameter specs: the vocabulary the whole avatar system is described in.
 *
 * Every tunable thing about an avatar — a slider, a colour, a style choice — is declared
 * once as a ParamSpec. The studio builds its controls from these specs, the randomizer
 * draws from them, validation clamps against them, the service publishes them as its
 * catalogue, and the Unity SDK and AI integrations read that catalogue. Add a param
 * here and every one of those consumers picks it up. */

import type { PaletteId } from '../core/color.ts'

export type AvatarKind = 'humanoid' | 'creature'
export type ParamValue = number | string | boolean

export interface ChoiceOption {
  id: string
  label: string
  /** Free-form tags used by themed randomization ("fantasy", "formal", "spooky"...). */
  tags?: readonly string[]
  /** Relative weight in plain randomization (default 1). 0 = never picked at random. */
  weight?: number
}

/** Show a param only when another param in the same section has one of these values. */
export interface VisibleIf {
  key: string
  in?: readonly ParamValue[]
  notIn?: readonly ParamValue[]
  /** Look the key up in another section instead of this one. */
  section?: string
}

/** How the randomizer treats a param. */
export interface RandomHint {
  /** `uniform` over the range (default for ranges); `normal` around the default; `keep` never changes. */
  mode?: 'uniform' | 'normal' | 'keep'
  sd?: number
  /** Probability a colour/choice with a "none" option comes out as something other than none. */
  p?: number
  min?: number
  max?: number
}

interface BaseSpec {
  key: string
  label: string
  help?: string
  visibleIf?: VisibleIf
  random?: RandomHint
  /** Advanced params are folded away in the studio by default. */
  advanced?: boolean
}

export interface RangeSpec extends BaseSpec {
  type: 'range'
  min: number
  max: number
  step: number
  default: number
  /** Labels for the ends of the slider ("Slim" … "Heavy"). */
  ends?: readonly [string, string]
}

export interface ColorSpec extends BaseSpec {
  type: 'color'
  default: string
  palette: PaletteId
  /** Allows the empty string, meaning "automatic" (derived from another colour). */
  allowAuto?: boolean
}

export interface ChoiceSpec extends BaseSpec {
  type: 'choice'
  default: string
  options: readonly ChoiceOption[]
  /** The studio renders a thumbnail per option, cropped to this region. */
  preview?: 'head' | 'face' | 'eyes' | 'bust' | 'full' | 'none'
}

export interface ToggleSpec extends BaseSpec {
  type: 'toggle'
  default: boolean
}

export interface TextSpec extends BaseSpec {
  type: 'text'
  default: string
  maxLength: number
  /** Characters allowed; others are stripped (the engine's stroke font covers these). */
  charset?: string
}

export type ParamSpec = RangeSpec | ColorSpec | ChoiceSpec | ToggleSpec | TextSpec

export type Params = Record<string, ParamValue>

/* ---- Small builders so the schema reads like a table ------------------ */

export const range = (
  key: string,
  label: string,
  def: number,
  opts: Partial<Omit<RangeSpec, 'type' | 'key' | 'label' | 'default'>> = {},
): RangeSpec => ({ type: 'range', key, label, min: 0, max: 1, step: 0.01, default: def, ...opts })

export const color = (
  key: string,
  label: string,
  def: string,
  palette: PaletteId,
  opts: Partial<Omit<ColorSpec, 'type' | 'key' | 'label' | 'default' | 'palette'>> = {},
): ColorSpec => ({ type: 'color', key, label, default: def, palette, ...opts })

export const choice = (
  key: string,
  label: string,
  def: string,
  options: readonly ChoiceOption[],
  opts: Partial<Omit<ChoiceSpec, 'type' | 'key' | 'label' | 'default' | 'options'>> = {},
): ChoiceSpec => ({ type: 'choice', key, label, default: def, options, ...opts })

export const toggle = (
  key: string,
  label: string,
  def: boolean,
  opts: Partial<Omit<ToggleSpec, 'type' | 'key' | 'label' | 'default'>> = {},
): ToggleSpec => ({ type: 'toggle', key, label, default: def, ...opts })

export const text = (
  key: string,
  label: string,
  def: string,
  maxLength: number,
  opts: Partial<Omit<TextSpec, 'type' | 'key' | 'label' | 'default' | 'maxLength'>> = {},
): TextSpec => ({ type: 'text', key, label, default: def, maxLength, ...opts })

/** `opts('a:Label A', 'b:Label B|tag1,tag2|0.5')` → ChoiceOption[] */
export function opts(...defs: string[]): ChoiceOption[] {
  return defs.map((d) => {
    const [head, tags, weight] = d.split('|')
    const [id, label] = head.split(':')
    const o: ChoiceOption = { id, label: label ?? id }
    if (tags) o.tags = tags.split(',').map((t) => t.trim()).filter(Boolean)
    if (weight !== undefined) o.weight = Number(weight)
    return o
  })
}

/** Default values for a list of specs. */
export function defaultsOf(specs: readonly ParamSpec[]): Params {
  const out: Params = {}
  for (const s of specs) out[s.key] = s.default
  return out
}

/** Clamps/normalizes one value against its spec; unknown or malformed values fall back. */
export function coerce(spec: ParamSpec, v: unknown): ParamValue {
  switch (spec.type) {
    case 'range': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
      if (!Number.isFinite(n)) return spec.default
      // Four decimals is finer than any slider and keeps stored DNA stable and small.
      return Math.round(Math.min(spec.max, Math.max(spec.min, n)) * 10000) / 10000
    }
    case 'color': {
      if (spec.allowAuto && (v === '' || v === 'auto')) return ''
      return typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v.toLowerCase() : spec.default
    }
    case 'choice':
      return typeof v === 'string' && spec.options.some((o) => o.id === v) ? v : spec.default
    case 'toggle':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : spec.default
    case 'text': {
      if (typeof v !== 'string') return spec.default
      let s = v.normalize('NFKC').toUpperCase()
      if (spec.charset) s = [...s].filter((ch) => spec.charset!.includes(ch)).join('')
      return s.slice(0, spec.maxLength)
    }
  }
}

/** Fills defaults and coerces every known key; drops unknown keys. */
export function normalizeParams(specs: readonly ParamSpec[], input: unknown): Params {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out: Params = {}
  for (const s of specs) out[s.key] = s.key in src ? coerce(s, src[s.key]) : s.default
  return out
}

export function isVisible(spec: ParamSpec, params: Params, lookup?: (section: string, key: string) => ParamValue | undefined): boolean {
  const vi = spec.visibleIf
  if (!vi) return true
  const v = vi.section ? lookup?.(vi.section, vi.key) : params[vi.key]
  if (v === undefined) return true
  if (vi.in && !vi.in.includes(v)) return false
  if (vi.notIn && vi.notIn.includes(v)) return false
  return true
}

/* Colour. Shading is done in OKLCH so a shadow keeps its hue family and reads as
 * "the same colour, in shade" on every skin tone, fabric and fur, rather than going
 * muddy the way an sRGB multiply does. Shadows cool toward blue-violet and highlights
 * warm toward yellow — the painter's rule that makes flat vector art look lit. */

import { clamp, clamp01, lerp, wrap } from './math.ts'
import type { Rng } from './rng.ts'

export interface RGB {
  r: number
  g: number
  b: number
}

export interface LCH {
  l: number
  c: number
  h: number
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export function isColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v)
}

export function parseColor(hex: string): RGB {
  const m = HEX.exec(hex.trim())
  if (!m) return { r: 128, g: 128, b: 128 }
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

const hx = (v: number): string => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')
export const toHex = ({ r, g, b }: RGB): string => `#${hx(r)}${hx(g)}${hx(b)}`

/** Canonical lower-case #rrggbb, or the fallback when the input is not a colour. */
export function normalizeColor(v: unknown, fallback: string): string {
  return isColor(v) ? toHex(parseColor(v)) : fallback
}

/* ---- sRGB <-> OKLab <-> OKLCH ---------------------------------------- */

const toLinear = (c: number): number => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const fromLinear = (v: number): number => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

function rgbToOklab({ r, g, b }: RGB): [number, number, number] {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = ([r, g, b]: [number, number, number]): boolean =>
  r >= -1e-4 && r <= 1.0001 && g >= -1e-4 && g <= 1.0001 && b >= -1e-4 && b <= 1.0001

export function toLch(hex: string): LCH {
  const [L, a, b] = rgbToOklab(parseColor(hex))
  const c = Math.hypot(a, b)
  const h = c < 1e-5 ? 0 : wrap((Math.atan2(b, a) * 180) / Math.PI, 360)
  return { l: L, c, h }
}

/** OKLCH to hex; out-of-gamut colours keep their lightness and hue and lose chroma. */
export function fromLch({ l, c, h }: LCH): string {
  const L = clamp01(l)
  const hr = (h * Math.PI) / 180
  let lo = 0
  let hi = Math.max(0, c)
  let lin = oklabToLinear(L, hi * Math.cos(hr), hi * Math.sin(hr))
  if (!inGamut(lin)) {
    for (let i = 0; i < 18; i++) {
      const midC = (lo + hi) / 2
      const t = oklabToLinear(L, midC * Math.cos(hr), midC * Math.sin(hr))
      if (inGamut(t)) lo = midC
      else hi = midC
    }
    lin = oklabToLinear(L, lo * Math.cos(hr), lo * Math.sin(hr))
  }
  return toHex({ r: fromLinear(clamp01(lin[0])), g: fromLinear(clamp01(lin[1])), b: fromLinear(clamp01(lin[2])) })
}

/** Shortest-path hue interpolation. */
function lerpHue(a: number, b: number, t: number): number {
  const d = wrap(b - a + 180, 360) - 180
  return wrap(a + d * t, 360)
}

/* ---- Operations used by the renderer ---------------------------------- */

/** Mix in OKLab (perceptually even). */
export function mix(a: string, b: string, t: number): string {
  const A = rgbToOklab(parseColor(a))
  const B = rgbToOklab(parseColor(b))
  const lin = oklabToLinear(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t))
  return toHex({ r: fromLinear(clamp01(lin[0])), g: fromLinear(clamp01(lin[1])), b: fromLinear(clamp01(lin[2])) })
}

/** Cool, slightly more saturated shade. depth 0..1 (0.12 is a typical cel shadow). */
export function shadowOf(hex: string, depth = 0.12): string {
  const c = toLch(hex)
  const dl = depth * (0.45 + c.l * 0.75)
  return fromLch({
    l: c.l - dl,
    c: c.c < 0.02 ? c.c + depth * 0.08 : c.c * (1 + depth * 0.9),
    h: c.c < 0.02 ? 285 : lerpHue(c.h, 285, clamp01(depth * 1.1)),
  })
}

/** Warm highlight. amount 0..1. */
export function highlightOf(hex: string, amount = 0.1): string {
  const c = toLch(hex)
  return fromLch({
    l: c.l + amount * (1.15 - c.l) * 1.3,
    c: c.c * (1 - amount * 0.35),
    h: c.c < 0.02 ? c.h : lerpHue(c.h, 85, clamp01(amount * 0.8)),
  })
}

/** amount < 0 darkens (shadowOf), > 0 lightens (highlightOf). */
export function shade(hex: string, amount: number): string {
  if (amount === 0) return normalizeColor(hex, '#808080')
  return amount < 0 ? shadowOf(hex, -amount) : highlightOf(hex, amount)
}

/** Line-art colour derived from a fill: a deep, saturated version of the same hue. */
export function inkOf(hex: string, strength = 1): string {
  const c = toLch(hex)
  return fromLch({
    l: lerp(c.l, Math.max(0.16, c.l * 0.34), strength),
    c: Math.min(0.16, c.c * 1.05 + 0.02),
    h: c.c < 0.02 ? 290 : lerpHue(c.h, 300, 0.25),
  })
}

export function hueShift(hex: string, deg: number): string {
  const c = toLch(hex)
  return fromLch({ ...c, h: wrap(c.h + deg, 360) })
}

export function saturate(hex: string, factor: number): string {
  const c = toLch(hex)
  return fromLch({ ...c, c: c.c * factor })
}

export function lighten(hex: string, dl: number): string {
  const c = toLch(hex)
  return fromLch({ ...c, l: c.l + dl })
}

export function luminance(hex: string): number {
  const { r, g, b } = parseColor(hex)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export const isDark = (hex: string): boolean => toLch(hex).l < 0.55

/* ---- Lighting helpers (the Painter's light model) ------------------------ */

/** Exported shortest-path hue interpolation (degrees). */
export const mixHue = (a: number, b: number, t: number): number => lerpHue(a, b, t)

/** Perceptual distance in OKLab (about 0.02 is one just-noticeable step). */
export function deltaE(a: string, b: string): number {
  const A = rgbToOklab(parseColor(a))
  const B = rgbToOklab(parseColor(b))
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
}

/** Distance in the OKLab a/b plane only: small when two colours are the same paint in a
 *  different light (a shade or tint of one another). */
export function paintDistance(a: string, b: string): number {
  const A = rgbToOklab(parseColor(a))
  const B = rgbToOklab(parseColor(b))
  return Math.hypot(A[1] - B[1], A[2] - B[2])
}

/** Moves a colour's a/b (hue and chroma) toward `target` by t, keeping its lightness: tints a
 *  shadow with the ambient light without washing it out. */
export function tintToward(hex: string, target: string, t: number): string {
  if (t <= 0) return normalizeColor(hex, '#808080')
  const A = rgbToOklab(parseColor(hex))
  const B = rgbToOklab(parseColor(target))
  const lin = oklabToLinear(A[0], lerp(A[1], B[1], t), lerp(A[2], B[2], t))
  if (inGamut(lin)) return toHex({ r: fromLinear(clamp01(lin[0])), g: fromLinear(clamp01(lin[1])), b: fromLinear(clamp01(lin[2])) })
  const a = lerp(A[1], B[1], t)
  const b = lerp(A[2], B[2], t)
  return fromLch({ l: A[0], c: Math.hypot(a, b), h: wrap((Math.atan2(b, a) * 180) / Math.PI, 360) })
}

/** How a material's shadow behaves (see Painter materials). */
export interface ShadeTone {
  /** Hue (OKLCH degrees) the shadow leans toward. */
  hue: number
  /** Fraction of the way to `hue` at a typical depth (0.13), scaled with depth. */
  pull: number
  /** Chroma multiplier at a typical depth; > 1 keeps shadows rich instead of muddy. */
  chroma: number
  /** Lightness-drop multiplier: < 1 keeps subsurface materials (skin) luminous. */
  drop?: number
  /** Chroma given to near-greys in shadow, so they read as tinted rather than dirty. */
  grey?: number
}

/** A hue step toward `target`, t of the way. Yellows never swing toward green on their way to
 *  a cool hue (painters shade yellow toward ochre and orange), even when that way is shorter. */
export function shadowHue(h: number, target: number, t: number): number {
  let d = wrap(target - h + 180, 360) - 180
  if (h > 62 && h < 118 && d > 0 && target > 170 && target < 340) d -= 360
  return wrap(h + d * t, 360)
}

/**
 * Leans a colour toward a light's colour without muddying it. Near-greys take the light's
 * tint directly; chromatic colours turn their hue toward it (at most `maxTurn` degrees,
 * yellows via orange) and only blend when the two hues are already close.
 */
export function harmonize(hex: string, target: string, t: number, maxTurn = 36): string {
  if (t <= 0) return normalizeColor(hex, '#808080')
  const c = toLch(hex)
  const tc = toLch(target)
  if (tc.c < 0.02) return normalizeColor(hex, '#808080')
  if (c.c < 0.03) return tintToward(hex, target, t)
  const h = shadowHue(c.h, tc.h, t)
  const turn = clamp(wrap(h - c.h + 180, 360) - 180, -maxTurn, maxTurn)
  const d = Math.abs(wrap(tc.h - c.h + 180, 360) - 180)
  const rotated = fromLch({ l: c.l, c: c.c, h: wrap(c.h + turn, 360) })
  const close = Math.max(0, Math.cos((d * Math.PI) / 180))
  return close > 0.05 ? tintToward(rotated, target, t * close * 0.5) : rotated
}

/** A lit shadow tone: darker, hue-shifted toward `t.hue`, never desaturated into grey mud. */
export function shadeTone(hex: string, depth: number, t: ShadeTone): string {
  const c = toLch(hex)
  const k = depth / 0.13
  const dl = depth * (0.45 + c.l * 0.75) * (t.drop ?? 1)
  if (c.c < 0.02) return fromLch({ l: c.l - dl, c: c.c + depth * (t.grey ?? 0.1), h: t.hue })
  const cf = Math.max(0.35, 1 + (t.chroma - 1) * k)
  return fromLch({ l: c.l - dl, c: c.c * cf, h: shadowHue(c.h, t.hue, clamp01(t.pull * k)) })
}

/** A lit highlight tone leaning toward the key light's hue (default warm, 85°). */
export function lightTone(hex: string, amount: number, hue = 85, pull = 0.8): string {
  const c = toLch(hex)
  return fromLch({
    l: c.l + amount * (1.15 - c.l) * 1.3,
    c: c.c * (1 - amount * 0.35),
    h: c.c < 0.02 ? c.h : lerpHue(c.h, hue, clamp01(amount * pull)),
  })
}

/** A readable colour (near-black or near-white) to draw on top of `bg`. */
export const onColor = (bg: string): string => (isDark(bg) ? '#fbf8f2' : '#1b1622')

/* ---- Curated palettes ------------------------------------------------- */

export const SKIN_TONES = [
  '#fde7d9', '#f9dcc8', '#f5d0c5', '#f3cfb3', '#efc4a2', '#e6c19b', '#e9b894', '#e1ab86',
  '#d69d78', '#c98d68', '#c5a077', '#bb7d59', '#ad704e', '#a37b5c', '#9d6243', '#8c5539',
  '#7b4a31', '#6b3f2a', '#5c3523', '#4e2d1e', '#422619', '#372014',
] as const

export const FANTASY_SKIN = [
  '#a8e6cf', '#7fc8a9', '#5e9e6e', '#8ab6f9', '#5f7fd6', '#b9a4f2', '#f7a8c4', '#e57373',
  '#c2c2c2', '#8d99a6', '#4a6572', '#ffd54f', '#e0f7fa', '#6b5b95', '#f4b183', '#303841',
] as const

export const HAIR_NATURAL = [
  '#1b1512', '#2d1f18', '#3f2a1f', '#5a3825', '#7a4b2a', '#8d5a36', '#a86b3c', '#b5542f',
  '#c8632f', '#d98b4a', '#d9b26f', '#e8c885', '#f2dcaa', '#f5ecd7', '#9e9e9e', '#d8d8d8', '#f4f4f4',
] as const

export const HAIR_FANTASY = [
  '#ff6fae', '#ff9ecb', '#c36bff', '#8a4dff', '#6b7dff', '#35c6e8', '#2ed19a', '#7bd148',
  '#ff4d4d', '#ff9b3d', '#ffe066', '#1f3a93', '#b0f2ff', '#2b2b3a',
] as const

export const EYE_COLORS = [
  '#2a1a10', '#3b2314', '#5b3a1e', '#7a5230', '#8e6d3a', '#b07d2b', '#5d7b3a', '#3f7a5c',
  '#4f7aa8', '#2d5f9a', '#7fa7c9', '#7b8a94', '#8067a8', '#c0392b', '#d4a017', '#1a1a1a',
  '#e84393', '#00cec9',
] as const

export const LIP_COLORS = [
  '#c97b75', '#b5655f', '#d98880', '#a0524d', '#8a3f3b', '#e57373', '#d81b60', '#ad1457',
  '#ff8a80', '#b71c1c', '#6d4c41', '#9575cd', '#3f3f5a', '#f8bbd0',
] as const

export const CLOTH_COLORS = [
  '#f5f2eb', '#e8e1d3', '#c9c2b6', '#8a8580', '#4b4a52', '#26252c', '#141319',
  '#e53935', '#c62828', '#ff7043', '#fb8c00', '#fdd835', '#c0ca33', '#7cb342',
  '#2e7d32', '#00897b', '#26a69a', '#00acc1', '#039be5', '#1e88e5', '#3949ab',
  '#283593', '#5e35b1', '#8e24aa', '#d81b60', '#ec407a', '#f48fb1', '#a1887f',
  '#6d4c41', '#4e342e', '#795548', '#bcaaa4', '#d7ccc8', '#b0bec5', '#546e7a', '#37474f',
] as const

export const METAL_COLORS = ['#f2d14a', '#c79212', '#d9d9e0', '#a8a8b3', '#cd7f32', '#b87333', '#e8b4b8', '#5a5a66'] as const

export const NATURE_COLORS = [
  '#e8a55a', '#c97a3a', '#8b5a2b', '#5c3d24', '#2f2320', '#f2efe9', '#9e9e9e', '#555555',
  '#e0c38c', '#b8865b', '#d35400', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#c0392b',
  '#16a085', '#f39c12', '#6ab04c', '#30336b',
] as const

export const PALETTES = {
  skin: [...SKIN_TONES, ...FANTASY_SKIN],
  skinNatural: [...SKIN_TONES],
  hair: [...HAIR_NATURAL, ...HAIR_FANTASY],
  hairNatural: [...HAIR_NATURAL],
  eyes: [...EYE_COLORS],
  lips: [...LIP_COLORS],
  cloth: [...CLOTH_COLORS],
  metal: [...METAL_COLORS],
  nature: [...NATURE_COLORS],
  any: [...CLOTH_COLORS, ...METAL_COLORS],
} as const

export type PaletteId = keyof typeof PALETTES

/* ---- Harmonies -------------------------------------------------------- */

export type HarmonyScheme = 'analogous' | 'complementary' | 'triadic' | 'split' | 'monochrome' | 'neutral-accent'

/**
 * Five coordinated colours from a base hue: [main, secondary, accent, dark neutral,
 * light neutral]. Random outfits draw from one harmony so they read as dressed on
 * purpose rather than assembled by a dice roll.
 */
export function harmony(rng: Rng, scheme?: HarmonyScheme, baseHue?: number): string[] {
  const s: HarmonyScheme =
    scheme ?? rng.pick(['analogous', 'complementary', 'triadic', 'split', 'monochrome', 'neutral-accent'] as const)
  const h = baseHue ?? rng.range(0, 360)
  const l = rng.range(0.48, 0.72)
  const c = rng.range(0.08, 0.17)
  const at = (dh: number, dl = 0, cf = 1) => fromLch({ l: l + dl, c: c * cf, h: wrap(h + dh, 360) })
  const darkN = fromLch({ l: rng.range(0.22, 0.34), c: rng.range(0.01, 0.04), h: wrap(h + 200, 360) })
  const lightN = fromLch({ l: rng.range(0.88, 0.96), c: rng.range(0.005, 0.025), h: wrap(h + 40, 360) })
  switch (s) {
    case 'analogous':
      return [at(0), at(30, -0.08), at(-30, 0.1), darkN, lightN]
    case 'complementary':
      return [at(0), at(0, -0.18, 0.8), at(180, 0.05), darkN, lightN]
    case 'triadic':
      return [at(0), at(120, -0.05), at(240, 0.08), darkN, lightN]
    case 'split':
      return [at(0), at(150, -0.06), at(210, 0.06), darkN, lightN]
    case 'monochrome':
      return [at(0), at(0, -0.2), at(0, 0.18, 0.7), darkN, lightN]
    case 'neutral-accent':
    default:
      return [darkN, lightN, at(0, 0.02, 1.2), at(0, -0.22, 0.5), mix(darkN, lightN, 0.5)]
  }
}

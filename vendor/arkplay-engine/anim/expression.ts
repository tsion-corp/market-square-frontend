/* Expressions are points in a continuous face space (ExprState). Presets are named
 * points; intensity slides from neutral toward them; animations (blinks, talking,
 * emotes) move through the same space, so every expression works on every face —
 * humanoid or creature — with no per-face art. */

import { clamp, lerp } from '../core/math.ts'
import type { ExprState, EyeMode, MouthShape } from '../render/types.ts'

export const NEUTRAL: ExprState = {
  openL: 1,
  openR: 1,
  squint: 0,
  lookX: 0,
  lookY: 0,
  lidAngle: 0,
  eyeL: 'normal',
  eyeR: 'normal',
  browRaise: 0,
  browAngle: 0,
  browAsym: 0,
  smile: 0.08,
  open: 0,
  wide: 0,
  asym: 0,
  mouth: 'normal',
  blush: 0,
  tears: 0,
  sweat: 0,
  vein: false,
  zzz: false,
  steam: false,
  sick: 0,
  headTilt: 0,
}

type Partial2 = Partial<ExprState> & { eye?: EyeMode }

export const EXPRESSION_PRESETS: Record<string, Partial2> = {
  neutral: {},
  happy: { smile: 0.75, squint: 0.22, browRaise: 0.15, blush: 0.12 },
  grin: { smile: 1, open: 0.32, mouth: 'teeth', squint: 0.35, browRaise: 0.2 },
  laugh: { smile: 1, open: 0.85, eye: 'happy', browRaise: 0.35, blush: 0.3, headTilt: -4 },
  smirk: { smile: 0.45, asym: 0.8, browAsym: 0.6, lidAngle: 0.15, openL: 0.85, openR: 0.85, lookX: 0.2 },
  excited: { smile: 1, open: 0.6, eye: 'sparkle', browRaise: 0.6, blush: 0.3 },
  love: { smile: 0.8, eye: 'hearts', blush: 0.7, open: 0.15 },
  wink: { smile: 0.8, eyeL: 'happy', openL: 0, asym: 0.3, browAsym: -0.4 },
  tongue: { smile: 0.6, open: 0.35, mouth: 'tongue', eyeL: 'happy', openL: 0, browAsym: -0.3 },
  cool: { openL: 0.6, openR: 0.6, lidAngle: 0.3, smile: 0.25, asym: 0.4, browAngle: 0.2 },
  smug: { openL: 0.55, openR: 0.55, smile: 0.5, asym: 0.6, browAsym: -0.5, lidAngle: -0.1, headTilt: 4 },
  determined: { browAngle: 0.7, smile: 0.05, lidAngle: 0.3, mouth: 'flat' },
  surprised: { openL: 1.25, openR: 1.25, browRaise: 1, open: 0.5, mouth: 'o', smile: 0 },
  shocked: { eye: 'wide', openL: 1.35, openR: 1.35, browRaise: 1, open: 1, mouth: 'o', sweat: 0.6, smile: -0.2 },
  sad: { smile: -0.6, browAngle: -0.8, lidAngle: -0.4, openL: 0.85, openR: 0.85, lookY: 0.3 },
  cry: { smile: -0.8, open: 0.45, mouth: 'wavy', browAngle: -1, eye: 'sad', tears: 1 },
  worried: { browAngle: -0.8, smile: -0.25, mouth: 'wavy', sweat: 0.6, openL: 1.05, openR: 1.05 },
  scared: { openL: 1.25, openR: 1.25, browRaise: 0.6, browAngle: -0.6, open: 0.4, mouth: 'grimace', sweat: 0.8 },
  angry: { browAngle: 1, lidAngle: 0.6, smile: -0.5, mouth: 'flat', vein: true },
  furious: { browAngle: 1, lidAngle: 0.8, open: 0.6, mouth: 'grimace', smile: -0.8, vein: true, steam: true, blush: 0.5 },
  pout: { smile: -0.2, mouth: 'pout', browAngle: -0.3, blush: 0.45, lookX: 0.45 },
  embarrassed: { blush: 1, smile: 0.2, mouth: 'wavy', eye: 'happy', sweat: 0.5 },
  confused: { browAsym: 0.8, smile: -0.1, asym: -0.5, mouth: 'wavy', lookY: -0.45, lookX: 0.3, headTilt: 6 },
  bored: { openL: 0.5, openR: 0.5, smile: -0.1, mouth: 'flat', lookX: 0.5 },
  sleepy: { openL: 0.15, openR: 0.15, open: 0.25, mouth: 'o', zzz: true, browRaise: -0.2, headTilt: 5 },
  dizzy: { eye: 'spiral', smile: 0.1, mouth: 'wavy', open: 0.2, headTilt: -6 },
  sick: { sick: 1, smile: -0.3, mouth: 'wavy', openL: 0.6, openR: 0.6, sweat: 0.5 },
  mischief: { smile: 0.7, asym: 0.3, lidAngle: 0.4, browAngle: 0.5, openL: 0.72, openR: 0.72, mouth: 'teeth', open: 0.15, lookX: 0.4 },
  // stickers: sticker- and comic-only faces (export/stickers.ts, export/comics.ts). Not DNA options:
  // never add them to EXPRESSIONS in dna/schema.
  'sticker-serene': { eye: 'closed', smile: 0.5, browRaise: 0.15, blush: 0.25 },
  'sticker-grateful': { eye: 'happy', smile: 0.72, blush: 0.45, browRaise: 0.2, headTilt: 5 },
  'sticker-starry': { eye: 'stars', smile: 1, open: 0.55, browRaise: 0.6, blush: 0.3 },
  'sticker-wow': { eye: 'sparkle', openL: 1.3, openR: 1.3, browRaise: 1, open: 0.7, mouth: 'o', smile: 0.3 },
  'sticker-joy': { eye: 'happy', smile: 1, open: 0.75, browRaise: 0.45, blush: 0.35, tears: 0.55, headTilt: -3 },
  'sticker-proud': { eye: 'happy', smile: 0.85, open: 0.22, mouth: 'teeth', browRaise: 0.3, headTilt: -4 },
  'sticker-yawn': { openL: 0.2, openR: 0.2, open: 0.95, mouth: 'o', zzz: true, browRaise: 0.3, tears: 0.2, headTilt: 4 },
  'sticker-awkward': { eye: 'happy', smile: 0.4, mouth: 'wavy', sweat: 0.9, browAngle: -0.4, blush: 0.3 },
  'sticker-focus': { browAngle: 0.8, lidAngle: 0.35, smile: 0.2, mouth: 'tongue', open: 0.15, lookX: 0.3 },
}

const NUMERIC: (keyof ExprState)[] = [
  'openL', 'openR', 'squint', 'lookX', 'lookY', 'lidAngle', 'browRaise', 'browAngle', 'browAsym',
  'smile', 'open', 'wide', 'asym', 'blush', 'tears', 'sweat', 'sick', 'headTilt',
]

/** Resolves a preset at an intensity, plus gaze/tilt from the DNA sliders. */
export function expressionState(preset: string, intensity = 0.8, extra: { lookX?: number; lookY?: number; tilt?: number } = {}): ExprState {
  const p = EXPRESSION_PRESETS[preset] ?? {}
  const k = clamp(intensity, 0, 1.2)
  const out: ExprState = { ...NEUTRAL }
  for (const key of NUMERIC) {
    const target = p[key] as number | undefined
    if (target !== undefined) (out as unknown as Record<string, number>)[key] = lerp(NEUTRAL[key] as number, target, k)
  }
  if (k > 0.3) {
    if (p.eye) out.eyeL = out.eyeR = p.eye
    if (p.eyeL) out.eyeL = p.eyeL
    if (p.eyeR) out.eyeR = p.eyeR
    if (p.mouth) out.mouth = p.mouth as MouthShape
    out.vein = !!p.vein
    out.zzz = !!p.zzz
    out.steam = !!p.steam
  }
  out.lookX = clamp(out.lookX + (extra.lookX ?? 0), -1, 1)
  out.lookY = clamp(out.lookY + (extra.lookY ?? 0), -1, 1)
  out.headTilt += extra.tilt ?? 0
  return out
}

/** Blends two states (numbers interpolate, discrete modes switch at the midpoint). */
export function blendExpr(a: ExprState, b: ExprState, t: number): ExprState {
  const out = { ...(t < 0.5 ? a : b) }
  for (const key of NUMERIC) (out as unknown as Record<string, number>)[key] = lerp(a[key] as number, b[key] as number, t)
  return out
}

/* ---- Lip sync --------------------------------------------------------- */

export type Viseme = 'rest' | 'A' | 'E' | 'I' | 'O' | 'U' | 'M' | 'F' | 'L'

export const VISEMES: Record<Viseme, Partial<ExprState>> = {
  rest: { open: 0.02 },
  A: { open: 0.75, wide: 0.1, mouth: 'normal' },
  E: { open: 0.4, wide: 0.5, mouth: 'teeth' },
  I: { open: 0.25, wide: 0.65, mouth: 'teeth' },
  O: { open: 0.6, wide: -0.5, mouth: 'o' },
  U: { open: 0.32, wide: -0.75, mouth: 'o' },
  M: { open: 0, wide: -0.1, mouth: 'flat' },
  F: { open: 0.12, wide: 0.1, mouth: 'teeth' },
  L: { open: 0.45, wide: 0.2, mouth: 'tongue' },
}

export function withViseme(base: ExprState, v: Viseme): ExprState {
  const vis = VISEMES[v]
  return { ...base, ...vis, smile: base.smile * 0.6, mouth: vis.mouth ?? 'normal' }
}

/** Maps text to a viseme sequence (for talk animations in games). */
export function visemesFor(textIn: string): Viseme[] {
  const out: Viseme[] = []
  for (const ch of textIn.toLowerCase()) {
    if ('a'.includes(ch)) out.push('A')
    else if ('eh'.includes(ch)) out.push('E')
    else if ('iy'.includes(ch)) out.push('I')
    else if ('o'.includes(ch)) out.push('O')
    else if ('uwq'.includes(ch)) out.push('U')
    else if ('mbp'.includes(ch)) out.push('M')
    else if ('fv'.includes(ch)) out.push('F')
    else if ('ltdn'.includes(ch)) out.push('L')
    else if (/[a-z]/.test(ch)) out.push('E')
    else out.push('rest')
  }
  return out
}

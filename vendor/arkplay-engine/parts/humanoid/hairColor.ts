import { fromLch, mix, toLch } from '../../core/color.ts'
import { clamp, lerp } from '../../core/math.ts'
import type { Ctx } from '../../render/context.ts'

/** Hair colour after age: silver creeps in past middle age. */
export function hairColorOf(c: Ctx): string {
  const hair = c.sec('hair').c('color', '#3f2a1f')
  const gray = clamp((c.sec('skin').n('age') - 0.6) * 2.2, 0, 0.85)
  return gray > 0 ? mix(hair, '#d6d6d9', gray) : hair
}

/**
 * The material colours of one head of hair, derived from its raw (ungraded) colour. Every
 * value is raw too: draw them through the Painter so the colour grade applies once.
 *
 * The rules are what keep hair readable at every colour:
 *   - black and near-black hair gets a cool blue sheen (warm browns a warm one), so it shows
 *     form instead of a flat silhouette;
 *   - blonde, pastel and white hair get deep, hue-shifted shadows (amber, violet) so the
 *     clumps read and the colour never washes out;
 *   - grey and white hair gets bright, slightly cool silvery speculars.
 */
export interface HairPalette {
  base: string
  /** Fill of layers that sit behind the head (occluded, a little darker). */
  back: string
  /** Ambient occlusion: roots, under-layers, the gap between locks and neck. */
  deep: string
  /** Clump separation shadows. */
  dark: string
  /** The lit edge of a clump. */
  light: string
  /** The anisotropic sheen band. */
  sheen: string
  /** Tiny brightest specular glints on the sheen band. */
  spec: string
  /** Rim light on the silhouette (a cool sky bounce). */
  rim: string
  /** Natural tip tone (a touch lighter and warmer than the roots). */
  tipTone: string
  /** How strong the sheen should be for this colour (dark hair shows more). */
  sheenK: number
  kind: 'dark' | 'mid' | 'light' | 'silver' | 'vivid'
}

const cache = new Map<string, HairPalette>()

const hueToward = (h: number, target: number, t: number): number => {
  const d = ((target - h + 540) % 360) - 180
  return (h + d * t + 360) % 360
}

export function hairPalette(raw: string): HairPalette {
  const hit = cache.get(raw)
  if (hit) return hit
  const c = toLch(raw)
  const { l, h } = c
  const ch = c.c
  const neutral = ch < 0.035
  const warm = !neutral && h > 20 && h < 95
  const kind: HairPalette['kind'] = neutral && l > 0.55 ? 'silver' : l < 0.34 ? 'dark' : l > 0.72 ? 'light' : ch > 0.11 ? 'vivid' : 'mid'
  const L = (v: number) => clamp(v, 0.04, 0.985)
  let p: HairPalette
  switch (kind) {
    case 'dark': {
      // Near-black: cool blue sheen. Dark brown: warm chestnut sheen. Dark fantasy: lifted hue.
      const sheen = neutral || ch < 0.03 ? fromLch({ l: L(l + 0.36), c: 0.05, h: 252 }) : warm ? fromLch({ l: L(l + 0.3), c: Math.min(0.12, ch * 1.25 + 0.02), h: hueToward(h, 62, 0.3) }) : fromLch({ l: L(l + 0.32), c: ch * 1.05, h })
      p = {
        base: raw,
        back: fromLch({ l: L(l * 0.8), c: ch * 0.95, h }),
        deep: fromLch({ l: L(l * 0.45), c: ch * 0.9 + 0.012, h: neutral ? 275 : hueToward(h, 285, 0.25) }),
        dark: fromLch({ l: L(l * 0.55), c: ch * 0.95 + 0.012, h: neutral ? 270 : hueToward(h, 290, 0.2) }),
        light: fromLch({ l: L(l + 0.1), c: ch * 1.05 + (neutral ? 0.012 : 0), h: neutral ? 250 : h }),
        sheen,
        spec: mix(sheen, neutral || ch < 0.03 ? '#eef4ff' : '#fff1e2', 0.4),
        rim: fromLch({ l: L(Math.max(0.5, l + 0.3)), c: 0.06, h: warm ? 235 : 245 }),
        tipTone: fromLch({ l: L(l + 0.05), c: ch * 1.1, h: warm ? hueToward(h, 55, 0.2) : h }),
        sheenK: 1.05,
        kind,
      }
      break
    }
    case 'light': {
      // Blonde, platinum, pastel: rich hue-shifted shadows keep the form.
      const shadowHue = warm ? hueToward(h, 40, 0.45) : neutral ? 275 : hueToward(h, 300, 0.25)
      p = {
        base: raw,
        back: fromLch({ l: L(l - 0.1), c: ch * 1.2 + 0.01, h: warm ? hueToward(h, 50, 0.25) : h }),
        deep: fromLch({ l: L(l - 0.36), c: Math.min(0.16, ch * 1.5 + 0.035), h: shadowHue }),
        dark: fromLch({ l: L(l - 0.25), c: Math.min(0.16, ch * 1.45 + 0.03), h: shadowHue }),
        light: fromLch({ l: L(l + 0.08), c: ch * 0.8, h }),
        sheen: fromLch({ l: L(Math.min(0.98, l + 0.14)), c: ch * 0.45, h: warm ? hueToward(h, 95, 0.4) : h }),
        spec: '#fffdf6',
        rim: fromLch({ l: 0.97, c: 0.02, h: warm ? 85 : 230 }),
        tipTone: fromLch({ l: L(l + 0.04), c: ch * 0.85, h: warm ? hueToward(h, 90, 0.2) : h }),
        sheenK: 0.8,
        kind,
      }
      break
    }
    case 'silver': {
      p = {
        base: raw,
        back: fromLch({ l: L(l - 0.1), c: 0.012, h: 260 }),
        deep: fromLch({ l: L(l - 0.38), c: 0.035, h: 268 }),
        dark: fromLch({ l: L(l - 0.27), c: 0.03, h: 262 }),
        light: fromLch({ l: L(l + 0.07), c: 0.008, h: 240 }),
        sheen: fromLch({ l: 0.985, c: 0.012, h: 225 }),
        spec: '#ffffff',
        rim: fromLch({ l: 0.96, c: 0.028, h: 220 }),
        tipTone: fromLch({ l: L(l + 0.04), c: 0.01, h: 90 }),
        sheenK: 1.15,
        kind,
      }
      break
    }
    case 'vivid': {
      p = {
        base: raw,
        back: fromLch({ l: L(l - 0.08), c: ch * 1.02, h: hueToward(h, 290, 0.08) }),
        deep: fromLch({ l: L(l - 0.3), c: ch * 1.05, h: hueToward(h, 290, 0.22) }),
        dark: fromLch({ l: L(l - 0.2), c: ch * 1.12, h: hueToward(h, 290, 0.16) }),
        light: fromLch({ l: L(l + 0.08), c: ch * 0.95, h }),
        sheen: fromLch({ l: L(lerp(l, 0.97, 0.62)), c: ch * 0.5, h: hueToward(h, 85, 0.12) }),
        spec: fromLch({ l: 0.98, c: ch * 0.18, h }),
        rim: fromLch({ l: L(Math.min(0.94, l + 0.28)), c: ch * 0.55, h: hueToward(h, 230, 0.25) }),
        tipTone: fromLch({ l: L(l + 0.05), c: ch * 1.05, h: hueToward(h, 60, 0.08) }),
        sheenK: 0.95,
        kind,
      }
      break
    }
    default: {
      // Browns, auburns, reds, muted colours.
      const shadowHue = warm ? hueToward(h, 25, 0.3) : neutral ? 272 : hueToward(h, 290, 0.2)
      p = {
        base: raw,
        back: fromLch({ l: L(l - 0.07), c: ch * 1.02, h }),
        deep: fromLch({ l: L(l * 0.5), c: ch * 1.1 + 0.01, h: shadowHue }),
        dark: fromLch({ l: L(l * 0.66), c: ch * 1.12 + 0.01, h: shadowHue }),
        light: fromLch({ l: L(l + 0.09), c: ch * 1.02, h }),
        sheen: fromLch({ l: L(l + 0.28), c: ch * 0.85, h: warm ? hueToward(h, 75, 0.3) : hueToward(h, 85, 0.1) }),
        spec: fromLch({ l: L(l + 0.45), c: ch * 0.4, h: hueToward(h, 85, 0.3) }),
        rim: fromLch({ l: L(Math.min(0.92, l + 0.36)), c: 0.05, h: 225 }),
        tipTone: fromLch({ l: L(l + 0.07), c: ch * 1.08, h: warm ? hueToward(h, 70, 0.2) : h }),
        sheenK: 1,
        kind,
      }
    }
  }
  if (cache.size > 256) cache.clear()
  cache.set(raw, p)
  return p
}

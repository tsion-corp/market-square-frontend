/* The head: face outline (front, profile, back), ears, the face's form shading, and the
 * static skin details that live on the face (freckles, moles, vitiligo, age lines, scars,
 * face paint).
 *
 * Head space: origin at the top of the neck; the skull top is near -0.93·headH and the
 * chin a little below 0. The face outline is exported so hair and hats can hug it.
 *
 * Lighting stays with the Painter (the head is one `paint.shape`); this file adds what is
 * intrinsic to a face: anatomy (cheekbones, sockets, jaw), skin as a material (warm
 * subsurface at the edges, flush on cheeks, nose and ears, a sheen on the planes that face
 * the light) and crafted skin marks. The rich layer is baked-only (`ctx.baked`). */

import { fromLch, mix, toLch } from '../../core/color.ts'
import { clamp, lerp, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, heart, poly, rect, smooth, sparkle, star, type SP } from '../../core/path.ts'
import { el, g, url } from '../../core/svg.ts'
import type { Ctx, PartList } from '../../render/context.ts'
import { Z } from '../../render/context.ts'
import type { HumanMeasure, HumanRig } from '../../rig/humanoid.ts'
import type { Painter } from '../../render/painter.ts'
import { hueTo, radialPaint, softSpot, warmShade } from '../shared/eye.ts'
import { skinOf } from './body.ts'
import { hairCoversEars } from './hair.ts'

interface ShapeDef {
  temple: number
  cheek: number
  jaw: number
  jawY: number
  chin: number
  chinY: number
  crown: number
  k: number
}

const SHAPES: Record<string, ShapeDef> = {
  oval: { temple: 0.98, cheek: 1.0, jaw: 0.8, jawY: 0.12, chin: 0.34, chinY: 0.055, crown: 0.93, k: 1 },
  round: { temple: 1.0, cheek: 1.03, jaw: 0.9, jawY: 0.14, chin: 0.48, chinY: 0.035, crown: 0.92, k: 1 },
  square: { temple: 1.0, cheek: 1.0, jaw: 0.97, jawY: 0.1, chin: 0.56, chinY: 0.04, crown: 0.93, k: 0.55 },
  heart: { temple: 1.02, cheek: 1.02, jaw: 0.7, jawY: 0.15, chin: 0.22, chinY: 0.075, crown: 0.93, k: 1 },
  long: { temple: 0.96, cheek: 0.96, jaw: 0.8, jawY: 0.1, chin: 0.38, chinY: 0.1, crown: 0.98, k: 1 },
  diamond: { temple: 0.86, cheek: 1.05, jaw: 0.72, jawY: 0.12, chin: 0.3, chinY: 0.065, crown: 0.94, k: 0.85 },
  pear: { temple: 0.88, cheek: 0.96, jaw: 1.0, jawY: 0.1, chin: 0.56, chinY: 0.04, crown: 0.9, k: 0.8 },
  soft: { temple: 0.99, cheek: 1.01, jaw: 0.92, jawY: 0.11, chin: 0.52, chinY: 0.045, crown: 0.93, k: 0.85 },
}

export interface FaceGeom {
  outline: SP[]
  /** Half-width of the face at a head-local y (front view), for placing things on it. */
  widthAt: (y: number) => number
  crownY: number
  chinY: number
  shape: ShapeDef
}

export function faceGeom(c: Ctx): FaceGeom {
  const m = (c.hr as HumanRig).m
  const h = c.sec('head')
  const sh = SHAPES[h.s('shape')] ?? SHAPES.oval
  const hh = m.headH
  const w = m.hw
  const age = c.sec('skin').n('age')
  const crown = sh.crown + (h.n('forehead') - 0.5) * 0.06
  const chinF = lerp(0.5, 1.6, h.n('chin'))
  const jawW = sh.jaw * lerp(0.88, 1.1, h.n('jaw')) + age * 0.04
  const cheekW = sh.cheek * lerp(0.95, 1.05, h.n('cheeks'))
  const chinY = hh * sh.chinY * chinF + hh * 0.02
  const right: SP[] = [
    [w * 0.72, -hh * (crown - 0.06)],
    [w * sh.temple, -hh * 0.62],
    [w * cheekW, -hh * 0.38],
    [w * jawW, -hh * (sh.jawY - age * 0.02), sh.k],
    [w * sh.chin * 0.92 * lerp(0.9, 1.1, h.n('jaw')), hh * sh.chinY * chinF * 0.55],
  ]
  const left = right.map(([x, y, k]) => (k === undefined ? [-x, y] : [-x, y, k]) as SP).reverse()
  const outline: SP[] = [[0, -hh * crown], ...right, [0, chinY], ...left]
  const ys = [-hh * crown, ...right.map((p) => p[1]), chinY]
  const xs = [0, ...right.map((p) => p[0]), 0]
  const widthAt = (y: number): number => {
    for (let i = 0; i < ys.length - 1; i++) {
      if (y >= ys[i] && y <= ys[i + 1]) return lerp(xs[i], xs[i + 1], (y - ys[i]) / (ys[i + 1] - ys[i] || 1))
    }
    return y < ys[0] ? 0 : xs[xs.length - 2] * 0.5
  }
  return { outline, widthAt, crownY: -hh * crown, chinY, shape: sh }
}

/**
 * Profile landmarks: the chin, the throat point where the jaw meets the front of the
 * neck, the jaw angle (gonion, over the neck, so its outline is hidden) and the nape.
 */
function profileJaw(m: HumanMeasure, c: Ctx): { gonion: P; nape: P; throat: P; chinBot: number; chinX: number } {
  const h = c.sec('head')
  const sh = SHAPES[h.s('shape')] ?? SHAPES.oval
  const hh = m.headH
  const w = m.hw
  const jawK = clamp((sh.jaw * lerp(0.88, 1.1, h.n('jaw')) - 0.62) / 0.45, 0, 1)
  const chinBot = hh * (sh.chinY * lerp(0.5, 1.6, h.n('chin')) * 0.85 + 0.03)
  const chinX = w * (0.8 + sh.chin * 0.14) * lerp(0.96, 1.04, h.n('jaw'))
  return {
    gonion: [w * lerp(0.12, 0.0, jawK), -hh * lerp(0.1, 0.05, jawK)],
    nape: [-w * 0.56, -hh * 0.17],
    throat: [w * 0.3, lerp(chinBot, -hh * 0.03, lerp(0.45, 0.25, jawK))],
    chinBot,
    chinX,
  }
}

/** Profile outline (facing +x), without the nose. It follows the face shape and sliders. */
export function profileOutline(m: HumanMeasure, c: Ctx): SP[] {
  const hh = m.headH
  const w = m.hw
  const h = c.sec('head')
  const sh = SHAPES[h.s('shape')] ?? SHAPES.oval
  const crown = sh.crown + (h.n('forehead') - 0.5) * 0.06
  const cheek = sh.cheek * lerp(0.95, 1.05, h.n('cheeks'))
  const { gonion, nape, throat, chinBot, chinX } = profileJaw(m, c)
  return [
    [0, -hh * crown],
    [w * 0.58, -hh * (crown - 0.07)],
    [w * 0.85, -hh * 0.7],
    [w * 0.93, -hh * 0.53],
    [w * 0.88, -hh * 0.45, 0.7],
    [w * (0.87 + (cheek - 1) * 0.6), -hh * 0.32],
    [w * 0.93, -hh * 0.2],
    [w * 0.9, -hh * 0.12],
    [w * 0.87, -hh * 0.055],
    [chinX, chinBot - hh * 0.05, 0.75],
    [chinX - w * 0.12, chinBot, 0.85],
    [lerp(throat[0], chinX - w * 0.12, 0.5), lerp(throat[1], chinBot, 0.75)],
    [throat[0], throat[1]],
    [gonion[0], gonion[1]],
    [-w * 0.22, -hh * 0.1],
    [nape[0], nape[1]],
    [-w * 0.88, -hh * 0.34],
    [-w * 0.98, -hh * 0.56],
    [-w * 0.8, -hh * 0.84],
  ]
}

/* ---- Skin as a material -------------------------------------------------------- */

export interface SkinTones {
  base: string
  /** Warm form shadow: never grey, keeps the skin's own warmth. */
  shadow: string
  /** Deeper warm tone (nostrils, the ear's bowl). */
  deep: string
  /** Fine feature lines (nose, creases). */
  line: string
  /** Saturated subsurface warmth for edges and terminators. */
  warm: string
  /** Rosy flush (cheeks, nose tip, ears). */
  flush: string
  /** Soft sheen and the sharp specular on planes facing the light. */
  sheen: string
  spec: string
  /** 0 for light skin … 1 for very deep skin (deep skin carries stronger sheen and spec). */
  depth: number
}

/**
 * The skin palette for form and material cues, from very light to very deep and fantasy.
 * With the painter, shadow and sheen lean halfway toward the painter's own skin tones, so
 * the face's soft anatomy takes the same scene light as the painter's form shading.
 */
export function skinTones(skin: string, P?: Painter): SkinTones {
  const cache = P ? (TONE_CACHE.get(P) ?? TONE_CACHE.set(P, new Map()).get(P)!) : BASE_CACHE
  const hit = cache.get(skin)
  if (hit) return hit
  const t = baseSkinTones(skin)
  const out = P
    ? {
        ...t,
        shadow: mix(t.shadow, P.tone(skin, 'shadow', 'skin'), 0.45),
        sheen: mix(t.sheen, P.tone(skin, 'highlight', 'skin'), 0.4),
        spec: mix(t.spec, P.tone(skin, 'spec', 'skin'), 0.4),
      }
    : t
  if (cache.size > 256) cache.clear()
  cache.set(skin, out)
  return out
}

const TONE_CACHE = new WeakMap<Painter, Map<string, SkinTones>>()
const BASE_CACHE = new Map<string, SkinTones>()

function baseSkinTones(skin: string): SkinTones {
  const c = toLch(skin)
  const natural = c.c > 0.015 && (c.h < 100 || c.h > 340)
  // Deep skin gets richer, more saturated highlights and a clearer specular.
  const deep = clamp((0.64 - c.l) / 0.36, 0, 1)
  return {
    base: skin,
    shadow: warmShade(skin, 0.22),
    deep: warmShade(skin, 0.5),
    line: mix(warmShade(skin, 0.5), '#2a1418', 0.38),
    warm: fromLch({ l: clamp(c.l * 0.8, 0.16, 0.7), c: clamp(c.c * 1.35 + 0.03, 0.06, 0.18), h: natural ? hueTo(c.h, 32, 0.6) : hueTo(c.h, 18, 0.4) }),
    flush: natural
      ? fromLch({ l: clamp(c.l * 0.93, 0.26, 0.72), c: clamp(c.c * 1.3 + 0.07 - deep * 0.02, 0.08, 0.19), h: lerp(18, 8, deep) })
      : fromLch({ l: c.l * 0.9, c: Math.min(0.22, c.c * 1.3 + 0.03), h: hueTo(c.h, 0, 0.25) }),
    sheen: fromLch({ l: Math.min(0.97, c.l + 0.1 + deep * 0.15), c: c.c * lerp(0.6, 1.05, deep) + deep * 0.02, h: hueTo(c.h, 70, natural ? 0.45 : 0.2) }),
    spec: fromLch({ l: Math.min(0.99, c.l + 0.24 + deep * 0.22), c: c.c * lerp(0.3, 0.7, deep), h: hueTo(c.h, 75, 0.5) }),
    depth: deep,
  }
}

/* ---- The head ------------------------------------------------------------------- */

export function headGen(c: Ctx, out: PartList): void {
  const m = (c.hr as HumanRig).m
  const P = c.paint
  const skin = skinOf(c)
  const w = m.hw

  if (c.view === 'side') {
    const { gonion, nape, throat } = profileJaw(m, c)
    const hh = m.headH
    // No outline where the head sits on the neck: the jaw hands over to the neck line.
    const oc = c.defs.unique('hoc')
    const big = rect(-w * 3, -hh * 3, w * 6, hh * 6)
    const hide = poly([[throat[0] - w * 0.01, throat[1] - hh * 0.04], [throat[0] - w * 0.01, hh], [nape[0] + w * 0.08, hh], [nape[0] + w * 0.08, nape[1] - hh * 0.04], [-w * 0.22, -hh * 0.15], [gonion[0], gonion[1] - hh * 0.05]])
    c.defs.put(oc, el('clipPath', { id: oc }, el('path', { d: big + hide, 'clip-rule': 'evenodd' })))
    // Shade from an outline that continues down into the neck, so the lit shape leaves no
    // crescent edge where the head sits on the neck.
    const po = profileOutline(m, c)
    const deepY = hh * 0.45
    const shadeFrom = smooth(po.map((p, i) => (i >= 13 && i <= 15 ? ([p[0], deepY] as SP) : p)))
    out.add('head', Z.head, 'head', P.shape(smooth(po), skin, { offset: 0.1, outlineClip: oc, shadeFrom }))
  } else {
    const fg = faceGeom(c)
    out.add('head', Z.head, 'head', P.shape(smooth(fg.outline), skin, { offset: 0.09 }))
  }

  // Ears.
  if (!c.hides('ears')) {
    const style = c.sec('head').s('ears') || 'round'
    if (style !== 'hidden') {
      const size = lerp(0.8, 1.25, c.sec('head').n('earSize'))
      if (c.view === 'side') {
        out.add('head', hairCoversEars(c) ? Z.head + 6 : Z.hairCap + 1, 'ear', earShape(c, m, style, size, 1, [-w * 0.08, m.earY], 'profile'))
      } else {
        const fg = faceGeom(c)
        for (const s of [1, -1]) {
          const x = s * fg.widthAt(m.earY) * 0.97
          out.add('head', Z.earBack, `ear${s > 0 ? 'L' : 'R'}`, earShape(c, m, style, size, s, [x, m.earY], c.view === 'back' ? 'back' : 'front'))
        }
      }
    }
  }

  const shading = formShading(c, m)
  if (shading) out.add('head', Z.facePaint + 0.5, 'face-form', shading)
  if (c.view !== 'back') faceDetails(c, out, m)
}

/** The face outline as a clip path (one per model and view; safe to call every frame). */
export function faceClip(c: Ctx, m: HumanMeasure): string {
  return c.defs.add(`face${c.view}`, (id) => el('clipPath', { id }, el('path', { d: c.view === 'side' ? smooth(profileOutline(m, c)) : smooth(faceGeom(c).outline) })))
}

/**
 * Anatomy and material over the lit head: warm subsurface at the edges, the jaw's
 * underside, flush; and in baked mode cheekbones, eye sockets, temples and sheen.
 */
function formShading(c: Ctx, m: HumanMeasure): string {
  const P = c.paint
  if (P.style.shading === 'flat' || P.detail === 0) return ''
  const rich = c.baked && P.detail > 1
  const t = skinTones(skinOf(c), c.paint)
  const hh = m.headH
  const w = m.hw
  const L = P.style.light
  const h = c.sec('head')
  const parts: string[] = []
  // Deep skin reads its form through sheen and specular more than through shadow.
  const sk = 1 + t.depth * 0.45
  const fk = 1 - t.depth * 0.35
  const warmEdge = (x: number, y: number, bw: number, bh: number, cx: number, cy: number): string =>
    el('path', { d: rect(x, y, bw, bh), fill: radialPaint(c, [[0, t.warm, 0], [0.72, t.warm, 0], [0.9, t.warm, rich ? 0.09 : 0.07], [1, t.warm, rich ? 0.17 : 0.13]], { cx, cy, r: 0.5 }) })

  if (c.view === 'side') {
    const { gonion, chinBot, throat } = profileJaw(m, c)
    parts.push(warmEdge(-w * 1.02, -hh * 0.98, w * 2.02, hh * 1.06 + chinBot, 0.5 + L[0] * 0.06, 0.5 + L[1] * 0.05))
    parts.push(softSpot(c, lerp(throat[0], w * 0.7, 0.5), lerp(throat[1], chinBot, 0.6), w * 0.42, hh * 0.06, t.shadow, rich ? 0.45 : 0.32, -6))
    parts.push(softSpot(c, w * 0.56, m.noseY + hh * 0.04, w * 0.2, hh * 0.07, t.flush, (rich ? 0.22 : 0.15) * fk))
    parts.push(softSpot(c, -w * 0.62, -hh * 0.2, w * 0.36, hh * 0.1, t.shadow, 0.28))
    // Where the head sits on the neck the skin turns under into the neck's shade.
    parts.push(softSpot(c, (gonion[0] - w * 0.56) / 2, -hh * 0.1, w * 0.62, hh * 0.08, t.shadow, 0.55))
    parts.push(softSpot(c, throat[0] - w * 0.05, throat[1] + hh * 0.01, w * 0.2, hh * 0.05, t.shadow, 0.45))
    if (rich) {
      // Jaw ramus up toward the ear, cheekbone hollow and highlight, socket, temple.
      parts.push(softSpot(c, gonion[0], (gonion[1] + m.earY) / 2 + hh * 0.04, w * 0.07, hh * 0.1, t.shadow, 0.2, 8))
      parts.push(softSpot(c, w * 0.5, m.noseY + hh * 0.07, w * 0.2, hh * 0.07, t.shadow, lerp(0.24, 0.06, h.n('cheeks')), -20))
      parts.push(softSpot(c, w * 0.6, m.eyeY + hh * 0.1, w * 0.18, hh * 0.05, t.sheen, 0.42 * sk, -15))
      parts.push(softSpot(c, w * 0.8, m.eyeY - hh * 0.01, w * 0.1, hh * 0.07, t.shadow, 0.3))
      parts.push(softSpot(c, w * 0.42, -hh * 0.58, w * 0.18, hh * 0.1, t.shadow, 0.2))
      parts.push(softSpot(c, w * 0.62, -hh * 0.7, w * 0.22, hh * 0.08, t.sheen, 0.4 * sk, -30))
      parts.push(softSpot(c, w * 0.84, chinBot - hh * 0.06, w * 0.08, hh * 0.03, t.sheen, 0.45 * sk))
      if (t.depth > 0.2) parts.push(softSpot(c, w * 0.64, m.eyeY + hh * 0.09, w * 0.06, hh * 0.018, t.spec, 0.45 * t.depth, -15))
      parts.push(softSpot(c, -w * 0.1, -hh * 0.86, w * 0.4, hh * 0.08, t.spec, 0.28, -10))
    }
    return g({ 'clip-path': url(faceClip(c, m)) }, ...parts)
  }

  const fg = faceGeom(c)
  const top = fg.crownY
  parts.push(warmEdge(-w * 1.05, top, w * 2.1, fg.chinY - top, 0.5 + L[0] * 0.08, 0.52 + L[1] * 0.05))
  if (c.view === 'back') {
    // The nape: the skull turns under toward the neck.
    parts.push(softSpot(c, 0, fg.chinY, w * 0.85, hh * 0.22, t.shadow, rich ? 0.45 : 0.32))
    if (rich) parts.push(softSpot(c, L[0] * w * 0.35, top + hh * 0.14, w * 0.34, hh * 0.08, t.spec, 0.3))
    return g({ 'clip-path': url(faceClip(c, m)) }, ...parts)
  }
  const eyeX = w * lerp(0.3, 0.46, c.sec('eyes').n('spacing'))
  // The jaw's underside and the chin turn away from the light.
  parts.push(softSpot(c, 0, fg.chinY + hh * 0.03, w * lerp(0.72, 0.95, h.n('jaw')), hh * 0.13, t.shadow, rich ? 0.48 : 0.34))
  for (const sg of [1, -1]) parts.push(softSpot(c, sg * eyeX * 1.02, m.eyeY + hh * 0.17, w * 0.21, hh * 0.075, t.flush, (rich ? 0.2 : 0.13) * fk))
  if (rich) {
    const hollow = lerp(0.28, 0.06, h.n('cheeks'))
    for (const sg of [1, -1]) {
      const lit = sg * L[0] > 0 ? 1 : 0.6
      // Under the cheekbone toward the jaw, and the cheekbone's lit plane above it.
      parts.push(softSpot(c, sg * w * 0.68, m.noseY + hh * 0.07, w * 0.13, hh * 0.12, t.shadow, hollow, sg * -18))
      parts.push(softSpot(c, sg * w * 0.56, m.eyeY + hh * 0.105, w * 0.16, hh * 0.034, t.sheen, 0.3 * lit * sk, sg * -16))
      if (t.depth > 0.2 && lit === 1) parts.push(softSpot(c, sg * w * 0.58, m.eyeY + hh * 0.1, w * 0.06, hh * 0.016, t.spec, 0.5 * t.depth, sg * -14))
      // Eye sockets: the inner corner and the band under the brow ridge.
      parts.push(softSpot(c, sg * eyeX * 0.55, m.eyeY - hh * 0.015, w * 0.09, hh * 0.06, t.shadow, 0.34))
      parts.push(softSpot(c, sg * eyeX * 1.05, m.eyeY - hh * 0.075, w * 0.21, hh * 0.045, t.shadow, 0.18))
      parts.push(softSpot(c, sg * w * 0.92, -hh * 0.6, w * 0.14, hh * 0.13, t.shadow, 0.26))
    }
    parts.push(softSpot(c, L[0] * w * 0.3, -hh * 0.67, w * 0.34, hh * 0.1, t.sheen, 0.42 * sk))
    if (t.depth > 0.2) parts.push(softSpot(c, L[0] * w * 0.34, -hh * 0.69, w * 0.12, hh * 0.03, t.spec, 0.45 * t.depth))
    parts.push(softSpot(c, L[0] * w * 0.35, top + hh * 0.13, w * 0.3, hh * 0.07, t.spec, 0.3))
    parts.push(softSpot(c, L[0] * w * 0.12, fg.chinY - hh * 0.055, w * 0.15, hh * 0.035, t.sheen, 0.42 * sk))
    // The philtrum's two ridges catch a little light.
    parts.push(softSpot(c, 0, (m.noseY + m.mouthY) / 2 + hh * 0.01, w * 0.07, hh * 0.035, t.sheen, 0.25))
  }
  return g({ 'clip-path': url(faceClip(c, m)) }, ...parts)
}

function earShape(c: Ctx, m: HumanMeasure, style: string, size: number, s: number, at: P, mode: 'front' | 'back' | 'profile'): string {
  const P = c.paint
  const skin = skinOf(c)
  const t = skinTones(skin, c.paint)
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rich = c.baked && P.detail > 1
  const hh = m.headH
  const eh = hh * 0.2 * size
  const ew = hh * 0.085 * size
  const [x, y] = at
  let outer: SP[]
  if (mode === 'profile') {
    const pts: SP[] = [
      [x + ew * 0.3, y - eh * 0.5],
      [x - ew * 0.5, y - eh * 0.62],
      [x - ew * 1.05, y - eh * 0.2],
      [x - ew * 0.95, y + eh * 0.3],
      [x - ew * 0.3, y + eh * 0.55],
      [x + ew * 0.25, y + eh * 0.35],
    ]
    if (style === 'pointed' || style === 'elf') {
      const L = style === 'elf' ? 2.4 : 1.2
      pts.splice(1, 1, [x - ew * 0.6, y - eh * 0.6], [x - ew * (0.9 + L * 0.6), y - eh * (0.7 + L * 0.35), 0], [x - ew * 1.05, y - eh * 0.25])
    }
    if (style === 'droopy') pts.splice(4, 1, [x - ew * 0.45, y + eh * 0.72])
    if (style === 'small' || style === 'large') {
      const k = style === 'small' ? 0.78 : 1.2
      outer = pts.map(([px, py, kk]) => (kk === undefined ? [x + (px - x) * k, y + (py - y) * k] : [x + (px - x) * k, y + (py - y) * k, kk]) as SP)
    } else outer = pts
    const d = smooth(outer)
    let svg = P.shape(d, skin, { shade: 0.8 })
    if (P.detail === 0) return svg
    const ctr: P = [x - ew * 0.42, y + eh * 0.02]
    const inner = outer.slice(1, -1).map(([px, py]) => [lerp(px, ctr[0], 0.3), lerp(py, ctr[1], 0.3)] as P)
    const bowl = smooth(outer.slice(1, -1).map(([px, py]) => [lerp(px, ctr[0], 0.58), lerp(py, ctr[1], 0.55)] as P).concat([[x - ew * 0.05, y + eh * 0.12]]))
    const clip = c.defs.unique('ear')
    c.defs.put(clip, el('clipPath', { id: clip }, el('path', { d })))
    const inside: string[] = []
    if (shaded) {
      inside.push(softSpot(c, ctr[0], ctr[1], ew * 0.9, eh * 0.6, t.flush, rich ? 0.3 : 0.2))
      inside.push(P.flat(bowl, t.shadow, rich ? 0.3 : 0.24))
      if (rich) inside.push(softSpot(c, ctr[0] + ew * 0.05, ctr[1] + eh * 0.08, ew * 0.32, eh * 0.2, t.deep, 0.3))
    }
    // Helix rim, the tragus in front of the bowl, and the antihelix ridge.
    inside.push(P.flat(brush(inner, 0, 0, P.lw * 0.8 + ew * 0.04), t.line, 0.55))
    inside.push(P.flat(brush([[x + ew * 0.02, y - eh * 0.1], [x - ew * 0.12, y + eh * 0.02], [x - ew * 0.02, y + eh * 0.14]], 0, 0, P.lw * 0.9 + ew * 0.04), t.line, 0.6))
    if (rich) inside.push(P.flat(brush([[ctr[0] - ew * 0.2, ctr[1] - eh * 0.28], [ctr[0] - ew * 0.34, ctr[1]], [ctr[0] - ew * 0.12, ctr[1] + eh * 0.25]], 0, 0, ew * 0.08), t.sheen, 0.5))
    svg += g({ 'clip-path': url(clip) }, ...inside)
    return svg
  }
  const top = y - eh * 0.52
  const bot = y + eh * 0.48
  outer = [
    [x - s * ew * 0.2, top],
    [x + s * ew * 0.75, top - eh * 0.05],
    [x + s * ew * 1.08, y - eh * 0.15],
    [x + s * ew * 0.85, y + eh * 0.25],
    [x + s * ew * (style === 'droopy' ? 0.7 : 0.45), bot + (style === 'droopy' ? eh * 0.25 : 0)],
    [x - s * ew * 0.2, bot - eh * 0.1],
  ]
  if (style === 'small') outer = outer.map(([px, py]) => [x + (px - x) * 0.75, y + (py - y) * 0.8] as SP)
  if (style === 'large') outer = outer.map(([px, py]) => [x + (px - x) * 1.25, y + (py - y) * 1.15] as SP)
  if (style === 'pointed' || style === 'elf') {
    const L = style === 'elf' ? 2.6 : 1.1
    outer.splice(1, 2, [x + s * ew * 0.7, top + eh * 0.05], [x + s * ew * (1.1 + L * 0.8), top - eh * (0.15 + L * 0.3), 0], [x + s * ew * 1.0, y - eh * 0.05])
  }
  const d = smooth(outer)
  let svg = P.shape(d, skin, { shade: 0.7 })
  if (P.detail === 0) return svg
  const ctr: P = [x + s * ew * 0.3, y + eh * 0.02]
  const clip = c.defs.unique('ear')
  c.defs.put(clip, el('clipPath', { id: clip }, el('path', { d })))
  const inside: string[] = []
  if (mode === 'back') {
    // From behind: no bowl, just the fold where the ear meets the head.
    if (shaded) {
      inside.push(softSpot(c, x - s * ew * 0.05, y, ew * 0.45, eh * 0.5, t.shadow, 0.45))
      inside.push(softSpot(c, ctr[0], ctr[1], ew * 0.8, eh * 0.55, t.flush, 0.18))
    }
    return svg + g({ 'clip-path': url(clip) }, ...inside)
  }
  const rim = outer.slice(1, -1).map(([px, py]) => [lerp(px, ctr[0], 0.3), lerp(py, ctr[1], 0.3)] as P)
  const bowl = smooth(outer.slice(1, -1).map(([px, py]) => [lerp(px, ctr[0], 0.62), lerp(py, ctr[1], 0.55)] as P).concat([[x, y + eh * 0.05]]))
  if (shaded) {
    inside.push(softSpot(c, ctr[0], ctr[1], ew * 0.85, eh * 0.6, t.flush, rich ? 0.3 : 0.2))
    inside.push(P.flat(bowl, t.shadow, rich ? 0.3 : 0.24))
  }
  inside.push(P.flat(brush(rim, 0, 0, P.lw * 0.8 + ew * 0.045), t.line, 0.58))
  if (rich) inside.push(P.flat(brush([[ctr[0] + s * ew * 0.05, ctr[1] - eh * 0.25], [ctr[0] + s * ew * 0.2, ctr[1] - eh * 0.02], [ctr[0] + s * ew * 0.08, ctr[1] + eh * 0.2]], 0, 0, ew * 0.08), t.sheen, 0.45))
  return svg + g({ 'clip-path': url(clip) }, ...inside)
}

/* ---- Skin details ----------------------------------------------------------- */

/** Irregular blob points around a centre (vitiligo patches). */
function patchPts(cx: number, cy: number, r: number, rng: ReturnType<Ctx['rng']>, n = 9): P[] {
  const pts: P[] = []
  const phase = rng.range(0, Math.PI * 2)
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2
    const rr = r * rng.range(0.62, 1.25)
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.82])
  }
  return pts
}

function faceDetails(c: Ctx, out: PartList, m: HumanMeasure): void {
  const P = c.paint
  const skin = skinOf(c)
  const t = skinTones(skin, c.paint)
  const s = c.sec('skin')
  const hh = m.headH
  const w = m.hw
  const side = c.view === 'side'
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const eyeX = side ? w * 0.55 : w * lerp(0.3, 0.46, c.sec('eyes').n('spacing'))
  const parts: string[] = []
  const clipped: string[] = []
  const sc = toLch(skin)

  // Vitiligo: depigmented patches with irregular, feathered edges, often around the eyes
  // and mouth. Deterministic per seed.
  const vit = s.n('vitiligo')
  if (vit > 0.02) {
    const rng = c.rng('vitiligo')
    const light = mix(skin, sc.l < 0.5 ? '#f3dccf' : '#fbeee6', 0.8)
    const n = Math.round(1 + vit * 5)
    const anchors: P[] = side
      ? [[w * 0.62, m.eyeY + hh * 0.02], [w * 0.7, m.mouthY], [w * 0.3, -hh * 0.62], [w * 0.1, -hh * 0.2], [w * 0.75, -hh * 0.02], [-w * 0.3, -hh * 0.4]]
      : [[eyeX, m.eyeY + hh * 0.02], [-w * 0.3, m.mouthY + hh * 0.02], [-w * 0.45, -hh * 0.62], [w * 0.6, m.noseY + hh * 0.06], [0, faceGeom(c).chinY - hh * 0.04], [-eyeX * 1.1, m.eyeY - hh * 0.1]]
    const blobs: string[] = []
    const halos: string[] = []
    for (let i = 0; i < n; i++) {
      const [ax, ay] = anchors[(i + rng.int(0, anchors.length - 1)) % anchors.length]
      const cx = ax + rng.range(-w * 0.12, w * 0.12)
      const cy = ay + rng.range(-hh * 0.05, hh * 0.05)
      const r = hh * rng.range(0.045, 0.1) * (0.6 + vit * 0.55)
      const pts = patchPts(cx, cy, r, rng, 11)
      blobs.push(smooth(pts))
      // Satellite speckles around bigger patches.
      if (rich && r > hh * 0.05) for (let k = 0; k < 3; k++) blobs.push(ellipse(cx + rng.range(-r, r) * 1.4, cy + rng.range(-r, r) * 1.3, r * rng.range(0.08, 0.16), r * rng.range(0.07, 0.13)))
      if (rich) halos.push(smooth(pts.map(([px, py]) => [cx + (px - cx) * 1.05, cy + (py - cy) * 1.05] as P)))
    }
    if (halos.length) clipped.push(P.flat(halos.join(''), light, 0.3))
    clipped.push(P.flat(blobs.join(''), light, 0.92))
    if (rich) clipped.push(P.flat(blobs.join(''), t.flush, 0.07))
  }

  // Freckles across the nose and cheeks: varied size, shape and strength, densest on
  // the bridge of the nose.
  const fr = s.n('freckles')
  if (fr > 0.02 && P.detail > 0) {
    const rng = c.rng('freckles')
    const col = fromLch({ l: sc.l * 0.72, c: Math.min(0.15, sc.c * 1.2 + 0.03), h: sc.c > 0.02 && (sc.h < 100 || sc.h > 340) ? hueTo(sc.h, 50, 0.3) : hueTo(sc.h, 40, 0.4) })
    const count = Math.round(6 + fr * 38) * (rich ? 1.5 : 1)
    const buckets = ['', '', '']
    for (let i = 0; i < count; i++) {
      const sideSign = side ? 1 : rng.chance(0.5) ? 1 : -1
      const onBridge = !side && rng.chance(0.28)
      const cx = onBridge ? rng.normal(0, w * 0.1) : side ? rng.normal(w * 0.58, w * 0.17) : sideSign * rng.normal(eyeX * 0.8, w * 0.19)
      const cy = onBridge ? rng.normal(m.noseY - hh * 0.07, hh * 0.03) : rng.normal(m.noseY - hh * 0.045, hh * 0.04)
      const big = rng.next()
      const r = hh * (0.004 + big * big * 0.0072)
      const b = big < 0.35 ? 0 : big < 0.75 ? 1 : 2
      buckets[rng.chance(0.3) ? Math.max(0, b - 1) : b] += ellipse(cx, cy, r * rng.range(0.9, 1.15), r * rng.range(0.7, 0.95))
    }
    const k = 0.5 + fr * 0.35
    clipped.push(P.flat(buckets[0], col, 0.3 * k), P.flat(buckets[1], col, 0.5 * k), P.flat(buckets[2], shaded ? warmShade(col, 0.06) : col, 0.7 * k))
  }

  // Beauty marks: a dark core, a softer rim and (baked) a pin of light.
  const mo = Math.round(s.n('moles') * 3.4)
  if (mo > 0) {
    const rng = c.rng('moles')
    const spots: string[] = []
    const rims: string[] = []
    const glints: string[] = []
    const places: P[] = side
      ? [[w * 0.62, m.mouthY - hh * 0.02], [w * 0.4, m.noseY], [w * 0.2, -hh * 0.55]]
      : [[w * 0.3, m.mouthY - hh * 0.03], [-eyeX * 0.9, m.noseY + hh * 0.03], [eyeX * 1.1, m.eyeY + hh * 0.12], [-w * 0.4, -hh * 0.6]]
    for (let i = 0; i < Math.min(mo, places.length); i++) {
      const [x, y] = places[(i + rng.int(0, places.length - 1)) % places.length]
      const px = x + rng.range(-3, 3)
      const r = hh * rng.range(0.009, 0.013)
      spots.push(ellipse(px, y, r, r * 0.9))
      rims.push(circle(px, y, r * 1.45))
      glints.push(circle(px - r * 0.3, y - r * 0.35, r * 0.28))
    }
    if (shaded) parts.push(P.flat(rims.join(''), t.deep, 0.35))
    parts.push(P.flat(spots.join(''), warmShade(skin, 0.62), 0.9))
    if (rich) parts.push(P.flat(glints.join(''), t.spec, 0.55))
  }

  // Age lines: tapered creases (crow's feet, smile lines, forehead), with the lit ridge
  // beside each crease in baked mode.
  const age = s.n('age')
  if (age > 0.45 && P.detail > 0) {
    const a = clamp((age - 0.45) / 0.55, 0, 1)
    const lw = P.lw * (0.4 + a * 0.3) + hh * 0.003
    const creases: P[][] = []
    const ridges: P[][] = []
    if (!side) {
      for (const sg of [1, -1]) {
        const ex = sg * eyeX
        const ox = ex + sg * w * 0.19
        creases.push([[ox, m.eyeY - hh * 0.035], [ox + sg * w * 0.05, m.eyeY - hh * 0.05], [ox + sg * w * 0.1, m.eyeY - hh * 0.06]])
        creases.push([[ox + sg * w * 0.01, m.eyeY + hh * 0.012], [ox + sg * w * 0.1, m.eyeY + hh * 0.02]])
        if (a > 0.4) creases.push([[ox, m.eyeY + hh * 0.05], [ox + sg * w * 0.08, m.eyeY + hh * 0.085]])
        const smile: P[] = [[sg * w * 0.19, m.noseY - hh * 0.02], [sg * w * 0.32, m.mouthY - hh * 0.03], [sg * w * 0.3, m.mouthY + hh * 0.045]]
        creases.push(smile)
        ridges.push(smile.map(([x, y]) => [x + sg * w * 0.035, y] as P))
        // Under-eye fold.
        creases.push([[ex - sg * w * 0.08, m.eyeY + hh * 0.075], [ex + sg * w * 0.02, m.eyeY + hh * 0.09], [ex + sg * w * 0.12, m.eyeY + hh * 0.075]])
      }
      if (a > 0.3) {
        creases.push([[-w * 0.35, -hh * 0.68], [0, -hh * 0.7], [w * 0.35, -hh * 0.68]])
        creases.push([[-w * 0.25, -hh * 0.63], [0, -hh * 0.645], [w * 0.25, -hh * 0.63]])
        ridges.push([[-w * 0.3, -hh * 0.655], [0, -hh * 0.672], [w * 0.3, -hh * 0.655]])
      }
    } else {
      creases.push([[w * 0.78, m.eyeY], [w * 0.72, m.eyeY - hh * 0.02], [w * 0.66, m.eyeY - hh * 0.025]])
      creases.push([[w * 0.62, m.noseY], [w * 0.72, m.mouthY], [w * 0.7, m.mouthY + hh * 0.04]])
      ridges.push([[w * 0.58, m.noseY + hh * 0.01], [w * 0.68, m.mouthY], [w * 0.66, m.mouthY + hh * 0.04]])
    }
    clipped.push(P.flat(creases.map((pts) => brush(pts, 0, 0, lw)).join(''), mix(t.line, t.shadow, 0.35), 0.22 + a * 0.28))
    if (rich) clipped.push(P.flat(ridges.map((pts) => brush(pts, 0, 0, lw * 1.6)).join(''), t.sheen, 0.1 + a * 0.1))
    if (rich && !side) for (const sg of [1, -1]) clipped.push(softSpot(c, sg * w * 0.62, m.mouthY + hh * 0.07, w * 0.14, hh * 0.08, t.shadow, 0.2 * a))
  }

  if (clipped.length) {
    parts.unshift(g({ 'clip-path': url(faceClip(c, m)) }, ...clipped))
  }
  if (parts.length) out.add('head', Z.skinDetail, 'skin-details', parts.join(''))

  scar(c, out, m, eyeX)
  facePaint(c, out, m, eyeX)
}

function scar(c: Ctx, out: PartList, m: HumanMeasure, eyeX: number): void {
  const kind = c.sec('skin').s('scar')
  if (!kind || kind === 'none') return
  const P = c.paint
  const skin = skinOf(c)
  const t = skinTones(skin, c.paint)
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const hh = m.headH
  const col = mix(skin, toLch(skin).l < 0.5 ? '#e7b4a8' : '#f2c7c0', 0.5)
  const x = c.view === 'side' ? m.hw * 0.55 : eyeX
  let pts: P[] = []
  let w0 = hh * 0.016
  let w1 = hh * 0.01
  let z: number = Z.skinDetail + 0.5
  switch (kind) {
    case 'brow':
      pts = [[x - hh * 0.03, m.eyeY - hh * 0.2], [x + hh * 0.02, m.eyeY - hh * 0.09]]
      z = Z.brows + 0.5
      break
    case 'cheek':
      pts = [[x - hh * 0.1, m.noseY - hh * 0.02], [x - hh * 0.02, m.noseY + hh * 0.02], [x + hh * 0.06, m.noseY + hh * 0.05]]
      w0 = hh * 0.02
      w1 = hh * 0.012
      break
    case 'eye':
      pts = [[x + hh * 0.02, m.eyeY - hh * 0.17], [x + hh * 0.005, m.eyeY - hh * 0.02], [x - hh * 0.01, m.eyeY + hh * 0.13]]
      w0 = hh * 0.014
      z = Z.brows + 0.5
      break
    case 'nose':
      pts = [[-hh * 0.07, m.noseY - hh * 0.07], [hh * 0.07, m.noseY - hh * 0.1]]
      w0 = hh * 0.014
      w1 = hh * 0.014
      z = Z.nose + 0.5
      break
    case 'chin':
      pts = [[-hh * 0.03, m.mouthY + hh * 0.07], [hh * 0.05, m.mouthY + hh * 0.13]]
      break
    case 'lip':
      pts = [[hh * 0.03, m.mouthY - hh * 0.05], [hh * 0.05, m.mouthY + hh * 0.03]]
      w0 = hh * 0.013
      z = Z.mouth + 0.5
      break
  }
  if (!pts.length) return
  // A raised seam: shadow on the far side, the pale scar, a lit edge toward the light;
  // longer scars show their old stitches in baked mode.
  const d = brush(pts, w0 * 0.55, w1 * 0.4, (w0 + w1) * 0.35)
  const L = P.style.light
  const off = hh * 0.005
  let svg = ''
  if (shaded) svg += g({ transform: `translate(${f(-L[0] * off)} ${f(-L[1] * off)})` }, P.flat(d, t.shadow, 0.55))
  svg += P.flat(d, col, 0.95)
  if (shaded) svg += P.flat(brush(pts, w0 * 0.2, w1 * 0.15, (w0 + w1) * 0.12), mix(col, '#ffffff', 0.35), 0.55)
  if (rich && (kind === 'cheek' || kind === 'eye' || kind === 'brow')) {
    let st = ''
    for (const k of [0.25, 0.5, 0.75]) {
      const i = Math.min(pts.length - 2, Math.floor(k * (pts.length - 1)))
      const u = k * (pts.length - 1) - i
      const px = lerp(pts[i][0], pts[i + 1][0], u)
      const py = lerp(pts[i][1], pts[i + 1][1], u)
      const dx = pts[i + 1][0] - pts[i][0]
      const dy = pts[i + 1][1] - pts[i][1]
      const dl = Math.hypot(dx, dy) || 1
      const nx = (-dy / dl) * w0 * 0.9
      const ny = (dx / dl) * w0 * 0.9
      st += `M${f(px - nx)} ${f(py - ny)}L${f(px + nx)} ${f(py + ny)}`
    }
    svg += P.line(st, t.line, hh * 0.004, { opacity: 0.45 })
  } else if (P.detail > 0 && !shaded) svg += P.line(d, t.shadow, P.lw * 0.35, { opacity: 0.5 })
  out.add('head', z, 'scar', svg)
}

function facePaint(c: Ctx, out: PartList, m: HumanMeasure, eyeX: number): void {
  const s = c.sec('skin')
  const kind = s.s('facePaint')
  if (!kind || kind === 'none') return
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const hh = m.headH
  const w = m.hw
  const col = s.c('facePaintColor', '#e84393')
  const side = c.view === 'side'
  const sides = side ? [1] : [1, -1]
  const cx = (sg: number) => (side ? w * 0.55 : sg * eyeX)
  const ink = '#2b2330'
  // Painted, not printed: a matte fill with a slightly denser edge in baked mode.
  const layer = (d: string, color: string, op = 1): string => (d ? P.flat(d, color, op) + (rich ? P.line(d, mix(color, '#1a1020', 0.25), hh * 0.005, { opacity: 0.45 * op }) : '') : '')
  let svg = ''
  switch (kind) {
    case 'whiskers':
      for (const sg of sides) {
        const d = [0, 1, 2].map((i) => brush([[cx(sg) + sg * w * 0.02, m.noseY + hh * i * 0.03], [cx(sg) + sg * w * 0.32, m.noseY + hh * (-0.03 + i * 0.06)]], hh * 0.012, 0)).join('')
        svg += P.flat(d, ink, 0.85)
      }
      if (!side) svg += P.flat(ellipse(0, m.noseY - hh * 0.01, hh * 0.022, hh * 0.016), ink, 0.85)
      break
    case 'stripes':
      for (const sg of sides) svg += layer(poly([[cx(sg) - w * 0.16, m.eyeY + hh * 0.08], [cx(sg) + w * 0.16, m.eyeY + hh * 0.06], [cx(sg) + w * 0.14, m.eyeY + hh * 0.11], [cx(sg) - w * 0.18, m.eyeY + hh * 0.13]]) + poly([[cx(sg) - w * 0.12, m.eyeY + hh * 0.16], [cx(sg) + w * 0.12, m.eyeY + hh * 0.14], [cx(sg) + w * 0.1, m.eyeY + hh * 0.19], [cx(sg) - w * 0.14, m.eyeY + hh * 0.21]]), col, 0.9)
      break
    case 'tribal':
      for (const sg of sides) svg += layer(brush([[cx(sg) - sg * w * 0.05, m.eyeY + hh * 0.09], [cx(sg) + sg * w * 0.1, m.noseY], [cx(sg) + sg * w * 0.02, m.mouthY]], hh * 0.02, hh * 0.004, hh * 0.015), col, 0.9)
      break
    case 'stars':
      svg = layer(star(cx(1) + w * 0.12, m.eyeY + hh * 0.12, hh * 0.045, hh * 0.02) + star(cx(1) + w * 0.22, m.eyeY + hh * 0.05, hh * 0.025, hh * 0.011), col)
      if (rich) svg += P.flat(sparkle(cx(1) + w * 0.02, m.eyeY + hh * 0.2, hh * 0.015), '#ffffff', 0.9)
      break
    case 'hearts':
      svg = layer(heart(cx(1) + w * 0.1, m.eyeY + hh * 0.13, hh * 0.035) + heart(cx(1) + w * 0.2, m.eyeY + hh * 0.06, hh * 0.022), col)
      break
    case 'tears':
      for (const sg of sides) svg += layer(`M${f(cx(sg))} ${f(m.eyeY + hh * 0.07)}q${f(hh * 0.03)} ${f(hh * 0.06)} 0 ${f(hh * 0.08)}q${f(-hh * 0.03)} ${f(-hh * 0.02)} 0 ${f(-hh * 0.08)}Z`, col, 0.9)
      break
    case 'clown':
      for (const sg of sides) svg += layer(poly([[cx(sg), m.eyeY - hh * 0.14], [cx(sg) + hh * 0.04, m.eyeY], [cx(sg), m.eyeY + hh * 0.14], [cx(sg) - hh * 0.04, m.eyeY]]), col, 0.75)
      if (!side) svg += P.shape(circle(0, m.noseY + hh * 0.01, hh * 0.035), '#e53935', { gloss: true, outline: 0.4 })
      break
    case 'butterfly':
      for (const sg of sides) svg += layer(ellipse(cx(sg) + sg * w * 0.14, m.eyeY - hh * 0.02, w * 0.16, hh * 0.1) + ellipse(cx(sg) + sg * w * 0.1, m.eyeY + hh * 0.1, w * 0.1, hh * 0.06), col, 0.55)
      if (rich) for (const sg of sides) svg += P.flat(circle(cx(sg) + sg * w * 0.2, m.eyeY - hh * 0.04, hh * 0.012) + circle(cx(sg) + sg * w * 0.13, m.eyeY + hh * 0.11, hh * 0.008), '#ffffff', 0.75)
      break
    case 'lightning':
      svg = layer(poly([[cx(1) + w * 0.05, m.eyeY + hh * 0.06], [cx(1) + w * 0.18, m.eyeY + hh * 0.06], [cx(1) + w * 0.1, m.eyeY + hh * 0.13], [cx(1) + w * 0.2, m.eyeY + hh * 0.13], [cx(1) + w * 0.02, m.eyeY + hh * 0.26], [cx(1) + w * 0.08, m.eyeY + hh * 0.16], [cx(1) - w * 0.01, m.eyeY + hh * 0.16]]), col)
      break
    case 'dots':
      for (const sg of sides) svg += layer([0, 1, 2, 3].map((i) => circle(cx(sg) + sg * w * (0.02 + i * 0.07), m.eyeY + hh * (0.1 + i * 0.005), hh * (0.012 - i * 0.0015))).join(''), col)
      break
    case 'glitter':
      for (const sg of sides) svg += P.flat([0, 1, 2].map((i) => sparkle(cx(sg) + sg * w * (0.05 + i * 0.09), m.eyeY + hh * (0.09 + (i % 2) * 0.03), hh * (0.02 + (i % 2) * 0.012))).join(''), col, 0.9)
      if (rich) for (const sg of sides) svg += P.flat([0, 1, 2, 3, 4].map((i) => circle(cx(sg) + sg * w * (0.02 + i * 0.06), m.eyeY + hh * (0.14 + ((i * 7) % 3) * 0.02), hh * 0.005)).join(''), '#ffffff', 0.85)
      break
    case 'skull':
      for (const sg of sides) svg += layer(ellipse(cx(sg), m.eyeY, w * 0.2, hh * 0.1), ink, 0.75)
      svg += layer(side ? poly([[w * 0.86, m.noseY - hh * 0.05], [w * 0.92, m.noseY + hh * 0.02], [w * 0.8, m.noseY + hh * 0.02]]) : poly([[0, m.noseY - hh * 0.05], [hh * 0.03, m.noseY + hh * 0.02], [-hh * 0.03, m.noseY + hh * 0.02]]), ink, 0.8)
      svg += P.line([-2, -1, 0, 1, 2].map((i) => `M${f((side ? w * 0.72 : 0) + i * w * (side ? 0.035 : 0.07))} ${f(m.mouthY - hh * 0.02)}v${f(hh * 0.05)}`).join(''), ink, P.lw * 0.6, { opacity: 0.8 })
      break
    case 'bindi':
      if (!side) svg = P.shape(circle(0, m.eyeY - hh * 0.14, hh * 0.018), '#c62828', { gloss: true, outline: 0.4 })
      break
    case 'blackout':
      for (const sg of sides) svg += layer(poly([[cx(sg) - w * 0.13, m.eyeY + hh * 0.08], [cx(sg) + w * 0.13, m.eyeY + hh * 0.08], [cx(sg) + w * 0.11, m.eyeY + hh * 0.13], [cx(sg) - w * 0.11, m.eyeY + hh * 0.13]]), '#1c1a20', 0.9)
      break
  }
  if (svg) out.add('head', Z.facePaint, 'face-paint', svg)
}

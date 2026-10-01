/* Creature heads, in profile (facing +x), turned toward the camera (frontal) and turned
 * away (the back view).
 *
 * Profile creatures show a frontal head in the "front" view: the body stays side-on and
 * the head turns to look at you — the classic cartoon-animal portrait, and what makes a
 * fox or a dragon work as a profile picture. In the "back" view the head turns away from
 * the camera. Head space: origin at the skull centre.
 *
 * A head is one silhouette (cranium, cheeks and muzzle painted as one mass, so no seam
 * crosses the face) with a lighter muzzle, nose leather or nostrils, whiskers, ears with
 * inner colour and fur, and horns with growth ridges. */

import { isDark, toLch } from '../../core/color.ts'
import { clamp, lerp, norm, type Box, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, roundRect, smooth, tube, type SP } from '../../core/path.ts'
import { createRng, hash32 } from '../../core/rng.ts'
import { el } from '../../core/svg.ts'
import type { Ctx, PartList } from '../../render/context.ts'
import type { FrameState } from '../../render/types.ts'
import type { CreatureRig } from '../../rig/creature.ts'
import { drawEye, drawSteam, drawSweat, drawTears, drawVein, drawZzz, EYE_STYLES, radialPaint, softSpot, type ExprFxSpec } from '../shared/eye.ts'
import { artBounds, boxedParts, coatOf, coatShape, furEdge, highlightOf, leaf, mix, shadowOf, softFill, tufts, type Coat } from './coat.ts'

export const CZ = {
  wingFar: -300,
  tail: -200,
  legFar: -150,
  body: 0,
  bodyDetail: 5,
  legNear: 20,
  neck: 30,
  mane: 40,
  earFar: 45,
  head: 50,
  face: 55,
  eyes: 60,
  mouth: 62,
  earNear: 64,
  horns: 66,
  wingNear: 80,
  acc: 90,
} as const

export interface HeadGeo {
  R: number
  sn: number
  shape: string
  /** Where the eyes and mouth sit, head space. */
  eyeX: number
  eyeY: number
  mouthX: number
  mouthY: number
  frontal: boolean
  beak: boolean
  /** Turned away from the camera (back view of a profile creature). */
  away?: boolean
  /** Where ears and horns attach when not on the head bone (the TV robot's cabinet). */
  mount?: { bone: string; dy: number }
}

/** The retro-TV robot shows its face on its screen: centre and scale in head space. */
export function tvFace(c: Ctx): { cx: number; cy: number; R: number } | null {
  const m = (c.cr as CreatureRig).m
  if (m.plan !== 'robot' || c.sec('form').s('build') !== 'tv') return null
  const R = m.headR
  return { cx: -R * 0.25, cy: -R * 0.02, R: R * 0.82 }
}

/** Where a head feature goes: the head bone, or a mount (with bounds, since culling can't
 *  see through the transform). */
function mounted(hg: HeadGeo, svg: string): [string, string, Box | undefined] {
  if (!hg.mount) return ['head', svg, undefined]
  const dy = hg.mount.dy
  if (!dy) return [hg.mount.bone, svg, undefined]
  return [hg.mount.bone, `<g transform="translate(0 ${f(dy)})">${svg}</g>`, artBounds(svg, 1, 1, 0, dy)]
}

export function headGeo(c: Ctx): HeadGeo {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const f0 = c.sec('face')
  const mouth = f0.s('mouth') || 'smile'
  const beak = mouth === 'beak' || mouth === 'hooked' || mouth === 'duck'
  const frontal = (c.view === 'front' || c.view === 'back') && !m.frontFacing
  const R = m.headR
  const sn01 = clamp(m.snout / (R * 1.25), 0, 1)
  return {
    R,
    sn: m.snout,
    shape: f0.s('headShape') || 'round',
    eyeX: frontal ? R * 0.4 : R * 0.3 + m.snout * 0.12,
    eyeY: -R * 0.18,
    mouthX: frontal ? 0 : R * 0.55 + m.snout * 0.8,
    mouthY: frontal ? R * lerp(0.42, 0.58, sn01) : R * 0.28,
    frontal,
    beak,
    away: c.view === 'back' && !m.frontFacing,
  }
}

function craniumProfile(R: number, shape: string): SP[] {
  switch (shape) {
    case 'long':
      return [[-R * 1.05, 0], [-R * 0.7, -R * 0.72], [R * 0.2, -R * 0.88], [R * 0.9, -R * 0.45], [R, R * 0.2], [R * 0.2, R * 0.7], [-R * 0.7, R * 0.6]]
    case 'flat':
      return [[-R * 1.05, R * 0.1], [-R * 0.8, -R * 0.55], [R * 0.2, -R * 0.7], [R * 1.0, -R * 0.3], [R * 1.05, R * 0.3], [R * 0.2, R * 0.62], [-R * 0.8, R * 0.55]]
    case 'wedge':
      return [[-R, R * 0.05], [-R * 0.65, -R * 0.8], [R * 0.25, -R * 0.82], [R * 0.95, -R * 0.2, 0.6], [R * 0.75, R * 0.45], [-R * 0.2, R * 0.75], [-R * 0.85, R * 0.55]]
    case 'boxy':
      return [[-R, -R * 0.2, 0.5], [-R * 0.85, -R * 0.85, 0.5], [R * 0.85, -R * 0.85, 0.5], [R, R * 0.1, 0.5], [R * 0.8, R * 0.75, 0.5], [-R * 0.85, R * 0.75, 0.5]]
    default:
      return [[-R, 0], [-R * 0.7, -R * 0.72], [0, -R], [R * 0.72, -R * 0.7], [R, 0], [R * 0.7, R * 0.72], [0, R], [-R * 0.7, R * 0.7]]
  }
}

function craniumFrontal(R: number, shape: string): SP[] {
  switch (shape) {
    case 'long':
      return [[-R * 0.85, -R * 0.2], [-R * 0.55, -R * 0.9], [0, -R * 1.06], [R * 0.55, -R * 0.9], [R * 0.85, -R * 0.2], [R * 0.6, R * 0.9], [0, R * 1.08], [-R * 0.6, R * 0.9]]
    case 'flat':
      return [[-R * 1.15, R * 0.02], [-R * 0.85, -R * 0.62], [0, -R * 0.8], [R * 0.85, -R * 0.62], [R * 1.15, R * 0.02], [R * 0.75, R * 0.7], [0, R * 0.8], [-R * 0.75, R * 0.7]]
    case 'wedge':
      return [[-R * 1.05, -R * 0.35], [-R * 0.55, -R * 0.95], [R * 0.55, -R * 0.95], [R * 1.05, -R * 0.35], [R * 0.4, R * 0.75], [0, R * 0.95, 0.5], [-R * 0.4, R * 0.75]]
    case 'boxy':
      return [[-R, -R * 0.85, 0.5], [R, -R * 0.85, 0.5], [R, R * 0.8, 0.5], [-R, R * 0.8, 0.5]]
    default:
      return [[-R, 0], [-R * 0.7, -R * 0.72], [0, -R * 0.98], [R * 0.72, -R * 0.7], [R, 0], [R * 0.72, R * 0.72], [0, R * 0.98], [-R * 0.72, R * 0.72]]
  }
}

/** What sits at the end of the snout. */
function noseKind(c: Ctx, coat: Coat, mouth: string): 'leather' | 'nostrils' | 'none' {
  const m = (c.cr as CreatureRig).m
  if (m.plan === 'insectoid' || m.plan === 'robot' || m.plan === 'blob' || m.plan === 'cephalopod') return 'none'
  if (mouth === 'mandibles' || mouth === 'grill') return 'none'
  if (coat.material === 'fur') return 'leather'
  return 'nostrils'
}

function noseColor(coat: Coat, mouth: string, snout: number): string {
  if (isDark(coat.primary)) return '#231a1f'
  return mouth === 'cat' || snout < 0.22 ? '#e48c9b' : '#35272c'
}

const inkC = (c: Ctx, color: string): string => c.paint.ink(color)

/* ---- Ears ---------------------------------------------------------------------- */

function ears(c: Ctx, coat: Coat, hg: HeadGeo, out: PartList): void {
  const e = c.sec('ears')
  const style = e.s('style') || 'pointed'
  if (style === 'none') return
  const P = c.paint
  const cr = c.cr as CreatureRig
  const R = hg.R
  const k = lerp(0.6, 1.5, e.n('size'))
  const inner = e.c('inner', mix(coat.primary, '#f48fb1', isDark(coat.primary) ? 0.3 : 0.5))
  const furC = coat.material === 'fur'
  const facing = hg.frontal || cr.m.frontFacing
  const away = !!hg.away
  const featherTuft = style === 'tufted' && coat.material === 'feathers'
  const one = (x: number, y: number, s: number): { outer: SP[]; in: SP[]; tip?: P } => {
    // Feather tufts (owls): two pointed plumes, no inner ear.
    if (featherTuft)
      return {
        outer: [[x - s * R * 0.2, y + R * 0.14], [x - s * R * 0.16, y - R * 0.25 * k], [x + s * R * 0.06 * k, y - R * 0.72 * k, 0], [x + s * R * 0.08 * k, y - R * 0.34 * k], [x + s * R * 0.3 * k, y - R * 0.6 * k, 0], [x + s * R * 0.26 * k, y - R * 0.12], [x + s * R * 0.22, y + R * 0.14]],
        in: [],
      }
    switch (style) {
      case 'round':
        return {
          outer: [[x - s * R * 0.3 * k, y + R * 0.12], [x - s * R * 0.34 * k, y - R * 0.2 * k], [x - s * R * 0.08 * k, y - R * 0.44 * k], [x + s * R * 0.24 * k, y - R * 0.38 * k], [x + s * R * 0.34 * k, y - R * 0.05 * k], [x + s * R * 0.26 * k, y + R * 0.14]],
          in: [[x - s * R * 0.16 * k, y + R * 0.04], [x - s * R * 0.18 * k, y - R * 0.16 * k], [x + s * R * 0.02 * k, y - R * 0.3 * k], [x + s * R * 0.18 * k, y - R * 0.12 * k], [x + s * R * 0.14 * k, y + R * 0.06]],
        }
      case 'floppy': {
        // A leaf hanging from the top of the head, widest near the tip.
        const L = R * 0.95 * k
        const o: SP[] = [[x - s * R * 0.2, y + R * 0.05], [x - s * R * 0.06, y - R * 0.12], [x + s * R * 0.2, y - R * 0.06], [x + s * R * 0.34 * k, y + L * 0.38], [x + s * R * 0.32 * k, y + L * 0.82], [x + s * R * 0.14 * k, y + L, 0.6], [x - s * R * 0.05 * k, y + L * 0.86], [x - s * R * 0.08 * k, y + L * 0.45]]
        const i: SP[] = [[x + s * R * 0.02, y + L * 0.2], [x + s * R * 0.2 * k, y + L * 0.42], [x + s * R * 0.18 * k, y + L * 0.78], [x + s * R * 0.08 * k, y + L * 0.86], [x - s * R * 0.0, y + L * 0.5]]
        return { outer: o, in: i }
      }
      case 'long':
        return {
          outer: [[x - s * R * 0.2 * k, y + R * 0.12], [x - s * R * 0.24 * k, y - R * 0.6 * k], [x - s * R * 0.02 * k, y - R * 1.42 * k, 0.6], [x + s * R * 0.22 * k, y - R * 1.3 * k], [x + s * R * 0.26 * k, y - R * 0.55 * k], [x + s * R * 0.18 * k, y + R * 0.12]],
          in: [[x - s * R * 0.08 * k, y], [x - s * R * 0.1 * k, y - R * 0.62 * k], [x + s * R * 0.02 * k, y - R * 1.2 * k, 0.6], [x + s * R * 0.12 * k, y - R * 1.12 * k], [x + s * R * 0.12 * k, y - R * 0.5 * k], [x + s * R * 0.07 * k, y]],
        }
      case 'bat':
        return {
          outer: [[x - s * R * 0.32 * k, y + R * 0.16], [x - s * R * 0.22 * k, y - R * 0.45 * k], [x + s * R * 0.05 * k, y - R * 0.98 * k, 0], [x + s * R * 0.42 * k, y - R * 0.35 * k], [x + s * R * 0.5 * k, y + R * 0.06]],
          in: [[x - s * R * 0.16 * k, y + R * 0.06], [x - s * R * 0.1 * k, y - R * 0.4 * k], [x + s * R * 0.05 * k, y - R * 0.72 * k, 0], [x + s * R * 0.3 * k, y - R * 0.28 * k], [x + s * R * 0.32 * k, y]],
          tip: [x + s * R * 0.05 * k, y - R * 0.98 * k],
        }
      case 'fin':
        return {
          outer: [[x - s * R * 0.35, y + R * 0.2], [x - s * R * 0.3 * k, y - R * 0.3 * k], [x - s * R * 0.2 * k, y - R * 0.74 * k, 0], [x - s * R * 0.06, y - R * 0.3 * k, 0.4], [x + s * R * 0.12 * k, y - R * 0.66 * k, 0], [x + s * R * 0.18 * k, y - R * 0.25 * k, 0.4], [x + s * R * 0.36 * k, y - R * 0.42 * k, 0], [x + s * R * 0.32, y + R * 0.2]],
          in: [],
        }
      case 'frill':
        return { outer: [], in: [] }
      case 'tufted':
      case 'pointed':
      default:
        return {
          outer: [[x - s * R * 0.3 * k, y + R * 0.14], [x - s * R * 0.2 * k, y - R * 0.3 * k], [x + s * R * 0.02, y - R * 0.74 * k, 0], [x + s * R * 0.24 * k, y - R * 0.3 * k], [x + s * R * 0.34 * k, y + R * 0.08]],
          in: [[x - s * R * 0.15 * k, y + R * 0.06], [x - s * R * 0.08 * k, y - R * 0.2 * k], [x + s * R * 0.02, y - R * 0.5 * k, 0], [x + s * R * 0.13 * k, y - R * 0.2 * k], [x + s * R * 0.19 * k, y + R * 0.02]],
          tip: [x + s * R * 0.02, y - R * 0.74 * k],
        }
    }
  }
  const draw = (x: number, y: number, s: number, z: number, far: boolean, showInner: boolean, sliver = false) => {
    const key = `ear-${s}${far ? 'f' : 'n'}`
    if (style === 'frill') {
      const [b, v, bx] = mounted(hg, frills(c, x, y, s, R, k, inner, far))
      out.add(b, z, key, v, false, bx)
      return
    }
    const o = one(x, y, s)
    const col = far ? shadowOf(coat.primary, 0.08) : coat.primary
    const outerD = smooth(o.outer)
    const shaped = furC && (style === 'pointed' || style === 'tufted' || style === 'round' || style === 'long') ? outerD + furEdge(c, outerD, { depth: coat.unit * (0.5 + coat.fluff * 0.8), spacing: coat.unit * 1.8, where: (n) => (Math.abs(n[0]) > 0.6 && n[1] > -0.3 ? 0.6 : 0), seed: key }) : outerD
    let extra = ''
    if (o.in.length && showInner && P.detail > 0) {
      // Seen from the side only a sliver of the inner ear shows, toward the face.
      const ax = o.in.reduce((a, p) => a + p[0], 0) / o.in.length
      const inD = smooth(sliver ? o.in.map((p) => [ax + (p[0] - ax) * 0.5 + R * 0.05, p[1], p[2] ?? 1] as SP) : o.in)
      extra += el('path', { d: inD, fill: softFill(c, inner, 'radial', 0.7) })
      if (P.detail > 1) extra += P.flat(inD, shadowOf(inner, 0.2), 0.35, { transform: `translate(${f(-s * R * 0.03)} ${f(R * 0.06)})` })
      if (furC && P.detail > 1 && !sliver) {
        // Ear floof: pale strands rising from the inner base.
        const rng = createRng(hash32(c.dna.seed, key))
        let fl = ''
        const base: P = [lerp(o.in[0][0], o.in[o.in.length - 1][0], 0.5), o.in[0][1]]
        const n = c.baked && P.detail > 1 ? 7 : 3
        for (let i = 0; i < n; i++) {
          const t = (i / (n - 1) - 0.5) * 0.9
          const L = R * rng.range(0.22, 0.34) * k
          fl += leaf([[base[0] + t * R * 0.2 * k, base[1]], [base[0] + t * R * 0.32 * k, base[1] - L * 0.6], [base[0] + t * R * 0.4 * k + s * R * 0.02, base[1] - L]], R * 0.05, 0)
        }
        extra += P.flat(fl, mix(coat.secondary, '#ffffff', 0.3), 0.85)
      }
    }
    if (style === 'bat' && P.detail > 0 && showInner) extra += P.line(`M${f(x)} ${f(y)}q${f(s * R * 0.05)} ${f(-R * 0.3 * k)} ${f(s * R * 0.02)} ${f(-R * 0.55 * k)}M${f(x + s * R * 0.12 * k)} ${f(y - R * 0.05)}q${f(s * R * 0.04)} ${f(-R * 0.22 * k)} ${f(s * R * 0.1 * k)} ${f(-R * 0.4 * k)}`, shadowOf(inner, 0.35), R * 0.025, { opacity: 0.7 })
    if (style === 'fin' && P.detail > 0) extra += P.line(`M${f(x - s * R * 0.2)} ${f(y + R * 0.15)}L${f(x - s * R * 0.2 * k)} ${f(y - R * 0.6 * k)}M${f(x)} ${f(y + R * 0.15)}L${f(x + s * R * 0.12 * k)} ${f(y - R * 0.52 * k)}M${f(x + s * R * 0.2)} ${f(y + R * 0.15)}L${f(x + s * R * 0.34 * k)} ${f(y - R * 0.32 * k)}`, shadowOf(col, 0.3), R * 0.03, { opacity: 0.6 })
    let svg = coatShape(c, shaped, coat, key, 'head', { tint: style === 'fin' ? mix(col, coat.secondary, 0.25) : col, plain: style === 'fin', offset: 0.1, extra, coatMaterial: style === 'fin' && coat.material === 'fur' ? 'skin' : undefined })
    if (style === 'tufted' && o.tip && !featherTuft) {
      const [tx, ty] = o.tip
      const tuftC = coat.material === 'feathers' ? shadowOf(coat.primary, 0.2) : shadowOf(coat.primary, 0.5)
      svg += P.shape(smooth([[tx - s * R * 0.05, ty + R * 0.08], [tx - s * R * 0.02, ty - R * 0.14], [tx + s * R * 0.06, ty - R * 0.3, 0], [tx + s * R * 0.08, ty - R * 0.1], [tx + s * R * 0.06, ty + R * 0.06]]), tuftC, { outline: 0.6, material: 'fur' })
    }
    const [b, v, bx] = mounted(hg, svg)
    out.add(b, z, key, v, false, bx)
  }
  if (facing) {
    const top = style === 'floppy' ? -R * 0.62 : style === 'fin' || style === 'frill' ? -R * 0.12 : -R * 0.7
    const xOff = style === 'fin' || style === 'frill' ? R * 0.92 : style === 'long' ? R * 0.42 : style === 'floppy' ? R * 0.74 : R * 0.6
    // Floppy ears hang over the sides of the head; the rest grow behind the skull.
    const z = style === 'floppy' && !away ? CZ.earNear : CZ.earFar
    draw(-xOff, top, -1, z, false, !away && style !== 'floppy')
    draw(xOff, top, 1, z, false, !away && style !== 'floppy')
  } else {
    const floppy = style === 'floppy'
    const side = style === 'fin' || style === 'frill'
    const yOff = side ? -R * 0.1 : floppy ? -R * 0.62 : -R * 0.72
    draw(floppy ? -R * 0.5 : side ? -R * 0.62 : -R * 0.35, yOff - R * 0.02, -1, CZ.earFar, true, false)
    draw(floppy ? -R * 0.3 : side ? -R * 0.5 : -R * 0.08, yOff - R * 0.06, -1, CZ.earNear, false, !floppy, true)
  }
}

/** Axolotl gills: three stalks per side, each fringed with soft filaments. */
function frills(c: Ctx, x: number, y: number, s: number, R: number, k: number, col: string, far: boolean): string {
  const P = c.paint
  const stalkC = far ? shadowOf(col, 0.1) : col
  const pieces: string[] = []
  const L = R * 0.62 * k
  for (const [i, a] of [-0.95, -0.3, 0.32].entries()) {
    const base: P = [x - s * R * 0.08, y + R * 0.12 * (i - 1)]
    const dir: P = [s * Math.cos(a), Math.sin(a)]
    const nn: P = [-dir[1], dir[0]]
    const len = L * (i === 1 ? 1.08 : 0.92)
    const end: P = [base[0] + dir[0] * len, base[1] + dir[1] * len]
    const mid: P = [lerp(base[0], end[0], 0.5) + nn[0] * R * 0.04, lerp(base[1], end[1], 0.5) + nn[1] * R * 0.04]
    pieces.push(leaf([base, mid, end], R * 0.13, R * 0.06))
    // Feathery filaments along the stalk, swept toward the tip.
    for (let j = 1; j <= 5; j++) {
      const t = 0.25 + j * 0.14
      const p: P = [lerp(base[0], end[0], t), lerp(base[1], end[1], t)]
      const fl = R * 0.13 * k * (1 - t * 0.35)
      for (const side of [-1, 1]) pieces.push(leaf([p, [p[0] + (nn[0] * side + dir[0] * 0.8) * fl, p[1] + (nn[1] * side + dir[1] * 0.8) * fl]], R * 0.065, R * 0.012))
    }
  }
  return P.union(pieces, stalkC, { material: 'skin', offset: 0.08, outline: 0.8 })
}

/* ---- Horns ----------------------------------------------------------------------- */

/** Growth rings across a tapered horn following `spine`. */
function hornRings(c: Ctx, spine: P[], w0: number, w1: number, col: string, n: number): string {
  if (c.paint.detail < 1) return ''
  let d = ''
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1)
    const idx = t * (spine.length - 1)
    const i0 = Math.floor(idx)
    const i1 = Math.min(spine.length - 1, i0 + 1)
    const u = idx - i0
    const p: P = [lerp(spine[i0][0], spine[i1][0], u), lerp(spine[i0][1], spine[i1][1], u)]
    const dir = norm([spine[i1][0] - spine[i0][0] || 0.001, spine[i1][1] - spine[i0][1]])
    const nn: P = [-dir[1], dir[0]]
    const w = lerp(w0, w1, t) * 0.5
    d += `M${f(p[0] + nn[0] * w)} ${f(p[1] + nn[1] * w)}Q${f(p[0] + dir[0] * w * 0.35)} ${f(p[1] + dir[1] * w * 0.35)} ${f(p[0] - nn[0] * w)} ${f(p[1] - nn[1] * w)}`
  }
  return c.paint.line(d, shadowOf(col, 0.3), w0 * 0.08, { opacity: 0.7 })
}

function hornPaint(c: Ctx, col: string): string {
  return c.paint.linear(`horn${col.slice(1)}`, [[0, shadowOf(col, 0.2)], [0.55, col], [1, highlightOf(col, 0.35)]], [0.5, 1], [0.5, 0])
}

function horns(c: Ctx, hg: HeadGeo, out: PartList): void {
  const h = c.sec('horns')
  const style = h.s('style') || 'none'
  if (style === 'none') return
  const P = c.paint
  const cr = c.cr as CreatureRig
  const R = hg.R
  const k = lerp(0.6, 1.5, h.n('size'))
  const col = h.c('color', '#e8dcc6')
  const facing = hg.frontal || cr.m.frontFacing
  const hornShape = (spine: P[], w0: number, w1: number, rings: number, tint: string): string => {
    const d = brush(spine, w0, w1)
    return P.shape(d, tint, { paint: hornPaint(c, tint), material: 'leather', inner: hornRings(c, spine, w0, w1, tint, rings) })
  }
  const one = (x: number, y: number, s: number, tint: string): string => {
    switch (style) {
      case 'nubs':
        return P.shape(smooth([[x - R * 0.11, y + R * 0.1], [x - R * 0.08, y - R * 0.08 * k], [x - s * R * 0.03, y - R * 0.18 * k, 0.5], [x + R * 0.1, y - R * 0.04 * k], [x + R * 0.1, y + R * 0.1]]), tint, { paint: hornPaint(c, tint), material: 'leather' })
      case 'straight':
        return hornShape([[x, y + R * 0.1], [x + s * R * 0.08 * k, y - R * 0.3 * k], [x + s * R * 0.2 * k, y - R * 0.66 * k]], R * 0.22 * k, R * 0.01, 4, tint)
      case 'curved':
        return hornShape([[x, y + R * 0.1], [x + s * R * 0.06 * k, y - R * 0.3 * k], [x + s * R * 0.3 * k, y - R * 0.58 * k], [x + s * R * 0.62 * k, y - R * 0.64 * k]], R * 0.22 * k, R * 0.01, 5, tint)
      case 'ram': {
        const sp: P[] = []
        for (let i = 0; i <= 10; i++) {
          const a = -Math.PI * 0.55 - (i / 10) * Math.PI * 1.55
          const rr = R * 0.36 * k * (1 - i / 16)
          sp.push([x + s * R * 0.16 * k - s * Math.cos(a) * rr * -1, y + R * 0.12 * k + Math.sin(a) * rr])
        }
        return hornShape(sp, R * 0.26 * k, R * 0.08 * k, 7, tint)
      }
      case 'antlers': {
        const main: P[] = [[x, y + R * 0.1], [x + s * R * 0.1 * k, y - R * 0.42 * k], [x + s * R * 0.36 * k, y - R * 0.84 * k], [x + s * R * 0.42 * k, y - R * 1.0 * k]]
        const tines: [P, P][] = [
          [[x + s * R * 0.06 * k, y - R * 0.28 * k], [x - s * R * 0.2 * k, y - R * 0.58 * k]],
          [[x + s * R * 0.22 * k, y - R * 0.64 * k], [x + s * R * 0.06 * k, y - R * 1.0 * k]],
          [[x + s * R * 0.32 * k, y - R * 0.78 * k], [x + s * R * 0.6 * k, y - R * 0.86 * k]],
        ]
        let d = brush(main, R * 0.13 * k, R * 0.05 * k)
        for (const [a, b] of tines) d += brush([a, [lerp(a[0], b[0], 0.5) + s * R * 0.02, lerp(a[1], b[1], 0.5)], b], R * 0.08 * k, R * 0.03 * k)
        return P.union([d], tint, { paint: hornPaint(c, tint), material: 'wood' }) + (P.detail > 0 ? P.flat(circle(x, y + R * 0.06, R * 0.1 * k), shadowOf(tint, 0.25)) : '')
      }
    }
    return ''
  }
  let svg = ''
  if (style === 'unicorn') {
    const x = facing ? 0 : R * 0.45
    const tipX = x + (facing ? 0 : R * 0.35)
    const base: P[] = [[x - R * 0.12, -R * 0.74], [x + R * 0.12, -R * 0.78]]
    const tip: P = [tipX, -R * 1.62 * k]
    const d = smooth([[base[0][0], base[0][1], 0.4], [tip[0], tip[1], 0], [base[1][0], base[1][1], 0.4]])
    let twist = ''
    if (P.detail > 0) for (let i = 1; i <= 5; i++) {
      const t = i / 6
      const lx = lerp(base[0][0], tip[0], t)
      const rx = lerp(base[1][0], tip[0], t)
      const ly = lerp(base[0][1], tip[1], t)
      const ry = lerp(base[1][1], tip[1], t)
      twist += `M${f(lx)} ${f(ly)}Q${f(lerp(lx, rx, 0.5))} ${f(lerp(ly, ry, 0.5) - R * 0.04)} ${f(rx)} ${f(ry - R * 0.08 * (1 - t))}`
    }
    const pearl = P.linear(`uni${col.slice(1)}`, [[0, shadowOf(col, 0.15)], [0.45, col], [0.75, highlightOf(col, 0.45)], [1, '#ffffff']], [0, 1], [0.3, 0])
    svg = P.shape(d, col, { paint: pearl, material: 'gem', spec: 0.6, inner: twist ? P.line(twist, shadowOf(col, 0.3), R * 0.03, { opacity: 0.7 }) + P.line(twist, highlightOf(col, 0.6), R * 0.012, { opacity: 0.8 }) : undefined })
  } else if (style === 'antenna') {
    const bug = cr.m.plan === 'insectoid'
    const xs = facing ? [-R * 0.32, R * 0.32] : [R * 0.18, -R * 0.02]
    xs.forEach((x, i) => {
      const s = facing ? Math.sign(x) : 1
      const tip: P = [x + R * 0.34 * s, -R * 1.62 * k]
      const mid: P = [x + R * 0.06 * s, -R * 1.25 * k]
      const stalk = `M${f(x)} ${f(-R * 0.82)}Q${f(mid[0])} ${f(mid[1])} ${f(tip[0])} ${f(tip[1])}`
      const tint = !facing && i === 1 ? shadowOf(col, 0.15) : col
      let a = P.line(stalk, inkC(c, tint), R * 0.075) + P.line(stalk, tint, R * 0.045)
      if (bug && c.sec('wings').s('style') === 'fairy') a += P.shape(ellipse(tip[0], tip[1], R * 0.09, R * 0.14), tint, { material: 'chitin', gloss: true })
      else a += P.shape(circle(tip[0], tip[1], R * (bug ? 0.08 : 0.11)), bug ? tint : highlightOf(tint, 0.1), { material: bug ? 'chitin' : 'plastic', gloss: true })
      svg += a
    })
    const [b, v, bx] = mounted(hg, svg)
    out.add(b, facing ? CZ.earFar - 1 : CZ.horns, 'horns', v, false, bx)
    return
  } else if (style === 'crown') {
    let d = ''
    for (let i = -2; i <= 2; i++) {
      const hx = i * R * 0.2
      const hh = R * (0.32 - Math.abs(i) * 0.05) * k
      d += smooth([[hx - R * 0.07, -R * 0.78], [hx - R * 0.03, -R * 0.82 - hh * 0.6], [hx, -R * 0.82 - hh, 0], [hx + R * 0.03, -R * 0.82 - hh * 0.6], [hx + R * 0.07, -R * 0.78]])
    }
    svg = P.union([d], col, { paint: hornPaint(c, col), material: 'leather' })
  } else if (facing) {
    svg = one(-R * 0.45, -R * 0.72, -1, col) + one(R * 0.45, -R * 0.72, 1, col)
  } else {
    svg = one(-R * 0.25, -R * 0.78, -1, shadowOf(col, 0.1)) + one(R * 0.05, -R * 0.85, -1, col)
  }
  const [b, v, bx] = mounted(hg, svg)
  out.add(b, CZ.horns, 'horns', v, false, bx)
}

/* ---- Static head ------------------------------------------------------------------ */

/** Static head: cranium, snout/beak, ears, horns, whiskers, cheek fluff. */
export function creatureHeadStatic(c: Ctx, out0: PartList): void {
  const out = boxedParts(out0)
  const cr = c.cr as CreatureRig
  const m = cr.m
  if (m.plan === 'blob' || m.plan === 'cephalopod') {
    // The body is the head; features are drawn by the frontal plan.
    const hg = { ...headGeo(c), R: m.bodyR * 0.85, frontal: true, away: c.view === 'back' }
    ears(c, coatOf(c), hg, out)
    horns(c, hg, out)
    return
  }
  const coat = coatOf(c)
  const hg = headGeo(c)
  const P = c.paint
  const R = hg.R
  const fs = c.sec('face')
  const mouth = fs.s('mouth') || 'smile'
  const sn01 = clamp(hg.sn / (R * 1.25), 0, 1)
  const nose = noseKind(c, coat, mouth)
  const furC = coat.material === 'fur'
  const cheeks = fs.n('cheeks')
  if (m.plan === 'aquatic') {
    // Fish: the head is the front of the body (turned toward the camera, the face is drawn
    // straight onto it).
    horns(c, hg, out)
    return
  }
  if (m.plan === 'robot') {
    ears(c, coat, hg, out)
    horns(c, hg, out)
    return
  }
  const whiskers = c.sec('extras').b('whiskers')
  const whiskerC = isDark(coat.primary) ? '#f3efe6' : shadowOf(coat.primary, 0.62)
  if (hg.frontal) {
    const away = !!hg.away
    const cranium = smooth(craniumFrontal(R, hg.shape))
    // Cheek fluff and a forehead tuft merge into the silhouette.
    const fluff = furC ? Math.max(cheeks, coat.fluff * 0.6) : 0
    const head = fluff > 0.12
      ? cranium + furEdge(c, cranium, { depth: R * 0.2 * fluff + coat.unit * 0.4, spacing: coat.unit * (2 + fluff * 1.2), where: (n, p) => (Math.abs(n[0]) > 0.45 && p[1] > -R * 0.2 ? 1 : n[1] < -0.8 ? 0.35 : 0), lean: [0, 0.35], seed: 'cheeks', essential: true })
      : cranium
    const eyes: P[] = [[-hg.eyeX, hg.eyeY], [hg.eyeX, hg.eyeY]]
    let extra = ''
    if (!away && m.plan !== 'insectoid' && !hg.beak && P.detail > 0) {
      // A lighter muzzle and chin; whisker pads on short-snouted faces.
      const my = R * lerp(0.36, 0.5, sn01)
      const mw = R * lerp(0.34, 0.5, sn01)
      const mh = R * lerp(0.24, 0.4, sn01)
      const pads = sn01 < 0.3 ? ellipse(-mw * 0.52, my, mw * 0.62, mh * 0.8) + ellipse(mw * 0.52, my, mw * 0.62, mh * 0.8) + ellipse(0, my + mh * 0.55, mw * 0.5, mh * 0.55) : ''
      if (pads) extra += el('path', { d: pads, fill: softFill(c, coat.belly, 'radial', 0.7) })
      // Marked fur coats get pale cheeks and chin with a notch up the bridge of the nose
      // (tabbies, foxes, wolves, tigers).
      const contrast = Math.abs(toLch(coat.belly).l - toLch(coat.primary).l)
      if (furC && coat.pattern !== 'none' && coat.pattern !== 'mask' && contrast > 0.06) {
        const ey = hg.eyeY
        const mask = smooth([[-R * 1.08, R * 0.02], [-hg.eyeX * 1.15, ey + R * 0.3], [-R * 0.16, ey + R * 0.24], [0, R * 0.1, 0.4], [R * 0.16, ey + R * 0.24], [hg.eyeX * 1.15, ey + R * 0.3], [R * 1.08, R * 0.02], [R * 0.8, R * 1.05], [-R * 0.8, R * 1.05]])
        extra += P.flat(mask, coat.belly, 0.96)
      }
    }
    if (!away && m.plan === 'avian' && mouth === 'hooked' && P.detail > 0) {
      // A pale facial disc around the eyes (owls, parrots, raptors).
      extra += el('path', { d: ellipse(-hg.eyeX * 1.02, hg.eyeY + R * 0.04, R * 0.44, R * 0.48) + ellipse(hg.eyeX * 1.02, hg.eyeY + R * 0.04, R * 0.44, R * 0.48), fill: softFill(c, mix(coat.belly, '#ffffff', 0.25), 'radial', 0.72) })
    }
    let svg = coatShape(c, head, coat, 'headF', 'head', { hint: { frontal: true, eyes }, flow: 'radial', extra, plain: away && coat.pattern === 'mask' })
    // Protruding muzzle for longer snouts.
    if (!away && !hg.beak && m.plan !== 'insectoid' && sn01 >= 0.3) {
      const my = R * lerp(0.36, 0.52, sn01)
      const mw = R * lerp(0.36, 0.5, sn01)
      const mh = R * lerp(0.26, 0.42, sn01)
      const long = hg.shape === 'long'
      const muz = smooth([[-mw, my - mh * 0.2], [-mw * 0.7, my - mh * 0.85], [0, my - mh * (long ? 1.2 : 1.02)], [mw * 0.7, my - mh * 0.85], [mw, my - mh * 0.2], [mw * 0.8, my + mh * 0.62], [0, my + mh * 0.92], [-mw * 0.8, my + mh * 0.62]])
      const muzC = furC || coat.material === 'skin' ? coat.belly : highlightOf(coat.primary, 0.12)
      svg += coatShape(c, muz, coat, 'muzzleF', 'head', { tint: muzC, plain: true, outline: 0.7, offset: 0.12, flow: 'radial' })
    }
    // Nose.
    if (!away && !hg.beak) svg += frontalNose(c, coat, nose, R, sn01, mouth)
    if (!away && cheeks > 0.25 && !furC) svg += tufts(c, [[-R * 0.95, R * 0.1], [-R * 1.05, R * 0.35], [-R * 0.8, R * 0.6]], R * 0.18 * cheeks, coat.primary) + tufts(c, [[R * 0.8, R * 0.6], [R * 1.05, R * 0.35], [R * 0.95, R * 0.1]], R * 0.18 * cheeks, coat.primary)
    out.add('head', CZ.head, 'head', svg)
    if (whiskers && !away) {
      const my = R * lerp(0.4, 0.52, sn01)
      const mw = R * lerp(0.3, 0.46, sn01)
      let d = ''
      let thin = ''
      let dots = ''
      for (const s of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const y0 = my + R * (i - 1) * 0.06
          const pts: P[] = [[s * mw * 0.55, y0], [s * (mw + R * 0.3), y0 + R * (i - 1.2) * 0.05], [s * (mw + R * 0.62), y0 + R * (i - 1.4) * 0.12]]
          // Tapered whiskers at high detail, plain strokes otherwise (lighter documents).
          if (P.detail > 1) d += leaf(pts, R * 0.028, R * 0.004)
          else thin += `M${f(pts[0][0])} ${f(pts[0][1])}Q${f(pts[1][0])} ${f(pts[1][1])} ${f(pts[2][0])} ${f(pts[2][1])}`
          dots += circle(s * mw * (0.35 + i * 0.12), my - R * 0.02 + i * R * 0.05, R * 0.014)
        }
      out.add('head', CZ.face, 'whiskers', P.flat(d, whiskerC, 0.95) + P.line(thin, whiskerC, R * 0.018, { opacity: 0.95 }) + (P.detail > 1 ? P.flat(dots, shadowOf(coat.belly, 0.4), 0.6) : ''))
    }
    if (hg.beak && !away) out.add('head', CZ.mouth - 1, 'beak', beakFrontal(c, R, mouth, coat))
  } else {
    // Profile: cranium and muzzle toward +x, painted as one mass.
    const cranium = smooth(craniumProfile(R, hg.shape))
    const tip: P = [R * 0.55 + hg.sn, R * 0.12]
    const hasMuzzle = !hg.beak && hg.sn >= R * 0.12 && m.plan !== 'insectoid'
    const muzzle = hasMuzzle ? tube([[R * 0.1, R * 0.06], [lerp(R * 0.2, tip[0], 0.55), R * 0.1], tip], [R * 0.54, R * 0.42, R * 0.3]) : ''
    const cheekFluff = furC ? Math.max(cheeks, coat.fluff * 0.5) : 0
    const head = cheekFluff > 0.12 ? cranium + furEdge(c, cranium, { depth: R * 0.22 * cheekFluff + coat.unit * 0.4, spacing: coat.unit * (2 + cheekFluff), where: (n, p) => (n[1] > 0.3 && p[0] < R * 0.3 ? 1 : n[0] < -0.6 ? 0.5 : 0), lean: [-0.4, 0.5], seed: 'cheekP', essential: true }) : cranium
    const belly = hasMuzzle ? ellipse(tip[0] - hg.sn * 0.35, R * 0.42, hg.sn * 0.75 + R * 0.2, R * 0.22) : ''
    let extra = ''
    if (hasMuzzle && P.detail > 0) {
      // Jaw line under the muzzle.
      extra += P.line(`M${f(tip[0] - R * 0.1)} ${f(tip[1] + R * 0.2)}Q${f(lerp(R * 0.2, tip[0], 0.5))} ${f(R * 0.34)} ${f(R * 0.1)} ${f(R * 0.36)}`, shadowOf(coat.belly, 0.35), P.lw * 0.6, { opacity: 0.45 })
    }
    let svg = coatShape(c, head, coat, 'headP', 'head', { union: muzzle ? [muzzle] : undefined, belly: belly || undefined, hint: { eyes: [[hg.eyeX, hg.eyeY]] }, extra })
    if (hasMuzzle) svg += profileNose(c, coat, nose, tip, R, mouth, sn01)
    out.add('head', CZ.head, 'head', svg)
    if (whiskers) {
      let d = ''
      for (let i = 0; i < 3; i++) d += leaf([[tip[0] - R * 0.12, tip[1] + R * (0.04 + i * 0.06)], [tip[0] + R * 0.2, tip[1] + R * (0.02 + i * 0.07) + R * (i - 1) * 0.04], [tip[0] + R * 0.52, tip[1] + R * (i - 1) * 0.16]], R * 0.028, R * 0.004)
      out.add('head', CZ.face, 'whiskers', P.flat(d, whiskerC, 0.95))
    }
    if (hg.beak) out.add('head', CZ.mouth - 1, 'beak', beakProfile(c, R, mouth, coat))
    if (mouth === 'tusks') {
      const tusk = brush([[tip[0] - R * 0.3, R * 0.3], [tip[0] - R * 0.1, R * 0.12], [tip[0], -R * 0.05]], R * 0.13, R * 0.02)
      out.add('head', CZ.mouth + 1, 'tusks', P.shape(tusk, '#f5f0e0', { paint: P.linear('tusk', [[0, '#d9cfb8'], [1, '#fffbf0']], [0, 1], [1, 0]), material: 'gem', spec: 0.4 }))
    }
  }
  ears(c, coat, hg, out)
  horns(c, hg, out)
}

function frontalNose(c: Ctx, coat: Coat, nose: 'leather' | 'nostrils' | 'none', R: number, sn01: number, mouth: string): string {
  const P = c.paint
  if (nose === 'none' || P.detail < 1) return ''
  const ny = R * lerp(0.2, 0.3, sn01)
  if (nose === 'nostrils') {
    const k = lerp(0.6, 1.2, sn01)
    const nx = R * lerp(0.1, 0.2, sn01)
    const nyy = ny + R * lerp(0.05, 0.28, sn01)
    return P.flat(ellipse(-nx, nyy, R * 0.045 * k, R * 0.06 * k) + ellipse(nx, nyy, R * 0.045 * k, R * 0.06 * k), shadowOf(coat.primary, 0.6), 0.85)
  }
  const col = noseColor(coat, mouth, sn01)
  const w = R * lerp(0.13, 0.22, sn01)
  const h = w * lerp(0.7, 0.62, sn01)
  const d = smooth([[-w, ny - h * 0.35], [-w * 0.6, ny - h * 0.62], [w * 0.6, ny - h * 0.62], [w, ny - h * 0.35], [w * 0.35, ny + h * 0.45], [0, ny + h * 0.58, 0.5], [-w * 0.35, ny + h * 0.45]])
  let inner = ''
  if (sn01 > 0.2) inner += P.flat(ellipse(-w * 0.45, ny + h * 0.05, w * 0.18, h * 0.16) + ellipse(w * 0.45, ny + h * 0.05, w * 0.18, h * 0.16), shadowOf(col, 0.5), 0.9)
  inner += P.flat(ellipse(-w * 0.2, ny - h * 0.3, w * 0.28, h * 0.14), '#ffffff', 0.55)
  // Philtrum down to the mouth.
  const phil = P.line(`M0 ${f(ny + h * 0.55)}L0 ${f(ny + h * 0.55 + R * 0.08)}`, shadowOf(coat.belly, 0.5), Math.max(P.lw * 0.7, R * 0.02))
  return phil + P.shape(d, col, { material: 'rubber', spec: 0.5, outline: 0.6, inner })
}

function profileNose(c: Ctx, coat: Coat, nose: 'leather' | 'nostrils' | 'none', tip: P, R: number, mouth: string, sn01: number): string {
  const P = c.paint
  if (nose === 'none' || P.detail < 1) return ''
  if (nose === 'nostrils') return P.flat(ellipse(tip[0] + R * 0.12, tip[1] - R * 0.12, R * 0.05, R * 0.035), shadowOf(coat.primary, 0.6), 0.85)
  const col = noseColor(coat, mouth, sn01)
  const w = R * lerp(0.12, 0.17, sn01)
  const x = tip[0] + R * 0.18
  const y = tip[1] - R * 0.14
  const d = smooth([[x - w * 1.2, y - w * 0.55], [x + w * 0.2, y - w * 0.85], [x + w * 0.95, y - w * 0.1, 0.6], [x + w * 0.55, y + w * 0.75], [x - w * 0.6, y + w * 0.65]])
  const inner = P.flat(ellipse(x + w * 0.35, y + w * 0.25, w * 0.22, w * 0.15), shadowOf(col, 0.5), 0.9) + P.flat(ellipse(x - w * 0.15, y - w * 0.45, w * 0.35, w * 0.16), '#ffffff', 0.55)
  return P.shape(d, col, { material: 'rubber', spec: 0.5, outline: 0.6, inner })
}

function beakColor(coat: Coat): string {
  return coat.accent === '#c0392b' ? '#f2a53a' : coat.accent
}

function beakProfile(c: Ctx, R: number, mouth: string, coat: Coat): string {
  const P = c.paint
  const col = beakColor(coat)
  const lower = shadowOf(col, 0.12)
  const sheen = (d: string) => P.detail > 0 ? P.line(d, highlightOf(col, 0.55), R * 0.035, { opacity: 0.7 }) : ''
  if (mouth === 'duck') {
    const up = smooth([[R * 0.66, -R * 0.1], [R * 1.1, -R * 0.06], [R * 1.52, -R * 0.02], [R * 1.66, R * 0.1, 0.5], [R * 1.5, R * 0.16], [R * 0.7, R * 0.14]])
    const lo = smooth([[R * 0.7, R * 0.12], [R * 1.48, R * 0.14], [R * 1.5, R * 0.26, 0.5], [R * 0.72, R * 0.3]])
    return P.shape(lo, lower, { material: 'plastic', spec: 0.3 }) + P.shape(up, col, { material: 'plastic', spec: 0.45, inner: P.flat(ellipse(R * 1.54, R * 0.06, R * 0.1, R * 0.06), shadowOf(col, 0.2), 0.8) + P.flat(ellipse(R * 0.95, -R * 0.02, R * 0.05, R * 0.02), shadowOf(col, 0.5)) }) + sheen(`M${f(R * 0.8)} ${f(-R * 0.06)}Q${f(R * 1.2)} ${f(-R * 0.06)} ${f(R * 1.45)} ${f(R * 0.0)}`)
  }
  if (mouth === 'hooked') {
    const up = smooth([[R * 0.66, -R * 0.24], [R * 1.0, -R * 0.22], [R * 1.28, -R * 0.08], [R * 1.38, R * 0.18], [R * 1.3, R * 0.34, 0], [R * 1.16, R * 0.12], [R * 0.72, R * 0.14]])
    const lo = smooth([[R * 0.72, R * 0.12], [R * 1.12, R * 0.14], [R * 1.08, R * 0.28, 0.4], [R * 0.74, R * 0.3]])
    const cere = P.detail > 0 ? P.flat(ellipse(R * 0.8, -R * 0.1, R * 0.06, R * 0.04), shadowOf(col, 0.45), 0.8) : ''
    return P.shape(lo, lower, { material: 'plastic', spec: 0.3 }) + P.shape(up, col, { material: 'plastic', spec: 0.45, inner: cere }) + sheen(`M${f(R * 0.78)} ${f(-R * 0.18)}Q${f(R * 1.1)} ${f(-R * 0.17)} ${f(R * 1.26)} ${f(-R * 0.02)}`)
  }
  const up = smooth([[R * 0.68, -R * 0.16], [R * 1.05, -R * 0.08], [R * 1.44, R * 0.07, 0], [R * 1.0, R * 0.1], [R * 0.7, R * 0.1]])
  const lo = smooth([[R * 0.7, R * 0.09], [R * 1.3, R * 0.1, 0], [R * 0.95, R * 0.2], [R * 0.72, R * 0.26]])
  return P.shape(lo, lower, { material: 'plastic', spec: 0.3 }) + P.shape(up, col, { material: 'plastic', spec: 0.45, inner: P.detail > 0 ? P.flat(ellipse(R * 0.84, -R * 0.06, R * 0.05, R * 0.025), shadowOf(col, 0.45)) : undefined }) + sheen(`M${f(R * 0.8)} ${f(-R * 0.1)}Q${f(R * 1.1)} ${f(-R * 0.06)} ${f(R * 1.3)} ${f(R * 0.04)}`)
}

function beakFrontal(c: Ctx, R: number, mouth: string, coat: Coat): string {
  const P = c.paint
  const col = beakColor(coat)
  const lower = shadowOf(col, 0.14)
  if (mouth === 'duck') {
    const up = smooth([[-R * 0.42, R * 0.26], [-R * 0.3, R * 0.12], [R * 0.3, R * 0.12], [R * 0.42, R * 0.26], [R * 0.36, R * 0.42, 0.6], [-R * 0.36, R * 0.42, 0.6]])
    const lo = smooth([[-R * 0.34, R * 0.4], [R * 0.34, R * 0.4], [R * 0.26, R * 0.52, 0.5], [-R * 0.26, R * 0.52, 0.5]])
    return P.shape(lo, lower, { material: 'plastic', spec: 0.3 }) + P.shape(up, col, { material: 'plastic', spec: 0.5, inner: P.detail > 0 ? P.flat(ellipse(-R * 0.1, R * 0.2, R * 0.03, R * 0.02) + ellipse(R * 0.1, R * 0.2, R * 0.03, R * 0.02), shadowOf(col, 0.5)) : undefined })
  }
  const hooked = mouth === 'hooked'
  const up = smooth([[-R * 0.19, R * 0.1], [0, R * 0.04], [R * 0.19, R * 0.1], [R * 0.1, R * 0.34], [0, R * (hooked ? 0.56 : 0.46), 0], [-R * 0.1, R * 0.34]])
  const lo = smooth([[-R * 0.12, R * 0.3], [R * 0.12, R * 0.3], [0, R * 0.44, 0.4]])
  const ridge = P.detail > 0 ? P.line(`M0 ${f(R * 0.08)}L0 ${f(R * (hooked ? 0.48 : 0.4))}`, highlightOf(col, 0.55), R * 0.03, { opacity: 0.7 }) : ''
  const nares = P.detail > 0 ? P.flat(ellipse(-R * 0.07, R * 0.14, R * 0.025, R * 0.018) + ellipse(R * 0.07, R * 0.14, R * 0.025, R * 0.018), shadowOf(col, 0.5)) : ''
  return P.shape(lo, lower, { material: 'plastic', spec: 0.3 }) + P.shape(up, col, { material: 'plastic', spec: 0.5, inner: ridge + nares })
}

/* ---- Face (dynamic) ---------------------------------------------------------- */

function eyePositions(c: Ctx, hg: HeadGeo, count: number): P[] {
  const cr = c.cr as CreatureRig
  const frontal = hg.frontal || cr.m.frontFacing
  const R = cr.m.frontFacing && cr.m.plan !== 'robot' ? cr.m.bodyR * 0.85 : hg.R
  const y = cr.m.frontFacing && cr.m.plan !== 'robot' ? -R * 0.25 : hg.eyeY
  const sx = c.view === 'side' && cr.m.frontFacing ? R * 0.18 : 0
  if (count === 1) return [[frontal ? sx : hg.eyeX, y]]
  if (!frontal) {
    const base: P = [hg.eyeX, y]
    if (count === 2) return [base]
    const out: P[] = []
    for (let i = 0; i < Math.ceil(count / 2); i++) out.push([base[0] - i * R * 0.18, base[1] + (i % 2 ? R * 0.16 : -R * 0.02)])
    return out
  }
  const dx = cr.m.frontFacing ? R * 0.36 : hg.eyeX
  if (count === 2) return [[-dx + sx, y], [dx + sx, y]]
  if (count === 3) return [[-dx + sx, y], [dx + sx, y], [sx, y - R * 0.3]]
  if (count === 4) return [[-dx + sx, y], [dx + sx, y], [-dx * 0.55 + sx, y - R * 0.28], [dx * 0.55 + sx, y - R * 0.28]]
  const out: P[] = []
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (1.15 + (i / (count - 1)) * 0.7)
    out.push([sx + Math.cos(a) * dx * 1.2, y + R * 0.15 + Math.sin(a) * R * 0.35])
  }
  return out
}

export function creatureFace(c: Ctx, f0: FrameState, out0: PartList): void {
  const out = boxedParts(out0)
  const cr = c.cr as CreatureRig
  const m = cr.m
  // Turned away from the camera: no face to draw.
  if (c.view === 'back') return
  const coat = coatOf(c)
  const hg = headGeo(c)
  const fs = c.sec('face')
  const count = Number(fs.s('eyeCount') || '2')
  const styleId = fs.s('eyeStyle') || 'cute'
  const style = EYE_STYLES[styleId] ?? EYE_STYLES.cute
  const tv = tvFace(c)
  const bodyHead = m.frontFacing && m.plan !== 'robot'
  const R = tv ? tv.R : bodyHead ? m.bodyR * 0.85 : hg.R
  const baseW = R * lerp(0.28, 0.6, fs.n('eyeSize')) * (count > 2 ? 0.7 : 1) * (count === 1 ? 1.5 : 1)
  const x = f0.expr
  const fishFace = m.plan === 'aquatic' && hg.frontal
  const off: P = tv ? [tv.cx, tv.cy] : fishFace ? [-R * 0.1, R * 0.02] : [0, 0]
  const eyeHg: HeadGeo = tv ? { ...hg, R: tv.R, eyeY: -tv.R * 0.18 } : fishFace ? { ...hg, eyeX: R * 0.3 } : hg
  const pos = eyePositions(c, eyeHg, count).map(([px, py]) => [px + off[0], py + off[1]] as P)
  const bone = bodyHead ? 'body' : 'head'
  const skin = coat.primary
  const eyes = pos.map(([ex, ey], i) =>
    drawEye(c, {
      cx: ex,
      cy: ey,
      w: baseW * (i >= 2 ? 0.75 : 1),
      dir: ex >= 0 ? 1 : -1,
      style,
      tilt: 0,
      open: i % 2 ? x.openR : x.openL,
      squint: x.squint,
      lookX: x.lookX + (c.view === 'side' ? 0.35 : 0),
      lookY: x.lookY,
      lidAngle: x.lidAngle,
      mode: i % 2 ? x.eyeR : x.eyeL,
      iris: fs.c('iris', '#d4a017'),
      sclera: '#fbf9f6',
      pupil: fs.s('pupil') || 'round',
      irisScale: 0.6,
      sparkle: 0.7,
      lashes: fs.b('lashes') ? 0.7 : 0,
      liner: 0,
      shadow: 0,
      shadowColor: '#000000',
      glow: fs.b('glow'),
      bags: 0,
      skin,
    }),
  )
  out.add(bone, CZ.eyes, 'eyes', eyes.join(''))
  out.add(bone, CZ.mouth, 'mouth', creatureMouth(c, f0, hg, coat, R, bodyHead, off, !!tv))
  if (x.blush > 0.05 || c.sec('face').n('cheeks') > 0.9) {
    const bx = pos.length > 1 ? Math.abs(pos[1][0] - off[0]) * 1.05 : hg.eyeX
    const by = (pos[0]?.[1] ?? 0) + R * 0.3
    const d = pos.length > 1 ? ellipse(off[0] - bx, by, R * 0.16, R * 0.08) + ellipse(off[0] + bx, by, R * 0.16, R * 0.08) : ellipse(bx - R * 0.1, by, R * 0.16, R * 0.08)
    const a = Math.min(0.6, x.blush * 0.6 + 0.1)
    out.add(bone, CZ.face, 'blush', c.baked ? el('path', { d, fill: softFill(c, '#ff6b8a', 'radial', 0.35), 'fill-opacity': f(a * 1.4) }) : c.paint.flat(d, '#ff6b8a', a))
  }

  // Tears, sweat, the anger mark, zzz and steam (the shared expression effects).
  if (x.tears < 0.05 && x.sweat < 0.1 && !x.vein && !x.zzz && !x.steam) return
  const frontal = hg.frontal || m.frontFacing
  const top = (bodyHead && !tv ? -R * 1.15 : -R * 0.95) + off[1]
  const eyeY = pos[0]?.[1] ?? hg.eyeY
  const fx: ExprFxSpec = {
    eyes: pos.slice(0, frontal ? 2 : 1).map(([ex, ey]) => ({ x: ex, y: ey + baseW * 0.22, dir: frontal ? (ex >= off[0] ? 1 : -1) : -1 })),
    eyeW: baseW,
    unit: R * 2,
    halfW: R * (bodyHead ? 1.05 : 0.95),
    topY: top,
    templeX: off[0] + (frontal ? R * 0.72 : -R * 0.15),
    templeY: eyeY - R * 0.28,
    veinX: off[0] + (frontal ? -R * 0.5 : R * 0.05),
    veinY: top + R * 0.35,
    tears: x.tears,
    sweat: x.sweat,
    vein: x.vein,
    zzz: x.zzz,
    steam: x.steam,
  }
  const tears = drawTears(c, fx)
  if (tears) out.add(bone, CZ.eyes + 1, 'tears', tears)
  const marks = drawSweat(c, fx) + drawVein(c, fx)
  if (marks) out.add(bone, CZ.horns + 1, 'sweat', marks)
  const emote = drawZzz(c, fx) + drawSteam(c, fx)
  if (emote) out.add(bone, CZ.acc + 10, 'emote', emote)
}

function creatureMouth(c: Ctx, f0: FrameState, hg: HeadGeo, coat: Coat, R: number, bodyHead: boolean, off: P = [0, 0], tv = false): string {
  const P = c.paint
  const x = f0.expr
  const style = c.sec('face').s('mouth') || 'smile'
  const cr = c.cr as CreatureRig
  const frontal = hg.frontal || cr.m.frontFacing
  if (style === 'none' || hg.beak) {
    if (hg.beak && x.open > 0.2) return P.flat(ellipse(hg.frontal ? 0 : R * 1.0, hg.frontal ? R * 0.34 : R * 0.12, R * 0.12, R * 0.05 * x.open), '#5a1f2c')
    return ''
  }
  const ink = shadowOf(coat.primary, 0.7)
  const muzzleInk = shadowOf(frontal && !bodyHead ? coat.belly : coat.primary, 0.62)
  const cx = (frontal ? (c.view === 'side' && bodyHead ? R * 0.18 : 0) : hg.mouthX) + off[0]
  const cy = (frontal ? (tv ? R * 0.3 : bodyHead ? R * 0.15 : hg.mouthY) : hg.mouthY) + off[1]
  const w = frontal ? R * 0.28 : R * 0.45
  const lw = Math.max(P.lw, R * 0.035)
  if (style === 'grill') {
    const d = roundRect(cx - w, cy - R * 0.08, w * 2, R * 0.16 + x.open * R * 0.15, R * 0.05)
    const glowC = c.sec('face').c('iris', '#00e5ff')
    return P.shape(d, '#141a22', { material: 'plastic' }) + P.line([-0.5, 0, 0.5].map((k) => `M${f(cx + k * w)} ${f(cy - R * 0.05)}v${f(R * 0.1 + x.open * R * 0.15)}`).join(''), glowC, R * 0.03) + (c.baked && P.detail > 1 ? P.glow(cx, cy, w * 1.2, glowC, 0.25) : '')
  }
  if (style === 'mandibles') {
    const open = 0.2 + x.open * 0.5
    const col = shadowOf(coat.primary, 0.45)
    const mand = (s: number) => smooth([[cx + s * R * 0.08, cy - R * 0.02], [cx + s * R * (0.22 + open * 0.1), cy + R * 0.12], [cx + s * R * (0.12 + open * 0.08), cy + R * 0.34, 0], [cx + s * R * 0.06, cy + R * 0.18], [cx + s * R * 0.02, cy + R * 0.06]])
    return P.shape(frontal ? mand(-1) + mand(1) : mand(1), col, { material: 'chitin' })
  }
  const open = Math.max(0, x.open)
  let svg = ''
  const toothC = '#fbf8f0'
  if (open > 0.08) {
    const h = R * 0.3 * open
    const d = frontal
      ? smooth([[cx - w * 0.8, cy, 0.5], [cx + w * 0.8, cy, 0.5], [cx + w * 0.5, cy + h], [cx - w * 0.5, cy + h]])
      : smooth([[cx - w, cy - R * 0.02, 0.5], [cx + w * 0.3, cy - R * 0.05, 0.5], [cx + w * 0.1, cy + h], [cx - w * 0.6, cy + h * 0.8]])
    // Inner mouth deepening toward the back, a tongue with a soft sheen (shared mouth materials).
    const cavity = c.baked ? radialPaint(c, [[0, '#2a0b14'], [0.55, '#4a1522'], [1, '#6e2636']], { cx: 0.5, cy: 0.25, r: 0.8 }) : undefined
    const tongue = P.flat(ellipse(cx, cy + h * 0.78, w * 0.42, h * 0.32), '#e0788a') + (P.detail > 0 ? (c.baked ? softSpot(c, cx - w * 0.1, cy + h * 0.68, w * 0.2, h * 0.1, '#ffc2cc', 0.8) : P.flat(ellipse(cx - w * 0.1, cy + h * 0.68, w * 0.14, h * 0.08), '#ffb3c0', 0.6)) : '')
    svg += P.shape(d, '#5a1f2c', { shade: false, ink, paint: cavity, inner: tongue })
  } else if (frontal) {
    // The little "w" under the nose, or a smiling curve.
    const s = x.smile
    const mw = w * (style === 'cat' ? 0.7 : 0.8)
    svg += style === 'cat' || !bodyHead
      ? P.line(`M${f(cx - mw)} ${f(cy - s * R * 0.05)}Q${f(cx - mw * 0.5)} ${f(cy + R * 0.1 + s * R * 0.04)} ${f(cx)} ${f(cy)}Q${f(cx + mw * 0.5)} ${f(cy + R * 0.1 + s * R * 0.04)} ${f(cx + mw)} ${f(cy - s * R * 0.05)}`, bodyHead ? ink : muzzleInk, lw)
      : P.line(`M${f(cx - w * 0.8)} ${f(cy - s * R * 0.08)}Q${f(cx)} ${f(cy + s * R * 0.2)} ${f(cx + w * 0.8)} ${f(cy - s * R * 0.08)}`, ink, lw)
  } else {
    const s = x.smile
    svg += P.line(`M${f(cx - w * 1.2)} ${f(cy + R * 0.02)}Q${f(cx - w * 0.2)} ${f(cy + R * 0.06 + s * R * 0.03)} ${f(cx + w * 0.35)} ${f(cy - R * 0.02)}M${f(cx - w * 1.2)} ${f(cy + R * 0.02)}q${f(-R * 0.06)} ${f(-s * R * 0.1)} ${f(-R * 0.1)} ${f(-s * R * 0.12)}`, ink, lw)
  }
  if (style === 'fangs' || style === 'jaws' || style === 'tusks') {
    const n = style === 'jaws' ? 5 : 1
    let d = ''
    const th = R * (style === 'jaws' ? 0.1 : 0.13)
    for (let i = 0; i < n; i++) {
      const tx = frontal ? cx + (n === 1 ? -w * 0.42 : lerp(-w * 0.7, w * 0.7, i / (n - 1))) : cx - w * (0.9 - i * 0.28)
      d += smooth([[tx - R * 0.038, cy - R * 0.01], [tx + R * 0.038, cy - R * 0.01], [tx + R * 0.01, cy + th * 0.7], [tx, cy + th, 0]])
      if (n === 1 && frontal) d += smooth([[cx + w * 0.42 - R * 0.038, cy - R * 0.01], [cx + w * 0.42 + R * 0.038, cy - R * 0.01], [cx + w * 0.42 + R * 0.01, cy + th * 0.7], [cx + w * 0.42, cy + th, 0]])
    }
    svg += P.shape(d, toothC, { shade: false, outline: 0.45, material: 'gem', spec: 0.3 })
  }
  if (c.sec('face').b('tongue') && open < 0.08) {
    const tg = smooth([[cx - R * 0.085, cy], [cx + R * 0.085, cy], [cx + R * 0.075, cy + R * 0.17], [cx, cy + R * 0.23], [cx - R * 0.075, cy + R * 0.17]])
    svg += P.shape(tg, '#e0788a', { outline: 0.6, material: 'slime', spec: 0.4, inner: P.detail > 0 ? P.line(`M${f(cx)} ${f(cy + R * 0.03)}L${f(cx)} ${f(cy + R * 0.14)}`, shadowOf('#e0788a', 0.25), R * 0.018, { opacity: 0.7 }) : undefined })
  }
  return svg
}


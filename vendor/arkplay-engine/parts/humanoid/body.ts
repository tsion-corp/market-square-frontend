/* The humanoid body: torso, neck, limbs, feet and hands, drawn from the rig's
 * measurements. Garments are drawn later as offsets of these same outlines, which is
 * why they fit. Outlines are exported (torsoOutline, limb radii) for that purpose.
 *
 * Joints are seamless: a forearm or shin is filled with its round top cap (which covers
 * the joint when the limb bends) but outlined without it, so a straight arm has no
 * "cuff line" at the elbow and a straight leg no "U" at the knee (see `limbShape`). */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { lerp, type P } from '../../core/math.ts'
import { brush, capsule, circle, ellipse, f, heart, roundRect, sampleSmooth, smooth, star, tube, tubePts, type Cap, type SP } from '../../core/path.ts'
import { el, g } from '../../core/svg.ts'
import type { Ctx, PartList, ResolvedItem } from '../../render/context.ts'
import type { ShapeOpts } from '../../render/painter.ts'
import { Z } from '../../render/context.ts'
import type { HumanMeasure, HumanRig } from '../../rig/humanoid.ts'
import type { FrameState, HandShape, Side, View } from '../../render/types.ts'
import { castShadow, crease, creases, knitPaint, rich, ribPaint, sheen, texture, tonal } from '../shared/fabric.ts'

export const skinOf = (c: Ctx): string => c.sec('skin').c('tone', '#d69d78')

/** Torso outline in spine space (hip centre at 0,0), with an optional outward offset. */
export function torsoOutline(m: HumanMeasure, view: View, off = 0, top = 1): SP[] {
  const T = m.torsoLen
  if (view === 'side') {
    const cd = m.chestDepth
    const pts: SP[] = [
      [-m.neckR * 0.85 - off * 0.5, -T * top - 2 - off * 0.3],
      [-cd * 0.52 - off, -T + T * 0.12],
      [-cd * 0.6 - off, -T * 0.58],
      [-m.waistHalf * 0.55 - off, -T * 0.24],
      [-m.buttDepth - off, m.pelvisH * 0.15],
      [-m.buttDepth * 0.72 - off, m.pelvisH * 0.92 + off * 0.5],
      [m.buttDepth * 0.25 + off * 0.5, m.pelvisH + off * 0.5],
      [m.bellyDepth * 0.72 + off, -T * 0.02],
      [m.bellyDepth + off, -T * 0.26],
      [cd * 0.62 + off, -T * 0.52],
      [cd * (0.62 + m.bust * 0.36) + off, -T * 0.7],
      [cd * 0.5 + off, -T * 0.9],
      [m.neckR * 0.8 + off * 0.5, -T * top - 2 - off * 0.3],
    ]
    return pts
  }
  const right: SP[] = [
    [m.neckR * 0.95 + off * 0.4, -T * top - 2 - off * 0.3],
    [lerp(m.neckR, m.shoulderHalf, 0.55) + off * 0.7, -T + T * 0.04 - off * 0.7],
    [m.shoulderHalf * 0.97 + off, -T + T * 0.11],
    [m.chestHalf * 0.99 + off, -T + T * 0.28],
    [m.chestHalf * (1 + m.bust * 0.05) + off, -T + T * 0.42],
    [m.waistHalf + off, -T * 0.36],
    [lerp(m.waistHalf, m.hipHalf, 0.55) + m.belly * m.shoulderHalf * 0.12 + off, -T * 0.15],
    [m.hipHalf + off, m.pelvisH * 0.08],
    [m.hipHalf * 0.93 + off, m.pelvisH * 0.72],
  ]
  const crotch: SP = [0, m.pelvisH * 1.02 + off * 0.6, 0.6]
  const left = right.map(([x, y, k]) => (k === undefined ? [-x, y] : [-x, y, k]) as SP).reverse()
  return [[0, -T * top - 2 - off * 0.3], ...right, crotch, ...left]
}

/** Which bones are "far" in the side view (drawn behind the torso, a touch darker). */
export const isFar = (c: Ctx, side: Side): boolean => c.view === 'side' && side === 'L'

export function limbZ(c: Ctx, side: Side, base: number, arm: boolean): number {
  if (c.view !== 'side') return base
  if (side === 'R') return base
  return (arm ? Z.farArm : Z.farLeg) + (base - (arm ? Z.armUpper : Z.leg)) * 0.1
}

/** Screen-x sign of the inside of a limb (toward the body's midline; forward in side view). */
export function innerSign(c: Ctx, side: Side): number {
  if (c.view === 'side') return 1
  const sx = (c.hr as HumanRig).sx
  return side === 'L' ? -sx : sx
}

const prosthetic = (c: Ctx): { part: string; style: string; color: string } | null => {
  const b = c.sec('body')
  const d = b.s('limbDiff')
  if (!d || d === 'none') return null
  const style = b.s('prosthetic') || 'carbon'
  const color = style === 'metal' ? '#b8bec8' : style === 'colour' ? b.c('prostheticColor', '#39a0ed') : '#3a3d45'
  return { part: d, style, color }
}

export function hasProsthetic(c: Ctx, limb: 'arm' | 'leg', side: Side): boolean {
  const p = prosthetic(c)
  return !!p && p.part === `${limb}-${side.toLowerCase()}`
}

/** Detail unit: stitch widths, crease widths (independent of the outline weight). */
export const detailUnit = (m: HumanMeasure): number => m.headH * 0.012

/* ---- Seamless limbs ------------------------------------------------------------------ */

/**
 * A limb piece that continues another at a joint: `fill` is the full brush (round start cap,
 * which fills the joint when it bends) and `edge` is the outline without the start cap.
 */
export function limbPaths(points: P[], w0: number, w1: number, bulge = 0, capEnd: Cap = 'round'): { fill: string; edge: string } {
  const dense = points.length < 5 ? sampleSmooth(points, false, 4) : points
  const radii = dense.map((_, i) => {
    const t = i / (dense.length - 1)
    return Math.max(0, lerp(w0, w1, t) / 2 + Math.sin(t * Math.PI) * bulge * 0.5)
  })
  return { fill: tube(dense, radii, 'round', capEnd), edge: smooth(tubePts(dense, radii, 'flat', capEnd), false) }
}

/**
 * A limb piece that another piece continues at its end: `fill` has both caps round and
 * `edge` is its outline without the end cap (the joint).
 */
export function upperLimbPaths(points: P[], w0: number, w1: number, bulge = 0): { fill: string; edge: string } {
  const dense = points.length < 5 ? sampleSmooth(points, false, 4) : points
  const n = dense.length
  const radii = dense.map((_, i) => {
    const t = i / (n - 1)
    return Math.max(0, lerp(w0, w1, t) / 2 + Math.sin(t * Math.PI) * bulge * 0.5)
  })
  // tubePts with a flat end: left side, right side (reversed), start cap.
  const pts = tubePts(dense, radii, 'round', 'flat')
  return { fill: tube(dense, radii, 'round', 'round'), edge: smooth([...pts.slice(n, n * 2), ...pts.slice(n * 2), ...pts.slice(0, n)], false) }
}

/**
 * Paints a limb piece with an open outline `edge` (no stroke across the joint it shares
 * with the next piece). No clip paths: a clipped layer that a crop leaves empty can crash
 * resvg. In baked stills a copy nudged away from the light thickens the shadow side, like
 * the Painter's own weighted outlines.
 */
export function limbShape(c: Ctx, piece: { fill: string; edge: string }, color: string, o: ShapeOpts = {}): string {
  const P = c.paint
  const lw = P.lw * (typeof o.outline === 'number' ? o.outline : o.outline === false ? 0 : 1)
  const ink = o.ink ?? P.ink(color)
  const stroke = (w: number, dx = 0, dy = 0) => el('path', { d: piece.edge, fill: 'none', stroke: ink, 'stroke-width': f(w), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', transform: dx || dy ? `translate(${f(dx)} ${f(dy)})` : undefined })
  const L = P.style.light
  const under = c.baked && lw > 0 && P.detail > 0 ? stroke(lw * 0.9, -L[0] * lw * 0.45, -L[1] * lw * 0.45) : ''
  return under + P.shape(piece.fill, color, { offset: 0.14, ...o, outline: false }) + (lw > 0 ? stroke(c.baked ? lw * 0.88 : lw) : '')
}

/** Warm tint for knees, elbows and knuckles (skin reads thinner there). */
const warm = (skin: string): string => mix(skin, '#e0645c', 0.35)

/** A soft (radial-gradient) ellipse of `color`: warmth and glows with no hard edge. */
function softSpot(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, opacity: number): string {
  return `<g transform="translate(${f(cx)} ${f(cy)}) scale(${f(rx)} ${f(ry)})">${c.paint.glow(0, 0, 1, color, opacity)}</g>`
}

/* Limb geometry depends only on the measurements, and left and right limbs share it:
 * computed once per avatar. */
const geoCache = new WeakMap<HumanMeasure, Map<string, string>>()
export function memoGeo(m: HumanMeasure, key: string, make: () => string): string {
  let cache = geoCache.get(m)
  if (!cache) geoCache.set(m, (cache = new Map()))
  let d = cache.get(key)
  if (d === undefined) cache.set(key, (d = make()))
  return d
}

/** The whole arm as one tube in the local space of its upper or lower piece (for `shadeFrom`).
 *  Shading only needs the limb's broad form: a tapered capsule is enough (and tiny). */
export function armTube(m: HumanMeasure, piece: 'upper' | 'lower', off = 0): string {
  return memoGeo(m, `arm${piece}${off}`, () =>
    piece === 'upper'
      ? capsule([0, -m.armR * 0.2], [0, m.upperArm + m.forearm], m.armR + off, m.wristR + off)
      : capsule([0, -m.upperArm], [0, m.forearm], m.armR + off, m.wristR + off),
  )
}

/** The whole leg as one tube in the local space of its upper or lower piece (for `shadeFrom`). */
export function legTube(m: HumanMeasure, piece: 'upper' | 'lower', off = 0): string {
  return memoGeo(m, `leg${piece}${off}`, () =>
    piece === 'upper'
      ? capsule([0, -m.thighR * 0.3], [0, m.thigh + m.shin], m.thighR + off, m.ankleR + off)
      : capsule([0, -m.thigh], [0, m.shin], m.thighR + off, m.ankleR + off),
  )
}

/** `shadeFrom` for a limb piece: baked stills only (animation frames keep the cheaper per-piece shading). */
const flowFrom = (c: Ctx, d: string): string | undefined => (c.baked ? d : undefined)

/** The bare forearm and thigh as fill + open outline (also used by the garments' cast shadows). */
const forearmPoints = (m: HumanMeasure): [P[], number, number, number] => [[[0, 0], [0, m.forearm * 0.35], [0, m.forearm]], m.elbowR * 2, m.wristR * 2, m.muscle * m.elbowR * 0.35 + m.elbowR * 0.08]
const thighPoints = (m: HumanMeasure): [P[], number, number, number] => [[[0, 0], [0, m.thigh * 0.5], [0, m.thigh]], m.thighR * 2, m.kneeR * 2, m.thighR * 0.12]
const skinForearmPaths = (m: HumanMeasure): { fill: string; edge: string } => ({
  fill: memoGeo(m, 'skinForearm', () => limbPaths(...forearmPoints(m)).fill),
  edge: memoGeo(m, 'skinForearmEdge', () => limbPaths(...forearmPoints(m)).edge),
})
const skinThighPaths = (m: HumanMeasure): { fill: string; edge: string } => ({
  fill: memoGeo(m, 'skinThigh', () => upperLimbPaths(...thighPoints(m)).fill),
  edge: memoGeo(m, 'skinThighEdge', () => upperLimbPaths(...thighPoints(m)).edge),
})
export const skinForearm = (m: HumanMeasure): string => skinForearmPaths(m).fill
export const skinThigh = (m: HumanMeasure): string => skinThighPaths(m).fill

/* ---- Static body -------------------------------------------------------- */

export function bodyGen(c: Ctx, out: PartList): void {
  const hr = c.hr as HumanRig
  const m = hr.m
  const skin = skinOf(c)
  const P = c.paint
  const far = shadowOf(skin, 0.07)
  const pro = prosthetic(c)
  const u = detailUnit(m)
  const T = m.torsoLen
  const baked = rich(c)

  // Torso (always drawn; garments cover it).
  out.add('spine', Z.body, 'torso', P.shape(smooth(torsoOutline(m, c.view)), skin, { offset: 0.1 }))
  if (c.view === 'front' && P.detail > 1) {
    // Collarbones, the notch between them and the navel read through low-cut or cropped tops.
    const cbL: P[] = [[-m.neckR * 1.15, -T + T * 0.055], [-m.shoulderHalf * 0.42, -T + T * 0.09], [-m.shoulderHalf * 0.74, -T + T * 0.06]]
    const cbR = cbL.map(([x, y]) => [-x, y] as P)
    let det = ''
    if (tonal(c) && baked) {
      det += creases(c, [{ pts: cbL, w: u * 1.1 }, { pts: cbR, w: u * 1.1 }, { pts: [[-m.neckR * 0.4, -T + T * 0.015], [0, -T + T * 0.075], [m.neckR * 0.4, -T + T * 0.015]], w: u * 0.9 }], skin, 1.1)
      if (baked) det += P.flat(ellipse(0, -T * 0.2, u * 0.55, u * 0.85), shadowOf(skin, 0.35), 0.7) + P.flat(ellipse(0, -T * 0.2 + u * 0.55, u * 0.4, u * 0.25), highlightOf(skin, 0.2), 0.5)
      if (baked && m.muscle > 0.55) det += crease(c, [[0, -T * 0.56], [0, -T * 0.4], [0, -T * 0.26]], u * 0.8 * m.muscle, skin, 0.8, false)
    } else {
      const cb = `M${f(cbL[0][0])} ${f(cbL[0][1])}Q${f(cbL[1][0])} ${f(cbL[1][1])} ${f(cbL[2][0])} ${f(cbL[2][1])}M${f(cbR[0][0])} ${f(cbR[0][1])}Q${f(cbR[1][0])} ${f(cbR[1][1])} ${f(cbR[2][0])} ${f(cbR[2][1])}`
      det += P.line(cb, shadowOf(skin, 0.18), P.lw * 0.6, { opacity: 0.6 })
    }
    out.add('spine', Z.body + 1, 'collarbones', det)
  }

  // Neck, with the shadow the jaw casts on it.
  const nr = m.neckR
  const top = -m.neckLen - m.headH * 0.14
  const neckD = smooth([[-nr, m.torsoLen * 0.04], [-nr * 0.94, top * 0.5], [-nr * 0.9, top], [nr * 0.9, top], [nr * 0.94, top * 0.5], [nr, m.torsoLen * 0.04]], true)
  const neckSide = c.view === 'side' ? g({ transform: `translate(${m.chestDepth * 0.02} 0)` }, P.shape(neckD, skin, { shade: 0.6 })) : P.shape(neckD, skin, { shade: 0.6 })
  let jawShadow = ''
  if (c.view !== 'back') {
    const clip = c.defs.unique('nk')
    c.defs.put(clip, el('clipPath', { id: clip }, el('path', { d: neckD })))
    const jawY = -m.neckLen - m.headH * 0.02
    const jx = c.view === 'side' ? nr * 0.35 : 0
    if (c.baked && tonal(c)) {
      // Baked, shaded stills: the compositor lays the chin's contact shadow on the neck; keep
      // only a faint cel edge so the jaw line still reads in flat-lit scenes. (Flat shading
      // gets no contact shadows, so it keeps the drawn one below.)
      jawShadow = g({ 'clip-path': `url(#${clip})` }, P.flat(ellipse(jx, jawY, nr * 1.5, m.headH * 0.12), shadowOf(skin, 0.2), 0.16))
    } else {
      jawShadow = g({ 'clip-path': `url(#${clip})` }, P.flat(ellipse(jx, jawY, nr * 1.5, m.headH * 0.14), shadowOf(skin, 0.2), 0.55))
    }
  }
  let neckDet = ''
  if (baked && tonal(c) && c.view === 'front' && m.neckLen > nr * 0.9) {
    // Neck muscles converging on the notch between the collarbones.
    const y0 = -m.neckLen * 0.55
    neckDet = creases(c, [{ pts: [[-nr * 0.7, y0], [-nr * 0.45, -m.neckLen * 0.2], [-nr * 0.2, m.torsoLen * 0.02]], w: u * 0.7 }, { pts: [[nr * 0.7, y0], [nr * 0.45, -m.neckLen * 0.2], [nr * 0.2, m.torsoLen * 0.02]], w: u * 0.7 }], skin, 0.6, false)
  }
  out.add('neck', Z.neck, 'neck', neckSide + jawShadow + neckDet)

  // Arms.
  for (const side of ['L', 'R'] as const) {
    const tint = isFar(c, side) ? far : skin
    const ins = innerSign(c, side)
    const upper = memoGeo(m, 'skinUpperArm', () => brush([[0, 0], [0, m.upperArm * 0.5], [0, m.upperArm]], m.armR * 2, m.elbowR * 2, m.muscle * m.armR * 0.55))
    // Each piece is shaded as part of one continuous arm, so the elbow shows no seam.
    let up = P.shape(upper, tint, { offset: 0.16, shadeFrom: flowFrom(c, armTube(m, 'upper')) })
    if (baked && m.muscle > 0.4 && c.view !== 'side') {
      // Deltoid and bicep separation on muscular builds.
      const o = -ins
      up += creases(c, [{ pts: [[o * m.armR * 0.95, m.upperArm * 0.14], [o * m.armR * 0.7, m.upperArm * 0.3], [o * m.armR * 0.25, m.upperArm * 0.42]], w: u * 0.9 * m.muscle }], tint, 0.7, false)
    }
    out.add(`upperArm${side}`, limbZ(c, side, Z.armUpper, true), `arm-upper-${side}`, up)
    const proArm = pro && pro.part === `arm-${side.toLowerCase()}`
    if (proArm) {
      out.add(`forearm${side}`, limbZ(c, side, Z.armLower, true), `arm-lower-${side}`, prostheticArm(c, m, pro!.style, pro!.color))
    } else {
      // The forearm lies over the upper arm (it swings in front of it in poses), outlined
      // without its top cap so a straight arm has no line at the elbow.
      let low = limbShape(c, skinForearmPaths(m), tint, { offset: 0.16, material: 'skin', shadeFrom: flowFrom(c, armTube(m, 'lower')) })
      if (tonal(c) && P.detail > 0) {
        if (c.view === 'back') {
          // The point of the elbow, a little pinker.
          if (baked) low += softSpot(c, 0, m.elbowR * 0.1, m.elbowR * 0.7, m.elbowR * 0.6, warm(tint), 0.5)
          low += creases(c, [{ pts: [[-m.elbowR * 0.35, m.elbowR * 0.05], [0, m.elbowR * 0.25], [m.elbowR * 0.35, m.elbowR * 0.05]], w: u * 0.7 }], tint, 0.7, false)
        } else {
          // The crease inside the elbow.
          low += crease(c, [[ins * m.elbowR * 0.85, -m.elbowR * 0.1], [ins * m.elbowR * 0.45, m.elbowR * 0.18], [ins * m.elbowR * 0.05, m.elbowR * 0.12]], u * 0.85, tint, 0.8, false)
        }
      }
      out.add(`forearm${side}`, limbZ(c, side, Z.armLower, true), `arm-lower-${side}`, low)
    }
  }

  // Legs.
  const shoes = c.item('shoes')
  const bareFeet = !shoes || shoes.art === 'sandals'
  for (const side of ['L', 'R'] as const) {
    const tint = isFar(c, side) ? far : skin
    // The thigh lies over the shin, outlined without its knee cap: straight, the shin's top
    // is hidden under it (no line, no lit dome at the knee); bent, the shin's outline rounds
    // the outer knee.
    out.add(`thigh${side}`, limbZ(c, side, Z.leg, false), `leg-upper-${side}`, limbShape(c, skinThighPaths(m), tint, { shadeFrom: flowFrom(c, legTube(m, 'upper')) }) + kneeDetail(c, m, tint, u, baked, m.thigh))
    const proLeg = pro && pro.part === `leg-${side.toLowerCase()}`
    if (proLeg) {
      out.add(`shin${side}`, limbZ(c, side, Z.leg, false), `leg-lower-${side}`, prostheticLeg(c, m, pro!.style, pro!.color))
    } else {
      const shin = memoGeo(m, `skinShin${c.view}`, () => shinPaths(m, c.view).fill)
      const sh = P.shape(shin, tint, { offset: 0.14, material: 'skin', shadeFrom: flowFrom(c, legTube(m, 'lower')) })
      out.add(`shin${side}`, limbZ(c, side, Z.leg - 0.5, false), `leg-lower-${side}`, sh)
      if (!c.hides('feet')) {
        const foot = bareFeet ? bareFoot(c, m, side, tint, u) : P.shape(footShape(m, c.view), tint, { offset: 0.12 })
        out.add(`foot${side}`, limbZ(c, side, Z.leg + 1, false), `foot-${side}`, foot)
      }
    }
  }

  bodyArt(c, out, m)
}

/** The lower leg: a plain taper from the front, a calf that swells at the back in profile. */
function shinPaths(m: HumanMeasure, view: View): { fill: string; edge: string } {
  if (view !== 'side') return limbPaths([[0, 0], [0, m.shin * 0.3], [0, m.shin]], m.kneeR * 2, m.ankleR * 2, m.kneeR * (0.25 + m.muscle * 0.2))
  const k = m.kneeR
  const a = m.ankleR
  const calf = k * (0.12 + m.muscle * 0.14)
  const back: SP[] = [[-k * 0.92, 0], [-k * 1.02 - calf, m.shin * 0.28], [-a * 1.25, m.shin * 0.72], [-a * 0.98, m.shin]]
  const bottom: SP[] = [[-a * 0.7, m.shin + a * 0.7], [0, m.shin + a], [a * 0.7, m.shin + a * 0.7]]
  const front: SP[] = [[a * 0.98, m.shin], [a * 1.05, m.shin * 0.7], [k * 0.78, m.shin * 0.22], [k * 0.96, 0]]
  const cap: SP[] = [[k * 0.68, -k * 0.72], [0, -k], [-k * 0.68, -k * 0.72]]
  return { fill: smooth([...back, ...bottom, ...front, ...cap]), edge: smooth([...back, ...bottom, ...front], false) }
}

/** The kneecap, drawn at the foot of the thigh piece (`y0` = the knee in its space). */
function kneeDetail(c: Ctx, m: HumanMeasure, tint: string, u: number, baked: boolean, y0: number): string {
  const s = kneeMarks(c, m, tint, u, baked)
  return s ? `<g transform="translate(0 ${f(y0)})">${s}</g>` : ''
}

function kneeMarks(c: Ctx, m: HumanMeasure, tint: string, u: number, baked: boolean): string {
  if (!tonal(c) || c.paint.detail === 0) return ''
  const k = m.kneeR
  if (c.view === 'back') return creases(c, [{ pts: [[-k * 0.55, k * 0.05], [0, k * 0.18], [k * 0.55, k * 0.05]], w: u * 0.8 }], tint, 0.7, false)
  if (c.view === 'side') {
    let s = crease(c, [[k * 0.35, -k * 0.35], [k * 0.72, k * 0.1], [k * 0.55, k * 0.55]], u * 0.8, tint, 0.7, false)
    if (baked) s += softSpot(c, k * 0.55, 0, k * 0.55, k * 0.65, warm(tint), 0.45)
    return s
  }
  // Front: a soft lower rim under the kneecap and a little warmth.
  let s = crease(c, [[-k * 0.32, k * 0.34], [0, k * 0.44], [k * 0.32, k * 0.34]], u * 0.6, tint, 0.45, false)
  if (baked) s += softSpot(c, 0, k * 0.05, k * 0.7, k * 0.6, warm(tint), 0.4)
  return s
}

/** Bare-foot outline in foot-bone space (ankle at 0,0; ground at y = footH). */
export function footShape(m: HumanMeasure, view: View, grow = 0): string {
  const gy = m.footH + m.ankleR * 0.15
  if (view === 'side') {
    const L = m.footLen
    return smooth([
      [-m.ankleR * 0.8 - grow, -m.ankleR * 0.6],
      [m.ankleR * 0.7 + grow * 0.5, -m.ankleR * 0.5],
      [L * 0.45, gy - m.ankleR * 0.7 - grow],
      [L * 0.72 + grow, gy - m.ankleR * 0.35 - grow * 0.6],
      [L * 0.76 + grow, gy + grow * 0.3, 0.5],
      [-L * 0.2 - grow, gy + grow * 0.3, 0.5],
      [-L * 0.24 - grow, gy - m.ankleR * 0.5],
    ])
  }
  const w = m.ankleR * 1.25 + grow
  return smooth([
    [-w * 0.8, -m.ankleR * 0.5],
    [w * 0.8, -m.ankleR * 0.5],
    [w * 1.1, gy - m.ankleR * 0.45],
    [w * 0.95, gy + grow * 0.3, 0.6],
    [-w * 0.95, gy + grow * 0.3, 0.6],
    [-w * 1.1, gy - m.ankleR * 0.45],
  ])
}

/** A bare foot with toes, ankle bones and (baked) toenails. */
function bareFoot(c: Ctx, m: HumanMeasure, side: Side, tint: string, u: number): string {
  const P = c.paint
  const a = m.ankleR
  const gy = m.footH + a * 0.15
  const nails = c.sec('skin').c('nails', '')
  const nailC = nails || mix(tint, '#ffffff', 0.4)
  const baked = rich(c)
  if (c.view === 'side') {
    const L = m.footLen
    const foot = smooth([
      [-a * 0.85, -a * 0.6],
      [a * 0.72, -a * 0.52],
      [L * 0.34, gy - a * 0.74],
      [L * 0.6, gy - a * 0.46],
      [L * 0.73, gy - a * 0.34],
      [L * 0.8, gy - a * 0.12],
      [L * 0.75, gy, 0.6],
      [L * 0.44, gy - a * 0.03],
      [L * 0.16, gy - a * 0.1],
      [-L * 0.1, gy, 0.7],
      [-L * 0.23, gy - a * 0.32],
      [-L * 0.17, gy - a * 0.78],
    ])
    let s = P.shape(foot, tint, { offset: 0.12 })
    if (P.detail > 0) s += P.line(`M${f(L * 0.6)} ${f(gy - a * 0.32)}Q${f(L * 0.66)} ${f(gy - a * 0.12)} ${f(L * 0.66)} ${f(gy - a * 0.02)}`, P.ink(tint), Math.max(u * 0.35, P.lw * 0.5), { opacity: 0.7 })
    if (tonal(c)) s += crease(c, [[-a * 0.3, -a * 0.05], [0, a * 0.18], [a * 0.3, -a * 0.05]], u * 0.7, tint, 0.6, false)
    if (baked || (nails && P.detail > 1)) s += P.flat(ellipse(L * 0.74, gy - a * 0.26, a * 0.14, a * 0.1), nailC, nails ? 0.95 : 0.55)
    if (baked) s += softSpot(c, -L * 0.12, gy - a * 0.25, a * 0.5, a * 0.35, warm(tint), 0.45)
    return s
  }
  const w = a * 1.25
  if (c.view === 'back') {
    const heel = smooth([[-w * 0.72, -a * 0.55], [w * 0.72, -a * 0.55], [w * 0.92, gy * 0.6], [w * 0.8, gy, 0.6], [-w * 0.8, gy, 0.6], [-w * 0.92, gy * 0.6]])
    let s = P.shape(heel, tint, { offset: 0.12 })
    if (tonal(c)) s += creases(c, [{ pts: [[-w * 0.22, -a * 0.5], [-w * 0.18, gy * 0.35]], w: u * 0.6 }, { pts: [[w * 0.22, -a * 0.5], [w * 0.18, gy * 0.35]], w: u * 0.6 }], tint, 0.6, false)
    if (baked) s += softSpot(c, 0, gy * 0.72, w * 0.7, gy * 0.3, warm(tint), 0.45)
    return s
  }
  // Front: the big toe on the inside, four smaller ones stepping away from it.
  const ins = innerSign(c, side)
  const k = (x: number) => x * ins
  const foot = smooth([[k(-w * 0.72), -a * 0.55], [k(w * 0.74), -a * 0.55], [k(w * 1.06), gy * 0.5], [k(w * 1.1), gy - a * 0.25], [k(w * 0.95), gy, 0.6], [k(-w * 0.95), gy, 0.6], [k(-w * 1.08), gy - a * 0.3], [k(-w * 0.98), gy * 0.5]])
  const toeX = [0.7, 0.28, -0.08, -0.4, -0.7]
  const toeR = [0.3, 0.22, 0.2, 0.18, 0.15]
  const toes = toeX.map((x, i) => circle(k(x * w), gy - toeR[i] * w * 0.8, toeR[i] * w))
  let s = P.union([foot, ...toes], tint, { offset: 0.12 })
  if (P.detail > 0) {
    let lines = ''
    for (let i = 0; i < 4; i++) {
      const x = k(((toeX[i] - toeR[i] * 0.95) + (toeX[i + 1] + toeR[i + 1] * 0.95)) * 0.5 * w)
      lines += `M${f(x)} ${f(gy - toeR[i + 1] * w * 1.5)}V${f(gy - toeR[i + 1] * w * 0.3)}`
    }
    s += P.line(lines, P.ink(tint), Math.max(u * 0.3, P.lw * 0.45), { opacity: 0.6 })
  }
  if (tonal(c)) {
    s += creases(c, [{ pts: [[k(w * 0.78), -a * 0.1], [k(w * 0.62), a * 0.1], [k(w * 0.5), -a * 0.05]], w: u * 0.7 }, { pts: [[k(-w * 0.8), a * 0.02], [k(-w * 0.66), a * 0.2], [k(-w * 0.52), a * 0.08]], w: u * 0.6 }], tint, 0.6, false)
  }
  if (baked || (nails && P.detail > 1)) s += P.flat(toeX.map((x, i) => ellipse(k(x * w), gy - toeR[i] * w * 1.15, toeR[i] * w * 0.5, toeR[i] * w * 0.4)).join(''), nailC, nails ? 0.95 : 0.5)
  return s
}

function prostheticArm(c: Ctx, m: HumanMeasure, style: string, color: string): string {
  const P = c.paint
  const socket = capsule([0, 0], [0, m.forearm * 0.35], m.elbowR * 1.08, m.wristR * 1.05)
  const rodC = style === 'metal' ? '#9aa1ab' : style === 'colour' ? '#b8bec8' : '#4a4e58'
  const rod = capsule([0, m.forearm * 0.3], [0, m.forearm], m.wristR * 0.55, m.wristR * 0.5)
  const joint = circle(0, m.forearm, m.wristR * 0.6)
  let s = P.shape(rod, rodC, { gloss: true })
  if (rich(c)) s += sheen(c, [[-m.wristR * 0.2, m.forearm * 0.4], [-m.wristR * 0.22, m.forearm * 0.9]], m.wristR * 0.28, rodC, 1.2)
  s += prostheticShell(c, socket, color, style, [[-m.elbowR * 0.5, m.forearm * 0.02], [-m.elbowR * 0.55, m.forearm * 0.3]], m.elbowR)
  if (P.detail > 1) s += P.line(`M${f(-m.wristR * 1.0)} ${f(m.forearm * 0.28)}Q0 ${f(m.forearm * 0.33)} ${f(m.wristR * 1.0)} ${f(m.forearm * 0.28)}`, shadowOf(color, 0.4), m.wristR * 0.12, { opacity: 0.8 })
  return s + P.shape(joint, shadowOf(color, 0.2), { gloss: P.detail > 1 })
}

/** A socket shell: carbon weave, brushed metal or glossy colour, with a sheen streak. */
function prostheticShell(c: Ctx, d: string, color: string, style: string, streak: P[], r: number): string {
  const P = c.paint
  let s = P.shape(d, color, { gloss: style === 'colour' })
  if (rich(c)) {
    if (style === 'carbon' || style === 'blade') s += texture(d, carbonPaint(c, color, r * 0.35))
    s += sheen(c, streak, r * (style === 'metal' ? 0.45 : 0.3), color, style === 'carbon' ? 0.9 : 1.3)
  }
  return s
}

/** Carbon-fibre weave: a small checker of lighter and darker diagonal threads. */
function carbonPaint(c: Ctx, color: string, s: number): string {
  const base = c.paint.col(color)
  const hl = highlightOf(base, 0.25)
  const sz = Math.max(1, s)
  const id = c.defs.add(`cf${hl.slice(1)}${Math.round(sz * 10)}`, (pid) =>
    el(
      'pattern',
      { id: pid, width: f(sz), height: f(sz), patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      el('rect', { width: f(sz / 2), height: f(sz / 2), fill: hl, 'fill-opacity': 0.28 }),
      el('rect', { x: f(sz / 2), y: f(sz / 2), width: f(sz / 2), height: f(sz / 2), fill: hl, 'fill-opacity': 0.28 }),
    ),
  )
  return `url(#${id})`
}

function prostheticLeg(c: Ctx, m: HumanMeasure, style: string, color: string): string {
  const P = c.paint
  const socket = capsule([0, 0], [0, m.shin * 0.35], m.kneeR * 1.1, m.kneeR * 0.8)
  const streak: P[] = [[-m.kneeR * 0.55, m.shin * 0.02], [-m.kneeR * 0.5, m.shin * 0.3]]
  if (style === 'blade') {
    const pts: P[] = [[0, m.shin * 0.3], [m.ankleR * 0.3, m.shin * 0.7], [m.ankleR * 1.4, m.shin + m.footH * 0.2], [m.footLen * 0.5, m.shin + m.footH + m.ankleR * 0.2]]
    const blade = brush(pts, m.ankleR * 0.9, m.ankleR * 0.5)
    let s = P.shape(blade, '#2c2f36', { gloss: true })
    if (rich(c)) {
      s += texture(blade, carbonPaint(c, '#2c2f36', m.ankleR * 0.3))
      s += sheen(c, [[-m.ankleR * 0.1, m.shin * 0.4], [m.ankleR * 0.35, m.shin * 0.72], [m.ankleR * 1.1, m.shin + m.footH * 0.05]], m.ankleR * 0.22, '#2c2f36', 1.3)
    }
    // Tread pad under the toe of the blade.
    if (P.detail > 0) s += P.shape(brush([[m.footLen * 0.18, m.shin + m.footH + m.ankleR * 0.35], [m.footLen * 0.5, m.shin + m.footH + m.ankleR * 0.3]], m.ankleR * 0.3, m.ankleR * 0.3), '#1b1c20', { shade: false })
    return s + prostheticShell(c, socket, color, style, streak, m.kneeR)
  }
  const rod = capsule([0, m.shin * 0.3], [0, m.shin], m.ankleR * 0.45, m.ankleR * 0.45)
  const foot = footShape(m, c.view, 1)
  let s = P.shape(rod, '#9aa1ab', { gloss: true })
  if (rich(c)) s += sheen(c, [[-m.ankleR * 0.15, m.shin * 0.42], [-m.ankleR * 0.15, m.shin * 0.92]], m.ankleR * 0.22, '#9aa1ab', 1.3)
  // Pylon clamp rings.
  if (P.detail > 1) s += P.shape(roundRect(-m.ankleR * 0.62, m.shin * 0.84, m.ankleR * 1.24, m.ankleR * 0.45, m.ankleR * 0.12), shadowOf('#9aa1ab', 0.15), { shade: 0.5, outline: 0.6 })
  s += prostheticShell(c, socket, color, style, streak, m.kneeR)
  return s + `<g transform="translate(0 ${f(m.shin)})">${P.shape(foot, color)}${rich(c) ? sheen(c, [[-m.ankleR * 0.4, -m.ankleR * 0.2], [m.ankleR * 0.3, -m.ankleR * 0.3]], m.ankleR * 0.2, color, 0.8) : ''}</g>`
}

function bodyArt(c: Ctx, out: PartList, m: HumanMeasure): void {
  const skin = c.sec('skin')
  const art = skin.s('bodyArt')
  if (!art || art === 'none') return
  const col = skin.c('bodyArtColor', '#2c3e66')
  const P = c.paint
  const side: Side = 'L'
  if (c.view === 'side' && side === 'L') return
  const r = m.armR
  const y = m.upperArm * 0.55
  // Ink sits in the skin: a touch of the skin colour keeps it from looking like a sticker.
  const ink = mix(col, skinOf(c), 0.15)
  let d = ''
  switch (art) {
    case 'band':
      d = `M${-r} ${y - r * 0.25}Q0 ${y + r * 0.1} ${r} ${y - r * 0.25}M${-r} ${y + r * 0.2}Q0 ${y + r * 0.55} ${r} ${y + r * 0.2}`
      out.add(`upperArm${side}`, Z.armUpper + 0.5, 'tattoo', P.line(d, ink, r * 0.18, { opacity: 0.85 }))
      return
    case 'sleeve': {
      const lines: string[] = []
      for (let i = 0; i < 5; i++) {
        const yy = m.upperArm * (0.2 + i * 0.16)
        lines.push(`M${-r * 0.9} ${yy}Q${-r * 0.2} ${yy - r * 0.5} ${r * 0.1} ${yy}T${r * 0.9} ${yy - r * 0.2}`)
      }
      out.add(`upperArm${side}`, Z.armUpper + 0.5, 'tattoo', P.line(lines.join(''), ink, r * 0.13, { opacity: 0.8 }))
      return
    }
    case 'stars':
      d = star(-r * 0.2, y - r * 0.4, r * 0.32, r * 0.14) + star(r * 0.3, y + r * 0.3, r * 0.22, r * 0.1)
      break
    case 'heart':
      d = heart(0, y, r * 0.4)
      break
    case 'tribal':
      d = brush([[-r * 0.7, y - r * 0.8], [r * 0.3, y - r * 0.2], [-r * 0.2, y + r * 0.4], [r * 0.6, y + r * 0.9]], r * 0.05, r * 0.3, r * 0.2)
      break
    case 'rose':
      d = circle(0, y, r * 0.3) + brush([[0, y + r * 0.3], [r * 0.2, y + r * 1.0]], r * 0.1, r * 0.06)
      break
    case 'anchor':
      d =
        brush([[0, y - r * 0.6], [0, y + r * 0.5]], r * 0.12, r * 0.12) +
        brush([[-r * 0.5, y + r * 0.2], [0, y + r * 0.6], [r * 0.5, y + r * 0.2]], r * 0.1, r * 0.1) +
        circle(0, y - r * 0.7, r * 0.15)
      break
  }
  if (d) out.add(`upperArm${side}`, Z.armUpper + 0.5, 'tattoo', P.flat(d, ink, 0.85))
}

/* ---- Hands (dynamic: their shape follows the pose and gestures) ---------- */

interface HandGeom {
  /** Pieces that read as one mass (outlined only on the outside). */
  mass: string[]
  /** Pieces in front of the mass with their own outline (a thumb across a fist). */
  over: string[]
  /** Lines between touching fingers. */
  lines: string
  /** Fingertips that show a nail: centre and radius. */
  tips: [number, number, number][]
  /** Knuckle bumps (fist-like shapes) or finger bases (open shapes). */
  knuckles: [number, number][]
  fist: boolean
  /** Palm toward the viewer (wave). */
  palm: boolean
  /** Where the thumb meets the fist (a soft crease). */
  thumbCrease?: P[]
}

function handGeom(m: HumanMeasure, shape: HandShape, t: number): HandGeom {
  // t: +1 when the thumb is toward +x. Fingers point along +y.
  const w = m.wristR * 1.18
  const L = m.handLen
  const fr = w * 0.25
  const kn = L * 0.52
  // Index (thumb side) to pinky.
  const fx = [0.66, 0.22, -0.22, -0.64].map((k) => k * w * t)
  const lens = [0.43, 0.48, 0.45, 0.35].map((k) => k * L)
  const finger = (x: number, len: number, ang = 0): { d: string; tip: [number, number, number] } => {
    const tip: P = [x + Math.sin(ang) * len, kn + Math.cos(ang) * len]
    return { d: capsule([x, kn - fr * 0.6], tip, fr * 1.03, fr * 0.88), tip: [tip[0] + Math.sin(ang) * fr * 0.1, tip[1] + Math.cos(ang) * fr * 0.1, fr * 0.88] }
  }
  const between = (a: number, b: number, y0: number, y1: number) => `M${f((a + b) / 2)} ${f(y0)}L${f((a + b) / 2)} ${f(y1)}`
  switch (shape) {
    case 'open':
    case 'wave': {
      const spread = shape === 'wave' ? 0.2 : 0.09
      const palm = smooth([[-w * 0.86, 0], [w * 0.86, 0], [w * 1.04, kn * 0.55], [w * 1.0, kn + fr * 0.1], [0, kn + fr * 0.4], [-w * 1.0, kn + fr * 0.1], [-w * 1.04, kn * 0.55]])
      const fs = fx.map((x, i) => finger(x * 1.07, lens[i], (i - 1.5) * spread * -t))
      const thumb = capsule([t * w * 0.8, kn * 0.28], [t * w * 1.85, kn * 0.78], fr * 1.2, fr * 0.98)
      let lines = ''
      for (let i = 0; i < 3; i++) {
        const a = fx[i] * 1.07
        const b = fx[i + 1] * 1.07
        const an = (i - 1) * spread * -t
        const len = Math.min(lens[i], lens[i + 1]) * 0.42
        lines += `M${f((a + b) / 2)} ${f(kn + fr * 0.15)}L${f((a + b) / 2 + Math.sin(an) * len)} ${f(kn + Math.cos(an) * len)}`
      }
      return { mass: [palm, ...fs.map((x) => x.d), thumb], over: [], lines, tips: shape === 'wave' ? [] : fs.map((x) => x.tip), knuckles: fx.map((x) => [x * 1.07, kn] as [number, number]), fist: false, palm: shape === 'wave' }
    }
    case 'fist':
    case 'hold': {
      const low = shape === 'hold' ? 1.06 : 1
      const block = smooth([[-w * 0.92, 0], [w * 0.92, 0], [w * 1.12, kn * 0.62], [w * 1.08, kn * 1.02 * low], [w * 0.55, kn * 1.18 * low], [-w * 0.55, kn * 1.18 * low], [-w * 1.08, kn * 1.02 * low], [-w * 1.12, kn * 0.62]])
      const bumps = fx.map((x, i) => circle(x * 1.02, kn * 1.1 * low - (i === 3 ? fr * 0.15 : 0), fr * 1.12))
      let lines = ''
      for (let i = 0; i < 3; i++) lines += between(fx[i] * 1.02, fx[i + 1] * 1.02, kn * 1.0 * low, kn * 1.1 * low + fr * 1.05)
      const thumb = shape === 'hold' ? capsule([t * w * 0.95, kn * 0.38], [-t * w * 0.12, kn * 1.0], fr * 1.18, fr * 0.98) : capsule([t * w * 0.95, kn * 0.32], [t * w * 0.02, kn * 0.92], fr * 1.18, fr * 0.98)
      const tipX = shape === 'hold' ? -t * w * 0.12 : t * w * 0.02
      const tipY = shape === 'hold' ? kn * 1.0 : kn * 0.92
      return { mass: [block, ...bumps], over: [thumb], lines, tips: [[tipX - t * fr * 0.15, tipY, fr * 0.9]], knuckles: fx.map((x, i) => [x * 1.02, kn * 1.1 * low - (i === 3 ? fr * 0.15 : 0)] as [number, number]), fist: true, palm: false, thumbCrease: [[t * w * 0.95, kn * 0.52], [t * w * 0.45, kn * 0.9], [tipX, tipY + fr * 0.9]] }
    }
    case 'point':
    case 'peace':
    case 'thumb': {
      const block = smooth([[-w * 0.92, 0], [w * 0.92, 0], [w * 1.1, kn * 0.62], [w * 1.02, kn * 1.0], [w * 0.5, kn * 1.14], [-w * 0.5, kn * 1.14], [-w * 1.02, kn * 1.0], [-w * 1.1, kn * 0.62]])
      const curled = shape === 'point' ? [1, 2, 3] : shape === 'peace' ? [2, 3] : [0, 1, 2, 3]
      const bumps = curled.map((i) => circle(fx[i] * 1.0, kn * 1.08 - (i === 3 ? fr * 0.15 : 0), fr * 1.1))
      const ext: { d: string; tip: [number, number, number] }[] = []
      if (shape === 'point') ext.push(finger(fx[0] * 0.9, L * 0.6))
      if (shape === 'peace') ext.push(finger(fx[0] * 0.95 + t * w * 0.04, L * 0.58, t * 0.2), finger(fx[1] * 0.95, L * 0.6, -t * 0.14))
      let lines = ''
      for (let i = 0; i < curled.length - 1; i++) lines += between(fx[curled[i]], fx[curled[i + 1]], kn * 0.98, kn * 1.08 + fr)
      if (shape === 'peace') lines += `M${f((fx[0] + fx[1]) * 0.47)} ${f(kn + fr * 0.2)}L${f((fx[0] + fx[1]) * 0.47)} ${f(kn + fr * 0.9)}`
      if (shape === 'thumb') {
        const thumb = capsule([t * w * 0.8, kn * 0.45], [t * w * 1.22, -L * 0.28], fr * 1.25, fr * 1.05)
        return { mass: [block, ...bumps, thumb], over: [], lines, tips: [[t * w * 1.24, -L * 0.28 - fr * 0.2, fr * 1.0]], knuckles: curled.map((i) => [fx[i], kn * 1.08] as [number, number]), fist: true, palm: false }
      }
      const thumb = capsule([t * w * 0.92, kn * 0.36], [t * w * 0.1 - t * (shape === 'peace' ? w * 0.28 : w * 0.12), kn * 0.94], fr * 1.15, fr * 0.96)
      return { mass: [block, ...bumps, ...ext.map((e) => e.d)], over: [thumb], lines, tips: ext.map((e) => e.tip), knuckles: curled.map((i) => [fx[i], kn * 1.08] as [number, number]), fist: true, palm: false }
    }
    case 'relaxed':
    default: {
      // Fingers together and softly curled (foreshortened), the thumb resting alongside.
      const palm = smooth([[-w * 0.86, 0], [w * 0.86, 0], [w * 1.04, kn * 0.6], [w * 0.98, kn + fr * 0.1], [0, kn + fr * 0.35], [-w * 0.98, kn + fr * 0.1], [-w * 1.04, kn * 0.6]])
      const rl = [0.8, 0.84, 0.8, 0.74]
      const fs = fx.map((x, i) => finger(x, lens[i] * rl[i], i === 3 ? -t * 0.05 : 0))
      const thumb = capsule([t * w * 0.82, kn * 0.3], [t * w * 1.1, kn * 1.0], fr * 1.2, fr * 0.95)
      let lines = ''
      for (let i = 0; i < 3; i++) lines += between(fx[i], fx[i + 1], kn + fr * 0.2, kn + Math.min(lens[i] * rl[i], lens[i + 1] * rl[i + 1]) * 0.85)
      return { mass: [palm, ...fs.map((x) => x.d), thumb], over: [], lines, tips: fs.map((x) => x.tip), knuckles: fx.map((x) => [x, kn] as [number, number]), fist: false, palm: false }
    }
  }
}

/** Hand outline pieces as path data: `front` is every piece of the hand in one path. */
export function handPath(m: HumanMeasure, shape: HandShape, t: number): { back: string; front: string } {
  const h = handGeom(m, shape, t)
  return { back: '', front: [...h.mass, ...h.over].join('') }
}

/* Sleeve reach, noted by the garment generator (static) for the hand generator (dynamic),
 * so a long sleeve can cast its shadow onto the back of the hand in baked stills. */
const sleeveNotes = new WeakMap<Ctx, Partial<Record<Side, { reach: number; color: string }>>>()

/** Called by garments: the outermost sleeve on this arm ends at `reach` × forearm length. */
export function noteSleeve(c: Ctx, side: Side, reach: number, color: string): void {
  const n = sleeveNotes.get(c) ?? {}
  const cur = n[side]
  if (!cur || reach >= cur.reach) n[side] = { reach, color }
  sleeveNotes.set(c, n)
}

function drawHand(c: Ctx, m: HumanMeasure, shape: HandShape, t: number, color: string, o: { nails?: string; skin?: boolean; texture?: 'glove' | 'metal' } = {}): string {
  const P = c.paint
  const h = handGeom(m, shape, t)
  const u = detailUnit(m)
  const baked = rich(c)
  let s = P.union(h.mass, color, { offset: 0.12 })
  const inkW = P.lw > 0 ? P.lw * 0.55 : u * 0.35
  if (h.lines && P.detail > 0) s += P.line(h.lines, P.lw > 0 ? P.ink(color) : shadowOf(color, 0.35), inkW, { opacity: 0.85 })
  if (baked && tonal(c)) {
    if (h.fist) {
      // Knuckles catch the light; the skin between them folds.
      const L = P.style.light
      s += P.flat(h.knuckles.map(([x, y]) => ellipse(x + L[0] * u * 0.6, y - m.wristR * 0.18, m.wristR * 0.2, m.wristR * 0.12)).join(''), o.skin ? highlightOf(color, 0.3) : highlightOf(color, 0.4), 0.45)
      if (o.skin) s += P.flat(h.knuckles.map(([x, y]) => ellipse(x, y + m.wristR * 0.12, m.wristR * 0.22, m.wristR * 0.16)).join(''), warm(color), 0.25)
    } else if (h.palm) {
      // Palm lines on a hand turned toward the viewer.
      const w = m.wristR * 1.18
      const kn = m.handLen * 0.52
      s += creases(c, [{ pts: [[-t * w * 0.75, kn * 0.66], [0, kn * 0.58], [t * w * 0.55, kn * 0.74]], w: u * 0.55 }, { pts: [[t * w * 0.5, kn * 0.2], [t * w * 0.35, kn * 0.5], [t * w * 0.1, kn * 0.66]], w: u * 0.5 }], color, 0.7, false)
    } else if (o.skin) {
      s += creases(c, h.knuckles.map(([x, y]) => ({ pts: [[x - m.wristR * 0.18, y + m.wristR * 0.02], [x, y + m.wristR * 0.1], [x + m.wristR * 0.18, y + m.wristR * 0.02]] as P[], w: u * 0.45 })), color, 0.6, false)
    }
  }
  for (const d of h.over) s += P.shape(d, color, { offset: 0.14, outline: 0.9 })
  if (baked && tonal(c) && h.thumbCrease && h.over.length) s += crease(c, h.thumbCrease, u * 0.7, color, 0.7, false)
  // Nails: polish always shows at high detail; natural nails only in baked stills.
  if (o.skin && h.tips.length && P.detail > 1 && (o.nails || baked)) {
    const nailC = o.nails || mix(color, '#ffffff', 0.42)
    s += P.flat(h.tips.map(([x, y, r]) => ellipse(x, y, r * 0.58, r * 0.66)).join(''), nailC, o.nails ? 0.95 : 0.55)
    if (o.nails && baked) s += P.flat(h.tips.map(([x, y, r]) => ellipse(x + P.style.light[0] * r * 0.2, y - r * 0.22, r * 0.2, r * 0.14)).join(''), '#ffffff', 0.6)
  }
  if (o.texture === 'metal' && P.detail > 1) {
    // Finger joints on a mechanical hand.
    s += P.line(h.knuckles.map(([x, y]) => `M${f(x - m.wristR * 0.22)} ${f(y + m.handLen * (h.fist ? 0 : 0.14))}h${f(m.wristR * 0.44)}`).join(''), shadowOf(color, 0.4), u * 0.45, { opacity: 0.8 })
  }
  return s
}

/* A hand's drawing depends only on its side and shape (everything else is static for the
 * model), and animation frames revisit the same few shapes: each is drawn once per model.
 * Its clip ids stay registered in the model's defs, so the cached SVG stays valid. */
const handCache = new WeakMap<Ctx, Map<string, string>>()

export function handsGen(c: Ctx, frame: FrameState, out: PartList): void {
  let cache = handCache.get(c)
  if (!cache) handCache.set(c, (cache = new Map()))
  for (const side of ['L', 'R'] as const) {
    const key = `${side}${frame.hands[side]}`
    let svg = cache.get(key)
    if (svg === undefined) cache.set(key, (svg = drawHandPart(c, frame, side)))
    out.add(`hand${side}`, limbZ(c, side, Z.hand, true), `hand-${side}`, svg)
  }
}

function drawHandPart(c: Ctx, frame: FrameState, side: Side): string {
  const hr = c.hr as HumanRig
  const m = hr.m
  const skin = skinOf(c)
  const nails = c.sec('skin').c('nails', '')
  const glove = c.item('hands')
  const baked = rich(c)
  {
    const t = thumbSign(c, side)
    if (hasProsthetic(c, 'arm', side)) {
      const col = c.sec('body').s('prosthetic') === 'metal' ? '#b8bec8' : '#3a3d45'
      let svg = drawHand(c, m, frame.hands[side] === 'relaxed' ? 'open' : frame.hands[side], t, col, { texture: 'metal' })
      if (baked) svg += sheen(c, [[-t * m.wristR * 0.5, m.handLen * 0.1], [-t * m.wristR * 0.6, m.handLen * 0.45]], m.wristR * 0.3, col, 1.2)
      return svg
    }
    const shape = frame.hands[side]
    const tint = isFar(c, side) ? shadowOf(skin, 0.07) : skin
    let svg = glove ? drawGlove(c, m, glove, shape, t, tint, nails) : drawHand(c, m, shape, t, tint, { nails, skin: true })
    // A long sleeve's shadow on the back of the hand (baked stills; one frame, so the clip is affordable).
    const note = sleeveNotes.get(c)?.[side]
    if (baked && tonal(c) && note && note.reach >= 0.84 && (!glove || glove.art === 'fingerless')) {
      const h = handGeom(m, shape, t)
      const clip = c.defs.unique('hs')
      c.defs.put(clip, el('clipPath', { id: clip }, ...h.mass.map((d) => el('path', { d }))))
      const reachK = Math.min(1, (note.reach - 0.84) / 0.16)
      svg += g({ 'clip-path': `url(#${clip})` }, castShadow(c, `M${f(-m.wristR * 1.05)} 0H${f(m.wristR * 1.05)}V${f(m.handLen * 0.26)}H${f(-m.wristR * 1.05)}Z`, tint, [0.5, 0], [0.5, 1], 0.12 + reachK * 0.18, true))
    }
    return svg
  }
}

function drawGlove(c: Ctx, m: HumanMeasure, glove: ResolvedItem, shape: HandShape, t: number, skin: string, nails: string): string {
  const P = c.paint
  const col = glove.p.c('color', '#26252c')
  const u = detailUnit(m)
  const baked = rich(c)
  const w = m.wristR
  const cuffBand = (color: string, h: number, grow: number) => {
    const d = roundRect(-w * grow, -w * 0.35, w * grow * 2, h, w * 0.18)
    let s = P.shape(d, color, { shade: 0.5 })
    if (baked) s += texture(d, ribPaint(c, color, u * 1.1))
    return s
  }
  switch (glove.art) {
    case 'fingerless': {
      let s = drawHand(c, m, shape, t, skin, { nails, skin: true })
      const kn = m.handLen * 0.52
      const d = smooth([[-w * 1.18, -w * 0.3], [w * 1.18, -w * 0.3], [w * 1.28, kn * 0.6], [w * 1.2, kn * 1.02, 0.6], [w * 0.4, kn * 1.1], [-w * 0.4, kn * 1.1], [-w * 1.2, kn * 1.02, 0.6], [-w * 1.28, kn * 0.6]])
      s += P.shape(d, col, { offset: 0.14 })
      if (P.detail > 1) s += P.line(`M${f(-w * 1.05)} ${f(kn * 0.98)}Q0 ${f(kn * 1.12)} ${f(w * 1.05)} ${f(kn * 0.98)}`, shadowOf(col, 0.35), u * 0.5, { opacity: 0.7 })
      if (baked) s += sheen(c, [[-w * 0.6, kn * 0.15], [-w * 0.7, kn * 0.7]], w * 0.3, col, 0.7)
      return s + cuffBand(shadowOf(col, 0.1), w * 0.55, 1.2)
    }
    case 'mittens': {
      const kn = m.handLen * 0.52
      const body = smooth([[-w * 1.15, -w * 0.2], [w * 1.15, -w * 0.2], [w * 1.35, kn * 0.8], [w * 1.2, m.handLen * 0.95], [0, m.handLen * 1.1], [-w * 1.2, m.handLen * 0.95], [-w * 1.35, kn * 0.8]])
      const thumb = capsule([t * w * 1.0, kn * 0.35], [t * w * 1.75, kn * 0.95], w * 0.42, w * 0.36)
      let s = P.union([body, thumb], col, { offset: 0.12 })
      if (baked) s += texture(body, knitPaint(c, col, u * 1.3))
      if (P.detail > 1) s += P.line(`M${f(t * w * 0.75)} ${f(kn * 0.5)}Q${f(t * w * 1.05)} ${f(kn * 0.95)} ${f(t * w * 1.3)} ${f(kn * 1.12)}`, shadowOf(col, 0.35), u * 0.45, { opacity: 0.6 })
      return s + cuffBand(glove.p.c('color2', '#f5f2eb'), w * 0.75, 1.32)
    }
    case 'boxing': {
      const L = m.handLen
      const body = smooth([[-w * 1.3, 0], [w * 1.3, 0], [w * 1.8, L * 0.45], [w * 1.6, L * 1.1], [0, L * 1.28], [-w * 1.6, L * 1.1], [-w * 1.8, L * 0.45]])
      const thumb = capsule([t * w * 1.3, L * 0.3], [t * w * 1.55, L * 0.72], w * 0.5, w * 0.45)
      let s = P.shape(body, col, { gloss: true, offset: 0.12 }) + P.shape(thumb, col, { outline: 0.9 })
      if (baked) s += sheen(c, [[-w * 0.9, L * 0.35], [-w * 0.6, L * 0.85]], w * 0.5, col, 1.1)
      s += P.shape(roundRect(-w * 1.25, -w * 0.9, w * 2.5, w * 1.2, w * 0.3), shadowOf(col, 0.08), { shade: 0.5 })
      if (P.detail > 1) s += P.line(`M${f(-w * 0.4)} ${f(-w * 0.75)}L${f(w * 0.4)} ${f(-w * 0.45)}M${f(w * 0.4)} ${f(-w * 0.75)}L${f(-w * 0.4)} ${f(-w * 0.45)}`, '#f5f2eb', u * 0.5)
      return s
    }
    case 'gauntlets': {
      const metal = glove.p.c('color', '#b0bec5')
      let s = drawHand(c, m, shape, t, metal, { texture: 'metal' })
      if (baked) s += sheen(c, [[-t * w * 0.4, m.handLen * 0.08], [-t * w * 0.55, m.handLen * 0.4]], w * 0.3, metal, 1.3)
      const cuff = smooth([[-w * 1.3, -m.forearm * 0.25], [w * 1.3, -m.forearm * 0.25], [w * 1.55, w * 0.3], [-w * 1.55, w * 0.3]])
      s += P.shape(cuff, metal, { gloss: true })
      if (P.detail > 1) s += P.line(`M${f(-w * 1.35)} ${f(-m.forearm * 0.08)}L${f(w * 1.35)} ${f(-m.forearm * 0.08)}`, shadowOf(metal, 0.4), u * 0.55)
      if (baked) s += sheen(c, [[-w * 0.8, -m.forearm * 0.2], [-w * 0.95, w * 0.1]], w * 0.35, metal, 1.4)
      return s
    }
    default: {
      // Plain gloves: the hand in the glove colour, a cuff, stitched points on the back.
      let s = drawHand(c, m, shape, t, col)
      if (baked) s += sheen(c, [[-t * w * 0.5, m.handLen * 0.1], [-t * w * 0.6, m.handLen * 0.42]], w * 0.28, col, 0.8)
      if (P.detail > 1 && shape !== 'wave') s += P.line(`M${f(-w * 0.35)} ${f(m.handLen * 0.12)}v${f(m.handLen * 0.24)}M0 ${f(m.handLen * 0.12)}v${f(m.handLen * 0.26)}M${f(w * 0.35)} ${f(m.handLen * 0.12)}v${f(m.handLen * 0.24)}`, shadowOf(col, 0.3), u * 0.35, { opacity: 0.6 })
      return s + cuffBand(shadowOf(col, 0.05), w * 0.55, 1.18)
    }
  }
}

/** Sign of the thumb direction for a hand in the current view. */
export function thumbSign(c: Ctx, side: Side): number {
  const hr = c.hr as HumanRig
  if (c.view === 'side') return 1
  // Thumbs face the body's midline.
  return side === 'L' ? -hr.sx : hr.sx
}

export const skinShade = (c: Ctx, amount = 0.15): string => shadowOf(skinOf(c), amount)
export const skinMix = (c: Ctx, other: string, t: number): string => mix(skinOf(c), other, t)

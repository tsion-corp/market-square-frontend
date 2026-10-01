/* Profile creature bodies: quadruped, avian, aquatic, serpent and insectoid plans, with
 * their legs, feet, tails, wings and extras. Each piece rides its own bone so gaits,
 * swimming, slithering and flapping come from bone animation alone.
 *
 * Anatomy is drawn for a stylized but believable read: haunches and shoulder blades that
 * sit over the body, a tucked flank and a deep chest, hocks and elbows, paws with toes and
 * pads, hooves with a fetlock fringe, scaly bird toes, arched insect legs. Joints overlap
 * without a seam: an upper segment covers the top of the one below and is inked only along
 * its sides. */

import { isDark } from '../../core/color.ts'
import { applyM, clamp, invertM, lerp, norm, type Mat, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, poly, roundRect, sampleSmooth, smooth, tube, type SP } from '../../core/path.ts'
import { createRng, hash32 } from '../../core/rng.ts'
import { el } from '../../core/svg.ts'
import type { Ctx, PartList } from '../../render/context.ts'
import type { CreatureRig, LegDef } from '../../rig/creature.ts'
import { artBounds, boxedParts, coatOf, coatShape, furEdge, glowFill, highlightOf, mix, samplePath, shadowOf, type Coat } from './coat.ts'
import { CZ } from './head.ts'

/* ---- Rest-pose geometry ---------------------------------------------------- */

const restCache = new WeakMap<Ctx, Map<string, Mat>>()
function rest(c: Ctx): Map<string, Mat> {
  let w = restCache.get(c)
  if (!w) {
    w = c.skel.world({})
    restCache.set(c, w)
  }
  return w
}

/** Position of a bone's origin in another bone's space at rest (for anchoring shapes). */
function restOffset(c: Ctx, from: string, to: string): P {
  const w = rest(c)
  const a = w.get(from)
  const b = w.get(to)
  if (!a || !b) return [0, 0]
  return applyM(invertM(a), [b[4], b[5]])
}

/** A point given in one bone's space, expressed in another bone's space (at rest). */
function across(c: Ctx, from: string, to: string, p: P): P {
  const w = rest(c)
  const a = w.get(from)
  const b = w.get(to)
  if (!a || !b) return p
  return applyM(invertM(b), applyM(a, p))
}

const pts = (sp: SP[]): P[] => sp.map((p) => [p[0], p[1]] as P)

/** The silhouette plus fur clumps where `where` says (fur coats only). */
function furry(c: Ctx, coat: Coat, d: string, seed: string, where: (n: P, p: P) => number, k = 1, lean?: P, essential = false): string {
  if (coat.material !== 'fur' || c.paint.detail < 1) return d
  const depth = coat.unit * (0.9 + coat.fluff * 2) * k
  return d + furEdge(c, d, { depth, spacing: coat.unit * (3.4 + coat.fluff * 1.8) * Math.sqrt(k), where, lean, seed, essential })
}

const padColor = (coat: Coat): string => (isDark(coat.primary) ? '#2e2328' : '#e7929f')

/* ---- Feet ------------------------------------------------------------------ */

/**
 * One foot, in foot-bone space (origin at the ankle, ground about r·0.86 below). Profile feet
 * point toward +x; `frontal` feet (robots, blobs) face the camera.
 */
function foot(c: Ctx, kind: string, r: number, coat: Coat, tint: string, frontal = false): string {
  const P = c.paint
  const gy = r * 0.86
  const ar = r * 0.7
  const dark = shadowOf(tint, 0.45)
  const lineW = Math.max(P.lw * 0.55, r * 0.07)
  if (frontal) {
    switch (kind) {
      case 'wheels': {
        const tire = ellipse(0, r * 0.3, r * 0.75, r * 1.05)
        return P.shape(tire, '#2f3439', { material: 'rubber' }) + P.shape(ellipse(0, r * 0.3, r * 0.35, r * 0.55), '#b0bec5', { material: 'metal', outline: 0.6 }) + P.line([-0.6, -0.2, 0.2, 0.6].map((t) => `M${f(-r * 0.72)} ${f(r * 0.3 + t * r)}h${f(r * 0.2)}`).join(''), '#4b5258', r * 0.08)
      }
      case 'hooves':
        return P.shape(poly([[-r * 0.8, -r * 0.2], [r * 0.8, -r * 0.2], [r * 0.95, gy], [-r * 0.95, gy]]), mix(dark, '#3e2723', 0.5), { material: 'leather', gloss: true })
      default: {
        const boot = smooth([[-r * 0.85, -r * 0.3], [r * 0.85, -r * 0.3], [r * 1.25, gy * 0.5], [r * 1.2, gy, 0.5], [-r * 1.2, gy, 0.5], [-r * 1.25, gy * 0.5]])
        return P.shape(boot, tint, { material: coat.material === 'metal' ? 'metal' : coat.material === 'plastic' ? 'plastic' : undefined }) + (P.detail > 0 ? P.line(`M${f(-r * 1.05)} ${f(gy * 0.62)}H${f(r * 1.05)}`, dark, lineW, { opacity: 0.6 }) : '')
      }
    }
  }
  switch (kind) {
    case 'hooves': {
      const hoofC = mix(shadowOf(coat.primary, 0.55), '#3b2c27', 0.6)
      const hoof = smooth([[-r * 0.72, -r * 0.05, 0.4], [r * 0.62, -r * 0.05, 0.4], [r * 1.15, gy, 0.25], [-r * 0.82, gy, 0.35]])
      const fringe = smooth([[-ar * 1.02, -r * 0.55], [ar * 1.02, -r * 0.55], [r * 0.82, -r * 0.02, 0], [r * 0.45, -r * 0.2], [r * 0.12, r * 0.08, 0], [-r * 0.2, -r * 0.16], [-r * 0.5, r * 0.06, 0], [-r * 0.84, -r * 0.08]])
      const sheen = P.detail > 0 ? P.line(`M${f(r * 0.5)} ${f(gy * 0.2)}L${f(r * 0.78)} ${f(gy * 0.78)}`, highlightOf(hoofC, 0.6), r * 0.12, { opacity: 0.5 }) : ''
      return P.shape(hoof, hoofC, { material: 'leather', gloss: true }) + sheen + coatShape(c, fringe, coat, 'fetlock', 'leg', { tint, plain: true })
    }
    case 'talons':
    case 'birdWebbed': {
      const col = coat.accent !== '#c0392b' ? coat.accent : '#e3a33e'
      const toes: [P, number][] = frontal ? [] : [[[r * 1.9, gy], 1], [[r * 1.35, gy * 0.96], 0.85], [[-r * 1.1, gy * 0.98], 0.7]]
      let d = ''
      let lines = ''
      for (const [[tx, ty], k] of toes) {
        d += brush([[0, r * 0.1], [tx * 0.5, ty * 0.85], [tx, ty]], r * 0.62 * k, r * 0.36 * k)
        if (P.detail > 1) for (const u of [0.35, 0.55, 0.75]) lines += `M${f(tx * u - r * 0.12)} ${f(ty * u * 0.95 + r * 0.02)}l${f(r * 0.1)} ${f(r * 0.22)}`
      }
      let svg = P.shape(d, col, { material: 'scales' }) + (lines ? P.line(lines, shadowOf(col, 0.4), r * 0.05, { opacity: 0.6 }) : '')
      if (kind === 'birdWebbed') {
        svg = P.shape(smooth([[0, r * 0.05], [r * 1.95, gy * 0.92], [r * 1.65, gy * 1.02, 0.4], [r * 1.2, gy * 0.9], [r * 0.6, gy * 1.02, 0.4], [-r * 0.2, gy * 0.7]]), shadowOf(col, 0.08), { outline: 0.8 }) + svg
      } else {
        let claws = ''
        for (const [[tx, ty], k] of toes) {
          const s = tx >= 0 ? 1 : -1
          claws += smooth([[tx - s * r * 0.08, ty - r * 0.18 * k], [tx + s * r * 0.35 * k, ty - r * 0.05], [tx + s * r * 0.42 * k, ty + r * 0.2, 0], [tx + s * r * 0.1, ty + r * 0.06]])
        }
        svg += P.shape(claws, '#2f2528', { outline: 0.5, material: 'chitin' })
      }
      return svg
    }
    case 'webbed': {
      const col = mix(tint, '#f2a53a', coat.material === 'fur' ? 0 : 0.15)
      const web = smooth([[-ar * 0.9, -r * 0.2], [ar * 0.9, -r * 0.3], [r * 1.9, gy * 0.72, 0.3], [r * 1.55, gy * 1.02, 0.5], [r * 1.05, gy * 0.9], [r * 0.5, gy * 1.03, 0.5], [-r * 0.3, gy * 0.85], [-r * 0.95, gy * 0.4]])
      const ridges = P.detail > 0 ? P.line(`M${f(r * 0.2)} ${f(r * 0.1)}L${f(r * 1.75)} ${f(gy * 0.78)}M${f(r * 0.1)} ${f(r * 0.2)}L${f(r * 0.95)} ${f(gy * 0.92)}`, shadowOf(col, 0.35), lineW, { opacity: 0.6 }) : ''
      const tips = P.detail > 0 ? P.flat(circle(r * 1.78, gy * 0.8, r * 0.16) + circle(r * 0.98, gy * 0.95, r * 0.14), highlightOf(col, 0.25)) : ''
      return coatShape(c, web, coat, 'web', 'leg', { tint: col, plain: true, inkPath: smooth(pts([[-ar * 0.95, -r * 0.05], [-r * 0.95, gy * 0.4], [-r * 0.3, gy * 0.85], [r * 0.5, gy * 1.03, 0.5], [r * 1.05, gy * 0.9], [r * 1.55, gy * 1.02, 0.5], [r * 1.9, gy * 0.72, 0.3], [ar * 0.95, -r * 0.1]]), false) }) + ridges + tips
    }
    case 'wheels': {
      const hub = circle(0, r * 0.35, r * 0.45)
      let tread = ''
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2
        tread += `M${f(Math.cos(a) * r * 0.9)} ${f(r * 0.35 + Math.sin(a) * r * 0.9)}L${f(Math.cos(a) * r * 1.12)} ${f(r * 0.35 + Math.sin(a) * r * 1.12)}`
      }
      return P.shape(circle(0, r * 0.35, r * 1.15), '#2f3439', { material: 'rubber' }) + P.line(tread, '#4b5258', r * 0.1) + P.shape(hub, '#b0bec5', { material: 'metal', outline: 0.6 }) + P.flat(circle(0, r * 0.35, r * 0.12), '#5f6a72')
    }
    case 'pads':
    case 'paws':
    case 'claws':
    default: {
      const big = kind === 'pads'
      const L = big ? 1.35 : 1.6
      const H = big ? 1.08 : 1
      // Medium detail: a plain mitten without toe notches.
      const ctl: SP[] = P.detail < 2 ? [[-ar * 1.02, -r * 0.35], [-r * 0.98 * H, gy * 0.42], [-r * 0.7, gy, 0.6], [r * (L - 0.35), gy, 0.6], [r * L, gy * 0.5], [r * (L - 0.5), -r * 0.08 * H], [ar * 0.98, -r * 0.45]] : [
        [-ar * 1.02, -r * 0.35],
        [-r * 0.98 * H, gy * 0.42],
        [-r * 0.7, gy, 0.6],
        [r * (L - 0.35), gy, 0.6],
        [r * L, gy * 0.58],
        [r * (L - 0.08), gy * 0.12],
        [r * (L - 0.36), gy * 0.2, 0.2],
        [r * (L - 0.58), -r * 0.12 * H],
        [r * (L - 0.86), gy * 0.02, 0.2],
        [ar * 0.98, -r * 0.45],
      ]
      const d = smooth(ctl)
      const ink = smooth(ctl.slice(1, -1), false)
      const pad = padColor(coat)
      let extra = ''
      if (P.detail > 1) {
        // Toe splits and the sole pad showing along the bottom.
        extra += P.line(`M${f(r * (L - 0.36))} ${f(gy * 0.22)}q${f(r * 0.04)} ${f(gy * 0.3)} ${f(-r * 0.02)} ${f(gy * 0.48)}M${f(r * (L - 0.86))} ${f(gy * 0.04)}q${f(r * 0.04)} ${f(gy * 0.35)} ${f(-r * 0.02)} ${f(gy * 0.6)}`, shadowOf(tint, 0.4), lineW, { opacity: 0.75 })
        extra += P.flat(smooth([[-r * 0.55, gy - r * 0.1], [r * (L - 0.5), gy - r * 0.12], [r * (L - 0.3), gy + r * 0.2], [-r * 0.5, gy + r * 0.2]]), pad, 0.95)
        if (big) extra += P.flat(ellipse(r * (L - 0.28), gy * 0.88, r * 0.2, r * 0.13) + ellipse(r * (L - 0.75), gy * 0.95, r * 0.18, r * 0.1), pad, 0.9)
      }
      let svg = coatShape(c, d, coat, big ? 'pad' : 'paw', 'leg', { tint, inkPath: ink, extra, plain: true })
      if (kind === 'claws' || (kind === 'paws' && coat.material !== 'fur' && coat.material !== 'skin')) {
        let cl = ''
        for (const [tx, ty] of [[r * L, gy * 0.58], [r * (L - 0.3), gy * 0.3]] as P[]) cl += smooth([[tx - r * 0.18, ty - r * 0.16], [tx + r * 0.25, ty - r * 0.02], [tx + r * 0.36, ty + r * 0.34, 0], [tx + r * 0.02, ty + r * 0.12]])
        svg += P.shape(cl, '#efe5cf', { outline: 0.55, material: 'gem', spec: 0.35 })
      }
      return svg
    }
  }
}

/* ---- Legs ------------------------------------------------------------------- */

function legColors(c: Ctx, coat: Coat, near: boolean): string {
  const m = (c.cr as CreatureRig).m
  let base = coat.primary
  if (m.plan === 'insectoid') base = isDark(coat.primary) ? coat.primary : mix(coat.primary, '#2b2630', 0.82)
  return near ? base : shadowOf(base, 0.12)
}

function drawLegs(c: Ctx, out: PartList, coat: Coat): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const feet = c.sec('limbs').s('feet') || 'paws'
  if (m.plan === 'insectoid') return insectLegs(c, out, coat)
  const bird = m.plan === 'avian'
  const r = m.bodyR
  for (const leg of cr.legs as LegDef[]) {
    const up = c.skel.get(leg.upper)
    const lo = c.skel.get(leg.lower)
    if (!up || !lo) continue
    const tint = legColors(c, coat, leg.near)
    const z = leg.near ? CZ.legNear : CZ.legFar
    const lr = m.legR * (bird ? 0.42 : 1)
    const L1 = up.len
    const L2 = lo.len
    const key = `${leg.upper}`
    if (bird) {
      birdLeg(c, out, coat, leg, lr, L1, L2, feet)
      continue
    }
    const hind = leg.at < 0.5
    const shoulder = Math.min(r * (hind ? 0.62 : 0.5), L1 * 0.9 + r * 0.3)
    const wR = Math.min(r * (hind ? 0.46 : 0.36), shoulder * 0.85)
    const upper: SP[] = hind
      ? [
          [-wR * 0.95, -shoulder * 0.28],
          [-wR * 0.45, -shoulder * 0.86],
          [wR * 0.42, -shoulder * 0.74],
          [wR * 0.82, -shoulder * 0.1],
          [lr * 1.28, L1 * 0.6],
          [lr * 0.98, L1],
          [-lr * 0.98, L1],
          [-lr * 1.4, L1 * 0.55],
          [-wR * 0.9, shoulder * 0.28],
        ]
      : [
          [-wR * 0.7, -shoulder * 0.5],
          [-wR * 0.05, -shoulder * 0.95],
          [wR * 0.6, -shoulder * 0.52],
          [wR * 0.68, shoulder * 0.05],
          [lr * 1.18, L1 * 0.55],
          [lr * 0.96, L1],
          [-lr * 0.96, L1],
          [-lr * 1.5, L1 * 0.74],
          [-wR * 0.72, shoulder * 0.08],
        ]
    const legFur = coat.fluff > 0.45
    const upperS = smooth(upper)
    const upperD = legFur ? furry(c, coat, upperS, `${key}u`, (n, p) => (p[1] > L1 * 0.25 && n[0] < -0.5 ? 0.7 : 0), 0.6, [0, 1]) : upperS
    // Ink: the thigh's edges below the body's underside; above it only a soft muscle crease,
    // and never across the knee (the lower leg continues there).
    let inkPath: string | undefined
    let crease = ''
    if (leg.near) {
      const yCut = r * 0.34
      const outline = samplePath(upperS, lr * 0.25)[0] ?? []
      let strong = ''
      let soft = ''
      let prevS = false
      let prevF = false
      for (const [x, y] of outline) {
        const isS = y > yCut && y < L1 - lr * 0.35
        const isF = y <= yCut
        strong += isS ? `${prevS ? 'L' : 'M'}${f(x)} ${f(y)}` : ''
        soft += isF ? `${prevF ? 'L' : 'M'}${f(x)} ${f(y)}` : ''
        prevS = isS
        prevF = isF
      }
      inkPath = strong || undefined
      if (c.paint.detail > 0 && soft) crease = c.paint.line(soft, shadowOf(tint, 0.45), c.paint.lw * 0.6, { opacity: 0.32 })
    }
    out.add(leg.upper, z + 0.6, `${leg.upper}-art`, coatShape(c, upperD, coat, key, 'leg', { tint, inkPath, outline: leg.near && !inkPath ? false : undefined, flow: [hind ? -0.2 : 0.1, 1] }) + crease)
    // Lower leg: a hock (hind) or a straight forearm with a wrist (fore).
    const spine: P[] = hind ? [[0, 0], [-lr * 0.35, L2 * 0.3], [-lr * 0.72, L2 * 0.5], [-lr * 0.2, L2]] : [[0, 0], [lr * 0.04, L2 * 0.55], [lr * 0.2, L2 * 0.85], [lr * 0.12, L2]]
    const lowerT = tube(spine, hind ? [lr * 0.97, lr * 0.86, lr * 0.74, lr * 0.68] : [lr * 0.95, lr * 0.8, lr * 0.74, lr * 0.7])
    const lowerD = legFur ? furry(c, coat, lowerT, `${key}l`, (n, p) => (hind && p[1] > L2 * 0.2 && p[1] < L2 * 0.55 && n[0] < -0.6 ? 0.6 : 0), 0.5, [0.2, 1]) : lowerT
    out.add(leg.lower, z + 0.3, `${leg.lower}-art`, coatShape(c, lowerD, coat, `${leg.lower}`, 'leg', { tint, hint: { lower: true } }))
    out.add(leg.foot, z + 0.9, `${leg.foot}-art`, foot(c, feet, m.legR, coat, tint))
  }
}

function birdLeg(c: Ctx, out: PartList, coat: Coat, leg: LegDef, lr: number, L1: number, L2: number, feet: string): void {
  const P = c.paint
  const col = coat.accent !== '#c0392b' ? coat.accent : '#e3a33e'
  const legC = leg.near ? col : shadowOf(col, 0.12)
  const feathered = coat.material === 'feathers' && coat.fluff >= 0.3
  // Birds' legs come out from under the belly feathers: drawn behind the body, the tarsus
  // reaching up into it so no gap opens at the knee.
  const zz = leg.near ? CZ.body - 0.4 : CZ.body - 0.6
  const shin = tube([[0, -L1 - lr], [0, L2 * 0.3], [0, L2]], [lr * 0.95, lr * 0.8, lr * 0.62])
  let rings = ''
  if (P.detail > 1 && !feathered) for (let i = 1; i < 6; i++) rings += `M${f(-lr * 0.6)} ${f((L2 * i) / 6)}q${f(lr * 0.6)} ${f(lr * 0.25)} ${f(lr * 1.2)} 0`
  const shinSvg = feathered
    ? coatShape(c, furry(c, { ...coat, material: 'fur' }, tube([[0, -L1 - lr], [0, L2 * 0.4], [0, L2]], [lr * 1.5, lr * 1.35, lr * 1.1]), 'shin', (_n, p) => (p[1] > 0 ? 0.6 : 0), 0.6, [0, 1]), coat, 'shin', 'leg', { tint: leg.near ? coat.belly : shadowOf(coat.belly, 0.1), plain: true })
    : P.shape(shin, legC, { material: 'scales' }) + (rings ? P.line(rings, shadowOf(legC, 0.35), lr * 0.12, { opacity: 0.55 }) : '')
  out.add(leg.lower, zz, `${leg.lower}-art`, shinSvg)
  const kind = feet === 'webbed' ? 'birdWebbed' : 'talons'
  out.add(leg.foot, zz + 0.1, `${leg.foot}-art`, foot(c, kind, lr * 1.25, coat, legC))
}

/**
 * Insect and spider legs: femur rising to a high knee, tibia down to the ground, all drawn on
 * the upper leg bone (so a gait swings the whole leg). Legs fan out from the thorax.
 */
function insectLegs(c: Ctx, out: PartList, coat: Coat): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const P = c.paint
  const r = m.bodyR
  const pairs = Math.max(1, Math.floor(cr.legs.length / 2))
  const [cx] = restOffset(c, 'spine1', 'chest')
  const thoraxX = cx - r * 0.1
  for (const leg of cr.legs) {
    const up = c.skel.get(leg.upper)
    const lo = c.skel.get(leg.lower)
    if (!up || !lo) continue
    const col = legColors(c, coat, leg.near)
    const lr = m.legR * 0.55
    // Hip on the thorax (spine1 space), foot where the rig puts it.
    const spread = pairs === 1 ? 0 : leg.pair / (pairs - 1) - 0.5
    const hipS: P = [thoraxX + spread * r * 0.7 + (leg.near ? r * 0.05 : -r * 0.05), r * 0.32]
    const hip = across(c, 'spine1', leg.upper, hipS)
    const footP = across(c, leg.foot, leg.upper, [0, m.legR * 0.8])
    // Knee, in world-aligned terms: spiders arch theirs high over the body; other bugs bend
    // theirs out to the side, the tibia dropping steeply to the ground.
    const toW = (p: P): P => across(c, leg.upper, 'root', p)
    const hipW = toW(hip)
    const footW = toW(footP)
    const spider = m.legs >= 8
    const bodyTop = m.bodyY - r * 0.9
    const kneeW: P = spider
      ? [lerp(hipW[0], footW[0], 0.46), Math.min(bodyTop - m.legLen * 0.3, hipW[1] - r * 0.9)]
      : [lerp(hipW[0], footW[0], 0.72), hipW[1] + (footW[1] - hipW[1]) * 0.12 - r * 0.12]
    const knee = across(c, 'root', leg.upper, kneeW)
    const femur = tube([hip, [lerp(hip[0], knee[0], 0.5), lerp(hip[1], knee[1], 0.5) - lr * 0.4], knee], [lr * 1.15, lr * 1.05, lr * 0.85])
    const tibiaMid: P = [lerp(knee[0], footP[0], 0.5), lerp(knee[1], footP[1], 0.5)]
    const tibia = tube([knee, tibiaMid, footP], [lr * 0.85, lr * 0.62, lr * 0.35], 'round', 'point')
    // Legs stay sleek chitin unless the coat is very fluffy (a tarantula).
    const fuzzy = coat.material === 'fur' && coat.fluff > 0.65
    const legCoat: Coat = { ...coat, material: fuzzy ? 'fur' : 'chitin', fluff: Math.min(coat.fluff, 0.4) }
    const femurD = fuzzy ? furry(c, legCoat, femur, `${leg.upper}f`, (n) => (n[1] > 0.2 ? 0.5 : 0.2), 0.45) : femur
    let svg = coatShape(c, tibia, legCoat, `${leg.upper}t`, 'leg', { tint: col, plain: true })
    svg += coatShape(c, femurD, legCoat, `${leg.upper}f`, 'leg', { tint: col, plain: true })
    svg += P.shape(circle(knee[0], knee[1], lr * 0.9), shadowOf(col, 0.1), { outline: 0.6, material: 'chitin' })
    if (P.detail > 1) {
      // Tarsal claw.
      const dir = norm([footP[0] - tibiaMid[0], footP[1] - tibiaMid[1]])
      svg += P.line(`M${f(footP[0])} ${f(footP[1])}l${f(dir[0] * lr * 0.9 + lr * 0.4)} ${f(lr * 0.25)}`, shadowOf(col, 0.3), lr * 0.28)
    }
    out.add(leg.upper, leg.near ? CZ.legNear : CZ.legFar, `${leg.upper}-art`, svg)
  }
}

/* ---- Tails ------------------------------------------------------------------ */

function tailArt(c: Ctx, coat: Coat, len: number, r: number): string {
  const t = c.sec('tail')
  const style = t.s('style') || 'thin'
  if (style === 'none') return ''
  const P = c.paint
  const up = lerp(-0.45, 0.85, t.n('curve'))
  // Along -x (backward), curving up by `up`.
  const at = (u: number): P => [-len * u, -len * up * u * u * 0.9 + len * 0.08 * Math.sin(u * Math.PI)]
  const spine = [0, 0.25, 0.5, 0.75, 1].map(at)
  const tip = at(1)
  const dirAt = (u: number): P => {
    const a = at(Math.max(0, u - 0.05))
    const b = at(Math.min(1, u + 0.05))
    return norm([b[0] - a[0], b[1] - a[1]])
  }
  const accentOr = (fallback: string) => (coat.accent === '#c0392b' ? fallback : coat.accent)
  switch (style) {
    case 'thin':
    case 'tuft':
    case 'spade':
    case 'club':
    case 'stinger': {
      const radii = [r, r * 0.86, r * 0.68, r * 0.5, style === 'stinger' ? 0.1 : r * 0.34]
      let body = tube(spine, radii, 'round', style === 'stinger' ? 'point' : 'round')
      if (style === 'thin' && coat.fluff > 0.4) body = furry(c, coat, body, 'tail', (_n, p) => (p[0] < -len * 0.5 ? 0.7 : 0), 0.5, dirAt(0.8))
      let svg = coatShape(c, body, coat, 'tail', 'tail', { flow: dirAt(0.5) })
      if (style === 'tuft') {
        const d = dirAt(0.95)
        const nx = -d[1]
        const ny = d[0]
        const w = r * 1.25
        const base: P = [tip[0] - d[0] * r * 0.3, tip[1] - d[1] * r * 0.3]
        const lock = (k: number, s: number): string => {
          const tp: P = [base[0] + d[0] * w * 2.2 * k + nx * w * s, base[1] + d[1] * w * 2.2 * k + ny * w * s]
          return smooth([[base[0] + nx * w * 0.45, base[1] + ny * w * 0.45], [lerp(base[0], tp[0], 0.5) + nx * w * 0.5, lerp(base[1], tp[1], 0.5) + ny * w * 0.5], [tp[0], tp[1], 0], [lerp(base[0], tp[0], 0.5) - nx * w * 0.35, lerp(base[1], tp[1], 0.5) - ny * w * 0.35], [base[0] - nx * w * 0.45, base[1] - ny * w * 0.45]])
        }
        const tuft = lock(1, 0.05) + lock(0.8, 0.55) + lock(0.8, -0.5) + lock(0.55, 0.9) + lock(0.55, -0.85)
        svg += coatShape(c, tuft, { ...coat, material: 'fur' }, 'tuft', 'tail', { tint: accentOr(shadowOf(coat.primary, 0.45)), plain: true, flow: d })
      }
      if (style === 'spade') {
        const d = dirAt(1)
        const nx = -d[1]
        const ny = d[0]
        const w = r * 1.35
        const b: P = [tip[0] - d[0] * r * 0.2, tip[1] - d[1] * r * 0.2]
        const spade = smooth([[b[0], b[1], 0.6], [b[0] + d[0] * w * 0.2 + nx * w * 1.05, b[1] + d[1] * w * 0.2 + ny * w * 1.05, 0.5], [b[0] + d[0] * w * 0.8 + nx * w * 0.9, b[1] + d[1] * w * 0.8 + ny * w * 0.9], [b[0] + d[0] * w * 2.1, b[1] + d[1] * w * 2.1, 0], [b[0] + d[0] * w * 0.8 - nx * w * 0.9, b[1] + d[1] * w * 0.8 - ny * w * 0.9], [b[0] + d[0] * w * 0.2 - nx * w * 1.05, b[1] + d[1] * w * 0.2 - ny * w * 1.05, 0.5]])
        const rib = P.detail > 0 ? P.line(`M${f(b[0])} ${f(b[1])}L${f(b[0] + d[0] * w * 1.7)} ${f(b[1] + d[1] * w * 1.7)}`, shadowOf(accentOr(coat.primary), 0.35), r * 0.12, { opacity: 0.6 }) : ''
        svg += coatShape(c, spade, coat, 'spade', 'tail', { tint: accentOr(coat.primary), plain: true, material: 'leather' }) + rib
      }
      if (style === 'club') {
        const cc: P = [tip[0] - r * 0.7, tip[1]]
        let spikes = ''
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3
          spikes += poly([[cc[0] + Math.cos(a - 0.28) * r * 1.2, cc[1] + Math.sin(a - 0.28) * r * 1.2], [cc[0] + Math.cos(a) * r * 2.05, cc[1] + Math.sin(a) * r * 2.05], [cc[0] + Math.cos(a + 0.28) * r * 1.2, cc[1] + Math.sin(a + 0.28) * r * 1.2]])
        }
        svg += P.shape(spikes, '#efe5cf', { material: 'gem', spec: 0.3, outline: 0.7 }) + coatShape(c, smooth([[cc[0] + r * 1.3, cc[1] - r * 0.6], [cc[0], cc[1] - r * 1.35], [cc[0] - r * 1.4, cc[1]], [cc[0], cc[1] + r * 1.3], [cc[0] + r * 1.3, cc[1] + r * 0.6]]), coat, 'club', 'tail', { tint: shadowOf(coat.primary, 0.15), coatMaterial: 'rock' })
      }
      if (style === 'stinger') {
        const d = dirAt(1)
        svg += P.shape(smooth([[tip[0] - d[1] * r * 0.28, tip[1] + d[0] * r * 0.28], [tip[0] + d[0] * r * 1.3, tip[1] + d[1] * r * 1.3, 0], [tip[0] + d[1] * r * 0.28, tip[1] - d[0] * r * 0.28]]), '#26252c', { material: 'chitin' })
      }
      return svg
    }
    case 'fluffy': {
      // A cotton puff: round mass of clumps, lighter underneath.
      const R = r * 1.9
      const cx0 = -R * 0.55
      const ring: SP[] = []
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        ring.push([cx0 + Math.cos(a) * R, Math.sin(a) * R * 0.92])
      }
      const puff = furry(c, { ...coat, material: 'fur', fluff: Math.max(coat.fluff, 0.6) }, smooth(ring), 'puff', () => 1, 0.8, undefined, true)
      return coatShape(c, puff, { ...coat, material: coat.material === 'fur' ? 'fur' : coat.material }, 'puff', 'tail', { tint: coat.secondary, plain: true, flow: 'radial' })
    }
    case 'bushy': {
      if (coat.material !== 'fur' && coat.material !== 'feathers') {
        // A hair tail (horses, unicorns): a short dock and long locks falling back and down.
        const rng = createRng(hash32(c.dna.seed, 'hairtail'))
        const hairC = accentOr(shadowOf(coat.primary, 0.35))
        const a0 = at(0.1)
        const locks: string[] = []
        const n = 7
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1)
          const L = len * rng.range(0.68, 0.84)
          const sway = rng.range(-0.08, 0.08) * L
          locks.push(brush([[a0[0] + r * 0.4, a0[1] + (k - 0.5) * r * 0.9], [a0[0] - L * (0.3 + k * 0.08), a0[1] + L * 0.05 + (k - 0.5) * r * 1.4 - up * L * 0.25], [a0[0] - L * (0.5 + k * 0.1) + sway, a0[1] + L * 0.5 - up * L * 0.45], [a0[0] - L * (0.45 + k * 0.14) + sway * 2, a0[1] + L * 0.92 - up * L * 0.6]], r * 1.5, r * 0.08, r * 0.35))
        }
        const hairCoat: Coat = { ...coat, material: 'fur', fluff: 0.2 }
        const dock = coatShape(c, tube([at(0), a0], [r, r * 0.85]), coat, 'dock', 'tail')
        return dock + coatShape(c, locks[0], hairCoat, 'hair', 'tail', { tint: hairC, plain: true, union: locks.slice(1), flow: [-0.35, 1] })
      }
      // A plume: swells in the middle, clumped edges, a pale tip.
      const w = r * 2.1
      const widths = [r * 0.9, w * 0.95, w * 1.05, w * 0.8, w * 0.1]
      const plume = tube([at(0), at(0.3), at(0.58), at(0.85), [tip[0] - dirAt(1)[0] * w * 0.4, tip[1] - dirAt(1)[1] * w * 0.4]], widths, 'round', 'point')
      const furC: Coat = coat.material === 'fur' ? coat : { ...coat, material: 'fur', fluff: 0.4 }
      const body = furry(c, furC, plume, 'plume', (_n, p) => (p[0] < -len * 0.15 ? 1 : 0.2), 1.1, dirAt(0.7), true)
      let svg = coatShape(c, body, furC, 'tail', 'tail', { flow: dirAt(0.6) })
      if (coat.pattern !== 'socks' || true) {
        // Pale tip (fox, wolf): a clumped cap over the last quarter.
        const tp = [0.82, 0.9, 0.97, 1].map(at)
        const cap = tube([tp[0], tp[1], tp[2], [tip[0] - dirAt(1)[0] * w * 0.4, tip[1] - dirAt(1)[1] * w * 0.4]], [w * 0.78, w * 0.62, w * 0.35, w * 0.08], 'flat', 'point')
        const tipCol = coat.pattern === 'socks' || coat.fluff > 0.4 ? coat.secondary : ''
        if (tipCol) svg += coatShape(c, furry(c, furC, cap, 'tip', (n) => (n[0] < 0.2 ? 1 : 0), 0.9, dirAt(0.95), true), furC, 'tip', 'tail', { tint: tipCol, plain: true, flow: dirAt(0.95) })
      }
      return svg
    }
    case 'fin':
    case 'fan':
    case 'feather':
    case 'flame': {
      const base: P = at(0.6)
      if (style === 'fin') {
        const aquatic = (c.cr as CreatureRig).m.plan === 'aquatic'
        const finC = mix(coat.primary, coat.secondary, 0.3)
        const spread = len * (aquatic ? 0.62 : 0.5)
        const lobeTop: P = [tip[0] - r * 0.4, tip[1] - spread]
        const lobeBot: P = [tip[0] - r * 0.4, tip[1] + spread]
        const d = smooth([[base[0] + r * 0.6, base[1] - r * 0.4], [lerp(base[0], lobeTop[0], 0.6), lobeTop[1] + spread * 0.25], [lobeTop[0], lobeTop[1], 0], [tip[0] + len * 0.12, tip[1], 0.6], [lobeBot[0], lobeBot[1], 0], [lerp(base[0], lobeBot[0], 0.6), lobeBot[1] - spread * 0.25], [base[0] + r * 0.6, base[1] + r * 0.4]])
        let rays = ''
        if (P.detail > 0) for (let i = 0; i <= 6; i++) {
          const k = i / 6
          const e: P = [lerp(lobeTop[0], lobeBot[0], k) + Math.sin(k * Math.PI) * len * 0.1, lerp(lobeTop[1], lobeBot[1], k)]
          rays += `M${f(base[0])} ${f(base[1])}Q${f(lerp(base[0], e[0], 0.5))} ${f(lerp(base[1], e[1], 0.5) * 0.9)} ${f(e[0])} ${f(e[1])}`
        }
        const finSvg = coatShape(c, d, coat, 'fin', 'tail', { tint: finC, plain: true, coatMaterial: coat.material === 'fur' ? 'skin' : coat.material === 'scales' ? 'wet' : coat.material, extra: rays ? P.line(rays, shadowOf(finC, 0.3), r * 0.08, { opacity: 0.55 }) + P.line(rays, highlightOf(finC, 0.45), r * 0.035, { opacity: 0.5 }) : '' })
        // Fish: the tail stock grows out of the body and narrows into the fin.
        const bodyR = (c.cr as CreatureRig).m.bodyR
        const stock = aquatic ? tube([[bodyR * 0.2, 0], [0, 0], at(0.3), base], [bodyR * 0.3, bodyR * 0.29, bodyR * 0.25, bodyR * 0.18]) : tube([[0, 0], at(0.3), base], [r, r * 0.8, r * 0.55])
        return coatShape(c, stock, coat, 'tail', 'tail') + finSvg
      }
      if (style === 'flame') return flameShape(c, [[r * 0.3, 0], at(0.3), at(0.65), tip], Math.max(r * 2.4, len * 0.2), coat)
      const n = style === 'fan' ? 9 : 5
      const feathers: string[] = []
      const shafts: string[] = []
      const eyes: string[] = []
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1)
        const a = Math.PI + lerp(-0.7, 0.7, k) * (style === 'fan' ? 1.35 : 0.42) - up * 0.8
        const L = len * (style === 'fan' ? 1.1 : lerp(0.85, 1.05, 1 - Math.abs(k - 0.5) * 2))
        const wd = L * (style === 'fan' ? 0.12 : 0.1)
        const dir: P = [Math.cos(a), Math.sin(a)]
        const nn: P = [-dir[1], dir[0]]
        const e: P = [dir[0] * L, dir[1] * L]
        feathers.push(smooth([[nn[0] * wd * 0.3, nn[1] * wd * 0.3], [dir[0] * L * 0.55 + nn[0] * wd, dir[1] * L * 0.55 + nn[1] * wd], [e[0] + nn[0] * wd * 0.35, e[1] + nn[1] * wd * 0.35], [e[0] + dir[0] * wd * 0.4, e[1] + dir[1] * wd * 0.4, 0.3], [e[0] - nn[0] * wd * 0.35, e[1] - nn[1] * wd * 0.35], [dir[0] * L * 0.55 - nn[0] * wd, dir[1] * L * 0.55 - nn[1] * wd], [-nn[0] * wd * 0.3, -nn[1] * wd * 0.3]]))
        shafts.push(`M0 0L${f(e[0] * 0.95)} ${f(e[1] * 0.95)}`)
        if (style === 'fan') eyes.push(ellipse(e[0] * 0.86, e[1] * 0.86, wd * 0.7, wd * 0.6))
      }
      const colA = style === 'fan' ? accentOr(coat.primary) : coat.primary
      let svg = ''
      // Back to front, alternating shades so each feather reads.
      feathers.forEach((d, i) => {
        const col = i % 2 ? colA : shadowOf(colA, 0.1)
        svg += coatShape(c, d, coat, `tf${i}`, 'tail', { tint: col, plain: true, coatMaterial: 'feathers', extra: P.detail > 0 ? P.line(shafts[i], highlightOf(col, 0.4), r * 0.07, { opacity: 0.7 }) + (c.baked && P.detail > 1 ? barbs(c, shafts[i], len, r, col) : '') : '' })
      })
      if (eyes.length && P.detail > 0) {
        const pupils = eyes.map((_e, i) => {
          const k = i / (n - 1)
          const a = Math.PI + lerp(-0.7, 0.7, k) * 1.35 - up * 0.8
          return circle(Math.cos(a) * len * 0.95, Math.sin(a) * len * 0.95, len * 0.035)
        })
        svg += P.flat(eyes.join(''), '#2e7d6f') + P.flat(pupils.join(''), '#1b3a8a')
      }
      return svg
    }
    case 'curly': {
      const pts2: P[] = [[0, 0]]
      for (let i = 1; i <= 18; i++) {
        const a = i * 0.72
        const rr = r * 2.1 * (1 - i / 24)
        pts2.push([-r * 1.6 - Math.cos(a) * rr, -Math.sin(a) * rr])
      }
      const radii = pts2.map((_, i) => r * lerp(0.5, 0.28, i / 18))
      return coatShape(c, tube(pts2, radii), coat, 'curl', 'tail', { plain: true })
    }
  }
  return ''
}

/** Feather barbs along a shaft (baked stills): fine diagonal strokes. */
function barbs(c: Ctx, shaft: string, len: number, r: number, col: string): string {
  const m = /M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/.exec(shaft)
  if (!m) return ''
  const a: P = [+m[1], +m[2]]
  const b: P = [+m[3], +m[4]]
  const d = norm([b[0] - a[0], b[1] - a[1]])
  const n: P = [-d[1], d[0]]
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const step = Math.max(r * 0.35, len * 0.05)
  let s = ''
  for (let t = step; t < L * 0.92; t += step) {
    const p: P = [a[0] + d[0] * t, a[1] + d[1] * t]
    const w = L * 0.09 * Math.sin((t / L) * Math.PI * 0.9 + 0.2)
    for (const side of [-1, 1]) s += `M${f(p[0])} ${f(p[1])}l${f(n[0] * side * w + d[0] * w * 0.6)} ${f(n[1] * side * w + d[1] * w * 0.6)}`
  }
  return c.paint.line(s, shadowOf(col, 0.25), r * 0.035, { opacity: 0.5 })
}

/** A fire shape along a spine: layered tongues, hot core, soft glow (baked). */
function flameShape(c: Ctx, spine0: P[], w: number, coat: Coat): string {
  const P = c.paint
  const outer = coat.primary === '#e8a55a' ? '#ff7043' : mix(coat.primary, '#ff5a2a', 0.35)
  const spine = sampleSmooth(spine0, false, 3)
  const n = spine.length
  // Width profile: narrow at the root, fullest a third of the way, licking to a point.
  const prof = (t: number) => Math.sin(Math.min(1, t * 1.6 + 0.25) * Math.PI * 0.5) * (1 - t) ** 0.8
  const tongues = (k: number, seed: number): string => {
    const rng = createRng(hash32(c.dna.seed, 'flame', seed))
    const left: SP[] = []
    const right: SP[] = []
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const a = spine[Math.max(0, i - 1)]
      const b = spine[Math.min(n - 1, i + 1)]
      const d = norm([b[0] - a[0], b[1] - a[1]])
      const nn: P = [-d[1], d[0]]
      const ww = w * k * prof(t)
      // Tongues flick upward and back on alternate points.
      const tongue = i % 2 === 1 && t > 0.15 && t < 0.9
      const up = tongue ? ww * rng.range(0.55, 0.9) : 0
      const side = nn[1] < 0 ? 1 : -1
      const lw = ww + (side > 0 ? up : 0)
      const rw = ww * 0.9 + (side < 0 ? up : 0)
      left.push([spine[i][0] + nn[0] * lw - d[0] * (side > 0 ? up * 0.6 : 0), spine[i][1] + nn[1] * lw - (side > 0 ? up * 0.3 : 0), tongue && side > 0 ? 0 : 1])
      right.unshift([spine[i][0] - nn[0] * rw - d[0] * (side < 0 ? up * 0.6 : 0), spine[i][1] - nn[1] * rw - (side < 0 ? up * 0.3 : 0), tongue && side < 0 ? 0 : 1])
    }
    const e = spine[n - 1]
    const d = norm([e[0] - spine[n - 2][0], e[1] - spine[n - 2][1]])
    return smooth([...left, [e[0] + d[0] * w * k * 0.5, e[1] + d[1] * w * k * 0.5 - w * 0.25, 0], ...right])
  }
  const glow = c.baked && P.detail > 1 ? el('ellipse', { cx: f(spine[Math.floor(n / 3)][0]), cy: f(spine[Math.floor(n / 3)][1]), rx: f(w * 2.2), ry: f(w * 1.6), fill: glowFill(c, outer, 0.35, 0.3) }) : ''
  return glow + P.shape(tongues(1, 1), outer, { shade: false }) + P.shape(tongues(0.62, 2), '#ffb74d', { shade: false, outline: false }) + P.shape(tongues(0.32, 3), '#fff3c4', { shade: false, outline: false })
}

function drawTails(c: Ctx, out: PartList, coat: Coat, len: number, r: number): void {
  const extra = Math.round(c.sec('tail').n('count'))
  const art = tailArt(c, coat, len, r)
  if (!art) return
  if (extra <= 0) {
    out.add('tail0', CZ.tail, 'tail', art)
    return
  }
  const n = extra + 1
  for (let i = 0; i < n; i++) {
    const rot = lerp(-30, 30, i / (n - 1))
    out.add('tail0', CZ.tail - i * 0.1, `tail-${i}`, `<g transform="rotate(${rot.toFixed(1)})">${art}</g>`, false, artBounds(art, 1, 1, 0, 0, rot))
  }
}

/* ---- Wings ------------------------------------------------------------------ */

/**
 * One wing in wing-bone space, spreading toward -x and up (the near wing of a profile
 * creature). `folded` lays a bird's wing along the body instead.
 */
export function creatureWing(c: Ctx, coat: Coat, span: number, folded = false): string {
  const w = c.sec('wings')
  const style = w.s('style') || 'none'
  if (style === 'none') return ''
  const P = c.paint
  const col = w.c('color', mix(coat.primary, coat.secondary, 0.2))
  const s = span * lerp(0.6, 1.5, w.n('size'))
  switch (style) {
    case 'feather':
      return featherWing(c, coat, col, s, folded)
    case 'bat': {
      // Membrane between finger bones, scalloped trailing edge, a thumb claw at the wrist.
      const wrist: P = [-s * 0.34, -s * 0.52]
      const fingers: P[] = [[-s * 1.02, -s * 0.78], [-s * 0.98, -s * 0.28], [-s * 0.78, s * 0.08], [-s * 0.5, s * 0.26]]
      const edge: SP[] = [[0, 0], wrist, [fingers[0][0], fingers[0][1], 0]]
      for (let i = 0; i < fingers.length - 1; i++) {
        const a = fingers[i]
        const b = fingers[i + 1]
        edge.push([lerp(a[0], b[0], 0.5) + s * 0.1, lerp(a[1], b[1], 0.5) + s * 0.04])
        edge.push([b[0], b[1], 0])
      }
      edge.push([-s * 0.28, s * 0.12], [-s * 0.12, s * 0.28, 0], [s * 0.02, s * 0.08])
      const memC = mix(col, coat.belly, 0.28)
      let bones = `M0 0L${f(wrist[0])} ${f(wrist[1])}`
      for (const fp of fingers) bones += `M${f(wrist[0])} ${f(wrist[1])}Q${f(lerp(wrist[0], fp[0], 0.5) + s * 0.03)} ${f(lerp(wrist[1], fp[1], 0.5) - s * 0.04)} ${f(fp[0])} ${f(fp[1])}`
      const veins = P.detail > 1 && c.baked ? P.line(fingers.slice(0, 3).map((fp, i) => `M${f(lerp(wrist[0], fp[0], 0.55))} ${f(lerp(wrist[1], fp[1], 0.55))}Q${f(lerp(fp[0], fingers[i + 1][0], 0.4) + s * 0.08)} ${f(lerp(fp[1], fingers[i + 1][1], 0.4))} ${f(lerp(fp[0], fingers[i + 1][0], 0.6))} ${f(lerp(fp[1], fingers[i + 1][1], 0.6) + s * 0.05)}`).join(''), shadowOf(memC, 0.25), s * 0.012, { opacity: 0.45 }) : ''
      const membrane = coatShape(c, smooth(edge), coat, 'membrane', 'body', { tint: memC, plain: true, coatMaterial: 'skin', attrs: { 'fill-opacity': 0.93 }, extra: veins })
      const boneW = s * 0.05
      return membrane + P.line(bones, shadowOf(col, 0.25), boneW) + P.line(bones, highlightOf(col, 0.25), boneW * 0.35, { opacity: 0.6 }) + P.shape(smooth([[wrist[0] - s * 0.02, wrist[1] + s * 0.02], [wrist[0] + s * 0.05, wrist[1] - s * 0.12], [wrist[0] + s * 0.1, wrist[1] - s * 0.06, 0], [wrist[0] + s * 0.03, wrist[1] + s * 0.02]]), '#efe5cf', { outline: 0.5 })
    }
    case 'insect':
    case 'fairy': {
      const fairy = style === 'fairy'
      const upW = smooth([[0, -s * 0.02], [-s * 0.3, -s * 0.72], [-s * 0.75, -s * 0.92], [-s * 1.02, -s * 0.72], [-s * 0.9, -s * 0.36], [-s * 0.45, -s * 0.08]])
      const lowW = smooth([[0, s * 0.04], [-s * 0.5, s * 0.02], [-s * 0.72, s * 0.3], [-s * 0.55, s * 0.58], [-s * 0.22, s * 0.44]])
      const veinsD = `M0 0Q${f(-s * 0.45)} ${f(-s * 0.55)} ${f(-s * 0.85)} ${f(-s * 0.8)}M0 0Q${f(-s * 0.55)} ${f(-s * 0.35)} ${f(-s * 0.95)} ${f(-s * 0.5)}M${f(-s * 0.4)} ${f(-s * 0.45)}L${f(-s * 0.6)} ${f(-s * 0.2)}M0 ${f(s * 0.04)}Q${f(-s * 0.4)} ${f(s * 0.2)} ${f(-s * 0.6)} ${f(s * 0.45)}M0 ${f(s * 0.04)}L${f(-s * 0.6)} ${f(s * 0.1)}`
      if (!fairy) {
        // Clear membrane with an iridescent film and dark veins.
        const film = P.linear(`irf${Math.round(s)}`, [[0, '#9ff2ff', 0.55], [0.35, '#e8f8ff', 0.25], [0.6, '#ffd6f6', 0.45], [1, '#c2ffd8', 0.5]], [0, 0], [1, 1], { x: -s, y: -s * 0.9, w: s, h: s * 1.5 })
        const wing = (d: string) => P.shape(d, '#eaf6ff', { paint: film, material: 'glass', spec: 0.6, attrs: { 'fill-opacity': 0.65 }, outline: 0.7, ink: '#6f8290' })
        return wing(lowW) + wing(upW) + P.line(veinsD, '#62717c', s * 0.012, { opacity: 0.7 })
      }
      // Butterfly: coloured scale-dust wings, darker border with pale dots, eyespots.
      const border = shadowOf(col, 0.55)
      const rng = createRng(hash32(c.dna.seed, 'fairy'))
      let dots = ''
      for (let i = 0; i < 7; i++) {
        const a = lerp(-2.3, -0.9, i / 6)
        dots += circle(-s * 0.52 + Math.cos(a) * s * 0.45, -s * 0.5 + Math.sin(a) * s * 0.38, s * rng.range(0.018, 0.03))
      }
      const inner = (d: string, k: number) => el('path', { d, fill: 'none', stroke: P.col(border), 'stroke-width': f(s * 0.09 * k), 'stroke-opacity': 0.9 })
      const upExtra = inner(upW, 1) + P.flat(dots, '#fbf6ea', 0.9) + P.flat(ellipse(-s * 0.62, -s * 0.52, s * 0.13, s * 0.11), coat.accent) + P.flat(ellipse(-s * 0.62, -s * 0.52, s * 0.06, s * 0.05), border) + P.flat(circle(-s * 0.6, -s * 0.54, s * 0.018), '#ffffff') + P.line(veinsD, border, s * 0.012, { opacity: 0.55 }) + el('path', { d: upW, fill: P.linear(`dust${col.slice(1)}`, [[0, shadowOf(col, 0.25), 0.8], [0.35, col, 0]], [0, 0.2], [1, 0.6]) })
      const lowExtra = inner(lowW, 0.9) + P.flat(ellipse(-s * 0.42, s * 0.3, s * 0.08, s * 0.07), coat.accent) + P.line(veinsD, border, s * 0.012, { opacity: 0.4 })
      return coatShape(c, lowW, coat, 'wl', 'body', { tint: shadowOf(col, 0.06), plain: true, coatMaterial: 'skin', extra: lowExtra }) + coatShape(c, upW, coat, 'wu', 'body', { tint: col, plain: true, coatMaterial: 'skin', extra: upExtra })
    }
    case 'mech': {
      let svg = ''
      for (let i = 0; i < 3; i++) {
        const x = -s * (0.9 - i * 0.15)
        const y = -s * 0.5 + i * s * 0.22
        const wd = s * (0.85 - i * 0.12)
        const plate = roundRect(x, y, wd, s * 0.15, s * 0.05)
        const detail = P.detail > 0 ? P.flat(roundRect(x + s * 0.08, y + s * 0.045, wd - s * 0.16, s * 0.05, s * 0.025), '#00e5ff') + P.flat(circle(x + wd - s * 0.04, y + s * 0.075, s * 0.018) + circle(x + s * 0.04, y + s * 0.075, s * 0.018), '#5f6a72') : ''
        svg += P.shape(plate, '#b0bec5', { material: 'metal', inner: detail })
        if (c.baked && P.detail > 1) svg += P.glow(x + wd / 2, y + s * 0.07, s * 0.2, '#00e5ff', 0.25)
      }
      return P.shape(circle(0, 0, s * 0.09), '#78909c', { material: 'metal' }) + svg
    }
    case 'flame':
      return flameShape(c, [[0, 0], [-s * 0.3, -s * 0.4], [-s * 0.65, -s * 0.72], [-s * 0.95, -s * 0.85]], s * 0.42, coat)
  }
  return ''
}

/** A band of covert feathers from `a` (shoulder) to `b`, `h` deep, its lower edge scalloped. */
function coverts(a: P, b: P, h: number, n: number, tilt = 0): string {
  const d = norm([b[0] - a[0], b[1] - a[1]])
  const nn: P = [-d[1], d[0]]
  const top: SP[] = [[a[0] - nn[0] * h * 0.5, a[1] - nn[1] * h * 0.5], [lerp(a[0], b[0], 0.5) - nn[0] * h * (0.7 + tilt * 0.2), lerp(a[1], b[1], 0.5) - nn[1] * h * 0.7], [b[0] - nn[0] * h * 0.3, b[1] - nn[1] * h * 0.3]]
  const edge: SP[] = []
  for (let j = 0; j <= n * 2; j++) {
    const t = 1 - j / (n * 2)
    const dep = j % 2 ? h * 1.15 : h * 0.55
    edge.push([lerp(a[0], b[0], t) + nn[0] * dep, lerp(a[1], b[1], t) + nn[1] * dep, j % 2 ? 1 : 0])
  }
  return smooth([...top, ...edge])
}

/** A bird wing: coverts, secondaries and long primaries, each feather with a shaft. */
function featherWing(c: Ctx, coat: Coat, col: string, s: number, folded: boolean): string {
  const P = c.paint
  const tipC = shadowOf(col, 0.22)
  const covC = highlightOf(col, 0.04)
  const fc: Coat = { ...coat, material: 'feathers' }
  const feather = (a: P, b: P, wd: number, color: string, key: string): string => {
    const d = norm([b[0] - a[0], b[1] - a[1]])
    const n: P = [-d[1], d[0]]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const shape = smooth([[a[0] + n[0] * wd * 0.5, a[1] + n[1] * wd * 0.5], [a[0] + d[0] * L * 0.6 + n[0] * wd * 0.5, a[1] + d[1] * L * 0.6 + n[1] * wd * 0.5], [b[0] + n[0] * wd * 0.2, b[1] + n[1] * wd * 0.2], [b[0] + d[0] * wd * 0.2, b[1] + d[1] * wd * 0.2, 0.2], [b[0] - n[0] * wd * 0.3, b[1] - n[1] * wd * 0.3], [a[0] + d[0] * L * 0.6 - n[0] * wd * 0.5, a[1] + d[1] * L * 0.6 - n[1] * wd * 0.5], [a[0] - n[0] * wd * 0.5, a[1] - n[1] * wd * 0.5]])
    const shaft = `M${f(a[0])} ${f(a[1])}L${f(a[0] + d[0] * L * 0.95)} ${f(a[1] + d[1] * L * 0.95)}`
    const extra = P.detail > 1 ? P.line(shaft, highlightOf(color, 0.35), wd * 0.08, { opacity: 0.65 }) + (c.baked ? barbs(c, shaft, L * 1.6, wd * 0.6, color) : '') : ''
    return coatShape(c, shape, fc, key, 'tail', { tint: color, plain: true, extra })
  }
  let svg = ''
  if (folded) {
    // Folded along the body: primaries reach back past the rump.
    const n = P.detail > 1 ? 5 : 3
    for (let i = n - 1; i >= 0; i--) {
      const k = i / (n - 1)
      svg += feather([-s * 0.25 - k * s * 0.08, -s * 0.05 + k * s * 0.08], [-s * (1.08 - k * 0.2), s * (0.2 + k * 0.1)], s * 0.2, i % 2 ? tipC : shadowOf(tipC, 0.08), `pf${i}`)
    }
    for (let i = P.detail > 1 ? 3 : 1; i >= 0; i--) svg += feather([-s * 0.05 - i * s * 0.1, -s * 0.12 + i * s * 0.02], [-s * (0.62 + i * 0.05), s * (0.12 + i * 0.03)], s * 0.22, i % 2 ? col : shadowOf(col, 0.06), `sf${i}`)
    svg += coatShape(c, coverts([s * 0.14, -s * 0.2], [-s * 0.62, -s * 0.12], s * 0.1, 5), fc, 'cov', 'body', { tint: covC, plain: true })
    svg += coatShape(c, coverts([s * 0.16, -s * 0.24], [-s * 0.3, -s * 0.2], s * 0.07, 4), fc, 'cov2', 'body', { tint: highlightOf(covC, 0.06), plain: true, outline: 0.7 })
    return svg
  }
  // Spread: primaries fan from the wrist, secondaries from the forearm, coverts on top.
  const wrist: P = [-s * 0.42, -s * 0.62]
  for (let i = 0; i < 5; i++) {
    const a = lerp(-2.35, -1.75, i / 4)
    const L = s * lerp(0.72, 0.5, i / 4)
    svg = feather(wrist, [wrist[0] + Math.cos(a) * L - s * 0.18, wrist[1] + Math.sin(a) * L * 0.55 - s * 0.05 + i * s * 0.1], s * 0.17, i % 2 ? tipC : shadowOf(tipC, 0.08), `pw${i}`) + svg
  }
  for (let i = 0; i < 5; i++) {
    const k = i / 4
    const a: P = [lerp(wrist[0], -s * 0.05, k), lerp(wrist[1], -s * 0.05, k)]
    svg += feather(a, [a[0] - s * 0.46 + k * s * 0.1, a[1] + s * 0.16 + k * s * 0.12], s * 0.19, i % 2 ? col : shadowOf(col, 0.06), `sw${i}`)
  }
  svg += coatShape(c, coverts([s * 0.06, -s * 0.04], [wrist[0] - s * 0.08, wrist[1] - s * 0.02], s * 0.12, 5, -0.55), fc, 'covw', 'body', { tint: covC, plain: true })
  return svg
}

function drawWings(c: Ctx, out: PartList, coat: Coat, span: number, frontal: boolean): void {
  const m = (c.cr as CreatureRig).m
  const style = c.sec('wings').s('style') || 'none'
  const folded = !frontal && m.plan === 'avian' && style === 'feather'
  const art = creatureWing(c, coat, span, folded)
  if (!art) return
  if (frontal) {
    // Front-facing plans turned around show their wings in front of the body.
    const z = c.view === 'back' ? CZ.acc - 12 : CZ.wingFar
    out.add('wingF', z, 'wing-l', art)
    out.add('wingN', z, 'wing-r', `<g transform="scale(-1 1)">${art}</g>`, false, artBounds(art, -1, 1))
    return
  }
  if (folded) {
    // Folded bird wings sit on the body: the far one peeks over the back.
    out.add('wingF', CZ.body - 0.8, 'wing-far', `<g transform="translate(${f(span * 0.14)} ${f(m.bodyR * 0.4)}) rotate(-3)">${art}</g>`, false, artBounds(art, 1, 1, span * 0.14, m.bodyR * 0.4, -3))
    const drop = m.bodyR * 0.55
    out.add('wingN', CZ.bodyDetail + 2, 'wing-near', `<g transform="translate(${f(span * 0.08)} ${f(drop)})">${art}</g>`, false, artBounds(art, 1, 1, span * 0.08, drop))
    return
  }
  out.add('wingF', CZ.wingFar, 'wing-far', `<g transform="rotate(12) scale(0.9)">${art}</g>`, false, artBounds(art, 0.9, 0.9, 0, 0, 12))
  out.add('wingN', CZ.wingNear, 'wing-near', art)
}

/* ---- Bodies ----------------------------------------------------------------- */

export function profileBodyGen(c: Ctx, out0: PartList): void {
  const out = boxedParts(out0)
  const cr = c.cr as CreatureRig
  const m = cr.m
  if (m.frontFacing) return
  const coat = coatOf(c)
  const P = c.paint
  const ex = c.sec('extras')
  const form = c.sec('form')
  const r = m.bodyR
  const segLen = m.bodyLen / m.spineSegs
  // Body shapes are drawn on spine1 (quadruped/avian/aquatic/insect) in its space.
  const [hx] = restOffset(c, 'spine1', 'hips')
  const [cx] = restOffset(c, 'spine1', 'chest')
  const x0 = hx - r * 0.35
  const x1 = cx + r * 0.3
  const xm = (x0 + x1) / 2
  const len = x1 - x0
  const arch = (form.n('arch') - 0.5) * r * 0.3
  const bellyK = form.n('belly')

  if (m.plan === 'quadruped') {
    // Withers, a slight dip, a rounded croup; a deep chest and a tucked flank.
    const tuck = r * lerp(0.3, 0.0, clamp(bellyK * 1.3, 0, 1))
    const bellyY = Math.max(r * 0.78, lerp(r * 0.72, m.bellyR * 1.0, bellyK))
    const ctl: SP[] = [
      [x0 + r * 0.22, -r * 0.84],
      [x0 + len * 0.42, -r * 0.8 - arch * 0.8],
      [x1 - r * 0.62, -r * 0.94 - arch * 0.2],
      [x1 + r * 0.0, -r * 0.62],
      [x1 + r * 0.24, r * 0.02],
      [x1 + r * 0.02, r * 0.62],
      [x1 - r * 0.42, r * 0.9],
      [xm + len * 0.04, bellyY],
      [x0 + r * 0.82, r * 0.72 - tuck],
      [x0 + r * 0.1, r * 0.66],
      [x0 - r * 0.18, r * 0.12],
      [x0 - r * 0.1, -r * 0.5],
    ]
    const d = furry(c, coat, smooth(ctl), 'body', (n, p) => (n[0] > 0.35 && p[1] > -r * 0.3 ? 1 : n[1] > 0.7 && p[0] > x0 + len * 0.3 && coat.fluff > 0.4 ? coat.fluff * 0.6 : 0), 1.1, [-0.3, 0.6])
    const belly = ellipse(xm + len * 0.1, bellyY * 0.8, len * 0.46, r * 0.46)
    out.add('spine1', CZ.body, 'body', coatShape(c, d, coat, 'body', 'body', { belly, offset: 0.1 }))
  } else if (m.plan === 'avian') {
    const rx = len * 0.5 + r * 0.3
    const ctl: SP[] = [
      [x0 - r * 0.28, r * 0.05],
      [xm - rx * 0.35, -r * 0.82],
      [x1 - r * 0.1, -r * 0.98],
      [x1 + r * 0.4, -r * 0.3],
      [x1 + r * 0.28, r * 0.42],
      [xm + rx * 0.1, r * 0.98],
      [x0 + r * 0.25, r * 0.78],
    ]
    const bodyD = coat.material === 'feathers' && coat.fluff > 0.4
      ? smooth(ctl) + furEdge(c, smooth(ctl), { depth: coat.unit * (0.6 + coat.fluff * 1.6), spacing: coat.unit * 3, where: (n) => (n[1] > 0.4 ? 1 : n[0] > 0.5 ? 0.6 : 0), lean: [0, 0.6], seed: 'down' })
      : furry(c, coat, smooth(ctl), 'body', (n) => (n[1] > 0.4 || n[0] > 0.5 ? 0.8 : 0), 1)
    const belly = ellipse(xm + r * 0.35, r * 0.32, rx * 0.62, r * 0.64)
    out.add('spine1', CZ.body, 'body', coatShape(c, bodyD, coat, 'body', 'body', { belly, offset: 0.1 }))
  } else if (m.plan === 'aquatic') {
    aquaticBody(c, out, coat, x0, x1, xm, r)
  } else if (m.plan === 'insectoid') {
    insectBody(c, out, coat, x0, cx, r)
  } else if (m.plan === 'serpent') {
    serpentBody(c, out, coat, segLen, r)
  }

  // Neck (not for fish, whose head is the body's front).
  if (m.plan !== 'aquatic') {
    const [nx, ny] = restOffset(c, 'neck', 'head')
    const neckR = m.plan === 'serpent' ? r * 0.92 : m.plan === 'insectoid' ? Math.min(m.headR * 0.35, r * 0.4) : Math.min(m.headR * 0.58, r * 0.62)
    const base: P = m.plan === 'quadruped' ? [-r * 0.2, r * 0.2] : [-r * 0.1, r * 0.1]
    const neck = tube([base, [nx * 0.5, ny * 0.5], [nx, ny]], [neckR * (m.plan === 'quadruped' ? 1.45 : 1.25), neckR * 1.05, neckR * 0.9])
    const neckD = m.plan === 'quadruped' || m.plan === 'avian' ? furry(c, coat, neck, 'neck', (n) => (n[0] > 0.4 && n[1] > -0.2 ? 1 : 0), 1.1, [-0.2, 0.8]) : neck
    // Birds' short necks tuck behind the body; a quadruped's neck overlaps its shoulders.
    const r0 = neckR * 1.25
    const r2 = neckR * 0.9
    const serpentNeck = m.plan === 'serpent'
      ? { shade: false as const, spec: 0, gloss: false, inkPath: `M${f(base[0])} ${f(base[1] - r0)}L${f(nx)} ${f(ny - r2)}M${f(base[0])} ${f(base[1] + r0)}L${f(nx)} ${f(ny + r2)}`, extra: tubeShading(c, coat, coat.primary, { x: base[0] - r0, y: -r0 * 0.95, w: nx - base[0] + r0 * 2, h: r0 * 1.9 }) }
      : {}
    // A quadruped's neck overlaps its shoulders: ink its sides but not the base, which blends
    // into the chest.
    let neckInk: { inkPath?: string } = {}
    if (m.plan === 'quadruped') {
      const R0 = neckR * 1.45
      let ink = ''
      let prev = false
      for (const [x, y] of samplePath(neck, R0 * 0.12)[0] ?? []) {
        const keep = Math.hypot(x - base[0], y - base[1]) > R0 * 1.02
        ink += keep ? `${prev ? 'L' : 'M'}${f(x)} ${f(y)}` : ''
        prev = keep
      }
      neckInk = { inkPath: ink || undefined }
    }
    out.add('neck', m.plan === 'avian' || m.plan === 'insectoid' ? CZ.body - 0.2 : CZ.neck, 'neck', coatShape(c, neckD, coat, 'neck', 'body', { flow: [-0.4, 0.9], ...serpentNeck, ...neckInk }))
  }

  mane(c, out, coat, r)

  // Back spikes.
  const spikes = ex.n('spikes')
  if (spikes > 0.05 && m.plan !== 'serpent') {
    const n = Math.round(3 + spikes * 6)
    const col = coat.accent === '#c0392b' ? coat.belly : coat.accent
    // One part per spike: culling can drop the ones outside a tight crop (a clipped layer
    // left entirely off-canvas crashes resvg).
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      const x = lerp(x0 + r * 0.3, x1 - r * 0.3, t)
      const y = -r * 0.86 - Math.sin(t * Math.PI) * arch * 0.5
      const h = r * (0.25 + spikes * 0.35) * (0.7 + Math.sin(t * Math.PI) * 0.4)
      const sp = smooth([[x - h * 0.42, y + h * 0.3], [x - h * 0.12, y - h * 0.45], [x + h * 0.1, y - h, 0], [x + h * 0.2, y - h * 0.3], [x + h * 0.38, y + h * 0.3]])
      out.add('spine1', CZ.body - 0.5, `spike-${i}`, P.shape(sp, col, { material: 'gem', spec: 0.3, inner: P.detail > 0 ? P.line(`M${f(x - h * 0.05)} ${f(y + h * 0.2)}Q${f(x)} ${f(y - h * 0.4)} ${f(x + h * 0.08)} ${f(y - h * 0.9)}`, highlightOf(col, 0.4), h * 0.06, { opacity: 0.6 }) : undefined }))
    }
  }

  shell(c, out, coat, x0, x1, xm, r)

  // Tail, legs, wings.
  if (m.plan !== 'serpent') drawTails(c, out, coat, m.tailLen, m.tailR)
  drawLegs(c, out, coat)
  drawWings(c, out, coat, m.bodyLen * 0.55 + r, false)
  // A dorsal fin on non-fish creatures when toggled (sea dragons, sharks-on-legs).
  if (ex.b('fins') && m.plan !== 'aquatic' && m.plan !== 'serpent') out.add('spine1', CZ.body - 1, 'dorsal', finShape(c, coat, [xm - r * 0.5, -r * 0.78], [xm + r * 0.45, -r * 0.82], r * 0.7, coat.accent === '#c0392b' ? mix(coat.primary, coat.secondary, 0.3) : coat.accent))
}

/** A webbed fin between two base points, rising `h`, with rays. */
function finShape(c: Ctx, coat: Coat, a: P, b: P, h: number, col: string, back = 0.35): string {
  const P = c.paint
  const tip: P = [lerp(a[0], b[0], 0.35) - h * back, Math.min(a[1], b[1]) - h]
  const d = smooth([[a[0], a[1] + h * 0.15], [lerp(a[0], tip[0], 0.5) - h * 0.05, lerp(a[1], tip[1], 0.55)], [tip[0], tip[1], 0], [lerp(tip[0], b[0], 0.6) + h * 0.08, lerp(tip[1], b[1], 0.45)], [b[0], b[1] + h * 0.15]])
  let rays = ''
  if (P.detail > 0) for (let i = 1; i < 5; i++) {
    const k = i / 5
    const s0: P = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)]
    rays += `M${f(s0[0])} ${f(s0[1])}Q${f(lerp(s0[0], tip[0], 0.5))} ${f(lerp(s0[1], tip[1], 0.6))} ${f(lerp(tip[0], s0[0], 0.12 + k * 0.1))} ${f(lerp(tip[1], s0[1], 0.1 + Math.abs(k - 0.4) * 0.3))}`
  }
  return coatShape(c, d, coat, `fin${Math.round(a[0])}`, 'tail', { tint: col, plain: true, coatMaterial: coat.material === 'fur' || coat.material === 'feathers' ? 'skin' : coat.material === 'scales' ? 'wet' : coat.material, extra: rays ? P.line(rays, shadowOf(col, 0.3), h * 0.05, { opacity: 0.5 }) : '' })
}

function aquaticBody(c: Ctx, out: PartList, coat: Coat, x0: number, x1: number, xm: number, r: number): void {
  const P = c.paint
  const ex = c.sec('extras')
  const shape = c.sec('face').s('headShape') || 'round'
  const blunt = shape === 'boxy' || shape === 'flat'
  const pointy = shape === 'wedge'
  // The rear narrows into a tail stock that the caudal fin (the tail part) continues.
  const ctl: SP[] = [
    [x0 - r * 0.42, -r * 0.15 + r * 0.3, 0.5],
    [x0 - r * 0.42, -r * 0.15 - r * 0.3, 0.5],
    [xm - r * 0.45, -r * 0.92],
    [x1 - r * (blunt ? 0.25 : 0.1), -r * (blunt ? 0.82 : 0.62)],
    [x1 + r * (pointy ? 0.85 : blunt ? 0.62 : 0.58), r * (pointy ? -0.02 : 0.05), pointy ? 0.3 : 0.7],
    [x1 + r * (blunt ? 0.45 : 0.2), r * 0.62],
    [xm - r * 0.25, r * 0.9],
  ]
  const d = smooth(ctl)
  const belly = ellipse(xm + r * 0.25, r * 0.62, (x1 - x0) * 0.52, r * 0.42)
  let extra = ''
  if (P.detail > 0) {
    // Gill line, lateral line; throat pleats on big blunt swimmers; gill slits on sharks.
    extra += P.line(`M${f(x1 - r * 0.4)} ${f(-r * 0.42)}Q${f(x1 - r * 0.18)} 0 ${f(x1 - r * 0.38)} ${f(r * 0.42)}`, shadowOf(coat.primary, 0.35), Math.max(P.lw * 0.8, r * 0.035), { opacity: 0.8 })
    if (pointy) for (let i = 0; i < 4; i++) extra += P.line(`M${f(x1 - r * (0.62 + i * 0.13))} ${f(-r * 0.25)}q${f(r * 0.05)} ${f(r * 0.25)} 0 ${f(r * 0.5)}`, shadowOf(coat.primary, 0.4), r * 0.03, { opacity: 0.7 })
    if (blunt && c.baked) for (let i = 0; i < 5; i++) extra += P.line(`M${f(x1 + r * 0.2 - i * r * 0.05)} ${f(r * (0.5 + i * 0.07))}Q${f(xm + r * 0.2)} ${f(r * (0.72 + i * 0.05))} ${f(xm - r * 0.4)} ${f(r * (0.68 + i * 0.04))}`, shadowOf(coat.belly, 0.3), r * 0.02, { opacity: 0.55 })
    if (c.baked && P.detail > 1) extra += P.line(`M${f(x1 - r * 0.45)} ${f(-r * 0.05)}Q${f(xm)} ${f(-r * 0.12)} ${f(x0 + r * 0.05)} ${f(r * 0.02)}`, highlightOf(coat.primary, 0.4), r * 0.025, { opacity: 0.5, dash: `${f(r * 0.06)} ${f(r * 0.05)}` })
  }
  out.add('spine1', CZ.body, 'body', coatShape(c, d, coat, 'body', 'body', { belly, offset: 0.08, extra }))
  // Pectoral fin (near), pelvic and anal fins (below, behind the body).
  const finC = mix(coat.primary, coat.secondary, 0.3)
  const pect = smooth([[xm + r * 0.35, r * 0.15], [xm - r * 0.15, r * 0.42], [xm - r * 0.35, r * 0.72, 0], [xm + r * 0.02, r * 0.62], [xm + r * 0.4, r * 0.35]])
  out.add('spine1', CZ.bodyDetail, 'pectoral', coatShape(c, pect, coat, 'pect', 'tail', { tint: finC, plain: true, coatMaterial: coat.material === 'scales' ? 'wet' : coat.material === 'fur' ? 'skin' : coat.material }))
  out.add('spine1', CZ.body - 1, 'anal', finShape(c, coat, [x0 + r * 0.55, r * 0.72], [x0 + r * 0.05, r * 0.45], -r * 0.4, finC, -0.2))
  if (ex.b('fins')) out.add('spine1', CZ.body - 1, 'dorsal', finShape(c, coat, [xm - r * 0.65, -r * 0.8], [xm + r * 0.45, -r * 0.85], r * (pointy ? 0.85 : 0.65), finC, pointy ? 0.25 : 0.45))
}

function insectBody(c: Ctx, out: PartList, coat: Coat, x0: number, cx: number, r: number): void {
  const P = c.paint
  const m = (c.cr as CreatureRig).m
  const spider = m.legs >= 8
  // Abdomen: an egg tapering backward, segment lines wrapping it.
  const ax = x0 + r * 0.15
  const aw = r * (spider ? 1.15 : 1.08)
  const ah = r * (spider ? 0.95 : 0.82)
  const abd = smooth([[ax + aw * 0.95, -ah * 0.25], [ax + aw * 0.4, -ah * 0.95], [ax - aw * 0.45, -ah * 0.85], [ax - aw * 1.05, -ah * 0.05, 0.6], [ax - aw * 0.5, ah * 0.85], [ax + aw * 0.45, ah * 0.92], [ax + aw * 0.98, ah * 0.3]])
  let segs = ''
  if (P.detail > 0 && !spider) for (let i = 1; i <= 3; i++) {
    const x = ax + aw * (0.55 - i * 0.38)
    segs += `M${f(x + aw * 0.12)} ${f(-ah)}Q${f(x - aw * 0.12)} 0 ${f(x + aw * 0.12)} ${f(ah)}`
  }
  const segLines = segs ? P.line(segs, shadowOf(coat.primary, 0.3), r * 0.035, { opacity: 0.5 }) : ''
  const fuzzy = coat.material === 'fur'
  const abdD = fuzzy ? furry(c, coat, abd, 'abd', () => 0.7, 0.7) : abd
  out.add('spine1', CZ.body, 'abdomen', coatShape(c, abdD, coat, 'abdomen', 'body', { offset: 0.1, extra: segLines }))
  // Waist (petiole) and thorax.
  const tx = cx - r * 0.12
  const tw = r * (spider ? 0.62 : 0.55)
  const th = r * (spider ? 0.55 : 0.5)
  const thorax = smooth([[tx + tw, -th * 0.1], [tx + tw * 0.4, -th], [tx - tw * 0.5, -th * 0.92], [tx - tw * 1.05, -th * 0.05], [tx - tw * 0.55, th * 0.9], [tx + tw * 0.45, th * 0.88]])
  const thD = fuzzy ? furry(c, coat, thorax, 'thorax', (n) => (n[1] < 0.2 ? 1 : 0.4), 0.9) : thorax
  const thC = fuzzy && coat.pattern === 'bands' ? coat.patternColor : shadowOf(coat.primary, 0.08)
  out.add('spine1', CZ.body + 1, 'thorax', coatShape(c, thD, coat, 'thorax', 'body', { tint: thC, plain: fuzzy && coat.pattern === 'bands' }))
  if (!spider) out.add('spine1', CZ.body - 0.5, 'waist', P.shape(tube([[tx - tw * 0.8, 0], [ax + aw * 0.8, -ah * 0.05]], [th * 0.35, th * 0.32]), shadowOf(coat.primary, 0.2), { material: 'chitin' }))
}

/**
 * Shading for a horizontal tube segment (serpent bodies): a vertical gradient in the
 * Painter's own tones, identical on every segment so a bending chain reads as one body.
 */
function tubeShading(c: Ctx, coat: Coat, base: string, box: { x: number; y: number; w: number; h: number }): string {
  const P = c.paint
  if (P.style.shading === 'flat' || P.detail < 1) return ''
  const S = P.tone(base, 'shadow')
  const H = P.tone(base, 'highlight')
  const glossy = coat.material === 'wet' || coat.material === 'scales' || coat.material === 'chitin'
  const cel = P.style.shading !== 'soft'
  const stops: [number, string, number][] = cel
    ? [[0, S, 0.25], [0.1, H, 0.55], [0.3, H, 0.3], [0.4, H, 0], [0.6, S, 0], [0.62, S, 0.55], [1, S, 0.7]]
    : [[0, S, 0.25], [0.18, H, 0.5], [0.42, H, 0], [0.55, S, 0], [1, S, 0.7]]
  if (glossy) stops.splice(2, 0, [0.2, '#ffffff', 0.55], [0.23, H, 0.35])
  const id = c.defs.add(`tube${S.slice(1)}${H.slice(1)}${cel ? 'c' : 's'}${glossy ? 'g' : ''}`, (gid) =>
    el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, ...stops.map(([o, col, a]) => el('stop', { offset: f(o), 'stop-color': col, 'stop-opacity': f(a) }))),
  )
  return el('rect', { x: f(box.x), y: f(box.y), width: f(box.w), height: f(box.h), fill: `url(#${id})` })
}

function serpentBody(c: Ctx, out: PartList, coat: Coat, segLen: number, r: number): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  // Segments overlap at the joints and are inked only along their top and bottom edges, so
  // the body reads as one continuous tube that still bends with every bone. Their shading
  // is a band gradient across the tube rather than per-segment volume.
  const ext = segLen * 0.18
  if (c.baked) {
    // A still: one continuous body along the rest-pose spine, so markings, scales and
    // shading flow without a seam at any joint.
    const w = rest(c)
    const pts: P[] = []
    const radii: number[] = []
    const tailB = [...cr.tail].reverse()
    const L = m.tailLen / m.tailSegs
    const last = w.get(tailB[0])
    if (last) {
      pts.push([last[4] - last[0] * L, last[5] - last[1] * L])
      radii.push(r * 0.06)
    }
    tailB.forEach((b, i) => {
      const mt = w.get(b)
      if (!mt) return
      pts.push([mt[4], mt[5]])
      radii.push(r * 0.97 * (1 - (cr.tail.length - 1 - i) / cr.tail.length))
    })
    for (const b of cr.spine) {
      const mt = w.get(b)
      if (!mt) continue
      pts.push([mt[4], mt[5]])
      radii.push(r)
    }
    const ch = w.get(cr.spine[cr.spine.length - 1])
    if (ch) {
      pts.push([ch[4] + ch[0] * segLen, ch[5] + ch[1] * segLen])
      radii.push(r)
    }
    const spine = pts
    const body = tube(spine, radii, 'point', 'round')
    // Belly: a band along the underside of the same spine.
    const bellyPts: P[] = spine.map((p, i) => {
      const a = spine[Math.max(0, i - 1)]
      const b = spine[Math.min(spine.length - 1, i + 1)]
      const d = norm([b[0] - a[0], b[1] - a[1]])
      return [p[0] - d[1] * radii[i] * 0.72, p[1] + d[0] * radii[i] * 0.72]
    })
    const belly = tube(bellyPts, radii.map((x) => x * 0.5))
    out.add('root', CZ.body, 'serpent', coatShape(c, body, coat, 'serpent', 'body', { belly, offset: 0.08, gloss: false }))
    serpentTailTip(c, out, coat, r)
    return
  }
  const tubeO = { shade: false as const, spec: 0, gloss: false }
  for (const b of cr.spine) {
    const seg = tube([[-ext, 0], [segLen / 2, 0], [segLen + ext, 0]], [r, r, r], 'round', 'round')
    const ink = `M${f(-ext * 0.6)} ${f(-r)}L${f(segLen + ext * 0.6)} ${f(-r)}M${f(-ext * 0.6)} ${f(r)}L${f(segLen + ext * 0.6)} ${f(r)}`
    const belly = `M${f(-ext - r)} ${f(r * 0.3)}H${f(segLen + ext + r)}V${f(r * 1.1)}H${f(-ext - r)}Z`
    const shade = tubeShading(c, coat, coat.primary, { x: -ext - r, y: -r, w: segLen + ext * 2 + r * 2, h: r * 2 })
    out.add(b, CZ.body, `seg-${b}`, coatShape(c, seg, coat, b, 'body', { ...tubeO, belly, bellySoft: 'top', inkPath: ink, extra: shade }))
  }
  cr.tail.forEach((b, i) => {
    const r0 = r * (1 - i / cr.tail.length) * 0.97
    const r1 = r * (1 - (i + 1) / cr.tail.length) * 0.97
    const L = m.tailLen / m.tailSegs
    const last = i === cr.tail.length - 1
    const seg = tube([[ext, 0], [-L / 2, 0], [-L - (last ? 0 : ext), 0]], [r0, (r0 + r1) / 2, Math.max(r1, r * 0.06)], 'round', last ? 'point' : 'round')
    const ink = `M${f(ext * 0.6)} ${f(-r0)}L${f(-L - (last ? 0 : ext * 0.6))} ${f(-Math.max(r1, r * 0.06))}M${f(ext * 0.6)} ${f(r0)}L${f(-L - (last ? 0 : ext * 0.6))} ${f(Math.max(r1, r * 0.06))}`
    const belly = `M${f(ext + r)} ${f(r0 * 0.3)}L${f(-L - r)} ${f(r1 * 0.3)}V${f(r0 * 1.1)}H${f(ext + r)}Z`
    // A tapering segment: shade it as a tube of its average radius (close enough, and it
    // lines up with its neighbours at the joints).
    const shade = tubeShading(c, coat, coat.primary, { x: -L - r, y: -(r0 + r1) / 2, w: L + ext + r * 2, h: r0 + r1 })
    out.add(b, CZ.body - 1 - i, `tail-${b}`, coatShape(c, seg, coat, b, 'tail', { ...tubeO, belly, bellySoft: 'top', inkPath: last ? undefined : ink, extra: shade }))
  })
  serpentTailTip(c, out, coat, r)
}

/** A serpent's tail ornament (flame, tuft, spade, fin, feathers) at the end of its tail. */
function serpentTailTip(c: Ctx, out: PartList, coat: Coat, r: number): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const style = c.sec('tail').s('style') || 'thin'
  const lastB = cr.tail[cr.tail.length - 1]
  if (lastB && (style === 'flame' || style === 'tuft' || style === 'spade' || style === 'fin' || style === 'feather')) {
    const L = m.tailLen / m.tailSegs
    const len = m.tailLen * 0.35
    const tipArt = tailArt(c, coat, len, r * 0.25)
    out.add(lastB, CZ.body - 1 - cr.tail.length, 'tail-tip', `<g transform="translate(${f(-L)} 0)">${tipArt}</g>`, false, artBounds(tipArt, 1, 1, -L, 0))
  }
}

function mane(c: Ctx, out: PartList, coat: Coat, r: number): void {
  const m = (c.cr as CreatureRig).m
  const kind = c.sec('extras').s('mane') || 'none'
  if (kind === 'none' || m.plan === 'aquatic') return
  const P = c.paint
  const R = m.headR
  const col = coat.accent === '#c0392b' ? shadowOf(coat.primary, 0.3) : coat.accent
  const hair: Coat = { ...coat, material: 'fur', fluff: Math.max(coat.fluff, 0.5) }
  if (kind === 'lion') {
    const ring: SP[] = []
    const rng = createRng(hash32(c.dna.seed, 'mane'))
    const n = 22
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const k = i % 2 ? 1.32 : 1.62 * rng.range(0.92, 1.08)
      ring.push([Math.cos(a) * R * k - R * 0.22, Math.sin(a) * R * k * 0.95 + R * 0.1, i % 2 ? 0.8 : 0.1])
    }
    const inner = ring.map((p, i) => [p[0] * 0.8 - R * 0.05, p[1] * 0.8 + R * 0.02, i % 2 ? 0.8 : 0.15] as SP)
    let svg = coatShape(c, smooth(ring), hair, 'mane', 'head', { tint: shadowOf(col, 0.12), plain: true, flow: 'radial', offset: 0.08 })
    svg += coatShape(c, smooth(inner), hair, 'mane2', 'head', { tint: col, plain: true, flow: 'radial', offset: 0.06, outline: 0.6 })
    out.add('head', CZ.mane, 'mane', svg)
    return
  }
  const [nx, ny] = restOffset(c, 'neck', 'head')
  const locks: string[] = []
  const n = kind === 'crest' ? 8 : 7
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const bx = lerp(-r * 0.25, nx - R * 0.1, t)
    const by = lerp(-r * 0.35, ny - R * 0.55, t)
    const len = r * (kind === 'punk' ? 0.85 : kind === 'crest' ? 0.45 : 0.62) * (kind === 'horse' ? lerp(1.1, 0.8, t) : 1)
    if (kind === 'horse') {
      // Locks falling down the near side of the neck.
      locks.push(smooth([[bx - len * 0.3, by + len * 0.05], [bx - len * 0.15, by - len * 0.35], [bx + len * 0.35, by - len * 0.1], [bx + len * 0.25, by + len * 0.55], [bx - len * 0.05, by + len * 1.05, 0], [bx - len * 0.12, by + len * 0.5]]))
    } else if (kind === 'crest') {
      locks.push(smooth([[bx - len * 0.3, by + len * 0.2], [bx - len * 0.45, by - len * 0.7], [bx - len * 0.35, by - len * 1.05, 0], [bx + len * 0.05, by - len * 0.6], [bx + len * 0.3, by + len * 0.1]]))
    } else {
      locks.push(smooth([[bx - len * 0.22, by + len * 0.1], [bx - len * 0.28, by - len * 0.55], [bx - len * 0.12, by - len, 0], [bx + len * 0.05, by - len * 0.5], [bx + len * 0.22, by]]))
    }
  }
  const matC: Coat = kind === 'crest' ? { ...coat, material: coat.material === 'fur' ? 'skin' : coat.material } : hair
  out.add('neck', CZ.neck + 1, 'mane', coatShape(c, locks.join(''), matC, 'mane', 'tail', { tint: col, plain: true, flow: [-0.4, 1], extra: kind === 'crest' && P.detail > 0 ? P.line(locks.map((_, i) => { const t = i / (n - 1); return `M${f(lerp(-r * 0.25, nx - R * 0.1, t))} ${f(lerp(-r * 0.35, ny - R * 0.55, t))}l${f(-r * 0.12)} ${f(-r * 0.3)}` }).join(''), shadowOf(col, 0.35), r * 0.03, { opacity: 0.6 }) : '' }))
}

function shell(c: Ctx, out: PartList, coat: Coat, x0: number, x1: number, xm: number, r: number): void {
  const cr = c.cr as CreatureRig
  const kind = c.sec('extras').s('shell') || 'none'
  if (kind === 'none') return
  const P = c.paint
  const col = coat.accent
  if (kind === 'turtle') {
    if (cr.m.plan === 'insectoid') {
      // Elytra: a glossy wing case over the abdomen, with a seam and the coat's spots.
      const ax = x0 + r * 0.15
      const d = smooth([[x1 - r * 0.72, -r * 0.35], [xm - r * 0.25, -r * 1.02], [ax - r * 0.8, -r * 0.75], [ax - r * 1.12, -r * 0.05, 0.6], [ax - r * 0.55, r * 0.55], [xm, r * 0.35], [x1 - r * 0.62, r * 0.1]])
      const seam = P.detail > 0 ? P.line(`M${f(x1 - r * 0.72)} ${f(-r * 0.3)}Q${f(xm - r * 0.4)} ${f(-r * 0.45)} ${f(ax - r * 1.02)} ${f(-r * 0.02)}`, shadowOf(col, 0.45), r * 0.05, { opacity: 0.8 }) : ''
      const shellCoat: Coat = { ...coat, primary: col, material: coat.texture === 'metal' || coat.texture === 'scales' ? 'chitin' : 'chitin' }
      out.add('spine1', CZ.body + 3, 'shell', coatShape(c, d, shellCoat, 'elytra', 'body', { tint: col, plain: coat.pattern !== 'spots', extra: seam, gloss: true }))
      return
    }
    const top = -r * 1.28
    const d = smooth([[x0 - r * 0.2, r * 0.25, 0.5], [x0 + r * 0.1, -r * 0.7], [xm - r * 0.2, top], [x1 - r * 0.25, -r * 1.05], [x1 + r * 0.2, r * 0.05], [x1 + r * 0.25, r * 0.28, 0.5]])
    const rim = smooth([[x0 - r * 0.28, r * 0.2], [x1 + r * 0.32, r * 0.22], [x1 + r * 0.28, r * 0.42, 0.5], [x0 - r * 0.22, r * 0.42, 0.5]])
    let scutes = ''
    if (P.detail > 0) {
      // Vertebral and costal scutes as soft hexagons, lighter centres (growth rings).
      const cols = 3
      for (let i = 0; i < cols; i++) {
        const cxs = lerp(x0 + r * 0.35, x1 - r * 0.35, (i + 0.5) / cols)
        const cy = lerp(-r * 0.62, -r * 0.82, Math.sin(((i + 0.5) / cols) * Math.PI))
        const w = (x1 - x0) / cols * 0.42
        const hex = smooth([[cxs - w, cy], [cxs - w * 0.5, cy - w * 0.62], [cxs + w * 0.5, cy - w * 0.62], [cxs + w, cy], [cxs + w * 0.5, cy + w * 0.62], [cxs - w * 0.5, cy + w * 0.62]].map((p) => [p[0], p[1], 0.35] as SP))
        scutes += hex
      }
      scutes = P.line(scutes, shadowOf(col, 0.4), r * 0.05, { opacity: 0.75 }) + (c.baked ? P.flat(scutes, highlightOf(col, 0.25), 0.35) : '')
    }
    const svg = coatShape(c, d, { ...coat, primary: col, material: 'scales' }, 'carapace', 'body', { tint: col, plain: true, extra: scutes, offset: 0.12 }) + P.shape(rim, shadowOf(col, 0.12), { material: 'scales' })
    out.add('spine1', CZ.body + 3, 'shell', svg)
    return
  }
  // Snail: a spiral shell with growth ridges, glossy, riding the back.
  const serp = cr.m.plan === 'serpent'
  const segL = cr.m.bodyLen / cr.m.spineSegs
  const bone = serp ? (cr.spine[Math.floor(cr.spine.length * 0.42)] ?? 'spine1') : 'spine1'
  const R = r * (serp ? 1.9 : 1.15)
  const scx = serp ? segL * 0.5 : xm - r * 0.15
  const scy = serp ? -r * 0.35 - R * 0.62 : -r * 0.55 - R * 0.55
  let spiral = ''
  for (let i = 0; i <= 34; i++) {
    const a = i * 0.42
    const rr = R * 0.92 * (1 - i / 38)
    spiral += `${i ? 'L' : 'M'}${f(scx + Math.cos(a) * rr)} ${f(scy + Math.sin(a) * rr)}`
  }
  let ridges = ''
  if (P.detail > 1 && c.baked) for (let i = 0; i < 14; i++) {
    const a = i * 0.45
    ridges += `M${f(scx + Math.cos(a) * R * 0.3)} ${f(scy + Math.sin(a) * R * 0.3)}L${f(scx + Math.cos(a) * R * 0.95)} ${f(scy + Math.sin(a) * R * 0.95)}`
  }
  const inner = P.line(spiral, shadowOf(col, 0.4), r * 0.1) + P.line(spiral, highlightOf(col, 0.35), r * 0.035, { opacity: 0.7 }) + (ridges ? P.line(ridges, shadowOf(col, 0.25), r * 0.025, { opacity: 0.35 }) : '')
  out.add(bone, CZ.body + 3, 'shell', P.shape(ellipse(scx, scy, R, R * 0.98), col, { material: 'plastic', spec: 0.5, inner }))
}

export { drawWings, drawLegs, foot }

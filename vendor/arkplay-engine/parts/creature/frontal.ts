/* Front-facing plans: blobs, cephalopods and robots. Their face sits on the body (blob,
 * octopus, retro-TV robot) or on a head on top (robot).
 *
 * Blobs are gel, mochi, ghosts, clouds and fire; octopuses get curling arms with suckers,
 * jellyfish a translucent bell with a frilled skirt, oral arms and trailing tentacles;
 * robots are panelled shells with bevels, screws, vents, glowing lights and glass screens. */

import { lerp, norm, type P } from '../../core/math.ts'
import { circle, ellipse, f, roundRect, scallop, smooth, tube, type SP } from '../../core/path.ts'
import { createRng, hash32 } from '../../core/rng.ts'
import { el } from '../../core/svg.ts'
import type { Ctx, PartList } from '../../render/context.ts'
import type { CreatureRig } from '../../rig/creature.ts'
import { toLch } from '../../core/color.ts'
import { boxedParts, coatOf, coatShape, glowFill, highlightOf, mix, shadowOf, softFill, type Coat } from './coat.ts'
import { drawWings, foot } from './body.ts'
import { CZ } from './head.ts'

/** The TV robot's screen, head space (its face is drawn there). */
export function tvScreen(R: number): { x: number; y: number; w: number; h: number } {
  return { x: -R * 0.98, y: -R * 0.64, w: R * 1.46, h: R * 1.24 }
}

export function frontalBodyGen(c: Ctx, out0: PartList): void {
  const out = boxedParts(out0)
  const cr = c.cr as CreatureRig
  const m = cr.m
  if (!m.frontFacing) return
  const coat = coatOf(c)
  if (m.plan === 'blob') blob(c, out, coat)
  else if (m.plan === 'cephalopod') cephalopod(c, out, coat)
  else if (m.plan === 'robot') robot(c, out, coat)

  // Legs (robot, or a blob given legs): wheels, boots, pads.
  const limbs = c.sec('limbs')
  const P = c.paint
  if (m.plan === 'robot' || (m.plan === 'blob' && m.legs > 0)) {
    const feet = limbs.s('feet') || 'pads'
    const metal = m.plan === 'robot'
    for (const leg of cr.legs) {
      const up = c.skel.get(leg.upper)
      const lo = c.skel.get(leg.lower)
      if (!up || !lo) continue
      const lr = m.legR
      const tint = shadowOf(coat.primary, leg.near ? 0.08 : 0.16)
      if (metal) {
        const piston = P.shape(roundRect(-lr * 0.55, 0, lr * 1.1, up.len, lr * 0.3), shadowOf(coat.primary, 0.35), { material: 'metal' })
        out.add(leg.upper, CZ.legFar, `${leg.upper}-art`, piston + P.shape(circle(0, 0, lr * 0.95), coat.secondary, { material: 'metal' }))
        const shin = roundRect(-lr * 0.9, -lr * 0.2, lr * 1.8, lo.len * 0.95, lr * 0.45)
        const detail = P.detail > 0 ? P.line(`M${f(-lr * 0.6)} ${f(lo.len * 0.35)}H${f(lr * 0.6)}M${f(-lr * 0.6)} ${f(lo.len * 0.45)}H${f(lr * 0.6)}`, shadowOf(tint, 0.35), lr * 0.1, { opacity: 0.6 }) : ''
        out.add(leg.lower, CZ.legFar + 0.5, `${leg.lower}-art`, P.shape(shin, tint, { material: coat.material === 'plastic' ? 'plastic' : 'metal', inner: detail }) + P.shape(circle(0, 0, lr * 0.75), coat.secondary, { material: 'metal', outline: 0.6 }))
      } else {
        out.add(leg.upper, CZ.legFar, `${leg.upper}-art`, coatShape(c, tube([[0, 0], [0, up.len]], [lr, lr * 0.9]), coat, `${leg.upper}`, 'leg', { tint }))
        out.add(leg.lower, CZ.legFar + 0.5, `${leg.lower}-art`, coatShape(c, tube([[0, 0], [0, lo.len]], [lr * 0.9, lr * 0.85]), coat, `${leg.lower}`, 'leg', { tint }))
      }
      out.add(leg.foot, CZ.legFar + 1, `${leg.foot}-art`, foot(c, feet, lr * 1.2, coat, tint, true))
    }
  }
  drawWings(c, out, coat, m.bodyR * 1.4, true)
}

/* ---- Blobs ------------------------------------------------------------------ */

function blob(c: Ctx, out: PartList, coat: Coat): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const P = c.paint
  const r = m.bodyR
  const form = c.sec('form')
  const shape = form.s('blobShape') || 'drop'
  const armsSetting = c.sec('limbs').s('arms') || 'auto'
  const back = c.view === 'back'
  let d: string
  switch (shape) {
    case 'mochi':
      d = smooth([[-r * 1.18, r * 0.66, 0.35], [-r * 1.08, -r * 0.12], [-r * 0.55, -r * 0.72], [0, -r * 0.82], [r * 0.55, -r * 0.72], [r * 1.08, -r * 0.12], [r * 1.18, r * 0.66, 0.35], [r * 0.6, r * 0.96], [-r * 0.6, r * 0.96]])
      break
    case 'ghost': {
      const bottom: SP[] = []
      for (let i = 0; i <= 8; i++) bottom.push([lerp(r * 0.95, -r * 0.95, i / 8), r * (i % 2 ? 0.74 : 1.06), i % 2 ? 1 : 0.35])
      d = smooth([[-r * 0.98, r * 0.55], [-r * 1.0, -r * 0.3], [-r * 0.6, -r * 0.92], [0, -r * 1.06], [r * 0.6, -r * 0.92], [r * 1.0, -r * 0.3], [r * 0.98, r * 0.55], ...bottom])
      break
    }
    case 'cloud': {
      const ring: P[] = []
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2
        ring.push([Math.cos(a) * r * 1.05, Math.sin(a) * r * 0.86 + (Math.sin(a) > 0.6 ? r * 0.05 : 0)])
      }
      d = scallop(ring, 0.3)
      break
    }
    case 'flame':
      d = smooth([[-r * 0.9, r * 0.45], [-r * 0.98, -r * 0.2], [-r * 0.62, -r * 0.62], [-r * 0.42, -r * 1.3, 0], [-r * 0.1, -r * 0.82], [r * 0.18, -r * 1.58, 0], [r * 0.46, -r * 0.8], [r * 0.72, -r * 1.12, 0], [r * 0.95, -r * 0.3], [r * 0.9, r * 0.5], [r * 0.45, r * 0.93], [-r * 0.45, r * 0.93]])
      break
    default:
      d = smooth([[-r * 0.98, r * 0.3], [-r * 0.68, -r * 0.45], [-r * 0.2, -r * 0.95], [r * 0.08, -r * 1.38, 0.3], [r * 0.38, -r * 0.82], [r * 0.82, -r * 0.35], [r * 1.0, r * 0.32], [r * 0.72, r * 0.9], [0, r * 1.0], [-r * 0.72, r * 0.9]])
  }
  const mat = coat.material
  const extras: string[] = []
  if (shape === 'flame') {
    // Fire: layered tongues, a hot core and a halo behind.
    const outer = coat.primary
    const coreC = coat.secondary
    const halo = c.baked && P.detail > 1 ? el('ellipse', { cx: 0, cy: f(-r * 0.2), rx: f(r * 1.6), ry: f(r * 1.7), fill: glowFill(c, outer, 0.45, 0.35) }) : ''
    const midD = smooth([[-r * 0.66, r * 0.5], [-r * 0.72, -r * 0.1], [-r * 0.32, -r * 0.5], [-r * 0.2, -r * 0.95, 0], [0, -r * 0.55], [r * 0.2, -r * 1.12, 0], [r * 0.38, -r * 0.52], [r * 0.72, -r * 0.1], [r * 0.66, r * 0.5], [0, r * 0.8]])
    const coreD = smooth([[-r * 0.42, r * 0.55], [-r * 0.4, r * 0.05], [-r * 0.08, -r * 0.4], [r * 0.05, -r * 0.72, 0], [r * 0.2, -r * 0.3], [r * 0.42, r * 0.05], [r * 0.42, r * 0.55], [0, r * 0.72]])
    const body = P.shape(d, outer, { shade: false, paint: P.linear(`fire${outer.slice(1)}`, [[0, shadowOf(outer, 0.1)], [0.6, outer], [1, mix(outer, coreC, 0.4)]], [0.5, 0], [0.5, 1]) })
    const inner = P.shape(midD, mix(outer, coreC, 0.55), { shade: false, outline: false }) + P.shape(coreD, coreC, { shade: false, outline: false }) + (P.detail > 0 ? el('ellipse', { cx: 0, cy: f(r * 0.35), rx: f(r * 0.34), ry: f(r * 0.3), fill: glowFill(c, '#fffbe6', 0.85, 0.35) }) : '')
    out.add('body', CZ.body, 'blob', halo + body + inner)
    let sparks = ''
    if (P.detail > 1) {
      const rng = createRng(hash32(c.dna.seed, 'sparks'))
      for (let i = 0; i < 5; i++) sparks += circle(rng.range(-r, r), -r * rng.range(0.9, 1.6), r * rng.range(0.025, 0.05))
    }
    if (sparks) out.add('body', CZ.bodyDetail, 'sparks', P.flat(sparks, coreC, 0.9))
  } else if (shape === 'cloud') {
    const puffs: string[] = []
    const rng = createRng(hash32(c.dna.seed, 'cloud'))
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.2
      puffs.push(circle(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.5, r * rng.range(0.42, 0.55)))
    }
    puffs.push(circle(0, 0, r * 0.7))
    out.add('body', CZ.body, 'blob', P.union(puffs, coat.primary, { material: 'cloth', offset: 0.12, inner: P.detail > 0 ? el('ellipse', { cx: 0, cy: f(r * 0.55), rx: f(r * 0.95), ry: f(r * 0.35), fill: softFill(c, shadowOf(coat.primary, 0.12), 'radial', 0.4) }) : undefined }))
  } else {
    // A paler underside only when the belly colour is paler (a dark one reads as a hole).
    const belly = shape === 'mochi' && toLch(coat.belly).l >= toLch(coat.primary).l - 0.04 ? ellipse(0, r * 0.62, r * 1.0, r * 0.42) : undefined
    if (shape === 'ghost' && c.baked && P.detail > 1) extras.push(el('ellipse', { cx: 0, cy: 0, rx: f(r * 1.45), ry: f(r * 1.5), fill: glowFill(c, mix(coat.primary, '#bfe0ff', 0.4), 0.3, 0.3) }))
    // Slime sits in a little puddle of itself.
    if ((mat === 'slime' || mat === 'jelly') && P.detail > 0) extras.push(P.shape(ellipse(0, r * 0.98, r * 0.95, r * 0.14), shadowOf(coat.primary, 0.05), { shade: false, attrs: { 'fill-opacity': 0.7 }, outline: 0.6 }))
    const ghostFade = shape === 'ghost' && P.detail > 0 ? el('path', { d, fill: P.linear(`ghf${coat.primary.slice(1)}`, [[0.45, '#ffffff', 0], [1, mix(coat.primary, '#9fb4ff', 0.35), 0.55]], [0, 0], [0, 1]) }) : ''
    extras.push(coatShape(c, d, coat, 'blob', 'body', { belly, tint: coat.primary, flow: 'radial', extra: ghostFade }))
    out.add('body', CZ.body, 'blob', extras.join(''))
  }
  if (!back && (shape === 'mochi' || shape === 'drop') && P.detail > 0 && mat !== 'slime') {
    // A soft contact shadow where the body squashes onto the ground.
    out.add('body', CZ.bodyDetail, 'squash', el('ellipse', { cx: 0, cy: f(r * 0.9), rx: f(r * 0.8), ry: f(r * 0.09), fill: softFill(c, shadowOf(coat.primary, 0.3), 'radial', 0.2) }))
  }
  if (armsSetting === 'stubby' || armsSetting === 'long') {
    for (const s of ['L', 'R'] as const) {
      const sx = s === 'L' ? 1 : -1
      const len = r * (armsSetting === 'long' ? 0.8 : 0.4)
      const arm = tube([[0, 0], [sx * r * 0.18, len * 0.5], [sx * r * 0.3, len]], [r * 0.2, r * 0.18, r * 0.15])
      out.add(`arm${s}a`, CZ.legNear, `arm-${s}`, coatShape(c, arm, coat, `arm${s}`, 'leg', { plain: true }))
    }
  }
}

/* ---- Cephalopods ------------------------------------------------------------- */

function cephalopod(c: Ctx, out: PartList, coat: Coat): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const P = c.paint
  const r = m.bodyR
  const limbs = c.sec('limbs')
  const jelly = limbs.n('thickness') < 0.35
  const len = m.legLen * lerp(0.7, 1.3, limbs.n('length'))
  const tr = r * lerp(0.08, 0.2, limbs.n('thickness'))
  if (jelly) {
    // Bell: a dome with a scalloped skirt; oral arms and trailing tentacles beneath.
    const skirt: SP[] = []
    for (let i = 0; i <= 10; i++) skirt.push([lerp(r * 1.02, -r * 1.02, i / 10), r * (i % 2 ? 0.46 : 0.58), i % 2 ? 1 : 0.4])
    const bell = smooth([[-r * 1.02, r * 0.46], [-r * 0.98, -r * 0.3], [-r * 0.6, -r * 0.95], [0, -r * 1.12], [r * 0.6, -r * 0.95], [r * 0.98, -r * 0.3], [r * 1.02, r * 0.46], ...skirt])
    const lobes = P.detail > 0 ? el('path', { d: [-0.32, 0.32].map((x) => ellipse(x * r, -r * 0.1, r * 0.22, r * 0.3)).join(''), fill: softFill(c, mix(coat.primary, coat.accent === '#c0392b' ? '#ff9ad0' : coat.accent, 0.5), 'radial', 0.4) }) : ''
    out.add('body', CZ.body, 'mantle', coatShape(c, bell, coat, 'mantle', 'body', { tint: coat.primary, extra: lobes }))
    cr.legs.forEach((leg, i) => {
      const t = leg.at
      const spread = (t - 0.5) * 2
      const near = i % 2 === 0
      const rng = createRng(hash32(c.dna.seed, 'jt', i))
      if (i % 2 === 0) {
        // Oral arm: a frilled ribbon.
        const pts: P[] = []
        for (let j = 0; j <= 6; j++) {
          const u = j / 6
          pts.push([spread * r * 0.4 * u + Math.sin(u * 5 + i) * r * 0.1, len * 0.8 * u])
        }
        const ribbon = tube(pts, pts.map((_, j) => tr * lerp(1.6, 0.5, j / 6)), 'round', 'point')
        const frill = P.detail > 0 ? P.line(pts.map((p, j) => (j ? `L${f(p[0] + (j % 2 ? tr : -tr) * 1.2)} ${f(p[1])}` : `M${f(p[0])} ${f(p[1])}`)).join(''), highlightOf(coat.primary, 0.45), tr * 0.35, { opacity: 0.7 }) : ''
        out.add(leg.upper, near ? CZ.legNear : CZ.legFar, `tent-${i}`, coatShape(c, ribbon, coat, `tent${i}`, 'leg', { tint: mix(coat.primary, coat.secondary, 0.35), plain: true, extra: frill }))
      } else {
        // Trailing tentacle: a fine wavy line.
        let dd = `M0 0`
        for (let j = 1; j <= 8; j++) {
          const u = j / 8
          dd += `L${f(spread * r * 0.6 * u + Math.sin(u * 6 + i * 1.3) * r * 0.08)} ${f(len * 1.05 * u * rng.range(0.95, 1.05))}`
        }
        out.add(leg.upper, CZ.legFar, `tent-${i}`, P.line(dd, highlightOf(coat.primary, 0.2), tr * 0.55, { opacity: 0.85 }) + P.line(dd, shadowOf(coat.primary, 0.1), tr * 0.22))
      }
    })
    return
  }
  const mantle = smooth([[-r * 0.95, r * 0.42], [-r * 0.98, -r * 0.3], [-r * 0.62, -r * 0.95], [0, -r * 1.14], [r * 0.62, -r * 0.95], [r * 0.98, -r * 0.3], [r * 0.95, r * 0.42], [r * 0.4, r * 0.62], [-r * 0.4, r * 0.62]])
  out.add('body', CZ.body, 'mantle', coatShape(c, mantle, coat, 'mantle', 'body', { tint: coat.primary }))
  cr.legs.forEach((leg, i) => {
    const t = leg.at
    const s = t < 0.5 ? -1 : 1
    const spread = (t - 0.5) * 2
    const near = i % 2 === 0
    // Arm with a curled tip, curling outward.
    const pts: P[] = [[0, 0], [spread * r * 0.35, len * 0.35], [spread * r * 0.78, len * 0.68], [spread * r * 0.95 + s * tr * 1.5, len * 0.88]]
    const tipC: P = [spread * r * 0.95 + s * tr * 3.1, len * 0.86]
    for (let j = 1; j <= 4; j++) {
      const a = Math.PI + s * (j / 4) * Math.PI * 1.2
      const rr = tr * 1.7 * (1 - j / 6)
      pts.push([tipC[0] + s * Math.cos(a) * rr * -1, tipC[1] + Math.sin(a) * rr * -1])
    }
    const radii = pts.map((_, j) => tr * lerp(1.35, 0.3, j / (pts.length - 1)))
    const d = tube(pts, radii, 'round', 'round')
    let extra = ''
    if (P.detail > 0) {
      // Suckers along the inner edge: pale rims with a darker centre.
      let rims = ''
      let dots = ''
      const count = P.detail > 1 ? 6 : 3
      for (let j = 0; j < count; j++) {
        const u = 0.18 + (j / count) * 0.72
        const idx = u * (pts.length - 1)
        const i0 = Math.floor(idx)
        const i1 = Math.min(pts.length - 1, i0 + 1)
        const k = idx - i0
        const p: P = [lerp(pts[i0][0], pts[i1][0], k), lerp(pts[i0][1], pts[i1][1], k)]
        const dir = norm([pts[i1][0] - pts[i0][0] || 0.001, pts[i1][1] - pts[i0][1]])
        const nn: P = [-dir[1] * -s, dir[0] * -s]
        const rw = lerp(tr * 1.35, tr * 0.3, u) * 0.45
        const q: P = [p[0] + nn[0] * rw * 1.05, p[1] + nn[1] * rw * 1.05]
        rims += circle(q[0], q[1], rw)
        dots += circle(q[0], q[1], rw * 0.45)
      }
      extra = P.flat(rims, coat.belly, 0.95) + P.flat(dots, shadowOf(coat.belly, 0.25), 0.8)
    }
    out.add(leg.upper, near ? CZ.legNear : CZ.legFar, `tent-${i}`, coatShape(c, d, coat, `tent${i}`, 'leg', { tint: near ? coat.primary : shadowOf(coat.primary, 0.1), extra }))
  })
}

/* ---- Robots ------------------------------------------------------------------- */

/** Panel detail: an inner bevel (light on the lit edge, dark on the other) and screws. */
function panelDetail(c: Ctx, d: string, bb: { x: number; y: number; w: number; h: number }, col: string, screws: P[], rs: number): string {
  const P = c.paint
  if (P.detail < 1) return ''
  const L = P.style.light
  const k = Math.min(bb.w, bb.h) * 0.045
  const hi = el('path', { d: `${d}`, fill: 'none', stroke: P.col(highlightOf(col, 0.5)), 'stroke-width': f(k * 1.2), 'stroke-opacity': 0.55, transform: `translate(${f(-L[0] * k)} ${f(-L[1] * k)})` })
  const lo = el('path', { d: `${d}`, fill: 'none', stroke: P.col(shadowOf(col, 0.45)), 'stroke-width': f(k * 1.2), 'stroke-opacity': 0.45, transform: `translate(${f(L[0] * k)} ${f(L[1] * k)})` })
  let sc = ''
  for (const [x, y] of screws) sc += circle(x, y, rs)
  let slots = ''
  if (P.detail > 1) for (const [x, y] of screws) slots += `M${f(x - rs * 0.6)} ${f(y + rs * 0.2)}L${f(x + rs * 0.6)} ${f(y - rs * 0.2)}`
  return hi + lo + (sc ? P.flat(sc, shadowOf(col, 0.25)) + P.flat(screws.map(([x, y]) => circle(x - rs * 0.25, y - rs * 0.25, rs * 0.45)).join(''), highlightOf(col, 0.5), 0.8) + (slots ? P.line(slots, shadowOf(col, 0.55), rs * 0.28) : '') : '')
}

function robot(c: Ctx, out: PartList, coat: Coat): void {
  const cr = c.cr as CreatureRig
  const m = cr.m
  const P = c.paint
  const r = m.bodyR
  const form = c.sec('form')
  const build = form.s('build') || 'box'
  const back = c.view === 'back'
  const metal = coat.primary
  const panel = coat.secondary
  const glowC = c.sec('face').c('iris', '#00e5ff')
  const matP = coat.material === 'plastic' ? 'plastic' : 'metal'
  let chassis: string
  let bb: { x: number; y: number; w: number; h: number }
  switch (build) {
    case 'round':
      chassis = circle(0, 0, r * 0.95)
      bb = { x: -r * 0.95, y: -r * 0.95, w: r * 1.9, h: r * 1.9 }
      break
    case 'capsule':
      chassis = roundRect(-r * 0.75, -r * 0.95, r * 1.5, r * 1.9, r * 0.75)
      bb = { x: -r * 0.75, y: -r * 0.95, w: r * 1.5, h: r * 1.9 }
      break
    case 'tv':
      // A squat radio-cabinet body under the TV head.
      chassis = roundRect(-r * 0.9, -r * 0.82, r * 1.8, r * 1.8, r * 0.36)
      bb = { x: -r * 0.9, y: -r * 0.82, w: r * 1.8, h: r * 1.8 }
      break
    default:
      chassis = roundRect(-r * 0.95, -r * 0.9, r * 1.9, r * 1.8, r * 0.22)
      bb = { x: -r * 0.95, y: -r * 0.9, w: r * 1.9, h: r * 1.8 }
  }
  const inset = (k: number) => (build === 'round' ? circle(0, 0, r * 0.95 * (1 - k)) : roundRect(bb.x + bb.w * k * 0.5, bb.y + bb.h * k * 0.5, bb.w * (1 - k), bb.h * (1 - k), build === 'capsule' ? r * 0.75 * (1 - k) : r * (build === 'tv' ? 0.3 : 0.22) * (1 - k)))
  const corners: P[] = build === 'round' ? [[-r * 0.62, -r * 0.62], [r * 0.62, -r * 0.62], [-r * 0.62, r * 0.62], [r * 0.62, r * 0.62]] : [[bb.x + r * 0.16, bb.y + r * 0.16], [bb.x + bb.w - r * 0.16, bb.y + r * 0.16], [bb.x + r * 0.16, bb.y + bb.h - r * 0.16], [bb.x + bb.w - r * 0.16, bb.y + bb.h - r * 0.16]]
  const inner = panelDetail(c, inset(0.1), bb, metal, corners, r * 0.05)
  // Fittings sit on the shell as their own shapes, not inside its shading: nested clipped
  // layers crash resvg in narrow crops.
  let over = ''
  let svg = ''
  if (build === 'tv') {
    if (!back && P.detail > 0) {
      // A round speaker grille and a tuning dial.
      let slots = ''
      for (let i = -3; i <= 3; i++) {
        const y = i * r * 0.1
        const hw = Math.sqrt(Math.max(0, 1 - (i / 3.6) ** 2)) * r * 0.42
        slots += `M${f(-r * 0.2 - hw)} ${f(y)}h${f(hw * 2)}`
      }
      over += P.shape(circle(-r * 0.2, 0, r * 0.5), shadowOf(metal, 0.12), { material: matP, outline: 0.7, inner: P.line(slots, shadowOf(metal, 0.55), r * 0.05) })
      over += P.shape(circle(r * 0.55, -r * 0.3, r * 0.15), coat.accent, { material: 'plastic', gloss: true, outline: 0.7 }) + P.shape(circle(r * 0.55, r * 0.15, r * 0.1), panel, { material: 'plastic', outline: 0.7 })
    }
    svg += coatShape(c, chassis, coat, 'chassis', 'body', { tint: metal, extra: inner }) + over
  } else {
    if (!back && P.detail > 0) {
      // Chest plate with a glowing core light.
      const plate = roundRect(-r * 0.45, -r * 0.35, r * 0.9, r * 0.62, r * 0.12)
      over += P.shape(plate, panel, { shade: 0.5, material: matP, outline: 0.7, inner: panelDetail(c, roundRect(-r * 0.4, -r * 0.3, r * 0.8, r * 0.52, r * 0.1), { x: -r * 0.45, y: -r * 0.35, w: r * 0.9, h: r * 0.62 }, panel, [], 0) })
      over += P.shape(circle(0, -r * 0.05, r * 0.15), coat.accent, { material: 'glass', gloss: true, outline: 0.7 })
      if (c.baked && P.detail > 1) over += P.glow(0, -r * 0.05, r * 0.4, coat.accent, 0.45)
      over += P.line([0.45, 0.55, 0.65].map((y) => `M${f(-r * 0.35)} ${f(r * y)}h${f(r * 0.7)}`).join(''), shadowOf(metal, 0.45), r * 0.04, { opacity: 0.8 })
    }
    if (back && P.detail > 0) {
      // Back hatch and vents.
      over += P.shape(roundRect(-r * 0.5, -r * 0.5, r * 1.0, r * 0.9, r * 0.1), shadowOf(metal, 0.08), { material: matP, outline: 0.6 })
      over += P.line([-0.3, -0.15, 0, 0.15].map((y) => `M${f(-r * 0.35)} ${f(r * y)}h${f(r * 0.7)}`).join(''), shadowOf(metal, 0.5), r * 0.05)
    }
    svg += coatShape(c, chassis, coat, 'chassis', 'body', { tint: metal, extra: inner }) + over
  }
  out.add('body', CZ.body, 'chassis', svg)

  {
    const hr2 = m.headR
    if (build === 'tv') {
      // A CRT television for a head: cabinet, bezel, glowing glass, knobs.
      const cab = roundRect(-hr2 * 1.18, -hr2 * 0.86, hr2 * 2.36, hr2 * 1.72, hr2 * 0.3)
      const cbb = { x: -hr2 * 1.18, y: -hr2 * 0.86, w: hr2 * 2.36, h: hr2 * 1.72 }
      let h = coatShape(c, cab, coat, 'tvcab', 'head', { tint: metal, extra: panelDetail(c, roundRect(-hr2 * 1.08, -hr2 * 0.77, hr2 * 2.16, hr2 * 1.54, hr2 * 0.26), cbb, metal, [], 0) })
      if (!back) {
        const sc = tvScreen(hr2)
        const screen = roundRect(sc.x, sc.y, sc.w, sc.h, hr2 * 0.26)
        const glass = P.linear(`crt${panel.slice(1)}`, [[0, highlightOf(panel, 0.2)], [0.5, panel], [1, shadowOf(panel, 0.25)]], [0.2, 0], [0.8, 1])
        let scan = ''
        if (c.baked && P.detail > 1) for (let y = sc.y + hr2 * 0.07; y < sc.y + sc.h; y += hr2 * 0.08) scan += `M${f(sc.x)} ${f(y)}h${f(sc.w)}`
        const screenInner = (scan ? P.line(scan, shadowOf(panel, 0.2), hr2 * 0.02, { opacity: 0.35 }) : '') + (c.baked ? el('ellipse', { cx: f(sc.x + sc.w / 2), cy: f(sc.y + sc.h / 2), rx: f(sc.w * 0.55), ry: f(sc.h * 0.55), fill: glowFill(c, highlightOf(panel, 0.4), 0.45, 0.4) }) : '') + P.flat(smooth([[sc.x + hr2 * 0.14, sc.y + hr2 * 0.4], [sc.x + hr2 * 0.22, sc.y + hr2 * 0.13], [sc.x + hr2 * 0.62, sc.y + hr2 * 0.09], [sc.x + hr2 * 0.34, sc.y + hr2 * 0.25]]), '#ffffff', 0.55)
        h += P.shape(roundRect(sc.x - hr2 * 0.08, sc.y - hr2 * 0.08, sc.w + hr2 * 0.16, sc.h + hr2 * 0.16, hr2 * 0.3), '#2a2e33', { material: 'plastic', outline: 0.8 })
        h += P.shape(screen, panel, { paint: glass, material: 'glass', spec: 0.5, inner: screenInner, outline: 0.6 })
        h += P.shape(circle(hr2 * 0.82, -hr2 * 0.42, hr2 * 0.13), coat.accent, { material: 'plastic', gloss: true }) + P.shape(circle(hr2 * 0.82, -hr2 * 0.05, hr2 * 0.13), coat.accent, { material: 'plastic', gloss: true })
        if (P.detail > 0) h += P.line(`M${f(hr2 * 0.82)} ${f(-hr2 * 0.52)}v${f(hr2 * 0.09)}M${f(hr2 * 0.75)} ${f(-hr2 * 0.07)}l${f(hr2 * 0.12)} ${f(-hr2 * 0.05)}`, shadowOf(coat.accent, 0.5), hr2 * 0.035) + P.line([0.3, 0.42, 0.54].map((y) => `M${f(hr2 * 0.7)} ${f(hr2 * y)}h${f(hr2 * 0.26)}`).join(''), shadowOf(metal, 0.45), hr2 * 0.04)
      } else if (P.detail > 0) {
        h += P.line([-0.3, -0.1, 0.1, 0.3].map((y) => `M${f(-hr2 * 0.7)} ${f(hr2 * y)}h${f(hr2 * 1.4)}`).join(''), shadowOf(metal, 0.45), hr2 * 0.06)
      }
      out.add('head', CZ.head, 'robot-head', h)
    } else {
    const head = build === 'round' ? circle(0, 0, hr2 * 0.9) : roundRect(-hr2, -hr2 * 0.8, hr2 * 2, hr2 * 1.6, hr2 * 0.3)
    const hbb = build === 'round' ? { x: -hr2 * 0.9, y: -hr2 * 0.9, w: hr2 * 1.8, h: hr2 * 1.8 } : { x: -hr2, y: -hr2 * 0.8, w: hr2 * 2, h: hr2 * 1.6 }
    const hInset = build === 'round' ? circle(0, 0, hr2 * 0.8) : roundRect(-hr2 * 0.9, -hr2 * 0.72, hr2 * 1.8, hr2 * 1.44, hr2 * 0.25)
    let h = coatShape(c, head, coat, 'rhead', 'head', { tint: metal, extra: panelDetail(c, hInset, hbb, metal, [], 0) })
    // Ear discs.
    const disc = (x: number) => P.shape(ellipse(x, 0, hr2 * 0.14, hr2 * 0.32), shadowOf(metal, 0.15), { material: matP, outline: 0.8 }) + (P.detail > 0 ? P.flat(ellipse(x, 0, hr2 * 0.06, hr2 * 0.16), c.baked ? glowC : shadowOf(metal, 0.4), 0.9) : '')
    const discs = disc(-hbb.w / 2 - hr2 * 0.02) + disc(hbb.w / 2 + hr2 * 0.02)
    if (!back) {
      // Visor glass.
      const vis = roundRect(-hr2 * 0.75, -hr2 * 0.45, hr2 * 1.5, hr2 * 0.9, hr2 * 0.25)
      const glass = P.linear('visor', [[0, '#26303a'], [0.55, '#10151b'], [1, '#1b242d']], [0, 0], [0, 1])
      const refl = P.flat(smooth([[-hr2 * 0.62, -hr2 * 0.3], [-hr2 * 0.4, -hr2 * 0.4], [hr2 * 0.05, -hr2 * 0.4], [-hr2 * 0.35, -hr2 * 0.28]]), '#ffffff', 0.35)
      h += P.shape(vis, '#141a22', { paint: glass, material: 'glass', spec: 0.4, inner: refl + (c.baked && P.detail > 1 ? el('ellipse', { cx: 0, cy: 0, rx: f(hr2 * 0.7), ry: f(hr2 * 0.4), fill: glowFill(c, glowC, 0.18, 0.4) }) : '') })
    } else if (P.detail > 0) {
      h += P.line([-0.2, 0, 0.2].map((y) => `M${f(-hr2 * 0.5)} ${f(hr2 * y)}h${f(hr2 * 1.0)}`).join(''), shadowOf(metal, 0.45), hr2 * 0.06)
    }
    out.add('head', CZ.head, 'robot-head', discs + h)
    }
    const neck = P.shape(roundRect(-r * 0.2, -r * 1.12, r * 0.4, r * 0.32, r * 0.06), shadowOf(metal, 0.3), { material: 'metal' }) + (P.detail > 0 ? P.line(`M${f(-r * 0.2)} ${f(-r * 1.02)}h${f(r * 0.4)}M${f(-r * 0.2)} ${f(-r * 0.92)}h${f(r * 0.4)}`, shadowOf(metal, 0.5), r * 0.03) : '')
    out.add('body', CZ.body - 1, 'robot-neck', neck)
  }
  // Arms: ball joints, segmented, claw hands.
  const armsSetting = c.sec('limbs').s('arms') || 'auto'
  const arms = armsSetting === 'auto' ? 'long' : armsSetting
  if (arms !== 'none') {
    const len = m.armLen * (arms === 'stubby' ? 0.45 : 1)
    for (const s of ['L', 'R'] as const) {
      const upper = roundRect(-r * 0.12, 0, r * 0.24, len * 0.5, r * 0.1)
      const lower = roundRect(-r * 0.13, 0, r * 0.26, len * 0.5, r * 0.11)
      const clawC = shadowOf(metal, 0.3)
      const claw = (k: number) => smooth([[k * r * 0.1, len * 0.48], [k * r * 0.24, len * 0.5 + r * 0.12], [k * r * 0.2, len * 0.5 + r * 0.3, 0], [k * r * 0.1, len * 0.5 + r * 0.14], [k * r * 0.02, len * 0.5]])
      const shoulder = P.shape(circle(0, 0, r * 0.2), panel, { material: matP, gloss: true })
      out.add(`arm${s}a`, CZ.legNear, `rarm-u-${s}`, P.shape(upper, shadowOf(metal, 0.12), { material: matP }) + shoulder)
      out.add(`arm${s}b`, CZ.legNear + 1, `rarm-l-${s}`, P.shape(lower, metal, { material: matP, inner: P.detail > 0 ? P.line(`M${f(-r * 0.13)} ${f(len * 0.32)}h${f(r * 0.26)}`, shadowOf(metal, 0.4), r * 0.03) : undefined }) + P.shape(circle(0, 0, r * 0.15), panel, { material: matP, outline: 0.7 }) + P.shape(claw(-1) + claw(1), clawC, { material: 'metal' }) + P.shape(circle(0, len * 0.5, r * 0.1), shadowOf(metal, 0.2), { material: 'metal', outline: 0.6 }))
    }
  }
}

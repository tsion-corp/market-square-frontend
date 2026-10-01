/* Face features on the humanoid head: eyes, brows, nose, mouth, blush and the expression
 * effects (tears, sweat, anger mark, zzz, steam). Eyes, brows, mouth, blush and effects
 * are dynamic (they follow the expression every frame); the nose is static.
 *
 * Baked stills (`ctx.baked`) add hair-stroke brows and the nose's full soft volume; the
 * standard (animation) path keeps brows to one shape and the effects to a few paths. */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { clamp, lerp, smoothstep, type P } from '../../core/math.ts'
import { brush, ellipse, f, rect, sampleSmooth, smooth } from '../../core/path.ts'
import { hash32 } from '../../core/rng.ts'
import { el, g, url } from '../../core/svg.ts'
import type { Ctx, PartList } from '../../render/context.ts'
import { Z } from '../../render/context.ts'
import type { HumanMeasure, HumanRig } from '../../rig/humanoid.ts'
import type { FrameState } from '../../render/types.ts'
import { drawEye, drawSteam, drawSweat, drawTears, drawVein, drawZzz, EYE_STYLES, linearPaint, softSpot, type ExprFxSpec } from '../shared/eye.ts'
import { drawMouth } from '../shared/mouth.ts'
import { skinOf } from './body.ts'
import { faceClip, faceGeom, skinTones } from './head.ts'
import { hairColorOf } from './hairColor.ts'

function eyeLayout(c: Ctx, m: HumanMeasure) {
  const e = c.sec('eyes')
  const st = EYE_STYLES[e.s('style')] ?? EYE_STYLES.almond
  const side = c.view === 'side'
  const w = m.hw * lerp(0.25, 0.39, e.n('size')) * st.widthMul
  const spacing = m.hw * lerp(0.3, 0.46, e.n('spacing'))
  return { e, st, w, spacing, side }
}

export function eyesGen(c: Ctx, fr: FrameState, out: PartList): void {
  if (c.view === 'back' || c.hides('eyes')) return
  const m = (c.hr as HumanRig).m
  const skin = skinOf(c)
  const { e, st, w, spacing, side } = eyeLayout(c, m)
  const x = fr.expr
  const eyes = side ? [{ s: 'R' as const, cx: m.hw * 0.6, dir: -1 }] : [
    { s: 'L' as const, cx: spacing * (c.hr as HumanRig).sx, dir: (c.hr as HumanRig).sx },
    { s: 'R' as const, cx: -spacing * (c.hr as HumanRig).sx, dir: -(c.hr as HumanRig).sx },
  ]
  const parts: string[] = []
  for (const eye of eyes) {
    const isL = eye.s === 'L'
    const iris = !isL && e.has('iris2') ? e.c('iris2') : e.c('iris', '#5b3a1e')
    parts.push(
      drawEye(c, {
        cx: eye.cx,
        cy: m.eyeY,
        w,
        dir: eye.dir,
        style: st,
        tilt: (e.n('tilt') - 0.5) * 0.5,
        open: (isL ? x.openL : x.openR) * (e.s('style') === 'sleepy' ? 0.72 : 1),
        squint: x.squint,
        lookX: x.lookX,
        lookY: x.lookY,
        lidAngle: x.lidAngle,
        mode: isL ? x.eyeL : x.eyeR,
        iris,
        sclera: e.c('sclera', '#fbf9f6'),
        pupil: e.s('pupil') || 'round',
        irisScale: e.n('irisSize'),
        sparkle: e.n('sparkle'),
        lashes: e.n('lashes'),
        liner: e.n('liner'),
        shadow: e.n('shadow'),
        shadowColor: e.c('shadowColor', '#9575cd'),
        glow: e.b('glow'),
        bags: e.n('bags'),
        skin,
        profile: side,
      }),
    )
  }
  out.add('head', Z.eyes, 'eyes', parts.join(''))
}

/* ---- Brows ------------------------------------------------------------------------ */

// Fixed jitter for brow hair strokes (deterministic, stable from frame to frame).
const BJ = Array.from({ length: 256 }, (_, i) => (hash32('brow', i) % 10000) / 10000)

/** Point and unit tangent along a dense polyline at t (0..1). */
function frameAt(pts: P[], t: number): { p: P; tx: number; ty: number } {
  const u = clamp(t, 0, 1) * (pts.length - 1)
  const i = Math.min(pts.length - 2, Math.floor(u))
  const k = u - i
  const a = pts[i]
  const b = pts[i + 1]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dl = Math.hypot(dx, dy) || 1
  return { p: [lerp(a[0], b[0], k), lerp(a[1], b[1], k)], tx: dx / dl, ty: dy / dl }
}

/**
 * Hair strokes over a brow: at the inner head the hairs grow upward, along the body they
 * lie with the arch, at the tail they sweep down and out. Parametric along the brow, so
 * they follow every expression without flickering.
 */
function browHairs(c: Ctx, spine: P[], widthAt: (t: number) => number, thick: number, color: string, density: number, messy: number, seed: number): string {
  const P = c.paint
  const dense = sampleSmooth(spine, false, 6)
  const n = Math.round(density)
  let dark = ''
  let light = ''
  for (let i = 0; i < n; i++) {
    const j = (k: number) => BJ[(seed * 37 + i * 5 + k) % BJ.length]
    const t = clamp((i + j(0)) / n, 0, 1)
    const { p, tx, ty } = frameAt(dense, t)
    // Up-normal (toward -y).
    let nx = -ty
    let ny = tx
    if (ny > 0) {
      nx = -nx
      ny = -ny
    }
    const half = widthAt(t) / 2
    const v = (j(1) - 0.5) * 1.3
    const bx = p[0] + nx * half * v
    const by = p[1] + ny * half * v
    const up = 1 - smoothstep(0, 0.2, t)
    const down = smoothstep(0.75, 1, t)
    const lean = 0.16 + j(2) * 0.14 + messy * (j(3) - 0.5) * 0.7
    const k = up * 0.7 + (1 - up) * lean
    let dx = lerp(tx, nx, k)
    let dy = lerp(ty, ny, k) + down * 0.2
    const dl = Math.hypot(dx, dy) || 1
    dx /= dl
    dy /= dl
    const len = thick * lerp(0.5, 0.95, j(4)) * (1 - up * 0.25) * (1 + messy * 0.5)
    const seg = `M${f(bx - dx * len * 0.45)} ${f(by - dy * len * 0.45)}q${f(dx * len * 0.5 - dy * len * 0.08)} ${f(dy * len * 0.5 + dx * len * 0.08)} ${f(dx * len)} ${f(dy * len)}`
    if (j(5) < 0.62) dark += seg
    else light += seg
  }
  return P.line(dark, shadowOf(color, 0.2), thick * 0.065, { opacity: 0.7 }) + P.line(light, mix(color, highlightOf(color, 0.3), 0.6), thick * 0.055, { opacity: 0.5 })
}

export function browsGen(c: Ctx, fr: FrameState, out: PartList): void {
  if (c.view === 'back' || c.hides('brows')) return
  const m = (c.hr as HumanRig).m
  const b = c.sec('brows')
  const style = b.s('style') || 'natural'
  if (style === 'none') return
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const { w, spacing, side } = eyeLayout(c, m)
  const x = fr.expr
  const hh = m.headH
  const color = b.c('color', shadowOf(hairColorOf(c), 0.12))
  const thick = hh * 0.032 * lerp(0.55, 1.6, b.n('thickness'))
  const baseY = m.eyeY - w * 0.62 - hh * (b.n('height') - 0.5) * 0.06
  const sx = (c.hr as HumanRig).sx
  const shapes: Record<string, { arch: number; peak: number; wi: number; wo: number; len: number; hair: number; messy: number }> = {
    natural: { arch: 0.3, peak: 0.55, wi: 1, wo: 0.5, len: 1, hair: 1, messy: 0.2 },
    soft: { arch: 0.22, peak: 0.5, wi: 0.9, wo: 0.6, len: 1, hair: 0.9, messy: 0.1 },
    arched: { arch: 0.6, peak: 0.62, wi: 0.9, wo: 0.45, len: 1.02, hair: 0.9, messy: 0.1 },
    straight: { arch: 0.04, peak: 0.5, wi: 0.9, wo: 0.75, len: 1, hair: 1, messy: 0.15 },
    angled: { arch: 0.45, peak: 0.62, wi: 1, wo: 0.45, len: 1, hair: 1, messy: 0.1 },
    thick: { arch: 0.25, peak: 0.55, wi: 1.55, wo: 1.1, len: 1.05, hair: 1.35, messy: 0.25 },
    thin: { arch: 0.35, peak: 0.55, wi: 0.55, wo: 0.3, len: 0.95, hair: 0.55, messy: 0 },
    bushy: { arch: 0.25, peak: 0.5, wi: 1.6, wo: 1.2, len: 1.08, hair: 1.7, messy: 0.8 },
    rounded: { arch: 0.4, peak: 0.5, wi: 1.4, wo: 1.4, len: 0.62, hair: 0, messy: 0 },
    unibrow: { arch: 0.25, peak: 0.55, wi: 1.2, wo: 0.7, len: 1, hair: 1.2, messy: 0.4 },
    dots: { arch: 0, peak: 0.5, wi: 1, wo: 1, len: 0.3, hair: 0, messy: 0 },
  }
  const sh = shapes[style] ?? shapes.natural
  const tilt = (b.n('tilt') - 0.5) * 2
  const brows = side ? [{ cx: m.hw * 0.6, dir: -1, asym: 0 }] : [
    { cx: spacing * sx, dir: sx, asym: 1 },
    { cx: -spacing * sx, dir: -sx, asym: -1 },
  ]
  const parts: string[] = []
  const inners: P[] = []
  brows.forEach((br, bi) => {
    const raise = (x.browRaise * 0.9 + x.browAsym * br.asym * 0.7) * w * 0.35
    const angle = x.browAngle + tilt * 0.4
    const yIn = baseY - raise + angle * w * 0.22
    const yOut = baseY - raise - angle * w * 0.08 - (x.browAngle < 0 ? x.browAngle * w * 0.08 : 0)
    const inner: P = [br.cx - br.dir * w * 0.46 * (b.n('spacing') > 0.5 ? 0.85 : 1), yIn]
    const outer: P = [br.cx + br.dir * w * lerp(0.2, 0.62, sh.len), yOut + w * 0.06]
    inners.push(inner)
    if (style === 'dots') {
      const d = ellipse(br.cx - br.dir * w * 0.12, baseY - w * 0.3 - raise, thick * 0.9, thick * 0.6)
      parts.push(shaded ? el('path', { d, fill: linearPaint(c, [[0, highlightOf(color, 0.12)], [1, shadowOf(color, 0.12)]]) }) : P.flat(d, color))
      return
    }
    const peak: P = [lerp(inner[0], outer[0], sh.peak), Math.min(inner[1], outer[1]) - w * sh.arch * 0.28 - (x.browAngle < 0 ? -x.browAngle * w * 0.05 : 0)]
    const pts: P[] = [inner, peak, outer]
    const w0 = thick * sh.wi
    const w1 = thick * sh.wo * (style === 'rounded' ? 1 : 0.8)
    const bulge = thick * 0.25
    let d = brush(pts, w0, w1, bulge, 'round', style === 'rounded' ? 'round' : 'point')
    if (style === 'rounded') d = brush([inner, [lerp(inner[0], outer[0], 0.5), peak[1]], outer], thick * 1.4, thick * 1.1, thick * 0.2)
    let svg: string
    if (rich && sh.hair > 0) {
      // Baked: a soft body that thins toward the inner head, with hair strokes over it.
      const body = linearPaint(c, br.dir > 0 ? [[0, color, 0.62], [0.28, color, 1], [1, color, 1]] : [[0, color, 1], [0.72, color, 1], [1, color, 0.62]], [0, 0], [1, 0])
      svg = P.shape(d, color, { shade: false, outline: false, paint: body }) + el('path', { d, fill: linearPaint(c, [[0, highlightOf(color, 0.12), 0.35], [0.5, color, 0], [1, shadowOf(color, 0.2), 0.45]]) })
      svg += browHairs(c, pts, (t) => lerp(w0, w1, t) + Math.sin(t * Math.PI) * bulge, thick, color, (28 + 30 * b.n('thickness')) * sh.hair * sh.len, sh.messy, bi)
    } else {
      // Standard: one shape with a keyed gradient (no per-frame clip defs).
      svg = P.shape(d, color, { shade: false, outline: 0.35, paint: shaded ? linearPaint(c, [[0, highlightOf(color, 0.1)], [0.55, color], [1, shadowOf(color, 0.14)]]) : undefined })
      if (style === 'bushy' && P.detail > 1) {
        const hairs: string[] = []
        for (let i = 0; i < 7; i++) {
          const t = i / 6
          const px = lerp(inner[0], outer[0], t)
          const py = lerp(inner[1], outer[1], t) - Math.sin(Math.PI * t) * w * sh.arch * 0.28
          hairs.push(`M${f(px)} ${f(py + thick * 0.4)}l${f(br.dir * thick * 0.5)} ${f(-thick * 0.9)}`)
        }
        svg += P.line(hairs.join(''), shadowOf(color, 0.2), P.lw * 0.5)
      }
    }
    if (b.b('slit')) {
      const sxp = lerp(inner[0], outer[0], 0.62)
      const syp = lerp(inner[1], outer[1], 0.62) - w * sh.arch * 0.2
      svg += P.flat(brush([[sxp - br.dir * thick * 0.2, syp - thick * 1.2], [sxp + br.dir * thick * 0.3, syp + thick * 1.2]], thick * 0.45, thick * 0.35), skinOf(c))
    }
    parts.push(svg)
  })
  if (style === 'unibrow' && inners.length === 2) {
    const bridge: P[] = [inners[0], [0, (inners[0][1] + inners[1][1]) / 2 + thick * 0.2], inners[1]]
    const d = brush(bridge, thick * 0.7, thick * 0.7, -thick * 0.1)
    if (rich) parts.push(P.flat(brush(bridge, thick * 0.6, thick * 0.6, -thick * 0.15), color, 0.3) + browHairs(c, bridge, () => thick * 0.55, thick * 0.75, color, 16, 0.6, 7))
    else parts.push(P.flat(d, color))
  }
  out.add('head', Z.brows, 'brows', parts.join(''))
}

/* ---- Nose ------------------------------------------------------------------------- */

export function noseGen(c: Ctx, out: PartList): void {
  if (c.view === 'back') return
  const m = (c.hr as HumanRig).m
  const n = c.sec('nose')
  const style = n.s('style') || 'button'
  if (style === 'none') return
  const P = c.paint
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rich = c.baked && P.detail > 1
  const skin = skinOf(c)
  const t = skinTones(skin, P)
  const hh = m.headH
  const s = lerp(0.75, 1.3, n.n('size'))
  const wd = lerp(0.75, 1.35, n.n('width'))
  const y = m.noseY
  const ink = t.line
  const lw = clamp(P.lw * 0.9, hh * 0.012, hh * 0.018)
  const L = P.style.light
  /** A fine tapered stroke (thin ends, full in the middle). */
  const taper = (pts: P[], width: number): string => brush(pts, 0, 0, width)

  if (c.view === 'side') {
    const x = m.hw * 0.9
    const len = hh * 0.1 * s * (style === 'roman' || style === 'pointed' ? 1.2 : style === 'snub' || style === 'button' ? 0.8 : 1)
    const tipY = y + hh * 0.02
    const bridge: P = style === 'roman' ? [x + len * 0.55, y - hh * 0.08] : style === 'snub' ? [x + len * 0.25, y - hh * 0.05] : [x + len * 0.35, y - hh * 0.06]
    const tip: P = [x + len, tipY - (style === 'snub' ? hh * 0.02 : 0)]
    const d = smooth([[x - 2, y - hh * 0.14], bridge, tip, [x + len * 0.55, tipY + hh * 0.045], [x - 2, tipY + hh * 0.03]])
    // Outline only the part that stands off the face.
    const oc = c.defs.unique('noc')
    c.defs.put(oc, el('clipPath', { id: oc }, el('path', { d: rect(x - 1, y - hh * 0.3, hh, hh * 0.6) })))
    let svg = P.shape(d, skin, { shade: 0.6, outline: 0.9, outlineClip: oc })
    const nostril = ellipse(x + len * 0.42, tipY + hh * 0.022, len * 0.14, hh * 0.011)
    svg += P.flat(nostril, t.deep, shaded ? 0.75 : 0.6)
    svg += P.flat(taper([[x + len * 0.18, tipY - hh * 0.01], [x + len * 0.26, tipY + hh * 0.02], [x + len * 0.5, tipY + hh * 0.03]], lw * 0.8), ink, 0.7)
    if (shaded) {
      svg += softSpot(c, x + len * 0.72, tipY - hh * 0.012, len * 0.2, hh * 0.018, t.sheen, rich ? 0.6 : 0.45)
      if (rich) {
        svg += softSpot(c, x + len * 0.65, tipY + hh * 0.005, len * 0.3, hh * 0.03, t.flush, 0.22)
        svg += P.flat(taper([[bridge[0] - len * 0.1, bridge[1] - hh * 0.03], [lerp(bridge[0], tip[0], 0.5) - len * 0.04, lerp(bridge[1], tip[1], 0.5) - hh * 0.005]], hh * 0.008), t.sheen, 0.5)
        svg += el('ellipse', { cx: tip[0] - len * 0.18, cy: tipY - hh * 0.014, rx: len * 0.06, ry: hh * 0.006, fill: P.col(t.spec), 'fill-opacity': 0.55 })
      }
    }
    out.add('head', Z.head + 1, 'nose', svg)
    return
  }

  const w = hh * 0.055 * s * wd
  const sd = -Math.sign(L[0]) || 1
  const parts: string[] = []
  const volume = style !== 'dot' && style !== 'anime'
  const long = style === 'straight' || style === 'roman' || style === 'pointed'
  if (shaded && volume) {
    // The bridge's shadow side (strongest on long noses), the shadow the tip casts on the
    // upper lip, a little flush and the tip's sheen.
    parts.push(softSpot(c, sd * w * 0.45, y - hh * 0.05, w * 0.24, hh * (long ? 0.075 : 0.05), t.shadow, (rich ? 0.3 : 0.22) * (long ? 1 : 0.7)))
    parts.push(softSpot(c, sd * w * 0.18, y + w * 0.82, w * 0.8, w * 0.24, t.shadow, rich ? 0.4 : 0.28))
    if (rich) parts.push(softSpot(c, 0, y + w * 0.12, w * 0.55, w * 0.4, t.flush, 0.1))
    parts.push(softSpot(c, -sd * w * 0.16, y - w * 0.06, w * 0.24, w * 0.2, t.sheen, (rich ? 0.55 : 0.4) * (1 + t.depth * 0.5)))
    if (rich) {
      if (long) parts.push(softSpot(c, -sd * w * 0.08, y - hh * 0.06, w * 0.08, hh * 0.04, t.sheen, 0.32))
      parts.push(el('ellipse', { cx: -sd * w * 0.2, cy: y - w * 0.12, rx: w * 0.07, ry: w * 0.045, fill: P.col(t.spec), 'fill-opacity': 0.5 }))
    }
  }
  const nostrils = (dx: number, dy: number, rx: number, ry: number, op: number): string =>
    P.flat(ellipse(-dx, y + dy, rx, ry) + ellipse(dx, y + dy, rx, ry), t.deep, op)
  // Alar wings: a short "(" and ")" hugging each nostril.
  const alar = (spread: number, drop: number): string =>
    P.flat(taper([[-w * spread * 0.82, y + w * drop * 0.05], [-w * spread, y + w * drop * 0.55], [-w * spread * 0.72, y + w * drop]], lw * 1.05) + taper([[w * spread * 0.82, y + w * drop * 0.05], [w * spread, y + w * drop * 0.55], [w * spread * 0.72, y + w * drop]], lw * 1.05), ink, 0.7)
  switch (style) {
    case 'dot':
      parts.push(shaded ? softSpot(c, 0, y + w * 0.05, w * 0.36, w * 0.28, t.deep, 0.85) + P.flat(ellipse(0, y + w * 0.03, w * 0.2, w * 0.14), t.deep, 0.7) : P.flat(ellipse(0, y, w * 0.28, w * 0.2), ink, 0.8))
      break
    case 'anime':
      if (shaded) parts.push(softSpot(c, sd * w * 0.15, y + w * 0.05, w * 0.3, w * 0.35, t.shadow, 0.3))
      parts.push(P.flat(taper([[w * 0.05, y - w * 0.55], [w * 0.2, y], [-w * 0.15, y + w * 0.08]], lw * 1.1), ink, 0.85))
      break
    case 'round':
      if (shaded) parts.push(softSpot(c, sd * w * 0.3, y - w * 0.02, w * 0.8, w * 0.66, t.shadow, 0.3))
      parts.push(alar(0.74, 0.6))
      parts.push(P.flat(taper([[-w * 0.26, y + w * 0.62], [0, y + w * 0.68], [w * 0.26, y + w * 0.62]], lw * 0.6), ink, 0.45))
      if (P.detail > 1) parts.push(nostrils(w * 0.3, w * 0.5, w * 0.12, w * 0.06, 0.55))
      break
    case 'straight':
    case 'roman':
    case 'pointed': {
      const bx = sd * w * 0.42
      const bump = style === 'roman' ? w * 0.38 : 0
      parts.push(P.flat(taper([[bx * 0.6, y - hh * 0.15], [bx + sd * bump, y - hh * 0.07], [bx, y - w * 0.05]], lw * 0.85), ink, 0.5))
      parts.push(alar(0.62, 0.55))
      const tipDrop = style === 'pointed' ? 0.72 : 0.6
      parts.push(P.flat(taper([[-w * 0.24, y + w * 0.55], [0, y + w * tipDrop], [w * 0.24, y + w * 0.55]], lw * 0.65), ink, 0.5))
      if (P.detail > 1) parts.push(nostrils(w * 0.28, w * 0.48, w * 0.1, w * 0.055, 0.5))
      break
    }
    case 'wide':
    case 'flat':
      parts.push(alar(1.02, 0.5))
      parts.push(nostrils(w * 0.44, w * 0.4, w * 0.19, w * 0.1, 0.62))
      if (style === 'wide') parts.push(P.flat(taper([[-w * 0.35, y + w * 0.55], [0, y + w * 0.62], [w * 0.35, y + w * 0.55]], lw * 0.6), ink, 0.45))
      break
    case 'snub':
      parts.push(nostrils(w * 0.3, w * 0.2, w * 0.17, w * 0.14, 0.82))
      parts.push(P.flat(taper([[-w * 0.6, y - w * 0.08], [0, y - w * 0.42], [w * 0.6, y - w * 0.08]], lw * 0.8), ink, 0.5))
      break
    case 'button':
    default:
      parts.push(P.flat(taper([[-w * 0.56, y + w * 0.1], [-w * 0.3, y + w * 0.44], [0, y + w * 0.52], [w * 0.3, y + w * 0.44], [w * 0.56, y + w * 0.1]], lw * 1.05), ink, 0.72))
      if (P.detail > 1) parts.push(nostrils(w * 0.28, w * 0.2, w * 0.11, w * 0.08, 0.5))
  }
  out.add('head', Z.nose, 'nose', parts.join(''))
}

/* ---- Mouth ------------------------------------------------------------------------ */

export function mouthGen(c: Ctx, fr: FrameState, out: PartList): void {
  if (c.view === 'back' || c.hides('mouth')) return
  const m = (c.hr as HumanRig).m
  const mo = c.sec('mouth')
  const x = fr.expr
  const side = c.view === 'side'
  const mw = m.hw * lerp(0.36, 0.58, mo.n('width'))
  const svg = drawMouth(c, {
    cx: side ? m.hw * 0.72 : 0,
    cy: m.mouthY,
    w: mw,
    style: mo.s('style') || 'default',
    lips: mo.n('lips'),
    lipColor: mo.c('lipColor', ''),
    skin: skinOf(c),
    teeth: mo.s('teeth') || 'normal',
    smile: x.smile,
    open: x.open,
    wide: x.wide,
    asym: x.asym * (c.hr as HumanRig).sx,
    shape: x.mouth,
    profile: side,
  })
  out.add('head', Z.mouth, 'mouth', svg)
}

/* ---- Blush and expression effects ------------------------------------------------- */

export function blushGen(c: Ctx, fr: FrameState, out: PartList): void {
  if (c.view === 'back') return
  const m = (c.hr as HumanRig).m
  const P = c.paint
  const s = c.sec('skin')
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const amount = clamp(s.n('blush') * 0.45 + fr.expr.blush * 0.6, 0, 1)
  const sick = fr.expr.sick
  const parts: string[] = []
  const fg = faceGeom(c)
  const side = c.view === 'side'
  const { spacing, w: eyeW } = eyeLayout(c, m)
  if (amount > 0.03) {
    const skin = skinOf(c)
    // Automatic blush: rosy on light skin, a deeper berry on deep skin.
    const col = s.c('blushColor', skinTones(skin, P).depth > 0.4 ? mix(skin, '#c8385e', 0.5) : mix(skin, '#ff5c7a', 0.55))
    const cy = m.eyeY + m.headH * 0.15
    const xs = side ? [m.hw * 0.5] : [spacing * 1.05, -spacing * 1.05]
    if (shaded) {
      // A soft glow of colour, strongest in the middle of the cheek.
      for (const x of xs) parts.push(softSpot(c, x, cy, m.hw * 0.25, m.headH * 0.075, col, Math.min(1, amount * 0.95)))
    } else parts.push(P.flat(xs.map((x) => ellipse(x, cy, m.hw * 0.2, m.headH * 0.055)).join(''), col, amount * 0.55))
    if (fr.expr.blush > 0.55 && P.detail > 1) {
      const lines = xs.map((x) => [0, 1, 2].map((i) => brush([[x - m.hw * 0.1 + i * m.hw * 0.08, cy + m.headH * 0.02], [x - m.hw * 0.05 + i * m.hw * 0.08, cy - m.headH * 0.02]], m.headH * 0.009, 0)).join('')).join('')
      parts.push(P.flat(lines, shadowOf(col, 0.3), 0.7))
    }
  }
  if (sick > 0.05) {
    // A queasy green that drains down from the forehead, clipped to the face.
    const clip = faceClip(c, m)
    const top = fg.crownY
    const bottom = m.noseY + m.headH * 0.02
    const band = rect(-m.hw * 1.1, top, m.hw * 2.2, bottom - top)
    const fill = linearPaint(c, [[0, '#7bd36b', 0.55], [0.55, '#7bd36b', 0.42], [1, '#7bd36b', 0]])
    parts.push(g({ 'clip-path': url(clip) }, el('path', { d: band, fill, 'fill-opacity': sick < 1 ? f(sick) : undefined })))
    if (shaded) for (const x of side ? [m.hw * 0.6] : [spacing, -spacing]) parts.push(softSpot(c, x, m.eyeY + eyeW * 0.4, eyeW * 0.5, eyeW * 0.16, '#6a7fa8', 0.3 * sick))
  }
  if (parts.length) out.add('head', Z.blush, 'blush', parts.join(''))

  // Tears, sweat, the anger mark, zzz and steam.
  const x = fr.expr
  if (x.tears < 0.05 && x.sweat < 0.1 && !x.vein && !x.zzz && !x.steam) return
  const sx = (c.hr as HumanRig).sx
  const lowY = m.eyeY + eyeW * 0.22
  const fx: ExprFxSpec = {
    eyes: side ? [{ x: m.hw * 0.6, y: lowY, dir: -1 }] : [{ x: spacing * sx, y: lowY, dir: sx }, { x: -spacing * sx, y: lowY, dir: -sx }],
    eyeW,
    unit: m.headH,
    halfW: m.hw,
    topY: fg.crownY,
    templeX: side ? m.hw * 0.42 : fg.widthAt(m.eyeY - m.headH * 0.12) * 0.82,
    templeY: m.eyeY - m.headH * 0.12,
    veinX: side ? m.hw * 0.5 : -fg.widthAt(fg.crownY * 0.6) * 0.62,
    veinY: side ? fg.crownY * 0.62 : fg.crownY * 0.62,
    tears: x.tears,
    sweat: x.sweat,
    vein: x.vein,
    zzz: x.zzz,
    steam: x.steam,
  }
  const tears = drawTears(c, fx)
  if (tears) out.add('head', Z.eyes + 1, 'tears', tears)
  const marks = drawSweat(c, fx) + drawVein(c, fx)
  if (marks) out.add('head', Z.hairFront + 1, 'sweat', marks)
  const emote = drawZzz(c, fx) + drawSteam(c, fx)
  if (emote) out.add('head', Z.emote, 'emote', emote)
}

/** Position helpers other generators (glasses, masks, piercings) share. */
export function faceAnchors(c: Ctx) {
  const m = (c.hr as HumanRig).m
  const { w, spacing } = eyeLayout(c, m)
  return { eyeW: w, spacing, eyeY: m.eyeY, noseY: m.noseY, mouthY: m.mouthY, hw: m.hw, headH: m.headH }
}

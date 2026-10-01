/* Held items. Each is drawn in "item space" — grip at the origin, the item's long axis
 * pointing up (−y) — and then placed at the hand's grip point, tilted slightly outward.
 * Because it rides the hand bone, a sword follows the arm through an attack swing.
 *
 * Every item is crafted from its materials: blades have a fuller, bevels and a lit edge;
 * wood has grain; leather grips are wrapped; glass and flames glow (baked stills get a soft
 * bloom); plastics and candy get crisp speculars. Rich detail is tiered (flat / standard /
 * baked) so animation frames stay cheap.
 *
 * The sword, staff, wand, trophy and orb are premium: registered premium art draws them
 * (render/premiumArt.ts), and builds without it draw a placeholder (parts/shared/placeholder.ts). */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { lerp, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f as fx, poly, rect, roundRect, scallop, smooth, star } from '../../core/path.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { bloom, castShadow, clipOf, flower, grain, halo, leaf, lightOf, litArc, litEdge, metal, moving, sphere, spec, stitch, tier } from './accMat.ts'
import type { HandFrame } from './frames.ts'
import { premiumArt } from './placeholder.ts'

/** A spiral leather wrap over a grip from y0 to y1 (item space, x centred). */
export function wrapGrip(c: Ctx, w: number, y0: number, y1: number, col: string): string {
  const P = c.paint
  const d = roundRect(-w / 2, Math.min(y0, y1), w, Math.abs(y1 - y0), w * 0.3)
  let out = P.shape(d, col, { material: 'leather' })
  if (tier(c) > 0) {
    const n = Math.max(3, Math.round(Math.abs(y1 - y0) / (w * 0.7)))
    let lines = ''
    for (let i = 1; i < n; i++) {
      const y = lerp(Math.min(y0, y1), Math.max(y0, y1), i / n)
      lines += `M${fx(-w / 2)} ${fx(y + w * 0.2)}L${fx(w / 2)} ${fx(y - w * 0.2)}`
    }
    out += P.line(lines, shadowOf(col, 0.4), w * 0.1, { opacity: 0.85 })
  }
  return out
}

/** A wooden stick from y0 (bottom) to y1 (top), with grain and an end cap. */
export function stick(c: Ctx, w0: number, w1: number, y0: number, y1: number, col: string, seed = 0): string {
  const P = c.paint
  const d = brush([[0, y0], [0, y1]], w0, w1)
  return P.shape(d, col, { material: 'wood' }) + grain(c, [0, y0], [0, y1], Math.max(w0, w1), col, seed)
}

/** Layered flame: outer colour, hot middle, white core; baked adds a bloom. */
function flame(c: Ctx, x: number, y: number, w: number, h: number, col: string): string {
  const P = c.paint
  const t = tier(c)
  const outer = smooth([[x - w, y], [x - w * 0.75, y - h * 0.45], [x - w * 0.1, y - h * 0.8], [x + w * 0.05, y - h, 0], [x + w * 0.3, y - h * 0.62], [x + w * 0.8, y - h * 0.4], [x + w, y]])
  const mid = smooth([[x - w * 0.6, y], [x - w * 0.4, y - h * 0.45], [x + w * 0.02, y - h * 0.78, 0], [x + w * 0.4, y - h * 0.42], [x + w * 0.6, y]])
  const core = smooth([[x - w * 0.3, y], [x, y - h * 0.45, 0], [x + w * 0.3, y]])
  let out = ''
  if (t === 2) out += bloom(c, P.flat(outer, col, 0.85), { x: x - w, y: y - h, w: w * 2, h }, w * 0.45)
  out += t > 0 ? `<path d="${outer}" fill="${P.linear(`fl${col.replace('#', '')}`, [[0, mix(col, '#ffe082', 0.3)], [1, col, 0.85]], [0.5, 1], [0.5, 0])}"/>` : P.flat(outer, col)
  out += P.flat(mid, '#ffd54f', t > 0 ? 0.95 : 1) + P.flat(core, '#fffde7', 0.95)
  return out
}

export function drawHeld(c: Ctx, id: string, p: Reader, f: HandFrame): { behind: string; front: string } {
  const premium = premiumArt('held', id)
  if (premium) return inHand(f, premium(c, id, p, f))
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const s = f.s
  const col = p.c('color', '#888888')
  const col2 = p.c('color2', shadowOf(col, 0.3))
  let behind = ''
  let front = ''
  switch (id) {
    case 'bow-weapon': {
      const k = -f.thumb
      const limb = `M${fx(-s * 0.1)} ${fx(-s * 2.2)}Q${fx(k * s * 1.1)} 0 ${fx(-s * 0.1)} ${fx(s * 2.2)}`
      behind += P.line(`M${fx(-s * 0.1)} ${fx(-s * 2.2)}V${fx(s * 2.2)}`, '#f5f2eb', s * 0.025)
      behind += P.line(limb, P.ink(col), s * 0.14 + P.lw * 1.4) + P.line(limb, col, s * 0.14)
      if (t > 0) {
        behind += `<g transform="translate(${fx(L[0] * s * 0.03)} ${fx(L[1] * s * 0.03)})">${P.line(limb, highlightOf(col, 0.4), s * 0.035, { opacity: 0.8 })}</g>`
        behind += wrapGrip(c, s * 0.2, -s * 0.35, s * 0.35, '#5d4037')
        behind += P.shape(circle(-s * 0.1, -s * 2.2, s * 0.06) + circle(-s * 0.1, s * 2.2, s * 0.06), shadowOf(col, 0.2), { outline: 0.5 })
      }
      break
    }
    case 'torch': {
      behind += stick(c, s * 0.14, s * 0.22, s * 0.6, -s * 1.3, col, 0.2)
      if (t > 0) {
        // Oil-soaked rag wrapped at the head.
        behind += P.shape(roundRect(-s * 0.16, -s * 1.42, s * 0.32, s * 0.34, s * 0.08), '#5d4a3a', { material: 'cloth' })
        behind += P.line(`M${fx(-s * 0.16)} ${fx(-s * 1.32)}L${fx(s * 0.16)} ${fx(-s * 1.24)}M${fx(-s * 0.16)} ${fx(-s * 1.2)}L${fx(s * 0.16)} ${fx(-s * 1.12)}`, '#3e3128', s * 0.03)
        behind += moving(c, 'breathe', halo(c, 0, -s * 1.9, s * 1.1, '#ffb347', 0.55), 0, 2.2)
      }
      front += moving(c, 'flicker', flame(c, 0, -s * 1.35, s * 0.3, s * 1.15, '#ff7043'))
      if (t === 2) front += P.flat(circle(s * 0.25, -s * 2.55, s * 0.03) + circle(-s * 0.18, -s * 2.75, s * 0.025), '#ffd180', 0.9)
      break
    }
    case 'lantern': {
      const glowCol = col2
      front += P.line(`M0 ${fx(s * 0.2)}V${fx(s * 0.5)}`, col, s * 0.05) + P.line(circle(0, s * 0.45, s * 0.1), col, s * 0.04)
      if (t > 0) front += moving(c, 'breathe', halo(c, 0, s * 1.1, s * 1.15, glowCol, 0.5), 0, 1.4)
      const glass = roundRect(-s * 0.3, s * 0.68, s * 0.6, s * 0.8, s * 0.08)
      if (t === 2) front += bloom(c, P.flat(glass, glowCol, 0.8), { x: -s * 0.3, y: s * 0.68, w: s * 0.6, h: s * 0.8 }, s * 0.12)
      front += t > 0 ? P.shape(glass, glowCol, { paint: P.linear(`lant${glowCol.replace('#', '')}`, [[0, mix(glowCol, '#ffffff', 0.55)], [0.6, glowCol], [1, shadowOf(glowCol, 0.2)]], [0.5, 0.3], [0.5, 1]), shade: false, outline: 0.5, material: 'glass', spec: 0.4 }) : P.flat(glass, glowCol)
      if (t > 0) front += moving(c, 'flicker', flame(c, 0, s * 1.2, s * 0.08, s * 0.28, '#ff9800'), 0.3)
      // Metal cage: cap, base, bars.
      const cap = smooth([[-s * 0.4, s * 0.7], [-s * 0.3, s * 0.55], [0, s * 0.5], [s * 0.3, s * 0.55], [s * 0.4, s * 0.7]])
      front += metal(c, cap, col, { spec: 0.5 }) + metal(c, roundRect(-s * 0.4, s * 1.46, s * 0.8, s * 0.16, s * 0.05), col, { spec: 0.3 })
      front += P.line(`M${fx(-s * 0.3)} ${fx(s * 0.7)}V${fx(s * 1.46)}M${fx(s * 0.3)} ${fx(s * 0.7)}V${fx(s * 1.46)}M0 ${fx(s * 0.7)}V${fx(s * 1.46)}`, shadowOf(col, 0.1), s * 0.05)
      break
    }
    case 'phone': {
      const bodyD = roundRect(-s * 0.3, -s * 0.85, s * 0.6, s * 1.25, s * 0.1)
      front += P.shape(bodyD, col, { material: 'plastic' })
      const scr = roundRect(-s * 0.25, -s * 0.79, s * 0.5, s * 1.12, s * 0.06)
      front += t > 0 ? `<path d="${scr}" fill="${P.linear('phone', [[0, '#5b8def'], [0.6, '#4fc3f7'], [1, '#7c4dff']], [0, 0], [1, 1])}"/>` : P.flat(scr, '#4fc3f7', 0.9)
      if (t > 0) {
        front += P.flat(roundRect(-s * 0.18, -s * 0.62, s * 0.36, s * 0.14, s * 0.03) + roundRect(-s * 0.18, -s * 0.42, s * 0.36, s * 0.1, s * 0.03), '#ffffff', 0.55)
        front += P.flat([-0.12, 0, 0.12].map((x) => circle(x * s, s * 0.2, s * 0.04)).join(''), '#ffffff', 0.7)
        front += P.flat(poly([[-s * 0.25, -s * 0.1], [s * 0.05, -s * 0.79], [s * 0.2, -s * 0.79], [-s * 0.25, s * 0.25]]), '#ffffff', 0.14)
      }
      break
    }
    case 'controller': {
      const shell = smooth([[-s * 0.85, -s * 0.1], [-s * 0.4, -s * 0.35], [s * 0.4, -s * 0.35], [s * 0.85, -s * 0.1], [s * 0.75, s * 0.4], [s * 0.35, s * 0.25], [-s * 0.35, s * 0.25], [-s * 0.75, s * 0.4]])
      front += P.shape(shell, col, { material: 'plastic' })
      const dpad = roundRect(-s * 0.62, -s * 0.12, s * 0.3, s * 0.09, s * 0.02) + roundRect(-s * 0.515, -s * 0.225, s * 0.09, s * 0.3, s * 0.02)
      front += P.shape(dpad, shadowOf(col, 0.4), { outline: 0.4, shade: 0.4 })
      for (const [x, y] of [[0.45, -0.18], [0.58, -0.06], [0.45, 0.06], [0.32, -0.06]] as [number, number][]) front += t > 0 ? sphere(c, x * s, y * s, s * 0.055, col2, 'gloss', { outline: 0.5 }) : P.flat(circle(x * s, y * s, s * 0.055), col2)
      if (t > 0) {
        front += P.shape(circle(-s * 0.2, s * 0.1, s * 0.09) + circle(s * 0.2, s * 0.1, s * 0.09), shadowOf(col, 0.3), { outline: 0.5, shade: 0.6 })
        front += spec(c, -s * 0.45 + L[0] * s * 0.1, -s * 0.24, s * 0.16, s * 0.025, 0.7, -10)
      }
      break
    }
    case 'book': {
      // Page block, cover, spine and a ribbon bookmark.
      front += P.shape(roundRect(-s * 0.55, -s * 0.72, s * 1.12, s * 1.46, s * 0.04), '#f5f0e1', { material: 'cloth' })
      if (t > 0) front += P.line([0.1, 0.25, 0.4].map((k) => `M${fx(s * 0.58)} ${fx(-s * 0.68 + k * s * 0.1)}V${fx(s * 0.68)}`).join(''), '#c9bfa6', s * 0.01)
      const cover = roundRect(-s * 0.6, -s * 0.75, s * 1.12, s * 1.44, s * 0.06)
      front += P.shape(cover, col, { material: 'leather' })
      if (t > 0) {
        front += P.shape(roundRect(-s * 0.6, -s * 0.75, s * 0.16, s * 1.44, s * 0.05), shadowOf(col, 0.2), { outline: 0.5, material: 'leather' })
        front += P.line(`M${fx(-s * 0.6)} ${fx(-s * 0.55)}h${fx(s * 0.16)}M${fx(-s * 0.6)} ${fx(s * 0.5)}h${fx(s * 0.16)}`, '#f2d14a', s * 0.03)
        front += P.shape(roundRect(-s * 0.3, -s * 0.5, s * 0.66, s * 0.3, s * 0.03), '#f2d14a', { material: 'metal', outline: 0.4, shade: 0.4 })
        front += P.line(`M${fx(-s * 0.2)} ${fx(-s * 0.4)}h${fx(s * 0.46)}M${fx(-s * 0.2)} ${fx(-s * 0.3)}h${fx(s * 0.32)}`, shadowOf('#f2d14a', 0.45), s * 0.03)
        front += P.shape(poly([[s * 0.3, s * 0.66], [s * 0.4, s * 0.66], [s * 0.4, s * 0.98], [s * 0.35, s * 0.92], [s * 0.3, s * 0.98]]), '#c62828', { outline: 0.4, shade: 0.4 })
        if (P.detail > 1) front += stitch(c, roundRect(-s * 0.38, -s * 0.68, s * 0.84, s * 1.3, s * 0.04), col, s * 0.012, true)
      } else front += P.flat(rect(-s * 0.55, s * 0.62, s * 1.1, s * 0.1), '#f5f2eb') + P.line(`M${fx(-s * 0.35)} ${fx(-s * 0.4)}h${fx(s * 0.7)}M${fx(-s * 0.35)} ${fx(-s * 0.2)}h${fx(s * 0.5)}`, shadowOf(col, 0.4), s * 0.05)
      break
    }
    case 'balloon': {
      behind += P.line(`M0 0Q${fx(s * 0.5)} ${fx(-s * 1.5)} ${fx(-s * 0.1)} ${fx(-s * 3.0)}T${fx(s * 0.1)} ${fx(-s * 4.45)}`, '#f5f2eb', s * 0.03)
      const r = s * 0.9
      const cy = -s * 5.4
      front += t > 0 ? sphere(c, s * 0.1, cy, r, col, 'gloss') : P.shape(ellipse(s * 0.1, cy, s * 0.85, s * 1.0), col)
      if (t > 0) front += P.flat(ellipse(s * 0.1 - L[0] * r * 0.5, cy - L[1] * r * 0.5, r * 0.2, r * 0.14), highlightOf(col, 0.3), 0.5)
      front += P.shape(poly([[s * 0.0, -s * 4.42], [s * 0.2, -s * 4.42], [s * 0.1, -s * 4.56]]), col, { outline: 0.6 })
      break
    }
    case 'flower-held': {
      behind += P.line(`M0 ${fx(s * 0.4)}Q${fx(s * 0.15)} ${fx(-s * 1)} 0 ${fx(-s * 2.1)}`, P.ink(col2), s * 0.08 + P.lw) + P.line(`M0 ${fx(s * 0.4)}Q${fx(s * 0.15)} ${fx(-s * 1)} 0 ${fx(-s * 2.1)}`, col2, s * 0.08)
      behind += t > 0 ? leaf(c, s * 0.07, -s * 0.9, s * 0.5, -0.5, col2) + leaf(c, s * 0.05, -s * 1.4, s * 0.4, Math.PI + 0.5, col2) : P.shape(ellipse(s * 0.25, -s * 1.1, s * 0.25, s * 0.1), col2)
      front += flower(c, 0, -s * 2.3, s * 0.48, col, '#fdd835', { petals: 6 })
      break
    }
    case 'icecream': {
      const cone = poly([[-s * 0.36, -s * 0.8], [s * 0.36, -s * 0.8], [0, s * 0.3]])
      front += P.shape(cone, '#e0a060', { material: 'wood' })
      if (t > 0) {
        // Waffle cross-hatch.
        let hatch = ''
        for (let k = -2; k <= 2; k++) hatch += `M${fx(k * s * 0.14 - s * 0.2)} ${fx(-s * 0.78)}L${fx(k * s * 0.14 + s * 0.15)} ${fx(-s * 0.1)}M${fx(k * s * 0.14 + s * 0.2)} ${fx(-s * 0.78)}L${fx(k * s * 0.14 - s * 0.15)} ${fx(-s * 0.1)}`
        front += `<g clip-path="url(#${clipOf(c, cone)})">${P.line(hatch, '#b0743a', s * 0.035)}</g>`
      }
      const scoop = t > 0 ? scallop([[-s * 0.46, -s * 0.8], [-s * 0.3, -s * 0.74], [-s * 0.12, -s * 0.8], [s * 0.08, -s * 0.72], [s * 0.26, -s * 0.8], [s * 0.46, -s * 0.78], [s * 0.4, -s * 1.2], [0, -s * 1.46], [-s * 0.4, -s * 1.2]], 0.12) : circle(0, -s * 1.05, s * 0.42)
      front += P.shape(scoop, col, { material: 'wet', spec: 0.5 })
      if (t > 0) {
        const sprinkles = [[-0.2, -1.2, 0.3], [0.15, -1.05, -0.4], [0.05, -1.3, 1.1], [-0.25, -0.95, 0.9], [0.28, -1.22, 0.2]].map(([x, y, a]) => `M${fx(x * s - Math.cos(a) * s * 0.04)} ${fx(y * s - Math.sin(a) * s * 0.04)}l${fx(Math.cos(a) * s * 0.08)} ${fx(Math.sin(a) * s * 0.08)}`).join('')
        front += P.line(sprinkles, '#fdf6e3', s * 0.03) + P.line(sprinkles.split('M').slice(0, 3).join('M'), '#4fc3f7', s * 0.03)
        front += sphere(c, s * 0.1, -s * 1.5, s * 0.1, '#e53935', 'gloss', { outline: 0.6 }) + P.line(`M${fx(s * 0.1)} ${fx(-s * 1.58)}q${fx(s * 0.05)} ${fx(-s * 0.1)} ${fx(s * 0.15)} ${fx(-s * 0.12)}`, '#43a047', s * 0.025)
      } else front += P.flat(circle(s * 0.1, -s * 1.45, s * 0.08), '#e53935')
      break
    }
    case 'coffee': {
      const cup = poly([[-s * 0.4, -s * 0.8], [s * 0.4, -s * 0.8], [s * 0.32, s * 0.45], [-s * 0.32, s * 0.45]])
      front += P.shape(cup, col, { material: 'cloth' })
      const sleeve = poly([[-s * 0.38, -s * 0.35], [s * 0.38, -s * 0.35], [s * 0.35, s * 0.05], [-s * 0.35, s * 0.05]])
      front += P.shape(sleeve, col2, { material: 'cloth' })
      if (t > 0) front += P.shape(circle(0, -s * 0.15, s * 0.1), highlightOf(col2, 0.35), { outline: 0.4, shade: false })
      const lid = roundRect(-s * 0.45, -s * 0.95, s * 0.9, s * 0.18, s * 0.06)
      front += P.shape(lid, '#f5f2eb', { material: 'plastic' }) + P.shape(roundRect(-s * 0.36, -s * 1.03, s * 0.72, s * 0.1, s * 0.05), '#ece6da', { material: 'plastic', outline: 0.6 })
      if (t > 0) front += P.flat(roundRect(s * 0.08, -s * 1.01, s * 0.14, s * 0.035, s * 0.015), '#6d5c4a')
      if (t === 2) front += P.line(`M${fx(-s * 0.1)} ${fx(-s * 1.1)}q${fx(-s * 0.12)} ${fx(-s * 0.2)} 0 ${fx(-s * 0.4)}t0 ${fx(-s * 0.4)}M${fx(s * 0.12)} ${fx(-s * 1.12)}q${fx(-s * 0.1)} ${fx(-s * 0.18)} 0 ${fx(-s * 0.35)}t0 ${fx(-s * 0.3)}`, '#ffffff', s * 0.05, { opacity: 0.3 })
      break
    }
    case 'mic': {
      front += P.shape(brush([[0, s * 0.4], [0, -s * 0.6]], s * 0.14, s * 0.22), col, { material: 'plastic' })
      front += metal(c, roundRect(-s * 0.14, -s * 0.66, s * 0.28, s * 0.1, s * 0.03), '#c9ccd3', { spec: 0.4 })
      const gy = -s * 0.88
      front += t > 0 ? sphere(c, 0, gy, s * 0.3, '#9e9e9e', 'metal') : P.shape(circle(0, gy, s * 0.3), '#9e9e9e')
      if (t > 0 && P.detail > 1) {
        // Mesh grille.
        let mesh = ''
        for (let k = -2; k <= 2; k++) mesh += `M${fx(k * s * 0.1 - s * 0.2)} ${fx(gy - s * 0.25)}L${fx(k * s * 0.1 + s * 0.2)} ${fx(gy + s * 0.25)}M${fx(k * s * 0.1 + s * 0.2)} ${fx(gy - s * 0.25)}L${fx(k * s * 0.1 - s * 0.2)} ${fx(gy + s * 0.25)}`
        front += `<g clip-path="url(#${clipOf(c, circle(0, gy, s * 0.28))})">${P.line(mesh, '#5f6368', s * 0.018, { opacity: 0.7 })}</g>`
        front += P.line(circle(0, gy, s * 0.3), P.ink('#9e9e9e'), P.lw * 0.8)
      }
      break
    }
    case 'flag': {
      const out = -f.thumb
      behind += stick(c, s * 0.1, s * 0.09, s * 0.5, -s * 3.8, '#a1887f', 0.5)
      behind += t > 0 ? sphere(c, 0, -s * 3.88, s * 0.1, '#f2d14a', 'metal', { outline: 0.8 }) : ''
      const cloth = smooth([[0, -s * 3.75, 0], [out * s * 0.7, -s * 3.85], [out * s * 1.4, -s * 3.6], [out * s * 2.0, -s * 3.62, 0], [out * s * 1.95, -s * 2.62, 0], [out * s * 1.35, -s * 2.62], [out * s * 0.7, -s * 2.85], [0, -s * 2.72, 0]])
      front += P.shape(cloth, col, { material: 'cloth' })
      front += P.flat(smooth([[0, -s * 3.28, 0], [out * s * 0.7, -s * 3.38], [out * s * 1.4, -s * 3.12], [out * s * 1.98, -s * 3.14, 0], [out * s * 1.97, -s * 2.94, 0], [out * s * 1.38, -s * 2.92], [out * s * 0.7, -s * 3.16], [0, -s * 3.06, 0]]), col2)
      if (t > 0) front += P.flat(smooth([[out * s * 0.55, -s * 3.8], [out * s * 0.85, -s * 3.78], [out * s * 0.85, -s * 2.83], [out * s * 0.55, -s * 2.84]]), shadowOf(col, 0.3), 0.35) + P.flat(smooth([[out * s * 1.25, -s * 3.62], [out * s * 1.5, -s * 3.6], [out * s * 1.5, -s * 2.63], [out * s * 1.25, -s * 2.64]]), highlightOf(col, 0.3), 0.3)
      break
    }
    case 'umbrella': {
      behind += P.shape(roundRect(-s * 0.05, -s * 4.2, s * 0.1, s * 4.6, s * 0.04), '#5d4037', { material: 'wood' }) + P.line(`M0 ${fx(s * 0.4)}q0 ${fx(s * 0.3)} ${fx(s * 0.25)} ${fx(s * 0.3)}`, '#5d4037', s * 0.1)
      const W = s * 2.3
      const top = -s * 5.3
      const canopy = smooth([[-W, -s * 3.6, 0], [-W * 0.6, -s * 4.9], [0, top], [W * 0.6, -s * 4.9], [W, -s * 3.6, 0], [W * 0.66, -s * 3.85], [W * 0.33, -s * 3.6], [0, -s * 3.85], [-W * 0.33, -s * 3.6], [-W * 0.66, -s * 3.85]])
      front += P.shape(canopy, col, { material: 'cloth' })
      if (t > 0) {
        // Alternating panels in the second colour, each gore shaded by its angle to the light.
        const gore = (x0: number, x1: number, yb0: number, yb1: number) => smooth([[0, top + s * 0.02, 0], [x0 * 0.55, -s * 4.8], [x0, yb0, 0], [(x0 + x1) / 2, (yb0 + yb1) / 2 - s * 0.2], [x1, yb1, 0], [x1 * 0.55, -s * 4.8]])
        front += P.flat(gore(-W * 0.66, -W * 0.33, -s * 3.85, -s * 3.6) + gore(0, W * 0.33, -s * 3.85, -s * 3.6) + gore(W * 0.66, W, -s * 3.85, -s * 3.6), col2, 0.9)
        front += P.flat(gore(L[0] < 0 ? -W : W * 0.66, L[0] < 0 ? -W * 0.66 : W, L[0] < 0 ? -s * 3.6 : -s * 3.85, L[0] < 0 ? -s * 3.85 : -s * 3.6), '#ffffff', 0.18)
      }
      front += P.line(`M0 ${fx(top)}V${fx(-s * 3.8)}M${fx(-W * 0.5)} ${fx(-s * 5.0)}L${fx(-W * 0.33)} ${fx(-s * 3.65)}M${fx(W * 0.5)} ${fx(-s * 5.0)}L${fx(W * 0.33)} ${fx(-s * 3.65)}`, shadowOf(col, 0.35), s * 0.04, { opacity: 0.6 })
      front += t > 0 ? sphere(c, 0, top - s * 0.08, s * 0.1, '#5d4037', 'gloss', { outline: 0.8 }) : ''
      break
    }
    case 'pickaxe': {
      behind += stick(c, s * 0.15, s * 0.13, s * 0.6, -s * 3.1, col2, 0.4)
      if (t > 0) behind += wrapGrip(c, s * 0.17, -s * 0.3, s * 0.4, '#4e342e')
      const head = smooth([[-s * 1.3, -s * 2.7, 0], [-s * 0.6, -s * 3.2], [0, -s * 3.3], [s * 0.6, -s * 3.2], [s * 1.3, -s * 2.7, 0], [s * 0.6, -s * 2.95], [0, -s * 3.0], [-s * 0.6, -s * 2.95]])
      front += metal(c, head, col, { spec: 0.8 })
      if (t > 0) front += P.shape(roundRect(-s * 0.13, -s * 3.35, s * 0.26, s * 0.45, s * 0.05), shadowOf(col, 0.25), { material: 'metal', outline: 0.6 })
      break
    }
    case 'paintbrush': {
      behind += P.shape(brush([[0, s * 0.5], [0, -s * 1.6]], s * 0.1, s * 0.16), '#a1887f', { material: 'wood' })
      if (t > 0) behind += P.flat(ellipse(0, s * 0.35, s * 0.05, s * 0.08), col)
      front += metal(c, roundRect(-s * 0.1, -s * 1.8, s * 0.2, s * 0.25, s * 0.03), '#b0bec5', { spec: 0.6 })
      if (t > 0) front += P.line(`M${fx(-s * 0.1)} ${fx(-s * 1.62)}h${fx(s * 0.2)}M${fx(-s * 0.1)} ${fx(-s * 1.7)}h${fx(s * 0.2)}`, shadowOf('#b0bec5', 0.35), s * 0.015)
      const bristle = smooth([[-s * 0.12, -s * 1.8], [-s * 0.13, -s * 2.05], [0, -s * 2.32, 0], [s * 0.13, -s * 2.05], [s * 0.12, -s * 1.8]])
      front += P.shape(bristle, col, { material: 'wet' })
      if (t > 0) front += P.line(`M${fx(-s * 0.05)} ${fx(-s * 1.85)}L${fx(-s * 0.03)} ${fx(-s * 2.15)}M${fx(s * 0.05)} ${fx(-s * 1.85)}L${fx(s * 0.03)} ${fx(-s * 2.12)}`, shadowOf(col, 0.3), s * 0.015, { opacity: 0.7 })
      break
    }
    case 'teddy': {
      const cy = s * 1.2
      const earIn = (x: number) => circle(x, cy - s * 0.55, s * 0.09)
      const bodyD = [ellipse(0, cy + s * 0.55, s * 0.5, s * 0.6), circle(0, cy - s * 0.2, s * 0.45), circle(-s * 0.35, cy - s * 0.55, s * 0.17), circle(s * 0.35, cy - s * 0.55, s * 0.17), ellipse(-s * 0.5, cy + s * 0.3, s * 0.14, s * 0.22), ellipse(s * 0.5, cy + s * 0.3, s * 0.14, s * 0.22)]
      front += castShadow(c, ellipse(0, cy + s * 1.15, s * 0.45, s * 0.08), 0.2)
      front += t > 0 ? P.union(bodyD, col, { material: 'fur' }) : P.shape(bodyD.slice(0, 4).join(''), col)
      front += P.flat(earIn(-s * 0.35) + earIn(s * 0.35), highlightOf(col, 0.3), 0.8)
      front += P.flat(ellipse(0, cy + s * 0.6, s * 0.28, s * 0.35), highlightOf(col, 0.3), 0.8)
      front += P.shape(ellipse(0, cy - s * 0.08, s * 0.16, s * 0.12), highlightOf(col, 0.35), { outline: 0.4, shade: 0.4 })
      front += P.flat(ellipse(0, cy - s * 0.12, s * 0.06, s * 0.045), '#26252c')
      for (const x of [-s * 0.15, s * 0.15]) front += t > 0 ? sphere(c, x, cy - s * 0.27, s * 0.05, '#26252c', 'gloss') : P.flat(circle(x, cy - s * 0.27, s * 0.05), '#26252c')
      if (t > 0) {
        front += stitch(c, `M0 ${fx(cy + s * 0.25)}V${fx(cy + s * 0.95)}`, col, s * 0.02)
        front += P.line(`M${fx(-s * 0.06)} ${fx(cy - s * 0.03)}Q0 ${fx(cy + s * 0.02)} ${fx(s * 0.06)} ${fx(cy - s * 0.03)}`, '#26252c', s * 0.02)
        front += P.shape(smooth([[0, cy + s * 0.2], [-s * 0.18, cy + s * 0.12], [-s * 0.16, cy + s * 0.3], [0, cy + s * 0.22], [s * 0.16, cy + s * 0.3], [s * 0.18, cy + s * 0.12]]), '#e53935', { outline: 0.4, shade: 0.5 })
      }
      break
    }
    case 'lollipop': {
      behind += P.shape(roundRect(-s * 0.05, -s * 1.7, s * 0.1, s * 2.1, s * 0.04), '#f5f2eb', { material: 'plastic' })
      let spiral = `M0 ${fx(-s * 2.05)}`
      for (let i = 1; i <= 22; i++) {
        const a = i * 0.62
        const r = (i / 22) * s * 0.5
        spiral += `L${fx(Math.cos(a) * r)} ${fx(-s * 2.05 + Math.sin(a) * r)}`
      }
      front += t > 0 ? sphere(c, 0, -s * 2.05, s * 0.55, col, 'gloss') : P.shape(circle(0, -s * 2.05, s * 0.55), col)
      front += P.line(spiral, col2, s * 0.09)
      if (t > 0) front += spec(c, L[0] * s * 0.28, -s * 2.05 + L[1] * s * 0.28, s * 0.14, s * 0.07, 0.8, 45) + litArc(c, 0, -s * 2.05, s * 0.5, s * 0.5, '#ffffff', s * 0.04, 1)
      break
    }
    case 'basketball': {
      const sport = p.s('sport') || 'basketball'
      const r = s * 0.8
      const y = -s * 0.5
      const base = sport === 'soccer' ? '#f5f2eb' : sport === 'volleyball' ? '#fdf6e3' : col
      front += t > 0 ? sphere(c, 0, y, r, base, sport === 'basketball' ? 'matte' : 'gloss', { material: sport === 'basketball' ? 'rubber' : 'leather' }) : P.shape(circle(0, y, r), base)
      if (sport === 'basketball') {
        const seams = `M${fx(-r)} ${fx(y)}H${fx(r)}M0 ${fx(y - r)}V${fx(y + r)}M${fx(-r * 0.7)} ${fx(y - r * 0.7)}Q${fx(-r * 0.2)} ${fx(y)} ${fx(-r * 0.7)} ${fx(y + r * 0.7)}M${fx(r * 0.7)} ${fx(y - r * 0.7)}Q${fx(r * 0.2)} ${fx(y)} ${fx(r * 0.7)} ${fx(y + r * 0.7)}`
        front += P.line(seams, '#3e2723', s * 0.05)
        if (t > 0 && P.detail > 1) {
          let dots = ''
          for (let i = 0; i < 14; i++) dots += circle(Math.cos(i * 2.4) * r * 0.55 * ((i % 3) / 3 + 0.3), y + Math.sin(i * 2.4) * r * 0.55 * ((i % 3) / 3 + 0.3), s * 0.012)
          front += P.flat(dots, shadowOf(col, 0.3), 0.6)
        }
      } else if (sport === 'soccer') {
        front += P.flat(poly([[0, y - r * 0.3], [r * 0.28, y - r * 0.08], [r * 0.18, y + r * 0.25], [-r * 0.18, y + r * 0.25], [-r * 0.28, y - r * 0.08]]), '#26252c')
        if (t > 0) {
          const edge = (a: number) => poly([[Math.cos(a) * r * 0.98, y + Math.sin(a) * r * 0.98], [Math.cos(a + 0.35) * r * 0.75, y + Math.sin(a + 0.35) * r * 0.75], [Math.cos(a - 0.35) * r * 0.75, y + Math.sin(a - 0.35) * r * 0.75]])
          front += P.flat([-Math.PI / 2, -0.3, 0.95, 2.2, 3.45].map((a) => edge(a)).join(''), '#26252c', 0.95)
          front += P.line(`M0 ${fx(y - r * 0.3)}L0 ${fx(y - r * 0.8)}M${fx(r * 0.28)} ${fx(y - r * 0.08)}L${fx(r * 0.72)} ${fx(y - r * 0.2)}M${fx(-r * 0.28)} ${fx(y - r * 0.08)}L${fx(-r * 0.72)} ${fx(y - r * 0.2)}M${fx(r * 0.18)} ${fx(y + r * 0.25)}L${fx(r * 0.42)} ${fx(y + r * 0.62)}M${fx(-r * 0.18)} ${fx(y + r * 0.25)}L${fx(-r * 0.42)} ${fx(y + r * 0.62)}`, '#9e9a92', s * 0.02)
        }
      } else {
        front += P.line(`M${fx(-r * 0.9)} ${fx(y - r * 0.3)}Q0 ${fx(y)} ${fx(r * 0.6)} ${fx(y - r * 0.8)}M${fx(-r * 0.5)} ${fx(y + r * 0.8)}Q${fx(r * 0.1)} ${fx(y + r * 0.1)} ${fx(r * 0.9)} ${fx(y + r * 0.35)}`, '#1e88e5', s * 0.06)
        if (t > 0) front += P.line(`M${fx(-r * 0.95)} ${fx(y - r * 0.05)}Q${fx(r * 0.1)} ${fx(y + r * 0.2)} ${fx(r * 0.75)} ${fx(y - r * 0.55)}`, '#fdd835', s * 0.05) + P.line(`M${fx(-r * 0.2)} ${fx(y - r * 0.95)}Q${fx(-r * 0.1)} ${fx(y - r * 0.2)} ${fx(-r * 0.75)} ${fx(y + r * 0.6)}`, shadowOf(base, 0.25), s * 0.02)
      }
      break
    }
  }
  return inHand(f, { behind, front })
}

/** A shield strapped to the forearm, facing out. */

/** Puts item-space art in the hand: at the grip point, tilted slightly outward. */
function inHand(f: HandFrame, d: { behind: string; front: string }): { behind: string; front: string } {
  const tilt = -f.thumb * 18
  const wrap = (svg: string) => (svg ? `<g transform="translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) rotate(${tilt})">${svg}</g>` : '')
  return { behind: wrap(d.behind), front: wrap(d.front) }
}
export function drawShield(c: Ctx, p: Reader, s: number, y: number): string {
  const P = c.paint
  const t = tier(c)
  const col = p.c('color', '#1e88e5')
  const rim = p.c('color2', '#c79212')
  const crest = p.s('crest') || 'star'
  const outer = smooth([[-s * 1.0, y - s * 1.1, 0.5], [s * 1.0, y - s * 1.1, 0.5], [s * 0.95, y + s * 0.2], [0, y + s * 1.35, 0], [-s * 0.95, y + s * 0.2]])
  const face = smooth([[-s * 0.82, y - s * 0.95, 0.5], [s * 0.82, y - s * 0.95, 0.5], [s * 0.78, y + s * 0.15], [0, y + s * 1.12, 0], [-s * 0.78, y + s * 0.15]])
  let out = metal(c, outer, rim, { spec: 0.8 })
  out += P.shape(face, col, { material: t > 0 ? 'wood' : undefined })
  if (t > 0) {
    // A soft dome: the face is lit toward the light and darkens toward the rim.
    if (P.detail > 1) out += [[-0.85, -1.0], [0.85, -1.0], [0.88, 0.1], [-0.88, 0.1], [0, 1.22]].map(([x, yy]) => sphere(c, x * s, y + yy * s, s * 0.05, rim, 'metal', { outline: false })).join('')
  }
  const emblem = (d: string) => (t > 0 ? metal(c, d, rim, { outline: 0.6, spec: 0.5 }) : P.flat(d, rim))
  if (crest === 'star') out += emblem(star(0, y - s * 0.05, s * 0.45, s * 0.2))
  else if (crest === 'cross') out += emblem(rect(-s * 0.1, y - s * 0.7, s * 0.2, s * 1.4) + rect(-s * 0.55, y - s * 0.25, s * 1.1, s * 0.2))
  else if (crest === 'lion') {
    out += emblem(scallop(Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2) * s * 0.42, y - s * 0.1 + Math.sin((i / 12) * Math.PI * 2) * s * 0.42] as P), 0.25))
    out += P.shape(circle(0, y - s * 0.1, s * 0.24), col, { outline: 0.5, shade: 0.5 })
    if (t > 0) out += P.flat(circle(-s * 0.08, y - s * 0.14, s * 0.03) + circle(s * 0.08, y - s * 0.14, s * 0.03) + poly([[-s * 0.05, y - s * 0.04], [s * 0.05, y - s * 0.04], [0, y + s * 0.02]]), rim)
  } else if (crest === 'dragon') out += emblem(smooth([[-s * 0.45, y + s * 0.3], [-s * 0.1, y - s * 0.55], [s * 0.1, y - s * 0.1], [s * 0.45, y - s * 0.4], [s * 0.25, y + s * 0.45]]))
  if (t === 2) out += litEdge(c, face, highlightOf(col, 0.4), s * 0.05, 0.6)
  return out
}

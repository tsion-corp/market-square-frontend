/* Neckwear, back items (wings, capes, packs), waist, wrists and tails.
 *
 * Construction cues per material: chains have links, pendants hang from a bail and cast a
 * small shadow, ties have a knot dimple, scarves are knitted with a fringe, packs have
 * straps, seams and zips, capes drape in folds with their lining showing. Rich detail is
 * tiered (flat / standard / baked).
 *
 * Wings and the jetpack are premium: their art plugs in through the premium art registry
 * (render/premiumArt.ts), and builds without it draw a placeholder (parts/shared/placeholder.ts). */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { lerp, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f as fx, heart, poly, rect, roundRect, sampleSmooth, scallop, smooth, star, tube, tubePts, type SP } from '../../core/path.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { castShadow, flower, folds, gem, glint, grain, leaf, lightOf, litEdge, metal, sphere, spec, stitch, tier } from './accMat.ts'
import { fabricPaint } from './fabric.ts'
import type { BackFrame, NeckFrame, WaistFrame } from './frames.ts'
import { premiumArt } from './placeholder.ts'

const TAU = Math.PI * 2

function ring(cx: number, cy: number, rx: number, ry: number, n: number, a0 = 0): P[] {
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

/** A metal buckle: frame, bar and prong. */
function buckle(c: Ctx, x: number, y: number, w: number, h: number, col: string, strap: string): string {
  const P = c.paint
  const t = tier(c)
  const frame = roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.18)
  const hole = roundRect(x - w * 0.3, y - h * 0.28, w * 0.6, h * 0.56, Math.min(w, h) * 0.1)
  let out = metal(c, frame + hole, col, { attrs: { 'fill-rule': 'evenodd' }, spec: 0.7 })
  if (t > 0) {
    out += P.flat(hole, shadowOf(strap, 0.25))
    out += metal(c, roundRect(x - w * 0.06, y - h * 0.3, w * 0.12, h * 0.6, w * 0.04), col, { outline: 0.4, spec: 0 })
    out += P.line(`M${fx(x)} ${fx(y)}H${fx(x + w * 0.42)}`, highlightOf(col, 0.2), Math.max(0.5, h * 0.07))
  }
  return out
}

/* ---- Neck ---------------------------------------------------------------------- */

export function drawNeckAcc(c: Ctx, id: string, p: Reader, f: NeckFrame): string {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', '#f2d14a')
  const col2 = p.c('color2', shadowOf(col, 0.3))
  const r = f.r
  const side = f.view === 'side'
  const back = f.view === 'back'
  const lw = Math.max(P.lw, r * 0.03)
  const paint = fabricPaint(c, p.s('pattern'), col, p.c('patternColor', '#f5f2eb'), r * 0.8, id)
  const arc = (drop: number, w = f.chest * 0.75) => (side ? `M${fx(f.cx - r * 0.8)} ${fx(f.y)}Q${fx(f.cx + f.facing * r * 0.6)} ${fx(f.y + drop * 0.8)} ${fx(f.cx + f.facing * r * 1.3)} ${fx(f.y + drop * 0.35)}` : `M${fx(f.cx - w)} ${fx(f.y)}Q${fx(f.cx)} ${fx(f.y + drop * 2)} ${fx(f.cx + w)} ${fx(f.y)}`)
  /** A metal chain along `d`: dark underside, metal body, then link glints. */
  const chain = (d: string, w: number) => {
    // Alternating links: flat ones (a dark hole in the middle) and edge-on ones (bright).
    let s = P.line(d, shadowOf(col, 0.45), w * 1.3)
    s += P.line(d, col, w)
    if (t > 0) {
      s += P.line(d, shadowOf(col, 0.4), w * 0.4, { dash: `${fx(w * 0.7)} ${fx(w * 1.1)}`, cap: 'butt' })
      s += `<g transform="translate(${fx(L[0] * w * 0.18)} ${fx(L[1] * w * 0.18)})">${P.line(d, highlightOf(col, 0.65), w * 0.32, { dash: `0 ${fx(w * 1.8)}` })}</g>`
    }
    return s
  }
  switch (id) {
    case 'chain': {
      if (back) return ''
      const d = arc(f.drop * 0.35, r * 1.35)
      let out = castShadow(c, side ? '' : brush([[f.cx - r * 1.3, f.y + r * 0.05], [f.cx, f.y + f.drop * 0.38 + r * 0.08], [f.cx + r * 1.3, f.y + r * 0.05]], r * 0.1, r * 0.1), 0.18)
      out += chain(d, r * 0.1)
      if (t === 2 && !side) out += glint(c, f.cx + L[0] * r * 0.5, f.y + f.drop * 0.34, r * 0.12, 0.9)
      return out
    }
    case 'pendant': {
      if (back) return P.line(arc(-r * 0.1, r * 1.1), col, r * 0.06)
      const py = f.y + f.drop * 0.62
      const px = side ? f.cx + f.facing * r * 0.9 : f.cx
      const shape = p.s('shape') || 'gem'
      const s = r * 0.32
      let out = chain(arc(f.drop * 0.3, r * 1.25), r * 0.06)
      // Bail ring.
      out += P.line(circle(px, py - s * 1.25, s * 0.22), shadowOf(col, 0.35), r * 0.05) + P.line(circle(px, py - s * 1.25, s * 0.22), col, r * 0.03)
      if (shape === 'gem') {
        out += castShadow(c, poly([[px + s * 0.1, py - s * 1.05], [px + s * 0.95, py - s * 0.05], [px + s * 0.1, py + s * 1.3], [px - s * 0.7, py - s * 0.05]]), 0.2)
        out += metal(c, poly([[px, py - s * 1.3], [px + s * 0.9, py - s * 0.22], [px, py + s * 1.22], [px - s * 0.9, py - s * 0.22]]), col, { spec: 0 })
        out += gem(c, px, py - s * 0.05, s * 0.72, col2, { cut: 'drop', ry: s * 0.85 })
      } else {
        const d = shape === 'heart' ? heart(px, py, s) : shape === 'star' ? star(px, py, s * 1.3, s * 0.6) : shape === 'moon' ? `M${fx(px + s * 0.2)} ${fx(py - s)}A${fx(s)} ${fx(s)} 0 1 0 ${fx(px + s * 0.2)} ${fx(py + s)}A${fx(s * 0.78)} ${fx(s * 0.85)} 0 1 1 ${fx(px + s * 0.2)} ${fx(py - s)}Z` : circle(px, py - s * 0.6, s * 0.45) + roundRect(px - s * 0.12, py - s * 0.2, s * 0.24, s * 1.3, 1) + rect(px, py + s * 0.6, s * 0.3, s * 0.14) + rect(px, py + s * 0.88, s * 0.24, s * 0.14)
        out += castShadow(c, shape === 'heart' ? heart(px + s * 0.15, py + s * 0.18, s) : circle(px + s * 0.15, py + s * 0.18, s * 0.9), 0.18)
        out += metal(c, d, col, { outline: 0.6, attrs: shape === 'key' ? { 'fill-rule': 'evenodd' } : undefined })
        if (shape === 'key' && t > 0) out += P.flat(circle(px, py - s * 0.6, s * 0.2), shadowOf(col, 0.5))
        if (shape === 'heart' && t > 0) out += gem(c, px, py - s * 0.05, s * 0.3, col2, { cut: 'round', sparkle: false })
      }
      return out
    }
    case 'pearls': {
      if (back) return ''
      let out = ''
      const n = 12
      const pts: P[] = []
      for (let i = 0; i <= n; i++) {
        const u = i / n
        const x = side ? lerp(f.cx - r * 0.8, f.cx + f.facing * r * 1.3, u) : lerp(f.cx - r * 1.45, f.cx + r * 1.45, u)
        pts.push([x, f.y + Math.sin(Math.PI * u) * f.drop * 0.45])
      }
      if (t > 0) out += castShadow(c, pts.map(([x, y]) => circle(x + r * 0.03, y + r * 0.06, r * 0.11)).join(''), 0.16)
      for (const [x, y] of pts) out += t > 0 ? sphere(c, x, y, r * 0.11, col, 'pearl', { outline: 0.4 }) : P.shape(circle(x, y, r * 0.11), col, { outline: 0.4 })
      return out
    }
    case 'choker': {
      const bandD = roundRect(f.cx - r * 1.02, f.y - r * 0.55, r * 2.04, r * 0.32, r * 0.12)
      let out = P.shape(bandD, col, { material: 'cloth' })
      if (t > 0) out += P.line(`M${fx(f.cx - r * 0.95)} ${fx(f.y - r * 0.47)}H${fx(f.cx + r * 0.95)}`, highlightOf(col, 0.45), r * 0.04, { opacity: t === 2 ? 0.6 : 0.4 })
      if (!back) {
        const gx = side ? f.cx + f.facing * r * 0.9 : f.cx
        out += t > 0 ? metal(c, circle(gx, f.y - r * 0.28, r * 0.16), '#d9d9e0', { outline: 0.4, spec: 0 }) + gem(c, gx, f.y - r * 0.28, r * 0.11, highlightOf(col, 0.4)) : P.shape(circle(gx, f.y - r * 0.28, r * 0.12), highlightOf(col, 0.4), { outline: 0.4 })
      }
      return out
    }
    case 'bowtie':
    case 'collar': {
      if (id === 'collar') {
        const band = roundRect(f.cx - r * 1.08, f.y - r * 0.42, r * 2.16, r * 0.36, r * 0.15)
        let out = P.shape(band, col, { material: 'leather' })
        if (t > 0) out += stitch(c, `M${fx(f.cx - r * 1.0)} ${fx(f.y - r * 0.35)}H${fx(f.cx + r * 1.0)}M${fx(f.cx - r * 1.0)} ${fx(f.y - r * 0.13)}H${fx(f.cx + r * 1.0)}`, col, r * 0.025, true)
        if (p.b('spikes')) for (const k of [-0.7, -0.25, 0.25, 0.7]) out += metal(c, poly([[f.cx + k * r - r * 0.12, f.y - r * 0.08], [f.cx + k * r, f.y + r * 0.28], [f.cx + k * r + r * 0.12, f.y - r * 0.08]]), '#d9d9e0', { outline: 0.6, spec: 0.5 })
        if (p.b('bell') && !back) {
          const bx = side ? f.cx + f.facing * r * 0.9 : f.cx
          // D-ring, then a gold bell with its slit and clapper.
          out += P.line(`M${fx(bx - r * 0.12)} ${fx(f.y - r * 0.08)}Q${fx(bx)} ${fx(f.y + r * 0.08)} ${fx(bx + r * 0.12)} ${fx(f.y - r * 0.08)}`, '#c9ccd3', r * 0.05)
          out += t > 0 ? sphere(c, bx, f.y + r * 0.22, r * 0.26, '#f2d14a', 'metal', { outline: 1 }) : P.shape(circle(bx, f.y + r * 0.2, r * 0.26), '#f2d14a')
          out += P.flat(roundRect(bx - r * 0.2, f.y + r * 0.2, r * 0.4, r * 0.05, r * 0.025) + circle(bx, f.y + r * 0.34, r * 0.06), '#7a5a00')
          if (t === 2) out += glint(c, bx + L[0] * r * 0.12, f.y + r * 0.22 + L[1] * r * 0.12, r * 0.12, 0.95)
        }
        return out
      }
      if (back) return ''
      const bx = side ? f.cx + f.facing * r * 0.9 : f.cx
      const by = f.y + r * 0.05
      const s = r * 0.62
      const wingsD = side
        ? poly([[bx, by - s * 0.3], [bx + f.facing * s * 0.5, by - s * 0.6], [bx + f.facing * s * 0.5, by + s * 0.6], [bx, by + s * 0.3]])
        : smooth([[bx, by - s * 0.08], [bx - s * 0.55, by - s * 0.5], [bx - s * 1.0, by - s * 0.55, 0.4], [bx - s * 1.08, by + s * 0.1], [bx - s * 1.0, by + s * 0.55, 0.4], [bx - s * 0.55, by + s * 0.45], [bx, by + s * 0.08]]) + smooth([[bx, by - s * 0.08], [bx + s * 0.55, by - s * 0.5], [bx + s * 1.0, by - s * 0.55, 0.4], [bx + s * 1.08, by + s * 0.1], [bx + s * 1.0, by + s * 0.55, 0.4], [bx + s * 0.55, by + s * 0.45], [bx, by + s * 0.08]])
      let out = castShadow(c, side ? '' : ellipse(bx, by + s * 0.35, s * 0.9, s * 0.25), 0.18)
      out += P.shape(wingsD, col, { paint })
      if (t > 0 && !side) {
        // Pleats pinched toward the knot, and satin sheen.
        let pl = ''
        for (const d of [-1, 1]) pl += `M${fx(bx + d * s * 0.25)} ${fx(by - s * 0.05)}Q${fx(bx + d * s * 0.6)} ${fx(by - s * 0.2)} ${fx(bx + d * s * 0.95)} ${fx(by - s * 0.25)}M${fx(bx + d * s * 0.25)} ${fx(by + s * 0.08)}Q${fx(bx + d * s * 0.6)} ${fx(by + s * 0.2)} ${fx(bx + d * s * 0.95)} ${fx(by + s * 0.3)}`
        out += folds(c, pl, col, lw * 0.6)
      }
      out += P.shape(roundRect(bx - s * 0.2, by - s * 0.26, s * 0.4, s * 0.52, s * 0.12), shadowOf(col, 0.12), { paint })
      if (t > 0) out += P.line(`M${fx(bx - s * 0.08)} ${fx(by - s * 0.2)}V${fx(by + s * 0.2)}`, shadowOf(col, 0.3), lw * 0.5, { opacity: 0.7 })
      return out
    }
    case 'tie': {
      if (back || side) return side ? P.shape(roundRect(f.cx + f.facing * r * 0.8, f.y, r * 0.3, f.drop * 1.9, 2), col, { paint }) : ''
      const len = f.drop * 2.2
      const knot = poly([[f.cx - r * 0.28, f.y - r * 0.05], [f.cx + r * 0.28, f.y - r * 0.05], [f.cx + r * 0.16, f.y + r * 0.35], [f.cx - r * 0.16, f.y + r * 0.35]])
      const blade = smooth([[f.cx - r * 0.18, f.y + r * 0.3], [f.cx + r * 0.18, f.y + r * 0.3], [f.cx + r * 0.36, f.y + len, 0.2], [f.cx, f.y + len + r * 0.35, 0], [f.cx - r * 0.36, f.y + len, 0.2]])
      let out = castShadow(c, smooth([[f.cx - r * 0.12, f.y + r * 0.4], [f.cx + r * 0.3, f.y + r * 0.4], [f.cx + r * 0.46, f.y + len + r * 0.05], [f.cx + r * 0.08, f.y + len + r * 0.42], [f.cx - r * 0.26, f.y + len + r * 0.05]]), 0.2)
      out += P.shape(blade, col, { paint })
      if (t > 0) {
        // Dimple under the knot and a soft centre crease.
        out += P.flat(smooth([[f.cx - r * 0.08, f.y + r * 0.36], [f.cx + r * 0.04, f.y + r * 0.36], [f.cx + r * 0.01, f.y + r * 0.62, 0]]), shadowOf(col, 0.4), 0.6)
        out += folds(c, `M${fx(f.cx + r * 0.02)} ${fx(f.y + r * 0.7)}L${fx(f.cx + r * 0.04)} ${fx(f.y + len)}`, col, lw * 0.5)
        if (P.detail > 1) out += metal(c, roundRect(f.cx - r * 0.34, f.y + len * 0.55, r * 0.68, r * 0.07, r * 0.03), '#d9d9e0', { outline: 0.4, spec: 0.5 })
      }
      out += P.shape(knot, shadowOf(col, 0.1), { paint })
      if (t > 0) out += P.line(`M${fx(f.cx - r * 0.15)} ${fx(f.y + r * 0.05)}L${fx(f.cx - r * 0.02)} ${fx(f.y + r * 0.3)}`, shadowOf(col, 0.3), lw * 0.5, { opacity: 0.7 })
      return out
    }
    case 'scarf':
    case 'neck-bandana': {
      if (id === 'neck-bandana') {
        if (back) return P.shape(roundRect(f.cx - r * 1.2, f.y - r * 0.5, r * 2.4, r * 0.4, 3), col, { paint }) + P.shape(circle(f.cx, f.y - r * 0.3, r * 0.2), shadowOf(col, 0.1), { paint }) + P.shape(smooth([[f.cx - r * 0.1, f.y - r * 0.2], [f.cx - r * 0.3, f.y + r * 0.35, 0], [f.cx, f.y - r * 0.1], [f.cx + r * 0.3, f.y + r * 0.3, 0], [f.cx + r * 0.1, f.y - r * 0.2]]), col, { paint })
        const tri = side ? poly([[f.cx - r * 0.9, f.y - r * 0.4], [f.cx + f.facing * r * 1.3, f.y - r * 0.2], [f.cx + f.facing * r * 0.9, f.y + f.drop * 0.8]]) : smooth([[f.cx - r * 1.35, f.y - r * 0.35, 0.3], [f.cx, f.y - r * 0.2], [f.cx + r * 1.35, f.y - r * 0.35, 0.3], [f.cx + r * 0.5, f.y + f.drop * 0.5], [f.cx, f.y + f.drop * 0.95, 0.2], [f.cx - r * 0.5, f.y + f.drop * 0.5]])
        let out = castShadow(c, side ? '' : poly([[f.cx - r * 1.1, f.y], [f.cx + r * 1.2, f.y], [f.cx + r * 0.1, f.y + f.drop * 1.05]]), 0.18) + P.shape(tri, col, { paint })
        if (t > 0 && !side) out += folds(c, `M${fx(f.cx - r * 1.1)} ${fx(f.y - r * 0.25)}Q${fx(f.cx - r * 0.5)} ${fx(f.y + f.drop * 0.3)} ${fx(f.cx - r * 0.1)} ${fx(f.y + f.drop * 0.8)}M${fx(f.cx + r * 1.1)} ${fx(f.y - r * 0.25)}Q${fx(f.cx + r * 0.5)} ${fx(f.y + f.drop * 0.3)} ${fx(f.cx + r * 0.1)} ${fx(f.y + f.drop * 0.8)}M${fx(f.cx - r * 0.5)} ${fx(f.y - r * 0.15)}Q${fx(f.cx)} ${fx(f.y + f.drop * 0.2)} ${fx(f.cx + r * 0.5)} ${fx(f.y - r * 0.15)}`, col, lw * 0.6)
        return out
      }
      const wrap = roundRect(f.cx - r * 1.35, f.y - r * 0.75, r * 2.7, r * 0.85, r * 0.4)
      const tail = side ? '' : smooth([[f.cx + r * 0.4, f.y], [f.cx + r * 1.0, f.y], [f.cx + r * 1.05, f.y + f.drop * 1.9, 0.5], [f.cx + r * 0.45, f.y + f.drop * 1.9, 0.5]])
      let out = castShadow(c, side ? '' : roundRect(f.cx - r * 1.25, f.y - r * 0.05, r * 2.5, r * 0.3, r * 0.15), 0.2)
      out += P.shape(tail, col, { paint })
      if (tail && t > 0) {
        // Knit ribs down the hanging end.
        out += P.line([0.55, 0.7, 0.85].map((k) => `M${fx(f.cx + r * (k + 0.02))} ${fx(f.y + r * 0.1)}V${fx(f.y + f.drop * 1.72)}`).join(''), shadowOf(col, 0.22), lw * 0.5, { opacity: 0.55 })
      }
      out += P.shape(wrap, col, { paint })
      if (t > 0) {
        // Where the wrap folds over itself.
        out += folds(c, `M${fx(f.cx - r * 1.2)} ${fx(f.y - r * 0.3)}Q${fx(f.cx)} ${fx(f.y - r * 0.12)} ${fx(f.cx + r * 1.2)} ${fx(f.y - r * 0.35)}`, col, lw * 0.7)
        if (P.detail > 1 && !paint) out += P.line([-1.1, -0.8, -0.5, -0.2, 0.1, 0.4, 0.7, 1.0].map((k) => `M${fx(f.cx + k * r)} ${fx(f.y - r * 0.68)}v${fx(r * 0.3)}M${fx(f.cx + (k + 0.1) * r)} ${fx(f.y - r * 0.25)}v${fx(r * 0.25)}`).join(''), shadowOf(col, 0.2), lw * 0.4, { opacity: 0.45 })
      }
      if (tail) {
        // Fringe.
        const fr = [0.47, 0.6, 0.73, 0.86, 0.99].map((k) => `M${fx(f.cx + r * k)} ${fx(f.y + f.drop * 1.9)}v${fx(r * 0.24)}`).join('')
        out += P.line(fr, shadowOf(col, 0.15), lw * 0.9) + (t > 0 ? P.line(fr, highlightOf(col, 0.2), lw * 0.35, { opacity: 0.7 }) : '')
      }
      return out
    }
    case 'medal': {
      if (back) return ''
      const my = f.y + f.drop * 1.1
      const mx = side ? f.cx + f.facing * r * 0.9 : f.cx
      const ribbon = poly([[mx - r * 0.9, f.y - r * 0.3], [mx - r * 0.5, f.y - r * 0.3], [mx, my - r * 0.3], [mx + r * 0.5, f.y - r * 0.3], [mx + r * 0.9, f.y - r * 0.3], [mx + r * 0.15, my - r * 0.1], [mx - r * 0.15, my - r * 0.1]])
      let out = P.shape(ribbon, col2)
      if (t > 0 && !side) out += P.line(`M${fx(mx - r * 0.7)} ${fx(f.y - r * 0.28)}L${fx(mx - r * 0.02)} ${fx(my - r * 0.18)}M${fx(mx + r * 0.7)} ${fx(f.y - r * 0.28)}L${fx(mx + r * 0.02)} ${fx(my - r * 0.18)}`, '#f5f2eb', r * 0.08, { opacity: 0.85 })
      out += castShadow(c, circle(mx + r * 0.08, my + r * 0.3, r * 0.42), 0.2)
      out += metal(c, circle(mx, my + r * 0.2, r * 0.42), col, { spec: 0.6 })
      if (t > 0) {
        out += P.line(circle(mx, my + r * 0.2, r * 0.33), shadowOf(col, 0.35), r * 0.03, { opacity: 0.8 })
        out += metal(c, star(mx, my + r * 0.2, r * 0.25, r * 0.11), highlightOf(col, 0.08), { outline: 0.4, spec: 0 })
      } else out += P.flat(star(mx, my + r * 0.2, r * 0.25, r * 0.11), shadowOf(col, 0.35))
      return out
    }
    case 'lei': {
      let out = ''
      const n = 10
      for (let i = 0; i <= n; i++) {
        const u = i / n
        const x = side ? lerp(f.cx - r, f.cx + f.facing * r * 1.4, u) : lerp(f.cx - r * 1.55, f.cx + r * 1.55, u)
        const y = f.y + Math.sin(Math.PI * u) * f.drop * (back ? 0.1 : 0.55)
        if (t > 0 && i % 2 === 0 && !back) out += leaf(c, x, y, r * 0.2, Math.PI / 2 + (u - 0.5) * 1.5 + (i % 4 ? 0.6 : -0.6), '#43a047', { outline: 0.3 })
        out += flower(c, x, y, r * 0.2, i % 2 ? p.c('color2', '#fdd835') : col, '#fff3c4', { rot: i * 0.7, outline: 0.4 })
      }
      return out
    }
    case 'lanyard': {
      if (back) return P.line(arc(-r * 0.1, r * 1.1), col, r * 0.12)
      const by = f.y + f.drop * 1.4
      const strap = side ? arc(f.drop * 1.4) : `M${fx(f.cx - r * 1.1)} ${fx(f.y)}L${fx(f.cx - r * 0.1)} ${fx(by)}M${fx(f.cx + r * 1.1)} ${fx(f.y)}L${fx(f.cx + r * 0.1)} ${fx(by)}`
      let out = P.line(strap, shadowOf(col, 0.25), r * 0.17) + P.line(strap, col, r * 0.14)
      if (t > 0) out += P.line(strap, '#ffffff', r * 0.04, { dash: `${fx(r * 0.2)} ${fx(r * 0.25)}`, opacity: 0.6 })
      if (side) return out
      const card = roundRect(f.cx - r * 0.4, by + r * 0.08, r * 0.8, r * 1.0, r * 0.06)
      out += metal(c, roundRect(f.cx - r * 0.08, by - r * 0.08, r * 0.16, r * 0.2, r * 0.04), '#c9ccd3', { outline: 0.5, spec: 0.5 })
      out += castShadow(c, roundRect(f.cx - r * 0.34, by + r * 0.16, r * 0.8, r * 1.0, r * 0.06), 0.2)
      out += P.shape(card, col2, { material: 'plastic' })
      out += P.flat(roundRect(f.cx - r * 0.3, by + r * 0.2, r * 0.6, r * 0.18, r * 0.03), col)
      if (t > 0) {
        out += P.flat(roundRect(f.cx - r * 0.3, by + r * 0.46, r * 0.26, r * 0.32, r * 0.04), shadowOf(col2, 0.3))
        out += P.line(`M${fx(f.cx + r * 0.02)} ${fx(by + r * 0.52)}h${fx(r * 0.26)}M${fx(f.cx + r * 0.02)} ${fx(by + r * 0.64)}h${fx(r * 0.2)}M${fx(f.cx + r * 0.02)} ${fx(by + r * 0.76)}h${fx(r * 0.24)}`, shadowOf(col2, 0.45), r * 0.04)
        out += spec(c, f.cx - r * 0.18, by + r * 0.3, r * 0.14, r * 0.02, 0.5, -60)
      }
      return out
    }
  }
  return ''
}

/* ---- Back ---------------------------------------------------------------------- */

export interface WingArt {
  /** One wing, in its bone's space, extending toward +x (the caller mirrors). */
  wing: string
  back?: string
}

/**
 * Wings are drawn per side on the wingL / wingR bones (they flap). `mirrored`: the caller
 * will mirror this art with scale(-1 1), so it is lit with the light mirrored too (the
 * light then lands on the correct side after the flip).
 */
export function drawWing(c: Ctx, id: string, p: Reader, f: BackFrame, mirrored = false): string {
  const wing = premiumArt('wing', id)
  if (!wing) return ''
  if (!mirrored) return wing(c, id, p, f.span)
  const st = c.paint.style
  const L = st.light
  st.light = [-L[0], L[1]]
  try {
    return wing(c, id, p, f.span)
  } finally {
    st.light = L
  }
}

/** A pair of leather straps (backpacks, jetpacks): stitching, and buckles in fine detail. */
export function strapPair(c: Ctx, x0: number, x1: number, y0: number, h: number, sw: number, strapCol: string): string {
  const P = c.paint
  const t = tier(c)
  let s = ''
  for (const x of [x0, x1]) {
    const d = roundRect(x - sw / 2, y0, sw, h, sw / 2)
    s += P.shape(d, strapCol, { material: 'leather' })
    if (t > 0) s += stitch(c, `M${fx(x - sw * 0.3)} ${fx(y0 + sw * 0.3)}V${fx(y0 + h - sw * 0.3)}M${fx(x + sw * 0.3)} ${fx(y0 + sw * 0.3)}V${fx(y0 + h - sw * 0.3)}`, strapCol, sw * 0.07, true)
    if (t > 0 && P.detail > 1) s += buckle(c, x, y0 + h * 0.62, sw * 1.25, sw * 0.8, '#c9ccd3', strapCol)
  }
  return s
}

export function drawBackAcc(c: Ctx, id: string, p: Reader, f: BackFrame): { behind: string; front: string } {
  const premium = premiumArt('back', id)
  if (premium) return premium(c, id, p, f)
  const P = c.paint
  const t = tier(c)
  const col = p.c('color', '#fb8c00')
  const col2 = p.c('color2', shadowOf(col, 0.3))
  const side = f.view === 'side'
  const back = f.view === 'back'
  const w = f.span
  const Ln = f.len
  const lw = Math.max(P.lw, w * 0.012)
  switch (id) {
    case 'backpack': {
      const bag = roundRect(-w * 0.62, -Ln * 0.1, w * 1.24, Ln * 0.75, w * 0.25)
      if (back) {
        let front = P.shape(bag, col, { material: 'cloth' })
        if (t > 0) front += stitch(c, roundRect(-w * 0.56, -Ln * 0.05, w * 1.12, Ln * 0.65, w * 0.21), col, w * 0.012, true)
        // Top flap, zip line, front pocket with its own zip, haul loop.
        const flap = smooth([[-w * 0.6, -Ln * 0.02, 0.4], [-w * 0.55, -Ln * 0.1], [w * 0.55, -Ln * 0.1], [w * 0.6, -Ln * 0.02, 0.4], [w * 0.45, Ln * 0.12], [0, Ln * 0.15], [-w * 0.45, Ln * 0.12]])
        front += P.shape(flap, shadowOf(col, 0.06), { material: 'cloth' })
        const pocket = roundRect(-w * 0.45, Ln * 0.3, w * 0.9, Ln * 0.28, w * 0.1)
        front += castShadow(c, roundRect(-w * 0.43, Ln * 0.33, w * 0.9, Ln * 0.28, w * 0.1), 0.2) + P.shape(pocket, shadowOf(col, 0.08), { material: 'cloth' })
        if (t > 0) {
          front += P.line(`M${fx(-w * 0.38)} ${fx(Ln * 0.36)}H${fx(w * 0.38)}`, shadowOf(col, 0.5), w * 0.03) + P.line(`M${fx(-w * 0.38)} ${fx(Ln * 0.36)}H${fx(w * 0.38)}`, '#d9d9e0', w * 0.012, { dash: `${fx(w * 0.012)} ${fx(w * 0.012)}` })
          front += metal(c, roundRect(w * 0.22, Ln * 0.345, w * 0.05, w * 0.1, w * 0.015), '#d9d9e0', { outline: 0.4, spec: 0 })
          front += P.line(`M${fx(-w * 0.12)} ${fx(-Ln * 0.1)}Q0 ${fx(-Ln * 0.2)} ${fx(w * 0.12)} ${fx(-Ln * 0.1)}`, col2, w * 0.05)
        }
        return { behind: '', front }
      }
      if (side) {
        const prof = roundRect(-w * 0.55 - Ln * 0.1 * f.facing, -Ln * 0.1, w * 0.7, Ln * 0.72, w * 0.2)
        let behind = P.shape(prof, col, { material: 'cloth' })
        if (t > 0) behind += stitch(c, roundRect(-w * 0.5 - Ln * 0.1 * f.facing, -Ln * 0.05, w * 0.6, Ln * 0.62, w * 0.16), col, w * 0.012, true) + P.shape(roundRect(-w * 0.62 - Ln * 0.1 * f.facing, Ln * 0.25, w * 0.3, Ln * 0.3, w * 0.08), shadowOf(col, 0.08))
        return { behind, front: '' }
      }
      let behind = P.shape(bag, col, { material: 'cloth' })
      if (t > 0) behind += P.shape(smooth([[-w * 0.6, -Ln * 0.02, 0.4], [-w * 0.55, -Ln * 0.1], [w * 0.55, -Ln * 0.1], [w * 0.6, -Ln * 0.02, 0.4], [w * 0.45, Ln * 0.08], [-w * 0.45, Ln * 0.08]]), shadowOf(col, 0.06))
      const front = strapPair(c, -w * 0.67, w * 0.67, -Ln * 0.15, Ln * 0.6, w * 0.16, col2)
      return { behind, front }
    }
    case 'cape': {
      const len = f.hang * lerp(0.55, 1.15, p.has('length') ? p.n('length') : 0.6)
      const lining = col2
      if (side) {
        const k = f.facing
        const cape = smooth([[-w * 0.05, 0, 0.5], [-w * 0.35 * k, len * 0.45], [-w * 0.6 * k, len, 0.4], [-w * 0.3 * k, len * 1.03], [w * 0.2 * k, len * 1.02, 0.4], [w * 0.15 * k, len * 0.3]])
        let behind = P.shape(cape, col)
        if (t > 0) {
          behind += folds(c, `M${fx(-w * 0.05 * k)} ${fx(len * 0.15)}Q${fx(-w * 0.3 * k)} ${fx(len * 0.6)} ${fx(-w * 0.35 * k)} ${fx(len)}M${fx(w * 0.08 * k)} ${fx(len * 0.3)}Q${fx(-w * 0.05 * k)} ${fx(len * 0.7)} ${fx(-w * 0.02 * k)} ${fx(len)}`, col, lw * 0.9)
          // The lining shows along the inner edge.
          behind += P.line(`M${fx(w * 0.15 * k)} ${fx(len * 0.3)}Q${fx(w * 0.22 * k)} ${fx(len * 0.7)} ${fx(w * 0.2 * k)} ${fx(len * 1.0)}`, lining, lw * 1.6, { opacity: 0.9 })
        }
        return { behind, front: '' }
      }
      const cape = smooth([[-w * 0.85, 0, 0.4], [w * 0.85, 0, 0.4], [w * 1.25, len * 0.6], [w * 1.35, len, 0.4], [w * 0.7, len * 1.02], [0, len * 1.05], [-w * 0.7, len * 1.02], [-w * 1.35, len, 0.4], [-w * 1.25, len * 0.6]])
      const foldD = (k: number) => [-0.85, -0.45, 0, 0.45, 0.85].map((u) => `M${fx(u * w * 0.55)} ${fx(len * 0.12)}Q${fx(u * w * 0.95 + (u >= 0 ? 1 : -1) * w * 0.05)} ${fx(len * 0.55)} ${fx(u * w * 1.15 * k)} ${fx(len * 0.98)}`).join('')
      if (back) {
        let front = P.shape(cape, col)
        if (t > 0) {
          front += folds(c, foldD(1), col, lw * 1.1)
          // Shoulders catch the light; the hem curls under.
          front += P.flat(smooth([[-w * 0.8, len * 0.02], [w * 0.8, len * 0.02], [w * 0.7, len * 0.12], [-w * 0.7, len * 0.12]]), highlightOf(col, 0.2), 0.45)
          front += P.line(`M${fx(-w * 1.3)} ${fx(len * 0.98)}Q${fx(-w * 0.65)} ${fx(len * 1.04)} 0 ${fx(len * 1.02)}Q${fx(w * 0.65)} ${fx(len * 1.04)} ${fx(w * 1.3)} ${fx(len * 0.98)}`, lining, lw * 1.4, { opacity: 0.9 })
        }
        return { behind: '', front }
      }
      // From the front we see the inside of the cape: lining, framed by the outer cloth
      // curling around its edges, darkest up under the shoulders.
      let behind = P.shape(cape, col)
      const inner = smooth([[-w * 0.8, len * 0.08], [w * 0.8, len * 0.08], [w * 1.18, len * 0.6], [w * 1.22, len * 0.96], [0, len * 0.99], [-w * 1.22, len * 0.96], [-w * 1.18, len * 0.6]])
      if (t > 0) {
        behind += `<path d="${inner}" fill="${P.linear(`capel${lining.replace('#', '')}`, [[0, shadowOf(lining, 0.45)], [0.35, shadowOf(lining, 0.15)], [1, lining]], [0.5, 0], [0.5, 1])}"/>`
        behind += folds(c, foldD(1.02), lining, lw * 1.1)
      } else behind += P.flat(inner, lining)
      const clasp = (x: number) => (t > 0 ? metal(c, circle(x, Ln * 0.02, w * 0.11), '#f2d14a', { spec: 0.6 }) + gem(c, x, Ln * 0.02, w * 0.06, lining === '#f2d14a' ? '#c62828' : col, { sparkle: false }) : P.shape(circle(x, Ln * 0.02, w * 0.1), '#f2d14a'))
      let front = clasp(-w * 0.55) + clasp(w * 0.55)
      if (t > 0) front += P.line(`M${fx(-w * 0.45)} ${fx(Ln * 0.03)}Q0 ${fx(Ln * 0.12)} ${fx(w * 0.45)} ${fx(Ln * 0.03)}`, shadowOf('#f2d14a', 0.3), w * 0.03) + P.line(`M${fx(-w * 0.45)} ${fx(Ln * 0.03)}Q0 ${fx(Ln * 0.12)} ${fx(w * 0.45)} ${fx(Ln * 0.03)}`, '#f2d14a', w * 0.018, { dash: `${fx(w * 0.03)} ${fx(w * 0.02)}` })
      return { behind, front }
    }
    case 'quiver': {
      const tube2 = roundRect(-w * 0.25, -Ln * 0.25, w * 0.5, Ln * 0.8, w * 0.1)
      let arrows = ''
      for (const [x, a] of [[-w * 0.12, -8], [w * 0.02, 4], [w * 0.14, 14]] as [number, number][]) {
        const top = -Ln * 0.58
        arrows += `<g transform="rotate(${a} ${fx(x)} ${fx(-Ln * 0.25)})">`
        arrows += P.line(`M${fx(x)} ${fx(-Ln * 0.25)}V${fx(top + w * 0.1)}`, '#a1887f', w * 0.03)
        arrows += P.shape(smooth([[x, top + w * 0.05], [x - w * 0.09, top + w * 0.2], [x - w * 0.08, top - w * 0.1, 0], [x, top - w * 0.02]]) + smooth([[x, top + w * 0.05], [x + w * 0.09, top + w * 0.2], [x + w * 0.08, top - w * 0.1, 0], [x, top - w * 0.02]]), col2, { material: 'feathers', outline: 0.6 })
        arrows += '</g>'
      }
      let body = P.shape(tube2, col, { material: 'leather' })
      if (t > 0) {
        body += stitch(c, `M0 ${fx(-Ln * 0.22)}V${fx(Ln * 0.52)}`, col, w * 0.012, true)
        body += metal(c, roundRect(-w * 0.26, -Ln * 0.22, w * 0.52, Ln * 0.045, w * 0.02) + roundRect(-w * 0.26, Ln * 0.44, w * 0.52, Ln * 0.045, w * 0.02), '#c79212', { spec: 0.5 })
        body += grain(c, [-w * 0.15, -Ln * 0.15], [-w * 0.15, Ln * 0.45], w * 0.2, col)
      }
      const g0 = `<g transform="rotate(-25)">${arrows}${body}</g>`
      if (back) return { behind: '', front: g0 }
      const strap = side ? '' : `M${fx(-w * 0.6)} ${fx(-Ln * 0.1)}L${fx(w * 0.5)} ${fx(Ln * 0.55)}`
      return { behind: g0, front: strap ? P.line(strap, P.ink(col), w * 0.12 + P.lw) + P.line(strap, shadowOf(col, 0.3), w * 0.12) + stitch(c, strap, shadowOf(col, 0.3), w * 0.012, true) : '' }
    }
    case 'guitar-back':
    case 'sword-back': {
      let g0: string
      if (id === 'sword-back') {
        const sheath = smooth([[-w * 0.1, -Ln * 0.2, 0.3], [w * 0.1, -Ln * 0.2, 0.3], [w * 0.08, Ln * 0.72], [0, Ln * 0.8, 0], [-w * 0.08, Ln * 0.72]])
        let s = P.shape(sheath, col, { material: 'leather' })
        if (t > 0) {
          s += metal(c, smooth([[-w * 0.08, Ln * 0.62], [w * 0.08, Ln * 0.62], [w * 0.075, Ln * 0.72], [0, Ln * 0.8, 0], [-w * 0.075, Ln * 0.72]]), col2, { spec: 0.4 })
          s += metal(c, roundRect(-w * 0.12, -Ln * 0.2, w * 0.24, Ln * 0.06, w * 0.02), col2, { spec: 0.4 })
          s += stitch(c, `M0 ${fx(-Ln * 0.12)}V${fx(Ln * 0.6)}`, col, w * 0.012, true)
        }
        // Grip with a spiral wrap, crossguard and pommel.
        const grip = roundRect(-w * 0.06, -Ln * 0.5, w * 0.12, Ln * 0.26, w * 0.04)
        s += P.shape(grip, '#4e342e', { material: 'leather' })
        if (t > 0) s += P.line([0, 1, 2, 3, 4].map((i) => `M${fx(-w * 0.06)} ${fx(-Ln * (0.48 - i * 0.05))}L${fx(w * 0.06)} ${fx(-Ln * (0.455 - i * 0.05))}`).join(''), '#2e1f1a', w * 0.015)
        s += metal(c, smooth([[-w * 0.3, -Ln * 0.25, 0.4], [0, -Ln * 0.27], [w * 0.3, -Ln * 0.25, 0.4], [w * 0.28, -Ln * 0.2], [0, -Ln * 0.215], [-w * 0.28, -Ln * 0.2]]), col2, { spec: 0.6 })
        s += t > 0 ? sphere(c, 0, -Ln * 0.53, w * 0.07, col2, 'metal', { outline: 0.8 }) : P.shape(circle(0, -Ln * 0.53, w * 0.07), col2)
        g0 = `<g transform="rotate(35)">${s}</g>`
      } else {
        const body = smooth([[0, -Ln * 0.6], [w * 0.15, -Ln * 0.55], [w * 0.2, -Ln * 0.1], [w * 0.5, Ln * 0.2], [w * 0.4, Ln * 0.6], [0, Ln * 0.7], [-w * 0.4, Ln * 0.6], [-w * 0.5, Ln * 0.2], [-w * 0.2, -Ln * 0.1], [-w * 0.15, -Ln * 0.55]])
        let s = P.shape(body, col, { material: 'leather' })
        if (t > 0) {
          s += P.line(smooth([[0, -Ln * 0.56], [w * 0.13, -Ln * 0.52], [w * 0.17, -Ln * 0.08], [w * 0.45, Ln * 0.2], [w * 0.36, Ln * 0.57], [0, Ln * 0.66], [-w * 0.36, Ln * 0.57], [-w * 0.45, Ln * 0.2], [-w * 0.17, -Ln * 0.08], [-w * 0.13, -Ln * 0.52]]), '#c9ccd3', w * 0.018, { dash: `${fx(w * 0.02)} ${fx(w * 0.015)}`, opacity: 0.8 })
          s += P.line(`M${fx(-w * 0.15)} ${fx(Ln * 0.12)}Q0 ${fx(Ln * 0.02)} ${fx(w * 0.15)} ${fx(Ln * 0.12)}`, shadowOf(col, 0.5), w * 0.05)
          s += metal(c, roundRect(-w * 0.06, Ln * 0.5, w * 0.12, w * 0.07, w * 0.02) + roundRect(-w * 0.06, -Ln * 0.3, w * 0.12, w * 0.07, w * 0.02), '#c9ccd3', { spec: 0.3 })
          s += litEdge(c, body, highlightOf(col, 0.5), w * 0.02, 0.5)
        }
        g0 = `<g transform="rotate(-30)">${s}</g>`
      }
      if (back) return { behind: '', front: g0 }
      const strap = side ? '' : `M${fx(-w * 0.6)} ${fx(-Ln * 0.05)}L${fx(w * 0.55)} ${fx(Ln * 0.6)}`
      const strapCol = id === 'sword-back' ? col : shadowOf(col, 0.1)
      return { behind: g0, front: strap ? P.line(strap, P.ink(strapCol), w * 0.1 + P.lw) + P.line(strap, shadowOf(strapCol, 0.35), w * 0.1) + stitch(c, strap, shadowOf(strapCol, 0.35), w * 0.01, true) : '' }
    }
    case 'shell-pack': {
      const shell = smooth([[-w * 0.8, Ln * 0.6], [-w * 0.9, 0], [0, -Ln * 0.25], [w * 0.9, 0], [w * 0.8, Ln * 0.6], [0, Ln * 0.72]])
      if (!back) return { behind: P.shape(shell, col, { material: 'chitin' }) + (t > 0 && !side ? P.flat(smooth([[-w * 0.85, Ln * 0.3], [0, -Ln * 0.22], [w * 0.85, Ln * 0.3], [w * 0.8, Ln * 0.6], [0, Ln * 0.72], [-w * 0.8, Ln * 0.6]]), shadowOf(col, 0.15), 0.35) : ''), front: '' }
      let front = P.shape(shell, col, { material: 'chitin' })
      // Scutes: a central row of hexagonal plates and costal plates beside them.
      const hex = (cx: number, cy: number, rx: number, ry: number) => poly([[cx - rx * 0.5, cy - ry], [cx + rx * 0.5, cy - ry], [cx + rx, cy], [cx + rx * 0.5, cy + ry], [cx - rx * 0.5, cy + ry], [cx - rx, cy]])
      const plates = [hex(0, -Ln * 0.02, w * 0.28, Ln * 0.16), hex(0, Ln * 0.32, w * 0.28, Ln * 0.16), hex(-w * 0.55, Ln * 0.12, w * 0.24, Ln * 0.17), hex(w * 0.55, Ln * 0.12, w * 0.24, Ln * 0.17), hex(-w * 0.5, Ln * 0.46, w * 0.22, Ln * 0.13), hex(w * 0.5, Ln * 0.46, w * 0.22, Ln * 0.13)]
      if (t > 0) front += plates.map((d) => P.shape(d, col2, { material: 'chitin', outline: 0.7, shade: 0.6 })).join('')
      else front += P.line(plates.join(''), col2, P.lw * 1.2)
      if (t === 2) front += plates.map((d) => litEdge(c, d, highlightOf(col2, 0.5), w * 0.02, 0.6)).join('')
      return { behind: '', front }
    }
  }
  return { behind: '', front: '' }
}


/* ---- Waist and wrists ---------------------------------------------------------- */

export function drawWaistAcc(c: Ctx, id: string, p: Reader, f: WaistFrame): string {
  const P = c.paint
  const t = tier(c)
  const col = p.c('color', '#4e342e')
  const col2 = p.c('color2', '#c79212')
  const side = f.view === 'side'
  const hx = side ? f.depth : f.half
  const bh = f.half * 0.2
  const band = roundRect(-hx - 1, f.y - bh / 2, hx * 2 + 2, bh, 3)
  const bandStitch = () => (t > 0 ? stitch(c, `M${fx(-hx)} ${fx(f.y - bh * 0.3)}H${fx(hx)}M${fx(-hx)} ${fx(f.y + bh * 0.3)}H${fx(hx)}`, col, bh * 0.06, true) : '')
  switch (id) {
    case 'belt': {
      let out = castShadow(c, roundRect(-hx, f.y + bh * 0.35, hx * 2, bh * 0.35, bh * 0.15), 0.18) + P.shape(band, col, { material: 'leather' }) + bandStitch()
      if (f.view === 'front') {
        if (t > 0 && P.detail > 1) out += P.flat([0.3, 0.42, 0.54].map((k) => ellipse(f.half * k, f.y, bh * 0.07, bh * 0.1)).join(''), shadowOf(col, 0.5))
        out += buckle(c, 0, f.y, f.half * 0.34, f.half * 0.3, col2, col)
      }
      return out
    }
    case 'utility': {
      let out = castShadow(c, roundRect(-hx, f.y + bh * 0.35, hx * 2, bh * 0.35, bh * 0.15), 0.18) + P.shape(band, col, { material: 'leather' }) + bandStitch()
      if (f.view !== 'back') {
        for (const k of side ? [0.2] : [-0.7, -0.35, 0.35, 0.7]) {
          const x = k * hx
          const pouch = roundRect(x - f.half * 0.12, f.y - f.half * 0.05, f.half * 0.24, f.half * 0.3, 3)
          out += castShadow(c, roundRect(x - f.half * 0.1, f.y + f.half * 0.2, f.half * 0.22, f.half * 0.06, 2), 0.2) + P.shape(pouch, shadowOf(col, 0.1), { material: 'leather' })
          const flap = smooth([[x - f.half * 0.125, f.y - f.half * 0.06, 0.3], [x + f.half * 0.125, f.y - f.half * 0.06, 0.3], [x + f.half * 0.12, f.y + f.half * 0.07], [x, f.y + f.half * 0.1], [x - f.half * 0.12, f.y + f.half * 0.07]])
          out += P.shape(flap, col, { material: 'leather', outline: 0.8 })
          if (t > 0) out += metal(c, circle(x, f.y + f.half * 0.065, f.half * 0.022), col2, { outline: 0.4, spec: 0 })
        }
      }
      if (f.view === 'front') out += buckle(c, 0, f.y, f.half * 0.3, f.half * 0.26, col2, col)
      return out
    }
    case 'sash': {
      const d = side ? band : poly([[-hx, f.y - f.half * 0.9], [-hx * 0.6, f.y - f.half * 1.1], [hx, f.y + f.half * 0.05], [hx * 0.6, f.y + f.half * 0.25]])
      let out = P.shape(d, col)
      if (t > 0 && !side) out += folds(c, `M${fx(-hx * 0.75)} ${fx(f.y - f.half * 0.95)}L${fx(hx * 0.75)} ${fx(f.y + f.half * 0.1)}`, col, P.lw * 0.8) + litEdge(c, d, highlightOf(col, 0.5), f.half * 0.03, 0.55)
      if (f.view === 'front') {
        // Knot with two hanging tails and a tassel.
        const kx = hx * 0.8
        const ky = f.y + f.half * 0.1
        out += P.shape(smooth([[kx - f.half * 0.05, ky], [kx - f.half * 0.12, ky + f.half * 0.45], [kx - f.half * 0.02, ky + f.half * 0.5, 0], [kx + f.half * 0.02, ky + f.half * 0.05]]) + smooth([[kx + f.half * 0.02, ky], [kx + f.half * 0.14, ky + f.half * 0.4], [kx + f.half * 0.06, ky + f.half * 0.46, 0], [kx - f.half * 0.02, ky + f.half * 0.05]]), shadowOf(col, 0.08))
        out += P.shape(circle(kx, ky, f.half * 0.15), col2)
        if (t > 0) out += P.line(`M${fx(kx - f.half * 0.08)} ${fx(ky - f.half * 0.05)}Q${fx(kx)} ${fx(ky + f.half * 0.03)} ${fx(kx + f.half * 0.09)} ${fx(ky - f.half * 0.04)}`, shadowOf(col2, 0.35), P.lw * 0.6)
      }
      return out
    }
    case 'fannypack': {
      const strapCol = p.c('color2', '#26252c')
      let out = P.shape(roundRect(-hx - 1, f.y - f.half * 0.05, hx * 2 + 2, f.half * 0.1, 2), strapCol, { material: 'rubber' })
      if (f.view === 'back') {
        if (t > 0) out += P.shape(roundRect(-f.half * 0.12, f.y - f.half * 0.07, f.half * 0.24, f.half * 0.14, f.half * 0.03), '#37474f', { material: 'plastic', outline: 0.6 })
        return out
      }
      const bx = side ? f.depth * 0.6 : -f.half * 0.45
      const bw = f.half * (side ? 0.4 : 0.9)
      const bag = roundRect(bx, f.y - f.half * 0.15, bw, f.half * 0.45, f.half * 0.18)
      out += castShadow(c, roundRect(bx + f.half * 0.03, f.y + f.half * 0.2, bw, f.half * 0.12, f.half * 0.06), 0.2) + P.shape(bag, col, { material: 'cloth' })
      if (t > 0 && !side) {
        const zy = f.y - f.half * 0.02
        out += P.line(`M${fx(bx + bw * 0.1)} ${fx(zy)}Q${fx(bx + bw / 2)} ${fx(zy - f.half * 0.04)} ${fx(bx + bw * 0.9)} ${fx(zy)}`, shadowOf(col, 0.45), f.half * 0.025)
        out += P.line(`M${fx(bx + bw * 0.1)} ${fx(zy)}Q${fx(bx + bw / 2)} ${fx(zy - f.half * 0.04)} ${fx(bx + bw * 0.9)} ${fx(zy)}`, '#d9d9e0', f.half * 0.01, { dash: `${fx(f.half * 0.012)} ${fx(f.half * 0.01)}` })
        out += metal(c, roundRect(bx + bw * 0.72, zy - f.half * 0.01, f.half * 0.04, f.half * 0.08, f.half * 0.012), '#d9d9e0', { outline: 0.4, spec: 0 })
        out += P.shape(roundRect(bx + bw * 0.3, f.y + f.half * 0.08, bw * 0.4, f.half * 0.12, f.half * 0.03), strapCol, { material: 'rubber', outline: 0.5 })
        out += stitch(c, roundRect(bx + f.half * 0.04, f.y - f.half * 0.11, bw - f.half * 0.08, f.half * 0.37, f.half * 0.14), col, f.half * 0.012, true)
      }
      return out
    }
  }
  return ''
}

export function drawWristAcc(c: Ctx, id: string, p: Reader, r: number, y: number): string {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', '#26252c')
  const col2 = p.c('color2', '#d9d9e0')
  const band = roundRect(-r * 1.15, y - r * 0.35, r * 2.3, r * 0.7, r * 0.3)
  switch (id) {
    case 'watch': {
      let out = P.shape(band, col, { material: 'leather' })
      if (t > 0) out += stitch(c, `M${fx(-r * 1.05)} ${fx(y - r * 0.22)}H${fx(-r * 0.6)}M${fx(r * 0.6)} ${fx(y - r * 0.22)}H${fx(r * 1.05)}M${fx(-r * 1.05)} ${fx(y + r * 0.22)}H${fx(-r * 0.6)}M${fx(r * 0.6)} ${fx(y + r * 0.22)}H${fx(r * 1.05)}`, col, r * 0.04, true)
      // Case, crown, crystal face and hands.
      if (t > 0) out += metal(c, roundRect(r * 0.55, y - r * 0.12, r * 0.14, r * 0.24, r * 0.05), col2, { outline: 0.4, spec: 0 })
      out += metal(c, roundRect(-r * 0.6, y - r * 0.6, r * 1.2, r * 1.2, r * 0.3), col2, { spec: 0.6 })
      if (t > 0) {
        const face = roundRect(-r * 0.46, y - r * 0.46, r * 0.92, r * 0.92, r * 0.22)
        out += P.shape(face, '#f5f2eb', { outline: 0.4, shade: 0.4, material: 'glass', spec: 0 })
        out += P.line(`M0 ${fx(y)}L${fx(r * 0.2)} ${fx(y - r * 0.24)}M0 ${fx(y)}L${fx(-r * 0.26)} ${fx(y + r * 0.08)}`, '#26252c', r * 0.06)
        out += P.flat([0, 1, 2, 3].map((i) => circle(Math.cos(i * Math.PI / 2) * r * 0.36, y + Math.sin(i * Math.PI / 2) * r * 0.36, r * 0.03)).join(''), '#26252c', 0.8)
        out += spec(c, L[0] * r * 0.2, y + L[1] * r * 0.22, r * 0.22, r * 0.06, 0.75, 30)
      }
      return out
    }
    case 'bracelet':
      return [-0.6, 0, 0.6].map((k) => (t > 0 ? sphere(c, k * r, y, r * 0.3, col, 'gloss', { outline: 0.4 }) : P.shape(circle(k * r, y, r * 0.3), col, { outline: 0.4 }))).join('')
    case 'wristband': {
      const d = roundRect(-r * 1.2, y - r * 0.55, r * 2.4, r * 1.1, r * 0.35)
      let out = P.shape(d, col, { material: 'cloth' })
      if (t > 0 && P.detail > 1) out += P.line([-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9].map((k) => `M${fx(k * r)} ${fx(y - r * 0.45)}v${fx(r * 0.9)}`).join(''), shadowOf(col, 0.2), r * 0.05, { opacity: 0.55 })
      if (t > 0) out += P.flat(roundRect(-r * 1.2, y - r * 0.08, r * 2.4, r * 0.16, r * 0.05), '#f5f2eb', 0.9)
      return out
    }
    case 'bangles': {
      let out = ''
      for (const k of [-0.4, 0, 0.4]) {
        const d = `M${fx(-r * 1.1)} ${fx(y + k * r)}h${fx(r * 2.2)}`
        out += P.line(d, shadowOf(col, 0.4), r * 0.28)
        out += P.line(d, col, r * 0.22)
        if (t > 0) out += P.line(`M${fx(-r * 1.05)} ${fx(y + k * r + r * 0.05)}h${fx(r * 2.1)}`, shadowOf(col, 0.2), r * 0.08, { opacity: 0.8 }) + P.line(`M${fx(-r * 0.9)} ${fx(y + k * r - r * 0.05)}h${fx(r * 1.2)}`, highlightOf(col, 0.7), r * 0.05, { opacity: 0.85 })
      }
      if (t === 2) out += glint(c, -r * 0.35, y - r * 0.45, r * 0.25, 0.9)
      return out
    }
  }
  return ''
}

/* ---- Humanoid tails ------------------------------------------------------------- */

export function drawTailAcc(c: Ctx, id: string, p: Reader, s: number, facing: number, hairColor: string): string {
  const P = c.paint
  const t = tier(c)
  const col = p.c('color', hairColor)
  const col2 = p.c('color2', mix(col, '#ffffff', 0.7))
  const dir = -facing
  switch (id) {
    case 'cat-tail':
    case 'monkey-tail': {
      const monkey = id === 'monkey-tail'
      const spine: P[] = monkey ? [[0, 0], [dir * s * 0.35, s * 0.1], [dir * s * 0.62, -s * 0.2], [dir * s * 0.52, -s * 0.5], [dir * s * 0.38, -s * 0.42]] : [[0, 0], [dir * s * 0.35, s * 0.1], [dir * s * 0.6, -s * 0.2], [dir * s * 0.55, -s * 0.55]]
      const radii = monkey ? [s * 0.05, s * 0.045, s * 0.04, s * 0.035, s * 0.03] : [s * 0.06, s * 0.055, s * 0.05, s * 0.045]
      const d = tube(spine, radii)
      let out = P.shape(d, col, { material: 'fur' })
      if (t > 0) {
        // Fur flow along the tail and a lit ridge.
        let fur = ''
        for (let i = 1; i < spine.length - 1; i++) {
          const [x, y] = spine[i]
          fur += `M${fx(x - dir * s * 0.02)} ${fx(y + s * 0.02)}q${fx(dir * s * 0.03)} ${fx(-s * 0.01)} ${fx(dir * s * 0.05)} ${fx(-s * 0.04)}`
        }
        out += P.line(fur, shadowOf(col, 0.3), s * 0.008, { opacity: 0.6 })
        if (t === 2) out += litEdge(c, d, highlightOf(col, 0.45), s * 0.01, 0.6)
      }
      if (!monkey && t > 0) out += P.flat(tube(spine.slice(-2), [s * 0.042, s * 0.045]), shadowOf(col, 0.12), 0.6)
      return out
    }
    case 'fox-tail': {
      // A bushy tail: a thick tapered tube, its outline broken into fur tufts, a white tip.
      const spine: P[] = [[0, 0], [dir * s * 0.3, s * 0.02], [dir * s * 0.6, -s * 0.18], [dir * s * 0.74, -s * 0.52], [dir * s * 0.64, -s * 0.86]]
      const radii = [s * 0.05, s * 0.13, s * 0.19, s * 0.16, s * 0.02]
      const outline = tubePts(spine, radii, 'round', 'point')
      const fluffy = (pts: SP[]) => (t > 0 ? scallop(sampleSmooth(pts.map((q) => [q[0], q[1]] as P), true, 3), 0.16) : smooth(pts))
      const d = fluffy(outline)
      let out = P.shape(d, col, { material: 'fur' })
      const tipSpine: P[] = [spine[3], spine[4]]
      const tipD = fluffy(tubePts([[lerp(spine[2][0], spine[3][0], 0.55), lerp(spine[2][1], spine[3][1], 0.55)], ...tipSpine], [s * 0.17, s * 0.15, s * 0.02], 'flat', 'point'))
      out += P.shape(tipD, col2, { shade: 0.6, material: 'fur', outline: 0.8 })
      if (t > 0) {
        // Fur flow lines following the tail.
        let fur = ''
        for (const u of [0.22, 0.38, 0.52]) {
          const k = u * (spine.length - 1)
          const a = spine[Math.floor(k)]
          const b = spine[Math.min(spine.length - 1, Math.floor(k) + 1)]
          const x = lerp(a[0], b[0], k % 1)
          const y = lerp(a[1], b[1], k % 1)
          fur += `M${fx(x - dir * s * 0.04)} ${fx(y + s * 0.06)}q${fx(dir * s * 0.06)} ${fx(-s * 0.02)} ${fx(dir * s * 0.1)} ${fx(-s * 0.1)}M${fx(x + dir * s * 0.02)} ${fx(y - s * 0.04)}q${fx(dir * s * 0.05)} ${fx(-s * 0.02)} ${fx(dir * s * 0.07)} ${fx(-s * 0.08)}`
        }
        out += P.line(fur, shadowOf(col, 0.3), s * 0.01, { opacity: 0.7 })
        if (t === 2) out += litEdge(c, d, highlightOf(col, 0.45), s * 0.014, 0.6)
      }
      return out
    }
    case 'devil-tail': {
      const d = `M0 0Q${fx(dir * s * 0.5)} ${fx(s * 0.2)} ${fx(dir * s * 0.55)} ${fx(-s * 0.35)}`
      let out = P.line(d, P.ink(col), s * 0.04 + P.lw * 1.4) + P.line(d, col, s * 0.04)
      if (t > 0) out += `<g transform="translate(${fx(lightOf(c)[0] * s * 0.008)} ${fx(lightOf(c)[1] * s * 0.008)})">${P.line(d, highlightOf(col, 0.45), s * 0.012, { opacity: 0.8 })}</g>`
      const spade = smooth([[dir * s * 0.55, -s * 0.56, 0], [dir * s * 0.64, -s * 0.44], [dir * s * 0.69, -s * 0.32, 0], [dir * s * 0.55, -s * 0.36], [dir * s * 0.41, -s * 0.32, 0], [dir * s * 0.46, -s * 0.44]])
      out += P.shape(spade, col, { material: 'chitin' })
      return out
    }
    case 'dragon-tail': {
      const spine: P[] = [[0, 0], [dir * s * 0.35, s * 0.18], [dir * s * 0.75, s * 0.25], [dir * s * 1.05, s * 0.12]]
      const d = tube(spine, [s * 0.14, s * 0.11, s * 0.07, s * 0.02], 'round', 'point')
      // Spines along the top edge, shrinking toward the tip.
      const radiiD = [s * 0.14, s * 0.11, s * 0.07, s * 0.02]
      let spikes = ''
      for (const u of [0.12, 0.36, 0.6, 0.8]) {
        const k = u * (spine.length - 1)
        const i0 = Math.floor(k)
        const a = spine[i0]
        const b = spine[Math.min(spine.length - 1, i0 + 1)]
        const x = lerp(a[0], b[0], k - i0)
        const y = lerp(a[1], b[1], k - i0)
        const r = lerp(radiiD[i0], radiiD[Math.min(3, i0 + 1)], k - i0)
        const h = s * 0.14 * (1 - u * 0.6)
        spikes += poly([[x - dir * h * 0.55, y - r * 0.8], [x + dir * h * 0.2, y - r - h], [x + dir * h * 0.5, y - r * 0.75]])
      }
      let out = P.shape(spikes, col2, { material: 'chitin' })
      out += P.shape(d, col, { material: 'scales' })
      if (t > 0) {
        // Belly plates along the underside and scale rows along the top.
        let plates = ''
        for (let u = 0.12; u < 0.9; u += 0.11) {
          const i = Math.min(spine.length - 2, Math.floor(u * (spine.length - 1)))
          const q = u * (spine.length - 1) - i
          const x = lerp(spine[i][0], spine[i + 1][0], q)
          const y = lerp(spine[i][1], spine[i + 1][1], q)
          const r = lerp(s * 0.14, s * 0.02, u)
          plates += `M${fx(x - dir * r * 0.2)} ${fx(y + r * 0.3)}Q${fx(x)} ${fx(y + r * 0.95)} ${fx(x + dir * r * 0.25)} ${fx(y + r * 0.35)}`
        }
        out += P.line(plates, highlightOf(col2, 0.2), s * 0.01, { opacity: 0.8 })
        if (t === 2) out += litEdge(c, d, highlightOf(col, 0.45), s * 0.012, 0.6)
      }
      return out
    }
    case 'bunny-tail':
      return t > 0 ? P.shape(scallop(ring(dir * s * 0.05, 0, s * 0.09, s * 0.09, 10), 0.3), col, { material: 'fur' }) + P.line(`M${fx(dir * s * 0.02)} ${fx(-s * 0.02)}l${fx(dir * s * 0.04)} ${fx(-s * 0.03)}M${fx(dir * s * 0.06)} ${fx(s * 0.03)}l${fx(dir * s * 0.04)} ${fx(-s * 0.02)}`, shadowOf(col, 0.2), s * 0.008, { opacity: 0.6 }) : P.shape(circle(dir * s * 0.05, 0, s * 0.1), col)
  }
  return ''
}

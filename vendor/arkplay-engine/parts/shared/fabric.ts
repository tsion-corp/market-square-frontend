/* Fabric patterns as SVG <pattern> tiles, garment prints (graphics, text, numbers), and the
 * small material toolkit garments are finished with (creases, stitching, buttons, rivets,
 * zips, sheen, ribbing, twill and knit texture, soft cast shadows).
 *
 * Tiles are in user space and scale with the avatar, so a stripe is the same width on a
 * sleeve and a skirt; they are keyed so a pattern used by five garments is emitted once.
 *
 * Detail budget: `tonal` cues (creases, sheen, cast shadows) need a shaded style; `fine`
 * construction (seams, stitching, hardware detail) needs detail 'high'; `rich` extras
 * (textures, extra folds) are only drawn for baked stills (RenderOptions.quality 'high'). */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import type { Box, P } from '../../core/math.ts'
import { brush, circle, ellipse, f, heart, poly, roundRect, smooth, star, type SP } from '../../core/path.ts'
import { hash32 } from '../../core/rng.ts'
import { el, url } from '../../core/svg.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { fitText } from '../../text/strokeFont.ts'

/* ---- Detail gates ------------------------------------------------------------------ */

/** Shaded styles only: creases, sheen, cast shadows ('flat' stays flat, 'low' stays clean). */
export const tonal = (c: Ctx): boolean => c.paint.style.shading !== 'flat' && c.paint.detail > 0
/** Construction finish: topstitching, hardware detail (baked stills at high detail; animation
 *  frames are drawn many times, so they keep only seams and simple hardware). */
export const fine = (c: Ctx): boolean => c.baked && c.paint.detail > 1
/** The expensive finish for baked stills: textures, extra folds, highlights. */
export const rich = (c: Ctx): boolean => c.baked && c.paint.detail > 1

/* ---- Pattern tiles ------------------------------------------------------------------ */

/** Draws `d` four times, shifted by the tile size, so shapes crossing a tile edge wrap. */
function wrapped(d: (dx: number, dy: number) => string, w: number, h: number): string {
  return d(0, 0) + d(-w, 0) + d(0, -h) + d(-w, -h)
}

/** Returns a paint (url) for the pattern, or undefined for solid. */
export function fabricPaint(c: Ctx, pattern: string, color: string, patternColor: string, tile: number, key = ''): string | undefined {
  if (!pattern || pattern === 'solid') return undefined
  const P = c.paint
  const a = P.col(color)
  const b = P.col(patternColor)
  if (pattern === 'gradient') return P.linear(`fab${a.slice(1)}${b.slice(1)}${key}`, [[0, a], [1, b]], [0, 0], [0, 1])
  const s = Math.max(4, tile)
  const id = c.defs.add(`pat${pattern}${a.slice(1)}${b.slice(1)}${Math.round(s)}`, (pid) => {
    // The tile background is overscanned by the shapes' own base fill underneath (see
    // `patternedFill`), so rasterizers that seam tile edges show nothing.
    let body = el('rect', { width: s, height: s, fill: a })
    let w = s
    let h = s
    let transform: string | undefined
    switch (pattern) {
      case 'stripes':
        body += el('rect', { y: s * 0.5, width: s, height: s * 0.5, fill: b })
        break
      case 'vstripes':
        body += el('rect', { x: s * 0.5, width: s * 0.5, height: s, fill: b })
        break
      case 'pinstripe':
        body += el('rect', { x: s * 0.475, width: s * 0.05, height: s, fill: b, 'fill-opacity': 0.9 })
        break
      case 'diagonal':
        body += el('rect', { y: s * 0.5, width: s, height: s * 0.5, fill: b })
        transform = 'rotate(45)'
        break
      case 'dots':
        // Staggered polka dots.
        w = h = s * 1.2
        body = el('rect', { width: w, height: h, fill: a })
        body += el('path', { d: circle(w * 0.25, h * 0.25, s * 0.15) + circle(w * 0.75, h * 0.75, s * 0.15), fill: b })
        break
      case 'plaid': {
        // Tartan: two crossing bands (darker where they cross), a fine over-check and an accent line.
        const mid = mix(a, b, 0.5)
        const dark = shadowOf(a, 0.3)
        body += el('rect', { y: s * 0.3, width: s, height: s * 0.36, fill: b, 'fill-opacity': 0.5 })
        body += el('rect', { x: s * 0.3, width: s * 0.36, height: s, fill: b, 'fill-opacity': 0.5 })
        body += el('path', { d: `M0 ${f(s * 0.1)}H${f(s)}M${f(s * 0.1)} 0V${f(s)}`, stroke: dark, 'stroke-width': f(s * 0.05), 'stroke-opacity': 0.6 })
        body += el('path', { d: `M0 ${f(s * 0.48)}H${f(s)}M${f(s * 0.48)} 0V${f(s)}`, stroke: highlightOf(mid, 0.35), 'stroke-width': f(s * 0.025) })
        break
      }
      case 'checker':
        body += el('rect', { width: s / 2, height: s / 2, fill: b }) + el('rect', { x: s / 2, y: s / 2, width: s / 2, height: s / 2, fill: b })
        break
      case 'camo': {
        // Woodland camo: four tones of irregular, interlocking blotches that wrap the tile.
        w = h = s * 3
        const tones = [b, shadowOf(a, 0.35), mix(a, b, 0.45), shadowOf(b, 0.25)]
        const blobs: P[][] = [
          [[0.02, 0.08], [0.18, 0.02], [0.3, 0.1], [0.44, 0.06], [0.5, 0.18], [0.36, 0.26], [0.24, 0.22], [0.1, 0.3]],
          [[0.55, 0.3], [0.7, 0.24], [0.82, 0.34], [0.96, 0.3], [1.02, 0.44], [0.86, 0.5], [0.72, 0.46], [0.6, 0.52], [0.52, 0.42]],
          [[0.08, 0.5], [0.2, 0.42], [0.3, 0.5], [0.4, 0.46], [0.44, 0.6], [0.3, 0.7], [0.22, 0.64], [0.1, 0.72], [0.04, 0.62]],
          [[0.6, 0.02], [0.76, 0.06], [0.9, 0.02], [0.98, 0.12], [0.86, 0.2], [0.72, 0.16], [0.62, 0.2]],
          [[0.5, 0.72], [0.64, 0.66], [0.78, 0.74], [0.9, 0.7], [0.94, 0.84], [0.8, 0.9], [0.66, 0.86], [0.54, 0.92], [0.46, 0.84]],
          [[0.14, 0.84], [0.28, 0.8], [0.4, 0.9], [0.36, 1.02], [0.2, 1.0], [0.1, 0.96]],
          [[0.3, 0.3], [0.42, 0.34], [0.5, 0.3], [0.56, 0.4], [0.46, 0.44], [0.34, 0.4]],
          [[0.7, 0.54], [0.8, 0.56], [0.86, 0.62], [0.76, 0.66], [0.68, 0.62]],
        ]
        body = el('rect', { width: w, height: h, fill: a })
        blobs.forEach((pts, i) => {
          const abs = pts.map(([x, y]) => [x * w, y * h, 0.55] as SP)
          body += el('path', { d: wrapped((dx, dy) => smooth(abs.map(([x, y, k]) => [x + dx, y + dy, k] as SP)), w, h), fill: tones[i % tones.length] })
        })
        break
      }
      case 'floral': {
        // A large and a small flower per tile, staggered, with leaves.
        w = h = s * 1.3
        body = el('rect', { width: w, height: h, fill: a })
        const flower = (cx: number, cy: number, r: number, rot: number) => {
          let petals = ''
          for (let i = 0; i < 5; i++) {
            const an = rot + (i / 5) * Math.PI * 2
            petals += ellipse(cx + Math.cos(an) * r * 0.55, cy + Math.sin(an) * r * 0.55, r * 0.42, r * 0.42)
          }
          return petals
        }
        const leaf = (cx: number, cy: number, r: number, an: number) => brush([[cx, cy], [cx + Math.cos(an) * r, cy + Math.sin(an) * r]], 0, 0, r * 0.45)
        const green = mix(shadowOf(a, 0.15), P.col('#5f8f4e'), 0.45)
        body += el('path', { d: leaf(w * 0.3, h * 0.3, s * 0.32, 0.6) + leaf(w * 0.3, h * 0.3, s * 0.26, 2.6) + leaf(w * 0.78, h * 0.8, s * 0.22, -0.9), fill: green })
        body += el('path', { d: flower(w * 0.3, h * 0.3, s * 0.2, 0.3) + flower(w * 0.78, h * 0.8, s * 0.13, 1.1), fill: b })
        body += el('path', { d: circle(w * 0.3, h * 0.3, s * 0.08) + circle(w * 0.78, h * 0.8, s * 0.05), fill: mix(b, P.col('#ffd54f'), 0.6) })
        break
      }
      case 'stars':
        w = h = s * 1.2
        body = el('rect', { width: w, height: h, fill: a })
        body += el('path', { d: star(w * 0.27, h * 0.27, s * 0.2, s * 0.085, 5, -90) + star(w * 0.77, h * 0.77, s * 0.12, s * 0.05, 5, -72), fill: b })
        break
      case 'hearts':
        w = h = s * 1.2
        body = el('rect', { width: w, height: h, fill: a })
        body += el('path', { d: heart(w * 0.27, h * 0.27, s * 0.17) + heart(w * 0.77, h * 0.77, s * 0.11), fill: b })
        break
      case 'zigzag':
        body += el('path', { d: `M0 ${f(s * 0.65)}L${f(s / 4)} ${f(s * 0.35)}L${f(s / 2)} ${f(s * 0.65)}L${f((s * 3) / 4)} ${f(s * 0.35)}L${f(s)} ${f(s * 0.65)}`, stroke: b, 'stroke-width': f(s * 0.14), fill: 'none', 'stroke-linejoin': 'miter' })
        break
      case 'argyle':
        h = s * 1.4
        body = el('rect', { width: w, height: h, fill: a })
        body += el('path', { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), fill: b })
        body += el('path', { d: `M0 0L${f(w)} ${f(h)}M${f(w)} 0L0 ${f(h)}`, stroke: mix(a, '#ffffff', 0.55), 'stroke-width': f(s * 0.03), 'stroke-dasharray': f(s * 0.08) })
        break
      case 'leopard': {
        // Rosettes: a warm core ringed by broken dark arcs, plus small solid spots.
        w = h = s * 1.6
        body = el('rect', { width: w, height: h, fill: a })
        const core = mix(a, shadowOf(b, 0.1), 0.35)
        const spots: [number, number, number, number][] = [
          [0.25, 0.28, 0.16, 0.2],
          [0.72, 0.62, 0.14, 1.6],
          [0.2, 0.8, 0.11, 3.1],
        ]
        let cores = ''
        let arcs = ''
        for (const [x, y, r, rot] of spots) {
          const cx = x * w
          const cy = y * h
          const rr = r * w
          cores += ellipse(cx, cy, rr * 0.7, rr * 0.55)
          for (let i = 0; i < 3; i++) {
            const a0 = rot + i * 2.1
            arcs += brush([[cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr * 0.8], [cx + Math.cos(a0 + 0.8) * rr, cy + Math.sin(a0 + 0.8) * rr * 0.8], [cx + Math.cos(a0 + 1.5) * rr * 0.95, cy + Math.sin(a0 + 1.5) * rr * 0.78]], rr * 0.12, rr * 0.28, rr * 0.1)
          }
        }
        body += el('path', { d: cores, fill: core })
        body += el('path', { d: arcs + circle(0.55 * w, 0.18 * h, s * 0.045) + circle(0.9 * w, 0.95 * h, s * 0.04) + circle(0.5 * w, 0.95 * h, s * 0.035), fill: b })
        break
      }
      case 'zebra': {
        // Tapered, wavy stripes that span the tile so they join seamlessly.
        w = s * 1.6
        h = s * 1.2
        body = el('rect', { width: w, height: h, fill: a })
        const stripe = (y: number, amp: number, t0: number, t1: number) => brush([[0, y], [w * 0.25, y - amp], [w * 0.5, y + amp * 0.3], [w * 0.75, y - amp * 0.6], [w, y]], t0, t1, (t0 + t1) * 0.35)
        body += el('path', { d: stripe(h * 0.18, h * 0.06, s * 0.14, s * 0.14) + stripe(h * 0.52, h * 0.08, s * 0.16, s * 0.16) + stripe(h * 0.84, h * 0.05, s * 0.1, s * 0.1) + brush([[w * 0.1, h * 0.36], [w * 0.35, h * 0.34], [w * 0.55, h * 0.38]], 0, 0, s * 0.07), fill: b })
        break
      }
      case 'tiedye': {
        // A spiral burst: soft rings plus three swirling arms.
        w = h = s * 3
        const cols = [b, mix(a, b, 0.5), highlightOf(b, 0.35)]
        body = el('rect', { width: w, height: h, fill: a })
        for (let i = 4; i > 0; i--) body += el('circle', { cx: w / 2, cy: h / 2, r: f((w / 2) * (i / 4.2)), fill: cols[i % cols.length], 'fill-opacity': 0.45 })
        for (let k = 0; k < 3; k++) {
          const pts: P[] = []
          for (let i = 0; i <= 8; i++) {
            const t = i / 8
            const an = k * 2.094 + t * 3.4
            pts.push([w / 2 + Math.cos(an) * t * w * 0.5, h / 2 + Math.sin(an) * t * h * 0.5])
          }
          body += el('path', { d: brush(pts, s * 0.1, s * 0.5, 0), fill: cols[k], 'fill-opacity': 0.75 })
        }
        break
      }
      case 'flames': {
        w = s * 1.6
        h = s * 2.2
        body = el('rect', { width: w, height: h, fill: a })
        const tongue = (x0: number, x1: number, tipX: number, tipY: number) =>
          `M${f(x0)} ${f(h)}C${f(x0)} ${f(h * 0.7)} ${f(tipX - (x1 - x0) * 0.1)} ${f(tipY + h * 0.25)} ${f(tipX)} ${f(tipY)}C${f(tipX + (x1 - x0) * 0.25)} ${f(tipY + h * 0.3)} ${f(x1)} ${f(h * 0.62)} ${f(x1)} ${f(h)}Z`
        body += el('path', { d: tongue(-w * 0.05, w * 0.55, w * 0.3, h * 0.12) + tongue(w * 0.45, w * 1.05, w * 0.82, h * 0.34), fill: b })
        body += el('path', { d: tongue(w * 0.1, w * 0.42, w * 0.3, h * 0.45) + tongue(w * 0.6, w * 0.92, w * 0.82, h * 0.6), fill: mix(b, P.col('#ffd54f'), 0.55) })
        break
      }
      case 'circuit':
        body += el('path', { d: `M0 ${f(s * 0.3)}H${f(s * 0.4)}V${f(s * 0.7)}H${f(s)}M${f(s * 0.7)} 0V${f(s * 0.3)}M${f(s * 0.15)} ${f(s)}V${f(s * 0.85)}`, stroke: b, 'stroke-width': f(s * 0.045), fill: 'none' })
        body += el('path', { d: circle(s * 0.4, s * 0.3, s * 0.065) + circle(s * 0.7, s * 0.3, s * 0.065) + circle(s * 0.15, s * 0.85, s * 0.05), fill: 'none', stroke: b, 'stroke-width': f(s * 0.04) })
        break
    }
    return el('pattern', { id: pid, width: f(w), height: f(h), patternUnits: 'userSpaceOnUse', patternTransform: transform }, body)
  })
  return url(id)
}

/** The item's pattern paint, sized for the avatar. */
export function itemPaint(c: Ctx, p: Reader, tile: number, key = ''): string | undefined {
  return fabricPaint(c, p.s('pattern'), p.c('color', '#888888'), p.c('patternColor', '#f5f2eb'), tile, key)
}

/**
 * A base-colour fill to lay under a patterned fill: pattern tiles never leave hairline seams
 * of the background showing through (resvg and browsers anti-alias tile edges).
 */
export function underlay(c: Ctx, d: string, color: string, paint: string | undefined): string {
  return paint ? c.paint.flat(d, color) : ''
}

/* ---- Material toolkit ---------------------------------------------------------------- */

/** Offsets points toward the light by `k`. */
function towardLight(c: Ctx, pts: P[], k: number): P[] {
  const L = c.paint.style.light
  return pts.map(([x, y]) => [x + L[0] * k, y + L[1] * k] as P)
}

/**
 * A tapered lens along `pts` (2 or 3 points), `w` wide at its middle, as two quadratic curves:
 * the crisp, pointed shape of a crease or a sheen streak in ~60 bytes (a brush stroke would
 * be ~800). Longer point lists fall back to `brush`.
 */
export function lens(pts: P[], w: number): string {
  if (pts.length > 3) return brush(pts, 0, 0, w)
  const a = pts[0]
  const b = pts[pts.length - 1]
  const m: P = pts.length === 3 ? pts[1] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const nx = (-dy / len) * w * 0.5
  const ny = (dx / len) * w * 0.5
  // A quadratic through its midpoint at m ± n needs its control at 2(m ± n) − (a + b)/2.
  const cx = 2 * m[0] - (a[0] + b[0]) / 2
  const cy = 2 * m[1] - (a[1] + b[1]) / 2
  return `M${f(a[0])} ${f(a[1])}Q${f(cx + nx * 2)} ${f(cy + ny * 2)} ${f(b[0])} ${f(b[1])}Q${f(cx - nx * 2)} ${f(cy - ny * 2)} ${f(a[0])} ${f(a[1])}Z`
}

/**
 * A fold where fabric bends or hangs: a tapered lens of shadow along `pts` and (baked) a thin
 * lit ridge beside it on the light side. `w` is the widest point of the crease.
 */
export function crease(c: Ctx, pts: P[], w: number, color: string, depth = 1, ridge = true, always = false): string {
  if (!tonal(c) || pts.length < 2 || w <= 0 || (!c.baked && !always)) return ''
  const P = c.paint
  let out = P.flat(lens(pts, w), shadowOf(color, 0.3 * depth), c.paint.style.shading === 'soft' ? 0.4 : 0.55)
  if (ridge && c.baked) out += P.flat(lens(towardLight(c, pts, w * 0.9), w * 0.45), highlightOf(color, 0.22), 0.45)
  return out
}

/** Several creases at once (one element per layer). Animation frames draw only the ones marked `always`. */
export function creases(c: Ctx, list: { pts: P[]; w: number }[], color: string, depth = 1, ridge = true, always = false): string {
  if (!tonal(c) || !list.length || (!c.baked && !always)) return ''
  const P = c.paint
  const sh = list.map((k) => lens(k.pts, k.w)).join('')
  let out = P.flat(sh, shadowOf(color, 0.3 * depth), c.paint.style.shading === 'soft' ? 0.4 : 0.55)
  if (ridge && c.baked) out += P.flat(list.map((k) => lens(towardLight(c, k.pts, k.w * 0.9), k.w * 0.45)).join(''), highlightOf(color, 0.22), 0.45)
  return out
}

/** Topstitching: a fine dashed line (`u` is the detail unit). */
export function stitch(c: Ctx, d: string, color: string, u: number, opacity = 0.85): string {
  if (!fine(c) || !d) return ''
  return c.paint.line(d, color, u * 0.3, { dash: `${f(u * 1.05)} ${f(u * 0.7)}`, opacity, cap: 'butt' })
}

/** A seam: a thin shadowed line (the fold of the seam allowance). */
export function seamLine(c: Ctx, d: string, color: string, u: number, opacity = 0.55): string {
  if (c.paint.detail === 0 || !d) return ''
  return c.paint.line(d, shadowOf(color, 0.32), u * 0.42, { opacity })
}

export type Hardware = 'sew' | 'shank' | 'snap' | 'metal'

/** A button with a domed cel form, rim, holes and a specular glint (no clip paths: cheap). */
export function button(c: Ctx, x: number, y: number, r: number, color: string, kind: Hardware = 'sew'): string {
  const P = c.paint
  const base = color
  if (P.detail === 0 || P.style.shading === 'flat' || !c.baked) return P.shape(circle(x, y, r), color, { shade: false, outline: 0.45 })
  const L = P.style.light
  const metal = kind === 'metal' || kind === 'snap' || kind === 'shank'
  let out = P.flat(circle(x, y, r), shadowOf(base, metal ? 0.3 : 0.18))
  out += P.flat(circle(x + L[0] * r * 0.18, y + L[1] * r * 0.18, r * 0.8), base)
  if (P.detail > 1) {
    if (kind === 'sew') {
      out += P.line(circle(x, y, r * 0.62), shadowOf(base, 0.25), r * 0.14, { opacity: 0.7 })
      const hr = r * 0.13
      out += P.flat(circle(x - r * 0.24, y, hr) + circle(x + r * 0.24, y, hr), shadowOf(base, 0.55))
    } else if (kind === 'snap') {
      out += P.flat(circle(x, y, r * 0.38), shadowOf(base, 0.2))
    }
    out += P.flat(ellipse(x + L[0] * r * 0.38, y + L[1] * r * 0.38, r * (metal ? 0.34 : 0.26), r * (metal ? 0.22 : 0.17)), highlightOf(base, metal ? 0.75 : 0.5), metal ? 0.95 : 0.75)
  }
  const lw = P.lw * 0.45
  return out + (lw > 0 ? P.line(circle(x, y, r), P.ink(color), lw) : '')
}

/** A copper/steel rivet: a tiny domed stud. */
export function rivet(c: Ctx, x: number, y: number, r: number, color = '#b87333'): string {
  const P = c.paint
  const L = P.style.light
  if (P.detail === 0 || !c.baked) return ''
  return P.flat(circle(x, y, r), shadowOf(color, 0.25)) + P.flat(circle(x + L[0] * r * 0.2, y + L[1] * r * 0.2, r * 0.72), color) + (P.detail > 1 ? P.flat(circle(x + L[0] * r * 0.35, y + L[1] * r * 0.35, r * 0.3), highlightOf(color, 0.7), 0.9) : '')
}

/**
 * A zip along a straight line from (x, y0) down to (x, y1): tape, interlocking teeth and a
 * pull tab at the top. `w` is the teeth width.
 */
export function zipper(c: Ctx, x: number, y0: number, y1: number, w: number, tape: string, metal = '#c9ccd3', pull = true): string {
  const P = c.paint
  if (P.detail === 0 || !c.baked) return P.line(`M${f(x)} ${f(y0)}V${f(y1)}`, shadowOf(tape, 0.35), w * 0.9)
  let out = P.line(`M${f(x)} ${f(y0)}V${f(y1)}`, shadowOf(tape, 0.22), w * 2, { opacity: 0.55, cap: 'butt' })
  if (P.detail > 1) {
    out += P.line(`M${f(x)} ${f(y0 + w)}V${f(y1)}`, shadowOf(metal, 0.2), w, { dash: `${f(w * 0.42)} ${f(w * 0.42)}`, cap: 'butt' })
    if (c.baked) out += P.line(`M${f(x - w * 0.18)} ${f(y0 + w)}V${f(y1)}`, highlightOf(metal, 0.4), w * 0.3, { dash: `${f(w * 0.42)} ${f(w * 0.42)}`, cap: 'butt', opacity: 0.9 })
  } else out += P.line(`M${f(x)} ${f(y0)}V${f(y1)}`, metal, w * 0.6)
  if (pull) {
    const ph = w * 3.2
    out += P.shape(roundRect(x - w * 0.55, y0 + w * 0.6, w * 1.1, ph, w * 0.45), metal, { shade: 0.5, outline: 0.4, gloss: P.detail > 1 })
    if (P.detail > 1) out += P.flat(roundRect(x - w * 0.2, y0 + w * 0.6 + ph * 0.55, w * 0.4, ph * 0.3, w * 0.2), shadowOf(metal, 0.45))
  }
  return out
}

/**
 * A glossy band (satin, leather, rubber, metal): a soft outer lens and a bright core along
 * `pts`. `strength` scales the opacity.
 */
export function sheen(c: Ctx, pts: P[], w: number, color: string, strength = 1, core = true): string {
  if (!tonal(c) || pts.length < 2) return ''
  const P = c.paint
  const out = P.flat(lens(pts, w), highlightOf(color, 0.4), Math.min(1, 0.26 * strength))
  if (!core) return out + P.flat(lens(pts, w * 0.6), highlightOf(color, 0.3), Math.min(1, 0.18 * strength))
  return out + (P.detail > 1 ? P.flat(lens(pts, w * 0.38), highlightOf(color, 0.7), Math.min(1, 0.5 * strength)) : '')
}

/** A pattern of vertical rib lines (knit cuffs, hems, collars), `pitch` apart. */
export function ribPaint(c: Ctx, color: string, pitch: number): string {
  const sc = shadowOf(c.paint.col(color), 0.28)
  const hl = highlightOf(c.paint.col(color), 0.18)
  const p = Math.max(1, pitch)
  const id = c.defs.add(`rib${sc.slice(1)}${Math.round(p * 10)}`, (pid) =>
    el(
      'pattern',
      { id: pid, width: f(p), height: f(p * 4), patternUnits: 'userSpaceOnUse' },
      el('rect', { x: f(p * 0.1), width: f(p * 0.22), height: f(p * 4), fill: sc, 'fill-opacity': 0.55 }),
      el('rect', { x: f(p * 0.55), width: f(p * 0.18), height: f(p * 4), fill: hl, 'fill-opacity': 0.35 }),
    ),
  )
  return url(id)
}

/** Diagonal twill (denim, gabardine): fine lines, very low contrast. */
export function twillPaint(c: Ctx, color: string, pitch: number): string {
  const base = c.paint.col(color)
  const sc = shadowOf(base, 0.3)
  const hl = highlightOf(base, 0.3)
  const p = Math.max(1, pitch)
  const id = c.defs.add(`tw${sc.slice(1)}${Math.round(p * 10)}`, (pid) =>
    el(
      'pattern',
      { id: pid, width: f(p), height: f(p), patternUnits: 'userSpaceOnUse' },
      el('path', { d: `M${f(-p * 0.25)} ${f(p * 0.25)}L${f(p * 0.25)} ${f(-p * 0.25)}M0 ${f(p)}L${f(p)} 0M${f(p * 0.75)} ${f(p * 1.25)}L${f(p * 1.25)} ${f(p * 0.75)}`, stroke: sc, 'stroke-width': f(p * 0.22), 'stroke-opacity': 0.32 }),
      el('path', { d: `M0 ${f(p * 0.5)}L${f(p * 0.5)} 0M${f(p * 0.5)} ${f(p)}L${f(p)} ${f(p * 0.5)}`, stroke: hl, 'stroke-width': f(p * 0.14), 'stroke-opacity': 0.22 }),
    ),
  )
  return url(id)
}

/** Stockinette knit: rows of small V stitches. */
export function knitPaint(c: Ctx, color: string, pitch: number): string {
  const base = c.paint.col(color)
  const sc = shadowOf(base, 0.3)
  const p = Math.max(1, pitch)
  const id = c.defs.add(`kn${sc.slice(1)}${Math.round(p * 10)}`, (pid) =>
    el(
      'pattern',
      { id: pid, width: f(p), height: f(p * 0.8), patternUnits: 'userSpaceOnUse' },
      el('path', { d: `M${f(p * 0.08)} ${f(p * 0.1)}L${f(p * 0.5)} ${f(p * 0.68)}L${f(p * 0.92)} ${f(p * 0.1)}`, fill: 'none', stroke: sc, 'stroke-width': f(p * 0.13), 'stroke-opacity': 0.35, 'stroke-linejoin': 'round' }),
    ),
  )
  return url(id)
}

/** Fills `d` with a texture paint (a transparent overlay; nothing when the paint is empty). */
export const texture = (d: string, paint: string | undefined): string => (paint && d ? el('path', { d, fill: paint }) : '')

/**
 * A soft cast shadow: `d` filled with the receiver's shadow colour fading from `opacity` at
 * `from` to nothing at `to` (object-bounding-box coordinates). Gradients, not filters.
 */
export function castShadow(c: Ctx, d: string, receiver: string, from: P, to: P, opacity = 0.4, skin = false): string {
  if (!tonal(c) || !d || !c.baked) return ''
  const P = c.paint
  // Shadows on skin stay warm (light scatters under it); on cloth they cool off.
  const sc = skin ? mix(shadowOf(receiver, 0.3), '#a3402f', 0.28) : shadowOf(receiver, 0.5)
  const key = `cs${sc.slice(1)}${Math.round(opacity * 100)}${from.map((v) => Math.round(v * 10)).join('')}${to.map((v) => Math.round(v * 10)).join('')}`
  return el('path', { d, fill: P.linear(key, [[0, sc, opacity], [0.55, sc, opacity * 0.35], [1, sc, 0]], from, to) })
}

/** A clip path for `d`, shared by every identical shape. Returns its id. */
export function clipFor(c: Ctx, d: string): string {
  return c.defs.add(`gc${hash32(d).toString(36)}`, (id) => el('clipPath', { id }, el('path', { d })))
}

/**
 * Local bounds of the geometry in an SVG fragment: every path's points and control points
 * (relative commands resolved), circles and ellipses. Transforms are ignored, like
 * compose's `partBounds`; unlike it, relative commands are honoured, so the Painter's
 * relative-coordinate crescents do not inflate a part (pass the result as `Part.bounds`).
 */
export function svgBounds(svg: string): Box | undefined {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const seen = new Set<string>()
  let i = svg.indexOf(' d="')
  while (i >= 0) {
    const j = svg.indexOf('"', i + 4)
    if (j < 0) break
    const d = svg.slice(i + 4, j)
    // The Painter repeats a shape's path several times in one part: measure each once.
    if (!seen.has(d)) {
      seen.add(d)
      pathExtent(d, b)
    }
    i = svg.indexOf(' d="', j)
  }
  if (svg.includes('<circle') || svg.includes('<ellipse')) {
    const reC = /<(?:circle|ellipse)[^>]*?cx="([-\d.]+)"[^>]*?cy="([-\d.]+)"[^>]*?(?:r|rx)="([-\d.]+)"/g
    let m: RegExpExecArray | null
    while ((m = reC.exec(svg))) {
      const cx = +m[1]
      const cy = +m[2]
      const r = +m[3]
      if (cx - r < b[0]) b[0] = cx - r
      if (cy - r < b[1]) b[1] = cy - r
      if (cx + r > b[2]) b[2] = cx + r
      if (cy + r > b[3]) b[3] = cy + r
    }
  }
  if (!Number.isFinite(b[0])) return undefined
  return { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }
}

const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** Extends `b` = [x0, y0, x1, y1] by the points of path data `d` (relative commands resolved). */
function pathExtent(d: string, b: number[]): void {
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cmd = 'M'
  let rel = false
  let n = 2
  const a = [0, 0, 0, 0, 0, 0, 0]
  let k = 0
  const add = (px: number, py: number) => {
    if (px < b[0]) b[0] = px
    if (py < b[1]) b[1] = py
    if (px > b[2]) b[2] = px
    if (py > b[3]) b[3] = py
  }
  const len = d.length
  let p = 0
  while (p < len) {
    const ch = d.charCodeAt(p)
    // Command letters.
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) {
      if (ch !== 101 && ch !== 69) {
        const c = d[p]
        cmd = c.toUpperCase()
        rel = c !== cmd
        n = ARGS[cmd] ?? 0
        k = 0
        if (cmd === 'Z') {
          x = sx
          y = sy
        }
        p++
        continue
      }
    }
    // Numbers.
    if (ch === 45 || ch === 43 || ch === 46 || (ch >= 48 && ch <= 57)) {
      let q = p + 1
      let dot = ch === 46
      while (q < len) {
        const c2 = d.charCodeAt(q)
        if (c2 >= 48 && c2 <= 57) q++
        else if (c2 === 46 && !dot) {
          dot = true
          q++
        } else if (c2 === 101 || c2 === 69) {
          q++
          const c3 = d.charCodeAt(q)
          if (c3 === 45 || c3 === 43) q++
        } else break
      }
      const v = +d.slice(p, q)
      p = q
      if (n === 0) continue
      a[k++] = v
      if (k === n) {
        k = 0
        const ox = rel ? x : 0
        const oy = rel ? y : 0
        switch (cmd) {
          case 'H':
            x = ox + a[0]
            break
          case 'V':
            y = oy + a[0]
            break
          case 'A':
            add(x - a[0], y - a[1])
            add(x + a[0], y + a[1])
            x = ox + a[5]
            y = oy + a[6]
            add(x - a[0], y - a[1])
            add(x + a[0], y + a[1])
            break
          default:
            for (let i = 0; i < n - 2; i += 2) add(ox + a[i], oy + a[i + 1])
            x = ox + a[n - 2]
            y = oy + a[n - 1]
        }
        add(x, y)
        if (cmd === 'M') {
          sx = x
          sy = y
          cmd = 'L'
        }
      }
      continue
    }
    p++
  }
}

/* ---- Prints ------------------------------------------------------------------------- */

interface Layer {
  d: string
  /** 'main' = the print colour, 'dark' = the dark accent, 'accent' = a secondary accent. */
  tone: 'main' | 'dark' | 'accent' | 'shade'
  stroke?: number
  outline?: boolean
}

function graphicLayers(kind: string, cx: number, cy: number, w: number, textIn: string, lw: number): Layer[] {
  const s = w / 2
  switch (kind) {
    case 'emblem':
      return [
        { d: circle(cx, cy, s * 0.62), tone: 'main', outline: true },
        { d: circle(cx, cy, s * 0.5), tone: 'shade', stroke: s * 0.05 },
        { d: star(cx, cy, s * 0.38, s * 0.16), tone: 'dark' },
      ]
    case 'text':
    case 'number': {
      const t = (textIn || (kind === 'number' ? '7' : 'ARK')).slice(0, kind === 'number' ? 3 : 10)
      const size = kind === 'number' ? s * 1.4 : s * 0.55
      const tp = fitText(t, cx, cy, size, w * 1.1)
      return [{ d: tp.d, tone: 'main', stroke: Math.max(lw * 0.9, tp.size * (kind === 'number' ? 0.16 : 0.13)) }]
    }
    case 'heart':
      return [{ d: heart(cx, cy, s * 0.45), tone: 'main', outline: true }]
    case 'star':
      return [{ d: star(cx, cy, s * 0.55, s * 0.24), tone: 'main', outline: true }]
    case 'lightning':
      return [{ d: poly([[cx + s * 0.1, cy - s * 0.6], [cx - s * 0.35, cy + s * 0.08], [cx - s * 0.02, cy + s * 0.08], [cx - s * 0.12, cy + s * 0.6], [cx + s * 0.35, cy - s * 0.1], [cx + s * 0.02, cy - s * 0.1]]), tone: 'main', outline: true }]
    case 'smiley':
      return [
        { d: circle(cx, cy, s * 0.5), tone: 'main', outline: true },
        { d: `M${f(cx - s * 0.25)} ${f(cy + s * 0.08)}Q${f(cx)} ${f(cy + s * 0.35)} ${f(cx + s * 0.25)} ${f(cy + s * 0.08)}`, tone: 'dark', stroke: s * 0.07 },
        { d: ellipse(cx - s * 0.17, cy - s * 0.12, s * 0.06, s * 0.1) + ellipse(cx + s * 0.17, cy - s * 0.12, s * 0.06, s * 0.1), tone: 'dark' },
      ]
    case 'skull':
      return [
        { d: smooth([[cx - s * 0.45, cy - s * 0.1], [cx - s * 0.35, cy - s * 0.5], [cx + s * 0.35, cy - s * 0.5], [cx + s * 0.45, cy - s * 0.1], [cx + s * 0.25, cy + s * 0.2], [cx + s * 0.22, cy + s * 0.45], [cx - s * 0.22, cy + s * 0.45], [cx - s * 0.25, cy + s * 0.2]]), tone: 'main', outline: true },
        { d: ellipse(cx - s * 0.17, cy - s * 0.1, s * 0.11, s * 0.12) + ellipse(cx + s * 0.17, cy - s * 0.1, s * 0.11, s * 0.12) + poly([[cx, cy + s * 0.08], [cx - s * 0.05, cy + s * 0.18], [cx + s * 0.05, cy + s * 0.18]]), tone: 'dark' },
        { d: `M${f(cx - s * 0.1)} ${f(cy + s * 0.3)}V${f(cy + s * 0.44)}M${f(cx + s * 0.1)} ${f(cy + s * 0.3)}V${f(cy + s * 0.44)}M${f(cx)} ${f(cy + s * 0.3)}V${f(cy + s * 0.44)}`, tone: 'dark', stroke: s * 0.035 },
      ]
    case 'planet':
      return [
        { d: `M${f(cx - s * 0.65)} ${f(cy)}A${f(s * 0.65)} ${f(s * 0.18)} 0 0 1 ${f(cx + s * 0.65)} ${f(cy)}`, tone: 'main', stroke: s * 0.08 },
        { d: circle(cx, cy, s * 0.38), tone: 'main', outline: true },
        { d: `M${f(cx - s * 0.3)} ${f(cy - s * 0.12)}Q${f(cx)} ${f(cy - s * 0.02)} ${f(cx + s * 0.34)} ${f(cy - s * 0.16)}`, tone: 'shade', stroke: s * 0.05 },
        { d: `M${f(cx + s * 0.65)} ${f(cy)}A${f(s * 0.65)} ${f(s * 0.18)} 0 0 1 ${f(cx - s * 0.65)} ${f(cy)}`, tone: 'main', stroke: s * 0.08 },
      ]
    case 'paw':
      return [{ d: ellipse(cx, cy + s * 0.15, s * 0.28, s * 0.22) + ellipse(cx - s * 0.3, cy - s * 0.15, s * 0.1, s * 0.12) + ellipse(cx - s * 0.1, cy - s * 0.32, s * 0.1, s * 0.12) + ellipse(cx + s * 0.12, cy - s * 0.32, s * 0.1, s * 0.12) + ellipse(cx + s * 0.32, cy - s * 0.15, s * 0.1, s * 0.12), tone: 'main' }]
    case 'flower':
      return [
        { d: [0, 1, 2, 3, 4].map((i) => circle(cx + Math.cos((i / 5) * Math.PI * 2 - Math.PI / 2) * s * 0.26, cy + Math.sin((i / 5) * Math.PI * 2 - Math.PI / 2) * s * 0.26, s * 0.2)).join(''), tone: 'main' },
        { d: circle(cx, cy, s * 0.14), tone: 'accent' },
      ]
    case 'crown':
      return [
        { d: poly([[cx - s * 0.5, cy + s * 0.3], [cx - s * 0.5, cy - s * 0.3], [cx - s * 0.25, cy], [cx, cy - s * 0.4], [cx + s * 0.25, cy], [cx + s * 0.5, cy - s * 0.3], [cx + s * 0.5, cy + s * 0.3]]), tone: 'main', outline: true },
        { d: `M${f(cx - s * 0.46)} ${f(cy + s * 0.16)}H${f(cx + s * 0.46)}`, tone: 'shade', stroke: s * 0.05 },
      ]
    case 'controller':
      return [
        { d: roundRect(cx - s * 0.55, cy - s * 0.25, s * 1.1, s * 0.55, s * 0.25), tone: 'main', outline: true },
        { d: `M${f(cx - s * 0.38)} ${f(cy)}h${f(s * 0.2)}M${f(cx - s * 0.28)} ${f(cy - s * 0.1)}v${f(s * 0.2)}`, tone: 'dark', stroke: s * 0.06 },
        { d: circle(cx + s * 0.25, cy - s * 0.05, s * 0.06) + circle(cx + s * 0.38, cy + s * 0.07, s * 0.06), tone: 'dark' },
      ]
  }
  return []
}

/**
 * A print on a garment, centred at (cx, cy), fitting a box `w` wide. With `fabric` (the
 * garment colour) the ink takes a little of the cloth's colour, and the caller can shade it
 * with the garment's form (see `printShade`), so prints read as printed, not stuck on.
 */
export function drawGraphic(c: Ctx, kind: string, cx: number, cy: number, w: number, color: string, textIn = '', fabric?: string): string {
  const P = c.paint
  const ink = fabric ? mix(color, fabric, 0.08) : color
  const dark = fabric ? mix('#26252c', fabric, 0.12) : '#26252c'
  const tones = { main: ink, dark, accent: '#ffd54f', shade: shadowOf(ink, 0.35) }
  let out = ''
  for (const l of graphicLayers(kind, cx, cy, w, textIn, P.lw)) {
    const col = tones[l.tone]
    if (l.stroke) out += P.line(l.d, col, l.stroke, { cap: 'round', opacity: l.tone === 'shade' ? 0.6 : undefined })
    else if (l.outline) out += P.shape(l.d, col, { shade: false, outline: 0.5, ink: fabric ? P.ink(mix(col, fabric, 0.35)) : undefined })
    else out += P.flat(l.d, col)
  }
  return out
}

/** The same print as a white silhouette (for masks). */
export function graphicMask(c: Ctx, kind: string, cx: number, cy: number, w: number, textIn = ''): string {
  let out = ''
  for (const l of graphicLayers(kind, cx, cy, w, textIn, c.paint.lw)) {
    if (l.tone === 'shade') continue
    if (l.stroke) out += el('path', { d: l.d, fill: 'none', stroke: '#fff', 'stroke-width': f(l.stroke), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
    else out += el('path', { d: l.d, fill: '#fff', stroke: l.outline && c.paint.lw > 0 ? '#fff' : undefined, 'stroke-width': l.outline && c.paint.lw > 0 ? f(c.paint.lw * 0.5) : undefined })
  }
  return out
}

/**
 * Shading laid over a print so it follows the garment's form: the far side of the torso
 * darkens across the print (a gradient in the torso's own coordinates, `x0`..`x1`), masked
 * to the print's silhouette. Baked stills only.
 */
export function printShade(c: Ctx, kind: string, cx: number, cy: number, w: number, textIn: string, fabric: string, x0: number, x1: number): string {
  if (!rich(c) || !tonal(c) || kind === 'none') return ''
  const P = c.paint
  const L = P.style.light
  const sc = shadowOf(fabric, 0.45)
  const box = { x: x0, y: cy - w, w: x1 - x0, h: w * 2 }
  const lit = L[0] < 0 ? 0 : 1
  const grad = P.linear(`ps${sc.slice(1)}${Math.round(x0)}${Math.round(x1)}${lit}`, [[0, sc, 0], [0.55, sc, 0], [1, sc, 0.42]], [lit, 0.5], [1 - lit, 0.5], box)
  // The shaded rect covers only the print (text runs up to 1.1 × w wide); the mask cuts it
  // to the print's silhouette and the gradient spans the torso, x0..x1.
  const r = { x: cx - w * 0.6, y: cy - w * 0.6, w: w * 1.2, h: w * 1.2 }
  const maskId = c.defs.unique('pm')
  c.defs.put(maskId, el('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: f(r.x), y: f(r.y), width: f(r.w), height: f(r.h) }, graphicMask(c, kind, cx, cy, w, textIn)))
  return el('path', { d: `M${f(r.x)} ${f(r.y)}h${f(r.w)}v${f(r.h)}h${f(-r.w)}Z`, fill: grad, mask: url(maskId) })
}

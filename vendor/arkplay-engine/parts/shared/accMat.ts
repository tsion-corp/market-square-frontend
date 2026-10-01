/* Accessory materials: metal, gems, glass, pearls, plastic, leather, wood, feathers,
 * flowers and glows, built on the Painter so every colour is graded and every shape is
 * shaded and outlined by the art style.
 *
 * Three tiers of richness:
 *   0  flat shading or `detail: low` — flat fills and outlines only (icons, pixel art);
 *   1  standard (animation frames) — one gradient or a couple of cheap overlays per piece;
 *   2  baked stills — lit edges, crisp speculars, facets, inner glows, soft blur glows.
 * The light comes from `paint.style.light`; nothing here invents its own light. */

import { highlightOf, mix, shadowOf, toLch } from '../../core/color.ts'
import { lerp, type Box, type P } from '../../core/math.ts'
import { circle, ellipse, f, poly, smooth, type SP } from '../../core/path.ts'
import { hash32 } from '../../core/rng.ts'
import { el, g, url } from '../../core/svg.ts'
import type { Ctx } from '../../render/context.ts'
import { motionClass, motionPhase } from '../../render/motion.ts'
import { pathBounds, type ShapeOpts } from '../../render/painter.ts'

export type Tier = 0 | 1 | 2

/** How much material detail to draw (see the file comment). */
export function tier(c: Ctx): Tier {
  const s = c.paint.style
  if (s.shading === 'flat' || s.detail === 0) return 0
  return s.baked ? 2 : 1
}

/** Unit vector toward the light (x right, y down; y is negative for a light above). */
export const lightOf = (c: Ctx): P => c.paint.style.light

const lkey = (c: Ctx): string => {
  const L = lightOf(c)
  return `${Math.round(L[0] * 10)}_${Math.round(L[1] * 10)}`
}

/** Hex key fragment. */
const hk = (hex: string): string => hex.replace('#', '')

/** Rough bounds of several path strings. */
export function boundsOf(...ds: string[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const d of ds) {
    if (!d) continue
    const b = pathBounds(d)
    if (!b.w && !b.h) continue
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 }
}

/* ---- Metal ---------------------------------------------------------------------- */

export type MetalTone = 'gold' | 'silver' | 'bronze' | 'steel' | 'dark' | 'tint'

export function metalTone(hex: string): MetalTone {
  const c = toLch(hex)
  if (c.l < 0.33) return 'dark'
  if (c.c < 0.045) return c.l > 0.72 ? 'silver' : 'steel'
  if (c.h > 70 && c.h < 115 && c.l > 0.6) return 'gold'
  if (c.h > 25 && c.h <= 115) return 'bronze'
  return 'tint'
}

/**
 * Environment-reflection paint for a metal: a bright sky band on the side toward the light,
 * a dark horizon band across the middle and a warm ground bounce on the far side — the
 * classic read of polished metal. One gradient per colour and light direction.
 */
export function metalPaint(c: Ctx, hex: string, axis: 'light' | 'v' | 'h' = 'light'): string | undefined {
  if (tier(c) === 0) return undefined
  const L = lightOf(c)
  const tone = metalTone(hex)
  const rig = c.paint.rig
  // Sky from the scene's key/rim light, ground from its bounce light.
  const sky = mix(tone === 'gold' ? '#fff4d0' : tone === 'bronze' ? '#ffe2c4' : tone === 'dark' ? '#9aa6c8' : '#f2f6ff', rig.rim, 0.3)
  const ground = mix(tone === 'silver' || tone === 'steel' ? '#d8c8b0' : tone === 'dark' ? '#5a4e5e' : highlightOf(hex, 0.25), rig.bounce, 0.35)
  const [from, to]: [P, P] =
    axis === 'v' ? [[0.5 + L[0] * 0.15, 0], [0.5 - L[0] * 0.15, 1]] : axis === 'h' ? [[0, 0.5], [1, 0.5]] : [[0.5 + L[0] * 0.45, 0.5 + L[1] * 0.55], [0.5 - L[0] * 0.45, 0.5 - L[1] * 0.55]]
  // Warm metals darken toward a deep amber (never toward grey-brown mud); cool ones toward
  // the Painter's cool shadow.
  const warm = tone === 'gold' || tone === 'bronze'
  const dark = (k: number) => (warm ? mix(hex, tone === 'gold' ? '#8a4b00' : '#5a2a10', k * 1.6) : shadowOf(hex, k))
  const hor = tone === 'dark' ? 0.16 : 0.26
  return c.paint.linear(`mt${hk(hex)}${hk(sky)}${axis}${lkey(c)}`, [
    [0, mix(highlightOf(hex, 0.5), sky, 0.45)],
    [0.22, highlightOf(hex, 0.2)],
    [0.44, hex],
    [0.53, dark(hor)],
    [0.62, dark(hor * 0.4)],
    [0.84, mix(hex, ground, 0.3)],
    [1, dark(0.12)],
  ], from, to)
}

/**
 * A polished metal piece. Baked: the Painter's metal material (environment bands, hard
 * specular) plus a crisp lit rim and a specular star. Standard: an environment-band
 * gradient under the cel shading and a small specular. Flat: a flat fill.
 */
export function metal(c: Ctx, d: string, hex: string, o: ShapeOpts & { axis?: 'light' | 'v' | 'h' } = {}): string {
  if (!d) return ''
  const P = c.paint
  const t = tier(c)
  const specK = o.spec ?? 1
  if (t === 0) return P.shape(d, hex, { ...o, material: 'metal', spec: 0 })
  if (t === 2) {
    // The env-band paint keeps small pieces reading as metal (the Painter's bands need detail 2).
    let out = P.shape(d, hex, { shade: 0.8, ...o, material: 'metal', spec: Math.min(1, 0.9 * specK), paint: o.paint ?? (P.detail < 2 ? metalPaint(c, hex, o.axis) : undefined) })
    const bb = pathBounds(d)
    const s = Math.min(bb.w, bb.h)
    if (s > 1.2) out += litEdge(c, d, highlightOf(hex, 0.6), Math.max(0.5, s * 0.06), 0.7, bb)
    if (specK > 0 && s > 2.5) {
      const L = lightOf(c)
      out += glint(c, bb.x + bb.w * (0.5 + L[0] * 0.3), bb.y + bb.h * (0.5 + L[1] * 0.3), Math.max(Math.min(s * 0.18, 2.5 + s * 0.05), 1.2) * specK, 0.95)
    }
    return out
  }
  let out = P.shape(d, hex, { shade: 0.7, ...o, material: 'metal', paint: o.paint ?? metalPaint(c, hex, o.axis) })
  if (specK > 0) {
    const bb = pathBounds(d)
    const s = Math.min(bb.w, bb.h)
    const L = lightOf(c)
    const k = Math.min(s * 0.1, 1.5 + s * 0.035)
    if (s > 3) out += P.flat(ellipse(bb.x + bb.w * (0.5 + L[0] * 0.28), bb.y + bb.h * (0.5 + L[1] * 0.3), k, k * 0.6), '#ffffff', 0.75)
  }
  return out
}

/**
 * A thin crescent of light along the edge of `d` that faces the light (baked only): the
 * shape minus itself shifted away from the light, clipped to the shape.
 */
export function litEdge(c: Ctx, d: string, color: string, width: number, opacity = 0.8, bb: Box = pathBounds(d)): string {
  if (tier(c) < 2 || !d) return ''
  const L = lightOf(c)
  const pad = width * 2 + 2
  const clipId = clipOf(c, d)
  return g(
    { 'clip-path': url(clipId) },
    el('path', {
      d: `M${f(bb.x - pad)} ${f(bb.y - pad)}h${f(bb.w + pad * 2)}v${f(bb.h + pad * 2)}h${f(-(bb.w + pad * 2))}Z ${d}`,
      fill: c.paint.col(color),
      'fill-rule': 'evenodd',
      'fill-opacity': opacity < 1 ? f(opacity) : undefined,
      transform: `translate(${f(-L[0] * width)} ${f(-L[1] * width)})`,
    }),
  )
}

/** A crisp four-point specular star with a soft core. */
export function glint(c: Ctx, x: number, y: number, r: number, opacity = 1, color = '#ffffff'): string {
  if (r <= 0.3) return ''
  const P = c.paint
  const i = r * 0.16
  const star = `M${f(x)} ${f(y - r)}Q${f(x + i)} ${f(y - i)} ${f(x + r * 0.72)} ${f(y)}Q${f(x + i)} ${f(y + i)} ${f(x)} ${f(y + r)}Q${f(x - i)} ${f(y + i)} ${f(x - r * 0.72)} ${f(y)}Q${f(x - i)} ${f(y - i)} ${f(x)} ${f(y - r)}Z`
  return P.flat(circle(x, y, r * 0.42), color, opacity * 0.35) + P.flat(star, color, opacity)
}

/** A small crisp white highlight (plastic, lacquer, candy, lenses). */
export function spec(c: Ctx, x: number, y: number, rx: number, ry: number, opacity = 0.85, rot = -30): string {
  if (tier(c) === 0 || rx < 0.3) return ''
  return c.paint.flat(rotEllipse(x, y, rx, ry, rot), '#ffffff', opacity)
}

/** An ellipse rotated by `deg`, as plain path data (no transform, so part bounds stay true). */
export function rotEllipse(cx: number, cy: number, rx: number, ry: number, deg: number): string {
  const a = (deg * Math.PI) / 180
  const dx = Math.cos(a) * rx
  const dy = Math.sin(a) * rx
  return `M${f(cx + dx)} ${f(cy + dy)}A${f(rx)} ${f(ry)} ${f(deg)} 1 0 ${f(cx - dx)} ${f(cy - dy)}A${f(rx)} ${f(ry)} ${f(deg)} 1 0 ${f(cx + dx)} ${f(cy + dy)}Z`
}

/* ---- Spheres: pearls, orbs, balloons, beads ------------------------------------- */

export type SphereKind = 'pearl' | 'gloss' | 'matte' | 'glass' | 'metal'

/** Radial sphere paint lit from the style's light (one def per colour, kind and light). */
export function spherePaint(c: Ctx, hex: string, kind: SphereKind = 'gloss'): string {
  const P = c.paint
  const L = lightOf(c)
  const col = P.col(hex)
  const id = c.defs.add(`sp${hk(col)}${kind}${lkey(c)}`, (gid) => {
    const hi = kind === 'pearl' ? mix(col, '#ffffff', 0.75) : highlightOf(col, kind === 'matte' ? 0.18 : 0.35)
    const lo = kind === 'pearl' ? mix(shadowOf(col, 0.22), '#b9a6d6', 0.25) : shadowOf(col, kind === 'glass' ? 0.1 : 0.3)
    const rim = kind === 'pearl' ? mix(col, '#ffd9ec', 0.3) : kind === 'glass' ? highlightOf(col, 0.3) : kind === 'metal' ? highlightOf(col, 0.2) : shadowOf(col, 0.18)
    return el(
      'radialGradient',
      { id: gid, cx: 0.5, cy: 0.5, r: 0.5, fx: f(0.5 + L[0] * 0.28), fy: f(0.5 + L[1] * 0.28) },
      el('stop', { offset: 0, 'stop-color': P.col(hi) }),
      el('stop', { offset: 0.45, 'stop-color': col }),
      el('stop', { offset: 0.86, 'stop-color': P.col(lo) }),
      el('stop', { offset: 1, 'stop-color': P.col(rim) }),
    )
  })
  return url(id)
}

export function sphere(c: Ctx, cx: number, cy: number, r: number, hex: string, kind: SphereKind = 'gloss', o: ShapeOpts = {}): string {
  const P = c.paint
  const t = tier(c)
  const d = circle(cx, cy, r)
  if (t === 0) return P.shape(d, hex, { ...o, spec: 0 })
  const L = lightOf(c)
  let out = P.shape(d, hex, { ...o, shade: false, spec: 0, paint: spherePaint(c, hex, kind) })
  if (kind !== 'matte' && r > 1) {
    out += spec(c, cx + L[0] * r * 0.42, cy + L[1] * r * 0.42, r * 0.22, r * 0.13, kind === 'pearl' ? 0.8 : 0.9, Math.atan2(L[1], L[0]) * (180 / Math.PI) + 90)
    if (t === 2 && r > 3) out += P.flat(rotEllipse(cx - L[0] * r * 0.52, cy - L[1] * r * 0.52, r * 0.2, r * 0.09, Math.atan2(L[1], L[0]) * (180 / Math.PI) + 90), '#ffffff', kind === 'glass' ? 0.45 : 0.22)
  }
  return out
}

/* ---- Gems ------------------------------------------------------------------------ */

export type GemCut = 'round' | 'oval' | 'square' | 'drop' | 'heart' | 'marquise'

/**
 * A cut gem seen from above: girdle, table, facets that brighten toward the light, an
 * inner glow on the far side (light passing through) and, baked, a sparkle.
 */
export function gem(c: Ctx, cx: number, cy: number, r: number, hex: string, o: { cut?: GemCut; ry?: number; outline?: number; sparkle?: boolean; rot?: number } = {}): string {
  const P = c.paint
  const t = tier(c)
  const ry = o.ry ?? r
  const cut = o.cut ?? 'round'
  const L = lightOf(c)
  const n = cut === 'square' ? 4 : r < 3 ? 6 : 8
  const rot = (o.rot ?? 0) + (cut === 'square' ? Math.PI / 4 : -Math.PI / 2)
  const girdle: P[] = []
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2
    let k = 1
    if (cut === 'drop') k = 1 + Math.max(0, -Math.sin(a)) * 0.45
    if (cut === 'marquise') k = 1 + Math.abs(Math.sin(a)) * 0.5
    girdle.push([cx + Math.cos(a) * r * (cut === 'marquise' ? 0.7 : 1), cy + Math.sin(a) * ry * k - (cut === 'drop' ? ry * 0.2 : 0)])
  }
  const outlineD = cut === 'round' || cut === 'oval' ? ellipse(cx, cy, r, ry) : poly(girdle)
  const body = P.shape(outlineD, hex, { shade: false, outline: o.outline ?? 0.6, material: 'gem', spec: 0 })
  if (t === 0) return body
  const table: P[] = girdle.map(([x, y]) => [cx + (x - cx) * 0.52, cy + (y - cy) * 0.52])
  const bright = (x: number, y: number) => {
    const dx = x - cx
    const dy = y - cy
    const l = Math.hypot(dx, dy) || 1
    return (dx * L[0] + dy * L[1]) / l
  }
  let lit = ''
  let dark = ''
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const tri = poly([girdle[i], girdle[j], table[i]]) + poly([table[i], girdle[j], table[j]])
    const mx = (girdle[i][0] + girdle[j][0]) / 2
    const my = (girdle[i][1] + girdle[j][1]) / 2
    const b = bright(mx, my)
    if (b > 0.25) lit += poly([girdle[i], girdle[j], table[i]])
    else if (b < -0.25) dark += tri
    else if (t === 2) dark += poly([table[i], girdle[j], table[j]])
  }
  let out = body + P.flat(dark, shadowOf(hex, 0.3), 0.75) + P.flat(lit, highlightOf(hex, 0.35), 0.85)
  // Table: lighter, with the inner glow where the light exits (the far side).
  out += P.flat(poly(table), highlightOf(hex, 0.18), 0.9)
  if (t === 2) {
    out += P.flat(circle(cx - L[0] * r * 0.35, cy - L[1] * ry * 0.35, Math.min(r, ry) * 0.38), mix(highlightOf(hex, 0.5), '#ffffff', 0.2), 0.45)
    if (r > 1.5) out += P.line(poly(table), highlightOf(hex, 0.55), Math.max(0.3, r * 0.05), { opacity: 0.7 })
    if (o.sparkle !== false && r > 1.2) out += glint(c, cx + L[0] * r * 0.45, cy + L[1] * ry * 0.45, r * 0.75, 0.95)
  } else {
    out += spec(c, cx + L[0] * r * 0.35, cy + L[1] * ry * 0.35, r * 0.18, r * 0.12, 0.9)
  }
  return out
}

/* ---- Glass and lenses ------------------------------------------------------------- */

/**
 * A lens: tinted glass (or dark shades) with a gradient from the frame top, diagonal
 * reflections of the sky clipped to the lens and, baked, a bright refraction rim.
 */
export function lens(c: Ctx, d: string, tint: string, o: { dark?: boolean; alpha?: number; streaks?: boolean } = {}): string {
  const P = c.paint
  const t = tier(c)
  const dark = !!o.dark
  const alpha = o.alpha ?? (dark ? 0.94 : 0.22)
  if (t === 0) return P.flat(d, tint, alpha)
  const bb = pathBounds(d)
  const L = lightOf(c)
  const top = dark ? shadowOf(tint, 0.35) : shadowOf(tint, 0.1)
  const bottom = dark ? highlightOf(tint, 0.22) : highlightOf(tint, 0.25)
  const paint = P.linear(`ln${hk(tint)}${dark ? 'd' : 'c'}${Math.round(alpha * 100)}`, [[0, top, alpha], [0.55, tint, alpha], [1, bottom, alpha * (dark ? 1 : 0.8)]], [0.5, 0], [0.5, 1])
  let out = el('path', { d, fill: paint })
  const s = Math.min(bb.w, bb.h)
  if (s < 2) return out
  // Sky reflections: two parallel diagonal bands, slanted against the light.
  const ang = L[0] <= 0 ? -1 : 1
  const band = (u: number, w: number) => {
    const x0 = bb.x + bb.w * u
    const sk = bb.h * 0.55 * ang
    return poly([[x0 - sk, bb.y - 1], [x0 - sk + w, bb.y - 1], [x0 + sk + w, bb.y + bb.h + 1], [x0 + sk, bb.y + bb.h + 1]])
  }
  const u0 = L[0] <= 0 ? 0.3 : 0.62
  const streaks = band(u0, bb.w * 0.16) + band(u0 + 0.22 * (L[0] <= 0 ? 1 : -1), bb.w * 0.06)
  if (t === 2 && o.streaks !== false) {
    const clipId = clipOf(c, d)
    out += g(
      { 'clip-path': url(clipId) },
      el('path', { d: streaks, fill: P.col('#ffffff'), 'fill-opacity': dark ? 0.2 : 0.3 }),
      // Sky glare fading down from the top edge.
      el('path', { d: `M${f(bb.x)} ${f(bb.y)}h${f(bb.w)}v${f(bb.h * 0.42)}h${f(-bb.w)}Z`, fill: P.linear(dark ? 'lnskyd' : 'lnskyc', [[0, '#ffffff', dark ? 0.22 : 0.3], [1, '#ffffff', 0]], [0.5, 0], [0.5, 1]) }),
    )
    out += litEdge(c, d, dark ? highlightOf(tint, 0.6) : '#ffffff', Math.max(0.5, s * 0.06), 0.55, bb)
  } else if (o.streaks !== false) {
    const cx = bb.x + bb.w * (0.5 + L[0] * 0.22)
    const cy = bb.y + bb.h * (0.5 + L[1] * 0.25)
    out += P.flat(rotEllipse(cx, cy, s * 0.16, s * 0.07, ang * -40), '#ffffff', dark ? 0.45 : 0.55)
  }
  return out
}

/** A highlight along the lit side of a round frame (rx, ry) — frame shine. */
export function litArc(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, width: number, span = 1.1): string {
  if (tier(c) === 0) return ''
  const L = lightOf(c)
  const a = Math.atan2(L[1] * rx, L[0] * ry)
  const a0 = a - span / 2
  const a1 = a + span / 2
  const p0: P = [cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry]
  const p1: P = [cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry]
  return c.paint.line(`M${f(p0[0])} ${f(p0[1])}A${f(rx)} ${f(ry)} 0 0 1 ${f(p1[0])} ${f(p1[1])}`, color, width, { opacity: 0.9 })
}

/* ---- Soft glows ------------------------------------------------------------------ */

/**
 * Baked: blurs `content` into a soft bloom. The filter region is user space and covers
 * `box` (the drawing's own bounds), so the layer is never empty on the canvas whenever the
 * part that carries it is drawn (resvg panics on empty filter layers). Standard: ''.
 */
export function bloom(c: Ctx, content: string, box: Box, std: number): string {
  if (!content || tier(c) < 2 || std <= 0) return ''
  const pad = std * 3
  const sd = Math.max(0.5, Math.round(std * 4) / 4)
  const x = Math.floor(box.x - pad)
  const y = Math.floor(box.y - pad)
  const w = Math.ceil(box.w + pad * 2)
  const h = Math.ceil(box.h + pad * 2)
  const id = c.defs.add(`ab${f(sd).replace('.', 'p')}_${x}_${y}_${w}_${h}`.replace(/-/g, 'm'), (fid) =>
    el('filter', { id: fid, filterUnits: 'userSpaceOnUse', x, y, width: w, height: h, 'color-interpolation-filters': 'sRGB' }, el('feGaussianBlur', { stdDeviation: f(sd) })),
  )
  return g({ filter: url(id) }, content)
}

/** Radial glow in every tier above 0 (cheap; baked callers may add a `bloom` on top). */
export function halo(c: Ctx, x: number, y: number, r: number, color: string, opacity = 0.5): string {
  if (tier(c) === 0) return ''
  return c.paint.glow(x, y, r, color, opacity)
}

/* ---- Soft cast shadows ----------------------------------------------------------- */

/**
 * A shadow an accessory casts on the wearer (brims, straps, pendants). With `fade`, the
 * shadow fades out along that object-bounding-box direction (a brim shadow is darkest
 * right under the brim); baked shadows without a fade get a soft blurred edge.
 */
export function castShadow(c: Ctx, d: string, opacity = 0.22, fade?: [P, P]): string {
  const t = tier(c)
  if (t === 0 || !d) return ''
  const col = mix('#2a1c3c', c.paint.rig.fill, 0.25)
  if (fade) {
    const key = `cs${Math.round(opacity * 100)}${fade.flat().map((v) => Math.round(v * 10)).join('')}`
    return el('path', { d, fill: c.paint.linear(key, [[0, col, opacity], [0.6, col, opacity * 0.45], [1, col, 0]], fade[0], fade[1]) })
  }
  if (t === 2) {
    const bb = pathBounds(d)
    const std = Math.max(0.6, Math.min(bb.w, bb.h) * 0.12)
    return bloom(c, c.paint.flat(d, col, opacity * 1.15), bb, std)
  }
  return c.paint.flat(d, col, opacity)
}

/** A clip path for `d`, shared by identical shapes. */
export function clipOf(c: Ctx, d: string): string {
  return c.defs.add(`acl${hash32(d).toString(36)}`, (id) => el('clipPath', { id }, el('path', { d })))
}

/* ---- Fibres: stitching, grain, fur ------------------------------------------------ */

/** Dashed stitching along a line (leather, denim, fabric seams). */
export function stitch(c: Ctx, d: string, hex: string, w: number, light = false): string {
  if (tier(c) === 0 || c.paint.detail < 2 || !d) return ''
  return c.paint.line(d, light ? highlightOf(hex, 0.45) : shadowOf(hex, 0.35), w, { dash: `${f(w * 2.2)} ${f(w * 1.8)}`, opacity: 0.85, cap: 'butt' })
}

/** Wood grain: a few long, slightly wavy lines along a stick from a to b. */
export function grain(c: Ctx, a: P, b: P, width: number, hex: string, seed = 0): string {
  if (tier(c) === 0 || c.paint.detail < 2) return ''
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L = Math.hypot(dx, dy) || 1
  const nx = -dy / L
  const ny = dx / L
  let d = ''
  for (let k = 0; k < 3; k++) {
    const off = (k - 1) * width * 0.28
    const t0 = 0.08 + ((seed + k * 0.37) % 0.25)
    const t1 = 0.62 + ((seed * 1.7 + k * 0.23) % 0.3)
    const w = width * 0.07 * (k % 2 ? -1 : 1)
    const p0: P = [a[0] + dx * t0 + nx * off, a[1] + dy * t0 + ny * off]
    const pm: P = [a[0] + dx * (t0 + t1) * 0.5 + nx * (off + w), a[1] + dy * (t0 + t1) * 0.5 + ny * (off + w)]
    const p1: P = [a[0] + dx * t1 + nx * off, a[1] + dy * t1 + ny * off]
    d += `M${f(p0[0])} ${f(p0[1])}Q${f(pm[0])} ${f(pm[1])} ${f(p1[0])} ${f(p1[1])}`
  }
  return c.paint.line(d, shadowOf(hex, 0.3), Math.max(0.3, width * 0.07), { opacity: 0.7 })
}

/** Short fur strokes fanning from the base of an ear toward its tip. */
export function furTufts(c: Ctx, base: P, tip: P, width: number, hex: string, count = 4): string {
  if (tier(c) === 0) return ''
  let d = ''
  for (let i = 0; i < count; i++) {
    const u = count === 1 ? 0.5 : i / (count - 1)
    const x0 = base[0] + (u - 0.5) * width
    const y0 = base[1]
    const x1 = lerp(x0, tip[0], 0.55 + (i % 2) * 0.12)
    const y1 = lerp(y0, tip[1], 0.55 + (i % 2) * 0.12)
    d += `M${f(x0)} ${f(y0)}Q${f(lerp(x0, x1, 0.5) + (u - 0.5) * width * 0.3)} ${f(lerp(y0, y1, 0.5))} ${f(x1)} ${f(y1)}`
  }
  return c.paint.line(d, hex, Math.max(0.4, width * 0.09), { opacity: 0.9 })
}

/* ---- Feathers, leaves, petals ------------------------------------------------------ */

/** Geometry of one feather: its vane outline and its shaft (rachis). */
export function featherGeo(root: P, tip: P, width: number, curl = 0.12): { vane: string; rachis: string; at: (u: number, side: number, w: number) => SP } {
  const dx = tip[0] - root[0]
  const dy = tip[1] - root[1]
  const L = Math.hypot(dx, dy) || 1
  const nx = -dy / L
  const ny = dx / L
  const at = (u: number, side: number, w: number): SP => {
    const bend = Math.sin(u * Math.PI) * curl * L
    return [root[0] + dx * u + nx * (side * w + bend), root[1] + dy * u + ny * (side * w + bend)]
  }
  const W = width / 2
  const vane = smooth([at(0.04, 0, 0), at(0.2, 1, W * 0.8), at(0.55, 1, W), at(0.85, 1, W * 0.6), [tip[0], tip[1], 0], at(0.85, -1, W * 0.55), at(0.55, -1, W * 0.85), at(0.2, -1, W * 0.7)])
  const r0 = at(0, 0, 0)
  const rm = at(0.5, 0, 0)
  const r1 = at(0.96, 0, 0)
  const rachis = `M${f(r0[0])} ${f(r0[1])}Q${f(rm[0] + nx * curl * L * 0.1)} ${f(rm[1] + ny * curl * L * 0.1)} ${f(r1[0])} ${f(r1[1])}`
  return { vane, rachis, at }
}

/** One feather from `root` to `tip`: vane, rachis, barb splits and a soft sheen. */
export function feather(c: Ctx, root: P, tip: P, width: number, hex: string, o: ShapeOpts & { curl?: number } = {}): string {
  const P = c.paint
  const t = tier(c)
  const L = Math.hypot(tip[0] - root[0], tip[1] - root[1])
  const { vane, rachis, at } = featherGeo(root, tip, width, o.curl ?? 0.12)
  // Standard frames: one outlined fill (no per-feather shading layers).
  let out = P.shape(vane, hex, { material: 'feathers', ...o, shade: t === 2 ? o.shade : false })
  if (t === 0) return out
  out += P.line(rachis, shadowOf(hex, 0.3), Math.max(0.4, width * 0.06))
  if (t === 2 && c.paint.detail > 1 && L > 8) {
    const W = width / 2
    // Barb splits: short notches cut into the vane edge.
    let d = ''
    for (const [u, side] of [[0.35, 1], [0.62, -1], [0.72, 1]] as [number, number][]) {
      const e = at(u, side, W * 0.95)
      const m = at(u - 0.08, side, W * 0.35)
      d += `M${f(e[0])} ${f(e[1])}L${f(m[0])} ${f(m[1])}`
    }
    out += P.line(d, shadowOf(hex, 0.22), Math.max(0.35, width * 0.05), { opacity: 0.8 })
    const s0 = at(0.3, 1, W * 0.45)
    const s1 = at(0.75, 1, W * 0.35)
    out += P.line(`M${f(s0[0])} ${f(s0[1])}L${f(s1[0])} ${f(s1[1])}`, highlightOf(hex, 0.45), Math.max(0.4, width * 0.12), { opacity: 0.55 })
  }
  return out
}

/** A leaf from `base` pointing along `ang` (radians). */
export function leaf(c: Ctx, x: number, y: number, len: number, ang: number, hex: string, o: ShapeOpts = {}): string {
  const P = c.paint
  const ux = Math.cos(ang)
  const uy = Math.sin(ang)
  const w = len * 0.36
  const pt = (u: number, v: number): SP => [x + ux * len * u - uy * w * v, y + uy * len * u + ux * w * v]
  const d = smooth([[x, y, 0], pt(0.35, 0.55), pt(0.75, 0.35), [x + ux * len, y + uy * len, 0], pt(0.75, -0.35), pt(0.35, -0.55)])
  let out = P.shape(d, hex, { outline: 0.5, shade: tier(c) === 2 ? 0.6 : false, ...o })
  if (tier(c) > 0 && len > 4) out += P.line(`M${f(x)} ${f(y)}L${f(x + ux * len * 0.8)} ${f(y + uy * len * 0.8)}`, shadowOf(hex, 0.3), Math.max(0.3, len * 0.04), { opacity: 0.8 })
  return out
}

/**
 * A flower: teardrop petals with a darker throat and lighter tips, a textured centre and,
 * baked, a soft highlight on the petals facing the light.
 */
export function flower(c: Ctx, x: number, y: number, r: number, hex: string, center: string, o: { petals?: number; rot?: number; outline?: number } = {}): string {
  const P = c.paint
  const t = tier(c)
  const n = o.petals ?? 5
  const rot = o.rot ?? -Math.PI / 2
  const L = lightOf(c)
  if (t === 0 || r < 2) {
    const d = Array.from({ length: n }, (_, k) => circle(x + Math.cos(rot + (k / n) * Math.PI * 2) * r * 0.55, y + Math.sin(rot + (k / n) * Math.PI * 2) * r * 0.55, r * 0.5)).join('')
    return P.shape(d, hex, { shade: false, outline: o.outline ?? 0.5 }) + P.flat(circle(x, y, r * 0.3), center)
  }
  const petals: string[] = []
  const tips: string[] = []
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const w = r * (n > 6 ? 0.42 : 0.62)
    const pt = (u: number, v: number): SP => [x + ux * r * u - uy * w * v, y + uy * r * u + ux * w * v]
    petals.push(smooth([[x, y, 0.2], pt(0.45, 0.8), pt(0.92, 0.55), pt(1.05, 0), pt(0.92, -0.55), pt(0.45, -0.8)]))
    if (ux * L[0] + uy * L[1] > -0.2) tips.push(smooth([pt(0.62, 0.35), pt(0.9, 0.3), pt(0.96, 0), pt(0.9, -0.3), pt(0.62, -0.35)]))
  }
  // One shape for all petals: the overlapping outlines read as petal separations.
  let out = P.shape(petals.join(''), hex, { outline: o.outline ?? 0.5, shade: t === 2 ? 0.6 : false })
  out += P.flat(circle(x, y, r * 0.5), shadowOf(hex, 0.25), 0.45)
  if (t === 2) out += P.flat(tips.join(''), highlightOf(hex, 0.4), 0.55)
  out += P.shape(circle(x, y, r * 0.28), center, { outline: 0.4, shade: t === 2 ? 0.6 : false })
  if (t === 2 && r > 4) {
    const dots = [0, 1, 2, 3, 4].map((k) => circle(x + Math.cos(k * 1.26) * r * 0.14, y + Math.sin(k * 1.26) * r * 0.14, r * 0.04)).join('')
    out += P.flat(dots, shadowOf(center, 0.35), 0.8) + P.flat(circle(x + L[0] * r * 0.1, y + L[1] * r * 0.1, r * 0.09), highlightOf(center, 0.5), 0.8)
  }
  return out
}

/* ---- Fabric -------------------------------------------------------------------- */

/** Soft fold lines (shadow with a highlight beside it) along the given strokes. */
export function folds(c: Ctx, d: string, hex: string, w: number): string {
  if (tier(c) === 0 || !d) return ''
  const L = lightOf(c)
  const P = c.paint
  const off = w * 0.9
  return P.line(d, shadowOf(hex, 0.28), w, { opacity: 0.7 }) + (tier(c) === 2 ? g({ transform: `translate(${f(L[0] * off)} ${f(L[1] * off)})` }, P.line(d, highlightOf(hex, 0.3), w * 0.6, { opacity: 0.5 })) : '')
}


/* ---- Ambient motion (stills with ctx.motion) ---------------------------------- */

/** Shared keyframes for effect-like details (one definition per kind per document). */
const MOTIONS = {
  breathe: { key: 'fx-breathe', frames: '0%,100%{transform:scale(.93);opacity:.78}50%{transform:scale(1.05);opacity:1}', duration: 3.2, timing: 'ease-in-out', origin: 'center' },
  twinkle: { key: 'fx-twinkle', frames: '0%,100%{transform:scale(.35) rotate(-15deg);opacity:.25}50%{transform:scale(1.08) rotate(12deg);opacity:1}', duration: 1.9, timing: 'ease-in-out', origin: 'center' },
  flicker: { key: 'fx-flicker', frames: '0%,100%{transform:scale(1,1) skewX(0deg)}25%{transform:scale(.94,1.14) skewX(4deg)}50%{transform:scale(1.04,.88) skewX(-3deg)}75%{transform:scale(.97,1.08) skewX(2deg)}', duration: 1.2, timing: 'ease-in-out', origin: '50% 100%' },
  bob: { key: 'fx-bob', frames: '0%,100%{transform:translate(0,0);opacity:.9}50%{transform:translate(0,-3%);opacity:1}', duration: 3.6, timing: 'ease-in-out', origin: 'center' },
  /** A hovering object's shadow: smaller and fainter while the object is up (pairs with bob). */
  hover: { key: 'fx-hover', frames: '0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.8);opacity:.65}', duration: 3.6, timing: 'ease-in-out', origin: 'center' },
} as const

export type MotionKind = keyof typeof MOTIONS

/** The class for a shared motion kind ('' when motion is off). */
export function motionOf(c: Ctx, kind: MotionKind): string {
  const m = MOTIONS[kind]
  return motionClass(c, m.key, m.frames, { duration: m.duration, timing: m.timing, origin: m.origin })
}

/**
 * Wraps `svg` in a <g> that plays `kind` (stills with motion only). `phase` offsets it in
 * its loop, `speed` scales its duration. The wrapper has no transform attribute.
 */
export function moving(c: Ctx, kind: MotionKind, svg: string, phase = 0, speed = 1): string {
  if (!svg || !c.motion) return svg
  const cls = motionOf(c, kind)
  const dur = MOTIONS[kind].duration / speed
  return `<g class="${cls}" style="animation-duration:${f(dur)}s;${motionPhase(phase * dur)}">${svg}</g>`
}

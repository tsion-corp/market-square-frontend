/* One eye, fully parametric. Shared by humanoids and creatures.
 *
 * The eye is two lid curves over a sclera, an iris and pupil clipped inside, highlights
 * on top, and a lash line. Closing is the upper lid descending onto the lower one;
 * smiling is the lower lid rising; anger drops the inner lid, sadness the outer — so
 * every expression and every blink works on every eye style.
 *
 * Two budgets: the standard path (animation frames, rebuilt every frame) stays close to
 * a dozen elements per eye; the baked path (`ctx.baked`, still images) adds iris fibres,
 * a wet bloom around the catchlight, a graded lid shadow, lower lashes and lid form.
 * Every gradient and clip is keyed by its content, so frames reuse their defs.
 *
 * This file also hosts the small soft-paint helpers (radial/linear gradient paints and
 * soft spots) that the face, head and mouth share, and the expression effects (tears,
 * sweat, anger mark, zzz, steam) that any face can draw. */

import { fromLch, highlightOf, isDark, mix, shadowOf, toLch } from '../../core/color.ts'
import { clamp, lerp, TAU, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, heart, poly, roundRect, sampleSmooth, smooth, sparkle, star, type SP } from '../../core/path.ts'
import { hash32 } from '../../core/rng.ts'
import { el, g, url } from '../../core/svg.ts'
import type { Ctx } from '../../render/context.ts'
import type { EyeMode } from '../../render/types.ts'

export interface EyeStyle {
  ratio: number
  peak: number
  upPow: number
  low: number
  tilt: number
  crease: 'fold' | 'hood' | 'none'
  widthMul: number
  iris: number
  lid: number
  special?: 'dot' | 'button' | 'bug' | 'visor'
}

export const EYE_STYLES: Record<string, EyeStyle> = {
  almond: { ratio: 0.58, peak: 0.42, upPow: 0.9, low: 0.5, tilt: 0.06, crease: 'fold', widthMul: 1, iris: 0.9, lid: 1 },
  round: { ratio: 0.8, peak: 0.5, upPow: 0.8, low: 0.72, tilt: 0, crease: 'fold', widthMul: 0.95, iris: 0.82, lid: 1 },
  big: { ratio: 0.95, peak: 0.46, upPow: 0.75, low: 0.8, tilt: 0.02, crease: 'none', widthMul: 1.22, iris: 0.92, lid: 1.35 },
  narrow: { ratio: 0.38, peak: 0.45, upPow: 1, low: 0.38, tilt: 0.04, crease: 'none', widthMul: 1, iris: 1, lid: 1 },
  hooded: { ratio: 0.5, peak: 0.5, upPow: 1.1, low: 0.5, tilt: 0, crease: 'hood', widthMul: 1, iris: 0.92, lid: 1 },
  monolid: { ratio: 0.46, peak: 0.52, upPow: 1.35, low: 0.48, tilt: 0.05, crease: 'none', widthMul: 1, iris: 0.95, lid: 1 },
  upturned: { ratio: 0.56, peak: 0.44, upPow: 0.9, low: 0.48, tilt: 0.22, crease: 'fold', widthMul: 1, iris: 0.9, lid: 1 },
  downturned: { ratio: 0.56, peak: 0.52, upPow: 0.9, low: 0.55, tilt: -0.2, crease: 'fold', widthMul: 1, iris: 0.9, lid: 1 },
  sleepy: { ratio: 0.55, peak: 0.5, upPow: 1.2, low: 0.5, tilt: -0.04, crease: 'fold', widthMul: 1, iris: 0.95, lid: 1.2 },
  sharp: { ratio: 0.44, peak: 0.36, upPow: 1, low: 0.38, tilt: 0.2, crease: 'none', widthMul: 1.05, iris: 0.95, lid: 1.4 },
  cat: { ratio: 0.5, peak: 0.38, upPow: 0.9, low: 0.44, tilt: 0.18, crease: 'none', widthMul: 1.05, iris: 0.92, lid: 1.3 },
  dot: { ratio: 1, peak: 0.5, upPow: 1, low: 1, tilt: 0, crease: 'none', widthMul: 1, iris: 1, lid: 0, special: 'dot' },
  button: { ratio: 1, peak: 0.5, upPow: 1, low: 1, tilt: 0, crease: 'none', widthMul: 1, iris: 1, lid: 0, special: 'button' },
  // Creature-only styles.
  cute: { ratio: 1, peak: 0.47, upPow: 0.7, low: 0.85, tilt: 0, crease: 'none', widthMul: 1.2, iris: 0.95, lid: 1.2 },
  fierce: { ratio: 0.5, peak: 0.34, upPow: 1, low: 0.42, tilt: 0.24, crease: 'none', widthMul: 1.05, iris: 0.9, lid: 1.4 },
  bug: { ratio: 1, peak: 0.5, upPow: 1, low: 1, tilt: 0, crease: 'none', widthMul: 1.2, iris: 1, lid: 0, special: 'bug' },
  visor: { ratio: 0.5, peak: 0.5, upPow: 1, low: 1, tilt: 0, crease: 'none', widthMul: 1, iris: 1, lid: 0, special: 'visor' },
}

export interface EyeSpec {
  cx: number
  cy: number
  /** Eye width in world units. */
  w: number
  /** +1 when the outer corner is toward +x. */
  dir: number
  style: EyeStyle
  /** Extra tilt from the DNA slider, in units of eye width. */
  tilt: number
  open: number
  squint: number
  lookX: number
  lookY: number
  lidAngle: number
  mode: EyeMode
  iris: string
  sclera: string
  pupil: string
  irisScale: number
  sparkle: number
  lashes: number
  liner: number
  shadow: number
  shadowColor: string
  glow: boolean
  bags: number
  /** Colour the lids and lash line are derived from (skin or fur). */
  skin: string
  /** Squash horizontally for the profile view. */
  profile?: boolean
}

const LASH = '#221a20'
const WHITE = '#ffffff'

/* ---- Soft paint helpers (shared by the face, head and mouth) ------------------- */

/** A gradient stop: offset 0..1, colour, optional opacity. */
export type Stop = [number, string, number?]

/** A def key from content, so identical gradients and clips are emitted once per document. */
export const keyOf = (label: string, ...parts: (string | number)[]): string => `${label}${hash32(...parts).toString(36)}`

const stopsSVG = (c: Ctx, stops: Stop[]): string[] =>
  stops.map(([o, col, a]) => el('stop', { offset: f(o), 'stop-color': c.paint.col(col), 'stop-opacity': a !== undefined && a < 1 ? f(Math.max(0, a)) : undefined }))

/**
 * Radial gradient paint in objectBoundingBox units (it stretches with the shape, so one
 * def serves every shape and frame with the same colours). Colours go through the painter.
 */
export function radialPaint(c: Ctx, stops: Stop[], at: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number } = {}): string {
  const id = c.defs.add(keyOf('rg', JSON.stringify(stops), at.cx ?? -1, at.cy ?? -1, at.r ?? -1, at.fx ?? -1, at.fy ?? -1), (gid) =>
    el('radialGradient', { id: gid, cx: at.cx, cy: at.cy, r: at.r, fx: at.fx, fy: at.fy }, ...stopsSVG(c, stops)),
  )
  return url(id)
}

/** Linear gradient paint in objectBoundingBox units from `a` to `b`. */
export function linearPaint(c: Ctx, stops: Stop[], a: P = [0, 0], b: P = [0, 1]): string {
  const id = c.defs.add(keyOf('lg', JSON.stringify(stops), a[0], a[1], b[0], b[1]), (gid) =>
    el('linearGradient', { id: gid, x1: f(a[0]), y1: f(a[1]), x2: f(b[0]), y2: f(b[1]) }, ...stopsSVG(c, stops)),
  )
  return url(id)
}

/** A soft round spot fading to nothing at its rim: shading, flush, sheen, bloom. */
export function softSpot(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, opacity = 1, rotDeg = 0): string {
  if (opacity <= 0.005 || rx <= 0 || ry <= 0) return ''
  const fill = radialPaint(c, [[0, color, 1], [0.35, color, 0.78], [0.7, color, 0.3], [1, color, 0]])
  return el('ellipse', {
    cx,
    cy,
    rx,
    ry,
    fill,
    'fill-opacity': opacity < 1 ? f(opacity) : undefined,
    transform: rotDeg ? `rotate(${f(rotDeg)} ${f(cx)} ${f(cy)})` : undefined,
  })
}

/** Shortest-path hue interpolation in degrees. */
export function hueTo(a: number, b: number, t: number): number {
  const d = ((((b - a + 180) % 360) + 360) % 360) - 180
  return (((a + d * t) % 360) + 360) % 360
}

/**
 * A warm deepening of a skin (or fur) colour for creases, folds and soft shadows. Unlike
 * `shadowOf` it keeps natural skin in the warm brown family instead of drifting to pink or
 * violet, so fine lines read as form, not as make-up.
 */
export function warmShade(hex: string, depth: number): string {
  const c = toLch(hex)
  const natural = c.c > 0.02 && (c.h < 100 || c.h > 340)
  return fromLch({
    l: c.l - depth * (0.32 + c.l * 0.6),
    c: c.c < 0.02 ? c.c + depth * 0.04 : Math.min(0.18, c.c * (1 + depth * 0.55)),
    h: c.c < 0.02 ? 30 : natural ? hueTo(c.h, 40, clamp(depth, 0, 1) * 0.5) : hueTo(c.h, 20, clamp(depth, 0, 1) * 0.35),
  })
}

/** A band hugging a curve: the curve plus a copy moved by `lift` (tapered toward the ends). */
export function band(pts: P[], lift: number, taper = 0.35): string {
  const n = pts.length - 1
  if (n < 1) return ''
  const other = pts.map(([x, y], i) => [x, y + lift * (taper + (1 - taper) * Math.sin((Math.PI * i) / n))] as SP)
  const main = pts.map(([x, y], i) => (i === 0 || i === n ? [x, y, 0] : [x, y]) as SP)
  return smooth([...main, ...other.reverse()])
}

/* ---- Lids ---------------------------------------------------------------------- */

function lids(s: EyeSpec): { up: P[]; low: P[]; h: number } {
  const st = s.style
  const w = s.w * (s.profile ? 0.62 : 1)
  const h = s.w * st.ratio * 0.5
  const tilt = (st.tilt + s.tilt) * s.w * 0.35
  const N = 9
  const up: P[] = []
  const low: P[] = []
  const open = clamp(s.open, 0, 1.4)
  const squint = clamp(s.squint, 0, 1)
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const x = s.cx + s.dir * (t - 0.5) * w
    const base = s.cy + lerp(tilt * 0.25, -tilt * 0.75, t)
    const tp = t < st.peak ? (0.5 * t) / st.peak : 0.5 + (0.5 * (t - st.peak)) / (1 - st.peak)
    const lowY = base + h * st.low * Math.sin(Math.PI * t) * (1 - squint * 1.35)
    let fullUp = base - h * Math.pow(Math.sin(Math.PI * tp), st.upPow) * (open > 1 ? open : 1)
    if (s.lidAngle > 0) fullUp += s.lidAngle * h * 0.55 * Math.pow(1 - t, 1.4) * Math.sin(Math.PI * t) * 2
    if (s.lidAngle < 0) fullUp += -s.lidAngle * h * 0.5 * Math.pow(t, 1.4) * Math.sin(Math.PI * t) * 2
    const upY = lowY + (fullUp - lowY) * Math.min(open, 1)
    up.push([x, Math.min(upY, lowY)])
    low.push([x, lowY])
  }
  return { up, low, h }
}

/** A point along a polyline at parameter t (0..1). */
function along(pts: P[], t: number): P {
  const u = clamp(t, 0, 1) * (pts.length - 1)
  const i = Math.min(pts.length - 2, Math.floor(u))
  const k = u - i
  return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)]
}

/* ---- Closed and symbolic eyes --------------------------------------------------- */

function closedEye(c: Ctx, s: EyeSpec, curve: 'down' | 'up' | 'sad'): string {
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const w = s.w * (s.profile ? 0.62 : 1)
  const h = s.w * s.style.ratio * 0.5
  const tilt = (s.style.tilt + s.tilt) * s.w * 0.35
  const x0 = s.cx - s.dir * w * 0.5
  const x1 = s.cx + s.dir * w * 0.5
  const k = curve === 'up' ? -h * 1.1 : h * 0.55
  const y0 = s.cy + tilt * 0.25 + (curve === 'sad' ? -h * 0.35 : 0)
  const y1 = s.cy - tilt * 0.75 + (curve === 'sad' ? h * 0.12 : 0) + (curve === 'down' ? h * 0.1 : 0)
  const pts: P[] = [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + k], [x1, y1]]
  const dense = sampleSmooth(pts, false, 4)
  // Bold outlines thicken features, but never past what keeps the eye readable.
  const lw = clamp(P.lw * 1.3, s.w * 0.07, s.w * 0.12) * (s.style.lid > 1 ? 1.1 : 1)
  const col = mix(s.skin, LASH, 0.78)
  const parts: string[] = []
  // Lid form above a closed eye: a soft fold and the crease.
  if (curve !== 'up' && shaded) {
    parts.push(P.flat(band(dense, -h * 0.75, 0.12), warmShade(s.skin, 0.12), rich ? 0.22 : 0.14))
    if (rich) parts.push(P.flat(brush(dense.slice(2, -2).map(([x, y], i, a) => [x, y - h * (0.5 + 0.25 * Math.sin((Math.PI * i) / Math.max(1, a.length - 1)))] as P), 0, 0, lw * 0.28), warmShade(s.skin, 0.3), 0.4))
  }
  if (curve === 'up') {
    parts.push(P.flat(brush(pts, lw * 0.32, lw * 0.4, lw * 0.78), col))
    // The cheek pushes up under a smiling eye.
    if (rich) parts.push(P.flat(brush([[s.cx - s.dir * w * 0.05, s.cy + h * 0.55], [s.cx + s.dir * w * 0.2, s.cy + h * 0.5], [s.cx + s.dir * w * 0.36, s.cy + h * 0.36]], 0, 0, lw * 0.26), warmShade(s.skin, 0.28), 0.34))
    if (s.lashes > 0.3 && P.detail > 0) parts.push(P.flat(brush([[x1 - s.dir * w * 0.02, y1 - lw * 0.1], [x1 + s.dir * w * 0.1, y1 - h * 0.12], [x1 + s.dir * w * 0.16, y1 - h * 0.34]], lw * 0.7, 0), col))
    return parts.join('')
  }
  parts.push(P.flat(brush(dense, lw * 0.36, lw * 1.12, lw * 0.36), col))
  // Lashes hang from a closed lid.
  const n = P.detail > 0 ? Math.round(clamp(s.lashes, 0, 1) * (rich ? 5 : 3)) + (s.style.lid > 1.1 ? 1 : 0) : 0
  if (n > 0) {
    const ls: string[] = []
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.95 : lerp(0.5, 0.98, i / (n - 1))
      const [x, y] = along(dense, t)
      const len = s.w * (0.07 + s.lashes * 0.07) * (0.7 + t * 0.5)
      const a = Math.PI / 2 - s.dir * (0.25 + t * 0.9)
      ls.push(brush([[x, y], [x + Math.cos(a) * len * 0.6, y + Math.sin(a) * len * 0.6], [x + Math.cos(a - s.dir * 0.35) * len, y + Math.sin(a - s.dir * 0.35) * len]], lw * 0.55, 0))
    }
    parts.push(P.flat(ls.join(''), col))
  }
  return parts.join('')
}

function heartEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rich = c.baked && P.detail > 1
  const r = s.w * 0.42
  const base = '#ef3b63'
  const d = heart(s.cx, s.cy, r)
  const paint = shaded ? linearPaint(c, [[0, '#ff86a2'], [0.45, base], [1, '#c2124a']], [0.3, 0], [0.7, 1]) : undefined
  let svg = P.shape(d, base, { paint, outline: 0.8, shade: paint ? false : 0.8 })
  if (P.detail > 0) {
    if (rich) svg += P.flat(heart(s.cx, s.cy - r * 0.08, r * 0.7), '#ff9bb3', 0.28)
    svg += el('ellipse', { cx: s.cx - r * 0.5, cy: s.cy - r * 0.3, rx: r * 0.21, ry: r * 0.13, fill: P.col(WHITE), 'fill-opacity': 0.9, transform: `rotate(-38 ${f(s.cx - r * 0.5)} ${f(s.cy - r * 0.3)})` })
    svg += P.flat(circle(s.cx - r * 0.2, s.cy - r * 0.52, r * 0.07), WHITE, 0.85)
    if (rich) svg += P.flat(sparkle(s.cx + r * 0.62, s.cy - r * 0.62, r * 0.26), WHITE, 0.95)
  }
  return svg
}

function starEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rich = c.baked && P.detail > 1
  const base = '#ffc93a'
  const r = s.w * 0.46
  const d = star(s.cx, s.cy, r, r * 0.44)
  const paint = shaded ? linearPaint(c, [[0, '#fff0a0'], [0.5, base], [1, '#f08c12']], [0.35, 0], [0.65, 1]) : undefined
  let svg = P.shape(d, base, { paint, outline: 0.8, shade: paint ? false : 0.8 })
  if (P.detail > 0) {
    if (shaded) svg += P.flat(star(s.cx, s.cy + r * 0.02, r * 0.52, r * 0.24), '#fff3b8', rich ? 0.55 : 0.4)
    svg += el('ellipse', { cx: s.cx - r * 0.2, cy: s.cy - r * 0.34, rx: r * 0.12, ry: r * 0.08, fill: P.col(WHITE), 'fill-opacity': 0.9, transform: `rotate(-30 ${f(s.cx - r * 0.2)} ${f(s.cy - r * 0.34)})` })
    if (rich) svg += P.flat(sparkle(s.cx + r * 0.72, s.cy - r * 0.55, r * 0.22), WHITE, 0.95)
  }
  return svg
}

function xEye(c: Ctx, s: EyeSpec, col: string): string {
  const P = c.paint
  const r = s.w * 0.28
  const lw = clamp(P.lw * 1.4, s.w * 0.09, s.w * 0.14)
  const a = brush([[s.cx - r, s.cy - r], [s.cx, s.cy], [s.cx + r, s.cy + r]], lw * 0.45, lw * 0.4, lw * 0.55)
  const b = brush([[s.cx + r, s.cy - r], [s.cx, s.cy], [s.cx - r, s.cy + r]], lw * 0.45, lw * 0.4, lw * 0.55)
  return P.flat(a + b, col)
}

/* ---- Special eye styles --------------------------------------------------------- */

function dotEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rx = s.w * 0.16 * (s.mode === 'wide' ? 1.3 : 1)
  const ry = s.w * 0.22 * clamp(s.open, 0.2, 1.3) * (1 - s.squint * 0.4)
  const x = s.cx + s.lookX * s.w * 0.08
  const y = s.cy + s.lookY * s.w * 0.05
  // Dots read as dark on light fur and light on dark fur.
  const dark = isDark(s.skin)
  const dotCol = dark ? '#f8f4ea' : '#1f1a22'
  const fill = shaded ? radialPaint(c, [[0, dark ? '#ffffff' : '#3a3044'], [0.6, dotCol], [1, dark ? '#d8d2c6' : '#120e16']], { cx: 0.42, cy: 0.35, r: 0.7 }) : P.col(dotCol)
  let svg = el('path', { d: ellipse(x, y, rx, ry), fill })
  if (P.detail > 0) {
    const hl = dark ? '#1f1a22' : WHITE
    svg += P.flat(circle(x - rx * 0.3, y - ry * 0.4, rx * 0.36), hl, 0.92)
    if (rich) svg += P.flat(circle(x + rx * 0.32, y + ry * 0.35, rx * 0.15), hl, 0.7)
  }
  return svg
}

function buttonEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const L = P.style.light
  const r = s.w * 0.3 * clamp(s.open, 0.3, 1.2)
  const ry = r * clamp(s.open, 0.3, 1) * (1 - s.squint * 0.4)
  const x = s.cx + s.lookX * s.w * 0.08
  const bead = '#221c26'
  const paint = shaded ? radialPaint(c, [[0, '#5a4d6a'], [0.45, bead], [1, '#0d0a10']], { cx: 0.5 + L[0] * 0.22, cy: 0.5 + L[1] * 0.25, r: 0.75 }) : undefined
  let svg = P.shape(ellipse(x, s.cy, r, ry), bead, { shade: false, outline: 0.6, paint })
  // Bounce light on the far side reads as a glossy bead.
  if (rich) svg += softSpot(c, x - L[0] * r * 0.45, s.cy - L[1] * ry * 0.5, r * 0.5, ry * 0.3, '#8a7aa8', 0.45, L[0] * 30)
  if (rich) svg += softSpot(c, x + L[0] * r * 0.35, s.cy + L[1] * ry * 0.35, r * 0.55, ry * 0.5, WHITE, 0.35)
  svg += P.flat(circle(x + L[0] * r * 0.38, s.cy + L[1] * ry * 0.4, r * 0.26) + circle(x - L[0] * r * 0.32, s.cy - L[1] * ry * 0.36, r * 0.1), WHITE, 0.95)
  return svg
}

function bugEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const L = P.style.light
  const r = s.w * 0.42
  const ry = r * 0.95
  const dome = ellipse(s.cx, s.cy, r, ry)
  const paint = shaded ? radialPaint(c, [[0, highlightOf(s.iris, 0.35)], [0.55, s.iris], [1, shadowOf(s.iris, 0.4)]], { cx: 0.5 + L[0] * 0.2, cy: 0.5 + L[1] * 0.2, r: 0.7 }) : undefined
  let svg = P.shape(dome, s.iris, { gloss: !rich, paint, shade: paint ? false : 1 })
  if (rich) {
    // Hexagonal facets, clipped to the dome.
    const clip = c.defs.add(keyOf('bg', dome), (id) => el('clipPath', { id }, el('path', { d: dome })))
    const cell = r * 0.2
    let hex = ''
    for (let row = -6; row <= 6; row++) {
      for (let col = -6; col <= 6; col++) {
        const hx = s.cx + (col + (row % 2 ? 0.5 : 0)) * cell * 1.02
        const hy = s.cy + row * cell * 0.88
        if ((hx - s.cx) ** 2 / (r * r) + (hy - s.cy) ** 2 / (ry * ry) > 1.15) continue
        const pts: P[] = []
        for (let k = 0; k < 6; k++) pts.push([hx + Math.cos((k / 6) * TAU + Math.PI / 6) * cell * 0.56, hy + Math.sin((k / 6) * TAU + Math.PI / 6) * cell * 0.56])
        hex += poly(pts)
      }
    }
    svg += g({ 'clip-path': url(clip) }, P.line(hex, shadowOf(s.iris, 0.45), cell * 0.1, { opacity: 0.45 }))
    svg += softSpot(c, s.cx + L[0] * r * 0.4, s.cy + L[1] * ry * 0.42, r * 0.42, ry * 0.3, WHITE, 0.65)
    svg += P.flat(ellipse(s.cx + L[0] * r * 0.42, s.cy + L[1] * ry * 0.45, r * 0.18, ry * 0.11), WHITE, 0.85)
  } else if (P.detail > 1) {
    const facets = [0, 1, 2, 3, 4, 5, 6].map((i) => circle(s.cx + Math.cos(i) * r * 0.45, s.cy + Math.sin(i * 1.3) * r * 0.45, r * 0.16)).join('')
    svg += P.flat(facets, shadowOf(s.iris, 0.25), 0.4)
  }
  return svg
}

function visorEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const w = s.w * 1.9
  const h = s.w * 0.55 * clamp(s.open, 0.15, 1.2)
  const screen = roundRect(s.cx - w / 2, s.cy - h / 2, w, h, h * 0.45)
  const glowC = s.iris
  const bar = roundRect(s.cx - w * 0.3 + s.lookX * w * 0.2, s.cy - h * 0.18, w * 0.6, h * 0.36, h * 0.18)
  const paint = shaded ? linearPaint(c, [[0, '#2a3442'], [0.55, '#141a22'], [1, '#07090d']]) : undefined
  let svg = P.shape(screen, '#141a22', { gloss: !rich, paint, shade: paint ? false : 1 })
  if (s.glow || rich) svg += P.glow(s.cx, s.cy, w * 0.6, glowC, s.glow ? 0.5 : 0.25)
  svg += P.flat(bar, glowC)
  if (rich) {
    svg += P.flat(roundRect(s.cx - w * 0.26 + s.lookX * w * 0.2, s.cy - h * 0.1, w * 0.52, h * 0.1, h * 0.05), highlightOf(glowC, 0.6), 0.8)
    const clip = c.defs.add(keyOf('vs', screen), (id) => el('clipPath', { id }, el('path', { d: screen })))
    let lines = ''
    for (let i = 1; i < 6; i++) lines += `M${f(s.cx - w / 2)} ${f(s.cy - h / 2 + (i * h) / 6)}h${f(w)}`
    svg += g({ 'clip-path': url(clip) }, P.line(lines, '#000000', h * 0.04, { opacity: 0.35 }))
    svg += P.flat(roundRect(s.cx - w * 0.38, s.cy - h * 0.4, w * 0.3, h * 0.12, h * 0.06), WHITE, 0.3)
  }
  return svg
}

/* ---- Pupils and irises ---------------------------------------------------------- */

function pupilShape(kind: string, x: number, y: number, r: number): string {
  switch (kind) {
    case 'slit':
      return `M${f(x)} ${f(y - r * 1.6)}Q${f(x + r * 0.5)} ${f(y)} ${f(x)} ${f(y + r * 1.6)}Q${f(x - r * 0.5)} ${f(y)} ${f(x)} ${f(y - r * 1.6)}Z`
    case 'goat':
      return roundRect(x - r * 1.3, y - r * 0.3, r * 2.6, r * 0.6, r * 0.3)
    case 'star':
      return star(x, y, r * 1.25, r * 0.55)
    case 'heart':
      return heart(x, y, r * 1.05)
    case 'ring':
      return circle(x, y, r * 1.1) + circle(x, y, r * 0.55)
    case 'cross':
      return poly([[x - r * 0.25, y - r * 1.2], [x + r * 0.25, y - r * 1.2], [x + r * 0.25, y - r * 0.25], [x + r * 1.2, y - r * 0.25], [x + r * 1.2, y + r * 0.25], [x + r * 0.25, y + r * 0.25], [x + r * 0.25, y + r * 1.2], [x - r * 0.25, y + r * 1.2], [x - r * 0.25, y + r * 0.25], [x - r * 1.2, y + r * 0.25], [x - r * 1.2, y - r * 0.25], [x - r * 0.25, y - r * 0.25]])
    case 'flower':
      return [0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2
        return circle(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.45)
      }).join('')
    case 'none':
      return ''
    default:
      return circle(x, y, r)
  }
}

/** Iris gradient: dark pupil ruff, a light collarette, the iris, a darker rim and the limbal ring. */
function irisPaint(c: Ctx, iris: string, glow: boolean): string {
  const lc = toLch(iris)
  const collar = fromLch({ l: Math.min(0.9, lc.l + 0.16), c: Math.min(0.26, lc.c * 1.25 + 0.01), h: hueTo(lc.h, 85, lc.c > 0.03 ? 0.12 : 0) })
  const rim = shadowOf(iris, 0.26)
  const limbal = mix(shadowOf(iris, 0.55), '#150d18', 0.5)
  if (glow) return radialPaint(c, [[0, WHITE], [0.35, highlightOf(iris, 0.6)], [0.7, iris], [0.92, rim], [1, limbal]])
  return radialPaint(c, [[0, shadowOf(iris, 0.3)], [0.4, shadowOf(iris, 0.12)], [0.56, collar], [0.74, iris], [0.9, rim], [1, limbal]])
}

/** The light that passes through the cornea and pools in the iris opposite the key light. */
function causticOf(iris: string): string {
  const lc = toLch(iris)
  return fromLch({ l: Math.min(0.93, lc.l + 0.3 + (1 - lc.l) * 0.1), c: Math.min(0.24, lc.c * 1.45 + 0.02), h: hueTo(lc.h, 80, lc.c > 0.03 ? 0.15 : 0) })
}

// Fixed jitter table for iris fibres (deterministic, shared by every eye).
const FIB = Array.from({ length: 32 }, (_, i) => (hash32('fib', i) % 1000) / 1000)

/* ---- The eye ---------------------------------------------------------------------- */

export function drawEye(c: Ctx, s: EyeSpec): string {
  const P = c.paint
  const st = s.style
  const lashCol = mix(s.skin, LASH, 0.82)
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rich = c.baked && P.detail > 1

  // Symbolic eyes first: they replace the whole eye.
  if (s.mode === 'hearts') return heartEye(c, s)
  if (s.mode === 'stars') return starEye(c, s)
  if (s.mode === 'x') return xEye(c, s, lashCol)
  if (s.mode === 'happy') return closedEye(c, s, 'up')
  if (s.mode === 'sad') return closedEye(c, s, 'sad')
  if (s.mode === 'closed' || s.open < 0.1) return closedEye(c, s, 'down')

  if (st.special === 'dot') return dotEye(c, s)
  if (st.special === 'button') return buttonEye(c, s)
  if (st.special === 'bug') return bugEye(c, s)
  if (st.special === 'visor') return visorEye(c, s)

  const { up, low, h } = lids(s)
  const N = up.length
  const eyeD = smooth([...up.map(([x, y], i) => (i === 0 || i === N - 1 ? [x, y, 0] : [x, y]) as SP), ...low.slice(1, -1).reverse()])
  const clipId = c.defs.add(keyOf('ey', eyeD), (id) => el('clipPath', { id }, el('path', { d: eyeD })))
  const parts: string[] = []
  const outer = up[N - 1]
  const L = P.style.light
  const lineW = clamp(P.lw * 0.9, s.w * 0.045, s.w * 0.075) * (1 + (st.lid - 1) * 0.65)
  const sqx = s.profile ? 0.62 : 1

  // Eyeshadow above the lid: a feathered wash, denser at the lash line.
  if (s.shadow > 0.02) {
    const mid = along(up, 0.55)
    if (shaded) {
      parts.push(softSpot(c, mid[0], mid[1] - h * 0.2, s.w * (0.5 + s.shadow * 0.12) * (s.profile ? 0.62 : 1), h * (0.95 + s.shadow * 0.6), s.shadowColor, 0.35 + s.shadow * 0.45))
      parts.push(P.flat(band(up, -h * 0.42, 0.15), s.shadowColor, 0.12 + s.shadow * 0.25))
      if (rich) parts.push(softSpot(c, mid[0], mid[1] - h * 0.45, s.w * 0.14, h * 0.2, highlightOf(s.shadowColor, 0.6), 0.45 * s.shadow))
    } else parts.push(P.flat(band(up, -h * (0.95 + s.shadow * 0.7), 0.1), s.shadowColor, 0.2 + s.shadow * 0.35))
  }
  // The lid's own form: a soft darker fold just above the lash line.
  if (rich && st.lid > 0) parts.push(P.flat(band(up, -h * (st.crease === 'hood' ? 0.32 : 0.5), 0.15), warmShade(s.skin, 0.12), 0.22))

  // Sclera, iris, pupil, highlights — clipped to the lids.
  const irisR = s.w * 0.27 * lerp(0.82, 1.22, s.irisScale) * st.iris * (s.mode === 'wide' ? 0.62 : 1)
  const ix = s.cx + s.lookX * s.w * (s.profile ? 0.1 : 0.2) + (s.profile ? s.dir * -s.w * 0.12 : 0)
  const iy = s.cy + s.lookY * h * 0.35 + h * 0.08
  const inside: string[] = []
  const scleraFill = shaded ? radialPaint(c, [[0, s.sclera], [0.5, s.sclera], [1, mix(shadowOf(s.sclera, 0.3), s.skin, 0.3)]], { cx: 0.5, cy: 0.62, r: 0.62 }) : P.col(s.sclera)
  inside.push(el('path', { d: eyeD, fill: scleraFill }))
  const pr = irisR * (s.mode === 'wide' ? 0.35 : 0.46)
  if (s.mode !== 'blank' && s.mode !== 'spiral') {
    const irisD = ellipse(ix, iy, irisR * sqx, irisR)
    inside.push(el('path', { d: irisD, fill: shaded ? irisPaint(c, s.iris, s.glow) : P.col(s.iris) }))
    if (!shaded && P.detail > 1) inside.push(P.line(ellipse(ix, iy, irisR * 0.97 * sqx, irisR * 0.97), shadowOf(s.iris, 0.35), irisR * 0.1, { opacity: 0.8 }))
    // Light through the cornea pools in the iris opposite the catchlight.
    if (shaded && P.detail > 1) inside.push(softSpot(c, ix - L[0] * irisR * 0.34 * sqx, iy - L[1] * irisR * 0.4, irisR * 0.62 * sqx, irisR * 0.44, causticOf(s.iris), rich ? 0.8 : 0.6, -L[0] * 25))
    if (rich) {
      // Iris fibres: fine radial strokes, alternating light and dark.
      let dl = ''
      let dd = ''
      const r0 = pr * 1.08
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU + (FIB[i] - 0.5) * 0.18
        const r1 = irisR * (0.7 + FIB[(i + 9) % 32] * 0.24)
        const ca = Math.cos(a) * sqx
        const sa = Math.sin(a)
        const seg = `M${f(ix + ca * r0)} ${f(iy + sa * r0)}L${f(ix + ca * r1)} ${f(iy + sa * r1)}`
        if (i % 2) dd += seg
        else dl += seg
      }
      inside.push(P.line(dl, causticOf(s.iris), irisR * 0.05, { opacity: 0.4 }), P.line(dd, shadowOf(s.iris, 0.4), irisR * 0.045, { opacity: 0.38 }))
    }
    const pupil = pupilShape(s.pupil, ix, iy, pr)
    if (pupil) {
      const pf = shaded ? radialPaint(c, [[0, '#06040a'], [0.62, '#120d17'], [1, mix('#1a1420', s.iris, 0.35)]]) : P.col('#15111a')
      inside.push(el('path', { d: pupil, fill: pf, 'fill-rule': 'evenodd', transform: s.profile ? `matrix(${sqx} 0 0 1 ${f(ix * (1 - sqx))} 0)` : undefined }))
    }
    if (s.glow) {
      inside.push(P.glow(ix, iy, irisR * 1.2, s.iris, 0.7))
      if (rich) inside.push(softSpot(c, ix, iy, irisR * 0.8 * sqx, irisR * 0.8, highlightOf(s.iris, 0.7), 0.55))
    }
    // Highlights toward the light: the wet catchlight, a secondary, and in baked mode a
    // bloom and a third glint.
    // Shaped pupils (star, heart…) keep the catchlight off to the side so they stay readable.
    const shapedPupil = s.pupil !== 'round' && s.pupil !== 'none' && s.pupil !== ''
    const hs = lerp(0.18, 0.4, s.sparkle) * (st === EYE_STYLES.big || st === EYE_STYLES.cute ? 1.3 : 1) * (shapedPupil ? 0.72 : 1)
    const hk = shapedPupil ? 1.4 : 1
    const hx = ix + L[0] * irisR * 0.42 * hk * sqx
    const hy = iy + L[1] * irisR * 0.48 * hk
    if (P.detail > 0) {
      if (rich) inside.push(softSpot(c, hx, hy, irisR * (hs * 2.2 + 0.1) * sqx, irisR * (hs * 1.9 + 0.1), WHITE, 0.3 + s.sparkle * 0.15))
      inside.push(el('ellipse', { cx: hx, cy: hy, rx: irisR * hs * sqx, ry: irisR * hs * 0.85, fill: P.col(WHITE), 'fill-opacity': 0.96 }))
      inside.push(el('circle', { cx: ix - L[0] * irisR * 0.45 * sqx, cy: iy - L[1] * irisR * 0.4, r: irisR * hs * 0.38, fill: P.col(rich ? mix(WHITE, causticOf(s.iris), 0.25) : WHITE), 'fill-opacity': 0.82 }))
      if (rich && s.sparkle > 0.2) inside.push(el('circle', { cx: hx - L[1] * irisR * hs * 1.25 * sqx, cy: hy + L[0] * irisR * hs * 1.1 + irisR * hs * 0.5, r: irisR * hs * 0.22, fill: P.col(WHITE), 'fill-opacity': 0.9 }))
      if (s.mode === 'sparkle') inside.push(P.flat(sparkle(hx, hy, irisR * 0.55) + sparkle(ix - irisR * 0.32, iy + irisR * 0.3, irisR * 0.3) + (rich ? sparkle(ix + irisR * 0.4, iy + irisR * 0.45, irisR * 0.16) : ''), WHITE))
    }
    if (s.mode === 'wide' && P.detail > 0) inside.push(P.flat(circle(hx, hy, irisR * 0.25), WHITE))
  }
  if (s.mode === 'spiral') {
    const pts: P[] = []
    const n = rich ? 44 : 26
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const a = t * 2.6 * TAU
      const r = t * s.w * 0.38
      pts.push([s.cx + Math.cos(a) * r * sqx, s.cy + h * 0.05 + Math.sin(a) * r * 0.82])
    }
    inside.push(P.line(smooth(pts, false), mix(lashCol, s.iris, 0.3), s.w * 0.055))
  }
  // Soft shadow the upper lid and lashes cast on the eyeball (graded in baked mode).
  if (shaded) {
    const lidC = mix(warmShade(s.skin, 0.45), '#2a1830', 0.35)
    if (rich) inside.push(P.flat(band(up, h * 0.62, 0.4), lidC, 0.12), P.flat(band(up, h * 0.36, 0.4), lidC, 0.13), P.flat(band(up, h * 0.17, 0.45), lidC, 0.2))
    else inside.push(P.flat(band(up, h * 0.42, 0.35), lidC, 0.24))
    // A thin wet glint along the lower rim.
    if (rich) inside.push(P.line(smooth(low.slice(3, -2).map(([x, y]) => [x, y - h * 0.07] as P), false), WHITE, lineW * 0.2 + s.w * 0.005, { opacity: 0.3 }))
  }
  parts.push(g({ 'clip-path': url(clipId) }, ...inside))
  if (s.glow && rich) parts.push(P.glow(ix, iy, s.w * 0.75, s.iris, 0.3))

  if (st.lid > 0) {
    // Lash line, thicker toward the outer corner, with an optional wing.
    parts.push(P.flat(brush(up, lineW * 0.45, lineW * (1.3 + s.liner * 1.7), lineW * 0.32), lashCol))
    if (s.liner > 0.2 || st === EYE_STYLES.cat) {
      const k = Math.max(s.liner, 0.4)
      const prev = up[N - 2]
      const dx = outer[0] - prev[0]
      const dy = outer[1] - prev[1]
      const dl = Math.hypot(dx, dy) || 1
      const tip: P = [outer[0] + s.dir * s.w * 0.24 * k, outer[1] - s.w * 0.1 * k + (dy / dl) * s.w * 0.06 * k]
      parts.push(P.flat(brush([[outer[0] - s.dir * s.w * 0.1, outer[1] + lineW * 0.15], [lerp(outer[0], tip[0], 0.5), lerp(outer[1], tip[1], 0.45)], tip], lineW * 1.5, 0), lashCol))
    }
    // Lower lid: a thin partial line, tapered toward the inner corner.
    if (P.detail > 0) {
      const lowPart = low.slice(Math.floor(N * 0.35))
      if (rich) parts.push(P.flat(brush(lowPart, 0, lineW * 0.55, lineW * 0.12), lashCol, 0.62))
      else parts.push(P.line(smooth(low.slice(Math.floor(N * 0.4)), false), lashCol, lineW * 0.45, { opacity: 0.55 }))
    }
    // Lashes: tapered, curling outward, longer toward the outer corner.
    const n = Math.round(s.lashes * (rich ? 7 : 5))
    if (n > 0 && P.detail > 0) {
      const lashes: string[] = []
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.95 : lerp(0.5, 0.99, i / (n - 1))
        const [x, y] = along(up, t)
        const len = s.w * (0.09 + s.lashes * 0.11) * (0.65 + t * 0.55)
        const ang = -Math.PI / 2 + s.dir * (0.22 + t * 0.95)
        const curl = s.dir * 0.4
        lashes.push(brush([[x, y], [x + Math.cos(ang) * len * 0.55, y + Math.sin(ang) * len * 0.55], [x + Math.cos(ang + curl) * len, y + Math.sin(ang + curl) * len]], lineW * 0.85, 0))
      }
      if (rich && s.lashes > 0.55) {
        for (let i = 0; i < 3; i++) {
          const [x, y] = along(low, 0.72 + i * 0.1)
          const len = s.w * 0.05 * (0.7 + i * 0.25) * s.lashes
          const ang = Math.PI / 2 + s.dir * (0.35 + i * 0.25)
          lashes.push(brush([[x, y], [x + Math.cos(ang) * len, y + Math.sin(ang) * len]], lineW * 0.4, 0))
        }
      }
      parts.push(P.flat(lashes.join(''), lashCol))
    }
    // Crease / hood: a tapered fold line following the lid.
    if (P.detail > 0 && st.crease !== 'none' && s.open > 0.5) {
      const lift = st.crease === 'hood' ? h * 0.28 : h * 0.62
      const crease = up.slice(1, -1).map(([x, y], i, a) => [x, y - lift * (0.55 + 0.45 * Math.sin((Math.PI * i) / Math.max(1, a.length - 1)))] as P)
      parts.push(P.flat(brush(crease, 0, 0, lineW * 0.45), mix(warmShade(s.skin, 0.34), lashCol, 0.2), 0.5))
    }
    // Under-eye: a soft hollow and a fine line.
    if (s.bags > 0.15 && P.detail > 1) {
      const bag = low.slice(2, -2).map(([x, y]) => [x, y + h * 0.5] as P)
      if (shaded) parts.push(P.flat(band(low.slice(1, -1).map(([x, y]) => [x, y + h * 0.12] as P), h * 0.45, 0.2), warmShade(s.skin, 0.2), s.bags * 0.3))
      parts.push(P.flat(brush(bag, 0, 0, lineW * 0.45), warmShade(s.skin, 0.28), s.bags * 0.75))
    }
  }
  return parts.join('')
}

/* ---- Expression effects (tears, sweat, anger mark, zzz, steam) ------------------ */

export interface ExprFxSpec {
  /** Lower-lid centres of the visible eyes and the eye width. */
  eyes: { x: number; y: number; dir: number }[]
  eyeW: number
  /** Head size unit and the face's half width. */
  unit: number
  halfW: number
  /** Top of the head and the temple used for sweat / anger marks. */
  topY: number
  templeX: number
  templeY: number
  /** Where the anger mark sits. */
  veinX: number
  veinY: number
  tears: number
  sweat: number
  vein: boolean
  zzz: boolean
  steam: boolean
}

const TEAR = '#8fd6ff'

/** Tear streams and pools. */
export function drawTears(c: Ctx, s: ExprFxSpec): string {
  if (s.tears < 0.05) return ''
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  let out = ''
  for (const e of s.eyes) {
    const len = s.unit * 0.13 * clamp(s.tears, 0, 1)
    const x0 = e.x + e.dir * s.eyeW * 0.22
    const pts: P[] = [[x0, e.y], [x0 + e.dir * s.eyeW * 0.1, e.y + len * 0.5], [x0 + e.dir * s.eyeW * 0.08, e.y + len]]
    const stream = brush(pts, s.eyeW * 0.08, s.eyeW * 0.15, s.eyeW * 0.03)
    const pool = ellipse(e.x + e.dir * s.eyeW * 0.05, e.y - s.eyeW * 0.02, s.eyeW * 0.42, s.eyeW * 0.09)
    const drop = `M${f(pts[2][0])} ${f(pts[2][1] + s.eyeW * 0.06)}c${f(s.eyeW * 0.11)} ${f(s.eyeW * 0.12)} ${f(s.eyeW * 0.1)} ${f(s.eyeW * 0.26)} 0 ${f(s.eyeW * 0.26)}s${f(-s.eyeW * 0.11)} ${f(-s.eyeW * 0.14)} 0 ${f(-s.eyeW * 0.26)}Z`
    const paint = shaded ? linearPaint(c, [[0, '#d8f3ff'], [0.5, TEAR], [1, '#4fb3ea']], [0, 0], [1, 1]) : undefined
    out += P.shape(stream + pool + drop, TEAR, { paint, outline: 0.45, shade: false })
    if (P.detail > 0) out += P.line(smooth([[x0 + e.dir * s.eyeW * 0.01, e.y + len * 0.18], [x0 + e.dir * s.eyeW * 0.06, e.y + len * 0.55]], false), WHITE, s.eyeW * 0.03, { opacity: 0.85 })
    if (rich) out += P.flat(circle(pts[2][0] - s.eyeW * 0.03, pts[2][1] + s.eyeW * 0.2, s.eyeW * 0.03), WHITE, 0.9)
  }
  return out
}

/** A sweat drop at the temple. */
export function drawSweat(c: Ctx, s: ExprFxSpec): string {
  if (s.sweat < 0.1) return ''
  const P = c.paint
  const rich = c.baked && P.detail > 1
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const r = s.unit * 0.055 * (0.75 + clamp(s.sweat, 0, 1) * 0.35)
  const x = s.templeX
  const y = s.templeY
  const d = `M${f(x)} ${f(y - r * 1.7)}C${f(x + r * 0.35)} ${f(y - r * 0.9)} ${f(x + r)} ${f(y - r * 0.4)} ${f(x + r)} ${f(y + r * 0.2)}A${f(r)} ${f(r)} 0 0 1 ${f(x - r)} ${f(y + r * 0.2)}C${f(x - r)} ${f(y - r * 0.4)} ${f(x - r * 0.35)} ${f(y - r * 0.9)} ${f(x)} ${f(y - r * 1.7)}Z`
  const paint = shaded ? linearPaint(c, [[0, '#e6f7ff'], [0.55, '#9fdcff'], [1, '#56b4ec']], [0.2, 0], [0.8, 1]) : undefined
  let out = P.shape(d, '#9fdcff', { paint, outline: 0.7, shade: false })
  if (P.detail > 0) out += P.flat(ellipse(x - r * 0.4, y + r * 0.1, r * 0.2, r * 0.36), WHITE, 0.9)
  if (rich) out += P.flat(circle(x + r * 0.35, y + r * 0.6, r * 0.12), WHITE, 0.8)
  return out
}

/** The cartoon anger mark: four bulging arcs around a cross. */
export function drawVein(c: Ctx, s: ExprFxSpec): string {
  if (!s.vein) return ''
  const P = c.paint
  const r = s.unit * 0.075
  const x = s.veinX
  const y = s.veinY
  let d = ''
  for (let k = 0; k < 4; k++) {
    // Four arcs bulging outward, their ends curling in: the gaps read as a cross.
    const a = (k / 4) * TAU + Math.PI / 4
    const at = (ang: number, rr: number): P => [x + Math.cos(ang) * rr, y + Math.sin(ang) * rr]
    d += brush([at(a - 0.62, r * 0.42), at(a - 0.3, r * 0.86), at(a, r), at(a + 0.3, r * 0.86), at(a + 0.62, r * 0.42)], r * 0.2, r * 0.2, r * 0.08)
  }
  return P.shape(d, '#e8394a', { outline: 0.5, shade: false })
}

/** Floating Zs. */
export function drawZzz(c: Ctx, s: ExprFxSpec): string {
  if (!s.zzz) return ''
  const P = c.paint
  let d = ''
  const z = (x: number, y: number, r: number) => {
    const sw = r * 0.34
    d += brush([[x - r, y - r], [x + r, y - r]], sw, sw) + brush([[x + r, y - r], [x - r, y + r]], sw, sw) + brush([[x - r, y + r], [x + r, y + r]], sw, sw)
  }
  const u = s.unit
  z(s.halfW * 1.05, s.topY + u * 0.28, u * 0.055)
  z(s.halfW * 1.3, s.topY + u * 0.08, u * 0.075)
  z(s.halfW * 1.62, s.topY - u * 0.16, u * 0.1)
  return P.shape(d, '#c9d3ff', { outline: 0.6, shade: false })
}

/** Puffs of steam over the head. */
export function drawSteam(c: Ctx, s: ExprFxSpec): string {
  if (!s.steam) return ''
  const P = c.paint
  const u = s.unit
  let d = ''
  for (const sg of [1, -1]) {
    const x = sg * s.halfW * 0.95
    const y = s.topY + u * 0.1
    d += circle(x, y, u * 0.07) + circle(x + sg * u * 0.07, y - u * 0.06, u * 0.06) + circle(x + sg * u * 0.02, y - u * 0.13, u * 0.05)
  }
  return P.union(d.split('Z').filter(Boolean).map((p) => p + 'Z'), '#f4f1f6', { outline: 0.6, shade: false })
}

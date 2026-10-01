/* Creature coats: colour, markings and materials, applied to any body-part shape.
 *
 * `coatShape` draws a part in three layers:
 *   1. albedo: the base colour, a soft belly/underside and the markings (seeded per part and
 *      clipped to it, so spots continue believably from body to head, legs and tail);
 *   2. form: the Painter's shading laid over the albedo, so markings wrap the form;
 *   3. material: what the surface is made of. Fur strands, scale and feather tiles, wet and
 *      chitin speculars, translucent gel, metal bevels. The expensive detail is drawn for
 *      still images only (`ctx.baked`); animation frames keep a light version.
 * The outline is an ink underlay, so fur clumps merged into a silhouette get one clean outer
 * contour. */

import { highlightOf as highlightOf0, hueShift, mix as mix0, shadowOf as shadowOf0, toLch } from '../../core/color.ts'
import { clamp, lerp, norm, type Box, type P } from '../../core/math.ts'
import { blobPts, circle, ellipse, f, poly, rect, signedArea, smooth, sparkle, type SP } from '../../core/path.ts'
import { createRng, hash32, type Rng } from '../../core/rng.ts'
import { el, url } from '../../core/svg.ts'
import type { Ctx, PartList, Reader } from '../../render/context.ts'
import { pathBounds, type Material as PainterMaterial, type ShapeOpts } from '../../render/painter.ts'
import type { CreatureRig } from '../../rig/creature.ts'

/* Colour helpers, memoized: creature parts derive the same few tones over and over. */
const toneCache = new Map<string, string>()
function memo(key: string, fn: () => string): string {
  let v = toneCache.get(key)
  if (v === undefined) {
    if (toneCache.size > 4000) toneCache.clear()
    v = fn()
    toneCache.set(key, v)
  }
  return v
}
export const shadowOf = (hex: string, depth = 0.12): string => memo(`s${hex}${depth}`, () => shadowOf0(hex, depth))
export const highlightOf = (hex: string, amount = 0.1): string => memo(`h${hex}${amount}`, () => highlightOf0(hex, amount))
export const mix = (a: string, b: string, t: number): string => memo(`m${a}${b}${t}`, () => mix0(a, b, t))

/** What a coat is made of: the texture param read together with the body plan. */
export type Material = 'fur' | 'skin' | 'wet' | 'scales' | 'feathers' | 'chitin' | 'metal' | 'plastic' | 'slime' | 'jelly' | 'ghost' | 'flame' | 'rock'

export interface Coat {
  primary: string
  secondary: string
  belly: string
  accent: string
  pattern: string
  patternColor: string
  scale: number
  texture: string
  fluff: number
  /** Surface material (texture + plan): drives the material detail. */
  material: Material
  /** World size of one texture unit (strand, scale, feather), constant across the body. */
  unit: number
}

export function materialOf(c: Ctx, texture: string): Material {
  const cr = c.cr as CreatureRig | undefined
  const plan = cr?.m.plan ?? 'quadruped'
  switch (texture) {
    case 'fur':
      return 'fur'
    case 'feathers':
      return 'feathers'
    case 'rock':
      return 'rock'
    case 'scales':
      return plan === 'insectoid' ? 'chitin' : 'scales'
    case 'metal':
      return plan === 'insectoid' ? 'chitin' : 'metal'
    case 'slime':
      return plan === 'blob' ? 'slime' : plan === 'cephalopod' ? 'jelly' : 'wet'
    default: {
      if (plan === 'robot') return 'plastic'
      if (plan === 'insectoid') return 'chitin'
      if (plan === 'blob') {
        const bs = c.sec('form').s('blobShape')
        return bs === 'ghost' ? 'ghost' : bs === 'flame' ? 'flame' : 'skin'
      }
      if (plan === 'aquatic' || plan === 'cephalopod' || (plan !== 'avian' && c.sec('limbs').s('feet') === 'webbed')) return 'wet'
      return 'skin'
    }
  }
}

export function coatOf(c: Ctx): Coat {
  const co: Reader = c.sec('coat')
  const primary = co.c('primary', '#e8a55a')
  const secondary = co.c('secondary', '#f2efe9')
  const texture = co.s('texture') || 'fur'
  const S = (c.cr as CreatureRig | undefined)?.m.S ?? 1
  return {
    primary,
    secondary,
    belly: co.c('belly', mix(primary, secondary, 0.65)),
    accent: co.c('accent', '#c0392b'),
    pattern: co.s('pattern') || 'none',
    patternColor: co.c('patternColor', shadowOf(primary, 0.4)),
    scale: co.has('patternScale') ? co.n('patternScale') : 0.5,
    texture,
    fluff: c.sec('form').n('fluff'),
    material: materialOf(c, texture),
    unit: 11 * S,
  }
}

/* ---- Path utilities ----------------------------------------------------------- */

const TOKENS = /([MLHVCSQTAZmlhvcsqtaz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

function tokenize(d: string): (string | number)[] {
  const out: (string | number)[] = []
  let m: RegExpExecArray | null
  TOKENS.lastIndex = 0
  while ((m = TOKENS.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]))
  return out
}

/** Scales then translates a path: x' = x·sx + tx (arcs keep their shape; rotation-free). */
export function xformPath(d: string, sx: number, sy: number, tx: number, ty: number): string {
  if (!d) return ''
  const t = tokenize(d)
  let out = ''
  let cmd = ''
  let i = 0
  let first = true
  while (i < t.length) {
    const tok = t[i]
    if (typeof tok === 'string') {
      cmd = tok
      out += tok
      i++
      if (cmd === 'Z' || cmd === 'z') continue
    }
    const up = cmd.toUpperCase()
    const n = ARGS[up] ?? 0
    if (n === 0 || i + n > t.length || typeof t[i] === 'string') {
      i++
      continue
    }
    const a = t.slice(i, i + n) as number[]
    i += n
    const rel = cmd !== up && !(first && up === 'M')
    first = false
    const X = (v: number) => f(rel ? v * sx : v * sx + tx)
    const Y = (v: number) => f(rel ? v * sy : v * sy + ty)
    let s: string[]
    switch (up) {
      case 'H':
        s = [X(a[0])]
        break
      case 'V':
        s = [Y(a[0])]
        break
      case 'A':
        s = [f(a[0] * Math.abs(sx)), f(a[1] * Math.abs(sy)), f(a[2]), String(a[3]), String(sx * sy < 0 ? 1 - a[4] : a[4]), X(a[5]), Y(a[6])]
        break
      default:
        s = []
        for (let k = 0; k < n; k += 2) s.push(X(a[k]), Y(a[k + 1]))
    }
    out += (out.endsWith(cmd) ? '' : ' ') + s.join(' ')
  }
  return out
}

export const shiftPath = (d: string, dx: number, dy: number): string => xformPath(d, 1, 1, dx, dy)

const CRESCENT = /^M-?[\d.]+ -?[\d.]+h-?[\d.]+v-?[\d.]+h-?[\d.]+Z ?/
const GEOM = /<(path|ellipse|circle)\b([^>]*?)\/?>/g
const ATTR = (a: string, k: string): string | undefined => new RegExp(`\\s${k}="([^"]*)"`).exec(a)?.[1]

/**
 * A part's local bounds from its geometry, for culling and the `fit` crop. The Painter's
 * standard shading crescent (a padded rectangle around the shape) and soft gradient glows
 * are left out, so crops hug the creature rather than its lighting.
 */
export function partBox(svg: string): Box | undefined {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (b: Box) => {
    if (!b.w && !b.h) return
    if (b.x < x0) x0 = b.x
    if (b.y < y0) y0 = b.y
    if (b.x + b.w > x1) x1 = b.x + b.w
    if (b.y + b.h > y1) y1 = b.y + b.h
  }
  let m: RegExpExecArray | null
  GEOM.lastIndex = 0
  while ((m = GEOM.exec(svg))) {
    const a = m[2]
    if (m[1] === 'path') {
      const d = ATTR(a, 'd')
      if (d) add(fastBounds(d.replace(CRESCENT, '')))
      continue
    }
    if ((ATTR(a, 'fill') ?? '').startsWith('url(')) continue
    const cx = +(ATTR(a, 'cx') ?? 0)
    const cy = +(ATTR(a, 'cy') ?? 0)
    const rx = +(ATTR(a, 'rx') ?? ATTR(a, 'r') ?? 0)
    const ry = +(ATTR(a, 'ry') ?? ATTR(a, 'r') ?? 0)
    add({ x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 })
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined
}

/** A PartList that fills in `partBox` bounds for parts added without explicit bounds. */
export function boxedParts(out: PartList): PartList {
  return {
    parts: out.parts,
    add(bone: string, z: number, id: string, svg: string, dynamic = false, bounds?: Box): void {
      out.add(bone, z, id, svg, dynamic, bounds ?? partBox(svg))
    },
  } as PartList
}

/**
 * Local bounds of SVG art as it lands under `translate(tx ty) rotate(rotDeg) scale(sx sy)`:
 * parts drawn inside a transform pass these to `PartList.add`, since culling and the `fit`
 * crop only read path data.
 */
export function artBounds(svg: string, sx = 1, sy = 1, tx = 0, ty = 0, rotDeg = 0): Box | undefined {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const a = (rotDeg * Math.PI) / 180
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const re = /\sd="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    const b = fastBounds(m[1])
    if (!b.w && !b.h) continue
    for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
      const x = px * sx
      const y = py * sy
      const X = x * ca - y * sa + tx
      const Y = x * sa + y * ca + ty
      if (X < x0) x0 = X
      if (X > x1) x1 = X
      if (Y < y0) y0 = Y
      if (Y > y1) y1 = Y
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined
}

/**
 * Bounds of path data, like the Painter's `pathBounds` (endpoints and control points, arcs
 * padded by their radii) but with a hand-rolled scanner: coat shapes call it a lot.
 */
const FB_ARGS = new Float64Array(8)

export function fastBounds(d: string): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let up = 77 // 'M'
  let rel = false
  let k = 2
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const a = FB_ARGS
  let na = 0
  const n = d.length
  let i = 0
  while (i < n) {
    let ch = d.charCodeAt(i)
    // A command letter (but not the exponent marker of a number).
    if (((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) && ch !== 101 && ch !== 69) {
      rel = ch >= 97
      up = rel ? ch - 32 : ch
      k = up === 77 || up === 76 || up === 84 ? 2 : up === 72 || up === 86 ? 1 : up === 67 ? 6 : up === 83 || up === 81 ? 4 : up === 65 ? 7 : 0
      na = 0
      if (up === 90) {
        x = sx
        y = sy
      }
      i++
      continue
    }
    if (ch !== 45 && ch !== 46 && (ch < 48 || ch > 57)) {
      i++
      continue
    }
    // A number: sign, digits, fraction, optional exponent.
    let neg = false
    if (ch === 45) {
      neg = true
      i++
      ch = d.charCodeAt(i)
    }
    let v = 0
    while (ch >= 48 && ch <= 57) {
      v = v * 10 + (ch - 48)
      ch = d.charCodeAt(++i)
    }
    if (ch === 46) {
      let s = 0.1
      ch = d.charCodeAt(++i)
      while (ch >= 48 && ch <= 57) {
        v += (ch - 48) * s
        s *= 0.1
        ch = d.charCodeAt(++i)
      }
    }
    if (ch === 101 || ch === 69) {
      ch = d.charCodeAt(++i)
      let eneg = false
      if (ch === 45 || ch === 43) {
        eneg = ch === 45
        ch = d.charCodeAt(++i)
      }
      let e = 0
      while (ch >= 48 && ch <= 57) {
        e = e * 10 + (ch - 48)
        ch = d.charCodeAt(++i)
      }
      v *= Math.pow(10, eneg ? -e : e)
    }
    a[na++] = neg ? -v : v
    if (k === 0 || na < k) continue
    // A complete segment.
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    if (up === 72) x = a[0] + ox
    else if (up === 86) y = a[0] + oy
    else if (up === 65) {
      const rx = a[0]
      const ry = a[1]
      if (x - rx < x0) x0 = x - rx
      if (x + rx > x1) x1 = x + rx
      if (y - ry < y0) y0 = y - ry
      if (y + ry > y1) y1 = y + ry
      x = a[5] + ox
      y = a[6] + oy
      if (x - rx < x0) x0 = x - rx
      if (x + rx > x1) x1 = x + rx
      if (y - ry < y0) y0 = y - ry
      if (y + ry > y1) y1 = y + ry
    } else {
      for (let j = 0; j < k - 2; j += 2) {
        const px = a[j] + ox
        const py = a[j + 1] + oy
        if (px < x0) x0 = px
        if (px > x1) x1 = px
        if (py < y0) y0 = py
        if (py > y1) y1 = py
      }
      x = a[k - 2] + ox
      y = a[k - 1] + oy
    }
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    if (up === 77) {
      sx = x
      sy = y
      up = 76
    }
    na = 0
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** A path scaled about a point (insets and outsets of roughly convex shapes). */
export function scalePathAbout(d: string, s: number, cx: number, cy: number): string {
  return xformPath(d, s, s, cx - cx * s, cy - cy * s)
}

function arcPoints(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number, step: number): P[] {
  if (rx === 0 || ry === 0) return [[x2, y2]]
  const phi = (phiDeg * Math.PI) / 180
  const cp = Math.cos(phi)
  const sp = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cp * dx + sp * dy
  const y1p = -sp * dx + cp * dy
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) {
    rx *= Math.sqrt(lam)
    ry *= Math.sqrt(lam)
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, den ? num / den : 0))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2
  const cy = sp * cxp + cp * cyp + (y1 + y2) / 2
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    return a
  }
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dt > 0) dt -= Math.PI * 2
  else if (fs && dt < 0) dt += Math.PI * 2
  const n = Math.max(2, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / step))
  const out: P[] = []
  for (let i = 1; i <= n; i++) {
    const tt = t1 + (dt * i) / n
    out.push([cx + rx * Math.cos(tt) * cp - ry * Math.sin(tt) * sp, cy + rx * Math.cos(tt) * sp + ry * Math.sin(tt) * cp])
  }
  return out
}

/**
 * A tapered stroke through a few points, as a filled outline: like `brush` but without
 * densifying the spine first, so marks, whiskers and wisps stay light in the document.
 */
export function leaf(points: P[], w0: number, w1: number, bulge = 0): string {
  const n = points.length
  if (n < 2) return ''
  const left: SP[] = []
  const right: SP[] = []
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    const d = norm([b[0] - a[0], b[1] - a[1]])
    const t = i / (n - 1)
    const r = Math.max(0, lerp(w0, w1, t) / 2 + Math.sin(t * Math.PI) * bulge * 0.5)
    left.push([points[i][0] - d[1] * r, points[i][1] + d[0] * r])
    right.push([points[i][0] + d[1] * r, points[i][1] - d[0] * r])
  }
  const dirOf = (i: number, j: number): P => norm([points[j][0] - points[i][0], points[j][1] - points[i][1]])
  const e = dirOf(n - 2, n - 1)
  const s0 = dirOf(1, 0)
  const r0 = w0 / 2
  const r1 = w1 / 2
  const endCap: SP[] = []
  const startCap: SP[] = []
  if (r1 < 0.05) {
    left[n - 1] = [points[n - 1][0], points[n - 1][1], 0]
    right.pop()
  } else endCap.push([points[n - 1][0] + e[0] * r1, points[n - 1][1] + e[1] * r1])
  if (r0 < 0.05) {
    left[0] = [points[0][0], points[0][1], 0]
    right.shift()
  } else startCap.push([points[0][0] + s0[0] * r0, points[0][1] + s0[1] * r0])
  return smooth([...left, ...endCap, ...right.reverse(), ...startCap])
}

/** Polylines approximating each subpath, points roughly `step` apart. */
export function samplePath(d: string, step: number): P[][] {
  const t = tokenize(d)
  const subs: P[][] = []
  let cur: P[] = []
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let cmd = ''
  let i = 0
  const seg = (pts: (tt: number) => P, len: number) => {
    const n = Math.max(1, Math.ceil(len / step))
    for (let k = 1; k <= n; k++) cur.push(pts(k / n))
  }
  while (i < t.length) {
    if (typeof t[i] === 'string') {
      cmd = t[i] as string
      i++
      if (cmd === 'Z' || cmd === 'z') {
        x = sx
        y = sy
        if (cur.length > 1) subs.push(cur)
        cur = []
        continue
      }
    }
    const up = cmd.toUpperCase()
    const n = ARGS[up] ?? 0
    if (n === 0 || i + n > t.length || typeof t[i] === 'string') {
      i++
      continue
    }
    const a = t.slice(i, i + n) as number[]
    i += n
    const rel = cmd !== up
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    switch (up) {
      case 'M':
        if (cur.length > 1) subs.push(cur)
        x = a[0] + ox
        y = a[1] + oy
        sx = x
        sy = y
        cur = [[x, y]]
        cmd = rel ? 'l' : 'L'
        break
      case 'L':
      case 'T': {
        const x0 = x
        const y0 = y
        const x1 = a[0] + ox
        const y1 = a[1] + oy
        seg((u) => [lerp(x0, x1, u), lerp(y0, y1, u)], Math.hypot(x1 - x0, y1 - y0))
        x = x1
        y = y1
        break
      }
      case 'H': {
        const x0 = x
        const x1 = a[0] + ox
        seg((u) => [lerp(x0, x1, u), y], Math.abs(x1 - x0))
        x = x1
        break
      }
      case 'V': {
        const y0 = y
        const y1 = a[0] + oy
        seg((u) => [x, lerp(y0, y1, u)], Math.abs(y1 - y0))
        y = y1
        break
      }
      case 'C':
      case 'S':
      case 'Q': {
        const pts: P[] = [[x, y]]
        for (let k = 0; k < n; k += 2) pts.push([a[k] + ox, a[k + 1] + oy])
        const L = pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0)
        if (pts.length === 4) {
          const [p0, p1, p2, p3] = pts
          seg((u) => {
            const v = 1 - u
            return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]
          }, L)
        } else {
          const [p0, p1, p2] = pts
          seg((u) => {
            const v = 1 - u
            return [v * v * p0[0] + 2 * v * u * p1[0] + u * u * p2[0], v * v * p0[1] + 2 * v * u * p1[1] + u * u * p2[1]]
          }, L)
        }
        x = pts[pts.length - 1][0]
        y = pts[pts.length - 1][1]
        break
      }
      case 'A': {
        const x1 = a[5] + ox
        const y1 = a[6] + oy
        for (const p of arcPoints(x, y, a[0], a[1], a[2], a[3], a[4], x1, y1, step)) cur.push(p)
        x = x1
        y = y1
        break
      }
    }
  }
  if (cur.length > 1) subs.push(cur)
  return subs
}

/** Outward unit normal at sample i of a closed polyline with orientation `sign` (signedArea sign). */
function normalAt(pts: P[], i: number, sign: number): P {
  const n = pts.length
  const a = pts[(i - 1 + n) % n]
  const b = pts[(i + 1) % n]
  const t = norm([b[0] - a[0], b[1] - a[1]])
  return sign > 0 ? [t[1], -t[0]] : [-t[1], t[0]]
}

/* ---- Fur on the silhouette --------------------------------------------------- */

export interface FurEdgeOpts {
  /** How far clumps stick out (world units). */
  depth: number
  /** Clump spacing along the edge (world units). */
  spacing: number
  /** Weight 0..1 per edge point from its outward normal and position (default: everywhere). */
  where?: (n: P, p: P) => number
  /** Direction the clumps lean toward (fur flow), local space. */
  lean?: P
  seed: string
  /** The clumps are the shape (a plume, a ruff): keep them in animation frames too. */
  essential?: boolean
}

/**
 * Clumped fur along a silhouette: pointed tufts as extra subpaths with the same winding as
 * the outline, so `d + furEdge(...)` fills as one mass and takes one outer contour.
 */
export function furEdge(c: Ctx, d: string, o: FurEdgeOpts): string {
  if (c.paint.detail < 1 || o.depth <= 0.5) return ''
  // Animation frames and medium detail keep only the clumps that make the silhouette.
  if ((!c.baked || c.paint.detail < 2) && !o.essential) return ''
  // Medium detail: fewer, broader clumps.
  const spacing = o.spacing * (c.paint.detail < 2 ? 1.6 : 1)
  const sub = samplePath(d, spacing / 4)[0]
  if (!sub || sub.length < 6) return ''
  const sign = signedArea(sub) > 0 ? 1 : -1
  const rng = createRng(hash32(c.dna.seed, 'fur', o.seed))
  const lean = o.lean ?? [0, 0]
  // Cumulative length.
  const cum: number[] = [0]
  for (let i = 1; i < sub.length; i++) cum.push(cum[i - 1] + Math.hypot(sub[i][0] - sub[i - 1][0], sub[i][1] - sub[i - 1][1]))
  const total = cum[cum.length - 1]
  const idxAt = (s: number) => {
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < s) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  let out = ''
  let s = rng.range(0, spacing * 0.5)
  while (s < total - spacing * 0.3) {
    const len = spacing * rng.range(0.75, 1.25)
    const ia = idxAt(s)
    const ib = idxAt(Math.min(total, s + len))
    const im = idxAt(s + len / 2)
    s += len * rng.range(0.55, 0.8)
    const p = sub[im]
    const nrm = normalAt(sub, im, sign)
    const w = o.where ? o.where(nrm, p) : 1
    if (w <= 0.08) continue
    const dep = o.depth * clamp(w, 0, 1) * rng.range(0.65, 1.15)
    const a = sub[ia]
    const b = sub[ib]
    const inset = dep * 0.45
    const na = normalAt(sub, ia, sign)
    const nb = normalAt(sub, ib, sign)
    const ra: P = [a[0] - na[0] * inset, a[1] - na[1] * inset]
    const rb: P = [b[0] - nb[0] * inset, b[1] - nb[1] * inset]
    const lx = lean[0] * dep * 0.7 + rng.range(-0.25, 0.25) * dep
    const ly = lean[1] * dep * 0.7 + rng.range(-0.25, 0.25) * dep
    const tip: P = [p[0] + nrm[0] * dep + lx, p[1] + nrm[1] * dep + ly]
    const ma: P = [lerp(a[0], tip[0], 0.5) + nrm[0] * dep * 0.12, lerp(a[1], tip[1], 0.5) + nrm[1] * dep * 0.12]
    const mb: P = [lerp(b[0], tip[0], 0.5) + nrm[0] * dep * 0.05, lerp(b[1], tip[1], 0.5) + nrm[1] * dep * 0.05]
    let pts: SP[] = [ra, ma, [tip[0], tip[1], 0], mb, rb]
    if ((signedArea(pts.map((q) => [q[0], q[1]] as P)) > 0 ? 1 : -1) !== sign) pts = pts.reverse()
    out += smooth(pts)
  }
  return out
}

/** Fur tufts for fluffy coats as their own outlined mass (cheek and chest ruffs). */
export function tufts(c: Ctx, pts: [number, number][], size: number, color: string): string {
  if (c.paint.detail < 1) return ''
  let d = ''
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const mx = (ax + bx) / 2
    const my = (ay + by) / 2
    const nx = -(by - ay)
    const ny = bx - ax
    const L = Math.hypot(nx, ny) || 1
    d += smooth([[ax, ay], [mx + (nx / L) * size * 0.45 - (bx - ax) * 0.12, my + (ny / L) * size * 0.45 - (by - ay) * 0.12], [mx + (nx / L) * size, my + (ny / L) * size, 0], [bx, by]])
  }
  return c.paint.union([d], color, { outline: 0.7, shade: 0.5 })
}

export const lightOf = (hex: string, k = 0.2) => highlightOf(hex, k)

/* ---- Gradients ------------------------------------------------------------------ */

/** A colour that fades out toward the edge of whatever it fills (soft bellies, blush). */
export function softFill(c: Ctx, color: string, kind: 'radial' | 'top' | 'bottom' = 'radial', hold = 0.55): string {
  const col = c.paint.col(color)
  const id = c.defs.add(`cs${kind}${col.slice(1)}${Math.round(hold * 100)}`, (gid) =>
    kind === 'radial'
      ? el(
          'radialGradient',
          { id: gid, cx: 0.5, cy: 0.5, r: 0.5 },
          el('stop', { offset: 0, 'stop-color': col }),
          el('stop', { offset: f(hold), 'stop-color': col }),
          el('stop', { offset: 1, 'stop-color': col, 'stop-opacity': 0 }),
        )
      : el(
          'linearGradient',
          { id: gid, x1: 0, y1: kind === 'top' ? 0 : 1, x2: 0, y2: kind === 'top' ? 1 : 0 },
          el('stop', { offset: 0, 'stop-color': col, 'stop-opacity': 0 }),
          el('stop', { offset: f(1 - hold), 'stop-color': col }),
          el('stop', { offset: 1, 'stop-color': col }),
        ),
  )
  return url(id)
}

/** A radial highlight blob (sheen, speculars, glows): colour at the centre fading to nothing. */
export function glowFill(c: Ctx, color: string, alpha = 1, falloff = 0.5): string {
  const col = c.paint.col(color)
  const id = c.defs.add(`cg${col.slice(1)}${Math.round(alpha * 100)}${Math.round(falloff * 100)}`, (gid) =>
    el(
      'radialGradient',
      { id: gid, cx: 0.5, cy: 0.5, r: 0.5 },
      el('stop', { offset: 0, 'stop-color': col, 'stop-opacity': f(alpha) }),
      el('stop', { offset: f(falloff), 'stop-color': col, 'stop-opacity': f(alpha * 0.45) }),
      el('stop', { offset: 1, 'stop-color': col, 'stop-opacity': 0 }),
    ),
  )
  return url(id)
}

/* ---- Markings ------------------------------------------------------------------- */

export type Role = 'body' | 'head' | 'leg' | 'tail'

export interface MarkHints {
  /** Head drawn facing the camera. */
  frontal?: boolean
  /** Eye centres, head space (masks and eye patches). */
  eyes?: P[]
  /** Leg is a lower segment (socks sit on it). */
  lower?: boolean
}

/** Markings for one region (in that part's local space), before clipping. */
function markings(c: Ctx, coat: Coat, bb: Box, key: string, role: Role, hint: MarkHints): string {
  const P = c.paint
  const rng = createRng(hash32(c.dna.seed, key))
  const k = lerp(0.55, 1.6, coat.scale)
  const col = coat.patternColor
  const { x, y, w, h } = bb
  const horiz = w >= h
  const thick = horiz ? h : w
  const long = horiz ? w : h
  // Map (along, across) in 0..1 to local space: along the long axis, across the short one.
  const at = (u: number, v: number): P => (horiz ? [x + u * w, y + v * h] : [x + v * w, y + u * h])
  switch (coat.pattern) {
    case 'spots': {
      const r0 = thick * 0.085 * k
      const count = clamp(Math.round((long * thick) / (r0 * r0 * 16)), 3, role === 'body' ? 16 : 6)
      const placed: [number, number, number][] = []
      let d = ''
      for (let tries = 0; tries < count * 5 && placed.length < count; tries++) {
        const u = rng.range(0.06, 0.94)
        const v = role === 'body' ? Math.pow(rng.next(), 1.4) * 0.66 + 0.04 : rng.range(0.05, 0.95)
        const [cx, cy] = at(u, v)
        const r = r0 * rng.range(0.55, 1.25) * (role === 'head' ? 0.7 : 1)
        if (placed.some(([px, py, pr]) => Math.hypot(px - cx, py - cy) < (pr + r) * 1.25)) continue
        placed.push([cx, cy, r])
        d += smooth(blobPts(cx, cy, r * rng.range(0.95, 1.2), r * rng.range(0.8, 1), rng, 6, 0.12))
      }
      return P.flat(d, col, 0.95)
    }
    case 'rosettes': {
      const r0 = thick * 0.11 * k
      const count = clamp(Math.round((long * thick) / (r0 * r0 * 14)), 3, role === 'body' ? 12 : 5)
      let ring = ''
      let centre = ''
      const placed: P[] = []
      for (let tries = 0; tries < count * 5 && placed.length < count; tries++) {
        const [cx, cy] = at(rng.range(0.05, 0.95), role === 'body' ? rng.range(0.05, 0.72) : rng.range(0.05, 0.95))
        const r = r0 * rng.range(0.7, 1.15) * (role === 'head' ? 0.65 : 1)
        if (placed.some(([px, py]) => Math.hypot(px - cx, py - cy) < r * 2.3)) continue
        placed.push([cx, cy])
        centre += smooth(blobPts(cx, cy, r * 0.75, r * 0.65, rng, 6, 0.15))
        // A broken ring: 3–4 thick arcs with gaps.
        const parts = rng.int(3, 4)
        const phase = rng.range(0, Math.PI * 2)
        for (let i = 0; i < parts; i++) {
          const a0 = phase + (i / parts) * Math.PI * 2
          const a1 = a0 + (Math.PI * 2 / parts) * rng.range(0.55, 0.75)
          const pts: P[] = []
          for (let j = 0; j <= 4; j++) {
            const a = lerp(a0, a1, j / 4)
            pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85])
          }
          ring += leaf(pts, r * 0.18, r * 0.12, r * 0.2)
        }
      }
      return P.flat(centre, mix(coat.primary, col, 0.35), 0.9) + P.flat(ring, col, 0.95)
    }
    case 'patches': {
      let d = ''
      if (role === 'head' && hint.eyes?.length) {
        const e = hint.eyes[rng.next() < 0.5 ? 0 : hint.eyes.length - 1]
        const r = thick * 0.26 * k
        d += smooth(blobPts(e[0] + r * 0.1, e[1] - r * 0.05, r * 1.05, r * 0.95, rng, 7, 0.14))
      } else {
        const n = role === 'body' ? 3 : 1
        for (let i = 0; i < n; i++) {
          if (role !== 'body' && rng.next() < 0.4) continue
          const [cx, cy] = at(role === 'body' ? (i + rng.range(0.15, 0.85)) / n : rng.range(0.2, 0.8), role === 'body' ? rng.range(0.05, 0.45) : rng.range(0.2, 0.8))
          const r = thick * rng.range(0.28, 0.42) * k
          d += smooth(blobPts(cx, cy, r * (horiz ? 1.25 : 0.9), r, rng, 8, 0.2))
        }
      }
      return P.flat(d, col, 0.97)
    }
    case 'stripes':
    case 'tiger': {
      const tiger = coat.pattern === 'tiger'
      let d = ''
      if (role === 'head') {
        const cx = x + w / 2
        if (hint.frontal) {
          // Forehead "M" and cheek stripes.
          for (const dx of [-0.16, 0, 0.16]) d += leaf([[cx + dx * w, y - 2], [cx + dx * w * 1.1, y + h * (dx ? 0.2 : 0.26)]], w * (tiger ? 0.07 : 0.05) * k, 0, w * 0.02)
          for (const s of [-1, 1])
            for (let i = 0; i < 2; i++) {
              const yy = y + h * (0.48 + i * 0.12)
              d += leaf([[cx + (s * w) / 2 + s * 2, yy], [cx + s * w * 0.3, yy + h * 0.02], [cx + s * w * 0.2, yy + h * 0.05]], h * (tiger ? 0.07 : 0.05) * k, 0)
            }
        } else {
          for (let i = 0; i < 3; i++) {
            const xx = x + w * (0.25 + i * 0.15)
            d += leaf([[xx, y - 2], [xx + w * 0.04, y + h * 0.28]], w * 0.07 * k, 0)
          }
        }
        return P.flat(d, col, 0.95)
      }
      const gap = thick * (tiger ? 0.42 : 0.34) * k
      const n = Math.max(2, Math.round(long / gap))
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5 + rng.range(-0.15, 0.15)) / n
        const wid = (long / n) * (tiger ? 0.36 : 0.3)
        if (role === 'body') {
          const reach = tiger ? rng.range(0.5, 0.8) : rng.range(0.38, 0.6)
          const lean = rng.range(-0.25, 0.25) * wid
          const a = at(u, -0.03)
          const m = at(u, reach * 0.5)
          const b = at(u, reach)
          d += leaf([a, [m[0] + lean, m[1]], [b[0] + lean * 1.5, b[1]]], wid, 0, tiger ? wid * 0.25 : 0)
          if (tiger && i % 2 === 1) {
            const c0 = at(u + 0.5 / n, 1.03)
            const c1 = at(u + 0.5 / n, 1 - reach * 0.5)
            d += leaf([c0, c1], wid * 0.8, 0)
          }
        } else {
          // Rings across legs and tails, tapering at one side.
          const a = at(u, -0.05)
          const b = at(u + rng.range(-0.1, 0.1) / n, role === 'tail' ? 1.05 : rng.range(0.65, 1.05))
          d += leaf([a, b], wid, role === 'tail' ? wid * 0.8 : wid * 0.15)
        }
      }
      return P.flat(d, col, 0.94)
    }
    case 'bands': {
      if (role === 'head') return ''
      const gap = thick * 0.62 * k
      const n = Math.max(1, Math.round(long / gap))
      let d = ''
      for (let i = 0; i < n; i++) {
        if (role === 'leg' && i % 2 === 1) continue
        const u0 = (i + 0.3) / n
        const u1 = (i + 0.72) / n
        const bow = ((u1 - u0) * 0.35)
        const pts: SP[] = [at(u0, -0.05), at(u1, -0.05), [...at(u1 + bow, 0.5), 1] as SP, at(u1, 1.05), at(u0, 1.05), [...at(u0 + bow, 0.5), 1] as SP]
        d += smooth(pts.map((p, j) => (j === 2 || j === 5 ? p : ([p[0], p[1], 0.2] as SP))))
      }
      return P.flat(d, col, 0.96)
    }
    case 'socks':
      if (role === 'leg' && hint.lower !== false) {
        const top = y + h * (hint.lower ? 0.35 : 0.55)
        const pts: SP[] = [[x - 4, y + h + 4], [x - 4, top + h * 0.04]]
        const teeth = 4
        for (let i = 1; i < teeth * 2; i++) pts.push([x + (w * i) / (teeth * 2), top + (i % 2 ? -h * 0.05 : h * 0.02), i % 2 ? 0 : 0.6])
        pts.push([x + w + 4, top], [x + w + 4, y + h + 4])
        return P.flat(smooth(pts), col)
      }
      if (role === 'tail') return P.flat(smooth([[x - 4, y - 4], [x + w * 0.22, y - 4], [x + w * 0.28, y + h * 0.5, 0.4], [x + w * 0.22, y + h + 4], [x - 4, y + h + 4]]), col)
      return ''
    case 'saddle':
      if (role === 'body') {
        const pts: SP[] = [[x + w * 0.1, y - 4], [x + w * 0.9, y - 4], [x + w * 0.82, y + h * 0.28], [x + w * 0.6, y + h * 0.42], [x + w * 0.4, y + h * 0.46], [x + w * 0.2, y + h * 0.34]]
        return P.flat(smooth(pts), col, 0.95)
      }
      if (role === 'tail') return P.flat(rect(x - 2, y - 2, w + 4, h * 0.45), col, 0.9)
      if (role === 'head' && !hint.frontal) return P.flat(smooth([[x + w * 0.1, y - 2], [x + w * 0.75, y - 2], [x + w * 0.5, y + h * 0.18], [x + w * 0.15, y + h * 0.25]]), col, 0.85)
      return ''
    case 'mask': {
      if (role !== 'head') return ''
      const eyes = hint.eyes ?? []
      if (hint.frontal && eyes.length >= 2) {
        const [a, b] = [eyes[0], eyes[eyes.length - 1]]
        const r = Math.abs(b[0] - a[0]) * 0.42
        const lx = Math.min(a[0], b[0])
        const rx = Math.max(a[0], b[0])
        const ey = (a[1] + b[1]) / 2
        return P.flat(smooth([[lx - r * 1.5, ey - r * 0.2], [lx - r * 0.2, ey - r * 0.95], [(lx + rx) / 2, ey - r * 0.35], [rx + r * 0.2, ey - r * 0.95], [rx + r * 1.5, ey - r * 0.2], [rx + r * 0.6, ey + r * 0.9], [(lx + rx) / 2, ey + r * 0.35], [lx - r * 0.6, ey + r * 0.9]]), col, 0.95)
      }
      const e = eyes[0] ?? [x + w * 0.62, y + h * 0.42]
      const r = h * 0.18
      return P.flat(smooth([[e[0] + r * 1.1, e[1] - r * 0.1], [e[0], e[1] - r * 0.9], [x + w * 0.1, e[1] - r * 0.6], [x + w * 0.08, e[1] + r * 0.5], [e[0] - r * 0.2, e[1] + r * 0.95]]), col, 0.95)
    }
    case 'gradient': {
      const paint = softFill(c, col, 'top', role === 'leg' ? 0.55 : 0.5)
      return el('rect', { x: f(x - 2), y: f(y + h * (role === 'leg' ? 0.3 : 0.35)), width: f(w + 4), height: f(h * (role === 'leg' ? 0.72 : 0.67)), fill: paint })
    }
    case 'scales':
      return el('rect', { x: f(x - 2), y: f(y - 2), width: f(w + 4), height: f(h * (role === 'body' ? 0.75 : 1) + 4), fill: tilePaint(c, coat, 'scaleMark') })
    case 'stars': {
      let dots = ''
      let big = ''
      let neb = ''
      const n = clamp(Math.round((w * h) / (coat.unit * coat.unit * 18)), 6, 30)
      for (let i = 0; i < n; i++) {
        const px = x + rng.next() * w
        const py = y + rng.next() * h
        if (i % 5 === 0) big += sparkle(px, py, coat.unit * rng.range(0.7, 1.2))
        else dots += circle(px, py, coat.unit * rng.range(0.1, 0.22))
      }
      if (c.baked) for (let i = 0; i < 2; i++) neb += el('ellipse', { cx: f(x + rng.range(0.2, 0.8) * w), cy: f(y + rng.range(0.2, 0.8) * h), rx: f(w * rng.range(0.25, 0.45)), ry: f(h * rng.range(0.2, 0.35)), fill: glowFill(c, col, 0.45, 0.4) })
      return neb + P.flat(dots, mix(col, '#ffffff', 0.5), 0.95) + P.flat(big, mix(col, '#ffffff', 0.7))
    }
    case 'circuit': {
      let d = ''
      let pads = ''
      const n = clamp(Math.round((w * h) / (coat.unit * coat.unit * 60)), 2, 7)
      const s = coat.unit * 2.2
      for (let i = 0; i < n; i++) {
        let px = x + rng.range(0.1, 0.9) * w
        let py = y + rng.range(0.1, 0.9) * h
        d += `M${f(px)} ${f(py)}`
        pads += circle(px, py, coat.unit * 0.35)
        for (let j = 0; j < 3; j++) {
          if (j % 2 === 0) px += (rng.next() < 0.5 ? -1 : 1) * s * rng.range(1, 2.5)
          else py += (rng.next() < 0.5 ? -1 : 1) * s * rng.range(0.6, 1.6)
          d += `L${f(px)} ${f(py)}`
        }
        pads += circle(px, py, coat.unit * 0.4)
      }
      const glow = c.baked ? P.line(d, col, coat.unit * 0.55, { opacity: 0.25 }) : ''
      return glow + P.line(d, col, coat.unit * 0.2) + P.flat(pads, col)
    }
  }
  return ''
}

/* ---- Tile textures (scales, feathers) --------------------------------------------- */

/** A tiled texture as paint. Tiles are in local (bone) space, so they ride with the part. */
function tilePaint(c: Ctx, coat: Coat, kind: 'scales' | 'scaleMark' | 'feathers' | 'feathersFine'): string {
  const P = c.paint
  const u = coat.unit * (kind === 'feathers' ? 1.25 : kind === 'feathersFine' ? 0.8 : 0.95) * lerp(0.8, 1.25, coat.scale)
  const dark = P.col(mix(shadowOf(coat.primary, 0.55), '#1a1224', 0.35))
  const lite = P.col(highlightOf(coat.primary, 0.6))
  const markC = P.col(coat.patternColor)
  return url(
    c.defs.add(`tile${kind}${Math.round(u * 10)}${(kind === 'scaleMark' ? markC : dark).slice(1)}`, (id) => {
      const w = u * 2
      const h = kind.startsWith('feathers') ? u * 1.7 : u * 1.5
      const rowH = h / 2
      let arcs = ''
      let hl = ''
      let fill = ''
      let shaft = ''
      for (const [cx, cy] of [[0, 0], [w, 0], [u, rowH], [0, h], [w, h], [u, -rowH]] as P[]) {
        const r = u
        if (kind.startsWith('feathers')) {
          const ry = rowH * 1.35
          arcs += `M${f(cx - r * 0.98)} ${f(cy)}C${f(cx - r * 0.98)} ${f(cy + ry * 0.8)} ${f(cx - r * 0.35)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}C${f(cx + r * 0.35)} ${f(cy + ry)} ${f(cx + r * 0.98)} ${f(cy + ry * 0.8)} ${f(cx + r * 0.98)} ${f(cy)}`
          shaft += `M${f(cx)} ${f(cy + ry * 0.15)}L${f(cx)} ${f(cy + ry * 0.85)}`
          hl += ellipse(cx, cy + ry * 0.7, r * 0.55, ry * 0.2)
        } else {
          arcs += `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(rowH * 1.25)} 0 0 0 ${f(cx + r)} ${f(cy)}`
          fill += `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(rowH * 1.25)} 0 0 0 ${f(cx + r)} ${f(cy)}Z`
          hl += ellipse(cx - r * 0.15, cy + rowH * 0.45, r * 0.42, rowH * 0.28)
        }
      }
      let content: string
      if (kind === 'scaleMark') content = el('path', { d: arcs, fill: 'none', stroke: markC, 'stroke-width': f(u * 0.13), 'stroke-opacity': 0.6 })
      else if (kind === 'scales')
        content =
          el('path', { d: fill, fill: dark, 'fill-opacity': 0.05 }) +
          el('path', { d: hl, fill: lite, 'fill-opacity': 0.2 }) +
          el('path', { d: arcs, fill: 'none', stroke: dark, 'stroke-width': f(u * 0.11), 'stroke-opacity': 0.26 })
      else
        content =
          el('path', { d: hl, fill: lite, 'fill-opacity': 0.13 }) +
          el('path', { d: arcs, fill: 'none', stroke: dark, 'stroke-width': f(u * 0.08), 'stroke-opacity': 0.17 }) +
          el('path', { d: shaft, fill: 'none', stroke: dark, 'stroke-width': f(u * 0.04), 'stroke-opacity': 0.08 })
      return el('pattern', { id, patternUnits: 'userSpaceOnUse', x: 0, y: 0, width: f(w), height: f(h) }, content)
    }),
  )
}

/* ---- Material detail ---------------------------------------------------------------- */

const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]

/** A thin tapered sliver (one hair) from p along dir. */
function strand(p: P, dir: P, len: number, wid: number, bend: number): string {
  const nx = -dir[1]
  const ny = dir[0]
  const tip: P = [p[0] + dir[0] * len + nx * bend, p[1] + dir[1] * len + ny * bend]
  const mx = p[0] + dir[0] * len * 0.55 + nx * bend * 0.7
  const my = p[1] + dir[1] * len * 0.55 + ny * bend * 0.7
  return `M${f(p[0] + nx * wid)} ${f(p[1] + ny * wid)}Q${f(mx + nx * wid * 0.4)} ${f(my + ny * wid * 0.4)} ${f(tip[0])} ${f(tip[1])}Q${f(mx - nx * wid * 0.4)} ${f(my - ny * wid * 0.4)} ${f(p[0] - nx * wid)} ${f(p[1] - ny * wid)}Z`
}

export type Flow = P | 'radial'

/** Fur strands: dark on the shadow side, light on the lit side, hugging the silhouette. */
function furStrands(c: Ctx, coat: Coat, d: string, bb: Box, base: string, flow: Flow, rng: Rng): string {
  const P = c.paint
  const L = P.style.light
  const u = coat.unit * lerp(0.9, 1.25, coat.fluff)
  const cx = bb.x + bb.w / 2
  const cy = bb.y + bb.h / 2
  const dirAt = (p: P, n: P): P => {
    const fl: P = flow === 'radial' ? norm([p[0] - cx, p[1] - (cy + bb.h * 0.15)]) : flow
    const j = rng.range(-0.35, 0.35)
    const v: P = [fl[0] - n[0] * 0.55, fl[1] - n[1] * 0.55]
    const c0 = Math.cos(j)
    const s0 = Math.sin(j)
    return norm([v[0] * c0 - v[1] * s0, v[0] * s0 + v[1] * c0])
  }
  let dark = ''
  let lite = ''
  const subs = samplePath(d, u * 0.85)
  for (const sub of subs) {
    if (sub.length < 5) continue
    const sign = signedArea(sub) > 0 ? 1 : -1
    for (let i = 0; i < sub.length; i++) {
      const n = normalAt(sub, i, sign)
      const lit = dot(n, L)
      const inset = u * rng.range(0.15, 1.1)
      const p: P = [sub[i][0] - n[0] * inset, sub[i][1] - n[1] * inset]
      const len = u * rng.range(1.1, 2)
      const wid = u * rng.range(0.1, 0.16)
      const bend = u * rng.range(-0.4, 0.4)
      if (lit < -0.05 && rng.next() < 0.8) dark += strand(p, dirAt(p, n), len, wid, bend)
      else if (lit > 0.3 && rng.next() < 0.5) lite += strand(p, dirAt(p, n), len * 0.85, wid * 0.9, bend)
      else if (rng.next() < 0.12) dark += strand(p, dirAt(p, n), len * 0.8, wid * 0.8, bend)
    }
  }
  // Sparse interior flicks, following the flow and the light.
  const step = u * 3.2
  for (let yy = bb.y + step * 0.5; yy < bb.y + bb.h; yy += step)
    for (let xx = bb.x + step * 0.5; xx < bb.x + bb.w; xx += step) {
      const p: P = [xx + rng.range(-0.45, 0.45) * step, yy + rng.range(-0.45, 0.45) * step]
      const rel: P = [(p[0] - cx) / (bb.w / 2 || 1), (p[1] - cy) / (bb.h / 2 || 1)]
      const lit = dot(rel, L)
      const dir = dirAt(p, [0, 0])
      if (lit < -0.3 && rng.next() < 0.4) dark += strand(p, dir, u * rng.range(1, 1.7), u * 0.12, u * rng.range(-0.3, 0.3))
      else if (lit > 0.35 && rng.next() < 0.25) lite += strand(p, dir, u * rng.range(0.9, 1.4), u * 0.11, u * rng.range(-0.3, 0.3))
    }
  const darkC = mix(shadowOf(base, 0.45), '#241a2e', 0.25)
  return P.flat(dark, darkC, 0.3) + P.flat(lite, highlightOf(base, 0.4), 0.32)
}

/** Belly transition for fur: belly-coloured strands along the belly's upper edge. */
function bellyStrands(c: Ctx, coat: Coat, belly: string, rng: Rng): string {
  const u = coat.unit
  let d = ''
  for (const sub of samplePath(belly, u * 0.8)) {
    if (sub.length < 5) continue
    const sign = signedArea(sub) > 0 ? 1 : -1
    for (let i = 0; i < sub.length; i++) {
      const n = normalAt(sub, i, sign)
      if (n[1] > -0.2 || rng.next() < 0.25) continue
      const p: P = [sub[i][0] - n[0] * u * 0.6, sub[i][1] - n[1] * u * 0.6]
      const dir = norm([n[0] + rng.range(-0.4, 0.4), n[1]])
      d += strand(p, dir, u * rng.range(1.2, 2.2), u * 0.2, u * rng.range(-0.5, 0.5))
    }
  }
  return c.paint.flat(d, coat.belly, 0.95)
}

/** A band just inside the whole silhouette (rim glow of translucent gel). */
function rimBand(d: string, bb: Box, k: number): string {
  const cx = bb.x + bb.w / 2
  const cy = bb.y + bb.h / 2
  const s = 1 - k / Math.max(1, Math.min(bb.w, bb.h) / 2)
  return `${d} ${scalePathAbout(d, clamp(s, 0.3, 0.98), cx, cy)}`
}

interface MatOpts {
  flow: Flow
  role: Role
  belly?: string
}

/**
 * Intrinsic surface detail, drawn inside the shape under the Painter's shading: fur strands,
 * scale and feather tiles, belly scutes, rock facets, the inner glow and bubbles of gel.
 * Lighting itself (speculars, rim, reflections) is the Painter's job.
 */
function materialDetail(c: Ctx, coat: Coat, d: string, bb: Box, base: string, o: MatOpts): string {
  const P = c.paint
  if (P.detail < 1) return ''
  const m = coat.material
  const size = Math.max(4, Math.min(bb.w, bb.h))
  const rng = createRng(hash32(c.dna.seed, 'mat', o.role, Math.round(bb.x), Math.round(bb.y)))
  const lite = highlightOf(base, 0.55)
  // Translucent gel: a lighter rim band and a glowing core read as light passing through.
  if (m === 'slime' || m === 'jelly' || m === 'ghost') {
    let out = el('path', { d: rimBand(d, bb, size * 0.09), fill: P.col(m === 'ghost' ? '#ffffff' : lite), 'fill-rule': 'evenodd', 'fill-opacity': m === 'ghost' ? 0.3 : 0.22 })
    if (c.baked && P.detail > 1) {
      out += el('ellipse', { cx: f(bb.x + bb.w * 0.5), cy: f(bb.y + bb.h * 0.6), rx: f(bb.w * 0.34), ry: f(bb.h * 0.28), fill: glowFill(c, lite, m === 'ghost' ? 0.3 : 0.45, 0.4) })
      if (m !== 'ghost' && o.role === 'body') {
        let bubbles = ''
        for (let i = 0; i < 5; i++) bubbles += circle(bb.x + bb.w * rng.range(0.25, 0.8), bb.y + bb.h * rng.range(0.4, 0.85), size * rng.range(0.012, 0.035))
        out += P.line(bubbles, lite, size * 0.007, { opacity: 0.75 })
      }
    }
    return out
  }
  if (m === 'flame') return el('ellipse', { cx: f(bb.x + bb.w * 0.5), cy: f(bb.y + bb.h * 0.66), rx: f(bb.w * 0.34), ry: f(bb.h * 0.3), fill: glowFill(c, '#fff6c8', 0.75, 0.35) })
  if (!c.baked || P.detail < 2) return ''
  const tileRect = (kind: 'scales' | 'feathers' | 'feathersFine', cover = 1) => el('rect', { x: f(bb.x - 2), y: f(bb.y - 2), width: f(bb.w + 4), height: f(bb.h * cover + 4), fill: tilePaint(c, coat, kind) })
  switch (m) {
    case 'fur':
      // Strands follow the light (dark on the shadow side): none in flat shading.
      return (o.belly ? bellyStrands(c, coat, o.belly, rng) : '') + (P.style.shading === 'flat' ? '' : furStrands(c, coat, d, bb, base, o.flow, rng))
    case 'scales':
      return tileRect('scales') + (o.belly ? scutes(c, coat, o.belly) : '')
    case 'feathers':
      // Faces stay clean; the body's back and the legs show the feather pattern.
      return o.role === 'head' ? '' : tileRect(o.role === 'body' || o.role === 'tail' ? 'feathers' : 'feathersFine', o.role === 'body' ? 0.55 : 1)
    case 'rock':
      return rockFacets(c, coat, bb, rng)
    case 'chitin':
      // Metallic beetles: an iridescent film shifting hue across the shell.
      if (coat.texture === 'metal' || coat.texture === 'scales') {
        return el('rect', { x: f(bb.x), y: f(bb.y), width: f(bb.w), height: f(bb.h), fill: P.linear(`irid${base.slice(1)}`, [[0, hueShift(base, 70), 0.42], [0.45, base, 0], [0.7, hueShift(base, -60), 0.3], [1, hueShift(base, -90), 0.45]], [0, 0], [1, 1]) })
      }
      return ''
  }
  return ''
}

/** Belly plates for scaled creatures: lines across the belly region. */
function scutes(c: Ctx, coat: Coat, belly: string): string {
  const bb = pathBounds(belly)
  const u = coat.unit * 1.8
  let d = ''
  const horiz = bb.w >= bb.h
  const n = Math.floor((horiz ? bb.w : bb.h) / u)
  for (let i = 1; i < n; i++) {
    if (horiz) d += `M${f(bb.x + i * u)} ${f(bb.y + bb.h * 0.15)}q${f(u * 0.25)} ${f(bb.h * 0.45)} 0 ${f(bb.h)}`
    else d += `M${f(bb.x)} ${f(bb.y + i * u)}q${f(bb.w * 0.5)} ${f(u * 0.25)} ${f(bb.w)} 0`
  }
  return c.paint.line(d, shadowOf(coat.belly, 0.35), coat.unit * 0.18, { opacity: 0.45 })
}

function rockFacets(c: Ctx, coat: Coat, bb: Box, rng: Rng): string {
  const P = c.paint
  const L = P.style.light
  let lite = ''
  let dark = ''
  let cracks = ''
  const n = clamp(Math.round((bb.w * bb.h) / (coat.unit * coat.unit * 40)), 3, 9)
  for (let i = 0; i < n; i++) {
    const cx = bb.x + rng.range(0.1, 0.9) * bb.w
    const cy = bb.y + rng.range(0.1, 0.9) * bb.h
    const r = coat.unit * rng.range(1.8, 3.4)
    const pts = blobPts(cx, cy, r, r * 0.8, rng, 5, 0.3)
    const facing = dot(norm([cx - (bb.x + bb.w / 2), cy - (bb.y + bb.h / 2)]), L)
    if (facing > 0) lite += poly(pts)
    else dark += poly(pts)
    if (i % 2 === 0) cracks += `M${f(cx)} ${f(cy)}l${f(r * rng.range(-1.2, 1.2))} ${f(r * rng.range(0.5, 1.2))}l${f(r * rng.range(-0.6, 0.6))} ${f(r * rng.range(0.3, 0.8))}`
  }
  return P.flat(lite, highlightOf(coat.primary, 0.3), 0.35) + P.flat(dark, shadowOf(coat.primary, 0.3), 0.35) + P.line(cracks, shadowOf(coat.primary, 0.55), coat.unit * 0.22, { opacity: 0.7 }) + P.line(shiftPath(cracks, coat.unit * 0.2, coat.unit * 0.2), highlightOf(coat.primary, 0.4), coat.unit * 0.12, { opacity: 0.5 })
}

/** The Painter material a coat material takes light as. */
export function painterMaterial(m: Material): PainterMaterial | undefined {
  switch (m) {
    case 'fur':
      return 'fur'
    case 'feathers':
      return 'hair'
    case 'skin':
      return 'skin'
    case 'wet':
      return 'plastic'
    case 'scales':
      return 'scales'
    case 'chitin':
      return 'chitin'
    case 'metal':
      return 'metal'
    case 'plastic':
      return 'plastic'
    case 'slime':
    case 'jelly':
      return 'slime'
    case 'ghost':
      return 'glass'
    case 'rock':
      return 'cloth'
    default:
      return undefined
  }
}

/* ---- The coat shape --------------------------------------------------------------- */

export interface CoatShapeOpts extends ShapeOpts {
  /** The lighter underside region (optional). */
  belly?: string
  /** Soft belly edge: radial fade (default) or fade from the top edge (serpent bands). */
  bellySoft?: 'radial' | 'top'
  /** Colour instead of the coat's primary. */
  tint?: string
  /** Fur flow for strands, local space (default per role). */
  flow?: Flow
  /** Draw this (open) path as the ink line instead of the silhouette. */
  inkPath?: string
  /** Hints for head markings. */
  hint?: MarkHints
  /** Skip markings (a far wing, a fin). */
  plain?: boolean
  /** Coat material override (the Painter's `material` is derived from it). */
  coatMaterial?: Material
  /** More detail drawn inside the shape above the markings (pads, seams), shaded with it. */
  extra?: string
  /** More shapes painted as one mass with `d` (each its own path, so windings never clash). */
  union?: string[]
}

const DEFAULT_FLOW: Record<Role, P> = { body: [-0.95, 0.3], head: [-0.8, 0.45], leg: [0.05, 1], tail: [-1, 0.1] }
const GLOSSY: readonly Material[] = ['wet', 'chitin', 'metal', 'plastic', 'slime', 'jelly']

/**
 * A coat-coloured shape with its belly, markings and material detail inside, shaded by the
 * Painter over all of it. `role` picks the marking layout; `key` seeds it (a stable per-part
 * key). A path with several subpaths (a silhouette plus `furEdge` clumps) is painted as one
 * mass with one outer contour.
 */
export function coatShape(c: Ctx, d: string, coat: Coat, key: string, role: Role, o: CoatShapeOpts = {}): string {
  if (!d) return ''
  const P = c.paint
  const cm: Coat = o.coatMaterial ? { ...coat, material: o.coatMaterial } : coat
  const base = o.tint ?? coat.primary
  const extraShapes = (o.union ?? []).filter(Boolean)
  const bb = fastBounds(extraShapes.length ? d + extraShapes.join('') : d)
  const flow = o.flow ?? DEFAULT_FLOW[role]

  const inner: string[] = []
  if (o.belly) {
    // A soft fade reads as fur blending; against a very different coat (a penguin's white
    // front on black) a wide fade reads as a glow, so the edge tightens with contrast.
    const contrast = Math.abs(toLch(coat.belly).l - toLch(base).l)
    const hold = o.bellySoft === 'top' ? 0.7 : contrast > 0.4 ? 0.86 : contrast > 0.25 ? 0.74 : 0.62
    inner.push(el('path', { d: o.belly, fill: softFill(c, coat.belly, o.bellySoft ?? 'radial', hold) }))
  }
  // Medium detail keeps the markings on the big masses (body, head, tail), not the limbs.
  if (P.detail > 0 && !o.plain && (P.detail > 1 || role !== 'leg')) inner.push(markings(c, coat, bb, key, role, o.hint ?? {}))
  inner.push(materialDetail(c, cm, extraShapes.length ? d + extraShapes.join('') : d, bb, base, { flow, role, belly: o.belly }))
  if (o.extra) inner.push(o.extra)
  const innerS = inner.filter(Boolean).join('')

  const alpha = cm.material === 'jelly' ? 0.84 : cm.material === 'slime' ? 0.9 : cm.material === 'ghost' ? 0.94 : 1
  const attrs = alpha < 1 ? { ...(o.attrs ?? {}), 'fill-opacity': f(alpha) } : o.attrs
  const so: ShapeOpts = {
    shade: cm.material === 'flame' ? false : o.shade,
    offset: o.offset,
    shadeFrom: o.shadeFrom,
    outlineClip: o.outlineClip,
    ink: o.ink,
    outline: o.inkPath ? false : o.outline,
    // The painter's standard gloss is a free blob: only on compact masses, not limbs.
    gloss: o.gloss ?? (GLOSSY.includes(cm.material) && (role === 'body' || role === 'head')),
    material: o.material ?? painterMaterial(cm.material),
    spec: o.spec ?? (cm.material === 'ghost' ? 0.25 : undefined),
    inner: innerS || undefined,
    attrs,
  }
  const multi = extraShapes.length > 0 || d.indexOf('M', 1) > 0 || d.indexOf('m', 1) > 0
  let svg = multi ? P.union([d, ...extraShapes], base, so) : P.shape(d, base, so)
  if (o.inkPath && P.lw > 0 && o.outline !== false) {
    const mul = typeof o.outline === 'number' ? o.outline : 1
    svg += el('path', { d: o.inkPath, fill: 'none', stroke: o.ink ?? P.ink(base), 'stroke-width': f(P.lw * mul), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })
  }
  return svg
}

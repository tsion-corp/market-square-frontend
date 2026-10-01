/* Scalar, vector and 2D-affine helpers. Points are [x, y] tuples: short to write in the
 * many shape generators, and cheap to copy. SVG convention: +y points down. */

export type P = [number, number]

/** SVG matrix(a b c d e f): x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Mat = [number, number, number, number, number, number]

export const TAU = Math.PI * 2
export const DEG = Math.PI / 180

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v)
export const clamp01 = (v: number): number => clamp(v, 0, 1)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a))
export const remap = (v: number, a0: number, a1: number, b0: number, b1: number): number => lerp(b0, b1, invLerp(a0, a1, v))
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
/** Map a 0..1 slider to a symmetric -1..1 value. */
export const signed = (v01: number): number => v01 * 2 - 1
export const wrap = (v: number, n: number): number => ((v % n) + n) % n

/* ---- Points ---------------------------------------------------------- */

export const pt = (x: number, y: number): P => [x, y]
export const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
export const scale = (a: P, s: number): P => [a[0] * s, a[1] * s]
export const len = (a: P): number => Math.hypot(a[0], a[1])
export const dist = (a: P, b: P): number => Math.hypot(a[0] - b[0], a[1] - b[1])
export const norm = (a: P): P => {
  const l = Math.hypot(a[0], a[1]) || 1
  return [a[0] / l, a[1] / l]
}
/** Left-hand perpendicular in screen space (rotates +90deg with y down). */
export const perp = (a: P): P => [-a[1], a[0]]
export const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)]
export const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
export const angleOf = (a: P): number => Math.atan2(a[1], a[0])
export const fromAngle = (rad: number, r = 1): P => [Math.cos(rad) * r, Math.sin(rad) * r]
export const rotP = (a: P, rad: number, about: P = [0, 0]): P => {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const x = a[0] - about[0]
  const y = a[1] - about[1]
  return [about[0] + x * c - y * s, about[1] + x * s + y * c]
}
export const mirrorX = (pts: P[]): P[] => pts.map(([x, y]) => [-x, y] as P)
export const translatePts = (pts: P[], dx: number, dy: number): P[] => pts.map(([x, y]) => [x + dx, y + dy] as P)
export const scalePts = (pts: P[], sx: number, sy = sx, about: P = [0, 0]): P[] =>
  pts.map(([x, y]) => [about[0] + (x - about[0]) * sx, about[1] + (y - about[1]) * sy] as P)

/** Quadratic Bézier point. */
export const quadAt = (a: P, c: P, b: P, t: number): P => {
  const u = 1 - t
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]
}

/** Cubic Bézier point. */
export const cubicAt = (a: P, c1: P, c2: P, b: P, t: number): P => {
  const u = 1 - t
  const w0 = u * u * u
  const w1 = 3 * u * u * t
  const w2 = 3 * u * t * t
  const w3 = t * t * t
  return [w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0], w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]]
}

/** Samples a quadratic curve into n+1 points. */
export const sampleQuad = (a: P, c: P, b: P, n: number): P[] => {
  const out: P[] = []
  for (let i = 0; i <= n; i++) out.push(quadAt(a, c, b, i / n))
  return out
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export function boundsOf(pts: P[]): Box {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of pts) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function unionBox(a: Box, b: Box): Box {
  if (a.w === 0 && a.h === 0) return b
  if (b.w === 0 && b.h === 0) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export const padBox = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 })

/* ---- Affine matrices ------------------------------------------------- */

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** m1 * m2: apply m2 first, then m1. */
export function mul(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1
  const [a2, b2, c2, d2, e2, f2] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export const translateM = (tx: number, ty: number): Mat => [1, 0, 0, 1, tx, ty]
export const scaleM = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0]
export const rotateM = (deg: number): Mat => {
  const r = deg * DEG
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}

export function applyM(m: Mat, p: P): P {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

export function invertM(m: Mat): Mat {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c || 1e-9
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** Rotation in degrees and uniform-ish scale extracted from a matrix (for exports). */
export function decomposeM(m: Mat): { x: number; y: number; rot: number; sx: number; sy: number } {
  const [a, b, c, d, e, f] = m
  const sx = Math.hypot(a, b)
  const det = a * d - b * c
  const sy = sx === 0 ? 0 : det / sx
  const rot = Math.atan2(b, a) / DEG
  return { x: e, y: f, rot, sx, sy }
}

/* ---- Easing ----------------------------------------------------------- */

export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'step' | 'back' | 'bounce' | 'elastic'

export function ease(name: EaseName | undefined, t: number): number {
  switch (name) {
    case 'in':
      return t * t
    case 'out':
      return 1 - (1 - t) * (1 - t)
    case 'inOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'step':
      return t < 1 ? 0 : 1
    case 'back': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
    }
    case 'bounce': {
      const n1 = 7.5625
      const d1 = 2.75
      if (t < 1 / d1) return n1 * t * t
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
      return n1 * (t -= 2.625 / d1) * t + 0.984375
    }
    case 'elastic': {
      if (t === 0 || t === 1) return t
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
    }
    default:
      return t
  }
}

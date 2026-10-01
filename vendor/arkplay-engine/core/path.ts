/* The shape toolkit every part is drawn with. Everything returns an SVG path `d` string.
 *
 * Organic shapes are made from a handful of control points run through a Catmull-Rom
 * spline (converted to cubic Béziers), so a face, a sleeve or a tail is described by
 * where its edges should pass rather than by hand-placed handles. A point may carry a
 * third number, its smoothness (1 = smooth, 0 = sharp corner), for collars, hair tips
 * and claws. */

import { clamp, lerp, norm, perp, sub, TAU, type P } from './math.ts'
import type { Rng } from './rng.ts'

/** A point with optional smoothness in [0, 1]. */
export type SP = P | [number, number, number]

/** Compact number formatting: two decimals, no trailing zeros, no "-0". */
export function f(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const r = Math.round(n * 100) / 100
  return r === 0 ? '0' : String(r)
}

const pp = (p: P): string => `${f(p[0])} ${f(p[1])}`

export function poly(points: P[], closed = true): string {
  if (points.length === 0) return ''
  let d = `M${pp(points[0])}`
  for (let i = 1; i < points.length; i++) d += `L${pp(points[i])}`
  return closed ? d + 'Z' : d
}

/** Catmull-Rom through the points, as cubic Béziers. `tension` 1 = standard. */
export function smooth(points: SP[], closed = true, tension = 1): string {
  const n = points.length
  if (n < 2) return ''
  if (n === 2) return poly(points.map((p) => [p[0], p[1]] as P), closed)
  const k = (i: number): number => {
    const p = points[closed ? (i + n) % n : clamp(i, 0, n - 1)]
    return p.length > 2 ? (p as [number, number, number])[2] : 1
  }
  const at = (i: number): P => {
    const p = points[closed ? (i + n) % n : clamp(i, 0, n - 1)]
    return [p[0], p[1]]
  }
  let d = `M${pp(at(0))}`
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t1 = (tension / 6) * k(i)
    const t2 = (tension / 6) * k(i + 1)
    const c1: P = [p1[0] + (p2[0] - p0[0]) * t1, p1[1] + (p2[1] - p0[1]) * t1]
    const c2: P = [p2[0] - (p3[0] - p1[0]) * t2, p2[1] - (p3[1] - p1[1]) * t2]
    d += `C${pp(c1)} ${pp(c2)} ${pp(p2)}`
  }
  return closed ? d + 'Z' : d
}

/** Dense samples along the Catmull-Rom curve (for placing details along an edge). */
export function sampleSmooth(points: P[], closed: boolean, perSeg = 8): P[] {
  const n = points.length
  if (n < 2) return points.slice()
  const at = (i: number): P => points[closed ? (i + n) % n : clamp(i, 0, n - 1)]
  const out: P[] = []
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  if (!closed) out.push(at(n - 1))
  return out
}

/* ---- Primitives -------------------------------------------------------- */

export function ellipse(cx: number, cy: number, rx: number, ry = rx): string {
  return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
}

export const circle = (cx: number, cy: number, r: number): string => ellipse(cx, cy, r, r)

export function rect(x: number, y: number, w: number, h: number): string {
  return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`
}

export function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rr === 0) return rect(x, y, w, h)
  return (
    `M${f(x + rr)} ${f(y)}H${f(x + w - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}` +
    `V${f(y + h - rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)}` +
    `H${f(x + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + h - rr)}` +
    `V${f(y + rr)}A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)}Z`
  )
}

/** Points on an elliptical arc from angle a0 to a1 (radians, SVG orientation). */
export function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P[] {
  const out: P[] = []
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n)
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

export function superellipsePts(cx: number, cy: number, rx: number, ry: number, n = 4, samples = 40): P[] {
  const out: P[] = []
  const e = 2 / n
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU
    const c = Math.cos(a)
    const s = Math.sin(a)
    out.push([cx + rx * Math.sign(c) * Math.pow(Math.abs(c), e), cy + ry * Math.sign(s) * Math.pow(Math.abs(s), e)])
  }
  return out
}

export function regularPts(cx: number, cy: number, r: number, sides: number, rotDeg = -90): P[] {
  const out: P[] = []
  for (let i = 0; i < sides; i++) {
    const a = ((rotDeg + (360 / sides) * i) * Math.PI) / 180
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

export function starPts(cx: number, cy: number, r1: number, r2: number, points: number, rotDeg = -90): P[] {
  const out: P[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = ((rotDeg + (180 / points) * i) * Math.PI) / 180
    const r = i % 2 === 0 ? r1 : r2
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

export const star = (cx: number, cy: number, r1: number, r2: number, points = 5, rotDeg = -90): string =>
  poly(starPts(cx, cy, r1, r2, points, rotDeg))

export function heart(cx: number, cy: number, s: number): string {
  return (
    `M${f(cx)} ${f(cy + s * 0.9)}` +
    `C${f(cx - s * 1.2)} ${f(cy + s * 0.1)} ${f(cx - s * 0.9)} ${f(cy - s * 0.85)} ${f(cx)} ${f(cy - s * 0.35)}` +
    `C${f(cx + s * 0.9)} ${f(cy - s * 0.85)} ${f(cx + s * 1.2)} ${f(cy + s * 0.1)} ${f(cx)} ${f(cy + s * 0.9)}Z`
  )
}

/** Four-point sparkle (a concave star). */
export function sparkle(cx: number, cy: number, r: number, pinch = 0.22): string {
  const i = r * pinch
  return (
    `M${f(cx)} ${f(cy - r)}Q${f(cx + i)} ${f(cy - i)} ${f(cx + r)} ${f(cy)}` +
    `Q${f(cx + i)} ${f(cy + i)} ${f(cx)} ${f(cy + r)}Q${f(cx - i)} ${f(cy + i)} ${f(cx - r)} ${f(cy)}` +
    `Q${f(cx - i)} ${f(cy - i)} ${f(cx)} ${f(cy - r)}Z`
  )
}

/* ---- Limbs and tubes --------------------------------------------------- */

/** A tapered capsule from a (radius ra) to b (radius rb): arms, legs, fingers, horns. */
export function capsule(a: P, b: P, ra: number, rb: number): string {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L = Math.hypot(dx, dy)
  if (L < 1e-6 || Math.abs(ra - rb) >= L) {
    return ra >= rb ? circle(a[0], a[1], ra) : circle(b[0], b[1], rb)
  }
  const u: P = [dx / L, dy / L]
  const n = perp(u)
  const ca = (ra - rb) / L
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca))
  const alpha = Math.acos(ca)
  const dirP: P = [u[0] * ca + n[0] * sa, u[1] * ca + n[1] * sa]
  const dirM: P = [u[0] * ca - n[0] * sa, u[1] * ca - n[1] * sa]
  const p1: P = [a[0] + dirP[0] * ra, a[1] + dirP[1] * ra]
  const p2: P = [b[0] + dirP[0] * rb, b[1] + dirP[1] * rb]
  const p3: P = [b[0] + dirM[0] * rb, b[1] + dirM[1] * rb]
  const p4: P = [a[0] + dirM[0] * ra, a[1] + dirM[1] * ra]
  const large2 = alpha > Math.PI / 2 ? 1 : 0
  const large1 = alpha < Math.PI / 2 ? 1 : 0
  return (
    `M${pp(p1)}L${pp(p2)}A${f(rb)} ${f(rb)} 0 ${large2} 0 ${pp(p3)}` +
    `L${pp(p4)}A${f(ra)} ${f(ra)} 0 ${large1} 0 ${pp(p1)}Z`
  )
}

export type Cap = 'round' | 'flat' | 'point'

/** Outline points of a tube following `spine` with per-point radii. */
export function tubePts(spine: P[], radii: number[], capStart: Cap = 'round', capEnd: Cap = 'round'): SP[] {
  const n = spine.length
  if (n < 2) return []
  const normals: P[] = []
  for (let i = 0; i < n; i++) {
    const a = spine[Math.max(0, i - 1)]
    const b = spine[Math.min(n - 1, i + 1)]
    normals.push(perp(norm(sub(b, a))))
  }
  const left: SP[] = []
  const right: SP[] = []
  for (let i = 0; i < n; i++) {
    const r = radii[Math.min(i, radii.length - 1)]
    left.push([spine[i][0] + normals[i][0] * r, spine[i][1] + normals[i][1] * r])
    right.push([spine[i][0] - normals[i][0] * r, spine[i][1] - normals[i][1] * r])
  }
  // A cap sweeps from one side of the tube (`from` × normal) around `dir` to the other.
  const cap = (i: number, kind: Cap, dir: P, from: 1 | -1): SP[] => {
    const r = radii[Math.min(i, radii.length - 1)]
    if (kind === 'flat' || r < 0.01) return []
    const [x, y] = spine[i]
    if (kind === 'point') return [[x + dir[0] * r * 1.6, y + dir[1] * r * 1.6, 0]]
    const nn = normals[i]
    return [
      [x + (from * nn[0] * 0.72 + dir[0] * 0.7) * r, y + (from * nn[1] * 0.72 + dir[1] * 0.7) * r],
      [x + dir[0] * r, y + dir[1] * r],
      [x + (-from * nn[0] * 0.72 + dir[0] * 0.7) * r, y + (-from * nn[1] * 0.72 + dir[1] * 0.7) * r],
    ]
  }
  // Outline order: left side forward, end cap (+normal → −normal), right side backward,
  // start cap (−normal → +normal).
  const endCap = cap(n - 1, capEnd, norm(sub(spine[n - 1], spine[n - 2])), 1)
  const startCap = cap(0, capStart, norm(sub(spine[0], spine[1])), -1)
  if (capEnd === 'point') left[n - 1] = [left[n - 1][0], left[n - 1][1], 1]
  return [...left, ...endCap, ...right.reverse(), ...startCap]
}

export function tube(spine: P[], radii: number[], capStart: Cap = 'round', capEnd: Cap = 'round'): string {
  return smooth(tubePts(spine, radii, capStart, capEnd), true)
}

/**
 * A filled brush stroke along a curve, `w0` wide at the start and `w1` at the end, with
 * an optional bulge in the middle. Brows, lashes, whiskers, hair strands, mouths.
 */
export function brush(points: P[], w0: number, w1: number, bulge = 0, capStart: Cap = 'round', capEnd: Cap = 'round'): string {
  if (points.length < 2) return ''
  const dense = points.length < 5 ? sampleSmooth(points, false, 4) : points
  const radii = dense.map((_, i) => {
    const t = i / (dense.length - 1)
    return Math.max(0, lerp(w0, w1, t) / 2 + Math.sin(t * Math.PI) * bulge * 0.5)
  })
  return tube(dense, radii, w0 < 0.05 ? 'point' : capStart, w1 < 0.05 ? 'point' : capEnd)
}

/* ---- Organic outlines --------------------------------------------------- */

/** A noisy round blob: slimes, bushes, clouds, curls, spots. */
export function blobPts(cx: number, cy: number, rx: number, ry: number, rng: Rng, points = 9, jitter = 0.14): P[] {
  const out: P[] = []
  const phase = rng.range(0, TAU)
  for (let i = 0; i < points; i++) {
    const a = phase + (i / points) * TAU
    const j = 1 + rng.range(-jitter, jitter)
    out.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j])
  }
  return out
}

export const blob = (cx: number, cy: number, rx: number, ry: number, rng: Rng, points = 9, jitter = 0.14): string =>
  smooth(blobPts(cx, cy, rx, ry, rng, points, jitter), true)

/** Signed area (positive = clockwise on screen, since y points down). */
export function signedArea(pts: P[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Moves each vertex of a closed polygon outward (d > 0) or inward along its normal. */
export function offsetPts(pts: SP[], d: number): SP[] {
  const n = pts.length
  if (n < 3 || d === 0) return pts.slice()
  const plain = pts.map((p) => [p[0], p[1]] as P)
  const outward = signedArea(plain) > 0 ? -1 : 1
  return pts.map((p, i) => {
    const a = plain[(i - 1 + n) % n]
    const b = plain[(i + 1) % n]
    const nrm = perp(norm(sub(b, a)))
    const q: SP = [p[0] - nrm[0] * d * outward, p[1] - nrm[1] * d * outward]
    if (p.length > 2) (q as number[]).push((p as number[])[2])
    return q
  })
}

/**
 * Replaces each edge of a closed outline with an outward bump: the curly, cloudy edge
 * of afros, sheep wool, bushes and smoke. `bulge` is relative to edge length.
 */
export function scallop(pts: P[], bulge = 0.35): string {
  const n = pts.length
  if (n < 3) return poly(pts)
  const outward = signedArea(pts) > 0 ? -1 : 1
  let d = `M${pp(pts[0])}`
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nr = perp(norm(sub(b, a)))
    const c: P = [m[0] - nr[0] * L * bulge * outward, m[1] - nr[1] * L * bulge * outward]
    d += `Q${pp(c)} ${pp(b)}`
  }
  return d + 'Z'
}

/** Like scallop, but along an open chain (no closing edge): curly edges that continue into
 *  other geometry. `outwardSign` picks which side the bumps face (1 = left of travel). */
export function scallopOpen(pts: P[], bulge = 0.35, outwardSign = 1): string {
  if (pts.length < 2) return poly(pts, false)
  let d = `M${pp(pts[0])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nr = perp(norm(sub(b, a)))
    d += `Q${pp([m[0] - nr[0] * L * bulge * outwardSign, m[1] - nr[1] * L * bulge * outwardSign])} ${pp(b)}`
  }
  return d
}

/** A zig-zag/sawtooth edge between two points (fur tufts, grass, jagged hems). */
export function zigzagPts(a: P, b: P, teeth: number, depth: number, rng?: Rng): P[] {
  const out: P[] = [a]
  const dir = norm(sub(b, a))
  const nr = perp(dir)
  for (let i = 0; i < teeth; i++) {
    const t = (i + 0.5) / teeth
    const j = rng ? rng.range(0.7, 1.25) : 1
    out.push([lerp(a[0], b[0], t) + nr[0] * depth * j, lerp(a[1], b[1], t) + nr[1] * depth * j])
    out.push([lerp(a[0], b[0], (i + 1) / teeth), lerp(a[1], b[1], (i + 1) / teeth)])
  }
  return out
}

/** Concatenates several `d` strings into one compound path. */
export const join = (...ds: (string | false | null | undefined)[]): string => ds.filter(Boolean).join('')

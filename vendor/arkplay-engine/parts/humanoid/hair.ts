/* Procedural hair and facial hair.
 *
 * Every hairstyle is a recipe over the same parts:
 *   back    the mass behind the head (long hair, volume at the sides)
 *   cap     the hair on top of the head, down to the hairline and sideburns
 *   bangs   the fringe over the forehead (straight, side, curtain, choppy, wispy…)
 *   locks   strands framing the face in front of the ears
 *   extras  ponytails, buns, braids, puffs, crests, locs, ringlets…
 * Length, volume, curl, bangs, part and messiness modulate the recipe, so 41 styles ×
 * every slider gives a continuous space rather than 41 fixed drawings. Everything is
 * built from the skull and face outline, so hair fits every head shape.
 *
 * Rendering. A mass is a silhouette plus flow guides (root → tip curves) that split it
 * into clumps. The Painter gives each mass its form shading and the style's outline; the
 * guides drive the hair material on top: separation shadows between clumps, a stylized
 * anisotropic sheen band that follows the head's curvature and breaks per clump, a rim
 * light on the silhouette, and root-to-tip tone. Baked stills (ctx.baked) add fine
 * strands, flyaways, soft hairlines and the cast shadow of bangs on the forehead. Curly and
 * coily masses read as a few big curl clumps (a lumpy silhouette, each clump tucked under
 * its neighbour and lit on its shoulder, a few curl strokes and a broken sheen inside), never
 * a tiled texture; braids, locs, twists and buns get per-segment shading. Facial hair lives
 * here too: beards under the mouth, moustaches over it. */

import { mix, shadowOf, toLch } from '../../core/color.ts'
import { boundsOf, clamp, dist, lerp, lerpP, norm, smoothstep, sub, type Box, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, offsetPts, sampleSmooth, tubePts, type SP } from '../../core/path.ts'
import { el, g, url } from '../../core/svg.ts'
import { noise1 } from '../../core/noise.ts'
import type { Rng } from '../../core/rng.ts'
import type { Ctx, PartList, Reader } from '../../render/context.ts'
import { Z } from '../../render/context.ts'
import { pathBounds, type Painter } from '../../render/painter.ts'
import type { HumanMeasure, HumanRig } from '../../rig/humanoid.ts'
import { faceGeom, profileOutline } from './head.ts'
import { hairColorOf, hairPalette, type HairPalette } from './hairColor.ts'

type Bangs = 'none' | 'straight' | 'side' | 'curtain' | 'choppy' | 'wispy' | 'long-side' | 'crop'
type Tips = 'point' | 'round' | 'blunt' | 'curl'
type Extra =
  | 'ponytail'
  | 'high-pony'
  | 'twintails'
  | 'bun'
  | 'space-buns'
  | 'puffs'
  | 'man-bun'
  | 'braid'
  | 'twin-braids'
  | 'crest'
  | 'quiff'
  | 'pompadour'
  | 'afro'
  | 'locs'
  | 'box-braids'
  | 'twists'
  | 'ringlets'

interface Recipe {
  cap: 'none' | 'stubble' | 'full'
  vol: number
  side: number
  back: number
  flare: number
  bangs: Bangs
  bangLen: number
  tips: Tips
  curl: number
  spikes: number
  sides: 'normal' | 'short' | 'shaved'
  part: 'left' | 'center' | 'right' | 'none'
  extras: Extra[]
  texture: 'strands' | 'curls' | 'rows' | 'none'
  slick?: boolean
}

const R = (r: Partial<Recipe>): Recipe => ({
  cap: 'full',
  vol: 0.08,
  side: 0.4,
  back: 0.2,
  flare: 1,
  bangs: 'none',
  bangLen: 0.6,
  tips: 'point',
  curl: 0,
  spikes: 0,
  sides: 'normal',
  part: 'none',
  extras: [],
  texture: 'strands',
  ...r,
})

export const RECIPES: Record<string, Recipe> = {
  bald: R({ cap: 'none', side: 0, back: 0, texture: 'none' }),
  buzz: R({ cap: 'stubble', vol: 0, side: 0.35, back: 0, texture: 'none' }),
  crew: R({ vol: 0.04, side: 0.3, back: 0.05, bangs: 'crop', bangLen: 0.25, texture: 'strands' }),
  'short-messy': R({ vol: 0.1, side: 0.38, back: 0.15, bangs: 'choppy', bangLen: 0.55 }),
  spiky: R({ vol: 0.18, side: 0.4, back: 0.18, bangs: 'choppy', bangLen: 0.72, spikes: 9 }),
  'side-part': R({ vol: 0.08, side: 0.35, back: 0.12, bangs: 'side', bangLen: 0.3, part: 'left' }),
  quiff: R({ vol: 0.06, side: 0.3, back: 0.1, sides: 'short', extras: ['quiff'] }),
  pompadour: R({ vol: 0.06, side: 0.32, back: 0.12, sides: 'short', extras: ['pompadour'] }),
  slick: R({ vol: 0.03, side: 0.32, back: 0.22, slick: true }),
  mohawk: R({ cap: 'stubble', vol: 0, side: 0.3, back: 0, sides: 'shaved', extras: ['crest'], texture: 'none' }),
  undercut: R({ vol: 0.1, side: 0.25, back: 0.05, sides: 'shaved', bangs: 'long-side', bangLen: 0.62, part: 'left' }),
  bowl: R({ vol: 0.06, side: 0.55, back: 0.25, bangs: 'straight', bangLen: 0.85, tips: 'blunt' }),
  'curly-top': R({ vol: 0.14, side: 0.3, back: 0.1, sides: 'short', curl: 0.75, bangs: 'choppy', bangLen: 0.45, tips: 'curl', texture: 'curls' }),
  afro: R({ vol: 0.3, side: 0.6, back: 0.5, curl: 1, tips: 'curl', extras: ['afro'], texture: 'curls' }),
  'afro-puffs': R({ vol: 0.02, side: 0.3, back: 0.05, curl: 0.9, part: 'center', extras: ['puffs'], slick: true, texture: 'none' }),
  twists: R({ vol: 0.14, side: 0.45, back: 0.35, curl: 0.4, extras: ['twists'], texture: 'none' }),
  cornrows: R({ vol: 0, side: 0.3, back: 0.1, texture: 'rows', slick: true }),
  locs: R({ vol: 0.1, side: 1.3, back: 1.6, extras: ['locs'], tips: 'round', texture: 'none' }),
  'box-braids': R({ vol: 0.06, side: 1.5, back: 2.0, extras: ['box-braids'], tips: 'round', texture: 'none', part: 'center' }),
  pixie: R({ vol: 0.07, side: 0.42, back: 0.12, bangs: 'side', bangLen: 0.62, part: 'right' }),
  bob: R({ vol: 0.1, side: 1.0, back: 0.9, flare: 1.08, bangs: 'straight', bangLen: 0.82, tips: 'blunt' }),
  'wavy-bob': R({ vol: 0.12, side: 0.95, back: 0.85, flare: 1.15, bangs: 'side', bangLen: 0.5, tips: 'round', curl: 0.45 }),
  lob: R({ vol: 0.1, side: 1.25, back: 1.25, bangs: 'curtain', bangLen: 0.75, tips: 'blunt', part: 'center' }),
  shag: R({ vol: 0.14, side: 1.1, back: 1.05, bangs: 'curtain', bangLen: 0.8, curl: 0.3, tips: 'point' }),
  wolf: R({ vol: 0.18, side: 1.0, back: 1.0, bangs: 'choppy', bangLen: 0.8, spikes: 5 }),
  mullet: R({ vol: 0.1, side: 0.4, back: 1.25, flare: 0.8, bangs: 'choppy', bangLen: 0.5 }),
  curtains: R({ vol: 0.1, side: 0.9, back: 0.6, bangs: 'curtain', bangLen: 0.85, part: 'center' }),
  emo: R({ vol: 0.12, side: 1.0, back: 0.8, bangs: 'long-side', bangLen: 1.25, part: 'right' }),
  long: R({ vol: 0.1, side: 1.8, back: 2.4, flare: 1.05, bangs: 'none', part: 'center', tips: 'point' }),
  'long-wavy': R({ vol: 0.14, side: 1.8, back: 2.3, flare: 1.2, bangs: 'curtain', bangLen: 0.8, tips: 'round', curl: 0.5, part: 'center' }),
  'long-curly': R({ vol: 0.22, side: 1.7, back: 2.1, flare: 1.4, tips: 'curl', curl: 0.85, texture: 'curls', part: 'center' }),
  hime: R({ vol: 0.08, side: 1.25, back: 2.5, bangs: 'straight', bangLen: 0.95, tips: 'blunt' }),
  ringlets: R({ vol: 0.12, side: 0.6, back: 2.0, flare: 1.1, bangs: 'side', bangLen: 0.6, curl: 0.6, extras: ['ringlets'], tips: 'curl' }),
  ponytail: R({ vol: 0.04, side: 0.35, back: 0.05, bangs: 'side', bangLen: 0.45, extras: ['ponytail'], slick: true, part: 'left' }),
  'high-pony': R({ vol: 0.05, side: 0.45, back: 0.05, bangs: 'choppy', bangLen: 0.7, extras: ['high-pony'], slick: true }),
  twintails: R({ vol: 0.06, side: 0.5, back: 0.1, bangs: 'choppy', bangLen: 0.85, extras: ['twintails'], part: 'center' }),
  bun: R({ vol: 0.04, side: 0.35, back: 0.05, extras: ['bun'], slick: true }),
  'space-buns': R({ vol: 0.05, side: 0.4, back: 0.05, bangs: 'straight', bangLen: 0.7, extras: ['space-buns'], part: 'center' }),
  'man-bun': R({ vol: 0.05, side: 0.3, back: 0.05, sides: 'short', extras: ['man-bun'], slick: true }),
  braid: R({ vol: 0.05, side: 0.45, back: 0.1, bangs: 'side', bangLen: 0.55, extras: ['braid'], part: 'right' }),
  'twin-braids': R({ vol: 0.05, side: 0.45, back: 0.1, bangs: 'curtain', bangLen: 0.6, extras: ['twin-braids'], part: 'center' }),
}

/** True when this hairstyle hangs over the ears (the profile ear goes under it). */
export function hairCoversEars(c: Ctx): boolean {
  if (c.hides('hair')) return true
  const h = c.sec('hair')
  const r = RECIPES[h.s('style')] ?? RECIPES['short-messy']
  return r.cap !== 'none' && r.cap !== 'stubble' && r.side * lerp(0.6, 1.5, h.n('length')) > 0.72
}

interface Geo {
  m: HumanMeasure
  hh: number
  hw: number
  crownY: number
  cy: number
  rx: number
  ry: number
  /** Head-local y for a side length (0 temple … 1 jaw … 2 chest). */
  sideY: (v: number) => number
  /** Head-local y for a back length (0 nape … 1 shoulders … 3 waist). */
  backY: (v: number) => number
  /** Point on the hair envelope at angle a (radians; π = left, 1.5π = top, 2π = right). */
  env: (a: number, t: number) => P
}

function geo(c: Ctx): Geo {
  const m = (c.hr as HumanRig).m
  const fg = faceGeom(c)
  const hh = m.headH
  const hw = m.hw
  const cy = -hh * 0.5
  const ry = -fg.crownY + cy
  const rx = hw * (fg.shape.temple * 0.5 + 0.52)
  return {
    m,
    hh,
    hw,
    crownY: fg.crownY,
    cy,
    rx,
    ry,
    sideY: (v) => (v <= 1 ? lerp(-hh * 0.5, hh * 0.02, clamp(v, 0, 1)) : lerp(hh * 0.02, m.neckLen + m.torsoLen * 0.35, clamp(v - 1, 0, 1.5))),
    backY: (v) =>
      v <= 0.3
        ? lerp(-hh * 0.35, hh * 0.05, v / 0.3)
        : v <= 1
          ? lerp(hh * 0.05, m.neckLen + hh * 0.12, (v - 0.3) / 0.7)
          : v <= 2
            ? lerp(m.neckLen + hh * 0.12, m.neckLen + m.torsoLen * 0.45, v - 1)
            : lerp(m.neckLen + m.torsoLen * 0.45, m.neckLen + m.torsoLen * 0.95, clamp(v - 2, 0, 1)),
    env: (a, t) => [Math.cos(a) * (rx + t), cy + Math.sin(a) * (ry + t)],
  }
}

/* ---- The hair kit: palette, style and light for one head of hair ----------------------- */

interface Kit {
  c: Ctx
  P: Painter
  pal: HairPalette
  G: Geo
  baked: boolean
  det: 0 | 1 | 2
  flat: boolean
  soft: boolean
  /** Unit vector toward the key light. */
  L: P
  lw: number
  hh: number
  shine: number
  messy: number
  /** Highlight colour ('' = none) and how much of it is painted as streaks. */
  hi: string
  streaks: number
  /** Ombré tips colour ('' = none). */
  tips: string
  /** Centre of curvature for the sheen band (the skull). */
  hc: P
  skin: string
  rng: Rng
  /** Curl texture and silhouettes draw from their own stream (straight hair is unaffected). */
  crng: Rng
  /** Rim light colour (graded), from the scene's light rig. */
  rim: string
}

function kit(c: Ctx, G: Geo, color: string, hc: P, label: string): Kit {
  const P = c.paint
  const h = c.sec('hair')
  return {
    c,
    P,
    pal: hairPalette(color),
    G,
    baked: c.baked,
    det: P.detail,
    flat: P.style.shading === 'flat',
    soft: P.style.shading === 'soft',
    L: P.style.light,
    lw: P.lw,
    hh: G.hh,
    shine: h.n('shine'),
    messy: h.n('messy'),
    hi: h.c('highlight', ''),
    streaks: h.n('streaks'),
    tips: h.c('tips', ''),
    hc,
    skin: c.sec('skin').c('tone', '#d69d78'),
    rng: c.rng(label),
    crng: c.rng(`${label}-curl`),
    rim: P.tone(color, 'rim', 'hair'),
  }
}

const sheenA = (k: Kit): number => (0.3 + k.shine * 0.62) * k.pal.sheenK

/* ---- Guides: sampled root → tip curves -------------------------------------------------- */

type Guide = P[]

function gAt(gd: Guide, t: number): P {
  const n = gd.length - 1
  const x = clamp(t, 0, 1) * n
  const i = Math.min(n - 1, Math.floor(x))
  const u = x - i
  const a = gd[i]
  const b = gd[i + 1]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
}

function gLen(gd: Guide): number {
  let s = 0
  for (let i = 1; i < gd.length; i++) s += Math.hypot(gd[i][0] - gd[i - 1][0], gd[i][1] - gd[i - 1][1])
  return s
}

const gMix = (a: Guide, b: Guide, v: number): Guide => a.map((p, i) => lerpP(p, b[Math.min(i, b.length - 1)], v))
const pMix = (a: Guide, b: Guide, v: number, t: number): P => lerpP(gAt(a, t), gAt(b, t), v)

/** n+1 points evenly spaced by arc length along a polyline. */
function resample(pts: P[], n: number): Guide {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const total = cum[cum.length - 1] || 1
  const out: Guide = []
  let j = 0
  for (let i = 0; i <= n; i++) {
    const s = (total * i) / n
    while (j < pts.length - 2 && cum[j + 1] < s) j++
    const seg = cum[j + 1] - cum[j] || 1
    out.push(lerpP(pts[j], pts[Math.min(j + 1, pts.length - 1)], clamp((s - cum[j]) / seg, 0, 1)))
  }
  return out
}

const spline = (ctrl: P[], n = 8): Guide => resample(sampleSmooth(ctrl, false, 5), n)

/** Coherent waves along a guide (no waves at the root). */
function waveG(gd: Guide, amp: number, waves: number, phase: number): Guide {
  if (amp <= 0 || waves <= 0) return gd
  const n = gd.length - 1
  return gd.map((p, i) => {
    const d = norm(sub(gd[Math.min(n, i + 1)], gd[Math.max(0, i - 1)]))
    const t = i / n
    const o = Math.sin((t * waves + phase) * Math.PI * 2) * amp * smoothstep(0.04, 0.3, t)
    return [p[0] - d[1] * o, p[1] + d[0] * o] as P
  })
}

/** Catmull-Rom through the points (as path.ts `smooth`), written compactly: hair outlines
 *  are copied by the painter several times. Absolute commands only: part bounds and the
 *  painter's pathBounds read coordinates as absolute. */
function smooth(points: SP[], closed = true, tension = 1): string {
  const n = points.length
  if (n < 2) return ''
  const at = (i: number): SP => points[closed ? (i + n) % n : clamp(i, 0, n - 1)]
  const kk = (i: number): number => {
    const p = at(i)
    return p.length > 2 ? (p as [number, number, number])[2] : 1
  }
  let d = `M${f(points[0][0])} ${f(points[0][1])}`
  if (n === 2) return d + `L${f(points[1][0])} ${f(points[1][1])}` + (closed ? 'Z' : '')
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t1 = (tension / 6) * kk(i)
    const t2 = (tension / 6) * kk(i + 1)
    d += `C${f(p1[0] + (p2[0] - p0[0]) * t1)} ${f(p1[1] + (p2[1] - p0[1]) * t1)} ${f(p2[0] - (p3[0] - p1[0]) * t2)} ${f(p2[1] - (p3[1] - p1[1]) * t2)} ${f(p2[0])} ${f(p2[1])}`
  }
  return (closed ? d + 'Z' : d).replace(/ -/g, '-')
}

const tube = (spine: P[], radii: number[]): string => smooth(tubePts(spine, radii), true)

/** A lens: a quadratic through s, m, e that bulges ±w at m, with pointed ends. */
function lens(s: P, m: P, e: P, w: number): string {
  const qx = 2 * m[0] - (s[0] + e[0]) / 2
  const qy = 2 * m[1] - (s[1] + e[1]) / 2
  const dx = e[0] - s[0]
  const dy = e[1] - s[1]
  const L = Math.hypot(dx, dy) || 1
  const nx = (-dy / L) * w * 2
  const ny = (dx / L) * w * 2
  // 0.1-unit precision: hair detail is thousands of these. (Absolute: see `smooth`.)
  const sx = f1(s[0])
  const sy = f1(s[1])
  return `M${sx} ${sy}Q${f1(qx + nx)} ${f1(qy + ny)} ${f1(e[0])} ${f1(e[1])}Q${f1(qx - nx)} ${f1(qy - ny)} ${sx} ${sy}Z`.replace(/ -/g, '-')
}

const f1 = (n: number): string => {
  const r = Math.round(n * 10) / 10
  return r === 0 || !Number.isFinite(r) ? '0' : String(r)
}

/** Tapered strand(s) along the line at fraction v between guides a and b, from t0 to t1.
 *  Wavy guides are followed with one lens per piece; `shift` offsets sideways. */
function strandOn(a: Guide, b: Guide, v: number, t0: number, t1: number, w: number, pieces = 1, shift = 0): string {
  let d = ''
  for (let p = 0; p < pieces; p++) {
    const u0 = lerp(t0, t1, p / pieces)
    const u1 = lerp(t0, t1, (p + 1) / pieces)
    const ww = pieces > 1 ? w * (0.65 + 0.35 * Math.sin((Math.PI * (p + 0.5)) / pieces)) : w
    let s = pMix(a, b, v, u0)
    let m = pMix(a, b, v, (u0 + u1) / 2)
    let e = pMix(a, b, v, u1)
    if (shift) {
      const dd = norm(sub(e, s))
      const o: P = [-dd[1] * shift, dd[0] * shift]
      s = [s[0] + o[0], s[1] + o[1]]
      m = [m[0] + o[0], m[1] + o[1]]
      e = [e[0] + o[0], e[1] + o[1]]
    }
    d += lens(s, m, e, ww)
  }
  return d
}

function inPoly(p: P, poly: readonly SP[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const rectD = (b: Box, pad: number): string => `M${f(b.x - pad)} ${f(b.y - pad)}H${f(b.x + b.w + pad)}V${f(b.y + b.h + pad)}H${f(b.x - pad)}Z`

/* ---- Sheets: hanging masses built from guides, with clumped tips ------------------------- */

interface SheetOpts {
  n: number
  tips: Tips
  /** How far each clump tip reaches past its guides' ends. */
  tipLen: number
  /** How far the notches between clumps recede up the guides. */
  notch: number
  rng: Rng
  /** Tip length variation (0..1). */
  jag?: number
  /** Outline points from the last guide's root back to the first guide's root. */
  root?: SP[]
  /** Extra length at the middle clumps (a V-shaped hem). */
  vee?: number
}

interface Sheet {
  d: string
  /** The outline with its root edge pushed far back: shade and rim-light from this so the
   *  root (tucked under other hair) never gets an edge of its own. */
  dx: string
  pts: SP[]
  guides: Guide[]
  /** Per guide, where its separation ends (the notch). */
  ends: number[]
}

function sheet(guideAt: (u: number) => Guide, o: SheetOpts): Sheet {
  const n = Math.max(1, o.n)
  const rng = o.rng
  const guides: Guide[] = []
  for (let i = 0; i <= n; i++) guides.push(guideAt(i === 0 || i === n ? i / n : (i + rng.range(-0.2, 0.2)) / n))
  const jag = o.jag ?? 0.2
  const ends = guides.map((gd, i) => {
    const len = gLen(gd) || 1
    const nd = (i === 0 || i === n ? 0.5 : rng.range(0.8, 1.2)) * o.notch
    return clamp(1 - nd / len, 0.45, 1)
  })
  const pts: SP[] = []
  const g0 = guides[0]
  for (let j = 0; j < g0.length; j++) if (j / (g0.length - 1) < ends[0] - 0.02) pts.push(g0[j])
  pts.push(gAt(g0, ends[0]))
  for (let i = 0; i < n; i++) {
    const A = guides[i]
    const B = guides[i + 1]
    const eA = gAt(A, 1)
    const eB = gAt(B, 1)
    const nA = gAt(A, ends[i])
    const nB = gAt(B, ends[i + 1])
    const cEnd = lerpP(eA, eB, 0.5)
    const dir = norm(sub(cEnd, lerpP(gAt(A, 0.85), gAt(B, 0.85), 0.5)))
    const cw = dist(eA, eB)
    const ext = o.tipLen * (1 + rng.range(-jag, jag)) + (o.vee ?? 0) * (1 - Math.abs(((i + 0.5) / n) * 2 - 1))
    const tip: P = [cEnd[0] + dir[0] * ext, cEnd[1] + dir[1] * ext]
    switch (o.tips) {
      case 'blunt': {
        const a = lerpP(eA, eB, 0.1)
        const b = lerpP(eA, eB, 0.9)
        pts.push([a[0] + dir[0] * ext, a[1] + dir[1] * ext, 0.5], [b[0] + dir[0] * ext, b[1] + dir[1] * ext, 0.5])
        break
      }
      case 'round':
      case 'curl': {
        const hook = o.tips === 'curl' ? cw * 0.12 : 0
        pts.push(lerpP(nA, tip, 0.7), [tip[0] - dir[1] * hook, tip[1] + dir[0] * hook], lerpP(nB, tip, 0.7))
        break
      }
      default: {
        const sA = lerpP(nA, tip, 0.5)
        const sB = lerpP(nB, tip, 0.5)
        pts.push([sA[0] + (nA[0] - cEnd[0]) * 0.2, sA[1] + (nA[1] - cEnd[1]) * 0.2], [tip[0], tip[1], 0], [sB[0] + (nB[0] - cEnd[0]) * 0.2, sB[1] + (nB[1] - cEnd[1]) * 0.2])
      }
    }
    if (i < n - 1) pts.push([nB[0], nB[1], 0.3])
  }
  const gn = guides[n]
  pts.push(gAt(gn, ends[n]))
  for (let j = gn.length - 1; j >= 0; j--) if (j / (gn.length - 1) < ends[n] - 0.02) pts.push(gn[j])
  const back = (gd: Guide): P => {
    const dd = norm(sub(gd[0], gd[1]))
    const l = gLen(gd) * 0.6
    return [gd[0][0] + dd[0] * l, gd[0][1] + dd[1] * l]
  }
  const dx = smooth([back(g0), ...pts, back(gn)])
  if (o.root) pts.push(...o.root)
  return { d: smooth(pts), dx, pts, guides, ends }
}

/** Guides fanning from a root (the part or crown) to points along a boundary, bulging
 *  outward from `centre` so they follow the skull's curvature. */
function fanGuides(rootFor: (E: P) => P, boundary: P[], n: number, centre: P, bulgeK: number, rng: Rng, ns = 8): Guide[] {
  const B = resample(boundary, 96)
  const out: Guide[] = []
  for (let i = 0; i <= n; i++) {
    const u = i === 0 || i === n ? i / n : (i + rng.range(-0.22, 0.22)) / n
    const E = B[Math.round(u * 96)]
    const S = rootFor(E)
    const mid = lerpP(S, E, 0.5)
    const o = norm(sub(mid, centre))
    const bulge = dist(S, E) * bulgeK
    out.push(spline([S, [mid[0] + o[0] * bulge, mid[1] + o[1] * bulge], E], ns))
  }
  return out
}

/* ---- The mass renderer ------------------------------------------------------------------ */

interface Mass {
  /** One outline, or several shapes that read as one mass (outlined as a union). */
  d?: string
  ds?: string[]
  /** Clump boundaries across the mass, edges included (n + 1 guides for n clumps). */
  guides?: Guide[]
  ends?: number[]
  /** Sheen band position along the clumps (0 root … 1 tip); null = no sheen. */
  band?: number | null
  bandLen?: number
  sheenK?: number
  color?: string
  paint?: string
  shade?: number
  offset?: number
  shadeFrom?: string
  outline?: number
  outlineClip?: string
  strands?: boolean
  /** Rim light: false = none, a path = computed from that silhouette. */
  rim?: boolean | string
  sepK?: number
  /** Waves along the guides (wavy hair catches light on every wave). */
  waves?: number
  streakable?: boolean
  /** Soft glow under the sheen streaks (default on). */
  glow?: boolean
  /** Drawn inside the mass before / after the clump detail (occlusion, coils, braids). */
  pre?: string
  post?: string
  /** Drawn after the outline (flyaways). */
  after?: string
  /** The detail stays inside the shapes on its own: skip the clip (saves a path copy). */
  noClip?: boolean
}

function clipFor(k: Kit, ds: string[]): string {
  const id = k.c.defs.unique('hc')
  k.c.defs.put(id, el('clipPath', { id }, ...ds.map((d) => el('path', { d }))))
  return id
}

function drawMass(k: Kit, m: Mass): string {
  const { P } = k
  const ds = m.ds ?? (m.d ? [m.d] : [])
  if (!ds.length) return ''
  const col = m.color ?? k.pal.base
  const union = !!m.ds
  const lwMul = m.outline ?? 1
  const body = union
    ? P.union(ds, col, { paint: m.paint, offset: m.offset ?? 0.1, shade: m.shade, outline: lwMul, outlineClip: m.outlineClip, material: 'hair', spec: 0 })
    : (lwMul > 0 ? P.outlineUnder(ds[0], col, { mul: lwMul, clip: m.outlineClip }) : '') +
      P.shape(ds[0], col, { paint: m.paint, offset: m.offset ?? 0.1, shade: m.shade, shadeFrom: m.shadeFrom, outline: false, material: 'hair', spec: 0 })
  let deco = ''
  if (k.det > 0) {
    deco += m.pre ?? ''
    if (m.guides && m.guides.length > 1) deco += clumpDeco(k, m)
    deco += m.post ?? ''
    if (m.rim !== false) deco += rimLight(k, typeof m.rim === 'string' ? m.rim : (m.shadeFrom ?? ds.join('')))
  }
  const clip = deco ? (m.noClip ? deco : g({ 'clip-path': url(clipFor(k, ds)) }, deco)) : ''
  return body + clip + (m.after ?? '')
}

function clumpDeco(k: Kit, m: Mass): string {
  const gs = m.guides as Guide[]
  const n = gs.length - 1
  const { P, pal, lw } = k
  const rng = k.rng
  const pieces = (m.waves ?? 0) > 0 ? clamp(Math.round((m.waves ?? 0) * 2), 2, k.baked ? 5 : 3) : 1
  const ends = m.ends ?? []
  const endAt = (i: number) => ends[i] ?? 0.94
  let out = ''

  // Painted highlight streaks (the Highlights colour with the Streaks slider).
  if (k.hi && k.streaks > 0.02 && m.streakable !== false) {
    let sd = ''
    const cnt = Math.max(1, Math.round(k.streaks * n * 0.55))
    const step = n / cnt
    for (let j = 0; j < cnt; j++) {
      const i = Math.min(n - 1, Math.floor(j * step + rng.range(0, step * 0.8)))
      const A = gs[i]
      const B = gs[i + 1]
      const te = Math.min(endAt(i), endAt(i + 1))
      const left: P[] = []
      const right: P[] = []
      for (let q = 0; q <= 8; q++) {
        const t = lerp(0.02, te, q / 8)
        left.push(pMix(A, B, 0.2, t))
        right.push(pMix(A, B, 0.8, t))
      }
      sd += smooth([...left, ...right.reverse()])
    }
    out += P.flat(sd, k.hi, 0.86)
  }

  // Separation shadows between clumps, and the lit edge of the clump beyond each one.
  const sepK = m.sepK ?? 1
  if (sepK > 0) {
    let sep = ''
    let soft = ''
    let lit = ''
    for (let i = 1; i < n; i++) {
      const g0 = gs[i]
      const cw = Math.min(dist(gAt(gs[i - 1], 0.5), gAt(g0, 0.5)), dist(gAt(g0, 0.5), gAt(gs[i + 1], 0.5)))
      const w = clamp(cw * 0.09, lw * 0.28, lw * 1.2) * sepK * rng.range(0.65, 1.25)
      const te = endAt(i) - (ends[i] !== undefined && ends[i] < 0.99 ? 0 : rng.range(0, 0.22))
      const ta = 0.05 + rng.next() * 0.2
      if (te - ta < 0.1 || (n > 6 && rng.next() < 0.12)) continue
      sep += strandOn(g0, g0, 0, ta, te, w, pieces)
      if (k.baked && !k.flat) {
        soft += strandOn(g0, g0, 0, ta, te, w * 2.6, pieces)
        if (k.det > 1) {
          const toB = sub(gAt(gs[i + 1], 0.5), gAt(g0, 0.5))
          const nb = toB[0] * k.L[0] + toB[1] * k.L[1] < 0 ? gs[i + 1] : gs[i - 1]
          lit += strandOn(g0, nb, 0.15, ta + 0.06, te * 0.93, w * 0.5, pieces)
        }
      }
    }
    out += P.flat(soft, pal.dark, 0.14) + P.flat(sep, pal.dark, k.flat ? 0.5 : k.soft ? 0.42 : 0.56) + P.flat(lit, pal.light, 0.42)
  }

  // Fine strands (baked stills only).
  if (k.baked && k.det > 1 && m.strands !== false) {
    let sd = ''
    let sl = ''
    for (let i = 0; i < n; i++) {
      const A = gs[i]
      const B = gs[i + 1]
      if (dist(gAt(A, 0.5), gAt(B, 0.5)) < lw * 2) continue
      const te = Math.min(endAt(i), endAt(i + 1))
      for (let j = 0; j < 2; j++) {
        const v = j ? rng.range(0.55, 0.85) : rng.range(0.15, 0.45)
        const ta = rng.range(0.04, 0.3)
        const tb = te - rng.range(0.02, 0.2)
        if (tb - ta < 0.15) continue
        const s = strandOn(A, B, v, ta, tb, lw * 0.13, pieces)
        if (j) sl += s
        else sd += s
      }
    }
    out += P.flat(sd, pal.dark, 0.42) + (k.flat ? '' : P.flat(sl, pal.light, 0.36))
  }

  if (m.band != null && !k.flat && k.shine > 0.03) out += sheen(k, m, gs, pieces)
  return out
}

/** The anisotropic sheen: a band across the flow that follows the head's curvature, made
 *  of streaks along the flow, broken per clump and brightest where the clump faces the light. */
function sheen(k: Kit, m: Mass, gs: Guide[], pieces: number): string {
  const { P, pal } = k
  const n = gs.length - 1
  const rng = k.rng
  const A0 = sheenA(k) * (m.sheenK ?? 1)
  const bl = m.bandLen ?? k.hh * 0.09
  const band = m.band as number
  const b = ['', '', '']
  const glow = ['', '']
  let spec = ''
  const col = k.hi && k.streaks < 0.02 ? mix(pal.sheen, k.hi, 0.6) : pal.sheen
  for (let i = 0; i < n; i++) {
    const A = gs[i]
    const B = gs[i + 1]
    const glen = (gLen(A) + gLen(B)) / 2 || 1
    const ts: number[] = []
    if (pieces > 1) for (let p = 0; p < pieces; p++) ts.push((p + 0.5) / pieces)
    else ts.push(band)
    for (const t0 of ts) {
      const fall = pieces > 1 ? 0.3 + 0.7 * Math.exp(-(((t0 - band) / 0.26) ** 2)) : 1
      if (fall < 0.42) continue
      const tb = clamp(t0 + rng.range(-0.05, 0.05), 0.03, 0.95)
      const p = pMix(A, B, 0.5, tb)
      const cw = dist(gAt(A, tb), gAt(B, tb))
      if (cw < k.lw * 0.8) continue
      const nr = norm(sub(p, k.hc))
      const lv = clamp(0.28 + 0.9 * (nr[0] * k.L[0] + nr[1] * k.L[1]), 0, 1) * fall
      if (lv < 0.12) continue
      const dt = ((pieces > 1 ? bl * 0.7 : bl) / glen) * rng.range(0.8, 1.2)
      // The band on this clump: a soft patch across it, broken at the clump's edges.
      const g0 = tb - dt * 0.55
      const g1 = tb + dt * 0.75
      if (lv > 0.35 && m.glow !== false && k.baked) glow[lv > 0.6 ? 0 : 1] += lens(pMix(A, B, 0.06, (g0 + g1) / 2), pMix(A, B, 0.5, (g0 + g1) / 2 + dt * 0.08), pMix(A, B, 0.94, (g0 + g1) / 2), (g1 - g0) * glen * 0.36)
      // Crisp streaks along the flow, with a long tail toward the tips.
      const v = clamp(0.5 + rng.range(-0.18, 0.18), 0.22, 0.78)
      const w = Math.min(cw * rng.range(0.05, 0.085), bl * 0.12, k.hh * 0.016)
      const bi = lv > 0.66 ? 0 : lv > 0.38 ? 1 : 2
      if (bi === 2 && !k.baked) continue
      b[bi] += lens(pMix(A, B, v, tb - dt * 0.5), pMix(A, B, v, tb - dt * 0.15), pMix(A, B, v, tb + dt * 0.8), w)
      if (k.baked) {
        const v2 = clamp(v + (rng.chance(0.5) ? 1 : -1) * rng.range(0.2, 0.3), 0.1, 0.9)
        b[Math.min(2, bi + 1)] += lens(pMix(A, B, v2, tb - dt * 0.25), pMix(A, B, v2, tb + dt * 0.02), pMix(A, B, v2, tb + dt * 0.5), w * 0.6)
        if (lv > 0.8 && k.det > 1 && Math.abs(t0 - band) < 0.2) spec += lens(pMix(A, B, v, tb - dt * 0.42), pMix(A, B, v, tb - dt * 0.34), pMix(A, B, v, tb - dt * 0.22), w * 0.6)
      }
    }
  }
  const gA = k.soft ? 0.3 : 0.2
  const sA = k.soft ? 0.75 : 1
  return (
    P.flat(glow[0], col, A0 * gA) +
    P.flat(glow[1], col, A0 * gA * 0.5) +
    P.flat(b[0], col, Math.min(1, A0 * sA)) +
    P.flat(b[1], col, A0 * sA * 0.62) +
    P.flat(b[2], col, A0 * sA * 0.32) +
    P.flat(spec, pal.spec, Math.min(1, A0 * 1.15))
  )
}

/** A thin cool rim light on the silhouette, on the side away from the key light. */
function rimLight(k: Kit, d: string): string {
  if (!k.baked || k.flat || k.det < 1 || !d) return ''
  const r = k.lw * 0.55 + k.hh * 0.006
  const dir = norm([-k.L[0] * 1.2, -0.45])
  const bb = pathBounds(d)
  return el('path', {
    d: rectD(bb, r * 3 + 4) + d,
    'fill-rule': 'evenodd',
    fill: k.rim,
    'fill-opacity': 0.34,
    transform: `translate(${f(-dir[0] * r)} ${f(-dir[1] * r)})`,
  })
}

/** Root shade and lighter tips on long masses (baked), or the DNA's ombré tips. */
function tipPaint(k: Kit, key: string, top: number, bottom: number, col: string): string | undefined {
  if (!k.tips) return undefined
  return k.P.linear(`h${key}${col.slice(1)}${k.tips.slice(1)}${Math.round(top)}_${Math.round(bottom)}`, [[0, col], [0.42, col], [1, k.tips]], [0, 0], [0, 1], {
    x: 0,
    y: top,
    w: 1,
    h: Math.max(1, bottom - top),
  })
}

function rootTip(k: Kit, key: string, d: string, top: number, bottom: number, roots = true): string {
  if (!k.baked || k.det < 1 || k.flat || bottom - top < k.hh * 0.5) return ''
  const { pal } = k
  const bb = pathBounds(d)
  const paint = k.P.linear(
    `hrt${key}${roots ? 'r' : ''}${pal.base.slice(1)}${Math.round(top)}_${Math.round(bottom)}`,
    [
      [0, pal.deep, roots ? 0.3 : 0],
      [0.28, pal.deep, 0],
      [0.72, pal.tipTone, 0],
      [1, pal.tipTone, k.tips ? 0 : 0.55],
    ],
    [0, 0],
    [0, 1],
    { x: 0, y: top, w: 1, h: Math.max(1, bottom - top) },
  )
  return el('rect', { x: f(bb.x), y: f(bb.y), width: f(bb.w), height: f(bb.h), fill: paint })
}

/** Stray hairs escaping the silhouette (baked, detail high). */
function flyaways(k: Kit, pts: P[], centre: P, count: number): string {
  if (!k.baked || k.det < 2 || count < 1 || pts.length < 2) return ''
  let d = ''
  for (let i = 0; i < count; i++) {
    const p = pts[k.rng.int(0, pts.length - 1)]
    const n = norm(sub(p, centre))
    const t: P = [-n[1], n[0]]
    const len = k.hh * k.rng.range(0.05, 0.11)
    const curl = k.rng.range(-0.9, 0.9)
    const s: P = [p[0] - n[0] * k.hh * 0.03, p[1] - n[1] * k.hh * 0.03]
    const e: P = [p[0] + (n[0] * 0.75 + t[0] * curl * 0.6) * len, p[1] + (n[1] * 0.75 + t[1] * curl * 0.6) * len]
    const mm: P = [lerp(s[0], e[0], 0.5) + t[0] * curl * len * 0.25, lerp(s[1], e[1], 0.5) + t[1] * curl * len * 0.25]
    d += lens(s, mm, e, k.lw * 0.12)
  }
  return k.P.flat(d, k.pal.base, 0.7)
}

/* ---- Curls: a few big clumps, some suggested strokes and a broken sheen ----------------- */

/** One curl clump on a curly silhouette, with the circle through its two valleys and apex. */
interface Lump {
  a: P
  b: P
  apex: P
  /** Outward normal. */
  n: P
  o: P
  r: number
  L: number
}

interface Lumpy {
  d: string
  lumps: Lump[]
  /** The outline as points (valleys are corners), to splice into other outlines. */
  pts: SP[]
}

/** A curly silhouette along `pts` (bulging away from `centre`): `count` big clumps of
 *  irregular size, height and lean, one cubic each, with notched valleys between them. */
function lumpy(pts: P[], closed: boolean, count: number, bulge: number, centre: P, rng: Rng): Lumpy {
  const B = resample(closed ? [...pts, pts[0]] : pts, 96)
  const n = Math.max(1, Math.round(count))
  const us = [0]
  for (let i = 1; i < n; i++) us.push((i + rng.range(-0.3, 0.3)) / n)
  us.push(1)
  const lumps: Lump[] = []
  const out: SP[] = []
  let d = `M${f1(B[0][0])} ${f1(B[0][1])}`
  for (let i = 0; i < n; i++) {
    const a = gAt(B, us[i])
    const b = gAt(B, us[i + 1])
    const onCurve = gAt(B, (us[i] + us[i + 1]) / 2)
    const L = dist(a, b) || 1
    const t: P = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
    const m = lerpP(a, b, 0.5)
    let nn: P = [-t[1], t[0]]
    if (nn[0] * (onCurve[0] - centre[0]) + nn[1] * (onCurve[1] - centre[1]) < 0) nn = [-nn[0], -nn[1]]
    const sag = Math.max(0, (onCurve[0] - m[0]) * nn[0] + (onCurve[1] - m[1]) * nn[1])
    const hgt = sag + L * bulge * rng.range(0.65, 1.35)
    const lean = rng.range(-0.1, 0.1)
    const k4 = (hgt * 4) / 3
    const c1: P = [a[0] + nn[0] * k4 + t[0] * L * (0.2 + lean), a[1] + nn[1] * k4 + t[1] * L * (0.2 + lean)]
    const c2: P = [b[0] + nn[0] * k4 - t[0] * L * (0.2 - lean), b[1] + nn[1] * k4 - t[1] * L * (0.2 - lean)]
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(b[0])} ${f1(b[1])}`
    const apex: P = [m[0] + nn[0] * hgt + t[0] * L * lean * 0.75, m[1] + nn[1] * hgt + t[1] * L * lean * 0.75]
    const r = (hgt * hgt + (L * L) / 4) / (2 * hgt)
    lumps.push({ a, b, apex, n: nn, o: [m[0] + nn[0] * (hgt - r), m[1] + nn[1] * (hgt - r)], r, L })
    const cu = (s: number): P => {
      const q = 1 - s
      return [q * q * q * a[0] + 3 * q * q * s * c1[0] + 3 * q * s * s * c2[0] + s * s * s * b[0], q * q * q * a[1] + 3 * q * q * s * c1[1] + 3 * q * s * s * c2[1] + s * s * s * b[1]]
    }
    out.push([a[0], a[1], 0.15], cu(0.3), cu(0.7))
  }
  if (!closed) out.push(B[B.length - 1])
  return { d: closed ? d + 'Z' : d, lumps, pts: out }
}

/** How far the clumps of a curly cap bulge: coils most, waves and slicked hair gently. */
const capBulge = (r: Recipe, coilCap: boolean, hatOn: boolean): number => (hatOn || r.slick ? 0.05 : coilCap ? 0.15 + r.curl * 0.05 : 0.09)

/** A crescent on the circle (o, r) from angle a0 sweeping `sw` radians (positive is clockwise
 *  on screen), `w` thick in the middle and pointed at both ends. Two arcs: a few bytes. */
function crescent(o: P, r: number, a0: number, sw: number, w: number): string {
  const s = clamp(Math.abs(sw), 0.05, Math.PI * 1.9)
  const a1 = a0 + (sw < 0 ? -s : s)
  const hc = r * Math.sin(s / 2)
  const s1 = r * (1 - Math.cos(s / 2))
  const s2 = Math.max(s1 * 0.08, s1 - w)
  const r2 = (s2 * s2 + hc * hc) / (2 * s2)
  const cw = sw < 0 ? 0 : 1
  const x0 = f1(o[0] + Math.cos(a0) * r)
  const y0 = f1(o[1] + Math.sin(a0) * r)
  return `M${x0} ${y0}A${f1(r)} ${f1(r)} 0 ${s > Math.PI ? 1 : 0} ${cw} ${f1(o[0] + Math.cos(a1) * r)} ${f1(o[1] + Math.sin(a1) * r)}A${f1(r2)} ${f1(r2)} 0 ${s2 > hc ? 1 : 0} ${1 - cw} ${x0} ${y0}Z`
}

interface CurlOpts {
  /** The clumps on the silhouette (from `lumpy`). */
  lumps?: Lump[]
  /** Where interior strokes may be centred. */
  box: Box
  inside?: (p: P) => boolean
  /** Interior curl strokes in a detailed baked still (fewer at lower quality). */
  strokes: number
  /** Stroke radius in head heights. */
  size?: number
  /** The broken sheen: highlights along an arc (radii rx, ry) around `centre`. */
  sheen?: { centre: P; rx: number; ry: number; spread?: number }
}

/** Curly and coily texture: a mass read as a few big curl clumps. Each clump on the
 *  silhouette tucks under its neighbour (a shadow crescent curling in from the valley on the
 *  side away from the light) and catches light on its lit shoulder; the interior gets only a
 *  few C and S strokes and a sheen band broken into curl highlights. Low contrast, sparse,
 *  seeded (never a tiled grid). */
function curlTexture(k: Kit, o: CurlOpts): string {
  if (k.det < 1) return ''
  const { P, pal, hh, lw } = k
  const rng = k.crng
  const [Lx, Ly] = k.L
  const away = Math.atan2(-Ly, -Lx)
  let sh = ''
  let soft = ''
  let glow = ''
  const hi = ['', '']
  const lumps = o.lumps ?? []
  const inner: P[] = []
  for (const l of lumps) {
    // The underside: continue the clump's circle past the valley away from the light.
    const aA = Math.atan2(l.a[1] - l.o[1], l.a[0] - l.o[0])
    const aB = Math.atan2(l.b[1] - l.o[1], l.b[0] - l.o[0])
    const na = Math.atan2(l.n[1], l.n[0])
    const turn = Math.sin(na - aA) >= 0 ? 1 : -1
    const fromB = (l.b[0] - l.a[0]) * Lx + (l.b[1] - l.a[1]) * Ly < 0
    const start = fromB ? aB : aA
    const dir = fromB ? turn : -turn
    if (rng.chance(0.9)) {
      const arc = Math.min(2.2, (l.L * rng.range(0.6, 1)) / l.r)
      const w = clamp(l.L * rng.range(0.08, 0.12), lw * 0.45, hh * 0.04)
      sh += crescent(l.o, l.r, start + dir * 0.04, dir * arc, w)
      if (k.baked && k.det > 1 && !k.flat) soft += crescent(l.o, l.r * 1.02, start, dir * arc * 1.1, w * 2.6)
    }
    // The lit shoulder.
    const lit = l.n[0] * Lx + l.n[1] * Ly
    const hd = norm([l.n[0] + Lx * 0.9, l.n[1] + Ly * 0.9])
    const ah = Math.atan2(hd[1], hd[0])
    if (lit > -0.2) {
      const rr = l.r - Math.min(l.r * 0.24, l.L * 0.13)
      const sw = (l.L * rng.range(0.24, 0.38)) / rr
      hi[lit > 0.3 ? 0 : 1] += crescent(l.o, rr, ah - sw / 2, sw, l.L * 0.045)
    }
    // Now and then a clump behind it, one clump further in: its underside and lit top.
    if (rng.chance(0.5)) {
      const q: P = [l.apex[0] - l.n[0] * l.L * rng.range(0.8, 1.1) - l.n[1] * l.L * rng.range(-0.25, 0.25), l.apex[1] - l.n[1] * l.L * rng.range(0.8, 1.1) + l.n[0] * l.L * rng.range(-0.25, 0.25)]
      if (!o.inside || o.inside(q)) {
        const rc = l.L * rng.range(0.34, 0.46)
        const du = Math.atan2(-l.n[1] * 0.6 - Ly * 0.8, -l.n[0] * 0.6 - Lx * 0.8)
        const sw = rng.range(1.5, 2.3)
        sh += crescent(q, rc, du - sw / 2, sw, rc * rng.range(0.18, 0.26))
        if (lit > -0.4) hi[1] += crescent(q, rc * 0.72, ah - 0.5, rng.range(0.8, 1.2), rc * 0.14)
        inner.push(q)
      }
    }
  }
  // A few curl strokes inside, spread out, never on a grid.
  const nS = Math.round(o.strokes * (k.baked ? (k.det > 1 ? 1 : 0.7) : 0.5))
  const size = hh * (o.size ?? 0.065)
  const bx = o.box
  const minD = Math.max(size * 2.2, Math.sqrt((bx.w * bx.h) / Math.max(1, nS)) * 0.6)
  const placed: P[] = inner.slice()
  for (let tries = 0; placed.length < nS + inner.length && tries < nS * 10; tries++) {
    const p: P = [bx.x + rng.next() * bx.w, bx.y + rng.next() * bx.h]
    if (o.inside && !o.inside(p)) continue
    if (placed.some((q) => dist(p, q) < minD) || lumps.some((l) => dist(p, l.apex) < l.L * 0.5)) continue
    placed.push(p)
    const r = size * rng.range(0.7, 1.3)
    const w = r * rng.range(0.2, 0.3)
    const a = away + rng.range(-0.8, 0.8)
    if (rng.chance(0.35)) {
      // S: two opposed arcs meeting at a point.
      const s1 = rng.range(1.5, 2.2)
      const a0 = a - s1 / 2
      sh += crescent(p, r, a0, s1, w)
      const e: P = [p[0] + Math.cos(a0 + s1) * r, p[1] + Math.sin(a0 + s1) * r]
      const r2 = r * rng.range(0.7, 0.95)
      const c2: P = [e[0] + Math.cos(a0 + s1) * r2, e[1] + Math.sin(a0 + s1) * r2]
      sh += crescent(c2, r2, a0 + s1 + Math.PI, -s1 * rng.range(0.8, 1.05), w * 0.85)
    } else {
      const sw = rng.range(2.0, 3.1)
      sh += crescent(p, r, a - sw / 2, sw, w)
    }
  }
  // The sheen band, broken into curl highlights (and a soft glow under them, baked).
  if (o.sheen && !k.flat && k.shine > 0.03) {
    const { centre, rx, ry } = o.sheen
    const spread = o.sheen.spread ?? 0.34
    const dC = norm([Lx * 0.7, -1])
    const aC = Math.atan2(dC[1], dC[0])
    const nH = k.baked ? 4 : 3
    const pt = (a: number, s = 1): P => [centre[0] + Math.cos(a) * rx * s, centre[1] + Math.sin(a) * ry * s]
    for (let i = 0; i < nH; i++) {
      const a = aC + (i - (nH - 1) / 2) * spread + rng.range(-0.08, 0.08)
      const q = pt(a, 1 + rng.range(-0.07, 0.07))
      if (o.inside && !o.inside(q)) continue
      const r = size * rng.range(0.85, 1.2)
      const fd = norm([Math.cos(a) + Lx * 0.5, Math.sin(a) + Ly * 0.5])
      const c: P = [q[0] - fd[0] * r, q[1] - fd[1] * r]
      const sw = rng.range(1.2, 1.9)
      hi[i === 0 || i === nH - 1 ? 1 : 0] += crescent(c, r, Math.atan2(fd[1], fd[0]) - sw / 2, sw, r * 0.28)
    }
    if (k.baked) {
      const s = spread * (nH / 2 + 0.3)
      glow = lens(pt(aC - s, 0.97), pt(aC, 1.02), pt(aC + s, 0.97), size * 0.75)
    }
  }
  const A = sheenA(k)
  return (
    P.flat(soft, pal.dark, 0.1) +
    P.flat(sh, pal.dark, k.flat ? 0.5 : k.baked ? 0.34 : 0.38) +
    (k.flat || k.shine < 0.03 ? '' : P.flat(glow, pal.sheen, A * 0.12) + P.flat(hi[0], pal.sheen, Math.min(1, A * 0.8)) + P.flat(hi[1], pal.sheen, A * 0.42))
  )
}

/* ---- Building blocks for extras ---------------------------------------------------------- */

/** A lock of hair: rooted on a segment, tapering to a tip, bending sideways. */
function clump(a: P, b: P, tip: P, bend: number, tips: Tips, rng?: Rng, messy = 0): SP[] {
  const mid = (u: number): P => [lerp((a[0] + b[0]) / 2, tip[0], u), lerp((a[1] + b[1]) / 2, tip[1], u)]
  const dx = tip[0] - (a[0] + b[0]) / 2
  const dy = tip[1] - (a[1] + b[1]) / 2
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const halfW = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2
  const jit = () => (rng ? rng.range(-1, 1) * messy * halfW * 0.4 : 0)
  const off = (u: number, s: number, wf: number): P => {
    const p = mid(u)
    const bendOff = Math.sin(Math.PI * u) * bend * len
    return [p[0] + nx * (s * halfW * wf + bendOff) + jit(), p[1] + ny * (s * halfW * wf + bendOff)]
  }
  if (tips === 'blunt') return [a, off(0.5, -1, 0.95), [tip[0] - nx * halfW * 0.8, tip[1] - ny * halfW * 0.8, 0], [tip[0] + nx * halfW * 0.8, tip[1] + ny * halfW * 0.8, 0], off(0.5, 1, 0.95), b]
  if (tips === 'round' || tips === 'curl') return [a, off(0.45, -1, 0.9), off(0.85, -1, 0.55), [tip[0], tip[1]], off(0.85, 1, 0.55), off(0.45, 1, 0.9), b]
  return [a, off(0.4, -1, 0.85), off(0.75, -1, 0.42), [tip[0], tip[1], 0], off(0.75, 1, 0.42), off(0.4, 1, 0.85), b]
}

function ringPts(cx: number, cy: number, r: number, n: number, rng?: Rng, jitter = 0): P[] {
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const j = rng ? 1 + rng.range(-jitter, jitter) : 1
    out.push([cx + Math.cos(a) * r * j, cy + Math.sin(a) * r * j])
  }
  return out
}

const t0Of = (r: Recipe, hh: number): number => hh * 0.035 + r.vol * hh * 0.35

/** Re-expresses head-space drawing in a hair bone's space, so the bone pivots at its root. */
function onBone(c: Ctx, bone: string, svg: string): string {
  const b = c.skel.get(bone)
  if (!b || !svg) return svg
  return `<g transform="translate(${-b.x} ${-b.y})">${svg}</g>`
}

/** Continues a path through more points (for compound cap outlines). */
function smoothTail(pts: SP[]): string {
  const d = smooth(pts, false)
  return 'L' + d.slice(1) + 'Z'
}

/** A tail of hair along a spine (ponytails, twintails, braid ends): clumps, tips, sheen. */
function tailMass(k: Kit, spine: P[], w0: number, wMax: number, w1: number, n: number, tips: Tips, key: string, wave = 0, ownPart = true): string {
  const gd = spline(spine, wave > 0 ? 16 : 10)
  const last = gd.length - 1
  const nrm = gd.map((_, i) => {
    const d = norm(sub(gd[Math.min(last, i + 1)], gd[Math.max(0, i - 1)]))
    return [-d[1], d[0]] as P
  })
  const width = (t: number) => (t < 0.3 ? lerp(w0, wMax, smoothstep(0, 0.3, t)) : lerp(wMax, w1, smoothstep(0.3, 1, t)))
  const sh = sheet(
    (u) =>
      waveG(
        gd.map((p, i) => {
          const o = (u - 0.5) * 2 * width(i / last)
          return [p[0] + nrm[i][0] * o, p[1] + nrm[i][1] * o] as P
        }),
        wave,
        2.2,
        u * 0.35,
      ),
    { n, tips, tipLen: wMax * (tips === 'blunt' ? 0.05 : 0.45), notch: wMax * (tips === 'blunt' ? 0.1 : 0.55), rng: k.rng, jag: 0.3 },
  )
  const top = Math.min(spine[0][1], spine[spine.length - 1][1])
  const bottom = Math.max(spine[0][1], spine[spine.length - 1][1])
  return drawMass(k, {
    d: sh.d,
    guides: sh.guides,
    ends: sh.ends,
    band: 0.18,
    bandLen: k.hh * 0.08,
    waves: wave > 0 ? 2.2 : 0,
    paint: tipPaint(k, key, spine[0][1], spine[spine.length - 1][1], k.pal.base),
    pre: rootTip(k, key, sh.d, top, bottom),
    // (A painter shadeFrom is referenced from the defs, which compose's resvg-safety culling
    // cannot bound: only use it when the tail is its own part.)
    shadeFrom: ownPart ? sh.dx : undefined,
    rim: sh.dx,
    offset: 0.1,
  })
}

/** A wound bun: spiral separations, a sheen arc that follows the wind, rim light. */
function bunMass(k: Kit, cx: number, cy: number, rr: number, curly: boolean): string {
  const { P, pal, lw } = k
  const rng = k.rng
  if (curly) return coilMass(k, ringPts(cx, cy, rr, 12), 0.15, [cx, cy], rr, '', 6, 1)
  const d = circle(cx, cy, rr)
  let post = ''
  if (k.det > 0) {
    {
      const at = (a: number, r: number): P => [cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.94]
      let sep = ''
      const ph = rng.range(0, Math.PI * 2)
      for (let j = 0; j < 4; j++) {
        const a0 = ph + (j * Math.PI) / 2
        sep += lens(at(a0, rr * 0.12), at(a0 + 1.15, rr * 0.6), at(a0 + 2.2, rr * 0.97), clamp(rr * 0.05, lw * 0.3, lw * 1.1))
      }
      post = P.flat(sep, pal.dark, k.flat ? 0.5 : 0.55)
      if (!k.flat && k.shine > 0.03) {
        const aL = Math.atan2(k.L[1], k.L[0])
        let h0 = ''
        let h1 = ''
        for (let j = -1; j <= 1; j++) {
          const a = aL + j * 0.45
          const s = lens(at(a - 0.3, rr * 0.6), at(a, rr * 0.66), at(a + 0.32, rr * 0.58), rr * (j ? 0.05 : 0.075))
          if (j) h1 += s
          else h0 += s
        }
        const A = sheenA(k)
        post += P.flat(h0, pal.sheen, Math.min(1, A)) + P.flat(h1, pal.sheen, A * 0.55)
      }
    }
  }
  return drawMass(k, { d, offset: 0.14, post })
}

/** A curly mass (afro, puffs, curly buns): a soft silhouette of a few big clumps, sparse
 *  curl strokes inside and a broken sheen toward the light. */
function coilMass(k: Kit, ring: P[], bulge: number, centre: P, R: number, pre = '', lumps = 11, strokes = 6): string {
  const lu = lumpy(ring, true, lumps, bulge, centre, k.crng)
  const bb = boundsOf(ring)
  const post =
    k.det > 0
      ? curlTexture(k, {
          lumps: lu.lumps,
          box: bb,
          inside: (p) => inPoly(p, ring),
          strokes,
          size: clamp((R / k.hh) * 0.22, 0.045, 0.08),
          sheen: { centre, rx: bb.w * 0.36, ry: bb.h * 0.36, spread: 0.26 },
        })
      : ''
  return drawMass(k, { d: lu.d, offset: 0.06, pre, post })
}

/** A braid: alternating slanted lobes, each with its crease, occlusion and highlight. */
function braidMass(k: Kit, from: P, to: P, w: number, segs: number, tieCol: string): string {
  const { P, pal, lw, hh } = k
  const dir = norm(sub(to, from))
  const nrm: P = [-dir[1], dir[0]]
  const segLen = dist(from, to) / segs
  const litSide = nrm[0] * k.L[0] + nrm[1] * k.L[1] > 0 ? 1 : -1
  const lobes: string[] = []
  let crease = ''
  let shade = ''
  let hi = ''
  let hi2 = ''
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs
    const side = i % 2 ? 1 : -1
    const ww = w * (1 - t * 0.3)
    const c0 = lerpP(from, to, t)
    const cc: P = [c0[0] + nrm[0] * side * ww * 0.14, c0[1] + nrm[1] * side * ww * 0.14]
    const ax = norm([dir[0] + nrm[0] * side * 0.48, dir[1] + nrm[1] * side * 0.48])
    let up: P = [-ax[1], ax[0]]
    if (up[0] * dir[0] + up[1] * dir[1] > 0) up = [-up[0], -up[1]]
    const hl = segLen * 0.92
    const hw2 = ww * 0.56
    // A plump, slanted lobe (rounded, not a leaf): the braid's three strands crossing.
    const E = (a: number, sc = 1): P => [cc[0] + (ax[0] * Math.cos(a) * hl + up[0] * Math.sin(a) * hw2) * sc, cc[1] + (ax[1] * Math.cos(a) * hl + up[1] * Math.sin(a) * hw2) * sc]
    const pts: SP[] = []
    for (let j = 0; j < 10; j++) pts.push(j === 0 || j === 5 ? [...E((j / 10) * Math.PI * 2), 0.6] as SP : E((j / 10) * Math.PI * 2))
    lobes.push(smooth(pts))
    if (k.det < 1) continue
    crease += lens(E(Math.PI * 0.1), E(Math.PI * 0.5, 0.97), E(Math.PI * 0.9), Math.max(lw * 0.3, ww * 0.04))
    shade += lens(E(Math.PI * 1.12, 0.85), E(Math.PI * 1.5, 0.82), E(Math.PI * 1.88, 0.85), ww * 0.1)
    const hs = lens(E(Math.PI * 0.8, 0.5), E(Math.PI * 0.55, 0.62), E(Math.PI * 0.25, 0.5), ww * 0.07)
    if (side === litSide) hi += hs
    else hi2 += hs
  }
  const A = sheenA(k)
  const post = (k.flat ? '' : P.flat(shade, pal.dark, 0.35)) + P.flat(crease, pal.dark, 0.7) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, pal.sheen, Math.min(1, A)) + P.flat(hi2, pal.sheen, A * 0.55))
  const tl = hh * 0.17
  const tail = tailMass(k, [to, [to[0] + dir[0] * tl * 0.5, to[1] + dir[1] * tl * 0.5], [to[0] + dir[0] * tl, to[1] + dir[1] * tl]], w * 0.22, w * 0.4, w * 0.12, 3, 'point', 'btail', 0, false)
  const tie = P.shape(ellipse(to[0], to[1], w * 0.3, w * 0.2), tieCol, { offset: 0.2, outline: 0.8 })
  return tail + drawMass(k, { ds: lobes, post, offset: 0.1, rim: false }) + tie
}

/** Ringlets: a spring of tilted coils, each with a crease where it emerges from the coil
 *  above, a shadowed underside and a highlight on its lit shoulder. */
function ringletMass(k: Kit, top: P, len: number, w: number, n: number): string {
  const { P, pal, lw } = k
  const lobes: string[] = []
  let crease = ''
  let shade = ''
  let hi = ''
  const th = (top[0] < 0 ? -1 : 1) * 0.38
  const cT = Math.cos(th)
  const sT = Math.sin(th)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const rx = w * 0.52 * (1 - t * 0.22)
    const ry = (len / n) * 0.74
    const cx = top[0] + Math.sin(i * 1.3) * w * 0.06
    const cy = top[1] + t * len
    const E = (a: number, s = 1): P => [cx + (Math.cos(a) * rx * cT - Math.sin(a) * ry * sT) * s, cy + (Math.cos(a) * rx * sT + Math.sin(a) * ry * cT) * s]
    const pts: P[] = []
    for (let j = 0; j < 10; j++) pts.push(E((j / 10) * Math.PI * 2))
    lobes.push(smooth(pts))
    if (k.det < 1) continue
    crease += lens(E(Math.PI * 1.05), E(Math.PI * 1.5, 0.98), E(Math.PI * 1.95), Math.max(lw * 0.3, rx * 0.05))
    shade += lens(E(Math.PI * 0.12, 0.85), E(Math.PI * 0.5, 0.9), E(Math.PI * 0.88, 0.85), ry * 0.13)
    const lit = k.L[0] < 0 ? 1.28 : 1.72
    hi += lens(E(Math.PI * (lit - 0.14), 0.62), E(Math.PI * lit, 0.74), E(Math.PI * (lit + 0.14), 0.62), ry * 0.08)
  }
  const post = (k.flat ? '' : P.flat(shade, pal.dark, 0.4)) + P.flat(crease, pal.dark, 0.65) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, pal.sheen, Math.min(1, sheenA(k) * 0.95)))
  return drawMass(k, { ds: lobes, post, offset: 0.12, rim: false })
}

/** Spines for twists that spring from the scalp and hang under their own weight. */
function hangingSpines(roots: { p: P; o: P; len: number }[]): P[][] {
  return roots.map(({ p, o, len }) => [p, [p[0] + o[0] * len * 0.22, p[1] + o[1] * len * 0.22 + len * 0.18], [p[0] + o[0] * len * 0.3, p[1] + len * 0.6], [p[0] + o[0] * len * 0.3, p[1] + len]])
}

/** Rope-like strands (locs, box braids, twists): lit side, shadow side and texture. */
function ropeMass(k: Kit, spines: P[][], r0: number, kind: 'locs' | 'box' | 'twist', color?: string, taper = 0.8): string {
  const { P, pal, lw } = k
  const ds: string[] = []
  let hi = ''
  let sh = ''
  let tex = ''
  for (const sp of spines) {
    ds.push(tube(sp, [r0, r0 * 0.95, r0 * taper]))
    if (k.det < 1) continue
    const gd = spline(sp, 10)
    const len = gLen(gd)
    const d0 = norm(sub(gAt(gd, 0.6), gAt(gd, 0.4)))
    const ls = -d0[1] * k.L[0] + d0[0] * k.L[1] >= 0 ? 1 : -1
    hi += strandOn(gd, gd, 0, 0.05, 0.9, r0 * 0.16, 2, ls * r0 * 0.4)
    sh += strandOn(gd, gd, 0, 0.02, 0.98, r0 * 0.3, 1, -ls * r0 * 0.6)
    const step = r0 * (kind === 'box' ? 1.5 : kind === 'twist' ? 1.9 : 2.4) * (k.baked ? 1 : 1.8)
    const nT = Math.floor(len / step)
    for (let j = 1; j < nT; j++) {
      const t = j / nT
      const p = gAt(gd, t)
      const dd = norm(sub(gAt(gd, t + 0.02), gAt(gd, t - 0.02)))
      const nn: P = [-dd[1], dd[0]]
      const rr = r0 * lerp(1, taper, t) * 0.9
      const q = (a: number, b: number): string => `${f(p[0] + nn[0] * rr * a + dd[0] * rr * b)} ${f(p[1] + nn[1] * rr * a + dd[1] * rr * b)}`
      if (kind === 'box') tex += `M${q(0.9, -0.45)}L${q(0, 0.2)}L${q(-0.9, -0.45)}`
      else if (kind === 'twist') tex += `M${q(0.95, -0.55)}Q${q(0.1, 0.1)} ${q(-0.95, 0.55)}`
      else tex += `M${q(0.85, 0)}Q${q(0, 0.4)} ${q(-0.85, 0)}`
    }
  }
  const A = sheenA(k)
  const post =
    k.det > 0
      ? (k.flat ? '' : P.flat(sh, pal.dark, 0.4)) + P.line(tex, pal.dark, lw * 0.4, { opacity: kind === 'locs' ? 0.42 : 0.62 }) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, pal.sheen, Math.min(1, A * 0.85)))
      : ''
  return drawMass(k, { ds, color, offset: 0.1, post, rim: false, noClip: true })
}

/** Spikes (spiky, wolf, mohawk crests): each spike shaded half-and-half with a root sheen. */
function spikeMass(k: Kit, spikes: { root: P; tip: P; w: number }[], color?: string): string {
  const { P, pal } = k
  const ds: string[] = []
  let sh = ''
  let hi = ''
  for (const s of spikes) {
    const d = norm(sub(s.tip, s.root))
    const n: P = [-d[1], d[0]]
    ds.push(smooth(clump([s.root[0] - n[0] * s.w, s.root[1] - n[1] * s.w], [s.root[0] + n[0] * s.w, s.root[1] + n[1] * s.w], s.tip, 0, 'point')))
    if (k.det < 1) continue
    const ls = n[0] * k.L[0] + n[1] * k.L[1] >= 0 ? 1 : -1
    const at = (t: number, o: number): P => {
      const p = lerpP(s.root, s.tip, t)
      return [p[0] + n[0] * ls * s.w * o, p[1] + n[1] * ls * s.w * o]
    }
    sh += lens(at(0, -0.55), at(0.42, -0.5), at(0.97, -0.04), s.w * 0.32)
    hi += lens(at(0.1, 0.35), at(0.3, 0.42), at(0.55, 0.22), s.w * 0.13)
  }
  const post = (k.flat ? '' : P.flat(sh, pal.dark, 0.3)) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, pal.sheen, Math.min(1, sheenA(k) * 0.9)))
  return drawMass(k, { ds, color, offset: 0.08, post, rim: false })
}

/** Very short hair (buzz cuts, shaved sides): a soft-edged translucent tint with a fine
 *  directional texture in baked stills, kept inside the head outline. */
function stubbleCap(k: Kit, pts: P[], headD: string, flowFrom: P): string {
  const { P, pal, hh, c } = k
  const tint = mix(pal.base, pal.dark, 0.2)
  // Same visible density on every skin: scale the tint by the skin-to-hair contrast.
  const ls = toLch(k.skin).l
  const lt = toLch(tint).l
  // Light stubble on darker skin reads by its texture, not by a pale film over the scalp.
  const lighter = lt > ls
  const dk = clamp(0.3 / Math.max(0.05, Math.abs(ls - lt)), 0.6, lighter ? 1.1 : 1.7)
  const soft = k.det > 0 && !k.flat
  let s = soft
    ? P.flat(smooth(pts), tint, 0.22 * dk) + P.flat(smooth(offsetPts(pts, -hh * 0.009) as P[]), tint, 0.2 * dk) + P.flat(smooth(offsetPts(pts, -hh * 0.018) as P[]), tint, 0.18 * dk)
    : P.flat(smooth(pts), tint, Math.min(0.85, 0.5 * dk))
  if (k.baked && k.det > 1) {
    const bb = boundsOf(pts)
    const cell = hh * 0.034
    let d = ''
    let row = 0
    for (let y = bb.y; y < bb.y + bb.h; y += cell * 0.8, row++) {
      for (let x = bb.x + (row % 2 ? cell * 0.5 : 0); x < bb.x + bb.w; x += cell) {
        const p: P = [x + k.rng.range(-0.35, 0.35) * cell, y + k.rng.range(-0.35, 0.35) * cell]
        if (!inPoly(p, pts)) continue
        const dir = norm(sub(p, flowFrom))
        const l = hh * k.rng.range(0.008, 0.014)
        d += `M${f1(p[0])} ${f1(p[1])}L${f1(p[0] + dir[0] * l)} ${f1(p[1] + dir[1] * l)}`
      }
    }
    s += P.line(d, lighter ? pal.light : pal.dark, hh * 0.0045, { opacity: lighter ? 0.55 : clamp(0.4 * dk, 0.3, 0.6) })
    // On deep skin dark stubble reads by its sheen: a few light flecks.
    if (ls < 0.5 && lt < 0.4) {
      let lt = ''
      const pts2 = resample(pts, 60)
      for (let i = 0; i < 40; i++) {
        const p0 = pts2[k.rng.int(0, pts2.length - 1)]
        const p: P = lerpP(p0, [flowFrom[0], flowFrom[1] + hh * 0.3], k.rng.range(0.1, 0.7))
        if (!inPoly(p, pts)) continue
        const dir = norm(sub(p, flowFrom))
        lt += `M${f1(p[0])} ${f1(p[1])}L${f1(p[0] + dir[0] * hh * 0.01)} ${f1(p[1] + dir[1] * hh * 0.01)}`
      }
      s += P.line(lt, pal.sheen, hh * 0.004, { opacity: 0.35 })
    }
  }
  const id = c.defs.unique('hb')
  c.defs.put(id, el('clipPath', { id }, el('path', { d: headD })))
  return g({ 'clip-path': url(id) }, s)
}

/** The soft shadow a fringe or lock casts on the skin, clipped to the face. */
function castShade(k: Kit, ds: string, clipD: string, reach: number): string {
  if (k.det < 1 || k.flat || !ds) return ''
  const { P, c } = k
  const id = c.defs.unique('hs')
  c.defs.put(id, el('clipPath', { id }, el('path', { d: clipD })))
  const dir = norm([-k.L[0] * 0.35, Math.max(0.5, -k.L[1])])
  const col = P.col(shadowOf(k.skin, 0.5))
  const layers: [number, number][] = k.baked ? [[0.25, 0.07], [0.5, 0.07], [0.8, 0.06], [1.15, 0.05]] : [[0.7, 0.16]]
  return g(
    { 'clip-path': url(id) },
    ...layers.map(([s, a]) => el('path', { d: ds, fill: col, 'fill-opacity': f(a), transform: `translate(${f(dir[0] * reach * s)} ${f(dir[1] * reach * s)})` })),
  )
}

/** A soft hairline: hair colour fading into the skin and fine baby hairs (baked). */
function softHairline(k: Kit, win: P[], skipX: number): string {
  if (!k.baked || k.det < 1 || k.flat || win.length < 3) return ''
  const { P, pal, lw, hh } = k
  const d = smooth(win, false)
  let s = P.line(d, shadowOf(k.skin, 0.35), hh * 0.045, { opacity: 0.12 }) + P.line(d, pal.base, lw * 3, { opacity: 0.1 }) + P.line(d, pal.base, lw * 1.6, { opacity: 0.16 })
  if (k.det > 1) {
    const pts = resample(win, 44)
    let bd = ''
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]
      if (Math.abs(p[0]) < skipX || k.rng.next() < 0.5) continue
      const t = norm(sub(pts[i + 1], pts[i - 1]))
      if (Math.abs(t[1]) > 0.55) continue
      let dn: P = [-t[1] * 0.5, 1]
      dn = norm(dn)
      const len = hh * k.rng.range(0.014, 0.032)
      const bend = k.rng.range(-0.5, 0.5)
      const e: P = [p[0] + dn[0] * len + t[0] * bend * len * 0.4, p[1] + dn[1] * len + t[1] * bend * len * 0.4]
      const mm: P = [lerp(p[0], e[0], 0.5) + t[0] * bend * len * 0.2, lerp(p[1], e[1], 0.5) + t[1] * bend * len * 0.2]
      bd += lens([p[0] - dn[0] * len * 0.35, p[1] - dn[1] * len * 0.35], mm, e, lw * 0.13)
    }
    s += P.flat(bd, pal.base, 0.6)
  }
  return s
}

/** A bald scalp: a soft radial highlight tinted by the skin (placed toward the key light)
 *  and a faint shadow where the crown turns away from it, clipped to the head. */
function scalpSheen(c: Ctx): string {
  const P = c.paint
  if (P.detail < 1 || P.style.shading === 'flat') return ''
  const G = geo(c)
  const { hh, hw } = G
  const L = P.style.light
  const skin = c.sec('skin').c('tone', '#d69d78')
  const hi = P.tone(skin, 'highlight', 'skin')
  const sh = P.tone(skin, 'shadow', 'skin')
  const side = c.view === 'side'
  const x0 = side ? hw * 0.1 : 0
  const sheenId = c.defs.add(`scalp${hi.slice(1)}`, (id) =>
    el(
      'radialGradient',
      { id },
      el('stop', { offset: 0, 'stop-color': hi, 'stop-opacity': 0.55 }),
      el('stop', { offset: 0.45, 'stop-color': hi, 'stop-opacity': 0.2 }),
      el('stop', { offset: 1, 'stop-color': hi, 'stop-opacity': 0 }),
    ),
  )
  const crownId = c.defs.add(`crown${sh.slice(1)}${Math.round(L[0] * 10)}`, (id) =>
    el(
      'radialGradient',
      { id, cx: f(0.5 + L[0] * 0.12), cy: f(0.62 + L[1] * 0.08), r: 0.62 },
      el('stop', { offset: 0.72, 'stop-color': sh, 'stop-opacity': 0 }),
      el('stop', { offset: 1, 'stop-color': sh, 'stop-opacity': 0.28 }),
    ),
  )
  const hx = x0 + L[0] * hw * 0.42
  const hy = G.crownY + hh * (c.view === 'back' ? 0.2 : 0.15)
  const headD = smooth(offsetPts(side ? profileOutline(G.m, c) : faceGeom(c).outline, -P.lw * 0.4))
  const clip = c.defs.unique('sc')
  c.defs.put(clip, el('clipPath', { id: clip }, el('path', { d: headD })))
  const crown = el('ellipse', { cx: f(x0 - (side ? hw * 0.1 : 0)), cy: f(G.crownY + hh * 0.36), rx: f(hw * (side ? 1.05 : 1.1)), ry: f(hh * 0.42), fill: url(crownId) })
  const sheen = P.detail > 1 ? el('ellipse', { cx: f(hx), cy: f(hy), rx: f(hw * 0.26), ry: f(hh * 0.075), fill: url(sheenId) }) : ''
  return g({ 'clip-path': url(clip) }, crown, sheen)
}

/* ---- The generator -------------------------------------------------------------------- */

/** A hairstyle's recipe with the hair section's sliders applied (length, volume, curl, bangs
 *  and part overrides). The 2D generator and the 3D engine (`avatar3dSource`) both use it, so
 *  a style means the same thing in both. */
export type HairRecipe = Recipe

export function resolveHairRecipe(h: Reader): HairRecipe {
  const base = RECIPES[h.s('style') || 'short-messy'] ?? RECIPES['short-messy']
  if (base.cap === 'none') return base
  const bangsOverride = h.s('bangs')
  const partOverride = h.s('part')
  const lenK = lerp(0.6, 1.5, h.n('length'))
  const volK = lerp(0.45, 1.7, h.n('volume'))
  return {
    ...base,
    side: base.side * (base.side > 0.5 ? lenK : lerp(0.85, 1.2, h.n('length'))),
    back: base.back * (base.back > 0.4 ? lenK : 1),
    vol: base.vol * volK,
    flare: base.flare * lerp(0.85, 1.25, h.n('volume')),
    curl: clamp(base.curl + h.n('curl') * (1 - base.curl) * 0.9 - (base.slick ? 0.2 : 0), 0, 1),
    bangs: bangsOverride && bangsOverride !== 'auto' ? (bangsOverride as Bangs) : base.bangs,
    part: partOverride && partOverride !== 'auto' ? (partOverride as Recipe['part']) : base.part,
  }
}

export function hairGen(c: Ctx, out: PartList): void {
  if (!c.hr) return
  facialHairGen(c, out)
  if (c.hides('hair')) return
  const h = c.sec('hair')
  const r = resolveHairRecipe(h)
  if (r.cap === 'none') {
    // Bald: the scalp's own soft sheen toward the key light, and a faint crown shadow.
    const sc = scalpSheen(c)
    if (sc) out.add('head', Z.skinDetail, 'scalp-shine', sc)
    return
  }
  const G = geo(c)
  const k = kit(c, G, hairColorOf(c), [c.view === 'side' ? -G.hw * 0.1 : 0, G.cy], 'hair-deco')
  const hatOn = c.hides('hairTop')
  const hairline = h.n('hairline')

  if (c.view === 'back') return hairBackView(k, out, r, hatOn)
  if (c.view === 'side') return hairSideView(k, out, r, hatOn, hairline)
  hairFrontView(k, out, r, hatOn, hairline)
}

/* ---- Front view --------------------------------------------------------------- */

function hairFrontView(k: Kit, out: PartList, r: Recipe, hatOn: boolean, hairline: number): void {
  const { c, P, G, pal } = k
  const rng = c.rng('hair')
  const { hh, hw, cy } = G
  const m = G.m
  const sx = (c.hr as HumanRig).sx
  const messy = k.messy
  const t0 = hh * 0.035 + r.vol * hh * 0.35
  const thick = (a: number) => t0 * (0.45 + 0.55 * Math.max(0, -Math.sin(a))) + (r.sides !== 'normal' && Math.abs(Math.cos(a)) > 0.6 ? -t0 * 0.6 : 0)
  const curly = r.curl > 0.42
  const coily = r.curl > 0.72
  const wavy = r.curl > 0.25 && !coily
  const partX = r.part === 'left' ? hw * 0.36 * sx : r.part === 'right' ? -hw * 0.36 * sx : 0
  const hideBack = c.hides('hairBack')
  const fg = faceGeom(c)
  const faceD = smooth(fg.outline)
  const ropes = r.extras.includes('locs') || r.extras.includes('box-braids')
  const cornrows = r.texture === 'rows'
  // Coily caps read as a few big curl clumps; slicked, braided and roped hair keeps its flow.
  const coilCap = coily && !r.slick && !cornrows && !ropes

  // Envelope over the skull, left temple → crown → right temple, with soft clump lobes.
  const envPts: P[] = []
  const N = 28
  const lobeAmp = curly || hatOn ? 0 : (r.slick ? 0.2 : 1) * t0 * (0.16 + messy * 0.35)
  const lobes = 6 + (r.spikes > 0 ? 2 : 0) + Math.round(messy * 3)
  for (let i = 0; i <= N; i++) {
    const a = Math.PI + (i / N) * Math.PI
    const nz = 1 + noise1(c.dna.seed + 11, i * 0.7) * messy * 0.08
    const bump = lobeAmp * (Math.pow(Math.abs(Math.sin(Math.PI * ((i / N) * lobes + 0.5))), 0.7) - 0.55) * Math.min(1, Math.sin((i / N) * Math.PI) * 3)
    envPts.push(G.env(a, (hatOn ? t0 * 0.3 : thick(a)) * nz + bump))
  }
  const sideX = hw * 0.98 + t0 * 0.55
  const sideBottom = G.sideY(Math.min(r.side, 0.62))
  const hlY = G.crownY * lerp(0.8, 0.66, clamp(hairline, 0, 1))
  const shadeDs: string[] = []

  /* Back mass. */
  const afro = r.extras.includes('afro')
  const hasBack = (r.back > 0.02 || curly || r.side > 0.5) && !afro
  if (hasBack && r.cap === 'full' && !hideBack) {
    const yB = Math.max(G.backY(r.back), sideBottom + hh * 0.05)
    const botHalf = r.back < 0.5 ? sideX * 1.02 : Math.max(sideX, lerp(hw * 1.15, m.shoulderHalf * 0.98, clamp(r.back - 0.6, 0, 1))) * r.flare
    const span = yB - cy
    const wMid = lerp(sideX, botHalf, 0.55) * (1 + r.vol * 0.25)
    const amp = wavy || coily ? hh * lerp(0.015, 0.05, clamp(r.curl * 1.3, 0, 1)) * clamp(span / hh, 0.4, 1) : 0
    const waves = amp ? lerp(1.1, 3.4, r.curl) * clamp(span / hh, 0.5, 2.2) : 0
    const sh = sheet(
      (u) => {
        const a = Math.PI + u * Math.PI
        const x = u * 2 - 1
        const gd = spline([G.env(a, thick(a) * 0.85), [x * sideX * 1.02, cy + hh * 0.1], [x * wMid, lerp(cy, yB, 0.55)], [x * botHalf, yB]], amp ? 18 : 8)
        return waveG(gd, amp, waves, u * 0.7)
      },
      {
        n: span > hh * 0.7 ? 9 : 6,
        vee: span > hh * 1.2 && r.tips !== 'blunt' ? hh * 0.05 : 0,
        tips: curly ? 'curl' : r.tips,
        tipLen: hh * (r.tips === 'blunt' && !curly ? 0.012 : curly ? 0.05 : 0.09),
        notch: hh * (r.tips === 'blunt' && !curly ? 0.018 : 0.08),
        rng,
        jag: 0.25 + messy * 0.4,
        root: envPts.slice(1, -1).reverse(),
      },
    )
    const avg = sh.guides.reduce((s, gd) => s + gLen(gd), 0) / sh.guides.length || 1
    let pre = rootTip(k, 'back', sh.d, G.crownY, yB)
    if (k.det > 0 && !k.flat && k.baked) {
      const ring = (s: number) => smooth(fg.outline.map(([x, y]) => [x * s, -hh * 0.42 + (y + hh * 0.42) * s] as P))
      pre += P.flat(ring(1.22), pal.deep, 0.16) + P.flat(ring(1.08), pal.deep, 0.24) + P.flat(ellipse(0, hh * 0.15, m.neckR * 1.9, hh * 0.34), pal.deep, 0.3)
    }
    const svg = drawMass(k, {
      d: sh.d,
      guides: sh.guides,
      ends: sh.ends,
      band: clamp((hh * 0.62) / avg, 0.12, 0.6),
      sheenK: 0.6,
      color: pal.back,
      paint: tipPaint(k, 'back', G.crownY, yB, pal.back),
      offset: 0.06,
      shade: 0.9,
      pre,
      waves,
    })
    out.add('hairBack', Z.hairBack, 'hair-back', onBone(c, 'hairBack', svg))
  }

  /* Extras that sit behind the head. */
  extrasFront(k, out, r, rng, hatOn, 'back')

  /* Stubble (buzz cuts, shaved sides). */
  const hlYs = hlY + hh * 0.02
  if (r.cap === 'stubble' || r.sides === 'shaved') {
    const pts: P[] = []
    for (let i = 0; i <= 16; i++) pts.push(G.env(Math.PI + (i / 16) * Math.PI, hh * 0.012))
    const sb = Math.min(sideBottom * 0.9, m.earY + hh * 0.02)
    const inner: P[] = [[hw * 0.93, sb], [hw * 0.92, -hh * 0.55], [hw * 0.65, hlYs], [0, hlY], [-hw * 0.65, hlYs], [-hw * 0.92, -hh * 0.55], [-hw * 0.93, sb]]
    const all: P[] = [[-hw * 0.99, sb], ...pts, [hw * 0.99, sb], ...inner]
    out.add('head', Z.hairCap - 1, 'hair-stubble', stubbleCap(k, all, smooth(offsetPts(fg.outline, -P.lw * 0.5)), [0, G.crownY - hh * 0.1]))
  }

  /* Cap, and the face-framing locks, drawn as one mass so they flow out of the cap with
   * no seam: the locks hug the cheeks, swell with volume and end in the style's tips. */
  let win: P[] = []
  if (r.cap === 'full') {
    const sbY = r.sides === 'shaved' ? -hh * 0.62 : r.sides === 'short' ? -hh * 0.45 : Math.min(sideBottom, m.earY + hh * 0.02)
    const locks = r.side > 0.62 && !afro && !ropes
    const iL = locks ? 3 : 0
    let topPts = envPts.slice(iL, N + 1 - iL)
    if (r.sides === 'shaved') topPts = topPts.filter((p) => p[1] < -hh * 0.62 || Math.abs(p[0]) < hw * 0.7)
    let d: string
    let helmet: string
    let fanB: P[]
    let yCut: number
    let cutX: number
    const lockSh: Sheet[] = []
    let lockY = 0
    let lockWaves = 0
    // A curly silhouette is a few big clumps: bumpy for coils, soft for waves and slicked hair.
    let capLumps: Lump[] = []
    let capPoly: SP[] = []
    // The silhouette as points, for the helmet the cap is shaded and rim-lit from.
    let edge: SP[] = topPts
    const lumpEdge = (pts: P[]): string => {
      const n = clamp(Math.round(gLen(pts) / (hh * (coilCap ? 0.25 : 0.32)) + messy * 1.5), 4, 10)
      const lu = lumpy(pts, false, n, capBulge(r, coilCap, hatOn), [0, cy], k.crng)
      capLumps = lu.lumps
      edge = lu.pts
      return lu.d
    }
    if (locks) {
      lockY = G.sideY(r.side)
      const spread = lockY > fg.chinY ? 1 + 0.18 * r.flare : 1
      const tipKind: Tips = curly ? 'curl' : r.tips
      const y0 = hlY + hh * 0.06
      const y1 = -hh * 0.56
      const amp = wavy || coily ? hh * lerp(0.012, 0.035, clamp(r.curl * 1.3, 0, 1)) : 0
      lockWaves = amp ? lerp(1, 2.6, r.curl) * clamp((lockY - y0) / hh, 0.4, 1.8) : 0
      for (const s of [-1, 1]) {
        const inX = (y: number) => s * Math.max(hw * 0.62, (y < fg.chinY ? fg.widthAt(y) : hw * 0.8) * 0.86)
        const bulge = hw * 1.06 + t0 * 0.5
        const ns = amp ? 16 : 8
        const top = s < 0 ? envPts[iL] : envPts[N - iL]
        const gO = spline([top, [s * bulge * spread, lerp(y1, lockY, 0.38)], [s * (hw * 0.99 + t0 * 0.2) * spread, lerp(y1, lockY, 0.8)], [s * hw * 0.93 * spread, lockY]], ns)
        const gI = spline([[s * hw * 0.5, y0], [inX(lerp(y0, lockY, 0.22)), lerp(y0, lockY, 0.22)], [inX(lerp(y0, lockY, 0.55)), lerp(y0, lockY, 0.55)], [inX(lerp(y0, lockY, 0.85)), lerp(y0, lockY, 0.85)], [s * hw * 0.8 * spread, lockY - hh * 0.02]], ns)
        lockSh.push(
          sheet((u) => waveG(gMix(gI, gO, u), amp, lockWaves, 0.25 + u * 0.3), {
            n: r.side > 1.2 ? 3 : 2,
            tips: tipKind,
            tipLen: hh * (tipKind === 'blunt' ? 0.008 : 0.07),
            notch: hh * (tipKind === 'blunt' ? 0.015 : 0.06),
            rng,
            jag: 0.2 + messy * 0.4,
          }),
        )
      }
      const [L, Rt] = lockSh
      const inL = L.guides[0][0]
      const inR = Rt.guides[0][0]
      const oL = L.guides[L.guides.length - 1]
      const oR = Rt.guides[Rt.guides.length - 1]
      win = [inR, [lerp(partX, inR[0], 0.55), lerp(hlY, inR[1], 0.35)], [partX, hlY - hh * 0.01], [lerp(partX, inL[0], 0.55), lerp(hlY, inL[1], 0.35)], inL]
      const tail: SP[] = [...Rt.pts.slice().reverse(), ...win.slice(1, -1), ...L.pts]
      d = curly && !cornrows ? lumpEdge(topPts) + smoothTail(tail) : smooth([...topPts, ...tail])
      capPoly = [...topPts, ...tail]
      helmet = smooth([...oL.slice().reverse(), ...edge, ...oR, [oR[oR.length - 1][0], hh * 3], [oL[oL.length - 1][0], hh * 3]])
      fanB = [oL[0], inL, ...win.slice().reverse(), inR, oR[0]]
      yCut = y0 + hh * 0.03
      cutX = hw * 0.5
    } else {
      const innerR: P[] = [
        [hw * 0.965, sbY - hh * 0.045],
        [hw * 0.93, -hh * 0.56],
        [hw * 0.74, hlY + hh * 0.05],
        [partX + hw * 0.18, hlY + hh * 0.005],
      ]
      const inner: P[] = [...innerR, [partX, hlY - hh * 0.01], ...innerR.map(([x, y]) => [-x, y] as P).reverse()]
      const outerL: SP = [-sideX, sbY, 0.4]
      const outerR: SP = [sideX, sbY, 0.4]
      d = curly && !cornrows ? lumpEdge([[-sideX, sbY], ...topPts, [sideX, sbY]]) + smoothTail(inner) : smooth([outerL, ...topPts, outerR, ...inner])
      capPoly = [outerL, ...topPts, outerR, ...inner]
      helmet = smooth(edge === topPts ? [outerL, ...topPts, outerR, [outerR[0], hh * 0.5], [outerL[0], hh * 0.5]] : [...edge, [outerR[0], hh * 0.5], [outerL[0], hh * 0.5]])
      fanB = [[-sideX * 0.99, sbY], ...inner.slice().reverse(), [sideX * 0.99, sbY]]
      win = inner
      yCut = -hh * 0.54
      cutX = hw * 0.97
    }
    // Drop the hairline outline across the forehead wherever bangs cover it; baked stills
    // replace it with a soft hairline. Sideburns and locks keep their outline.
    const softLine = k.baked && k.det > 0 && !k.flat
    let outlineClip: string | undefined
    if (r.bangs !== 'none' || softLine) {
      outlineClip = c.defs.unique('cw')
      const wn = offsetPts([...win.filter((p) => p[1] < yCut), [-cutX, yCut], [cutX, yCut]], P.lw * 1.5)
      c.defs.put(outlineClip, el('clipPath', { id: outlineClip }, el('path', { d: `M${-hw * 5} ${-hh * 3}H${hw * 5}V${hh * 3}H${-hw * 5}Z` + smooth(wn, true, 0), 'clip-rule': 'evenodd' })))
    }
    // Flow: from the part (or from beyond the crown) down to the hairline and the sides.
    const partTop: P = [partX * 0.4, G.crownY - t0 - hh * 0.06]
    const partBot: P = [partX, hlY - hh * 0.015]
    const crown: P = [0, G.crownY - t0 - hh * 0.16]
    const rows = r.texture === 'rows'
    const nCap = rows ? 9 : ropes ? 15 : Math.round((k.baked ? 10 : 8) + messy * 4)
    const capWaves = curly && (!coily || (r.slick && !ropes && !rows)) ? 2.2 : 0
    const guides = fanGuides(
      (E) => (r.part === 'none' || rows ? crown : lerpP(partBot, partTop, clamp(0.35 + (Math.abs(E[0] - partX) / (sideX * 2)) * 0.9, 0.35, 0.98))),
      fanB,
      nCap,
      [0, cy],
      0.22,
      rng,
      capWaves ? 16 : 8,
    ).map((gd, i) => (capWaves ? waveG(gd, hh * 0.018 * r.curl, capWaves, i * 0.08) : gd))
    let post = ''
    const yLim = hlY + hh * 0.1
    const capIn = locks ? (p: P) => p[1] < yLim + (Math.sin(p[0] * 0.37 + p[1] * 0.11) * 0.5 + 0.5) * hh * 0.16 : undefined
    if (coilCap && k.det > 0) {
      const sR = afro ? t0 * 0.5 : t0 * 0.35
      post += curlTexture(k, {
        // The afro's cap sits inside the afro: its edge clumps would draw a seam.
        lumps: afro ? [] : capLumps,
        box: pathBounds(d),
        inside: (p) => inPoly(p, capPoly) && (!capIn || capIn(p)),
        strokes: 4 + Math.round(messy * 2),
        sheen: hatOn ? undefined : { centre: [0, cy], rx: G.rx + sR, ry: G.ry + sR },
      })
    }
    if (rows) post += cornrowDeco(k, guides)
    if (ropes) post += ropeDeco(k, guides, r.extras.includes('box-braids') ? 'box' : 'locs')
    if (r.part !== 'none' && !curly && !hatOn && k.det > 0) post += P.flat(lens(partBot, lerpP(partBot, partTop, 0.5), partTop, P.lw * 0.35), pal.deep, 0.55)
    for (const sh of lockSh) {
      post += clumpDeco(k, { guides: sh.guides, ends: sh.ends, band: 0.26, bandLen: hh * 0.12, waves: lockWaves })
      if (k.baked) shadeDs.push(sh.d)
    }
    if (lockSh.length) post += rootTip(k, 'lock', d, hlY, lockY, false)
    const fly = hatOn || curly || r.slick ? 0 : Math.round(messy * 7 + 0.6)
    const svg = drawMass(k, {
      d,
      guides: coilCap ? undefined : guides,
      ends: guides.map(() => (ropes ? 0.97 : 0.88)),
      band: hatOn || coilCap || (coily && ropes) ? null : 0.4,
      waves: capWaves,
      bandLen: hh * 0.13,
      offset: 0.1,
      shadeFrom: helmet,
      outlineClip,
      sepK: rows ? 1.5 : ropes ? 1.4 : r.slick ? 0.6 : 1,
      sheenK: r.slick ? 1.35 : 1,
      outline: afro ? 0 : 1,
      shade: afro ? 0.3 : undefined,
      paint: locks ? tipPaint(k, 'cap', G.crownY, lockY, pal.base) : undefined,
      post,
      rim: afro ? false : helmet,
      after: flyaways(k, envPts.slice(4, -4), [0, cy], fly),
    })
    out.add('head', Z.hairCap, 'hair-cap', svg)
    if ((softLine || afro) && r.bangs === 'none' && P.lw > 0) out.add('head', Z.hairCap + 0.1, 'hair-edge', el('path', { d: smooth(win, false), fill: 'none', stroke: P.ink(pal.base), 'stroke-width': f(P.lw * (softLine ? 0.5 : 0.8)), 'stroke-opacity': 0.7, 'stroke-linecap': 'round' }))
    const hl = softHairline(k, win, r.bangs === 'none' ? 0 : hw * 0.62)
    if (hl) out.add('head', Z.hairCap - 1.5, 'hair-line', hl)

    // Spikes (spiky, wolf).
    if (r.spikes > 0 && !hatOn) {
      const spikes: { root: P; tip: P; w: number }[] = []
      // Few spikes (wolf cut) are tufts on the crown; many (spiky) fan all round.
      const few = r.spikes < 7
      for (let i = 0; i < r.spikes; i++) {
        const t = (i + 0.5) / r.spikes
        const a = few ? Math.PI * (1.2 + t * 0.6) : Math.PI * (1.08 + t * 0.84)
        const root = G.env(a, thick(a) * 0.2 - hh * 0.03)
        const len = hh * (0.17 + rng.next() * 0.08) * (0.75 + r.vol * 1.6) * (few ? 0.62 : 1)
        spikes.push({ root, tip: [root[0] + Math.cos(a) * len + (a - Math.PI * 1.5) * hh * 0.05, root[1] + Math.sin(a) * len], w: hh * 0.085 })
      }
      out.add('head', Z.hairCap - 0.4, 'hair-spikes', spikeMass(k, spikes))
    }
  }

  /* Bangs. */
  if (r.cap === 'full' && r.bangs !== 'none') {
    const b = bangsFront(k, r, rng, hlY, partX, win)
    if (b) {
      const bc = c.defs.unique('bc')
      const env = envPts.filter((p) => p[1] < hlY + hh * 0.02)
      c.defs.put(bc, el('clipPath', { id: bc }, el('path', { d: smooth([...env, [env[env.length - 1][0], hh * 0.6], [env[0][0], hh * 0.6]], true, 0) })))
      out.add('head', Z.hairCap - 0.5, 'hair-bangs', g({ 'clip-path': url(bc) }, b.svg))
      shadeDs.unshift(b.d)
    }
  }
  if (shadeDs.length) {
    const sh = castShade(k, shadeDs.join(''), faceD, hh * 0.04)
    if (sh) out.add('head', Z.facePaint + 1, 'hair-shade', sh)
  }

  extrasFront(k, out, r, rng, hatOn, 'front')
}

function cornrowDeco(k: Kit, gs: Guide[]): string {
  if (k.det < 1) return ''
  const { P, pal, lw, hh } = k
  let chev = ''
  let hi = ''
  for (let i = 0; i < gs.length - 1; i++) {
    const A = gs[i]
    const B = gs[i + 1]
    const len = (gLen(A) + gLen(B)) / 2
    const nSeg = Math.max(3, Math.floor(len / (hh * 0.045)))
    for (let j = 1; j < nSeg; j++) {
      const t = j / nSeg
      if (t > 0.97) break
      const cw = dist(gAt(A, t), gAt(B, t))
      const p = pMix(A, B, 0.5, t)
      const dd = norm(sub(pMix(A, B, 0.5, t + 0.03), p))
      const nn: P = [-dd[1], dd[0]]
      const q = (a: number, b: number): P => [p[0] + nn[0] * cw * a + dd[0] * hh * b, p[1] + nn[1] * cw * a + dd[1] * hh * b]
      chev += lens(q(0.36, -0.015), q(0.18, 0.004), q(0, 0.016), lw * 0.28) + lens(q(-0.36, -0.015), q(-0.18, 0.004), q(0, 0.016), lw * 0.28)
      hi += lens(q(0.3, -0.004), q(0.15, 0.012), q(0.02, 0.024), cw * 0.06)
    }
  }
  return P.flat(chev, pal.dark, 0.6) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, pal.sheen, sheenA(k) * 0.6))
}

/** Locs and box braids seen on the scalp: each clump reads as a rope. */
function ropeDeco(k: Kit, gs: Guide[], kind: 'locs' | 'box'): string {
  if (k.det < 1) return ''
  const { P, pal, lw, hh } = k
  let tex = ''
  let hi = ''
  for (let i = 0; i < gs.length - 1; i++) {
    const A = gs[i]
    const B = gs[i + 1]
    const len = (gLen(A) + gLen(B)) / 2
    const step = hh * (kind === 'box' ? 0.035 : 0.05) * (k.baked ? 1 : 1.6)
    const nT = Math.floor(len / step)
    for (let j = 1; j < nT; j++) {
      const t = j / nT
      const cw = dist(gAt(A, t), gAt(B, t)) * 0.5
      const p = pMix(A, B, 0.5, t)
      const dd = norm(sub(pMix(A, B, 0.5, Math.min(1, t + 0.03)), p))
      const nn: P = [-dd[1], dd[0]]
      const q = (a: number, b: number): string => `${f(p[0] + nn[0] * cw * a + dd[0] * cw * b)} ${f(p[1] + nn[1] * cw * a + dd[1] * cw * b)}`
      tex += kind === 'box' ? `M${q(0.8, -0.4)}L${q(0, 0.2)}L${q(-0.8, -0.4)}` : `M${q(0.8, 0)}Q${q(0, 0.35)} ${q(-0.8, 0)}`
    }
    const toL = A[0][0] < B[0][0] ? -1 : 1
    hi += strandOn(A, B, 0.5 + toL * k.L[0] * 0.25, 0.08, 0.9, hh * 0.008, 1)
  }
  return P.line(tex, pal.dark, lw * 0.38, { opacity: kind === 'box' ? 0.6 : 0.4 }) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, pal.sheen, sheenA(k) * 0.7))
}

function bangsFront(k: Kit, r: Recipe, rng: Rng, hlY: number, partX: number, window: P[]): { svg: string; d: string } | null {
  const { c, P, G } = k
  // Bangs are outlined only where they hang over the face, so they melt into the cap.
  const clipId = c.defs.unique('bw')
  c.defs.put(clipId, el('clipPath', { id: clipId }, el('path', { d: smooth([...window, [-G.hw * 4, G.hh * 3], [G.hw * 4, G.hh * 3]], true, 0) })))
  const { hh, hw } = G
  const m = G.m
  const browY = m.eyeY - hh * 0.12
  const bottomAt = (len: number) => lerp(hlY + hh * 0.03, browY + hh * 0.06, clamp(len, 0, 1.4))
  const yB = bottomAt(r.bangLen)
  const top = hlY - hh * 0.14
  const edge = hw * 0.9
  const sxr = (c.hr as HumanRig).sx
  const dir = partX > 0 ? -1 : 1
  const paint = tipPaint(k, 'bangs', top, yB, k.pal.base)
  const blunt = r.tips === 'blunt' && r.curl < 0.42
  const curlyB = r.curl > 0.42
  const pointy: Tips = curlyB ? 'round' : 'point'
  const wav = r.curl > 0.3 ? hh * (curlyB ? 0.02 : 0.012) * r.curl : 0
  const sheets: Sheet[] = []
  switch (r.bangs) {
    case 'crop':
      sheets.push(
        sheet((u) => spline([[lerp(-edge * 0.8, edge * 0.8, u), top], [lerp(-edge * 0.83, edge * 0.83, u), lerp(top, hlY, 0.6)], [lerp(-edge * 0.8, edge * 0.8, u), hlY + hh * 0.025]], 6), {
          n: 9,
          tips: 'point',
          tipLen: hh * 0.014,
          notch: hh * 0.02,
          rng,
          jag: 0.4,
        }),
      )
      break
    case 'straight':
      sheets.push(
        sheet(
          (u) => {
            const x = lerp(-edge, edge, u)
            const e = Math.abs(x) / edge
            const yb = yB + Math.sin(Math.PI * u) * hh * 0.012 - e * e * hh * 0.02
            return waveG(spline([[x * 0.82, top], [x * (1.03 + 0.02 * e), lerp(top, yb, 0.55)], [x, yb]], 8), wav, 1.2, u)
          },
          { n: 8, tips: blunt ? 'blunt' : pointy, tipLen: hh * (blunt ? 0.004 : 0.035), notch: hh * (blunt ? 0.012 : 0.032), rng, jag: 0.25, root: [[0, top - hh * 0.04]] },
        ),
      )
      break
    case 'choppy':
      sheets.push(
        sheet(
          (u) => {
            const x = lerp(-edge * 0.97, edge * 0.97, u)
            const lean = (u - 0.5) * 0.35 + dir * 0.12
            const len = yB - top
            return spline([[x * 0.82, top], [x + lean * len * 0.35, lerp(top, yB, 0.5)], [x + lean * len, yB]], 8)
          },
          { n: 7, tips: pointy, tipLen: hh * 0.06, notch: hh * 0.075, rng, jag: 0.45 + k.messy * 0.3, root: [[0, top - hh * 0.04]] },
        ),
      )
      break
    case 'side': {
      const s = dir * sxr
      sheets.push(
        sheet(
          (u) => {
            const root: P = [lerp(-s * edge * 0.82, s * edge * 0.82, u), top + Math.sin(Math.PI * u) * -hh * 0.03]
            const tip: P = [lerp(-s * edge * 0.95, s * edge * 0.72, u) + s * hw * 0.1, lerp(top + hh * 0.07, yB + hh * 0.02, Math.pow(u, 1.2))]
            return waveG(spline([root, [lerp(root[0], tip[0], 0.4) + s * hw * 0.06, lerp(root[1], tip[1], 0.55)], tip], 8), wav, 1, u)
          },
          { n: 5, tips: pointy, tipLen: hh * 0.05, notch: hh * 0.06, rng, jag: 0.3 },
        ),
      )
      break
    }
    case 'curtain':
      for (const s of [-1, 1]) {
        sheets.push(
          sheet(
            (u) => {
              const root: P = [lerp(partX + s * hw * 0.03, s * edge * 0.82, u), top + u * hh * 0.02]
              const tip: P = [lerp(partX + s * hw * 0.2, s * hw * 0.9, u), lerp(lerp(top, yB, 0.66), yB + hh * 0.05, Math.pow(u, 0.6))]
              return waveG(spline([root, [lerp(root[0], tip[0], 0.35) + s * hw * 0.05 * (1 - u), lerp(root[1], tip[1], 0.6)], tip], 8), wav, 1, u)
            },
            { n: 3, tips: pointy, tipLen: hh * 0.05, notch: hh * 0.05, rng, jag: 0.25 },
          ),
        )
      }
      break
    case 'long-side': {
      const s = dir * sxr
      sheets.push(
        sheet(
          (u) => {
            const root: P = [lerp(-s * hw * 0.76, s * hw * 0.78, u), top]
            const tip: P = [lerp(-s * hw * 0.9, s * hw * 0.66, u), lerp(top + hh * 0.08, yB + hh * 0.14, Math.pow(u, 1.1))]
            return waveG(spline([root, [lerp(root[0], tip[0], 0.45) + s * hw * 0.1, lerp(root[1], tip[1], 0.55)], tip], 8), wav, 1, u)
          },
          { n: 5, tips: pointy, tipLen: hh * 0.07, notch: hh * 0.07, rng, jag: 0.3 },
        ),
      )
      break
    }
    case 'wispy': {
      // Thin, separated clumps: each one shaded on its own.
      const n = 6
      const ds: string[] = []
      let shd = ''
      let hi = ''
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const x = lerp(-edge * 0.95, edge * 0.95, t)
        const w = ((edge * 2) / n) * 0.75
        const len = yB - top
        const lean = (t - 0.5) * 0.35 + dir * 0.12
        const tip: P = [x + lean * len, top + len * rng.range(0.8, 1.05)]
        ds.push(smooth(clump([x - w * 0.62, top], [x + w * 0.62, top], tip, lean * 0.15, 'point', rng, k.messy)))
        const gd = spline([[x, top], lerpP([x, top], tip, 0.5), tip], 6)
        shd += strandOn(gd, gd, 0, 0.2, 0.95, w * 0.14, 1, w * 0.18 * (k.L[0] < 0 ? 1 : -1))
        hi += strandOn(gd, gd, 0, 0.12, 0.45, w * 0.08, 1, -w * 0.15 * (k.L[0] < 0 ? 1 : -1))
      }
      const post = k.det > 0 ? (k.flat ? '' : P.flat(shd, k.pal.dark, 0.4)) + (k.flat || k.shine < 0.03 ? '' : P.flat(hi, k.pal.sheen, sheenA(k) * 0.7)) : ''
      return { svg: drawMass(k, { ds, paint, offset: 0.07, outlineClip: clipId, post }), d: ds.join('') }
    }
  }
  if (!sheets.length) return null
  const svg = sheets
    .map((s, i) =>
      drawMass(k, {
        d: s.d,
        guides: s.guides,
        ends: s.ends,
        band: 0.45,
        bandLen: hh * 0.07,
        sheenK: 0.9,
        paint,
        offset: 0.07,
        shadeFrom: s.dx,
        rim: s.dx,
        outlineClip: clipId,
        after: i === 0 && r.bangs === 'choppy' ? flyaways(k, s.guides.map((gd) => gAt(gd, 0.1)), [0, G.cy], Math.round(k.messy * 3)) : '',
      }),
    )
    .join('')
  return { svg, d: sheets.map((s) => s.d).join('') }
}

/* ---- Extras (ponytails, buns, braids…) -------------------------------------------- */

function extrasFront(k: Kit, out: PartList, r: Recipe, rng: Rng, hatOn: boolean, layer: 'back' | 'front'): void {
  const { c, P, G, pal } = k
  const { hh, hw, cy } = G
  const sx = (c.hr as HumanRig).sx
  const h = c.sec('hair')
  const hideBack = c.hides('hairBack')
  const curlTips: Tips = r.curl > 0.4 ? 'curl' : 'point'
  const wave = r.curl > 0.2 ? hh * 0.02 * r.curl : 0
  for (const ex of r.extras) {
    switch (ex) {
      case 'ponytail': {
        if (layer !== 'back' || hideBack) break
        const len = hh * lerp(0.8, 1.7, h.n('length'))
        const b: P = [-sx * hw * 0.55, -hh * 0.15]
        const tip: P = [-sx * hw * 1.05, len * 0.7]
        const svg = tailMass(k, [b, [lerp(b[0], tip[0], 0.45) - sx * hw * 0.14, lerp(b[1], tip[1], 0.45)], tip], hh * 0.1, hh * 0.15, hh * 0.05, 3, curlTips, 'pony', wave)
        out.add('hairTail', Z.hairTailsBack, 'ponytail', onBone(c, 'hairTail', svg))
        break
      }
      case 'high-pony': {
        if (layer !== 'back' || hatOn || hideBack) break
        const len = hh * lerp(0.9, 1.8, h.n('length'))
        const root: P = [0, -hh * 0.95]
        const tip: P = [-sx * hw * 1.3, root[1] + len * 0.75]
        const svg = tailMass(k, [[sx * hw * 0.05, -hh * 0.78], [-sx * hw * 0.3, root[1] - hh * 0.16], [-sx * hw * 0.95, root[1] - hh * 0.08], [-sx * hw * 1.35, root[1] + len * 0.3], tip], hh * 0.12, hh * 0.18, hh * 0.05, 4, curlTips, 'hpony', wave)
        out.add('hairTail', Z.hairTailsBack, 'high-pony', onBone(c, 'hairTail', svg))
        out.add('head', Z.hairCap + 1, 'pony-tie', P.shape(ellipse(-sx * hw * 0.14, G.crownY - t0Of(r, hh) * 0.6, hh * 0.065, hh * 0.045), '#e53935', { offset: 0.25, outline: 0.8, gloss: k.baked }))
        break
      }
      case 'twintails': {
        if (layer !== 'back' || hideBack) break
        const len = hh * lerp(0.9, 2.1, h.n('length'))
        for (const s of [-1, 1]) {
          const root: P = [s * hw * 1.0, -hh * 0.72]
          const tip: P = [s * hw * 1.55, root[1] + len]
          const svg = tailMass(k, [[s * hw * 0.82, root[1] - hh * 0.02], [s * hw * 1.2, root[1] + len * 0.08], [s * hw * 1.58, root[1] + len * 0.3], [s * hw * 1.66, root[1] + len * 0.62], tip], hh * 0.07, hh * 0.15, hh * 0.04, 3, curlTips, `tt${s}`, wave)
          const bone = (s > 0) === (sx > 0) ? 'hairTailL' : 'hairTailR'
          out.add(bone, Z.hairTailsBack, `twintail${s}`, onBone(c, bone, svg))
          out.add('head', Z.hairCap + 1, `tie${s}`, P.shape(ellipse(root[0] + s * hw * 0.04, root[1], hh * 0.055, hh * 0.07), '#ec407a', { offset: 0.25, outline: 0.8, gloss: k.baked }))
        }
        break
      }
      case 'bun':
      case 'man-bun': {
        if (hatOn || layer !== (ex === 'bun' ? 'front' : 'back')) break
        const big = ex === 'bun' ? 1 : 0.75
        const cyB = ex === 'bun' ? G.crownY - hh * 0.12 * big : G.crownY - t0Of(r, hh) - hh * 0.02
        const rB = hh * 0.17 * big * lerp(0.8, 1.2, h.n('volume'))
        let svg = ''
        if (ex === 'bun' && k.det > 0 && !k.flat) svg += P.flat(ellipse(0, cyB + rB * 0.85, rB * 0.85, rB * 0.28), pal.deep, 0.35)
        svg += bunMass(k, 0, cyB, rB, r.curl > 0.5)
        out.add('head', ex === 'bun' ? Z.hairCap + 2 : Z.hairBack + 5, ex, svg)
        break
      }
      case 'space-buns':
      case 'puffs': {
        if (hatOn || layer !== 'front') break
        const puffy = ex === 'puffs'
        for (const s of [-1, 1]) {
          const bx = s * hw * (puffy ? 0.78 : 0.72)
          const by = G.crownY + hh * (puffy ? 0.02 : 0.06)
          const rr = hh * (puffy ? 0.26 : 0.15) * lerp(0.75, 1.3, h.n('volume'))
          const svg = puffy || r.curl > 0.5 ? coilMass(k, ringPts(bx, by - rr * 0.5, rr, 14, rng, 0.12), 0.16, [bx, by - rr * 0.5], rr, '', 7, 3) : bunMass(k, bx, by - rr * 0.5, rr, false)
          out.add('head', Z.hairCap - 0.5, `${ex}${s}`, svg)
        }
        break
      }
      case 'braid': {
        if (layer !== 'front') break
        const s = r.part === 'right' ? -sx : sx
        const len = hh * lerp(1.0, 2.2, h.n('length'))
        const from: P = [s * hw * 0.98, -hh * 0.42]
        const to: P = [s * hw * 1.1, -hh * 0.25 + len]
        out.add('head', Z.hairCap - 0.3, 'braid', braidMass(k, from, to, hh * 0.16, 9, '#e53935'))
        break
      }
      case 'twin-braids': {
        if (layer !== 'front') break
        const len = hh * lerp(0.9, 2.0, h.n('length'))
        for (const s of [-1, 1]) {
          const from: P = [s * hw * 1.0, -hh * 0.45]
          const to: P = [s * hw * 1.08, -hh * 0.3 + len]
          out.add('head', Z.hairCap - 0.3, `braid${s}`, braidMass(k, from, to, hh * 0.13, 8, '#ec407a'))
        }
        break
      }
      case 'crest': {
        if (hatOn || layer !== 'front') break
        const spikes: { root: P; tip: P; w: number }[] = []
        const n = 5
        const topY = G.crownY - hh * 0.005
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1)
          const x = lerp(-hw * 0.14, hw * 0.14, t)
          const len = hh * (0.3 + 0.12 * Math.sin(t * Math.PI)) * lerp(0.7, 1.4, h.n('volume'))
          spikes.push({ root: [x, topY + hh * 0.04], tip: [x * 3.2 + rng.range(-1, 1) * hh * 0.015, topY - len], w: hh * 0.075 })
        }
        out.add('head', Z.hairCap + 1, 'crest', spikeMass(k, spikes, k.hi || pal.base))
        break
      }
      case 'quiff':
      case 'pompadour': {
        if (hatOn || layer !== 'front') break
        const big = ex === 'pompadour' ? 1.35 : 1
        const qY = G.crownY * 0.7
        const X = (x: number) => x * hw * sx
        const cr = G.crownY
        const pts: SP[] = [[X(-0.78), qY + hh * 0.04], [X(-0.72), cr - hh * 0.05 * big], [X(-0.1), cr - hh * 0.2 * big], [X(0.45), cr - hh * 0.22 * big], [X(0.85), cr - hh * 0.08 * big], [X(0.8), qY - hh * 0.02], [X(0.3), qY - hh * 0.06], [X(-0.3), qY + hh * 0.01]]
        const d = smooth(pts)
        const bottom = spline([[X(-0.74), qY + hh * 0.03], [X(-0.3), qY + hh * 0.005], [X(0.3), qY - hh * 0.05], [X(0.78), qY - hh * 0.02]], 32)
        const topE = spline([[X(-0.7), cr - hh * 0.05 * big], [X(-0.1), cr - hh * 0.19 * big], [X(0.45), cr - hh * 0.21 * big], [X(0.83), cr - hh * 0.08 * big]], 32)
        const guides: Guide[] = []
        const n = 7
        for (let i = 0; i <= n; i++) {
          const u = i / n
          const b = gAt(bottom, u)
          const tp = gAt(topE, Math.min(1, u * 0.85 + 0.15))
          guides.push(spline([b, [lerp(b[0], tp[0], 0.5) - sx * hw * 0.08, lerp(b[1], tp[1], 0.6) - hh * 0.02], tp], 8))
        }
        // The bottom edge is the hairline: no ink there, a soft hairline and a cast shade instead.
        const clipId = c.defs.unique('qf')
        const off = P.lw * 1.4
        const bl = resample(bottom, 12).map(([x, y]) => [x, y - off] as P)
        c.defs.put(clipId, el('clipPath', { id: clipId }, el('path', { d: smooth([[-hw * 4, -hh * 3], [hw * 4, -hh * 3], [hw * 4, bl[bl.length - 1][1]], ...bl.slice().reverse(), [-hw * 4, bl[0][1]]], true, 0) })))
        const svg = drawMass(k, { d, guides, band: 0.62, bandLen: hh * 0.05, sheenK: 1.3, offset: 0.1, outlineClip: clipId })
        out.add('head', Z.hairFront, ex, svg)
        const hl = softHairline(k, bottom.slice().reverse(), 0)
        if (hl) out.add('head', Z.hairCap - 1.5, `${ex}-line`, hl)
        const shd = castShade(k, d, smooth(faceGeom(c).outline), hh * 0.03)
        if (shd) out.add('head', Z.facePaint + 1, `${ex}-shade`, shd)
        break
      }
      case 'afro': {
        if (layer !== 'back' || hideBack) break
        // Under a hat the afro still puffs out below the brim.
        const big = lerp(0.8, 1.35, h.n('volume')) * (hatOn ? 0.86 : 1)
        const acy = cy - hh * 0.02
        const R = hw * 1.45 * big
        const ring = ringPts(0, acy, R, 30, rng, 0.05).map(([x, y]) => [x, y * 0.92 + (hatOn ? hh * 0.12 : -hh * 0.05)] as P)
        const fo = faceGeom(c).outline
        const ringD = (s: number) => smooth(fo.map(([x, y]) => [x * s, -hh * 0.42 + (y + hh * 0.42) * s] as P))
        const pre = k.det > 0 && !k.flat ? P.flat(ringD(1.2), pal.deep, 0.18) + P.flat(ringD(1.07), pal.deep, 0.25) : ''
        out.add('hairBack', Z.hairBack + 1, 'afro', onBone(c, 'hairBack', coilMass(k, ring, 0.13, [0, acy], R, pre, 12, 7)))
        break
      }
      case 'locs':
      case 'box-braids': {
        if (layer !== 'front') break
        const thin = ex === 'box-braids'
        const len = G.backY(r.back) + hh * 0.1
        // In front of the face only at its edges (framing it); the rest hang behind.
        const front: P[][] = []
        const behind: P[][] = []
        const n = thin ? 18 : 12
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1)
          const s = t < 0.5 ? -1 : 1
          const edge = Math.abs(t - 0.5) * 2
          const x0 = lerp(-hw * 1.0, hw * 1.0, t)
          const y0 = lerp(-hh * 0.8, -hh * 0.6, edge)
          const tipY = len * lerp(0.78, 1.0, rng.next())
          const x1 = x0 * 1.05 + s * hw * (0.1 + 0.28 * edge) + rng.range(-3, 3)
          ;(edge > 0.7 ? front : behind).push([[x0, y0], [x0 + s * hw * 0.1 * edge, lerp(y0, tipY, 0.3)], [lerp(x0, x1, 0.75), lerp(y0, tipY, 0.68)], [x1, tipY]])
        }
        const r0 = hh * (thin ? 0.026 : 0.04)
        out.add('head', Z.hairCap - 0.3, ex, ropeMass(k, front, r0, thin ? 'box' : 'locs'))
        if (!hideBack) out.add('hairBack', Z.hairBack + 2, `${ex}-back`, onBone(c, 'hairBack', ropeMass(k, behind, r0, thin ? 'box' : 'locs', pal.back)))
        break
      }
      case 'twists': {
        if (hatOn) break
        const lenK = lerp(0.7, 1.5, h.n('length'))
        if (layer === 'back') {
          if (hideBack) break
          const roots: { p: P; o: P; len: number }[] = []
          for (const s of [-1, 1]) {
            for (let i = 0; i < 5; i++) {
              const a = s < 0 ? Math.PI * (1.0 + i * 0.06) : Math.PI * (2.0 - i * 0.06)
              roots.push({ p: G.env(a, hh * 0.02), o: [Math.cos(a), Math.sin(a)], len: hh * rng.range(0.38, 0.48) * lenK })
            }
          }
          out.add('hairBack', Z.hairBack + 3, 'twists-back', onBone(c, 'hairBack', ropeMass(k, hangingSpines(roots), hh * 0.045, 'twist', pal.back, 0.7)))
        } else {
          // Long twists frame the face at the sides; short ones crown the top, over them.
          const sides: { p: P; o: P; len: number }[] = []
          const top: { p: P; o: P; len: number }[] = []
          const n = 14
          for (let i = 0; i < n; i++) {
            const t = i / (n - 1)
            const a = Math.PI * (1.05 + t * 0.9)
            const edge = Math.abs(t - 0.5) * 2
            ;(edge > 0.55 ? sides : top).push({ p: G.env(a, -hh * 0.03), o: [Math.cos(a), Math.sin(a)], len: hh * rng.range(0.26, 0.34) * lenK * (edge > 0.55 ? 1 : 0.42) })
          }
          out.add('head', Z.hairCap + 0.5, 'twists', ropeMass(k, hangingSpines(sides), hh * 0.045, 'twist', undefined, 0.7) + ropeMass(k, hangingSpines(top), hh * 0.045, 'twist', undefined, 0.7))
        }
        break
      }
      case 'ringlets': {
        if (layer !== 'front') break
        const len = hh * lerp(0.75, 1.2, h.n('length'))
        for (const s of [-1, 1]) out.add('head', Z.hairFront - 2, `ringlet${s}`, ringletMass(k, [s * hw * 1.07, -hh * 0.38], len, hh * 0.17, 6))
        break
      }
    }
  }
}

/* ---- Side view -------------------------------------------------------------------- */

function hairSideView(k: Kit, out: PartList, r: Recipe, hatOn: boolean, hairline: number): void {
  const { c, P, G, pal } = k
  const rng = c.rng('hair-side')
  const { hh, hw, cy } = G
  const m = G.m
  const t0 = hh * 0.035 + r.vol * hh * 0.35
  const curly = r.curl > 0.42
  const coily = r.curl > 0.72
  const wavy = r.curl > 0.25 && !coily
  const hideBack = c.hides('hairBack')
  const headSP = profileOutline(m, c)
  const headD = smooth(headSP)
  const h = c.sec('hair')
  const afro = r.extras.includes('afro')
  if (r.cap === 'stubble' || r.sides === 'shaved') {
    const pts: P[] = [[hw * 0.72, -hh * 0.72], [hw * 0.55, -hh * 0.92], [0, -hh * 1.0], [-hw * 0.6, -hh * 0.9], [-hw * 1.02, -hh * 0.5], [-hw * 0.62, -hh * 0.2], [-hw * 0.1, -hh * 0.3], [hw * 0.2, -hh * 0.55], [hw * 0.5, -hh * 0.66]]
    out.add('head', Z.hairCap - 1, 'hair-stubble', stubbleCap(k, pts, smooth(offsetPts(headSP, -P.lw * 0.5)), [hw * 0.2, -hh * 0.95]))
  }
  if (r.cap === 'full') {
    const hlF = lerp(0.72, 0.62, clamp(hairline, 0, 1))
    const lift = hatOn ? t0 * 0.3 : t0
    // Profile cap: forehead hairline, over the crown, down the back to the nape.
    // It follows the skull's profile, lifted by the hair's volume, so it always covers it.
    const pc: P = [-hw * 0.08, -hh * 0.52]
    const lifted = (x: number, y: number, kk: number): P => {
      const o = norm([x - pc[0], y - pc[1]])
      return [x + o[0] * (lift * kk + hh * 0.012), y + o[1] * (lift * kk + hh * 0.012)]
    }
    const outer: P[] = [
      [hw * 0.86, -hh * hlF],
      lifted(hw * 0.84, -hh * 0.78, 0.35),
      lifted(hw * 0.5, -hh * 0.92, 0.8),
      lifted(0, -hh * 0.96, 1),
      lifted(-hw * 0.52, -hh * 0.9, 1),
      lifted(-hw * 0.86, -hh * 0.72, 0.9),
      lifted(-hw * 0.99, -hh * 0.46, 0.7),
      [-hw * 0.74 - lift * 0.3, -hh * 0.18],
    ]
    const inner: P[] = [
      [-hw * 0.45, -hh * 0.2],
      [-hw * 0.3, -hh * 0.36],
      [hw * 0.05, -hh * 0.42],
      [hw * 0.18, -hh * 0.3],
      [hw * 0.34, -hh * 0.36],
      [hw * 0.4, -hh * 0.56],
      [hw * 0.72, -hh * (hlF - 0.02)],
    ]
    const capPts = [...outer, ...inner]
    const rows = r.texture === 'rows'
    const ropes = r.extras.includes('locs') || r.extras.includes('box-braids')
    const coilCap = coily && !r.slick && !rows && !ropes
    const lu = curly && !rows ? lumpy(outer, false, clamp(Math.round(gLen(outer) / (hh * (coilCap ? 0.27 : 0.34)) + k.messy * 1.5), 4, 9), capBulge(r, coilCap, hatOn), pc, k.crng) : null
    const d = lu ? lu.d + smoothTail(inner) : smooth(capPts)
    const helmet = smooth([...(lu ? lu.pts : outer), [-hw * 0.72, hh * 0.4], [hw * 1.3, hh * 0.4], [hw * 1.3, -hh * hlF]])
    // Flow: from the crown whorl forward to the hairline and down to the ear and the nape
    // (cornrows run front to back).
    const root: P = rows ? [hw * 0.66, -hh * 0.94 - lift * 0.8] : [-hw * 0.3, -hh * 0.97 - lift * 1.1]
    const capWaves = curly && (!coily || (r.slick && !ropes && !rows)) ? 2 : 0
    let guides = fanGuides(() => root, [outer[0], ...inner.slice().reverse(), outer[outer.length - 1]], 11, [-hw * 0.1, cy], 0.3, rng, capWaves ? 16 : 8).map((gd, i) =>
      capWaves ? waveG(gd, hh * 0.016 * r.curl, capWaves, i * 0.08) : gd,
    )
    if (rows) {
      // Cornrows run front to back, stacked from the ear up to the crown.
      const front = spline([outer[0], outer[1], outer[2], outer[3]], 24)
      const backE = spline([outer[outer.length - 1], outer[outer.length - 2], outer[outer.length - 3], outer[4]], 24)
      guides = []
      for (let i = 0; i <= 8; i++) {
        const u = i / 8
        const a = gAt(front, u * 0.95)
        const b = gAt(backE, u * 0.95)
        const mid: P = [lerp(a[0], b[0], 0.5), lerp(a[1], b[1], 0.5) - hh * 0.1 * (1 - u) - lift * 0.5]
        guides.push(spline([a, mid, b], 10))
      }
    }
    let post = ''
    if (coilCap && k.det > 0)
      post += curlTexture(k, {
        lumps: afro ? [] : lu?.lumps,
        box: pathBounds(d),
        inside: (p) => inPoly(p, capPts),
        strokes: 4 + Math.round(k.messy * 2),
        sheen: hatOn ? undefined : { centre: pc, rx: hw * 0.92 + lift * 0.4, ry: hh * 0.4 + lift * 0.4 },
      })
    if (r.texture === 'rows') post += cornrowDeco(k, guides)
    if (ropes) post += ropeDeco(k, guides, r.extras.includes('box-braids') ? 'box' : 'locs')
    const top = outer.slice(1, 5).map((p) => p)
    const svg = drawMass(k, {
      d,
      guides: coilCap || (coily && ropes) ? undefined : guides,
      ends: guides.map(() => 0.9),
      band: hatOn || coilCap || (coily && ropes) ? null : 0.42,
      bandLen: hh * 0.12,
      waves: capWaves,
      offset: 0.1,
      shadeFrom: helmet,
      rim: afro ? false : helmet,
      outline: afro ? 0 : 1,
      shade: afro ? 0.3 : undefined,
      sepK: r.texture === 'rows' ? 1.5 : r.slick ? 0.6 : 1,
      post,
      after: flyaways(k, resample(top, 12), [-hw * 0.1, cy], hatOn || curly || r.slick ? 0 : Math.round(1 + k.messy * 7)),
    })
    out.add('head', Z.hairCap, 'hair-cap', svg)

    // Back mass hanging behind.
    if ((r.back > 0.25 || r.side > 0.8) && !hideBack && !afro) {
      const yB = G.backY(Math.max(r.back, r.side * 0.8))
      const w = hw * lerp(0.55, 0.9, clamp(r.flare - 0.8, 0, 1))
      const span = yB + hh * 0.6
      const amp = wavy || coily ? hh * lerp(0.015, 0.045, clamp(r.curl * 1.3, 0, 1)) : 0
      const waves = amp ? lerp(1, 3, r.curl) * clamp(span / hh, 0.5, 2) : 0
      const ns = amp ? 18 : 8
      const outerE = spline([[-hw * 0.2, -hh * 0.9], [-hw * 1.05 - t0 * 0.5, -hh * 0.6], [-hw * 0.95 - w * 0.2, lerp(-hh * 0.3, yB, 0.5)], [-hw * 0.9 - w * 0.4, yB]], ns)
      const innerE = spline([[-hw * 0.05, -hh * 0.6], [-hw * 0.1, -hh * 0.2], [lerp(-hw * 0.1, -hw * 0.2 + w * 0.2, 0.5), lerp(-hh * 0.2, yB, 0.5)], [-hw * 0.2 + w * 0.2, yB]], ns)
      const sh = sheet((u) => waveG(gMix(innerE, outerE, u), amp, waves, u * 0.6), {
        n: span > hh * 1.2 ? 5 : 4,
        tips: curly ? 'curl' : r.tips,
        tipLen: hh * (r.tips === 'blunt' && !curly ? 0.01 : 0.08),
        notch: hh * (r.tips === 'blunt' && !curly ? 0.015 : 0.07),
        rng,
        jag: 0.25 + k.messy * 0.4,
      })
      const avg = sh.guides.reduce((s, gd) => s + gLen(gd), 0) / sh.guides.length || 1
      const svg2 = drawMass(k, {
        d: sh.d,
        guides: sh.guides,
        ends: sh.ends,
        band: clamp((hh * 0.4) / avg, 0.1, 0.5),
        sheenK: 0.7,
        waves,
        color: pal.back,
        paint: tipPaint(k, 'sback', -hh, yB, pal.back),
        pre: rootTip(k, 'sback', sh.d, -hh, yB),
        offset: 0.06,
      })
      out.add('hairBack', Z.hairBack, 'hair-back', onBone(c, 'hairBack', svg2))
    }
    // Side lock over the ear.
    if (r.side > 0.62 && !afro) {
      const yS = G.sideY(r.side)
      const amp = wavy || coily ? hh * 0.02 * r.curl : 0
      const gA = spline([[-hw * 0.3, -hh * 0.74], [-hw * 0.3, lerp(-hh * 0.6, yS, 0.5)], [-hw * 0.2, yS]], amp ? 14 : 8)
      const gB = spline([[hw * 0.28, -hh * 0.72], [hw * 0.26, lerp(-hh * 0.58, yS, 0.5)], [hw * 0.14, yS]], amp ? 14 : 8)
      const tk: Tips = curly ? 'curl' : r.tips
      const sh = sheet((u) => waveG(gMix(gA, gB, u), amp, 1.6, u * 0.3), { n: 3, tips: tk, tipLen: hh * (tk === 'blunt' ? 0.008 : 0.06), notch: hh * 0.05, rng, jag: 0.2 })
      out.add('head', Z.hairCap - 0.3, 'hair-lock', drawMass(k, { d: sh.d, guides: sh.guides, ends: sh.ends, band: 0.3, bandLen: hh * 0.07, waves: amp ? 1.6 : 0, shadeFrom: sh.dx, rim: sh.dx, paint: tipPaint(k, 'slock', -hh * 0.6, yS, pal.base) }))
    }
    // Fringe seen from the side.
    if (r.bangs !== 'none') {
      const len = lerp(0.1, 0.32, clamp(r.bangLen, 0, 1.3))
      const sh = sheet(
        (u) =>
          spline(
            [
              [lerp(hw * 0.46, hw * 0.84, u), -hh * (hlF + 0.1 - 0.05 * u)],
              [lerp(hw * 0.74, hw * 0.98, u), -hh * (hlF - len * 0.3)],
              [lerp(hw * 0.82, hw * 0.96, u), -hh * (hlF - len * lerp(0.7, 1, u))],
            ],
            8,
          ),
        { n: 3, tips: r.tips === 'blunt' ? 'blunt' : 'point', tipLen: hh * 0.03, notch: hh * 0.035, rng, jag: 0.3 },
      )
      out.add('head', Z.hairCap - 0.5, 'hair-bangs', drawMass(k, { d: sh.d, guides: sh.guides, ends: sh.ends, band: 0.45, bandLen: hh * 0.05, offset: 0.08, shadeFrom: sh.dx, rim: sh.dx }))
      const shd = castShade(k, sh.d, headD, hh * 0.035)
      if (shd) out.add('head', Z.facePaint + 1, 'hair-shade', shd)
    }
  }
  // Extras in profile (the character faces +x; tails hang behind at -x).
  for (const ex of r.extras) {
    if (ex === 'ponytail' || ex === 'high-pony') {
      if (hideBack) continue
      const high = ex === 'high-pony'
      const len = hh * lerp(0.9, 1.9, h.n('length'))
      const root: P = high ? [-hw * 0.55, -hh * 0.92] : [-hw * 0.95, -hh * 0.42]
      const tip: P = [root[0] - hw * 0.8, root[1] + len * 0.8]
      const svg = tailMass(k, [root, [root[0] - hw * 0.45, lerp(root[1], tip[1], 0.35)], tip], hh * 0.1, hh * 0.15, hh * 0.05, 3, r.curl > 0.4 ? 'curl' : 'point', 'sp', r.curl > 0.2 ? hh * 0.02 * r.curl : 0)
      out.add('hairTail', Z.hairTailsBack, ex, onBone(c, 'hairTail', svg))
      if (high && !hatOn) out.add('head', Z.hairCap + 1, 'pony-tie', P.shape(ellipse(root[0], root[1], hh * 0.05, hh * 0.06), '#e53935', { offset: 0.25, outline: 0.8 }))
    } else if ((ex === 'bun' || ex === 'man-bun') && !hatOn) {
      const cyB = ex === 'bun' ? -hh * 1.0 : -hh * 0.78
      const cxB = ex === 'bun' ? -hw * 0.25 : -hw * 0.9
      out.add('head', Z.hairCap + 2, ex, bunMass(k, cxB, cyB, hh * 0.16, r.curl > 0.5))
    } else if (ex === 'afro') {
      if (hideBack) continue
      const R = hw * 1.45 * lerp(0.8, 1.35, h.n('volume')) * (hatOn ? 0.7 : 1)
      const acy = -hh * 0.58
      const ring = ringPts(-hw * 0.2, acy, R, 20, rng, 0.07).map(([x, y]) => [x, acy + (y - acy) * 0.92] as P)
      out.add('hairBack', Z.hairBack + 1, 'afro', onBone(c, 'hairBack', coilMass(k, ring, 0.14, [-hw * 0.2, acy], R, '', 11, 6)))
    } else if (ex === 'twintails') {
      if (hideBack) continue
      const len = hh * lerp(0.9, 2.0, h.n('length'))
      const root: P = [-hw * 0.4, -hh * 0.72]
      const svg = tailMass(k, [root, [root[0] - hw * 0.35, root[1] + len * 0.35], [root[0] - hw * 0.6, root[1] + len]], hh * 0.07, hh * 0.13, hh * 0.04, 3, 'point', 'stt')
      out.add('hairTailL', Z.hairTailsBack, 'twintail', onBone(c, 'hairTailL', svg))
    } else if (ex === 'braid' || ex === 'twin-braids') {
      const len = hh * lerp(1.0, 2.0, h.n('length'))
      const from: P = [-hw * 0.7, -hh * 0.4]
      out.add('head', Z.hairBack + 2, ex, braidMass(k, from, [from[0] - hw * 0.2, from[1] + len], hh * 0.14, 7, ex === 'braid' ? '#e53935' : '#ec407a'))
    } else if ((ex === 'space-buns' || ex === 'puffs') && !hatOn) {
      const rr = hh * (ex === 'puffs' ? 0.24 : 0.15)
      out.add('head', Z.hairCap + 1, ex, ex === 'puffs' ? coilMass(k, ringPts(-hw * 0.1, -hh * 1.0, rr, 12, rng, 0.1), 0.16, [-hw * 0.1, -hh * 1.0], rr, '', 7, 3) : bunMass(k, -hw * 0.1, -hh * 1.0, rr, false))
    } else if (ex === 'crest' && !hatOn) {
      const spikes: { root: P; tip: P; w: number }[] = []
      for (let i = 0; i < 5; i++) {
        const x = lerp(hw * 0.6, -hw * 0.8, i / 4)
        const y = -hh * (0.9 - Math.abs(i - 2) * 0.03)
        spikes.push({ root: [x, y + 4], tip: [x - hh * 0.05, y - hh * 0.22 * lerp(0.7, 1.4, h.n('volume'))], w: hh * 0.06 })
      }
      out.add('head', Z.hairCap + 1, 'crest', spikeMass(k, spikes, k.hi || pal.base))
    } else if ((ex === 'quiff' || ex === 'pompadour') && !hatOn) {
      const big = ex === 'pompadour' ? 1.3 : 1
      const d = smooth([[hw * 0.1, -hh * 0.88], [hw * 0.6, -hh * (0.98 + 0.12 * big)], [hw * 1.05, -hh * (0.9 + 0.06 * big)], [hw * 0.95, -hh * 0.72], [hw * 0.5, -hh * 0.8]])
      const guides: Guide[] = []
      for (let i = 0; i <= 4; i++) {
        const u = i / 4
        guides.push(spline([[lerp(hw * 0.92, hw * 0.2, u), lerp(-hh * 0.74, -hh * 0.86, u)], [lerp(hw * 1.02, hw * 0.55, u), -hh * lerp(0.9, 0.98 + 0.08 * big, u)], [lerp(hw * 0.6, hw * 0.1, u), -hh * lerp(0.98 + 0.1 * big, 0.9, u)]], 8))
      }
      out.add('head', Z.hairFront, ex, drawMass(k, { d, guides, band: 0.45, bandLen: hh * 0.06, sheenK: 1.2 }))
    } else if (ex === 'locs' || ex === 'box-braids') {
      if (hideBack) continue
      const len = G.backY(r.back)
      const strands: P[][] = []
      const n = ex === 'box-braids' ? 9 : 6
      for (let i = 0; i < n; i++) {
        const x0 = lerp(-hw * 0.95, hw * 0.1, i / (n - 1))
        strands.push([[x0, -hh * 0.5], [x0 - hw * 0.1, len * 0.5], [x0 - hw * 0.15, len * rng.range(0.8, 1)]])
      }
      out.add('hairBack', Z.hairBack + 1, ex, onBone(c, 'hairBack', ropeMass(k, strands, hh * (ex === 'box-braids' ? 0.028 : 0.036), ex === 'box-braids' ? 'box' : 'locs', pal.back)))
    } else if (ex === 'twists' && !hatOn) {
      const roots: { p: P; o: P; len: number }[] = []
      const lenK = lerp(0.7, 1.5, h.n('length'))
      for (let i = 0; i < 11; i++) {
        const t = i / 10
        const a = Math.PI * (1.05 + t * 0.85)
        const p0 = G.env(a, -hh * 0.03)
        roots.push({ p: [p0[0] - hw * 0.1, p0[1]], o: [Math.cos(a) - 0.3, Math.sin(a)], len: hh * rng.range(0.3, 0.42) * lenK * (t > 0.7 ? 0.45 : 1) })
      }
      out.add('head', Z.hairCap + 0.5, 'twists', ropeMass(k, hangingSpines(roots), hh * 0.045, 'twist', undefined, 0.7))
    } else if (ex === 'ringlets') {
      out.add('head', Z.hairFront - 2, 'ringlet', ringletMass(k, [hw * 0.02, -hh * 0.4], hh * lerp(0.75, 1.2, h.n('length')), hh * 0.16, 6))
    }
  }
}

/* ---- Back view -------------------------------------------------------------------- */

function hairBackView(k: Kit, out: PartList, r: Recipe, hatOn: boolean): void {
  const { c, P, G, pal } = k
  const rng = c.rng('hair-back')
  const { hh, hw, cy } = G
  const t0 = hh * 0.035 + r.vol * hh * 0.35
  const curly = r.curl > 0.42
  const coily = r.curl > 0.72
  const wavy = r.curl > 0.25 && !coily
  const h = c.sec('hair')
  const headD = smooth(offsetPts(faceGeom(c).outline, -P.lw * 0.5))
  if (r.cap === 'stubble' || r.sides === 'shaved') {
    const pts: P[] = []
    for (let i = 0; i <= 16; i++) pts.push(G.env(Math.PI + (i / 16) * Math.PI, hh * 0.01))
    out.add('head', Z.hairCap - 1, 'hair-stubble', stubbleCap(k, [[-hw * 0.9, -hh * 0.15], ...pts, [hw * 0.9, -hh * 0.15], [0, -hh * 0.1]], headD, [0, G.crownY + hh * 0.1]))
  }
  if (r.cap === 'full') {
    const messy = k.messy
    const lobeAmp = curly || hatOn ? 0 : (r.slick ? 0.2 : 1) * t0 * (0.16 + messy * 0.35)
    const top: P[] = []
    const N = 24
    for (let i = 0; i <= N; i++) {
      const a = Math.PI + (i / N) * Math.PI
      const bump = lobeAmp * (Math.pow(Math.abs(Math.sin(Math.PI * ((i / N) * 6 + 0.5))), 0.7) - 0.55) * Math.min(1, Math.sin((i / N) * Math.PI) * 3)
      top.push(G.env(a, (hatOn ? t0 * 0.3 : t0 * (0.45 + 0.55 * Math.max(0, -Math.sin(a)))) * (1 + noise1(c.dna.seed + 7, i) * messy * 0.08) + bump))
    }
    const back = Math.max(r.back, 0.25)
    const yB = G.backY(back)
    const botHalf = back < 0.5 ? hw * 1.0 : Math.max(hw * 1.05, lerp(hw * 1.15, G.m.shoulderHalf * 0.98, clamp(back - 0.6, 0, 1))) * r.flare
    const sideX = hw * 0.98 + t0 * 0.55
    const W: P = [0, G.crownY + hh * 0.16]
    const span = yB - G.crownY
    const amp = (wavy || coily) && span > hh * 0.8 ? hh * lerp(0.015, 0.05, clamp(r.curl * 1.3, 0, 1)) : 0
    const waves = amp ? lerp(1.1, 3.2, r.curl) * clamp(span / hh, 0.5, 2.4) : 0
    const ns = amp ? 18 : 8
    const rows = r.texture === 'rows'
    const ropes = r.extras.includes('locs') || r.extras.includes('box-braids')
    const coilCap = coily && !r.slick && !rows && !ropes
    // Short coils read as curl clumps; long curly hair as S-wave clumps under a curly crown.
    const clumps = coilCap && !amp
    const lu = curly && !rows ? lumpy(top, false, clamp(Math.round(gLen(top) / (hh * (coilCap ? 0.25 : 0.32)) + messy * 1.5), 4, 10), capBulge(r, coilCap, hatOn), [0, cy], k.crng) : null
    const sh = sheet(
      (u) => {
        const x = u * 2 - 1
        const gd =
          u <= 0 || u >= 1
            ? spline([G.env(u >= 1 ? Math.PI * 2 : Math.PI, t0 * 0.45), [x * sideX * 1.01, cy + hh * 0.1], [x * lerp(sideX, botHalf, 0.6), lerp(cy, yB, 0.55)], [x * botHalf, yB]], ns)
            : spline([W, [x * sideX * 0.85, lerp(G.crownY, cy, 0.45)], [x * lerp(sideX, botHalf, 0.55), lerp(cy, yB, 0.5)], [x * botHalf, yB]], ns)
        return waveG(gd, amp, waves, u * 0.7)
      },
      {
        n: r.extras.includes('box-braids') ? 18 : r.extras.includes('locs') ? 13 : span > hh * 1.2 ? 10 : 8,
        vee: span > hh * 1.2 && r.tips !== 'blunt' ? hh * 0.06 : 0,
        tips: curly ? 'curl' : r.tips,
        tipLen: hh * (r.tips === 'blunt' && !curly ? 0.01 : curly ? 0.045 : 0.075),
        notch: hh * (r.tips === 'blunt' && !curly ? 0.016 : 0.07),
        rng,
        jag: 0.25 + messy * 0.4,
        root: (lu ? lu.pts : top).slice(1, -1).reverse(),
      },
    )
    const avg = sh.guides.reduce((s, gd) => s + gLen(gd), 0) / sh.guides.length || 1
    let post = ''
    if (coilCap && k.det > 0) {
      const yTop = cy + hh * 0.05
      post += curlTexture(k, {
        lumps: lu?.lumps,
        box: pathBounds(sh.d),
        inside: (p) => inPoly(p, sh.pts) && (clumps || p[1] < yTop),
        strokes: clumps ? 5 + Math.round(messy * 2) : 2,
        sheen: clumps && !hatOn ? { centre: [0, cy], rx: G.rx + t0 * 0.35, ry: G.ry + t0 * 0.35 } : undefined,
      })
    }
    if (r.texture === 'rows') post += cornrowDeco(k, sh.guides)
    if (ropes) post += ropeDeco(k, sh.guides, r.extras.includes('box-braids') ? 'box' : 'locs')
    // The crown whorl: a few short spiralling separations.
    if (k.baked && k.det > 1 && !curly) {
      let wd = ''
      const ph = rng.range(0, Math.PI * 2)
      for (let j = 0; j < 5; j++) {
        const a = ph + (j / 5) * Math.PI * 2
        const at = (aa: number, rr: number): P => [W[0] + Math.cos(aa) * rr, W[1] + Math.sin(aa) * rr * 0.8]
        wd += lens(at(a, hh * 0.015), at(a + 0.7, hh * 0.06), at(a + 1.3, hh * 0.11), P.lw * 0.35)
      }
      post += P.flat(wd, pal.dark, 0.5)
    }
    const svg = drawMass(k, {
      d: sh.d,
      guides: clumps || (coily && ropes && !r.extras.includes('locs')) ? undefined : sh.guides,
      ends: sh.ends,
      band: hatOn || clumps || (coily && ropes) ? null : clamp((hh * 0.3) / avg, 0.08, 0.45),
      bandLen: hh * 0.09,
      waves,
      sepK: r.texture === 'rows' ? 1.5 : r.slick ? 0.6 : 1,
      paint: tipPaint(k, 'bb', G.crownY, yB, pal.base),
      pre: rootTip(k, 'bb', sh.d, G.crownY, yB),
      post,
      offset: 0.08,
      after: flyaways(k, top.slice(3, -3), [0, cy], hatOn || curly || r.slick ? 0 : Math.round(1 + messy * 8)),
    })
    out.add('head', Z.hairCap, 'hair-back', svg)
  }
  const wave = r.curl > 0.2 ? hh * 0.02 * r.curl : 0
  for (const ex of r.extras) {
    if (ex === 'ponytail' || ex === 'high-pony') {
      const high = ex === 'high-pony'
      const len = hh * lerp(0.9, 1.9, h.n('length'))
      const root: P = [0, high ? -hh * 0.85 : -hh * 0.3]
      const tip: P = [rng.range(-4, 4), root[1] + len]
      out.add('head', Z.hairCap + 2, ex, tailMass(k, [root, [hw * 0.05, lerp(root[1], tip[1], 0.4)], tip], hh * 0.09, hh * 0.15, hh * 0.045, 4, r.curl > 0.4 ? 'curl' : 'point', 'bp', wave) + P.shape(ellipse(root[0], root[1], hh * 0.07, hh * 0.04), '#e53935', { offset: 0.25, outline: 0.8 }))
    } else if ((ex === 'bun' || ex === 'man-bun') && !hatOn) {
      out.add('head', Z.hairCap + 2, ex, bunMass(k, 0, ex === 'bun' ? G.crownY - hh * 0.05 : -hh * 0.72, hh * 0.16, r.curl > 0.5))
    } else if (ex === 'twintails' || ex === 'twin-braids' || ex === 'braid') {
      const len = hh * lerp(0.9, 2.0, h.n('length'))
      for (const s of ex === 'braid' ? [1] : [-1, 1]) {
        const from: P = [s * hw * 0.8, -hh * (ex === 'twintails' ? 0.7 : 0.3)]
        const to: P = [s * hw * 1.2, from[1] + len]
        out.add(
          'head',
          Z.hairCap + 2,
          `${ex}${s}`,
          ex === 'twintails'
            ? tailMass(k, [from, [lerp(from[0], to[0], 0.5) + s * hw * 0.1, lerp(from[1], to[1], 0.45)], to], hh * 0.08, hh * 0.14, hh * 0.04, 3, 'point', `btt${s}`, wave)
            : braidMass(k, from, to, hh * 0.13, 7, ex === 'braid' ? '#e53935' : '#ec407a'),
        )
      }
    } else if (ex === 'afro') {
      const R = hw * 1.45 * lerp(0.8, 1.35, h.n('volume')) * (hatOn ? 0.7 : 1)
      const acy = cy - hh * 0.05
      out.add('head', Z.hairCap + 1, 'afro', coilMass(k, ringPts(0, acy, R, 20, rng, 0.07), 0.14, [0, acy], R, '', 12, 7))
    } else if ((ex === 'space-buns' || ex === 'puffs') && !hatOn) {
      for (const s of [-1, 1]) {
        const rr = hh * (ex === 'puffs' ? 0.25 : 0.15)
        const cx = s * hw * (ex === 'puffs' ? 0.78 : 0.72)
        const cyB = G.crownY - hh * (ex === 'puffs' ? 0.1 : 0.02)
        out.add('head', Z.hairCap + 1, `${ex}${s}`, ex === 'puffs' ? coilMass(k, ringPts(cx, cyB, rr, 12, rng, 0.1), 0.16, [cx, cyB], rr, '', 7, 3) : bunMass(k, cx, cyB, rr, false))
      }
    } else if (ex === 'crest' && !hatOn) {
      const spikes: { root: P; tip: P; w: number }[] = []
      for (let i = 0; i < 5; i++) {
        const y = lerp(G.crownY + hh * 0.02, -hh * 0.35, i / 4)
        spikes.push({ root: [0, y], tip: [0, y - hh * 0.2 * lerp(0.7, 1.4, h.n('volume'))], w: hh * 0.07 })
      }
      out.add('head', Z.hairCap + 1, 'crest', spikeMass(k, spikes, k.hi || pal.base))
    } else if (ex === 'twists' && !hatOn) {
      // Rows from the nape up: each row hangs over the one below it.
      const lenK = lerp(0.7, 1.5, h.n('length'))
      let svg = ''
      for (const [y, n, l, spanX] of [
        [cy + hh * 0.12, 8, 0.36, 0.85],
        [G.crownY + hh * 0.24, 8, 0.4, 0.8],
      ] as [number, number, number, number][]) {
        const roots: { p: P; o: P; len: number }[] = []
        for (let i = 0; i < n; i++) {
          const x = lerp(-hw * spanX, hw * spanX, i / (n - 1)) + rng.range(-1, 1) * hw * 0.04
          roots.push({ p: [x, y], o: [x / hw, 0], len: hh * rng.range(l - 0.04, l + 0.04) * lenK })
        }
        svg += ropeMass(k, hangingSpines(roots), hh * 0.045, 'twist', undefined, 0.7)
      }
      const top: { p: P; o: P; len: number }[] = []
      for (let i = 0; i < 12; i++) {
        const a = Math.PI * (1.02 + (i / 11) * 0.96)
        top.push({ p: G.env(a, -hh * 0.02), o: [Math.cos(a), Math.sin(a)], len: hh * rng.range(0.3, 0.4) * lenK })
      }
      svg += ropeMass(k, hangingSpines(top), hh * 0.045, 'twist', undefined, 0.7)
      out.add('head', Z.hairCap + 1, 'twists', svg)
    } else if (ex === 'ringlets') {
      for (const s of [-1, 1]) out.add('head', Z.hairCap + 1, `ringlet${s}`, ringletMass(k, [s * hw * 1.02, -hh * 0.38], hh * lerp(0.75, 1.2, h.n('length')), hh * 0.16, 6))
    }
  }
}

/* ---- Facial hair ------------------------------------------------------------------------ */

interface FH {
  k: Kit
  hh: number
  hw: number
  m: HumanMeasure
  len: number
  dens: number
  side: boolean
  faceD: string
  /** Clip for outlines: everywhere except over the face (beards are outlined only where
   *  they leave the face; against skin their edge stays soft). */
  outClip: string
  /** Clip for the soft inner edge line (over the face only). */
  inClip: string
}

interface Beard {
  shapes: SP[][]
  /** Edges that meet skin (they get wisps instead of a hard line). */
  edges: P[][]
  guides?: Guide[]
  ends?: number[]
  /** Rim-light source for the hanging part (its root edge is tucked under the rest). */
  dx?: string
}

function facialHairGen(c: Ctx, out: PartList): void {
  if (c.view === 'back') return
  const fh = c.sec('facialHair')
  const beard = fh.s('beard') || 'none'
  const chosen = fh.s('mustache') || 'none'
  // Circle beards, Van Dykes and anchors include a moustache by definition.
  const tache = chosen !== 'none' ? chosen : beard === 'circle' ? 'chevron' : beard === 'vandyke' ? 'painter' : beard === 'anchor' ? 'pencil' : 'none'
  if (beard === 'none' && tache === 'none') return
  const G = geo(c)
  const side = c.view === 'side'
  const k = kit(c, G, fh.c('color', hairColorOf(c)), side ? [G.hw * 0.4, -G.hh * 0.2] : [0, -G.hh * 0.24], 'facial')
  const faceSP = side ? profileOutline(G.m, c) : faceGeom(c).outline
  const faceD = smooth(faceSP)
  const outClip = c.defs.unique('fo')
  c.defs.put(outClip, el('clipPath', { id: outClip }, el('path', { d: rectD(pathBounds(faceD), G.hh * 3) + faceD, 'clip-rule': 'evenodd' })))
  const inClip = c.defs.unique('fi')
  c.defs.put(inClip, el('clipPath', { id: inClip }, el('path', { d: faceD })))
  const F: FH = { k, hh: G.hh, hw: G.hw, m: G.m, len: fh.n('length'), dens: fh.n('density'), side, faceD, outClip, inClip }
  if (beard !== 'none') {
    const b = side ? sideBeard(c, F, beard) : frontBeard(c, F, beard)
    if (b) out.add('head', Z.beard, 'beard', beard === 'stubble' ? stubbleBeard(F, b) : drawBeard(F, b))
  }
  if (tache !== 'none') {
    const t = side ? sideTache(F, tache, chosen === 'none') : frontTache(c, F, tache, chosen === 'none')
    if (t.ds.length) {
      out.add('head', Z.mustache, 'mustache', drawTache(F, t.ds, t.ridge))
      const sh = castShade(k, t.ds.join(''), faceD, G.hh * 0.02)
      if (sh) out.add('head', Z.mouth + 0.5, 'mustache-shade', sh)
    }
  }
}

function frontBeard(c: Ctx, F: FH, style: string): Beard | null {
  const { hh, hw, m, len, k } = F
  const fg = faceGeom(c)
  const W = (y: number) => fg.widthAt(y)
  const chinY = fg.chinY
  const jawY = -hh * fg.shape.jawY
  const mY = m.mouthY
  const nY = m.noseY
  const mw = hw * lerp(0.27, 0.37, c.sec('mouth').n('width'))
  const yS = m.earY - hh * 0.04
  const ySide = lerp(jawY, chinY, 0.55)
  // Down (or up) one side of the face, pushed outward by e.
  const along = (s: number, y0: number, y1: number, e0: number, e1: number, n = 5): P[] => {
    const o: P[] = []
    for (let i = 0; i <= n; i++) {
      const u = i / n
      const y = lerp(y0, y1, u)
      const e = lerp(e0, e1, smoothstep(0, 1, u))
      o.push([s * (W(y) + e), y + e * 0.35 * smoothstep(jawY - hh * 0.1, ySide, y)])
    }
    return o
  }
  // Around the chin from x0 to -x0, reaching `ext` below it; `tips` makes it clumpy.
  const chin = (x0: number, yEdge: number, ext: number, n = 6, point = false, tips = false): SP[] => {
    const o: SP[] = []
    for (let j = 1; j < n; j++) {
      const x = lerp(x0, -x0, j / n)
      const q = Math.sqrt(Math.max(0, 1 - (x / x0) ** 2))
      const y = lerp(yEdge, chinY + ext, q) - (tips && j % 2 === 0 ? hh * 0.018 * q : 0)
      o.push([x, y, point && j === n / 2 ? 0 : tips ? (j % 2 ? 0.25 : 0.6) : 1])
    }
    return o
  }
  const cheek = (): P[] => {
    const L: P[] = [[-W(yS) * 0.8, yS + hh * 0.01], [-W(-hh * 0.3) * 0.74, -hh * 0.3], [-(mw + hw * 0.14), mY - hh * 0.06], [-mw * 1.05, mY], [-mw * 0.55, mY + hh * 0.052], [0, mY + hh * 0.062]]
    return [...L, ...L.slice(0, -1).map(([x, y]) => [-x, y] as P).reverse()]
  }
  switch (style) {
    case 'stubble': {
      const e1 = hh * 0.006
      const L: P[] = [[-W(yS) * 0.82, yS], [-W(-hh * 0.3) * 0.74, -hh * 0.31], [-hw * 0.55, nY + hh * 0.02], [-hw * 0.2, nY + hh * 0.03], [0, nY + hh * 0.036]]
      const inner = [...L, ...L.slice(0, -1).map(([x, y]) => [-x, y] as P).reverse()]
      return { shapes: [[...along(1, yS, ySide, hh * 0.002, e1), ...chin(W(ySide) + e1, ySide, hh * 0.008), ...along(-1, ySide, yS, e1, hh * 0.002), ...inner]], edges: [inner] }
    }
    case 'short':
    case 'full':
    case 'long': {
      const big = style === 'full' ? 1 : style === 'long' ? 0.9 : 0.45
      const e1 = hh * (0.01 + 0.045 * big * (0.6 + len * 0.8))
      const ext = hh * (0.015 + 0.1 * big * (0.5 + len))
      const x0 = W(ySide) + e1
      const inner = cheek()
      const shape: SP[] = [...along(1, yS, ySide, hh * 0.004, e1), ...chin(x0, ySide + e1 * 0.3, style === 'long' ? ext * 0.5 : ext, 8, false, style !== 'short'), ...along(-1, ySide, yS, e1, hh * 0.004), ...inner]
      const b: Beard = { shapes: [shape], edges: [inner] }
      if (style === 'long') {
        const yT = chinY + hh * (0.28 + 0.6 * len)
        const xw = x0 * 0.95
        const sh = sheet(
          (u) => {
            const x = lerp(xw, -xw, u)
            const e = Math.abs(x) / xw
            return spline([[x * 0.85, lerp(mY, chinY, 0.35)], [x, chinY + hh * 0.02], [x * 0.88, lerp(chinY, yT, 0.5)], [x * 0.5, yT - e * e * hh * 0.1]], 10)
          },
          { n: 5, tips: 'point', tipLen: hh * 0.05, notch: hh * 0.07, rng: k.rng, jag: 0.3 },
        )
        b.shapes.push(sh.pts)
        b.guides = sh.guides
        b.ends = sh.ends
        b.dx = sh.dx
      }
      return b
    }
    case 'goatee': {
      const ext = hh * (0.02 + 0.08 * len)
      const xg = W(ySide) * 0.62
      const top: P[] = [[-mw * 0.6, mY + hh * 0.032], [0, mY + hh * 0.045], [mw * 0.6, mY + hh * 0.032]]
      return { shapes: [[[mw * 0.6, mY + hh * 0.032], [mw * 0.8, mY + hh * 0.075], [xg, ySide + hh * 0.005], ...chin(xg, ySide + hh * 0.01, ext, 6, false, true), [-xg, ySide + hh * 0.005], [-mw * 0.8, mY + hh * 0.075], [-mw * 0.6, mY + hh * 0.032], [0, mY + hh * 0.045]]], edges: [top] }
    }
    case 'circle': {
      const ext = hh * (0.02 + 0.06 * len)
      const xg = W(ySide) * 0.62
      const R: P[] = [[mw * 0.7, nY + hh * 0.045], [mw * 1.12, mY - hh * 0.035], [mw * 1.18, mY + hh * 0.03], [mw * 0.98, mY + hh * 0.1], [xg, ySide]]
      const Lh = R.map(([x, y]) => [-x, y] as P).reverse()
      const edge = [...Lh.slice(0, -1), [0, nY + hh * 0.036] as P, ...R.slice(0, -1)]
      return { shapes: [[[0, nY + hh * 0.036], ...R, ...chin(xg, ySide + hh * 0.01, ext, 6, false, true), ...Lh]], edges: [edge] }
    }
    case 'chinstrap': {
      const bw = hh * lerp(0.028, 0.055, len)
      const e1 = hh * 0.012
      const x0 = W(ySide) + e1
      const outer: SP[] = [...along(1, yS, ySide, hh * 0.003, e1), ...chin(x0, ySide + e1 * 0.3, hh * 0.016), ...along(-1, ySide, yS, e1, hh * 0.003)]
      const innerL: P[] = []
      for (let i = 0; i <= 5; i++) {
        const y = lerp(yS + bw * 0.6, ySide - bw * 0.3, i / 5)
        innerL.push([-(W(y) - bw), y])
      }
      const xi = W(ySide) - bw
      const chinIn: P[] = []
      for (let j = 1; j < 6; j++) {
        const x = lerp(-xi, xi, j / 6)
        chinIn.push([x, lerp(ySide - bw * 0.3, chinY - bw * 0.9, Math.sqrt(Math.max(0, 1 - (x / xi) ** 2)))])
      }
      const innerPath = [...innerL, ...chinIn, ...innerL.map(([x, y]) => [-x, y] as P).reverse()]
      return { shapes: [[...outer, ...innerPath]], edges: [innerPath] }
    }
    case 'vandyke': {
      const top: P[] = [[-mw * 0.32, mY + hh * 0.045], [0, mY + hh * 0.052], [mw * 0.32, mY + hh * 0.045]]
      return { shapes: [[[mw * 0.32, mY + hh * 0.045], [mw * 0.5, mY + hh * 0.1], [hw * 0.24, chinY - hh * 0.025], [0, chinY + hh * (0.07 + 0.16 * len), 0], [-hw * 0.24, chinY - hh * 0.025], [-mw * 0.5, mY + hh * 0.1], [-mw * 0.32, mY + hh * 0.045], [0, mY + hh * 0.052]]], edges: [top] }
    }
    case 'muttonchops': {
      const e1 = hh * (0.012 + 0.025 * len)
      const yJ = jawY + hh * 0.03
      const shapes: SP[][] = []
      const edges: P[][] = []
      for (const s of [1, -1]) {
        const inner: P[] = [[s * W(yJ) * 0.66, yJ + hh * 0.03], [s * mw * 1.32, mY + hh * 0.015], [s * mw * 1.4, mY - hh * 0.07], [s * W(-hh * 0.3) * 0.72, -hh * 0.3], [s * W(yS) * 0.8, yS + hh * 0.01]]
        shapes.push([...along(s, yS, yJ, hh * 0.003, e1), ...inner])
        edges.push(inner)
      }
      return { shapes, edges }
    }
    case 'soulpatch': {
      const bot = mY + hh * (0.1 + 0.04 * len)
      const top: P[] = [[-hw * 0.065, mY + hh * 0.05], [0, mY + hh * 0.046], [hw * 0.065, mY + hh * 0.05]]
      return { shapes: [[...top, [hw * 0.025, lerp(mY + hh * 0.05, bot, 0.6)], [0, bot, 0], [-hw * 0.025, lerp(mY + hh * 0.05, bot, 0.6)]]], edges: [top] }
    }
    case 'anchor': {
      const ext = hh * (0.03 + 0.07 * len)
      const xa = W(ySide) * 0.8
      const yTop = ySide - hh * 0.035
      const top: P[] = [[-xa, yTop], [-xa * 0.7, yTop - hh * 0.02], [-hw * 0.07, yTop - hh * 0.025], [-hw * 0.05, mY + hh * 0.055], [hw * 0.05, mY + hh * 0.055], [hw * 0.07, yTop - hh * 0.025], [xa * 0.7, yTop - hh * 0.02], [xa, yTop]]
      return { shapes: [[[xa, yTop], ...chin(xa, yTop + hh * 0.02, ext, 6, true), ...top.slice(0, -1)]], edges: [top] }
    }
  }
  return null
}

function sideBeard(c: Ctx, F: FH, style: string): Beard | null {
  const { hh, hw: w, m, len, k } = F
  const hd = c.sec('head')
  const chinF = lerp(0.6, 1.4, hd.n('chin'))
  const jawF = lerp(0.85, 1.15, hd.n('jaw'))
  const chinFront: P = [w * 0.84 * jawF, hh * 0.02 * chinF]
  const chinBot: P = [w * 0.58, hh * 0.06 * chinF]
  const jawU: P = [w * 0.2 * jawF, -hh * 0.04]
  const lipLo: P = [w * 0.9, -hh * 0.07]
  const mY = m.mouthY
  const nY = m.noseY
  const yS = m.earY - hh * 0.04
  const cheek: P[] = [[w * 0.8, mY + hh * 0.035], [w * 0.66, mY - hh * 0.02], [w * 0.5, -hh * 0.27], [w * 0.22, yS + hh * 0.01]]
  const fullish = (e: number, ext: number): SP[] => [
    [w * 0.04, yS],
    [w * 0.0, -hh * 0.24],
    [-w * 0.06 - e * 0.3, -hh * 0.1 + e * 0.3],
    [jawU[0] - w * 0.05, jawU[1] + e],
    [lerp(jawU[0], chinBot[0], 0.5), lerp(jawU[1], chinBot[1], 0.5) + e + ext * 0.5, 0.4],
    [chinBot[0], chinBot[1] + ext, 0.5],
    [chinFront[0] + e * 0.5, chinFront[1] + ext * 0.3],
    [lipLo[0] + e * 0.1, lipLo[1] + hh * 0.008],
    ...cheek,
  ]
  switch (style) {
    case 'stubble': {
      const top: P[] = [[w * 0.97, nY + hh * 0.04], [w * 0.7, nY + hh * 0.04], [w * 0.5, -hh * 0.28], [w * 0.22, yS + hh * 0.01]]
      return { shapes: [[[w * 0.04, yS], [0, -hh * 0.24], [-w * 0.08, -hh * 0.1], [jawU[0] - w * 0.05, jawU[1] + hh * 0.006], [chinBot[0], chinBot[1] + hh * 0.006], [chinFront[0] + hh * 0.004, chinFront[1]], [lipLo[0] + hh * 0.004, lipLo[1]], [w * 0.96, mY - hh * 0.02], ...top]], edges: [top] }
    }
    case 'short':
    case 'full':
    case 'long': {
      const big = style === 'full' ? 1 : style === 'long' ? 0.9 : 0.45
      const e = hh * (0.012 + 0.04 * big * (0.6 + len * 0.8))
      const ext = hh * (0.015 + 0.09 * big * (0.5 + len))
      const b: Beard = { shapes: [fullish(e, style === 'long' ? ext * 0.5 : ext)], edges: [cheek] }
      if (style === 'long') {
        const yT = chinBot[1] + hh * (0.28 + 0.6 * len)
        const sh = sheet(
          (u) => {
            const x = lerp(jawU[0] - w * 0.02, chinFront[0] + e * 0.4, u)
            return spline([[x, chinBot[1] - hh * 0.08], [x + w * 0.04, lerp(chinBot[1], yT, 0.4)], [lerp(x, chinBot[0] + w * 0.12, 0.6), yT - Math.abs(u - 0.55) * hh * 0.1]], 10)
          },
          { n: 3, tips: 'point', tipLen: hh * 0.05, notch: hh * 0.07, rng: k.rng, jag: 0.3 },
        )
        b.shapes.push(sh.pts)
        b.guides = sh.guides
        b.ends = sh.ends
        b.dx = sh.dx
      }
      return b
    }
    case 'goatee': {
      const ext = hh * (0.02 + 0.07 * len)
      const top: P[] = [[w * 0.66, mY + hh * 0.06], [w * 0.88, mY + hh * 0.04]]
      return { shapes: [[[lipLo[0] - w * 0.02, mY + hh * 0.04], [chinFront[0] + w * 0.03, chinFront[1]], [chinBot[0] + w * 0.04, chinBot[1] + ext, 0.5], [w * 0.42, chinBot[1] + ext * 0.4], [w * 0.5, chinBot[1] - hh * 0.05], [w * 0.66, mY + hh * 0.06]]], edges: [top] }
    }
    case 'circle': {
      const ext = hh * (0.02 + 0.06 * len)
      const edge: P[] = [[w * 0.62, mY + hh * 0.06], [w * 0.62, mY - hh * 0.02], [w * 0.7, nY + hh * 0.05], [w * 0.92, nY + hh * 0.04]]
      return { shapes: [[[w * 0.92, nY + hh * 0.04], [w * 0.98, mY - hh * 0.03], [w * 0.95, mY + hh * 0.035], [chinFront[0] + w * 0.03, chinFront[1]], [chinBot[0] + w * 0.03, chinBot[1] + ext, 0.5], [w * 0.44, chinBot[1] + ext * 0.3], [w * 0.46, chinBot[1] - hh * 0.05], ...edge.slice(0, -1)]], edges: [edge] }
    }
    case 'chinstrap': {
      const bw = hh * lerp(0.028, 0.05, len)
      const outer: P[] = [[w * 0.04, yS], [0, -hh * 0.24], [-w * 0.07, -hh * 0.09], [jawU[0], jawU[1] + hh * 0.014], [chinBot[0], chinBot[1] + hh * 0.014], [chinFront[0] + w * 0.015, chinFront[1]]]
      const inner: P[] = [[chinFront[0] - w * 0.03, chinFront[1] - bw], [chinBot[0] - w * 0.02, chinBot[1] - bw], [jawU[0] + w * 0.02, jawU[1] - bw], [-w * 0.07 + bw, -hh * 0.09 - bw * 0.8], [bw * 0.9, -hh * 0.24], [w * 0.04 + bw, yS]]
      return { shapes: [[...outer, ...inner]], edges: [inner] }
    }
    case 'vandyke': {
      const top: P[] = [[w * 0.72, mY + hh * 0.06], [w * 0.84, mY + hh * 0.045]]
      return { shapes: [[[w * 0.84, mY + hh * 0.045], [chinFront[0] + w * 0.02, chinFront[1]], [chinFront[0] + w * 0.02 + len * w * 0.08, chinBot[1] + hh * (0.05 + 0.12 * len), 0], [chinBot[0], chinBot[1]], [w * 0.66, chinBot[1] - hh * 0.05], [w * 0.72, mY + hh * 0.06]]], edges: [top] }
    }
    case 'muttonchops': {
      const e = hh * (0.012 + 0.02 * len)
      const edge: P[] = [[jawU[0] + w * 0.06, jawU[1] + e * 0.7], [w * 0.5, -hh * 0.06], [w * 0.58, mY - hh * 0.02], [w * 0.48, -hh * 0.27], [w * 0.22, yS]]
      return { shapes: [[[w * 0.02, yS], [-w * 0.02, -hh * 0.24], [-w * 0.06 - e * 0.4, -hh * 0.1 + e * 0.4], ...edge]], edges: [edge] }
    }
    case 'soulpatch': {
      const top: P[] = [[w * 0.8, mY + hh * 0.065], [w * 0.86, mY + hh * 0.045]]
      return { shapes: [[[w * 0.86, mY + hh * 0.045], [w * 0.9, mY + hh * 0.06], [w * 0.86, mY + hh * (0.1 + 0.04 * len), 0], [w * 0.8, mY + hh * 0.065]]], edges: [top] }
    }
    case 'anchor': {
      const ext = hh * (0.03 + 0.06 * len)
      const edge: P[] = [[w * 0.3, jawU[1] + hh * 0.02], [w * 0.35, jawU[1] - hh * 0.02], [w * 0.62, chinBot[1] - hh * 0.04], [w * 0.8, mY + hh * 0.07]]
      return { shapes: [[[w * 0.86, mY + hh * 0.045], [w * 0.9, mY + hh * 0.07], [chinFront[0] + w * 0.02, chinFront[1] - hh * 0.01], [chinFront[0] + w * 0.03, chinBot[1] + ext, 0.3], [chinBot[0] - w * 0.02, chinBot[1] + ext * 0.6], ...edge]], edges: [edge] }
    }
  }
  return null
}

function beardStrokes(F: FH, bb: Box, inside: (p: P) => boolean): string {
  const { k, hh, hw } = F
  if (k.det < 1) return ''
  const cell = hh * (k.baked ? (k.det > 1 ? 0.042 : 0.055) : 0.1)
  const rng = k.rng
  let dk = ''
  let lt = ''
  let row = 0
  for (let y = bb.y + cell * 0.5; y < bb.y + bb.h; y += cell * 0.8, row++) {
    for (let x = bb.x + (row % 2 ? cell * 0.5 : 0); x < bb.x + bb.w; x += cell) {
      const p: P = [x + rng.range(-0.35, 0.35) * cell, y + rng.range(-0.3, 0.3) * cell]
      if (!inside(p)) continue
      const out = F.side ? 0.15 : clamp(p[0] / hw, -1, 1) * 0.45
      const dir = norm([out + rng.range(-0.15, 0.15), 1])
      const l = hh * rng.range(0.03, 0.055) * (0.8 + F.len * 0.4)
      const e: P = [p[0] + dir[0] * l, p[1] + dir[1] * l]
      const bend = rng.range(-0.15, 0.15) * l
      const mm: P = [lerp(p[0], e[0], 0.5) + dir[1] * bend, lerp(p[1], e[1], 0.5) - dir[0] * bend]
      const s = lens(p, mm, e, k.lw * 0.16)
      if (rng.next() < 0.55) dk += s
      else lt += s
    }
  }
  return k.P.flat(dk, k.pal.dark, 0.5) + (k.flat ? '' : k.P.flat(lt, k.pal.light, 0.4))
}

function drawBeard(F: FH, b: Beard): string {
  const { k, hh, m } = F
  const { P, pal, lw } = k
  const ds = b.shapes.map((s) => smooth(s))
  const bb = boundsOf(b.shapes.flat().map(([x, y]) => [x, y] as P))
  const inside = (p: P) => b.shapes.some((s) => inPoly(p, s))
  const col = pal.base
  const all = ds.join('')
  // Soft edge where the beard meets skin: a feathered fringe under the fill.
  const feather = k.det > 0 && !k.flat ? P.line(all, col, lw * 2.6, { opacity: 0.1 + 0.1 * F.dens }) + P.line(all, col, lw * 1.3, { opacity: 0.16 + 0.14 * F.dens }) : ''
  // Outline only where the beard leaves the face: an underlay, so only the silhouette shows.
  const underlay = P.lw > 0 ? g({ 'clip-path': url(F.outClip), fill: 'none', stroke: P.ink(col), 'stroke-width': f(P.lw * 2), 'stroke-linejoin': 'round' }, ...ds.map((d) => el('path', { d }))) : ''
  const solid = F.dens >= 0.55
  const body = solid
    ? ds.length > 1
      ? P.union(ds, col, { outline: false, offset: 0.08, shade: 0.9, material: 'hair', spec: 0 })
      : P.shape(ds[0], col, { outline: false, offset: 0.08, shade: 0.9, material: 'hair', spec: 0 })
    : P.flat(all, col, lerp(0.45, 0.92, F.dens / 0.55))
  let deco = ''
  if (k.det > 0) {
    if (!k.flat) {
      // Under the jaw the beard turns away from the light.
      deco += el('path', { d: rectD(bb, hh * 0.2) + F.faceD, 'fill-rule': 'evenodd', fill: P.col(pal.deep), 'fill-opacity': 0.3, transform: `translate(0 ${f(-hh * 0.012)})` })
      deco += P.flat(ellipse(F.side ? F.hw * 0.78 : 0, m.mouthY + hh * 0.06, F.side ? F.hw * 0.12 : F.hw * 0.3, hh * 0.022), pal.deep, 0.22)
    }
    deco += beardStrokes(F, bb, inside)
    if (b.guides) deco += clumpDeco(k, { guides: b.guides, ends: b.ends, band: 0.45, sheenK: 0.45, bandLen: hh * 0.06, streakable: false, glow: false, strands: false })
    if (!k.flat && k.shine > 0.03) {
      // Matte sheen on the jaw and chin, on the lit side.
      let hs = ''
      const lx = k.L[0] < 0 ? -1 : 1
      const cands: P[] = F.side ? [[F.hw * 0.55, -hh * 0.02], [F.hw * 0.75, hh * 0.02]] : [[lx * F.hw * 0.62, -hh * 0.08], [lx * F.hw * 0.25, hh * 0.04]]
      for (const c0 of cands) {
        for (let j = 0; j < 3; j++) {
          const p: P = [c0[0] + k.rng.range(-1, 1) * hh * 0.03, c0[1] + k.rng.range(-1, 1) * hh * 0.02]
          if (!inside(p)) continue
          hs += lens(p, [p[0] + hh * 0.003, p[1] + hh * 0.025], [p[0] + hh * 0.004, p[1] + hh * 0.05], hh * 0.007)
        }
      }
      deco += P.flat(hs, pal.sheen, sheenA(k) * 0.5)
    }
    if (k.baked && !k.flat) ds.forEach((d, i) => (deco += ds.length > 1 ? g({ 'clip-path': url(clipFor(k, [d])) }, rimLight(k, i > 0 && b.dx ? b.dx : d)) : rimLight(k, d)))
  }
  const clip = deco ? g({ 'clip-path': url(clipFor(k, ds)) }, deco) : ''
  // A fine, soft line where the beard meets skin keeps light beards readable on any skin.
  const edge = P.lw > 0 && k.det > 0 ? g({ 'clip-path': url(F.inClip) }, el('path', { d: all, fill: 'none', stroke: P.ink(col), 'stroke-width': f(P.lw * 0.45), 'stroke-opacity': 0.42, 'stroke-linejoin': 'round' })) : ''
  // Wisps break the edges against skin (baked).
  let wisps = ''
  if (k.baked && k.det > 1) {
    let wd = ''
    for (const edge of b.edges) {
      const pts = resample(edge, Math.max(4, Math.round(gLen(edge) / (hh * 0.018))))
      for (let i = 1; i < pts.length - 1; i++) {
        if (k.rng.next() < 0.3) continue
        const p = pts[i]
        const l = hh * k.rng.range(0.018, 0.034)
        const dx = k.rng.range(-0.25, 0.25)
        wd += lens([p[0] - dx * l * 0.4, p[1] - l * 0.45], [p[0], p[1] + l * 0.05], [p[0] + dx * l, p[1] + l * 0.55], lw * 0.14)
      }
    }
    wisps = P.flat(wd, col, 0.7)
  }
  return feather + underlay + body + clip + edge + wisps
}

function stubbleBeard(F: FH, b: Beard): string {
  const { k, hh } = F
  const { P, pal } = k
  const tint = mix(pal.base, shadowOf(k.skin, 0.3), 0.45)
  const a = lerp(0.16, 0.42, F.dens)
  let s = ''
  for (const sh of b.shapes) {
    if (k.det > 0 && !k.flat) s += P.flat(smooth(offsetPts(sh, hh * 0.008)), tint, a * 0.4) + P.flat(smooth(sh), tint, a * 0.45) + P.flat(smooth(offsetPts(sh, -hh * 0.014)), tint, a * 0.5)
    else s += P.flat(smooth(sh), tint, a)
  }
  if (k.baked && k.det > 1) {
    const bb = boundsOf(b.shapes.flat().map(([x, y]) => [x, y] as P))
    const cell = hh * 0.026
    let d = ''
    let row = 0
    for (let y = bb.y; y < bb.y + bb.h; y += cell * 0.8, row++) {
      for (let x = bb.x + (row % 2 ? cell * 0.5 : 0); x < bb.x + bb.w; x += cell) {
        const p: P = [x + k.rng.range(-0.35, 0.35) * cell, y + k.rng.range(-0.35, 0.35) * cell]
        if (!b.shapes.some((sh) => inPoly(p, sh))) continue
        const l = hh * k.rng.range(0.006, 0.011)
        const dx = F.side ? 0.1 : clamp(p[0] / F.hw, -1, 1) * 0.3
        d += `M${f1(p[0])} ${f1(p[1])}L${f1(p[0] + dx * l)} ${f1(p[1] + l)}`
      }
    }
    s += P.line(d, pal.dark, hh * 0.0045, { opacity: 0.35 + F.dens * 0.2 })
  }
  return s
}

interface Tache {
  ds: string[]
  /** The top ridge of each half (s, m, e), where the sheen sits. */
  ridge: [P, P, P][]
}

/** Points of a bottom edge running from x0 to x1 at y, with small hanging clump tips. */
function hangTips(x0: number, x1: number, y: number, depth: number, n: number): SP[] {
  const o: SP[] = []
  for (let i = 0; i <= n * 2; i++) {
    const t = i / (n * 2)
    o.push(i % 2 ? [lerp(x0, x1, t), y + depth, 0.2] : [lerp(x0, x1, t), y - depth * 0.2, 0.6])
  }
  return o
}

function frontTache(c: Ctx, F: FH, style: string, auto: boolean): Tache {
  const { hh, hw, m, len } = F
  const mw = hw * lerp(0.27, 0.37, c.sec('mouth').n('width')) * (auto ? 0.9 : 1)
  const yN = m.noseY + hh * 0.04
  const yL = m.mouthY - hh * 0.015
  const bulk = lerp(0.8, 1.25, len)
  const mirror = (pts: SP[]): SP[] => pts.map((p) => (p.length > 2 ? [-p[0], p[1], p[2]] : [-p[0], p[1]]) as SP)
  const ridge: [P, P, P][] = [-1, 1].map((s) => [[s * mw * 0.12, yN + hh * 0.012], [s * mw * 0.45, yN + hh * 0.008], [s * mw * 0.8, yN + hh * 0.02]] as [P, P, P])
  switch (style) {
    case 'pencil': {
      const w = hh * 0.007 * bulk
      const ds = [-1, 1].map((s) => lens([s * mw * 0.98, yL + hh * 0.006], [s * mw * 0.5, yL - hh * 0.006], [s * mw * 0.06, yL - hh * 0.004], w))
      return { ds, ridge: [] }
    }
    case 'chevron': {
      const th = auto ? 0.8 : bulk
      const R: SP[] = [[mw * 0.45, yN - hh * 0.002], [mw * 0.82, yN + hh * 0.012 * th], [mw * 1.06, yL + hh * 0.022 * th, 0.4]]
      const bottom = hangTips(mw * 0.95, -mw * 0.95, yL + hh * 0.008 * th, hh * 0.012 * th, 5)
      return { ds: [smooth([[0, yN + hh * 0.004], ...R, ...bottom, ...mirror(R).reverse()])], ridge }
    }
    case 'walrus': {
      const R: SP[] = [[mw * 0.6, yN - hh * 0.01], [mw * 1.02, yN + hh * 0.022], [mw * 1.28, yL + hh * 0.06 * bulk, 0.3]]
      const bottom = hangTips(mw * 1.15, -mw * 1.15, yL + hh * 0.045 * bulk, hh * 0.022 * bulk, 6)
      return { ds: [smooth([[0, yN - hh * 0.008], ...R, ...bottom, ...mirror(R).reverse()])], ridge }
    }
    case 'handlebar': {
      const ds = [-1, 1].map((s) =>
        brush([[s * mw * 0.04, yL - hh * 0.012], [s * mw * 0.55, yL - hh * 0.004], [s * mw * 1.05, yL - hh * 0.008], [s * mw * 1.38, yL - hh * 0.045], [s * mw * 1.3, yL - hh * 0.08], [s * mw * 1.15, yL - hh * 0.07]], hh * 0.045 * bulk, hh * 0.006, hh * 0.01),
      )
      return { ds, ridge: [-1, 1].map((s) => [[s * mw * 0.1, yL - hh * 0.026], [s * mw * 0.5, yL - hh * 0.022], [s * mw * 0.95, yL - hh * 0.024]] as [P, P, P]) }
    }
    case 'horseshoe': {
      const bot = F.side ? 0 : faceGeom(c).chinY - hh * 0.035
      const R: SP[] = [[mw * 0.55, yN], [mw * 0.95, yN + hh * 0.01], [mw * 1.2, yL + hh * 0.012], [mw * 1.22, m.mouthY + hh * 0.1], [mw * 1.17, bot, 0.5], [mw * 0.96, bot, 0.5], [mw * 0.96, m.mouthY + hh * 0.02], [mw * 0.7, yL + hh * 0.014]]
      return { ds: [smooth([[0, yN + hh * 0.004], ...R, [0, yL + hh * 0.008], ...mirror(R).reverse()])], ridge }
    }
    case 'painter': {
      const ds = [brush([[-mw * 1.2, yL + hh * 0.014], [-mw * 0.6, yL - hh * 0.01], [0, yL - hh * 0.018], [mw * 0.6, yL - hh * 0.01], [mw * 1.2, yL + hh * 0.014]], 0, 0, hh * 0.045 * (auto ? 0.8 : bulk))]
      return { ds, ridge: [-1, 1].map((s) => [[s * mw * 0.1, yL - hh * 0.03], [s * mw * 0.5, yL - hh * 0.026], [s * mw * 0.95, yL - hh * 0.012]] as [P, P, P]) }
    }
    case 'toothbrush': {
      const R: SP[] = [[mw * 0.36, yN + hh * 0.004, 0.5], [mw * 0.38, yL + hh * 0.012, 0.5]]
      const bottom = hangTips(mw * 0.34, -mw * 0.34, yL + hh * 0.01, hh * 0.008, 3)
      return { ds: [smooth([[0, yN + hh * 0.002], ...R, ...bottom, ...mirror(R).reverse()])], ridge: [-1, 1].map((s) => [[s * mw * 0.05, yN + hh * 0.012], [s * mw * 0.18, yN + hh * 0.01], [s * mw * 0.3, yN + hh * 0.014]] as [P, P, P]) }
    }
  }
  return { ds: [], ridge: [] }
}

function sideTache(F: FH, style: string, auto: boolean): Tache {
  const { hh, hw: w, m, len } = F
  const yN = m.noseY + hh * 0.04
  const yL = m.mouthY - hh * 0.015
  const bulk = lerp(0.8, 1.25, len) * (auto ? 0.85 : 1)
  const ridge: [P, P, P][] = [[[w * 0.68, yN + hh * 0.014], [w * 0.84, yN + hh * 0.006], [w * 0.97, yN + hh * 0.012]]]
  switch (style) {
    case 'pencil':
      return { ds: [lens([w * 0.66, yL + hh * 0.004], [w * 0.82, yL - hh * 0.006], [w * 0.96, yL - hh * 0.002], hh * 0.007 * bulk)], ridge: [] }
    case 'chevron':
      return { ds: [smooth([[w * 0.62, yN + hh * 0.012], [w * 0.86, yN], [w * 0.99, yN + hh * 0.01], [w * 1.0, yL + hh * 0.012 * bulk, 0.4], [w * 0.9, yL + hh * 0.02 * bulk, 0.2], [w * 0.82, yL + hh * 0.012], [w * 0.72, yL + hh * 0.018 * bulk, 0.2], [w * 0.62, yL + hh * 0.01]])], ridge }
    case 'painter':
      return { ds: [lens([w * 0.56, yL + hh * 0.02], [w * 0.8, yL - hh * 0.012], [w * 0.99, yL - hh * 0.004], hh * 0.018 * bulk)], ridge: [] }
    case 'handlebar':
      return { ds: [brush([[w * 0.98, yL - hh * 0.004], [w * 0.78, yL - hh * 0.002], [w * 0.6, yL - hh * 0.012], [w * 0.5, yL - hh * 0.05], [w * 0.56, yL - hh * 0.08]], hh * 0.04 * bulk, hh * 0.006)], ridge: [] }
    case 'walrus':
      return {
        ds: [smooth([[w * 0.6, yN], [w * 0.9, yN - hh * 0.008], [w * 1.02, yN + hh * 0.02], [w * 1.04, yL + hh * 0.05 * bulk, 0], [w * 0.94, yL + hh * 0.035], [w * 0.86, yL + hh * 0.055 * bulk, 0], [w * 0.76, yL + hh * 0.03], [w * 0.66, yL + hh * 0.04 * bulk, 0], [w * 0.6, yL + hh * 0.02]])],
        ridge,
      }
    case 'horseshoe':
      return { ds: [smooth([[w * 0.64, yN + hh * 0.012], [w * 0.88, yN], [w * 0.99, yN + hh * 0.012], [w * 1.0, yL + hh * 0.01], [w * 0.8, yL + hh * 0.015], [w * 0.72, yL + hh * 0.03], [w * 0.74, m.mouthY + hh * 0.15, 0.4], [w * 0.64, m.mouthY + hh * 0.15, 0.4], [w * 0.6, yL + hh * 0.01]])], ridge }
    case 'toothbrush':
      return { ds: [smooth([[w * 0.8, yN, 0.5], [w * 0.97, yN + hh * 0.005, 0.5], [w * 0.98, yL + hh * 0.008, 0.5], [w * 0.8, yL + hh * 0.008, 0.5]])], ridge: [] }
  }
  return { ds: [], ridge: [] }
}

function drawTache(F: FH, ds: string[], ridge: [P, P, P][]): string {
  const { k, hh, hw } = F
  const { P, pal, lw } = k
  let post = ''
  if (k.det > 0) {
    // Hair strokes fanning out from the philtrum.
    const bb = ds.map(pathBounds).reduce((a, b) => {
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
    })
    const cell = hh * (k.baked ? 0.018 : 0.03)
    const cx = F.side ? hw * 0.98 : 0
    let dk = ''
    let lt = ''
    let row = 0
    for (let y = bb.y + cell * 0.3; y < bb.y + bb.h; y += cell * 0.7, row++) {
      for (let x = bb.x + (row % 2 ? cell * 0.5 : 0); x < bb.x + bb.w; x += cell) {
        const p: P = [x + k.rng.range(-0.3, 0.3) * cell, y + k.rng.range(-0.3, 0.3) * cell]
        const s = F.side ? -1 : Math.sign(p[0] - cx) || 1
        const dir = norm([s * 0.85, 0.5])
        const l = hh * k.rng.range(0.022, 0.034)
        const st = lens(p, [p[0] + dir[0] * l * 0.5, p[1] + dir[1] * l * 0.5 - l * 0.08], [p[0] + dir[0] * l, p[1] + dir[1] * l], lw * 0.14)
        if (k.rng.next() < 0.55) dk += st
        else lt += st
      }
    }
    post += P.flat(dk, pal.dark, 0.5) + (k.flat ? '' : P.flat(lt, pal.light, 0.38))
    if (!k.flat && k.shine > 0.03 && ridge.length) {
      let hs = ''
      for (const [s, mm, e] of ridge) {
        const lit = F.side ? 0.8 : clamp(0.5 + (mm[0] * k.L[0] * 4) / (hw || 1), 0.3, 1)
        if (lit < 0.35) continue
        hs += lens(s, mm, e, hh * 0.006 * lit)
      }
      post += P.flat(hs, pal.sheen, sheenA(k) * 0.6)
    }
  }
  return drawMass(k, { ds, offset: 0.18, outline: 0.8, post, rim: k.baked ? ds.join('') : false })
}

/* Scene: backgrounds (solid, gradients, patterns, procedural landscapes), the ground
 * shadow, and profile-picture frames with their borders. Everything here is drawn in
 * world space against the crop box, so it scales with any crop.
 *
 * Two budgets. Baked stills (`ctx.baked`, detail above low) get the illustrated look:
 * depth layers with atmospheric perspective, soft light, particles, a focal light behind
 * the subject, a vignette and a fine texture. Animation frames and `detail: low` get the
 * same composition in a few flat layers, so they stay cheap and clean.
 *
 * Composition rules: the subject's head is a calm zone (particles and busy detail thin
 * out around it), the sun or key light sits on the side the art style's light comes
 * from, and the ground plane lines up with world y = 0, where the feet stand.
 *
 * resvg safety: every filtered, masked or clipped group is built inside the crop box, and
 * translucency uses fill-/stroke-opacity, never group opacity. */

import { fromLch, highlightOf, hueShift, luminance, mix, shadowOf, toLch } from '../../core/color.ts'
import { fbm1 } from '../../core/noise.ts'
import { clamp, clamp01, cubicAt, dist, lerp, TAU, type Box, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, heart, poly, rect, regularPts, roundRect, signedArea, smooth, sparkle, star, starPts, type SP } from '../../core/path.ts'
import { hash32, type Rng } from '../../core/rng.ts'
import { el, g, url } from '../../core/svg.ts'
import type { Ctx } from '../../render/context.ts'
import type { Model } from '../../render/model.ts'
import type { Painter } from '../../render/painter.ts'
import { motionClass, motionPhase } from '../../render/motion.ts'

/* ---- Kit: the crop box, the subject and the budget ------------------------------ */

type Stop = [number, string, number?]

interface Subject {
  hx: number
  hy: number
  hr: number
  /** Top of the figure (world y, negative). */
  top: number
}

interface Kit {
  c: Ctx
  P: Painter
  x: number
  y: number
  w: number
  h: number
  /** Baked still above detail low: the layered, lit look. */
  hi: boolean
  /** Baked at detail high: the finest touches (texture, tiny particles). */
  rich: boolean
  /** detail low (icons, pixel art): flat and clean. */
  lo: boolean
  /** Unit vector toward the light. */
  L: P
  /** -1 when the light comes from the left, 1 from the right. */
  side: number
  /** Horizon (world y). */
  hz: number
  /** Top of the near ground plane (world y). */
  gt: number
  /** Whether the feet (world y = 0) are inside the box. */
  ground: boolean
  hx: number
  hy: number
  hr: number
  /** Suffix for defs that depend on the box (a model may render several crops). */
  bk: string
}

const subjects = new WeakMap<Ctx, Subject>()

/** Where the head is, roughly, at rest: the focal point of every background. */
function subjectOf(c: Ctx): Subject {
  const hit = subjects.get(c)
  if (hit) return hit
  let s: Subject = { hx: 0, hy: -600, hr: 120, top: -760 }
  if (c.hr) {
    const m = c.hr.m
    const neckTop = -(m.legLen + m.torsoLen + m.neckLen)
    s = { hx: 0, hy: neckTop - m.headH * 0.45, hr: m.headH * 0.62 + m.hairLift * 0.5, top: neckTop - m.headH * 0.95 - m.hairLift }
  } else if (c.cr) {
    const m = c.cr.m
    const hm = c.skel.world({}).get('head')
    const hx = hm ? hm[4] : 0
    const hy = hm ? hm[5] : m.bodyY
    const hr = m.frontFacing ? m.bodyR * 1.1 : m.headR * 1.35 + m.snout * 0.3
    s = { hx, hy, hr: Math.max(hr, 40), top: Math.min(hy - hr, m.bodyY - m.bodyR) }
  }
  subjects.set(c, s)
  return s
}

const boxKey = (b: Box): string => hash32(Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)).toString(36)

function makeKit(c: Ctx, box: Box): Kit {
  const P = c.paint
  const sj = subjectOf(c)
  const { x, y, w, h } = box
  const feetV = -y / h
  const ground = feetV > 0.4 && feetV < 1.03
  // With the feet in view the horizon sits a third of the way up the figure (knee to hip
  // height); head and bust crops put it behind the shoulders.
  const hzV = ground ? Math.min(clamp((sj.top * 0.3 - y) / h, 0.58, 0.8), feetV - 0.05) : 0.76
  const hz = y + h * hzV
  const L = P.style.light
  return {
    c,
    P,
    x,
    y,
    w,
    h,
    hi: c.baked && P.detail > 0,
    rich: c.baked && P.detail === 2,
    lo: P.detail === 0,
    L,
    side: L[0] <= 0 ? -1 : 1,
    hz,
    gt: ground ? Math.min(hz + h * 0.06, -h * 0.035) : hz + h * 0.06,
    ground,
    hx: sj.hx,
    hy: sj.hy,
    hr: sj.hr,
    bk: boxKey(box),
  }
}

/* ---- Paint helpers (colours are raw here and graded once, on the way out) -------- */

/** Compact number: one decimal is plenty for scenery. */
const n1 = (v: number): string => f(Math.round(v * 10) / 10)

/** A circle as a compact relative-arc subpath. */
function dot(cx: number, cy: number, r: number): string {
  const R = n1(r)
  return `M${n1(cx - r)} ${n1(cy)}a${R} ${R} 0 1 0 ${n1(r * 2)} 0a${R} ${R} 0 1 0 ${n1(-r * 2)} 0Z`
}

/** Clips a convex polygon to an axis-aligned box (Sutherland-Hodgman). */
function clipToBox(pts: P[], b: Box): P[] {
  let out = pts
  const edges: [(p: P) => number, number, 0 | 1][] = [
    [(p) => p[0] - b.x, b.x, 0],
    [(p) => b.x + b.w - p[0], b.x + b.w, 0],
    [(p) => p[1] - b.y, b.y, 1],
    [(p) => b.y + b.h - p[1], b.y + b.h, 1],
  ]
  for (const [inside, v, axis] of edges) {
    const src = out
    out = []
    for (let i = 0; i < src.length; i++) {
      const a = src[i]
      const c = src[(i + 1) % src.length]
      const ia = inside(a) >= 0
      const ic = inside(c) >= 0
      if (ia) out.push(a)
      if (ia !== ic) {
        const t = (v - a[axis]) / (c[axis] - a[axis])
        out.push(axis === 0 ? [v, a[1] + (c[1] - a[1]) * t] : [a[0] + (c[0] - a[0]) * t, v])
      }
    }
    if (!out.length) break
  }
  return out
}

function polyC(pts: P[]): string {
  let d = ''
  for (let i = 0; i < pts.length; i++) d += `${i ? 'L' : 'M'}${n1(pts[i][0])} ${n1(pts[i][1])}`
  return d + 'Z'
}

function stopsOf(P: Painter, stops: Stop[], raw = false): string {
  let out = ''
  for (const [o, col, a] of stops) out += el('stop', { offset: f(o), 'stop-color': raw ? col : P.col(col), 'stop-opacity': a !== undefined && a < 1 ? f(Math.max(0, a)) : undefined })
  return out
}

function lin(k: Kit, key: string, stops: Stop[], x1: number, y1: number, x2: number, y2: number): string {
  return url(k.c.defs.add(`sl${key}${k.bk}`, (id) => el('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: n1(x1), y1: n1(y1), x2: n1(x2), y2: n1(y2) }, stopsOf(k.P, stops))))
}

const vg = (k: Kit, key: string, stops: Stop[], y0: number, y1: number): string => lin(k, key, stops, 0, y0, 0, y1)

function rad(k: Kit, key: string, stops: Stop[], cx: number, cy: number, rx: number, ry = rx, raw = false): string {
  return url(
    k.c.defs.add(`sr${key}${k.bk}`, (id) =>
      el('radialGradient', { id, gradientUnits: 'userSpaceOnUse', cx: 0, cy: 0, r: 1, gradientTransform: `matrix(${n1(rx)} 0 0 ${n1(ry)} ${n1(cx)} ${n1(cy)})` }, stopsOf(k.P, stops, raw)),
    ),
  )
}

/** Falloff profiles for soft light (object-bounding-box radial gradients). */
const PROFILES = {
  // Roughly gaussian: reads as light, not as a disc.
  glow: [[0, 1], [0.18, 0.8], [0.4, 0.45], [0.65, 0.15], [1, 0]],
  // Out-of-focus highlight: flat body, soft edge.
  disc: [[0, 0.7], [0.6, 0.62], [0.82, 0.3], [1, 0]],
  // Hot core with a short falloff (stars, lamps).
  core: [[0, 1], [0.25, 0.85], [0.5, 0.3], [1, 0]],
} as const

function softFill(k: Kit, col: string, profile: keyof typeof PROFILES = 'glow'): string {
  const c = k.P.col(col)
  return url(
    k.c.defs.add(`ss${profile}${c.slice(1)}`, (id) =>
      el('radialGradient', { id }, PROFILES[profile].map(([o, a]) => el('stop', { offset: f(o), 'stop-color': c, 'stop-opacity': a < 1 ? f(a) : undefined })).join('')),
    ),
  )
}

function soft(k: Kit, cx: number, cy: number, rx: number, ry: number, col: string, op = 1, profile: keyof typeof PROFILES = 'glow', rot = 0): string {
  return el('ellipse', {
    cx: n1(cx),
    cy: n1(cy),
    rx: n1(rx),
    ry: n1(ry),
    fill: softFill(k, col, profile),
    'fill-opacity': op < 1 ? f(op) : undefined,
    transform: rot ? `rotate(${f(rot)} ${n1(cx)} ${n1(cy)})` : undefined,
  })
}

/**
 * A blur whose filter region is the content's bounds (padded for the blur) clipped to the
 * crop box: filters cost in proportion to their region, and nothing renders off-canvas.
 * Returns undefined when the region misses the box (the caller then skips the filter).
 */
function blur(k: Kit, std: number, r?: Box): string | undefined {
  const s = Math.max(0.2, Math.round(std * 5) / 5)
  const pad = s * 3
  const x0 = Math.floor(r ? Math.max(k.x, r.x - pad) : k.x)
  const y0 = Math.floor(r ? Math.max(k.y, r.y - pad) : k.y)
  const x1 = Math.ceil(r ? Math.min(k.x + k.w, r.x + r.w + pad) : k.x + k.w)
  const y1 = Math.ceil(r ? Math.min(k.y + k.h, r.y + r.h + pad) : k.y + k.h)
  if (x1 - x0 < 1 || y1 - y0 < 1) return undefined
  return url(
    k.c.defs.add(`sb${String(s).replace('.', 'p')}_${hash32(x0, y0, x1, y1).toString(36)}`, (id) =>
      el('filter', { id, filterUnits: 'userSpaceOnUse', x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, el('feGaussianBlur', { stdDeviation: f(s) })),
    ),
  )
}

const boxOf = (x0: number, y0: number, x1: number, y1: number): Box => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
const unite = (a: Box | null, b: Box): Box => (a ? boxOf(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x + a.w, b.x + b.w), Math.max(a.y + a.h, b.y + b.h)) : b)

const fullD = (k: Kit): string => rect(k.x - 2, k.y - 2, k.w + 4, k.h + 4)
const fillBox = (k: Kit, paint: string, op = 1): string => el('path', { d: fullD(k), fill: paint, 'fill-opacity': op < 1 ? f(op) : undefined })
const flat = (k: Kit, d: string, col: string, op = 1): string => (d ? el('path', { d, fill: k.P.col(col), 'fill-opacity': op < 1 ? f(op) : undefined }) : '')
const paintD = (d: string, paint: string, op = 1): string => (d ? el('path', { d, fill: paint, 'fill-opacity': op < 1 ? f(op) : undefined }) : '')
const strokeD = (k: Kit, d: string, col: string, width: number, op = 1): string =>
  d ? el('path', { d, fill: 'none', stroke: k.P.col(col), 'stroke-width': n1(width), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': op < 1 ? f(op) : undefined }) : ''

/** 0 at the head, 1 well away from it: how much busy detail a spot can take. */
function calm(k: Kit, px: number, py: number, reach = 1): number {
  const d = Math.hypot(px - k.hx, (py - k.hy) * 0.85) / (k.hr * reach)
  return clamp01((d - 1.1) / 1.5)
}

/** Random points in a box-relative region, thinned out around the head. */
function scatter(k: Kit, rng: Rng, n: number, u0: number, v0: number, u1: number, v1: number, reach = 1): P[] {
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const px = k.x + k.w * rng.range(u0, u1)
    const py = k.y + k.h * rng.range(v0, v1)
    if (rng.next() < calm(k, px, py, reach)) out.push([px, py])
  }
  return out
}

/** The sun, moon or key light: up on the side the light comes from, clear of the head. */
function sunAt(k: Kit, v: number): P {
  const off = 0.22 + Math.abs(k.L[0]) * 0.28
  return [k.x + k.w * (0.5 + k.side * off), k.y + k.h * v]
}

/* ---- Light and finish --------------------------------------------------------- */

/** A soft pool of light behind the subject that separates it from the background. */
function focal(k: Kit, col: string, op: number): string {
  const rx = clamp(k.hr * 3.1, k.w * 0.24, k.w * 0.6)
  return soft(k, k.hx, k.hy + k.hr * 0.45, rx, rx * 1.15, col, op)
}

function vignette(k: Kit, col: string, op: number): string {
  const cx = lerp(k.x + k.w / 2, k.hx, 0.5)
  const cy = lerp(k.y + k.h / 2, k.hy, 0.3)
  const r = Math.hypot(k.w, k.h) * 0.58
  return fillBox(k, rad(k, `vg${col.slice(1)}${Math.round(op * 100)}`, [[0, col, 0], [0.48, col, 0], [0.8, col, op * 0.5], [1, col, op]], cx, cy, r, r))
}

/**
 * Fine print texture: light and dark specks at a few percent. The noise is rendered once
 * into a small stitched tile and repeated, which costs a fraction of a full-canvas pass.
 */
function grain(k: Kit, amt: number): string {
  if (!k.rich) return ''
  const T = Math.round(k.w / 4)
  const freq = clamp(512 / (k.w * 1.7), 0.05, 4)
  const a = f(amt)
  const fid = k.c.defs.add(`sgf${Math.round(amt * 1000)}${k.bk}`, (id) =>
    el(
      'filter',
      { id, filterUnits: 'userSpaceOnUse', x: 0, y: 0, width: T, height: T, 'color-interpolation-filters': 'sRGB' },
      el('feTurbulence', { type: 'fractalNoise', baseFrequency: f(freq), numOctaves: 2, seed: 7, stitchTiles: 'stitch', result: 'n' }),
      el('feColorMatrix', { in: 'n', type: 'matrix', values: `0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${a} 0 0 0 ${f(-amt * 0.5)}`, result: 'l' }),
      el('feColorMatrix', { in: 'n', type: 'matrix', values: `0 0 0 0 0.08 0 0 0 0 0.05 0 0 0 0 0.12 0 ${f(-amt)} 0 0 ${f(amt * 0.5)}`, result: 'd' }),
      el('feMerge', null, el('feMergeNode', { in: 'l' }), el('feMergeNode', { in: 'd' })),
    ),
  )
  const pid = k.c.defs.add(`sgp${Math.round(amt * 1000)}${k.bk}`, (id) =>
    el('pattern', { id, width: T, height: T, patternUnits: 'userSpaceOnUse', x: n1(k.x), y: n1(k.y) }, el('rect', { width: T, height: T, filter: url(fid) })),
  )
  return el('rect', { x: n1(k.x), y: n1(k.y), width: n1(k.w), height: n1(k.h), fill: url(pid) })
}

/** A band of haze lying on the horizon (or on any layer's base). */
function haze(k: Kit, key: string, yc: number, hh: number, col: string, op: number): string {
  if (op <= 0) return ''
  return el('path', { d: rect(k.x - 2, yc - hh, k.w + 4, hh * 1.6), fill: vg(k, `hz${key}`, [[0, col, 0], [0.62, col, op], [1, col, 0]], yc - hh, yc + hh * 0.6) })
}

/** Light shafts fanning out of a point, fading with distance. */
function godRays(k: Kit, key: string, rng: Rng, sx: number, sy: number, col: string, op: number, n: number, dir: number, spread: number, len: number): string {
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = dir + (i / Math.max(1, n - 1) - 0.5) * spread + rng.range(-0.05, 0.05)
    const wd = rng.range(0.012, 0.035)
    const wedge = clipToBox([[sx, sy], [sx + Math.cos(a - wd) * len, sy + Math.sin(a - wd) * len], [sx + Math.cos(a + wd) * len, sy + Math.sin(a + wd) * len]], { x: k.x - 1, y: k.y - 1, w: k.w + 2, h: k.h + 2 })
    if (wedge.length > 2) d += polyC(wedge)
  }
  return loop(k.c, 'rays', BREATHE, 7, rng.range(0, 7), paintD(d, rad(k, `gr${key}`, [[0, col, op], [0.35, col, op * 0.55], [1, col, 0]], sx, sy, len)), { timing: 'ease-in-out' })
}

/** Out-of-focus light specks. */
/** Out-of-focus light specks; in motion they drift, rise (embers, motes) or fall (snow). */
function bokeh(k: Kit, rng: Rng, n: number, cols: string[], u0: number, v0: number, u1: number, v1: number, r0: number, r1: number, op: number, mv: 'drift' | 'rise' | 'fall' = 'drift'): string {
  const g3 = buckets(3)
  let i = 0
  for (const [px, py] of scatter(k, rng, n, u0, v0, u1, v1, 1.3)) {
    const r = k.w * rng.range(r0, r1)
    g3[i++ % 3] += soft(k, px, py, r, r, rng.pick(cols), op * rng.range(0.55, 1), 'disc')
  }
  const w = k.w
  return g3
    .map((d, j) => {
      const dx = w * (0.01 + j * 0.006) * (j % 2 ? -1 : 1)
      if (mv === 'rise') return loop(k.c, `br${j}${k.bk}`, rise(dx, k.h * (0.08 + j * 0.03)), 5 + j * 1.7, j * 2.1, d)
      if (mv === 'fall') return loop(k.c, `bf${j}${k.bk}`, rise(dx, -k.h * (0.1 + j * 0.03)), 7 + j * 2.3, j * 2.9, d)
      return loop(k.c, `bd${j}${k.bk}`, drift(dx, w * (0.008 + j * 0.004)), 9 + j * 3, j * 3.3, d, { timing: 'ease-in-out' })
    })
    .join('')
}

/** Studio finish for flat backgrounds: key light behind the subject, vignette, texture. */
/**
 * Blend in OKLCH so a pair of saturated colours stays saturated in the middle. Wide hue
 * gaps route through blue-violet (dusk) rather than through olive and brown.
 */
function mixLch(a: string, b: string, t: number): string {
  const A = toLch(a)
  const B = toLch(b)
  const ha = A.c < 0.02 ? B.h : A.h
  const hb = B.c < 0.02 ? A.h : B.h
  let dh = ((((hb - ha) % 360) + 540) % 360) - 180
  if (Math.abs(dh) > 100) {
    const alt = dh > 0 ? dh - 360 : dh + 360
    const mid = (h: number) => Math.abs(((((ha + h / 2 - 280) % 360) + 540) % 360) - 180)
    if (mid(alt) < mid(dh)) dh = alt
  }
  const c = Math.max(lerp(A.c, B.c, t), Math.min(A.c, B.c) * 0.9)
  return fromLch({ l: lerp(A.l, B.l, t), c, h: (((ha + dh * t) % 360) + 360) % 360 })
}

/** Studio finish for flat backgrounds: key light behind the subject, vignette, texture. */
function studio(k: Kit, c1: string, c2: string): string {
  if (!k.hi) return ''
  const lighter = luminance(c1) >= luminance(c2) ? c1 : c2
  const darker = lighter === c1 ? c2 : c1
  const light = luminance(mixLch(c1, c2, 0.5)) > 0.4
  const lt = toLch(lighter)
  const dk = toLch(darker)
  // The key light takes the lighter colour's hue, lifted: a soft spotlight, never mud.
  const glow = light ? mix(lighter, '#fffdf8', 0.75) : fromLch({ l: Math.min(0.9, lt.l + 0.3), c: Math.min(0.08, lt.c * 0.6), h: lt.h })
  const deep = fromLch({ l: light ? Math.max(0.3, dk.l - 0.35) : 0.13, c: Math.min(0.06, dk.c), h: dk.h })
  return focal(k, glow, light ? 0.45 : 0.36) + vignette(k, deep, light ? 0.2 : 0.42) + grain(k, light ? 0.05 : 0.07)
}

/* ---- Ambient motion ------------------------------------------------------------ */
/* Stills with `ctx.motion` loop their effect-like elements through CSS keyframes: stars
 * twinkle, snow falls, bubbles and embers rise, motes drift, rays breathe, clouds sway.
 * Only opacity and transform move, on wrapper groups that carry no transform attribute,
 * and the base geometry is the still that resvg and animation frames draw. */

interface Loop {
  timing?: string
  origin?: string
  direction?: 'normal' | 'alternate'
}

/** Wraps `content` in a looping group when the render has motion. */
function loop(c: Ctx, key: string, frames: string, duration: number, phase: number, content: string, o: Loop = {}): string {
  if (!content || !c.motion) return content
  const cls = motionClass(c, `s${key}`, frames, { duration, ...o })
  return cls ? `<g class="${cls}" style="${motionPhase(phase)}">${content}</g>` : content
}

const upx = (v: number): string => `${Math.round(v * 10) / 10}px`
const TWINKLE = '0%,100%{opacity:1}50%{opacity:.3}'
const BREATHE = '0%,100%{opacity:1}50%{opacity:.55}'
const FLICKER = '0%,100%{opacity:1}44%{opacity:1}47%{opacity:.15}50%{opacity:.85}53%{opacity:.2}57%{opacity:1}'
const FLAME = '0%,100%{transform:scale(1,1)}25%{transform:scale(.93,1.09)}50%{transform:scale(1.05,.95)}75%{transform:scale(.97,1.05)}'
const sway = (dx: number, dy = 0): string => `0%,100%{transform:translate(0px,0px)}50%{transform:translate(${upx(dx)},${upx(dy)})}`
const drift = (dx: number, dy: number): string =>
  `0%,100%{transform:translate(0px,0px)}25%{transform:translate(${upx(dx)},${upx(-dy)})}50%{transform:translate(0px,${upx(-dy * 2)})}75%{transform:translate(${upx(-dx)},${upx(-dy)})}`
/** Rises (or falls, with dy < 0) and fades in and out, so the jump back to the start is invisible. */
const rise = (dx: number, dy: number): string => `0%{transform:translate(0px,0px);opacity:0}15%{opacity:1}80%{opacity:1}100%{transform:translate(${upx(dx)},${upx(-dy)});opacity:0}`

/** `n` empty strings: items go round-robin into groups so one keyframes gets phase variety. */
function buckets(n: number): string[] {
  return Array.from({ length: n }, () => '')
}

/** A box-sized clip for looping layers whose copies wait just outside the frame. */
function boxClip(k: Kit): string {
  return url(k.c.defs.add(`scb${k.bk}`, (id) => el('clipPath', { id }, el('path', { d: rect(k.x, k.y, k.w, k.h) }))))
}

/* ---- Backgrounds -------------------------------------------------------------- */

export function drawBackground(c: Ctx, box: Box): string {
  const s = c.sec('scene')
  const kind = s.s('background') || 'gradient'
  if (kind === 'none') return ''
  const k = makeKit(c, box)
  const c1 = s.c('color1', '#2b3a67')
  const c2 = s.c('color2', '#6b4a8b')
  switch (kind) {
    case 'solid': {
      if (!k.hi) return flat(k, fullD(k), c1)
      // A lit backdrop: the same colour, a touch brighter behind the subject.
      const cx = k.hx
      const cy = k.hy + k.hr * 0.6
      const r = Math.max(k.w, k.h) * 0.85
      return fillBox(k, rad(k, `so${c1.slice(1)}`, [[0, highlightOf(c1, 0.07)], [0.45, c1], [1, shadowOf(c1, 0.1)]], cx, cy, r, r * 1.05)) + studio(k, c1, c1)
    }
    case 'gradient': {
      const a = s.n('angle') * Math.PI
      const x1 = k.x + k.w * (0.5 - Math.cos(a) * 0.5)
      const y1 = k.y + k.h * (0.5 - Math.sin(a) * 0.5)
      const x2 = k.x + k.w * (0.5 + Math.cos(a) * 0.5)
      const y2 = k.y + k.h * (0.5 + Math.sin(a) * 0.5)
      // The OKLab midpoint keeps complementary pairs from going muddy in the middle.
      // The OKLCH midpoints keep complementary pairs from going muddy in the middle.
      const paint = lin(k, `gd${c1.slice(1)}${c2.slice(1)}${Math.round(a * 100)}`, [[0, c1], [0.33, mixLch(c1, c2, 0.33)], [0.67, mixLch(c1, c2, 0.67)], [1, c2]], x1, y1, x2, y2)
      return fillBox(k, paint) + studio(k, c1, c2)
    }
    case 'radial': {
      const cx = k.hx
      const cy = k.hy + k.hr * 0.35
      const r = Math.max(k.w, k.h) * 0.78
      const paint = rad(k, `rd${c1.slice(1)}${c2.slice(1)}`, [[0, k.hi ? highlightOf(c2, 0.1) : c2], [0.32, c2], [0.66, mixLch(c2, c1, 0.62)], [1, c1]], cx, cy, r, r)
      return fillBox(k, paint) + (k.hi ? soft(k, cx, cy, r * 0.42, r * 0.46, highlightOf(c2, 0.5), 0.3) + vignette(k, mix(shadowOf(c1, 0.6), '#0b0714', 0.4), 0.3) + grain(k, 0.06) : '')
    }
    case 'pattern':
      return patternBackground(k, s.s('pattern') || 'dots', c1, c2)
    case 'scene':
      return scenery(k, s.s('preset') || 'sky')
  }
  return ''
}

/* ---- Patterns ----------------------------------------------------------------- */

function patternBackground(k: Kit, kind: string, c1: string, c2: string): string {
  const P = k.P
  const base = k.hi
    ? fillBox(k, rad(k, `pb${c1.slice(1)}`, [[0, highlightOf(c1, 0.08)], [0.5, c1], [1, shadowOf(c1, 0.1)]], k.hx, k.hy + k.hr * 0.5, Math.max(k.w, k.h) * 0.85))
    : flat(k, fullD(k), c1)
  let motif = ''
  if (kind === 'rays') {
    // A sunburst centred on the subject: calm behind the head, strongest at the edges.
    const cx = k.hx
    const cy = k.hy + k.hr * 0.2
    const R = Math.hypot(k.w, k.h) * 1.1
    let d = ''
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * TAU + 0.1
      const a1 = a0 + Math.PI / 16
      // Clipped to the box: geometry far off-canvas inside the frame's clip can crash resvg.
      const wedge = clipToBox([[cx, cy], [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R], [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R]], { x: k.x - 1, y: k.y - 1, w: k.w + 2, h: k.h + 2 })
      if (wedge.length > 2) d += polyC(wedge)
    }
    motif = k.hi
      ? paintD(d, rad(k, `ry${c2.slice(1)}`, [[0, c2, 0], [0.12, c2, 0.18], [0.45, c2, 0.5], [1, c2, 0.7]], cx, cy, Math.max(k.w, k.h) * 0.75)) + soft(k, cx, cy, k.w * 0.4, k.w * 0.4, highlightOf(mixLch(c1, c2, 0.5), 0.6), 0.4)
      : flat(k, d, c2, 0.55)
  } else {
    const id = patternTile(k, kind, c2)
    motif = el('path', { d: rect(k.x, k.y, k.w, k.h), fill: url(id), 'fill-opacity': k.hi ? 0.5 : 0.55, mask: k.hi ? url(calmMask(k)) : undefined })
  }
  void P
  return base + motif + studio(k, c1, c2)
}

/** Luminance mask that fades busy detail behind the head. */
function calmMask(k: Kit): string {
  return k.c.defs.add(`scm${k.bk}`, (id) => {
    const r = clamp(k.hr * 3.4, k.w * 0.3, k.w * 0.75)
    const paint = rad(k, 'cm', [[0, '#ffffff', 0.22], [0.45, '#ffffff', 0.5], [1, '#ffffff', 1]], k.hx, k.hy + k.hr * 0.3, r, r * 1.15, true)
    return el('mask', { id, maskUnits: 'userSpaceOnUse', x: n1(k.x), y: n1(k.y), width: n1(k.w), height: n1(k.h) }, el('rect', { x: n1(k.x), y: n1(k.y), width: n1(k.w), height: n1(k.h), fill: paint }))
  })
}

function patternTile(k: Kit, kind: string, col: string): string {
  const P = k.P
  const s = k.w / 9
  const emb = k.hi
  return k.c.defs.add(`sp${kind}${col.slice(1)}${emb ? 'e' : ''}${k.bk}`, (pid) => {
    const fill = P.col(col)
    const dark = P.col(shadowOf(col, 0.7))
    const lite = P.col(highlightOf(col, 0.6))
    const ox = -k.L[0] * s * 0.035
    const oy = -k.L[1] * s * 0.035
    const sh = (body: string) => (emb ? `<g transform="translate(${f(ox)} ${f(oy)})" fill="${dark}" stroke="${dark}" fill-opacity="0.35" stroke-opacity="0.35">${body}</g>` : '')
    let body = ''
    switch (kind) {
      case 'dots': {
        const d = circle(s / 2, s / 2, s * 0.16)
        body = sh(el('path', { d })) + el('path', { d, fill })
        if (emb) body += el('path', { d: circle(s / 2 + k.L[0] * s * 0.05, s / 2 + k.L[1] * s * 0.05, s * 0.07), fill: lite, 'fill-opacity': 0.55 })
        break
      }
      case 'stripes':
        body = el('rect', { x: 0, y: 0, width: s, height: s / 2, fill })
        if (emb) body += el('rect', { x: 0, y: 0, width: s, height: s * 0.05, fill: lite, 'fill-opacity': 0.4 }) + el('rect', { x: 0, y: s * 0.45, width: s, height: s * 0.05, fill: dark, 'fill-opacity': 0.3 })
        break
      case 'checker': {
        const q = s / 2
        body = el('rect', { x: 0, y: 0, width: q, height: q, fill }) + el('rect', { x: q, y: q, width: q, height: q, fill })
        if (emb)
          for (const [bx, by] of [[0, 0], [q, q]])
            body +=
              el('path', { d: `M${f(bx)} ${f(by)}h${f(q)}l${f(-q * 0.08)} ${f(q * 0.08)}h${f(-q * 0.84)}v${f(q * 0.84)}l${f(-q * 0.08)} ${f(q * 0.08)}Z`, fill: lite, 'fill-opacity': 0.35 }) +
              el('path', { d: `M${f(bx + q)} ${f(by + q)}h${f(-q)}l${f(q * 0.08)} ${f(-q * 0.08)}h${f(q * 0.84)}v${f(-q * 0.84)}l${f(q * 0.08)} ${f(-q * 0.08)}Z`, fill: dark, 'fill-opacity': 0.3 })
        break
      }
      case 'grid': {
        const d = `M0 0H${f(s)}M0 0V${f(s)}`
        body = sh(el('path', { d, 'stroke-width': f(s * 0.06), fill: 'none' })) + el('path', { d, stroke: fill, 'stroke-width': f(s * 0.06), fill: 'none' })
        break
      }
      case 'stars': {
        const d = star(s / 2, s / 2, s * 0.22, s * 0.09)
        body = sh(el('path', { d })) + el('path', { d, fill, 'stroke-linejoin': 'round' })
        if (emb) body += el('path', { d: star(s / 2 + k.L[0] * s * 0.03, s / 2 + k.L[1] * s * 0.03, s * 0.1, s * 0.04), fill: lite, 'fill-opacity': 0.45 })
        break
      }
      case 'hearts': {
        const d = heart(s / 2, s / 2, s * 0.18)
        body = sh(el('path', { d })) + el('path', { d, fill })
        if (emb) body += el('path', { d: ellipse(s / 2 - s * 0.07, s * 0.44, s * 0.045, s * 0.03), fill: lite, 'fill-opacity': 0.6 })
        break
      }
      case 'confetti': {
        const pieces = [roundRect(s * 0.2, s * 0.2, s * 0.14, s * 0.06, 2), roundRect(s * 0.62, s * 0.55, s * 0.06, s * 0.16, 2), circle(s * 0.35, s * 0.75, s * 0.05)]
        const cols = emb ? [fill, P.col(hueShift(col, 38)), P.col(hueShift(col, -38))] : [fill, fill, fill]
        body = sh(el('path', { d: pieces.join('') })) + pieces.map((d, i) => el('path', { d, fill: cols[i] })).join('')
        break
      }
      case 'zigzag': {
        const d = `M0 ${f(s * 0.6)}L${f(s / 4)} ${f(s * 0.35)}L${f(s / 2)} ${f(s * 0.6)}L${f((s * 3) / 4)} ${f(s * 0.35)}L${f(s)} ${f(s * 0.6)}`
        body = sh(el('path', { d, 'stroke-width': f(s * 0.08), fill: 'none' })) + el('path', { d, stroke: fill, 'stroke-width': f(s * 0.08), fill: 'none', 'stroke-linejoin': 'round' })
        break
      }
      case 'waves': {
        const d = `M0 ${f(s / 2)}Q${f(s / 4)} ${f(s * 0.3)} ${f(s / 2)} ${f(s / 2)}T${f(s)} ${f(s / 2)}`
        body = sh(el('path', { d, 'stroke-width': f(s * 0.08), fill: 'none' })) + el('path', { d, stroke: fill, 'stroke-width': f(s * 0.08), fill: 'none' })
        if (emb) body += el('path', { d, stroke: lite, 'stroke-width': f(s * 0.025), fill: 'none', 'stroke-opacity': 0.5, transform: `translate(0 ${f(-s * 0.018)})` })
        break
      }
      case 'hex': {
        const d = poly(regularPts(s / 2, s / 2, s * 0.42, 6, 0))
        body = sh(el('path', { d, 'stroke-width': f(s * 0.05), fill: 'none' })) + el('path', { d, stroke: fill, 'stroke-width': f(s * 0.05), fill: 'none' })
        break
      }
    }
    return el('pattern', { id: pid, width: f(s), height: f(s), patternUnits: 'userSpaceOnUse', x: f(k.x), y: f(k.y) }, body)
  })
}

/* ---- Scenery: shared pieces ----------------------------------------------------- */

interface Puff {
  x: number
  y: number
  r: number
}

/** A flat-bottomed cumulus: puffs along a base, biggest in the middle. */
function cumulus(rng: Rng, cx: number, cy: number, s: number, stretch = 1): Puff[] {
  const n = rng.int(4, 6)
  const out: Puff[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const r = s * (0.36 + 0.46 * Math.sin(Math.PI * (0.12 + t * 0.76))) * rng.range(0.85, 1.12)
    out.push({ x: cx + (t - 0.5) * s * 2.1 * stretch + rng.range(-0.06, 0.06) * s, y: cy + s * 0.28 - r, r })
  }
  // A second, smaller row on top of the biggest puffs makes the silhouette climb.
  const top = out[Math.floor(n / 2)]
  out.push({ x: top.x + rng.range(-0.3, 0.3) * s, y: top.y - top.r * 0.45, r: top.r * rng.range(0.55, 0.7) })
  return out
}

function cloudBase(cx: number, cy: number, s: number, stretch: number): string {
  return roundRect(cx - s * 1.08 * stretch, cy - s * 0.05, s * 2.16 * stretch, s * 0.33, s * 0.16)
}

interface CloudSpec {
  x: number
  y: number
  s: number
  stretch?: number
}

/** One cloud's geometry: the silhouette and the lit, rim and belly layers inside it. */
interface CloudShape {
  body: string
  lit: string
  rim: string
  belly: string
  s: number
  box: Box
}

/** Cumulus lit from `toLight`: puffs shifted toward the light make the lit body. */
function cumulusShape(rng: Rng, sp: CloudSpec, toLight: P): CloudShape {
  const st = sp.stretch ?? 1
  const puffs = cumulus(rng, sp.x, sp.y, sp.s, st)
  const shift = sp.s * 0.16
  let body = cloudBase(sp.x, sp.y, sp.s, st)
  let lit = cloudBase(sp.x + toLight[0] * shift, sp.y + toLight[1] * shift * 1.4, sp.s * 0.97, st)
  let rim = ''
  for (const p of puffs) {
    body += dot(p.x, p.y, p.r)
    lit += dot(p.x + toLight[0] * shift, p.y + toLight[1] * shift, p.r * 0.97)
    rim += dot(p.x + toLight[0] * p.r * 0.34, p.y + toLight[1] * p.r * 0.34, p.r * 0.58)
  }
  return { body, lit, rim, belly: ellipse(sp.x, sp.y + sp.s * 0.3, sp.s * 1.2 * st, sp.s * 0.26), s: sp.s, box: boxOf(sp.x - sp.s * 1.35 * st, sp.y - sp.s * 1.1, sp.x + sp.s * 1.35 * st, sp.y + sp.s * 0.6) }
}

/** A long streak of cloud (sunset, dusk): a spindle lit along its underside. */
function streakShape(rng: Rng, sp: CloudSpec): CloudShape {
  const len = sp.s * 2.2 * (sp.stretch ?? 2.4)
  const t = sp.s * 0.42
  const spindle = (cx: number, cy: number, L: number, T: number): [string, string, string] => {
    const n = 7
    const top: SP[] = []
    const bot: SP[] = []
    for (let i = 1; i < n; i++) {
      const u = i / n
      const hump = Math.pow(Math.sin(Math.PI * u), 0.75)
      top.push([cx - L / 2 + u * L, cy - T * hump * rng.range(0.65, 1.15)])
      bot.push([cx - L / 2 + u * L, cy + T * 0.28 * Math.pow(Math.sin(Math.PI * u), 1.3)])
    }
    const tipL: SP = [cx - L / 2, cy, 0.3]
    const tipR: SP = [cx + L / 2, cy + T * 0.05, 0.3]
    const body = smooth([tipL, ...top, tipR, ...bot.slice().reverse()])
    const shifted = smooth([tipL, ...top, tipR, ...bot.slice().reverse()].map((p) => [p[0], p[1] + T * 0.55, p.length > 2 ? (p as number[])[2] : 1] as SP))
    return [body, shifted, smooth([tipL, ...bot, tipR], false)]
  }
  const a = spindle(sp.x, sp.y, len, t)
  const b = spindle(sp.x + rng.range(-0.25, 0.25) * len, sp.y - t * rng.range(0.9, 1.4), len * rng.range(0.4, 0.6), t * 0.7)
  return { body: a[0] + b[0], lit: a[1] + b[1], rim: a[2] + b[2], belly: '', s: sp.s, box: boxOf(sp.x - len * 0.62, sp.y - t * 2.8, sp.x + len * 0.62, sp.y + t * 0.9) }
}

/**
 * A layer of clouds, cel-lit: a shaded body with the lit body clipped inside it. Baked:
 * a soft terminator, a darker belly and a bright rim.
 */
function cloudLayer(k: Kit, key: string, shapes: CloudShape[], pal: { lit: string; shade: string; belly?: string; rim?: string }, op = 1, rimStroke = false): string {
  if (!shapes.length) return ''
  let body = ''
  let lit = ''
  let belly = ''
  let rim = ''
  let sAvg = 0
  let bb: Box | null = null
  for (const s of shapes) {
    body += s.body
    lit += s.lit
    belly += s.belly
    rim += s.rim
    sAvg += s.s / shapes.length
    bb = unite(bb, s.box)
  }
  const clip = k.c.defs.add(`scl${key}${k.bk}`, (id) => el('clipPath', { id }, el('path', { d: body })))
  const P = k.P
  // Clouds sway very slowly; small (far) ones less.
  const drifting = (svg: string) => loop(k.c, `cl${key}${k.bk}`, sway(k.w * clamp(sAvg / k.w, 0.01, 0.03)), 38 + (hash32(key) % 17), hash32(key, 1) % 30, svg, { timing: 'ease-in-out' })
  if (!k.hi) return drifting(flat(k, body, pal.shade, op) + g({ 'clip-path': url(clip) }, flat(k, lit, pal.lit, op), rimStroke && pal.rim ? strokeD(k, rim, pal.rim, sAvg * 0.08, op) : ''))
  return drifting(
    flat(k, body, pal.shade, op) +
    g(
      { 'clip-path': url(clip) },
      // One blur pass softens the terminator, the rim light and the belly together.
      g(
        { filter: blur(k, sAvg * (rimStroke ? 0.05 : 0.075), bb ?? undefined) },
        paintD(lit, P.col(pal.lit), op),
        pal.rim ? (rimStroke ? strokeD(k, rim, pal.rim, sAvg * 0.16, op) : paintD(rim, P.col(pal.rim), op * 0.7)) : '',
        pal.belly && belly ? paintD(belly, P.col(pal.belly), op * 0.55) : '',
      ),
    ),
  )
}

/** Cloud placements across the upper sky, kept off the head and inside the box. */
function cloudSpots(k: Kit, rng: Rng, n: number, v0: number, v1: number, s0: number, s1: number, stretch = 1): CloudSpec[] {
  const out: CloudSpec[] = []
  for (let tries = 0; out.length < n && tries < n * 10; tries++) {
    const s = k.w * rng.range(s0, s1)
    const px = k.x + k.w * rng.range(0.06, 0.94)
    const py = Math.max(k.y + (k.hz - k.y) * rng.range(v0, v1), k.y + s * 0.95 + k.h * 0.015)
    if (calm(k, px, py, 1 + s / k.hr) < 0.5) continue
    if (out.some((o) => Math.abs(o.x - px) < (o.s + s) * 1.3 * stretch && Math.abs(o.y - py) < (o.s + s) * 0.7)) continue
    out.push({ x: px, y: py, s, stretch })
  }
  return out
}

const cumuli = (rng: Rng, specs: CloudSpec[], toLight: P): CloudShape[] => specs.map((s) => cumulusShape(rng, s, toLight))

/** Ridge line across the box: the closed fill path, the open top line, and its height at x. */
function ridge(k: Kit, seed: number, baseY: number, amp: number, freq: number, n = 12): [string, string, (x: number) => number] {
  const x0 = k.x - k.w * 0.03
  const span = k.w * 1.06
  const at = (t: number) => baseY - amp * (0.5 + 0.5 * fbm1(seed, t * freq + 3.7, 3))
  const top: SP[] = []
  for (let i = 0; i <= n; i++) top.push([x0 + (i / n) * span, at(i / n)])
  const bottom = k.y + k.h + 4
  const fillD = smooth([[x0, bottom, 0], ...top, [x0 + span, bottom, 0]] as SP[])
  return [fillD, smooth(top, false), (px: number) => at((px - x0) / span)]
}

/** Mountains with a lit and a shaded face, and optional snow caps. */
function mountains(
  k: Kit,
  rng: Rng,
  baseY: number,
  peaks: { u: number; hh: number; ww: number }[],
  pal: { lit: string; shade: string; snow?: string; snowShade?: string },
  op = 1,
): string {
  let shadeD = ''
  let litD = ''
  let snowD = ''
  let snowLitD = ''
  const sd = k.side
  for (const pk of peaks) {
    const px = k.x + k.w * pk.u
    const py = baseY - pk.hh
    const hw = pk.ww
    const jag = (t: number) => rng.range(-0.04, 0.04) * pk.hh * t
    const left: P[] = [[px - hw, baseY + 2], [px - hw * 0.62, baseY - pk.hh * 0.38 + jag(1)], [px - hw * 0.28, baseY - pk.hh * 0.74 + jag(1)]]
    const right: P[] = [[px + hw * 0.3, baseY - pk.hh * 0.72 + jag(1)], [px + hw * 0.64, baseY - pk.hh * 0.36 + jag(1)], [px + hw, baseY + 2]]
    shadeD += polyC([...left, [px, py], ...right])
    // The face toward the light, split from the peak down a crooked spine.
    const spine: P[] = [[px, py], [px - sd * hw * 0.06, baseY - pk.hh * 0.55], [px + sd * hw * 0.04, baseY - pk.hh * 0.25], [px - sd * hw * 0.1, baseY + 2]]
    const litSide = sd < 0 ? left : right.slice().reverse()
    litD += polyC([...litSide, [px, py], ...spine.slice(1).reverse()])
    if (pal.snow) {
      const t = 0.34
      const ly = py + pk.hh * t
      const lx = px - hw * t * 0.95
      const rx = px + hw * t * 0.95
      const edge: P[] = []
      for (let i = 0; i <= 5; i++) {
        const u = i / 5
        edge.push([lerp(rx, lx, u), ly + (i % 2 ? -pk.hh * 0.07 : pk.hh * 0.02) + jag(0.5)])
      }
      snowD += polyC([[px, py], ...edge])
      const half = edge.filter((p) => (p[0] - px) * sd >= -hw * 0.05)
      snowLitD += polyC([[px, py], ...(sd < 0 ? half.slice().reverse() : half), [px - sd * hw * 0.04, ly - pk.hh * 0.04]])
    }
  }
  return flat(k, shadeD, pal.shade, op) + flat(k, litD, pal.lit, op) + (pal.snow ? flat(k, snowD, pal.snowShade ?? pal.snow, op) + flat(k, snowLitD, pal.snow, op) : '')
}

interface Tree {
  x: number
  base: number
  hh: number
}

/** Pines: stacked tiers, lit on the light side, optionally snow-capped. */
function pines(k: Kit, trees: Tree[], pal: { lit: string; shade: string; trunk?: string; snow?: string }, op = 1, twoTone = true): string {
  let shadeD = ''
  let litD = ''
  let snowD = ''
  let trunkD = ''
  const sd = k.side
  for (const t of trees) {
    const H = t.hh
    const tiers = H > k.h * 0.18 ? 4 : 3
    const top = t.base - H
    for (let i = 0; i < tiers; i++) {
      const ay = top + (i / tiers) * H * 0.62
      const by = ay + H * (0.34 + i * 0.03)
      const hw = H * 0.3 * (0.42 + (0.58 * (i + 1)) / tiers)
      const tier: P[] = [[t.x, ay], [t.x + hw, by], [t.x + hw * 0.45, by - H * 0.035], [t.x, by + H * 0.012], [t.x - hw * 0.45, by - H * 0.035], [t.x - hw, by]]
      shadeD += polyC(tier)
      if (twoTone) litD += polyC([[t.x, ay], [t.x + sd * hw, by], [t.x + sd * hw * 0.45, by - H * 0.035], [t.x + sd * hw * 0.08, by + H * 0.01]])
      if (pal.snow) snowD += polyC([[t.x, ay], [t.x + hw * 0.5, ay + (by - ay) * 0.5], [t.x + hw * 0.18, ay + (by - ay) * 0.4], [t.x, ay + (by - ay) * 0.52], [t.x - hw * 0.22, ay + (by - ay) * 0.42], [t.x - hw * 0.52, ay + (by - ay) * 0.5]])
    }
    if (pal.trunk) trunkD += rect(t.x - H * 0.03, t.base - H * 0.14, H * 0.06, H * 0.15)
  }
  return (pal.trunk ? flat(k, trunkD, pal.trunk, op) : '') + flat(k, shadeD, pal.shade, op) + flat(k, litD, pal.lit, op) + (pal.snow ? flat(k, snowD, pal.snow, op) : '')
}

/** A row of trees along a baseline, sparser behind the head. */
function treeRow(k: Kit, rng: Rng, n: number, base: number, h0: number, h1: number, u0 = -0.04, u1 = 1.04, reach = 1.2): Tree[] {
  const out: Tree[] = []
  for (let i = 0; i < n; i++) {
    const u = lerp(u0, u1, (i + rng.range(0.1, 0.9)) / n)
    const px = k.x + k.w * u
    const hh = k.h * rng.range(h0, h1)
    const cm = calm(k, px, base - hh * 0.6, reach)
    if (rng.next() > 0.35 + cm) continue
    out.push({ x: px, base: base + rng.range(-0.01, 0.01) * k.h, hh: hh * (0.75 + 0.25 * cm) })
  }
  return out
}

/** Stars of varied size: dim specks, soft glows and a few four-point sparkles. */
function starField(k: Kit, rng: Rng, n: number, vMax: number, col: string): string {
  let dim = ''
  const mid = buckets(3)
  const count = k.hi ? n : Math.round(n * 0.45)
  let i = 0
  for (const [px, py] of scatter(k, rng, count, 0, 0, 1, vMax, 0.8)) {
    const r = k.w * rng.range(0.0012, 0.0032)
    if (rng.chance(0.3)) mid[i++ % 3] += dot(px, py, r * 1.25)
    else dim += dot(px, py, r)
  }
  const out = flat(k, dim, col, 0.55) + mid.map((d, j) => loop(k.c, `tw${j}`, TWINKLE, 2.6 + j * 1.1, j * 1.3, flat(k, d, col, 0.95), { timing: 'ease-in-out' })).join('')
  if (k.lo) return out
  const sp = buckets(3)
  const glow = buckets(3)
  i = 0
  for (const [px, py] of scatter(k, rng, k.hi ? 9 : 4, 0.02, 0.02, 0.98, vMax * 0.9, 1.4)) {
    const r = k.w * rng.range(0.009, 0.018)
    if (k.hi) glow[i % 3] += soft(k, px, py, r * 1.6, r * 1.6, col, 0.55, 'core')
    sp[i++ % 3] += sparkle(px, py, r, 0.12)
  }
  return out + sp.map((d, j) => loop(k.c, `ts${j}`, TWINKLE, 3.4 + j * 1.3, j * 1.7, glow[j] + flat(k, d, col, 0.95), { timing: 'ease-in-out' })).join('')
}

/** Grass tufts on the ground plane, bigger toward the viewer. */
function tufts(k: Kit, rng: Rng, n: number, top: number, col: string, lite: string): string {
  let dk = ''
  let lt = ''
  for (let i = 0; i < n; i++) {
    const t = rng.next()
    const py = lerp(top + k.h * 0.02, k.y + k.h, Math.sqrt(t))
    const px = k.x + k.w * rng.range(0, 1)
    if (Math.abs(px - k.hx) < k.w * 0.12 && py > k.y + k.h * 0.85 && k.ground) continue
    const s = k.h * lerp(0.012, 0.035, t)
    let d = ''
    for (let b = -2; b <= 2; b++) {
      const bx = px + b * s * 0.35
      const tip: P = [bx + b * s * 0.3 + rng.range(-0.2, 0.2) * s, py - s * rng.range(0.8, 1.5)]
      d += polyC([[bx - s * 0.12, py], tip, [bx + s * 0.12, py]])
    }
    if (rng.chance(0.5)) dk += d
    else lt += d
  }
  return flat(k, dk, col, 0.55) + flat(k, lt, lite, 0.5)
}

/** A few distant birds. */
function birds(k: Kit, rng: Rng, n: number, col: string): string {
  let d = ''
  for (const [px, py] of scatter(k, rng, n * 3, 0.08, 0.1, 0.92, 0.4, 1.6).slice(0, n)) {
    const s = k.w * rng.range(0.008, 0.014)
    d += `M${n1(px - s)} ${n1(py - s * 0.3)}Q${n1(px - s * 0.4)} ${n1(py - s * 0.55)} ${n1(px)} ${n1(py)}Q${n1(px + s * 0.4)} ${n1(py - s * 0.55)} ${n1(px + s)} ${n1(py - s * 0.3)}`
  }
  return strokeD(k, d, col, k.w * 0.0025, 0.7)
}

/** The ground plane from its top edge to the bottom of the box. */
function groundPlane(k: Kit, key: string, seed: number, top: string, bottom: string, amp = 0.012): string {
  const [d] = ridge(k, seed, k.gt, k.h * amp, 1.6, 8)
  return paintD(d, vg(k, `gp${key}`, [[0, top], [1, bottom]], k.gt - k.h * amp, k.y + k.h))
}

/* ---- Scenery: presets ----------------------------------------------------------- */

/** Per-preset finish for baked stills: key light behind the subject, then a vignette. */
const FINISH: Record<string, [string, number, string, number]> = {
  sky: ['#fffdf2', 0.24, '#1d4f8a', 0.18],
  meadow: ['#fff6dc', 0.24, '#2f5a2a', 0.16],
  sunset: ['#ffc890', 0.22, '#1a0a26', 0.36],
  night: ['#6f86d0', 0.3, '#02040f', 0.45],
  forest: ['#fff6d6', 0.26, '#1c3a26', 0.26],
  beach: ['#fffbe8', 0.2, '#1a5a8a', 0.16],
  city: ['#d07aa0', 0.26, '#07051a', 0.42],
  snow: ['#ffffff', 0.28, '#4a6a9a', 0.2],
  space: ['#7a6ad8', 0.3, '#010108', 0.45],
  underwater: ['#8fe0ff', 0.24, '#021228', 0.42],
  dungeon: ['#9a86b8', 0.24, '#07050a', 0.55],
  stage: ['#fff0c8', 0, '#07020a', 0.45],
  volcano: ['#ff9a5a', 0.2, '#0a0204', 0.42],
  candy: ['#ffffff', 0.32, '#b0609a', 0.14],
}

/** Procedural landscapes. Seeded by the avatar, so every avatar gets its own sky. */
function scenery(k: Kit, preset: string): string {
  const rng = k.c.rng(`scene:${preset}`)
  let o: string
  switch (preset) {
    case 'sunset':
      o = sunsetScene(k, rng)
      break
    case 'night':
      o = nightScene(k, rng)
      break
    case 'forest':
      o = forestScene(k, rng)
      break
    case 'meadow':
      o = meadowScene(k, rng)
      break
    case 'beach':
      o = beachScene(k, rng)
      break
    case 'city':
      o = cityScene(k, rng)
      break
    case 'snow':
      o = snowScene(k, rng)
      break
    case 'space':
      o = spaceScene(k, rng)
      break
    case 'underwater':
      o = underwaterScene(k, rng)
      break
    case 'dungeon':
      o = dungeonScene(k, rng)
      break
    case 'stage':
      o = stageScene(k, rng)
      break
    case 'volcano':
      o = volcanoScene(k, rng)
      break
    case 'candy':
      o = candyScene(k, rng)
      break
    default:
      o = skyScene(k, rng)
      preset = 'sky'
  }
  const fin = FINISH[preset]
  if (k.hi && fin) o += (fin[1] > 0 ? focal(k, fin[0], fin[1]) : '') + vignette(k, fin[2], fin[3])
  return o
}

function skyScene(k: Kit, rng: Rng): string {
  const { w, h, y, hz } = k
  const [sx, sy] = sunAt(k, 0.12)
  let o = fillBox(k, vg(k, 'sky', [[0, '#3a84de'], [0.55, '#76bbf5'], [1, '#d6eeff']], y, hz))
  o += soft(k, sx, sy, w * 0.5, w * 0.5, '#fff4cf', k.hi ? 0.6 : 0.45)
  if (k.hi) o += godRays(k, 'sky', rng.fork('rays'), sx, sy, '#fffbe6', 0.14, 7, Math.atan2(hz - sy, k.hx - sx), 1.1, w * 1.2)
  o += flat(k, circle(sx, sy, w * 0.04), '#fffbea') + (k.hi ? soft(k, sx, sy, w * 0.1, w * 0.1, '#ffffff', 0.7, 'core') : '')
  const cr = rng.fork('clouds')
  o += cloudLayer(k, 'skyfar', cumuli(cr, cloudSpots(k, cr, 3, 0.62, 0.86, 0.03, 0.045), k.L), { lit: '#f4f9ff', shade: '#c9ddf2', rim: '#ffffff' }, 0.8)
  o += cloudLayer(k, 'sky', cumuli(cr, cloudSpots(k, cr, k.lo ? 2 : 3, 0.12, 0.5, 0.06, 0.1), k.L), { lit: '#ffffff', shade: '#bcd2ee', rim: '#ffffff' })
  if (k.hi) o += birds(k, rng.fork('birds'), 3, '#3d5f86')
  const [far] = ridge(k, rng.int(0, 1e6), hz - h * 0.01, h * 0.1, 2.2)
  const [mid, midTop] = ridge(k, rng.int(0, 1e6), hz + h * 0.025, h * 0.06, 1.8)
  o += flat(k, far, mix('#5f9fae', '#d6eeff', 0.45)) + flat(k, mid, mix('#63ad6a', '#cfe9f5', 0.28))
  if (k.hi) o += strokeD(k, midTop, '#d8f2c0', h * 0.004, 0.5) + haze(k, 'sky', hz + h * 0.015, h * 0.06, '#e4f3ff', 0.42)
  o += groundPlane(k, 'sky', rng.int(0, 1e6), '#8fd07a', '#4f9a4c')
  if (k.hi) o += tufts(k, rng.fork('tufts'), 26, k.gt, '#3f8a42', '#a6de86')
  return o
}

function meadowScene(k: Kit, rng: Rng): string {
  const { w, h, y, hz } = k
  const [sx, sy] = sunAt(k, 0.14)
  let o = fillBox(k, vg(k, 'mdw', [[0, '#4d9bec'], [0.6, '#a2d5fa'], [1, '#fff1d2']], y, hz))
  o += soft(k, sx, sy, w * 0.6, w * 0.55, '#fff0c2', k.hi ? 0.7 : 0.5)
  o += flat(k, circle(sx, sy, w * 0.038), '#fffbe8') + (k.hi ? soft(k, sx, sy, w * 0.1, w * 0.1, '#fffdf0', 0.7, 'core') : '')
  const cr = rng.fork('clouds')
  o += cloudLayer(k, 'mdw', cumuli(cr, cloudSpots(k, cr, 2, 0.12, 0.5, 0.06, 0.09), k.L), { lit: '#fffdf6', shade: '#c9d8ef', rim: '#ffffff' })
  const [far] = ridge(k, rng.int(0, 1e6), hz, h * 0.08, 1.5)
  o += flat(k, far, mix('#79b784', '#fff1d2', 0.45))
  if (k.hi) {
    // Round trees dotted along the far hills.
    let d = ''
    let lt = ''
    const tr = rng.fork('ftrees')
    for (const [px] of scatter(k, tr, 10, 0, 0, 1, 1, 1.2)) {
      const r = w * tr.range(0.012, 0.022)
      const py = hz - h * 0.035 + tr.range(-0.01, 0.02) * h
      d += dot(px, py, r) + dot(px + r * 0.7, py + r * 0.25, r * 0.75)
      lt += dot(px + k.L[0] * r * 0.3, py + k.L[1] * r * 0.3, r * 0.7)
    }
    o += flat(k, d, mix('#4f8f55', '#fff1d2', 0.35)) + flat(k, lt, mix('#78b36a', '#fff1d2', 0.35))
  }
  const [mid, midTop] = ridge(k, rng.int(0, 1e6), hz + h * 0.035, h * 0.05, 1.4)
  o += flat(k, mid, mix('#6fbf5a', '#fff1d2', 0.15))
  if (k.hi) o += strokeD(k, midTop, '#d8f5a8', w * 0.004, 0.6) + haze(k, 'mdw', hz + h * 0.02, h * 0.06, '#fff4da', 0.5)
  o += groundPlane(k, 'mdw', rng.int(0, 1e6), '#96d676', '#58a847')
  // Flowers: bigger toward the viewer.
  const fr = rng.fork('flowers')
  const cols = ['#fff27a', '#ffffff', '#ff9fc4', '#ffc46b']
  const buckets: string[] = ['', '', '', '']
  let centres = ''
  const nF = k.hi ? 70 : k.lo ? 10 : 22
  for (let i = 0; i < nF; i++) {
    const t = fr.next()
    const py = lerp(k.gt + h * 0.01, y + h, t * t * 0.6 + t * 0.4)
    const px = k.x + w * fr.next()
    if (k.ground && Math.abs(px - k.hx) < w * 0.08 && py > -h * 0.06) continue
    const r = w * lerp(0.004, 0.012, t)
    const ci = fr.int(0, 3)
    if (k.hi && r > w * 0.006) {
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * TAU + t
        buckets[ci] += dot(px + Math.cos(a) * r * 0.8, py + Math.sin(a) * r * 0.55, r * 0.6)
      }
      centres += dot(px, py, r * 0.45)
    } else buckets[ci] += dot(px, py, r)
  }
  buckets.forEach((d, i) => (o += flat(k, d, cols[i], 0.95)))
  o += flat(k, centres, '#e8a23a')
  if (k.hi) o += tufts(k, rng.fork('tufts'), 22, k.gt, '#3f9340', '#b5e68c') + bokeh(k, rng.fork('pollen'), 10, ['#fff6c8'], 0, 0.3, 1, 0.9, 0.004, 0.01, 0.5)
  return o
}

function sunsetScene(k: Kit, rng: Rng): string {
  const { w, h, y, hz } = k
  const sx = sunAt(k, 0)[0]
  const sy = hz - h * 0.035
  let o = fillBox(k, vg(k, 'sun', [[0, '#26184f'], [0.32, '#5e3585'], [0.6, '#cf5a7c'], [0.82, '#ff9460'], [1, '#ffcf78']], y, hz))
  o += soft(k, sx, sy, w * 0.75, h * 0.5, '#ffb46a', k.hi ? 0.65 : 0.5)
  o += soft(k, sx, sy, w * 0.26, w * 0.24, '#ffe3a0', 0.85)
  if (k.hi) o += godRays(k, 'sun', rng.fork('rays'), sx, sy, '#ffe0a8', 0.18, 9, -Math.PI / 2, 2.6, h * 0.95)
  o += flat(k, circle(sx, sy, w * 0.075), '#ffe39a') + (k.hi ? flat(k, circle(sx, sy, w * 0.058), '#fff3cf', 0.7) : '')
  // Long streaks of cloud, lit from underneath by the low sun.
  const cr = rng.fork('clouds')
  const streaks = cloudSpots(k, cr, k.lo ? 2 : 4, 0.1, 0.62, 0.05, 0.075, 2.2).map((s) => streakShape(cr, s))
  o += cloudLayer(k, 'sun', streaks, { lit: '#ff9f86', shade: '#6e3a82', rim: '#ffd9a6' }, 0.95, true)
  if (k.hi) o += birds(k, rng.fork('birds'), 4, '#3a1a45')
  const [far, farTop] = ridge(k, rng.int(0, 1e6), hz + h * 0.005, h * 0.11, 2.4)
  o += flat(k, far, mix('#7e3f78', '#ff9a70', 0.35))
  if (k.hi) o += strokeD(k, farTop, '#ffc08a', w * 0.004, 0.55) + haze(k, 'sun', hz + h * 0.01, h * 0.06, '#ff9e74', 0.45)
  const [mid, midTop] = ridge(k, rng.int(0, 1e6), hz + h * 0.04, h * 0.07, 1.7)
  o += flat(k, mid, '#4e2458')
  if (k.hi) o += strokeD(k, midTop, '#ff9a7a', w * 0.003, 0.4)
  o += groundPlane(k, 'sun', rng.int(0, 1e6), '#3a1b45', '#1d0c26')
  if (k.hi) o += soft(k, sx, k.gt + h * 0.02, w * 0.55, h * 0.08, '#ff9a70', 0.28)
  if (k.hi) o += tufts(k, rng.fork('tufts'), 18, k.gt, '#140818', '#5a2a55') + bokeh(k, rng.fork('b'), 8, ['#ffc38a', '#ff8fa0'], 0, 0.55, 1, 0.8, 0.004, 0.009, 0.45)
  return o
}

function nightScene(k: Kit, rng: Rng): string {
  const { w, h, y, hz } = k
  const [mx, my] = sunAt(k, 0.17)
  let o = fillBox(k, vg(k, 'nt', [[0, '#060a22'], [0.5, '#121e4b'], [0.85, '#29396f'], [1, '#3d4f88']], y, hz))
  if (k.hi) {
    // Milky way: a faint diagonal band of light and dust, away from the moon.
    const band = rng.fork('band')
    const a = -k.side * 0.55
    let d = ''
    for (let i = 0; i < 7; i++) {
      const t = i / 6
      const bx = lerp(k.x + w * (0.5 - k.side * 0.55), k.x + w * (0.5 + k.side * 0.1), t)
      const by = lerp(y + h * 0.7, y - h * 0.05, t)
      o += soft(k, bx, by, w * band.range(0.12, 0.2), w * 0.06, i % 2 ? '#8ea2e8' : '#b39be0', 0.16, 'glow', (a * 180) / Math.PI)
      for (let j = 0; j < 14; j++) d += dot(bx + band.range(-0.12, 0.12) * w, by + band.range(-0.05, 0.05) * w, w * band.range(0.0008, 0.0018))
    }
    o += flat(k, d, '#e6ecff', 0.5)
  }
  o += starField(k, rng.fork('stars'), 110, 0.72, '#fff9e8')
  // Moon with a halo and a few soft maria.
  const mr = w * 0.052
  o += soft(k, mx, my, mr * 6, mr * 6, '#b9ccff', k.hi ? 0.35 : 0.25) + soft(k, mx, my, mr * 2.2, mr * 2.2, '#fff3cf', 0.45, 'core')
  o += flat(k, circle(mx, my, mr), '#fff6d8')
  if (k.hi) {
    o += flat(k, dot(mx - mr * 0.3, my - mr * 0.15, mr * 0.28) + dot(mx + mr * 0.25, my + mr * 0.3, mr * 0.2) + dot(mx + mr * 0.35, my - mr * 0.35, mr * 0.12), '#e7dcbc', 0.8)
    o += paintD(circle(mx, my, mr), rad(k, 'moon', [[0, '#ffffff', 0], [0.7, '#ffffff', 0], [1, '#c9b98f', 0.5]], mx + k.L[0] * mr * 0.3, my + k.L[1] * mr * 0.3, mr * 1.1))
  }
  const [far, farTop] = ridge(k, rng.int(0, 1e6), hz, h * 0.09, 2.2)
  o += flat(k, far, '#223367')
  if (k.hi) o += strokeD(k, farTop, '#8fa6e8', w * 0.003, 0.35) + haze(k, 'nt', hz + h * 0.01, h * 0.05, '#4a5f9c', 0.5)
  const [mid] = ridge(k, rng.int(0, 1e6), hz + h * 0.035, h * 0.05, 1.6)
  o += flat(k, mid, '#18234d')
  if (!k.lo) o += pines(k, treeRow(k, rng.fork('trees'), 9, hz + h * 0.045, 0.08, 0.16, -0.04, 1.04, 1.6), { lit: '#1c2a5c', shade: '#101838' }, 1, k.hi)
  o += groundPlane(k, 'nt', rng.int(0, 1e6), '#141c40', '#0a0f26')
  if (k.hi) o += bokeh(k, rng.fork('ff'), 10, ['#fff0a0', '#d9ff9a'], 0, 0.6, 1, 0.95, 0.003, 0.007, 0.9)
  return o
}

function forestScene(k: Kit, rng: Rng): string {
  const { w, h, y, hz } = k
  const [sx, sy] = sunAt(k, 0.06)
  let o = fillBox(k, vg(k, 'fo', [[0, '#b5dcc6'], [0.6, '#dff0d6'], [1, '#f8f1cf']], y, hz))
  o += soft(k, sx, sy, w * 0.55, w * 0.5, '#fff5cf', k.hi ? 0.8 : 0.6)
  const haze1 = '#dcefd8'
  o += pines(k, treeRow(k, rng.fork('far'), 16, hz + h * 0.01, 0.16, 0.26, -0.05, 1.05, 0.6), { lit: mix('#7fae93', haze1, 0.5), shade: mix('#5f917a', haze1, 0.5) }, 1, k.hi)
  if (k.hi) o += haze(k, 'fo1', hz, h * 0.1, '#eef7e6', 0.55)
  o += pines(k, treeRow(k, rng.fork('mid'), 9, hz + h * 0.03, 0.26, 0.42, -0.05, 1.05, 1.1), { lit: mix('#5e9a74', haze1, 0.18), shade: mix('#3d7456', haze1, 0.2), trunk: '#6b5a48' }, 1, true)
  if (k.hi) o += godRays(k, 'fo', rng.fork('rays'), sx, sy, '#fffbe0', 0.34, 6, Math.atan2(hz - sy, k.hx - sx), 0.9, h * 1.3)
  if (k.hi) o += haze(k, 'fo2', hz + h * 0.04, h * 0.07, '#f3f8e2', 0.45)
  o += groundPlane(k, 'fo', rng.int(0, 1e6), '#96c878', '#4d8a45')
  if (k.hi) {
    // A path leading from the horizon to the feet.
    const px = k.hx
    const pw = w * 0.1
    const d = smooth([[px - w * 0.012, k.gt + h * 0.005, 0], [px + w * 0.012, k.gt + h * 0.005, 0], [px + pw * 0.9, lerp(k.gt, y + h, 0.6)], [px + pw * 1.8, y + h + 4, 0], [px - pw * 1.8, y + h + 4, 0], [px - pw * 0.8, lerp(k.gt, y + h, 0.55)]])
    o += paintD(d, vg(k, 'fop', [[0, '#e9dcb0'], [1, '#c9a979']], k.gt, y + h), 0.85)
    o += tufts(k, rng.fork('tufts'), 26, k.gt, '#356f38', '#a5d884')
    // Bushes in the lower corners.
    let bd = ''
    let bl = ''
    const br = rng.fork('bush')
    for (const sd of [-1, 1]) {
      const cx = k.x + w * (0.5 + sd * 0.46)
      const cy = y + h * 1.01
      for (let i = 0; i < 5; i++) {
        const px = cx + sd * -1 * i * w * 0.035 + br.range(-0.01, 0.01) * w
        const r = w * br.range(0.035, 0.06) * (1 - i * 0.12)
        const py = cy - r * 0.6 - i * h * 0.006
        bd += dot(px, py, r)
        bl += dot(px + k.L[0] * r * 0.3, py + k.L[1] * r * 0.3, r * 0.78)
      }
    }
    const clip = k.c.defs.add(`sfb${k.bk}`, (id) => el('clipPath', { id }, el('path', { d: bd })))
    o += flat(k, bd, '#2d6440') + g({ 'clip-path': url(clip) }, flat(k, bl, '#4a8f52'))
  }
  // Framing trees at the sides, big and dark: the nearest layer.
  const near: Tree[] = []
  for (const sd of [-1, 1]) {
    const u = sd < 0 ? rng.range(-0.08, 0.04) : rng.range(0.96, 1.08)
    near.push({ x: k.x + w * u, base: y + h * 1.02, hh: h * rng.range(0.85, 1.05) })
  }
  o += pines(k, near.filter((t) => calm(k, t.x, t.base - t.hh * 0.5, 1.5) > 0.3), { lit: '#3f7f58', shade: '#285a40', trunk: '#4a3a2c' }, 1, true)
  if (k.hi) o += bokeh(k, rng.fork('b'), 14, ['#fff8d6', '#f2ffc8'], 0, 0.05, 1, 0.75, 0.004, 0.012, 0.6)
  return o
}

function beachScene(k: Kit, rng: Rng): string {
  const { x, w, h, y, hz } = k
  const [sx, sy] = sunAt(k, 0.13)
  let o = fillBox(k, vg(k, 'bc', [[0, '#3597e6'], [0.6, '#83cbf6'], [1, '#e6f7ff']], y, hz))
  o += soft(k, sx, sy, w * 0.5, w * 0.5, '#fff6d6', k.hi ? 0.6 : 0.45) + flat(k, circle(sx, sy, w * 0.038), '#fffbea') + (k.hi ? soft(k, sx, sy, w * 0.1, w * 0.1, '#ffffff', 0.7, 'core') : '')
  const cr = rng.fork('clouds')
  o += cloudLayer(k, 'bcfar', cumuli(cr, cloudSpots(k, cr, 3, 0.72, 0.9, 0.028, 0.042), k.L), { lit: '#ffffff', shade: '#cfe3f5' }, 0.85)
  o += cloudLayer(k, 'bc', cumuli(cr, cloudSpots(k, cr, 2, 0.12, 0.45, 0.055, 0.085), k.L), { lit: '#ffffff', shade: '#c1d8f0', rim: '#ffffff' })
  // Sea: hazy at the horizon, turquoise near the shore.
  const shore = Math.max(k.gt + h * 0.03, hz + h * 0.07)
  o += el('path', { d: rect(x - 2, hz, w + 4, shore - hz + h * 0.02), fill: vg(k, 'sea', [[0, '#5aa9d8'], [0.35, '#2b93cf'], [1, '#27c1c9']], hz, shore) })
  if (k.hi) {
    o += strokeD(k, `M${n1(x - 2)} ${n1(hz)}H${n1(x + w + 2)}`, '#e6f7ff', h * 0.003, 0.8)
    // Glints on the water under the sun, and gentle swells.
    let d = ''
    let sw = ''
    const gr = rng.fork('glints')
    for (let i = 0; i < 16; i++) {
      const t = gr.next()
      const gy = lerp(hz + h * 0.006, shore - h * 0.01, t)
      const gx = sx + gr.range(-1, 1) * w * lerp(0.05, 0.18, t)
      const gl = w * lerp(0.01, 0.035, t)
      d += rect(gx - gl / 2, gy, gl, h * lerp(0.0015, 0.004, t))
    }
    for (let i = 0; i < 8; i++) {
      const t = gr.next()
      const gy = lerp(hz + h * 0.012, shore - h * 0.012, t)
      const gx = x + w * gr.next()
      const gl = w * lerp(0.03, 0.08, t)
      sw += `M${n1(gx - gl)} ${n1(gy)}Q${n1(gx)} ${n1(gy - h * 0.004)} ${n1(gx + gl)} ${n1(gy)}`
    }
    o += strokeD(k, sw, '#bff0f5', h * 0.0025, 0.5) + loop(k.c, 'glint', TWINKLE, 2.2, 0, flat(k, d, '#ffffff', 0.75), { timing: 'ease-in-out' })
  }
  // Sand with a wet band and a lace of foam.
  const [sand, sandTop] = ridge(k, rng.int(0, 1e6), shore, h * 0.018, 1.3, 10)
  o += paintD(sand, vg(k, 'sand', [[0, '#d9b98a'], [0.08, '#f2d9a4'], [1, '#e7c285']], shore - h * 0.02, y + h))
  o += strokeD(k, sandTop, '#ffffff', h * 0.008, 0.85)
  if (k.hi) {
    o += strokeD(k, sandTop, '#ffffff', h * 0.02, 0.25)
    // Ripples in the sand.
    let d = ''
    const rr = rng.fork('ripples')
    for (let i = 0; i < 12; i++) {
      const t = rr.next()
      const ry = lerp(shore + h * 0.03, y + h, t)
      const rx = x + w * rr.next()
      const rl = w * lerp(0.03, 0.08, t)
      d += `M${n1(rx - rl)} ${n1(ry)}Q${n1(rx)} ${n1(ry - h * 0.008)} ${n1(rx + rl)} ${n1(ry)}`
    }
    o += strokeD(k, d, '#c99d62', h * 0.003, 0.45)
    o += palm(k, rng.fork('palm'))
  }
  return o
}

/** A palm tree leaning in from the side away from the light. */
function palm(k: Kit, rng: Rng): string {
  const { w, h, y } = k
  const sd = -k.side
  const bx = k.x + w * (sd > 0 ? 0.93 : 0.07)
  if (calm(k, bx, y + h * 0.4, 1.4) < 0.5) return ''
  const by = y + h * 1.02
  const tx = bx - sd * w * 0.08
  const ty = y + h * 0.2
  const trunk = smooth(
    [
      [bx - w * 0.022, by],
      [lerp(bx, tx, 0.5) - w * 0.012 + sd * w * 0.01, lerp(by, ty, 0.5)],
      [tx - w * 0.01, ty],
      [tx + w * 0.01, ty],
      [lerp(bx, tx, 0.5) + w * 0.012 + sd * w * 0.01, lerp(by, ty, 0.5)],
      [bx + w * 0.022, by],
    ],
    true,
  )
  let o = flat(k, trunk, '#8a6440')
  let rings = ''
  for (let i = 1; i < 9; i++) {
    const t = i / 9
    const cx = lerp(bx, tx, t) + sd * w * 0.01 * Math.sin(t * Math.PI)
    const cy = lerp(by, ty, t)
    rings += `M${n1(cx - w * 0.018 * (1 - t * 0.4))} ${n1(cy)}q${n1(w * 0.018)} ${n1(h * 0.008)} ${n1(w * 0.036 * (1 - t * 0.4))} 0`
  }
  o += strokeD(k, rings, '#5e4128', w * 0.003, 0.7)
  let dk = ''
  let lt = ''
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i / 6 - 0.5) * 3.4 + rng.range(-0.1, 0.1)
    const L = w * rng.range(0.13, 0.18)
    const ex = tx + Math.cos(a) * L
    const ey = ty + Math.sin(a) * L * 0.7 + L * 0.35
    const mx = tx + Math.cos(a) * L * 0.5
    const my = ty + Math.sin(a) * L * 0.5 - L * 0.08
    const nx = -Math.sin(a) * L * 0.12
    const ny = Math.cos(a) * L * 0.12
    const leaf = `M${n1(tx)} ${n1(ty)}Q${n1(mx + nx)} ${n1(my + ny)} ${n1(ex)} ${n1(ey)}Q${n1(mx - nx * 0.3)} ${n1(my - ny * 0.3)} ${n1(tx)} ${n1(ty)}Z`
    if (Math.cos(a) * k.L[0] + Math.sin(a) * k.L[1] > 0) lt += leaf
    else dk += leaf
  }
  o += flat(k, dk, '#2f7a4a') + flat(k, lt, '#4fa062') + flat(k, dot(tx, ty + h * 0.01, w * 0.012) + dot(tx + w * 0.015, ty + h * 0.015, w * 0.01), '#6b4a2a')
  return o
}

function cityScene(k: Kit, rng: Rng): string {
  const { x, w, h, y, hz } = k
  let o = fillBox(k, vg(k, 'ct', [[0, '#141a42'], [0.42, '#352c68'], [0.78, '#9c4f7c'], [1, '#ec8a6e']], y, hz + h * 0.05))
  if (!k.lo) o += starField(k, rng.fork('stars'), 40, 0.35, '#ffe9f0')
  const [mx, my] = sunAt(k, 0.16)
  o += soft(k, mx, my, w * 0.2, w * 0.2, '#ffd9c0', 0.35) + flat(k, circle(mx, my, w * 0.035), '#ffe8d4')
  const sky = (layer: number, base: number, hMin: number, hMax: number, wMin: number, wMax: number, col: string, winCols: [string, number][], winP: number, u0 = 0, u1 = 1) => {
    const r = rng.fork(`city${layer}`)
    let d = ''
    let lit = ''
    const wins: string[] = winCols.map(() => '')
    const flick = buckets(3)
    let flickN = 0
    let bx = x + w * u0 - w * r.range(0, 0.05)
    while (bx < x + w * u1) {
      const bw = w * r.range(wMin, wMax)
      const cx = bx + bw / 2
      const dip = 1 - 0.45 * Math.exp(-(((cx - k.hx) / (k.hr * 2.4)) ** 2))
      const bh = h * r.range(hMin, hMax) * dip
      const top = base - bh
      d += rect(bx, top, bw - w * 0.004, bh + h * 0.3)
      // A lit edge on the side facing the sky glow.
      if (k.hi) lit += rect(k.side < 0 ? bx : bx + bw - w * 0.004 - bw * 0.12, top, bw * 0.12, bh + h * 0.3)
      if (r.chance(0.3)) d += rect(bx + bw * 0.2, top - h * 0.015, bw * 0.5, h * 0.016)
      if (r.chance(0.2)) d += rect(bx + bw * 0.45, top - h * 0.05, w * 0.003, h * 0.05)
      if (winP > 0 && !k.lo) {
        const ww = Math.max(w * 0.006, bw * 0.12)
        const wh = h * 0.012
        const cols = Math.max(1, Math.floor((bw * 0.8) / (ww * 2)))
        for (let wy = top + h * 0.02; wy < Math.min(base, y + h) - h * 0.01; wy += wh * 2.4)
          for (let ci = 0; ci < cols; ci++)
            if (r.chance(winP)) {
              const wi = r.chance(0.8) ? 0 : winCols.length - 1
              const wr = rect(bx + bw * 0.12 + ci * ww * 2, wy, ww, wh)
              if (k.c.motion && winP > 0.3 && r.chance(0.1)) flick[flickN++ % 3] += wr
              else wins[wi] += wr
            }
      }
      bx += bw
    }
    return (
      flat(k, d, col) +
      flat(k, lit, highlightOf(col, 0.25), 0.5) +
      wins.map((wd, i) => flat(k, wd, winCols[i][0], winCols[i][1])).join('') +
      flick.map((wd, i) => loop(k.c, 'win', FLICKER, 9 + i * 4, layer * 2.3 + i * 3.1, flat(k, wd, winCols[0][0], winCols[0][1]))).join('')
    )
  }
  o += sky(0, hz + h * 0.01, 0.2, 0.36, 0.05, 0.09, mix('#4b3b7c', '#c26a86', 0.4), [['#ffd9a0', 0.4], ['#9fdcff', 0.35]], k.hi ? 0.25 : 0)
  if (k.hi) o += haze(k, 'ct1', hz + h * 0.01, h * 0.1, '#d8788a', 0.55)
  o += sky(1, hz + h * 0.04, 0.16, 0.34, 0.07, 0.13, '#2b2452', [['#ffd27a', 0.9], ['#8fd6ff', 0.8]], 0.35)
  if (k.hi) {
    o += sky(2, y + h * 0.99, 0.55, 0.75, 0.1, 0.15, '#191431', [['#ffcf73', 0.95], ['#ff8fb0', 0.9]], 0.4, -0.05, 0.14)
    o += sky(3, y + h * 0.99, 0.55, 0.75, 0.1, 0.15, '#191431', [['#ffcf73', 0.95], ['#ff8fb0', 0.9]], 0.4, 0.88, 1.05)
    o += haze(k, 'ct2', k.gt, h * 0.05, '#6a3f7a', 0.5)
  }
  o += el('path', { d: rect(x - 2, k.gt, w + 4, y + h - k.gt + 4), fill: vg(k, 'ctg', [[0, '#3a2c5c'], [1, '#141026']], k.gt, y + h) })
  if (k.hi) {
    // Wet street: soft reflections of the lit windows, and street-light bokeh.
    const rr = rng.fork('refl')
    const cols = ['#ffcf8a', '#ff8fb0', '#8fd6ff']
    for (let i = 0; i < 12; i++) {
      const rx = x + w * rr.next()
      const ry = lerp(k.gt + h * 0.02, y + h, rr.next())
      o += soft(k, rx, ry, w * 0.012, h * 0.035, rr.pick(cols), 0.3)
    }
    o += bokeh(k, rng.fork('b'), 12, ['#ffd08a', '#ff8fb0', '#8fd6ff'], 0, 0.55, 1, 0.98, 0.006, 0.016, 0.5)
  }
  return o
}

function snowScene(k: Kit, rng: Rng): string {
  const { w, h, y, hz } = k
  const [sx, sy] = sunAt(k, 0.12)
  let o = fillBox(k, vg(k, 'sn', [[0, '#8db2de'], [0.6, '#c5d9f1'], [1, '#eef4fb']], y, hz))
  o += soft(k, sx, sy, w * 0.5, w * 0.45, '#ffffff', k.hi ? 0.6 : 0.4)
  const peaks = [
    { u: 0.5 - k.side * 0.32 + rng.range(-0.05, 0.05), hh: h * rng.range(0.24, 0.3), ww: w * 0.3 },
    { u: 0.5 + k.side * 0.3 + rng.range(-0.05, 0.05), hh: h * rng.range(0.16, 0.22), ww: w * 0.26 },
    { u: 0.5 + rng.range(-0.1, 0.1), hh: h * rng.range(0.1, 0.14), ww: w * 0.24 },
  ]
  o += mountains(k, rng.fork('mtn'), hz + h * 0.01, peaks, { lit: mix('#dbe7f6', '#eef4fb', 0.3), shade: mix('#9fb6d6', '#eef4fb', 0.35), snow: '#ffffff', snowShade: '#dce8f6' })
  if (k.hi) o += haze(k, 'sn1', hz + h * 0.01, h * 0.08, '#f2f7fd', 0.7)
  o += pines(k, treeRow(k, rng.fork('trees'), 11, hz + h * 0.045, 0.1, 0.2, -0.04, 1.04, 1.3), { lit: mix('#4f7f86', '#e8f0fa', 0.35), shade: mix('#355e68', '#e8f0fa', 0.35), snow: '#f6fafe' }, 1, true)
  o += groundPlane(k, 'sn', rng.int(0, 1e6), '#e3ecf8', '#f8fbff', 0.018)
  if (k.hi) {
    // Drifts: soft mounds, lit on the light side, with cool shadows at their feet.
    const dr = rng.fork('drifts')
    let mounds = ''
    let shadows = ''
    let rims = ''
    const paint = lin(k, 'snd', [[0, '#ffffff'], [0.6, '#f1f6fc'], [1, '#c9d9ee']], 0, k.gt, 0, y + h)
    for (let i = 0; i < 4; i++) {
      const t = (i + dr.range(0.1, 0.9)) / 4
      const cx = k.x + w * t
      if (k.ground && Math.abs(cx - k.hx) < w * 0.18) continue
      const cy = lerp(k.gt + h * 0.04, k.y + h * 1.02, dr.range(0.35, 1))
      const rx = w * dr.range(0.12, 0.2)
      const ry = h * dr.range(0.035, 0.06)
      const top: SP[] = [[cx - rx, cy, 0], [cx - rx * 0.5, cy - ry * 0.7], [cx + k.side * rx * 0.15, cy - ry], [cx + rx * 0.5, cy - ry * 0.6], [cx + rx, cy, 0]]
      mounds += smooth(top)
      rims += smooth(top.slice(1, 4), false)
      shadows += ellipse(cx - k.side * rx * 0.25, cy + ry * 0.05, rx * 1.05, ry * 0.4)
    }
    o += flat(k, shadows, '#a9c0e0', 0.55) + paintD(mounds, paint) + strokeD(k, rims, '#ffffff', h * 0.006, 0.9)
    let sp = ''
    const sr = rng.fork('sparkle')
    for (const [px, py] of scatter(k, sr, 22, 0, (k.gt - y) / h, 1, 1)) sp += sparkle(px, py, w * sr.range(0.004, 0.008), 0.15)
    o += loop(k.c, 'snsp', TWINKLE, 3.1, 0, flat(k, sp, '#ffffff', 0.9), { timing: 'ease-in-out' })
  }
  // Snowfall: small far flakes, big soft near ones.
  const fr = rng.fork('flakes')
  let far = ''
  for (const [px, py] of scatter(k, fr, k.hi ? 70 : k.lo ? 12 : 30, 0, 0, 1, 1, 1.1)) far += dot(px, py, w * fr.range(0.002, 0.005))
  const flakes = flat(k, far, '#ffffff', 0.9)
  // In motion the field falls one box height per loop, with a copy waiting above the frame.
  o += k.c.motion
    ? g({ 'clip-path': boxClip(k) }, loop(k.c, `snow${k.bk}`, `0%{transform:translate(0px,0px)}100%{transform:translate(0px,${upx(h)})}`, 26, 0, flakes + `<g transform="translate(0 ${n1(-h)})">${flakes}</g>`))
    : flakes
  if (k.hi) o += bokeh(k, fr, 10, ['#ffffff'], 0, 0, 1, 1, 0.01, 0.02, 0.75, 'fall')
  return o
}

function spaceScene(k: Kit, rng: Rng): string {
  const { x, w, h, y } = k
  let o = fillBox(k, vg(k, 'sp', [[0, '#05061a'], [0.55, '#0e0a2e'], [1, '#1b1244']], y, y + h))
  // Nebula: a drifting band of coloured gas with dark dust, running corner to corner.
  const nr = rng.fork('nebula')
  const sd = k.side
  if (k.hi) {
    let neb = ''
    const cols = ['#6a3fb8', '#c2449a', '#3a74d0', '#2aa5b0', '#8a4fd0']
    for (let i = 0; i < 9; i++) {
      const t = i / 8
      const cx = lerp(x + w * (0.5 + sd * 0.55), x + w * (0.5 - sd * 0.5), t) + nr.range(-0.06, 0.06) * w
      const cy = lerp(y + h * 0.05, y + h * 0.8, t) + nr.range(-0.06, 0.06) * h
      const r = w * nr.range(0.1, 0.2) * (0.6 + 0.4 * calm(k, cx, cy, 1.6))
      neb += el('ellipse', { cx: n1(cx), cy: n1(cy), rx: n1(r * 1.4), ry: n1(r), fill: k.P.col(cols[i % cols.length]), 'fill-opacity': f(0.28 + 0.2 * calm(k, cx, cy, 1.4)) })
    }
    let dust = ''
    for (let i = 0; i < 4; i++) {
      const t = nr.range(0.15, 0.85)
      dust += dot(lerp(x + w * (0.5 + sd * 0.5), x + w * (0.5 - sd * 0.45), t) + nr.range(-0.04, 0.04) * w, lerp(y + h * 0.08, y + h * 0.8, t), w * nr.range(0.04, 0.07))
    }
    o += g({ filter: blur(k, w * 0.045) }, neb, flat(k, dust, '#05061a', 0.5))
  } else {
    o += soft(k, x + w * (0.5 - sd * 0.3), y + h * 0.7, w * 0.4, w * 0.3, '#6b3fa0', 0.45) + soft(k, x + w * (0.5 + sd * 0.35), y + h * 0.15, w * 0.3, w * 0.22, '#3a5fb0', 0.35)
  }
  o += starField(k, rng.fork('stars'), 150, 1, '#ffffff')
  // A ringed planet, lit from the light side, on the side away from the key light.
  const pr = w * 0.1
  const px = x + w * (0.5 - sd * 0.3)
  const py = y + h * 0.24
  const tilt = -18 * sd
  const ringD = (front: boolean) => {
    const a0 = front ? 0 : Math.PI
    let d = ''
    for (let i = 0; i <= 24; i++) {
      const a = a0 + (i / 24) * Math.PI
      d += `${i ? 'L' : 'M'}${n1(Math.cos(a) * pr * 1.8)} ${n1(Math.sin(a) * pr * 0.36)}`
    }
    return d
  }
  const ringCol = '#f0c98f'
  const ring = (front: boolean) =>
    el(
      'g',
      { transform: `translate(${n1(px)} ${n1(py)}) rotate(${f(tilt)})` },
      el('path', { d: ringD(front), fill: 'none', stroke: k.P.col(ringCol), 'stroke-width': n1(pr * 0.12), 'stroke-opacity': front ? 0.9 : 0.55 }),
      k.hi ? el('path', { d: ringD(front), fill: 'none', stroke: k.P.col('#fff0d0'), 'stroke-width': n1(pr * 0.03), 'stroke-opacity': 0.6, transform: 'scale(1.1)' }) : '',
    )
  if (calm(k, px, py, 1.3) > 0.2) {
    o += soft(k, px, py, pr * 1.7, pr * 1.7, '#e88a6a', 0.3) + ring(false)
    const lx = px + k.L[0] * pr * 0.45
    const ly = py + k.L[1] * pr * 0.45
    o += paintD(circle(px, py, pr), rad(k, 'pl', [[0, '#ffc59a'], [0.45, '#e2795c'], [1, '#6e2a4c']], lx, ly, pr * 1.55))
    if (k.hi) {
      const clip = k.c.defs.add(`spc${k.bk}`, (id) => el('clipPath', { id }, el('path', { d: circle(px, py, pr) })))
      let bands = ''
      for (let i = 0; i < 4; i++) {
        const by = py - pr * 0.6 + i * pr * 0.38
        bands += `M${n1(px - pr)} ${n1(by)}Q${n1(px)} ${n1(by + pr * 0.12)} ${n1(px + pr)} ${n1(by)}L${n1(px + pr)} ${n1(by + pr * 0.1)}Q${n1(px)} ${n1(by + pr * 0.22)} ${n1(px - pr)} ${n1(by + pr * 0.1)}Z`
      }
      o += g({ 'clip-path': url(clip) }, flat(k, bands, '#b8505a', 0.35), flat(k, dot(px - k.L[0] * pr * 0.9, py - k.L[1] * pr * 0.9, pr * 1.05), '#1a0b2a', 0.5))
      o += el('path', { d: circle(px, py, pr * 0.985), fill: 'none', stroke: lin(k, 'plr', [[0, '#ffd9b0', 0.9], [0.5, '#ffd9b0', 0.1], [1, '#ffd9b0', 0]], px + k.L[0] * pr, py + k.L[1] * pr, px - k.L[0] * pr, py - k.L[1] * pr), 'stroke-width': n1(pr * 0.06) })
    }
    o += ring(true)
    const mx = px + sd * pr * 2.3
    const my = py + pr * 1.3
    if (calm(k, mx, my, 1.2) > 0.5) o += paintD(circle(mx, my, pr * 0.22), rad(k, 'mn', [[0, '#e6e2f0'], [1, '#6a6488']], mx + k.L[0] * pr * 0.1, my + k.L[1] * pr * 0.1, pr * 0.34))
  }
  if (k.hi) {
    // A shooting star, well clear of the head.
    const sr = rng.fork('meteor')
    const ax = x + w * (0.5 + sd * sr.range(0.18, 0.32))
    const ay = y + h * sr.range(0.08, 0.2)
    const len = w * 0.16
    if (calm(k, ax, ay, 1.5) > 0.6)
      o += el('path', { d: polyC([[ax, ay - w * 0.003], [ax - sd * len, ay - len * 0.35], [ax, ay + w * 0.003]]), fill: lin(k, 'met', [[0, '#ffffff', 0.9], [1, '#9fb6ff', 0]], ax, ay, ax - sd * len, ay - len * 0.35) }) + soft(k, ax, ay, w * 0.012, w * 0.012, '#ffffff', 0.9, 'core')
  }
  // A small moon surface to stand on.
  const [surf, surfTop] = ridge(k, rng.int(0, 1e6), k.gt + h * 0.01, h * 0.02, 1.2, 10)
  o += paintD(surf, vg(k, 'sps', [[0, '#4a4468'], [1, '#1c1832']], k.gt, y + h))
  if (k.hi) {
    o += strokeD(k, surfTop, '#9d94d0', h * 0.004, 0.6)
    let cr = ''
    let rim = ''
    let lit = ''
    const rr = rng.fork('craters')
    for (let i = 0; i < 7; i++) {
      const t = rr.next()
      const cy = lerp(k.gt + h * 0.03, y + h, t)
      const cx = x + w * rr.next()
      if (k.ground && Math.abs(cx - k.hx) < w * 0.1 && cy > -h * 0.06) continue
      const rx = w * lerp(0.02, 0.05, t)
      cr += ellipse(cx, cy, rx, rx * 0.3)
      rim += ellipse(cx - k.L[0] * rx * 0.12, cy - rx * 0.05, rx * 0.9, rx * 0.22)
      lit += `M${n1(cx - rx)} ${n1(cy)}A${n1(rx)} ${n1(rx * 0.3)} 0 0 0 ${n1(cx + rx)} ${n1(cy)}`
    }
    o += flat(k, cr, '#5a5480') + flat(k, rim, '#231e3c', 0.8) + strokeD(k, lit, '#8f86c0', h * 0.003, 0.6)
  }
  return o
}

function underwaterScene(k: Kit, rng: Rng): string {
  const { x, w, h, y } = k
  let o = fillBox(k, vg(k, 'uw', [[0, '#43b8e2'], [0.22, '#1d86bf'], [0.62, '#0f4e86'], [1, '#08284f']], y, y + h))
  // Light shafts from the surface, slanting with the light.
  const sr = rng.fork('shafts')
  let shafts = ''
  const lean = -k.L[0] * 0.35
  for (let i = 0; i < 7; i++) {
    const u = (i + sr.range(0.1, 0.9)) / 7
    const sx = x + w * u
    const sw = w * sr.range(0.02, 0.06)
    const len = h * sr.range(0.6, 0.95)
    shafts += polyC([[sx - sw, y - 2], [sx + sw, y - 2], [sx + sw * 2.2 + lean * len, y + len], [sx - sw * 0.6 + lean * len, y + len]])
  }
  const shaftPaint = vg(k, 'uws', [[0, '#d8f7ff', 0.42], [0.55, '#bdefff', 0.14], [1, '#bdefff', 0]], y, y + h * 0.9)
  o += loop(k.c, `uws${k.bk}`, sway(w * 0.025), 11, 0, loop(k.c, 'uwb', BREATHE, 5.5, 1.3, k.hi ? g({ filter: blur(k, w * 0.012) }, paintD(shafts, shaftPaint)) : paintD(shafts, shaftPaint, 0.7), { timing: 'ease-in-out' }), { timing: 'ease-in-out' })
  if (k.hi) {
    // Caustic shimmer just under the surface.
    let d = ''
    const cr = rng.fork('caustic')
    for (let i = 0; i < 14; i++) {
      const cx = x + w * cr.next()
      const cy = y + h * cr.range(0.01, 0.12)
      const cw = w * cr.range(0.04, 0.09)
      d += `M${n1(cx - cw)} ${n1(cy)}q${n1(cw * 0.5)} ${n1(-h * 0.02)} ${n1(cw)} 0t${n1(cw)} 0`
    }
    o += loop(k.c, `uwc${k.bk}`, sway(w * 0.015), 6, 0, loop(k.c, 'uwcb', BREATHE, 3.2, 0.7, g({ filter: blur(k, w * 0.0025, boxOf(x, y, x + w, y + h * 0.16)) }, strokeD(k, d, '#e6fbff', w * 0.004, 0.35)), { timing: 'ease-in-out' }), { timing: 'ease-in-out' })
  }
  // Distant reef silhouettes in the blue haze.
  const [far] = ridge(k, rng.int(0, 1e6), k.hz + h * 0.02, h * 0.1, 3.2)
  o += flat(k, far, mix('#12507f', '#1d6fa5', 0.5))
  if (k.hi) {
    // A far school of fish.
    const fr = rng.fork('fish')
    const fx = x + w * (0.5 - k.side * 0.3)
    const fy = y + h * fr.range(0.3, 0.42)
    let fish = ''
    if (calm(k, fx, fy, 1.4) > 0.5)
      for (let i = 0; i < 9; i++) {
        const px = fx + fr.range(-0.08, 0.08) * w
        const py = fy + fr.range(-0.04, 0.04) * h
        const s = w * fr.range(0.007, 0.011)
        fish += `M${n1(px - s)} ${n1(py)}Q${n1(px)} ${n1(py - s * 0.6)} ${n1(px + s)} ${n1(py)}Q${n1(px)} ${n1(py + s * 0.6)} ${n1(px - s)} ${n1(py)}ZM${n1(px + s * 0.8)} ${n1(py)}L${n1(px + s * 1.5)} ${n1(py - s * 0.5)}L${n1(px + s * 1.5)} ${n1(py + s * 0.5)}Z`
      }
    o += flat(k, fish, '#2a7fb0', 0.8) + haze(k, 'uw', k.hz + h * 0.03, h * 0.08, '#2a7fb3', 0.6)
  }
  // Sea floor.
  const [floor, floorTop] = ridge(k, rng.int(0, 1e6), k.gt + h * 0.01, h * 0.025, 1.4, 10)
  o += paintD(floor, vg(k, 'uwf', [[0, '#6d9fa8'], [0.3, '#c2b184'], [1, '#8c7a58']], k.gt, y + h))
  if (k.hi) {
    o += strokeD(k, floorTop, '#e3d6a8', h * 0.004, 0.5)
    // Caustic net of light on the sand.
    let d = ''
    const cr = rng.fork('floorc')
    for (let i = 0; i < 16; i++) {
      const t = cr.next()
      const cy = lerp(k.gt + h * 0.025, y + h, t)
      const cx = x + w * cr.next()
      const r = w * lerp(0.012, 0.035, t)
      d += `M${n1(cx - r)} ${n1(cy)}q${n1(r * 0.5)} ${n1(-r * 0.35)} ${n1(r)} 0q${n1(r * 0.5)} ${n1(r * 0.3)} ${n1(r)} 0`
    }
    o += loop(k.c, 'uwfc', BREATHE, 4.1, 2, g({ filter: blur(k, w * 0.003, boxOf(x, k.gt, x + w, y + h)) }, strokeD(k, d, '#fff3c4', w * 0.005, 0.35)), { timing: 'ease-in-out' })
  }
  // Kelp swaying up at the sides.
  const kr = rng.fork('kelp')
  let kelpD = ''
  let kelpL = ''
  for (const sd of [-1, 1]) {
    for (let i = 0; i < (k.hi ? 3 : 2); i++) {
      const bx = x + w * (sd < 0 ? kr.range(0.02, 0.16) : kr.range(0.84, 0.98))
      const top = y + h * kr.range(0.15, 0.4)
      if (calm(k, bx, top, 1.4) < 0.4) continue
      const spine: P[] = []
      for (let j = 0; j <= 8; j++) {
        const t = j / 8
        spine.push([bx + Math.sin(t * 5 + i * 2) * w * 0.022 * t, lerp(y + h + 2, top, t)])
      }
      const wd = w * 0.02
      const pts: SP[] = [...spine.map(([px, py], j) => [px - wd * (1 - (j / 8) * 0.75), py] as SP), ...spine.slice().reverse().map(([px, py], j) => [px + wd * (0.25 + (j / 8) * 0.75), py] as SP)]
      kelpD += smooth(pts)
      kelpL += smooth(spine.map(([px, py]) => [px + k.side * wd * 0.25, py] as P), false)
    }
  }
  o += flat(k, kelpD, '#1a6b63') + (k.hi ? strokeD(k, kelpL, '#3fa58a', w * 0.007, 0.7) : '')
  if (k.hi) o += coralBeds(k, rng.fork('coral'))
  // Bubbles and drifting specks.
  const br = rng.fork('bubbles')
  const bub = buckets(3)
  const hl = buckets(3)
  let bi = 0
  for (const [px, py] of scatter(k, br, k.hi ? 22 : 12, 0, 0.05, 1, 0.95, 1.2)) {
    const r = w * br.range(0.005, 0.016)
    bub[bi % 3] += dot(px, py, r)
    hl[bi++ % 3] += dot(px - r * 0.35, py - r * 0.35, r * 0.28)
  }
  bub.forEach((d, j) => {
    const layer = el('path', { d, fill: k.P.col('#bfefff'), 'fill-opacity': 0.12, stroke: k.P.col('#d8f6ff'), 'stroke-width': n1(w * 0.0025), 'stroke-opacity': 0.75 }) + (k.lo ? '' : flat(k, hl[j], '#ffffff', 0.8))
    o += loop(k.c, `bub${j}${k.bk}`, rise(w * 0.012 * (j - 1), h * (0.12 + j * 0.04)), 6 + j * 2.2, j * 2.4, layer, { timing: 'ease-in' })
  })
  if (k.rich) {
    let sp = ''
    for (const [px, py] of scatter(k, br, 40, 0, 0, 1, 1, 1)) sp += dot(px, py, w * br.range(0.001, 0.0025))
    o += loop(k.c, `mar${k.bk}`, drift(w * 0.01, w * 0.006), 14, 0, flat(k, sp, '#d8f4ff', 0.45), { timing: 'ease-in-out' })
  }
  return o
}

/** Branching coral and rocks in the lower corners. */
function coralBeds(k: Kit, rng: Rng): string {
  const { x, w, h, y } = k
  const widths = [w * 0.016, w * 0.011, w * 0.007]
  const cols: [string, string][] = [['#ff7f8a', '#ffc0b0'], ['#b77ae6', '#e2c4ff']]
  let rock = ''
  let rockLit = ''
  let o = ''
  ;[-1, 1].forEach((sd, ci) => {
    const bx = x + w * (sd < 0 ? 0.1 : 0.9)
    const by = y + h * 1.01
    if (calm(k, bx, by - h * 0.1, 1.2) < 0.4) return
    rock += ellipse(bx + sd * w * 0.07, by, w * 0.11, h * 0.07)
    rockLit += ellipse(bx + sd * w * 0.07 + k.L[0] * w * 0.02, by - h * 0.012, w * 0.08, h * 0.045)
    const depth = ['', '', '']
    const tips: string[] = []
    const branch = (px: number, py: number, a: number, len: number, d: number) => {
      const ex = px + Math.cos(a) * len
      const ey = py + Math.sin(a) * len
      depth[d] += `M${n1(px)} ${n1(py)}Q${n1(px + Math.cos(a + 0.3) * len * 0.5)} ${n1(py + Math.sin(a + 0.3) * len * 0.5)} ${n1(ex)} ${n1(ey)}`
      if (d < 2) {
        branch(ex, ey, a - rng.range(0.3, 0.55), len * 0.72, d + 1)
        branch(ex, ey, a + rng.range(0.3, 0.55), len * 0.68, d + 1)
      } else tips.push(dot(ex, ey, widths[2] * 0.7))
    }
    branch(bx, by, -Math.PI / 2 - sd * 0.15, h * 0.075, 0)
    const [c0, c1] = cols[ci]
    depth.forEach((dd, i) => (o += strokeD(k, dd, c0, widths[i])))
    o += strokeD(k, depth[1] + depth[2], c1, widths[2] * 0.4, 0.6) + flat(k, tips.join(''), c1)
  })
  return flat(k, rock, '#23465a') + flat(k, rockLit, '#35657a') + o
}

function dungeonScene(k: Kit, rng: Rng): string {
  const { x, w, h, y } = k
  const floorY = k.ground ? k.gt : y + h * 0.84
  let o = flat(k, fullD(k), '#241e2a')
  // Irregular stone blocks with per-stone tone and bevelled edges.
  const br = rng.fork('bricks')
  const tones = ['#463c50', '#3e3548', '#4c4256', '#383140', '#4a3f4a', '#3f3a4c']
  const buckets = tones.map(() => '')
  let hiD = ''
  let loD = ''
  const rows = 8
  const bh = (floorY - y) / (rows - 0.3)
  const bw = w / 4.6
  const gap = Math.min(bh, bw) * 0.07
  for (let r = 0; r < rows; r++) {
    const by = y + r * bh - bh * 0.3
    let bx = x - br.range(0.1, 0.9) * bw
    while (bx < x + w) {
      const sw = bw * br.range(0.6, 1.25)
      const hh = Math.min(bh, floorY - by)
      if (hh > gap * 2) {
        buckets[br.int(0, tones.length - 1)] += roundRect(bx + gap / 2, by + gap / 2, sw - gap, hh - gap, gap * 1.5)
        if (k.hi) {
          hiD += rect(bx + gap * 1.2, by + gap * 0.6, sw - gap * 2.4, bh * 0.07)
          loD += rect(bx + gap * 1.2, by + hh - gap * 0.6 - bh * 0.09, sw - gap * 2.4, bh * 0.09)
        }
      }
      bx += sw
    }
  }
  const wall = buckets.map((d, i) => flat(k, d, tones[i])).join('') + (k.hi ? flat(k, hiD, '#6d6280', 0.45) + flat(k, loD, '#15111a', 0.5) : '')
  // Baked: the stonework settles into an even tone behind the head.
  o += k.hi ? soft(k, k.hx, k.hy, k.hr * 3, k.hr * 3.2, '#433a4c', 1) + g({ mask: url(calmMask(k)) }, wall) : wall
  // Floor.
  o += el('path', { d: rect(x - 2, floorY, w + 4, y + h - floorY + 4), fill: vg(k, 'dgf', [[0, '#3a3140'], [1, '#17121b']], floorY, y + h) })
  if (k.hi) {
    let d = ''
    const vx = k.hx
    for (let i = -6; i <= 6; i++) d += `M${n1(vx + i * w * 0.05)} ${n1(floorY)}L${n1(vx + i * w * 0.3)} ${n1(y + h + 2)}`
    for (let j = 1; j < 5; j++) {
      const t = (j / 5) ** 1.6
      d += `M${n1(x - 2)} ${n1(lerp(floorY, y + h, t))}H${n1(x + w + 2)}`
    }
    o += strokeD(k, d, '#0f0b12', h * 0.004, 0.6) + haze(k, 'dg', floorY + h * 0.01, h * 0.035, '#0c090f', 0.7)
  }
  // Torches on both walls: warm pools of light, flames with a hot core.
  for (const sd of [-1, 1]) {
    const tx = x + w * (0.5 + sd * 0.38)
    const ty = y + h * 0.36
    if (calm(k, tx, ty, 1) < 0.3) continue
    const s = w * 0.03
    o += loop(k.c, 'tglow', '0%,100%{opacity:1}30%{opacity:.82}55%{opacity:.95}80%{opacity:.78}', 2.3 + (sd + 1) * 0.35, sd + 1, soft(k, tx, ty - s, w * 0.42, h * 0.45, '#ff9a3c', k.hi ? 0.42 : 0.35))
    o += flat(k, polyC([[tx - s * 0.5, ty], [tx + s * 0.5, ty], [tx + s * 0.25, ty + s * 1.8], [tx - s * 0.25, ty + s * 1.8]]), '#2a2024') + flat(k, rect(tx - s * 0.7, ty - s * 0.2, s * 1.4, s * 0.35), '#4a3a36')
    const flame = (sc: number) =>
      `M${n1(tx)} ${n1(ty - s * 2.2 * sc)}C${n1(tx + s * 0.9 * sc)} ${n1(ty - s * 1.1 * sc)} ${n1(tx + s * 0.6 * sc)} ${n1(ty - s * 0.1)} ${n1(tx)} ${n1(ty - s * 0.1)}C${n1(tx - s * 0.6 * sc)} ${n1(ty - s * 0.1)} ${n1(tx - s * 0.9 * sc)} ${n1(ty - s * 1.1 * sc)} ${n1(tx)} ${n1(ty - s * 2.2 * sc)}Z`
    o += loop(k.c, 'flame', FLAME, 0.9 + (sd + 1) * 0.12, (sd + 1) * 0.37, flat(k, flame(1), '#ff7a1a') + flat(k, flame(0.7), '#ffb84a') + (k.hi ? flat(k, flame(0.4), '#fff1b8') : ''), { origin: 'center bottom', timing: 'ease-in-out' })
    if (k.hi) o += soft(k, tx, ty - s, s * 3, s * 3, '#ffc46a', 0.6, 'core')
    if (k.hi) {
      let em = ''
      const er = rng.fork(`em${sd}`)
      for (let i = 0; i < 6; i++) em += dot(tx + er.range(-1, 1) * s * 1.5, ty - s * er.range(2.5, 6), w * er.range(0.0015, 0.003))
      o += loop(k.c, `tem${k.bk}`, rise(s * 0.6, s * 2.5), 2.8, (sd + 1) * 0.9, flat(k, em, '#ffc46a', 0.85))
    }
  }
  return o
}

function stageScene(k: Kit, rng: Rng): string {
  const { x, w, h, y } = k
  const floorY = k.ground ? k.gt : y + h * 0.86
  let o = fillBox(k, vg(k, 'stb', [[0, '#12081f'], [1, '#2b1238']], y, floorY))
  // Back curtain folds.
  const fw = w / 14
  const foldPaint = k.hi
    ? url(
        k.c.defs.add(`stf${k.bk}`, (id) =>
          el(
            'pattern',
            { id, width: n1(fw), height: n1(h + 4), patternUnits: 'userSpaceOnUse', x: n1(x), y: n1(y - 2) },
            el('rect', { width: n1(fw), height: n1(h + 4), fill: lin(k, 'stfl', [[0, '#1f0a22'], [0.5, '#44143c'], [1, '#1f0a22']], x, 0, x + fw, 0) }),
          ),
        ),
      )
    : k.P.col('#2e0f2e')
  o += paintD(rect(x - 2, y - 2, w + 4, floorY - y + 2), foldPaint, 0.9)
  // Floor boards with a pool of light.
  o += el('path', { d: rect(x - 2, floorY, w + 4, y + h - floorY + 4), fill: vg(k, 'stg', [[0, '#7a4428'], [1, '#2e160d']], floorY, y + h) })
  if (k.hi) {
    let d = ''
    for (let i = -8; i <= 8; i++) d += `M${n1(k.hx + i * w * 0.07)} ${n1(floorY)}L${n1(k.hx + i * w * 0.22)} ${n1(y + h + 2)}`
    o += strokeD(k, d, '#3a1c10', h * 0.003, 0.7) + strokeD(k, `M${n1(x)} ${n1(floorY)}H${n1(x + w)}`, '#c9884f', h * 0.004, 0.6)
  }
  // Spotlight: a cone from above onto the subject, and its pool on the boards.
  const top = y - h * 0.05
  const beam = polyC([[k.hx - w * 0.07, top], [k.hx + w * 0.07, top], [k.hx + w * 0.32, floorY + h * 0.04], [k.hx - w * 0.32, floorY + h * 0.04]])
  const beamPaint = vg(k, 'stbm', [[0, '#fff3d0', 0.5], [0.6, '#fff0c8', 0.2], [1, '#fff0c8', 0.1]], top, floorY)
  o += loop(k.c, 'beam', '0%,100%{opacity:1}50%{opacity:.8}', 6, 0, k.hi ? g({ filter: blur(k, w * 0.018, boxOf(k.hx - w * 0.33, top, k.hx + w * 0.33, floorY + h * 0.05)) }, paintD(beam, beamPaint)) : paintD(beam, beamPaint, 0.7), { timing: 'ease-in-out' })
  o += soft(k, k.hx, floorY + (y + h - floorY) * 0.55, w * 0.34, (y + h - floorY) * 0.5, '#ffe4a8', 0.55)
  if (k.hi) {
    let d = ''
    const dr = rng.fork('dust')
    for (let i = 0; i < 26; i++) {
      const t = dr.next()
      const py = lerp(top, floorY, t)
      const px = k.hx + dr.range(-1, 1) * lerp(w * 0.06, w * 0.28, t)
      if (calm(k, px, py, 0.9) > dr.next()) d += dot(px, py, w * dr.range(0.0012, 0.003))
    }
    o += loop(k.c, `dust${k.bk}`, drift(w * 0.012, w * 0.01), 12, 0, flat(k, d, '#fff6dc', 0.8), { timing: 'ease-in-out' })
  }
  // Side curtains: velvet folds gathered and tied back.
  const curtainPaint = k.hi
    ? url(
        k.c.defs.add(`stc${k.bk}`, (id) =>
          el(
            'pattern',
            { id, width: n1(w * 0.035), height: n1(h + 4), patternUnits: 'userSpaceOnUse', x: n1(x), y: n1(y - 2) },
            el('rect', { width: n1(w * 0.035), height: n1(h + 4), fill: lin(k, 'stcl', [[0, '#5e0f1f'], [0.45, '#c8283e'], [0.6, '#b01f35'], [1, '#5e0f1f']], x, 0, x + w * 0.035, 0) }),
          ),
        ),
      )
    : k.P.col('#9a1c2f')
  for (const sd of [-1, 1]) {
    const ex = sd < 0 ? x - 2 : x + w + 2
    const inner = (t: number) => ex - sd * w * (0.17 - 0.1 * Math.sin(t * Math.PI * 0.85) + 0.06 * t)
    const pts: SP[] = [[ex, y - 2, 0]]
    for (let i = 0; i <= 8; i++) pts.push([inner(i / 8), lerp(y - 2, y + h + 2, i / 8)])
    pts.push([ex, y + h + 2, 0])
    const d = smooth(pts)
    o += paintD(d, curtainPaint)
    if (k.hi) o += paintD(d, lin(k, `stsh${sd}`, [[0, '#1a0208', 0.55], [1, '#1a0208', 0]], ex, 0, inner(0.5), 0))
    else o += flat(k, d, '#5e0f1f', 0.25)
  }
  // Valance with a gold trim.
  let sw = ''
  const n = 7
  for (let i = 0; i < n; i++) {
    const a = x + (w * i) / n
    const b = x + (w * (i + 1)) / n
    sw += `M${n1(a)} ${n1(y - 2)}H${n1(b)}V${n1(y + h * 0.05)}Q${n1((a + b) / 2)} ${n1(y + h * 0.13)} ${n1(a)} ${n1(y + h * 0.05)}Z`
  }
  o += flat(k, sw, '#a3223a')
  if (k.hi) {
    let trim = ''
    for (let i = 0; i < n; i++) {
      const a = x + (w * i) / n
      const b = x + (w * (i + 1)) / n
      trim += `M${n1(a)} ${n1(y + h * 0.05)}Q${n1((a + b) / 2)} ${n1(y + h * 0.13)} ${n1(b)} ${n1(y + h * 0.05)}`
    }
    o += paintD(sw, vg(k, 'stv', [[0, '#3a0610', 0.5], [1, '#3a0610', 0]], y, y + h * 0.1))
    o += strokeD(k, trim, '#e8b04a', h * 0.008) + strokeD(k, trim, '#fff0b0', h * 0.0025, 0.8)
    // Footlights along the front edge.
    for (let i = 0; i < 7; i++) {
      const fx = x + (w * (i + 0.5)) / 7
      o += soft(k, fx, y + h, w * 0.06, h * 0.05, '#ffd98a', 0.6)
    }
  }
  return o
}

function volcanoScene(k: Kit, rng: Rng): string {
  const { x, w, h, y, hz } = k
  let o = fillBox(k, vg(k, 'vo', [[0, '#1b0911'], [0.4, '#471318'], [0.78, '#a3321f'], [1, '#ff7a36']], y, hz))
  const sd = k.side
  const vx = x + w * (0.5 + sd * 0.3)
  const vy = y + h * 0.36
  const [far] = ridge(k, rng.int(0, 1e6), hz, h * 0.12, 2.6)
  o += flat(k, far, mix('#5a1d22', '#c2502e', 0.35))
  // Plume of smoke rising and drifting, lit from underneath by the crater.
  if (!k.lo) {
    const sr = rng.fork('smoke')
    const specs: CloudSpec[] = []
    for (let i = 0; i < 6; i++) {
      const s = w * (0.045 + i * 0.016)
      specs.push({ x: vx + sd * w * (0.01 + i * 0.04 + i * i * 0.006) + sr.range(-0.015, 0.015) * w, y: Math.max(vy - h * (0.06 + i * 0.065), y + s * 0.95), s })
    }
    o += cloudLayer(k, 'vo', cumuli(sr, specs.filter((s) => calm(k, s.x, s.y, 1 + s.s / k.hr) > 0.45), [0, 1]), { lit: '#8a3a2a', shade: '#2e1a1e', rim: '#e0703a', belly: '#6a2a24' })
  }
  o += soft(k, vx, vy, w * 0.3, h * 0.26, '#ff9a3c', k.hi ? 0.6 : 0.5)
  // The cone: concave slopes up to a notched crater.
  const baseY = hz + h * 0.07
  const bw = w * 0.46
  const cw = w * 0.055
  const coneH = baseY - vy
  const cone = smooth([
    [vx - bw, baseY, 0],
    [vx - bw * 0.42, baseY - coneH * 0.4],
    [vx - cw * 1.5, vy + coneH * 0.08],
    [vx - cw, vy, 0.2],
    [vx - cw * 0.3, vy + h * 0.008, 0.4],
    [vx + cw * 0.4, vy - h * 0.004, 0.4],
    [vx + cw, vy, 0.2],
    [vx + cw * 1.5, vy + coneH * 0.08],
    [vx + bw * 0.45, baseY - coneH * 0.38],
    [vx + bw, baseY, 0],
  ])
  o += flat(k, cone, '#2a1418')
  const face = smooth([[vx + sd * cw, vy, 0.2], [vx + sd * cw * 1.5, vy + coneH * 0.08], [vx + sd * bw * 0.45, baseY - coneH * 0.38], [vx + sd * bw, baseY, 0], [vx + sd * bw * 0.25, baseY, 0], [vx + sd * cw * 0.5, vy + coneH * 0.45]])
  o += flat(k, face, '#45201f')
  // Lava rivulets glowing down the slopes, tapering as they cool.
  const lr = rng.fork('lava')
  let lava = ''
  let core = ''
  for (let i = 0; i < 3; i++) {
    const pts: P[] = [[vx + (i - 1) * cw * 0.6, vy + h * 0.004]]
    let px = pts[0][0]
    const dir = (i - 1) * 0.6 + lr.range(-0.3, 0.3)
    const len = lr.range(0.5, 0.9)
    for (let j = 1; j <= 6; j++) {
      px += (dir * 0.025 + lr.range(-0.008, 0.008)) * w
      pts.push([px, vy + (coneH * len * j) / 6])
    }
    lava += brush(pts, w * 0.016, w * 0.003)
    core += brush(pts.slice(0, 5), w * 0.006, w * 0.001)
  }
  if (k.hi) o += loop(k.c, 'lava', BREATHE, 3.6, 0, g({ filter: blur(k, w * 0.012, boxOf(vx - bw * 0.6, vy - h * 0.02, vx + bw * 0.6, baseY)) }, flat(k, lava, '#ff4a14', 0.8)), { timing: 'ease-in-out' })
  o += flat(k, lava, '#ff6a1a') + flat(k, core, '#ffd36a')
  o += flat(k, ellipse(vx, vy, cw * 1.05, h * 0.012), '#ffc34a') + soft(k, vx, vy - h * 0.02, w * 0.1, h * 0.08, '#ffd27a', 0.8, 'core')
  if (k.hi) {
    let sp = ''
    const er = rng.fork('erupt')
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + er.range(-0.7, 0.7)
      const r = h * er.range(0.03, 0.12)
      sp += dot(vx + Math.cos(a) * r, vy + Math.sin(a) * r, w * er.range(0.002, 0.005))
    }
    o += loop(k.c, `spark${k.bk}`, rise(0, h * 0.05), 1.8, 0, flat(k, sp, '#ffd36a', 0.9)) + haze(k, 'vo', hz + h * 0.05, h * 0.06, '#ff6a2a', 0.35)
  }
  o += groundPlane(k, 'vo', rng.int(0, 1e6), '#3a1c1c', '#140a0c')
  if (k.hi) o += soft(k, vx, k.gt + h * 0.02, w * 0.5, h * 0.1, '#ff6a2a', 0.3)
  if (k.hi) {
    // Glowing cracks in the basalt.
    let d = ''
    const cr = rng.fork('cracks')
    for (let i = 0; i < 5; i++) {
      let px = x + w * cr.next()
      let py = lerp(k.gt + h * 0.03, y + h, cr.next())
      if (k.ground && Math.abs(px - k.hx) < w * 0.1) continue
      d += `M${n1(px)} ${n1(py)}`
      for (let j = 0; j < 4; j++) {
        px += cr.range(-0.04, 0.04) * w
        py += cr.range(0.005, 0.03) * h
        d += `L${n1(px)} ${n1(py)}`
      }
    }
    o += strokeD(k, d, '#ff5a1a', w * 0.006, 0.7) + strokeD(k, d, '#ffc04a', w * 0.002)
    o += bokeh(k, rng.fork('embers'), 16, ['#ffb347', '#ff7a2a'], 0, 0.1, 1, 0.95, 0.002, 0.006, 0.9, 'rise')
  }
  return o
}

function candyScene(k: Kit, rng: Rng): string {
  const { x, w, h, y, hz } = k
  let o = fillBox(k, vg(k, 'cd', [[0, '#ffb3d9'], [0.5, '#e6c9ff'], [1, '#c6efff']], y, hz))
  const [sx, sy] = sunAt(k, 0.14)
  o += soft(k, sx, sy, w * 0.45, w * 0.45, '#fff6fb', 0.6)
  const cr = rng.fork('clouds')
  o += cloudLayer(k, 'cd', cumuli(cr, cloudSpots(k, cr, k.lo ? 2 : 3, 0.12, 0.55, 0.055, 0.085), k.L), { lit: '#fff5fb', shade: '#ffc0e0', rim: '#ffffff' })
  if (!k.lo) {
    const sp3 = buckets(3)
    let si = 0
    for (const [px, py] of scatter(k, rng.fork('sparkles'), k.hi ? 14 : 6, 0.03, 0.03, 0.97, 0.6, 1.4)) sp3[si++ % 3] += sparkle(px, py, w * rng.range(0.006, 0.014), 0.14)
    o += sp3.map((d, j) => loop(k.c, `ts${j}`, TWINKLE, 3.4 + j * 1.3, j * 1.7, flat(k, d, '#ffffff', 0.9), { timing: 'ease-in-out' })).join('')
  }
  const [far] = ridge(k, rng.int(0, 1e6), hz - h * 0.005, h * 0.1, 1.8)
  o += flat(k, far, mix('#9fe8cf', '#c6efff', 0.35))
  const [mid, , midY] = ridge(k, rng.int(0, 1e6), hz + h * 0.04, h * 0.07, 1.5)
  o += flat(k, mid, '#ff9ecf')
  // Icing poured over the pink hill: one shape along the crest with drips of varied length.
  const x0 = x - w * 0.03
  const x1 = x + w * 1.03
  const n = k.hi ? 48 : 16
  const dr = rng.fork('drips')
  const drips: [number, number, number][] = []
  for (let i = 0; i < (k.hi ? 9 : 5); i++) drips.push([x0 + (x1 - x0) * ((i + dr.range(0.2, 0.8)) / (k.hi ? 9 : 5)), w * dr.range(0.01, 0.018), h * dr.range(0.02, 0.05)])
  const topPts: SP[] = []
  const botPts: SP[] = []
  for (let i = 0; i <= n; i++) {
    const px = x0 + ((x1 - x0) * i) / n
    let drop = h * 0.014 + Math.sin(i * 1.7) * h * 0.003
    for (const [dx, dw, dl] of drips) drop += dl * Math.exp(-(((px - dx) / dw) ** 2))
    topPts.push([px, midY(px) - h * 0.004])
    botPts.push([px, midY(px) + drop])
  }
  const icing = smooth([...topPts, ...botPts.reverse()])
  o += flat(k, icing, '#d9669f', 0.35).replace('<path', `<path transform="translate(0 ${n1(h * 0.006)})"`) + flat(k, icing, '#fff3f9')
  if (k.hi) o += strokeD(k, smooth(topPts.map(([px, py]) => [px, py + h * 0.004] as SP), false), '#ffffff', h * 0.006, 0.9) + lollipops(k, rng.fork('pops'))
  o += groundPlane(k, 'cd', rng.int(0, 1e6), '#bdf5dc', '#8fe0c0')
  if (!k.lo) {
    // Sprinkles.
    const pr = rng.fork('sprinkles')
    const cols = ['#ff6fae', '#ffd84a', '#6fc8ff', '#b88aff', '#ffffff']
    const b = cols.map(() => '')
    for (let i = 0; i < (k.hi ? 40 : 16); i++) {
      const t = pr.next()
      const py = lerp(k.gt + h * 0.02, y + h, t)
      const px = x + w * pr.next()
      if (k.ground && Math.abs(px - k.hx) < w * 0.07 && py > -h * 0.05) continue
      const L = w * lerp(0.006, 0.014, t)
      const a = pr.range(0, Math.PI)
      b[pr.int(0, cols.length - 1)] += `M${n1(px - Math.cos(a) * L)} ${n1(py - Math.sin(a) * L * 0.5)}L${n1(px + Math.cos(a) * L)} ${n1(py + Math.sin(a) * L * 0.5)}`
    }
    b.forEach((d, i) => (o += strokeD(k, d, cols[i], w * 0.006)))
  }
  return o
}

function lollipops(k: Kit, rng: Rng): string {
  let o = ''
  for (const sd of [-1, 1]) {
    const px = k.x + k.w * (0.5 + sd * rng.range(0.36, 0.42))
    const top = k.hz - k.h * rng.range(0.08, 0.16)
    const r = k.w * rng.range(0.05, 0.065)
    if (calm(k, px, top, 1.3) < 0.5) continue
    o += flat(k, rect(px - k.w * 0.005, top, k.w * 0.01, k.gt - top + k.h * 0.05), '#fff6ea')
    const col = sd < 0 ? '#ff6fae' : '#6fc8ff'
    let spiral = ''
    for (let i = 0; i <= 40; i++) {
      const th = (i / 40) * TAU * 2.2
      const rr = (r * 0.92 * i) / 40
      spiral += `${i ? 'L' : 'M'}${n1(px + Math.cos(th) * rr)} ${n1(top + Math.sin(th) * rr)}`
    }
    o += flat(k, dot(px, top, r), col) + strokeD(k, spiral, '#ffffff', r * 0.2, 0.9)
    o += paintD(dot(px, top, r), rad(k, `lp${sd}`, [[0, '#ffffff', 0], [0.7, '#ffffff', 0], [1, shadowOf(col, 0.5), 0.45]], px + k.L[0] * r * 0.3, top + k.L[1] * r * 0.3, r * 1.2))
    o += flat(k, ellipse(px + k.L[0] * r * 0.45, top + k.L[1] * r * 0.45, r * 0.22, r * 0.14), '#ffffff', 0.8)
  }
  return o
}

/* ---- Ground shadow -------------------------------------------------------------- */

/** Scene-tinted shadow colour: shadows pick up the ground's hue instead of going grey. */
function shadowTint(c: Ctx): string {
  const s = c.sec('scene')
  const kind = s.s('background') || 'gradient'
  if (kind === 'scene') {
    const t: Record<string, string> = {
      sky: '#173a1c',
      meadow: '#1c4a1a',
      forest: '#16361a',
      sunset: '#12061a',
      night: '#04071a',
      beach: '#6a4520',
      city: '#08061a',
      snow: '#2d4f86',
      space: '#04020c',
      underwater: '#03162a',
      dungeon: '#07050a',
      stage: '#1a0804',
      volcano: '#120304',
      candy: '#7a3a6a',
    }
    return t[s.s('preset') || 'sky'] ?? '#1a1424'
  }
  if (kind === 'none') return '#1a1424'
  return mix(s.c('color1', '#2b3a67'), '#0a0812', 0.72)
}

export function drawGroundShadow(c: Ctx, model: Model, box: Box): string {
  void box
  const P = c.paint
  const w = model.ctx.hr ? model.ctx.hr.m.hipHalf * 2.2 : (model.ctx.cr?.m.bodyLen ?? 200) * 0.6 + (model.ctx.cr?.m.bodyR ?? 100)
  const tint = shadowTint(c)
  if (!(c.baked && P.detail > 0)) return P.flat(ellipse(0, 0, w * 0.75, w * 0.12), tint, 0.2)
  // Baked: a soft penumbra falling away from the light, and a dark contact core under the feet.
  const L = P.style.light
  const dx = -L[0] * w * 0.42
  const soft1 = el('ellipse', { cx: f(dx), cy: f(w * 0.01), rx: f(w * (0.95 + Math.abs(L[0]) * 0.4)), ry: f(w * 0.17), fill: shadowFill(c, tint), 'fill-opacity': 0.42 })
  const core = el('ellipse', { cx: f(dx * 0.12), cy: 0, rx: f(w * 0.62), ry: f(w * 0.075), fill: shadowFill(c, tint), 'fill-opacity': 0.55 })
  return soft1 + core
}

function shadowFill(c: Ctx, tint: string): string {
  const col = c.paint.col(tint)
  return url(
    c.defs.add(`sgs${col.slice(1)}`, (id) =>
      el(
        'radialGradient',
        { id },
        el('stop', { offset: 0, 'stop-color': col, 'stop-opacity': 0.9 }),
        el('stop', { offset: 0.45, 'stop-color': col, 'stop-opacity': 0.55 }),
        el('stop', { offset: 0.75, 'stop-color': col, 'stop-opacity': 0.18 }),
        el('stop', { offset: 1, 'stop-color': col, 'stop-opacity': 0 }),
      ),
    ),
  )
}

/* ---- Frames ----------------------------------------------------------------- */

function frameShape(kind: string, box: Box, inset = 0): string {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const r = box.w / 2 - inset
  switch (kind) {
    case 'circle':
      return circle(cx, cy, r)
    case 'rounded':
      return roundRect(box.x + inset, box.y + inset, box.w - inset * 2, box.h - inset * 2, box.w * 0.18)
    case 'hexagon':
      return poly(regularPts(cx, cy, r, 6, 0))
    case 'diamond':
      return poly(regularPts(cx, cy, r, 4, -90))
    case 'star':
      return smooth(starPts(cx, cy, r, r * 0.72, 8).map(([x, y]) => [x, y, 0.4] as [number, number, number]))
    case 'shield':
      return smooth([[box.x + inset, box.y + inset, 0], [box.x + box.w - inset, box.y + inset, 0], [box.x + box.w - inset, cy], [cx, box.y + box.h - inset, 0], [box.x + inset, cy]])
    case 'arch':
      return `M${box.x + inset} ${box.y + box.h - inset}V${cy}A${r} ${r} 0 0 1 ${box.x + box.w - inset} ${cy}V${box.y + box.h - inset}Z`
    default:
      return rect(box.x, box.y, box.w, box.h)
  }
}

/** Samples `smooth()`'s Catmull-Rom curve (with per-point smoothness) as points. */
function sampleSmoothSP(points: SP[], per = 8): P[] {
  const n = points.length
  const at = (i: number): P => {
    const p = points[(i + n) % n]
    return [p[0], p[1]]
  }
  const k = (i: number): number => {
    const p = points[(i + n) % n]
    return p.length > 2 ? (p as [number, number, number])[2] : 1
  }
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t1 = k(i) / 6
    const t2 = k(i + 1) / 6
    const c1: P = [p1[0] + (p2[0] - p0[0]) * t1, p1[1] + (p2[1] - p0[1]) * t1]
    const c2: P = [p2[0] - (p3[0] - p1[0]) * t2, p2[1] - (p3[1] - p1[1]) * t2]
    for (let s = 0; s < per; s++) out.push(cubicAt(p1, c1, c2, p2, s / per))
  }
  return out
}

/** The frame outline as evenly spaced points, clockwise, starting at the bottom centre. */
function frameOutline(kind: string, box: Box, inset: number, n = 120): P[] {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const r = box.w / 2 - inset
  let pts: P[] = []
  const arc = (ax: number, ay: number, ar: number, a0: number, a1: number, steps: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = lerp(a0, a1, i / steps)
      pts.push([ax + Math.cos(a) * ar, ay + Math.sin(a) * ar])
    }
  }
  switch (kind) {
    case 'circle':
      arc(cx, cy, r, 0, TAU * (63 / 64), 63)
      break
    case 'rounded': {
      const x0 = box.x + inset
      const y0 = box.y + inset
      const w = box.w - inset * 2
      const h = box.h - inset * 2
      const rr = Math.min(box.w * 0.18, w / 2, h / 2)
      arc(x0 + w - rr, y0 + rr, rr, -Math.PI / 2, 0, 8)
      arc(x0 + w - rr, y0 + h - rr, rr, 0, Math.PI / 2, 8)
      arc(x0 + rr, y0 + h - rr, rr, Math.PI / 2, Math.PI, 8)
      arc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, 8)
      break
    }
    case 'hexagon':
      pts = regularPts(cx, cy, r, 6, 0)
      break
    case 'diamond':
      pts = regularPts(cx, cy, r, 4, -90)
      break
    case 'star':
      pts = sampleSmoothSP(starPts(cx, cy, r, r * 0.72, 8).map(([x, y]) => [x, y, 0.4] as SP), 6)
      break
    case 'shield':
      pts = sampleSmoothSP([[box.x + inset, box.y + inset, 0], [box.x + box.w - inset, box.y + inset, 0], [box.x + box.w - inset, cy], [cx, box.y + box.h - inset, 0], [box.x + inset, cy]], 12)
      break
    case 'arch':
      pts.push([box.x + inset, box.y + box.h - inset])
      arc(cx, cy, r, Math.PI, TAU, 24)
      pts.push([box.x + box.w - inset, box.y + box.h - inset])
      break
    default:
      pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]
  }
  if (signedArea(pts) < 0) pts.reverse()
  // Resample by arc length.
  const m = pts.length
  const cum = [0]
  for (let i = 1; i <= m; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i % m]))
  const total = cum[m]
  const out: P[] = []
  let j = 0
  for (let i = 0; i < n; i++) {
    const t = (i / n) * total
    while (j < m - 1 && cum[j + 1] < t) j++
    const a = pts[j]
    const b = pts[(j + 1) % m]
    const u = (t - cum[j]) / (cum[j + 1] - cum[j] || 1)
    out.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)])
  }
  let best = 0
  let score = -Infinity
  out.forEach(([px, py], i) => {
    const sc = py - Math.abs(px - cx) * 0.6
    if (sc > score) {
      score = sc
      best = i
    }
  })
  return [...out.slice(best), ...out.slice(0, best)]
}

export function frameClip(c: Ctx, box: Box): string {
  const s = c.sec('scene')
  const ringW = s.s('ring') === 'none' ? 0 : box.w * 0.035
  const id = c.defs.unique('fr')
  c.defs.put(id, el('clipPath', { id }, el('path', { d: frameShape(s.s('frame'), box, ringW * 0.5) })))
  return id
}

const METALS: Record<string, { dark: string; mid: string; light: string; spec: string; gem: string }> = {
  gold: { dark: '#7a4d05', mid: '#d19a1c', light: '#fbe08a', spec: '#fffbe8', gem: '#d42a44' },
  silver: { dark: '#4e5563', mid: '#a9b0bd', light: '#f1f4f8', spec: '#ffffff', gem: '#2f6fe0' },
  bronze: { dark: '#4f260c', mid: '#b0652a', light: '#f3b77e', spec: '#fff0dc', gem: '#1c9a68' },
}

export function drawFrame(c: Ctx, box: Box): string {
  const s = c.sec('scene')
  const ring = s.s('ring')
  if (!ring || ring === 'none') return ''
  const P = c.paint
  const kind = s.s('frame')
  const rw = box.w * 0.035
  const d = frameShape(kind, box, rw * 0.5)
  const hi = c.baked && P.detail > 0
  const rich = c.baked && P.detail === 2
  const bk = boxKey(box)
  const L = P.style.light
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const R = box.w / 2
  const stroke = (col: string, width: number, extra: Record<string, string | number> = {}) =>
    el('path', { d, fill: 'none', stroke: col, 'stroke-width': f(width), 'stroke-linejoin': 'round', ...extra })
  const at = (inset: number, col: string, width: number, extra: Record<string, string | number> = {}) =>
    el('path', { d: frameShape(kind, box, inset), fill: 'none', stroke: col, 'stroke-width': f(width), 'stroke-linejoin': 'round', ...extra })
  /** A userSpace gradient running from the lit side of the frame to the far side. */
  const litGrad = (key: string, stops: Stop[], flip = false) => {
    const sg = flip ? -1 : 1
    return url(
      c.defs.add(`fl${key}${bk}`, (id) =>
        el(
          'linearGradient',
          { id, gradientUnits: 'userSpaceOnUse', x1: f(cx + L[0] * R * sg), y1: f(cy + L[1] * R * sg), x2: f(cx - L[0] * R * sg), y2: f(cy - L[1] * R * sg) },
          stops.map(([o, col, a]) => el('stop', { offset: f(o), 'stop-color': P.col(col), 'stop-opacity': a !== undefined && a < 1 ? f(a) : undefined })).join(''),
        ),
      ),
    )
  }
  /** Raised-edge highlights: the outer lip catches the light on the lit side, the inner lip on the far side. */
  const bevel = (light: string, dark: string, strength = 1, w0 = 0, w1 = rw) =>
    at(w0 + (w1 - w0) * 0.16, litGrad(`bo${light.slice(1)}`, [[0, light, 0.95 * strength], [0.5, light, 0.2 * strength], [1, light, 0]]), (w1 - w0) * 0.14) +
    at(w0 + (w1 - w0) * 0.86, litGrad(`bi${light.slice(1)}`, [[0, light, 0.75 * strength], [0.5, light, 0.1 * strength], [1, light, 0]], true), (w1 - w0) * 0.1) +
    at(w0 + (w1 - w0) * 0.97, litGrad(`bd${dark.slice(1)}`, [[0, dark, 0.7 * strength], [1, dark, 0.15 * strength]]), (w1 - w0) * 0.08)
  /** A soft shadow the rim casts onto the picture. */
  const innerShadow = (op = 0.45) => {
    if (!hi) return at(rw * 1.08, '#000000', rw * 0.2, { 'stroke-opacity': f(op * 0.4) })
    // Stacked bands fading inward (a blur would cost a full-canvas filter pass), pushed
    // away from the light so the shadow is deepest under the lit side of the rim.
    const dark = P.col('#0a0610')
    const tr = `translate(${f(-L[0] * rw * 0.22)} ${f(-L[1] * rw * 0.22)})`
    let o = ''
    for (const [ins, wd, a] of [[1.04, 0.16, 0.85], [1.2, 0.18, 0.55], [1.38, 0.2, 0.32], [1.58, 0.22, 0.16], [1.8, 0.24, 0.06]])
      o += at(rw * ins, dark, rw * wd, { 'stroke-opacity': f(op * a), transform: tr })
    return o
  }
  /** Sweep of colour around the rim (approximates a conic gradient), masked to the band. */
  const sweep = (key: string, colorAt: (theta: number) => string, width: number, n = 48) => {
    const mask = c.defs.add(`frm${kind}${Math.round(width * 10)}${bk}`, (id) =>
      el('mask', { id, maskUnits: 'userSpaceOnUse', x: f(box.x - 2), y: f(box.y - 2), width: f(box.w + 4), height: f(box.h + 4) }, el('path', { d, fill: 'none', stroke: '#ffffff', 'stroke-width': f(width), 'stroke-linejoin': 'round' })),
    )
    const la = Math.atan2(L[1], L[0])
    let wedges = ''
    const RR = R * 1.5
    for (let i = 0; i < n; i++) {
      const a0 = la + (i / n) * TAU - 0.01
      const a1 = la + ((i + 1) / n) * TAU + 0.01
      wedges += el('path', { d: `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a0) * RR)} ${f(cy + Math.sin(a0) * RR)}L${f(cx + Math.cos(a1) * RR)} ${f(cy + Math.sin(a1) * RR)}Z`, fill: P.col(colorAt(((i + 0.5) / n) * TAU)) })
    }
    void key
    return g({ mask: url(mask) }, wedges)
  }
  const outline = () => frameOutline(kind, box, rw * 0.5)
  /** The rim point that faces the light: where the specular glint sits. */
  const litPoint = (): P => {
    let best: P = [cx, cy]
    let sc = -Infinity
    for (const p of outline()) {
      const v = (p[0] - cx) * L[0] + (p[1] - cy) * L[1]
      if (v > sc) {
        sc = v
        best = p
      }
    }
    return best
  }
  const glint = (col: string, size: number) => {
    if (!hi) return ''
    const [gx, gy] = litPoint()
    return loop(c, 'glint', '0%,100%{opacity:1}45%{opacity:1}60%{opacity:.35}75%{opacity:1}', 5, 0, el('ellipse', { cx: f(gx), cy: f(gy), rx: f(size * 1.6), ry: f(size * 1.6), fill: softGlow(c, col), 'fill-opacity': 0.7 }) + el('path', { d: sparkle(gx, gy, size, 0.14), fill: P.col(col) }), { timing: 'ease-in-out' })
  }
  const ringCol = s.c('ringColor', '#f2d14a')

  switch (ring) {
    case 'solid': {
      if (!hi) return stroke(P.col(ringCol), rw)
      return (
        innerShadow() +
        stroke(P.col(shadowOf(ringCol, 0.35)), rw * 1.04) +
        stroke(P.col(ringCol), rw * 0.9) +
        at(rw * 0.42, litGrad(`sg${ringCol.slice(1)}`, [[0, highlightOf(ringCol, 0.5), 0.55], [0.55, highlightOf(ringCol, 0.5), 0], [1, shadowOf(ringCol, 0.3), 0.35]]), rw * 0.5) +
        bevel(highlightOf(ringCol, 0.75), shadowOf(ringCol, 0.6)) +
        glint('#ffffff', rw * 0.55)
      )
    }
    case 'double': {
      const col = P.col(ringCol)
      if (!hi) return stroke(col, rw * 0.45) + at(rw * 1.4, col, rw * 0.25)
      return (
        innerShadow(0.35) +
        stroke(P.col(shadowOf(ringCol, 0.4)), rw * 0.52) +
        stroke(col, rw * 0.42) +
        at(rw * 0.36, litGrad(`dh${ringCol.slice(1)}`, [[0, highlightOf(ringCol, 0.8), 0.9], [0.6, highlightOf(ringCol, 0.8), 0]]), rw * 0.1) +
        at(rw * 1.4, P.col(shadowOf(ringCol, 0.4)), rw * 0.3) +
        at(rw * 1.4, col, rw * 0.22) +
        at(rw * 1.36, litGrad(`dh${ringCol.slice(1)}`, [[0, highlightOf(ringCol, 0.8), 0.9], [0.6, highlightOf(ringCol, 0.8), 0]]), rw * 0.06) +
        glint('#ffffff', rw * 0.45)
      )
    }
    case 'dashed': {
      const dash = { 'stroke-dasharray': `${f(rw * 1.4)} ${f(rw)}`, 'stroke-linecap': 'round' }
      if (!hi) return stroke(P.col(ringCol), rw * 0.6, dash)
      return (
        stroke(P.col(shadowOf(ringCol, 0.8)), rw * 0.66, { ...dash, 'stroke-opacity': 0.45, transform: `translate(${f(-L[0] * rw * 0.14)} ${f(-L[1] * rw * 0.14)})` }) +
        stroke(P.col(ringCol), rw * 0.6, dash) +
        stroke(P.col(highlightOf(ringCol, 0.7)), rw * 0.2, { ...dash, 'stroke-opacity': 0.7, transform: `translate(${f(L[0] * rw * 0.12)} ${f(L[1] * rw * 0.12)})` })
      )
    }
    case 'gold':
    case 'silver':
    case 'bronze': {
      const m = METALS[ring]
      if (!hi) return stroke(P.linear(`ring${m.light.slice(1)}${bk}`, [[0, m.light], [0.5, m.mid], [1, m.dark]], [0, 0], [1, 1], box), rw) + at(rw * 0.2, P.col(m.light), rw * 0.12, { 'stroke-opacity': 0.6 })
      // Polished metal: a sweep of reflections around the band, a raised lip on both
      // edges, a fine groove down the middle, a glint where it faces the light.
      const tone = (th: number) => {
        const b = clamp01(0.5 + 0.34 * Math.cos(th) + 0.2 * Math.cos(th * 3 + 0.6) + 0.08 * Math.cos(th * 7))
        return b < 0.5 ? mix(m.dark, m.mid, b * 2) : mix(m.mid, m.light, (b - 0.5) * 2)
      }
      let o = innerShadow(0.5) + stroke(P.col(m.dark), rw * 1.06) + sweep(ring, tone, rw * 0.94)
      o += bevel(m.spec, m.dark, 1)
      o += stroke(P.col(m.dark), rw * 0.05, { 'stroke-opacity': 0.45 })
      o += at(rw * 0.56, P.col(m.light), rw * 0.035, { 'stroke-opacity': 0.5 })
      o += glint(m.spec, rw * 0.8)
      if (rich) o += gem(c, frameOutline(kind, box, rw * 0.5)[0], rw * 0.78, m.gem, m)
      return o
    }
    case 'rainbow': {
      const hue = (th: number) => hueShift('#ff5a5a', (th / TAU) * 360)
      if (!hi) return stroke(P.linear('rainbow', [[0, '#ff4d4d'], [0.2, '#ffb84d'], [0.4, '#fff24d'], [0.6, '#4dff88'], [0.8, '#4db8ff'], [1, '#b84dff']], [0, 0], [1, 1], box), rw)
      return (
        innerShadow(0.35) +
        stroke(P.col('#2a1f3a'), rw * 1.04, { 'stroke-opacity': 0.5 }) +
        sweep('rb', hue, rw * 0.92, 36) +
        bevel('#ffffff', '#2a1f3a', 0.9) +
        at(rw * 0.45, litGrad('rbs', [[0, '#ffffff', 0.45], [0.45, '#ffffff', 0]]), rw * 0.3) +
        glint('#ffffff', rw * 0.65)
      )
    }
    case 'glow': {
      const col = P.col(ringCol)
      if (!hi) return stroke(col, rw * 2.2, { 'stroke-opacity': 0.25 }) + stroke(col, rw * 1.2, { 'stroke-opacity': 0.5 }) + stroke(mix(col, '#ffffff', 0.5), rw * 0.5)
      // Neon tube: a bloom around it, a coloured glass tube, a white-hot core.
      const fid = c.defs.add(`frg${bk}`, (id) =>
        el('filter', { id, filterUnits: 'userSpaceOnUse', x: f(box.x), y: f(box.y), width: f(box.w), height: f(box.h) }, el('feGaussianBlur', { stdDeviation: f(rw * 0.7) })),
      )
      return (
        loop(c, 'neon', '0%,100%{opacity:1}50%{opacity:.7}', 3.2, 0, g({ filter: url(fid) }, stroke(col, rw * 1.9, { 'stroke-opacity': 0.85 })), { timing: 'ease-in-out' }) +
        stroke(col, rw * 0.8) +
        stroke(mix(col, '#ffffff', 0.55), rw * 0.42) +
        stroke('#ffffff', rw * 0.14, { 'stroke-opacity': 0.9 })
      )
    }
    case 'laurel':
      return laurel(c, box, kind, rw, d, hi, bevel, innerShadow)
  }
  return ''
}

function softGlow(c: Ctx, col: string): string {
  const cc = c.paint.col(col)
  return url(
    c.defs.add(`ssglow${cc.slice(1)}`, (id) =>
      el('radialGradient', { id }, PROFILES.glow.map(([o, a]) => el('stop', { offset: f(o), 'stop-color': cc, 'stop-opacity': a < 1 ? f(a) : undefined })).join('')),
    ),
  )
}

/** A cabochon set in the rim: bezel, lit dome, specular dot. */
function gem(c: Ctx, [gx, gy]: P, r: number, col: string, m: { dark: string; light: string; spec: string }): string {
  const P = c.paint
  const L = P.style.light
  const cc = P.col(col)
  const id = c.defs.add(`fgem${cc.slice(1)}`, (gid) =>
    el(
      'radialGradient',
      { id: gid, cx: f(0.5 + L[0] * 0.25), cy: f(0.5 + L[1] * 0.25), r: '0.75' },
      el('stop', { offset: 0, 'stop-color': P.col(highlightOf(col, 0.55)) }),
      el('stop', { offset: 0.45, 'stop-color': cc }),
      el('stop', { offset: 1, 'stop-color': P.col(shadowOf(col, 0.6)) }),
    ),
  )
  return (
    el('path', { d: circle(gx, gy, r * 1.3), fill: P.col(m.dark) }) +
    el('path', { d: circle(gx, gy, r * 1.18), fill: P.col(m.light) }) +
    el('path', { d: circle(gx, gy, r), fill: url(id) }) +
    el('path', { d: ellipse(gx - L[0] * -r * 0.38, gy - L[1] * -r * 0.38, r * 0.3, r * 0.2), fill: P.col(m.spec), 'fill-opacity': 0.9 }) +
    el('path', { d: circle(gx - L[0] * r * 0.4, gy - L[1] * r * 0.4, r * 0.12), fill: P.col('#ffffff'), 'fill-opacity': 0.5 })
  )
}

/** Laurel wreath: a gold band, leaves climbing both sides, a ribbon at the bottom. */
function laurel(
  c: Ctx,
  box: Box,
  kind: string,
  rw: number,
  d: string,
  hi: boolean,
  bevel: (light: string, dark: string, strength?: number, w0?: number, w1?: number) => string,
  innerShadow: (op?: number) => string,
): string {
  const P = c.paint
  const L = P.style.light
  const pts = frameOutline(kind, box, rw * 0.5, 120)
  const N = pts.length
  const band = el('path', { d, fill: 'none', stroke: P.col('#c79212'), 'stroke-width': f(rw * 0.3), 'stroke-linejoin': 'round' })
  let dk = ''
  let lt = ''
  let rib = ''
  let berries = ''
  let berryHl = ''
  const count = 13
  for (const dir of [1, -1]) {
    for (let j = 0; j < count; j++) {
      const t = 0.03 + j * 0.027
      const idx = (((Math.round(dir * t * N) % N) + N) % N)
      const p = pts[idx]
      const q = pts[(idx + dir + N) % N]
      const tl = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1
      const tx = (q[0] - p[0]) / tl
      const ty = (q[1] - p[1]) / tl
      const ox = dir === 1 ? ty : -ty
      const oy = dir === 1 ? -tx : tx
      const size = rw * (1.4 - j * 0.035)
      for (const side of [1, -1]) {
        const ang = 0.6 * side
        const vx = tx * Math.cos(ang) + ox * Math.sin(ang)
        const vy = ty * Math.cos(ang) + oy * Math.sin(ang)
        const bx = p[0] + ox * side * rw * 0.1
        const by = p[1] + oy * side * rw * 0.1
        const ex = bx + vx * size * 1.9
        const ey = by + vy * size * 1.9
        const nx = -vy * size * 0.62
        const ny = vx * size * 0.62
        const mx = (bx + ex) / 2
        const my = (by + ey) / 2
        const halfA = `M${f(bx)} ${f(by)}Q${f(mx + nx)} ${f(my + ny)} ${f(ex)} ${f(ey)}Z`
        const halfB = `M${f(bx)} ${f(by)}Q${f(mx - nx)} ${f(my - ny)} ${f(ex)} ${f(ey)}Z`
        const aLit = nx * L[0] + ny * L[1] > 0
        if (hi) {
          lt += aLit ? halfA : halfB
          dk += aLit ? halfB : halfA
          rib += `M${f(bx)} ${f(by)}L${f(ex)} ${f(ey)}`
        } else dk += halfA + halfB
      }
      if (hi && j % 3 === 1) {
        const qx = p[0] - ox * rw * 0.55
        const qy = p[1] - oy * rw * 0.55
        berries += circle(qx, qy, rw * 0.22)
        berryHl += circle(qx + L[0] * rw * 0.08, qy + L[1] * rw * 0.08, rw * 0.08)
      }
    }
  }
  let o = hi ? innerShadow(0.35) : ''
  o += band + (hi ? bevel('#fff1a8', '#6a4a08', 0.8, rw * 0.35, rw * 0.65) : '')
  o += el('path', { d: dk, fill: P.col(hi ? '#4f8f34' : '#7cb342') })
  if (hi) {
    o += el('path', { d: lt, fill: P.col('#8cc85a') })
    o += el('path', { d: rib, fill: 'none', stroke: P.col('#3a6a24'), 'stroke-width': f(rw * 0.06), 'stroke-opacity': 0.6 })
    o += el('path', { d: berries, fill: P.col('#c23a3a') }) + el('path', { d: berryHl, fill: P.col('#ffd0c8'), 'fill-opacity': 0.8 })
    // Ribbon bow at the bottom.
    const [bx, by] = pts[0]
    const s = rw * 1.1
    const bow =
      `M${f(bx)} ${f(by)}C${f(bx - s * 1.6)} ${f(by - s * 1.1)} ${f(bx - s * 1.9)} ${f(by + s * 0.9)} ${f(bx)} ${f(by)}Z` +
      `M${f(bx)} ${f(by)}C${f(bx + s * 1.6)} ${f(by - s * 1.1)} ${f(bx + s * 1.9)} ${f(by + s * 0.9)} ${f(bx)} ${f(by)}Z` +
      `M${f(bx - s * 0.2)} ${f(by)}L${f(bx - s * 0.9)} ${f(by + s * 1.5)}L${f(bx - s * 0.45)} ${f(by + s * 1.3)}L${f(bx - s * 0.3)} ${f(by + s * 1.7)}Z` +
      `M${f(bx + s * 0.2)} ${f(by)}L${f(bx + s * 0.9)} ${f(by + s * 1.5)}L${f(bx + s * 0.45)} ${f(by + s * 1.3)}L${f(bx + s * 0.3)} ${f(by + s * 1.7)}Z`
    o += el('path', { d: bow, fill: P.col('#b8283c') }) + el('path', { d: circle(bx, by, s * 0.32), fill: P.col('#d8455a') })
  }
  return o
}

export const shade = shadowOf

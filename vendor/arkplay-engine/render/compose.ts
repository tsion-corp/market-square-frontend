/* Composing a frame into an SVG document: pose → bone matrices → parts sorted by depth
 * → background, shadow, frame and effects around them.
 *
 * Baked stills (`ctx.baked`, RenderOptions.quality 'high') also get:
 *  - contact shadows / ambient occlusion where layers overlap (hair on the forehead, the
 *    chin over the neck, arms against the torso, a jacket over a shirt): each "band" blurs
 *    the silhouettes of the upper layers and lays the result only on the layers directly
 *    under them (an alpha mask made of `<use>`s of those parts), so nothing falls on the
 *    background. Casters that do not touch get separate layers so each region stays small.
 *    Skipped for `flat` shading.
 *  - a finishing filter on the whole avatar: a silhouette line heavier on the shadow side
 *    (from `outline` and `ink`), the scene's key-light colour, and a light wrap of the rim
 *    light on the edges facing it (a crisp rim line in `rim` shading).
 * Nothing here runs for `detail: low` or animation frames (`quality: 'standard'`).
 *
 * resvg safety: parts entirely outside the crop are skipped, and layers inside partly
 * visible parts that resvg could not place are removed (see `cullLayers`). */

import { applyM, boundsOf, clamp, IDENTITY, mul, rotateM, scaleM, translateM, type Box, type Mat, type P } from '../core/math.ts'
import { f } from '../core/path.ts'
import { el, escapeXml, g, matrixAttr } from '../core/svg.ts'
import { mix, toLch } from '../core/color.ts'
import type { Pose } from '../rig/skeleton.ts'
import { drawBackground, drawFrame, drawGroundShadow, frameClip } from '../parts/shared/scene.ts'
import { CZ } from '../parts/creature/head.ts'
import { Z } from './context.ts'
import { frameParts, type Model } from './model.ts'
import { key64, pathBounds } from './painter.ts'
import type { Crop, FrameState, Part, RenderOptions } from './types.ts'

export interface Frame {
  pose: Pose
  state: FrameState
}

/** Rough local bounds of a part from the geometry in its SVG. */
const boundsCache = new WeakMap<Part, Box>()
export function partBounds(p: Part): Box {
  if (p.bounds) return p.bounds
  const hit = boundsCache.get(p)
  if (hit) return hit
  const pts: P[] = []
  const reD = /\sd="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = reD.exec(p.svg))) {
    const b = pathBounds(m[1])
    if (b.w || b.h) pts.push([b.x, b.y], [b.x + b.w, b.y + b.h])
  }
  const reC = /<(?:circle|ellipse)[^>]*?cx="([-\d.]+)"[^>]*?cy="([-\d.]+)"[^>]*?(?:r|rx)="([-\d.]+)"/g
  while ((m = reC.exec(p.svg))) {
    const cx = +m[1]
    const cy = +m[2]
    const r = +m[3]
    pts.push([cx - r, cy - r], [cx + r, cy + r])
  }
  const b = boundsOf(pts)
  boundsCache.set(p, b)
  return b
}

export function worldBounds(parts: Part[], mats: Map<string, Mat>, filter?: (p: Part) => boolean): Box {
  const pts: P[] = []
  for (const p of parts) {
    if (filter && !filter(p)) continue
    const b = partBounds(p)
    if (!b.w && !b.h) continue
    const m = mats.get(p.bone) ?? mats.get('world')
    if (!m) continue
    for (const c of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as P[]) pts.push(applyM(m, c))
  }
  return boundsOf(pts)
}

function squareAround(b: Box, pad: number): Box {
  const side = Math.max(b.w, b.h) * (1 + pad * 2)
  return { x: b.x + b.w / 2 - side / 2, y: b.y + b.h / 2 - side / 2, w: side, h: side }
}

export function cropBox(model: Model, crop: Crop, parts: Part[], mats: Map<string, Mat>, padding = 0): Box {
  const pad = (b: Box, p: number): Box => ({ x: b.x - b.w * p, y: b.y - b.h * p, w: b.w * (1 + 2 * p), h: b.h * (1 + 2 * p) })
  switch (crop) {
    case 'full':
      return pad(model.boxes.full, padding)
    case 'head':
      return pad(model.boxes.head, padding)
    case 'bust':
      return pad(model.boxes.bust, padding)
    case 'portrait':
      return pad(model.boxes.portrait, padding)
    case 'fit':
    default: {
      const b = worldBounds(parts, mats, (p) => p.bone !== 'world' || p.z > -900)
      const withGround: Box = { x: b.x, y: b.y, w: b.w, h: Math.max(b.h, -b.y + 8) }
      return squareAround(withGround, 0.05 + padding)
    }
  }
}

/** Parts in draw order with their world matrices, ready to be written out. */
export function layoutFrame(model: Model, frame: Frame): { parts: Part[]; mats: Map<string, Mat> } {
  const mats = model.ctx.skel.world(frame.pose)
  const parts = frameParts(model, frame.state)
  const order = parts.map((p, i) => ({ p, i }))
  order.sort((a, b) => a.p.z - b.p.z || a.i - b.i)
  return { parts: order.map((o) => o.p), mats }
}

const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

const inflate = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + d * 2, h: b.h + d * 2 })
/** Grows a crop box by a fraction of its own size on each axis. Regions of the compositor's
 *  enclosing layers must stay within ENCLOSING of the canvas on BOTH axes (see cullLayers); a
 *  width-based margin put them 1.5 canvases above a wide, short window and resvg panicked. */
const grow = (b: Box, k: number): Box => ({ x: b.x - b.w * k, y: b.y - b.h * k, w: b.w * (1 + 2 * k), h: b.h * (1 + 2 * k) })

function intersection(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null
}

function union(bs: Box[]): Box | null {
  if (!bs.length) return null
  let x = Infinity
  let y = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of bs) {
    x = Math.min(x, b.x)
    y = Math.min(y, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x, y, w: x1 - x, h: y1 - y }
}

/** World bounds of one part under its bone matrix. */
export function partWorldBounds(p: Part, mats: Map<string, Mat>): Box | null {
  const b = partBounds(p)
  if (!b.w && !b.h) return null
  const m = p.bone === 'world' ? null : mats.get(p.bone)
  if (!m) return b
  return boundsOf(([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as P[]).map((c) => applyM(m, c)))
}

/** A part that survived culling, with its world bounds. */
interface Placed {
  p: Part
  wb: Box | null
}

function visibleParts(parts: Part[], mats: Map<string, Mat>, box?: Box): Placed[] {
  const out: Placed[] = []
  // Parts inside this region cannot hold a layer outside resvg's working area (see below).
  const easy = box ? { x: box.x - box.w * 0.4, y: box.y - box.h * 0.4, w: box.w * 1.8, h: box.h * 1.8 } : null
  for (const p of parts) {
    const wb = partWorldBounds(p, mats)
    if (box && wb && !intersects(wb, box)) continue
    // A part that reaches far past the crop (a long coat in a head crop) may carry clipped
    // or masked layers entirely outside resvg's working area: drop those layers.
    if (box && easy && wb && !contains(easy, wb)) {
      const m = p.bone === 'world' ? IDENTITY : (mats.get(p.bone) ?? IDENTITY)
      const svg = cullLayers(p.svg, m, box)
      if (svg !== p.svg) {
        out.push({ p: { ...p, svg }, wb })
        continue
      }
    }
    out.push({ p, wb })
  }
  return out
}

const contains = (outer: Box, b: Box): boolean => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h

/* ---- Layer culling (resvg safety) --------------------------------------------------
 * resvg-js 2.6 panics on a layer (an element with clip-path, mask, filter or group
 * opacity) that lies entirely outside its working area. At the top level that area is the
 * canvas plus one canvas size above/left and two below/right of the canvas's origin; inside
 * another layer it is measured the same way from that layer's own origin (its top-left,
 * clipped to its own area). Parts are culled whole against the crop; this removes such
 * layers from parts that reach far outside it (a long coat in a head crop), emulating
 * those nested areas. It parses the part's SVG just enough: tags, transforms and the
 * geometry of paths, circles, ellipses, rects, lines and uses. Anything it cannot bound
 * (text, images, unknown transforms) is kept. Enclosing layers the compositor adds (frame
 * clip, finishing filter, contact shadows) start at most a fifth of the canvas above/left
 * of it, which the root area allows for. */

interface XNode {
  tag: string
  attrs: string
  start: number
  end: number
  children: XNode[]
}

const TAG_RE = /<(\/)?([a-zA-Z][\w:.-]*)([^>]*?)(\/)?>/g
const OPAQUE_TAGS = new Set(['style', 'script', 'title', 'text', 'desc'])

function parseTags(svg: string): XNode[] {
  const root: XNode = { tag: '#root', attrs: '', start: 0, end: svg.length, children: [] }
  const stack: XNode[] = [root]
  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(svg))) {
    const [all, close, tag, attrs, self] = m
    if (close) {
      // Pop to the matching open tag.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack[i].end = m.index + all.length
          stack.length = i
          break
        }
      }
      continue
    }
    const node: XNode = { tag, attrs, start: m.index, end: m.index + all.length, children: [] }
    stack[stack.length - 1].children.push(node)
    if (self) continue
    if (OPAQUE_TAGS.has(tag)) {
      // Opaque content: skip to the closing tag.
      const close = svg.indexOf(`</${tag}>`, TAG_RE.lastIndex)
      if (close < 0) break
      node.end = close + tag.length + 3
      TAG_RE.lastIndex = node.end
      continue
    }
    stack.push(node)
  }
  return root.children
}

const attrRes = new Map<string, RegExp>()
function attr(attrs: string, name: string): string | undefined {
  let re = attrRes.get(name)
  if (!re) {
    re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`)
    attrRes.set(name, re)
  }
  const m = re.exec(attrs)
  return m ? m[1] : undefined
}
const num = (attrs: string, name: string): number => Number(attr(attrs, name) ?? 0) || 0

/** SVG transform list → matrix, or null if it has something this does not handle. */
function parseTransform(t: string): Mat | null {
  let m: Mat = IDENTITY
  const re = /(\w+)\s*\(([^)]*)\)/g
  let x: RegExpExecArray | null
  let any = false
  while ((x = re.exec(t))) {
    any = true
    const v = x[2].split(/[\s,]+/).filter(Boolean).map(Number)
    if (v.some((n) => !Number.isFinite(n))) return null
    let k: Mat
    switch (x[1]) {
      case 'translate':
        k = translateM(v[0] ?? 0, v[1] ?? 0)
        break
      case 'scale':
        k = scaleM(v[0] ?? 1, v[1] ?? v[0] ?? 1)
        break
      case 'rotate':
        k = v.length >= 3 ? mul(translateM(v[1], v[2]), mul(rotateM(v[0]), translateM(-v[1], -v[2]))) : rotateM(v[0] ?? 0)
        break
      case 'matrix':
        if (v.length < 6) return null
        k = [v[0], v[1], v[2], v[3], v[4], v[5]]
        break
      default:
        return null
    }
    m = mul(m, k)
  }
  return any || !t.trim() ? m : null
}

/**
 * The area a part really paints, in its bone's space: the geometry `partBounds` counts (every
 * path `d`, every circle and ellipse), placed by the transforms above it (hair is drawn in a
 * translated group) and widened by half the stroke width it inherits (outlines). The rig
 * export packs each part into the atlas by this box, so nothing is cut off at its edges.
 * An unhandled transform leaves its subtree where it was drawn. `partBounds` itself stays
 * as it was: the still renders' framing and culling depend on it.
 */
const extentCache = new WeakMap<Part, Box>()

/**
 * Bounds of a path's outline: like `pathBounds`, but an elliptical arc counts only the part of
 * its ellipse it sweeps. (`pathBounds` counts the whole ellipse, which the art that uses it for
 * gradient boxes is tuned to, and which made a thin arc of radius 476 read as 950 units wide.)
 * Curves are bounded by their control points.
 */
export function pathExtent(d: string): Box {
  const re = /([MLHVCSQTAZ])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi
  const need: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
  let cmd = ''
  let args: number[] = []
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (px: number, py: number) => {
    if (px < x0) x0 = px
    if (px > x1) x1 = px
    if (py < y0) y0 = py
    if (py > y1) y1 = py
  }
  const flush = () => {
    if (!cmd) return
    const c = cmd.toUpperCase()
    const rel = cmd !== c
    const n = need[c] ?? 0
    if (n === 0) {
      if (c === 'Z') {
        x = sx
        y = sy
      }
      return
    }
    while (args.length >= n) {
      const a = args.splice(0, n)
      const ox = rel ? x : 0
      const oy = rel ? y : 0
      switch (c) {
        case 'H':
          x = ox + a[0]
          break
        case 'V':
          y = oy + a[0]
          break
        case 'A': {
          const ex = ox + a[5]
          const ey = oy + a[6]
          arcExtent(x, y, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, ex, ey, add)
          x = ex
          y = ey
          break
        }
        default:
          for (let i = 0; i < n - 2; i += 2) add(ox + a[i], oy + a[i + 1])
          x = ox + a[n - 2]
          y = oy + a[n - 1]
      }
      add(x, y)
      if (c === 'M') {
        sx = x
        sy = y
        cmd = rel ? 'l' : 'L'
      }
    }
  }
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    if (m[1]) {
      flush()
      cmd = m[1]
      args = []
      if (cmd === 'Z' || cmd === 'z') flush()
    } else args.push(parseFloat(m[2]))
  }
  flush()
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Adds the extreme points an SVG arc reaches (endpoint → centre form, SVG 1.1 F.6.5). */
function arcExtent(ax: number, ay: number, rx0: number, ry0: number, rotDeg: number, large: boolean, sweep: boolean, bx: number, by: number, add: (x: number, y: number) => void) {
  add(ax, ay)
  add(bx, by)
  let rx = Math.abs(rx0)
  let ry = Math.abs(ry0)
  if (!rx || !ry || (ax === bx && ay === by)) return
  const phi = (rotDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (ax - bx) / 2
  const dy = (ay - by) / 2
  const xp = cos * dx + sin * dy
  const yp = -sin * dx + cos * dy
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
  const den = rx * rx * yp * yp + ry * ry * xp * xp
  const k = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den))
  const cxp = (k * rx * yp) / ry
  const cyp = (-k * ry * xp) / rx
  const cx = cos * cxp - sin * cyp + (ax + bx) / 2
  const cy = sin * cxp + cos * cyp + (ay + by) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry)
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry)
  if (!sweep && dt > 0) dt -= Math.PI * 2
  if (sweep && dt < 0) dt += Math.PI * 2
  const TAU = Math.PI * 2
  const within = (t: number) => {
    const off = dt >= 0 ? (((t - t1) % TAU) + TAU) % TAU : (((t1 - t) % TAU) + TAU) % TAU
    return off <= Math.abs(dt) + 1e-9
  }
  // Where x and y are extreme on the rotated ellipse, and the opposite points.
  const tx = Math.atan2(-ry * sin, rx * cos)
  const ty = Math.atan2(ry * cos, rx * sin)
  for (const t of [tx, tx + Math.PI, ty, ty + Math.PI]) {
    if (!within(t)) continue
    add(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos)
  }
}

export function partExtent(p: Part): Box {
  const hit = extentCache.get(p)
  if (hit) return hit
  const pts: P[] = []
  const corners = (m: Mat, b: Box, pad: number) => {
    const x = b.x - pad
    const y = b.y - pad
    const x1 = b.x + b.w + pad
    const y1 = b.y + b.h + pad
    for (const c of [[x, y], [x1, y], [x, y1], [x1, y1]] as P[]) pts.push(applyM(m, c))
  }
  const walk = (nodes: XNode[], m: Mat, stroke: number) => {
    for (const n of nodes) {
      const t = attr(n.attrs, 'transform')
      const k = t === undefined ? null : parseTransform(t)
      const mm = k ? mul(m, k) : m
      const sw = attr(n.attrs, 'stroke') === 'none' ? 0 : attr(n.attrs, 'stroke-width') !== undefined ? num(n.attrs, 'stroke-width') : stroke
      // Round joins and caps reach half the width out; miter joins could reach further, but
      // the Painter's outlines are round.
      const pad = sw / 2
      const d = attr(n.attrs, 'd')
      if (d) {
        const b = pathExtent(d)
        if (b.w || b.h) corners(mm, b, pad)
      }
      if (n.tag === 'circle' || n.tag === 'ellipse') {
        const rx = num(n.attrs, n.tag === 'circle' ? 'r' : 'rx')
        const ry = n.tag === 'circle' ? rx : num(n.attrs, 'ry')
        corners(mm, { x: num(n.attrs, 'cx') - rx, y: num(n.attrs, 'cy') - ry, w: rx * 2, h: ry * 2 }, pad)
      }
      walk(n.children, mm, sw)
    }
  }
  walk(parseTags(p.svg), IDENTITY, 0)
  // Declared bounds cover geometry this walk can't see (`<use>`s of shared shapes), but some
  // leave out a transform the part adds around them: keep whatever either one covers.
  const found = pts.length ? boundsOf(pts) : null
  const b = found && p.bounds ? (union([found, p.bounds]) as Box) : (found ?? partBounds(p))
  extentCache.set(p, b)
  return b
}

const LAYER_RE = /(?:^|\s)(?:clip-path|mask|filter|opacity)="/

/** World bounds of a node: a box, null when it draws nothing boundable, undefined when it
 *  cannot be told. */
function nodeBounds(n: XNode, m: Mat, ids: Map<string, XNode>, depth = 0): Box | null | undefined {
  const t = attr(n.attrs, 'transform')
  if (t !== undefined) {
    const k = parseTransform(t)
    if (!k) return undefined
    m = mul(m, k)
  }
  const corners = (b: Box): Box => boundsOf(([[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as P[]).map((c) => applyM(m, c)))
  switch (n.tag) {
    case 'path': {
      const d = attr(n.attrs, 'd')
      if (!d) return null
      const b = pathBounds(d)
      return b.w || b.h ? corners(b) : null
    }
    case 'circle':
    case 'ellipse': {
      const rx = num(n.attrs, n.tag === 'circle' ? 'r' : 'rx')
      const ry = n.tag === 'circle' ? rx : num(n.attrs, 'ry')
      return corners({ x: num(n.attrs, 'cx') - rx, y: num(n.attrs, 'cy') - ry, w: rx * 2, h: ry * 2 })
    }
    case 'rect':
      return corners({ x: num(n.attrs, 'x'), y: num(n.attrs, 'y'), w: num(n.attrs, 'width'), h: num(n.attrs, 'height') })
    case 'line': {
      const x1 = num(n.attrs, 'x1')
      const y1 = num(n.attrs, 'y1')
      const x2 = num(n.attrs, 'x2')
      const y2 = num(n.attrs, 'y2')
      return corners({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) })
    }
    case 'use': {
      // The Painter's uses redraw a path defined in the same part.
      const href = attr(n.attrs, 'href') ?? attr(n.attrs, 'xlink:href')
      const ref = href && href.startsWith('#') ? ids.get(href.slice(1)) : undefined
      if (!ref || depth > 4) return undefined
      const x = num(n.attrs, 'x')
      const y = num(n.attrs, 'y')
      return nodeBounds(ref, x || y ? mul(m, translateM(x, y)) : m, ids, depth + 1)
    }
    case 'g':
    case 'a': {
      let out: Box | null = null
      for (const c of n.children) {
        const b = nodeBounds(c, m, ids, depth)
        if (b === undefined) return undefined
        if (b) out = out ? (union([out, b]) as Box) : b
      }
      return out
    }
    default:
      return undefined
  }
}

/** How far above/left of the canvas the compositor's own layers (finishing filter,
 *  contact shadows) may start, as a fraction of the canvas. */
const ENCLOSING = 0.2

/** The working area for layers inside a layer whose top-left is `o` (canvas size w × h). */
const areaFrom = (ox: number, oy: number, w: number, h: number): Box => ({ x: ox - w, y: oy - h, w: w * 3, h: h * 3 })

function cullLayers(svg: string, m: Mat, box: Box): string {
  if (!LAYER_RE.test(svg)) return svg
  const cuts: [number, number][] = []
  const tree = parseTags(svg)
  const ids = new Map<string, XNode>()
  const index = (nodes: XNode[]) => {
    for (const n of nodes) {
      const id = attr(n.attrs, 'id')
      if (id) ids.set(id, n)
      index(n.children)
    }
  }
  index(tree)
  const W = box.w
  const H = box.h
  // Keep a margin: bounds are rough and the enclosing layers may start a little off-canvas.
  const shrink = (a: Box): Box => ({ x: a.x + W * 0.12, y: a.y + H * 0.12, w: a.w - W * 0.24, h: a.h - H * 0.24 })
  const walk = (nodes: XNode[], mm: Mat, area: Box) => {
    for (const n of nodes) {
      let inner = area
      if (LAYER_RE.test(n.attrs)) {
        const b = nodeBounds(n, mm, ids)
        if (b && !intersects(b, shrink(area))) {
          cuts.push([n.start, n.end])
          continue
        }
        if (b) inner = areaFrom(Math.max(b.x, area.x), Math.max(b.y, area.y), W, H)
      }
      if (!n.children.length) continue
      const t = attr(n.attrs, 'transform')
      const k = t === undefined ? IDENTITY : parseTransform(t)
      if (k) walk(n.children, mul(mm, k), inner)
    }
  }
  walk(tree, m, areaFrom(box.x - W * ENCLOSING, box.y - H * ENCLOSING, W, H))
  if (!cuts.length) return svg
  let out = ''
  let last = 0
  for (const [a, b] of cuts) {
    out += svg.slice(last, a)
    last = b
  }
  return out + svg.slice(last)
}

function writeParts(vis: Placed[], mats: Map<string, Mat>, ids?: Map<number, string>, before?: Map<number, string>): string {
  let out = ''
  vis.forEach(({ p }, i) => {
    const pre = before?.get(i)
    if (pre) out += pre
    const m = p.bone === 'world' ? null : mats.get(p.bone)
    const id = ids?.get(i)
    if (m) out += id ? `<g id="${id}" transform="${matrixAttr(m)}">${p.svg}</g>` : `<g transform="${matrixAttr(m)}">${p.svg}</g>`
    else out += id ? `<g id="${id}">${p.svg}</g>` : p.svg
  })
  return out + (before?.get(vis.length) ?? '')
}

/** The most recent `partsSVG` call, so `documentSVG` can add contact shadows between its
 *  parts (the public render path hands it only the finished string). */
let lastLayout: { out: string; vis: Placed[]; mats: Map<string, Mat>; box?: Box } | null = null

/**
 * Writes parts in order. With a crop box, parts entirely outside it are skipped: smaller
 * files, faster rasterizing, and resvg (the service's rasterizer) panics on clipped or
 * translucent layers that fall completely off-canvas.
 */
export function partsSVG(parts: Part[], mats: Map<string, Mat>, box?: Box): string {
  const vis = visibleParts(parts, mats, box)
  const out = writeParts(vis, mats)
  lastLayout = { out, vis, mats, box }
  return out
}

/* ---- Contact shadows (baked) ---------------------------------------------------- */

/** Which layers shade which: casters' z ranges → the receivers' z range [lo, hi). */
interface Band {
  cast: [number, number][]
  recv: [number, number]
  /** Strength multiplier. */
  k: number
}

const INF = 1e9

function bandsFor(model: Model): Band[] {
  if (model.ctx.dna.kind === 'creature') {
    return [
      // Head, ears, horns, mane and accessories onto the body, near legs and neck.
      { cast: [[CZ.mane, CZ.face], [CZ.earNear, INF]], recv: [CZ.body, CZ.mane], k: 1 },
      // Near legs onto the body.
      { cast: [[CZ.legNear, CZ.neck]], recv: [CZ.body, CZ.legNear], k: 0.8 },
      // Near wings and accessories (hats) onto the head.
      { cast: [[CZ.wingNear, INF]], recv: [CZ.head, CZ.wingNear], k: 0.9 },
      // The body onto the far legs, far wing and tail.
      { cast: [[CZ.body, CZ.legNear]], recv: [-INF, CZ.body], k: 0.7 },
    ]
  }
  return [
    // Hair, hats, glasses onto the face.
    { cast: [[Z.hairCap, Z.emote]], recv: [Z.head, Z.hairCap], k: 1 },
    // The head, hair and arms onto the neck, torso and garments.
    { cast: [[Z.earBack, Z.head + 1], [Z.hairCap, Z.emote], [Z.armUpper, Z.earBack]], recv: [Z.body, Z.armUpper], k: 1 },
    // Outer layers (jackets, scarves, necklaces) onto the tops beneath.
    { cast: [[Z.outer, Z.armUpper]], recv: [Z.body, Z.outer], k: 0.85 },
    // Tops and bottoms onto the neck and body.
    { cast: [[Z.bottom, Z.outer]], recv: [Z.body, Z.bottom], k: 0.8 },
    // The torso and its garments onto the legs, feet and far limbs.
    { cast: [[Z.body, Z.armUpper]], recv: [-INF, Z.body], k: 0.75 },
    // Trouser legs and boots onto shoes and socks.
    { cast: [[Z.pantsLeg, Z.body]], recv: [-INF, Z.pantsLeg], k: 0.7 },
  ]
}

const inRange = (z: number, r: [number, number]) => z >= r[0] && z < r[1]

/** Size of the avatar's head, the unit contact shadows are measured in. */
function unitOf(model: Model): number {
  const c = model.ctx
  if (c.hr) return c.hr.m.headH
  if (c.cr) return c.cr.m.headR * 2
  return 100
}

/**
 * Plans the contact-shadow layers: for each band with overlapping casters and receivers,
 * one `<g mask><g filter>uses of the casters</g></g>` inserted right after the last
 * receiver. Returns the ids to give parts and the layers to insert.
 */
function contactShadows(model: Model, vis: Placed[], box: Box, px: number): { ids: Map<number, string>; before: Map<number, string> } {
  const ctx = model.ctx
  const P = ctx.paint
  const ids = new Map<number, string>()
  const before = new Map<number, string>()
  const unit = unitOf(model)
  const L = P.style.light
  // Soft shading casts soft shadows (a blur); cel and rim cast crisp ones, which suit the
  // style and cost a fraction.
  const soft = P.style.shading === 'soft'
  const sigma = soft ? Math.max(unit * (P.detail > 1 ? 0.045 : 0.035), MIN_BLUR_PX / px) : 0
  const off: P = soft ? [-L[0] * unit * 0.035, -L[1] * unit * 0.03 + unit * 0.012] : [-L[0] * unit * 0.03, -L[1] * unit * 0.026 + unit * 0.014]
  const reach = sigma * 2.5 + Math.hypot(off[0], off[1])
  const rig = P.rig
  const aoCol = mix('#2a1822', rig.fill, 0.22 + rig.tint * 0.2)
  const rgb = hexRGB(aoCol)
  const idOf = (i: number) => {
    let id = ids.get(i)
    if (!id) {
      id = `${ctx.defs.prefix}-pt${i}`
      ids.set(i, id)
    }
    return id
  }
  // Big translucent effects (auras, glows) are not solid: they neither cast nor receive.
  const solid = (pl: Placed) => pl.wb && pl.p.z > -500 && pl.p.z < 400

  for (const band of bandsFor(model)) {
    const recv: number[] = []
    const cast: number[] = []
    vis.forEach((pl, i) => {
      if (!solid(pl)) return
      if (inRange(pl.p.z, band.recv)) recv.push(i)
      else if (band.cast.some((r) => inRange(pl.p.z, r))) cast.push(i)
    })
    if (!recv.length || !cast.length) continue
    const recvBox = union(recv.map((i) => vis[i].wb as Box))
    if (!recvBox) continue
    const near = cast.filter((i) => intersects(inflate(vis[i].wb as Box, reach), recvBox))
    // Casters that do not touch each other (the head, each arm) get their own layer: its
    // region, and so its cost, stays near that caster.
    for (const cluster of clusters(near.map((i) => ({ i, b: inflate(vis[i].wb as Box, reach) })))) {
      const castBox = union(cluster.map((c) => c.b)) as Box
      const receivers0 = recv.filter((i) => intersects(vis[i].wb as Box, castBox))
      if (!receivers0.length) continue
      const rb = union(receivers0.map((i) => vis[i].wb as Box)) as Box
      const hit = intersection(intersection(castBox, rb) ?? { x: 0, y: 0, w: 0, h: 0 }, box)
      if (!hit || hit.w < unit * 0.02 || hit.h < unit * 0.02) continue
      // The region: where shadows can land (plus the blur's reach, so casters just outside
      // it still feed the blur), kept near the canvas.
      const region = intersection(inflate(hit, reach), grow(box, 0.1)) as Box
      // resvg measures the working area of layers inside this one from its top-left (see
      // cullLayers): only parts wholly inside that area may be drawn in it.
      const zone = areaFrom(region.x, region.y, box.w, box.h)
      const inZone = { x: zone.x + box.w * 0.15, y: zone.y + box.h * 0.15, w: zone.w - box.w * 0.3, h: zone.h - box.h * 0.3 }
      // Only the outermost pieces matter for a silhouette: a pocket inside the shirt, the eyes
      // inside the head add nothing to the alpha but cost a redraw.
      const casters = outermost(cluster.map((c) => c.i).filter((i) => contains(inZone, vis[i].wb as Box)), vis)
      const receivers = outermost(receivers0.filter((i) => contains(inZone, vis[i].wb as Box)), vis)
      if (!casters.length || !receivers.length) continue
      const last = Math.max(...receivers0)
      const alpha = Math.min(0.62, (soft ? 0.46 : 0.26) * band.k)
      const r = { x: f(region.x), y: f(region.y), width: f(region.w), height: f(region.h) }
      const castUses = casters.map((i) => el('use', { href: `#${idOf(i)}` })).join('')
      const recvUses = receivers.map((i) => el('use', { href: `#${idOf(i)}` })).join('')
      const key = key64(castUses, recvUses, r.x, r.y, r.width, r.height)
      const fid = ctx.defs.add(`ao${key}`, (id) =>
        el(
          'filter',
          { id, filterUnits: 'userSpaceOnUse', ...r, 'color-interpolation-filters': 'sRGB' },
          soft ? el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: f(sigma) }) : '',
          el('feOffset', { in: soft ? undefined : 'SourceAlpha', dx: f(off[0]), dy: f(off[1]) }),
          el('feColorMatrix', { type: 'matrix', values: `0 0 0 0 ${f(rgb[0])} 0 0 0 0 ${f(rgb[1])} 0 0 0 0 ${f(rgb[2])} 0 0 0 ${f(alpha)} 0` }),
        ),
      )
      const mid = ctx.defs.add(`aom${key}`, (id) => el('mask', { id, maskUnits: 'userSpaceOnUse', ...r, 'mask-type': 'alpha', style: 'mask-type:alpha' }, recvUses))
      const layer = `<g mask="url(#${mid})"><g filter="url(#${fid})">${castUses}</g></g>`
      before.set(last + 1, (before.get(last + 1) ?? '') + layer)
    }
  }
  return { ids, before }
}

/** Drops parts whose bounds lie inside another listed part's bounds. */
function outermost(list: number[], vis: Placed[]): number[] {
  return list.filter((i) => {
    const b = vis[i].wb as Box
    return !list.some((j) => {
      if (j === i) return false
      const o = vis[j].wb as Box
      const same = o.x === b.x && o.y === b.y && o.w === b.w && o.h === b.h
      return same ? j < i : contains(o, b)
    })
  })
}

/** Groups boxes that overlap (transitively). */
function clusters<T extends { b: Box }>(items: T[]): T[][] {
  const out: { box: Box; items: T[] }[] = []
  for (const it of items) {
    let host: { box: Box; items: T[] } | undefined
    for (let k = 0; k < out.length; k++) {
      const c = out[k]
      if (!intersects(c.box, it.b)) continue
      if (!host) {
        host = c
        c.items.push(it)
        c.box = union([c.box, it.b]) as Box
      } else {
        // The item joins two clusters: merge them.
        host.items.push(...c.items)
        host.box = union([host.box, c.box]) as Box
        out.splice(k, 1)
        k--
      }
    }
    if (!host) out.push({ box: it.b, items: [it] })
  }
  return out.map((c) => c.items)
}

const hexRGB = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/* ---- Finishing (baked) ------------------------------------------------------------ */

/** resvg blurs with a fast box blur only above ~2 device pixels (below it an IIR blur is
 *  several times slower), so blurs are kept at least this wide at the output size. */
const MIN_BLUR_PX = 2.1

/** Direction toward the rim (back) light: across from the key light, a little above. */
function rimDir(L: P): P {
  const x = L[0] <= 0 ? 0.92 : -0.92
  const n = Math.hypot(x, 0.4)
  return [x / n, -0.4 / n]
}


/**
 * The avatar-wide finishing filter: a silhouette line heavier on the shadow side (from
 * the outline weight and ink) and a light wrap of the rim light on the edges facing away
 * from the key light. Returns the filter id, or '' when there is nothing to add.
 */
function finishFilter(model: Model, box: Box, background: boolean, px: number, extent: Box | null): string {
  const ctx = model.ctx
  const P = ctx.paint
  const s = P.style
  const rig = P.rig
  const L = s.light
  const unit = unitOf(model)
  const lw = s.lw
  const rimMode = s.shading === 'rim'
  const soft = s.shading === 'soft'
  const rd = rimDir(L)
  const prims: string[] = []
  const merge: string[] = []
  const matrix = (input: string, rgb: [number, number, number], a: number, result: string, b = 0) =>
    el('feColorMatrix', { in: input, type: 'matrix', values: `0 0 0 0 ${f(rgb[0])} 0 0 0 0 ${f(rgb[1])} 0 0 0 0 ${f(rgb[2])} 0 0 0 ${f(a)} ${f(b)}`, result })
  const offset = (input: string, d: number, dir: P, result: string) => el('feOffset', { in: input, dx: f(dir[0] * d), dy: f(dir[1] * d), result })

  // Silhouette weight: the avatar's own alpha, nudged to the shadow side and drawn under it
  // in the ink colour, thickens the outer line where the light does not reach.
  if (lw > 0) {
    const inkC = s.ink === 'black' ? '#141217' : s.ink === 'white' ? '#fbf9f5' : s.ink === 'dark' ? '#2a2230' : mix('#1e1624', rig.fill, 0.12)
    prims.push(offset('SourceAlpha', lw * 0.55, [-L[0], -L[1]], 'so'), matrix('so', hexRGB(inkC), 1, 'sil'))
    merge.push('sil')
  }

  // Scene light: the character is lit by the scene's key light, so its colours are
  // multiplied a little toward the key's colour (warm at sunset, cool at night).
  let src = 'SourceGraphic'
  if (s.shading !== 'flat' && background && rig.tint > 0) {
    const a = rig.tint * 0.3
    const [kr, kg, kb] = hexRGB(rig.key)
    const m = Math.max(kr, kg, kb) || 1
    const ch = (k: number) => f(1 - a + (a * k) / m)
    prims.push(el('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: `${ch(kr)} 0 0 0 0 0 ${ch(kg)} 0 0 0 0 0 ${ch(kb)} 0 0 0 0 0 1 0`, result: 'lit' }))
    src = 'lit'
  }
  merge.push(src)

  // Light wrap: the rim (back) light, behind the character on the side opposite the key and
  // a little above, catches the edges facing it, just inside the ink line. Cel and rim get a
  // crisp band cut from shifted copies of the alpha (no blur: cheap and in style); soft gets
  // a blurred wrap.
  if (s.shading !== 'flat' && (background || rimMode)) {
    // Small on screen (a full-body sprite), a wrap a couple of pixels wide would swallow thin
    // limbs: fade it out below about 44 px per head.
    const scale = clamp((unit * px) / 44, 0.25, 1)
    const strength = (rimMode ? 0.7 : 0.08 + rig.tint * 0.4) * scale
    const col = rimMode ? mix(rig.rim, '#ffffff', 0.12) : rig.rim
    const rgb = hexRGB(col)
    if (strength > 0.05 && toLch(col).l > 0.3) {
      const away: P = [-rd[0], -rd[1]]
      const e = lw * 0.9
      const w = Math.max(unit * (rimMode ? 0.016 : 0.02), 1.4 / px)
      if (soft) {
        const sig = Math.max(unit * 0.018, MIN_BLUR_PX / px)
        prims.push(
          offset('SourceAlpha', e, away, 'ea'),
          el('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: f(sig), result: 'wb' }),
          offset('wb', e + w * 1.3, away, 'wo'),
          el('feComposite', { in: 'ea', in2: 'wo', operator: 'out', result: 'we' }),
          matrix('we', rgb, strength, 'wrap'),
        )
      } else {
        // Two steps: the half nearest the edge at full strength, the inner half at a third.
        prims.push(
          offset('SourceAlpha', e, away, 'a1'),
          offset('SourceAlpha', e + w * 0.5, away, 'a2'),
          offset('SourceAlpha', e + w, away, 'a3'),
          el('feComposite', { in: 'a1', in2: 'a2', operator: 'out', result: 'b1' }),
          el('feComposite', { in: 'a2', in2: 'a3', operator: 'out', result: 'b2' }),
          matrix('b1', rgb, strength, 'w1'),
          matrix('b2', rgb, strength * (rimMode ? 0.55 : 0.35), 'w2'),
        )
        merge.push('w1')
        merge.push('w2')
      }
      if (soft) merge.push('wrap')
    }
  }
  if (merge.length < 2 && src === 'SourceGraphic') return ''
  prims.push(el('feMerge', null, ...merge.map((m) => el('feMergeNode', { in: m }))))
  // The filter covers the avatar (plus the silhouette and blur reach), not the whole crop:
  // filters cost per pixel. Generous, since parts may carry their own blurred glows.
  const reach = unit * 0.35 + lw * 2 + (MIN_BLUR_PX * 3) / px
  const area = (extent && intersects(extent, box) && intersection(inflate(extent, reach), grow(box, ENCLOSING))) || box
  const r = { x: f(area.x), y: f(area.y), width: f(area.w), height: f(area.h) }
  const body = prims.join('')
  return ctx.defs.add(`fin${key64(body, r.x, r.y, r.width, r.height)}`, (id) =>
    el('filter', { id, filterUnits: 'userSpaceOnUse', ...r, 'color-interpolation-filters': 'sRGB' }, body),
  )
}

export interface DocumentOptions extends RenderOptions {
  box: Box
  /** Content drawn inside the frame clip after the avatar (animated extras). */
  extra?: string
  /** CSS injected into a <style> element (animated SVG). */
  css?: string
}

/** Wraps avatar content in the scene: background, ground shadow, frame, title. */
export function documentSVG(model: Model, avatar: string, o: DocumentOptions): string {
  const { box } = o
  const ctx = model.ctx
  const scene = ctx.sec('scene')
  const showBg = o.background !== false
  const showFrame = o.frame !== false && scene.s('frame') !== 'none'
  const showShadow = o.shadow ?? scene.b('shadow')
  const size = o.size ?? 512
  const h = Math.round((size * box.h) / box.w)

  // Baked stills: contact shadows between the parts, then the finishing filter.
  const style = ctx.paint.style
  const finish = ctx.baked && style.detail > 0 && avatar.length > 0
  const layout = lastLayout && lastLayout.out === avatar ? lastLayout : null
  lastLayout = null
  // Where the avatar is (every part must have bounds, or the whole crop is used).
  const extent = layout && layout.vis.every((v) => v.wb) ? union(layout.vis.map((v) => v.wb as Box)) : null
  if (finish && style.shading !== 'flat' && layout) {
    const { vis, mats } = layout
    const { ids, before } = contactShadows(model, vis, box, size / box.w)
    if (before.size) avatar = writeParts(vis, mats, ids, before)
  }
  if (finish) {
    const fid = finishFilter(model, box, showBg && scene.s('background') !== 'none', size / box.w, extent)
    if (fid) avatar = `<g filter="url(#${fid})">${avatar}</g>`
  }

  const bg = showBg ? drawBackground(ctx, box) : ''
  const groundVisible = box.y + box.h > -20 && box.y < 20
  const shadow = showShadow && groundVisible ? drawGroundShadow(ctx, model, box) : ''
  const cx = box.x + box.w / 2
  const flipped = o.flip ? g({ transform: matrixAttr(mul(translateM(cx * 2, 0), scaleM(-1, 1))) }, avatar) : avatar
  let inner = bg + shadow + flipped + (o.extra ?? '')
  let ring = ''
  if (showFrame) {
    const clipId = frameClip(ctx, box)
    inner = g({ 'clip-path': `url(#${clipId})` }, inner)
    ring = drawFrame(ctx, box)
  }
  const title = o.title === false ? '' : el('title', null, escapeXml(o.title ?? (ctx.dna.name || 'Avatar')))
  const css = o.css ? `<style>${o.css}</style>` : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(box.x)} ${f(box.y)} ${f(box.w)} ${f(box.h)}" width="${size}" height="${h}" role="img">` +
    title +
    css +
    ctx.defs.toString() +
    inner +
    ring +
    '</svg>'
  )
}

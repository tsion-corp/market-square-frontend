/* Garments: tops, bottoms, one-pieces, outerwear, shoes and socks.
 *
 * Every garment is an offset of the body it is worn on: a torso shell cut at a neckline
 * and a hem, sleeves that are wider arm capsules cut at a length, trouser legs that are
 * wider leg capsules. Because they come from the same measurements as the body, they
 * fit every height, build and pose, and follow the limbs through every animation.
 *
 * Construction detail (folds, seams, stitching, textures, prints) is drawn *inside* each
 * piece (the Painter's `inner`), so it is clipped to the silhouette and shaded with it.
 * Each fabric has its own cues: denim twill and contrast stitching, knit ribbing, leather
 * sheen and creases, silk and satin gloss bands, matte cotton, quilted puffers. After all
 * garments are drawn, layers cast soft shadows onto what they cover (see `castLayers`).
 * The expensive finish is gated on `ctx.baked` (still images); animation frames get the
 * construction lines and a few key folds.
 *
 * A body is never drawn without a base layer: with no top an undershirt is drawn, with
 * no bottom a pair of shorts — the platform has players under 13. */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { clamp, lerp, type P } from '../../core/math.ts'
import { brush, circle, ellipse, f, poly, rect, roundRect, sampleSmooth, smooth, star, tubePts, type Cap, type SP } from '../../core/path.ts'
import { el } from '../../core/svg.ts'
import type { Ctx, PartList, Reader } from '../../render/context.ts'
import { reader, Z } from '../../render/context.ts'
import type { Material, ShapeOpts } from '../../render/painter.ts'
import type { Side } from '../../render/types.ts'
import type { HumanMeasure, HumanRig } from '../../rig/humanoid.ts'
import { button, castShadow, clipFor, creases, drawGraphic, lens, fine, itemPaint, knitPaint, printShade, ribPaint, rich, rivet, seamLine, sheen, stitch, svgBounds, texture, tonal, twillPaint, zipper } from '../shared/fabric.ts'
import { armTube, detailUnit, footShape, innerSign, isFar, legTube, limbPaths, limbShape, limbZ, memoGeo, noteSleeve, upperLimbPaths } from './body.ts'

type Neck = 'crew' | 'v' | 'scoop' | 'turtle' | 'collar' | 'none' | 'sweetheart' | 'strap' | 'high' | 'wrap'

interface TopOpts {
  off: number
  neck: Neck
  /** Hem y in spine space (0 = hip line, + is lower). */
  hem: number
  flare?: number
  /** Loose garments do not pinch at the waist. */
  loose?: number
  open?: boolean
  gap?: number
}

/** Half-width of the body at a spine-space y (front view). */
export function bodyHalfAt(m: HumanMeasure, y: number): number {
  const T = m.torsoLen
  const pts: [number, number][] = [
    [-T, m.shoulderHalf * 0.97],
    [-T + T * 0.28, m.chestHalf],
    [-T + T * 0.42, m.chestHalf * (1 + m.bust * 0.05)],
    [-T * 0.36, m.waistHalf],
    [-T * 0.15, lerp(m.waistHalf, m.hipHalf, 0.55) + m.belly * m.shoulderHalf * 0.12],
    [m.pelvisH * 0.08, m.hipHalf],
    [m.pelvisH * 0.72, m.hipHalf * 0.93],
    [m.pelvisH + m.thigh * 0.5, m.hipHalf * 0.9 + m.thighR * 0.1],
    [m.pelvisH + m.thigh + m.shin, m.hipHalf],
  ]
  if (y <= pts[0][0]) return pts[0][1]
  for (let i = 0; i < pts.length - 1; i++) if (y <= pts[i + 1][0]) return lerp(pts[i][1], pts[i + 1][1], (y - pts[i][0]) / (pts[i + 1][0] - pts[i][0]))
  return pts[pts.length - 1][1]
}

function neckPts(m: HumanMeasure, neck: Neck, off: number): { side: P[]; center: SP } {
  const T = m.torsoLen
  const nx = m.neckR * 1.08 + off * 0.3
  switch (neck) {
    case 'v':
      return { side: [[nx, -T - 1]], center: [0, -T + T * 0.24, 0] }
    case 'collar':
      return { side: [[nx, -T - 2]], center: [0, -T + T * 0.14, 0] }
    case 'scoop':
      return { side: [[nx * 1.4, -T + 2], [nx * 0.85, -T + T * 0.12]], center: [0, -T + T * 0.16] }
    case 'turtle':
      return { side: [[nx * 1.02, -T - m.neckLen * 0.62]], center: [0, -T - m.neckLen * 0.66] }
    case 'strap':
      return { side: [[nx * 1.7, -T + 3], [nx * 1.05, -T + T * 0.13]], center: [0, -T + T * 0.16] }
    case 'sweetheart':
      return { side: [[m.chestHalf * 0.72, -T + T * 0.14], [nx * 0.55, -T + T * 0.3]], center: [0, -T + T * 0.24, 0] }
    case 'wrap':
      return { side: [[nx, -T - 1]], center: [-nx * 0.2, -T + T * 0.36, 0] }
    case 'high':
      return { side: [[nx, -T - 3]], center: [0, -T + nx * 0.3] }
    case 'none':
      return { side: [[nx, -T - 1]], center: [0, -T - 1] }
    default:
      return { side: [[nx, -T - 1], [nx * 0.55, -T + nx * 0.4]], center: [0, -T + nx * 0.5] }
  }
}

/** The neckline as an open curve, left shoulder → centre → right shoulder (front view). */
function necklinePts(m: HumanMeasure, neck: Neck, off: number): SP[] {
  const nk = neckPts(m, neck, off)
  return [...nk.side.map(([x, y]) => [-x, y] as SP), nk.center, ...nk.side.slice().reverse()]
}

/** A torso shell: neckline → shoulders → sides → hem, for the current view. */
export function topShape(c: Ctx, m: HumanMeasure, o: TopOpts): string {
  const T = m.torsoLen
  const off = o.off
  const flare = o.flare ?? 0
  const loose = o.loose ?? 0
  if (c.view === 'side') {
    const cd = m.chestDepth
    const hemBack = -(o.hem > -T * 0.1 ? m.buttDepth : m.waistHalf * 0.6) - off - flare
    const hemFront = (o.hem > -T * 0.1 ? m.bellyDepth * 0.85 : m.bellyDepth) + off + flare
    const neckFront = o.neck === 'v' || o.neck === 'scoop' || o.neck === 'sweetheart' ? -T + T * 0.08 : o.neck === 'turtle' ? -T - m.neckLen * 0.62 : -T - 2
    return smooth([
      [-m.neckR * 0.9 - off * 0.5, o.neck === 'turtle' ? -T - m.neckLen * 0.62 : -T - 3],
      [-cd * 0.52 - off, -T + T * 0.12],
      [-cd * 0.6 - off, -T * 0.58],
      [-lerp(m.waistHalf * 0.55, cd * 0.6, loose) - off, -T * 0.24],
      [hemBack, o.hem, 0.4],
      [hemFront, o.hem + 2, 0.4],
      [lerp(m.bellyDepth, cd * 0.7, loose * 0.5) + off, -T * 0.26],
      [cd * 0.62 + off, -T * 0.52],
      [cd * (0.62 + m.bust * 0.36) + off, -T * 0.7],
      [cd * 0.5 + off, -T * 0.9],
      [m.neckR * 0.85 + off * 0.5, neckFront],
    ])
  }
  const back = c.view === 'back'
  const nk = back ? { side: [[m.neckR * 1.08 + off * 0.3, -T - 2]] as P[], center: [0, -T - 3] as SP } : neckPts(m, o.neck, off)
  const hemHalf = bodyHalfAt(m, o.hem) + off + flare
  const waist = lerp(m.waistHalf, Math.max(m.waistHalf, m.chestHalf * 0.98), loose)
  const right: SP[] = [
    ...nk.side,
    [lerp(m.neckR, m.shoulderHalf, 0.55) + off * 0.7, -T + T * 0.035 - off * 0.6],
    [m.shoulderHalf * 0.97 + off, -T + T * 0.1],
    [m.chestHalf + off, -T + T * 0.28],
    [m.chestHalf * (1 + m.bust * 0.05) + off, -T + T * 0.42],
  ]
  if (o.hem > -T * 0.3) right.push([waist + off * 1.05 + flare * 0.25, -T * 0.36])
  if (o.hem > -T * 0.05) right.push([bodyHalfAt(m, -T * 0.12) + off + flare * 0.6, -T * 0.12])
  right.push([hemHalf, o.hem, 0.5])
  if (o.open && !back) {
    // Open front: the right panel only; the caller mirrors it.
    const gap = o.gap ?? m.neckR * 0.5
    return smooth([...right, [gap, o.hem + 2, 0.4], [gap * 0.9, -T * 0.25, 0.6], [m.neckR * 0.95, -T + T * 0.04, 0.4]])
  }
  const left = right.map(([x, y, k]) => (k === undefined ? [-x, y] : [-x, y, k]) as SP).reverse()
  return smooth([nk.center, ...right, [0, o.hem + (o.hem > 0 ? 4 : 2)], ...left])
}

function mirrorD(d: string): string {
  // Mirror path data horizontally (x → -x); our paths are absolute M/L/C/Q/A/H/V/Z.
  return d.replace(/([MLCQHAV])([^MLCQHAVZ]*)/g, (_m, cmd: string, args: string) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (!n.length) return cmd
    if (cmd === 'H') return 'H' + -n[0]
    if (cmd === 'V') return 'V' + n[0]
    if (cmd === 'A') {
      const out: number[] = []
      for (let i = 0; i < n.length; i += 7) out.push(n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4] ? 0 : 1, -n[i + 5], n[i + 6])
      return 'A' + out.join(' ')
    }
    return cmd + n.map((v, i) => (i % 2 === 0 ? -v : v)).join(' ')
  })
}

/* ---- Sleeve and leg shapes -------------------------------------------------------- */

/** A tube's closed outline points (see core/path `tubePts`). */
function tubeGeo(points: P[], w0: number, w1: number, bulge: number, capStart: Cap, capEnd: Cap): SP[] {
  const dense = points.length < 5 ? sampleSmooth(points, false, 4) : points
  const radii = dense.map((_, i) => {
    const t = i / (dense.length - 1)
    return Math.max(0, lerp(w0, w1, t) / 2 + Math.sin(t * Math.PI) * bulge * 0.5)
  })
  return tubePts(dense, radii, capStart, capEnd)
}

/** An open outline: the closed outline `pts` without the run of points `drop` selects. */
function openOutline(pts: SP[], drop: (p: SP) => boolean): string {
  const n = pts.length
  const keep = pts.map((p) => !drop(p))
  const first = keep.findIndex((k, i) => k && !keep[(i - 1 + n) % n])
  if (first < 0) return smooth(pts, true)
  const run: SP[] = []
  for (let i = 0; i < n; i++) {
    const j = (first + i) % n
    if (!keep[j]) break
    run.push(pts[j])
  }
  return smooth(run, false)
}

function sleeveUpperPts(m: HumanMeasure, len: number, off: number, flare: number, capEnd: Cap): SP[] {
  const end = m.upperArm * clamp(len, 0.15, 1.05)
  const r1 = lerp(m.armR, m.elbowR, clamp(len, 0, 1)) + off + flare
  return tubeGeo([[0, -m.armR * 0.2], [0, end * 0.5], [0, end]], (m.armR + off) * 2.02, r1 * 2, off * 0.3, 'round', capEnd)
}

function sleeveUpper(m: HumanMeasure, len: number, off: number, flare = 0, capEnd: 'flat' | 'round' = 'flat'): string {
  return memoGeo(m, `su${len}|${off}|${flare}|${capEnd}`, () => smooth(sleeveUpperPts(m, len, off, flare, capEnd), true))
}

/** An upper sleeve's outline without the inner part of its cap, which lies on the body: a
 *  set-in sleeve's seam there is drawn as a seam, not an outline (and no clip is needed). */
function sleeveUpperEdge(m: HumanMeasure, len: number, off: number, flare: number, capEnd: 'flat' | 'round', ins: number): string {
  return memoGeo(m, `sue${len}|${off}|${flare}|${capEnd}|${ins}`, () => openOutline(sleeveUpperPts(m, len, off, flare, capEnd), ([x, y]) => x * ins > -m.armR * 0.1 && y < m.armR * 0.4))
}

/** A lower sleeve: `fill` has a round top that covers the bent elbow; `edge` leaves it unstroked. */
function sleeveLower(m: HumanMeasure, len: number, off: number, flare = 0): { fill: string; edge: string } {
  const make = () => {
    const end = m.forearm * clamp(len, 0.2, 1.02)
    return limbPaths([[0, -m.elbowR * 0.35], [0, end * 0.5], [0, end]], (m.elbowR + off) * 2, (lerp(m.elbowR, m.wristR, len) + off * 1.1 + flare) * 2, 0, 'flat')
  }
  return { fill: memoGeo(m, `sl${len}|${off}|${flare}`, () => make().fill), edge: memoGeo(m, `sle${len}|${off}|${flare}`, () => make().edge) }
}

function legUpper(m: HumanMeasure, len: number, off: number, flare = 0, capEnd: 'flat' | 'round' = 'flat'): string {
  return memoGeo(m, `lu${len}|${off}|${flare}|${capEnd}`, () => legUpperD(m, len, off, flare, capEnd))
}

function legUpperD(m: HumanMeasure, len: number, off: number, flare: number, capEnd: 'flat' | 'round'): string {
  const end = m.thigh * clamp(len, 0.1, 1.05)
  return brush([[0, -m.thighR * 0.3], [0, end * 0.5], [0, end]], (m.thighR + off) * 2, (lerp(m.thighR, m.kneeR, clamp(len, 0, 1)) + off + flare) * 2, m.thighR * 0.1, 'round', capEnd)
}

/** A full-length trouser leg's upper piece: it lies over the lower one, so its knee end is
 *  round and left unstroked (see body.ts: the thigh over the shin). */
function legUpperFull(m: HumanMeasure, off: number): { fill: string; edge: string } {
  const make = () => upperLimbPaths([[0, -m.thighR * 0.3], [0, m.thigh * 0.51], [0, m.thigh * 1.02]], (m.thighR + off) * 2, (m.kneeR + off) * 2, m.thighR * 0.1)
  return { fill: memoGeo(m, `luf${off}`, () => make().fill), edge: memoGeo(m, `lufe${off}`, () => make().edge) }
}

function legLower(m: HumanMeasure, len: number, off: number, flare = 0): string {
  return memoGeo(m, `ll${len}|${off}|${flare}`, () => legLowerD(m, len, off, flare))
}

function legLowerD(m: HumanMeasure, len: number, off: number, flare: number): string {
  const end = m.shin * clamp(len, 0.1, 1) + (len >= 0.99 ? m.footH * 0.25 : 0)
  return limbPaths([[0, -m.kneeR * 0.4], [0, end * 0.35], [0, end]], (m.kneeR + off) * 2, (lerp(m.kneeR, m.ankleR, clamp(len, 0, 1)) + off * 1.15 + flare) * 2, m.kneeR * 0.2, 'flat').fill
}

function pantsPelvis(c: Ctx, m: HumanMeasure, off: number, rise = 1): string {
  const T = m.torsoLen
  const top = -T * 0.14 * rise
  if (c.view === 'side') {
    return smooth([
      [-m.waistHalf * 0.6 - off, top],
      [-m.buttDepth - off, m.pelvisH * 0.15],
      [-m.buttDepth * 0.8 - off, m.pelvisH * 0.95, 0.5],
      [m.bellyDepth * 0.6 + off, m.pelvisH * 1.02, 0.5],
      [m.bellyDepth * 0.85 + off, top + T * 0.08],
      [m.bellyDepth * 0.8 + off, top, 0.4],
    ])
  }
  const wx = bodyHalfAt(m, top) + off
  return smooth([
    [-wx, top, 0.4],
    [wx, top, 0.4],
    [m.hipHalf + off, m.pelvisH * 0.12],
    [m.hipHalf * 0.94 + off, m.pelvisH * 0.85],
    [m.thighR * 0.35, m.pelvisH * 1.08 + off * 0.6, 0.5],
    [-m.thighR * 0.35, m.pelvisH * 1.08 + off * 0.6, 0.5],
    [-m.hipHalf * 0.94 - off, m.pelvisH * 0.85],
    [-m.hipHalf - off, m.pelvisH * 0.12],
  ])
}

/* ---- Fabrics ------------------------------------------------------------------------ */

type Fabric =
  | 'cotton' | 'knit' | 'fleece' | 'denim' | 'twill' | 'wool' | 'silk' | 'satin' | 'nylon' | 'puffer' | 'leather' | 'patent'
  | 'spandex' | 'neoprene' | 'rubber' | 'metal' | 'canvas' | 'velvet'

const FABRIC: Record<string, Fabric> = {
  tshirt: 'cotton', longsleeve: 'cotton', tank: 'cotton', crop: 'cotton', hoodie: 'fleece', sweater: 'knit', turtleneck: 'knit', shirt: 'cotton',
  polo: 'cotton', blouse: 'silk', jersey: 'nylon', sailor: 'cotton', tunic: 'wool', armor: 'metal', 'vest-top': 'wool',
  jeans: 'denim', trousers: 'wool', cargo: 'canvas', joggers: 'fleece', shorts: 'twill', skirt: 'cotton', leggings: 'spandex', kilt: 'wool', overalls: 'denim',
  dress: 'silk', gown: 'satin', robe: 'velvet', kimono: 'silk', jumpsuit: 'canvas', spacesuit: 'canvas', hero: 'spandex', knight: 'metal', onesie: 'fleece', wetsuit: 'neoprene',
  jacket: 'nylon', denim: 'denim', leather: 'leather', blazer: 'wool', varsity: 'wool', trench: 'twill', puffer: 'puffer', cardigan: 'knit', waistcoat: 'wool', labcoat: 'cotton',
  sneakers: 'leather', hightops: 'canvas', boots: 'leather', combat: 'leather', kneeboots: 'leather', sandals: 'leather', heels: 'patent', loafers: 'leather', flats: 'leather',
  slippers: 'fleece', rainboots: 'rubber', cowboy: 'leather', skates: 'leather', greaves: 'metal',
  ankle: 'knit', 'crew-socks': 'knit', knee: 'knit', thigh: 'knit', tights: 'spandex',
}

/** How a fabric takes light (the Painter's material model). */
function materialOf(fab: Fabric): { material: Material; spec?: number } {
  switch (fab) {
    case 'leather':
      return { material: 'leather' }
    case 'patent':
      return { material: 'plastic' }
    case 'metal':
      return { material: 'metal' }
    case 'rubber':
    case 'neoprene':
      return { material: 'rubber' }
    case 'satin':
      return { material: 'cloth', spec: 0.45 }
    case 'silk':
      return { material: 'cloth', spec: 0.28 }
    case 'nylon':
    case 'puffer':
      return { material: 'cloth', spec: 0.3 }
    case 'spandex':
      return { material: 'cloth', spec: 0.22 }
    case 'velvet':
      return { material: 'cloth', spec: 0.12 }
    default:
      return { material: 'cloth' }
  }
}

/* ---- Garment context ---------------------------------------------------------------- */

/** What each layer covers, so layers can cast shadows onto the ones beneath (drawn last). */
interface Layers {
  top?: { hem: number; off: number; flare: number; color: string }
  outer?: { hem: number; off: number; flare: number; color: string; open: boolean; gap: number }
  bottom?: { color: string; off: number; skirt: boolean }
  sleeves: Partial<Record<Side, { upper: number; lower: number; color: string }>>
}

interface G {
  c: Ctx
  out: { add(bone: string, z: number, id: string, svg: string): void }
  m: HumanMeasure
  p: Reader
  art: string
  tile: number
  /** Detail unit (crease and stitch widths). */
  u: number
  fab: Fabric
  layers: Layers
}

const col = (g: G, k = 'color', d = '#888888') => g.p.c(k, d)

interface PieceOpts {
  patterned?: boolean
  offset?: number
  gloss?: boolean
  shade?: number | false
  /** Detail drawn inside the piece (clipped to it, shaded with it). */
  inner?: string
  /** An open outline to stroke instead of the shape's own (seamless joints: see body.ts `limbShape`). */
  edge?: string
  outline?: number | boolean
  material?: Material
  spec?: number
  /** Shade as this (larger) shape: limb pieces shade as one continuous limb. */
  shadeFrom?: string
}

/** `shadeFrom` a whole-limb tube in baked stills only (see body.ts). */
const flowTube = (c: Ctx, d: string): string | undefined => (c.baked ? d : undefined)

/** One garment piece: pattern (over a base fill, so tiles never seam), material, inner detail. */
function piece(g: G, d: string, color: string, o: PieceOpts = {}): string {
  const { c } = g
  // The pattern is laid inside the shape over its plain base colour (not as its paint):
  // tile edges that rasterizers anti-alias then show the base colour, never the ink
  // underlay beneath, and the Painter's shading still falls over the pattern.
  const paint = o.patterned === false ? undefined : itemPaint(c, g.p, g.tile, g.art)
  const mat = materialOf(g.fab)
  const inner = (paint ? texture(d, paint) : '') + (o.inner ?? '')
  const opts: ShapeOpts = {
    offset: o.offset ?? 0.12,
    gloss: o.gloss,
    shade: o.shade,
    material: o.material ?? mat.material,
    spec: o.spec ?? mat.spec,
    inner: inner || undefined,
    outline: o.outline,
    shadeFrom: c.baked ? o.shadeFrom : undefined,
  }
  return o.edge ? limbShape(c, { fill: d, edge: o.edge }, color, opts) : c.paint.shape(d, color, opts)
}

/** The fabric's surface texture (baked stills only), as inner content for `d`. */
function weave(g: G, d: string, color: string): string {
  if (!rich(g.c)) return ''
  const u = g.u
  switch (g.fab) {
    case 'denim':
      return texture(d, twillPaint(g.c, color, u * 1.25))
    case 'knit':
      return texture(d, knitPaint(g.c, color, u * 1.7))
    case 'twill':
    case 'canvas':
      return texture(d, twillPaint(g.c, mix(color, highlightOf(color, 0.2), 0.5), u * 0.9))
    default:
      return ''
  }
}

/** Satin and silk: broad gloss bands along the drape (inner content). */
function glossBands(g: G, bands: P[][], w: number, color: string): string {
  if (!rich(g.c) || (g.fab !== 'silk' && g.fab !== 'satin' && g.fab !== 'spandex' && g.fab !== 'nylon' && g.fab !== 'neoprene' && g.fab !== 'leather' && g.fab !== 'patent' && g.fab !== 'rubber' && g.fab !== 'velvet')) return ''
  const k = g.fab === 'satin' ? 1.25 : g.fab === 'silk' ? 0.9 : g.fab === 'patent' ? 1.2 : g.fab === 'rubber' ? 1.05 : g.fab === 'leather' ? 0.6 : g.fab === 'velvet' ? 0.45 : 0.5
  // Leather and velvet take a broad, soft sheen; satin, patent and rubber a crisp core.
  const soft = g.fab === 'leather' || g.fab === 'velvet'
  return bands.map((b) => sheen(g.c, b, soft ? w * 1.4 : w, color, soft ? k * 1.3 : k, !soft)).join('')
}

/** Contrast topstitching colour for a fabric. */
function threadOf(g: G, color: string, accent?: string): string {
  if (g.fab === 'denim') return accent ?? '#d9b26f'
  return accent ?? shadowOf(color, 0.3)
}

/* ---- Torso pieces --------------------------------------------------------------------- */

interface TorsoOpts {
  fold?: 'fitted' | 'loose' | 'drape' | 'none'
  hemStitch?: boolean
  inner?: string
  z?: number
  id?: string
  shape?: string
}

/** Folds of a torso shell: drag from the armpits, gathering above the hem, side compression. */
function torsoFolds(g: G, o: TopOpts, color: string, kind: 'fitted' | 'loose' | 'drape', side = 0): string {
  const { c, m, u } = g
  if (!tonal(c)) return ''
  const T = m.torsoLen
  const baked = c.baked
  const r = c.rng(`folds-${g.art}`)
  const list: { pts: P[]; w: number }[] = []
  const hemY = Math.min(o.hem, m.pelvisH * 0.45)
  if (c.view !== 'side') {
    for (const s of [-1, 1]) {
      const x0 = s * (m.chestHalf + o.off) * 0.98
      list.push({ pts: [[x0, -T * 0.73], [s * m.chestHalf * 0.74, -T * 0.66], [s * m.chestHalf * 0.5, -T * 0.61]], w: u * 1.3 })
      if (baked) list.push({ pts: [[x0, -T * 0.64], [s * m.chestHalf * 0.78, -T * 0.58], [s * m.chestHalf * 0.6, -T * 0.53]], w: u * 1.0 })
    }
    if (o.hem > -T * 0.3 && baked) {
      const n = kind === 'loose' ? 4 : 3
      for (let i = 0; i < n; i++) {
        const y = hemY - T * (0.08 + i * 0.055 + r.range(0, 0.02))
        const x = (i % 2 ? -1 : 1) * m.waistHalf * r.range(0.1, 0.45)
        const len = m.waistHalf * r.range(0.35, 0.55) * (kind === 'loose' ? 1.25 : 1)
        list.push({ pts: [[x - len / 2, y - u * 0.4], [x, y + u * 0.7], [x + len / 2, y - u * 0.2]], w: u * (kind === 'loose' ? 1.5 : 1.15) })
      }
      if (baked) for (const s of [-1, 1]) list.push({ pts: [[s * (m.waistHalf + o.off), -T * 0.42], [s * m.waistHalf * 0.82, -T * 0.32], [s * m.waistHalf * 0.66, -T * 0.25]], w: u * 0.9 })
    }
    if ((kind === 'loose' || kind === 'drape') && baked) {
      for (const s of [-1, 1]) list.push({ pts: [[s * m.chestHalf * 0.34, -T * 0.46], [s * m.chestHalf * 0.4, -T * 0.25], [s * m.chestHalf * 0.34, hemY - T * 0.02]], w: u * 1.2 })
    }
    if (kind === 'drape' && baked) {
      for (const s of [-1, 1]) list.push({ pts: [[s * m.hipHalf * 0.55, m.pelvisH * 0.2], [s * m.hipHalf * 0.7, lerp(m.pelvisH * 0.2, o.hem, 0.5)], [s * m.hipHalf * 0.72, o.hem - T * 0.04]], w: u * 1.6 })
    }
  } else {
    list.push({ pts: [[m.chestDepth * 0.05, -T * 0.68], [m.chestDepth * 0.3, -T * 0.57], [m.chestDepth * 0.45, -T * 0.5]], w: u * 1.1 })
    if (o.hem > -T * 0.3) list.push({ pts: [[-m.waistHalf * 0.45, -T * 0.16], [-m.waistHalf * 0.1, hemY - T * 0.12], [m.waistHalf * 0.3, hemY - T * 0.14]], w: u })
  }
  // An open jacket's panel only carries the folds on its own side.
  const mine = side ? list.filter((k) => k.pts.reduce((sum, [x]) => sum + x, 0) * side >= 0) : list
  return creases(c, mine, color, 1, true, true)
}

/** A stitched hem line just above the hem (inner content). */
function hemStitch(g: G, o: TopOpts, color: string, inset = 1.8): string {
  const { c, m, u } = g
  if (!fine(c)) return ''
  const y = o.hem - u * inset
  if (c.view === 'side') return stitch(c, `M${f(-m.chestDepth * 2)} ${f(y)}H${f(m.chestDepth * 2)}`, threadOf(g, color), u)
  const hx = bodyHalfAt(m, o.hem) + o.off + (o.flare ?? 0)
  return stitch(c, `M${f(-hx * 1.1)} ${f(y - 1)}Q0 ${f(y + (o.hem > 0 ? 7 : 4))} ${f(hx * 1.1)} ${f(y - 1)}`, threadOf(g, color), u)
}

/** Adds a torso shell with its folds, texture and inner detail on the spine. */
function torso(g: G, o: TopOpts, color: string, t: TorsoOpts = {}): string {
  const { c } = g
  const d = t.shape ?? topShape(c, g.m, o)
  const inner = weave(g, d, color) + (t.fold === 'none' ? '' : torsoFolds(g, o, color, t.fold ?? 'fitted')) + (t.hemStitch === false ? '' : hemStitch(g, o, color)) + (t.inner ?? '')
  const svg = piece(g, d, color, { inner })
  g.out.add('spine', t.z ?? Z.top, t.id ?? g.art, svg)
  return d
}

/** A neckband along the neckline (inner content of the torso: half of it shows). */
function neckband(g: G, neck: Neck, off: number, color: string, width = 3.4, rib = true): string {
  const { c, m, u } = g
  if (c.view !== 'front' || c.paint.detail === 0 || neck === 'none' || neck === 'high' || neck === 'turtle' || neck === 'collar') return ''
  const d = smooth(necklinePts(m, neck, off), false)
  let s = c.paint.line(d, color, u * width)
  if (rich(c) && rib) s += c.paint.line(d, shadowOf(color, 0.3), u * width, { dash: `${f(u * 0.25)} ${f(u * 0.45)}`, opacity: 0.45, cap: 'butt' })
  const inset = smooth(necklinePts(m, neck, off).map(([x, y]) => [x, y + u * width * 0.55] as P), false)
  s += seamLine(c, inset, color, g.u, 0.45)
  return s
}

/** The inside of the back neckline, seen behind the neck (front view). */
function backNeck(g: G, off: number, color: string): void {
  const { c, m } = g
  if (c.view !== 'front' || c.paint.detail === 0) return
  const T = m.torsoLen
  const nx = m.neckR * 1.08 + off * 0.3
  const d = smooth([[-nx * 0.98, -T - 1], [-nx * 0.7, -T - 3], [0, -T - 3.5], [nx * 0.7, -T - 3], [nx * 0.98, -T - 1], [nx * 0.5, -T + 1], [-nx * 0.5, -T + 1]])
  g.out.add('spine', Z.neck - 0.5, `${g.art}-backneck`, c.paint.flat(d, shadowOf(color, 0.22)))
}

/** A chest print, shaded with the torso (inner content). */
function chestPrint(g: G, color: string, off: number): string {
  const { c, m, p } = g
  if (c.view !== 'front') return ''
  const kind = p.s('graphic')
  if (!kind || kind === 'none') return ''
  const T = m.torsoLen
  if (kind === 'stripe') {
    const y = -T * 0.66
    const h = T * 0.1
    const hx = bodyHalfAt(m, y) + off
    const band = smooth([[-hx * 1.05, y], [0, y + h * 0.12], [hx * 1.05, y], [hx * 1.05, y + h], [0, y + h * 1.12], [-hx * 1.05, y + h]])
    const stripeC = p.c('color2', '#f5f2eb')
    return c.paint.flat(band, stripeC, 0.96) + (fine(c) ? stitch(c, `M${f(-hx * 1.1)} ${f(y + g.u)}Q0 ${f(y + h * 0.12 + g.u)} ${f(hx * 1.1)} ${f(y + g.u)}M${f(-hx * 1.1)} ${f(y + h - g.u)}Q0 ${f(y + h * 1.12 - g.u)} ${f(hx * 1.1)} ${f(y + h - g.u)}`, shadowOf(stripeC, 0.25), g.u, 0.6) : '')
  }
  const cy = -T * 0.62
  const w = m.chestHalf * (kind === 'text' || kind === 'number' ? 0.95 : 1.3)
  const text = p.s('text')
  const hx = bodyHalfAt(m, cy) + off
  return drawGraphic(c, kind, 0, cy, w, p.c('graphicColor', '#f5f2eb'), text, color) + printShade(c, kind, 0, cy, w, text, color, -hx, hx)
}

/** A sports jersey's big number (or name) across the back. */
function backPrint(g: G, color: string, off: number): string {
  const { c, m, p } = g
  const kind = p.s('graphic')
  if (c.view !== 'back' || (kind !== 'number' && kind !== 'text')) return ''
  const T = m.torsoLen
  const cy = -T * 0.55
  const w = m.chestHalf * 1.35
  const hx = bodyHalfAt(m, cy) + off
  const text = p.s('text')
  return drawGraphic(c, kind, 0, cy, w, p.c('graphicColor', '#f5f2eb'), text, color) + printShade(c, kind, 0, cy, w, text, color, -hx, hx)
}

/* ---- Sleeves ------------------------------------------------------------------------ */

type CuffKind = 'rib' | 'band' | 'shirt' | 'hem' | 'none'

interface SleeveSpec {
  len: 'none' | 'short' | 'elbow' | 'long' | number
  off: number
  color: string
  z: { upper: number; lower: number }
  flare?: number
  cuff?: string
  cuffKind?: CuffKind
  patterned?: boolean
  /** Extra inner detail for the lower piece (buttons, stripes). */
  lowerInner?: (s: Side, end: number, r: number) => string
  upperInner?: (s: Side, end: number, r: number) => string
}

/** Folds of a sleeve piece: drag at the armpit, bunching at the elbow and above the cuff. */
function sleeveFolds(g: G, s: Side, part: 'upper' | 'lower', end: number, r: number, full: boolean, color: string): string {
  const { c, m, u } = g
  if (!tonal(c)) return ''
  const ins = innerSign(c, s)
  const baked = c.baked
  const list: { pts: P[]; w: number }[] = []
  if (part === 'upper') {
    list.push({ pts: [[ins * r * 0.95, m.armR * 0.4], [ins * r * 0.35, end * 0.3], [-ins * r * 0.05, end * 0.42]], w: u * 1.1 })
    if (full) {
      // Crumple at the inside of the elbow.
      list.push({ pts: [[ins * r * 1.0, end - m.elbowR * 0.9], [ins * r * 0.3, end - m.elbowR * 0.45], [-ins * r * 0.35, end - m.elbowR * 0.6]], w: u * 1.3 })
      if (baked) list.push({ pts: [[-ins * r * 0.9, end - m.elbowR * 1.6], [-ins * r * 0.3, end - m.elbowR * 1.2], [ins * r * 0.2, end - m.elbowR * 1.35]], w: u * 1.0 })
    } else if (baked) {
      list.push({ pts: [[-ins * r * 0.95, end - u * 4.5], [-ins * r * 0.4, end - u * 2.8], [0, end - u * 3.2]], w: u * 0.9 })
    }
  } else {
    list.push({ pts: [[ins * r * 0.95, m.elbowR * 0.05], [ins * r * 0.2, m.elbowR * 0.35], [-ins * r * 0.4, m.elbowR * 0.25]], w: u * 1.2 })
    // Stacked folds where the sleeve gathers above the wrist.
    const n = baked ? 2 : 1
    for (let i = 0; i < n; i++) {
      const y = end - m.wristR * (0.95 + i * 0.75)
      const sgn = i % 2 ? -1 : 1
      list.push({ pts: [[sgn * r * 0.95, y - u], [sgn * r * 0.1, y + u * 0.8], [-sgn * r * 0.6, y]], w: u * 1.05 })
    }
  }
  return creases(c, list, color, 0.95)
}

function addSleeves(g: G, sp: SleeveSpec): void {
  const { c, out, m, u } = g
  if (sp.len === 'none') return
  const L = typeof sp.len === 'number' ? sp.len : sp.len === 'short' ? 0.5 : sp.len === 'elbow' ? 1.02 : 1.9
  const flare = sp.flare ?? 0
  const kind: CuffKind = sp.cuffKind ?? (sp.cuff ? 'band' : 'hem')
  const P = c.paint
  for (const s of ['L', 'R'] as const) {
    const far = isFar(c, s)
    const tint = far ? shadowOf(sp.color, 0.06) : sp.color
    const full = L > 1.02
    const uLen = Math.min(L, 1.02)
    const upper = sleeveUpper(m, uLen, sp.off, L <= 1 ? flare * 0.5 : 0, full ? 'round' : 'flat')
    const uEnd = m.upperArm * clamp(uLen, 0.15, 1.05)
    const r1 = lerp(m.armR, m.elbowR, clamp(L, 0, 1)) + sp.off + (L <= 1 ? flare * 0.5 : 0)
    let uInner = weave(g, upper, tint) + sleeveFolds(g, s, 'upper', uEnd, r1, full, tint)
    if (!full) {
      if (kind === 'band' && sp.cuff && P.detail > 0) {
        const bh = m.armR * 0.3
        uInner += P.flat(rect(-r1 * 2, uEnd - bh, r1 * 4, bh), sp.cuff) + seamLine(c, `M${f(-r1 * 2)} ${f(uEnd - bh)}H${f(r1 * 2)}`, sp.cuff, u, 0.5)
      } else if (kind === 'rib' && sp.cuff && P.detail > 0) {
        const bh = m.armR * 0.32
        uInner += P.flat(rect(-r1 * 2, uEnd - bh, r1 * 4, bh), sp.cuff) + (rich(c) ? texture(rect(-r1 * 2, uEnd - bh, r1 * 4, bh), ribPaint(c, sp.cuff, u * 1.1)) : '')
      } else if (kind !== 'none') uInner += stitch(c, `M${f(-r1 * 2)} ${f(uEnd - u * 2)}H${f(r1 * 2)}`, threadOf(g, tint), u)
    }
    if (sp.upperInner) uInner += sp.upperInner(s, uEnd, r1)
    if (c.view !== 'side' && c.baked && P.detail > 0) {
      // A set-in sleeve: where the cap overlaps the body it is a seam, not an outline.
      const ins = innerSign(c, s)
      const r0 = m.armR + sp.off
      uInner += seamLine(c, smooth([[ins * r0 * 0.98, m.armR * 0.45], [ins * r0 * 0.72, -m.armR * 0.2 - r0 * 0.62], [ins * r0 * 0.05, -m.armR * 0.2 - r0 * 0.92]], false), tint, u * 0.9, 0.45)
    }
    out.add(`upperArm${s}`, limbZ(c, s, L > 0.8 && L <= 1.02 ? Z.armLower + 0.5 : sp.z.upper, true), `${g.art}-sleeve-u-${s}`, piece(g, upper, tint, { inner: uInner, patterned: sp.patterned, edge: c.view !== 'side' ? sleeveUpperEdge(m, uLen, sp.off, L <= 1 ? flare * 0.5 : 0, full ? 'round' : 'flat', innerSign(c, s)) : undefined, shadeFrom: full ? armTube(m, 'upper', sp.off) : undefined }))
    if (!full) {
      g.layers.sleeves[s] = { upper: Math.max(g.layers.sleeves[s]?.upper ?? 0, uEnd / m.upperArm), lower: g.layers.sleeves[s]?.lower ?? 0, color: tint }
      continue
    }
    const lLen = L - 1
    const lower = sleeveLower(m, lLen, sp.off, flare)
    const end = m.forearm * clamp(lLen, 0.2, 1.02)
    const r = lerp(m.elbowR, m.wristR, lLen) + sp.off * 1.1 + flare
    let lInner = weave(g, lower.fill, tint) + sleeveFolds(g, s, 'lower', end, r, true, tint)
    let cuffBehind = ''
    let cuffOver = ''
    if (P.detail > 0) {
      if (kind === 'rib' && sp.cuff) {
        // A narrower knit cuff showing below the sleeve, which blouses over it.
        const rc = m.wristR * 1.08 + sp.off * 0.3
        const cd = roundRect(-rc, end - m.wristR * 0.35, rc * 2, m.wristR * 0.8, m.wristR * 0.22)
        cuffBehind = P.shape(cd, sp.cuff, { shade: 0.6, material: 'cloth', inner: rich(c) ? texture(cd, ribPaint(c, sp.cuff, u * 1.05)) : undefined })
        lInner += creases(c, [{ pts: [[-r * 0.9, end - u * 1.2], [-r * 0.45, end - u * 0.2], [0, end - u * 1.0]], w: u * 1.0 }, { pts: [[r * 0.1, end - u * 0.9], [r * 0.5, end - u * 0.1], [r * 0.95, end - u * 1.3]], w: u * 1.0 }], tint)
      } else if (kind === 'shirt' && sp.cuff) {
        const ch = m.wristR * 0.62
        const cd = roundRect(-r - 0.5, end - ch, r * 2 + 1, ch, m.wristR * 0.12)
        cuffOver = P.shape(cd, sp.cuff, { shade: 0.5, material: 'cloth', inner: stitch(c, `M${f(-r * 2)} ${f(end - ch + u * 1.3)}H${f(r * 2)}`, shadowOf(sp.cuff, 0.3), u) }) + (P.detail > 1 && c.view !== 'back' ? button(c, innerSign(c, s) * r * 0.45, end - ch * 0.5, m.wristR * 0.13, mix(sp.cuff, '#ffffff', 0.35)) : '')
      } else if (kind === 'band' && sp.cuff) {
        const ch = m.wristR * 0.5
        lInner += P.flat(rect(-r * 2, end - ch, r * 4, ch), sp.cuff) + seamLine(c, `M${f(-r * 2)} ${f(end - ch)}H${f(r * 2)}`, sp.cuff, u, 0.5)
      } else if (kind !== 'none') {
        lInner += stitch(c, `M${f(-r * 2)} ${f(end - u * 2)}H${f(r * 2)}`, threadOf(g, tint), u)
      }
    }
    if (sp.lowerInner) lInner += sp.lowerInner(s, end, r)
    const reach = kind === 'rib' && sp.cuff ? (end + m.wristR * 0.45) / m.forearm : end / m.forearm
    g.layers.sleeves[s] = { upper: 1.1, lower: Math.max(g.layers.sleeves[s]?.lower ?? 0, reach), color: kind === 'rib' && sp.cuff ? sp.cuff : tint }
    noteSleeve(c, s, reach, tint)
    out.add(`forearm${s}`, limbZ(c, s, sp.z.lower, true), `${g.art}-sleeve-l-${s}`, cuffBehind + piece(g, lower.fill, tint, { inner: lInner, edge: lower.edge, patterned: sp.patterned, shadeFrom: armTube(m, 'lower', sp.off) }) + cuffOver)
  }
}

/* ---- Trouser legs ------------------------------------------------------------------- */

interface LegSpec {
  len: number
  off: number
  color: string
  z: number
  flare?: number
  cuff?: string
  cuffKind?: 'rib' | 'band' | 'turnup' | 'hem' | 'none'
  /** A pressed crease down the front. */
  pressed?: boolean
  patterned?: boolean
  upperInner?: (s: Side, end: number, r: number) => string
  lowerInner?: (s: Side, end: number, r: number) => string
}

function legFolds(g: G, part: 'upper' | 'lower', end: number, r: number, full: boolean, color: string, stacked: number): string {
  const { c, m, u } = g
  if (!tonal(c)) return ''
  const baked = c.baked
  const side = c.view === 'side'
  const list: { pts: P[]; w: number }[] = []
  if (part === 'upper') {
    if (full) {
      if (side) {
        // Behind the knee.
        list.push({ pts: [[-r * 0.95, end - m.kneeR * 0.7], [-r * 0.35, end - m.kneeR * 0.35], [0, end - m.kneeR * 0.45]], w: u * 1.2 })
      } else {
        // Shallow, slightly diagonal wrinkles where the fabric slackens above the knee.
        list.push({ pts: [[-r * 0.85, end - m.kneeR * 0.4], [-r * 0.2, end - m.kneeR * 0.5], [r * 0.45, end - m.kneeR * 0.72]], w: u * 1.1 })
        if (baked) list.push({ pts: [[r * 0.8, end - m.kneeR * 1.15], [r * 0.2, end - m.kneeR * 1.2], [-r * 0.4, end - m.kneeR * 1.45]], w: u * 0.9 })
      }
    }
    if (baked && !side) {
      // Pull from the hip toward the inseam.
      list.push({ pts: [[r * 0.2, m.thighR * 0.3], [-r * 0.2, m.thigh * 0.28], [-r * 0.5, m.thigh * 0.42]], w: u * 1.0 })
    }
  } else {
    if (side) list.push({ pts: [[-r * 0.95, m.kneeR * 0.1], [-r * 0.3, m.kneeR * 0.45], [0, m.kneeR * 0.3]], w: u * 1.1 })
    else list.push({ pts: [[r * 0.85, m.kneeR * 0.2], [r * 0.1, m.kneeR * 0.32], [-r * 0.55, m.kneeR * 0.55]], w: u * 1.05 })
    // The break: fabric stacking above the shoe.
    const n = baked ? stacked : Math.min(1, stacked)
    for (let i = 0; i < n; i++) {
      const y = end - m.ankleR * (1.0 + i * 0.9)
      const sgn = i % 2 ? -1 : 1
      list.push({ pts: [[-sgn * r * 0.95, y - u * 0.6], [sgn * r * 0.05, y + u * 1.0], [sgn * r * 0.9, y - u * 0.4]], w: u * 1.15 })
    }
  }
  return creases(c, list, color, 0.95)
}

function addLegs(g: G, sp: LegSpec): void {
  const { c, out, m, u } = g
  const P = c.paint
  const len = sp.len
  const flare = sp.flare ?? 0
  const kind = sp.cuffKind ?? (sp.cuff ? 'band' : 'hem')
  for (const s of ['L', 'R'] as const) {
    const tint = isFar(c, s) ? shadowOf(sp.color, 0.06) : sp.color
    const full = len > 1.02
    const uLen = Math.min(len, 1.02)
    const upperFull = full ? legUpperFull(m, sp.off) : null
    const upper = upperFull ? upperFull.fill : legUpper(m, uLen, sp.off, len < 1 ? flare * 0.3 : 0, 'flat')
    const uEnd = m.thigh * clamp(uLen, 0.1, 1.05)
    const r1 = lerp(m.thighR, m.kneeR, clamp(uLen, 0, 1)) + sp.off
    let uInner = weave(g, upper, tint) + legFolds(g, 'upper', uEnd, r1, full, tint, 0)
    if (sp.pressed && fine(c) && c.view !== 'back') uInner += pressedCrease(g, 0, uEnd, tint)
    if (!full && kind !== 'none') {
      if (kind === 'turnup') {
        const bh = m.thighR * 0.32
        uInner += P.flat(rect(-r1 * 2, uEnd - bh, r1 * 4, bh), shadowOf(tint, 0.05)) + seamLine(c, `M${f(-r1 * 2)} ${f(uEnd - bh)}H${f(r1 * 2)}`, tint, u, 0.8)
      } else uInner += stitch(c, `M${f(-r1 * 2)} ${f(uEnd - u * 2)}H${f(r1 * 2)}`, threadOf(g, tint), u)
    }
    if (sp.upperInner) uInner += sp.upperInner(s, uEnd, r1)
    // Both pieces stay at or above sp.z (below it the compositor's contact shadows treat a
    // piece as covered by the trousers), the upper one over the lower one.
    out.add(`thigh${s}`, limbZ(c, s, sp.z + 0.5, false), `${g.art}-leg-u-${s}`, piece(g, upper, tint, { inner: uInner, patterned: sp.patterned, edge: upperFull?.edge, shadeFrom: full ? legTube(m, 'upper', sp.off) : undefined }))
    if (!full) continue
    const lLen = len - 1
    const lower = legLower(m, lLen, sp.off, flare)
    const end = m.shin * clamp(lLen, 0.1, 1) + (lLen >= 0.99 ? m.footH * 0.25 : 0)
    const r = lerp(m.kneeR, m.ankleR, lLen) + sp.off * 1.15 + flare
    let lInner = weave(g, lower, tint) + legFolds(g, 'lower', end, r, true, tint, kind === 'rib' ? 3 : flare > m.ankleR * 0.5 ? 1 : 2)
    if (sp.pressed && fine(c) && c.view !== 'back') lInner += pressedCrease(g, -m.kneeR * 0.3, end, tint)
    let cuffBehind = ''
    if (P.detail > 0) {
      if (kind === 'rib' && sp.cuff) {
        const rc = m.ankleR * 1.12 + sp.off * 0.3
        const cd = roundRect(-rc, end - m.ankleR * 0.45, rc * 2, m.ankleR * 0.8, m.ankleR * 0.25)
        cuffBehind = P.shape(cd, sp.cuff, { shade: 0.6, material: 'cloth', inner: rich(c) ? texture(cd, ribPaint(c, sp.cuff, u * 1.05)) : undefined })
      } else if (kind === 'band' && sp.cuff) {
        lInner += P.flat(rect(-r * 2, end - m.ankleR * 0.5, r * 4, m.ankleR * 0.5), sp.cuff) + seamLine(c, `M${f(-r * 2)} ${f(end - m.ankleR * 0.5)}H${f(r * 2)}`, sp.cuff, u, 0.5)
      } else if (kind === 'turnup') {
        const bh = m.ankleR * 0.55
        lInner += P.flat(rect(-r * 2, end - bh, r * 4, bh), shadowOf(tint, 0.05)) + seamLine(c, `M${f(-r * 2)} ${f(end - bh)}H${f(r * 2)}`, tint, u, 0.8)
      } else if (kind === 'hem') lInner += stitch(c, `M${f(-r * 2)} ${f(end - u * 2.2)}H${f(r * 2)}`, threadOf(g, tint), u)
    }
    if (sp.lowerInner) lInner += sp.lowerInner(s, end, r)
    // The lower leg lies under the upper one (its top is hidden at a straight knee).
    out.add(`shin${s}`, limbZ(c, s, sp.z, false), `${g.art}-leg-l-${s}`, cuffBehind + piece(g, lower, tint, { inner: lInner, patterned: sp.patterned, shadeFrom: legTube(m, 'lower', sp.off) }))
  }
}

/** A pressed trouser crease: a lit ridge with a fine shadow beside it. */
function pressedCrease(g: G, y0: number, y1: number, color: string): string {
  const { c, u } = g
  const L = c.paint.style.light
  const x = c.view === 'side' ? g.m.kneeR * 0.45 : 0
  return c.paint.line(`M${f(x + L[0] * u * 0.4)} ${f(y0)}V${f(y1)}`, highlightOf(color, 0.3), u * 0.5, { opacity: 0.55 }) + c.paint.line(`M${f(x - L[0] * u * 0.5)} ${f(y0)}V${f(y1)}`, shadowOf(color, 0.3), u * 0.45, { opacity: 0.55 })
}

/** Places a drawing made in hips space onto the `hem` bone (skirts sway from the waist). */
function onHem(c: Ctx, svg: string): string {
  const b = c.skel.get('hem')
  return b && svg ? `<g transform="translate(${-b.x} ${-b.y})">${svg}</g>` : svg
}

/** A soft drop shadow of `d` (a collar, a flap, a belt) on the surface beneath it. */
function dropShadow(g: G, d: string, receiver: string, k = 1, opacity = 0.35): string {
  const { c, u } = g
  if (!tonal(c) || !d || !c.baked) return ''
  const L = c.paint.style.light
  return c.paint.flat(d, shadowOf(receiver, 0.4), opacity, { transform: `translate(${f(-L[0] * u * 1.1 * k)} ${f(-L[1] * u * 1.3 * k)})` })
}

/* ---- Tops ------------------------------------------------------------------------- */

/** Binding along the armholes of a sleeveless top (inner content). */
function armholes(g: G, o: TopOpts, color: string): string {
  const { c, m, u } = g
  if (c.view === 'side' || c.paint.detail === 0) return ''
  const T = m.torsoLen
  const nx = m.neckR * 1.08 + o.off * 0.3
  let d = ''
  let st = ''
  for (const s of [-1, 1]) {
    d += smooth([[s * nx * 1.7, -T + 3], [s * (m.shoulderHalf * 0.97 + o.off), -T + T * 0.1], [s * (m.chestHalf + o.off), -T + T * 0.3]], false)
    st += smooth([[s * nx * 1.7, -T + 3 + u * 1.6], [s * (m.shoulderHalf * 0.97 + o.off - u * 1.6), -T + T * 0.1], [s * (m.chestHalf + o.off - u * 1.6), -T + T * 0.3]], false)
  }
  return c.paint.line(d, shadowOf(color, 0.08), u * 3) + stitch(c, st, threadOf(g, color), u, 0.6)
}

/** A ribbed band across the hem of a knit or fleece top (its own piece, over the torso). */
function hemBand(g: G, hem: number, off: number, color: string, h: number, id = 'hem'): void {
  const { c, m, u } = g
  const rw = (bodyHalfAt(m, hem) + off) * 1.2 + m.buttDepth
  const rib = rich(c) ? texture(rect(-rw, hem - h * 1.2, rw * 2, h * 1.5), ribPaint(c, color, u * 1.1)) : ''
  if (c.view === 'side') {
    const d = roundRect(-m.buttDepth - off, hem - h, m.buttDepth + m.bellyDepth + off * 2, h, h * 0.3)
    g.out.add('spine', Z.topDetail, `${g.art}-${id}`, c.paint.shape(d, color, { shade: 0.45, material: 'cloth', inner: rib || undefined }))
    return
  }
  const hx = bodyHalfAt(m, hem) + off
  const d = smooth([[-hx + 2, hem - h, 0.3], [hx - 2, hem - h, 0.3], [hx - 1, hem + 1, 0.3], [0, hem + 3], [-hx + 1, hem + 1, 0.3]])
  // The body blouses over the band: a soft shadow on the band's top edge.
  const sh = castShadow(c, rect(-hx, hem - h, hx * 2, h * 0.6), color, [0.5, 0], [0.5, 1], 0.35)
  g.out.add('spine', Z.topDetail, `${g.art}-${id}`, c.paint.shape(d, color, { shade: 0.45, material: 'cloth', inner: rib + sh || undefined }))
}

/** Twisted cables and purl channels for a cable-knit sweater (inner content). */
function cableKnit(g: G, o: TopOpts, color: string): string {
  const { c, m, u } = g
  const T = m.torsoLen
  const P = c.paint
  const y0 = -T * 0.86
  const y1 = o.hem - T * 0.08
  const cw = m.chestHalf * 0.075
  if (!rich(c) || !tonal(c)) {
    const cables = [-0.45, 0, 0.45].map((k) => {
      const x = k * m.chestHalf
      let d = `M${f(x)} ${f(y0)}`
      for (let i = 0; i < 6; i++) d += `q${f(m.chestHalf * 0.08)} ${f(T * 0.07)} 0 ${f(T * 0.14)}`
      return d
    })
    return P.detail > 1 ? P.line(cables.join(''), shadowOf(color, 0.2), Math.max(P.lw * 0.7, u * 0.5), { opacity: 0.7 }) : ''
  }
  // Baked: each cable is a column filled with a one-twist pattern tile (a few hundred
  // bytes, however tall the sweater): a lit strand crossing over a shadowed one, with
  // purl channels either side.
  const h = cw * 2.6
  const W = cw * 4
  const base = P.col(color)
  const lit = highlightOf(base, 0.16)
  const dark = shadowOf(base, 0.34)
  let out = ''
  ;[-0.5, 0, 0.5].forEach((k, i) => {
    const x = k * m.chestHalf - W / 2
    const id = c.defs.add(`cable${i}${base.slice(1)}${Math.round(W * 10)}`, (pid) =>
      el(
        'pattern',
        { id: pid, x: f(x), y: f(y0), width: f(W), height: f(h), patternUnits: 'userSpaceOnUse' },
        el('path', { d: lens([[W * 0.22, -h * 0.05], [W * 0.5, h * 0.5], [W * 0.78, h * 1.05]], cw * 0.75), fill: lit, 'fill-opacity': 0.6 }),
        el('path', { d: lens([[W * 0.2, h * 0.32], [W * 0.38, h * 0.78], [W * 0.62, h * 1.1]], u * 1.0), fill: dark, 'fill-opacity': 0.5 }),
        el('path', { d: lens([[W * 0.35, -h * 0.1], [W * 0.62, h * 0.22], [W * 0.8, h * 0.45]], u * 0.8), fill: dark, 'fill-opacity': 0.4 }),
        el('rect', { width: f(u * 0.45), height: f(h), fill: dark, 'fill-opacity': 0.45 }),
        el('rect', { x: f(W - u * 0.45), width: f(u * 0.45), height: f(h), fill: dark, 'fill-opacity': 0.45 }),
      ),
    )
    out += el('path', { d: rect(x, y0, W, y1 - y0), fill: `url(#${id})` })
  })
  return out
}

/** A shirt collar (two leaves), polo collar or blouse ruffle, with its drop shadow. */
function collar(g: G, kind: 'point' | 'open' | 'polo' | 'ruffle', color: string, body: string): void {
  const { c, m, u } = g
  if (c.view !== 'front') return
  const T = m.torsoLen
  const nr = m.neckR * 1.1
  const P = c.paint
  let d = ''
  if (kind === 'ruffle') {
    const outer: P[] = []
    const n = 9
    for (let i = 0; i <= n; i++) {
      const an = Math.PI * (1 - i / n)
      outer.push([Math.cos(an) * nr * 1.52, -T + T * 0.08 + Math.sin(an) * T * 0.12])
    }
    d = smooth([[-nr * 1.25, -T - 2], ...outer.map(([x, y], i) => [x, y + (i % 2 ? T * 0.025 : 0), i % 2 ? 1 : 0.35] as SP), [nr * 1.25, -T - 2], [0, -T + T * 0.08]])
    const inner = creases(c, outer.slice(1, -1).map(([x, y]) => ({ pts: [[x * 0.72, y - T * 0.05], [x * 0.9, y - T * 0.01], [x, y + T * 0.02]] as P[], w: u * 0.9 })), color)
    g.out.add('spine', Z.topDetail + 0.9, `${g.art}-collar-sh`, dropShadow(g, d, body))
    g.out.add('spine', Z.topDetail + 1, `${g.art}-collar`, P.shape(d, color, { shade: 0.45, material: 'cloth', inner: inner || undefined }))
    return
  }
  for (const s of [-1, 1]) {
    const pts: SP[] =
      kind === 'open'
        ? [[s * nr * 0.95, -T - 4], [s * nr * 1.8, -T + 0.5, 0.6], [s * nr * 1.6, -T + T * 0.21, 0], [s * nr * 0.6, -T + T * 0.13, 0.3], [s * nr * 0.72, -T + T * 0.02]]
        : [[s * nr * 0.95, -T - 4], [s * nr * 1.6, -T - 0.5, 0.6], [s * nr * 1.18, -T + T * 0.16, 0], [s * nr * 0.08, -T + T * 0.115, 0.2], [s * nr * 0.55, -T + T * 0.02]]
    d += smooth(pts)
  }
  let inner = kind === 'polo' && rich(c) ? texture(d, ribPaint(c, color, u * 1.0)) : ''
  if (fine(c) && kind !== 'polo') {
    const tip = kind === 'open' ? [1.6, 0.2] : [1.18, 0.15]
    inner += stitch(c, smooth([[-nr * 1.62, -T + 0.5], [-nr * tip[0] * 0.98, -T + T * tip[1] - u], [-nr * 0.3, -T + T * 0.1]], false) + smooth([[nr * 1.62, -T + 0.5], [nr * tip[0] * 0.98, -T + T * tip[1] - u], [nr * 0.3, -T + T * 0.1]], false), shadowOf(color, 0.25), u, 0.55)
  }
  g.out.add('spine', Z.topDetail + 0.9, `${g.art}-collar-sh`, dropShadow(g, d, body, 1, 0.3))
  g.out.add('spine', Z.topDetail + 1, `${g.art}-collar`, P.shape(d, color, { shade: 0.45, material: 'cloth', inner: inner || undefined }))
}

/** A button placket down the centre front, from y0 to y1 with n buttons (inner content). */
function placket(g: G, y0: number, y1: number, n: number, color: string, btn: string, kind: 'sew' | 'snap' | 'metal' = 'sew'): string {
  const { c, m, u } = g
  if (c.view !== 'front' || c.paint.detail === 0) return ''
  const w = m.neckR * 0.2
  let s = seamLine(c, `M${f(-w)} ${f(y0)}V${f(y1)}`, color, u, 0.5) + seamLine(c, `M${f(w)} ${f(y0)}V${f(y1)}`, color, u, 0.35)
  if (rich(c)) s += stitch(c, `M${f(-w + u)} ${f(y0)}V${f(y1)}`, shadowOf(color, 0.25), u, 0.5)
  for (let i = 0; i < n; i++) s += button(c, 0, lerp(y0 + (y1 - y0) * 0.08, y1 - (y1 - y0) * 0.06, n === 1 ? 0 : i / (n - 1)), m.neckR * 0.09, btn, kind)
  return s
}

/** A patch pocket with a turned top hem and stitched edges (inner content); optional flap. */
function patchPocket(g: G, x: number, y: number, w: number, h: number, color: string, flap = false): string {
  const { c, u } = g
  const P = c.paint
  if (P.detail === 0) return ''
  const d = smooth([[x - w / 2, y, 0], [x + w / 2, y, 0], [x + w / 2, y + h * 0.8, 0.5], [x, y + h], [x - w / 2, y + h * 0.8, 0.5]])
  let s = P.flat(d, shadowOf(color, 0.03)) + P.line(d, P.ink(color), Math.max(u * 0.4, P.lw * 0.45), { opacity: 0.6 })
  s += P.line(`M${f(x - w / 2)} ${f(y + u * 1.6)}H${f(x + w / 2)}`, shadowOf(color, 0.3), u * 0.4, { opacity: 0.6 })
  if (fine(c)) s += stitch(c, smooth([[x - w / 2 + u, y + u * 2, 0], [x - w / 2 + u, y + h * 0.78 - u * 0.3], [x, y + h - u], [x + w / 2 - u, y + h * 0.78 - u * 0.3], [x + w / 2 - u, y + u * 2, 0]], false), threadOf(g, color), u, 0.7)
  if (flap) {
    const fd = smooth([[x - w * 0.54, y - u * 0.5, 0], [x + w * 0.54, y - u * 0.5, 0], [x + w * 0.52, y + h * 0.3, 0.4], [x, y + h * 0.4, 0], [x - w * 0.52, y + h * 0.3, 0.4]])
    s += dropShadow(g, fd, color, 0.8, 0.3) + P.shape(fd, color, { shade: 0.4, outline: 0.7, material: 'cloth', inner: fine(c) ? stitch(c, smooth([[x - w * 0.46, y + u, 0], [x - w * 0.44, y + h * 0.26], [x, y + h * 0.33], [x + w * 0.44, y + h * 0.26], [x + w * 0.46, y + u, 0]], false), threadOf(g, color), u, 0.7) : undefined })
    s += button(c, x, y + h * 0.26, w * 0.08, g.fab === 'denim' ? '#b87333' : shadowOf(color, 0.2), g.fab === 'denim' ? 'metal' : 'sew')
  }
  return s
}

function drawTop(g: G): void {
  const { c, out, m, p, art, u } = g
  const T = m.torsoLen
  const P = c.paint
  const color = col(g)
  const color2 = p.c('color2', shadowOf(color, 0.2))
  const off = m.armR * 0.1
  const sleeves = (p.s('sleeves') || 'short') as 'none' | 'short' | 'elbow' | 'long'
  const neck = (p.s('neck') || 'crew') as Neck
  const z = { upper: Z.sleeveUpper, lower: Z.sleeveLower }
  const hemReg = m.pelvisH * 0.3
  const setTop = (o: TopOpts) => {
    const cur = g.layers.top
    if (!cur || o.hem > cur.hem) g.layers.top = { hem: o.hem, off: o.off, flare: o.flare ?? 0, color }
  }
  switch (art) {
    case 'tshirt':
    case 'longsleeve':
    case 'jersey': {
      const nk: Neck = art === 'jersey' ? 'v' : neck
      const o: TopOpts = { off, neck: nk, hem: hemReg, loose: 0.3 }
      const inner = neckband(g, nk, off, art === 'jersey' ? color2 : color, art === 'jersey' ? 4.4 : 3.2) + chestPrint(g, color, off) + (art === 'jersey' ? backPrint(g, color, off) : '')
      torso(g, o, color, { inner })
      setTop(o)
      backNeck(g, off, color)
      const len = art === 'longsleeve' ? 'long' : sleeves
      addSleeves(g, { len, off: off * 1.4, color, z, cuff: art === 'jersey' ? color2 : len === 'long' ? color : undefined, cuffKind: art === 'jersey' ? 'band' : len === 'long' ? 'rib' : 'hem' })
      break
    }
    case 'tank': {
      const o: TopOpts = { off: off * 0.6, neck: 'strap', hem: hemReg, loose: 0.2 }
      torso(g, o, color, { inner: neckband(g, 'strap', off * 0.6, color, 2.6) + armholes(g, o, color) + chestPrint(g, color, off * 0.6) })
      setTop(o)
      break
    }
    case 'crop': {
      const o: TopOpts = { off: off * 0.6, neck: 'scoop', hem: -T * 0.32 }
      torso(g, o, color, { inner: neckband(g, 'scoop', off * 0.6, color, 3) + chestPrint(g, color, off * 0.6) })
      setTop(o)
      addSleeves(g, { len: sleeves, off, color, z, cuff: sleeves === 'long' ? color : undefined, cuffKind: sleeves === 'long' ? 'rib' : 'hem' })
      break
    }
    case 'hoodie': {
      const offH = off * 2.2
      const hem = m.pelvisH * 0.45
      const o: TopOpts = { off: offH, neck: 'high', hem, loose: 0.8 }
      let inner = chestPrint(g, color, offH)
      if (c.view === 'front' && P.detail > 0) {
        // The hood's front edges cross at the neck; metal eyelets for the drawstring.
        const nx = m.neckR * 1.08 + offH * 0.3
        inner += seamLine(c, smooth([[-nx, -T - 3], [-nx * 0.35, -T + T * 0.06], [nx * 0.25, -T + T * 0.13]], false) + smooth([[nx, -T - 3], [nx * 0.45, -T + T * 0.05], [0, -T + T * 0.1]], false), color, u * 1.2, 0.7)
        if (p.b('strings') && P.detail > 1) {
          for (const s of [-1, 1]) inner += P.shape(circle(s * m.neckR * 0.6, -T + T * 0.045, m.neckR * 0.09), '#c9ccd3', { shade: 0.4, outline: 0.5, material: 'metal' }) + P.flat(circle(s * m.neckR * 0.6, -T + T * 0.045, m.neckR * 0.045), shadowOf(color, 0.5))
        }
      }
      torso(g, o, color, { inner, fold: 'loose', hemStitch: false })
      setTop(o)
      hemBand(g, hem, offH, color2, T * 0.08)
      if (c.view === 'front') {
        if (p.b('pocket')) out.add('spine', Z.topDetail + 0.2, `${art}-pocket`, kangarooPocket(g, color, hem - T * 0.08))
        if (p.b('strings')) out.add('spine', Z.topDetail + 0.5, `${art}-strings`, drawstrings(g, color2))
      }
      // Hood: bunched behind the neck (down) or over the head (up).
      if (p.b('hoodUp')) out.add('head', Z.hairCap + 3, `${art}-hood`, hoodUp(c, m, color, u))
      else out.add('neck', c.view === 'back' ? Z.top + 5 : Z.neck - 1, `${art}-hood`, hoodDown(g, color, color2))
      addSleeves(g, { len: 'long', off: offH, color, z, cuff: color2, cuffKind: 'rib' })
      break
    }
    case 'sweater':
    case 'turtleneck': {
      const offS = off * 1.8
      const hem = m.pelvisH * 0.35
      const nk: Neck = art === 'turtleneck' ? 'turtle' : 'crew'
      const o: TopOpts = { off: offS, neck: nk, hem, loose: 0.6 }
      let inner = art === 'sweater' ? neckband(g, 'crew', offS, color2, 4.2) : ''
      if (art === 'sweater' && p.b('knit') && c.view === 'front') inner += cableKnit(g, o, color)
      torso(g, o, color, { inner, fold: 'loose', hemStitch: false })
      setTop(o)
      if (art === 'sweater') backNeck(g, offS, color)
      hemBand(g, hem, offS, color2, T * 0.07, 'rib')
      if (art === 'turtleneck' && c.view !== 'back') out.add('neck', Z.neck + 1, `${art}-neck`, turtleCollar(g, color))
      addSleeves(g, { len: 'long', off: offS, color, z, cuff: color2, cuffKind: 'rib' })
      break
    }
    case 'shirt':
    case 'polo':
    case 'blouse':
    case 'vest-top': {
      const open = p.b('open')
      const nk: Neck = art === 'blouse' ? 'crew' : open ? 'v' : 'collar'
      const o: TopOpts = { off, neck: nk, hem: hemReg, loose: 0.3 }
      let inner = ''
      if (art === 'shirt' || art === 'vest-top') inner += placket(g, open ? -T + T * 0.28 : -T + T * 0.16, hemReg - T * 0.02, 5, color, mix(color, '#ffffff', 0.4))
      if (art === 'polo') inner += placket(g, -T + T * 0.16, -T + T * 0.34, 2, color, mix(color, '#ffffff', 0.4))
      if (art === 'shirt' && c.view === 'front') inner += patchPocket(g, (c.hr as HumanRig).sx * m.chestHalf * 0.5, -T * 0.78, m.chestHalf * 0.36, T * 0.16, color)
      if (art === 'blouse') inner += glossBands(g, [[[-m.chestHalf * 0.45, -T * 0.8], [-m.chestHalf * 0.4, -T * 0.45], [-m.chestHalf * 0.45, hemReg - T * 0.05]], [[m.chestHalf * 0.3, -T * 0.7], [m.chestHalf * 0.35, -T * 0.35], [m.chestHalf * 0.28, hemReg - T * 0.05]]], m.chestHalf * 0.16, color)
      torso(g, o, color, { inner, fold: art === 'blouse' ? 'drape' : 'fitted' })
      setTop(o)
      collar(g, art === 'blouse' ? (p.b('ruffle') ? 'ruffle' : 'point') : art === 'polo' ? 'polo' : open ? 'open' : 'point', art === 'polo' ? color : mix(color, '#ffffff', 0.15), color)
      if (art === 'vest-top') waistcoat(g, off * 1.4, m.pelvisH * 0.15, color2, Z.top + 2, `${art}-vest`)
      const len = art === 'polo' ? 'short' : sleeves
      addSleeves(g, {
        len,
        off: off * 1.3,
        color,
        z,
        cuff: art === 'polo' || len === 'long' ? mix(color, '#ffffff', 0.1) : undefined,
        cuffKind: art === 'polo' ? 'rib' : len === 'long' ? 'shirt' : 'hem',
      })
      break
    }
    case 'sailor': {
      const o: TopOpts = { off: off * 1.3, neck: 'v', hem: hemReg, loose: 0.4 }
      torso(g, o, color, {})
      setTop(o)
      if (c.view !== 'side') {
        const nr = m.neckR
        const back = c.view === 'back'
        const collarD = back
          ? smooth([[-m.shoulderHalf * 0.8, -T - 1, 0.4], [m.shoulderHalf * 0.8, -T - 1, 0.4], [m.shoulderHalf * 0.72, -T * 0.58, 0], [-m.shoulderHalf * 0.72, -T * 0.58, 0]])
          : smooth([[-m.shoulderHalf * 0.85, -T + T * 0.04], [-nr * 1.1, -T - 2], [0, -T + T * 0.26, 0], [nr * 1.1, -T - 2], [m.shoulderHalf * 0.85, -T + T * 0.04], [m.shoulderHalf * 0.7, -T + T * 0.22, 0], [0, -T + T * 0.4, 0], [-m.shoulderHalf * 0.7, -T + T * 0.22, 0]])
        let trim = ''
        if (P.detail > 0 && back) {
          for (const k of [0.9, 0.8]) trim += `M${f(-m.shoulderHalf * 0.8 * k)} ${f(-T - 1)}L${f(-m.shoulderHalf * 0.72 * k)} ${f(-T * 0.58 - (1 - k) * T * 0.35)}L${f(m.shoulderHalf * 0.72 * k)} ${f(-T * 0.58 - (1 - k) * T * 0.35)}L${f(m.shoulderHalf * 0.8 * k)} ${f(-T - 1)}`
        } else if (P.detail > 0) {
          // Two white stripes following the collar's outer edge.
          for (const k of [0.9, 0.8]) trim += smooth([[-m.shoulderHalf * 0.85 * k, -T + T * 0.04], [-m.shoulderHalf * 0.7 * k, -T + T * 0.22 * k, 0], [0, -T + T * 0.4 * k, 0], [m.shoulderHalf * 0.7 * k, -T + T * 0.22 * k, 0], [m.shoulderHalf * 0.85 * k, -T + T * 0.04]], false)
        }
        const collarSvg = P.shape(collarD, color2, { material: 'cloth', inner: trim ? P.line(trim, '#f5f2eb', u * 0.9) : undefined })
        out.add('spine', Z.topDetail - 0.1, `${art}-collar-sh`, dropShadow(g, collarD, color, 1.2))
        let knot = ''
        if (c.view === 'front') {
          const sc = p.c('scarf', '#e53935')
          const tails = smooth([[-nr * 0.35, -T + T * 0.34], [nr * 0.35, -T + T * 0.34], [nr * 0.55, -T + T * 0.56, 0], [nr * 0.12, -T + T * 0.5], [0, -T + T * 0.46], [-nr * 0.12, -T + T * 0.5], [-nr * 0.55, -T + T * 0.56, 0]])
          knot = P.shape(tails, sc, { shade: 0.6, material: 'cloth', inner: creases(c, [{ pts: [[-nr * 0.15, -T + T * 0.37], [-nr * 0.3, -T + T * 0.5]], w: u }, { pts: [[nr * 0.15, -T + T * 0.37], [nr * 0.3, -T + T * 0.5]], w: u }], sc) || undefined }) + P.shape(roundRect(-nr * 0.3, -T + T * 0.3, nr * 0.6, T * 0.07, nr * 0.12), sc, { shade: 0.5, material: 'cloth' })
        }
        out.add('spine', Z.topDetail, `${art}-collar`, collarSvg + knot)
      }
      addSleeves(g, { len: 'short', off: off * 1.3, color, z, cuff: color2, cuffKind: 'band', upperInner: (_s, end, r) => (P.detail > 0 ? P.line(`M${f(-r * 2)} ${f(end - m.armR * 0.38)}H${f(r * 2)}`, '#f5f2eb', u * 0.7) : '') })
      break
    }
    case 'tunic': {
      const o: TopOpts = { off: off * 1.8, neck: 'v', hem: m.pelvisH + m.thigh * 0.45, flare: m.hipHalf * 0.12, loose: 0.7 }
      let inner = ''
      if (c.view === 'front' && P.detail > 1) {
        // A laced V-neck.
        let lace = ''
        const top = -T - 1
        const bot = -T + T * 0.24
        for (let i = 0; i < 3; i++) {
          const y = lerp(top + T * 0.05, bot - T * 0.05, i / 2)
          const hw = lerp(m.neckR * 0.8, m.neckR * 0.15, (y - top) / (bot - top))
          lace += `M${f(-hw)} ${f(y)}L${f(hw * 0.8)} ${f(y + T * 0.045)}M${f(hw)} ${f(y)}L${f(-hw * 0.8)} ${f(y + T * 0.045)}`
        }
        inner += P.line(lace, '#e8d5b0', u * 0.6)
      }
      torso(g, o, color, { inner, fold: 'drape' })
      setTop(o)
      if (p.b('belt') && c.view !== 'side') {
        const y = -T * 0.1
        const hx = bodyHalfAt(m, y) + off * 1.8
        const band = roundRect(-hx, y - T * 0.04, hx * 2, T * 0.08, 2)
        out.add('spine', Z.belt, `${art}-belt`, dropShadow(g, band, color, 1) + beltBand(g, band, '#6d4c41', 0, y, T * 0.1))
      }
      addSleeves(g, { len: sleeves, off: off * 1.8, color, z, flare: m.wristR * 0.3, cuff: color2, cuffKind: 'band' })
      break
    }
    case 'armor': {
      armorChest(g, color, color2, m.armR * 0.25, m.pelvisH * 0.2)
      g.layers.top = { hem: m.pelvisH * 0.2, off: m.armR * 0.25, flare: 0, color }
      for (const s of ['L', 'R'] as const) out.add(`upperArm${s}`, limbZ(c, s, Z.sleeveUpper + 1, true), `${art}-pauldron-${s}`, pauldron(g, color, color2, 1))
      if (sleeves !== 'none') addSleeves({ ...g, fab: 'metal', p: reader({ pattern: 'solid' }) }, { len: sleeves, off: m.armR * 0.15, color, z, cuffKind: 'none' })
      break
    }
  }
}

/** The waistcoat body over a shirt (also the outerwear waistcoat). */
function waistcoat(g: G, off: number, hem: number, color: string, z: number, id: string): void {
  const { c, m, u } = g
  const T = m.torsoLen
  const P = c.paint
  const d = topShape(c, m, { off, neck: 'v', hem })
  let inner = ''
  if (c.view === 'front') {
    inner += P.line(`M0 ${f(-T + T * 0.24)}V${f(hem + 2)}`, P.ink(color), Math.max(u * 0.4, P.lw * 0.5), { opacity: 0.8 })
    // Welt pockets.
    for (const s of [-1, 1]) inner += P.line(`M${f(s * m.chestHalf * 0.3)} ${f(-T * 0.3)}l${f(s * m.chestHalf * 0.34)} ${f(-T * 0.02)}`, shadowOf(color, 0.45), u * 0.9, { opacity: 0.8 })
    inner += creases(c, [{ pts: [[-m.chestHalf * 0.6, -T * 0.52], [-m.chestHalf * 0.3, -T * 0.45], [-m.chestHalf * 0.05, -T * 0.47]], w: u }, { pts: [[m.chestHalf * 0.6, -T * 0.5], [m.chestHalf * 0.3, -T * 0.44], [m.chestHalf * 0.05, -T * 0.46]], w: u }], color)
  } else if (c.view === 'back') {
    // The satin back and its adjuster strap.
    inner += P.flat(rect(-m.chestHalf * 2, -T * 1.2, m.chestHalf * 4, T * 2), shadowOf(color, 0.1), 0.6) + P.shape(roundRect(-m.waistHalf * 0.5, -T * 0.3, m.waistHalf, T * 0.05, 2), shadowOf(color, 0.1), { shade: 0.4, outline: 0.6 })
  }
  inner += weave(g, d, color)
  let s = piece(g, d, color, { inner, patterned: false })
  if (c.view === 'front') for (let i = 0; i < 4; i++) s += button(c, 0, -T * (0.62 - i * 0.17), m.neckR * 0.09, '#c79212', 'metal')
  g.out.add('spine', z, id, s)
}

/** A plated chest with a gorget, bevelled plate edges, rivets and a crest. */
function armorChest(g: G, metal: string, trim: string, off: number, hem: number): void {
  const { c, m, u, p } = g
  const T = m.torsoLen
  const P = c.paint
  const d = topShape(c, m, { off, neck: 'crew', hem, loose: 0.9 })
  let inner = ''
  if (c.view !== 'side' && P.detail > 0) {
    const L = P.style.light
    const lame = (k: number, dy: number) => `M${f(-m.chestHalf * 1.5)} ${f(-T * k + dy)}Q0 ${f(-T * k + T * 0.07 + dy)} ${f(m.chestHalf * 1.5)} ${f(-T * k + dy)}`
    // Each plate edge: a dark overlap line with a lit bevel just below it.
    inner += P.line(lame(0.34, 0) + lame(0.52, 0), shadowOf(metal, 0.45), u * 0.9) + P.line(lame(0.34, u * 1.1 - L[1] * u * 0.3) + lame(0.52, u * 1.1 - L[1] * u * 0.3), highlightOf(metal, 0.4), u * 0.5, { opacity: 0.8 })
    if (c.view === 'front') {
      inner += P.line(`M0 ${f(-T * 0.95)}V${f(-T * 0.58)}`, highlightOf(metal, 0.45), u * 0.9, { opacity: 0.8 }) + P.line(`M${f(u)} ${f(-T * 0.95)}V${f(-T * 0.58)}`, shadowOf(metal, 0.3), u * 0.6, { opacity: 0.7 })
      inner += crest(c, p.s('crest'), 0, -T * 0.72, m.chestHalf * 0.5, trim)
    }
    if (fine(c)) for (const k of [0.34, 0.52]) for (const s of [-1, 1]) inner += rivet(c, s * m.chestHalf * 0.82, -T * k + T * 0.015, u * 0.9, highlightOf(metal, 0.1))
    if (rich(c)) inner += sheen(c, [[-m.chestHalf * 0.55, -T * 0.9], [-m.chestHalf * 0.62, -T * 0.7], [-m.chestHalf * 0.5, -T * 0.55]], m.chestHalf * 0.2, metal, 1.2)
  }
  g.out.add('spine', Z.top, g.art, P.shape(d, metal, { material: 'metal', inner: inner || undefined }))
  if (c.view === 'front') {
    const nr = m.neckR
    const gorget = smooth([[-nr * 1.4, -T - 1], [nr * 1.4, -T - 1], [nr * 1.6, -T + T * 0.06], [0, -T + T * 0.12], [-nr * 1.6, -T + T * 0.06]])
    g.out.add('spine', Z.topDetail, `${g.art}-gorget`, dropShadow(g, gorget, metal) + P.shape(gorget, trim, { material: 'metal', shade: 0.6 }))
  }
}

/** A pauldron: a domed shoulder plate with a trimmed edge and a second lame beneath. */
function pauldron(g: G, metal: string, trim: string, k: number): string {
  const { c, m, u } = g
  const P = c.paint
  const a = m.armR
  const lame = ellipse(0, a * 0.55, a * 1.3 * k, a * 0.85 * k)
  const cap = ellipse(0, a * 0.1, a * 1.45 * k, a * 1.1 * k)
  let s = P.shape(lame, shadowOf(metal, 0.08), { material: 'metal', shade: 0.8 })
  s += P.shape(cap, metal, { material: 'metal', inner: rich(c) ? sheen(c, [[-a * 0.8, -a * 0.3], [-a * 0.2, -a * 0.6]], a * 0.4, metal, 1.3) : undefined })
  s += P.line(`M${f(-a * 1.2 * k)} ${f(a * 0.3)}Q0 ${f(a * 0.9 * k)} ${f(a * 1.2 * k)} ${f(a * 0.3)}`, trim, c.paint.lw * 1.2 + u * 0.5)
  if (fine(c)) s += rivet(c, -a * 0.75 * k, a * 0.45, u * 0.9, trim) + rivet(c, a * 0.75 * k, a * 0.45, u * 0.9, trim)
  return s
}

function crest(c: Ctx, kind: string, cx: number, cy: number, s: number, color: string): string {
  const P = c.paint
  const o = { shade: 0.5, outline: 0.5, material: 'metal' as Material }
  switch (kind) {
    case 'star':
      return P.shape(star(cx, cy, s * 0.5, s * 0.22), color, o)
    case 'cross':
      return P.shape(poly([[cx - s * 0.1, cy - s * 0.5], [cx + s * 0.1, cy - s * 0.5], [cx + s * 0.1, cy - s * 0.15], [cx + s * 0.4, cy - s * 0.15], [cx + s * 0.4, cy + s * 0.05], [cx + s * 0.1, cy + s * 0.05], [cx + s * 0.1, cy + s * 0.5], [cx - s * 0.1, cy + s * 0.5], [cx - s * 0.1, cy + s * 0.05], [cx - s * 0.4, cy + s * 0.05], [cx - s * 0.4, cy - s * 0.15], [cx - s * 0.1, cy - s * 0.15]]), color, o)
    case 'lion':
      return P.shape(circle(cx, cy, s * 0.4), color, o) + P.flat(circle(cx, cy, s * 0.22), shadowOf(color, 0.4))
    case 'dragon':
      return P.shape(smooth([[cx - s * 0.45, cy + s * 0.3], [cx - s * 0.1, cy - s * 0.45], [cx + s * 0.1, cy - s * 0.05], [cx + s * 0.45, cy - s * 0.35], [cx + s * 0.2, cy + s * 0.4]]), color, o)
  }
  return ''
}

/** A leather belt band with a metal buckle centred at (bx, by). */
function beltBand(g: G, band: string, color: string, bx: number, by: number, bh: number): string {
  const { c, u } = g
  const P = c.paint
  const hw = g.m.hipHalf * 1.6
  let s = P.shape(band, color, { material: 'leather', shade: 0.6, inner: fine(c) ? stitch(c, `M${f(-hw)} ${f(by - bh * 0.28)}H${f(hw)}M${f(-hw)} ${f(by + bh * 0.28)}H${f(hw)}`, highlightOf(color, 0.25), u, 0.6) : undefined })
  if (c.view !== 'front') return s
  const buckle = roundRect(bx - bh * 0.45, by - bh * 0.55, bh * 0.9, bh * 1.1, bh * 0.12)
  s += P.shape(buckle, '#c79212', { material: 'metal', outline: 0.7 })
  if (P.detail > 0) s += P.shape(roundRect(bx - bh * 0.25, by - bh * 0.32, bh * 0.5, bh * 0.64, bh * 0.08), shadowOf(color, 0.15), { shade: false, outline: 0.5 }) + P.line(`M${f(bx - bh * 0.05)} ${f(by - bh * 0.32)}V${f(by + bh * 0.32)}`, '#c79212', u * 0.8)
  return s
}

function turtleCollar(g: G, color: string): string {
  const { c, m, u } = g
  const P = c.paint
  const T = m.torsoLen
  const d = roundRect(-m.neckR * 1.12, -m.neckLen * 0.62, m.neckR * 2.24, m.neckLen * 0.62 + T * 0.04, m.neckR * 0.3)
  let inner = rich(c) ? texture(d, ribPaint(c, color, u * 1.2)) : ''
  // The roll: a fold with a soft shadow beneath it.
  inner += creases(c, [{ pts: [[-m.neckR * 1.2, -m.neckLen * 0.2], [0, -m.neckLen * 0.12], [m.neckR * 1.2, -m.neckLen * 0.2]], w: u * 1.6 }], color, 1.1)
  inner += castShadow(c, rect(-m.neckR * 1.2, -m.neckLen * 0.18, m.neckR * 2.4, m.neckLen * 0.3), color, [0.5, 0], [0.5, 1], 0.3)
  return P.shape(d, color, { material: 'cloth', inner: inner || undefined })
}

/** The kangaroo pocket: a patch with stitched edges and two slanted hand openings. */
function kangarooPocket(g: G, color: string, bandTop: number): string {
  const { c, m, u } = g
  const T = m.torsoLen
  const P = c.paint
  const w = m.chestHalf
  const y0 = -T * 0.24
  const y1 = bandTop + 1
  const d = smooth([[-w * 0.6, y0, 0.3], [w * 0.6, y0, 0.3], [w * 0.8, y1, 0.4], [-w * 0.8, y1, 0.4]])
  let inner = weave(g, d, color)
  for (const s of [-1, 1]) {
    // Hand openings: a dark slit with the pocket edge rolled over it.
    const slit = smooth([[s * w * 0.6, y0 + 1], [s * w * 0.78, y1 * 0.4 + y0 * 0.6], [s * w * 0.8, y1 - 1]], false)
    inner += P.line(slit, shadowOf(color, 0.4), u * 1.4, { opacity: 0.75 })
  }
  if (fine(c)) inner += stitch(c, `M${f(-w * 0.55)} ${f(y0 + u * 1.5)}H${f(w * 0.55)}`, threadOf(g, color), u, 0.6)
  inner += creases(c, [{ pts: [[-w * 0.25, y1 - T * 0.03], [0, y1 - T * 0.06], [w * 0.3, y1 - T * 0.02]], w: u }], color)
  return dropShadow(g, d, color, 0.7, 0.25) + piece(g, d, color, { inner, shade: 0.5 })
}

function drawstrings(g: G, color: string): string {
  const { c, m, u } = g
  const T = m.torsoLen
  const P = c.paint
  const cord = mix(color, '#f5f2eb', 0.35)
  const r = c.rng('strings')
  let s = ''
  for (const k of [-1, 1]) {
    const x0 = k * m.neckR * 0.6
    const y0 = -T + T * 0.045
    const len = T * r.range(0.2, 0.26)
    const x1 = x0 + k * m.neckR * r.range(0.02, 0.12)
    const cordD = `M${f(x0)} ${f(y0)}Q${f(x0 + k * m.neckR * 0.1)} ${f(y0 + len * 0.5)} ${f(x1)} ${f(y0 + len)}`
    s += (P.lw > 0 ? P.line(cordD, P.ink(cord), m.neckR * 0.13 + P.lw * 0.8) : '') + P.line(cordD, cord, m.neckR * 0.12)
    // A metal aglet on the end.
    const ag = roundRect(x1 - m.neckR * 0.07, y0 + len - u * 0.2, m.neckR * 0.14, m.neckR * 0.34, m.neckR * 0.05)
    s += P.shape(ag, '#c9ccd3', { material: 'metal', outline: 0.6, shade: 0.6 })
  }
  return s
}

function hoodDown(g: G, color: string, lining: string): string {
  const { c, m, u } = g
  const P = c.paint
  const nr = m.neckR
  const T = m.torsoLen
  if (c.view === 'back') {
    // The hood lying on the upper back, with its centre seam.
    const d = smooth([[-nr * 2.4, -m.neckLen * 0.2], [0, -m.neckLen * 0.55], [nr * 2.4, -m.neckLen * 0.2], [nr * 2.0, T * 0.22], [0, T * 0.34], [-nr * 2.0, T * 0.22]])
    const inner = seamLine(c, `M0 ${f(-m.neckLen * 0.5)}V${f(T * 0.33)}`, color, u * 1.2, 0.6) + creases(c, [{ pts: [[-nr * 1.6, T * 0.12], [-nr * 0.8, T * 0.2], [-nr * 0.1, T * 0.22]], w: u * 1.3 }, { pts: [[nr * 1.6, T * 0.1], [nr * 0.8, T * 0.18], [nr * 0.1, T * 0.2]], w: u * 1.2 }], color)
    return dropShadow(g, d, color, 1.5, 0.3) + piece(g, d, shadowOf(color, 0.04), { inner, offset: 0.1 })
  }
  if (c.view === 'side') {
    const cd = m.chestDepth
    const d = smooth([[-nr * 0.2, -m.neckLen * 0.8], [-nr * 1.2, -m.neckLen * 0.6], [-cd * 0.72, T * 0.08], [-cd * 0.62, T * 0.3], [-nr * 0.7, T * 0.14], [-nr * 0.1, -m.neckLen * 0.15]])
    const inner = P.flat(smooth([[-nr * 0.35, -m.neckLen * 0.6], [-nr * 0.9, -m.neckLen * 0.45], [-cd * 0.5, T * 0.08], [-nr * 0.6, T * 0.05]]), shadowOf(mix(color, lining, 0.5), 0.3)) + creases(c, [{ pts: [[-nr * 1.1, -m.neckLen * 0.3], [-cd * 0.55, T * 0.05], [-cd * 0.6, T * 0.22]], w: u * 1.2 }], color)
    return piece(g, d, shadowOf(color, 0.06), { inner })
  }
  const outer = smooth([[-nr * 2.1, T * 0.05], [-nr * 1.6, -m.neckLen * 0.55], [0, -m.neckLen * 0.85], [nr * 1.6, -m.neckLen * 0.55], [nr * 2.1, T * 0.05]])
  const liningD = smooth([[-nr * 1.55, T * 0.05], [-nr * 1.2, -m.neckLen * 0.35], [0, -m.neckLen * 0.55], [nr * 1.2, -m.neckLen * 0.35], [nr * 1.55, T * 0.05]])
  const inner = P.flat(liningD, shadowOf(mix(color, lining, 0.5), 0.3)) + creases(c, [{ pts: [[-nr * 1.75, -m.neckLen * 0.2], [-nr * 1.45, -m.neckLen * 0.5], [-nr * 0.8, -m.neckLen * 0.7]], w: u * 1.1 }], color)
  return piece(g, outer, shadowOf(color, 0.12), { inner })
}

function hoodUp(c: Ctx, m: HumanMeasure, color: string, u: number): string {
  const hh = m.headH
  const hw = m.hw
  const up = hw * 1.25 + m.hairLift * 0.3
  const P = c.paint
  if (c.view === 'side') {
    const d = smooth([[hw * 0.85, -hh * 0.4], [hw * 0.7, -hh * 1.0 - m.hairLift * 0.2], [-hw * 0.3, -hh * 1.12], [-hw * 1.15, -hh * 0.6], [-hw * 0.9, hh * 0.12], [hw * 0.2, hh * 0.1], [hw * 0.55, -hh * 0.2]])
    const inner = creases(c, [{ pts: [[-hw * 0.2, -hh * 0.95], [-hw * 0.6, -hh * 0.6], [-hw * 0.55, -hh * 0.2]], w: u * 1.4 }], color) + P.line(smooth([[hw * 0.85, -hh * 0.4], [hw * 0.55, -hh * 0.2], [hw * 0.2, hh * 0.1]], false), shadowOf(color, 0.35), u * 4, { opacity: 0.8 })
    return P.shape(d, color, { offset: 0.08, material: 'cloth', inner })
  }
  const edge: SP[] = [[hw * 0.8, hh * 0.05], [hw * 0.95, -hh * 0.55], [hw * 0.6, -hh * 0.86], [0, -hh * 0.94], [-hw * 0.6, -hh * 0.86], [-hw * 0.95, -hh * 0.55], [-hw * 0.8, hh * 0.05]]
  const d = smooth([[-up * 0.92, hh * 0.1], [-up * 1.02, -hh * 0.5], [-up * 0.75, -hh * 1.0 - m.hairLift * 0.3], [0, -hh * 1.13 - m.hairLift * 0.4], [up * 0.75, -hh * 1.0 - m.hairLift * 0.3], [up * 1.02, -hh * 0.5], [up * 0.92, hh * 0.1], ...edge])
  let inner = ''
  if (c.view === 'front') {
    // The lining shows around the face opening; the rim rolls over it.
    inner += P.line(smooth(edge, false), shadowOf(color, 0.38), u * 7, { opacity: 0.9 }) + P.line(smooth(edge.map(([x, y]) => [x * 1.12, y * 1.06 + hh * 0.01] as P), false), highlightOf(color, 0.12), u * 1.2, { opacity: 0.5 })
  } else {
    inner += seamLine(c, `M0 ${f(-hh * 1.1 - m.hairLift * 0.4)}V${f(hh * 0.1)}`, color, u * 1.2, 0.6)
  }
  inner += creases(c, [{ pts: [[-up * 0.85, -hh * 0.15], [-up * 0.75, -hh * 0.5], [-up * 0.5, -hh * 0.8]], w: u * 1.4 }, { pts: [[up * 0.88, -hh * 0.1], [up * 0.8, -hh * 0.45], [up * 0.6, -hh * 0.75]], w: u * 1.2 }], color)
  return P.shape(d, color, { offset: 0.08, material: 'cloth', inner: inner || undefined })
}

/* ---- Bottoms ---------------------------------------------------------------------- */

type WaistKind = 'jeans' | 'trousers' | 'cargo' | 'joggers' | 'leggings' | 'shorts' | 'overalls' | 'suit'

/** The trouser seat: waistband, belt loops, fly, pockets, rivets, back yoke and pockets. */
function pelvisPiece(g: G, off: number, color: string, thread: string, kind: WaistKind, z = Z.bottom, id = g.art): string {
  const { c, m, u } = g
  const T = m.torsoLen
  const P = c.paint
  const d = pantsPelvis(c, m, off)
  const top = -T * 0.14
  const wx = bodyHalfAt(m, top) + off
  const hx = m.hipHalf + off
  const denim = g.fab === 'denim'
  let inner = weave(g, d, color)
  if (P.detail > 0 && kind !== 'suit') {
    const bandH = kind === 'joggers' || kind === 'leggings' ? T * 0.075 : T * 0.055
    const band = rect(-hx * 1.5, top - 2, hx * 3, bandH + 2)
    if (kind === 'joggers' || kind === 'leggings') {
      inner += P.flat(band, kind === 'leggings' ? shadowOf(color, 0.08) : color) + (rich(c) && kind === 'joggers' ? texture(band, ribPaint(c, color, u * 1.1)) : '')
    }
    inner += seamLine(c, `M${f(-hx * 1.5)} ${f(top + bandH)}H${f(hx * 1.5)}`, color, u, 0.6)
    if (fine(c) && kind !== 'leggings') inner += stitch(c, `M${f(-hx * 1.5)} ${f(top + bandH - u * 1.2)}H${f(hx * 1.5)}`, thread, u, 0.8)
    if (c.view === 'front') {
      if (kind === 'jeans' || kind === 'trousers' || kind === 'cargo' || kind === 'shorts' || kind === 'overalls') {
        // Fly: the J-stitch and the placket fold.
        const fx = m.hipHalf * 0.2
        inner += seamLine(c, `M0 ${f(top + bandH)}V${f(m.pelvisH * 0.78)}`, color, u, 0.55)
        inner += stitch(c, `M${f(fx)} ${f(top + bandH)}V${f(m.pelvisH * 0.55)}Q${f(fx)} ${f(m.pelvisH * 0.8)} ${f(u * 0.5)} ${f(m.pelvisH * 0.84)}`, thread, u, 0.85)
        // Front pockets: scooped on jeans, slanted on trousers and cargos.
        for (const s of [-1, 1]) {
          const px = s * m.hipHalf * 0.46
          const pocket = kind === 'jeans' || kind === 'overalls' || kind === 'shorts' ? `M${f(px)} ${f(top + bandH)}Q${f(s * m.hipHalf * 0.55)} ${f(m.pelvisH * 0.3)} ${f(s * hx * 1.02)} ${f(m.pelvisH * 0.34)}` : `M${f(px)} ${f(top + bandH)}L${f(s * hx * 1.02)} ${f(m.pelvisH * 0.45)}`
          inner += P.line(pocket, P.ink(color), Math.max(u * 0.45, P.lw * 0.5), { opacity: 0.85 })
          if (tonal(c)) inner += P.line(pocket, shadowOf(color, 0.35), u * 1.6, { opacity: 0.3 }).replace('<path ', `<path transform="translate(${f(-s * u * 0.6)} ${f(u * 0.7)})" `)
          if (denim) {
            inner += stitch(c, kind === 'shorts' ? '' : `M${f(px + s * u * 1.2)} ${f(top + bandH)}Q${f(s * m.hipHalf * 0.6)} ${f(m.pelvisH * 0.26)} ${f(s * hx * 1.02)} ${f(m.pelvisH * 0.3 - u * 1.2)}`, thread, u, 0.85)
            inner += rivet(c, s * hx * 0.96, m.pelvisH * 0.32, u * 0.85)
            if (s === (c.hr as HumanRig).sx) inner += rich(c) ? P.line(`M${f(s * m.hipHalf * 0.62)} ${f(top + bandH + u)}V${f(top + bandH + T * 0.07)}H${f(s * m.hipHalf * 0.86)}`, P.ink(color), u * 0.35, { opacity: 0.5 }) : ''
          }
        }
        if (kind === 'jeans' || kind === 'overalls' || kind === 'shorts') inner += button(c, 0, top + bandH * 0.5, u * 1.4, denim ? '#b87333' : '#c9ccd3', 'metal')
        else if (kind !== 'cargo') inner += P.line(`M${f(-u * 0.9)} ${f(top + bandH * 0.5)}H${f(u * 0.9)}`, '#c9ccd3', u * 0.8)
        else inner += button(c, 0, top + bandH * 0.5, u * 1.3, shadowOf(color, 0.2), 'sew')
      }
      if (kind === 'joggers' && fine(c)) {
        // Drawstring through the waistband.
        const cord = mix(thread, '#f5f2eb', 0.4)
        inner += P.line(`M${f(-u * 1.5)} ${f(top + bandH * 0.55)}q${f(-u)} ${f(T * 0.06)} ${f(-u * 0.5)} ${f(T * 0.1)}M${f(u * 1.5)} ${f(top + bandH * 0.55)}q${f(u)} ${f(T * 0.06)} ${f(u * 0.3)} ${f(T * 0.1)}`, cord, u * 0.8)
      }
      // Pull toward the crotch.
      if (tonal(c) && kind !== 'leggings') inner += creases(c, [{ pts: [[-m.hipHalf * 0.4, m.pelvisH * 0.55], [-m.hipHalf * 0.12, m.pelvisH * 0.85], [0, m.pelvisH * 0.98]], w: u * 1.1 }, { pts: [[m.hipHalf * 0.42, m.pelvisH * 0.6], [m.hipHalf * 0.14, m.pelvisH * 0.86], [u, m.pelvisH * 0.98]], w: u }], color, 0.9)
    } else if (c.view === 'back' && kind !== 'leggings' && kind !== 'joggers') {
      // Back yoke and patch pockets.
      if (denim || kind === 'cargo') inner += seamLine(c, `M${f(-hx * 1.2)} ${f(top + T * 0.12)}L0 ${f(top + T * 0.2)}L${f(hx * 1.2)} ${f(top + T * 0.12)}`, color, u, 0.6) + stitch(c, `M${f(-hx * 1.2)} ${f(top + T * 0.12 + u * 1.3)}L0 ${f(top + T * 0.2 + u * 1.3)}L${f(hx * 1.2)} ${f(top + T * 0.12 + u * 1.3)}`, thread, u, 0.85)
      for (const s of [-1, 1]) {
        if (kind === 'trousers') inner += P.line(`M${f(s * m.hipHalf * 0.25)} ${f(m.pelvisH * 0.15)}h${f(s * m.hipHalf * 0.4)}`, shadowOf(color, 0.45), u * 0.9, { opacity: 0.8 })
        else inner += patchPocket(g, s * m.hipHalf * 0.5, top + T * 0.2, m.hipHalf * 0.55, m.pelvisH * 0.75, color, kind === 'cargo')
      }
    } else if (c.view === 'side') {
      inner += seamLine(c, `M${f(m.bellyDepth * 0.1)} ${f(top + T * 0.06)}Q${f(m.bellyDepth * 0.35)} ${f(m.pelvisH * 0.35)} ${f(m.bellyDepth * 0.72)} ${f(m.pelvisH * 0.4)}`, color, u, 0.7)
      if (kind !== 'leggings') inner += P.flat(rect(-u * 1.1, top, u * 2.2, T * 0.075), shadowOf(color, 0.08)) + P.line(`M${f(-u * 1.1)} ${f(top)}v${f(T * 0.075)}M${f(u * 1.1)} ${f(top)}v${f(T * 0.075)}`, P.ink(color), u * 0.35, { opacity: 0.6 })
    }
    // Belt loops.
    if (fine(c) && (kind === 'jeans' || kind === 'trousers' || kind === 'cargo' || kind === 'shorts') && c.view !== 'side') {
      let loops = ''
      for (const k of [-0.82, -0.4, 0.4, 0.82]) loops += rect(k * wx - u * 0.9, top - 1, u * 1.8, bandH + u * 1.2)
      inner += P.flat(loops, shadowOf(color, 0.04)) + P.line(loops, P.ink(color), u * 0.3, { opacity: 0.5 })
    }
  }
  if (kind === 'leggings' || kind === 'joggers') inner += glossBands(g, [[[-m.hipHalf * 0.5, top + T * 0.1], [-m.hipHalf * 0.55, m.pelvisH * 0.6]], [[m.hipHalf * 0.45, top + T * 0.12], [m.hipHalf * 0.5, m.pelvisH * 0.6]]], m.hipHalf * 0.14, color)
  g.out.add('hips', z, id, piece(g, d, color, { inner }))
  g.layers.bottom = { color, off, skirt: false }
  return d
}

/** A frayed rip: skin through white weft threads, with a ragged edge. */
function rip(g: G, cx: number, cy: number, w: number, h: number, color: string): string {
  const { c, u } = g
  const P = c.paint
  const skin = c.sec('skin').c('tone', '#d69d78')
  const hole = smooth([[cx - w, cy], [cx - w * 0.4, cy - h * 0.9], [cx + w * 0.5, cy - h * 0.8], [cx + w, cy + h * 0.1], [cx + w * 0.3, cy + h], [cx - w * 0.6, cy + h * 0.8]])
  let s = P.flat(hole, shadowOf(skin, 0.1))
  let weft = ''
  for (let i = 0; i < 4; i++) {
    const y = cy - h * 0.6 + (i * h * 1.2) / 3
    weft += `M${f(cx - w * 0.95)} ${f(y)}Q${f(cx)} ${f(y + u * 0.8)} ${f(cx + w * 0.95)} ${f(y - u * 0.3)}`
  }
  s += P.line(weft, '#f2efe6', u * 0.55, { opacity: 0.95 })
  s += P.line(hole, mix(color, '#ffffff', 0.55), u * 0.9, { dash: `${f(u * 0.6)} ${f(u * 0.5)}`, opacity: 0.85 })
  return s
}

function drawBottom(g: G): void {
  const { c, out, m, p, art, u } = g
  const T = m.torsoLen
  const P = c.paint
  const color = col(g)
  const color2 = p.c('color2', shadowOf(color, 0.3))
  const fit = p.s('fit') || 'straight'
  const off = fit === 'skinny' ? m.thighR * 0.04 : fit === 'wide' ? m.thighR * 0.22 : m.thighR * 0.1
  const flare = fit === 'wide' ? m.ankleR * 0.9 : fit === 'straight' ? m.ankleR * 0.35 : 0
  const thread = art === 'jeans' || art === 'overalls' ? color2 : shadowOf(color, 0.3)
  switch (art) {
    case 'jeans':
    case 'trousers':
    case 'cargo':
    case 'joggers':
    case 'leggings': {
      const o = art === 'leggings' ? m.thighR * 0.02 : art === 'cargo' ? m.thighR * 0.16 : off
      const fl = art === 'joggers' || art === 'leggings' ? 0 : art === 'cargo' ? m.ankleR * 0.3 : flare
      pelvisPiece(g, o, color, thread, art as WaistKind)
      const outer = (s: Side) => -innerSign(c, s)
      addLegs(g, {
        len: 2,
        off: o,
        color,
        z: Z.pantsLeg,
        flare: fl,
        cuff: art === 'joggers' ? color2 : undefined,
        cuffKind: art === 'joggers' ? 'rib' : art === 'leggings' ? 'none' : 'hem',
        pressed: art === 'trousers',
        upperInner: (s, end, r) => {
          let x = ''
          if (art === 'jeans' && c.view === 'front') {
            // Whiskers fanning from the hip, a worn lighter front.
            if (rich(c)) x += `<g transform="translate(0 ${f(end * 0.4)}) scale(${f(r * 0.62)} ${f(end * 0.3)})">${P.glow(0, 0, 1, highlightOf(color, 0.22), 0.5)}</g>`
            x += creases(c, [0, 1, 2].map((i) => ({ pts: [[-innerSign(c, s) * r * 0.1, m.thighR * (0.25 + i * 0.22)], [-innerSign(c, s) * r * 0.55, m.thighR * (0.32 + i * 0.25)], [-innerSign(c, s) * r * 0.95, m.thighR * (0.28 + i * 0.3)]] as P[], w: u * 0.9 })), color, 0.8)
            if (p.b('ripped')) x += rip(g, 0, end * 0.8, m.kneeR * 0.5, m.kneeR * 0.28, color)
            if (fine(c)) x += stitch(c, `M${f(innerSign(c, s) * r * 0.92)} 0V${f(end)}`, thread, u, 0.8)
          }
          if (art === 'jeans' && c.view === 'side' && fine(c)) x += stitch(c, `M${f(u)} 0V${f(end)}`, thread, u, 0.8)
          if (art === 'cargo') {
            const px = c.view === 'side' ? 0 : outer(s) * r * 0.42
            x += patchPocket(g, px, end * 0.42, r * (c.view === 'side' ? 1.1 : 0.9), end * 0.34, color, true)
          }
          if (art === 'joggers' && p.b('stripe')) {
            const sx = c.view === 'side' ? 0 : outer(s) * r * 0.85
            x += P.line(`M${f(sx)} ${f(-m.thighR)}V${f(end + 2)}`, color2, m.thighR * 0.18)
          }
          if (art === 'leggings') x += glossBands(g, [[[-r * 0.2, end * 0.1], [-r * 0.15, end * 0.9]]], r * 0.35, color)
          return x
        },
        lowerInner: (s, end, r) => {
          let x = ''
          if (art === 'jeans' && c.view === 'front' && fine(c)) x += stitch(c, `M${f(innerSign(c, s) * r * 0.92)} ${f(-m.kneeR * 0.4)}V${f(end)}`, thread, u, 0.8)
          if (art === 'jeans' && c.view === 'front' && rich(c)) x += `<g transform="translate(0 ${f(m.kneeR * 0.25)}) scale(${f(r * 0.5)} ${f(m.kneeR * 0.7)})">${P.glow(0, 0, 1, highlightOf(color, 0.18), 0.35)}</g>`
          if (art === 'jeans' && c.view === 'side' && fine(c)) x += stitch(c, `M${f(u)} ${f(-m.kneeR * 0.4)}V${f(end)}`, thread, u, 0.8)
          if (art === 'joggers' && p.b('stripe')) {
            const sx = c.view === 'side' ? 0 : outer(s) * r * 0.85
            x += P.line(`M${f(sx)} ${f(-m.kneeR * 1.4)}V${f(end + 2)}`, color2, m.thighR * 0.18)
          }
          if (art === 'leggings') x += glossBands(g, [[[-r * 0.2, m.kneeR * 0.4], [-r * 0.15, end * 0.9]]], r * 0.35, color)
          return x
        },
      })
      break
    }
    case 'shorts': {
      const len = lerp(0.3, 0.9, p.n('length'))
      pelvisPiece(g, off, color, thread, 'shorts')
      addLegs(g, { len, off: off * 1.2, color, z: Z.pantsLeg, flare: m.thighR * 0.15, cuffKind: 'turnup' })
      break
    }
    case 'overalls': {
      pelvisPiece(g, off, color, thread, 'overalls')
      addLegs(g, { len: p.b('shorts') ? 0.6 : 2, off, color, z: Z.pantsLeg, flare: flare * 0.5, cuffKind: p.b('shorts') ? 'turnup' : 'hem' })
      if (c.view !== 'side') {
        const bib = smooth([[-m.chestHalf * 0.55, -T * 0.62, 0.2], [m.chestHalf * 0.55, -T * 0.62, 0.2], [m.chestHalf * 0.58, -T * 0.1, 0.5], [-m.chestHalf * 0.58, -T * 0.1, 0.5]])
        let inner = weave(g, bib, color)
        if (fine(c)) inner += stitch(c, smooth([[-m.chestHalf * 0.5, -T * 0.08], [-m.chestHalf * 0.5, -T * 0.58, 0], [m.chestHalf * 0.5, -T * 0.58, 0], [m.chestHalf * 0.5, -T * 0.08]], false), thread, u, 0.85)
        if (c.view === 'front') inner += patchPocket(g, 0, -T * 0.52, m.chestHalf * 0.6, T * 0.17, color)
        out.add('spine', Z.bibFront, `${art}-bib`, dropShadow(g, bib, color, 0.8, 0.25) + piece(g, bib, color, { inner }))
        let straps = ''
        let hardware = ''
        for (const s of [-1, 1]) {
          const strap = poly([[s * m.chestHalf * 0.5, -T * 0.6], [s * m.chestHalf * 0.3, -T * 0.6], [s * m.shoulderHalf * 0.45, -T - 1], [s * m.shoulderHalf * 0.65, -T + 1]])
          straps += piece(g, strap, color, { inner: fine(c) ? stitch(c, `M${f(s * m.chestHalf * 0.34)} ${f(-T * 0.6)}L${f(s * m.shoulderHalf * 0.49)} ${f(-T - 1)}M${f(s * m.chestHalf * 0.46)} ${f(-T * 0.6)}L${f(s * m.shoulderHalf * 0.61)} ${f(-T + 1)}`, thread, u, 0.8) : undefined })
          if (c.view === 'front') {
            // Metal slider buckle and the button it hooks onto.
            const bx = s * m.chestHalf * 0.42
            const by = -T * 0.62
            hardware += P.shape(roundRect(bx - m.neckR * 0.22, by - m.neckR * 0.34, m.neckR * 0.44, m.neckR * 0.5, m.neckR * 0.08), color2, { material: 'metal', outline: 0.6 }) + button(c, bx, by - m.neckR * 0.08, m.neckR * 0.1, shadowOf(color2, 0.1), 'metal')
          }
        }
        out.add('spine', Z.bibFront, `${art}-straps`, straps + hardware)
      }
      // Side buttons at the hips.
      if (c.view === 'front') out.add('hips', Z.bottom + 1, `${art}-side`, button(c, -(m.hipHalf + off) * 0.93, -T * 0.06, u * 1.3, color2, 'metal') + button(c, (m.hipHalf + off) * 0.93, -T * 0.06, u * 1.3, color2, 'metal'))
      else if (c.view === 'side') out.add('hips', Z.bottom + 1, `${art}-side`, button(c, 0, -T * 0.06, u * 1.3, color2, 'metal'))
      break
    }
    case 'skirt':
    case 'kilt': {
      const cut = art === 'kilt' ? 'pleated' : p.s('cut') || 'aline'
      const len = art === 'kilt' ? 0.45 : p.n('length')
      out.add('hem', Z.bottom + 1, art, onHem(c, skirtShape(g, cut, len, color, color2)))
      break
    }
  }
}

function skirtShape(g: G, cut: string, len01: number, color: string, color2: string, waistY?: number): string {
  const { c, m, u } = g
  const T = m.torsoLen
  const P = c.paint
  const top = waistY ?? -T * 0.18
  const legLen = m.thigh + m.shin
  const hemY = m.pelvisH + legLen * lerp(0.12, 0.95, clamp(len01, 0, 1)) * (cut === 'tutu' ? 0.45 : 1)
  const topHalf = bodyHalfAt(m, top) + m.armR * 0.1
  const hipHalf = m.hipHalf + m.armR * 0.15
  const flareK = cut === 'pencil' ? 0.05 : cut === 'tutu' ? 0.9 : cut === 'pleated' ? 0.35 : 0.3
  const hemHalf = Math.max(hipHalf, bodyHalfAt(m, hemY)) + legLen * flareK * (hemY - top) / legLen
  const baked = rich(c)
  g.layers.bottom = { color, off: m.armR * 0.1, skirt: true }
  if (c.view === 'side') {
    const d = smooth([[-m.waistHalf * 0.6, top], [m.bellyDepth * 0.85, top], [m.bellyDepth + hemHalf * 0.25, hemY, 0.5], [-m.buttDepth - hemHalf * 0.3, hemY, 0.5], [-m.buttDepth - 2, m.pelvisH * 0.2]])
    let inner = weave(g, d, color)
    inner += creases(c, [{ pts: [[m.bellyDepth * 0.4, m.pelvisH * 0.4], [m.bellyDepth * 0.5, lerp(m.pelvisH, hemY, 0.5)], [m.bellyDepth * 0.6, hemY - u * 2]], w: u * 1.4 }, { pts: [[-m.buttDepth * 0.5, m.pelvisH * 0.6], [-m.buttDepth * 0.7, lerp(m.pelvisH, hemY, 0.6)], [-m.buttDepth * 0.85, hemY - u * 2]], w: u * 1.3 }], color)
    inner += glossBands(g, [[[0, m.pelvisH * 0.3], [hemHalf * 0.05, hemY - u * 4]]], hemHalf * 0.2, color)
    inner += stitch(c, `M${f(-hemHalf * 2)} ${f(hemY - u * 2)}H${f(hemHalf * 2)}`, threadOf(g, color), u)
    return piece(g, d, color, { inner })
  }
  let hem: P[] = []
  const n = cut === 'pleated' ? 8 : cut === 'tutu' ? 10 : baked ? 6 : 4
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = lerp(hemHalf, -hemHalf, t)
    const dip = Math.sin(Math.PI * t) * m.pelvisH * 0.15
    // A-line hems ripple into soft flutes in baked stills.
    const flute = cut === 'aline' && baked && i > 0 && i < n ? (i % 2 ? 1 : -1) * m.pelvisH * 0.05 : 0
    hem.push([x, hemY + dip + flute + (cut === 'pleated' && i % 2 ? m.pelvisH * 0.08 : 0)])
    if (cut === 'tutu' && i < n) hem.push([lerp(hemHalf, -hemHalf, t + 0.5 / n), hemY + dip + m.pelvisH * 0.18])
  }
  if (cut !== 'pleated' && cut !== 'tutu') hem = hem.map(([x, y]) => [x, y] as P)
  const pts: SP[] = [[-topHalf, top, 0.4], [topHalf, top, 0.4], [hipHalf, m.pelvisH * 0.15], ...hem.map(([x, y], i) => (cut === 'pleated' || cut === 'tutu' || i === 0 || i === hem.length - 1 ? [x, y, 0.3] : [x, y]) as SP), [-hipHalf, m.pelvisH * 0.15]]
  const d = smooth(pts)
  let inner = weave(g, d, color)
  const hipLine = m.pelvisH * 0.22
  if (cut === 'pleated' && P.detail > 0) {
    // Knife pleats: every other panel turns away from the light.
    let dark = ''
    let lines = ''
    for (let i = 0; i < n; i++) {
      const t0 = i / n
      const t1 = (i + 1) / n
      const a0: P = [lerp(topHalf, -topHalf, t0), hipLine]
      const a1: P = [lerp(topHalf, -topHalf, t1), hipLine]
      const b0: P = [lerp(hemHalf, -hemHalf, t0), hemY + Math.sin(Math.PI * t0) * m.pelvisH * 0.15 + (i % 2 ? m.pelvisH * 0.08 : 0)]
      const b1: P = [lerp(hemHalf, -hemHalf, t1), hemY + Math.sin(Math.PI * t1) * m.pelvisH * 0.15 + ((i + 1) % 2 ? m.pelvisH * 0.08 : 0)]
      if (i % 2) dark += poly([a0, a1, [b1[0], b1[1] + 4], [b0[0], b0[1] + 4]])
      if (i > 0) lines += `M${f(a0[0])} ${f(a0[1])}L${f(b0[0])} ${f(b0[1])}`
    }
    if (tonal(c)) inner += P.flat(dark, shadowOf(color, 0.2), 0.45)
    inner += P.line(lines, shadowOf(color, 0.35), Math.max(u * 0.5, P.lw * 0.55), { opacity: 0.7 })
  } else if (cut === 'aline' || cut === 'pencil') {
    const folds: { pts: P[]; w: number }[] = []
    const k = cut === 'pencil' ? 3 : baked ? 5 : 3
    for (let i = 1; i < k; i++) {
      const t = i / k
      const xt = lerp(topHalf, -topHalf, t) * 0.8
      const xb = lerp(hemHalf, -hemHalf, t)
      folds.push({ pts: [[xt, hipLine + T * 0.04], [lerp(xt, xb, 0.55), lerp(hipLine, hemY, 0.55)], [xb, hemY + Math.sin(Math.PI * t) * m.pelvisH * 0.15 - u * 1.5]], w: u * (cut === 'pencil' ? 1.1 : 2.2) })
    }
    if (cut === 'pencil') folds.push({ pts: [[-hipHalf * 0.7, m.pelvisH * 0.3], [0, m.pelvisH * 0.45], [hipHalf * 0.7, m.pelvisH * 0.32]], w: u * 1.1 })
    inner += creases(c, folds, color)
    // Lit ridges between the valleys.
    if (baked && cut === 'aline' && tonal(c)) {
      const ridges: P[][] = []
      for (let i = 0; i < k; i++) {
        const t = (i + 0.5) / k
        ridges.push([[lerp(topHalf, -topHalf, t) * 0.8, hipLine + T * 0.08], [lerp(hemHalf, -hemHalf, t) * 0.95, hemY - u * 3]])
      }
      inner += ridges.map((r) => P.flat(brush(r, 0, 0, hemHalf * 0.14), highlightOf(color, 0.14), 0.4)).join('')
    }
    inner += glossBands(g, [[[-hipHalf * 0.3, hipLine + T * 0.05], [-hemHalf * 0.35, hemY - u * 5]], [[hipHalf * 0.45, hipLine + T * 0.08], [hemHalf * 0.5, hemY - u * 5]]], hemHalf * 0.16, color)
    inner += stitch(c, smooth(hem.map(([x, y]) => [x * 1.05, y - u * 2.2] as P), false), threadOf(g, color), u, 0.7)
  }
  let svg = piece(g, d, color, { inner })
  if (cut === 'tutu') {
    // Two more layers of tulle, lighter and translucent, each with a scalloped hem.
    for (const [k, a] of [[0.85, 0.72], [0.68, 0.6]] as const) {
      const layer = smooth(pts.map(([x, y, s]) => [x * k, top + (y - top) * (k * 0.9), s] as SP))
      svg += P.shape(layer, highlightOf(color, (1 - k) * 0.9), { shade: 0.4, material: 'cloth', opacity: a, outline: 0.6 })
    }
  }
  if (P.detail > 0) {
    const band = roundRect(-topHalf - 1, top - T * 0.02, topHalf * 2 + 2, T * 0.06, 2)
    svg += P.shape(band, shadowOf(color, 0.1), { shade: 0.3, material: 'cloth', inner: fine(c) ? stitch(c, `M${f(-topHalf * 2)} ${f(top + T * 0.025)}H${f(topHalf * 2)}`, shadowOf(color, 0.35), u, 0.6) : undefined })
    if (g.art === 'kilt' && c.view === 'front') {
      // Apron edge with fringe and the kilt pin.
      const ex = hemHalf * 0.55
      svg += P.line(`M${f(topHalf * 0.55)} ${f(top + T * 0.04)}L${f(ex)} ${f(hemY + m.pelvisH * 0.08)}`, P.ink(color), Math.max(u * 0.5, P.lw * 0.6)) + P.line(`M${f(topHalf * 0.55 + u)} ${f(top + T * 0.06)}L${f(ex + u)} ${f(hemY + m.pelvisH * 0.06)}`, color2, u * 1.4, { dash: `${f(u * 0.3)} ${f(u * 0.4)}`, cap: 'butt' })
      svg += P.line(`M${f(ex * 0.8)} ${f(lerp(top, hemY, 0.55))}l${f(u * 0.5)} ${f(T * 0.12)}`, '#c9ccd3', u * 0.7) + P.shape(circle(ex * 0.8 + u * 0.5, lerp(top, hemY, 0.55) + T * 0.12, u * 1.1), '#c79212', { material: 'metal', outline: 0.5, shade: 0.5 })
    }
  }
  void color2
  return svg
}

/* ---- One-pieces ------------------------------------------------------------------- */

function drawFull(g: G): void {
  const { c, out, m, p, art, u } = g
  const T = m.torsoLen
  const P = c.paint
  const color = col(g)
  const color2 = p.c('color2', shadowOf(color, 0.3))
  const off = m.armR * 0.12
  const z = { upper: Z.sleeveUpper, lower: Z.sleeveLower }
  switch (art) {
    case 'dress': {
      const neck = (p.s('neck') || 'scoop') as Neck
      const o: TopOpts = { off, neck, hem: -T * 0.1 }
      let inner = neckband(g, neck, off, color, 2.4, false)
      if (c.view === 'front' && tonal(c)) inner += creases(c, [{ pts: [[-m.chestHalf * 0.55, -T * 0.42], [-m.chestHalf * 0.45, -T * 0.52]], w: u * 1.1 }, { pts: [[m.chestHalf * 0.55, -T * 0.42], [m.chestHalf * 0.45, -T * 0.52]], w: u * 1.1 }], color)
      inner += glossBands(g, [[[-m.chestHalf * 0.4, -T * 0.8], [-m.chestHalf * 0.42, -T * 0.2]]], m.chestHalf * 0.14, color)
      torso(g, o, color, { inner, id: `${art}-bodice`, fold: 'none', hemStitch: false })
      g.layers.top = { hem: -T * 0.1, off, flare: 0, color }
      const len = p.n('length')
      const flare = p.n('flare')
      out.add('hem', Z.bottom + 2, `${art}-skirt`, onHem(c, skirtShape(g, flare > 0.7 ? 'tutu' : flare < 0.25 ? 'pencil' : 'aline', len, color, color2, -T * 0.16)))
      addSleeves(g, { len: (p.s('sleeves') || 'short') as 'short', off: off * 1.2, color, z })
      break
    }
    case 'gown': {
      const o: TopOpts = { off, neck: 'sweetheart', hem: -T * 0.1 }
      let inner = ''
      if (c.view === 'front') {
        // Princess seams and a satin sheen.
        inner += seamLine(c, `M${f(-m.chestHalf * 0.4)} ${f(-T * 0.82)}Q${f(-m.chestHalf * 0.3)} ${f(-T * 0.45)} ${f(-m.chestHalf * 0.25)} ${f(-T * 0.08)}M${f(m.chestHalf * 0.4)} ${f(-T * 0.82)}Q${f(m.chestHalf * 0.3)} ${f(-T * 0.45)} ${f(m.chestHalf * 0.25)} ${f(-T * 0.08)}`, color, u, 0.5)
        inner += glossBands(g, [[[-m.chestHalf * 0.55, -T * 0.78], [-m.chestHalf * 0.5, -T * 0.2]], [[m.chestHalf * 0.1, -T * 0.7], [m.chestHalf * 0.08, -T * 0.2]]], m.chestHalf * 0.16, color)
      }
      torso(g, o, color, { inner, id: `${art}-bodice`, fold: 'none', hemStitch: false })
      g.layers.top = { hem: -T * 0.1, off, flare: 0, color }
      const legLen = m.thigh + m.shin
      const top = -T * 0.16
      const hemY = m.pelvisH + legLen + m.footH
      const w = m.hipHalf + legLen * 0.55
      const d = c.view === 'side'
        ? smooth([[-m.waistHalf * 0.6, top], [m.bellyDepth * 0.9, top], [m.bellyDepth + w * 0.45, hemY, 0.4], [-m.buttDepth - w * 0.55, hemY, 0.4]])
        : smooth([[-bodyHalfAt(m, top), top, 0.5], [bodyHalfAt(m, top), top, 0.5], [m.hipHalf * 1.3, m.pelvisH * 0.5], [w, hemY, 0.4], [0, hemY + m.pelvisH * 0.2], [-w, hemY, 0.4], [-m.hipHalf * 1.3, m.pelvisH * 0.5]])
      let sInner = ''
      if (c.view !== 'side') {
        const ks = rich(c) ? [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75] : [-0.55, -0.2, 0.2, 0.55]
        const folds = ks.map((k) => ({ pts: [[k * m.hipHalf * 0.9, m.pelvisH * 0.4], [k * w * 0.62, lerp(m.pelvisH, hemY, 0.5)], [k * w * 0.98, hemY - u * 2]] as P[], w: u * (rich(c) ? 3.2 : 1.6) }))
        sInner += creases(c, folds, color)
        sInner += glossBands(g, [[[-m.hipHalf * 0.6, m.pelvisH * 0.5], [-w * 0.3, lerp(m.pelvisH, hemY, 0.5)], [-w * 0.55, hemY - u * 6]], [[m.hipHalf * 0.3, m.pelvisH * 0.5], [w * 0.15, lerp(m.pelvisH, hemY, 0.5)], [w * 0.3, hemY - u * 6]]], w * 0.12, color)
        if (tonal(c)) sInner += castShadow(c, rect(-w * 1.2, hemY - legLen * 0.25, w * 2.4, legLen * 0.25 + m.pelvisH), color, [0.5, 1], [0.5, 0], 0.3)
      } else sInner += glossBands(g, [[[0, m.pelvisH * 0.5], [w * 0.1, hemY - u * 6]]], w * 0.14, color)
      let svg = piece(g, d, color, { inner: weave(g, d, color) + sInner })
      const sash = roundRect(-bodyHalfAt(m, top), top - T * 0.03, bodyHalfAt(m, top) * 2, T * 0.06, 2)
      svg += P.shape(sash, color2, { material: 'cloth', spec: 0.5, inner: rich(c) ? sheen(c, [[-bodyHalfAt(m, top) * 0.8, top - T * 0.005], [bodyHalfAt(m, top) * 0.2, top - T * 0.01]], T * 0.025, color2, 1.2) : undefined })
      out.add('hem', Z.bottom + 2, `${art}-skirt`, onHem(c, svg))
      g.layers.bottom = { color, off, skirt: true }
      addSleeves(g, { len: (p.s('sleeves') || 'none') as 'none', off: off * 1.2, color, z })
      break
    }
    case 'robe':
    case 'kimono': {
      const legLen = m.thigh + m.shin
      const hem = m.pelvisH + legLen * 0.96
      const o: TopOpts = { off: off * 2, neck: art === 'kimono' ? 'wrap' : 'v', hem, flare: legLen * 0.14, loose: 1 }
      const trim = art === 'kimono' ? p.c('obi', '#26252c') : color2
      let inner = ''
      if (c.view === 'front') {
        // The front opening, edged with a trim band.
        if (art === 'kimono') {
          // The eri: a wide contrast collar down the wrap to the obi, then just the overlap.
          const eri = `M${f(-m.neckR * 1.15)} ${f(-T - 2)}L${f(m.neckR * 0.35)} ${f(-T * 0.3)}`
          inner += P.line(eri, color2, m.neckR * 0.55) + P.line(eri, shadowOf(color2, 0.25), m.neckR * 0.08).replace('<path ', `<path transform="translate(${f(m.neckR * 0.2)} 0)" `)
          inner += seamLine(c, `M${f(m.neckR * 0.35)} ${f(-T * 0.3)}L${f(m.neckR * 0.45)} ${f(hem + 4)}`, color, u * 1.4, 0.8)
        } else {
          const edge = `M${f(-m.neckR * 1.1)} ${f(-T - 2)}L${f(0)} ${f(-T + T * 0.24)}L${f(0)} ${f(hem + 4)}`
          inner += P.line(edge, color2, m.neckR * 0.34) + stitch(c, `M${f(-m.neckR * 0.88)} ${f(-T - 2)}L${f(m.neckR * 0.22)} ${f(-T + T * 0.24)}L${f(m.neckR * 0.22)} ${f(hem + 4)}`, shadowOf(color2, 0.3), u, 0.6)
        }
        if (art === 'robe' && p.b('stars')) inner += P.flat(star(-m.hipHalf * 0.4, m.pelvisH + legLen * 0.5, m.neckR * 0.3, m.neckR * 0.13) + star(m.hipHalf * 0.5, m.pelvisH + legLen * 0.2, m.neckR * 0.22, m.neckR * 0.1) + star(m.hipHalf * 0.1, m.pelvisH + legLen * 0.8, m.neckR * 0.26, m.neckR * 0.11) + star(-m.hipHalf * 0.6, m.pelvisH + legLen * 0.15, m.neckR * 0.18, m.neckR * 0.08), color2)
        inner += glossBands(g, [[[-m.hipHalf * 0.5, -T * 0.3], [-m.hipHalf * 0.6, m.pelvisH + legLen * 0.5], [-m.hipHalf * 0.7, hem - u * 4]]], m.hipHalf * 0.16, color)
      }
      torso(g, o, color, { inner, fold: 'drape' })
      g.layers.top = { hem, off: o.off, flare: o.flare ?? 0, color }
      if (c.view !== 'side') {
        const y = -T * 0.2
        const hx = bodyHalfAt(m, y) + off * 2
        const bh = T * (art === 'kimono' ? 0.2 : 0.06)
        const band = roundRect(-hx, y - bh / 2, hx * 2, bh, 3)
        let bInner = ''
        if (art === 'kimono') {
          bInner += weave(g, band, trim) + (fine(c) ? P.line(`M${f(-hx * 2)} ${f(y)}H${f(hx * 2)}`, color2, u * 1.4) : '')
          if (c.view === 'back') bInner += P.shape(smooth([[-hx * 0.5, y - bh * 0.6], [hx * 0.5, y - bh * 0.6], [hx * 0.6, y + bh * 0.9], [-hx * 0.6, y + bh * 0.9]]), shadowOf(trim, 0.05), { material: 'cloth', shade: 0.6 })
        }
        out.add('spine', Z.belt, `${art}-belt`, dropShadow(g, band, color) + P.shape(band, trim, { material: 'cloth', spec: art === 'kimono' ? 0.3 : undefined, inner: bInner || undefined }))
        if (art === 'robe' && c.view === 'front') out.add('spine', Z.belt + 0.5, `${art}-knot`, P.line(`M${f(m.neckR * 0.5)} ${f(y)}q${f(u * 2)} ${f(T * 0.12)} ${f(-u)} ${f(T * 0.25)}M${f(m.neckR * 0.5)} ${f(y)}q${f(u * 4)} ${f(T * 0.1)} ${f(u * 3)} ${f(T * 0.2)}`, trim, T * 0.03))
      }
      addSleeves(g, {
        len: 1.85,
        off: off * 2,
        color,
        z,
        flare: m.wristR * (art === 'kimono' ? 1.3 : 1.0),
        cuff: color2,
        cuffKind: 'band',
        lowerInner: (_s, end, r) => creases(c, [{ pts: [[-r * 0.2, m.elbowR], [-r * 0.45, end * 0.6], [-r * 0.6, end - u * 3]], w: u * 2 }, { pts: [[r * 0.3, m.elbowR * 1.5], [r * 0.5, end * 0.65], [r * 0.62, end - u * 3]], w: u * 1.6 }], color),
      })
      break
    }
    case 'jumpsuit':
    case 'spacesuit':
    case 'wetsuit':
    case 'hero': {
      const suitOff = art === 'spacesuit' ? m.armR * 0.35 : art === 'hero' || art === 'wetsuit' ? m.armR * 0.03 : off
      const o: TopOpts = { off: suitOff, neck: art === 'hero' || art === 'wetsuit' ? 'crew' : art === 'spacesuit' ? 'high' : 'collar', hem: m.pelvisH * 0.2, loose: art === 'spacesuit' ? 0.8 : 0.2 }
      let inner = ''
      if (art === 'hero') inner += chestPrint(g, color, suitOff) + glossBands(g, [[[-m.chestHalf * 0.5, -T * 0.85], [-m.chestHalf * 0.55, -T * 0.55]], [[m.chestHalf * 0.4, -T * 0.8], [m.chestHalf * 0.45, -T * 0.55]]], m.chestHalf * 0.2, color)
      if (art === 'wetsuit') {
        inner += glossBands(g, [[[-m.chestHalf * 0.5, -T * 0.85], [-m.chestHalf * 0.55, -T * 0.3]]], m.chestHalf * 0.2, color)
        if (c.view !== 'side') {
          // A contrast panel with flatlock seams.
          const panel = poly([[-m.chestHalf * 1.5, -T * 0.72], [m.chestHalf * 1.5, -T * 0.46], [m.chestHalf * 1.5, -T * 0.36], [-m.chestHalf * 1.5, -T * 0.62]])
          inner += P.flat(panel, color2) + stitch(c, `M${f(-m.chestHalf * 1.5)} ${f(-T * 0.72 + u)}L${f(m.chestHalf * 1.5)} ${f(-T * 0.46 + u)}M${f(-m.chestHalf * 1.5)} ${f(-T * 0.62 - u)}L${f(m.chestHalf * 1.5)} ${f(-T * 0.36 - u)}`, highlightOf(color2, 0.3), u * 1.1, 0.8)
        }
        if (c.view === 'back') inner += zipper(c, 0, -T - 2, -T * 0.25, u * 1.1, color, '#c9ccd3', false) + P.line(`M0 ${f(-T * 0.25)}q${f(u * 2)} ${f(T * 0.2)} 0 ${f(T * 0.42)}`, '#26252c', u * 0.8)
      }
      if (art === 'jumpsuit' && c.view === 'front') {
        inner += zipper(c, 0, -T + T * 0.14, m.pelvisH * 0.2, u * 1.1, color, '#c9ccd3')
        for (const s of [-1, 1]) inner += patchPocket(g, s * m.chestHalf * 0.5, -T * 0.78, m.chestHalf * 0.38, T * 0.16, color, true)
      }
      if (art === 'spacesuit' && c.view !== 'side') {
        const quilt = [0.25, 0.45].map((k) => `M${f(-m.chestHalf * 2)} ${f(-T * k)}Q0 ${f(-T * k + T * 0.03)} ${f(m.chestHalf * 2)} ${f(-T * k)}`).join('')
        inner += P.line(quilt, shadowOf(color, 0.25), u * 0.8, { opacity: 0.7 })
      }
      torso(g, o, color, { inner, fold: art === 'hero' || art === 'wetsuit' ? 'none' : 'fitted', hemStitch: false })
      g.layers.top = { hem: m.pelvisH * 0.2, off: suitOff, flare: 0, color }
      pelvisPiece(g, suitOff, color, shadowOf(color, 0.3), 'suit', Z.bottom, `${art}-pelvis`)
      const joint = art === 'spacesuit'
      addLegs(g, {
        len: 2,
        off: suitOff,
        color,
        z: Z.pantsLeg,
        cuffKind: art === 'hero' || art === 'wetsuit' ? 'none' : 'hem',
        upperInner: (_s, end, r) => (joint ? bellows(g, end - m.kneeR * 0.9, r, color) : '') + (art === 'hero' || art === 'wetsuit' ? glossBands(g, [[[-r * 0.3, end * 0.15], [-r * 0.25, end * 0.85]]], r * 0.3, color) : ''),
        lowerInner: (_s, end, r) => (joint ? bellows(g, m.kneeR * 0.2, r, color) : '') + (art === 'hero' || art === 'wetsuit' ? glossBands(g, [[[-r * 0.3, m.kneeR * 0.6], [-r * 0.2, end * 0.85]]], r * 0.3, color) : ''),
      })
      addSleeves(g, {
        len: art === 'hero' || art === 'wetsuit' || art === 'spacesuit' || p.s('sleeves') === 'long' ? 'long' : ((p.s('sleeves') || 'long') as 'long'),
        off: suitOff,
        color,
        z,
        cuff: art === 'spacesuit' ? color2 : undefined,
        cuffKind: art === 'spacesuit' ? 'band' : art === 'hero' || art === 'wetsuit' ? 'none' : 'hem',
        upperInner: (_s, end, r) => (joint ? bellows(g, end - m.elbowR * 0.8, r, color) : '') + (art === 'hero' ? glossBands(g, [[[-r * 0.3, end * 0.15], [-r * 0.3, end * 0.8]]], r * 0.3, color) : ''),
      })
      if (art === 'hero') {
        const trunks = pantsPelvis(c, m, suitOff * 1.5, 0.8)
        out.add('hips', Z.bottom + 1, 'trunks', piece({ ...g, fab: 'spandex' }, trunks, color2, { patterned: false, inner: glossBands({ ...g, fab: 'spandex' }, [[[-m.hipHalf * 0.5, 0], [-m.hipHalf * 0.4, m.pelvisH * 0.6]]], m.hipHalf * 0.2, color2) }))
        if (c.view !== 'side') {
          const y = -T * 0.1
          const hx = bodyHalfAt(m, y) + suitOff * 1.5
          const belt = roundRect(-hx, y - T * 0.035, hx * 2, T * 0.07, 2)
          out.add('hips', Z.bottom + 1.2, 'hero-belt', dropShadow(g, belt, color) + P.shape(belt, color2, { material: 'leather' }) + (c.view === 'front' ? P.shape(roundRect(-T * 0.06, y - T * 0.05, T * 0.12, T * 0.1, T * 0.02), '#f2d14a', { material: 'metal', outline: 0.7 }) : ''))
        }
      }
      if (art === 'spacesuit' && c.view !== 'side') {
        let panel = P.shape(roundRect(-m.chestHalf * 0.45, -T * 0.7, m.chestHalf * 0.9, T * 0.3, 6), color2, { material: 'plastic', spec: 0.4 })
        if (c.view === 'front' && P.detail > 0) {
          // Control panel: buttons and a readout.
          panel += P.shape(roundRect(-m.chestHalf * 0.34, -T * 0.66, m.chestHalf * 0.4, T * 0.09, 3), '#263238', { material: 'glass', outline: 0.5 }) + P.flat(roundRect(-m.chestHalf * 0.3, -T * 0.64, m.chestHalf * 0.22, T * 0.03, 1), '#80deea', 0.9)
          for (const [i, bc] of ['#ef5350', '#fdd835', '#66bb6a'].entries()) panel += P.shape(circle(m.chestHalf * (0.14 + i * 0.1), -T * 0.62, m.chestHalf * 0.04), bc, { material: 'plastic', outline: 0.5, shade: 0.4 })
          panel += P.shape(circle(-m.chestHalf * 0.2, -T * 0.48, m.chestHalf * 0.07), '#b0bec5', { material: 'metal', outline: 0.6 }) + P.shape(circle(m.chestHalf * 0.2, -T * 0.48, m.chestHalf * 0.07), '#b0bec5', { material: 'metal', outline: 0.6 })
        }
        if (p.b('patch') && c.view === 'front') panel += P.shape(circle(m.chestHalf * 0.55, -T * 0.82, m.neckR * 0.35), '#283593', { material: 'cloth', inner: fine(c) ? stitch(c, circle(m.chestHalf * 0.55, -T * 0.82, m.neckR * 0.3), '#fdd835', u * 0.8, 0.8) : undefined }) + P.flat(star(m.chestHalf * 0.55, -T * 0.82, m.neckR * 0.22, m.neckR * 0.1), '#fdd835')
        out.add('spine', Z.topDetail, 'panel', dropShadow(g, roundRect(-m.chestHalf * 0.45, -T * 0.7, m.chestHalf * 0.9, T * 0.3, 6), color) + panel)
        // The neck ring a helmet locks onto.
        if (c.view === 'front') out.add('spine', Z.topDetail + 0.5, 'neck-ring', P.shape(roundRect(-m.neckR * 1.4, -T - m.neckLen * 0.15, m.neckR * 2.8, T * 0.08, T * 0.03), '#b0bec5', { material: 'metal' }))
      }
      if (art === 'jumpsuit' && p.b('belt')) {
        const y = -T * 0.12
        const hx = bodyHalfAt(m, y) + suitOff
        const band = roundRect(-hx, y - T * 0.035, hx * 2, T * 0.07, 2)
        out.add('spine', Z.belt, 'belt', dropShadow(g, band, color) + (c.view === 'front' ? beltBand(g, band, color2, 0, y, T * 0.085) : P.shape(band, color2, { material: 'leather' })))
      }
      if (art === 'jumpsuit' && c.view === 'front') collar(g, 'point', color, color)
      break
    }
    case 'knight': {
      const metal = color
      const trim = color2
      armorChest(g, metal, trim, m.armR * 0.3, m.pelvisH * 0.3)
      g.layers.top = { hem: m.pelvisH * 0.3, off: m.armR * 0.3, flare: 0, color }
      const gm: G = { ...g, fab: 'metal', p: reader({ pattern: 'solid' }) }
      // Tassets over the hips.
      out.add('hips', Z.bottom, `${art}-pelvis`, P.shape(pantsPelvis(c, m, m.armR * 0.2), metal, { material: 'metal', inner: c.view !== 'side' && P.detail > 0 ? P.line(`M${f(-m.hipHalf * 2)} ${f(m.pelvisH * 0.4)}H${f(m.hipHalf * 2)}`, shadowOf(metal, 0.4), u * 0.8) : undefined }))
      addLegs(gm, { len: 2, off: m.armR * 0.15, color: metal, z: Z.pantsLeg, cuffKind: 'none', upperInner: (_s, end, r) => plateLines(gm, end, r, metal), lowerInner: (_s, end, r) => plateLines(gm, end, r, metal) + (c.view !== 'back' ? kneeCop(gm, r, metal, trim) : '') })
      addSleeves(gm, { len: 'long', off: m.armR * 0.2, color: metal, z, cuffKind: 'none', lowerInner: (_s, end, r) => plateLines(gm, end, r, metal) })
      if (c.view !== 'side') {
        const tabard = poly([[-m.chestHalf * 0.55, -T * 0.78], [m.chestHalf * 0.55, -T * 0.78], [m.chestHalf * 0.6, m.pelvisH + m.thigh * 0.4], [-m.chestHalf * 0.6, m.pelvisH + m.thigh * 0.4]])
        const tc = p.c('tabard', '#c62828')
        let tInner = weave({ ...g, fab: 'wool' }, tabard, tc) + P.line(tabard, trim, u * 2.2)
        tInner += creases(c, [{ pts: [[-m.chestHalf * 0.3, -T * 0.1], [-m.chestHalf * 0.35, m.pelvisH], [-m.chestHalf * 0.4, m.pelvisH + m.thigh * 0.35]], w: u * 1.6 }, { pts: [[m.chestHalf * 0.25, -T * 0.05], [m.chestHalf * 0.3, m.pelvisH], [m.chestHalf * 0.35, m.pelvisH + m.thigh * 0.35]], w: u * 1.4 }], tc)
        out.add('spine', Z.topDetail, 'tabard', dropShadow(g, tabard, metal, 1.2) + P.shape(tabard, tc, { material: 'cloth', inner: tInner }) + (c.view === 'front' ? crest(c, 'cross', 0, -T * 0.4, m.chestHalf * 0.55, trim) : ''))
      }
      for (const s of ['L', 'R'] as const) out.add(`upperArm${s}`, limbZ(c, s, Z.sleeveUpper + 1, true), `pauldron-${s}`, pauldron(g, metal, trim, 1.05))
      break
    }
    case 'onesie': {
      const belly = color2
      const offO = m.armR * 0.25
      const o: TopOpts = { off: offO, neck: 'crew', hem: m.pelvisH * 0.2, loose: 1 }
      let inner = ''
      if (c.view === 'front') {
        const bd = ellipse(0, -T * 0.35, m.chestHalf * 0.6, T * 0.35)
        inner += P.flat(bd, belly) + (fine(c) ? stitch(c, ellipse(0, -T * 0.35, m.chestHalf * 0.6 - u * 1.3, T * 0.35 - u * 1.3), shadowOf(belly, 0.3), u, 0.7) : '') + (rich(c) ? zipper(c, 0, -T + T * 0.08, -T * 0.72, u * 1, color, '#c9ccd3') : '')
      }
      torso(g, o, color, { inner, fold: 'loose', hemStitch: false })
      g.layers.top = { hem: o.hem, off: offO, flare: 0, color }
      pelvisPiece({ ...g, fab: 'fleece' }, offO, color, shadowOf(color, 0.3), 'suit', Z.bottom, `${art}-pelvis`)
      addLegs(g, { len: 2, off: offO, color, z: Z.pantsLeg, cuff: belly, cuffKind: 'rib' })
      addSleeves(g, { len: 'long', off: offO, color, z, cuff: belly, cuffKind: 'rib' })
      if (p.b('hoodUp')) out.add('head', Z.hairCap + 3, 'onesie-hood', hoodUp(c, m, color, u) + onesieEars(c, m, p.s('animal') || 'bear', color, belly))
      break
    }
  }
}

/** Accordion rings at a joint of a pressure suit (inner content). */
function bellows(g: G, y: number, r: number, color: string): string {
  const { c, u } = g
  if (c.paint.detail === 0) return ''
  let d = ''
  for (let i = 0; i < 3; i++) d += `M${f(-r * 1.2)} ${f(y + i * u * 2.6)}Q0 ${f(y + i * u * 2.6 + u * 1.6)} ${f(r * 1.2)} ${f(y + i * u * 2.6)}`
  return c.paint.line(d, shadowOf(color, 0.35), u * 0.9, { opacity: 0.8 }) + (rich(c) ? c.paint.line(d, highlightOf(color, 0.3), u * 0.45, { opacity: 0.7 }).replace('<path ', `<path transform="translate(0 ${f(-u * 1.1)})" `) : '')
}

/** Plate edges on an armoured limb piece (inner content). */
function plateLines(g: G, end: number, r: number, metal: string): string {
  const { c, u } = g
  if (c.paint.detail === 0) return ''
  let d = ''
  for (const k of [0.33, 0.66]) d += `M${f(-r * 1.3)} ${f(end * k)}Q0 ${f(end * k + u * 1.5)} ${f(r * 1.3)} ${f(end * k)}`
  return c.paint.line(d, shadowOf(metal, 0.45), u * 0.8) + (rich(c) ? sheen(c, [[-r * 0.45, end * 0.08], [-r * 0.45, end * 0.9]], r * 0.3, metal, 1.2) : '')
}

/** A knee cop: a round plate over the knee with a fan wing. */
function kneeCop(g: G, r: number, metal: string, trim: string): string {
  const { c, m, u } = g
  const k = m.kneeR
  return c.paint.shape(ellipse(0, -k * 0.1, r * 0.95, k * 0.8), metal, { material: 'metal', outline: 0.8 }) + (fine(c) ? rivet(c, 0, -k * 0.1, u * 1.1, trim) : '')
}

function onesieEars(c: Ctx, m: HumanMeasure, animal: string, color: string, inner: string): string {
  if (c.view === 'back' && animal === 'frog') return ''
  const hh = m.headH
  const hw = m.hw
  const P = c.paint
  const top = -hh * 1.08 - m.hairLift * 0.35
  let out = ''
  for (const s of [-1, 1]) {
    const x = s * hw * 0.62
    switch (animal) {
      case 'cat':
        out += P.shape(poly([[x - s * hw * 0.28, top + hh * 0.12], [x + s * hw * 0.05, top - hh * 0.2], [x + s * hw * 0.28, top + hh * 0.1]]), color) + P.flat(poly([[x - s * hw * 0.16, top + hh * 0.1], [x + s * hw * 0.04, top - hh * 0.1], [x + s * hw * 0.16, top + hh * 0.08]]), inner, 0.9)
        break
      case 'bunny':
        out += P.shape(ellipse(x * 0.7, top - hh * 0.25, hw * 0.15, hh * 0.32), color) + P.flat(ellipse(x * 0.7, top - hh * 0.22, hw * 0.07, hh * 0.22), inner)
        break
      case 'frog':
        out += P.shape(circle(x, top + hh * 0.02, hw * 0.24), '#f5f2eb', { material: 'plastic', spec: 0.4 }) + P.flat(circle(x, top + hh * 0.04, hw * 0.1), '#26252c')
        break
      case 'dino':
        if (s > 0) for (let i = 0; i < 3; i++) out += P.shape(poly([[-hw * 0.2 + i * hw * 0.25, top + hh * 0.06], [-hw * 0.08 + i * hw * 0.25, top - hh * 0.14], [hw * 0.04 + i * hw * 0.25, top + hh * 0.06]]), inner)
        break
      case 'panda':
        out += P.shape(circle(x, top + hh * 0.04, hw * 0.2), '#26252c')
        break
      default:
        out += P.shape(circle(x, top + hh * 0.04, hw * 0.22), color) + P.flat(circle(x, top + hh * 0.05, hw * 0.12), inner)
    }
  }
  return out
}

/* ---- Outerwear -------------------------------------------------------------------- */

/** A notched lapel (blazer, trench, lab coat) or a wide leather lapel, one side. */
function lapel(g: G, s: number, kind: 'notch' | 'wide' | 'shawl', breakY: number, gap: number): string {
  const { m } = g
  const T = m.torsoLen
  const nr = m.neckR
  if (kind === 'shawl') return smooth([[s * nr * 0.95, -T - 1], [s * nr * 1.9, -T + T * 0.06], [s * nr * 1.7, -T + T * 0.3], [s * gap * 1.02, breakY, 0], [s * nr * 0.8, -T + T * 0.1]])
  const k = kind === 'wide' ? 1.15 : 1
  return smooth([
    [s * nr * 0.95, -T - 1],
    [s * nr * 2.05 * k, -T + T * 0.05, 0.4],
    [s * nr * 1.85 * k, -T + T * 0.15, 0],
    [s * nr * 2.2 * k, -T + T * 0.17, 0],
    [s * nr * 1.55 * k, -T + T * 0.42, 0.6],
    [s * gap * 1.02, breakY, 0],
    [s * nr * 0.72, -T + T * 0.08],
  ])
}

/** A quilted channel set: pillowy bands between stitched seams (inner content). */
function quilting(g: G, x0: number, x1: number, ys: number[], color: string): string {
  const { c, u } = g
  const P = c.paint
  if (P.detail === 0) return ''
  let s = ''
  if (tonal(c)) {
    // Each channel puffs: lit across its upper half, shadowed down into the seam below it.
    const lit = P.linear(`qp${P.col(color).slice(1)}`, [[0, shadowOf(color, 0.25), 0.55], [0.3, highlightOf(color, 0.2), 0.45], [0.55, highlightOf(color, 0.1), 0], [0.82, shadowOf(color, 0.2), 0.25], [1, shadowOf(color, 0.35), 0.6]], [0, 0], [0, 1])
    for (let i = 0; i < ys.length - 1; i++) s += el('path', { d: rect(x0, ys[i], x1 - x0, ys[i + 1] - ys[i]), fill: lit })
  }
  const seams = ys.slice(1, -1).map((y) => `M${f(x0)} ${f(y)}H${f(x1)}`).join('')
  s += P.line(seams, shadowOf(color, 0.4), u * 0.7, { opacity: 0.85 })
  if (fine(c)) s += stitch(c, seams, shadowOf(color, 0.45), u * 0.8, 0.5)
  return s
}

function drawOuter(g: G): void {
  const { c, out, m, p, art, u } = g
  const T = m.torsoLen
  const P = c.paint
  const color = col(g)
  const color2 = p.c('color2', shadowOf(color, 0.3))
  const off = m.armR * (art === 'puffer' ? 0.6 : 0.3)
  const open = art === 'puffer' || art === 'waistcoat' ? false : p.b('open') || art === 'cardigan' || art === 'labcoat'
  const long = art === 'trench' || art === 'labcoat'
  const hem = long ? m.pelvisH + m.thigh * 0.85 : art === 'waistcoat' ? m.pelvisH * 0.1 : m.pelvisH * 0.5
  const z = { upper: Z.outerSleeve - 1, lower: Z.outerSleeve }
  const flare = long ? m.hipHalf * 0.12 : 0
  const gap = m.neckR * 0.55
  const sx = (c.hr as HumanRig).sx
  const front = c.view === 'front'
  if (art === 'waistcoat') {
    waistcoat(g, off, hem, color, Z.outer, art)
    g.layers.outer = { hem, off, flare: 0, color, open: false, gap: 0 }
    return
  }
  const o: TopOpts = { off, neck: 'collar', hem, loose: 0.6, flare: open ? flare * 0.85 : flare }
  // Construction inside each panel (both panels when closed; x < 0 / x > 0 when open).
  const panelInner = (s: number): string => {
    let d = ''
    const inside = (x: number) => (open ? s * Math.abs(x) : x)
    if (!front) return d
    switch (art) {
      case 'jacket':
        if (fine(c)) d += zipper(c, inside(m.chestHalf * 0.55), -T * 0.3, -T * 0.12, u * 0.8, color, '#c9ccd3', true)
        break
      case 'denim': {
        // Yoke with double contrast stitching, flap chest pockets, placket stitching.
        const yoke = `M${f(-m.chestHalf * 2)} ${f(-T * 0.82)}Q0 ${f(-T * 0.78)} ${f(m.chestHalf * 2)} ${f(-T * 0.82)}`
        d += seamLine(c, yoke, color, u, 0.6)
        d += stitch(c, `M${f(-m.chestHalf * 2)} ${f(-T * 0.82 + u * 1.1)}Q0 ${f(-T * 0.78 + u * 1.1)} ${f(m.chestHalf * 2)} ${f(-T * 0.82 + u * 1.1)}M${f(-m.chestHalf * 2)} ${f(-T * 0.82 + u * 2.3)}Q0 ${f(-T * 0.78 + u * 2.3)} ${f(m.chestHalf * 2)} ${f(-T * 0.82 + u * 2.3)}`, color2, u, 0.9)
        for (const k of open ? [s] : [-1, 1]) d += patchPocket({ ...g }, k * m.chestHalf * 0.55, -T * 0.74, m.chestHalf * 0.46, T * 0.15, color, true)
        for (const k of open ? [s] : [-1, 1]) d += stitch(c, `M${f(k * m.chestHalf * 0.3)} ${f(-T * 0.55)}V${f(hem - T * 0.08)}`, color2, u, 0.85)
        break
      }
      case 'leather':
        if (!open) {
          // The asymmetric zip of a biker jacket.
          d += P.line(`M${f(sx * -m.neckR * 1.2)} ${f(-T * 0.92)}L${f(sx * m.chestHalf * 0.35)} ${f(-T * 0.35)}L${f(sx * m.chestHalf * 0.35)} ${f(hem)}`, shadowOf(color, 0.35), u * 2.2, { opacity: 0.8 }) + P.line(`M${f(sx * -m.neckR * 1.2)} ${f(-T * 0.92)}L${f(sx * m.chestHalf * 0.35)} ${f(-T * 0.35)}L${f(sx * m.chestHalf * 0.35)} ${f(hem)}`, '#c9ccd3', u * 0.9, { dash: `${f(u * 0.4)} ${f(u * 0.4)}`, cap: 'butt' })
        }
        if (fine(c)) d += zipper(c, inside(-sx * m.chestHalf * 0.55), -T * 0.28, -T * 0.1, u * 0.8, color, '#c9ccd3', true)
        d += glossBands(g, [[[inside(-m.chestHalf * 0.75), -T * 0.85], [inside(-m.chestHalf * 0.7), -T * 0.45], [inside(-m.chestHalf * 0.78), hem - T * 0.06]]], m.chestHalf * 0.18, color)
        break
      case 'blazer':
        // Flap pockets and a breast welt with a pocket square.
        for (const k of open ? [s] : [-1, 1]) {
          const px = k * m.hipHalf * 0.55
          const flap = roundRect(px - m.hipHalf * 0.28, -T * 0.08, m.hipHalf * 0.56, T * 0.07, 2)
          d += dropShadow(g, flap, color, 0.6, 0.35) + P.shape(flap, color, { shade: 0.4, outline: 0.6, material: 'cloth' })
        }
        if (!open || s === sx) {
          d += P.line(`M${f(sx * m.chestHalf * 0.35)} ${f(-T * 0.72)}l${f(sx * m.chestHalf * 0.35)} ${f(-T * 0.02)}`, shadowOf(color, 0.45), u * 0.9)
          d += P.shape(poly([[sx * m.chestHalf * 0.4, -T * 0.72], [sx * m.chestHalf * 0.48, -T * 0.77], [sx * m.chestHalf * 0.56, -T * 0.735], [sx * m.chestHalf * 0.64, -T * 0.78], [sx * m.chestHalf * 0.68, -T * 0.74]]), color2, { shade: 0.4, outline: 0.5, material: 'cloth', spec: 0.3 })
        }
        break
      case 'varsity':
        if (front && (!open || s === sx)) d += drawGraphic(c, 'text', sx * m.chestHalf * 0.5, -T * 0.7, m.chestHalf * 0.55, color2, (p.s('text') || 'A').slice(0, 2), color)
        break
      case 'trench':
        // Storm flap on the chest, belt loops.
        if (!open || s === -sx) {
          const flapX = -sx * m.chestHalf * 0.55
          const flap = smooth([[flapX - m.chestHalf * 0.4, -T * 0.94, 0], [flapX + m.chestHalf * 0.4, -T * 0.94, 0], [flapX + m.chestHalf * 0.42, -T * 0.7, 0.3], [flapX - m.chestHalf * 0.38, -T * 0.66, 0.3]])
          d += dropShadow(g, flap, color, 0.8, 0.3) + P.shape(flap, color, { shade: 0.4, outline: 0.6, material: 'cloth' })
        }
        break
      case 'cardigan':
        for (const k of open ? [s] : [-1, 1]) d += patchPocket(g, k * m.hipHalf * 0.55, -T * 0.05, m.hipHalf * 0.45, T * 0.17, color)
        break
      case 'labcoat':
        if (s === sx) d += patchPocket(g, sx * m.chestHalf * 0.55, -T * 0.72, m.chestHalf * 0.42, T * 0.16, color) + P.line(`M${f(sx * m.chestHalf * 0.45)} ${f(-T * 0.76)}V${f(-T * 0.64)}`, '#1e88e5', u * 1.3) + P.flat(circle(sx * m.chestHalf * 0.45, -T * 0.76, u * 0.8), '#c9ccd3')
        d += patchPocket(g, s * m.hipHalf * 0.55, m.pelvisH * 0.1, m.hipHalf * 0.5, T * 0.2, color)
        break
    }
    return d
  }
  const quiltYs = (y0: number, y1: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lerp(y0, y1, i / n))
  let body = ''
  const torsoInner = (d: string, s: number): string => {
    let inner = weave(g, d, color) + torsoFolds(g, o, color, long ? 'drape' : 'loose', open && front ? s : 0) + hemStitch(g, o, color, 2.2)
    if (art === 'puffer') inner += quilting(g, -m.shoulderHalf * 2, m.shoulderHalf * 2, quiltYs(-T * 1.05, hem + 4, 5), color)
    inner += panelInner(s)
    if (art === 'puffer' || art === 'jacket') inner += glossBands(g, [[[-m.chestHalf * 0.7, -T * 0.85], [-m.chestHalf * 0.72, -T * 0.4], [-m.chestHalf * 0.75, hem - T * 0.06]]], m.chestHalf * 0.16, color)
    return inner
  }
  if (open && front) {
    const panel = topShape(c, m, { ...o, open: true, gap })
    const left = mirrorD(panel)
    // Facing: the lining shows as a band along each opening edge; a cardigan has ribbed
    // button bands instead (buttons on one side, buttonholes on the other).
    const facing = (s: number) => {
      const edge = `M${f(s * gap * 0.95)} ${f(-T * 1.05)}L${f(s * gap * 0.95)} ${f(-T * 0.3)}L${f(s * gap)} ${f(hem + 2)}`
      if (art !== 'cardigan') return P.line(edge, shadowOf(color, 0.25), u * 2.2, { opacity: 0.9 })
      const bandC = color2
      let b = P.line(edge, bandC, u * 5) + (rich(c) ? P.line(edge, shadowOf(bandC, 0.3), u * 5, { dash: `${f(u * 0.25)} ${f(u * 0.45)}`, opacity: 0.45, cap: 'butt' }) : '')
      b += seamLine(c, `M${f(s * (gap * 0.95 - u * 2.5))} ${f(-T * 1.05)}L${f(s * (gap * 0.95 - u * 2.5))} ${f(-T * 0.3)}L${f(s * (gap - u * 2.5))} ${f(hem + 2)}`, bandC, u, 0.5)
      for (let i = 0; i < 5; i++) {
        const y = lerp(-T * 0.62, hem - T * 0.1, i / 4)
        const x = s * (lerp(gap * 0.95, gap, (y + T * 0.3) / (hem + T * 0.3)) - u * 1.3)
        b += s === sx ? button(c, x, y, u * 1.2, mix(color, '#ffffff', 0.35), 'sew') : P.line(`M${f(x - u * 0.7)} ${f(y)}h${f(u * 1.4)}`, shadowOf(bandC, 0.45), u * 0.5)
      }
      return b
    }
    body = piece(g, panel, color, { inner: torsoInner(panel, 1) + (art === 'jacket' ? zipperEdge(g, gap, hem, color) : facing(1)) + openEdge(g, gap, hem, color, 1) }) + piece(g, left, color, { inner: torsoInner(left, -1) + (art === 'jacket' ? zipperEdge(g, -gap, hem, color) : facing(-1)) + openEdge(g, gap, hem, color, -1) })
  } else {
    const d = topShape(c, m, { ...o, neck: 'collar' })
    let inner = torsoInner(d, 1)
    if (front) {
      if (art === 'jacket' || art === 'puffer') inner += zipper(c, 0, -T + T * 0.05, hem, u * 1.1, color, '#c9ccd3', art === 'jacket')
      else if (art !== 'leather' && art !== 'varsity' && art !== 'trench' && art !== 'denim') inner += seamLine(c, `M0 ${f(-T + T * 0.05)}V${f(hem)}`, color, u * 1.4, 0.8)
      if (art === 'denim') inner += placket(g, -T * 0.7, hem - T * 0.12, 5, color, '#b87333', 'metal')
      if (art === 'varsity') for (let i = 0; i < 5; i++) inner += button(c, 0, lerp(-T * 0.82, hem - T * 0.12, i / 4), u * 1.5, color2, 'snap')
      if (art === 'trench') for (const k of [-1, 1]) for (let i = 0; i < 3; i++) inner += button(c, k * m.chestHalf * 0.32, lerp(-T * 0.62, -T * 0.1, i / 2), u * 1.6, shadowOf(color, 0.4), 'sew')
      if (art === 'blazer') for (let i = 0; i < 2; i++) inner += button(c, u * 0.5, -T * (0.34 - i * 0.18), u * 1.6, shadowOf(color, 0.35), 'sew')
      if (art === 'cardigan') for (let i = 0; i < 5; i++) inner += button(c, 0, lerp(-T * 0.7, hem - T * 0.08, i / 4), u * 1.3, color2, 'sew')
    } else if (c.view === 'back') {
      if (art === 'denim') inner += seamLine(c, `M${f(-m.chestHalf * 2)} ${f(-T * 0.8)}Q0 ${f(-T * 0.72)} ${f(m.chestHalf * 2)} ${f(-T * 0.8)}`, color, u, 0.6) + stitch(c, `M${f(-m.chestHalf * 2)} ${f(-T * 0.8 + u * 1.4)}Q0 ${f(-T * 0.72 + u * 1.4)} ${f(m.chestHalf * 2)} ${f(-T * 0.8 + u * 1.4)}`, color2, u, 0.9)
      if (art === 'trench' || art === 'blazer') inner += seamLine(c, `M0 ${f(-T * 0.95)}V${f(hem)}`, color, u, 0.6) + (art === 'trench' ? creases(c, [{ pts: [[-m.chestHalf * 0.2, -T * 0.2], [-m.chestHalf * 0.3, m.pelvisH], [-m.chestHalf * 0.4, hem - T * 0.05]], w: u * 1.4 }], color) : '')
    }
    body = piece(g, d, color, { inner })
  }
  out.add('spine', Z.outer, art, body)
  g.layers.outer = { hem, off, flare: o.flare ?? 0, color, open: open && front, gap }

  // Collars, lapels, bands and belts sit on top.
  let det = ''
  if (front) {
    const breakY = open ? -T * 0.3 : -T * 0.36
    if (art === 'blazer' || art === 'trench' || art === 'labcoat' || (art === 'leather' && open)) {
      const kind = art === 'leather' ? 'wide' : 'notch'
      for (const s of [-1, 1]) {
        const d = lapel(g, s, kind, breakY, open ? gap : m.neckR * 0.2)
        const lc = art === 'leather' ? color : shadowOf(color, 0.04)
        const li = (art === 'leather' ? glossBands(g, [[[s * m.neckR * 1.3, -T * 0.95], [s * m.neckR * 1.4, -T * 0.6]]], m.neckR * 0.25, lc) : '') + (fine(c) && art !== 'labcoat' ? stitch(c, smooth([[s * m.neckR * 1.9, -T + T * 0.08], [s * m.neckR * 1.5, -T + T * 0.38], [s * (open ? gap : m.neckR * 0.2) * 1.1, breakY - T * 0.04]], false), shadowOf(lc, 0.3), u, 0.5) : '')
        det += dropShadow(g, d, color, 1.2, 0.38) + P.shape(d, lc, { shade: 0.45, material: art === 'leather' ? 'leather' : 'cloth', inner: li || undefined })
        if (art === 'leather' && fine(c)) det += button(c, s * m.neckR * 1.95, -T + T * 0.12, u * 1.1, '#c9ccd3', 'snap')
      }
    } else if (art === 'denim' || art === 'jacket' || art === 'puffer' || art === 'varsity' || (art === 'leather' && !open)) {
      // Stand collar (zip, puffer, varsity rib) or a point collar (denim).
      if (art === 'denim' || (art === 'leather' && !open)) collar({ ...g, fab: art === 'denim' ? 'denim' : 'leather' }, open ? 'open' : 'point', art === 'leather' ? color : shadowOf(color, 0.05), color)
      else {
        const nr = m.neckR
        const h = art === 'puffer' ? m.neckLen * 0.55 : m.neckLen * 0.35
        // Open, the collar splits into two halves either side of the opening.
        const half = (k: number) => smooth([[k * nr * 1.35, -T + 2], [k * nr * 1.22, -T - h], [k * gap * 1.02, -T - h * 0.95, 0], [k * gap * 0.95, -T + T * 0.06, 0]])
        const band = open ? half(-1) + half(1) : smooth([[-nr * 1.35, -T + 2], [-nr * 1.22, -T - h], [nr * 1.22, -T - h], [nr * 1.35, -T + 2], [0, -T + T * 0.06]])
        const bc = art === 'varsity' ? color2 : color
        let bi = rich(c) && art === 'varsity' ? texture(band, ribPaint(c, bc, u * 1.1)) : ''
        if (art === 'varsity' && P.detail > 0) bi += P.line(`M${f(-nr * 2)} ${f(-T - h * 0.35)}H${f(nr * 2)}`, color, u * 1.2)
        if (art === 'puffer') bi += quilting(g, -nr * 2, nr * 2, [-T - h, -T - h * 0.45, -T + 4], bc)
        det += P.shape(band, bc, { shade: 0.5, material: 'cloth', inner: bi || undefined })
      }
    }
    if (art === 'trench' && (p.b('belt') || false)) {
      const y = -T * 0.2
      const hx = bodyHalfAt(m, y) + off
      const band = roundRect(-hx, y - T * 0.035, hx * 2, T * 0.07, 2)
      det += dropShadow(g, band, color) + beltBand({ ...g, fab: 'twill' }, band, color2, sx * m.chestHalf * 0.25, y, T * 0.085)
    }
  }
  if (c.view !== 'side' && (art === 'varsity' || art === 'jacket' || art === 'puffer' || art === 'cardigan')) {
    {
      // Ribbed hem band (varsity stripes; elastic hem on zip jackets, puffers and cardigans).
      const hx = bodyHalfAt(m, hem) + off
      const bh = T * (art === 'puffer' ? 0.05 : 0.07)
      const band = open && front ? roundRect(-hx, hem - bh, hx - gap, bh, 2) + roundRect(gap, hem - bh, hx - gap, bh, 2) : roundRect(-hx, hem - bh, hx * 2, bh, 2)
      const bc = art === 'varsity' ? color2 : art === 'cardigan' ? color : shadowOf(color, 0.15)
      let bi = rich(c) ? texture(band, ribPaint(c, bc, u * 1.1)) : ''
      if (art === 'varsity' && P.detail > 0) bi += P.line(`M${f(-hx * 2)} ${f(hem - bh * 0.5)}H${f(hx * 2)}`, color, u * 1.2)
      det += P.shape(band, bc, { shade: 0.45, material: 'cloth', inner: bi || undefined })
    }
  }
  if (c.view === 'side' && art === 'trench' && p.b('belt')) {
    const y = -T * 0.2
    const band = roundRect(-m.chestDepth * 0.62 - off, y - T * 0.035, m.chestDepth * 0.62 + m.bellyDepth + off * 2, T * 0.07, 2)
    det += dropShadow(g, band, color) + P.shape(band, color2, { material: 'cloth' })
  } else if (c.view === 'back' && art === 'trench' && p.b('belt')) {
    const y = -T * 0.2
    const hx = bodyHalfAt(m, y) + off
    const band = roundRect(-hx, y - T * 0.035, hx * 2, T * 0.07, 2)
    det += dropShadow(g, band, color) + P.shape(band, color2, { material: 'cloth' })
  }
  if (det) out.add('spine', Z.outer + 1, `${art}-details`, det)
  if (art === 'trench' && c.view !== 'side') for (const s of ['L', 'R'] as const) out.add(`upperArm${s}`, limbZ(c, s, Z.outerSleeve + 0.5, true), `${art}-epaulette-${s}`, P.shape(roundRect(-m.armR * 0.5, -m.armR * 0.35, m.armR, m.armR * 0.55, m.armR * 0.15), color, { shade: 0.4, outline: 0.7, material: 'cloth' }) + button(c, 0, -m.armR * 0.12, u * 1.1, shadowOf(color, 0.4), 'sew'))

  const puffy = art === 'puffer'
  const leatherSleeves = art === 'varsity'
  addSleeves(leatherSleeves ? { ...g, fab: 'leather' } : g, {
    len: 1.9,
    off,
    color: leatherSleeves ? color2 : color,
    z,
    flare: puffy ? m.wristR * 0.2 : 0,
    cuff: art === 'varsity' ? color : art === 'jacket' ? shadowOf(color, 0.15) : art === 'puffer' || art === 'cardigan' ? shadowOf(color, 0.1) : art === 'trench' || art === 'labcoat' || art === 'denim' ? color : undefined,
    cuffKind: art === 'varsity' || art === 'jacket' || art === 'cardigan' ? 'rib' : art === 'puffer' ? 'rib' : art === 'trench' ? 'band' : art === 'denim' || art === 'labcoat' ? 'shirt' : 'hem',
    patterned: leatherSleeves ? false : undefined,
    upperInner: (_s, end, r) => (puffy ? quilting(g, -r * 2, r * 2, quiltYs(-m.armR * 0.4, end, 3), color) : '') + (leatherSleeves || art === 'leather' ? glossBands({ ...g, fab: 'leather' }, [[[-r * 0.4, end * 0.1], [-r * 0.35, end * 0.85]]], r * 0.3, leatherSleeves ? color2 : color) : ''),
    lowerInner: (_s, end, r) => (puffy ? quilting(g, -r * 2, r * 2, quiltYs(-m.elbowR * 0.35, end, 3), color) : '') + (leatherSleeves || art === 'leather' ? glossBands({ ...g, fab: 'leather' }, [[[-r * 0.4, m.elbowR * 0.4], [-r * 0.35, end * 0.85]]], r * 0.3, leatherSleeves ? color2 : color) : '') + (art === 'blazer' && fine(c) && c.view !== 'back' ? [0, 1, 2].map((i) => button(c, innerSign(c, _s) * -r * 0.55, end - m.wristR * (0.4 + i * 0.4), u * 0.9, shadowOf(color, 0.4), 'sew')).join('') : ''),
  })
}

/** Zip tape and teeth down one opening edge of an open zip jacket (inner content). */
function zipperEdge(g: G, x: number, hem: number, color: string): string {
  const { c, m, u } = g
  if (c.paint.detail === 0) return ''
  const T = m.torsoLen
  const s = Math.sign(x)
  const xx = x - s * u * 0.9
  return c.paint.line(`M${f(xx)} ${f(-T * 0.3)}L${f(xx)} ${f(hem)}`, shadowOf(color, 0.3), u * 1.8, { opacity: 0.7 }) + (fine(c) ? c.paint.line(`M${f(x - s * u * 0.2)} ${f(-T * 0.3)}L${f(x - s * u * 0.2)} ${f(hem)}`, '#c9ccd3', u * 0.8, { dash: `${f(u * 0.4)} ${f(u * 0.4)}`, cap: 'butt' }) : '')
}

/** The open edge of a jacket panel curls toward the viewer: a lit rim (inner content). */
function openEdge(g: G, gap: number, hem: number, color: string, s: number): string {
  const { c, m, u } = g
  if (!rich(c) || !tonal(c)) return ''
  const T = m.torsoLen
  return c.paint.flat(brush([[s * gap * 1.02, -T * 0.28], [s * gap * 1.04, (hem - T * 0.3) / 2], [s * gap * 1.02, hem]], u * 1.2, u * 1.2, u * 0.6), highlightOf(color, 0.2), 0.45)
}

/* ---- Shoes and socks -------------------------------------------------------------- */

/** Key heights of a shoe profile in foot-bone space (ankle at 0,0; ground at `gy`). */
function shoeFrame(m: HumanMeasure, grow: number, toe: number, low: number) {
  const a = m.ankleR
  const gy = m.footH + a * 0.15
  const L = m.footLen * toe
  const collarY = -a * 0.85 + low * (gy + a * 0.2)
  const instepY = gy - a * 1.9 + low * a * 0.8
  return { a, gy, L, collarY, instepY, g: grow }
}

/** The upper of a shoe: heel counter, collar, instep and toe box, for the current view. */
function shoeUpper(m: HumanMeasure, view: string, grow: number, toe = 1, low = 0, pointed = 0): string {
  const { a, gy, L, collarY, instepY, g } = shoeFrame(m, grow, toe, low)
  if (view === 'side') {
    return smooth([
      [-L * 0.24 - g, collarY + a * 0.05],
      [a * 0.2, collarY - a * 0.05],
      [a * 0.85 + g * 0.5, collarY + a * 0.12],
      [L * 0.38, instepY - g],
      [L * 0.64, gy - a * (1.15 - pointed * 0.35) - g * 0.8],
      [L * (0.8 + pointed * 0.1) + g, gy - a * (0.5 - pointed * 0.3), 0.8 - pointed * 0.8],
      [L * 0.78 + g, gy, 0.5],
      [-L * 0.24 - g, gy, 0.5],
      [-L * 0.3 - g, gy - a * 0.55],
    ])
  }
  const w = a * 1.25 + g
  const top = -a * 0.65 + low * (gy * 0.55 + a * 0.6)
  if (view === 'back') return smooth([[-w * 0.78, top], [w * 0.78, top], [w * 1.05, gy * 0.5], [w * 0.98, gy, 0.6], [-w * 0.98, gy, 0.6], [-w * 1.05, gy * 0.5]])
  // Front: the toe box widens toward the ground (a pointed toe narrows to a tip).
  const tw = 1.22 - pointed * 0.25
  return smooth([[-w * 0.78, top], [w * 0.78, top], [w * 1.1, gy * 0.35 + low * a * 0.2], [w * tw, gy - a * 0.3], [w * (1.08 - pointed * 0.5), gy, 0.6], [-w * (1.08 - pointed * 0.5), gy, 0.6], [-w * tw, gy - a * 0.3], [-w * 1.1, gy * 0.35 + low * a * 0.2]])
}

/** A sole: midsole with toe spring (side) or a band (front/back); `h` is its height. */
function shoeSole(m: HumanMeasure, view: string, grow: number, h: number, toe = 1): string {
  const { a, gy, L, g } = shoeFrame(m, grow, toe, 0)
  if (view === 'side') return smooth([[-L * 0.32 - g, gy - h * 0.7, 0.5], [L * 0.72, gy - h * 0.7], [L * 0.86 + g, gy - h * 1.2, 0.7], [L * 0.84 + g, gy - h * 0.2, 0.6], [L * 0.72, gy + h * 0.3], [-L * 0.26, gy + h * 0.3, 0.6], [-L * 0.33 - g, gy - h * 0.1, 0.6]])
  const w = (a * 1.25 + g) * 1.14
  return roundRect(-w, gy - h * 0.7, w * 2, h, h * 0.4)
}

/** Criss-cross laces over a tongue: front view between y0 and y1, side view along the instep. */
function laces(g: G, view: string, y0: number, y1: number, halfW: number, n: number, lace: string, tongue: string, grow = 0): string {
  const { c, m, u } = g
  const P = c.paint
  if (P.detail === 0 || view === 'back') return ''
  let s = ''
  if (view === 'side') {
    const { a, collarY, instepY, L } = shoeFrame(m, grow, 1, 0)
    const e0: P = [a * 0.72, collarY + a * 0.3]
    const e1: P = [L * 0.46, instepY + a * 0.55]
    const dx = e1[0] - e0[0]
    const dy = e1[1] - e0[1]
    const len = Math.hypot(dx, dy)
    const nx = -dy / len
    const ny = dx / len
    // The tongue shows above the collar and under the laces.
    s += P.shape(brush([[e0[0] - a * 0.1, collarY - a * 0.3], [e0[0] + dx * 0.4, e0[1] + dy * 0.4], e1], a * 0.55, a * 0.35), tongue, { shade: 0.4, outline: 0.6, material: 'cloth' })
    let d = ''
    let eyelets = ''
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = e0[0] + dx * t
      const y = e0[1] + dy * t
      eyelets += circle(x - nx * a * 0.28, y - ny * a * 0.28, u * 0.55)
      if (i < n) {
        const x2 = e0[0] + dx * ((i + 1) / n)
        const y2 = e0[1] + dy * ((i + 1) / n)
        d += `M${f(x - nx * a * 0.28)} ${f(y - ny * a * 0.28)}L${f(x2 + nx * a * 0.2)} ${f(y2 + ny * a * 0.2)}`
      }
    }
    return s + (P.detail > 1 ? P.flat(eyelets, '#c9ccd3') : '') + (P.lw > 0 ? P.line(d, P.ink(lace), u * 0.95 + P.lw * 0.3) : '') + P.line(d, lace, u * 0.85)
  }
  s += P.shape(roundRect(-halfW * 0.85, y0 - halfW * 0.5, halfW * 1.7, y1 - y0 + halfW * 0.6, halfW * 0.4), tongue, { shade: 0.4, outline: 0.6, material: 'cloth' })
  // Criss-cross between eyelet rows, and a bar across the top row.
  const rows = Math.max(2, n + 1)
  const ys = Array.from({ length: rows }, (_, i) => lerp(y0, y1, i / (rows - 1)))
  let d = `M${f(-halfW)} ${f(ys[0])}L${f(halfW)} ${f(ys[0])}`
  for (let i = 0; i < rows - 1; i++) d += `M${f(-halfW)} ${f(ys[i])}L${f(halfW)} ${f(ys[i + 1])}M${f(halfW)} ${f(ys[i])}L${f(-halfW)} ${f(ys[i + 1])}`
  let eyelets = ''
  for (const y of ys) eyelets += circle(-halfW * 1.08, y, u * 0.6) + circle(halfW * 1.08, y, u * 0.6)
  return s + (P.detail > 1 ? P.flat(eyelets, '#c9ccd3') : '') + (P.lw > 0 ? P.line(d, P.ink(lace), u * 0.95 + P.lw * 0.3) : '') + P.line(d, lace, u * 0.85)
}

function drawShoes(g: G): void {
  const { c, out, m, p, art, u } = g
  const P = c.paint
  const color = col(g)
  const color2 = p.c('color2', shadowOf(color, 0.3))
  const view = c.view
  const side = view === 'side'
  const front = view === 'front'
  const a = m.ankleR
  const gy = m.footH + a * 0.15
  const grow = a * 0.22
  const w = a * 1.25 + grow
  const baked = rich(c)
  const L = m.footLen
  const fr = shoeFrame(m, grow, 1, 0)
  // The horizontal extent of soles (inner detail stays within the piece: part bounds are measured from it).
  const sx0 = side ? -L * 0.45 : -w * 1.45
  const sx1 = side ? L * 1.05 : w * 1.45
  for (const s of ['L', 'R'] as const) {
    const tint = isFar(c, s) ? shadowOf(color, 0.06) : color
    const ins = innerSign(c, s)
    const parts: string[] = []
    let shaft = 0
    let z: number = Z.shoe
    let shaftInner = ''
    let shaftFlare = 0
    let shaftMat: Material = 'leather'
    switch (art) {
      case 'sneakers':
      case 'hightops':
      case 'skates': {
        const canvas = art !== 'sneakers'
        const up = shoeUpper(m, view, grow)
        let inner = weave(g, up, tint)
        const stripe = art === 'hightops' ? '#f5f2eb' : color2
        if (P.detail > 0) {
          if (side) {
            if (art === 'sneakers') {
              // The side stripe sweeps up from the heel; a heel tab and a toe cap.
              inner += P.line(`M${f(-L * 0.16)} ${f(gy - a * 0.35)}Q${f(L * 0.18)} ${f(gy - a * 1.5)} ${f(L * 0.52)} ${f(gy - a * 0.5)}`, stripe, a * 0.26)
              inner += P.flat(roundRect(-L * 0.33, fr.collarY - a * 0.1, L * 0.14, a * 1.2, a * 0.12), color2)
            } else {
              inner += P.line(`M${f(-L * 0.3)} ${f(gy - a * 0.62)}H${f(L * 0.9)}`, color2, a * 0.14)
              inner += P.flat(ellipse(L * 0.72, gy - a * 0.3, L * 0.16, a * 0.6), '#f5f2eb') + seamLine(c, `M${f(L * 0.56)} ${f(gy - a * 0.95)}Q${f(L * 0.6)} ${f(gy - a * 0.3)} ${f(L * 0.6)} ${f(gy)}`, '#f5f2eb', u, 0.7)
            }
            inner += seamLine(c, `M${f(L * 0.52)} ${f(gy - a * 1.25)}Q${f(L * 0.58)} ${f(gy - a * 0.6)} ${f(L * 0.56)} ${f(gy)}`, tint, u, 0.45)
            if (baked && !canvas) inner += P.flat([0, 1, 2, 3].map((i) => circle(L * (0.62 + (i % 2) * 0.05), gy - a * (0.95 - Math.floor(i / 2) * 0.25), u * 0.32)).join(''), shadowOf(tint, 0.3), 0.7)
          } else if (front) {
            if (art === 'sneakers') inner += P.line(`M${f(-w * 1.25)} ${f(gy - a * 0.3)}Q${f(-w * 0.8)} ${f(gy - a * 1.1)} ${f(-w * 0.4)} ${f(gy - a * 0.55)}M${f(w * 1.25)} ${f(gy - a * 0.3)}Q${f(w * 0.8)} ${f(gy - a * 1.1)} ${f(w * 0.4)} ${f(gy - a * 0.55)}`, stripe, a * 0.2)
            // Toe cap: a rubber bumper on canvas shoes, a stitched overlay on leather ones.
            const cap = smooth([[-w * 0.95, gy - a * 0.05], [-w * 0.7, gy - a * 0.62], [w * 0.7, gy - a * 0.62], [w * 0.95, gy - a * 0.05]], false)
            inner += canvas ? P.flat(`${cap}Z`, '#f5f2eb') : seamLine(c, cap, tint, u, 0.5) + stitch(c, smooth([[-w * 0.85, gy - a * 0.05], [-w * 0.62, gy - a * 0.5], [w * 0.62, gy - a * 0.5], [w * 0.85, gy - a * 0.05]], false), shadowOf(tint, 0.3), u, 0.6)
          } else {
            inner += P.flat(roundRect(-w * 0.22, fr.collarY - a * 0.1, w * 0.44, a * 1.1, a * 0.12), color2)
            inner += seamLine(c, `M${f(-w * 1.2)} ${f(gy * 0.25)}Q0 ${f(gy * 0.45)} ${f(w * 1.2)} ${f(gy * 0.25)}`, tint, u, 0.5)
          }
          inner += creases(c, side ? [{ pts: [[L * 0.3, gy - a * 1.4], [L * 0.4, gy - a * 1.05], [L * 0.5, gy - a * 1.1]], w: u * 1.1 }] : [{ pts: [[-w * 0.5, gy - a * 0.75], [0, gy - a * 0.62], [w * 0.5, gy - a * 0.75]], w: u }], tint)
        }
        parts.push(piece(g, up, tint, { inner }))
        parts.push(laces(g, view, fr.collarY + a * 0.4, gy * 0.35, w * 0.38, 3, '#f5f2eb', side ? shadowOf(tint, 0.05) : highlightOf(tint, 0.05), grow))
        const soleC = p.c('sole', '#f5f2eb')
        const sh = a * 0.55
        const sole = shoeSole(m, view, grow, sh)
        let sInner = ''
        if (P.detail > 0) {
          const oc = art === 'hightops' ? '#3a3a44' : shadowOf(soleC, 0.35)
          sInner += P.flat(rect(sx0, gy + sh * 0.02, sx1 - sx0, sh), oc)
          if (art === 'hightops') sInner += P.line(`M${f(sx0)} ${f(gy - sh * 0.3)}H${f(sx1)}`, color2, u * 1.1)
          if (baked) sInner += stitch(c, `M${f(sx0)} ${f(gy - sh * 0.45)}H${f(sx1)}`, shadowOf(soleC, 0.3), u, 0.5)
          if (baked && side) sInner += P.line(`M${f(-L * 0.3)} ${f(gy + sh * 0.2)}H${f(L * 0.8)}`, shadowOf(oc, 0.3), sh * 0.2, { dash: `${f(u * 0.7)} ${f(u * 1.0)}`, cap: 'butt' })
        }
        parts.push(P.shape(sole, soleC, { shade: 0.4, material: 'rubber', inner: sInner || undefined }))
        if (art === 'hightops' || art === 'skates') {
          shaft = 0.22
          shaftMat = 'cloth'
          const patchX = side ? 0 : ins * a * 0.6
          if (P.detail > 0 && view !== 'back') shaftInner += P.shape(circle(patchX, m.shin * 0.87, a * 0.36), '#f5f2eb', { shade: 0.4, outline: 0.5 }) + P.flat(star(patchX, m.shin * 0.87, a * 0.22, a * 0.09), color2)
          if (front) shaftInner += laces(g, 'front', m.shin * 0.8, m.shin + a * 0.2, a * 0.42, 2, '#f5f2eb', highlightOf(tint, 0.05))
        }
        if (art === 'skates') {
          const wheel = (x: number) => P.shape(circle(x, gy + a * 0.7, a * 0.45), color2, { material: 'plastic', gloss: true }) + P.shape(circle(x, gy + a * 0.7, a * 0.17), '#c9ccd3', { material: 'metal', outline: 0.5, shade: 0.4 })
          const plate = side ? roundRect(-L * 0.2, gy + sh * 0.25, L * 0.95, a * 0.24, a * 0.08) : roundRect(-w * 1.05, gy + sh * 0.25, w * 2.1, a * 0.24, a * 0.08)
          parts.push(P.shape(plate, '#9aa1ab', { material: 'metal', outline: 0.7 }))
          parts.push(side ? wheel(-L * 0.05) + wheel(L * 0.55) + P.shape(roundRect(L * 0.78, gy - a * 0.1, a * 0.55, a * 0.6, a * 0.22), '#ec407a', { material: 'rubber' }) : wheel(-a * 0.85) + wheel(a * 0.85))
        }
        break
      }
      case 'boots':
      case 'combat':
      case 'kneeboots':
      case 'cowboy':
      case 'rainboots':
      case 'greaves': {
        shaft = art === 'kneeboots' || art === 'greaves' ? 0.85 : art === 'cowboy' ? 0.45 : art === 'rainboots' ? 0.55 : 0.35
        z = Z.boot
        const toe = art === 'cowboy' ? 1.1 : 1
        const g13 = grow * 1.3
        const up = shoeUpper(m, view, g13, toe, 0, art === 'cowboy' ? 1 : 0)
        const mat: Material = art === 'rainboots' ? 'rubber' : art === 'greaves' ? 'metal' : 'leather'
        shaftMat = mat
        const bf = shoeFrame(m, g13, toe, 0)
        let inner = weave(g, up, tint)
        if (P.detail > 0) {
          if (art === 'combat') inner += side ? seamLine(c, `M${f(L * 0.5)} ${f(gy - a * 1.3)}Q${f(L * 0.58)} ${f(gy - a * 0.5)} ${f(L * 0.55)} ${f(gy)}`, tint, u * 1.2, 0.6) : seamLine(c, `M${f(-w * 1.1)} ${f(gy - a * 0.55)}Q0 ${f(gy - a * 1.05)} ${f(w * 1.1)} ${f(gy - a * 0.55)}`, tint, u * 1.2, 0.6)
          if (art === 'greaves') inner += P.line(side ? `M${f(L * 0.15)} ${f(bf.instepY)}L${f(L * 0.3)} ${f(gy)}M${f(L * 0.4)} ${f(bf.instepY + a * 0.3)}L${f(L * 0.52)} ${f(gy)}M${f(L * 0.62)} ${f(gy - a * 1.1)}L${f(L * 0.7)} ${f(gy)}` : `M${f(-w * 1.3)} ${f(gy * 0.15)}H${f(w * 1.3)}M${f(-w * 1.3)} ${f(gy * 0.6)}H${f(w * 1.3)}`, shadowOf(tint, 0.45), u * 0.8)
          if (art === 'cowboy' && side) inner += stitch(c, `M${f(L * 0.3)} ${f(gy - a * 1.2)}Q${f(L * 0.55)} ${f(gy - a * 1.4)} ${f(L * 0.78)} ${f(gy - a * 0.4)}`, color2, u, 0.9)
          if (art === 'cowboy' && front) inner += stitch(c, `M${f(-w * 0.5)} ${f(gy * 0.25)}Q0 ${f(gy * 0.75)} ${f(w * 0.5)} ${f(gy * 0.25)}`, color2, u, 0.9)
          // The ankle flexes: creases across the vamp.
          inner += creases(c, side ? [{ pts: [[L * 0.2, bf.instepY - a * 0.2], [L * 0.3, bf.instepY + a * 0.3], [L * 0.42, bf.instepY + a * 0.2]], w: u * 1.1 }, { pts: [[L * 0.1, bf.instepY - a * 0.5], [L * 0.2, bf.instepY], [L * 0.3, bf.instepY - a * 0.1]], w: u * 0.9 }] : [{ pts: [[-w * 0.6, gy * 0.05], [0, gy * 0.22], [w * 0.6, gy * 0.05]], w: u * 1.1 }], tint)
          inner += glossBands({ ...g, fab: art === 'rainboots' ? 'rubber' : art === 'greaves' ? 'patent' : 'leather' }, side ? [[[L * 0.3, bf.instepY + a * 0.45], [L * 0.6, gy - a * 0.95]]] : [[[-w * 0.45, gy * 0.05], [-w * 0.6, gy * 0.7]]], a * 0.4, tint)
        }
        parts.push(P.shape(up, tint, { material: mat, inner: inner || undefined }))
        const soleC = art === 'cowboy' ? '#3e2723' : art === 'rainboots' ? shadowOf(tint, 0.35) : art === 'greaves' ? shadowOf(tint, 0.3) : p.c('color2', '#26252c')
        const sh = a * (art === 'combat' ? 0.7 : 0.48)
        const sole = shoeSole(m, view, g13, sh, toe)
        let sInner = ''
        if (fine(c) && art !== 'rainboots' && art !== 'greaves') sInner += stitch(c, `M${f(sx0)} ${f(gy - sh * 0.45)}H${f(sx1)}`, highlightOf(soleC, 0.35), u, 0.8)
        if (baked && (art === 'combat' || art === 'rainboots' || art === 'boots') && side) sInner += P.line(`M${f(-L * 0.3)} ${f(gy + sh * 0.22)}H${f(L * 0.85)}`, shadowOf(soleC, 0.45), sh * 0.3, { dash: `${f(u * 1.2)} ${f(u * 1.1)}`, cap: 'butt' })
        parts.push(P.shape(sole, soleC, { shade: 0.35, material: art === 'greaves' ? 'metal' : 'rubber', inner: sInner || undefined }))
        if ((art === 'cowboy' || art === 'kneeboots' || art === 'boots') && side) {
          const heel = art === 'cowboy' ? poly([[-L * 0.28, gy], [-L * 0.08, gy], [-L * 0.11, gy + a * 0.6], [-L * 0.22, gy + a * 0.6]]) : roundRect(-L * 0.3, gy, L * 0.24, a * 0.45, a * 0.08)
          parts.push(P.shape(heel, soleC, { shade: 0.5, material: 'leather' }))
        }
        if (art === 'combat' || art === 'boots') {
          const top = m.shin * (1 - shaft)
          if (front) shaftInner += laces(g, 'front', top + a * 0.5, m.shin + a * 0.3, a * 0.44, art === 'combat' ? 5 : 3, art === 'combat' ? '#26252c' : '#e8d5b0', shadowOf(tint, 0.05))
          if (side && P.detail > 1) {
            let hooks = ''
            const k = art === 'combat' ? 5 : 3
            for (let i = 0; i < k; i++) hooks += circle(a * 0.66, lerp(top + a * 0.35, m.shin - a * 0.1, i / (k - 1)), u * 0.65)
            shaftInner += P.flat(hooks, '#c9ccd3') + P.line(`M${f(a * 0.66)} ${f(top + a * 0.35)}V${f(m.shin)}`, shadowOf(tint, 0.3), u * 0.6, { opacity: 0.8 })
          }
        }
        if (art === 'kneeboots' && side && fine(c)) shaftInner += zipper(c, -a * 0.25, m.shin * 0.2, m.shin, u * 0.7, tint, '#c9ccd3', false)
        if (art === 'cowboy') {
          shaftFlare = a * 0.25
          if (P.detail > 0) shaftInner += stitch(c, `M${f(-a * 0.75)} ${f(m.shin * 0.62)}q${f(a * 0.75)} ${f(m.shin * 0.12)} ${f(a * 1.5)} 0M${f(-a * 0.65)} ${f(m.shin * 0.72)}q${f(a * 0.65)} ${f(m.shin * 0.1)} ${f(a * 1.3)} 0M0 ${f(m.shin * 0.58)}V${f(m.shin * 0.82)}`, color2, u * 1.1, 0.95)
        }
        if (art === 'greaves') {
          shaftInner += plateLines({ ...g, fab: 'metal' }, m.shin, a * 1.3, tint)
          if (view !== 'back') shaftInner += P.line(`M0 ${f(m.shin * 0.2)}V${f(m.shin)}`, highlightOf(tint, 0.4), u * 0.9, { opacity: 0.8 })
        }
        if (art !== 'greaves') shaftInner += glossBands({ ...g, fab: art === 'rainboots' ? 'rubber' : 'leather' }, [[[-a * 0.5, m.shin * (1 - shaft) + a * 1.2], [-a * 0.55, m.shin - a * 0.4]]], a * 0.55, tint)
        break
      }
      case 'sandals': {
        const soleC = '#a1887f'
        const sole = side ? smooth([[-L * 0.26, gy - a * 0.15], [L * 0.76, gy - a * 0.15], [L * 0.8, gy + a * 0.08], [-L * 0.26, gy + a * 0.12]]) : roundRect(-a * 1.35, gy - a * 0.12, a * 2.7, a * 0.28, 2)
        parts.push(P.shape(sole, soleC, { shade: 0.4, material: 'leather' }))
        const strapW = a * 0.3
        const strap = side
          ? `M${f(L * 0.3)} ${f(gy - a * 0.7)}Q${f(L * 0.42)} ${f(gy - a * 0.25)} ${f(L * 0.44)} ${f(gy - a * 0.08)}M${f(-a * 0.65)} ${f(-a * 0.1)}Q0 ${f(a * 0.38)} ${f(a * 0.65)} ${f(-a * 0.1)}M${f(-L * 0.2)} ${f(gy - a * 0.1)}Q${f(-L * 0.14)} ${f(-a * 0.2)} ${f(-a * 0.55)} ${f(0)}`
          : `M${f(-a * 1.12)} ${f(gy - a * 0.35)}Q0 ${f(gy - a * 1.0)} ${f(a * 1.12)} ${f(gy - a * 0.35)}M${f(-a * 0.95)} ${f(-a * 0.05)}Q0 ${f(a * 0.3)} ${f(a * 0.95)} ${f(-a * 0.05)}`
        parts.push((P.lw > 0 ? P.line(strap, P.ink(tint), strapW + P.lw) : '') + P.line(strap, tint, strapW) + (baked ? P.line(strap, highlightOf(tint, 0.25), strapW * 0.3, { opacity: 0.5 }) : ''))
        if (P.detail > 1) parts.push(P.shape(roundRect(side ? a * 0.4 : ins * a * 0.78 - a * 0.13, side ? -a * 0.02 : a * 0.02, a * 0.26, a * 0.24, a * 0.05), '#c79212', { material: 'metal', outline: 0.5, shade: 0.4 }))
        break
      }
      case 'heels':
      case 'flats':
      case 'loafers':
      case 'slippers': {
        if (art === 'slippers') {
          parts.push(bunnySlipper(g, tint, w))
          break
        }
        const low = art === 'loafers' ? 0.3 : 0.6
        const pointed = art === 'heels' ? 1 : art === 'flats' ? 0.3 : 0
        const up = shoeUpper(m, view, grow * 0.6, art === 'heels' ? 1.05 : 1, low, pointed)
        const hf = shoeFrame(m, grow * 0.6, 1, low)
        const mat: Material = art === 'heels' ? 'plastic' : 'leather'
        let inner = weave(g, up, tint)
        if (P.detail > 0) {
          if (art === 'loafers') {
            // Moc-toe seam and the penny strap across the vamp.
            inner += side ? stitch(c, `M${f(L * 0.3)} ${f(hf.instepY + a * 0.3)}Q${f(L * 0.64)} ${f(hf.instepY + a * 0.1)} ${f(L * 0.74)} ${f(gy - a * 0.3)}`, shadowOf(tint, 0.4), u, 0.9) : stitch(c, `M${f(-w * 0.7)} ${f(gy * 0.2)}Q0 ${f(gy * 0.8)} ${f(w * 0.7)} ${f(gy * 0.2)}`, shadowOf(tint, 0.4), u, 0.9)
            const strap = side ? `M${f(L * 0.08)} ${f(hf.collarY + a * 0.35)}L${f(L * 0.46)} ${f(hf.instepY + a * 0.4)}` : `M${f(-w * 0.95)} ${f(hf.collarY + a * 0.45)}H${f(w * 0.95)}`
            inner += P.line(strap, shadowOf(tint, 0.15), a * 0.34) + P.line(strap, shadowOf(tint, 0.45), a * 0.1)
          }
          inner += glossBands({ ...g, fab: art === 'heels' ? 'patent' : 'leather' }, side ? [[[L * 0.2, gy - a * 0.7], [L * 0.62, gy - a * 0.5]]] : [[[-w * 0.35, gy * 0.4], [-w * 0.55, gy - a * 0.3]]], a * 0.3, tint)
        }
        parts.push(P.shape(up, tint, { material: mat, inner: inner || undefined }))
        if (art === 'loafers' || art === 'flats') parts.push(P.shape(shoeSole(m, view, grow * 0.6, a * (art === 'loafers' ? 0.36 : 0.2)), shadowOf(tint, 0.35), { shade: 0.3, material: 'leather' }))
        if (art === 'heels' && side) {
          // A slim stiletto under the heel.
          const heel = smooth([[-L * 0.26, gy - a * 0.3], [-L * 0.08, gy - a * 0.3], [-L * 0.13, gy + a * 0.12], [-L * 0.17, gy + a * 0.6, 0], [-L * 0.2, gy + a * 0.6, 0], [-L * 0.22, gy + a * 0.08]])
          parts.push(P.shape(heel, shadowOf(color, 0.25), { material: 'plastic' }))
        }
        if (art === 'heels' && view === 'back') parts.push(P.shape(smooth([[-a * 0.25, gy - a * 0.2], [a * 0.25, gy - a * 0.2], [a * 0.1, gy + a * 0.6, 0], [-a * 0.1, gy + a * 0.6, 0]]), shadowOf(color, 0.25), { material: 'plastic' }))
        if (art === 'loafers' && side) parts.push(P.shape(roundRect(-L * 0.28, gy, L * 0.2, a * 0.34, a * 0.06), shadowOf(tint, 0.4), { shade: 0.4, material: 'leather' }))
        if (art === 'flats' && p.b('bow') && P.detail > 0) {
          const bx = side ? L * 0.46 : 0
          const by = side ? hf.instepY + a * 0.45 : hf.collarY + a * 0.55
          const bow = side ? ellipse(bx, by, a * 0.3, a * 0.2) : smooth([[bx - a * 0.55, by - a * 0.22], [bx, by], [bx - a * 0.55, by + a * 0.22]]) + smooth([[bx + a * 0.55, by - a * 0.22], [bx, by], [bx + a * 0.55, by + a * 0.22]])
          parts.push(P.shape(bow, shadowOf(color, 0.2), { material: 'cloth', shade: 0.5, outline: 0.7 }) + P.shape(circle(bx, by, a * 0.1), shadowOf(color, 0.3), { outline: 0.6, shade: false }))
        }
        break
      }
    }
    out.add(`foot${s}`, limbZ(c, s, z, false), `${art}-${s}`, parts.join(''))
    if (shaft > 0) {
      // The shaft sits behind the foot piece: the vamp seam reads where they meet.
      const top = m.shin * (1 - shaft)
      const r0 = lerp(m.kneeR, a, 1 - shaft) + grow + shaftFlare
      const d = brush([[0, top], [0, lerp(top, m.shin, 0.5)], [0, m.shin + a * 0.3]], r0 * 2, (a + grow * 1.2) * 2, 0, 'flat', 'flat')
      let inner = weave(g, d, color) + shaftInner
      if (P.detail > 0) {
        // The opening: a padded collar or a turned rim.
        const rimH = a * (art === 'rainboots' ? 0.5 : 0.32)
        const rimC = art === 'rainboots' ? shadowOf(tint, 0.2) : shadowOf(tint, art === 'hightops' || art === 'skates' ? 0.08 : 0.12)
        inner += P.flat(rect(-r0 * 2, top, r0 * 4, rimH), rimC) + seamLine(c, `M${f(-r0 * 2)} ${f(top + rimH)}H${f(r0 * 2)}`, tint, u, 0.6)
        inner += creases(c, [{ pts: [[-r0 * 0.8, m.shin - a * 0.5], [0, m.shin - a * 0.25], [r0 * 0.7, m.shin - a * 0.55]], w: u * 1.1 }], tint)
      }
      let svg = P.shape(d, tint, { material: shaftMat, inner: inner || undefined })
      if (art === 'cowboy' && P.detail > 0) svg += P.shape(roundRect(-r0 * 0.9, top - a * 0.5, a * 0.35, a * 0.7, a * 0.15) + roundRect(r0 * 0.9 - a * 0.35, top - a * 0.5, a * 0.35, a * 0.7, a * 0.15), shadowOf(tint, 0.1), { material: 'leather', shade: 0.4, outline: 0.7 })
      if (art === 'greaves' && view !== 'back') svg += `<g transform="translate(0 ${f(top + a * 0.2)})">${kneeCop({ ...g, fab: 'metal' }, r0 * 1.1, tint, '#c79212')}</g>`
      out.add(`shin${s}`, limbZ(c, s, z - 0.2, false), `${art}-shaft-${s}`, svg)
    }
  }
}

/** Fluffy bunny slippers: a scalloped fleece body, ears, eyes and a nose. */
function bunnySlipper(g: G, color: string, w: number): string {
  const { c, m, u } = g
  const P = c.paint
  const a = m.ankleR
  const gy = m.footH + a * 0.15
  const side = c.view === 'side'
  const L = m.footLen
  const body = side ? smooth([[-L * 0.28, gy - a * 0.2], [-L * 0.1, gy - a * 1.0], [L * 0.45, gy - a * 1.1], [L * 0.82, gy - a * 0.5], [L * 0.8, gy + a * 0.1, 0.5], [-L * 0.26, gy + a * 0.1, 0.5]]) : smooth([[-w * 1.15, gy * 0.2], [0, -a * 0.75], [w * 1.15, gy * 0.2], [w * 1.25, gy - a * 0.2], [w * 1.05, gy + a * 0.1, 0.6], [-w * 1.05, gy + a * 0.1, 0.6], [-w * 1.25, gy - a * 0.2]])
  const ex = side ? L * 0.35 : 0
  const ears = ellipse(ex - a * 0.45, gy - a * 1.65, a * 0.3, a * 0.8) + ellipse(ex + a * 0.45, gy - a * 1.65, a * 0.3, a * 0.8)
  let s = P.union([body, ears], color, { material: 'cloth' })
  s += P.flat(ellipse(ex - a * 0.45, gy - a * 1.6, a * 0.14, a * 0.55) + ellipse(ex + a * 0.45, gy - a * 1.6, a * 0.14, a * 0.55), '#f48fb1', 0.85)
  s += P.flat(circle(ex - a * 0.32, gy - a * 0.6, a * 0.1) + circle(ex + a * 0.32, gy - a * 0.6, a * 0.1), '#26252c')
  if (P.detail > 0) s += P.flat(ellipse(ex, gy - a * 0.38, a * 0.12, a * 0.08), '#f48fb1') + P.line(`M${f(ex - a * 0.2)} ${f(gy - a * 0.35)}h${f(-a * 0.45)}M${f(ex + a * 0.2)} ${f(gy - a * 0.35)}h${f(a * 0.45)}`, shadowOf(color, 0.35), u * 0.4, { opacity: 0.7 })
  if (rich(c)) s += P.flat(circle(ex - a * 0.28, gy - a * 0.64, a * 0.035) + circle(ex + a * 0.36, gy - a * 0.64, a * 0.035), '#ffffff')
  return s
}

function drawSocks(g: G): void {
  const { c, out, m, p, art, u } = g
  const P = c.paint
  const color = col(g)
  const color2 = p.c('color2', color)
  const a = m.ankleR
  for (const s of ['L', 'R'] as const) {
    const tint = isFar(c, s) ? shadowOf(color, 0.06) : color
    // The sock's foot (hidden by most shoes; it covers the toes when barefoot).
    if (!c.hides('feet')) out.add(`foot${s}`, limbZ(c, s, Z.sock, false), `${art}-foot-${s}`, P.shape(footShape(m, c.view, a * 0.08), tint, { material: 'cloth', offset: 0.12, inner: rich(c) ? texture(footShape(m, c.view, a * 0.08), knitPaint(c, tint, u * 1.3)) : undefined }))
    if (art === 'tights') {
      // Opaque pieces that suggest sheer knit (translucent pieces would double up where they
      // overlap at the knee): the skin reads through down the front and over the kneecap,
      // the edges stay dense where the knit turns away.
      const skin = c.sec('skin').c('tone', '#d69d78')
      const base = mix(tint, skin, 0.14)
      const up = legUpperFull(m, 0.5)
      const lo = legLower(m, 1, 0.5)
      const sheer = (len: number, knee: boolean) =>
        (P.detail > 0 ? P.flat(brush([[0, len * 0.04], [0, len * 0.5], [0, len * 0.96]], 0, 0, m.kneeR * 0.9), mix(tint, skin, 0.4), 0.45) : '') +
        (knee && P.detail > 0 ? `<g transform="translate(0 ${f(m.kneeR * 0.05)}) scale(${f(m.kneeR * 0.75)} ${f(m.kneeR * 0.7)})">${P.glow(0, 0, 1, mix(tint, skin, 0.55), 0.6)}</g>` : '') +
        (rich(c) ? sheen(c, [[-m.kneeR * 0.3, len * 0.1], [-m.kneeR * 0.25, len * 0.9]], m.kneeR * 0.45, tint, 0.5, false) : '')
      out.add(`thigh${s}`, limbZ(c, s, Z.sock, false), `tights-u-${s}`, limbShape(c, up, base, { outline: 0.6, material: 'cloth', spec: 0.2, inner: sheer(m.thigh, false) || undefined, shadeFrom: flowTube(c, legTube(m, 'upper', 0.5)) }))
      out.add(`shin${s}`, limbZ(c, s, Z.sock - 0.1, false), `tights-l-${s}`, P.shape(lo, base, { outline: 0.6, material: 'cloth', spec: 0.2, inner: sheer(m.shin, true) || undefined, shadeFrom: flowTube(c, legTube(m, 'lower', 0.5)) }))
      continue
    }
    const len = art === 'ankle' ? 0.2 : art === 'crew-socks' ? 0.45 : art === 'knee' ? 0.85 : 1
    const top = m.shin * (1 - len)
    const r0 = lerp(m.kneeR, a, 1 - len) + 0.8
    // A thigh-high's lower piece continues its upper one: round top, no outline across the knee.
    const cut = -m.kneeR * 0.4
    const d = art === 'thigh' ? limbPaths([[0, cut], [0, m.shin * 0.5], [0, m.shin + a * 0.3]], (m.kneeR + 1) * 2, (a + 1) * 2, 0, 'round').fill : brush([[0, top], [0, lerp(top, m.shin, 0.5)], [0, m.shin + a * 0.3]], r0 * 2, (a + 1) * 2, 0, 'flat', 'round')
    const striped = art === 'thigh' && p.b('striped')
    let inner = rich(c) ? texture(d, knitPaint(c, tint, u * 1.3)) : ''
    // Ribbed cuff at the top.
    const cuffH = a * (art === 'ankle' ? 0.45 : 0.7)
    if (P.detail > 0 && art !== 'thigh') inner += (rich(c) ? texture(rect(-r0 * 2, top, r0 * 4, cuffH), ribPaint(c, tint, u * 1.0)) : '') + seamLine(c, `M${f(-r0 * 2)} ${f(top + cuffH)}H${f(r0 * 2)}`, tint, u, 0.5)
    if ((art === 'crew-socks' || art === 'knee') && color2 !== color && P.detail > 0) inner += P.line(`M${f(-r0 * 2)} ${f(top + cuffH + a * 0.3)}H${f(r0 * 2)}M${f(-r0 * 2)} ${f(top + cuffH + a * 0.75)}H${f(r0 * 2)}`, color2, a * 0.22)
    if (art === 'crew-socks' && color2 === color && P.detail > 0) inner += P.line(`M${f(-r0 * 2)} ${f(top + cuffH + a * 0.3)}H${f(r0 * 2)}`, shadowOf(color, 0.2), a * 0.18)
    if (striped) inner += stripes(g, top, m.shin + a, r0, color2)
    inner += creases(c, [{ pts: [[-r0 * 0.8, m.shin - a * 0.6], [0, m.shin - a * 0.35], [r0 * 0.7, m.shin - a * 0.65]], w: u }], tint)
    out.add(`shin${s}`, limbZ(c, s, Z.sock - (art === 'thigh' ? 0.1 : 0), false), `${art}-${s}`, P.shape(d, tint, { material: 'cloth', inner: inner || undefined, shadeFrom: art === 'thigh' ? flowTube(c, legTube(m, 'lower', 1)) : undefined }))
    if (art === 'thigh') {
      const tp = tubeGeo([[0, m.thigh * 0.45], [0, m.thigh * 0.8], [0, m.thigh]], (lerp(m.thighR, m.kneeR, 0.45) + 1) * 2, (m.kneeR + 1) * 2, 0, 'flat', 'round')
      const td = smooth(tp, true)
      // Stroke all but the knee end (the lower piece continues under it).
      const tEdge = openOutline(tp, ([, y]) => y > m.thigh + 0.5)
      const tr = lerp(m.thighR, m.kneeR, 0.45) + 1
      let ti = rich(c) ? texture(td, knitPaint(c, tint, u * 1.3)) : ''
      if (P.detail > 0) ti += P.flat(rect(-tr * 2, m.thigh * 0.45, tr * 4, a * 0.6), shadowOf(tint, 0.12)) + (rich(c) ? texture(rect(-tr * 2, m.thigh * 0.45, tr * 4, a * 0.6), ribPaint(c, tint, u)) : '')
      if (striped) ti += stripes(g, m.thigh * 0.45 + a * 0.6, m.thigh + m.kneeR, tr, color2)
      out.add(`thigh${s}`, limbZ(c, s, Z.sock, false), `${art}-u-${s}`, limbShape(c, { fill: td, edge: tEdge }, tint, { material: 'cloth', inner: ti || undefined, shadeFrom: flowTube(c, legTube(m, 'upper', 1)) }))
    }
  }
}

/** Horizontal stripes down a sock (inner content). */
function stripes(g: G, y0: number, y1: number, r: number, color: string): string {
  const { c, m } = g
  const step = m.ankleR * 1.1
  let d = ''
  for (let y = y0 + step * 0.3; y < y1; y += step) d += rect(-r * 2, y, r * 4, step * 0.5)
  return c.paint.flat(d, color)
}

/* ---- Layers casting shadows on each other ------------------------------------------ */

function castLayers(g: G): void {
  const { c, out, m, u } = g
  const L = g.layers
  if (!tonal(c) || !c.baked) return
  const T = m.torsoLen
  const skin = c.sec('skin').c('tone', '#d69d78')
  // A top (or jacket) hem shades the trousers below it.
  const hemShadow = (hem: number, off: number, flare: number, receiver: string, z: number, id: string) => {
    if (c.view === 'side') return
    // Kept within the trousers' own width (the clip then never leaves a band corner alone on canvas).
    const hx = Math.min(bodyHalfAt(m, hem) + off + flare, m.hipHalf + (L.bottom ? L.bottom.off : 0))
    const h = T * 0.075
    const band = smooth([[-hx, hem - 2], [0, hem + (hem > 0 ? 4 : 2)], [hx, hem - 2], [hx * 0.96, hem + h], [0, hem + h + 3], [-hx * 0.96, hem + h]])
    const clip = clipFor(c, pantsPelvis(c, m, L.bottom ? L.bottom.off : 0))
    out.add('hips', z, id, `<g clip-path="url(#${clip})">${castShadow(c, band, receiver, [0.5, 0], [0.5, 1], 0.42)}</g>`)
  }
  if (L.bottom && !L.bottom.skirt) {
    if (L.top && L.top.hem < m.pelvisH * 0.9) hemShadow(L.top.hem, L.top.off, L.top.flare, L.bottom.color, Z.bottom + 1.5, 'cast-top')
    if (L.outer && L.outer.hem < m.pelvisH * 0.9 && (!L.top || L.outer.hem >= L.top.hem - 2)) hemShadow(L.outer.hem, L.outer.off, L.outer.flare, L.bottom.color, Z.bottom + 1.6, 'cast-outer')
  }
  // (An open jacket onto the top and a skirt onto the legs are the compositor's contact
  // shadows in baked stills; the cases below are ones it does not cover.)
  // Sleeves shade the skin just below their cuffs.
  for (const s of ['L', 'R'] as const) {
    const sl = L.sleeves[s]
    if (!sl) continue
    if (sl.lower > 0 && sl.lower < 1 && !(c.sec('body').s('limbDiff') === `arm-${s.toLowerCase()}`)) {
      // A band as wide as the forearm there (no clip needed).
      const y = sl.lower * m.forearm - u * 0.5
      const w0 = lerp(m.elbowR, m.wristR, sl.lower) * 0.96
      const w1 = lerp(m.elbowR, m.wristR, Math.min(1, sl.lower + (m.wristR * 1.1) / m.forearm)) * 0.96
      const band = poly([[-w0, y], [w0, y], [w1, y + m.wristR * 1.1], [-w1, y + m.wristR * 1.1]])
      out.add(`forearm${s}`, limbZ(c, s, Z.armLower + 0.3, true), `cast-cuff-${s}`, castShadow(c, band, skin, [0.5, 0], [0.5, 1], 0.42, true))
    } else if (sl.lower === 0 && sl.upper > 0 && sl.upper < 1.05) {
      const y = sl.upper * m.upperArm - u * 0.5
      const w = lerp(m.armR, m.elbowR, sl.upper) * 0.96
      out.add(`upperArm${s}`, limbZ(c, s, Z.armUpper + 0.3, true), `cast-sleeve-${s}`, castShadow(c, poly([[-w, y], [w, y], [w * 0.97, y + m.armR * 1.1], [-w * 0.97, y + m.armR * 1.1]]), skin, [0.5, 0], [0.5, 1], 0.4, true))
    }
  }
}

/* ---- Entry point ------------------------------------------------------------------ */

export function garmentsGen(c: Ctx, parts: PartList): void {
  const hr = c.hr as HumanRig
  const m = hr.m
  const tile = m.headH * 0.2
  const layers: Layers = { sleeves: {} }
  const u = detailUnit(m)
  // Every garment part carries explicit bounds from its own geometry (see `svgBounds`).
  const out = { add: (bone: string, z: number, id: string, svg: string) => parts.add(bone, z, id, svg, false, svg ? svgBounds(svg) : undefined) }
  const mk = (art: string, p: Reader): G => ({ c, out, m, p, art, tile, u, fab: FABRIC[art] ?? 'cotton', layers })
  const hasTop = !!c.item('top') || !!c.item('full')
  const hasBottom = !!c.item('bottom') || !!c.item('full')
  // Base layer: an avatar is never drawn undressed.
  if (!hasTop) drawTop(mk('tank', reader({ color: '#ece6dc', color2: '#d9d2c5', pattern: 'solid' })))
  if (!hasBottom) drawBottom(mk('shorts', reader({ color: '#5b6475', color2: '#4a5263', pattern: 'solid', length: 0.35 })))
  for (const it of c.items) {
    const g = mk(it.art, it.p)
    switch (it.spec.slot) {
      case 'top':
        drawTop(g)
        break
      case 'bottom':
        drawBottom(g)
        break
      case 'full':
        drawFull(g)
        break
      case 'outer':
        drawOuter(g)
        break
      case 'shoes':
        drawShoes(g)
        break
      case 'socks':
        drawSocks(g)
        break
    }
  }
  castLayers(mk('', reader({})))
}

export { mirrorD }

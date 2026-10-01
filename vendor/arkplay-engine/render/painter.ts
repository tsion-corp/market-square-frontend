/* The Painter: the only place fills, shading and outlines are decided.
 *
 * Part generators describe shapes; the painter turns them into styled SVG according to
 * the avatar's art style (outline weight and colour, flat / cel / soft / rim shading,
 * colour grade, detail level). Keeping this in one place is what makes a hat, a tail and
 * a sleeve look like they belong to the same drawing.
 *
 * ---- Light model -----------------------------------------------------------------------
 *
 * Three lights, derived from the style and scene sections (see `sceneRig`):
 *  - key light   direction from `style.light` (`style.light`, a unit vector toward the
 *                light); its colour (`rig.key`) warms highlights and speculars.
 *  - fill light  the soft ambient of the environment (`rig.fill`): shadows lean toward it,
 *                so a sunset gives violet shadows and underwater gives teal ones.
 *  - rim light   a back light (`rig.rim`): the bright shadow-side edge in `rim` shading, and
 *                the light wrap the compositor adds around the silhouette of baked stills.
 * Reflected light (`rig.bounce`) lifts the far edge of shadows. With no scene background
 * the rig is a neutral studio light (warm key, cool fill).
 *
 * Shadows are hue-shifted, never grey: warm and more saturated on skin (subsurface), toward
 * the ambient light on cloth and metal. Highlights lean toward the key light.
 *
 * Shading modes (per shape):
 *  - flat  no form shading; outlines still get their weight.
 *  - cel   crisp bands that follow the silhouette: a core shadow, a thinner reflected-light
 *          band at the far edge and a crisp highlight crescent on the lit edge.
 *  - soft  a soft terminator gradient: highlight, base, terminator, core shadow, reflected
 *          light.
 *  - rim   cel, plus a bright rim light along the shadow-side edge.
 * Baked stills (`style.baked`, RenderOptions.quality 'high') get the full model plus
 * weighted outlines (thinner on the lit side and inner lines, heavier on the shadow side)
 * and material speculars. `quality: 'standard'` (animation frames, sprite sheets, rigs)
 * keeps the cheap single-crescent geometry with the same colours. `detail: low` stays flat
 * and clean for icons and pixel art; `medium` drops the reflected band and subsurface.
 *
 * ---- API for part authors (all additive; existing calls keep working) -------------------
 *
 *   paint.shape(d, color, {
 *     shade, offset, gloss, shadeFrom, outline, outlineClip, paint, ink, opacity, attrs,
 *     material: 'skin' | 'cloth' | 'leather' | 'metal' | 'gem' | 'glass' | 'hair' | 'fur'
 *             | 'feathers' | 'scales' | 'chitin' | 'plastic' | 'rubber' | 'wood' | 'rock'
 *             | 'wet' | 'slime' | 'jelly' | 'ghost' | 'flame',
 *                        // how the surface takes light (shadow hue, speculars, reflections);
 *                        // default: auto-detected skin / creature coat, else matte cloth
 *     spec: 0..1,        // override specular strength (0 = none)
 *     inner: svg,        // markings/prints drawn inside the shape, above the fill and
 *                        // below the shading and outline (so they get shaded too)
 *   })
 *   paint.union(ds, color, { ...same })
 *   paint.tone(color, 'shadow' | 'reflect' | 'highlight' | 'rim' | 'spec', material?)
 *                        // the exact colours the painter uses, for hand-drawn details
 *   paint.materialOf(color) // the material a colour resolves to (auto-detection)
 *   paint.outlineUnder(d, color, { mul, ink, clip })
 *                        // the ink underlay for shapes a part outlines itself, with the
 *                        // same shadow-side weighting as `shape` outlines in baked stills
 *   MATERIALS[m]         // the material table (read-only)
 *   paint.style.rig      // light colours: key, fill, rim, bounce, tint
 *
 * `gloss: true` without a material gives a plastic-like specular. Skin is detected
 * automatically from the skin tone, and creature coat colours from the coat texture, so
 * those need no changes. */

import { contrastRatio, fromLch, harmonize, highlightOf, inkOf, lightTone, mix, mixHue, normalizeColor, paintDistance, shadeTone, shadowOf, tintToward, toLch } from '../core/color.ts'
import { clamp, lerp, norm, type Box, type P } from '../core/math.ts'
import { f } from '../core/path.ts'
import { hash32 } from '../core/rng.ts'
import { Defs, el, g, url, type Attrs } from '../core/svg.ts'

export type Shading = 'flat' | 'cel' | 'soft' | 'rim'
export type Grade = 'none' | 'vivid' | 'pastel' | 'muted' | 'warm' | 'cool' | 'mono' | 'sepia' | 'noir' | 'neon'
export type InkMode = 'auto' | 'dark' | 'black' | 'white'

export type Material =
  | 'skin'
  | 'cloth'
  | 'leather'
  | 'metal'
  | 'gem'
  | 'glass'
  | 'hair'
  | 'fur'
  | 'feathers'
  | 'scales'
  | 'chitin'
  | 'plastic'
  | 'rubber'
  | 'wood'
  | 'rock'
  | 'wet'
  | 'slime'
  | 'jelly'
  | 'ghost'
  | 'flame'

/** How a surface takes light. */
export interface MaterialSpec {
  /** 0 = shadows lean toward the ambient light (cool), 1 = toward red-orange (subsurface). */
  warm: number
  /** Shadow chroma multiplier (> 1 = richer shadows). */
  sat: number
  /** Shadow depth multiplier. */
  depth: number
  /** Reflected light at the far edge of shadows, 0..1. */
  bounce: number
  /** Specular strength, 0..1. */
  spec: number
  /** Specular size multiplier. */
  specSize: number
  /** Crisp (true) or soft (false) specular. */
  hard: boolean
  /** Saturated warm band at the terminator (light scattering under the surface), 0..1. */
  sss: number
  /** Environment reflection bands (sky, horizon, ground), 0..1. */
  env: number
  /** Light transmitted to the shadow side (gems, glass, slime), 0..1. */
  glow: number
  /** Rim light multiplier. */
  rim: number
}

export const MATERIALS: Readonly<Record<Material, MaterialSpec>> = {
  skin: { warm: 1, sat: 1.15, depth: 0.9, bounce: 0.55, spec: 0.12, specSize: 1.3, hard: false, sss: 0.6, env: 0, glow: 0, rim: 1 },
  cloth: { warm: 0, sat: 1.1, depth: 1, bounce: 0.4, spec: 0, specSize: 1, hard: false, sss: 0, env: 0, glow: 0, rim: 0.85 },
  leather: { warm: 0.45, sat: 1.12, depth: 1.1, bounce: 0.35, spec: 0.35, specSize: 0.9, hard: false, sss: 0, env: 0, glow: 0, rim: 0.9 },
  metal: { warm: 0, sat: 0.95, depth: 1.45, bounce: 0.85, spec: 0.9, specSize: 0.8, hard: true, sss: 0, env: 1, glow: 0, rim: 1.2 },
  gem: { warm: 0, sat: 1.3, depth: 1.25, bounce: 0.6, spec: 1, specSize: 0.6, hard: true, sss: 0, env: 0.25, glow: 0.85, rim: 1.2 },
  glass: { warm: 0, sat: 1.05, depth: 0.6, bounce: 0.5, spec: 1, specSize: 0.7, hard: true, sss: 0, env: 0.4, glow: 0.5, rim: 1.5 },
  hair: { warm: 0.3, sat: 1.15, depth: 1.05, bounce: 0.4, spec: 0.35, specSize: 1.4, hard: false, sss: 0, env: 0, glow: 0, rim: 1 },
  fur: { warm: 0.55, sat: 1.15, depth: 0.95, bounce: 0.5, spec: 0, specSize: 1, hard: false, sss: 0.45, env: 0, glow: 0, rim: 1.3 },
  scales: { warm: 0.1, sat: 1.15, depth: 1.1, bounce: 0.45, spec: 0.4, specSize: 0.8, hard: true, sss: 0, env: 0.2, glow: 0, rim: 1 },
  chitin: { warm: 0, sat: 1.2, depth: 1.2, bounce: 0.5, spec: 0.75, specSize: 0.8, hard: true, sss: 0, env: 0.5, glow: 0, rim: 1.1 },
  plastic: { warm: 0, sat: 1.15, depth: 1, bounce: 0.45, spec: 0.8, specSize: 0.8, hard: true, sss: 0, env: 0, glow: 0, rim: 1 },
  rubber: { warm: 0, sat: 1.05, depth: 1.15, bounce: 0.3, spec: 0.25, specSize: 1.5, hard: false, sss: 0, env: 0, glow: 0, rim: 0.7 },
  wood: { warm: 0.6, sat: 1.1, depth: 1.05, bounce: 0.3, spec: 0.1, specSize: 1.2, hard: false, sss: 0, env: 0, glow: 0, rim: 0.8 },
  slime: { warm: 0, sat: 1.3, depth: 0.7, bounce: 0.6, spec: 0.95, specSize: 0.8, hard: true, sss: 0.6, env: 0, glow: 0.7, rim: 1.3 },
  feathers: { warm: 0.3, sat: 1.12, depth: 1, bounce: 0.45, spec: 0.15, specSize: 1.3, hard: false, sss: 0.2, env: 0, glow: 0, rim: 1.2 },
  rock: { warm: 0.15, sat: 1.05, depth: 1.15, bounce: 0.3, spec: 0.05, specSize: 1.5, hard: false, sss: 0, env: 0, glow: 0, rim: 0.8 },
  wet: { warm: 0.3, sat: 1.2, depth: 1, bounce: 0.5, spec: 0.85, specSize: 0.9, hard: true, sss: 0.3, env: 0.2, glow: 0, rim: 1.2 },
  jelly: { warm: 0, sat: 1.3, depth: 0.6, bounce: 0.65, spec: 0.95, specSize: 0.8, hard: true, sss: 0.5, env: 0, glow: 0.8, rim: 1.3 },
  ghost: { warm: 0, sat: 1, depth: 0.5, bounce: 0.7, spec: 0.3, specSize: 1.5, hard: false, sss: 0, env: 0, glow: 0.9, rim: 1.6 },
  flame: { warm: 1, sat: 1.2, depth: 0.3, bounce: 0.8, spec: 0, specSize: 1, hard: false, sss: 0, env: 0, glow: 1, rim: 0.5 },
}

/** Light colours for the scene the avatar stands in. */
export interface LightRig {
  /** Key light colour (highlights, speculars). */
  key: string
  /** Fill / ambient colour (shadows lean toward it). */
  fill: string
  /** Rim / back light colour. */
  rim: string
  /** Reflected (bounce) light colour. */
  bounce: string
  /** How strongly the scene tints the character, 0..1 (0 = neutral studio light). */
  tint: number
}

export const NEUTRAL_RIG: Readonly<LightRig> = { key: '#fff3dc', fill: '#6f7cc0', rim: '#e4ecff', bounce: '#c4a08c', tint: 0 }

/** A colour that resolves to a material automatically (the skin tone, a creature's coat). */
export interface AutoMaterial {
  color: string
  material: Material
}

export interface StyleState {
  /** Outline width in world units (0 = none). */
  lw: number
  ink: InkMode
  shading: Shading
  /** Unit vector pointing toward the light. */
  light: P
  grade: Grade
  /** 0 low, 1 medium, 2 high. */
  detail: 0 | 1 | 2
  /** Still image at `quality: 'high'`: spend more on lighting and materials (see RenderOptions.quality). */
  baked: boolean
  /** Light colours from the scene (default: NEUTRAL_RIG). */
  rig?: LightRig
  /** Colours that pick a material automatically (default: none). */
  auto?: AutoMaterial[]
}

export interface ShapeOpts {
  /** Shadow depth multiplier; false/0 = no shading. */
  shade?: number | false
  /** Outline: false = none, number = width multiplier. */
  outline?: boolean | number
  /** Paint to use instead of the flat colour (pattern / gradient url). Shading overlays it. */
  paint?: string
  opacity?: number
  /** Where the shadow falls, as a fraction of the shape's size (default 0.14). */
  offset?: number
  /** Outline colour override. */
  ink?: string
  /** Add a glossy highlight blob (eyes, metal, gems). */
  gloss?: boolean
  /** Clip the outline (not the fill) — e.g. bangs are outlined only below the hairline. */
  outlineClip?: string
  /** Compute the shading crescent from this shape instead (clipped to the real shape), so
   *  only its outer silhouette is shaded — a hair cap has no shadow along its hairline. */
  shadeFrom?: string
  attrs?: Attrs
  /** How the surface takes light (see MATERIALS). Default: auto-detected, else matte. */
  material?: Material
  /** Specular strength override, 0..1 (0 = none). */
  spec?: number
  /** SVG drawn inside the shape (clipped to it) above the fill and below the shading and
   *  outline: markings, prints, belly patches — they get shaded with the shape. */
  inner?: string
}

/** Colours the painter derives for one base colour, depth and material. */
interface Tones {
  /** Core shadow. */
  S: string
  /** Reflected light at the far edge of the shadow. */
  R: string
  /** Subsurface band at the terminator. */
  T: string
  /** Highlight. */
  H: string
  /** Rim light. */
  Rim: string
  /** Specular. */
  Spec: string
  /** Transmitted glow (gems, glass, slime). */
  Glow: string
}

/** Rough bounds of path data (endpoints and control points; arcs padded by their radii). */
export function pathBounds(d: string): Box {
  const re = /([MLHVCSQTAZ])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi
  let cmd = ''
  let args: number[] = []
  let x = 0
  let y = 0
  // Start of the current subpath (where Z returns to).
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
  const need: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
  const flush = () => {
    if (!cmd) return
    const c = cmd.toUpperCase()
    // Lowercase commands are relative to the current point at the start of each segment.
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
          // The whole ellipse may bulge past both ends: pad each end by the radii.
          add(x - a[0], y - a[1])
          add(x + a[0], y + a[1])
          x = ox + a[5]
          y = oy + a[6]
          add(x - a[0], y - a[1])
          add(x + a[0], y + a[1])
          break
        }
        default:
          // Control points bound the curve (convex hull).
          for (let i = 0; i < n - 2; i += 2) add(ox + a[i], oy + a[i + 1])
          x = ox + a[n - 2]
          y = oy + a[n - 1]
      }
      add(x, y)
      if (c === 'M') {
        sx = x
        sy = y
        // Further pairs after a moveto are lineto, relative if the moveto was.
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

const unionBox = (bs: Box[]): Box =>
  bs.reduce((a, b) => {
    if (a.w === 0 && a.h === 0) return b
    if (b.w === 0 && b.h === 0) return a
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
  })

/** A content key for defs: two independent 32-bit hashes (collisions would share a def). */
export const key64 = (...parts: (string | number)[]): string => hash32(...parts).toString(36) + hash32('~', ...parts).toString(36)

const tr = (dx: number, dy: number): string => `translate(${f(dx)} ${f(dy)})`
const hk = (hex: string): string => hex.slice(1)

/** Geometry of one shape (or union) being painted in baked mode. */
interface Geo {
  /** Element id to `<use>` for the visible shape (a path, or a group of paths). */
  id: string
  /** Element id to `<use>` for the shading source (shadeFrom), usually `id`. */
  src: string
  /** Clip-path id of the visible shape (created lazily). */
  clip: () => string
  /** Bounds of the shading source. */
  bb: Box
  /** Bounds of the visible shape. */
  shapeBB: Box
}

export class Painter {
  readonly defs: Defs
  readonly style: StyleState
  private readonly gradeCache = new Map<string, string>()
  private readonly toneCache = new Map<string, Tones>()
  private readonly matCache = new Map<string, Material | undefined>()
  private rigCache: LightRig | null = null

  constructor(defs: Defs, style: StyleState) {
    this.defs = defs
    this.style = style
  }

  /* ---- Colour ------------------------------------------------------- */

  /** Applies the colour grade. Every colour that reaches the SVG passes through here. */
  col(hex: string): string {
    const key = hex
    const hit = this.gradeCache.get(key)
    if (hit) return hit
    const out = gradeColor(normalizeColor(hex, '#888888'), this.style.grade)
    this.gradeCache.set(key, out)
    return out
  }

  shadow(hex: string, depth = 0.13): string {
    return shadowOf(this.col(hex), depth)
  }

  light(hex: string, amount = 0.14): string {
    return highlightOf(this.col(hex), amount)
  }

  /** Outline colour for a fill. */
  ink(hex: string): string {
    switch (this.style.ink) {
      case 'black':
        return '#141217'
      case 'white':
        return '#fbf9f5'
      case 'dark':
        return '#2a2230'
      default:
        return inkOf(this.col(hex), 0.9)
    }
  }

  get lw(): number {
    return this.style.lw
  }

  get detail(): 0 | 1 | 2 {
    return this.style.detail
  }

  /** The light colours, graded like everything else. */
  get rig(): LightRig {
    if (this.rigCache) return this.rigCache
    const r = this.style.rig ?? NEUTRAL_RIG
    this.rigCache = { key: this.col(r.key), fill: this.col(r.fill), rim: this.col(r.rim), bounce: this.col(r.bounce), tint: r.tint }
    return this.rigCache
  }

  /** The material a (graded) colour resolves to without an explicit `material`. */
  materialOf(color: string): Material | undefined {
    const base = this.col(color)
    if (this.matCache.has(base)) return this.matCache.get(base)
    let out: Material | undefined
    const bl = toLch(base).l
    for (const a of this.style.auto ?? []) {
      const ac = this.col(a.color)
      if (paintDistance(base, ac) < 0.04 && Math.abs(toLch(ac).l - bl) < 0.22) {
        out = a.material
        break
      }
    }
    this.matCache.set(base, out)
    return out
  }

  /** A colour the painter would use for `color`: its shadow, reflected light, highlight, rim
   *  light or specular, per material and scene light. */
  tone(color: string, which: 'shadow' | 'reflect' | 'highlight' | 'rim' | 'spec', material?: Material, depth = 1): string {
    const base = this.col(color)
    const t = this.tones(base, depth, material ?? this.materialOf(base))
    switch (which) {
      case 'shadow':
        return t.S
      case 'reflect':
        return t.R
      case 'highlight':
        return t.H
      case 'rim':
        return t.Rim
      case 'spec':
        return t.Spec
    }
  }

  private tones(base: string, depth: number, mat: Material | undefined): Tones {
    const key = `${base}|${depth}|${mat ?? ''}`
    const hit = this.toneCache.get(key)
    if (hit) return hit
    const M = MATERIALS[mat ?? 'cloth']
    const rig = this.rig
    const k = 0.13 * depth * M.depth
    const bl = toLch(base)
    const fillL = toLch(rig.fill)
    const keyL = toLch(rig.key)
    // Cool shadows lean toward the fill light's hue (blue-violet in neutral light).
    const coolHue = rig.tint > 0 && fillL.c > 0.02 ? mixHue(285, fillL.h, Math.min(1, rig.tint * 1.6)) : 285
    const warmHue = 28
    const natural = bl.h < 120 || bl.h > 330
    // Deep skin tones: shadows stay richer and less dark (they read as mud otherwise).
    const deep = M.warm > 0.5 ? clamp((0.55 - bl.l) / 0.25, 0, 1) : 0
    let S = shadeTone(base, k, {
      hue: M.warm > 0.5 ? warmHue : coolHue,
      pull: M.warm > 0.5 ? (natural ? 0.26 : 0.1) * M.warm : 1.1 * 0.13 * (1 - M.warm) + 0.02,
      chroma: M.sat * (1 + 0.18 * deep),
      drop: (M.warm > 0.5 ? 0.92 : 1) * (1 - 0.3 * deep),
      grey: 0.1,
    })
    // The environment colours the shadows. Warm (subsurface) materials keep their warmth:
    // small hue turns only, so skin never goes green or grey in a coloured scene.
    const turn = M.warm > 0.5 ? 10 : 36
    if (rig.tint > 0) S = harmonize(S, rig.fill, rig.tint * 0.5 * (M.warm > 0.5 ? 0.6 : 1) * Math.min(1.5, depth), turn)
    const R = harmonize(mix(S, base, 0.14 + M.bounce * 0.22), rig.bounce, 0.08 + M.bounce * 0.12, turn)
    const sl = toLch(S)
    const T = fromLch({ l: sl.l + 0.045, c: Math.min(0.24, sl.c * 1.18 + 0.008), h: mixHue(sl.h, warmHue, natural ? 0.25 : 0.1) })
    const keyHue = keyL.c > 0.02 ? mixHue(85, keyL.h, Math.min(1, rig.tint * 1.5)) : 85
    let H = lightTone(base, 0.16 * depth, keyHue, 0.8)
    if (rig.tint > 0) H = harmonize(H, rig.key, rig.tint * 0.45, turn)
    const Rim = tintToward(lightTone(base, 0.5, toLch(rig.rim).h, 0.3), rig.rim, 0.55)
    const Spec = mat === 'metal' ? mix(lightTone(base, 0.75, keyHue), rig.key, 0.35) : mix('#ffffff', rig.key, 0.55)
    const Glow = fromLch({ l: Math.min(0.95, bl.l + 0.18), c: Math.min(0.3, bl.c * 1.35 + 0.02), h: bl.h })
    const gr = this.style.grade
    const fix = gr === 'mono' || gr === 'noir' || gr === 'sepia' ? (c: string) => gradeColor(c, gr) : (c: string) => c
    const out: Tones = { S: fix(S), R: fix(R), T: fix(T), H: fix(H), Rim: fix(Rim), Spec: fix(Spec), Glow: fix(Glow) }
    this.toneCache.set(key, out)
    return out
  }

  /* ---- Shapes: standard quality (animation frames) ------------------ */

  private shadeLayers(d: string, base: string, paint: string, depth: number, offset: number, bb: Box, tones: Tones, from?: string, inner?: string): string {
    const s = this.style
    const src = from ?? d
    const L = s.light
    const size = Math.max(4, Math.min(bb.w, bb.h))
    const dx = L[0] * size * offset
    const dy = L[1] * size * offset
    const shadow = tones.S
    const layers: string[] = []
    const overlay = paint !== base || !!inner
    if (s.shading === 'soft') {
      const gid = this.softGradient(base, depth, tones)
      if (!overlay) return el('path', { d, fill: url(gid) })
      return el('path', { d, fill: paint }) + (inner ? this.clipped(d, inner) : '') + el('path', { d, fill: url(gid), 'fill-opacity': 0.45 })
    }
    const clipId = this.clipOf(d)
    // Cel: shadow everywhere, then the lit shape shifted toward the light on top.
    if (!overlay) {
      layers.push(el('path', { d: src, fill: shadow }))
      layers.push(el('path', { d: src, fill: base, transform: tr(dx, dy) }))
    } else {
      layers.push(el('path', { d, fill: paint }))
      if (inner) layers.push(inner)
      // (rect minus shape), shifted toward the light, clipped to the shape = the far crescent.
      // Pad only by the shift so the part's bounds stay tight.
      const pad = Math.abs(dx) + Math.abs(dy) + 2
      layers.push(
        el('path', {
          d: `M${f(bb.x - pad)} ${f(bb.y - pad)}h${f(bb.w + pad * 2)}v${f(bb.h + pad * 2)}h${f(-(bb.w + pad * 2))}Z ${src}`,
          fill: shadow,
          'fill-rule': 'evenodd',
          'fill-opacity': 0.55,
          transform: tr(dx, dy),
        }),
      )
    }
    if (s.shading === 'rim' && s.detail > 0) {
      const r = size * 0.05
      const maskId = this.defs.add(`m${key64(d, f(bb.x), f(bb.y), f(bb.w), f(bb.h))}`, (id) =>
        el(
          'mask',
          { id, maskUnits: 'userSpaceOnUse', x: f(bb.x - size), y: f(bb.y - size), width: f(bb.w + size * 2), height: f(bb.h + size * 2) },
          el('path', { d, fill: '#fff' }),
          el('path', { d, fill: '#000', transform: tr(-L[0] * r, -L[1] * r) }),
        ),
      )
      layers.push(el('path', { d, fill: highlightOf(base, 0.35), mask: url(maskId), 'fill-opacity': 0.9 }))
    }
    return g({ 'clip-path': url(clipId) }, ...layers)
  }

  private softGradient(base: string, depth: number, tones: Tones): string {
    const L = this.style.light
    return this.defs.add(`sg${hk(base)}${Math.round(depth * 10)}${hk(tones.S)}`, (id) =>
      el(
        'linearGradient',
        { id, x1: f(0.5 + L[0] * 0.5), y1: f(0.5 + L[1] * 0.5), x2: f(0.5 - L[0] * 0.5), y2: f(0.5 - L[1] * 0.5) },
        el('stop', { offset: 0, 'stop-color': tones.H }),
        el('stop', { offset: 0.5, 'stop-color': base }),
        el('stop', { offset: 1, 'stop-color': mix(tones.S, shadowOf(base, 0.16 * depth), 0.35) }),
      ),
    )
  }

  /** One filled shape, shaded and outlined per the art style. */
  shape(d: string, color: string, o: ShapeOpts = {}): string {
    if (!d) return ''
    const s = this.style
    const base = this.col(color)
    const paint = o.paint ?? base
    const depth = o.shade === false ? 0 : (o.shade ?? 1)
    const shaded = depth > 0 && s.shading !== 'flat' && s.detail > 0
    const lwMul = o.outline === false ? 0 : typeof o.outline === 'number' ? o.outline : 1
    const lw = s.lw * lwMul
    const inkC = o.ink ?? this.ink(color)
    const attrs: Attrs = { ...(o.attrs ?? {}) }
    if (o.opacity !== undefined && o.opacity < 1) attrs.opacity = f(o.opacity)
    const mat = o.material ?? this.materialOf(base)

    if (s.baked && s.detail > 0) return this.bakedShape(d, base, paint, shaded ? depth : 0, lw, lwMul, inkC, attrs, mat, o)

    const gloss = o.gloss && s.detail > 0 ? this.glossFor(d, base) : ''
    const stroke = lw > 0 ? el('path', { d, fill: 'none', stroke: inkC, 'stroke-width': f(lw), 'stroke-linejoin': 'round', 'clip-path': o.outlineClip ? url(o.outlineClip) : undefined }) : ''
    if (!shaded) {
      const inner = o.inner ? this.clipped(d, o.inner) : ''
      if (o.outlineClip || inner) return g(attrs, el('path', { d, fill: paint }), inner, gloss, stroke)
      return g(attrs, el('path', { d, fill: paint, stroke: lw > 0 ? inkC : undefined, 'stroke-width': lw > 0 ? f(lw) : undefined, 'stroke-linejoin': lw > 0 ? 'round' : undefined }), gloss)
    }
    const bb = pathBounds(d)
    const tones = this.tones(base, depth, mat)
    return g(attrs, this.shadeLayers(d, base, paint, depth, o.offset ?? 0.14, o.shadeFrom ? pathBounds(o.shadeFrom) : bb, tones, o.shadeFrom, o.inner), gloss, stroke)
  }

  private clipped(d: string, content: string): string {
    return g({ 'clip-path': url(this.clipOf(d)) }, content)
  }

  /** A clip path of `d`, registered once per distinct shape: an animation redraws the same
   *  shapes every frame, and they all share one def. */
  private clipOf(d: string): string {
    return this.defs.add(`c${key64(d)}`, (id) => el('clipPath', { id }, el('path', { d })))
  }

  /**
   * Several shapes that read as one mass (hair clumps, fur tufts, a cloud): outlined only
   * on the outside of their union, shaded together.
   */
  union(ds: string[], color: string, o: ShapeOpts = {}): string {
    const list = ds.filter(Boolean)
    if (!list.length) return ''
    const s = this.style
    const base = this.col(color)
    const paint = o.paint ?? base
    const lwMul = o.outline === false ? 0 : typeof o.outline === 'number' ? o.outline : 1
    const lw = s.lw * lwMul
    const inkC = o.ink ?? this.ink(color)
    const depth = o.shade === false ? 0 : (o.shade ?? 1)
    const shaded = depth > 0 && s.shading !== 'flat' && s.detail > 0
    const attrs: Attrs = { ...(o.attrs ?? {}) }
    if (o.opacity !== undefined && o.opacity < 1) attrs.opacity = f(o.opacity)
    const mat = o.material ?? this.materialOf(base)
    if (s.baked && s.detail > 0) return this.bakedUnion(list, base, paint, shaded ? depth : 0, lw, lwMul, inkC, attrs, mat, o)

    const paths = (fill: string, extra: Attrs = {}) => list.map((d) => el('path', { d, fill, ...extra })).join('')
    const underlay =
      lw > 0 ? g({ stroke: inkC, 'stroke-width': f(lw * 2), 'stroke-linejoin': 'round', 'clip-path': o.outlineClip ? url(o.outlineClip) : undefined }, paths(inkC)) : ''
    if (!shaded) return g(attrs, underlay, paths(paint))

    const bb = unionBox(list.map(pathBounds))
    const size = Math.max(4, Math.min(bb.w, bb.h))
    const L = s.light
    const off = (o.offset ?? 0.1) * size
    const clipId = this.defs.add(`u${key64(...list)}`, (id) => el('clipPath', { id }, paths('#000')))
    const tones = this.tones(base, depth, mat)
    const inner = o.inner ? g({ 'clip-path': url(clipId) }, o.inner) : ''
    if (s.shading === 'soft') {
      const gid = this.softGradient(base, depth, tones)
      return g(attrs, underlay, paths(paint), inner, g({ 'clip-path': url(clipId) }, el('rect', { x: f(bb.x), y: f(bb.y), width: f(bb.w), height: f(bb.h), fill: url(gid), 'fill-opacity': paint === base && !inner ? 1 : 0.45 })))
    }
    const shadow = tones.S
    if (paint === base && !inner) {
      return g(attrs, underlay, g({ 'clip-path': url(clipId) }, paths(shadow), g({ transform: tr(L[0] * off, L[1] * off) }, paths(base))))
    }
    // Patterned mass: keep the pattern, darken only the crescent away from the light.
    const pad = size
    const maskId = this.defs.add(`um${key64(...list, f(off))}`, (id) =>
      el(
        'mask',
        { id, maskUnits: 'userSpaceOnUse', x: f(bb.x - pad), y: f(bb.y - pad), width: f(bb.w + pad * 2), height: f(bb.h + pad * 2) },
        paths('#fff'),
        g({ transform: tr(L[0] * off, L[1] * off) }, paths('#000')),
      ),
    )
    return g(attrs, underlay, paths(paint), inner, g({ mask: url(maskId) }, paths(shadow, { 'fill-opacity': 0.55 })))
  }

  /* ---- Shapes: baked stills ------------------------------------------ */

  private bakedShape(d: string, base: string, paint: string, depth: number, lw: number, lwMul: number, inkC: string, attrs: Attrs, mat: Material | undefined, o: ShapeOpts): string {
    const id = this.defs.unique('s')
    const shapeBB = pathBounds(d)
    let src = id
    let bb = shapeBB
    if (o.shadeFrom && depth > 0) {
      src = this.defs.unique('sf')
      this.defs.put(src, el('path', { id: src, d: o.shadeFrom }))
      bb = pathBounds(o.shadeFrom)
    }
    let clipId = ''
    const geo: Geo = {
      id,
      src,
      bb,
      shapeBB,
      clip: () => {
        if (!clipId) {
          clipId = this.defs.unique('c')
          this.defs.put(clipId, el('clipPath', { id: clipId }, el('use', { href: `#${id}` })))
        }
        return clipId
      },
    }
    const body = el('path', { id, d })
    return this.bakedLayers(geo, body, base, paint, depth, lw, lwMul, inkC, attrs, mat, o, 0.14)
  }

  private bakedUnion(list: string[], base: string, paint: string, depth: number, lw: number, lwMul: number, inkC: string, attrs: Attrs, mat: Material | undefined, o: ShapeOpts): string {
    const id = this.defs.unique('s')
    const ids = list.map((_, i) => `${id}-${i}`)
    const bb = unionBox(list.map(pathBounds))
    let clipId = ''
    const geo: Geo = {
      id,
      src: id,
      bb,
      shapeBB: bb,
      clip: () => {
        if (!clipId) {
          clipId = this.defs.unique('u')
          this.defs.put(clipId, el('clipPath', { id: clipId }, ...ids.map((i) => el('use', { href: `#${i}` }))))
        }
        return clipId
      },
    }
    // The union's outline is a stroke underlay of every piece (outside edges only show).
    const body = el('g', { id }, ...list.map((d, i) => el('path', { id: ids[i], d })))
    return this.bakedLayers(geo, body, base, paint, depth, lw, lwMul, inkC, attrs, mat, o, 0.1, true)
  }

  /**
   * The baked layer stack shared by shapes and unions:
   *   ink underlay (outline weight) → fill → inner → form shading → highlight → material
   *   (specular, environment, transmitted glow) → outline.
   * Every layer after the first is a `<use>` of the one path, so the geometry is written once.
   */
  private bakedLayers(geo: Geo, body: string, base: string, paint: string, depth: number, lw: number, lwMul: number, inkC: string, attrs: Attrs, mat: Material | undefined, o: ShapeOpts, defOffset: number, isUnion = false): string {
    const s = this.style
    const L = s.light
    const hi = s.detail > 1
    const M = MATERIALS[mat ?? 'cloth']
    const use = (ref: string, a: Attrs): string => el('use', { href: `#${ref}`, ...a })
    const shading = depth > 0 ? s.shading : 'flat'
    const overlay = paint !== base || !!o.inner
    const tones = this.tones(base, Math.max(depth, 0.001), mat)
    const size = Math.max(4, Math.min(geo.bb.w, geo.bb.h))
    const sh = size * (o.offset ?? defOffset)
    const out: string[] = []
    const translucent = o.opacity !== undefined && o.opacity < 1
    // A paint laid over the whole shape. Gradients use the shape's bounding box; a union's
    // pieces would each get their own box, so a union is covered by one clipped rect.
    const sb = geo.shapeBB
    const cover = (fill: string): string =>
      isUnion ? g({ 'clip-path': url(geo.clip()) }, el('rect', { x: f(sb.x), y: f(sb.y), width: f(sb.w), height: f(sb.h), fill })) : use(geo.id, { fill })

    // Outline weight: an ink copy nudged away from the light, under the fill, thickens the
    // line on the shadow side; the stroke itself is a little thinner (the lit side).
    const outer = lw > 0 && lwMul >= 0.95 && !translucent
    const wUnder = Math.min(lw * 0.7, Math.min(geo.shapeBB.w, geo.shapeBB.h) * 0.08)
    if (isUnion && lw > 0) {
      const strokeW = lw * 2 * (outer ? 0.85 : 0.9)
      const under = use(geo.id, { fill: inkC, stroke: inkC, 'stroke-width': f(strokeW), 'stroke-linejoin': 'round' }) + (outer && wUnder > 0.05 ? use(geo.id, { fill: inkC, transform: tr(-L[0] * wUnder, -L[1] * wUnder) }) : '')
      out.push(o.outlineClip ? g({ 'clip-path': url(o.outlineClip) }, under) : under)
    } else if (outer && wUnder > 0.05) {
      const under = use(geo.id, { fill: inkC, transform: tr(-L[0] * wUnder, -L[1] * wUnder) })
      out.push(o.outlineClip ? g({ 'clip-path': url(o.outlineClip) }, under) : under)
    }

    // Fill. For cel / rim on a flat colour the fill is the far-edge tone (reflected or rim
    // light) and the bands are painted over it, nearest the light last.
    const celFlat = (shading === 'cel' || shading === 'rim') && !overlay
    const farTone = shading === 'rim' ? mix(tones.R, tones.Rim, 0.4) : hi && M.bounce > 0 ? tones.R : tones.S
    out.push(el('g', { fill: celFlat ? farTone : paint }, body))
    if (o.inner) out.push(g({ 'clip-path': url(geo.clip()) }, o.inner))

    if (shading === 'cel' || shading === 'rim') {
      const dx = L[0] * sh
      const dy = L[1] * sh
      const far = shading === 'rim' ? 0.2 : 0.38
      if (celFlat) {
        const layers: string[] = []
        if (shading === 'rim' || (hi && M.bounce > 0)) layers.push(use(geo.src, { fill: tones.S, transform: tr(dx * far, dy * far) }))
        layers.push(use(geo.src, { fill: base, transform: tr(dx, dy) }))
        out.push(g({ 'clip-path': url(geo.clip()) }, ...layers))
      } else {
        // Over a pattern or markings: a translucent shadow through a luminance mask with
        // three levels (reflected band, core shadow, lit).
        const pad = Math.abs(dx) + Math.abs(dy) + 2
        const r = { x: geo.bb.x - pad, y: geo.bb.y - pad, w: geo.bb.w + pad * 2, h: geo.bb.h + pad * 2 }
        const mid = shading === 'rim' ? '#000' : hi ? '#999' : '#fff'
        const maskId = this.defs.unique('m')
        this.defs.put(
          maskId,
          el(
            'mask',
            { id: maskId, maskUnits: 'userSpaceOnUse', x: f(r.x), y: f(r.y), width: f(r.w), height: f(r.h) },
            el('rect', { x: f(r.x), y: f(r.y), width: f(r.w), height: f(r.h), fill: mid }),
            use(geo.src, { fill: '#fff', transform: tr(dx * far, dy * far) }),
            use(geo.src, { fill: '#000', transform: tr(dx, dy) }),
          ),
        )
        out.push(use(geo.id, { fill: tones.S, 'fill-opacity': 0.62, mask: url(maskId) }))
        if (shading === 'rim') {
          const rimId = this.defs.unique('m')
          this.defs.put(
            rimId,
            el(
              'mask',
              { id: rimId, maskUnits: 'userSpaceOnUse', x: f(r.x), y: f(r.y), width: f(r.w), height: f(r.h) },
              el('rect', { x: f(r.x), y: f(r.y), width: f(r.w), height: f(r.h), fill: '#fff' }),
              use(geo.src, { fill: '#000', transform: tr(dx * far, dy * far) }),
            ),
          )
          out.push(use(geo.id, { fill: tones.Rim, 'fill-opacity': 0.85, mask: url(rimId) }))
        }
      }
      // Crisp highlight crescent on the lit edge.
      out.push(cover(url(this.edgeLight(tones.H, overlay ? 0.35 : 0.55, true))))
    } else if (shading === 'soft') {
      out.push(cover(url(this.softVolume(tones, M, hi, overlay))))
    }

    // Material: specular, environment reflection, transmitted glow.
    if (s.shading !== 'flat') {
      // Deep skin tones show more sheen.
      const sheen = mat === 'skin' ? clamp((0.55 - toLch(base).l) / 0.25, 0, 1) * 0.16 : 0
      const spec = o.spec ?? (o.gloss ? Math.max(M.spec, 0.8) : M.spec + sheen)
      if (M.env > 0 && hi && depth > 0) out.push(cover(url(this.envBands(tones, M.env))))
      if (M.glow > 0 && hi) out.push(cover(url(this.transmit(tones.Glow, M.glow))))
      const hard = o.gloss && !o.material ? true : M.hard
      if (spec > 0.01 && (hi || spec >= 0.5)) out.push(cover(url(this.specular(tones.Spec, spec, M.specSize, hard))))
    } else if (o.gloss) {
      out.push(this.glossFor('', base, geo.shapeBB))
    }

    // Outline: slightly thinner than the nominal width (the underlay adds weight on the
    // shadow side); inner lines (outline < 1) thinner still.
    if (lw > 0 && !isUnion) {
      const w = lw * (outer ? 0.85 : 0.8)
      out.push(use(geo.id, { fill: 'none', stroke: inkC, 'stroke-width': f(w), 'stroke-linejoin': 'round', 'clip-path': o.outlineClip ? url(o.outlineClip) : undefined }))
    }
    return g(attrs, ...out)
  }

  /** Crescent of light along the lit edge: a bbox radial gradient centred away from the
   *  light, transparent inside, `color` in a thin band where the shape meets the light. */
  private edgeLight(color: string, alpha: number, crisp: boolean): string {
    const L = this.style.light
    return this.defs.add(`el${hk(color)}${Math.round(alpha * 100)}${crisp ? 'c' : 's'}`, (id) =>
      el(
        'radialGradient',
        { id, cx: f(0.5 - L[0] * 0.2), cy: f(0.5 - L[1] * 0.2), r: 0.7 },
        el('stop', { offset: crisp ? 0.86 : 0.62, 'stop-color': color, 'stop-opacity': 0 }),
        el('stop', { offset: crisp ? 0.875 : 1, 'stop-color': color, 'stop-opacity': f(alpha) }),
      ),
    )
  }

  /** Soft terminator: highlight → base → terminator → core shadow → reflected light, as one
   *  bbox radial gradient overlay (shared by every shape with the same colours). */
  private softVolume(t: Tones, M: MaterialSpec, hi: boolean, overlay: boolean): string {
    const L = this.style.light
    const k = overlay ? 0.7 : 1
    return this.defs.add(`sv${hk(t.S)}${hk(t.H)}${hi ? 'h' : 'm'}${overlay ? 'o' : ''}${Math.round(M.sss * 10)}`, (id) =>
      el(
        'radialGradient',
        { id, cx: f(0.5 + L[0] * 0.17), cy: f(0.5 + L[1] * 0.17), r: 0.72, fx: f(0.5 + L[0] * 0.3), fy: f(0.5 + L[1] * 0.3) },
        el('stop', { offset: 0, 'stop-color': t.H, 'stop-opacity': f((0.3 + M.spec * 0.35) * k) }),
        el('stop', { offset: 0.3, 'stop-color': t.H, 'stop-opacity': 0 }),
        el('stop', { offset: 0.6, 'stop-color': t.S, 'stop-opacity': 0 }),
        el('stop', { offset: 0.75, 'stop-color': hi && M.sss > 0 ? t.T : t.S, 'stop-opacity': f(0.32 * k) }),
        el('stop', { offset: 0.87, 'stop-color': t.S, 'stop-opacity': f(0.88 * k) }),
        el('stop', { offset: 0.97, 'stop-color': hi ? t.R : t.S, 'stop-opacity': f(0.82 * k) }),
      ),
    )
  }

  /** Specular highlight: a bbox radial gradient near the lit side (crisp core for hard
   *  materials, a broad sheen for soft ones). */
  private specular(color: string, strength: number, size: number, hard: boolean): string {
    const L = this.style.light
    const a = clamp(strength, 0, 1)
    return this.defs.add(`sp${hk(color)}${Math.round(a * 100)}${Math.round(size * 10)}${hard ? 'h' : 's'}`, (id) =>
      el(
        'radialGradient',
        { id, cx: f(0.5 + L[0] * 0.24), cy: f(0.5 + L[1] * 0.26), r: f((hard ? 0.2 : 0.34) * size) },
        ...(hard
          ? [
              el('stop', { offset: 0, 'stop-color': color, 'stop-opacity': f(0.95 * a) }),
              el('stop', { offset: 0.42, 'stop-color': color, 'stop-opacity': f(0.9 * a) }),
              el('stop', { offset: 0.5, 'stop-color': color, 'stop-opacity': f(0.28 * a) }),
              el('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }),
            ]
          : [el('stop', { offset: 0, 'stop-color': color, 'stop-opacity': f(0.7 * a) }), el('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 })]),
      ),
    )
  }

  /** Environment reflection for metals: sky above, a dark horizon band, ground bounce below. */
  private envBands(t: Tones, amount: number): string {
    const rig = this.rig
    const a = clamp(amount, 0, 1)
    return this.defs.add(`ev${hk(t.S)}${Math.round(a * 10)}`, (id) =>
      el(
        'linearGradient',
        { id, x1: 0, y1: 0, x2: 0.12, y2: 1 },
        el('stop', { offset: 0, 'stop-color': mix(rig.rim, '#ffffff', 0.3), 'stop-opacity': f(0.4 * a) }),
        el('stop', { offset: 0.38, 'stop-color': rig.rim, 'stop-opacity': 0 }),
        el('stop', { offset: 0.47, 'stop-color': t.S, 'stop-opacity': f(0.45 * a) }),
        el('stop', { offset: 0.56, 'stop-color': t.S, 'stop-opacity': 0 }),
        el('stop', { offset: 1, 'stop-color': rig.bounce, 'stop-opacity': f(0.3 * a) }),
      ),
    )
  }

  /** Light passing through a translucent body, pooling on the side away from the light. */
  private transmit(color: string, amount: number): string {
    const L = this.style.light
    return this.defs.add(`tg${hk(color)}${Math.round(amount * 10)}`, (id) =>
      el(
        'radialGradient',
        { id, cx: f(0.5 - L[0] * 0.2), cy: f(0.5 - L[1] * 0.22), r: 0.42 },
        el('stop', { offset: 0, 'stop-color': color, 'stop-opacity': f(0.55 * amount) }),
        el('stop', { offset: 1, 'stop-color': color, 'stop-opacity': 0 }),
      ),
    )
  }

  /**
   * The ink underlay for a shape a part outlines itself (the fill drawn on top hides its
   * inner half): a stroke of twice the outline width, and in baked stills the same
   * shadow-side weighting `shape` gives its own outlines. `mul` scales the width.
   */
  outlineUnder(d: string, color: string, o: { mul?: number; ink?: string; clip?: string } = {}): string {
    const lw = this.style.lw * (o.mul ?? 1)
    if (!d || lw <= 0) return ''
    const inkC = o.ink ?? this.ink(color)
    const L = this.style.light
    let out: string
    if (this.style.baked && this.style.detail > 0) {
      const bb = pathBounds(d)
      const w = Math.min(lw * 0.7, Math.min(bb.w, bb.h) * 0.08)
      out =
        el('path', { d, fill: inkC, stroke: inkC, 'stroke-width': f(lw * 2 * 0.85), 'stroke-linejoin': 'round' }) +
        (w > 0.05 && (o.mul ?? 1) >= 0.95 ? el('path', { d, fill: inkC, transform: tr(-L[0] * w, -L[1] * w) }) : '')
    } else out = el('path', { d, fill: 'none', stroke: inkC, 'stroke-width': f(lw * 2), 'stroke-linejoin': 'round' })
    return o.clip ? g({ 'clip-path': url(o.clip) }, out) : out
  }

  /* ---- Details --------------------------------------------------------- */

  /** A stroked line (details: seams, lashes, strand lines). Width in world units. */
  line(d: string, color: string, width: number, o: { opacity?: number; cap?: 'round' | 'butt'; dash?: string } = {}): string {
    if (!d || width <= 0) return ''
    // stroke-opacity rather than opacity: no compositing layer (faster, and resvg-safe).
    return el('path', {
      d,
      fill: 'none',
      stroke: this.col(color),
      'stroke-width': f(width),
      'stroke-linecap': o.cap ?? 'round',
      'stroke-linejoin': 'round',
      'stroke-opacity': o.opacity !== undefined && o.opacity < 1 ? f(o.opacity) : undefined,
      'stroke-dasharray': o.dash,
    })
  }

  /** An unshaded, unoutlined fill (blush, shine, soft shadows, texture). */
  flat(d: string, color: string, opacity = 1, extra: Attrs = {}): string {
    if (!d) return ''
    return el('path', { d, fill: this.col(color), 'fill-opacity': opacity < 1 ? f(opacity) : undefined, ...extra })
  }

  /** A radial glow (ungraded colour allowed for light sources). */
  glow(cx: number, cy: number, r: number, color: string, opacity = 0.6): string {
    const c = this.col(color)
    const id = this.defs.add(`glow${c.slice(1)}`, (gid) =>
      el(
        'radialGradient',
        { id: gid },
        el('stop', { offset: 0, 'stop-color': c, 'stop-opacity': 1 }),
        el('stop', { offset: 0.45, 'stop-color': c, 'stop-opacity': 0.45 }),
        el('stop', { offset: 1, 'stop-color': c, 'stop-opacity': 0 }),
      ),
    )
    return el('circle', { cx: f(cx), cy: f(cy), r: f(r), fill: url(id), 'fill-opacity': opacity < 1 ? f(opacity) : undefined })
  }

  /** Linear gradient paint between two colours along a direction in object bounds. */
  linear(key: string, stops: [number, string, number?][], from: P = [0, 0], to: P = [0, 1], userSpace?: Box): string {
    const id = this.defs.add(`lg${key}`, (gid) =>
      el(
        'linearGradient',
        userSpace
          ? { id: gid, gradientUnits: 'userSpaceOnUse', x1: f(userSpace.x + from[0] * userSpace.w), y1: f(userSpace.y + from[1] * userSpace.h), x2: f(userSpace.x + to[0] * userSpace.w), y2: f(userSpace.y + to[1] * userSpace.h) }
          : { id: gid, x1: f(from[0]), y1: f(from[1]), x2: f(to[0]), y2: f(to[1]) },
        ...stops.map(([o, c, a]) => el('stop', { offset: f(o), 'stop-color': this.col(c), 'stop-opacity': a !== undefined && a < 1 ? f(a) : undefined })),
      ),
    )
    return url(id)
  }

  private glossFor(d: string, base: string, box?: Box): string {
    const bb = box ?? pathBounds(d)
    const L = this.style.light
    const cx = bb.x + bb.w * (0.5 + L[0] * 0.25)
    const cy = bb.y + bb.h * (0.5 + L[1] * 0.3)
    const r = Math.min(bb.w, bb.h) * 0.16
    const hl = contrastRatio(base, '#ffffff') < 1.3 ? '#ffffff' : highlightOf(base, 0.55)
    return el('ellipse', { cx: f(cx), cy: f(cy), rx: f(r), ry: f(r * 0.7), fill: hl, 'fill-opacity': 0.8 })
  }
}

/* ---- Scene light ---------------------------------------------------------------------- */

const SCENE_RIGS: Record<string, LightRig> = {
  sky: { key: '#fff4d8', fill: '#7fb0e8', rim: '#eaf6ff', bounce: '#a6d69a', tint: 0.45 },
  sunset: { key: '#ffc890', fill: '#7a4c98', rim: '#ffb27a', bounce: '#c0587a', tint: 0.6 },
  night: { key: '#cdd8ff', fill: '#34407e', rim: '#a8c0ff', bounce: '#3e4a86', tint: 0.6 },
  forest: { key: '#fff1c8', fill: '#5f9270', rim: '#e8ffd8', bounce: '#78aa6c', tint: 0.5 },
  meadow: { key: '#fff5da', fill: '#86bbe6', rim: '#ffffff', bounce: '#a4d88e', tint: 0.4 },
  beach: { key: '#fff1d0', fill: '#72c0ec', rim: '#ffffff', bounce: '#f1d7a0', tint: 0.45 },
  city: { key: '#ffdb96', fill: '#51468a', rim: '#b8a6ff', bounce: '#4a3f72', tint: 0.55 },
  snow: { key: '#ffffff', fill: '#98b4dc', rim: '#ffffff', bounce: '#e4eefa', tint: 0.45 },
  space: { key: '#e8e2ff', fill: '#3e2c80', rim: '#b884ff', bounce: '#6b3fa0', tint: 0.6 },
  underwater: { key: '#c4f2ff', fill: '#1d7aa4', rim: '#8eeaff', bounce: '#2a90b6', tint: 0.65 },
  dungeon: { key: '#ffb866', fill: '#453c5c', rim: '#ff9a44', bounce: '#5a4448', tint: 0.55 },
  stage: { key: '#fff0c4', fill: '#56285e', rim: '#ffa4d6', bounce: '#8a4424', tint: 0.5 },
  volcano: { key: '#ffb477', fill: '#6a2028', rim: '#ff7a36', bounce: '#ff6224', tint: 0.6 },
  candy: { key: '#fff4fa', fill: '#e8a4d6', rim: '#d2f4ff', bounce: '#bdf2cf', tint: 0.45 },
}

/**
 * The light rig for a scene section: background kind, its two colours and the preset.
 * Procedural scenes have hand-tuned rigs; flat backgrounds derive theirs from their
 * colours; a transparent background gives the neutral studio rig.
 */
export function sceneRig(background: string, color1: string, color2: string, preset: string): LightRig {
  if (!background || background === 'none') return { ...NEUTRAL_RIG }
  if (background === 'scene') return { ...(SCENE_RIGS[preset] ?? SCENE_RIGS.sky) }
  const a = normalizeColor(color1, '#2b3a67')
  const b = background === 'solid' ? a : normalizeColor(color2, '#6b4a8b')
  const la = toLch(a)
  const lb = toLch(b)
  const avg = toLch(mix(a, b, 0.5))
  const light = la.l >= lb.l ? a : b
  const dark = la.l >= lb.l ? b : a
  const ll = toLch(light)
  const fill = fromLch({ l: clamp(avg.l, 0.38, 0.62), c: Math.min(0.14, Math.max(avg.c, 0.03)), h: avg.c > 0.02 ? avg.h : 270 })
  const rim = fromLch({ l: Math.max(0.86, ll.l), c: Math.min(0.12, ll.c * 0.8 + 0.02), h: ll.c > 0.02 ? ll.h : 250 })
  const key = mix(NEUTRAL_RIG.key, light, 0.14)
  const bounce = mix(NEUTRAL_RIG.bounce, dark, 0.4)
  // Near-grey backgrounds tint less; colourful ones more.
  const tint = lerp(0.2, background === 'pattern' ? 0.36 : 0.42, clamp(avg.c / 0.1, 0, 1))
  return { key, fill, rim, bounce, tint }
}

/* ---- Colour grading ----------------------------------------------------- */

export function gradeColor(hex: string, grade: Grade): string {
  if (grade === 'none') return hex
  const c = toLch(hex)
  switch (grade) {
    case 'vivid':
      return fromLch({ l: clamp(0.5 + (c.l - 0.5) * 1.08, 0, 1), c: c.c * 1.3, h: c.h })
    case 'pastel':
      return fromLch({ l: lerp(c.l, 0.9, 0.45), c: c.c * 0.55, h: c.h })
    case 'muted':
      return fromLch({ l: lerp(c.l, 0.55, 0.12), c: c.c * 0.5, h: c.h })
    case 'warm':
      return mix(fromLch({ ...c, h: c.c > 0.02 ? c.h + Math.sin(((60 - c.h) * Math.PI) / 180) * 8 : c.h }), '#ffb070', 0.08)
    case 'cool':
      return mix(fromLch({ ...c, h: c.c > 0.02 ? c.h + Math.sin(((240 - c.h) * Math.PI) / 180) * 8 : c.h }), '#7090ff', 0.08)
    case 'mono':
      return fromLch({ l: c.l, c: 0, h: 0 })
    case 'sepia':
      return fromLch({ l: lerp(c.l, 0.55, 0.05), c: 0.045, h: 70 })
    case 'noir':
      return fromLch({ l: clamp(0.5 + (c.l - 0.5) * 1.45, 0.04, 0.98), c: 0, h: 0 })
    case 'neon':
      return fromLch({ l: clamp(c.l, 0.5, 0.86), c: Math.min(0.32, c.c * 1.8 + 0.03), h: c.h })
  }
}

export function lightVector(light01: number): P {
  return norm([lerp(-0.85, 0.85, light01), -0.75])
}

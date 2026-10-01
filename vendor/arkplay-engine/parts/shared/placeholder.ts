/* Premium art lookup and its placeholders.
 *
 * `premiumArt(kind, id)` is how the part generators find the drawing of a premium item: the
 * registered premium art (not part of this package), else, for a premium id, a placeholder
 * drawn here. A build without it therefore shows premium items as a soft neutral silhouette in the item's own
 * place, with a small lock: something special is worn there, and the real look comes from
 * the avatar service (docs/studio.md).
 *
 * Placeholders are deterministic, cheap and resvg-safe: Painter shapes, fill-opacity and
 * stroke-opacity only (no group opacity, no filters, no randomness). */

import { lerp, type Box } from '../../core/math.ts'
import { circle, ellipse, f as fx, roundRect, smooth, type SP } from '../../core/path.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { isPremiumArt, registeredArt, type Layers, type PremiumArt, type PremiumArtKind } from '../../render/premiumArt.ts'
import type { Drawn } from './accHead.ts'
import { glint, tier } from './accMat.ts'
import type { BackFrame, HandFrame, HeadFrame } from './frames.ts'

/** The silhouette's colour: a cool, quiet grey that sits on any skin, outfit and scene. */
export const VEIL = '#a3abbf'
const INK = '#23222b'
const LOCK = '#f4f1ea'

/** A soft matte silhouette in the style's outline and shading. */
function veil(c: Ctx, d: string, shade = 0.3): string {
  return c.paint.shape(d, VEIL, { shade, outline: 0.7, material: 'cloth', spec: 0 })
}

/** A see-through silhouette (a helmet's glass, a glow): faint fill, outlined. */
function glassVeil(c: Ctx, d: string, width: number): string {
  const P = c.paint
  return P.flat(d, VEIL, 0.28) + P.line(d, VEIL, width, { opacity: 0.85 })
}

/**
 * A small padlock on a dark disc, and a glint in baked stills: "premium, drawn by ArkPlay".
 * Exported for the pet companion's placeholder.
 */
export function lockBadge(c: Ctx, x: number, y: number, r: number): string {
  if (!(r > 0.6)) return ''
  const P = c.paint
  const bw = r * 0.92
  const bh = r * 0.7
  const top = y - bh * 0.22
  const sr = r * 0.28
  const shackle = `M${fx(x - sr)} ${fx(top)}V${fx(y - r * 0.4)}A${fx(sr)} ${fx(sr)} 0 0 1 ${fx(x + sr)} ${fx(y - r * 0.4)}V${fx(top)}`
  let out = P.flat(circle(x, y, r), INK, 0.62)
  out += P.line(shackle, LOCK, r * 0.15)
  out += P.flat(roundRect(x - bw / 2, top, bw, bh, r * 0.14), LOCK)
  out += P.flat(circle(x, top + bh * 0.42, r * 0.1), INK, 0.85)
  if (tier(c) === 2) out += glint(c, x + r * 0.78, y - r * 0.78, r * 0.55, 0.9)
  return out
}

/* ---- Head --------------------------------------------------------------------------- */

function headwear(c: Ctx, id: string, _p: Reader, f: HeadFrame): Drawn {
  const hh = f.hh
  const lw = Math.max(c.paint.lw, hh * 0.008)
  const cx = f.cx
  const w = f.hw
  // How tall a hat of this family is above its band (the real art's proportions).
  const crownH = f.band - f.top + hh * 0.05
  switch (id) {
    case 'space-helm': {
      const r = Math.max(w * 1.45, (f.band - f.top) * 1.05 + hh * 0.35)
      const gy = f.band + hh * 0.2 - r * 0.35
      return { front: glassVeil(c, circle(cx, gy, r), lw * 1.2) + lockBadge(c, cx + r * 0.62, gy - r * 0.62, hh * 0.07) }
    }
    case 'wizard': {
      const h = crownH + hh * 0.75
      const cone = smooth([[cx - w * 0.95, f.band, 0.5], [cx - w * 0.45, f.band - h * 0.5], [cx - w * 0.3, f.band - h, 0], [cx + w * 0.1, f.band - h * 0.6], [cx + w * 0.95, f.band, 0.5]])
      const brim = ellipse(cx, f.band + hh * 0.03, w * 1.6, hh * 0.07)
      return { front: veil(c, brim) + veil(c, cone) + lockBadge(c, cx, f.band - h * 0.32, hh * 0.08) }
    }
    case 'crown':
    case 'tiara': {
      // A band with soft points: five alternating ones (crowns), three with a tall middle (tiaras).
      const tiara = id === 'tiara'
      const bw = w * (tiara ? 0.75 : 0.85)
      const base = tiara ? f.band + hh * 0.01 : f.top + hh * 0.22
      const tall = hh * (tiara ? 0.18 : 0.32)
      const n = tiara ? 3 : 5
      const pts: SP[] = [[cx - bw, base, 0]]
      for (let i = 0; i < n; i++) {
        const x = lerp(cx - bw * 0.88, cx + bw * 0.88, i / (n - 1))
        const peak = tiara ? (i === 1 ? tall : tall * 0.55) : i % 2 === 0 ? tall : tall * 0.7
        pts.push([x, base - peak])
        if (i < n - 1) pts.push([lerp(cx - bw * 0.88, cx + bw * 0.88, (i + 0.5) / (n - 1)), base - tall * 0.32])
      }
      pts.push([cx + bw, base, 0], [cx, base + hh * 0.03])
      return { front: veil(c, smooth(pts), 0.25) + lockBadge(c, cx, base - tall * 0.42, hh * 0.055) }
    }
    case 'knight-helm': {
      // A full helmet covers the head down to the chin: a rounded block over that area.
      const top = f.top - hh * 0.02
      const hw = w * 1.12
      const helm = roundRect(cx - hw, top, hw * 2, f.band + hh * 0.72 - top, hw * 0.7)
      let front = veil(c, helm)
      if (f.view !== 'back') front += c.paint.flat(roundRect(cx - hw * 0.62, f.band + hh * 0.13, hw * 1.24, hh * 0.05, hh * 0.02), INK, 0.7)
      return { front: front + lockBadge(c, cx, f.band - hh * 0.2, hh * 0.08) }
    }
    default: {
      // Helmets and hats (viking): a dome over the head down to the band.
      const h = crownH
      const dome = smooth([[cx - w * 1.05, f.band, 0.5], [cx - w * 1.03, f.band - h * 0.45], [cx - w * 0.74, f.band - h * 0.92], [cx, f.band - h], [cx + w * 0.74, f.band - h * 0.92], [cx + w * 1.03, f.band - h * 0.45], [cx + w * 1.05, f.band, 0.5], [cx, f.band + hh * 0.02]])
      return { front: veil(c, dome) + lockBadge(c, cx, f.band - h * 0.45, hh * 0.08) }
    }
  }
}

function headFeature(c: Ctx, _id: string, _p: Reader, f: HeadFrame): Drawn {
  // Halos: a quiet ring floating over the head.
  const hh = f.hh
  const cy = f.top - hh * 0.14
  const ring = ellipse(f.cx, cy, f.hw * 0.72, hh * 0.07)
  return { front: c.paint.line(ring, VEIL, hh * 0.045, { opacity: 0.9 }) + lockBadge(c, f.cx, cy, hh * 0.05) }
}

/* ---- Back and hands ------------------------------------------------------------------- */

function wing(c: Ctx, _id: string, p: Reader, span: number): string {
  const s = span * lerp(0.7, 1.35, p.has('size') ? p.n('size') : 0.5)
  const d = smooth([[0, s * 0.05, 0.5], [s * 0.32, -s * 0.5], [s * 0.8, -s * 0.86], [s * 1.1, -s * 0.7], [s * 0.92, -s * 0.28], [s * 0.58, s * 0.12], [s * 0.2, s * 0.2]])
  return veil(c, d, 0.25) + lockBadge(c, s * 0.58, -s * 0.38, s * 0.08)
}

function back(c: Ctx, _id: string, _p: Reader, f: BackFrame): Layers {
  const w = f.span
  const Ln = f.len
  const art = veil(c, roundRect(-w * 0.6, -Ln * 0.1, w * 1.2, Ln * 0.66, w * 0.25)) + lockBadge(c, 0, Ln * 0.22, w * 0.14)
  if (f.view === 'back') return { behind: '', front: art }
  // From the front only the straps show over the shoulders.
  const straps = f.view === 'side' ? '' : veil(c, roundRect(-w * 0.7, -Ln * 0.12, w * 0.14, Ln * 0.5, w * 0.07) + roundRect(w * 0.56, -Ln * 0.12, w * 0.14, Ln * 0.5, w * 0.07), 0.2)
  return { behind: art, front: straps }
}

/** Held items in item space: grip at the origin, reaching up (−y), `s` = hand length. */
function held(c: Ctx, id: string, _p: Reader, f: HandFrame): Layers {
  const s = f.s
  const rod = (y0: number, y1: number, w: number) => veil(c, roundRect(-w / 2, y1, w, y0 - y1, w / 2), 0.2)
  switch (id) {
    case 'sword':
      return { behind: rod(s * 0.55, -s * 4.3, s * 0.3), front: lockBadge(c, 0, -s * 2.4, s * 0.22) }
    case 'orb':
      return { behind: '', front: veil(c, circle(0, -s * 0.95, s * 0.5)) + lockBadge(c, 0, -s * 0.95, s * 0.22) }
    case 'trophy':
      // A cup-sized block on a stand.
      return { behind: '', front: veil(c, roundRect(-s * 0.4, -s * 0.6, s * 0.8, s * 0.8, s * 0.08)) + veil(c, roundRect(-s * 0.5, -s * 1.5, s * 1.0, s * 0.95, s * 0.35)) + lockBadge(c, 0, -s * 1.05, s * 0.22) }
    default: {
      // Staffs and wands: a shaft with a head.
      const wand = id === 'wand'
      const top = wand ? -s * 1.8 : -s * 4.3
      const hy = wand ? -s * 2.0 : -s * 4.6
      const hr = wand ? s * 0.26 : s * 0.38
      return { behind: rod(wand ? s * 0.35 : s * 2.7, top, wand ? s * 0.13 : s * 0.17), front: veil(c, circle(0, hy, hr)) + lockBadge(c, 0, hy, hr * 0.62) }
    }
  }
}

/* ---- Auras ------------------------------------------------------------------------------ */

/** Fixed spots (fractions of the aura's region) for the placeholder's still motes. */
const MOTES: readonly [number, number, number][] = [
  [0.12, 0.3, 1],
  [0.86, 0.42, 0.8],
  [0.2, 0.72, 0.7],
  [0.78, 0.78, 1],
  [0.5, 0.06, 0.6],
  [0.93, 0.18, 0.5],
]

function aura(c: Ctx, _id: string, _p: Reader, region: Box): Layers {
  const { x, y, w, h } = region
  const S = Math.min(w, h)
  const P = c.paint
  // A quiet neutral glow around the body and a few still motes: an effect is worn here.
  const behind = tier(c) > 0 ? P.glow(x + w / 2, y + h * 0.5, Math.max(w, h) * 0.6, VEIL, 0.42) : P.flat(ellipse(x + w / 2, y + h * 0.5, w * 0.5, h * 0.5), VEIL, 0.18)
  let motes = ''
  for (const [u, v, k] of MOTES) motes += circle(x + w * u, y + h * v, S * 0.012 * k)
  return { behind, front: P.flat(motes, VEIL, 0.85) + lockBadge(c, x + w * 0.84, y + h * 0.12, S * 0.035) }
}

type Placeholders = { readonly [K in Exclude<PremiumArtKind, 'companion'>]: PremiumArt[K] }

const PLACEHOLDERS: Placeholders = { headwear, headFeature, wing, back, held, aura }

/**
 * The drawing for art id `id` under hook `kind`: registered premium art, else a placeholder
 * when `id` is premium, else undefined (free art, drawn by the caller). The pet companion's
 * placeholder lives with its placement (parts/shared/companion.ts).
 */
export function premiumArt<K extends Exclude<PremiumArtKind, 'companion'>>(kind: K, id: string): PremiumArt[K] | undefined {
  return registeredArt(kind, id) ?? (isPremiumArt(id) ? (PLACEHOLDERS[kind] as PremiumArt[K]) : undefined)
}

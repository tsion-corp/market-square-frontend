/* Custom accessories: user art (PNG/SVG/WebP/JPEG) attached to an anchor, with position,
 * scale, rotation, mirroring, opacity and an optional tint that recolours single-colour
 * art while keeping its shading. The image is embedded as <image>, which browsers render
 * without running any script inside an SVG — uploaded SVGs are additionally sanitized
 * and rasterized by the avatar service before they are ever served.
 *
 * Baked stills integrate the art into the lit drawing: a soft contact shadow cast away
 * from the light and a thin rim light along the art's edges that face the light (both
 * derived from the art's own alpha, so they follow any silhouette). */

import { lerp } from '../../core/math.ts'
import { f } from '../../core/path.ts'
import { el, escapeXml } from '../../core/svg.ts'
import type { Ctx, ResolvedItem } from '../../render/context.ts'
import { lightOf, tier } from './accMat.ts'

/** Colour as an feColorMatrix row set that paints `hex` with alpha × `a`. */
function alphaTo(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  return `0 0 0 0 ${f(r)} 0 0 0 0 ${f(g)} 0 0 0 0 ${f(b)} 0 0 0 ${f(a)} 0`
}

/** `at` offsets the art in the caller's space (instead of wrapping it in a transform), which
 *  keeps the part's bounds exact for culling. */
export function drawCustom(c: Ctx, it: ResolvedItem, anchorScale: number, at: [number, number] = [0, 0]): string {
  const a = it.ref.asset
  if (!a) return ''
  const href = a.src ?? (a.id ? c.assetUrl?.(a.id) : undefined)
  if (!href) return ''
  const p = it.p
  const w = anchorScale * lerp(0.25, 3, p.has('scale') ? p.n('scale') : 0.5)
  const h = (w * a.h) / Math.max(1, a.w)
  const px = a.px ?? 0.5
  const py = a.py ?? 0.5
  const ox = at[0] + (p.n('x') - 0.5) * anchorScale * 2
  const oy = at[1] + (p.n('y') - 0.5) * anchorScale * 2
  const rot = (p.n('rotation') - 0.5) * 360
  const flip = p.b('flip') ? -1 : 1
  const opacity = p.has('opacity') ? p.n('opacity') : 1
  let filter: string | undefined
  const tint = p.c('tint', '')
  if (tint) {
    const col = c.paint.col(tint)
    const id = c.defs.add(`tint${col.slice(1)}`, (fid) =>
      el(
        'filter',
        { id: fid, 'color-interpolation-filters': 'sRGB' },
        el('feColorMatrix', { type: 'saturate', values: '0', result: 'g' }),
        el('feFlood', { 'flood-color': col, result: 'c' }),
        el('feBlend', { in: 'c', in2: 'g', mode: 'multiply', result: 'm' }),
        el('feComposite', { in: 'm', in2: 'SourceAlpha', operator: 'in' }),
      ),
    )
    filter = `url(#${id})`
  }
  let image = `<image href="${escapeXml(href)}" x="${f(-w * px)}" y="${f(-h * py)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMid meet"${opacity < 1 ? ` opacity="${f(opacity)}"` : ''}${filter ? ` filter="${filter}"` : ''}/>`

  // Baked: contact shadow + rim light, computed from the art's alpha in its own (rotated,
  // mirrored) space, so the world light direction is rotated back into it.
  const anchor = p.s('anchor') || 'head'
  if (tier(c) === 2 && anchor !== 'background' && opacity > 0.05) {
    const L = lightOf(c)
    const rad = (-rot * Math.PI) / 180
    const toLocal = (x: number, y: number): [number, number] => {
      const lx = x * Math.cos(rad) - y * Math.sin(rad)
      const ly = x * Math.sin(rad) + y * Math.cos(rad)
      return [lx * flip, ly]
    }
    const s = Math.min(w, h)
    const sh = toLocal(-L[0] * s * 0.045, -L[1] * s * 0.045 + s * 0.02)
    const rim = toLocal(-L[0] * s * 0.03, -L[1] * s * 0.03)
    const q = (v: number) => Math.round(v * 4) / 4
    const shadowCol = c.paint.col('#23182f')
    const rimCol = c.paint.col(c.paint.rig.rim)
    const key = `cst${q(sh[0])}_${q(sh[1])}_${q(rim[0])}_${q(rim[1])}_${q(s)}_${rimCol.slice(1)}`.replace(/[.-]/g, (m) => (m === '.' ? 'p' : 'm'))
    const id = c.defs.add(key, (fid) =>
      el(
        'filter',
        { id: fid, x: '-20%', y: '-20%', width: '140%', height: '140%', 'color-interpolation-filters': 'sRGB' },
        el('feColorMatrix', { in: 'SourceAlpha', type: 'matrix', values: alphaTo(shadowCol, 0.32), result: 'sa' }),
        el('feGaussianBlur', { in: 'sa', stdDeviation: f(Math.max(0.5, s * 0.035)), result: 'sb' }),
        el('feOffset', { in: 'sb', dx: f(sh[0]), dy: f(sh[1]), result: 'shadow' }),
        el('feOffset', { in: 'SourceAlpha', dx: f(rim[0]), dy: f(rim[1]), result: 'shift' }),
        el('feComposite', { in: 'SourceAlpha', in2: 'shift', operator: 'out', result: 'crescent' }),
        el('feColorMatrix', { in: 'crescent', type: 'matrix', values: alphaTo(rimCol, 0.5), result: 'rimc' }),
        el('feGaussianBlur', { in: 'rimc', stdDeviation: f(Math.max(0.3, s * 0.008)), result: 'rimb' }),
        el('feComposite', { in: 'rimb', in2: 'SourceAlpha', operator: 'in', result: 'rim' }),
        el('feComposite', { in: 'SourceGraphic', in2: 'shadow', operator: 'over', result: 'lit' }),
        el('feComposite', { in: 'rim', in2: 'lit', operator: 'over' }),
      ),
    )
    image = `<g filter="url(#${id})">${image}</g>`
  }
  // An invisible square around the pivot (covering any rotation) gives the part real bounds,
  // so the renderer can cull it when it is outside the crop.
  const R = Math.hypot(Math.max(px, 1 - px) * w, Math.max(py, 1 - py) * h)
  const bounds = `<path d="M${f(ox - R)} ${f(oy - R)}h${f(R * 2)}v${f(R * 2)}h${f(-R * 2)}Z" fill="none"/>`
  return `${bounds}<g transform="translate(${f(ox)} ${f(oy)}) rotate(${f(rot)}) scale(${flip} 1)">${image}</g>`
}

/* Eyewear, face accessories and ear accessories, drawn against an EyeFrame (and a
 * HeadFrame for ears and straps).
 *
 * Glasses are built like the real thing: a frame with a lit edge (frame shine), tinted
 * glass with sky reflections (accMat.lens), nose pads and hinges when there is room.
 * Jewellery is polished metal and cut gems; plastics get crisp speculars; fabric masks
 * get pleats and seams. Everything is tiered (flat / standard / baked). */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { lerp, type P } from '../../core/math.ts'
import { circle, ellipse, f as fx, heart, roundRect, smooth, star } from '../../core/path.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { bloom, castShadow, feather, gem, glint, halo, lens as glass, lightOf, litArc, litEdge, metal, metalPaint, sphere, spec, stitch, tier } from './accMat.ts'
import type { EyeFrame, HeadFrame } from './frames.ts'

function lens(kind: string, x: number, y: number, w: number): string {
  const r = w * 0.62
  switch (kind) {
    case 'round-glasses':
    case 'monocle':
    case 'goggles':
      return circle(x, y, r)
    case 'square-glasses':
    case '3d-glasses':
      return roundRect(x - r * 1.05, y - r * 0.78, r * 2.1, r * 1.56, r * 0.2)
    case 'cateye-glasses':
      return smooth([[x - r * 1.05, y - r * 0.55], [x + r * 1.2, y - r * 0.95, 0], [x + r * 1.05, y + r * 0.5], [x - r * 0.9, y + r * 0.75]])
    case 'half-rims':
      return roundRect(x - r * 1.05, y - r * 0.6, r * 2.1, r * 1.3, r * 0.35)
    case 'aviators':
      return smooth([[x - r * 1.1, y - r * 0.65], [x + r * 1.1, y - r * 0.7], [x + r * 0.9, y + r * 0.6], [x, y + r * 0.95], [x - r * 1.0, y + r * 0.4]])
    case 'heart-shades':
      return heart(x, y, r * 0.95)
    case 'star-shades':
      return star(x, y, r * 1.25, r * 0.6)
    default:
      return roundRect(x - r * 1.1, y - r * 0.7, r * 2.2, r * 1.35, r * 0.45)
  }
}

/** Mirror-images the cat-eye flick for the other eye (the lens shape is drawn for the right). */
function lensFor(kind: string, x: number, y: number, w: number, mirror: boolean): string {
  if (kind !== 'cateye-glasses' || !mirror) return lens(kind, x, y, w)
  const r = w * 0.62
  return smooth([[x + r * 1.05, y - r * 0.55], [x - r * 1.2, y - r * 0.95, 0], [x - r * 1.05, y + r * 0.5], [x + r * 0.9, y + r * 0.75]])
}

export function drawEyewear(c: Ctx, id: string, p: Reader, f: EyeFrame): string {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const frame = p.c('color', '#26252c')
  const tint = p.c('color2', '')
  const w = f.w * 1.05
  const lw = Math.max(P.lw * 1.1, f.hh * 0.018)
  const side = f.view === 'side'
  const ink = P.ink(frame)
  const hasInk = P.lw > 0
  /** A frame stroke: an ink underlay, the frame colour and (tiers 1–2) a thin highlight. */
  const rimLine = (d: string, width = lw, shine = true) => {
    if (!d) return ''
    let s = ''
    if (hasInk && t > 0) s += P.line(d, ink, width + P.lw * 0.9)
    s += P.line(d, frame, width)
    if (shine && t > 0) s += `<g transform="translate(${fx(L[0] * width * 0.22)} ${fx(L[1] * width * 0.22)})">${P.line(d, highlightOf(frame, 0.55), width * 0.3, { opacity: t === 2 ? 0.8 : 0.55 })}</g>`
    return s
  }
  if (f.view === 'back') {
    // Only the temples and strap show from behind.
    if (id === 'goggles' || id === 'visor-shades') return P.line(`M${fx(-f.faceHalf * 1.05)} ${fx(f.y)}H${fx(f.faceHalf * 1.05)}`, frame, f.hh * 0.06) + (t > 0 ? stitch(c, `M${fx(-f.faceHalf * 1.02)} ${fx(f.y - f.hh * 0.018)}H${fx(f.faceHalf * 1.02)}M${fx(-f.faceHalf * 1.02)} ${fx(f.y + f.hh * 0.018)}H${fx(f.faceHalf * 1.02)}`, frame, f.hh * 0.006, true) : '')
    return ''
  }
  if (id === 'visor-shades') {
    const x0 = side ? f.xs[0] - w * 0.5 : Math.min(...f.xs) - w * 0.95
    const x1 = side ? f.xs[0] + f.facing * w * 0.9 : Math.max(...f.xs) + w * 0.95
    const a = Math.min(x0, x1)
    const b = Math.max(x0, x1)
    const band = smooth([[a, f.y - w * 0.45], [b, f.y - w * 0.45], [b + w * 0.1, f.y + w * 0.1], [b, f.y + w * 0.4], [a, f.y + w * 0.4], [a - w * 0.1, f.y + w * 0.1]])
    const lensCol = tint || '#00e5ff'
    let out = ''
    // Housing, then the glowing glass inset and a scan line.
    out += P.shape(band, shadowOf(frame, 0.05), { gloss: false })
    const inset = smooth([[a + w * 0.12, f.y - w * 0.3], [b - w * 0.12, f.y - w * 0.3], [b - w * 0.04, f.y + w * 0.08], [b - w * 0.12, f.y + w * 0.26], [a + w * 0.12, f.y + w * 0.26], [a + w * 0.04, f.y + w * 0.08]])
    if (t === 2) out = bloom(c, P.flat(band, lensCol, 0.55), { x: a - w * 0.1, y: f.y - w * 0.45, w: b - a + w * 0.2, h: w * 0.85 }, w * 0.18) + out
    if (t === 0) out += P.flat(inset, lensCol)
    else {
      out += `<path d="${inset}" fill="${P.linear(`visor${lensCol.replace('#', '')}`, [[0, highlightOf(lensCol, 0.45)], [0.45, lensCol], [1, shadowOf(lensCol, 0.35)]], [0.5, 0], [0.5, 1])}"/>`
      const scan = `M${fx(a + w * 0.2)} ${fx(f.y - w * 0.02)}H${fx(b - w * 0.2)}`
      if (t === 2) out += bloom(c, P.line(scan, '#ffffff', w * 0.08), { x: a, y: f.y - w * 0.1, w: b - a, h: w * 0.2 }, w * 0.06)
      out += P.line(scan, mix(lensCol, '#ffffff', 0.7), w * 0.035, { opacity: 0.9 })
      out += glass(c, inset, '#ffffff', { alpha: 0.001 })
      out += spec(c, a + (b - a) * (L[0] < 0 ? 0.22 : 0.78), f.y - w * 0.18, w * 0.18, w * 0.035, 0.75, 0)
    }
    return out
  }
  if (id === 'goggles' && p.b('onHead')) {
    const y = f.y - f.hh * 0.28
    let out = P.line(`M${fx(-f.faceHalf * 1.08)} ${fx(y)}H${fx(f.faceHalf * 1.08)}`, frame, f.hh * 0.07)
    if (t > 0) out += stitch(c, `M${fx(-f.faceHalf * 1.05)} ${fx(y - f.hh * 0.022)}H${fx(f.faceHalf * 1.05)}M${fx(-f.faceHalf * 1.05)} ${fx(y + f.hh * 0.022)}H${fx(f.faceHalf * 1.05)}`, frame, f.hh * 0.006, true)
    for (const x of f.xs) out += gogglePiece(c, x, y, w * 0.6, frame, p.c('color2', '#80cbc4'))
    return out
  }
  let out = ''
  const solid = id === 'shades' || id === 'aviators' || id === 'heart-shades' || id === 'star-shades'
  const lensTint = solid ? p.c('color2', '#26252c') : tint || '#dff2ff'
  const clear = !solid && id !== '3d-glasses'
  const sorted = f.xs.slice().sort((a, b) => a - b)
  if (id === 'goggles') {
    // Leather strap behind the rims, stitched.
    if (!side && f.xs.length === 2) {
      out += P.line(`M${fx(-f.faceHalf * 1.08)} ${fx(f.y)}H${fx(f.faceHalf * 1.08)}`, frame, f.hh * 0.065)
      if (t > 0) out += stitch(c, `M${fx(-f.faceHalf * 1.05)} ${fx(f.y - f.hh * 0.02)}H${fx(sorted[0] - w * 0.7)}M${fx(sorted[1] + w * 0.7)} ${fx(f.y - f.hh * 0.02)}H${fx(f.faceHalf * 1.05)}`, frame, f.hh * 0.006, true)
    }
    for (const x of f.xs) out += gogglePiece(c, x, f.y, w * 0.62, frame, p.c('color2', '#80cbc4'))
    if (side) out += P.line(`M${fx(f.xs[0] - f.facing * w * 0.6)} ${fx(f.y)}L${fx(f.xs[0] - f.facing * f.faceHalf * 1.6)} ${fx(f.y)}`, frame, f.hh * 0.06)
    return out
  }
  f.xs.forEach((x, i) => {
    if (id === 'monocle' && i > 0) return
    const mirror = !side && x === sorted[0]
    const d = lensFor(id, x, f.y, w, mirror)
    if (id === '3d-glasses') {
      out += P.flat(d, x === sorted[0] ? '#e53935' : '#00b8d4', 0.6)
      if (t > 0) out += P.flat(roundRect(x - w * 0.5, f.y - w * 0.4, w * 0.45, w * 0.12, w * 0.06), '#ffffff', 0.45)
    } else out += glass(c, d, lensTint, { dark: solid, alpha: solid ? 0.94 : tint ? 0.3 : 0.12 })
    // Frame: full rim, or a brow bar only for half-rims.
    if (id === 'half-rims') {
      out += rimLine(`M${fx(x - w * 0.65)} ${fx(f.y - w * 0.37)}H${fx(x + w * 0.65)}`, lw * 1.2)
      if (t > 0) out += P.line(`M${fx(x - w * 0.62)} ${fx(f.y - w * 0.33)}Q${fx(x)} ${fx(f.y + w * 0.62)} ${fx(x + w * 0.62)} ${fx(f.y - w * 0.33)}`, '#c8d6e0', lw * 0.25, { opacity: 0.6 })
    } else if (id === 'round-glasses' || id === 'monocle') {
      const r = w * 0.62
      out += rimLine(d, id === 'monocle' ? lw * 1.1 : lw, false)
      if (t > 0) out += litArc(c, x, f.y, r, r, highlightOf(frame, 0.7), lw * 0.4, 1.4)
      if (id === 'monocle') out += t > 0 ? `<path d="${d}" fill="none" stroke="${metalPaint(c, frame, 'light') ?? frame}" stroke-width="${fx(lw * 0.7)}"/>` + litArc(c, x, f.y, r, r, '#ffffff', lw * 0.3, 1.1) : ''
    } else out += rimLine(d, id === 'aviators' ? lw * 0.8 : id === '3d-glasses' ? lw * 1.4 : lw)
    if (id === 'aviators' && t > 0) out += `<path d="${d}" fill="none" stroke="${metalPaint(c, frame, 'light') ?? frame}" stroke-width="${fx(lw * 0.5)}"/>`
  })
  if (side) {
    // Temple arm back to the ear.
    out += rimLine(`M${fx(f.xs[0] - f.facing * w * 0.6)} ${fx(f.y - w * 0.2)}L${fx(f.xs[0] - f.facing * f.faceHalf * 1.2)} ${fx(f.y - w * 0.05)}`, lw * 0.9)
    return out
  }
  if (f.xs.length === 2 && id !== 'monocle') {
    const [a, b] = sorted
    // Bridge (aviators get the double bar) and temples.
    const bridge = `M${fx(a + w * 0.55)} ${fx(f.y - w * 0.12)}Q${fx((a + b) / 2)} ${fx(f.y - w * 0.3)} ${fx(b - w * 0.55)} ${fx(f.y - w * 0.12)}`
    out += rimLine(bridge, lw * 0.9)
    if (id === 'aviators') out += rimLine(`M${fx(a + w * 0.5)} ${fx(f.y - w * 0.42)}H${fx(b - w * 0.5)}`, lw * 0.6)
    out += rimLine(`M${fx(a - w * 0.62)} ${fx(f.y - w * 0.15)}L${fx(-f.faceHalf * 1.02)} ${fx(f.y - w * 0.2)}M${fx(b + w * 0.62)} ${fx(f.y - w * 0.15)}L${fx(f.faceHalf * 1.02)} ${fx(f.y - w * 0.2)}`, lw * 0.9)
    if (t > 0 && P.detail > 1) {
      // Hinges and nose pads.
      out += P.flat(circle(a - w * 0.66, f.y - w * 0.15, lw * 0.7) + circle(b + w * 0.66, f.y - w * 0.15, lw * 0.7), highlightOf(frame, 0.35), 0.9)
      if (clear || id === 'aviators') out += P.shape(ellipse(a + w * 0.5, f.y + w * 0.12, w * 0.07, w * 0.11) + ellipse(b - w * 0.5, f.y + w * 0.12, w * 0.07, w * 0.11), '#e8f4fa', { shade: false, outline: 0.35 })
    }
  }
  if (id === 'monocle') {
    // A gold chain of small links looping down to the lapel.
    const chain = `M${fx(f.xs[0])} ${fx(f.y + w * 0.62)}Q${fx(f.xs[0] + w * 0.3)} ${fx(f.y + w * 1.6)} ${fx(f.xs[0] - w * 0.2)} ${fx(f.y + w * 2.4)}`
    out += P.line(chain, shadowOf(frame, 0.3), lw * 0.55)
    if (t > 0) out += P.line(chain, highlightOf(frame, 0.4), lw * 0.35, { dash: `${fx(lw * 0.6)} ${fx(lw * 0.5)}` })
  }
  return out
}

/** One goggle eyepiece: brass rim with rivets, a leather cup edge and glass. */
function gogglePiece(c: Ctx, x: number, y: number, r: number, strap: string, lensCol: string): string {
  const P = c.paint
  const t = tier(c)
  const brass = '#c89a3c'
  let out = P.shape(circle(x, y, r * 1.18), shadowOf(strap, 0.1))
  out += metal(c, circle(x, y, r), brass, { spec: 0.5 })
  out += glass(c, circle(x, y, r * 0.74), lensCol, { alpha: 0.75 })
  if (t > 0) {
    out += P.line(circle(x, y, r * 0.74), shadowOf(brass, 0.35), r * 0.06)
    if (P.detail > 1) out += [0, 1, 2, 3, 4, 5].map((i) => sphere(c, x + Math.cos(i * 1.047 + 0.5) * r * 0.87, y + Math.sin(i * 1.047 + 0.5) * r * 0.87, r * 0.06, brass, 'metal', { outline: false })).join('')
  }
  return out
}

export function drawFaceAcc(c: Ctx, id: string, p: Reader, f: EyeFrame): string {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', '#26252c')
  const hh = f.hh
  const lw = Math.max(P.lw, hh * 0.008)
  const side = f.view === 'side'
  if (f.view === 'back') return id === 'mask' || id === 'ninja-mask' || id === 'bandit-mask' || id === 'eyepatch' ? P.line(`M${fx(-f.faceHalf)} ${fx(id === 'eyepatch' || id === 'bandit-mask' ? f.y : f.mouthY)}H${fx(f.faceHalf)}`, col, hh * 0.03) + (id === 'bandit-mask' || id === 'ninja-mask' ? P.shape(circle(0, id === 'bandit-mask' ? f.y : f.mouthY, hh * 0.04), shadowOf(col, 0.1)) : '') : ''
  const pick = p.s('side') === 'right' ? 1 : 0
  const ex = f.xs[Math.min(pick, f.xs.length - 1)]
  switch (id) {
    case 'eyepatch': {
      const strap = `M${fx(ex - f.faceHalf * 1.2)} ${fx(f.y - hh * 0.2)}L${fx(ex + f.faceHalf * 1.2)} ${fx(f.y + hh * 0.12)}`
      const patch = t > 0 ? smooth([[ex - f.w * 0.64, f.y - f.w * 0.3], [ex, f.y - f.w * 0.55], [ex + f.w * 0.64, f.y - f.w * 0.32], [ex + f.w * 0.5, f.y + f.w * 0.35], [ex, f.y + f.w * 0.52], [ex - f.w * 0.52, f.y + f.w * 0.3]]) : ellipse(ex, f.y, f.w * 0.62, f.w * 0.5)
      let out = P.line(strap, col, hh * 0.018) + castShadow(c, ellipse(ex + hh * 0.008, f.y + hh * 0.012, f.w * 0.62, f.w * 0.5), 0.2) + P.shape(patch, col)
      if (t > 0) {
        out += stitch(c, smooth([[ex - f.w * 0.5, f.y - f.w * 0.22], [ex, f.y - f.w * 0.42], [ex + f.w * 0.5, f.y - f.w * 0.24], [ex + f.w * 0.38, f.y + f.w * 0.26], [ex, f.y + f.w * 0.4], [ex - f.w * 0.4, f.y + f.w * 0.22]]), col, lw * 0.3, true)
        out += litEdge(c, patch, highlightOf(col, 0.5), hh * 0.008, 0.6)
      }
      return out
    }
    case 'mask': {
      const top = f.noseY - hh * 0.07
      const d = side
        ? smooth([[f.xs[0] - f.faceHalf * 0.4, top], [f.xs[0] + f.faceHalf * 0.55, top + hh * 0.02], [f.xs[0] + f.faceHalf * 0.58, f.mouthY + hh * 0.08], [f.xs[0] - f.faceHalf * 0.3, f.mouthY + hh * 0.1]])
        : smooth([[-f.faceHalf * 0.82, top + hh * 0.02], [0, top - hh * 0.02], [f.faceHalf * 0.82, top + hh * 0.02], [f.faceHalf * 0.72, f.mouthY + hh * 0.08], [0, f.mouthY + hh * 0.14], [-f.faceHalf * 0.72, f.mouthY + hh * 0.08]])
      let out = castShadow(c, side ? '' : smooth([[-f.faceHalf * 0.72, f.mouthY + hh * 0.08], [0, f.mouthY + hh * 0.14], [f.faceHalf * 0.72, f.mouthY + hh * 0.08], [f.faceHalf * 0.6, f.mouthY + hh * 0.16], [0, f.mouthY + hh * 0.2], [-f.faceHalf * 0.6, f.mouthY + hh * 0.16]]), 0.22, [[0.5, 0], [0.5, 1]])
      out += P.shape(d, col, { shade: 0.5 })
      if (P.detail > 0 && !side) {
        // Three pleats, the nose wire and elastic ear loops.
        const pleats = [0.3, 0.55, 0.8].map((k) => {
          const y = lerp(top + hh * 0.03, f.mouthY + hh * 0.08, k)
          return `M${fx(-f.faceHalf * 0.74)} ${fx(y)}Q0 ${fx(y + hh * 0.025)} ${fx(f.faceHalf * 0.74)} ${fx(y)}`
        }).join('')
        out += P.line(pleats, shadowOf(col, 0.22), P.lw * 0.6, { opacity: 0.65 })
        if (t === 2) out += `<g transform="translate(0 ${fx(-hh * 0.008)})">${P.line(pleats, highlightOf(col, 0.4), P.lw * 0.4, { opacity: 0.5 })}</g>`
        if (t > 0) out += P.line(`M${fx(-f.faceHalf * 0.25)} ${fx(top + hh * 0.005)}Q0 ${fx(top - hh * 0.02)} ${fx(f.faceHalf * 0.25)} ${fx(top + hh * 0.005)}`, highlightOf(col, 0.55), P.lw * 0.8, { opacity: 0.8 })
        out += P.line(`M${fx(-f.faceHalf * 0.82)} ${fx(top + hh * 0.03)}L${fx(-f.faceHalf * 1.02)} ${fx(f.y)}M${fx(f.faceHalf * 0.82)} ${fx(top + hh * 0.03)}L${fx(f.faceHalf * 1.02)} ${fx(f.y)}M${fx(-f.faceHalf * 0.72)} ${fx(f.mouthY + hh * 0.06)}L${fx(-f.faceHalf * 0.98)} ${fx(f.y + hh * 0.06)}M${fx(f.faceHalf * 0.72)} ${fx(f.mouthY + hh * 0.06)}L${fx(f.faceHalf * 0.98)} ${fx(f.y + hh * 0.06)}`, '#f5f2eb', P.lw * 0.7)
      } else if (side && t > 0) out += P.line(`M${fx(f.xs[0] - f.faceHalf * 0.4)} ${fx(top + hh * 0.02)}L${fx(f.xs[0] - f.faceHalf * 0.85)} ${fx(f.y)}`, '#f5f2eb', P.lw * 0.7)
      return out
    }
    case 'ninja-mask': {
      const d = side
        ? smooth([[f.xs[0] - f.faceHalf * 1.2, f.noseY - hh * 0.1], [f.xs[0] + f.faceHalf * 0.62, f.noseY - hh * 0.08], [f.xs[0] + f.faceHalf * 0.6, f.mouthY + hh * 0.14], [f.xs[0] - f.faceHalf * 1.2, f.mouthY + hh * 0.2]])
        : smooth([[-f.faceHalf * 1.02, f.noseY - hh * 0.1], [f.faceHalf * 1.02, f.noseY - hh * 0.1], [f.faceHalf * 0.9, f.mouthY + hh * 0.12], [0, f.mouthY + hh * 0.2], [-f.faceHalf * 0.9, f.mouthY + hh * 0.12]])
      let out = P.shape(d, col)
      if (t > 0) {
        const fold = side
          ? `M${fx(f.xs[0] + f.faceHalf * 0.2)} ${fx(f.noseY)}Q${fx(f.xs[0] - f.faceHalf * 0.3)} ${fx(f.mouthY)} ${fx(f.xs[0] - f.faceHalf * 0.9)} ${fx(f.mouthY + hh * 0.08)}`
          : `M${fx(-f.faceHalf * 0.2)} ${fx(f.noseY + hh * 0.02)}Q${fx(-f.faceHalf * 0.5)} ${fx(f.mouthY)} ${fx(-f.faceHalf * 0.85)} ${fx(f.mouthY + hh * 0.06)}M${fx(f.faceHalf * 0.2)} ${fx(f.noseY + hh * 0.02)}Q${fx(f.faceHalf * 0.5)} ${fx(f.mouthY)} ${fx(f.faceHalf * 0.85)} ${fx(f.mouthY + hh * 0.06)}`
        out += P.line(fold, shadowOf(col, 0.3), P.lw * 0.7, { opacity: 0.7 })
        // The nose bridge lifts the cloth: a soft highlight down its ridge.
        if (!side) out += P.flat(smooth([[-hh * 0.015, f.noseY - hh * 0.09], [hh * 0.015, f.noseY - hh * 0.09], [hh * 0.03, f.noseY + hh * 0.03], [-hh * 0.03, f.noseY + hh * 0.03]]), highlightOf(col, 0.3), 0.5)
        out += litEdge(c, d, highlightOf(col, 0.45), hh * 0.008, 0.5)
      }
      return out
    }
    case 'bandit-mask': {
      const d = side ? roundRect(f.xs[0] - f.faceHalf * 1.1, f.y - hh * 0.07, f.faceHalf * 1.8, hh * 0.14, hh * 0.05) : roundRect(-f.faceHalf * 1.02, f.y - hh * 0.08, f.faceHalf * 2.04, hh * 0.15, hh * 0.06)
      // Eye holes cut with even-odd so the eyes show through.
      const holes = f.xs.map((x) => ellipse(x, f.y, f.w * 0.42, f.w * 0.3)).join('')
      let out = castShadow(c, side ? '' : roundRect(-f.faceHalf * 0.98, f.y + hh * 0.06, f.faceHalf * 1.96, hh * 0.03, hh * 0.015), 0.18)
      out += P.shape(d + holes, col, { attrs: { 'fill-rule': 'evenodd' }, shade: false })
      if (t > 0) {
        out += P.line(f.xs.map((x) => `M${fx(x - f.w * 0.4)} ${fx(f.y - f.w * 0.1)}Q${fx(x)} ${fx(f.y - f.w * 0.38)} ${fx(x + f.w * 0.4)} ${fx(f.y - f.w * 0.1)}`).join(''), highlightOf(col, 0.4), P.lw * 0.5, { opacity: 0.6 })
        out += litEdge(c, d, highlightOf(col, 0.45), hh * 0.008, 0.55)
      }
      if (!side) {
        // Knot and trailing tails at the side of the head.
        const kx = -f.faceHalf * 1.02
        out += P.shape(smooth([[kx, f.y - hh * 0.02], [kx - hh * 0.12, f.y + hh * 0.1], [kx - hh * 0.08, f.y + hh * 0.2, 0], [kx - hh * 0.03, f.y + hh * 0.08]]), col) + P.shape(smooth([[kx, f.y], [kx - hh * 0.05, f.y + hh * 0.12], [kx - hh * 0.01, f.y + hh * 0.22, 0], [kx + hh * 0.02, f.y + hh * 0.1]]), shadowOf(col, 0.1)) + P.shape(circle(kx, f.y, hh * 0.03), col)
      }
      return out
    }
    case 'masquerade': {
      let d = ''
      for (const x of f.xs) {
        const s = side ? 1 : x < 0 ? -1 : 1
        d += smooth([[x - s * f.w * 0.85, f.y + f.w * 0.1], [x - s * f.w * 0.3, f.y - f.w * 0.6], [x + s * f.w * 0.75, f.y - f.w * 0.45], [x + s * f.w * 0.95, f.y - f.w * 0.75, 0], [x + s * f.w * 0.9, f.y + f.w * 0.3], [x, f.y + f.w * 0.55]])
      }
      const holes = f.xs.map((x) => ellipse(x, f.y, f.w * 0.38, f.w * 0.26)).join('')
      let out = ''
      if (!side) {
        const fxr = f.xs.slice().sort((a, b) => b - a)[0]
        const root: P = [fxr + f.w * 0.75, f.y - f.w * 0.35]
        const fcol = p.c('color2', '#8e24aa')
        out += feather(c, root, [fxr + f.w * 1.5, f.y - f.w * 2.1], f.w * 0.55, shadowOf(fcol, 0.1), { curl: 0.12 })
        out += feather(c, root, [fxr + f.w * 1.05, f.y - f.w * 2.3], f.w * 0.6, fcol, { curl: -0.08 })
        out += feather(c, root, [fxr + f.w * 1.9, f.y - f.w * 1.4], f.w * 0.45, highlightOf(fcol, 0.1), { curl: 0.1 })
      }
      out += metal(c, d + holes, col, { attrs: { 'fill-rule': 'evenodd' }, spec: 0.4 })
      if (t > 0 && P.detail > 1) {
        // Filigree swirls around the eye holes.
        out += P.line(f.xs.map((x) => `M${fx(x - f.w * 0.5)} ${fx(f.y + f.w * 0.3)}q${fx(-f.w * 0.1)} ${fx(-f.w * 0.3)} ${fx(f.w * 0.05)} ${fx(-f.w * 0.55)}M${fx(x + f.w * 0.45)} ${fx(f.y - f.w * 0.42)}q${fx(f.w * 0.2)} ${fx(f.w * 0.05)} ${fx(f.w * 0.25)} ${fx(f.w * 0.3)}`).join(''), shadowOf(col, 0.35), P.lw * 0.45, { opacity: 0.8 })
      }
      if (!side && f.xs.length === 2) out += gem(c, 0, f.y - f.w * 0.35, f.w * 0.2, p.c('color2', '#8e24aa'), { cut: 'drop', ry: f.w * 0.22 })
      return out
    }
    case 'bandage': {
      const x = f.xs[Math.min(pick, f.xs.length - 1)] + (side ? 0 : (pick ? 1 : -1) * f.w * 0.3)
      const y = f.noseY
      const d = roundRect(x - hh * 0.07, y - hh * 0.03, hh * 0.14, hh * 0.06, hh * 0.022)
      let out = castShadow(c, roundRect(x - hh * 0.066, y - hh * 0.022, hh * 0.14, hh * 0.06, hh * 0.022), 0.14) + P.shape(d, col, { shade: 0.5 })
      out += P.shape(roundRect(x - hh * 0.028, y - hh * 0.024, hh * 0.056, hh * 0.048, hh * 0.01), mix(col, '#ffffff', 0.45), { shade: false, outline: 0.3 })
      if (P.detail > 0) out += P.flat([-0.05, -0.04, 0.04, 0.05].map((k, i) => circle(x + k * hh, y + (i % 2 ? 0.012 : -0.012) * hh, hh * 0.005)).join(''), shadowOf(col, 0.35))
      if (t === 2) out += litEdge(c, d, '#ffffff', hh * 0.006, 0.5)
      return out
    }
    case 'nose-ring': {
      const nx = side ? f.xs[0] + f.faceHalf * 0.5 : f.faceHalf * 0.08
      const r = hh * 0.022
      const d = `M${fx(nx)} ${fx(f.noseY + hh * 0.02)}a${fx(r)} ${fx(r)} 0 1 0 ${fx(hh * 0.02)} ${fx(hh * 0.02)}`
      return P.line(d, shadowOf(col, 0.35), hh * 0.012) + P.line(d, col, hh * 0.008) + (t > 0 ? glint(c, nx + hh * 0.006, f.noseY + hh * 0.05, hh * 0.012, 0.9) : '')
    }
    case 'nose-stud':
      return t > 0 ? gem(c, side ? f.xs[0] + f.faceHalf * 0.45 : f.faceHalf * 0.1, f.noseY, hh * 0.012, col, { outline: 0.3 }) : P.shape(circle(side ? f.xs[0] + f.faceHalf * 0.45 : f.faceHalf * 0.1, f.noseY, hh * 0.011), col, { outline: 0.3 })
    case 'lip-ring': {
      const d = `M${fx(side ? f.xs[0] + f.faceHalf * 0.4 : f.faceHalf * 0.12)} ${fx(f.mouthY + hh * 0.025)}a${fx(hh * 0.02)} ${fx(hh * 0.02)} 0 1 0 ${fx(hh * 0.02)} ${fx(hh * 0.015)}`
      return P.line(d, shadowOf(col, 0.35), hh * 0.012) + P.line(d, col, hh * 0.008) + (t > 0 ? P.line(d, highlightOf(col, 0.7), hh * 0.003, { opacity: 0.8 }) : '')
    }
    case 'brow-bar': {
      const a: P = [ex + f.w * 0.3, f.y - f.w * 0.75]
      const b: P = [ex + f.w * 0.42, f.y - f.w * 0.95]
      return P.line(`M${fx(a[0])} ${fx(a[1])}L${fx(b[0])} ${fx(b[1])}`, shadowOf(col, 0.3), hh * 0.006) + sphere(c, a[0], a[1], hh * 0.01, col, 'metal', { outline: 0.3 }) + sphere(c, b[0], b[1], hh * 0.01, col, 'metal', { outline: 0.3 })
    }
    case 'clown-nose':
      return castShadow(c, circle((side ? f.xs[0] + f.faceHalf * 0.55 : 0) - L[0] * hh * 0.02, f.noseY + hh * 0.03, hh * 0.058), 0.18) + sphere(c, side ? f.xs[0] + f.faceHalf * 0.55 : 0, f.noseY, hh * 0.06, col, 'gloss')
    case 'face-gems': {
      let out = ''
      for (const x of f.xs) {
        const s = side ? 1 : x < 0 ? -1 : 1
        out += gem(c, x + s * f.w * 0.35, f.y + f.w * 0.62, hh * 0.016, col, { sparkle: true }) + gem(c, x + s * f.w * 0.62, f.y + f.w * 0.38, hh * 0.01, col, { sparkle: false }) + gem(c, x + s * f.w * 0.15, f.y + f.w * 0.85, hh * 0.008, mix(col, '#ffffff', 0.3), { sparkle: false })
      }
      return out
    }
    case 'oxygen': {
      const d = side ? `M${fx(f.xs[0] + f.faceHalf * 0.45)} ${fx(f.noseY + hh * 0.04)}Q${fx(f.xs[0])} ${fx(f.noseY + hh * 0.06)} ${fx(f.xs[0] - f.faceHalf * 0.9)} ${fx(f.y)}` : `M${fx(-f.faceHalf * 0.1)} ${fx(f.noseY + hh * 0.03)}Q${fx(-f.faceHalf * 0.8)} ${fx(f.noseY + hh * 0.05)} ${fx(-f.faceHalf * 1.02)} ${fx(f.y)}M${fx(f.faceHalf * 0.1)} ${fx(f.noseY + hh * 0.03)}Q${fx(f.faceHalf * 0.8)} ${fx(f.noseY + hh * 0.05)} ${fx(f.faceHalf * 1.02)} ${fx(f.y)}`
      let out = P.line(d, shadowOf(col, 0.3), hh * 0.016) + P.line(d, col, hh * 0.011)
      if (t > 0) out += `<g transform="translate(${fx(L[0] * hh * 0.003)} ${fx(L[1] * hh * 0.003)})">${P.line(d, '#ffffff', hh * 0.003, { opacity: 0.8 })}</g>`
      return out
    }
  }
  return ''
}

/** Ear accessories. `under` goes under the hair (studs, aids), `over` on top (headphones). */
export function drawEarAcc(c: Ctx, id: string, p: Reader, h: HeadFrame): { under: string; over: string } {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', '#f2d14a')
  const col2 = p.c('color2', shadowOf(col, 0.3))
  const hh = h.hh
  const side = h.view === 'side'
  const ears = side ? [h.cx - h.facing * h.hw * 0.08] : [-h.earX, h.earX]
  const lobeY = h.earY + hh * 0.09
  const ox = (x: number, k = 0.02) => x + (side ? 0 : Math.sign(x) * hh * k)
  switch (id) {
    case 'studs':
      return { under: ears.map((x) => (t > 0 ? sphere(c, ox(x), lobeY, hh * 0.018, col, 'metal', { outline: 0.3 }) + (t === 2 ? glint(c, ox(x) + L[0] * hh * 0.008, lobeY + L[1] * hh * 0.008, hh * 0.018, 0.9) : '') : P.shape(circle(ox(x), lobeY, hh * 0.018), col, { outline: 0.3 }))).join(''), over: '' }
    case 'hoops': {
      const r = hh * lerp(0.035, 0.08, p.n('size'))
      const w = hh * 0.012
      let under = ''
      for (const x of ears) {
        const cx = ox(x)
        const d = circle(cx, lobeY + r, r)
        under += P.line(d, shadowOf(col, 0.35), w * 1.4)
        under += t > 0 ? `<path d="${d}" fill="none" stroke="${metalPaint(c, col, 'v')}" stroke-width="${fx(w)}"/>` + litArc(c, cx, lobeY + r, r, r, highlightOf(col, 0.7), w * 0.35, 1.3) : P.line(d, col, w)
        if (t === 2) under += glint(c, cx + L[0] * r, lobeY + r + L[1] * r, hh * 0.016, 0.9)
      }
      return { under, over: '' }
    }
    case 'drops':
      return {
        under: ears.map((x) => P.line(`M${fx(x)} ${fx(lobeY)}v${fx(hh * 0.06)}`, shadowOf(col, 0.2), hh * 0.008) + (t > 0 ? sphere(c, x, lobeY, hh * 0.012, col, 'metal', { outline: 0.3 }) + gem(c, x, lobeY + hh * 0.085, hh * 0.022, col2, { cut: 'drop', ry: hh * 0.026, outline: 0.4 }) : P.shape(heart(x, lobeY + hh * 0.08, hh * 0.022), col2, { outline: 0.3 }))).join(''),
        over: '',
      }
    case 'cuff': {
      const d = ears.map((x) => `M${fx(x + (side ? -hh * 0.03 : Math.sign(x) * hh * 0.03))} ${fx(h.earY - hh * 0.06)}a${fx(hh * 0.03)} ${fx(hh * 0.03)} 0 0 1 0 ${fx(hh * 0.06)}`).join('')
      return { under: P.line(d, shadowOf(col, 0.35), hh * 0.018) + P.line(d, col, hh * 0.012) + (t > 0 ? P.line(d, highlightOf(col, 0.7), hh * 0.004, { opacity: 0.9 }) : ''), over: '' }
    }
    case 'headphones': {
      const top = h.top - hh * 0.03
      const band = side ? `M${fx(ears[0] + h.hw * 0.1)} ${fx(h.earY - hh * 0.1)}Q${fx(ears[0] + h.hw * 0.3)} ${fx(top - hh * 0.05)} ${fx(ears[0] + h.hw * 0.45)} ${fx(top)}` : `M${fx(-h.earX - hh * 0.02)} ${fx(h.earY - hh * 0.05)}Q${fx(-h.hw * 1.05)} ${fx(top - hh * 0.05)} 0 ${fx(top - hh * 0.04)}Q${fx(h.hw * 1.05)} ${fx(top - hh * 0.05)} ${fx(h.earX + hh * 0.02)} ${fx(h.earY - hh * 0.05)}`
      let over = ''
      // Headband: ink edge, shell colour, a padded cushion strip and a sheen.
      if (P.lw > 0) over += P.line(band, P.ink(col), hh * 0.05 + P.lw * 1.4)
      over += P.line(band, col, hh * 0.05)
      if (t > 0) over += `<g transform="translate(${fx(L[0] * hh * 0.012)} ${fx(L[1] * hh * 0.012)})">${P.line(band, highlightOf(col, 0.45), hh * 0.012, { opacity: t === 2 ? 0.7 : 0.45 })}</g>`
      for (const x of ears) {
        const cx = x + (side ? 0 : Math.sign(x) * hh * 0.03)
        const cup = roundRect(cx - hh * 0.07, h.earY - hh * 0.1, hh * 0.14, hh * 0.2, hh * 0.06)
        // Slider joint.
        if (t > 0) over += P.shape(roundRect(cx - hh * 0.02, h.earY - hh * 0.16, hh * 0.04, hh * 0.08, hh * 0.015), '#b0b6be', { outline: 0.4, shade: 0.5 })
        over += castShadow(c, roundRect(cx - hh * 0.07 - L[0] * hh * 0.015, h.earY - hh * 0.08, hh * 0.14, hh * 0.2, hh * 0.06), 0.2)
        over += P.shape(cup, col)
        const plate = roundRect(cx - hh * 0.04, h.earY - hh * 0.06, hh * 0.08, hh * 0.12, hh * 0.04)
        over += P.shape(plate, col2, { outline: 0.4, shade: 0.6 })
        if (t > 0) {
          over += spec(c, cx + L[0] * hh * 0.03, h.earY - hh * 0.06, hh * 0.014, hh * 0.028, 0.75, 0)
          over += litEdge(c, cup, highlightOf(col, 0.5), hh * 0.01, 0.7)
          if (t === 2) over += halo(c, cx, h.earY, hh * 0.05, col2, 0.25)
        }
      }
      return { under: '', over }
    }
    case 'earbuds':
      return {
        under: '',
        over: ears.map((x) => P.line(`M${fx(x)} ${fx(h.earY + hh * 0.03)}v${fx(hh * 0.08)}`, shadowOf(col, 0.2), hh * 0.014) + P.line(`M${fx(x)} ${fx(h.earY + hh * 0.03)}v${fx(hh * 0.08)}`, col, hh * 0.01) + (t > 0 ? sphere(c, x, h.earY + hh * 0.01, hh * 0.026, col, 'gloss', { outline: 0.4 }) : P.shape(circle(x, h.earY + hh * 0.01, hh * 0.025), col, { outline: 0.4 }))).join(''),
      }
    case 'hearing-aid': {
      let over = ''
      for (const x of ears) {
        const s = side ? -1 : Math.sign(x)
        const body = smooth([[x + s * hh * 0.04, h.earY - hh * 0.09], [x + s * hh * 0.08, h.earY - hh * 0.07], [x + s * hh * 0.07, h.earY + hh * 0.02], [x + s * hh * 0.03, h.earY + hh * 0.04]])
        over += P.shape(body, col, { shade: 0.5 })
        if (t > 0) {
          over += P.line(`M${fx(x + s * hh * 0.04)} ${fx(h.earY - hh * 0.09)}Q${fx(x + s * hh * 0.01)} ${fx(h.earY - hh * 0.1)} ${fx(x)} ${fx(h.earY - hh * 0.03)}`, mix(col, '#ffffff', 0.4), hh * 0.008, { opacity: 0.9 })
          over += spec(c, x + s * hh * 0.06 + L[0] * hh * 0.005, h.earY - hh * 0.05, hh * 0.006, hh * 0.018, 0.7, 0)
        }
      }
      return { under: '', over }
    }
    case 'cochlear': {
      const x = side ? ears[0] - hh * 0.15 : -h.earX - hh * 0.08
      const cable = `M${fx(x)} ${fx(h.earY - hh * 0.07)}Q${fx(x + hh * 0.02)} ${fx(h.earY)} ${fx(ears[0])} ${fx(h.earY + hh * 0.02)}`
      let over = P.line(cable, shadowOf(col, 0.3), hh * 0.014) + P.line(cable, col, hh * 0.01)
      over += t > 0 ? sphere(c, x, h.earY - hh * 0.12, hh * 0.05, col, 'gloss') + P.line(circle(x, h.earY - hh * 0.12, hh * 0.032), shadowOf(col, 0.25), hh * 0.004, { opacity: 0.8 }) : P.shape(circle(x, h.earY - hh * 0.12, hh * 0.05), col)
      // The processor behind the ear.
      over += P.shape(smooth([[ears[0] + (side ? -hh * 0.05 : -hh * 0.04), h.earY - hh * 0.09], [ears[0] + (side ? -hh * 0.09 : -hh * 0.075), h.earY - hh * 0.06], [ears[0] + (side ? -hh * 0.08 : -hh * 0.07), h.earY + hh * 0.03], [ears[0] + (side ? -hh * 0.04 : -hh * 0.035), h.earY + hh * 0.04]]), col, { shade: 0.5 })
      return { under: '', over }
    }
  }
  return { under: '', over: '' }
}

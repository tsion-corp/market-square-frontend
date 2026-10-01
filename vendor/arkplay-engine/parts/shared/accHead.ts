/* Headwear, head features (animal ears, horns, halos) and hair accessories, drawn against
 * a HeadFrame. Front and back views share the frontal silhouette; profile views get a
 * dome with the brim/peak pointing the way the head faces.
 *
 * Materials come from accMat: felt, knit, straw-free fabric hats get seams, stitching and
 * a soft brim shadow on the head; horns have growth ridges, animal ears have inner fur. Rich
 * detail is tiered (flat / standard / baked) so animation frames stay cheap.
 *
 * Premium headwear and halos (crowns, tiaras, helmets, the wizard hat) are drawn by the
 * registered premium art (render/premiumArt.ts); `premiumArt` hands those ids to it, or
 * to a placeholder in builds without it (parts/shared/placeholder.ts). */

import { highlightOf, mix, shadowOf } from '../../core/color.ts'
import { lerp, TAU, type P } from '../../core/math.ts'
import { brush, capsule, circle, ellipse, f as fx, poly, roundRect, scallop, smooth, star, type SP } from '../../core/path.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { castShadow, feather, flower, folds, gem, glint, halo, leaf, lightOf, litEdge, metal, moving, sphere, spec, stitch, tier } from './accMat.ts'
import { drawGraphic, fabricPaint } from './fabric.ts'
import type { HeadFrame } from './frames.ts'
import { premiumArt } from './placeholder.ts'

export interface Drawn {
  /** Behind the head (drapes, hood backs, hijab). */
  back?: string
  /** Over hair. */
  front: string
  /** Under the hair cap (features that grow out of the hair). */
  under?: string
}

export function dome(f: HeadFrame, h: number, widen = 1, flat = 0): SP[] {
  const w = f.hw * widen
  return [
    [f.cx - w, f.band, 0.5],
    [f.cx - w * 0.99, f.band - h * 0.45],
    [f.cx - w * (0.72 + flat * 0.2), f.band - h * (0.9 + flat * 0.05)],
    [f.cx, f.band - h],
    [f.cx + w * (0.72 + flat * 0.2), f.band - h * (0.9 + flat * 0.05)],
    [f.cx + w * 0.99, f.band - h * 0.45],
    [f.cx + w, f.band, 0.5],
    [f.cx, f.band + f.hh * 0.02],
  ]
}

function brimFront(f: HeadFrame, W: number, depth: number, lift = 0): string {
  return smooth([
    [f.cx - W, f.band - lift, 0.4],
    [f.cx, f.band + depth],
    [f.cx + W, f.band - lift, 0.4],
    [f.cx + W * 0.6, f.band + depth * 0.25 - lift * 0.3],
    [f.cx, f.band + depth * 0.45],
    [f.cx - W * 0.6, f.band + depth * 0.25 - lift * 0.3],
  ])
}

function peakSide(f: HeadFrame, len: number, thick: number): string {
  const s = f.facing
  return smooth([
    [f.cx + s * f.hw * 0.6, f.band - thick],
    [f.cx + s * (f.hw + len), f.band + thick * 0.2, 0.5],
    [f.cx + s * (f.hw + len * 0.9), f.band + thick * 1.2, 0.5],
    [f.cx + s * f.hw * 0.6, f.band + thick * 0.6],
  ])
}

export const hatH = (f: HeadFrame, extra = 0.05) => f.band - f.top + f.hh * extra

/** Points around an ellipse (for fluffy scalloped outlines). */
function ring(cx: number, cy: number, rx: number, ry: number, n: number, a0 = 0): P[] {
  const out: P[] = []
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

/** A soft shadow the hat casts onto the head just below its band, as wide as the head. */
export function underShadow(c: Ctx, f: HeadFrame, depth: number, opacity = 0.26, widen = 1): string {
  if (depth <= 0) return ''
  const L = lightOf(c)
  const hh = f.hh
  const side = f.view === 'side'
  const w = f.hw * (side ? 0.9 : 0.93) * widen
  const cx = f.cx + (side ? f.facing * f.hw * 0.08 : 0) - L[0] * hh * 0.025
  const y = f.band - hh * 0.01
  const d = smooth([[cx - w, y, 0.5], [cx + w, y, 0.5], [cx + w * 0.93, y + depth * 0.62], [cx, y + depth], [cx - w * 0.93, y + depth * 0.62]])
  return castShadow(c, d, opacity, [[0.5, 0], [0.5, 1]])
}

/** A fluffy ball (pom-poms, santa bobbles): scalloped outline, fur strokes, lit tufts. */
function pompom(c: Ctx, x: number, y: number, r: number, col: string): string {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  let out = P.shape(t === 0 ? circle(x, y, r) : scallop(ring(x, y, r * 0.9, r * 0.9, 13, 0.2), 0.26), col, { shade: 0.9 })
  if (t > 0 && r > 3) {
    let d = ''
    for (let i = 0; i < 9; i++) {
      const a = i * 0.71 + 0.4
      d += `M${fx(x + Math.cos(a) * r * 0.2)} ${fx(y + Math.sin(a) * r * 0.2)}L${fx(x + Math.cos(a + 0.3) * r * 0.72)} ${fx(y + Math.sin(a + 0.3) * r * 0.72)}`
    }
    out += P.line(d, shadowOf(col, 0.22), r * 0.07, { opacity: 0.55 })
    if (t === 2) {
      let hl = ''
      for (let i = -1; i <= 1; i++) {
        const a = Math.atan2(L[1], L[0]) + i * 0.45
        hl += `M${fx(x + Math.cos(a) * r * 0.25)} ${fx(y + Math.sin(a) * r * 0.25)}L${fx(x + Math.cos(a + 0.2) * r * 0.7)} ${fx(y + Math.sin(a + 0.2) * r * 0.7)}`
      }
      out += P.line(hl, highlightOf(col, 0.5), r * 0.09, { opacity: 0.75 })
    }
  }
  return out
}

/** A fur trim band from x0 to x1 (santa hat cuff): puffy scalloped edges and fur strokes. */
function furBand(c: Ctx, x0: number, x1: number, y: number, h: number, col: string): string {
  const P = c.paint
  const t = tier(c)
  if (t === 0) return P.shape(roundRect(x0, y - h / 2, x1 - x0, h, h / 2), col)
  const n = Math.max(6, Math.round((x1 - x0) / h) * 2)
  const pts: P[] = []
  for (let i = 0; i <= n; i++) pts.push([lerp(x0 + h * 0.3, x1 - h * 0.3, i / n), y - h * 0.5 + (i % 2) * h * 0.06])
  pts.push([x1, y])
  for (let i = n; i >= 0; i--) pts.push([lerp(x0 + h * 0.3, x1 - h * 0.3, i / n), y + h * 0.5 - (i % 2) * h * 0.06])
  pts.push([x0, y])
  let out = P.shape(scallop(pts, 0.22), col, { shade: 0.9 })
  let d = ''
  for (let i = 0; i < n; i++) {
    const x = lerp(x0 + h * 0.5, x1 - h * 0.5, (i + 0.5) / n)
    d += `M${fx(x - h * 0.1)} ${fx(y + h * 0.25)}L${fx(x + h * 0.08)} ${fx(y - h * 0.15)}`
  }
  out += P.line(d, shadowOf(col, 0.2), h * 0.06, { opacity: 0.55 })
  if (t === 2) out += litEdge(c, scallop(pts, 0.22), highlightOf(col, 0.6), h * 0.12, 0.7)
  return out
}

/** Fabric sheen along the lit edge (felt/cotton low, satin/silk high). */
export const sheen = (c: Ctx, d: string, col: string, hh: number, strength = 0.4): string => litEdge(c, d, highlightOf(col, 0.4), Math.max(0.6, hh * 0.02), strength)

export function drawHeadwear(c: Ctx, id: string, p: Reader, f: HeadFrame): Drawn {
  const premium = premiumArt('headwear', id)
  if (premium) return premium(c, id, p, f)
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', '#888888')
  const col2 = p.c('color2', shadowOf(col, 0.3))
  const side = f.view === 'side'
  const back = f.view === 'back'
  const hh = f.hh
  const lw = Math.max(P.lw, hh * 0.008)
  const fine = t > 0 && P.detail > 1
  const paint = fabricPaint(c, p.s('pattern'), col, p.c('patternColor', '#f5f2eb'), hh * 0.12, id)
  switch (id) {
    case 'cap': {
      const h = hatH(f, 0.04)
      const crownD = smooth(dome(f, h, 1.04))
      const backwards = p.b('backwards')
      // Which way the peak points relative to the viewer.
      const peakToViewer = !side && back === backwards
      const openingToViewer = !side && !peakToViewer
      let front = ''
      if (peakToViewer) front += underShadow(c, f, hh * (back ? 0.1 : 0.2), 0.3, 1.02)
      front += P.shape(crownD, col)
      if (t > 0) {
        // Six-panel construction: seams curving from the button down to the band.
        const top = f.band - h
        let seams = `M${fx(f.cx)} ${fx(top)}V${fx(f.band)}`
        for (const s of [-1, 1]) seams += `M${fx(f.cx)} ${fx(top)}Q${fx(f.cx + s * f.hw * 0.52)} ${fx(top + h * 0.25)} ${fx(f.cx + s * f.hw * 0.66)} ${fx(f.band)}`
        front += P.line(seams, shadowOf(col, 0.28), lw * 0.6, { opacity: 0.7 })
        if (fine) {
          let st = ''
          for (const s of [-1, 1]) st += `M${fx(f.cx + s * hh * 0.018)} ${fx(top + h * 0.12)}V${fx(f.band - h * 0.06)}`
          front += stitch(c, st, col, lw * 0.35, true)
          if (!openingToViewer) front += P.flat([-1, 1].map((s) => circle(f.cx + s * f.hw * 0.42, top + h * 0.34, hh * 0.013)).join(''), shadowOf(col, 0.5), 0.9)
        }
        front += sheen(c, crownD, col, hh, 0.35)
      }
      if (openingToViewer) {
        // Snapback opening and strap.
        const w = f.hw * 0.24
        const hole = smooth([[f.cx - w, f.band + hh * 0.01, 0.2], [f.cx - w, f.band - hh * 0.09], [f.cx, f.band - hh * 0.16], [f.cx + w, f.band - hh * 0.09], [f.cx + w, f.band + hh * 0.01, 0.2]])
        front += P.shape(hole, shadowOf(col, 0.55), { shade: false, outline: 0.6 })
        front += P.shape(roundRect(f.cx - w * 1.1, f.band - hh * 0.035, w * 2.2, hh * 0.035, hh * 0.012), col2, { shade: 0.5, outline: 0.5 })
        if (t > 0) front += P.flat([-0.5, -0.1, 0.3].map((k) => circle(f.cx + k * w, f.band - hh * 0.018, hh * 0.006)).join(''), shadowOf(col2, 0.4))
      }
      if (side) {
        const pk = peakSide({ ...f, facing: backwards ? -f.facing : f.facing }, hh * 0.32, hh * 0.035)
        front += P.shape(pk, col2) + (t === 2 ? sheen(c, pk, col2, hh, 0.45) : '')
      } else if (peakToViewer) {
        const W = back ? f.hw * 1.02 : f.hw * 1.12
        const dep = back ? hh * 0.1 : hh * 0.13
        const brim = brimFront(f, W, dep, back ? hh * 0.02 : hh * 0.01)
        front += P.shape(brim, col2)
        if (fine) {
          let st = ''
          for (const k of [0.62, 0.8]) st += `M${fx(f.cx - W * k * 0.95)} ${fx(f.band + dep * 0.25 * k)}Q${fx(f.cx)} ${fx(f.band + dep * (0.45 + 0.55 * k) * 1.02)} ${fx(f.cx + W * k * 0.95)} ${fx(f.band + dep * 0.25 * k)}`
          front += stitch(c, st, col2, lw * 0.35, true)
        }
        front += sheen(c, brim, col2, hh, 0.5)
      }
      if (!side && !back && !backwards && p.s('graphic') !== 'none') front += drawGraphic(c, p.s('graphic'), f.cx, f.band - h * 0.45, f.hw * 0.7, p.c('graphicColor', '#f5f2eb'), p.s('text'))
      if (P.detail > 1) front += P.shape(ellipse(f.cx, f.band - h * 1.0, hh * 0.03, hh * 0.018), col, { outline: 0.5, shade: 0.6 })
      return { front }
    }
    case 'beanie': {
      const h = hatH(f, 0.06)
      const lowBand = { ...f, band: f.band + hh * 0.07 }
      const bodyD = smooth(dome(lowBand, h + hh * 0.07, 1.06))
      let front = underShadow(c, lowBand, hh * 0.06, 0.2)
      front += P.shape(bodyD, col, { paint })
      if (t > 0 && P.detail > 1 && !paint) {
        // Knit ribs following the dome.
        let ribs = ''
        for (const k of [-0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78]) ribs += `M${fx(f.cx + k * f.hw * 1.02)} ${fx(lowBand.band - hh * 0.1)}Q${fx(f.cx + k * f.hw * 0.95)} ${fx(lowBand.band - h * 0.75)} ${fx(f.cx + k * f.hw * 0.35)} ${fx(lowBand.band - h - hh * 0.03)}`
        front += P.line(ribs, shadowOf(col, 0.2), lw * 0.7, { opacity: 0.5 })
        if (t === 2) front += P.line(ribs, highlightOf(col, 0.25), lw * 0.35, { opacity: 0.35 })
      }
      const cuff = roundRect(f.cx - f.hw * 1.07, lowBand.band - hh * 0.1, f.hw * 2.14, hh * 0.13, hh * 0.05)
      front += P.shape(cuff, shadowOf(col, 0.06), { paint })
      if (P.detail > 1) front += P.line([-0.85, -0.68, -0.51, -0.34, -0.17, 0, 0.17, 0.34, 0.51, 0.68, 0.85].map((k) => `M${fx(f.cx + k * f.hw)} ${fx(lowBand.band - hh * 0.085)}v${fx(hh * 0.1)}`).join(''), shadowOf(col, 0.3), lw * 0.6, { opacity: 0.7 })
      front += sheen(c, bodyD, col, hh, 0.3)
      if (p.b('pompom')) front += pompom(c, f.cx, lowBand.band - h - hh * 0.1, hh * 0.11, col2)
      return { front }
    }
    case 'bucket': {
      const h = hatH(f, 0.04)
      const crownD = smooth(dome(f, h, 1.0, 0.3))
      const brim = side ? peakSide(f, hh * 0.18, hh * 0.05) + peakSide({ ...f, facing: -f.facing }, hh * 0.18, hh * 0.05) : brimFront(f, f.hw * 1.35, hh * 0.12, -hh * 0.05)
      let front = underShadow(c, f, hh * 0.16, 0.26, 1.02) + P.shape(crownD, col, { paint })
      if (t > 0) {
        front += P.line(`M${fx(f.cx - f.hw * 0.98)} ${fx(f.band - hh * 0.06)}Q${fx(f.cx)} ${fx(f.band - hh * 0.02)} ${fx(f.cx + f.hw * 0.98)} ${fx(f.band - hh * 0.06)}`, shadowOf(col, 0.3), lw * 0.7, { opacity: 0.7 })
        front += sheen(c, crownD, col, hh, 0.3)
      }
      front += P.shape(brim, col, { paint })
      if (fine && !side) {
        let st = ''
        for (const k of [0.55, 0.75, 0.92]) st += `M${fx(f.cx - f.hw * 1.3 * k)} ${fx(f.band - hh * 0.03 + hh * 0.08 * k)}Q${fx(f.cx)} ${fx(f.band + hh * 0.12 * (0.4 + 0.6 * k))} ${fx(f.cx + f.hw * 1.3 * k)} ${fx(f.band - hh * 0.03 + hh * 0.08 * k)}`
        front += stitch(c, st, col, lw * 0.35, true)
      }
      return { front }
    }
    case 'fedora':
    case 'cowboy-hat': {
      const cow = id === 'cowboy-hat'
      const h = hatH(f, 0.12)
      const crown: SP[] = [[f.cx - f.hw * 0.82, f.band, 0.5], [f.cx - f.hw * 0.78, f.band - h * 0.8], [f.cx - f.hw * 0.4, f.band - h], [f.cx, f.band - h * 0.88, 0.5], [f.cx + f.hw * 0.4, f.band - h], [f.cx + f.hw * 0.78, f.band - h * 0.8], [f.cx + f.hw * 0.82, f.band, 0.5]]
      const crownD = smooth(crown)
      const W = f.hw * (cow ? 1.9 : 1.55)
      const curl = cow ? hh * 0.14 : hh * 0.02
      const brim = side
        ? smooth([[f.cx - W * 0.85, f.band - (cow ? hh * 0.08 : 0)], [f.cx, f.band + hh * 0.03], [f.cx + W * 0.85, f.band - (cow ? hh * 0.08 : 0)], [f.cx, f.band + hh * 0.08]])
        : smooth([[f.cx - W, f.band - curl, 0.4], [f.cx - W * 0.6, f.band + hh * 0.04], [f.cx, f.band + hh * 0.07], [f.cx + W * 0.6, f.band + hh * 0.04], [f.cx + W, f.band - curl, 0.4], [f.cx + W * 0.5, f.band + hh * 0.1], [f.cx, f.band + hh * 0.13], [f.cx - W * 0.5, f.band + hh * 0.1]])
      let front = underShadow(c, f, hh * (cow ? 0.26 : 0.22), 0.3, 1.02)
      front += P.shape(brim, col)
      if (t > 0 && !side) {
        // The top of the brim behind the crown catches the light; the rolled edge is darker.
        front += P.flat(smooth([[f.cx - W * 0.92, f.band - curl * 0.85], [f.cx - W * 0.5, f.band + hh * 0.035], [f.cx, f.band + hh * 0.05], [f.cx + W * 0.5, f.band + hh * 0.035], [f.cx + W * 0.92, f.band - curl * 0.85], [f.cx + W * 0.5, f.band + hh * 0.015], [f.cx, f.band + hh * 0.02], [f.cx - W * 0.5, f.band + hh * 0.015]]), highlightOf(col, 0.22), 0.6)
        if (fine && cow) front += stitch(c, `M${fx(f.cx - W * 0.9)} ${fx(f.band - curl * 0.7)}Q${fx(f.cx - W * 0.45)} ${fx(f.band + hh * 0.09)} ${fx(f.cx)} ${fx(f.band + hh * 0.105)}Q${fx(f.cx + W * 0.45)} ${fx(f.band + hh * 0.09)} ${fx(f.cx + W * 0.9)} ${fx(f.band - curl * 0.7)}`, col, lw * 0.35, true)
      }
      front += P.shape(crownD, col)
      if (t > 0) {
        // Centre dent and the two front pinches.
        const dent = `M${fx(f.cx)} ${fx(f.band - h * 0.88)}Q${fx(f.cx + hh * 0.01)} ${fx(f.band - h * 0.6)} ${fx(f.cx)} ${fx(f.band - h * 0.36)}`
        const pinch = [-1, 1].map((s) => `M${fx(f.cx + s * f.hw * 0.42)} ${fx(f.band - h * 0.9)}Q${fx(f.cx + s * f.hw * 0.5)} ${fx(f.band - h * 0.65)} ${fx(f.cx + s * f.hw * 0.62)} ${fx(f.band - h * 0.42)}`).join('')
        front += side ? '' : folds(c, dent + pinch, col, lw * 0.7)
        front += sheen(c, crownD, col, hh, 0.35)
      }
      const band = roundRect(f.cx - f.hw * 0.82, f.band - h * 0.28, f.hw * 1.64, h * 0.2, 2)
      front += P.shape(band, col2)
      if (t > 0 && !back) {
        const bx = side ? f.cx - f.facing * f.hw * 0.55 : f.cx + f.hw * 0.58
        const by = f.band - h * 0.18
        if (cow) front += metal(c, circle(bx, by, h * 0.11), '#c9ccd3', { outline: 0.5 }) + (t === 2 ? P.line(star(bx, by, h * 0.07, h * 0.03, 6), shadowOf('#c9ccd3', 0.3), lw * 0.3) : '')
        else front += P.shape(smooth([[bx - h * 0.02, by - h * 0.08], [bx + h * 0.12, by - h * 0.1], [bx + h * 0.06, by], [bx + h * 0.12, by + h * 0.1], [bx - h * 0.02, by + h * 0.08]]), shadowOf(col2, 0.1), { outline: 0.6 })
        if (fine) front += P.line(`M${fx(f.cx - f.hw * 0.82)} ${fx(f.band - h * 0.26)}H${fx(f.cx + f.hw * 0.82)}`, highlightOf(col2, 0.3), lw * 0.35, { opacity: 0.6 })
      }
      return { front }
    }
    case 'tophat': {
      const h = hatH(f, 0.06) + hh * 0.35
      const brim = smooth([[f.cx - f.hw * 1.35, f.band + hh * 0.02], [f.cx, f.band + hh * 0.08], [f.cx + f.hw * 1.35, f.band + hh * 0.02], [f.cx, f.band - hh * 0.02]])
      const tube0 = smooth([[f.cx - f.hw * 0.78, f.band, 0.3], [f.cx - f.hw * 0.72, f.band - h * 0.55], [f.cx - f.hw * 0.8, f.band - h, 0.3], [f.cx + f.hw * 0.8, f.band - h, 0.3], [f.cx + f.hw * 0.72, f.band - h * 0.55], [f.cx + f.hw * 0.78, f.band, 0.3]])
      let front = underShadow(c, f, hh * 0.18, 0.3) + P.shape(brim, col) + P.shape(tube0, col)
      if (t > 0) {
        // Silk: a long vertical satin streak on the lit side and a softer one opposite.
        const sx = f.cx + (L[0] < 0 ? -1 : 1) * f.hw * 0.42
        front += P.flat(smooth([[sx - hh * 0.03, f.band - h * 0.95], [sx + hh * 0.02, f.band - h * 0.95], [sx + hh * 0.015, f.band - h * 0.35], [sx - hh * 0.025, f.band - h * 0.35]]), highlightOf(col, 0.5), t === 2 ? 0.55 : 0.35)
        if (t === 2) front += P.flat(smooth([[f.cx - (sx - f.cx) * 0.9 - hh * 0.01, f.band - h * 0.9], [f.cx - (sx - f.cx) * 0.9 + hh * 0.01, f.band - h * 0.9], [f.cx - (sx - f.cx) * 0.9 + hh * 0.008, f.band - h * 0.4], [f.cx - (sx - f.cx) * 0.9 - hh * 0.01, f.band - h * 0.4]]), highlightOf(col, 0.3), 0.3)
        front += P.flat(ellipse(f.cx, f.band - h + hh * 0.01, f.hw * 0.78, hh * 0.035), highlightOf(col, 0.25), 0.6)
      }
      const bandD = roundRect(f.cx - f.hw * 0.765, f.band - h * 0.3, f.hw * 1.53, h * 0.14, 1)
      front += P.shape(bandD, col2) + (t === 2 ? sheen(c, bandD, col2, hh, 0.5) : '')
      return { front }
    }
    case 'witch': {
      const h = hatH(f, 0.06) + hh * 0.75
      const droop = (p.n('droop') || 0.5) * f.hw * 0.9 * 1.2
      const tip: P = [f.cx - droop, f.band - h]
      const cone = smooth([[f.cx - f.hw * 0.95, f.band, 0.5], [f.cx - f.hw * 0.5, f.band - h * 0.5], [tip[0] - hh * 0.02, tip[1], 0], [f.cx + f.hw * 0.05, f.band - h * 0.62], [f.cx + f.hw * 0.95, f.band, 0.5]])
      const W = f.hw * 1.7
      const brim = smooth([[f.cx - W, f.band + hh * 0.0, 0.3], [f.cx - W * 0.55, f.band + hh * 0.1], [f.cx, f.band + hh * 0.1], [f.cx + W * 0.55, f.band + hh * 0.1], [f.cx + W, f.band - hh * 0.05, 0.3], [f.cx + W * 0.5, f.band - hh * 0.02], [f.cx, f.band - hh * 0.03], [f.cx - W * 0.5, f.band - hh * 0.02]])
      let front = underShadow(c, f, hh * 0.2, 0.3) + P.shape(brim, col) + P.shape(cone, col)
      if (t > 0) {
        // Crumpled cloth: creases where the cone bends.
        const bendY = f.band - h * 0.55
        front += folds(c, `M${fx(f.cx - f.hw * 0.45)} ${fx(bendY + hh * 0.05)}Q${fx(f.cx - f.hw * 0.1)} ${fx(bendY - hh * 0.02)} ${fx(f.cx + f.hw * 0.12)} ${fx(bendY + hh * 0.08)}M${fx(f.cx - f.hw * 0.6)} ${fx(f.band - h * 0.2)}Q${fx(f.cx - f.hw * 0.4)} ${fx(f.band - h * 0.3)} ${fx(f.cx - f.hw * 0.25)} ${fx(f.band - h * 0.22)}`, col, lw * 0.7)
        front += sheen(c, cone, col, hh, 0.35)
      }
      const bandD = smooth([[f.cx - f.hw * 0.92, f.band - hh * 0.04], [f.cx, f.band - hh * 0.06], [f.cx + f.hw * 0.92, f.band - hh * 0.04], [f.cx + f.hw * 0.9, f.band - hh * 0.13], [f.cx, f.band - hh * 0.15], [f.cx - f.hw * 0.9, f.band - hh * 0.13]])
      front += P.shape(bandD, col2)
      const bx = f.cx + (side ? f.facing * f.hw * 0.3 : 0)
      const buckle = roundRect(bx - hh * 0.06, f.band - hh * 0.15, hh * 0.12, hh * 0.11, hh * 0.015)
      front += metal(c, buckle, '#f2d14a', { outline: 0.6, spec: 0.5 }) + P.shape(roundRect(bx - hh * 0.03, f.band - hh * 0.125, hh * 0.06, hh * 0.055, hh * 0.008), col2, { shade: false, outline: 0.4 })
      return { front }
    }
    case 'beret': {
      const cx = f.cx + f.facing * (side ? 0 : f.hw * 0.15)
      const body = smooth([[cx - f.hw * 1.2, f.band - hh * 0.05], [cx - f.hw * 0.6, f.top - hh * 0.04], [cx + f.hw * 0.8, f.top - hh * 0.02], [cx + f.hw * 1.2, f.band - hh * 0.1], [cx, f.band - hh * 0.02]])
      let front = underShadow(c, f, hh * 0.08, 0.2) + P.shape(body, col)
      if (t > 0) {
        front += P.line(`M${fx(cx - f.hw * 1.02)} ${fx(f.band - hh * 0.06)}Q${fx(cx)} ${fx(f.band - hh * 0.0)} ${fx(cx + f.hw * 1.05)} ${fx(f.band - hh * 0.11)}`, shadowOf(col, 0.3), lw * 0.8, { opacity: 0.7 })
        front += folds(c, `M${fx(cx + f.hw * 0.2)} ${fx(f.top + hh * 0.03)}Q${fx(cx + f.hw * 0.6)} ${fx(f.top + hh * 0.06)} ${fx(cx + f.hw * 0.95)} ${fx(f.band - hh * 0.14)}`, col, lw * 0.6)
        front += sheen(c, body, col, hh, 0.3)
      }
      front += P.shape(capsule([cx, f.top - hh * 0.02], [cx + hh * 0.03, f.top - hh * 0.09], hh * 0.02, hh * 0.015), col)
      return { front }
    }
    case 'hood': {
      const w = f.hw * 1.22
      const top = f.top - hh * 0.06
      const lining = p.c('color2', shadowOf(col, 0.4))
      const shape = smooth([[f.cx - w * 1.05, f.band + hh * 0.95], [f.cx - w * 1.05, f.band], [f.cx - w * 0.6, top + hh * 0.05], [f.cx + f.facing * hh * 0.08, top - hh * 0.12, 0.2], [f.cx + w * 0.6, top + hh * 0.05], [f.cx + w * 1.05, f.band], [f.cx + w * 1.05, f.band + hh * 0.95]])
      const drape = (d: string, fold = `M${fx(f.cx - w * 0.75)} ${fx(top + hh * 0.2)}Q${fx(f.cx - w * 0.95)} ${fx(f.band + hh * 0.2)} ${fx(f.cx - w * 0.9)} ${fx(f.band + hh * 0.8)}M${fx(f.cx + w * 0.75)} ${fx(top + hh * 0.2)}Q${fx(f.cx + w * 0.95)} ${fx(f.band + hh * 0.2)} ${fx(f.cx + w * 0.9)} ${fx(f.band + hh * 0.8)}`) => {
        let s = P.shape(d, col)
        if (t > 0) {
          s += folds(c, fold, col, lw * 0.8)
          s += sheen(c, d, col, hh, 0.3)
        }
        return s
      }
      if (back) {
        let s = drape(shape)
        if (t > 0) s += P.line(`M${fx(f.cx)} ${fx(top - hh * 0.08)}V${fx(f.band + hh * 0.9)}`, shadowOf(col, 0.3), lw * 0.7, { opacity: 0.7 })
        return { front: s }
      }
      if (side) {
        // Profile: the hood's front edge frames the face; the lining shows along it.
        const k = f.facing
        const edge: SP[] = [[f.cx + k * f.hw * 0.12, f.band + hh * 0.85], [f.cx + k * f.hw * 0.3, f.band + hh * 0.3], [f.cx + k * f.hw * 0.42, f.band - hh * 0.12], [f.cx + k * f.hw * 0.5, top + hh * 0.02]]
        const prof = smooth([...edge, [f.cx + k * f.hw * 0.05, top - hh * 0.08], [f.cx - k * f.hw * 0.75, top + hh * 0.02], [f.cx - k * w * 1.02, f.band - hh * 0.05], [f.cx - k * w * 1.02, f.band + hh * 0.95], [f.cx - k * f.hw * 0.2, f.band + hh * 1.0]])
        let s = castShadow(c, smooth([[f.cx + k * f.hw * 0.42, f.band - hh * 0.14], [f.cx + k * f.hw * 0.8, f.band - hh * 0.08], [f.cx + k * f.hw * 0.75, f.band + hh * 0.2], [f.cx + k * f.hw * 0.32, f.band + hh * 0.25]]), 0.3, [[k > 0 ? 0 : 1, 0.5], [k > 0 ? 1 : 0, 0.5]])
        s += drape(prof, `M${fx(f.cx - k * f.hw * 0.2)} ${fx(top + hh * 0.15)}Q${fx(f.cx - k * f.hw * 0.4)} ${fx(f.band + hh * 0.3)} ${fx(f.cx - k * f.hw * 0.3)} ${fx(f.band + hh * 0.9)}M${fx(f.cx - k * w * 0.8)} ${fx(f.band)}Q${fx(f.cx - k * w * 0.85)} ${fx(f.band + hh * 0.5)} ${fx(f.cx - k * w * 0.75)} ${fx(f.band + hh * 0.9)}`)
        if (t > 0) s += P.line(`M${edge.map((q) => `${fx(q[0] - k * lw * 0.9)} ${fx(q[1])}`).join('L')}`, lining, lw * 1.6, { opacity: 0.9 })
        return { front: s }
      }
      const opening = smooth([[f.cx - f.hw * 0.82, f.band + hh * 0.75], [f.cx - f.hw * 0.9, f.band - hh * 0.05], [f.cx, f.band - hh * 0.2], [f.cx + f.hw * 0.9, f.band - hh * 0.05], [f.cx + f.hw * 0.82, f.band + hh * 0.75]])
      let backArt = drape(shape)
      // The inside of the hood: lining that darkens toward the back.
      backArt += t > 0 ? `<path d="${opening}" fill="${P.linear(`hood${lining.replace('#', '')}`, [[0, shadowOf(lining, 0.35)], [0.55, lining], [1, shadowOf(lining, 0.2)]], [0.5, 0], [0.5, 1])}"/>` : P.flat(opening, lining)
      const rim = smooth([[f.cx - w * 1.05, f.band + hh * 0.2], [f.cx - w * 0.6, top + hh * 0.05], [f.cx, top - hh * 0.1], [f.cx + w * 0.6, top + hh * 0.05], [f.cx + w * 1.05, f.band + hh * 0.2], [f.cx + f.hw * 0.95, f.band + hh * 0.02], [f.cx, f.band - hh * 0.18], [f.cx - f.hw * 0.95, f.band + hh * 0.02]])
      let front = castShadow(c, smooth([[f.cx - f.hw * 0.93, f.band + hh * 0.0], [f.cx, f.band - hh * 0.2], [f.cx + f.hw * 0.93, f.band + hh * 0.0], [f.cx + f.hw * 0.8, f.band + hh * 0.2], [f.cx, f.band + hh * 0.02], [f.cx - f.hw * 0.8, f.band + hh * 0.2]]), 0.34, [[0.5, 0.3], [0.5, 1]])
      front += P.shape(rim, col)
      if (t > 0) {
        // Rolled lining edge along the opening, and the centre seam.
        front += P.line(`M${fx(f.cx - f.hw * 0.95)} ${fx(f.band + hh * 0.03)}Q${fx(f.cx)} ${fx(f.band - hh * 0.31)} ${fx(f.cx + f.hw * 0.95)} ${fx(f.band + hh * 0.03)}`, lining, lw * 1.4, { opacity: 0.9 })
        front += P.line(`M${fx(f.cx)} ${fx(top - hh * 0.09)}V${fx(f.band - hh * 0.2)}`, shadowOf(col, 0.3), lw * 0.7, { opacity: 0.7 })
        front += sheen(c, rim, col, hh, 0.35)
      }
      return { back: backArt, front }
    }
    case 'headband':
    case 'visor': {
      const bandD = roundRect(f.cx - f.hw * 1.02, f.band - hh * 0.05, f.hw * 2.04, hh * 0.1, hh * 0.04)
      let front = P.shape(bandD, col)
      if (id === 'headband' && P.detail > 0) {
        front += P.flat(roundRect(f.cx - f.hw * 1.02, f.band - hh * 0.012, f.hw * 2.04, hh * 0.024, 2), col2)
        // Terry-cloth texture.
        if (fine) front += P.line([-0.9, -0.75, -0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((k) => `M${fx(f.cx + k * f.hw)} ${fx(f.band - hh * 0.04)}v${fx(hh * 0.022)}M${fx(f.cx + (k + 0.07) * f.hw)} ${fx(f.band + hh * 0.018)}v${fx(hh * 0.022)}`).join(''), shadowOf(col, 0.2), lw * 0.45, { opacity: 0.6 })
      }
      if (id === 'visor') {
        if (fine) front += stitch(c, `M${fx(f.cx - f.hw)} ${fx(f.band - hh * 0.035)}H${fx(f.cx + f.hw)}M${fx(f.cx - f.hw)} ${fx(f.band + hh * 0.035)}H${fx(f.cx + f.hw)}`, col, lw * 0.3)
        if (side) front += P.shape(peakSide(f, hh * 0.3, hh * 0.03), col2)
        else if (!back) {
          const brim = brimFront(f, f.hw * 1.12, hh * 0.13, -hh * 0.03)
          front = underShadow(c, f, hh * 0.16, 0.28) + front + P.shape(brim, col2)
          // Tinted plastic: a crisp specular along the brim.
          if (t > 0) front += spec(c, f.cx + (L[0] < 0 ? -1 : 1) * f.hw * 0.5, f.band + hh * 0.07, f.hw * 0.22, hh * 0.012, 0.7, (L[0] < 0 ? 1 : -1) * 8)
        }
      }
      front += sheen(c, bandD, col, hh, 0.3)
      return { front }
    }
    case 'bandana':
    case 'durag': {
      const durag = id === 'durag'
      const h = hatH(f, 0.02)
      const capD = smooth(dome({ ...f, band: f.band + hh * 0.02 }, h + hh * 0.02, 1.04, 0.1))
      let front = underShadow(c, f, hh * 0.05, 0.18) + P.shape(capD, col, { paint })
      if (t > 0) {
        if (durag) {
          // Satin: bright streaks and the centre seam.
          front += P.line(`M${fx(f.cx)} ${fx(f.band - h)}V${fx(f.band + hh * 0.02)}`, shadowOf(col, 0.3), lw * 0.7, { opacity: 0.8 })
          const sd = L[0] < 0 ? -1 : 1
          const sx = f.cx + sd * f.hw * 0.5
          front += P.flat(smooth([[sx - sd * hh * 0.02, f.band - h * 0.86, 0], [sx + sd * hh * 0.07, f.band - h * 0.6], [sx + sd * hh * 0.1, f.band - h * 0.2, 0], [sx + sd * hh * 0.03, f.band - h * 0.45]]), highlightOf(col, 0.6), t === 2 ? 0.4 : 0.28)
        } else front += folds(c, `M${fx(f.cx - f.hw * 0.7)} ${fx(f.band - h * 0.3)}Q${fx(f.cx - f.hw * 0.3)} ${fx(f.band - h * 0.45)} ${fx(f.cx + f.hw * 0.1)} ${fx(f.band - h * 0.35)}`, col, lw * 0.6)
        front += sheen(c, capD, col, hh, durag ? 0.6 : 0.3)
      }
      const knotX = f.cx - (side ? f.facing * f.hw * 1.0 : f.hw * 1.0)
      const tails = smooth([[knotX, f.band - hh * 0.05], [knotX - hh * 0.12, f.band + hh * 0.18], [knotX - hh * 0.04, f.band + hh * 0.2], [knotX + hh * 0.04, f.band + hh * 0.02]])
      front += P.shape(tails, col, { paint })
      if (t > 0) front += P.line(`M${fx(knotX - hh * 0.01)} ${fx(f.band)}L${fx(knotX - hh * 0.07)} ${fx(f.band + hh * 0.16)}`, shadowOf(col, 0.3), lw * 0.6, { opacity: 0.7 })
      front += P.shape(circle(knotX, f.band - hh * 0.04, hh * 0.05), shadowOf(col, 0.1), { paint })
      if (t > 0) front += P.line(`M${fx(knotX - hh * 0.03)} ${fx(f.band - hh * 0.07)}Q${fx(knotX)} ${fx(f.band - hh * 0.03)} ${fx(knotX + hh * 0.03)} ${fx(f.band - hh * 0.06)}`, shadowOf(col, 0.35), lw * 0.5)
      return { front, back: durag ? P.shape(smooth([[f.cx - hh * 0.08, f.band], [f.cx - hh * 0.12, f.band + hh * 0.6], [f.cx + hh * 0.12, f.band + hh * 0.6], [f.cx + hh * 0.08, f.band]]), col) + (t > 0 ? folds(c, `M${fx(f.cx)} ${fx(f.band + hh * 0.05)}V${fx(f.band + hh * 0.55)}`, col, lw * 0.6) : '') : undefined }
    }
    case 'party':
    case 'santa': {
      const santa = id === 'santa'
      const h = hh * (santa ? 0.55 : 0.6)
      const lean = santa ? -f.hw * 1.1 : f.hw * 0.15
      const base = f.band - (santa ? 0 : hatH(f, -0.25))
      const cone = santa
        ? smooth([[f.cx - f.hw * 1.02, base, 0.5], [f.cx - f.hw * 0.7, base - h * 0.75], [f.cx + lean, base - h, 0], [f.cx - f.hw * 0.05, base - h * 0.95], [f.cx + f.hw * 0.6, base - h * 0.72], [f.cx + f.hw * 1.02, base, 0.5]])
        : smooth([[f.cx - f.hw * 0.45, base, 0.5], [f.cx + lean, base - h, 0], [f.cx + f.hw * 0.45, base, 0.5]])
      let front = santa ? underShadow(c, f, hh * 0.08, 0.2) : castShadow(c, ellipse(f.cx, base + hh * 0.01, f.hw * 0.45, hh * 0.025), 0.22)
      front += P.shape(cone, col)
      if (!santa) {
        if (P.detail > 0) {
          // Paper stripes wrap the cone.
          const stripe = (y: number, dy: number) => {
            const k0 = (base - y) / h
            const k1 = (base - y + dy) / h
            const hw0 = f.hw * 0.45 * (1 - k0)
            const hw1 = f.hw * 0.45 * (1 - k1)
            const x0 = f.cx + lean * k0
            const x1 = f.cx + lean * k1
            return poly([[x0 - hw0, y + hh * 0.02], [x0 + hw0, y - hh * 0.03], [x1 + hw1, y - dy - hh * 0.03], [x1 - hw1, y - dy + hh * 0.02]])
          }
          front += P.flat(stripe(base - h * 0.18, h * 0.1) + stripe(base - h * 0.46, h * 0.09) + stripe(base - h * 0.72, h * 0.07), col2)
          if (t > 0) front += P.flat([0.3, 0.58].map((k) => circle(f.cx + lean * k + f.hw * 0.1, base - h * k, hh * 0.018)).join(''), highlightOf(col2, 0.3))
        }
        if (t > 0) front += sheen(c, cone, col, hh, 0.45)
        front += pompom(c, f.cx + lean, base - h, hh * 0.07, col2)
      } else {
        if (t > 0) {
          front += folds(c, `M${fx(f.cx - f.hw * 0.55)} ${fx(base - h * 0.55)}Q${fx(f.cx - f.hw * 0.15)} ${fx(base - h * 0.7)} ${fx(f.cx + f.hw * 0.15)} ${fx(base - h * 0.55)}`, col, lw * 0.7)
          front += sheen(c, cone, col, hh, 0.45)
        }
        front += furBand(c, f.cx - f.hw * 1.12, f.cx + f.hw * 1.12, base - hh * 0.01, hh * 0.15, col2)
        front += pompom(c, f.cx + lean, base - h, hh * 0.085, col2)
      }
      return { front }
    }
    case 'chef': {
      const h = hatH(f, 0.05)
      const puffTop = f.band - h - hh * 0.35
      const lobes = [-0.8, -0.3, 0.2, 0.7].map((k, i) => circle(f.cx + k * f.hw, puffTop + hh * (0.18 + (i % 2) * 0.04) + Math.abs(k) * hh * 0.1, f.hw * 0.46))
      lobes.push(smooth([[f.cx - f.hw * 0.92, f.band - h * 0.35], [f.cx - f.hw * 1.15, f.band - h - hh * 0.08], [f.cx + f.hw * 1.15, f.band - h - hh * 0.08], [f.cx + f.hw * 0.92, f.band - h * 0.35]]))
      let front = underShadow(c, f, hh * 0.06, 0.18)
      front += t === 0 ? P.shape(smooth([[f.cx - f.hw * 0.9, f.band - h * 0.4], [f.cx - f.hw * 1.2, f.band - h - hh * 0.15], [f.cx - f.hw * 0.4, puffTop], [f.cx + f.hw * 0.4, puffTop - hh * 0.03], [f.cx + f.hw * 1.2, f.band - h - hh * 0.15], [f.cx + f.hw * 0.9, f.band - h * 0.4]]), col) : P.union(lobes, col, { offset: 0.08 })
      if (t > 0) front += folds(c, `M${fx(f.cx - f.hw * 0.52)} ${fx(puffTop + hh * 0.2)}Q${fx(f.cx - f.hw * 0.5)} ${fx(f.band - h - hh * 0.05)} ${fx(f.cx - f.hw * 0.62)} ${fx(f.band - h * 0.6)}M${fx(f.cx + f.hw * 0.45)} ${fx(puffTop + hh * 0.2)}Q${fx(f.cx + f.hw * 0.48)} ${fx(f.band - h - hh * 0.05)} ${fx(f.cx + f.hw * 0.5)} ${fx(f.band - h * 0.6)}`, col, lw * 0.7)
      const bandD = roundRect(f.cx - f.hw * 0.95, f.band - h * 0.5, f.hw * 1.9, h * 0.52, hh * 0.03)
      front += P.shape(bandD, col)
      if (P.detail > 1) front += P.line([-0.7, -0.35, 0, 0.35, 0.7].map((k) => `M${fx(f.cx + k * f.hw * 0.95)} ${fx(f.band - h * 0.46)}v${fx(h * 0.44)}`).join(''), shadowOf(col, 0.18), lw * 0.6, { opacity: 0.7 })
      return { front }
    }
    case 'pirate': {
      const h = hatH(f, 0.1)
      const tri = side
        ? smooth([[f.cx - f.hw * 1.3, f.band - hh * 0.05], [f.cx - f.hw * 0.6, f.band - h], [f.cx + f.hw * 0.8, f.band - h * 1.05], [f.cx + f.facing * f.hw * 1.4, f.band - hh * 0.1], [f.cx, f.band + hh * 0.04]])
        : smooth([[f.cx - f.hw * 1.5, f.band - hh * 0.2, 0.3], [f.cx - f.hw * 0.8, f.band - h * 0.9], [f.cx, f.band - h * 1.12], [f.cx + f.hw * 0.8, f.band - h * 0.9], [f.cx + f.hw * 1.5, f.band - hh * 0.2, 0.3], [f.cx, f.band + hh * 0.06]])
      let front = underShadow(c, f, hh * 0.18, 0.3) + P.shape(tri, col)
      if (t > 0) front += sheen(c, tri, col, hh, 0.3)
      if (!side) {
        // Gold braid trim along the upturned brim.
        const trim = `M${fx(f.cx - f.hw * 1.4)} ${fx(f.band - hh * 0.18)}Q${fx(f.cx)} ${fx(f.band - hh * 0.02)} ${fx(f.cx + f.hw * 1.4)} ${fx(f.band - hh * 0.18)}`
        front += P.line(trim, shadowOf(col2, 0.3), hh * 0.034) + P.line(trim, col2, hh * 0.024)
        if (t > 0) front += P.line(trim, highlightOf(col2, 0.5), hh * 0.008, { dash: `${fx(hh * 0.02)} ${fx(hh * 0.02)}`, opacity: 0.9 })
      }
      if (p.b('skull') && !side && !back) {
        const sx = f.cx
        const sy = f.band - h * 0.55
        const r = hh * 0.065
        const bone = (a: number) => capsule([sx - Math.cos(a) * r * 1.6, sy + r * 0.3 - Math.sin(a) * r * 1.6], [sx + Math.cos(a) * r * 1.6, sy + r * 0.3 + Math.sin(a) * r * 1.6], r * 0.2, r * 0.2)
        front += P.shape(bone(0.6) + bone(-0.6), '#f5f2eb', { shade: 0.6, outline: 0.4 })
        front += P.shape(smooth([[sx - r, sy], [sx, sy - r * 1.05], [sx + r, sy], [sx + r * 0.6, sy + r * 0.75], [sx - r * 0.6, sy + r * 0.75]]), '#f5f2eb', { shade: 0.6, outline: 0.4 })
        front += P.flat(circle(sx - r * 0.38, sy, r * 0.26) + circle(sx + r * 0.38, sy, r * 0.26) + poly([[sx, sy + r * 0.28], [sx - r * 0.12, sy + r * 0.48], [sx + r * 0.12, sy + r * 0.48]]), col)
      }
      return { front }
    }
    case 'graduation': {
      const h = hatH(f, 0.02)
      const board = poly([[f.cx - f.hw * 1.3, f.band - h - hh * 0.03], [f.cx, f.band - h - hh * 0.13], [f.cx + f.hw * 1.3, f.band - h - hh * 0.03], [f.cx, f.band - h + hh * 0.07]])
      let front = underShadow(c, f, hh * 0.06, 0.2) + P.shape(smooth(dome(f, h * 0.9, 0.95, 0.4)), col)
      // Board thickness: a darker lip under the front edges.
      front += P.shape(poly([[f.cx - f.hw * 1.3, f.band - h - hh * 0.03], [f.cx, f.band - h + hh * 0.07], [f.cx + f.hw * 1.3, f.band - h - hh * 0.03], [f.cx + f.hw * 1.3, f.band - h - hh * 0.005], [f.cx, f.band - h + hh * 0.095], [f.cx - f.hw * 1.3, f.band - h - hh * 0.005]]), shadowOf(col, 0.25), { shade: false })
      front += P.shape(board, col)
      if (t > 0) front += P.flat(poly([[f.cx - f.hw * 1.1, f.band - h - hh * 0.04], [f.cx, f.band - h - hh * 0.115], [f.cx + f.hw * 0.2, f.band - h - hh * 0.1], [f.cx - f.hw * 0.85, f.band - h - hh * 0.03]]), highlightOf(col, 0.25), t === 2 ? 0.5 : 0.35)
      const bx = f.cx
      const by = f.band - h - hh * 0.03
      front += P.shape(ellipse(bx, by, hh * 0.028, hh * 0.016), col2, { outline: 0.5, shade: 0.5 })
      front += P.line(`M${fx(bx)} ${fx(by)}L${fx(f.cx + f.hw * 1.1)} ${fx(f.band - h)}V${fx(f.band - h + hh * 0.26)}`, col2, hh * 0.018)
      // Tassel: a bound head and a fringe of strands.
      const tx = f.cx + f.hw * 1.1
      const ty = f.band - h + hh * 0.26
      front += P.shape(roundRect(tx - hh * 0.028, ty - hh * 0.01, hh * 0.056, hh * 0.04, hh * 0.01), shadowOf(col2, 0.1), { outline: 0.4 })
      const fringe = [-0.022, -0.011, 0, 0.011, 0.022].map((k, i) => `M${fx(tx + k * hh)} ${fx(ty + hh * 0.03)}l${fx(k * hh * 0.4)} ${fx(hh * (0.1 + (i % 2) * 0.015))}`).join('')
      front += P.line(fringe, col2, hh * 0.01) + (t > 0 ? P.line(fringe, highlightOf(col2, 0.35), hh * 0.003, { opacity: 0.8 }) : '')
      return { front }
    }
    case 'flower-crown': {
      const n = 7
      const vine = `M${fx(f.cx - f.hw * 1.02)} ${fx(f.band - hh * 0.06)}Q${fx(f.cx)} ${fx(f.band - hh * 0.2)} ${fx(f.cx + f.hw * 1.02)} ${fx(f.band - hh * 0.06)}`
      let front = P.line(vine, shadowOf(col2, 0.2), hh * 0.035) + (t > 0 ? P.line(vine, highlightOf(col2, 0.2), hh * 0.012, { opacity: 0.7 }) : '')
      const yAt = (tt: number) => f.band - hh * 0.06 - Math.sin(Math.PI * tt) * hh * 0.1
      // Leaves between the blooms.
      if (t > 0) for (let i = 0; i < n - 1; i++) {
        const tt = (i + 0.5) / (n - 1)
        const x = lerp(f.cx - f.hw * 0.98, f.cx + f.hw * 0.98, tt)
        front += leaf(c, x, yAt(tt), hh * 0.075, (i % 2 ? -1 : 1) * 0.9 - Math.PI / 2 + (i % 2 ? 0 : Math.PI), col2)
      }
      for (let i = 0; i < n; i++) {
        const tt = i / (n - 1)
        const x = lerp(f.cx - f.hw * 0.98, f.cx + f.hw * 0.98, tt)
        const fc = i % 2 ? mix(col, '#ffffff', 0.35) : col
        front += flower(c, x, yAt(tt), hh * (i === 3 ? 0.075 : 0.06), fc, '#fdd835', { rot: -Math.PI / 2 + i * 0.4 })
      }
      return { front }
    }
    case 'hijab': {
      const w = f.hw * 1.25
      const top = f.top - hh * 0.04
      const outer = smooth([[f.cx - w * 1.18, f.band + hh * 1.25, 0.5], [f.cx - w * 1.1, f.band + hh * 0.4], [f.cx - w * 1.05, f.band - hh * 0.1], [f.cx - w * 0.6, top + hh * 0.02], [f.cx, top - hh * 0.03], [f.cx + w * 0.6, top + hh * 0.02], [f.cx + w * 1.05, f.band - hh * 0.1], [f.cx + w * 1.1, f.band + hh * 0.4], [f.cx + w * 1.18, f.band + hh * 1.25, 0.5]])
      const drapeFolds = `M${fx(f.cx - w * 0.9)} ${fx(f.band + hh * 0.5)}Q${fx(f.cx - w * 1.0)} ${fx(f.band + hh * 0.9)} ${fx(f.cx - w * 0.85)} ${fx(f.band + hh * 1.2)}M${fx(f.cx + w * 0.9)} ${fx(f.band + hh * 0.5)}Q${fx(f.cx + w * 1.0)} ${fx(f.band + hh * 0.9)} ${fx(f.cx + w * 0.85)} ${fx(f.band + hh * 1.2)}`
      if (back) return { front: P.shape(outer, col, { paint }) + (t > 0 ? folds(c, drapeFolds, col, lw * 0.8) + sheen(c, outer, col, hh, 0.35) : '') }
      if (side) {
        const k = f.facing
        const prof = smooth([[f.cx + k * f.hw * 0.4, f.band - hh * 0.14], [f.cx + k * f.hw * 0.3, f.band + hh * 0.3], [f.cx + k * f.hw * 0.45, f.band + hh * 0.8], [f.cx + k * f.hw * 1.0, f.band + hh * 1.25, 0.5], [f.cx - k * w * 1.15, f.band + hh * 1.25, 0.5], [f.cx - k * w * 1.1, f.band + hh * 0.3], [f.cx - k * w * 0.9, f.band - hh * 0.2], [f.cx - k * f.hw * 0.2, top - hh * 0.03], [f.cx + k * f.hw * 0.45, top + hh * 0.08]])
        let s = P.shape(prof, col, { paint })
        if (t > 0) s += folds(c, `M${fx(f.cx - k * w * 0.5)} ${fx(f.band + hh * 0.2)}Q${fx(f.cx - k * w * 0.7)} ${fx(f.band + hh * 0.8)} ${fx(f.cx - k * w * 0.6)} ${fx(f.band + hh * 1.2)}M${fx(f.cx + k * f.hw * 0.3)} ${fx(f.band + hh * 0.9)}Q${fx(f.cx + k * f.hw * 0.1)} ${fx(f.band + hh * 1.05)} ${fx(f.cx - k * f.hw * 0.2)} ${fx(f.band + hh * 1.2)}`, col, lw * 0.8) + sheen(c, prof, col, hh, 0.35)
        return { front: s }
      }
      // Traversed opposite to the outline, so the opening is a hole under either fill rule.
      const face = smooth(([[f.cx - f.hw * 0.86, f.band + hh * 0.3], [f.cx - f.hw * 0.82, f.band - hh * 0.05], [f.cx, f.band - hh * 0.14], [f.cx + f.hw * 0.82, f.band - hh * 0.05], [f.cx + f.hw * 0.86, f.band + hh * 0.3], [f.cx + f.hw * 0.62, f.band + hh * 0.72], [f.cx, f.band + hh * 0.86], [f.cx - f.hw * 0.62, f.band + hh * 0.72]] as SP[]).reverse())
      // Drawn as the cloth with a face opening: the drape goes behind, the framing band in front.
      const frame = outer.replace(/Z$/, '') + face.replace(/^M/, 'M')
      let front = ''
      // Soft shadow the cloth casts on the face around the opening.
      if (t > 0) front += castShadow(c, smooth([[f.cx - f.hw * 0.86, f.band + hh * 0.3], [f.cx - f.hw * 0.82, f.band - hh * 0.05], [f.cx, f.band - hh * 0.14], [f.cx + f.hw * 0.82, f.band - hh * 0.05], [f.cx + f.hw * 0.86, f.band + hh * 0.3], [f.cx + f.hw * 0.66, f.band + hh * 0.2], [f.cx + f.hw * 0.62, f.band + hh * 0.02], [f.cx, f.band - hh * 0.04], [f.cx - f.hw * 0.62, f.band + hh * 0.02], [f.cx - f.hw * 0.66, f.band + hh * 0.2]]), 0.3, [[0.5, 0], [0.5, 0.9]])
      front += P.shape(frame, col, { paint, attrs: { 'fill-rule': 'evenodd' } })
      if (t > 0) {
        front += folds(c, drapeFolds + `M${fx(f.cx - f.hw * 0.55)} ${fx(f.band + hh * 0.9)}Q${fx(f.cx)} ${fx(f.band + hh * 1.02)} ${fx(f.cx + f.hw * 0.55)} ${fx(f.band + hh * 0.9)}`, col, lw * 0.8)
        front += sheen(c, outer, col, hh, 0.35)
        if (P.detail > 1) front += metal(c, circle(f.cx - f.hw * 0.62, f.band + hh * 0.72, hh * 0.022), '#d9d9e0', { outline: 0.4 })
      }
      return { back: P.shape(outer, col, { paint }), front }
    }
    case 'turban':
    case 'headwrap': {
      const wrap = id === 'headwrap'
      const tall = wrap ? hh * 0.3 : hh * 0.12
      const h = hatH(f, 0.04) + tall
      const domeD = smooth(dome(f, h, 1.12, 0.35))
      let front = underShadow(c, f, hh * 0.07, 0.2, 1.05) + P.shape(domeD, col, { paint })
      if (P.detail > 0) {
        // Wrapped layers: crossing bands, each with its own shadowed lower edge.
        const layers = wrap ? [0.3, 0.55, 0.8] : [0.22, 0.42, 0.62, 0.82]
        let edges = ''
        let lights = ''
        layers.forEach((k, i) => {
          const s = i % 2 ? 1 : -1
          const yl = f.band - h * k * (s < 0 ? 0.7 : 0.95)
          const yr = f.band - h * k * (s < 0 ? 0.95 : 0.7)
          edges += `M${fx(f.cx - f.hw * 1.05)} ${fx(yl)}Q${fx(f.cx)} ${fx(f.band - h * k - hh * 0.05)} ${fx(f.cx + f.hw * 1.05)} ${fx(yr)}`
          lights += `M${fx(f.cx - f.hw * 0.9)} ${fx(yl - hh * 0.025)}Q${fx(f.cx)} ${fx(f.band - h * k - hh * 0.075)} ${fx(f.cx + f.hw * 0.9)} ${fx(yr - hh * 0.025)}`
        })
        front += P.line(edges, shadowOf(col, 0.3), lw * 0.9, { opacity: 0.75 })
        if (t === 2) front += P.line(lights, highlightOf(col, 0.35), lw * 0.6, { opacity: 0.45 })
      }
      front += sheen(c, domeD, col, hh, 0.35)
      if (wrap) {
        const knot = smooth([[f.cx - hh * 0.06, f.band - h * 0.95], [f.cx - hh * 0.16, f.band - h - hh * 0.12], [f.cx + hh * 0.05, f.band - h - hh * 0.16], [f.cx + hh * 0.12, f.band - h * 0.92]])
        front += P.shape(knot, col, { paint })
        if (t > 0) front += folds(c, `M${fx(f.cx - hh * 0.08)} ${fx(f.band - h - hh * 0.05)}Q${fx(f.cx)} ${fx(f.band - h - hh * 0.1)} ${fx(f.cx + hh * 0.07)} ${fx(f.band - h * 0.97)}`, col, lw * 0.6)
      } else if (!back && P.detail > 1) {
        // A jewelled brooch at the front of the turban.
        const gy = f.band - h * 0.4
        const gx = side ? f.cx + f.facing * f.hw * 0.75 : f.cx
        front += metal(c, circle(gx, gy, hh * 0.05), '#f2d14a', { outline: 0.5, spec: 0 }) + gem(c, gx, gy, hh * 0.032, '#e53935', { cut: 'oval', ry: hh * 0.036 })
      }
      return { front }
    }
    case 'kippah': {
      const d = smooth([[f.cx - f.hw * 0.45, f.top + hh * 0.07], [f.cx, f.top - hh * 0.02], [f.cx + f.hw * 0.45, f.top + hh * 0.07], [f.cx, f.top + hh * 0.1]])
      let front = castShadow(c, ellipse(f.cx, f.top + hh * 0.08, f.hw * 0.44, hh * 0.025), 0.2) + P.shape(d, col)
      if (P.detail > 0) front += P.line(`M${fx(f.cx - f.hw * 0.42)} ${fx(f.top + hh * 0.07)}Q${fx(f.cx)} ${fx(f.top + hh * 0.11)} ${fx(f.cx + f.hw * 0.42)} ${fx(f.top + hh * 0.07)}`, col2, hh * 0.015)
      if (fine) front += stitch(c, `M${fx(f.cx - f.hw * 0.36)} ${fx(f.top + hh * 0.045)}Q${fx(f.cx)} ${fx(f.top + hh * 0.08)} ${fx(f.cx + f.hw * 0.36)} ${fx(f.top + hh * 0.045)}`, col2, lw * 0.3, true)
      front += sheen(c, d, col, hh, 0.35)
      return { front }
    }
  }
  return { front: '' }
}

/* ---- Head features ------------------------------------------------------------ */

export function drawHeadFeature(c: Ctx, id: string, p: Reader, f: HeadFrame, hairColor: string): Drawn {
  const premium = premiumArt('headFeature', id)
  if (premium) return premium(c, id, p, f, hairColor)
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', hairColor)
  const col2 = p.c('color2', '#f48fb1')
  const hh = f.hh
  const lw = Math.max(P.lw, hh * 0.008)
  const side = f.view === 'side'
  const back = f.view === 'back'
  const xs = side ? [f.cx - f.facing * f.hw * 0.2] : [f.cx - f.hw * 0.62, f.cx + f.hw * 0.62]
  const y = f.top + hh * 0.08
  const each = (fn: (x: number, s: number) => string) => xs.map((x, i) => fn(x, side ? -f.facing : i === 0 ? -1 : 1)).join('')
  const eachArt = (fn: (x: number, s: number) => string) => xs.map((x, i) => fn(x, side ? -f.facing : i === 0 ? -1 : 1)).join('')
  switch (id) {
    case 'cat-ears':
    case 'fox-ears':
    case 'wolf-ears': {
      const tall = id === 'fox-ears' ? 0.34 : id === 'wolf-ears' ? 0.3 : 0.26
      const fox = id === 'fox-ears'
      const wolf = id === 'wolf-ears'
      const outerOf = (x: number, s: number) =>
        t === 0
          ? poly([[x - s * hh * 0.1, y + hh * 0.06], [x + s * hh * 0.04, y - hh * tall], [x + s * hh * 0.16, y + hh * 0.04]])
          : smooth([[x - s * hh * 0.11, y + hh * 0.07, 0.6], [x - s * hh * 0.06, y - hh * tall * 0.45], [x + s * hh * 0.04, y - hh * tall, 0], [x + s * hh * 0.13, y - hh * tall * 0.4], [x + s * hh * 0.17, y + hh * 0.05, 0.6]])
      const innerOf = (x: number, s: number) =>
        t === 0
          ? poly([[x - s * hh * 0.04, y + hh * 0.03], [x + s * hh * 0.04, y - hh * tall * 0.65], [x + s * hh * 0.1, y + hh * 0.02]])
          : smooth([[x - s * hh * 0.05, y + hh * 0.04, 0.5], [x - s * hh * 0.015, y - hh * tall * 0.4], [x + s * hh * 0.035, y - hh * tall * 0.72, 0], [x + s * hh * 0.085, y - hh * tall * 0.35], [x + s * hh * 0.11, y + hh * 0.03, 0.5]])
      const innerCol = fox ? '#f7efe6' : wolf ? shadowOf(col, 0.3) : col2
      let under = P.shape(each(outerOf), col)
      if (back) {
        // From behind: the back of the ear only, with a fur ridge.
        if (t > 0) under += eachArt((x, s) => P.line(`M${fx(x + s * hh * 0.03)} ${fx(y + hh * 0.04)}Q${fx(x + s * hh * 0.03)} ${fx(y - hh * tall * 0.4)} ${fx(x + s * hh * 0.04)} ${fx(y - hh * tall * 0.85)}`, shadowOf(col, 0.25), lw * 0.6, { opacity: 0.6 }))
      } else {
        // Inner ear: a gradient from the deep base to the lighter rim, then fur tufts.
        const innerD = each(innerOf)
        under += t > 0 ? `<path d="${innerD}" fill="${P.linear(`ear${innerCol.replace('#', '')}`, [[0, highlightOf(innerCol, 0.12)], [0.7, innerCol], [1, shadowOf(innerCol, 0.3)]], [0.5, 0], [0.5, 1])}"/>` : P.flat(innerD, innerCol)
        if (t > 0) under += eachArt((x, s) => furTuftsEar(c, x + s * hh * 0.035, y + hh * 0.04, x + s * hh * 0.035, y - hh * tall * 0.5, hh * 0.1, fox || wolf ? '#f7efe6' : mix(col, '#ffffff', 0.5)))
      }
      if (fox) under += P.flat(each((x, s) => smooth([[x - s * hh * 0.035, y - hh * tall * 0.66, 0.4], [x + s * hh * 0.04, y - hh * tall, 0], [x + s * hh * 0.1, y - hh * tall * 0.62, 0.4], [x + s * hh * 0.035, y - hh * tall * 0.72]])), p.c('color2', '#26252c'))
      if (t === 2) under += litEdge(c, each(outerOf), highlightOf(col, 0.45), hh * 0.014, 0.6)
      return { front: '', under }
    }
    case 'bunny-ears': {
      const floppy = p.b('floppy')
      const ear = (x: number, s: number) => (floppy ? brush([[x, y], [x + s * hh * 0.08, y - hh * 0.25], [x + s * hh * 0.3, y - hh * 0.15]], hh * 0.14, hh * 0.1, hh * 0.03) : capsule([x, y + hh * 0.02], [x + s * hh * 0.06, y - hh * 0.42], hh * 0.075, hh * 0.08))
      const inner = (x: number, s: number) => (floppy ? brush([[x + s * hh * 0.01, y - hh * 0.03], [x + s * hh * 0.08, y - hh * 0.22], [x + s * hh * 0.24, y - hh * 0.15]], hh * 0.06, hh * 0.05, hh * 0.015) : capsule([x + s * hh * 0.005, y - hh * 0.02], [x + s * hh * 0.055, y - hh * 0.36], hh * 0.03, hh * 0.04))
      let under = P.shape(each(ear), col)
      if (!back && t > 0) {
        const innerD = each(inner)
        under += `<path d="${innerD}" fill="${P.linear(`bun${col2.replace('#', '')}`, [[0, highlightOf(col2, 0.2)], [0.6, col2], [1, shadowOf(col2, 0.25)]], [0.5, 0], [0.5, 1])}"/>`
        if (!floppy) under += eachArt((x, s) => furTuftsEar(c, x + s * hh * 0.02, y + hh * 0.03, x + s * hh * 0.04, y - hh * 0.2, hh * 0.07, mix(col, '#ffffff', 0.4)))
      } else if (!back) under += P.flat(each(inner), col2)
      if (floppy && t > 0) under += P.line(each((x, s) => `M${fx(x + s * hh * 0.06)} ${fx(y - hh * 0.26)}q${fx(s * hh * 0.04)} ${fx(hh * 0.04)} ${fx(s * hh * 0.02)} ${fx(hh * 0.09)}`), shadowOf(col, 0.3), lw * 0.6, { opacity: 0.7 })
      if (t === 2) under += litEdge(c, each(ear), highlightOf(col, 0.45), hh * 0.014, 0.6)
      return { front: '', under }
    }
    case 'bear-ears':
    case 'mouse-ears': {
      const mouse = id === 'mouse-ears'
      const r = mouse ? hh * 0.17 : hh * 0.11
      const outer = each((x, s) => (t > 0 && !mouse ? scallop(ring(x + s * hh * 0.05, y - r * 0.4, r * 0.95, r * 0.95, 11), 0.16) : circle(x + s * hh * 0.05, y - r * 0.4, r)))
      let under = P.shape(outer, col)
      if (!back) {
        const innerCol = mouse ? mix('#f48fb1', col, 0.25) : shadowOf(col, 0.25)
        const innerD = each((x, s) => circle(x + s * hh * 0.05 + s * r * 0.05, y - r * 0.33, r * 0.55))
        under += t > 0 && mouse ? `<path d="${innerD}" fill="${P.linear(`mear${innerCol.replace('#', '')}`, [[0, highlightOf(innerCol, 0.2)], [1, shadowOf(innerCol, 0.2)]], [0.5, 0], [0.5, 1])}"/>` : P.flat(innerD, innerCol, mouse ? 1 : 0.6)
        if (t > 0 && !mouse) under += P.flat(each((x, s) => circle(x + s * hh * 0.05 + s * r * 0.05 - L[0] * r * 0.08, y - r * 0.33 - L[1] * r * 0.08, r * 0.36)), shadowOf(col, 0.45), 0.5)
      }
      if (t === 2) under += litEdge(c, outer, highlightOf(col, 0.45), r * 0.1, 0.6)
      return { front: '', under }
    }
    case 'devil-horns': {
      let under = ''
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const s = side ? -f.facing : i === 0 ? -1 : 1
        const spine: P[] = [[x, y + hh * 0.05], [x + s * hh * 0.06, y - hh * 0.1], [x + s * hh * 0.02, y - hh * 0.2]]
        const d = brush(spine, hh * 0.1, 0.1)
        under += P.shape(d, col, { shade: 1 })
        if (t > 0) {
          under += P.line(`M${fx(x - s * hh * 0.025)} ${fx(y + hh * 0.0)}Q${fx(x + s * hh * 0.01)} ${fx(y + hh * 0.02)} ${fx(x + s * hh * 0.045)} ${fx(y - hh * 0.01)}M${fx(x - s * hh * 0.01)} ${fx(y - hh * 0.06)}Q${fx(x + s * hh * 0.03)} ${fx(y - hh * 0.045)} ${fx(x + s * hh * 0.06)} ${fx(y - hh * 0.07)}`, shadowOf(col, 0.35), lw * 0.5, { opacity: 0.8 })
          under += P.line(`M${fx(x + s * hh * 0.01 - L[0] * hh * 0.02)} ${fx(y + hh * 0.02)}Q${fx(x + s * hh * 0.06 - L[0] * hh * 0.02)} ${fx(y - hh * 0.08)} ${fx(x + s * hh * 0.025)} ${fx(y - hh * 0.17)}`, highlightOf(col, 0.6), lw * 0.7, { opacity: t === 2 ? 0.85 : 0.6 })
        }
      }
      return { front: '', under }
    }
    case 'ram-horns': {
      let under = ''
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const s = side ? -f.facing : i === 0 ? -1 : 1
        const spine: P[] = [[x, y], [x + s * hh * 0.2, y - hh * 0.12], [x + s * hh * 0.34, y + hh * 0.08], [x + s * hh * 0.22, y + hh * 0.26], [x + s * hh * 0.12, y + hh * 0.14]]
        const d = brush(spine, hh * 0.13, hh * 0.04)
        under += P.shape(d, col)
        if (t > 0) {
          // Growth ridges wrapping the spiral.
          const dense: P[] = []
          for (let k = 0; k < spine.length - 1; k++) for (let q = 0; q < 4; q++) dense.push([lerp(spine[k][0], spine[k + 1][0], q / 4), lerp(spine[k][1], spine[k + 1][1], q / 4)])
          let ridges = ''
          for (let k = 1; k < dense.length - 1; k++) {
            const a = dense[k - 1]
            const b = dense[k + 1]
            const dx = b[0] - a[0]
            const dy = b[1] - a[1]
            const l = Math.hypot(dx, dy) || 1
            const w = lerp(hh * 0.062, hh * 0.022, k / dense.length)
            ridges += `M${fx(dense[k][0] - (dy / l) * w)} ${fx(dense[k][1] + (dx / l) * w)}L${fx(dense[k][0] + (dy / l) * w)} ${fx(dense[k][1] - (dx / l) * w)}`
          }
          under += P.line(ridges, shadowOf(col, 0.28), lw * 0.45, { opacity: 0.7 })
          if (t === 2) under += litEdge(c, d, highlightOf(col, 0.5), hh * 0.014, 0.7)
        }
      }
      return { front: '', under }
    }
    case 'unicorn-horn': {
      const cx = side ? f.cx + f.facing * f.hw * 0.35 : f.cx
      const tipX = cx + (side ? f.facing * hh * 0.1 : 0)
      const horn = poly([[cx - hh * 0.07, f.top + hh * 0.1], [tipX, f.top - hh * 0.35], [cx + hh * 0.07, f.top + hh * 0.1]])
      const paint = t > 0 ? P.linear(`uni${col.replace('#', '')}${t}`, t === 2 ? [[0, mix(col, '#b3e5fc', 0.45)], [0.35, highlightOf(col, 0.3)], [0.65, mix(col, '#e1bee7', 0.4)], [1, mix(col, '#fff9c4', 0.5)]] : [[0, shadowOf(col, 0.08)], [1, highlightOf(col, 0.2)]], [0.5, 1], [0.5, 0]) : undefined
      let front = P.shape(horn, col, { paint })
      if (P.detail > 0) {
        // Spiral grooves.
        let grooves = ''
        for (let k = 0; k < 5; k++) {
          const u = 0.12 + k * 0.17
          const yy = lerp(f.top + hh * 0.1, f.top - hh * 0.35, u)
          const hwid = hh * 0.07 * (1 - u)
          const xx = lerp(cx, tipX, u)
          grooves += `M${fx(xx - hwid)} ${fx(yy + hh * 0.025 * (1 - u))}Q${fx(xx)} ${fx(yy)} ${fx(xx + hwid)} ${fx(yy - hh * 0.03 * (1 - u))}`
        }
        front += P.line(grooves, shadowOf(col, 0.25), lw * 0.6, { opacity: 0.8 })
        if (t > 0) front += P.line(grooves, highlightOf(col, 0.5), lw * 0.3, { opacity: 0.6 })
      }
      if (t === 2) front += litEdge(c, horn, '#ffffff', hh * 0.012, 0.6) + moving(c, 'twinkle', glint(c, tipX, f.top - hh * 0.33, hh * 0.05, 0.95) + halo(c, tipX, f.top - hh * 0.32, hh * 0.12, mix(col, '#ffffff', 0.5), 0.5), 0, 0.5)
      return { front }
    }
    case 'antlers': {
      // Beam and tines as tapered capsules (compact arcs).
      const pieces = (x: number, s: number): string[] => [
        capsule([x, y + hh * 0.05], [x + s * hh * 0.1, y - hh * 0.2], hh * 0.032, hh * 0.024),
        capsule([x + s * hh * 0.1, y - hh * 0.2], [x + s * hh * 0.18, y - hh * 0.38], hh * 0.024, hh * 0.014),
        capsule([x + s * hh * 0.08, y - hh * 0.15], [x + s * hh * 0.24, y - hh * 0.2], hh * 0.022, hh * 0.01),
        capsule([x + s * hh * 0.14, y - hh * 0.3], [x + s * hh * 0.08, y - hh * 0.44], hh * 0.02, hh * 0.01),
      ]
      const list = xs.flatMap((x, i) => pieces(x, side ? -f.facing : i === 0 ? -1 : 1))
      let under = t > 0 ? P.union(list, col, { material: 'wood' }) : P.shape(list.join(''), col)
      if (t > 0) {
        // Bark texture and paler tips.
        under += P.line(each((x, s) => `M${fx(x + s * hh * 0.01)} ${fx(y)}l${fx(s * hh * 0.02)} ${fx(-hh * 0.06)}M${fx(x + s * hh * 0.07)} ${fx(y - hh * 0.14)}l${fx(s * hh * 0.02)} ${fx(-hh * 0.06)}M${fx(x + s * hh * 0.12)} ${fx(y - hh * 0.27)}l${fx(s * hh * 0.015)} ${fx(-hh * 0.05)}`), shadowOf(col, 0.3), lw * 0.45, { opacity: 0.7 })
        under += P.flat(each((x, s) => circle(x + s * hh * 0.18, y - hh * 0.38, hh * 0.016) + circle(x + s * hh * 0.24, y - hh * 0.2, hh * 0.012) + circle(x + s * hh * 0.08, y - hh * 0.44, hh * 0.012)), highlightOf(col, 0.4), 0.8)
      }
      return { front: '', under }
    }
    case 'antennae': {
      let under = ''
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const s = side ? -f.facing : i === 0 ? -1 : 1
        const stalk = `M${fx(x)} ${fx(y + hh * 0.05)}Q${fx(x + s * hh * 0.05)} ${fx(y - hh * 0.2)} ${fx(x + s * hh * 0.14)} ${fx(y - hh * 0.3)}`
        under += P.line(stalk, P.ink(col), hh * 0.025 + lw) + P.line(stalk, col, hh * 0.025)
        if (t > 0) under += P.line(stalk, highlightOf(col, 0.4), hh * 0.008, { opacity: 0.8 })
        const bx = x + s * hh * 0.14
        const by = y - hh * 0.32
        if (t === 2) under += moving(c, 'breathe', halo(c, bx, by, hh * 0.13, col2, 0.55), i * 0.5, 1.6)
        under += sphere(c, bx, by, hh * 0.05, col2, 'glass', { outline: 1 })
      }
      return { front: '', under }
    }
  }
  return { front: '' }
}

/** Fur tufts inside an ear: a fan of fine light strokes growing from the base. */
function furTuftsEar(c: Ctx, bx: number, by: number, tx: number, ty: number, w: number, col: string): string {
  const P = c.paint
  let d = ''
  const n = 4
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5
    const x0 = bx + u * w * 0.8
    const x1 = lerp(x0, tx, 0.7) + u * w * 0.25
    const y1 = lerp(by, ty, 0.55 + Math.abs(u) * 0.3 - (i % 2) * 0.12)
    d += `M${fx(x0)} ${fx(by)}Q${fx(x0 + u * w * 0.3)} ${fx((by + y1) / 2)} ${fx(x1)} ${fx(y1)}`
  }
  return P.line(d, col, Math.max(0.5, w * 0.09), { opacity: 0.85 })
}

/* ---- Hair accessories -------------------------------------------------------- */

export function drawHairAcc(c: Ctx, id: string, p: Reader, f: HeadFrame, index: number): string {
  const P = c.paint
  const t = tier(c)
  const L = lightOf(c)
  const col = p.c('color', '#e53935')
  const hh = f.hh
  const lw = Math.max(P.lw, hh * 0.008)
  const s = f.view === 'side' ? -f.facing : index % 2 ? 1 : -1
  const x = f.view === 'side' ? f.cx - f.facing * f.hw * 0.4 : f.cx + s * f.hw * 0.62
  const y = f.band - hh * 0.12
  switch (id) {
    case 'bow': {
      const k = p.b('big') ? 1.6 : 1
      const bx = f.view === 'side' ? x : f.cx + s * f.hw * 0.5
      const by = f.top + hh * 0.06
      const loop = (d: number) => smooth([[bx, by], [bx + d * hh * 0.06 * k, by - hh * 0.1 * k], [bx + d * hh * 0.15 * k, by - hh * 0.1 * k], [bx + d * hh * 0.16 * k, by + hh * 0.02 * k], [bx + d * hh * 0.12 * k, by + hh * 0.08 * k]])
      const tails = [-1, 1].map((d) => smooth([[bx, by + hh * 0.01 * k], [bx + d * hh * 0.07 * k, by + hh * 0.12 * k], [bx + d * hh * 0.09 * k, by + hh * 0.19 * k, 0], [bx + d * hh * 0.05 * k, by + hh * 0.16 * k], [bx + d * hh * 0.02 * k, by + hh * 0.14 * k, 0]])).join('')
      let out = castShadow(c, circle(bx + hh * 0.01, by + hh * 0.03 * k, hh * 0.1 * k), 0.16)
      out += P.shape(tails, shadowOf(col, 0.08)) + P.shape(loop(-1) + loop(1), col)
      if (t > 0) {
        // Inside of each loop and the pinch folds toward the knot.
        out += P.flat([-1, 1].map((d) => smooth([[bx + d * hh * 0.035 * k, by - hh * 0.01 * k], [bx + d * hh * 0.1 * k, by - hh * 0.06 * k], [bx + d * hh * 0.12 * k, by + hh * 0.01 * k]])).join(''), shadowOf(col, 0.35), 0.8)
        out += P.line([-1, 1].map((d) => `M${fx(bx + d * hh * 0.03 * k)} ${fx(by - hh * 0.02 * k)}Q${fx(bx + d * hh * 0.08 * k)} ${fx(by - hh * 0.03 * k)} ${fx(bx + d * hh * 0.12 * k)} ${fx(by - hh * 0.08 * k)}`).join(''), shadowOf(col, 0.3), lw * 0.5, { opacity: 0.7 })
        out += litEdge(c, loop(-1) + loop(1), highlightOf(col, 0.55), hh * 0.012 * k, 0.8)
      }
      out += P.shape(roundRect(bx - hh * 0.035 * k, by - hh * 0.04 * k, hh * 0.07 * k, hh * 0.08 * k, hh * 0.025 * k), shadowOf(col, 0.12))
      if (t > 0) out += spec(c, bx + L[0] * hh * 0.012 * k, by + L[1] * hh * 0.02 * k, hh * 0.012 * k, hh * 0.006 * k, 0.6, 90)
      return out
    }
    case 'clips': {
      let out = ''
      for (const i of [0, 1]) {
        const d = roundRect(x - hh * 0.07, y - hh * 0.04 + i * hh * 0.06, hh * 0.14, hh * 0.028, hh * 0.014)
        out += castShadow(c, roundRect(x - hh * 0.065, y - hh * 0.03 + i * hh * 0.06, hh * 0.14, hh * 0.028, hh * 0.014), 0.2)
        out += P.shape(d, col, { shade: 0.5, outline: 0.5 })
        if (t > 0) out += spec(c, x - hh * 0.025, y - hh * 0.032 + i * hh * 0.06, hh * 0.035, hh * 0.005, 0.8, 0)
      }
      return out
    }
    case 'flower':
      return castShadow(c, circle(x + hh * 0.01, y + hh * 0.015, hh * 0.085), 0.18) + flower(c, x, y, hh * 0.085, col, p.c('color2', '#fdd835'), { rot: -Math.PI / 2 + index }) + (t > 0 ? leaf(c, x + s * hh * 0.07, y + hh * 0.05, hh * 0.06, s > 0 ? 0.5 : Math.PI - 0.5, '#7cb342') : '')
    case 'alice': {
      const k = f.facing
      const d = f.view === 'side'
        ? `M${fx(f.cx + k * f.hw * 0.02)} ${fx(f.band + hh * 0.1)}Q${fx(f.cx + k * f.hw * 0.08)} ${fx(f.top - hh * 0.06)} ${fx(f.cx + k * f.hw * 0.5)} ${fx(f.top + hh * 0.03)}`
        : `M${fx(f.cx - f.hw * 1.0)} ${fx(f.band + hh * 0.06)}Q${fx(f.cx)} ${fx(f.top - hh * 0.02)} ${fx(f.cx + f.hw * 1.0)} ${fx(f.band + hh * 0.06)}`
      let out = P.line(d, P.ink(col), hh * 0.05 + lw * 1.4) + P.line(d, col, hh * 0.05)
      if (t > 0) out += `<g transform="translate(${fx(L[0] * hh * 0.012)} ${fx(L[1] * hh * 0.012)})">${P.line(d, highlightOf(col, 0.5), hh * 0.014, { opacity: t === 2 ? 0.75 : 0.5 })}</g>`
      return out
    }
    case 'scrunchie': {
      const cx = f.cx - (f.view === 'side' ? f.facing * f.hw * 0.9 : 0)
      const cy = f.view === 'side' ? -hh * 0.42 : f.top + hh * 0.02
      if (t === 0) return P.shape(ellipse(cx, cy, hh * 0.08, hh * 0.05), col)
      const d = scallop(ring(cx, cy, hh * 0.075, hh * 0.045, 9), 0.3)
      let out = P.shape(d, col)
      out += P.line([0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * TAU + 0.3
        return `M${fx(cx + Math.cos(a) * hh * 0.03)} ${fx(cy + Math.sin(a) * hh * 0.02)}L${fx(cx + Math.cos(a) * hh * 0.07)} ${fx(cy + Math.sin(a) * hh * 0.042)}`
      }).join(''), shadowOf(col, 0.3), lw * 0.5, { opacity: 0.7 })
      out += litEdge(c, d, highlightOf(col, 0.45), hh * 0.01, 0.6)
      return out
    }
    case 'star-pins': {
      const d1 = star(x, y, hh * 0.05, hh * 0.022)
      const d2 = star(x + s * hh * 0.07, y + hh * 0.06, hh * 0.035, hh * 0.016)
      return castShadow(c, star(x + hh * 0.008, y + hh * 0.012, hh * 0.05, hh * 0.022), 0.18) + metal(c, d1, col, { outline: 0.5, spec: 0.8 }) + metal(c, d2, col, { outline: 0.5, spec: 0.6 })
    }
    case 'feather': {
      const tip: P = [x + s * hh * 0.04, y - hh * 0.32]
      return feather(c, [x, y + hh * 0.05], tip, hh * 0.1, col, { curl: s * 0.12 }) + (t > 0 ? P.shape(roundRect(x - hh * 0.018, y + hh * 0.02, hh * 0.036, hh * 0.05, hh * 0.01), '#c79212', { outline: 0.4, shade: 0.5 }) : '')
    }
    case 'beads': {
      let out = t > 0 ? P.line(`M${fx(x)} ${fx(y + hh * 0.13)}L${fx(x + s * hh * 0.07)} ${fx(y + hh * 0.36)}`, shadowOf(col, 0.5), lw * 0.4, { opacity: 0.6 }) : ''
      for (const i of [0, 1, 2]) out += sphere(c, x + s * hh * 0.03 * i, y + hh * 0.2 + i * hh * 0.07, hh * 0.028, col, 'gloss', { outline: 0.5 })
      return out
    }
  }
  return ''
}

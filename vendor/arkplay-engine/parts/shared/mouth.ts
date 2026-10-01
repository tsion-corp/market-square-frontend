/* The mouth, shared by humanoids and creatures (creatures add beaks and jaws on top).
 * Smile bends the corners, `open` drops the jaw line, `wide` stretches, `asym` lifts one
 * corner; the named shapes (o, teeth, grimace, cat, wavy, pout, tongue…) cover the rest.
 *
 * Materials: the inner mouth is a gradient that deepens toward the back and the corners,
 * teeth are shaded where the lip shadows them, the tongue has a soft highlight and the
 * lower lip a gloss. The baked path (`ctx.baked`) adds tooth separations, corner creases,
 * smile dimples and the lower lip's shadow on the chin. */

import { highlightOf, mix, shadowOf, toLch } from '../../core/color.ts'
import { clamp, lerp, type P } from '../../core/math.ts'
import { brush, ellipse, f, poly, roundRect, smooth, type SP } from '../../core/path.ts'
import { el, g, url } from '../../core/svg.ts'
import type { Ctx } from '../../render/context.ts'
import type { MouthShape } from '../../render/types.ts'
import { keyOf, linearPaint, radialPaint, softSpot, warmShade } from './eye.ts'

export interface MouthSpec {
  cx: number
  cy: number
  w: number
  style: string
  lips: number
  lipColor: string
  skin: string
  teeth: string
  smile: number
  open: number
  wide: number
  asym: number
  shape: MouthShape
  profile?: boolean
}

const CAVITY = '#5a1f2c'
const CAVITY_DEEP = '#2a0b14'
const TOOTH = '#f8f5ee'
const TOOTH_SHADE = '#cdbfb9'
const TONGUE = '#e0788a'
const GOLD = '#f2c230'
const WHITE = '#ffffff'

/** Default lip colour from the skin: rosier on light skin, deeper and berry-toned on deep skin. */
export function autoLipColor(skin: string): string {
  const c = toLch(skin)
  if (c.l < 0.5) return mix(shadowOf(skin, 0.1), '#8e3f55', 0.34)
  return mix(shadowOf(skin, 0.1), '#c85a68', 0.4)
}

/** y of a polyline at x (for hugging curves). */
function yAt(pts: P[], x: number): number {
  const a = pts[0][0] <= pts[pts.length - 1][0] ? pts : pts.slice().reverse()
  if (x <= a[0][0]) return a[0][1]
  for (let i = 0; i < a.length - 1; i++) {
    if (x <= a[i + 1][0]) return lerp(a[i][1], a[i + 1][1], (x - a[i][0]) / (a[i + 1][0] - a[i][0] || 1))
  }
  return a[a.length - 1][1]
}

export function drawMouth(c: Ctx, s: MouthSpec): string {
  const P = c.paint
  const shaded = P.style.shading !== 'flat' && P.detail > 0
  const rich = c.baked && P.detail > 1
  const L0 = P.style.light
  const ink = mix(P.ink(s.skin), '#3a1820', 0.4)
  const lipC = s.lipColor || autoLipColor(s.skin)
  const styleW: Record<string, number> = { default: 1, full: 1, thin: 0.95, wide: 1.25, small: 0.72, heart: 0.85, cat: 0.8, line: 0.95 }
  let mw = s.w * (styleW[s.style] ?? 1) * (1 + clamp(s.wide, -1, 1) * 0.28)
  if (s.shape === 'pout') mw *= 0.55
  const lineW = clamp(P.lw * 1.05, s.w * 0.05, s.w * 0.075)
  const showLips = s.style !== 'line' && s.style !== 'cat' && (s.style === 'full' || s.style === 'heart' || s.lipColor !== '' || s.lips > 0.55)
  const lipScale = lerp(0.45, 1.3, s.lips) * (s.style === 'full' ? 1.3 : s.style === 'thin' ? 0.55 : 1)
  // Lipstick is glossier than a bare lip.
  const glossK = clamp((s.lipColor ? 0.75 : 0.45) + (s.lips - 0.5) * 0.4, 0.2, 1)
  const half = mw / 2
  const lift = (side: number) => s.smile * mw * 0.2 + s.asym * side * mw * 0.12
  // Profile: draw the half of the mouth that faces the viewer.
  const x0 = s.profile ? s.cx - half * 0.35 : s.cx - half
  const x1 = s.profile ? s.cx + half * 0.55 : s.cx + half
  const midY = s.cy + s.smile * mw * 0.1
  // In profile only the back corner lifts; the front end is the middle of the lips.
  const L: P = [x0, s.cy - lift(-1) * (s.profile ? 1.1 : 1)]
  const R: P = s.profile ? [x1, midY - Math.max(0, s.smile) * mw * 0.03] : [x1, s.cy - lift(1)]
  const open = clamp(s.open, 0, 1.2)
  const parts: string[] = []
  const skinShadow = warmShade(s.skin, 0.3)

  const lipPaint = (base: string, upper: boolean): string | undefined =>
    shaded ? linearPaint(c, upper ? [[0, shadowOf(base, 0.08)], [1, base]] : [[0, shadowOf(base, 0.05)], [0.35, base], [0.8, highlightOf(base, 0.07)], [1, shadowOf(base, 0.12)]]) : undefined
  const gloss = (x: number, y: number, rx: number, ry: number): string => {
    if (!shaded) return ''
    let o = softSpot(c, x + L0[0] * rx * 0.3, y, rx, ry, WHITE, (rich ? 0.55 : 0.4) * glossK)
    if (rich) o += el('ellipse', { cx: x + L0[0] * rx * 0.45, cy: y - ry * 0.12, rx: rx * 0.32, ry: ry * 0.26, fill: P.col(WHITE), 'fill-opacity': f(0.75 * glossK) })
    return o
  }
  const cornerCreases = (): string => {
    if (!rich || s.profile || s.style === 'cat' || s.shape === 'cat') return ''
    const k = clamp((s.smile - 0.35) / 0.65, 0, 1)
    let d = ''
    for (const [p, sg] of [[L, -1], [R, 1]] as [P, number][]) {
      // Small commissure tick at every corner, a longer dimple crease for a big smile.
      d += brush([[p[0] - sg * mw * 0.01, p[1] - mw * 0.02], [p[0] + sg * mw * 0.04, p[1] + mw * 0.012]], 0, lineW * 0.35)
      if (k > 0) d += brush([[p[0] + sg * mw * 0.06, p[1] - mw * 0.07 * k], [p[0] + sg * mw * 0.09, p[1] - mw * 0.01], [p[0] + sg * mw * 0.065, p[1] + mw * 0.06 * k]], 0, 0, lineW * 0.32)
    }
    return P.flat(d, skinShadow, 0.34 + k * 0.08)
  }

  if (s.shape === 'o' && open > 0.05) {
    const rx = mw * 0.24
    const ry = Math.max(mw * 0.14, open * mw * 0.32)
    const oy = s.cy + ry * 0.35
    const d = ellipse(s.cx, oy, rx, ry)
    const clip = c.defs.add(keyOf('mo', d), (id) => el('clipPath', { id }, el('path', { d })))
    const inside = [el('path', { d, fill: shaded ? radialPaint(c, [[0, mix(CAVITY, TONGUE, 0.2)], [0.6, CAVITY], [1, CAVITY_DEEP]], { cx: 0.5, cy: 0.8, r: 0.8 }) : P.col(CAVITY) })]
    if (open > 0.3) inside.push(el('path', { d: ellipse(s.cx, oy + ry * 0.75, rx * 0.68, ry * 0.42), fill: shaded ? radialPaint(c, [[0, highlightOf(TONGUE, 0.15)], [0.7, TONGUE], [1, shadowOf(TONGUE, 0.2)]], { cx: 0.5, cy: 0.3 }) : P.col(TONGUE) }))
    if (shaded) inside.push(el('path', { d, fill: radialPaint(c, [[0, CAVITY_DEEP, 0], [0.6, CAVITY_DEEP, 0], [1, CAVITY_DEEP, 0.55]], { cx: 0.5, cy: 0.6 }) }))
    parts.push(g({ 'clip-path': url(clip) }, ...inside))
    if (showLips) {
      const t = lineW * 0.95 * lipScale
      const ring = ellipse(s.cx, oy, rx + t, ry + t * 1.15) + ellipse(s.cx, oy, rx, ry)
      parts.push(P.flat(ring, lipC, 1, { 'fill-rule': 'evenodd' }))
      if (shaded) parts.push(P.flat(ellipse(s.cx, oy, rx + t, ry + t * 1.15) + ellipse(s.cx, oy + t * 0.5, rx + t * 0.3, ry + t * 0.3), shadowOf(lipC, 0.18), 0.5, { 'fill-rule': 'evenodd' }))
      parts.push(P.line(ellipse(s.cx, oy, rx + t, ry + t * 1.15), ink, lineW * 0.4, { opacity: 0.7 }))
      parts.push(gloss(s.cx, oy + ry + t * 0.55, rx * 0.5, t * 0.35))
    }
    parts.push(P.line(d, ink, lineW * 0.8))
    if (rich) parts.push(softSpot(c, s.cx, oy + ry + mw * 0.12, rx * 1.1, mw * 0.06, skinShadow, 0.25))
    return parts.join('')
  }

  if (s.shape === 'pout') {
    const d = smooth([[s.cx - mw * 0.5, s.cy], [s.cx, s.cy - mw * 0.32], [s.cx + mw * 0.5, s.cy], [s.cx, s.cy + mw * 0.36]])
    let svg = P.shape(d, lipC, { gloss: !shaded, paint: lipPaint(lipC, false), shade: shaded ? false : 1 })
    svg += P.flat(brush([[s.cx - mw * 0.36, s.cy + mw * 0.02], [s.cx, s.cy - mw * 0.04], [s.cx + mw * 0.36, s.cy + mw * 0.02]], lineW * 0.25, lineW * 0.25, lineW * 0.55), ink)
    svg += gloss(s.cx, s.cy + mw * 0.17, mw * 0.2, mw * 0.08)
    if (rich) {
      svg += P.line([-0.18, 0, 0.18].map((k) => `M${f(s.cx + k * mw)} ${f(s.cy + mw * 0.08)}l${f(k * mw * 0.1)} ${f(mw * 0.12)}`).join(''), shadowOf(lipC, 0.25), lineW * 0.18, { opacity: 0.45 })
      svg += softSpot(c, s.cx, s.cy + mw * 0.5, mw * 0.3, mw * 0.08, skinShadow, 0.25)
    }
    return svg
  }

  if (open < 0.06) {
    // Closed.
    if (s.style === 'cat' || s.shape === 'cat') {
      const d = `M${f(L[0])} ${f(L[1])}Q${f(s.cx - half * 0.5)} ${f(midY + mw * 0.22)} ${f(s.cx)} ${f(midY)}Q${f(s.cx + half * 0.5)} ${f(midY + mw * 0.22)} ${f(R[0])} ${f(R[1])}`
      let svg = P.line(d, ink, lineW)
      if (rich) svg += softSpot(c, s.cx - half * 0.45, midY + mw * 0.2, half * 0.35, mw * 0.05, skinShadow, 0.25) + softSpot(c, s.cx + half * 0.45, midY + mw * 0.2, half * 0.35, mw * 0.05, skinShadow, 0.25)
      return svg
    }
    let line: P[]
    if (s.shape === 'wavy') line = [L, [lerp(L[0], R[0], 0.25), midY + mw * 0.07], [lerp(L[0], R[0], 0.5), midY - mw * 0.03], [lerp(L[0], R[0], 0.75), midY + mw * 0.07], R]
    else if (s.shape === 'flat') line = [L, [s.cx, s.cy + mw * 0.01], R]
    else line = [L, [lerp(L[0], R[0], 0.5), midY], R]
    if (showLips) {
      const tu = mw * 0.085 * lipScale
      const tl = mw * 0.13 * lipScale
      const bow = s.style === 'heart' ? 1.6 : 1
      const upper: SP[] = [
        [L[0], L[1], 0],
        [lerp(L[0], R[0], 0.22), lerp(L[1], midY, 0.5) - tu * 0.8],
        [s.cx - mw * 0.1, midY - tu * 1.25 * bow],
        [s.cx, midY - tu * (1 - 0.35 * bow)],
        [s.cx + mw * 0.1, midY - tu * 1.25 * bow],
        [lerp(L[0], R[0], 0.78), lerp(R[1], midY, 0.5) - tu * 0.8],
        [R[0], R[1], 0],
        ...line.slice(1, -1).reverse(),
      ]
      const lower: SP[] = [[L[0], L[1], 0], ...line.slice(1, -1), [R[0], R[1], 0], [lerp(L[0], R[0], 0.75), midY + tl * 0.85], [s.cx, midY + tl * 1.05], [lerp(L[0], R[0], 0.25), midY + tl * 0.85]]
      if (rich) parts.push(softSpot(c, s.cx, midY + tl * 1.35, mw * 0.3, tl * 0.4, skinShadow, 0.3))
      parts.push(P.shape(smooth(lower), lipC, { outline: 0.5, gloss: !shaded && P.detail > 1, paint: lipPaint(lipC, false), shade: shaded ? false : 1 }))
      parts.push(P.shape(smooth(upper), shadowOf(lipC, 0.05), { outline: 0.5, paint: lipPaint(shadowOf(lipC, 0.05), true), shade: shaded ? false : 1 }))
      parts.push(gloss(s.cx - mw * 0.04, midY + tl * 0.5, mw * 0.16, tl * 0.24))
      // Light catches the ridge of the cupid's bow.
      if (rich) parts.push(softSpot(c, s.cx, midY - tu * 1.35 * bow, mw * 0.07, tu * 0.3, highlightOf(s.skin, 0.4), 0.45))
    } else if (shaded && s.style !== 'line') {
      // A bare lip still has a hint of colour, a soft lower lip and its shadow below.
      const hint = mix(lipC, s.skin, 0.3)
      parts.push(softSpot(c, s.cx, midY + mw * 0.08, mw * 0.24 * lerp(0.8, 1.15, s.lips), mw * 0.058 * lerp(0.7, 1.3, s.lips), hint, rich ? 0.55 : 0.42))
      if (rich) {
        parts.push(softSpot(c, s.cx, midY + mw * 0.16, mw * 0.2, mw * 0.045, skinShadow, 0.34))
        parts.push(softSpot(c, s.cx - mw * 0.05 + L0[0] * mw * 0.04, midY + mw * 0.07, mw * 0.07, mw * 0.018, WHITE, 0.16))
      }
    }
    parts.push(P.flat(brush(line, lineW * 0.28, lineW * 0.28, lineW * 0.62), ink))
    parts.push(cornerCreases())
    // Teeth that show even with the mouth shut.
    const toothPaint = shaded ? linearPaint(c, [[0, TOOTH_SHADE], [0.35, TOOTH], [1, TOOTH]]) : undefined
    const toothInk = mix(ink, TOOTH_SHADE, 0.35)
    if (s.teeth === 'fangs') {
      const fang = (x: number, sg: number): string => `M${f(x - mw * 0.045)} ${f(midY - lineW * 0.2)}Q${f(x - mw * 0.02)} ${f(midY + mw * 0.08)} ${f(x + sg * mw * 0.005)} ${f(midY + mw * 0.14)}Q${f(x + mw * 0.03)} ${f(midY + mw * 0.06)} ${f(x + mw * 0.045)} ${f(midY - lineW * 0.2)}Z`
      parts.push(P.shape(fang(s.cx - mw * 0.26, -1) + fang(s.cx + mw * 0.26, 1), TOOTH, { shade: false, outline: 0.35, ink: toothInk, paint: toothPaint }))
    }
    if (s.teeth === 'buck') parts.push(P.shape(roundRect(s.cx - mw * 0.11, midY - lineW * 0.3, mw * 0.22, mw * 0.15, mw * 0.045), TOOTH, { shade: false, outline: 0.35, ink: toothInk, paint: toothPaint }) + P.line(`M${f(s.cx)} ${f(midY + lineW * 0.2)}v${f(mw * 0.11)}`, TOOTH_SHADE, lineW * 0.25))
    return parts.join('')
  }

  // Open.
  const openH = open * mw * 0.52
  const smileDip = Math.max(0, s.smile) * mw * 0.12
  let upper: P[]
  let lower: P[]
  if (s.shape === 'grimace') {
    upper = [L, [lerp(L[0], R[0], 0.3), s.cy - openH * 0.18], [lerp(L[0], R[0], 0.7), s.cy - openH * 0.18], R]
    lower = [R, [lerp(L[0], R[0], 0.75), s.cy + openH * 0.62], [lerp(L[0], R[0], 0.25), s.cy + openH * 0.62], L]
  } else if (s.shape === 'wavy') {
    upper = [L, [lerp(L[0], R[0], 0.33), s.cy - openH * 0.1], [lerp(L[0], R[0], 0.66), s.cy + openH * 0.05], R]
    lower = [R, [lerp(L[0], R[0], 0.7), s.cy + openH * 0.7], [lerp(L[0], R[0], 0.4), s.cy + openH * 0.55], L]
  } else {
    const upDip = s.shape === 'd' ? 0 : -openH * 0.08 + smileDip * 0.2
    upper = [L, [lerp(L[0], R[0], 0.3), midY + upDip], [lerp(L[0], R[0], 0.7), midY + upDip], R]
    lower = [R, [lerp(L[0], R[0], 0.72), midY + openH + smileDip], [lerp(L[0], R[0], 0.28), midY + openH + smileDip], L]
  }
  const cavity = smooth([[L[0], L[1], 0], ...upper.slice(1, -1), [R[0], R[1], 0], ...lower.slice(1, -1)] as SP[])
  const clip = c.defs.add(keyOf('mo', cavity), (id) => el('clipPath', { id }, el('path', { d: cavity })))
  const cavFill = shaded ? radialPaint(c, [[0, mix(CAVITY, TONGUE, 0.25)], [0.55, CAVITY], [1, CAVITY_DEEP]], { cx: 0.5, cy: 0.85, r: 0.8 }) : P.col(CAVITY)
  const inside: string[] = [el('path', { d: cavity, fill: cavFill })]
  const topY = Math.min(upper[1][1], upper[2][1])
  const botY = Math.max(lower[1][1], lower[2][1])
  const toothH = mw * 0.1
  const teeth = s.teeth
  const showUpper = s.shape !== 'o'
  const upperTeethPaint = shaded ? linearPaint(c, [[0, TOOTH_SHADE], [0.4, TOOTH_SHADE], [0.62, TOOTH], [0.9, TOOTH], [1, mix(TOOTH, TOOTH_SHADE, 0.6)]]) : P.col(TOOTH)
  if (showUpper) {
    const band = roundRect(L[0] - 2, topY - toothH * 0.6, R[0] - L[0] + 4, toothH * 1.5, toothH * 0.3)
    if (teeth === 'sharp') {
      const zz: P[] = []
      for (let i = 0; i <= 8; i++) zz.push([lerp(L[0], R[0], i / 8), topY + (i % 2 ? toothH * 1.6 : toothH * 0.2)])
      inside.push(el('path', { d: poly([[L[0], topY - toothH], ...zz, [R[0], topY - toothH]]), fill: shaded ? linearPaint(c, [[0, TOOTH_SHADE], [0.45, TOOTH], [1, TOOTH]]) : P.col(TOOTH) }))
    } else {
      inside.push(el('path', { d: band, fill: upperTeethPaint }))
      // Separations between the front teeth.
      if (rich) inside.push(P.line([-0.2, -0.075, 0.075, 0.2].map((k) => `M${f(s.cx + k * mw)} ${f(topY - toothH * 0.3)}v${f(toothH * 1.15)}`).join(''), TOOTH_SHADE, lineW * 0.18, { opacity: 0.6 }))
      else if (P.detail > 1) inside.push(P.line(`M${f(L[0])} ${f(topY + toothH * 0.85)}H${f(R[0])}`, '#e2dbcf', lineW * 0.25, { opacity: 0.7 }))
    }
    if (teeth === 'gap') inside.push(P.flat(roundRect(s.cx - mw * 0.02, topY - toothH, mw * 0.04, toothH * 2, 1), CAVITY))
    if (teeth === 'missing') inside.push(P.flat(roundRect(s.cx + mw * 0.08, topY - toothH, mw * 0.09, toothH * 2, 1), CAVITY_DEEP))
    if (teeth === 'gold') {
      const gd = roundRect(s.cx - mw * 0.2, topY - toothH, mw * 0.09, toothH * 1.9, 2)
      inside.push(el('path', { d: gd, fill: shaded ? linearPaint(c, [[0, '#8a6212'], [0.45, GOLD], [0.6, '#fff1b0'], [1, '#c9921a']], [0, 0], [1, 0]) : P.col(GOLD) }))
    }
    if (teeth === 'braces') {
      inside.push(P.flat(roundRect(L[0], topY + toothH * 0.3, R[0] - L[0], toothH * 0.22, 1), '#8f99a4'))
      const bracket = shaded ? linearPaint(c, [[0, '#f4f7fa'], [0.5, '#c3cad2'], [1, '#7f8994']]) : P.col('#d0d6dd')
      for (let i = -3; i <= 3; i++) inside.push(el('path', { d: roundRect(s.cx + i * mw * 0.1 - mw * 0.022, topY + toothH * 0.12, mw * 0.044, toothH * 0.55, 1), fill: bracket }))
      if (rich) inside.push(P.line(`M${f(L[0])} ${f(topY + toothH * 0.35)}H${f(R[0])}`, WHITE, toothH * 0.06, { opacity: 0.7 }))
    }
    if (teeth === 'fangs') inside.push(el('path', { d: poly([[s.cx - mw * 0.3, topY], [s.cx - mw * 0.2, topY], [s.cx - mw * 0.25, topY + toothH * 2.2]]) + poly([[s.cx + mw * 0.2, topY], [s.cx + mw * 0.3, topY], [s.cx + mw * 0.25, topY + toothH * 2.2]]), fill: shaded ? linearPaint(c, [[0, TOOTH_SHADE], [0.3, TOOTH], [1, TOOTH]]) : P.col(TOOTH) }))
  }
  if (s.shape === 'grimace' || s.shape === 'teeth') {
    const lowerTeeth = roundRect(L[0] - 2, botY - toothH * 1.1, R[0] - L[0] + 4, toothH * 1.6, toothH * 0.3)
    inside.push(el('path', { d: lowerTeeth, fill: shaded ? linearPaint(c, [[0, mix(TOOTH, TOOTH_SHADE, 0.5)], [0.25, TOOTH], [0.6, TOOTH], [1, TOOTH_SHADE]]) : P.col(TOOTH) }))
    if (s.shape === 'grimace') inside.push(P.line([1, 2, 3, 4, 5].map((i) => `M${f(lerp(L[0], R[0], i / 6))} ${f(topY)}V${f(botY)}`).join('') + `M${f(L[0])} ${f((topY + botY) / 2)}H${f(R[0])}`, TOOTH_SHADE, lineW * 0.3))
    else if (rich) inside.push(P.line([-0.16, 0, 0.16].map((k) => `M${f(s.cx + k * mw)} ${f(botY - toothH * 0.9)}v${f(toothH)}`).join(''), TOOTH_SHADE, lineW * 0.16, { opacity: 0.5 }))
  } else if (open > 0.25) {
    const tongue = ellipse(s.cx, botY + mw * 0.02, mw * 0.28, openH * 0.42)
    inside.push(el('path', { d: tongue, fill: shaded ? radialPaint(c, [[0, highlightOf(TONGUE, 0.18)], [0.65, TONGUE], [1, shadowOf(TONGUE, 0.22)]], { cx: 0.5, cy: 0.25, r: 0.7 }) : P.col(TONGUE) }))
    if (rich) {
      inside.push(P.line(`M${f(s.cx)} ${f(botY - openH * 0.32)}v${f(openH * 0.22)}`, shadowOf(TONGUE, 0.25), lineW * 0.3, { opacity: 0.55 }))
      inside.push(softSpot(c, s.cx + L0[0] * mw * 0.08, botY - openH * 0.24, mw * 0.08, openH * 0.08, WHITE, 0.4))
    }
  }
  // Depth: the mouth darkens toward its corners and roof.
  if (shaded) inside.push(el('path', { d: cavity, fill: radialPaint(c, [[0, CAVITY_DEEP, 0], [0.62, CAVITY_DEEP, 0], [1, CAVITY_DEEP, 0.42]], { cx: 0.5, cy: 0.58, r: 0.62 }) }))
  parts.push(g({ 'clip-path': url(clip) }, ...inside))
  parts.push(P.line(cavity, ink, lineW * 0.8))
  if (showLips && P.detail > 0) {
    const tl = mw * 0.1 * lipScale
    const tu = mw * 0.06 * lipScale
    const up2: P[] = upper.map(([x, y]) => [x, y] as P)
    if (s.shape !== 'grimace' && !s.profile) {
      // Upper lip over the teeth, with the cupid's bow.
      const bow = s.style === 'heart' ? 1.5 : 1
      const top: SP[] = [0.2, 0.4, 0.5, 0.6, 0.8].map((t) => {
        const x = lerp(L[0], R[0], t)
        const dip = t === 0.5 ? tu * (1 - 0.4 * bow) : t === 0.4 || t === 0.6 ? tu * 1.15 * bow : tu * 0.75
        return [x, yAt(up2, x) - lineW * 0.2 - dip] as SP
      })
      const upperLip = smooth([[L[0], L[1], 0], ...top, [R[0], R[1], 0], ...up2.slice(1, -1).reverse().map(([x, y]) => [x, y - lineW * 0.15] as SP)])
      parts.push(P.shape(upperLip, shadowOf(lipC, 0.05), { outline: 0.4, paint: lipPaint(shadowOf(lipC, 0.05), true), shade: shaded ? false : 1 }))
    }
    const lowerLip = smooth([[L[0], L[1], 0], ...lower.slice(1, -1).reverse().map(([x, y]) => [x, y + lineW * 0.3] as SP), [R[0], R[1], 0], ...lower.slice(1, -1).map(([x, y]) => [x, y + tl] as SP)])
    parts.push(P.shape(lowerLip, lipC, { outline: 0.4, paint: lipPaint(lipC, false), shade: shaded ? false : 1 }))
    parts.push(gloss(s.cx, botY + lineW * 0.3 + tl * 0.5, mw * 0.14, tl * 0.25))
  }
  if (s.shape === 'tongue') {
    const ty = botY - mw * 0.02
    const tongue = smooth([[s.cx - mw * 0.2, ty], [s.cx + mw * 0.2, ty], [s.cx + mw * 0.2, ty + mw * 0.25], [s.cx, ty + mw * 0.36], [s.cx - mw * 0.2, ty + mw * 0.25]])
    parts.push(P.shape(tongue, TONGUE, { outline: 0.7, shade: shaded ? false : 1, paint: shaded ? radialPaint(c, [[0, highlightOf(TONGUE, 0.15)], [0.7, TONGUE], [1, shadowOf(TONGUE, 0.2)]], { cx: 0.5, cy: 0.35, r: 0.7 }) : undefined }))
    parts.push(P.line(`M${f(s.cx)} ${f(ty + mw * 0.02)}v${f(mw * 0.2)}`, shadowOf(TONGUE, 0.25), lineW * 0.4))
    if (shaded) parts.push(softSpot(c, s.cx - mw * 0.09 + L0[0] * mw * 0.03, ty + mw * 0.14, mw * 0.06, mw * 0.08, WHITE, rich ? 0.55 : 0.4))
  }
  parts.push(cornerCreases())
  if (rich) parts.push(softSpot(c, s.cx, botY + mw * (showLips ? 0.1 * lipScale + 0.1 : 0.1), mw * 0.3, mw * 0.06, skinShadow, 0.28))
  return parts.join('')
}

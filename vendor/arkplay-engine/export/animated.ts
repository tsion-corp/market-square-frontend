/* Animated SVG: one self-contained file that plays a clip in any browser, using CSS
 * keyframes of bone matrices. Parts whose shape changes over time (a blinking eye, a
 * talking mouth) are emitted once per distinct shape and shown/hidden with step
 * keyframes. Static renderers (and resvg) see frame 0, because every element also
 * carries frame 0 as its transform attribute. */

import { f } from '../core/path.ts'
import { matrixAttr } from '../core/svg.ts'
import type { AvatarDNA } from '../dna/types.ts'
import { cropBox, documentSVG } from '../render/compose.ts'
import { buildModel } from '../render/model.ts'
import type { RenderOptions } from '../render/types.ts'
import { sampleAnim } from './frames.ts'

export interface AnimatedOptions extends RenderOptions {
  anim: string
  fps?: number
  maxFrames?: number
  /** Play once instead of looping (default: the clip's own looping). */
  once?: boolean
}

const cssMatrix = (m: readonly number[]) => `matrix(${m.map((v) => f(v)).join(',')})`

export function animatedSVG(dna: AvatarDNA, o: AnimatedOptions): string {
  const model = buildModel(dna, o)
  const a = sampleAnim(model, o.anim, { ...o, maxFrames: o.maxFrames ?? 36 })
  const n = a.frames.length
  const dur = Math.max(0.05, a.duration || n / a.fps)
  const box = o.viewBox ?? (o.crop && o.crop !== 'fit' ? cropBox(model, o.crop, a.frames[0].parts, a.frames[0].mats, o.padding ?? 0) : squareOf(a.box, 0.06 + (o.padding ?? 0)))
  const iter = o.once || !a.loop ? '1' : 'infinite'
  const prefix = model.ctx.defs.prefix
  let css = ''
  let body = ''
  let cls = 0

  // Static parts keep their identity across frames: animate their transforms.
  const statics = model.staticParts.slice().map((p, i) => ({ p, i })).sort((x, y) => x.p.z - y.p.z || x.i - y.i)
  // Group the draw list by z so dynamic variants interleave correctly.
  type Item = { z: number; order: number; svg: string }
  const items: Item[] = []
  statics.forEach(({ p }, order) => {
    const mats = a.frames.map((fr) => fr.mats.get(p.bone))
    if (!mats[0] && p.bone !== 'world') return
    const first = mats[0]
    const moves = mats.some((m, i) => i > 0 && m && first && m.some((v, k) => Math.abs(v - first[k]) > 1e-3))
    if (p.bone === 'world' || !first) {
      items.push({ z: p.z, order, svg: p.svg })
      return
    }
    if (!moves) {
      items.push({ z: p.z, order, svg: `<g transform="${matrixAttr(first)}">${p.svg}</g>` })
      return
    }
    const name = `${prefix}a${cls++}`
    const frames = mats.map((m, i) => `${f((i / n) * 100)}%{transform:${cssMatrix(m ?? first)}}`).join('')
    css += `@keyframes ${name}{${frames}100%{transform:${cssMatrix(a.loop ? first : (mats[n - 1] ?? first))}}}.${name}{animation:${name} ${f(dur)}s linear ${iter} both}`
    items.push({ z: p.z, order, svg: `<g class="${name}" transform="${matrixAttr(first)}">${p.svg}</g>` })
  })

  // Dynamic parts: one element per distinct (id, shape, matrix-track), visible when active.
  const dyn = new Map<string, { z: number; svg: string; mats: (number[] | undefined)[]; on: boolean[] }>()
  a.frames.forEach((fr, i) => {
    for (const p of fr.parts) {
      if (!p.dynamic) continue
      const key = `${p.id}|${p.svg}`
      let e = dyn.get(key)
      if (!e) {
        e = { z: p.z, svg: p.svg, mats: new Array(n).fill(undefined), on: new Array(n).fill(false) }
        dyn.set(key, e)
      }
      e.on[i] = true
      e.mats[i] = p.bone === 'world' ? undefined : (fr.mats.get(p.bone) as number[] | undefined)
    }
  })
  let order = statics.length
  for (const e of dyn.values()) {
    const name = `${prefix}d${cls++}`
    const firstOn = e.on.findIndex(Boolean)
    const ref = (e.mats[firstOn] ?? e.mats.find(Boolean)) as number[] | undefined
    const vis = e.on.map((on, i) => `${f((i / n) * 100)}%{opacity:${on ? 1 : 0}}`).join('')
    const always = e.on.every(Boolean)
    const moves = ref ? e.mats.some((m) => m && m.some((v, k) => Math.abs(v - ref[k]) > 1e-3)) : false
    const tf = moves ? e.mats.map((m, i) => `${f((i / n) * 100)}%{transform:${cssMatrix(m ?? ref ?? [1, 0, 0, 1, 0, 0])}}`).join('') : ''
    let anim = ''
    if (!always) {
      css += `@keyframes ${name}v{${vis}}`
      anim += `${name}v ${f(dur)}s step-end ${iter} both`
    }
    if (moves) {
      css += `@keyframes ${name}t{${tf}}`
      anim += `${anim ? ',' : ''}${name}t ${f(dur)}s linear ${iter} both`
    }
    if (anim) css += `.${name}{animation:${anim}}`
    const opacity0 = e.on[0] ? '' : ' opacity="0"'
    const svg = ref ? `<g class="${name}" transform="${matrixAttr(ref)}"${opacity0}>${e.svg}</g>` : `<g class="${name}"${opacity0}>${e.svg}</g>`
    items.push({ z: e.z, order: order++, svg })
  }
  items.sort((x, y) => x.z - y.z || x.order - y.order)
  body = items.map((i) => i.svg).join('')
  css += '@media (prefers-reduced-motion: reduce){*{animation-play-state:paused!important}}'
  return documentSVG(model, body, { ...o, box, css })
}

function squareOf(b: { x: number; y: number; w: number; h: number }, pad: number) {
  const side = Math.max(b.w, b.h) * (1 + pad * 2)
  return { x: b.x + b.w / 2 - side / 2, y: b.y + b.h / 2 - side / 2, w: side, h: side }
}

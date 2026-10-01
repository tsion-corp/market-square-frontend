/* Accessories on creatures: the same art as humanoids, against frames computed from the
 * creature rig. A crown sits on a dragon's skull, a bow tie on a cat's neck. */

import { DEG } from '../../core/math.ts'
import { artBounds, boxedParts } from './coat.ts'
import type { Ctx, PartList } from '../../render/context.ts'
import type { FrameState } from '../../render/types.ts'
import type { CreatureRig } from '../../rig/creature.ts'
import { drawBackAcc, drawNeckAcc, drawWing } from '../shared/accBody.ts'
import { drawCustom } from '../shared/accCustom.ts'
import { drawEyewear, drawFaceAcc } from '../shared/accFace.ts'
import { drawAura } from '../shared/accFx.ts'
import { drawHeadwear } from '../shared/accHead.ts'
import type { EyeFrame, HeadFrame, NeckFrame } from '../shared/frames.ts'
import { CZ, headGeo, tvFace } from './head.ts'

function headInfo(c: Ctx): { bone: string; R: number; top: number; cx: number; frontal: boolean; cy: number } {
  const cr = c.cr as CreatureRig
  const m = cr.m
  if (m.frontFacing && m.plan !== 'robot') {
    const R = m.bodyR * 0.85
    const drop = m.plan === 'blob' && c.sec('form').s('blobShape') === 'drop'
    return { bone: 'body', R, top: drop ? -m.bodyR * 1.3 : -m.bodyR * (m.plan === 'cephalopod' ? 1.1 : 0.95), cx: 0, frontal: true, cy: 0 }
  }
  const tv = tvFace(c)
  if (tv) return { bone: 'head', R: m.headR, top: -m.headR * 0.86, cx: 0, frontal: true, cy: 0 }
  const hg = headGeo(c)
  return { bone: 'head', R: hg.R, top: -hg.R * 0.95, cx: hg.frontal || m.frontFacing ? 0 : -hg.R * 0.12, frontal: hg.frontal || m.frontFacing, cy: 0 }
}

export function creatureAccessoriesGen(c: Ctx, out0: PartList): void {
  const out = boxedParts(out0)
  const cr = c.cr as CreatureRig
  const m = cr.m
  const h = headInfo(c)
  // Front-facing plans turn their back in the back view; profile heads turn away.
  const away = c.view === 'back'
  const hf: HeadFrame = {
    bone: h.bone,
    view: away ? 'back' : h.frontal ? 'front' : 'side',
    facing: 1,
    cx: h.cx,
    band: h.top + h.R * 0.38,
    top: h.top,
    hw: h.R * (h.frontal ? 0.72 : 0.62),
    hh: h.R * 1.35,
    brow: h.top + h.R * 0.55,
    earY: h.top + h.R,
    earX: h.R * 0.85,
    longHair: false,
  }
  for (const it of c.items) {
    const id = it.art
    const p = it.p
    switch (it.spec.slot) {
      case 'head': {
        const d = drawHeadwear(c, id, p, hf)
        if (d.back) out.add(h.bone, CZ.head - 2, `${id}-back`, d.back)
        if (d.front) out.add(h.bone, CZ.horns + 2, id, d.front)
        break
      }
      case 'eyes':
      case 'face': {
        const hg = headGeo(c)
        const frontalHead = h.frontal
        const w = h.R * 0.4
        const tv = tvFace(c)
        const bodyFace = m.frontFacing && m.plan !== 'robot'
        const fish = m.plan === 'aquatic' && frontalHead
        const ex = tv ? tv.R * 0.36 : bodyFace ? h.R * 0.36 : fish ? h.R * 0.3 : hg.eyeX
        const ox = tv ? tv.cx : fish ? -h.R * 0.1 : 0
        const ef: EyeFrame = {
          bone: h.bone,
          view: away ? 'back' : frontalHead ? 'front' : 'side',
          facing: 1,
          y: tv ? tv.cy - tv.R * 0.18 : (bodyFace ? -h.R * 0.25 : hg.eyeY) + h.cy,
          xs: frontalHead ? [-ex + ox, ex + ox] : [hg.eyeX],
          w,
          faceHalf: h.R * 0.85,
          noseY: (frontalHead ? h.R * 0.25 : h.R * 0.05) + h.cy,
          mouthY: (frontalHead ? h.R * 0.45 : h.R * 0.3) + h.cy,
          hh: h.R * 1.4,
        }
        out.add(h.bone, it.spec.slot === 'eyes' ? CZ.eyes + 3 : CZ.mouth + 3, `${id}-${it.index}`, it.spec.slot === 'eyes' ? drawEyewear(c, id, p, ef) : drawFaceAcc(c, id, p, ef))
        break
      }
      case 'neck': {
        if (m.frontFacing) {
          const f: NeckFrame = { bone: 'body', view: away ? 'back' : 'front', facing: 1, y: m.plan === 'robot' ? -m.bodyR * 0.95 : m.bodyR * 0.1, cx: 0, r: m.bodyR * (m.plan === 'robot' ? 0.3 : 0.55), chest: m.bodyR * 0.6, drop: m.bodyR * 0.3 }
          out.add('body', CZ.acc, `${id}-${it.index}`, drawNeckAcc(c, id, p, f))
          break
        }
        // Along the neck: rotate a frontal collar so it wraps the neck.
        const head = c.skel.get('head')
        const nx = head?.x ?? 1
        const ny = head?.y ?? -1
        const ang = Math.atan2(ny, nx) / DEG + 90
        const r = Math.min(m.headR * 0.55, m.bodyR * 0.6) * 1.05
        const f: NeckFrame = { bone: 'neck', view: 'front', facing: 1, y: 0, cx: 0, r, chest: r * 1.4, drop: r * 0.8 }
        out.add('neck', CZ.neck + 2, `${id}-${it.index}`, `<g transform="translate(${(nx * 0.3).toFixed(1)} ${(ny * 0.3).toFixed(1)}) rotate(${ang.toFixed(1)})">${drawNeckAcc(c, id, p, f)}</g>`)
        break
      }
      case 'back': {
        // Front-facing plans show their back in the back view: back items come to the front.
        const turned = m.frontFacing && away
        const span = m.frontFacing ? m.bodyR * 0.8 : m.bodyLen * 0.3
        const f = { bone: 'back', view: m.frontFacing ? (turned ? ('back' as const) : ('front' as const)) : ('side' as const), facing: 1, span, len: m.frontFacing ? m.bodyR * 1.4 : m.bodyR * 1.2, hang: m.frontFacing ? m.bodyR * 1.6 : m.bodyR * 1.4 + m.legLen * 0.5 }
        if (id.endsWith('wings')) {
          const art = drawWing(c, id, p, { ...f, span: m.frontFacing ? m.bodyR * 1.3 : m.bodyLen * 0.45 })
          const zw = turned ? CZ.acc - 10 : CZ.wingFar
          if (m.frontFacing) {
            out.add('wingN', zw, `${id}-r`, art)
            out.add('wingF', zw, `${id}-l`, `<g transform="scale(-1 1)">${art}</g>`, false, artBounds(art, -1, 1))
          } else {
            out.add('wingF', CZ.wingFar, `${id}-far`, `<g transform="scale(-0.9 0.9)">${art}</g>`, false, artBounds(art, -0.9, 0.9))
            out.add('wingN', CZ.wingNear, `${id}-near`, `<g transform="scale(-1 1)">${art}</g>`, false, artBounds(art, -1, 1))
          }
          break
        }
        const d = drawBackAcc(c, id, p, f)
        const flip = (s: string) => (m.frontFacing ? s : `<g transform="scale(-1 1)">${s}</g>`)
        const fb = (s: string) => (m.frontFacing ? undefined : artBounds(s, -1, 1))
        if (d.behind) out.add('back', CZ.wingFar + 5, `${id}-behind`, flip(d.behind), false, fb(d.behind))
        if (d.front) out.add('back', CZ.acc, id, d.front)
        break
      }
      case 'custom': {
        const anchor = p.s('anchor') || 'head'
        const scale = anchor === 'head' || anchor === 'face' || anchor === 'eyes' ? h.R * 1.2 : m.frontFacing ? m.bodyR * 1.4 : m.bodyLen * 0.4
        const bone = anchor === 'head' || anchor === 'face' || anchor === 'eyes' ? h.bone : anchor === 'back' ? 'back' : anchor === 'feet' || anchor === 'float' || anchor === 'background' ? 'root' : m.frontFacing ? 'body' : 'spine1'
        const y = anchor === 'head' ? h.top : anchor === 'float' ? -(m.frontFacing ? m.bodyR * 3 : m.legLen + m.bodyR * 3) : 0
        const z = p.s('layer') === 'behind' ? CZ.wingFar - 5 : p.s('layer') === 'top' ? CZ.acc + 20 : CZ.acc + 5
        out.add(bone, z, `custom-${it.index}`, `<g transform="translate(0 ${y.toFixed(1)})">${drawCustom(c, it, scale)}</g>`)
        break
      }
    }
  }
}

export function creatureAuraGen(c: Ctx, f: FrameState, out: PartList): void {
  const it = c.item('aura')
  if (!it) return
  const m = (c.cr as CreatureRig).m
  const w = m.frontFacing ? m.bodyR * 3 : m.bodyLen + m.headR * 2 + m.tailLen * 0.6
  const top = m.frontFacing ? m.bodyY - m.bodyR * 1.6 - (m.plan === 'robot' ? m.headR * 2 : 0) : m.bodyY - m.bodyR - m.neckLen - m.headR * 1.4
  const region = { x: -w / 2, y: top, w, h: -top }
  const d = drawAura(c, it.art, it.p, region, f.t, c.dna.seed)
  if (d.behind) out.add('world', -900, 'aura-behind', d.behind)
  if (d.front) out.add('world', 500, 'aura', d.front)
}

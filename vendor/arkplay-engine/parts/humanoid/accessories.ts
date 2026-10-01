/* Placing accessories on a humanoid: compute anchor frames from the rig, call the shared
 * art, and put each piece on the right bone at the right depth for the view. */

import type { Ctx, PartList } from '../../render/context.ts'
import { Z } from '../../render/context.ts'
import type { HumanRig } from '../../rig/humanoid.ts'
import type { FrameState, Side } from '../../render/types.ts'
import { drawBackAcc, drawNeckAcc, drawTailAcc, drawWaistAcc, drawWing, drawWristAcc } from '../shared/accBody.ts'
import { drawCustom } from '../shared/accCustom.ts'
import { drawEarAcc, drawEyewear, drawFaceAcc } from '../shared/accFace.ts'
import { drawAura } from '../shared/accFx.ts'
import { drawHairAcc, drawHeadFeature, drawHeadwear } from '../shared/accHead.ts'
import { drawHeld, drawShield } from '../shared/accHeld.ts'
import type { BackFrame, EyeFrame, HandFrame, HeadFrame, NeckFrame, WaistFrame } from '../shared/frames.ts'
import { limbZ, thumbSign } from './body.ts'
import { faceAnchors } from './face.ts'
import { bodyHalfAt } from './garments.ts'
import { hairCoversEars } from './hair.ts'
import { hairColorOf } from './hairColor.ts'
import { faceGeom } from './head.ts'

export function headFrame(c: Ctx): HeadFrame {
  const m = (c.hr as HumanRig).m
  const side = c.view === 'side'
  const fw = side ? m.hw : faceGeom(c).widthAt(m.earY)
  return {
    bone: 'head',
    view: c.view,
    facing: 1,
    cx: side ? -m.hw * 0.08 : 0,
    band: -m.headH * 0.64,
    top: -m.headH * 0.93 - m.hairLift,
    hw: m.hw * 1.03 + m.hairLift * 0.35 + m.headH * 0.02,
    hh: m.headH,
    brow: m.eyeY - m.headH * 0.12,
    earY: m.earY,
    earX: fw * 0.97 + m.headH * 0.02,
    longHair: hairCoversEars(c),
  }
}

function eyeFrame(c: Ctx): EyeFrame {
  const a = faceAnchors(c)
  const hr = c.hr as HumanRig
  const side = c.view === 'side'
  return {
    bone: 'head',
    view: c.view,
    facing: 1,
    y: a.eyeY,
    xs: side ? [a.hw * 0.6] : [a.spacing * hr.sx, -a.spacing * hr.sx].sort((x, y) => x - y),
    w: a.eyeW,
    faceHalf: side ? a.hw * 0.9 : faceGeom(c).widthAt(a.eyeY),
    noseY: a.noseY,
    mouthY: a.mouthY,
    hh: a.headH,
  }
}

export function accessoriesGen(c: Ctx, out: PartList): void {
  const hr = c.hr as HumanRig
  const m = hr.m
  const T = m.torsoLen
  const side = c.view === 'side'
  const back = c.view === 'back'
  const hairCol = hairColorOf(c)
  const hf = headFrame(c)
  const ef = eyeFrame(c)
  let hairAccIndex = 0

  for (const it of c.items) {
    const slot = it.spec.slot
    const id = it.art
    const p = it.p
    switch (slot) {
      case 'head': {
        const d = drawHeadwear(c, id, p, hf)
        if (d.back) out.add('head', back ? Z.hat - 1 : Z.hairBack + 10, `${id}-back`, d.back)
        if (d.front) out.add('head', Z.hat, id, d.front)
        break
      }
      case 'headFeature': {
        const d = drawHeadFeature(c, id, p, hf, hairCol)
        if (d.under) out.add('head', Z.hairCap - 0.8, `${id}-under`, d.under)
        if (d.front) out.add('head', id === 'halo' ? Z.hat + 2 : Z.hairCap + 1, id, d.front)
        break
      }
      case 'hairAcc':
        if (!c.hides('hair')) out.add('head', Z.hairAcc, `${id}-${hairAccIndex}`, drawHairAcc(c, id, p, hf, hairAccIndex++))
        break
      case 'eyes':
        out.add('head', Z.eyewear, id, drawEyewear(c, id, p, ef))
        break
      case 'face':
        out.add('head', Z.faceAcc, `${id}-${it.index}`, drawFaceAcc(c, id, p, ef))
        break
      case 'ears': {
        if (c.hides('ears') && id !== 'headphones') break
        const d = drawEarAcc(c, id, p, hf)
        if (d.under) out.add('head', Z.earring, `${id}-${it.index}`, d.under)
        if (d.over) out.add('head', Z.headphones, `${id}-${it.index}-over`, d.over)
        break
      }
      case 'neck': {
        const f: NeckFrame = { bone: 'chest', view: c.view, facing: 1, y: -T * 0.37, cx: side ? m.chestDepth * 0.1 : 0, r: m.neckR * 1.15, chest: m.chestHalf, drop: T * 0.2 }
        out.add('chest', id === 'scarf' ? Z.scarf : Z.neckAcc, `${id}-${it.index}`, drawNeckAcc(c, id, p, f))
        break
      }
      case 'back': {
        const f: BackFrame = { bone: 'back', view: c.view, facing: 1, span: m.shoulderHalf, len: T, hang: T * 0.8 + m.legLen * 0.55 }
        if (id.endsWith('wings')) {
          for (const s of ['L', 'R'] as const) {
            const mirror = side ? true : (s === 'L' ? hr.sx : -hr.sx) < 0
            // Each side is drawn on its own (unique ids, and lit correctly once mirrored).
            const wing = drawWing(c, id, p, { ...f, span: m.shoulderHalf * 2.1 }, mirror)
            const svg = mirror ? `<g transform="scale(-1 1)">${wing}</g>` : wing
            const z = back ? Z.fx - 60 : side && s === 'R' ? Z.outer + 3 : Z.wings
            out.add(`wing${s}`, z, `${id}-${s}`, svg)
          }
          break
        }
        const d = drawBackAcc(c, id, p, f)
        const bone = id === 'cape' ? 'cape' : 'back'
        const flipSide = (svg: string) => (side ? `<g transform="scale(-1 1)">${svg}</g>` : svg)
        if (d.behind) out.add(bone, back ? Z.fx - 60 : id === 'cape' ? Z.capeBack : Z.capeBack + 5, `${id}-behind`, flipSide(d.behind))
        if (d.front) out.add(bone, back ? Z.fx - 55 : Z.outer + 2, id, d.front)
        break
      }
      case 'waist': {
        const y = -T * 0.1
        const f: WaistFrame = { bone: 'hips', view: c.view, y, half: bodyHalfAt(m, y) + m.armR * 0.25, depth: m.bellyDepth + m.armR * 0.2 }
        out.add('hips', Z.belt, id, drawWaistAcc(c, id, p, f))
        break
      }
      case 'wrist': {
        const which = p.s('side') || 'left'
        const sides: Side[] = which === 'both' ? ['L', 'R'] : which === 'right' ? ['R'] : ['L']
        for (const s of sides) out.add(`forearm${s}`, limbZ(c, s, Z.wrist, true), `${id}-${s}`, drawWristAcc(c, id, p, m.wristR * 1.08, m.forearm * 0.9))
        break
      }
      case 'handL':
      case 'handR': {
        const s: Side = slot === 'handL' ? 'L' : 'R'
        if (id === 'shield') {
          out.add(`forearm${s}`, limbZ(c, s, Z.glove + 2, true), `shield-${s}`, drawShield(c, p, m.forearm * 0.42, m.forearm * 0.55))
          break
        }
        const f: HandFrame = { bone: `hand${s}`, view: c.view, x: 0, y: m.handLen * 0.55, s: m.handLen * 0.9, thumb: thumbSign(c, s) }
        const d = drawHeld(c, id, p, f)
        if (d.behind) out.add(`hand${s}`, limbZ(c, s, Z.held, true), `${id}-${s}-b`, d.behind)
        if (d.front) out.add(`hand${s}`, limbZ(c, s, Z.heldFront, true), `${id}-${s}`, d.front)
        break
      }
      case 'tailAcc': {
        const svg = drawTailAcc(c, id, p, m.legLen, side ? 1 : 1, hairCol)
        out.add('tail', back ? Z.fx - 50 : Z.tail, id, svg)
        break
      }
      case 'custom': {
        const anchor = p.s('anchor') || 'head'
        const layer = p.s('layer') || 'front'
        const A: Record<string, [string, number, number, number]> = {
          head: ['head', 0, -m.headH * 0.95 - m.hairLift, m.headH],
          face: ['head', side ? m.hw * 0.5 : 0, -m.headH * 0.35, m.headH * 0.8],
          eyes: ['head', side ? m.hw * 0.6 : 0, m.eyeY, m.headH * 0.6],
          neck: ['chest', 0, -T * 0.36, m.neckR * 3],
          chest: ['chest', side ? m.chestDepth * 0.5 : 0, -T * 0.1, m.chestHalf * 1.5],
          back: ['back', 0, 0, m.shoulderHalf * 2],
          waist: ['hips', 0, -T * 0.1, m.hipHalf * 1.5],
          handL: ['handL', 0, m.handLen * 0.55, m.handLen * 2],
          handR: ['handR', 0, m.handLen * 0.55, m.handLen * 2],
          feet: ['root', 0, 0, m.footLen * 2],
          float: ['root', m.H * 0.32, -m.H * 0.78, m.headH],
          background: ['root', 0, -m.H * 0.5, m.H],
        }
        const [bone, x, y, scale] = A[anchor] ?? A.head
        const baseZ = anchor === 'background' ? Z.auraBack - 5 : anchor === 'head' || anchor === 'face' || anchor === 'eyes' ? Z.hat + 5 : anchor.startsWith('hand') ? Z.heldFront + 1 : anchor === 'back' ? Z.capeBack + 10 : Z.outer + 5
        const z = layer === 'behind' ? Z.wings - 5 : layer === 'top' ? Z.fx + 10 : baseZ
        out.add(bone, z, `custom-${it.index}`, drawCustom(c, it, scale, [x, y]))
        break
      }
    }
  }
}

/** Auras move with time, so they are dynamic parts in world space. */
export function auraGen(c: Ctx, f: FrameState, out: PartList): void {
  const it = c.item('aura')
  if (!it) return
  const hr = c.hr
  const H = hr ? hr.m.H + hr.m.hairLift : 600
  const region = { x: -H * 0.36, y: -H * 1.02, w: H * 0.72, h: H * 1.02 }
  const d = drawAura(c, it.art, it.p, region, f.t, c.dna.seed)
  // Known bounds (the region plus room for glows): no per-frame scan of the particle markup.
  const pad = Math.min(region.w, region.h) * 0.12
  const bounds = { x: region.x - pad, y: region.y - pad, w: region.w + pad * 2, h: region.h + pad * 2 }
  if (d.behind) out.add('world', Z.auraBack, 'aura-behind', d.behind, false, bounds)
  if (d.front) out.add('world', Z.fx, 'aura', d.front, false, bounds)
}

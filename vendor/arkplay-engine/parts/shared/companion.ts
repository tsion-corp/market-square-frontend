/* Pet companions: where the pet goes. The pet itself (a complete creature made by the
 * creature engine from its species, variation and colour, drawn by the model builder) is
 * premium art: registered premium art draws it (render/premiumArt.ts), and builds
 * without it draw a placeholder at the same spot. This module stays free of renderer imports. */

import { applyM, lerp, type Box } from '../../core/math.ts'
import { ellipse, smooth } from '../../core/path.ts'
import type { AvatarDNA } from '../../dna/types.ts'
import { Z, type Ctx, type PartList, type ResolvedItem } from '../../render/context.ts'
import { isPremiumArt, registeredArt } from '../../render/premiumArt.ts'
import { CZ } from '../creature/head.ts'
import { lockBadge, VEIL } from './placeholder.ts'

export interface PetArt {
  /** The pet in its own world space (ground at y = 0, facing +x in profile). */
  svg: string
  /** Its bounds in that space. */
  box: Box
}

export type PetBuilder = (pet: AvatarDNA) => PetArt

interface Spot {
  bone: string
  z: number
  /** Largest dimension of the pet, world units. */
  extent: number
  /** Where the pet goes, in the bone's space. */
  x: number
  y: number
  /** 'ground': x is the pet's inner edge and y its ground line. 'sit': bottom-centre. 'center': box centre. */
  mode: 'ground' | 'sit' | 'center'
  /** Which way the pet sits from x in 'ground'/'center' mode: +1 to the right, -1 left. */
  dir: number
}

/** Where a pet of size `size` (0..1) sits for `place` (ground, float, shoulder), in its owner's bone space. */
export function spotFor(c: Ctx, place: string, size: number): Spot {
  const hr = c.hr
  if (hr) {
    const m = hr.m
    const side = c.view === 'side'
    const halfW = side ? m.chestDepth * 0.7 + m.armR : m.shoulderHalf + m.armR * 1.2
    if (place === 'shoulder') {
      const shoulderX = m.shoulderHalf - m.armR * 0.62
      return {
        bone: 'chest',
        z: Z.held - 0.5,
        extent: m.H * lerp(0.1, 0.2, size),
        // In profile, sit behind the neck so the pet never covers the chin.
        x: side ? -m.chestDepth * 0.3 : hr.sx * shoulderX * 0.92,
        y: -m.torsoLen * 0.38 - m.armR * 0.15,
        mode: 'sit',
        dir: 1,
      }
    }
    // In profile the pet follows behind its owner.
    const dir = side ? -1 : 1
    if (place === 'float') {
      const headY = -(m.legLen + m.torsoLen + m.neckLen + m.headH * 0.55)
      return { bone: 'root', z: Z.fx - 20, extent: m.H * lerp(0.13, 0.3, size), x: dir * (halfW + m.headH * 0.35), y: headY, mode: 'center', dir }
    }
    return { bone: 'root', z: Z.farLeg - 30, extent: m.H * lerp(0.16, 0.42, size), x: dir * (halfW + m.headH * 0.12), y: 0, mode: 'ground', dir }
  }

  const cr = c.cr
  if (!cr) return { bone: 'root', z: Z.farLeg - 30, extent: 200, x: 200, y: 0, mode: 'ground', dir: 1 }
  const m = cr.m
  // Owner height and the edge of the owner on the pet's side (+x, in front of the face).
  const world = c.skel.world({})
  const top = c.skel.anchors.headTop
  const topM = top ? world.get(top.bone) : undefined
  const ownerH = top && topM ? Math.max(m.bodyR, -applyM(topM, [top.x, top.y])[1]) : m.bodyR * 2.5
  const headM = world.get('head')
  const front = m.frontFacing ? m.bodyR * 1.1 + m.armLen * 0.25 : Math.max(m.bodyLen / 2, (headM?.[4] ?? 0) + m.headR + m.snout * 0.8)
  if (place === 'shoulder') {
    if (m.frontFacing) {
      return { bone: top?.bone ?? 'head', z: CZ.acc + 5, extent: ownerH * lerp(0.2, 0.36, size), x: top?.x ?? 0, y: top?.y ?? -m.bodyR, mode: 'sit', dir: 1 }
    }
    return { bone: 'back', z: CZ.acc + 2, extent: ownerH * lerp(0.2, 0.36, size), x: 0, y: -m.bodyR * 0.22, mode: 'sit', dir: 1 }
  }
  if (place === 'float') {
    const headY = headM ? headM[5] : -ownerH * 0.7
    return { bone: 'root', z: Z.fx - 20, extent: ownerH * lerp(0.2, 0.45, size), x: front + m.headR * 0.5, y: headY - m.headR, mode: 'center', dir: 1 }
  }
  return { bone: 'root', z: -160, extent: ownerH * lerp(0.28, 0.6, size), x: front + m.headR * 0.25, y: 0, mode: 'ground', dir: 1 }
}

export function companionParts(c: Ctx, out: PartList, build: PetBuilder): void {
  const it = c.item('companion')
  if (!it) return
  const art = registeredArt('companion', it.art)
  if (art) return art(c, it, out, build)
  if (isPremiumArt(it.art)) petPlaceholder(c, it, out)
}

/** A soft neutral pet-sized silhouette with a lock, where the pet would be. */
function petPlaceholder(c: Ctx, it: ResolvedItem, out: PartList): void {
  const p = it.p
  const spot = spotFor(c, p.s('place') || 'ground', p.has('size') ? p.n('size') : 0.5)
  // A pet's box is about 5:4 with its feet on y = 0.
  const w = spot.extent
  const h = spot.extent * 0.8
  const left = spot.mode === 'ground' || spot.mode === 'center' ? (spot.dir > 0 ? spot.x : spot.x - w) : spot.x - w / 2
  const top = spot.mode === 'ground' ? spot.y - h : spot.mode === 'sit' ? spot.y - h : spot.y - h / 2
  const P = c.paint
  const body = smooth([
    [left + w * 0.1, top + h, 0.5],
    [left + w * 0.03, top + h * 0.6],
    [left + w * 0.2, top + h * 0.14],
    [left + w * 0.5, top],
    [left + w * 0.8, top + h * 0.14],
    [left + w * 0.97, top + h * 0.6],
    [left + w * 0.9, top + h, 0.5],
  ])
  let svg = spot.mode === 'ground' ? P.flat(ellipse(left + w / 2, spot.y, w * 0.45, Math.max(1.5, w * 0.06)), '#1d1426', 0.18) : ''
  svg += P.shape(body, VEIL, { shade: 0.3, outline: 0.7, material: 'cloth', spec: 0 })
  svg += lockBadge(c, left + w / 2, top + h * 0.48, w * 0.12)
  const y0 = Math.min(top, spot.y)
  out.add(spot.bone, spot.z, 'companion', svg, false, { x: left, y: y0, w, h: Math.max(h, Math.max(top + h, spot.y) - y0) })
}

/* Building an avatar model: the rig, the static parts (drawn once) and the dynamic part
 * generators (face and hands, rebuilt per frame). One model serves every frame of an
 * animation, which keeps sprite-sheet and GIF exports fast. */

import { expressionState } from '../anim/expression.ts'
import { humanPose } from '../anim/poses.ts'
import { creaturePose } from '../anim/creaturePoses.ts'
import { padBox, type Box } from '../core/math.ts'
import type { AvatarDNA } from '../dna/types.ts'
import { creatureRig } from '../rig/creature.ts'
import { humanRig } from '../rig/humanoid.ts'
import type { Pose } from '../rig/skeleton.ts'
import { createCtx, PartList, type Ctx } from './context.ts'
import { HUMANOID_GENS } from '../parts/humanoid/index.ts'
import { CREATURE_GENS } from '../parts/creature/index.ts'
import { SHARED_GENS } from '../parts/shared/index.ts'
import { companionParts, type PetBuilder } from '../parts/shared/companion.ts'
import { finalizePose } from '../anim/evaluate.ts'
import { layoutFrame, partsSVG, worldBounds } from './compose.ts'
import type { ExprState, FrameState, HandShape, Part, RenderOptions, Side, View } from './types.ts'

export type StaticGen = (c: Ctx, out: PartList) => void
export type DynamicGen = (c: Ctx, f: FrameState, out: PartList) => void

export interface GenSet {
  static: StaticGen[]
  dynamic: DynamicGen[]
}

export interface Model {
  ctx: Ctx
  view: View
  staticParts: Part[]
  dynamic: DynamicGen[]
  restPose: Pose
  restHands: Record<Side, HandShape>
  baseExpr: ExprState
  boxes: { head: Box; bust: Box; portrait: Box; full: Box }
}

let prefixCounter = 0

export function buildModel(dna: AvatarDNA, opts: RenderOptions = {}): Model {
  const view: View = opts.view ?? 'front'
  const idPrefix = opts.idPrefix ?? `av${(prefixCounter++).toString(36)}`
  const baked = (opts.quality ?? (opts.anim ? 'standard' : 'high')) === 'high'
  const motion = !opts.anim && (opts.motion ?? baked)
  const expr = dna.sections.expression ?? {}
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d)
  const baseExpr = expressionState(
    opts.expression ?? (typeof expr.preset === 'string' ? expr.preset : 'happy'),
    num(expr.intensity, 0.8),
    { lookX: (num(expr.lookX, 0.5) - 0.5) * 2, lookY: (num(expr.lookY, 0.5) - 0.5) * 2, tilt: (num(expr.tilt, 0.5) - 0.5) * 24 },
  )

  if (dna.kind === 'creature') {
    const cr = creatureRig(dna, view)
    const ctx = createCtx({ dna, view, idPrefix, skel: cr.skel, cr, detail: opts.detail, baked, motion, scaleRef: 300, assetUrl: opts.assetUrl })
    const out = new PartList()
    for (const gen of [...CREATURE_GENS.static, ...SHARED_GENS.static]) gen(ctx, out)
    companionParts(ctx, out, petBuilder(ctx, view, opts))
    const hb = creatureHeadBox(cr)
    const { pose, hands } = creaturePose(cr, typeof dna.sections.pose?.preset === 'string' ? (dna.sections.pose.preset as string) : 'stand')
    return {
      ctx,
      view,
      staticParts: out.parts,
      dynamic: [...CREATURE_GENS.dynamic, ...SHARED_GENS.dynamic],
      restPose: pose,
      restHands: hands,
      baseExpr,
      boxes: {
        head: hb,
        bust: padBox(hb, hb.w * 0.3),
        portrait: padBox(hb, hb.w * 0.22),
        full: { x: -530, y: -1000, w: 1060, h: 1060 },
      },
    }
  }

  const hr = humanRig(dna, view)
  const ctx = createCtx({ dna, view, idPrefix, skel: hr.skel, hr, detail: opts.detail, baked, motion, scaleRef: hr.m.headH * 1.6, assetUrl: opts.assetUrl })
  const out = new PartList()
  for (const gen of [...HUMANOID_GENS.static, ...SHARED_GENS.static]) gen(ctx, out)
  companionParts(ctx, out, petBuilder(ctx, view, opts))
  const poseName = opts.pose ?? (typeof dna.sections.pose?.preset === 'string' ? (dna.sections.pose.preset as string) : 'stand')
  const { pose, hands } = humanPose(poseName, hr)
  const holdPref = dna.sections.pose?.hold
  if (typeof holdPref === 'string' && holdPref !== 'auto') {
    for (const s of ['L', 'R'] as const) if (hands[s] === 'relaxed') hands[s] = holdPref as HandShape
  }
  for (const s of ['L', 'R'] as const) if (ctx.holding(s)) hands[s] = 'hold'

  const m = hr.m
  const headTopY = -m.legLen - m.torsoLen - m.neckLen - m.headH * 0.93 - m.hairLift
  const headCy = -m.legLen - m.torsoLen - m.neckLen - m.headH * 0.45
  const headSide = m.headH * 1.42 + m.hairLift * 0.9
  const head: Box = { x: -headSide / 2, y: headCy - headSide / 2 - m.hairLift * 0.35, w: headSide, h: headSide }
  const bustSide = (m.headH + m.hairLift + m.neckLen + m.torsoLen * 0.55) * 1.12
  const bust: Box = { x: -bustSide / 2, y: headTopY - bustSide * 0.04, w: bustSide, h: bustSide }
  const pSide = m.headH * 2.05 + m.hairLift
  const portrait: Box = { x: -pSide / 2, y: headCy - pSide * 0.44 - m.hairLift * 0.3, w: pSide, h: pSide }
  return {
    ctx,
    view,
    staticParts: out.parts,
    dynamic: [...HUMANOID_GENS.dynamic, ...SHARED_GENS.dynamic],
    restPose: pose,
    restHands: hands,
    baseExpr,
    boxes: { head, bust, portrait, full: { x: -530, y: -1000, w: 1060, h: 1060 } },
  }
}

/**
 * Draws a companion creature at rest for `owner`. The pet gets its own model and id
 * prefix; its defs are copied into the owner's registry so the owner's document
 * carries them. Pets never have accessories, so this cannot recurse.
 */
function petBuilder(owner: Ctx, view: View, opts: RenderOptions): PetBuilder {
  return (pet) => {
    // A pet is a small figure: medium detail keeps the baked lighting but drops strands and
    // texture nobody can see at that size (a baked cat was 175 KB of the document).
    const pm = buildModel(pet, { view, detail: opts.detail === 'low' ? 'low' : 'medium', quality: owner.baked ? 'high' : 'standard', motion: owner.motion, idPrefix: `${owner.defs.prefix}p` })
    const { parts, mats } = layoutFrame(pm, {
      pose: finalizePose(pm, pm.restPose, pm.baseExpr),
      state: { expr: pm.baseExpr, hands: pm.restHands, t: 0, phase: 0 },
    })
    pm.ctx.defs.copyTo(owner.defs)
    return { svg: partsSVG(parts, mats), box: worldBounds(parts, mats) }
  }
}

function creatureHeadBox(cr: ReturnType<typeof creatureRig>): Box {
  const w = cr.skel.world({})
  const hm = w.get('head')
  const m = cr.m
  const hx = hm ? hm[4] : 0
  const hy = hm ? hm[5] : m.bodyY
  if (m.frontFacing && m.plan !== 'robot') {
    const side = m.bodyR * 2.7
    return { x: hx - side / 2, y: hy - side * 0.55, w: side, h: side }
  }
  const side = (m.headR * 2 + m.snout) * 1.55
  return { x: hx + m.snout * 0.3 - side / 2, y: hy - side * 0.55, w: side, h: side }
}

/** Runs the dynamic generators for a frame. */
export function frameParts(model: Model, frame: FrameState): Part[] {
  const out = new PartList()
  for (const gen of model.dynamic) gen(model.ctx, frame, out)
  for (const p of out.parts) p.dynamic = true
  return [...model.staticParts, ...out.parts]
}

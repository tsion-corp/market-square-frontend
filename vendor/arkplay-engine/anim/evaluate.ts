/* Evaluating a clip at a time: base pose + clip pose (+ IK) + secondary motion + face. */

import { clamp, wrap } from '../core/math.ts'
import { addPose, type Pose } from '../rig/skeleton.ts'
import type { Frame } from '../render/compose.ts'
import type { Model } from '../render/model.ts'
import type { ExprState, HandShape, Side } from '../render/types.ts'
import { humanPose } from './poses.ts'
import { creaturePose } from './creaturePoses.ts'
import { pulse, type Clip } from './clip.ts'
import { secondaryMotion } from './secondary.ts'

/** Applies expression-driven head tilt; used by static renders and clips alike. */
export function finalizePose(model: Model, pose: Pose, expr: ExprState): Pose {
  if (!expr.headTilt) return pose
  const sx = model.ctx.hr?.sx ?? 1
  const tilt = model.view === 'side' ? -expr.headTilt * 0.3 : expr.headTilt * sx
  const head = pose.head ?? {}
  return { ...pose, head: { ...head, rot: (head.rot ?? 0) + tilt } }
}

function basePose(model: Model, base: string): { pose: Pose; hands: Record<Side, HandShape> } {
  if (base === 'pose') return { pose: model.restPose, hands: { ...model.restHands } }
  if (model.ctx.hr) {
    const r = humanPose(base, model.ctx.hr)
    for (const s of ['L', 'R'] as const) if (model.ctx.holding(s)) r.hands[s] = 'hold'
    return r
  }
  if (model.ctx.cr) return creaturePose(model.ctx.cr, base)
  return { pose: {}, hands: { L: 'relaxed', R: 'relaxed' } }
}

/** A deterministic blink during long loops (at `blinkAt`, default phase 0.62). */
function blinkAmount(clip: Clip, p: number): number {
  const wants = clip.blink ?? (clip.loop && clip.duration >= 1.5)
  if (!wants) return 0
  const width = 0.13 / clip.duration
  return pulse(p, clip.blinkAt ?? 0.62, width)
}

/** Phase of a clip at a time: loops wrap, one-shots hold their last pose. */
export const clipPhase = (clip: Clip, time: number): number => (clip.loop ? wrap(time / clip.duration, 1) : clamp(time / clip.duration, 0, 1))

export function evalClip(model: Model, clip: Clip, time: number): Frame {
  const p = clipPhase(clip, time)
  const { pose: base, hands } = basePose(model, clip.base)
  const primary = (q: number): Pose => {
    const composed = addPose(base, clip.bones(q))
    return clip.post ? clip.post(q, composed) : composed
  }
  let pose = primary(p)
  pose = addPose(pose, secondaryMotion(model, clip, p, primary))
  let expr = clip.expr ? clip.expr(p, model.baseExpr) : model.baseExpr
  const b = blinkAmount(clip, p)
  if (b > 0) expr = { ...expr, openL: expr.openL * (1 - b), openR: expr.openR * (1 - b) }
  pose = finalizePose(model, pose, expr)
  const h = clip.hands?.(p) ?? {}
  for (const s of ['L', 'R'] as const) if (h[s] && !model.ctx.holding(s)) hands[s] = h[s] as HandShape
  return { pose, state: { expr, hands, t: time, phase: p } }
}

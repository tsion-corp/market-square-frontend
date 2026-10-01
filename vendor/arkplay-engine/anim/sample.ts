/* Sampling an animation clip into a frame (pose + face). Filled in by the clip library. */

import type { Frame } from '../render/compose.ts'
import type { Model } from '../render/model.ts'
import { clipFor } from './clips.ts'
import { evalClip } from './evaluate.ts'

export function sampleFrame(model: Model, anim: string, time: number): Frame {
  const clip = clipFor(model, anim)
  if (!clip) {
    return { pose: model.restPose, state: { expr: model.baseExpr, hands: model.restHands, t: time, phase: 0 } }
  }
  return evalClip(model, clip, time)
}

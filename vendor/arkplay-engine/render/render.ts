/* The public rendering entry points. */

import { normalizeDNA } from '../dna/normalize.ts'
import type { AvatarDNA } from '../dna/types.ts'
import { cropBox, documentSVG, layoutFrame, partsSVG, type Frame } from './compose.ts'
import { buildModel, type Model } from './model.ts'
import type { RenderOptions } from './types.ts'
import { sampleFrame } from '../anim/sample.ts'
import { finalizePose } from '../anim/evaluate.ts'

/** Resolves the pose and face for a render: the static pose, or a clip sampled at a time. */
export function resolveFrame(model: Model, opts: RenderOptions): Frame {
  if (opts.anim) return sampleFrame(model, opts.anim, opts.time ?? 0)
  return {
    pose: finalizePose(model, model.restPose, model.baseExpr),
    state: { expr: model.baseExpr, hands: model.restHands, t: opts.time ?? 0, phase: 0 },
  }
}

/** DNA (anything; it is normalized) → a complete SVG document. */
export function renderSVG(input: AvatarDNA | unknown, opts: RenderOptions = {}): string {
  const dna = normalizeDNA(input)
  const model = buildModel(dna, opts)
  return renderModel(model, opts)
}

export function renderModel(model: Model, opts: RenderOptions = {}): string {
  const frame = resolveFrame(model, opts)
  const { parts, mats } = layoutFrame(model, frame)
  const box = opts.viewBox ?? cropBox(model, opts.crop ?? 'fit', parts, mats, opts.padding ?? 0)
  return documentSVG(model, partsSVG(parts, mats, box), { ...opts, box })
}

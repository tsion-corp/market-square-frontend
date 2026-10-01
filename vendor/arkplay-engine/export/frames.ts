/* Sampling animations into frames, and the union box that keeps every frame of an
 * animation on the same pivot (a sprite that jitters because each frame was cropped
 * differently is unusable in a game). */

import { clipFor } from '../anim/clips.ts'
import type { Clip } from '../anim/clip.ts'
import { unionBox, type Box } from '../core/math.ts'
import type { AvatarDNA } from '../dna/types.ts'
import { layoutFrame, partsSVG, partWorldBounds, type Frame } from '../render/compose.ts'
import { buildModel, type Model } from '../render/model.ts'
import { resolveFrame } from '../render/render.ts'
import type { Part, RenderOptions, View } from '../render/types.ts'
import type { Mat } from '../core/math.ts'

export interface SampledFrame {
  index: number
  /** Seconds from the start of the clip. */
  t: number
  frame: Frame
  parts: Part[]
  mats: Map<string, Mat>
}

export interface SampledAnim {
  name: string
  view: View
  clip: Clip | undefined
  fps: number
  loop: boolean
  duration: number
  frames: SampledFrame[]
  /** Union of every frame's bounds (world units). */
  box: Box
}

export interface SampleOptions extends RenderOptions {
  fps?: number
  /** Cap on frames per animation. */
  maxFrames?: number
}

/** Samples one animation (or a single static frame when the clip does not exist). */
export function sampleAnim(model: Model, anim: string, opts: SampleOptions = {}): SampledAnim {
  const clip = anim === 'static' ? undefined : clipFor(model, anim)
  const fps = opts.fps ?? clip?.fps ?? 12
  const duration = clip?.duration ?? 0
  const count = clip ? Math.max(1, Math.min(opts.maxFrames ?? 48, Math.round(duration * fps))) : 1
  const frames: SampledFrame[] = []
  let box: Box = { x: 0, y: 0, w: 0, h: 0 }
  for (let i = 0; i < count; i++) {
    // Loops sample [0, duration); one-shots include the last pose.
    const t = clip ? (clip.loop ? (i / count) * duration : count === 1 ? 0 : (i / (count - 1)) * duration) : 0
    const frame = resolveFrame(model, { ...opts, anim: clip ? anim : undefined, time: t })
    const { parts, mats } = layoutFrame(model, frame)
    for (const p of parts) {
      const b = partWorldBounds(p, mats)
      if (b && p.bone !== 'world') box = unionBox(box, b)
    }
    frames.push({ index: i, t, frame, parts, mats })
  }
  // Ground contact line is part of every frame (shadows, pivots).
  box = unionBox(box, { x: box.x, y: -2, w: 1, h: 4 })
  return { name: anim, view: model.view, clip, fps, loop: clip?.loop ?? true, duration, frames, box }
}

export function sampleAnims(dna: AvatarDNA, anims: string[], view: View, opts: SampleOptions = {}): { model: Model; anims: SampledAnim[] } {
  const model = buildModel(dna, { quality: 'standard', ...opts, view })
  return { model, anims: anims.map((a) => sampleAnim(model, a, opts)) }
}

/** SVG content of one sampled frame (no document wrapper). */
export function frameContent(f: SampledFrame, box?: Box): string {
  return partsSVG(f.parts, f.mats, box)
}

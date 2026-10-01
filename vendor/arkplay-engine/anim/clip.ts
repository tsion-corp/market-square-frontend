/* Animation clip model.
 *
 * A clip is a set of functions of phase p ∈ [0, 1): an additive bone pose, an
 * expression, hand shapes. Clips are generated per avatar (a long-legged avatar takes
 * longer strides, a six-legged bug uses a tripod gait), and sampled at a frame rate
 * whenever something needs keyframes: sprite sheets, animated SVG, the Unity rig.
 *
 * A clip's name, label, duration, fps and looping come from its catalogue entry
 * (`CLIPS` in clips.ts) and are the same for every avatar, so a GIF, a sprite sheet and
 * the studio's scrubber agree on how many frames a clip has. Builders only describe the
 * motion (`ClipMotion`). */

import type { Pose } from '../rig/skeleton.ts'
import type { ExprState, HandShape, Side } from '../render/types.ts'

export interface ClipEvent {
  /** Phase 0..1. */
  t: number
  name: string
}

export interface Clip {
  name: string
  label: string
  /** Seconds for one loop / the whole one-shot. */
  duration: number
  loop: boolean
  /** Suggested sample rate for sprite exports. */
  fps: number
  /** How lively secondary motion (hair, tails, capes) is, 0..1. */
  energy: number
  /** Footfalls (or beats) per loop, for secondary motion phase. */
  cycles: number
  /** Pose layered under the clip: the avatar's own pose, or a named preset. */
  base: 'pose' | string
  bones: (p: number) => Pose
  /**
   * Final pass over the composed pose (base + bones), before secondary motion: inverse
   * kinematics that plants feet on the ground or keeps a head level.
   */
  post?: (p: number, pose: Pose) => Pose
  /** Bones the clip animates itself (wings it flaps): secondary motion leaves them alone. */
  owns?: readonly string[]
  expr?: (p: number, base: ExprState) => ExprState
  hands?: (p: number) => Partial<Record<Side, HandShape>>
  events?: ClipEvent[]
  /** World units travelled per loop (games move the character by this). */
  travel?: number
  /** Apparent vertical airflow for secondary motion, in body heights per second (+ falling:
   *  hair and capes lift). */
  wind?: number
  /** Auto-blinks during the clip (default true for loops over 1.5 s). */
  blink?: boolean
  /** Phase of the auto-blink (default 0.62). */
  blinkAt?: number
}

/** What a clip builder produces: the motion, without the catalogue's timing. */
export type ClipMotion = Omit<Clip, 'name' | 'label' | 'duration' | 'loop' | 'fps'>

export interface ClipInfo {
  name: string
  label: string
  loop: boolean
  duration: number
  fps: number
  kinds: ('humanoid' | 'creature')[]
  tags: string[]
}

export const TAU = Math.PI * 2
export const wave = (p: number, cycles = 1, phase = 0): number => Math.sin(TAU * (p * cycles + phase))
/** Cosine companion of `wave`. */
export const cwave = (p: number, cycles = 1, phase = 0): number => Math.cos(TAU * (p * cycles + phase))
export const pulse = (p: number, at: number, width: number): number => {
  const d = Math.abs(p - at)
  return d > width ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / width)
}
/** Like `pulse`, but wrapping around the loop seam (for looping clips). */
export const loopPulse = (p: number, at: number, width: number): number => {
  const d0 = Math.abs(p - at)
  const d = Math.min(d0, 1 - d0)
  return d > width ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / width)
}
/** Piecewise-linear keys over phase with smoothstep easing between them. */
export function keys(p: number, pts: [number, number][]): number {
  if (p <= pts[0][0]) return pts[0][1]
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, v0] = pts[i]
    const [t1, v1] = pts[i + 1]
    if (p <= t1) {
      const u = (p - t0) / (t1 - t0 || 1)
      const s = u * u * (3 - 2 * u)
      return v0 + (v1 - v0) * s
    }
  }
  return pts[pts.length - 1][1]
}
/** 0 → 1 smoothly between a and b (clamped). */
export const ramp = (p: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (p - a) / (b - a || 1)))
  return u * u * (3 - 2 * u)
}
/** A smooth bump: 0 before a, up to 1 at the middle, back to 0 at b. */
export const bump = (p: number, a: number, b: number): number => (p <= a || p >= b ? 0 : Math.sin((Math.PI * (p - a)) / (b - a)) ** 2)
/** Ease-out-back: overshoots a little before settling (snappy cartoon arrivals). */
export const backOut = (u: number, k = 1.6): number => {
  const x = Math.min(1, Math.max(0, u)) - 1
  return 1 + x * x * ((k + 1) * x + k)
}

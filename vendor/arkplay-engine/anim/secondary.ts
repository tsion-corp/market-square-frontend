/* Secondary motion: hair, capes, skirts, tails, wings and tentacles that follow the body.
 *
 * Each dangling bone reacts to what its attachment point actually does in the clip,
 * a moment late: it keeps its world angle briefly when its parent turns, its tip lifts
 * when the body drops fast (and settles when it rises), it swings against sideways
 * acceleration, and it trails behind forward travel. The body motion is read from the
 * clip itself (the primary pose sampled a little earlier), so a jump flips a ponytail up
 * on the way down and a spin whips a cape, with no per-clip tuning. It is pose data only
 * (a few extra skeleton evaluations per frame, no drawing), so it costs nothing on the
 * animation-frame path and bakes into sprite sheets and rig clips like any other motion.
 *
 * Loops stay seamless: every lagged sample wraps around the loop, and the ambient sway
 * runs a whole number of cycles per loop. */

import { clamp, type Mat } from '../core/math.ts'
import type { Pose } from '../rig/skeleton.ts'
import type { Model } from '../render/model.ts'
import type { Clip } from './clip.ts'
import { matAngle, wrapDeg } from './ik.ts'

interface Dangler {
  bone: string
  /** Seconds the bone lags its attachment. */
  lag: number
  /** Largest deflection, degrees. */
  max: number
  /** Rotation sign that lifts the tip / flares it outward (0: symmetric, no lift). */
  out: number
  /** 0..1: how much it hangs (swings against sideways acceleration). */
  hang: number
  /** Degrees of trailing at full speed (side views). */
  drag: number
  /** Ambient sway amplitude, degrees at energy 1, and its phase. */
  sway: number
  phase: number
}

const cache = new WeakMap<Model, { list: Dangler[]; height: number }>()

function hasArt(model: Model, bone: string): boolean {
  return model.staticParts.some((p) => p.bone === bone)
}

function danglers(model: Model): { list: Dangler[]; height: number } {
  const hit = cache.get(model)
  if (hit) return hit
  const list: Dangler[] = []
  const add = (bone: string, d: Omit<Dangler, 'bone' | 'phase'>, phase = 0) => {
    if (model.ctx.skel.has(bone) && hasArt(model, bone)) list.push({ bone, phase, ...d })
  }
  let height = 600
  const hr = model.ctx.hr
  const cr = model.ctx.cr
  if (hr) {
    height = hr.m.H
    const side = model.view === 'side'
    const sx = hr.sx
    add('hairBack', { lag: 0.07, max: side ? 12 : 6, out: side ? 1 : 0, hang: 0.6, drag: 5, sway: 1.2 })
    add('hairTail', { lag: 0.1, max: side ? 30 : 10, out: side ? 1 : 0, hang: 1, drag: 14, sway: 3 }, 0.1)
    add('hairTailL', { lag: 0.09, max: 24, out: side ? 1 : -sx, hang: 1, drag: 10, sway: 2.5 }, 0.2)
    add('hairTailR', { lag: 0.09, max: 24, out: side ? 1 : sx, hang: 1, drag: 10, sway: 2.5 }, 0.35)
    add('cape', { lag: 0.11, max: side ? 34 : 8, out: side ? 1 : 0, hang: 1, drag: 22, sway: 2.5 }, 0.15)
    add('hem', { lag: 0.05, max: 7, out: side ? 1 : 0, hang: 0.5, drag: 3, sway: 0.8 }, 0.25)
    add('tail', { lag: 0.12, max: 30, out: side ? 1 : 0, hang: 0.4, drag: 8, sway: 4 }, 0.3)
    add('wingL', { lag: 0.06, max: 8, out: side ? 1 : -sx, hang: 0.2, drag: 3, sway: 1 }, 0.05)
    add('wingR', { lag: 0.06, max: 8, out: side ? 1 : sx, hang: 0.2, drag: 3, sway: 1 }, 0.55)
  } else if (cr) {
    const m = cr.m
    height = Math.max(120, -m.bodyY + m.bodyR + m.headR)
    if (m.plan !== 'serpent') add('tail0', { lag: 0.1, max: 30, out: 1, hang: 0.3, drag: 6, sway: 3 })
    add('wingN', { lag: 0.05, max: 10, out: 1, hang: 0.2, drag: 4, sway: 1 })
    add('wingF', { lag: 0.06, max: 10, out: 1, hang: 0.2, drag: 4, sway: 1 }, 0.1)
    if (m.frontFacing) {
      for (const s of ['L', 'R'] as const) add(`arm${s}a`, { lag: 0.07, max: 14, out: s === 'L' ? -1 : 1, hang: 0.6, drag: 0, sway: 1.5 }, s === 'L' ? 0 : 0.5)
      for (const leg of cr.legs) {
        if (m.plan !== 'cephalopod') continue
        const spread = leg.at - 0.5
        const out = spread > 0.05 ? -1 : spread < -0.05 ? 1 : 0
        // A tentacle's art rides its first bone: it trails the body as one piece.
        add(leg.upper, { lag: 0.08, max: 14, out, hang: 0.8, drag: 0, sway: 2.5 }, leg.pair * 0.13)
      }
    }
  }
  const r = { list, height }
  cache.set(model, r)
  return r
}

/**
 * Secondary rotations for a frame at phase `p`, given `primary(q)`: the clip's pose (base +
 * bones + post) at any phase. Returned as an additive pose.
 */
export function secondaryMotion(model: Model, clip: Clip, p: number, primary: (q: number) => Pose): Pose {
  const { list, height } = danglers(model)
  if (!list.length) return {}
  const owned = new Set(clip.owns ?? [])
  const active = list.filter((d) => !owned.has(d.bone))
  if (!active.length) return {}
  const skel = model.ctx.skel
  const T = clip.duration
  const t = p * T
  // Loops wrap; one-shots hold their first frame before the start.
  const phaseAt = (time: number) => (clip.loop ? (((time / T) % 1) + 1) % 1 : clamp(time / T, 0, 1))
  const worlds = new Map<number, Map<string, Mat>>()
  const worldAt = (time: number): Map<string, Mat> => {
    const q = Math.round(phaseAt(time) * 1e5) / 1e5
    let w = worlds.get(q)
    if (!w) {
      w = skel.world(primary(q))
      worlds.set(q, w)
    }
    return w
  }
  const now = worldAt(t)
  const h = 0.035
  const side = model.view === 'side' || !!model.ctx.cr
  const speed = side && clip.travel ? clip.travel / T / height : 0
  // One-shots settle as they end, so the next clip starts from rest.
  const fade = clip.loop ? 1 : 1 - Math.max(0, Math.min(1, (p - 0.9) / 0.1))
  const e = Math.max(0.15, clip.energy)
  const out: Pose = {}
  for (const d of active) {
    const b = skel.get(d.bone)
    if (!b || !b.parent) continue
    const origin = (w: Map<string, Mat>): [number, number] => {
      const m = w.get(d.bone)
      return m ? [m[4], m[5]] : [0, 0]
    }
    const parentAngle = (w: Map<string, Mat>) => {
      const m = w.get(b.parent as string)
      return m ? matAngle(m) : 0
    }
    const w0 = worldAt(t - d.lag)
    const w1 = worldAt(t - d.lag - h)
    const w2 = worldAt(t - d.lag - 2 * h)
    const o0 = origin(w0)
    const o1 = origin(w1)
    const o2 = origin(w2)
    const vy = (o0[1] - o1[1]) / h / height + (clip.wind ?? 0)
    const ax = (o0[0] - 2 * o1[0] + o2[0]) / (h * h) / height
    let rot = 0
    // Keeps its world angle for a moment when the parent turns.
    rot += wrapDeg(parentAngle(w0) - parentAngle(now)) * 0.8
    // Tip lifts when the attachment drops, settles when it rises.
    rot += d.out * d.max * clamp(vy / 1.2, -0.6, 1)
    // Swings against sideways acceleration.
    rot += d.hang * d.max * clamp(ax / 14, -1, 1)
    // Trails behind forward travel.
    rot += d.out * d.drag * clamp(speed / 1.6, 0, 1)
    // A breath of ambient sway (a whole number of cycles per loop).
    if (clip.loop) rot += d.sway * e * Math.sin(2 * Math.PI * (p * Math.max(1, Math.round(clip.cycles)) - d.phase))
    rot = clamp(rot, -d.max * 1.2, d.max * 1.2) * fade
    if (Math.abs(rot) > 1e-4) out[d.bone] = { rot }
  }
  return out
}

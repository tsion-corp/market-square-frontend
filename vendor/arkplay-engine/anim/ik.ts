/* Two-bone inverse kinematics for clips.
 *
 * Gaits and stances describe where feet go (planted on the ground, lifted in an arc) and
 * this turns those targets into bone rotations, whatever the leg lengths, so a long-legged
 * avatar and a stubby one both keep their feet on the floor without sliding. Everything is
 * solved in world space from the skeleton's own matrices and written back as pose
 * rotations (degrees, added to each bone's rest rotation), so the result is ordinary pose
 * data: sprite sheets, animated SVG and the Unity rig all see plain rotation keys. */

import { applyM, type Mat, type P } from '../core/math.ts'
import type { Pose, Skeleton } from '../rig/skeleton.ts'

const R2D = 180 / Math.PI

/** Rotation of a matrix in degrees (clockwise on screen, like the pose rotations). */
export const matAngle = (m: Mat): number => Math.atan2(m[1], m[0]) * R2D
/** The rotation that turns the local +y axis (where limbs hang) onto (dx, dy). */
export const dirAngle = (dx: number, dy: number): number => Math.atan2(-dx, dy) * R2D
/** Wraps degrees into (-180, 180]. */
export const wrapDeg = (a: number): number => {
  let x = a % 360
  if (x > 180) x -= 360
  if (x <= -180) x += 360
  return x
}

/** World position of a bone's origin. */
export function boneAt(mats: Map<string, Mat>, bone: string): P {
  const m = mats.get(bone)
  return m ? [m[4], m[5]] : [0, 0]
}

export interface LimbChain {
  upper: string
  lower: string
  /** The bone at the end of the lower one (a foot or hand), oriented by `endAngle`. */
  end?: string
}

export interface SolveOptions {
  /** +1 puts the middle joint on the world +x side of the root→target line (a knee
   *  pointing forward in a side view), -1 on the -x side (a bird's or a hind leg's hock). */
  bend: number
  /** World rotation for the end bone (0 keeps a foot flat). Omitted: left as posed. */
  endAngle?: number
  /** Fraction of full reach a limb may straighten to (keeps knees soft). Default 0.998. */
  maxReach?: number
}

/**
 * Solves one two-bone limb so the end bone's origin reaches `target` (world), writing
 * the rotations into `pose`. `mats` are world matrices of the pose (the limb's parents
 * must already be where they will be drawn); the limb's own entries in it are stale after
 * this. Returns how far the target stayed out of reach (0 when reached).
 */
export function solveLimb(skel: Skeleton, pose: Pose, mats: Map<string, Mat>, chain: LimbChain, target: P, o: SolveOptions): number {
  const up = skel.get(chain.upper)
  const lo = skel.get(chain.lower)
  if (!up || !lo || !up.parent) return 0
  const end = chain.end ? skel.get(chain.end) : undefined
  const parentM = mats.get(up.parent)
  if (!parentM) return 0
  const pu = pose[chain.upper] ?? {}
  const origin = applyM(parentM, [up.x + (pu.x ?? 0), up.y + (pu.y ?? 0)])
  const pw = matAngle(parentM)
  // Segment vectors in their bones' local frames (normally straight down +y).
  const s1: P = [lo.x, lo.y]
  const s2: P = end ? [end.x, end.y] : [0, lo.len]
  const L1 = Math.hypot(s1[0], s1[1]) || 1e-6
  const L2 = Math.hypot(s2[0], s2[1]) || 1e-6
  const psi1 = dirAngle(s1[0], s1[1])
  const psi2 = dirAngle(s2[0], s2[1])
  const dx = target[0] - origin[0]
  const dy = target[1] - origin[1]
  const d = Math.hypot(dx, dy)
  const reach = (L1 + L2) * (o.maxReach ?? 0.998)
  const dd = Math.min(Math.max(d, Math.abs(L1 - L2) + 1e-3), reach)
  const base = dirAngle(dx, dy)
  const cosA = (L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd)
  const A = Math.acos(Math.min(1, Math.max(-1, cosA))) * R2D
  // Two mirror solutions: pick the one whose joint sits on the requested side.
  const jointX = (seg: number) => origin[0] - L1 * Math.sin(seg / R2D)
  const cand1 = base + A
  const cand2 = base - A
  const seg1 = (jointX(cand1) - jointX(cand2)) * o.bend >= 0 ? cand1 : cand2
  const J: P = [origin[0] - L1 * Math.sin(seg1 / R2D), origin[1] + L1 * Math.cos(seg1 / R2D)]
  const seg2 = d > 1e-6 ? dirAngle(target[0] - J[0], target[1] - J[1]) : seg1
  const w1 = seg1 - psi1
  const a1 = wrapDeg(w1 - pw - up.rot)
  const w2 = seg2 - psi2
  const a2 = wrapDeg(w2 - w1 - lo.rot)
  pose[chain.upper] = { ...pu, rot: a1 }
  pose[chain.lower] = { ...(pose[chain.lower] ?? {}), rot: a2 }
  if (end && o.endAngle !== undefined) pose[chain.end as string] = { ...(pose[chain.end as string] ?? {}), rot: wrapDeg(o.endAngle - w2 - end.rot) }
  return Math.max(0, d - reach)
}

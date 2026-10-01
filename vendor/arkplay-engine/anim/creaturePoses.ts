/* Creature stances and the creature leg kit.
 *
 * Creatures express mostly through the face, tail and wings; their "poses" are stances
 * (sit, lie down, crouch, rear up, bow) built from a few body channels — lift and pitch of
 * the body, neck and head kept level — with the feet planted where they stood, by
 * inverse kinematics. The same kit places feet for every gait in creatureClips.ts.
 *
 * Legs by body plan:
 * - profile quadrupeds, birds, serpents with legs: two-bone IK (front legs bend at the
 *   wrist, hind legs and birds at the hock);
 * - bugs: the whole leg is drawn on its upper bone, so it swings about the hip and squashes
 *   to lift or to keep the foot on the ground when the body drops;
 * - front-facing plans (robots, blobs with legs): foreshortened like a front view. */

import { clamp, lerp, type P } from '../core/math.ts'
import type { CreatureMeasure, CreatureRig, LegDef } from '../rig/creature.ts'
import type { Pose } from '../rig/skeleton.ts'
import type { HandShape, Side } from '../render/types.ts'
import { boneAt, matAngle, solveLimb } from './ik.ts'

/** Where a creature foot goes: planted `h` above the ground relative to its rest place, or
 *  `below` its hip joint (airborne, moving with the body). `dx` is forward. `angle` tilts
 *  the foot (+ toes down). `lift` 0..1 folds a bug's leg up. */
export interface CFoot {
  dx?: number
  h?: number
  below?: number
  angle?: number
}

export interface CKit {
  rig: CreatureRig
  m: CreatureMeasure
  /** Profile plan (not front-facing). */
  profile: boolean
  /** The bone the body art rides on. */
  body: string
  /** Blobs and octopuses: the face is drawn on the body, not on a head bone. */
  faceOnBody: boolean
  legs: LegDef[]
  fore: LegDef[]
  hind: LegDef[]
  /** Leg reach (hip joint to ankle) of the longest leg. */
  L: number
  /** World y of a planted ankle. */
  ankleY: number
  /** Height of the whole creature (for scaling motion). */
  H: number
  /** World x of the hips and chest origins at rest (the pitch lever). */
  xh: number
  xc: number
  restHip(leg: LegDef): P
  restFoot(leg: LegDef): P
  /** Writes leg rotations that put each foot where `feet(leg)` says. */
  place(pose: Pose, feet: (leg: LegDef) => CFoot | undefined): Pose
}

const kits = new WeakMap<CreatureRig, CKit>()

export function creatureKit(rig: CreatureRig): CKit {
  const hit = kits.get(rig)
  if (hit) return hit
  const m = rig.m
  const sk = rig.skel
  const w = sk.world({})
  const legs = rig.legs.filter((l) => sk.has(l.upper) && sk.has(l.lower) && sk.has(l.foot))
  const profile = !m.frontFacing
  const fore = profile ? legs.filter((l) => l.at > 0.5 || (legs.length <= 2 && l.at >= 0.4)) : legs
  const hind = profile ? legs.filter((l) => !fore.includes(l)) : []
  const hipOf = new Map(legs.map((l) => [l.upper, boneAt(w, l.upper)]))
  const footOf = new Map(legs.map((l) => [l.upper, boneAt(w, l.foot)]))
  const reach = (l: LegDef) => {
    const lo = sk.get(l.lower)
    const ft = sk.get(l.foot)
    return (lo ? Math.hypot(lo.x, lo.y) : 0) + (ft ? Math.hypot(ft.x, ft.y) : 0)
  }
  const L = legs.length ? Math.max(...legs.map(reach)) : m.legLen
  const ankleY = legs.length ? Math.max(...legs.map((l) => (footOf.get(l.upper) as P)[1])) : 0
  const xh = boneAt(w, profile ? 'hips' : 'body')[0]
  const xc = boneAt(w, profile ? 'chest' : 'body')[0]
  const insect = m.plan === 'insectoid'
  const kit: CKit = {
    rig,
    m,
    profile,
    body: profile ? 'spine1' : 'body',
    faceOnBody: m.frontFacing && m.plan !== 'robot',
    legs,
    fore,
    hind,
    L,
    ankleY,
    H: Math.max(120, -m.bodyY + m.bodyR + (m.frontFacing ? 0 : m.headR)),
    xh,
    xc,
    restHip: (l) => hipOf.get(l.upper) ?? [0, 0],
    restFoot: (l) => footOf.get(l.upper) ?? [0, 0],
    place(pose, feet) {
      // Tentacles are animated directly (their art rides the upper bone), never planted.
      if (!legs.length || m.plan === 'cephalopod') return pose
      const mats = sk.world(pose)
      for (const leg of legs) {
        const f = feet(leg)
        // Zero-length legs (a blob given legs) have nothing to place.
        if (!f || reach(leg) < 1) continue
        const hip = boneAt(mats, leg.upper)
        const rest = kit.restFoot(leg)
        const air = f.below !== undefined
        const tx = (air ? hip[0] + (rest[0] - kit.restHip(leg)[0]) : rest[0]) + (f.dx ?? 0)
        const ty = air ? hip[1] + (f.below as number) : ankleY - (f.h ?? 0)
        if (insect) {
          // Swing the whole leg about the hip; squash it so the foot meets its target height.
          const r = kit.restHip(leg)
          const depth = Math.max(1, rest[1] - r[1])
          const reachX = Math.max(1, Math.hypot(rest[0] - r[0], depth))
          const parent = mats.get(sk.get(leg.upper)?.parent ?? '')
          const pw = parent ? matAngle(parent) : 0
          const up = pose[leg.upper] ?? {}
          pose[leg.upper] = { ...up, rot: (-Math.asin(clamp((f.dx ?? 0) / reachX, -0.8, 0.8)) * 180) / Math.PI - pw, sy: clamp((ty - hip[1]) / depth, 0.35, 1.3) }
          continue
        }
        if (!profile) {
          // Front-facing legs: foreshorten to reach, keep the foot under its rest place.
          const d = Math.max(L * 0.2, ty - hip[1])
          const short = Math.max(0, reach(leg) - d)
          const lo = sk.get(leg.lower)
          const L1 = lo ? Math.hypot(lo.x, lo.y) : L / 2
          const L2 = Math.max(1, reach(leg) - L1)
          const lock = (Math.asin(clamp((hip[0] - tx) / Math.max(d, 1), -0.8, 0.8)) * 180) / Math.PI
          const out = hip[0] > xh ? -1 : 1
          const up = pose[leg.upper] ?? {}
          const lw = pose[leg.lower] ?? {}
          pose[leg.upper] = { ...up, rot: lock + out * 10 * (short / L), sy: clamp(1 - (0.6 * short) / L1, 0.2, 1) }
          pose[leg.lower] = { ...lw, rot: -out * 18 * (short / L), sy: clamp(1 - (0.4 * short) / L2, 0.3, 1) }
          continue
        }
        const bend = m.plan === 'avian' || (m.plan === 'quadruped' && leg.at < 0.5) || (m.plan === 'serpent' && leg.at < 0.5) ? -1 : 1
        solveLimb(sk, pose, mats, { upper: leg.upper, lower: leg.lower, end: leg.foot }, [tx, ty], { bend, endAngle: f.angle ?? 0, maxReach: 0.995 })
      }
      return pose
    },
  }
  kits.set(rig, kit)
  return kit
}

/* ---- Body channels ------------------------------------------------------------------ */

/**
 * Moves the body: `drop` lowers it (world units, + down), `pitch` tips it (degrees, +
 * nose down) about the hips — or tilts a front-facing body — and the neck and head take
 * back `level` of the pitch so the face stays upright.
 */
export function bodyPose(k: CKit, drop: number, pitch = 0, level = 1): Pose {
  if (!k.profile) return { body: { y: drop, rot: pitch } }
  const pose: Pose = { hips: { y: drop, rot: pitch } }
  if (level && pitch) {
    pose.neck = { rot: -pitch * level * 0.6 }
    pose.head = { rot: -pitch * level * 0.4 }
  }
  return pose
}

/** How far the body drops for the front legs to reach the ground at a given pitch (for
 *  stances whose hind end sits): the lowest drop keeping the front feet reachable. */
function frontReachDrop(k: CKit, pitch: number, hindDrop: number): number {
  // Front leg hip joints relative to the hips origin, rotated by the pitch.
  let need = hindDrop
  const a = (pitch * Math.PI) / 180
  const w = k.rig.skel.world({})
  const hips = boneAt(w, 'hips')
  for (const leg of k.fore) {
    const r = k.restHip(leg)
    const dx = r[0] - hips[0]
    const dy = r[1] - hips[1]
    const y = hips[1] + hindDrop + dx * Math.sin(a) + dy * Math.cos(a)
    const reachH = k.ankleY - y
    if (reachH > k.L * 0.97) need = Math.max(need, hindDrop + reachH - k.L * 0.97)
  }
  return need
}

export type Stance = 'stand' | 'crouch' | 'sit' | 'lie' | 'rear' | 'bow' | 'low'

export interface StanceResult {
  pose: Pose
  feet: (leg: LegDef) => CFoot | undefined
}

/** A stance at strength `s` (0 = standing, 1 = fully in it). */
export function stance(k: CKit, name: Stance, s = 1): StanceResult {
  const m = k.m
  const planted = (): CFoot => ({ h: 0 })
  if (name === 'stand' || s <= 0) return { pose: {}, feet: planted }
  if (!k.profile) {
    // Front-facing plans: squash down on the spot (blob, octopus) or bend the knees.
    const r = m.bodyR
    const squash: Record<Stance, number> = { stand: 0, crouch: 0.12, sit: 0.1, lie: 0.2, rear: -0.08, bow: 0.06, low: 0.1 }
    const q = squash[name] * s
    const legged = k.legs.length > 0
    const sink: Record<Stance, number> = { stand: 0, crouch: 0.25, sit: 0.55, lie: 0.7, rear: -0.1, bow: 0.2, low: 0.35 }
    const drop = legged ? k.L * sink[name] * s : r * q * 0.98
    const pose: Pose = { body: { y: drop, sy: legged ? 1 - q * 0.3 : 1 - q, sx: legged ? 1 : 1 + q * 0.6, rot: name === 'bow' ? 8 * s : 0 } }
    if (name === 'bow' && m.plan === 'robot') pose.head = { rot: 18 * s, y: r * 0.08 * s }
    return { pose, feet: planted }
  }
  const L = k.L
  switch (m.plan) {
    case 'quadruped':
    case 'insectoid': {
      if (name === 'crouch' || name === 'low') {
        const d = L * (name === 'low' ? 0.2 : 0.32) * s
        return { pose: bodyPose(k, d, m.plan === 'quadruped' ? 3 * s : 0), feet: planted }
      }
      if (name === 'lie') {
        const d = (m.plan === 'insectoid' ? L * 0.55 : Math.max(0, -m.bodyY - m.bodyR * 0.95)) * s
        const pose = bodyPose(k, d, 0, 0)
        pose.neck = { rot: 10 * s }
        pose.head = { rot: 8 * s }
        if (m.plan === 'quadruped') pose.tail0 = { rot: -6 * s }
        return {
          pose,
          feet: (leg) => (m.plan === 'insectoid' ? { h: 0 } : { below: L * lerp(1, 0.3, s), dx: (leg.at > 0.5 ? 0.55 : -0.1) * L * s, angle: (leg.at > 0.5 ? -60 : 50) * s }),
        }
      }
      if (name === 'bow') {
        // Front end low, rear up (a play bow / a stretch).
        const pitch = 16 * s
        const pose = bodyPose(k, -L * 0.04 * s, pitch, 0.7)
        pose.tail0 = { rot: 18 * s }
        return { pose, feet: (leg) => (leg.at > 0.5 ? { h: 0, dx: L * 0.35 * s } : { h: 0 }) }
      }
      // Sit / rear: the rump drops to the ground, the front comes up.
      const rear = name === 'rear'
      if (m.plan === 'insectoid') {
        const pose = bodyPose(k, L * 0.25 * s, -14 * s, 0.8)
        return { pose, feet: (leg) => (leg.at > 0.5 && rear ? { below: L * 0.7, dx: L * 0.4, angle: 0 } : { h: 0 }) }
      }
      // Long legs sit less steeply (a horse's sit is a slouch, a cat's is upright). Rearing
      // stands on the hind legs; sitting rests the rump just off the ground.
      const leggy = clamp(L / m.bodyR - 1.6, 0, 1)
      const pitch = -(rear ? 52 : 34 - 12 * leggy) * s
      const hindDrop = (rear ? L * 0.12 : Math.max(0, -m.bodyY - m.bodyR * (0.98 + 0.25 * leggy))) * s
      const drop = rear ? hindDrop : frontReachDrop(k, pitch, hindDrop)
      const pose = bodyPose(k, drop, pitch, 1)
      pose.tail0 = { rot: -pitch * (rear ? 0.6 : 0.85) + 4 * s }
      return {
        pose,
        feet: (leg) => {
          if (leg.at > 0.5) return rear ? { below: L * 0.55, dx: L * 0.35, angle: -50 } : { h: 0, dx: L * 0.08 * s }
          return { h: 0, dx: (rear ? 0.08 : 0.3) * L * s, angle: 0 }
        },
      }
    }
    case 'avian': {
      const d = (name === 'sit' || name === 'lie' ? Math.max(0, L - m.bodyR * 0.25) : name === 'crouch' || name === 'low' ? L * 0.3 : name === 'bow' ? L * 0.15 : 0) * s
      const pitch = (name === 'bow' ? 24 : name === 'rear' ? -12 : name === 'lie' ? 4 : 0) * s
      const pose = bodyPose(k, d, pitch, name === 'bow' ? 0.3 : 1)
      if (name === 'lie') pose.neck = { rot: 20 * s }
      return { pose, feet: (leg) => ({ h: 0, dx: (name === 'sit' || name === 'lie' ? 0.15 : 0) * L * s * (leg.near ? 1 : 0.8) }) }
    }
    case 'serpent': {
      // Rear up (sit): the front half rises like a cobra; lie: flat and still.
      const pose: Pose = {}
      if (name === 'sit' || name === 'rear') {
        const n = k.rig.spine.length
        k.rig.spine.forEach((b, i) => {
          if (i >= n / 2) pose[b] = { rot: -(rear(name) ? 30 : 22) * s * (i === Math.ceil(n / 2) ? 1 : 0.35) }
        })
        pose.neck = { rot: 24 * s }
        pose.head = { rot: 8 * s }
      }
      return { pose, feet: planted }
    }
    default:
      return { pose: {}, feet: planted }
  }
}

const rear = (name: Stance) => name === 'rear'

/** A creature's base pose by name (the rest pose is `stand`, i.e. the rig as drawn). */
export function creaturePose(rig: CreatureRig, name: string): { pose: Pose; hands: Record<Side, HandShape> } {
  const hands: Record<Side, HandShape> = { L: 'open', R: 'open' }
  const known: Stance[] = ['crouch', 'sit', 'lie', 'rear', 'bow', 'low']
  if (!(known as string[]).includes(name)) return { pose: {}, hands }
  const k = creatureKit(rig)
  const st = stance(k, name as Stance, 1)
  const pose = k.place({ ...st.pose }, st.feet)
  return { pose, hands }
}

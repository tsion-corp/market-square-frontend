/* The humanoid clip library. Each clip is built for a specific rig, view and body:
 *
 * - Feet are placed, not swung: a clip says where each foot is (planted, lifted in an arc,
 *   tucked under the hips) and the leg kit realises it — two-bone IK in the side view (so
 *   feet stay on the floor and never slide: a walk's `travel` is exactly what the planted
 *   foot sweeps), foreshortened thighs and shins in the front and back views.
 * - Bodies change the motion (profile.ts): heavy builds take shorter, rolling steps with
 *   more side-to-side weight shift, chibi avatars bounce, old ones lean and shuffle.
 * - Side-view clips swing limbs forward and back; front-view clips lift knees and sway. */

import { clamp, lerp } from '../core/math.ts'
import type { HumanRig } from '../rig/humanoid.ts'
import type { Pose } from '../rig/skeleton.ts'
import type { ExprState, Side } from '../render/types.ts'
import { expressionState, withViseme, type Viseme } from './expression.ts'
import { bump, cwave, keys, loopPulse, pulse, ramp, wave, type ClipInfo, type ClipMotion } from './clip.ts'
import { boneAt, solveLimb } from './ik.ts'
import { humanPose } from './poses.ts'
import type { HumanStyle } from './profile.ts'

type Build = (rig: HumanRig, st: HumanStyle, info: ClipInfo) => ClipMotion

const S: Side[] = ['L', 'R']

/** Rotation helpers for this rig/view (see poses.ts for the conventions). */
function limbs(rig: HumanRig) {
  const side = rig.view === 'side'
  const dir = (s: Side) => (s === 'L' ? rig.sx : -rig.sx)
  return {
    side,
    /** Screen-x sign of a side's outward direction (front/back views). */
    dir,
    /** Arm raised away from the body (front) / forward (side). */
    arm: (s: Side, deg: number) => (side ? -deg : -dir(s) * deg),
    elbow: (s: Side, deg: number) => (side ? -deg : dir(s) * deg),
    thigh: (s: Side, deg: number) => (side ? -deg : -dir(s) * deg),
    knee: (s: Side, deg: number) => (side ? deg : dir(s) * deg * 0.4),
    lean: (deg: number) => (side ? deg : deg * rig.sx * 0.4),
    tilt: (deg: number) => (side ? -deg * 0.3 : deg * rig.sx),
  }
}

const merge = (...poses: Pose[]): Pose => {
  const out: Pose = {}
  for (const p of poses)
    for (const [k, v] of Object.entries(p)) {
      const o = out[k] ?? {}
      out[k] = {
        rot: (o.rot ?? 0) + (v.rot ?? 0),
        x: (o.x ?? 0) + (v.x ?? 0),
        y: (o.y ?? 0) + (v.y ?? 0),
        sx: (o.sx ?? 1) * (v.sx ?? 1),
        sy: (o.sy ?? 1) * (v.sy ?? 1),
      }
    }
  return out
}

const withPreset = (name: string, intensity = 0.9) => (_p: number, base: ExprState): ExprState => {
  const e = expressionState(name, intensity)
  return { ...e, lookX: base.lookX * 0.3 + e.lookX, lookY: e.lookY }
}

const breathe = (rig: HumanRig, p: number, amount = 1, phase = 0): Pose => ({
  chest: { sy: 1 + 0.012 * amount * wave(p, 1, phase), y: -rig.m.torsoLen * 0.004 * amount * (wave(p, 1, phase) + 1) },
  head: { y: -rig.m.headH * 0.006 * amount * (wave(p, 1, phase) + 1) },
})

/** Poses whose feet are not simply planted (a clip layered on them leaves the legs alone). */
const OFF_FEET = new Set(['sit', 'run', 'jump'])

/* ---- Feet ------------------------------------------------------------------------ */

/**
 * Where a foot goes. A planted foot (`h` above the ground) is placed relative to where it
 * stands at rest, so it stays put whatever the hips do; an airborne one (`below` the hip
 * joint) moves with the hips. `dx` is forward (side view; ignored front/back), `lat` is
 * sideways (front/back views). `angle` tilts the foot (side view: +toes down, −toes up).
 * `bend` spreads a crouching knee outward in front/back views (0..1).
 */
interface Foot {
  dx?: number
  lat?: number
  h?: number
  below?: number
  angle?: number
  bend?: number
}

interface LegKit {
  /** Hip joint to ankle, legs straight. */
  L: number
  /** World y of the hip joint at rest, and of a planted ankle. */
  hipY: number
  ankleY: number
  footLen: number
  /** Writes leg rotations (and front-view foreshortening) that put the feet there. */
  place(pose: Pose, feet: Record<Side, Foot>): Pose
}

/** `stance`: the pose preset the feet rest in (their planted places come from it). */
function legKit(rig: HumanRig, stance = 'stand'): LegKit {
  const m = rig.m
  const w = rig.skel.world({})
  const hipY = boneAt(w, 'thighR')[1]
  const ankleY = boneAt(w, 'footR')[1]
  const ws = rig.skel.world(humanPose(OFF_FEET.has(stance) ? 'stand' : stance, rig).pose)
  const restX = { L: boneAt(ws, 'footL')[0], R: boneAt(ws, 'footR')[0] }
  const L = m.thigh + m.shin
  const side = rig.view === 'side'
  const lim = limbs(rig)
  return {
    L,
    hipY,
    ankleY,
    footLen: m.footLen,
    place(pose, feet) {
      const mats = rig.skel.world(pose)
      for (const s of S) {
        const f = feet[s]
        const hip = boneAt(mats, `thigh${s}`)
        const air = f.below !== undefined
        const ty = air ? hip[1] + (f.below as number) : ankleY - (f.h ?? 0)
        if (side) {
          const tx = (air ? hip[0] : restX[s]) + (f.dx ?? 0)
          solveLimb(rig.skel, pose, mats, { upper: `thigh${s}`, lower: `shin${s}`, end: `foot${s}` }, [tx, ty], { bend: 1, endAngle: f.angle ?? 0 })
          continue
        }
        // Front/back: the leg's drawn length is its vertical reach; bending or angling it
        // toward the camera shortens it. The thigh takes most of it, the shin the rest.
        const d = Math.max(L * 0.2, ty - hip[1])
        const short = Math.max(0, L - d)
        const bend = clamp(f.bend ?? 0, 0, 1)
        const t = pose[`thigh${s}`] ?? {}
        const sh = pose[`shin${s}`] ?? {}
        // Keep a planted foot at its rest place (plus `lat`) wherever the hips went; an
        // airborne one hangs under its hip.
        const fx = air ? hip[0] + (f.lat ?? 0) * lim.dir(s) : restX[s] + (f.lat ?? 0) * lim.dir(s)
        const hipsRot = pose.hips?.rot ?? 0
        const lock = (Math.asin(clamp((hip[0] - fx) / Math.max(d, 1), -0.9, 0.9)) * 180) / Math.PI - hipsRot
        pose[`thigh${s}`] = { ...t, rot: lock + lim.thigh(s, 9 * bend * (short / L) * 2), sy: (t.sy ?? 1) * clamp(1 - (0.66 * short) / m.thigh, 0.2, 1) }
        pose[`shin${s}`] = { ...sh, rot: lim.knee(s, -24 * bend * (short / L) * 2), sy: (sh.sy ?? 1) * clamp(1 - (0.34 * short) / m.shin, 0.35, 1) }
      }
      return pose
    },
  }
}

/* ---- Gaits ----------------------------------------------------------------------- */

interface GaitSpec {
  /** Fraction of the cycle a foot is on the ground. */
  beta: number
  /** Stance sweep (foot travel relative to the hip), in leg lengths. */
  sweep: number
  /** Swing-foot height, kick back and reach forward, in leg lengths. */
  lift: number
  kick: number
  reach: number
  /** Heel-off at push-off and toes-up at contact, degrees. */
  toeOff: number
  strike: number
  /** Stance compression and flight height (runs), in leg lengths. */
  compress: number
  flight: number
}

const WALK: GaitSpec = { beta: 0.57, sweep: 0.7, lift: 0.14, kick: 0.05, reach: 0.07, toeOff: 20, strike: -12, compress: 0, flight: 0 }
const RUN: GaitSpec = { beta: 0.36, sweep: 0.86, lift: 0.55, kick: 0.34, reach: 0.12, toeOff: 38, strike: -4, compress: 0.07, flight: 0.06 }

interface GaitState {
  feet: Record<Side, Foot>
  /** Hip joint world y offset from rest (down +). */
  dip: number
  /** Per side: -1 back … +1 forward, for arm swing. */
  fwd: Record<Side, number>
  /** 0..1 how high each foot is (front-view knee lift). */
  lift: Record<Side, number>
}

/** A walk or run cycle: right foot strikes at p = 0, left at 0.5. */
function gaitAt(kit: LegKit, g: GaitSpec, st: HumanStyle, p: number): GaitState {
  const L = kit.L
  const Sw = g.sweep * L * st.stride
  const lift = g.lift * L * (0.85 + 0.15 * st.bounce)
  const kick = g.kick * L
  const reach = g.reach * L
  const fore = kit.footLen * 0.7
  const feet = {} as Record<Side, Foot>
  const fwd = {} as Record<Side, number>
  const lifts = {} as Record<Side, number>
  const stance: { dx: number; h: number; s: number }[] = []
  // Every foot's target must stay reachable, planted or swinging (a swinging foot reaching
  // down to its strike lowers the hips smoothly into the step).
  const all: { dx: number; h: number; s: number }[] = []
  for (const s of S) {
    const u = (((p + (s === 'L' ? 0.5 : 0)) % 1) + 1) % 1
    let dx: number
    let h: number
    let angle: number
    if (u < g.beta) {
      const k = u / g.beta
      dx = Sw / 2 - Sw * k
      const off = g.toeOff * ramp(k, 0.62, 1)
      angle = off + g.strike * (1 - ramp(k, 0, 0.16))
      h = fore * Math.sin((off * Math.PI) / 180)
      stance.push({ dx, h, s: k })
      all.push({ dx, h, s: k })
    } else {
      const k = (u - g.beta) / (1 - g.beta)
      const y0 = fore * Math.sin((g.toeOff * Math.PI) / 180)
      // Cubic Bézier: toe-off, kick back and up, reach forward, strike.
      const a = 1 - k
      dx = a * a * a * (-Sw / 2) + 3 * a * a * k * (-Sw / 2 - kick) + 3 * a * k * k * (Sw / 2 + reach) + k * k * k * (Sw / 2)
      h = a * a * a * y0 + 3 * a * a * k * lift + 3 * a * k * k * lift * 0.55
      angle = keys(k, [[0, g.toeOff], [0.45, 4], [1, g.strike]])
      all.push({ dx, h, s: 0 })
    }
    feet[s] = { dx, h, angle }
    fwd[s] = clamp(dx / (Sw / 2 || 1), -1.3, 1.3)
    lifts[s] = clamp(h / (lift || 1), 0, 1)
  }
  // Hip height: as high as the planted feet allow (knees stay soft), a flight arc between.
  const kappa = 0.985
  const reachUp = (dx: number, h: number, sk: number) => Math.sqrt(Math.max(0, (kappa * L) ** 2 - dx * dx)) + h - g.compress * L * Math.sin(Math.PI * sk)
  let up = Math.min(...all.map((f) => reachUp(f.dx, f.h, f.s)))
  if (!stance.length) {
    // Flight: an arc from the last toe-off to the next strike (runs), never beyond reach.
    const flightLen = 0.5 - g.beta
    const q = (((p % 0.5) + 0.5) % 0.5 - g.beta) / (flightLen || 1)
    const fore0 = kit.footLen * 0.7 * Math.sin((g.toeOff * Math.PI) / 180)
    const y0 = reachUp(-Sw / 2, fore0, 1)
    const y1 = reachUp(Sw / 2, 0, 0)
    up = Math.min(up + g.flight * L * st.bounce * 4 * q * (1 - q), lerp(y0, y1, q) + g.flight * L * st.bounce * 4 * q * (1 - q))
  }
  let dip = kit.ankleY - up - kit.hipY
  const top = kit.ankleY - kappa * L - kit.hipY
  if (st.bounce > 1) dip = top + (dip - top) * st.bounce
  return { feet, dip, fwd, lift: lifts }
}

function locomotion(rig: HumanRig, st: HumanStyle, g: GaitSpec, run: boolean): ClipMotion {
  const L = limbs(rig)
  const kit = legKit(rig)
  const Sw = g.sweep * kit.L * st.stride
  const armA = (run ? 46 : 20) * st.swing
  const lean = (run ? 10 : 2.5) + st.lean * (run ? 0.5 : 1)
  const vary = st.u('gait')
  return {
    energy: run ? 0.9 : 0.5,
    cycles: 2,
    base: 'stand',
    travel: Sw / g.beta,
    events: [
      { t: 0, name: 'footstep' },
      { t: 0.5, name: 'footstep' },
    ],
    bones: (p) => {
      const gs = gaitAt(kit, g, st, p)
      const pose: Pose = { hips: { y: gs.dip } }
      for (const s of S) {
        const other = s === 'L' ? 'R' : 'L'
        // Arms counter-swing the legs, a touch late.
        const f = clamp(gs.fwd[other] * 0.85 + 0.15 * wave(p, 1, s === 'L' ? 0.2 : 0.7), -1.2, 1.2)
        if (L.side) {
          pose[`upperArm${s}`] = { rot: L.arm(s, armA * f + (run ? 8 : 0)) }
          pose[`forearm${s}`] = { rot: L.elbow(s, run ? 82 + 14 * f : 10 + 18 * Math.max(0, f)) }
        } else {
          pose[`upperArm${s}`] = { rot: L.arm(s, (run ? 16 : 3) + (run ? 5 : 3) * f), sy: 1 - 0.05 * Math.abs(f) }
          pose[`forearm${s}`] = { rot: L.elbow(s, run ? 55 + 18 * f : 8 + 14 * Math.max(0, f)) }
        }
      }
      if (L.side) {
        pose.spine = { rot: lean + (run ? 2 : 1.2) * cwave(p, 2) }
        pose.head = { rot: -lean * 0.75 - (run ? 1.5 : 1) * cwave(p, 2, 0.1) }
      } else {
        // Weight over the stance leg, the free hip dropping, shoulders countering.
        const sway = (run ? 0.018 : 0.03) * kit.L * st.sway
        pose.hips = { ...pose.hips, x: -sway * rig.sx * wave(p, 1, 0.02 + vary * 0.02), rot: (run ? 1.2 : 2.2) * st.sway * rig.sx * wave(p, 1) }
        pose.spine = { rot: -(pose.hips.rot ?? 0) * 1.25 + L.lean(lean * 0.3) }
        pose.head = { rot: -(pose.hips.rot ?? 0) * 0.3 - (pose.spine.rot ?? 0) * 0.6 }
      }
      return pose
    },
    post: (p, pose) => kit.place(pose, gaitAt(kit, g, st, p).feet),
    hands: () => (run ? { L: 'fist', R: 'fist' } : {}),
  }
}

/* ---- Airborne helpers ---------------------------------------------------------- */

/** Feet planted where they stand (side view: both under the hips). */
const planted = (h = 0, angle = 0, bend = 0.6): Record<Side, Foot> => ({ L: { h, angle, bend }, R: { h, angle, bend } })

/** Feet hanging below the hips in the air: `tuck` 0 straight … 1 knees up. */
const tucked = (kit: LegKit, tuck: number, spread = 0): Record<Side, Foot> => ({
  L: { below: kit.L * (1 - 0.42 * tuck), dx: kit.L * (0.12 * tuck - spread * 0.15), angle: 25 * tuck + 10, bend: tuck },
  R: { below: kit.L * (1 - 0.34 * tuck), dx: kit.L * (0.2 * tuck + spread * 0.15), angle: 20 * tuck + 10, bend: tuck },
})

/** Blends two foot placements. */
function mixFeet(a: Record<Side, Foot>, b: Record<Side, Foot>, t: number, kit: LegKit, hipDip: number): Record<Side, Foot> {
  if (t <= 0) return a
  if (t >= 1) return b
  const out = {} as Record<Side, Foot>
  for (const s of S) {
    // Compare heights in the same terms (height of the ankle above the ground).
    const hOf = (f: Foot) => (f.below !== undefined ? kit.ankleY - (kit.hipY + hipDip + f.below) : (f.h ?? 0))
    out[s] = {
      dx: lerp(a[s].dx ?? 0, b[s].dx ?? 0, t),
      lat: lerp(a[s].lat ?? 0, b[s].lat ?? 0, t),
      h: Math.max(0, lerp(hOf(a[s]), hOf(b[s]), t)),
      angle: lerp(a[s].angle ?? 0, b[s].angle ?? 0, t),
      bend: lerp(a[s].bend ?? 0, b[s].bend ?? 0, t),
    }
  }
  return out
}

/* ---- The library ---------------------------------------------------------------- */

const CLIPS: Record<string, Build> = {
  idle: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig, st.pose)
    const ph = st.u('idle')
    const standing = !OFF_FEET.has(st.pose)
    const shift = standing ? 0.012 * kit.L * st.sway * (L.side ? 0.4 : 1) : 0
    return {
      energy: 0.15, cycles: 1, base: 'pose', blinkAt: 0.45 + ph * 0.3,
      bones: (p) => merge(breathe(rig, p, 1 + st.heavy * 0.4, ph * 0.2), {
        hips: { x: shift * (L.side ? 1 : rig.sx) * wave(p, 1, ph), y: kit.L * 0.006 * (1 + wave(p, 2, ph)) * (standing ? 1 : 0) },
        upperArmL: { rot: L.arm('L', 1.5 * wave(p, 1, 0.2 + ph)) },
        upperArmR: { rot: L.arm('R', 1.5 * wave(p, 1, 0.7 + ph)) },
        head: { rot: L.tilt(1.2 * wave(p, 1, 0.1 + ph)) },
      }),
      post: standing ? (_p, pose) => kit.place(pose, planted(0, 0, 0)) : undefined,
    }
  },
  'idle-look': (rig, st) => {
    const L = limbs(rig)
    const first = st.pick('look', 2) ? 1 : -1
    // Look one way, hold, the other way, hold, back.
    const look = (p: number) => first * keys(p, [[0, 0], [0.12, 1], [0.38, 1], [0.5, 0], [0.62, -1], [0.86, -1], [1, 0]])
    return {
      energy: 0.2, cycles: 1, base: 'pose', blinkAt: 0.5,
      bones: (p) => {
        const k = look(p)
        const lift = bump(p, 0.08, 0.2) + bump(p, 0.58, 0.7)
        return merge(breathe(rig, p, 0.8), {
          head: L.side ? { rot: -2 * Math.abs(k) - 3 * lift } : { rot: L.tilt(-4 * k), x: rig.m.headH * 0.05 * k * rig.sx },
          chest: L.side ? {} : { rot: -1.2 * k * rig.sx },
          neck: L.side ? { rot: -2 * lift } : {},
        })
      },
      expr: (p, base) => ({ ...base, lookX: clamp(look(p) * 0.9 * (L.side ? 0 : 1) + (L.side ? 0.4 * Math.abs(look(p)) : 0), -1, 1), lookY: base.lookY - 0.1 * Math.abs(look(p)) }),
    }
  },
  'idle-fidget': (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const standing = !OFF_FEET.has(st.pose)
    const kind = standing ? st.pick('fidget', 3) : 1
    if (kind === 0) {
      // Foot tapping, head bobbing to the beat.
      return {
        energy: 0.3, cycles: 4, base: 'stand', events: [0.125, 0.375, 0.625, 0.875].map((t) => ({ t, name: 'tap' })),
        bones: (p) => merge(breathe(rig, p, 0.8), {
          head: { rot: L.tilt(1.5 * Math.abs(wave(p, 4))) , y: rig.m.headH * 0.012 * Math.abs(wave(p, 4)) },
          upperArmL: { rot: L.arm('L', 2) },
          hips: { x: 0.01 * kit.L * (L.side ? 0 : rig.sx) },
        }),
        post: (p, pose) => kit.place(pose, { L: { h: 0, bend: 0 }, R: { h: 0, dx: kit.L * 0.12, angle: -24 * Math.abs(wave(p, 4)) , lat: kit.L * 0.06 } }),
      }
    }
    if (kind === 1) {
      // Rocking heel to toe, hands clasped behind.
      return {
        energy: 0.25, cycles: 2, base: 'stand',
        bones: (p) => {
          const r = wave(p, 2)
          return merge(breathe(rig, p, 0.8), {
            upperArmL: { rot: L.arm('L', L.side ? -22 : 6) },
            upperArmR: { rot: L.arm('R', L.side ? -22 : 6) },
            forearmL: { rot: L.elbow('L', L.side ? 20 : 30) },
            forearmR: { rot: L.elbow('R', L.side ? 20 : 30) },
            spine: { rot: L.lean(1.5 * r) },
            head: { rot: L.tilt(1 * wave(p, 1)) },
            hips: { y: -kit.footLen * 0.12 * Math.max(0, r) },
          })
        },
        post: standing ? (p, pose) => kit.place(pose, planted(kit.footLen * 0.12 * Math.max(0, wave(p, 2)) * 0.6, 14 * Math.max(0, wave(p, 2)) - 8 * Math.max(0, -wave(p, 2)), 0)) : undefined,
      }
    }
    // Scratching the back of the head.
    return {
      energy: 0.3, cycles: 4, base: 'stand',
      bones: (p) => {
        const up = keys(p, [[0, 0], [0.18, 1], [0.8, 1], [1, 0]])
        const scr = wave(p, 5) * up
        return merge(breathe(rig, p, 0.8), {
          upperArmR: { rot: L.arm('R', L.side ? 70 * up : 150 * up) },
          forearmR: { rot: L.elbow('R', (L.side ? 150 : 115) * up + 10 * scr) },
          head: { rot: L.tilt(5 * up) },
          spine: { rot: L.lean(-1 * up) },
        })
      },
      expr: (p, base) => (p > 0.15 && p < 0.85 ? { ...expressionState('embarrassed', 0.6), lookX: base.lookX } : base),
      hands: () => ({ R: 'relaxed' }),
    }
  },
  yawn: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const k = (p: number) => keys(p, [[0, 0], [0.25, 0.7], [0.45, 1], [0.7, 1], [0.92, 0], [1, 0]])
    return {
      energy: 0.3, cycles: 1, base: 'stand', blink: false,
      bones: (p) => {
        const s = k(p)
        return {
          upperArmL: { rot: L.arm('L', (L.side ? 165 : 158) * s) },
          upperArmR: { rot: L.arm('R', (L.side ? 160 : 158) * s) },
          forearmL: { rot: L.elbow('L', -10 * s) },
          forearmR: { rot: L.elbow('R', -10 * s) },
          spine: { rot: L.lean(-6 * s) },
          chest: { sy: 1 + 0.03 * s },
          head: { rot: L.tilt(-5 * s) },
          hips: { y: -kit.footLen * 0.25 * s * st.bounce },
        }
      },
      post: (p, pose) => kit.place(pose, planted(kit.footLen * 0.25 * k(p) * st.bounce * 0.7, 18 * k(p), 0)),
      expr: (p, base) => {
        const s = k(p)
        if (s < 0.3) return base
        return { ...expressionState('sleepy', 0.9), eyeL: 'closed', eyeR: 'closed', zzz: false, mouth: 'o', open: clamp(s * 1.1, 0, 1), wide: -0.3 }
      },
      hands: (p) => (k(p) > 0.4 ? { L: 'fist', R: 'fist' } : {}),
    }
  },
  blink: () => ({
    energy: 0, cycles: 1, base: 'pose', blink: false,
    bones: () => ({}),
    expr: (p, base) => ({ ...base, openL: base.openL * (1 - pulse(p, 0.5, 0.5)), openR: base.openR * (1 - pulse(p, 0.5, 0.5)) }),
  }),
  talk: (rig, st) => {
    const L = limbs(rig)
    const seq: Viseme[] = ['A', 'E', 'rest', 'O', 'M', 'I', 'A', 'U', 'E', 'rest', 'L', 'O']
    const hand: Side = st.pick('talkHand', 2) ? 'L' : 'R'
    return {
      energy: 0.2, cycles: 2, base: 'pose',
      bones: (p) => {
        const g = Math.max(0, wave(p, 1, 0.1))
        return merge(breathe(rig, p, 0.5), {
          head: { rot: L.tilt(2 * wave(p, 2)), y: rig.m.headH * 0.01 * wave(p, 3) },
          [`upperArm${hand}`]: { rot: L.arm(hand, (L.side ? 16 : 8) * g) },
          [`forearm${hand}`]: { rot: L.elbow(hand, (L.side ? 55 : 38) * g) },
          spine: { rot: L.lean(1.2 * wave(p, 2, 0.3)) },
        })
      },
      expr: (p, base) => withViseme(base, seq[Math.floor(p * seq.length) % seq.length]),
      hands: (p) => (Math.max(0, wave(p, 1, 0.1)) > 0.3 ? { [hand]: 'open' } : {}),
    }
  },
  walk: (rig, st) => locomotion(rig, st, WALK, false),
  run: (rig, st) => locomotion(rig, st, RUN, true),
  jump: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const H = 0.62 * kit.L * st.bounce
    const crouch = 0.28 * kit.L * Math.min(1.2, st.snap)
    // Hip height above rest (up +) and crouch depth over the jump.
    const air = (p: number) => keys(p, [[0, 0], [0.2, -crouch], [0.29, 0.12 * kit.L], [0.46, H], [0.66, 0.25 * H], [0.73, 0], [0.8, -crouch * 1.05], [0.9, 0.02 * kit.L], [1, 0]])
    const onGround = (p: number) => p < 0.27 || p > 0.72
    return {
      energy: 1, cycles: 1, base: 'stand',
      events: [{ t: 0.28, name: 'takeoff' }, { t: 0.73, name: 'land' }],
      bones: (p) => {
        const a = air(p)
        const low = Math.max(0, -a) / crouch
        const up = !onGround(p)
        return {
          hips: { y: -a },
          spine: { rot: L.lean(16 * low + (up ? -4 : 0)) },
          head: { rot: L.side ? -10 * low : 0 },
          upperArmL: { rot: L.arm('L', up ? (L.side ? 150 : 140) * ramp(p, 0.24, 0.34) * (1 - 0.5 * ramp(p, 0.5, 0.7)) : (L.side ? -40 : 22) * low) },
          upperArmR: { rot: L.arm('R', up ? (L.side ? 150 : 140) * ramp(p, 0.24, 0.34) * (1 - 0.5 * ramp(p, 0.5, 0.7)) : (L.side ? -40 : 22) * low) },
          forearmL: { rot: L.elbow('L', up ? -8 : 18) },
          forearmR: { rot: L.elbow('R', up ? -8 : 18) },
        }
      },
      post: (p, pose) => {
        if (onGround(p)) {
          const push = p < 0.3 ? ramp(p, 0.21, 0.27) : 0
          return kit.place(pose, planted(kit.footLen * 0.6 * Math.sin(push * 0.7), 40 * push, 1))
        }
        const tuck = bump(p, 0.27, 0.7)
        return kit.place(pose, tucked(kit, tuck))
      },
      expr: (p, base) => (p > 0.25 && p < 0.72 ? expressionState('excited', 0.9) : base),
      hands: (p) => (p > 0.25 && p < 0.72 ? { L: 'open', R: 'open' } : {}),
    }
  },
  'jump-up': (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const crouch = 0.26 * kit.L * Math.min(1.2, st.snap)
    const rise = 0.5 * kit.L * st.bounce
    const air = (p: number) => keys(p, [[0, 0], [0.42, -crouch], [0.62, 0.1 * kit.L], [1, rise]])
    return {
      energy: 1, cycles: 1, base: 'stand',
      events: [{ t: 0.6, name: 'takeoff' }],
      bones: (p) => {
        const a = air(p)
        const low = Math.max(0, -a) / crouch
        const up = ramp(p, 0.5, 0.7)
        return {
          hips: { y: -a },
          spine: { rot: L.lean(16 * low - 4 * up) },
          head: { rot: L.side ? -10 * low : 0 },
          upperArmL: { rot: L.arm('L', lerp((L.side ? -40 : 22) * low, L.side ? 150 : 140, up)) },
          upperArmR: { rot: L.arm('R', lerp((L.side ? -40 : 22) * low, L.side ? 150 : 140, up)) },
          forearmL: { rot: L.elbow('L', lerp(18, -8, up)) },
          forearmR: { rot: L.elbow('R', lerp(18, -8, up)) },
        }
      },
      post: (p, pose) => {
        if (p < 0.6) {
          const push = ramp(p, 0.45, 0.6)
          return kit.place(pose, planted(kit.footLen * 0.6 * Math.sin(push * 0.7), 40 * push, 1))
        }
        return kit.place(pose, tucked(kit, 0.55 * ramp(p, 0.6, 1)))
      },
      expr: (p, base) => (p > 0.5 ? expressionState('excited', 0.9) : base),
      hands: (p) => (p > 0.5 ? { L: 'open', R: 'open' } : {}),
    }
  },
  fall: (rig) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 1, cycles: 2, base: 'stand', wind: 1.4,
      bones: (p) => {
        const pose: Pose = {}
        for (const s of S) {
          const ph = s === 'L' ? 0 : 0.5
          pose[`upperArm${s}`] = { rot: L.arm(s, 140 + 16 * wave(p, 2, ph)) }
          pose[`forearm${s}`] = { rot: L.elbow(s, -10 + 20 * wave(p, 2, ph + 0.2)) }
        }
        pose.spine = { rot: L.lean(-4) }
        return pose
      },
      post: (p, pose) =>
        kit.place(pose, {
          L: { below: kit.L * (0.9 - 0.1 * wave(p, 2)), dx: kit.L * (0.05 + 0.1 * wave(p, 2)), angle: 30, bend: 0.4 },
          R: { below: kit.L * (0.85 + 0.1 * wave(p, 2)), dx: kit.L * (0.12 - 0.1 * wave(p, 2)), angle: 25, bend: 0.4 },
        }),
      expr: () => expressionState('shocked', 1),
      hands: () => ({ L: 'open', R: 'open' }),
    }
  },
  land: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const crouch = 0.3 * kit.L * (0.8 + 0.2 * st.bounce)
    // Hips above rest (up +): arrive from the air, absorb, rebound a little, settle.
    const air = (p: number) => keys(p, [[0, 0.22 * kit.L], [0.12, 0], [0.34, -crouch], [0.62, 0.03 * kit.L], [0.8, -0.02 * kit.L], [1, 0]])
    return {
      energy: 1, cycles: 1, base: 'stand',
      events: [{ t: 0.12, name: 'land' }],
      bones: (p) => {
        const a = air(p)
        const low = Math.max(0, -a) / crouch
        const settle = ramp(p, 0.4, 0.9)
        return {
          hips: { y: -a },
          spine: { rot: L.lean(14 * low) },
          head: { rot: L.side ? -8 * low : 0 },
          upperArmL: { rot: L.arm('L', lerp(L.side ? 60 : 70, 0, settle) * (1 - 0.4 * low)) },
          upperArmR: { rot: L.arm('R', lerp(L.side ? 40 : 70, 0, settle) * (1 - 0.4 * low)) },
          forearmL: { rot: L.elbow('L', 20 * (1 - settle)) },
          forearmR: { rot: L.elbow('R', 20 * (1 - settle)) },
        }
      },
      post: (p, pose) => (p < 0.12 ? kit.place(pose, mixFeet(tucked(kit, 0.2), planted(0, 0, 1), ramp(p, 0, 0.12), kit, -air(p))) : kit.place(pose, planted(0, 0, 1))),
      expr: (p, base) => (p < 0.45 ? { ...expressionState('determined', 0.7), lookX: base.lookX } : base),
    }
  },
  wave: (rig, st) => {
    const L = limbs(rig)
    return {
      energy: 0.3, cycles: 2, base: 'wave',
      bones: (p) => merge(breathe(rig, p, 0.5), {
        forearmR: { rot: L.elbow('R', 24 * wave(p, 2)) },
        head: { rot: L.tilt(2 * wave(p, 1)) },
        hips: { x: rig.m.hipHalf * 0.05 * st.sway * (L.side ? 0 : rig.sx) * wave(p, 1, 0.25) },
      }),
      expr: withPreset('happy'),
      hands: () => ({ R: 'wave' }),
    }
  },
  cheer: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    // Two little hops per loop: squat, spring, land.
    const hop = (p: number) => {
      const q = (p * 2) % 1
      return q < 0.62 ? Math.sin((Math.PI * q) / 0.62) : -0.35 * Math.sin((Math.PI * (q - 0.62)) / 0.38)
    }
    const H = 0.16 * kit.L * st.bounce
    return {
      energy: 0.8, cycles: 2, base: 'cheer', events: [{ t: 0.31, name: 'land' }, { t: 0.81, name: 'land' }],
      bones: (p) => {
        const h = hop(p)
        const b = Math.max(0, h)
        return {
          hips: { y: -H * h },
          upperArmL: { rot: L.arm('L', -12 * b) },
          upperArmR: { rot: L.arm('R', -12 * b) },
          forearmL: { rot: L.elbow('L', 12 * Math.max(0, -h)) },
          forearmR: { rot: L.elbow('R', 12 * Math.max(0, -h)) },
        }
      },
      post: (p, pose) => {
        const h = hop(p)
        return h > 0 ? kit.place(pose, tucked(kit, 0.25 * h)) : kit.place(pose, planted(0, 0, 1))
      },
      expr: withPreset('excited'),
    }
  },
  dance: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 0.8, cycles: 4, base: 'stand',
      bones: (p) => ({
        hips: { x: 10 * wave(p, 2) * (L.side ? 0.3 : rig.sx) * st.sway, y: kit.L * 0.05 * Math.abs(wave(p, 4)) },
        spine: { rot: L.lean(5 * wave(p, 2, 0.25)) },
        head: { rot: L.tilt(7 * wave(p, 2, 0.1)) },
        upperArmL: { rot: L.arm('L', 70 + 55 * wave(p, 2)) },
        upperArmR: { rot: L.arm('R', 70 - 55 * wave(p, 2)) },
        forearmL: { rot: L.elbow('L', 60 + 30 * wave(p, 4)) },
        forearmR: { rot: L.elbow('R', 60 - 30 * wave(p, 4)) },
      }),
      post: (p, pose) =>
        kit.place(pose, {
          L: { h: kit.L * 0.05 * Math.max(0, wave(p, 2)), dx: L.side ? kit.L * 0.06 * wave(p, 2) : 0, bend: 0.6 },
          R: { h: kit.L * 0.05 * Math.max(0, -wave(p, 2)), dx: L.side ? -kit.L * 0.06 * wave(p, 2) : 0, bend: 0.6 },
        }),
      expr: withPreset('grin'),
      hands: () => ({ L: 'point', R: 'point' }),
    }
  },
  'dance-hop': (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    // Hop onto one foot and the other, the opposite arm punching up on each beat. Arms and
    // feet trade roles only when both are at rest, so the loop has no seams.
    const H = 0.12 * kit.L * st.bounce
    const hopAt = (p: number) => {
      const q = (p * 2) % 1
      return q < 0.55 ? Math.sin((Math.PI * q) / 0.55) : -0.3 * Math.sin((Math.PI * (q - 0.55)) / 0.45)
    }
    return {
      energy: 0.9, cycles: 2, base: 'stand', events: [{ t: 0, name: 'beat' }, { t: 0.5, name: 'beat' }],
      bones: (p) => {
        const air = hopAt(p)
        const lead: Side = p < 0.5 ? 'L' : 'R'
        const punch = Math.max(0, air)
        const armOf = (s: Side) => (s === lead ? punch : 0)
        return {
          hips: { y: -H * air, x: (L.side ? 0 : rig.sx) * kit.L * 0.05 * wave(p, 1, 0.25) * st.sway },
          spine: { rot: L.lean(-3 * punch) + (L.side ? 0 : -3 * wave(p, 1, 0.25) * rig.sx) },
          head: { rot: L.tilt(5 * wave(p, 1, 0.25)) },
          upperArmL: { rot: L.arm('L', lerp(30, 160, armOf('L'))) },
          upperArmR: { rot: L.arm('R', lerp(30, 160, armOf('R'))) },
          forearmL: { rot: L.elbow('L', lerp(95, 0, armOf('L'))) },
          forearmR: { rot: L.elbow('R', lerp(95, 0, armOf('R'))) },
        }
      },
      post: (p, pose) => {
        const air = Math.max(0, hopAt(p))
        // The foot opposite the punching arm kicks up.
        const kick: Side = p < 0.5 ? 'R' : 'L'
        const foot = (s: Side): Foot => (s === kick ? { h: kit.L * 0.2 * air, dx: L.side ? kit.L * 0.1 * air : 0, bend: 0.7, angle: 20 * air } : { h: kit.L * 0.02 * air, bend: 0.7 })
        return kit.place(pose, { L: foot('L'), R: foot('R') })
      },
      expr: withPreset('excited'),
      hands: () => ({ L: 'fist', R: 'fist' }),
    }
  },
  'dance-sway': (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 0.5, cycles: 1, base: 'stand',
      bones: (p) => {
        const s = wave(p, 1)
        return {
          hips: { x: (L.side ? 0.3 : rig.sx) * kit.L * 0.07 * s * st.sway, y: kit.L * 0.025 * (1 - Math.abs(s)) },
          spine: { rot: L.lean(-4 * s) + (L.side ? 0 : -3 * s * rig.sx) },
          head: { rot: L.tilt(6 * wave(p, 1, 0.1)) },
          upperArmL: { rot: L.arm('L', (L.side ? 160 : 150) + 12 * wave(p, 1, 0.15)) },
          upperArmR: { rot: L.arm('R', (L.side ? 150 : 150) - 12 * wave(p, 1, 0.15)) },
          forearmL: { rot: L.elbow('L', -15 + 10 * wave(p, 2)) },
          forearmR: { rot: L.elbow('R', -15 - 10 * wave(p, 2)) },
        }
      },
      post: (p, pose) =>
        kit.place(pose, {
          L: { h: kit.L * 0.035 * Math.max(0, wave(p, 1)), bend: 0.5, angle: 12 * Math.max(0, wave(p, 1)) },
          R: { h: kit.L * 0.035 * Math.max(0, -wave(p, 1)), bend: 0.5, angle: 12 * Math.max(0, -wave(p, 1)) },
        }),
      expr: (p) => ({ ...expressionState('happy', 1), eyeL: 'happy', eyeR: 'happy', headTilt: 3 * wave(p, 1) }),
      hands: () => ({ L: 'open', R: 'open' }),
    }
  },
  clap: (rig) => {
    const L = limbs(rig)
    return {
      energy: 0.3, cycles: 1, base: 'stand',
      events: [{ t: 0.5, name: 'clap' }],
      bones: (p) => {
        const close = 0.5 + 0.5 * Math.cos(2 * Math.PI * p)
        return {
          upperArmL: { rot: L.arm('L', L.side ? 55 : 22) },
          upperArmR: { rot: L.arm('R', L.side ? 60 : 22) },
          forearmL: { rot: L.elbow('L', L.side ? 70 : 88 + 30 * (1 - close)) },
          forearmR: { rot: L.elbow('R', L.side ? 70 : 88 + 30 * (1 - close)) },
          head: { rot: L.tilt(1.5 * wave(p, 1)) },
        }
      },
      expr: withPreset('happy'),
      hands: () => ({ L: 'open', R: 'open' }),
    }
  },
  nod: (rig) => ({
    energy: 0.2, cycles: 2, base: 'pose',
    bones: (p): Pose => (rig.view === 'side' ? { head: { rot: 9 * Math.max(0, wave(p, 2)) }, neck: { rot: 3 * Math.max(0, wave(p, 2, -0.05)) } } : { head: { y: rig.m.headH * 0.04 * Math.max(0, wave(p, 2)) } }),
    expr: (p, base) => ({ ...withPreset('happy')(p, base), lookY: 0.25 * Math.max(0, wave(p, 2)) }),
  }),
  'shake-head': (rig) => ({
    energy: 0.2, cycles: 2, base: 'pose',
    bones: (p) => ({ head: { rot: 6 * wave(p, 2) * rig.sx, x: rig.view === 'side' ? 0 : rig.m.headH * 0.035 * wave(p, 2) } }),
    expr: (p) => ({ ...expressionState('pout', 0.7), lookX: -wave(p, 2) * 0.6 }),
  }),
  laugh: (rig) => {
    const L = limbs(rig)
    return {
      energy: 0.5, cycles: 4, base: 'stand',
      bones: (p) => ({
        chest: { sy: 1 + 0.025 * Math.abs(wave(p, 4)) },
        head: { rot: L.tilt(-6 + 3 * wave(p, 4)) },
        // Holding the belly.
        upperArmL: { y: -3 * Math.abs(wave(p, 4)), rot: L.arm('L', L.side ? 6 : 16) },
        upperArmR: { y: -3 * Math.abs(wave(p, 4)), rot: L.arm('R', L.side ? 2 : 16) },
        forearmL: { rot: L.elbow('L', L.side ? 88 : 105) },
        forearmR: { rot: L.elbow('R', L.side ? 82 : 105) },
        spine: { rot: L.lean(-4 + 1.5 * Math.abs(wave(p, 4))) },
      }),
      expr: withPreset('laugh', 1),
      hands: () => ({ L: 'relaxed', R: 'relaxed' }),
    }
  },
  cry: (rig) => {
    const L = limbs(rig)
    return {
      energy: 0.2, cycles: 4, base: 'stand',
      bones: (p) => ({
        head: { rot: L.side ? 10 : 0, y: rig.m.headH * 0.03 },
        chest: { y: 2 * Math.abs(wave(p, 4)) },
        spine: { rot: L.lean(5) },
        upperArmL: { rot: L.arm('L', 18), y: 2 * wave(p, 4) },
        upperArmR: { rot: L.arm('R', 18), y: 2 * wave(p, 4, 0.5) },
        forearmL: { rot: L.elbow('L', 120) },
        forearmR: { rot: L.elbow('R', 120) },
      }),
      expr: withPreset('cry', 1),
      hands: () => ({ L: 'fist', R: 'fist' }),
    }
  },
  angry: (rig) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const lift = (p: number) => keys(p, [[0, 0], [0.15, 1], [0.3, 0], [1, 0]])
    return {
      energy: 0.6, cycles: 2, base: 'stand',
      events: [{ t: 0.3, name: 'stomp' }],
      bones: (p) => {
        const hit = pulse(p, 0.32, 0.06)
        return {
          upperArmL: { rot: L.arm('L', 14), x: 1.5 * wave(p, 6) },
          upperArmR: { rot: L.arm('R', 14), x: 1.5 * wave(p, 6, 0.5) },
          forearmL: { rot: L.elbow('L', 25) },
          forearmR: { rot: L.elbow('R', 25) },
          head: { rot: L.tilt(2 * wave(p, 6)) },
          spine: { rot: L.lean(4 + 3 * hit) },
          hips: { y: kit.L * 0.03 * hit },
        }
      },
      post: (p, pose) =>
        kit.place(pose, {
          L: { h: 0, bend: 0.5 },
          R: { h: kit.L * 0.28 * lift(p), dx: L.side ? kit.L * 0.12 * lift(p) : 0, angle: -8 * lift(p), bend: 0.3 },
        }),
      expr: withPreset('furious', 1),
      hands: () => ({ L: 'fist', R: 'fist' }),
    }
  },
  attack: (rig) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 1, cycles: 1, base: 'stand',
      events: [{ t: 0.45, name: 'hit' }],
      bones: (p) => {
        const a = keys(p, [[0, 0], [0.3, 160], [0.45, 30], [0.7, 45], [1, 0]])
        return {
          upperArmR: { rot: L.arm('R', a) },
          forearmR: { rot: L.elbow('R', keys(p, [[0, 0], [0.3, -20], [0.45, 5], [1, 0]])) },
          spine: { rot: L.lean(keys(p, [[0, 0], [0.3, -6], [0.45, 10], [1, 0]])) },
          hips: { y: kit.L * 0.06 * keys(p, [[0, 0], [0.45, 1], [1, 0]]) },
        }
      },
      post: (p, pose) => {
        const step = keys(p, [[0, 0], [0.4, 1], [0.8, 1], [1, 0]])
        return kit.place(pose, { L: { h: 0, dx: L.side ? -kit.L * 0.12 * step : 0, bend: 0.6 }, R: { h: 0, dx: L.side ? kit.L * 0.22 * step : 0, lat: kit.L * 0.05 * step, bend: 0.6 } })
      },
      expr: (p, base) => (p > 0.1 && p < 0.9 ? withPreset('determined', 1)(p, base) : base),
      hands: () => ({ R: 'fist' }),
    }
  },
  cast: (rig) => {
    const L = limbs(rig)
    return {
      energy: 0.5, cycles: 1, base: 'cast',
      bones: (p) => ({
        upperArmR: { rot: L.arm('R', 10 * wave(p, 1)) },
        upperArmL: { rot: L.arm('L', 30 + 20 * Math.max(0, wave(p, 1, 0.25))) },
        forearmL: { rot: L.elbow('L', 60) },
        spine: { rot: L.lean(3 * wave(p, 1)) },
      }),
      expr: withPreset('determined', 0.8),
      hands: () => ({ L: 'open', R: 'open' }),
    }
  },
  hurt: (rig) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 0.8, cycles: 1, base: 'stand',
      bones: (p) => {
        const k = keys(p, [[0, 0], [0.15, 1], [0.6, 0.6], [1, 0]])
        return {
          spine: { rot: L.lean(-12 * k) },
          head: { rot: L.tilt(-10 * k) },
          hips: { x: -8 * k * (L.side ? 1 : 0), y: kit.L * 0.05 * k },
          upperArmL: { rot: L.arm('L', 30 * k) },
          upperArmR: { rot: L.arm('R', 30 * k) },
        }
      },
      post: (p, pose) => {
        const k = keys(p, [[0, 0], [0.15, 1], [0.6, 0.6], [1, 0]])
        return kit.place(pose, { L: { h: 0, dx: L.side ? -kit.L * 0.1 * k : 0, bend: 0.5 }, R: { h: kit.L * 0.06 * pulse(p, 0.2, 0.15), dx: L.side ? kit.L * 0.02 * k : 0, bend: 0.5 } })
      },
      expr: (p, base) => (p < 0.8 ? { ...expressionState('scared', 1), eyeL: 'closed', eyeR: 'closed', mouth: 'grimace', open: 0.5 } : base),
    }
  },
  ko: (rig) => ({
    energy: 1, cycles: 1, base: 'stand',
    events: [{ t: 0.55, name: 'thud' }],
    bones: (p) => ({
      root: { rot: -rig.sx * keys(p, [[0, 0], [0.15, 8], [0.55, 90], [0.65, 84], [0.75, 90], [1, 90]]) },
      upperArmL: { rot: limbs(rig).arm('L', keys(p, [[0, 0], [0.5, 60], [1, 30]])) },
      upperArmR: { rot: limbs(rig).arm('R', keys(p, [[0, 0], [0.5, 60], [1, 30]])) },
    }),
    expr: () => expressionState('dizzy', 1),
  }),
  sit: (rig, st) => ({
    energy: 0.1, cycles: 1, base: 'sit', blinkAt: 0.4 + st.u('sit') * 0.4,
    bones: (p) => merge(breathe(rig, p), { head: { rot: limbs(rig).tilt(1.5 * wave(p, 1, st.u('sitHead'))) } }),
  }),
  sleep: (rig) => {
    const L = limbs(rig)
    // Dozing off seated: head drooping with each slow breath, a little nod.
    return {
      energy: 0.05, cycles: 1, base: 'sit', blink: false,
      bones: (p) => {
        const nod = loopPulse(p, 0.7, 0.12)
        return merge(breathe(rig, p, 1.8), {
          head: { rot: L.side ? 16 + 5 * nod : 10 * rig.sx, y: rig.m.headH * (0.05 + 0.02 * nod) },
          neck: { rot: L.side ? 6 : 0 },
          spine: { rot: L.lean(6) },
          upperArmL: { rot: L.arm('L', L.side ? 10 : 4) },
          upperArmR: { rot: L.arm('R', L.side ? 10 : 4) },
        })
      },
      expr: () => ({ ...expressionState('sleepy', 1), eyeL: 'closed', eyeR: 'closed' }),
    }
  },
  victory: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 0.7, cycles: 2, base: 'stand',
      bones: (p) => {
        const pump = Math.max(0, wave(p, 2))
        return {
          upperArmR: { rot: L.arm('R', 150 + 15 * pump) },
          forearmR: { rot: L.elbow('R', -10) },
          upperArmL: { rot: L.arm('L', 30) },
          forearmL: { rot: L.elbow('L', 110) },
          hips: { y: -kit.L * 0.07 * pump * st.bounce },
          spine: { rot: L.lean(-3 * pump) },
        }
      },
      post: (p, pose) => {
        const pump = Math.max(0, wave(p, 2))
        return kit.place(pose, planted(kit.footLen * 0.5 * pump * st.bounce * 0.5, 30 * pump, 0.3))
      },
      expr: withPreset('excited', 1),
      hands: () => ({ L: 'fist', R: 'fist' }),
    }
  },
  defeat: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    // Slumped, head hanging; a heavy sigh lifts the shoulders once per loop.
    return {
      energy: 0.1, cycles: 1, base: 'stand', blinkAt: 0.3 + st.u('defeat') * 0.2,
      bones: (p) => {
        const sigh = keys(p, [[0, 0], [0.45, 0], [0.62, 1], [0.8, 0], [1, 0]])
        return {
          chest: { y: rig.m.torsoLen * (L.side ? 0.02 : 0.04) * (1 - sigh), sy: 1 + 0.025 * sigh },
          spine: { rot: L.lean(12 - 4 * sigh), sy: L.side ? 1 : 0.97 },
          neck: { rot: L.side ? 8 : 0 },
          head: { rot: L.side ? 16 - 6 * sigh : L.tilt(4), y: rig.m.headH * (L.side ? 0.06 : 0.1) * (1 - sigh) },
          upperArmL: { rot: L.arm('L', L.side ? 14 : 2), y: -rig.m.torsoLen * 0.03 * sigh },
          upperArmR: { rot: L.arm('R', L.side ? 18 : 2), y: -rig.m.torsoLen * 0.03 * sigh },
          forearmL: { rot: L.elbow('L', 6) },
          forearmR: { rot: L.elbow('R', 6) },
          hips: { y: kit.L * 0.05 },
        }
      },
      post: (_p, pose) => kit.place(pose, planted(0, 0, 0.4)),
      expr: (p) => {
        const e = expressionState('sad', 1)
        return { ...e, lookY: 0.5, openL: e.openL * (0.85 - 0.3 * loopPulse(p, 0.62, 0.1)), openR: e.openR * (0.85 - 0.3 * loopPulse(p, 0.62, 0.1)) }
      },
    }
  },
  bow: (rig) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const k = (p: number) => keys(p, [[0, 0], [0.3, 1], [0.62, 1], [0.92, 0], [1, 0]])
    return {
      energy: 0.3, cycles: 1, base: 'stand',
      bones: (p): Pose => {
        const b = k(p)
        if (L.side) {
          return {
            spine: { rot: 42 * b },
            head: { rot: 12 * b },
            upperArmR: { rot: L.arm('R', 40 * b) },
            forearmR: { rot: L.elbow('R', 95 * b) },
            upperArmL: { rot: L.arm('L', -25 * b) },
            forearmL: { rot: L.elbow('L', 30 * b) },
            hips: { x: -kit.L * 0.08 * b },
          }
        }
        // Front/back: the torso tips toward the camera, foreshortened; the head dips.
        return {
          spine: { sy: 1 - 0.2 * b },
          head: { y: rig.m.headH * 0.12 * b },
          upperArmR: { rot: L.arm('R', 12 * b) },
          forearmR: { rot: L.elbow('R', 100 * b) },
        }
      },
      post: (_p, pose) => kit.place(pose, planted(0, 0, 0)),
      expr: (p, base) => (k(p) > 0.4 ? { ...expressionState('happy', 0.8), eyeL: 'happy', eyeR: 'happy', lookY: 0.6 } : base),
      hands: (p) => (k(p) > 0.2 ? { R: 'open' } : {}),
    }
  },
  think: (rig) => {
    const L = limbs(rig)
    return {
      energy: 0.1, cycles: 1, base: 'think',
      bones: (p) => ({ head: { rot: L.tilt(3 * wave(p, 1)) } }),
      expr: (p) => ({ ...expressionState('confused', 0.6), lookY: -0.6, lookX: 0.5 * wave(p, 1) }),
    }
  },
  shrug: (rig) => {
    const L = limbs(rig)
    return {
      energy: 0.3, cycles: 1, base: 'stand',
      bones: (p) => {
        const k = keys(p, [[0, 0], [0.3, 1], [0.75, 1], [1, 0]])
        return {
          upperArmL: { rot: L.arm('L', 30 * k), y: -4 * k },
          upperArmR: { rot: L.arm('R', 30 * k), y: -4 * k },
          forearmL: { rot: L.elbow('L', -60 * k) },
          forearmR: { rot: L.elbow('R', -60 * k) },
          head: { rot: L.tilt(6 * k) },
          chest: { y: -rig.m.torsoLen * 0.02 * k },
        }
      },
      expr: (p, base) => (p > 0.2 && p < 0.85 ? expressionState('confused', 0.8) : base),
      hands: () => ({ L: 'open', R: 'open' }),
    }
  },
  love: (rig, st) => {
    const L = limbs(rig)
    return {
      energy: 0.3, cycles: 2, base: 'heart',
      bones: (p) => ({ hips: { x: 5 * wave(p, 1) * rig.sx * st.sway }, head: { rot: L.tilt(5 * wave(p, 1)) }, spine: { rot: L.lean(-2 * wave(p, 1, 0.25)) } }),
      expr: withPreset('love', 1),
    }
  },
  surprise: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    return {
      energy: 0.8, cycles: 1, base: 'stand',
      bones: (p) => {
        const k = keys(p, [[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]])
        return {
          hips: { y: -kit.L * 0.1 * st.bounce * pulse(p, 0.2, 0.15) },
          spine: { rot: L.lean(-5 * k) },
          upperArmL: { rot: L.arm('L', 40 * k) },
          upperArmR: { rot: L.arm('R', 40 * k) },
          forearmL: { rot: L.elbow('L', -30 * k) },
          forearmR: { rot: L.elbow('R', -30 * k) },
        }
      },
      post: (p, pose) => {
        const j = pulse(p, 0.2, 0.15)
        return j > 0.05 ? kit.place(pose, tucked(kit, 0.2 * j)) : kit.place(pose, planted(0, 0, 0))
      },
      expr: (p, base) => (p > 0.08 && p < 0.9 ? expressionState('shocked', 1) : base),
      hands: () => ({ L: 'open', R: 'open' }),
    }
  },
  hover: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const winged = st.wings
    const lift = kit.L * 0.3
    const beats = winged ? 2 : 1
    return {
      energy: 0.4, cycles: beats, base: 'stand', owns: winged ? ['wingL', 'wingR'] : [],
      bones: (p) => {
        // Downstroke fast, upstroke slow; the body rises on the downstroke.
        const flap = wingStroke(p * beats)
        return {
          root: { y: -lift + kit.L * 0.05 * (winged ? cwave(p, beats, 0.1) : wave(p, 1)) },
          upperArmL: { rot: L.arm('L', winged ? 14 : 24 + 4 * wave(p, 1)) },
          upperArmR: { rot: L.arm('R', winged ? 14 : 24 + 4 * wave(p, 1, 0.5)) },
          forearmL: { rot: L.elbow('L', 20) },
          forearmR: { rot: L.elbow('R', 20) },
          ...(winged ? wings(rig, 30 * flap - 6) : {}),
        }
      },
      post: (p, pose) => kit.place(pose, { L: { below: kit.L * 0.94, dx: kit.L * 0.06, angle: 30, bend: 0.2 }, R: { below: kit.L * (0.84 + 0.04 * wave(p, 1)), dx: kit.L * 0.16, angle: 28, bend: 0.3 } }),
      hands: () => (winged ? {} : { L: 'open', R: 'open' }),
    }
  },
  flap: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const winged = st.wings
    return {
      energy: 0.6, cycles: 1, base: 'pose', owns: winged ? ['wingL', 'wingR'] : [],
      bones: (p): Pose => {
        const flap = wingStroke(p)
        if (winged) return { ...wings(rig, 34 * flap - 4), root: { y: -kit.L * 0.03 * Math.max(0, -cwave(p, 1, 0.1)) } }
        // No wings: flap the arms like a bird, bobbing on bent knees.
        return {
          upperArmL: { rot: L.arm('L', L.side ? 70 + 30 * flap : 55 + 40 * flap) },
          upperArmR: { rot: L.arm('R', L.side ? 70 + 30 * flap : 55 + 40 * flap) },
          forearmL: { rot: L.elbow('L', L.side ? -60 : -30) },
          forearmR: { rot: L.elbow('R', L.side ? -60 : -30) },
          hips: { y: kit.L * 0.04 * (1 - flap) },
          head: { rot: L.tilt(3 * flap) },
        }
      },
      post: winged ? undefined : (_p, pose) => kit.place(pose, planted(0, 0, 0.8)),
      expr: winged ? undefined : withPreset('grin', 0.8),
      hands: () => (winged ? {} : { L: 'open', R: 'open' }),
    }
  },
  glide: (rig, st) => {
    const L = limbs(rig)
    const kit = legKit(rig)
    const winged = st.wings
    return {
      energy: 0.5, cycles: 1, base: 'stand', owns: winged ? ['wingL', 'wingR'] : [], travel: kit.L * 2.4, wind: 0.5,
      bones: (p) => ({
        root: { y: -kit.L * 0.3 - kit.L * 0.04 * wave(p, 1), rot: L.side ? 8 + 2 * wave(p, 1, 0.2) : 0 },
        spine: { rot: L.lean(4) },
        head: { rot: L.side ? -10 : L.tilt(3 * wave(p, 1)) },
        upperArmL: { rot: L.arm('L', winged ? 18 : L.side ? 60 : 88 + 4 * wave(p, 1)) },
        upperArmR: { rot: L.arm('R', winged ? 18 : L.side ? 55 : 88 - 4 * wave(p, 1)) },
        forearmL: { rot: L.elbow('L', winged ? 25 : 5) },
        forearmR: { rot: L.elbow('R', winged ? 25 : 5) },
        ...(winged ? wings(rig, -24 + 4 * wave(p, 1)) : {}),
      }),
      post: (p, pose) => kit.place(pose, { L: { below: kit.L * 0.97, dx: -kit.L * 0.18, angle: 45, bend: 0 }, R: { below: kit.L * 0.95, dx: -kit.L * (0.1 + 0.03 * wave(p, 1)), angle: 42, bend: 0 } }),
      expr: withPreset('happy', 0.8),
      hands: () => (winged ? {} : { L: 'open', R: 'open' }),
    }
  },
}

/** A wing beat over one cycle: a quick downstroke to -1, a slower recovery to +1. */
function wingStroke(p: number): number {
  const q = ((p % 1) + 1) % 1
  return q < 0.4 ? Math.cos((Math.PI * q) / 0.4) : -Math.cos((Math.PI * (q - 0.4)) / 0.6)
}

/** Wing rotations for a stroke angle (+ up, − down), for this view. */
function wings(rig: HumanRig, deg: number): Pose {
  if (rig.view === 'side') return { wingL: { rot: deg * 0.9 }, wingR: { rot: deg } }
  return { wingL: { rot: -deg * rig.sx }, wingR: { rot: deg * rig.sx } }
}

export const HUMAN_CLIP_NAMES = Object.keys(CLIPS)

export function humanMotion(rig: HumanRig, st: HumanStyle, info: ClipInfo): ClipMotion | undefined {
  const b = CLIPS[info.name]
  return b ? b(rig, st, info) : undefined
}

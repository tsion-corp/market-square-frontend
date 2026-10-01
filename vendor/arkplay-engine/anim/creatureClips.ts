/* The creature clip library.
 *
 * Motion comes from anatomy, not from hand-made per-species clips:
 * - Legged gaits place feet (creaturePoses.ts: IK for legs, swings for bugs) on a phase per
 *   leg: a lateral-sequence walk and a gallop for four legs, alternating steps for two, a
 *   tripod for six, a two-footed or bounding hop for hoppers, short rocking steps for
 *   waddlers. The body rides as high as its planted feet allow and pitches between them.
 * - Serpents slither with a travelling wave written as absolute angles along the body
 *   (so the chain stays level), snails ripple, fish beat their tails, jellyfish pulse,
 *   octopuses ripple their arms, ghosts and sky dragons float, wheeled bots roll.
 * - Emotes pick a way to express themselves the body has: a quadruped waves a paw from a
 *   sit, a bird its wing, a fish its tail, a robot its arm, an octopus a tentacle. */

import { clamp, lerp } from '../core/math.ts'
import type { CreatureRig, LegDef } from '../rig/creature.ts'
import type { Pose } from '../rig/skeleton.ts'
import type { ExprState } from '../render/types.ts'
import { expressionState, withViseme, type Viseme } from './expression.ts'
import { bump, cwave, keys, loopPulse, pulse, ramp, wave, type ClipInfo, type ClipMotion } from './clip.ts'
import { bodyPose, creatureKit, stance, type CFoot, type CKit, type Stance } from './creaturePoses.ts'
import { boneAt, matAngle } from './ik.ts'
import type { CreatureStyle } from './profile.ts'

type Build = (k: CKit, st: CreatureStyle, info: ClipInfo) => ClipMotion

const preset = (name: string, k = 0.9) => (_p: number, base: ExprState): ExprState => ({ ...expressionState(name, k), lookX: base.lookX })

const merge = (...poses: Pose[]): Pose => {
  const out: Pose = {}
  for (const p of poses)
    for (const [key, v] of Object.entries(p)) {
      const o = out[key] ?? {}
      out[key] = { rot: (o.rot ?? 0) + (v.rot ?? 0), x: (o.x ?? 0) + (v.x ?? 0), y: (o.y ?? 0) + (v.y ?? 0), sx: (o.sx ?? 1) * (v.sx ?? 1), sy: (o.sy ?? 1) * (v.sy ?? 1) }
    }
  return out
}

const frac = (v: number) => ((v % 1) + 1) % 1

/* ---- Channels --------------------------------------------------------------------- */

/** Wing rotations for a stroke angle (+ up, − down). */
function wingPose(k: CKit, deg: number): Pose {
  if (!k.profile) return { wingF: { rot: deg }, wingN: { rot: -deg } }
  return { wingN: { rot: deg }, wingF: { rot: deg * 0.85 } }
}

/** A wing beat over one cycle: a quick downstroke to −1, a slower recovery to +1. */
function wingStroke(p: number): number {
  const q = frac(p)
  return q < 0.4 ? Math.cos((Math.PI * q) / 0.4) : -Math.cos((Math.PI * (q - 0.4)) / 0.6)
}

/** Wing beats per loop, and stroke size, by wing type. */
function wingBeat(st: CreatureStyle): { beats: number; amp: number; rest: number } {
  switch (st.wings) {
    case 'insect':
      return { beats: 5, amp: 26, rest: 4 }
    case 'fairy':
      return { beats: 2, amp: 30, rest: 6 }
    case 'mech':
      return { beats: 4, amp: 8, rest: 0 }
    case 'flame':
      return { beats: 2, amp: 16, rest: 6 }
    default:
      return { beats: 1, amp: 40, rest: 4 }
  }
}

/** Tail rotation (profile creatures; serpents move theirs with the spine). */
const tail = (k: CKit, deg: number): Pose => (k.profile && k.m.plan !== 'serpent' && k.rig.tail.length ? { tail0: { rot: deg } } : {})

/** The body bone's breathing. */
const breathe = (k: CKit, p: number, amount = 1, phase = 0): Pose => ({ [k.body]: { sy: 1 + 0.014 * amount * wave(p, 1, phase), sx: 1 - 0.005 * amount * wave(p, 1, phase) } })

/** Head and neck: `rot` (+ nods down), plus a bob. Blobs and octopuses wear their face on
 *  the body, so they tilt the whole body a little instead. */
const head = (k: CKit, rot: number, bob = 0): Pose =>
  k.profile ? { neck: { rot: rot * 0.35 }, head: { rot: rot * 0.65, y: bob } } : k.faceOnBody ? { body: { rot: rot * 0.3, y: bob } } : { head: { rot, y: bob } }

/** Front-facing arms (robots, blobs with arms): raise `up` degrees outward, bend the lower. */
function arm(k: CKit, s: 'L' | 'R', up: number, bend = 0): Pose {
  if (k.profile || !k.rig.skel.has(`arm${s}a`)) return {}
  const out = s === 'L' ? -1 : 1
  return { [`arm${s}a`]: { rot: out * up }, [`arm${s}b`]: { rot: out * bend } }
}

/** A stance blended in by `s`, with its feet planted by the post pass. */
function stanceMotion(k: CKit, name: Stance, s: (p: number) => number, extra: (p: number) => Pose = () => ({}), feetOverride?: (p: number, leg: LegDef) => CFoot | undefined): Pick<ClipMotion, 'bones' | 'post'> {
  return {
    bones: (p) => merge(stance(k, name, s(p)).pose, extra(p)),
    post: (p, pose) => {
      const f = stance(k, name, s(p)).feet
      return k.place(pose, (leg) => feetOverride?.(p, leg) ?? f(leg))
    },
  }
}

/* ---- Legged gaits ----------------------------------------------------------------- */

interface GaitSpec {
  /** Fraction of each foot's cycle on the ground. */
  beta: number
  /** Stance sweep and swing lift, in leg reaches. */
  sweep: number
  lift: number
  /** Foot cycles per loop. */
  cycles: number
  phase: (leg: LegDef) => number
  /** Planted legs keep this fraction of full reach (lower = crouchier). */
  kappa: number
  /** Extra lift of the body over the loop (flight arcs), world units, + up. */
  air?: (p: number) => number
  /** Extra pitch (degrees, + nose down). */
  pitch?: (p: number) => number
}

function legPhaseWalk(leg: LegDef): number {
  // Lateral sequence: far hind, far fore, near hind, near fore.
  return (leg.near ? 0.5 : 0) + (leg.at > 0.5 ? 0.25 : 0)
}

function footAt(k: CKit, g: GaitSpec, leg: LegDef, p: number): { f: CFoot; planted: boolean; dx: number; h: number } {
  const S = g.sweep * k.L
  const u = frac(p * g.cycles + g.phase(leg))
  if (u < g.beta) {
    const s = u / g.beta
    const dx = S / 2 - S * s
    return { f: { h: 0, dx, angle: 0 }, planted: true, dx, h: 0 }
  }
  const s = (u - g.beta) / (1 - g.beta)
  const a = 1 - s
  const kick = k.m.plan === 'quadruped' && leg.at < 0.5 ? 0.12 * S : 0.05 * S
  const dx = a * a * a * (-S / 2) + 3 * a * a * s * (-S / 2 - kick) + 3 * a * s * s * (S / 2 + 0.06 * S) + s * s * s * (S / 2)
  const h = g.lift * k.L * 4 * s * (1 - s) * (1 + 0.3 * (0.5 - s))
  const angle = k.m.plan === 'quadruped' ? (leg.at > 0.5 ? 35 : -25) * Math.sin(Math.PI * s) : 12 * Math.sin(Math.PI * s)
  return { f: { h, dx, angle }, planted: false, dx, h }
}

/** Body drop and pitch that keep every foot's target reachable (planted or swinging, so the
 *  body settles into each step smoothly). Each end of the body is held by its own legs and
 *  the body pitches between them about the hips; one pair of legs tilts by the gait's own
 *  pitch. Drops are world units (+ down) at the hips origin, pitch degrees (+ nose down). */
function bodyFor(k: CKit, g: GaitSpec, p: number): { drop: number; pitch: number } {
  const air = g.air?.(p) ?? 0
  if (k.m.plan === 'insectoid' || !k.profile || !k.legs.length) return { drop: -air, pitch: g.pitch?.(p) ?? 0 }
  const req = k.legs.map((leg) => {
    const r = footAt(k, g, leg, p)
    const hip = k.restHip(leg)
    return { x: hip[0], need: k.ankleY - r.h - Math.sqrt(Math.max(0, (g.kappa * k.L) ** 2 - r.dx * r.dx)) - hip[1], fore: k.fore.includes(leg) }
  })
  const tightest = (fore: boolean) => req.filter((r) => r.fore === fore).reduce<(typeof req)[number] | undefined>((a, b) => (!a || b.need > a.need ? b : a), undefined)
  const F = tightest(true)
  const Hd = tightest(false)
  // drop(x) = d0 + (x - xh)·t
  let t: number
  if (F && Hd) t = (F.need - Hd.need) / Math.max(1, F.x - Hd.x)
  else t = Math.tan(((g.pitch?.(p) ?? 0) * Math.PI) / 180)
  let d0 = -Infinity
  for (const r of req) d0 = Math.max(d0, r.need - (r.x - k.xh) * t)
  d0 = Math.max(d0, -air)
  return { drop: d0, pitch: (Math.atan(t) * 180) / Math.PI }
}

function leggedGait(k: CKit, st: CreatureStyle, g: GaitSpec, o: { energy: number; head?: (p: number) => number; tailAmp?: number; extra?: (p: number) => Pose; events?: boolean }): ClipMotion {
  const S = g.sweep * k.L
  return {
    energy: o.energy,
    cycles: Math.max(1, g.cycles * 2),
    base: 'pose',
    travel: (S / g.beta) * g.cycles,
    events: o.events === false ? undefined : [{ t: 0, name: 'footstep' }, { t: 0.5, name: 'footstep' }],
    bones: (p) => {
      const b = bodyFor(k, g, p)
      return merge(
        bodyPose(k, b.drop, b.pitch, 0.8),
        head(k, o.head?.(p) ?? 0),
        tail(k, (o.tailAmp ?? 6) * wave(p, Math.max(1, g.cycles), 0.1) + st.u('tail') * 4),
        o.extra?.(p) ?? {},
      )
    },
    post: (p, pose) => k.place(pose, (leg) => footAt(k, g, leg, p).f),
  }
}

function walkGait(k: CKit, st: CreatureStyle, fast: boolean): ClipMotion {
  const m = k.m
  const tinyCycles = st.tiny > 0.4 ? 2 : 1
  if (m.plan === 'insectoid') {
    // Tripod (six legs) / alternating tetrapod (eight): neighbours in opposite phase.
    const g: GaitSpec = { beta: 0.55, sweep: fast ? 0.7 : 0.55, lift: 0.18, cycles: fast ? 3 : 2, phase: (l) => ((l.pair + (l.near ? 0 : 1)) % 2 ? 0.5 : 0), kappa: 1 }
    return leggedGait(k, st, g, { energy: fast ? 0.8 : 0.4, head: (p) => 2 * wave(p, g.cycles * 2), extra: (p) => bodyPose(k, -k.L * 0.03 * Math.abs(wave(p, g.cycles * 2)), 0, 0) })
  }
  if (!k.profile) {
    // Front-facing legs (robots, legged blobs): a march, body swaying over the stance foot.
    const g: GaitSpec = { beta: 0.55, sweep: 0, lift: fast ? 0.35 : 0.22, cycles: fast ? 2 : 1, phase: (l) => (l.upper.startsWith('legL') ? 0.5 : 0), kappa: 1 }
    const robot = m.plan === 'robot'
    return {
      energy: fast ? 0.8 : 0.5,
      cycles: g.cycles * 2,
      base: 'pose',
      travel: k.L * (fast ? 2.6 : 1.2),
      events: [{ t: 0, name: 'footstep' }, { t: 0.5 / g.cycles, name: 'footstep' }],
      bones: (p) => {
        const step = Math.abs(wave(p, g.cycles * 2))
        return merge(
          { body: { y: -k.L * 0.05 * step, rot: (robot ? 2.5 : 5) * wave(p, g.cycles), x: k.m.bodyR * 0.05 * wave(p, g.cycles) } },
          head(k, (robot ? 2 : 0) * wave(p, g.cycles * 2), 0),
          arm(k, 'L', (fast ? 40 : 18) + 14 * wave(p, g.cycles), fast ? 60 : 20),
          arm(k, 'R', (fast ? 40 : 18) - 14 * wave(p, g.cycles), fast ? 60 : 20),
        )
      },
      post: (p, pose) => k.place(pose, (leg) => {
        const u = frac(p * g.cycles + g.phase(leg))
        return { h: u < g.beta ? 0 : g.lift * k.L * Math.sin((Math.PI * (u - g.beta)) / (1 - g.beta)) }
      }),
      hands: () => ({ L: fast ? 'fist' : 'open', R: fast ? 'fist' : 'open' }),
    }
  }
  if (m.plan === 'avian' || k.fore.length === 0 || k.hind.length === 0) {
    // Two legs: a striding walk (dinosaurs, big birds) with the tail as counterweight.
    const g: GaitSpec = {
      beta: fast ? 0.36 : 0.6,
      sweep: fast ? 0.95 : 0.6,
      lift: fast ? 0.4 : 0.2,
      cycles: 1,
      phase: (l) => (l.near ? 0 : 0.5),
      kappa: 0.97,
      air: fast ? (p) => k.L * 0.08 * Math.max(0, cwave(p, 2, 0.35)) : undefined,
      pitch: () => (fast ? 12 : 5),
    }
    return leggedGait(k, st, g, { energy: fast ? 0.9 : 0.5, head: (p) => (fast ? -6 : -3) * cwave(p, 2, 0.1), tailAmp: fast ? 10 : 6 })
  }
  // Four legs: a lateral-sequence walk, or a gallop with a flight phase.
  const heavy = st.heavy
  if (!fast) {
    const g: GaitSpec = { beta: 0.7, sweep: 0.52 * (1 - heavy * 0.15), lift: 0.2, cycles: tinyCycles, phase: legPhaseWalk, kappa: 0.975 }
    return leggedGait(k, st, g, { energy: 0.5, head: (p) => (2 + heavy * 3) * wave(p, 2 * tinyCycles, 0.15), tailAmp: 7 })
  }
  const g: GaitSpec = {
    beta: 0.34,
    sweep: 0.95,
    lift: 0.34,
    cycles: tinyCycles,
    phase: (l) => (l.at > 0.5 ? 0.42 : 0) + (l.near ? 0.07 : 0),
    kappa: 0.97,
    air: (p) => k.L * 0.12 * Math.max(0, wave(p, tinyCycles, 0.02)),
    pitch: (p) => 4 * wave(p, tinyCycles, 0.1),
  }
  return leggedGait(k, st, g, { energy: 1, head: (p) => -6 * wave(p, tinyCycles, 0.25), tailAmp: 12, extra: (p) => ({ chest: { rot: 3 * wave(p, tinyCycles, 0.3) } }) })
}

/** Waddle: short quick steps, the body rocking fore and aft, wings held out. */
function waddleGait(k: CKit, st: CreatureStyle, fast: boolean): ClipMotion {
  const cycles = fast ? 2 : 2
  const g: GaitSpec = { beta: 0.62, sweep: fast ? 0.55 : 0.35, lift: fast ? 0.35 : 0.25, cycles, phase: (l) => (l.near ? 0 : 0.5), kappa: 0.97, pitch: (p) => 7 * wave(p, cycles, 0.2) }
  return leggedGait(k, st, g, {
    energy: 0.6,
    head: (p) => -4 * wave(p, cycles, 0.25),
    tailAmp: 10,
    // The bob comes from the legs themselves; the flippers paddle for balance.
    extra: (p) => wingPose(k, st.flies ? -10 + 8 * Math.abs(wave(p, cycles)) : 0),
  })
}

/** Hop: bounds with the feet together (birds, blobs, bugs) or fore-then-hind (bunnies, frogs). */
function hopGait(k: CKit, st: CreatureStyle, hops: number, big: boolean): ClipMotion {
  const m = k.m
  // Short-legged hoppers (owls, parrots) spring with the whole body, not just the legs.
  const reach = k.profile ? Math.max(k.L, m.bodyR * 0.55) : m.bodyR
  const H = (big ? 0.9 : 0.6) * reach * (k.legs.length ? 1 : 0.9)
  const ground = 0.42
  // Per hop: ground [0, ground), air [ground, 1).
  const phaseOf = (p: number) => frac(p * hops)
  const airAt = (p: number) => {
    const q = phaseOf(p)
    return q < ground ? 0 : Math.sin((Math.PI * (q - ground)) / (1 - ground))
  }
  const crouchAt = (p: number) => {
    const q = phaseOf(p)
    return q < ground ? Math.sin((Math.PI * q) / ground) : 0
  }
  if (!k.profile && !k.legs.length) {
    // Blobs and bots on a base: squash, stretch into the air, squash on landing.
    return {
      energy: 0.7,
      cycles: hops,
      base: 'pose',
      travel: m.bodyR * (big ? 2.4 : 1.4) * hops,
      events: [{ t: ground / hops, name: 'takeoff' }, { t: 0, name: 'land' }],
      bones: (p) => {
        const a = airAt(p)
        const c = crouchAt(p)
        const q = phaseOf(p)
        const s = q >= ground ? (q - ground) / (1 - ground) : 0
        // Stretch as it leaves the ground, back to round by the landing.
        const stretch = 0.14 * Math.sin(Math.PI * s) * (1.2 - s)
        const sy = 1 - 0.2 * c + stretch
        return merge(
          { body: { y: -H * a + m.bodyR * (1 - sy) * 0.98, sy, sx: 2 - sy, rot: 6 * a * (st.u('hop') > 0.5 ? 1 : -1) * Math.sin(Math.PI * 2 * (q - ground)) } },
          arm(k, 'L', 25 * a, 0),
          arm(k, 'R', 25 * a, 0),
        )
      },
      expr: (p, base) => (airAt(p) > 0.4 ? { ...base, smile: Math.max(base.smile, 0.6), open: 0.25 } : base),
    }
  }
  const S = reach * (big ? 0.9 : 0.6)
  const bound = m.plan === 'quadruped' && k.fore.length > 0 && k.hind.length > 0
  return {
    energy: 0.8,
    cycles: hops,
    base: 'pose',
    travel: (S / ground) * hops,
    events: [{ t: ground / hops, name: 'takeoff' }, { t: 0, name: 'land' }],
    bones: (p) => {
      const a = airAt(p)
      const c = crouchAt(p)
      const q = phaseOf(p)
      const pitch = bound ? (q < ground ? 4 * c : -18 * Math.sin((Math.PI * (q - ground)) / (1 - ground)) + 26 * ramp(q, 0.72, 0.95) * (1 - ramp(q, 0.95, 1))) : 0
      return merge(bodyPose(k, k.L * 0.26 * c - H * a, pitch, 0.7), tail(k, 20 * a - 6 * c), wingPose(k, st.flies ? 30 * a - 10 : 0), head(k, -6 * a + 4 * c))
    },
    post: (p, pose) =>
      k.place(pose, (leg) => {
        const q = phaseOf(p)
        if (q < ground) {
          const s = q / ground
          return { h: 0, dx: S / 2 - S * s }
        }
        // In the air the feet ride up with the body (tucked a little) and travel from where
        // they pushed off to where they land; a bounder's fore feet reach ahead and its hind
        // feet trail, then swing through.
        const s = (q - ground) / (1 - ground)
        const arc = Math.sin(Math.PI * s)
        const fore = leg.at > 0.5
        const e = s * s * (3 - 2 * s)
        const dx = lerp(-S / 2, S / 2, e) + (bound ? (fore ? 0.3 : -0.35) * k.L * arc : 0)
        return { h: Math.max(0, H * arc - k.L * 0.22 * arc), dx, angle: bound ? (fore ? -30 : 40) * arc : 20 * arc }
      }),
    expr: (p, base) => (airAt(p) > 0.5 ? { ...base, smile: Math.max(base.smile, 0.5) } : base),
  }
}

/* ---- Legless locomotion ------------------------------------------------------------- */

/** Serpents: a travelling wave written as absolute angles along the body, so the chain
 *  stays level; the lowest point stays on the ground and the head is held up. */
function slitherGait(k: CKit, st: CreatureStyle, speed: number, lifted = 0, scale = 1): ClipMotion {
  const rig = k.rig
  const sk = rig.skel
  const chain = [...[...rig.tail].reverse(), ...rig.spine]
  const n = chain.length
  const amp = (lifted ? 20 : 16) * (1 - st.heavy * 0.3) * scale
  const waves = lifted ? 1 : 1.5
  const rest = new Map(rig.spine.map((b) => [b, sk.get(b)?.rot ?? 0]))
  const segLen = k.m.bodyLen / Math.max(1, k.m.spineSegs)
  const w0 = sk.world({})
  const restLow = Math.max(...chain.map((b) => boneAt(w0, b)[1]))
  const absAt = (i: number, p: number) => amp * Math.sin(2 * Math.PI * (waves * (i / (n - 1)) + p * speed)) * lerp(0.6, 1, i / (n - 1))
  return {
    energy: 0.5,
    cycles: speed,
    base: 'pose',
    travel: segLen * n * 0.55 * speed,
    bones: (p) => {
      const pose: Pose = {}
      // Absolute tangent angle per chain position (tail tip … chest); relative rotations.
      const abs = chain.map((_, i) => absAt(i, p))
      const hipsIdx = rig.tail.length
      pose.hips = { rot: abs[hipsIdx] }
      for (let i = hipsIdx + 1; i < n; i++) pose[chain[i]] = { rot: abs[i] - abs[i - 1] - (rest.get(chain[i]) ?? 0) }
      // Tail bones point backward: each rotates relative to the one nearer the body.
      for (let j = 0; j < rig.tail.length; j++) {
        const i = hipsIdx - 1 - j
        const parentAbs = j === 0 ? abs[hipsIdx] : abs[i + 1]
        pose[rig.tail[j]] = { rot: abs[i] - parentAbs }
      }
      pose.neck = { rot: 0 }
      pose.head = { rot: 0 }
      if (lifted) pose.root = { y: -lifted - k.m.bodyR * 0.3 * wave(p, 1) }
      return pose
    },
    post: (_p, pose) => {
      const mats = sk.world(pose)
      // Keep the lowest point where it rests (on the ground) and the head level.
      if (!lifted) {
        const low = Math.max(...chain.map((b) => boneAt(mats, b)[1]))
        pose.root = { ...(pose.root ?? {}), y: (pose.root?.y ?? 0) + restLow - low }
      }
      const neckM = mats.get('neck')
      if (neckM) pose.head = { ...(pose.head ?? {}), rot: -matAngle(neckM) * 0.85 }
      return pose
    },
    expr: (p, base) => ({ ...base, lookX: base.lookX, mouth: base.mouth, open: base.open + 0.1 * loopPulse(p, 0.3, 0.05) }),
  }
}

/** Snails: a slow glide, a ripple running along the foot, the shell bobbing. */
function inchGait(k: CKit, fast: boolean): ClipMotion {
  const rig = k.rig
  const segs = rig.spine
  return {
    energy: 0.2,
    cycles: 1,
    base: 'pose',
    travel: k.m.bodyLen * (fast ? 0.5 : 0.25),
    bones: (p) => {
      const pose: Pose = {}
      segs.forEach((b, i) => (pose[b] = { sx: 1 + 0.07 * wave(p, fast ? 2 : 1, -i / segs.length) }))
      pose.head = { rot: 3 * wave(p, 1, 0.3), x: k.m.bodyR * 0.08 * wave(p, fast ? 2 : 1, 0.2) }
      return pose
    },
  }
}

/** Fish: the tail beats (and foreshortens as the fin turns), the body counters gently. */
function swimGait(k: CKit, st: CreatureStyle, beats: number): ClipMotion {
  return {
    energy: 0.6,
    cycles: beats,
    base: 'pose',
    travel: k.m.bodyLen * (0.7 + 0.4 * (beats - 1)),
    bones: (p) => {
      const b = wave(p, beats)
      return merge(
        { hips: { rot: 3 * wave(p, beats, 0.25), y: -k.m.bodyR * 0.06 * wave(p, beats, 0.1) } },
        k.rig.tail.length ? { tail0: { rot: 20 * wave(p, beats, -0.15), sx: 1 - 0.22 * Math.abs(wave(p, beats, -0.4)) } } : {},
        { neck: { rot: -3 * wave(p, beats, 0.25) } },
        k.m.plan === 'serpent' ? {} : breathe(k, p, 0.5 + 0.3 * st.heavy, 0.1),
        { [k.body]: { sx: 1 + 0.015 * b } },
      )
    },
  }
}

/** Floaters (ghosts, wisps, sky dragons, drones): drift and bob, trailing parts lag. */
function floatGait(k: CKit, st: CreatureStyle, fast: boolean, clipName: string): ClipMotion {
  const m = k.m
  if (m.plan === 'serpent') return { ...slitherGait(k, st, fast ? 2 : 1, floatLift(k)), energy: 0.6 }
  const lift = floatLift(k)
  const wb = wingBeat(st)
  const winged = st.flies
  const beats = winged ? wb.beats * (fast ? 2 : 1) : 1
  return {
    energy: 0.5,
    cycles: 1,
    base: 'pose',
    travel: clipName === 'walk' || clipName === 'run' ? m.bodyR * (fast ? 4 : 2) : 0,
    owns: winged ? ['wingN', 'wingF'] : [],
    bones: (p) => {
      const bob = wave(p, fast ? 2 : 1)
      const tilt = fast ? 10 : 4
      return merge(
        k.profile ? bodyPose(k, -lift + m.bodyR * 0.12 * bob, tilt * 0.5, 0.6) : { body: { y: -lift + m.bodyR * 0.12 * bob, rot: tilt * 0.6 + 3 * wave(p, 1, 0.2), sy: 1 + 0.03 * wave(p, 2, 0.1), sx: 1 - 0.02 * wave(p, 2, 0.1) } },
        winged ? wingPose(k, wb.rest + wb.amp * wingStroke(p * beats)) : {},
        arm(k, 'L', 20 + 10 * wave(p, 1, 0.3), 10),
        arm(k, 'R', 20 + 10 * wave(p, 1, 0.8), 10),
        tail(k, -10 + 8 * wave(p, 1, 0.3)),
      )
    },
    post: (p, pose) => k.place(pose, (leg) => ({ below: k.L * (0.85 + 0.05 * wave(p, 1, leg.near ? 0 : 0.3)), dx: -k.L * 0.15, angle: 25 })),
  }
}

/** Wheeled or based bots: glide with a hum of vibration, leaning into the motion. */
function rollGait(k: CKit, fast: boolean): ClipMotion {
  const r = k.m.bodyR
  return {
    energy: 0.4,
    cycles: 4,
    base: 'pose',
    travel: r * (fast ? 5 : 2.5),
    bones: (p) =>
      merge(
        { body: { y: -r * 0.02 * Math.abs(wave(p, fast ? 6 : 4)), rot: (fast ? 7 : 3) + 1.5 * wave(p, 2) } },
        head(k, 2 * wave(p, 2, 0.2)),
        arm(k, 'L', 15 + 6 * wave(p, 2), 10),
        arm(k, 'R', 15 - 6 * wave(p, 2), 10),
      ),
  }
}

/** Octopus: arms ripple in a wave around the mantle; the body sways over them. */
function crawlGait(k: CKit, fast: boolean): ClipMotion {
  const cyc = fast ? 2 : 1
  return {
    energy: 0.5,
    cycles: cyc * 2,
    base: 'pose',
    travel: k.m.bodyR * (fast ? 2.4 : 1.2),
    bones: (p) => {
      const pose: Pose = { body: { y: -k.m.bodyR * 0.06 * Math.abs(wave(p, cyc * 2)), rot: 4 * wave(p, cyc, 0.2) } }
      k.legs.forEach((l, i) => (pose[l.upper] = { rot: 14 * wave(p, cyc, i / k.legs.length), sy: 1 - 0.1 * Math.max(0, wave(p, cyc, i / k.legs.length + 0.25)) }))
      return pose
    },
  }
}

/** Jellyfish: the bell contracts and the body rises; tentacles stream behind. */
function pulseGait(k: CKit, fast: boolean): ClipMotion {
  const beats = fast ? 2 : 1
  const r = k.m.bodyR
  return {
    energy: 0.4,
    cycles: beats,
    base: 'pose',
    travel: 0,
    bones: (p) => {
      const q = frac(p * beats)
      const c = q < 0.3 ? Math.sin((Math.PI * q) / 0.6) : Math.cos((Math.PI * (q - 0.3)) / 1.4)
      const rise = keys(q, [[0, 0], [0.35, 1], [1, 0]])
      const pose: Pose = { body: { sx: 1 - 0.13 * c, sy: 1 + 0.09 * c, y: -r * 0.35 - r * 0.25 * rise } }
      k.legs.forEach((l, i) => (pose[l.upper] = { sy: 1 + 0.12 * c, rot: 5 * wave(p, 1, i * 0.15) }))
      return pose
    },
  }
}

/** Everything that moves: walk and run by gait. */
function locomote(k: CKit, st: CreatureStyle, fast: boolean, clipName: string): ClipMotion {
  switch (st.gait) {
    case 'walk':
    case 'stride':
      return walkGait(k, st, fast)
    case 'waddle':
      return waddleGait(k, st, fast)
    case 'hop':
      return hopGait(k, st, fast ? 1 : 2, fast)
    case 'slither':
      return slitherGait(k, st, fast ? 2 : 1)
    case 'inch':
      return inchGait(k, fast)
    case 'swim':
      return swimGait(k, st, fast ? 2 : 1)
    case 'float':
    case 'hover':
      return floatGait(k, st, fast, clipName)
    case 'roll':
      return rollGait(k, fast)
    case 'crawl':
      return crawlGait(k, fast)
    case 'pulse':
      return pulseGait(k, fast)
  }
}

/* ---- Emote helpers ----------------------------------------------------------------- */

/** Bounces in place: `n` hops per loop of height `h` (fraction of leg reach or body size). */
function bounce(k: CKit, st: CreatureStyle, p: number, n: number, h: number): Pose {
  const q = frac(p * n)
  const up = q < 0.6 ? Math.sin((Math.PI * q) / 0.6) : 0
  const squat = q >= 0.6 ? Math.sin((Math.PI * (q - 0.6)) / 0.4) : 0
  const size = k.legs.length && k.profile ? k.L : k.m.bodyR
  if (!k.profile && !k.legs.length) {
    const sy = 1 - 0.12 * squat + 0.06 * up
    return { body: { y: -size * h * up + k.m.bodyR * (1 - sy) * 0.98, sy, sx: 2 - sy } }
  }
  void st
  return bodyPose(k, -size * h * up + size * 0.12 * squat, 0, 0)
}

/** Feet during a bounce: tucked in the air, planted on the ground. */
function bounceFeet(k: CKit, p: number, n: number): (leg: LegDef) => CFoot {
  const q = frac(p * n)
  const up = q < 0.6 ? Math.sin((Math.PI * q) / 0.6) : 0
  return (leg) => (up > 0.02 ? { below: k.L * (0.97 - 0.2 * up), dx: (leg.at > 0.5 ? 0.1 : -0.1) * k.L * up, angle: 20 * up } : { h: 0 })
}

/** The limb a creature waves with: a paw (from a sit), a wing, an arm, a tentacle, a tail. */
function waveLimb(k: CKit, st: CreatureStyle, p: number, big: number): Pose {
  const m = k.m
  const w = wave(p, 2)
  if (!k.profile && k.rig.skel.has('armRa') && st.arms !== 'none') return merge(arm(k, 'R', 120 + 20 * big, 20 + 30 * w), arm(k, 'L', 12, 10))
  if (m.plan === 'cephalopod' && k.legs.length) {
    const t = k.legs[k.legs.length - 1]
    return { [t.upper]: { rot: -110 - 25 * w } }
  }
  if (st.flies && k.profile) return { wingN: { rot: 30 + 25 * w }, wingF: { rot: 6 } }
  return {}
}

/* ---- The library ------------------------------------------------------------------- */

const CLIPS: Record<string, Build> = {
  idle: (k, st) => {
    const m = k.m
    const ph = st.u('idle')
    const floating = st.gait === 'float' || st.gait === 'hover' || st.gait === 'pulse'
    const drift = floating ? locomote(k, st, false, 'idle') : undefined
    const idleWave = slitherGait(k, st, 1, 0, 0.35)
    return {
      energy: 0.2, cycles: 1, base: 'pose', blinkAt: 0.45 + ph * 0.3, owns: drift?.owns,
      bones: (p) => {
        const pose = merge(
          breathe(k, p, 1 + st.heavy * 0.5, ph),
          head(k, 2.5 * wave(p, 1, 0.2 + ph), -m.bodyR * 0.02 * wave(p, 1, ph)),
          tail(k, 5 * wave(p, 1, ph + 0.3)),
          wingPose(k, st.flies && !drift ? 2 * wave(p, 1, ph) : 0),
          arm(k, 'L', 3 * wave(p, 1, ph), 4 * wave(p, 1, ph + 0.2)),
          arm(k, 'R', 3 * wave(p, 1, ph + 0.5), 4 * wave(p, 1, ph + 0.7)),
        )
        if (drift) return merge(pose, drift.bones(p))
        if (m.plan === 'serpent') return merge(pose, idleWave.bones(p))
        if (m.plan === 'aquatic') return merge(pose, { hips: { rot: 1.5 * wave(p, 1, ph) }, tail0: { rot: 6 * wave(p, 1, ph - 0.15) } })
        if (m.plan === 'cephalopod') k.legs.forEach((l, i) => (pose[l.upper] = { rot: 6 * wave(p, 1, i * 0.13 + ph) }))
        return pose
      },
      post: drift ? drift.post : m.plan === 'serpent' ? idleWave.post : (_p, pose) => k.place(pose, () => ({ h: 0 })),
    }
  },
  'idle-look': (k, st) => {
    const first = st.pick('look', 2) ? 1 : -1
    const look = (p: number) => first * keys(p, [[0, 0], [0.12, 1], [0.38, 1], [0.5, 0], [0.62, -1], [0.86, -1], [1, 0]])
    return {
      energy: 0.2, cycles: 1, base: 'pose', blinkAt: 0.5,
      bones: (p) => merge(breathe(k, p, 0.8), head(k, -8 * Math.max(0, look(p)) + 5 * Math.max(0, -look(p))), tail(k, 6 * look(p))),
      post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
      expr: (p, base) => ({ ...base, lookX: clamp(0.9 * look(p), -1, 1), lookY: base.lookY - 0.3 * Math.max(0, look(p)) }),
    }
  },
  'idle-fidget': (k, st) => {
    const m = k.m
    const paw = k.fore.find((l) => l.near) ?? k.fore[0]
    // Birds preen, legged creatures paw the ground, the rest wriggle.
    if (m.plan === 'avian' && st.flies) {
      return {
        energy: 0.3, cycles: 2, base: 'pose',
        bones: (p) => {
          const k2 = keys(p, [[0, 0], [0.2, 1], [0.75, 1], [0.95, 0], [1, 0]])
          return merge(breathe(k, p), { neck: { rot: -60 * k2 }, head: { rot: -50 * k2 + 6 * wave(p, 6) * k2 } }, wingPose(k, 10 * k2 + 3 * wave(p, 6) * k2))
        },
        post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
        expr: (p, base) => (p > 0.2 && p < 0.75 ? { ...base, openL: 0.3, openR: 0.3 } : base),
      }
    }
    if (paw && k.profile && m.plan !== 'insectoid') {
      return {
        energy: 0.4, cycles: 3, base: 'pose',
        bones: (p) => merge(breathe(k, p), head(k, 6 * bump(p, 0.1, 0.9)), tail(k, 10 * wave(p, 3))),
        post: (p, pose) => k.place(pose, (leg) => (leg === paw ? { h: k.L * 0.18 * Math.abs(wave(p, 3)) * bump(p, 0.05, 0.95), dx: k.L * 0.1 * Math.abs(wave(p, 3)), angle: 20 * Math.abs(wave(p, 3)) } : { h: 0 })),
        events: [1 / 6, 0.5, 5 / 6].map((t) => ({ t, name: 'tap' })),
      }
    }
    return {
      energy: 0.5, cycles: 3, base: 'pose',
      bones: (p) => merge(k.profile ? { hips: { rot: 3 * wave(p, 3) } } : { body: { rot: 6 * wave(p, 3), sx: 1 + 0.03 * wave(p, 6), sy: 1 - 0.03 * wave(p, 6) } }, head(k, 4 * wave(p, 3, 0.2)), arm(k, 'L', 10 + 10 * wave(p, 3), 20), arm(k, 'R', 10 - 10 * wave(p, 3), 20), tail(k, 12 * wave(p, 3, 0.4))),
      post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
      expr: preset('mischief', 0.7),
    }
  },
  yawn: (k, st) => {
    const s = (p: number) => keys(p, [[0, 0], [0.3, 1], [0.7, 1], [0.95, 0], [1, 0]])
    const legged = k.profile && k.legs.length > 0 && (k.m.plan === 'quadruped' || k.m.plan === 'insectoid')
    return {
      energy: 0.3, cycles: 1, base: 'pose', blink: false,
      ...(legged
        ? stanceMotion(k, 'bow', s, (p) => merge(tail(k, 20 * s(p)), head(k, -10 * s(p))))
        : {
            bones: (p: number) => merge(k.profile ? bodyPose(k, 0, -6 * s(p), 0.5) : { body: { sy: 1 + 0.08 * s(p), sx: 1 - 0.05 * s(p), y: -k.m.bodyR * 0.08 * s(p) } }, head(k, -10 * s(p)), wingPose(k, st.flies ? 40 * s(p) : 0), arm(k, 'L', 140 * s(p), 0), arm(k, 'R', 140 * s(p), 0)),
            post: (_p: number, pose: Pose) => k.place(pose, () => ({ h: 0 })),
          }),
      expr: (p, base) => (s(p) > 0.3 ? { ...expressionState('sleepy', 0.9), eyeL: 'closed', eyeR: 'closed', zzz: false, mouth: 'o', open: clamp(s(p) * 1.1, 0, 1), wide: -0.3 } : base),
    }
  },
  blink: () => ({
    energy: 0, cycles: 1, base: 'pose', blink: false,
    bones: () => ({}),
    expr: (p, base) => ({ ...base, openL: base.openL * (1 - pulse(p, 0.5, 0.5)), openR: base.openR * (1 - pulse(p, 0.5, 0.5)) }),
  }),
  talk: (k) => {
    const seq: Viseme[] = ['A', 'rest', 'O', 'M', 'E', 'A', 'U', 'rest', 'E', 'O', 'A', 'rest']
    return {
      energy: 0.2, cycles: 2, base: 'pose',
      bones: (p) => merge(head(k, 3 * wave(p, 2)), { jaw: { rot: 8 * Math.abs(wave(p, 4)) } }, tail(k, 4 * wave(p, 2, 0.3)), arm(k, 'R', 20 * Math.max(0, wave(p, 1)), 30 * Math.max(0, wave(p, 1)))),
      post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
      expr: (p, base) => withViseme(base, seq[Math.floor(p * seq.length) % seq.length]),
      blink: k.m.plan !== 'robot',
    }
  },
  walk: (k, st) => locomote(k, st, false, 'walk'),
  run: (k, st) => locomote(k, st, true, 'run'),
  hop: (k, st) => {
    if (k.m.plan === 'serpent') {
      // A spring: coil, launch, land.
      return {
        energy: 0.7, cycles: 1, base: 'pose', travel: k.m.bodyLen * 0.6,
        bones: (p) => {
          const a = keys(p, [[0, 0], [0.3, 0], [0.55, 1], [0.8, 0], [1, 0]])
          return merge(slitherGait(k, st, 1).bones(p), { root: { y: -k.m.bodyR * 3 * a } })
        },
      }
    }
    if (k.m.plan === 'aquatic') {
      // A leap out of the water: an arc, nose up then down, the tail flicking.
      return {
        energy: 0.8, cycles: 1, base: 'pose', travel: k.m.bodyLen * 1.2,
        bones: (p) => {
          const a = keys(p, [[0, 0], [0.2, 0], [0.5, 1], [0.8, 0], [1, 0]])
          const tilt = keys(p, [[0, 0], [0.2, -25], [0.5, 0], [0.8, 25], [1, 0]])
          return merge({ root: { y: -k.m.bodyR * 2.2 * a } }, bodyPose(k, 0, tilt, 0.3), tail(k, 20 * wave(p, 2)))
        },
      }
    }
    if (k.m.plan === 'cephalopod') return { ...hopGait(k, st, 1, true), post: undefined }
    return hopGait(k, st, 1, true)
  },
  jump: (k, st) => {
    const m = k.m
    const size = k.legs.length && k.profile ? k.L : m.bodyR
    const H = size * (k.legs.length ? 1.1 : 1.3)
    const air = (p: number) => keys(p, [[0, 0], [0.2, 0], [0.3, 0.72], [0.45, 1], [0.62, 0.72], [0.74, 0], [1, 0]])
    const crouch = (p: number) => keys(p, [[0, 0], [0.2, 1], [0.28, 0], [0.72, 0], [0.8, 1], [1, 0]])
    const inAir = (p: number) => p > 0.26 && p < 0.74
    return {
      energy: 1, cycles: 1, base: 'pose',
      events: [{ t: 0.28, name: 'takeoff' }, { t: 0.74, name: 'land' }],
      bones: (p) => {
        const a = air(p)
        const c = crouch(p)
        if (!k.profile && !k.legs.length) {
          const sy = 1 - 0.22 * c + 0.12 * a * (1 - a) * 4 * (p < 0.45 ? 1 : 0.5)
          return merge({ body: { y: -H * a + m.bodyR * (1 - sy) * 0.98, sy, sx: 2 - sy } }, arm(k, 'L', 60 * a, 0), arm(k, 'R', 60 * a, 0))
        }
        if (m.plan === 'serpent' || m.plan === 'aquatic') {
          // Leap: an arc, nose up on the way up and down on the way down.
          const tilt = p < 0.45 ? -25 * a : 25 * (1 - a) * (inAir(p) ? 1 : 0)
          return merge({ root: { y: -H * a * 1.3 } }, bodyPose(k, 0, tilt, 0.4), tail(k, 15 * a))
        }
        const pitch = k.fore.length && k.hind.length ? (p < 0.45 ? -14 * a : 12 * (1 - a) * (inAir(p) ? 1 : 0)) : 0
        return merge(bodyPose(k, k.L * 0.3 * c - H * a, pitch + 5 * c, 0.7), tail(k, 20 * a - 10 * c), wingPose(k, st.flies ? 35 * a - 20 * c : 0), head(k, -8 * a + 6 * c), arm(k, 'L', 70 * a, 0), arm(k, 'R', 70 * a, 0))
      },
      post: (p, pose) =>
        k.place(pose, (leg) => {
          if (!inAir(p)) return { h: 0 }
          const t = bump(p, 0.26, 0.74)
          return { below: k.L * (0.97 - 0.3 * t), dx: (leg.at > 0.5 ? 0.25 : -0.2) * k.L * t, angle: (leg.at > 0.5 ? -30 : 30) * t }
        }),
      expr: (p, base) => (p > 0.25 && p < 0.72 ? expressionState('excited', 0.9) : base),
    }
  },
  'jump-up': (k, st) => {
    const m = k.m
    const size = k.legs.length && k.profile ? k.L : m.bodyR
    const rise = size * 0.7
    const air = (p: number) => keys(p, [[0, 0], [0.55, 0], [1, 1]])
    const crouch = (p: number) => keys(p, [[0, 0], [0.42, 1], [0.6, 0], [1, 0]])
    return {
      energy: 1, cycles: 1, base: 'pose', events: [{ t: 0.6, name: 'takeoff' }],
      bones: (p) => {
        const a = air(p)
        const c = crouch(p)
        if (!k.profile && !k.legs.length) {
          const sy = 1 - 0.2 * c + 0.12 * a
          return merge({ body: { y: -rise * a + m.bodyR * (1 - sy) * 0.98, sy, sx: 2 - sy } }, arm(k, 'L', 60 * a, 0), arm(k, 'R', 60 * a, 0))
        }
        return merge(bodyPose(k, k.L * 0.3 * c - rise * a, -12 * a + 5 * c, 0.7), tail(k, 18 * a - 8 * c), wingPose(k, st.flies ? 40 * a - 20 * c : 0), head(k, -8 * a), arm(k, 'L', 70 * a, 0), arm(k, 'R', 70 * a, 0))
      },
      post: (p, pose) => k.place(pose, (leg) => (p < 0.6 ? { h: 0 } : { below: k.L * (0.97 - 0.25 * ramp(p, 0.6, 1)), dx: (leg.at > 0.5 ? 0.2 : -0.25) * k.L * ramp(p, 0.6, 1), angle: 25 * ramp(p, 0.6, 1) })),
      expr: (p, base) => (p > 0.5 ? expressionState('excited', 0.9) : base),
    }
  },
  fall: (k, st) => {
    const m = k.m
    return {
      energy: 1, cycles: 2, base: 'pose', wind: 1.4, owns: st.flies ? ['wingN', 'wingF'] : [],
      bones: (p) =>
        merge(
          k.profile ? bodyPose(k, 0, 4 * wave(p, 2), 0.5) : { body: { rot: 5 * wave(p, 2), sx: 1 - 0.04 * wave(p, 4), sy: 1 + 0.04 * wave(p, 4) } },
          wingPose(k, st.flies ? 30 + 20 * wave(p, 4) : 0),
          tail(k, 25 + 8 * wave(p, 2)),
          arm(k, 'L', 130 + 15 * wave(p, 2), 20),
          arm(k, 'R', 130 + 15 * wave(p, 2, 0.5), 20),
          m.plan === 'cephalopod' ? Object.fromEntries(k.legs.map((l, i) => [l.upper, { rot: (l.at - 0.5) * -60 + 8 * wave(p, 2, i * 0.1) }])) : {},
        ),
      post: (p, pose) => k.place(pose, (leg) => ({ below: k.L * (0.9 + 0.05 * wave(p, 2, leg.near ? 0 : 0.5)), dx: (leg.at > 0.5 ? 0.15 : -0.15) * k.L, angle: 20 })),
      expr: () => expressionState('shocked', 1),
    }
  },
  land: (k) => {
    const m = k.m
    const size = k.legs.length && k.profile ? k.L : m.bodyR
    const air = (p: number) => keys(p, [[0, 0.3], [0.12, 0], [1, 0]])
    const crouch = (p: number) => keys(p, [[0, 0], [0.12, 0.2], [0.32, 1], [0.6, -0.1], [0.8, 0.05], [1, 0]])
    return {
      energy: 1, cycles: 1, base: 'pose', events: [{ t: 0.12, name: 'land' }],
      bones: (p) => {
        const a = air(p)
        const c = crouch(p)
        if (!k.profile && !k.legs.length) {
          const sy = 1 - 0.22 * c
          return { body: { y: -size * a + m.bodyR * (1 - sy) * 0.98, sy, sx: 2 - sy } }
        }
        return merge(bodyPose(k, k.L * 0.28 * c - size * a, 6 * c, 0.7), tail(k, -12 * c + 10 * a), head(k, 8 * c), arm(k, 'L', 40 * c, 0), arm(k, 'R', 40 * c, 0))
      },
      post: (p, pose) => k.place(pose, (leg) => (p < 0.12 ? { below: k.L * 0.9, dx: (leg.at > 0.5 ? 0.12 : -0.1) * k.L * (1 - p / 0.12), angle: 15 } : { h: 0 })),
    }
  },
  hover: (k, st) => {
    if (st.flies || st.gait === 'float' || st.gait === 'hover' || st.gait === 'pulse') {
      const base = st.gait === 'pulse' ? pulseGait(k, false) : floatGait(k, st, false, 'hover')
      return { ...base, travel: 0 }
    }
    // No wings: float up as if by magic, legs dangling.
    return { ...floatGait(k, st, false, 'hover'), travel: 0 }
  },
  flap: (k, st) => {
    const wb = wingBeat(st)
    if (st.flies) {
      return {
        energy: 0.6, cycles: wb.beats, base: 'pose', owns: ['wingN', 'wingF'],
        bones: (p) => merge(wingPose(k, wb.rest + wb.amp * wingStroke(p * wb.beats)), bounce(k, st, p, 1, 0.05), head(k, -3 * wave(p, 1))),
        post: (p, pose) => k.place(pose, bounceFeet(k, p, 1)),
        expr: preset('happy', 0.8),
      }
    }
    // Wingless: paddle the front paws / flap the arms, bouncing.
    const paw = k.fore.filter((l) => l.near)
    return {
      energy: 0.6, cycles: 2, base: 'pose',
      bones: (p) => merge(bounce(k, st, p, 2, 0.04), arm(k, 'L', 70 + 40 * wave(p, 2), 10), arm(k, 'R', 70 + 40 * wave(p, 2), 10), tail(k, 14 * wave(p, 2))),
      post: (p, pose) => k.place(pose, (leg) => (paw.includes(leg) ? { h: k.L * 0.15 * Math.abs(wave(p, 2)), dx: k.L * 0.15 * Math.abs(wave(p, 2)), angle: 30 } : bounceFeet(k, p, 2)(leg))),
      expr: preset('grin', 0.8),
    }
  },
  glide: (k, st) => {
    const m = k.m
    if (m.plan === 'serpent') return { ...floatGait(k, st, false, 'glide'), travel: m.bodyLen }
    const lift = k.profile ? k.L * 0.55 + m.bodyR * 0.3 : m.bodyR * 0.4
    return {
      energy: 0.5, cycles: 1, base: 'pose', owns: st.flies ? ['wingN', 'wingF'] : [], travel: (k.profile ? k.L : m.bodyR) * 3, wind: 0.4,
      bones: (p) =>
        merge(
          k.profile ? bodyPose(k, -lift - m.bodyR * 0.1 * wave(p, 1), 4 + 3 * wave(p, 1, 0.2), 0.6) : { body: { y: -lift - m.bodyR * 0.1 * wave(p, 1), rot: 6 } },
          wingPose(k, st.flies ? -12 + 5 * wave(p, 1, 0.1) : 0),
          tail(k, -6 + 5 * wave(p, 1, 0.4)),
          arm(k, 'L', 85, 0),
          arm(k, 'R', 85, 0),
        ),
      post: (_p, pose) => k.place(pose, (leg) => ({ below: k.L * 0.95, dx: (leg.at > 0.5 ? 0.3 : -0.35) * k.L, angle: leg.at > 0.5 ? -20 : 40 })),
    }
  },
  fly: (k, st) => {
    const m = k.m
    if (m.plan === 'aquatic') return swimGait(k, st, 2)
    if (!st.flies) return floatGait(k, st, true, 'run')
    const wb = wingBeat(st)
    const lift = k.profile ? k.L * 0.7 + m.bodyR * 0.3 : m.bodyR * 0.45
    return {
      energy: 0.6, cycles: wb.beats, base: 'pose', owns: ['wingN', 'wingF'], travel: (k.profile ? m.bodyLen + k.L : m.bodyR * 2) * 2.2,
      bones: (p) => {
        const stroke = wingStroke(p * wb.beats)
        // The body rises on the downstroke.
        const bob = m.bodyR * 0.12 * cwave(p, wb.beats, 0.1) * (wb.beats > 2 ? 0.3 : 1)
        return merge(
          k.profile ? bodyPose(k, -lift + bob, 6 + 3 * wave(p, 1), 0.6) : { body: { y: -lift + bob, rot: 8 } },
          wingPose(k, wb.rest + wb.amp * stroke),
          tail(k, -8 + 6 * wave(p, 1, 0.3)),
          head(k, -4),
        )
      },
      // Legs tucked for flight: fore paws folded under the chest, hind legs trailing.
      post: (_p, pose) => k.place(pose, (leg) => (leg.at > 0.5 && k.hind.length ? { below: k.L * 0.55, dx: k.L * 0.25, angle: -45 } : { below: k.L * 0.6, dx: -k.L * 0.55, angle: 55 })),
    }
  },
  swim: (k, st) => {
    const m = k.m
    if (m.plan === 'aquatic') return swimGait(k, st, 1)
    if (m.plan === 'serpent') return { ...slitherGait(k, st, 1, m.bodyR * 1.2), travel: m.bodyLen * 0.8 }
    if (m.plan === 'cephalopod') return st.jelly ? pulseGait(k, false) : { ...crawlGait(k, false), bones: (p) => merge(crawlGait(k, false).bones(p), { body: { y: -m.bodyR * 0.4 - m.bodyR * 0.1 * wave(p, 1), rot: 8 } }) }
    // Paddling: body low and level, legs cycling, head up.
    const g: GaitSpec = { beta: 0.5, sweep: 0.5, lift: 0.1, cycles: 2, phase: legPhaseWalk, kappa: 0.95 }
    return {
      energy: 0.5, cycles: 2, base: 'pose', travel: k.L * 1.2,
      bones: (p) => merge(k.profile ? bodyPose(k, k.L * 0.35 + m.bodyR * 0.05 * wave(p, 2), -4, 1) : { body: { y: m.bodyR * 0.3 + m.bodyR * 0.05 * wave(p, 2) } }, tail(k, 12 * wave(p, 2)), wingPose(k, st.flies ? -10 + 15 * wave(p, 2) : 0), arm(k, 'L', 60 + 30 * wave(p, 2), 20), arm(k, 'R', 60 - 30 * wave(p, 2), 20)),
      post: (p, pose) => k.place(pose, (leg) => ({ below: k.L * 0.75, dx: footAt(k, g, leg, p).dx, angle: 30 })),
    }
  },
  slither: (k, st) => {
    const m = k.m
    if (m.plan === 'serpent') return slitherGait(k, st, 1)
    if (m.plan === 'aquatic') return swimGait(k, st, 1)
    // A belly crawl: body low, legs paddling, spine and tail swaying.
    const g: GaitSpec = { beta: 0.6, sweep: 0.4, lift: 0.08, cycles: 1, phase: legPhaseWalk, kappa: 0.8 }
    return {
      energy: 0.5, cycles: 2, base: 'pose', travel: (g.sweep * k.L) / g.beta,
      bones: (p) => merge(stance(k, 'low', 1).pose, tail(k, 16 * wave(p, 1)), head(k, 4 * wave(p, 1, 0.3)), k.profile ? {} : { body: { rot: 8 * wave(p, 1), sx: 1 + 0.04 * wave(p, 2) } }),
      post: (p, pose) => k.place(pose, (leg) => footAt(k, g, leg, p).f),
    }
  },
  wag: (k) => ({
    energy: 0.6, cycles: 2, base: 'pose',
    bones: (p) => merge(tail(k, 24 * wave(p, 2)), head(k, 2 * wave(p, 2)), k.profile && k.m.plan !== 'serpent' ? { hips: { rot: 1.5 * wave(p, 2, 0.5) } } : {}, !k.profile ? { body: { rot: 7 * wave(p, 2) } } : {}, k.m.plan === 'serpent' ? slitherGait(k, { ...stNeutral }, 2).bones(p) : {}),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: preset('happy', 1),
  }),
  wave: (k, st) => {
    const m = k.m
    // Quadrupeds and bugs sit up and wave a front paw; others wave what they have.
    if (k.profile && k.fore.length && (m.plan === 'quadruped' || m.plan === 'insectoid')) {
      const paw = k.fore.find((l) => l.near) ?? k.fore[0]
      const sitS = () => 1
      return {
        energy: 0.4, cycles: 2, base: 'pose', owns: st.flies ? ['wingN', 'wingF'] : [],
        ...stanceMotion(k, 'sit', sitS, (p) => merge(tail(k, 10 * wave(p, 2)), head(k, -4 + 3 * wave(p, 2)), wingPose(k, st.flies ? 18 + 6 * wave(p, 2) : 0)), (p, leg) => (leg === paw ? { below: k.L * 0.45, dx: k.L * (0.55 + 0.12 * wave(p, 2)), angle: -60 + 25 * wave(p, 2, 0.1) } : undefined)),
        expr: preset('happy'),
      }
    }
    if (m.plan === 'aquatic') {
      return { energy: 0.4, cycles: 2, base: 'pose', bones: (p) => merge(tail(k, 28 * wave(p, 2)), { hips: { rot: -8 + 3 * wave(p, 2) } }, head(k, 3 * wave(p, 2))), expr: preset('happy') }
    }
    if (m.plan === 'serpent') {
      return { energy: 0.4, cycles: 2, base: 'pose', ...stanceMotion(k, 'sit', () => 1, (p) => head(k, 8 * wave(p, 2))), expr: preset('happy') }
    }
    return {
      energy: 0.4, cycles: 2, base: 'pose', owns: st.flies ? ['wingN'] : [],
      bones: (p) => merge(waveLimb(k, st, p, 1), bounce(k, st, p, 1, 0.02), head(k, 3 * wave(p, 2)), tail(k, 10 * wave(p, 2))),
      post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
      expr: preset('happy'),
    }
  },
  cheer: (k, st) => {
    const m = k.m
    return {
      energy: 0.8, cycles: 2, base: 'pose', owns: st.flies ? ['wingN', 'wingF'] : [], events: [{ t: 0.3, name: 'land' }, { t: 0.8, name: 'land' }],
      bones: (p) => merge(
        bounce(k, st, p, 2, m.plan === 'serpent' ? 0 : 0.18),
        wingPose(k, st.flies ? 30 + 30 * wingStroke(p * 2) : 0),
        tail(k, 20 * wave(p, 4)),
        arm(k, 'L', 150 + 15 * wave(p, 2), 0),
        arm(k, 'R', 150 + 15 * wave(p, 2), 0),
        head(k, -6),
        m.plan === 'cephalopod' ? Object.fromEntries(k.legs.map((l, i) => [l.upper, { rot: (l.at - 0.5) * -80 + 10 * wave(p, 2, i * 0.1) }])) : {},
        m.plan === 'serpent' ? stance(k, 'sit', 0.8 + 0.2 * Math.abs(wave(p, 2))).pose : {},
      ),
      post: (p, pose) => k.place(pose, bounceFeet(k, p, 2)),
      expr: preset('excited'),
    }
  },
  dance: (k, st) => {
    const m = k.m
    return {
      energy: 0.8, cycles: 4, base: 'pose',
      bones: (p) => merge(
        k.profile ? bodyPose(k, -k.L * 0.05 * Math.abs(wave(p, 4)), 6 * wave(p, 2), 0.5) : { body: { rot: 10 * wave(p, 2), y: -m.bodyR * 0.08 * Math.abs(wave(p, 4)), sx: 1 + 0.04 * wave(p, 4), sy: 1 - 0.04 * wave(p, 4) } },
        head(k, 8 * wave(p, 2, 0.25)),
        tail(k, 16 * wave(p, 2)),
        wingPose(k, st.flies ? 12 * wave(p, 2) : 0),
        arm(k, 'L', 90 + 50 * wave(p, 2), 40),
        arm(k, 'R', 90 - 50 * wave(p, 2), 40),
        m.plan === 'cephalopod' ? Object.fromEntries(k.legs.map((l, i) => [l.upper, { rot: 18 * wave(p, 2, i / k.legs.length) }])) : {},
        m.plan === 'serpent' || m.plan === 'aquatic' ? slitherGait(k, { ...stNeutral }, 2).bones(p) : {},
      ),
      post: (p, pose) => k.place(pose, (leg) => ({ h: k.L * 0.08 * Math.max(0, wave(p, 2, leg.near ? 0 : 0.5)), dx: k.L * 0.05 * wave(p, 2, leg.near ? 0 : 0.5) })),
      expr: preset('grin'),
    }
  },
  'dance-hop': (k, st) => ({
    energy: 0.9, cycles: 2, base: 'pose', events: [{ t: 0, name: 'beat' }, { t: 0.5, name: 'beat' }],
    bones: (p) => {
      // Rock from one side to the other over the loop, hopping on each beat.
      const side = wave(p, 1, 0.25)
      return merge(bounce(k, st, p, 2, 0.14), k.profile ? { hips: { rot: 6 * side } } : { body: { rot: 10 * side } }, tail(k, 22 * wave(p, 2)), wingPose(k, st.flies ? 20 * wave(p, 4) : 0), arm(k, 'L', 95 + 55 * side, 10), arm(k, 'R', 95 - 55 * side, 10), head(k, 6 * wave(p, 2)))
    },
    post: (p, pose) => k.place(pose, bounceFeet(k, p, 2)),
    expr: preset('excited'),
  }),
  'dance-sway': (k, st) => ({
    energy: 0.5, cycles: 1, base: 'pose',
    bones: (p) => merge(k.profile ? bodyPose(k, k.L * 0.04 * (1 - Math.abs(wave(p, 1))), 5 * wave(p, 1), 0.3) : { body: { rot: 12 * wave(p, 1), x: k.m.bodyR * 0.08 * wave(p, 1) } }, head(k, 10 * wave(p, 1, 0.1)), tail(k, 18 * wave(p, 1, 0.2)), wingPose(k, st.flies ? 25 + 10 * wave(p, 1) : 0), arm(k, 'L', 140 + 15 * wave(p, 1), -20), arm(k, 'R', 140 - 15 * wave(p, 1), -20)),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: (p) => ({ ...expressionState('happy', 1), eyeL: 'happy', eyeR: 'happy', headTilt: 3 * wave(p, 1) }),
  }),
  clap: (k, st) => {
    const m = k.m
    const shut = (p: number) => 0.5 + 0.5 * Math.cos(2 * Math.PI * p)
    if (st.flies) return { energy: 0.4, cycles: 1, base: 'pose', owns: ['wingN', 'wingF'], events: [{ t: 0.5, name: 'clap' }], bones: (p) => merge(wingPose(k, 10 + 40 * shut(p)), head(k, -3)), post: (_p, pose) => k.place(pose, () => ({ h: 0 })), expr: preset('happy') }
    if (!k.profile && st.arms !== 'none') return { energy: 0.4, cycles: 1, base: 'pose', events: [{ t: 0.5, name: 'clap' }], bones: (p) => merge(arm(k, 'L', 80 - 50 * (1 - shut(p)), 70), arm(k, 'R', 80 - 50 * (1 - shut(p)), 70)), expr: preset('happy') }
    if (k.profile && k.fore.length && m.plan !== 'avian') {
      // Seal clap from a sit: the front paws tap together in front of the chest.
      return {
        energy: 0.4, cycles: 1, base: 'pose', events: [{ t: 0.5, name: 'clap' }],
        ...stanceMotion(k, 'sit', () => 1, (p) => tail(k, 8 * wave(p, 1)), (p, leg) => (leg.at > 0.5 ? { below: k.L * 0.5, dx: k.L * (0.5 + (leg.near ? 0.1 : -0.02) * shut(p)), angle: -50 } : undefined)),
        expr: preset('happy'),
      }
    }
    return { energy: 0.4, cycles: 2, base: 'pose', bones: (p) => merge(bounce(k, st, p, 2, 0.05), tail(k, 12 * wave(p, 2))), post: (p, pose) => k.place(pose, bounceFeet(k, p, 2)), expr: preset('happy') }
  },
  nod: (k) => ({
    energy: 0.2, cycles: 2, base: 'pose',
    bones: (p): Pose => (k.faceOnBody ? { body: { sy: 1 - 0.05 * Math.max(0, wave(p, 2)), sx: 1 + 0.02 * Math.max(0, wave(p, 2)), y: k.m.bodyR * 0.05 * Math.max(0, wave(p, 2)) } } : head(k, 12 * Math.max(0, wave(p, 2)))),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: (p, base) => ({ ...preset('happy')(p, base), lookY: 0.3 * Math.max(0, wave(p, 2)) }),
  }),
  'shake-head': (k) => ({
    energy: 0.2, cycles: 2, base: 'pose',
    bones: (p): Pose => (k.faceOnBody ? { body: { rot: 6 * wave(p, 2), x: k.m.bodyR * 0.04 * wave(p, 2) } } : { head: { rot: 8 * wave(p, 2), x: 4 * wave(p, 2) } }),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: (p) => ({ ...expressionState('pout', 0.7), lookX: -wave(p, 2) * 0.6 }),
  }),
  laugh: (k) => ({
    energy: 0.5, cycles: 4, base: 'pose',
    bones: (p) => merge(head(k, -8 + 4 * wave(p, 4)), k.profile ? { [k.body]: { sy: 1 + 0.02 * Math.abs(wave(p, 4)) }, hips: { rot: -2 } } : { body: { sy: 1 + 0.05 * Math.abs(wave(p, 4)), sx: 1 - 0.02 * Math.abs(wave(p, 4)), y: -k.m.bodyR * 0.05 * Math.abs(wave(p, 4)) } }, tail(k, 10 * wave(p, 4)), arm(k, 'L', 30, 40), arm(k, 'R', 30, 40)),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: preset('laugh', 1),
  }),
  cry: (k) => ({
    energy: 0.2, cycles: 4, base: 'pose',
    bones: (p) => merge(head(k, 12, 2 * wave(p, 4)), tail(k, -18), k.profile ? bodyPose(k, k.L * 0.08, 0, 0) : { body: { sy: 1 - 0.03 * Math.abs(wave(p, 4)), y: k.m.bodyR * 0.03 } }, arm(k, 'L', 40, 90), arm(k, 'R', 40, 90)),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: preset('cry', 1),
  }),
  angry: (k, st) => {
    const paw = k.fore.find((l) => l.near) ?? k.legs[0]
    const lift = (p: number) => keys(p, [[0, 0], [0.15, 1], [0.3, 0], [0.5, 0], [0.65, 1], [0.8, 0], [1, 0]])
    return {
      energy: 0.6, cycles: 2, base: 'pose', events: [{ t: 0.3, name: 'stomp' }, { t: 0.8, name: 'stomp' }],
      bones: (p) => merge(head(k, 6 + 3 * wave(p, 6)), { head: { x: 2 * wave(p, 6) } }, tail(k, 20 * wave(p, 4)), k.profile ? bodyPose(k, k.L * 0.06, 3, 0.5) : { body: { sx: 1.04 + 0.03 * wave(p, 6), sy: 0.97, rot: 2 * wave(p, 6) } }, arm(k, 'L', 40, 60), arm(k, 'R', 40, 60), wingPose(k, st.flies ? 20 : 0)),
      post: (p, pose) => k.place(pose, (leg) => (leg === paw ? { h: k.L * 0.2 * lift(p), dx: k.L * 0.08 * lift(p) } : { h: 0 })),
      expr: preset('furious', 1),
    }
  },
  love: (k, st) => ({
    energy: 0.3, cycles: 2, base: 'pose',
    bones: (p) => merge(head(k, 6 * wave(p)), tail(k, 12 * wave(p, 2)), wingPose(k, st.flies ? 15 * wave(p, 1) : 0), k.profile ? { hips: { rot: 2 * wave(p, 1) } } : { body: { rot: 6 * wave(p, 1) } }, arm(k, 'L', 110, 90), arm(k, 'R', 110, 90)),
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: preset('love', 1),
  }),
  surprise: (k, st) => ({
    energy: 0.8, cycles: 1, base: 'pose',
    bones: (p) => {
      const j = pulse(p, 0.2, 0.15)
      const k2 = keys(p, [[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]])
      return merge(bounce(k, st, clamp(p / 0.4, 0, 0.6), 1, 0.25 * (p < 0.4 ? 1 : 0)), tail(k, 30 * k2), wingPose(k, st.flies ? 45 * k2 : 0), head(k, -8 * k2), arm(k, 'L', 70 * k2, -20), arm(k, 'R', 70 * k2, -20), { [k.body]: { sy: 1 + 0.06 * j } })
    },
    post: (p, pose) => k.place(pose, bounceFeet(k, clamp(p / 0.4, 0, 0.6), 1)),
    expr: (p, base) => (p > 0.08 && p < 0.9 ? expressionState('shocked', 1) : base),
  }),
  bow: (k, st) => {
    const s = (p: number) => keys(p, [[0, 0], [0.3, 1], [0.62, 1], [0.92, 0], [1, 0]])
    const m = k.m
    if (k.profile && (m.plan === 'quadruped' || m.plan === 'insectoid' || m.plan === 'avian')) {
      return { energy: 0.3, cycles: 1, base: 'pose', ...stanceMotion(k, 'bow', s, (p) => merge(tail(k, 10 * s(p)), wingPose(k, st.flies ? 30 * s(p) : 0), head(k, 12 * s(p)))), expr: (p, base) => (s(p) > 0.4 ? { ...expressionState('happy', 0.8), eyeL: 'happy', eyeR: 'happy' } : base) }
    }
    return {
      energy: 0.3, cycles: 1, base: 'pose',
      bones: (p) => merge(k.profile ? (m.plan === 'serpent' ? stance(k, 'sit', 0.6 * s(p)).pose : bodyPose(k, 0, 14 * s(p), 0.2)) : { body: { rot: 0, sy: 1 - 0.08 * s(p), y: m.bodyR * 0.08 * s(p) } }, head(k, (m.plan === 'serpent' ? 40 : 22) * s(p)), arm(k, 'R', 30 * s(p), 90 * s(p))),
      post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
      expr: (p, base) => (s(p) > 0.4 ? { ...expressionState('happy', 0.8), eyeL: 'happy', eyeR: 'happy' } : base),
    }
  },
  victory: (k, st) => {
    const m = k.m
    if (k.profile && m.plan === 'quadruped' && !st.flies && k.fore.length) {
      // Rear up on the hind legs and paw the air.
      return {
        energy: 0.8, cycles: 2, base: 'pose',
        ...stanceMotion(k, 'rear', (p) => 0.75 + 0.25 * Math.abs(wave(p, 2)), (p) => merge(tail(k, 20 * wave(p, 4)), head(k, -8)), (p, leg) => (leg.at > 0.5 ? { below: k.L * (0.5 + 0.1 * wave(p, 2, leg.near ? 0 : 0.5)), dx: k.L * (0.3 + 0.15 * wave(p, 2, leg.near ? 0 : 0.5)), angle: -40 } : undefined)),
        expr: preset('excited', 1),
      }
    }
    return {
      energy: 0.8, cycles: 2, base: 'pose', owns: st.flies ? ['wingN', 'wingF'] : [],
      bones: (p) => merge(bounce(k, st, p, 2, m.plan === 'serpent' ? 0 : 0.16), wingPose(k, st.flies ? 45 + 15 * wave(p, 2) : 0), tail(k, 25 * wave(p, 4)), arm(k, 'R', 160 + 10 * Math.max(0, wave(p, 2)), 0), arm(k, 'L', 60, 60), head(k, -8), m.plan === 'serpent' ? stance(k, 'sit', 1).pose : {}, m.plan === 'cephalopod' ? Object.fromEntries(k.legs.map((l, i) => [l.upper, { rot: (l.at - 0.5) * -90 + 12 * wave(p, 2, i * 0.1) }])) : {}),
      post: (p, pose) => k.place(pose, bounceFeet(k, p, 2)),
      expr: preset('excited', 1),
    }
  },
  defeat: (k, st) => ({
    energy: 0.1, cycles: 1, base: 'pose', blinkAt: 0.3 + st.u('defeat') * 0.2,
    bones: (p) => {
      const sigh = keys(p, [[0, 0], [0.45, 0], [0.62, 1], [0.8, 0], [1, 0]])
      const m = k.m
      return merge(
        k.profile ? (m.plan === 'serpent' || m.plan === 'aquatic' ? {} : stance(k, 'low', 1).pose) : { body: { sy: 0.9 + 0.04 * sigh, sx: 1.06 - 0.02 * sigh, y: m.bodyR * 0.08 * (1 - sigh), rot: 3 } },
        head(k, 20 - 6 * sigh, m.bodyR * 0.02 * (1 - sigh)),
        tail(k, -22),
        wingPose(k, st.flies ? -18 : 0),
        arm(k, 'L', 4, 4),
        arm(k, 'R', 4, 4),
        m.plan === 'cephalopod' ? Object.fromEntries(k.legs.map((l) => [l.upper, { rot: (l.at - 0.5) * 30, sy: 0.9 }])) : {},
      )
    },
    post: (_p, pose) => k.place(pose, stance(k, 'low', 1).feet),
    expr: () => ({ ...expressionState('sad', 1), lookY: 0.5 }),
  }),
  attack: (k, st) => {
    const m = k.m
    const lunge = (p: number) => keys(p, [[0, 0], [0.3, -0.4], [0.45, 1], [0.7, 0.6], [1, 0]])
    const paw = k.fore.find((l) => l.near)
    return {
      energy: 1, cycles: 1, base: 'pose', events: [{ t: 0.45, name: 'hit' }],
      bones: (p) => {
        const l = lunge(p)
        return merge(
          { root: { x: m.bodyR * 0.3 * l } },
          head(k, -12 * l),
          { jaw: { rot: 20 * Math.max(0, l) } },
          k.profile ? bodyPose(k, k.L * 0.1 * Math.max(0, -l), 6 * l, 0.3) : { body: { rot: 8 * l } },
          tail(k, 25 * l),
          wingPose(k, st.flies ? 40 * Math.max(0, -l) - 20 * Math.max(0, l) : 0),
          arm(k, 'R', 100 * Math.max(0, l) + 60 * Math.max(0, -l), 20 * l),
        )
      },
      post: (p, pose) => k.place(pose, (leg) => (leg === paw ? { h: k.L * 0.3 * Math.max(0, lunge(p)), dx: k.L * 0.45 * Math.max(0, lunge(p)), angle: -30 * Math.max(0, lunge(p)) } : { h: 0 })),
      expr: (p, base) => (p > 0.2 && p < 0.8 ? { ...expressionState('furious', 1), open: 0.8, mouth: 'grimace' } : base),
    }
  },
  hurt: (k) => ({
    energy: 0.8, cycles: 1, base: 'pose',
    bones: (p) => {
      const kk = keys(p, [[0, 0], [0.15, 1], [0.6, 0.6], [1, 0]])
      return merge({ root: { x: -k.m.bodyR * 0.25 * kk } }, head(k, -12 * kk), tail(k, 25 * kk), k.profile ? bodyPose(k, k.L * 0.05 * kk, -6 * kk, 0.3) : { body: { rot: -8 * kk, sx: 1 - 0.06 * kk, sy: 1 + 0.06 * kk } }, arm(k, 'L', 50 * kk, 20), arm(k, 'R', 50 * kk, 20))
    },
    post: (_p, pose) => k.place(pose, () => ({ h: 0 })),
    expr: (p, base) => (p < 0.8 ? { ...expressionState('scared', 1), eyeL: 'closed', eyeR: 'closed' } : base),
  }),
  ko: () => ({
    energy: 1, cycles: 1, base: 'pose',
    events: [{ t: 0.55, name: 'thud' }],
    bones: (p) => ({ root: { rot: keys(p, [[0, 0], [0.15, -8], [0.55, 90], [0.65, 84], [0.75, 90], [1, 90]]) } }),
    expr: () => expressionState('dizzy', 1),
  }),
  sit: (k, st) => {
    const m = k.m
    const extra = (p: number) => merge(breathe(k, p, 1, st.u('sit')), head(k, 2 * wave(p, 1, 0.2)), tail(k, 4 * wave(p, 1, 0.4)))
    if (m.plan === 'aquatic') return { energy: 0.1, cycles: 1, base: 'pose', bones: (p) => merge(swimGait(k, st, 1).bones(p), { hips: { y: m.bodyR * 0.1 } }) }
    if (st.gait === 'float' || st.gait === 'hover' || st.gait === 'pulse') return { energy: 0.1, cycles: 1, base: 'pose', bones: (p) => merge(stance(k, 'sit', 1).pose, extra(p), { [k.body]: { y: -m.bodyR * 0.05 * wave(p, 1) } }) }
    return { energy: 0.1, cycles: 1, base: 'pose', blinkAt: 0.4 + st.u('sitBlink') * 0.4, ...stanceMotion(k, 'sit', () => 1, extra) }
  },
  sleep: (k) => {
    const m = k.m
    const extra = (p: number) => merge(breathe(k, p, 2, 0), head(k, m.plan === 'avian' ? 0 : 6 + 2 * wave(p, 1)), tail(k, -4))
    const lie: Stance = m.plan === 'serpent' ? 'stand' : m.plan === 'avian' ? 'lie' : 'lie'
    return {
      energy: 0.05, cycles: 1, base: 'pose', blink: false,
      ...(m.plan === 'aquatic' ? { bones: (p: number) => merge(breathe(k, p, 1.5), { hips: { rot: 4, y: m.bodyR * 0.15 } }, tail(k, -8)) } : stanceMotion(k, lie, () => 1, extra)),
      expr: () => ({ ...expressionState('sleepy', 1), eyeL: 'closed', eyeR: 'closed' }),
    }
  },
}

/** A neutral style for helpers that only need a wave's shape. */
const stNeutral: CreatureStyle = {
  u: () => 0.5,
  pick: () => 0,
  plan: 'serpent',
  gait: 'slither',
  wings: 'none',
  flies: false,
  arms: 'none',
  legs: 0,
  heavy: 0,
  tiny: 0,
  jelly: false,
}

export const CREATURE_CLIP_NAMES = Object.keys(CLIPS)

/** Clips that already carry a floater through the air themselves. */
const SELF_AIRBORNE = new Set(['walk', 'run', 'idle', 'hover', 'fly', 'glide', 'fall', 'jump', 'jump-up', 'land', 'swim', 'hop', 'slither', 'ko'])

const floats = (st: CreatureStyle) => st.gait === 'float' || st.gait === 'hover' || st.gait === 'pulse'

/** How high a floater hovers. */
function floatLift(k: CKit): number {
  // A flying serpent needs height in proportion to its length to read as airborne.
  return k.m.plan === 'serpent' ? k.m.bodyR * 1.2 + (k.m.bodyLen + k.m.tailLen) * 0.16 : k.profile ? k.L * 0.5 + k.m.bodyR * 0.3 : k.m.bodyR * 0.35
}

/** Keeps a floater aloft through a clip made for grounded bodies: lifted, bobbing gently,
 *  any legs hanging instead of planted. */
function levitate(k: CKit, motion: ClipMotion, low = 1): ClipMotion {
  const lift = floatLift(k) * low
  const r = k.m.bodyR
  const liftPose = (p: number): Pose =>
    k.m.plan === 'serpent' ? { root: { y: -lift - r * 0.15 * wave(p, 1) } } : k.profile ? { hips: { y: -lift - r * 0.08 * wave(p, 1) } } : { body: { y: -lift - r * 0.08 * wave(p, 1) } }
  return {
    ...motion,
    bones: (p) => merge(motion.bones(p), liftPose(p)),
    post: (p, pose) => {
      if (k.m.plan === 'serpent') {
        // The serpent's own pass levels its head (and would put it back on the ground).
        const q = motion.post ? motion.post(p, pose) : pose
        return { ...q, root: { ...(q.root ?? {}), y: liftPose(p).root.y ?? 0 } }
      }
      return k.place(pose, () => ({ below: k.L * 0.9, angle: 20 }))
    },
  }
}

export function creatureMotion(rig: CreatureRig, st: CreatureStyle, info: ClipInfo): ClipMotion | undefined {
  const b = CLIPS[info.name]
  if (!b) return undefined
  const k = creatureKit(rig)
  const motion = b(k, st, info)
  if (floats(st) && !SELF_AIRBORNE.has(info.name)) return levitate(k, motion, info.name === 'sit' || info.name === 'sleep' ? 0.6 : 1)
  return motion
}

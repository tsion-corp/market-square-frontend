/* Creature skeletons, one layout per body plan.
 *
 * A creature is drawn in profile facing +x (its natural view) with a spine chain from
 * the hips to the neck, a head, a tail chain, and legs attached along the spine. The
 * spine is a chain of bones so serpents slither, fish swim and quadrupeds breathe with
 * the same animation code. Blob, octopus and robot plans face the camera. */

import { clamp, lerp } from '../core/math.ts'
import type { AvatarDNA, Params } from '../dna/types.ts'
import type { View } from '../render/types.ts'
import { Skeleton } from './skeleton.ts'

export type Plan = 'quadruped' | 'avian' | 'aquatic' | 'serpent' | 'insectoid' | 'blob' | 'cephalopod' | 'robot'

export const FRONT_FACING: readonly Plan[] = ['blob', 'cephalopod', 'robot']

export interface LegDef {
  /** Bone names: upper, lower, foot. */
  upper: string
  lower: string
  foot: string
  /** Near (true) or far side of the body in profile. */
  near: boolean
  /** Position along the body: 0 = hips end, 1 = shoulder end. */
  at: number
  /** Leg pair index from the front (for gait phase). */
  pair: number
}

export interface CreatureMeasure {
  plan: Plan
  /** Overall scale: every length below already includes it. */
  S: number
  bodyLen: number
  bodyR: number
  bellyR: number
  neckLen: number
  headR: number
  snout: number
  legLen: number
  legR: number
  tailLen: number
  tailR: number
  /** Ground clearance: y of the body's centre line above the ground (negative). */
  bodyY: number
  legs: number
  spineSegs: number
  tailSegs: number
  armLen: number
  frontFacing: boolean
  headSize: number
}

const n = (p: Params | undefined, k: string, d = 0.5): number => (p && typeof p[k] === 'number' ? (p[k] as number) : d)
const s = (p: Params | undefined, k: string, d: string): string => (p && typeof p[k] === 'string' ? (p[k] as string) : d)

const DEFAULT_LEGS: Record<Plan, number> = {
  quadruped: 4,
  avian: 2,
  aquatic: 0,
  serpent: 0,
  insectoid: 6,
  blob: 0,
  cephalopod: 8,
  robot: 2,
}

export function creatureMeasure(dna: AvatarDNA): CreatureMeasure {
  const sec = dna.sections
  const plan = s(sec.species, 'plan', 'quadruped') as Plan
  const size = n(sec.species, 'size')
  const stance = n(sec.species, 'stance')
  const form = sec.form
  const face = sec.face
  const limbs = sec.limbs
  const tail = sec.tail
  // Creatures are drawn on the same world scale as humanoids (~750 units tall at the top end).
  const S = lerp(0.55, 1.35, size)
  const legSetting = s(limbs, 'legs', 'auto')
  const legs = legSetting === 'auto' ? DEFAULT_LEGS[plan] : Number(legSetting)
  const girth = n(form, 'girth')
  const length = n(form, 'length')

  const base: Record<Plan, { len: number; r: number; leg: number; head: number; tail: number }> = {
    quadruped: { len: 300, r: 88, leg: 150, head: 92, tail: 210 },
    avian: { len: 150, r: 105, leg: 120, head: 78, tail: 120 },
    aquatic: { len: 300, r: 115, leg: 0, head: 100, tail: 120 },
    serpent: { len: 520, r: 50, leg: 70, head: 70, tail: 260 },
    insectoid: { len: 230, r: 80, leg: 130, head: 70, tail: 60 },
    blob: { len: 0, r: 170, leg: 0, head: 0, tail: 0 },
    cephalopod: { len: 0, r: 150, leg: 190, head: 0, tail: 0 },
    robot: { len: 0, r: 150, leg: 150, head: 105, tail: 0 },
  }
  const b = base[plan]
  const bodyLen = b.len * lerp(0.65, 1.45, length) * S
  const bodyR = b.r * lerp(0.7, 1.35, girth) * S
  const legLen = b.leg * lerp(0.55, 1.5, n(limbs, 'length')) * lerp(0.7, 1.35, stance) * S
  const headR = b.head * lerp(0.75, 1.3, n(face, 'headSize')) * S
  const frontFacing = FRONT_FACING.includes(plan)
  // Cephalopods stand on their arms: the body rides high enough for the arm tips (drawn
  // `legLen × 0.7–1.3` long below the mantle) to rest on the ground, not sink into it.
  const armReach = legLen * lerp(0.7, 1.3, n(limbs, 'length')) * (n(limbs, 'thickness') < 0.35 ? 1.02 : 0.86)
  const bodyY =
    plan === 'aquatic' || plan === 'serpent'
      ? -bodyR * 1.2
      : plan === 'cephalopod'
        ? -(bodyR * 0.55 + armReach)
        : frontFacing
          ? -(plan === 'robot' ? legLen + bodyR : bodyR)
          : -(legLen + bodyR * 0.55)
  return {
    plan,
    S,
    bodyLen,
    bodyR,
    bellyR: bodyR * lerp(0.9, 1.2, n(form, 'belly', 0.4)),
    neckLen: (plan === 'serpent' ? 60 : 110) * lerp(0.3, 1.6, n(form, 'neck', 0.4)) * S,
    headR,
    snout: headR * lerp(0.05, 1.25, n(face, 'snout', 0.45)),
    legLen: legs > 0 ? legLen : 0,
    legR: bodyR * lerp(0.16, 0.34, n(limbs, 'thickness')) * (plan === 'insectoid' || plan === 'cephalopod' ? 0.6 : 1),
    tailLen: b.tail * lerp(0.35, 1.6, n(tail, 'length')) * S,
    tailR: bodyR * lerp(0.1, 0.42, n(tail, 'thickness')),
    bodyY: clamp(bodyY, -900, -10),
    legs,
    spineSegs: plan === 'serpent' ? 7 : 3,
    tailSegs: plan === 'serpent' ? 4 : 3,
    armLen: (plan === 'robot' ? 170 : 120) * S,
    frontFacing,
    headSize: n(face, 'headSize'),
  }
}

export interface CreatureRig {
  skel: Skeleton
  m: CreatureMeasure
  view: View
  legs: LegDef[]
  /** Spine bones from hips to shoulders. */
  spine: string[]
  tail: string[]
}

export function creatureRig(dna: AvatarDNA, view: View): CreatureRig {
  const m = creatureMeasure(dna)
  const sk = new Skeleton()
  const legs: LegDef[] = []
  const spine: string[] = []
  const tail: string[] = []
  sk.add('root', null, 0, 0)

  if (m.frontFacing) {
    // Upright, symmetric: body centre above the ground, head on top (robot) or the body is the head.
    sk.add('body', 'root', 0, m.bodyY, m.bodyR * 2)
    spine.push('body')
    const headY = m.plan === 'robot' ? -m.bodyR * 0.95 - m.headR * 0.85 : 0
    sk.add('head', 'body', 0, headY, m.headR)
    sk.add('back', 'body', 0, -m.bodyR * 0.2)
    sk.add('wingF', 'back', -m.bodyR * 0.3, 0, m.bodyR)
    sk.add('wingN', 'back', m.bodyR * 0.3, 0, m.bodyR)
    if (m.plan === 'cephalopod') {
      const count = Math.max(2, m.legs || 8)
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1)
        const x = lerp(-m.bodyR * 0.75, m.bodyR * 0.75, t)
        const name = `tent${i}`
        sk.add(`${name}a`, 'body', x, m.bodyR * 0.55, m.legLen * 0.5)
        sk.add(`${name}b`, `${name}a`, 0, m.legLen * 0.5, m.legLen * 0.5)
        sk.add(`${name}c`, `${name}b`, 0, m.legLen * 0.5, m.legLen * 0.3)
        legs.push({ upper: `${name}a`, lower: `${name}b`, foot: `${name}c`, near: i % 2 === 0, at: t, pair: i })
      }
    } else if (m.legs > 0) {
      for (const [i, side] of (['L', 'R'] as const).entries()) {
        const x = (side === 'L' ? 1 : -1) * m.bodyR * 0.45
        sk.add(`leg${side}a`, 'body', x, m.bodyR * 0.8, m.legLen * 0.5)
        sk.add(`leg${side}b`, `leg${side}a`, 0, m.legLen * 0.5, m.legLen * 0.5)
        sk.add(`foot${side}`, `leg${side}b`, 0, m.legLen * 0.5, m.legR * 2)
        legs.push({ upper: `leg${side}a`, lower: `leg${side}b`, foot: `foot${side}`, near: side === 'R', at: 0.5, pair: i })
      }
    }
    for (const side of ['L', 'R'] as const) {
      const x = (side === 'L' ? 1 : -1) * m.bodyR * (m.plan === 'robot' ? 1.02 : 0.88)
      sk.add(`arm${side}a`, 'body', x, m.plan === 'robot' ? -m.bodyR * 0.55 : 0, m.armLen * 0.5)
      sk.add(`arm${side}b`, `arm${side}a`, 0, m.armLen * 0.5, m.armLen * 0.5)
    }
    sk.anchor('headTop', 'head', 0, m.plan === 'robot' ? -m.headR * 0.95 : -m.bodyR * 1.05)
    sk.anchor('eyes', 'head', 0, m.plan === 'robot' ? -m.headR * 0.1 : -m.bodyR * 0.3)
    sk.anchor('face', 'head', 0, m.plan === 'robot' ? 0 : -m.bodyR * 0.1)
    sk.anchor('neck', 'body', 0, m.plan === 'robot' ? -m.bodyR * 0.95 : m.bodyR * 0.05)
    sk.anchor('chest', 'body', 0, 0)
    sk.anchor('back', 'back', 0, 0)
    sk.anchor('waist', 'body', 0, m.bodyR * 0.4)
    sk.anchor('feet', 'root', 0, 0)
    return { skel: sk, m, view, legs, spine, tail }
  }

  // Profile plans. Hips at the rear of the body, spine chain toward the shoulders (+x).
  const segs = m.spineSegs
  const segLen = m.bodyLen / segs
  sk.add('hips', 'root', -m.bodyLen / 2, m.bodyY, segLen)
  spine.push('hips')
  let prev = 'hips'
  // Serpents rest in a gentle S (snails lie straight); everything else is straight. The S
  // is written as the absolute angle of each segment, so the chain stays level: a relative
  // S accumulates and tipped the head under the ground.
  const wiggle = m.plan === 'serpent' && s(dna.sections.extras, 'shell', 'none') !== 'snail'
  const sAbs = (i: number) => (wiggle ? Math.sin((i / segs) * Math.PI * 2) * 11 : 0)
  for (let i = 1; i <= segs; i++) {
    const name = i === segs ? 'chest' : `spine${i}`
    const rest = sAbs(i) - sAbs(i - 1)
    sk.add(name, prev, segLen, 0, segLen, rest)
    spine.push(name)
    prev = name
  }
  const neckRise = m.plan === 'aquatic' || m.plan === 'serpent' ? 0 : m.plan === 'avian' ? -m.bodyR * 0.6 : -m.bodyR * 0.45
  sk.add('neck', 'chest', m.plan === 'avian' ? -segLen * 0.2 : m.bodyR * 0.1, neckRise * 0.5, m.neckLen)
  const headX = m.plan === 'aquatic' ? m.bodyR * 0.2 : m.plan === 'avian' ? m.neckLen * 0.25 : m.neckLen * 0.7
  const headY = m.plan === 'aquatic' || m.plan === 'serpent' ? 0 : -m.neckLen * (m.plan === 'avian' ? 1 : 0.75) + neckRise * 0.5
  sk.add('head', 'neck', headX, headY, m.headR)
  sk.add('jaw', 'head', m.snout * 0.3, m.headR * 0.25, m.snout)
  sk.add('back', 'chest', -segLen * 0.5, -m.bodyR * 0.8)
  sk.add('wingF', 'back', -m.bodyR * 0.1, 0, m.bodyLen * 0.5)
  sk.add('wingN', 'back', m.bodyR * 0.05, m.bodyR * 0.05, m.bodyLen * 0.5)

  // Tail chain from the hips backward.
  let tprev = 'hips'
  const tl = m.tailLen / m.tailSegs
  for (let i = 0; i < m.tailSegs; i++) {
    const name = `tail${i}`
    sk.add(name, tprev, i === 0 ? -m.bodyR * (m.plan === 'avian' ? 0.6 : 0.75) : -tl, i === 0 ? -m.bodyR * 0.15 : 0, tl)
    tail.push(name)
    tprev = name
  }

  // Legs, placed along the body in pairs from the back.
  const pairs = Math.floor(m.legs / 2)
  for (let p = 0; p < pairs; p++) {
    const at = pairs === 1 ? (m.plan === 'avian' ? 0.45 : 0.5) : p / (pairs - 1)
    const bone = at < 0.34 ? 'hips' : at > 0.8 ? 'chest' : spine[Math.min(spine.length - 1, Math.round(at * (spine.length - 1)))]
    const idx = spine.indexOf(bone)
    const boneX = idx <= 0 ? 0 : 0
    const along = -m.bodyLen / 2 + at * m.bodyLen
    const offset = along - (-m.bodyLen / 2 + idx * segLen)
    for (const near of [false, true]) {
      const tag = `${p}${near ? 'n' : 'f'}`
      const x = boneX + offset + (near ? m.legR * 0.2 : -m.legR * 0.3)
      // Legs reach exactly to the ground from where they attach, leaving room for the foot.
      const attachY = m.plan === 'avian' ? m.bodyR * 0.55 : m.bodyR * 0.3
      const reach = Math.max(8, -(m.bodyY + attachY) - m.legR * 0.9)
      // Bugs splay their legs: back pairs lean back, front pairs forward, knees bent so the
      // feet still land on the ground.
      const splay = m.plan === 'insectoid' ? (pairs === 1 ? 0 : lerp(38, -38, at)) : 0
      const a = (splay * Math.PI) / 180
      const k = m.plan === 'insectoid' ? 1 / (0.45 * Math.cos(a) + 0.55 * Math.cos(a * 0.2)) : 1
      const upperLen = reach * (m.plan === 'insectoid' ? 0.45 : 0.52) * k
      const lowerLen = (reach * k) - upperLen
      sk.add(`leg${tag}a`, bone, x, attachY, upperLen, splay)
      sk.add(`leg${tag}b`, `leg${tag}a`, 0, upperLen, lowerLen, -splay * 1.2)
      sk.add(`foot${tag}`, `leg${tag}b`, 0, lowerLen, m.legR * 2)
      legs.push({ upper: `leg${tag}a`, lower: `leg${tag}b`, foot: `foot${tag}`, near, at, pair: p })
    }
  }

  const skullTop = -m.headR * 0.95
  sk.anchor('headTop', 'head', m.snout * 0.05, skullTop)
  sk.anchor('eyes', 'head', m.headR * 0.35, -m.headR * 0.2)
  sk.anchor('face', 'head', m.headR * 0.5, 0)
  sk.anchor('neck', 'neck', m.neckLen * 0.3, 0)
  sk.anchor('chest', 'chest', m.bodyR * 0.3, 0)
  sk.anchor('back', 'back', 0, 0)
  sk.anchor('waist', 'hips', 0, 0)
  sk.anchor('feet', 'root', 0, 0)
  return { skel: sk, m, view, legs, spine, tail }
}

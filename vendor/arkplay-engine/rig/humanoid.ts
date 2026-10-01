/* Humanoid proportions and skeleton.
 *
 * Body sliders become measurements (in world units, ground at y = 0, up is -y), and the
 * measurements become bones. Every garment and accessory is then drawn from these same
 * measurements, which is why clothes fit any body and a hat fits any head. */

import { clamp, clamp01, lerp } from '../core/math.ts'
import type { AvatarDNA, Params } from '../dna/types.ts'
import type { Side, View } from '../render/types.ts'
import { Skeleton } from './skeleton.ts'

export interface HumanMeasure {
  H: number
  headsTall: number
  headH: number
  /** Half the face width. */
  hw: number
  neckLen: number
  neckR: number
  torsoLen: number
  pelvisH: number
  shoulderHalf: number
  chestHalf: number
  waistHalf: number
  hipHalf: number
  chestDepth: number
  bellyDepth: number
  buttDepth: number
  upperArm: number
  forearm: number
  handLen: number
  armR: number
  elbowR: number
  wristR: number
  thigh: number
  shin: number
  footH: number
  footLen: number
  thighR: number
  kneeR: number
  ankleR: number
  hipJointX: number
  legLen: number
  bust: number
  belly: number
  muscle: number
  build: number
  /** How far hair rises above the skull (hats sit on it). */
  hairLift: number
  /** Eye line and mouth line in head-local y. */
  eyeY: number
  mouthY: number
  noseY: number
  earY: number
}

/** Face-shape presets: width factor of the whole head. */
export const FACE_WIDTH: Record<string, number> = {
  oval: 1,
  round: 1.06,
  square: 1.04,
  heart: 1.0,
  long: 0.9,
  diamond: 0.98,
  pear: 1.02,
  soft: 1.03,
}

const n = (p: Params, k: string, d = 0.5): number => (typeof p[k] === 'number' ? (p[k] as number) : d)

/** Rough hair volume per style, so hats and head crops know how big the hair is. */
export function hairLiftFor(style: string, volume: number, curl: number): number {
  const base: Record<string, number> = {
    bald: 0,
    buzz: 0.01,
    crew: 0.04,
    'short-messy': 0.08,
    spiky: 0.2,
    'side-part': 0.07,
    quiff: 0.16,
    pompadour: 0.22,
    slick: 0.04,
    mohawk: 0.3,
    undercut: 0.1,
    bowl: 0.06,
    'curly-top': 0.16,
    afro: 0.34,
    'afro-puffs': 0.22,
    twists: 0.18,
    cornrows: 0.02,
    locs: 0.1,
    'box-braids': 0.08,
    bun: 0.24,
    'space-buns': 0.18,
    'man-bun': 0.16,
    'high-pony': 0.12,
  }
  return (base[style] ?? 0.08) * (0.6 + volume * 0.8) * (1 + curl * 0.3)
}

export function humanMeasure(dna: AvatarDNA): HumanMeasure {
  const b = dna.sections.body ?? {}
  const h = dna.sections.head ?? {}
  const eyes = dna.sections.eyes ?? {}
  const nose = dna.sections.nose ?? {}
  const mouth = dna.sections.mouth ?? {}
  const hair = dna.sections.hair ?? {}
  const build = n(b, 'build', 0.35)
  const muscle = n(b, 'muscle', 0.2)
  const headRatio = n(b, 'headRatio')

  const H = lerp(620, 900, n(b, 'height'))
  const headsTall = lerp(6.0, 2.7, headRatio)
  const headH = H / headsTall
  const shape = typeof h.shape === 'string' ? h.shape : 'oval'
  const hw = headH * 0.42 * lerp(0.86, 1.14, n(h, 'width')) * (FACE_WIDTH[shape] ?? 1)
  const neckLen = headH * lerp(0.1, 0.34, n(b, 'neck', 0.45)) * lerp(1.05, 0.55, headRatio)
  const neckR = hw * lerp(0.34, 0.5, clamp01(build * 0.6 + muscle * 0.4))

  const B = H - neckLen - headH * 0.92
  const legFrac = clamp(lerp(0.44, 0.56, n(b, 'legs')) - (headRatio - 0.5) * 0.1, 0.36, 0.62)
  const legLen = B * legFrac
  const torsoLen = B - legLen

  const shoulderHalf =
    (H * 0.085 + headH * 0.12) * lerp(0.82, 1.2, n(b, 'shoulders')) * lerp(0.95, 1.12, muscle) * lerp(0.96, 1.08, build)
  const chestHalf = shoulderHalf * lerp(0.8, 0.96, build)
  const waistHalf = shoulderHalf * lerp(0.56, 0.98, clamp01(n(b, 'waist', 0.45) * 0.6 + build * 0.55 + n(b, 'belly', 0.1) * 0.35 - 0.2))
  const hipHalf = shoulderHalf * lerp(0.66, 1.05, clamp01(n(b, 'hips', 0.45) * 0.7 + build * 0.45 - 0.1))
  const bust = n(b, 'chest', 0.25)
  const belly = n(b, 'belly', 0.1)

  const armLen = torsoLen * lerp(1.02, 1.28, n(b, 'arms')) + headH * 0.08
  const armR = shoulderHalf * lerp(0.17, 0.28, clamp01(build * 0.55 + muscle * 0.55))
  const footH = legLen * 0.05
  const thighR = hipHalf * lerp(0.42, 0.6, clamp01(build * 0.6 + muscle * 0.2 + n(b, 'hips', 0.45) * 0.2))

  const hairStyle = typeof hair.style === 'string' ? hair.style : 'short-messy'
  return {
    H,
    headsTall,
    headH,
    hw,
    neckLen,
    neckR,
    torsoLen,
    pelvisH: thighR * 0.9,
    shoulderHalf,
    chestHalf,
    waistHalf,
    hipHalf,
    chestDepth: shoulderHalf * lerp(0.55, 0.78, build) + bust * shoulderHalf * 0.32,
    bellyDepth: waistHalf * 0.85 + belly * shoulderHalf * 0.6,
    buttDepth: hipHalf * 0.8,
    upperArm: armLen * 0.44,
    forearm: armLen * 0.38,
    handLen: armLen * 0.2 * lerp(0.85, 1.2, n(b, 'hands')),
    armR,
    elbowR: armR * 0.8,
    wristR: armR * 0.6,
    thigh: (legLen - footH) * 0.5,
    shin: (legLen - footH) * 0.5,
    footH,
    footLen: legLen * 0.3 * lerp(0.85, 1.2, n(b, 'feet')),
    thighR,
    kneeR: thighR * 0.68,
    ankleR: thighR * 0.44,
    hipJointX: Math.max(thighR * 0.45, hipHalf - thighR * 0.92),
    legLen,
    bust,
    belly,
    muscle,
    build,
    hairLift: headH * hairLiftFor(hairStyle, n(hair, 'volume'), n(hair, 'curl', 0.2)),
    eyeY: -headH * (0.42 + (n(eyes, 'height') - 0.5) * 0.08),
    noseY: -headH * (0.25 + (n(nose, 'height') - 0.5) * 0.06),
    mouthY: -headH * (0.13 + (n(mouth, 'height') - 0.5) * 0.05),
    earY: -headH * 0.36,
  }
}

export interface HumanRig {
  skel: Skeleton
  m: HumanMeasure
  view: View
  /** +1 when the character's left side is on screen right (front view), -1 in back view. */
  sx: number
  /** In side view the character faces +x; which side is nearer the camera. */
  near: Side
}

export function humanRig(dna: AvatarDNA, view: View): HumanRig {
  const m = humanMeasure(dna)
  const s = new Skeleton()
  const sx = view === 'back' ? -1 : 1
  const side = view === 'side'

  s.add('root', null, 0, 0)
  s.add('hips', 'root', 0, -m.legLen, m.pelvisH)
  s.add('spine', 'hips', 0, 0, m.torsoLen)
  s.add('chest', 'spine', 0, -m.torsoLen * 0.62, m.torsoLen * 0.38)
  s.add('neck', 'chest', side ? m.chestDepth * 0.05 : 0, -m.torsoLen * 0.38, m.neckLen)
  s.add('head', 'neck', side ? m.headH * 0.05 : 0, -m.neckLen, m.headH)
  s.add('hairBack', 'head', side ? -m.hw * 0.3 : 0, -m.headH * 0.6, m.headH)
  s.add('hairTail', 'head', side ? -m.hw * 0.9 : 0, -m.headH * 0.72, m.headH)
  s.add('hairTailL', 'head', side ? -m.hw * 0.4 : sx * m.hw * 0.92, -m.headH * 0.62, m.headH)
  s.add('hairTailR', 'head', side ? -m.hw * 0.4 : -sx * m.hw * 0.92, -m.headH * 0.62, m.headH)
  s.add('back', 'chest', side ? -m.chestDepth * 0.7 : 0, -m.torsoLen * 0.18, 0)
  s.add('wingL', 'back', side ? -m.chestDepth * 0.1 : sx * m.shoulderHalf * 0.25, 0, m.torsoLen)
  s.add('wingR', 'back', side ? -m.chestDepth * 0.1 : -sx * m.shoulderHalf * 0.25, 0, m.torsoLen)
  s.add('cape', 'chest', side ? -m.chestDepth * 0.4 : 0, -m.torsoLen * 0.36, m.torsoLen)
  s.add('tail', 'hips', side ? -m.buttDepth * 0.9 : 0, -m.pelvisH * 0.2, m.legLen * 0.6)
  s.add('hem', 'hips', 0, -m.torsoLen * 0.1, m.legLen * 0.5)

  const shoulderY = -m.torsoLen * 0.38 + m.armR * 0.78
  const shoulderX = m.shoulderHalf - m.armR * 0.62
  for (const sd of ['L', 'R'] as const) {
    const sign = sd === 'L' ? sx : -sx
    const ax = side ? (sd === 'R' ? m.chestDepth * 0.02 : -m.chestDepth * 0.08) : sign * shoulderX
    s.add(`upperArm${sd}`, 'chest', ax, shoulderY, m.upperArm)
    s.add(`forearm${sd}`, `upperArm${sd}`, 0, m.upperArm, m.forearm)
    s.add(`hand${sd}`, `forearm${sd}`, 0, m.forearm, m.handLen)
    const lx = side ? (sd === 'R' ? m.thighR * 0.1 : -m.thighR * 0.1) : sign * m.hipJointX
    s.add(`thigh${sd}`, 'hips', lx, m.pelvisH * 0.35, m.thigh)
    s.add(`shin${sd}`, `thigh${sd}`, 0, m.thigh, m.shin)
    s.add(`foot${sd}`, `shin${sd}`, 0, m.shin, m.footLen)
  }

  const hatY = -m.headH * 0.93 - Math.min(m.hairLift, m.headH * 0.12)
  s.anchor('headTop', 'head', 0, hatY)
  s.anchor('skullTop', 'head', 0, -m.headH * 0.93)
  s.anchor('eyes', 'head', side ? m.hw * 0.55 : 0, m.eyeY)
  s.anchor('face', 'head', side ? m.hw * 0.5 : 0, -m.headH * 0.36)
  s.anchor('neck', 'chest', 0, -m.torsoLen * 0.36)
  s.anchor('chest', 'chest', side ? m.chestDepth * 0.5 : 0, -m.torsoLen * 0.12)
  s.anchor('back', 'back', 0, 0)
  s.anchor('waist', 'hips', 0, -m.pelvisH * 0.4)
  s.anchor('handL', 'handL', 0, m.handLen * 0.55)
  s.anchor('handR', 'handR', 0, m.handLen * 0.55)
  s.anchor('feet', 'root', 0, 0)
  return { skel: s, m, view, sx, near: 'R' }
}

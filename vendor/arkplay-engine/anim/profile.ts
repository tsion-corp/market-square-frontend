/* Motion profiles: how an avatar's body changes the way it moves.
 *
 * Humanoids: a heavy build takes shorter, rolling steps with more side-to-side weight
 * shift; a big-headed (chibi) or young avatar bounces; an old one shuffles, leans and
 * swings its arms less. Creatures: the body plan and anatomy pick a gait (a bunny hops, a
 * penguin waddles, a ghost floats, a jellyfish pulses, a wheeled bot rolls), and the
 * creature DNA's `species.gait` can override it.
 *
 * Profiles only read the DNA, so they are deterministic; `vary` gives every avatar its own
 * small timing and amplitude differences (two avatars idling side by side don't move in
 * lockstep), seeded from the DNA seed. */

import { clamp01 } from '../core/math.ts'
import { hash32 } from '../core/rng.ts'
import type { AvatarDNA, Params } from '../dna/types.ts'
import type { Plan } from '../rig/creature.ts'

const num = (p: Params | undefined, k: string, d: number): number => (p && typeof p[k] === 'number' ? (p[k] as number) : d)
const str = (p: Params | undefined, k: string, d: string): string => (p && typeof p[k] === 'string' && p[k] ? (p[k] as string) : d)

/** Seeded 0..1 values and small integer picks for per-avatar variety. */
export interface Variety {
  /** 0..1, fixed per avatar and label. */
  u(label: string): number
  /** An integer in [0, n), fixed per avatar and label. */
  pick(label: string, n: number): number
}

export function variety(seed: number): Variety {
  return {
    u: (label) => hash32(seed, 'motion', label) / 4294967296,
    pick: (label, n) => hash32(seed, 'motion', label) % Math.max(1, n),
  }
}

export interface HumanStyle extends Variety {
  /** 0..1: heavy build and belly. */
  heavy: number
  /** 0..1: muscle. */
  strong: number
  /** 0..1: big-headed, cartoon-child proportions. */
  chibi: number
  /** 0..1: elderly. */
  old: number
  /** Scales vertical bounce (bobs, hops, jump height). */
  bounce: number
  /** Scales stride length. */
  stride: number
  /** Scales arm swing. */
  swing: number
  /** Scales side-to-side weight shift (front view). */
  sway: number
  /** Extra forward lean in locomotion, degrees. */
  lean: number
  /** Scales anticipation and overshoot (snappy vs. careful). */
  snap: number
  /** The avatar's own pose preset (clips layered on it). */
  pose: string
  /** Wears wings (they flap in air clips). */
  wings: boolean
}

export function humanStyle(dna: AvatarDNA): HumanStyle {
  const b = dna.sections.body
  const skin = dna.sections.skin
  const build = num(b, 'build', 0.35)
  const muscle = num(b, 'muscle', 0.2)
  const belly = num(b, 'belly', 0.1)
  const headRatio = num(b, 'headRatio', 0.5)
  const age = num(skin, 'age', 0.15)
  const heavy = clamp01((build - 0.35) * 1.3 + (belly - 0.1) * 0.9)
  const strong = clamp01((muscle - 0.2) * 1.25)
  const chibi = clamp01((headRatio - 0.5) * 2)
  const old = clamp01((age - 0.5) / 0.4)
  return {
    ...variety(dna.seed),
    heavy,
    strong,
    chibi,
    old,
    bounce: Math.max(0.35, 1 + chibi * 0.55 - heavy * 0.35 - old * 0.55),
    stride: Math.max(0.6, 1 - heavy * 0.12 - old * 0.3 + chibi * 0.04),
    swing: Math.max(0.45, 1 + chibi * 0.25 - old * 0.45 - heavy * 0.1 + strong * 0.1),
    sway: 1 + heavy * 1.1 + chibi * 0.35 - old * 0.15,
    lean: old * 8 + heavy * 1.5,
    snap: Math.max(0.5, 1 + chibi * 0.3 - old * 0.45 - heavy * 0.15),
    pose: str(dna.sections.pose, 'preset', 'stand'),
    wings: dna.accessories.some((a) => a.id.endsWith('wings')),
  }
}

/** How a creature gets around. */
export type Gait =
  | 'walk' // legs in a walk/trot/gallop by leg count
  | 'stride' // a two-legged strider (dinosaur, big bird)
  | 'hop' // bounds with the legs together (bunny, frog, small bird, blob)
  | 'waddle' // short rocking steps (penguin, duck)
  | 'slither' // a travelling wave down the body (snake)
  | 'inch' // a slow glide with a ripple (snail)
  | 'swim' // body and tail beat (fish)
  | 'float' // drifts without footfalls (ghost, wisp, sky dragon)
  | 'hover' // held up by wings or rotors (drone)
  | 'roll' // on wheels or a base (retro bot)
  | 'crawl' // arms rippling (octopus)
  | 'pulse' // a bell that contracts (jellyfish)

/** The gait choices a DNA can ask for (`species.gait`); `auto` derives it from anatomy. */
export const GAIT_CHOICES = ['auto', 'walk', 'hop', 'waddle', 'float'] as const

export interface CreatureStyle extends Variety {
  plan: Plan
  gait: Gait
  /** Wing style ('none' when wingless). */
  wings: string
  flies: boolean
  /** Front-facing plans: arm style ('none' when armless). */
  arms: string
  legs: number
  /** 0..1: stout and big. */
  heavy: number
  /** 0..1: very small. */
  tiny: number
  /** A jellyfish-style cephalopod (bell and trailing tentacles). */
  jelly: boolean
}

function autoGait(dna: AvatarDNA, plan: Plan, legs: number, wings: string, jelly: boolean): Gait {
  const s = dna.sections
  switch (plan) {
    case 'aquatic':
      return 'swim'
    case 'serpent':
      // Snails glide; a serpent with legs is a dragon of the sky, and floats.
      return str(s.extras, 'shell', 'none') === 'snail' ? 'inch' : legs > 0 ? 'float' : 'slither'
    case 'blob': {
      const shape = str(s.form, 'blobShape', 'drop')
      return shape === 'ghost' || shape === 'flame' || shape === 'cloud' ? 'float' : legs > 0 ? 'walk' : 'hop'
    }
    case 'cephalopod':
      return jelly ? 'pulse' : 'crawl'
    case 'robot':
      if (legs > 0) return 'walk'
      return wings !== 'none' ? 'hover' : 'roll'
    case 'avian': {
      if (legs === 0) return wings !== 'none' ? 'hover' : 'float'
      if (str(s.limbs, 'feet', 'paws') === 'webbed') return 'waddle'
      if (num(s.limbs, 'length', 0.5) < 0.32 && wings !== 'none') return 'hop'
      return 'stride'
    }
    case 'quadruped': {
      if (legs === 0) return wings !== 'none' ? 'hover' : 'float'
      // Long upright ears on a small body, or webbed feet on a squat one: a hopper.
      if (str(s.ears, 'style', 'pointed') === 'long' && num(s.ears, 'size', 0.5) >= 0.6) return 'hop'
      if (str(s.limbs, 'feet', 'paws') === 'webbed' && num(s.species, 'stance', 0.5) <= 0.32) return 'hop'
      return 'walk'
    }
    case 'insectoid':
      return legs > 0 ? 'walk' : wings !== 'none' ? 'hover' : 'float'
  }
}

export function creatureStyle(dna: AvatarDNA, plan: Plan, legs: number): CreatureStyle {
  const s = dna.sections
  const wings = str(s.wings, 'style', 'none')
  const jelly = plan === 'cephalopod' && num(s.limbs, 'thickness', 0.5) < 0.35
  let gait = autoGait(dna, plan, legs, wings, jelly)
  const asked = str(s.species, 'gait', 'auto')
  const legged = legs > 0 && plan !== 'cephalopod' && plan !== 'aquatic' && plan !== 'serpent'
  if (asked === 'walk' && legged) gait = plan === 'avian' ? 'stride' : 'walk'
  else if (asked === 'hop' && (legged || plan === 'blob' || plan === 'robot')) gait = 'hop'
  else if (asked === 'waddle' && legged) gait = 'waddle'
  else if (asked === 'float' && plan !== 'aquatic') gait = wings !== 'none' && plan !== 'serpent' ? 'hover' : 'float'
  const armsSetting = str(s.limbs, 'arms', 'auto')
  const arms = plan === 'robot' ? (armsSetting === 'auto' ? 'long' : armsSetting) : plan === 'blob' ? (armsSetting === 'auto' ? 'none' : armsSetting) : 'none'
  const size = num(s.species, 'size', 0.5)
  return {
    ...variety(dna.seed),
    plan,
    gait,
    wings,
    flies: wings !== 'none',
    arms,
    legs,
    heavy: clamp01((num(s.form, 'girth', 0.5) - 0.5) * 1.4 + (size - 0.5) * 0.8),
    tiny: clamp01((0.35 - size) * 3),
    jelly,
  }
}

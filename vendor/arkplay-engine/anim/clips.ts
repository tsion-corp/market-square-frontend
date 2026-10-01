/* The clip catalogue, and clip lookup for a model.
 *
 * The catalogue is the single source of a clip's timing: every avatar's version of a clip
 * has exactly the duration, fps and looping listed here (the service plans sprite sheets
 * and GIFs from it, the studio scrubs with it). Builders in humanClips.ts and
 * creatureClips.ts only supply the motion, adapted to the avatar's body. */

import type { AvatarDNA } from '../dna/types.ts'
import type { Model } from '../render/model.ts'
import { creatureMeasure } from '../rig/creature.ts'
import type { Clip, ClipInfo } from './clip.ts'
import { humanMotion } from './humanClips.ts'
import { creatureMotion } from './creatureClips.ts'
import { creatureStyle, humanStyle, type CreatureStyle, type HumanStyle } from './profile.ts'

const H = ['humanoid'] as const
const C = ['creature'] as const
const B = ['humanoid', 'creature'] as const

const info = (name: string, label: string, loop: boolean, duration: number, fps: number, kinds: readonly ('humanoid' | 'creature')[], tags: string[]): ClipInfo => ({
  name,
  label,
  loop,
  duration,
  fps,
  kinds: [...kinds],
  tags,
})

/** Every clip, for menus, the service catalogue and the Unity SDK. Names never change
 *  meaning; new clips are added. Frame counts (duration × fps) stay at 36 or fewer. */
export const CLIPS: ClipInfo[] = [
  info('idle', 'Idle', true, 2.4, 12, B, ['core']),
  info('idle-look', 'Look around', true, 3.0, 10, B, ['idle']),
  info('idle-fidget', 'Fidget', true, 2.4, 12, B, ['idle']),
  info('yawn', 'Yawn & stretch', false, 2.0, 12, B, ['idle', 'rest']),
  info('blink', 'Blink', false, 0.3, 20, B, ['face']),
  info('talk', 'Talk', true, 1.8, 14, B, ['face', 'core']),
  info('walk', 'Walk', true, 1.0, 12, B, ['core', 'locomotion']),
  info('run', 'Run', true, 0.62, 14, B, ['core', 'locomotion']),
  info('jump', 'Jump', false, 1.0, 16, B, ['core', 'locomotion']),
  info('jump-up', 'Jump take-off', false, 0.5, 16, B, ['locomotion', 'jump']),
  info('fall', 'Fall', true, 0.8, 12, B, ['locomotion', 'jump']),
  info('land', 'Land', false, 0.5, 16, B, ['locomotion', 'jump']),
  info('hover', 'Hover', true, 1.6, 12, B, ['locomotion', 'air']),
  info('flap', 'Wing flap', true, 0.5, 16, B, ['locomotion', 'air', 'emote']),
  info('glide', 'Glide', true, 1.6, 12, B, ['locomotion', 'air']),
  info('fly', 'Fly', true, 0.6, 16, C, ['locomotion', 'air']),
  info('swim', 'Swim', true, 1.2, 12, C, ['locomotion']),
  info('slither', 'Slither', true, 1.4, 12, C, ['locomotion']),
  info('hop', 'Hop', true, 0.9, 14, C, ['locomotion']),
  info('wave', 'Wave', true, 1.2, 14, B, ['emote']),
  info('cheer', 'Cheer', true, 0.9, 14, B, ['emote']),
  info('dance', 'Dance', true, 1.6, 14, B, ['emote', 'dance']),
  info('dance-hop', 'Party hop', true, 1.0, 14, B, ['emote', 'dance']),
  info('dance-sway', 'Sway', true, 2.0, 12, B, ['emote', 'dance']),
  info('clap', 'Clap', true, 0.5, 16, B, ['emote']),
  info('nod', 'Nod yes', true, 0.9, 14, B, ['emote']),
  info('shake-head', 'Shake head', true, 0.9, 14, B, ['emote']),
  info('laugh', 'Laugh', true, 1.2, 14, B, ['emote']),
  info('cry', 'Cry', true, 1.6, 12, B, ['emote']),
  info('angry', 'Stomp', true, 1.0, 14, B, ['emote']),
  info('love', 'Love', true, 1.6, 12, B, ['emote']),
  info('surprise', 'Surprise', false, 0.8, 16, B, ['emote']),
  info('shrug', 'Shrug', false, 1.4, 14, H, ['emote']),
  info('think', 'Think', true, 2.4, 10, H, ['emote']),
  info('bow', 'Bow', false, 1.4, 14, B, ['emote']),
  info('victory', 'Victory', true, 1.1, 14, B, ['emote', 'result']),
  info('defeat', 'Defeat', true, 2.0, 10, B, ['emote', 'result']),
  info('wag', 'Tail wag', true, 0.5, 16, C, ['emote']),
  info('attack', 'Attack', false, 0.6, 18, B, ['combat']),
  info('cast', 'Cast spell', true, 1.2, 14, H, ['combat']),
  info('hurt', 'Hurt', false, 0.5, 18, B, ['combat']),
  info('ko', 'Knocked out', false, 1.2, 16, B, ['combat']),
  info('sit', 'Sit', true, 2.4, 10, B, ['rest']),
  info('sleep', 'Sleep', true, 3.0, 10, B, ['rest']),
]

const byName = new Map(CLIPS.map((c) => [c.name, c]))

export const clipsFor = (kind: 'humanoid' | 'creature'): ClipInfo[] => CLIPS.filter((c) => c.kinds.includes(kind))

const styles = new WeakMap<Model, HumanStyle | CreatureStyle>()

export function clipFor(model: Model, name: string): Clip | undefined {
  const ci = byName.get(name)
  if (!ci) return undefined
  const { hr, cr, dna } = model.ctx
  if (hr) {
    if (!ci.kinds.includes('humanoid')) return undefined
    let st = styles.get(model) as HumanStyle | undefined
    if (!st) styles.set(model, (st = humanStyle(dna)))
    const motion = humanMotion(hr, st, ci)
    return motion && { ...motion, name: ci.name, label: ci.label, duration: ci.duration, loop: ci.loop, fps: ci.fps }
  }
  if (cr) {
    if (!ci.kinds.includes('creature')) return undefined
    let st = styles.get(model) as CreatureStyle | undefined
    if (!st) styles.set(model, (st = creatureStyle(dna, cr.m.plan, cr.m.legs)))
    const motion = creatureMotion(cr, st, ci)
    return motion && { ...motion, name: ci.name, label: ci.label, duration: ci.duration, loop: ci.loop, fps: ci.fps }
  }
  return undefined
}

/**
 * The clips that suit this particular avatar, in catalogue order: everything for its kind,
 * minus the ones its body can't do convincingly (a wingless cat doesn't fly, a fish doesn't
 * wag a tail it hasn't got). Every clip of `clipsFor(kind)` still plays for any avatar of
 * that kind; this is for menus.
 */
export function clipsForAvatar(dna: AvatarDNA): ClipInfo[] {
  const all = clipsFor(dna.kind)
  if (dna.kind !== 'creature') return all
  const m = creatureMeasure(dna)
  const st = creatureStyle(dna, m.plan, m.legs)
  const tail = typeof dna.sections.tail?.style === 'string' ? dna.sections.tail.style : 'thin'
  const airborne = st.flies || st.gait === 'float' || st.gait === 'hover' || st.gait === 'pulse'
  return all.filter((c) => {
    switch (c.name) {
      case 'fly':
      case 'glide':
      case 'hover':
        return airborne
      case 'flap':
        return st.flies
      case 'swim':
        return m.plan === 'aquatic' || m.plan === 'serpent' || m.plan === 'cephalopod' || st.gait === 'waddle' || dna.sections.limbs?.feet === 'webbed'
      case 'slither':
        return m.plan === 'serpent'
      case 'hop':
        return m.plan !== 'aquatic' && m.plan !== 'serpent' && m.plan !== 'cephalopod'
      case 'wag':
        return tail !== 'none' && m.plan !== 'serpent' && !m.frontFacing
      default:
        return true
    }
  })
}

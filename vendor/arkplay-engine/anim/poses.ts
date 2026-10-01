/* Body poses as bone rotations.
 *
 * Poses are written once, in a semantic convention, and converted to rotations for the
 * view being drawn:
 *   front/back:  `out` raises an arm away from the body; `bend` folds the forearm toward
 *                the body's midline; legs likewise.
 *   side:        `fwd` swings a limb forward (toward the way the avatar faces), `bend`
 *                folds the forearm up / the shin back.
 * L/R are the character's own left and right. */

import type { HumanRig } from '../rig/humanoid.ts'
import type { Pose } from '../rig/skeleton.ts'
import type { HandShape, Side } from '../render/types.ts'

interface Limb {
  out?: number
  bend?: number
}

interface SideLimb {
  fwd?: number
  bend?: number
}

export interface PoseDef {
  arms?: Partial<Record<Side, Limb>>
  legs?: Partial<Record<Side, Limb>>
  side?: {
    arms?: Partial<Record<Side, SideLimb>>
    legs?: Partial<Record<Side, SideLimb>>
    lean?: number
  }
  hands?: Partial<Record<Side, HandShape>>
  lean?: number
  tilt?: number
  /** Hips drop (fraction of thigh length) — crouch/sit. */
  drop?: number
  /** Thighs foreshortened toward the camera (sitting, seen from the front). */
  sitFront?: boolean
  shiftX?: number
}

const both = <T,>(l: T, r: T = l) => ({ L: l, R: r })

export const POSE_DEFS: Record<string, PoseDef> = {
  stand: { arms: both({ out: 7, bend: 6 }), legs: both({ out: 1.5 }), hands: { L: 'relaxed', R: 'relaxed' } },
  relaxed: {
    arms: { L: { out: 4, bend: 12 }, R: { out: 11, bend: 4 } },
    legs: { L: { out: -1 }, R: { out: 5 } },
    lean: 2,
    tilt: 3,
    shiftX: 4,
    hands: { L: 'relaxed', R: 'relaxed' },
  },
  'hands-hips': { arms: both({ out: 42, bend: 122 }), legs: both({ out: 4 }), hands: { L: 'fist', R: 'fist' } },
  wave: {
    arms: { L: { out: 7, bend: 6 }, R: { out: 128, bend: -48 } },
    legs: both({ out: 2 }),
    hands: { L: 'relaxed', R: 'wave' },
    tilt: -4,
    side: { arms: { R: { fwd: 150, bend: 20 }, L: { fwd: 5 } } },
  },
  peace: {
    arms: { L: { out: 7, bend: 8 }, R: { out: 26, bend: 150 } },
    hands: { L: 'relaxed', R: 'peace' },
    tilt: -5,
    side: { arms: { R: { fwd: 50, bend: 120 } } },
  },
  'thumbs-up': {
    arms: { L: { out: 7, bend: 8 }, R: { out: 32, bend: 112 } },
    hands: { L: 'relaxed', R: 'thumb' },
    side: { arms: { R: { fwd: 40, bend: 80 } } },
  },
  point: {
    arms: { L: { out: 7, bend: 8 }, R: { out: 84, bend: 4 } },
    hands: { L: 'relaxed', R: 'point' },
    side: { arms: { R: { fwd: 88, bend: 4 } } },
  },
  cheer: {
    arms: both({ out: 152, bend: -12 }),
    legs: both({ out: 6 }),
    hands: { L: 'fist', R: 'fist' },
    tilt: 0,
    side: { arms: { R: { fwd: 165 }, L: { fwd: 150 } } },
  },
  'arms-crossed': { arms: both({ out: 16, bend: 128 }), legs: both({ out: 3 }), hands: { L: 'relaxed', R: 'relaxed' }, side: { arms: both({ fwd: 20, bend: 95 }) } },
  think: {
    arms: { L: { out: 14, bend: 96 }, R: { out: 18, bend: 156 } },
    hands: { L: 'relaxed', R: 'fist' },
    tilt: 7,
    side: { arms: { R: { fwd: 35, bend: 140 }, L: { fwd: 20, bend: 80 } } },
  },
  shrug: { arms: both({ out: 34, bend: -58 }), hands: { L: 'open', R: 'open' }, tilt: 6, side: { arms: both({ fwd: 25, bend: 70 }) } },
  flex: { arms: both({ out: 86, bend: 112 }), legs: both({ out: 5 }), hands: { L: 'fist', R: 'fist' }, side: { arms: both({ fwd: 70, bend: 110 }) } },
  salute: { arms: { L: { out: 7, bend: 6 }, R: { out: 48, bend: 150 } }, hands: { L: 'relaxed', R: 'open' }, side: { arms: { R: { fwd: 95, bend: 130 } } } },
  fight: {
    arms: both({ out: 22, bend: 132 }),
    legs: both({ out: 9 }),
    hands: { L: 'fist', R: 'fist' },
    lean: 3,
    drop: 0.08,
    side: { arms: { R: { fwd: 60, bend: 110 }, L: { fwd: 30, bend: 120 } }, legs: { R: { fwd: 25, bend: 20 }, L: { fwd: -20, bend: 15 } } },
  },
  cast: {
    arms: { L: { out: 12, bend: 20 }, R: { out: 72, bend: -8 } },
    legs: both({ out: 5 }),
    hands: { L: 'relaxed', R: 'open' },
    side: { arms: { R: { fwd: 80 }, L: { fwd: -10, bend: 30 } }, legs: { R: { fwd: 15, bend: 10 }, L: { fwd: -15 } } },
  },
  heart: { arms: both({ out: 148, bend: 68 }), hands: { L: 'open', R: 'open' }, side: { arms: both({ fwd: 160, bend: 60 }) } },
  sit: {
    arms: both({ out: 10, bend: 34 }),
    legs: both({ out: 5 }),
    sitFront: true,
    drop: 0.82,
    hands: { L: 'relaxed', R: 'relaxed' },
    side: { arms: both({ fwd: 25, bend: 40 }), legs: both({ fwd: 88, bend: 88 }), lean: -4 },
  },
  run: {
    arms: { L: { out: 18, bend: 80 }, R: { out: 12, bend: 60 } },
    legs: { L: { out: 12 }, R: { out: -4 } },
    hands: { L: 'fist', R: 'fist' },
    lean: 4,
    side: { arms: { R: { fwd: -40, bend: 80 }, L: { fwd: 45, bend: 90 } }, legs: { R: { fwd: 40, bend: 40 }, L: { fwd: -30, bend: 70 } }, lean: 10 },
  },
  jump: {
    arms: both({ out: 62, bend: 20 }),
    legs: both({ out: 16, bend: 40 }),
    hands: { L: 'open', R: 'open' },
    drop: -0.25,
    side: { arms: both({ fwd: 120, bend: 20 }), legs: { R: { fwd: 50, bend: 70 }, L: { fwd: 20, bend: 90 } } },
  },
  // stickers: sticker- and comic-only poses (export/stickers.ts, export/comics.ts). Not DNA options:
  // never add them to POSES in dna/schema. `-l`/`-r` name the arm doing the work (front view:
  // the character's L is screen right).
  'sticker-pray': { arms: both({ out: 13, bend: 157 }), hands: { L: 'open', R: 'open' }, tilt: 3, side: { arms: both({ fwd: 48, bend: 118 }) } },
  'sticker-clap': { arms: both({ out: 38, bend: 150 }), legs: both({ out: 3 }), hands: { L: 'open', R: 'open' }, side: { arms: both({ fwd: 50, bend: 90 }) } },
  'sticker-hold': { arms: both({ out: 38, bend: 106 }), hands: { L: 'hold', R: 'hold' }, side: { arms: both({ fwd: 38, bend: 70 }) } },
  'sticker-lift': { arms: both({ out: 162, bend: 26 }), legs: both({ out: 5 }), hands: { L: 'open', R: 'open' }, side: { arms: both({ fwd: 170, bend: 10 }) } },
  'sticker-praise': { arms: both({ out: 146, bend: -14 }), legs: both({ out: 3 }), hands: { L: 'open', R: 'open' }, side: { arms: both({ fwd: 150, bend: 10 }) } },
  'sticker-hug-l': { arms: { L: { out: 70, bend: 64 }, R: { out: 34, bend: 124 } }, hands: { L: 'open', R: 'open' }, lean: 5, tilt: 8, side: { arms: both({ fwd: 70, bend: 60 }) } },
  'sticker-hug-r': { arms: { R: { out: 70, bend: 64 }, L: { out: 34, bend: 124 } }, hands: { L: 'open', R: 'open' }, lean: -5, tilt: -8, side: { arms: both({ fwd: 70, bend: 60 }) } },
  'sticker-high-five-l': { arms: { L: { out: 142, bend: -18 }, R: { out: 8, bend: 8 } }, hands: { L: 'open', R: 'relaxed' }, lean: 3, tilt: 4, side: { arms: { L: { fwd: 150 }, R: { fwd: 5 } } } },
  'sticker-high-five-r': { arms: { R: { out: 142, bend: -18 }, L: { out: 8, bend: 8 } }, hands: { R: 'open', L: 'relaxed' }, lean: -3, tilt: -4, side: { arms: { R: { fwd: 150 }, L: { fwd: 5 } } } },
  'sticker-point-l': { arms: { L: { out: 84, bend: 4 }, R: { out: 7, bend: 8 } }, hands: { L: 'point', R: 'relaxed' }, side: { arms: { R: { fwd: 88, bend: 4 } } } },
  'sticker-selfie': { arms: { R: { out: 118, bend: -26 }, L: { out: 28, bend: 150 } }, hands: { R: 'hold', L: 'peace' }, tilt: -6, side: { arms: { R: { fwd: 120 }, L: { fwd: 50, bend: 120 } } } },
  'sticker-facepalm': { arms: { R: { out: 136, bend: -128 }, L: { out: 8, bend: 10 } }, hands: { R: 'open', L: 'relaxed' }, tilt: 8, side: { arms: { R: { fwd: 60, bend: 150 } } } },
  'sticker-oh-no': { arms: both({ out: 112, bend: -124 }), hands: { L: 'open', R: 'open' }, side: { arms: both({ fwd: 160, bend: 120 }) } },
  'sticker-cover-face': { arms: both({ out: -22, bend: 157 }), hands: { L: 'open', R: 'open' }, tilt: 4, side: { arms: both({ fwd: 60, bend: 150 }) } },
  'sticker-dance': {
    arms: { L: { out: 148, bend: -28 }, R: { out: 58, bend: 92 } },
    legs: { L: { out: 14 }, R: { out: -5 } },
    hands: { L: 'open', R: 'fist' },
    lean: -4,
    tilt: -8,
    shiftX: -4,
    side: { arms: { L: { fwd: 150 }, R: { fwd: 40, bend: 90 } }, legs: { R: { fwd: 20, bend: 20 } } },
  },
  'sticker-sling': {
    arms: { R: { out: 158, bend: -40 }, L: { out: 30, bend: 40 } },
    legs: { L: { out: 10 }, R: { out: -2 } },
    hands: { R: 'fist', L: 'open' },
    lean: -3,
    side: { arms: { R: { fwd: 170, bend: 30 }, L: { fwd: 60, bend: 20 } }, legs: { R: { fwd: 25, bend: 20 }, L: { fwd: -20, bend: 10 } } },
  },
}

export interface PoseResult {
  pose: Pose
  hands: Record<Side, HandShape>
}

/** Converts a pose definition into bone rotations for this rig and view. */
export function humanPose(name: string, rig: HumanRig): PoseResult {
  const def = POSE_DEFS[name] ?? POSE_DEFS.stand
  const pose: Pose = {}
  const m = rig.m
  const hands: Record<Side, HandShape> = { L: def.hands?.L ?? 'relaxed', R: def.hands?.R ?? 'relaxed' }

  if (rig.view === 'side') {
    const sd = def.side ?? {}
    for (const s of ['L', 'R'] as const) {
      const a = sd.arms?.[s] ?? (def.arms?.[s] ? { fwd: (def.arms[s]!.out ?? 0) * (s === 'R' ? 0.6 : 0.4), bend: Math.max(0, def.arms[s]!.bend ?? 0) * 0.5 } : { fwd: 3, bend: 8 })
      pose[`upperArm${s}`] = { rot: -(a.fwd ?? 0) }
      pose[`forearm${s}`] = { rot: -(a.bend ?? 0) }
      const l = sd.legs?.[s] ?? {}
      pose[`thigh${s}`] = { rot: -(l.fwd ?? 0) }
      pose[`shin${s}`] = { rot: l.bend ?? 0 }
      if (l.bend) pose[`foot${s}`] = { rot: -(l.bend ?? 0) * 0.3 }
    }
    const lean = sd.lean ?? def.lean ?? 0
    pose.spine = { rot: lean }
    pose.head = { rot: -(def.tilt ?? 0) * 0.3 }
  } else {
    // Front: character's left is screen right (sx = +1); back view mirrors.
    const dir = (s: Side) => (s === 'L' ? rig.sx : -rig.sx)
    for (const s of ['L', 'R'] as const) {
      const a = def.arms?.[s] ?? {}
      pose[`upperArm${s}`] = { rot: -dir(s) * (a.out ?? 0) }
      pose[`forearm${s}`] = { rot: dir(s) * (a.bend ?? 0) }
      const l = def.legs?.[s] ?? {}
      pose[`thigh${s}`] = { rot: -dir(s) * (l.out ?? 0) }
      pose[`shin${s}`] = { rot: dir(s) * (l.bend ?? 0) * 0.5 }
      pose[`foot${s}`] = { rot: -dir(s) * (l.bend ?? 0) * 0.2 }
      if (def.sitFront) pose[`thigh${s}`] = { ...pose[`thigh${s}`], sy: 0.28 }
    }
    pose.spine = { rot: (def.lean ?? 0) * rig.sx }
    pose.head = { rot: (def.tilt ?? 0) * rig.sx }
  }
  const drop = def.drop ?? 0
  if (drop || def.shiftX) pose.hips = { y: drop * m.thigh, x: (def.shiftX ?? 0) * rig.sx }
  return { pose, hands }
}

/* Shared render-time types. */

import type { Box } from '../core/math.ts'

export type View = 'front' | 'side' | 'back'

/**
 * - `full`     fixed world frame shared by every avatar of a kind: consistent scale for
 *              game sprites (a tall avatar is taller than a short one).
 * - `fit`      tight around this avatar.
 * - `bust`     head and shoulders.
 * - `head`     the head, hair and hat.
 * - `portrait` profile picture: head a little above centre, room for a circle frame.
 */
export type Crop = 'full' | 'fit' | 'bust' | 'head' | 'portrait'

export type Side = 'L' | 'R'

export type HandShape = 'open' | 'relaxed' | 'fist' | 'point' | 'peace' | 'thumb' | 'hold' | 'wave'

export type EyeMode =
  | 'normal'
  | 'closed'
  | 'happy'
  | 'sad'
  | 'hearts'
  | 'stars'
  | 'spiral'
  | 'x'
  | 'wide'
  | 'sparkle'
  | 'blank'

export type MouthShape = 'normal' | 'o' | 'teeth' | 'tongue' | 'wavy' | 'cat' | 'grimace' | 'pout' | 'flat' | 'd'

/** Continuous face state. Presets produce these; animations blend them. */
export interface ExprState {
  openL: number
  openR: number
  squint: number
  lookX: number
  lookY: number
  /** -1 sad (outer lids droop) … 1 angry (inner lids drop). */
  lidAngle: number
  eyeL: EyeMode
  eyeR: EyeMode
  browRaise: number
  /** -1 worried (inner ends up) … 1 angry (inner ends down). */
  browAngle: number
  /** One brow up (confused, smug): -1 left … 1 right. */
  browAsym: number
  smile: number
  open: number
  wide: number
  asym: number
  mouth: MouthShape
  blush: number
  tears: number
  sweat: number
  vein: boolean
  zzz: boolean
  steam: boolean
  sick: number
  headTilt: number
}

export interface FrameState {
  expr: ExprState
  hands: Record<Side, HandShape>
  /** Seconds since the clip started (animated effects, particles). */
  t: number
  /** Normalized phase 0..1 of the current loop. */
  phase: number
}

export interface Part {
  id: string
  bone: string
  z: number
  svg: string
  /** Rebuilt every frame (face, hands). */
  dynamic?: boolean
  /** Local bounds, for parts whose SVG nests transforms that `partBounds` cannot see. */
  bounds?: Box
}

export interface RenderOptions {
  view?: View
  crop?: Crop
  /** Output width in px (height follows the crop's aspect). Only sets width/height attributes. */
  size?: number
  /** Include the scene background (default true). */
  background?: boolean
  /** Include the frame and its border (default true). */
  frame?: boolean
  /** Include auras and particle effects (default true). */
  effects?: boolean
  /** Ground shadow (default: the scene setting). */
  shadow?: boolean
  /** Override the DNA expression (preset id). */
  expression?: string
  /** Override the DNA pose (preset id). */
  pose?: string
  /** Sample this animation clip… */
  anim?: string
  /** …at this time in seconds. */
  time?: number
  /** Mirror horizontally (side view facing left). */
  flip?: boolean
  /** Prefix for SVG ids so several avatars can share one HTML page. */
  idPrefix?: string
  /** Extra padding around the crop, as a fraction of its size. */
  padding?: number
  /** Override the art-style detail level. */
  detail?: 'low' | 'medium' | 'high'
  /**
   * `high` bakes in the expensive look for still images (profile pictures, PNG exports, the
   * studio's still preview): richer lighting, materials and background detail. `standard` is
   * the lighter look for animation frames, which are drawn many times. Default: `high` for
   * stills, `standard` when `anim` is set; sprite sheets and rigs always use `standard`.
   * Generators read the result as `ctx.baked`.
   */
  quality?: 'standard' | 'high'
  /**
   * Looping ambient motion for auras and effects (and scene particles) in a still render:
   * CSS keyframe animation embedded in the SVG. Browsers play it; rasterizers (resvg) draw
   * the base frame; `prefers-reduced-motion` stops it. Default: on for `quality: 'high'`
   * stills. Ignored when `anim` is set (the clip's time drives the effects instead).
   * Generators read the result as `ctx.motion`.
   */
  motion?: boolean
  /** Overrides the crop box entirely (world units). */
  viewBox?: Box
  /** Adds a <title> for accessibility (default: the avatar's name). */
  title?: string | false
  /**
   * Resolves an uploaded custom asset id to an image href (a URL in browsers, a data URL
   * on the server). Without it, custom accessories that only carry an id are skipped.
   */
  assetUrl?: (id: string) => string | undefined
}

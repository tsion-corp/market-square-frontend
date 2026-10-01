/* Anchor frames: where accessories attach, described independently of the body that
 * carries them. Humanoids and creatures each compute these from their own rigs, and all
 * accessory art is drawn against them — so a crown fits a knight and a dragon alike. */

import type { View } from '../../render/types.ts'

/** Head region, in `bone` space. */
export interface HeadFrame {
  bone: string
  view: View
  /** +1 when a profile head faces +x, -1 when it faces -x. */
  facing: number
  /** Horizontal centre of the skull (profile: a little behind the face). */
  cx: number
  /** y of the hat band (where a hat's rim meets the head). */
  band: number
  /** y of the top of the hair (a hat's crown must clear it). */
  top: number
  /** Half-width of head + hair at the band. */
  hw: number
  /** Head height (scale reference). */
  hh: number
  /** Brow line and ear position. */
  brow: number
  earY: number
  earX: number
  /** Whether hair hangs below the hat on the sides/back. */
  longHair: boolean
}

export interface EyeFrame {
  bone: string
  view: View
  facing: number
  y: number
  /** Eye centres (one in profile). */
  xs: number[]
  /** Eye width. */
  w: number
  /** Width of the face at eye level (glasses temples reach it). */
  faceHalf: number
  noseY: number
  mouthY: number
  hh: number
}

export interface NeckFrame {
  bone: string
  view: View
  facing: number
  /** Collar line. */
  y: number
  cx: number
  /** Neck radius. */
  r: number
  /** Half-width of the chest at the collar and how far down the chest reaches. */
  chest: number
  drop: number
}

export interface BackFrame {
  bone: string
  view: View
  facing: number
  /** Shoulder span and torso length (wings, capes, packs scale with these). */
  span: number
  len: number
  /** Where a cape hangs to. */
  hang: number
}

export interface HandFrame {
  bone: string
  view: View
  /** Grip point in hand space. */
  x: number
  y: number
  /** Scale reference (hand length). */
  s: number
  /** +1 thumb toward +x. */
  thumb: number
}

export interface WaistFrame {
  bone: string
  view: View
  y: number
  half: number
  depth: number
}

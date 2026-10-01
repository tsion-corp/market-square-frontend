/* Auras and particle effects. Every aura is premium: its art (which also describes how it
 * moves) plugs in through the premium art registry (render/premiumArt.ts), and builds without
 * it draw a placeholder (parts/shared/placeholder.ts). */

import type { Box } from '../../core/math.ts'
import type { Ctx, Reader } from '../../render/context.ts'
import { premiumArt } from './placeholder.ts'

/** Loop length of every particle effect, seconds. Clips sample it seamlessly. */
export const FX_PERIOD = 2.4

/** An aura over `region` at time `t` (seconds): `behind` goes behind the body, `front` over it. */
export function drawAura(c: Ctx, id: string, p: Reader, region: Box, t: number, seed: number): { behind: string; front: string } {
  const art = premiumArt('aura', id)
  return art ? art(c, id, p, region, t, seed) : { behind: '', front: '' }
}

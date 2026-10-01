/* Smooth 1D/2D value noise, seeded. Used for hair messiness, fur edges, terrain in scene
 * backgrounds and organic wobble, anywhere white-noise jitter would look like static. */

import { hash32 } from './rng.ts'

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
const rand = (seed: number, x: number, y = 0): number => hash32(seed, x, y) / 4294967296

export function noise1(seed: number, x: number): number {
  const i = Math.floor(x)
  const t = fade(x - i)
  const a = rand(seed, i)
  const b = rand(seed, i + 1)
  return (a + (b - a) * t) * 2 - 1
}

export function noise2(seed: number, x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const tx = fade(x - ix)
  const ty = fade(y - iy)
  const a = rand(seed, ix, iy)
  const b = rand(seed, ix + 1, iy)
  const c = rand(seed, ix, iy + 1)
  const d = rand(seed, ix + 1, iy + 1)
  const top = a + (b - a) * tx
  const bot = c + (d - c) * tx
  return (top + (bot - top) * ty) * 2 - 1
}

/** Fractal (octave-summed) 1D noise in roughly [-1, 1]. */
export function fbm1(seed: number, x: number, octaves = 3): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += noise1(seed + o * 1013, x * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

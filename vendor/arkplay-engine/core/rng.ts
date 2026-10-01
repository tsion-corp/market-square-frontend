/* Seeded, deterministic randomness.
 *
 * Every random choice in the engine flows from an Rng forked from the avatar's seed with
 * a label ("hair", "freckles", ...). Forking by label means one feature's randomness never
 * depends on how many numbers another feature drew, so changing the freckle count does
 * not reshuffle the hair. `Math.random` is never used anywhere in the engine: the same
 * DNA must render the same SVG in the browser, on the server and in five years. */

export interface Rng {
  readonly seed: number
  /** Float in [0, 1). */
  next(): number
  /** Float in [min, max). */
  range(min: number, max: number): number
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number
  /** True with probability p. */
  chance(p: number): boolean
  /** Standard normal (mean 0, sd 1). */
  gauss(): number
  /** Normal with mean/sd, clamped to [min, max]. */
  normal(mean: number, sd: number, min?: number, max?: number): number
  pick<T>(items: readonly T[]): T
  weighted<T>(items: readonly T[], weight: (item: T) => number): T
  shuffle<T>(items: T[]): T[]
  /** An independent stream derived from this stream's seed and a label. */
  fork(label: string | number): Rng
}

/** 32-bit string hash (FNV-1a with a final avalanche). Stable across platforms. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return avalanche(h)
}

/** Hashes any mix of strings and numbers into one 32-bit value. */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x9e3779b9
  for (const p of parts) {
    const v = typeof p === 'number' ? avalanche(Math.floor(p) >>> 0 ^ Math.floor((p % 1) * 1e6)) : hashString(p)
    h = avalanche(h ^ v)
  }
  return h >>> 0
}

function avalanche(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b)
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35)
    return (z ^ (z >>> 16)) >>> 0
  }
}

/** sfc32: small, fast, and good enough statistically for art. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

export function createRng(seed: number | string): Rng {
  const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0
  const mix = splitmix32(s)
  const gen = sfc32(mix(), mix(), mix(), mix())
  // Warm up so nearby seeds diverge immediately.
  for (let i = 0; i < 12; i++) gen()
  let spare: number | null = null

  const rng: Rng = {
    seed: s,
    next: gen,
    range: (min, max) => min + (max - min) * gen(),
    int: (min, max) => Math.floor(min + (max - min + 1) * gen()),
    chance: (p) => gen() < p,
    gauss: () => {
      if (spare !== null) {
        const v = spare
        spare = null
        return v
      }
      let u = 0
      let v = 0
      while (u <= Number.EPSILON) u = gen()
      v = gen()
      const mag = Math.sqrt(-2 * Math.log(u))
      spare = mag * Math.sin(2 * Math.PI * v)
      return mag * Math.cos(2 * Math.PI * v)
    },
    normal: (mean, sd, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, mean + sd * rng.gauss())),
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick on an empty list')
      return items[Math.floor(gen() * items.length)]
    },
    weighted: (items, weight) => {
      let total = 0
      for (const it of items) total += Math.max(0, weight(it))
      if (total <= 0) return rng.pick(items)
      let r = gen() * total
      for (const it of items) {
        r -= Math.max(0, weight(it))
        if (r < 0) return it
      }
      return items[items.length - 1]
    },
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(gen() * (i + 1))
        const t = items[i]
        items[i] = items[j]
        items[j] = t
      }
      return items
    },
    fork: (label) => createRng(hash32(s, label)),
  }
  return rng
}

/** A fresh random 32-bit seed for UI actions ("randomize"). Not used by rendering. */
export function freshSeed(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] >>> 0
  return (Date.now() ^ (performance.now() * 1000)) >>> 0
}

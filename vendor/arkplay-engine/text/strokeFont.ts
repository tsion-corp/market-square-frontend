/* A tiny single-stroke font for prints (shirt text, jersey numbers, badges).
 *
 * Text is drawn as stroked paths, never <text>, so it looks identical in every browser
 * and in the server rasterizer (which has no fonts), and never depends on a font
 * download. Glyphs are polylines on a 4 × 6 grid; `M` starts a new stroke. */

type Glyph = string

const G: Record<string, Glyph> = {
  A: 'M0 6L2 0L4 6M0.7 4H3.3',
  B: 'M0 0H2.8Q4 0 4 1.5Q4 3 2.8 3H0M2.8 3Q4 3 4 4.5Q4 6 2.8 6H0V0',
  C: 'M4 1Q3.4 0 2 0Q0 0 0 3Q0 6 2 6Q3.4 6 4 5',
  D: 'M0 0H2Q4 0 4 3Q4 6 2 6H0Z',
  E: 'M4 0H0V6H4M0 3H3',
  F: 'M4 0H0V6M0 3H3',
  G: 'M4 1Q3.4 0 2 0Q0 0 0 3Q0 6 2 6Q4 6 4 4V3.2H2.4',
  H: 'M0 0V6M4 0V6M0 3H4',
  I: 'M1 0H3M2 0V6M1 6H3',
  J: 'M4 0V4.5Q4 6 2.2 6Q0.6 6 0.3 4.6',
  K: 'M0 0V6M4 0L0 3.6M1.4 2.7L4 6',
  L: 'M0 0V6H4',
  M: 'M0 6V0L2 3.4L4 0V6',
  N: 'M0 6V0L4 6V0',
  O: 'M2 0Q0 0 0 3Q0 6 2 6Q4 6 4 3Q4 0 2 0Z',
  P: 'M0 6V0H2.6Q4 0 4 1.6Q4 3.2 2.6 3.2H0',
  Q: 'M2 0Q0 0 0 3Q0 6 2 6Q4 6 4 3Q4 0 2 0ZM2.6 4.4L4 6',
  R: 'M0 6V0H2.6Q4 0 4 1.6Q4 3.2 2.6 3.2H0M2.2 3.2L4 6',
  S: 'M4 0.8Q3.4 0 2 0Q0.2 0 0.2 1.5Q0.2 2.8 2 3Q3.8 3.2 3.8 4.5Q3.8 6 2 6Q0.6 6 0 5.2',
  T: 'M0 0H4M2 0V6',
  U: 'M0 0V4Q0 6 2 6Q4 6 4 4V0',
  V: 'M0 0L2 6L4 0',
  W: 'M0 0L1 6L2 2.4L3 6L4 0',
  X: 'M0 0L4 6M4 0L0 6',
  Y: 'M0 0L2 3L4 0M2 3V6',
  Z: 'M0 0H4L0 6H4',
  '0': 'M2 0Q0 0 0 3Q0 6 2 6Q4 6 4 3Q4 0 2 0ZM3.4 1L0.6 5',
  '1': 'M0.8 1.2L2 0V6M0.8 6H3.2',
  '2': 'M0.2 1.2Q0.8 0 2 0Q4 0 4 1.7Q4 3 0 6H4',
  '3': 'M0.2 0.8Q0.8 0 2 0Q3.8 0 3.8 1.5Q3.8 3 2 3Q4 3 4 4.5Q4 6 2 6Q0.6 6 0 5.2',
  '4': 'M3 6V0L0 4.2H4',
  '5': 'M3.8 0H0.4L0.2 2.8Q0.9 2.3 2 2.3Q4 2.3 4 4.1Q4 6 2 6Q0.6 6 0 5.2',
  '6': 'M3.6 0.6Q3 0 2 0Q0 0 0 3.6Q0 6 2 6Q4 6 4 4.1Q4 2.4 2 2.4Q0.6 2.4 0 3.6',
  '7': 'M0 0H4L1.4 6',
  '8': 'M2 3Q0.2 3 0.2 1.5Q0.2 0 2 0Q3.8 0 3.8 1.5Q3.8 3 2 3Q0 3 0 4.5Q0 6 2 6Q4 6 4 4.5Q4 3 2 3Z',
  '9': 'M4 2.4Q3.4 3.6 2 3.6Q0 3.6 0 1.9Q0 0 2 0Q4 0 4 2.4Q4 6 2 6Q1 6 0.4 5.4',
  '!': 'M2 0V4.2M2 5.6V6',
  '?': 'M0.2 1.2Q0.6 0 2 0Q4 0 4 1.6Q4 2.6 2 3.4V4.3M2 5.6V6',
  '.': 'M2 5.6V6',
  '-': 'M0.8 3H3.2',
  '+': 'M0.6 3H3.4M2 1.6V4.4',
  '#': 'M1.3 0.6L0.7 5.4M3.3 0.6L2.7 5.4M0.2 2H3.9M0 4H3.7',
  '&': 'M4 6L1 2.2Q0.4 1.4 0.8 0.7Q1.6 -0.3 2.6 0.6Q3.2 1.4 2.4 2.2L0.6 3.8Q-0.2 5.2 1.2 5.9Q2.4 6.3 3.8 4.2',
  ' ': '',
}

const ADVANCE = 5.2

export interface TextPath {
  d: string
  width: number
  height: number
}

/** Path data for text drawn at `size` (cap height) starting at x, baseline-top at y. */
export function strokeText(text: string, x: number, y: number, size: number): TextPath {
  const s = size / 6
  let d = ''
  let cx = 0
  for (const ch of text.toUpperCase()) {
    const glyph = G[ch]
    if (glyph === undefined) {
      cx += ADVANCE
      continue
    }
    d += glyph.replace(/([MLHVQZ])([^MLHVQZ]*)/g, (_m, cmd: string, args: string) => {
      const nums = args.trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (cmd === 'Z') return 'Z'
      if (cmd === 'H') return 'H' + (x + (nums[0] + cx) * s).toFixed(2)
      if (cmd === 'V') return 'V' + (y + nums[0] * s).toFixed(2)
      const out: string[] = []
      for (let i = 0; i < nums.length; i += 2) out.push(`${(x + (nums[i] + cx) * s).toFixed(2)} ${(y + nums[i + 1] * s).toFixed(2)}`)
      return cmd + out.join(' ')
    })
    cx += ADVANCE
  }
  const width = Math.max(0, cx - (ADVANCE - 4)) * s
  return { d, width, height: size }
}

/** Centered text that fits `maxWidth`. */
export function fitText(text: string, cx: number, cy: number, size: number, maxWidth: number): TextPath & { size: number } {
  const probe = strokeText(text, 0, 0, size)
  const k = probe.width > maxWidth ? maxWidth / probe.width : 1
  const s2 = size * k
  const t = strokeText(text, 0, 0, s2)
  return { ...strokeText(text, cx - t.width / 2, cy - s2 / 2, s2), size: s2 }
}

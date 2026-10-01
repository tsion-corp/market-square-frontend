/* Bit-level building blocks of the A2 share-code format (dna/packed.ts).
 *
 * Everything is MSB-first. The integer codes are the classic ones from video codecs:
 *   - Exp-Golomb of order k (`eg`): small numbers are short, any number fits. Order 0
 *     spends 1 bit on 0, 3 bits on 1–2, 5 bits on 3–6 …; order k adds k raw low bits,
 *     which suits indices into a list of about 2^k entries.
 *   - zigzag (`zz`): signed → unsigned (0, -1, 1, -2, 2 … → 0, 1, 2, 3, 4 …) before EG.
 *   - truncated binary (`tb`): a value in [0, n) in ⌊log2 n⌋ or ⌈log2 n⌉ bits, for numbers
 *     with a known bound (slider positions).
 * Strings are WTF-8 (UTF-8 that also carries lone surrogates), so any JS string, including a
 * name cut in the middle of an emoji, comes back exactly. Pure, no DOM, no Node APIs. */

/** A read past the end or an impossible value: the bytes are not a valid stream. */
export class BitsError extends Error {}

/** Exp-Golomb prefixes longer than this are refused (values stay far below 2^53). */
const MAX_EG_ZEROS = 48

/** Bits needed to write `n` with Exp-Golomb of order `k`. */
export function egLength(n: number, k = 0): number {
  let q = Math.floor(n / 2 ** k) + 1
  let len = 1
  while (q > 1) {
    q = Math.floor(q / 2)
    len += 2
  }
  return len + k
}

export const zigzag = (n: number): number => (n >= 0 ? 2 * n : -2 * n - 1)
export const unzigzag = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2)

export class BitWriter {
  buf = new Uint8Array(128)
  /** Bits written so far. */
  length = 0

  bit(b: boolean | number): void {
    const byte = this.length >> 3
    if (byte >= this.buf.length) {
      const grown = new Uint8Array(this.buf.length * 2)
      grown.set(this.buf)
      this.buf = grown
    }
    if (b) this.buf[byte] |= 0x80 >> (this.length & 7)
    this.length++
  }

  /** `value` (a non-negative integer below 2^count) in exactly `count` bits, count ≤ 53. */
  uint(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bit(Math.floor(value / 2 ** i) % 2)
  }

  /** Exp-Golomb, order k. */
  eg(n: number, k = 0): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`eg: ${n} is not a non-negative integer`)
    const q = Math.floor(n / 2 ** k)
    const m = q + 1
    let zeros = 0
    while (2 ** (zeros + 1) <= m) zeros++
    for (let i = 0; i < zeros; i++) this.bit(0)
    this.uint(m, zeros + 1)
    this.uint(n - q * 2 ** k, k)
  }

  /** Signed integer: zigzag, then Exp-Golomb. */
  zz(n: number, k = 0): void {
    this.eg(zigzag(n), k)
  }

  /** Truncated binary: `x` in [0, n). */
  tb(x: number, n: number): void {
    if (!Number.isSafeInteger(x) || x < 0 || x >= n) throw new RangeError(`tb: ${x} is not in [0, ${n})`)
    let k = 0
    while (2 ** (k + 1) <= n) k++
    const u = 2 ** (k + 1) - n
    if (x < u) this.uint(x, k)
    else this.uint(x + u, k + 1)
  }

  /** An IEEE 754 double, bit for bit. */
  f64(x: number): void {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, x)
    for (let i = 0; i < 8; i++) this.uint(view.getUint8(i), 8)
  }

  /** Exp-Golomb byte count, then the bytes. */
  bytes(b: Uint8Array): void {
    this.eg(b.length)
    for (const x of b) this.uint(x, 8)
  }

  str(s: string): void {
    this.bytes(wtf8Encode(s))
  }

  /** The bits so far, zero-padded to whole bytes. */
  finish(): Uint8Array {
    return this.buf.slice(0, (this.length + 7) >> 3)
  }
}

export class BitReader {
  buf: Uint8Array
  pos = 0
  end: number

  constructor(buf: Uint8Array) {
    this.buf = buf
    this.end = buf.length * 8
  }

  get remaining(): number {
    return this.end - this.pos
  }

  bit(): number {
    if (this.pos >= this.end) throw new BitsError('Unexpected end of data.')
    const b = (this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1
    this.pos++
    return b
  }

  uint(count: number): number {
    if (count > this.remaining) throw new BitsError('Unexpected end of data.')
    let v = 0
    for (let i = 0; i < count; i++) v = v * 2 + this.bit()
    return v
  }

  eg(k = 0): number {
    let zeros = 0
    while (this.bit() === 0) if (++zeros > MAX_EG_ZEROS) throw new BitsError('Number too large.')
    const m = 2 ** zeros + this.uint(zeros)
    return (m - 1) * 2 ** k + this.uint(k)
  }

  zz(k = 0): number {
    return unzigzag(this.eg(k))
  }

  tb(n: number): number {
    let k = 0
    while (2 ** (k + 1) <= n) k++
    const u = 2 ** (k + 1) - n
    const x = this.uint(k)
    return x < u ? x : x * 2 + this.bit() - u
  }

  f64(): number {
    const view = new DataView(new ArrayBuffer(8))
    for (let i = 0; i < 8; i++) view.setUint8(i, this.uint(8))
    return view.getFloat64(0)
  }

  bytes(): Uint8Array {
    const n = this.eg()
    if (n * 8 > this.remaining) throw new BitsError('Unexpected end of data.')
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = this.uint(8)
    return out
  }

  str(): string {
    return wtf8Decode(this.bytes())
  }

  /** True when only zero padding (less than a byte) is left. */
  atPaddedEnd(): boolean {
    if (this.remaining >= 8) return false
    while (this.pos < this.end) if (this.bit()) return false
    return true
  }
}

/* ---- WTF-8 ------------------------------------------------------------ */

/** UTF-8, except that a lone surrogate is kept (as its 3-byte form) instead of becoming U+FFFD. */
export function wtf8Encode(s: string): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + (c - 0xd800) * 0x400 + (d - 0xdc00)
        i++
      }
    }
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return Uint8Array.from(out)
}

export function wtf8Decode(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; ) {
    const x = b[i]
    let c: number
    let n: number
    let min: number
    if (x < 0x80) [c, n, min] = [x, 0, 0]
    else if (x >= 0xc2 && x < 0xe0) [c, n, min] = [x & 0x1f, 1, 0x80]
    else if (x >= 0xe0 && x < 0xf0) [c, n, min] = [x & 0x0f, 2, 0x800]
    else if (x >= 0xf0 && x < 0xf5) [c, n, min] = [x & 0x07, 3, 0x10000]
    else throw new BitsError('Invalid text.')
    if (i + n >= b.length) throw new BitsError('Invalid text.')
    for (let j = 1; j <= n; j++) {
      const y = b[i + j]
      if ((y & 0xc0) !== 0x80) throw new BitsError('Invalid text.')
      c = c * 64 + (y & 63)
    }
    if (c < min || c > 0x10ffff) throw new BitsError('Invalid text.')
    s += c >= 0x10000 ? String.fromCodePoint(c) : String.fromCharCode(c)
    i += n + 1
  }
  return s
}

/* ---- Integrity --------------------------------------------------------- */

/** CRC-16/GENIBUS: the CCITT polynomial 0x1021, init 0xffff, output inverted. It catches
 *  every error burst of up to 16 bits, so any single mistyped base64 character (6 bits) is
 *  always detected; the inverted output also refuses zero bytes appended to a valid code
 *  (a plain CCITT-FALSE check would still match those). */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc ^ 0xffff
}

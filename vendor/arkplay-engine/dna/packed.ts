/* A2: the compact DNA (codec.ts `compactDNA`) as a schema-driven bitstream.
 *
 * Exactly lossless: `unpackCompact(packCompact(c))` has the same canonical JSON as `c`, so
 * an A2 code has the same `dnaHash` as the avatar it came from. Ids are codebook positions
 * (codebook.ts), values are written in the fewest bits their type allows, and a CRC-16
 * rides at the end. Layout, MSB-first (EG = Exp-Golomb, EGk = order k, TB = truncated binary):
 *
 *   EG    v - 1                       DNA version
 *   1     kind                        0 humanoid, 1 creature
 *   32    seed                        uint32
 *   1     gridFirst                   which range mode gets the 1-bit prefix (see range)
 *   str   name                        EG byte count + WTF-8 bytes ('' when unnamed)
 *   1     has species                 then EGk(speciesK) species wire index (0 → str id)
 *   seq   sections                    each: params seq (below)
 *   EG    outfit count, then items;   EG accessories count, then items
 *   ---   zero padding to a byte, then CRC-16/GENIBUS of the bytes before it (2 bytes)
 *
 * seq (sections, and the params of a section or item): EG count, then per entry sorted by
 * wire index (literal entries first): EG gap (the first index as is while the previous one
 * is 0, otherwise index - previous - 1), `str` id when the index is 0, then the entry.
 *
 * item: EGk(itemK) wire index (0 → str id), params seq, 1 bit has-asset, then the asset:
 *   id    1 + EG(len-1) + base-36 digits (TB 36) for `as_[a-z0-9]+`, else 0 + str
 *   w, h  0 + EG8(int) | 10 + f64 | 11 absent
 *   px,py 0 absent | 10 + TB(10001) on the 1e-4 grid | 11 + f64
 *
 * Param values (codebook-keyed; the entry says the type):
 *   range   in 1e-4 units V. Within the snapshotted [min, max]: grid mode TB over
 *           (V - min) / unit, fine mode TB over V - min. gridFirst ? 0 grid, 10 fine :
 *           0 fine, 10 grid. Escape 11: 0 + zigzag-EG(V - default) | 1 + f64.
 *   color   0 palette-local EGk | 10 #rrggbb 24 bits | 110 back-reference EG (position in
 *           the most-recently-used list of colours this code already wrote) | 1110 global
 *           colour EGk(colorK) | 11110 #rgb 12 bits | 11111 '' (auto). Cheapest wins.
 *   choice  EGk(list k) option wire index (0 → str id).
 *   toggle  1 bit.   text  str.
 * Literal-keyed params (a key the book doesn't have, or a value its entry can't hold) carry
 * a type tag: 00 number (0 + zigzag-EG of the 1e-4 value | 1 + f64), 01 str, 10 false, 11 true.
 *
 * The encoder tries both `gridFirst` settings and keeps the shorter code. */

import { BitReader, BitsError, BitWriter, crc16, egLength } from './bits.ts'
import { codebook, type Codebook, type ColorEntry, type Group, type ParamEntry, type RangeEntry } from './codebook.ts'

export type PackFailure = 'typo' | 'damaged' | 'newer'

/** Why a byte string isn't a valid A2 avatar. */
export class PackError extends Error {
  reason: PackFailure
  constructor(reason: PackFailure, message = reason) {
    super(message)
    this.reason = reason
  }
}

type Obj = Record<string, unknown>

const HEX6 = /^#[0-9a-f]{6}$/
const HEX3 = /^#[0-9a-f]{3}$/
const ASSET = /^as_([a-z0-9]+)$/
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
/** Beyond this, a 1e-4 integer goes out as a raw double instead (EG stays exact). */
const MAX_FIXED = 2 ** 40

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** `o[key] = v` as an own property, even for a crafted key such as `__proto__` (the same
 *  thing JSON.parse does for A1). */
function setOwn(o: Obj, key: string, v: unknown): void {
  Object.defineProperty(o, key, { value: v, enumerable: true, writable: true, configurable: true })
}

/** The value in 1e-4 units when it sits exactly on that grid (what `coerce` stores). */
function fixed(v: number): number | undefined {
  if (!Number.isFinite(v)) return undefined
  const V = Math.round(v * 10000)
  return Math.abs(V) < MAX_FIXED && V / 10000 === v ? V : undefined
}

const byWire = <T extends { wire: number; id: string }>(a: T, b: T): number => a.wire - b.wire || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/* ---- Encoding ------------------------------------------------------------ */

interface Enc {
  w: BitWriter
  book: Codebook
  gridFirst: boolean
  /** Colours written so far, most recent first. */
  recent: string[]
}

/** Writes a sorted sequence: count, then gap-coded wire indices (0 = literal id). */
function writeSeq<T extends { wire: number; id: string }>(w: BitWriter, list: T[], each: (t: T) => void): void {
  list.sort(byWire)
  w.eg(list.length)
  let prev = 0
  for (const t of list) {
    w.eg(prev === 0 ? t.wire : t.wire - prev - 1)
    if (t.wire === 0) w.str(t.id)
    each(t)
    prev = t.wire
  }
}

/** Can this codebook entry hold this value exactly? Otherwise the param goes literal. */
function fits(entry: ParamEntry, v: unknown): boolean {
  switch (entry[1]) {
    case 'range':
      return typeof v === 'number'
    case 'color':
      return typeof v === 'string' && (v === '' || HEX6.test(v) || HEX3.test(v))
    case 'choice':
    case 'text':
      return typeof v === 'string'
    case 'toggle':
      return typeof v === 'boolean'
  }
}

function writeRange(e: Enc, [, , def, min, max, unit]: RangeEntry, v: number): void {
  const { w } = e
  const V = fixed(v)
  if (V !== undefined && V >= min && V <= max) {
    const off = V - min
    const grid = off % unit === 0
    if (grid === e.gridFirst) w.bit(0)
    else w.uint(0b10, 2)
    if (grid) w.tb(off / unit, Math.floor((max - min) / unit) + 1)
    else w.tb(off, max - min + 1)
    return
  }
  w.uint(0b11, 2)
  if (V !== undefined) {
    w.bit(0)
    w.zz(V - def)
  } else {
    w.bit(1)
    w.f64(v)
  }
}

function writeColor(e: Enc, entry: ColorEntry, v: string): void {
  const { w, book } = e
  if (v === '') return w.uint(0b11111, 5)
  const g = book.colorIndex.get(v)
  const pal = book.palettes.get(entry[3])
  const local = g !== undefined ? pal?.local.get(g) : undefined
  const pos = e.recent.indexOf(v)
  const options: [cost: number, write: () => void][] = []
  if (local !== undefined && pal) options.push([1 + egLength(local, pal.k), () => (w.bit(0), w.eg(local, pal.k))])
  if (HEX6.test(v)) options.push([26, () => (w.uint(0b10, 2), w.uint(parseInt(v.slice(1), 16), 24))])
  if (pos >= 0) options.push([3 + egLength(pos), () => (w.uint(0b110, 3), w.eg(pos))])
  if (g !== undefined) options.push([4 + egLength(g, book.data.colorK), () => (w.uint(0b1110, 4), w.eg(g, book.data.colorK))])
  if (HEX3.test(v)) options.push([17, () => (w.uint(0b11110, 5), w.uint(parseInt(v.slice(1), 16), 12))])
  let best = options[0]
  for (const o of options) if (o[0] < best[0]) best = o
  best[1]()
  if (pos >= 0) e.recent.splice(pos, 1)
  e.recent.unshift(v)
}

function writeValue(e: Enc, entry: ParamEntry, v: unknown): void {
  const { w, book } = e
  switch (entry[1]) {
    case 'range':
      return writeRange(e, entry, v as number)
    case 'color':
      return writeColor(e, entry, v as string)
    case 'choice': {
      const list = book.lists[entry[3]]
      const wire = list.wire.get(v as string) ?? 0
      w.eg(wire, list.k)
      if (wire === 0) w.str(v as string)
      return
    }
    case 'toggle':
      return w.bit(v as boolean)
    case 'text':
      return w.str(v as string)
  }
}

function writeLiteral(w: BitWriter, v: unknown): void {
  if (typeof v === 'number') {
    w.uint(0b00, 2)
    const V = fixed(v)
    if (V !== undefined) {
      w.bit(0)
      w.zz(V)
    } else {
      w.bit(1)
      w.f64(v)
    }
  } else if (typeof v === 'string') {
    w.uint(0b01, 2)
    w.str(v)
  } else if (typeof v === 'boolean') w.uint(v ? 0b11 : 0b10, 2)
  else throw new TypeError(`A2: can't encode the param value ${JSON.stringify(v)}`)
}

function writeParams(e: Enc, group: Group | undefined, params: unknown): void {
  const entries = Object.entries(isObj(params) ? params : {})
    .filter(([, v]) => v !== undefined)
    .map(([id, v]) => {
      const wire = group?.keys.get(id) ?? 0
      return { id, v, wire: wire && fits(group!.params[wire - 1], v) ? wire : 0 }
    })
  writeSeq(e.w, entries, (p) => (p.wire ? writeValue(e, group!.params[p.wire - 1], p.v) : writeLiteral(e.w, p.v)))
}

function writeSize(w: BitWriter, v: unknown): void {
  if (v === undefined) w.uint(0b11, 2)
  else if (typeof v !== 'number') throw new TypeError(`A2: an asset size must be a number, not ${JSON.stringify(v)}`)
  else if (Number.isSafeInteger(v) && v >= 0 && v < MAX_FIXED) {
    w.bit(0)
    w.eg(v, 8)
  } else {
    w.uint(0b10, 2)
    w.f64(v)
  }
}

function writePivot(w: BitWriter, v: unknown): void {
  if (v === undefined) return w.bit(0)
  if (typeof v !== 'number') throw new TypeError(`A2: an asset pivot must be a number, not ${JSON.stringify(v)}`)
  const V = fixed(v)
  if (V !== undefined && V >= 0 && V <= 10000) {
    w.uint(0b10, 2)
    w.tb(V, 10001)
  } else {
    w.uint(0b11, 2)
    w.f64(v)
  }
}

function writeAsset(w: BitWriter, a: Obj): void {
  if (typeof a.id !== 'string') throw new TypeError('A2: an item asset needs a string id')
  const m = ASSET.exec(a.id)
  if (m) {
    w.bit(1)
    w.eg(m[1].length - 1)
    for (const ch of m[1]) w.tb(B36.indexOf(ch), 36)
  } else {
    w.bit(0)
    w.str(a.id)
  }
  writeSize(w, a.w)
  writeSize(w, a.h)
  writePivot(w, a.px)
  writePivot(w, a.py)
}

function writeItem(e: Enc, item: unknown): void {
  const { w, book } = e
  if (!isObj(item) || typeof item.id !== 'string') throw new TypeError('A2: an item needs a string id')
  const wire = book.itemWire.get(item.id) ?? 0
  w.eg(wire, book.data.itemK)
  if (wire === 0) w.str(item.id)
  writeParams(e, wire ? book.items[wire - 1] : undefined, item.p)
  if (isObj(item.a)) {
    w.bit(1)
    writeAsset(w, item.a)
  } else w.bit(0)
}

function writeCompact(e: Enc, c: Obj): void {
  const { w, book } = e
  const v = c.v
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) throw new TypeError(`A2: bad DNA version ${JSON.stringify(v)}`)
  const seed = c.s
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError(`A2: the seed must be a uint32, not ${JSON.stringify(seed)}`)
  w.eg(v - 1)
  w.bit(c.k === 'c')
  w.uint(seed, 32)
  w.bit(e.gridFirst)
  w.str(typeof c.n === 'string' ? c.n : '')
  if (typeof c.sp === 'string' && c.sp) {
    w.bit(1)
    const wire = book.speciesWire.get(c.sp) ?? 0
    w.eg(wire, book.data.speciesK)
    if (wire === 0) w.str(c.sp)
  } else w.bit(0)

  const sections = Object.entries(isObj(c.x) ? c.x : {})
    .filter(([, p]) => isObj(p) && Object.values(p).some((x) => x !== undefined))
    .map(([id, p]) => ({ id, p, wire: book.sectionWire.get(id) ?? 0 }))
  writeSeq(w, sections, (s) => writeParams(e, s.wire ? book.sections[s.wire - 1] : undefined, s.p))

  for (const list of [c.o, c.a]) {
    const items = Array.isArray(list) ? list : []
    w.eg(items.length)
    for (const it of items) writeItem(e, it)
  }
}

/** The compact DNA as A2 bytes (payload + CRC-16). `book` is for tests; the default is the
 *  committed codebook. */
export function packCompact(c: Obj, book: Codebook = codebook()): Uint8Array {
  let best: BitWriter | undefined
  for (const gridFirst of [false, true]) {
    const w = new BitWriter()
    writeCompact({ w, book, gridFirst, recent: [] }, c)
    if (!best || w.length < best.length) best = w
  }
  const payload = best!.finish()
  const crc = crc16(payload)
  const out = new Uint8Array(payload.length + 2)
  out.set(payload)
  out[payload.length] = crc >> 8
  out[payload.length + 1] = crc & 0xff
  return out
}

/* ---- Decoding ------------------------------------------------------------ */

/** A value this codebook has no entry for yet (a newer option or colour): it is left out, so
 *  the param falls back to its default. */
const UNKNOWN: unique symbol = Symbol('unknown')
type Decoded = unknown | typeof UNKNOWN

interface Dec {
  r: BitReader
  book: Codebook
  gridFirst: boolean
  recent: (string | typeof UNKNOWN)[]
  /** A colour came back UNKNOWN: back-references can't be trusted from here on. */
  tainted: boolean
  /** Something was skipped because it is newer than this codebook. */
  unknown: boolean
}

const newer = (): PackError => new PackError('newer')
const damaged = (): PackError => new PackError('damaged')

function readSeq(r: BitReader, each: (wire: number, id: string | undefined) => void): void {
  const n = r.eg()
  let prev = 0
  for (let i = 0; i < n; i++) {
    const wire = prev === 0 ? r.eg() : prev + 1 + r.eg()
    each(wire, wire === 0 ? r.str() : undefined)
    prev = wire
  }
}

function readRange(d: Dec, [, , def, min, max, unit]: RangeEntry): number {
  const { r } = d
  let grid: boolean
  if (r.bit() === 0) grid = d.gridFirst
  else if (r.bit() === 0) grid = !d.gridFirst
  else return r.bit() === 0 ? (def + r.zz()) / 10000 : r.f64()
  const V = grid ? min + r.tb(Math.floor((max - min) / unit) + 1) * unit : min + r.tb(max - min + 1)
  return V / 10000
}

function readColor(d: Dec, entry: ColorEntry): Decoded {
  const { r, book } = d
  let v: string | typeof UNKNOWN
  let pos = -1
  if (r.bit() === 0) {
    const pal = book.palettes.get(entry[3])
    if (!pal) throw damaged()
    const i = r.eg(pal.k)
    v = i < pal.colors.length ? book.data.colors[pal.colors[i]] : UNKNOWN
  } else if (r.bit() === 0) v = '#' + r.uint(24).toString(16).padStart(6, '0')
  else if (r.bit() === 0) {
    pos = r.eg()
    if (pos >= d.recent.length) throw damaged()
    // After a colour this book doesn't know, the recency list may no longer match the
    // encoder's, so back-references are dropped rather than risk the wrong colour.
    v = d.tainted ? UNKNOWN : d.recent[pos]
  } else if (r.bit() === 0) {
    const g = r.eg(book.data.colorK)
    v = g < book.data.colors.length ? book.data.colors[g] : UNKNOWN
  } else if (r.bit() === 0) v = '#' + r.uint(12).toString(16).padStart(3, '0')
  else return ''
  if (v === UNKNOWN) d.tainted = true
  // Same move-to-front as the encoder: drop the earlier copy, put this one first.
  if (pos < 0 && v !== UNKNOWN) pos = d.recent.indexOf(v)
  if (pos >= 0) d.recent.splice(pos, 1)
  d.recent.unshift(v)
  return v
}

function readValue(d: Dec, entry: ParamEntry): Decoded {
  const { r, book } = d
  switch (entry[1]) {
    case 'range':
      return readRange(d, entry)
    case 'color':
      return readColor(d, entry)
    case 'choice': {
      const list = book.lists[entry[3]]
      if (!list) throw damaged()
      const wire = r.eg(list.k)
      if (wire === 0) return r.str()
      return wire <= list.ids.length ? list.ids[wire - 1] : UNKNOWN
    }
    case 'toggle':
      return r.bit() === 1
    case 'text':
      return r.str()
  }
}

function readLiteral(r: BitReader): unknown {
  switch (r.uint(2)) {
    case 0b00:
      return r.bit() === 0 ? r.zz() / 10000 : r.f64()
    case 0b01:
      return r.str()
    case 0b10:
      return false
    default:
      return true
  }
}

function readParams(d: Dec, group: Group | undefined): Obj {
  const out: Obj = {}
  readSeq(d.r, (wire, id) => {
    if (id !== undefined) {
      setOwn(out, id, readLiteral(d.r))
      return
    }
    // A key this book doesn't have: its value can't even be skipped.
    const entry = group?.params[wire - 1]
    if (!entry) throw group ? newer() : damaged()
    const v = readValue(d, entry)
    if (v === UNKNOWN) d.unknown = true
    else out[entry[0]] = v
  })
  return out
}

function readSize(r: BitReader): number | undefined {
  if (r.bit() === 0) return r.eg(8)
  return r.bit() === 0 ? r.f64() : undefined
}

function readPivot(r: BitReader): number | undefined {
  if (r.bit() === 0) return undefined
  return r.bit() === 0 ? r.tb(10001) / 10000 : r.f64()
}

function readAsset(r: BitReader): Obj {
  let id: string
  if (r.bit() === 1) {
    const n = r.eg() + 1
    if (n * 5 > r.remaining) throw damaged()
    id = 'as_'
    for (let i = 0; i < n; i++) id += B36[r.tb(36)]
  } else id = r.str()
  const a: Obj = { id }
  for (const k of ['w', 'h'] as const) {
    const v = readSize(r)
    if (v !== undefined) a[k] = v
  }
  for (const k of ['px', 'py'] as const) {
    const v = readPivot(r)
    if (v !== undefined) a[k] = v
  }
  return a
}

function readItem(d: Dec): Obj {
  const { r, book } = d
  const wire = r.eg(book.data.itemK)
  let group: Group | undefined
  let id: string
  if (wire === 0) id = r.str()
  else {
    group = book.items[wire - 1]
    if (!group) throw newer()
    id = group.id
  }
  const item: Obj = { id }
  const p = readParams(d, group)
  if (Object.keys(p).length) item.p = p
  if (r.bit() === 1) item.a = readAsset(r)
  return item
}

function readCompact(d: Dec): Obj {
  const { r, book } = d
  const c: Obj = {}
  c.v = r.eg() + 1
  c.k = r.bit() ? 'c' : 'h'
  c.s = r.uint(32)
  d.gridFirst = r.bit() === 1
  const name = r.str()
  if (name) c.n = name
  if (r.bit() === 1) {
    const wire = r.eg(book.data.speciesK)
    if (wire === 0) c.sp = r.str()
    else if (wire <= book.data.species.length) c.sp = book.data.species[wire - 1]
    else d.unknown = true
  }
  const x: Obj = {}
  readSeq(r, (wire, id) => {
    let group: Group | undefined
    if (id === undefined) {
      group = book.sections[wire - 1]
      if (!group) throw newer()
    }
    setOwn(x, id ?? group!.id, readParams(d, group))
  })
  if (Object.keys(x).length) c.x = x
  for (const key of ['o', 'a'] as const) {
    const n = r.eg()
    const items: Obj[] = []
    for (let i = 0; i < n; i++) items.push(readItem(d))
    if (items.length) c[key] = items
  }
  return c
}

/** A2 bytes back to the compact DNA. Throws PackError: 'typo' (the CRC doesn't match: a
 *  mistyped or cut-off code), 'damaged' (a valid CRC around an impossible stream) or
 *  'newer' (a section, param or item this codebook doesn't have yet). `warn` hears about
 *  values that were skipped because they are newer than this codebook. */
export function unpackCompact(bytes: Uint8Array, warn?: (m: string) => void, book: Codebook = codebook()): Obj {
  if (bytes.length < 3) throw new PackError('typo')
  const payload = bytes.subarray(0, bytes.length - 2)
  const crc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1]
  if (crc16(payload) !== crc) throw new PackError('typo')
  const d: Dec = { r: new BitReader(payload), book, gridFirst: false, recent: [], tainted: false, unknown: false }
  let c: Obj
  try {
    c = readCompact(d)
  } catch (e) {
    if (e instanceof BitsError) throw damaged()
    throw e
  }
  if (!d.r.atPaddedEnd()) throw damaged()
  if (d.unknown) warn?.('This avatar code uses options this version does not know yet, so some of them were reset.')
  return c
}

/* The A2 share-code codebook: every id an A2 code can mention, as a small number.
 *
 * An A2 code (dna/packed.ts) never spells out "hair", "style" or "hoodie"; it writes their
 * position in this book. Positions must therefore mean the same thing forever, so the book
 * is APPEND-ONLY:
 *   - never reorder, rename or delete an entry, and never change a `k` or a snapshot value;
 *   - `npm run codebook -w @arkplay/avatar-engine` appends whatever the live schema added
 *     (a param, choice option, item, species or palette colour); `--check` verifies it;
 *   - the data lives in the generated `codebook.data.ts`. Don't edit it by hand.
 *
 * Decoding depends only on the book, never on the schema's current order (only ids and
 * defaults are frozen, not order). So each param entry snapshots what decoding needs at the
 * moment it was registered:
 *   range  [key, 'range', default, min, max, unit]  numbers in 1e-4 units; unit = step × 10000
 *   color  [key, 'color', default, paletteId]
 *   choice [key, 'choice', default, listIndex]       option ids live in `lists` (shared, append-only)
 *   toggle [key, 'toggle', default]
 *   text   [key, 'text', default]
 * Defaults are recorded so `npm run codebook` can refuse a changed default (they're frozen).
 *
 * Wire indices: sections, param keys, items, species and choice options are written as
 * position + 1, and 0 means "the literal id follows". So an encoder with an out-of-date book
 * still works; it just spends more bits. Colours use a tagged code instead (packed.ts),
 * whose raw forms play the same role, so colour and palette indices are 0-based.
 *
 * Exp-Golomb orders (`k`) are fixed when a list is created, as ⌊log2(entries + 1)⌋: a list
 * of about 2^k entries then costs k+1 bits per index, and growing it never changes how old
 * codes read. */

import { CODEBOOK_DATA } from './codebook.data.ts'

export type RangeEntry = readonly [key: string, type: 'range', def: number, min: number, max: number, unit: number]
export type ColorEntry = readonly [key: string, type: 'color', def: string, palette: string]
export type ChoiceEntry = readonly [key: string, type: 'choice', def: string, list: number]
export type ToggleEntry = readonly [key: string, type: 'toggle', def: boolean]
export type TextEntry = readonly [key: string, type: 'text', def: string]
export type ParamEntry = RangeEntry | ColorEntry | ChoiceEntry | ToggleEntry | TextEntry

export interface PaletteEntry {
  readonly id: string
  readonly k: number
  /** Indices into `colors`. */
  readonly colors: readonly number[]
}

export interface OptionList {
  readonly k: number
  readonly ids: readonly string[]
}

/** A section or an item: its id and its params, in registration order. */
export interface GroupEntry {
  readonly id: string
  readonly params: readonly ParamEntry[]
}

export interface CodebookData {
  readonly format: 1
  readonly colorK: number
  readonly itemK: number
  readonly speciesK: number
  /** Common colours, lower-case `#rrggbb` (every palette colour in core/color.ts). */
  readonly colors: readonly string[]
  readonly palettes: readonly PaletteEntry[]
  readonly lists: readonly OptionList[]
  readonly sections: readonly GroupEntry[]
  readonly items: readonly GroupEntry[]
  readonly species: readonly string[]
}

/** A section or item with its key → wire index lookup. */
export interface Group extends GroupEntry {
  readonly keys: ReadonlyMap<string, number>
}

export interface Palette extends PaletteEntry {
  /** Global colour index → position in this palette. */
  readonly local: ReadonlyMap<number, number>
}

export interface Options extends OptionList {
  readonly wire: ReadonlyMap<string, number>
}

/** The book with its lookup tables. */
export interface Codebook {
  readonly data: CodebookData
  readonly sections: readonly Group[]
  readonly sectionWire: ReadonlyMap<string, number>
  readonly items: readonly Group[]
  readonly itemWire: ReadonlyMap<string, number>
  readonly speciesWire: ReadonlyMap<string, number>
  readonly colorIndex: ReadonlyMap<string, number>
  readonly palettes: ReadonlyMap<string, Palette>
  readonly lists: readonly Options[]
}

/** id → position + 1 (the first occurrence wins). */
function wireMap(ids: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  ids.forEach((id, i) => {
    if (!m.has(id)) m.set(id, i + 1)
  })
  return m
}

const group = (g: GroupEntry): Group => ({ ...g, keys: wireMap(g.params.map((p) => p[0])) })

export function buildCodebook(data: CodebookData): Codebook {
  const colorIndex = new Map<string, number>()
  data.colors.forEach((c, i) => {
    if (!colorIndex.has(c)) colorIndex.set(c, i)
  })
  const palettes = new Map<string, Palette>()
  for (const p of data.palettes) {
    const local = new Map<number, number>()
    p.colors.forEach((g, i) => {
      if (!local.has(g)) local.set(g, i)
    })
    palettes.set(p.id, { ...p, local })
  }
  return {
    data,
    sections: data.sections.map(group),
    sectionWire: wireMap(data.sections.map((s) => s.id)),
    items: data.items.map(group),
    itemWire: wireMap(data.items.map((s) => s.id)),
    speciesWire: wireMap(data.species),
    colorIndex,
    palettes,
    lists: data.lists.map((l) => ({ ...l, wire: wireMap(l.ids) })),
  }
}

let built: Codebook | undefined

/** The committed codebook (lookup tables are built on first use). */
export const codebook = (): Codebook => (built ??= buildCodebook(CODEBOOK_DATA))

/* The context every part generator receives: the DNA read through typed helpers, the
 * rig, the painter, forked randomness, and the resolved items. */

import type { Box } from '../core/math.ts'
import { createRng, type Rng } from '../core/rng.ts'
import { Defs } from '../core/svg.ts'
import type { Params } from '../dna/params.ts'
import { baseItemId, itemSpec, sectionSpec, type ItemSpec, type SlotId } from '../dna/schema/index.ts'
import type { AvatarDNA, ItemRef } from '../dna/types.ts'
import type { HumanRig } from '../rig/humanoid.ts'
import type { Skeleton } from '../rig/skeleton.ts'
import type { CreatureRig } from '../rig/creature.ts'
import { lightVector, Painter, sceneRig, type AutoMaterial, type Grade, type InkMode, type LightRig, type Material, type Shading, type StyleState } from './painter.ts'
import type { Part, Side, View } from './types.ts'

export interface Reader {
  readonly raw: Params
  n(key: string): number
  s(key: string): string
  b(key: string): boolean
  /** Colour; an empty ("automatic") value resolves to `fallback`. */
  c(key: string, fallback?: string): string
  has(key: string): boolean
}

export function reader(params: Params | undefined, defaults: Params = {}): Reader {
  const p = { ...defaults, ...(params ?? {}) }
  return {
    raw: p,
    n: (k) => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k]) || 0),
    s: (k) => (p[k] === undefined ? '' : String(p[k])),
    b: (k) => p[k] === true,
    c: (k, fallback = '#888888') => (typeof p[k] === 'string' && p[k] ? (p[k] as string) : fallback),
    has: (k) => p[k] !== undefined && p[k] !== '',
  }
}

export interface ResolvedItem {
  ref: ItemRef
  spec: ItemSpec
  /** The art id (held items in the left hand share the right-hand art). */
  art: string
  p: Reader
  index: number
}

export class PartList {
  readonly parts: Part[] = []
  add(bone: string, z: number, id: string, svg: string, dynamic = false, bounds?: Box): void {
    if (svg) this.parts.push(bounds ? { id, bone, z, svg, dynamic, bounds } : { id, bone, z, svg, dynamic })
  }
}

export interface Ctx {
  readonly dna: AvatarDNA
  readonly view: View
  readonly paint: Painter
  readonly defs: Defs
  readonly skel: Skeleton
  readonly hr?: HumanRig
  readonly cr?: CreatureRig
  readonly items: ResolvedItem[]
  sec(id: string): Reader
  rng(label: string): Rng
  item(slot: SlotId): ResolvedItem | undefined
  itemsIn(slot: SlotId): ResolvedItem[]
  has(artId: string): boolean
  hides(what: 'hair' | 'hairTop' | 'hairBack' | 'ears' | 'brows' | 'mouth' | 'eyes' | 'feet'): boolean
  /** Hand shape override from held items. */
  holding(side: Side): boolean
  /** Outline width in world units. */
  readonly lw: number
  /** Still image at quality 'high': draw the expensive lighting/material detail. */
  readonly baked: boolean
  /** Still render with looping CSS motion for auras, effects and scene particles (RenderOptions.motion). */
  readonly motion: boolean
  /** Resolves uploaded custom-asset ids to hrefs (see RenderOptions.assetUrl). */
  readonly assetUrl?: (id: string) => string | undefined
}

export interface CtxInit {
  dna: AvatarDNA
  view: View
  idPrefix: string
  skel: Skeleton
  hr?: HumanRig
  cr?: CreatureRig
  detail?: 'low' | 'medium' | 'high'
  baked?: boolean
  motion?: boolean
  /** World units per outline "unit" (scales line weight with the avatar's size). */
  scaleRef: number
  assetUrl?: (id: string) => string | undefined
}

export function styleFrom(dna: AvatarDNA, scaleRef: number, detailOverride?: 'low' | 'medium' | 'high', baked = false): StyleState {
  const st = reader(dna.sections.style)
  const detailS = detailOverride ?? (st.s('detail') || 'high')
  const detail = (detailS === 'low' ? 0 : detailS === 'medium' ? 1 : 2) as 0 | 1 | 2
  const outline = st.has('outline') ? st.n('outline') : 0.4
  return {
    lw: outline * scaleRef * 0.024 * (detail === 0 ? 1.35 : 1),
    ink: (st.s('ink') || 'auto') as InkMode,
    shading: (st.s('shading') || 'cel') as Shading,
    light: lightVector(st.has('light') ? st.n('light') : 0.3),
    grade: (st.s('grade') || 'none') as Grade,
    detail,
    baked,
    rig: rigFrom(dna),
    auto: autoMaterials(dna),
  }
}

const withDefaults = (dna: AvatarDNA, id: string): Reader => {
  const defaults: Params = {}
  for (const p of sectionSpec(id)?.params ?? []) defaults[p.key] = p.default
  return reader(dna.sections[id], defaults)
}

/** The scene's light colours (see `sceneRig` in the painter). */
function rigFrom(dna: AvatarDNA): LightRig {
  const sc = withDefaults(dna, 'scene')
  return sceneRig(sc.s('background'), sc.c('color1', '#2b3a67'), sc.c('color2', '#6b4a8b'), sc.s('preset'))
}

const COAT_MATERIAL: Record<string, Material> = { fur: 'fur', smooth: 'skin', scales: 'scales', feathers: 'feathers', metal: 'metal', slime: 'slime', rock: 'rock' }

/** Colours that pick a material without the part saying so: skin, a creature's coat. */
function autoMaterials(dna: AvatarDNA): AutoMaterial[] {
  if (dna.kind === 'creature') {
    const coat = withDefaults(dna, 'coat')
    const material = COAT_MATERIAL[coat.s('texture')] ?? 'fur'
    const out: AutoMaterial[] = [coat.c('primary', '#e8a55a'), coat.c('secondary', '#f2efe9')].map((color) => ({ color, material }))
    if (coat.has('belly')) out.push({ color: coat.c('belly'), material })
    return out
  }
  return [{ color: withDefaults(dna, 'skin').c('tone', '#d69d78'), material: 'skin' }]
}

export function createCtx(init: CtxInit): Ctx {
  const { dna } = init
  const defs = new Defs(init.idPrefix)
  const paint = new Painter(defs, styleFrom(dna, init.scaleRef, init.detail, init.baked ?? false))
  const root = createRng(dna.seed)
  const readers = new Map<string, Reader>()

  const items: ResolvedItem[] = []
  const push = (list: ItemRef[]) =>
    list.forEach((ref, index) => {
      const spec = itemSpec(ref.id)
      if (!spec) return
      const defaults: Params = {}
      for (const p of spec.params) defaults[p.key] = p.default
      items.push({ ref, spec, art: baseItemId(ref.id), p: reader(ref.params, defaults), index })
    })
  push(dna.outfit)
  push(dna.accessories)

  const hidden = new Set<string>()
  for (const it of items) for (const h of it.spec.hides ?? []) hidden.add(h)

  return {
    dna,
    view: init.view,
    paint,
    defs,
    skel: init.skel,
    hr: init.hr,
    cr: init.cr,
    items,
    lw: paint.lw,
    baked: paint.style.baked,
    motion: init.motion ?? false,
    assetUrl: init.assetUrl,
    sec(id) {
      let r = readers.get(id)
      if (!r) {
        const spec = sectionSpec(id)
        const defaults: Params = {}
        for (const p of spec?.params ?? []) defaults[p.key] = p.default
        r = reader(dna.sections[id], defaults)
        readers.set(id, r)
      }
      return r
    },
    rng: (label) => root.fork(label),
    item: (slot) => items.find((i) => i.spec.slot === slot),
    itemsIn: (slot) => items.filter((i) => i.spec.slot === slot),
    has: (artId) => items.some((i) => i.art === artId),
    hides: (what) => hidden.has(what) || (what !== 'hair' && (what === 'hairTop' || what === 'hairBack') && hidden.has('hair')),
    holding: (side) => items.some((i) => i.spec.slot === (side === 'L' ? 'handL' : 'handR')),
  }
}

/* ---- Draw order --------------------------------------------------------- */

/** Front-view z values; views adjust some of them (see `zFor`). */
export const Z = {
  auraBack: -600,
  wings: -420,
  capeBack: -400,
  tail: -380,
  hairTailsBack: -320,
  hairBack: -300,
  farArm: -118,
  farLeg: -130,
  leg: -100,
  sock: -92,
  shoe: -80,
  pantsLeg: -70,
  boot: -62,
  body: 0,
  neck: 4,
  base: 10,
  bottom: 20,
  top: 30,
  topDetail: 32,
  belt: 36,
  bibFront: 38,
  outer: 50,
  neckAcc: 56,
  scarf: 58,
  armUpper: 60,
  sleeveUpper: 62,
  armLower: 64,
  sleeveLower: 66,
  outerSleeve: 68,
  held: 69,
  hand: 70,
  wrist: 71,
  glove: 72,
  heldFront: 73,
  earBack: 96,
  earring: 98,
  head: 100,
  skinDetail: 102,
  blush: 103,
  facePaint: 105,
  beard: 108,
  nose: 110,
  mouth: 112,
  mustache: 114,
  eyes: 116,
  brows: 118,
  faceAcc: 120,
  headFeature: 125,
  hairCap: 130,
  eyewear: 138,
  hairFront: 145,
  hairAcc: 148,
  headphones: 150,
  hat: 160,
  hatFront: 165,
  emote: 180,
  fx: 500,
} as const

export type ZName = keyof typeof Z

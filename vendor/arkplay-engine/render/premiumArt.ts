/* The premium art registry.
 *
 * The drawing code of premium items (paid, limited and NFT items, `itemTier(id) !== 'free'`)
 * is not part of this package. A premium art module registers it here, on a server that has
 * it. The part
 * generators look art up through `premiumArt()` (parts/shared/placeholder.ts): registered art
 * draws exactly what it always drew; a premium id without registered art draws a neutral
 * placeholder in the same place. Browsers never register it, so the studio ships no premium
 * art and shows the avatar service's renders of premium looks instead
 * (docs/studio.md).
 *
 * Only metadata lives here: which art ids are premium, and the hooks they plug into. */

import type { Box } from '../core/math.ts'
import { ALL_ITEMS, baseItemId } from '../dna/schema/index.ts'
import type { AvatarDNA } from '../dna/types.ts'
import type { Drawn } from '../parts/shared/accHead.ts'
import type { PetBuilder } from '../parts/shared/companion.ts'
import type { BackFrame, HandFrame, HeadFrame } from '../parts/shared/frames.ts'
import type { Ctx, PartList, Reader, ResolvedItem } from './context.ts'

/** Art drawn in two layers: behind the body (or the hand) and in front of it. */
export interface Layers {
  behind: string
  front: string
}

/** The hooks premium art plugs into: one per kind of anchor, each shaped like the free
 *  art's own draw function for that anchor. */
export interface PremiumArt {
  /** Head slot (crowns, helmets, hats): `drawHeadwear` in parts/shared/accHead.ts. */
  headwear: (c: Ctx, id: string, p: Reader, f: HeadFrame) => Drawn
  /** Head features (halos): `drawHeadFeature`. */
  headFeature: (c: Ctx, id: string, p: Reader, f: HeadFrame, hairColor: string) => Drawn
  /** One wing, reaching toward +x from its root; `drawWing` lights and mirrors it. */
  wing: (c: Ctx, id: string, p: Reader, span: number) => string
  /** Other back items (jetpacks): `drawBackAcc`. */
  back: (c: Ctx, id: string, p: Reader, f: BackFrame) => Layers
  /** Held items in item space (grip at the origin, pointing up); `drawHeld` puts them in the hand. */
  held: (c: Ctx, id: string, p: Reader, f: HandFrame) => Layers
  /** Auras and particle effects over `region` at time `t` (parts/shared/accFx.ts). */
  aura: (c: Ctx, id: string, p: Reader, region: Box, t: number, seed: number) => Layers
  /** The pet companion: adds its parts to `out`; `build` draws its creature. */
  companion: (c: Ctx, it: ResolvedItem, out: PartList, build: PetBuilder) => void
}

export type PremiumArtKind = keyof PremiumArt

/**
 * Every art id whose drawing lives in the premium art module, by hook. An item draws with its art id
 * (`baseItemId`): `sword-l` draws `sword`, `founder-crown` draws `crown`. A new premium item
 * with new art gets its id here and its drawing in the premium art module (the test suite
 * checks that every non-free item is covered).
 */
export const PREMIUM_ART: { readonly [K in PremiumArtKind]: readonly string[] } = {
  headwear: ['crown', 'tiara', 'knight-helm', 'space-helm', 'viking', 'wizard'],
  headFeature: ['halo'],
  wing: ['angel-wings', 'bat-wings', 'fairy-wings', 'butterfly-wings', 'dragon-wings', 'mech-wings'],
  back: ['jetpack'],
  held: ['sword', 'staff', 'wand', 'orb', 'trophy'],
  aura: ['glow', 'sparkles', 'hearts', 'fire', 'bubbles', 'snow', 'leaves', 'lightning', 'music', 'shadow-aura', 'pixels', 'petals'],
  companion: ['pet'],
}

/**
 * Non-free items whose art stays in every build, and why. Their art protects nothing: it is
 * the player's own image, or free art in fixed colours.
 */
export const LOCAL_ART: Readonly<Record<string, string>> = {
  custom: "custom art is the player's own upload; the engine only places it",
  cape: 'the founder cape is the free cape in fixed colours',
}

const KIND_OF = new Map<string, PremiumArtKind>()
for (const kind of Object.keys(PREMIUM_ART) as PremiumArtKind[]) for (const id of PREMIUM_ART[kind]) KIND_OF.set(id, kind)

const registry = new Map<string, unknown>()
const keyOf = (kind: PremiumArtKind, id: string): string => `${kind}:${id}`

/** Plugs premium art in (the premium entry does this for every id). Registering the same art
 *  again changes nothing. */
export function registerArt<K extends PremiumArtKind>(kind: K, ids: readonly string[], draw: PremiumArt[K]): void {
  for (const id of ids) {
    if (KIND_OF.get(id) !== kind) throw new Error(`"${id}" is not premium ${kind} art (see PREMIUM_ART).`)
    registry.set(keyOf(kind, id), draw)
  }
}

/** The registered art for an art id, when this build has it. */
export function registeredArt<K extends PremiumArtKind>(kind: K, id: string): PremiumArt[K] | undefined {
  return registry.get(keyOf(kind, id)) as PremiumArt[K] | undefined
}

/** The hook an art id plugs into, when its drawing is premium. */
export const premiumArtKind = (artId: string): PremiumArtKind | undefined => KIND_OF.get(artId)

/** True when `artId` (an item's `baseItemId`) is drawn by the premium entry. */
export const isPremiumArt = (artId: string): boolean => KIND_OF.has(artId)

/** True when this build can draw `artId` for real: free art, or registered premium art. */
export function hasArt(artId: string): boolean {
  const kind = KIND_OF.get(artId)
  return !kind || registry.has(keyOf(kind, artId))
}

/** True once every premium art id is registered (the avatar service; never a browser). */
export function premiumArtRegistered(): boolean {
  for (const [id, kind] of KIND_OF) if (!registry.has(keyOf(kind, id))) return false
  return true
}

/** Item ids with premium art: every item whose art id is in PREMIUM_ART (`sword-l`, `founder-crown`…). */
export const PREMIUM_ART_ITEMS: readonly string[] = ALL_ITEMS.filter((i) => KIND_OF.has(baseItemId(i.id))).map((i) => i.id)

/** The items `dna` wears whose art is premium, as worn (`founder-crown`, not `crown`). */
export function premiumItems(dna: AvatarDNA): string[] {
  return [...dna.outfit, ...dna.accessories].map((i) => i.id).filter((id) => KIND_OF.has(baseItemId(id)))
}

/**
 * True when this build would draw a placeholder for something `dna` wears: a browser
 * rendering premium items. Hosts then show the avatar service's render of that look.
 */
export function needsPremiumArt(dna: AvatarDNA): boolean {
  return [...dna.outfit, ...dna.accessories].some((i) => !hasArt(baseItemId(i.id)))
}

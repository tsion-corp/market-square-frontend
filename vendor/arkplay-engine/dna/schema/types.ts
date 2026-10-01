/* Section and item descriptors: how params are grouped into the DNA and the studio. */

import type { AvatarKind, ParamSpec } from '../params.ts'

/** Studio tabs. Sections and item categories declare which tab they live on. */
export type TabId =
  | 'species'
  | 'body'
  | 'face'
  | 'skin'
  | 'hair'
  | 'outfit'
  | 'accessories'
  | 'limbs'
  | 'coat'
  | 'expression'
  | 'scene'
  | 'style'

export interface SectionSpec {
  id: string
  label: string
  tab: TabId
  kinds: readonly AvatarKind[]
  params: readonly ParamSpec[]
}

/** Where a garment or accessory sits. Capacity is enforced when items are added. */
export type SlotId =
  // garments (humanoid)
  | 'top'
  | 'bottom'
  | 'full'
  | 'outer'
  | 'shoes'
  | 'socks'
  // accessories (both kinds unless noted)
  | 'head'
  | 'headFeature'
  | 'hairAcc'
  | 'eyes'
  | 'face'
  | 'ears'
  | 'neck'
  | 'back'
  | 'waist'
  | 'wrist'
  | 'hands'
  | 'handL'
  | 'handR'
  | 'tailAcc'
  | 'aura'
  | 'companion'
  | 'custom'

export interface SlotSpec {
  id: SlotId
  label: string
  capacity: number
  kinds: readonly AvatarKind[]
  kind: 'garment' | 'accessory'
}

export interface ItemSpec {
  id: string
  label: string
  slot: SlotId
  kinds: readonly AvatarKind[]
  tags: readonly string[]
  params: readonly ParamSpec[]
  /** Slots this item also occupies (a dress fills top and bottom). */
  occupies?: readonly SlotId[]
  /** Parts of the avatar the item hides (a hijab hides the hair and ears). */
  hides?: readonly ('hair' | 'hairTop' | 'hairBack' | 'ears' | 'brows' | 'mouth' | 'eyes' | 'feet')[]
  /** Relative weight when randomizing (default 1). */
  weight?: number
  /** Gated behind an entitlement (the service decides who owns it). Any tier but `free`
   *  sets it; a `premium` item without a `tier` counts as `paid` (see `itemTier`). */
  premium?: boolean
  sku?: string
  /** How the item is obtained. Default `free`, or `paid` when `premium` is set. Only
   *  `paid`, `limited` and `nft` items add to an avatar's rarity (`avatarRarity`). */
  tier?: ItemTier
  /** Limited editions: on sale only inside [from, until] (ISO 8601), optionally capped at
   *  `edition` owners. Smaller editions weigh more in rarity. */
  limited?: { from?: string; until?: string; edition?: number }
  /** Only wearable by accounts holding the matching NFT (implies tier `nft`). */
  nftOnly?: boolean
  /** Draws exactly like this other item (limited variants reuse existing art). */
  art?: string
}

/** How an item is obtained. Free choices never make an avatar rarer than Common. */
export type ItemTier = 'free' | 'paid' | 'limited' | 'nft'

export const SLOTS: SlotSpec[] = [
  { id: 'top', label: 'Top', capacity: 1, kinds: ['humanoid'], kind: 'garment' },
  { id: 'bottom', label: 'Bottom', capacity: 1, kinds: ['humanoid'], kind: 'garment' },
  { id: 'full', label: 'Dress / one-piece', capacity: 1, kinds: ['humanoid'], kind: 'garment' },
  { id: 'outer', label: 'Outerwear', capacity: 1, kinds: ['humanoid'], kind: 'garment' },
  { id: 'shoes', label: 'Shoes', capacity: 1, kinds: ['humanoid'], kind: 'garment' },
  { id: 'socks', label: 'Socks', capacity: 1, kinds: ['humanoid'], kind: 'garment' },
  { id: 'head', label: 'Headwear', capacity: 1, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'headFeature', label: 'Horns & ears', capacity: 2, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'hairAcc', label: 'Hair accessories', capacity: 3, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'eyes', label: 'Eyewear', capacity: 1, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'face', label: 'Face', capacity: 3, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'ears', label: 'Ears', capacity: 2, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'neck', label: 'Neck', capacity: 2, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'back', label: 'Back', capacity: 1, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'waist', label: 'Waist', capacity: 1, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'wrist', label: 'Wrists', capacity: 2, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'hands', label: 'Gloves', capacity: 1, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'handL', label: 'Left hand', capacity: 1, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'handR', label: 'Right hand', capacity: 1, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'tailAcc', label: 'Tail', capacity: 1, kinds: ['humanoid'], kind: 'accessory' },
  { id: 'aura', label: 'Aura & effects', capacity: 1, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'companion', label: 'Companion', capacity: 1, kinds: ['humanoid', 'creature'], kind: 'accessory' },
  { id: 'custom', label: 'Custom', capacity: 8, kinds: ['humanoid', 'creature'], kind: 'accessory' },
]

export const slotSpec = (id: SlotId): SlotSpec => SLOTS.find((s) => s.id === id) as SlotSpec

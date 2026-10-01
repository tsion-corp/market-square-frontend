/* The avatar document ("DNA"). This is the contract every system shares: the studio edits
 * it, the service stores it, the renderer draws it, Unity requests renders of it. It is
 * small, JSON, versioned, and fully describes an avatar — nothing about an avatar lives
 * anywhere else (renders are a pure function of DNA + engine version).
 *
 * Compatibility rules (see README.md "DNA contract"):
 *   - `v` only changes with a migration in `migrate.ts`.
 *   - New params get defaults that reproduce the old look, so old DNA renders unchanged.
 *   - Param keys, section ids, item ids and choice ids are never renamed or reused. */

import type { AvatarKind, Params } from './params.ts'
import type { SlotId } from './schema/types.ts'

export const DNA_VERSION = 1 as const

export interface CustomAsset {
  /** Asset id in the avatar service (moderated, preferred). */
  id?: string
  /** Inline art: `data:image/png;base64,…` or `data:image/svg+xml;base64,…`. Local only —
   *  stripped from share codes and replaced by an uploaded `id` when saved to the service. */
  src?: string
  /** Natural size of the art in pixels (keeps the aspect ratio). */
  w: number
  h: number
  /** Display name. */
  name?: string
  /** Pivot inside the art, 0..1 (default centre). */
  px?: number
  py?: number
}

export interface ItemRef {
  id: string
  params: Params
  /** Custom items only. */
  asset?: CustomAsset
}

export interface AvatarDNA {
  v: typeof DNA_VERSION
  kind: AvatarKind
  /** Seeds every procedural detail (freckle placement, hair strands, fur tufts…). */
  seed: number
  name: string
  /** Section id → params. Which sections exist depends on `kind`. */
  sections: Record<string, Params>
  /** Garments, humanoid only. */
  outfit: ItemRef[]
  accessories: ItemRef[]
  /** Informational: the creature species preset or theme this came from. */
  meta?: { species?: string; theme?: string; source?: string }
}

export type { AvatarKind, Params, ParamValue } from './params.ts'
export type { SlotId }

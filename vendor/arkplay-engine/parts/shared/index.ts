import type { GenSet } from '../../render/model.ts'

/**
 * Generators shared by every kind. (The pet companion is shared too, but it needs the
 * model builder to draw its creature, so `buildModel` calls `companionParts` itself.)
 */
export const SHARED_GENS: GenSet = {
  static: [],
  dynamic: [],
}

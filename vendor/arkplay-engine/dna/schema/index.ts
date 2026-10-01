import type { AvatarKind } from '../params.ts'
import { CREATURE_SECTIONS } from './creature.ts'
import { HUMANOID_SECTIONS } from './humanoid.ts'
import { SHARED_SECTIONS } from './shared.ts'
import type { SectionSpec } from './types.ts'

export * from './types.ts'
export { HUMANOID_SECTIONS, HAIR_STYLES } from './humanoid.ts'
export { CREATURE_SECTIONS, BODY_PLANS } from './creature.ts'
export { SHARED_SECTIONS, EXPRESSIONS, POSES, SCENE_PRESETS, BG_PATTERNS } from './shared.ts'
export {
  GARMENTS,
  ACCESSORIES,
  ALL_ITEMS,
  FABRIC_PATTERNS,
  GRAPHICS,
  STROKE_CHARSET,
  PET_SPECIES,
  CUSTOM_ANCHORS,
  itemSpec,
  baseItemId,
  entitlementItemId,
  itemTier,
  PAID_ITEMS,
  LAUNCH_UNTIL,
} from './items.ts'

export const ALL_SECTIONS: SectionSpec[] = [...HUMANOID_SECTIONS, ...CREATURE_SECTIONS, ...SHARED_SECTIONS]

const byId = new Map(ALL_SECTIONS.map((s) => [s.id, s]))

export const sectionSpec = (id: string): SectionSpec | undefined => byId.get(id)

export const sectionsFor = (kind: AvatarKind): SectionSpec[] => ALL_SECTIONS.filter((s) => s.kinds.includes(kind))

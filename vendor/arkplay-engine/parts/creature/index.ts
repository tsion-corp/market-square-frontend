import type { GenSet } from '../../render/model.ts'
import { creatureAccessoriesGen, creatureAuraGen } from './accessories.ts'
import { profileBodyGen } from './body.ts'
import { frontalBodyGen } from './frontal.ts'
import { creatureFace, creatureHeadStatic } from './head.ts'

export const CREATURE_GENS: GenSet = {
  static: [profileBodyGen, frontalBodyGen, creatureHeadStatic, creatureAccessoriesGen],
  dynamic: [creatureFace, creatureAuraGen],
}

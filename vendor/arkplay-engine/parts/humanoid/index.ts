import type { GenSet } from '../../render/model.ts'
import { bodyGen, handsGen } from './body.ts'
import { blushGen, browsGen, eyesGen, mouthGen, noseGen } from './face.ts'
import { headGen } from './head.ts'
import { hairGen } from './hair.ts'
import { garmentsGen } from './garments.ts'
import { accessoriesGen, auraGen } from './accessories.ts'

export const HUMANOID_GENS: GenSet = {
  static: [bodyGen, headGen, noseGen, hairGen, garmentsGen, accessoriesGen],
  dynamic: [eyesGen, browsGen, mouthGen, blushGen, handsGen, auraGen],
}

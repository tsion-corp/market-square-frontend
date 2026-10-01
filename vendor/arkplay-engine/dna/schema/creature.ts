/* Non-humanoid traits. A creature is a body plan (how the skeleton is laid out) plus
 * anatomy dials that apply across plans: a dragon is a quadruped with wings and horns,
 * a griffin an avian with four legs, a fox-spirit a quadruped with three tails. */

import { choice, color, opts, range, toggle, type ParamSpec } from '../params.ts'
import type { SectionSpec } from './types.ts'

export const BODY_PLANS = opts(
  'quadruped:Four-legged|animal|4',
  'avian:Bird|animal|2',
  'aquatic:Fish|animal,water|1.5',
  'serpent:Serpent|animal,fantasy|1',
  'insectoid:Bug|animal|1',
  'blob:Blob|cute,fantasy|1.5',
  'cephalopod:Octopus|water,cute|1',
  'robot:Robot|scifi|1.2',
)

const species: ParamSpec[] = [
  choice('plan', 'Body plan', 'quadruped', BODY_PLANS, { preview: 'full', random: { mode: 'keep' } }),
  range('size', 'Size', 0.5, { ends: ['Tiny', 'Huge'], random: { mode: 'normal', sd: 0.18 } }),
  range('stance', 'Stance', 0.5, { ends: ['Low', 'Tall'], random: { mode: 'normal', sd: 0.15 } }),
  // Animation only (walks, runs, idles): `auto` derives the gait from the body, as before.
  choice('gait', 'Movement', 'auto', opts('auto:Natural||10', 'walk:Walks', 'hop:Hops', 'waddle:Waddles', 'float:Floats'), {
    random: { mode: 'keep' },
    visibleIf: { key: 'plan', notIn: ['aquatic'] },
    help: 'How it gets around in animations. Natural picks from its body: a fish swims, a snake slithers.',
  }),
]

const form: ParamSpec[] = [
  range('length', 'Body length', 0.5, { ends: ['Short', 'Long'], random: { mode: 'normal', sd: 0.18 } }),
  range('girth', 'Girth', 0.5, { ends: ['Slender', 'Stout'], random: { mode: 'normal', sd: 0.18 } }),
  range('neck', 'Neck', 0.4, { ends: ['Short', 'Long'], random: { mode: 'normal', sd: 0.18 } }),
  range('belly', 'Belly', 0.4, { ends: ['Lean', 'Round'], random: { mode: 'normal', sd: 0.18 } }),
  range('arch', 'Back arch', 0.5, { ends: ['Sway', 'Arched'], random: { mode: 'normal', sd: 0.12 }, advanced: true }),
  range('fluff', 'Fluffiness', 0.3, { ends: ['Sleek', 'Fluffy'], random: { mode: 'uniform' } }),
  choice('build', 'Robot chassis', 'box', opts('box:Box', 'round:Round', 'capsule:Capsule', 'tv:Retro TV'), {
    visibleIf: { key: 'plan', in: ['robot'], section: 'species' },
  }),
  choice('blobShape', 'Blob shape', 'drop', opts('drop:Droplet', 'mochi:Mochi', 'ghost:Ghost', 'cloud:Cloud', 'flame:Flame'), {
    visibleIf: { key: 'plan', in: ['blob'], section: 'species' },
  }),
]

const face: ParamSpec[] = [
  range('headSize', 'Head size', 0.5, { random: { mode: 'normal', sd: 0.15 } }),
  choice('headShape', 'Head shape', 'round', opts('round:Round||3', 'long:Long||2', 'flat:Flat||1', 'wedge:Wedge||1.5', 'boxy:Boxy||1'), {
    preview: 'head',
  }),
  range('snout', 'Snout', 0.45, { ends: ['Flat', 'Long'], random: { mode: 'uniform' } }),
  range('jaw', 'Jaw', 0.5, { random: { mode: 'normal', sd: 0.15 }, advanced: true }),
  range('cheeks', 'Cheek fluff', 0.2, { random: { mode: 'uniform', max: 0.8 } }),
  choice('eyeCount', 'Eyes', '2', opts('1:One|fantasy|0.4', '2:Two||10', '3:Three|fantasy|0.3', '4:Four|fantasy|0.3', '6:Six|fantasy|0.2', '8:Eight|spooky|0.2')),
  range('eyeSize', 'Eye size', 0.5, { random: { mode: 'normal', sd: 0.18 } }),
  choice(
    'eyeStyle',
    'Eye style',
    'cute',
    opts('cute:Big & shiny|cute|3', 'round:Round||3', 'fierce:Fierce|fantasy|1.5', 'sleepy:Sleepy||1', 'bug:Compound|animal|0.6', 'dot:Dots|minimal|1', 'visor:Visor|scifi|0.4'),
    { preview: 'head' },
  ),
  color('iris', 'Eye colour', '#d4a017', 'eyes'),
  choice('pupil', 'Pupil', 'round', opts('round:Round||6', 'slit:Slit||2', 'goat:Horizontal||0.6', 'star:Star|cute|0.3', 'none:None||0.4')),
  toggle('glow', 'Glowing eyes', false, { random: { p: 0.08 } }),
  toggle('lashes', 'Lashes', false, { random: { p: 0.2 } }),
  choice(
    'mouth',
    'Mouth',
    'smile',
    opts(
      'smile:Smile||3',
      'cat:Cat mouth|cute|2',
      'beak:Beak||1',
      'hooked:Hooked beak||0.6',
      'duck:Bill||0.5',
      'fangs:Fangs|fantasy|1',
      'tusks:Tusks||0.5',
      'jaws:Toothy jaws|fantasy|0.6',
      'mandibles:Mandibles||0.4',
      'grill:Speaker grill|scifi|0.4',
      'none:None||0.3',
    ),
    { preview: 'head' },
  ),
  toggle('tongue', 'Tongue out', false, { random: { p: 0.1 } }),
]

const ears: ParamSpec[] = [
  choice(
    'style',
    'Ears',
    'pointed',
    opts('pointed:Pointed||3', 'round:Round||2', 'floppy:Floppy||1.5', 'long:Long||1', 'tufted:Tufted||1', 'bat:Bat||0.8', 'fin:Fins||0.6', 'frill:Frills||0.4', 'none:None||1'),
    { preview: 'head' },
  ),
  range('size', 'Size', 0.5, { random: { mode: 'normal', sd: 0.18 } }),
  color('inner', 'Inner colour', '', 'nature', { allowAuto: true, advanced: true }),
]

const horns: ParamSpec[] = [
  choice(
    'style',
    'Horns',
    'none',
    opts('none:None||8', 'nubs:Nubs||1', 'straight:Straight||1', 'curved:Curved||1', 'ram:Ram||0.7', 'antlers:Antlers||0.7', 'unicorn:Unicorn|fantasy|0.5', 'crown:Crown of horns|fantasy|0.3', 'antenna:Antennae||0.8'),
    { preview: 'head' },
  ),
  range('size', 'Size', 0.5, { random: { mode: 'normal', sd: 0.18 } }),
  color('color', 'Colour', '#e8dcc6', 'nature'),
]

const limbs: ParamSpec[] = [
  choice('legs', 'Legs', 'auto', opts('auto:Plan default||10', '0:None', '2:Two', '4:Four', '6:Six', '8:Eight')),
  range('length', 'Leg length', 0.5, { random: { mode: 'normal', sd: 0.18 } }),
  range('thickness', 'Leg thickness', 0.5, { random: { mode: 'normal', sd: 0.18 } }),
  choice('feet', 'Feet', 'paws', opts('paws:Paws||4', 'hooves:Hooves||1.5', 'claws:Claws||1.5', 'talons:Talons||1', 'webbed:Webbed||0.8', 'pads:Pads||1', 'wheels:Wheels|scifi|0.3')),
  choice('arms', 'Arms', 'auto', opts('auto:Plan default||10', 'none:None', 'stubby:Stubby', 'long:Long'), {
    visibleIf: { key: 'plan', in: ['blob', 'robot', 'cephalopod'], section: 'species' },
  }),
]

const tail: ParamSpec[] = [
  choice(
    'style',
    'Tail',
    'thin',
    opts(
      'none:None||1',
      'thin:Thin||3',
      'fluffy:Fluffy||2',
      'bushy:Bushy||1.5',
      'tuft:Tufted||0.8',
      'spade:Spade|fantasy|0.6',
      'club:Club|fantasy|0.4',
      'fin:Fin||0.8',
      'fan:Fan||0.6',
      'feather:Feathers||0.8',
      'stinger:Stinger||0.4',
      'curly:Curly||0.5',
      'flame:Flame|fantasy|0.3',
    ),
  ),
  range('length', 'Length', 0.5, { random: { mode: 'normal', sd: 0.2 } }),
  range('thickness', 'Thickness', 0.5, { random: { mode: 'normal', sd: 0.2 } }),
  range('count', 'Tails', 0, { min: 0, max: 8, step: 1, random: { mode: 'keep' }, help: 'Extra tails, for kitsune.' }),
  range('curve', 'Curve', 0.5, { ends: ['Down', 'Up'], random: { mode: 'normal', sd: 0.2 } }),
]

const wings: ParamSpec[] = [
  choice(
    'style',
    'Wings',
    'none',
    opts('none:None||10', 'feather:Feathered||1', 'bat:Leathery||1', 'insect:Insect||0.6', 'fairy:Fairy|cute,fantasy|0.5', 'mech:Mechanical|scifi|0.3', 'flame:Flame|fantasy|0.2'),
    { preview: 'full' },
  ),
  range('size', 'Size', 0.5, { random: { mode: 'normal', sd: 0.2 } }),
  color('color', 'Colour', '', 'nature', { allowAuto: true }),
]

const extras: ParamSpec[] = [
  range('spikes', 'Back spikes', 0, { random: { mode: 'uniform', p: 0.2 } }),
  choice('mane', 'Mane', 'none', opts('none:None||8', 'lion:Lion||1', 'horse:Horse||1', 'crest:Crest||1', 'punk:Punk||0.5')),
  toggle('whiskers', 'Whiskers', false, { random: { p: 0.35 } }),
  choice('shell', 'Shell', 'none', opts('none:None||12', 'turtle:Turtle||1', 'snail:Snail||1')),
  toggle('fins', 'Dorsal fin', false, { random: { p: 0.15 } }),
  toggle('antennae', 'Antennae', false, { random: { p: 0.1 } }),
]

const coat: ParamSpec[] = [
  color('primary', 'Main colour', '#e8a55a', 'nature'),
  color('secondary', 'Second colour', '#f2efe9', 'nature'),
  color('belly', 'Belly colour', '', 'nature', { allowAuto: true }),
  color('accent', 'Accent colour', '#c0392b', 'nature'),
  choice(
    'pattern',
    'Pattern',
    'none',
    opts(
      'none:None||4',
      'spots:Spots||2',
      'stripes:Stripes||2',
      'tiger:Tiger||1',
      'patches:Patches||1.5',
      'rosettes:Rosettes||0.8',
      'socks:Socks||1.2',
      'mask:Mask||1',
      'saddle:Saddle||0.8',
      'bands:Bands||0.8',
      'scales:Scales||1',
      'gradient:Gradient||1.2',
      'stars:Galaxy|fantasy|0.4',
      'circuit:Circuit|scifi|0.4',
    ),
  ),
  color('patternColor', 'Pattern colour', '#5c3d24', 'nature', { visibleIf: { key: 'pattern', notIn: ['none'] } }),
  range('patternScale', 'Pattern scale', 0.5, { visibleIf: { key: 'pattern', notIn: ['none'] } }),
  choice(
    'texture',
    'Texture',
    'fur',
    opts('fur:Fur||4', 'smooth:Smooth||2', 'scales:Scales||1', 'feathers:Feathers||1', 'metal:Metal|scifi|0.6', 'slime:Slime|cute|0.6', 'rock:Rock|fantasy|0.4'),
  ),
]

export const CREATURE_SECTIONS: SectionSpec[] = [
  { id: 'species', label: 'Species', tab: 'species', kinds: ['creature'], params: species },
  { id: 'form', label: 'Body', tab: 'species', kinds: ['creature'], params: form },
  { id: 'face', label: 'Face', tab: 'face', kinds: ['creature'], params: face },
  { id: 'ears', label: 'Ears', tab: 'face', kinds: ['creature'], params: ears },
  { id: 'horns', label: 'Horns', tab: 'face', kinds: ['creature'], params: horns },
  { id: 'limbs', label: 'Limbs', tab: 'limbs', kinds: ['creature'], params: limbs },
  { id: 'tail', label: 'Tail', tab: 'limbs', kinds: ['creature'], params: tail },
  { id: 'wings', label: 'Wings', tab: 'limbs', kinds: ['creature'], params: wings },
  { id: 'extras', label: 'Extras', tab: 'limbs', kinds: ['creature'], params: extras },
  { id: 'coat', label: 'Coat', tab: 'coat', kinds: ['creature'], params: coat },
]

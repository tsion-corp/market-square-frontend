/* The garment and accessory catalogue. Every item is drawn procedurally from the
 * avatar's own skeleton, so one "hoodie" fits every body shape, height and pose. An
 * item's params are its colours, fabric pattern and variants. */

import { choice, color, opts, range, text, toggle, type ParamSpec } from '../params.ts'
import type { ItemSpec, ItemTier, SlotId } from './types.ts'

export const FABRIC_PATTERNS = opts(
  'solid:Solid||12',
  'stripes:Stripes||2',
  'vstripes:Vertical stripes||1',
  'pinstripe:Pinstripe|formal|0.6',
  'diagonal:Diagonal||0.8',
  'dots:Polka dots|cute|1.2',
  'plaid:Plaid||1.2',
  'checker:Checker||0.8',
  'camo:Camo|military|0.6',
  'floral:Floral|cute|0.8',
  'stars:Stars|cute|0.6',
  'hearts:Hearts|cute|0.5',
  'zigzag:Zig-zag||0.5',
  'argyle:Argyle|formal|0.4',
  'leopard:Leopard||0.4',
  'zebra:Zebra||0.3',
  'tiedye:Tie-dye|party|0.4',
  'gradient:Gradient||0.8',
  'flames:Flames|rock|0.3',
  'circuit:Circuit|scifi|0.3',
)

export const GRAPHICS = opts(
  'none:None||8',
  'emblem:Emblem||1',
  'text:Text||1',
  'number:Number|sporty|0.6',
  'heart:Heart|cute|0.6',
  'star:Star||0.6',
  'lightning:Lightning||0.5',
  'smiley:Smiley|cute|0.5',
  'skull:Skull|rock,spooky|0.4',
  'planet:Planet|scifi|0.4',
  'paw:Paw print|cute,animal|0.4',
  'flower:Flower|cute|0.4',
  'crown:Crown|royal|0.3',
  'controller:Controller|gaming|0.6',
  'stripe:Chest stripe|sporty|0.6',
)

/** Characters the built-in stroke font can draw (text prints, jersey numbers). */
export const STROKE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 !?.-+#&'

function fabric(def: string, def2: string, extra: ParamSpec[] = []): ParamSpec[] {
  return [
    color('color', 'Colour', def, 'cloth'),
    color('color2', 'Trim colour', def2, 'cloth'),
    choice('pattern', 'Pattern', 'solid', FABRIC_PATTERNS),
    color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth', { visibleIf: { key: 'pattern', notIn: ['solid'] } }),
    ...extra,
  ]
}

const graphic = (def = 'none'): ParamSpec[] => [
  choice('graphic', 'Print', def, GRAPHICS),
  color('graphicColor', 'Print colour', '#f5f2eb', 'cloth', { visibleIf: { key: 'graphic', notIn: ['none', 'stripe'] } }),
  text('text', 'Print text', 'ARK', 10, { charset: STROKE_CHARSET, visibleIf: { key: 'graphic', in: ['text', 'number'] }, random: { mode: 'keep' } }),
]

const sleeves = (def: string) =>
  choice('sleeves', 'Sleeves', def, opts('none:Sleeveless', 'short:Short', 'elbow:Elbow', 'long:Long'))

const tint = (def: string, label = 'Colour', palette: 'cloth' | 'metal' | 'any' | 'nature' | 'hair' = 'cloth') => color('color', label, def, palette)
const tint2 = (def: string, label = 'Accent', palette: 'cloth' | 'metal' | 'any' | 'nature' | 'hair' = 'cloth') => color('color2', label, def, palette)

type Def = Omit<ItemSpec, 'kinds'> & { kinds?: ItemSpec['kinds'] }

const H = ['humanoid'] as const
const BOTH = ['humanoid', 'creature'] as const

function items(slot: SlotId, list: Omit<Def, 'slot'>[]): ItemSpec[] {
  return list.map((d) => ({ kinds: H, ...d, slot }))
}

/* ---- Garments -------------------------------------------------------------- */

const TOPS = items('top', [
  { id: 'tshirt', label: 'T-shirt', tags: ['casual'], weight: 4, params: [...fabric('#e53935', '#f5f2eb', [sleeves('short'), choice('neck', 'Neckline', 'crew', opts('crew:Crew', 'v:V-neck', 'scoop:Scoop'))]), ...graphic()] },
  { id: 'longsleeve', label: 'Long-sleeve tee', tags: ['casual'], weight: 2, params: [...fabric('#1e88e5', '#f5f2eb', [choice('neck', 'Neckline', 'crew', opts('crew:Crew', 'v:V-neck'))]), ...graphic()] },
  { id: 'tank', label: 'Tank top', tags: ['casual', 'sporty', 'beach'], weight: 1.5, params: [...fabric('#fdd835', '#f5f2eb'), ...graphic()] },
  { id: 'crop', label: 'Crop top', tags: ['casual', 'party'], weight: 1, params: [...fabric('#ec407a', '#f5f2eb', [sleeves('short')]), ...graphic()] },
  { id: 'hoodie', label: 'Hoodie', tags: ['casual', 'cozy', 'gaming'], weight: 3, params: [...fabric('#546e7a', '#37474f', [toggle('pocket', 'Pocket', true), toggle('strings', 'Drawstrings', true), toggle('hoodUp', 'Hood up', false)]), ...graphic()] },
  { id: 'sweater', label: 'Sweater', tags: ['cozy', 'winter'], weight: 2, params: fabric('#8e24aa', '#6a1b9a', [toggle('knit', 'Cable knit', true)]) },
  { id: 'turtleneck', label: 'Turtleneck', tags: ['formal', 'cozy'], weight: 1, params: fabric('#26252c', '#141319') },
  { id: 'shirt', label: 'Button shirt', tags: ['formal'], weight: 2, params: fabric('#f5f2eb', '#b0bec5', [sleeves('long'), toggle('open', 'Open collar', true)]) },
  { id: 'polo', label: 'Polo', tags: ['sporty', 'casual'], weight: 1, params: fabric('#00897b', '#f5f2eb') },
  { id: 'blouse', label: 'Blouse', tags: ['formal', 'cute'], weight: 1, params: fabric('#f8bbd0', '#f5f2eb', [sleeves('elbow'), toggle('ruffle', 'Ruffle collar', true)]) },
  { id: 'jersey', label: 'Sports jersey', tags: ['sporty'], weight: 1, params: [...fabric('#c62828', '#f5f2eb', [sleeves('short')]), ...graphic('number')] },
  { id: 'sailor', label: 'Sailor top', tags: ['anime', 'cute', 'school'], weight: 0.6, params: fabric('#f5f2eb', '#283593', [color('scarf', 'Scarf colour', '#e53935', 'cloth')]) },
  { id: 'tunic', label: 'Tunic', tags: ['fantasy', 'medieval'], weight: 0.8, params: fabric('#6d4c41', '#a1887f', [sleeves('long'), toggle('belt', 'Belt', true)]) },
  { id: 'armor', label: 'Chest plate', tags: ['fantasy', 'knight'], weight: 0.6, params: [tint('#b0bec5', 'Metal', 'metal'), tint2('#c79212', 'Trim', 'metal'), sleeves('none'), choice('crest', 'Crest', 'none', opts('none:None', 'lion:Lion', 'cross:Cross', 'star:Star', 'dragon:Dragon'))] },
  { id: 'vest-top', label: 'Waistcoat & shirt', tags: ['formal', 'retro'], weight: 0.6, params: fabric('#37474f', '#f5f2eb', [sleeves('long')]) },
])

const BOTTOMS = items('bottom', [
  { id: 'jeans', label: 'Jeans', tags: ['casual'], weight: 4, params: fabric('#3b5b92', '#d9b26f', [choice('fit', 'Fit', 'straight', opts('skinny:Skinny', 'straight:Straight', 'wide:Wide')), toggle('ripped', 'Ripped', false)]) },
  { id: 'trousers', label: 'Trousers', tags: ['formal'], weight: 2, params: fabric('#37474f', '#26252c', [choice('fit', 'Fit', 'straight', opts('skinny:Slim', 'straight:Straight', 'wide:Wide'))]) },
  { id: 'cargo', label: 'Cargo pants', tags: ['casual', 'adventure'], weight: 1.5, params: fabric('#6b6b4b', '#4e4e36') },
  { id: 'joggers', label: 'Joggers', tags: ['sporty', 'cozy'], weight: 1.5, params: fabric('#4b4a52', '#f5f2eb', [toggle('stripe', 'Side stripe', true)]) },
  { id: 'shorts', label: 'Shorts', tags: ['casual', 'beach', 'sporty'], weight: 2, params: fabric('#c9c2b6', '#8a8580', [range('length', 'Length', 0.5)]) },
  { id: 'skirt', label: 'Skirt', tags: ['cute', 'formal'], weight: 2, params: fabric('#5e35b1', '#f5f2eb', [choice('cut', 'Cut', 'aline', opts('aline:A-line', 'pleated:Pleated', 'pencil:Pencil', 'tutu:Tutu')), range('length', 'Length', 0.4, { ends: ['Mini', 'Maxi'] })]) },
  { id: 'leggings', label: 'Leggings', tags: ['sporty'], weight: 1, params: fabric('#26252c', '#5e35b1') },
  {
    id: 'kilt',
    label: 'Kilt',
    tags: ['cultural'],
    weight: 0.4,
    params: [
      tint('#2e7d32'),
      tint2('#c62828', 'Trim colour'),
      choice('pattern', 'Pattern', 'plaid', FABRIC_PATTERNS),
      color('patternColor', 'Pattern colour', '#c62828', 'cloth', { visibleIf: { key: 'pattern', notIn: ['solid'] } }),
    ],
  },
  { id: 'overalls', label: 'Overalls', tags: ['casual', 'cute', 'farm'], weight: 0.8, params: fabric('#3b5b92', '#f2d14a', [toggle('shorts', 'Short legs', false)]) },
])

const FULL = items('full', [
  { id: 'dress', label: 'Dress', tags: ['cute', 'formal', 'party'], weight: 2, occupies: ['top', 'bottom'], params: fabric('#d81b60', '#f5f2eb', [sleeves('short'), range('length', 'Length', 0.45, { ends: ['Short', 'Long'] }), range('flare', 'Flare', 0.5), choice('neck', 'Neckline', 'scoop', opts('crew:Crew', 'scoop:Scoop', 'v:V-neck', 'sweetheart:Sweetheart'))]) },
  { id: 'gown', label: 'Ball gown', tags: ['royal', 'formal', 'party'], weight: 0.6, occupies: ['top', 'bottom'], params: fabric('#3949ab', '#f2d14a', [sleeves('none')]) },
  { id: 'robe', label: 'Wizard robe', tags: ['fantasy', 'wizard'], weight: 0.8, occupies: ['top', 'bottom'], params: fabric('#283593', '#f2d14a', [toggle('stars', 'Star trim', true)]) },
  { id: 'kimono', label: 'Kimono', tags: ['cultural', 'formal'], weight: 0.6, occupies: ['top', 'bottom'], params: fabric('#c62828', '#fdd835', [color('obi', 'Obi colour', '#26252c', 'cloth')]) },
  { id: 'jumpsuit', label: 'Jumpsuit', tags: ['scifi', 'casual'], weight: 0.8, occupies: ['top', 'bottom'], params: fabric('#ff7043', '#37474f', [sleeves('long'), toggle('belt', 'Belt', true)]) },
  { id: 'spacesuit', label: 'Space suit', tags: ['scifi', 'space'], weight: 0.5, occupies: ['top', 'bottom'], params: [tint('#eceff1', 'Suit'), tint2('#ff7043', 'Panels'), toggle('patch', 'Mission patch', true)] },
  { id: 'hero', label: 'Hero suit', tags: ['hero', 'party'], weight: 0.6, occupies: ['top', 'bottom'], params: [tint('#1e88e5', 'Suit'), tint2('#e53935', 'Trunks & boots'), ...graphic('lightning')] },
  { id: 'knight', label: 'Full armour', tags: ['fantasy', 'knight'], weight: 0.4, occupies: ['top', 'bottom'], params: [tint('#b0bec5', 'Metal', 'metal'), tint2('#c79212', 'Trim', 'metal'), color('tabard', 'Tabard', '#c62828', 'cloth')] },
  { id: 'onesie', label: 'Animal onesie', tags: ['cute', 'cozy', 'animal'], weight: 0.5, occupies: ['top', 'bottom'], params: [tint('#fdd835', 'Colour'), tint2('#f5f2eb', 'Belly'), choice('animal', 'Animal', 'bear', opts('bear:Bear', 'cat:Cat', 'bunny:Bunny', 'dino:Dinosaur', 'frog:Frog', 'panda:Panda')), toggle('hoodUp', 'Hood up', true)] },
  { id: 'wetsuit', label: 'Wetsuit', tags: ['beach', 'sporty'], weight: 0.3, occupies: ['top', 'bottom'], params: [tint('#26252c'), tint2('#00acc1', 'Panels')] },
])

const OUTER = items('outer', [
  { id: 'jacket', label: 'Zip jacket', tags: ['casual', 'sporty'], weight: 2, params: fabric('#e53935', '#26252c', [toggle('open', 'Open', true)]) },
  { id: 'denim', label: 'Denim jacket', tags: ['casual', 'retro'], weight: 1.2, params: fabric('#5c7fb8', '#d9b26f', [toggle('open', 'Open', true)]) },
  { id: 'leather', label: 'Leather jacket', tags: ['rock', 'punk'], weight: 1, params: fabric('#26252c', '#b0bec5', [toggle('open', 'Open', true)]) },
  { id: 'blazer', label: 'Blazer', tags: ['formal'], weight: 1.2, params: fabric('#283593', '#f5f2eb', [toggle('open', 'Open', true)]) },
  { id: 'varsity', label: 'Varsity jacket', tags: ['sporty', 'school', 'retro'], weight: 0.8, params: [...fabric('#c62828', '#f5f2eb', [toggle('open', 'Open', true)]), ...graphic('text')] },
  { id: 'trench', label: 'Long coat', tags: ['formal', 'winter', 'detective'], weight: 0.8, params: fabric('#a1887f', '#6d4c41', [toggle('open', 'Open', true), toggle('belt', 'Belt', true)]) },
  { id: 'puffer', label: 'Puffer jacket', tags: ['winter', 'casual'], weight: 0.8, params: fabric('#039be5', '#26252c') },
  { id: 'cardigan', label: 'Cardigan', tags: ['cozy', 'formal'], weight: 0.8, params: fabric('#c0ca33', '#f5f2eb') },
  { id: 'waistcoat', label: 'Waistcoat', tags: ['formal', 'retro'], weight: 0.6, params: fabric('#4e342e', '#f2d14a') },
  { id: 'labcoat', label: 'Lab coat', tags: ['scifi', 'science'], weight: 0.5, params: fabric('#f5f2eb', '#b0bec5') },
])

const SHOES = items('shoes', [
  { id: 'sneakers', label: 'Sneakers', tags: ['casual', 'sporty'], weight: 4, params: [tint('#f5f2eb'), tint2('#e53935', 'Stripe'), color('sole', 'Sole', '#f5f2eb', 'cloth')] },
  { id: 'hightops', label: 'High-tops', tags: ['casual', 'retro'], weight: 1.5, params: [tint('#e53935'), tint2('#f5f2eb', 'Toe & sole')] },
  { id: 'boots', label: 'Boots', tags: ['winter', 'adventure'], weight: 2, params: [tint('#6d4c41'), tint2('#3e2723', 'Sole')] },
  { id: 'combat', label: 'Combat boots', tags: ['punk', 'military'], weight: 1, params: [tint('#26252c'), tint2('#141319', 'Sole')] },
  { id: 'kneeboots', label: 'Knee boots', tags: ['formal', 'fantasy'], weight: 0.8, params: [tint('#4e342e'), tint2('#26252c', 'Sole')] },
  { id: 'sandals', label: 'Sandals', tags: ['beach'], weight: 1, params: [tint('#a1887f')] },
  { id: 'heels', label: 'Heels', tags: ['formal', 'party'], weight: 0.8, params: [tint('#c62828')] },
  { id: 'loafers', label: 'Loafers', tags: ['formal'], weight: 1, params: [tint('#4e342e')] },
  { id: 'flats', label: 'Flats', tags: ['cute', 'formal'], weight: 1, params: [tint('#26252c'), toggle('bow', 'Bow', true)] },
  { id: 'slippers', label: 'Bunny slippers', tags: ['cute', 'cozy'], weight: 0.4, params: [tint('#f8bbd0')] },
  { id: 'rainboots', label: 'Rain boots', tags: ['cute'], weight: 0.5, params: [tint('#fdd835')] },
  { id: 'cowboy', label: 'Cowboy boots', tags: ['western'], weight: 0.5, params: [tint('#8d5a36'), tint2('#c79212', 'Stitching')] },
  { id: 'skates', label: 'Roller skates', tags: ['retro', 'sporty'], weight: 0.3, params: [tint('#f5f2eb'), tint2('#ec407a', 'Wheels')] },
  { id: 'greaves', label: 'Armoured boots', tags: ['fantasy', 'knight'], weight: 0.4, params: [tint('#b0bec5', 'Metal', 'metal')] },
])

const SOCKS = items('socks', [
  { id: 'ankle', label: 'Ankle socks', tags: ['casual'], weight: 1, params: [tint('#f5f2eb')] },
  { id: 'crew-socks', label: 'Crew socks', tags: ['sporty'], weight: 1, params: [tint('#f5f2eb'), tint2('#e53935', 'Stripes')] },
  { id: 'knee', label: 'Knee socks', tags: ['cute', 'school'], weight: 0.8, params: [tint('#26252c'), tint2('#26252c', 'Stripes')] },
  { id: 'thigh', label: 'Thigh-highs', tags: ['cute', 'anime'], weight: 0.5, params: [tint('#26252c'), toggle('striped', 'Striped', false), tint2('#f5f2eb', 'Stripes')] },
  { id: 'tights', label: 'Tights', tags: ['formal'], weight: 0.5, params: [tint('#3a3a44')] },
])

/* ---- Accessories ------------------------------------------------------------ */

const HATS: ItemSpec[] = items('head', [
  { id: 'cap', label: 'Baseball cap', tags: ['casual', 'sporty'], weight: 3, hides: ['hairTop'], params: [tint('#1e88e5'), tint2('#f5f2eb', 'Brim'), toggle('backwards', 'Backwards', false), ...graphic('none')] },
  { id: 'beanie', label: 'Beanie', tags: ['winter', 'cozy'], weight: 2, hides: ['hairTop'], params: [tint('#e53935'), tint2('#f5f2eb', 'Pom-pom'), toggle('pompom', 'Pom-pom', true)] },
  { id: 'bucket', label: 'Bucket hat', tags: ['casual', 'beach'], weight: 1, hides: ['hairTop'], params: [tint('#c0ca33'), choice('pattern', 'Pattern', 'solid', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth')] },
  { id: 'fedora', label: 'Fedora', tags: ['formal', 'detective', 'retro'], weight: 1, hides: ['hairTop'], params: [tint('#4e342e'), tint2('#26252c', 'Band')] },
  { id: 'tophat', label: 'Top hat', tags: ['formal', 'magic', 'retro'], weight: 0.6, hides: ['hairTop'], params: [tint('#26252c'), tint2('#c62828', 'Band')] },
  { id: 'cowboy-hat', label: 'Cowboy hat', tags: ['western'], weight: 0.6, hides: ['hairTop'], params: [tint('#a1887f'), tint2('#4e342e', 'Band')] },
  { id: 'wizard', label: 'Wizard hat', tags: ['fantasy', 'wizard'], weight: 0.6, hides: ['hairTop'], params: [tint('#283593'), tint2('#f2d14a', 'Stars'), range('droop', 'Droop', 0.5)] },
  { id: 'witch', label: 'Witch hat', tags: ['fantasy', 'spooky'], weight: 0.5, hides: ['hairTop'], params: [tint('#26252c'), tint2('#8e24aa', 'Band')] },
  { id: 'crown', label: 'Crown', tags: ['royal', 'fantasy'], weight: 0.6, kinds: BOTH, params: [tint('#f2d14a', 'Metal', 'metal'), tint2('#e53935', 'Gems')] },
  { id: 'tiara', label: 'Tiara', tags: ['royal', 'cute'], weight: 0.5, params: [tint('#d9d9e0', 'Metal', 'metal'), tint2('#00acc1', 'Gem')] },
  { id: 'beret', label: 'Beret', tags: ['art', 'retro'], weight: 0.6, params: [tint('#c62828')] },
  { id: 'knight-helm', label: 'Knight helmet', tags: ['fantasy', 'knight'], weight: 0.3, hides: ['hair', 'ears'], params: [tint('#b0bec5', 'Metal', 'metal'), tint2('#c62828', 'Plume'), toggle('plume', 'Plume', true)] },
  { id: 'space-helm', label: 'Space helmet', tags: ['scifi', 'space'], weight: 0.3, params: [tint('#eceff1', 'Collar'), tint2('#81d4fa', 'Glass tint')] },
  { id: 'hood', label: 'Cloak hood', tags: ['fantasy', 'mysterious'], weight: 0.6, hides: ['hairTop', 'ears'], params: [tint('#37474f'), tint2('#26252c', 'Lining')] },
  { id: 'headband', label: 'Sweatband', tags: ['sporty', 'retro'], weight: 0.8, params: [tint('#e53935'), tint2('#f5f2eb', 'Stripe')] },
  { id: 'bandana', label: 'Bandana', tags: ['pirate', 'rock'], weight: 0.8, hides: ['hairTop'], params: [tint('#c62828'), choice('pattern', 'Pattern', 'dots', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth')] },
  { id: 'party', label: 'Party hat', tags: ['party'], weight: 0.5, kinds: BOTH, params: [tint('#ec407a'), tint2('#fdd835', 'Stripes')] },
  { id: 'chef', label: 'Chef hat', tags: ['food'], weight: 0.3, hides: ['hairTop'], params: [tint('#f5f2eb')] },
  { id: 'pirate', label: 'Pirate hat', tags: ['pirate'], weight: 0.4, hides: ['hairTop'], params: [tint('#26252c'), tint2('#f2d14a', 'Trim'), toggle('skull', 'Skull', true)] },
  { id: 'viking', label: 'Viking helmet', tags: ['fantasy', 'viking'], weight: 0.3, hides: ['hairTop'], params: [tint('#8a8580', 'Metal', 'metal'), tint2('#f2efe9', 'Horns')] },
  { id: 'santa', label: 'Santa hat', tags: ['winter', 'holiday'], weight: 0.3, kinds: BOTH, hides: ['hairTop'], params: [tint('#c62828'), tint2('#f5f2eb', 'Fur')] },
  { id: 'graduation', label: 'Graduation cap', tags: ['school'], weight: 0.3, hides: ['hairTop'], params: [tint('#26252c'), tint2('#f2d14a', 'Tassel')] },
  { id: 'flower-crown', label: 'Flower crown', tags: ['cute', 'nature'], weight: 0.6, kinds: BOTH, params: [tint('#f48fb1', 'Flowers'), tint2('#7cb342', 'Leaves')] },
  { id: 'hijab', label: 'Hijab', tags: ['cultural'], weight: 0.6, hides: ['hair', 'ears'], params: [tint('#5e35b1'), choice('pattern', 'Pattern', 'solid', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth')] },
  { id: 'turban', label: 'Turban', tags: ['cultural'], weight: 0.5, hides: ['hairTop'], params: [tint('#ff7043')] },
  { id: 'headwrap', label: 'Head wrap', tags: ['cultural'], weight: 0.5, hides: ['hairTop'], params: [tint('#fb8c00'), choice('pattern', 'Pattern', 'zigzag', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#26252c', 'cloth')] },
  { id: 'durag', label: 'Durag', tags: ['cultural', 'casual'], weight: 0.5, hides: ['hairTop'], params: [tint('#26252c')] },
  { id: 'kippah', label: 'Kippah', tags: ['cultural'], weight: 0.3, params: [tint('#283593'), tint2('#f5f2eb', 'Trim')] },
  { id: 'visor', label: 'Sun visor', tags: ['sporty', 'beach'], weight: 0.4, params: [tint('#f5f2eb'), tint2('#1e88e5', 'Brim')] },
])

const HEAD_FEATURES = items('headFeature', [
  { id: 'cat-ears', label: 'Cat ears', tags: ['cute', 'animal', 'anime'], weight: 2, params: [color('color', 'Colour', '', 'hair', { allowAuto: true }), color('color2', 'Inner', '#f48fb1', 'cloth')] },
  { id: 'fox-ears', label: 'Fox ears', tags: ['cute', 'animal'], weight: 1.5, params: [color('color', 'Colour', '#e8a55a', 'nature'), color('color2', 'Tips', '#26252c', 'nature')] },
  { id: 'bunny-ears', label: 'Bunny ears', tags: ['cute', 'animal'], weight: 1.5, params: [color('color', 'Colour', '#f2efe9', 'nature'), color('color2', 'Inner', '#f48fb1', 'cloth'), toggle('floppy', 'Floppy', false)] },
  { id: 'bear-ears', label: 'Bear ears', tags: ['cute', 'animal'], weight: 1, params: [color('color', 'Colour', '', 'hair', { allowAuto: true })] },
  { id: 'wolf-ears', label: 'Wolf ears', tags: ['animal', 'fantasy'], weight: 1, params: [color('color', 'Colour', '#8a8580', 'nature')] },
  { id: 'mouse-ears', label: 'Mouse ears', tags: ['cute', 'animal'], weight: 0.6, params: [color('color', 'Colour', '#26252c', 'nature')] },
  { id: 'devil-horns', label: 'Devil horns', tags: ['spooky', 'fantasy'], weight: 1, params: [color('color', 'Colour', '#c62828', 'cloth')] },
  { id: 'ram-horns', label: 'Ram horns', tags: ['fantasy'], weight: 0.6, params: [color('color', 'Colour', '#e8dcc6', 'nature')] },
  { id: 'unicorn-horn', label: 'Unicorn horn', tags: ['fantasy', 'cute'], weight: 0.5, params: [color('color', 'Colour', '#f8bbd0', 'cloth')] },
  { id: 'antlers', label: 'Antlers', tags: ['fantasy', 'nature', 'holiday'], weight: 0.5, params: [color('color', 'Colour', '#a1887f', 'nature')] },
  { id: 'antennae', label: 'Antennae', tags: ['scifi', 'cute'], weight: 0.5, params: [color('color', 'Colour', '#7cb342', 'cloth'), color('color2', 'Tips', '#fdd835', 'cloth')] },
  { id: 'halo', label: 'Halo', tags: ['fantasy', 'angel'], weight: 0.6, params: [color('color', 'Colour', '#f2d14a', 'metal')] },
])

const HAIR_ACC = items('hairAcc', [
  { id: 'bow', label: 'Bow', tags: ['cute'], weight: 2, params: [tint('#e53935'), toggle('big', 'Big', false)] },
  { id: 'clips', label: 'Hair clips', tags: ['cute', 'anime'], weight: 1.5, params: [tint('#fdd835')] },
  { id: 'flower', label: 'Flower', tags: ['cute', 'nature', 'beach'], weight: 1.5, params: [tint('#f48fb1', 'Petals'), tint2('#fdd835', 'Centre')] },
  { id: 'alice', label: 'Headband', tags: ['cute', 'formal'], weight: 1, params: [tint('#26252c')] },
  { id: 'scrunchie', label: 'Scrunchie', tags: ['retro', 'casual'], weight: 0.8, params: [tint('#ec407a')] },
  { id: 'star-pins', label: 'Star pins', tags: ['cute', 'party'], weight: 0.6, params: [tint('#f2d14a', 'Colour', 'metal')] },
  { id: 'feather', label: 'Feather', tags: ['fantasy', 'boho'], weight: 0.5, params: [tint('#26a69a')] },
  { id: 'beads', label: 'Hair beads', tags: ['cultural'], weight: 0.5, params: [tint('#f2d14a', 'Colour', 'any')] },
])

const EYEWEAR = items('eyes', [
  { id: 'round-glasses', label: 'Round glasses', tags: ['smart', 'retro'], weight: 2, kinds: BOTH, params: [tint('#26252c', 'Frame'), color('color2', 'Lens tint', '', 'cloth', { allowAuto: true })] },
  { id: 'square-glasses', label: 'Square glasses', tags: ['smart'], weight: 2, params: [tint('#26252c', 'Frame')] },
  { id: 'cateye-glasses', label: 'Cat-eye glasses', tags: ['retro', 'formal'], weight: 1, params: [tint('#c62828', 'Frame')] },
  { id: 'half-rims', label: 'Half-rims', tags: ['smart', 'formal'], weight: 1, params: [tint('#6d4c41', 'Frame')] },
  { id: 'aviators', label: 'Aviators', tags: ['cool', 'retro'], weight: 1, kinds: BOTH, params: [tint('#c79212', 'Frame', 'metal'), tint2('#37474f', 'Lens')] },
  { id: 'shades', label: 'Sunglasses', tags: ['cool', 'beach'], weight: 1.5, kinds: BOTH, params: [tint('#141319', 'Frame'), tint2('#26252c', 'Lens')] },
  { id: 'heart-shades', label: 'Heart shades', tags: ['cute', 'party'], weight: 0.5, params: [tint('#ec407a', 'Frame'), tint2('#f48fb1', 'Lens')] },
  { id: 'star-shades', label: 'Star shades', tags: ['party'], weight: 0.4, params: [tint('#fdd835', 'Frame'), tint2('#ff7043', 'Lens')] },
  { id: 'visor-shades', label: 'Cyber visor', tags: ['scifi', 'cool'], weight: 0.5, kinds: BOTH, params: [tint('#26252c', 'Frame'), tint2('#00e5ff', 'Lens')] },
  { id: 'goggles', label: 'Goggles', tags: ['adventure', 'steampunk'], weight: 0.6, kinds: BOTH, params: [tint('#8d5a36', 'Strap'), tint2('#80cbc4', 'Lens'), toggle('onHead', 'On forehead', false)] },
  { id: 'monocle', label: 'Monocle', tags: ['formal', 'retro'], weight: 0.3, kinds: BOTH, params: [tint('#c79212', 'Frame', 'metal')] },
  { id: '3d-glasses', label: '3D glasses', tags: ['retro', 'party'], weight: 0.2, params: [tint('#f5f2eb', 'Frame')] },
])

const FACE_ACC = items('face', [
  { id: 'eyepatch', label: 'Eye patch', tags: ['pirate', 'inclusive'], weight: 0.8, kinds: BOTH, params: [tint('#26252c'), choice('side', 'Side', 'left', opts('left:Left', 'right:Right'))] },
  { id: 'mask', label: 'Face mask', tags: ['casual'], weight: 0.6, hides: ['mouth'], params: [tint('#90caf9')] },
  { id: 'bandit-mask', label: 'Bandit mask', tags: ['hero', 'mysterious'], weight: 0.5, params: [tint('#26252c')] },
  { id: 'masquerade', label: 'Masquerade', tags: ['party', 'formal'], weight: 0.4, params: [tint('#f2d14a', 'Colour', 'metal'), tint2('#8e24aa', 'Feathers')] },
  { id: 'ninja-mask', label: 'Ninja mask', tags: ['ninja', 'mysterious'], weight: 0.4, hides: ['mouth'], params: [tint('#26252c')] },
  { id: 'bandage', label: 'Plaster', tags: ['casual', 'adventure'], weight: 0.6, kinds: BOTH, params: [tint('#e8c885'), choice('side', 'Side', 'right', opts('left:Left', 'right:Right'))] },
  { id: 'nose-ring', label: 'Nose ring', tags: ['punk', 'boho'], weight: 0.5, params: [tint('#d9d9e0', 'Metal', 'metal')] },
  { id: 'nose-stud', label: 'Nose stud', tags: ['boho'], weight: 0.5, params: [tint('#f2d14a', 'Metal', 'metal')] },
  { id: 'lip-ring', label: 'Lip ring', tags: ['punk'], weight: 0.3, params: [tint('#d9d9e0', 'Metal', 'metal')] },
  { id: 'brow-bar', label: 'Brow piercing', tags: ['punk'], weight: 0.3, params: [tint('#d9d9e0', 'Metal', 'metal')] },
  { id: 'clown-nose', label: 'Clown nose', tags: ['party'], weight: 0.2, kinds: BOTH, params: [tint('#e53935')] },
  { id: 'face-gems', label: 'Face gems', tags: ['party', 'cultural'], weight: 0.4, params: [tint('#00acc1', 'Gems')] },
  { id: 'oxygen', label: 'Nasal cannula', tags: ['inclusive'], weight: 0.1, params: [tint('#cfe8f5', 'Tubing')] },
])

const EAR_ACC = items('ears', [
  { id: 'studs', label: 'Studs', tags: ['casual', 'formal'], weight: 2, params: [tint('#f2d14a', 'Metal', 'metal')] },
  { id: 'hoops', label: 'Hoops', tags: ['casual', 'party'], weight: 1.5, params: [tint('#f2d14a', 'Metal', 'metal'), range('size', 'Size', 0.5)] },
  { id: 'drops', label: 'Drop earrings', tags: ['formal', 'party'], weight: 1, params: [tint('#d9d9e0', 'Metal', 'metal'), tint2('#e53935', 'Gem')] },
  { id: 'cuff', label: 'Ear cuff', tags: ['punk', 'fantasy'], weight: 0.5, params: [tint('#d9d9e0', 'Metal', 'metal')] },
  { id: 'headphones', label: 'Headphones', tags: ['gaming', 'music', 'casual'], weight: 1.5, params: [tint('#26252c'), tint2('#e53935', 'Accent')] },
  { id: 'earbuds', label: 'Earbuds', tags: ['casual', 'music'], weight: 0.5, params: [tint('#f5f2eb')] },
  { id: 'hearing-aid', label: 'Hearing aid', tags: ['inclusive'], weight: 0.3, params: [tint('#c9c2b6')] },
  { id: 'cochlear', label: 'Cochlear implant', tags: ['inclusive'], weight: 0.2, params: [tint('#546e7a')] },
])

const NECK_ACC = items('neck', [
  { id: 'chain', label: 'Chain', tags: ['casual', 'rock'], weight: 1.5, kinds: BOTH, params: [tint('#f2d14a', 'Metal', 'metal')] },
  { id: 'pendant', label: 'Pendant', tags: ['fantasy', 'formal'], weight: 1.5, kinds: BOTH, params: [tint('#d9d9e0', 'Metal', 'metal'), tint2('#00acc1', 'Gem'), choice('shape', 'Shape', 'gem', opts('gem:Gem', 'heart:Heart', 'star:Star', 'moon:Moon', 'key:Key'))] },
  { id: 'pearls', label: 'Pearls', tags: ['formal', 'royal'], weight: 0.8, params: [tint('#f2efe9', 'Pearls', 'any')] },
  { id: 'choker', label: 'Choker', tags: ['punk', 'party'], weight: 0.8, params: [tint('#26252c')] },
  { id: 'bowtie', label: 'Bow tie', tags: ['formal', 'party'], weight: 1, kinds: BOTH, params: [tint('#c62828'), choice('pattern', 'Pattern', 'solid', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth')] },
  { id: 'tie', label: 'Necktie', tags: ['formal'], weight: 1, params: [tint('#283593'), choice('pattern', 'Pattern', 'diagonal', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#c62828', 'cloth')] },
  { id: 'scarf', label: 'Scarf', tags: ['winter', 'cozy'], weight: 1.2, kinds: BOTH, params: [tint('#e53935'), choice('pattern', 'Pattern', 'stripes', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth')] },
  { id: 'neck-bandana', label: 'Neck bandana', tags: ['western', 'casual'], weight: 0.8, kinds: BOTH, params: [tint('#1e88e5'), choice('pattern', 'Pattern', 'dots', FABRIC_PATTERNS), color('patternColor', 'Pattern colour', '#f5f2eb', 'cloth')] },
  { id: 'collar', label: 'Collar', tags: ['animal', 'punk'], weight: 0.5, kinds: BOTH, params: [tint('#e53935'), toggle('bell', 'Bell', true), toggle('spikes', 'Spikes', false)] },
  { id: 'medal', label: 'Medal', tags: ['sporty', 'hero'], weight: 0.5, kinds: BOTH, params: [tint('#f2d14a', 'Medal', 'metal'), tint2('#1e88e5', 'Ribbon')] },
  { id: 'lei', label: 'Flower lei', tags: ['beach', 'party'], weight: 0.4, kinds: BOTH, params: [tint('#f48fb1', 'Flowers'), tint2('#fdd835', 'Second flowers')] },
  { id: 'lanyard', label: 'Lanyard', tags: ['work', 'gaming'], weight: 0.3, params: [tint('#1e88e5'), tint2('#f5f2eb', 'Badge')] },
])

const BACK_ACC = items('back', [
  { id: 'backpack', label: 'Backpack', tags: ['casual', 'school', 'adventure'], weight: 2, params: [tint('#fb8c00'), tint2('#6d4c41', 'Straps')] },
  { id: 'angel-wings', label: 'Angel wings', tags: ['fantasy', 'angel'], weight: 1, kinds: BOTH, params: [tint('#f5f2eb'), range('size', 'Size', 0.5)] },
  { id: 'bat-wings', label: 'Bat wings', tags: ['fantasy', 'spooky'], weight: 1, kinds: BOTH, params: [tint('#37474f'), tint2('#8e24aa', 'Membrane'), range('size', 'Size', 0.5)] },
  { id: 'fairy-wings', label: 'Fairy wings', tags: ['fantasy', 'cute'], weight: 1, kinds: BOTH, params: [tint('#80deea'), tint2('#f48fb1', 'Shimmer'), range('size', 'Size', 0.5)] },
  { id: 'butterfly-wings', label: 'Butterfly wings', tags: ['fantasy', 'nature'], weight: 0.6, kinds: BOTH, params: [tint('#fb8c00'), tint2('#26252c', 'Veins'), range('size', 'Size', 0.5)] },
  { id: 'dragon-wings', label: 'Dragon wings', tags: ['fantasy'], weight: 0.6, kinds: BOTH, params: [tint('#2e7d32'), tint2('#c0ca33', 'Membrane'), range('size', 'Size', 0.5)] },
  { id: 'mech-wings', label: 'Mech wings', tags: ['scifi'], weight: 0.4, kinds: BOTH, params: [tint('#b0bec5', 'Metal', 'metal'), tint2('#00e5ff', 'Glow'), range('size', 'Size', 0.5)] },
  { id: 'cape', label: 'Cape', tags: ['hero', 'royal', 'fantasy'], weight: 1.2, kinds: BOTH, params: [tint('#c62828'), tint2('#f2d14a', 'Lining'), range('length', 'Length', 0.6)] },
  { id: 'quiver', label: 'Quiver', tags: ['fantasy', 'adventure'], weight: 0.4, params: [tint('#6d4c41'), tint2('#e53935', 'Fletching')] },
  { id: 'jetpack', label: 'Jetpack', tags: ['scifi'], weight: 0.4, params: [tint('#b0bec5', 'Metal', 'metal'), tint2('#ff7043', 'Flame'), toggle('flames', 'Flames', true)] },
  { id: 'guitar-back', label: 'Guitar case', tags: ['music'], weight: 0.4, params: [tint('#26252c')] },
  { id: 'sword-back', label: 'Sheathed sword', tags: ['fantasy', 'ninja'], weight: 0.5, params: [tint('#6d4c41', 'Sheath'), tint2('#c79212', 'Hilt', 'metal')] },
  { id: 'shell-pack', label: 'Turtle shell', tags: ['animal', 'cute'], weight: 0.3, params: [tint('#7cb342'), tint2('#c0ca33', 'Plates')] },
])

const WAIST_ACC = items('waist', [
  { id: 'belt', label: 'Belt', tags: ['casual', 'formal'], weight: 3, params: [tint('#4e342e'), tint2('#c79212', 'Buckle', 'metal')] },
  { id: 'utility', label: 'Utility belt', tags: ['hero', 'adventure'], weight: 0.8, params: [tint('#6b6b4b'), tint2('#c79212', 'Buckle', 'metal')] },
  { id: 'sash', label: 'Sash', tags: ['royal', 'fantasy'], weight: 0.6, params: [tint('#c62828'), tint2('#f2d14a', 'Knot')] },
  { id: 'fannypack', label: 'Belt bag', tags: ['casual', 'retro'], weight: 0.6, params: [tint('#ec407a'), tint2('#26252c', 'Strap')] },
])

const WRIST_ACC = items('wrist', [
  { id: 'watch', label: 'Watch', tags: ['formal', 'casual'], weight: 2, params: [tint('#26252c', 'Strap'), tint2('#d9d9e0', 'Face', 'metal'), choice('side', 'Wrist', 'left', opts('left:Left', 'right:Right'))] },
  { id: 'bracelet', label: 'Bracelet', tags: ['casual', 'cute'], weight: 1.5, params: [tint('#f2d14a', 'Colour', 'any'), choice('side', 'Wrist', 'right', opts('left:Left', 'right:Right', 'both:Both'))] },
  { id: 'wristband', label: 'Sweatband', tags: ['sporty'], weight: 1, params: [tint('#e53935'), choice('side', 'Wrist', 'both', opts('left:Left', 'right:Right', 'both:Both'))] },
  { id: 'bangles', label: 'Bangles', tags: ['cultural', 'party'], weight: 0.6, params: [tint('#f2d14a', 'Metal', 'metal'), choice('side', 'Wrist', 'both', opts('left:Left', 'right:Right', 'both:Both'))] },
])

const GLOVES = items('hands', [
  { id: 'gloves', label: 'Gloves', tags: ['winter', 'formal'], weight: 1, params: [tint('#26252c')] },
  { id: 'fingerless', label: 'Fingerless gloves', tags: ['punk', 'gaming'], weight: 0.8, params: [tint('#26252c')] },
  { id: 'mittens', label: 'Mittens', tags: ['winter', 'cute'], weight: 0.5, params: [tint('#e53935'), tint2('#f5f2eb', 'Cuff')] },
  { id: 'boxing', label: 'Boxing gloves', tags: ['sporty'], weight: 0.3, params: [tint('#c62828')] },
  { id: 'gauntlets', label: 'Gauntlets', tags: ['fantasy', 'knight'], weight: 0.4, params: [tint('#b0bec5', 'Metal', 'metal')] },
])

const HELD: Omit<Def, 'slot'>[] = [
  { id: 'sword', label: 'Sword', tags: ['fantasy', 'knight'], weight: 1.2, params: [tint('#d9d9e0', 'Blade', 'metal'), tint2('#c79212', 'Hilt', 'metal')] },
  { id: 'staff', label: 'Magic staff', tags: ['fantasy', 'wizard'], weight: 1, params: [tint('#6d4c41', 'Wood', 'nature'), tint2('#00e5ff', 'Orb')] },
  { id: 'wand', label: 'Wand', tags: ['fantasy', 'wizard', 'magic'], weight: 1, params: [tint('#4e342e', 'Wood', 'nature'), tint2('#fdd835', 'Sparkle')] },
  { id: 'shield', label: 'Shield', tags: ['fantasy', 'knight'], weight: 0.8, params: [tint('#1e88e5', 'Face'), tint2('#c79212', 'Rim', 'metal'), choice('crest', 'Crest', 'star', opts('none:None', 'star:Star', 'cross:Cross', 'lion:Lion', 'dragon:Dragon'))] },
  { id: 'bow-weapon', label: 'Bow', tags: ['fantasy', 'adventure'], weight: 0.6, params: [tint('#8d5a36', 'Wood', 'nature')] },
  { id: 'torch', label: 'Torch', tags: ['adventure', 'dungeon'], weight: 0.5, params: [tint('#6d4c41', 'Handle', 'nature')] },
  { id: 'lantern', label: 'Lantern', tags: ['adventure', 'spooky'], weight: 0.5, params: [tint('#37474f', 'Frame', 'metal'), tint2('#fdd835', 'Light')] },
  { id: 'phone', label: 'Phone', tags: ['casual'], weight: 1, params: [tint('#26252c', 'Case')] },
  { id: 'controller', label: 'Game controller', tags: ['gaming'], weight: 1, params: [tint('#26252c'), tint2('#f2d14a', 'Buttons')] },
  { id: 'book', label: 'Book', tags: ['smart', 'school', 'wizard'], weight: 0.8, params: [tint('#c62828', 'Cover')] },
  { id: 'balloon', label: 'Balloon', tags: ['party', 'cute'], weight: 0.8, params: [tint('#e53935')] },
  { id: 'flower-held', label: 'Flower', tags: ['cute', 'nature'], weight: 0.6, params: [tint('#e53935', 'Petals'), tint2('#7cb342', 'Stem')] },
  { id: 'icecream', label: 'Ice cream', tags: ['cute', 'food', 'beach'], weight: 0.6, params: [tint('#f48fb1', 'Scoop')] },
  { id: 'coffee', label: 'Coffee', tags: ['casual', 'work'], weight: 0.6, params: [tint('#f5f2eb', 'Cup'), tint2('#6d4c41', 'Sleeve')] },
  { id: 'mic', label: 'Microphone', tags: ['music', 'party'], weight: 0.5, params: [tint('#26252c')] },
  { id: 'flag', label: 'Flag', tags: ['sporty', 'party'], weight: 0.4, params: [tint('#e53935', 'Flag'), tint2('#f5f2eb', 'Second colour')] },
  { id: 'umbrella', label: 'Umbrella', tags: ['cute'], weight: 0.4, params: [tint('#1e88e5', 'Canopy'), tint2('#f5f2eb', 'Stripes')] },
  { id: 'trophy', label: 'Trophy', tags: ['sporty', 'hero'], weight: 0.4, params: [tint('#f2d14a', 'Metal', 'metal')] },
  { id: 'orb', label: 'Magic orb', tags: ['fantasy', 'magic'], weight: 0.5, params: [tint('#8e24aa', 'Glow')] },
  { id: 'pickaxe', label: 'Pickaxe', tags: ['adventure', 'mining'], weight: 0.4, params: [tint('#8a8580', 'Head', 'metal'), tint2('#8d5a36', 'Handle', 'nature')] },
  { id: 'paintbrush', label: 'Paintbrush', tags: ['art'], weight: 0.4, params: [tint('#e53935', 'Paint')] },
  { id: 'teddy', label: 'Teddy bear', tags: ['cute', 'cozy'], weight: 0.4, params: [tint('#a86b3c', 'Fur', 'nature')] },
  { id: 'lollipop', label: 'Lollipop', tags: ['cute', 'food'], weight: 0.4, params: [tint('#ec407a', 'Candy'), tint2('#f5f2eb', 'Swirl')] },
  { id: 'basketball', label: 'Ball', tags: ['sporty'], weight: 0.5, params: [tint('#fb8c00', 'Ball'), choice('sport', 'Sport', 'basketball', opts('basketball:Basketball', 'soccer:Football', 'volleyball:Volleyball'))] },
]

const HANDS_R = items('handR', HELD)
const HANDS_L = items('handL', HELD.map((h) => ({ ...h, id: `${h.id}-l` })))

const TAILS = items('tailAcc', [
  { id: 'cat-tail', label: 'Cat tail', tags: ['cute', 'animal'], weight: 1.5, params: [color('color', 'Colour', '', 'hair', { allowAuto: true })] },
  { id: 'fox-tail', label: 'Fox tail', tags: ['animal', 'cute'], weight: 1, params: [color('color', 'Colour', '#e8a55a', 'nature'), color('color2', 'Tip', '#f2efe9', 'nature')] },
  { id: 'devil-tail', label: 'Devil tail', tags: ['spooky'], weight: 0.8, params: [color('color', 'Colour', '#c62828', 'cloth')] },
  { id: 'dragon-tail', label: 'Dragon tail', tags: ['fantasy'], weight: 0.6, params: [color('color', 'Colour', '#2e7d32', 'nature'), color('color2', 'Spines', '#c0ca33', 'nature')] },
  { id: 'bunny-tail', label: 'Bunny tail', tags: ['cute'], weight: 0.4, params: [color('color', 'Colour', '#f2efe9', 'nature')] },
  { id: 'monkey-tail', label: 'Monkey tail', tags: ['animal', 'adventure'], weight: 0.3, params: [color('color', 'Colour', '#8d5a36', 'nature')] },
])

const AURAS = items('aura', [
  { id: 'glow', label: 'Glow', tags: ['fantasy', 'magic'], weight: 1.5, kinds: BOTH, params: [tint('#fdd835', 'Colour', 'any'), range('strength', 'Strength', 0.6)] },
  { id: 'sparkles', label: 'Sparkles', tags: ['cute', 'magic'], weight: 1.5, kinds: BOTH, params: [tint('#fdd835', 'Colour', 'any')] },
  { id: 'hearts', label: 'Floating hearts', tags: ['cute', 'love'], weight: 1, kinds: BOTH, params: [tint('#ec407a', 'Colour', 'any')] },
  { id: 'fire', label: 'Flame aura', tags: ['fantasy', 'hero'], weight: 0.8, kinds: BOTH, params: [tint('#ff7043', 'Colour', 'any')] },
  { id: 'bubbles', label: 'Bubbles', tags: ['water', 'cute'], weight: 0.6, kinds: BOTH, params: [tint('#81d4fa', 'Colour', 'any')] },
  { id: 'snow', label: 'Snowflakes', tags: ['winter'], weight: 0.6, kinds: BOTH, params: [tint('#e0f7fa', 'Colour', 'any')] },
  { id: 'leaves', label: 'Leaves', tags: ['nature'], weight: 0.6, kinds: BOTH, params: [tint('#7cb342', 'Colour', 'any')] },
  { id: 'lightning', label: 'Lightning', tags: ['hero', 'scifi'], weight: 0.5, kinds: BOTH, params: [tint('#40c4ff', 'Colour', 'any')] },
  { id: 'music', label: 'Music notes', tags: ['music', 'party'], weight: 0.5, kinds: BOTH, params: [tint('#b388ff', 'Colour', 'any')] },
  { id: 'shadow-aura', label: 'Shadow', tags: ['spooky', 'mysterious'], weight: 0.4, kinds: BOTH, params: [tint('#4a148c', 'Colour', 'any')] },
  { id: 'pixels', label: 'Pixels', tags: ['gaming', 'scifi'], weight: 0.4, kinds: BOTH, params: [tint('#00e676', 'Colour', 'any')] },
  { id: 'petals', label: 'Petals', tags: ['nature', 'cute'], weight: 0.4, kinds: BOTH, params: [tint('#f8bbd0', 'Colour', 'any')] },
])

export const PET_SPECIES = opts(
  'random:Surprise me',
  'cat:Cat',
  'dog:Dog',
  'fox:Fox',
  'bunny:Bunny',
  'dragon:Dragon',
  'owl:Owl',
  'slime:Slime',
  'ghost:Ghost',
  'octopus:Octopus',
  'robot:Robot',
  'fish:Fish',
  'bee:Bee',
)

const COMPANIONS = items('companion', [
  {
    id: 'pet',
    label: 'Pet companion',
    tags: ['cute', 'animal'],
    weight: 1,
    kinds: BOTH,
    params: [
      choice('species', 'Species', 'random', PET_SPECIES),
      range('seed', 'Variation', 1, { min: 0, max: 999, step: 1, random: { mode: 'uniform' } }),
      color('color', 'Colour', '', 'nature', { allowAuto: true }),
      choice('place', 'Position', 'ground', opts('ground:At my feet', 'float:Floating', 'shoulder:On my shoulder')),
      range('size', 'Size', 0.5),
    ],
  },
])

/** User-supplied art. The asset itself travels in `ItemRef.asset`. */
export const CUSTOM_ANCHORS = opts(
  'head:Top of head',
  'face:Face',
  'eyes:Eyes',
  'neck:Neck',
  'chest:Chest',
  'back:Back',
  'waist:Waist',
  'handL:Left hand',
  'handR:Right hand',
  'feet:Feet',
  'float:Floating',
  'background:Background',
)

const CUSTOM = items('custom', [
  {
    id: 'custom',
    label: 'Custom accessory',
    tags: ['custom'],
    weight: 0,
    kinds: BOTH,
    params: [
      choice('anchor', 'Attach to', 'head', CUSTOM_ANCHORS),
      range('x', 'Horizontal', 0.5, { random: { mode: 'keep' } }),
      range('y', 'Vertical', 0.5, { random: { mode: 'keep' } }),
      range('scale', 'Scale', 0.5, { random: { mode: 'keep' } }),
      range('rotation', 'Rotation', 0.5, { random: { mode: 'keep' } }),
      toggle('flip', 'Mirror', false, { random: { mode: 'keep' } }),
      choice('layer', 'Layer', 'front', opts('front:In front', 'behind:Behind the body', 'top:Above everything')),
      color('tint', 'Tint', '', 'any', { allowAuto: true, help: 'Recolours single-colour art.' }),
      range('opacity', 'Opacity', 1, { random: { mode: 'keep' } }),
    ],
  },
])

/* ---- Limited editions -------------------------------------------------------- */

/** End of the launch window (the same instant as the launch promo, `PROMO.until`). */
export const LAUNCH_UNTIL = '2026-10-07T23:59:59Z'

/** A colour that can't be changed: a one-option choice, so normalization always restores
 *  it (a Founder crown always looks like one). Art reads it like any colour. */
const fixedColor = (key: string, label: string, hex: string, name: string): ParamSpec =>
  choice(key, label, hex, [{ id: hex, label: name }], { advanced: true, random: { mode: 'keep' } })

/** Launch limited editions. New ids that reuse existing art (`art`); never picked at
 *  random (weight 0). */
const LIMITED: ItemSpec[] = [
  {
    id: 'founder-crown',
    label: 'Founder crown',
    slot: 'head',
    art: 'crown',
    kinds: BOTH,
    tags: ['royal', 'founder'],
    weight: 0,
    tier: 'limited',
    limited: { until: LAUNCH_UNTIL },
    params: [fixedColor('color', 'Metal', '#f5c542', 'Founder gold'), fixedColor('color2', 'Gems', '#7c3aed', 'Founder amethyst')],
  },
  {
    id: 'founder-halo',
    label: 'Founder halo',
    slot: 'headFeature',
    art: 'halo',
    kinds: H,
    tags: ['angel', 'founder'],
    weight: 0,
    tier: 'limited',
    limited: { until: LAUNCH_UNTIL },
    params: [fixedColor('color', 'Colour', '#ffd54f', 'Founder gold')],
  },
  {
    id: 'founder-cape',
    label: 'Founder cape',
    slot: 'back',
    art: 'cape',
    kinds: BOTH,
    tags: ['royal', 'founder'],
    weight: 0,
    tier: 'limited',
    limited: { until: LAUNCH_UNTIL },
    params: [fixedColor('color', 'Colour', '#4a148c', 'Founder purple'), fixedColor('color2', 'Lining', '#f5c542', 'Founder gold'), range('length', 'Length', 0.6)],
  },
  {
    id: 'founder-wings',
    label: 'Founder wings',
    slot: 'back',
    art: 'angel-wings',
    kinds: BOTH,
    tags: ['angel', 'founder'],
    weight: 0,
    tier: 'limited',
    limited: { until: LAUNCH_UNTIL },
    params: [fixedColor('color', 'Colour', '#ffe08a', 'Founder gold'), range('size', 'Size', 0.5)],
  },
  {
    id: 'founder-sparkles',
    label: 'Founder sparkles',
    slot: 'aura',
    art: 'sparkles',
    kinds: BOTH,
    tags: ['magic', 'founder'],
    weight: 0,
    tier: 'limited',
    limited: { until: LAUNCH_UNTIL },
    params: [fixedColor('color', 'Colour', '#ffd54f', 'Founder gold')],
  },
]

/* ---- Paid items ------------------------------------------------------------- */

/**
 * THE table of paid items: edit this one list to change what costs money. An entry is an
 * item id (its left-hand twin `<id>-l` follows it) or `slot:<slot id>` for every item in
 * that slot. Everything not listed is free. Limited and NFT-only items set their tier on
 * their own spec (above). Proposed launch list; the owner refines it.
 */
export const PAID_ITEMS: readonly string[] = [
  // Every aura, the pet companion and custom uploads.
  'slot:aura',
  'slot:companion',
  'slot:custom',
  // Fantasy back items.
  'angel-wings',
  'bat-wings',
  'fairy-wings',
  'butterfly-wings',
  'dragon-wings',
  'mech-wings',
  'jetpack',
  // Fantasy and royal headwear.
  'crown',
  'tiara',
  'space-helm',
  'knight-helm',
  'viking',
  'wizard',
  'halo',
  // Magic held items (both hands).
  'sword',
  'staff',
  'wand',
  'orb',
  'trophy',
]

export const GARMENTS: ItemSpec[] = [...TOPS, ...BOTTOMS, ...FULL, ...OUTER, ...SHOES, ...SOCKS]

export const ACCESSORIES: ItemSpec[] = [
  ...HATS,
  ...HEAD_FEATURES,
  ...HAIR_ACC,
  ...EYEWEAR,
  ...FACE_ACC,
  ...EAR_ACC,
  ...NECK_ACC,
  ...BACK_ACC,
  ...WAIST_ACC,
  ...WRIST_ACC,
  ...GLOVES,
  ...HANDS_R,
  ...HANDS_L,
  ...TAILS,
  ...AURAS,
  ...COMPANIONS,
  ...CUSTOM,
  ...LIMITED,
]

export const ALL_ITEMS: ItemSpec[] = [...GARMENTS, ...ACCESSORIES]

const byId = new Map(ALL_ITEMS.map((i) => [i.id, i]))
export const itemSpec = (id: string): ItemSpec | undefined => byId.get(id)

/** The item a purchase or entitlement is recorded against: `sword-l` (the left-hand twin)
 *  is owned together with `sword`; every other item is its own. */
export const entitlementItemId = (id: string): string => (id.endsWith('-l') && byId.get(id)?.slot === 'handL' ? id.slice(0, -2) : id)

/** The art an item draws with: its `art` (limited variants), else the left-hand twin's
 *  right-hand item (`sword-l` draws exactly like `sword`, in the left hand), else itself. */
export const baseItemId = (id: string): string => byId.get(id)?.art ?? entitlementItemId(id)

// Apply the paid table. Explicit tiers on a spec win; `premium` stays in step with the tier.
{
  const paid = new Set(PAID_ITEMS)
  for (const it of ALL_ITEMS) {
    if (it.nftOnly) it.tier = 'nft'
    if (!it.tier && (it.premium || paid.has(`slot:${it.slot}`) || paid.has(entitlementItemId(it.id)))) it.tier = 'paid'
    if (it.tier && it.tier !== 'free') it.premium = true
  }
}

/** An item's tier (`free` for unknown ids, so they never count). */
export function itemTier(id: string): ItemTier {
  const spec = byId.get(id)
  if (!spec) return 'free'
  return spec.nftOnly ? 'nft' : (spec.tier ?? (spec.premium ? 'paid' : 'free'))
}

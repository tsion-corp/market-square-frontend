/* Sections every avatar has, whatever its kind: expression, pose, scene and style. */

import { choice, color, opts, range, toggle, type ParamSpec } from '../params.ts'
import type { SectionSpec } from './types.ts'

export const EXPRESSIONS = opts(
  'neutral:Neutral||6',
  'happy:Happy||6',
  'grin:Grin||3',
  'laugh:Laugh||2',
  'smirk:Smirk||2',
  'excited:Excited||2',
  'love:In love|cute|1',
  'wink:Wink||1.5',
  'tongue:Cheeky||1',
  'cool:Cool||1.5',
  'smug:Smug||1',
  'determined:Determined||1.5',
  'surprised:Surprised||1',
  'shocked:Shocked||0.6',
  'sad:Sad||0.6',
  'cry:Crying||0.4',
  'worried:Worried||0.6',
  'scared:Scared||0.4',
  'angry:Angry||0.6',
  'furious:Furious||0.3',
  'pout:Pout||0.6',
  'embarrassed:Embarrassed||0.6',
  'confused:Confused||0.6',
  'bored:Bored||0.5',
  'sleepy:Sleepy||0.5',
  'dizzy:Dizzy||0.3',
  'sick:Queasy||0.2',
  'mischief:Mischievous||0.6',
)

export const POSES = opts(
  'stand:Standing||6',
  'relaxed:Relaxed||4',
  'hands-hips:Hands on hips||2',
  'wave:Wave||2',
  'peace:Peace sign||1.5',
  'thumbs-up:Thumbs up||1.5',
  'point:Point||1',
  'cheer:Cheer||1.5',
  'arms-crossed:Arms crossed||1.5',
  'think:Thinking||1',
  'shrug:Shrug||1',
  'flex:Flex||0.8',
  'salute:Salute||0.6',
  'fight:Fighting stance||0.8',
  'cast:Casting||0.6',
  'heart:Heart hands|cute|0.6',
  'sit:Sitting||0.8',
  'run:Running||0.5',
  'jump:Jumping||0.5',
)

const expression: ParamSpec[] = [
  choice('preset', 'Expression', 'happy', EXPRESSIONS, { preview: 'face' }),
  range('intensity', 'Intensity', 0.8, { random: { mode: 'normal', sd: 0.15, min: 0.4 } }),
  range('lookX', 'Look sideways', 0.5, { ends: ['Left', 'Right'], random: { mode: 'normal', sd: 0.12 } }),
  range('lookY', 'Look up/down', 0.5, { ends: ['Up', 'Down'], random: { mode: 'normal', sd: 0.08 } }),
  range('tilt', 'Head tilt', 0.5, { ends: ['Left', 'Right'], random: { mode: 'normal', sd: 0.1 } }),
]

const pose: ParamSpec[] = [
  choice('preset', 'Pose', 'stand', POSES, { preview: 'full' }),
  choice('hold', 'Hand pose', 'auto', opts('auto:Pose default||10', 'open:Open', 'fist:Fist', 'relaxed:Relaxed')),
]

export const SCENE_PRESETS = opts(
  'sky:Blue sky',
  'sunset:Sunset',
  'night:Starry night',
  'forest:Forest',
  'meadow:Meadow',
  'beach:Beach',
  'city:City skyline',
  'snow:Snowfall',
  'space:Outer space',
  'underwater:Underwater',
  'dungeon:Dungeon',
  'stage:Stage lights',
  'volcano:Volcano',
  'candy:Candyland',
)

export const BG_PATTERNS = opts(
  'dots:Polka dots',
  'stripes:Stripes',
  'checker:Checker',
  'grid:Grid',
  'stars:Stars',
  'hearts:Hearts',
  'confetti:Confetti',
  'zigzag:Zig-zag',
  'waves:Waves',
  'rays:Sunburst',
  'hex:Honeycomb',
)

const scene: ParamSpec[] = [
  choice(
    'background',
    'Background',
    'gradient',
    opts('none:Transparent||1', 'solid:Solid colour||2', 'gradient:Gradient||4', 'radial:Glow||2', 'pattern:Pattern||2', 'scene:Scene||2'),
  ),
  color('color1', 'Colour', '#2b3a67', 'cloth', { visibleIf: { key: 'background', notIn: ['none', 'scene'] } }),
  color('color2', 'Second colour', '#6b4a8b', 'cloth', { visibleIf: { key: 'background', in: ['gradient', 'radial', 'pattern'] } }),
  range('angle', 'Gradient angle', 0.5, { visibleIf: { key: 'background', in: ['gradient'] }, random: { mode: 'uniform' } }),
  choice('pattern', 'Pattern', 'dots', BG_PATTERNS, { visibleIf: { key: 'background', in: ['pattern'] } }),
  choice('preset', 'Scene', 'sky', SCENE_PRESETS, { visibleIf: { key: 'background', in: ['scene'] } }),
  choice(
    'frame',
    'Frame',
    'none',
    opts('none:None||6', 'circle:Circle||3', 'rounded:Rounded square||2', 'hexagon:Hexagon||1', 'shield:Shield||1', 'star:Star||0.4', 'diamond:Diamond||0.6', 'arch:Arch||0.6'),
    { random: { mode: 'keep' } },
  ),
  choice(
    'ring',
    'Frame border',
    'none',
    opts('none:None||4', 'solid:Solid||2', 'double:Double||1', 'gold:Gold||1', 'silver:Silver||1', 'bronze:Bronze||0.6', 'rainbow:Rainbow||0.6', 'dashed:Dashed||0.6', 'glow:Glow||0.6', 'laurel:Laurel||0.3'),
    { visibleIf: { key: 'frame', notIn: ['none'] }, random: { mode: 'keep' } },
  ),
  color('ringColor', 'Border colour', '#f2d14a', 'any', { visibleIf: { key: 'ring', in: ['solid', 'double', 'dashed', 'glow'] } }),
  toggle('shadow', 'Ground shadow', true, { random: { mode: 'keep' } }),
]

const style: ParamSpec[] = [
  range('outline', 'Outline', 0.4, { ends: ['None', 'Bold'], random: { mode: 'keep' } }),
  choice('ink', 'Line colour', 'auto', opts('auto:Tinted||6', 'dark:Dark||3', 'black:Black||1', 'white:White||0.2'), { random: { mode: 'keep' } }),
  choice('shading', 'Shading', 'cel', opts('flat:Flat||1', 'cel:Cel||4', 'soft:Soft||2', 'rim:Cel + rim light||1'), { random: { mode: 'keep' } }),
  range('light', 'Light direction', 0.3, { ends: ['Left', 'Right'], random: { mode: 'keep' } }),
  choice(
    'grade',
    'Colour grade',
    'none',
    opts('none:Natural||10', 'vivid:Vivid', 'pastel:Pastel', 'muted:Muted', 'warm:Warm', 'cool:Cool', 'mono:Monochrome', 'sepia:Sepia', 'noir:Noir', 'neon:Neon'),
    { random: { mode: 'keep' } },
  ),
  choice('detail', 'Detail', 'high', opts('low:Low (icons, pixel art)', 'medium:Medium', 'high:High||10'), { random: { mode: 'keep' } }),
]

export const SHARED_SECTIONS: SectionSpec[] = [
  { id: 'expression', label: 'Expression', tab: 'expression', kinds: ['humanoid', 'creature'], params: expression },
  { id: 'pose', label: 'Pose', tab: 'expression', kinds: ['humanoid'], params: pose },
  { id: 'scene', label: 'Scene', tab: 'scene', kinds: ['humanoid', 'creature'], params: scene },
  { id: 'style', label: 'Art style', tab: 'style', kinds: ['humanoid', 'creature'], params: style },
]

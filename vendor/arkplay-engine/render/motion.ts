/* Ambient motion for still renders (RenderOptions.motion → ctx.motion).
 *
 * Auras, particle effects and scene particles loop by themselves in a still SVG through
 * CSS keyframes embedded in the document's <defs>. Browsers play them; resvg ignores
 * @keyframes and draws the base geometry, so the base geometry must be a good frame.
 * Everything is scoped to the document's id prefix, because an inline SVG's <style> applies
 * to the whole HTML page (the studio shows many avatars at once).
 *
 * Two rules for callers:
 *  - Put the class on an element WITHOUT a `transform` attribute: a CSS transform replaces
 *    the attribute. Position with a wrapping <g transform> (or path coordinates) and animate
 *    the inner element.
 *  - Keyframes are in user units (px = world units here) and loop seamlessly: the last
 *    keyframe must equal the first, or the motion must be periodic (0% → 100% of a cycle).
 *
 * Only for stills: when a clip is playing (`anim`), effects are driven by the frame time
 * instead, which is what sprite sheets, GIFs and animated SVG exports sample. */

import type { Ctx } from './context.ts'

export interface MotionOptions {
  /** Seconds per loop. */
  duration: number
  /** CSS timing function (default linear). */
  timing?: string
  /** transform-origin inside the element's own box (default center). */
  origin?: string
  /** `alternate` plays forward then back (for pulses that aren't written as a full cycle). */
  direction?: 'normal' | 'alternate'
}

/**
 * Registers `@keyframes` (the body only, e.g. `0%{…}100%{…}`) once per document under
 * `key` and returns the class name that plays it. Returns '' when motion is off, so
 * callers can always write `class="${motionClass(…)}"`.
 */
export function motionClass(c: Ctx, key: string, keyframes: string, o: MotionOptions): string {
  if (!c.motion) return ''
  return c.defs.add(`m-${key}`, (id) => {
    const anim = `${id} ${+o.duration.toFixed(3)}s ${o.timing ?? 'linear'} infinite${o.direction === 'alternate' ? ' alternate' : ''}`
    return (
      `<style>@keyframes ${id}{${keyframes}}` +
      `.${id}{animation:${anim};transform-box:fill-box;transform-origin:${o.origin ?? 'center'}}` +
      `@media (prefers-reduced-motion: reduce){.${id}{animation:none}}</style>`
    )
  })
}

/** `style` attribute value that offsets one element within the loop (seconds into it). */
export const motionPhase = (seconds: number): string => `animation-delay:${-Math.abs(+seconds.toFixed(3))}s`

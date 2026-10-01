"use client";

import type { AvatarDNA, RenderCrop, RenderDetail, RenderView } from "./arkplay-catalog.ts";

/*
  DRAWING THE AVATAR HERE, INSTEAD OF ASKING FOR IT.

  Every change used to be a round trip: post the document, wait, show the
  answer. Measured, that is about 1,900ms at the size a cover needs — so every
  tap was a spinner followed by a result, and nobody could see a change as they
  made it.

  The same render in process takes 1.9ms at `detail: low`. A thousandfold is
  not something a debounce or a cache can close; it is the difference between
  asking a server to draw and drawing.

  ─── IT IS LOADED ONLY WHEN SOMEBODY OPENS THE STUDIO ───────────────────────
  The renderer is 1.5MB of source — far too much for every reader of the app,
  and nothing at all for the few who open the editor. So it is behind a dynamic
  `import()`, which puts it in its own chunk that the studio route fetches once
  and keeps. The module is cached after the first call, so the wait happens
  once rather than per edit.

  ─── THE SERVER STILL DRAWS WHAT IS SAVED ───────────────────────────────────
  A cover is `GET /render/{code}.png`: a public, immutable, CDN-cacheable URL
  that every visitor to a profile shares. This is only the LIVE preview, which
  is private to the person editing and never worth a request.
*/

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type RenderSVG = (
  dna: AvatarDNA,
  opts: {
    crop?: RenderCrop;
    size?: number;
    view?: RenderView;
    detail?: RenderDetail;
    viewBox?: Box;
  },
) => string;

let loading: Promise<RenderSVG> | null = null;

/** The renderer, fetched once and reused. */
function engine(): Promise<RenderSVG> {
  loading ??= import("@/vendor/arkplay-engine/render/render.ts").then(
    (m) => m.renderSVG as unknown as RenderSVG,
  );
  return loading;
}

/** Warm the chunk before the first edit, so even that one is instant. */
export function preloadRenderer(): void {
  void engine().catch(() => {
    /* The studio falls back to the service; nothing to report here. */
  });
}

export interface LocalRenderOptions {
  crop?: RenderCrop;
  view?: RenderView;
  size?: number;
  detail?: RenderDetail;
  /**
   * Draw a WIDE picture instead of a square one — width ÷ height of the card
   * this is going into.
   *
   * The crops are all square, which is why a cover could only ever letterbox
   * the scene or crop the character out of it. But the engine takes a
   * `viewBox` that "overrides the crop box entirely", and it draws the scene
   * to fill whatever box it is given — so asking for a 741x473 box yields a
   * widescreen scene with the whole character standing in it, which is the
   * thing the card wanted all along.
   *
   * This is local-only. The service's HTTP render exposes no such parameter
   * (probed: width, height, aspect, ratio, zoom, pad, margin are all ignored),
   * so a saved cover is still square until they pass `viewBox` through.
   */
  aspect?: number;
}

/**
 * A picture of the document, drawn here and now.
 *
 * Returns a blob URL the caller owns and must revoke — an SVG string handed
 * straight to `<img src>` as a data URI would re-encode 60KB on every edit,
 * and innerHTML would hand the engine's output to the DOM as markup.
 */
export async function renderLocally(
  dna: AvatarDNA,
  { crop = "full", view, size = 512, detail = "medium", aspect }: LocalRenderOptions = {},
): Promise<string> {
  const renderSVG = await engine();
  const svg = aspect
    ? renderSVG(dna, { size, view, detail, viewBox: widen(renderSVG, dna, crop, view, aspect) })
    : renderSVG(dna, { crop, size, view, detail });
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

/**
 * The crop's own box, stretched sideways to an aspect and left centred.
 *
 * The box is read back off a throwaway render rather than computed here,
 * because `cropBox` depends on the posed model and reproducing that would be a
 * second copy of their geometry to keep in step with the first. A render costs
 * about 2ms, so measuring with one is cheaper than being wrong.
 *
 * Only the WIDTH grows: keeping the height means the character stays exactly
 * as tall as the crop intended, and the extra width is scene.
 */
function widen(
  renderSVG: RenderSVG,
  dna: AvatarDNA,
  crop: RenderCrop,
  view: RenderView | undefined,
  aspect: number,
): Box | undefined {
  const probe = renderSVG(dna, { crop, size: 16, view });
  const found = /viewBox="([-\d. ]+)"/.exec(probe);
  if (!found) return undefined;
  const [x, y, w, h] = found[1].trim().split(/\s+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite) || h <= 0) return undefined;
  const width = h * aspect;
  return { x: x + (w - width) / 2, y, w: width, h };
}

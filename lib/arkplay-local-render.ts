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

type RenderSVG = (
  dna: AvatarDNA,
  opts: { crop?: RenderCrop; size?: number; view?: RenderView; detail?: RenderDetail },
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
  { crop = "full", view, size = 512, detail = "medium" }: LocalRenderOptions = {},
): Promise<string> {
  const renderSVG = await engine();
  const svg = renderSVG(dna, { crop, size, view, detail });
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}

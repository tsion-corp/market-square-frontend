import { NextResponse } from "next/server";
import { decodeShareCode } from "@/vendor/arkplay-engine/dna/codec.ts";
import { renderSVG } from "@/vendor/arkplay-engine/render/render.ts";
import { animatedSVG } from "@/vendor/arkplay-engine/export/animated.ts";

/**
 * A PROFILE COVER, DRAWN AT THE SHAPE OF THE CARD IT GOES IN.
 *
 * Every crop the engine offers is square, and the avatar service's HTTP render
 * exposes no way to ask for anything else — width, height, aspect, ratio,
 * zoom, pad and margin are all accepted and silently ignored. So a cover built
 * on `GET /render/{code}.png` could only letterbox the scene or crop the
 * character out of it, and both looked exactly as wrong as they were.
 *
 * The ENGINE has had the answer all along: `renderSVG` takes a `viewBox` that
 * "overrides the crop box entirely", and it draws the scene to fill whatever
 * box it is given. The studio already does this in the browser. This is the
 * same thing for everybody else.
 *
 * ─── WHY HERE AND NOT IN THE BROWSER ────────────────────────────────────────
 * The renderer is 246KB gzipped. That is a fair price for somebody who opened
 * the editor and nothing anyone should pay to LOOK at a profile. Rendering
 * here keeps covers a plain <img src> for every visitor.
 *
 * ─── WHY IT IS FREE TO SERVE ────────────────────────────────────────────────
 * A share code is immutable by construction — it IS the avatar — so the answer
 * for a given code and size can never change and is cached for a year. The
 * render costs about 20ms, once.
 */

/** Long enough for any real code, short enough that nothing silly is parsed. */
const MAX_CODE = 4096;

/** The card's own shape; bounded so nobody renders a billboard. */
const DEFAULTS = { w: 741, h: 473 };
const MAX_EDGE = 2048;

function dimension(raw: string | null, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 16 && n <= MAX_EDGE ? Math.round(n) : fallback;
}

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!code || code.length > MAX_CODE) {
    return NextResponse.json({ code: "invalid_request" }, { status: 400 });
  }

  const url = new URL(request.url);
  const width = dimension(url.searchParams.get("w"), DEFAULTS.w);
  const height = dimension(url.searchParams.get("h"), DEFAULTS.h);
  /*
    The clip to play, if its owner chose one. Shape-checked rather than passed
    through: this reaches a renderer, and it arrives in a URL anybody can type.
    An unknown name simply draws the still.
  */
  const raw = url.searchParams.get("a");
  const anim = raw && /^[a-z][a-z0-9-]{0,31}$/.test(raw) ? raw : null;

  try {
    const decoded = decodeShareCode(code) as { dna?: unknown };
    const dna = (decoded?.dna ?? decoded) as Parameters<typeof renderSVG>[0];
    if (!dna || typeof dna !== "object") throw new Error("not an avatar");

    /*
      The crop's own box, stretched sideways and left centred. Only the WIDTH
      grows: keeping the height means the character stays exactly as tall as
      the crop intended, and the extra width is scene. Measured from a
      throwaway render rather than recomputed, because `cropBox` depends on the
      posed model and a second copy of their geometry is one more thing to keep
      in step — and getting it wrong by hand is what cut the heads off
      characters with tall hair.
    */
    const probe = renderSVG(dna, { crop: "full", size: 16 });
    const found = /viewBox="([-\d. ]+)"/.exec(probe);
    const box = found
      ? (() => {
          const [x, y, w, h] = found[1].trim().split(/\s+/).map(Number);
          const want = h * (width / height);
          return { x: x + (w - want) / 2, y, w: want, h };
        })()
      : undefined;

    /*
      THE PICTURE PAUSES ITSELF. The animated SVG carries
      `@media (prefers-reduced-motion: reduce) { animation-play-state: paused }`,
      so one response serves everybody: a visitor who asked their system for
      less movement sees it standing still, and nobody needs two URLs or a
      per-viewer render.
    */
    const shared = {
      ...(box ? { viewBox: box } : { crop: "full" as const }),
      size: width,
      detail: "high" as const,
      /*
        NO FRAME ON A WIDE COVER. A frame and its ring are drawn to the box, so
        widening one stretches a laurel wreath into an ellipse — visibly a
        mistake rather than a style. They are square decorations and they still
        appear where a square is drawn: the profile PICTURE, which is this same
        avatar rendered at a portrait crop.
      */
      frame: false,
    };
    const svg = anim
      ? animatedSVG(dna as Parameters<typeof animatedSVG>[0], { ...shared, anim, fps: 12 })
      : renderSVG(dna, shared);

    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        // A code cannot change what it decodes to, so neither can this.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ code: "invalid_code" }, { status: 404 });
  }
}

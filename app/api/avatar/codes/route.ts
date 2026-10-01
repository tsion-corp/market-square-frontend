import { NextResponse } from "next/server";
import { encodeShareCode } from "@/vendor/arkplay-dna/dna/codec.ts";

/**
 * AN AVATAR, TURNED INTO THE STRING SQUARE STORES.
 *
 * A profile keeps a render URL, and a render URL needs the ~250-character
 * share code that is an avatar's canonical form. The avatar service has no
 * public route that makes one — `POST /avatar/v1/codes` 404s, and the account
 * route that would return one wants an ArkPlay sign-in no Square reader has.
 * It has been asked for. Until it ships, Square encodes here, on its own
 * server, with ArkPlay's own codec (see vendor/arkplay-dna/README.md).
 *
 * ─── WHY THE SERVER AND NOT THE BROWSER ─────────────────────────────────────
 * The codec is 221K of schema. Shipping it to every reader to serve the few
 * who open the studio would put it in the bundle of everyone who never does.
 * Here it is loaded once, by one process, and the studio posts to it.
 *
 * ─── IT TRUSTS NOTHING IT IS SENT ───────────────────────────────────────────
 * Anybody can POST here, and the codec walks the document it is given. So the
 * body is size-capped before parsing and the codec's own failure is the
 * validator — it rejects a document that is not an avatar. Nothing is echoed
 * back but the code.
 */

/** A DNA document is ~2.7KB; this is room for the largest plausible one. */
const MAX_BODY = 64 * 1024;

/** One rail of the wardrobe. The widest slot in the catalog holds 30. */
const MAX_BATCH = 64;

/*
  THE CODEC IS NOT A VALIDATOR, AND ASSUMING IT WAS COST A REAL BUG.
  `encodeShareCode({ nope: 1 })` does not throw — it NORMALISES, filling every
  missing field from the defaults and returning a perfectly good code for a
  DEFAULT avatar. So a garbled document would have been saved as a stranger's
  face, with a 200 and nothing to show anything had gone wrong.

  This is deliberately only the three fields that identify WHICH avatar this
  is; everything past them is the codec's to normalise, and duplicating the
  schema would be a second copy to keep in step with the first.
*/
function shapedAvatar(dna: unknown): boolean {
  const doc = dna as { v?: unknown; kind?: unknown; seed?: unknown } | null;
  return (
    !!doc &&
    typeof doc === "object" &&
    typeof doc.v === "number" &&
    (doc.kind === "humanoid" || doc.kind === "creature") &&
    typeof doc.seed === "number"
  );
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ code: "too_large", message: "That avatar is too big." }, { status: 413 });
  }

  let body: { dna?: unknown; dnas?: unknown };
  try {
    body = JSON.parse(raw) as { dna?: unknown; dnas?: unknown };
  } catch {
    return NextResponse.json({ code: "invalid_request", message: "Expected JSON." }, { status: 400 });
  }

  /*
    ─── THE BATCH IS WHAT MAKES A WARDROBE LOOK LIKE ONE ───────────────────────
    A rail of garments has to SHOW the garments, and a thumbnail is the
    character wearing that one thing. Each needs a share code, and asking for
    them one at a time would be a request per tile every time somebody changes
    rail — fifteen round trips to draw one screen.

    Encoding is pure and cheap (no rendering), so the whole rail is encoded in
    one call. The pictures themselves are then ordinary cacheable GETs the
    browser fetches lazily and reuses, which is exactly what a share code is
    for. The service's own thumbnail API is no help here: it renders a PERSON
    by email or handle, not an item.
  */
  if (Array.isArray(body.dnas)) {
    if (body.dnas.length > MAX_BATCH) {
      return NextResponse.json(
        { code: "too_many", message: `At most ${MAX_BATCH} at a time.` },
        { status: 400 },
      );
    }
    const codes = body.dnas.map((one) => {
      if (!shapedAvatar(one)) return null;
      try {
        return encodeShareCode(one as never);
      } catch {
        // One unencodable garment must not blank the whole rail.
        return null;
      }
    });
    return NextResponse.json({ codes });
  }

  const dna: unknown = body.dna;
  if (!dna || typeof dna !== "object") {
    return NextResponse.json(
      { code: "invalid_request", message: 'Expected { "dna": … } or { "dnas": [ … ] }.' },
      { status: 400 },
    );
  }

  if (!shapedAvatar(dna)) {
    return NextResponse.json(
      { code: "invalid_dna", message: "That isn't an avatar this service can encode." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ code: encodeShareCode(dna as never) });
  } catch {
    return NextResponse.json(
      { code: "invalid_dna", message: "That isn't an avatar this service can encode." },
      { status: 400 },
    );
  }
}

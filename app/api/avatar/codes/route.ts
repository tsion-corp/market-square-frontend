import { NextResponse } from "next/server";
import { encodeShareCode } from "@/vendor/arkplay-engine/dna/codec.ts";

/**
 * AN AVATAR, TURNED INTO THE STRING SQUARE STORES.
 *
 * A profile keeps a render URL, and a render URL needs the ~250-character
 * share code that is an avatar's canonical form. The avatar service has no
 * public route that makes one — `POST /avatar/v1/codes` 404s, and the account
 * route that would return one wants an ArkPlay sign-in no Square reader has.
 * It has been asked for. Until it ships, Square encodes here, on its own
 * server, with ArkPlay's own codec (see vendor/arkplay-engine/README.md).
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

/*
  THE TWO CAPS HAVE TO AGREE, AND THEY DID NOT.

  A DNA document is 2.4–3.5 KB, so a 64 KB body could carry about 26 of them —
  while the batch cap said 64. The widest rail in the catalog (head, 30 items)
  needs 31 and came to ~77 KB, so it answered 413 every time and every tile in
  the Hats rail sat blank forever. After one "Surprise me" the document grows
  and both hand rails joined it.

  The body cap is now sized from the batch cap rather than guessed next to it:
  64 documents at 8 KB each, with room for the ones that are unusually large.
*/
const MAX_BATCH = 64;
const MAX_DOC = 8 * 1024;
const MAX_BODY = MAX_BATCH * MAX_DOC;

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
  /*
    Refuse before buffering when the client says how big it is: `await
    request.text()` reads the whole body into a string first, so checking only
    afterwards means a 20 MB post is fully resident before being rejected.
  */
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return NextResponse.json({ code: "too_large", message: "That avatar is too big." }, { status: 413 });
  }

  const raw = await request.text();
  // BYTES, not UTF-16 units: `raw.length` counts a 4-byte emoji as 2, so a
  // body of emoji slipped through at nearly twice the intended size.
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY) {
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

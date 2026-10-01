import { NextResponse } from "next/server";
import { decodeShareCode } from "@/vendor/arkplay-dna/dna/codec.ts";

/**
 * A SAVED AVATAR, BACK INTO THE DOCUMENT THE STUDIO EDITS.
 *
 * Reopening an avatar is the other half of saving it, and it is missing from
 * the service in the same way: `GET /avatar/v1/codes/{code}` 404s. Without it
 * somebody who made a character and came back would silently start over from a
 * stranger — which is the worse failure of the two, because nothing on screen
 * would say it had happened.
 *
 * Decoding is a pure function of the code, so this needs no store, no session
 * and no credential: the code IS the avatar. See the sibling route for why the
 * codec lives on the server rather than in every reader's bundle.
 */

/** Long enough for any real code, short enough that nothing silly is parsed. */
const MAX_CODE = 4096;

export async function GET(_request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!code || code.length > MAX_CODE) {
    return NextResponse.json(
      { code: "invalid_request", message: "That isn't an avatar code." },
      { status: 400 },
    );
  }

  try {
    const decoded = decodeShareCode(code) as unknown;
    /*
      The codec answers either the document or a wrapper carrying it plus a
      report of what it had to normalise. Square wants the document; a caller
      that got the wrapper would quietly save a nested avatar inside an avatar.
    */
    const dna = (decoded as { dna?: unknown })?.dna ?? decoded;
    if (!dna || typeof dna !== "object") throw new Error("not an avatar");
    return NextResponse.json(
      { dna },
      // Immutable by construction: a code always decodes to the same avatar.
      { headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
    );
  } catch {
    return NextResponse.json(
      { code: "invalid_code", message: "That avatar code couldn't be read." },
      { status: 404 },
    );
  }
}

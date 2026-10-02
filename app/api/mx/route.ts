import { NextResponse } from "next/server";

/**
 * EVENTS, SENT FROM OUR OWN ORIGIN.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The browser used to post straight to `api.mixpanel.com`, and on a phone a
 * large share of those requests never leave: ad-blockers, content blockers and
 * privacy browsers all carry that hostname on a list. Nothing reports it —
 * analytics is fire-and-forget by design, so a blocked send looks exactly like
 * a send that worked.
 *
 * The visible symptom was a product where, measured, 35-57 people a day arrived
 * on mobile and then appeared to do nothing at all. The only events in the data
 * were gist room joins and leaves — the two the SERVER records, and therefore
 * the only two that no blocker can touch. Everything the browser was supposed
 * to report was being dropped on the way out.
 *
 * A request to our own domain is first-party and is not on anybody's list. So
 * the call site is unchanged and the events arrive.
 *
 * ─── WHAT IT IS NOT ─────────────────────────────────────────────────────────
 * It is not a general proxy. It accepts one shape, forwards to exactly one
 * fixed URL, and returns nothing but a status — no response body is relayed, so
 * it cannot be used to read anything through our origin.
 *
 * ─── IT NEVER FAILS THE PAGE ────────────────────────────────────────────────
 * Every outcome is 204. A measurement that errors into the client is worse than
 * one that is lost: the caller cannot act on it, would retry, and the reader
 * would learn that we tried to count them.
 */

/** Mixpanel's own ingest. The only place this route will send anything. */
const INGEST = "https://api.mixpanel.com/track";

/**
 * OUR PROJECT, AND THE ROUTE WRITES INTO NO OTHER.
 *
 * Mixpanel takes the destination project from a `token` INSIDE each event, so a
 * forwarder that passes the body through verbatim will happily write into
 * anybody's project on behalf of whoever posted it. The capability gained is
 * small — `api.mixpanel.com` is public and anyone can post to it directly — but
 * what it does buy is OUR origin and OUR server's address in front of it, which
 * is the one thing a caller cannot get on their own and the only reason to come
 * through here.
 *
 * So the token is stamped SERVER-SIDE over whatever arrived. The route is then
 * useless as a relay: it writes into this project or it drops the event.
 *
 * It is the same public token the browser already carries — this is not a
 * secret being protected, it is a destination being pinned.
 */
const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN ?? "";

/**
 * Generous for a batch of events and far below anything worth relaying.
 * A payload over this is not an event, so it is dropped rather than forwarded.
 */
const MAX_BODY = 64 * 1024;

/** Beyond this the browser has navigated away and nobody is waiting. */
const TIMEOUT_MS = 4000;

export async function POST(request: Request) {
  /*
    A content-length pre-check so an oversized body is refused before it is
    read, and a byte check after, because the header is a claim rather than a
    fact.
  */
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return new NextResponse(null, { status: 204 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (body.length === 0 || body.length > MAX_BODY) {
    return new NextResponse(null, { status: 204 });
  }

  /*
    SHAPE-CHECKED, NOT PASSED THROUGH. This route's address is public and
    anything can post to it, so it forwards only what it recognises: a non-empty
    array of objects, each with a string `event`. Anything else is dropped.

    It does NOT validate the event NAME against a list. The vocabulary lives in
    `lib/analytics.ts`, and a copy of it here would be a second place to keep in
    step — the exact shape of mistake that has cost this codebase most. A name
    this route has not heard of is a name somebody just added.
  */
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const events = Array.isArray(parsed) ? parsed : null;
  const shaped =
    events !== null &&
    events.length > 0 &&
    events.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { event?: unknown }).event === "string"
    );
  if (!shaped) {
    return new NextResponse(null, { status: 204 });
  }

  /*
    No project configured here means there is nowhere legitimate to send this,
    and forwarding it with the caller's own token is exactly the relay the
    stamping above exists to prevent. So it is dropped, silently, like
    everything else this route declines.
  */
  if (!TOKEN) {
    return new NextResponse(null, { status: 204 });
  }

  /*
    Rebuilt rather than relayed, so the token above is the one that counts and
    nothing else in the payload can redirect where this lands.
  */
  const stamped = JSON.stringify(
    events.map((entry) => {
      const event = entry as { properties?: Record<string, unknown> };
      return { ...event, properties: { ...event.properties, token: TOKEN } };
    })
  );

  try {
    await fetch(INGEST, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stamped,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    /*
      Mixpanel being slow, down or refusing is not this request's problem and
      not the reader's. The event is lost, which is the same thing that happened
      before this route existed, and nothing else changes.
    */
  }

  // 204 whatever happened — see the header.
  return new NextResponse(null, { status: 204 });
}

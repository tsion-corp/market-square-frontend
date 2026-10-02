/**
 * MIXPANEL, OVER ITS HTTP API, WITH NO SDK.
 *
 * ─── WHY NO SDK ──────────────────────────────────────────────────────────────
 * `mixpanel-browser` is ~50KB gzipped and its job is the three things this app
 * already does for itself: a session id, device/viewport, and UTM capture
 * (`lib/analytics.ts`). Adding it would mean two sources of truth for each and
 * a bundle cost on every page for the privilege. The ingest API is one POST.
 *
 * ─── THE TOKEN IS MEANT TO BE PUBLIC ─────────────────────────────────────────
 * A Mixpanel PROJECT token is a write-only identifier, designed to sit in
 * client code; it cannot read a project. `NEXT_PUBLIC_` is correct for it. The
 * API SECRET is a different credential and must never reach the browser —
 * nothing here reads one.
 *
 * ─── WHAT THIS CANNOT DO, STATED RATHER THAN DISCOVERED ──────────────────────
 * 1. AD-BLOCKERS. A direct call to `api.mixpanel.com` is blocked by most of
 *    them, and by Brave and Safari's stricter modes. Expect to undercount, and
 *    not evenly — the people most likely to block are not a random sample. The
 *    fix is a first-party proxy (`MIXPANEL_PROXY` below), which needs a route
 *    on our own domain; until that exists this is the honest limitation and
 *    nobody should read these numbers as a census.
 *
 * 2. THE VIEWER IS A CLAIM. `distinct_id` is set by the browser, so a person
 *    can in principle attribute events to somebody else. That is acceptable
 *    for product analytics and is not for anything that decides money — which
 *    is why this module is nowhere near the tip or coin paths. It is a
 *    DEPARTURE from the rule written on `lib/analytics.ts`, and deliberately:
 *    that rule says the SERVICE attaches the viewer from the session, and it
 *    holds the moment a collector of ours exists. With no collector there is
 *    no server in the path to attach anything, so the choice is a claimed id
 *    or no per-person analysis at all — and "what does a user do most" is the
 *    question that was asked.
 */

import { api } from "./square-path.ts";

const TOKEN = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN ?? "";

/**
 * THE FIRST-PARTY PATH, AND IT IS THE DEFAULT NOW — not an opt-in.
 *
 * This used to be empty, so every event went straight to `api.mixpanel.com`,
 * which on a phone is a hostname that a great many ad-blockers, content
 * blockers and privacy browsers simply refuse. Nothing reported it: ingest is
 * fire-and-forget, so a blocked send is indistinguishable from one that worked.
 *
 * Measured, the product looked like a place where 35-57 people a day arrived on
 * mobile and then did nothing. The only events in the data were gist room joins
 * and leaves — the two the SERVER records, and so the only two no blocker could
 * touch.
 *
 * `/api/mx` is on our own origin, which is first-party and on nobody's list. It
 * is the DEFAULT rather than something to switch on, because a fix that has to
 * be remembered in an environment variable is a fix that is off in the
 * environment nobody checked — and this one was off in production for the
 * entire life of the feature.
 *
 * The variable survives for an operator who wants to point ingest somewhere
 * else entirely, and setting it to an absolute URL still works.
 */
const PROXY = process.env.NEXT_PUBLIC_MIXPANEL_PROXY ?? "";

const INGEST = PROXY || api("/api/mx");

/*
  SAME-ORIGIN unless somebody has deliberately pointed ingest off-site. Our own
  route is same-origin by construction; an absolute override is not.
*/
const SAME_ORIGIN = !/^https?:\/\//u.test(INGEST);

/** Configured at all? Everything here is a no-op without a token. */
export function mixpanelReady(): boolean {
  return TOKEN.length > 0;
}

/**
 * WHO THE EVENTS BELONG TO.
 *
 * Held in the module rather than passed per call, because every caller would
 * forget and an event with the wrong `distinct_id` is worse than a missing
 * one. Set once when the viewer resolves (`identifyForAnalytics`), and reset
 * on sign-out so the next person's events are not filed under the last one's —
 * a shared device is the case that makes that non-theoretical.
 */
let distinctId: string | null = null;

export function identifyForAnalytics(id: string | null): void {
  distinctId = id;
}

/**
 * One event. Fire-and-forget, `keepalive` so it survives the navigation that
 * caused it, and it never throws: a failed measurement is not a failed action
 * and the reader must never learn that we tried to count them.
 *
 * `$insert_id` is the payload's own idempotency key — Mixpanel de-duplicates
 * on it for five days, so a retried or double-fired event counts once. Without
 * it a flaky connection inflates every number it touches.
 */
export function sendToMixpanel(
  name: string,
  properties: Record<string, unknown>,
  sessionId: string,
): void {
  if (!TOKEN || typeof window === "undefined") return;

  const body = [
    {
      event: name,
      properties: {
        ...properties,
        token: TOKEN,
        // The session until somebody is known; their id once they are. Mixpanel
        // stitches the two when `identify` is called with both.
        distinct_id: distinctId ?? sessionId,
        $insert_id: `${sessionId}-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        time: Date.now(),
      },
    },
  ];

  try {
    void fetch(INGEST, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      // Ingest is write-only and cross-origin; no cookies belong on it.
      credentials: "omit",
      mode: SAME_ORIGIN ? "same-origin" : "cors",
    }).catch(() => {});
  } catch {
    // An ad-blocker can make `fetch` itself throw synchronously.
  }
}

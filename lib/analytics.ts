"use client";

import { useEffect } from "react";
import { apiFetch } from "@/lib/api/client";
import { readUtm, withoutShareChannel, type UtmParams } from "@/lib/utm";
import { getAuthSnapshot } from "@/lib/session";
import { identifyForAnalytics, mixpanelReady, sendToMixpanel } from "@/lib/mixpanel";
import { api, SQUARE_BASE } from "./square-path.ts";

/*
  THE EVENTS. What is measured decides what can ever be learned, so the set is
  written to answer the question that was asked — "what do users do most" —
  rather than to describe the code that happened to get instrumented first.

  IT DID NOT. Eleven of the original eighteen were streams, tickets and store,
  on a product whose niche is rooms and conversation. Posting, gifting and
  opening a room — the three things people here actually do — were measured
  nowhere, so the answer would have been predetermined by what was wired up.

  The COMMUNITY block below is that correction. Nothing was removed: a stream
  and a store purchase are still worth counting, they were simply never the
  whole product.
*/
export type MarketEventName =
  // The community: what this product is for.
  | "post_created"
  /*
    THE MOST COMMON ACT IN THE PRODUCT, and it had no name at all until now —
    so "what do users do most" could never have been answered honestly. Only
    the LIKE is counted, never the unlike: an undo is not an engagement, and
    counting both would make a double-tapped-then-undone post look busier than
    one somebody meant.
  */
  | "post_liked"
  | "comment_created"
  | "gift_sent"
  | "room_opened"
  | "room_joined"
  | "room_left"
  | "message_sent"
  | "wink_sent"
  | "feed_viewed"
  | "content_opened"
  | "profile_viewed"
  | "follow_created"
  | "activity_scheduled"
  | "stream_started"
  | "qualified_watch_time_reached"
  | "stream_completed"
  | "ticket_checkout_started"
  | "ticket_purchased"
  | "kash_access_used"
  | "store_item_viewed"
  | "download_started"
  | "purchase_completed"
  | "entitlement_issued"
  | "replay_started"
  | "content_reported"
  | "notification_opened";

interface MarketEventInput {
  entityType?: string;
  entityId?: string;
  surface: string;
  source?: string;
  /*
    `accessType` USED TO SIT HERE, on every event.

    It is ticket-specific — how somebody got into a stream — and it was in the
    shape all eighteen kinds carried, so seventeen of them declared a field
    they never set. A common shape is a claim that every event has this; a
    field only one family uses belongs in `metadata`, where it is obviously
    optional and obviously that family's.

    Callers that set it should pass `metadata: { accessType }`.
  */
  metadata?: Record<string, string | number | boolean | null>;
}

const UTM_KEY = "ms.analytics.utm";

/**
 * The FIRST UTM tags this visit arrived with, kept for the rest of it.
 *
 * Captured as soon as the shell mounts (`captureVisitUtm`), because a visit's
 * first page does not always record an event, and one client navigation later
 * the query string — and the tags — are gone.
 */
export function captureVisitUtm(): UtmParams | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(UTM_KEY);
    const found = stored ? null : readUtm(window.location.search, window.location.pathname);
    if (found) sessionStorage.setItem(UTM_KEY, JSON.stringify(found));
    // The channel code is read ONCE and then taken off the address bar — even
    // when this visit already had tags stored — so a link copied from the bar
    // never re-shares a channel that did not send it.
    //
    // `null`, NOT `history.state`. Next patches replaceState and, when the
    // state passed in already carries its internal marker (`__NA`), hands it
    // straight to the browser WITHOUT updating the router — so the router kept
    // `?s=wa` in `useSearchParams` and wrote it back into the bar on its next
    // commit. With `null`, Next copies its own state across and syncs the URL,
    // which is exactly what its docs show.
    const clean = withoutShareChannel(window.location.href);
    if (clean) window.history.replaceState(null, "", clean);
    return stored ? (JSON.parse(stored) as UtmParams) : found;
  } catch {
    return null;
  }
}

function sessionId() {
  const key = "ms.analytics.session";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

/**
 * Has the collector answered 404 yet?
 *
 * `POST /analytics/events` is not deployed on every environment the app runs
 * against — the fixture BFF implements it, the live service does not (yet).
 * Without this guard every feed view, profile view and store view fires
 * another request at a route we have already been told is not there: a
 * console full of red on a working app, which trains everyone to ignore the
 * console.
 *
 * A 404 is the ONLY thing that stops us. A 500, a timeout or an offline tab
 * are transient and the next event should still try — giving up on those
 * would silently kill analytics for the rest of the session over one blip.
 *
 * Scoped to the page load, so a deploy that adds the route is picked up on
 * the next visit without anyone clearing anything.
 */
let collectorMissing = false;

/**
 * THE SURFACE THE LAST EVENT CAME FROM.
 *
 * A funnel is a question about the step BEFORE, and no single event can answer
 * it — "how do people reach a room" needs to know they were on the feed. Kept
 * in the module rather than threaded through every caller, because every
 * caller would forget.
 *
 * Reset per page load, deliberately: across a refresh the previous surface is
 * not knowledge, it is a guess.
 */
let lastSurface: string | null = null;

/**
 * WHAT EVERY EVENT CARRIES. Set once here, attached to all of them.
 *
 * ─── WHAT IS HERE, AND WHY ───────────────────────────────────────────────────
 * `sessionId`  one visit, so events can be strung into a journey
 * `signedIn`   signed-out browsing is first-class here and behaves nothing like
 *              signed-in. Without it the two are averaged into one meaningless
 *              middle, and the pre-signup funnel — the one nobody can
 *              reconstruct afterwards — cannot be separated at all.
 * `zone`       ONE codebase serves the standalone Square AND `/square` inside
 *              Ark. Without this the two products are indistinguishable in the
 *              data, and any surprise in a number is unattributable.
 * `viewport`   see the rename below
 * `from`       the surface before this one; funnels are unanswerable without it
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * NO USER ID. Not an oversight and not a gap to be filled later by a client:
 * an id the browser asserts is a CLAIM, and a forged one on an analytics table
 * is worse than a missing one — a missing id leaves a hole you can see, a
 * forged one is indistinguishable from truth and poisons every query built on
 * it afterwards. The viewer is attached SERVER-SIDE from the session, which
 * the BFF already forwards. The service should refuse a client-sent one
 * outright rather than trust it.
 *
 * NO RELEASE / BUILD ID, yet. It belongs here — without it a behaviour change
 * and a deploy cannot be told apart — but nothing in this app exposes one to
 * the browser today, and inventing a constant that never changes would be
 * worse than the absence. It needs a build-time env var first.
 */
function commonProperties(surface: string) {
  return {
    version: 1,
    sessionId: sessionId(),
    timestamp: new Date().toISOString(),
    signedIn: getAuthSnapshot().authenticated,
    zone: SQUARE_BASE === "" ? "standalone" : "ark",
    /*
      `viewport`, NOT `device`. It was `device`, and it is
      `matchMedia("(max-width: 767px)")` — a WINDOW WIDTH. A desktop browser
      narrowed to half the screen recorded as "mobile", and a tablet in
      landscape as "desktop".

      That is a lie that gets believed: somebody reports "60% of our users are
      on mobile" from a column named `device` and nobody re-derives it. The
      rename costs nothing today and is unfixable once there is a year of data
      under the old name.
    */
    viewport: window.matchMedia("(max-width: 767px)").matches ? "narrow" : "wide",
    ...(lastSurface !== null && lastSurface !== surface ? { from: lastSurface } : {}),
  };
}

export function trackMarketEvent(name: MarketEventName, input: MarketEventInput) {
  if (typeof window === "undefined") return;
  if (collectorMissing) return;
  const utm = captureVisitUtm();
  const metadata = utm || input.metadata ? { ...utm, ...input.metadata } : undefined;
  const payload = {
    ...commonProperties(input.surface),
    name,
    ...input,
    // The visit's UTM tags ride along as metadata — a shape the collector
    // already takes — so a view can be traced back to the share that brought it.
    ...(metadata ? { metadata } : {}),
  };
  // AFTER the payload is built, or every event would report itself as its own
  // previous surface.
  lastSurface = input.surface;

  /*
    TWO TRANSPORTS, AND THEY ARE NOT THE SAME RECORD.

    Mixpanel is the tool for READING events. The collector is the record: it
    keeps the raw event and attaches the viewer from the SESSION rather than
    trusting a browser's claim about who it is.

    Both are fire-and-forget and neither can fail the action.
  */
  if (mixpanelReady()) sendToMixpanel(name, payload, payload.sessionId);

  void apiFetch(api("/api/market-square/analytics/events"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    /*
      A BATCH OF ONE, because the route takes `{ events: [...] }`. The envelope
      is here from the start rather than added when batching arrives: a shape
      that changes later is a deploy where one side speaks the old one.

      `occurredAt` is OURS and is not the record's clock — the service stamps
      its own on arrival. A device's clock is wrong by minutes routinely and
      jumps backwards across a sleep, so ordering within one session uses this
      and anything time-series uses the server's. Sending only one of the two is
      how a single skewed phone corrupts every funnel it appears in.
    */
    body: JSON.stringify({ events: [{ ...payload, occurredAt: new Date().toISOString() }] }),
    keepalive: true,
  })
    .then((response) => {
      /*
        LATCH ON 404 ONLY — "this collector does not exist here", which is a
        fact about the deployment and will not change under the reader's feet.

        A 429 or a 5xx is a service having a moment, and latching on those would
        turn a bad minute into a session that reports nothing. Those are exactly
        the states where the events are still worth keeping, so they simply fall
        through: this one is lost, the next is attempted.
      */
      if (response.status === 404) collectorMissing = true;
    })
    // Analytics never gets to be the reason something breaks: a failed
    // measurement is not a failed action, and the reader must never learn
    // that we tried to count them.
    .catch(() => {});
}

export function useMarketView(name: MarketEventName, input: MarketEventInput, ready = true) {
  /*
    Destructured rather than depending on `input`, which is a fresh object on
    every render and would fire a view on each one. `metadata` is left out of
    the dependency list for the same reason and is read through a ref-free
    closure: a view event's metadata does not change without one of the fields
    above changing too.
  */
  const { entityType, entityId, surface, source } = input;
  useEffect(() => {
    if (!ready) return;
    trackMarketEvent(name, { entityType, entityId, surface, source });
  }, [name, entityType, entityId, surface, source, ready]);
}

/*
  WHO THE EVENTS BELONG TO — re-exported here so a caller has ONE analytics
  import rather than two, and so the identity and the events can never be
  wired to different modules.

  Called when the viewer resolves and again with null on sign-out: on a shared
  device the next person's events must not be filed under the last one's.
*/
export { identifyForAnalytics } from "@/lib/mixpanel";

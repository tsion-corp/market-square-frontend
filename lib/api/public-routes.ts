/**
 * Which Market Square GETs a signed-out visitor may read.
 *
 * SOURCE OF TRUTH: the backend's own OpenAPI document. A GET is public when the spec lets an ANONYMOUS
 * caller make it. `security` is a list of ALTERNATIVES OR'd together, and an
 * EMPTY object is the alternative that requires nothing — so both a missing
 * `security` and `[{}, { bearerAuth: [] }]` mean public. The second shape is
 * "optional auth", which is what every public Market Square GET actually is:
 * it skips our session check but still forwards a token when there is one.
 * Only an array whose every alternative demands a scheme is secured.
 * See `GET ${WSAPI_BASE_URL}/v1/market-square/openapi.json`.
 *
 * TO RE-DERIVE after backend routes land, run:
 *
 *   curl -s "$WSAPI_BASE_URL/v1/market-square/openapi.json" \
 *     | jq -r '.paths | to_entries[]
 *              | .key as $p | .value | to_entries[]
 *              | select(.key == "get")
 *              | "\(if (.value.security // [{}]) | (length == 0 or any(length == 0))
 *                    then "PUBLIC" else "SECURED" end)\t\($p)"' \
 *     | sort
 *
 * then reconcile this predicate and the table in `public-routes.test.ts`
 * against that output. The test asserts both directions, so an entry that
 * drifts either way fails CI rather than rotting silently.
 *
 * This module is deliberately dependency-free: the route handler imports it,
 * and so does the test, without dragging in `next/server` or Privy.
 *
 * Note that a public GET only skips *our* session check — the caller's token
 * is still forwarded when present, so personalised fields (`likedByMe`,
 * `bookmarkedByMe`) keep resolving for signed-in readers.
 */
/**
 * Is every segment safe to join into an upstream URL?
 *
 * Next hands us decoded segments, so `%2e%2e` arrives as `..`. Joining those
 * lets `/streams/x/../../../kash/balances` normalise upstream into a DIFFERENT
 * service's route while `isPublicGet` still sees head === "streams" — turning
 * the BFF into an unauthenticated relay to any gateway path. Reject the whole
 * request rather than trying to sanitise it.
 */
export function isSafePath(path: string[]): boolean {
  return path.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.includes("/") &&
      !segment.includes("\\")
  );
}

/**
 * The THREE writes a signed-out visitor may make through the BFF, all
 * optional-auth in the spec (`[{}, { bearerAuth: [] }]`):
 *
 *  · `POST /email/unsubscribe` — turning off the daily email summary from the
 *    link in the email. The signed token in its query names the one person it
 *    changes, and that person may not be signed in on this device.
 *  · `POST /streams/:id/preview-token` — the room card's listen-only hover
 *    preview. It mints a subscribe-only, roster-hidden grant on a throwaway
 *    identity, changes nothing, and the page it sits on is public.
 *
 *  · `POST /analytics/events` — the event collector, and the reason it has to
 *    be here is the whole point of measuring anything: the ANONYMOUS half is
 *    where acquisition lives. Somebody arrives from a campaign, looks around,
 *    and signs up later — or does not. Requiring a session throws away every
 *    event before the sign-up, which is most of what a question about mobile
 *    traffic is actually asking.
 *
 *    The service is explicitly optional-auth here and records `profileId: null`
 *    for an anonymous caller. Our proxy answered 401 and dropped them on the
 *    floor, so the service's decision had no effect: the events never reached
 *    it. A gate on one side of a contract that the other side did not ask for
 *    is still a gate.
 *
 *    The session is still FORWARDED when there is one, so a signed-in reader's
 *    events are attributed. Public here means "does not require", never
 *    "ignores".
 *
 * These exact shapes only — every other write needs a session.
 */
export function isPublicPost(path: string[]): boolean {
  if (!isSafePath(path)) return false;
  if (path.length === 2 && path[0] === "email" && path[1] === "unsubscribe") return true;
  if (path.length === 2 && path[0] === "analytics" && path[1] === "events") return true;
  /*
    THE THREE WRITES A LIVE ROOM NEEDS FROM A VISITOR WHO IS NOT SIGNED IN.

    All three are `[{}, {bearerAuth}]` in the PRODUCTION spec — optional auth,
    anonymous allowed — and two of them were being refused here, which is why
    this is a list of three rather than the one it used to be:

     · `playback-token` mints the LiveKit grant that plays the stream. The
       service issues a fresh `anon-<uuid>` identity for a caller with no
       session, which only makes sense because it EXPECTS anonymous callers.
       Refused here, a signed-out visitor cannot watch a public room at all.
     · `heartbeat` renews a viewer's place in the live presence set, and is
       documented "anonymous allowed on public streams". Refused here,
       signed-out listeners silently drop out of `viewerCount` and out of the
       participants sample, so a host sees fewer people than are in the room —
       an error nobody reports, because the number is merely wrong rather than
       missing.
     · `preview-token` is the room card's hover preview: listen-only,
       roster-hidden, on a page a signed-out reader can already see.

    None of these was broken by a change — they have been anonymous-capable
    since they shipped, and this proxy has been refusing two of them the whole
    time. A gate on one side of a contract the other side did not ask for is
    still a gate, and it is invisible from both ends: the service sees no
    request, the client sees a 401 nobody logs.
  */
  if (
    path.length === 3 &&
    path[0] === "streams" &&
    (path[2] === "playback-token" || path[2] === "preview-token" || path[2] === "heartbeat")
  ) {
    return true;
  }
  return false;
}

export function isPublicGet(path: string[]): boolean {
  // A traversal attempt is never public, whatever its head looks like.
  if (!isSafePath(path)) return false;

  const [head, second, third] = path;

  // Public in their entirety.
  if (head === "feed" || head === "stories" || head === "spotlight") return true;
  if (head === "activities") return true;
  // The category index feeds the right rail, which renders signed out.
  if (head === "categories") return true;
  // Every GET under /profiles is public — the DIRECTORY collection itself, one
  // profile, its posts, streams, activities and FOLLOWERS — except who a
  // person FOLLOWS, which is private to its owner (owner-only on the service,
  // bearer-only in the spec since 2026-09-17). The collection matters —
  // Explore's People tab is a discovery surface and has to list for
  // signed-out visitors, with the sign-in invitation only on the Follow action.
  if (head === "profiles") return !(path.length === 3 && third === "following");
  // /store/items and /store/items/{slug}.
  if (head === "store") return true;
  if (head === "health" || head === "openapi.json") return true;
  // Search is public; an optional token only enriches viewer state.
  if (head === "search") return true;
  // The topic vocabulary is public — the picker renders for signed-out
  // visitors too, who choose first and are prompted to sign in to save.
  if (head === "topics") return true;

  // /posts/{id} and /posts/{id}/comments only. Every other posts route (like,
  // repost, bookmark) is a write and never reaches this predicate.
  if (head === "posts" && second) {
    return path.length === 2 || (path.length === 3 && third === "comments");
  }
  // One comment, and a thread's replies, read like the comments they hang
  // under: public with optional auth, so `likedByMe` resolves for a signed-in
  // reader. `/replies` is documented so; `GET /comments/{id}` answers 200 to
  // an anonymous curl on :8080 (2026-09-09) while the spec document has not
  // caught up with it — see PENDING_ROUTES.
  if (head === "comments" && second) {
    return path.length === 2 || (path.length === 3 && third === "replies");
  }

  // Stream reads are public at three EXACT shapes only: the list, one stream,
  // and its chat. Matching on the head alone let anything under /streams
  // through — including owner-only sub-resources and, before `isSafePath`,
  // traversal out of the namespace entirely.
  if (head === "streams") {
    if (path.length === 1) return true;
    if (path.length === 2) return true;
    return path.length === 3 && third === "chat";
  }

  // THE ANNOUNCEMENT BAND, and only the collection. A platform message is for
  // everybody, so it is read signed out — gating it would give a visitor a 401
  // on the one thing the product most wants them to see, which is the same
  // failure `categories`, `search` and `topics` each shipped with. Dismissing
  // one is a POST and never reaches this predicate: a dismissal has to be
  // remembered for somebody.
  if (head === "announcements" && path.length === 1) return true;

  if (head === "verification" && second === "rule") return true;

  // The PUBLIC HOUSE DIRECTORY, and only that exact shape. Home's "Join a
  // community" grid renders for signed-out visitors, so gating it would give
  // them a 401 on content the service serves to anyone who asks — the same
  // failure `categories`, `search` and `topics` each shipped with. Every other
  // /conversations route needs a session and stays behind the predicate below:
  // this one answers for people who are not members, and it deliberately
  // carries no message, unread count or last activity.
  if (head === "conversations" && second === "discover" && path.length === 2) return true;

  // ONE CONVERSATION'S DOORPLATE, and only that exact shape. Somebody opening a
  // shared group link is BY DEFINITION not in the group yet, so a membership
  // gate makes the link useless to the only person who needs it (backend
  // 6422adf, confirmed 2026-09-12 with the observed response rather than the
  // spec). What an anonymous caller gets is the plate and nothing else: title,
  // description, picture, a member COUNT, visibility, and two false flags.
  // Never messages, never the members themselves, never unread or last
  // activity.
  //
  // The service decides the rest, and its rules are worth knowing here: a
  // DIRECT conversation 404s for a non-participant (a preview would answer
  // "are these two talking" to anybody holding an id), a PRIVATE group still
  // previews with `canJoin: false` because existence is not the secret —
  // ENTRY is — and a block collapses only `canJoin`, so the response can never
  // be used as a block detector.
  //
  // Every other /conversations route stays gated: messages, join, invites,
  // members, delete.
  if (head === "conversations" && second && path.length === 2) return true;

  // What a house INVITE LINK opens onto — `GET /invites/:token`, optional auth.
  // The link is sent to people who are not members and often not signed in,
  // and the landing page has to show them the house before asking either. Only
  // this exact shape; accepting is a POST and never reaches this predicate.
  if (head === "invites" && second && path.length === 2) return true;

  // The trending hashtag rail. Public upstream and public here: it is a
  // DISCOVERY surface that renders for signed-out visitors, and gating it gave
  // them a 401 on content the service was serving to anyone who asked. Only
  // this exact shape — every other /hashtags route stays behind the predicate
  // below.
  if (head === "hashtags" && second === "trending" && path.length === 2) return true;

  // The tip capability probe, and only that exact shape. A signed-out reader
  // has to see the same tip control a signed-in one does, so the sign-in
  // prompt lands when they choose to pay rather than when they merely look.
  // /me/tips/received is earnings and is NOT here — it needs a session.
  if (head === "tips" && second === "capability" && path.length === 2) return true;

  // The upload contract (caps + content-type allowlist). Public upstream, and
  // it has to be public here too: the composer's file picker and its size
  // pre-check render for signed-out visitors, and a 401 would silently pin
  // them to our compiled-in fallback numbers — the exact drift the endpoint
  // exists to remove. Only this EXACT shape; every other /uploads route is a
  // POST and never reaches this predicate.
  if (head === "uploads" && second === "limits" && path.length === 2) return true;

  // The deployment's public web-push key — handed to the browser by design,
  // and read before the reader has chosen to subscribe. This exact shape only.
  if (head === "push" && second === "vapid-public-key" && path.length === 2) return true;

  return false;
}

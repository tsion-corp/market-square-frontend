"use client";

import type { QueryClient } from "@tanstack/react-query";

/**
 * Every cache that renders somebody's identity.
 *
 * A display name, avatar, verified check, org badge or role chip is COPIED
 * into feed items, story groups, comment rows, search results, conversation
 * previews and spotlight boards — none of those read the profile query. So
 * changing any of them and invalidating only `["ms","profile"]` leaves the old
 * identity on every one of those surfaces until each happens to refetch.
 *
 * This lives in `lib/` rather than in a feature slice because both the profile
 * slice (a rename, a new avatar) and the admin console (granting a badge or a
 * verification) have to invalidate the exact same set, and slices never import
 * each other. Keeping one list is the point: two copies drift apart silently,
 * and the symptom — a stale badge somewhere unrelated — is nearly invisible in
 * review.
 *
 * Add a key here whenever a new surface starts embedding profile identity.
 */
const IDENTITY_SURFACES: string[][] = [
  ["ms", "profile"],
  ["ms", "profile-posts"],
  ["ms", "feed"],
  ["ms", "bookmarks"],
  ["ms", "stories"],
  ["ms", "spotlight"],
  ["ms", "conversations"],
  ["ms", "discovery"],
  /*
    "Viewed you" draws a tile per viewer, so it carries identity like the rest.

    It earns its place twice over: `privateBrowsing` is saved through the same
    `PATCH /me` that lands here, and that flag decides whether this list is a
    list at all — on, the service refuses it; off, it comes back whole. Without
    this key a reader could turn private browsing off and still be looking at
    the screen telling them they cannot see their viewers.
  */
  ["ms", "profile-views"],
];

export function invalidateIdentitySurfaces(queryClient: QueryClient) {
  for (const queryKey of IDENTITY_SURFACES) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Caches holding a copy of a piece of CONTENT, for when a post is removed.
 *
 * Removing content has to empty it out of the timeline, anyone's Arkmarks, the
 * author's Posts tab, the permalink and search results, or the post lingers in
 * whichever list already cached it.
 *
 * The feed slice's `invalidatePostLists` delegates here so there is one list
 * rather than two that drift.
 */
const CONTENT_SURFACES: string[][] = [
  ["ms", "feed"],
  ["ms", "bookmarks"],
  ["ms", "profile-posts"],
  ["ms", "post"],
  ["ms", "discovery"],
];

export function invalidateContentSurfaces(queryClient: QueryClient) {
  for (const queryKey of CONTENT_SURFACES) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Caches that change when the viewer follows or unfollows somebody.
 *
 * The follow edge is copied into more places than it looks: the followed
 * profile owns follower counts, MY profile owns the following count, the
 * spotlight and who-to-follow rails both render from `["ms","spotlight"]`,
 * search results carry `isFollowing`, and the Following lane plus the stories
 * rail change membership outright rather than just changing a number.
 *
 * This list used to be written out inline in `useFollow`. It lives here for
 * the same reason as the other two: any surface that grows a follow control
 * needs the identical set, and a second copy drifts from this one silently —
 * the symptom being a "Follow" button that stays wrong until something else
 * happens to refetch.
 */
const FOLLOW_SURFACES: string[][] = [
  ["ms", "me"],
  // Explore's People tab pages `GET /profiles`, whose rows carry the follow
  // edge. Left out of this list, the tab kept serving its pre-click answer.
  ["ms", "people"],
  ["ms", "feed", "following"],
  ["ms", "stories"],
  ["ms", "spotlight"],
  ["ms", "discovery"],
];

/**
 * `username` is the followed profile's own query, which is keyed by username
 * rather than id — it is passed in rather than listed above because it is the
 * one key that varies per call.
 */
export function invalidateFollowSurfaces(queryClient: QueryClient, username: string) {
  queryClient.invalidateQueries({ queryKey: ["ms", "profile", username] });
  for (const queryKey of FOLLOW_SURFACES) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Stamp a follow the viewer just made onto the profiles already sitting in
 * list caches.
 *
 * A list payload that CARRIES `isFollowing` beats the session intent by
 * design — the server is the truth whenever it has an opinion. That is right
 * on a refetch and wrong the instant a click lands: the cached page still
 * holds the pre-click answer, so the button would keep saying "Follow" until
 * the invalidated query came back. Rewriting the cached rows keeps the server
 * authoritative while making its recorded answer current.
 *
 * Recursive because the same profile appears at different depths per surface —
 * bare in `/profiles`, nested under `result.profile` in `/search`, under
 * `stream.owner` and `post.author` elsewhere. Matching on id plus the presence
 * of the field patches every one of them without a shape list to maintain.
 */
export function patchFollowInCaches(
  queryClient: QueryClient,
  profileId: string,
  following: boolean
) {
  queryClient.setQueriesData({ queryKey: PROFILE_CACHES }, (data: unknown) =>
    patchFollowInData(data, profileId, following)
  );
}

/**
 * EVERY Square cache — not a list of the ones that render a follow control.
 *
 * It was a list (People, Explore, Spotlight) and the home feed was not on it.
 * A signed-in feed carries `isFollowing` on each post author, so tapping
 * Follow on a post rewrote nothing the button reads: it went on saying
 * "Follow" until something else refetched the feed, and people tapped it five
 * times. The post permalink, Arkmarks, a profile's posts, a stream's owner and
 * notification actors were missing the same way. A list of surfaces is a list
 * the next surface is not on.
 *
 * Walking the whole tree is safe because the patch is precise: it touches only
 * a record whose `id` is this person AND that already carries the marker
 * field, and hands back the untouched node itself, so a cache that does not
 * hold them keeps its identity and nothing re-renders.
 */
const PROFILE_CACHES = ["ms"];

/**
 * Stamp a BLOCK the viewer just made onto the profiles sitting in list caches.
 *
 * Same mechanism as the follow patch above, and it exists for a harder reason
 * than a stale label. Explore's people cards carry a wink — an unsolicited
 * signal sent to a person — and `useWink` refuses to send into a block by
 * reading `isBlocked` off the row it was handed. That row comes from the
 * `["ms","people"]` page, not from the profile query, so blocking somebody
 * from their card and then winking them was a real hole between the click and
 * the refetch. Invalidation alone does not close it: there is a window in
 * which the stale page is still on screen, and it is the window somebody would
 * be in immediately after deciding they wanted nothing to do with this person.
 *
 * Blocking also drops the follow edge, so `isFollowing` goes with it.
 */
export function patchBlockInCaches(
  queryClient: QueryClient,
  profileId: string,
  blocked: boolean
) {
  queryClient.setQueriesData({ queryKey: PROFILE_CACHES }, (data: unknown) =>
    patchBlockInData(data, profileId, blocked)
  );
}

/** Pure cache rewrite, exported for test. Returns `node` itself when nothing matched. */
export function patchFollowInData(node: unknown, profileId: string, following: boolean): unknown {
  return patchProfileInData(node, profileId, "isFollowing", (record) => {
    if (record.isFollowing === following) return null;
    const followerCount = record.followerCount;
    return {
      ...record,
      isFollowing: following,
      ...(typeof followerCount === "number"
        ? { followerCount: Math.max(0, followerCount + (following ? 1 : -1)) }
        : {}),
    };
  });
}

/** Pure cache rewrite, exported for test. Returns `node` itself when nothing matched. */
export function patchBlockInData(node: unknown, profileId: string, blocked: boolean): unknown {
  return patchProfileInData(node, profileId, "isBlocked", (record) => {
    if (record.isBlocked === blocked) return null;
    return {
      ...record,
      isBlocked: blocked,
      // Blocking severs the follow; unblocking does NOT restore it, because
      // the server did not restore it either.
      ...(blocked && "isFollowing" in record ? { isFollowing: false } : {}),
    };
  });
}

/**
 * ONE recursive walker for both patches.
 *
 * Recursive because the same profile appears at different depths per surface —
 * bare in `/profiles`, nested under `result.profile` in `/search`, under
 * `stream.owner` and `post.author` elsewhere. Matching on id plus the presence
 * of a MARKER field patches every one of them without a shape list to
 * maintain; the marker is what distinguishes a hydrated profile that carries
 * the viewer's edge from a `ProfileSummary` that does not.
 *
 * `apply` returns null for "nothing to change", which keeps the identity of
 * every untouched node and lets React Query skip the re-render.
 */
function patchProfileInData(
  node: unknown,
  profileId: string,
  marker: string,
  apply: (record: Record<string, unknown>) => Record<string, unknown> | null
): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const patched = patchProfileInData(item, profileId, marker, apply);
      if (patched !== item) changed = true;
      return patched;
    });
    return changed ? next : node;
  }
  if (!node || typeof node !== "object") return node;

  const record = node as Record<string, unknown>;
  if (record.id === profileId && marker in record) {
    return apply(record) ?? node;
  }

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const patched = patchProfileInData(value, profileId, marker, apply);
    if (patched !== value) changed = true;
    next[key] = patched;
  }
  return changed ? next : node;
}

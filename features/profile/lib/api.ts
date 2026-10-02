"use client";

import { z } from "zod";
import { msApi } from "@/lib/api/service";
import type { Mention } from "@/lib/api/schemas";
import { ProfileSchema } from "@/lib/api/schemas";
import {
  CreatorApplicationSchema,
  FollowingPageSchema,
  FollowResultSchema,
  MaybeCreatorApplicationSchema,
  MyVerificationSchema,
  RenewVerificationSchema,
  ProfileActivitiesSchema,
  ProfileBadgesSchema,
  ProfilePhotoSchema,
  ProfilePhotosSchema,
  ProfilePostsSchema,
  ProfileStreamsSchema,
  type ProfileStreamFilters,
  SpotlightSchema,
  VerificationRuleSchema,
  WinksPageSchema,
} from "@/features/profile/lib/types";

export async function fetchProfile(username: string) {
  return ProfileSchema.parse(await msApi.get(`/profiles/${username}`));
}

/** `GET /profiles/:id/following` — public and paged. Pals' "Following" tab reads the reader's own. */
export async function fetchFollowing(profileId: string, cursor?: string) {
  return FollowingPageSchema.parse(
    await msApi.get(`/profiles/${encodeURIComponent(profileId)}/following`, { cursor, limit: 30 })
  );
}

/**
 * `GET /profiles/:id/followers` — public and paged, the reverse edge of the
 * one above. Needed because a PAL is a mutual follow, and "following" alone
 * cannot tell you who chose you back.
 */
export async function fetchFollowers(profileId: string, cursor?: string) {
  return FollowingPageSchema.parse(
    await msApi.get(`/profiles/${encodeURIComponent(profileId)}/followers`, { cursor, limit: 30 })
  );
}

/** `GET /me/winks` — who winked at the reader, newest first. A 404 before it deploys is "not deployed". */
export async function fetchMyWinks(cursor?: string) {
  return WinksPageSchema.parse(await msApi.authedGet("/me/winks", { cursor, limit: 25 }));
}

export async function fetchProfilePosts(username: string, cursor?: string) {
  return ProfilePostsSchema.parse(await msApi.get(`/profiles/${username}/posts`, { cursor }));
}

export async function fetchProfileStreams(username: string, filters: ProfileStreamFilters = {}) {
  // Spread into a plain record: the client's query type is an index
  // signature, and an omitted filter is omitted from the URL rather than sent
  // as an empty value the service would read as "match nothing".
  return ProfileStreamsSchema.parse(
    await msApi.get(`/profiles/${username}/streams`, {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    })
  );
}

/** `GET /profiles/:username/badges` — asked of the backend; a 404 is "not deployed". */
export async function fetchProfileBadges(username: string) {
  return ProfileBadgesSchema.parse(await msApi.get(`/profiles/${username}/badges`));
}


/** `GET /profiles/:username/photos` — the gallery by position. A 404 before it deploys is "not deployed". */
export async function fetchProfilePhotos(username: string) {
  return ProfilePhotosSchema.parse(await msApi.get(`/profiles/${username}/photos`));
}

/** `POST /me/photos` — attach a URL this service issued for your own upload. Cap 12 (409 with the message). */
export async function addMyPhoto(url: string) {
  return ProfilePhotoSchema.parse(await msApi.post("/me/photos", { url }));
}

/** `DELETE /me/photos/:id` — 204; the rest keep their order. */
export async function removeMyPhoto(id: string) {
  await msApi.del(`/me/photos/${encodeURIComponent(id)}`);
}

export async function fetchProfileActivities(username: string) {
  return ProfileActivitiesSchema.parse(await msApi.get(`/profiles/${username}/activities`));
}

/**
 * `POST /profiles/:id/pass` — "not for me", recorded so the deck stops asking.
 *
 * PRIVATE AND ONE-DIRECTIONAL, which is the whole reason it is safe to make
 * permanent: the other person is told nothing, loses nothing, and can still
 * find, follow, wink at and message the reader. Their own deck is unaffected.
 * It is not a quiet block — blocking is its own act, with its own consequences
 * and its own undo.
 *
 * Idempotent: a repeat answers 200 rather than an error, so a double tap on a
 * slow connection costs nothing. `DELETE` takes it back, and `removed: false`
 * for a pass that was not there is an answer rather than a failure.
 */
export async function setPass(profileId: string, passed: boolean) {
  const path = `/profiles/${encodeURIComponent(profileId)}/pass`;
  return passed ? await msApi.post(path) : await msApi.del(path);
}

export async function setFollow(profileId: string, follow: boolean) {
  const path = `/profiles/${profileId}/follow`;
  return FollowResultSchema.parse(follow ? await msApi.post(path) : await msApi.del(path));
}

export async function setBlocked(profileId: string, blocked: boolean) {
  const path = `/profiles/${profileId}/block`;
  return blocked ? msApi.post<{ blocked: boolean }>(path) : msApi.del<{ blocked: boolean }>(path);
}

/**
 * Send a wink — a one-tap signal of interest, addressed to a PERSON.
 *
 * The path is written out in full rather than assembled from a variable so the
 * public-route check can see it: `POST /profiles/{id}/wink` is not in the
 * service's OpenAPI document yet, and the point of that check is to catch
 * exactly this before it becomes a mystery 404 in production. It is listed in
 * `PENDING_ROUTES` with the condition for deleting the entry.
 *
 * Until it ships, this 404s and `useWink` reads that as "not deployed" and
 * takes the control away — the same contract `useBookmarkPost` and the block
 * action already follow. Nothing about this flow may end in a success toast
 * without a 2xx behind it: a wink that says "sent" and reached nobody is worse
 * than no wink, because the sender stops wondering.
 */
export async function sendWink(profileId: string) {
  return msApi.post<{ winked: boolean; createdAt?: string }>(`/profiles/${profileId}/wink`);
}

/**
 * The reasons `POST /reports` accepts, verbatim from `CreateReportRequest`.
 *
 * Every profile report used to be filed as `other`, which is the bucket a
 * moderator reads last. A report of harassment that arrives indistinguishable
 * from "I don't like this person" is a report that gets triaged like the
 * latter — and this slice adds an unsolicited interest signal, so which of
 * these four a reader picks is now load-bearing.
 */
export const REPORT_REASONS = ["abuse", "spam", "scam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export async function reportProfile(profileId: string, reason: ReportReason = "other") {
  return msApi.post<{ id: string; status: string }>("/reports", {
    targetType: "profile",
    targetId: profileId,
    reason,
  });
}

export async function updateMe(input: {
  username?: string;
  displayName?: string;
  bio?: string;
  /**
   * WHO THE BIO TAGS — the same `Mention` rows a post carries.
   *
   * Sent whenever `bio` is, INCLUDING as an empty array: a bio edited from
   * "@square" to "nothing" must clear the mention, and an omitted key means
   * "leave it alone" everywhere else in this payload. Silence would leave a
   * link pointing out of text that no longer names anybody.
   */
  bioMentions?: Mention[];
  /** http(s) only, checked by the service; null clears, absent leaves alone. */
  website?: string | null;
  avatarUrl?: string;
  /**
   * The profile cover.
   *
   * IT WAS ALWAYS WRITABLE. This type omitted it while the service accepted
   * it, so the cover was hard-coded on our side with a comment explaining that
   * user covers were unavailable — they were available the whole time, and the
   * only thing missing was a line here.
   *
   * Read `/v1/market-square/openapi.json` rather than this file when a field
   * looks absent: a stale local copy of a contract is indistinguishable from a
   * service that does not support something, and it reads as the service's
   * fault.
   */
  coverUrl?: string | null;
  /**
   * The 2D character on the cover, as its share code. Null clears it.
   *
   * Deliberately NOT `avatarUrl`: building a character must not replace
   * somebody's profile picture, which is a separate choice. And deliberately
   * not `coverUrl`, which the service runs through `verifyAttachment` and will
   * only accept as a picture that person uploaded.
   */
  avatarConfig?: string | null;
  /**
   * The self-declared place and gender.
   *
   * ABSENT leaves the field alone; explicit `null` clears it — the same
   * semantics `PATCH /conversations/:id` uses, so an editor that only touches
   * a bio can never wipe somebody's city. The service also reads a blank or
   * whitespace-only string as a clear rather than storing it, which is what
   * stops `""` and `null` becoming two ways to say the same thing where only
   * one of them matches a filter.
   *
   * FREE TEXT, all three. `gender` is not an enum, deliberately: an enum is a
   * decision about which identities exist, and it is not ours to take in a
   * migration. The service folds case so self-declared answers stay comparable
   * without anybody owning a gazetteer.
   *
   * There is no coordinate here and there must never be one — see
   * `lib/people-filters.ts`.
   */
  city?: string | null;
  region?: string | null;
  /** ISO 3166-1 alpha-2, any case; null clears. The service refuses anything else. */
  country?: string | null;
  gender?: string | null;
  /**
   * Marks onboarding complete. `true` ONLY.
   *
   * The service answers 400 to `false` on purpose: finishing onboarding cannot
   * become less true, and a form that serialised its whole state would
   * otherwise re-onboard somebody on every device they own. Nothing here should
   * ever send it as anything but `true`.
   */
  hasOnboarded?: true;
}) {
  return ProfileSchema.parse(await msApi.patch("/me", input));
}

/** `{ city, region }`, both nullable — a miss is an ANSWER, not an error. */
const ReverseGeocodeSchema = z.object({
  city: z.string().nullable().optional().default(null),
  region: z.string().nullable().optional().default(null),
});

export async function fetchVerificationRule() {
  return VerificationRuleSchema.parse(await msApi.get("/verification/rule"));
}

export async function fetchMyVerification() {
  return MyVerificationSchema.parse(await msApi.authedGet("/me/verification"));
}

/**
 * Extend the paid period. Early renewal stacks days rather than resetting the
 * clock, so it is safe to offer at any point in the cycle — including while
 * lapsed, which is how a paused badge comes back with no re-approval.
 */
export async function renewVerification() {
  return RenewVerificationSchema.parse(await msApi.post("/me/verification/renew"));
}

/*
  NO WINDOW IS SENT, deliberately. The board has always been an ALL-TIME tally
  (the service's score only ever accumulates), and the two services on either
  side of the next backend deploy agree on exactly one request that returns it:
  none. Today's service knows only `weekly` and treats it as its default — the
  same all-time numbers. The next one defaults to `all`, and turns `weekly`
  into a REAL rolling 7 days that starts empty on deploy. Pinning `weekly` would
  blank the board the day that ships; sending `all` would be refused by today's
  service. When the window dropdown switches on This week and This month, the
  chosen window is passed here, and only then.
*/
export async function fetchSpotlight() {
  return SpotlightSchema.parse(await msApi.get("/spotlight"));
}

export async function fetchCreatorApplication() {
  return MaybeCreatorApplicationSchema.parse(await msApi.authedGet("/me/creator-application"));
}

export async function applyForCreator(note?: string) {
  return CreatorApplicationSchema.parse(
    await msApi.post("/me/creator-application", note ? { note } : {})
  );
}

/**
 * A device reading turned into a place NAME — `POST /geo/reverse`.
 *
 * The endpoint answers exactly `{ city, region }` and nothing else: no country,
 * no street, no formatted address, and never the coordinates echoed back. That
 * narrowness is the privacy property — a caller cannot store what the route
 * will not return — so this parser is deliberately as narrow as the contract
 * and drops anything else that arrives.
 *
 * The COORDINATES ARE NEVER STORED. They exist for the duration of this one
 * request, on the server, to ask a provider a question; what comes back is a
 * place a person can read, edit and delete. There is no `distanceKm` here and
 * there must never be one — see `lib/people-filters.ts`.
 *
 * LIVE, and GATED — a POST, so `needsAuth` in the BFF covers it and
 * `isPublicGet` never sees it.
 *
 * A 404 FROM HERE IS AN ANSWER, NOT AN OUTAGE: the provider was asked and
 * recognised no place at that point — mid-ocean, a spot with no locality. 502
 * is "we could not ask" (or no provider configured on this deployment), which
 * is the one that should quiet the control; 400 is not-a-coordinate, refused
 * here rather than forwarded to somebody else's service; 429 is the per-user
 * budget, because one tap is one request to a third party we neither pay for
 * nor control.
 *
 * ─── THE 404 IS NO LONGER AMBIGUOUS: BRANCH ON THE CODE, NOT THE STATUS ────
 * The paragraph above is true wherever the route exists, and WRONG where it
 * does not: an absent route is also a 404, so the domain answer ("no place
 * there") and the transport answer ("no such endpoint") arrive wearing one
 * signal. It is live today — `POST /geo/reverse` is on the service at :8094
 * and absent from the deployed spec, because the PR that added it merged to
 * staging while production deploys from main. So in production this reports
 * "we could not name that spot" about a route nobody ever called.
 *
 * FIXED SERVER-SIDE, WHICH IS WHERE IT BELONGED. The no-place answer now
 * carries its own code — 404 `NO_PLACE_FOUND` — and only a provider that
 * actually answered can produce it. So the caller switches on the CODE and
 * the status stops mattering, which is correct on a deployment that is behind
 * rather than only once the deploy catches up. No client-side probe for the
 * route's existence was added, and none is needed.
 *
 *   404 NO_PLACE_FOUND       the provider knew no place there — a fact about
 *                            the spot; the control still works
 *   404 NOT_FOUND            the route is absent, renamed or misproxied — a
 *                            fault, and never a claim about where somebody is
 *   502 SERVICE_UNAVAILABLE  we could not ask; a retry, not a location
 *
 * `components/layout/location-sheet.tsx` branches on exactly those.
 *
 * NOT ON :8094 YET — committed on the backend and deliberately not deployed,
 * so the running service still answers the old bare NOT_FOUND for BOTH cases.
 *
 * THE FAILURE INVERTED RATHER THAN DISAPPEARED, and it is worth knowing which
 * way round it currently is. Against the old build a genuine no-place also
 * arrives as bare NOT_FOUND, so it takes the route-fault branch: drop a pin
 * mid-ocean and the control goes QUIET, instead of saying "type it in". That
 * is the better way round — it declines to answer rather than telling somebody
 * a falsehood about their own city — but it is not the finished behaviour.
 *
 * So: a dead location control against a no-place pin, before the backend
 * rebuild, is the OLD build's ambiguity and not a defect in this branch. It
 * resolves itself the moment the service ships the code, with no change here.
 *
 * IT WRITES NOTHING. The place comes back, the person reads it, and the form
 * saves it with `PATCH /me` — which keeps this a convenience button rather
 * than the app recording where somebody is.
 */
export async function reverseGeocode(input: { latitude: number; longitude: number }) {
  return ReverseGeocodeSchema.parse(await msApi.post("/geo/reverse", input));
}
/**
 * RECORD THAT SOMEBODY STAYED ON A PROFILE — `POST /profiles/:id/views`.
 *
 * The WRITER behind "who viewed my profile" and `profileViewCount`. It has been
 * live on the service and called by nothing, so the table is empty — which means
 * the read side would have shown a truthful zero and looked like a broken
 * feature. Both halves have to exist or neither is worth shipping.
 *
 * ─── ON DWELL, NEVER ON LOAD ────────────────────────────────────────────────
 * The service says so explicitly and it is the whole ethics of the thing: a
 * prefetch, a hover card or a mistyped URL must not tell somebody they were
 * looked at. Appearing in that list is a claim about a person's attention, and
 * it should be true.
 *
 * ─── IT ANSWERS 204 FOR THINGS IT DID NOT RECORD ────────────────────────────
 * Your own profile, a viewer with `privateBrowsing` on, and either party having
 * blocked the other all answer exactly as a recorded view does. That is
 * deliberate: a different answer would let the caller detect a block or somebody
 * else's privacy setting. So there is nothing here to branch on and nothing to
 * report — which is also why a failure is swallowed.
 */
export async function recordProfileView(profileId: string) {
  await msApi.post(`/profiles/${profileId}/views`);
}

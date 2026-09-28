"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorCode, errorMessage } from "@/lib/api/envelope";
import {
  invalidateFollowSurfaces,
  invalidateIdentitySurfaces,
  patchBlockInCaches,
  patchFollowInCaches,
} from "@/lib/api/invalidate";
import { trackMarketEvent } from "@/lib/analytics";
import type { Profile } from "@/lib/api/schemas";
import { useAuth } from "@/hooks/use-auth";
import { uploadFile } from "@/lib/api/upload";
import { useMe } from "@/hooks/use-me";
import { clearFollowIntent, setFollowIntent } from "@/features/profile/lib/follow-state";
import {
  applyForCreator,
  fetchCreatorApplication,
  fetchMyVerification,
  fetchProfile,
  fetchProfileActivities,
  fetchProfilePosts,
  fetchProfileStreams,
  fetchProfileBadges,
  fetchProfilePhotos,
  addMyPhoto,
  removeMyPhoto,
  fetchSpotlight,
  fetchVerificationRule,
  renewVerification,
  reportProfile,
  sendWink,
  setBlocked,
  setFollow,
  setPass,
  updateMe,
  fetchFollowers,
  fetchFollowing,
  fetchMyWinks,
} from "@/features/profile/lib/api";
import type { ProfileStreamFilters } from "@/features/profile/lib/types";
import type { ReportReason } from "@/features/profile/lib/api";
import { rememberWink, useSentWinks } from "@/features/profile/lib/wink-store";
import {
  describeWinkRefusal,
  hasWinked,
  humaniseWait,
  retryAfterFromDetails,
  winkEligibility,
} from "@/lib/winks";


/**
 * "NOT FOR ME" — recorded on the service so the deck stops asking everywhere,
 * not only in the browser the swipe happened in.
 *
 * FIRE AND FORGET, deliberately. The card has already gone: the local record
 * closed it the instant the reader answered, and the deck must not sit under
 * their thumb waiting for a round trip. A failure here costs the cross-device
 * half of the promise and nothing the reader is looking at, so it does not
 * raise a toast — there is no action for them to take, and "couldn't dismiss"
 * on a card that has visibly gone would be a puzzle rather than information.
 *
 * The people list is invalidated so the next page comes back without them.
 */
export function usePassProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ profileId, passed }: { profileId: string; passed: boolean }) =>
      setPass(profileId, passed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ms", "people"] });
    },
  });
}

/** Who someone follows, a page at a time. Pals' "Following" tab reads the reader's own. */
export function useFollowingList(profileId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["ms", "following", profileId],
    queryFn: ({ pageParam }) => fetchFollowing(profileId ?? "", pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(profileId),
  });
}

/** The reverse edge — who follows this person. Paged like the list above. */
export function useFollowersList(profileId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["ms", "followers", profileId],
    queryFn: ({ pageParam }) => fetchFollowers(profileId ?? "", pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(profileId),
  });
}

/** People who winked at the reader (`GET /me/winks`). A 404 means not deployed here — never retried. */
export function useMyWinks(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["ms", "winks-received"],
    queryFn: ({ pageParam }) => fetchMyWinks(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
}

export function useProfile(username: string) {
  return useQuery({
    queryKey: ["ms", "profile", username],
    queryFn: () => fetchProfile(username),
  });
}

/**
 * Report and block.
 *
 * `POST|DELETE /profiles/:id/block` ships on the backend's own cadence; until
 * it lands the call 404s. A 404 here is "not deployed", not "your block
 * failed" — so the control goes quiet and says so, exactly the way Arkmarks
 * does, rather than toasting a success that never reached the service. Any
 * other failure is a real failure and is reported as one; nothing about this
 * flow may end in a success toast without a 2xx behind it.
 */
export function useProfileSafety(profile: Profile) {
  const queryClient = useQueryClient();
  const [blockUnavailable, setBlockUnavailable] = useState(false);
  const block = useMutation({
    mutationFn: (blocked: boolean) => setBlocked(profile.id, blocked),
    onSuccess: (_, blocked) => {
      queryClient.setQueryData<Profile>(["ms", "profile", profile.username], (old) => old ? { ...old, isBlocked: blocked, isFollowing: blocked ? false : old.isFollowing } : old);
      /*
        The LIST caches too, rewritten in place rather than only invalidated.

        Explore's people cards read `isBlocked` off the `["ms","people"]` page,
        not off the profile query, and the wink control refuses to send into a
        block by reading exactly that field. Waiting for the refetch left a
        window where a just-blocked card still offered a wink — the one moment
        it must not. See `patchBlockInCaches`.
      */
      patchBlockInCaches(queryClient, profile.id, blocked);
      // Blocking hides their posts and drops the follow edge, so every list
      // that could carry either has to come back from the server.
      queryClient.invalidateQueries({ queryKey: ["ms", "people"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "discovery"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "feed"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "stories"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "profile-posts", profile.username] });
      queryClient.invalidateQueries({ queryKey: ["ms", "spotlight"] });
      toast.success(blocked ? "Profile blocked" : "Profile unblocked");
    },
    onError: (error) => {
      if (errorCode(error) === "NOT_FOUND") {
        setBlockUnavailable(true);
        toast.error("Blocking isn't available yet.");
        return;
      }
      toast.error(errorMessage(error, "Couldn't update the block."));
    },
  });
  const report = useMutation({
    mutationFn: (reason: ReportReason) => reportProfile(profile.id, reason),
    onSuccess: () => toast.success("Report sent for review"),
    onError: (error) => toast.error(errorMessage(error, "Couldn't send the report.")),
  });
  return { block, blockUnavailable, report };
}

/**
 * The wink.
 *
 * Three layers, and they are deliberately not collapsed into one:
 *
 *   RULES      `lib/winks.ts` — pure, tested, and the only place the limits
 *              are written down.
 *   MEMORY     `wink-store.ts` — what this device has already sent, persisted,
 *              so a reload does not refund a spent budget.
 *   TRANSPORT  here — and the SERVICE is the authority. A 429 from upstream
 *              overrules whatever this browser believed; the pre-flight below
 *              exists so the common refusal is instant and specific, not so
 *              the limit lives on the client. See the header of `lib/winks.ts`
 *              for why that distinction is not academic.
 *
 * BLOCKS. `winkEligibility` refuses to send into a block this viewer set. It
 * cannot do the other direction — whether the RECIPIENT blocked the sender is
 * not in any payload the sender receives, and must not be, because telling a
 * sender "you are blocked" hands them the confirmation blocking exists to
 * withhold. Suppressing a wink from a blocked account at delivery is the
 * service's job and is on the list of what this slice still needs.
 */
export function useWink(profile: Profile) {
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);
  /*
    The service's own refusal, kept WITH ITS WORDING and not just its clock.

    A 429 can mean two different things — the hourly budget is spent, or this
    person was already winked today — and only the service knows which one it
    applied. Reporting both as "that's your winks for now" tells somebody who
    winked one person twice that they are out of winks entirely, which is
    false and sends them away. So the message travels with the deadline, and
    ours is the fallback for a 429 that arrives with nothing to say.
  */
  const [serverRefusal, setServerRefusal] = useState<{ until: number; text: string } | null>(
    null
  );
  const { authenticated } = useAuth();
  const me = useMe();
  const viewerId = me.data?.id ?? null;
  const sent = useSentWinks(viewerId);
  /*
    THE VIEWER MUST BE KNOWN BEFORE A WINK IS SENT OR JUDGED.

    A wink only needs the auth TOKEN to POST, but the cooldown that stops a
    second one is remembered in `wink-store` keyed by the viewer's id — which
    comes from a SEPARATE `/me` query that may still be in flight. Winking in
    that window recorded the wink under no viewer (`rememberWink` no-ops on a
    null id), so it vanished on the next reload and the button re-enabled —
    "I winked already but after refresh I can wink again" (2026-09-28). The
    same gap made the button flash "winkable" on a refresh before `/me`
    resolved. So while an authenticated reader's profile is loading the control
    is held: neither sendable nor shown as fresh. Signed-out readers are not
    held — their tap opens the sign-in gate, and `/me` is disabled for them.
  */
  const viewerResolving = authenticated && me.isPending;

  const mutation = useMutation({
    mutationFn: () => sendWink(profile.id),
    onSuccess: () => {
      rememberWink(viewerId, profile.id);
      // A wink is an event on the recipient's side, not a change to the
      // profile we are looking at, so nothing here is patched optimistically —
      // there is no counter on a profile that a wink moves.
      queryClient.invalidateQueries({ queryKey: ["ms", "notifications"] });
      toast.success("Wink sent");
      // Deliberately NOT tracked. `MarketEventName` is a closed union shared
      // with the collector's own vocabulary; inventing a name here would send
      // the analytics service an event it has never been told about. Add
      // `wink_sent` there first, then here.
    },
    onError: (error) => {
      const code = errorCode(error);
      // "Not deployed" is not a failure — the control goes away rather than
      // reporting an error the reader cannot act on.
      if (code === "NOT_FOUND") {
        setUnavailable(true);
        toast.error("Winks aren't switched on yet.");
        return;
      }
      if (code === "RATE_LIMITED" || code === "TOO_MANY_REQUESTS") {
        const wait = retryAfterFromDetails((error as { details?: unknown }).details);
        const said = (error as { message?: string }).message?.trim();
        const text = said
          ? `${said} You can again ${humaniseWait(wait)}.`
          : describeWinkRefusal("budget-spent", wait);
        setServerRefusal({ until: Date.now() + wait, text });
        toast.error(text);
        return;
      }
      toast.error(errorMessage(error, "Couldn't send the wink."));
    },
  });

  /*
    The clock, as state rather than a `Date.now()` read during render.

    Two reasons and both are real. Reading the clock in a render body is impure
    — React may render twice and get two answers — and the rules lint says so.
    And the rendered state genuinely EXPIRES: a cooldown ends, a budget slot
    ages back in, and without something to re-render on, a button stays
    disabled after the refusal that disabled it has lapsed.

    30 seconds, and only while a wait is actually outstanding. The waits here
    are measured in hours and the copy is coarse on purpose ("in about 3
    hours"), so a second-by-second tick would buy nothing and cost a timer per
    visible row on a directory of thirty people.
  */
  const [now, setNow] = useState(() => Date.now());
  const eligibility = winkEligibility({
    viewerId,
    targetId: profile.id,
    targetBlocked: Boolean(profile.isBlocked),
    sent,
    now,
    available: !unavailable,
  });
  const throttled = serverRefusal !== null && serverRefusal.until > now;
  // A refusal that time will lift — as opposed to "self", "blocked" or a route
  // that does not exist, none of which a timer would ever change.
  const waiting =
    throttled ||
    (!eligibility.ok &&
      (eligibility.reason === "cooling-down" || eligibility.reason === "budget-spent"));

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  /*
    THE SERVICE'S OWN ANSWER, when it carries one. `winkedByMe` on a profile
    says the viewer has an active wink at this person — inside the cooldown
    that refuses a second one — resolved server-side, so it survives a new
    browser where this tab's memory of sent winks does not. Present, it is
    the truth about "already winked"; absent (an anonymous reader, an older
    payload), the local memory stands in. Never defaulted: undefined is not
    "no".
  */
  const winkedOnServer = profile.winkedByMe === true;

  return {
    /** Gone entirely once the service has answered "no such route". */
    unavailable,
    /** True while this viewer's wink is inside its per-person cooldown. */
    winked: winkedOnServer || hasWinked(sent, profile.id, now),
    /**
     * Null when a wink may be sent right now.
     *
     * The SERVICE's refusal outranks ours: it is the one that actually stopped
     * the request, and it knows which of its limits it applied.
     */
    refusal: throttled
      ? serverRefusal!.text
      : eligibility.ok
        ? winkedOnServer
          ? `You already winked at ${profile.displayName || profile.username}`
          : null
        : describeWinkRefusal(eligibility.reason, eligibility.retryAfterMs),
    // Held (disabled) while the viewer profile loads, so the button is never
    // enabled before we can record what it does — see `viewerResolving`.
    isPending: mutation.isPending || viewerResolving,
    send: () => {
      // Refuse locally rather than spending a request the service will reject,
      // and never send before we know who the wink is FROM (it would not be
      // remembered) — see `viewerResolving`.
      if (!eligibility.ok || throttled || viewerResolving) return;
      mutation.mutate();
    },
  };
}

export function useProfilePosts(username: string) {
  return useQuery({
    queryKey: ["ms", "profile-posts", username],
    queryFn: () => fetchProfilePosts(username),
  });
}

export function useProfileStreams(username: string, filters: ProfileStreamFilters = {}) {
  return useQuery({
    // The filters are in the key: the service's cursor encodes them, so a
    // different filter is a different list rather than a page of the old one.
    queryKey: ["ms", "profile-streams", username, filters.status ?? "", filters.kind ?? ""],
    queryFn: () => fetchProfileStreams(username, filters),
  });
}

/**
 * A ROUTE THAT MAY NOT BE DEPLOYED YET.
 *
 * The badge route was asked of the backend and answers 404 until it ships. A 404 here is "not deployed", not "this person has none" — so the
 * query does not retry it (a missing route resolves immediately instead of
 * three times), and `unavailable` is what a surface reads to stay absent. It
 * never invents an empty list: absent-because-unknown and known-empty are
 * different facts and both are kept.
 */
const notDeployed = (error: unknown) => errorCode(error) === "NOT_FOUND";

export function useProfileBadges(username: string, enabled = true) {
  const query = useQuery({
    queryKey: ["ms", "profile-badges", username],
    queryFn: () => fetchProfileBadges(username),
    enabled,
    retry: (count, error) => !notDeployed(error) && count < 2,
  });
  return { ...query, unavailable: query.isError && notDeployed(query.error) };
}


export function useProfileActivities(username: string) {
  return useQuery({
    queryKey: ["ms", "profile-activities", username],
    queryFn: () => fetchProfileActivities(username),
  });
}

/**
 * Optimistic follow: flip the button and count immediately, roll back on error.
 *
 * The profile query is patched directly, but the rails (spotlight,
 * who-to-follow) render from list payloads that may not carry `isFollowing`
 * at all — patching those would be patching a field the server then drops on
 * the next refetch. So the durable half of the optimism is the follow intent
 * in `follow-state.ts`, which the controls read through `useIsFollowing`.
 */
export function useFollow(profile: Profile) {
  const queryClient = useQueryClient();
  // The follow store is keyed per viewer (two accounts in one browser must not
  // share a follow graph), so the optimistic write needs the reader's id.
  const me = useMe();
  const viewerId = me.data?.id ?? null;

  const apply = (following: boolean) => {
    setFollowIntent(viewerId, profile.id, following);
    // Lists that carry `isFollowing` outrank the intent, so their cached rows
    // have to move too or the control sits on the stale server answer until
    // the refetch lands.
    patchFollowInCaches(queryClient, profile.id, following);
    // The walk above has usually stamped this already — a signed-in profile
    // carries `isFollowing` — so this is only for a payload without the field,
    // and the guard keeps the follower count from moving twice.
    queryClient.setQueryData<Profile>(["ms", "profile", profile.username], (old) =>
      old && old.isFollowing !== following
        ? {
            ...old,
            isFollowing: following,
            followerCount: Math.max(0, old.followerCount + (following ? 1 : -1)),
          }
        : old
    );
  };

  return useMutation({
    mutationFn: (follow: boolean) => setFollow(profile.id, follow),
    onMutate: (follow) => apply(follow),
    onError: (error, follow) => {
      apply(!follow);
      // A failed follow leaves no intent behind at all: `apply(!follow)` only
      // restores the opposite guess, and guessing is exactly what must not
      // survive an error.
      clearFollowIntent(viewerId, profile.id);
      toast.error(errorMessage(error, "Couldn't update follow."));
    },
    // One shared list, in lib/api/invalidate.ts — every surface that grows a
    // follow control needs the identical set, and a second copy drifts.
    onSettled: () => invalidateFollowSurfaces(queryClient, profile.username),
    onSuccess: () => {
      trackMarketEvent("follow_created", { surface: "profile", entityType: "profile", entityId: profile.id });
    },
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMe,
    onSuccess: (me) => {
      queryClient.setQueryData(["ms", "me"], me);
      queryClient.setQueryData(["ms", "profile", me.username], me);
      // A rename, a new avatar or a claimed username changes the identity that
      // is stamped into every cached list, not just the profile page.
      invalidateIdentitySurfaces(queryClient);
      toast.success("Profile updated");
    },
    /*
      A FAILED SAVE HAS TO SAY SO.

      This had no `onError` at all, so a rejected edit did nothing visible: the
      sheet stayed open, the field kept what was typed, and the reader had no
      way to tell whether it had landed. `EditProfileSheet` renders an
      `InlineError` from the mutation, but the location sheet and anything else
      that only calls `mutate` got silence — and silence after pressing Save
      reads as success.

      The username conflict keeps its own wording, because "Username taken" is
      the one failure the reader can act on directly and the surfaces that show
      it inline should not also get a toast.
    */
    onError: (error) => {
      if (errorCode(error) === "CONFLICT") return;
      toast.error(errorMessage(error, "Couldn't save your profile."));
    },
  });
}

export function useVerificationRule() {
  return useQuery({
    queryKey: ["ms", "verification-rule"],
    queryFn: fetchVerificationRule,
    staleTime: 5 * 60_000,
  });
}

export function useMyVerification() {
  const { ready, authenticated } = useAuth();
  return useQuery({
    queryKey: ["ms", "my-verification"],
    queryFn: fetchMyVerification,
    enabled: ready && authenticated,
  });
}

/**
 * Renew or restore the badge.
 *
 * On success the profile itself changes (lapsed → verified flips the check
 * everywhere), so this invalidates the profile tree as well as the billing
 * view. Failures are surfaced inline by the card rather than as a toast —
 * PAYMENT_FAILED needs to sit next to the button that caused it.
 */
export function useRenewVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renewVerification,
    onSuccess: (data) => {
      queryClient.setQueryData(["ms", "my-verification"], data);
      queryClient.invalidateQueries({ queryKey: ["ms", "my-verification"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "me"] });
      // The silver check is drawn from the author copy embedded in every feed
      // item, story and search row — not from the profile query.
      invalidateIdentitySurfaces(queryClient);
      toast.success("Verification renewed");
    },
  });
}

export function useSpotlight() {
  return useQuery({
    queryKey: ["ms", "spotlight", "all"],
    queryFn: fetchSpotlight,
  });
}

export function useCreatorApplication() {
  const { ready, authenticated } = useAuth();
  return useQuery({
    queryKey: ["ms", "creator-application"],
    queryFn: fetchCreatorApplication,
    enabled: ready && authenticated,
  });
}

export function useApplyCreator() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => applyForCreator(note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ms", "creator-application"] });
      // Approval flips the role chip; refresh the identity the shell shows.
      queryClient.invalidateQueries({ queryKey: ["ms", "me"] });
      toast.success("Application sent — we'll review it shortly.");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't send the application.")),
  });
}

/**
 * A person's photo gallery. ABSENT, not empty, while the route is not deployed:
 * `unavailable` is what the Photos row reads to stay off the page.
 */
export function useProfilePhotos(username: string) {
  const query = useQuery({
    queryKey: ["ms", "profile-photos", username],
    queryFn: () => fetchProfilePhotos(username),
    retry: (count, error) => !notDeployed(error) && count < 2,
  });
  return { ...query, unavailable: query.isError && notDeployed(query.error) };
}

/** Upload an image, then attach it to your gallery. The service's own messages (the 12 cap) are shown as they come. */
export function useAddProfilePhoto(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => addMyPhoto((await uploadFile(file, undefined, "image")).url),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ms", "profile-photos", username] }),
    onError: (error) => toast.error(errorMessage(error, "Couldn't add that photo.")),
  });
}

export function useRemoveProfilePhoto(username: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => removeMyPhoto(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ms", "profile-photos", username] }),
    onError: (error) => toast.error(errorMessage(error, "Couldn't remove that photo.")),
  });
}

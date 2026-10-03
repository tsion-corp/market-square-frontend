"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { baseIdentity } from "@/features/streams/lib/stage";
import { errorCode, errorMessage } from "@/lib/api/envelope";
import { trackMarketEvent } from "@/lib/analytics";
import { useAuth } from "@/hooks/use-auth";
import { useMe } from "@/hooks/use-me";
import { KASH_TOKEN_DECIMALS } from "@/lib/kash-amount";
import { encodeErc20Transfer, toBaseUnits } from "@/lib/erc20";
import { holdKey } from "@/lib/payment-hold";
import { clearHeldPayment, heldPayment, holdPayment } from "@/lib/payment-store";
import { useEmbeddedWallet } from "@/hooks/use-wallet";
import { useEvmSend } from "@/hooks/use-evm-send";
import { useKashStatus } from "@/hooks/use-kash-status";
import { isHouse } from "@/features/houses/lib/house";
import { mergeStreamDetail } from "@/lib/stream-detail-merge";
import {
  INVITE_ACCEPTED_HINT,
  answerErrorMessage,
  answerLanding,
  inviteErrorOutcome,
  inviteSentMessage,
  quietResolveError,
  routeMissing,
  trackInvite,
  type ApiErrorLike,
} from "@/lib/speaker-invite";
import { inviteMemoryFor, rememberBan } from "@/features/streams/lib/invite-memory";
import { serverClockOffset } from "@/lib/server-clock";
import { muteFailure } from "@/lib/host-mute";
import {
  banFromChat,
  cancelActivity,
  deleteChatMessage,
  fetchStreamEvents,
  fetchStreamStats,
  updateStream,
  updateActivity,
  createActivity,
  createStream,
  fetchRoomGuests,
  knockWithCode,
  fetchMyKnock,
  fetchWaitingKnocks,
  resolveKnock,
  inviteRoomGuest,
  removeRoomGuest,
  endStream,
  fetchActivities,
  fetchMyTickets,
  fetchStream,
  fetchStreams,
  goLive,
  purchaseTicket,
  reportTicketTransfer,
  quoteTicket,
  reactToStream,
  requestToSpeak,
  fetchMySpeakerRequest,
  fetchSpeakerRequests,
  resolveSpeakerRequest,
  inviteToSpeak,
  fetchSpeakerInvites,
  fetchSeatedSpeakers,
  muteSpeaker,
  type SpeakerRequestAction,
  fetchStreamByCode,
  remindStream,
  fetchFollowingRooms,
} from "@/features/streams/lib/api";
import type { Stream, StreamCategory, StreamKind, TicketTier } from "@/features/streams/lib/types";
import {
  createReactionBuffer,
  type ReactionBuffer,
} from "@/features/streams/lib/reaction-buffer";

/**
 * A stream's lifecycle moves more than the stream list.
 *
 * Going live, ending, editing or creating one changes the Live lane of the
 * home feed and the Featured Arena hero (both read `["ms","feed"]`), the
 * studio's own list and the public rails (`["ms","streams"]` covers every
 * section and the owner-filtered view). Only invalidating the stream list was
 * why a creator's own home feed still showed them offline after going live.
 */
function invalidateStreamSurfaces(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ms", "streams"] });
  queryClient.invalidateQueries({ queryKey: ["ms", "feed"] });
}

// "replay" is a UI-layer concept: the backend only knows live | scheduled |
// ended, so replays are ended streams with a replayUrl.
export function useStreamList(
  section: "live" | "scheduled" | "replay",
  topics: string[] = [],
  /**
   * Narrow to one category SERVER-SIDE — `GET /streams?category=` is on the
   * contract. Home's gist-room carousel wants houses and nothing else, and
   * loading every live stream to throw most of them away would make a page of
   * broadcasts yield two rooms.
   */
  category?: StreamCategory,
  /**
   * BROADCASTS or GIST ROOMS — `GET /streams?kind=` on the contract.
   *
   * A gist room IS a stream, distinguished only by `category: "house"`, so a
   * live list asks for every one of them by default. That put audio rooms on
   * Live beside video broadcasts: something offered to watch with nothing to
   * watch, and its own page to join instead.
   *
   * `category` cannot express it, because the filter needed is the NEGATIVE —
   * "not a house" is not a taxonomy value. Hence a separate axis, and hence
   * server-side: filtering here would make a page of broadcasts yield the two
   * that were not rooms.
   */
  kind?: StreamKind,
  /**
   * `listeners` — busiest first, for Home's Top GistRooms. Live only: the
   * service refuses it with any other status, and a count exists only while a
   * room is live. On a deployment without it the client falls back to the
   * default order once (see `fetchStreams`).
   */
  sort?: "listeners"
) {
  const status = section === "replay" ? "ended" : section;
  // Sorted so the same selection always produces the same cache key.
  const key = [...topics].sort().join(",");
  return useQuery({
    queryKey: ["ms", "streams", section, key, category ?? "all", kind ?? "any", sort ?? "default"],
    queryFn: async () => {
      const page = await fetchStreams({
        status,
        topics,
        ...(category ? { category } : {}),
        ...(sort ? { sort } : {}),
        ...(kind ? { kind } : {}),
      });
      if (section !== "replay") return page;
      return { ...page, items: page.items.filter((stream) => stream.replayUrl !== null) };
    },
    refetchInterval: section === "live" ? 30_000 : false,
  });
}

// The room polls the detail to refresh viewerCount and status. Pass a number
// for a custom interval (the cockpit polls at 5 s per spec).
/**
 * One stream.
 *
 * `poll` is `false` (never), `true` (10s), a millisecond interval, or the
 * tuple `["while-live", ms]` — which polls at `ms` only while the stream is
 * actually live and STOPS once it ends. A surface that outlives the broadcast
 * needs that last one: the gist-room invite card sits in a group thread for
 * ever, and the only transition it cares about is live -> ended, after which
 * polling a finished room for the rest of the session is pure waste.
 */
/**
 * WHO OF YOURS IS IN A ROOM RIGHT NOW.
 *
 * Signed-in only, because it is a statement about the caller's own graph —
 * a signed-out reader has no "your people" and the hook never asks.
 *
 * A 404 is "not deployed", not an error: `unavailable` goes true and the
 * surface renders NOTHING. That is also the right rendering when nobody is
 * around, so the rail has exactly one empty state and it is zero-height.
 *
 * Polled at 30s. Presence is the whole point and a stale rail invites
 * somebody into a room that emptied ten minutes ago.
 */
export function useFollowingRooms() {
  const { authenticated } = useAuth();
  const query = useQuery({
    queryKey: ["ms", "following-rooms"],
    queryFn: fetchFollowingRooms,
    enabled: authenticated,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
  return { ...query, unavailable: errorCode(query.error) === "NOT_FOUND" };
}

export function useStream(
  id: string,
  poll: boolean | number | readonly ["while-live", number] = false,
  /** Off while there is no id to read — the shell's room session before a room is entered. */
  enabled = true,
  /**
   * OVERRIDE THE CLIENT'S 30s DEFAULT, for readers that are not watching a
   * counter. The default pairs with `refetchOnWindowFocus`, so a LIST of cards
   * each holding one of these re-fans one request per card on every tab
   * return — O(cards) in a burst. A card wants a long stale window; the room
   * session, which is watching status, wants the default. Undefined inherits.
   */
  staleTime?: number
) {
  return useQuery({
    queryKey: ["ms", "stream", id],
    queryFn: () => fetchStream(id),
    enabled,
    ...(staleTime === undefined ? {} : { staleTime }),
    refetchInterval: Array.isArray(poll)
      ? (query) => (query.state.data?.status === "live" ? poll[1] : false)
      : poll === false
        ? false
        : poll === true
          ? 10_000
          : (poll as number),
  });
}

/**
 * Record hearts against the stream's tally.
 *
 * The tally used to be unmovable: hearts were published on the room's data
 * channel and nowhere else, so `likeCount` — a field the service did not even
 * return — sat at 0 for the whole broadcast. Tapping felt like it did nothing
 * because, as far as anything that outlived the animation was concerned, it
 * did.
 *
 * OPTIMISTIC then RECONCILED. The number moves on the tap, because a counter
 * that waits for a round trip to acknowledge your own tap is exactly the lag
 * this is meant to remove. What comes back is the SERVICE's total — which
 * includes every other viewer's hearts, so it is the only number that can be
 * right — and it replaces the guess rather than adding to it. A failed write
 * rolls its own bump back, so the tally cannot drift upward on requests that
 * never landed.
 *
 * Taps are pooled by `createReactionBuffer`, so hammering the button is one
 * request a second rather than one per heart.
 *
 * Silent on failure. A heart is not a transaction, and a toast apologising for
 * one is louder than the thing it is apologising for.
 */
export function useRecordReactions(streamId: string) {
  const queryClient = useQueryClient();

  const bump = useCallback(
    (delta: number) => {
      queryClient.setQueryData(["ms", "stream", streamId], (old: Stream | undefined) =>
        old ? { ...old, likeCount: Math.max(0, old.likeCount + delta) } : old
      );
    },
    [queryClient, streamId]
  );

  const { mutate } = useMutation({
    mutationFn: (burst: number) => reactToStream(streamId, burst),
    onSuccess: (result) => {
      // The service's count, not ours plus ours: other people are tapping too.
      queryClient.setQueryData(["ms", "stream", streamId], (old: Stream | undefined) =>
        old ? { ...old, likeCount: result.likeCount } : old
      );
    },
    onError: (_error, burst) => {
      bump(-burst);
    },
  });

  // One buffer per stream, kept across renders — a new one per render would
  // pool nothing, since each would hold a single tap and flush it alone.
  const bufferRef = useRef<ReactionBuffer | null>(null);
  if (bufferRef.current === null) {
    bufferRef.current = createReactionBuffer({ send: (burst) => mutate(burst) });
  }
  useEffect(() => {
    const buffer = bufferRef.current;
    return () => buffer?.dispose();
  }, []);

  return useCallback(
    (burst = 1) => {
      // Bump by what the buffer actually took, so the tally on screen and the
      // count on its way to the service can never disagree.
      bump(bufferRef.current?.add(burst) ?? 0);
    },
    [bump]
  );
}

export function useTicketQuote(streamId: string, tier: TicketTier, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "stream", streamId, "quote", tier],
    queryFn: () => quoteTicket(streamId, tier),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/**
 * Buy a ticket — settling it yourself where the service cannot.
 *
 * Mirrors the tip flow deliberately, down to the held payment: a ticket that
 * comes back carrying `toWallet` is NOT paid for, and the buyer's own wallet
 * has to sign a transfer to that address. Where the rail settles server-side
 * the response has no wallet and this is the single request it always was.
 *
 * The hash is written down BEFORE the confirmation wait. From the moment the
 * transfer is broadcast, the only thing that makes a retry safe is that the
 * hash and the ticket it belongs to were recorded first — otherwise a retry
 * opens a second ticket and the buyer pays twice for one seat.
 */
export function usePurchaseTicket(streamId: string) {
  const queryClient = useQueryClient();
  const { address: wallet } = useEmbeddedWallet();
  const { send, waitForReceipt } = useEvmSend();
  const chain = useKashStatus().data?.chain ?? null;

  return useMutation({
    mutationFn: async (tier: TicketTier) => {
      const created = await purchaseTicket(streamId, tier);

      // Rail settlement, or a ticket this buyer already holds: nothing to sign.
      if (!created.toWallet || created.status === "confirmed") return created;

      if (!wallet) throw new Error("Sign in to buy a ticket.");
      if (!chain?.tokenAddress) {
        // Without the engine's own token address there is nothing to transfer,
        // and guessing one sends real money into nothing.
        throw new Error("Ticketing isn't configured on this environment yet.");
      }

      const key = holdKey(`ticket:${streamId}:${tier}`, created.priceKash);
      // A payment a previous attempt made and failed to report.
      const held = key ? heldPayment("ticket", wallet, key) : null;
      let txHash = (held?.txHash ?? null) as `0x${string}` | null;

      if (!txHash) {
        txHash = await send({
          to: chain.tokenAddress as `0x${string}`,
          // The TOKEN's precision, not the API's — see KASH_TOKEN_DECIMALS.
          data: encodeErc20Transfer(
            created.toWallet,
            toBaseUnits(created.priceKash, KASH_TOKEN_DECIMALS)
          ),
          chainId: chain.chainId,
        });
        if (key) holdPayment("ticket", wallet, { key, txHash, ref: created.id });

        const outcome = await waitForReceipt(txHash, chain.chainId);
        if (outcome === "reverted") {
          // Nothing moved, so nothing may be reported as payment.
          clearHeldPayment("ticket", wallet);
          throw new Error("The transfer failed on-chain. Nothing was sent.");
        }
      }

      const reported = await reportTicketTransfer(streamId, created.id, txHash);
      // Reported: the service owns it now and a retry must not re-report it.
      clearHeldPayment("ticket", wallet);
      return reported;
    },
    onSuccess: (ticket) => {
      trackMarketEvent("ticket_purchased", { surface: "ticket_checkout", entityType: "stream", entityId: streamId, metadata: { accessType: ticket.tier } });
      trackMarketEvent("entitlement_issued", { surface: "ticket_checkout", entityType: "ticket", entityId: ticket.id });
      // ["ms","stream", id] is a PREFIX of the playback-token key, so this one
      // call also drops the cached 403 that was gating the player — without it
      // the buyer stayed locked out of a stream they had just paid for.
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", streamId] });
      queryClient.invalidateQueries({ queryKey: ["ms", "my-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "streams"] });
      /**
       * "On its way", never "confirmed", on a ticket the chain has not settled.
       *
       * A client-signed ticket stays `pending` until the watcher observes the
       * transfer, so telling the buyer to enjoy a stream they cannot open yet
       * is the one claim this flow may not make.
       */
      toast.success(
        ticket.status === "confirmed"
          ? "Ticket confirmed — enjoy the stream."
          : "Payment sent — your ticket unlocks once it confirms."
      );
    },
  });
}

export function useMyTickets() {
  const { ready, authenticated } = useAuth();
  return useQuery({
    queryKey: ["ms", "my-tickets"],
    queryFn: fetchMyTickets,
    enabled: ready && authenticated,
  });
}

// The backend has no owner filter on GET /streams, so "my streams" is every
// status list filtered to the signed-in owner.
export function useMyStreams() {
  const me = useMe();
  const ownerId = me.data?.id;
  return useQuery({
    queryKey: ["ms", "streams", "mine", ownerId],
    enabled: Boolean(ownerId),
    queryFn: async () => {
      const pages = await Promise.all([
        fetchStreams({ status: "live" }),
        fetchStreams({ status: "scheduled" }),
        fetchStreams({ status: "ended" }),
      ]);
      const items = pages
        .flatMap((page) => page.items)
        .filter((stream) => stream.ownerId === ownerId);
      return { items, nextCursor: null as string | null };
    },
  });
}

export function useCreateStream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStream,
    onSuccess: (stream) => {
      invalidateStreamSurfaces(queryClient);
      /*
        A HOUSE AND A STREAM ARE ONE MUTATION AND TWO ACTS, so they are counted
        as two. Opening a gist room is the thing this product is for; measuring
        both under one name would hide it inside the streaming numbers, which is
        precisely how "eleven of the original eighteen events were streams"
        happened in the first place.
      */
      trackMarketEvent(isHouse(stream) ? "room_opened" : "stream_started", {
        surface: isHouse(stream) ? "gist_rooms" : "studio",
        entityType: "stream",
        entityId: stream.id,
        metadata: {
          audience: stream.audience,
          scheduled: Boolean(stream.scheduledAt),
        },
      });
      /*
        A house is not a stream, and the person who just opened one should not
        be told it is. One mutation creates both — a house IS a stream with
        `category: "house"` — so the confirmation reads off what was actually
        made rather than off the function that made it.
      */
      toast.success(
        isHouse(stream)
          ? stream.status === "scheduled"
            ? "Gist room scheduled"
            : "Gist room opened"
          : "Stream created"
      );
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't create the stream.")),
  });
}

/**
 * "Remind me" on a room that has not opened yet.
 *
 * The service tells the askers when the host actually opens the room — fired by
 * go-live, never by the clock — so this promises nothing the product cannot
 * keep. Idempotent both ways.
 *
 * A 404 is "not deployed" rather than "no such room", the same rule the
 * Arkmark follows, so the control goes quiet instead of raising an error on a
 * server that has not shipped it. A 409 means the room is already over, which
 * is worth saying out loud.
 */
/**
 * Look up a room by the code somebody typed.
 *
 * Not retried: a 404 is a settled answer about a code, and retrying spends the
 * caller's throttle budget (a miss is charged, deliberately, because a free
 * miss is an unlimited number of guesses).
 */
export function useStreamByCode(code: string) {
  return useQuery({
    queryKey: ["ms", "stream-by-code", code],
    queryFn: () => fetchStreamByCode(code),
    enabled: code.length > 0,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRemindMe(streamId: string) {
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);

  const mutation = useMutation({
    mutationFn: (remind: boolean) => remindStream(streamId, remind),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", streamId] });
      queryClient.invalidateQueries({ queryKey: ["ms", "streams"] });
      toast.success(result.reminded ? "We'll tell you when it opens" : "Reminder off");
    },
    onError: (error) => {
      if (errorCode(error) === "NOT_FOUND") {
        setUnavailable(true);
        return;
      }
      if (errorCode(error) === "CONFLICT") {
        toast.error(errorMessage(error, "That room is already over."));
        return;
      }
      toast.error(errorMessage(error, "Couldn't set that reminder."));
    },
  });

  return { ...mutation, unavailable };
}

export function useGoLive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: goLive,
    onSuccess: ({ stream }) => {
      // Merged, never replaced: go-live's stream carries no house doorplate.
      queryClient.setQueryData<Stream>(["ms", "stream", stream.id], (old) => mergeStreamDetail(old, stream));
      invalidateStreamSurfaces(queryClient);
      toast.success("You're live");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't go live.")),
  });
}

export function useEndStream(options?: {
  /** What the surface calls the thing it ended — a gist room is not a "stream". */
  successMessage?: string;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: endStream,
    onSuccess: (stream) => {
      /*
        STREAMS ONLY, AND NOT `room_left`.

        I nearly fired `room_left` here for a house, and it would have been
        wrong in a way no test would catch: `room_left` means a PERSON left a
        room, and this is the HOST closing it for everybody. Two different facts
        under one name is worse than a missing one, because the number looks
        plausible and answers the wrong question.

        Nor is it ours to send. Joins and leaves are recorded SERVER-side —
        they are the only two events in the analyst's data precisely because
        they do not depend on a browser reaching anything — so firing them from
        here would double-count every one of them.

        A host closing a room is a real act with no name in the vocabulary yet.
        It gets one when somebody needs it, rather than by borrowing a name that
        already means something else.
      */
      if (!isHouse(stream)) {
        trackMarketEvent("stream_completed", {
          surface: "studio",
          entityType: "stream",
          entityId: stream.id,
        });
      }
      // Merged, never replaced: the session may still hold this room (a host's
      // "Close and join"), and the lock screen reads the doorplate from here.
      queryClient.setQueryData<Stream>(["ms", "stream", stream.id], (old) => mergeStreamDetail(old, stream));
      // The playback token and chat live under this prefix and are both dead
      // once the broadcast stops.
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", stream.id] });
      invalidateStreamSurfaces(queryClient);
      toast.success(options?.successMessage ?? "Stream ended");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't end the stream.")),
  });
}

export function useActivities(status: "scheduled" | "live" | "completed" | "cancelled" = "scheduled") {
  return useQuery({
    queryKey: ["ms", "activities", status],
    queryFn: () => fetchActivities({ status }),
  });
}

// No owner filter upstream: "my activities" is the scheduled list filtered to
// the signed-in host.
export function useMyActivities() {
  const me = useMe();
  const hostId = me.data?.id;
  return useQuery({
    queryKey: ["ms", "activities", "mine", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const page = await fetchActivities({ status: "scheduled" });
      return { ...page, items: page.items.filter((activity) => activity.hostId === hostId) };
    },
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createActivity,
    onSuccess: (activity) => {
      trackMarketEvent("activity_scheduled", { surface: "schedule", entityType: "activity", entityId: activity.id });
      queryClient.invalidateQueries({ queryKey: ["ms", "activities"] });
      // Activities are rendered as feed items and in the Featured Arena.
      queryClient.invalidateQueries({ queryKey: ["ms", "feed"] });
      // ...and in /live's Upcoming tab, which reads the stream list alongside
      // the activity list. Without this the newly scheduled item sat behind a
      // stale cache until that query happened to refetch.
      queryClient.invalidateQueries({ queryKey: ["ms", "streams"] });
      toast.success("Activity scheduled");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't schedule that.")),
  });
}

export function useCancelActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelActivity,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ms", "activities"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "feed"] });
      toast.success("Activity cancelled");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't cancel that.")),
  });
}

export function useUpdateActivity(activityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; startsAt?: string }) => updateActivity(activityId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ms", "activities"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "feed"] });
      toast.success("Activity updated");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't update that activity.")),
  });
}

// ---- Studio v2 ----

export function useUpdateStream(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof updateStream>[1]) => updateStream(streamId, patch),
    onSuccess: (stream) => {
      queryClient.setQueryData(["ms", "stream", streamId], (old: Stream | undefined) =>
        old ? { ...mergeStreamDetail(old, stream), myTicket: old.myTicket, viewerCount: old.viewerCount } : stream
      );
      invalidateStreamSurfaces(queryClient);
      toast.success("Stream updated");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't save changes.")),
  });
}

// Stats and events are owner-only and still shipping server-side: a failure
// means "not available yet", surfaced as a quiet placeholder — never retried
// aggressively, never faked.
export function useStreamStats(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "stream", streamId, "stats"],
    queryFn: () => fetchStreamStats(streamId),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useStreamEvents(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "stream", streamId, "events"],
    queryFn: () => fetchStreamEvents(streamId),
    enabled,
    retry: false,
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useDeleteChatMessage(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteChatMessage(streamId, messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", streamId, "chat"] });
      toast.success("Message removed");
    },
    onError: (error) => toast.error(errorMessage(error, "Moderation isn't available yet.")),
  });
}

export function useBanFromChat(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => banFromChat(streamId, userId),
    onSuccess: (_result, userId) => {
      // The service refuses to invite anyone it banned: the host's Invite to
      // speak is hidden for them from now on, not refused after a tap.
      rememberBan(inviteMemoryFor(streamId), userId);
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", streamId, "chat"] });
      toast.success("Banned from chat");
    },
    onError: (error) => toast.error(errorMessage(error, "Moderation isn't available yet.")),
  });
}

/**
 * How often a live room asks about things that change on human timescales.
 *
 * Both of these polled every 3 seconds. Nobody raises a hand twenty times a
 * minute, and nobody notices the difference between a 3-second and an
 * 8-second answer to "has the host let me speak yet" — but the machine
 * notices: at 3s each open room made 40 requests a minute per query, every one
 * of them a serverless invocation, and during an outage each of those became
 * a function sitting on a dead upstream. This is the single heaviest thing the
 * app does when everything is WORKING, which is why it is tuned rather than
 * only guarded.
 *
 * The real fix is the socket gateway that already exists for streams; this is
 * the honest interim, and it is written down so the next person knows which
 * one this is.
 */
/*
  THE FLOOR UNDER A SIGNAL THAT IS LIVE, not the mechanism.

  `speakerInvited`, `speakerRequestChanged` and `speakerMuted` are published on
  `user:<did>` and consumed in `components/layout/room-session.tsx`, which
  invalidates both speaker keys the moment a frame lands. So a raised hand
  already reaches the host over the socket; this interval only covers a socket
  that is unconfigured, refused or dropped.

  VERIFIED PUBLISHED rather than assumed, because a consumer existing says
  nothing about anything writing to it — the mistake that cost an afternoon on
  `peakViewers`. The service calls `personal.send(...)` at three sites, and one
  layer under that `personalSignal` is a no-op that DISCARDS everything unless
  `RABBITMQ_URL` is set. All three signals share that single if-block, so they
  cannot be independently off: realtime DM chat has been live in production
  since 2026-09-09, which means the block ran. The 2026-09-21 incident is the
  independent corroboration — a dead RabbitMQ channel was 500ing writes, and a
  broker that is not configured cannot have a dead channel.

  8s was the right number when the interval WAS the mechanism. At 30s a
  dropped socket costs a host half a minute to see a raised hand, which is the
  degraded path rather than the normal one, and it saves ~11 requests a minute
  per host.
*/
const SPEAKER_POLL_MS = 30_000;

export function useMySpeakerRequest(streamId: string, enabled: boolean) {
  const { ready, authenticated } = useAuth();
  return useQuery({
    queryKey: ["ms", "stream", streamId, "speaker-request", "me"],
    queryFn: () => fetchMySpeakerRequest(streamId),
    enabled: enabled && ready && authenticated,
    retry: false,
    refetchInterval: enabled ? SPEAKER_POLL_MS : false,
  });
}

export function useRequestToSpeak(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => requestToSpeak(streamId),
    onSuccess: (request) => {
      queryClient.setQueryData(["ms", "stream", streamId, "speaker-request", "me"], request);
      // The host's queue is a different query; without this the request only
      // appeared on their next 3 s poll.
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", streamId, "speaker-requests"] });
      // The host had already invited them: the service hands back that open
      // invitation (200) rather than a new request, and the banner asks the
      // question. "Request sent" would be a claim about a request that is not there.
      if (request.status === "invited") return;
      toast.success("Request sent to the host");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't request to speak.")),
  });
}

export function useSpeakerRequests(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "stream", streamId, "speaker-requests"],
    queryFn: () => fetchSpeakerRequests(streamId),
    enabled,
    retry: false,
    refetchInterval: enabled ? SPEAKER_POLL_MS : false,
  });
}

/**
 * Take a guest off the stage, by LiveKit identity.
 *
 * Shared because the host has TWO surfaces — the studio cockpit they broadcast
 * from and the watch page they may be moderating from — and the removal is the
 * same act on both: find that identity's approved speaker-request and resolve
 * it with `remove`. The backend drops the publish grant, LiveKit unpublishes
 * their tracks, and the stage loses the slot on the next
 * ParticipantPermissionsChanged. This lived inline in the cockpit; a second
 * copy on the watch page is how one of them quietly stops matching the other.
 *
 * `enabled` gates the underlying request poll, so a viewer who is not the host
 * never opens it.
 */
export function useRemoveGuest(streamId: string, enabled: boolean) {
  const requests = useSpeakerRequests(streamId, enabled);
  const resolve = useResolveSpeakerRequest(streamId);
  const remove = (identity: string) => {
    // The tile hands us the LiveKit identity, which for an approved speaker is
    // `<did>#speaker`; the request is keyed on the bare DID. Comparing them raw
    // never matched, so removing a guest always failed with "couldn't find
    // that guest's request" while the guest stayed on stage.
    const userId = baseIdentity(identity);
    const request = requests.data?.items.find(
      (item) => baseIdentity(item.userId) === userId && item.status === "approved"
    );
    // Not an assertion failure: the guest may have left a moment ago, and the
    // poll has not caught up. Say so rather than throwing.
    if (!request) {
      toast.error("Couldn't find that guest's request.");
      return;
    }
    resolve.mutate({ requestId: request.id, action: "remove" });
  };
  return { remove, removing: resolve.isPending };
}

export function useResolveSpeakerRequest(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    /* `room` pins the call to the room it was decided in. A leave that waits
       for an accept to settle (lib/speaker-invite.ts `releaseOnLeave`) fires
       after the session has moved on, when this hook's own id is the next
       room's, or nothing. */
    mutationFn: ({ requestId, action, room }: { requestId: string; action: SpeakerRequestAction; room?: string }) =>
      resolveSpeakerRequest(room ?? streamId, requestId, action),
    onSuccess: (_row, { room }) => {
      const id = room ?? streamId;
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", id, "speaker-requests"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", id, "speaker-request", "me"] });
    },
    onError: (error, { action, room }) => {
      const id = room ?? streamId;
      // The invitation had already ended (lib/speaker-invite.ts): true
      // already, so re-read the lists rather than raise an error.
      if (quietResolveError(error as ApiErrorLike, action)) {
        queryClient.invalidateQueries({ queryKey: ["ms", "stream", id, "speaker-requests"] });
        queryClient.invalidateQueries({ queryKey: ["ms", "stream", id, "speaker-request", "me"] });
        return;
      }
      // The stage cap (7 guests + host) also holds on approve now.
      if (action === "approve" && (error as ApiErrorLike)?.code === "STAGE_FULL") {
        toast.error("Every seat is taken. Move someone down first.");
        return;
      }
      toast.error(errorMessage(error, "Couldn't update the speaker."));
    },
  });
}

/* ---- invite to speak, and the host's soft mute ---------------------------

   Both are AHEAD OF THE BACKEND. Every call degrades quietly: the first answer
   that says the route is not deployed (lib/speaker-invite.ts `routeMissing` —
   the router's own "Route not found", never a 404 about a missing PERSON) is
   remembered for the page load and the controls go away, rather than
   offering a button that fails every time. A background read that finds the
   route missing says nothing; a host's TAP that finds it says so once ("Mute
   for everyone isn't available yet"), because a moderation action that ends
   with the control vanishing and no word reads as broken. Nothing is ever
   reported as done that the service did not do. */

let invitesMissing = false;
let muteMissing = false;

/**
 * The host's open invitations. Shares the request list's key prefix, so every
 * invalidation of the queue refetches these too; polls on the queue's cadence
 * and stops for good once the service says the filter does not exist.
 */
export function useSpeakerInvites(streamId: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["ms", "stream", streamId, "speaker-requests", "invited"],
    queryFn: async () => {
      try {
        return await fetchSpeakerInvites(streamId);
      } catch (error) {
        if (routeMissing(error as ApiErrorLike)) invitesMissing = true;
        throw error;
      }
    },
    enabled: enabled && !invitesMissing,
    retry: false,
    refetchInterval: (current) =>
      enabled && !routeMissing(current.state.error as ApiErrorLike | null) ? SPEAKER_POLL_MS : false,
  });
  return { ...query, unavailable: invitesMissing || routeMissing(query.error as ApiErrorLike | null) };
}

/**
 * The host's approved speakers, by row. The seat that settles an accepted
 * invitation, read from the service rather than waiting on the LiveKit grant.
 *
 * ─── SLOWER THAN THE PENDING QUEUE, ON PURPOSE ───────────────────────────────
 * The two lists look alike and change for completely different reasons.
 *
 * PENDING arrives from OTHER PEOPLE — somebody raises a hand and the host has
 * no other way to learn of it, so that queue is genuinely event-driven and
 * keeps the short poll.
 *
 * APPROVED changes when the HOST ACTS, and `useResolveSpeakerRequest`
 * invalidates `["ms","stream",id,"speaker-requests"]` on success — a PREFIX of
 * this key, so seating or moving somebody down refreshes this list
 * immediately, not on the next tick. The poll is only covering the one case
 * the host did not cause: a guest accepting an invitation. And even that shows
 * instantly in the room, because accepting makes them a LiveKit participant
 * and the roster is live.
 *
 * So the short poll was re-asking a question the mutation had already
 * answered. At 8s it was 7.5 requests a minute per host for a list that is
 * usually identical to the last one.
 */
const SEATED_POLL_MS = 30_000;

export function useSeatedSpeakers(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "stream", streamId, "speaker-requests", "approved"],
    queryFn: () => fetchSeatedSpeakers(streamId),
    enabled,
    retry: false,
    refetchInterval: enabled ? SEATED_POLL_MS : false,
  });
}

/**
 * Invite a listener up. Carries what the service told us about particular
 * people for as long as the page is loaded (features/streams/lib/invite-memory.ts,
 * so a remount of the room does not forget it): who the host banned (the
 * control is hidden for them) and who is in a cooldown until when. A BLOCKED
 * refusal changes nothing here — it may be the target's block.
 *
 * An invitation the service opened is tracked from THIS answer, not from the
 * next read of the invited list: one declined before that read would
 * otherwise never be told, while one that lapsed would.
 */
export function useInviteToSpeak(streamId: string) {
  const queryClient = useQueryClient();
  const memory = inviteMemoryFor(streamId);
  const [unavailable, setUnavailable] = useState(invitesMissing);
  // Who is refused and who is cooling down are read from the shared memory
  // itself, not a copy taken at mount: a chat ban (useBanFromChat) and an
  // invitation that ended (use-host-stage-tools) write there too. A new
  // answer here only has to draw again.
  const [, redraw] = useState(0);

  const mutation = useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) => inviteToSpeak(streamId, userId),
    onSuccess: (row, { userId, name }) => {
      if (row.status === "invited") {
        const held = inviteMemoryFor(streamId);
        // Open on the server, whatever this page thought: a repeat invite
        // answers the same id, and a Cancel that lost must not hide it.
        held.cancelled.delete(row.id);
        held.ended.delete(row.id);
        held.rows.set(row.id, row);
        held.tracked = trackInvite(
          held.tracked,
          { id: row.id, userId: baseIdentity(row.userId || userId), name, inviteExpiresAt: row.inviteExpiresAt, createdAt: row.createdAt },
          Date.now(),
          { offsetMs: serverClockOffset() }
        );
      }
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", streamId, "speaker-requests"] });
      toast(inviteSentMessage(row.status, name));
    },
    onError: (error, { userId, name }) => {
      const outcome = inviteErrorOutcome(error as ApiErrorLike, name);
      if (outcome.kind === "unavailable") {
        invitesMissing = true;
        setUnavailable(true);
        toast(outcome.message);
        return;
      }
      if (outcome.kind === "refused") {
        rememberBan(inviteMemoryFor(streamId), userId);
        redraw((count) => count + 1);
        toast(outcome.message);
        return;
      }
      if (outcome.kind === "cooldown") {
        const until = Date.now() + outcome.retryAfterSeconds * 1000;
        inviteMemoryFor(streamId).cooldowns.set(userId, until);
        redraw((count) => count + 1);
        toast(outcome.message);
        return;
      }
      toast.error(outcome.message);
    },
  });

  const refused: ReadonlySet<string> = memory.refused;
  const cooldowns: ReadonlyMap<string, number> = memory.cooldowns;
  return { ...mutation, unavailable: unavailable || invitesMissing, refused, cooldowns };
}

/**
 * The invitee's answer: Join as speaker, or Not now.
 *
 * Accepting seats them over the connection they already have, with the mic
 * OFF — nothing here, and nothing downstream, opens it (lib/mic-consent.ts).
 * Whatever the answer, the row is read again: an invitation that ran out while
 * the banner was up must disappear rather than wait for the next poll.
 *
 * `room` pins the answer to the room it was given in (lib/speaker-invite.ts
 * `answerLanding`). This hook lives in the session provider, which stays
 * mounted while the room changes, and a pending mutation runs the NEWEST
 * callbacks: read from `streamId`, an accept that came back after "Leave and
 * join" seated the reader in the next room.
 */
export function useAnswerInvite(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, action, room }: { requestId: string; action: "accept" | "reject"; room: string }) =>
      resolveSpeakerRequest(room, requestId, action),
    onSuccess: (row, { action, room }) => {
      const landing = answerLanding({ room, currentRoom: streamId, action, status: row.status });
      // The answered row goes straight into the cache, as asking to speak's
      // does: the banner goes at once (no second tap on a live button while a
      // slow refetch is out), and `approved` seats them without waiting a poll.
      queryClient.setQueryData(["ms", "stream", landing.room, "speaker-request", "me"], row);
      // The one-time hint: seated, and the mic is still theirs to open.
      if (landing.hint) toast(INVITE_ACCEPTED_HINT);
    },
    onError: (error, { action }) => {
      // A Not now on an invitation that already ended is quiet (lib/speaker-invite.ts).
      const message = answerErrorMessage(error as ApiErrorLike, action);
      if (message) toast.error(message);
    },
    onSettled: (_row, _error, { room }) => {
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", room, "speaker-request", "me"] });
      queryClient.invalidateQueries({ queryKey: ["ms", "stream", room, "speaker-requests"] });
    },
  });
}

/** The host's "Mute for everyone". Soft: the speaker may unmute themselves. */
export function useMuteSpeaker(streamId: string) {
  const [unavailable, setUnavailable] = useState(muteMissing);
  const mutation = useMutation({
    mutationFn: ({ userId }: { userId: string; name: string }) => muteSpeaker(streamId, baseIdentity(userId)),
    onSuccess: (result, { name }) => {
      // `reached` false: they had already dropped off the connection, and
      // nothing was muted. Said plainly rather than as a success.
      if (result && result.reached === false) {
        toast(`${name} isn't connected right now.`);
        return;
      }
      toast(`${name}'s mic is off for everyone. They can unmute when it's their turn.`);
    },
    onError: (error, { name }) => {
      const failure = muteFailure({ missing: routeMissing(error as ApiErrorLike), error: error as ApiErrorLike, name });
      if (failure.unavailable) {
        // The control goes, and the host is told why their tap did nothing.
        muteMissing = true;
        setUnavailable(true);
        toast(failure.message);
        return;
      }
      toast.error(failure.message);
    },
  });
  return { ...mutation, unavailable: unavailable || muteMissing };
}

const roomGuestsKey = (streamId: string) => ["ms", "room-guests", streamId] as const;

/**
 * WHO MAY ENTER THIS PRIVATE ROOM — host only, and only for a room with no house.
 *
 * A room that belongs to a house answers 400: its audience is the group and
 * there is no list. A guest asking answers 403, because a guest list names the
 * people who were invited and is not something the invited get to read.
 *
 * So this is asked ONLY where both are already known to be true, rather than
 * asked optimistically and the error swallowed — an error state that is the
 * normal case for most callers is not an error state, it is a missing check.
 */
export function useRoomGuests(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: roomGuestsKey(streamId),
    queryFn: () => fetchRoomGuests(streamId),
    enabled: enabled && Boolean(streamId),
  });
}

/**
 * Let somebody into a private room that is already running.
 *
 * THE PIECE THAT WAS MISSING. `guests` on create was the only way anybody was
 * ever added, so a host who forgot somebody — or whose guest could not get in —
 * had no move except closing the room and making another one. The route has
 * been live the whole time and nothing called it.
 */
export function useInviteRoomGuest(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => inviteRoomGuest(streamId, profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roomGuestsKey(streamId) });
      toast.success("They can come in now");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't add them.")),
  });
}

/** Take somebody back out. The guest list IS the membership, so this removes
 *  their access rather than only their name — the door closes on their next read. */
export function useRemoveRoomGuest(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => removeRoomGuest(streamId, profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: roomGuestsKey(streamId) });
      toast.success("Removed from the room");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't remove them.")),
  });
}

const knocksKey = (streamId: string) => ["ms", "room-knocks", streamId] as const;
const myKnockKey = (streamId: string) => ["ms", "my-knock", streamId] as const;

/**
 * ASK TO COME IN, with the code somebody gave you.
 *
 * No optimistic anything: the whole point is that a human has to answer, so the
 * only honest state after this succeeds is "asked".
 */
export function useKnockWithCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => knockWithCode(code),
    onSuccess: (knock) => {
      queryClient.setQueryData(myKnockKey(knock.streamId), knock);
      /*
        ALREADY INSIDE IS AN IMMEDIATE `admitted` with nothing queued — the host,
        a guest, anybody the three doors already admit. They asked to come in and
        they are in, so this says so rather than "asked".
      */
      toast.success(knock.status === "admitted" ? "You're in" : "Asked to join");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't ask to join.")),
  });
}

/**
 * MY OWN KNOCK, polled while the reader is waiting on it.
 *
 * `declined` is reported as `pending` here for ever, by design — so this poll
 * can never turn into a refusal and nothing built on it may imply one is
 * coming. It is watching for `admitted`, and for nothing else.
 */
export function useMyKnock(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: myKnockKey(streamId),
    queryFn: () => fetchMyKnock(streamId),
    enabled: enabled && Boolean(streamId),
    // Only while somebody is actually looking at a door they are waiting on.
    refetchInterval: enabled ? 5_000 : false,
    // A 404 is "you have not knocked", which is a state rather than a failure.
    retry: false,
  });
}

/**
 * HOST: who is asking to come in.
 *
 * Polled, because a knock arrives while the host is doing something else and a
 * queue nobody sees is a person standing outside a door nobody answers.
 */
export function useWaitingKnocks(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: knocksKey(streamId),
    queryFn: () => fetchWaitingKnocks(streamId),
    enabled: enabled && Boolean(streamId),
    refetchInterval: enabled ? 5_000 : false,
  });
}

/**
 * HOST: open the door, or do not.
 *
 * A DECLINE IS SILENT. The service tells the person nothing, their own knock
 * still reads `pending`, and they cannot knock again — so the only signal that
 * anything happened is this queue losing a row. The toast is therefore for the
 * HOST's benefit alone and says what they did, not what the other person now
 * knows.
 */
export function useResolveKnock(streamId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ knockId, action }: { knockId: string; action: "admit" | "decline" }) =>
      resolveKnock(streamId, knockId, action),
    onSuccess: (_result, { action }) => {
      queryClient.invalidateQueries({ queryKey: knocksKey(streamId) });
      // Admitting writes a guest row, so the room's list changes with it.
      queryClient.invalidateQueries({ queryKey: ["ms", "room-guests", streamId] });
      toast.success(action === "admit" ? "They can come in" : "Declined");
    },
    onError: (error) => toast.error(errorMessage(error, "That didn't work.")),
  });
}

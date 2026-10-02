"use client";

import { z } from "zod";
import { msApi } from "@/lib/api/service";
import { errorCode } from "@/lib/api/envelope";
import { ProfileSchema, type DeepLink } from "@/lib/api/schemas";
import {
  ActivityListSchema,
  ActivitySchema,
  ChatMessageSchema,
  ChatSchema,
  GoLiveSchema,
  HeartbeatSchema,
  MyTicketsSchema,
  PlaybackSchema,
  QuoteSchema,
  RemindSchema,
  StreamEventsSchema,
  SpeakerRequestListSchema,
  SpeakerRequestSchema,
  StreamByCodeSchema,
  FollowingRoomsSchema,
  StreamListSchema,
  StreamSchema,
  StreamReactionSchema,
  StreamStatsSchema,
  TicketSchema,
  type StreamCategory,
  type StreamKind,
  type TicketTier,
} from "@/features/streams/lib/types";

// Backend status enum is live | scheduled | ended — "replay" is a UI concept
// (ended + non-null replayUrl), filtered by the caller.
/**
 * Has this deployment refused `sort=listeners` yet?
 *
 * The busiest-first order ships with the service; a deployment that predates it
 * answers 400 VALIDATION_ERROR on `sort`. The FIRST such refusal is remembered
 * for the page load and every later call asks for the default order, so a
 * carousel is never empty on an older server and never pays for a second
 * request once we know. It is only ever set by that exact refusal.
 */
let listenerSortRefused = false;

function refusedListenerSort(error: unknown): boolean {
  const details = (error as { code?: string; details?: unknown } | null)?.details;
  return (
    errorCode(error) === "VALIDATION_ERROR" &&
    Array.isArray(details) &&
    details.some((detail) => (detail as { path?: string } | null)?.path === "sort")
  );
}

export async function fetchStreams(params: {
  status?: "live" | "scheduled" | "ended";
  /**
   * `listeners` — busiest first, ranked within the newest 200 live rooms, ties
   * to the most recently started. The service accepts it only with
   * `status: "live"`; anything else is a 400 by design.
   */
  sort?: "listeners";
  category?: StreamCategory;
  /** Broadcasts or gist rooms — see StreamKind. */
  kind?: StreamKind;
  /** Topic keys from the viewer's picker; omitted when nothing is chosen. */
  topics?: string[];
  /**
   * ONE HOUSE'S ROOMS — `GET /streams?houseConversationId=` on the contract.
   *
   * The house page's Replays rail wants the rooms of ONE house, and the only
   * alternative was loading every ended house room and dropping most of them
   * on the client. That is not a slow version of the right answer, it is a
   * wrong one: it breaks the moment there is a second page, which is exactly
   * when a house has enough history for the rail to matter.
   *
   * A malformed uuid is a clean 400 rather than a 500.
   */
  houseConversationId?: string;
  cursor?: string;
  limit?: number;
}) {
  const { topics, sort, ...rest } = params;
  const query = {
    ...rest,
    // Comma-joined, and omitted entirely when nothing is chosen — an empty
    // `topics=` would read as "match no topics" rather than "no filter".
    ...(topics && topics.length > 0 ? { topics: topics.join(",") } : {}),
  };
  if (sort && !listenerSortRefused) {
    try {
      return StreamListSchema.parse(await msApi.get("/streams", { ...query, sort }));
    } catch (error) {
      if (!refusedListenerSort(error)) throw error;
      listenerSortRefused = true;
    }
  }
  return StreamListSchema.parse(await msApi.get("/streams", query));
}

export async function fetchStream(id: string) {
  return StreamSchema.parse(await msApi.get(`/streams/${id}`));
}

/**
 * Record a burst of hearts against the stream, and read back the real tally.
 *
 * The floating hearts still travel over the room's data channel — that is what
 * makes them instant and what lets a dropped one simply not appear. This is
 * the other half: the COUNT, which has to survive the moment the animation is
 * about. Without it the header read 0 for the whole broadcast however hard the
 * room tapped, because nothing had ever been asked to count.
 *
 * A burst, not a tap, because callers coalesce: holding the button is one
 * request a second rather than one per heart.
 */
export async function reactToStream(streamId: string, burst: number) {
  return StreamReactionSchema.parse(
    await msApi.post(`/streams/${streamId}/reactions`, { burst })
  );
}

/**
 * LOVES A MESSAGE, or takes the love back.
 *
 * Idempotent in both directions: a second love answers 200 rather than an
 * error, and removing one that was never there is an answer rather than a
 * failure. The emoji is URL-encoded on the way out because it is a path
 * segment and an emoji is several bytes.
 */
export async function setChatReaction(
  streamId: string,
  messageId: string,
  emoji: string,
  loved: boolean
) {
  const base = `/streams/${streamId}/chat/${messageId}/reactions`;
  return loved
    ? msApi.post(base, { emoji })
    : msApi.del(`${base}/${encodeURIComponent(emoji)}`);
}

export async function quoteTicket(streamId: string, tier: TicketTier) {
  return QuoteSchema.parse(await msApi.post(`/streams/${streamId}/tickets/quote`, { tier }));
}

export async function purchaseTicket(streamId: string, tier: TicketTier) {
  return TicketSchema.parse(await msApi.post(`/streams/${streamId}/tickets`, { tier }));
}

/**
 * Report the transfer the buyer signed for a ticket.
 *
 * The service RECORDS this and grants nothing: a hash from a client is a
 * claim, not proof, so the ticket stays pending until the watcher observes
 * that transfer paying the treasury the exact price from the buyer's own
 * wallet. Nothing here may tell the buyer they are in.
 */
export async function reportTicketTransfer(streamId: string, ticketId: string, txHash: string) {
  return TicketSchema.parse(
    await msApi.post(`/streams/${streamId}/tickets/${ticketId}/transfer`, { txHash })
  );
}

/**
 * Ask to be told when a scheduled room opens, or take the ask back.
 *
 * Idempotent both ways, and fired by go-live rather than by the clock — so the
 * notification says the room IS open, never that it ought to be. A room that
 * has already ended answers 409: a promise to announce something that is over
 * is one the service cannot keep.
 */
export async function remindStream(streamId: string, remind: boolean) {
  const path = `/streams/${streamId}/remind`;
  return RemindSchema.parse(remind ? await msApi.post(path) : await msApi.del(path));
}

/**
 * Resolve a spoken room code.
 *
 * The input is sent AS TYPED — any case, spacing or dashes — because the
 * service matches leniently and normalising here would give the client and the
 * service two different opinions about what a code is. Encoded, not rewritten.
 *
 * A 404 is the same answer for an unknown code and a malformed one, by design:
 * a refusal that tells them apart tells somebody probing which guesses are
 * worth repeating.
 */
export async function fetchStreamByCode(code: string) {
  return StreamByCodeSchema.parse(
    await msApi.authedGet(`/streams/by-code/${encodeURIComponent(code)}`)
  );
}

export async function fetchPlaybackToken(streamId: string) {
  return PlaybackSchema.parse(await msApi.post(`/streams/${streamId}/playback-token`));
}

/**
 * A LISTEN-ONLY grant for the room card's hover preview — `POST
 * /streams/:id/preview-token`, the same `{ url, token, expiresAt }` shape as
 * the playback grant. Subscribe-only, hidden from the roster, minted on a
 * `preview-<uuid>` identity so previewing a room you are already in cannot
 * evict your real connection. 120s TTL; 404 unknown or private, 409 not a
 * live gist room yet, 429 throttled. Auth optional (the BFF opens it).
 *
 * IT MUST NEVER BE PAIRED WITH A HEARTBEAT: heartbeats feed viewerCount,
 * participants and watch time, and a previewing card would count itself as
 * audience. `use-room-preview.ts` does not import `sendHeartbeat`, and
 * `lib/shell-invariants.test.ts` pins that.
 */
export async function fetchPreviewToken(streamId: string) {
  return PlaybackSchema.parse(await msApi.post(`/streams/${streamId}/preview-token`));
}

export async function sendHeartbeat(streamId: string, sessionId: string | null, mode: "live" | "replay") {
  return HeartbeatSchema.parse(
    await msApi.post(`/streams/${streamId}/heartbeat`, { sessionId: sessionId ?? undefined, mode })
  );
}

/**
 * One page of chat, NEWEST FIRST with a cursor that walks further back —
 * the service's history shape. Callers draw it through `oldestFirst`
 * (lib/chat-order.ts); nothing renders a page in the order it arrives.
 */
export async function fetchChat(streamId: string, cursor?: string | null) {
  return ChatSchema.parse(
    await msApi.get(`/streams/${streamId}/chat`, cursor ? { cursor } : undefined)
  );
}

export async function sendChat(
  streamId: string,
  text: string,
  { replyToId, mentions }: { replyToId?: string; mentions?: string[] } = {}
) {
  return ChatMessageSchema.parse(
    await msApi.post(`/streams/${streamId}/chat`, {
      text,
      // OMITTED when absent rather than sent null: the service reads a missing
      // field as "no reply" and "no mentions", and a null would be a claim.
      ...(replyToId ? { replyToId } : {}),
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    })
  );
}

export async function createStream(input: {
  title: string;
  description?: string;
  category: StreamCategory;
  /**
   * Keys from the shared vocabulary (`GET /topics`) — never a hard-coded list.
   * The service validates them against the topics table and rejects an unknown
   * key BY NAME, so a client that invents a chip gets a 400 on submit rather
   * than a silently untagged room.
   */
  topics?: string[];
  /**
   * WHO may find the room. `public` is listed everywhere; `private` is
   * reachable by the HOST, by members of `houseConversationId`, and by anyone
   * in `guests` — three doors, enforced in the service's listing query rather
   * than by the caller. A private room needs at least one of the last two or it
   * is a room only its host can reach. Distinct from `visibility`, which is a
   * door charge.
   */
  audience?: "public" | "private";
  /** Required when `audience` is `private`; the caller must be a member. */
  houseConversationId?: string;
  /**
   * WHO MAY ENTER a private room opened WITHOUT a house — up to 50 profile ids.
   *
   * The service's listing filter has three doors: the host, the members of
   * `houseConversationId`, and a row in `stream_guests`. This writes the third,
   * which is what lets a private room exist with no house behind it.
   *
   * Sent HERE rather than as follow-up invites because the room and its list are
   * written in one transaction — an invite loop that fails on the third person
   * leaves a live, half-invited room that nobody asked for and no client can
   * roll back. An unknown id refuses the whole create rather than silently
   * shortening the list, so a host never opens a room missing somebody they
   * chose.
   *
   * REFUSED alongside `houseConversationId`: the group is already the audience
   * there, and a second source of truth for "who is allowed in" is how the two
   * come to disagree.
   */
  guests?: string[];
  /**
   * WHO MAY TYPE in the room's chat (migration 041). `followers` admits the
   * host, the host's followers, and anyone the host has approved as a speaker;
   * everyone else is refused on SEND. It gates writing only — reading a room's
   * chat is never restricted by this. Defaults to `open`, the historic
   * behaviour, so omitting it changes nothing.
   */
  chatAccess?: "open" | "followers";
  thumbnailUrl?: string;
  scheduledAt?: string;
  visibility: "public" | "ticketed";
  ticketPriceKash?: string;
  vipPriceKash?: string;
}) {
  return StreamSchema.parse(await msApi.post("/streams", input));
}

// POST /streams/:id/go-live answers { stream, ingest } — ingest carries the
// RTMP url/key (and room token) shown once in the studio.
export async function goLive(streamId: string) {
  return GoLiveSchema.parse(await msApi.post(`/streams/${streamId}/go-live`));
}

/**
 * ENDS A ROOM, AND BELIEVES THE ROOM OVER THE RESPONSE.
 *
 * The end path does its work and can still throw afterwards: on 2026-09-21
 * every close in production answered 500 INTERNAL_ERROR while the stream came
 * back `status: "ended"` with `endedAt` set. The host was told "couldn't end
 * the stream" about a room that was already closed, so they pressed it again,
 * and again.
 *
 * So a failure is CHECKED rather than trusted. One read of the stream answers
 * the only question that matters — is it over? — and a room that is over is a
 * success whatever the POST said. Anything else rethrows untouched: a room
 * that is genuinely still live must still report the failure, or this becomes
 * a way to swallow real errors.
 *
 * The read is cheap, happens only on the error path, and its own failure
 * changes nothing: the original error is what the caller hears.
 */
export async function endStream(streamId: string) {
  try {
    return StreamSchema.parse(await msApi.post(`/streams/${streamId}/end`));
  } catch (error) {
    const settled = await fetchStream(streamId).catch(() => null);
    if (settled && (settled.status === "ended" || settled.status === "cancelled")) return settled;
    throw error;
  }
}

/**
 * The people you follow who are in a room RIGHT NOW.
 *
 * Authed: it is a statement about the caller's own graph. A 404 means the
 * route is not deployed, which the hook turns into silence rather than an
 * error — an absent rail is the correct rendering of "nobody is around".
 */
export async function fetchFollowingRooms() {
  return FollowingRoomsSchema.parse(await msApi.authedGet("/me/following/rooms"));
}

export async function fetchMyTickets() {
  return MyTicketsSchema.parse(await msApi.authedGet("/me/tickets"));
}

export async function fetchActivities(params: {
  status?: "scheduled" | "live" | "completed" | "cancelled";
  cursor?: string;
  limit?: number;
}) {
  return ActivityListSchema.parse(await msApi.get("/activities", params));
}

export async function createActivity(input: {
  type: "game" | "stream" | "event";
  title: string;
  description?: string;
  startsAt: string;
  deepLink?: DeepLink;
}) {
  return ActivitySchema.parse(await msApi.post("/activities", input));
}

export async function cancelActivity(id: string) {
  return ActivitySchema.parse(await msApi.post(`/activities/${id}/cancel`));
}

export async function updateActivity(id: string, patch: { title?: string; startsAt?: string }) {
  return ActivitySchema.parse(await msApi.patch(`/activities/${id}`, patch));
}

// ---- Studio v2 additions (backend contracts in progress; callers treat
// failures as "not available yet", never as fatal) ----

export async function updateStream(
  id: string,
  patch: {
    title?: string;
    description?: string;
    category?: StreamCategory;
    thumbnailUrl?: string;
    ticketPriceKash?: string;
    vipPriceKash?: string;
  }
) {
  return StreamSchema.parse(await msApi.patch(`/streams/${id}`, patch));
}

export async function fetchStreamStats(id: string) {
  return StreamStatsSchema.parse(await msApi.authedGet(`/streams/${id}/stats`));
}

export async function fetchStreamEvents(id: string, cursor?: string) {
  return StreamEventsSchema.parse(await msApi.authedGet(`/streams/${id}/events`, { cursor }));
}

export async function deleteChatMessage(streamId: string, messageId: string) {
  return msApi.del<{ removed: boolean }>(`/streams/${streamId}/chat/${messageId}`);
}

export async function banFromChat(streamId: string, userId: string) {
  return msApi.post<{ banned: boolean }>(`/streams/${streamId}/bans`, { userId });
}

export async function requestToSpeak(streamId: string) {
  return SpeakerRequestSchema.parse(await msApi.post(`/streams/${streamId}/speaker-requests`));
}

export async function fetchMySpeakerRequest(streamId: string) {
  return SpeakerRequestSchema.nullable().parse(
    await msApi.authedGet(`/streams/${streamId}/speaker-requests/me`)
  );
}

export async function fetchSpeakerRequests(streamId: string) {
  return SpeakerRequestListSchema.parse(
    await msApi.authedGet(`/streams/${streamId}/speaker-requests`)
  );
}

/**
 * What may be done to a speaker-request row.
 *
 * `accept` / `reject` are the INVITEE's answers to a host's invitation and
 * `cancel` the host taking one back — widened ahead of the backend (invite to
 * speak). Until it ships the service refuses them with a VALIDATION_ERROR on
 * `action`, which lib/speaker-invite.ts `routeMissing` reads as "not deployed".
 * A host's `approve` on an invited row answers 409 AWAITING_INVITEE: consent is
 * the invitee's, never the host's.
 */
export type SpeakerRequestAction = "approve" | "decline" | "remove" | "leave" | "accept" | "reject" | "cancel";

export async function resolveSpeakerRequest(
  streamId: string,
  requestId: string,
  action: SpeakerRequestAction
) {
  return SpeakerRequestSchema.parse(
    await msApi.post(`/streams/${streamId}/speaker-requests/${requestId}/${action}`)
  );
}

/**
 * Ask a listener up — `POST /streams/:id/speaker-invites { userId }`, host only.
 *
 * NOT DEPLOYED YET: the router's "Route not found" hides the control
 * (lib/speaker-invite.ts). 201 is a new invitation (`invited`, 60s), 200 the
 * one already open; a listener whose hand was already up is simply seated,
 * and the row comes back `approved`. Nothing here seats anybody on a guess.
 */
export async function inviteToSpeak(streamId: string, userId: string) {
  return SpeakerRequestSchema.parse(
    await msApi.post(`/streams/${streamId}/speaker-invites`, { userId })
  );
}

/**
 * The host's open invitations — the request list filtered to `invited`.
 *
 * Filtered AGAIN on the client: an older service that ignored the filter
 * would otherwise hand back the pending queue under an "Invited" heading.
 */
export async function fetchSpeakerInvites(streamId: string) {
  const list = SpeakerRequestListSchema.parse(
    await msApi.authedGet(`/streams/${streamId}/speaker-requests`, { status: "invited" })
  );
  return { ...list, items: list.items.filter((item) => item.status === "invited") };
}

/**
 * The host's seated speakers — the request list filtered to `approved`.
 *
 * The plain list defaults to `pending` on the service, so an accepted
 * invitation never shows up there; without this, an invitee whose grant had
 * not reached LiveKit yet was reported to the host as "isn't available".
 * Filtered again on the client for the same reason as the invited list.
 */
export async function fetchSeatedSpeakers(streamId: string) {
  const list = SpeakerRequestListSchema.parse(
    await msApi.authedGet(`/streams/${streamId}/speaker-requests`, { status: "approved" })
  );
  return { ...list, items: list.items.filter((item) => item.status === "approved") };
}

/**
 * The host's soft mute — `POST /streams/:id/speakers/:userId/mute`, owner only.
 *
 * Mutes the speaker's MICROPHONE on the server and sets the `hostMuted`
 * attribute on them (the service writes `'true'`; lib/host-mute.ts reads any
 * value set); they may unmute themselves. There is no unmute route and no lock, by
 * decision. `userId` is the BARE user id (`baseIdentity`), never `#speaker`.
 * NOT DEPLOYED YET: a route 404 hides the control.
 */
export async function muteSpeaker(streamId: string, userId: string) {
  return msApi.post<{ userId: string; muted: boolean; reached: boolean; tracksMuted: number }>(
    `/streams/${streamId}/speakers/${encodeURIComponent(userId)}/mute`
  );
}

/**
 * WHO MAY ENTER A PRIVATE ROOM THAT BELONGS TO NO HOUSE — the guest list, which
 * IS that room's membership: the host, whoever they invited, and nobody else.
 *
 * HOST ONLY, and that is not an oversight: a guest list names the people who
 * were invited, so it is not something the invited get to read. A guest asking
 * gets a 403. A room WITH a house has no guest list — its audience is the group
 * — and answers 400.
 */
export const RoomGuestsSchema = z.object({
  /*
    `ProfileSummary` upstream, which `ProfileSchema` is a superset of — parsing
    with the fuller shape costs nothing here (every field it adds is optional
    and defaulted) and means a guest row renders with the same component as a
    person anywhere else.
  */
  guests: z.array(ProfileSchema).optional().default([]),
});

export async function fetchRoomGuests(streamId: string) {
  return RoomGuestsSchema.parse(await msApi.get(`/streams/${streamId}/guests`));
}

/**
 * Let somebody in — `POST /streams/:id/guests`.
 *
 * HOST ONLY, deliberately: a guest who could invite would turn the list into a
 * chain anybody on it can extend, which is the one way a small room stops being
 * small without its host doing anything.
 *
 * Idempotent — inviting somebody already on the list keeps the FIRST
 * invitation, so the record of who let them in is not rewritten by a later one.
 */
export async function inviteRoomGuest(streamId: string, profileId: string) {
  return msApi.post<unknown>(`/streams/${streamId}/guests`, { profileId });
}

/**
 * Take somebody back out — `DELETE /streams/:id/guests/:profileId`.
 *
 * The door closes on their next read. The guest list IS the membership here, so
 * this removes their ACCESS rather than only their name.
 */
export async function removeRoomGuest(streamId: string, profileId: string) {
  return msApi.del<unknown>(`/streams/${streamId}/guests/${profileId}`);
}

/**
 * ASKING TO COME INTO A PRIVATE ROOM — knock-to-join.
 *
 * THE CODE LETS YOU ASK, NOT IN. That is the whole model: a host can share a
 * code freely because holding it is not permission, and the person who wants in
 * announces themselves rather than the host having to know in advance exactly
 * who will turn up.
 *
 * FOUR STATES, and the two unobvious ones carry the meaning:
 *
 *  · `declined` is PERMANENT — it is what stops a knock being looped, and a
 *    host who declines once should not have to decline forty times — but the
 *    knocker NEVER SEES IT. `GET /knocks/me` reports it as `pending` for ever,
 *    because a decline somebody can detect is one they can retry against, and
 *    it reports a decision that is not theirs to know.
 *  · `expired` is what an outstanding knock becomes when the ROOM ENDS, and is
 *    deliberately not `declined`: "the room ended" is not about them.
 *
 * So nothing here should ever render "you were declined". The state does not
 * exist from this side.
 */
export const StreamKnockSchema = z.object({
  id: z.string(),
  streamId: z.string().optional().default(""),
  profileId: z.string().optional().default(""),
  status: z.enum(["pending", "admitted", "declined", "expired"]).optional().default("pending").catch("pending"),
  createdAt: z.string().optional().default(""),
  resolvedAt: z.string().nullable().optional().default(null),
  /** Who opened the door. Null until somebody does, and on every other outcome. */
  admittedBy: z.string().nullable().optional().default(null),
});

/**
 * A row of the HOST's queue — the knock plus WHO is asking.
 *
 * Its own type rather than a widened knock, because the knocker's own read has
 * no use for the profile: they know who they are. The service hydrates it in
 * ONE read; a profile fetch per row would be an N+1 on a list whose only
 * purpose is to be looked at.
 *
 * A knock whose profile has gone is DROPPED by the service rather than returned
 * blank, which is the right call and means this never has to render a nameless
 * row: an unidentifiable person is not somebody a host can decide about.
 */
export const WaitingKnockSchema = StreamKnockSchema.extend({
  profile: ProfileSchema.nullable().optional().default(null),
});

export const WaitingKnocksSchema = z.object({
  items: z.array(WaitingKnockSchema).optional().default([]),
});

export type StreamKnock = z.infer<typeof StreamKnockSchema>;
export type WaitingKnock = z.infer<typeof WaitingKnockSchema>;

/** Ask to come in, with the code somebody gave you. */
export async function knockWithCode(code: string) {
  return StreamKnockSchema.parse(await msApi.post("/streams/knocks", { code }));
}

/**
 * What became of my own knock.
 *
 * Remember that `declined` is reported as `pending` here, permanently. There is
 * no polling schedule that will ever turn it into a refusal, and a UI that
 * implies one is promising an answer that is not coming.
 */
export async function fetchMyKnock(streamId: string) {
  return StreamKnockSchema.parse(await msApi.get(`/streams/${streamId}/knocks/me`));
}

/** HOST: who is asking to come in, newest first, with their profiles. */
export async function fetchWaitingKnocks(streamId: string) {
  return WaitingKnocksSchema.parse(await msApi.get(`/streams/${streamId}/knocks`));
}

/** HOST: open the door, or do not. A decline tells the person nothing. */
export async function resolveKnock(
  streamId: string,
  knockId: string,
  action: "admit" | "decline"
) {
  return msApi.post<unknown>(`/streams/${streamId}/knocks/${knockId}/${action}`);
}

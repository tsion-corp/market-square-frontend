import type { Profile } from "../../../lib/api/schemas.ts";
import type { Conversation, ConversationRef } from "./types.ts";

/**
 * A 1:1 you JUST opened, in the shape the thread needs — before any list has it.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The messages page opens a linked thread (`/messages?c=<id>`) by finding it in
 * the inbox's loaded list, because there is no `GET /conversations/:id`. That
 * works for a thread you already share, and NOT for one you start with
 * somebody who does not follow you:
 *
 *   - `POST /conversations` creates the thread `pending`, with you as
 *     `requested_by`, unless the other person already FOLLOWS you
 *     (`invited = isFollowing(peer, you)` in the service).
 *   - The page resolves the link against the ALL list, and
 *     `GET /me/conversations` defaults `state` to `accepted` — so a pending
 *     thread is not in it.
 *
 * The thread is NOT unreachable, and an earlier version of this comment said it
 * was: the Gist Requests tab asks for `state=pending`, and the service returns
 * the requester's OWN outgoing request there as a row (only Accept/Decline are
 * hidden, since you cannot answer your own). What failed was the LINK alone —
 * `?c=<id>` searched All, found nothing, and Start gisting, a profile's Message
 * button and the support chat all landed on the inbox instead of the person.
 * Somebody who winked at you usually does not follow you, which is why the wink
 * card hit it first.
 *
 * ─── WHERE THE OBJECT COMES FROM ─────────────────────────────────────────────
 * The response is a bare REF — id, participant ids, timestamps; no peer, no
 * kind. Every caller, though, already holds the profile it tapped, so the
 * thread is built from the server's id plus that profile. Nothing is invented:
 * the id is the service's and the peer is the person being messaged. The rest
 * is what a brand-new 1:1 IS, lifted unchanged from the `+` picker, which has
 * opened its threads this way all along and never had the bug.
 *
 * `requestState` and `requestedBy` stay unset, as the picker leaves them: the
 * ref does not carry them, and the schema's undefaulted field exists precisely
 * so "this object does not say" is not mistaken for "accepted".
 */
export function conversationFromRef(ref: ConversationRef, peer: Profile): Conversation {
  return {
    id: ref.id,
    kind: "direct",
    // A 1:1 has no creator and is never joinable by link.
    createdBy: null,
    // Nobody is invited into a 1:1; it is opened, by one of the two people in it.
    invitedBy: null,
    /*
      Neither setting exists in a 1:1 and both are stated rather than left to a
      default. Nobody is a leader in a direct thread, so there is no one to
      restrict posting TO and no house whose name a room could be opened in —
      which is also why moderation is refused there by the service.
    */
    whoCanPost: "everyone",
    canOpenRoom: false,
    // House fields. A 1:1 has no link and no room cap.
    website: null,
    weeklyRoomLimit: null,
    visibility: "private",
    // Roles and per-house levels belong to groups.
    viewerRole: null,
    notificationSettings: null,
    imageUrl: null,
    description: null,
    title: null,
    peer,
    members: [],
    memberCount: null,
    lastSender: null,
    lastMessage: null,
    lastMessageAt: ref.lastMessageAt ?? null,
    lastActiveAt: null,
    requestedBy: null,
    unreadCount: 0,
    // A thread opened this second has no history, so it has no streak. The
    // service's own row replaces this the moment the inbox refetches.
    snapStreak: 0,
    snapStreakExpiresAt: null,
  };
}

/**
 * Where an opened thread is held until the page reads it.
 *
 * Its own second segment on purpose: the inbox is invalidated under
 * `["ms", "conversations"]` every time a thread opens, and a key under that
 * prefix would be swept away by the same call that wrote it.
 */
export function openedConversationKey(id: string) {
  return ["ms", "opened-conversation", id] as const;
}

/**
 * WHERE A NOTIFICATION ROW GOES WHEN YOU TAP IT.
 *
 * ─── THE BUG THIS EXISTS TO KILL ─────────────────────────────────────────────
 * The rule used to be one line: `if (item.streamId) return /live/<id>`. But a
 * GIST ROOM IS A STREAM — it is a `Stream` carrying `category: "house"` — so
 * `house_room` rows ("preach opened a gist room in Square Talk") carry a
 * `streamId` exactly like a broadcast does, and every one of them was sent to
 * the video player. ogazboiz hit it: a row that says "Gist room opened" landed
 * on a black "This stream has ended" page whose own header still read HOUSE.
 *
 * That was two failures wearing one coat. The surface was wrong — an audio room
 * rendered by a player with no audio room in it — and because the broadcast's
 * ended state offers nothing tappable, it was also a dead end. Routing to the
 * room fixes both at once: `ClosedHouse` keeps the topic as a heading, names
 * the host, links to their profile and offers "Open a gist room about this".
 * No new screen was needed; the right one already existed.
 *
 * ─── WHY THREE SIGNALS AND NOT ONE ───────────────────────────────────────────
 * `subject.kind` is the SERVICE's own answer (`category === 'house' ? 'room' :
 * 'stream'`), so it is the one to trust first — it means the client never
 * re-derives what a gist room is. But `subject` is served-but-undocumented and
 * this schema parses it as optional precisely because deployed environments lag,
 * and a row that arrives without it must not silently fall back to the wrong
 * surface. So two independent facts back it up: the kind `house_room` can only
 * ever be a gist room, and a non-null `house` is set by the backend on that kind
 * alone (`houseOf`, which returns null for every other kind).
 *
 * Any one of the three is sufficient; needing all three would reintroduce the
 * bug the moment one field lagged. They cannot disagree in a way that matters —
 * each is only ever set for a room.
 *
 * `speaker_request` is deliberately NOT in that list. A raised hand happens in
 * a gist room and in a native broadcast, so it is routed by `subject.kind` like
 * anything else: naming the kind would send every video stream's speaker
 * request to a room that does not exist.
 *
 * Pure, with no framework imports, so `node --test` pins it. It takes a
 * structural type rather than importing `MarketNotification`, because `lib/` is
 * the lowest layer and may never import from `features/`.
 */

import { housePath } from "./house-path.ts";
import { profileHref } from "./profile-href.ts";
import { sq } from "./square-path.ts";

export type NotificationDestination = {
  kind: string;
  streamId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  actor?: { id: string; username?: string | null } | null;
  subject?: { kind: "post" | "stream" | "room" } | null;
  house?: { conversationId: string } | null;
  /** Which conversation a `message` / `mention` row came from, once the
      service sends it. Optional: absent today. */
  conversation?: { id: string } | null;
};

/**
 * Is the stream this row is about a GIST ROOM rather than a broadcast?
 *
 * Only asked of rows that carry a `streamId` — on anything else the question
 * does not arise, and answering it would be inventing a destination.
 */
export function isGistRoomNotification(item: NotificationDestination): boolean {
  // The service's own classification, and the only one that covers every kind.
  if (item.subject?.kind === "room") return true;
  // A kind that cannot be anything else, for a payload with no `subject` yet.
  if (item.kind === "house_room") return true;
  // Set by the backend on `house_room` rows alone; null everywhere else.
  return item.house != null;
}

export function notificationHref(item: NotificationDestination): string | null {
  // A chat event has no post and no stream, so without this it fell through to
  // the sender's PROFILE — which is not where the message is.
  /*
    ON THE THREAD when the service names one, the inbox when it does not.

    A tap that lands you on the inbox root and leaves you to find the
    conversation yourself has not delivered you to the thing it was about. The
    id is parsed ahead of the backend, so this is the inbox today and the
    thread the day the field ships.

    `chat_request` stays on the inbox deliberately: a request is not yet a
    conversation, and there is no thread to open.
  */
  if (item.kind === "message") {
    return item.conversation?.id
      ? sq(`/messages/${encodeURIComponent(item.conversation.id)}`)
      : sq("/messages");
  }
  if (item.kind === "chat_request") return sq("/messages");

  /*
    A MENTION INSIDE A GROUP CHAT IS A CHAT EVENT TOO.

    `mention` is written from four places — a post, a comment, a stream, and a
    GROUP MESSAGE (`conversation-service.ts`, the fan-out beside the `message`
    one). Only the first three carry a `postId` or a `streamId`, so a group
    mention fell all the way through to `profileHref(actor)` and landed the
    reader on the profile of the person who named them — which is the exact
    bug the comment above describes for `message`, one kind further down the
    same function. It was fixed there and left here.

    Placed BEFORE the post and stream branches on purpose: a row that somehow
    carried both should still open the thread it names, because that is the
    specific place rather than the general one.
  */
  if (item.kind === "mention" && item.conversation?.id) {
    return sq(`/messages/${encodeURIComponent(item.conversation.id)}`);
  }

  // A gist room and a broadcast are both streams. See the header.
  if (item.streamId) {
    // `housePath` and `profileHref` already return /square paths; `sq` is idempotent.
    return isGistRoomNotification(item) ? housePath(item.streamId) : sq(`/live/${item.streamId}`);
  }

  // ON the comment when the payload names one: the permalink reads `?comment=`
  // and scrolls to it. Without an id it opens the post, as it always did.
  if (item.postId) {
    return item.commentId
      ? sq(`/p/${item.postId}?comment=${encodeURIComponent(item.commentId)}`)
      : sq(`/p/${item.postId}`);
  }

  if (item.actor) return profileHref(item.actor);
  return null;
}

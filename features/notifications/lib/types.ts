import { z } from "zod";
import { ProfileSchema } from "@/lib/api/schemas";
import { NOTIFICATION_GROUPS } from "@/lib/notification-groups";

// The service's notification kinds. `catch` keeps an unknown future kind from
// failing the whole page — it renders with the neutral glyph instead.
export const NotificationKindSchema = z
  .enum([
    "follow",
    "like",
    "comment",
    // Someone answered a comment of yours (TikTok's "replied to your
    // comment"). Asked of the backend 2026-09-09 together with `commentId`;
    // listed ahead of the service sending it, per the rule above.
    "comment_reply",
    // Named in a post or a comment. `commentId` points at the comment when
    // there is one; a person who is both the thread's author and named in
    // the same reply gets ONE row, the comment_reply — the service dedupes.
    "mention",
    // Somebody liked a comment of yours — to the comment's author only, one
    // row per (actor, comment) that a re-like replaces. Built on the service
    // (PR #199), not on the served spec yet; listed ahead of it, per the
    // rule above, so it never lands as "followed you".
    "comment_like",
    "repost",
    "bookmark",
    "ticket_purchased",
    /**
     * Somebody tipped you.
     *
     * The service has sent this since tipping shipped; this enum did not list
     * it, and `.catch("follow")` turned every one of them into "followed you".
     * A creator who was paid was told they had gained a follower — the wrong
     * event, and the one that matters most to get right.
     */
    "tip_received",
    /**
     * Somebody sent you a gift.
     *
     * LISTED BEFORE THE SERVICE SENDS ONE — the lesson the three notes around
     * this enum keep drawing, applied in advance for once. The kind ships on
     * service #317 and is not deployed yet; without this line every gift would
     * arrive through `.catch("follow")` and tell a creator who had just been
     * PAID that they had gained a follower.
     *
     * Its own kind rather than `tip_received`, which is the service's choice
     * and the right one: a tip is an amount, a gift is an object somebody
     * chose, and they read differently to the person receiving one.
     *
     * Recorded on SETTLEMENT, not on the send — until both legs land nobody
     * has been paid, so a row before that would be a claim the service cannot
     * stand behind.
     */
    "gift_received",
    /**
     * Somebody winked at you — a one-tap signal of interest, addressed to you
     * rather than to something you posted.
     *
     * Listed here BEFORE the service sends one, and that ordering is the
     * point: `.catch("follow")` turns any kind this enum has not heard of into
     * "followed you". That is exactly how `tip_received` shipped as a lie for
     * a while — a creator who had been paid was told they had a new follower.
     * A wink misreported as a follow would be the same bug with worse
     * consequences, because a follow is a public act and a wink is not.
     */
    "wink",
    "stream_live",
    "verification_resolved",
    "role_resolved",
    /**
     * FOUR KINDS THE SERVICE HAS BEEN SENDING ALL ALONG, and this enum did not
     * list — so `.catch("follow")` rendered every one of them as "New
     * Follower · X started following you on Square."
     *
     * This is the third time the same hole has bitten (see `tip_received` and
     * `wink` above), and it was live: the service's enum carries fifteen kinds
     * against our eleven, and the local database holds six `message`, six
     * `speaker_request` and three `group_added` rows right now — every one of
     * them being shown to somebody as a follow that never happened.
     *
     * Verified against the served contract at :8094 rather than guessed. The
     * lesson the two earlier notes drew is the right one and was not applied
     * widely enough: list a kind BEFORE the service sends it, and re-read the
     * enum whenever notifications change.
     */
    "message",
    "chat_request",
    "group_added",
    "speaker_request",
    /**
     * Someone opened a gist room from one of your houses (settings stage 2b).
     * Listed as the service ships it, so it never lands as "followed you".
     * Carries the opener and `streamId`; it does NOT carry the house.
     */
    "house_room",
    /**
     * SOMEBODY PUT YOU ON THE GUEST LIST OF A PRIVATE ROOM.
     *
     * Listed BEFORE the service sends one, which is the rule the four notes
     * above were all written to establish. The service has not shipped this
     * kind yet; when it does, an unlisted kind would arrive through
     * `.catch("follow")` and tell somebody they had a new follower when what
     * actually happened is that they were invited somewhere private. Of all the
     * kinds that has bitten, this would be among the worst — the invitation is
     * the only signal the person gets, and it would be replaced by a different
     * event entirely.
     *
     * It is why this is NOT hypothetical: twice tonight a real person was
     * invited to a private room and learned about it from a WhatsApp message,
     * because nothing in the product told them. A private room is reachable
     * only by its guest list, so an invitation nobody receives is a room nobody
     * can enter.
     *
     * Expected to carry the inviter as the actor and `streamId` for the room.
     * Nothing is rendered for a room that has ended beyond saying so — see the
     * copy — because the invitation does not expire but what you can do about
     * it depends on the room.
     */
    "room_invite",
    /**
     * AN ADMIN IS SHOWING YOUR POST TO EVERYONE (backend, 2026-09-12).
     *
     * Listed before the service sends one, for the reason the three notes above
     * record: unlisted, `.catch("follow")` would tell an author whose post is
     * being broadcast platform-wide that somebody followed them. Of every kind
     * in this enum that is the worst one to get wrong — the author did not
     * choose the placement, and the notification is the only way they find out.
     *
     * It carries NO actor by design. The decision belongs to the platform, not
     * to a named admin the author could argue with; the audit row keeps who did
     * it where it belongs.
     */
    "post_announced",
  ])
  .catch("follow");

export const NotificationSchema = z.object({
  id: z.string(),
  kind: NotificationKindSchema,
  // Hydrated on every read, but a deleted account can leave it null.
  actor: ProfileSchema.nullable().optional().default(null),
  postId: z.string().nullable().optional().default(null),
  /**
   * WHICH CONVERSATION A `message` OR `mention` ROW CAME FROM.
   *
   * PARSED AHEAD OF THE BACKEND, all optional, so the row improves the day the
   * field ships and needs no coordinated release — the same way `members`,
   * `website` and `weeklyRoomLimit` were parsed before the house read carried
   * them.
   *
   * It exists because a group message and a direct message are currently
   * INDISTINGUISHABLE. Both are recorded as `kind: 'message'` carrying only an
   * actor (`conversation-service.ts`, the fan-out after `toNotify`), so "Ada
   * sent you a message" is printed for a room of forty people exactly as it is
   * for a private thread. ogazboiz: "if somebody messaged me on the group
   * aspect it will look as if it's a direct message".
   *
   * `kind` is the part that carries the meaning; `title` is what lets the row
   * NAME the group rather than just say one exists. Unknown kinds `catch` to
   * null rather than guessing "direct" — saying nothing beats saying the
   * wrong one, because "direct" is the claim that nobody else saw it.
   */
  conversation: z
    .object({
      id: z.string(),
      kind: z.enum(["direct", "group"]).nullable().optional().default(null).catch(null),
      title: z.string().nullable().optional().default(null),
    })
    .nullable()
    .optional()
    .default(null)
    .catch(null),
  /**
   * The house a `house_room` row is about — its CURRENT name, so a rename shows
   * on older rows. Null on every other kind, and once the reader has left the
   * house; the row then falls back to naming no house.
   */
  house: z
    .object({ conversationId: z.string(), title: z.string().nullable().optional().default(null) })
    .nullable()
    .optional()
    .default(null)
    .catch(null),
  /**
   * The comment a `comment` or `comment_reply` event is about, so the row can
   * open the permalink ON that comment (`/p/:postId?comment=:id`). Asked of
   * the backend; null until it ships, and null on every other kind.
   */
  commentId: z.string().nullable().optional().default(null),
  streamId: z.string().nullable().optional().default(null),
  /**
   * WHAT THE NOTIFICATION IS ABOUT — the same shape as a tip's `source`, and
   * resolved by the same code upstream so the two can never disagree about
   * what a gist room is (a stream with category 'house', reported as `room`).
   *
   * Two nulls, both real states rather than gaps:
   *  · `subject` null — the row is about a PERSON, not a thing: follow, wink,
   *    message. Render no subject line.
   *  · `title` null — the thing has no words to show, such as a picture-only
   *    post, or a room with no topic set. Same treatment; never fall back to
   *    the id or to "a post".
   *
   * Titles arrive truncated at 140 with an ellipsis already applied, so
   * nothing here clamps again expecting the full text.
   */
  subject: z
    .object({
      kind: z.enum(["post", "stream", "room"]).catch("post"),
      id: z.string().nullable().optional().default(null),
      title: z.string().nullable().optional().default(null),
    })
    .nullable()
    .optional()
    .default(null),
  /**
   * Which bucket this row belongs to, decided by the SERVICE.
   *
   * It exists precisely so the client never re-derives a kind-to-group map — a
   * client-composed mapping silently drops every kind added after it ships,
   * which is the failure we already hit in the other direction when four kinds
   * rendered as follows.
   *
   * ─── SERVED BUT NOT DOCUMENTED. DO NOT DELETE THIS ON THE SPEC'S WORD ─────
   * `subject` and `group` above are both set on every row by the service and
   * are absent from `Notification` in the published `openapi.json`: the backend
   * documented the `group` QUERY PARAMETER and never touched the RESPONSE
   * shape. Confirmed by grepping the compiled build, not by reading the
   * document — and the fix (their PR #190) is open, not merged, because the
   * commit that would have carried it missed #189.
   *
   * So a reader who checks the spec will conclude these two fields do not
   * exist, and anyone regenerating types from it will drop them. They are
   * real. Read them off the row, which is what this schema does. Optional and
   * nullable because the DEPLOYED environment is genuinely behind — required,
   * they would fail to parse production — not because they are speculative.
   */
  group: z.enum(NOTIFICATION_GROUPS).nullable().optional().default(null),
  // Null until the notification has been read.
  readAt: z.string().nullable().optional().default(null),
  createdAt: z.string().optional().default(""),
});

/* The buckets and their labels live in `lib/notification-groups.ts`, which is
   pure so `node --test` can pin them and so Settings' per-group push switches
   read the same list this schema validates against. Re-exported because every
   consumer of a notification imports from here. */
export { NOTIFICATION_GROUPS, type NotificationGroup } from "@/lib/notification-groups";

export const NotificationPageSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().optional().default(0),
  nextCursor: z.string().nullable().optional().default(null),
});

export const ReadResultSchema = z.object({
  unreadCount: z.number().optional().default(0),
});

export type MarketNotification = z.infer<typeof NotificationSchema>;
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

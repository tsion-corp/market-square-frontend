import { z } from "zod";
import { MentionSchema, ProfileSchema } from "@/lib/api/schemas";
import { flattenMessageMedia } from "@/features/messages/lib/message-media";

/** `ConversationMessage` in the served spec. Note it carries NO `sender` — a
    1:1 thread has only one non-viewer sender and the view reads identity from
    the conversation's `peer`. A GROUP thread cannot do that, so it resolves
    `senderId` against the member roster instead; still no `sender` object is
    invented here, because the spec does not send one.

    THE MEDIA FIELDS ARE ALL NULLABLE AND `text` IS NOW NULLABLE TOO. A voice
    note or a photo is a message with no body, so `z.string()` on `text` would
    fail the WHOLE page parse the first time one arrives — one bad message
    blanking a thread rather than one bad bubble. Everything optional with a
    null default is the forward-compatible shape `orgBadge` uses: a backend
    that has not shipped these yet parses exactly as it does today. */
export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string().optional().default(""),
  senderId: z.string().optional().default(""),
  text: z.string().nullable().optional().default(null),
  /**
   * The attachment, as ONE nullable object — which is the shape the service
   * sends and the shape the database enforces: `(media_url IS NULL) =
   * (media_kind IS NULL)`, so a URL without a kind cannot exist.
   *
   * It is flattened onto the message below, because every reader here wants
   * `message.mediaUrl` rather than `message.media?.url`. The flattening is a
   * transform rather than a second set of wire fields on purpose — parsing
   * five independent optional fields is what let a nested payload arrive and
   * default ALL of them to null, which renders as "this message simply has no
   * attachment". No error, no crash, just media that never appears.
   */
  media: z
    .object({
      /**
       * NULL FOR A SNAP, and that is the contract rather than a broken row.
       *
       * The service withholds the url for an unopened view-once message
       * everywhere it is read — a link on a read would be a way to see a snap
       * without spending it. This field was `z.string()` and required, so the
       * first snap sent made `MessageSchema.parse` throw: the service created
       * the message, answered 201, and the composer still said "Couldn't send
       * that message". The url only ever arrives from the open route.
       */
      url: z.string().nullable().optional().default(null),
      /**
       * The signed `download` variant, and when both links stop working.
       *
       * Optional because they are ABSENT on the service as deployed today —
       * this client ships before the service that mints them, deliberately, so
       * that the Save control never disappears in the window between the two
       * deploys. `lib/message-media-link.ts` holds the rule for both shapes.
       */
      downloadUrl: z.string().nullable().optional().default(null),
      urlExpiresAt: z.string().nullable().optional().default(null),
      // `catch` rather than a hard enum: a future fourth kind must degrade to
      // "media we cannot type" (the URL sniff then decides) instead of
      // throwing the message away.
      kind: z
        .enum(["image", "video", "audio", "file"])
        .nullable()
        .optional()
        .default(null)
        .catch(null),
      // Intrinsic pixels, when the service knows them. They set the bubble's
      // aspect ratio so a photo is not letterboxed into a guessed box —
      // absent, the bubble contains rather than crops.
      width: z.number().nullable().optional().default(null),
      height: z.number().nullable().optional().default(null),
      /** Voice-note length. Null means "unknown", which renders no duration
          at all rather than `00:00`. */
      durationSeconds: z.number().nullable().optional().default(null),
      /** Files only: the name to show. The service sanitises it and forces the
          stored object's real extension, so it is display text and never a
          storage key. Null renders as the generic noun, never as an empty row. */
      fileName: z.string().nullable().optional().default(null),
      /** Files only: the size to show beside the name. Null renders no size
          rather than `0 KB`, which would be a claim about the file. */
      sizeBytes: z.number().nullable().optional().default(null),
    })
    .nullable()
    .optional()
    .default(null),
  /**
   * Something the message points at — today, a gist room its sender opened.
   *
   * The service writes these; a client cannot attach one. `catch(null)` on the
   * kind for the same reason the media kind has it: a future deep-link kind
   * must degrade to "a link we cannot type" rather than throwing the message
   * away and blanking the thread.
   */
  deepLink: z
    .object({
      kind: z.string().nullable().optional().default(null).catch(null),
      ref: z.string(),
    })
    .nullable()
    .optional()
    .default(null),
  // How many OTHER participants have read this. `readByAll` is the service's
  // own answer to "everyone", which is the only one a group can act on
  // without also knowing the roster size at the moment of sending.
  readBy: z.number().optional().default(0),
  readByAll: z.boolean().optional().default(false),
  /**
   * OPENED, per message and per person — stricter than `readByAll`.
   *
   * `readByAll` is the thread's read watermark: it says the other side has
   * been into the conversation, not that they looked at THIS message.
   * `openedByMe` and `openedByPeer` (direct conversations only) are the
   * service's per-message stamps, and they are what a view-once snap turns on.
   *
   * Both are optional and BOTH DEFAULT TO FALSE ONLY AS A SHAPE, never as an
   * answer: `snapStatus` prefers them when the payload carries them and falls
   * back to the watermark when it does not, so a service that has not shipped
   * them yet still draws a correct row.
   */
  openedByMe: z.boolean().nullable().optional().default(null),
  openedByPeer: z.boolean().nullable().optional().default(null),
  /**
   * A SNAP: sent to be seen once, then destroyed.
   *
   * A read NEVER carries a way to see one — the media object arrives with its
   * kind and its dimensions but NO url, on the thread, in the inbox preview
   * and in the sender's own send response. That is the service being careful
   * rather than the payload being broken: a link on a read would be a way to
   * see a snap without spending it. The one url that exists comes back from
   * the open route, once.
   *
   * `destroyedAt` is set after it has been opened, and the bubble becomes a
   * line of text rather than a picture.
   */
  /**
   * WHICH DOOR THE ATTACHMENT CAME THROUGH — the live camera, or a file the
   * sender already had.
   *
   * TOP LEVEL, not inside `media`, and that is load-bearing: `media` becomes
   * null the moment a snap is destroyed, so a field inside it could not
   * survive the thing it describes. This is a fact about the MESSAGE.
   *
   * A CLAIM, never a proof. The bytes of a photograph do not say which button
   * was pressed, so the service cannot verify it and neither can we. It labels
   * a bubble; nothing is gated on it.
   *
   * Null only for a message that never had an attachment — and for every
   * message sent before the field existed, which is why the mark is drawn only
   * where the payload carries one.
   */
  mediaSource: z.enum(["camera", "upload"]).nullable().optional().default(null).catch(null),
  /**
   * When the author last edited the words, or null.
   *
   * ALWAYS SHOWN where it is set. An edit nobody can see is a way to change
   * what you said after somebody answered it, which is a different feature
   * from fixing a typo and not one we are building.
   */
  editedAt: z.string().nullable().optional().default(null),
  viewOnce: z.boolean().optional().default(false),
  destroyedAt: z.string().nullable().optional().default(null),
  // The spec's enum. `catch` keeps an unknown future state from blanking the
  // thread; a removed message keeps its row but not its body.
  status: z.enum(["active", "removed"]).optional().default("active").catch("active"),
  /**
   * WHO took this message down, when it was not its author.
   *
   * `status` is `removed` for BOTH kinds of removal and this is the only thing
   * that tells them apart:
   *
   *   null  — the author unsent it themselves
   *   an id — a leader moderated it, and the room should be told who
   *
   * Deliberately NOT a fourth `status`: that enum is shared with posts and
   * comments, and a new value would be one that every older client has never
   * seen. So an existing bubble keeps drawing a removed message correctly
   * without reading this at all; reading it is what lets the two be drawn
   * differently.
   *
   * A removal is attributable on purpose. A message that simply vanishes makes
   * a house argue about whether it was ever said.
   */
  moderatedBy: z.string().nullable().optional().default(null).catch(null),
  /**
   * The message this one answers — ONE level, no threading: a reply to a
   * reply points at that message. The service embeds the original's
   * 140-character excerpt and its media kind so the quote draws without a
   * second lookup; `deleted` is always false today (conversation messages
   * cannot be deleted yet) but the shape is the contract's, and a true value
   * renders "Message deleted".
   *
   * Optional with a null default AND `catch(null)`: a service without the
   * field, or a malformed one, draws no quote rather than blanking the thread.
   */
  replyTo: z
    .object({
      id: z.string(),
      senderId: z.string().optional().default(""),
      text: z.string().nullable().optional().default(null),
      media: z
        .object({ kind: z.string().nullable().optional().default(null) })
        .nullable()
        .optional()
        .default(null),
      deleted: z.boolean().optional().default(false),
    })
    .nullable()
    .optional()
    .default(null)
    .catch(null),
  /** Who the sender @-mentioned — the same `Mention` rows a post carries, and
      the same renderer (`PostText`) turns them into links. Empty on a service
      that has not shipped them. */
  mentions: z.array(MentionSchema).optional().default([]).catch([]),
  createdAt: z.string(),
}).transform((message) => ({
  ...message,
  // The flat accessors the pane and its libs read, derived in ONE place and
  // pinned by `lib/messages-message-media.test.ts` — see the note on
  // `flattenMessageMedia` for the bug this shape prevents.
  ...flattenMessageMedia(message.media),
}));

/**
 * A reader's notification levels for ONE house (settings stage 2b). Every
 * member starts at all/all. "leaders_and_friends" is the house's owner and
 * admins, plus anyone the reader follows; "directed" (rooms only) hears no
 * room openings but still gets speaker requests addressed to them.
 */
export const HouseNotificationSettingsSchema = z.object({
  messages: z.enum(["all", "leaders_and_friends", "none"]),
  rooms: z.enum(["all", "leaders_and_friends", "directed", "none"]),
});

export type HouseNotificationSettings = z.infer<typeof HouseNotificationSettingsSchema>;

/** `ConversationSummary` in the served spec, and the object the thread pane is
    handed. `lastMessage` is a full ConversationMessage object, NOT a string —
    declaring it as a string is what made the whole inbox fail to parse. The
    object is deliberate: it lets the row show who sent the preview and when. */
export const ConversationSchema = z.object({
  id: z.string(),
  // `catch` so a third kind arriving from the service reads as a 1:1 thread
  // (which renders correctly with a null peer) rather than failing the page.
  kind: z.enum(["direct", "group"]).optional().default("direct").catch("direct"),
  /** The group's name. Null on a 1:1, where the peer IS the title. */
  title: z.string().nullable().optional().default(null),
  /** The group's picture (migration 037). A 1:1 is pictured by its peer. */
  imageUrl: z.string().nullable().optional().default(null),
  /** What the group is for. Shown on the group's own header, not the row. */
  description: z.string().nullable().optional().default(null),
  /** Direct threads only. */
  peer: ProfileSchema.nullable().optional().default(null),
  /** Groups only, and CAPPED AT FOUR by the service — it is the header's
      preview roster, never the membership. Anything that needs the whole list
      (resolving a sender avatar, the members sheet) reads
      `GET /conversations/:id/members`. */
  members: z.array(ProfileSchema).optional().default([]),
  // NOT defaulted to 0. Absent means "this payload does not count members",
  // which is a different statement from "this group has no members" — and the
  // header renders nothing for the first and would render "0 members" for the
  // second.
  memberCount: z.number().nullable().optional().default(null),
  /**
   * Who created the group. Groups only, null on a 1:1.
   *
   * It decides WHICH overflow menu a thread draws — the owner's (78:8525) or a
   * member's (78:8337). It used to be absent from the summary, so the client
   * had to infer ownership from `role === "owner"` on the roster, which meant
   * the menu could not be right until a second request landed.
   */
  createdBy: z.string().nullable().optional().default(null),
  /**
   * Whether somebody holding this group's link may join it themselves via
   * `POST /conversations/:id/join`. It does NOT mean "listed in a directory" —
   * `GET /conversations/discover` is what lists them, and it lists exactly the
   * public ones. A direct conversation is always private.
   *
   * `canMakeInvite` reads it: any member of a public house may share an invite
   * link, only the owner or an admin of a private one.
   */
  visibility: z.enum(["public", "private"]).optional().default("private").catch("private"),
  /** The reader's own role in a GROUP row. Null on a 1:1, and on a service that predates roles. */
  viewerRole: z.enum(["owner", "admin", "member"]).nullable().optional().default(null).catch(null),
  /**
   * WHO MAY TYPE IN THIS GROUP. `admins` makes it an announcement board.
   *
   * Reading is never affected by it — a member of an admins-only house sees
   * every word and simply cannot add one.
   *
   * Defaults to `everyone`, which is both the service's default and the
   * historic behaviour, so a row from a service that predates the setting
   * describes the group it actually is.
   */
  whoCanPost: z.enum(["everyone", "admins"]).optional().default("everyone").catch("everyone"),
  /**
   * May the reader open a gist room in this house's name?
   *
   * The SERVER's answer to the question the UI asks, rather than a role for the
   * client to re-derive. Only a house's owner and admins may open a room, and a
   * client that worked that out from `viewerRole` would be a second copy of an
   * authorisation rule that lives on the service — which is how the two come to
   * disagree, silently, on the day the rule changes.
   *
   * False by default: offering a control that 403s is worse than not offering
   * it, so a service that does not answer is read as "not allowed".
   */
  canOpenRoom: z.boolean().optional().default(false).catch(false),
  /** The reader's notification levels for a GROUP row. Null on a 1:1, and before stage 2b. */
  notificationSettings: HouseNotificationSettingsSchema.nullable().optional().default(null).catch(null),
  /** Groups only: who wrote `lastMessage`, so the inbox row can prefix it. */
  lastSender: ProfileSchema.nullable().optional().default(null),
  lastMessage: MessageSchema.nullable().optional().default(null),
  lastMessageAt: z.string().nullable().optional().default(null),
  /**
   * The snap streak with this person: consecutive days on which BOTH of them
   * sent a photo or clip marked view-once. Zero on a group, zero once it has
   * lapsed, and never counted from ordinary gallery photos.
   *
   * `snapStreakExpiresAt` is the deadline, and it is NOT today's end: a streak
   * survives a day nobody has snapped in yet, and only breaks once a whole day
   * has passed without both sides.
   */
  snapStreak: z.number().optional().default(0),
  snapStreakExpiresAt: z.string().nullable().optional().default(null),
  /** Group presence, the counterpart of a profile's `lastSeenAt`. */
  lastActiveAt: z.string().nullable().optional().default(null),
  // DELIBERATELY NOT DEFAULTED, for the reason `isFollowing` is not:
  // `undefined` means "this payload does not carry a request state", which is
  // not the same as "accepted". Only an explicit `pending` may gate anything,
  // so a backend that has not shipped requests can never silently lock a
  // thread the reader is already in.
  requestState: z.enum(["pending", "accepted"]).optional().catch(undefined),
  requestedBy: z.string().nullable().optional().default(null),
  /**
   * WHO PUT ME IN THIS HOUSE — a group's counterpart to `requestedBy`, and a
   * whole profile rather than an id so a page of invites is not one profile
   * read per row.
   *
   * It is the question a person actually asks when an invite appears. Which
   * house is on the row already; who added me is the difference between
   * accepting because you recognise the person and accepting because the house
   * looked fine, and it is the only thing that makes a decline an informed one.
   *
   * NULL IS A REAL ANSWER, NOT A GAP: somebody who joined a public house
   * themselves, or any membership older than the consent gate, has no inviter.
   * The row renders without a name in that case.
   *
   * It is never filled in from the house's owner. Whoever adds you is often not
   * whoever made the house, and a confident wrong name is worse than no name.
   */
  invitedBy: ProfileSchema.nullable().optional().default(null),
  /**
   * The house's link and its rooms-per-week cap — both editable by the owner
   * on `PATCH /conversations/:id`, both drawn on the house profile.
   *
   * Carried HERE as well as on the house read because the settings sheet edits
   * a `Conversation` and needs to show what the current values are; a form
   * that cannot read a field can only overwrite it blind.
   *
   * `weeklyRoomLimit` null means UNCAPPED and is a real value, not a missing
   * one — it is how a cap is removed — so null and absent stay distinct all
   * the way down.
   */
  website: z.string().nullable().optional().default(null),
  weeklyRoomLimit: z.number().nullable().optional().default(null),
  unreadCount: z.number().optional().default(0),
});

/** `Conversation` in the served spec — what `POST /conversations` returns. It
    is a DIFFERENT shape from ConversationSummary: participant ids and no peer,
    preview or unread count. They were conflated onto one schema, which parsed
    only because every summary-only field happened to be optional. */
export const ConversationRefSchema = z.object({
  id: z.string(),
  participantA: z.string().optional().default(""),
  participantB: z.string().optional().default(""),
  lastMessageAt: z.string().nullable().optional().default(null),
  createdAt: z.string().optional().default(""),
});
export type ConversationRef = z.infer<typeof ConversationRefSchema>;

/** A row of `GET /conversations/:id/members`. The profile is nullable because
    a member whose account has gone is still a member of the group — dropping
    the row would silently shrink the count the header prints. */
export const ConversationMemberSchema = z.object({
  profile: ProfileSchema.nullable().optional().default(null),
  // owner | admin | member. An unknown future role reads as a plain member,
  // which offers the fewest controls rather than the most.
  role: z.enum(["owner", "admin", "member"]).optional().default("member").catch("member"),
  joinedAt: z.string().nullable().optional().default(null),
  /**
   * SILENCED IN THIS GROUP — they may still read everything.
   *
   * Defaulted to false rather than left optional: a roster that does not carry
   * the field is a service older than muting, where nobody is muted, and that
   * is a true statement rather than an absence. The danger runs the other way —
   * an UNDEFINED here would render as "not muted" anyway while silently
   * disabling the control that fixes it.
   */
  muted: z.boolean().optional().default(false).catch(false),
  /**
   * MAY THE VIEWER ACT ON THIS PERSON — remove, mute, or moderate their words.
   *
   * The server's answer to the question the menu asks, rather than a ladder for
   * the client to re-derive. The rule is "an admin acts on members, the owner
   * acts on admins, nobody acts on the owner, nobody acts on themselves", and
   * every client that works that out from two `role` values is a second copy of
   * an authorisation rule that lives on the service — which is how the two come
   * to disagree, silently, on the day the rule changes.
   *
   * False on your own row and false throughout a DM, where nobody is a leader.
   *
   * Defaults FALSE: a service that does not answer offers no controls, which is
   * the safe direction. A control that 403s is worse than one that is absent,
   * because the reader cannot tell whether they lack the right or the product
   * is broken.
   */
  canManage: z.boolean().optional().default(false).catch(false),
});

/**
 * SOMEBODY WHO HAS BEEN ASKED AND HAS NOT ANSWERED — a seat, not a membership.
 *
 * A separate row type rather than a flag on a member, because `items` means
 * "people who are in this group" and a lot of code leans on that. A waiting
 * seat mixed in behind a boolean makes every one of those callers correct only
 * if it remembers to check, which is the omission the service's own active-only
 * default exists to prevent — moved up a layer rather than removed.
 */
export const ConversationInviteSchema = z.object({
  profile: ProfileSchema.nullable().optional().default(null),
  /** Who asked them. Any member may invite, so this is not always a leader. */
  invitedBy: ProfileSchema.nullable().optional().default(null),
  invitedAt: z.string().nullable().optional().default(null),
  /**
   * MAY THE VIEWER TAKE THIS INVITATION BACK.
   *
   * Wider than the member ladder on purpose, and the service decides it: true
   * for a leader who could remove them, AND for whoever SENT it whatever their
   * rank. Any member may invite, so without the second case a member who
   * mistyped a name leaves a waiting seat only a leader can clear, and the
   * person wrongly asked stays asked. Undoing your own act is not authority
   * over anybody.
   *
   * It stops at acceptance: once they are in, `canManage` on the MEMBER row
   * governs, and a plain member who invited them cannot remove them.
   */
  canManage: z.boolean().optional().default(false).catch(false),
});

export const ConversationMemberPageSchema = z.object({
  items: z.array(ConversationMemberSchema),
  /**
   * Invitations still waiting, newest first.
   *
   * Defaulted to empty, so a service that does not send it draws no invited
   * rows rather than failing — which is what lets this land before the field
   * ships. These are deliberately NOT in `items` and NOT in `memberCount`: a
   * house with three members and six invitations out is a house of three.
   */
  invited: z.array(ConversationInviteSchema).optional().default([]),
  /** The group's name. Null on a direct conversation, absent on a service
      that has not shipped it — a gist room's header reads this. */
  title: z.string().nullable().optional().default(null),
  /** Newest `lastSeenAt` across the OTHER members — the "Active 3d ago" line. */
  lastActiveAt: z.string().nullable().optional().default(null),
});

export const ConversationPageSchema = z.object({
  items: z.array(ConversationSchema),
  nextCursor: z.string().nullable().optional().default(null),
  // Global across every thread. The nav badge still reads `GET /me/unread`,
  // which answers messages and notifications together in one call.
  totalUnread: z.number().optional().default(0),
  /**
   * Requests awaiting the caller's answer — GLOBAL, not page-scoped, so it is
   * the same number whichever tab asked for it. It badges the Gist Requests
   * tab. Defaulted to 0 rather than left undefined because a count is a count;
   * a backend that does not send one has none to show.
   */
  pendingRequests: z.number().optional().default(0),
});

// Newest-first, like the service returns it.
export const MessagePageSchema = z.object({
  items: z.array(MessageSchema),
  nextCursor: z.string().nullable().optional().default(null),
});

export const ReadResultSchema = z.object({
  unreadCount: z.number().optional().default(0),
});

/**
 * `Conversation` as `POST /conversations/groups` answers it.
 *
 * A group carries a `title` and no participant pair, which is the mirror of
 * `ConversationRefSchema` — kept separate rather than widened into it, because
 * one schema that is optional in both directions would parse a malformed
 * response of either shape.
 */
/** `POST /conversations/:id/invites` — a house invite. The link is ours: `/join/<token>`. */
export const InviteSchema = z.object({
  token: z.string(),
  conversationId: z.string(),
  expiresAt: z.string().nullable().optional().default(null),
  maxUses: z.number().nullable().optional().default(null),
  useCount: z.number().optional().default(0),
});

/**
 * `GET /invites/:token` — what a link opens onto, for members, strangers and
 * signed-out visitors alike. `canJoin` is for THIS link and THIS viewer, and is
 * false for anybody signed out. An expired or used-up link still answers, with
 * `valid: false` and the reason.
 */
export const InvitePreviewSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional().default(null),
  description: z.string().nullable().optional().default(null),
  imageUrl: z.string().nullable().optional().default(null),
  memberCount: z.number().nullable().optional().default(null),
  visibility: z.enum(["public", "private"]).optional().default("private").catch("private"),
  viewerIsMember: z.boolean().optional().default(false),
  canJoin: z.boolean().optional().default(false),
  valid: z.boolean(),
  reason: z.enum(["expired", "used_up"]).nullable().optional().default(null).catch(null),
  expiresAt: z.string().nullable().optional().default(null),
});

export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

/**
 * WHAT OPENING A SNAP ANSWERS — the only place a snap's url ever exists.
 *
 * `media` is null on every call after the first, which is how a retry says
 * "already spent" without being an error. `url` here is a DIRECT storage link
 * with minutes on it, not a `/media/messages/...` one: the message has let go
 * of the file, and the service deletes it a few minutes later.
 */
export const SnapOpenSchema = z.object({
  openedAt: z.string().nullable().optional().default(null),
  destroyed: z.boolean().optional().default(true),
  /**
   * The instant the file is DELETED — `openedAt` plus the service's hold, five
   * minutes today. Not a link expiry: there is nothing behind it afterwards,
   * which is why the viewer closes at zero rather than offering a retry.
   *
   * Null on a second open, and null on an ordinary message, whose attachment
   * is not being deleted at all.
   */
  mediaExpiresAt: z.string().nullable().optional().default(null),
  media: z
    .object({
      url: z.string(),
      kind: z.enum(["image", "video"]).nullable().optional().default(null).catch(null),
      width: z.number().nullable().optional().default(null),
      height: z.number().nullable().optional().default(null),
    })
    .nullable()
    .optional()
    .default(null),
});

export type SnapOpen = z.infer<typeof SnapOpenSchema>;

export const GroupRefSchema = z.object({
  id: z.string(),
  kind: z.enum(["direct", "group"]).optional().default("group").catch("group"),
  title: z.string().nullable().optional().default(null),
  createdBy: z.string().nullable().optional().default(null),
  lastMessageAt: z.string().nullable().optional().default(null),
  createdAt: z.string().optional().default(""),
});

/** The composer's outgoing shape lives with the pure builder that validates
    it — re-exported here so callers keep a single import site for the slice's
    types. */
export type { OutgoingMessage } from "@/features/messages/lib/outgoing";

export type Conversation = z.infer<typeof ConversationSchema>;
export type Message = z.infer<typeof MessageSchema>;
/** The quoted original on a reply, as the service embeds it. */
export type MessageReplyTo = NonNullable<Message["replyTo"]>;
export type ConversationMember = z.infer<typeof ConversationMemberSchema>;

/** The service caps a message body at 2000 characters. */
export const MESSAGE_MAX = 2000;

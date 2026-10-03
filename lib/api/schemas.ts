import { z } from "zod";
import { STORY_BACKGROUNDS, STORY_FONTS } from "../story-style.ts";
import { accountIdTail } from "../account-id.ts";

// Shapes shared across slices, mirroring the backend contract
// (GET /v1/market-square/openapi.json). A profile appears as a post author, a
// stream owner and a spotlight row, so its schema is cross-cutting.
//
// The backend allows null username/displayName/bio (a profile exists the
// moment Privy mints a DID); the transform normalizes those to render-safe
// strings once, at the boundary, so components never branch on null.

export const DeepLinkSchema = z.object({
  kind: z.string(),
  ref: z.string(),
});

// Backend roles: citizen | creator | ambassador | worldstreet.
const RoleSchema = z.enum(["citizen", "creator", "ambassador", "worldstreet"]).catch("citizen");
/**
 * Verification lifecycle.
 *
 * The platform GRANTS verification — nobody applies for it or buys in. Once
 * granted it is kept current by a recurring KASH payment; letting that lapse
 * pauses the badge without touching the underlying grant, so paying restores
 * it instantly with no re-approval.
 *
 * The silver check renders on `verified` ONLY. `lapsed` is a verified account
 * whose payment has run out, and it must not carry the check anywhere.
 */
const VerificationSchema = z.enum(["none", "pending", "verified", "lapsed"]).catch("none");
// The organisation badge is assigned admin-only and is NOT derived from role —
// product decides who carries one, so the two are independent signals that can
// appear together. `catch(null)` keeps an unknown future value from failing the
// parse, and the default keeps a backend without the field parsing cleanly.
const OrgBadgeSchema = z.enum(["market", "ark"]).nullable().catch(null);

/**
 * ONE @-MENTION, resolved. Declared here because the PROFILE now carries them
 * too — a bio's mentions are the same rows a post's are, and the same
 * `PostText` draws all of them.
 */
export const MentionSchema = z.object({
  type: z.enum(["profile", "group"]),
  id: z.string(),
  label: z.string(),
  handle: z.string(),
});

const RawProfileSchema = z.object({
  id: z.string(),
  username: z.string().nullable().optional().default(null),
  /**
   * THE HANDLE THE SERVICE MINTED, for somebody who never chose one.
   *
   * `user_` + eight characters of the room-code alphabet (no vowels, none of
   * 0/O/1/l/I), e.g. `user_kmvvbmrf`, and it is a REAL ADDRESS:
   * `/profiles/user_kmvvbmrf` resolves, and so does everything under it.
   *
   * IT IS A SECOND COLUMN, NOT A FILLED-IN `username`, and that is what keeps
   * `usernameUnclaimed` honest below — a minted handle is something the person
   * was given, not something they chose, so the claim screen must still ask.
   *
   * NULL ON A CLAIMED PROFILE. The backfill was scoped to `username IS NULL`
   * exactly (ogazboiz: "excluding those that have claim username"), so anyone
   * who had already chosen a handle has this null and keeps theirs.
   *
   * Optional as well as nullable because the mint is not deployed everywhere
   * yet: an older service omits the key entirely and must still parse.
   */
  generatedUsername: z.string().nullable().optional().default(null),
  displayName: z.string().nullable().optional().default(null),
  bio: z.string().nullable().optional().default(null),
  /**
   * WHO THE BIO @-MENTIONS — the same `Mention` rows a post and a DM carry,
   * drawn by the same `PostText`.
   *
   * A row rather than handles parsed out of the text, for the reason posts
   * have one: the handle in a stored bio is a SNAPSHOT and the person behind
   * it is not. A bio outlives a rename by months, so a regex-linkified
   * mention points at nobody the first time somebody changes their handle.
   */
  bioMentions: z.array(MentionSchema).optional().default([]).catch([]),
  avatarUrl: z.string().nullable().optional().default(null),
  /**
   * The cover photograph behind the profile header — node 435:27500.
   *
   * Optional and nullable because the two environments disagree today: it is
   * on `PublicProfile` at `:8094` and NOT on the deployed spec, so a client
   * that required it would fail to parse every profile in production. When it
   * is absent the cover falls back to the seeded artwork, which is what
   * shipped before the field existed.
   */
  coverUrl: z.string().nullable().optional().default(null),
  /**
   * THE 2D CHARACTER THAT STANDS ON THE COVER — its ArkPlay share code.
   *
   * Opaque by contract: the service stores the characters and has no opinion
   * about them, so the encoding can change here without a migration. Not a
   * URL, never fetched, never rendered as a source — which is what makes it
   * safe to hold something the cover field could not (see
   * lib/profile-backgrounds.ts for why `coverUrl` cannot carry it).
   *
   * Optional and nullable on the same grounds as `coverUrl` above: it is on
   * `OwnProfile` in the service's repo and NOT yet on the deployed spec, so a
   * client that required it would fail to parse every profile in production.
   * Absent means the person has no character and wears the shared mascot.
   */
  avatarConfig: z.string().nullable().optional().default(null),
  /**
   * THE LINK ROW — node 545:47631 draws `akar-icons:link-chain` and a URL at
   * 15/20 under the place. LIVE on `PublicProfile` and `PATCH /me` at :8080
   * (null clears, absent leaves alone; the service accepts http(s) only).
   * Optional with a null default because the deployed spec lags :8080, as
   * `coverUrl` did. Rendered as an anchor only when it is an http(s) URL — the
   * client re-checks rather than trusting the write-side rule, because a
   * public page must never carry a `javascript:` href.
   */
  website: z.string().nullable().optional().default(null),
  role: RoleSchema,
  verification: VerificationSchema,
  orgBadge: OrgBadgeSchema.optional().default(null),
  /**
   * The operator-set seat at the head of the people directory (rank 1 leads;
   * null = not featured) — see lib/featured-rank.ts. Optional with a null
   * default, the forward-compatible shape `orgBadge` uses. Presentation reads
   * nothing from it: a featured card is an ordinary card, the ORDER is the
   * feature, and the admin panel is the one place it is shown and set.
   */
  featuredRank: z.number().int().nullable().optional().default(null),
  // Set by the service on GET /me for operator accounts. Presentation only —
  // every /admin route is enforced server-side, so hiding the UI is a courtesy
  // to non-admins, never the access control.
  isAdmin: z.boolean().optional().default(false),
  /**
   * HAS THE VIEWER AN ACTIVE WINK AT THIS PERSON — asked of the backend for
   * the "now friends" popup (647:16628), which must tell a wink-back from a
   * first wink. Optional WITHOUT a default: undefined means the payload does
   * not carry it, which is not "no" — the same rule as `isFollowing`. Until
   * the field ships, every wink reads as a first wink and offers "Wink back",
   * which is the honest fallback (the service refuses a duplicate).
   */
  winkedByMe: z.boolean().optional(),
  /** THIS PERSON has an active wink at the viewer. Same rules: omitted is unknown. */
  winkedMe: z.boolean().optional(),
  followerCount: z.number().optional().default(0),
  followingCount: z.number().optional().default(0),
  // Deliberately NOT defaulted. `undefined` means "this payload does not
  // carry the follow edge" — which is different from "you do not follow
  // them", and today `GET /spotlight` omits it entirely. Defaulting to false
  // erased that distinction and made every spotlight refetch stamp Follow
  // back over a follow the viewer had just made. Read it through
  // `useIsFollowing` (features/profile/lib/follow-state.ts), never raw, so an
  // absent field falls back to the session's own intent instead of a lie.
  isFollowing: z.boolean().optional(),
  isBlocked: z.boolean().optional().default(false),
  /**
   * Whether this account has been through onboarding. PRIVATE — it is on
   * `GET /me` and deliberately absent from `PublicProfile`, because whether
   * somebody finished a product tour is nobody else's business.
   *
   * Defaulted TRUE, and the direction matters: absent means a payload that does
   * not carry the field, and the safe reading of that is "do not take over
   * somebody's screen". A missing field must never produce an onboarding flow.
   */
  hasOnboarded: z.boolean().optional().default(true),
  /*
    Self-declared place and gender — Explore's people filters.

    ON THE CONTRACT NOW, AND THE ENVIRONMENTS DISAGREE. `PublicProfile` carries
    city, region and gender at :8094, and does NOT on the deployed spec at
    api.tsionark.com — the PR that added them merged to staging while
    production deploys from main. So these stay optional with a null default:
    required, they would fail to parse every profile in production. That is the
    same forward-compatible shape `orgBadge` uses, and it is not a claim about
    which environment you are talking to.

    THE SHAPE IS THE SAFETY DECISION, and it is deliberate. City and region are
    STRINGS a person typed about themselves. There is no `latitude`, no
    `longitude`, no `distanceKm`, and there must never be one: a place somebody
    named is a fact they chose to publish, while a distance to a stranger is
    their position, recomputed every time you look. If a backend ever starts
    sending coordinates, this schema drops them on the floor — which is the
    correct outcome and the reason the fields are enumerated rather than passed
    through.
  */
  city: z.string().nullable().optional().default(null),
  region: z.string().nullable().optional().default(null),
  /*
    COUNTRY AND CONTINENT (settings stage 3). `country` is an ISO 3166-1
    alpha-2 code; `continent` is derived from it by the service. What another
    reader gets is the OWNER's choice (`locationPrecision`): the service nulls
    the hidden halves, and a continent-only profile carries just the continent.
    The owner's own reads always carry everything.
  */
  country: z.string().nullable().optional().default(null),
  continent: z.enum(["AF", "AN", "AS", "EU", "NA", "OC", "SA"]).nullable().optional().default(null).catch(null),
  /** Own profile only (`GET /me`). */
  locationPrecision: z
    .enum(["city_region_country", "region_country", "country", "continent"])
    .nullable()
    .optional()
    .default(null)
    .catch(null),
  gender: z.string().nullable().optional().default(null),
  /*
    When this person was last seen, for the chat thread's "Active 20m ago".

    NULL IS A REAL ANSWER AND MUST STAY ONE. Presence is the field most often
    absent — a `ProfileSummary` embedded in a conversation may carry it while
    the same person's `PublicProfile` does not, and an account can legitimately
    have never been seen. `lastActiveLabel` returns null for a null, and the
    thread header then renders the handle alone rather than "Active recently",
    which would be a claim nobody made.
  */
  lastSeenAt: z.string().nullable().optional().default(null),
  /**
   * THE POST THIS PERSON PUT AT THE TOP OF THEIR OWN PAGE.
   *
   * `GET /profiles/:username` only — never on a summary, a directory row or
   * any list, because hydrating it costs a post lookup nothing else needs.
   *
   * THE KEY IS ABSENT, NOT NULL, whenever it cannot be shown: the post was
   * deleted, moderation removed it, it was a story and expired, or there is a
   * block between the author and this reader in either direction. So this is
   * `.optional()` with NO default — check presence, never truthiness — and
   * nothing here invents a placeholder.
   *
   * That is deliberately the opposite of `quotedPost`, which reports
   * `unavailable: true`: a quote is part of a post somebody wrote, so hiding it
   * would edit their words, while a profile announcing "this post is
   * unavailable" to every visitor publishes that something was taken down.
   */
  pinnedPost: z
    .object({
      id: z.string(),
      text: z.string().nullable().optional().default(null),
      mediaUrl: z.string().nullable().optional().default(null),
      mediaKind: z.string().nullable().optional().default(null),
      thumbnailUrl: z.string().nullable().optional().default(null),
      createdAt: z.string().optional().default(""),
    })
    .optional(),
});

// "Member ·A1B2" beats "Someone": derived from the tail of the account id (a
// Privy DID or a Decane UUID) so two unnamed members are still distinguishable.
function placeholderName(id: string): string {
  const tail = accountIdTail(id);
  return tail ? `Member ·${tail}` : "New member";
}

export const ProfileSchema = RawProfileSchema.transform((p) => ({
  ...p,
  // True when the backend has no CHOSEN username yet. A minted
  // `generatedUsername` deliberately does not clear this: it is an address the
  // service handed out, not a name this person picked, so the claim screen
  // still asks. That is why the mint landed as a second column.
  usernameUnclaimed: p.username === null,
  /*
    WHAT EVERY LINK AND EVERY @HANDLE IS BUILT FROM, in order of how much the
    person had to do with it: the one they chose, then the one they were given,
    and only then the id.

    THE ID STAYS AS A LAST RESORT, against the backend's advice to drop it now
    that the mint exists. Their argument is that a profile has one or the other
    by construction, so the third branch is dead — and they are right about the
    invariant. But the branch is not free to remove: `username` is a ROUTING
    key, so if the pair were ever both null the links would become `/u/null`
    and that person's entire profile would be unreachable, while the id keeps
    resolving because the service accepts one wherever it accepts a username.
    A dead branch that costs nothing beats a dead profile.

    It is also NOT deployed-everywhere yet: until the mint ships to production
    `generatedUsername` is absent, and this line is the only reason unclaimed
    profiles still route at all. Nothing here paper over a bug — `atHandle`
    refuses to PRINT an id, so the id-shaped case shows a name and no handle
    rather than quietly passing a DID off as somebody's @.
  */
  username: p.username ?? p.generatedUsername ?? p.id,
  /*
    A CHOSEN username stands in for a missing name; a MINTED one does not.
    "user_kmvvbmrf" is an address, and reading it as somebody's name would say
    the machine named them. `placeholderName` gives "Member ·GT4T", and with
    the minted handle showing underneath as `@user_kmvvbmrf` that reads the way
    every social app reads: a person who has a handle and no display name yet.
  */
  displayName: p.displayName ?? p.username ?? placeholderName(p.id),
  bio: p.bio ?? "",
}));

// PublicProfile and ProfileSummary both parse through ProfileSchema — the
// summary simply carries zero counts.
export type Profile = z.infer<typeof ProfileSchema>;
export type DeepLink = z.infer<typeof DeepLinkSchema>;
export type ProfileRole = z.infer<typeof RoleSchema>;
export type VerificationState = z.infer<typeof VerificationSchema>;
export type OrgBadge = z.infer<typeof OrgBadgeSchema>;

/**
 * Tickets and streams.
 *
 * These live here rather than in the streams slice because Explore renders
 * stream cards too, and slices never import each other. A type-only import
 * across that boundary is harmless at runtime, but keeping the shapes here
 * removes the temptation for someone to later add a VALUE import along the
 * same path. `StreamSchema` needs `TicketSchema`, so both moved together.
 */
export const TicketSchema = z.object({
  id: z.string(),
  streamId: z.string().optional().default(""),
  buyerId: z.string().optional().default(""),
  railRef: z.string().nullable().optional().default(null),
  tier: z.enum(["standard", "vip"]).catch("standard"),
  priceKash: z.string(),
  currency: z.string().optional().default("KASH"),
  status: z.enum(["pending", "confirmed", "failed", "refunded"]).catch("confirmed"),
  createdAt: z.string().optional().default(""),
  confirmedAt: z.string().nullable().optional().default(null),
  /**
   * The transfer the buyer signed, once reported. Null until then, and null
   * forever on a ticket the rail settled server-side.
   */
  txHash: z.string().nullable().optional().default(null),
  /**
   * Where to send the money, on a deployment the BUYER settles.
   *
   * Present only when the service cannot move the money itself. Its presence
   * IS the instruction: a ticket that comes back carrying a wallet is not paid
   * for yet, and the buyer's own signature is what completes it.
   */
  toWallet: z.string().nullable().optional().default(null),
});

export const StreamSchema = z.object({
  /**
   * Has THIS reader asked to be told when the room opens?
   *
   * Deliberately `.optional()` with NO default, unlike `likedByMe` and
   * `bookmarkedByMe` beside it. The service sends it for a signed-in caller and
   * OMITS it entirely for a signed-out one, because "you have not asked" and
   * "there is nobody to have asked" are different facts. Defaulting it to
   * `false` would collapse them and render a Remind me button that lies on
   * arrival to every signed-out reader.
   */
  remindedByMe: z.boolean().optional(),
  /**
   * THE SPOKEN CODE for a gist room — nine lower-case characters, no
   * separators (`bcdfghjkm`). Grouping for display is ours.
   *
   * NULL is ordinary and is rendered as simply no code: a broadcast is never
   * given one (nobody joins a broadcast by reading a code aloud), and neither
   * is a room made before codes shipped. A room works by link without one, so
   * a null is never an error state.
   */
  roomCode: z.string().nullable().optional().default(null),
  id: z.string(),
  ownerId: z.string(),
  owner: ProfileSchema.nullable().optional().default(null),
  /**
   * WHO IS IN THE ROOM — a sample of up to three people currently connected,
   * host first, then the most recent joiners. GIST ROOMS ONLY, by the
   * backend's own privacy call: on a room you join, being seen is the point;
   * on a broadcast, the same field would publish who is WATCHING by name and
   * face to everyone, and nobody watching has been told they are visible.
   * Broadcasts carry no field at all.
   *
   * Two things a reader must not do with it: derive "and N others" from
   * `viewerCount` minus its length (presence counts SESSIONS, and a signed-out
   * viewer has no profile to resolve, so the sample is routinely shorter than
   * the count while a room is busy), and treat an empty array as "nobody is
   * here" (it can also mean nobody RESOLVABLE is here). Defaulted to empty so
   * a payload without it and a room without a resolvable soul render alike.
   */
  participants: z.array(ProfileSchema).optional().default([]),
  title: z.string(),
  description: z.string().nullable().optional().default(null),
  category: z.string().optional().default("other"),
  /**
   * Shared-vocabulary topic keys, as chosen in the composer. The service has
   * always returned them; the schema simply never modelled them, so the gist
   * room's invite card had no way to draw the topic chips node 225:3887 puts
   * on it. Defaulted to empty rather than optional — "no topics" and "this
   * payload does not carry topics" render identically here, and an array is
   * the shape every reader wants.
   */
  topics: z.array(z.string()).optional().default([]),
  /**
   * WHERE THIS ROOM BELONGS, and who may see it (migrations 039/041).
   *
   * `houseConversationId` is the house GROUP a gist room was opened from; it
   * feeds the room's own header ("Hacker House Maestros '26"), its partner
   * count and its House Members grid — all three read the same group. Null for
   * a room opened from the street, which belongs to no house.
   *
   * All optional with a default, the forward-compatible shape `orgBadge` uses:
   * a backend that has not shipped them parses exactly as it does today.
   */
  /*
    FAIL CLOSED. A missing or unrecognised audience is "unknown", never
    "public": every reader that names a room on a shared surface (the lock
    screen, the rejoin chip, the room code) asks for "public" explicitly, and
    defaulting to it put a room's topic and host on the lock screen whenever
    the field went missing or grew a new value.
  */
  audience: z.enum(["public", "private", "unknown"]).optional().default("unknown").catch("unknown"),
  houseConversationId: z.string().nullable().optional().default(null),
  /**
   * THE HOUSE GROUP THIS ROOM BELONGS TO, inline on the room.
   *
   * The room used to carry only `houseConversationId`, so naming the house
   * meant reading the CONVERSATION — which is membership-gated. The header
   * therefore worked only for people already inside, and "Join House" had
   * nothing to name for exactly the person it is aimed at.
   *
   * `viewerIsMember` is the whole decision: draw Join House or do not. It is
   * `false` for a signed-out reader too, so there is no third state to handle.
   * `visibility` decides whether joining is even possible —
   * `POST /conversations/:id/join` succeeds on a public group and refuses a
   * private one, so a private house shows the name without the invitation.
   *
   * A DOORPLATE, not a conversation: no roster, no messages, no last activity.
   * `GET /streams/:id` only — never on a list card, so nothing may build a grid
   * that expects it. Null when the room has no house, and null (not a 404) when
   * the house has been deleted.
   */
  house: z
    .object({
      id: z.string(),
      title: z.string().nullable().optional().default(null),
      imageUrl: z.string().nullable().optional().default(null),
      memberCount: z.number().nullable().optional().default(null),
      visibility: z.enum(["public", "private"]).optional().default("private").catch("private"),
      viewerIsMember: z.boolean().optional().default(false),
    })
    .nullable()
    .optional()
    .default(null),
  chatAccess: z.enum(["open", "followers"]).optional().default("open").catch("open"),
  // Ark broadcasts a casino game to Market Square as a stream, and carries the
  // way back into Ark here: { kind: "game", ref: "<game>:<id>" }. The service
  // has always sent this field; the schema dropped it, so the link never
  // reached the UI and those streams were dead ends.
  deepLink: DeepLinkSchema.nullable().optional().default(null),
  status: z.enum(["scheduled", "live", "ended", "cancelled"]).catch("scheduled"),
  visibility: z.enum(["public", "ticketed"]).catch("public"),
  ticketPriceKash: z.string().nullable().optional().default(null),
  vipPriceKash: z.string().nullable().optional().default(null),
  vipEarlyAccessMinutes: z.number().nullable().optional().default(null),
  thumbnailUrl: z.string().nullable().optional().default(null),
  scheduledAt: z.string().nullable().optional().default(null),
  startedAt: z.string().nullable().optional().default(null),
  endedAt: z.string().nullable().optional().default(null),
  replayUrl: z.string().nullable().optional().default(null),
  refundPolicy: z.string().optional().default("Refunds are available when the host cancels before the stream begins."),
  replayPolicy: z.string().optional().default("Replay access follows the entitlement shown on your ticket."),
  peakViewers: z.number().optional().default(0),
  totalViewSeconds: z.number().optional().default(0),
  createdAt: z.string().optional().default(""),
  // StreamDetail addition, ABSENT on list rows — hence nullable, not 0.
  // Defaulting to 0 made "no live count available" indistinguishable from
  // "nobody is watching", and a discovery grid rendering a confident 0 (or
  // worse, a historical peak) is stating something untrue.
  viewerCount: z.number().nullable().optional().default(null),
  /**
   * HOW MANY DISTINCT PEOPLE CAME AT ALL — the number "428 joined" claims.
   *
   * NO DEFAULT, and that is the whole design of the field. It is carried on the
   * single-room read of an ENDED room and nowhere else: absent while the room is
   * live (`viewerCount` is the honest field while it is still moving), and
   * absent on list rows, where a count per card is the query that read exists to
   * avoid. Default it to 0 and every one of those absences renders as "0 joined"
   * — a room nobody came to — which is a lie told confidently on the two
   * surfaces where the number is merely unavailable.
   *
   * It is NOT `peakViewers`. Peak is the most people in the room at once;
   * joined is how many came at all. Fifty people passing through in ones and
   * twos peaks at three. They are different questions, and the card went
   * without this one rather than print peak under its caption.
   */
  joined: z.number().optional(),
  /**
   * UP TO THREE FACES FROM AN ENDED ROOM — speakers first, then listeners.
   *
   * ONE ORDERED LIST, not two fields: a reader recognises somebody who held
   * the floor, so speakers take the places and listeners fill what is left.
   * Padding it with people who merely belong to the house was considered and
   * dropped — a face here reads as "this person was in the room", and
   * somebody who was not there would make the card state something false on
   * every quiet room, quietly, for ever.
   *
   * `attendees.length` IS NOT THE ATTENDANCE. It is capped at three, and an
   * anonymous session resolves to no profile and can never be a face. `joined`
   * is the count; this is a sample of it. The "+N" therefore subtracts the
   * faces actually DRAWN from `joined`, never the array's length from anything.
   *
   * Absent while a room is LIVE, and absent for a private or ticketed room —
   * the same gate the chat signal uses, because publishing who attended a room
   * outsiders could not enter reveals something they could not already see.
   */
  attendees: z.array(ProfileSchema).optional().default([]),
  /**
   * WHO MAY ACT FOR THE HOST IN THIS ROOM — up to three, and the room's own
   * appointment rather than the house's. A moderator here is not a house
   * admin: the role ends with the room, which is the whole point of putting
   * it on the stream.
   *
   * NO DEFAULT, deliberately, and it is the feature switch. `undefined` means
   * "this service does not carry moderators" and every control stays hidden;
   * `[]` means "it does and there are none", which is a different sentence and
   * draws an empty sheet rather than nothing. Defaulting to `[]` would merge
   * the two and put a dead button in the dock of every room on a service that
   * has never heard of the route.
   *
   * SINGLE-ROOM READ ONLY — never on a list page, so nothing may build a grid
   * that expects it.
   */
  moderatorIds: z.array(z.string()).optional(),
  // Aggregate live reactions. Optional until all gateway deployments expose it.
  likeCount: z.number().optional().default(0),
  pulse: z.object({
    bullish: z.number().optional().default(0),
    neutral: z.number().optional().default(0),
    bearish: z.number().optional().default(0),
  }).optional().default({ bullish: 0, neutral: 0, bearish: 0 }),
  myTicket: TicketSchema.nullable().optional().default(null),
});

export type Ticket = z.infer<typeof TicketSchema>;
export type Stream = z.infer<typeof StreamSchema>;

/**
 * `SpeakerRequest` in the served spec.
 *
 * Three fields were wrong at once and each broke something different:
 * `requestedAt` does not exist (it is `createdAt`), so every request-to-join
 * threw; the status enum was missing `denied`/`withdrawn` with no `.catch()`,
 * so those two states threw as well; and the hydrated profile arrives as
 * `profile`, not `user`, so the host's queue rendered "Viewer" for everyone.
 *
 * `joinUrl` / `joinToken` / `expiresAt` ARE in the spec, but only while the
 * request is approved — the service omits them in every other state, which is
 * what makes the publish gate in guest-speaker-control safe. They stay
 * optional here for exactly that reason, not because they are absent.
 * `POST /streams/:id/speaker-token` re-mints the pair when it expires;
 * `playback-token` is subscribe-only and cannot be used to broadcast.
 */
export const SpeakerRequestSchema = z.object({
  id: z.string(),
  streamId: z.string().optional().default(""),
  userId: z.string(),
  // The list endpoint hydrates this as `profile` on top of the base schema.
  profile: ProfileSchema.nullable().optional().default(null),
  /*
    `invited` is WIDENED AHEAD OF THE BACKEND (invite to speak). It ships
    first so that the day the service starts emitting it, GET
    /speaker-requests/me still parses on every client already in people's
    browsers. An unknown status is still not carried through: it falls to
    `pending`, exactly as before.
  */
  status: z
    .enum(["pending", "approved", "denied", "withdrawn", "removed", "invited"])
    .catch("pending"),
  /* Who opened the row. Absent on every payload today, which is a listener's ask. */
  initiatedBy: z.enum(["listener", "host"]).catch("listener").optional().default("listener"),
  /*
    When an invitation lapses. Null for a listener's request. The service
    names it `inviteExpiresAt` because `expiresAt` on the same row is already
    the approved speaker's JOIN TOKEN expiry — reading that one as the
    invitation's clock draws a countdown to the wrong moment.
  */
  inviteExpiresAt: z.string().nullable().optional().default(null),
  /* Why an unanswered invitation closed: the host cancelled it, or it ran out. Null otherwise. */
  withdrawnReason: z.enum(["expired", "cancelled"]).nullable().optional().default(null).catch(null),
  /* Why a seated speaker left the stage: the host moved them down, or they were gone past the grace window. */
  removedReason: z.enum(["host", "disconnected"]).nullable().optional().default(null).catch(null),
  /* When the service last saw a seated speaker connected. Coarse (~15 s): not for "Reconnecting…", which reads LiveKit. */
  lastSeenAt: z.string().nullable().optional().default(null),
  /* The approved speaker's join-token expiry (see the note above the schema). */
  expiresAt: z.string().nullable().optional().default(null),
  createdAt: z.string().optional().default(""),
  resolvedAt: z.string().nullable().optional().default(null),
  resolvedBy: z.string().nullable().optional().default(null),
  joinUrl: z.string().nullable().optional().default(null),
  joinToken: z.string().nullable().optional().default(null),
});


/** One picture or clip of a post, in the order the author chose. */
export const PostMediaSchema = z.object({
  url: z.string(),
  kind: z.string().catch("image"),
  width: z.number().nullable().optional().default(null),
  height: z.number().nullable().optional().default(null),
  thumbnailUrl: z.string().nullable().optional().default(null),
});

export type PostMediaItem = z.infer<typeof PostMediaSchema>;

// Backend Post: author id plus a hydrated ProfileSummary on feed items.
// likedByMe comes from the backend on authed reads; the optimistic like
// cache is an overlay on that truth, reconciled on every refetch.
export const PostSchema = z.object({
  /**
   * A TEXT STORY'S BACKGROUND AND FACE, or null for the one every story had
   * before this existed.
   *
   * Returned by the service for weeks and read by nothing, so every story
   * played on one hard-coded gradient whatever its author chose. Both fields
   * are required together when the object is present — it is all-or-nothing —
   * and `.catch(null)` is what keeps a story that somehow carries a background
   * outside the eight from failing the whole post: it plays on the default
   * instead of vanishing from the feed.
   *
   * See `lib/story-style.ts` for the palette, the font tokens and why the
   * typeface each token means is ours to decide.
   */
  storyStyle: z
    .object({
      background: z.enum(STORY_BACKGROUNDS),
      font: z.enum(STORY_FONTS),
    })
    .nullable()
    .optional()
    .default(null)
    .catch(null),
  id: z.string(),
  authorId: z.string().optional().default(""),
  kind: z.enum(["update", "story"]).catch("update"),
  text: z.string(),
  mediaUrl: z.string().nullable().optional().default(null),
  // The backend now types its own media. Renderers prefer this over sniffing
  // the URL's extension; `isVideoPost` falls back to the sniff when absent.
  mediaKind: z.string().nullable().optional().default(null),
  thumbnailUrl: z.string().nullable().optional().default(null),
  /**
   * EVERY picture of the post, in order (node 1029:22591's rail) — `[]` for a
   * text post; `mediaUrl` above mirrors the first. OPTIONAL WITH NO DEFAULT on
   * purpose: a deployment that predates the list sends no key, and that absence
   * is how the composer knows the server takes one picture per post
   * (`lib/media-contract.ts`). Defaulting it to `[]` would erase that answer.
   */
  media: z.array(PostMediaSchema).optional(),
  deepLink: DeepLinkSchema.nullable().optional().default(null),
  storyExpiresAt: z.string().nullable().optional().default(null),
  createdAt: z.string(),
  /**
   * When the author last edited this post. Null means never.
   *
   * Every edit stamps it — there is no quiet window in which a post can change
   * without saying so — which is what makes it safe to render an "edited"
   * marker straight from the field rather than diffing anything.
   */
  editedAt: z.string().nullable().optional().default(null),
  likeCount: z.number(),
  commentCount: z.number(),
  repostCount: z.number().optional().default(0),
  /**
   * Distinct signed-in viewers. OPTIONAL with no default, because a
   * deployment whose service predates views must render nothing rather than a
   * confident "0 views" — "this payload has no view count" and "nobody has
   * watched this" are different claims, and printing the second for the first
   * is a lie the reader cannot detect.
   */
  viewCount: z.number().optional(),
  /**
   * HOW MANY PEOPLE ARKMARKED IT — on the contract beside `viewCount`, and
   * like it a number only: WHO saved a post is nobody's business but theirs
   * (`GET /me/bookmarks` is the reader's own list and there is no route for
   * anyone else's). Optional for the same reason `viewCount` is — a payload
   * without it draws no count, never a fabricated "0".
   */
  bookmarkCount: z.number().optional(),
  repostedByMe: z.boolean().optional().default(false),
  /**
   * Has the AUTHOR pinned this to the top of their own profile?
   *
   * Not viewer state, despite sitting beside `likedByMe`: it is the author's
   * placement and reads the same for everybody, signed out included. It draws
   * the "Pinned" label, and tells the author's own menu to offer Unpin.
   */
  pinnedByAuthor: z.boolean().optional().default(false),
  // The quoted original, hydrated one level deep only — a quote of a quote
  // shows the inner card's text, never a third nested frame. When the original
  // has been removed or expired the backend flags it rather than dropping the
  // field, so the card can say so instead of silently losing context.
  quotedPost: z.object({
    id: z.string(),
    text: z.string().optional().default(""),
    mediaUrl: z.string().nullable().optional().default(null),
    createdAt: z.string().optional().default(""),
    unavailable: z.boolean().optional().default(false),
    author: ProfileSchema.nullable().optional().default(null),
  }).nullable().optional().default(null),
  mentions: z.array(MentionSchema).optional().default([]),
  likedByMe: z.boolean().optional().default(false),
  // Arkmarks. Defaults to false so a backend that has not shipped the field
  // yet parses cleanly — the button reads "not saved" rather than throwing.
  bookmarkedByMe: z.boolean().optional().default(false),
  // Tips received. Both default so a backend without the columns still parses;
  // the card then simply shows no tally, which is honest.
  tipCount: z.number().optional().default(0),
  // Decimal string, KASH — never coerced to a number. Money that round-trips
  // through a float stops matching the ledger it came from.
  tipTotalKash: z.string().optional().default("0"),
  author: ProfileSchema.nullable().optional().default(null),
});

/**
 * What the server says about tipping before we draw the control.
 *
 * `enabled` is false whenever the payment rail cannot move KASH between two
 * users. We hide the button in that case rather than showing one that can only
 * return an error — an affordance that never works is worse than no affordance.
 */
export const TipCapabilitySchema = z.object({
  enabled: z.boolean(),
  /**
   * HOW a tip settles, and therefore what the client must do.
   *
   * `rail` — the service moves the money and the tip is confirmed by the time
   * the call returns. `client-signed` — the kash rail cannot pay a third
   * party (it exposes mint and burn and no transfer, and the platform is
   * non-custodial), so the SENDER signs a KSH transfer themselves and the tip
   * stays pending until the chain is observed.
   *
   * Defaulted to `rail` for a service that predates the field, because that is
   * what those deployments do. Treating an unknown value as client-signed
   * would leave the sender waiting to sign something nobody asked for.
   */
  settlement: z.enum(["rail", "client-signed"]).catch("rail").default("rail"),
  minKash: z.string(),
  maxKash: z.string(),
  verifiedAuthorsOnly: z.boolean(),
  /**
   * THE SAME QUESTION ASKED OF A ROOM, AND IT IS A DIFFERENT ANSWER.
   *
   * `verifiedAuthorsOnly` governs POST tips and stays true: the badge is what
   * stops an impersonation account collecting on a byline the sender has never
   * met. In a GIST ROOM the sender picked a person off a live roster, in a
   * room they are both sitting in, that the host let them into, while that
   * person is speaking — the impersonation the badge defends against barely
   * exists, and the rule's cost is that most of the room can receive nothing.
   *
   * So the service carries two switches, and the client must read the right
   * one per surface. Reading the author flag on a room would grey out people
   * the service will happily pay.
   *
   * NO DEFAULT, and that is the feature switch. `undefined` means "this
   * deployment has ONE switch", so a room must go on obeying
   * `verifiedAuthorsOnly` — which is exactly what production does today and
   * cannot regress anyone. Defaulting it to `false` would silently open room
   * gifting on every service that has never heard of the field.
   */
  verifiedRoomRecipientsOnly: z.boolean().optional(),
  /**
   * WHETHER SENDING A GIFT SPENDS COINS, OR CHARGES KASH AT THE MOMENT OF SENDING.
   *
   * COINS ARE THE INVENTORY — there is no gift stock to hold. ogazboiz:
   * "we are doing it the tiktok way you understand since no inventory". You
   * buy coins, you tap a rose, coins come off and the rose flies. Nobody owns
   * three roses, and there is no shopping step between wanting to send and
   * sending, which is the step TikTok does not have and where senders are lost.
   *
   *   true  — the send debits `priceCoins x quantity` from the coin balance.
   *           One call, confirmed on the way out, no signing and no pending.
   *   false — the sender is charged KASH as they send, signing a transfer and
   *           waiting for the chain, which is what production does today.
   *
   * READ, NEVER INFERRED. The tempting guess — "the coin routes answer, so
   * sending must spend coins" — is wrong and expensive in both directions: a
   * client charging KASH while the service debits coins takes the money twice,
   * and one expecting coins while the service charges KASH shows a balance
   * that never moves.
   *
   * OPTIONAL WITH NO DEFAULT. Absent means a deployment that has never heard
   * of the coin economy, which behaves like `false` without being the same
   * fact. Callers ask `=== true`, so neither can silently open the other.
   */
  spendGiftsFromCoins: z.boolean().optional(),
});

export type TipCapability = z.infer<typeof TipCapabilitySchema>;


export type Post = z.infer<typeof PostSchema>;

export type Mention = z.infer<typeof MentionSchema>;

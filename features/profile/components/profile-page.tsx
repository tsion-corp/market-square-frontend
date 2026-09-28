"use client";

import { PostText } from "@/components/ui/post-text";
import { placeLine } from "@/lib/countries";
import { profileHref } from "@/lib/profile-href";
import { useState } from "react";
import Link from "next/link";
import { IconProfileGlobePin, IconProfileLink } from "@/components/ui/profile-icons";
import { IconMsEdit } from "@/components/ui/design-icons";
import { formatCount, formatDateTime, formatKash } from "@/lib/format";
import { resolveCta } from "@/lib/deeplink";
import { useMe } from "@/hooks/use-me";
import { LiveBadge, Pill } from "@/components/ui/badge";
import { IconCalendar } from "@/components/ui/icons";
import { ProfilePhotos } from "@/features/profile/components/profile-photos";
import { ProfileShareSheet } from "@/components/ui/profile-share-sheet";
import { ProfileCover } from "@/features/profile/components/profile-cover";
import { ProfileActionRow } from "@/features/profile/components/profile-action-row";
import { ColumnHeader, ColumnTabs } from "@/components/layout/column-header";
import { RowSkeleton, Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { MediaTab } from "@/features/profile/components/media-tab";
import type { Post, Profile } from "@/lib/api/schemas";
import {
  useProfile,
  useProfileActivities,
  useProfileBadges,
  useProfilePosts,
  useProfileStreams,
} from "@/features/profile/hooks/use-profile";
import { BadgesPanel, BadgesSection } from "@/features/profile/components/badges";
import { isHttpUrl } from "@/lib/http-url";
import { EditProfileSheet } from "@/features/profile/components/edit-profile-sheet";
import { PersonMoreMenu } from "@/features/profile/components/person-more-menu";
import { WinkButton } from "@/features/profile/components/wink-button";
import { useCanonicalProfileAddress } from "@/features/profile/hooks/use-canonical-profile-address";
import { VerificationCard } from "@/features/profile/components/verification-card";
import {
  AccountTabs,
  type AccountTab,
  type AccountTabDef,
} from "@/features/profile/components/account-tabs";
import { MARKET_FLAGS } from "@/lib/market-config";
import { useMarketView } from "@/lib/analytics";
import { asset, sq } from "@/lib/square-path";

/*
  Media is a tab, not a section inside Posts.

  It is the replacement for the reels, and it only works if it is somewhere a
  person GOES: "if you need to see someone's picture, you have to go to their
  profile, and then you can slide". Buried under a timeline it would be a
  scroll away and nobody would find it.

  Second, not first. A profile answers "who is this" before "what have they
  posted", and Posts carries the words that answer it.
*/
type Tab = "posts" | "media" | "streams" | "activities";

/** The action under an empty profile tab — own profile only. */
/** A profile count and its word — Geist 600 #F7F9F9, then 400 at 50% white. */
function CountLabel({ count, label }: { count: number; label: string }) {
  return (
    <>
      <span className="font-semibold text-[#F7F9F9]">{formatCount(count)}</span>
      <span className="font-normal text-white/50">{label}</span>
    </>
  );
}

function TabCta({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="ws-press inline-flex rounded-full border border-white/20 px-4 py-1.5 text-[13px] font-bold text-body transition-colors hover:bg-white/10"
    >
      {label}
    </Link>
  );
}

function PostsTab({
  username,
  isMe,
  composeSlot,
  postSlot,
  pinned,
}: {
  username: string;
  isMe: boolean;
  /** Composed from outside — profile never imports the feed slice. */
  composeSlot?: React.ReactNode;
  /** The feed slice's post card, composed in by the route. */
  postSlot: (post: Post) => React.ReactNode;
  /**
   * What this person put at the top of their page.
   *
   * A SUMMARY, not a post: id, text, media and a date. It is deliberately not
   * fed to `postSlot`, which needs a whole `Post` — author, counts, the
   * viewer's own like and bookmark state — none of which this carries, and all
   * of which would have to be invented to render one.
   *
   * ABSENT rather than null when it cannot be shown (deleted, moderated, an
   * expired story, or a block either way), so this checks presence and renders
   * nothing at all — never "this post is unavailable", which would publish
   * that something was taken down.
   */
  pinned?: Profile["pinnedPost"];
}) {
  const posts = useProfilePosts(username);
  if (posts.isPending)
    return (
      <>
        {[0, 1, 2].map((i) => (
          <RowSkeleton key={i} />
        ))}
      </>
    );
  if (posts.isError)
    return (
      <div className="p-4">
        <ErrorState
          error={posts.error}
          fallback="Couldn't load posts."
          onRetry={() => posts.refetch()}
        />
      </div>
    );
  if (posts.data.items.length === 0)
    return (
      <div className="p-4">
        <EmptyState
          glyph="◌"
          title={isMe ? "You haven't posted yet" : "No posts yet"}
          body={
            isMe
              ? "Your updates show up here and in your followers' feeds."
              : "When they post, it shows up here."
          }
          // Opens the composer in place when the shell supplies it; the
          // link is the signed-out/unslotted fallback and still works.
          action={
            isMe
              ? (composeSlot ?? (
                  <TabCta href={sq("/?compose=1")} label="Create a post" />
                ))
              : undefined
          }
        />
      </div>
    );
  // The real post card, composed in by the route: the profile slice cannot
  // import the feed slice. This row used to be hand-rolled here, and its heart
  // was a <span> with no handler, so liking a post from somebody's profile did
  // nothing at all. It also dropped the media, the author, the arkmark and the
  // repost, which is why a post read differently here than anywhere else.
  // 1029:22923 — 32 under the tab strip's rule, 32 in from the column, cards 24 apart.
  return (
    <>
      {pinned && <PinnedPost pinned={pinned} />}
      <ul className="flex flex-col gap-6 px-4 pt-8 md:px-8">
        {posts.data.items.map((post) => (
          <li key={post.id}>{postSlot(post)}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * The pinned post, drawn from the summary the profile payload carries.
 *
 * Quiet by design: it is a pointer to the post, not a second post card. The
 * whole thing is the link, so tapping anywhere opens the post where every real
 * control lives.
 */
function PinnedPost({ pinned }: { pinned: NonNullable<Profile["pinnedPost"]> }) {
  return (
    <div className="px-4 pt-8 md:px-8">
      <p className="pb-2 text-[12px] font-semibold text-white/50">Pinned</p>
      <Link
        href={sq(`/p/${pinned.id}`)}
        className="ws-press flex items-center gap-3 rounded-[16px] bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]"
      >
        {pinned.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- media hosts are unknown at build time
          <img
            src={pinned.thumbnailUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-[12px] object-cover"
          />
        )}
        <span className="min-w-0 flex-1">
          {pinned.text ? (
            <span className="line-clamp-2 text-[14px] leading-5 text-white">{pinned.text}</span>
          ) : (
            // A picture-only post has no words. Say what it is rather than
            // printing an empty line or inventing a caption.
            <span className="text-[14px] leading-5 text-white/50">A photo</span>
          )}
        </span>
      </Link>
    </div>
  );
}

function StreamsTab({ username, isMe }: { username: string; isMe: boolean }) {
  const streams = useProfileStreams(username);
  if (streams.isPending)
    return (
      <>
        {[0, 1].map((i) => (
          <RowSkeleton key={i} />
        ))}
      </>
    );
  if (streams.isError)
    return (
      <div className="p-4">
        <ErrorState
          error={streams.error}
          fallback="Couldn't load streams."
          onRetry={() => streams.refetch()}
        />
      </div>
    );
  if (streams.data.items.length === 0)
    return (
      <div className="p-4">
        <EmptyState
          glyph="◉"
          title={isMe ? "You haven't streamed yet" : "No streams yet"}
          body={
            isMe
              ? "Sessions you host show up here once you've gone live."
              : "Sessions they host will show up here."
          }
          action={isMe ? <TabCta href={sq("/studio")} label="Go live" /> : undefined}
        />
      </div>
    );
  return (
    <ul>
      {streams.data.items.map((stream) => (
        <li key={stream.id}>
          <Link
            href={sq(`/live/${stream.id}`)}
            className="ws-row flex items-center gap-3 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-heading">
                {stream.title}
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-[13px] text-meta">
                {stream.status === "live" ? (
                  <LiveBadge className="px-2 py-0 text-[9px]" />
                ) : (
                  <span className="capitalize">{stream.status}</span>
                )}
                {stream.category && <span>· {stream.category}</span>}
                {stream.scheduledAt && (
                  <span>· {formatDateTime(stream.scheduledAt)}</span>
                )}
              </p>
            </div>
            <Pill>
              {stream.ticketPriceKash
                ? formatKash(stream.ticketPriceKash)
                : "Free"}
            </Pill>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ActivitiesTab({
  username,
  isMe,
}: {
  username: string;
  isMe: boolean;
}) {
  const activities = useProfileActivities(username);
  if (activities.isPending)
    return (
      <>
        {[0, 1].map((i) => (
          <RowSkeleton key={i} />
        ))}
      </>
    );
  if (activities.isError)
    return (
      <div className="p-4">
        <ErrorState
          error={activities.error}
          fallback="Couldn't load activities."
          onRetry={() => activities.refetch()}
        />
      </div>
    );
  if (activities.data.items.length === 0)
    return (
      <div className="p-4">
        <EmptyState
          glyph="◇"
          title={isMe ? "Nothing scheduled" : "No activities yet"}
          body={
            isMe
              ? "Schedule a stream or an event and it appears here for your followers."
              : "Scheduled games, streams and events show here."
          }
          action={
            isMe ? <TabCta href={sq("/schedule")} label="Schedule one" /> : undefined
          }
        />
      </div>
    );
  return (
    <ul>
      {activities.data.items.map((activity) => {
        const cta = resolveCta(activity.deepLink);
        return (
          <li
            key={activity.id}
            className="ws-row flex items-center gap-3 px-4 py-3"
          >
            <span className="ws-inset flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-body">
              <IconCalendar className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold text-heading">
                {activity.title}
              </p>
              <p className="text-[13px] text-meta">
                {activity.type} · {formatDateTime(activity.startsAt)}
              </p>
            </div>
            {cta && (
              <Link
                href={cta.href}
                className="shrink-0 text-[13px] font-semibold text-accent hover:underline"
              >
                {cta.label} →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * THE POSTS / MEDIA / STREAMS / ACTIVITIES STRIP IS HIDDEN, NOT DELETED.
 *
 * Node 534:16948 is the whole profile body, and dumping every text node in it
 * turns up no "Posts", "Media", "Streams" or "Activities" anywhere — the only
 * strip the design draws is the account one (Earnings / Badges / Gift Gallery
 * / Replays). So the page matches the file.
 *
 * A CONSTANT RATHER THAN A DELETION, because nothing about the capability
 * changed. All four tabs are backed by live routes — `/profiles/:username/
 * posts`, `/streams`, `/activities` — and every one of them still works; what
 * changed is only whether this page offers them. Deleting the components would
 * turn "the design does not show these" into "somebody has to rebuild these",
 * and those are very different costs. One line puts the strip back.
 *
 * WORTH KNOWING WHILE IT IS OFF: the account strip above is `/me`-only, and so
 * is Houses, so a visitor to somebody else's profile now sees the cover, the
 * bio and the counts and nothing beneath them. Giving a stranger's profile
 * content again means either this strip back on or a design for what replaces
 * it.
 */
const SHOW_CONTENT_TABS = false;

export function ProfilePage({
  username,
  messageSlot,
  kashSlot,
  housesSlot,
  housesOfSlot,
  replaysSlot,
  giftGallerySlot,
  earningsSlot,
  composeSlot,
  postSlot,
  mediaViewerSlot,
}: {
  username: string;
  /** Composed from outside — profile never imports the messages slice. */
  messageSlot?: (profile: Profile) => React.ReactNode;
  /**
   * The Houses rail (534:15577), also the messages slice's — a house IS a group
   * conversation. Own profile only: `GET /me/conversations` is the only route
   * that answers this, and there is none for the houses somebody ELSE belongs
   * to, so a visitor gets no rail rather than an empty one.
   */
  housesSlot?: React.ReactNode;
  /**
   * The rails on somebody ELSE's profile — 545:47653 (their houses) and
   * 545:47746 (their ended gist rooms). Both read other slices, so both arrive
   * as slots; each renders nothing until its route answers.
   */
  housesOfSlot?: (profile: Profile) => React.ReactNode;
  replaysSlot?: (profile: Profile) => React.ReactNode;
  /**
   * The gift gallery — node 492:41810. It counts the viewer's own received
   * tips, so it lives in the tips slice and arrives as a slot; profile and
   * tips never import each other.
   */
  giftGallerySlot?: React.ReactNode;
  /**
   * The earnings panel — nodes 492:46239 (empty) and 492:46539 (populated).
   * It reads the KASH engine and the tips ledger, two slices the profile may
   * not import, so it arrives as a slot like the rest.
   */
  earningsSlot?: React.ReactNode;
  /** The balance chip on the cover (435:27523) — the kash slice's, own profile
   *  only, because there is no route for anybody else's balance and there
   *  should not be. */
  kashSlot?: React.ReactNode;
  /** Composed from outside — profile never imports the feed slice. */
  composeSlot?: React.ReactNode;
  postSlot: (post: Post) => React.ReactNode;
  /**
   * The full-screen swipeable viewer, composed by the route: profile never
   * imports the feed slice, and the viewer lives there.
   */
  mediaViewerSlot: (
    items: Post[],
    openId: string,
    onClose: () => void,
  ) => React.ReactNode;
}) {
  const profile = useProfile(username);
  // Opened by id, or by a name they have since changed: once loaded, the
  // address bar shows who they are now. See useCanonicalProfileAddress.
  useCanonicalProfileAddress(username, profile.data);
  const me = useMe();
  const [tab, setTab] = useState<Tab>("posts");
  /**
   * The ACCOUNT strip's selection, separate from `tab` above — the two strips
   * are different questions and must not share one value. Gift Gallery is the
   * one the file draws active and the only one with a panel behind it.
   */
  const [accountTab, setAccountTab] = useState<AccountTab>("posts");
  const [sharing, setSharing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // The backend has no isMe flag — ownership is the viewer's id matching.
  const isMe = Boolean(
    profile.data && me.data && profile.data.id === me.data.id,
  );
  // Asked once the profile is known; a 404 is "not deployed" and keeps both
  // badge surfaces absent — see `useProfileBadges`.
  const badges = useProfileBadges(username, Boolean(profile.data));
  useMarketView(
    "profile_viewed",
    { surface: "profile", entityType: "profile", entityId: profile.data?.id },
    Boolean(profile.data),
  );

  if (profile.isPending) {
    return (
      <>
        <ColumnHeader title="Profile" back />
        <div className="ws-skeleton h-40 rounded-none" />
        <div className="space-y-3 px-4 pt-3">
          <Skeleton className="relative z-10 -mt-16 h-28 w-28 rounded-full border-4 border-black" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-12 w-full" />
        </div>
      </>
    );
  }
  if (profile.isError) {
    return (
      <>
        <ColumnHeader title="Profile" back />
        <div className="p-4">
          <ErrorState
            error={profile.error}
            fallback="Couldn't load this profile."
            onRetry={() => profile.refetch()}
          />
        </div>
      </>
    );
  }

  const data = profile.data;

  /*
    Share the PROFILE the way a post is shared on Home: the same sheet, with
    WhatsApp, X, Facebook, Telegram, copy link and the device's own sheet.
  */
  const onShare = () => setSharing(true);

  return (
    <>
      {/*
        NODE 435:27500 — ONE CARD, not three bands.

        It was X's shape: a ColumnHeader naming the person, a full-bleed banner
        under it, then an avatar hanging off the banner's lower edge into the
        content. The file draws a single 741x473 card at a 20 radius with the
        photograph filling it and the identity laid over its foot — so the name,
        the handle and the actions sit ON the cover rather than in a strip above
        it and a row below it.

        `ProfileCover` owns the card; the actions and the meta row are passed in
        because who you are looking at decides both.
      */}
      <div className="px-4 pt-6 md:px-8">
        <ProfileCover
          profile={data}
          /* 435:27521 — the row beside the handle. The balance chip is the
             kash slice's and arrives as a slot; "Who viewed my profile" is not
             drawn, see the note on `ProfileCover`. */
          meta={isMe ? kashSlot : null}
          onChangePhoto={isMe ? () => setEditOpen(true) : undefined}
          actions={
            isMe ? (
              <>
                {/*
                  435:27531 and 435:27534 — a 38.4 disc and a 129x38 pill, and
                  BOTH report a white stroke at weight ZERO, which renders
                  nothing. The material is Figma's GLASS over the photograph —
                  translucent, one bright rim — sampled from the render as
                  `ws-glass-clear`. It was `ws-glass-pill`, the opaque dark
                  lens the room's header uses, which on a light cover is a
                  black coin the file does not draw.
                */}
                <button
                  type="button"
                  onClick={onShare}
                  aria-label="Share this profile"
                  className="ws-glass-clear ws-press flex h-[38.37px] w-[38.37px] items-center justify-center rounded-full text-white"
                >
                  {/* 1021:20262 — the node's own `basil:share-outline`. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset("/profile/icon-share.svg")} alt="" aria-hidden className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  aria-label="Edit profile"
                  className="ws-glass-clear ws-press flex h-[38px] w-[38px] items-center justify-center rounded-full text-[14.94px] leading-[25.61px] text-white transition-opacity hover:opacity-90 md:w-[129px] md:gap-[10.1px]"
                >
                  <IconMsEdit className="h-4 w-4 shrink-0" />
                  {/* The label is the file's on desktop; on a phone the disc's
                      icon is the whole control, like the discs beside it. */}
                  <span className="hidden md:inline">Edit Profile</span>
                </button>
              </>
            ) : (
              <>
                {/*
                  545:47603 — Wink, message, more, 16 apart, held to the right,
                  and NOTHING ELSE: the file draws no Follow on this cover.

                  A Follow pill was added ahead of Wink and it broke the frame
                  — the identity column lost the width it needs and the name's
                  chip wrapped under it, three rows against the file's two. So
                  Follow moved into the more menu as its first row (see
                  `PersonMoreMenu`) rather than being deleted: the act is one
                  tap further away, not gone, and the cover is the file's.
                  Whether it deserves a pill of its own is the designer's
                  question, and it is asked.
                */}
                {/* Message moved OFF the cover into the follow row below
                    (node 2112:19612); the cover keeps Wink and the more menu. */}
                <WinkButton profile={data} size="cover" />
                <PersonMoreMenu profile={data} size="cover" />
              </>
            )
          }
        />
      </div>

      {/*
        WHAT THE COVER DOES NOT CARRY.

        The name, the handle, the badges and the actions moved ONTO the card
        (435:27503) — this block used to draw all of them a second time, under
        it. What is left is the part 414:24935 puts below the cover: the bio,
        the place, and the two counts.
      */}
      {/*
        NODE 414:24935 — bio, counts, place. 741 wide on a 16 rhythm. Redrawn as
        1021:20271 (live file, 2026-09-11): 40 under the cover, the bio and the
        count labels at weight 400, the counts in `#F7F9F9`, and the place and
        website at 14/20 in `#A1A1AA`.

        The name, handle, badges and actions moved ONTO the cover (435:27503);
        this block used to draw all of them a second time underneath. What the
        file leaves here is three lines.
      */}
      <div className="flex flex-col gap-4 px-4 pt-6 md:px-8 md:pt-10">
        {/*
          THE FILE PRINTS A LINE WHEN THERE IS NO BIO — "Bio not updated" at
          50% white, where a written one is the same size in full white. Empty
          is a state worth showing on your OWN profile, because it is a thing to
          go and fix; on somebody else's it is just a fact about them. Either
          way it is the person's own words or the absence of them, never a
          placeholder pretending to be either.
        */}
        <p
          className={
            data.bio
              // `whitespace-pre-line`: the bio has ALWAYS stored the newlines
              // somebody typed — `building @square\n\ndone` was sitting in the
              // payload while the page printed it as one line. The breaks were
              // never lost, only unprinted.
              ? "whitespace-pre-line text-[15px] font-normal leading-5 text-white"
              : "text-[15px] font-normal leading-5 text-white/50"
          }
        >
          {/*
            Drawn by the SAME renderer as a post's body and a DM's, so an
            @handle in a bio is a link to that person exactly as it is
            everywhere else — one component rather than a third written for
            this surface. Plain text until `bioMentions` carries anybody.
          */}
          {data.bio ? <PostText text={data.bio} mentions={data.bioMentions} /> : "Bio not updated"}
        </p>

        {/*
          468:35601 — the count at Geist 600 15/20 in `#F7F9F9`, its label at
          400 in 50% white, 4 between them and BASELINE-aligned so a big number
          and its word sit on one line rather than centring against each other.

          THERE IS NO BULLET. The comment here used to say the separator was
          "the file's own, not a bullet we invented" — it was exactly a bullet
          we invented. Node 468:35605 between the two groups is a TEXT node
          with no characters at all: a 23px spacer, drawn as nothing. Same
          trick as the empty node in the earnings row.

          So the separation is space, and the file's own: 16 either side of a
          23px void is a 55px gap.
        */}
        <p className="tnum flex flex-wrap items-baseline gap-x-[55px] gap-y-1 text-[15px] leading-5">
          {/*
            THE COUNTS OPEN THE LISTS, the way X's do: tapping "Following"
            shows who this person follows, "Followers" who follows them. They
            were plain text before, so both numbers were claims with no way to
            see the people behind them. Same type, same spacing — only now a
            link, underlined on hover like every other text link on the page.
          */}
          {/*
            WHO YOU FOLLOW IS YOURS (2026-09-16: "people should not be able to
            see the people you are following"). Only your own profile links the
            count to the list; on anybody else's it is a plain number. Followers
            stays public. The route refuses the list too (FollowListPage), so a
            shared /following link shows nothing either.
          */}
          {isMe ? (
            <Link
              href={profileHref(data, "following")}
              className="flex items-baseline gap-1 rounded-sm decoration-white/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <CountLabel count={data.followingCount} label="Following" />
            </Link>
          ) : (
            <span className="flex items-baseline gap-1">
              <CountLabel count={data.followingCount} label="Following" />
            </span>
          )}
          <Link
            href={profileHref(data, "followers")}
            className="flex items-baseline gap-1 rounded-sm decoration-white/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <CountLabel count={data.followerCount} label="Followers" />
          </Link>
        </p>

        {/* node 2112:19612 — the follow row (message · Follow) below the counts
            on somebody else's profile. Self-guards to null on your own. */}
        <ProfileActionRow profile={data} messageSlot={messageSlot} />

        {/*
          THE PLACE THIS PERSON PUBLISHED — 418:25221, a 24px glyph and the
          text at 15/20 in FULL white, not the 13px meta line it was. The file
          gives it the same weight as the bio above it, which is right: it is
          something they said about themselves rather than a caption.

          Rendered only when they said something. Null means "hasn't said",
          which is not a blank to fill with an em-dash or a guess.

          A place, never a distance: there is no "3 km away" here and no field
          for one. See `lib/people-filters.ts`.

          GENDER IS NOT DRAWN HERE, and it was. Node 468:35609 is the whole
          meta row and it holds exactly two things — the place, and a website —
          with no gender anywhere in the frame: dumping every text node in
          534:16948 turns up the bio, the two counts, "108 Opebi Ikeja, Lagos"
          and a URL, and nothing else. It is still on the profile and still
          editable; the design simply does not print it on the page, so neither
          do we.

          NO LINK ROW YET. 468:35614 draws `akar-icons:link-chain` at 24 and
          the URL at 15/20 in full white, 8 apart, 16 after the place. There is
          no URL field of any kind on `PublicProfile` — re-checked against the
          live contract at :8094, where `avatarUrl` and `coverUrl` are the only
          `*url` keys. Requested; the row appears when the field does, and it
          is one `<a>` in the row that already exists.
        */}
        {/*
          545:47626 — the place and the website on one row, 16 apart, each a
          24px glyph 8 from its text at 15/20 in full white. The glyphs are the
          file's own (the globe pin, `akar-icons:link-chain`), drawn in
          `#7E3BEB` there and in `--color-create` here: purple ink on the dark
          ground takes the ramp's light stop for contrast (CLAUDE.md), and the
          previous pin already followed that rule.

          THE WEBSITE IS LIVE on `PublicProfile` at :8080 (null today for
          everyone; the edit sheet can set it). It is an anchor only when it
          is an http(s) URL — a public page must never carry a `javascript:`
          href somebody typed about themselves.
        */}
        {(placeLine(data) || isHttpUrl(data.website)) && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] font-normal leading-5 text-[#A1A1AA]">
            {placeLine(data) && (
              <span className="flex items-center gap-2">
                <IconProfileGlobePin className="h-6 w-6 shrink-0 text-create" />
                {/* "Ikeja, Lagos, Nigeria" from whichever halves this reader
                    may see — or the continent alone (see lib/countries.ts). */}
                {placeLine(data)}
              </span>
            )}
            {isHttpUrl(data.website) && (
              <a
                href={data.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80"
              >
                <IconProfileLink className="h-6 w-6 shrink-0 text-create" />
                <span className="min-w-0 truncate">{data.website}</span>
              </a>
            )}
          </p>
        )}
      </div>

      {/* 534:15577 — the houses this person keeps, 38 under the block above. */}
      {/* 1021:20930 — Photos, 38 under the bio block (the section rhythm of
          1021:20270). The wrapper collapses when the row renders nothing. */}
      <div className="px-4 pt-[38px] empty:hidden md:px-8">
        <ProfilePhotos username={data.username} isMe={isMe} />
      </div>

      {isMe && housesSlot && <div className="px-4 pt-[38px] md:px-8">{housesSlot}</div>}

      {/*
        545:47615 — what a STRANGER's profile carries under the bio block, in
        the file's order and on its 24 rhythm: Badges, House, Replays. Each
        section is absent — heading included — until it has something real
        to show, so a profile with none of the three ends at the bio block.
      */}
      {!isMe && (
        <div className="flex flex-col gap-6 px-4 pt-6 md:px-8">
          {!badges.unavailable && badges.data && <BadgesSection badges={badges.data.items} />}
          {housesOfSlot?.(data)}
          {replaysSlot?.(data)}
        </div>
      )}

      {/* Own-profile business: creator application and verification live above
          the tabs, where they read as account state rather than content.

          NO RULE ABOVE IT. It carried a full-width `border-t`, which drew a
          line straight across the page between the houses rail and the Creator
          card — the one divider on a page that is otherwise a stack of
          outlined cards on open ground. Both cards already have their own
          border, so the rule was separating things that were separated, and it
          cut the column at a point the file draws nothing.

          `px-8` to match, not `px-4`: every other block on this page — the
          cover, the bio, the houses — is inset 32, so these two cards hung 16px
          wider than the rail directly above them. */}
      {isMe && (
        <div className="space-y-3 px-4 pb-4 pt-9 md:px-8">
          {/* The Creator card ("You can host streams and schedule sessions",
              Open Studio) is hidden for now, at ogazboiz's call. The Studio
              route still works; the card comes back by restoring this line:
              <CreatorCard role={data.role} /> */}
          <VerificationCard />
        </div>
      )}

      {/*
        NODE 492:47030 — the ACCOUNT strip and its panel.

        Own-profile only, and every tab is the reason why: earnings, badges,
        gifts received and your own replays are all statements about your
        account, and the two routes behind any of them (`/me/tips/received`,
        and the KASH engine) are `/me` routes. The same frame in the file also
        carries "Add new house" and "Edit Profile", which are only ever yours.

        TWO OF THE FOUR TABS ARE INERT, and each for a checked reason rather
        than because it was awkward. Earnings is live: nodes 492:46239 and
        492:46539 draw both its states and `GET /me/tips/received` backs them.

         · Badges — `GET /profiles/:username/badges` is asked for and built
           against (543:40148, `BadgesPanel`), but the backend holds it until
           the earning rules are decided, so it 404s and the tab stays inert.
         · Replays — `MARKET_FLAGS.replays`, off because LiveKit egress and a
           storage bucket are not provisioned, so `replayUrl` is null on every
           stream. The flag makes the surface reappear; it cannot make the
           recordings exist.

        Visible and disabled, per the standing rule — deleting them loses the
        roadmap, leaving them live tells the reader a lie.
      */}
      {/* 1021:21615 — ONE strip, Posts first, 38 under the section above. Your
          own profile adds the account tabs after it; anyone else's is Posts. */}
      {(
        <div className="pt-[38px]">
          <AccountTabs
            tabs={[
              { value: "posts", label: "Posts" },
              ...(isMe && giftGallerySlot
                ? ([
              { value: "earnings", label: "Earnings" },
              {
                value: "badges",
                label: "Badges",
                // Live the moment `GET /profiles/:username/badges` answers;
                // inert with the reason while it 404s — see `useProfileBadges`.
                disabledReason:
                  badges.unavailable || !badges.data ? "Not available yet" : undefined,
              },
              { value: "gifts", label: "Gift Gallery" },
              {
                value: "replays",
                label: "Replays",
                disabledReason: MARKET_FLAGS.replays ? undefined : "Soon",
              },
                  ] satisfies AccountTabDef[])
                : []),
            ]}
            value={accountTab}
            onChange={setAccountTab}
          />
          {accountTab === "posts" && (
            <PostsTab
              username={username}
              isMe={isMe}
              composeSlot={composeSlot}
              postSlot={postSlot}
              pinned={profile.data?.pinnedPost}
            />
          )}
          {/* The account panels are YOUR OWN, gated where ownership is decided:
              a stranger's strip is Posts alone and can never mount these. */}
          {isMe && giftGallerySlot && (
            <>
              {accountTab === "earnings" && earningsSlot}
              {accountTab === "badges" && badges.data && <BadgesPanel badges={badges.data.items} />}
              {accountTab === "gifts" && giftGallerySlot}
            </>
          )}
        </div>
      )}

      {SHOW_CONTENT_TABS && (
        <>
          {/* Two stickies on one page: the header above pins first, so the tabs
            have to pin BELOW it — the shell's fixed top strip plus the header's
            own measured height. At `top-0` with a lower z-index they stuck
            straight underneath both and vanished, so a scrolled profile had no
            way left to switch tab. */}
          <div className="ws-hair sticky top-[calc(var(--ws-topbar-h)_+_var(--ws-colhead-h))] z-20 border-b bg-chrome">
            <ColumnTabs
              tabs={[
                { value: "posts" as Tab, label: "Posts" },
                { value: "media" as Tab, label: "Media" },
                { value: "streams" as Tab, label: "Streams" },
                { value: "activities" as Tab, label: "Activities" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>

          {tab === "posts" && (
            <PostsTab
              username={username}
              isMe={isMe}
              composeSlot={composeSlot}
              postSlot={postSlot}
            />
          )}
          {tab === "media" && (
            <MediaTab
              username={username}
              isMe={isMe}
              viewerSlot={mediaViewerSlot}
            />
          )}
          {tab === "streams" && <StreamsTab username={username} isMe={isMe} />}
          {tab === "activities" && (
            <ActivitiesTab username={username} isMe={isMe} />
          )}
        </>
      )}

      {sharing && (
        <ProfileShareSheet open onClose={() => setSharing(false)} profile={data} />
      )}

      {isMe && (
        <EditProfileSheet
          me={data}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

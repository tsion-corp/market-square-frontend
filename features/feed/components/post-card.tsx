"use client";

import { useEffect, useRef, useState } from "react";
import { profileHref } from "@/lib/profile-href";
import { atHandle } from "@/lib/handle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TransitionLink } from "@/components/ui/transition-link";
import { cn } from "@/lib/cn";
import { relativeTime, formatDateTime } from "@/lib/format";
import { RoomPostCard } from "@/features/feed/components/room-post-card";
import { resolveCta } from "@/lib/deeplink";
import { isVideoPost } from "@/lib/media";
import { InlineVideo } from "@/components/ui/inline-video";
import { MediaFrame } from "@/components/ui/media-frame";
import { TransactionCard } from "@/components/ui/transaction-card";
import { postMediaList } from "@/lib/post-media";
import { MediaRail } from "@/features/feed/components/media-rail";
import { PostText } from "@/components/ui/post-text";
import { CoinChips } from "@/components/ui/coin-chips";
import { reportView, useRecordView } from "@/features/feed/hooks/use-record-view";
import { IconReplayPlay } from "@/components/ui/profile-icons";
import { useGate } from "@/hooks/use-gate";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { Avatar } from "@/components/ui/avatar";
import { RoleChip, VerifiedBadge } from "@/components/ui/badge";
import { IconFlag, IconFullscreen, IconQuote, IconSend } from "@/components/ui/icons";
import {
  IconMsBookmark,
  IconMsChart,
  IconMsComment,
  IconMsLike,
  IconMsMore,
  IconMsRepost,
  IconMsShare,
} from "@/components/ui/design-icons";
import { formatCount } from "@/lib/format";
import {
  useAddComment,
  useBookmarkPost,
  useDeletePost,
  usePinPost,
  useEditPost,
  useLikePost,
  useReport,
  useRepostPost,
} from "@/features/feed/hooks/use-feed";
import { CommentsSheet } from "@/features/feed/components/comments-sheet";
import { useMentionTyping } from "@/features/feed/hooks/use-mention-typing";
import { MentionPicker } from "@/features/feed/components/mention-picker";
import { ShareSheet } from "@/components/ui/share-sheet";
import { SharedLinkCard } from "@/components/layout/shared-link-card";
import { firstSquareLink } from "@/lib/square-link";
import { sharePostId } from "@/lib/short-id";
import type { Post, ReportReason } from "@/features/feed/lib/types";
import type { Profile } from "@/lib/api/schemas";
import { sq } from "@/lib/square-path";

// Labels map onto the backend's fixed reason enum.
const REPORT_REASONS: Array<{ reason: ReportReason; label: string }> = [
  { reason: "spam", label: "Spam" },
  { reason: "scam", label: "Scam or fraud" },
  { reason: "abuse", label: "Harassment or abuse" },
  { reason: "other", label: "Something else" },
];

/**
 * The post's overflow menu.
 *
 * It used to offer only Report. `PATCH /posts/:id` and `DELETE /posts/:id` are
 * both live, so the AUTHOR now gets Edit and Delete above the report reasons —
 * and only the author: the service refuses both for anybody else (403 even for
 * an admin, because admins remove rather than rephrase), so offering them would
 * be a control that can only fail.
 *
 * EDIT IS TEXT ONLY, which the sheet says. Media, a quote and a deep link are
 * deliberately not editable — swapping the picture under a post people have
 * already liked changes what they endorsed.
 */
function ReportMenu({ post, mine }: { post: Post; mine: boolean }) {
  const targetId = post.id;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const report = useReport();
  const remove = useDeletePost();
  const pin = usePinPost();
  const gate = useGate();
  return (
    <div className="relative">
      {/* The design draws "more" as a ringed 38px disc at the end of the
          action row, not as a bare glyph in the header. */}
      <button
        aria-label="More options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        /* Node 236:4750 reports a transparent fill with a WHITE STROKE and no
           weight — the zero-weight trap. The rendered node is the opaque
           near-black lens `ws-glass-pill` paints, which is what the file shows:
           a solid dark disc, not a hairline ring. Same control, same material,
           as the gist room's circular buttons. 647:16439 is 44.16 across at
           the live file's 1.151 scale: 38.37 here. */
        className="ws-glass-pill flex h-[38.37px] w-[38.37px] items-center justify-center rounded-full text-grey-100 transition-colors hover:text-create"
      >
        <IconMsMore className="h-6 w-6" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* Opens UPWARD, over its own post — "let the modal move up instead
              of down". Downward it hung past the card's foot and over the
              next post, which paints above it (see the ws-enter note). */}
          <div className="ws-popover absolute bottom-full right-0 z-20 mb-2 w-56 rounded-2xl p-1.5">
            {mine && (
              <>
                {/* One pin per profile: pinning a second replaces the first,
                    so this never asks the author to unpin anything first.
                    Absent where the routes are not deployed (404-quiet), and
                    absent on a story, which expires and cannot be pinned. */}
                {!pin.unavailable && post.kind !== "story" && (
                  <button
                    onClick={() => {
                      setOpen(false);
                      pin.mutate({ postId: targetId, pin: !post.pinnedByAuthor });
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-left text-sm text-body transition-colors hover:bg-white/10"
                  >
                    {post.pinnedByAuthor ? "Unpin from profile" : "Pin to your profile"}
                  </button>
                )}
                <button
                  onClick={() => {
                    setOpen(false);
                    setEditing(true);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm text-body transition-colors hover:bg-white/10"
                >
                  Edit post
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setConfirmDelete(true);
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-white/10"
                >
                  {post.kind === "story" ? "Delete story" : "Delete post"}
                </button>
                <span aria-hidden className="my-1 block h-px bg-white/10" />
              </>
            )}
            <p className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-meta">
              <IconFlag className="h-3.5 w-3.5" /> Report
            </p>
            {REPORT_REASONS.map(({ reason, label }) => (
              <button
                key={reason}
                onClick={() => {
                  setOpen(false);
                  gate(() => report.mutate({ targetType: "post", targetId, reason }));
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-body transition-colors hover:bg-white/10"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit post">
        <EditPostForm post={post} onDone={() => setEditing(false)} />
      </Sheet>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={post.kind === "story" ? "Delete this story?" : "Delete this post?"}
      >
        {/* This one IS final — unlike removing a chat, which only leaves your
            own inbox — so it says so. */}
        <p className="text-[13px] leading-5 text-body">
          It comes off every timeline it appears on, along with its replies. This cannot be
          undone.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Keep it
          </Button>
          <Button
            className="flex-1"
            loading={remove.isPending}
            onClick={() =>
              gate(() =>
                remove.mutate(targetId, { onSuccess: () => setConfirmDelete(false) })
              )
            }
          >
            Delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/**
 * The edit form — text only.
 *
 * Its own component so the draft starts fresh on every opening: the sheet is
 * mounted only while open, so there is nothing stale to reset and no effect
 * needed to reset it. The 2000-character cap is the service's own, applied here
 * so a request cannot be rejected for length after the fact.
 */
function EditPostForm({ post, onDone }: { post: Post; onDone: () => void }) {
  const [text, setText] = useState(post.text);
  const edit = useEditPost(post.id);
  const trimmed = text.trim();
  const valid = trimmed.length > 0 && trimmed !== post.text.trim();
  return (
    <div>
      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={2000}
        rows={5}
        className="ws-inset w-full resize-none px-4 py-3 text-[15px] leading-6 text-heading outline-none placeholder:text-meta"
      />
      <p className="mt-2 text-[11px] leading-4 text-meta">
        Text only — a post&apos;s picture, quote and link stay as published.
      </p>
      <Button
        className="mt-4 w-full"
        disabled={!valid}
        loading={edit.isPending}
        onClick={() => edit.mutate(trimmed, { onSuccess: onDone })}
      >
        Save
      </Button>
    </div>
  );
}

/**
 * Count action: a 24px glyph, a 2px gap, then the tally.
 *
 * The design groups the three of these inside one soft pill, so the hover
 * affordance is the glyph tinting up rather than `ws-action`'s halo — a halo
 * inside a pill reads as two overlapping surfaces.
 */
function CountAction({
  label,
  count,
  active,
  activeClass = "text-heading",
  hoverClass,
  onClick,
  children,
}: {
  label: string;
  count: number;
  active?: boolean;
  activeClass?: string;
  /**
   * The act's own colour on hover, for the glyph AND its count together —
   * blue to reply, green to repost, red to like. `group-hover:` classes,
   * spelled out at the call site so Tailwind sees them.
   */
  hoverClass?: string;
  /** Absent for a tally that is only a fact — views have nothing to do. */
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="group flex shrink-0 items-center gap-0.5 transition-colors md:gap-[2px]"
    >
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center transition-colors",
          active ? activeClass : cn("text-grey-400", hoverClass ?? "group-hover:text-heading")
        )}
      >
        {children}
      </span>
      {/* 12/16 in `#FFFFFF` — node 236:4729. */}
      <span className={cn("tnum text-[12px] leading-4 text-white transition-colors", hoverClass)}>
        {formatCount(count)}
      </span>
    </button>
  );
}

/**
 * The quoted original, inset inside the quoting post.
 *
 * One level only: this card never renders its own quotedPost, so a quote of a
 * quote stops here rather than nesting frames forever. A removed or expired
 * original keeps its slot and says so — dropping it silently would leave the
 * commentary above it dangling with no referent.
 */
function QuotedPost({ quoted }: { quoted: NonNullable<Post["quotedPost"]> }) {
  if (quoted.unavailable) {
    return (
      <div className="ws-inset mt-3 px-4 py-3">
        <p className="text-[13px] text-meta">This post is unavailable.</p>
      </div>
    );
  }

  const author = quoted.author;
  return (
    <Link
      href={sq(`/p/${quoted.id}`)}
      className="ws-inset mt-3 block px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
    >
      <span className="flex items-center gap-2">
        <Avatar name={author?.displayName ?? "?"} seed={author?.id} src={author?.avatarUrl} size={20} />
        <span className="truncate text-[13px] font-bold text-heading">
          {author?.displayName ?? "Unknown"}
        </span>
        {author && (
          <>
            <VerifiedBadge verification={author.verification} className="h-3 w-3" />
            {atHandle(author.username) && (
              <span className="truncate text-[12px] text-meta">{atHandle(author.username)}</span>
            )}
          </>
        )}
      </span>
      {quoted.text && (
        <span className="mt-1.5 line-clamp-3 block text-[13px] leading-normal text-body">
          {quoted.text}
        </span>
      )}
      {quoted.mediaUrl && !isVideoPost(quoted) && (
        <MediaFrame backdrop={quoted.mediaUrl} className="mt-2 h-40 w-full rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown */}
          <img
            src={quoted.mediaUrl}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-contain"
          />
        </MediaFrame>
      )}
    </Link>
  );
}

/** A bare 24px glyph action — share, Arkmark, more. */
function GlyphAction({
  label,
  active,
  disabled,
  hoverClass,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  /** The act's own colour on hover — blue to share, purple to save. Spelled out at the call site. */
  hoverClass?: string;
  /** Absent for a tally that is only a fact — views have nothing to do. */
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active ? "text-create" : cn("text-body", hoverClass ?? "hover:text-heading")
      )}
    >
      {children}
    </button>
  );
}

/**
 * Repost, or quote it with your own commentary.
 *
 * The tally stays on the trigger so the row reads the same as the other two
 * actions; the choice opens underneath. Undoing a repost is a direct toggle —
 * only the "add" direction needs the menu.
 */
function RepostMenu({
  post,
  onRepost,
  onQuote,
}: {
  post: Post;
  onRepost: () => void;
  onQuote: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Already reposted: the only sensible action is to undo it.
  if (post.repostedByMe) {
    return (
      <CountAction
        label="Undo repost"
        count={post.repostCount}
        active
        activeClass="text-up"
        hoverClass="group-hover:text-up"
        onClick={onRepost}
      >
        <IconMsRepost className="h-[18px] w-[18px]" />
      </CountAction>
    );
  }

  return (
    <div className="relative">
      <CountAction
        label="Repost or quote"
        count={post.repostCount}
        hoverClass="group-hover:text-up"
        onClick={() => setOpen((v) => !v)}
      >
        <IconMsRepost className="h-[18px] w-[18px]" />
      </CountAction>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="ws-popover absolute bottom-full left-0 z-20 mb-2 w-44 rounded-2xl p-1.5">
            <button
              onClick={() => {
                setOpen(false);
                onRepost();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-body transition-colors hover:bg-white/10"
            >
              <IconMsRepost className="h-4 w-4" /> Repost
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onQuote();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-body transition-colors hover:bg-white/10"
            >
              <IconQuote className="h-4 w-4" /> Quote
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Reply without leaving the timeline.
 *
 * The point of it is the navigation step it removes: a short reply should not
 * cost you your place in the feed. So it is deliberately NOT a second
 * composer — no media, no length ambitions. Anything longer than a line wants
 * the sheet, where the thread is readable.
 */
function InlineComment({
  postId,
  onOpenThread,
  className,
  revealed = false,
  rootRef,
}: {
  postId: string;
  onOpenThread: () => void;
  className?: string;
  /**
   * ON A PHONE THE FIELD IS HIDDEN UNTIL THE COMMENT TALLY IS TAPPED — the
   * tap reveals it and puts the cursor in it, so the reader is typing rather
   * than looking at a second pill under every post. From `md` up the file's
   * row shows the field always and this is never set.
   */
  revealed?: boolean;
  /** The card reads the root's size to know whether the field is on screen. */
  rootRef?: React.Ref<HTMLDivElement>;
}) {
  const add = useAddComment(postId);
  const gate = useGate();
  const field = useRef<HTMLInputElement>(null);
  // Focus follows the reveal: a field that appears and waits for a second tap
  // is a field that reads as broken.
  useEffect(() => {
    if (revealed) field.current?.focus();
  }, [revealed]);
  // The same @-typing as the composer and the thread box.
  const typing = useMentionTyping({ max: 500, field });
  const { text } = typing;
  const [sent, setSent] = useState(false);

  const submit = () => {
    const body = text.trim();
    // Guarded on isPending too: Enter held down, or a fast double tap on send,
    // would otherwise post the same reply twice.
    if (!body || add.isPending) return;
    gate(() =>
      add.mutate({ text: body, mentions: typing.mentionsFor(body) }, {
        onSuccess: () => {
          typing.reset();
          // Something has to happen. The reply lands in a thread the reader
          // cannot see from here, so without this the field just empties and
          // it is not obvious anything was posted. The tally moves at the same
          // time (useAddComment patches it everywhere), so the confirmation
          // and the count agree.
          setSent(true);
          window.setTimeout(() => setSent(false), 2400);
        },
      }),
    );
  };

  return (
    /*
      NODE 496:13647 — the comment pill: 220 x 40.15, `white/3` at a full
      round, 8.08 of padding, the file's 24px comment glyph at 60% white, then
      "Comment here..." 2 to its right at 12/16.

      THE FILE'S PILL AND NOTHING MORE. The reader's own avatar and an emoji
      picker used to sit in it; both are gone at ogazboiz's word ("remove that
      emoji and that my profile ... it should look the same as the figma").
      The field is still live — typing and Enter post a reply — it just wears
      the file's clothes.

      One departure, stated: the placeholder is the file's copy but not its
      colour. `496:13652` is `#3C3C3C`, which is 1.5:1 against the `#0F0F0F`
      card — a hint nobody can read. The app's own placeholder grey is used.
    */
    /*
      220 wide at node 496:13434, not a field that grows: the file spends the
      leftover on the gap before share/Arkmark/more instead, which is what
      holds those three against the card's right edge. `flex-1` with the cap
      keeps that at the design's width and still fills a narrower card rather
      than leaving the row short.
    */
    <div
      ref={rootRef}
      className={cn(
        // `flex-1` ONLY where the row is horizontal. Below `md` the action row
        // is a column, and a flex-basis of 0 on the COLUMN axis overrides the
        // pill's own height — the field collapsed to its 24px glyph on a phone
        // while the tallies pill beside it stood at 40. Full width there instead.
        "ws-comment-field relative flex h-10 w-full min-w-0 items-center gap-0.5 px-2 md:w-auto md:flex-1 md:max-w-[220px]",
        className
      )}
    >
      <IconMsComment aria-hidden className="h-6 w-6 shrink-0 text-white/60" />
      {sent ? (
        // Says what happened AND offers the one thing a person wants next.
        <button
          type="button"
          onClick={onOpenThread}
          className="min-w-0 flex-1 truncate text-left text-[12px] text-grey-300"
        >
          Posted · <span className="font-semibold text-accent">See the thread</span>
        </button>
      ) : (
        <input
          ref={field}
          value={text}
          onChange={(event) => typing.update(event.target.value, event.target.selectionStart)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !typing.token) submit();
            if (event.key === "Escape") typing.dismiss();
          }}
          placeholder="Comment here..."
          aria-label="Write a reply"
          disabled={add.isPending}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-heading outline-none placeholder:text-grey-700 disabled:opacity-60"
        />
      )}
      {!sent && text.trim() && (
        <button
          onClick={submit}
          disabled={add.isPending}
          aria-label="Post reply"
          className="shrink-0 rounded-full p-1 text-accent transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          <IconSend className="h-3.5 w-3.5" />
        </button>
      )}
      {/* Portalled and placed above the pill by the picker itself — the pill
          sits at the foot of the card, where a list dropping down is clipped. */}
      {typing.token && <MentionPicker typing={typing} />}
    </div>
  );
}

export function PostCard({
  post,
  repostedBy,
  followSlot,
  winkSlot,
  tipSlot,
  onOpenMedia,
  onOpenPost,
  onQuote,
  full = false,
  compact = false,
}: {
  post: Post;
  /**
   * Show the caption whole, with no "Show more".
   *
   * The timeline clamps: one long post otherwise makes a card taller than the
   * screen and pushes every other post out of view. A post's OWN page is the
   * place that owes you the whole thing, so it sets this.
   */
  full?: boolean;
  /**
   * Drop the inline reply field.
   *
   * For a card in a RAIL rather than the column. The field is `flex-1` capped
   * at the file's 220 and has no floor, so once the tallies pill and the four
   * controls have taken their width it collapses to a sliver — a stray shape
   * beside the icons that cannot be typed into. It is also the wrong control
   * there: replying in place needs room to write and to read the thread, and a
   * rail has neither. Tapping the card opens the post, where the real field is.
   */
  compact?: boolean;
  /** Opens the composer with this post quoted. Omitted where there is no composer. */
  onQuote?: (post: Post) => void;
  /** Set when this post reached the timeline through someone's repost. */
  repostedBy?: Profile | null;
  /** Composed from outside the slice — feed never imports profile. */
  followSlot?: (author: Profile) => React.ReactNode;
  /** The wink, from the profile slice, between the tip and the follow — node
   *  496:13389 draws all three and they are three different acts. */
  winkSlot?: (author: Profile) => React.ReactNode;
  /** Composed from outside the slice — the tip control belongs to the tips
   *  slice, and it takes the POST because a tip goes to `/posts/:id/tips`. */
  tipSlot?: (post: Post) => React.ReactNode;
  /** Promotes a media card into the full-screen viewer. */
  onOpenMedia?: (post: Post) => void;
  /**
   * Overrides where tapping the card goes. Home's "Post For You" rail uses it
   * to open the /feed timeline with THIS post pinned first, rather than the
   * single-post permalink.
   */
  onOpenPost?: (post: Post) => void;
}) {
  const like = useLikePost();
  const repost = useRepostPost();
  const router = useRouter();
  /*
    TAPPING THE WORDS OPENS THE POST, as it does on X — the card had no way
    into its own page at all. Anything interactive inside the caption (a
    mention, a hashtag, a $ticker, Show more) keeps its own tap, and a reader
    who dragged to select text is not thrown onto another page. On the post's
    own page there is nowhere further to go, so nothing is wired.
  */
  const openPost = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, textarea, [role='button']")) return;
    if (window.getSelection()?.toString()) return;
    if (onOpenPost) {
      onOpenPost(post);
      return;
    }
    router.push(sq(`/p/${post.id}`));
  };
  const bookmark = useBookmarkPost();
  const gate = useGate();
  // Who is reading, so the overflow menu can offer Edit and Delete to the
  // author and to nobody else. COMPARED rather than assumed impossible — the
  // same rule the follow control and the directory filter apply.
  const me = useMe();
  const [commentsOpen, setCommentsOpen] = useState(false);
  /*
    THE COMMENT TALLY DOES TWO THINGS, decided by what is on screen. On a
    phone the reply field is hidden under the row until the tally is tapped,
    so the first tap REVEALS it (and focuses it); once it is showing — which
    on desktop is always — the tap opens the thread, as a reply count should.
    Read from the field's own box rather than a breakpoint so the two can
    never disagree about what the reader is looking at.
  */
  const [replyOpen, setReplyOpen] = useState(false);
  const inlineRef = useRef<HTMLDivElement>(null);
  const onCommentTally = () => {
    /*
      A COMPACT CARD HAS NO INLINE FIELD TO REVEAL.

      `InlineComment` is rendered only on the full card, so on a compact one
      `inlineRef` is null, the height test fails, and the old fallback set
      `replyOpen` — revealing a field that does not exist. Tapping the reply
      count on Home's Post For You row therefore did nothing at all
      (ogazboiz: "i cant be able to coment from here"). The sheet is not
      compact-gated, so the compact card opens it directly.
    */
    if (compact) {
      setCommentsOpen(true);
      return;
    }
    /*
      ANYTHING TO READ? THEN READ IT.

      A count is a promise that there is something behind it, and tapping one
      has to show that thing. This used to decide on the inline field's
      geometry instead: if the composer happened to be laid out, open the
      thread, otherwise reveal the composer. So on a post with comments the tap
      offered a box to type in and never showed the comment that was already
      there — ogazboiz hit it twice on his own profile and reported it, both
      times, as the button doing nothing.

      Revealing the field is still right when there is NOTHING to read: on an
      empty post the count is zero and "be the first" is the only sensible
      answer. The rule is what is behind the number, not where a div landed.
    */
    if (post.commentCount > 0) {
      setCommentsOpen(true);
      return;
    }
    setReplyOpen(true);
  };
  const author = post.author;
  // A button when the media can expand, a plain div when it cannot. Rendering
  // an inert button would announce a control to a screen reader that does
  // nothing when activated.
  const Tag = onOpenMedia ? "button" : "div";
  // Recorded on dwell, not on mount: see useRecordView. A CLIP is the
  // exception — its view is the play, reported by the player below.
  const video = isVideoPost(post);
  // Two or more photos ride the rail (node 1029:22591); one keeps the
  // hugging frame below.
  // The first Square link in the post's words, if there is one.
  const shared = firstSquareLink(post.text);
  const rail = postMediaList(post);
  // SINGLE-IMAGE FRAMING, the X / Instagram rule: the photo fills the column
  // width and keeps its own aspect ratio CLAMPED to a pleasant range — 4:5 at
  // the tallest, 1.91:1 at the widest. An image inside that range shows whole
  // (the frame IS its ratio, so `object-cover` crops nothing); only a photo
  // taller or wider than the range gets a minimal centre crop, exactly as both
  // apps do. Needs the media's real pixels, which the payload carries.
  const dims = post.media?.[0];
  const naturalAspect = dims?.width && dims?.height ? dims.width / dims.height : null;
  const framedAspect = naturalAspect ? Math.min(1.91, Math.max(0.8, naturalAspect)) : null;
  const viewRef = useRecordView(post.id, !video);
  const cta = resolveCta(post.deepLink, `feed:post:${post.id}`);
  // A TRANSACTION post — the trade deep-link (`<network>:<hash>`). It gets the
  // receipt card instead of the plain "View transaction" row. The amount is not
  // in the post, so the card shows the author's own words + who, when and the
  // wallet; the hero amount fills in only if the payload ever carries one.
  const isTrade = post.deepLink?.kind === "trade";
  // A gist room posted to the feed — drawn as the room, not as a link row.
  const isRoom = post.deepLink?.kind === "stream";
  const txWallet = (() => {
    if (!isTrade || !post.deepLink) return "";
    const hash = post.deepLink.ref.slice(post.deepLink.ref.indexOf(":") + 1);
    return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  })();

  // Share the POST, not its author's profile — a reader following the link
  // has to land on the thing they were shown. The sheet offers WhatsApp, X,
  // Facebook, Telegram, the clipboard and the device's own sheet, each
  // carrying the post's words and its link (`ShareSheet`). It used to be one
  // tap that copied the link on any browser without a native sheet, which is
  // most desktops — so a post could not be put into a WhatsApp group at all.
  const [sharing, setSharing] = useState(false);
  const share = () => setSharing(true);

  return (
    /*
      THE SLAB — node 496:13361.

      759 wide, 16.5 radius, a 1px hairline at 10% white over no fill, and two
      black/10 shadows (in `ws-post`). Its content sits in a 680.92 column
      centred in it: 39 either side. Vertically the file gets its top inset the
      long way round — 16 of padding, then a 57-tall gradient plate on a -49
      gap — which nets to 24 above the header and leaves 16 below the actions.
      Written here as the padding it works out to.

      THE GRADIENT PLATE ITSELF IS NOT DRAWN. It fades #0F0F0F to transparent,
      and the page under this card is #0F0F0F, so it composites to exactly
      nothing; it is only visible in an isolated export, over the white that
      Figma substitutes for the missing page fill. What it contributes to the
      real card is its 8px of layout, which is above.

      The design has no phone frame, so the 39 is desktop-only — at 360 it
      would spend a fifth of the screen on margins.
    */
    <article
      ref={viewRef}
      className={cn(
        "ws-post",
        // 1313:152732 — in the rail every card is the SAME height (367), which
        // is what makes the row even. The card fills its box and the caption
        // takes the slack, so a short post and a four-photo post are one size.
        compact ? "flex h-full flex-col p-3" : "p-4 md:px-[39px] md:pb-4 md:pt-6"
      )}
    >
      {/* The author put this at the top of their profile. Sits with the
          repost line because both say WHY this card is here rather than
          anything about the post. It is the AUTHOR's placement, so every
          reader sees it, signed out included. */}
      {post.pinnedByAuthor && (
        <p className="mb-2 pl-1 text-[12px] font-semibold text-white/50">Pinned</p>
      )}

      {/* Repost attribution. The card still belongs to the original author —
          this line only says who passed it along. */}
      {repostedBy && (
        <p className="mb-2 flex items-center gap-1.5 pl-1 text-[12px] text-white/50">
          <IconMsRepost className="h-3.5 w-3.5 shrink-0" />
          <Link href={profileHref(repostedBy)} prefetch={false} className="truncate hover:underline">
            {repostedBy.displayName}
          </Link>
          <span>reposted</span>
        </p>
      )}

      {/*
        IDENTITY ROW — node 496:13366, 43.85 tall.

        A 39.2 avatar behind a 1.8px ring at 20% white, 12 of gap, then the
        name at 14.8/14.1 bold with the org lockup 7 to its right, and the
        handle under it at 12.1/16.2 in 50% white. The three controls at the
        far end are all centred on the row's own middle line, which is what
        lets them be 34, 40.7 and 38 tall without the row looking ragged.
      */}
      <header className="flex items-center gap-3 md:h-[43.9px]">
        {author ? (
          <TransitionLink href={profileHref(author)} prefetch={false} className="shrink-0">
            <Avatar
              name={author.displayName}
              seed={author.id}
              src={author.avatarUrl}
              size={39}
              className="ring-[1.8px] ring-inset ring-white/20"
            />
          </TransitionLink>
        ) : (
          <Avatar
            name="?"
            seed={post.authorId}
            size={39}
            className="ring-[1.8px] ring-inset ring-white/20"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-[7px]">
            {author && (
              <>
                <Link
                  href={profileHref(author)} prefetch={false}
                  className="truncate text-[14.8px] font-bold leading-[14.1px] text-white hover:underline"
                >
                  {author.displayName}
                </Link>
                <VerifiedBadge verification={author.verification} className="h-3.5 w-3.5" />
                <RoleChip role={author.role} />
              </>
            )}
          </div>
          <p className="mt-[2.8px] truncate text-[12.1px] leading-[16.2px] text-white/50">
            {atHandle(author?.username) ? `${atHandle(author?.username)}  •  ` : ""}
            {/* The time is the post's own link, the keyboard's way in. */}
            {full ? (
              relativeTime(post.createdAt)
            ) : (
              <Link href={sq(`/p/${post.id}`)} className="hover:text-white/80 hover:underline">
                {relativeTime(post.createdAt)}
              </Link>
            )}
            {/*
              EDITED, from `editedAt` alone.

              Every edit stamps the field — there is no quiet window in which a
              post can change without saying so — so the marker is read straight
              off it rather than diffing anything. It carries a `title` with the
              time, because "edited" without "when" invites the reader to
              wonder whether it changed since THEY read it.
            */}
            {post.editedAt && (
              <span title={`Edited ${relativeTime(post.editedAt)}`}>  •  edited</span>
            )}
          </p>
        </div>
        {/*
          THE HEADER'S CONTROLS — node 496:13389: tip, wink, follow, in that
          order, 8 apart, each centred on the row rather than aligned to a
          shared height. The row exists even when one of them goes quiet, so
          the header's right edge does not shift between posts.

          The wink is the middle one and it is NOT the tip in another colour:
          tipping sends money, winking says you are interested. Both belong to
          slices the feed may not import, so both arrive as slots.
        */}
        {author && (
          <div className="flex shrink-0 items-center gap-2">
            {tipSlot?.(post)}
            {winkSlot?.(author)}
            {followSlot?.(author)}
          </div>
        )}
      </header>

      {/*
        THE RULE UNDER THE HEADER — node 496:13397, a #222222 hairline 18
        below the identity row and 18 above whatever the post is.

        The file draws it 674 wide inside a 681 column, stopping 7 short on the
        right and nowhere else; a rule that misses one end of a symmetric
        column by 1% reads as a mistake rather than a measurement, so it spans
        the content.
      */}
      <hr className="ws-post-rule my-[18px] border-t" />


      {/*
        MEDIA IS UNIFORM — every single photo fills the column at the same 3:2
        frame, `object-cover` (product decision, 2026-09: images at their own
        sizes read as a ragged column). A tall shot is centre-cropped here and
        opens to its true ratio in the immersive viewer, which is where a photo
        needs its own size.

        This replaced the earlier "keeps its own width" rendering (`w-fit`,
        `object-contain`, capped at 420 tall), which drew each image at a
        different size. Video still keeps its own fit for now; the rail handles
        galleries.
      */}
      {compact ? (
        // COMPACT — Home's "Post For You" rail (node 1313:149187) is a VERTICAL
        // card like the timeline's: the media FULL-WIDTH, filling the box so a
        // photo or clip is actually visible, with the caption clamped under it.
        // The old build shrank the media to a 134px side tile, which is what
        // read as "compressed on mobile" — the whole point of the rail is the
        // media, so it takes the height the header, caption and actions leave.
        // The reply field is still dropped (in the actions below): a rail is the
        // wrong place to type a reply, and tapping the card opens the post.
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {post.mediaUrl ? (
            rail.length === 2 ? (
              // TWO PHOTOS — half the box each, side by side (X / Instagram).
              <div className="flex min-h-0 flex-1 gap-1">
                {rail.slice(0, 2).map((media, i) => (
                  <button
                    key={`${media.url}-${i}`}
                    type="button"
                    onClick={onOpenMedia ? () => onOpenMedia(post) : openPost}
                    aria-label="View post"
                    className="ws-press relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded-xl"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown */}
                    <img src={media.url} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : rail.length > 2 ? (
              <MediaRail items={rail} size="compact" />
            ) : isVideoPost(post) ? (
              // A CLIP — its poster fills the box with a play badge; the tap
              // opens the post, where it plays. Autoplaying several clips across
              // a rail fights for attention (and bandwidth), so the preview is a
              // still frame, like every other feed's rail.
              <button
                type="button"
                onClick={onOpenMedia ? () => onOpenMedia(post) : openPost}
                aria-label="Play post"
                className="ws-press relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded-xl bg-black"
              >
                {post.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- service-issued poster
                  <img src={post.thumbnailUrl} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="ws-glass flex h-11 w-11 items-center justify-center rounded-full text-white">
                    <IconReplayPlay className="h-5 w-5" />
                  </span>
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenMedia ? () => onOpenMedia(post) : openPost}
                aria-label="View post"
                className="ws-press relative min-h-0 flex-1 cursor-pointer overflow-hidden rounded-xl"
              >
                {/* FULL-BLEED — a single image fills the rail's whole media box
                    (`object-cover`), the way this card was designed; the tap
                    opens the post at the photo's true ratio. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown */}
                <img
                  src={post.mediaUrl}
                  alt=""
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </button>
            )
          ) : null}
          <div data-post-body onClick={openPost} className="shrink-0 cursor-pointer overflow-hidden">
            {/* With media the caption is a two-line strip beneath it; a
                TEXT-ONLY card reads as a normal post — the words at the top, at
                the timeline's own body size, up to eight lines. */}
            <PostText
              text={post.text}
              mentions={post.mentions}
              className={cn(
                "text-white/90",
                post.mediaUrl
                  ? "text-[13.8px] leading-5.75 line-clamp-2"
                  : "text-[15px] leading-6 line-clamp-8"
              )}
            />
          </div>
        </div>
      ) : rail.length > 1 ? (
        <MediaRail items={rail} />
      ) : post.mediaUrl &&
        (isVideoPost(post) ? (
          // A tap goes FULL SCREEN, the way it does in Reels and TikTok. The
          // inline preview still autoplays muted so the timeline is alive, but
          // the tap is a promotion into the immersive viewer rather than a
          // mute toggle: a clip playing in a card is a thumbnail that happens
          // to move, and that is what "it doesn't feel like a reel" was.
          // Without a handler it stays an inline player, which is what the
          // surfaces that have nowhere to promote to need.
          onOpenMedia ? (
            // A DIV, not a button. The player owns a real sound control, and a
            // button inside a button is invalid markup — which is why the
            // player had to be neutralised with `pointer-events-none`, and why
            // "Tap for sound" expanded the video instead of unmuting it.
            //
            // Now the frame opens the video and the pill toggles sound, each
            // with its own hit area. The keyboard gets an explicit control
            // below rather than a clickable div it cannot reach.
            <div
              onClick={() => onOpenMedia(post)}
              className="ws-press relative block w-fit max-w-full cursor-pointer overflow-hidden rounded-xl"
              style={{ viewTransitionName: `media-${post.id}` }}
            >
              <InlineVideo
                fit
                src={post.mediaUrl}
                poster={post.thumbnailUrl}
                onFirstPlay={() => reportView(post.id)}
              />
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMedia(post);
                }}
                aria-label="Play full screen"
                className="ws-glass ws-press absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-body transition-colors hover:text-white"
              >
                <IconFullscreen className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <InlineVideo
              fit
              src={post.mediaUrl}
              poster={post.thumbnailUrl}
              onFirstPlay={() => reportView(post.id)}
            />
          )
        ) : (
          // FULL-WIDTH, TRUE RATIO — every photo fills the column's whole width
          // and keeps its own aspect (height auto), so the card grows to the
          // image and it is never cropped and never letterboxed: no small,
          // left-aligned shots, and no empty side gaps from a fixed frame. The
          // tap opens the full-screen viewer.
          <Tag
            {...(onOpenMedia
              ? {
                  type: "button" as const,
                  onClick: () => onOpenMedia(post),
                  "aria-label": "View full screen",
                }
              : {})}
            className={cn(
              // Full CONTENT width (inside the card's padding), not bled to the
              // card edges — the image keeps its aspect within this width.
              "block w-full",
              onOpenMedia && "ws-press cursor-pointer"
            )}
            style={{ viewTransitionName: `media-${post.id}` }}
          >
            {framedAspect ? (
              // Known dimensions: the X / Instagram frame — full width at the
              // clamped ratio, the image covering it (whole within range, a
              // minimal centre crop beyond it).
              <div
                // Capped height so a tall (portrait) photo does not run the
                // length of the desktop column — beyond the cap it centre-crops
                // to fill, like X. 420 is the design's own media ceiling
                // (496:13599). On a phone the column is narrow enough that the
                // cap is rarely reached.
                className="max-h-105 w-full overflow-hidden rounded-xl"
                style={{ aspectRatio: framedAspect }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown */}
                <img src={post.mediaUrl} alt="" decoding="async" className="h-full w-full object-cover" />
              </div>
            ) : (
              // No dimensions on the payload: full width at the image's own
              // ratio, but still capped at the 420 ceiling so a tall photo the
              // payload never measured cannot run the whole column — beyond the
              // cap it centre-crops like the framed case above.
              // eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown
              <img src={post.mediaUrl} alt="" decoding="async" className="block max-h-105 w-full rounded-xl object-cover" />
            )}
          </Tag>
        ))}

      {/*
        13.83/22.97 at 90% white — node 496:13414 — sitting 12 under the media.

        With NO media it sits directly under the rule, on the rule's own 18,
        which is what the file's second card does (its caption block starts
        exactly 18 below the hairline, the same distance the media does on the
        first). So the 12 belongs to the media, not to the text.
      */}
      {/* On a trade post the author's words become the receipt card's headline
          below, so the plain caption is not drawn twice. The compact rail draws
          its caption beside the media (above), so this stacked one is off there. */}
      {!compact && !isTrade && (
        <div
          data-post-body
          onClick={full ? undefined : openPost}
          className={cn(!full && "cursor-pointer")}
        >
          <PostText
            text={post.text}
            mentions={post.mentions}
            className={cn(
              "text-[13.8px] leading-[23px] text-white/90",
              // The rail's caption sits 20.72 under the photos, as 1029:22591 draws it.
              rail.length > 1 ? "mt-[20.72px]" : post.mediaUrl && "mt-3"
            )}
            clampLines={full ? undefined : 6}
          />
          {/* A SQUARE LINK IN THE WORDS, drawn as the thing it points at.
              One per post: a post with four links is a post about four things,
              and four previews bury whatever the person actually wrote. */}
          {shared && <SharedLinkCard reference={shared.ref} href={shared.href} />}
        </div>
      )}
      {/* The coins the post names, with today's move — the row Ark draws.
          Off in the compact rail: it is a preview, and the chips, the quote and
          the receipt card all belong on the full post the tap opens. */}
      {!compact && !isTrade && <CoinChips text={post.text} />}

      {!compact && post.quotedPost && <QuotedPost quoted={post.quotedPost} />}

      {/*
        A GIST ROOM POSTED TO THE FEED gets the room's own card rather than the
        generic "Watch" row — nodes 2082:20198 / 20246 / 1356:32947, one card
        whose tail the room's STATUS picks. The post carries only the id, so
        the card reads the room live: a post written while it was scheduled
        shows LIVE when it opens and Ended when it closes, with nothing
        rewritten into the post.
      */}
      {!compact && isRoom && post.deepLink && (
        <div className="mt-3">
          <RoomPostCard streamId={post.deepLink.ref} />
        </div>
      )}

      {!compact && !isRoom && (isTrade ? (
        // The receipt card. Its artwork lives in public/tx-card/ (see the
        // README there) — until those files land it renders as the gradient
        // with the text and the seal animation. Tapping opens the explorer.
        cta?.available ? (
          <a href={cta.href} target="_blank" rel="noreferrer" className="ws-press mt-3 block">
            <TransactionCard
              title={post.text?.trim() || "Transaction"}
              description=""
              handle={atHandle(author?.username) ?? author?.displayName ?? ""}
              avatarUrl={author?.avatarUrl}
              avatarSeed={post.authorId}
              wallet={txWallet}
              timestamp={formatDateTime(post.createdAt)}
            />
          </a>
        ) : (
          <div className="mt-3">
            <TransactionCard
              title={post.text?.trim() || "Transaction"}
              description=""
              handle={atHandle(author?.username) ?? author?.displayName ?? ""}
              avatarUrl={author?.avatarUrl}
              avatarSeed={post.authorId}
              wallet={txWallet}
              timestamp={formatDateTime(post.createdAt)}
            />
          </div>
        )
      ) : cta ? (
        <Link
          href={cta.href}
          target={cta.external ? "_blank" : undefined}
          rel={cta.external ? "noreferrer" : undefined}
          className="ws-hair ws-rail-row mt-3 flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5"
        >
          <span className="truncate text-[13px] font-semibold text-heading">{cta.label}</span>
          <span className="shrink-0 text-[13px] text-accent">Open →</span>
        </Link>
      ) : null)}

      {/* Action row. The design groups it as: a tallies pill, the inline reply
          pill, then share / Arkmark / more standing free at the end. */}
      {/* Tighter on a phone. Both end groups are shrink-0, so at the design's
          spacing the row could not fit a 360px screen and pushed the page
          wider than the viewport. The spacing is the design's from md up. */}
      {/* The reply field takes its OWN ROW on a phone and sits inline from md
          up — and on a phone that row is CLOSED until the comment tally is
          tapped (ogazboiz's call: a second pill under every post was noise;
          the tally is the door). It cannot shrink past its glyph and padding,
          so sharing the tallies' row would push the page wider than the
          screen; its own row, opened on demand, solves the geometry. */}
      {/* 647:16409 aligns its children to the BOTTOM (counter axis MAX): the
          38.37 "more" disc sits on the 40.15 tallies pill's foot, not its middle. */}
      <div
        className={cn(
          "mt-5 flex flex-col gap-3 md:flex-row md:items-end md:gap-6",
          // In the rail the card is a fixed 367: the actions sit on its foot
          // and never get pushed out by a long caption or four photos.
          compact && "mt-auto shrink-0"
        )}
      >
      <div className="flex items-center justify-between gap-3 md:contents">
        {/*
          THE TALLIES PILL — node 496:13417.

          `white/3` at a full round, 40.15 tall, 8.08 of padding, items on a 17
          gap, each a 24px glyph beside its count at 12/16 in white.

          FOUR items now, and the first one is the COMMENT COUNT. The older
          node (236:4725) held three and pushed replies out to the field beside
          it; this file puts the tally back at the head of the row and leaves
          the field as the place you type. Both readings are defensible — the
          count is a fact about the post, the field is an action — and the
          current file settles it, so the count is here and the field keeps the
          placeholder only.

          Tapping it opens the thread, which is the one thing a reply count is
          for. The bar chart at the end is views: something that happened TO
          the post rather than something you can do to it.
        */}
        <div className="ws-action-pill flex h-10 shrink-0 items-center gap-3 px-2 md:gap-[17px]">
          <CountAction
            label="Comments"
            count={post.commentCount}
            hoverClass="group-hover:text-reply"
            onClick={onCommentTally}
          >
            <IconMsComment className="h-6 w-6" />
          </CountAction>
          <RepostMenu
            post={post}
            onRepost={() =>
              gate(() => repost.mutate({ postId: post.id, repost: !post.repostedByMe }))
            }
            onQuote={() => gate(() => onQuote?.(post))}
          />
          {/* Liked is red (--color-like, #e84a4a). It was amber until the
              2026-08-25 design revision moved it off the featured accent —
              all four liked cards in the file changed together. Amber now
              means featured/premium only, and the heart is not that. */}
          <CountAction
            label={post.likedByMe ? "Unlike" : "Like"}
            count={post.likeCount}
            active={post.likedByMe}
            activeClass="text-like"
            hoverClass="group-hover:text-like"
            onClick={() => gate(() => like.mutate({ postId: post.id, like: !post.likedByMe }))}
          >
            <IconMsLike className="h-6 w-6" filled={post.likedByMe} />
          </CountAction>
          {/* Rendered only when the payload carries a count — a confident
              "0 views" on a service that does not count them yet is a lie the
              reader cannot detect. The pill then holds two, which is what the
              file's own geometry allows: its items are hug-width. */}
          {post.viewCount !== undefined && (
            <CountAction
              label={
                video
                  ? `${post.viewCount} ${post.viewCount === 1 ? "play" : "plays"}`
                  : `${post.viewCount} ${post.viewCount === 1 ? "view" : "views"}`
              }
              count={post.viewCount}
            >
              {/* One tally, two meanings. On a clip the slot is PLAYS — the
                  file's own play mark (545:47772) with the number of people
                  who played it — and the chart that means "views" on a post
                  is not drawn beside it. Asked for by name: "just add a count
                  of who played the video". */}
              {video ? <IconReplayPlay className="h-6 w-6" /> : <IconMsChart className="h-6 w-6" />}
            </CountAction>
          )}
        </div>

        {/* `md:order-3` — see the note on the row below. `md:ml-auto` is what
            holds these three against the card's right edge now that the field
            no longer stretches: node 496:13415 is `space-between` over a fixed
            516 of tallies-plus-field and a 115 tail, and an auto margin is the
            same statement for a row whose middle child is capped. */}
        <div className="flex shrink-0 items-center gap-3 md:order-3 md:ml-auto md:gap-[17px]">
          <div className="flex items-center gap-3 md:gap-3">
            <GlyphAction label="Share" hoverClass="hover:text-reply" onClick={share}>
              <IconMsShare className="h-6 w-6" />
            </GlyphAction>
            {/* Arkmark. While the endpoint is absent the control goes quiet
                rather than pretending the save landed. */}
            {/* The glyph, then HOW MANY saved it — a number only, in the
                pill's own 12/16 tally style, drawn only when the payload
                carries `bookmarkCount`. Who saved it is nobody's business but
                theirs; the count is the post's. Asked for by name ("number of
                arkmark, no need to know who"). */}
            {/* A group, so the count takes the purple with the glyph. */}
            <span className="group flex items-center gap-0.5 md:gap-[2px]">
              <GlyphAction
                label={
                  bookmark.unavailable
                    ? "Arkmarks aren't available yet"
                    : post.bookmarkedByMe
                      ? "Remove from Arkmarks"
                      : "Save to Arkmarks"
                }
                active={post.bookmarkedByMe}
                disabled={bookmark.unavailable}
                hoverClass={bookmark.unavailable ? undefined : "group-hover:text-create"}
                onClick={() =>
                  gate(() =>
                    bookmark.mutate({ postId: post.id, bookmark: !post.bookmarkedByMe })
                  )
                }
              >
                <IconMsBookmark className="h-6 w-6" filled={post.bookmarkedByMe} />
              </GlyphAction>
              {post.bookmarkCount !== undefined && (
                <span
                  aria-label={`${post.bookmarkCount} ${post.bookmarkCount === 1 ? "Arkmark" : "Arkmarks"}`}
                  className={cn(
                    "tnum text-[12px] leading-4 text-white transition-colors",
                    !bookmark.unavailable && "group-hover:text-create"
                  )}
                >
                  {formatCount(post.bookmarkCount)}
                </span>
              )}
            </span>
          </div>
          {/* `mine` gates Edit and Delete — the service refuses both for
              anybody but the author, so offering them elsewhere would be a
              control that can only fail. */}
          <ReportMenu post={post} mine={Boolean(me.data && post.authorId === me.data.id)} />
        </div>
      </div>

      {sharing && (
        <ShareSheet
          open
          onClose={() => setSharing(false)}
          payload={{
            text: post.text,
            // Shared as the 22-character short id; `/p/[id]` resolves it back to
            // the UUID, and a link already shared with the UUID keeps working.
            url: `${window.location.origin}${sq(`/p/${sharePostId(post.id)}`)}`,
          }}
        />
      )}

        {/*
          THE FIELD SITS IN THE MIDDLE, AND ORDER IS WHAT PUTS IT THERE.

          Node 236:4723 lays the row out as: tallies pill, 24, comment pill,
          then a wide gap, then share · bookmark · more hard against the right
          edge. The field is second, and it is the thing that stretches.

          It is second on screen but LAST in the DOM, so a keyboard reaches the
          post's actions before a text input it may not want. `md:contents`
          flattens the mobile wrapper into this row on desktop — and `contents`
          preserves DOM order, which is precisely why this needs `order`:
          without it the flatten produced tallies → share/bookmark/more →
          field, putting the actions in the middle and the input at the far
          right. `flex-1` then pushes the action group to the extreme end at
          any card width, which is what the file's fixed 113px gap expresses at
          its one width.
        */}
        {/* Inline "Comment here…" input is OFF for now (per request) — readers
            reply through the comment tally / the comments sheet. Kept wired
            behind a `false` guard so it can be switched back on in one edit. */}
        {false && !compact && (
          <InlineComment
            postId={post.id}
            onOpenThread={() => setCommentsOpen(true)}
            revealed={replyOpen}
            rootRef={inlineRef}
            // Hidden on a phone until the tally reveals it; the file's row from md.
            className={cn("md:order-2", !replyOpen && "hidden md:flex")}
          />
        )}
      </div>

      <CommentsSheet postId={post.id} open={commentsOpen} onClose={() => setCommentsOpen(false)} />
    </article>
  );
}

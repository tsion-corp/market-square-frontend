"use client";

import Link from "next/link";
import { profileHref } from "@/lib/profile-href";
import { toast } from "sonner";
import { TransitionLink } from "@/components/ui/transition-link";
import { formatDateTime, formatKash, formatCount, relativeTime } from "@/lib/format";
import { resolveCta } from "@/lib/deeplink";
import { Avatar } from "@/components/ui/avatar";
import { LiveBadge, Pill, VerifiedBadge } from "@/components/ui/badge";
import { GradientThumb } from "@/components/ui/gradient-thumb";
import { IconCalendar, IconEye, IconLive, IconPlay, IconShare } from "@/components/ui/icons";
import type { FeedItem, FeedStream, Post } from "@/features/feed/lib/types";
import type { Profile } from "@/lib/api/schemas";
import { PostCard } from "@/features/feed/components/post-card";
import { MARKET_FLAGS } from "@/lib/market-config";
import { sq } from "@/lib/square-path";

export function pricePillLabel(stream: FeedStream): string {
  if (stream.ticketPriceKash) return formatKash(stream.ticketPriceKash);
  if (MARKET_FLAGS.vipAccess && stream.vipPriceKash) return `Free · VIP ${formatKash(stream.vipPriceKash)}`;
  return "Free";
}

// Streams enter the timeline the way X renders a rich link: a normal author
// row, then one bordered media block that owns the click.
function StreamFeedCard({ stream }: { stream: FeedStream }) {
  const owner = stream.owner;
  const reshare = async () => {
    const url = `${window.location.origin}${sq(`/live/${stream.id}`)}`;
    try {
      if (navigator.share) await navigator.share({ title: stream.title, text: `Watch ${stream.title} live on Square`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Live stream link copied");
      }
    } catch {
      // The native share sheet was dismissed.
    }
  };
  return (
    <article className="ws-post p-3">
      <header className="flex items-center gap-2.5 px-1">
        {owner ? (
          <TransitionLink href={profileHref(owner)} prefetch={false} className="shrink-0">
            <Avatar name={owner.displayName} seed={owner.id} src={owner.avatarUrl} size={36} />
          </TransitionLink>
        ) : (
          <span className="ws-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent">
            <IconLive className="h-4.5 w-4.5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
            {owner ? (
              <>
                <Link
                  href={profileHref(owner)} prefetch={false}
                  className="truncate text-[14px] font-bold text-heading hover:underline"
                >
                  {owner.displayName}
                </Link>
                <VerifiedBadge verification={owner.verification} className="h-3.5 w-3.5" />
              </>
            ) : (
              <span className="text-[14px] font-bold text-heading">
                {stream.status === "live" ? "Live on the square" : "Scheduled on the square"}
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-meta">
            {owner ? `@${owner.username} · ` : ""}
            {stream.status === "live" ? "is live now" : "is scheduled"}
          </p>
        </div>
        {stream.status === "live" && <LiveBadge className="shrink-0 px-2 py-0 text-[9px]" />}
      </header>

      <div className="min-w-0">
        <p className="mt-3 px-1 text-[13px] leading-relaxed text-body">{stream.title}</p>

        <TransitionLink
          href={sq(`/live/${stream.id}?source=feed:stream:${stream.id}`)}
          className="ws-hair group mt-3 block overflow-hidden rounded-2xl border transition-colors hover:bg-white/4"
        >
          <GradientThumb
            seed={stream.id}
            className="aspect-[16/9] w-full"
            style={{ viewTransitionName: `stream-${stream.id}` }}
          >
            {stream.status !== "live" && (
              <div className="absolute left-3 top-3 flex items-center gap-2">
                <Pill>
                  <IconCalendar className="h-3 w-3" />
                  {stream.scheduledAt ? formatDateTime(stream.scheduledAt) : "Scheduled"}
                </Pill>
              </div>
            )}
            <div className="absolute bottom-3 right-3">
              <Pill tone="accent">{pricePillLabel(stream)}</Pill>
            </div>
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="ws-glass flex h-14 w-14 items-center justify-center rounded-full transition-transform group-hover:scale-105">
                <IconPlay className="ml-0.5 h-6 w-6 text-white" />
              </span>
            </span>
          </GradientThumb>
          <div className="flex items-center gap-2 px-3.5 py-2.5 text-xs text-meta">
            <span className="truncate font-semibold text-body">{stream.title}</span>
            {stream.category && <span className="shrink-0">· {stream.category}</span>}
            {/* The feed's stream payload carries PEAK viewers only — the live
                count is detail-only — so the number is labelled for what it
                is rather than passed off as "now watching". */}
            {stream.peakViewers > 0 && (
              <span
                className="tnum ml-auto flex shrink-0 items-center gap-1"
                title="Peak viewers for this stream"
              >
                <IconEye className="h-3.5 w-3.5" /> peak {formatCount(stream.peakViewers)}
              </span>
            )}
          </div>
        </TransitionLink>
        <div className="mt-3 flex items-center gap-3 px-1">
          <TransitionLink
            href={sq(`/live/${stream.id}?source=feed:stream:${stream.id}`)}
            className="ws-press rounded-full bg-accent px-4 py-1.5 text-[12px] font-bold text-ink transition-colors hover:bg-white"
          >
            {stream.status === "live" ? "Watch live" : "View session"}
          </TransitionLink>
          <button
            onClick={() => void reshare()}
            className="ws-action ml-auto text-[13px] text-meta hover:text-heading"
            aria-label="Reshare live"
          >
            <IconShare className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function FeedItemCard({
  item,
  followSlot,
  winkSlot,
  tipSlot,
  onOpenMedia,
  onOpenPost,
  onQuote,
  compact = false,
}: {
  item: FeedItem;
  /** Drop the inline reply field — for a card in a rail. See PostCard. */
  compact?: boolean;
  followSlot?: (author: Profile) => React.ReactNode;
  winkSlot?: (author: Profile) => React.ReactNode;
  /** Composed from outside the slice — the tip control lives in the tips
   *  slice and takes the POST, since a tip goes to `/posts/:id/tips`. */
  tipSlot?: (post: Post) => React.ReactNode;
  /** Promotes a video card into the full-screen viewer. */
  onOpenMedia?: (post: Post) => void;
  /** Overrides where tapping the card goes (see PostCard). */
  onOpenPost?: (post: Post) => void;
  onQuote?: (post: Post) => void;
}) {
  if (item.type === "post" && item.post)
    return (
      <PostCard
        post={item.post}
        repostedBy={item.repostedBy}
        followSlot={followSlot}
        winkSlot={winkSlot}
        onOpenMedia={onOpenMedia}
        onOpenPost={onOpenPost}
        tipSlot={tipSlot}
        onQuote={onQuote}
        compact={compact}
      />
    );
  if (item.type === "stream" && item.stream) return <StreamFeedCard stream={item.stream} />;

  if (item.type === "activity" && item.activity) {
    const activity = item.activity;
    const cta = resolveCta(activity.deepLink, `feed:activity:${activity.id}`);
    return (
      <article className="ws-post flex items-center gap-3 p-3">
        <span className="ws-inset flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-body">
          <IconCalendar className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="ws-meta text-[10px]">Activity</p>
          <p className="mt-0.5 truncate text-[15px] font-bold text-heading">{activity.title}</p>
          <p className="text-sm text-meta">
            {activity.owner ? `${activity.owner.displayName} · ` : ""}
            {formatDateTime(activity.startsAt)}
          </p>
        </div>
        {cta && (
          <Link
            href={cta.href}
            target={cta.external ? "_blank" : undefined}
            rel={cta.external ? "noreferrer" : undefined}
            className="ws-press shrink-0 self-center rounded-full border border-white/20 px-4 py-1.5 text-sm font-bold text-body transition-colors hover:bg-white/10"
          >
            {cta.label}
          </Link>
        )}
      </article>
    );
  }

  if (item.type === "platform_event" && item.platformEvent) {
    const event = item.platformEvent;
    const cta = resolveCta(item.deepLink, `feed:platform:${event.id}`);
    return (
      <article className="ws-post flex gap-3 p-3">
        <span className="ws-display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-base text-ink">
          W
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span className="text-[15px] font-bold text-heading">WorldStreet</span>
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-ink">
              ✓
            </span>
            <span className="text-[15px] text-meta">· {relativeTime(event.occurredAt)}</span>
          </div>
          <p className="mt-0.5 text-[15px] font-semibold leading-normal text-heading">{event.title}</p>
          {event.body && <p className="mt-0.5 text-[15px] leading-normal text-body">{event.body}</p>}
          {cta && (
            <Link href={cta.href} className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">
              {cta.label} →
            </Link>
          )}
        </div>
      </article>
    );
  }

  return null;
}

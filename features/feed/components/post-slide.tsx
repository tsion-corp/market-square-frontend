"use client";

import { useEffect, useRef, useState } from "react";
import { profileHref } from "@/lib/profile-href";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatCount, relativeTime } from "@/lib/format";
import { resolveCta } from "@/lib/deeplink";
import { isVideoPost } from "@/lib/media";
import type { VideoItem } from "@/lib/video-context";
import { VIDEO_LAYER, type VideoLayer } from "@/lib/video-coordinator";
import { useGate } from "@/hooks/use-gate";
import { useActiveVideo } from "@/hooks/use-active-video";
import { Avatar } from "@/components/ui/avatar";
import { MediaFrame } from "@/components/ui/media-frame";
import { PostText } from "@/components/ui/post-text";
import { VerifiedBadge } from "@/components/ui/badge";
import { IconComment, IconHeart, IconVolume } from "@/components/ui/icons";
import { useLikePost } from "@/features/feed/hooks/use-feed";
import { useRecordView } from "@/features/feed/hooks/use-record-view";
import { CommentsSheet } from "@/features/feed/components/comments-sheet";

const DOUBLE_TAP_MS = 300;

/**
 * One full-viewport slide in a vertical snap feed.
 *
 * This is the single implementation of the pattern: Explore's reels feed and
 * its full-screen video viewer both render it, so a clip behaves identically in
 * both places rather than drifting into two players.
 *
 * Playback grammar, and it is now literally the same code `InlineVideo` runs
 * in the timeline rather than a second copy of the same idea: `useActiveVideo`
 * reports how much of the slide is on screen, ONE coordinator elects the
 * single video allowed to play anywhere in the app, and everything else is
 * paused and silent. Under `prefers-reduced-motion` nothing plays on its own
 * and the element keeps its native controls.
 *
 * Two bugs died in that swap, and they are the two halves of the same report.
 *
 * SOUND DID NOT CARRY. This slide owned a private `muted` boolean and forced
 * it back to `true` whenever the slide left the viewport — so swiping to the
 * next reel always landed in silence, however many times the reader had asked
 * for sound. That is "when going to next video or post it still mute", and the
 * earlier fix never reached it: it changed `InlineVideo` and left this file,
 * which is the player the full-screen viewer actually uses, untouched.
 *
 * TWO VIDEOS PLAYED AT ONCE. The viewer is `fixed inset-0` over a timeline
 * that stays mounted, and an IntersectionObserver cannot see occlusion: the
 * card underneath reported itself fully visible and kept playing behind the
 * slide. Hence the layer — the viewer says it is on top, because geometry
 * cannot.
 */
export function PostSlide({
  post,
  /**
   * Morph target for the View Transition that carried the tapped card into
   * this slide. Only ever set on the slide the reader opened, and only while
   * the transition is running — two elements sharing one name aborts it.
   */
  viewTransitionName,
  /**
   * Which surface this slide is mounted on. The reels column sits IN the page
   * beside other players; the full-screen viewer sits OVER them. Defaulting to
   * the in-page layer keeps the claim honest: only the viewer, which knows it
   * covers everything, passes the overlay layer.
   */
  layer = VIDEO_LAYER.feed,
  /**
   * The snap SCROLL CONTAINER this slide lives in, so playback is measured
   * against it rather than the viewport — a clip scrolled out of the container
   * must read as 0% and stop. See `useActiveVideo`'s `rootRef`.
   */
  scrollRootRef,
}: {
  post: VideoItem;
  viewTransitionName?: string;
  layer?: VideoLayer;
  scrollRootRef?: React.RefObject<Element | null>;
}) {
  const like = useLikePost();
  const gate = useGate();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [burst, setBurst] = useState(0);
  const [captionOpen, setCaptionOpen] = useState(false);
  // Playback position, read off the element itself. A timer would drift from
  // the video the moment it buffers, and a scrubbed reel would then show a
  // position it is not at.
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);
  // A reel fills the screen, so time on screen is a real watch.
  const viewRef = useRecordView(post.id);
  const lastTap = useRef(0);
  const hasVideo = isVideoPost(post);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Registers unconditionally, even on a text post that renders no <video>:
  // the ref simply never attaches, the effect sees no element and does
  // nothing. Calling it conditionally would be a hook behind an `if`.
  const {
    ref: videoRef,
    muted,
    toggleSound,
  } = useActiveVideo({ layer, enabled: hasVideo && !reduced, rootRef: scrollRootRef });

  // Seek by fraction. Clamped, and guarded on a duration: before metadata
  // arrives `duration` is NaN and seeking would throw.
  const seekTo = (fraction: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.min(Math.max(fraction, 0), 1) * video.duration;
  };

  const doLike = () => gate(() => like.mutate({ postId: post.id, like: !post.likedByMe }));

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      setBurst((n) => n + 1);
      if (!post.likedByMe) gate(() => like.mutate({ postId: post.id, like: true }));
    } else {
      lastTap.current = now;
      // Sound only on an explicit tap — never autoplayed. The answer is the
      // SESSION's now, so the next reel you swipe to keeps it instead of
      // asking again.
      if (hasVideo) toggleSound();
    }
  };

  const cta = resolveCta(post.deepLink);
  const author = post.author;

  return (
    <section
      ref={viewRef}
      // h-full, not h-dvh: the slide fills its SCROLL CONTAINER. That is the
      // same thing in the full-screen viewer, and it is what lets the reels
      // feed sit inside Explore's column on desktop without hanging off the
      // bottom of the page.
      className="ws-snap-item relative flex h-full w-full flex-col justify-center overflow-hidden"
      style={viewTransitionName ? { viewTransitionName } : undefined}
    >
      {/* content stage: media fills the slide; text posts stay typographic. */}
      {post.mediaUrl && (
        // Contained, never cropped — see MediaFrame. A wide photo used to lose
        // its sides to `object-cover`, which is how a scoreboard arrived as a
        // single cropped digit and a caption lost its first and last words.
        <MediaFrame
          backdrop={hasVideo ? post.thumbnailUrl : post.mediaUrl}
          className="absolute inset-0"
        >
          {hasVideo ? (
            <video
              ref={videoRef}
              src={post.mediaUrl}
              poster={post.thumbnailUrl ?? undefined}
              muted={muted}
              loop
              playsInline
              preload="metadata"
              controls={reduced}
              onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (Number.isFinite(video.duration) && video.duration > 0) {
                  setProgress(video.currentTime / video.duration);
                }
              }}
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- author-supplied media
            <img
              src={post.mediaUrl}
              alt=""
              decoding="async"
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </MediaFrame>
      )}
      {/* Reduced motion keeps the native controls usable, so no tap layer. */}
      {!reduced && (
        <button className="absolute inset-0 cursor-default" onClick={onTap} aria-label="Post" />
      )}
      {/* Sound is a CONTROL, not a hint. "Tap for sound" told people the state
          and then vanished, so a reader arriving mid-feed had no way to know
          whether a silent clip was muted or simply quiet, and no way to mute
          one that was loud. This stays put, shows the current state, and is
          reachable without knowing that tapping the video does anything.

          Top-left, clear of the viewer's own close button on the right. */}
      {hasVideo && !reduced && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggleSound();
          }}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={!muted}
          className="ws-glass ws-press absolute left-4 top-14 z-10 flex h-10 w-10 items-center justify-center rounded-full text-heading"
        >
          <IconVolume className="h-5 w-5" muted={muted} />
        </button>
      )}
      {/* A TEXT-ONLY post has nothing to look at, so the words are the subject
          and they sit centred at display size. A post WITH media is a reel, and
          its caption belongs bottom-left under the identity: see the caption
          block below. Centring a caption over a video puts it across the face
          of the thing it describes, which is why this slide did not read like
          a reel. */}
      {post.text && !post.mediaUrl && (
        <div
          className="pointer-events-none px-6"
          style={{ paddingBottom: "calc(var(--ws-nav-h) + 96px)" }}
        >
          <p className="ws-display text-2xl leading-snug">{post.text}</p>
        </div>
      )}

      {/* double-tap heart burst */}
      {burst > 0 && (
        <span
          key={burst}
          className="ws-heart-burst pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-like"
          aria-hidden
        >
          <IconHeart className="h-24 w-24" filled />
        </span>
      )}

      {/* bottom scrim: author + caption meta */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/85 to-transparent" />
      {/* Author and actions are two SEPARATE blocks, because they clear two
          different obstacles: the author row only has to sit above the tab
          bar, while the action rail shares the right edge with the create
          button and has to start above its hit frame. As one flex row with a
          single `pb-28` the rail landed underneath the button, which hid the
          comment control completely and clipped the like tally. */}
      <div
        className="absolute inset-x-0 flex items-end px-4"
        style={{ bottom: "calc(var(--ws-nav-h) + 16px)" }}
      >
        <div className="min-w-0 flex-1 pr-20">
          {author && (
            <Link
              href={profileHref(author)} prefetch={false}
              className="pointer-events-auto flex items-center gap-2"
            >
              <Avatar
                name={author.displayName}
                seed={author.id}
                src={author.avatarUrl}
                size={36}
              />
              <span className="ws-text-shadow flex items-center gap-1.5 text-sm font-semibold text-heading">
                {author.displayName}
                <VerifiedBadge verification={author.verification} />
              </span>
              <span className="ws-text-shadow text-xs text-meta">
                {relativeTime(post.createdAt)}
              </span>
            </Link>
          )}
          {/* Caption. Two lines then "more", which is where TikTok and Reels
              both land: long enough to carry a hook, short enough that the
              video stays the subject. Expanding scrolls in place rather than
              growing without limit, so a 2,000-character caption cannot push
              the identity row off the screen.

              It is a button, not a link: expanding must not navigate, and on a
              slide where a single tap toggles sound the caption has to stop
              that tap from reaching the tap layer underneath. */}
          {post.text && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setCaptionOpen((open) => !open);
              }}
              aria-expanded={captionOpen}
              className="pointer-events-auto mt-2 block w-full text-left"
            >
              <PostText
                text={post.text}
                mentions={post.mentions}
                className={cn(
                  "ws-text-shadow text-[13px] leading-[18px] text-white/95",
                  captionOpen ? "max-h-[38dvh] overflow-y-auto" : "line-clamp-2"
                )}
              />
              {/* Only offered when there is more to see. A "more" that reveals
                  nothing teaches people to ignore it. */}
              {post.text.length > 90 && (
                <span className="ws-text-shadow mt-0.5 inline-block text-[13px] font-semibold text-white/60">
                  {captionOpen ? "less" : "more"}
                </span>
              )}
            </button>
          )}
          {cta && (
            <Link
              href={cta.href}
              target={cta.external ? "_blank" : undefined}
              rel={cta.external ? "noreferrer" : undefined}
              className="ws-press pointer-events-auto mt-3 inline-flex h-9 items-center rounded-full bg-accent px-4 text-sm font-semibold text-ink"
            >
              {cta.label}
            </Link>
          )}
        </div>
      </div>

      {/* right action rail */}
      <div
        className="pointer-events-auto absolute right-4 flex flex-col items-center gap-4"
        style={{ bottom: "var(--ws-fab-clearance)" }}
      >
        <button
          onClick={doLike}
          aria-label={post.likedByMe ? "Unlike" : "Like"}
          className="ws-press flex flex-col items-center gap-0.5"
        >
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full bg-black/40",
              post.likedByMe ? "text-like" : "text-heading"
            )}
          >
            <IconHeart className="h-5 w-5" filled={post.likedByMe} />
          </span>
          {/* A payload without the tally renders no number rather than a
              fabricated zero. */}
          {post.likeCount !== undefined && (
            <span className="tnum ws-text-shadow text-xs text-body">
              {formatCount(post.likeCount)}
            </span>
          )}
        </button>
        <button
          onClick={() => setCommentsOpen(true)}
          aria-label="Comments"
          className="ws-press flex flex-col items-center gap-0.5"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-heading">
            <IconComment className="h-5 w-5" />
          </span>
          {post.commentCount !== undefined && (
            <span className="tnum ws-text-shadow text-xs text-body">
              {formatCount(post.commentCount)}
            </span>
          )}
      </button>
    </div>
      {/* Scrubber. A slim rail that sits under the furniture rather than a
          control bar over the clip: a reel is watched, and a full player chrome
          would compete with the thing it is playing. The hit area is 24px tall
          while the rail is 3px, because a 3px target on a phone is unusable.

          Range input rather than a div with pointer maths: it is draggable,
          keyboard-operable and announced correctly for free, and none of that
          is worth reimplementing badly. */}
      {hasVideo && !reduced && (
        <div
          className="absolute inset-x-0 z-10 flex h-6 items-center px-4"
          style={{ bottom: "var(--ws-nav-h)" }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="relative h-[3px] w-full rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              onChange={(event) => seekTo(Number(event.target.value) / 1000)}
              aria-label="Seek"
              className="absolute inset-x-0 -top-3 h-6 w-full cursor-pointer opacity-0"
            />
          </div>
        </div>
      )}

      <CommentsSheet postId={post.id} open={commentsOpen} onClose={() => setCommentsOpen(false)} />
    </section>
  );
}

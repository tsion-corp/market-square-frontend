"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { nextVideoIndex, type VideoItem } from "@/lib/video-context";
import { Spinner } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";
import { PostSlide } from "@/features/feed/components/post-slide";
import { VIDEO_LAYER } from "@/lib/video-coordinator";

/**
 * The immersive video viewer — the X/Twitter pattern.
 *
 * Tapping a video card opens this over the grid, and scrolling moves through
 * the OTHER videos in the same selection. It is deliberately DATA-FREE: the
 * caller hands it the list and the pager, which is what lets one viewer serve
 * both Explore's topic grid and a search result set without the feed slice
 * reaching into discovery's. It is also what makes the pagination continuous —
 * `fetchNextPage` here is the grid's own, so scrolling past the loaded page
 * fetches exactly what the grid would have fetched.
 *
 * It renders as an OVERLAY rather than a route, so the grid underneath keeps
 * its scroll position for the close.
 *
 * LIVE streams are not in this list by construction: a live card goes to
 * `/live/:id`, which is a room with chat, tickets and a stage — not a slide.
 */
export function VideoViewer({
  items,
  activeId,
  onActiveChange,
  onClose,
  hasNextPage = false,
  isFetchingNextPage = false,
  fetchNextPage,
  /**
   * Names the slide for the View Transition. It follows the ACTIVE slide, not
   * the one first opened: closing has to morph back into the card the reader
   * actually scrolled to, and that is only the opened one on the first slide.
   */
  morphNameFor,
}: {
  items: VideoItem[];
  activeId: string;
  onActiveChange: (id: string) => void;
  onClose: () => void;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: () => void;
  morphNameFor?: (videoId: string) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef(new Map<string, HTMLDivElement>());
  // The slide the reader OPENED, fixed for the life of the overlay — this is
  // the anchor the initial scroll jumps to, and nothing else.
  const openedId = useRef(activeId);

  const index = useMemo(
    () => Math.max(0, items.findIndex((item) => item.id === activeId)),
    [items, activeId]
  );

  // Jump straight to the tapped video — without this, a deep link or a tap on
  // the fourth card would start the reader at the first one. It waits for the
  // list to actually contain the video (a deep link arrives before the page
  // does) and then fires exactly once; afterwards the scroll is the reader's.
  const didAnchor = useRef(false);
  useEffect(() => {
    if (didAnchor.current) return;
    const node = slideRefs.current.get(openedId.current);
    if (!node) return;
    node.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
    didAnchor.current = true;
  }, [items]);

  // The page behind must not scroll while the overlay owns the viewport.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Which slide is on screen IS the active video — driven by the scroll, so a
  // swipe, an arrow key and a deep link all converge on one source of truth.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.videoId;
          if (id) onActiveChange(id);
        }
      },
      { root, threshold: 0.6 }
    );
    for (const node of slideRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [items, onActiveChange]);

  const goTo = useCallback(
    (delta: number) => {
      const target = items[nextVideoIndex(index, delta, items.length)];
      if (!target) return;
      slideRefs.current.get(target.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
      // Running off the loaded end is the cue to page, exactly as the grid's
      // sentinel would.
      if (delta > 0 && index >= items.length - 2 && hasNextPage && !isFetchingNextPage) {
        fetchNextPage?.();
      }
    },
    [items, index, hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  // Desktop: arrows move, Escape closes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        goTo(1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [goTo, onClose]);

  // Scrolling to the end of the loaded pages asks for the next one.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    const root = scrollRef.current;
    if (!node || !root || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) fetchNextPage?.();
      },
      { root, rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video viewer"
      className="fixed inset-0 z-[60] bg-black"
    >
      <button
        onClick={onClose}
        aria-label="Close video"
        className="ws-glass ws-press absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full text-heading"
      >
        <IconX className="h-4 w-4" />
      </button>

      <div
        ref={scrollRef}
        className={cn("ws-snap-feed h-dvh w-full snap-y snap-mandatory overflow-y-auto")}
      >
        {items.map((item) => (
          <div
            key={item.id}
            data-video-id={item.id}
            // h-full is REQUIRED, not decoration. PostSlide sizes itself with
            // h-full so it can fill a column in Explore's reels, and a
            // percentage height against an auto-height parent computes to
            // auto. Everything inside the slide is absolutely positioned, so
            // the content height is 0 and every slide collapses: the viewer
            // renders as a black screen with nothing but the close button.
            className="h-full"
            ref={(node) => {
              if (node) slideRefs.current.set(item.id, node);
              else slideRefs.current.delete(item.id);
            }}
          >
            <PostSlide
              post={item}
              viewTransitionName={item.id === activeId ? morphNameFor?.(item.id) : undefined}
              // This viewer is `fixed inset-0` over a timeline that stays
              // mounted, and an IntersectionObserver measures geometry, not
              // what is painted on top of it: the card underneath reports
              // itself fully visible and would keep playing behind the slide.
              // Occlusion is not observable, so the surface that knows it
              // covers everything says so.
              layer={VIDEO_LAYER.overlay}
              // Measure playback against THIS scroll container, not the
              // viewport — otherwise a reel scrolled out of the snap feed keeps
              // reporting itself visible and keeps playing (the same root the
              // active-slide observer above uses).
              scrollRootRef={scrollRef}
            />
          </div>
        ))}
        <div ref={sentinelRef} />
        {isFetchingNextPage && (
          <div className="flex h-24 items-center justify-center">
            <Spinner className="h-5 w-5 text-grey-600" />
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { profileHref } from "@/lib/profile-href";
import { isStoryVideoMedia, storyCover } from "@/lib/story-cover";
import {
  advanceRatio,
  clipDurationMs,
  hasOverrun,
  isAutoplayRefusal,
  isHeld,
  mediaToSilence,
  nextPosition,
  previousPosition,
  storyDurationMs,
  type StoryPosition,
} from "@/lib/story-playback";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { storyFontClass } from "@/lib/story-style";
import { relativeTime } from "@/lib/format";
import { resolveCta } from "@/lib/deeplink";
import { Avatar } from "@/components/ui/avatar";
import { GradientThumb } from "@/components/ui/gradient-thumb";
import { StoryCreator } from "@/features/feed/components/story-creator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconVolume,
  IconX,
} from "@/components/ui/icons";
import { useMe } from "@/hooks/use-me";
import { isHouse } from "@/features/houses/lib/house";
import { useFeed, useStories } from "@/features/feed/hooks/use-feed";
import { reportView } from "@/features/feed/hooks/use-record-view";
import { useStoryViewers } from "@/features/feed/hooks/use-story-viewers";
import { StoryViewersPanel } from "@/features/feed/components/story-viewers";
import { seenByLabel } from "@/lib/story-viewers";
import type { FeedItem, Post } from "@/features/feed/lib/types";
import { sq } from "@/lib/square-path";

/**
 * Everything the frame can put keyboard focus on, for the dialog's focus trap.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])';

const SEEN_KEY = "ms.stories.seen";

/** One author's stories, oldest first — the unit Instagram opens on a tap. */
interface StoryGroup {
  /** The author's Privy DID. Seeded artwork hashes on this everywhere else in
      the app, so dropping it here made the same person draw a different
      illustration in the rail than in the feed or on their profile. Group and
      seed on the id; the username is for links and labels only. */
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  stories: Post[];
}

/**
 * A live broadcast in the strip.
 *
 * Live is a different object from a story: it opens the room, never the
 * 5-second viewer, and it has no seen/unseen state — it is live or it is not
 * in the strip at all. Keeping it in its own type is what stops the two from
 * being handled interchangeably.
 */
interface LiveEntry {
  /** Stream id — the room to open. */
  id: string;
  /** Host's Privy DID; artwork seeds on this like everywhere else. */
  hostId: string;
  displayName: string;
  avatarUrl: string | null;
  title: string;
  thumbnailUrl: string | null;
}

/**
 * Live entries out of the `live` feed lane.
 *
 * The lane also carries scheduled activities and streams that have not started,
 * so the status filter is load-bearing: scheduled is NOT live, and inventing a
 * LIVE marker for one would be a lie the design never asked for. Deduped by
 * stream id because a lane page can repeat a stream across cursors.
 */
function toLiveEntries(items: FeedItem[]): LiveEntry[] {
  const seenIds = new Set<string>();
  const live: LiveEntry[] = [];
  for (const item of items) {
    const stream = item.stream;
    if (!stream || stream.status !== "live") continue;
    /*
      A HOUSE IS NOT A BROADCAST, and it must never appear here.

      This rail collected every live stream and drew it with a red Live pill,
      then `liveHref` sent it to `/live/:id`. A house went in with the rest —
      so the flagship feature had a second front door, wearing a broadcast
      badge, that opened the video room: a player, a viewer count, a paid gift
      tray, and a header reading HOUSE above a loading video.

      The hallway at the top of Home is where a house belongs, and it is
      already there. Excluded here rather than re-routed, because a house in a
      rail of red Live pills is still telling the reader it is a broadcast.
    */
    if (isHouse(stream)) continue;
    if (seenIds.has(stream.id)) continue;
    seenIds.add(stream.id);
    live.push({
      id: stream.id,
      // `owner` is not always hydrated on list payloads, so the seed falls back
      // to ownerId — still the DID, so the illustration stays consistent.
      hostId: stream.owner?.id ?? stream.ownerId,
      displayName: stream.owner?.displayName ?? stream.title,
      avatarUrl: stream.owner?.avatarUrl ?? null,
      title: stream.title,
      thumbnailUrl: stream.thumbnailUrl,
    });
  }
  return live;
}

// Seen state has no backend field, so it lives per-browser, read through an
// external store: the server snapshot is empty, so the first client render
// matches the served HTML and the real value lands right after hydration.
// Every access is guarded — a private window or blocked site data throws.
const EMPTY_SEEN: ReadonlySet<string> = new Set();
const seenListeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSeen: ReadonlySet<string> = EMPTY_SEEN;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

// Must return a stable reference while the underlying string is unchanged,
// or useSyncExternalStore re-renders forever.
function getSeenSnapshot(): ReadonlySet<string> {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedSeen = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      cachedSeen = EMPTY_SEEN;
    }
  }
  return cachedSeen;
}

function getSeenServerSnapshot(): ReadonlySet<string> {
  return EMPTY_SEEN;
}

function subscribeSeen(onChange: () => void) {
  seenListeners.add(onChange);
  return () => {
    seenListeners.delete(onChange);
  };
}

function markStorySeen(storyId: string) {
  const current = getSeenSnapshot();
  if (current.has(storyId)) return;
  const next = new Set(current).add(storyId);
  const raw = JSON.stringify([...next].slice(-400));
  try {
    window.localStorage.setItem(SEEN_KEY, raw);
  } catch {
    /* storage unavailable — the ring simply stays bright */
  }
  cachedRaw = raw;
  cachedSeen = next;
  for (const listener of seenListeners) listener();
}

function groupByAuthor(posts: Post[]): StoryGroup[] {
  const groups = new Map<string, StoryGroup>();
  for (const post of posts) {
    const author = post.author;
    if (!author) continue;
    const existing = groups.get(author.id);
    if (existing) existing.stories.push(post);
    else
      groups.set(author.id, {
        id: author.id,
        username: author.username,
        displayName: author.displayName,
        avatarUrl: author.avatarUrl,
        stories: [post],
      });
  }
  // Oldest first inside a group: a tap replays the author's day in order.
  for (const group of groups.values()) {
    group.stories.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return [...groups.values()];
}

/**
 * Where a live tile goes.
 *
 * A host tapping their own broadcast wants the control surface, not a seat in
 * their own audience — so their tile points at the studio. "Your Story" is left
 * alone either way: it is the compose affordance, and turning it into a live
 * tile would delete the only way to post a story.
 */
function liveHref(entry: LiveEntry, meId?: string): string {
  return entry.hostId && entry.hostId === meId
    ? sq(`/studio/${entry.id}`)
    : sq(`/live/${entry.id}?source=home:stories`);
}

/*
 * ORDERING — the server ranks stories, the client does not re-sort them.
 *
 * `GET /stories?scope=all` returns a deliberate ranking: the viewer's own
 * stories, then people they follow, then everyone else, each band newest-first.
 * An earlier version sorted unseen-before-seen across the whole list, which
 * flattened those bands — a stranger's unseen story would jump ahead of a
 * friend's unseen story, which is worse relevance, not better.
 *
 * Sorting unseen-first *within* each band is not possible either: the payload
 * carries no band marker, so the boundaries cannot be reconstructed client-side
 * without guessing. So the rail defers to the server order entirely. Seen state
 * still drives the RING (silver vs drained), it just no longer moves tiles —
 * which also stops the rail reshuffling under the viewer as they watch.
 *
 * Live entries are exempt: they lead the rail, from a separate list, so they
 * are never mixed into the story sequence the viewer plays through.
 */

/** The strip's LIVE marker: the design's solid #ff0b0b pill, white bold label,
    centred on the tile's bottom edge and overhanging it by a pixel. */
function LivePill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute left-1/2 flex h-3 -translate-x-1/2 items-center justify-center rounded-full bg-live px-2 text-[8px] font-bold leading-3 text-white",
        className
      )}
    >
      Live
    </span>
  );
}


/**
 * The artwork on a strip tile — and what happens when it will not load.
 *
 * A VIDEO cover renders as `<video>`, never `<img>`: the browser cannot decode
 * a clip in an image element and paints its broken-image glyph instead, which
 * is what made every video-first story in the rail look like a failed upload
 * while it played perfectly when opened.
 *
 * `#t=0.1` asks for a frame a tenth of a second in. Without it Safari and iOS
 * show an empty black box until the element is played, and many clips open on
 * a black frame anyway — this is the difference between a real thumbnail and a
 * dark rectangle.
 *
 * And when the media fails for any other reason — a dead CDN link, an expired
 * signature — the element removes ITSELF rather than leaving the browser's
 * broken glyph on screen. The seeded `GradientThumb` is already painted
 * underneath, so what the reader sees is the author's own artwork rather than
 * an error icon. A tile is decoration; it should never be the thing that looks
 * broken.
 */
function TileMedia({ url, video }: { url: string; video: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  if (video) {
    return (
      <video
        src={`${url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        aria-hidden
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/**
 * Portrait live tile — the desktop strip's broadcast entry.
 *
 * Same 80×80 footprint as a story card so the row stays on one rhythm, but the
 * silver ring/black-gap sandwich is replaced by the design's red ring drawn
 * straight on the tile edge, and it renders as a link into the room.
 */
function LiveCard({ entry }: { entry: LiveEntry }) {
  return (
    <span className="relative block">
      {/* 1331:21817 — the same 80 x 80 tile with the red drawn INSIDE its
          edge (`ws-story-tile-live`), so the tile is the node's size ring
          included. The node draws no pill; it stays because a 40% red edge
          on its own says nothing a reader can name, and the pill is the
          strip's documented live marker. */}
      <span className="ws-story-card ws-story-tile-live relative block h-20 w-20 overflow-hidden rounded-[16.34px]">
        <GradientThumb seed={entry.id} className="absolute inset-0 h-full w-full" />
        {entry.thumbnailUrl && <TileMedia url={entry.thumbnailUrl} video={false} />}
        <span className="absolute inset-0 bg-black/[0.27]" />
        <span className="absolute left-[7.47px] top-[9px]">
          <Avatar name={entry.displayName} seed={entry.hostId} src={entry.avatarUrl} size={24} />
        </span>
      </span>
      <LivePill className="-bottom-px" />
    </span>
  );
}

/**
 * Portrait story card — 1331:21812's tiles on /pals (1328:1885).
 *
 * 80 x 80 at 16.34 radius, the node's two black/10 shadows
 * (`ws-story-card`), the cover under a flat 27% black scrim (1331:21814) with
 * the author's 24 avatar at (7.47, 9). The ring is an INSIDE stroke on the
 * tile's own edge — unseen is 2px of the file's #C27AFF -> #7E3BEB, seen the
 * 0.68 hairline at 40% white — drawn over the media by the tile utilities,
 * with no black gap and no padding: the tile is 80 x 80 ring included.
 * It was a silver conic ring around a black gap around a 100 x 96 tile, a
 * 109 x 105 object the node does not draw.
 *
 * 80 x 80, NOT THE FILE'S 100.09 x 96 (2026-09-16). The file's tile was too
 * big; a tall 72 x 120 portrait was tried and rejected ("this look like
 * rectangle it should be like that shape of square but small"). So the tile
 * keeps the file's near-square shape at a smaller size. The 24 avatar at
 * (7.47, 9), the radius and the rings are unchanged.
 */
function StoryCard({
  group,
  seen,
}: {
  group: StoryGroup;
  seen: boolean;
}) {
  // Which frame to show, and whether it is a clip, is decided in
  // `lib/story-cover.ts` — it prefers a still and trusts `mediaKind` over the
  // file extension. Taking the first story with any media and assuming it was
  // an image is what put clips into an <img> and broke the tile.
  const cover = storyCover(group.stories);
  return (
    <span
      className={cn(
        "ws-story-card relative block h-20 w-20 overflow-hidden rounded-[16.34px]",
        seen ? "ws-story-tile-seen" : "ws-story-tile-unseen"
      )}
    >
      <GradientThumb seed={group.id} className="absolute inset-0 h-full w-full" />
      {cover && <TileMedia url={cover.url} video={cover.video} />}
      <span className="absolute inset-0 bg-black/[0.27]" />
      <span className="absolute left-[7.47px] top-[9px]">
        <Avatar name={group.displayName} seed={group.id} src={group.avatarUrl} size={24} />
      </span>
      <span className="sr-only">{group.username}</span>
    </span>
  );
}

/**
 * The "+" on "Your Story" — 1331:21809: a 16.34 white disc with a 1.36 black
 * stroke and the file's two black/10 shadows, the "+" set as TEXT (Roboto
 * Bold 8.17) rather than a glyph, so it is the character and nothing else.
 */
function AddStoryBadge({ className }: { className?: string }) {
  return (
    <span
      data-add-story
      title="Add to your story"
      className={cn(
        "flex h-[16.34px] w-[16.34px] items-center justify-center rounded-full border-[1.36px] border-black bg-white font-[family-name:var(--font-roboto)] text-[8.17px] font-bold leading-none text-black shadow-[0_1.36px_2.72px_-1.36px_rgba(0,0,0,0.1),0_2.72px_4.09px_-0.68px_rgba(0,0,0,0.1)]",
        className
      )}
    >
      +
    </span>
  );
}

/**
 * "What's up?" — 1331:21849, hanging over "Your Story" from (31, -43) of the
 * tile: an 88 x 42 bubble (`#BABABA` at 20% under Figma's GLASS, radius 12,
 * 13/12 padding, Geist Bold 12/18, the 0 4 6 -3 shadow at `#0A0A0A` 6%) with
 * a 12 and a 4 disc for a tail at x=13. The render shows the bubble a shade
 * brighter than the 20% wash alone (59-71 on a 18 ground; the flat wash
 * composites to 52) with a lit rim, so the fill is 24% and the rim is
 * `ws-glass-rim`'s — the API publishes no GLASS parameters.
 *
 * It is the tile's hover and focus tooltip, not a permanent drawing: the
 * node lays it over the strip as a prompt, and a prompt that never goes
 * away is a label. `aria-hidden`: the button already names itself.
 */
function WhatsUpTooltip() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-[43px] left-[31px] z-10 block h-[52px] w-[114px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {/* The node's label box is 256 wide inside the 88 bubble (clipped), so
          the copy sits on ONE line whatever the bubble's width. */}
      <span className="ws-glass-rim relative block h-[42px] w-[88px] overflow-hidden whitespace-nowrap rounded-[12px] bg-[rgba(186,186,186,0.24)] px-[13px] py-3 text-left text-[12px] font-bold leading-[18px] text-white shadow-[0_4px_6px_-3px_rgba(10,10,10,0.06)] backdrop-blur-[7px]">
        What’s up?
      </span>
      <span className="absolute left-[13px] top-[36px] block h-3 w-3 rounded-full bg-[rgba(186,186,186,0.24)] backdrop-blur-[7px]" />
      <span className="absolute left-[13px] top-[48px] block h-1 w-1 rounded-full bg-[rgba(186,186,186,0.24)]" />
    </span>
  );
}

function StoryViewer({
  groups,
  startGroup,
  onClose,
  onSeen,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
  onSeen: (storyId: string) => void;
}) {
  const [at, setAt] = useState<StoryPosition>({ group: startGroup, story: 0 });
  /*
   * WHY A SET OF REASONS AND NOT ONE `paused` BOOLEAN.
   *
   * A story can be held for several reasons at once — a reader presses and
   * holds while the cursor is also inside the frame, and the tab goes to the
   * background while both are true. With one boolean, whichever release fires
   * first resumes a story the other reason still wants held; worse, a reason
   * that is never released (see the hover note on the tap zones) leaves the
   * story frozen with no way back. Each reason clears itself, and the story
   * runs when none of them is set.
   */
  const [pressing, setPressing] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hidden, setHidden] = useState(false);
  /*
    WHICH STORY'S VIEWER LIST IS OPEN, by id rather than a boolean — so moving
    to the next story closes it without an effect: the open id simply stops
    matching the story on screen.
  */
  const [viewersFor, setViewersFor] = useState<string | null>(null);
  const me = useMe();
  // The list being open holds the story, the same way a backgrounded tab does.
  const paused = isHeld({ pressing, hovering, hidden: hidden || viewersFor !== null });
  // Progress is driven from the SAME clock that advances the story, so a hold
  // freezes the bar with the story instead of racing on to 100% underneath a
  // paused card.
  const [progress, setProgress] = useState(0);

  const sizes = useMemo(() => groups.map((group) => group.stories.length), [groups]);
  const group = groups[at.group];
  const story = group?.stories[at.story];
  const storyKey = `${at.group}:${at.story}`;
  const isVideo = story ? Boolean(story.mediaUrl) && isStoryVideoMedia(story) : false;
  /*
    "SEEN BY" IS THE AUTHOR'S ALONE. The route answers only the story's author,
    so it is asked only on the reader's own story — asking on everyone else's
    would be a guaranteed 404 on every story opened. Nothing is drawn until it
    answers: a service without the route (404), a removed story, anything that
    is not a clean success leaves no entry rather than a broken one.
  */
  const mine = Boolean(group && me.data && group.id === me.data.id);
  const viewers = useStoryViewers(story?.id, mine);
  const viewerTotal = viewers.data?.pages[0]?.total ?? null;
  const viewersOpen = Boolean(story && viewersFor === story.id);

  /** Elapsed wall time on this story, in MILLISECONDS — see `advanceRatio`. */
  const elapsedRef = useRef(0);
  const progressRef = useRef(0);
  const storyKeyRef = useRef(storyKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const backdropRef = useRef<HTMLVideoElement>(null);
  /**
   * Sound is ON on open and stays wherever the viewer last put it.
   *
   * The viewer is only ever opened by tapping a story ring, and that click is
   * the user gesture the autoplay policy asks for — so unmuted playback is
   * normally allowed. "Normally" is not "always" — a browser with no media
   * engagement for the origin can still refuse — which is why the play below
   * catches that ONE rejection and drops to muted rather than leaving the
   * viewer on a frozen first frame. Holding the choice across stories is the
   * Instagram behaviour — nobody wants to set sound on every clip.
   */
  const [soundOn, setSoundOn] = useState(true);
  /**
   * The clip's real length, tagged with the story it was measured from.
   *
   * Tagged rather than reset in an effect: a stale duration would otherwise
   * time the NEXT story until its metadata arrived, and the key check makes
   * that impossible without a second render.
   */
  const [measured, setMeasured] = useState<{ key: string; ms: number } | null>(null);
  const measuredMs = measured?.key === storyKey ? measured.ms : null;
  // A picture holds for the fixed beat; a clip holds for its own length,
  // capped, and falls back to the picture beat until metadata arrives.
  const durationMs = storyDurationMs(measuredMs);
  /**
   * Whether the CLIP is the clock rather than the wall.
   *
   * Only once its length is known: before that there is nothing to be a
   * fraction of, and a clip that never reports one (a dead link, a file the
   * browser will not decode) has to stay on the wall clock or the set would
   * park on it forever.
   */
  const clipIsClock = isVideo && measuredMs !== null;

  /**
   * Stop this viewer's own media, synchronously.
   *
   * `AnimatePresence` keeps the viewer mounted through its fade-out, so an
   * effect cleanup is far too late: the story went on talking over the closing
   * animation, and over whatever the reader landed on next. Every exit —
   * the X, Escape, the author link, the CTA, the end of the last story — goes
   * through here.
   */
  const close = useCallback(() => {
    videoRef.current?.pause();
    backdropRef.current?.pause();
    onClose();
  }, [onClose]);

  const restart = useCallback(() => {
    elapsedRef.current = 0;
    progressRef.current = 0;
    setProgress(0);
    if (videoRef.current) videoRef.current.currentTime = 0;
    if (backdropRef.current) backdropRef.current.currentTime = 0;
  }, []);

  // Advance within the author, then to the next author, then close — the
  // Instagram traversal, decided in `lib/story-playback.ts`.
  const next = useCallback(() => {
    const to = nextPosition(at, sizes);
    if (!to) return close();
    setAt(to);
  }, [at, close, sizes]);

  const previous = useCallback(() => {
    const to = previousPosition(at, sizes);
    // Already at the very first story: replay it. Closing the whole set
    // because the reader asked to see something again is not a "back".
    if (to.group === at.group && to.story === at.story) return restart();
    setAt(to);
  }, [at, restart, sizes]);

  /**
   * NOTHING ELSE ON THE PAGE MAY BE AUDIBLE WHILE A STORY IS OPEN.
   *
   * The feed pauses its clips with an `IntersectionObserver`, and an observer
   * measures the viewport, not what is stacked on top of it — so a feed video
   * 60% on screen carried on playing, with sound, underneath a story that was
   * also playing with sound. Two voices at once, which is the single loudest
   * way the app's audio "did not make sense".
   *
   * On the way out it restarts exactly what it stopped and nothing else, so
   * closing a story hands the reader back the clip they were watching rather
   * than a feed frozen mid-frame.
   */
  useEffect(() => {
    const root = rootRef.current;
    const stopped = mediaToSilence<HTMLMediaElement>(
      document.querySelectorAll("video, audio"),
      (media) => Boolean(root?.contains(media))
    );
    for (const media of stopped) media.pause();
    return () => {
      for (const media of stopped) {
        if (media.isConnected) void media.play().catch(() => {});
      }
    };
  }, []);

  // The page behind must not scroll while the overlay owns the viewport —
  // scrolling it would also move feed clips in and out of the intersection
  // that starts them, i.e. start a second soundtrack behind an open story.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  /**
   * A BACKGROUNDED TAB HOLDS THE STORY.
   *
   * `requestAnimationFrame` stops in a hidden tab but a `<video>` does not, so
   * switching tabs left the story talking out of an unattended tab while its
   * progress bar sat frozen — and coming back showed a bar half way through a
   * clip that had already finished. Holding on `visibilitychange` keeps the
   * two on one clock and stops the disembodied audio.
   */
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /**
   * A press must be releasable from anywhere.
   *
   * `pointerup` only reaches the tap zone when the pointer is still over it;
   * releasing outside it, or losing the pointer to a system gesture, or
   * tabbing away mid-press, would otherwise leave the story held for good.
   */
  useEffect(() => {
    const release = () => setPressing(false);
    const blur = () => {
      setPressing(false);
      setHovering(false);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", blur);
    };
  }, []);

  /*
    A STORY ON SCREEN IS A STORY VIEWED — and now the service is told.

    It marked the story seen for THIS browser (the ring greys out) and never
    reported the view, so the author's "who viewed my story" could only ever
    have come back empty (QA asked for that list; the backend confirmed the
    gap by reading, and so did this file). `reportView` is the feed's own
    reporter: once per story per tab, and the service deduplicates per viewer
    and does not count the author's own view.
  */
  useEffect(() => {
    if (!story) return;
    onSeen(story.id);
    reportView(story.id);
  }, [story, onSeen]);

  useEffect(() => {
    if (paused) return;
    // A new story starts from zero; a resumed one continues from the hold.
    if (storyKeyRef.current !== storyKey) {
      storyKeyRef.current = storyKey;
      elapsedRef.current = 0;
      progressRef.current = 0;
    }
    let frame = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      if (last === null) last = now;
      elapsedRef.current += now - last;
      last = now;
      /*
       * THE CLIP IS ITS OWN CLOCK.
       *
       * A bar on wall time runs away from a video that is buffering, and it
       * leapt the moment a measured duration replaced the picture beat. Read
       * off `currentTime` and the bar cannot disagree with the picture: it
       * stalls when the clip stalls and resumes exactly where the clip
       * resumed. The wall clock still runs underneath, purely so a clip that
       * has stopped downloading for good cannot park the reader on one frame.
       */
      const node = videoRef.current;
      const elapsed = clipIsClock && node ? node.currentTime * 1000 : elapsedRef.current;
      const ratio = advanceRatio(progressRef.current, elapsed, durationMs);
      progressRef.current = ratio;
      setProgress(ratio);
      if (ratio >= 1 || hasOverrun(elapsedRef.current, durationMs)) {
        next();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clipIsClock, durationMs, next, paused, storyKey]);

  // Holding to pause has to stop the CLIP, not just the progress bar. It only
  // stopped the bar, so a held story kept playing — and with sound on, kept
  // talking — underneath a frozen segment.
  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    const backdrop = backdropRef.current;
    if (paused) {
      node.pause();
      backdrop?.pause();
      return;
    }
    if (backdrop) {
      // The letterbox fill is the same clip decoded a second time, so it has to
      // be nudged back onto the frame it is filling for. Left to itself it
      // drifts a little further behind on every hold.
      if (Math.abs(backdrop.currentTime - node.currentTime) > 0.25) {
        backdrop.currentTime = node.currentTime;
      }
      void backdrop.play().catch(() => {});
    }
    let cancelled = false;
    void node.play().catch((error: unknown) => {
      if (cancelled) return;
      /*
       * ONLY the autoplay policy refusing sound is worth acting on.
       *
       * `play()` also rejects with `AbortError` whenever a pause or a new
       * `src` overtakes it — which happens every time the reader taps through
       * quickly — and this used to answer that by turning sound off for the
       * rest of the session. Tapping through three stories silenced the app.
       * A real refusal drops to muted and the effect re-runs and plays; the
       * button turns it back on.
       */
      if (!isAutoplayRefusal(error)) return;
      setSoundOn(false);
    });
    return () => {
      cancelled = true;
    };
  }, [paused, soundOn, storyKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return close();
      if (event.key === "ArrowRight") return next();
      if (event.key === "ArrowLeft") return previous();
      // Focus stays inside the dialog: it covers the page, and tabbing onto
      // the feed underneath lands a screen reader on content nobody can see.
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (!root) return;
      const stops = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => node.getAttribute("aria-hidden") !== "true"
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, next, previous]);

  // The overlay takes focus on open and hands it back on close, so a keyboard
  // or screen-reader user is put inside the thing that just covered the page
  // and returned to the tile they opened it from.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  if (!group || !story) return null;
  const cta = resolveCta(story.deepLink);

  return (
    <motion.div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Stories from ${group.displayName}`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 outline-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* The card: a 9:16 frame, centred, exactly as Instagram stages it. */}
      <div className="relative mx-auto flex h-full max-h-[92dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-none sm:rounded-3xl sm:border sm:border-white/10">
        {/* Card ground: the seeded texture, lifted so the frame separates
            from the dimmed page, then a scrim top and bottom so the header
            and the CTA stay readable over any artwork. */}
        {/*
          THE GROUND THE AUTHOR CHOSE, where they chose one.

          `storyStyle` has been on the service for weeks with nothing reading
          it, so every story played on the seeded texture whatever its author
          picked. Null is NOT a gap — the service's own words are that it means
          the default background, which is how every story posted before this
          existed — so a story without a style keeps exactly the ground it has
          always had rather than turning a colour.

          A PICTURE STILL WINS. Media fills the frame, so a background behind it
          would never be seen, and painting one would only tint the scrims.
        */}
        {story.storyStyle && !story.mediaUrl ? (
          <div
            className="absolute inset-0 h-full w-full rounded-none sm:rounded-3xl"
            style={{ background: story.storyStyle.background }}
          />
        ) : (
          <>
            <GradientThumb
              seed={story.id}
              className="absolute inset-0 h-full w-full rounded-none sm:rounded-3xl"
            />
            <div className="absolute inset-0 bg-white/[0.07]" />
          </>
        )}

        {/* Where the reader is in the set, for anyone who cannot see the
            segments. `role="status"` re-announces it as the story turns. */}
        <p role="status" className="sr-only">
          {`${group.displayName}, story ${at.story + 1} of ${group.stories.length}`}
        </p>

        {/* One segment per story in this author's set. */}
        <div className="relative z-20 flex gap-1 px-3 pt-3">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full bg-white"
                style={{
                  width: i < at.story ? "100%" : i === at.story ? `${progress * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>

        <div className="relative z-20 flex items-center gap-3 px-3 py-3">
          <Link href={profileHref(group)} prefetch={false} onClick={close}>
            <Avatar name={group.displayName} seed={group.id} src={group.avatarUrl} size={32} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={profileHref(group)} prefetch={false}
              onClick={close}
              className="ws-text-shadow block truncate text-sm font-bold text-white"
            >
              {group.displayName}
            </Link>
            <p className="ws-text-shadow text-xs text-white/70">{relativeTime(story.createdAt)}</p>
          </div>
          {/* Shown only on a clip — a mute button over a photograph is a
              control for something that cannot make a sound. */}
          {isVideo && (
            <button
              onClick={() => setSoundOn((on) => !on)}
              aria-label={soundOn ? "Mute story" : "Unmute story"}
              aria-pressed={soundOn}
              className="ws-press rounded-full bg-black/40 p-1.5 text-white backdrop-blur-sm"
            >
              <IconVolume className="h-5 w-5" muted={!soundOn} />
            </button>
          )}
          <button onClick={close} aria-label="Close stories" className="p-1.5 text-white">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {/*
          Tap zones: left third steps back, the rest advances. Holding anywhere
          pauses, the way Instagram does.

          HOVERING pauses too, but only for a mouse that has actually MOVED
          inside the frame — and that distinction is the whole reason this is
          `onPointerMove` rather than the `onPointerEnter` it started as.
          `pointerenter` also fires when an element APPEARS under a stationary
          cursor, which is exactly what an overlay does: opening a story from a
          rail tile that happens to sit under the centred card paused the story
          on the frame it opened on, and because the mouse never moved again
          nothing ever fired `pointerleave` to release it. The clip stayed
          frozen at 0:00 with its blurred backdrop still running behind it —
          the story "not playing" that started this. `pointermove` is only ever
          produced by real movement, so a cursor that merely finds itself over
          the card holds nothing.

          `pointerType` still matters: on a touch screen a tap fires the hover
          events immediately before `pointerdown`, so binding them
          unconditionally would be a second, redundant pause on every tap. And
          a pen reports as a mouse-like device without being one, which is why
          this is not just `onMouseMove`.

          A CLICK clears the hover hold: asking for the next story is asking to
          watch it, and leaving the hold set would open it paused under a
          cursor that is once again not moving. It re-arms on the next real
          movement.
        */}
        <button
          aria-label="Previous story"
          className="absolute inset-y-0 left-0 z-10 w-1/3"
          onClick={() => {
            setHovering(false);
            previous();
          }}
          onPointerDown={() => setPressing(true)}
          onPointerUp={() => setPressing(false)}
          onPointerMove={(event) => event.pointerType === "mouse" && setHovering(true)}
          onPointerLeave={() => {
            setHovering(false);
            setPressing(false);
          }}
        />
        <button
          aria-label="Next story"
          className="absolute inset-y-0 right-0 z-10 w-2/3"
          onClick={() => {
            setHovering(false);
            next();
          }}
          onPointerDown={() => setPressing(true)}
          onPointerUp={() => setPressing(false)}
          onPointerMove={(event) => event.pointerType === "mouse" && setHovering(true)}
          onPointerLeave={() => {
            setHovering(false);
            setPressing(false);
          }}
        />

        {/* Media is CONTAINED, never cropped: the frame is 9:16 but a story can
            be any ratio, and `object-cover` sliced the ends off every landscape
            photo. The letterbox is filled by a blurred, over-scaled copy of the
            same frame — the Instagram/WhatsApp treatment — so the card still
            reads full-bleed without losing content. The copy is decorative and
            hidden from assistive tech; both layers stay under the tap zones
            (z-10) and the progress/header chrome (z-20).

            Both layers are KEYED on the story, so turning the page builds a new
            element rather than swapping `src` on the old one — a reused
            element carries the previous clip's `currentTime`, which is the
            clock the progress bar now reads. */}
        {story.mediaUrl && (
          <div className="absolute inset-0 overflow-hidden">
            {isVideo ? (
              <>
                {/* The backdrop copy is ALWAYS muted, whatever the sound
                    setting: it is the same file decoded twice, so letting it
                    carry audio would play every story over itself, slightly
                    out of sync. It is also NOT looped and is paused, resumed
                    and re-seeked with the clip it is filling for — left
                    running on its own it drifted out of step with the picture
                    in front of it the first time anyone held the story. */}
                <video
                  key={`bd-${story.id}`}
                  ref={backdropRef}
                  src={story.mediaUrl}
                  autoPlay
                  muted
                  playsInline
                  aria-hidden
                  className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl saturate-150"
                />
                <video
                  key={story.id}
                  ref={videoRef}
                  src={story.mediaUrl}
                  autoPlay
                  muted={!soundOn}
                  playsInline
                  // NOT looped: the progress bar now runs for the clip's real
                  // length, so a loop would restart the audio underneath a bar
                  // that is about to advance.
                  onLoadedMetadata={(event) => {
                    const ms = clipDurationMs(event.currentTarget.duration);
                    // A stream with no known length reports Infinity or NaN;
                    // timing a story off that would stall the set forever, so
                    // it keeps the picture beat instead.
                    if (ms === null) return;
                    setMeasured({ key: storyKey, ms });
                  }}
                  // A clip can finish a shade before its reported length; the
                  // set moves on with it rather than holding a black frame.
                  onEnded={next}
                  className="relative h-full w-full object-contain"
                />
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown */}
                <img
                  key={`bd-${story.id}`}
                  src={story.mediaUrl}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl saturate-150"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied media host is unknown */}
                <img
                  key={story.id}
                  src={story.mediaUrl}
                  alt=""
                  className="relative h-full w-full object-contain"
                />
              </>
            )}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/65" />

        <div className="relative z-0 flex flex-1 flex-col items-center justify-center px-8 text-center">
          {/* The face is the author's too — `ws-display` is what `display`
              means here, and stays the answer for a story with no style. */}
          <p
            className={cn(
              "ws-text-shadow text-2xl leading-snug text-white",
              story.storyStyle ? storyFontClass(story.storyStyle) : "ws-display"
            )}
          >
            {story.text}
          </p>
        </div>

        {mine && viewerTotal !== null && (
          <div className="relative z-20 px-6 pb-4">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setViewersFor(story.id);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              aria-haspopup="dialog"
              aria-expanded={viewersOpen}
              className="ws-press flex items-center gap-2 rounded-full bg-black/45 px-3.5 py-1.5 text-[13px] font-semibold text-white backdrop-blur-sm"
            >
              {seenByLabel(viewerTotal)}
            </button>
          </div>
        )}

        {cta && (
          <div className="relative z-20 px-6 pb-8">
            <Link
              href={cta.href}
              onClick={close}
              className="ws-press flex h-11 w-full items-center justify-center rounded-full bg-accent text-sm font-bold text-ink"
            >
              {cta.label}
            </Link>
          </div>
        )}

        {mine && viewersOpen && viewerTotal !== null && (
          <StoryViewersPanel query={viewers} total={viewerTotal} onClose={() => setViewersFor(null)} />
        )}
      </div>

      {/* Desktop arrows sit outside the card, Instagram-style. They are a
          POINTER affordance and duplicate the tap zones exactly, so they stay
          out of the tab order and out of the accessibility tree — the zones
          are the keyboard path, and they exist at every breakpoint whereas
          these are hidden below `lg`. */}
      <button
        onClick={previous}
        aria-hidden
        tabIndex={-1}
        className="ws-glass absolute left-6 hidden h-10 w-10 items-center justify-center rounded-full text-white lg:flex"
      >
        <IconChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={next}
        aria-hidden
        tabIndex={-1}
        className="ws-glass absolute right-6 hidden h-10 w-10 items-center justify-center rounded-full text-white lg:flex"
      >
        <IconChevronRight className="h-5 w-5" />
      </button>
    </motion.div>
  );
}
/**
 * Circular story rail — the mobile frame's shape.
 *
 * Same author grouping, same seen semantics and same viewer as the desktop
 * card strip; only the tile geometry differs (41px ring, name beneath).
 */
export function StoriesRail() {
  const me = useMe();
  const stories = useStories();
  const live = useFeed("live");
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const seen = useSyncExternalStore(subscribeSeen, getSeenSnapshot, getSeenServerSnapshot);
  const liveEntries = useMemo(
    () => toLiveEntries(live.data?.pages.flatMap((page) => page.items) ?? []),
    [live.data]
  );
  const groups = useMemo(
    () => groupByAuthor(stories.data?.items ?? []),
    [stories.data]
  );
  // YOUR STORY, WHATSAPP'S "MY STATUS": with stories of your own the tile plays
  // them; without, or on its + badge, it opens the creator.
  const mine = groups.findIndex((group) => group.id === me.data?.id);
  const openYourStory = (event: React.MouseEvent<HTMLElement>) => {
    const add = (event.target as HTMLElement).closest("[data-add-story]");
    if (mine >= 0 && !add) setOpenAt(mine);
    else setCreating(true);
  };

  if (stories.isPending) return <div className="h-[74px]" />;

  return (
    <>
      <div className="flex items-center gap-[11px] overflow-x-auto rounded-[22px] border border-white/[0.18] bg-[#101012]/62 px-3 py-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={openYourStory}
          aria-label={mine >= 0 ? "View your story" : "Add to your story"}
          className="ws-press flex w-[41px] shrink-0 flex-col items-center gap-1"
        >
          <span className="relative block h-[41px] w-[41px]">
            {mine >= 0 ? (
              <span
                className={cn(
                  "ws-story-ring block !h-[41px] !w-[41px] !p-[1.4px]",
                  groups[mine]!.stories.every((story) => seen.has(story.id)) && "ws-story-seen"
                )}
              >
                <span className="ws-story-gap block !p-0">
                  <Avatar name={me.data?.displayName ?? "You"} seed={me.data?.id} src={me.data?.avatarUrl} size={38} />
                </span>
              </span>
            ) : (
              <span className="flex h-[41px] w-[41px] items-center justify-center rounded-full border border-white/20 bg-white/5">
                <span className="opacity-60">
                  <Avatar name={me.data?.displayName ?? "You"} seed={me.data?.id} src={me.data?.avatarUrl} size={33} />
                </span>
              </span>
            )}
            <span
              data-add-story
              title="Add to your story"
              className="absolute -bottom-0.5 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-white text-black"
            >
              <IconPlus className="h-2.5 w-2.5 [&]:stroke-[3]" />
            </span>
          </span>
          <span className="w-full truncate text-center text-[8px] text-white/60">Your Story</span>
        </button>

        {/* Same ordering rule as desktop: live leads. The design never drew a
            live entry in the circular variant, so the treatment is carried over
            from the card strip — red ring, red pill — sized to the 41px ring. */}
        {liveEntries.map((entry) => (
          <Link
            key={entry.id}
            href={liveHref(entry, me.data?.id)}
            aria-label={`${entry.displayName} is live: ${entry.title}`}
            className="ws-press flex w-[41px] shrink-0 flex-col items-center gap-1"
          >
            <span className="relative block">
              <span className="ws-story-live block rounded-full">
                <Avatar name={entry.displayName} seed={entry.hostId} src={entry.avatarUrl} size={41} />
              </span>
              <LivePill className="-bottom-1" />
            </span>
            <span className="w-full truncate text-center text-[8px] text-white/80">
              {entry.displayName.split(" ")[0]}
            </span>
          </Link>
        ))}

        {groups.map((group, i) => {
          // Your own group plays from the "Your Story" tile, not twice.
          if (i === mine) return null;
          const allSeen = group.stories.every((story) => seen.has(story.id));
          return (
            <button
              key={group.id}
              onClick={() => setOpenAt(i)}
              aria-label={`Stories from ${group.displayName}`}
              className="ws-press flex w-[41px] shrink-0 flex-col items-center gap-1"
            >
              <span
                className={cn(
                  "ws-story-ring block !h-[41px] !w-[41px] !p-[1.4px]",
                  allSeen && "ws-story-seen"
                )}
              >
                <span className="ws-story-gap block !p-0">
                  <Avatar name={group.displayName} seed={group.id} src={group.avatarUrl} size={38} />
                </span>
              </span>
              <span className="w-full truncate text-center text-[8px] text-white/80">
                {group.displayName.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {openAt !== null && groups[openAt] && (
          <StoryViewer
            groups={groups}
            startGroup={openAt}
            onClose={() => setOpenAt(null)}
            onSeen={markStorySeen}
          />
        )}
      </AnimatePresence>
      {creating && <StoryCreator onClose={() => setCreating(false)} />}
    </>
  );
}

export function StoriesRow() {
  const me = useMe();
  const stories = useStories();
  // The `live` lane, not `GET /streams?status=live`: Home already fetches this
  // exact query for the featured hero, so the strip costs no extra request, and
  // it keeps the rail inside the feed slice instead of reaching into streams.
  const live = useFeed("live");
  const [openAt, setOpenAt] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const seen = useSyncExternalStore(subscribeSeen, getSeenSnapshot, getSeenServerSnapshot);

  const liveEntries = useMemo(
    () => toLiveEntries(live.data?.pages.flatMap((page) => page.items) ?? []),
    [live.data]
  );
  const groups = useMemo(
    () => groupByAuthor(stories.data?.items ?? []),
    [stories.data]
  );
  // YOUR STORY, WHATSAPP'S "MY STATUS": with stories of your own the tile plays
  // them; without, or on its + badge, it opens the creator.
  const mine = groups.findIndex((group) => group.id === me.data?.id);
  const openYourStory = (event: React.MouseEvent<HTMLElement>) => {
    const add = (event.target as HTMLElement).closest("[data-add-story]");
    if (mine >= 0 && !add) setOpenAt(mine);
    else setCreating(true);
  };

  if (stories.isPending) {
    return (
      <div className="flex gap-[5.45px]">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 w-20 shrink-0 rounded-[16.34px]" />
        ))}
      </div>
    );
  }

  // "Your story" always leads the rail, even with nothing to show behind it —
  // that first tile is how Instagram teaches the gesture.
  return (
    <>
      {/*
        1331:21802 — "Your Story" then the strip (1331:21812) on a 12, the
        tiles inside it on a 5.45, the row clipping what runs past it. The 43
        of top padding is the tooltip's room: it hangs 43 above the first
        tile, and a scroll container clips on both axes, so the row starts
        43 higher and pads the tiles back down to where the node puts them.
      */}
      <div className="-mt-[43px] flex gap-[5.45px] overflow-x-auto pt-[43px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* "Your Story" leads: an outlined tile carrying the viewer's own
            avatar, a white + badge on its foot, and the label beneath. */}
        <button
          type="button"
          onClick={openYourStory}
          aria-label={mine >= 0 ? "View your story" : "Add to your story"}
          className="group ws-press relative mr-[6.55px] shrink-0"
        >
          {mine >= 0 ? (
            /* With a story up it is YOUR story card — your latest cover in the
               ring, the + still on it to add another, as WhatsApp's My status. */
            <span className="relative block">
              <StoryCard group={groups[mine]!} seen={groups[mine]!.stories.every((story) => seen.has(story.id))} />
              <span className="ws-text-shadow pointer-events-none absolute bottom-3 left-2 font-[family-name:var(--font-roboto)] text-[9px] font-bold text-white">
                Your Story
              </span>
              {/* Top-right, not bottom-right: on the 72-wide tile a foot
                  badge would sit on top of the "Your Story" label. */}
              <AddStoryBadge className="absolute right-2 top-2" />
            </span>
          ) : (
          /*
            1331:21803 — 80 x 80 (the file's 100.09 x 96, made smaller), the file's
            dashed ring; a white disc holding the viewer's avatar, the + badge
            centred on the disc's foot and "Your Story" in Roboto Bold
            8.17/10.89 at 40% white. The file's 55.15 disc does not fit an
            80 tile with the label under it, so the disc is 44 at y=8, the
            badge at y=43.83 and the label at y=63.
            The node also lays a #0F0F0F wash (1331:21806) across the tile
            from its right edge, and the render shows none of it — the avatar
            and the tile read the same left and right — so it is not drawn.
            The node's avatar image is 63.66 in its 55.15 disc, offset up-left:
            that is the file's own crop of its mascot, not a rule, so the
            reader's avatar simply fills the disc.
          */
          <span className="ws-story-card relative block h-20 w-20">
            {/* The file's dashed ring, drawn rather than bordered so the dash
                length (6.13 on, 6.13 off), the 0.68px weight and the 16.34
                radius are all the file's exactly. Inset by half the stroke so
                it sits inside the tile instead of straddling its edge. */}
            <svg
              aria-hidden
              viewBox="0 0 80 80"
              fill="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <rect
                x="0.34"
                y="0.34"
                width="79.32"
                height="79.32"
                rx="16.34"
                stroke="rgba(255,255,255,0.4)"
                strokeWidth="0.68"
                strokeDasharray="6.13 6.13"
              />
            </svg>
            <span className="absolute left-1/2 top-2 flex h-11 w-11 -translate-x-1/2 items-center justify-center overflow-hidden rounded-[25%] bg-white">
              <Avatar name={me.data?.displayName ?? "You"} seed={me.data?.id} src={me.data?.avatarUrl} size={44} />
            </span>
            <AddStoryBadge className="absolute left-1/2 top-[43.83px] -translate-x-1/2" />
            <span className="absolute inset-x-0 top-[63px] text-center font-[family-name:var(--font-roboto)] text-[8.17px] font-bold leading-[10.89px] text-white/40">
              Your Story
            </span>
          </span>
          )}
          <WhatsUpTooltip />
        </button>

        {/* Live leads the rail — the highest-urgency thing on the square, and
            the one entry that expires while you look at it. A tap opens the
            room, never the story viewer. */}
        {liveEntries.map((entry) => (
          <Link
            key={entry.id}
            href={liveHref(entry, me.data?.id)}
            aria-label={`${entry.displayName} is live: ${entry.title}`}
            className="ws-press shrink-0"
          >
            <LiveCard entry={entry} />
          </Link>
        ))}

        {groups.map((group, i) => {
          // Your own group plays from the "Your Story" tile, not twice.
          if (i === mine) return null;
          const allSeen = group.stories.every((story) => seen.has(story.id));
          return (
            <button
              key={group.id}
              onClick={() => setOpenAt(i)}
              aria-label={`Stories from ${group.displayName}`}
              className="ws-press shrink-0"
            >
              <StoryCard group={group} seen={allSeen} />
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {openAt !== null && (
          <StoryViewer
            groups={groups}
            startGroup={openAt}
            onClose={() => setOpenAt(null)}
            onSeen={markStorySeen}
          />
        )}
      </AnimatePresence>
      {creating && <StoryCreator onClose={() => setCreating(false)} />}
    </>
  );
}

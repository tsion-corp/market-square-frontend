"use client";
import Image from "next/image";
import { profileHref } from "@/lib/profile-href";
import { atHandle } from "@/lib/handle";
import { DEFAULT_REACTION } from "@/lib/reactions";

import { useLiveRoom } from "@/features/streams/hooks/use-live-room";
import {
  useLiveReactions,
  type LiveGiftPacket,
} from "@/features/streams/hooks/use-live-reactions";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { errorCode } from "@/lib/api/envelope";
import { formatCount, formatCountdown, formatDateTime } from "@/lib/format";
import { useGate } from "@/hooks/use-gate";
import { useMe } from "@/hooks/use-me";
import { Avatar } from "@/components/ui/avatar";
import { BrandLink } from "@/components/ui/wordmark";
import { LiveBadge, Pill, VerifiedBadge } from "@/components/ui/badge";
import { Button, Spinner } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconCamera,
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
  IconCoin,
  IconSpark,
  IconCollapseRight,
  IconComment,
  IconEye,
  IconFullscreen,
  IconHeart,
  IconHome,
  IconLink,
  IconLive,
  IconPause,
  IconPlay,
  IconPip,
  IconRefresh,
  IconShare,
  IconTheater,
  IconTicket,
  IconVolume,
} from "@/components/ui/icons";
import { ErrorState, InlineError, SignInPrompt, isAuthError } from "@/components/ui/states";
import { isArkOriginated, resolveCta } from "@/lib/deeplink";
import type { Profile } from "@/lib/api/schemas";
import {
  useRemoveGuest,
  useRecordReactions,
  useStream,
  useStreamList,
} from "@/features/streams/hooks/use-streams";
import { useHeartbeat, usePlaybackToken } from "@/features/streams/hooks/use-playback";
import { HlsPlayer, type QualityApi } from "@/features/streams/components/hls-player";
import { LiveKitPlayer } from "@/features/streams/components/livekit-player";
import { ChatPanel } from "@/features/streams/components/chat-panel";
import { GiftSheet } from "@/components/ui/gift-sheet";
import { CoinBuySheet } from "@/features/gifts";
import { useCoinBalance } from "@/features/gifts";
import { LIVE_GIFTS, giftsArePriced, type LiveGift } from "@/lib/gifts";
import { useSendTip , tipAlreadyInFlight , recipientCannotHoldKash , GIFT_PHASE_SAYS } from "@/features/tips";
import { multiplyKash } from "@/lib/kash-amount";
import { GuestSpeakerControl } from "@/features/streams/components/guest-speaker-control";
import { MarketPulse, type PulseCounts } from "@/features/streams/components/market-pulse";
import { TicketSheet } from "@/features/streams/components/ticket-sheet";
import { streamPriceLabel } from "@/features/streams/components/stream-card";
import { stageFrameAspect } from "@/features/streams/lib/stage";
import type { Stream } from "@/features/streams/lib/types";
import { MARKET_FLAGS } from "@/lib/market-config";
import { sq } from "@/lib/square-path";

function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const remaining = Date.parse(target) - now;
  return (
    <p className="tnum ws-display text-4xl tracking-tight">
      {remaining <= 0 ? "Starting soon" : formatCountdown(remaining)}
    </p>
  );
}

function LiveElapsed({ startedAt }: { startedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt ?? new Date().toISOString())) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return <span className="tnum">{hours}:{String(minutes).padStart(2, "0")}:{String(rest).padStart(2, "0")}</span>;
}

// The playing surface for live and replay states. Owns the playback token,
// the ticket gate (403 ⇒ CTA), and the 15 s heartbeat. Full-bleed.
function PlaybackSurface({
  stream,
  mode,
  onNeedTicket,
  onQuality,
  onSourceAspect,
}: {
  stream: Stream;
  mode: "live" | "replay";
  onNeedTicket: () => void;
  /** Renditions reported by hls.js, so the control bar can offer a real pick. */
  onQuality?: (api: QualityApi | null) => void;
  /** The broadcast's own shape, which the frame around this surface adopts. */
  onSourceAspect?: (aspect: number | null) => void;
}) {
  const playback = usePlaybackToken(stream.id, true);
  const [playing, setPlaying] = useState(false);
  useHeartbeat(stream.id, mode, playing && playback.isSuccess);
  // A host watching their own room can still moderate it. The speaker-request
  // poll behind this only opens for the owner of a live stream, so a viewer
  // never pays for a moderation capability they do not have.
  const me = useMe();
  const isHost = me.data?.id === stream.ownerId;
  const guests = useRemoveGuest(stream.id, isHost && stream.status === "live");

  if (playback.isPending) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner className="h-8 w-8 text-grey-600" />
      </div>
    );
  }
  if (playback.isError) {
    // Not signed in is an invitation, not a failure. This used to fall through
    // to the generic error panel with a "Try again" button, which retried the
    // same 401 forever — a dead end for every signed-out visitor who opened a
    // stream.
    if (isAuthError(playback.error)) {
      return (
        <div className="flex h-full w-full items-center justify-center px-6">
          <SignInPrompt
            title="Sign in to watch"
            body="Live streams are for signed-in citizens. You'll come straight back here."
            className="border-0 bg-transparent"
          />
        </div>
      );
    }
    if (errorCode(playback.error) === "FORBIDDEN") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <IconTicket className="h-8 w-8 text-grey-300" />
          <p className="text-sm text-body">This stream is for ticket holders.</p>
          <Button className="ws-press" onClick={onNeedTicket}>
            Get ticket · {streamPriceLabel(stream)}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6">
        <InlineError error={playback.error} fallback="Couldn't start playback." />
        <Button variant="secondary" size="sm" onClick={() => playback.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  // ws/wss URLs are LiveKit rooms; http(s) URLs are HLS manifests.
  if (/^wss?:/i.test(playback.data.url)) {
    return (
      <LiveKitPlayer
        streamId={stream.id}
        hostIdentity={stream.ownerId}
        url={playback.data.url}
        token={playback.data.token}
        onPlayingChange={setPlaying}
        onSourceAspect={onSourceAspect}
        onRemoveGuest={isHost ? guests.remove : undefined}
        removing={guests.removing}
        fill
      />
    );
  }
  return (
    <HlsPlayer
      src={playback.data.url}
      captionSrc={playback.data.captionUrl}
      onPlayingChange={setPlaying}
      onQuality={onQuality}
      onSourceAspect={onSourceAspect}
      fill
    />
  );
}

// Non-live states rendered on the same immersive stage.
function StageBody({
  stream,
  onOpenTickets,
  onQuality,
  onSourceAspect,
}: {
  stream: Stream;
  onOpenTickets: () => void;
  onQuality?: (api: QualityApi | null) => void;
  onSourceAspect?: (aspect: number | null) => void;
}) {
  const gate = useGate();
  // Ark game broadcast → the route back into Ark. Null for native streams and
  // for any game prefix this build does not know.
  const needsTicket =
    stream.visibility === "ticketed" &&
    !stream.myTicket &&
    Boolean(stream.ticketPriceKash ?? stream.vipPriceKash);

  if (stream.status === "cancelled") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="ws-display text-xl">This stream was cancelled</p>
        <p className="text-sm text-meta">The host called it off. Check their profile for what&apos;s next.</p>
      </div>
    );
  }
  if (stream.status === "scheduled") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        {stream.scheduledAt && (
          <>
            <p className="ws-meta">Starts in</p>
            <Countdown target={stream.scheduledAt} />
            <p className="text-sm text-meta">{formatDateTime(stream.scheduledAt)}</p>
          </>
        )}
        {needsTicket ? (
          <Button className="ws-press" onClick={() => gate(onOpenTickets)}>
            <IconTicket className="h-4 w-4" /> Get ticket · {streamPriceLabel(stream)}
          </Button>
        ) : stream.myTicket ? (
          <Pill tone="accent">Ticket confirmed — you&apos;re in</Pill>
        ) : (
          <Pill>Free to watch when it starts</Pill>
        )}
      </div>
    );
  }
  if (stream.status === "ended") {
    // Replays are not a capability yet — recording needs LiveKit egress and a
    // storage target, and neither is provisioned, so `replayUrl` is null on
    // every stream. The old copy said the replay was "processing", which
    // promised something nobody was working on and invited the reader back to
    // check. Say what is true instead, and never enter the replay player.
    if (!MARKET_FLAGS.replays) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="ws-display text-xl">This stream has ended</p>
          <p className="text-sm text-meta">Replays aren&apos;t available yet.</p>
        </div>
      );
    }
    if (!stream.replayUrl) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="ws-display text-xl">Replay coming soon</p>
          <p className="text-sm text-meta">This stream has ended. The replay is processing — check back shortly.</p>
        </div>
      );
    }
    return (
      <PlaybackSurface
        stream={stream}
        mode="replay"
        onNeedTicket={() => gate(onOpenTickets)}
        onQuality={onQuality}
        onSourceAspect={onSourceAspect}
      />
    );
  }
  return (
    <PlaybackSurface
      stream={stream}
      mode="live"
      onNeedTicket={() => gate(onOpenTickets)}
      onQuality={onQuality}
      onSourceAspect={onSourceAspect}
    />
  );
}

interface Reaction {
  id: number;
  left: number;
  drift: number;
  rotate: number;
  duration: number;
  color: string;
  size: number;
}

interface GiftBurst {
  id: number;
  gift: LiveGift;
  quantity: number;
  /** Who sent it. A burst nobody can attribute is decoration, not an event. */
  from: string;
}

const MAX_REACTIONS = 30;
/**
 * A warm red ramp, built out of the palette rather than beside it.
 *
 * These hearts used to float in a silver ramp, on the reasoning that the room
 * is monochrome. But a heart is not chrome — it is the same universal
 * affordance the feed already paints in `--color-like`, and a grey one reads
 * as disabled rather than as applause. The feed's own double-tap burst is
 * `text-like`; the live room now agrees with it.
 *
 * Every stop is derived from house tokens (`--color-like` warmed toward
 * `--color-live`, lightened toward white) so the variation that keeps a burst
 * from looking like one stamp repeated cannot drift into a colour nothing else
 * in the app uses.
 */
const REACTION_COLORS = [
  "var(--color-like)",
  "color-mix(in srgb, var(--color-like) 72%, #ffffff)",
  "color-mix(in srgb, var(--color-like) 55%, #ffffff)",
  "color-mix(in srgb, var(--color-like) 55%, var(--color-live))",
  "var(--color-live)",
];
let reactionSeq = 0;
let giftSeq = 0;

// One entry per destination. Two labels pointing at the same href ("Back" and
// "Discover LIVE" both went to /live; "Go LIVE" and "Creator tools" both went
// to /studio) read as four choices while offering two, so the duplicates are
// gone. Nothing here is marked current: the current page is /live/:id, which
// none of these is — this rail is the way *out* of the room.
const STREAM_NAV = [
  { href: sq("/"), label: "Home", icon: IconHome },
  { href: sq("/live"), label: "Discover LIVE", icon: IconLive },
  { href: sq("/tickets"), label: "My tickets", icon: IconTicket },
  { href: sq("/studio"), label: "Go LIVE", icon: IconCamera },
] as const;


function SuggestedCreators({ currentId }: { currentId: string }) {
  const live = useStreamList("live");
  const others = (live.data?.items ?? []).filter((item) => item.id !== currentId).slice(0, 5);

  return (
    <div className="mt-5 border-t border-white/10 pt-5">
      <div className="flex items-center justify-center gap-1 px-1 xl:justify-between">
        <p className="hidden text-sm font-semibold text-grey-400 xl:block">Suggested LIVE creators</p>
        <button
          onClick={() => live.refetch()}
          aria-label="Refresh suggestions"
          title="Refresh suggestions"
          className="rounded-full p-1 text-grey-500 transition-colors hover:bg-white/10 hover:text-body"
        >
          <IconRefresh className="h-4 w-4" />
        </button>
      </div>

      {live.isPending && (
        <div className="mt-3 space-y-3 px-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-center gap-3 xl:justify-start">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="hidden flex-1 space-y-1.5 xl:block">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-2.5 w-14" />
              </div>
            </div>
          ))}
        </div>
      )}

      {live.isSuccess && others.length === 0 && (
        <p className="mt-3 hidden px-1 text-[11px] text-grey-600 xl:block">
          No other creators are live right now.
        </p>
      )}

      <ul className="mt-2">
        {others.map((item) => {
          const name = item.owner?.displayName ?? item.title;
          return (
            <li key={item.id}>
              <Link
                href={sq(`/live/${item.id}`)}
                // Below xl the row is the avatar alone, so the accessible name
                // has to come from the link itself — the text is display:none.
                aria-label={`${name} — live now`}
                title={name}
                className="flex items-center justify-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-white/[0.07] xl:justify-start"
              >
                <span className="relative shrink-0">
                  <Avatar name={name} seed={item.ownerId} src={item.owner?.avatarUrl} size={36} />
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-sm bg-accent px-1 text-[7px] font-bold text-ink">
                    LIVE
                  </span>
                </span>
                <span className="hidden min-w-0 flex-1 xl:block">
                  <span className="block truncate text-sm font-semibold text-heading">{name}</span>
                  <span className="block truncate text-[11px] text-meta">
                    {item.owner ? `@${item.owner.username}` : item.category}
                  </span>
                </span>
                {/* Live count only; a peak here would age into a lie. */}
                {(item.viewerCount ?? 0) > 0 && (
                  <span className="tnum hidden shrink-0 text-[11px] text-meta xl:block">
                    {formatCount(item.viewerCount ?? 0)}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <Link
        href={sq("/live")}
        className="mt-2 flex items-center justify-center gap-1 px-1 py-1 text-[13px] font-semibold text-accent xl:justify-start"
      >
        <IconChevronDown className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden xl:inline">See all</span>
      </Link>
    </div>
  );
}

// The way out of the room. Present from `lg` — the breakpoint where the room
// stops being a full-bleed phone stage (which carries its own overlaid back
// chevron) and becomes the desktop stack. It was `xl:flex`, which left the
// whole 1024–1279px band with no rail, no back control and no wordmark: the
// viewer was sealed in. Collapsed to a 72px icon rail below `xl` so the stage
// keeps its width, labelled from `xl` — the same collapse the app shell's
// sidebar uses, and the pattern Twitch/YouTube use on a watch page.
function StreamNav({ stream }: { stream: Stream }) {
  return (
    <aside className="hidden h-dvh w-[72px] shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-black px-2 py-6 text-body lg:flex xl:w-[250px] xl:px-5 2xl:w-[304px]">
      <BrandLink
        variant="mark"
        className="mb-8 flex items-center justify-center xl:hidden"
        markSize={36}
      />
      <BrandLink
        className="mb-8 hidden items-center gap-3 px-2 xl:flex"
        markSize={40}
        wordmarkHeight={20}
      />
      <nav className="space-y-1" aria-label="Leave this live room">
        {STREAM_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            title={item.label}
            className="group relative flex items-center justify-center gap-4 rounded-lg px-3 py-3 text-[16px] font-semibold text-body transition-colors hover:bg-white/[0.07] xl:justify-start"
          >
            <item.icon className="h-6 w-6 shrink-0" />
            <span className="hidden xl:inline">{item.label}</span>
            {/* Collapsed rail: name the icon on hover, as the app shell does. */}
            <span className="ws-overlay pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-lg px-2.5 py-1 text-xs text-body group-hover:block xl:!hidden">
              {item.label}
            </span>
          </Link>
        ))}
        {/* No "More" here: the entries above ARE the room's navigation, and a
            menu with nothing behind it is worse than no menu. Coin purchase is
            likewise absent — there is no coin ledger to buy into (see the
            gifting note in StreamRoom). */}
      </nav>

      <SuggestedCreators currentId={stream.id} />
      {/* Company / Program / Terms & Policies used to sit here as bare <p>
          elements. There are no routes behind any of them, so they were three
          dead controls dressed as links; the copyright is the only true line. */}
      <div className="mt-auto hidden border-t border-white/10 px-1 pt-5 text-[12px] leading-6 text-grey-600 xl:block">
        <p>© {new Date().getFullYear()} Square</p>
      </div>
    </aside>
  );
}

export function StreamRoom({
  streamId,
  followSlot,
}: {
  streamId: string;
  /** Route-composed follow control (owner profile lives in another slice). */
  followSlot?: (owner: Profile) => React.ReactNode;
}) {
  const stream = useStream(streamId, true);
  const gate = useGate();
  const me = useMe();
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const [giftsOpen, setGiftsOpen] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [theater, setTheater] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [giftBursts, setGiftBursts] = useState<GiftBurst[]>([]);
  // Only while the tray is open; the hook polls at 15s. See house-room.
  // Coins, not KASH — see house-room. Read only while the tray is open.
  const giftCoins = useCoinBalance(giftsOpen);
  // See house-room: short of KASH offers the top-up instead of a refusal.
  const [topUpOpen, setTopUpOpen] = useState(false);
  /** How many coins the tray was short, so the buy sheet can offer exactly that. */
  const [topUpNeeded, setTopUpNeeded] = useState(0);
  const reactionTimers = useRef<number[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(true);
  const [quality, setQuality] = useState<QualityApi | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  // What is actually being published, measured by the player, null until the
  // first frame's metadata arrives. `stageFrameAspect` turns it into the shape
  // the desktop frame takes — see the comment on that function for why the
  // frame follows the source rather than the other way round.
  const [sourceAspect, setSourceAspect] = useState<number | null>(null);
  const frameAspect = stageFrameAspect(sourceAspect);

  useEffect(() => {
    const timers = reactionTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Draws the hearts. `react` below is what SENDS them; this is called both by
  // the local tap and by every reaction arriving from the room, so a heart
  // looks identical whoever it came from.
  //
  // It must never move the displayed viewer tally, which is the service's own
  // count and not a thing a tap may change.
  const spawnReaction = useCallback((burst = 1) => {
    setReactions((current) => {
      const room = Math.max(0, MAX_REACTIONS - current.length);
      const additions = Array.from({ length: Math.min(burst, room) }, (_, index): Reaction => ({
        id: reactionSeq++,
        left: 5 + Math.random() * 20,
        drift: -54 + Math.random() * 108,
        rotate: -28 + Math.random() * 56,
        duration: 1.9 + Math.random() * 1.25 + index * 0.06,
        color: REACTION_COLORS[Math.floor(Math.random() * REACTION_COLORS.length)],
        size: 20 + Math.floor(Math.random() * 15),
      }));
      additions.forEach((reaction) => {
        const timer = window.setTimeout(() => {
          setReactions((list) => list.filter((item) => item.id !== reaction.id));
          reactionTimers.current = reactionTimers.current.filter((id) => id !== timer);
        }, reaction.duration * 1000);
        reactionTimers.current.push(timer);
      });
      return [...current, ...additions];
    });
  }, []);
  /**
   * Reactions now reach the whole room, over the room's own data channel.
   *
   * A tap draws locally at once so it never feels laggy, and the same burst
   * goes out to everybody else. Receiving draws the identical animation, so
   * the room fills up when it is busy — which is the entire point of reacting
   * in a live room rather than liking a post.
   */
  const liveRoom = useLiveRoom(streamId);
  /**
   * Draw a gift burst — ours or somebody else's, through one path.
   *
   * `from` is what makes it a live-room event rather than decoration: TikTok's
   * whole gift moment is "NAME sent a Phoenix", and a burst with no sender is
   * an animation nobody can thank.
   */
  const spawnGift = useCallback((gift: LiveGift, quantity: number, from: string) => {
    const burst = { id: giftSeq++, gift, quantity, from };
    setGiftBursts((current) => [...current.slice(-2), burst]);
    const timer = window.setTimeout(() => {
      setGiftBursts((current) => current.filter((item) => item.id !== burst.id));
      reactionTimers.current = reactionTimers.current.filter((id) => id !== timer);
    }, 3200);
    reactionTimers.current.push(timer);
  }, []);

  // An id off the wire is resolved against OUR catalogue — a gift this build
  // does not know about draws nothing, rather than an empty frame.
  const receiveGift = useCallback(
    ({ giftId, quantity, from }: LiveGiftPacket) => {
      const gift = LIVE_GIFTS.find((item) => item.id === giftId);
      if (!gift) return;
      spawnGift(gift, quantity, from);
    },
    [spawnGift],
  );

  const live = useLiveReactions(liveRoom, {
    onReceive: spawnReaction,
    onGift: receiveGift,
  });
  /**
   * One tap, three destinations — and it used to reach only two.
   *
   * It DREW a heart locally and BROADCAST one to the room, and there it
   * stopped. Nothing counted, so the tally beside the stream sat at 0 for the
   * whole broadcast however hard the room tapped. The number was not stale; it
   * had never been asked to move.
   *
   * `recordReaction` is the third destination and the only durable one. It is
   * deliberately last: the animation and the broadcast are the moment, and
   * neither may wait on a write. Taps are pooled inside the hook, so hammering
   * the button is one request a second rather than one per heart.
   */
  const recordReaction = useRecordReactions(streamId);
  const react = useCallback(
    (burst = 1) => {
      spawnReaction(burst);
      // The live stream room is heart-only; the emoji set is the gist room's.
      live.react(DEFAULT_REACTION, burst);
      recordReaction(burst);
    },
    [spawnReaction, live, recordReaction],
  );


  const payGift = useSendTip();

  /**
   * Send a gift, and — where the service can settle one — actually pay for it.
   *
   * The burst is drawn and broadcast IMMEDIATELY and unconditionally, because
   * the moment is what the room came for and it must not wait 25-45 seconds on
   * a chain watcher. The money follows its own path: on a priced tray the
   * viewer signs a transfer to the host, and if that fails the toast says so
   * without ever retracting a gift the room has already seen.
   *
   * On a free tray this is exactly what it always was — the shared moment with
   * no money leg, and no "you were charged" language anywhere near it.
   */
  const sendGift = useCallback(
    (gift: LiveGift, quantity: number) => {
      const from = me.data?.displayName ?? "Someone";
      spawnGift(gift, quantity, from);
      live.gift(gift.id, quantity, from);

      if (!giftsArePriced(stream.data?.status)) return;

      const host = stream.data?.owner ?? null;
      if (!host) {
        // No host profile means no wallet to pay: the gift stays the free
        // moment rather than opening a payment that cannot land.
        return;
      }

      const amountKash = multiplyKash(gift.priceKash, quantity);
      if (!amountKash) {
        // No exact total, no charge. Rounding here would bill an amount the
        // sender was never shown.
        toast.error("That quantity can't be priced exactly.");
        return;
      }
      // One toast for the whole send — see the note in house-room. Without a
      // phase the sender saw nothing between the tap and the settle, and a
      // payment waiting on a wallet prompt looked like one that never ran.
      const toastId = `gift:${streamId}:${Date.now()}`;
      void payGift
        .mutateAsync({
          target: { kind: "stream", id: streamId, recipient: host },
          amountKash,
          giftId: gift.id,
          onPhase: (phase) => {
            const says = GIFT_PHASE_SAYS[phase];
            if (says) toast.loading(says, { id: toastId });
          },
        })
        .then(() => {
          // "On its way", never "sent". The service holds the gift `pending`
          // until the watcher sees the transfer on-chain, and saying it landed
          // before that is the one claim this flow may not make.
          toast.success(`${gift.name} on its way to ${host.displayName ?? host.username}`, { id: toastId });
        })
        .catch((error: unknown) => {
          /*
            A TIP THE SERVICE STILL HAS OPEN — see `tipAlreadyInFlight`.
            Nothing here can finish it and paying again would not help, so it
            says what is true: nothing was charged, and it is not the sender's
            fault.
          */
          if (recipientCannotHoldKash(error)) {
            toast.error("That person can't receive gifts yet — their wallet isn't set up for KASH. Nothing was charged.", { id: toastId });
            return;
          }
          if (tipAlreadyInFlight(error)) {
            toast.error("That gift is still being processed — nothing was charged. Come back to it shortly.", { id: toastId });
            return;
          }
          toast.error(
            error instanceof Error && error.message
              ? error.message
              : "The gift was shown, but the payment did not go through.",
            { id: toastId }
          );
        });
    },
    [live, spawnGift, me.data?.displayName, stream.data?.status, stream.data?.owner, streamId, payGift],
  );

  const share = useCallback(() => {
    const url = window.location.href;
    const title = stream.data?.title ?? "Square stream";
    if (navigator.share) {
      void navigator.share({ title, url }).catch(() => {});
    } else {
      void navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
    }
  }, [stream.data?.title]);

  const videoElement = useCallback(() => stageRef.current?.querySelector("video") ?? null, []);
  // LiveKit puts remote audio on its own <audio> elements beside the <video>,
  // so muting the video alone left the room audible. Every media element in
  // the stage moves together.
  const mediaElements = useCallback(
    (): HTMLMediaElement[] =>
      Array.from(stageRef.current?.querySelectorAll<HTMLMediaElement>("video, audio") ?? []),
    []
  );
  const togglePlayback = useCallback(() => {
    const video = videoElement();
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, [videoElement]);
  const restartPlayback = useCallback(() => {
    const video = videoElement();
    if (!video) return;
    if (Number.isFinite(video.duration)) video.currentTime = 0;
    void video.play();
  }, [videoElement]);
  const toggleMute = useCallback(() => {
    const elements = mediaElements();
    if (elements.length === 0) return;
    const next = !elements.some((element) => element.muted);
    elements.forEach((element) => {
      element.muted = next;
    });
    setMuted(next);
  }, [mediaElements]);
  // Transport state is the PLAYER's, not the button's: reflect it rather than
  // hardcoding a pause glyph. The stage swaps its media elements when playback
  // reconnects or a LiveKit track re-subscribes, so re-bind periodically and
  // re-apply the viewer's mute choice to anything newly attached.
  useEffect(() => {
    let bound: HTMLMediaElement | null = null;
    const sync = () => setPaused(Boolean(bound?.paused ?? true));
    const rebind = () => {
      const found = stageRef.current?.querySelector("video");
      if (found !== bound) {
        bound?.removeEventListener("play", sync);
        bound?.removeEventListener("pause", sync);
        bound = found ?? null;
        bound?.addEventListener("play", sync);
        bound?.addEventListener("pause", sync);
        sync();
      }
      if (muted) {
        stageRef.current?.querySelectorAll<HTMLMediaElement>("video, audio").forEach((element) => {
          element.muted = true;
        });
      }
    };
    rebind();
    const interval = window.setInterval(rebind, 1000);
    return () => {
      window.clearInterval(interval);
      bound?.removeEventListener("play", sync);
      bound?.removeEventListener("pause", sync);
    };
  }, [muted]);

  const pictureInPicture = useCallback(() => {
    const video = videoElement();
    if (!video || !("requestPictureInPicture" in video)) return;
    void video.requestPictureInPicture();
  }, [videoElement]);
  const fullscreen = useCallback(() => {
    const node = stageRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen();
  }, []);
  // Theater mode used to call `fullscreen` — the identical handler the
  // Fullscreen button beside it calls, so the room shipped two differently
  // labelled buttons doing one thing. It now means what it means everywhere
  // else (Twitch, Kick): drop the surrounding chrome — the nav rail and the
  // chat column — and leave the stage. It is a toggle, reversible from the
  // same button or with Escape, so nothing becomes unreachable.
  const toggleTheater = useCallback(() => {
    setTheater((on) => {
      if (!on) setChatOpen(false);
      return !on;
    });
  }, []);
  useEffect(() => {
    if (!theater) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTheater(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theater]);

  if (stream.isPending) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <Spinner className="h-8 w-8 text-grey-600" />
      </div>
    );
  }
  if (stream.isError) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black px-4">
        <ErrorState error={stream.error} fallback="Couldn't load this stream." onRetry={() => stream.refetch()} />
      </div>
    );
  }

  const data = stream.data;
  // Ark game broadcast → the route back into Ark. Null for a native stream,
  // and for any game prefix this build does not know.
  const gameCta = resolveCta(data.deepLink, `live:${data.id}`);
  // An Ark-originated stream is a VIEWING surface here: the match lives in the
  // app that owns it, and that is also where you join it.
  const watchOnly = isArkOriginated(data.deepLink);
  const owner = data.owner;
  // Gifting is governance-gated: with it off the panel is absent entirely,
  // and so is every piece of coin chrome that would imply it exists.
  /**
   * Two gates, because gifting is two things and only one of them exists.
   *
   * `giftsAvailable` is the on-stream MOMENT — pick an object, the whole room
   * sees it fly, the host sees who sent it. That needs nothing but the data
   * channel, so it is on for any live stream.
   *
   * `MARKET_FLAGS.liveGifts` is the MONEY — KASH prices, totals, the coin
   * balance, "Get Coins". There is no `POST /streams/{id}/tips` in the spec
   * (checked, not assumed: the tip rail exists but is scoped to posts), so
   * nothing can be charged or credited and every priced surface stays hidden.
   *
   * Collapsing these into one flag is what made the room giftless: the money
   * was not ready, so the moment was withheld too.
   */
  const giftsAvailable = data.status === "live";
  const giftsPriced = giftsArePriced(data.status);
  // The service's own tally, never inflated by unsaved local taps.
  const likeCount = data.likeCount;
  const pulseCounts: PulseCounts = data.pulse;

  return (
    <div className="flex h-dvh w-full bg-black">
      {!theater && <StreamNav stream={data} />}

      {/* Centre column. Below lg it is a full-bleed stage with everything
          overlaid; from lg it becomes the reference's vertical stack:
          header → player → handle → gift panel. */}
      <div
        className="relative min-w-0 flex-1 overflow-hidden bg-black lg:flex lg:flex-col"
        style={{ viewTransitionName: `stream-${data.id}` }}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a, input, textarea")) return;
          react(5);
        }}
      >
        {/* ---- Header ------------------------------------------------- */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 px-4 pb-2 pt-3 lg:static lg:z-auto lg:h-[72px] lg:shrink-0 lg:items-center lg:border-b lg:border-white/10 lg:bg-panel lg:px-5 lg:py-0">
          <Link
            href={sq("/live")}
            aria-label="Back to Live"
            /* Below lg this overlaid chevron IS the exit (the rail starts at
               lg). In theater mode the rail is gone, so it comes back on
               desktop too — the room never has zero ways out. */
            className={cn(
              // It reads as a CONTROL now. A chevron at black/40 over black
              // video is nearly invisible, which is why people said there was
              // no way out of a live room: the exit was there and looked like
              // part of the picture. Glass, a hairline and a label make it a
              // button, and the label is what makes it unambiguous — a lone
              // chevron over a video is as easily "previous" as "leave".
              "ws-press mt-1 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/70 py-2 pl-2 pr-3 text-body backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white",
              !theater && "lg:hidden"
            )}
          >
            <IconChevronLeft className="h-5 w-5" />
            <span className="text-xs font-semibold">Leave</span>
          </Link>

          {owner && (
            <Link href={profileHref(owner)} className="hidden shrink-0 lg:block">
              <Avatar name={owner.displayName} seed={owner.id} src={owner.avatarUrl} size={44} />
            </Link>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {owner ? (
                <>
                  <Link href={profileHref(owner)} className="shrink-0 lg:hidden">
                    <Avatar name={owner.displayName} seed={owner.id} src={owner.avatarUrl} size={36} />
                  </Link>
                  <Link
                    href={profileHref(owner)}
                    className="ws-text-shadow flex min-w-0 items-baseline gap-1.5 lg:[text-shadow:none]"
                  >
                    <span className="truncate text-[17px] font-bold text-heading">{owner.displayName}</span>
                    <VerifiedBadge verification={owner.verification} />
                    {atHandle(owner.username) && (
                      <span className="hidden truncate text-sm text-meta lg:inline">{atHandle(owner.username)}</span>
                    )}
                  </Link>
                </>
              ) : (
                <span className="ws-text-shadow truncate text-[17px] font-bold text-heading lg:[text-shadow:none]">
                  Market Live
                </span>
              )}
            </div>
            {/* Category then the live counters, as the reference stacks them. */}
            <div className="ws-text-shadow mt-0.5 flex items-center gap-3 text-xs text-body lg:text-meta lg:[text-shadow:none]">
              {data.category && (
                <span className="hidden uppercase tracking-wide lg:inline">{data.category}</span>
              )}
              {data.status === "live" && (
                <span className="flex items-center gap-1">
                  <IconEye className="h-4 w-4" />
                  <span className="tnum">{formatCount(data.viewerCount ?? 0)}</span>
                </span>
              )}
              <span className="flex items-center gap-1">
                <IconHeart className="h-4 w-4 text-like" filled />
                <span className="tnum">{formatCount(likeCount)}</span>
              </span>
              <span className="line-clamp-1">{data.title}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-1 lg:pt-0">
            {/* Collapsing the chat column used to be a one-way door: the only
                control lived inside the panel it hid, so on desktop chat could
                never be brought back. The toggle belongs outside it. */}
            <button
              onClick={() => setChatOpen((v) => !v)}
              aria-label={chatOpen ? "Hide chat" : "Show chat"}
              aria-pressed={chatOpen}
              className={cn(
                "hidden h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-body transition-colors hover:bg-white/10 lg:flex",
                chatOpen ? "bg-white/15" : "bg-white/5"
              )}
            >
              <IconComment className="h-4 w-4" />
            </button>
            <button
              onClick={share}
              aria-label="Reshare live stream"
              className="hidden h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-body transition-colors hover:bg-white/10 lg:flex"
            >
              <IconShare className="h-4 w-4" />
            </button>
            {/* The overflow menu and "Subscribe" both used to sit here doing
                nothing. Subscribing to a host IS following them, which the
                Follow control beside this already does, so it was a second
                door with no room behind it. */}
            {/* Follow is the filled, loudest control in the header. */}
            {owner && followSlot?.(owner)}
            {data.status === "live" && !data.myTicket && data.visibility === "ticketed" && (
              <button
                onClick={() => gate(() => setTicketsOpen(true))}
                className="ws-press hidden rounded-lg bg-accent px-4 py-2 text-[13px] font-bold text-ink transition-colors hover:bg-white lg:block"
              >
                Get ticket · {streamPriceLabel(data)}
              </button>
            )}
            {data.status !== "live" && <Pill tone="accent">{streamPriceLabel(data)}</Pill>}
            {/* Ark broadcasts casino games here, but the game itself lives in
                Ark — this is the way back into it. Rendered only when the Ark
                base URL is configured and the game prefix is one we know, so a
                stream from a future game degrades to no button rather than a
                link into nowhere. */}
            {gameCta && (
              <a
                href={gameCta.href}
                target="_blank"
                rel="noreferrer"
                className="ws-btn-create ws-press hidden rounded-lg px-4 py-2 text-[13px] font-bold transition-opacity hover:opacity-90 lg:block"
              >
                {watchOnly ? "Join the match in Ark" : gameCta.label}
              </a>
            )}
          </div>
        </div>

        {/* ---- Player -------------------------------------------------- */}
        <div className="absolute inset-0 lg:static lg:min-h-0 lg:flex-1">
          <div className="relative h-full w-full bg-black lg:flex lg:items-center lg:justify-center">
            {/* The frame takes the SHAPE OF THE STREAM, within limits: 9:16 for
                a phone camera or an unmeasured stream, up to 16:9 for a
                landscape one. It used to be 9:16 unconditionally, which is why
                a host filling their studio tile with a landscape camera watched
                the same camera become a strip in a black column here.

                Phone stays full-bleed: the stage IS the viewport there, with
                the chrome floating over it, and there is no spare width to give
                a wide source. Whatever letterbox survives at either breakpoint
                is filled by the stage's blurred backdrop rather than by black. */}
            <div
              style={{ "--stage-aspect": frameAspect } as CSSProperties}
              className="h-full w-full bg-black lg:aspect-[var(--stage-aspect)] lg:w-auto lg:max-w-full lg:border-x lg:border-white/10"
            >
              <div ref={stageRef} className="h-full w-full">
                <StageBody
                  stream={data}
                  onOpenTickets={() => setTicketsOpen(true)}
                  onQuality={setQuality}
                  onSourceAspect={setSourceAspect}
                />
              </div>
            </div>

            {/* Scrims: gradients, not blur, over video. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-black/85 to-transparent lg:hidden" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/85 to-transparent lg:h-32" />

            {/* Badges live inside the frame, not in the header. */}
            {data.status === "live" && (
              <span className="absolute left-4 top-3 z-10 hidden items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-bold text-heading backdrop-blur-sm lg:flex">
                <IconLive className="h-3.5 w-3.5 text-accent" />
                LIVE creator
              </span>
            )}
            <div className="absolute right-4 top-3 z-10 hidden items-center gap-2 lg:flex">
              {data.status === "live" && (
                <span className="tnum rounded-md bg-black/60 px-2 py-1 text-xs text-body backdrop-blur-sm">
                  <LiveElapsed startedAt={data.startedAt} />
                </span>
              )}
              {data.status === "live" && <LiveBadge />}
            </div>

            {/* Transport and window controls sit ON the frame, bottom edge. */}
            <div className="absolute inset-x-0 bottom-0 z-10 hidden items-center px-5 pb-3 lg:flex">
              <div className="flex items-center gap-1">
                <button
                  onClick={togglePlayback}
                  aria-label={paused ? "Play" : "Pause"}
                  className="rounded-lg p-2 text-heading transition-colors hover:bg-white/10"
                >
                  {paused ? <IconPlay className="h-5 w-5" /> : <IconPause className="h-5 w-5" />}
                </button>
                <button
                  onClick={restartPlayback}
                  aria-label="Restart playback"
                  className="rounded-lg p-2 text-heading transition-colors hover:bg-white/10"
                >
                  <IconRefresh className="h-5 w-5" />
                </button>
                {data.status === "live" && (
                  <>
                    <span className="mx-1 h-5 w-px bg-white/15" aria-hidden />
                    <button
                      onClick={() => setPulseOpen((open) => !open)}
                      aria-label="Open Market Pulse"
                      aria-pressed={pulseOpen}
                      className={cn(
                        "rounded-lg px-2 py-1.5 text-sm font-black transition-colors",
                        pulseOpen ? "bg-accent text-ink" : "text-heading hover:bg-white/10"
                      )}
                    >
                      ↗
                    </button>
                    {/* Watch-only: participation in an Ark broadcast happens
                        in Ark, so the request is hidden rather than disabled —
                        a greyed-out button just invites "why?". */}
                    {!watchOnly && me.data?.id !== data.ownerId && (
                      <GuestSpeakerControl stream={data} />
                    )}
                  </>
                )}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {/* Quality is offered only where it is real: hls.js reports
                    the manifest's renditions, so the menu switches between
                    them. A LiveKit room has no such ladder here, so the
                    control is absent rather than inert. */}
                {quality && quality.levels.length > 1 && (
                  <div className="relative">
                    <button
                      onClick={() => setQualityOpen((open) => !open)}
                      aria-label="Playback quality"
                      aria-expanded={qualityOpen}
                      className="rounded-lg px-2 py-1.5 text-[10px] font-bold tracking-wide text-body transition-colors hover:bg-white/10"
                    >
                      {quality.current === -1
                        ? "AUTO"
                        : `${quality.levels[quality.current]?.height ?? "—"}P`}
                    </button>
                    {qualityOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setQualityOpen(false)} />
                        <div className="ws-popover absolute bottom-full right-0 z-20 mb-2 w-32 rounded-2xl p-1.5">
                          <button
                            onClick={() => {
                              quality.setLevel(-1);
                              setQualityOpen(false);
                            }}
                            className={cn(
                              "block w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10",
                              quality.current === -1 ? "text-heading" : "text-body"
                            )}
                          >
                            Auto
                          </button>
                          {quality.levels.map((level, index) => (
                            <button
                              key={`${level.height}-${index}`}
                              onClick={() => {
                                quality.setLevel(index);
                                setQualityOpen(false);
                              }}
                              className={cn(
                                "block w-full rounded-xl px-3 py-2 text-left text-xs transition-colors hover:bg-white/10",
                                quality.current === index ? "text-heading" : "text-body"
                              )}
                            >
                              {level.height}p
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <button
                  onClick={toggleTheater}
                  aria-label={theater ? "Exit theater mode" : "Theater mode"}
                  aria-pressed={theater}
                  className={cn(
                    "rounded-lg p-2 text-heading transition-colors hover:bg-white/10",
                    theater && "bg-white/15"
                  )}
                >
                  <IconTheater className="h-5 w-5" />
                </button>
                <button
                  onClick={pictureInPicture}
                  aria-label="Picture in picture"
                  className="rounded-lg p-2 text-heading transition-colors hover:bg-white/10"
                >
                  <IconPip className="h-5 w-5" />
                </button>
                <button
                  onClick={fullscreen}
                  aria-label="Fullscreen"
                  className="rounded-lg p-2 text-heading transition-colors hover:bg-white/10"
                >
                  <IconFullscreen className="h-5 w-5" />
                </button>
                <button
                  onClick={toggleMute}
                  aria-label={muted ? "Unmute" : "Mute"}
                  className="rounded-lg p-2 text-heading transition-colors hover:bg-white/10"
                >
                  <IconVolume className="h-5 w-5" muted={muted} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Host handle under the frame, as in the reference. */}
        {owner && (
          <Link
            href={profileHref(owner)}
            className="hidden shrink-0 px-5 py-2 text-[13px] text-meta transition-colors hover:text-body lg:block"
          >
            {owner.username}
          </Link>
        )}

        {/* ---- Gift panel: its own slab under the player -------------- */}
        {giftsAvailable && (
          <div className="mx-4 mb-4 hidden shrink-0 overflow-hidden rounded-2xl bg-raised lg:block">
            <div className="flex items-stretch">
              <div className="flex flex-1 items-center gap-1 overflow-x-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {LIVE_GIFTS.map((gift) => (
                  <button
                    key={gift.id}
                    onClick={() => gate(() => sendGift(gift, 1))}
                    className="ws-press group flex h-[82px] w-24 shrink-0 flex-col items-center justify-center rounded-xl border border-transparent px-2 transition-colors hover:border-white/10 hover:bg-white/5"
                  >
                    {/* The same artwork the tray shows — one catalogue, one
                        look. This strip used to print the emoji that stood in
                        for it. */}
                    <span className="relative block h-8 w-8 transition-transform group-hover:-translate-y-1">
                      <Image src={gift.art} alt="" fill sizes="32px" className="object-contain" />
                    </span>
                    <span className="mt-1.5 max-w-full truncate text-[12px] font-semibold text-body">
                      {gift.name}
                    </span>
                    {/* A price only where one is charged — see `giftsPriced`. */}
                    {giftsPriced && (
                      <span className="tnum mt-0.5 flex items-center gap-1 text-[11px] text-meta">
                        <IconCoin className="h-3 w-3 text-coin" />
                        {/* Coins, like every other tile in the app — the strip
                            and the tray it opens must not quote two units for
                            the same rose. */}
                        {gift.priceCoins.toLocaleString()}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                onClick={() => gate(() => setGiftsOpen(true))}
                aria-label="View all gifts"
                className="ws-press my-3 mr-3 flex w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-body transition-colors hover:bg-white/10"
              >
                <IconChevronUp className="h-4 w-4" />
              </button>
            </div>

            {/* The balance strip is gone: it read a hardcoded "0" from no
                ledger, and "Get Coins" only reopened this same tray. */}
          </div>
        )}

        {/* ---- Mobile-only overlays ------------------------------------ */}
        {chatOpen && (
          <div
            className="absolute bottom-0 left-0 z-10 h-[42dvh] w-[min(340px,78vw)] px-3 lg:hidden"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
          >
            <ChatPanel stream={data} variant="overlay" />
          </div>
        )}

        {/* The vertical action rail is the phone pattern; on desktop these
            actions live in the header, the gift panel and the chat column. */}
        <div className="absolute bottom-4 right-3 z-10 flex flex-col items-center gap-4 lg:hidden">
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => react(1)}
              aria-label={`Send a heart. ${likeCount} likes`}
              className="ws-press flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-heading"
            >
              <IconHeart className="h-6 w-6 text-like" filled />
            </button>
            <span className="tnum ws-text-shadow min-w-11 text-center text-[11px] font-bold text-white">
              {formatCount(likeCount)}
            </span>
          </div>
          {giftsAvailable && (
            // GOLD ONLY WHEN IT COSTS SOMETHING. `--color-coin` is the one gold
            // left in the product and it means exactly one thing: money. A free
            // gift wearing the coin token and the coin glyph would be claiming
            // a charge in the loudest way the palette can, before the sheet
            // even opens. Free rides the silver ramp, like every other action.
            <button
              onClick={() => gate(() => setGiftsOpen(true))}
              aria-label={giftsPriced ? "Send a live gift" : "Send a free gift the whole room sees"}
              className={cn(
                "ws-press flex h-11 w-11 items-center justify-center rounded-full text-ink transition-colors hover:brightness-110",
                giftsPriced ? "bg-coin" : "bg-accent"
              )}
            >
              {giftsPriced ? <IconCoin className="h-5 w-5" /> : <IconSpark className="h-5 w-5" filled />}
            </button>
          )}
          {data.status === "live" && !watchOnly && me.data?.id !== data.ownerId && (
            <GuestSpeakerControl stream={data} />
          )}
          {/* The mobile rail's onward action for an Ark broadcast. The header
              CTA is desktop-only, so without this a phone viewer would have no
              way into the match at all. */}
          {watchOnly && gameCta && (
            <a
              href={gameCta.href}
              target="_blank"
              rel="noreferrer"
              aria-label="Join the match in Ark"
              className="ws-btn-create ws-press flex h-11 w-11 flex-col items-center justify-center rounded-full"
            >
              <IconPlay className="h-5 w-5" />
              <span className="text-[8px] font-bold leading-none">ARK</span>
            </a>
          )}
          {data.status === "live" && (
            <button
              onClick={() => setPulseOpen((open) => !open)}
              aria-label="Open Market Pulse"
              aria-pressed={pulseOpen}
              className={cn(
                "ws-press flex h-11 w-11 items-center justify-center rounded-full text-lg font-black",
                pulseOpen ? "bg-accent text-ink" : "bg-black/40 text-heading"
              )}
            >
              ↗
            </button>
          )}
          <button
            onClick={() => setChatOpen((v) => !v)}
            aria-label={chatOpen ? "Hide chat" : "Show chat"}
            aria-pressed={chatOpen}
            className={cn(
              "ws-press flex h-11 w-11 items-center justify-center rounded-full",
              chatOpen ? "bg-accent text-ink" : "bg-black/40 text-heading"
            )}
          >
            <IconComment className="h-5 w-5" />
          </button>
          <button
            onClick={share}
            aria-label="Share"
            className="ws-press flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-heading"
          >
            <IconLink className="h-5 w-5" />
          </button>
          {data.status === "live" && !data.myTicket && data.visibility === "ticketed" && (
            <button
              onClick={() => setTicketsOpen(true)}
              aria-label="Get ticket"
              className="ws-press flex h-11 w-11 items-center justify-center rounded-full bg-accent text-ink"
            >
              <IconTicket className="h-5 w-5" />
            </button>
          )}
        </div>

        {pulseOpen && data.status === "live" && (
          <div
            className="absolute bottom-20 right-16 z-20 lg:bottom-24 lg:left-5 lg:right-auto"
            style={{ marginBottom: "max(env(safe-area-inset-bottom), 16px)" }}
          >
            <MarketPulse counts={pulseCounts} />
          </div>
        )}

        {/* Floating tap reactions. */}
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
          {reactions.map((reaction) => (
            <span
              key={reaction.id}
              className="ws-reaction bottom-24"
              style={{
                right: `${reaction.left}%`,
                color: reaction.color,
                ["--rx" as string]: `${reaction.drift}px`,
                ["--rr" as string]: `${reaction.rotate}deg`,
                ["--rd" as string]: `${reaction.duration}s`,
              }}
            >
              <span style={{ width: reaction.size, height: reaction.size }} className="block">
                <IconHeart className="h-full w-full" filled />
              </span>
            </span>
          ))}
          <div className="absolute inset-x-0 top-[28%] flex flex-col items-center gap-3 px-4">
            {giftBursts.map((burst) => (
              <div
                key={burst.id}
                className="ws-gift-burst flex items-center gap-3 rounded-full border border-white/20 bg-black/65 py-2 pl-3 pr-5 shadow-2xl backdrop-blur-md"
              >
                {/* The burst shows the gift that was actually sent, not a
                    stand-in for it — same artwork as the tray. The quantity
                    was tinted per-gift from a colour the catalogue carried
                    only for that purpose; it reads as the accent now, which is
                    the one the rest of the room uses for emphasis. */}
                <span className="relative block h-9 w-9 shrink-0">
                  <Image src={burst.gift.art} alt="" fill sizes="36px" className="object-contain" />
                </span>
                <span className="min-w-0">
                  {/* "Gift sent" said nothing — every burst is a gift being
                      sent. The sender's name is the information, and it is what
                      lets a host thank somebody by name mid-stream. */}
                  <span className="block max-w-[160px] truncate text-xs font-semibold text-grey-300">
                    {burst.from}
                  </span>
                  <span className="block text-sm font-bold text-white">
                    {burst.gift.name}{" "}
                    {burst.quantity > 1 && <span className="text-accent">×{burst.quantity}</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Desktop theater: collapsible 340px chat column on raised surface. */}
      <aside
        className={cn(
          "hidden h-dvh shrink-0 flex-col border-l border-white/10 bg-panel text-body transition-[width] duration-200 lg:flex",
          chatOpen ? "w-[360px] 2xl:w-[430px]" : "w-0 overflow-hidden border-l-0"
        )}
      >
        {chatOpen && (
          <div className="flex h-full flex-col">
            <div className="ws-hair flex h-[72px] shrink-0 items-center gap-3 border-b px-4">
              <button
                onClick={() => setChatOpen(false)}
                aria-label="Collapse chat"
                className="ws-press rounded-lg p-2 text-body transition-colors hover:bg-white/10"
              >
                <IconCollapseRight className="h-5 w-5" />
              </button>
              <p className="ws-display flex-1 text-center text-base">LIVE chat</p>
              <span className="flex items-center gap-1.5 text-xs text-meta">
                <IconEye className="h-4 w-4" />
                <span className="tnum">{formatCount(data.viewerCount ?? 0)}</span>
              </span>
            </div>
            <div className="relative min-h-0 flex-1">
              <ChatPanel stream={data} variant="theater" showTopViewers />
              {data.status === "live" && (
                <button
                  onClick={() => react(1)}
                  aria-label={`Send a heart. ${likeCount} likes`}
                  className="ws-press absolute bottom-[92px] right-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-like backdrop-blur-md transition-colors hover:bg-white/15"
                >
                  <IconHeart className="h-7 w-7" filled />
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      <TicketSheet stream={data} open={ticketsOpen} onClose={() => setTicketsOpen(false)} />
      {/*
        Mounted on `giftsAvailable`, the SAME gate as the buttons that open it.

        It used to be mounted behind `MARKET_FLAGS.liveGifts` while both
        openers — the desktop "view all" chevron and the mobile gift button —
        were gated on `giftsAvailable`. With the flag off, which is its default
        and its value in every environment today, tapping either one set
        `giftsOpen` and rendered nothing at all. On a phone that button is the
        ONLY way to reach the tray, so gifting was silently dead there.

        The money half is already handled one level down: `priced` is what
        decides whether prices and coin chrome appear, so the flag still
        governs everything it is meant to govern without also deciding whether
        the dialog exists.
      */}
      {/*
        THE COIN PURCHASE, NOT THE KASH ONE.

        Being short of COINS opened the KASH top-up, which is a different
        currency: somebody with KASH already in their wallet was sent to buy
        more KASH and came back with exactly as many coins as before — none.
        The two are not interchangeable; KASH is the money, coins are what this
        tray spends, and `CoinBuySheet` is the only place they convert.
      */}
      <CoinBuySheet
        open={topUpOpen}
        needed={topUpNeeded}
        onClose={() => setTopUpOpen(false)}
      />
      {giftsAvailable && (
        <GiftSheet
          open={giftsOpen}
          onClose={() => setGiftsOpen(false)}
          onSend={sendGift}
          priced={giftsPriced}
          /* Read only while the tray is open — see the note in house-room. A
             broadcast's tray IS priced once the flag is on, so this is the
             surface where affordability bites first. */
          balanceCoins={giftCoins}
          onTopUp={(needed) => {
          setTopUpNeeded(needed);
          setTopUpOpen(true);
        }}
        />
      )}
    </div>
  );
}

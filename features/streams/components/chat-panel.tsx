"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { errorCode } from "@/lib/api/envelope";
import { useGate } from "@/hooks/use-gate";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/ui/states";
import { IconChevronDown, IconDots, IconEmoji, IconSend } from "@/components/ui/icons";
import { EmojiPicker } from "@/components/ui/emoji-picker";
// The gist room's own glyphs, exported from the file. See room-icons.tsx.
import {
  IconEmojiAdd,
  IconRoomHeart,
  IconRoomSend,
  IllustrationEmptyChat,
} from "@/components/ui/room-icons";
import { useQueryClient } from "@tanstack/react-query";
import type { Room } from "livekit-client";
import { useChat, useChatHistory, useChatReaction, useSendChat } from "@/features/streams/hooks/use-chat";
import { useLiveChat, useLiveChatPublish } from "@/features/streams/hooks/use-live-chat";
import { baseIdentity } from "@/features/streams/lib/stage";
import { useMentionTyping } from "@/hooks/use-mention-typing";
import { useRoomChatSignal } from "@/features/streams/hooks/use-room-chat-signal";
import { isReplySwipe, SWIPE_TRIGGER, swipeCommits, swipeOffset } from "@/lib/swipe-reply";
import { DEFAULT_REACTION } from "@/lib/reactions";
import { MentionPicker } from "@/components/ui/mention-picker";
import { mentionCandidates, type MentionableMember } from "@/lib/mentionable-members";
import { OLDER_THRESHOLD_PX, oldestFirst, preservedScrollTop } from "@/lib/chat-order";
import type { ChatMessage, Stream } from "@/features/streams/lib/types";

export interface ChatModeration {
  onRemove: (messageId: string) => void;
  onBan: (userId: string) => void;
}

// Rank 1 gets its own column; 2 and 3 stack beside it, which is how TikTok
// weights the leader without a chart.
function TopViewers({ messages }: { messages: ChatMessage[] }) {
  const leaders = useMemo(() => {
    const seen = new Set<string>();
    return messages
      .filter((message) => {
        if (!message.author || seen.has(message.authorId)) return false;
        seen.add(message.authorId);
        return true;
      })
      .slice(0, 3);
  }, [messages]);

  return (
    <div className="ws-hair shrink-0 border-b px-5 py-4">
      {/* A label, not a control: there is no expanded leaderboard behind it,
          so it no longer dresses itself as a link. */}
      <p className="mb-3 text-[13px] font-semibold text-meta">Top viewers</p>

      {leaders.length === 0 ? (
        <p className="text-[13px] text-grey-600">Viewer rankings appear as chat gets going.</p>
      ) : (
        <div className="flex items-center gap-4">
          {leaders[0] && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="ws-display text-3xl leading-none text-create">1</span>
              <span className="text-center">
                <span className="block rounded-[25%] p-[2px] ring-2 ring-create/60">
                  <Avatar
                    name={leaders[0].author?.displayName ?? "Viewer"}
                    seed={leaders[0].authorId} src={leaders[0].author?.avatarUrl}
                    size={46}
                  />
                </span>
                <span className="mt-1 block max-w-16 truncate text-[11px] text-body">
                  {leaders[0].author?.displayName}
                </span>
              </span>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {leaders.slice(1).map((message, index) => (
              <div key={message.authorId} className="flex min-w-0 items-center gap-2">
                <span className="ws-display w-3 shrink-0 text-base leading-none text-grey-500">
                  {index + 2}
                </span>
                <Avatar
                  name={message.author?.displayName ?? "Viewer"}
                  seed={message.authorId} src={message.author?.avatarUrl}
                  size={26}
                />
                <span className="min-w-0 truncate text-[12px] text-body">
                  {message.author?.displayName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  stream,
  variant = "card",
  heading = false,
  moderation,
  showTopViewers = false,
  members = [],
  liveRoom = null,
}: {
  stream: Stream;
  /**
   * THE ROOM'S LIVE CONNECTION, when this panel is inside one.
   *
   * Present, chat is DELIVERED over the data channel every participant is
   * already on, and the interval drops to a slow floor. Absent — a feed card,
   * a broadcast without a joined room — nothing changes and the poll carries
   * the panel exactly as it did. See `use-live-chat` for why the message
   * travels rather than a refetch signal.
   */
  liveRoom?: Room | null;
  /**
   * EVERYONE IN THE ROOM, for the @ picker.
   *
   * A gist room's chat is a conversation between people who are present, so
   * the list to offer is the people on the stage and in the audience — not
   * the whole directory, and not only the handful who have happened to TYPE
   * something. Passed in because only the room knows who is in it; empty
   * everywhere else, which simply means the picker offers whoever the
   * service's own search finds.
   */
  members?: MentionableMember[];
  /**
   * "overlay": transparent column over video — masked top fade, text shadows,
   * glass input, no panel chrome.
   *
   * "room": the GIST ROOM's chat (node 129:12852) — purple bubbles with the
   * author's name and handle inside them, a 24px avatar hung off the bubble's
   * bottom-left corner, and the file's pill composer. It is deliberately NOT
   * the live room's monochrome flat rows: the two surfaces are drawn
   * differently in the file, and a gist room's chat is a conversation between
   * a few dozen people rather than a scrolling broadcast wall.
   */
  variant?: "card" | "overlay" | "theater" | "room";
  /**
   * A caller that draws its OWN title suppresses this one.
   *
   * The gist room heads the column "Gistroom Chat" (node 129:11748), and the
   * card variant's own "Chat" underneath it made the panel say its name twice.
   */
  heading?: boolean;
  /** Host-only moderation menu (remove message / ban author). */
  moderation?: ChatModeration;
  showTopViewers?: boolean;
}) {
  const queryClient = useQueryClient();
  /*
    THE POLL IS A FLOOR, NOT THE TRANSPORT, once a room is connected.

    12 requests a minute per viewer — 55% of all room traffic — spent mostly
    on being told nothing had changed. With live delivery the interval exists
    only to heal a dropped packet, so 30 seconds is enough and the saving is
    the other 10. Without a room it stays exactly what it was.
  */
  const live = Boolean(liveRoom);
  const chat = useChat(stream.id, stream.status === "live", live ? 30_000 : undefined);

  /*
    A MESSAGE FROM SOMEBODY ELSE, delivered rather than fetched.

    Written straight into the head page so the line appears at once. The poll
    still replaces it with the service's own row within 30 seconds, which is
    what makes this safe: a peer can at worst show a line that vanishes, never
    create one. The author is resolved from the people actually in the room —
    LiveKit's identity is authenticated, so this is a lookup and not a claim.
  */
  const publishChat = useLiveChatPublish(liveRoom ?? null);
  useLiveChat(liveRoom ?? null, (packet) => {
    const authorId = baseIdentity(packet.fromIdentity);
    const author = members.find((member) => member.id === authorId) ?? null;
    queryClient.setQueryData(["ms", "stream", stream.id, "chat"], (current: unknown) => {
      if (typeof current !== "object" || current === null || !("items" in current)) return current;
      const page = current as { items: ChatMessage[] };
      // The poll may have arrived first; one message, one row.
      if (page.items.some((item) => item.id === packet.id)) return current;
      const arrived: ChatMessage = {
        id: packet.id,
        streamId: stream.id,
        authorId,
        text: packet.text,
        status: "active",
        createdAt: packet.createdAt,
        author: author ? { id: author.id, username: author.username, displayName: author.displayName } : null,
        replyTo: null,
        reactions: [],
        myReaction: null,
      } as unknown as ChatMessage;
      // Newest first, matching the page the service returns.
      return { ...page, items: [arrived, ...page.items] };
    });
  });
  // ADR-0009 over the top of it: the interval stays the floor, the frame makes
  // it immediate. Inert until the service publishes the room's topic.
  useRoomChatSignal(stream.id, stream, stream.status === "live");
  const send = useSendChat(stream.id);
  /*
    THE LIST IS READ OLDEST → NEWEST, and the page arrives the other way round.
    The polled head is one page, newest first; the history behind it is
    fetched only when the reader scrolls up for it (`useChatHistory`). Both go
    through `oldestFirst`, which merges, de-duplicates and orders them, so the
    newest message is always the LAST item and the pin-to-bottom logic below
    tracks the right end. Drawn in page order, the newest sat at the top and
    the list could not scroll (ogazboiz, 2026-09-13).
  */
  const history = useChatHistory(stream.id, chat.data?.nextCursor ?? null, stream.status === "live");
  const ordered = useMemo(
    () => oldestFirst(...(history.data?.pages.map((page) => page.items) ?? []), chat.data?.items ?? []),
    [history.data, chat.data]
  );
  const hasOlder = history.data ? history.hasNextPage : (chat.data?.nextCursor ?? null) !== null;
  const gate = useGate();
  /*
    THE MESSAGE BEING ANSWERED.

    A room chat moves fast and several conversations share one column, so
    "which of these were you answering?" is the question a reply exists to
    settle (ogazboiz, 2026-09-21). One level, never a thread: a reply to a
    reply points at that message, which is what the DM pane does and what
    keeps a live column readable.
  */
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  /*
    SWIPE A MESSAGE TO ANSWER IT — the gesture the DM thread already has.

    The reply control here appears on HOVER, which on a phone is no control at
    all: ogazboiz went looking for it and found nothing (2026-09-21). The rules
    are `lib/swipe-reply`, shared with the thread, so the two surfaces cannot
    disagree about what counts as a swipe — claimed only once the drag is
    clearly HORIZONTAL, because this column's main gesture is scrolling and a
    finger travelling up always drifts sideways.

    ONE row at a time, so this is a single piece of state rather than state per
    bubble: two fingers dragging two messages is not a gesture anybody makes.
  */
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const love = useChatReaction(stream.id);

  /*
    The gesture itself. Claimed only once it is clearly horizontal, committed
    only on RELEASE — a reply that fired under a moving finger would be one
    nobody chose to send — and the row springs back either way.
  */
  const startDrag = (message: ChatMessage, event: React.PointerEvent) => {
    if (event.pointerType === "mouse") return;
    dragFrom.current = { x: event.clientX, y: event.clientY };
    dragging.current = false;
    setDrag({ id: message.id, dx: 0 });
  };
  const moveDrag = (event: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (!isReplySwipe(dx, dy)) return;
    dragging.current = true;
    setDrag((current) => (current ? { ...current, dx: swipeOffset(dx) } : current));
  };
  const endDrag = (message: ChatMessage, event: React.PointerEvent) => {
    const from = dragFrom.current;
    if (from && dragging.current) {
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (swipeCommits(dx, dy)) setReplyTo(message);
    }
    dragFrom.current = null;
    dragging.current = false;
    setDrag(null);
  };

  const inputRef = useRef<HTMLInputElement>(null);
  /*
    TYPING @ OFFERS THE PEOPLE IN THE ROOM.

    The same hook and the same picker the DM composer uses, so a mention is one
    behaviour in this product rather than two that drift. It had none at all
    until now — the plumbing was here, the picker was not, and typing @ simply
    did nothing (ogazboiz, 2026-09-21: "I want to @someone in the room but it
    is not working").

    WHO IT OFFERS: everyone on the stage and in the audience, handed down by
    the room, ahead of whatever the service's own search finds. A gist room's
    chat is a conversation between people who are PRESENT, and the person you
    want to name is almost always one of the faces above the column. Anyone
    who has spoken is already among them.

    The ids are read back out of the TEXT on send (`mentionsFor`), never
    accumulated as they are picked: a handle typed and then deleted is not a
    mention, and sending it would notify somebody the sender changed their mind
    about.
  */
  const typing = useMentionTyping({
    max: 500,
    field: inputRef,
    candidates: (found, query) => mentionCandidates({ found, members, query }),
  });
  const draft = typing.text;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The gist room's chat composer has a full emoji picker (it is a MESSAGE
  // field, not the six-glyph reaction bar) that types the glyph into the draft.
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  /**
   * Follow the live chat the way every broadcast app does: ride the bottom
   * while you are at the bottom, and stop the moment the reader scrolls up.
   *
   * The old version keyed on `items.length` and set `scrollTop` outright, which
   * failed in both directions. It MISSED arrivals, because the endpoint answers
   * with a window rather than the whole history — once that window is full the
   * count stops changing, every later message replaces an older one, and the
   * effect never fires again. And when it did fire it yanked the reader back
   * down mid-sentence, which is the one thing a chat must not do to somebody
   * reading what was said thirty seconds ago.
   *
   * So: key on the LAST MESSAGE ID (a window that slides still changes its last
   * id), and only follow while pinned. Unpinned, the new messages are counted
   * and offered on a pill instead — the reader decides when to rejoin the live
   * edge, which is exactly the affordance TikTok and YouTube put there.
   */
  const lastId = ordered.length > 0 ? ordered[ordered.length - 1].id : null;
  // Pinning is a REF, not state: nothing renders from it, and the arrival
  // effect must not re-run when it flips — scrolling up would otherwise be the
  // thing that triggers a scroll. `behind` is the only part that renders.
  const pinnedRef = useRef(true);
  const [behind, setBehind] = useState(0);
  // First paint jumps; every message after that glides. An animated scroll on
  // mount is the panel appearing to load in front of you.
  const settled = useRef(false);

  const jumpToLatest = useCallback((smooth: boolean) => {
    const node = listRef.current;
    if (!node) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth && !reduced ? "smooth" : "auto" });
    pinnedRef.current = true;
    setBehind(0);
  }, []);

  useEffect(() => {
    if (!lastId) return;
    if (pinnedRef.current) {
      jumpToLatest(settled.current);
      settled.current = true;
      return;
    }
    setBehind((previous) => previous + 1);
  }, [lastId, jumpToLatest]);

  // 48px of slack, not equality: a smooth scroll lands a fraction short, and
  // sub-pixel heights mean `scrollTop + clientHeight === scrollHeight` is a
  // condition that is briefly false while sitting still at the bottom.
  // OLDER MESSAGES LOAD FROM THE TOP. Nearing the top edge asks for the next
  // page back; the list's height before the page lands is remembered so the
  // reader stays on the line they were reading once it is inserted above.
  const heightBeforeOlder = useRef<{ top: number; height: number } | null>(null);
  const { fetchNextPage, isFetchingNextPage } = history;
  const handleScroll = () => {
    const node = listRef.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    pinnedRef.current = atBottom;
    if (atBottom) setBehind(0);
    if (node.scrollTop < OLDER_THRESHOLD_PX && hasOlder && !isFetchingNextPage && !heightBeforeOlder.current) {
      heightBeforeOlder.current = { top: node.scrollTop, height: node.scrollHeight };
      void fetchNextPage();
    }
  };
  const firstId = ordered.length > 0 ? ordered[0].id : null;
  useLayoutEffect(() => {
    const node = listRef.current;
    const before = heightBeforeOlder.current;
    if (!node || !before) return;
    node.scrollTop = preservedScrollTop(before.top, before.height, node.scrollHeight);
    heightBeforeOlder.current = null;
  }, [firstId]);

  const gatedByTicket =
    stream.visibility === "ticketed" && !stream.myTicket && errorCode(send.error) === "FORBIDDEN";

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    gate(() =>
      send.mutate(
        {
          text,
          ...(replyTo ? { replyToId: replyTo.id } : {}),
          // Only the handles STILL WRITTEN in the line: a name picked and then
          // deleted is not a mention, and sending it would notify somebody the
          // sender decided against.
          ...(typing.mentionsFor(text).length > 0
            ? { mentions: typing.mentionsFor(text).map((mention) => mention.id) }
            : {}),
        },
        {
        onSuccess: (sent) => {
          // Tell the room at once. AFTER the service accepted it, never
          // instead: the packet is an early copy of a message that already
          // exists, so a failed post publishes nothing.
          if (sent) publishChat(sent);
          typing.reset();
          setReplyTo(null);
          // Saying something is opting back into the live edge: nobody types a
          // message and then wants to keep reading history.
          jumpToLatest(true);
        },
        }
      )
    );
  };

  // Insert at the caret so a picked emoji lands where the reader is typing, not
  // always at the end; caps at the input's own 300 and restores the caret after
  // the glyph. The picker stays open so several can be added in a row.
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    {
      const prev = typing.text;
      const start = el?.selectionStart ?? prev.length;
      const end = el?.selectionEnd ?? prev.length;
      const next = (prev.slice(0, start) + emoji + prev.slice(end)).slice(0, 300);
      const caret = Math.min(start + emoji.length, next.length);
      // Through the hook, so an @ token already being typed is re-measured
      // rather than left pointing at a caret that has moved.
      typing.replace(next, caret);
      if (el) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(caret, caret);
        });
      }
    }
  };

  // Dismiss the picker on a click away from it or Escape.
  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (event: PointerEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(event.target as Node)) {
        setEmojiOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  const overlay = variant === "overlay";
  const theater = variant === "theater";
  const room = variant === "room";

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        overlay ? "max-w-[340px]" : theater ? "bg-panel" : room ? "" : "ws-card"
      )}
    >
      {variant === "card" && !heading && (
        <p className="ws-display ws-hair border-b px-4 py-3 text-sm">Chat</p>
      )}

      {theater && showTopViewers && <TopViewers messages={chat.data?.items ?? []} />}

      <ul
        ref={listRef}
        onScroll={handleScroll}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          overlay
            ? "ws-chat-mask space-y-2 px-1 py-2"
            : room
              ? // BOTTOM-ANCHORED. Node 215:2888 puts the three bubbles at
                // y=629 in a 981-tall column — hard against the composer, with
                // the empty space ABOVE them. A top-aligned list left a short
                // conversation stranded at the top of a 900px panel with a
                // field far below it, which is not how any chat reads.
                // The anchoring is an AUTO MARGIN on a spacer (below), not
                // `justify-end`: a flex column justified to its end pushes its
                // overflow above the scroll origin where no scrollbar reaches
                // it, which is why a full chat could not scroll at all.
                "flex flex-col gap-4 px-4 py-4"
              : "px-3 py-3"
        )}
      >
        {chat.isPending &&
          [0, 1, 2, 3].map((i) => (
            <li key={i} className="flex gap-2.5 px-2 py-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-1.5 py-0.5">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-2.5 w-4/5" />
              </div>
            </li>
          ))}
        {chat.isSuccess &&
          chat.data.items.length === 0 &&
          (room ? (
            /*
              NODE 166:12933 — the Gistroom Chat empty state, which the file
              draws in full and earlier passes replaced with a one-line
              sentence.

              THE FILE'S NUMBERS: a 352-wide column centred in the panel with a
              40px gap, holding the 120x120 illustration (166:12938) over a
              second column at gap 8 — "Start chatting" at Bold 20 with
              0.01em of tracking, then "Be the first to start the conversation"
              at 16/24 in 50% white.

              It is CENTRED in the panel, so this list stops bottom-anchoring
              while it is the only thing in it — the bubbles hug the composer,
              but an illustration pinned to the composer would read as a
              message somebody sent.
            */
            <li className="flex flex-1 flex-col items-center justify-center gap-10 px-4 text-center">
              <IllustrationEmptyChat className="h-[120px] w-[120px] text-white" />
              <div className="flex flex-col items-center gap-2">
                <p className="max-w-[244px] text-[20px] font-bold leading-tight tracking-[0.01em] text-white">
                  {stream.status === "live" ? "Start chatting" : "Chat is closed"}
                </p>
                <p className="text-[16px] leading-6 text-white/50">
                  {stream.status === "live"
                    ? "Be the first to start the conversation"
                    : "Chat opens when the gist room is live."}
                </p>
              </div>
            </li>
          ) : (
            <li className="py-6 text-center text-[13px] text-grey-500">
              {stream.status === "live"
                ? "No messages yet — say hi."
                : "Chat opens when the stream is live."}
            </li>
          ))}

        {room && <li aria-hidden className="mt-auto shrink-0" />}
        {room && isFetchingNextPage && (
          <li className="flex justify-center py-1 text-xs text-body/60">Loading earlier messages…</li>
        )}
        {room
          ? ordered.map((message) => (
              <RoomBubble
                key={message.id}
                message={message}
                isHost={message.authorId === stream.ownerId}
                onReply={setReplyTo}
                onLove={(target, loved) =>
                  gate(() => love.mutate({ messageId: target.id, emoji: DEFAULT_REACTION, loved }))
                }
                dragX={drag?.id === message.id ? drag.dx : 0}
                onDragStart={startDrag}
                onDragMove={moveDrag}
                onDragEnd={endDrag}
              />
            ))
          : ordered.map((message) => (
            <li
              key={message.id}
              className={cn(
                "group/chat-row group relative flex gap-2.5 rounded-xl px-2 py-1.5 transition-colors",
                overlay ? "ws-text-shadow" : "hover:bg-white/[0.04]"
              )}
            >
              <Avatar
                name={message.author?.displayName ?? message.authorId.slice(-4) ?? "?"}
                seed={message.authorId} src={message.author?.avatarUrl}
                size={32}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                {/* Name row stays quiet so the message itself is what reads. */}
                <p className="flex items-center gap-1.5 text-[13px] text-meta">
                  <span className="truncate font-semibold">
                    {message.author?.displayName ?? `Member ·${message.authorId.slice(-4)}`}
                  </span>
                  {/* Host by ownership; creator/worldstreet by hydrated role. */}
                  {message.authorId === stream.ownerId ? (
                    <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-ink">
                      Host
                    </span>
                  ) : message.author && message.author.role !== "citizen" ? (
                    <span className="shrink-0 rounded-full border border-white/20 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-body">
                      {message.author.role === "worldstreet" ? "WorldStreet" : message.author.role}
                    </span>
                  ) : null}
                  {overlay && <span className="shrink-0">· {relativeTime(message.createdAt)}</span>}
                </p>
                {/* THE MESSAGE THIS ONE ANSWERS, above the words that answer
                    it. Drawn only where the service sent one, so a chat from
                    before replies existed reads exactly as it did. */}
                {message.replyTo && (
                  <p className="mb-1 flex items-center gap-1.5 rounded-md border-l-2 border-white/25 bg-white/[0.05] px-2 py-1 text-[12px] leading-[16px] text-meta">
                    {/* The quote carries an authorId and no second author
                        object — the page already holds every author, so a copy
                        per quote would be the same profile twice. */}
                    <span className="truncate">
                      {message.replyTo.deleted ? "Message deleted" : message.replyTo.text}
                    </span>
                  </p>
                )}
                <p className="break-words text-[14px] font-medium leading-snug text-heading">
                  {message.text}
                </p>
              </div>

              {/* REPLY — the one action on somebody else's message here. It is
                  drawn beside the row rather than hidden behind a long press,
                  because a live column scrolls and a gesture nobody finds is
                  not an affordance. (This is the LIVE STREAM chat, which has no
                  swipe wiring — the gist room's RoomBubble is the surface where
                  the swipe replaced the visible arrow.) */}
              <button
                type="button"
                onClick={() => setReplyTo(message)}
                aria-label={"Reply to " + (message.author?.displayName ?? "this message")}
                title="Reply"
                className="ws-press mt-0.5 shrink-0 self-start rounded-full p-1.5 text-meta opacity-0 transition-opacity hover:bg-white/10 hover:text-heading focus-visible:opacity-100 group-hover/chat-row:opacity-100"
              >
                {/* A curved arrow back — drawn inline because the house set
                    has no reply glyph and one borrowed from elsewhere would
                    mean something else. */}
                <svg
                  aria-hidden
                  viewBox="0 0 14 14"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 3 1.5 6.5 5 10" />
                  <path d="M1.5 6.5h6A4.5 4.5 0 0 1 12 11v1.5" />
                </svg>
              </button>

              {moderation && message.authorId !== stream.ownerId && (
                <div className="shrink-0">
                  <button
                    aria-label="Moderate message"
                    onClick={() => setMenuFor(menuFor === message.id ? null : message.id)}
                    className="rounded-full p-1 text-meta transition-opacity hover:bg-white/10 hover:text-heading md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  >
                    <IconDots className="h-4 w-4" />
                  </button>
                  {menuFor === message.id && (
                    <>
                      <button
                        aria-label="Close moderation menu"
                        className="fixed inset-0 z-10 cursor-default"
                        onClick={() => setMenuFor(null)}
                      />
                      <div className="ws-overlay absolute right-0 z-20 mt-1 w-44 rounded-2xl p-1.5">
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            moderation.onRemove(message.id);
                          }}
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-body transition-colors hover:bg-white/10"
                        >
                          Remove message
                        </button>
                        <button
                          onClick={() => {
                            setMenuFor(null);
                            moderation.onBan(message.authorId);
                          }}
                          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-down transition-colors hover:bg-white/10"
                        >
                          Ban from chat
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
            ))}
      </ul>

      {/* Only while there is something to rejoin. A control that is always
          there, greyed out, teaches people to stop looking at that spot. */}
      {behind > 0 && (
        <div className="pointer-events-none relative z-10 flex justify-center">
          <button
            onClick={() => jumpToLatest(true)}
            className="ws-press pointer-events-auto -mt-1 mb-1 flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[12px] font-bold text-ink shadow-[0_6px_20px_-6px_rgba(0,0,0,0.9)]"
          >
            <IconChevronDown className="h-3.5 w-3.5" />
            {behind === 1 ? "1 new message" : `${behind} new messages`}
          </button>
        </div>
      )}

      <div
        className={
          overlay
            ? "pt-2"
            : room
              ? "shrink-0 border-t border-white/10 bg-white/[0.03] px-6 py-4"
              : cn("ws-hair border-t p-3", theater && "px-4 py-4")
        }
      >
        {send.isError && !gatedByTicket && (
          <InlineError error={send.error} fallback="Couldn't send that." className="mb-2" />
        )}
        {gatedByTicket && (
          <p className="mb-2 text-[13px] text-meta">Chat is for ticket holders on this stream.</p>
        )}
        {room ? (
          /*
            NODE 144:12901. A 40px pill at `#18181C` — which is `--color-overlay`
            to within one value per channel — inside a 1px `#26262B`, which is
            white at 6% over that same fill, at radius 30. The emoji glyph is
            held at its right edge, then 16px of gap
            and the 38.37px send disc. The disc is a ws-glass-pill rather than
            a painted #1C1C1C circle for the same reason every other circular
            control in this file is: the node reports a stroke with no weight,
            which renders nothing, and the measured disc is an opaque near-black
            lens.
          */
          <div className="flex flex-col gap-2">
            {/* WHAT YOU ARE ANSWERING, above the field rather than inside it:
                the reply target is a fact about the message, not part of the
                text, and putting it in the field would make it deletable with
                a backspace. Dismissable, because changing your mind about
                which message you meant is the commonest correction here. */}
            {/* The list of people, anchored to the field. Only ever open while
                an @ token is being typed. */}
            <MentionPicker typing={typing} heading="In this room" emptyLabel="Nobody in this room matches." />
            {replyTo && (
              <div className="flex items-center gap-2 rounded-xl border-l-2 border-create bg-white/[0.05] px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] leading-[16px] text-meta">
                  <span className="font-semibold text-body">
                    Replying to {replyTo.author?.displayName ?? "Someone"}
                  </span>
                  {/* Concatenated, not a template literal: lib/button-sizing
                      scans backticks naively and one here pairs with another
                      further down to swallow a control's class string. */}
                  {replyTo.text ? " · " + replyTo.text : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="ws-press shrink-0 rounded-full p-1 text-meta transition-colors hover:bg-white/10 hover:text-heading"
                >
                  <svg
                    aria-hidden
                    viewBox="0 0 12 12"
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  >
                    <path d="m3 3 6 6m0-6-6 6" />
                  </svg>
                </button>
              </div>
            )}
          <div className="flex items-center gap-4">
            <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[30px] border border-white/[0.06] bg-overlay px-4">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => typing.update(e.target.value, e.target.selectionStart)}
                onKeyDown={(e) => {
                  // The picker owns the arrows, Enter and Escape WHILE it is
                  // open: choosing a name and sending the line are the same
                  // key, and the list has to win or Enter sends "@pri".
                  if (typing.token && typing.items.length > 0) {
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      typing.pick(typing.items[0]!);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      typing.dismiss();
                      return;
                    }
                  }
                  if (e.key === "Enter") submit();
                }}
                maxLength={300}
                disabled={stream.status !== "live"}
                placeholder={stream.status === "live" ? "Start typing" : "Chat is closed"}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/50 disabled:opacity-50"
              />
              {/* The file's emoji-add glyph opens the full emoji picker; a pick
                  types into the message field above. (The dock's reaction button
                  is a different thing — it floats a reaction over the room.) */}
              <div ref={emojiWrapRef} className="relative shrink-0">
                {emojiOpen && <EmojiPicker onPick={insertEmoji} />}
                <button
                  type="button"
                  aria-label="Add emoji"
                  aria-haspopup="dialog"
                  aria-expanded={emojiOpen}
                  disabled={stream.status !== "live"}
                  onClick={() => setEmojiOpen((value) => !value)}
                  className={cn(
                    "ws-press flex text-white/50 transition-colors hover:text-white/80 disabled:opacity-50",
                    emojiOpen && "text-white"
                  )}
                >
                  <IconEmojiAdd className="h-5 w-5" />
                </button>
              </div>
            </div>
            <button
              onClick={submit}
              disabled={send.isPending || !draft.trim() || stream.status !== "live"}
              aria-label="Send message"
              className="ws-glass-pill ws-press flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
            >
              <IconRoomSend className="h-4 w-4" />
            </button>
          </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2",
              overlay ? "ws-glass rounded-full" : theater ? "ws-field" : "ws-inset"
            )}
          >
            <input
              value={draft}
              onChange={(e) => typing.update(e.target.value, e.target.selectionStart)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              maxLength={300}
              disabled={stream.status !== "live"}
              placeholder={stream.status === "live" ? "Say something nice" : "Chat is closed"}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none disabled:opacity-50"
            />
            {theater && (
              <span className="text-meta" aria-hidden>
                <IconEmoji className="h-4 w-4" />
              </span>
            )}
            <button
              onClick={submit}
              disabled={send.isPending || !draft.trim() || stream.status !== "live"}
              aria-label="Send message"
              className="rounded-full p-1.5 text-accent transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              <IconSend className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ONE MESSAGE IN A GIST ROOM — node 215:2889.
 *
 * THE FILE'S NUMBERS: a 24px avatar (`white/10` fill, `white/20` ring) sitting
 * on the bubble's baseline, 8px of gap, then the bubble itself — 12px of
 * padding at radius `16 16 16 2` over `#7E3BEB`, holding the author's name at
 * Geist SemiBold 14/20 beside their handle at 12/20 in 60% white, the message
 * at 13/20, and the clock at Medium 12/16 in 40% white pinned to the bubble's
 * bottom-right. Then 8px and the 16px heart.
 *
 * ─── NO BUBBLE, AND THE READER'S OWN LINE MIRRORS ───────────────────────────
 * It used to be a purple bubble per message, the reader's own included. It now
 * reads the way a live stream's chat reads — just the words over the room
 * (ogazboiz, 2026-09-23: "remove that background it should just be like how
 * live stream text just the text").
 *
 * Those two asks pull against each other and the mirror is what reconciles
 * them. A stream's chat is ALL left-aligned, and that is exactly why it scans:
 * every line begins on the same edge, so the eye runs down one column. In a
 * bubble chat the right-hand side works because the BUBBLE carries the
 * identity — the coloured block says whose it is before you read a word. Take
 * the bubble away AND right-align and you get ragged text hanging off nothing.
 *
 * So the whole ROW mirrors, not just the text: avatar, name, quote, words and
 * the controls all swap sides together. A mirrored line reads as deliberate;
 * text alone shunted right reads as a bug. That is also why the reply quote
 * moves its rule from the left border to the right — a rule on the far side
 * from its text is a box that lost its contents.
 *
 * Legibility replaces the bubble rather than simply going away: the panel sits
 * over a room, and a bubble was doing work the background can no longer be
 * trusted to do. A text shadow carries it, which is what every live chat over
 * video does.
 *
 * THE HEART IS INERT, and deliberately visible. The file puts a per-message
 * reaction on every row; nothing in the service backs one — there is no
 * endpoint to like a chat message, and the room's data channel carries only
 * anonymous hearts for the room as a whole. Firing that from here would
 * attribute a room-wide reaction to one person's message, which is a small
 * lie. So it is a real `disabled` button carrying the reason, per the
 * flagged-capability rule.
 */
function RoomBubble({
  message,
  isHost,
  onReply,
  onLove,
  dragX,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  message: ChatMessage;
  isHost: boolean;
  /** Make this message the composer's reply target. */
  onReply: (message: ChatMessage) => void;
  /** Toggle the reader's love on it. */
  onLove: (message: ChatMessage, loved: boolean) => void;
  /** How far this row has been dragged, or 0 when it is not the one moving. */
  dragX: number;
  onDragStart: (message: ChatMessage, event: React.PointerEvent) => void;
  onDragMove: (event: React.PointerEvent) => void;
  onDragEnd: (message: ChatMessage, event: React.PointerEvent) => void;
}) {
  const name = message.author?.displayName ?? `Member ·${message.authorId.slice(-4)}`;
  const heart = message.reactions.find((entry) => entry.emoji === DEFAULT_REACTION);
  const loved = heart?.mine === true;
  const loves = heart?.count ?? 0;

  return (
    <li
      // EVERY ROW READS LEFT, the reader's own included (ogazboiz, 2026-09-28).
      // Mine-right is a DM convention: with two parties the split carries
      // meaning. A live room is a FEED many people scroll — Twitch, YouTube
      // Live and Spaces all run one left edge — and mirroring the odd own-row
      // broke the scan for a distinction the name already carries.
      className="relative flex items-start gap-2 touch-pan-y"
      style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
      onPointerDown={(event) => onDragStart(message, event)}
      onPointerMove={onDragMove}
      onPointerUp={(event) => onDragEnd(message, event)}
      onPointerCancel={(event) => onDragEnd(message, event)}
    >
      {/* The mark the swipe is travelling towards, so the gesture explains
          itself the first time rather than after somebody guesses. */}
      {dragX > 8 && (
        <span
          aria-hidden
          className="absolute -left-1 bottom-2 text-white/50"
          style={{ opacity: Math.min(1, dragX / SWIPE_TRIGGER) }}
        >
          <svg viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 3 1.5 6.5 5 10" />
            <path d="M1.5 6.5h6A4.5 4.5 0 0 1 12 11v1.5" />
          </svg>
        </span>
      )}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
        <Avatar name={name} seed={message.authorId} src={message.author?.avatarUrl} size={24} />
      </span>

      <div className="flex min-w-0 max-w-[calc(100%-4.5rem)] flex-col gap-0.5 [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* ONE META LINE, then the words under it — the shape every chat over
              video uses, and the shape the bubble was previously holding. The
              clock joins it rather than floating beside the text: with no
              bubble there is no inner corner for it to sit in. */}
          <p className="flex min-w-0 items-center gap-1">
            {/* The NAME alone — the @handle beside it doubled the identity on
                every row and ate the message's own width (ogazboiz,
                2026-09-28: "only the name of the user"). */}
            <span className="truncate text-[13px] font-semibold leading-5 tracking-[-0.006em] text-white">
              {name}
            </span>
            {isHost && (
              <span className="shrink-0 rounded-full bg-white/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">
                Host
              </span>
            )}
            <span className="tnum shrink-0 text-[11px] font-medium leading-4 tracking-[-0.005em] text-white/40">
              {clockTime(message.createdAt)}
            </span>
          </p>
          {/* WHAT THIS ANSWERS, above the words that answer it. A removed
              original keeps its quote and says so: a reply to nothing reads
              as a non-sequitur. */}
          {message.replyTo && (
            <p className="min-w-0 truncate rounded-md border-l-2 border-white/40 bg-black/25 px-2 py-1 text-[12px] leading-4 text-white/70">
              {message.replyTo.deleted ? "Message deleted" : message.replyTo.text}
            </p>
          )}
          <p className="break-words text-[13px] leading-5 tracking-[-0.006em] text-white/95">
            {message.text}
          </p>
        </div>
      </div>

      {/* REPLY IS THE SWIPE — drag the row and let go (shared lib/swipe-reply,
          the DM thread's own gesture; the quote cue fades in as you pull). The
          always-visible arrow that sat here is gone (ogazboiz, 2026-09-28:
          "that back arrow stuff is not nice, let's use the swipe") — a control
          on every row turned the column into a toolbar. The button stays for
          KEYBOARD readers only, a swipe meaning nothing to a Tab key:
          invisible and pointer-inert until focused. */}
      <button
        type="button"
        onClick={() => onReply(message)}
        aria-label={"Reply to " + name}
        className="ws-press pointer-events-none shrink-0 self-start pt-0.5 text-white/40 opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100"
      >
        <svg aria-hidden viewBox="0 0 14 14" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 3 1.5 6.5 5 10" />
          <path d="M1.5 6.5h6A4.5 4.5 0 0 1 12 11v1.5" />
        </svg>
      </button>

      {/* LOVE THIS ONE. Filled once the reader has, with the service's own
          tally beside it — the count is everybody's, so it comes from the
          read rather than from adding one to our own copy. */}
      <button
        type="button"
        onClick={() => onLove(message, !loved)}
        aria-pressed={loved}
        aria-label={loved ? `Remove your love from ${name}'s message` : `Love ${name}'s message`}
        className="ws-press flex shrink-0 items-center gap-0.5 self-start pt-0.5 text-white/40 transition-colors hover:text-white/80"
      >
        {/* FILLED once the reader has loved it — a tinted outline reads as a
            hover state, not as an act somebody took. */}
        <IconRoomHeart className={cn("h-4 w-4", loved && "text-like")} filled={loved} />
        {loves > 0 && <span className="tnum text-[11px] leading-none">{loves}</span>}
      </button>
    </li>
  );
}

/** The file's `04:07` — a wall clock, not an age. A message in a room that is
    open right now is placed in the conversation, not measured against it. */
function clockTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

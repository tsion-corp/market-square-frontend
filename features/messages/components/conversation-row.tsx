"use client";

import { challengePreview } from "@/lib/game-challenge";
import { cn } from "@/lib/cn";
import { asset } from "@/lib/square-path";
import { inboxTime } from "@/lib/inbox-time";
import { Avatar } from "@/components/ui/avatar";
import { IconPeople } from "@/components/ui/icons";
import { isGroupThread, threadTitle } from "@/features/messages/lib/thread-identity";
import type { Conversation } from "@/features/messages/lib/types";
import { snapStatus, type SnapKind, type SnapStatus } from "@/features/messages/lib/snap-status";

/**
 * One conversation in the inbox — a 62px card, not a list row.
 *
 * The design gives every row its own bordered surface with 16px of air between
 * them, which is what separates this from the feed's hairline-divided rows.
 * Numbers are the file's: 62 tall, radius 12, 3% fill, 10% border, 12px inset,
 * 38px avatar, 8px from avatar to text.
 */
export function ConversationRow({
  conversation,
  meId,
  selected,
  onOpen,
}: {
  conversation: Conversation;
  meId?: string;
  selected: boolean;
  onOpen: () => void;
}) {
  const peer = conversation.peer;
  const last = conversation.lastMessage;
  /*
    HOW THE ROW NAMES ITSELF.

    A group has NO peer — that is deliberate on the service, because a room of
    twenty has no single other person — so a row that only ever read
    `peer.displayName` rendered every group as "Unknown". It is the group's
    `title`, its picture, and the people glyph beside it.
  */
  const group = isGroupThread(conversation);
  // ONE naming rule for the row and the thread pane. `threadTitle` already
  // handled groups — the row simply never asked it, which is the whole bug:
  // it read `peer.displayName`, a group has no peer by design, and every group
  // rendered as "Unknown".
  const name = threadTitle(conversation);
  const seed = group ? conversation.id : peer?.id;
  const avatarUrl = group ? conversation.imageUrl : peer?.avatarUrl;

  const at = last?.createdAt ?? conversation.lastMessageAt;
  const stamp = inboxTime(at);
  const unread = conversation.unreadCount;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        // A bordered card wants a touch more room than a flat list row: 16px
        // inset and a 12px avatar→text gap read as a comfortable card rather
        // than a cramped one.
        "ws-press flex h-[62px] w-full items-center gap-3 rounded-xl border px-4 text-left transition-colors",
        // Selected is ours. The design shows an unopened inbox, but a two-pane
        // layout must say which row the pane belongs to, or the thread on the
        // right looks unattached to anything.
        selected
          ? "border-white/20 bg-white/8"
          : "border-white/10 bg-white/3 hover:bg-white/6"
      )}
    >
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
        <Avatar name={name} seed={seed} src={avatarUrl} size={38} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          {/* QA: the name should be bigger. 12px was the file's, and read as body
              text beside a 38px picture; 15px makes it the row's heading. */}
          <span className="truncate text-[15px] font-bold leading-5 text-white">{name}</span>
          {/*
            THE PEOPLE GLYPH, in `--color-spotlight`, 12px — node 31:6589.
            It is what tells a group apart from a person at a glance, and it is
            the one mark on this row that is purple rather than white.
          */}
          {group && <IconPeople className="h-3 w-3 shrink-0 text-spotlight" />}
        </span>

        <span className="flex items-center gap-2 truncate text-[11px] font-normal leading-[16.5px] text-white/50">
          <Preview conversation={conversation} meId={meId} />
        </span>
      </span>

      {/* VERTICALLY CENTRED, not top-aligned. The file positions this cluster
          at y=24 in a 62px row — its own height is 15, so 24+7.5 lands on 31,
          which is the row's exact middle. It was `self-start pt-3`, i.e. 12
          from the top, sitting a clear 12px high against the two lines of text
          beside it. */}
      <span className="flex shrink-0 items-center gap-2">
        {/* The file's stamp: a clock inside today, an age past it — see
            lib/inbox-time.ts for why an inbox reads differently from a post. */}
        {stamp && (
          <span className="tnum text-[10px] font-normal leading-[15px] text-white/50">
            {stamp}
          </span>
        )}
        {/*
          THE SNAP STREAK — days in a row that BOTH of them sent one.

          FROM ONE, not from two. It was drawn from two on the argument that a
          "1" is noise; testing settled that against it (ogazboiz, 2026-09-19).
          A mutual day is genuinely a streak of one, and hiding it means the
          first day of every streak — the day the habit either forms or does
          not — shows the reader nothing at all. The service is strict about
          what earns it: both sides, same UTC day, view-once only.
        */}
        {conversation.snapStreak > 0 && (
          <span
            className="flex items-center gap-1 text-[10px] font-medium leading-[15px] text-[#ff9d01]"
            title={`${conversation.snapStreak} day${conversation.snapStreak === 1 ? "" : "s"} in a row`}
          >
            {/* node 1822:20589 — the file's own gradient flame, exported. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- the node's own export */}
            <img
              src={asset("/messages/streak-flame.svg")}
              alt=""
              aria-hidden
              className="h-4 w-[9.617px] shrink-0"
            />
            <span className="tnum">{conversation.snapStreak}</span>
          </span>
        )}
        {unread > 0 && (
          <span className="tnum flex min-w-4 items-center justify-center rounded-[30px] bg-[#3F1881] px-1 py-1 text-[10px] leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The preview line.
 *
 * "You: " when the viewer sent it — the standard inbox affordance — and an
 * attachment reads as an attachment rather than as an empty message, which is
 * the row the design draws with a paperclip and "Shared attachment".
 */
function Preview({ conversation, meId }: { conversation: Conversation; meId?: string }) {
  const last = conversation.lastMessage;
  if (!last) return <span>No messages yet</span>;
  if (last.status === "removed") return <span className="italic">Message removed</span>;

  const mine = Boolean(meId && last.senderId === meId);
  const body = last.text?.trim();

  /*
    AN ATTACHMENT GETS A STATUS, NOT A PAPERCLIP.

    "Shared attachment" was the same eleven characters for a photo, a clip, a
    voice note and a PDF, and it never said whether the reader had already
    seen it. The status does both, in Snapchat's grammar (ogazboiz, with a
    screenshot): the colour and the noun say WHAT, and a solid glyph says it
    is still waiting to be opened.

    TEXT PREVIEWS ARE UNTOUCHED, deliberately. Snapchat hides message text in
    its list; we show it, people rely on it, and the ask was about "upload and
    camera media". Ours is the narrower change — say so rather than quietly
    widening it.
  */
  const snap = snapStatus({
    last: { ...last, senderId: last.senderId },
    meId,
    unreadCount: conversation.unreadCount,
  });
  if (!body && snap) {
    return (
      <>
        <SnapGlyph status={snap} />
        <span className="truncate">
          {mine ? "You: " : ""}
          {snap.label}
        </span>
      </>
    );
  }

  /*
    THE SENDER PREFIX — node 31:6604, the file's `Patrick_dev:`.

    On a GROUP the preview is unreadable without it: "Buy the dip and hodl"
    from a room of twenty says nothing about who said it. On a 1:1 there are
    only two possibilities and the row already names the peer, so the prefix
    is only ever "You:" there.
  */
  const sender =
    mine ? "You" : conversation.kind === "group" ? conversation.lastSender?.displayName : null;

  /*
    A GAME CHALLENGE READS AS THE GAME, NOT AS ITS LINK.

    The message a challenge travels as is a sentence and a url, because the
    url is what it must degrade to if the card fails to draw. Here there is no
    card, so the raw body would put "…/g/simon/9f3c…?s=120" into the row and
    truncate mid-link. The preview keeps the sentence and drops the address.
  */
  return (
    <span className="truncate">
      {sender && <span className="text-white/70">{sender}: </span>}
      {challengePreview(body) ?? body}
    </span>
  );
}

/**
 * The status mark: a 10px rounded square, SOLID while unopened and outlined
 * once it has been.
 *
 * One shape rather than four, and the words beside it carry the kind. A set of
 * invented icons would be four more things to get wrong at 10px, and the
 * colour already separates a photo from a clip at a glance. Decorative, so it
 * is hidden from screen readers — the label says everything it says.
 */
const SNAP_TONE: Record<SnapKind, string> = {
  // Square's own palette, mapped onto Snapchat's meanings. `live` is reserved
  // for rooms that are actually live, so a photo takes the softer red.
  photo: "text-like",
  video: "text-spotlight",
  voice: "text-create",
  file: "text-white/60",
  chat: "text-reply",
};

function SnapGlyph({ status }: { status: SnapStatus }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className={cn("h-2.5 w-2.5 shrink-0", SNAP_TONE[status.kind])}
      fill="none"
    >
      <rect
        x={status.filled ? 0.5 : 1.25}
        y={status.filled ? 0.5 : 1.25}
        width={status.filled ? 11 : 9.5}
        height={status.filled ? 11 : 9.5}
        rx={status.filled ? 3 : 2.5}
        fill={status.filled ? "currentColor" : "none"}
        stroke={status.filled ? "none" : "currentColor"}
        strokeWidth={1.5}
      />
    </svg>
  );
}


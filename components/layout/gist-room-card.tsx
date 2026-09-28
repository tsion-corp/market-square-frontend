"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { IconRoomBadgeMic, IconUnmute, IconVoiceMode } from "@/components/ui/room-icons";
import { TOPIC_ICONS } from "@/components/ui/topic-tags-field";
import { IconSpark } from "@/components/ui/icons";
import { useTopics } from "@/features/discovery";
import { useConversationMembers } from "@/features/messages";
import { opensAtLabel } from "@/lib/format";
import { housePath, parseParticipantMeta, participantName } from "@/features/houses";
import { useRoomPreview, useStream } from "@/features/streams";
import { liveRoomFaces } from "@/features/streams/lib/room-faces";
import { previewCaption } from "@/lib/room-preview-caption";
import { asset } from "@/lib/square-path";

/**
 * "X opened a gist room" — the invite card a room posts into its house group.
 *
 * NODE 225:3873. A 338x120 glass card at `rgba(16,16,18,0.62)` behind a 7px
 * backdrop blur, ringed at `white/18`, 22px radius, 16px of padding. Inside:
 *
 *   · a 24px disc carrying the file's own `#9F65FD -> #7E3BEB` gradient (the
 *     purple ramp's two stops) with a microphone in it, 8px from
 *   · the room's TITLE at Geist SemiBold 12/16, wrapping to two lines;
 *   · the room's TOPICS as `white/10` pills, indented to the title's left edge;
 *   · the `Join Gistroom` pill on the `#9F65FD -> #5B05E6` ramp at 90 degrees
 *     with the `codicon:voice-mode-compact` waveform;
 *   · and a cluster of three overlapping 32px rounded-10.7 tiles at the right,
 *     each ringed white with a `0 4px 15px rgba(147,147,147,0.25)` shadow.
 *
 * ─── WHY IT IS COMPOSED HERE ─────────────────────────────────────────────────
 * It reads THREE slices: the room (`streams`), the topic vocabulary that turns
 * a topic key into a label and a glyph (`discovery`), and the group's roster
 * (`messages`). Slices never import each other, so the card is assembled in the
 * layout layer and handed to the thread through a slot — the same pattern
 * `home-screen` and `messages-screen` already use.
 *
 * ─── TWO JUDGEMENT CALLS, BOTH STATED ────────────────────────────────────────
 *
 *  1. **TYPE SIZE.** The file gives the topic chips Roboto Bold at **3.79px**
 *     and the Join pill's label **8px**. Those are not design decisions: the
 *     chip group was pasted into this card at roughly 38% scale, and 3.79px
 *     text cannot be rendered by a browser, let alone read. The title's 12/16
 *     and every box measurement are the file's exactly; the chips are drawn at
 *     10px over a 12px glyph and the pill's label at 11px, which is the
 *     smallest either can be and still be legible. Their BOXES stay the
 *     file's: a 16-tall chip and a 20-tall pill, 12 apart, keep the card at
 *     its 120 and the pill at the file's y of 84 (496:13802, live file). Everything else — the 22px
 *     radius, the 24px disc, the 16px padding, the 8px gap, the two gradients,
 *     the tile geometry — is verbatim.
 *
 *  2. **WHOSE FACES ARE IN THE STACK.** The file draws three portraits and
 *     cannot say who they are. The service has no participant list on a stream
 *     (the payload carries `viewerCount` and `owner`, nothing else; who is
 *     actually in the room exists only as LiveKit presence, which needs a
 *     connection to read), so rather than invent one the stack shows the HOST
 *     first — the one person certainly in the room, hydrated on every stream
 *     surface — then up to two members OF THIS HOUSE GROUP, the people the
 *     invite is addressed to.
 *
 *     The host leading is what makes a room opened WITHOUT a house show a face
 *     at all. Such a room has no `houseConversationId`, so there is no roster
 *     to read, and the card used to render an empty stack beside "Join
 *     Gistroom" — a room that looked like nobody was in it, including the
 *     person who had just opened it.
 *
 *     WHO JOINED comes first when the service can say: `participants` on
 *     `GET /streams/:id` is a sample of people currently connected (gist rooms
 *     only — see the schema for the privacy call behind that). The card
 *     already fetches the detail route to poll the room's status, so the
 *     faces cost no extra request and no list-route flag. When the sample is
 *     empty — a backend that has not shipped it, or a room whose joiners are
 *     all signed-out and unresolvable — the host and the house roster fill
 *     in exactly as before.
 */
/** 60s, and only while the room is live — see the note at the call site. */
const LIVE_POLL = ["while-live", 60_000] as const;

/**
 * The face cluster at 496:13802's own geometry inside its 72.43 x 55.62 group:
 * the raised tile first, then the one to its right turned -4deg on a white ->
 * #F0E8FF ring, then the one to its left turned 4deg on a thinner white ring.
 * Paint order is the file's, and each ring is drawn INSIDE its tile.
 */
// Node 1769:3695's own cluster: three 36.821 tiles at radius 12.284 — one
// raised and centred, one below-right turned -4deg, one below-left turned +4deg
// — each ringed white INSIDE its tile, the -4 one carrying the file's shadow.
const TILE_RADIUS = 12.284;
const TILES = [
  { left: 14.17, top: 0, size: 36.821, rotate: 0, ring: 1.919, shadow: false },
  { left: 44.04, top: 24.7, size: 36.821, rotate: -4, ring: 1.919, shadow: true },
  { left: 0, top: 24.13, size: 36.821, rotate: 4, ring: 1.535, shadow: false },
] as const;

/**
 * THE CARD'S MATERIAL, stated once — nodes 225:3873 (the invite) and
 * 545:47749 (a replay on a profile) are the same glass: `rgba(16,16,18,0.62)`
 * behind a 7px backdrop blur, ringed at `white/18`, a 22px radius, 16px of
 * padding. The invite is 338 wide in a rail and fluid on the rooms page; the
 * replay is the file's 359. The width belongs to the surface, the shell does
 * not.
 */
export function RoomCardShell({
  className,
  children,
  onMouseLeave,
}: {
  className?: string;
  children: React.ReactNode;
  /** The card's preview stops the moment the pointer leaves. */
  onMouseLeave?: () => void;
}) {
  return (
    <div
      onMouseLeave={onMouseLeave}
      className={cn(
        // The ring is an INSET shadow, not a border: the file's stroke sits
        // inside the card and takes no layout, so a border cost 2px of the
        // 306 content box and wrapped the topic chips onto a second line.
        "max-w-full rounded-[22px] bg-[rgba(16,16,18,0.62)] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] backdrop-blur-[7px]",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * One topic chip — 225:3887 / 545:47760. See the type-size note above.
 *
 * The BOX is the file's 16 — it was drawn h-6 (24px), which alone pushed the
 * replay card's fixed 120 over budget and spilled the pill row out of the
 * rounded rectangle. `max-w-full` + truncate keep a long topic label INSIDE
 * the card: the chip caps at the row and ellipsizes rather than running out.
 */
export function RoomTopicChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex h-4 max-w-full items-center gap-1 rounded-full bg-white/10 px-2 text-[10px] font-bold leading-none text-grey-100">
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * THE HOVER STATE — node 415:12704, the second variant of component set
 * 415:12668, reached by MOUSE_ENTER on 415:12669 and left by MOUSE_LEAVE. The
 * gist rooms page (1317:158073) wires every card in its grid to it; nothing
 * else in the file does, so it is opt-in (`preview`).
 *
 * In the same 338 x 120 box: the mic disc at 22.33 and the title at Geist
 * SemiBold 16.79 / 17.16 across 282 (two lines), ONE face tile 34.5 at
 * (16.4, 70.4) on an 11.49 radius with a 1.44 white ring and the cluster's
 * shadow, "Speaking Now" beside it at (57.09, 88.49) behind the file's own
 * 16.59 wave (a still frame of a Lottie the file embeds as an image — exported
 * as that frame; the file carries no animation data), an "unmute" pill 65 x 20
 * at (165, 85) on `#333234`, and the Join pill at (232, 85).
 *
 * "unmute" LISTENS: it mints a listen-only grant (`POST /streams/:id/
 * preview-token`, `useRoomPreview`) and plays the room's audio until the
 * pointer leaves, the card unmounts or it is pressed again. It never sends a
 * heartbeat. A refusal (404 / 409) makes the control quiet with its reason on
 * it; a 429 backs off.
 *
 * "Speaking Now" NAMES NOBODY IT CANNOT HEAR (`lib/room-preview-caption.ts`):
 * before the preview connects the slot counts listeners from `viewerCount`
 * (nothing when the payload has none); connected, it names the SFU's active
 * speaker, resolved through the participant's token metadata exactly as the
 * house room does, and says nothing in silence. The face tile is the first
 * sampled participant, else the host — a face, not a claim.
 */
const PREVIEW_FACE_RING = 1.44;

export function GistRoomCard({
  streamId,
  conversationId,
  fluid = false,
  preview = false,
}: {
  streamId: string;
  /**
   * The house group this room was announced in, when there is one.
   *
   * OPTIONAL because the same card now appears in the FEED, where a room was
   * shared as a post and there is no conversation behind it. Absent, the two
   * member faces are simply not drawn — everything else about the card is the
   * room's own.
   */
  conversationId?: string;
  /**
   * Fill the cell instead of holding 338.
   *
   * The rail is a horizontal scroller, so its cards are a FIXED width — that is
   * what makes a short title and a long one occupy the same space and the row
   * read as a row. The gist rooms PAGE (407:17074) lays the same card out in a
   * two-column grid at 359, and the file's own two instances differ by exactly
   * that, so the width belongs to the surface rather than to the card.
   */
  fluid?: boolean;
  /** Carry 415:12704's hover state — the gist rooms page's grid. */
  preview?: boolean;
}) {
  /*
    POLLED WHILE THE ROOM IS LIVE, and not otherwise.

    A thread stays open for a long time, and the one transition that matters is
    live -> ended: a card still offering "Join Gistroom" for a room that closed
    ten minutes ago is precisely the dead promise this state exists to remove.
    An ended room never becomes live again, and a scheduled one is opened by its
    host rather than by a clock, so neither is worth a poll.
  */
  const stream = useStream(streamId, LIVE_POLL);
  const topics = useTopics();
  const members = useConversationMembers(conversationId ?? "", Boolean(conversationId));

  const room = stream.data;
  // A room whose lookup failed still gets its card: the deep link is the point,
  // and a dead card would strand somebody the invite was meant for. It just
  // says less.
  const title = room?.title ?? "Gist room";

  /*
    ─── THE ENDED STATE, WHICH THE FILE DOES NOT DRAW ─────────────────────────

    225:3873 has one variant: a live room, offering "Join Gistroom" on the
    purple ramp. A gist room is over within the hour, and the invite stays in
    the thread for ever — so most of this card's life is spent in a state the
    file has no picture of, and left alone it goes on offering to join a room
    that closed.

    Three states, one card:

      · `live`      — the file's, verbatim.
      · `scheduled` — the room exists but its host has not opened it. "Not open
                      yet", quiet, still a link: the room page says when.
      · ended / cancelled — "Gist room ended", quiet, and STILL A LINK. The
                      room page has a real closed state ("This house has
                      closed", with an "Open a gist room about this" action),
                      so landing there is an honest answer; a dead card would
                      just strand the reader.

    The quiet pill drops the purple ramp AND the waveform glyph — the waveform
    means live voice, and keeping it on a finished room would say the one thing
    the label is there to deny. The title, the topics and the faces all stay:
    the card is a record of what happened, not a tombstone.
  */
  const status = room?.status;
  // The hover preview: pressed on, off on leave. Only where the file wires
  // the hover state, and only on a live room.
  const [listening, setListening] = useState(false);
  const live = useRoomPreview(streamId, preview && listening, (participant) =>
    participantName(participant.name) ?? parseParticipantMeta(participant.metadata)?.username ?? null
  );
  const caption = previewCaption({
    connected: live.state === "listening",
    speaker: live.speaker,
    listening: room?.viewerCount ?? null,
  });
  const previewOff = live.state === "quiet" || live.state === "backoff" || live.state === "failed";
  const over = status === "ended" || status === "cancelled";
  const pending = status === "scheduled";
  // A room that has not opened says WHEN, which is the one thing somebody
  // looking at it wants to know. Without a time it falls back to the state.
  const label = over
    ? "Gist room ended"
    : pending
      ? room?.scheduledAt
        ? opensAtLabel(room.scheduledAt)
        : "Not open yet"
      : "Join Gistroom";

  const labelled = (room?.topics ?? []).slice(0, 2).map((key: string) => {
    const match = topics.data?.find((topic) => topic.key === key);
    return { key, label: match?.label ?? key, Icon: TOPIC_ICONS[key] ?? IconSpark };
  });

  /*
    Who is actually here first, then the host, then the house roster — each
    layer only adding people the earlier ones did not (a host is usually in
    their own sample AND their own house, and a face drawn twice reads as a
    bug). Three at most — the file's cluster has three tiles.
  */
  const faces = liveRoomFaces({
    participants: room?.participants,
    owner: room?.owner,
    roster: (members.data?.items ?? []).flatMap((member) =>
      member.profile ? [member.profile] : []
    ),
  });

  return (
    /*
      338 WIDE, ALWAYS — `shrink-0` is the load-bearing half.

      The card sits in a `flex gap-4 overflow-x-auto` rail, and a flex item
      shrinks below its width unless told not to. So a room with a short title
      collapsed to whatever its text measured and the rail showed cards of three
      different widths. The file's card is `layoutSizingHorizontal: FIXED` at
      338 regardless of what is in it.

      `max-w-full` still caps it, because this same card is composed into a
      message thread whose column can be narrower than 338.
    */
    <RoomCardShell
      onMouseLeave={preview ? () => setListening(false) : undefined}
      className={cn(
        // Node 1769:3670's own metrics: 342 wide, 16.862 radius, a 0.766
        // hairline behind a 5.365 blur.
        fluid ? "w-full" : "w-[342px] shrink-0",
        "rounded-[16.862px] shadow-[inset_0_0_0_0.766px_rgba(255,255,255,0.18)] backdrop-blur-[5.365px]",
        // Both variants clip (`clipsContent`), and the hover face's picture
        // runs past its tile. Fixed to the new card's 130 so the hover overlay
        // has a stable box.
        preview && "group/room relative h-[130px] overflow-hidden"
      )}
    >
      {preview && !over && !pending && (
        <div className="absolute inset-0 hidden group-hover/room:block group-focus-within/room:block">
          {/* 415:12706 — the disc and the two-line title, 7.67 apart. */}
          <div className="absolute left-[14px] top-[16px] flex h-[35px] w-[310px] items-center gap-[7.67px]">
            <IconRoomBadgeMic className="h-[22.33px] w-[22.33px] shrink-0" />
            <p className="line-clamp-2 min-w-0 flex-1 text-[16.79px] font-semibold leading-[17.16px] text-white">
              {title}
            </p>
          </div>
          {/* 415:12727 — the one face, upright (the group's -4.09 cancels the
              tile's 4). A face, not a claim about who is speaking. */}
          {faces[0] && (
            <span
              aria-hidden
              className="absolute left-[16.4px] top-[70.4px] h-[34.5px] w-[34.5px] rounded-[11.49px] bg-white shadow-[0_4.31px_16.15px_0_rgba(147,147,147,0.25)]"
              style={{ padding: PREVIEW_FACE_RING }}
            >
              <span className="block h-full w-full overflow-hidden bg-[#EDEDED]" style={{ borderRadius: 11.49 - PREVIEW_FACE_RING }}>
                <Avatar
                  name={faces[0].displayName || faces[0].username}
                  seed={faces[0].id}
                  src={faces[0].avatarUrl}
                  size={34}
                  sizeClassName="h-full w-full"
                  className="rounded-none border-0"
                />
              </span>
            </span>
          )}
          {/* 415:12722 — the slot the file captions "Speaking Now": the wave
              frame and a name only while somebody can be heard; a listener
              count before that; nothing in silence or without a count. */}
          {caption && (
            <span
              aria-live="polite"
              className="absolute left-[57.09px] top-[88.49px] flex h-[16.59px] max-w-[104px] items-center text-[8px] font-medium leading-[10.4px] text-white"
            >
              {caption.kind === "speaking" && (
                /* eslint-disable-next-line @next/next/no-img-element -- the file's own frame */
                <img src={asset("/gist-rooms/speaking-wave.png")} alt="" aria-hidden className="-mr-0.5 h-[16.59px] w-[16.59px] shrink-0" />
              )}
              <span className="truncate">{caption.text}</span>
            </span>
          )}
          {/* 415:12713 — unmute. Live: presses on and off. Refused: quiet, with why. */}
          <button
            type="button"
            disabled={previewOff}
            aria-pressed={listening}
            title={live.reason ?? undefined}
            onClick={() => setListening((on) => !on)}
            className="absolute left-[165px] top-[85px] flex h-5 w-[65px] items-center justify-center gap-[3px] rounded-[30px] bg-[#333234] text-[8px] font-medium leading-[10.4px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {listening && !previewOff ? (live.state === "listening" ? "mute" : "…") : "unmute"}
            <IconUnmute className="h-2 w-2" />
          </button>
          {/* 415:12718 — Join, at the file's own box. */}
          <Link
            href={housePath(streamId)}
            className="ws-press absolute left-[232px] top-[85px] flex h-5 w-[88px] items-center justify-center gap-[3px] rounded-[30px] bg-[linear-gradient(90deg,var(--color-create)_0%,var(--color-create-deep)_100%)] text-[8px] font-medium leading-[10.4px] text-white transition-opacity hover:opacity-90"
          >
            Join Gistroom
            <IconVoiceMode className="h-2 w-2" />
          </Link>
        </div>
      )}
      <div
        className={cn(
          "flex items-center justify-between gap-4",
          preview && !over && !pending && faces[0] && "group-hover/room:invisible group-focus-within/room:invisible"
        )}
      >
        {/* 1769:3672 — the left group: the mic badge and title, then the
            topic chips and the Join pill, indented under the title's text. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {/* 1769:3673 — the 24px mic badge, 6 from the title at Geist SemiBold
              12/16, wrapping to two lines. */}
          <div className="flex items-center gap-1.5">
            <IconRoomBadgeMic className="h-6 w-6 shrink-0" />
            <p className="line-clamp-2 min-w-0 flex-1 text-[12px] font-semibold leading-4 text-white">
              {title}
            </p>
          </div>

          {/* Indented to the title's text edge (24 + 6). Chips 1769:3684, then
              the Join pill 1769:3680 12 under them. */}
          <div className="flex flex-col gap-3 pl-[30px]">
            {labelled.length > 0 && (
              // One line; a chip that will not fit whole wraps out of the
              // clipped card rather than being cut in half.
              <div className="flex h-[15px] flex-wrap items-center gap-x-1 gap-y-4 overflow-hidden">
                {labelled.map(({ key, label, Icon }) => (
                  <span
                    key={key}
                    className="flex h-[15px] items-center gap-1 rounded-full bg-white/10 px-1.5 text-[9px] font-bold leading-none text-grey-100"
                  >
                    <Icon className="h-2.5 w-2.5 shrink-0" />
                    {label}
                  </span>
                ))}
              </div>
            )}

            <Link
              href={housePath(streamId)}
              className={cn(
                "ws-press flex h-7 w-fit items-center gap-1 rounded-full px-3 text-[10px] font-medium leading-none transition-opacity hover:opacity-90",
                over || pending
                  ? "bg-white/10 text-white/60"
                  : "bg-[linear-gradient(90deg,var(--color-create)_0%,var(--color-create-deep)_100%)] text-white"
              )}
            >
              {label}
              {!over && !pending && <IconVoiceMode className="h-2 w-2" />}
            </Link>
          </div>
        </div>

        {faces.length > 0 && (
          /* 1769:3695 — the cluster: one tile raised and centred, two below it
             and outset (turned ∓4deg), each overlapping its neighbour, with the
             "+N" more-in-the-room count in the upper right. */
          <div aria-hidden className="relative h-[62px] w-[84px] shrink-0">
            {faces.map((profile, index) => {
              const tile = TILES[index]!;
              return (
                <span
                  key={profile.id}
                  className={cn("absolute bg-white", tile.shadow && "shadow-[0_4.6px_17.26px_0_rgba(147,147,147,0.25)]")}
                  style={{
                    left: tile.left,
                    top: tile.top,
                    width: tile.size,
                    height: tile.size,
                    padding: tile.ring,
                    borderRadius: TILE_RADIUS,
                    transform: tile.rotate ? `rotate(${tile.rotate}deg)` : undefined,
                  }}
                >
                  <span
                    className="block h-full w-full overflow-hidden bg-[#EDEDED]"
                    style={{ borderRadius: TILE_RADIUS - tile.ring }}
                  >
                    <Avatar
                      name={profile.displayName || profile.username}
                      seed={profile.id}
                      src={profile.avatarUrl}
                      size={37}
                      sizeClassName="h-full w-full"
                      className="rounded-none border-0"
                    />
                  </span>
                </span>
              );
            })}
            {/* 1769:3704 — "+N" more in the room. viewerCount is nullable and
                never fabricated as 0 (see CLAUDE.md). */}
            {typeof room?.viewerCount === "number" && room.viewerCount > 0 && (
              <span className="absolute left-[55.59px] top-[9.22px] text-[9px] font-medium leading-none text-white">
                +{room.viewerCount}
              </span>
            )}
          </div>
        )}
      </div>
    </RoomCardShell>
  );
}

"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { RoomCardShell, RoomTopicChip } from "@/components/layout/gist-room-card";
import { IconRoomBadgeMic } from "@/components/ui/room-icons";
import { IconReplayPlay } from "@/components/ui/profile-icons";
import { TOPIC_ICONS } from "@/components/ui/topic-tags-field";
import { IconSpark } from "@/components/ui/icons";
import { useTopics } from "@/features/discovery";
import { useProfileStreams } from "@/features/profile";
import { MARKET_FLAGS } from "@/lib/market-config";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * THE REPLAYS RAIL ON A PROFILE — node 545:47746: the heading "Replays", 16,
 * then a horizontal rail of the person's ENDED gist rooms as 359x120 cards,
 * 16 apart.
 *
 * ─── WHERE THE ROOMS COME FROM ──────────────────────────────────────────────
 * `GET /profiles/:username/streams?status=ended&kind=room` — the filters are
 * LIVE on :8080 (measured on prince: 7 unfiltered, 3 with both). The service
 * narrows; nothing here pages through a person's broadcasts to pick the rooms
 * out, because that route is paged and a filtered page is not a filtered
 * list. With no ended rooms the rail is absent rather than an empty heading.
 *
 * ─── THE CARD, 545:47749 ────────────────────────────────────────────────────
 * The gist room invite's own glass (`RoomCardShell`) at the file's 359. Inside:
 * the 24px mic disc, the title at Geist 600 12/16 in a fixed 186-wide two-line
 * box, the topic chips 8 under it, then 16 under those a row of the Play now
 * pill and the date; and at the right the file's cluster of faces.
 *
 * PLAY NOW — 545:47771, 73x22 at a 30 radius, 5/12 of padding, the file's own
 * `fluent:play-12-filled` 3 from "Play now" at Geist 500 8. Its fill is a
 * white solid UNDER the opaque 90deg ramp, so only the ramp is seen —
 * `ws-btn-welcome`. It is a real link only when there is a recording to play:
 * `MARKET_FLAGS.replays` on AND `replayUrl` present. Otherwise it is a real
 * `disabled` button titled "Soon", per the standing rule — recordings need
 * LiveKit egress and a bucket that are not provisioned, and a pill that opens
 * nothing is a promise the product cannot keep.
 *
 * THE FACES — 545:47776 draws three portraits and "+48", which is attendance
 * history the service does not keep. Only the HOST is drawn (their face is
 * hydrated on every stream), in the raised centre tile; the "+N" is absent
 * rather than fabricated from `peakViewers`, which is a high-water mark and
 * not a headcount.
 *
 * Composed here because it reads the discovery slice for the topic vocabulary
 * and the profile slice for the rooms, and slices never import each other.
 */
export function ProfileReplays({ username }: { username: string }) {
  const rooms = useProfileStreams(username, { status: "ended", kind: "room" });
  const topics = useTopics();

  const items = rooms.data?.items ?? [];
  if (rooms.isPending || rooms.isError || items.length === 0) return null;

  return (
    <section aria-label="Replays" className="flex flex-col gap-4">
      {/* 545:47747 — Roboto Bold 12/16 in `#F4F4F4`, set in Geist 700 like
          every other heading in the app. */}
      <h2 className="text-[12px] font-bold leading-4 text-grey-100">Replays</h2>
      <div className="flex items-center gap-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((room) => {
          const labelled = room.topics.slice(0, 2).map((key) => {
            const match = topics.data?.find((topic) => topic.key === key);
            return { key, label: match?.label ?? key, Icon: TOPIC_ICONS[key] ?? IconSpark };
          });
          const playable = MARKET_FLAGS.replays && Boolean(room.replayUrl);
          const pill =
            "ws-btn-welcome ws-press flex h-[22px] shrink-0 items-center justify-center gap-[3px] rounded-[30px] px-3 text-[8px] font-medium leading-[10.4px] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
          return (
            /* 545:47750 sits 27 in from the card's left, 15 down, 306 wide —
               so the insets are 27/25 and 15/15 rather than the invite's 16,
               and the row is CENTRED, which is what puts the faces mid-card. */
            /* `overflow-hidden` is the card's last line of defence: the shell
               is a FIXED 120 and everything below budgets to exactly its 90px
               content box, so nothing should ever reach it — but a fixed-size
               glass card that CAN clip is one whose text can never hang out of
               the rounded rectangle, whatever the data does. */
            <RoomCardShell key={room.id} className="h-[120px] w-[min(359px,100%)] shrink-0 overflow-hidden p-[15px_25px_15px_27px]">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex h-8 gap-2">
                    <IconRoomBadgeMic className="h-6 w-6 shrink-0 self-center" />
                    {/* Two lines then an ellipsis; `overflow-wrap:anywhere` so
                        one unbroken long word wraps INTO the clamp instead of
                        running out of the card's side. */}
                    <p className="line-clamp-2 min-w-0 flex-1 text-[12px] font-semibold leading-4 text-white wrap-anywhere">
                      {room.title}
                    </p>
                  </div>
                  {/* Indented to the title's own left edge — 24 + 8, the file's
                      x=31.57 on both the chip row (y=40) and the pill row
                      (y=67.84). */}
                  {/* 545:47749 is a FIXED 120 tall, and the chip row (y=40) and
                      the pill row (y=67.84) sit at fixed offsets inside it — so
                      the chip row keeps its height when a room has no topics,
                      and a card without chips is exactly as tall as one with.
                      THE BUDGET IS EXACT: 32 title + 8 + 16 chips + 12 + 22
                      pill = the padding box's 90. The chip row was h-6 chips in
                      a wrapping row with 16 under it — 102 in a 90 box, which
                      is precisely how a card with topics spilled its pill row
                      out of the rectangle (ogazboiz's screenshot). One line of
                      chips, clipped: a chip that will not fit whole wraps out
                      of view rather than being cut in half — the invite card's
                      own trick. */}
                  <div className="mt-2 space-y-3 pl-8">
                    <div className="flex h-4 flex-wrap items-center gap-x-1 gap-y-4 overflow-hidden">
                      {labelled.map(({ key, label, Icon }) => (
                        <RoomTopicChip key={key} icon={<Icon className="h-2.5 w-2.5" />} label={label} />
                      ))}
                    </div>
                    {/* 545:47770 — the pill and the date, 8 apart, centred. */}
                    <div className="flex items-center gap-2">
                      {playable ? (
                        <Link href={room.replayUrl!} className={pill}>
                          <IconReplayPlay className="h-3 w-3" />
                          Play now
                        </Link>
                      ) : (
                        <button type="button" disabled title="Soon" className={pill}>
                          <IconReplayPlay className="h-3 w-3" />
                          Play now
                        </button>
                      )}
                      {room.endedAt && (
                        /* One line, truncating on a too-narrow phone — the date
                           must never wrap under the pill or push past the card. */
                        <span className="tnum min-w-0 truncate text-[10px] font-medium leading-4 text-white">
                          {formatDate(room.endedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {room.owner && (
                  /* 545:47776 — a 72.43x55.62 cluster; the raised centre tile
                     (545:47777) is 32 at a 10.68 radius, ringed white at 1.67
                     with the file's `0 4px 15px rgba(147,147,147,0.25)`. Only
                     the host is drawn — see the note above. */
                  <div aria-hidden className="relative h-[56px] w-[73px] shrink-0">
                    <span
                      className={cn(
                        "absolute overflow-hidden rounded-[10.68px] border-[1.67px] border-white bg-grey-200 shadow-[0_4px_15px_0_rgba(147,147,147,0.25)]"
                      )}
                      style={{ left: 12.31, top: 0, width: 32, height: 32 }}
                    >
                      <Avatar
                        name={room.owner.displayName || room.owner.username}
                        seed={room.owner.id}
                        src={room.owner.avatarUrl}
                        size={32}
                        sizeClassName="h-full w-full"
                        className="rounded-none border-0"
                      />
                    </span>
                  </div>
                )}
              </div>
            </RoomCardShell>
          );
        })}
      </div>
    </section>
  );
}

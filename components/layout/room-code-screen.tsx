"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/button";
import { ColumnHeader } from "@/components/layout/column-header";
import { useStreamByCode } from "@/features/streams";
import { housePath } from "@/features/houses";
import { errorCode } from "@/lib/api/envelope";
import { groupRoomCode } from "@/lib/room-code";
import { opensAtLabel } from "@/lib/format";

/**
 * WHERE A SPOKEN CODE LANDS.
 *
 * The service answers one 200 carrying `access`, and that field is the whole
 * screen: whether somebody may go in depends on house membership, which is a
 * server fact — a client that tried to work it out would need the roster it is
 * precisely not allowed to see.
 *
 * Four outcomes, each said plainly:
 *
 *   · `open`         — the room, and a way into it.
 *   · `members_only` — the DOORPLATE only. It names the room so the person
 *                      knows their code was right, and says they need an
 *                      invite. It does NOT offer a join that would be refused.
 *   · `over`         — the room existed and is finished. This resolves rather
 *                      than 404ing precisely so this can be said; a code that
 *                      answered nothing would be indistinguishable from a typo.
 *   · 404            — one message for "no such code" AND for a malformed one,
 *                      deliberately identical. A refusal that told them apart
 *                      would tell somebody probing which guesses to repeat.
 *
 * A 429 is the throttle. It should only ever bite a script, so it reads as
 * "try again in a moment" rather than as an error.
 */
export function RoomCodeScreen({ code }: { code: string }) {
  const lookup = useStreamByCode(code);

  return (
    <>
      <ColumnHeader title="Join with a code" back />
      <div className="px-4 py-6">
        <p className="ws-meta">
          Code{" "}
          <span className="tnum font-semibold tracking-[0.08em] text-white">
            {groupRoomCode(code.trim().toLowerCase().replace(/[\s-]/g, ""))}
          </span>
        </p>

        {lookup.isPending && (
          <div className="flex items-center gap-2 pt-6 text-[14px] text-meta">
            <Spinner className="h-4 w-4" />
            Looking for that room…
          </div>
        )}

        {lookup.isError && (
          <div className="pt-6">
            {errorCode(lookup.error) === "RATE_LIMITED" ? (
              <>
                <p className="text-[15px] font-bold text-heading">Too many tries</p>
                <p className="ws-meta mt-2">Wait a moment and try that code again.</p>
              </>
            ) : (
              <>
                {/* One message for an unknown code and a mistyped one. */}
                <p className="text-[15px] font-bold text-heading">
                  That code doesn&apos;t match a room
                </p>
                <p className="ws-meta mt-2">
                  Check the code and try again — they are nine characters, like bcd-fghj-km.
                </p>
              </>
            )}
          </div>
        )}

        {lookup.data && <Found result={lookup.data} />}
      </div>
    </>
  );
}

function Found({ result }: { result: NonNullable<ReturnType<typeof useStreamByCode>["data"]> }) {
  const { stream, access } = result;
  const over = access === "over";
  const shut = access === "members_only";

  return (
    <div className="pt-6">
      <div className="flex items-center gap-3">
        <span className="h-14 w-14 shrink-0 overflow-hidden rounded-[16px] bg-white">
          <Avatar
            name={stream.title}
            seed={stream.id}
            src={stream.thumbnailUrl}
            size={56}
            sizeClassName="h-full w-full"
            className="rounded-none border-0"
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-bold text-white">{stream.title}</p>
          <p className="ws-meta truncate">
            {stream.owner ? `Hosted by ${stream.owner.displayName || stream.owner.username}` : "A gist room"}
          </p>
        </div>
      </div>

      {over && (
        <>
          <p className="mt-6 text-[15px] font-bold text-heading">
            {stream.status === "cancelled" ? "That room was cancelled" : "That room has ended"}
          </p>
          <p className="ws-meta mt-2">
            Codes are never reused, so this one will always point at this room.
          </p>
        </>
      )}

      {shut && (
        <>
          {/* The doorplate. It confirms the code was right and stops there —
              no join, because the join would refuse, and a button that exists
              to fail is worse than no button. */}
          <p className="mt-6 text-[15px] font-bold text-heading">This room is private</p>
          {/*
            IT NAMED A HOUSE THAT MAY NOT EXIST. A private room used to mean one
            thing — private to the house it was opened from — so "an invite from
            someone in the house" was always true. It is not any more: a room
            opened from the `+` menu is private to a GUEST LIST and has no house
            at all, and that is the shape somebody hit on the day it shipped.

            Being told to find somebody "in the house" sends them looking for a
            thing that is not there. The host is who can let them in, in both
            shapes, so the host is who the copy names.
          */}
          <p className="ws-meta mt-2">
            Only people the host invited can go in. Ask them to add you.
          </p>
        </>
      )}

      {!over && !shut && (
        <>
          {stream.status === "scheduled" && stream.scheduledAt && (
            <p className="ws-meta mt-6">{opensAtLabel(stream.scheduledAt)}</p>
          )}
          <Link
            href={housePath(stream.id)}
            className="ws-press mt-6 inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-ink transition-colors hover:bg-white"
          >
            {stream.status === "live" ? "Go in" : "Open the room"}
          </Link>
        </>
      )}
    </div>
  );
}

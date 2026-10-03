"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/button";
import { useMyKnock, useKnockWithCode } from "@/features/streams";
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

        {lookup.data && <Found result={lookup.data} code={code} />}
      </div>
    </>
  );
}

function Found({
  result,
  code,
}: {
  result: NonNullable<ReturnType<typeof useStreamByCode>["data"]>;
  /** Carried down for the knock: the code IS the evidence somebody gave it to you. */
  code: string;
}) {
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
            ONE SENTENCE, BECAUSE THIS SCREEN CANNOT TELL THE TWO SHAPES APART.

            It used to read "you need an invite from someone in the house",
            which was true while private meant one thing: private to the house
            it was opened from. A room opened from the `+` menu is private to a
            GUEST LIST and has no house at all, so that sentence sent somebody
            looking for a thing that does not exist — which is what happened on
            the day that shape shipped.

            AND IT CANNOT BE BRANCHED. The obvious fix is to check
            `houseConversationId` and say "the house" or "the host" — but the
            service deliberately NULLS that field in a refusal: the doorplate
            tells a stranger which room and whose, and nothing about who else is
            in it. So a client looking at a refused room genuinely does not know
            whether there is a house behind it, and code that branches on it
            would silently take the guest-list wording every time.

            So the sentence has to be true in BOTH. "Ask the host" is: in a
            guest-list room the host owns the list, and in a house room the host
            is a member who can add somebody. Naming what the room is private TO
            is what cannot be said here, and saying it wrongly is what made this
            a bug rather than a dead end.
          */}
          {/*
            IT MUST NOT TELL THEM TO DO SOMETHING THEY CANNOT DO HERE.

            This said "Ask the host to let you in", which is an instruction with
            no control under it — ogazboiz read it and asked, correctly, how. The
            answer today is that they ask the host somewhere else entirely, by
            message or in person, and the room has no way to carry a request.

            So it states the RULE instead of issuing an instruction. A closed
            door that explains itself is honest; a closed door that tells you to
            knock, with nothing to knock on, is worse than one that says nothing.

            This becomes "Ask to join" — a real button — the day knock-to-join
            exists. Until then the sentence does not promise it.
          */}
          <p className="ws-meta mt-2">
            Only people the host has added can go in.
          </p>
          {/*
            AND NOW THERE IS A WAY TO ASK. This screen said "ask the host" with
            no control under it, which ogazboiz answered with "but no way to
            ask" — so the sentence was softened to state the rule instead. The
            rule is still what it says; this is the door knocker beside it.

            THE CODE LETS YOU ASK, NOT IN. Holding it is evidence somebody gave
            it to you, which is why the knock carries it.
          */}
          <KnockRow stream={stream} code={code} />
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

/**
 * ASK TO COME IN — the door knocker on a private room.
 *
 * ─── THE WAITING STATE NEVER PROMISES AN ANSWER ─────────────────────────────
 * A declined knock is reported to its owner as `pending`, permanently and by
 * design: a decline somebody can detect is one they can retry against, and it
 * reports a decision that is not theirs to know. So this poll can never turn
 * into a refusal, and nothing here may imply one is coming.
 *
 * That rules out a spinner, a progress bar and a count of people ahead. A
 * spinner says "this is progressing" when the truth is that a human has to
 * look; a queue position is information about other people that a stranger at
 * the door has no business having. "Asked. Waiting for the host." is the whole
 * truth available.
 *
 * ─── ALREADY INSIDE ASKS AND IS SIMPLY IN ───────────────────────────────────
 * The host, a guest, anybody the three doors already admit gets `admitted` back
 * at once with nothing queued and nobody notified. They asked to come in and
 * they are in, so the row offers the room rather than congratulating them.
 */
function KnockRow({ stream, code }: { stream: { id: string }; code: string }) {
  const knock = useMyKnock(stream.id, true);
  const ask = useKnockWithCode();
  const mine = knock.data ?? ask.data ?? null;

  if (mine?.status === "admitted") {
    return (
      <Link
        href={housePath(stream.id)}
        className="ws-btn-create ws-press mt-5 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[13px] font-bold text-white"
      >
        Go in
      </Link>
    );
  }

  if (mine) {
    return (
      <p className="mt-5 text-[13px] text-body">
        Asked. Waiting for the host to let you in.
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={ask.isPending}
      onClick={() => ask.mutate(code)}
      className="ws-btn-create ws-press mt-5 inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
    >
      {ask.isPending ? "Asking…" : "Ask to join"}
    </button>
  );
}

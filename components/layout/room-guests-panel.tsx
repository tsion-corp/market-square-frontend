"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/button";
import { GuestPicker } from "@/components/layout/guest-picker";
import {
  useRoomGuests,
  useInviteRoomGuest,
  useRemoveRoomGuest,
  useWaitingKnocks,
  useResolveKnock,
} from "@/features/streams";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * WHO CAN COME IN, IN A ROOM THAT IS ALREADY RUNNING.
 *
 * ─── THE PIECE THAT WAS MISSING ─────────────────────────────────────────────
 * A private room's guest list IS its membership: the host, whoever they
 * invited, and nobody else. But the list could only ever be set at CREATE, so
 * once the room existed a host could not see who was on it, could not add
 * anybody, and could not take anybody off. The three routes have been live the
 * whole time and nothing called them.
 *
 * The consequence was not theoretical. A host opened a room, invited somebody,
 * the invitation reached them by no mechanism at all, and the host's only
 * remaining move was to send the room code — which is not permission. With
 * nowhere to add the person, the room was unusable and closing it and starting
 * again was the only way out.
 *
 * ─── IT LIVES WITH THE CODE AND THE LINK ────────────────────────────────────
 * In the share sheet, because that is where a host goes when they want somebody
 * to join. Putting "who can come in" anywhere else would mean finding the code,
 * discovering it does not work, and then going to look for a different screen.
 *
 * ─── HOST ONLY, AND THE SERVICE AGREES ──────────────────────────────────────
 * Reading the list is host-only (a guest asking gets a 403: a list of who was
 * invited is not something the invited get to read), and so is adding — a guest
 * who could invite would turn the list into a chain anybody on it can extend,
 * which is the one way a small room stops being small without its host doing
 * anything. So this is rendered only for the host of a house-less private room,
 * which is also the only shape the route will answer: a room WITH a house has
 * no guest list and answers 400.
 */
export function RoomGuestsPanel({ streamId }: { streamId: string }) {
  const guests = useRoomGuests(streamId, true);
  const knocks = useWaitingKnocks(streamId, true);
  const resolve = useResolveKnock(streamId);
  const waiting = knocks.data?.items ?? [];
  const invite = useInviteRoomGuest(streamId);
  const remove = useRemoveRoomGuest(streamId);
  const [adding, setAdding] = useState(false);
  /*
    The picker hands up ids; each one is sent as its own invite, because the
    route takes one person. Held so the picker can show what has been chosen
    while the requests are in flight.
  */
  const [picked, setPicked] = useState<string[]>([]);

  const rows = guests.data?.guests ?? [];

  const addPicked = () => {
    for (const id of picked) invite.mutate(id);
    setPicked([]);
    setAdding(false);
  };

  return (
    <div className="mt-5">
      {/*
        PEOPLE WAITING, ABOVE THE LIST, because a person standing at the door is
        more urgent than the list of who is already allowed through it. A knock
        the host never sees is somebody waiting on a door nobody answers, and
        they will conclude the product is broken rather than that they were
        refused.

        DECLINING IS SILENT by the service's design: the person is told nothing,
        their own knock still reads "waiting", and they cannot ask again. So this
        row disappearing is the only signal that anything happened, which is why
        it is the host's queue that has to be right rather than a confirmation
        sent to them.
      */}
      {waiting.length > 0 && (
        <div className="mb-5">
          <p className="text-[13px] font-semibold text-heading">
            {waiting.length === 1 ? "Someone is asking to come in" : `${waiting.length} people are asking to come in`}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {waiting.map((knock) => {
              const who = knock.profile;
              if (!who) return null;
              return (
                <div key={knock.id} className="flex items-center gap-2.5">
                  <Avatar name={who.displayName} seed={who.id} src={who.avatarUrl} size={32} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] text-white">{who.displayName}</span>
                    {/* How long they have been standing there is the thing a
                        host actually weighs. */}
                    {knock.createdAt && (
                      <span className="truncate text-[11px] text-meta">
                        asking {relativeTime(knock.createdAt)}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ knockId: knock.id, action: "admit" })}
                    className="ws-press rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    Let in
                  </button>
                  <button
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ knockId: knock.id, action: "decline" })}
                    title={`${who.displayName} is not told, and cannot ask again.`}
                    className="ws-press rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-body transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    No
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold text-heading">Who can come in</p>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          className="ws-press rounded-full border border-white/20 px-3 py-1 text-[12px] font-semibold text-body transition-colors hover:bg-white/10"
        >
          {adding ? "Done" : "Add people"}
        </button>
      </div>
      {/*
        THE SENTENCE A HOST NEEDS BEFORE THEY SHARE ANYTHING. The code and the
        link above are not permission — they are a shortcut for somebody already
        on this list — and a host who does not know that sends the code and
        watches their guest be refused.
      */}
      <p className="ws-meta mt-1">
        The code and link only work for people on this list.
      </p>

      {adding && (
        <div className="mt-3">
          <GuestPicker value={picked} onChange={setPicked} max={50} />
          <button
            type="button"
            disabled={picked.length === 0 || invite.isPending}
            onClick={addPicked}
            className="ws-btn-create ws-press mt-3 flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {invite.isPending && <Spinner className="h-4 w-4" />}
            {picked.length === 0 ? "Pick somebody" : `Let ${picked.length} in`}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {guests.isPending && <p className="ws-meta">Loading…</p>}
        {/*
          Nobody but the host, which is a real state rather than an error: a
          private room opened with an empty list is exactly that, and saying so
          is more use than an empty box.
        */}
        {guests.isSuccess && rows.length === 0 && (
          <p className="ws-meta">Only you, so far. Add somebody to let them in.</p>
        )}
        {rows.map((profile) => (
          <div key={profile.id} className="flex items-center gap-2.5">
            <Avatar name={profile.displayName} seed={profile.id} src={profile.avatarUrl} size={32} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-white">
              {profile.displayName}
            </span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate(profile.id)}
              title={`${profile.displayName} can no longer come in.`}
              className={cn(
                "ws-press rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-down transition-colors hover:bg-white/10",
                remove.isPending && "opacity-40"
              )}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

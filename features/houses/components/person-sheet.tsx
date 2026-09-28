"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/use-me";
import { focusLost, handFocusOn } from "@/lib/focus-handoff";
import { atHandle } from "@/lib/handle";
import { Avatar } from "@/components/ui/avatar";
import { RoleChip, VerifiedBadge } from "@/components/ui/badge";
import { IconChevronRight } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/sheet";
import type { ParticipantMeta } from "@/features/houses/lib/participant-meta";
import { sq } from "@/lib/square-path";
import { inviteGateHandle, type InviteControl } from "@/lib/speaker-invite";
import type { HostMuteControl } from "@/lib/host-mute";

/**
 * A profile, OVER the room.
 *
 * The room does not unmount and the audio does not cut. That is load-bearing
 * rather than a nicety: the discovery loop the brief describes is "listen to
 * someone, look them up, keep listening", and a full-page navigation breaks it
 * in the middle — you lose the conversation that made you curious in the first
 * place. Exactly one thing here navigates, and it says so.
 *
 * Composed with the profile slice through render-prop slots, because slices
 * never import each other; `components/layout/house-room-screen.tsx` is the one
 * place allowed to join the two.
 */
export interface PersonTarget {
  identity: string;
  name: string;
  meta: ParticipantMeta | null;
  /** Present when this person is on a seat — the host may move them down. */
  seated: boolean;
  /** Present when this person is in the audience with a hand up. */
  pendingRequestId: string | null;
  /** Their microphone is muted or not published (seated people only). */
  micMuted: boolean;
  /** This seat is the room's host — whom nobody mutes. */
  isRoomHost: boolean;
  /** Still in the room, as the host's connection sees it. Absent means not known. */
  present?: boolean;
}

/** The host's rows over one person, decided in lib/ (speaker-invite, host-mute) and only drawn here. */
export interface PersonHostActions {
  invite: InviteControl;
  onInvite: () => void;
  onCancelInvite: (requestId: string) => void;
  mute: HostMuteControl;
  onMute: () => void;
  busy: boolean;
}

export function PersonSheet({
  person,
  open,
  onClose,
  isHost,
  hostBusy,
  onMoveDown,
  onSeat,
  hostActions,
  mute,
  followSlot,
  safetySlot,
  inviteGateSlot,
  onGift,
}: {
  person: PersonTarget | null;
  open: boolean;
  onClose: () => void;
  isHost: boolean;
  hostBusy: boolean;
  onMoveDown: (person: PersonTarget) => void;
  onSeat: (person: PersonTarget) => void;
  hostActions: PersonHostActions | null;
  mute: { muted: boolean; onToggle: () => void } | null;
  followSlot: (username: string) => React.ReactNode;
  safetySlot: (
    username: string,
    mute: { muted: boolean; onToggle: () => void } | undefined
  ) => React.ReactNode;
  /** Hides the invite row for someone the host blocked (the profile slice knows). */
  inviteGateSlot?: (handle: string, row: React.ReactNode) => React.ReactNode;
  /**
   * SEND THIS PERSON A GIFT — absent where gifting is not offered.
   *
   * The dock's gift button opens a tray with a "Send to" row, which works but
   * asks the reader to pick the person AFTER choosing the object. Tapping
   * somebody and saying "send them a gift" is the way a person actually
   * arrives at the thought (ogazboiz, 2026-09-24: "how do we give a person
   * gift in a gist room"), so the room offers both doors into the same tray.
   */
  onGift?: (person: PersonTarget) => void;
}) {
  const me = useMe();
  if (!person) return null;
  const username = person.meta?.username ?? null;
  // The username, or the account id when the room token carried none.
  const gateHandle = inviteGateHandle(username, person.identity);

  /*
    IS THIS ME? You cannot follow, block, report, mute, mute-as-host or move
    yourself, so on your own card the sheet drops every one of those and keeps
    only "View full profile". Matched by username first, and by the room-token
    identity when the token carried no handle. It also lets the header draw
    YOUR real avatar and name: the room's participant meta often lacks the
    avatar, and the seeded fallback is "another avatar" — not the one you set.
  */
  const isSelf = Boolean(
    me.data && ((username && me.data.username === username) || me.data.id === person.identity)
  );
  const avatarUrl = isSelf ? (me.data?.avatarUrl ?? person.meta?.avatarUrl) : person.meta?.avatarUrl;

  /* ONE element for Invite and Cancel: swapping two conditional rows
     unmounted the focused one and dropped focus out of the modal. */
  const inviteRow =
    isHost && hostActions && (hostActions.invite.kind === "invite" || hostActions.invite.kind === "invited") ? (
      <HostRow
        label={hostActions.invite.kind === "invited" ? "Cancel invitation" : "Invite to speak"}
        hint={
          hostActions.invite.kind === "invited"
            ? "Invited. Waiting for them to answer."
            : hostActions.invite.disabled
              ? hostActions.invite.reason
              : "They'll be asked first. Their mic stays off until they tap it."
        }
        // Not a live region: the invite's own toast ("Invited Ada to speak.")
        // already says it, and a live hint made one tap three announcements.
        disabled={(hostActions.invite.kind === "invite" && hostActions.invite.disabled) || hostActions.busy}
        onClick={() => {
          if (hostActions.invite.kind === "invited") hostActions.onCancelInvite(hostActions.invite.requestId);
          else hostActions.onInvite();
        }}
      />
    ) : null;

  return (
    // The title says WHAT the sheet is, never who — the name already sits on
    // the card right under it, and a header repeating it read as the name
    // twice on every card (ogazboiz, 2026-09-28: "for everybody, not only me").
    <Sheet open={open} onClose={onClose} title={isSelf ? "Your profile" : "Profile"}>
      <div className="flex items-start gap-3">
        <Avatar
          name={person.name}
          // Seed on the IDENTITY (the account id) first, exactly as the room
          // tiles do (`userId ?? id`) — seeding on the username instead picked a
          // different mascot here from the one on the tile the reader tapped.
          // For yourself, your own id, so the sheet matches your avatar too.
          seed={(isSelf ? me.data?.id : null) ?? person.identity ?? username}
          src={avatarUrl}
          size={56}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-[15px] font-bold text-heading">{person.name}</span>
            {person.meta && (
              <>
                <VerifiedBadge
                  verification={person.meta.verification}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <RoleChip role={person.meta.role} />
              </>
            )}
          </div>
          {atHandle(username) && <p className="truncate text-[12px] text-meta">{atHandle(username)}</p>}
          {person.meta?.bio && (
            <p className="mt-1 text-[13px] leading-5 text-body">{person.meta.bio}</p>
          )}
        </div>
        {username && !isSelf && followSlot(username)}
      </div>

      {/* BACKEND B1. Without identity on the LiveKit token there is no handle,
          so there is no profile to open and no safety action to key on. Say so
          plainly rather than rendering controls that cannot resolve. */}
      {!username && (
        <p className="mt-4 text-[12px] leading-5 text-meta">
          We only know this person by their seat in the room. Their profile will open here once
          the service puts identity on the room token.
        </p>
      )}

      <div className="ws-hair mt-4 border-t pt-2">
        {/* Host actions first: they are the ones with a decision to make, and
            they are the ones this sheet was opened FOR mid-conversation. */}
        {/* Soft only: the speaker may unmute themselves. There is no lock and
            no host unmute; the escalation is "Move down to audience". */}
        {!isSelf && isHost && hostActions && hostActions.mute.kind === "mute" && (
          <HostRow
            label={hostActions.mute.label}
            hint={hostActions.mute.disabled ? hostActions.mute.reason : "They can unmute when it's their turn."}
            disabled={hostActions.mute.disabled || hostActions.busy}
            onClick={hostActions.onMute}
          />
        )}
        {!isSelf && isHost && person.seated && (
          <HostRow label="Move down to audience" disabled={hostBusy} onClick={() => onMoveDown(person)} />
        )}
        {!isSelf && isHost && !person.seated && hostActions?.invite.kind === "seat" && (
          <HostRow label="Seat them" disabled={hostBusy} onClick={() => onSeat(person)} />
        )}
        {/* Without the invite routes (not deployed) a raised hand still seats. */}
        {!isSelf && isHost && !person.seated && !hostActions && person.pendingRequestId && (
          <HostRow label="Seat them" disabled={hostBusy} onClick={() => onSeat(person)} />
        )}
        {/* Someone the host blocked gets no invite row at all: the gate
            wraps whichever state it is in, so the element stays the same. */}
        {!isSelf && inviteRow && (gateHandle && inviteGateSlot ? inviteGateSlot(gateHandle, inviteRow) : inviteRow)}

        {/* Never on yourself: the service refuses a self-gift outright, so the
            row would be a control whose only outcome is an error. */}
        {!isSelf && onGift && (
          <HostRow
            label="Send a gift"
            hint="Everyone in the room sees what you sent and who it was for."
            disabled={false}
            onClick={() => onGift(person)}
          />
        )}

        {username && (
          <Link
            href={sq(`/u/${username}`)}
            className="ws-row flex w-full items-center gap-3 px-1 py-3 text-[13px] font-semibold text-body"
          >
            {/* The ONE thing here that navigates, and the label says so. */}
            <span className="min-w-0 flex-1">View full profile</span>
            <IconChevronRight className="h-4 w-4 text-meta" />
          </Link>
        )}

        {/* Mute · Block · Report, in that order. Mute is first because
            blocking in a room of twelve is a public act with a social cost, so
            people do not do it and eat the harassment instead. NONE of these is
            yours to do to yourself, so they are all absent on your own card. */}
        {!isSelf &&
          (username
            ? safetySlot(username, mute ?? undefined)
            : mute && (
                <button
                  type="button"
                  onClick={mute.onToggle}
                  className="ws-row flex w-full items-center px-1 py-3 text-left text-[13px] font-semibold text-body"
                >
                  {mute.muted ? "Unmute for me" : "Mute for me only"}
                </button>
              ))}
      </div>
    </Sheet>
  );
}

/**
 * A host action. Disabled is `aria-disabled`, never `disabled`: a button that
 * disables drops its focus, and the row explaining WHY it is off must stay
 * reachable and readable, so only the label dims. A row that leaves while
 * focused (Invite once they are seated, Seat once they are up) hands focus to
 * the first host row left, or the sheet itself — never to <body> outside it.
 */
function HostRow({
  label,
  hint,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    const dialog = button.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    return () => {
      if (!focused.current) return;
      window.setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (!focusLost(active, document.body) || !dialog) return;
        if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
        handFocusOn(active, document.body, [dialog.querySelector<HTMLElement>("[data-host-row]"), dialog]);
      }, 0);
    };
  }, []);
  return (
    <button
      ref={button}
      type="button"
      data-host-row=""
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(event) => {
        // Removal blurs with no relatedTarget; the cleanup above handles that.
        if (event.relatedTarget) focused.current = false;
      }}
      className={cn(
        // 44px on touch with or without a hint: a 13px label in py-3 is 43.5.
        "ws-row flex w-full min-h-11 flex-col justify-center items-start px-1 py-3 text-left transition-colors",
        disabled && "cursor-not-allowed"
      )}
    >
      <span className={cn("text-[13px] font-semibold text-body", disabled && "opacity-50")}>{label}</span>
      {hint && (
        <span className="mt-0.5 text-[11px] leading-4 text-grey-300">
          {hint}
        </span>
      )}
    </button>
  );
}

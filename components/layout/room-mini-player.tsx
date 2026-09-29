"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { InviteBannerDock, houseTopic, parseParticipantMeta, participantName } from "@/features/houses";
import { useEndStream, useStageSlots } from "@/features/streams";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DestructiveConfirmSheet } from "@/components/ui/destructive-confirm-sheet";
import { IconFullscreen, IconRefresh, IconVolume, IconX } from "@/components/ui/icons";
import { IconRoomLeave, IconRoomMic, IconRoomMicOff } from "@/components/ui/room-icons";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/cn";
import { useChatOpen } from "@/lib/chat-open-store";
import { micControl } from "@/lib/mic-consent";
import { setMiniCard, setMiniPlayer, useRoomBar } from "@/lib/room-bar-store";
import { useRoomSession, type RoomSessionView } from "@/lib/room-session-store";
import { sharedSurfaceTitle } from "@/lib/room-session/media-session";
import {
  miniPlayerCardPlacement,
  miniPlayerChrome,
  miniPlayerVisible,
  rejoinLabel,
  roomChipLabel,
  roomChipVisible,
  type MiniPlayerCardPlacement,
} from "@/lib/room-session/visibility";
import { sq, stripSquare } from "@/lib/square-path";
import { inviteBannerVisible } from "@/lib/speaker-invite";

/**
 * THE MINIMISED GIST ROOM.
 *
 * The room keeps playing wherever the reader goes inside the Square (the
 * shell's RoomSessionProvider owns the call); this is how they see it, talk in
 * it and get back to it. Rendered by AppShell — never by a route — in three
 * placements that share one body:
 *
 *   · `phone` — a 56px bar ABOVE the dock, safe-area aware. It rings
 *     `setMiniPlayer`, and the shell stamps `data-mini-player` so the
 *     stylesheet adds its height to `--ws-nav-h` and to the floating `+`
 *     offsets: nothing scrolls under it and no button sits on it. Where the
 *     bar steps aside (an open chat thread, another room's own bar) a compact
 *     chip takes its place in EVERY state — listening, failed, ended, another
 *     tab, a publisher's mic — with the same state line, Retry, Dismiss, mic
 *     and hang-up, up top where the keyboard and the composer cannot reach.
 *   · `card` — a 320px card at the bottom-left on desktop when the rail is off
 *     (guests included), clear of the centred dock. While a chat thread is
 *     open there is no dock and the thread's composer owns the foot, so the
 *     card moves to the top-right of the thread instead.
 *   · `rail` — the rail's foot when the rail is on.
 *
 * States: Connecting, Reconnecting, Room ended (cleared after 5 s by the
 * provider), Playing in another tab, Audio paused.
 * What is drawn reads the CONNECTION (lib/room-session/visibility.ts
 * `miniPlayerChrome`), never the open "join another room?" question — which
 * used to hide the mic, the live badge and Retry for as long as it stood.
 * A publisher gets the mic toggle and, while it is open, "You're live" in the
 * state line — a hot mic somewhere the reader cannot see is the one thing
 * this bar must never let them forget. It is a badge beside the title, not a
 * pill among the controls: there it pushed the title to nothing and the
 * hang-up off the rail.
 *
 * FITTING THE FRAME. The labelled rail stacks the title over a control row
 * that wraps; a phone draws Listen and Retry as icons and never more than
 * three trailing controls; the icon rail's frame drops its border and side
 * padding so 44px targets fit its 48px column. Every control is a 44px target
 * under a coarse pointer at any width (a tablet is touch too) and shrinks to
 * its 36px circle only under a fine one; one always-mounted live region
 * announces the state and the mic.
 *
 * After a reload there is no session (nobody's call resumes without them), so
 * the same placement offers "Rejoin <room>" instead.
 */
type Placement = "phone" | "card" | "rail";

/** Before the bar unmounts under the reader's focus: land it somewhere stable. */
function keepFocus() {
  const main = document.querySelector("main");
  if (!(main instanceof HTMLElement)) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
}

export function RoomMiniPlayer({ placement }: { placement: Placement }) {
  return <MiniPlayer placement={placement} />;
}

/**
 * A HOST'S INVITATION TO SPEAK, while the room is minimised.
 *
 * Read from the session — the provider's 8 s poll of the reader's own
 * speaker-request row, nudged by the `speakerInvited` push — never from the
 * push itself. Drawn on every page but the room's own, which draws its own
 * (lib/speaker-invite.ts `inviteBannerVisible`). Up top, under the top bar,
 * where neither the dock, this bar nor a thread's composer can cover it.
 * Answering does not navigate: "Join as speaker" seats them over the call they
 * already have, mic off, and the bar below grows its mic.
 *
 * The shell mounts ONE, straight after the top bar and BEFORE <main>: it is
 * drawn at the top of the page, so it is read and tabbed to there too. Mounted
 * with the bottom bar it sat after every post of a long feed in reading order,
 * well past the invitation's 60 seconds for a keyboard user. Where it is
 * drawn, and inside an open sheet, is `InviteBannerDock`'s one rule.
 */
export function RoomInviteBanner() {
  const session = useRoomSession();
  const pathname = stripSquare(usePathname());
  const streamId = session.state.target?.streamId ?? null;
  const invite = session.invite;
  const visible = inviteBannerVisible({ pathname, streamId, hasInvite: invite !== null });
  const owner = session.stream?.owner ?? null;
  const hostName = owner?.displayName || owner?.username || "The host";
  return (
    <>
      {/* Announced by the session (room-session.tsx InviteAnnouncer), never
          here: a region that fills in on every route change repeats it. */}
      {visible && invite && (
        <InviteBannerDock
          key={invite.requestId}
          offset="var(--ws-topbar-h) + var(--ws-crumb-h)"
          requestId={invite.requestId}
          inviteExpiresAt={invite.inviteExpiresAt}
          createdAt={invite.createdAt}
          seenAt={invite.seenAt}
          clockOffsetMs={invite.clockOffsetMs}
          host={{ id: owner?.id, name: hostName, avatarUrl: owner?.avatarUrl }}
          busy={session.answeringInvite}
          onAccept={() => session.answerInvite("accept")}
          onReject={() => session.answerInvite("reject")}
        />
      )}
    </>
  );
}

function MiniPlayer({ placement }: { placement: Placement }) {
  const session = useRoomSession();
  const pathname = stripSquare(usePathname());
  const chatOpen = useChatOpen();
  const roomBar = useRoomBar();
  const phone = useMediaQuery("(max-width: 767px)");
  const onPhone = placement === "phone";
  const streamId = session.state.target?.streamId ?? null;
  const where = {
    pathname,
    session: { status: session.state.status, streamId },
    chatOpen,
    isPhone: phone,
    roomBarUp: roomBar,
  };
  const visible = onPhone === phone && miniPlayerVisible(where);
  const chip = onPhone && phone && roomChipVisible(where);

  const offer = session.rejoinOffer;
  const offering =
    onPhone === phone &&
    !visible &&
    session.state.status === "idle" &&
    offer !== null &&
    pathname !== `/gist-rooms/${offer.streamId}` &&
    !(phone && (chatOpen || roomBar));

  // The phone bar and the desktop card reserve their room; the rail and the chip float.
  const up = onPhone && (visible || offering);
  useEffect(() => {
    if (!onPhone) return;
    setMiniPlayer(up);
    return () => setMiniPlayer(false);
  }, [onPhone, up]);
  const cardPlacement = miniPlayerCardPlacement({ chatOpen, roomBarUp: roomBar });
  const cardMode = placement === "card" && !phone && (visible || offering) ? cardPlacement : "off";
  useEffect(() => {
    if (placement !== "card") return;
    setMiniCard(cardMode);
    return () => setMiniCard("off");
  }, [placement, cardMode]);

  if (offering && offer) {
    const label = rejoinLabel(offer.title);
    return (
      <Frame placement={placement} cardPlacement={cardPlacement} announcement={label}>
        <Link
          href={sq(`/gist-rooms/${offer.streamId}`)}
          onClick={() => session.dismissRejoin()}
          aria-label={label}
          title={label}
          className={cn(
            "ws-press flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-full px-1 text-left pointer-fine:min-h-9",
            RAIL_ICON_LINK
          )}
        >
          {/* Static, not the live pulse: nothing has checked the room is still open. */}
          <span className="h-2 w-2 shrink-0 rounded-full bg-grey-400" aria-hidden />
          <span className="min-w-0 flex-1 group-data-[rail=icon]/rail:hidden">
            <span className="block text-[11px] font-semibold uppercase leading-4 tracking-[0.04em] text-grey-400">
              Rejoin
            </span>
            <span className="block truncate text-[13px] font-bold leading-5 text-heading">
              {offer.title || "Your gist room"}
            </span>
          </span>
        </Link>
        <Controls>
          <RoundButton
            label="Dismiss"
            onClick={() => {
              keepFocus();
              session.dismissRejoin();
            }}
          >
            <IconX className="h-3.5 w-3.5" />
          </RoundButton>
        </Controls>
      </Frame>
    );
  }

  if (chip && streamId) return <RoomChip session={session} streamId={streamId} chatOpen={chatOpen} />;
  if (!visible || !streamId) return null;
  return <PlayerBody placement={placement} session={session} streamId={streamId} cardPlacement={cardPlacement} />;
}

/**
 * The icon rail is 72px: the return link collapses to a round target (the
 * status dot inside it), never to the bare 8px dot. 44px under a coarse
 * pointer, like every other control here (the frame's 48px column fits it);
 * 40px only under a fine one.
 */
const RAIL_ICON_LINK =
  "group-data-[rail=icon]/rail:h-11 group-data-[rail=icon]/rail:w-11 group-data-[rail=icon]/rail:pointer-fine:h-10 group-data-[rail=icon]/rail:pointer-fine:w-10 group-data-[rail=icon]/rail:min-h-0 group-data-[rail=icon]/rail:flex-none group-data-[rail=icon]/rail:justify-center group-data-[rail=icon]/rail:bg-white/[0.06] group-data-[rail=icon]/rail:px-0";

function PlayerBody({
  placement,
  session,
  streamId,
  cardPlacement,
}: {
  placement: Placement;
  session: RoomSessionView;
  streamId: string;
  cardPlacement: MiniPlayerCardPlacement;
}) {
  const router = useRouter();
  const { state, stream, presence, room } = session;
  const slots = useStageSlots(room, stream?.ownerId ?? "");
  const chrome = miniPlayerChrome({ state, presence, micOn: session.micOn, canPlayAudio: session.canPlayAudio });
  const { line, publishing, finished } = chrome;

  // A private room's topic stays on its own page; this bar is on every page.
  const title = stream ? sharedSurfaceTitle(stream, houseTopic(stream)) : "Gist room";
  const roomHref = sq(`/gist-rooms/${streamId}`);
  const faces = slots.slice(0, 3);

  return (
    <Frame placement={placement} cardPlacement={cardPlacement} announcement={chrome.announcement}>
      {/* Back to the room: the whole identity block, so the target is large. */}
      <Link
        href={roomHref}
        aria-label={line ? `Return to ${title}, ${line}` : `Return to ${title}`}
        title={line ? `Return to ${title}, ${line}` : `Return to ${title}`}
        className={cn(
          "ws-press flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full text-left pointer-fine:min-h-9",
          RAIL_ICON_LINK
        )}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            chrome.live ? "ws-live-dot bg-accent" : finished ? "bg-grey-600" : "bg-grey-400"
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 group-data-[rail=icon]/rail:hidden">
          <span className="block truncate text-[13px] font-bold leading-5 text-heading">{title}</span>
          {line && !chrome.liveBadge ? (
            <span
              className={cn(
                "block truncate text-[11px] font-semibold leading-4",
                chrome.retry || state.connection === "reconnecting" ? "text-grey-300" : "text-grey-400"
              )}
            >
              {line}
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              {chrome.liveBadge && (
                <span className="flex h-4 shrink-0 items-center gap-1 rounded-full bg-white px-1.5 text-[10px] font-bold leading-none text-ink">
                  <span className="ws-live-dot h-1.5 w-1.5 rounded-full bg-ink" aria-hidden />
                  You&apos;re live
                </span>
              )}
              {faces.length > 0 && (
                <span className="flex -space-x-1.5" aria-hidden>
                  {faces.map((slot) => {
                    const owner = slot.role === "host" ? stream?.owner : null;
                    const meta = parseParticipantMeta(slot.metadata);
                    return (
                      <span
                        key={slot.identity}
                        className={cn(
                          "rounded-full ring-2 ring-chrome",
                          slot.isSpeaking && "ring-accent"
                        )}
                      >
                        <Avatar
                          name={owner?.displayName ?? participantName(slot.name) ?? slot.name}
                          seed={owner?.id ?? slot.identity}
                          src={owner?.avatarUrl ?? meta?.avatarUrl ?? null}
                          size={16}
                        />
                      </span>
                    );
                  })}
                </span>
              )}
              <span className="truncate text-[11px] font-semibold leading-4 text-grey-400">
                {room ? `${room.numParticipants} in the room` : "Live"}
              </span>
            </span>
          )}
        </span>
      </Link>

      <Controls>
        {/* Listen: the browser refused to autoplay, and this press is the
            gesture it wants. A glyph on a phone and in the icon rail, where a
            text button squeezed the title to nothing. */}
        {chrome.listen &&
          (placement === "phone" ? (
            <RoundButton label="Listen" onClick={session.startAudio}>
              <IconVolume className="h-4 w-4" />
            </RoundButton>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={session.startAudio} className="shrink-0 pointer-coarse:h-11 group-data-[rail=icon]/rail:hidden">
                Listen
              </Button>
              {placement === "rail" && (
                <RoundButton label="Listen" onClick={session.startAudio} className="hidden group-data-[rail=icon]/rail:grid">
                  <IconVolume className="h-4 w-4" />
                </RoundButton>
              )}
            </>
          ))}

        {chrome.retry &&
          (placement === "phone" ? (
            <RoundButton label="Retry the connection" onClick={session.retry}>
              <IconRefresh className="h-4 w-4" />
            </RoundButton>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={session.retry} className="shrink-0 pointer-coarse:h-11 group-data-[rail=icon]/rail:hidden">
                Retry
              </Button>
              {placement === "rail" && (
                <RoundButton label="Retry the connection" onClick={session.retry} className="hidden group-data-[rail=icon]/rail:grid">
                  <IconRefresh className="h-4 w-4" />
                </RoundButton>
              )}
            </>
          ))}

        {publishing && <MicButton session={session} />}

        {finished ? (
          <DismissButton session={session} />
        ) : (
          <>
            {/* The phone's whole bar is the way back; three trailing controls at most. */}
            {placement !== "phone" && (
              <RoundButton
                label="Return to room"
                onClick={() => router.push(roomHref)}
                className="group-data-[rail=icon]/rail:hidden"
              >
                {/* An EXPAND glyph — this restores the minimised room to its
                    full page. A chevron-up read as "scroll up"/"collapse", not
                    "open this back up" (ogazboiz, 2026-09-28). */}
                <IconFullscreen className="h-4 w-4" />
              </RoundButton>
            )}
            <HangUp session={session} streamId={streamId} />
          </>
        )}
      </Controls>
    </Frame>
  );
}

/**
 * THE ROOM, while the phone's bar has stepped aside for an open chat thread or
 * another room's own bar. Up top — under the top strip and the thread's header
 * — where neither the keyboard nor the composer can cover it. Every state gets
 * it (lib/room-session/visibility.ts `roomChipVisible`): a listener must be
 * able to hang up, and a failed or finished room to be retried or dismissed,
 * from inside a DM as much as a publisher must reach an open mic.
 */
function RoomChip({
  session,
  streamId,
  chatOpen,
}: {
  session: RoomSessionView;
  streamId: string;
  chatOpen: boolean;
}) {
  const title = session.stream ? sharedSurfaceTitle(session.stream, houseTopic(session.stream)) : "your gist room";
  const chrome = miniPlayerChrome({
    state: session.state,
    presence: session.presence,
    micOn: session.micOn,
    canPlayAudio: session.canPlayAudio,
  });
  const text = chrome.hotMic ? "You're live" : (chrome.line ?? "In a gist room");
  return (
    <div
      role="region"
      aria-label="Gist room"
      className="ws-glass fixed z-40 flex max-w-[calc(100vw-24px)] items-center gap-1 rounded-full border border-white/10 bg-chrome/90 py-0.5 pl-1 pr-0.5 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.95)] md:hidden"
      style={{
        right: "max(12px, env(safe-area-inset-right, 0px))",
        // Under what it shares the screen with, never over it: a thread's
        // 80px header, or ANOTHER ROOM's sticky header, which publishes its
        // measured height — a fixed 88 sat on that room's title and beside its
        // own red Leave.
        top: chatOpen
          ? "calc(var(--ws-topbar-h) + 88px)"
          : "calc(var(--ws-topbar-h) + var(--ws-house-head-h) + 8px)",
      }}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {chrome.announcement}
      </p>
      <Link
        href={sq(`/gist-rooms/${streamId}`)}
        aria-label={roomChipLabel({ title, text, finished: chrome.finished })}
        className="ws-press flex h-11 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold leading-none text-heading"
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            chrome.live ? "ws-live-dot bg-accent" : chrome.finished ? "bg-grey-600" : "bg-grey-400"
          )}
          aria-hidden
        />
        <span className="truncate">{text}</span>
      </Link>
      {chrome.listen && (
        <RoundButton label="Listen" onClick={session.startAudio}>
          <IconVolume className="h-4 w-4" />
        </RoundButton>
      )}
      {chrome.retry && (
        <RoundButton label="Retry the connection" onClick={session.retry}>
          <IconRefresh className="h-4 w-4" />
        </RoundButton>
      )}
      {chrome.publishing && <MicButton session={session} />}
      {chrome.finished ? <DismissButton session={session} /> : <HangUp session={session} streamId={streamId} />}
    </div>
  );
}

/** Clear a finished room (ended, removed, another tab) off the screen. */
function DismissButton({ session }: { session: RoomSessionView }) {
  return (
    <RoundButton
      label="Dismiss"
      onClick={() => {
        keepFocus();
        session.dismiss();
      }}
    >
      <IconX className="h-3.5 w-3.5" />
    </RoundButton>
  );
}

/**
 * THE RED BUTTON, one for the bar and the chip. A listener's leave costs nobody
 * anything and stays one tap; a seated speaker gives up their seat, and the
 * host closes the room for everyone, so both ask first.
 */
function HangUp({ session, streamId }: { session: RoomSessionView; streamId: string }) {
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmLeaveStage, setConfirmLeaveStage] = useState(false);
  const endRoom = useEndStream({ successMessage: "Gist room closed" });
  const { presence } = session;
  // Named, so this red button cannot be mistaken for the one on another room's page.
  const title = session.stream ? sharedSurfaceTitle(session.stream, houseTopic(session.stream)) : "the gist room";

  const leave = () => {
    keepFocus();
    void session.leave();
  };

  return (
    <>
      <RoundButton
        label={presence === "host" ? `Close ${title}` : `Leave ${title}`}
        onClick={() =>
          presence === "host"
            ? setConfirmClose(true)
            : presence === "speaker"
              ? setConfirmLeaveStage(true)
              : leave()
        }
        tone="danger"
      >
        <IconRoomLeave className="h-4 w-4" />
      </RoundButton>

      <DestructiveConfirmSheet
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Close the gist room?"
        body="Everyone will be sent out and the gist room will be closed."
        confirmLabel="Close it"
        loading={endRoom.isPending}
        onConfirm={() =>
          /*
            The promise, not a per-call `onSuccess`: closing flips the room to
            ended, which unmounts this chip, and a `mutate` callback dies with
            its observer — the room would close upstream while this tab stayed
            connected. Backstage had the same bug and the same fix.
          */
          endRoom
            .mutateAsync(streamId)
            .then(() => {
              setConfirmClose(false);
              keepFocus();
              void session.end();
            })
            .catch(() => {
              // useEndStream toasts the failure; the sheet stays open to retry.
            })
        }
      />

      <DestructiveConfirmSheet
        open={confirmLeaveStage}
        onClose={() => setConfirmLeaveStage(false)}
        title="Leave the stage?"
        body="You'll lose your seat. Coming back, you'll need to ask to speak again."
        confirmLabel="Leave"
        onConfirm={() => {
          setConfirmLeaveStage(false);
          leave();
        }}
      />
    </>
  );
}

function MicButton({ session }: { session: RoomSessionView }) {
  // One decision for every mic control (lib/mic-consent.ts). A host's mute is
  // soft, so it never disables this button: the speaker may unmute.
  const control = micControl({
    permissions: { canPublish: !session.micDisabled, microphone: !session.micDisabled },
    micOn: session.micOn,
  });
  return (
    <RoundButton
      label={control.label}
      onClick={() => void session.toggleMic()}
      disabled={control.disabled}
      data-room-mic
      tone={session.micOn ? "on" : "default"}
    >
      {control.icon === "mic" ? (
        <IconRoomMic className="h-4 w-4" />
      ) : (
        <IconRoomMicOff className="h-4 w-4" />
      )}
    </RoundButton>
  );
}

/**
 * A 36px circle in a 44px target on touch (Apple's 44pt, the rule the stage
 * tiles already follow). The target shrinks to the circle only under a FINE
 * pointer — never by width: 768–1023px is an iPad, and a missed tap on the mic
 * there landed on the red button 8px away.
 */
function RoundButton({
  label,
  onClick,
  children,
  disabled = false,
  tone = "default",
  className,
  "data-room-mic": roomMic,
}: {
  /** Marks the mic control, where an accepted invitation hands focus. */
  "data-room-mic"?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  tone?: "default" | "on" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-room-mic={roomMic ? "" : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "ws-press group/round grid h-11 w-11 shrink-0 place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 pointer-fine:h-9 pointer-fine:w-9",
        className
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 place-items-center rounded-full transition-colors",
          tone === "danger"
            ? "bg-danger/[0.13] text-danger group-hover/round:bg-danger/20"
            : tone === "on"
              ? "bg-white text-ink"
              : "bg-white/[0.06] text-heading group-hover/round:bg-white/10"
        )}
      >
        {children}
      </span>
    </button>
  );
}

/**
 * The trailing controls. Inline on the phone bar and the card; in the
 * labelled rail a row of its own under the title that wraps rather than
 * pushing the hang-up past the aside's clipped edge; a column in the icon rail.
 */
function Controls({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 max-md:gap-3 group-data-[rail=icon]/rail:flex-col group-data-[rail=full]/rail:w-full group-data-[rail=full]/rail:flex-wrap group-data-[rail=full]/rail:justify-end">
      {children}
    </div>
  );
}

/** Where the body sits. One body, three frames — and one live region in each. */
function Frame({
  placement,
  cardPlacement,
  announcement,
  children,
}: {
  placement: Placement;
  cardPlacement: MiniPlayerCardPlacement;
  announcement: string;
  children: React.ReactNode;
}) {
  // Always mounted, so a change of text is announced; a region inserted
  // together with its text often is not.
  const live = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );
  if (placement === "phone") {
    return (
      <div
        className="fixed z-40 md:hidden"
        style={{
          // Above the dock: its 72 plus its 24 inset, plus 8 of air, over the home indicator.
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 104px)",
          left: "max(12px, env(safe-area-inset-left, 0px))",
          right: "max(12px, env(safe-area-inset-right, 0px))",
        }}
      >
        <div
          role="region"
          aria-label="Gist room"
          className="ws-glass flex h-14 items-center gap-3 rounded-2xl border border-white/10 bg-chrome/90 px-2 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.95)]"
        >
          {live}
          {children}
        </div>
      </div>
    );
  }
  if (placement === "card") {
    return (
      <div
        role="region"
        aria-label="Gist room"
        className={cn(
          "ws-glass fixed z-40 hidden w-[320px] max-w-[calc(100vw-48px)] items-center gap-2 rounded-2xl border border-white/10 bg-chrome/90 p-3 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.95)] md:flex"
        )}
        style={
          cardPlacement === "thread"
            ? // No dock over an open thread, and its composer owns the foot:
              // the top-right of the thread, under the top bar and its header.
              // The thread pads its scroll top by the card (--ws-thread-top-inset).
              { top: "calc(var(--ws-crumb-h) + 92px)", right: "max(24px, env(safe-area-inset-right, 0px))" }
            : cardPlacement === "above-room-bar"
              ? // Another room's control bar owns the foot (--ws-nav-h is 0 there):
                // above it, never on its mic or Ask to speak.
                { bottom: "calc(var(--ws-nav-h) + 96px)", left: "max(24px, env(safe-area-inset-left, 0px))" }
              : // Clear of the centred dock, which on a narrow desktop reaches this
                // corner, and of a landscape phone's sensor housing. The page's
                // foot reserves the card (--ws-mini-card-h), which the offset
                // takes back out so the card does not climb by its own room.
                {
                  bottom: "calc(var(--ws-nav-h) - var(--ws-mini-card-h, 0px) + 8px)",
                  left: "max(24px, env(safe-area-inset-left, 0px))",
                }
        }
      >
        {live}
        {children}
      </div>
    );
  }
  return (
    <div
      role="region"
      aria-label="Gist room"
      className="mb-3 flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2 group-data-[rail=icon]/rail:border-0 group-data-[rail=icon]/rail:px-0 group-data-[rail=full]/rail:items-stretch group-data-[rail=full]/rail:p-3"
    >
      {live}
      {children}
    </div>
  );
}

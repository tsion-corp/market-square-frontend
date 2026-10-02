"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { profileHref } from "@/lib/profile-href";
import { toast } from "sonner";
import { atHandle } from "@/lib/handle";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { useMe } from "@/hooks/use-me";
import { useGate } from "@/hooks/use-gate";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useMentionTyping } from "@/hooks/use-mention-typing";
import { MentionPicker } from "@/components/ui/mention-picker";
import { PostText } from "@/components/ui/post-text";
import { mentionCandidates, type MentionableMember } from "@/lib/mentionable-members";
import { replyExcerpt } from "@/lib/message-reply";
import { Avatar } from "@/components/ui/avatar";
import { MemberRoleChip, VerifiedBadge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";
import { MediaFrame } from "@/components/ui/media-frame";
import { InlineVideo } from "@/components/ui/inline-video";
import { MediaViewer } from "@/components/ui/media-viewer";
import { downloadLinkFor } from "@/lib/message-media-link";
import { canSendSnap, snapTimeLeft, snapView } from "@/features/messages/lib/snap-view";
import { defaultViewOnce, type MediaSource } from "@/features/messages/lib/camera-capture";
import { CameraSheet } from "@/features/messages/components/camera-sheet";
import { ViewOnceMark } from "@/components/ui/view-once";
import { MediaSendBar } from "@/features/messages/components/media-send-bar";
import { MediaEditor, type MediaEditorHandle } from "@/features/messages/components/media-editor";
import { useQueryClient } from "@tanstack/react-query";
import { isHttpUrl } from "@/lib/http-url";
import { RowSkeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/ui/sheet";
import { GroupSettingsSheet } from "@/features/messages/components/group-settings-sheet";
import { ShareSheet } from "@/components/ui/share-sheet";
import { canMakeInvite, inviteUrl } from "@/features/messages/lib/invites";
import { memberActions, viewerRole, type GroupRole } from "@/features/messages/lib/roles";
import { ErrorState } from "@/components/ui/states";
import Link from "next/link";
import { housePath } from "@/lib/house-path";
import { Button } from "@/components/ui/button";
import { ThreadMenu } from "@/features/messages/components/thread-menu";
import {
  AttachmentPanel,
  type Measured,
} from "@/features/messages/components/attachment-panel";
import { formatBytes, type UploadResult } from "@/lib/api/upload";
import { canSendMessage, type OutgoingMessage } from "@/features/messages/lib/outgoing";
import { useVoiceRecorder } from "@/features/messages/hooks/use-voice-recorder";
import { formatElapsed } from "@/features/messages/lib/voice-recorder";
import { dotScale } from "@/lib/voice-levels";
import { isReplySwipe, SWIPE_TRIGGER, swipeCommits, swipeOffset } from "@/lib/swipe-reply";
import { uploadFile } from "@/lib/api/upload";
import { IconArrowLeft, IconCamera, IconDownload, IconFullscreen, IconHouses, IconMic, IconPlay, IconPause, IconPlus, IconQuote, IconSend, IconX } from "@/components/ui/icons";
import { IconTrash } from "@/components/ui/thread-icons";
import {
  useConversationMembers,
  useLeaveGroup,
  useDeleteConversation,
  useMarkConversationRead,
  useMessageHistory,
  useMessages,
  useRenameGroup,
  useSendMessage,
  useOpenSnap,
  useRemoveMessage,
  useModerateMessage,
  useEditMessage,
  useCreateInvite,
  useRemoveGroupMember,
  useSetMemberRole,
  useSetMemberMuted,
  useWithdrawInvite,
  useTransferOwnership,
} from "@/features/messages/hooks/use-messages";
import {
  formatClockTime,
  groupBySender,
  groupMessagesByDay,
} from "@/features/messages/lib/thread-groups";
import {
  isGroupThread,
  threadSubtitleParts,
  threadTitle,
} from "@/features/messages/lib/thread-identity";
import { receiptLabel, receiptState, type ReceiptState } from "@/features/messages/lib/read-receipt";
import {
  fileExtensionLabel,
  formatDuration,
  mediaRatio,
  messageMediaKind,
} from "@/features/messages/lib/message-media";
import { playProgress, playedBars, waveformBars } from "@/features/messages/lib/waveform";
import {
  anchorAfterPrepend,
  isAtBottom,
  isNearTop,
  mergeHistory,
} from "@/features/messages/lib/thread-scroll";
import {
  MESSAGE_MAX,
  type Conversation,
  type Message,
  type MessageReplyTo,
} from "@/features/messages/lib/types";
import type { Profile } from "@/lib/api/schemas";
import { asset, sq } from "@/lib/square-path";

/**
 * The conversation pane — the right-hand 751px column of the Messages screen.
 *
 * ONE component for both of the design's threads. Node 21:5519 is the 1:1
 * ("gist DM") and node 21:6024 the group ("house DM"), and they are the same
 * pane with four differences: what the header says, a Create Gist Room pill
 * beside the overflow control, a 24px sender avatar hanging off incoming
 * bubbles with a tail on the bubble's bottom-left corner, and a real date on
 * the day separator instead of "Today". Building them as two components would
 * mean two composers, two scroll controllers and two mark-as-read effects, and
 * the first fix to either would land in one of them.
 *
 * Three bands at the design's numbers: an 80px identity header, the message
 * river in day sections, and an 80px composer. Both bands are inset 16/24 with
 * a 10% white hairline, and the river sits in the same 24px gutters (703 of
 * content inside 751).
 *
 * TYPEFACE. The design names Roboto for the bubbles and separators and Geist
 * for the composer field. The app is Geist throughout, so every size, weight,
 * line-height and letter-spacing below is the design's and the family is the
 * app's — one pane rendering in a second family reads as a bug rather than as
 * a design.
 *
 * WHAT IS INERT AND WHY is stated at each control. The rule this pane follows
 * is the house one: a capability with no route behind it is DRAWN and
 * disabled, never wired to a plausible-looking request.
 *
 * ─── REPLY-TO AND @MENTIONS HAVE NO FIGMA NODE ──────────────────────────────
 * Neither 21:5519 nor 21:6024 draws a quoted reply, a reply affordance, a
 * "Replying to" strip or a mention. They are built in the bubbles' own
 * language — the same 16px radius, the same white / #7E3BEB fills, the 14/20
 * body and 12/16 meta — and kept minimal: a quote block inside the bubble, a
 * strip above the composer in the attachment chip's recipe, and the shared
 * mention picker the post composer already opens. Until the service ships
 * the fields, a message without `replyTo` draws no quote and the composer
 * still sends; nothing here fakes either.
 */

/**
 * The round icon button that appears across this pane — the header's overflow
 * control, the composer's attachment and voice buttons, and send.
 *
 * Geometry is the design's, literally: 38.37px and a 1px ring. The fill really
 * is nothing on the first three — #11064:5761, :5764, :5770 and :5773 each
 * report `rgba(0, 0, 0, 0)`, and this was once read as a serialisation
 * artefact and painted #0A0A0A. It is not one: send sits in the same node tree
 * and reports its own fill perfectly well, so transparency is not being lost on
 * the way out. These circles have no fill and the pane behind them shows
 * through.
 */
function CircleButton({
  label,
  icon,
  size,
  onClick,
  disabled,
  title,
  variant = "outline",
  className,
}: {
  label: string;
  icon: React.ReactNode;
  /** The glyph's own box — 16 or 24 in the design, per icon. */
  size: number;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  /**
   * `send` is the one circle with a fill: a near-black #1C1C1C disc, which is
   * `--color-grey-800` exactly. Its #9B9B9B stroke paint sits at weight 0 like
   * every other button here, so there is no silver RING — the earlier reading
   * of one came from the MCP tool dropping the zero weight. What actually
   * distinguishes send is the fill plus a 16px glyph in `--color-grey-400`,
   * against the outline buttons' 24px white one.
   */
  variant?: "outline" | "send";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={cn(
        // NO BORDER. Every one of these circles carries a white stroke PAINT in
        // the file with `strokeWeight: 0.0`, which renders nothing — the rim
        // you see in the mockup is Figma's GLASS effect, not a stroke. The
        // Figma MCP tool omits a zero weight entirely, so its output reads as
        // "solid white stroke" and that is exactly how a full-opacity
        // `border-white` ring got shipped here. Verified against the raw REST
        // payload for 21:5689 / 21:5692 / 21:5701 / 21:5683 (and their group
        // twins), which are byte-identical.
        //
        // The GLASS parameters (blur, refraction, dispersion) are NOT in the
        // REST payload — they are plugin-API only — so the wash below is a
        // judgement call approximating it. The ABSENCE of a border is not a
        // judgement call.
        "ws-press flex h-[38.37px] w-[38.37px] shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
        variant === "send"
          ? // Opaque #1C1C1C = --color-grey-800. Its #9B9B9B stroke is also
            // weight 0, so it has no ring either — only the 16px grey glyph
            // distinguishes it.
            "bg-grey-800"
          : // The GLASS material, not a border and not a flat wash — see
            // `ws-glass-pill` in globals.css for what the file actually says
            // and why a 4% wash was as wrong as a white ring.
            "ws-glass-pill",
        // Neither hover nor disabled exists as a state in the design — these
        // are the house treatments, the same wash the post card's "more" disc
        // and the column header's back arrow use.
        disabled ? "cursor-not-allowed" : "hover:bg-white/10",
        className
      )}
    >
      {/* The design pads these by 8.077px, which is exact for its 16px glyphs
          and overflows its own 38.37px box for the 24px ones. The glyph's own
          size is the reliable half of that pair, so it is set here and the
          circle simply centres it. */}
      <span className="flex items-center justify-center" style={{ width: size, height: size }}>
        {icon}
      </span>
    </button>
  );
}

/**
 * The 12px double-check under an outgoing message.
 *
 * Only under an outgoing one. The design draws this glyph on all four bubbles,
 * incoming included, which is a duplicated component rather than an
 * instruction — a read receipt on a message the peer sent us says nothing.
 * `receiptState` is the gate and it is pinned in a test.
 *
 * The mark has two paints, because the service now sends `readBy` and
 * `readByAll` and a tick that never changes is a tick that carries no
 * information. Unread stays the design's grey; read (and, in a house,
 * partially read) takes `--color-spotlight`, the ramp's dark stop, which is
 * 5.66:1 on the white bubble. No third purple, and no new glyph: the
 * WhatsApp-style colour change on the same mark is the convention readers
 * already have.
 */
function ReceiptMark({ state, readBy }: { state: ReceiptState; readBy: number }) {
  if (state === "none") return null;
  const label = receiptLabel(state, readBy);
  const seen = state === "read" || state === "partial";

  return (
    <span title={label} className="flex shrink-0 items-center">
      {/*
        The design's own 12px export, painted through a MASK rather than
        rendered as an image.

        The file ships the glyph as a flat `#8A8A8A` path — exactly the
        design's unread grey — so an `<img>` would be right for one of the two
        states and untintable for the other. `filter: hue-rotate(...)` from a
        desaturated grey to a saturated purple is a guess that lands
        somewhere near the colour and drifts the moment the token moves. A
        mask takes the glyph's ALPHA and lets a normal background-colour
        utility paint it, so both states come from real tokens and the asset
        stays a single file.
      */}
      <span
        aria-hidden
        style={{
          maskImage: "url(/messages/checks.svg)",
          WebkitMaskImage: "url(/messages/checks.svg)",
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskPosition: "center",
        }}
        className={cn("h-3 w-3 shrink-0", seen ? "bg-spotlight" : "bg-[#8A8A8A]")}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   HEADER
   ──────────────────────────────────────────────────────────────────────────── */

function ThreadHeader({
  conversation,
  onBack,
  onCreateGistRoom,
  menu,
}: {
  conversation: Conversation;
  onBack: () => void;
  onCreateGistRoom?: () => void;
  /** The overflow menu's panel — nodes 77:8287 / 78:8337 / 78:8525. */
  menu: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const group = isGroupThread(conversation);
  const peer = conversation.peer;
  const title = threadTitle(conversation);
  const subtitle = threadSubtitleParts(conversation).join("  •  ");

  return (
    // Pinned, not sticky: this band is a fixed row of the pane's flex column
    // and never enters the scroller, so it cannot drift or jitter the way a
    // sticky element does. The design gives it a fill of `rgba(255,255,255,
    // 0.002)`, which is nothing — it sits over the app ground, so it takes
    /* NO FILL. Node 75:8117 is `white/0.2%`, which is nothing — the bar sits on
       the pane's own ground and is separated by its hairline alone. It used to
       be `bg-ground` (#000), which made the whole thread pane read as a
       different, darker black from the inbox column beside it. The hairline is
       the design's 10%, not `ws-head`'s 8%. */
    <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
      {/* Not in the design, which only ever draws the desktop two-pane state.
          Below lg the list gives way to the thread entirely, so without this
          there is no route back to the inbox. Hidden where both panes are up. */}
      <button
        onClick={onBack}
        aria-label="Back to inbox"
        className="ws-press -ml-2 shrink-0 rounded-full p-2 text-heading transition-colors hover:bg-white/10 lg:hidden"
      >
        <IconArrowLeft className="h-5 w-5" />
      </button>

      {/* 12 from the avatar to the text, 4 between the two lines. */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10">
          {group ? (
            /*
              THE GROUP'S OWN PICTURE, when it has one.

              `imageUrl` is on `ConversationSummary` now — it was not when this
              was written, and the note here said so and drew the house glyph
              instead. The inbox row beside it has been drawing the picture ever
              since the field landed, so the header was the only place in the
              app still showing a group as a generic mark.

              The glyph remains the FALLBACK, and the rule it was written for
              still holds: a group with no picture must not borrow one.
              `members` is a roster capped at four, so the obvious shortcut —
              draw the first member's face — puts one person on a room of
              seventy-five and says something false about whose thread this is.
              The house glyph is the same mark the inbox files these under
              ("Houses"), so it reads as a room rather than a broken image.
            */
            conversation.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- the media host is a runtime value, unknown at build time
              <img
                src={conversation.imageUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <IconHouses className="h-5 w-5 text-white/70" />
            )
          ) : (
            peer?.username ? (
              <Link
                href={profileHref(peer)}
                aria-label={`View ${peer.displayName}'s profile`}
                className="block h-full w-full"
              >
                <Avatar name={peer.displayName} seed={peer.id} src={peer.avatarUrl} size={38} />
              </Link>
            ) : (
              <Avatar name={peer?.displayName ?? "?"} seed={peer?.id} src={peer?.avatarUrl} size={38} />
            )
          )}
        </span>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* QA: the person's or group's name is the page's heading, so it is set
                like one — 16px, up from the file's 12. */}
            <h1 className="truncate text-[16px] font-bold leading-6 text-white">
              {/*
                A NAME HERE OPENS THE THING IT NAMES — a person's opens their
                profile, and a house's opens the house.

                Only the first was true. Once you joined a house it lived in
                your inbox and there was no route back to its page at all: not
                the members, the description or the replays you looked at
                before deciding to join (ogazboiz, 2026-09-23: "when i have
                join the house how can i see the profile"). The page existed
                and became unreachable the moment you used it.
              */}
              {group ? (
                <Link href={sq(`/houses/${conversation.id}`)} className="hover:underline">
                  {title}
                </Link>
              ) : peer?.username ? (
                <Link href={profileHref(peer)} className="hover:underline">
                  {title}
                </Link>
              ) : (
                title
              )}
            </h1>
            {/* The streak, AFTER THE NAME — Snapchat's placement, so a live
                streak sits beside the name on opening the chat, not only in the
                notice at the foot of the river. Flame + day count, the same
                exported glyph the inbox row and the notice carry. 1:1 only: a
                group has no snap streak. */}
            {!group && conversation.snapStreak > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5"
                title={
                  conversation.snapStreak === 1
                    ? "You started a streak"
                    : `You're on a ${conversation.snapStreak}-day streak`
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the file's own export */}
                <img
                  src={asset("/messages/streak-flame.svg")}
                  alt=""
                  aria-hidden
                  className="h-4 w-[9.617px] shrink-0"
                />
                <span className="tnum text-[13px] font-bold leading-none text-[#ff9d01]">
                  {conversation.snapStreak}
                </span>
              </span>
            )}
          </div>

          {/* The design puts "Typing…" on this line in the earlier frame. There
              is no typing channel on the messages service, so that half is not
              invented. What IS on the contract is presence — `lastSeenAt` on a
              profile, `lastActiveAt` on a group — and this line renders it
              beside the handle (1:1) or the member count (group). Every part
              is dropped independently when the field is absent, so a payload
              with no presence shows "@fatima.b" alone and never "Active
              recently". */}
          {subtitle && (
            <p className="truncate text-[12.12px] font-normal leading-[16.15px] text-white/50">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {group && <CreateGistRoomButton onClick={onCreateGistRoom} />}

        {/*
          THE OVERFLOW CONTROL — the three vertical dots.

          It used to open the member sheet on a group and be DISABLED on a 1:1,
          on the reading that the conversation contract had no thread-level
          action. That was wrong: the service has add-members, rename, leave,
          block and report, and the file draws a real menu on all three thread
          shapes (77:8287, 78:8337, 78:8525). It now opens that menu, and the
          rows the service genuinely cannot back are disabled inside it with
          their reason — which is where an unavailable capability belongs, next
          to its name, rather than swallowing the whole control.

          The backdrop is a full-screen button rather than a document listener:
          it closes on the same click that would otherwise fall through to
          whatever is underneath, and it is reachable by keyboard.
        */}
        <div className="relative">
          <CircleButton
            label="Conversation options"
            size={24}
            onClick={() => setMenuOpen((open) => !open)}
            icon={<Image src={asset("/messages/more.svg")} alt="" width={24} height={24} />}
          />
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div
                className="absolute right-0 top-full z-50 mt-2"
                onClick={() => setMenuOpen(false)}
              >
                {menu}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * `Create Gist Room` — 168x38, the violet ramp, a mic and a label.
 *
 * INERT, and this is the clearest case of it in the pane. A gist room is a
 * live audio room; the conversation contract that gained groups
 * (`POST /conversations/groups`, `PATCH /conversations/:id`, the member
 * routes, accept/decline) has nothing that opens a room from a thread, and
 * the houses slice — which owns rooms — cannot be imported here because slices
 * never import each other. There is no request this button could make, so it
 * makes none.
 *
 * The gradient is `ws-btn-create` rather than the node's own
 * `90deg #9F65FD → #5B05E6`: same two stops of the same purple ramp, and the
 * utility already paints every twin of this CTA in the app. Shipping a second
 * angle for the same object is how one control ends up with two paints.
 */
/**
 * "Create Gist Room" — node 76:8239, on a GROUP header only.
 *
 * 168x38 at a pill radius, the `ws-btn-create` gradient (the file's own
 * `#9F65FD -> #5B05E6` at 90 degrees, which is that utility exactly), a 16px
 * mic and Geist Medium 15/21.75. All verbatim from the file.
 *
 * It was hard-disabled because nothing could open a room from a thread. That
 * is no longer true: the gist-room composer (59:7544) exists, so the button
 * takes a handler and is live wherever one is supplied. It still refuses when
 * there is none, rather than rendering a control that does nothing — the same
 * rule, applied to whichever surface has not wired it yet.
 *
 * The handler is passed IN rather than imported: the composer lives in
 * `features/houses` and slices never import each other, so the layout screen
 * joins the two. Same route-slot pattern the inbox's `+` uses for the people
 * picker.
 */
function CreateGistRoomButton({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      title={
        onClick
          ? undefined
          : "Gist rooms aren't wired up on this surface yet."
      }
      className={cn(
        // Hidden on a phone — the action lives in the overflow menu there (see
        // ThreadMenu) so the tight top bar is not carrying a 168px pill. From
        // `md` the pill is back and the menu row hides, so it is never both.
        "ws-btn-create hidden h-[38px] w-[168px] shrink-0 items-center justify-center gap-1 rounded-full text-[15px] font-medium leading-[21.75px] text-white md:flex",
        onClick ? "ws-press transition-opacity hover:opacity-90" : "cursor-not-allowed opacity-40"
      )}
    >
      <IconMic className="h-4 w-4" />
      Create Gist Room
    </button>
  );
}

/**
 * Who is in the house.
 *
 * The one thing the group header's overflow can honestly do today, and the
 * same query the bubbles resolve their avatars through — one request, one
 * cache, one answer, so the sheet and the river can never disagree about the
 * membership inside a single render.
 *
 * `PersonRow` is deliberately NOT reused: it links to `/u/[username]`, which
 * would navigate the reader out of the two-pane route and lose the open
 * thread. The identity composition is the same (avatar, name, handle); the
 * navigation is precisely what must not be — the same call the host cockpit's
 * request queue makes.
 */
function MembersSheet({
  conversation,
  open,
  onClose,
  meId,
  myRole,
}: {
  conversation: Conversation;
  open: boolean;
  onClose: () => void;
  meId: string | undefined;
  /** The reader's own role — decides which controls each row offers. */
  myRole: GroupRole | null;
}) {
  const members = useConversationMembers(conversation.id, open && isGroupThread(conversation));
  const setRole = useSetMemberRole(conversation.id);
  const transfer = useTransferOwnership(conversation.id);
  const remove = useRemoveGroupMember(conversation.id);
  const setMuted = useSetMemberMuted(conversation.id);
  /* The same route as remove, a different act — see the hook. */
  const withdraw = useWithdrawInvite(conversation.id);
  /* Removing someone and handing the house over both ask first: neither can
     be undone from this sheet. */
  const [confirming, setConfirming] = useState<{ kind: "remove" | "owner"; profile: Profile } | null>(null);

  // The summary's four-deep preview roster stands in until the full list
  // lands, so the sheet opens with content rather than with skeletons.
  const rows =
    members.data?.items ??
    conversation.members.map((profile) => ({
      profile,
      role: "member" as const,
      joinedAt: null,
      /*
        The PREVIEW roster carries neither, and both are false deliberately.
        These four names come off the conversation summary, which says nothing
        about muting or about what this viewer may do — the same reason the
        existing controls are gated on `members.data` rather than on these rows.
        Guessing either one here would offer a control against a stand-in.
      */
      muted: false,
      canManage: false,
    }));
  const house = conversation.title ?? "this house";
  const ACTION =
    "ws-press rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-body transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <Sheet open={open} onClose={onClose} title={threadTitle(conversation)}>
      {confirming ? (
        <div className="p-4">
          <p className="text-[13px] leading-5 text-body">
            {confirming.kind === "owner"
              ? `${confirming.profile.displayName} becomes the owner of ${house}. You stay on as an admin, and only they can make or remove admins after this.`
              : `${confirming.profile.displayName} will be removed from ${house}. A member can add them back.`}
          </p>
          <div className="mt-5 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              loading={transfer.isPending || remove.isPending}
              onClick={() => {
                const done = { onSuccess: () => setConfirming(null) };
                if (confirming.kind === "owner") transfer.mutate(confirming.profile.id, done);
                else remove.mutate(confirming.profile.id, done);
              }}
            >
              {confirming.kind === "owner" ? "Make owner" : "Remove"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4">
          {members.isError ? (
            <ErrorState
              error={members.error}
              fallback="Couldn't load the member list."
              onRetry={() => members.refetch()}
            />
          ) : rows.length === 0 && members.isPending ? (
            [0, 1, 2].map((i) => <RowSkeleton key={i} />)
          ) : (
            rows.map((member, index) => {
              const profile = member.profile;
              // Controls come only from the full roster: the preview rows all
              // read "member" and would offer actions on the wrong people.
              const actions =
                profile && members.data
                  ? memberActions({ viewer: myRole, target: member.role, isSelf: profile.id === meId })
                  : null;
              return (
                <div key={profile?.id ?? `member-${index}`} className="flex items-start gap-3">
                  <Avatar name={profile?.displayName ?? "?"} seed={profile?.id} src={profile?.avatarUrl} size={38} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    {/*
                      NAME, THEN WHO THEY ARE, THEN WHAT THEY ARE HERE.

                      The check belongs to the PERSON and travels with them
                      everywhere, so it sits tight against the name. The role
                      chip belongs to this GROUP — the same person is an
                      ordinary member elsewhere — so it follows the identity
                      rather than joining it. That order is what stops a chip
                      reading as part of somebody's name.

                      The role used to be an uppercase word pinned to the row's
                      RIGHT EDGE. On a long name it ended up a column away from
                      the person it described, which reads as a table heading
                      rather than a badge (ogazboiz: "it will show next to the
                      person like a badge").

                      The NAME truncates and the badges do not: an ellipsis on
                      a name still names somebody, while half a check or a
                      clipped "Admin" says something false.
                    */}
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-white">
                        {profile?.displayName ?? "Former member"}
                      </span>
                      {profile && (
                        <VerifiedBadge
                          verification={profile.verification}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                      )}
                      <MemberRoleChip role={member.role} />
                    </span>
                    {atHandle(profile?.username) && (
                      <span className="truncate text-[12px] text-meta">{atHandle(profile?.username)}</span>
                    )}
                    {profile && actions && (actions.makeAdmin || actions.removeAdmin || actions.makeOwner || actions.remove) && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {actions.makeAdmin && (
                          <button type="button" disabled={setRole.isPending} onClick={() => setRole.mutate({ profileId: profile.id, role: "admin" })} className={ACTION}>
                            Make admin
                          </button>
                        )}
                        {actions.removeAdmin && (
                          <button type="button" disabled={setRole.isPending} onClick={() => setRole.mutate({ profileId: profile.id, role: "member" })} className={ACTION}>
                            Remove admin
                          </button>
                        )}
                        {actions.makeOwner && (
                          <button type="button" onClick={() => setConfirming({ kind: "owner", profile })} className={ACTION}>
                            Make owner
                          </button>
                        )}
                        {actions.remove && (
                          <button type="button" onClick={() => setConfirming({ kind: "remove", profile })} className={cn(ACTION, "text-down")}>
                            Remove
                          </button>
                        )}
                        {/*
                          MUTE — gated on the SERVICE's own answer, never on a
                          comparison of two roles.

                          `canManage` is the server saying whether this viewer
                          may act on this person. The ladder behind it (an admin
                          acts on members, the owner acts on admins, nobody acts
                          on the owner or on themselves) lives on the service,
                          and a client that recomputes it is a second copy of an
                          authorisation rule waiting to disagree with the first.

                          It defaults FALSE, so against a service that does not
                          send it the control is simply absent — which is the
                          right way to be wrong.

                          Muting takes away WRITING only. The copy says so,
                          because "mute" in most products means "I stop hearing
                          them" and here it means "they stop speaking".
                        */}
                        {member.canManage && (
                          <button
                            type="button"
                            disabled={setMuted.isPending}
                            onClick={() =>
                              setMuted.mutate({
                                profileId: profile.id,
                                muted: !member.muted,
                                name: profile.displayName,
                              })
                            }
                            title={
                              member.muted
                                ? `${profile.displayName} can send messages again.`
                                : `${profile.displayName} keeps reading ${house} but can't send messages.`
                            }
                            className={ACTION}
                          >
                            {member.muted ? "Unmute" : "Mute"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/*
            INVITATIONS STILL WAITING, under the people who are actually here.

            Without this a leader adds somebody who does not follow them, the
            roster does not change, and nothing on screen says an invitation
            exists. The predictable next move is to add them again — which is
            the loop the consent gate exists to prevent — and to conclude the
            product is broken rather than that somebody was asked.

            BELOW the members and visibly dimmer, because they are not in the
            group: a waiting seat drawn like a membership is the same lie in the
            other direction. They are absent from `memberCount` for the same
            reason, which the service already guarantees.
          */}
          {members.data && members.data.invited.length > 0 && (
            <>
              <p className="mt-2 text-[12px] font-semibold text-meta">
                Invited · waiting to accept
              </p>
              {members.data.invited.map((invite, index) => {
                const profile = invite.profile;
                return (
                  <div
                    key={profile?.id ?? `invite-${index}`}
                    className="flex items-start gap-3 opacity-60"
                  >
                    <Avatar
                      name={profile?.displayName ?? "?"}
                      seed={profile?.id}
                      src={profile?.avatarUrl}
                      size={38}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[14px] font-semibold text-white">
                        {profile?.displayName ?? "Someone"}
                      </span>
                      {/*
                        WHO ASKED THEM, because any member may invite and the
                        question a leader has about an outstanding invitation is
                        usually who sent it rather than when.
                      */}
                      <span className="truncate text-[12px] text-meta">
                        {invite.invitedBy
                          ? `Invited by ${invite.invitedBy.displayName}`
                          : "Invited"}
                      </span>
                      {/*
                        `canManage` here is the SERVICE's answer and is wider
                        than the member ladder: a leader may withdraw, and so
                        may whoever sent it, whatever their rank. Undoing your
                        own act is not authority over anybody.
                      */}
                      {profile && invite.canManage && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={withdraw.isPending}
                            onClick={() => withdraw.mutate(profile.id)}
                            title={`${profile.displayName} stops being asked. The house is unchanged.`}
                            className={ACTION}
                          >
                            Withdraw
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * A LEADER TAKING SOMEBODY ELSE'S MESSAGE DOWN.
 *
 * Its own control rather than a branch of `OwnMessageActions`, because the two
 * are different acts: that one withdraws your own words, this removes another
 * person's in front of everybody. The confirmation says so — it names the
 * consequence that matters here, which is that the room will be told a
 * moderator did it, not merely that the words go.
 *
 * The service refuses this on your own message (it says to unsend instead,
 * because the two write different rows) and in a DM, where nobody is a leader.
 * Neither refusal should ever be reachable: the caller only draws this where
 * the roster says `canManage`.
 */
function ModerateMessageAction({
  revealed,
  onModerate,
}: {
  revealed: boolean;
  onModerate: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Moderate message"
        title="Remove as moderator"
        className={cn(
          "ws-press absolute -top-2 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/70 transition-opacity hover:text-white",
          revealed ? "opacity-100" : "opacity-0"
        )}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
          <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 8.3h6.8l.6-8.3" />
        </svg>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Remove this message">
        <div className="p-4">
          <p className="text-[13px] leading-5 text-body">
            This takes the message down for everyone. It will show as removed by a
            moderator, so the room can see that a leader did it rather than the
            person who wrote it.
          </p>
          <div className="mt-5 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                setOpen(false);
                onModerate();
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   BUBBLES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The meta that hangs off the last line of every bubble: a time, and on an
 * outgoing message the receipt.
 *
 * ─── THE INCOMING TIMESTAMP IS NOT THE DESIGN'S GREY, DELIBERATELY ───────────
 * The design puts #8A8A8A on both bubbles. On the white one that is 4.6:1 and
 * fine. On #7E3BEB it is **1.64:1** — invisible. An earlier pass "fixed" this
 * by moving the incoming stamp to #999999, which is 1.99:1 and no more
 * readable; the arithmetic was never done. White at 85% composites to 4.52:1
 * on the same purple, which clears AA with nothing to spare, so that is what
 * ships. This is the one place in the pane where a measured colour is not
 * reproduced, and it is a legibility decision rather than a taste one.
 */
function BubbleMeta({
  message,
  mine,
  group,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
}) {
  const state = receiptState({
    mine,
    group,
    status: message.status,
    readBy: message.readBy,
    readByAll: message.readByAll,
  });

  return (
    <span className="flex shrink-0 items-center gap-1">
      {/* EDITED IS ALWAYS SHOWN. An edit nobody can see is a way to change
          what you said after somebody answered it; saying so is what keeps it
          a correction rather than a rewrite. */}
      {message.editedAt && (
        <span
          className={cn(
            "text-[11px] font-medium leading-4",
            mine ? "text-[#8A8A8A]" : "text-white/70"
          )}
          title={"Edited " + formatClockTime(message.editedAt)}
        >
          edited
        </span>
      )}
      <span
        className={cn(
          "tnum text-[12px] font-medium leading-4 tracking-[-0.005em]",
          mine ? "text-[#8A8A8A]" : "text-white/85"
        )}
      >
        {formatClockTime(message.createdAt)}
      </span>
      <ReceiptMark state={state} readBy={message.readBy} />
    </span>
  );
}

/** Shared paint and geometry for all three bubbles: 16px radius, and the
    design's colour assignment by POSITION — own messages are the white bubble
    on the right, the peer's the purple one on the left. The evidence for that
    is geometric rather than chromatic: every #FFFFFF bubble ends at the pane's
    right edge and every #7E3BEB one starts at its left. */
function bubbleShell(mine: boolean, tail: boolean) {
  return cn(
    "rounded-2xl",
    mine ? "bg-white" : "bg-spotlight",
    // The group node's incoming bubbles carry a tail: 16/16/16/2, a squared
    // bottom-left corner pointing at the sender avatar beside it. A 1:1 has no
    // avatar in the river, so it has no tail either.
    tail && "rounded-bl-[2px]"
  );
}

/**
 * The ink for a tappable part of a message body — an @handle, a #tag, a link.
 *
 * `PostText` is the ONE renderer for post-shaped text, so a handle in a chat
 * bubble is the same link to `/u/{handle}` a post draws. Its default ink is
 * the post purple (`--color-spotlight-chip-ink`), which is 2.7:1 on the white
 * bubble and 2.1:1 on the #7E3BEB one — both fail. So each bubble passes the
 * ink that clears AA on its own fill: the ramp's dark stop on white (5.66:1),
 * white on purple (5.66:1), the same two pairings the bubbles already use.
 */
function bubbleLinkClass(mine: boolean): string {
  return mine
    ? "font-semibold text-spotlight hover:underline"
    : "font-semibold text-white underline decoration-white/50 underline-offset-2 hover:decoration-white";
}

/** The body of a text bubble, or its caption: mentions as links, on-brand ink. */
function BubbleText({
  message,
  mine,
  className,
}: {
  message: Message;
  mine: boolean;
  className?: string;
}) {
  if (!message.text) return null;
  return (
    <PostText
      text={message.text}
      mentions={message.mentions}
      linkClassName={bubbleLinkClass(mine)}
      className={cn(
        // `overflow-wrap: anywhere`, not just break-words: a pasted URL is one
        // unbreakable word, and break-words does not count toward intrinsic
        // sizing — so the word pushed the bubble past its cap and ran over the
        // stamp beside it. `anywhere` both breaks it and lets the box shrink.
        "min-w-0 wrap-anywhere text-[14px] font-normal leading-5 tracking-[-0.006em]",
        mine ? "text-[#5A5A5A]" : "text-white",
        className
      )}
    />
  );
}

/**
 * The quoted original INSIDE a reply's bubble: who said it and one line of
 * what, on a 2px rule in the bubble's own contrasting ink. Tapping it scrolls
 * to the original when that message is loaded — and does nothing visible
 * when it is not, which is honest: there is nowhere to go.
 *
 * "Message deleted" comes from the service's `deleted`, which is always false
 * today (conversation messages cannot be deleted yet); the wording is kept so
 * the shape is future-proof, not because anything flips it.
 */
function ReplyQuote({
  replyTo,
  mine,
  name,
  onJump,
}: {
  replyTo: MessageReplyTo;
  mine: boolean;
  /** The original's sender, resolved by the pane — "You" for the reader. */
  name: string;
  onJump: (messageId: string) => void;
}) {
  const line = replyExcerpt({ text: replyTo.text, media: replyTo.media, deleted: replyTo.deleted });
  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      aria-label={`Go to the message from ${name} this replies to`}
      className={cn(
        "ws-press flex w-full min-w-0 flex-col items-start rounded-lg border-l-2 px-2.5 py-1.5 text-left transition-colors",
        mine
          ? "border-spotlight bg-black/[0.05] hover:bg-black/[0.08]"
          : "border-white bg-white/10 hover:bg-white/15"
      )}
    >
      <span className={cn("truncate text-[12px] font-semibold leading-4", mine ? "text-spotlight" : "text-white")}>
        {name}
      </span>
      {line && (
        <span
          className={cn(
            // `anywhere` beside the clamp: a pasted URL is one unbreakable
            // word, and without it the excerpt's min-content width pushed the
            // quote past the bubble's edge before the clamp could clip it.
            "line-clamp-1 wrap-anywhere text-[12px] leading-4",
            mine ? "text-[#5A5A5A]" : "text-white/85",
            replyTo.deleted && "italic"
          )}
        >
          {line}
        </span>
      )}
    </button>
  );
}

/**
 * The per-bubble "Reply" — a 28px glass disc beside the bubble, on the side
 * away from the pane's edge so it never overlaps the tail or the avatar.
 *
 * On a pointer device it is invisible until the row is hovered (or the
 * control is tabbed to); on a touch device there is no hover, so it is not
 * drawn at all until a long-press on the row reveals it — `revealed` — and a
 * slot is only reserved then. A tap on it sets the composer's reply target.
 */
function ReplyButton({
  onClick,
  revealed,
  mine,
}: {
  onClick: () => void;
  revealed: boolean;
  mine: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Reply to this message"
      title="Reply"
      className={cn(
        "ws-glass-pill ws-press flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-white/80 transition-opacity hover:bg-white/10 hover:text-white",
        // The row's hover shows it; keyboard focus shows it; a long-press on a
        // phone shows it. Otherwise it is transparent on pointer devices and
        // absent on touch ones.
        revealed
          ? "opacity-100"
          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:hidden",
        mine ? "order-first" : "order-last"
      )}
    >
      <IconQuote className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * THE READER'S OWN MESSAGE, AND THE TWO THINGS THEY MAY DO TO IT.
 *
 * Same reveal rules as Reply — invisible until hover, focus, or a long-press
 * on a phone — because a row of controls on every bubble turns a conversation
 * into a toolbar. Only ever drawn on their OWN messages: editing or removing
 * somebody else's is moderation, which reads differently to everybody in the
 * thread and is not this.
 */
function OwnMessageActions({
  onEdit,
  onRemove,
  revealed,
  canEdit,
}: {
  onEdit: () => void;
  onRemove: () => void;
  revealed: boolean;
  /** False for a message with no words — there is nothing to edit. */
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          setOpen(true);
        }}
        aria-label="Message actions"
        title="More"
        className={cn(
          "ws-glass-pill ws-press order-first flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-white/80 transition-opacity hover:bg-white/10 hover:text-white",
          revealed
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:hidden"
        )}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <circle cx="3.5" cy="8" r="1.4" />
          <circle cx="8" cy="8" r="1.4" />
          <circle cx="12.5" cy="8" r="1.4" />
        </svg>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Your message">
        {canEdit && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="ws-row flex w-full items-center px-1 py-3 text-left text-[13px] font-semibold text-body"
          >
            Edit message
          </button>
        )}
        {/*
          REMOVING ASKS FIRST, and says what it means rather than "are you
          sure": the message goes for EVERYONE, not just this screen, and that
          is the part somebody needs to know before they tap.
        */}
        {confirming ? (
          <div className="px-1 py-3">
            <p className="text-[13px] leading-[19px] text-body">
              Remove this message for everyone in this chat? The words and any photo go with it.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                  onRemove();
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ws-row flex w-full items-center px-1 py-3 text-left text-[13px] font-semibold text-danger"
          >
            Remove message
          </button>
        )}
      </Sheet>
    </>
  );
}

function TextBubble({
  message,
  mine,
  group,
  tail,
  quote,
  moderatorName,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
  tail: boolean;
  /** The quoted original, when this message is a reply. */
  quote?: React.ReactNode;
  /**
   * WHICH leader took this message down, when one did and we can name them.
   *
   * Null is the honest answer rather than a gap: a moderator who has left the
   * house is not in the roster the names come from, and the row still has to
   * say that a leader did it. "A moderator" is the floor, not the goal.
   */
  moderatorName?: string | null;
}) {
  const removed = message.status === "removed";

  return (
    <div
      className={cn(
        // The design's bubbles hug their content and never wrap, so the cap is
        // ours. 480 is where its longest line lands; the percentage keeps a
        // narrow phone pane from running edge to edge.
        //
        // The body and the meta are SIBLINGS in one bottom-aligned row 10px
        // apart, so the stamp hangs off the last line rather than sitting under
        // the message. A quote, when there is one, sits above that row.
        "flex max-w-[min(85%,480px)] flex-col gap-1.5 p-3",
        bubbleShell(mine, tail)
      )}
    >
      {quote}
      <div className="flex items-end gap-2.5">
        {removed ? (
          <p
            className={cn(
              "min-w-0 whitespace-pre-wrap break-words text-[14px] font-normal italic leading-5 tracking-[-0.006em] opacity-60",
              mine ? "text-[#5A5A5A]" : "text-white"
            )}
          >
            {/*
              WHO TOOK IT DOWN. `status` is `removed` for both kinds and
              `moderatedBy` is the only thing that tells them apart: null is the
              author withdrawing their own words, an id is a leader removing
              somebody else's.

              A moderator's removal is said out loud on purpose. A message that
              simply vanishes leaves a house arguing about whether it was ever
              there, and leaves the person who wrote it unable to tell whether
              anybody saw it.
            */}
            {!message.moderatedBy
              ? "Message removed"
              : moderatorName
                ? `Removed by ${moderatorName}`
                : "Removed by a moderator"}
          </p>
        ) : (
          <BubbleText message={message} mine={mine} />
        )}
        <BubbleMeta message={message} mine={mine} group={group} />
      </div>
    </div>
  );
}

/**
 * A photo or a clip — the design's 262px bubble with 4px of white around the
 * media and an 8px footer strip under it.
 *
 * ─── TWO DEPARTURES, BOTH NAMED ──────────────────────────────────────────────
 * 1. `object-contain`, not the design's `object-fit: cover`. When the service
 *    sends `mediaWidth`/`mediaHeight` the bubble takes the media's own ratio
 *    and the two are IDENTICAL — nothing is cropped either way. It is only the
 *    unmeasured case that differs, and there `cover` would slice an arbitrary
 *    photo to fit a 4:3 guess. `MediaFrame` is the house answer to exactly
 *    that: contain the frame, fill the leftover with a blurred copy of it, and
 *    never admit a hard black bar.
 *
 * 2. NO PLAY BADGE ON A CLIP. The design draws a 40px purple circle with a
 *    play glyph over the video. Clips in this app render through
 *    `InlineVideo`, which is the one clip implementation and autoplays muted
 *    once it is 60% on screen (with native controls under
 *    `prefers-reduced-motion`) — so by the time a reader could press a badge,
 *    the clip is already playing and the badge would be a control that does
 *    nothing. Drawing it anyway to match the picture, or writing a second
 *    tap-to-play video player beside the shared one, are both worse than
 *    losing the circle.
 *
 * A CAPTION IS RENDERED. `text` is nullable now, so most media messages carry
 * none — but when one does, dropping it to match a node that has no captioned
 * state would silently delete what somebody wrote.
 */
/**
 * "X opened a gist room" — the announcement a room posts into its house group.
 *
 * A private room is reachable ONLY by members of that group, so without this
 * card the room is a door nobody knows about: the very people it was made for
 * would have to already know it exists. The card is what makes joining
 * possible, so it is a real link rather than decorated text.
 *
 * It renders on the deep LINK, not on the wording. The service could reword
 * the message tomorrow and this would still work; matching on a phrase would
 * quietly stop rendering the day somebody fixed a typo.
 */
function RoomInviteBubble({
  message,
  mine,
  group,
  tail,
  card,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
  tail: boolean;
  /**
   * The designed card — node 225:3873 — composed in `components/layout` because
   * it reads the room, the topic vocabulary and the group's roster, and slices
   * never import each other.
   *
   * Absent on a surface that has not wired it: the bubble then falls back to
   * the plain sentence plus its Join button, which is a working invite rather
   * than a hole.
   */
  card?: React.ReactNode;
}) {
  const ref = message.deepLink?.ref;
  if (card) {
    // The card IS the bubble here: it carries its own 22px glass shell, so
    // wrapping it in the message shell would draw two panels round one object.
    return (
      <div className="flex max-w-[min(85%,480px)] flex-col gap-1">
        {card}
        <span className={cn("flex justify-end", mine ? "pr-1" : "pl-1")}>
          <BubbleMeta message={message} mine={mine} group={group} />
        </span>
      </div>
    );
  }
  return (
    <div className={cn("flex max-w-[min(85%,480px)] flex-col gap-2 p-3", bubbleShell(mine, tail))}>
      <div className="flex items-start gap-2.5">
        <p
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px] leading-5 tracking-[-0.006em]",
            mine ? "text-[#5A5A5A]" : "text-white"
          )}
        >
          {message.text ?? "Opened a gist room"}
        </p>
        <BubbleMeta message={message} mine={mine} group={group} />
      </div>
      {ref && (
        <Link
          href={housePath(ref)}
          className="ws-press flex h-9 items-center justify-center gap-2 rounded-full bg-white px-4 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
        >
          <IconMic className="h-4 w-4" />
          Join gist room
        </Link>
      )}
    </div>
  );
}

/**
 * A DOCUMENT — a row, not a picture, and the WHOLE row opens it.
 *
 * A PDF has nothing to show until it is opened, so the bubble states what it
 * is and offers the one action that makes sense: get the file. Drawing it
 * through `MediaBubble` would put an `<img>` around bytes no browser decodes.
 *
 * ─── THE LINK IS THE DOCUMENT'S OWN URL ──────────────────────────────────────
 * It is NOT run through `mediaDownloadUrl`, and an earlier version was, which
 * is why documents shipped with no way to open them. That helper exists to make
 * Cloudinary answer a PICTURE or CLIP with `Content-Disposition: attachment`,
 * and it only accepts `https://res.cloudinary.com/…/(image|video)/upload/…`.
 * A document matches neither half of that:
 *
 *   - on Cloudinary the service stores it as a `raw` resource, which the
 *     helper's pattern does not include, so it answered null;
 *   - locally it lives on MinIO over http, which the helper refuses outright.
 *
 * Null drew no control, and the row itself was inert — a file you could see
 * and not reach. The rewrite was never needed for a document anyway: the SERVICE
 * already serves it as a download on both storages — `publicUrl` adds
 * `fl_attachment/` to every `raw` key on Cloudinary, and the S3 store sends
 * `Content-Disposition: attachment`. So the stored URL is linked as it is.
 *
 * `isHttpUrl` guards it, because it becomes an `href`: a URL that is not
 * http(s) renders the row as plain, never as a link somebody could make run
 * script. `target="_blank"` keeps the conversation on screen if a browser does
 * navigate rather than save.
 *
 * NAME AND SIZE COME FROM THE MESSAGE, never from a request, so the bubble is
 * complete on first paint, and a missing size renders nothing rather than
 * `0 KB`, which would be a claim about a file nobody measured.
 */
function FileBubble({
  message,
  mine,
  group,
  tail,
  quote,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
  tail: boolean;
  quote?: React.ReactNode;
}) {
  const url = message.mediaUrl as string;
  const name = message.mediaFileName?.trim() || "Attachment";
  const size = message.mediaSizeBytes;
  const href = isHttpUrl(url) ? url : null;
  const caption = message.text?.trim();

  /*
    EVERY INK HERE IS PAIRED TO THE SHELL IT SITS ON: `bubbleShell` paints MY
    bubble white and THEIRS `--color-spotlight`, so a hardcoded `text-white`
    once made a document you sent render as an empty white box. The pairings
    are `ReplyQuote`'s, the other inner surface that sits inside both shells.
  */
  const surface = cn(
    "flex items-center gap-2.5 rounded-xl p-2.5 transition-colors",
    mine ? "bg-black/[0.05]" : "bg-white/10"
  );
  const row = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase tracking-tight",
          mine ? "bg-black/[0.07] text-[#5A5A5A]" : "bg-white/15 text-white/80"
        )}
      >
        {fileExtensionLabel(message.mediaFileName, url)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] font-semibold leading-4",
            mine ? "text-black/85" : "text-white"
          )}
        >
          {name}
        </span>
        {typeof size === "number" && size > 0 && (
          <span
            className={cn(
              "mt-0.5 block text-[11px] leading-4",
              mine ? "text-black/45" : "text-white/55"
            )}
          >
            {formatBytes(size)}
          </span>
        )}
      </span>
      {href && (
        // Decorative: the ROW is the link, so the icon only says what tapping
        // does. A nested <a> here would be invalid markup.
        <span
          aria-hidden
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            mine ? "text-black/55" : "text-white/70"
          )}
        >
          <IconDownload className="h-4 w-4" />
        </span>
      )}
    </>
  );

  return (
    <div className={cn("w-[262px] max-w-[85%] p-1", bubbleShell(mine, tail))}>
      {quote && <div className="px-1 pb-1.5 pt-1">{quote}</div>}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          download={name}
          // The row sits inside a message that has its own press handling; a
          // tap on the file is a tap on the file, not on the message.
          onClick={(event) => event.stopPropagation()}
          aria-label={`Download ${name}`}
          title={`Download ${name}`}
          className={cn(surface, "ws-press", mine ? "hover:bg-black/[0.09]" : "hover:bg-white/15")}
        >
          {row}
        </a>
      ) : (
        <div className={surface}>{row}</div>
      )}

      {caption && <BubbleText message={message} mine={mine} className="px-2 pt-2" />}

      <div className="flex items-center justify-end p-2">
        <BubbleMeta message={message} mine={mine} group={group} />
      </div>
    </div>
  );
}

/**
 * ASKS FOR A FRESH LINK WHEN MEDIA WILL NOT LOAD.
 *
 * A DM attachment is served through a signed link, and a signed link can be
 * refused for more than one reason: it expired, or its signature no longer
 * verifies because the service's signing secret changed under it. THE READER
 * CANNOT TELL THOSE APART and neither can an <img> — both are simply a picture
 * that will not draw.
 *
 * This used to fire only past `urlExpiresAt`, which meant a link refused for a
 * BAD SIGNATURE sat there broken until the reader reloaded the page. That is
 * not hypothetical: on 2026-09-21 a restart invalidated links minted before it
 * and a thread full of media stayed broken on screen while the service would
 * happily have re-minted every one of them.
 *
 * So the trigger is now the FAILURE, not the deadline. One refetch per bubble,
 * held in a ref, so a photo that is genuinely gone costs exactly one request
 * rather than one per failed decode — and a thread of twenty broken images
 * asks once each rather than twenty times over.
 *
 * It cannot fix a secret that is wrong for everybody; nothing in a browser
 * can. It means a reader stops staring at a broken box the service could have
 * replaced.
 */
function useMediaRefreshOnError() {
  const client = useQueryClient();
  const asked = useRef(false);
  return useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    void client.refetchQueries({ queryKey: ["ms", "messages"] });
  }, [client]);
}

function MediaBubble({
  message,
  mine,
  group,
  tail,
  kind,
  quote,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
  tail: boolean;
  kind: "image" | "video";
  quote?: React.ReactNode;
}) {
  const url = message.mediaUrl as string;
  const ratio = mediaRatio(message.mediaWidth, message.mediaHeight);
  const caption = message.text?.trim();
  // Open full screen, the way a photo or clip opens in WhatsApp.
  const [viewing, setViewing] = useState(false);
  // A real save of the ORIGINAL file, or null when this is not a file the
  // service issued — see lib/media-download.ts. Null draws no control at all.
  const downloadUrl = downloadLinkFor(message, `square-${kind}-${message.id.slice(0, 8)}`);
  const refreshLink = useMediaRefreshOnError();
  const noun = kind === "video" ? "video" : "photo";

  return (
    <div className={cn("w-[262px] max-w-[85%] p-1", bubbleShell(mine, tail))}>
      {quote && <div className="px-1 pb-1.5 pt-1">{quote}</div>}
      {/* The ratio lives on the wrapper so the box is reserved BEFORE the
          media loads — a bubble that resizes on decode shoves the whole river
          under the reader's eye. 4:3 is the fallback shape for an unmeasured
          attachment, never a crop. */}
      <div className="relative w-full" style={{ aspectRatio: String(ratio ?? 4 / 3) }}>
        {kind === "video" ? (
          /*
            A DIV, not a button — the post card's recipe. The player owns a
            real sound control, and a button inside a button is invalid markup
            that would make "Tap for sound" open the clip instead. The frame
            opens it, the pill toggles sound, and the keyboard gets the explicit
            full-screen control.
          */
          <div
            onClick={() => setViewing(true)}
            className="absolute inset-0 cursor-pointer overflow-hidden rounded-xl"
          >
            <InlineVideo src={url} onError={refreshLink} className="absolute inset-0 rounded-xl" />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setViewing(true);
              }}
              aria-label="Play video full screen"
              className="ws-glass ws-press absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-body transition-colors hover:text-white"
            >
              <IconFullscreen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setViewing(true)}
            aria-label="View photo full screen"
            className="absolute inset-0 block cursor-zoom-in overflow-hidden rounded-xl"
          >
          <MediaFrame backdrop={url} className="absolute inset-0 rounded-xl">
            {/*
              A plain <img>, never `next/image`. The host of an attachment is
              unknown at build time, and this component also renders whatever
              the service typed — `next/image` handed a video URL is a crash
              that has shipped from this repo twice.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element -- attachment hosts are unknown at build time */}
            <img
              src={url}
              alt={caption || "Attachment"}
              loading="lazy"
              decoding="async"
              onError={refreshLink}
              className="absolute inset-0 h-full w-full object-contain"
            />
          </MediaFrame>
          </button>
        )}

        {/*
          SAVE IT, RIGHT ON THE BUBBLE — the way WhatsApp puts the arrow on the
          media itself (ogazboiz: "just download to see on the chat"), not only
          behind the full-screen view. Top-right, clear of the clip's sound pill
          (bottom-left) and its full-screen control (bottom-right).
        */}
        {downloadUrl && (
          <a
            href={downloadUrl}
            download
            onClick={(event) => event.stopPropagation()}
            aria-label={`Download ${noun}`}
            title={`Download ${noun}`}
            className="ws-glass ws-press absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full text-body transition-colors hover:text-white"
          >
            <IconDownload className="h-4 w-4" />
          </a>
        )}
      </div>

      {viewing && (
        <MediaViewer
          kind={kind}
          src={url}
          alt={caption || (kind === "video" ? "Video" : "Photo")}
          downloadUrl={downloadUrl}
          onClose={() => setViewing(false)}
        />
      )}

      {caption && <BubbleText message={message} mine={mine} className="px-2 pt-2" />}

      {/* The design's footer strip: 8px of padding, pushed right. */}
      <div className="flex items-center justify-end p-2">
        <BubbleMeta message={message} mine={mine} group={group} />
      </div>
    </div>
  );
}

/**
 * A voice note.
 *
 * The play control is REAL — it drives an `<audio>` element and the bars fill
 * to its actual `currentTime`. The bars themselves are not: the payload
 * carries a duration and nothing else, so their heights are a stable shape
 * hashed from the message id. See `lib/waveform.ts` for why that is the honest
 * choice rather than decoding every note in the thread to draw a picture
 * nobody acts on.
 *
 * The design draws the play disc in #7E3BEB on a white bubble. On an INCOMING
 * note the bubble is already #7E3BEB, so the disc inverts to white with a
 * purple glyph — the design only draws the outgoing case, and a purple disc on
 * a purple bubble is not a disc.
 */
/**
 * THE NOTE YOU JUST RECORDED, BEFORE IT GOES.
 *
 * Stopping a recording keeps it here in the composer, and this is what makes
 * keeping it worth anything: a real play control on the uploaded file, so the
 * person hears exactly what will be sent before they send it or remove it.
 * Stopped when the chip goes away, so a removed note never talks on over the
 * thread.
 */
function StagedVoicePreview({ url, durationSeconds }: { url: string; durationSeconds: number | null }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const node = audio.current;
    return () => node?.pause();
  }, []);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => setPlaying(false));
    else node.pause();
  };

  return (
    <>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        aria-pressed={playing}
        className="ws-btn-create ws-press flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
      >
        {playing ? <IconPause className="h-4 w-4" /> : <IconPlay className="h-4 w-4" />}
      </button>
      <span className="tnum shrink-0 text-[12px] text-white/60">
        {formatElapsed(playing || elapsed > 0 ? elapsed : (durationSeconds ?? 0))}
      </span>
    </>
  );
}

/**
 * THE VOICE NOTE, REVIEWED BEFORE IT IS SENT (node from ogazboiz, 2026-09-21).
 *
 * When a take is stopped it does not stage as a file row and it does not send —
 * it lands here: a player to hear it back (play/pause, a scrubbable waveform
 * with a progress dot, the clock), and three acts beneath it — discard,
 * re-record, send. "Play the voice note before sending it" is the whole point,
 * so the send is a deliberate tap AFTER the listen, never the same gesture.
 *
 * The bars are the take's OWN measured levels, not a hash: this is the very
 * recording, so it can show what it actually sounded like. The played portion
 * fills to `--color-create`; the rest is quiet. Tapping the bar seeks.
 */
function VoiceReview({
  url,
  durationSeconds,
  levels,
  sending,
  onDiscard,
  onReRecord,
  onSend,
}: {
  url: string;
  durationSeconds: number;
  levels: number[];
  sending: boolean;
  onDiscard: () => void;
  onReRecord: () => void;
  onSend: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const bars = levels.length > 0 ? levels : waveformBars(url);
  const progress = durationSeconds > 0 ? Math.min(1, elapsed / durationSeconds) : 0;

  useEffect(() => {
    const node = audio.current;
    return () => node?.pause();
  }, []);

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => setPlaying(false));
    else node.pause();
  };
  const seek = (event: React.MouseEvent<HTMLButtonElement>) => {
    const node = audio.current;
    if (!node || durationSeconds <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    node.currentTime = ratio * durationSeconds;
    setElapsed(node.currentTime);
  };

  return (
    <div className="mb-1">
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
      />
      {/* THE PLAYER — play/pause, the take's own waveform (played portion lit),
          then the clock, in a pill like the composer's own. */}
      <div className="flex items-center gap-3 rounded-full border border-[#26262B] bg-[#18181C] px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause voice note" : "Play voice note"}
          aria-pressed={playing}
          className="ws-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10"
        >
          {playing ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={seek}
          aria-label="Seek"
          className="flex h-8 min-w-0 flex-1 items-center gap-[3px] overflow-hidden"
        >
          {bars.map((level, index) => (
            <span
              key={index}
              className={cn(
                "w-[2.5px] shrink-0 rounded-full transition-colors",
                index / bars.length <= progress ? "bg-create" : "bg-white/30"
              )}
              style={{ height: `${Math.round(dotScale(level) * 100)}%` }}
            />
          ))}
        </button>
        <span className="tnum shrink-0 text-[13px] font-semibold text-white">
          {formatElapsed(playing || elapsed > 0 ? elapsed : durationSeconds)}
        </span>
      </div>

      {/* DISCARD · RE-RECORD · SEND — the three acts under the player. */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onDiscard}
          aria-label="Discard recording"
          title="Discard"
          className="ws-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconTrash className="h-5 w-5" />
        </button>
        {/* RE-RECORD — throw this take away and start again. Red, like the
            recorder's own live ring. */}
        <button
          type="button"
          onClick={onReRecord}
          aria-label="Record again"
          title="Record again"
          className="ws-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-danger text-danger transition-colors hover:bg-danger/10"
        >
          <IconMic className="h-6 w-6" />
        </button>
        {/* SEND — the violet ramp, Square's primary. */}
        <button
          type="button"
          onClick={onSend}
          disabled={sending}
          aria-label="Send voice note"
          className="ws-btn-create ws-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {sending ? <Spinner className="h-5 w-5 text-white" /> : <IconSend className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

function VoiceBubble({
  message,
  mine,
  group,
  tail,
  quote,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
  tail: boolean;
  quote?: React.ReactNode;
}) {
  // A voice note is served through the same signed link a photo is, and a
  // refused link is a play button that does nothing. Same one-shot refresh.
  const refreshLink = useMediaRefreshOnError();
  const url = message.mediaUrl as string;
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // The service's duration wins; the element's is the fallback for a payload
  // that did not measure the file.
  const [decoded, setDecoded] = useState<number | null>(null);
  const duration = message.mediaDurationSeconds ?? decoded;

  const bars = waveformBars(message.id);
  const lit = playedBars(bars.length, playProgress(elapsed, duration));

  const toggle = () => {
    const node = audio.current;
    if (!node) return;
    if (node.paused) void node.play().catch(() => setPlaying(false));
    else node.pause();
  };

  // A note that is still running when the reader opens another conversation
  // would go on talking over the next thread, so playback is stopped on
  // unmount rather than left to garbage collection.
  useEffect(() => {
    const node = audio.current;
    return () => node?.pause();
  }, []);

  return (
    <div className={cn("flex w-[262px] max-w-[85%] flex-col gap-2 p-3", bubbleShell(mine, tail))}>
      {quote}
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        onError={refreshLink}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value)) setDecoded(value);
        }}
      />

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause voice note" : "Play voice note"}
          aria-pressed={playing}
          className={cn(
            "ws-press flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-90",
            mine ? "bg-spotlight text-white" : "bg-white text-spotlight"
          )}
        >
          {playing ? (
            <IconPause className="h-4 w-4" />
          ) : (
            // Solid rather than the house outline: a 16px hollow triangle
            // inside a 32px disc reads as a ring, not as a play control.
            <IconPlay className="h-4 w-4 [&_path]:fill-current" />
          )}
        </button>

        {/* Full height of the row, 3px apart, as the design draws them. */}
        <div className="flex h-8 min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
          {bars.map((height, index) => (
            <span
              key={index}
              style={{ height: `${Math.round(height * 100)}%` }}
              className={cn(
                "w-[2px] shrink-0 rounded-full",
                index < lit
                  ? mine
                    ? "bg-spotlight"
                    : "bg-white"
                  : mine
                    ? "bg-[#D8D8D8]"
                    : "bg-white/40"
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {/* Empty for an unmeasured file — `00:00` under a note the reader can
            hear would be a lie about its length. */}
        <span
          className={cn(
            "tnum text-[12px] font-medium leading-4",
            mine ? "text-[#212121]" : "text-white"
          )}
        >
          {formatDuration(duration)}
        </span>
        <BubbleMeta message={message} mine={mine} group={group} />
      </div>
    </div>
  );
}

/**
 * A SNAP — the bubble for something that is seen once and then destroyed.
 *
 * There is no picture here and there never was one: a read does not carry a
 * url for a snap (see features/messages/lib/snap-view.ts), so the bubble draws
 * a state and a tap. The tap is the whole interaction, and it is deliberate —
 * nothing opens because it scrolled into view, because opening destroys the
 * file and a snap spent by a scroll is a snap the reader never saw.
 *
 * THE URL LIVES IN THIS COMPONENT AND NOWHERE ELSE. What the open route
 * returns is held in local state for as long as the viewer is on screen, and
 * is gone on close. It is never written to the query cache: a cache is read
 * back on a remount, and a picture that came back when the thread re-rendered
 * would not be view-once at all.
 */
function SnapBubble({
  message,
  mine,
  group,
  tail,
  view,
  onOpen,
  busy,
}: {
  message: Message;
  mine: boolean;
  group: boolean;
  tail: boolean;
  view: NonNullable<ReturnType<typeof snapView>>;
  /** Spends the snap and hands back the one url that will exist. */
  onOpen: (messageId: string) => Promise<{
    media: { url: string; kind: string | null } | null;
    mediaExpiresAt?: string | null;
  }>;
  busy: boolean;
}) {
  const [showing, setShowing] = useState<{
    url: string;
    kind: "image" | "video";
    expiresAt: string | null;
  } | null>(null);

  const open = async () => {
    if (!view.openable || busy) return;
    const result = await onOpen(message.id);
    const media = result.media;
    // A second open answers `{media: null}` rather than an error — the snap was
    // already spent, and the bubble simply settles on Opened.
    if (!media?.url) return;
    setShowing({
      url: media.url,
      kind: media.kind === "video" ? "video" : "image",
      expiresAt: result.mediaExpiresAt ?? null,
    });
  };

  /*
    CLOSES ITSELF WHEN THE FILE IS DELETED.

    `mediaExpiresAt` is the instant the service deletes the bytes, not a link
    expiry — there is nothing behind the url afterwards and no retry that could
    work. Leaving the viewer open past it would show a picture that has quietly
    stopped loading, which reads as a bug rather than as the promise being
    kept. With no deadline given the viewer stays until it is closed, which is
    better than closing on a clock we invented.
  */
  const expiresAt = showing?.expiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) return;
    const left = snapTimeLeft(expiresAt, Date.now());
    if (left === null) return;
    const timer = setTimeout(() => setShowing(null), left);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  // ── SENT SNAP — the Snapchat-style status card. ──
  // A dark card, a red send-arrow that is FILLED until they open it and hollow
  // once they have, and the state in words ("Delivered" → "Opened"). NO "Hold
  // to replay": a snap here is view-once and destroyed on opening, so there is
  // nothing to replay — and replay would be the receiver's act, never the
  // sender's. A dead control would be worse than its absence.
  if (mine) {
    return (
      <div className="max-w-[min(85%,480px)] rounded-2xl bg-[#1c1c1e] px-4 py-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
        <span className="flex items-center gap-3 text-white">
          <SnapArrow filled={view.state === "delivered"} />
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] leading-tight font-semibold">{view.label}</span>
            {view.sourceLabel && (
              <span className="mt-0.5 text-[12px] font-medium text-white/45">{view.sourceLabel}</span>
            )}
          </span>
        </span>
      </div>
    );
  }

  const body = (
    <span className="flex items-center gap-2">
      <ViewOnceMark opened={view.state === "spent" || view.state === "seen"} />
      <span className="text-[13px] leading-[19px]">{busy ? "Opening…" : view.label}</span>
      {/* WHICH DOOR IT CAME THROUGH. Drawn only where the payload says — a
          message from before the field carries no claim, and inventing one
          would be a claim about the sender. */}
      {view.sourceLabel && (
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-[14px]",
            mine ? "bg-black/10 text-ink/60" : "bg-white/15 text-white/70"
          )}
        >
          {view.sourceLabel}
        </span>
      )}
    </span>
  );

  return (
    <div className={cn("max-w-[min(85%,480px)] px-3 py-2.5", bubbleShell(mine, tail))}>
      {view.openable ? (
        <button
          type="button"
          onClick={() => void open()}
          disabled={busy}
          aria-label={`${view.label} from this chat`}
          className="ws-press flex w-full items-center text-left text-white disabled:opacity-60"
        >
          {body}
        </button>
      ) : (
        /* Not a control: there is nothing left to open, and a button that
           does nothing is worse than a line of text that says why. */
        <span className={cn("flex items-center", mine ? "text-ink" : "text-white")}>{body}</span>
      )}
      <BubbleMeta message={message} mine={mine} group={group} />
      {showing && (
        <MediaViewer
          kind={showing.kind}
          src={showing.url}
          alt="Snap"
          /* NO download. The file is destroyed minutes from now, and offering
             a Save would be offering a copy of the thing whose whole promise
             is that no copy is kept. */
          downloadUrl={null}
          onClose={() => setShowing(null)}
        />
      )}
    </div>
  );
}

/** A SENT snap's mark: a red send-arrow, filled until the other side opens it
    (Delivered), hollow once they have (Opened). Drawn here rather than borrowed. */
function SnapArrow({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="h-6 w-6 shrink-0 text-[#f23b4b]">
      <path
        d="M3.4 2.8 17.2 10 3.4 17.2 7.2 10 3.4 2.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * One row of the river: the bubble, and in a group the 24px sender avatar
 * beside an incoming one.
 *
 * The avatar is bottom-aligned against the bubble and carries NO name — the
 * group node draws the face alone, which is the compact form every group chat
 * uses once the same handful of people are talking.
 *
 * `sender` may be null. The summary's roster is capped at four and the full
 * one is a separate request, so a message from the fifth member renders the
 * seeded fallback avatar rather than nothing: `Avatar` derives a stable
 * mascot from the sender id, which is real identity (the same id always gets
 * the same face) rather than an invented name.
 */
function MessageRow({
  message,
  mine,
  group,
  sender,
  roomCardSlot,
  onReply,
  onJump,
  nameOf,
  flash,
  onOpenSnap,
  openingSnap,
  onEdit,
  onRemove,
  onModerate,
  canModerate,
  moderatorName,
  showSender,
  senderRole,
}: {
  message: Message;
  /**
   * WHICH leader removed this message, when one did and the roster can name
   * them. Resolved by the thread, which holds the roster; `nameOf` is no use
   * here because it answers "Member" for somebody it cannot find, and
   * "Removed by Member" is worse than not naming anybody.
   */
  moderatorName?: string | null;
  /** Take somebody else's message down as a leader — see ModerateMessageAction. */
  onModerate: (message: Message) => void;
  /**
   * May THIS viewer moderate THIS sender — the roster's `canManage` for them.
   * Never computed from two roles here; see the field's own note.
   */
  canModerate: boolean;
  mine: boolean;
  group: boolean;
  sender: Profile | null;
  /**
   * Draw the sender's name INSIDE this bubble — the first message of a run in
   * a group (ogazboiz, 2026-09-28: the name floating above the run sat "far
   * from the sent message"; WhatsApp puts it in the bubble's own top line).
   */
  showSender?: boolean;
  /** The sender's house role, for the chip beside the in-bubble name. */
  senderRole?: string | null;
  /** Spends a snap. Given by the thread, which owns the mutation. */
  onOpenSnap: (messageId: string) => Promise<{ media: { url: string; kind: string | null } | null }>;
  /** True while THIS message's open is in flight. */
  openingSnap: boolean;
  roomCardSlot?: (streamId: string) => React.ReactNode;
  /** Make this message the composer's reply target. */
  onReply: (message: Message) => void;
  /** Put this message's words back in the composer to be changed. */
  onEdit: (message: Message) => void;
  /** Remove it for everybody. */
  onRemove: (message: Message) => void;
  /** Scroll to a loaded message and flash it. */
  onJump: (messageId: string) => void;
  /** A sender id as a name — "You" for the reader. */
  nameOf: (senderId: string) => string;
  /** Briefly true after a quote tap landed here. */
  flash: boolean;
}) {
  const kind = messageMediaKind(message);
  const removed = message.status === "removed";
  const tail = group && !mine;

  /*
    LONG-PRESS reveals the reply control on a touch screen, where there is no
    hover. 450ms is between a tap and the OS's own context menu; a finger that
    moves is scrolling, not pressing, and cancels it. The control stays out
    for a few seconds, long enough to tap, then goes back — it is the same
    control hover shows on a desktop, not a second affordance.
  */
  const [revealed, setRevealed] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
    pressAt.current = null;
  };
  // A held finger drifts a few pixels; only real movement (a scroll) cancels.
  const movePress = (event: React.PointerEvent) => {
    const from = pressAt.current;
    if (!from) return;
    if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > 10) cancelPress();
  };
  /*
    SWIPE RIGHT TO REPLY — the gesture people already have in their hands.

    Replying on a phone was otherwise a two-step move nobody would guess:
    hold for 450ms, wait for a 28px disc, hit it. That disc is hidden on touch
    the rest of the time, so there was effectively no reply from a phone
    unless you already knew the trick. The long-press still works; this is the
    one-motion version beside it.

    A drag is only claimed once it is CLEARLY horizontal (see lib/swipe-reply),
    because the thread's main gesture is scrolling and a finger travelling up
    always drifts sideways. Claiming that drift would make the thread feel
    stuck — much worse than a reply that needs a second try. `touch-pan-y` on
    the row leaves vertical scrolling to the browser and takes only the
    horizontal axis.
  */
  const [dragX, setDragX] = useState(0);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  /*
    THE CLICK AFTER A GESTURE BELONGS TO THE GESTURE.

    A swipe-to-reply and a long-press both end with the finger lifting over a
    bubble, and the browser follows that with a click on whatever is under it.
    Once a photo or clip in a bubble opened full screen on a tap, that click
    opened it at the end of every reply swipe and every long-press. Set when
    either gesture fires, spent by the row's capture handler, and cleared on
    the next press so a gesture that produced no click cannot eat a real tap.
  */
  const swallowClick = useRef(false);

  const startDrag = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" || removed) return;
    dragFrom.current = { x: event.clientX, y: event.clientY };
    dragging.current = false;
  };
  const moveDrag = (event: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (!isReplySwipe(dx, dy)) return;
    dragging.current = true;
    setDragX(swipeOffset(dx));
  };
  const endDrag = (event: React.PointerEvent) => {
    const from = dragFrom.current;
    if (from && dragging.current) {
      swallowClick.current = true;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      // Committed on RELEASE, never mid-drag: a reply that fired under a
      // moving finger would be one nobody chose to send.
      if (swipeCommits(dx, dy)) onReply(message);
    }
    dragFrom.current = null;
    dragging.current = false;
    setDragX(0);
  };

  const startPress = (event: React.PointerEvent) => {
    if (event.pointerType === "mouse" || removed) return;
    cancelPress();
    pressAt.current = { x: event.clientX, y: event.clientY };
    press.current = setTimeout(() => {
      press.current = null;
      swallowClick.current = true;
      setRevealed(true);
      if (hide.current) clearTimeout(hide.current);
      hide.current = setTimeout(() => setRevealed(false), 4_000);
    }, 450);
  };
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current);
      if (hide.current) clearTimeout(hide.current);
    },
    []
  );

  /*
    WHO SAID IT — inside the bubble, WhatsApp's way (ogazboiz, 2026-09-28: the
    run-level name above the bubble sat "far from the sent message"). It rides
    the bubbles' existing top slot beside the quote, so the bubble stays a
    direct child of its row and the `max-w-[min(85%,480px)]` cap keeps meaning
    85% of the PANE — the wrap-in-a-column bug this name once caused cannot
    come back this way. Once per run (`showSender`), incoming group bubbles
    only: your own messages and a 1:1's need no name.
  */
  const senderHeader =
    group && !mine && showSender ? (
      <span className="flex max-w-full items-center gap-1.5">
        <span className="min-w-0 truncate text-[12.5px] font-semibold leading-4 text-white">
          {sender?.displayName ?? nameOf(message.senderId)}
        </span>
        {sender && <VerifiedBadge verification={sender.verification} className="h-3 w-3 shrink-0" />}
        {senderRole ? <MemberRoleChip role={senderRole} /> : null}
      </span>
    ) : null;

  const replyQuote = message.replyTo ? (
    <ReplyQuote
      replyTo={message.replyTo}
      mine={mine}
      name={nameOf(message.replyTo.senderId)}
      onJump={onJump}
    />
  ) : undefined;
  // The name then the quote, in the one slot every bubble renders at its top.
  const quote =
    senderHeader || replyQuote ? (
      <>
        {senderHeader}
        {replyQuote}
      </>
    ) : undefined;

  // A removed message keeps its row but loses its attachment along with its
  // body — the whole point of the state is that the content is gone.
  // A removed announcement loses its card with its body — the state means the
  // content is gone, and a live Join button on a removed message would be the
  // one thing that still worked.
  const invite = !removed && message.deepLink?.kind === "stream";

  const snap = snapView(message, { mine });
  const content =
    /* A SNAP FIRST. It carries a media kind but no url, so every branch below
       would read it as a message with no attachment and draw the empty text
       bubble — which is how a snap would silently vanish from the thread. */
    snap && !removed ? (
      <SnapBubble
        message={message}
        mine={mine}
        group={group}
        tail={tail}
        view={snap}
        onOpen={onOpenSnap}
        busy={openingSnap}
      />
    ) : invite ? (
      <RoomInviteBubble
        message={message}
        mine={mine}
        group={group}
        tail={tail}
        card={roomCardSlot?.(message.deepLink!.ref)}
      />
    ) : removed || !kind ? (
      <TextBubble
        message={message}
        mine={mine}
        group={group}
        tail={tail}
        quote={quote}
        moderatorName={moderatorName}
      />
    ) : kind === "audio" ? (
      <VoiceBubble message={message} mine={mine} group={group} tail={tail} quote={quote} />
    ) : kind === "file" ? (
      <FileBubble message={message} mine={mine} group={group} tail={tail} quote={quote} />
    ) : (
      <MediaBubble message={message} mine={mine} group={group} tail={tail} kind={kind} quote={quote} />
    );

  return (
    <div
      data-message-id={message.id}
      onPointerDown={(event) => {
        swallowClick.current = false;
        startPress(event);
        startDrag(event);
      }}
      onClickCapture={(event) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        cancelPress();
        endDrag(event);
      }}
      onPointerCancel={(event) => {
        cancelPress();
        endDrag(event);
      }}
      onPointerMove={(event) => {
        movePress(event);
        moveDrag(event);
      }}
      style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
      onContextMenu={(event) => {
        // A long-press that reached the OS menu is the one gesture we mean.
        if (revealed) event.preventDefault();
      }}
      className={cn(
        "group relative flex touch-pan-y items-end gap-2 rounded-2xl transition-colors duration-700",
        // No transition WHILE dragging or the row lags the finger; springing
        // back afterwards is the part that should be animated.
        !dragX && "transition-transform",
        mine ? "justify-end" : "justify-start",
        // The flash after a quote tap: a wash on the whole row, which is the
        // one thing that reads the same behind a white and a purple bubble.
        flash && "-mx-2 bg-white/[0.08] px-2 duration-150"
      )}
    >
      {/* The glyph WhatsApp shows while you pull: it sits just off the row's
          left edge and rides in as the row travels, so it is revealed by the
          drag rather than drawn on top of it. It fades in across the trigger
          distance, which makes the fade itself the signal that letting go now
          will reply. `aria-hidden` — the reply is announced by the control it
          leads to, and a screen-reader user is not dragging anything. */}
      {dragX > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-9 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
          style={{ opacity: Math.min(1, dragX / SWIPE_TRIGGER) }}
        >
          <IconQuote className="h-3.5 w-3.5" />
        </span>
      )}
      {/*
        A MEMBER'S FACE OPENS THEIR PROFILE (QA: "When a user clicks on another
        user's pfp in a chat or group conversation, they should be redirected
        to that user's profile"). Only when the roster has resolved who sent
        it — a face with nobody behind it stays a plain picture rather than a
        link to a guessed address. The row's click guard still swallows the
        click at the end of a reply swipe or a long-press, so neither gesture
        navigates away.
      */}
      {group && !mine && (
        sender?.username ? (
          <Link
            href={profileHref(sender)} prefetch={false}
            aria-label={`View ${sender.displayName}'s profile`}
            className="ws-press flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[25%] border-[0.63px] border-white/20 bg-white/10"
          >
            <Avatar name={sender.displayName} seed={sender.id} src={sender.avatarUrl} size={24} />
          </Link>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[25%] border-[0.63px] border-white/20 bg-white/10">
            <Avatar
              name={sender?.displayName ?? "?"}
              seed={sender?.id ?? message.senderId}
              src={sender?.avatarUrl}
              size={24}
            />
          </span>
        )
      )}
      {content}
      {/* A removed message has nothing to answer. The announcement bubble is
          the service's, and answering it is answering nobody. */}
      {!removed && !invite && (
        <ReplyButton mine={mine} revealed={revealed} onClick={() => onReply(message)} />
      )}
      {/* Their own message, and only while it still has something to act on. */}
      {mine && !removed && !invite && (
        <OwnMessageActions
          revealed={revealed}
          canEdit={Boolean(message.text?.trim())}
          onEdit={() => onEdit(message)}
          onRemove={() => onRemove(message)}
        />
      )}
      {/*
        SOMEBODY ELSE'S MESSAGE, AND A LEADER WHO MAY TAKE IT DOWN.

        Deliberately NOT a branch inside `OwnMessageActions`. That control edits
        and withdraws your own words; this removes another person's, which is a
        different act with a different meaning to everybody watching, and the
        service writes a different row for it. Folding them together is how the
        wrong confirmation copy ends up on the more serious of the two.

        `canModerate` is the SERVICE's answer for this sender, never a role
        comparison made here — see `canManage` on the roster. It is false on
        your own messages and false throughout a DM, so this cannot appear
        where the route would refuse it.
      */}
      {!mine && !removed && !invite && canModerate && (
        <ModerateMessageAction revealed={revealed} onModerate={() => onModerate(message)} />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   COMPOSER
   ──────────────────────────────────────────────────────────────────────────── */

function Composer({
  conversationId,
  replyTo,
  onCancelReply,
  replyName,
  members,
  meId,
  conversationKind,
  editing,
  onCancelEdit,
  onSaveEdit,
  savingEdit,
  silenced,
}: {
  conversationId: string;
  /**
   * WHY THIS READER MAY NOT WRITE HERE, or null when they may.
   *
   * Two states produce it and both are NORMAL rather than errors: a member who
   * has been muted, and any member of a house whose leaders set it to
   * admins-only. The service refuses the send with a 403 in both cases, so
   * without this the field accepts a message, the reader presses send, and the
   * words they typed come back as a failure.
   *
   * It never hides the thread. Reading is not restricted in either case, and a
   * disappearing conversation would be a far bigger claim than the one the
   * service is making.
   */
  silenced: string | null;
  /** The message whose words are being changed, or null for an ordinary send. */
  editing: Message | null;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
  savingEdit: boolean;
  /** Direct or group — a snap is only offered in a one-to-one. */
  conversationKind: string;
  /** The message being answered, chosen from a bubble; null for a plain send. */
  replyTo: Message | null;
  onCancelReply: () => void;
  /** Who wrote `replyTo` — "You" for the reader's own. */
  replyName: string;
  /** Everyone in this conversation — the only people the picker may offer. */
  members: MentionableMember[];
  meId: string | undefined;
}) {
  const send = useSendMessage(conversationId);
  const field = useRef<HTMLTextAreaElement>(null);
  /*
    THE TEXT AND THE @-MENTION MACHINERY live in the shared hook the post
    composer and the comment boxes use: "@" opens the list at the caret, a
    pick writes "@handle " and keeps the Mention object to send. The list is
    narrowed to MEMBERS of this conversation — the server's rows that are in
    the roster, plus roster matches the server's top-8 missed — so on a 1:1
    the only person offered is the other party. `mentionCandidates` is pure
    and pinned in `lib/mentionable-members.test.ts`.
  */
  const typing = useMentionTyping({
    max: MESSAGE_MAX,
    field,
    candidates: (found, query) => mentionCandidates({ found, members, query, exclude: meId }),
  });
  const { text } = typing;
  const [picking, setPicking] = useState(false);
  // The "+" tray: one door to the camera and the file picker, so the row
  // carries a single control instead of two glyphs side by side.
  const [addOpen, setAddOpen] = useState(false);
  // The uploaded-but-not-yet-sent attachment. It is already IN storage by the
  // time it lands here — the panel finishes the upload before it closes — so
  // this holds a URL the service will accept, not a File still to be pushed.
  const [attachment, setAttachment] = useState<
    {
      result: UploadResult;
      measured: Measured;
      fileName: string;
      previewUrl: string;
      /** Taken here, or chosen from the device. It decides the View once default. */
      source: MediaSource;
    } | null
  >(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  /*
    THE STAGED ROW DRAWS THE BYTES IN HAND, not the stored object.

    A DM attachment is uploaded PRIVATELY: what comes back is a key, and any
    URL beside it is a signed link that expires — neither is a thing to point
    an <img> at while the reader decides whether to send. `previewUrl` is an
    object URL for the file they picked, so the preview is instant and cannot
    404. It is ours to free: an object URL holds the blob alive until it is
    revoked, and a reader who picks five photos and sends none would otherwise
    keep all five in memory for the life of the tab.
  */
  /*
    SEND THIS ONE AS A SNAP. Off by default, always: view-once is a promise
    about a picture that cannot be taken back once made, so it is a thing the
    sender chooses each time rather than a mode they might forget they are in.
    It is cleared with the attachment, for the same reason.
  */
  const [asSnap, setAsSnap] = useState(false);
  const dropAttachment = useCallback(() => {
    setAsSnap(false);
    setAttachment((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, []);
  const voice = useVoiceRecorder();
  const [voiceBusy, setVoiceBusy] = useState(false);
  /*
    A STOPPED TAKE waits HERE to be heard back before it is sent (ogazboiz,
    2026-09-21). It is NOT staged as a composer attachment — that drew a plain
    file row — but held on its own with a player (VoiceReview). The file rides
    in a ref beside it: it never needs to re-render, and the levels are the
    take's own measured waveform, captured off the recorder before it resets.
  */
  const [voicePreview, setVoicePreview] = useState<{
    url: string;
    durationSeconds: number;
    levels: number[];
  } | null>(null);
  const voicePreviewFile = useRef<File | null>(null);
  /* The service's own two rules, restated so the control is ABSENT rather than
     offered and then refused: one-to-one only, photo or clip only. */
  const snapOffered = canSendSnap({
    conversationKind,
    mediaKind: attachment?.result.kind ?? null,
  });
  const body = text.trim();
  // A tap on Reply is a tap that wants to type.
  useEffect(() => {
    if (replyTo) field.current?.focus();
  }, [replyTo]);
  // The pill GROWS WITH THE DRAFT — the same effect the post composer runs. The
  // field is `rows={1}`, so without this a second line just scrolls the first
  // out of a one-line box and you cannot see what you are typing. Height
  // follows the CONTENT (measured, not counted from newlines: one long line
  // wraps into rows no character count predicts), reset to `auto` first so the
  // box can shrink back down after a send, and capped by the field's own
  // `max-h-32` so a long draft scrolls inside the pill instead of eating the
  // thread.
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [text]);
  // Either half is enough. A photo with no caption is a message; so is a
  // caption with no photo. Only neither is nothing to send — and that rule is
  // the payload builder's, so the button and the request cannot disagree about
  // what counts as empty. The reply target and the mentions ride along: the
  // target as its id, the mentions filtered to whoever is still WRITTEN in the
  // body (`mentionsPresentIn`), since a handle can be deleted after a pick.
  const outgoing: OutgoingMessage = {
    ...(body ? { text: body } : {}),
    ...(replyTo ? { replyToId: replyTo.id } : {}),
    ...(body ? { mentions: typing.mentionsFor(body) } : {}),
    ...(attachment && snapOffered && asSnap ? { viewOnce: true } : {}),
    ...(attachment
      ? {
          media: {
            // The key identifies a PRIVATELY stored object, whose URL is a
            // signed link rather than an address the service would accept
            // back. `buildMessagePayload` sends one or the other.
            key: attachment.result.key,
            source: attachment.source,
            url: attachment.result.url,
            width: attachment.measured.width ?? null,
            height: attachment.measured.height ?? null,
            durationSeconds: attachment.measured.durationSeconds ?? null,
            // Files only. Sent for a document and never for a photo: the
            // service rejects a name on media that is not a file, and
            // `buildMessagePayload` drops an empty one either way.
            fileName: attachment.result.kind === "file" ? attachment.fileName : null,
            sizeBytes: attachment.result.kind === "file" ? attachment.result.bytes : null,
          },
        }
      : {}),
  };
  const canSend = canSendMessage(outgoing) && !send.isPending && !silenced;
  // The staged gallery image's editor (draw/text/stickers/crop), asked for its
  // baked result on send.
  const galleryEditorRef = useRef<MediaEditorHandle | null>(null);

  /**
   * Stop recording, upload, and stage the result like any other attachment.
   *
   * It becomes a pending attachment rather than sending itself: a voice note
   * that posted the instant you stopped talking gives you no way to hear it
   * back or change your mind, and the duration measured here rides along so
   * nothing has to demux the file to draw the waveform's length.
   */
  /*
    A CAPTURE GOES UP THE SAME PIPE AS A PICKED FILE, and arrives marked
    `camera`. That mark is the only difference, and it is what arms View once:
    a photo taken inside a chat is of the moment, a photo out of a gallery was
    kept for a reason and is not ours to destroy on the sender's behalf.

    The camera's own review IS the send screen (ogazboiz, 2026-09-21): the shot
    goes straight out with the caption typed under it, view-once armed by
    `defaultViewOnce` — no staging into a composer chip.
  */
  const takeCapture = async (file: File, previewUrl: string, caption: string, viewOnce: boolean) => {
    setCameraBusy(true);
    try {
      const uploaded = await uploadFile(file, undefined, "attachment", "message");
      // The reviewer's choice, but only where the service accepts a snap at all
      // (`defaultViewOnce` is false in a group or on a non-photo/clip).
      const armed =
        viewOnce && defaultViewOnce({ source: "camera", conversationKind, mediaKind: uploaded.kind });
      const trimmed = caption.trim();
      const capture: OutgoingMessage = {
        ...(trimmed ? { text: trimmed } : {}),
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        ...(armed ? { viewOnce: true } : {}),
        media: {
          key: uploaded.key,
          source: "camera",
          url: uploaded.url,
          width: null,
          height: null,
          durationSeconds: null,
          fileName: null,
          sizeBytes: null,
        },
      };
      send.mutate(capture, { onSuccess: () => onCancelReply() });
      URL.revokeObjectURL(previewUrl);
    } catch (cause) {
      URL.revokeObjectURL(previewUrl);
      toast.error(cause instanceof Error ? cause.message : "That capture didn't upload.");
    } finally {
      setCameraBusy(false);
    }
  };

  /*
    STOP & REVIEW — end the take and hold it for playback, WITHOUT uploading it
    or staging it as an attachment (which drew a plain file row). The upload
    waits for Send, once the reader has heard it back. `voice.stop` does not
    clear the measured levels, so they are captured here for the player to draw
    the take's own waveform.
  */
  const stopForReview = async () => {
    const capturedLevels = voice.levels;
    const result = await voice.stop();
    if (!result) return;
    voicePreviewFile.current = result.file;
    setVoicePreview({
      url: URL.createObjectURL(result.file),
      durationSeconds: result.durationSeconds,
      levels: capturedLevels,
    });
  };

  const discardVoicePreview = useCallback(() => {
    voicePreviewFile.current = null;
    setVoicePreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  /** Throw this take away and start a fresh one. */
  const reRecordVoice = () => {
    discardVoicePreview();
    void voice.start();
  };

  /** Upload the reviewed take and send it. */
  const sendVoicePreview = async () => {
    const file = voicePreviewFile.current;
    const preview = voicePreview;
    if (!file || !preview) return;
    setVoiceBusy(true);
    try {
      // "attachment" is what admits audio at all — see the note in
      // AttachmentPanel. Without it a recorded voice note is rejected by our
      // own uploader before it reaches the service.
      const uploaded = await uploadFile(file, undefined, "attachment", "message");
      const note: OutgoingMessage = {
        ...(replyTo ? { replyToId: replyTo.id } : {}),
        media: { key: uploaded.key, url: uploaded.url, durationSeconds: preview.durationSeconds },
      };
      send.mutate(note, { onSuccess: () => onCancelReply() });
      discardVoicePreview();
    } catch {
      toast.error("Couldn't send the voice note.");
    } finally {
      setVoiceBusy(false);
    }
  };

  /*
    THE WORDS GO INTO THE FIELD WHEN AN EDIT STARTS, once per message.

    Keyed on the id, so a re-render cannot clobber what the reader has typed
    since, and cleared when the edit is cancelled or saved.
  */
  const editingId = editing?.id ?? null;
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (editingId === seeded.current) return;
    seeded.current = editingId;
    typing.replace(editingId ? (editing?.text ?? "") : "", null);
    field.current?.focus();
    // Read only when the id changes — that guard is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  const submit = async () => {
    /*
      SAVING AN EDIT AND SENDING A MESSAGE ARE THE SAME BUTTON, and the strip
      above the field is what tells them apart. Two buttons that look alike
      would be worse: the reader would have to work out which one they are
      looking at every time.
    */
    if (editing) {
      const next = text.trim();
      if (!next || savingEdit) return;
      onSaveEdit(next);
      return;
    }
    if (!canSend) return;
    let payload = outgoing;
    /*
      A GALLERY PHOTO OR CLIP WAS EDITED ON ITS PREVIEW (draw / text / stickers,
      plus crop on a photo): bake it, re-upload the result, and send THAT key.
      The pick uploaded the original already, so an edit costs a second upload —
      the honest price of editing after the fact, paid only when there really is
      one. A clip re-encode happens inside exportImage and takes the clip's length.
    */
    if (
      (attachment?.result.kind === "image" || attachment?.result.kind === "video") &&
      galleryEditorRef.current?.hasEdits()
    ) {
      const edited = await galleryEditorRef.current.exportImage();
      if (edited && payload.media) {
        try {
          const up = await uploadFile(edited.file, undefined, "attachment", "message");
          payload = {
            ...payload,
            media: { ...payload.media, key: up.key, url: up.url, width: null, height: null },
          };
        } catch (cause) {
          URL.revokeObjectURL(edited.url);
          toast.error(cause instanceof Error ? cause.message : "That edit didn't upload.");
          return;
        }
        URL.revokeObjectURL(edited.url);
      }
    }
    send.mutate(payload, {
      onSuccess: () => {
        typing.reset();
        // Frees the object URL as well as clearing the row — the sent message
        // is drawn from the service's own payload from here on.
        dropAttachment();
        onCancelReply();
      },
    });
  };

  const replyLine = replyTo
    ? replyExcerpt({
        text: replyTo.text,
        media: replyTo.media ? { kind: replyTo.media.kind } : null,
        deleted: replyTo.status === "removed",
      })
    : "";

  return (
    // Pinned, not sticky, for the same reason as the header: it is the last
    // fixed row of the pane's flex column, so it sits still while the messages
    // scroll behind it. The design's 3% white is flattened to an opaque value
    // over the app's ground — a translucent bar would show the river sliding
    // through the composer. The hairline above is the design's 10%.
    /* Node 75:8147 — `white/3` OVER the ground, not `#080808`. A near-black of
       its own put a third black in the pane; a 3% wash lifts the bar off the
       ground it shares with everything else. */
    <div className="flex min-h-20 shrink-0 flex-col justify-center gap-1 border-t border-white/10 bg-white/[0.03] px-6 py-4">
      {/*
        "Replying to …", above the field, in the attachment chip's recipe so
        the two stack as one family when both are up. The name, one line of
        the original (or "Photo" / "Voice note"), and an × — Escape in the
        field clears it too. The text is NOT prefilled with "@handle": the
        service records who was answered from `replyToId`, and the bubble
        draws the quote from `replyTo`, so a typed handle would print twice.
      */}
      {/* EDITING SAYS SO, above the field. The send button becomes a save, so
          the reader has to be able to see which act is about to happen —
          otherwise one control means two things with nothing to tell them
          apart. */}
      {editing && (
        <div
          role="status"
          className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 border-l-2 border-l-create bg-white/[0.04] py-2 pl-3 pr-2"
        >
          <span className="min-w-0 flex-1 text-[12px] font-semibold leading-[17px] text-body">
            Editing your message
          </span>
          <button
            type="button"
            onClick={onCancelEdit}
            aria-label="Cancel edit"
            className="ws-press shrink-0 rounded-full p-1.5 text-meta transition-colors hover:bg-white/10 hover:text-heading"
          >
            <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="m3 3 6 6m0-6-6 6" />
            </svg>
          </button>
        </div>
      )}
      {replyTo && (
        <div
          role="status"
          className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 border-l-2 border-l-spotlight-chip-ink bg-white/[0.04] py-2 pl-3 pr-2"
        >
          <IconQuote className="h-3.5 w-3.5 shrink-0 text-spotlight-chip-ink" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold leading-4 text-white">
              Replying to {replyName}
            </p>
            {replyLine && (
              <p
                className={cn(
                  "truncate text-[12px] leading-4 text-white/60",
                  replyTo.status === "removed" && "italic"
                )}
              >
                {replyLine}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="ws-press flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/*
        The staged attachment, above the field.

        It is drawn BEFORE sending because the upload has already happened: the
        alternative — attach and send in one gesture — spends the user's
        bandwidth on a file they have not confirmed and gives them nothing to
        undo. Removing it here only drops our reference; the stored object is
        the service's to reap, and re-picking is cheap.
      */}
      {/* IMAGE / VIDEO gets the full send-preview, the same screen the camera
          uses (large media + the shared caption/view-once/send bar) — chosen by
          FILE TYPE. Audio and documents keep the compact chip below: a PDF has
          no full-screen preview and view-once is image/clip only. */}
      {attachment && (attachment.result.kind === "image" || attachment.result.kind === "video") && (
        <Sheet
          open
          onClose={dropAttachment}
          bare
          panelClassName="h-[95dvh] max-h-[95dvh] bg-black sm:h-auto sm:max-h-[88dvh] sm:max-w-[420px] sm:rounded-2xl"
        >
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <h2 className="text-[14px] font-semibold text-white">Preview</h2>
              <button
                type="button"
                onClick={dropAttachment}
                aria-label="Remove"
                className="ws-press rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
              >
                <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                  <path d="m3.5 3.5 9 9m0-9-9 9" />
                </svg>
              </button>
            </div>
            {/* The chosen file, shown whole. A photo or clip gets the editor
                (draw / text / stickers; crop is photo-only) baked in on send;
                a clip re-encode runs at send time. */}
            <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-black sm:aspect-3/4 sm:flex-none">
              {attachment.result.kind === "image" || attachment.result.kind === "video" ? (
                <MediaEditor
                  ref={galleryEditorRef}
                  src={attachment.previewUrl}
                  kind={attachment.result.kind === "video" ? "video" : "photo"}
                  fileName={
                    attachment.fileName ||
                    (attachment.result.kind === "video" ? "video.mp4" : "photo.jpg")
                  }
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
                <img src={attachment.previewUrl} alt="Attachment" className="h-full w-full object-contain" />
              )}
            </div>
            <MediaSendBar
              caption={text}
              onCaptionChange={(value) => typing.update(value, value.length)}
              viewOnce={asSnap}
              onToggleViewOnce={() => setAsSnap((on) => !on)}
              showViewOnce={snapOffered}
              onSend={submit}
              sending={send.isPending}
              autoFocusCaption
            />
          </div>
        </Sheet>
      )}

      {attachment && attachment.result.kind !== "image" && attachment.result.kind !== "video" && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2">
          {/* Only audio and documents reach this chip — image and video get the
              full preview above. A voice note gets its player; anything else the
              neutral extension tile. */}
          {attachment.result.kind === "audio" ? (
            <StagedVoicePreview
              url={attachment.previewUrl}
              durationSeconds={attachment.measured.durationSeconds ?? null}
            />
          ) : (
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[11px] font-semibold uppercase text-white/70"
            >
              {fileExtensionLabel(attachment.fileName, attachment.result.url)}
            </span>
          )}
          <p className="min-w-0 flex-1 truncate text-[12px] text-white/70">
            {attachment.result.kind === "audio"
              ? "Voice note"
              : attachment.fileName || "Attachment"}{" "}
            <span className="text-white/40">{formatBytes(attachment.result.bytes)}</span>
          </p>
          {/* NO VIEW-ONCE SWITCH HERE ANY MORE. A photo or clip now goes
              through the full send preview (MediaSendBar), which owns that
              choice; this row is left with documents and voice notes, which
              cannot be view-once at all. A second switch would be a second
              place for the two to disagree. */}
          <button
            type="button"
            onClick={dropAttachment}
            aria-label="Remove attachment"
            className="ws-press shrink-0 rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}

      {voice.error && (
        <p role="alert" className="mb-2 text-[12px] text-down">
          {voice.error}
        </p>
      )}

      {voicePreview ? (
        /* A stopped take, held for review — the player and its three acts stand
           in for the composer row until it is sent or discarded. */
        <VoiceReview
          url={voicePreview.url}
          durationSeconds={voicePreview.durationSeconds}
          levels={voicePreview.levels}
          sending={voiceBusy}
          onDiscard={discardVoicePreview}
          onReRecord={reRecordVoice}
          onSend={() => void sendVoicePreview()}
        />
      ) : (
      <div className="flex items-center gap-4">
        {voice.recording ? (
          /*
            RECORDING LIVES INSIDE THE COMPOSER ROW, NOT ABOVE IT (ogazboiz,
            2026-09-21: "the audio wave is meant to be inside the input text
            field"). The pill that holds the draft now holds the clock and the
            live waveform; Discard replaces the "+" on the left, Pause and Send
            flank it on the right — ONE row, not three stacked layers. The bars
            drain to a quiet grey the moment the take is paused, so a frozen row
            is unmistakably frozen.
          */
          <>
            {/* DISCARD — replaces the "+", the destructive act kept quiet. */}
            <button
              type="button"
              onClick={voice.cancel}
              aria-label="Discard recording"
              title="Discard"
              className="ws-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconTrash className="h-5 w-5" />
            </button>

            {/* THE PILL, now the recorder: the clock, then the live waveform
                filling to the right — the same bars the playback bubble draws. */}
            <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[30px] border border-[#26262B] bg-[#18181C] px-4 py-2">
              <span className="tnum shrink-0 text-[13px] font-semibold tracking-tight text-white" role="status">
                {formatElapsed(voice.elapsed)}
              </span>
              <span aria-hidden className="flex h-6 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden">
                {voice.levels.map((level, index) => (
                  <span
                    key={index}
                    className={cn(
                      "w-[2.5px] shrink-0 rounded-full transition-colors",
                      voice.paused ? "bg-white/25" : "bg-white/70"
                    )}
                    style={{ height: `${Math.round(dotScale(level) * 100)}%` }}
                  />
                ))}
              </span>
            </div>

            {/* PAUSE / RESUME — a red ring while live, the mic to pick it back
                up; the take is gathered in as many breaths as it takes. */}
            <button
              type="button"
              onClick={voice.paused ? voice.resume : voice.pause}
              aria-label={voice.paused ? "Resume recording" : "Pause recording"}
              aria-pressed={voice.paused}
              title={voice.paused ? "Resume" : "Pause"}
              className="ws-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-danger text-danger transition-colors hover:bg-danger/10"
            >
              {voice.paused ? <IconMic className="h-5 w-5" /> : <IconPause className="h-5 w-5" />}
            </button>

            {/* STOP & REVIEW — end the take and open the player, so it can be
                heard back BEFORE it is sent (ogazboiz, 2026-09-21: "play the
                voice note before sending it"). A stop square, not a send arrow:
                the next screen is the listen, not the send. */}
            <button
              type="button"
              onClick={() => void stopForReview()}
              disabled={voiceBusy}
              aria-label="Stop recording and listen"
              title="Stop and listen"
              className="ws-btn-create ws-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <span aria-hidden className="h-3.5 w-3.5 rounded-[3px] bg-current" />
            </button>
          </>
        ) : (
        <>
        {/*
          ATTACHMENT IS LIVE. It was inert while `POST /conversations/:id/
          messages` took `{ text }` alone and nothing documented how a message
          with media was SENT — wiring it to an invented body would have been
          guessing at a request shape. The service now documents `media.url`,
          takes a URL from its OWN upload path, and derives the kind from the
          stored object, so this is the flow it describes: upload through
          `/uploads/*`, then send the `publicUrl` it answers with.

          VOICE IS LIVE TOO. The endpoint accepts audio, and `useVoiceRecorder`
          is the recorder that was missing — it picks a format the browser can
          encode AND the service will accept before it ever opens the
          microphone, so nobody records a message that cannot be sent.
        */}
        {/*
          ONE "+" INSTEAD OF TWO GLYPHS. The paperclip (something kept) and the
          camera (the moment in front of you) sat side by side; a single "+"
          now opens both from one tray, the way every messenger does it. What
          each door does is unchanged — the file picker and the view-once
          camera — only how they are reached.

          Camera is a ONE-TO-ONE row only, where a snap means anything, so in a
          house the tray holds the file picker alone. The backdrop is a
          full-screen button, not a document listener: it closes on the same
          tap that would fall through, and it is reachable by keyboard — the
          header's overflow menu is built the same way.
        */}
        <div className="relative shrink-0">
          <CircleButton
            label="Add a photo, video or file"
            size={24}
            onClick={() => setAddOpen((open) => !open)}
            icon={<IconPlus className="h-6 w-6 text-white" />}
          />
          {addOpen && (
            <>
              <button
                type="button"
                aria-label="Close"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setAddOpen(false)}
              />
              <div className="absolute bottom-full left-0 z-50 mb-2 min-w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#161619] p-1 shadow-xl">
                {conversationKind === "direct" && (
                  <button
                    type="button"
                    disabled={cameraBusy}
                    onClick={() => {
                      setAddOpen(false);
                      setCameraOpen(true);
                    }}
                    className="ws-press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-white transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    <IconCamera className="h-5 w-5 text-white/80" />
                    Photo or video
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    setPicking(true);
                  }}
                  className="ws-press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-white transition-colors hover:bg-white/10"
                >
                  <Image src={asset("/messages/attach.svg")} alt="" width={20} height={20} />
                  Attach a file
                </button>
              </div>
            </>
          )}
        </div>

        <label className="sr-only" htmlFor="message-composer">
          Write a message
        </label>
        {/* The design draws this pill at a fixed 40 tall with 16px padding all
            round, which does not fit inside 40. Read as a 16px horizontal
            inset on a 40px row with its content centred. It grows past 40 on a
            multi-line draft, which the design has no state for — losing
            shift+enter to keep the pill rigid would be the worse trade. */}
        <div className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[30px] border border-[#26262B] bg-[#18181C] px-4 py-2">
          <textarea
            id="message-composer"
            ref={field}
            value={text}
            rows={1}
            // The hook caps at MESSAGE_MAX — the service rejects anything
            // longer, so the field stops there too — and reads the caret for
            // an @-token.
            onChange={(event) => typing.update(event.target.value, event.target.selectionStart)}
            onKeyDown={(event) => {
              // With the list open, Enter is not a send (the same rule the
              // comment box follows); Escape closes the list first, and a
              // second Escape clears the reply target.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!typing.token) submit();
              }
              if (event.key === "Escape") {
                if (typing.token) {
                  event.preventDefault();
                  typing.dismiss();
                } else if (replyTo) {
                  event.preventDefault();
                  onCancelReply();
                }
              }
            }}
            disabled={Boolean(silenced)}
            /*
              The REASON stands where the invitation to type used to. A greyed
              field with no words is indistinguishable from a broken one, and
              the reader's next move depends entirely on which of the two states
              they are in — a mute is about them, an announcement house is about
              everybody.
            */
            placeholder={
              silenced ?? (attachment ? "Add a caption…" : replyTo ? "Write a reply…" : "Write a message…")
            }
            // The design's caret is #008CFF — the one place in this pane a
            // colour is specified for something the house has no token for.
            className="max-h-32 min-w-0 flex-1 resize-none bg-transparent text-base leading-5 text-white caret-[#008CFF] outline-none placeholder:text-meta"
          />
          {/* ONE ACTION, INSIDE THE FIELD — where the emoji used to sit, and
              the only send affordance now that the standalone button is gone.
              It is the WhatsApp swap: with something to send it is a send disc,
              and empty it is the microphone, so the pill carries exactly one
              act at a time. Return still sends a text draft. The mic opens the
              level meter and the stop/keep/send controls above the composer,
              and turns spotlight-purple while it is live. Sized to sit inside
              the pill rather than as a full CircleButton, which would not fit. */}
          {canSend || send.isPending ? (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send message"
              title="Send"
              className="ws-btn-create ws-press flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {send.isPending ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                <IconSend className="h-4 w-4" />
              )}
            </button>
          ) : (
            <button
              type="button"
              aria-label="Record a voice note"
              title="Record a voice note"
              disabled={voiceBusy}
              onClick={() => {
                if (voiceBusy) return;
                void voice.start();
              }}
              className="ws-press flex h-7 w-7 shrink-0 items-center justify-center self-end rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              {voiceBusy ? (
                <Spinner className="h-4 w-4 text-white" />
              ) : (
                <IconMic className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
        </>
        )}
      </div>
      )}

      {text.length > MESSAGE_MAX - 200 && (
        <p className="tnum text-right text-[11px] text-meta">{MESSAGE_MAX - text.length} left</p>
      )}

      {/* The shared list, portalled above the field, only while an @-token is
          open under the caret. Its rows are this conversation's members. */}
      {typing.token && (
        <MentionPicker typing={typing} heading="Members" emptyLabel="Nobody in this chat matches." />
      )}

      {/* Mounted only while open, so each opening starts from clean state —
          see the note in the panel. */}
      <CameraSheet
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(file, previewUrl, caption, viewOnce) =>
          void takeCapture(file, previewUrl, caption, viewOnce)
        }
      />

      {picking && (
        <AttachmentPanel
          open
          onClose={() => setPicking(false)}
          onAttached={(result, measured, fileName, previewUrl) =>
            setAttachment({ result, measured, fileName, previewUrl, source: "upload" })
          }
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   THE PANE
   ──────────────────────────────────────────────────────────────────────────── */

export function Thread({
  conversation,
  onBack,
  /** Opens the gist-room composer. Supplied by the layout, which owns it. */
  onCreateGistRoom,
  /**
   * The designed invite card for a gist-room announcement (node 225:3873).
   * Supplied by the layout, which is the one place allowed to read the room,
   * the topic vocabulary and this group's roster at once.
   */
  roomCardSlot,
  safetyRowsSlot,
  onAddMembers,
}: {
  conversation: Conversation;
  onBack: () => void;
  onCreateGistRoom?: () => void;
  roomCardSlot?: (streamId: string) => React.ReactNode;
  /**
   * Block and Report for a 1:1 — the profile slice's actions, drawn as this
   * menu's own rows. A slot, because slices never import each other.
   */
  safetyRowsSlot?: (peer: Profile) => React.ReactNode;
  /** Opens the people picker for "Add / Invite gist partners". */
  onAddMembers?: () => void;
}) {
  const me = useMe();
  const group = isGroupThread(conversation);
  const messages = useMessages(conversation.id, true);
  // Older pages, fetched as the reader scrolls up — see useMessageHistory.
  const history = useMessageHistory(conversation.id, messages.data?.nextCursor ?? null);
  const markRead = useMarkConversationRead();
  const reducedMotion = useReducedMotion();
  const [membersOpen, setMembersOpen] = useState(false);
  /*
    THE REPLY TARGET, keyed by conversation rather than reset in an effect:
    a target chosen in one thread must not survive into the next, and
    deriving it from the id does that without a `setState` inside an effect.
  */
  const [replyState, setReplyState] = useState<{ conversationId: string; message: Message } | null>(null);
  const replyTo = replyState?.conversationId === conversation.id ? replyState.message : null;
  const setReplyTo = (message: Message | null) =>
    setReplyState(message ? { conversationId: conversation.id, message } : null);
  /*
    OPENING A SNAP, which is the one action in this pane that DESTROYS
    something. The mutation lives here rather than in the bubble so the thread
    and the inbox are invalidated once, and so the id being opened is known to
    the row that must show it as busy — two bubbles can never be opening at the
    same time, which matters when the thing being spent is unrecoverable.
  */
  /*
    EDITING HAPPENS IN THE COMPOSER, not in the bubble.

    A field that appears inside the river would move the whole conversation
    under the reader's eye while they type, and the composer already owns
    everything about writing a message — the emoji picker, the mention picker,
    the character cap. So an edit puts the words back where they were written
    and the send button saves them.
  */
  const [editing, setEditing] = useState<Message | null>(null);
  const remove = useRemoveMessage(conversation.id);
  const moderate = useModerateMessage(conversation.id);
  const edit = useEditMessage(conversation.id);
  const openSnapMutation = useOpenSnap(conversation.id);
  const [openingSnapId, setOpeningSnapId] = useState<string | null>(null);
  const openSnapMutate = openSnapMutation.mutateAsync;
  const openSnap = useCallback(
    async (messageId: string) => {
      setOpeningSnapId(messageId);
      try {
        return await openSnapMutate(messageId);
      } finally {
        setOpeningSnapId(null);
      }
    },
    [openSnapMutate]
  );
  /* The row a quote tap just landed on, washed for a moment. */
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );
  const [renaming, setRenaming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const removeChat = useDeleteConversation();
  const rename = useRenameGroup(conversation.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const leave = useLeaveGroup(conversation.id);

  /*
    "Share invite link" — mints an invite and opens the share sheet a post uses,
    so a house can be sent to somebody who is not in it yet. The link lands on
    `/join/<token>`. Offered to whoever the service lets make one: any member
    of a public house, only the owner of a private one (`canMakeInvite`).
  */
  const makeInvite = useCreateInvite();
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const shareInvite = () =>
    makeInvite.mutate(conversation.id, {
      onSuccess: (invite) => setInviteLink(inviteUrl(window.location.origin, invite.token)),
    });

  // The roster, for turning a bubble's `senderId` into a face. Groups only —
  // a 1:1 reads identity from `peer` and never issues the request.
  const members = useConversationMembers(conversation.id, group);
  /*
    WHO THIS VIEWER MAY MODERATE, by sender id, straight off the roster.

    A Map rather than a find per bubble: a long house thread draws hundreds of
    rows and each one would otherwise scan the whole member list.

    Absent means FALSE — a roster still loading, or a sender who has left the
    group, offers no control. The alternative is a button that appears a second
    after the thread does, on messages the viewer may turn out not to be allowed
    to touch.
  */
  const manageable = new Map(
    (members.data?.items ?? []).flatMap((row) =>
      row.profile ? [[row.profile.id, row.canManage] as const] : []
    )
  );

  /*
    YOUR ROLE IN THE HOUSE comes from the roster: owner, admin or member.
    `createdBy` only says who MADE the house — ownership can be handed over,
    and passes on when an owner leaves — so it stands in only until the roster
    has loaded.
  */
  const myRole = viewerRole(members.data?.items, me.data?.id, conversation.createdBy);
  /*
    WHY THIS READER CANNOT WRITE HERE — null when they can.

    Two independent settings, both of which the service enforces on SEND with a
    403, and both of which are ordinary states rather than failures. Checked in
    this order because a mute is the more specific fact: somebody muted in an
    announcement house should be told they are muted, which is the thing that
    singles them out and the thing they would have to ask about.

    The viewer's own mute is read from the ROSTER rather than the inbox row —
    `muted` is per member and the row does not carry the reader's own. A roster
    that has not loaded yet silences nobody: a composer that greys itself out
    while a request is in flight accuses the reader of something on the strength
    of not knowing yet.
  */
  const myMembership = (members.data?.items ?? []).find(
    (row) => row.profile?.id && row.profile.id === me.data?.id
  );
  const silenced = !group
    ? null
    : myMembership?.muted
      ? "You can't send messages in this group"
      : conversation.whoCanPost === "admins" && myRole === "member"
        ? "Only admins can post in this group"
        : null;
  const isOwner = myRole === "owner";
  const manages = myRole === "owner" || myRole === "admin";
  const canShareInvite = group && canMakeInvite({ visibility: conversation.visibility, manages });
  const senders = new Map<string, Profile>();
  // The summary's capped preview first, so avatars are right for the four most
  // recent talkers before the full roster arrives; the full list overwrites it.
  for (const profile of conversation.members) senders.set(profile.id, profile);
  for (const row of members.data?.items ?? []) {
    if (row.profile) senders.set(row.profile.id, row.profile);
  }
  // A 1:1 has no roster request; its two people are the reader and the peer.
  if (!group && conversation.peer) senders.set(conversation.peer.id, conversation.peer);

  /**
   * WHAT THIS SENDER IS IN THIS HOUSE — owner, admin, or nothing.
   *
   * Read off the SAME roster the faces come from, so a bubble and the members
   * sheet can never disagree about who runs the place. Undefined until the
   * roster lands, which is why the chip appears a moment after the avatar
   * rather than the name waiting for it.
   */
  const roleOf = (senderId: string): string | null =>
    members.data?.items.find((row) => row.profile?.id === senderId)?.role ?? null;

  /** A sender id as the name a quote or the reply strip prints. */
  const nameOf = (senderId: string): string => {
    if (me.data && senderId === me.data.id) return "You";
    return senders.get(senderId)?.displayName ?? "Member";
  };
  /**
   * WHICH leader removed a message, or null when we cannot say.
   *
   * Separate from `nameOf` on purpose: that one answers "Member" for an id it
   * does not hold, which is a fine fallback inside a quote and a bad one here —
   * "Removed by Member" reads like a bug, while "Removed by a moderator" is
   * true and is what the row falls back to.
   *
   * A moderator who has since left the house is exactly that case, and it is
   * the common one over time. Naming the reader as "you" rather than by their
   * own display name is the same courtesy every other line in this thread pays.
   */
  const moderatorNameOf = (moderatorId: string | null): string | null => {
    if (!moderatorId) return null;
    if (me.data && moderatorId === me.data.id) return "you";
    return senders.get(moderatorId)?.displayName ?? null;
  };

  /** Who the composer may @-mention: everyone here but the reader. */
  const mentionable: MentionableMember[] = [...senders.values()].map((profile) => ({
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
  }));

  /*
    READING THE THREAD IS THE ACKNOWLEDGEMENT — and it keeps being one.

    This used to fire once per thread and never again, so a message that
    arrived while the reader was SITTING IN the conversation was counted as
    unread for ever: ogazboiz watched three snaps land in an open thread,
    opened every one of them, and the inbox still said 3 (2026-09-19).

    Keyed on the conversation AND its newest message, which is exactly the pair
    that means "something has arrived since we last said we had seen it". The
    same pair is acknowledged only once, so the mark-read → refetch → render
    cycle cannot drive a request loop.
  */
  const acknowledged = useRef<string | null>(null);
  const seenThrough = `${conversation.id}:${conversation.lastMessageAt ?? ""}`;
  useEffect(() => {
    if (acknowledged.current === seenThrough) return;
    acknowledged.current = seenThrough;
    if (conversation.unreadCount > 0) markRead.mutate(conversation.id);
  }, [seenThrough, conversation.id, conversation.unreadCount, markRead]);

  // The service returns newest-first; a thread reads oldest-first — every
  // older page the reader has scrolled into, then the live newest page.
  const items = mergeHistory(
    messages.data?.items ?? [],
    history.data?.pages.map((page) => page.items) ?? []
  );
  const days = groupMessagesByDay(items);

  /*
    WHERE THE STREAK NOTICE SITS — anchored to the day it began, woven into the
    river, so it stays put instead of trailing the newest message and appearing
    to move every time a post is sent (ogazboiz, 2026-09-21).

    The service gives no start timestamp, only the day COUNT and the expiry
    DEADLINE — so the start day is DERIVED from those (expiry, less the streak's
    length and its one-day grace) rather than the wall clock, which keeps it
    stable across sends and never claims a precise clock time we were not told.
    Null expiry falls back to the foot, the old live-status position.
  */
  const showStreak = !group && conversation.snapStreak > 0;
  const streakStartKey = (() => {
    if (!showStreak || !conversation.snapStreakExpiresAt) return null;
    const expiry = Date.parse(conversation.snapStreakExpiresAt);
    if (Number.isNaN(expiry)) return null;
    const start = new Date(expiry - (conversation.snapStreak + 1) * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  })();
  // The day section to draw the notice BEFORE; `days.length` means the foot.
  const streakAt = !showStreak
    ? -1
    : streakStartKey === null
      ? days.length
      : (() => {
          const index = days.findIndex((day) => day.key >= streakStartKey);
          return index === -1 ? days.length : index;
        })();
  const streakNotice = showStreak ? (
    <p className="flex items-center justify-center gap-1.5 text-center text-[13px] font-medium leading-5 text-white/60">
      {/* eslint-disable-next-line @next/next/no-img-element -- the file's own export */}
      <img
        src={asset("/messages/streak-flame.svg")}
        alt=""
        aria-hidden
        className="h-4 w-[9.617px] shrink-0"
      />
      You and {threadTitle(conversation)} started a streak
    </p>
  ) : null;

  // Only the messages scroll. The header and the composer are fixed rows of
  // this column, so the reader's eye keeps both while the river moves between
  // them — which is what every messaging app does and what page-level
  // scrolling with sticky bands only approximates.
  const river = useRef<HTMLDivElement>(null);
  // Whether the reader is at the live edge and should be carried along by new
  // messages. A ref, not state: it changes on every scroll frame and nothing
  // renders from it.
  const following = useRef(true);

  const toBottom = () => {
    const node = river.current;
    if (node) node.scrollTop = node.scrollHeight;
  };

  /*
    OLDER MESSAGES ARRIVE ABOVE THE READER. Prepending content would scroll
    what they were reading out from under them, so the pane's height is noted
    when a page is asked for and the offset is moved by exactly what arrived,
    before the browser paints (a layout effect). Only history pages do this;
    the newest page merges at the bottom and follows the live-edge rule.
  */
  const anchor = useRef<{ scrollTop: number; scrollHeight: number } | null>(null);
  const historyPages = history.data?.pages.length ?? 0;
  const loadOlder = () => {
    const node = river.current;
    if (!node || !history.hasNextPage || history.isFetchingNextPage) return;
    anchor.current = { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight };
    void history.fetchNextPage();
  };
  useLayoutEffect(() => {
    const node = river.current;
    if (!node || !anchor.current) return;
    node.scrollTop = anchorAfterPrepend(anchor.current, node.scrollHeight);
    anchor.current = null;
  }, [historyPages]);

  // Opening a conversation lands on its newest message, never at the top of
  // its history.
  useEffect(() => {
    following.current = true;
    toBottom();
  }, [conversation.id]);

  /**
   * A tap on a quote: scroll the original into the middle of the river and
   * wash its row for a moment. Only when it is LOADED — the thread pages 50 at
   * a time and an original past that has no row to land on, so the tap does
   * nothing rather than jumping somewhere wrong.
   */
  const jumpTo = (messageId: string) => {
    const node = river.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    );
    if (!node) return;
    following.current = false;
    node.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    setFlashId(messageId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1_400);
  };

  // Follow arriving messages, but only from the live edge — someone scrolled
  // up reading yesterday must not be yanked down because a message landed.
  useEffect(() => {
    if (following.current) toBottom();
  }, [items.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadHeader
        conversation={conversation}
        onBack={onBack}
        onCreateGistRoom={onCreateGistRoom}
        menu={
          <ThreadMenu
            kind={group ? "group" : "direct"}
            // The service lets only the group's creator rename it, and
            // `createdBy` is the field that says who that is. A member sees the
            // shorter menu (78:8337), which is not a degraded version of the
            // owner's — it is the correct one for what they may do.
            /*
              OWNERSHIP IS ON THE CONVERSATION NOW.

              `ConversationSummary` carries `createdBy`, so the menu is right on
              the first render. It used to be inferred from `role === "owner"`
              on the roster, which meant a second request had to land before the
              owner saw the owner's menu — the roster is still read for sender
              avatars, and is kept here only as the fallback for a payload that
              predates the field.
            */
            isOwner={isOwner}
            canEdit={manages}
            safetyRows={
              !group && conversation.peer ? safetyRowsSlot?.(conversation.peer) : undefined
            }
            actions={{
              onCreateGistRoom,
              onAddMembers,
              onViewMembers: () => setMembersOpen(true),
              onShareInvite: canShareInvite ? shareInvite : undefined,
              onRenameGroup: () => setSettingsOpen(true),
              onLeaveGroup: me.data ? () => setLeaving(true) : undefined,
              onDeleteChat: () => setDeleting(true),
            }}
          />
        }
      />

      {inviteLink && (
        <ShareSheet
          open
          onClose={() => setInviteLink(null)}
          title="Share invite link"
          payload={{ text: `Join ${conversation.title ?? "my house"} on Square`, url: inviteLink }}
        />
      )}

      {/* 40px from the header to the first separator is the design's (header
          80, first label at y=120). The gap below is ours — its day sections
          are absolutely placed, so it has no measurable bottom, and 24 is the
          pane's own rhythm.

          `min-h-0` because a flex child's default minimum is its CONTENT, so
          without it this grows to fit the whole thread and the pane scrolls as
          a page again instead of scrolling here. */}
      <div
        ref={river}
        onScroll={(event) => {
          following.current = isAtBottom(event.currentTarget);
          if (isNearTop(event.currentTarget)) loadOlder();
        }}
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-[calc(40px+var(--ws-thread-top-inset,0px))]"
      >
        {history.isFetchingNextPage && <RowSkeleton />}
        {messages.isPending && [0, 1, 2].map((i) => <RowSkeleton key={i} />)}
        {messages.isError && (
          <ErrorState
            error={messages.error}
            fallback="Couldn't load this conversation."
            onRetry={() => messages.refetch()}
          />
        )}
        {messages.isSuccess && items.length === 0 && (
          <ThreadWelcome conversation={conversation} group={group} />
        )}

        {days.map((day, dayIndex) => (
          <Fragment key={day.key}>
            {/* The streak began around here — the notice woven at its day. */}
            {streakAt === dayIndex && streakNotice}
          {/* 24 between the separator and the first run, and between runs. */}
          <section className="flex flex-col gap-6">
            {day.label && (
              <p className="text-center text-[16px] font-medium leading-6 text-white/60">
                {day.label}
              </p>
            )}

            {/* A RUN is consecutive messages from one sender, and the reason
                the rhythm is two numbers rather than one: 16 inside a run, 24
                between runs and under the separator. Both nodes lay the river
                out that way, and it is what makes a burst of three read as one
                turn in the conversation. */}
            {groupBySender(day.messages).map((run) => (
              <div key={run.key} className="flex flex-col gap-4">
                {/*
                  WHO SAID IT lives INSIDE the first bubble of the run now
                  (`showSender` — see MessageRow's senderHeader): the name
                  floating above the run sat visibly apart from its message
                  (ogazboiz, 2026-09-28), and inside the bubble is where
                  WhatsApp settles it. Once per run is still once per name —
                  a run is consecutive messages from one sender.
                */}
                {run.messages.map((message, index) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    mine={Boolean(me.data && message.senderId === me.data.id)}
                    group={group}
                    canModerate={Boolean(manageable.get(message.senderId))}
                    moderatorName={moderatorNameOf(message.moderatedBy)}
                    onModerate={(target) => moderate.mutate(target.id)}
                    sender={senders.get(message.senderId) ?? null}
                    showSender={index === 0}
                    senderRole={roleOf(run.senderId)}
                    roomCardSlot={roomCardSlot}
                    onReply={setReplyTo}
                    onJump={jumpTo}
                    nameOf={nameOf}
                    flash={flashId === message.id}
                    onOpenSnap={openSnap}
                    openingSnap={openingSnapId === message.id}
                    onEdit={setEditing}
                    onRemove={(target) => remove.mutate(target.id)}
                  />
                ))}
              </div>
            ))}
          </section>
          </Fragment>
        ))}

        {/*
          THE STREAK NOTICE is woven at its start day above (see `streakAt`), the
          way Snapchat drops a system line into the thread at the moment it
          happened — so it stays put instead of trailing the newest message. This
          is only the FALLBACK foot position, for when the start day lands after
          every loaded message (or the expiry is missing and no day can anchor
          it). The live day count lives in the header's flame, not here.
        */}
        {streakAt === days.length && streakNotice}
      </div>

      <Composer
        conversationId={conversation.id}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        replyName={replyTo ? nameOf(replyTo.senderId) : ""}
        members={mentionable}
        meId={me.data?.id}
        conversationKind={conversation.kind}
        silenced={silenced}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSaveEdit={(text) => {
          const target = editing;
          if (!target) return;
          edit.mutate(
            { messageId: target.id, text },
            { onSuccess: () => setEditing(null) }
          );
        }}
        savingEdit={edit.isPending}
      />

      {group && (
        <MembersSheet
          conversation={conversation}
          open={membersOpen}
          onClose={() => setMembersOpen(false)}
          meId={me.data?.id}
          myRole={myRole}
        />
      )}

      {/* EVERY FIELD CREATING A GROUP ASKS FOR, editable afterwards — name,
          description, picture and visibility. It used to be the title alone,
          so a group could be created public and never changed, or described
          once and never again (ogazboiz: "inside a group there is suppose to
          be a place where we can edit this settings"). */}
      <GroupSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        conversation={conversation}
      />

      {/* "Edit group title" — `PATCH /conversations/:id { title }`, owner only,
          which the service enforces. 80 characters is the contract's cap, so
          the field stops there rather than letting the request be rejected. */}
      <Sheet open={renaming} onClose={() => setRenaming(false)} title="Edit group title">
        <RenameGroupForm
          current={conversation.title ?? ""}
          busy={rename.isPending}
          onSubmit={(title) =>
            rename.mutate(title, { onSuccess: () => setRenaming(false) })
          }
        />
      </Sheet>

      {/*
        "Delete Chat" is DELETE FOR ME, and the copy says so.

        It is reversible — a new message brings the thread back — so nothing
        here says "this cannot be undone", which is what a delete dialog
        normally says and would be a lie. What it does say is the part people
        actually get wrong: the other person keeps everything.
      */}
      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Remove this chat?">
        <p className="text-[13px] leading-5 text-body">
          It leaves your inbox and you stop seeing what was said before now.{" "}
          {conversation.peer?.displayName ?? "They"} keeps the whole conversation. If they
          message you again the chat comes back, carrying only what arrives after.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setDeleting(false)}>
            Keep it
          </Button>
          <Button
            className="flex-1"
            loading={removeChat.isPending}
            onClick={() =>
              removeChat.mutate(conversation.id, {
                onSuccess: () => {
                  setDeleting(false);
                  onBack();
                },
              })
            }
          >
            Remove
          </Button>
        </div>
      </Sheet>

      {/* Leaving is not undoable from here — rejoining needs a member to add
          you back, or a public group's link — so it asks first. */}
      <Sheet open={leaving} onClose={() => setLeaving(false)} title="Leave group?">
        <p className="text-[13px] leading-5 text-body">
          You will stop receiving messages from {conversation.title ?? "this group"}. A member
          can add you back.
          {isOwner &&
            " You own it, so it passes to its longest-standing admin, or to its longest-standing member if it has no admins."}
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setLeaving(false)}>
            Stay
          </Button>
          <Button
            className="flex-1"
            loading={leave.isPending}
            onClick={() => {
              if (!me.data) return;
              leave.mutate(me.data.id, {
                onSuccess: () => {
                  setLeaving(false);
                  onBack();
                },
              });
            }}
          >
            Leave
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/**
 * The one field behind "Edit group title".
 *
 * Its own component so the input's draft state is created fresh on every
 * opening — the sheet is only mounted while open, so there is no stale value to
 * reset and no effect needed to reset it.
 */
function RenameGroupForm({
  current,
  busy,
  onSubmit,
}: {
  current: string;
  busy: boolean;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState(current);
  const valid = title.trim().length > 0 && title.trim() !== current.trim();
  return (
    <div>
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && valid && onSubmit(title)}
        maxLength={80}
        placeholder="Group title"
        className="ws-field w-full px-4 py-2.5 text-[14px] text-white outline-none placeholder:text-white/40"
      />
      <Button
        className="mt-4 w-full"
        disabled={!valid}
        loading={busy}
        onClick={() => onSubmit(title)}
      >
        Save
      </Button>
    </div>
  );
}

/**
 * A THREAD NOBODY HAS SPOKEN IN YET — node 76:8216.
 *
 * ─── WHY IT IS NOT `EmptyState` ──────────────────────────────────────────────
 * The shared component draws its contents inside `ws-inset` — a `black/35`
 * panel — so on a `#121214` pane it rendered as a darker slab with different
 * corners from everything around it: a second black in the middle of the
 * thread. The file draws NO panel. It is centred text on the pane's own ground
 * with one pill under it, which is why it reads as the room being empty rather
 * than as a card that failed to load.
 *
 * ─── THE FILE'S NUMBERS ──────────────────────────────────────────────────────
 * A 352-wide column, centred, gap 16, holding a gap-8 column and then the
 * button:
 *
 *   · "Welcome!" at Roboto Bold 24/32 with 0.01em of tracking, `#FFFFFF`
 *   · the body at 16/24 centred in 50% white
 *   · `Say hello 👋` — 6px/16px of padding at a full round over `white/5`,
 *     the words at 80% white and the emoji at its own colour
 *
 * ─── WHAT THE BUTTON DOES ────────────────────────────────────────────────────
 * It SENDS the wave, rather than typing it into the composer for you to send
 * again. A control called "Say hello" that only fills a field is a control that
 * did not do the thing it named. It goes through `useSendMessage` — the same
 * hook and the same cache as the composer below, never a second send path — so
 * the message lands in the thread and the empty state disappears with it.
 *
 * ─── THE COPY IS THE FILE'S FOR A GROUP AND HONEST FOR A 1:1 ─────────────────
 * "Your house is created…" is written for a house somebody just made. A direct
 * chat was not created by anybody and has no members to invite, so it says the
 * one true thing instead.
 */
function ThreadWelcome({
  conversation,
  group,
}: {
  conversation: Conversation;
  group: boolean;
}) {
  const send = useSendMessage(conversation.id);
  const gate = useGate();
  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <div className="flex w-[352px] max-w-full flex-col items-center gap-4 text-center">
        <div className="flex flex-col items-center gap-2">
          <p className="text-[24px] font-bold leading-8 tracking-[0.01em] text-white">Welcome!</p>
          <p className="text-[16px] leading-6 text-white/50">
            {group
              ? "Your house is created. Start the conversation or invite new members to get things moving."
              : `Say hello to ${conversation.peer?.displayName ?? conversation.peer?.username ?? "them"} — nobody has said anything yet.`}
          </p>
        </div>
        <button
          type="button"
          disabled={send.isPending}
          onClick={() => gate(() => send.mutate({ text: "👋" }))}
          className="ws-press flex items-center gap-2.5 rounded-full bg-white/5 px-4 py-1.5 text-[16px] leading-6 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          <span className="text-white/80">Say hello</span>
          <span aria-hidden>👋</span>
        </button>
      </div>
    </div>
  );
}

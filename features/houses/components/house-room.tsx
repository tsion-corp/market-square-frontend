"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRoomChatSignal } from "@/features/streams/hooks/use-room-chat-signal";
import { useAppointModerator, useGrantEndRoom, useRoomModerators } from "@/features/streams/lib/moderators";
import { AddModeratorSheet } from "@/features/houses/components/add-moderator-sheet";
import { profileHref } from "@/lib/profile-href";
import { atHandle } from "@/lib/handle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Room } from "livekit-client";
import { Button } from "@/components/ui/button";
import { AvatarStack } from "@/components/ui/avatar-stack";
import { ErrorState } from "@/components/ui/states";
import { Sheet } from "@/components/ui/sheet";
import { DestructiveConfirmSheet } from "@/components/ui/destructive-confirm-sheet";
import { IconLink, IconX } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useGate } from "@/hooks/use-gate";
import { useAuth } from "@/hooks/use-auth";
import { useRoomSession } from "@/lib/room-session-store";
import { useMe } from "@/hooks/use-me";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getRoom, subscribeRoom } from "@/features/streams/lib/live-room";
import { baseIdentity, participantLabel, type StageSlot } from "@/features/streams/lib/stage";
import { useStageSlots } from "@/features/streams/hooks/use-stage-slots";
import { useLiveReactions } from "@/features/streams/hooks/use-live-reactions";
import {
  useEndStream,
  useMySpeakerRequest,
  useRequestToSpeak,
  useResolveSpeakerRequest,
  useSpeakerRequests,
  useSeatedSpeakers,
  useStream,
} from "@/features/streams/hooks/use-streams";
import type { Ingest, Stream } from "@/features/streams/lib/types";
import {
  GRID_CELLS,
  RoomPeopleSection,
  type RoomPerson,
} from "@/features/houses/components/room-people";
import { RoomRosterPanel } from "@/features/houses/components/room-roster-panel";
import { ChatPanel } from "@/features/streams/components/chat-panel";
import { opensAtLabel } from "@/lib/format";
import { groupRoomCode, roomCodeVisible } from "@/lib/room-code";
import { Backstage } from "@/features/houses/components/backstage";
import { CaptionRail } from "@/features/houses/components/caption-rail";
import { CopyRow, CopyCodeRow, CopyCodeChip } from "@/features/houses/components/copy-row";
import { HandTray } from "@/features/houses/components/hand-tray";
import { HouseControls } from "@/features/houses/components/house-controls";
import { HouseHeader } from "@/features/houses/components/house-header";
import { RoomDock } from "@/features/houses/components/room-dock";
import { RoomPhoneBar } from "@/features/houses/components/room-phone-bar";
import { RoomReactions, useRoomReactions } from "@/features/houses/components/room-reactions";
import { GiftBursts, useGiftBursts } from "@/features/streams/components/gift-bursts";
import { GiftSheet, type GiftRecipient } from "@/components/ui/gift-sheet";
import { giftsArePriced } from "@/lib/gifts";
import { multiplyKash } from "@/lib/kash-amount";
import { useSendTip, recipientLeftTheRoom , tipAlreadyInFlight , recipientCannotHoldKash , GIFT_PHASE_SAYS } from "@/features/tips";
import { CoinBuySheet, insufficientCoins } from "@/features/gifts";

import { useCoinBalance } from "@/features/gifts";
import type { LiveGift } from "@/lib/gifts";
import { SpeakerRequestPanel } from "@/features/houses/components/speaker-request-panel";
import { OpenHouseSheet } from "@/features/houses/components/open-house-sheet";
import { PersonSheet, type PersonTarget } from "@/features/houses/components/person-sheet";
import { InviteBannerDock } from "@/features/houses/components/invite-banner";
import { useHostStageTools } from "@/features/houses/hooks/use-host-stage-tools";
import { useAudience, type AudienceMember } from "@/features/houses/hooks/use-audience";
import { useHouseAnnouncer } from "@/features/houses/hooks/use-house-announcer";
import { useHouseAudio } from "@/features/houses/hooks/use-house-audio";
import { ANNOUNCE_STABLE_MS } from "@/features/houses/lib/audio-levels";
import { houseShareUrl, houseTopic, isHouse } from "@/features/houses/lib/house";
import { parseParticipantMeta, participantName } from "@/features/houses/lib/participant-meta";
import type { MentionableMember } from "@/lib/mentionable-members";
import {
  getMutes,
  getServerMutes,
  setMutes,
  subscribeMutes,
  toggleMute as toggleMuteSet,
} from "@/features/houses/lib/muted-for-me";
import {
  SEAT_AVATAR,
  SEAT_COUNT,
  SEAT_POSITIONS,
  buildSeating,
  seatsFull,
} from "@/features/houses/lib/seating";
import { sq } from "@/lib/square-path";
import { IconChevronRight } from "@/components/ui/icons";
import { roomFailureCopy } from "@/lib/room-connection-copy";
import { roomEntryReady } from "@/lib/room-session/entry";
import { roomStagePanel } from "@/lib/room-session/presence";
import type { StageAction } from "@/lib/stage-recovery";
import { newestRoomChat, unreadRoomChat } from "@/lib/room-chat-unread";
import { useChat } from "@/features/streams/hooks/use-chat";

/**
 * A house: eight seats round a table, an audience below, and no camera
 * anywhere in the tree.
 *
 * The direction is THE TABLE. Speakers sit in a ring of equal places; the
 * empty chair is both the invitation and the raise-hand control; the audience
 * is a real, tappable band rather than a number. Audio only, permanently — for
 * the host as much as for a guest, and not as a degraded fallback.
 *
 * Almost none of the machinery below is new. The LiveKit room, the one-room
 * registry, the stage model, the speaker-request flow (ask → host approves →
 * the grant lands on the connection the guest already has), the moderation
 * calls and the reaction channel are all the stream slice's, reused as they
 * are. What Houses adds is a different SEATING of the same facts, plus one
 * boolean threaded through the two publish hooks that makes the camera
 * structurally absent rather than merely unused.
 */
interface SlotProps {
  /** Composed in components/layout — slices never import each other. */
  followSlot: (username: string) => React.ReactNode;
  /**
   * The roster of the HOUSE GROUP this room belongs to — the file's "House
   * Members", which is a different list from the audience: a member may not be
   * here, and somebody here may not be a member.
   *
   * A slot rather than an import, because the roster is a CONVERSATION and
   * slices never import each other. It renders nothing when the room has no
   * house group (one opened from the street belongs to none), so the section
   * simply does not appear rather than appearing empty.
   */
  /**
   * The HOUSE MEMBERS grid — and ONLY that, now.
   *
   * The house's NAME and its partner COUNT used to come through here too,
   * read from the conversation. They no longer do: `GET /streams/:id` carries
   * a `house` doorplate inline, so the header names the house for anybody who
   * can see the room. That is the whole point — the conversation read is
   * membership-gated, so the header worked only for people already inside, and
   * "Join House" had nothing to name for exactly the person it is aimed at.
   *
   * The ROSTER is still a conversation read and still gated, which is correct:
   * who is in a house is the members' business. So this stays a slot (slices
   * never import each other) and the grid is simply absent for a non-member,
   * while the name and the count are not.
   */
  /**
   * WHO MAY COME IN, for a private room that belongs to no house.
   *
   * A slot because the guest list is a STREAMS read and this is the houses
   * slice; slices never import each other. Rendered in the share sheet, beside
   * the code and the link, because that is where a host goes when they want
   * somebody to join — and because the code and the link are not permission,
   * which is the thing a host has to learn in the same place they find them.
   */
  guestsSlot?: (streamId: string) => React.ReactNode;
  houseSlot?: (
    conversationId: string,
    stage: {
      /**
       * Profile ids on stage right now. House Members EXCLUDES them: a person
       * cannot be in two of the room's three lists at once, and the file draws
       * Speakers, House Members and Audience as three disjoint sets.
       */
      speakerIds: ReadonlySet<string>;
      /**
       * User ids CONNECTED to the room and listening. House Members shows only
       * the members in this set: belonging to the house is not being here, and
       * a roster drawn as if it were put absent members in the room.
       */
      presentIds: ReadonlySet<string>;
      /**
       * Reports the roster's profile ids back to the room, which is what lets
       * the AUDIENCE stay external — the people listening who are not members
       * of this house. Without it a member who is listening appears twice.
       */
      onRoster: (ids: ReadonlySet<string>) => void;
      /**
       * Opens the roster panel (369:8741) over the chat column with this list.
       *
       * The panel lives in the ROOM, because it takes the room's right column —
       * but House Members is the slot's list and the room never sees it. So the
       * slot hands the people up when its "View all" is pressed, rather than
       * the room reaching down for a roster it is not allowed to fetch.
       */
      onViewAll: (title: string, people: RoomPerson[]) => void;
      /** Opens a listening member's person sheet — the same sheet the Audience opens. */
      onOpen: (userId: string) => void;
      /** Members the host has invited up and who have not answered. Empty for anyone but the host. */
      invitedIds: ReadonlySet<string>;
    }
  ) => React.ReactNode;
  /**
   * The wink + follow pair on a person's card (node 169:13368). A slot, because
   * both are the profile slice's actions and slices never import each other.
   */
  personActionsSlot?: (
    username: string,
    variant?: "compact" | "labelled"
  ) => React.ReactNode;
  /**
   * "Give a tip" — node 121:10996, the AUDIENCE's left-hand pill in the bottom
   * bar, where the host has Record Gist.
   *
   * A slot because tipping is the tips slice's flow and slices never import
   * each other. It is handed the room and its host, which is the tip's
   * recipient; the control renders nothing on your own room or where the
   * service refuses the recipient, so the host never sees it either way.
   */
  tipSlot?: (streamId: string, owner: Stream["owner"]) => React.ReactNode;
  /**
   * Joining the house group — `POST /conversations/:id/join`.
   *
   * A slot because a house group is a CONVERSATION and slices never import
   * each other. The room decides WHETHER to offer it (a public house this
   * viewer is not in); the layout owns the mutation and its toast.
   */
  joinHouse?: { onJoin: (conversationId: string) => void; pending: boolean };
  /**
   * The room as it stands BEFORE it opens.
   *
   * A slot because the product's drawing of an unopened room lives in the
   * layout layer and reaches back into this slice for its own link, so
   * importing it here would close a cycle. The room decides WHERE the card
   * sits; the layout decides what it is.
   */
  upcomingCardSlot?: (stream: Stream) => React.ReactNode;
  safetySlot: (
    username: string,
    mute: { muted: boolean; onToggle: () => void } | undefined
  ) => React.ReactNode;
  /**
   * Wraps the host's Invite to speak row for one handle, and draws nothing for
   * someone the host has blocked. A slot because the block edge is the profile
   * slice's. Hidden up front, never refused after a tap.
   */
  inviteGateSlot?: (handle: string, row: React.ReactNode) => React.ReactNode;
}

/** One frozen empty set, so an unresolved roster is not a new value per render. */
/**
 * How long the host must be off the stage before the room says so.
 *
 * A reconnect takes a few seconds and is not a departure; ten is long enough
 * to ride one out and short enough that a real exit is reported while it still
 * matters to the people deciding whether to keep talking.
 */
const HOST_AWAY_AFTER_MS = 10_000;

const EMPTY_IDS: ReadonlySet<string> = new Set();

export function HouseRoom({
  houseId,
  followSlot,
  safetySlot,
  inviteGateSlot,
  houseSlot,
  guestsSlot,
  personActionsSlot,
  tipSlot,
  joinHouse,
  upcomingCardSlot,
}: { houseId: string } & SlotProps) {
  const stream = useStream(houseId, 10_000);
  const me = useMe();
  const auth = useAuth();
  /*
    WHO THE READER IS MUST BE SETTLED BEFORE THE ROOM IS ENTERED, and there
    must BE a reader: anonymous listening is not in this build, so a signed-out
    visitor is invited to sign in rather than put into a session that can only
    fail (lib/room-session/entry.ts). A host who resolved as a listener for a
    beat is switched to host by the session when their profile lands.
  */
  const identityKnown = roomEntryReady({
    authReady: auth.ready,
    authenticated: auth.authenticated,
    meLoaded: me.data !== undefined,
    meFailed: me.isError,
  });
  const signedOut = auth.ready && !auth.authenticated;

  if (stream.isPending) return <RoomSkeleton />;

  /*
    ONLY WHEN THERE IS NOTHING TO SHOW. This polls every 10 s, and TanStack
    flips `isError` on a failed refetch while KEEPING the data — so a single
    network hiccup replaced a live room with this error screen, unmounting the
    room and dropping its call until the next poll brought it back ("it say
    time out then it will connect back"). A room we already have stays up; the
    next poll catches up.
  */
  if (stream.isError && !stream.data) {
    return (
      <div className="mx-auto w-full max-w-[520px] px-4 py-10">
        <ErrorState
          error={stream.error}
          fallback="Couldn't open this house."
          onRetry={() => stream.refetch()}
        />
      </div>
    );
  }

  const data = stream.data;
  const isHost = me.data?.id === data.ownerId;

  // A stream that is not a house has no ring, no audience band and — the part
  // that matters — a camera. Sending it here would render a video broadcast in
  // a surface with no video code path, so it is redirected rather than
  // half-rendered.
  if (!isHouse(data)) {
    return (
      <div className="mx-auto w-full max-w-[520px] px-4 py-10 text-center">
        <p className="text-sm text-body">This is a stream, not a house.</p>
        <Link
          href={sq(`/live/${data.id}`)}
          className="ws-press mt-3 inline-flex h-8 items-center rounded-full border border-white/15 bg-white/5 px-3.5 text-xs font-semibold text-white"
        >
          Watch it instead
        </Link>
      </div>
    );
  }

  if (data.status === "ended" || data.status === "cancelled") return <ClosedHouse stream={data} />;

  if (data.status === "scheduled") {
    return isHost ? (
      <HostScheduled stream={data} followSlot={followSlot} safetySlot={safetySlot} inviteGateSlot={inviteGateSlot} tipSlot={tipSlot} upcomingCardSlot={upcomingCardSlot} />
    ) : (
      <NotOpenYet stream={data} upcomingCardSlot={upcomingCardSlot} />
    );
  }

  return (
    <LiveHouse houseSlot={houseSlot} personActionsSlot={personActionsSlot} tipSlot={tipSlot} joinHouse={joinHouse}
      key={data.id}
      stream={data}
      isHost={isHost}
      identityKnown={identityKnown}
      signedOut={signedOut}
      followSlot={followSlot}
      safetySlot={safetySlot}
      inviteGateSlot={inviteGateSlot}
    />
  );
}

/* ------------------------------------------------------------------ states */

/**
 * The skeleton draws the EIGHT EMPTY CHAIRS.
 *
 * That is what a house is, so showing it immediately is truthful rather than
 * decorative — and it removes the layout jump a spinner would create when the
 * ring lands. There is no spinner in the ring at any point in this feature.
 */
function RoomSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[520px] bg-chrome" aria-busy="true">
      <div className="px-4 pb-3 pt-3">
        <div className="ws-skeleton h-6 w-3/5" />
        <div className="ws-skeleton mt-2 h-3 w-2/5" />
      </div>
      <EmptyRing />
    </div>
  );
}

/** The ring at rest: eight dashed places, in position, at full size. */
function EmptyRing() {
  return (
    <div className="px-5 pb-4 pt-6">
      <ul aria-label="Speakers" className="relative mx-auto aspect-square w-full max-w-[340px]">
        {SEAT_POSITIONS.map((point, index) => (
          <li
            key={index}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/[0.22]"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              height: SEAT_AVATAR,
              width: SEAT_AVATAR,
            }}
          />
        ))}
      </ul>
    </div>
  );
}


function HostScheduled({
  stream,
  followSlot,
  houseSlot,
  guestsSlot,
  personActionsSlot,
  safetySlot,
  inviteGateSlot,
  tipSlot,
  upcomingCardSlot,
}: {
  stream: Stream;
  followSlot: SlotProps["followSlot"];
  safetySlot: SlotProps["safetySlot"];
  inviteGateSlot?: SlotProps["inviteGateSlot"];
  houseSlot?: SlotProps["houseSlot"];
  guestsSlot?: SlotProps["guestsSlot"];
  personActionsSlot?: SlotProps["personActionsSlot"];
  tipSlot?: SlotProps["tipSlot"];
  upcomingCardSlot?: SlotProps["upcomingCardSlot"];
}) {
  const [ingest, setIngest] = useState<Ingest | null>(null);
  const [micId, setMicId] = useState("");
  // Once the host opens the house, the stream poll flips it to `live` within
  // ten seconds and HouseRoom re-renders into LiveHouse. Holding the ingest
  // here means the publisher connects on the first render after that, with the
  // microphone the host just checked, rather than waiting for another round
  // trip.
  const [opened, setOpened] = useState(false);
  // The host chose to open a scheduled room ahead of its time, which takes them
  // to the soundcheck rather than opening anything on its own.
  const [openNow, setOpenNow] = useState(false);
  if (opened && ingest) {
    return (
      <LiveHouse houseSlot={houseSlot} personActionsSlot={personActionsSlot} tipSlot={tipSlot}
        // go-live has returned, so the host IS live — our cached stream object
        // just has not caught up. Rendering from the ingest already in hand
        // opens their microphone now rather than on the next ten-second poll,
        // which is the difference between "I opened a gist room" and "did that
        // work?".
        stream={{ ...stream, status: "live" }}
        isHost
        identityKnown
        ingest={ingest}
        micId={micId}
        followSlot={followSlot}
        safetySlot={safetySlot}
        inviteGateSlot={inviteGateSlot}
      />
    );
  }
  /*
    A ROOM SCHEDULED FOR LATER IS NOT A ROOM ABOUT TO OPEN.

    This used to render Backstage for every scheduled room, so a host who set a
    time for Saturday was dropped straight into the soundcheck — a screen whose
    only action is "open the gist room" — the instant they finished scheduling
    it (ogazboiz: "when i schedule a gistroom why is it telling me to open gist
    room"). It also meant they never saw the room they had just scheduled.

    Backstage belongs at the moment of opening. Before that the host gets the
    room as it stands: what it is about, when it opens, and the countdown —
    with opening it early available but deliberately secondary.
  */
  if (!opened && !openNow && startsLater(stream)) {
    return (
      <HostWaiting
        stream={stream}
        onOpenNow={() => setOpenNow(true)}
        upcomingCardSlot={upcomingCardSlot}
      />
    );
  }

  return (
    <Backstage
      stream={stream}
      onOpened={(freshIngest, chosenMic) => {
        setIngest(freshIngest);
        setMicId(chosenMic);
        setOpened(true);
      }}
    />
  );
}

/**
 * Is this room's time still in the future?
 *
 * Read on RENDER, which is allowed here for the same reason the room's own
 * clocks are: the stream poll re-renders this page every ten seconds, so the
 * answer refreshes on its own and a host watching the countdown reach zero
 * lands on Backstage without touching anything. A room with no time on it is
 * not "later" — it was opened with "Now" and belongs in the soundcheck.
 */
function startsLater(stream: Stream): boolean {
  if (!stream.scheduledAt) return false;
  const at = new Date(stream.scheduledAt).getTime();
  return Number.isFinite(at) && at > Date.now();
}

/**
 * The host's view of their own room before it is due — the counterpart to
 * `NotOpenYet`, which is what everybody else sees.
 *
 * It answers the two questions the host actually has (is it saved, and when
 * does it open) and offers the one thing they might genuinely want early: to
 * open it now. Opening is a real decision, not the default, so it is the
 * secondary control and says plainly that it opens the room for everyone.
 */
function HostWaiting({
  stream,
  onOpenNow,
  upcomingCardSlot,
}: {
  stream: Stream;
  onOpenNow: () => void;
  upcomingCardSlot?: SlotProps["upcomingCardSlot"];
}) {
  return (
    <div className="mx-auto w-full max-w-[520px] bg-chrome">
      <div className="px-4 pb-3 pt-4">
        <h1 className="ws-display text-[22px] leading-7">{houseTopic(stream)}</h1>
        <p className="ws-meta mt-2">
          {stream.scheduledAt ? opensAtLabel(stream.scheduledAt) : "Scheduled"}
        </p>
      </div>

      {/* THE ROOM, AS THE REST OF THE PRODUCT DRAWS IT (1295:140164).
          It used to be the eight dashed chairs, which on a room that has not
          opened draw eight ABSENCES — a screen that reads as broken rather
          than as waiting. The ring still belongs to the SKELETON, where a
          room's own shape is the honest thing to hold the space with. */}
      {upcomingCardSlot && <div className="px-4 pt-2">{upcomingCardSlot(stream)}</div>}

      <div className="px-4 pb-10 pt-6 text-center">
        <p className="ws-meta">
          It waits under Upcoming Gistrooms. We will remind you when it is time to open it.
        </p>
        {/* The code, for reading aloud or writing down. Grouped for the eye
            only — the service stores and matches it unseparated. A room
            without one is simply shared by link, so nothing is said here. */}
        {stream.roomCode && (
          <p className="ws-meta mt-3">
            Room code{" "}
            <span className="tnum font-semibold tracking-[0.08em] text-white">
              {groupRoomCode(stream.roomCode)}
            </span>
          </p>
        )}
        <Button variant="secondary" size="sm" className="mt-5" onClick={onOpenNow}>
          Open it now instead
        </Button>
      </div>
    </div>
  );
}

function NotOpenYet({
  stream,
  upcomingCardSlot,
}: {
  stream: Stream;
  upcomingCardSlot?: SlotProps["upcomingCardSlot"];
}) {
  return (
    <div className="mx-auto w-full max-w-[520px] bg-chrome">
      <div className="px-4 pb-3 pt-4">
        <h1 className="ws-display text-[22px] leading-7">{houseTopic(stream)}</h1>
        <p className="ws-meta mt-2">
          {stream.owner ? `${stream.owner.displayName} · ` : ""}Not open yet
        </p>
        {/* A listener waiting on a PUBLIC room can read the code out to a
            friend before it opens. Never on a private one — see
            `roomCodeVisible`. */}
        {roomCodeVisible(stream, false) && stream.roomCode && (
          <p className="ws-meta mt-1">
            <CopyCodeChip code={stream.roomCode} />
          </p>
        )}
      </div>
      {/* The same card the host waits on, for the same reason. */}
      {upcomingCardSlot && <div className="px-4 pt-2">{upcomingCardSlot(stream)}</div>}
      <p className="px-4 pb-10 pt-6 text-center text-[13px] leading-5 text-meta">
        This house has not opened. When it does, you will be able to listen and ask to speak.
      </p>
    </div>
  );
}

function ClosedHouse({ stream }: { stream: Stream }) {
  const [reopening, setReopening] = useState(false);
  const gate = useGate();
  return (
    <div className="mx-auto w-full max-w-[520px] bg-chrome">
      <div className="px-4 pb-3 pt-4">
        {/* The header keeps the topic, so the page is still ABOUT something
            rather than a tombstone. */}
        <h1 className="ws-display text-[22px] leading-7">{houseTopic(stream)}</h1>
      </div>
      <div className="px-4 py-10 text-center">
        <p className="text-[15px] font-bold text-heading">This house has closed.</p>
        <p className="ws-meta mt-2">
          {stream.owner ? `Hosted by ${stream.owner.displayName}` : "Closed"}
        </p>
        {/* No replay surface. Recording is not provisioned, MARKET_FLAGS.replays
            is off, and a recording is a consent and moderation surface rather
            than a free win — so nothing here promises one. */}
        <Button
          variant="secondary"
          size="sm"
          className="mt-5"
          onClick={() => gate(() => setReopening(true))}
        >
          Open a gist room about this
        </Button>
      </div>
      {stream.owner && (
        <Link
          href={profileHref(stream.owner)}
          className="ws-row flex items-center gap-3 px-4 py-3.5 text-[13px] font-semibold text-body"
        >
          Visit {atHandle(stream.owner.username) ?? stream.owner.displayName}
        </Link>
      )}
      <OpenHouseSheet
        open={reopening}
        onClose={() => setReopening(false)}
        initialTopic={houseTopic(stream)}
      />
    </div>
  );
}

/* -------------------------------------------------------------- the room */

type RoomState = "connecting" | "live" | "reconnecting" | "failed" | "duplicate";

function LiveHouse({
  stream,
  isHost,
  identityKnown,
  signedOut = false,
  ingest: initialIngest = null,
  micId = "",
  followSlot,
  safetySlot,
  inviteGateSlot,
  houseSlot,
  guestsSlot,
  personActionsSlot,
  tipSlot,
  joinHouse,
}: {
  stream: Stream;
  isHost: boolean;
  /** Signed in and `/me` has settled, so the room may be entered (lib/room-session/entry.ts). */
  identityKnown: boolean;
  /** No account: the room is not entered, and the reader is invited to sign in. */
  signedOut?: boolean;
  ingest?: Ingest | null;
  micId?: string;
} & SlotProps) {
  const router = useRouter();
  const gate = useGate();
  const me = useMe();
  const { message, announce } = useHouseAnnouncer();
  /*
    THE PHONE IS A DIFFERENT FRAME, not a narrower desktop — 1285:92794.

    Below `md` the file draws one column with the room's chat and roster
    reached from a bottom bar rather than stacked under the grid, so two
    surfaces here are SHEETS on a phone and columns from `md`. The `md:`
    classes carry most of that; this is for the two places a class cannot
    decide — which container the one roster panel mounts into, and whether
    the chat opens as a dialog. The same query the stylesheet is on.
  */
  const phone = useMediaQuery("(max-width: 767px)");

  /* ---- the one connection ------------------------------------------- */

  /*
    THIS VIEW DOES NOT OWN THE CONNECTION.

    It used to: the publisher, the listener's connect effect, the stage and
    the remote audio all lived here, so unmounting the page — Back, a DM, a
    profile — hung up the call. The shell's RoomSessionProvider
    (components/layout/room-session.tsx) owns all of it now. This view asks the
    session to ENTER, reads what the session says, and calls its verbs.
    Unmounting it disconnects nothing; entering the same room again is a no-op.
  */
  const session = useRoomSession();
  const enterRoom = session.enter;
  const role = isHost ? "host" : "listener";
  // The host who just pressed Open in Backstage hands in the go-live ingest:
  // their own fresh open, the only connect that publishes an open mic.
  const ingestUrl = initialIngest?.url ?? "";
  const ingestToken = initialIngest?.roomToken ?? "";
  useEffect(() => {
    if (!identityKnown) return;
    enterRoom(
      stream.id,
      role,
      ingestUrl && ingestToken
        ? { token: { url: ingestUrl, token: ingestToken }, fresh: true, preferredMic: micId || undefined }
        : undefined
    );
  }, [enterRoom, identityKnown, stream.id, role, ingestUrl, ingestToken, micId]);

  const here = session.state.target?.streamId === stream.id;
  /** Somebody asked to come in here while the session holds another room. */
  const askingToSwitch = session.state.status === "conflict" && session.state.pending?.streamId === stream.id;
  /** …and the room being left is the reader's OWN: switching closes it. */
  const hostingOther = askingToSwitch && session.state.target?.role === "host";
  const connection = here ? session.state.connection : "idle";

  /*
    Having been in this room and no longer being in it — the reader left, or
    it was taken away — is not "connecting". Adjusted during render, React's
    pattern for state that follows a prop.
  */
  const [wasHere, setWasHere] = useState(false);
  if (here && !wasHere) setWasHere(true);
  /*
    …and nor is a "Leave your gist room?" question that went away unanswered.
    The other room can be hung up from the mini-player on THIS page, end, or
    be taken by another tab while the sheet is open; the question is cleared
    with it, the session is free, and this view — which only enters on mount —
    sat on "Connecting…" with nothing to press. It offers Join instead.
  */
  const [wasAsked, setWasAsked] = useState(false);
  if (askingToSwitch && !wasAsked) setWasAsked(true);
  const gone = (wasHere || wasAsked) && !here && !askingToSwitch;

  /*
    AN UNANSWERED QUESTION GOES WITH THE VIEW THAT ASKED IT. Pressing Back on
    "Leave your gist room?" unmounts this view without choosing, and a question
    left standing kept the session in `conflict` everywhere else. Only a
    question about THIS room is cleared.
  */
  const dismissConflict = session.dismissConflict;
  useEffect(() => {
    if (!askingToSwitch) return;
    return () => dismissConflict(stream.id);
  }, [askingToSwitch, dismissConflict, stream.id]);

  /**
   * The room, read from the registry rather than the session, so the ONE-Room
   * guard is also the one thing this view trusts about which Room exists.
   */
  const room = useSyncExternalStore(
    useCallback((listener) => subscribeRoom(stream.id, listener), [stream.id]),
    useCallback(() => getRoom(stream.id), [stream.id]),
    () => null as Room | null
  );

  const state: RoomState =
    connection === "live"
      ? "live"
      : connection === "reconnecting"
        ? "reconnecting"
        : connection === "failed"
          ? "failed"
          : connection === "duplicate"
            ? "duplicate"
            : "connecting";

  /* ---- who is at the table ------------------------------------------ */

  const slots = useStageSlots(room, stream.ownerId);

  /**
   * THE ROOM'S THREE LISTS ARE DISJOINT, and these two sets are what keeps
   * them that way.
   *
   * `speakerIds` are the people on stage, keyed on the BARE user id — an
   * approved speaker's LiveKit identity is `<did>#speaker`, so comparing raw
   * identities against a roster of profile ids never matches. House Members
   * drops anyone in this set.
   *
   * `houseMemberIds` comes back from the roster slot, and the Audience drops
   * anyone in it: an audience member who is also in the house is already drawn
   * under House Members, and the file's Audience is the people listening from
   * OUTSIDE — which is exactly who a public room lets in.
   */
  const speakerIds = useMemo(
    () =>
      new Set(
        slots.map((slot) =>
          // The host's publisher token has NO user id in it — its identity is
          // the literal string `broadcaster` — so the host slot is keyed on the
          // stream's own `ownerId` instead. Without this the host matched
          // nothing in the roster and appeared under Speakers AND House
          // Members, which is two records for one person.
          slot.role === "host" ? stream.ownerId : baseIdentity(slot.identity)
        )
      ),
    [slots, stream.ownerId]
  );

  /* Our own identity, read once. See the note on `isMe` below for why the
     token cannot supply it. */
  const myId = me.data?.id;
  const myName = me.data?.displayName || me.data?.username || null;
  const myAvatar = me.data?.avatarUrl ?? null;
  const [houseMemberIds, setHouseMemberIds] = useState<ReadonlySet<string>>(EMPTY_IDS);

  /*
    The house's DOORPLATE, straight off the room — id, title, picture, member
    count, visibility, and whether this viewer is already in it. Null for a
    room opened from the street, which belongs to no house.
  */
  const house = stream.house;
  /*
    WHICH ROSTER IS OPEN OVER THE CHAT — node 369:8741.

    One piece of state for both lists, because the panel takes the same column
    and only one can be in it. Holding the PEOPLE rather than a discriminator
    is what lets House Members — a list this component is not allowed to fetch —
    open the same panel as the Audience.
  */
  const [roster, setRoster] = useState<{ title: string; people: RoomPerson[] } | null>(
    null
  );
  const openRoster = useCallback(
    (title: string, people: RoomPerson[]) => setRoster({ title, people }),
    []
  );
  const closeRoster = useCallback(() => setRoster(null), []);
  const rosterRef = useRef<HTMLDivElement | null>(null);

  /*
    THE ROOM FITS THE SCREEN FROM `xl` — measured, not assumed.

    Its height used to be `100dvh - header`, and the page scrolled by exactly
    one dock: the shell reserves the dock's row under every route, and it
    also draws an announcement band above the route when there is one. Any
    fixed subtraction is wrong the moment the chrome above changes, so the
    room measures where its own top edge lands and takes the rest of the
    viewport less the dock's row (`--ws-nav-h`). Re-measured on resize and
    whenever the document reflows (a band appearing, the header changing).
    The value is a CSS variable on the element so the sum stays in CSS.
  */
  const roomRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = roomRef.current;
    if (!el) return;
    const measure = () => {
      const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY));
      el.style.setProperty("--ws-room-top", `${top}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  /*
    BRING IT INTO VIEW WHERE THE THIRD COLUMN IS NOT A COLUMN.

    From `xl` the roster takes the chat's column and is already on screen, so
    this does nothing. Below it the aside stacks UNDER the people grid — a
    laptop at 1279 or a tablet — and "View all" opened a panel a screen and a
    half further down. The reader pressed a control and nothing appeared to
    happen, which reads as broken rather than as scrolled.

    Guarded on the breakpoint rather than run always: scrolling a panel that is
    already beside you yanks the page for no reason. `smooth` unless the reader
    has asked for less motion, in which case it jumps.
  */
  useEffect(() => {
    if (!roster) return;
    const stacked = window.matchMedia("(max-width: 1279px)").matches;
    if (!stacked) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rosterRef.current?.scrollIntoView({
      block: "start",
      behavior: still ? "auto" : "smooth",
    });
  }, [roster]);

  /*
    WHO IS ACTUALLY IN THE ROOM, off the stage.

    House Members used to be the house's whole ROSTER, so a member asleep in
    another city was drawn as a tile in this room exactly like one sitting in
    it. A 2-person room inside a 40-member house showed 40 faces. ogazboiz's
    rule: a house member appears here when they JOIN, not because they belong.

    `useAudience` is everyone connected without a publish grant, local
    participant included, keyed on the bare user id. Speakers are in
    `speakerIds` and excluded from House Members anyway, so this set is the
    whole of "present and listening". It moved above the slot call because the
    slot now needs it; hook order is unchanged from render to render.

    Stable: `useAudience` only swaps its array when membership changes, so this
    set does not churn on every render.
  */
  const audience = useAudience(room);
  const presentIds = useMemo(
    () => new Set(audience.map((member) => member.userId)),
    [audience]
  );

  // Everyone connected, seated or not: the audience band leaves speakers out,
  // so the hand tray's "Reconnecting…" reads both. Null before the room is up.
  const connectedIds = useMemo(
    () => (room ? new Set([...presentIds, ...slots.map((slot) => baseIdentity(slot.identity))]) : null),
    [room, presentIds, slots]
  );

  const seating = useMemo(() => buildSeating(slots), [slots]);
  const audio = useHouseAudio(room);

  const full = seatsFull(seating);

  /* ---- asking for the floor ------------------------------------------ */

  const asking = stream.status === "live" && !isHost;
  const mine = useMySpeakerRequest(stream.id, asking);
  const request = useRequestToSpeak(stream.id);
  const resolve = useResolveSpeakerRequest(stream.id);
  const pendingMine = mine.data?.status === "pending";

  /** The host's own view of the queue, for the counted button and the tray. */
  const hostRequests = useSpeakerRequests(stream.id, isHost && stream.status === "live");
  const handsUp = (hostRequests.data?.items ?? []).filter((item) => item.status === "pending");

  /**
   * BACKEND B4. `PATCH /streams/:id { requestsOpen }` does not exist, so this
   * is client-local and session-only: it stops THIS client offering the chair.
   * It does not stop the service accepting requests, and the tray says so.
   */
  const [requestsOpen, setRequestsOpen] = useState(true);

  /*
    On stage means the SESSION says so — approved and granted — never the row
    alone. The approved guest publishes over the connection they already
    have, with the mic OFF until they tap it.
  */
  /*
    …and only in the room the session is IN. The mic toggle is the SESSION's
    mic: drawn on a room the reader owns but is not connected to (their other
    live room, or the one they are being asked to switch to), it switched the
    mic of the room they ARE in, off screen, while this control said off.
  */
  // …or wherever a mic is actually open, seated or not: its off switch never
  // disappears ahead of the track (lib/room-session/visibility.ts).
  const onStage = here && (isHost || session.presence === "speaker" || session.micOn);
  // Approved but not (yet) seated is the stage panel's to explain, with its
  // own remedies — "Ask to speak" to somebody the host already said yes to
  // reads as the approval having been lost.
  const myRequestStatus = mine.data?.status ?? null;
  const canAsk = !isHost && !onStage && myRequestStatus !== "approved" && myRequestStatus !== "invited";

  /*
    AN APPROVED SPEAKER WHO IS NOT SIMPLY SEATED is told why and given the
    remedy: the grant on its way, the grant that never landed on this
    connection (Rejoin — a fresh token on a fresh connection), or a mic that
    would not open (Try again, which is the reader's own tap).
  */
  const stagePanel = useMemo(
    () =>
      roomStagePanel({
        here,
        isHost,
        status: myRequestStatus,
        connection,
        stageState: session.stage.state,
        error: session.stage.error,
      }),
    [here, isHost, myRequestStatus, connection, session.stage.state, session.stage.error]
  );
  const myRequestId = mine.data?.id ?? null;
  const runStageAction = (action: StageAction) => {
    if (action === "rejoin") return session.stage.rejoin();
    if (action === "retry") return session.stage.retry();
    if (!myRequestId) return;
    if (action === "request-again") {
      resolve.mutate({ requestId: myRequestId, action: "leave" }, { onSuccess: () => request.mutate() });
      return;
    }
    resolve.mutate({ requestId: myRequestId, action: "leave" });
  };

  const askReason = !requestsOpen
    ? "The host isn't taking requests right now."
    : full
      ? `All ${SEAT_COUNT} seats are taken.`
      : null;

  const ask = useCallback(() => {
    if (askReason) return;
    gate(() => request.mutate());
  }, [askReason, gate, request]);

  /**
   * `?seat=1` — the host's speaker link.
   *
   * NOT pre-approval, which needs a backend delta. It raises the arriving
   * guest's hand automatically so the host's own invitee is at the front of
   * the tray rather than lost in it, then strips the parameter so a refresh
   * does not ask again.
   */
  const seatParamUsed = useRef(false);
  useEffect(() => {
    // Read off `location` rather than `useSearchParams`, which would force this
    // whole room behind a Suspense boundary for a value that is only ever read
    // once, on mount, on the client.
    if (seatParamUsed.current || isHost || mine.isPending) return;
    if (new URLSearchParams(window.location.search).get("seat") !== "1") return;
    seatParamUsed.current = true;
    router.replace(sq(`/gist-rooms/${stream.id}`), { scroll: false });
    if (!mine.data || mine.data.status === "denied" || mine.data.status === "withdrawn") {
      request.mutate();
    }
  }, [isHost, mine.isPending, mine.data, request, router, stream.id]);

  /* ---- mute for me ---------------------------------------------------- */

  /**
   * Client-local silence, held OUTSIDE React (lib/muted-for-me.ts).
   *
   * Not `useState` plus an effect that reads storage: the stored set is not
   * state arriving late, it is state that existed before this render. Reading
   * it in an effect gives a first paint where somebody is audible and a second
   * where they are not — and for a mute that is not a layout jump, it is a
   * person you asked to silence still talking.
   */
  const mutedForMe = useSyncExternalStore(
    subscribeMutes,
    useCallback(() => getMutes(stream.id), [stream.id]),
    getServerMutes
  );


  const toggleMute = useCallback(
    (identity: string) => setMutes(stream.id, toggleMuteSet(getMutes(stream.id), identity)),
    [stream.id]
  );

  /*
    EVERYONE IN THE ROOM, FOR THE CHAT'S @ PICKER.

    The stage and the audience, which is what "in this room" means to somebody
    typing a name into the column beside them. Only people whose USERNAME we
    know can be offered — a mention is a link to a profile, and a seat with no
    handle is somebody we cannot address.
  */
  const chatMentionables: MentionableMember[] = useMemo(() => {
    const seen = new Map<string, MentionableMember>();
    for (const slot of slots) {
      const meta = parseParticipantMeta(slot.metadata);
      const username = meta?.username;
      if (!username) continue;
      /*
        THE HOST'S IDENTITY IS NOT AN ID — it is the literal string
        `broadcaster`, because their publisher token carries no user id. So
        `baseIdentity` returns "broadcaster" unchanged (there is no `#` to
        split on), and mentioning the host sent `mentions: ["broadcaster"]`,
        which is not a profile id. The service rejected the whole request and
        the sender lost their message to "Request validation failed" — the
        failure was total, not partial: one bad id and nothing was sent.

        Keyed on the stream's own `ownerId` instead, exactly as the speaker
        roster does a hundred lines below. THIS IS THE SAME BUG TWICE — the
        roster's own comment says it "is a bug this codebase has already fixed
        once", and it was fixed there and not here, because the two lists were
        built from the same slots on different days.

        A participant we cannot resolve to a real id is NOT offered. Mentioning
        them cannot work, and a name in the picker that breaks the message when
        chosen is worse than a name that was never there.
      */
      const id = slot.role === "host" ? stream.ownerId : baseIdentity(slot.identity);
      if (!id || id === "broadcaster") continue;
      seen.set(username.toLowerCase(), {
        id,
        displayName: participantName(slot.name) ?? username,
        username,
      });
    }
    for (const member of audience) {
      const username = member.meta?.username;
      if (!username) continue;
      seen.set(username.toLowerCase(), {
        id: member.userId,
        displayName: member.name || username,
        username,
      });
    }
    return [...seen.values()];
    // `stream.ownerId` is read for the host's slot, so it belongs here: a room
    // whose owner resolved late would otherwise keep a mention list built
    // before the id arrived.
  }, [slots, audience, stream.ownerId]);

  /* ---- reactions ------------------------------------------------------ */

  // A picked emoji floats over the stage the way a call reaction does, and the
  // SAME overlay draws the ones other people send — the data channel now
  // carries the glyph, so an incoming heart and an incoming 🎉 both land here.
  const roomReactions = useRoomReactions();
  /*
    ─── GIFTS, WHICH THIS ROOM DID NOT HAVE ───────────────────────────────────

    The tray and the flying burst were built for BROADCASTS and lived inline in
    `stream-room`, so a gist room had no gifts at all — only "Give a tip",
    which moves money quietly and shows the room nothing. A gift is the
    opposite act: the point of it is that everybody sees it happen and sees WHO
    sent it, which is what lets a host thank somebody without stopping to check
    a ledger. `GiftBursts` is that overlay, lifted out so both rooms draw the
    same thing from one place.

    FREE HERE, AND HONEST ABOUT IT. The tray renders unpriced: KASH pricing is
    behind `MARKET_FLAGS.liveGifts` and the paid path would pay the HOST, since
    `POST /streams/:id/gifts` hardcodes the recipient to the room's owner and
    takes no recipient at all. So a per-person gift button would name one
    person and pay another, and it is not built until the route can say who is
    being paid. What ships today is the moment, not the money.
  */
  const giftBursts = useGiftBursts();
  const payGift = useSendTip();
  const [giftsOpen, setGiftsOpen] = useState(false);
  /*
    WHO THE TRAY OPENS ON. Null when it was reached from the dock's gift
    button, which is "pick an object, then a person"; set when it was reached
    by tapping SOMEBODY, which is "pick a person, then an object". Both doors
    lead to the same tray rather than to two trays that drift.
  */
  const [giftTo, setGiftTo] = useState<string | null>(null);
  /*
    THE BALANCE, AND ONLY WHILE THE TRAY IS OPEN. It polls at 15s, and a room
    is the most expensive surface in the app already — running it for the whole
    session, per participant, to answer a question nobody is asking until they
    open the tray would undo the request work this room has just had done to
    it. `null` while closed is "not known", which the tray treats as "let the
    service decide" rather than as a shortfall.
  */
  /*
    COINS, NOT KASH — gifts are priced in Square coins now, so the number the
    tray compares against is the coin balance. Read only while the tray is
    open: a room is already the most expensive surface in the app, and a
    balance nobody is looking at is a request nobody needed.

    `null` while the service has no coins yet, which the tray reads as "not
    known" and therefore blocks nothing. The interface must not invent a
    shortfall it cannot see; only the service can refuse a spend.
  */
  const giftCoins = useCoinBalance(giftsOpen);
  /* Short of KASH mid-gift opens the top-up rather than stopping the sender —
     the TikTok shape, and the tray hands over rather than stacking dialogs. */
  const [topUpOpen, setTopUpOpen] = useState(false);
  /** How many coins the tray was short, so the buy sheet can offer exactly that. */
  const [topUpNeeded, setTopUpNeeded] = useState(0);

  const live = useLiveReactions(room, {
    onReceive: (burst, emoji, from) => roomReactions.emit(emoji, burst, from || "Someone"),
    onGift: giftBursts.receive,
  });
  // One tap, two destinations: draw it here immediately labelled "You", and
  // broadcast it under your name so the rest of the room sees who sent it —
  // the way a reaction is attributed in a Meet or WhatsApp call.
  const sendReaction = useCallback(
    (emoji: string) => {
      roomReactions.emit(emoji, 1, "You");
      live.react(emoji, 1, myName ?? "Someone");
    },
    [roomReactions, live, myName]
  );

  // One tap, two destinations, exactly as a reaction is: drawn here at once
  // labelled "You", and broadcast under your name so the rest of the room sees
  // who sent it. No money leg — see the note above the tray.
  const sendGift = useCallback(
    (gift: LiveGift, quantity: number, to: GiftRecipient | null) => {
      // The burst names BOTH ends. A gift that says only who sent it is the
      // broadcast shape, where there was only ever one person it could be for;
      // in a room where anybody can be gifted, "who it was for" is half the
      // event and is what the recipient is watching for.
      const label = to ? `You → ${to.name}` : "You";
      giftBursts.spawn(gift, quantity, label);
      live.gift(gift.id, quantity, to ? `${myName ?? "Someone"} → ${to.name}` : (myName ?? "Someone"));

      /*
        ─── AND NOW THE MONEY, WHICH THIS ROOM DID NOT MOVE UNTIL TODAY ───────

        THE SHOW HAPPENS EITHER WAY. The burst and the data-channel packet
        already went out above, unconditionally, and nothing below retracts
        them: a gift the room has seen is not un-seen because a wallet refused
        it. The broadcast makes the same call and for the same reason.

        `toProfileId` IS SENT FOR EVERY RECIPIENT INCLUDING THE HOST. The
        service exempts the host from its presence check, so naming them is
        identical to omitting the field — and special-casing the first row
        would be a second code path earning nothing.
      */
      if (!giftsArePriced(stream.status)) return;
      if (!to) return; // Nothing is charged with nobody named — see the tray.

      const amountKash = multiplyKash(gift.priceKash, quantity);
      if (!amountKash) {
        // No exact total, no charge. Rounding would bill an amount the sender
        // was never shown: three Roses is 0.03, not 0.030000000000000002.
        toast.error("That quantity can't be priced exactly.");
        return;
      }

      /*
        ─── ONE TAP, AND NOW LITERALLY ONE CALL ────────────────────────────────

        COINS ARE THE INVENTORY. ogazboiz settled it: "we are doing it the
        tiktok way you understand since no inventory". So there is no stock to
        be short of and nothing to buy before sending — the send debits
        `priceCoins x quantity` from the coin balance and that is the whole
        gesture.

        This briefly bought the shortfall first, back when a gift was something
        you held. That was the right client for THAT model and it is dead
        weight for this one: no stock read, no purchase, no second round trip.
        The shortfall idea survives, but it is now COINS and it belongs to the
        top-up sheet that already existed.

        `amountKash` is still sent and is still the gift's own price times the
        quantity. With the switch off it is what gets charged; with it on the
        service ignores it and spends coins. One body, correct in both, so
        nothing here branches on the day it flips.
      */
      /*
        ONE TOAST THAT LIVES FOR THE WHOLE SEND.

        The gift path reported no phase at all, and the tray closes on send —
        so between the tap and the money settling the sender saw NOTHING. A
        payment waiting at a wallet prompt looked exactly like a payment that
        never happened, which is the question that cost a day.

        Held open on one id so the phases replace each other rather than
        stacking, and so the final success or failure lands in the same place
        the reader is already looking. If it sits on "Confirm it in your
        wallet" then that is the truth: something is open and waiting on them.
      */
      const toastId = `gift:${stream.id}:${to.id}:${Date.now()}`;
      void payGift
        .mutateAsync({
          target: { kind: "stream", id: stream.id, recipient: null },
          amountKash,
          giftId: gift.id,
          toProfileId: to.id,
          onPhase: (phase) => {
            const says = GIFT_PHASE_SAYS[phase];
            if (says) toast.loading(says, { id: toastId });
          },
        })
        .then(() => {
          // "On its way", never "sent". Production settles `client-signed`:
          // the sender signs and the tip stays PENDING until the watcher sees
          // the transfer on-chain. Saying it landed before that is the one
          // claim this flow may not make.
          toast.success(`${gift.name} on its way to ${to.name}`, { id: toastId });
        })
        .catch((error: unknown) => {
          /*
            THEY LEFT is not a refusal of the act. The service checks live
            presence and answers 409 RECIPIENT_NOT_IN_ROOM rather than ever
            falling back to paying the host — so the sender did nothing wrong,
            the room simply moved, and the honest answer is to say so and let
            them choose again rather than to imply they were denied.
          */
          if (recipientLeftTheRoom(error)) {
            toast.error(`${to.name} left the room — nothing was charged.`, { id: toastId });
            return;
          }
          /*
            SHORT OF COINS IS AN OFFER, NOT A FAILURE.

            409 `INSUFFICIENT_COINS` carries `needed` and `balance`, so the
            top-up opens on the exact shortfall rather than a guess — on a tray
            the person is looking straight at. The SAME code and fields the
            coin purchase answers with, deliberately, so one handler covers
            both doors into the same wall.

            A refused send spends NOTHING: the debit and the tip row are one
            transaction upstream, so there is no half-charged state to explain.
          */
          /*
            A TIP THE SERVICE STILL HAS OPEN. Nothing here can finish it: the
            conflict names a `tipId` and nothing else, and no route reads a
            single tip, so there is nowhere to send the money. Paying again
            would not help — it is refused before it reaches a wallet.

            So this says what is true and what it is NOT: nothing was charged,
            and it is not something the sender did wrong.
          */
          /*
            THEIR WALLET CANNOT HOLD KASH. The service named a non-EVM address
            for the recipient leg, and signing it would send Base tokens to an
            address that cannot receive them. Refused before the wallet, so
            nothing was charged — and retrying cannot help, because it is their
            account that needs an EVM address, not this attempt that needs
            repeating.
          */
          if (recipientCannotHoldKash(error)) {
            toast.error(`${to.name} can't receive gifts yet — their wallet isn't set up for KASH. Nothing was charged.`, { id: toastId });
            return;
          }
          if (tipAlreadyInFlight(error)) {
            toast.error(`A gift to ${to.name} is still being processed — nothing was charged. Try someone else, or come back to them shortly.`, { id: toastId });
            return;
          }
          const short = insufficientCoins(error);
          if (short) {
            toast.error(`Not enough coins — ${short.needed.toLocaleString()} needed.`, { id: toastId });
            setTopUpNeeded(short.needed - short.balance);
            setTopUpOpen(true);
            return;
          }
          toast.error(error instanceof Error && error.message
              ? error.message
              : "The gift was shown, but the payment did not go through.", { id: toastId });
        });
    },
    [giftBursts, live, myName, stream.status, stream.id, payGift]
  );

  /*
    WHO CAN BE GIFTED — the host first, then everyone else in the room, and
    never yourself.

    `chatMentionables` is already exactly this roster (every seat plus every
    audience member, de-duplicated and resolved to real profile ids), which is
    why this needs no read of its own — the same reason the moderator sheet
    uses it. The host is lifted to the front because a gift with no thought
    behind it should land on the person today's route would pay anyway, which
    is what makes the picker safe to ship before the route can name anybody.

    Self is removed rather than disabled: the service refuses a self-gift
    outright ("You cannot tip yourself"), so offering it would be drawing a
    control whose only outcome is an error.

    ─── THE BADGE RULE, WHICH NOW DIFFERS BY SURFACE ────────────────────────
    ogazboiz decided a gist room may pay ANYONE in it, and the service kept
    that as its own switch rather than widening the existing one:

      verifiedAuthorsOnly          true   — POST tips, unchanged
      verifiedRoomRecipientsOnly   false  — ROOM gifts, open

    The two differ on purpose. The badge stops an impersonation account
    collecting on a byline the sender has never met, which is a POST. Here the
    sender picked a person off a live roster, in a room they are both in, that
    the host let them into, while that person is speaking — the attack barely
    exists and the rule's cost would be that most of the room can receive
    nothing.

    SO THIS PICKER IS CORRECT AS IT STANDS: no filter, nobody greyed out.
    `tipBlockedBecause(capability, recipient, "room")` reads the room flag and
    answers null for everyone, so there is nothing for this component to do.

    NOT YET IN PRODUCTION, and the difference matters. That switch is in
    service PR #308, unmerged and undeployed; prod today publishes only
    `verifiedAuthorsOnly: true` and no room flag at all. An ABSENT room flag
    means "this deployment has one switch", so rooms go on obeying the author
    rule — which is why `tipBlockedBecause` falls back rather than defaulting
    to open, and why until #308 ships a gift to an unverified person is still
    refused 403 in prod.

    IF THE ROOM FLAG IS EVER TURNED BACK ON, this picker cannot enforce it.
    `MentionableMember` is `{ id, displayName, username }` off LiveKit
    participant metadata and carries no verification; `stream.participants`
    does carry it but is a SAMPLE OF THREE, so filtering on it would silently
    offer three people and hide the rest; and `GET /profiles` takes no `ids`
    filter — passing one does not error, it returns an ordinary page of the
    directory, so hydrating participant ids would answer with STRANGERS.
    Closing rooms again therefore needs an `ids` filter first, not a change
    here.

    DO NOT SWITCH THE MONEY LEG ON UNTIL #308 IS MERGED AND RESTARTED.
  */
  const giftRecipients: GiftRecipient[] = useMemo(() => {
    const hostId = stream.owner?.id ?? null;
    const seen = new Set<string>();
    const out: GiftRecipient[] = [];
    const add = (id: string, name: string, isHost = false) => {
      if (!id || id === myId || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name, isHost });
    };
    if (hostId) add(hostId, stream.owner?.displayName || stream.owner?.username || "Host", true);
    for (const person of chatMentionables) {
      add(person.id, person.displayName || person.username, person.id === hostId);
    }
    return out;
  }, [chatMentionables, stream.owner, myId]);


  /* ---- announcements --------------------------------------------------- */

  // Seat changes. Compared against the previous render's occupants rather than
  // derived from an event, so a promotion, a demotion and a disconnect all
  // announce through one path.
  const seatedBefore = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(
      seating.seats
        .filter((seat) => seat.slot)
        .map((seat) => [seat.slot!.identity, participantName(seat.slot!.name) ?? seat.slot!.name])
    );
    const before = seatedBefore.current;
    seatedBefore.current = now;
    // The first pass is the room as we found it, not a sequence of arrivals.
    if (before === null) return;
    for (const [identity, name] of now) {
      if (!before.has(identity)) announce(`${name} is now speaking`);
    }
    for (const [identity, name] of before) {
      if (!now.has(identity)) announce(`${name} left the seat`);
    }
  }, [seating, announce]);

  // Your own lift.
  const wasOnStage = useRef(onStage);
  useEffect(() => {
    if (onStage && !wasOnStage.current) {
      announce("You're on the stage. Your microphone is off — tap it to talk.");
    }
    wasOnStage.current = onStage;
  }, [onStage, announce]);

  // An invitation to speak is announced by the session, once, wherever the
  // reader is (room-session.tsx InviteAnnouncer) — never again on this page's mount.
  const ownerName = stream.owner?.displayName || stream.owner?.username || null;

  // Your own hand.
  const handWas = useRef<string | null>(null);
  useEffect(() => {
    const status = mine.data?.status ?? null;
    const before = handWas.current;
    handWas.current = status;
    if (before === status) return;
    if (status === "pending") announce("Your hand is up.");
    else if (before === "pending" && status !== "approved") announce("Your hand is lowered.");
    // §4.10: your face returns to the audience band, the mic is dropped by
    // useStage's own teardown, and this is the ONE thing said about it. No
    // modal, and no explanation of why — the host does not owe one and the app
    // must not invent one.
    if (status === "removed" && before === "approved") {
      toast("You're back in the audience.");
    }
  }, [mine.data?.status, announce]);

  // The host's queue.
  const announcedRequests = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!isHost) return;
    if (announcedRequests.current === null) {
      announcedRequests.current = new Set(handsUp.map((item) => item.id));
      return;
    }
    const fresh = handsUp.filter((item) => !announcedRequests.current!.has(item.id));
    for (const item of fresh) announcedRequests.current.add(item.id);
    if (fresh.length === 0) return;
    const name = fresh[0].profile?.displayName ?? "Someone";
    announce(`${name} is asking to speak. ${handsUp.length} waiting.`);
  }, [isHost, handsUp, announce]);

  // The connection.
  const stateWas = useRef<RoomState | null>(null);
  useEffect(() => {
    const before = stateWas.current;
    stateWas.current = state;
    if (before === null || before === state) return;
    if (state === "reconnecting") announce("Reconnecting");
    else if (state === "live" && before === "reconnecting") announce("Connected");
    else if (state === "failed") announce("Lost connection to the gist room");
  }, [state, announce]);

  /**
   * The talking line, announced only once a voice has HELD the floor.
   *
   * The visible strip updates immediately — a sighted reader follows
   * turn-taking at conversational speed. A screen reader cannot: a live region
   * firing on every turn in a lively conversation produces a wall of "Ada.
   * Tobi. Ada. Kemi." that buries whatever is being said.
   */
  const announcedLoudest = useRef<string | null>(null);
  useEffect(() => {
    const identity = audio.loudest;
    if (!identity || identity === announcedLoudest.current) return;
    const timer = setTimeout(() => {
      const slot = slots.find((item) => item.identity === identity);
      if (!slot) return;
      announcedLoudest.current = identity;
      announce(`${participantName(slot.name) ?? slot.name} is speaking`);
    }, ANNOUNCE_STABLE_MS);
    return () => clearTimeout(timer);
  }, [audio.loudest, slots, announce]);

  /* ---- leaving --------------------------------------------------------- */

  /**
   * "Hand up · 4m" has to keep counting, and it is the only clock in the room.
   * Fifteen seconds: fast enough that the number is never visibly wrong, slow
   * enough that a room open for an hour costs 240 renders rather than 3,600.
   */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!pendingMine) return;
    const timer = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(timer);
  }, [pendingMine]);

  const [confirmLeave, setConfirmLeave] = useState(false);

  // Read off the session up here rather than inside the callback, so the memo
  // depends on the verb and not on the whole session object.
  const sessionLeave = session.leave;
  const leaveNow = useCallback(async () => {
    // The session frees a held seat or a raised hand on the way out, then
    // hangs up — the only way a listener's call ends besides the mini-player.
    await sessionLeave();
    toast("You left the gist room.", {
      duration: 5_000,
      action: { label: "Rejoin", onClick: () => router.push(sq(`/gist-rooms/${stream.id}`)) },
    });
    router.push(sq("/gist-rooms"));
  }, [sessionLeave, router, stream.id]);

  /*
    LEAVING ALWAYS ASKS. It used to ask ONCE: a `ms:house:leave-seen` flag was
    written after the first confirmation and, from then on, a single tap
    dropped the reader out of the room with no dialog at all — permanently, on
    that device, for every room they ever entered again.

    That is what ogazboiz hit. The very reason the control is becoming a small
    red disc on a phone is that it is easy to catch by accident, and a "you
    have seen this once" flag turns the second accident into a silent exit. A
    confirmation is not a tutorial to be dismissed; it guards an action that
    cannot be undone from inside the room.

    Cheap to keep: one tap on Leave or Stay. The flag and its key are deleted
    rather than left unread, so nothing can start honouring them again.
  */
  const leave = useCallback(() => setConfirmLeave(true), []);

  const endHouse = useEndStream({ successMessage: "Gist room closed" });

  /* ---- sheets ---------------------------------------------------------- */

  const [tray, setTray] = useState(false);
  // The phone's chat sheet — 1285:93095 in the bottom bar opens it.
  const [chatSheet, setChatSheet] = useState(false);
  /*
    THE CHAT'S UNREAD COUNT, on a phone only.

    The chat is a sheet here, so a message that lands while it is closed left
    no trace at all (ogazboiz, 2026-09-17). The poll is the SAME query the
    panel reads, so this shares its cache rather than adding a second one; it
    is only enabled on a phone, where the panel itself is not mounted. The
    mark is the last message the reader had on screen, not a counter, so a
    repeated poll cannot double count (lib/room-chat-unread.ts).
  */
  const chatFeed = useChat(stream.id, here && phone && stream.status === "live");
  /*
    The phone's feed reads the SAME key as the panel, so one invalidation
    refreshes both — but the panel is not mounted here, and a subscriber that
    only exists on the desktop would leave the phone on the interval alone.
    Two subscribers on one topic share the socket; the extra cost is a second
    listener in a Set.
  */
  useRoomChatSignal(stream.id, stream, here && phone && stream.status === "live");

  /*
    MODERATORS — the dock's people button and the sheet behind it.

    `moderatorIds` is UNDEFINED on a service that does not carry moderators and
    an ARRAY once it does, which is the whole feature switch: a host on an
    older service gets a dock with one fewer button rather than a button that
    answers 404. Same switch-on as `joined`, and the reason it is not defaulted
    to `[]` in the schema.

    Host only. A moderator may not appoint another — with a cap of three, one
    who could would spend the host's remaining seats on their own picks, and
    undoing it means demoting somebody.
  */
  const moderatorIds = stream.moderatorIds;
  const [moderatorsOpen, setModeratorsOpen] = useState(false);
  const moderators = useAppointModerator(stream.id);
  const grantEndRoom = useGrantEndRoom(stream.id);

  /*
    ─── MAY *I* CLOSE THIS ROOM? ────────────────────────────────────────────────
    `moderatorIds` says WHO holds an appointment; it does not say what any of
    them may do. `canEndRoom` is per person and rides on the moderator row, so
    a moderator who has been handed the closing has to read their own row to
    find out — which is why this fetches at all, and only for somebody who is
    actually in that list.

    Without this the grant was a permission with no button: the host handed
    over the closing on the way out and the moderator still saw "Leave Room",
    because every end control in this file was gated on `isHost`. The power
    existed on the server and nowhere a person could reach it.
  */
  const iAmModerator = Boolean(myId) && (moderatorIds ?? []).includes(myId ?? "");
  const moderatorRows = useRoomModerators(stream.id, iAmModerator && stream.status === "live");
  const iCanEndRoom =
    !isHost && moderatorRows.items.some((row) => row.profileId === myId && row.canEndRoom);
  /** Either office that may close the room — the host, or a moderator given it. */
  const canCloseRoom = isHost || iCanEndRoom;
  const canManageModerators = isHost && moderatorIds !== undefined;
  const hasModerators = (moderatorIds?.length ?? 0) > 0;
  /*
    Is a moderator actually PUBLISHING? Only a live track holds the room open,
    so this is what decides whether "leave it running" is a promise or a hope.
    Read off the stage rather than the appointment: being a moderator and being
    on stage are two separate things here, on purpose.
  */
  /*
    IS THE HOST ACTUALLY HERE? Read off the STAGE, not off the record: the
    stream always has an owner, and the question everybody else in the room is
    asking is whether that person is currently in it.
  */
  const hostOnStage = useMemo(
    () =>
      slots.some(
        (slot) => slot.role === "host" || baseIdentity(slot.identity) === stream.ownerId
      ),
    [slots, stream.ownerId]
  );

  /*
    ─── DELAYED, BECAUSE A RECONNECT IS NOT A DEPARTURE ─────────────────────────
    A host whose connection blips vanishes from the roster for a few seconds and
    comes straight back. Announcing that instantly would flash "the host stepped
    out" at the whole room over a hiccup, which is worse than saying nothing —
    it makes a working room look like a failing one.

    So absence has to persist before it is reported, and presence clears it at
    once: coming back is never news that needs settling.
  */
  const [hostAway, setHostAway] = useState(false);
  useEffect(() => {
    // Present: nothing to schedule, and nothing to clear that the cleanup
    // below has not already cleared on the way in.
    if (hostOnStage) return;
    const timer = window.setTimeout(() => setHostAway(true), HOST_AWAY_AFTER_MS);
    /*
      The reset lives in CLEANUP rather than in the body above, which is what
      runs the moment `hostOnStage` flips back to true — so a returning host
      clears the notice immediately, and the second departure is timed afresh
      instead of firing instantly on a stale flag.
    */
    return () => {
      window.clearTimeout(timer);
      setHostAway(false);
    };
  }, [hostOnStage]);

  const someModeratorOnStage = useMemo(
    () =>
      slots.some((slot) => (moderatorIds ?? []).includes(baseIdentity(slot.identity))),
    [slots, moderatorIds]
  );
  const chatItems = chatFeed.data?.items;
  const [seenChat, setSeenChat] = useState<{ id: string; createdAt: string } | null>(null);
  // Adjusted during render, React's pattern for state that follows a value:
  // while the sheet is open, everything on screen has been read.
  const newestChat = newestRoomChat(chatItems);
  if (chatSheet && newestChat && seenChat?.id !== newestChat.id) {
    setSeenChat({ id: newestChat.id, createdAt: newestChat.createdAt });
  }
  const unreadChat = chatSheet ? 0 : unreadRoomChat(chatItems, seenChat, me.data?.id);
  const [overflowSheet, setOverflowSheet] = useState(false);
  /*
    WHO MAY GET IN — the room's own `audience`, which decides whether every
    share row below is a true sentence or the opposite of one.
  */
  const roomIsPrivate = stream?.audience === "private";
  const [person, setPerson] = useState<PersonTarget | null>(null);

  const openSlot = useCallback(
    (slot: StageSlot) => {
      const meta = parseParticipantMeta(slot.metadata);
      setPerson({
        identity: slot.identity,
        name: participantName(slot.name) ?? slot.name,
        meta,
        seated: true,
        pendingRequestId: null,
        micMuted: slot.isMuted,
        isRoomHost: slot.role === "host",
      });
    },
    []
  );

  const openMember = useCallback(
    (member: AudienceMember) => {
      const waiting = handsUp.find((item) => item.userId === member.userId);


      setPerson({
        identity: member.identity,
        name: member.name,
        meta: member.meta,
        seated: false,
        pendingRequestId: waiting?.id ?? null,
        micMuted: true,
        isRoomHost: false,
      });
    },
    [handsUp]
  );

  /*
    THE HOST'S STAGE TOOLS — invite to speak and the soft mute
    (features/houses/hooks/use-host-stage-tools.ts). Seated means on a seat
    or approved for one, so an accepted invitation is never reported as
    "isn't available".
  */
  // The plain queue is pending-only on the service, so approved rows are their
  // own read: an accepted invitation settles on the row, not on the grant.
  const seatedRows = useSeatedSpeakers(stream.id, isHost && stream.status === "live");
  const seatedUserIds = useMemo(() => {
    const ids = new Set(speakerIds);
    for (const item of [...(hostRequests.data?.items ?? []), ...(seatedRows.data?.items ?? [])]) {
      if (item.status === "approved") ids.add(baseIdentity(item.userId));
    }
    return ids;
  }, [speakerIds, hostRequests.data, seatedRows.data]);
  const hostTools = useHostStageTools({
    stream,
    isHost,
    myId,
    slots,
    seatedUserIds,
    stageFull: full,
    sheetOpen: person !== null,
  });
  const openInvites = hostTools.openInvites;

  /*
    THE SHEET READS THE ROOM AS IT IS NOW. `person` is the snapshot taken when
    it opened; a mute that lands, an invitee who takes a seat or a speaker
    moved down all change what its rows should say. The seat is looked up
    live, by base identity (an approved speaker is `<did>#speaker`).
  */
  const livePerson = useMemo<PersonTarget | null>(() => {
    if (!person) return null;
    const base = baseIdentity(person.identity);
    const seat = slots.find((slot) =>
      person.isRoomHost ? slot.role === "host" : slot.role !== "host" && baseIdentity(slot.identity) === base
    );
    if (seat) return { ...person, identity: seat.identity, seated: true, micMuted: seat.isMuted, pendingRequestId: null };
    // Still in the audience: somebody who left is not offered an invitation.
    return person.isRoomHost ? person : { ...person, seated: false, micMuted: true, present: presentIds.has(base) };
  }, [person, slots, presentIds]);

  /**
   * THE OPEN PERSON'S GIFT ID, or null when they cannot be gifted.
   *
   * The id rule is the ROSTER'S OWN, reused rather than rewritten: the host is
   * keyed on `stream.ownerId`, because a host's LiveKit identity is the
   * literal string `broadcaster` and carries no account id at all. Anybody who
   * does not resolve to a row the roster already knows is NOT offered a gift
   * row — a row that quietly fell back to the host would pay the wrong person
   * while naming another, which is the exact failure `toProfileId` exists to
   * prevent, arriving through a different door.
   */
  const giftablePersonId = useMemo(() => {
    if (!livePerson) return null;
    const id = livePerson.isRoomHost ? stream.ownerId : baseIdentity(livePerson.identity);
    return id && giftRecipients.some((row) => row.id === id) ? id : null;
  }, [livePerson, giftRecipients, stream.ownerId]);

  /*
    A HOUSE MEMBER WHO IS LISTENING OPENS THE SAME SHEET AS THE AUDIENCE. The
    roster slot draws them, and the Audience drops them (they are in
    `houseMemberIds`), so without this the people a host is most likely to
    invite up were the only faces in the room with no sheet — no Invite, no
    Invited ring. Keyed on the user id the slot has; the connection itself is
    the audience member the room already knows.
  */
  const openPresent = useCallback(
    (userId: string) => {
      const member = audience.find((item) => item.userId === userId);
      if (member) openMember(member);
    },
    [audience, openMember]
  );
  const invitedIds = useMemo<ReadonlySet<string>>(() => new Set(openInvites.keys()), [openInvites]);

  const houseMembers = stream.houseConversationId
    ? (houseSlot?.(stream.houseConversationId, {
        speakerIds,
        presentIds,
        onRoster: setHouseMemberIds,
        onViewAll: openRoster,
        onOpen: openPresent,
        invitedIds: isHost ? invitedIds : EMPTY_IDS,
      }) ?? null)
    : null;


  /*
    THE FILE'S THREE LISTS, from the state the room already had.

    `Speakers` is the stage; `Audience` is everyone else in the room. They come
    from different sources on purpose — a slot is somebody publishing, an
    audience member is somebody connected — and the old ring collapsed both
    into one arrangement of eight chairs, which is why there was nowhere to put
    a room of thirty.

    `muted` reads the audio map rather than being inferred from silence: a
    person who simply is not talking is not muted, and drawing them as muted
    would be a claim about their microphone we did not check.
  */
  const speakerPeople: RoomPerson[] = useMemo(
    () =>
      seating.seats
        .filter((seat) => seat.slot !== null)
        .map((seat) => {
          const slot = seat.slot as StageSlot;
          // Null until the token carries it (B1). No username, no actions —
          // rather than a wink aimed at nobody.
          const meta = parseParticipantMeta(slot.metadata);
          const username = meta?.username ?? null;
          /*
            OUR OWN NAME COMES FROM `/me`, NEVER FROM THE TOKEN.

            The room token's `name` is the publisher label the service mints —
            literally the string "broadcaster" — so the host saw themselves
            listed as `broadcaster` in their own room. The token metadata that
            would name everybody else is backend B1 and has not shipped, but we
            have never needed it for OURSELVES: `/me` is already loaded. So the
            local participant is named and pictured from the signed-in profile,
            and everyone else still degrades to the token then to `Guest 4B2C`.
          */
          /*
            THE HOST IS NAMED FROM THE STREAM, NOT FROM THE TOKEN.

            `GET /streams/:id` already carries `owner` — id, username,
            displayName, avatarUrl — and the host's room token carries none of
            that: it is minted with the literal identity `broadcaster`. So the
            host tile reads the stream's owner, which works for EVERY viewer
            rather than only for the host looking at their own screen.

            An approved guest speaker still joins as `<did>#speaker`, so the
            `isMe` path below covers naming ourselves when we are that guest.
            Everyone else waits on token metadata (backend B1).
          */
          const owner = slot.role === "host" ? stream.owner : null;
          const isMe = myId !== undefined && baseIdentity(slot.identity) === myId;
          const ownerName = owner ? owner.displayName || owner.username : null;
          return {
            id: slot.identity,
            // The connection identifies the TILE; the person identifies the
            // FACE. `slot.identity` carries a `#broadcaster` / `#speaker`
            // suffix, and seeding generated artwork with it drew the host as
            // somebody else than the sidebar does.
            userId: owner ? owner.id : baseIdentity(slot.identity),
            name:
              ownerName ??
              (isMe && myName ? myName : participantLabel(slot.name, slot.identity)),
            avatarUrl: owner ? (owner.avatarUrl ?? null) : isMe ? myAvatar : (meta?.avatarUrl ?? null),
            speaking: audio.loudest === slot.identity,
            /*
              THE PILL UNDER THE NAME — node 1285:30456. The host is keyed on
              the stream's `ownerId` rather than the slot, because the host's
              publisher identity is the literal string `broadcaster` and
              carries no user id; the roster a hundred lines up already does
              this, and getting it wrong drew the host as nobody.

              Ordinary speakers get NOTHING, on purpose: a SPEAKER pill under
              every face would make the two that matter invisible by making the
              row uniform.
            */
            role:
              slot.role === "host" || (owner && owner.id === stream.ownerId)
                ? ("host" as const)
                : (stream.moderatorIds ?? []).includes(owner ? owner.id : baseIdentity(slot.identity))
                  ? ("moderator" as const)
                  : undefined,
            // The file draws a microphone on every speaker's plate. It reads
            // the PUBLICATION (`slot.isMuted`), which is their real microphone,
            // and falls back to muted when this viewer has silenced them — a
            // person you cannot hear must not be drawn as talking.
            mic: slot.isMuted || mutedForMe.has(slot.identity) ? "muted" : "on",
            // The host's soft mute, for everyone to see — only while the mic
            // really is still off (lib/host-mute.ts).
            mutedByHost: slot.mutedByHost,
            // No wink-and-follow aimed at yourself.
            actions:
              owner && owner.id !== myId
                ? personActionsSlot?.(owner.username)
                : isMe || !username
                  ? undefined
                  : personActionsSlot?.(username),
            onOpen: () => openSlot(slot),
          };
        }),
    // `moderatorIds` and `ownerId` decide the pill under each name, so a list
    // built before either arrived would draw the host as an ordinary speaker
    // until something else happened to invalidate it.
    [seating, audio.loudest, mutedForMe, openSlot, personActionsSlot, myId, myName, myAvatar, stream.owner, stream.ownerId, stream.moderatorIds]
  );

  const audiencePeople: RoomPerson[] = useMemo(
    () =>
      audience
        // EXTERNAL ONLY. Somebody who belongs to this house is already drawn
        // under House Members; listing them again put the same face in two
        // sections of one screen. What is left is what the file's Audience
        // actually means — the people a PUBLIC room let in from outside.
        .filter((member: AudienceMember) => !houseMemberIds.has(member.userId))
        .map((member: AudienceMember) => {
          const isMe = myId !== undefined && member.userId === myId;
          return {
            id: member.identity,
            userId: member.userId,
            name: isMe && myName ? myName : member.name,
            avatarUrl: isMe ? myAvatar : (member.meta?.avatarUrl ?? null),
            actions:
              isMe || !member.meta?.username
                ? undefined
                : personActionsSlot?.(member.meta.username),
            // The host's own screen only: nobody else reads the invitations.
            invited: openInvites.has(member.userId),
            onOpen: () => openMember(member),
          };
        }),
    [audience, houseMemberIds, openMember, personActionsSlot, myId, myName, myAvatar, openInvites]
  );

  /* ---- keyboard --------------------------------------------------------- */

  const micToggle = session.toggleMic;
  const micOn = here && session.micOn;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never steal a keystroke from something somebody is typing into.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "m" && onStage) {
        event.preventDefault();
        void micToggle();
        announce(micOn ? "Microphone muted" : "Microphone on");
      } else if (key === "h" && canAsk) {
        event.preventDefault();
        if (pendingMine && mine.data?.id) {
          resolve.mutate({ requestId: mine.data.id, action: "leave" });
        } else if (!askReason) {
          ask();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStage, canAsk, micOn, micToggle, announce, pendingMine, mine.data?.id, resolve, askReason, ask]);

  /* ---- render ----------------------------------------------------------- */

  const shareOrigin = typeof window === "undefined" ? "" : window.location.origin;
  const listening = audience.length;
  const speaking = slots.length;

  // The gist partners as a FACE PILE for the header — speakers first, then the
  // audience, seeded on the USER id so the artwork matches everywhere else.
  const partnerFaces = useMemo(
    () =>
      [...speakerPeople, ...audiencePeople].map((person) => ({
        id: person.id,
        name: person.name,
        avatarUrl: person.avatarUrl,
        seed: person.userId ?? person.id,
      })),
    [speakerPeople, audiencePeople]
  );

  return (
    /*
      NODE 129:11748. The room is TWO columns, not one narrow one.

      The file draws them 805 and 411 inside a 1440 frame. Only the CHAT is
      fixed at 411 — the stage takes whatever is left, which is why it has no
      max-width. Capping it at the file's 805 left everything past 1216px of
      pane as dead black parked on the right edge, which is exactly the bug the
      shell removed its own max-widths to fix.

      The people grid still reads from 744 up: six 104px cards on a 24px gutter
      is 6*104 + 5*24, and a wider stage simply wraps a seventh onto the row
      rather than leaving a margin nobody asked for.

      Below `xl` the right column drops under the left rather than squeezing:
      a 411px chat beside a 744px grid needs 1155px of room before the shell's
      own rail, and cramming it makes both unusable.
    */
    <main
      ref={roomRef}
      aria-label={houseTopic(stream)}
      /* `bg-chrome` (#0f0f0f) is the file's own frame fill, not `ws-wash`.
         The wash paints pure #000 with a radial highlight, which made the
         left column DARKER than the page it sits on and flattened the step up
         to the chat column's #121214 — the two read as one surface. Flat
         ground on the left, `--color-chrome` on the right, exactly as
         129:11887 and 129:12852 are painted. */
      /* The phone reserves its OWN bar's 80 (1285:93076) plus the home
         indicator — the shell's dock is gone on this route below `md` and
         `--ws-nav-h` is 0 there (lib/dock-surfaces.ts). From `md` the
         floating pill's clearance, as before.
         FROM `xl` THE ROOM FITS THE SCREEN: the viewport less its own
         measured top edge (`--ws-room-top`, see the effect above — the
         header plus whatever band the shell draws) and less the dock's row
         (`--ws-nav-h`), which the shell reserves under every route. Before,
         only the header was subtracted and the page scrolled by exactly one
         dock (ogazboiz, 2026-09-13). The chat column is `h-full` inside. */
      className="flex w-full flex-col bg-chrome pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-[calc(var(--ws-nav-h)+72px)] xl:h-[calc(100dvh-var(--ws-room-top,var(--ws-crumb-h))-var(--ws-nav-h))] xl:flex-row xl:overflow-hidden xl:pb-0"
    >
      {/* The audio is NOT here. The shell's RoomSessionProvider mounts it
          (HouseAudioSinks), so it keeps playing when this view unmounts. */}

      {/* One polite region for the whole room. Never assertive: everything
          here is ambient, and assertive interrupts whatever is being read. */}
      <div role="status" aria-live="polite" className="sr-only">
        {message}
      </div>

      {/* Call-style reactions rising over the stage — local taps and the ones
          other people send, one layer. Viewport-fixed, so it is mounted once
          here regardless of which control opened the picker. */}
      <RoomReactions items={roomReactions.items} />
      {/* Positioned by the room container, not the viewport — see GiftBursts. */}
      <GiftBursts items={giftBursts.items} />

      {/* LEFT COLUMN — 805 in the file, 744 of content inside 32px gutters.
          A COLUMN, not a plain block: the file's bottom bar (129:12197) is the
          last thing in it, and it has to sit on the column's own bottom edge
          rather than beside the chat. */}
      <div className="ws-hair flex min-w-0 flex-1 flex-col xl:overflow-y-auto xl:border-r">

      <HouseHeader
        topic={houseTopic(stream)}
        house={house?.title}
        meta={
          /*
            WHO IS IN THE ROOM, always — not how big the house is.

            The file's line was the HOUSE's partner count, so a 2-person room
            inside a 40-member house read "40 gist partners" in the room's own
            header: the same presence-blind claim as the roster grid, made in
            larger type. The house is still named beside this; its size is a
            fact about the house, and this line describes the room.
          */
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* PRESENCE YOU CAN SEE — the room's partners as a face pile, then
                the count. Speakers first, then the audience; the total is still
                the ROOM's own ("gist partners"), never the house's size. The
                sharing lives on the share button, so this line is who is here
                rather than a second place to copy a link. */}
            {partnerFaces.length > 0 && (
              <AvatarStack people={partnerFaces} max={4} size={20} />
            )}
            {/* Beside a long title on a phone the words would steal the title's
                room, so mobile shows just the count; the label returns at md. */}
            <span className="shrink-0">
              <span className="tnum">{listening + speaking}</span>
              <span className="hidden md:inline"> gist partners</span>
            </span>
            {/* THE CODE — desktop only. On a phone the header is a compact
                title row and sharing lives on the share button, so the code
                (and its copy) is hidden below md rather than crowding the line. */}
            {roomCodeVisible(stream, isHost) && stream.roomCode && (
              <span className="hidden items-center gap-2 md:flex">
                <span aria-hidden>·</span>
                <CopyCodeChip code={stream.roomCode} />
              </span>
            )}
          </span>
        }
        // 1285:92940 — the host's phone pill says what leaving means for them.
        leaveLabel={canCloseRoom ? "Close Room" : "Leave Room"}
        /*
          THIS file confirms, not the header. Both paths open the sheet below,
          whose copy knows whether the reader is the HOST — closing the room
          for everybody — or a guest leaving quietly. The header cannot know
          that, so its own generic dialog is switched off rather than stacked
          in front of this one.
        */
        confirmBeforeLeave={false}
        onLeave={canCloseRoom ? () => setConfirmLeave(true) : leave}
        // The file's row 2 has two circles, not three. The overflow sheet the
        // third one opened is this one — both room links and the keyboard
        // shortcuts — so nothing was lost when the dots went.
        onShare={() => setOverflowSheet(true)}
        /*
          JOIN HOUSE IS NOW A REAL JOIN.

          It used to fire a speaker request, because there was no way to join a
          house group — which meant a button labelled "Join House" asked for a
          microphone instead. `POST /conversations/:id/join` exists, and the
          room now knows enough to offer it honestly:

            · absent once you are already a member — a Join button on something
              you have joined is the surest way to make a control look broken;
            · absent on a PRIVATE house, where the service would refuse with
              "ask a member to add you". The name still shows; the invitation
              does not, because there is nothing to accept.

          Asking for the floor is a different act and has its own control — the
          raised hand in the bottom bar.
        */
        join={
          joinHouse && house && house.visibility === "public" && !house.viewerIsMember
            ? {
                onJoin: () => gate(() => joinHouse?.onJoin(house.id)),
                state: joinHouse?.pending ? "pending" : "idle",
                reason: null,
              }
            : undefined
        }
      />

      {/*
        The cover: 741x200 at radius 24, and ONLY when there is one.

        A room without a picture used to get an empty 200px panel in its
        place. The file fills that rectangle white because it is drawing a room
        that HAS a cover; an empty tinted slab is not what it specifies, it is
        our stand-in for something that does not exist — and it reads as an
        image that failed to load rather than as a room that never had one. It
        also pushed Speakers 216px down the page to make room for nothing.

        So the whole block is absent, padding included: there is no gap where
        the cover would have been, and the section below simply starts higher.
      */}
      {stream.thumbnailUrl && (
        <div className="px-4 pt-4 xl:px-8">
          {/* A plain <img>: the host uploads this and the store types it, so
              `next/image` handed something it cannot decode is a crash this
              repo has already shipped twice. */}
          <img
            src={stream.thumbnailUrl}
            alt=""
            className="h-[200px] w-full rounded-3xl object-cover"
          />
        </div>
      )}

      {/*
        30, NOT 32 — and the three pixels are the whole difference between six
        tiles on a row and five.

        Six cards is exactly 744: 6*104 plus 5*24 of gutter. The file gives the
        left column 805 and the grid 744, which is a 30.5 inset either side.
        `xl:px-8` is 32, leaving 741 — three short — so at 1440, the width the
        file itself is drawn at, the sixth tile wrapped onto its own row and the
        section read as a ragged two-and-a-bit rows instead of the two full ones
        the design draws.
      */}
      {/* The phone's 342 column at x=24 (px-6), Speakers 24 under the header
          (1285:92941 at y=307.37 against the head ending at 283.37) — the
          header's own bottom padding is that 24, so no top padding here. */}
      {/* THE HOST'S INVITATION, asked on the room's own page (the shell's copy
          stays away from here). Pinned under the header where the reader is
          looking, non-modal: the room keeps talking behind it. Read from the
          session's poll of the reader's own row, never from a push. */}
      {here && !isHost && session.invite && (
        // Under the room's header, clamped on screen, and inside an open
        // sheet's dialog while there is one (InviteBannerDock).
        <InviteBannerDock
          key={session.invite.requestId}
          offset="var(--ws-topbar-h) + var(--ws-crumb-h) + var(--ws-house-head-h)"
          requestId={session.invite.requestId}
          inviteExpiresAt={session.invite.inviteExpiresAt}
          createdAt={session.invite.createdAt}
          seenAt={session.invite.seenAt}
          clockOffsetMs={session.invite.clockOffsetMs}
          host={{ id: stream.owner?.id ?? stream.ownerId, name: ownerName ?? "The host", avatarUrl: stream.owner?.avatarUrl }}
          busy={session.answeringInvite}
          onAccept={() => session.answerInvite("accept")}
          onReject={() => session.answerInvite("reject")}
        />
      )}

      <div className={cn("flex flex-col gap-6 px-6 pb-6 md:px-4 md:pt-4 xl:px-[30px]", state === "failed" && "opacity-40")}>
        {/*
          WHO IS RUNNING THIS ROOM, when it is not the person whose name is on
          it. The host keeps the title and the HOST pill — they can come back
          and resume, which is the whole reason this feature exists — so
          without a line like this the room simply looks normal while nobody is
          steering it.

          A STATUS LINE, NOT AN ALARM: muted, inline, no icon, no colour. The
          room is fine; it is being run by somebody else. Panic styling here
          would empty the room faster than the silence would.

          Not shown to the host. They know where they are, and telling somebody
          they have stepped out of a room they are standing in is the kind of
          notice that makes an app feel unaware of itself.
        */}
        {stream.status === "live" && hostAway && !isHost && (
          <p className="text-[12px] leading-4 text-meta">
            {hasModerators
              ? "The host stepped out. Moderators are running the room."
              : "The host stepped out."}
          </p>
        )}

        <RoomPeopleSection
          title="Speakers"
          rule={false}
          people={speakerPeople}
          empty="Nobody has the floor yet."
        />
      </div>

      {state === "failed" && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3">
          <p className="text-[13px] leading-5 text-body">
            {roomFailureCopy("failed")}
          </p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => session.retry()}>
            Try again
          </Button>
        </div>
      )}

      {/* The host is connected but their microphone could not be opened —
          a device problem with its own remedy, not a lost room. */}
      {here && isHost && state === "live" && session.micFailure && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3">
          <p className="text-[13px] leading-5 text-body">{roomFailureCopy(session.micFailure)}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => session.stage.retry()}>
            Try again
          </Button>
        </div>
      )}

      {/* The browser refused to play the room without a gesture — a reload or a
          shared link opened in a fresh tab. The mini-player's Listen is hidden
          on this page, so the page offers its own. */}
      {here && connection === "live" && !session.canPlayAudio && (
        <div className="ws-inset mx-4 mb-4 flex items-center gap-3 px-4 py-3">
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-body">Your browser paused the room&apos;s sound.</p>
          <Button size="sm" className="shrink-0 pointer-coarse:h-11" onClick={session.startAudio}>
            Listen
          </Button>
        </div>
      )}

      {stagePanel && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3" role="status">
          <p className="text-[13px] leading-5 text-body">{stagePanel.message}</p>
          {stagePanel.actions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {stagePanel.actions.map((action, index) => (
                <Button
                  key={action}
                  size="sm"
                  variant={index === 0 ? "secondary" : "ghost"}
                  disabled={(action === "request-again" || action === "leave") && resolve.isPending}
                  onClick={() => runStageAction(action)}
                >
                  {STAGE_ACTION_LABEL[action]}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      {signedOut && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3">
          <p className="text-[13px] leading-5 text-body">Sign in to listen to this gist room.</p>
          <Button size="sm" className="mt-2" onClick={() => gate(() => {})}>
            Sign in
          </Button>
        </div>
      )}

      {here && connection === "ended" && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3">
          <p className="text-[13px] leading-5 text-body">
            {session.state.endReason === "removed"
              ? "You were removed from this gist room."
              : "This gist room has ended."}
          </p>
        </div>
      )}

      {gone && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3">
          <p className="text-[13px] leading-5 text-body">You&apos;re not in this gist room.</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => enterRoom(stream.id, role)}
          >
            {wasHere ? "Join again" : "Join"}
          </Button>
        </div>
      )}

      {state === "duplicate" && (
        <div className="ws-inset mx-4 mb-4 px-4 py-3">
          {/* Terminal by design: nothing retries by itself, because a retry
              evicts the other tab, whose own reconnect evicts this one — that
              IS the eviction loop. So the way on is the reader's own choice,
              and it has to be HERE: this is the room's page, where the
              mini-player is hidden, and `enter` does nothing out of a terminal
              state. "Use it here" clears the state and enters again, taking
              the room from the other tab (which lands in this same state and
              stays there); "Dismiss" just clears it. */}
          <p className="text-[13px] leading-5 text-body">
            This house is open somewhere else. You can only be in a house from one tab or device
            at a time.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                session.dismiss();
                enterRoom(stream.id, role);
              }}
            >
              Use it here
            </Button>
            <Button size="sm" variant="ghost" onClick={() => session.dismiss()}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-6 px-6 pb-6 md:px-4 xl:px-[30px]">
        {/*
          HOUSE MEMBERS is the roster of the group this room belongs to, and it
          is genuinely a different list from the AUDIENCE: a member may not be
          here, and somebody here may not be a member. It renders only when the
          room HAS a house group — a room opened from the street belongs to no
          house, and an empty "House Members" would invent one.

          The roster arrives through a slot, because it is a conversation and
          slices never import each other.
        */}
        {houseMembers}

        <RoomPeopleSection
          title="Audience"
          people={audiencePeople}
          /* The file ends a full grid with "View all" (369:9337) and opens the
             roster over the chat. It appears only when there IS more than the
             grid shows — a control that opens a panel identical to what you are
             already looking at is a control that lies about having more. */
          onViewAll={
            audiencePeople.length > GRID_CELLS
              ? () => openRoster("Audience", audiencePeople)
              : undefined
          }
          empty={
            house
              ? "Nobody from outside the house is listening yet."
              : "Nobody is listening yet."
          }
        />
      </div>

      {stream.description?.trim() && (
        <div className="ws-row flex items-start gap-3 px-4 py-3 xl:px-8">
          <IconLink className="mt-0.5 h-4 w-4 shrink-0 text-meta" />
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-body">
            {stream.description.trim()}
          </p>
        </div>
      )}

      {/* Keyed on the URL: a transcript never carries over into another stream. */}
      <CaptionRail key={here ? (session.captionUrl ?? "none") : "none"} captionUrl={here ? session.captionUrl : null} />

      {/* Everything above scrolls; the bar below is pinned to the column's
          bottom edge. `mt-auto` rather than `sticky`, because the column is
          only viewport-tall from `xl` — on a phone the page scrolls as one and
          the bar belongs at the end of it, under the mobile control pill. */}
      <div className="mt-auto" />
      <RoomDock
        /* The host records; everyone else tips (129:12198 / 121:10996). The
           tip control is the tips slice's and comes in through a slot, and it
           removes itself where a tip could not be taken — so a room with no
           tippable host simply has an empty left edge, as the file's host
           frame does before Record Gist is pressed. */
        /*
          NO "RECORD GIST" — removed 2026-09-24 at ogazboiz's word, and it was
          never a working control: it rendered permanently disabled, because
          recording a room needs LiveKit egress that is not provisioned. A
          button that has never once been pressable is not a promise of a
          feature, it is a dead pixel in the one row the host uses most.

          The host's left edge is simply empty now, which is what the file's
          own host frame draws before Record Gist is pressed. The audience
          keeps "Give a tip"; a host tipping their own room is refused by the
          service, so there is nothing to put there in its place. Gifting
          somebody ELSE in the room is the gift button, which is beside it and
          is there for everyone including the host.
        */
        primary={isHost ? null : (tipSlot?.(stream.id, stream.owner) ?? null)}
        onGift={() => {
          setGiftTo(null);
          setGiftsOpen(true);
        }}
        mic={
          onStage
            ? {
                on: micOn,
                toggle: () => void micToggle(),
                disabled: state === "reconnecting" || state === "failed",
              }
            : null
        }
        /* The same request state the header's "Join House" pill drives, and
           the same mutations — one queue, one poll, two places to reach it. */
        ask={
          canAsk
            ? {
                label: pendingMine ? handLabel(mine.data?.createdAt) : "Ask to speak",
                reason: pendingMine ? null : askReason,
                pending: pendingMine,
                busy: request.isPending || resolve.isPending || state !== "live",
                onAsk: ask,
                onLower: () =>
                  mine.data?.id && resolve.mutate({ requestId: mine.data.id, action: "leave" }),
              }
            : null
        }
        onReact={sendReaction}
        onPeople={canManageModerators ? () => setModeratorsOpen(true) : null}
        /* Absent on a phone: the frame's bottom bar (RoomPhoneBar, below) is
           pinned to the viewport there and carries the same controls. */
        className="hidden md:flex xl:sticky xl:bottom-0"
      />

      </div>
      {/* ── END LEFT COLUMN ──────────────────────────────────────────────── */}

      {/*
        RIGHT COLUMN — 411, painted `--color-chrome`, carrying the host's
        Speaker Request panel over the room's chat. It is a column on a wide
        screen and a stacked block below `xl`; it is never hidden, because the
        chat is the only way somebody without a seat can say anything.
      */}
      {/* NOT A COLUMN ON A PHONE. 1285:92794 draws no chat under the grid;
          the chat is a sheet off the bottom bar's chat disc and the roster a
          sheet off "View all" (both below). `max-md:hidden` keeps the chat
          MOUNTED — its poll and scroll survive — the same reason the roster
          `hidden`s it rather than unmounting it. */}
      <aside className="ws-hair flex w-full shrink-0 flex-col border-t bg-chrome max-md:hidden xl:h-full xl:w-[411px] xl:border-x xl:border-t-0 xl:overflow-hidden">
        {/*
          THE ROSTER TAKES THIS COLUMN WHILE IT IS OPEN — 369:8740.

          Not a dialog: the stage keeps playing beside it and the room is still
          audible, which is the whole reason the file puts it here rather than
          over the middle. Closing puts the chat back exactly as it was, because
          the chat is not unmounted by this — it is `hidden`, so its scroll
          position and its poll survive being covered.
        */}
        {roster && (
          /* ONE panel, two homes: the column from `md`, a sheet on the phone
             (the column is hidden there, and a panel inside a hidden column
             is a "View all" that does nothing). The Sheet portals to the
             body, so it renders from inside this aside regardless. */
          <RosterSurface phone={phone} onClose={closeRoster} scrollRef={rosterRef}>
            <RoomRosterPanel
              title={roster.title}
              people={roster.people}
              onClose={closeRoster}
              actionsSlot={(username) => personActionsSlot?.(username, "labelled")}
            />
          </RosterSurface>
        )}
        <div className={cn("flex min-h-0 flex-1 flex-col", roster && "hidden")}>
        {/* SPEAKER REQUEST — node 129:12809, host only, above the chat. It used
            to be the tray SHEET mounted here, which renders nothing until it
            opens, so the band the file draws was simply a 48px hole. */}
        {isHost && (
          <SpeakerRequestPanel
            stream={stream}
            seatsFull={full}
            onManage={() => setTray(true)}
            invited={hostTools.invited}
          />
        )}

        {/* The file's "Gistroom Chat". A gist room IS a stream, so this is the
            same chat endpoint every stream has — not a second one. The heading
            is the file's own 24px row over a hairline; the panel below it draws
            the room's purple bubbles and pill composer (variant "room"). */}
        <div className="flex min-h-0 flex-1 flex-col">
          <h2 className="shrink-0 border-b border-white/10 px-6 py-6 text-[14px] font-bold leading-5 text-white">
            Gistroom Chat
          </h2>
          <div className="min-h-0 flex-1">
            <ChatPanel stream={stream} variant="room" members={chatMentionables} liveRoom={room} />
          </div>
        </div>
        </div>
      </aside>

      {/*
        THE FLOATING CONTROL PILL IS A PHONE PATTERN, and from `xl` it is gone.

        Every one of its controls has a place in the file's own desktop chrome:
        the microphone and the heart are in the bottom bar (129:12197), leaving
        is the header's red circle (129:11905), asking for the floor is
        "Join House" (129:11893), and the host's queue is the Speaker Request
        band (129:12809). Keeping it as well would draw each of them twice, one
        of the two floating over the file's layout.

        Below `xl` there is no such chrome — the columns stack, the bar is at
        the very bottom of a long page, and this pill is the only thing within
        reach — so it stays exactly as it was.
      */}
      <HouseControls
        /* And not on a PHONE either, where the frame's own bar (below) holds
           every one of these: the mic, the heart, the hand and the queue in
           the bar, leaving in the header's red pill. */
        className="max-md:hidden xl:hidden"
        mic={
          onStage
            ? {
                on: micOn,
                toggle: () => void micToggle(),
                disabled: state === "reconnecting" || state === "failed",
              }
            : null
        }
        ask={
          canAsk
            ? {
                label: pendingMine ? handLabel(mine.data?.createdAt) : "Ask to speak",
                reason: pendingMine ? null : askReason,
                pending: pendingMine,
                busy: request.isPending || resolve.isPending || state !== "live",
                onAsk: ask,
                onLower: () =>
                  mine.data?.id && resolve.mutate({ requestId: mine.data.id, action: "leave" }),
              }
            : null
        }
        tray={isHost ? { count: handsUp.length, onOpen: () => setTray(true) } : null}
        onReact={sendReaction}
        leave={
          isHost
            ? { label: "Close the gist room", onLeave: () => setConfirmLeave(true) }
            : // Naming the absence of a notification is free retention, and it
              // is the truth. Do not soften it to "Leave".
              { label: "Leave quietly", onLeave: leave }
        }
      />

      {/*
        THE PHONE'S BOTTOM BAR — node 1285:93076, pinned to the viewport below
        `md` where the shell's dock is absent for this route. Everything it
        fires is the state above: the same mic toggle, the same request
        mutations, the same reaction channel, the same tray.
      */}
      <RoomPhoneBar
        unreadChat={unreadChat}
        /*
          EVERY CONTROL THE DOCK HAS, because this bar REPLACES it below `md`
          rather than summarising it. It shipped with four of them and the dock
          grew three more — the tip pill, the moderator sheet and the gift tray
          — so on a phone a host could not appoint a moderator at all and
          nobody could open the gift tray except by tapping a person first.

          The same handlers and the same guards as the dock above, deliberately
          written out rather than lifted into a shared object: two call sites
          that must not drift are better pinned by a test than by indirection
          that hides which one is missing an argument.
        */
        primary={isHost ? null : (tipSlot?.(stream.id, stream.owner) ?? null)}
        onGift={() => {
          setGiftTo(null);
          setGiftsOpen(true);
        }}
        onPeople={canManageModerators ? () => setModeratorsOpen(true) : null}
        mic={
          onStage
            ? {
                on: micOn,
                toggle: () => void micToggle(),
                disabled: state === "reconnecting" || state === "failed",
              }
            : null
        }
        ask={
          canAsk
            ? {
                label: pendingMine ? handLabel(mine.data?.createdAt) : "Ask to speak",
                reason: pendingMine ? null : askReason,
                pending: pendingMine,
                busy: request.isPending || resolve.isPending || state !== "live",
                onAsk: ask,
                onLower: () =>
                  mine.data?.id && resolve.mutate({ requestId: mine.data.id, action: "leave" }),
              }
            : null
        }
        tray={isHost ? { count: handsUp.length, onOpen: () => setTray(true) } : null}
        onReact={sendReaction}
        onChat={() => setChatSheet(true)}
      />

      {/* The chat, as a sheet, on a phone — the file's "Gistroom Chat" row
          over a hairline, then the same panel the column holds. Only ever
          opened from the phone bar, and dropped if the viewport grows past
          `md`, where the column is back on screen. */}
      <Sheet
        open={chatSheet && phone}
        onClose={() => setChatSheet(false)}
        bare
        panelClassName="h-[85dvh]"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="ws-hair flex shrink-0 items-center justify-between border-b px-6 py-6">
            <h2 className="text-[14px] font-bold leading-5 text-white">Gistroom Chat</h2>
            <button
              type="button"
              onClick={() => setChatSheet(false)}
              aria-label="Close the chat"
              className="ws-press flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <IconX className="h-2.5 w-2.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatPanel stream={stream} variant="room" members={chatMentionables} liveRoom={room} />
          </div>
        </div>
      </Sheet>

      {/*
        EVERYBODY IN THE ROOM, speakers and audience alike — appointing does not
        seat anybody, so the candidate list is not the stage. `chatMentionables`
        is already exactly that roster (every slot plus every audience member,
        de-duplicated by username, and resolved to a real profile id), which is
        why the sheet needs no read of its own.
      */}
      {canManageModerators && (
        <AddModeratorSheet
          open={moderatorsOpen}
          onClose={() => setModeratorsOpen(false)}
          people={chatMentionables.map((person) => ({
            id: person.id,
            name: person.displayName,
            username: person.username,
          }))}
          moderatorIds={moderatorIds ?? []}
          busy={moderators.appoint.isPending || moderators.remove.isPending}
          onAppoint={(userId) => moderators.appoint.mutate({ userId })}
          onRemove={(userId) => moderators.remove.mutate(userId)}
        />
      )}

      {/*
        THE GIFT TRAY, NOW PRICED — the money leg is on.

        It shipped unpriced because `POST /streams/:id/gifts` hardcoded
        `recipientId = stream.ownerId`, so a priced gift aimed at a named
        person would have charged the sender and paid the HOST while the
        screen said somebody else's name.

        VERIFIED IN PRODUCTION BEFORE FLIPPING, not taken on report. The served
        OpenAPI document now carries `toProfileId` on this route, described
        exactly as agreed — optional, absent still means the host, the named
        person must be present, 409 `RECIPIENT_NOT_IN_ROOM` and NEVER a
        fallback to the host, host exempt from the presence check, self-gift
        refused — and `/tips/capability` answers
        `verifiedRoomRecipientsOnly: false`, so anybody in the room may
        receive.

        `giftsArePriced` still gates on `MARKET_FLAGS.liveGifts` AND a live
        status, so a deployment without the flag, or a room that has ended,
        keeps the free moment rather than pricing something it cannot settle.
      */}
      <GiftSheet
        open={giftsOpen}
        onClose={() => setGiftsOpen(false)}
        onSend={sendGift}
        viewerIsHost={isHost}
        recipients={giftRecipients}
        priced={giftsArePriced(stream.status)}
        initialRecipientId={giftTo}
        balanceCoins={giftCoins}
        onTopUp={(needed) => {
          setTopUpNeeded(needed);
          setTopUpOpen(true);
        }}
      />
      {/*
        THE COIN PURCHASE, NOT THE KASH ONE.

        Being short of COINS opened the KASH top-up, which is a different
        currency: somebody with KASH already in their wallet was sent to buy
        more KASH and came back with exactly as many coins as before — none.
        The two are not interchangeable; KASH is the money, coins are what this
        tray spends, and `CoinBuySheet` is the only place they convert.
      */}
      <CoinBuySheet
        open={topUpOpen}
        needed={topUpNeeded}
        onClose={() => setTopUpOpen(false)}
      />

      {isHost && (
        <HandTray
          stream={stream}
          open={tray}
          onOpen={() => setTray(true)}
          onClose={() => setTray(false)}
          seatsFull={full}
          requestsOpen={requestsOpen}
          onRequestsOpenChange={setRequestsOpen}
          invited={hostTools.invited}
          connected={connectedIds}
          muteFor={hostTools.muteFor}
        />
      )}

      {/*
        The gift row on a person is offered ONLY when that person resolves to
        somebody the roster already knows. The id rule is the roster's own —
        the host is keyed on `stream.ownerId`, because their LiveKit identity
        is the literal string `broadcaster` and carries no account id — and
        anybody who does not resolve is not offered, because a row that
        silently fell back to the host would gift the WRONG PERSON while
        naming another. That is the same failure the recipient field exists to
        prevent, arriving through a different door.
      */}
      <PersonSheet
        person={livePerson}
        open={person !== null}
        onClose={() => setPerson(null)}
        isHost={isHost}
        hostBusy={resolve.isPending}
        onGift={
          giftablePersonId
            ? () => {
                setGiftTo(giftablePersonId);
                setPerson(null);
                setGiftsOpen(true);
              }
            : undefined
        }
        onMoveDown={(target) => {
          // An approved speaker's LiveKit identity is `<did>#speaker`; the
          // request row is keyed on the bare DID. Comparing them raw never
          // matched, which is a bug this codebase has already fixed once.
          // The APPROVED read: the plain queue is pending-only on the service,
          // so a seat looked for there was never found.
          const seated = (seatedRows.data?.items ?? []).find(
            (item) =>
              item.status === "approved" &&
              baseIdentity(item.userId) === baseIdentity(target.identity)
          );
          if (!seated) {
            toast.error("Couldn't find their seat.");
            return;
          }
          resolve.mutate({ requestId: seated.id, action: "remove" });
          setPerson(null);
        }}
        onSeat={(target) => {
          if (!target.pendingRequestId) return;
          resolve.mutate({ requestId: target.pendingRequestId, action: "approve" });
          setPerson(null);
        }}
        hostActions={hostTools.actionsFor(livePerson)}
        mute={
          // Only a person with a seat is publishing, so only they have audio to
          // silence. Offering the row over an audience member would be a
          // control that does nothing.
          livePerson?.seated
            ? { muted: mutedForMe.has(livePerson.identity), onToggle: () => toggleMute(livePerson.identity) }
            : null
        }
        followSlot={followSlot}
        safetySlot={safetySlot}
        inviteGateSlot={inviteGateSlot}
      />

      <Sheet open={overflowSheet} onClose={() => setOverflowSheet(false)} title="This house">
        {/*
          A PRIVATE ROOM'S SHARE ROWS USED TO PROMISE THE OPPOSITE OF THE TRUTH.

          Every hint below was written for a public room — "anyone can type it
          in and walk in", "anyone with this can walk in and listen" — and was
          shown unchanged on a private one. A host read them, shared the code in
          good faith, and the person they sent it to was refused at the door.
          The host then has no way to tell whether the product is broken or they
          did something wrong, and the invitee has been told they are not wanted.

          So the copy follows the room. The CONTROLS stay: a code and a link are
          still how an invited person gets in quickly, and withholding them would
          solve the lie by removing the feature.
        */}
        {/* THE CODE GOES FIRST. It used to be host-only, as the conservative
            reading of "why cant they see the room code"; ogazboiz then ruled
            it: in a PUBLIC room everyone should see it ("they cant see it in
            the gist room if it is public"). A private room keeps it with the
            host. The rule is `roomCodeVisible`, so this row, the header line
            and the waiting screen cannot disagree.

            A room without a code says nothing: a broadcast is never given one
            and neither is a room made before codes shipped. */}
        {roomCodeVisible(stream, isHost) && stream.roomCode && (
          <CopyCodeRow
            label="Room code"
            hint={
              roomIsPrivate
                ? "For reading down a phone. Only the people you invited can use it."
                : "For reading down a phone. Anyone can type it in to walk in and listen."
            }
            code={stream.roomCode}
          />
        )}
        <CopyRow
          label="Listener link"
          hint={
            roomIsPrivate
              ? "Only the people you invited can open this."
              : "Anyone with this can walk in and listen."
          }
          url={houseShareUrl(shareOrigin, stream.id)}
        />
        {/*
          POST IT TO SQUARE — the share that stays inside the product.

          ogazboiz, 2026-09-21: "the share link I mean is like posting to
          Square for gist room". A copied link is for somewhere else; this puts
          the room in front of the people already here, and it arrives in the
          feed as the room's OWN card — live, not open yet, or ended — rather
          than as a line of characters nobody can read.

          It reuses the composer's prefill contract, so there is one door into
          posting rather than a second one built for rooms.
        */}
        {/*
          NOT OFFERED ON A PRIVATE ROOM. Posting one to the feed puts a card in
          front of everybody for a room that will refuse all of them — it
          advertises a door that is locked, and every tap ends in "this room is
          private". The host meant to invite people and instead published a
          disappointment with their name on it.

          Removed rather than disabled: a greyed row invites "why is this off?"
          about something that is never going to be on for this room.
        */}
        {!roomIsPrivate && (
        <Link
          href={sq(
            "/?compose=1&text=" + encodeURIComponent(houseShareUrl(shareOrigin, stream.id))
          )}
          onClick={() => setOverflowSheet(false)}
          className="ws-press mt-2 flex w-full items-center gap-3 rounded-xl px-1 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-heading">Post to Square</span>
            <span className="ws-meta block">
              Shares the room in the feed, with its own card. Anyone can walk in and listen.
            </span>
          </span>
          <IconChevronRight className="h-4 w-4 shrink-0 text-meta" />
        </Link>
        )}
        {/*
          WHO CAN COME IN — only for the host of a PRIVATE room with no house.

          That is the only shape with a guest list at all: a room belonging to a
          house takes its audience from the group and the route answers 400,
          and a guest asking gets a 403 because a list of who was invited is not
          for the invited to read. So it is drawn exactly where the service will
          answer, rather than drawn hopefully and the error hidden.
        */}
        {isHost && roomIsPrivate && !stream.houseConversationId && guestsSlot?.(stream.id)}

        {isHost && (
          <CopyRow
            label="Speaker link"
            hint="Puts their hand up the moment they arrive, so they are at the front of your tray. It does not seat them."
            url={houseShareUrl(shareOrigin, stream.id, true)}
          />
        )}
        <div className="mt-5">
          <p className="ws-meta mb-2">Keyboard</p>
          {/* An undiscoverable shortcut is not a feature. */}
          <ul className="space-y-1 text-[13px] text-body">
            <li>
              <kbd className="tnum font-semibold">M</kbd> — mute or unmute, when you have a seat
            </li>
            <li>
              <kbd className="tnum font-semibold">H</kbd> — raise or lower your hand
            </li>
          </ul>
        </div>
        {isHost && (
          <Button
            variant="secondary"
            className="mt-6 w-full"
            loading={endHouse.isPending}
            onClick={() => {
              setOverflowSheet(false);
              setConfirmLeave(true);
            }}
          >
            Close the gist room
          </Button>
        )}
      </Sheet>

      {/* ANOTHER ROOM IS ALREADY PLAYING. One room per tab: joining this one
          leaves that one, so the reader chooses — and staying takes them back
          to the room they are still in. */}
      <Sheet
        open={askingToSwitch}
        onClose={() => {
          const current = session.state.target?.streamId;
          session.dismissConflict();
          if (current) router.push(sq(`/gist-rooms/${current}`));
        }}
        title={hostingOther ? "Close your gist room?" : "Leave your gist room?"}
      >
        {/* A HOST who switches does not just leave: their room would go on
            with nobody running it, so joining CLOSES it, and says so. */}
        <p className="text-[13px] leading-5 text-body">
          {hostingOther
            ? session.stream
              ? `You're hosting "${houseTopic(session.stream)}". Joining this room will close it for everyone.`
              : "You're hosting another gist room. Joining this room will close it for everyone."
            : session.stream
              ? `You're in "${houseTopic(session.stream)}". Joining this room will leave it.`
              : "You're in another gist room. Joining this room will leave it."}
        </p>
        <div className="mt-5 flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            disabled={session.switching}
            onClick={() => {
              const current = session.state.target?.streamId;
              session.dismissConflict();
              if (current) router.push(sq(`/gist-rooms/${current}`));
            }}
          >
            Stay there
          </Button>
          <Button className="flex-1" loading={session.switching} onClick={() => void session.confirmConflict()}>
            {hostingOther ? "Close and join" : "Leave and join"}
          </Button>
        </div>
      </Sheet>

      <DestructiveConfirmSheet
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title={canCloseRoom ? "Close the gist room?" : "Leave quietly?"}
        body={
          isHost
            ? hasModerators
              ? "You can step out and leave it running, or close it for everybody."
              : "Everyone will be sent out and the gist room will be closed."
            : iCanEndRoom
              ? // The host handed this over on their way out. Both doors are
                // real for a moderator too: going is not the same as closing.
                "The host left you the closing. You can slip out quietly, or close it for everybody."
              : "Nobody is told you left."
        }
        confirmLabel={canCloseRoom ? "Close it" : "Leave"}
        /*
          THE HOST'S THIRD DOOR, and it only exists once somebody can hold the
          room without them.

          Leaving used to be the same act as closing for a host, which was true
          when the host was the only person who could run a room. With a
          moderator it stopped being true, and the dialog did not notice —
          ogazboiz hit it live: "i dont want to end the stream since i have
          moderator there was nowhere for me to pass it to him".

          There is nothing to HAND OVER: the moderator already holds the
          permissions. What was missing was a way for the host to go without
          taking the room with them, and that is just the listener's own leave.

          THE HINT IS THE HONEST PART. The service keeps a room alive while
          SOMEBODY is publishing and closes it after a few minutes of total
          silence, so "it keeps running" is only true if a moderator is
          actually on stage. A moderator sitting in the audience holds nothing
          open, and a host who is not told that would blame the feature rather
          than the empty stage.
        */
        secondary={
          iCanEndRoom
            ? {
                // A moderator's safe door is the ordinary leave — the room
                // keeps running without them exactly as it does for anyone
                // else who steps out.
                label: "Just leave",
                hint: "The room stays open and somebody else can close it.",
                onClick: () => void leaveNow(),
              }
            : isHost && hasModerators
            ? {
                label: "Leave it running",
                /*
                  SAID BEFORE THEY CONFIRM, because this act GRANTS something.
                  A permission that changes without being stated is not one the
                  host gave — and "your moderators can close the room" is a
                  bigger sentence than "you left".

                  The stage clause is the other half of the truth: appointing
                  somebody does not put them on a microphone, and only a live
                  track holds a room open. With everyone in the audience the
                  room really will close itself, and a host who was not told
                  that would blame the feature rather than the silence.
                */
                hint: someModeratorOnStage
                  ? "Your moderators keep the room open, and can close it when everyone's done."
                  : "Your moderators can close the room when everyone's done. None is on stage, so it will close on its own a few minutes after the last person stops talking.",
                loading: grantEndRoom.isPending,
                onClick: () => {
                  /*
                    GRANT, THEN GO — and go even if the grant failed. Trapping a
                    host in a room because a permission write did not land is
                    the worse trade, and the room still closes on its own once
                    everybody stops talking. The grant is best-effort inside
                    the mutation too, so one moderator whose row has gone does
                    not cost the others theirs.
                  */
                  grantEndRoom.mutate(moderatorIds ?? [], {
                    onSettled: () => void leaveNow(),
                  });
                },
              }
            : undefined
        }
        loading={endHouse.isPending}
        onConfirm={() => {
          if (canCloseRoom) {
            endHouse.mutate(stream.id, {
              onSuccess: () => {
                void session.end().then(() => router.push(sq("/gist-rooms")));
              },
            });
            return;
          }
          void leaveNow();
        }}
      />
    </main>
  );
}

/**
 * Where the roster panel lives: the chat's column from `md`, a sheet on a
 * phone. One component so the ONE `RoomRosterPanel` mount above needs no
 * second copy — a second would be a panel under the grid as well.
 */
function RosterSurface({
  phone,
  onClose,
  scrollRef,
  children,
}: {
  phone: boolean;
  onClose: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  if (phone) {
    return (
      <Sheet open onClose={onClose} bare panelClassName="h-[85dvh]">
        <div className="h-full p-4">{children}</div>
      </Sheet>
    );
  }
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 p-6 xl:scroll-mt-0">
      {children}
    </div>
  );
}

/** What each stage remedy is called on its button. */
const STAGE_ACTION_LABEL: Record<StageAction, string> = {
  request: "Ask to speak",
  retry: "Try again",
  rejoin: "Rejoin the stage",
  "request-again": "Ask again",
  leave: "Leave the stage",
};

/**
 * "Hand up · 4m".
 *
 * Elapsed only. POSITION ("2nd of 5") needs backend B3 —
 * `GET /speaker-requests/me` returning `position` and `total` — and the
 * host-scoped list cannot be read from here to compute it. It is absent rather
 * than invented: a queue position that is wrong is worse than no position,
 * because somebody will wait on it.
 */
function handLabel(createdAt: string | undefined): string {
  if (!createdAt) return "Hand up";
  const ms = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(ms) || ms < 0) return "Hand up";
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? "Hand up · now" : `Hand up · ${minutes}m`;
}

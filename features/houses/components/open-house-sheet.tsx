"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Spinner } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { Sheet } from "@/components/ui/sheet";
import { TopicTagsField } from "@/components/ui/topic-tags-field";
import { DateTimeField } from "@/components/ui/date-time-field";
import { cn } from "@/lib/cn";
import { useCreateStream } from "@/features/streams/hooks/use-streams";
import { acceptFor, ensureUploadLimits, uploadFile, validateUpload } from "@/lib/api/upload";
import {
  HOUSE_CATEGORY,
  TOPIC_MAX,
  TOPIC_WARN,
  clampTopic,
  housePath,
  isValidTopic,
} from "@/features/houses/lib/house";

/**
 * New Gistroom — node 59:7544.
 *
 * ─── THE FILE'S FIELDS, IN ITS ORDER ─────────────────────────────────────────
 * Visibility, Title, Tags, Upload image, Chat access, then a right-aligned
 * "Create Gistroom". The 40px fields are `white/4` inside a 1px `white/10` at a
 * 30px radius; labels are 13/SemiBold white; the dropzone is `#18181C` behind a
 * 1.5px `#26262B` dash (6,4) at a 16px radius. All verbatim.
 *
 * ─── WHAT IS REAL AND WHAT IS NOT ────────────────────────────────────────────
 * Title, Tags and the image are REAL: they map to `title`, `topics` and
 * `thumbnailUrl` on `POST /streams`, and the picture goes through the same
 * upload path every other image does.
 *
 * VISIBILITY and CHAT ACCESS are drawn and INERT, and the reasons differ:
 *
 *  - A stream's `visibility` is `public | ticketed` — a door charge, not an
 *    audience. There is no private room: a house is a room you can walk into,
 *    and nothing in the service can keep somebody out of one. A Private option
 *    that merely stored a flag would be a claim about who can hear you, which
 *    is the one kind of control that has to be true the day it ships.
 *  - Chat access has no field at all. Nothing distinguishes "anyone can chat"
 *    from "followers of the host", so both would be the same room.
 *
 * Both are disabled with the reason on them rather than removed, because the
 * design says they are coming and a reader should see what the room will
 * eventually offer — the house rule for a capability that does not exist yet.
 *
 * ─── WHAT THE FILE DROPS ─────────────────────────────────────────────────────
 * The old sheet had a "Pinned note" writing to `description`. 59:7544 has no
 * such field, so it is gone from the form. The column is untouched and rooms
 * that already have a note keep it.
 *
 * Creating and opening stay two acts: this makes the room `scheduled` and
 * routes to it, where the host lands on Backstage and turns their own
 * microphone on deliberately rather than as a side effect of naming a topic.
 */

/**
 * The file's 40px field: `white/4` inside a 1px `white/10` at a 30px radius.
 *
 * Every colour here is an alpha over the ground rather than a hex, which is
 * both what the file specifies and what this tree requires — `features/houses`
 * is asserted to contain NO hex literal, because a hex in a component is a
 * colour nobody can repoint. The design's #0088FF caret is the one property
 * dropped: there is no token for it and inventing one for a single field is
 * how a palette grows a colour nobody owns.
 */
const FIELD =
  "w-full rounded-[30px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/50";
const LABEL = "text-[13px] font-semibold text-white";

/** The file's 314x40 radio pill. */
function RadioPill({
  text,
  hint,
  selected,
  disabled,
  title,
  onSelect,
}: {
  text: string;
  hint?: string;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      title={title}
      className={cn(
        "flex h-10 max-w-[314px] flex-1 items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 text-[12px] leading-4 text-white/90",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-white" : "border-white/40"
        )}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
      {text}
      {hint && <span className="text-white/50">{hint}</span>}
    </button>
  );
}

export function OpenHouseSheet({
  open,
  onClose,
  /** Prefills the title — used by "Open a gist room about this" on a closed house. */
  initialTopic = "",
  /**
   * The house group this composer was opened from, when it was opened from
   * one — a GROUP thread's "Create Gist Room".
   *
   * It decides what PRIVATE MEANS here, which is the whole of ogazboiz's
   * simplification: the two words are the same in both places and the context
   * supplies the rest. Opened from a house, private is that house's members.
   * Opened from the street, private is the people picked in `guestPickerSlot`.
   */
  houseConversationId,
  /**
   * The people picker for a private room opened WITHOUT a house.
   *
   * A slot, because the directory belongs to the discovery slice and slices
   * never import each other — it is composed in `components/layout` like every
   * other cross-slice object. Absent, Private stays house-only, which is
   * exactly what this sheet did before guests existed: a surface that cannot
   * pick anybody must not offer a privacy it cannot deliver.
   */
  guestPickerSlot,
}: {
  open: boolean;
  onClose: () => void;
  initialTopic?: string;
  houseConversationId?: string;
  guestPickerSlot?: (args: {
    value: string[];
    onChange: (next: string[]) => void;
    max: number;
  }) => React.ReactNode;
}) {
  const router = useRouter();
  const create = useCreateStream();
  const [topic, setTopic] = useState(initialTopic);
  const [tags, setTags] = useState<string[]>([]);
  /*
    A ROOM OPENED FROM A HOUSE IS PRIVATE TO THAT HOUSE BY DEFAULT.

    This defaulted to "public" everywhere, so a room created inside a house was
    walk-in-able by anybody on the platform, and those walk-ins land in the
    Audience grid beside the house's own members. Read as one card that is
    "everyone is in the room even though they are not in the house", which is
    how ogazboiz reported it.

    The Private option already existed and is disabled without a house to be
    private TO, so the only rooms this changes are the ones that always had
    somewhere to belong. Opened from the street there is no house, the option
    is unavailable, and public remains the only thing it can be.

    A host who wants the room open still chooses Public. What changes is which
    way the default leans, and for a room created inside a house it should
    lean inward.
  */
  const [audience, setAudience] = useState<"public" | "private">(
    houseConversationId ? "private" : "public"
  );
  /*
    THE GUEST LIST — who may walk into a private room that has no house.

    Only ever sent for a house-less private room. From a house the group IS the
    audience, and the service refuses `guests` there rather than accepting a
    second source of truth for the same question — which is the right call: two
    answers to "who is allowed in" is how they come to disagree.

    Written with the room in ONE transaction (`guests` on create, not follow-up
    invites), so a failure cannot leave a live, half-invited room standing. An
    unknown id refuses the whole create rather than quietly shortening the list.
  */
  const [guests, setGuests] = useState<string[]>([]);
  /** The service's own ceiling on one create. */
  const GUEST_MAX = 50;
  /*
    Private WITHOUT a house needs somewhere to put the people, so the option is
    only offered where this sheet was actually given a picker. Without one it
    behaves exactly as it did before guests existed.
  */
  const canInvite = Boolean(guestPickerSlot);
  const privateByGuests = audience === "private" && !houseConversationId;
  /* Who may TYPE in the room (migration 041). `open` is the default and the
     historic behaviour, so a host who never touches this gets the room every
     room used to be. */
  const [chatAccess, setChatAccess] = useState<"open" | "followers">("open");
  /*
    NOW OR LATER. A gist room opens the moment it is made unless a time is put
    on it — `scheduledAt` is optional on the service and "omitted means now".
    A room with a time on it is listed under Upcoming until its host opens it.
  */
  const [startsLater, setStartsLater] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  /* Why a chosen time was refused. Set on submit — the clock may not be read
     while rendering, and "is this in the past" is only true at a moment. */
  const [startsAtError, setStartsAtError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // "Later" needs a time; whether that time has already passed is checked on
  // submit, where the clock may be read.
  /*
    A private room with no house and nobody invited is reachable by its host
    alone — a room with no one in it. Refused here rather than created, because
    the service would accept it quite happily and the host would only find out
    when nobody arrived.
  */
  const valid =
    isValidTopic(topic) &&
    (!startsLater || startsAt !== "") &&
    (!privateByGuests || guests.length > 0);

  const takeImage = async (file: File | undefined) => {
    if (!file || imageBusy) return;
    setImageError(null);
    await ensureUploadLimits();
    const problem = validateUpload(file, "image");
    if (problem) {
      setImageError(problem);
      return;
    }
    setImageBusy(true);
    try {
      const result = await uploadFile(file, undefined, "image");
      setImageUrl(result.url);
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : "That upload didn't finish.");
    } finally {
      setImageBusy(false);
    }
  };

  const submit = () => {
    // A time in the past is not a schedule. Refused here rather than by the
    // service, so the reader can fix it while the form is still open.
    const startsAtMs = startsLater ? new Date(startsAt).getTime() : Number.NaN;
    if (startsLater && !(Number.isFinite(startsAtMs) && startsAtMs > Date.now())) {
      setStartsAtError("Pick a time in the future.");
      return;
    }
    create.mutate(
      {
        title: topic.trim(),
        category: HOUSE_CATEGORY,
        // Omitted when empty: an empty array reads as "match no topics" on the
        // query side and there is no reason to teach the write side a second
        // meaning for it.
        ...(tags.length > 0 ? { topics: tags } : {}),
        ...(imageUrl ? { thumbnailUrl: imageUrl } : {}),
        // Omitted for "now" — the service reads an absent time as immediately.
        ...(startsLater ? { scheduledAt: new Date(startsAt).toISOString() } : {}),
        audience,
        /*
          THE HOUSE GROUP IS SENT WHENEVER WE HAVE ONE — public rooms included.

          It used to be gated on `audience === "private"`, which conflated two
          different questions: WHERE a room came from, and WHO may find it. A
          public room opened from a house group still belongs to that group, and
          the file's header says so — node 129:11892 names the house beside a
          "Join House" pill, which only makes sense for a room outsiders CAN
          see. Gating it meant every public room lost its community: the header
          row, the partner count and the House Members grid all rendered
          nothing, because `houseConversationId` came back null.

          The service agrees: it REQUIRES the field when `audience` is private
          and otherwise simply records it, checking that the conversation is a
          group and that the caller is a member of it.
        */
        ...(houseConversationId ? { houseConversationId } : {}),
        /*
          THE GUEST LIST, for a private room with no house and only then.

          Never sent alongside a house: the service refuses the pair outright,
          and it is right to — the group is already the audience there.
        */
        ...(privateByGuests && guests.length > 0 ? { guests } : {}),
        // `visibility` is the door CHARGE and is unrelated to `audience`: a
        // gist room is never ticketed in this slice.
          // Who may TYPE in the room. `open` is the default and the historic
          // behaviour; the service enforces the other one on send.
          chatAccess,
        visibility: "public",
      },
      {
        onSuccess: (stream) => {
          onClose();
          router.push(housePath(stream.id));
        },
      }
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      bare
      /*
        The file's own surface and WIDTH: 644 of content inside 16px gutters is
        a 676 panel, so this is a wide desktop form, not the 448 default sheet.
        `--color-raised` (#0f0f11) is the token nearest the file's Woodsmoke
        rgba(16,16,18,...) — this tree may not carry a hex, and inventing a
        second near-black for one panel is how a palette grows a colour nobody
        owns. Below `sm` it stays a full-width bottom sheet, which is what the
        Sheet does for every other form on a phone.
      */
      panelClassName="border border-white/[0.18] bg-raised/[0.62] backdrop-blur-[7px] sm:max-w-[676px] sm:rounded-[22px]"
    >
      <div className="flex max-h-[85dvh] flex-col gap-6 overflow-y-auto p-4">
        {/* The file's own chrome: the title left, a 43px round dismiss right —
            not the house Sheet's left-hand X. */}
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[16px] font-bold leading-6 text-white">New Gistroom</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ws-press flex h-[43px] w-[43px] shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-white/80 backdrop-blur-[4.84px] transition-colors hover:text-white"
          >
            <svg
              aria-hidden
              viewBox="0 0 22 22"
              className="h-[22px] w-[22px]"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
            >
              <path d="m5 5 12 12M17 5 5 17" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <span className={LABEL}>Visibility</span>
          <div className="flex flex-wrap gap-4">
            <RadioPill
              text="Public"
              selected={audience === "public"}
              onSelect={() => setAudience("public")}
            />
            <RadioPill
              text="Private"
              /*
                THE HINT NAMES WHO, AND WHO DEPENDS ON WHERE YOU ARE.

                "(only group members)" was true when a house was the only thing
                a room could be private to. From the street it is now the people
                you invite, and leaving the old words there would have told a
                host their room was shut to a group they never chose.
              */
              hint={houseConversationId ? "(only group members)" : "(only people you invite)"}
              selected={audience === "private"}
              // Still unavailable where this sheet was given no way to pick
              // anybody — see `canInvite`.
              disabled={!houseConversationId && !canInvite}
              title={
                houseConversationId || canInvite
                  ? undefined
                  : "Open a gist room from a house group to make it private to that group."
              }
              onSelect={() => setAudience("private")}
            />
          </div>
          <p className="flex items-center gap-2 text-[13px] text-meta">
            <svg
              aria-hidden
              viewBox="0 0 18 18"
              className="h-[18px] w-[18px] shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
            >
              <circle cx="9" cy="9" r="7" />
              <path d="M2.4 9h13.2M9 2a13 13 0 0 1 0 14M9 2a13 13 0 0 0 0 14" />
            </svg>
            {/*
              PUBLIC FROM INSIDE A HOUSE MEANS PUBLIC TO SQUARE, and it has to
              say so. Read inside a house, "public" is taken to mean "public to
              the house" — which is the opposite of what it does.
            */}
            {audience === "private"
              ? houseConversationId
                ? "Only members of this house group can find or join it."
                : "Only the people you invite can find or join it."
              : houseConversationId
                ? "Visible to everyone on Square, not just this house — it shows on the home page."
                : "Visible to anyone on Square — it shows on the home page."}
          </p>
        </div>

        {/*
          THE GUEST LIST SITS UNDER VISIBILITY, because it is the rest of that
          answer rather than a separate decision — choosing Private from the
          street is only half a sentence until somebody is named.

          It appears only for a house-less private room: from a house the group
          already is the audience, and a picker there would be offering a second
          answer to a question the house has already settled.
        */}
        {privateByGuests && guestPickerSlot?.({ value: guests, onChange: setGuests, max: GUEST_MAX })}

        <div className="flex flex-col gap-2">
          <label className={LABEL} htmlFor="gistroom-title">
            Title
          </label>
          <input
            id="gistroom-title"
            autoFocus
            value={topic}
            onChange={(event) => setTopic(clampTopic(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && valid && !create.isPending) submit();
            }}
            maxLength={TOPIC_MAX}
            placeholder="Enter gistroom title here..."
            className={FIELD}
          />
          <p
            className={cn(
              // See backstage.tsx: silver, not red. --color-down owns value
              // deltas, and a character count is not one.
              "tnum text-right text-[11px]",
              topic.length > TOPIC_WARN ? "font-semibold text-heading" : "text-meta"
            )}
          >
            {topic.length}/{TOPIC_MAX}
          </p>
        </div>

        <TopicTagsField selected={tags} onChange={setTags} max={5} />

        <div className="flex flex-col gap-2">
          <span className={LABEL}>Upload image</span>
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void takeImage(event.dataTransfer.files?.[0]);
            }}
            className="flex h-[174px] flex-col items-center justify-center gap-4 rounded-2xl border-[1.5px] border-dashed border-white/[0.14] bg-overlay p-6"
          >
            {imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- media hosts are unknown at build time */}
                <img src={imageUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setImageUrl(null)}
                  className="ws-press rounded-lg border border-white/[0.14] bg-white/5 px-4 py-2 text-[12px] font-semibold text-grey-400"
                >
                  Remove
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center gap-1 text-center">
                  <p className="text-[14px] font-semibold text-white">Add photos or media</p>
                  <p className="text-[12px] text-meta">
                    Drag and drop your images here or click to browse.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={imageBusy}
                  className="ws-press flex items-center gap-2 rounded-lg border border-white/[0.14] bg-white/5 px-4 py-2 text-[12px] font-semibold text-grey-400 disabled:opacity-60"
                >
                  {imageBusy && <Spinner className="h-3.5 w-3.5 text-grey-400" />}
                  {imageBusy ? "Uploading…" : "Choose File"}
                </button>
              </>
            )}
          </div>
          {/* The shared error component rather than a local red: `--color-down`
              owns value deltas and this tree is forbidden from borrowing it. */}
          {imageError && <InlineError error={new Error(imageError)} fallback={imageError} />}
          <input
            ref={fileInput}
            type="file"
            accept={acceptFor("image")}
            className="hidden"
            onChange={(event) => {
              void takeImage(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className={LABEL}>Starts</span>
          <div className="flex flex-wrap gap-4">
            <RadioPill text="Now" selected={!startsLater} onSelect={() => setStartsLater(false)} />
            <RadioPill text="Later" selected={startsLater} onSelect={() => setStartsLater(true)} />
          </div>
          {startsLater && (
            <>
              <DateTimeField
                value={startsAt}
                onChange={(next) => {
                  setStartsAt(next);
                  setStartsAtError(null);
                }}
                label="When the gist room opens"
              />
              <p className="text-[13px] text-meta">
                {startsAtError ?? "It waits under Upcoming Gistrooms until you open it."}
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className={LABEL}>Chat access</span>
          <div className="flex flex-wrap gap-4">
            <RadioPill
              text="Open chat"
              hint="(anyone can chat)"
              selected={chatAccess === "open"}
              onSelect={() => setChatAccess("open")}
            />
            <RadioPill
              text="Followers of the host"
              selected={chatAccess === "followers"}
              onSelect={() => setChatAccess("followers")}
            />
          </div>
          {/* It gates WRITING, never reading — say so, because "chat access"
              could reasonably be read either way. */}
          <p className="text-[12px] leading-4 text-meta">
            {chatAccess === "open"
              ? "Anyone in the room can send a message."
              : "Only people who follow you — and anyone you invite to speak — can send a message. Everyone can still read."}
          </p>
        </div>

        {create.isError && (
          <InlineError error={create.error} fallback="Couldn't open that gist room." />
        )}

        <div className="flex justify-end">
          <Button size="lg" loading={create.isPending} disabled={!valid} onClick={submit}>
            Create Gistroom
          </Button>
        </div>

        <p className="text-center text-[12px] leading-5 text-meta">
          You will check your microphone before anyone can hear you. Gist rooms are voice only.
        </p>
      </div>
    </Sheet>
  );
}

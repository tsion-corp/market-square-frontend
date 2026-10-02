"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/button";
import { RowSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useMe } from "@/hooks/use-me";
import { usePeople } from "@/features/discovery";
import { InboxSearch } from "@/features/messages/components/inbox-chrome";
import { useCreateGroup, type NewChatPickerProps } from "@/features/messages";
import {
  acceptFor,
  ensureUploadLimits,
  uploadFile,
  validateUpload,
} from "@/lib/api/upload";
import { errorMessage } from "@/lib/api/envelope";
import type { Profile } from "@/lib/api/schemas";

/**
 * Create Group — nodes 49:7098 then 51:7270.
 *
 * TWO steps, because the file draws two: choose who is in it, then name and
 * describe it. That order is the right way round — the roster is the thing a
 * person came to build, and asking for a title first makes them name a room
 * before they know who is in it.
 *
 * ─── STEP 1 (49:7098) ────────────────────────────────────────────────────────
 * The New Gist panel exactly — 347 at 62% woodsmoke behind a 7px blur, the
 * same 315x38 search pill, the same 54.5px rows — plus a 16px `tick-square` at
 * the row's right edge (x=283) and a 315-wide Continue button in `#7E3BEB`.
 *
 * That `#7E3BEB` is `--color-spotlight`, the ramp's dark stop, and it is used
 * as a SOLID FILL WITH WHITE INK — which is exactly the contrast rule in
 * CLAUDE.md (white on spotlight is 5.66:1; white on `--color-create` is only
 * 3.64:1 and fails AA). So it is the token, not the raw hex.
 *
 * The file's `tick-square` has `outline` and `bold` variants — unchecked and
 * checked — which is what settled the question the New Gist panel could not
 * answer: that slot on the right of a row IS the selection control.
 *
 * ─── STEP 2 (51:7270) ────────────────────────────────────────────────────────
 * A WIDER panel (644 of content) with its own 43px close button, then Title,
 * Description, Upload image, Visibility, and a right-aligned Create Group.
 *
 * ─── WHAT THE SERVICE CAN AND CANNOT HOLD ────────────────────────────────────
 * Title, description and image are REAL — they are columns, and the picture
 * goes through the same upload verification a message attachment does, so a
 * group image can only ever be a file this service stored.
 *
 * VISIBILITY IS REAL AND ENFORCED. This block used to say the opposite —
 * "drawn and inert", "no directory, no join route", "Public is disabled" —
 * and every clause of that has since become false: `GET
 * /conversations/discover` lists public houses, `POST /conversations/:id/join`
 * lets somebody walk into one, and both create and PATCH accept `visibility`.
 * The control below has been live for some time; only this comment lagged.
 *
 * PUBLIC CARRIES BOTH PROMISES AT ONCE: the group is LISTED where people
 * browse houses, AND anybody holding it may join. It is the stronger of the
 * two, so the copy is worded for the stronger one — "anyone with the link can
 * join" understated what actually happens.
 *
 * PRIVATE IS NOT "nobody gets in". An invite link is a separate door that
 * never consulted visibility, so a private group is still enterable by anyone
 * holding a link somebody made. Saying so is the difference between a promise
 * and a surprise.
 *
 * It can be changed afterwards, in Group settings — owner only, stricter than
 * the rest of that endpoint. See features/messages/components/
 * group-settings-sheet.tsx.
 */

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;

function TickSquare({ checked }: { checked: boolean }) {
  // The file's `tick-square`, both variants, at its 16px box. Drawn inline
  // because Figma's image endpoint was unreachable; swap in the export when it
  // is, and nothing else here changes.
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 ${checked ? "text-white" : "text-white/40"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={checked ? 1.6 : 1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.9" y="1.9" width="12.2" height="12.2" rx="3.6" />
      {checked && <path d="m5.2 8.2 2 2 3.6-4.2" />}
    </svg>
  );
}

export function CreateGroupFlow({ open, onClose, onStarted }: NewChatPickerProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Profile[]>([]);
  const [title, setTitle] = useState("");
  /* Whether somebody holding the link may JOIN this group themselves. PRIVATE
     is the default and the behaviour every group already had. */
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const me = useMe();
  const createGroup = useCreateGroup();
  const people = usePeople(query, "followers", open && step === 1);
  const sentinel = useInfiniteScroll(
    () => people.fetchNextPage(),
    Boolean(people.hasNextPage && !people.isFetchingNextPage)
  );

  const items = (people.data?.pages.flatMap((page) => page.items) ?? []).filter(
    // The service adds the caller as the group's owner, so they are never a row.
    (profile) => !me.data || profile.id !== me.data.id
  );

  const close = () => {
    setStep(1);
    setQuery("");
    setSelected([]);
    setTitle("");
    setDescription("");
    setImageUrl(null);
    setImageError(null);
    onClose();
  };

  /*
    NO CLIENT-SIDE CAP. Every tap toggles; nothing is ever refused here.

    There used to be `GROUP_MAX = 20`, which both blocked the twenty-first
    selection and printed "(max)" on Continue. It is gone because the size of a
    group is the SERVICE's rule, and stating it in two places is how the two
    disagree — which they already had: the service refused with "at most 20
    other people" on create and "at most 21 people" on add, two numbers for one
    rule, neither of them the number a person counts in the header.

    The cost of removing it is that the refusal now arrives at SUBMIT rather
    than at tap, after somebody has picked people and named the group. That is
    why the refusal is rendered on the second step — see the note there.
  */
  const toggle = (profile: Profile) =>
    setSelected((current) =>
      current.some((person) => person.id === profile.id)
        ? current.filter((person) => person.id !== profile.id)
        : [...current, profile]
    );

  const takeImage = async (file: File | undefined) => {
    if (!file || imageBusy) return;
    setImageError(null);
    await ensureUploadLimits();
    // `image`, not `attachment` — a group picture is a picture. A clip here
    // would upload happily and then be refused by the service, which checks
    // the stored object's kind.
    const problem = validateUpload(file, "image");
    if (problem) {
      setImageError(problem);
      return;
    }
    setImageBusy(true);
    try {
      // A group picture is a picture — stated here too, so the uploader's own
      // check matches the one the picker just ran.
      const result = await uploadFile(file, undefined, "image");
      setImageUrl(result.url);
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : "That upload didn't finish.");
    } finally {
      setImageBusy(false);
    }
  };

  const submit = () => {
    const name = title.trim();
    if (name.length === 0 || selected.length === 0 || createGroup.isPending) return;
    createGroup.mutate(
      {
        title: name,
        visibility,
        memberIds: selected.map((person) => person.id),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
      {
        onSuccess: (conversation) => {
          // Only what the response states, plus what a brand-new group IS.
          // `memberCount` stays null rather than being built from the
          // selection: the service adds the caller as owner, so any count made
          // here would be one short and silently corrected on the next poll.
          onStarted({
            id: conversation.id,
            kind: "group",
            // A new house talks: nobody makes an announcement board by default,
            // and the caller who just created it is its owner, so they may open
            // a room in it. Both are what the service will say on the next read.
            whoCanPost: "everyone",
            canOpenRoom: true,
      // Both stated rather than defaulted: this group was just created BY the
      // caller, and with the visibility they chose on the form.
      createdBy: me.data?.id ?? null,
      // Nobody invited you into a house you just made.
      invitedBy: null,
      // Neither is set at creation; both are owner edits afterwards.
      website: null,
      weeklyRoomLimit: null,
      visibility,
      // The creator is its owner, and every member starts at all/all — the
      // next inbox poll brings the stored levels.
      viewerRole: "owner" as const,
      notificationSettings: null,
          imageUrl: imageUrl ?? null,
          description: description.trim() || null,
            title: conversation.title ?? name,
            peer: null,
            members: [],
            memberCount: null,
            lastSender: null,
            lastMessage: null,
            lastMessageAt: conversation.lastMessageAt ?? null,
            lastActiveAt: null,
            requestedBy: null,
            unreadCount: 0,
            // Streaks are a 1:1 thing; a group's is always zero.
            snapStreak: 0,
            snapStreakExpiresAt: null,
          });
          close();
        },
      }
    );
  };

  if (step === 1) {
    return (
      <Sheet
        open={open}
        onClose={close}
        bare
        panelClassName="border border-white/[0.18] bg-[#101012]/[0.62] backdrop-blur-[7px] sm:max-w-[347px] sm:rounded-[22px]"
      >
        <div className="flex flex-col gap-3 p-4">
          <h2 className="text-[14px] font-bold leading-5 text-white">
            Select gist partners to add
          </h2>

          <InboxSearch
            value={query}
            onChange={setQuery}
            id="group-people-search"
            label="Search people"
          />

          <div className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto">
            {people.isPending && [0, 1, 2].map((i) => <RowSkeleton key={i} />)}

            {people.isError && (
              <ErrorState
                error={people.error}
                fallback="Couldn't load people."
                onRetry={() => people.refetch()}
              />
            )}

            {people.isSuccess && items.length === 0 && (
              <EmptyState
                glyph="◇"
                title={query.trim() ? "No matches" : "Nobody to show yet"}
                body={
                  query.trim()
                    ? "No one here matches that name."
                    : "The directory is empty right now."
                }
              />
            )}

            {items.map((profile) => {
              const chosen = selected.some((person) => person.id === profile.id);
              const name = profile.displayName ?? profile.username;
              return (
                <button
                  key={profile.id}
                  type="button"
                  role="checkbox"
                  aria-checked={chosen}
                  onClick={() => toggle(profile)}
                  className={`ws-press flex h-[54.5px] items-center gap-[9px] rounded-xl border bg-white/[0.03] px-3 text-left transition-colors ${
                    chosen
                      ? "border-white/30 bg-white/[0.08]"
                      : "border-white/10 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
                    <Avatar name={name} seed={profile.id} src={profile.avatarUrl} size={38} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] font-bold leading-4 text-white">
                      {name}
                    </span>
                    <span className="truncate text-[11px] leading-[16.5px] text-white/50">
                      {profile.followerCount > 0
                        ? `${profile.followerCount.toLocaleString()} followers`
                        : `@${profile.username}`}
                    </span>
                  </span>
                  <TickSquare checked={chosen} />
                </button>
              );
            })}

            <div ref={sentinel} />
            {people.isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <Spinner className="h-5 w-5 text-meta" />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={selected.length === 0}
            // The file's #7E3BEB is --color-spotlight: a solid purple fill
            // takes the ramp's DARK stop with white ink, per the contrast rule.
            className="ws-press flex items-center justify-center rounded-full bg-spotlight px-5 py-3 text-[16px] font-semibold leading-[22px] tracking-[-0.007em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {selected.length === 0
              ? "Continue"
              : `Continue with ${selected.length}`}
          </button>
        </div>
      </Sheet>
    );
  }

  const label = "text-[13px] font-semibold text-white";
  const field =
    "w-full rounded-[30px] border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[14px] text-white outline-none placeholder:text-white/50 caret-[#0088FF]";

  return (
    <Sheet
      open={open}
      onClose={close}
      bare
      wide
      panelClassName="border border-white/[0.18] bg-[#101012]/[0.62] backdrop-blur-[7px] sm:rounded-[22px]"
    >
      <div className="flex max-h-[85dvh] flex-col overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[14px] font-bold leading-5 text-white">New Group</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="ws-press flex h-[43px] w-[43px] items-center justify-center rounded-full bg-white/[0.04] backdrop-blur-[4.84px] text-white/80 transition-colors hover:text-white"
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

        <div className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className={label} htmlFor="group-title">
              Title
            </label>
            <input
              id="group-title"
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, TITLE_MAX))}
              placeholder="Enter group title here..."
              autoComplete="off"
              className={field}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className={label} htmlFor="group-description">
              Description
            </label>
            {/* The file gives this the same 40px box as the title. It is a
                textarea in the file and reads as one here, so it starts at that
                height and grows — a description field you cannot see the end of
                is the kind of fidelity that costs the user their words. */}
            <textarea
              id="group-description"
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="Enter description here"
              className={`${field} min-h-10 resize-y`}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className={label}>Upload image</span>
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void takeImage(event.dataTransfer.files?.[0]);
              }}
              className="flex h-[174px] flex-col items-center justify-center gap-4 rounded-2xl border-[1.5px] border-dashed border-[#26262B] bg-[#18181C] p-6"
            >
              {imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- media hosts are unknown at build time */}
                  <img src={imageUrl} alt="" className="h-20 w-20 rounded-xl object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageUrl(null)}
                    className="ws-press rounded-lg border border-[#26262B] bg-white/5 px-4 py-2 text-[12px] font-semibold text-[#A1A1AA]"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center gap-1 text-center">
                    <p className="text-[14px] font-semibold text-white">Add photos or media</p>
                    <p className="text-[12px] text-[#71717A]">
                      Drag and drop your images here or click to browse.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={imageBusy}
                    className="ws-press flex items-center gap-2 rounded-lg border border-[#26262B] bg-white/5 px-4 py-2 text-[12px] font-semibold text-[#A1A1AA] disabled:opacity-60"
                  >
                    {imageBusy ? <Spinner className="h-3.5 w-3.5 text-[#A1A1AA]" /> : null}
                    {imageBusy ? "Uploading…" : "Choose File"}
                  </button>
                </>
              )}
            </div>
            {imageError && (
              <p role="alert" className="text-[12px] text-down">
                {imageError}
              </p>
            )}
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
            <span className={label}>Visibility</span>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    { key: "public", text: "Public" },
                    { key: "private", text: "Private" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={visibility === option.key}
                    onClick={() => setVisibility(option.key)}
                    className={`ws-press flex h-10 max-w-[314px] flex-1 items-center gap-2 rounded-full border bg-white/5 px-3 text-[12px] leading-4 text-white/90 ${
                      visibility === option.key ? "border-white/40" : "border-white/20"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                        visibility === option.key ? "border-white" : "border-white/40"
                      }`}
                    >
                      {visibility === option.key && (
                        <span className="h-2 w-2 rounded-full bg-white" />
                      )}
                    </span>
                    {option.text}
                  </button>
                ))}
            </div>
            {/* The file's placeholder is "Visible to ..."; this says what is
                actually true, because a line under a privacy control is read as
                a promise. */}
            <p className="flex items-center gap-2 text-[13px] text-[#71717A]">
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
              {visibility === "private"
                ? "Only people who are added, or who already have an invite link, can get in."
                : "Anyone can find this group and join it."}
            </p>
          </div>

          {/*
            THE REFUSAL HAS TO BE SEEN, and before this it was not.

            The mutation carried only `onSuccess`. A 400 set `createGroup.error`
            and nothing rendered it: the spinner stopped, the sheet sat there,
            and the group was simply not created. That was survivable only while
            a client-side cap kept the service's own limit unreachable — remove
            the cap, as this change does, and the silent path becomes the one
            people actually hit, after picking members and naming the group.

            Read straight off the mutation rather than copied into state: a
            second copy is a second thing to clear, and `mutate` already resets
            it on the next attempt.

            `errorMessage` is the app's translation layer, so the service's own
            sentence passes through when it is one a person can act on ("A group
            holds at most N people") while UNAUTHORIZED, RATE_LIMITED and a
            transport failure each get their own copy instead of a raw code.

            Nothing is closed or cleared, so the fix is to remove somebody
            rather than to start the group again.
          */}
          {createGroup.isError && (
            <p role="alert" className="text-[12px] text-down">
              {errorMessage(createGroup.error, "Couldn't create that group — try again.")}
            </p>
          )}

          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="ws-press text-[13px] font-semibold text-white/60 transition-colors hover:text-white"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={title.trim().length === 0 || createGroup.isPending}
              className="ws-press flex items-center justify-center rounded-full bg-spotlight px-5 py-3 text-[16px] font-bold leading-[22px] tracking-[-0.007em] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {createGroup.isPending ? <Spinner className="h-4 w-4 text-white" /> : "Create Group"}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

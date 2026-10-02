"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/button";
import { ensureUploadLimits, uploadFile, validateUpload } from "@/lib/api/upload";
import { useUpdateGroup, useSetWhoCanPost } from "@/features/messages/hooks/use-messages";
import type { Conversation } from "@/features/messages/lib/types";

/**
 * EDITING A GROUP AFTER IT EXISTS.
 *
 * Creating a group asks for a title, a description, a picture and a
 * visibility — and then there was nowhere to change any of them
 * (ogazboiz: "inside a group there is suppose to be a place where we can edit
 * this settings"). Every one of those was already a real column and a real
 * PATCH; the form was the missing half.
 *
 * It deliberately mirrors step 2 of the create flow, field for field and in
 * the same order. A settings screen that asks different questions from the
 * one that created the thing teaches people that the two are different
 * objects.
 *
 * ─── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 * Members, roles, ownership and invite links are NOT here. They already have
 * their own sheet reached from the thread, they are about PEOPLE rather than
 * about the group's profile, and duplicating them would put two ways to remove
 * somebody in one product.
 *
 * ─── ONLY WHAT CHANGED IS SENT ───────────────────────────────────────────────
 * An absent field on the PATCH is left alone; a null clears it. So saving a
 * title must not carry a description the person never touched — that is how a
 * form quietly erases a field somebody else wrote.
 */

// The service's own column limits (same as the create-group form). Enforced on
// input so a long title/description is trimmed as it is typed rather than
// accepted here and rejected by the API's VALIDATION_ERROR on save (2026-09-30).
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;

export function GroupSettingsSheet({
  open,
  onClose,
  conversation,
}: {
  open: boolean;
  onClose: () => void;
  conversation: Conversation;
}) {
  const save = useUpdateGroup(conversation.id);

  const [title, setTitle] = useState(conversation.title ?? "");
  const [description, setDescription] = useState(conversation.description ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(conversation.imageUrl ?? null);
  const [visibility, setVisibility] = useState<"public" | "private">(
    conversation.visibility === "public" ? "public" : "private"
  );
  const [website, setWebsite] = useState(conversation.website ?? "");
  /*
    THE CAP IS A STRING IN THE FORM AND A NUMBER-OR-NULL ON THE WIRE.

    Empty means UNCAPPED, which is a real setting rather than a blank — it is
    how an owner removes a cap they set last month. Holding it as a string is
    what lets the field be empty at all; a number state would have to invent a
    sentinel and then remember which one it chose.
  */
  const [roomLimit, setRoomLimit] = useState(
    conversation.weeklyRoomLimit === null ? "" : String(conversation.weeklyRoomLimit)
  );
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  /*
    VISIBILITY IS OWNER-ONLY, and that is stricter than the rest of this form.
    An admin may edit the title, description and picture, and gets a 403 on
    visibility. So the control is gated on the role rather than on "can edit
    this form" — otherwise an admin sees a switch that always fails, which is
    worse than not offering it.
  */
  const isOwner = conversation.viewerRole === "owner";
  /*
    WHO MAY TYPE — leaders, which is a WIDER gate than the owner-only fields
    above. The service lets an owner or an admin set it, so gating it on the
    owner alone would hide a control from people who may legitimately use it.
  */
  const isLeader = isOwner || conversation.viewerRole === "admin";
  const whoCanPost = useSetWhoCanPost(conversation.id);
  const announcementOnly = conversation.whoCanPost === "admins";

  // The picture goes through the same verification a message attachment does,
  // so a group image can only ever be a file this service stored.
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

  const named = title.trim();
  /*
    WHAT THE CAP FIELD IS ASKING FOR, or `undefined` for "unchanged".

    Empty is null (uncapped) and a number is itself, but anything that is not a
    whole number in range is simply NOT AN EDIT — the form refuses to send it
    rather than guessing, and the hint below says so. Sending a bad value to
    find out it was bad is a round trip the user watches.
  */
  const roomLimitTrimmed = roomLimit.trim();
  const roomLimitParsed = roomLimitTrimmed === "" ? null : Number(roomLimitTrimmed);
  const roomLimitValid =
    roomLimitParsed === null ||
    (Number.isInteger(roomLimitParsed) && roomLimitParsed >= 1 && roomLimitParsed <= 50);
  const roomLimitEdit =
    roomLimitValid && roomLimitParsed !== (conversation.weeklyRoomLimit ?? null)
      ? roomLimitParsed
      : undefined;
  // Only the fields that actually moved. See the header.
  const edit = {
    ...(named && named !== (conversation.title ?? "") ? { title: named } : {}),
    /*
      TRIMMED AT THE ENDS ONLY, AND THE INSIDE IS LEFT ALONE.

      `trim()` strips leading and trailing whitespace and touches nothing
      between, which is what a description wants: no accidental blank line at
      the top, every deliberate one in the middle kept. The renderer prints
      them now (`whitespace-pre-line`), so what the author typed is what the
      house shows.
    */
    ...(description.trim() !== (conversation.description ?? "")
      ? { description: description.trim() || null }
      : {}),
    ...(imageUrl !== (conversation.imageUrl ?? null) ? { imageUrl } : {}),
    ...(isOwner && visibility !== (conversation.visibility ?? "private") ? { visibility } : {}),
    // Trimmed-empty CLEARS the link. `|| null` is the clear, and the outer
    // comparison is what stops an untouched field being sent at all.
    ...(website.trim() !== (conversation.website ?? "")
      ? { website: website.trim() || null }
      : {}),
    ...(isOwner && roomLimitEdit !== undefined ? { weeklyRoomLimit: roomLimitEdit } : {}),
  };
  const changed = Object.keys(edit).length > 0;

  const field =
    "w-full rounded-2xl border border-white/12 bg-black/35 px-3 py-2 text-[14px] text-white outline-none placeholder:text-meta focus:border-white/25";

  return (
    <Sheet open={open} onClose={onClose} title="Group settings">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-white/5">
            {imageUrl ? (
              // A plain <img>, not next/image: the upload host (Cloudinary) is
              // not in next.config's image hosts, and the app renders every
              // remote/uploaded image this way — same as the create-group
              // preview and Avatar. next/image threw "hostname not configured"
              // whenever a group with a picture opened its settings (2026-09-30).
              // eslint-disable-next-line @next/next/no-img-element -- remote upload host is unknown at build time
              <img src={imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[20px] text-meta">{(named || "G").slice(0, 1).toUpperCase()}</span>
            )}
          </span>
          <label className="ws-press cursor-pointer rounded-full border border-white/15 px-4 py-2 text-[12px] font-semibold text-white/80">
            {imageBusy ? "Uploading…" : imageUrl ? "Change picture" : "Upload picture"}
            <input
              type="file"
              /* The service stores png, jpeg, webp and gif and refuses the
                 rest, so the picker offers exactly those — image/* would let
                 somebody choose a HEIC straight off an iPhone and only find
                 out it was refused after the upload finished. */
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              disabled={imageBusy}
              onChange={(event) => void takeImage(event.target.files?.[0])}
            />
          </label>
        </div>
        {imageError && (
          <p role="alert" className="text-[12px] text-down">
            {imageError}
          </p>
        )}

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-meta">Name</span>
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))} className={field} />
        </label>

        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-meta">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
            rows={5}
            placeholder="What is this group for?"
            className={field}
          />
        </label>

        <div>
          <span className="mb-2 block text-[12px] font-semibold text-meta">Who can get in</span>
          <div className="flex flex-col gap-2">
            {(["private", "public"] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={!isOwner}
                aria-pressed={visibility === option}
                onClick={() => setVisibility(option)}
                className={`ws-press flex items-center gap-2 rounded-full border bg-white/5 px-3 py-2.5 text-left text-[13px] text-white/90 disabled:cursor-not-allowed disabled:opacity-50 ${
                  visibility === option ? "border-white/40" : "border-white/20"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    visibility === option ? "border-white" : "border-white/40"
                  }`}
                >
                  {visibility === option && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
                {option === "private" ? "Private" : "Public"}
              </button>
            ))}
          </div>
          {/*
            PUBLIC CARRIES BOTH PROMISES AT ONCE — the group is LISTED where
            people browse houses, AND anybody who has it can walk in. The
            weaker wording ("anyone with the link can join") was what this
            product used to say, and it understates what actually happens.

            Private is not "nobody gets in": an invite link is a separate door
            that never consulted visibility, and going private does not revoke
            the links already handed out. Saying so here is the difference
            between a promise and a surprise.
          */}
          <p className="mt-2 text-[12px] leading-4 text-meta">
            {visibility === "private"
              ? "Only people who are added, or who already have an invite link, can get in."
              : "Anyone can find this group and join it."}
          </p>
          {!isOwner && (
            <p className="mt-1 text-[12px] leading-4 text-meta">
              Only the group&apos;s owner can change this.
            </p>
          )}
        </div>

        {/*
          THE HOUSE'S LINK. Optional, cleared by emptying it, and rendered on
          the profile only when it is an http(s) URL — the profile re-checks
          rather than trusting this, because a public page must never carry a
          `javascript:` href.
        */}
        <div>
          <label className="block text-[13px] font-semibold text-heading" htmlFor="house-website">
            Website
          </label>
          <input
            id="house-website"
            type="url"
            inputMode="url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://"
            className={cn(field, "mt-1.5")}
          />
          <p className="mt-1 text-[12px] leading-4 text-meta">
            Shown on the house profile. Leave it empty for none.
          </p>
        </div>

        {/*
          ROOMS PER WEEK — OWNER ONLY, like visibility, and gated on the role
          rather than on "can edit this form": an admin who sees a field that
          always 403s is worse off than one who never sees it.

          EMPTY MEANS UNCAPPED, and that is a setting rather than a blank. It
          is the only way to remove a cap, so the hint has to say it — a field
          whose empty state does something needs to admit what.
        */}
        {isOwner && (
          <div>
            <label className="block text-[13px] font-semibold text-heading" htmlFor="house-room-limit">
              Rooms per week
            </label>
            <input
              id="house-room-limit"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={roomLimit}
              onChange={(event) => setRoomLimit(event.target.value)}
              placeholder="No limit"
              aria-invalid={!roomLimitValid}
              className={cn(field, "mt-1.5", !roomLimitValid && "border-danger")}
            />
            <p className="mt-1 text-[12px] leading-4 text-meta">
              {roomLimitValid
                ? "How many gist rooms this house can open in any 7 days. Empty means no limit."
                : "Pick a whole number from 1 to 50, or empty it for no limit."}
            </p>
          </div>
        )}

        {/*
          WHO CAN POST — saved on the spot, NOT with the form.

          Everything above is a draft the Save button commits. This is a switch
          with an immediate effect on everybody else in the house, and burying
          it in a form that also renames the group would mean somebody silencing
          a hundred people as a side effect of fixing a typo. It is its own route
          on the service for the same reason.

          Reading is never affected and the copy says so: a member of an
          announcement house sees every word and simply cannot add one.
        */}
        {isLeader && (
          <div>
            <span className="block text-[13px] font-semibold text-heading">Who can post</span>
            <div className="mt-1.5 flex gap-2">
              {(["everyone", "admins"] as const).map((option) => {
                const on = conversation.whoCanPost === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={whoCanPost.isPending || on}
                    onClick={() => whoCanPost.mutate(option)}
                    className={cn(
                      "ws-press flex-1 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed",
                      on
                        ? "border-white bg-white text-black"
                        : "border-white/20 text-body hover:bg-white/10 disabled:opacity-60"
                    )}
                  >
                    {option === "everyone" ? "Everyone" : "Admins only"}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[12px] leading-4 text-meta">
              {announcementOnly
                ? "Only admins can send messages. Everyone else still reads the whole conversation."
                : "Every member can send messages."}
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={!changed || !named || !roomLimitValid || save.isPending || imageBusy}
          onClick={() => save.mutate(edit, { onSuccess: onClose })}
          className="ws-btn-create ws-press flex w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending && <Spinner className="h-4 w-4" />}
          {!named ? "A group needs a name" : changed ? "Save changes" : "Nothing to save"}
        </button>
      </div>
    </Sheet>
  );
}

"use client";

import Link from "next/link";
import { coverPictureUrl, decodeAvatarCover } from "@/lib/profile-backgrounds";
import { asset, sq } from "@/lib/square-path";
import { useImageUpload } from "@/components/ui/use-image-upload";
import { GENDER_OPTIONS, normalizeGender } from "@/lib/gender";
import { useState } from "react";
import { resolveHandles } from "@/lib/api/mentions";
import { errorCode } from "@/lib/api/envelope";
import type { Profile } from "@/lib/api/schemas";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { InlineError } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { useUpdateMe } from "@/features/profile/hooks/use-profile";

/*
  The file's `textarea`: 40 tall at an 8 radius, white at 4% behind a 1px white
  border at 10.2% — not the solid white the render suggests — padded 12 and
  holding Geist 400 14/18.2 with its placeholder at 50%.
*/
const FIELD_INPUT =
  "h-10 w-full rounded-lg border border-white/[0.102] bg-white/[0.04] px-3 text-[14px] leading-[18.2px] text-white outline-none placeholder:text-white/50 focus:border-white/30";

export function EditProfileSheet({
  me,
  open,
  onClose,
}: {
  me: Profile;
  open: boolean;
  onClose: () => void;
}) {
  const update = useUpdateMe();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me.avatarUrl);
  /*
    The character being edited, as a share code.

    Recovered from the picture itself: a generated avatar's URL contains the
    code that made it, so reopening the studio continues from where they left
    off instead of starting over. Null means the picture is a photograph or a
    placeholder — nothing to continue from, so the studio opens on a fresh one.
  */
  const savedCover = decodeAvatarCover(me.avatarConfig);
  const characterCode = savedCover.code;
  /* Self-declared, all three, and all optional. `?? ""` because null is the
     real "hasn't said" and an input cannot hold it. */
  const [city, setCity] = useState(me.city ?? "");
  const [region, setRegion] = useState(me.region ?? "");
  const [gender, setGender] = useState<string>(
    normalizeGender(me.gender) ?? "",
  );
  const [website, setWebsite] = useState(me.website ?? "");

  const usernameTaken = errorCode(update.error) === "CONFLICT";

  const avatar = useImageUpload(avatarUrl, setAvatarUrl);

  /*
    A COVER PHOTO YOU UPLOAD, beside the character you build.

    The cover was the avatar studio's ground and nothing else, so somebody who
    wanted their own picture behind their name had no way to put one there —
    which is half of "let people finish their profile". Both still exist and
    they do not fight: the studio sets the ground under a character, and this
    sets a photograph. `coverUrl` wins where it is set, which is what the
    profile cover already reads.

    The service runs it through `verifyAttachment`, so only a picture this
    person uploaded through our own flow is accepted — the same shared upload
    path every other image here uses, not a URL anybody can type.
  */
  const [coverUrl, setCoverUrl] = useState<string | null>(me.coverUrl ?? null);
  const cover = useImageUpload(coverUrl, setCoverUrl);

  const save = async () => {
    /*
      RESOLVED AT SAVE, because this field has no picker.

      The chat composer remembers who was chosen from its autocomplete; a bio
      is a plain textarea, so the handles in the text are all we have.
      `resolveHandles` asks the directory for each and keeps only an EXACT
      match — "@ada" that could be adaeze or adaobi stays plain text rather
      than tagging a stranger permanently on somebody's profile.

      Awaited rather than fired alongside: a save landing before its mentions
      resolve would store the bio with an empty array, and the tags would
      vanish until the next edit.
    */
    const bioMentions = await resolveHandles(bio);
    update.mutate(
      {
        displayName: displayName.trim() || undefined,
        username: username.trim() !== me.username ? username.trim() : undefined,
        bio,
        bioMentions,
        avatarUrl: avatarUrl ?? undefined,
        /*
          `null` CLEARS, `undefined` LEAVES IT — and the two are different acts
          here. Somebody who removed their cover meant to remove it, so the
          null travels; somebody who never touched it must not have the
          studio's ground wiped by opening this sheet and saving a bio.
        */
        coverUrl: coverUrl === (me.coverUrl ?? null) ? undefined : coverUrl,
        // Sent as typed, blank included: an omitted field means "leave it" and
        // somebody who emptied the box meant "clear it". The service reads a
        // blank string as a clear.
        city: city.trim(),
        region: region.trim(),
        website: website.trim() || null,
        gender: gender.trim(),
      },
      { onSuccess: onClose },
    );
  };

  /*
    ─── NODE 2112:19429, READ RATHER THAN EYEBALLED ────────────────────────────
    A 534-wide glass panel at a 22 radius: #201F1F at 20% behind a 14px
    backdrop blur, with a 1px white border at 18% — NOT the solid white the
    render suggests, which is the whole reason the raw data is the source.
    Padding 16, children 24 apart.

    Every field is the same object: a Geist 600 12/15.6 label, 8 above a 40-tall
    box at an 8 radius, filled white at 4% behind a 1px white border at 10.2%,
    padded 12, holding Geist 400 14/18.2 and a placeholder at 50%.
  */
  return (
    <Sheet
      open={open}
      onClose={onClose}
      bare
      panelClassName="w-full max-w-[534px] rounded-[22px] border border-white/[0.18] bg-[#201F1F]/20 p-4 backdrop-blur-[14px]"
    >
      <div className="max-h-[85vh] space-y-6 overflow-y-auto">
        {/* Heading 4 — the cross at 12x16 over #9B9B9B, 10 from a Roboto 700
            14/20 title. */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ws-press flex h-4 w-3 shrink-0 items-center justify-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("/profile/edit/close.svg")} alt="" aria-hidden className="h-2.5 w-2.5" />
          </button>
          <h2 className="font-[family-name:var(--font-roboto)] text-[14px] font-bold leading-5 text-white">
            Edit Profile
          </h2>
        </div>

        {/* 2112:19478 — the cover at 495x199, radius 22.34, under a #101012
            scrim at 62% so white furniture stays readable on a photograph
            nobody has seen yet. */}
        <div className="relative aspect-[495/199] w-full overflow-hidden rounded-[22.34px] bg-black/40 shadow-[0_4px_12px_rgba(21,32,43,0.4)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            /* The COVER, not the ground under it — one resolver, so this can
               never drift from the card it is a thumbnail of.

               Read from the LOCAL state, not the saved profile: a photo just
               picked shows immediately (`shown` is the local preview while it
               uploads), and removing one falls back to the character's ground
               rather than redrawing the picture that was just taken away. */
            src={cover.shown ?? coverPictureUrl(me.avatarConfig, coverUrl).src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span aria-hidden className="absolute inset-0 bg-[#101012]/[0.62]" />

          {/*
            TAPPING THE COVER EDITS THE CHARACTER, because that is what a cover
            now is: a character standing on a ground, both chosen in the studio.
            It used to open a file picker and a separate "Edit your character"
            link sat underneath — two controls for one thing, and the obvious
            one did the less useful half. The ground and the photograph are
            chosen in the studio too, beside the character they sit behind.

            The whole card is the target, not just the 38 disc: it is the
            biggest thing on the sheet and it is what somebody is looking at.
          */}
          {/*
            UPLOAD A COVER PHOTO — top-right, clear of the character control.

            Two different acts, so two different targets: the card's middle
            still opens the studio (a character on a ground), and this corner
            puts a photograph behind the name instead. The old single target
            meant the obvious gesture — tapping a cover to change it — only
            ever did the character half, and there was no way at all to upload
            one's own picture.
          */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={cover.open}
              disabled={cover.progress !== null}
              aria-label={coverUrl ? "Change cover photo" : "Upload a cover photo"}
              className="ws-press ws-btn-sm rounded-full bg-black/55 px-3 text-[11px] font-semibold text-white backdrop-blur disabled:opacity-60"
            >
              {cover.progress !== null
                ? `${Math.round(cover.progress * 100)}%`
                : coverUrl
                  ? "Change photo"
                  : "Upload photo"}
            </button>
            {/* Removing it falls back to the character's ground rather than to
                nothing, so the cover is never empty. */}
            {coverUrl && cover.progress === null && (
              <button
                type="button"
                onClick={() => setCoverUrl(null)}
                aria-label="Remove cover photo"
                className="ws-press ws-iconbtn-sm grid place-items-center rounded-full bg-black/55 text-white backdrop-blur"
              >
                <span aria-hidden className="text-[13px] leading-none">
                  ×
                </span>
              </button>
            )}
            <input {...cover.inputProps} />
          </div>

          <Link
            href={sq("/avatar")}
            aria-label={characterCode ? "Edit your character" : "Build a character"}
            className="ws-press absolute inset-0 flex items-center justify-center"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-black/25">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset("/profile/edit/camera.svg")} alt="" aria-hidden className="h-[13px] w-[15px]" />
            </span>
          </Link>

          {/* 2112:19481 — the profile picture at 71, radius 22.34, 16 from the
              left and 15 up from the foot, with its own camera over it. */}
          <button
            type="button"
            onClick={avatar.open}
            aria-label="Change profile photo"
            className="ws-press absolute bottom-[15px] left-4 z-10 h-[71px] w-[71px] overflow-hidden rounded-[22.34px] shadow-[0_4px_12px_rgba(21,32,43,0.4)]"
          >
            {avatar.shown ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={avatar.shown} alt="" aria-hidden className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-black/40" />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-[#302C2C]/[0.54]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset("/profile/edit/camera.svg")} alt="" aria-hidden className="h-[13px] w-[15px]" />
            </span>
          </button>
          <input {...avatar.inputProps} />
        </div>
        {avatar.error && <p className="text-xs text-down">{avatar.error}</p>}

        <Field label="Display name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            placeholder="Enter group title here..."
            className={FIELD_INPUT}
          />
        </Field>

        <Field label="Tag name">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            maxLength={20}
            placeholder={`@${me.username}`}
            className={cn(FIELD_INPUT, usernameTaken && "ws-invalid")}
          />
          {usernameTaken && (
            <p className="mt-1 text-[12px] text-down">Username taken — try another.</p>
          )}
        </Field>

        <Field label="Bio">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="Enter Bio here..."
            className={cn(FIELD_INPUT, "h-[103px] resize-none")}
          />
        </Field>

        {/* 17 apart, which is the file's own gap and not the 16 everywhere else. */}
        <div className="grid grid-cols-2 gap-[17px]">
          <Field label="City">
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={80}
              placeholder="Enter city here..."
              className={FIELD_INPUT}
            />
          </Field>
          <Field label="State">
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              maxLength={80}
              placeholder="Enter state here..."
              className={FIELD_INPUT}
            />
          </Field>
        </div>

        {/*
          GENDER IS A CHOICE of Male or Female (`lib/gender.ts`), never typed —
          "when they type people can type different way of male and female"
          (ogazboiz). Every profile then holds one of two values and the People
          filters never list five spellings of one answer. Tapping the chosen
          one again clears it, because it is not required.

          The file sizes these 206 and 278; they are equal halves here. Two
          radio buttons of different widths reads as a mistake rather than a
          decision, and the file gives no reason for the difference.
        */}
        <div>
          <span className="mb-2 block text-[13px] font-semibold leading-[16.9px] text-white">
            Gender
          </span>
          <div role="radiogroup" aria-label="Gender" className="grid grid-cols-2 gap-4">
            {GENDER_OPTIONS.map((option) => {
              const on = gender === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setGender(on ? "" : option.value)}
                  className={cn(
                    "ws-press flex h-10 items-center gap-1 rounded-lg border px-3 transition-colors",
                    on
                      ? "border-white/40 bg-white/[0.12]"
                      : "border-white/[0.102] bg-white/[0.04]",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset("/profile/edit/radio.svg")}
                    alt=""
                    aria-hidden
                    className="h-4 w-4"
                    style={{ opacity: on ? 1 : 0.7 }}
                  />
                  <span className="font-[family-name:var(--font-roboto)] text-[12px] leading-4 text-[#DCDAD5]">
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Website">
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            type="url"
            inputMode="url"
            maxLength={200}
            placeholder="https://"
            className={FIELD_INPUT}
          />
        </Field>

        {/* 10/16 at 80% — the note says who can see these, because a field
            that quietly becomes a filter other people search you by is consent
            nobody gave. */}
        <p className="text-[10px] leading-4 text-white/80">
          Your place, gender and website are public, and place and gender are what the People
          filters match on. Leave a field empty to remove it.
        </p>

        {update.isError && !usernameTaken && (
          <InlineError error={update.error} fallback="Couldn't save your profile." />
        )}

        {/* 496x47 at a full radius. Its gradient is NOT ws-btn-silver's: the
            file runs white -> #EDEDF0 -> #CBCBD1 -> #F5F5F8 straight down. */}
        <button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="ws-press flex h-[47px] w-full items-center justify-center rounded-full font-[family-name:var(--font-body)] text-[13px] font-bold leading-4 text-black shadow-[0_2.23px_8.92px_rgba(0,0,0,0.5)] disabled:opacity-60"
          style={{
            background:
              "linear-gradient(180deg, #FFFFFF 0%, #EDEDF0 38%, #CBCBD1 63%, #F5F5F8 100%)",
          }}
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Sheet>
  );
}

/** The file's `field-caption`: a 12/15.6 label, 8 above its box. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[12px] font-semibold leading-[15.6px] text-white">
        {label}
      </span>
      {children}
    </label>
  );
}

// After first login an unclaimed (null) username triggers this claim sheet.
export function ClaimUsernameSheet({
  me,
  open,
  onClose,
  onClaimed,
}: {
  me: Profile;
  open: boolean;
  onClose: () => void;
  onClaimed?: (username: string) => void;
}) {
  const update = useUpdateMe();
  const [username, setUsername] = useState("");
  const usernameTaken = errorCode(update.error) === "CONFLICT";

  return (
    <Sheet open={open} onClose={onClose} title="Claim your username">
      <div className="space-y-4">
        <p className="text-sm text-grey-400">
          {me.usernameUnclaimed ? (
            <>
              Welcome to the square, {me.displayName}. Pick a name people can
              find you by.
            </>
          ) : (
            <>
              You&apos;re currently{" "}
              <span className="text-grey-200">@{me.username}</span>. Pick a name
              people can find you by.
            </>
          )}
        </p>
        <input
          value={username}
          onChange={(e) =>
            setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
          }
          maxLength={20}
          placeholder="username"
          className={cn(FIELD_INPUT, usernameTaken && "ws-invalid")}
        />
        {usernameTaken && (
          <p className="text-xs text-down">Username taken — try another.</p>
        )}
        {update.isError && !usernameTaken && (
          <InlineError
            error={update.error}
            fallback="Couldn't claim that username."
          />
        )}
        <Button
          className="w-full"
          disabled={username.trim().length < 3}
          loading={update.isPending}
          onClick={() =>
            update.mutate(
              { username: username.trim() },
              {
                onSuccess: (updated) => {
                  onClose();
                  onClaimed?.(updated.username);
                },
              },
            )
          }
        >
          Claim @{username || "…"}
        </Button>
      </div>
    </Sheet>
  );
}

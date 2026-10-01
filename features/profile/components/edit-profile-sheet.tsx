"use client";

import Link from "next/link";
import { BackgroundPicker } from "@/features/profile/components/background-picker";
import { coverCharacterCode } from "@/lib/profile-backgrounds";
import { sq } from "@/lib/square-path";
import { GENDER_OPTIONS, normalizeGender } from "@/lib/gender";
import { useState } from "react";
import { resolveHandles } from "@/lib/api/mentions";
import { errorCode } from "@/lib/api/envelope";
import type { Profile } from "@/lib/api/schemas";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { UploadField } from "@/components/ui/upload-field";
import { InlineError } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { useUpdateMe } from "@/features/profile/hooks/use-profile";

const inputClass =
  "ws-inset w-full bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-grey-600";

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
  /* The cover's BACKGROUND. Null is a real value here and means "the ARK
     sweep" — see BackgroundPicker for why that is sent rather than a URL. */
  const [coverUrl, setCoverUrl] = useState<string | null>(me.coverUrl);
  /*
    The character being edited, as a share code.

    Recovered from the picture itself: a generated avatar's URL contains the
    code that made it, so reopening the studio continues from where they left
    off instead of starting over. Null means the picture is a photograph or a
    placeholder — nothing to continue from, so the studio opens on a fresh one.
  */
  const characterCode = coverCharacterCode(coverUrl);
  /* Self-declared, all three, and all optional. `?? ""` because null is the
     real "hasn't said" and an input cannot hold it. */
  const [city, setCity] = useState(me.city ?? "");
  const [region, setRegion] = useState(me.region ?? "");
  const [gender, setGender] = useState<string>(
    normalizeGender(me.gender) ?? "",
  );
  const [website, setWebsite] = useState(me.website ?? "");

  const usernameTaken = errorCode(update.error) === "CONFLICT";

  return (
    <Sheet open={open} onClose={onClose} title="Edit profile">
      <div className="space-y-4">
        <UploadField
          value={avatarUrl}
          onChange={setAvatarUrl}
          circular
          label="Avatar"
        />
        {/*
          BUILDING A CHARACTER SITS BESIDE UPLOADING A PICTURE, not instead of
          it. Somebody who wants their own photograph should not have to
          decline an editor first, and somebody who wants a character should
          not have to find one behind a file dialog.
        */}
        {/*
          A LINK, BECAUSE THE STUDIO IS A PAGE. Node 1863:2412 is a full-height
          column with a border on its right edge only — a surface of its own,
          not a card over this one. Stacking it inside this sheet would also
          have put a dialog inside a dialog, with two Escapes to get out.

          It edits the COVER, which is why the wording says so: the character
          stands on the profile's banner and the picture beside it is a
          separate choice, made by the control above.
        */}
        <Link
          href={sq("/avatar")}
          className="ws-press ws-btn-silver ws-btn-md flex w-full items-center justify-center rounded-full text-[14px] font-semibold"
        >
          {characterCode ? "Edit your character" : "Build a character"}
        </Link>
        <BackgroundPicker value={coverUrl} onChange={setCoverUrl} />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-grey-400">
            Display name
          </span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={50}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-grey-400">
            Username
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            maxLength={20}
            className={cn(inputClass, usernameTaken && "ws-invalid")}
          />
          {usernameTaken && (
            <p className="mt-1 text-xs text-down">
              Username taken — try another.
            </p>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-grey-400">
            Bio
          </span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={280}
            className={inputClass}
          />
        </label>

        {/*
          PLACE AND GENDER — the fields Explore's People filters match on.

          PLACE IS FREE TEXT; GENDER IS A CHOICE of Male or Female
          (`lib/gender.ts`), never typed — "when they type people can type
          different way of male and female" (ogazboiz). Every profile then
          holds one of two values, and the people filters never list five
          spellings of one answer. Tapping the chosen one again clears it.

          NOT REQUIRED, and emptying one clears it. The note says who can see
          them, because a field that quietly becomes a filter other people
          search you by is consent nobody gave.
        */}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-grey-400">
              City
            </span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={80}
              placeholder="Ikeja"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-grey-400">
              State or region
            </span>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              maxLength={80}
              placeholder="Lagos"
              className={inputClass}
            />
          </label>
        </div>
        <div className="block">
          <span className="mb-1.5 block text-xs font-semibold text-grey-400">
            Gender
          </span>
          <div
            role="radiogroup"
            aria-label="Gender"
            className="grid grid-cols-2 gap-2"
          >
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
                    "ws-press ws-inset flex items-center justify-center px-4 py-2.5 text-sm transition-colors",
                    on
                      ? "bg-create/15 text-white shadow-[inset_0_0_0_1px_var(--color-create)]"
                      : "text-grey-300 hover:text-white",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        {/* 545:47631 — the link row on the profile. The service accepts
            http(s) only and clears on null. */}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-grey-400">
            Website
          </span>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            type="url"
            inputMode="url"
            maxLength={200}
            placeholder="https://"
            className={inputClass}
          />
        </label>
        <p className="text-xs leading-4 text-grey-500">
          Your place, gender and website are public, and place and gender are
          what the People filters match on. Leave a field empty to remove it.
        </p>
        {update.isError && !usernameTaken && (
          <InlineError
            error={update.error}
            fallback="Couldn't save your profile."
          />
        )}
        <Button
          className="w-full"
          loading={update.isPending}
          onClick={async () => {
            /*
              RESOLVED AT SAVE, because this field has no picker.

              The chat composer remembers who was chosen from its autocomplete;
              a bio is a plain textarea, so the handles in the text are all we
              have. `resolveHandles` asks the directory for each and keeps only
              an EXACT match — "@ada" that could be adaeze or adaobi stays
              plain text rather than tagging a stranger permanently on
              somebody's profile.

              Awaited rather than fired alongside: a save landing before its
              mentions resolve would store the bio with an empty array, and the
              tags would vanish until the next edit.
            */
            const bioMentions = await resolveHandles(bio);
            update.mutate(
              {
                displayName: displayName.trim() || undefined,
                username:
                  username.trim() !== me.username ? username.trim() : undefined,
                bio,
                bioMentions,
                avatarUrl: avatarUrl ?? undefined,
                /* Sent even when null, unlike avatarUrl: null is how somebody
                   returns to the ARK sweep, and `?? undefined` would make that
                   choice unsendable — the field would simply be left alone. */
                coverUrl,
                // Sent as typed, blank included: an omitted field means "leave
                // it" and somebody who emptied the box meant "clear it". The
                // service reads a blank string as a clear.
                city: city.trim(),
                region: region.trim(),
                website: website.trim() || null,
                gender: gender.trim(),
              },
              { onSuccess: onClose },
            );
          }}
        >
          Save
        </Button>
      </div>
    </Sheet>
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
          className={cn(inputClass, usernameTaken && "ws-invalid")}
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

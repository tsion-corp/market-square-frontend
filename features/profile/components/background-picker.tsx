"use client";

import {
  PROFILE_BACKGROUNDS,
  backgroundUrl,
  coverCharacterCode,
  defaultBackgroundUrl,
  isDefaultBackground,
  selectedBackgroundId,
  storedCoverUrl,
} from "@/lib/profile-backgrounds";
import { UploadField } from "@/components/ui/upload-field";

/**
 * Choosing the ground a profile's character stands on.
 *
 * ─── SWATCHES FIRST, UPLOAD SECOND ──────────────────────────────────────────
 * Picking is one tap and an upload is a file dialog, a wait and a crop nobody
 * asked for. Leading with the upload would make the slow path look like the
 * only path, which is how a "change your background" feature ends up used by
 * the handful of people who happen to have a picture ready.
 *
 * ─── THE DEFAULT IS A CHOICE, NOT AN ABSENCE ────────────────────────────────
 * The ARK sweep everyone already wears is offered explicitly, so somebody who
 * picked violet can get back without clearing a field or guessing. Choosing it
 * sends `null` — the profile goes back to having no cover of its own, which is
 * what it actually means, rather than pinning a URL that would stop tracking
 * the default if we ever changed it.
 */
export function BackgroundPicker({
  value,
  onChange,
}: {
  /** The stored cover: a curated background, an uploaded picture, or null. */
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const selected = selectedBackgroundId(value);
  const isDefault = isDefaultBackground(value);
  // An upload is "a cover that is not one of ours" — the one case where the
  // stored value is set but matches neither a swatch nor the default.
  const isUpload = Boolean(value) && selected === null && !isDefault;
  /*
    CHANGING THE GROUND MUST NOT UNDRESS THE CHARACTER. One field carries both,
    so every pick below rebuilds the whole value and carries this through.
  */
  const character = coverCharacterCode(value);
  /* Stored absolute: the service validates coverUrl with z.string().url() and
     rejects a relative path, so a swatch saved as a path never persisted. */
  const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-grey-400">
        Background
      </span>

      <div className="grid grid-cols-4 gap-2">
        <Swatch
          src={defaultBackgroundUrl()}
          label="ARK"
          selected={isDefault}
          onPick={() => onChange(storedCoverUrl(origin(), null, character))}
        />
        {PROFILE_BACKGROUNDS.map((bg) => (
          <Swatch
            key={bg.id}
            src={backgroundUrl(bg.id)}
            label={bg.label}
            selected={selected === bg.id}
            onPick={() => onChange(storedCoverUrl(origin(), bg.id, character))}
          />
        ))}
      </div>

      <div className="mt-3">
        <UploadField
          value={isUpload ? value : null}
          /* An uploaded picture carries the character too, or swapping the
             ground for a photograph would quietly take the character off it. */
          onChange={(next) => {
            if (!next) return onChange(storedCoverUrl(origin(), null, character));
            if (!character) return onChange(next);
            const url = new URL(next, origin() || "https://square.invalid");
            url.searchParams.set("c", character);
            onChange(url.toString());
          }}
          label="Or use your own picture"
        />
      </div>
    </div>
  );
}

function Swatch({
  src,
  label,
  selected,
  onPick,
}: {
  src: string;
  label: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      // `aria-pressed` rather than a checked radio: this is a toggle among
      // peers, and a screen reader should hear which one is on without the
      // group pretending to be a form control it is not.
      aria-pressed={selected}
      aria-label={`${label} background`}
      className={[
        "ws-press relative aspect-[741/473] overflow-hidden rounded-xl border transition-colors",
        selected ? "border-create" : "border-white/10 hover:border-white/25",
      ].join(" ")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        className="h-full w-full object-cover"
      />
      {/* The name sits ON the swatch rather than under it: a caption row would
          double the grid's height for six words nobody reads twice. */}
      <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1 py-0.5 text-[10px] font-medium text-white">
        {label}
      </span>
      {selected && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-xl ring-2 ring-create ring-inset"
        />
      )}
    </button>
  );
}

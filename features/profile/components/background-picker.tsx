"use client";

import {
  PROFILE_BACKGROUNDS,
  backgroundUrl,
  defaultBackgroundUrl,
} from "@/lib/profile-backgrounds";

/**
 * Choosing the ground a profile's character stands on.
 *
 * ─── IT PICKS AN ID, NOT A URL ──────────────────────────────────────────────
 * It used to hand up a URL for `coverUrl`, which could never be stored: that
 * field is validated `z.string().url()` (a relative path 400s) and then run
 * through `verifyAttachment`, which accepts only a picture this person
 * uploaded (403). The choice now travels as an id inside `avatarConfig`
 * alongside the character, which is the field that will take it.
 *
 * ─── THE DEFAULT IS A CHOICE, NOT AN ABSENCE ────────────────────────────────
 * The ARK sweep everyone already wears is offered explicitly, so somebody who
 * picked violet can get back without clearing a field or guessing. Choosing it
 * sends `null` — the profile goes back to having no ground of its own, which
 * is what it actually means, rather than pinning an id that would stop
 * tracking the default if we ever changed it.
 */
export function BackgroundPicker({
  value,
  onChange,
}: {
  /** The curated background id, or null for the ARK sweep. */
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div>
      <span className="mb-2 block text-[12px] text-white/60">Background</span>
      <div className="grid grid-cols-4 gap-2">
        <Swatch
          src={defaultBackgroundUrl()}
          label="ARK"
          selected={!value}
          onPick={() => onChange(null)}
        />
        {PROFILE_BACKGROUNDS.map((bg) => (
          <Swatch
            key={bg.id}
            src={backgroundUrl(bg.id)}
            label={bg.label}
            selected={value === bg.id}
            onPick={() => onChange(bg.id)}
          />
        ))}
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
      aria-pressed={selected}
      className={`relative aspect-[131/122] overflow-hidden rounded-[13.138px] transition-opacity ${
        selected ? "ring-2 ring-white" : "opacity-80 hover:opacity-100"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent py-1 text-[11px] text-white">
        {label}
      </span>
    </button>
  );
}

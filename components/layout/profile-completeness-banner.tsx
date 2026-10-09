"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { IconX } from "@/components/ui/icons";
import { useMe } from "@/hooks/use-me";
import {
  completenessPercent,
  completenessSteps,
  nextCompletenessStep,
  shouldPromptCompleteness,
} from "@/lib/profile-completeness";
import { profileHref } from "@/lib/profile-href";
import { sq } from "@/lib/square-path";

/**
 * "YOUR PROFILE IS N% COMPLETE" — at the top of Home, where it was asked for.
 *
 * The reasoning behind the ask (Demitchy, relayed 2026-10-09) is that a product
 * built on meeting people cannot work on empty profiles, and that showing the
 * figure where people actually land is what gets them filled in. That is also
 * why this sits above the fold rather than inside Settings: the people who most
 * need it are the ones who never open Settings.
 *
 * ─── IT NAMES ONE THING TO DO, NOT SIX ──────────────────────────────────────
 * A list of everything missing is a chore; the next single step is a decision.
 * `nextCompletenessStep` picks it in a deliberate order, with the profile
 * picture first because it is the one field every other surface in the product
 * draws.
 *
 * ─── IT TAKES A NO ──────────────────────────────────────────────────────────
 * Dismissal is remembered per account, so a shared browser cannot dismiss it
 * for somebody else, and it is keyed to the percentage so that finishing a step
 * brings it back exactly once at the new number rather than never again. The
 * ask was to prompt people; a banner that returns on every page load is how a
 * product gets muted.
 *
 * Storage is wrapped: a private window refuses it, and a banner that cannot
 * remember a dismissal must still render rather than throw on the way past.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function dismissKey(profileId: string, percent: number) {
  return `ms:profile-complete:${profileId}:${percent}`;
}

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function dismiss(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* It stays dismissed for this page, which is all we can promise. */
  }
  listeners.forEach((onChange) => onChange());
}

export function ProfileCompletenessBanner() {
  const me = useMe();
  const profile = me.data ?? null;
  const steps = completenessSteps(profile);
  const percent = completenessPercent(steps);
  const key = profile ? dismissKey(profile.id, percent) : "";

  const dismissed = useSyncExternalStore(
    subscribe,
    () => (key ? readDismissed(key) : false),
    // No storage on the server, and no profile either — it renders nothing
    // there and the real answer arrives on the first client render.
    () => false
  );

  if (!shouldPromptCompleteness({ profile, dismissed })) return null;

  const next = nextCompletenessStep(profile);
  const done = steps.filter((step) => step.done).length;

  const RADIUS = 22;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  return (
    /*
      TINTED, NOT GREY, AND SLIM.

      The first build was a `ws-card` slab sitting directly above Home's purple
      hero — two stacked banners, and ours the duller one, so it read as
      scaffolding rather than part of the product. It now carries the brand's
      own accent at low alpha with a hairline in the same hue, and it is a row
      rather than a block: a system nudge has to be noticed and then got out of
      the way, which a full-height card cannot do.
    */
    <section
      aria-label="Finish your profile"
      className="relative flex items-center gap-3 rounded-[18px] border border-create/25 bg-create/[0.07] px-3 py-2.5 sm:gap-4 sm:px-4"
    >
      {/*
        THEIR OWN FACE, ringed by their progress.

        An abstract ring is a number in a circle; the avatar makes it THEIR
        profile being talked about, which is the whole persuasion. It is also
        the reference's own pattern, and it costs nothing — the picture is
        already loaded everywhere else on the page.
      */}
      <span className="relative grid size-12 shrink-0 place-items-center">
        <svg viewBox="0 0 52 52" aria-hidden className="absolute inset-0 size-12 -rotate-90">
          <circle cx="26" cy="26" r={RADIUS} fill="none" strokeWidth="2.5" className="stroke-white/15" />
          <circle
            cx="26"
            cy="26"
            r={RADIUS}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="stroke-create transition-[stroke-dasharray] duration-500 motion-reduce:transition-none"
            strokeDasharray={`${(percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          />
        </svg>
        <Avatar
          name={profile?.displayName || profile?.username || "You"}
          seed={profile?.id}
          src={profile?.avatarUrl}
          size={36}
          className="border-0"
        />
        {/* The figure sits ON the ring, as the reference draws it — small, high
            contrast, and tabular so it cannot jiggle as it climbs. */}
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-grey-900 px-1.5 text-[10px] font-bold leading-4 text-white tnum ring-1 ring-create/40">
          {percent}%
        </span>
      </span>

      <div className="min-w-0 flex-1">
        {/* The NEXT STEP leads, because it is the thing to do; the percentage
            is the context for it and sits quietly underneath. A heading that
            opens with the number makes the reader translate it back into an
            action themselves. */}
        <p className="truncate text-[15px] font-semibold leading-5 text-white">
          {next ? next.label : "Your profile is complete"}
        </p>
        <p className="mt-0.5 truncate text-[12px] leading-4 text-white/55">
          Profile {percent}% complete · {done} of {steps.length} done
        </p>
      </div>

      {profile && (
        /* Straight to the FIELDS, not to the page above them: `?edit=1` opens
           the editor on arrival, which is where the picture, cover, name, bio,
           gender and place all live. Sending somebody to Settings would be
           sending them to the one screen that has none of them.

           DELIBERATELY NOT the purple ramp: Home's hero CTA directly below is
           that gradient, and two of them in a column makes neither read as the
           main thing. A hairline pill is the secondary action it actually is. */
        <Link
          href={sq(`${profileHref(profile)}?edit=1`)}
          prefetch={false}
          className="ws-press ws-btn-sm hidden shrink-0 items-center rounded-full border border-white/25 px-3.5 text-[13px] font-semibold text-white transition-colors hover:border-white/45 hover:bg-white/5 sm:inline-flex"
        >
          Finish it
        </Link>
      )}

      {/*
        On a phone the whole row is the target and the pill is dropped — at 360
        wide a face, two lines, a pill and a dismiss leave the text about ten
        characters, which is how the one useful sentence gets truncated away.
      */}
      {profile && (
        <Link
          href={sq(`${profileHref(profile)}?edit=1`)}
          prefetch={false}
          aria-label="Finish your profile"
          className="absolute inset-0 rounded-[18px] sm:hidden"
        />
      )}

      <button
        type="button"
        onClick={() => dismiss(key)}
        aria-label="Dismiss"
        className="ws-iconbtn-sm ws-press relative z-10 grid shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white"
      >
        <IconX className="size-3.5" />
      </button>
    </section>
  );
}

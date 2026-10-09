"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
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

  return (
    <section
      aria-label="Finish your profile"
      className="ws-card relative flex items-center gap-4 p-4"
    >
      {/*
        The ring carries the number, as the reference does. It is an SVG rather
        than a bar because the figure is the point — a bar at 17% reads as a
        progress indicator for something loading.
      */}
      <span aria-hidden className="relative grid size-12 shrink-0 place-items-center">
        <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
          <circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" strokeWidth="4" className="text-white/10" />
          <circle
            cx="24"
            cy="24"
            r="21"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            className="text-create"
            strokeDasharray={`${(percent / 100) * 2 * Math.PI * 21} ${2 * Math.PI * 21}`}
          />
        </svg>
        <span className="text-[12px] font-bold leading-4 text-white tnum">{percent}%</span>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-white">
          Your profile is {percent}% complete
        </p>
        {/* The next step, named — and the count behind it, so the ask reads as
            finite rather than open-ended. */}
        <p className="mt-0.5 truncate text-[13px] leading-5 text-grey-400">
          {next ? `${next.label} — ${done} of ${steps.length} done` : null}
        </p>
      </div>

      {profile && (
        /* Straight to the FIELDS, not to the page above them: `?edit=1` opens
           the editor on arrival, which is where the picture, cover, name, bio,
           gender and place all live. Sending somebody to Settings would be
           sending them to the one screen that has none of them. */
        <Link
          href={sq(`${profileHref(profile)}?edit=1`)}
          prefetch={false}
          className="ws-btn-create ws-btn-sm ws-press shrink-0 rounded-full font-semibold text-white"
        >
          Finish it
        </Link>
      )}

      <button
        type="button"
        onClick={() => dismiss(key)}
        aria-label="Dismiss"
        className="ws-iconbtn-sm ws-press -mr-2 grid shrink-0 place-items-center rounded-full text-grey-400 transition-colors hover:text-white"
      >
        <IconX className="size-4" />
      </button>
    </section>
  );
}

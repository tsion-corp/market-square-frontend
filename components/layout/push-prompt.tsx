"use client";

import { useSyncExternalStore } from "react";
import { IconBell, IconX } from "@/components/ui/icons";
import { usePushNotifications } from "@/features/settings";
import { pushPromptKey, pushPromptState } from "@/lib/push-prompt";
import { cn } from "@/lib/cn";

/**
 * "TURN ON NOTIFICATIONS", WHERE SOMEBODY WILL ACTUALLY SEE IT.
 *
 * The switch itself has been in Settings → Notifications since push shipped,
 * and almost nobody has it on, because the only people ever offered it are the
 * people who went looking for a notification setting. This is the same switch,
 * put at the head of the notifications list — the one screen where the offer is
 * obviously relevant and never an interruption. It is composed in here rather
 * than inside the notifications slice because the switch belongs to SETTINGS
 * and slices never import each other; it reaches the list through a slot, the
 * same way the Wink back and Follow back buttons do.
 *
 * ─── IT IS TWO CARDS, BECAUSE IT IS TWO DIFFERENT ASKS ──────────────────────
 * On an iPhone in a Safari tab there is no permission to ask for: iOS delivers
 * web push to a Home Screen app and nowhere else. A "Turn on" button there
 * cannot work — so that reader gets the two steps that make it work instead,
 * and no button. `pushPromptState` makes that choice, and `lib/push.ts` is what
 * can tell an iPhone-in-a-tab apart from a browser with no push at all; they
 * look identical from the browser's own answer, and only one of them is a dead
 * end.
 *
 * ─── AND IT TAKES NO FOR AN ANSWER ──────────────────────────────────────────
 * Dismissal is remembered, with a separate key per card: an iPhone reader meets
 * both in order — install in the tab, then turn on inside the app — and one
 * shared key would let the first dismissal silently answer the second question.
 * Storage is wrapped because it throws in a private window, and a card that
 * cannot remember a dismissal must still render rather than crash the list.
 */
/**
 * The dismissal, read straight from storage behind a store rather than copied
 * into state by an effect — the pattern a story's seen/unseen ring already
 * uses here, and for the same reason: there is exactly one source of truth and
 * an effect that mirrors it can only ever be a second one that is briefly
 * wrong.
 *
 * Every access is wrapped. A private window throws on the getter itself, and a
 * card that cannot remember a dismissal must still be OFFERED rather than
 * swallow the list it sits above.
 */
const dismissalListeners = new Set<() => void>();

function subscribeToDismissal(onChange: () => void) {
  dismissalListeners.add(onChange);
  return () => {
    dismissalListeners.delete(onChange);
  };
}

function readDismissal(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeDismissal(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // It stays dismissed for this page, which is the whole promise we can keep
    // without storage.
  }
  dismissalListeners.forEach((onChange) => onChange());
}

export function PushPrompt() {
  const push = usePushNotifications();

  /*
    WHICH CARD THIS WOULD BE, BEFORE ASKING WHETHER IT WAS DISMISSED — because
    the two cards remember their dismissals under separate keys, so there is no
    key to read until the card is known. Resolving it in this order is what
    keeps that separation honest.
  */
  const candidate = pushPromptState({
    availability: push.availability,
    enabled: push.checked,
    dismissed: false,
  });

  const dismissed = useSyncExternalStore(
    subscribeToDismissal,
    () => candidate !== "hidden" && readDismissal(pushPromptKey(candidate)),
    // The server has no storage and no browser to ask, so it renders nothing
    // and the real answer arrives on the first client render.
    () => false
  );

  const state = dismissed ? "hidden" : candidate;
  if (state === "hidden") return null;

  const dismiss = () => writeDismissal(pushPromptKey(state));

  return (
    <div className="ws-card relative mb-4 flex items-start gap-3 p-4">
      <span
        aria-hidden
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-create/15 text-create"
      >
        <IconBell className="size-5" filled />
      </span>

      <div className="min-w-0 flex-1">
        {state === "ask" ? (
          <>
            <p className="text-[15px] font-semibold text-white">Turn on notifications</p>
            <p className="mt-1 text-[13px] leading-5 text-grey-400">
              Know when someone winks at you, follows you or sends a message — even when Square is
              closed.
            </p>
            <button
              type="button"
              disabled={push.disabled}
              onClick={() => push.onChange(true)}
              className={cn(
                "ws-btn-welcome ws-btn-sm ws-press mt-3 rounded-full font-semibold",
                "disabled:opacity-50"
              )}
            >
              Turn on
            </button>
          </>
        ) : (
          <>
            <p className="text-[15px] font-semibold text-white">Add Square to your Home Screen</p>
            {/*
              THE REASON COMES FIRST, because without it this reads as an advert
              for installing the app. It is not: it is the only way their phone
              can receive a notification at all, and saying so is what makes the
              two steps worth following.
            */}
            <p className="mt-1 text-[13px] leading-5 text-grey-400">
              iPhone only delivers notifications to an installed app, never to a browser tab. It
              takes two taps.
            </p>
            <ol className="mt-2 space-y-1 text-[13px] leading-5 text-grey-400">
              <li>
                <span className="text-white">1.</span> Tap{" "}
                <span className="text-white">Share</span> in Safari&rsquo;s toolbar.
              </li>
              <li>
                <span className="text-white">2.</span> Choose{" "}
                <span className="text-white">Add to Home Screen</span>.
              </li>
              <li>
                <span className="text-white">3.</span> Open Square from there and turn notifications
                on.
              </li>
            </ol>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="ws-iconbtn-sm ws-press -mr-2 -mt-2 grid shrink-0 place-items-center rounded-full text-grey-400 transition-colors hover:text-white"
      >
        <IconX className="size-4" />
      </button>
    </div>
  );
}

/**
 * SHOULD WE ASK THIS READER TO TURN ON NOTIFICATIONS, AND WHICH ASK IS IT?
 *
 * The switch has lived in Settings → Notifications since push shipped, which
 * means the only people who have ever been offered it are the people who went
 * looking for it. Nobody goes looking for a notification setting — they go
 * looking once notifications are already annoying them, and that is the wrong
 * direction. So the ask has to come to them.
 *
 * ─── THE TWO ASKS ARE NOT THE SAME ASK ──────────────────────────────────────
 * On an iPhone in a Safari TAB there is no permission to grant: iOS delivers
 * web push to a Home Screen app and nowhere else, and `PushManager` is not even
 * defined in the tab. A button there cannot work, so the card does not draw
 * one — it draws the two-step instruction that makes it work instead.
 * `pushAvailability` already separates that case (`needs-install`) from a
 * browser that genuinely cannot do push, which is the whole reason it exists;
 * this just picks which card to render.
 *
 * ─── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 * It never asks when push is already on, and it never asks in any of the states
 * the reader cannot act on from the card — unsupported, not deployed here,
 * still loading, or blocked at the browser level. `blocked` is the close call
 * and it stays hidden deliberately: the only remedy is several taps deep in
 * browser settings, Settings already carries that sentence, and a card that
 * reappears to say "you have blocked us" is a nag rather than an offer.
 *
 * Pure, so `node --test` pins it without a browser.
 */

import type { PushAvailability } from "./push.ts";

export type PushPromptState = "hidden" | "ask" | "install";

export function pushPromptState(input: {
  /** `pushAvailability` — the same answer the Settings row reads. */
  availability: PushAvailability;
  /** Push is on for this account AND this browser is subscribed. */
  enabled: boolean;
  /** This reader has already dismissed this card. */
  dismissed: boolean;
}): PushPromptState {
  /*
    BEFORE `dismissed`, so the state can never be read as "dismissed and still
    needing an ask". Already-on outranks everything: an offer to turn on what is
    on reads as the app not knowing its own state.
  */
  if (input.enabled) return "hidden";
  if (input.dismissed) return "hidden";
  if (input.availability === "needs-install") return "install";
  if (input.availability === "ready") return "ask";
  return "hidden";
}

/**
 * WHERE A DISMISSAL IS REMEMBERED — one key per ask, never one for both.
 *
 * The two cards are asking for different things in different places, and an
 * iPhone reader meets both in order: "add it to your Home Screen" in the tab,
 * then "turn these on" inside the installed app. One shared key would let the
 * first dismissal silently answer the second question, so the reader who
 * followed our instructions exactly would be the one never offered the switch.
 *
 * Keyed by state rather than by a hand-written string at each call site, so the
 * two can never accidentally become one.
 */
export function pushPromptKey(state: Exclude<PushPromptState, "hidden">): string {
  return `ms:push-prompt:${state}`;
}

import type { Profile } from "./api/schemas.ts";

/**
 * HOW FINISHED SOMEBODY'S PROFILE IS, and what is still missing.
 *
 * The ask (ogazboiz, relaying a note from Demitchy, 2026-10-09): show "your
 * profile is N% complete" at the top of Home, and let people fill in the gaps —
 * picture, cover, bio, gender — so the product has something to work with and
 * the person has a profile worth winking at.
 *
 * ─── WHY IT IS A PURE RULE AND NOT A NUMBER ON THE WIRE ─────────────────────
 * The service does not send a completeness figure, and it should not have to:
 * every input is already on the profile, so deriving it here keeps the bar in
 * one readable place rather than splitting "what counts" across two codebases.
 * The cost is that this list is a product decision, so it is written down
 * rather than inferred from whichever fields happen to exist.
 *
 * ─── ONLY THINGS A PERSON CAN ACTUALLY DO ───────────────────────────────────
 * Every step here maps to a control that exists today. The note also asked for
 * an AGE, and there is deliberately no step for it: the profile carries no
 * birthdate and no age field anywhere on the contract, so a step for it would
 * be a bar nobody could clear. Raised rather than faked.
 *
 * ─── THE USERNAME IS NOT A STEP ─────────────────────────────────────────────
 * It is claimed during onboarding and cannot be skipped, so counting it would
 * hand every account free percent for something they had no choice about —
 * which makes the number flatter rather than inform.
 */
export type CompletenessStepId = "avatar" | "cover" | "displayName" | "bio" | "gender" | "place";

export interface CompletenessStep {
  id: CompletenessStepId;
  /** What the person is being asked for, in their words. */
  label: string;
  /** One line on why it is worth doing — shown where there is room. */
  hint: string;
  done: boolean;
}

/**
 * A profile picture leads, and the order is not arbitrary.
 *
 * It is the one field every other surface in the product renders — the deck,
 * a room seat, a chat row, a search result — so it does the most work for the
 * person filling it in, and a deck of faceless cards is the fastest way to make
 * Square look empty. Cover and name follow because they finish the profile a
 * wink sends somebody to; bio, gender and place come after because they feed
 * discovery rather than the first impression.
 */
export function completenessSteps(profile: Profile | null | undefined): CompletenessStep[] {
  const filled = (value: string | null | undefined) => Boolean(value && value.trim().length > 0);
  return [
    {
      id: "avatar",
      label: "Add a profile picture",
      hint: "It is the one thing every other screen shows — the deck, a room seat, a message.",
      // An avatar is EITHER an uploaded picture or a built character. Counting
      // only the upload would tell somebody who made a character in the studio
      // that they still have no picture.
      done: filled(profile?.avatarUrl) || filled(profile?.avatarConfig),
    },
    {
      id: "cover",
      label: "Add a cover photo",
      hint: "The banner behind your name.",
      done: filled(profile?.coverUrl),
    },
    {
      id: "displayName",
      label: "Add your name",
      hint: "What people call you, rather than your handle.",
      /*
        A display name that merely repeats the handle is NOT done. The service
        fills it in from the username on some paths, so counting any non-empty
        value would mark this complete for accounts that never chose one.
      */
      done:
        filled(profile?.displayName) &&
        profile?.displayName?.trim().toLowerCase() !== profile?.username?.trim().toLowerCase(),
    },
    {
      id: "bio",
      label: "Write a short bio",
      hint: "A line about you is what turns a face into somebody worth winking at.",
      done: filled(profile?.bio),
    },
    {
      id: "gender",
      label: "Add your gender",
      hint: "People filter by it when they are looking for someone to talk to.",
      done: filled(profile?.gender),
    },
    {
      id: "place",
      label: "Add where you are",
      hint: "Square suggests people near you by the place on your profile.",
      // City OR country. A country alone is enough to be findable, and
      // demanding both would hold the bar above what the filters actually use.
      done: filled(profile?.city) || filled(profile?.country),
    },
  ];
}

/**
 * The percentage, rounded so it can never lie in either direction.
 *
 * `Math.round` would show 100% at five of six steps (83% rounds to 83, but a
 * seven-step list would round 6/7 to 86 — and any list where one step short
 * rounds to 100 tells somebody they are finished while a prompt still nags
 * them). `Math.floor` keeps 100% meaning exactly that, which is the only value
 * the banner's absence depends on.
 */
export function completenessPercent(steps: CompletenessStep[]): number {
  if (steps.length === 0) return 100;
  const done = steps.filter((step) => step.done).length;
  return Math.floor((done / steps.length) * 100);
}

/**
 * Should the reader be prompted at all?
 *
 * Three ways to answer no, and the last two matter as much as the first:
 *
 *   · the profile is finished;
 *   · there is no profile yet — a signed-out visitor is not an incomplete
 *     person, and prompting one would be nonsense;
 *   · they dismissed it. A banner that returns on the next page load is the
 *     kind of nagging that gets a product muted, and the ask was to prompt
 *     people, not to badger them.
 */
export function shouldPromptCompleteness(input: {
  profile: Profile | null | undefined;
  dismissed: boolean;
}): boolean {
  if (!input.profile) return false;
  if (input.dismissed) return false;
  return completenessPercent(completenessSteps(input.profile)) < 100;
}

/** The next thing worth doing — the first unfinished step, in the order above. */
export function nextCompletenessStep(
  profile: Profile | null | undefined
): CompletenessStep | null {
  return completenessSteps(profile).find((step) => !step.done) ?? null;
}

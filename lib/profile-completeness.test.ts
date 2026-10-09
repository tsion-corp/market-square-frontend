import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completenessPercent,
  completenessSteps,
  nextCompletenessStep,
  shouldPromptCompleteness,
} from "./profile-completeness.ts";
import type { Profile } from "./api/schemas.ts";

/*
  "YOUR PROFILE IS N% COMPLETE" — the rule behind the prompt.

  The number is derived here rather than sent, so what counts is a product
  decision written down in one place. These pin the decisions that would
  otherwise be re-argued or quietly drift.
*/

const bare = { id: "p1", username: "ada" } as unknown as Profile;
const full = {
  id: "p1",
  username: "ada",
  displayName: "Ada Bello",
  avatarUrl: "https://example.test/a.png",
  coverUrl: "https://example.test/c.png",
  bio: "Building things.",
  gender: "female",
  city: "Lagos",
} as unknown as Profile;

describe("what counts", () => {
  it("is six steps, and the picture leads", () => {
    const steps = completenessSteps(bare);
    assert.equal(steps.length, 6);
    assert.equal(steps[0]?.id, "avatar");
  });

  it("counts a built character as a picture", () => {
    /*
      An avatar is EITHER an uploaded photo or a character from the studio.
      Counting only the upload would tell somebody who spent ten minutes
      building a face that they still have no picture.
    */
    const character = { ...bare, avatarConfig: "abc123" } as unknown as Profile;
    assert.equal(completenessSteps(character)[0]?.done, true);
  });

  it("does not count a display name that is just the handle", () => {
    /*
      The service fills `displayName` from the username on some paths, so any
      non-empty check would mark this done for accounts that never chose one —
      handing out percent for something nobody did.
    */
    const echoed = { ...bare, displayName: "ada" } as unknown as Profile;
    const chosen = { ...bare, displayName: "Ada Bello" } as unknown as Profile;
    const byId = (p: Profile) => completenessSteps(p).find((s) => s.id === "displayName")?.done;
    assert.equal(byId(echoed), false, "the handle in title case is still the handle");
    assert.equal(byId(chosen), true);
  });

  it("accepts a city OR a country for place", () => {
    // A country alone is enough to be findable; demanding both would hold the
    // bar above what the people filters actually use.
    const byId = (p: Profile) => completenessSteps(p).find((s) => s.id === "place")?.done;
    assert.equal(byId({ ...bare, city: "Lagos" } as unknown as Profile), true);
    assert.equal(byId({ ...bare, country: "NG" } as unknown as Profile), true);
    assert.equal(byId(bare), false);
  });

  it("treats whitespace as empty", () => {
    const blank = { ...bare, bio: "   " } as unknown as Profile;
    assert.equal(completenessSteps(blank).find((s) => s.id === "bio")?.done, false);
  });

  it("has no step for age, because there is no field for one", () => {
    /*
      The note asked for it. The profile carries no birthdate and no age
      anywhere on the contract, so a step for it would be a bar nobody could
      clear — raised as an open question instead of faked.
    */
    assert.equal(
      completenessSteps(full).some((step) => /age|birth/iu.test(step.id + step.label)),
      false
    );
  });
});

describe("the percentage", () => {
  it("is 0 for a bare profile and 100 for a finished one", () => {
    assert.equal(completenessPercent(completenessSteps(bare)), 0);
    assert.equal(completenessPercent(completenessSteps(full)), 100);
  });

  it("never rounds up to 100 while something is missing", () => {
    /*
      100% is the one value the banner's absence depends on, so it has to mean
      exactly that. Rounding is down for the same reason a count is never
      inflated: the number is a claim about the reader's own profile and they
      can check it.
    */
    const almost = { ...full, bio: "" } as unknown as Profile;
    const percent = completenessPercent(completenessSteps(almost));
    assert.ok(percent < 100, `one step short must not read as finished, got ${percent}`);
    assert.equal(percent, 83);
  });
});

describe("when to prompt", () => {
  it("prompts an unfinished profile", () => {
    assert.equal(shouldPromptCompleteness({ profile: bare, dismissed: false }), true);
  });

  it("stops at 100%", () => {
    assert.equal(shouldPromptCompleteness({ profile: full, dismissed: false }), false);
  });

  it("stays dismissed", () => {
    // A banner that returns on the next page load is how a product gets muted.
    assert.equal(shouldPromptCompleteness({ profile: bare, dismissed: true }), false);
  });

  it("never prompts without a profile", () => {
    // A signed-out visitor is not an incomplete person.
    assert.equal(shouldPromptCompleteness({ profile: null, dismissed: false }), false);
    assert.equal(shouldPromptCompleteness({ profile: undefined, dismissed: false }), false);
  });
});

describe("what to do next", () => {
  it("is the first unfinished step in order", () => {
    assert.equal(nextCompletenessStep(bare)?.id, "avatar");
    const withPicture = { ...bare, avatarUrl: "https://example.test/a.png" } as unknown as Profile;
    assert.equal(nextCompletenessStep(withPicture)?.id, "cover");
  });

  it("is null once there is nothing left", () => {
    assert.equal(nextCompletenessStep(full), null);
  });
});

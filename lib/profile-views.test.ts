import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { ProfileSchema } from "./api/schemas.ts";

/*
  WHO VIEWED YOUR PROFILE — BOTH HALVES, AND THE FIELD THAT WAS BEING DROPPED.

  The writer (`POST /profiles/:id/views`) has been live and firing on dwell for
  weeks. The read side did not exist here at all, and the two fields that carry
  it — `profileViewCount` and `privateBrowsing` — were on `GET /me` and NOT
  declared on the schema, so zod stripped them on every parse. Silently: no
  warning, no failing test, no typecheck error. The capability read as "the
  service doesn't have it" from inside the client while the service had been
  answering the whole time.

  That is the failure these assertions exist to prevent recurring.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("the two private fields", () => {
  it("parses profileViewCount, and keeps NULL distinct from zero", () => {
    /*
      Null means "you are browsing privately", not "nobody looked". Defaulting
      it to 0 would tell somebody their profile had been seen by nobody, which
      is a different and false claim — and the one a reader would believe.
    */
    const priv = ProfileSchema.parse({ id: "p1", username: "a", profileViewCount: null });
    assert.equal(priv.profileViewCount, null);

    const counted = ProfileSchema.parse({ id: "p1", username: "a", profileViewCount: 12 });
    assert.equal(counted.profileViewCount, 12);

    // Absent is also null — a payload without the field is not a claim of zero.
    assert.equal(ProfileSchema.parse({ id: "p1", username: "a" }).profileViewCount, null);
  });

  it("parses privateBrowsing, defaulting OFF", () => {
    // Off is the safe default in both directions: it neither hides somebody
    // who did not ask to be hidden, nor withholds a list they are entitled to.
    assert.equal(ProfileSchema.parse({ id: "p1", username: "a" }).privateBrowsing, false);
    assert.equal(
      ProfileSchema.parse({ id: "p1", username: "a", privateBrowsing: true }).privateBrowsing,
      true
    );
  });
});

describe("the refusal is not an error", () => {
  it("separates private browsing from a real failure and from an undeployed route", () => {
    /*
      Three outcomes, and only one is a fault. A 403 here is the reciprocal
      bargain working — the reader turned private browsing on — and showing it
      as "something went wrong" would make a working feature look broken.
    */
    const hook = read("features/profile/hooks/use-profile-views.ts");
    assert.match(hook, /isPrivate: code === "FORBIDDEN"/u);
    assert.match(hook, /unavailable: code === "NOT_FOUND"/u);
    assert.match(
      hook,
      /isError: query\.isError && code !== "FORBIDDEN" && code !== "NOT_FOUND"/u,
      "a refusal must never be reported as an error"
    );
  });

  it("retries neither refusal", () => {
    /*
      A 403 cannot become a 200 by asking again — only the reader turning the
      setting off changes it — and a 404 is a fact about the deployment. Retrying
      either spends requests to be told the same thing, and on the 403 it holds a
      spinner over a screen that has a real answer to show.
    */
    const hook = read("features/profile/hooks/use-profile-views.ts");
    assert.match(hook, /return code !== "FORBIDDEN" && code !== "NOT_FOUND";/u);
  });

  it("offers the way back out of private browsing", () => {
    // A refusal whose remedy is hidden is indistinguishable from a broken
    // feature, so the screen that explains it also links to the switch.
    const panel = read("components/layout/profile-viewers.tsx");
    assert.match(panel, /You're browsing privately/u);
    assert.match(panel, /settings/u);
  });
});

describe("the count", () => {
  it("is the service's total, never the rows that happen to be loaded", () => {
    /*
      `total` is people in the 90-day window and rides on EVERY page. Counting
      loaded rows would make the heading grow as somebody scrolled — the exact
      thing the "never derive a count from a loaded page" rule forbids.
    */
    const hook = read("features/profile/hooks/use-profile-views.ts");
    assert.match(hook, /total: query\.data\?\.pages\[0\]\?\.total \?\? null/u);
    assert.ok(
      !/entries\.length.*total/u.test(read("components/layout/profile-viewers.tsx")),
      "the heading must not count the loaded entries"
    );
  });
});

describe("the reciprocal bargain is described in full", () => {
  it("the setting names BOTH halves", () => {
    /*
      While it is on you are not listed as a viewer anywhere AND your own list
      is refused. Describing only the first half sells a one-way mirror, which
      is exactly what this is not — and somebody would turn it on and then
      report their empty list as a bug.
    */
    const settings = read("components/layout/settings-screen.tsx");
    assert.match(settings, /won't be listed as a viewer/u, "the half it gives");
    assert.match(settings, /won't see who viewed yours/u, "the half it costs");
    assert.match(settings, /Nothing is lost/u, "and that the list survives");
  });

  it("saves through PATCH /me, not the settings payload", () => {
    // `privateBrowsing` lives on the profile, beside country — not in
    // `/me/settings`, which is where every other row on this screen saves.
    const settings = read("components/layout/settings-screen.tsx");
    assert.match(settings, /updateMe\.mutate\(\{ privateBrowsing: value \}\)/u);
  });

  it("turning it off brings the list back without a reload", () => {
    /*
      `PATCH /me` lands in `invalidateIdentitySurfaces`, so the views query has
      to be in that set — otherwise a reader turns private browsing off and goes
      on looking at the screen that says they cannot see their viewers.
    */
    assert.match(read("lib/api/invalidate.ts"), /\["ms", "profile-views"\]/u);
  });
});

describe("one tile, not two", () => {
  it("the viewers panel draws the member tile rather than a look-alike", () => {
    /*
      Node 1285:36433 is the same tile as the house roster's, down to the two
      follow states and the exported glyphs. A second implementation is how one
      of them ends up with the wrong follow behaviour.
    */
    const panel = read("components/layout/profile-viewers.tsx");
    assert.match(panel, /import \{ HouseMemberTile \}/u);
    assert.ok(
      !panel.includes("profile-add"),
      "the panel must not redraw the tile's own glyphs"
    );
  });

  it("says WHEN, and never implies a visit count", () => {
    /*
      The service moves `viewedAt` at most once per UTC day, so it is the last
      day somebody came by — not how many times. Any wording with a tally in it
      would be inventing data the payload does not carry.
    */
    const panel = read("components/layout/profile-viewers.tsx");
    assert.match(panel, /`Viewed \$\{relativeTime\(entry\.viewedAt\)\}`/u);
    assert.ok(!/\btimes\b/u.test(panel), "nothing here counts visits");
  });
});

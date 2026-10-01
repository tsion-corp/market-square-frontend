import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PROFILE_BACKGROUNDS,
  backgroundUrl,
  coverBackgroundUrl,
  decodeAvatarCover,
  defaultBackgroundUrl,
  encodeAvatarCover,
} from "./profile-backgrounds.ts";

describe("the curated set", () => {
  /*
    AN ID IS STORED ON A PROFILE, inside the URL a person is wearing. Renaming
    one does not migrate anybody — it silently takes their background away and
    leaves them on the default, which reads as the app forgetting a choice they
    made.
  */
  it("has stable ids", () => {
    assert.deepEqual(
      PROFILE_BACKGROUNDS.map((b) => b.id),
      ["violet", "midnight", "ember", "mint", "rose", "slate"],
    );
  });

  it("has no duplicates", () => {
    const ids = PROFILE_BACKGROUNDS.map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("gives every one a label a person can read", () => {
    for (const bg of PROFILE_BACKGROUNDS) {
      assert.ok(bg.label.trim().length > 0, bg.id);
      assert.notEqual(bg.label, bg.id, "a label is for reading, not an id in disguise");
    }
  });

  /*
    An offered background whose file is missing renders as a broken image in a
    picker — the one place a person is choosing by sight.
  */
  it("points at files that actually exist in public/", () => {
    for (const bg of PROFILE_BACKGROUNDS) {
      const path = new URL(`../public/profile/backgrounds/${bg.id}.svg`, import.meta.url);
      assert.ok(existsSync(path), `missing public/profile/backgrounds/${bg.id}.svg`);
    }
  });

  it("ships the default the cover already wears", () => {
    assert.ok(existsSync(new URL("../public/profile/ark-cover-bg.jpg", import.meta.url)));
  });
});

describe("resolving what a profile wears", () => {
  it("uses what the person chose when they chose something", () => {
    assert.equal(coverBackgroundUrl("violet", null), backgroundUrl("violet"));
    assert.equal(
      coverBackgroundUrl(null, "https://cdn.example/mine.jpg"),
      "https://cdn.example/mine.jpg",
      "an uploaded photograph is still a cover",
    );
  });

  it("falls back to the ARK sweep when there is not", () => {
    assert.equal(coverBackgroundUrl(null), defaultBackgroundUrl());
    assert.equal(coverBackgroundUrl(undefined), defaultBackgroundUrl());
  });

  /*
    A BLANK IS HOW A CLEARED FIELD ARRIVES. Rendering it would produce a broken
    image where the default belongs — the failure looks like a bug in the cover
    rather than an empty value.
  */
  it("treats a blank or whitespace choice as absent", () => {
    assert.equal(coverBackgroundUrl("", ""), defaultBackgroundUrl());
    assert.equal(coverBackgroundUrl("   ", "   "), defaultBackgroundUrl());
  });
});

/*
  ─── A COVER IS TWO CHOICES IN ONE FIELD ────────────────────────────────────
  The ground and the character travel together in `avatarConfig`, because it is
  the only field that will accept them: `coverUrl` is validated
  `z.string().url()` (a relative path 400s) and then run through
  `verifyAttachment`, which takes only a picture its owner uploaded (403).
*/
describe("what a profile wears", () => {
  const CODE = "A2" + "x".repeat(200);

  it("keeps a bare code bare, so nothing already saved has to change", () => {
    assert.equal(encodeAvatarCover({ code: CODE, background: null }), CODE);
    assert.deepEqual(decodeAvatarCover(CODE), { code: CODE, background: null });
  });

  it("carries the ground and the character together when there are both", () => {
    const stored = encodeAvatarCover({ code: CODE, background: "violet" });
    assert.ok(stored && stored.startsWith("{"));
    assert.deepEqual(decodeAvatarCover(stored), { code: CODE, background: "violet" });
  });

  it("stores nothing when neither has been chosen", () => {
    assert.equal(encodeAvatarCover({ code: null, background: null }), null);
    assert.deepEqual(decodeAvatarCover(null), { code: null, background: null });
  });

  it("can wear a ground with no character", () => {
    const stored = encodeAvatarCover({ code: null, background: "ember" });
    assert.deepEqual(decodeAvatarCover(stored), { code: null, background: "ember" });
  });

  /* The service caps the STORED STRING at 1024 and the wrapper counts. */
  it("fits the field with room to spare", () => {
    const stored = encodeAvatarCover({ code: "A2" + "x".repeat(400), background: "midnight" });
    assert.ok((stored?.length ?? 0) < 1024, `${stored?.length} characters`);
  });

  /*
    A value is replayed from a profile an older client may have written, so
    anything unreadable falls back to the mascot rather than throwing on a page
    somebody is only visiting.
  */
  it("never throws on something it cannot read", () => {
    for (const junk of ["{", "{]", '{"c":5}', '{"bg":"nope"}', "   ", "not-a-code"]) {
      assert.deepEqual(decodeAvatarCover(junk), { code: null, background: null }, junk);
    }
  });

  it("refuses a background it does not have", () => {
    const forged = JSON.stringify({ c: CODE, bg: "../../etc" });
    assert.deepEqual(decodeAvatarCover(forged), { code: CODE, background: null });
  });

  it("draws the ground in the right order: chosen, then uploaded, then ARK", () => {
    assert.equal(coverBackgroundUrl("violet", "https://cdn.example/me.jpg"), backgroundUrl("violet"));
    assert.equal(coverBackgroundUrl(null, "https://cdn.example/me.jpg"), "https://cdn.example/me.jpg");
    assert.equal(coverBackgroundUrl(null, null), defaultBackgroundUrl());
    assert.equal(coverBackgroundUrl(null, "   "), defaultBackgroundUrl(), "blank is absent");
  });
});

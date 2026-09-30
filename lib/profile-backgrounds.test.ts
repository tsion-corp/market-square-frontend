import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PROFILE_BACKGROUNDS,
  backgroundUrl,
  coverBackgroundUrl,
  defaultBackgroundUrl,
  selectedBackgroundId,
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
  it("uses a stored cover when there is one", () => {
    const violet = backgroundUrl("violet");
    assert.equal(coverBackgroundUrl(violet), violet);
    assert.equal(coverBackgroundUrl("https://cdn.example/mine.jpg"), "https://cdn.example/mine.jpg");
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
  it("treats a blank or whitespace cover as absent", () => {
    assert.equal(coverBackgroundUrl(""), defaultBackgroundUrl());
    assert.equal(coverBackgroundUrl("   "), defaultBackgroundUrl());
  });
});

describe("knowing which one is chosen", () => {
  it("recognises a curated background", () => {
    assert.equal(selectedBackgroundId(backgroundUrl("mint")), "mint");
  });

  /*
    An uploaded picture is a real cover that is simply not one of ours.
    Matching it to a swatch would tick a choice the person never made.
  */
  it("answers null for an upload, rather than guessing a swatch", () => {
    assert.equal(selectedBackgroundId("https://cdn.example/mine.jpg"), null);
  });

  it("answers null for nothing at all", () => {
    assert.equal(selectedBackgroundId(null), null);
    assert.equal(selectedBackgroundId(undefined), null);
    assert.equal(selectedBackgroundId(""), null);
  });
});

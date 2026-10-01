import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PROFILE_BACKGROUNDS,
  backgroundUrl,
  coverBackgroundUrl,
  coverCharacterCode,
  defaultBackgroundUrl,
  isDefaultBackground,
  selectedBackgroundId,
  storedCoverUrl,
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

/*
  A COVER IS TWO CHOICES IN ONE FIELD — the ground, and the character standing
  on it. These pin the rules that made that possible, each of which cost
  something to learn.
*/
describe("what a cover stores", () => {
  const CODE = "A2" + "x".repeat(200);
  const ORIGIN = "https://square.example";

  /*
    THE BUG THIS CAUGHT. The service validates coverUrl with
    `z.string().url()`, which REJECTS a relative path — so a curated background
    stored as "/profile/backgrounds/violet.svg" answered 400 and the choice
    never persisted. Everything written must parse as an absolute URL.
  */
  it("stores an absolute URL, because a relative one is refused", () => {
    for (const stored of [
      storedCoverUrl(ORIGIN, "violet", null),
      storedCoverUrl(ORIGIN, "violet", CODE),
      storedCoverUrl(ORIGIN, null, CODE),
    ]) {
      assert.ok(stored, "a choice stores something");
      assert.doesNotThrow(() => new URL(stored as string), `${stored} is absolute`);
    }
  });

  /* Wearing nothing of one's own stays null, rather than pinning a URL that
     would stop tracking the default if it ever changed. */
  it("stores nothing when neither has been chosen", () => {
    assert.equal(storedCoverUrl(ORIGIN, null, null), null);
  });

  it("carries the ground and the character together", () => {
    const stored = storedCoverUrl(ORIGIN, "violet", CODE);
    assert.equal(selectedBackgroundId(stored), "violet");
    assert.equal(coverCharacterCode(stored), CODE);
  });

  /*
    ORIGINS MOVE. What is written carries whatever origin the browser was on —
    a preview deployment, a local port — so matching the whole string would
    make a background picked on a preview stop being recognised in production.
  */
  it("recognises a background saved from another origin", () => {
    const fromPreview = storedCoverUrl("https://preview.example", "ember", CODE);
    assert.equal(selectedBackgroundId(fromPreview), "ember");
    assert.equal(coverCharacterCode(fromPreview), CODE);
  });

  /* A character with no chosen ground still wears the ARK sweep, and the
     picker must read that as the default rather than as an upload. */
  it("keeps the default readable as the default once a character is on it", () => {
    const stored = storedCoverUrl(ORIGIN, null, CODE);
    assert.equal(isDefaultBackground(stored), true);
    assert.equal(selectedBackgroundId(stored), null);
    assert.equal(coverBackgroundUrl(stored), defaultBackgroundUrl());
  });

  /* The character parameter is ours; a media host handed a query it never
     issued can refuse a signed URL outright. */
  it("does not hand our character parameter to somebody else's picture", () => {
    const upload = "https://cdn.example/me.jpg?sig=abc";
    const url = new URL(upload);
    url.searchParams.set("c", CODE);
    assert.equal(coverBackgroundUrl(url.toString()), upload);
    assert.equal(coverCharacterCode(url.toString()), CODE);
  });

  it("refuses a character that is not a share code", () => {
    assert.equal(coverCharacterCode(`${ORIGIN}/profile/backgrounds/violet.svg?c=nope`), null);
    assert.equal(coverCharacterCode(null), null);
  });
});

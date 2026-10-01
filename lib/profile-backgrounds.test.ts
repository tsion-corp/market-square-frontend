import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PROFILE_BACKGROUNDS,
  backgroundUrl,
  coverBackgroundUrl,
  coverPictureUrl,
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
    assert.equal(encodeAvatarCover({ code: CODE, background: null, anim: null }), CODE);
    assert.deepEqual(decodeAvatarCover(CODE), { code: CODE, background: null, anim: null });
  });

  it("carries the ground and the character together when there are both", () => {
    const stored = encodeAvatarCover({ code: CODE, background: "violet", anim: null });
    assert.ok(stored && stored.startsWith("{"));
    assert.deepEqual(decodeAvatarCover(stored), { code: CODE, background: "violet", anim: null });
  });

  it("stores nothing when neither has been chosen", () => {
    assert.equal(encodeAvatarCover({ code: null, background: null, anim: null }), null);
    assert.deepEqual(decodeAvatarCover(null), { code: null, background: null, anim: null });
  });

  it("can wear a ground with no character", () => {
    const stored = encodeAvatarCover({ code: null, background: "ember", anim: null });
    assert.deepEqual(decodeAvatarCover(stored), { code: null, background: "ember", anim: null });
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
      assert.deepEqual(decodeAvatarCover(junk), { code: null, background: null, anim: null }, junk);
    }
  });

  it("refuses a background it does not have", () => {
    const forged = JSON.stringify({ c: CODE, bg: "../../etc" });
    assert.deepEqual(decodeAvatarCover(forged), { code: CODE, background: null, anim: null });
  });

  it("draws the ground in the right order: chosen, then uploaded, then ARK", () => {
    assert.equal(coverBackgroundUrl("violet", "https://cdn.example/me.jpg"), backgroundUrl("violet"));
    assert.equal(coverBackgroundUrl(null, "https://cdn.example/me.jpg"), "https://cdn.example/me.jpg");
    assert.equal(coverBackgroundUrl(null, null), defaultBackgroundUrl());
    assert.equal(coverBackgroundUrl(null, "   "), defaultBackgroundUrl(), "blank is absent");
  });
});

/*
  THE CLIP A CHARACTER PLAYS ON SOMEBODY ELSE'S SCREEN. Saved rather than
  chosen by the viewer, because the point is that visitors see it.
*/
describe("the animation a cover carries", () => {
  const CODE = "A2" + "x".repeat(200);

  it("rides alongside the character and the ground", () => {
    const stored = encodeAvatarCover({ code: CODE, background: "mint", anim: "wave" });
    assert.deepEqual(decodeAvatarCover(stored), {
      code: CODE,
      background: "mint",
      anim: "wave",
    });
  });

  it("keeps a still avatar in the short form", () => {
    assert.equal(encodeAvatarCover({ code: CODE, background: null, anim: null }), CODE);
  });

  /* A clip name reaches a renderer and arrives from a field an older client may
     have written, so anything that is not a plain name is dropped. */
  it("refuses a clip name that is not one", () => {
    for (const bad of ["../../etc", "<script>", "A".repeat(80), "", "Wave!", 5]) {
      const forged = JSON.stringify({ c: CODE, bg: null, a: bad });
      assert.equal(decodeAvatarCover(forged).anim, null, String(bad));
    }
  });

  it("still fits the field with all three", () => {
    const stored = encodeAvatarCover({
      code: "A2" + "x".repeat(400),
      background: "midnight",
      anim: "idle-fidget",
    });
    assert.ok((stored?.length ?? 0) < 1024, `${stored?.length} characters`);
  });
});

/*
  ─── ONE ANSWER FOR THE COVER, BECAUSE FOUR DRIFTED ─────────────────────────
  The profile card, the full-screen viewer, the editor's thumbnail and the
  studio preview each resolved the cover for themselves, and each was corrected
  separately as the cover changed shape: the viewer opened an empty meadow, and
  the editor showed the ARK sweep over somebody who had built a character.
*/
describe("the cover picture a profile shows", () => {
  const CODE = "A2" + "x".repeat(200);

  it("is the character's own picture once they have one", () => {
    const got = coverPictureUrl(encodeAvatarCover({ code: CODE, background: "violet" }), null);
    assert.equal(got.isCharacter, true);
    assert.match(got.src, /\/api\/avatar\/cover\//, "rendered, not a flat ground");
    assert.ok(got.src.includes(encodeURIComponent(CODE)), "and it is THEIR character");
  });

  it("carries the clip they chose, so a cover animates where it is drawn", () => {
    const got = coverPictureUrl(
      encodeAvatarCover({ code: CODE, background: null, anim: "wave" }),
      null,
    );
    assert.match(got.src, /[?&]a=wave\b/);
  });

  it("asks for the size the surface needs", () => {
    const got = coverPictureUrl(CODE, null, { width: 1482, height: 946 });
    assert.match(got.src, /[?&]w=1482\b/);
    assert.match(got.src, /[?&]h=946\b/);
  });

  /* Without a character there is only a ground, and the mascot stands on it. */
  it("falls back to the ground, and says so", () => {
    const upload = coverPictureUrl(null, "https://cdn.example/mine.jpg");
    assert.equal(upload.isCharacter, false);
    assert.equal(upload.src, "https://cdn.example/mine.jpg");

    const curated = coverPictureUrl(encodeAvatarCover({ code: null, background: "ember" }), null);
    assert.equal(curated.isCharacter, false);
    assert.equal(curated.src, backgroundUrl("ember"));

    assert.equal(coverPictureUrl(null, null).src, defaultBackgroundUrl());
  });
});

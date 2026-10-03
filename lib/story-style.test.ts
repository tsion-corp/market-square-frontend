import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  STORY_BACKGROUNDS,
  STORY_FONTS,
  STORY_FONT_CLASS,
  isStoryBackground,
  storyFontClass,
  storyBackgroundCss,
} from "./story-style.ts";

/*
  A STORY'S BACKGROUND AND FACE — BOTH HALVES, OR NEITHER IS WORTH SHIPPING.

  `storyStyle` has been on the service for weeks and nothing read OR wrote it,
  so every story this app made played on one hard-coded violet gradient whatever
  its author intended.

  Rendering alone would have been pointless: this is the only client, so no story
  HAS a style until the creator can set one, and a read side with nothing to read
  is indistinguishable from a broken one. That is the mistake the profile-view
  count made — a display built on a table whose writer nobody called.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const creator = read("features/feed/components/story-creator.tsx");
const viewer = read("features/feed/components/stories-row.tsx");
const schemas = read("lib/api/schemas.ts");
const api = read("features/feed/lib/api.ts");

describe("the story palette", () => {
  it("is the service's eight, exactly", () => {
    // A ninth hex is a 400, which is why the picker is driven off this list
    // rather than a colour input.
    assert.equal(STORY_BACKGROUNDS.length, 8);
    for (const value of STORY_BACKGROUNDS) {
      assert.match(value, /^#[0-9A-F]{6}$/u, "the service takes UPPERCASE hex");
    }
    assert.equal(isStoryBackground("#7E3BEB"), true);
    assert.equal(isStoryBackground("#7e3beb"), false, "lowercase is not one of the eight");
    assert.equal(isStoryBackground("red"), false);
  });

  it("maps every font token to a face, with no gaps", () => {
    for (const token of STORY_FONTS) {
      assert.ok(STORY_FONT_CLASS[token], `${token} has no face`);
    }
  });
});

describe("a story with no style", () => {
  it("keeps the background it has always had", () => {
    /*
      Null is NOT a gap. The service's own words: it means "play on the default
      background, which is how every story posted before this existed". So the
      old gradient stays the answer, rather than those stories turning a colour.
    */
    assert.match(storyBackgroundCss(null), /linear-gradient/u);
    assert.equal(storyFontClass(null), "font-sans");
  });

  it("is still drawn by the viewer's original ground", () => {
    assert.match(viewer, /story\.storyStyle && !story\.mediaUrl \?/u);
    assert.match(viewer, /<GradientThumb/u, "the seeded texture stays for styled-less stories");
  });
});

describe("both halves exist", () => {
  it("the creator can SET one", () => {
    assert.match(creator, /STORY_BACKGROUNDS\.map\(/u, "a swatch per colour");
    assert.match(creator, /STORY_FONTS\.map\(/u, "a chip per face");
    assert.match(creator, /storyStyle: \{ background, font \}/u, "and it is sent");
  });

  it("the viewer can READ one", () => {
    assert.match(viewer, /style=\{\{ background: story\.storyStyle\.background \}\}/u);
    assert.match(viewer, /storyFontClass\(story\.storyStyle\)/u);
  });

  it("is sent only on a story, never on an update", () => {
    // The service answers 400 rather than ignoring it.
    assert.match(creator, /stage\.kind === "text" \? \{ storyStyle/u);
  });

  it("is declared on the request type, not smuggled through a spread", () => {
    /*
      A spread bypasses TypeScript's excess-property check: `guests` on stream
      create typechecked perfectly while being absent from its own input type.
      The type is what tells the next caller the field exists at all.
    */
    assert.match(api, /storyStyle\?: StoryStyle;/u);
  });

  it("parses without letting an unknown background break the post", () => {
    // `.catch(null)` — a story carrying a colour outside the eight plays on the
    // default rather than vanishing from the feed.
    const at = schemas.indexOf("storyStyle: z");
    assert.ok(at > 0, "storyStyle must be on the Post schema");
    assert.match(schemas.slice(at, at + 400), /\.catch\(null\)/u);
  });
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * THE INVITATION CARD — nodes 2225:20359 and 2225:20405, built for PIXEL PARITY.
 *
 * The card is the file's 380×279 frame with every layer absolutely positioned
 * at its own coordinate and every size a percentage of the card's width, so it
 * is a faithful scaled copy at any width. These pin the frame, the coordinates
 * and the exported artwork, because a value that drifts here is a card that is
 * no longer the design.
 */
describe("the invite card is pixel parity with the Figma frame", () => {
  const page = readFileSync(new URL("../features/messages/components/join-page.tsx", import.meta.url), "utf8");

  it("is the file's 380x279 frame at a 24px radius", () => {
    assert.match(page, /aspect-\[380\/279\]/, "the card is no longer the file's frame ratio");
    // The 24px radius is fixed, not scaled: a proportional radius grew to ~38px
    // at the display width and read as too round (ogazboiz, 2026-09-30).
    assert.match(page, /rounded-\[24px\]/, "the card's 24px radius changed");
    assert.match(page, /@container/, "the cqw sizes have no container to resolve against");
  });

  it("anchors every layer at the coordinate the node sits at", () => {
    // decoration fills the frame; banner top-anchored and overflowing; content
    // at x93/y123 (24.474% / 44.086%), 201 wide (52.895%).
    assert.match(page, /absolute inset-0 h-full w-full object-cover/, "the decoration no longer fills the frame");
    assert.match(page, /absolute inset-x-0 top-0 aspect-\[380\/108\]/, "the banner lost its top-anchored strip");
    // A real photo fills the strip with no over-scale — the 452-wide overflow
    // magnified the crop and read as "too zoomed" (ogazboiz, 2026-09-30).
    assert.doesNotMatch(page, /w-\[118\.94%\]/, "the cover photo is over-scaled/zoomed again");
    // Content is centered in the area below the banner (top 38.71% = 108/279),
    // so the button always keeps space beneath it and the block never drops to
    // the foot or crowds the banner (ogazboiz, 2026-09-30).
    assert.match(page, /absolute inset-x-0 bottom-0 top-\[38\.71%\] flex flex-col items-center justify-center/, "the content wrapper lost its centering below the banner");
    assert.match(page, /flex w-\[52\.895%\] flex-col items-center gap-\[2\.632cqw\]/, "the content column lost its width/gap");
  });

  it("sizes type as pure cqw — a scaled replica, no pixel floors", () => {
    assert.match(page, /text-\[5\.263cqw\]/, "the title lost the file's 20px as 5.263cqw");
    assert.match(page, /text-\[2\.105cqw\]/, "the body lost the file's 8px as 2.105cqw");
    assert.match(page, /text-\[2\.364cqw\]/, "the button label lost the file's 8.985px as 2.364cqw");
    assert.match(page, /gap-\[2\.632cqw\]/, "the 10px block gap changed");
    assert.match(page, /h-\[8\.613cqw\]/, "the 32.73px button height changed");
    assert.doesNotMatch(page, /max\(\d+px,/, "a pixel floor is back, breaking the proportion at some widths");
  });

  it("paints the file's own ramps and the silver button's two shadows", () => {
    assert.match(page, /linear-gradient\(171deg,#9F65FD_0%,#7E3BEB_100%\)/, "the card's base ramp changed");
    assert.match(
      page,
      /linear-gradient\(162deg,#FFFFFF_0%,#EDEDF0_38%,#CBCBD1_63%,#F5F5F8_100%\)/,
      "the silver button ramp changed",
    );
    assert.match(page, /shadow-\[0_0\.338cqw_1\.351cqw_#9F65FD,inset_0_0\.169cqw_0_rgba\(255,255,255,0\.95\)\]/);
  });

  it("draws the ramp + star + cloud scene from the file's export", () => {
    assert.match(page, /asset\("\/gist-rooms\/invite-card-decoration\.svg"\)/, "the card lost its cloud/star scene");
    const svg = readFileSync(new URL("../public/gist-rooms/invite-card-decoration.svg", import.meta.url), "utf8");
    assert.match(svg, /viewBox="0 0 380 279"/, "the decoration is no longer the card's own box");
    assert.doesNotMatch(svg, /fill="#1E1E1E"/, "the Figma artboard rect is back in the export");
  });

  it("ships the coverless banner's REAL vector — doodles and all, not a 4-path stub", () => {
    assert.match(page, /asset\("\/gist-rooms\/invite-default-banner\.svg"\)/);
    const svg = readFileSync(new URL("../public/gist-rooms/invite-default-banner.svg", import.meta.url), "utf8");
    assert.match(svg, /viewBox="0 0 380 108"/, "the banner is no longer the node's own box");
    assert.doesNotMatch(svg, /fill="#1E1E1E"/, "the Figma artboard rect is back in the banner export");
    const paths = (svg.match(/<path/g) ?? []).length;
    assert.ok(paths > 100, `the banner has only ${paths} paths — the doodle field is missing (the old stub had 4)`);
  });

  it("keeps a sample photo out of the forbidden houses directory", () => {
    assert.ok(!existsSync(new URL("../public/houses", import.meta.url)), "public/houses is back");
  });

  it("still answers for everybody holding the link, not only the one happy state", () => {
    for (const state of ["member", "join", "sign-in", "expired", "used_up", "refused"]) {
      assert.ok(page.includes(`state === "${state}"`), `the ${state} state is gone`);
    }
    assert.match(page, /const state = inviteState\(house, authenticated\);/);
    assert.match(page, /This link has expired/);
    assert.match(page, /This link has been used up/);
    assert.match(page, /accept\.mutate\(token/, "the join button no longer accepts the invite");
  });

  it("does not uppercase the house's name, and uses the file's bullet", () => {
    assert.doesNotMatch(page, /className="[^"]*\buppercase\b/u, "every lowercase house name is now being shouted");
    assert.ok(page.includes("• `"), "the members separator went back to a middot");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

/*
  INSTALLED TO THE HOME SCREEN, THE TOP BAR WAS BEHIND THE STATUS BAR.

  Reported from a real iPhone with a screenshot: the logo, the live pill and
  the notification bell were not clipped, they were GONE — iOS had drawn its
  clock, signal and battery straight over them, and there is nothing to scroll
  in a fixed bar. The arithmetic is why it was total rather than partial: the
  strip is 56 tall and the inset on a notched iPhone is about 59.

  THREE THINGS THIS APP DECLARES CAUSE IT, and all three are deliberate:

    · `viewportFit: "cover"`          so the keyboard shrinks the layout
    · `apple-mobile-web-app-capable`  so iOS delivers web push at all
    · `statusBarStyle: black-translucent`  so the status bar sits on the wash

  Together they mean the page runs under the status bar in an installed app and
  `env(safe-area-inset-top)` is what reserves the room. In a BROWSER TAB none of
  it applies — Safari's own chrome holds that space — which is exactly why this
  survived every check on a desktop and every check in mobile Safari, and only
  ever broke for the readers who did the thing we asked them to do.

  So this file asserts the fix against its CAUSE: while the app declares those
  three, every bar pinned to the top of the viewport must carry the inset. The
  pairing is what matters — the variable reserves the room and the bar pads
  itself by the same amount — so both halves are pinned, in both bars.

  See `room-guests.test.ts` for why the URL goes to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const css = read("app/globals.css");
const shell = read("components/layout/app-shell.tsx");
const layout = read("app/layout.tsx");

/** The `:root` block, which is where a variable's phone value is declared. */
const root = css.slice(css.indexOf(":root"), css.indexOf("@media (min-width: 768px)"));
/** The md block, where the tablet/desktop values override it. */
const md = css.slice(css.indexOf("@media (min-width: 768px)"));

describe("the three declarations that put the page under the status bar", () => {
  /*
    If one of these is ever removed the insets below stop being load-bearing —
    so they are asserted HERE, next to the fix, rather than left as a sentence
    in a comment that the next edit cannot read.
  */
  it("asks for the full viewport", () => {
    assert.match(layout, /viewportFit: "cover"/u);
  });

  it("declares itself installable, which is what makes iOS deliver push", () => {
    assert.match(layout, /capable: true/u);
    assert.match(layout, /"apple-mobile-web-app-capable": "yes"/u);
  });

  it("lets the status bar sit ON the page rather than above it", () => {
    assert.match(layout, /statusBarStyle: "black-translucent"/u);
  });
});

describe("the phone's top strip", () => {
  it("reserves the status bar in the variable every other surface reads", () => {
    /*
      THE INSET BELONGS TO THE VARIABLE, not to the one call site. `main`'s top
      padding, the house chip and the room mini-player's offset all reserve room
      under this bar by reading `--ws-topbar-h`. Fold the inset in once and every
      one of them is correct; add it at the bar alone and every one of them is
      wrong by the height of a status bar, which is the bug one layer down.
    */
    assert.match(root, /--ws-topbar-h: calc\(env\(safe-area-inset-top, 0px\) \+ 56px\);/u);
  });

  it("pads itself by the same inset, so its 56 of content is unchanged", () => {
    /*
      Border-box sizing: height is inset+56 and padding-top is the inset, which
      leaves exactly 56 of content box. Without the padding the bar would simply
      be taller and the logo would still be under the clock — `items-center`
      would centre it against the inset as well as the content.
    */
    assert.match(shell, /fixed inset-x-0 top-0 z-40[^"]*pt-\[env\(safe-area-inset-top,0px\)\][^"]*md:hidden/u);
  });
});

describe("the tablet and desktop bar", () => {
  it("reserves the inset too, at the width an installed iPad actually lands on", () => {
    /*
      An installed iPad is >=768 and so gets THIS bar, not the phone strip. Its
      overlap is smaller — about 24 against a 76 bar, so the lockup clips rather
      than disappearing — and that is the reason to fix it rather than a reason
      to skip it: a bug that only spoils a surface is the one nobody reports and
      nobody then fixes.
    */
    assert.match(md, /--ws-crumb-h: calc\(env\(safe-area-inset-top, 0px\) \+ 76px\);/u);
  });

  it("takes its height from that variable instead of a literal 76", () => {
    assert.match(shell, /"sticky top-0 z-30 hidden h-\[var\(--ws-crumb-h\)\][^"]*pt-\[env\(safe-area-inset-top,0px\)\][^"]*md:flex"/u);
  });

  it("keeps the phone strip's variable at zero here, where that strip is hidden", () => {
    // Two bars, one visible at a time: at this width the phone strip is
    // `md:hidden`, so anything padding by `--ws-topbar-h` must pad by nothing.
    assert.match(md, /--ws-topbar-h: 0px;/u);
  });
});

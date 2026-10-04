import assert from "node:assert/strict";
import fs from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { isPublicPost } from "./api/public-routes.ts";

/**
 * Three shell invariants that only exist as source.
 *
 * The nav list, the rail card and the mobile bar are all client components
 * behind auth hooks and `next/image`, so nothing here can be rendered under
 * `node --test` — and the server HTML never contains any of it. What CAN be
 * proved without a browser is the shape of the source: which hrefs the nav
 * carries, that each slide owns its destination, and that the bar reserves
 * room it cannot be talked out of.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * Both files explain in prose the exact things these tests forbid — the entry
 * that was removed, the shared CTA that was split — so assertions must read
 * code, never comments. Line comments are stripped only where the `//` does
 * not follow a colon: a slide's whole point is the URL it carries, and
 * `https://` is not a comment.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * A negative assertion against an empty string always passes, so a slice that
 * missed is worse than useless — it is a green test that checks nothing.
 */
const block = (source: string, open: string, close: string) => {
  const from = source.indexOf(open);
  assert.notEqual(from, -1, `"${open}" is gone — these assertions are reading the wrong code`);
  const to = source.indexOf(close, from + open.length);
  assert.notEqual(to, -1, `"${close}" never closed "${open}" — the slice would be the rest of the file`);
  return source.slice(from, to + close.length);
};

const shell = stripComments(read("components/layout/app-shell.tsx"));
const rail = stripComments(read("components/layout/ecosystem-partners-rail.tsx"));

const NAV = block(shell, "const NAV: NavItem[] = [", "\n];");
const MOBILE_BAR = block(shell, "function MobileBar(", "\nexport function AppShell");
const CREATE_BUTTON = block(MOBILE_BAR, 'aria-label="Create post"', "</button>");
const SLIDES = block(rail, "const SLIDES: PartnerSlide[] = [", "\n];");

describe("the sidebar offers no WorldStreet entry", () => {
  it("lists nothing but routes in this app", () => {
    assert.doesNotMatch(
      NAV,
      /worldstreet/i,
      "the WorldStreet nav item is back in NAV — it was deliberately dropped, not misplaced"
    );
    // The entry was the ONLY absolute href the list ever held, so an off-site
    // URL here is that entry returning under another name. It also silently
    // breaks the active state, which no pathname can ever match.
    const hrefs = [...NAV.matchAll(/href:\s*([^,\n]+)/g)].map((match) => match[1]!.trim());
    assert.ok(hrefs.length > 5, "NAV parsed to almost no entries — the regex is reading the wrong shape");
    for (const href of hrefs) {
      assert.match(href, /^"\//, `nav href ${href} leaves the app — every entry must be a route`);
    }
  });

  it("keeps no dead constant or icon import to rebuild it from", () => {
    // A dead export is how the entry comes back by accident: the next reader
    // finds a URL constant and an external-link glyph sitting unused in the
    // shell and concludes something is missing rather than that it was cut.
    assert.doesNotMatch(shell, /WORLDSTREET_URL/, "the URL constant the entry was the only user of is back");
    assert.doesNotMatch(
      shell,
      /NEXT_PUBLIC_WORLDSTREET_URL/,
      "the shell reads the WorldStreet origin again — it has no entry left to point anywhere"
    );
    assert.doesNotMatch(
      shell,
      /\bIconExternal\b/,
      "IconExternal is imported again — nothing in the shell links off-site any more"
    );
  });
});

describe("each ecosystem slide leads to its own product", () => {
  // Split on the boundary between the two top-level entries. `headline`'s
  // nested object closes onto a key, never onto `{`, so it survives intact.
  const slides = SLIDES.split(/\},\s*\{/);

  it("points the LinkPay slide at LinkPay", () => {
    assert.equal(slides.length, 2, "the carousel is no longer the two slides these assertions describe");
    const linkpay = slides.find((slide) => /alt:\s*"LinkPay"/.test(slide));
    assert.ok(linkpay, "no slide is labelled LinkPay any more — the second card lost its identity");
    assert.match(
      linkpay,
      /href:\s*"https:\/\/linkpay-lemon\.vercel\.app\/en"/,
      "the LinkPay slide stopped pointing at LinkPay — its copy sells that product, so its CTA must open it"
    );
  });

  it("gives every slide its own destination rather than one shared CTA", () => {
    // Both cards used to share a module-level JOIN_URL, which made the second
    // slide advertise LinkPay and open the platform — a carousel where every
    // card leads to the same place is a banner with extra steps.
    const hrefs = slides.map((slide) => slide.match(/href:\s*([^,\n]+)/)?.[1]?.trim());
    for (const [at, href] of hrefs.entries()) {
      assert.ok(href, `slide ${at + 1} carries no href of its own — it is riding on someone else's`);
    }
    assert.notEqual(hrefs[0], hrefs[1], "both slides resolved to one URL again");
    assert.match(rail, /href=\{slide\.href\}/, "the Join now link stopped reading the current slide's href");
    assert.doesNotMatch(
      rail,
      /const\s+JOIN_URL/,
      "a single shared CTA URL is hardcoded again — that is what sent LinkPay's card to the platform"
    );
  });
});

describe("the mobile tab bar reserves the create button's footprint", () => {
  it("pads the frame by the button's width, and only when there is a button", () => {
    // Centred on the screen the pill grows symmetrically as the active tab's
    // label appears, and "Messages" is wide enough that its right edge reached
    // the button and touched it. Reserving makes that impossible at ANY label
    // length; a fixed nudge would fix one label and break every shorter one.
    assert.match(
      MOBILE_BAR,
      /onCompose && "pr-\[70px\]"/,
      "the bar no longer reserves the create button's footprint — the two can collide on a long tab label"
    );
    assert.match(
      MOBILE_BAR,
      /justify-center/,
      "the bar stopped centring — reserving space only recentres it if the frame still centres its content"
    );
  });

  it("pins the button out of the flow at the right edge", () => {
    assert.match(
      CREATE_BUTTON,
      /absolute right-3/,
      "the create button rejoined the flow — in the row it shifts the bar off centre by half its own width"
    );
    assert.doesNotMatch(
      CREATE_BUTTON,
      /\bfixed\b/,
      "a fixed button is positioned against the viewport, not this frame, so it drifts back over the bar"
    );
  });

  it("reserves exactly the width the button occupies", () => {
    // Two numbers in two places describing one gap: if they drift, they drift
    // silently, and the symptom is the collision this reservation prevents.
    const reserved = Number(MOBILE_BAR.match(/onCompose && "pr-\[(\d+)px\]"/)?.[1]);
    const width = Number(CREATE_BUTTON.match(/size-\[(\d+)px\]/)?.[1]);
    const inset = Number(CREATE_BUTTON.match(/right-(\d+)\b/)?.[1]) * 4;
    for (const [name, value] of [["reserved", reserved], ["width", width], ["inset", inset]] as const) {
      assert.ok(Number.isFinite(value), `could not read the button's ${name} — the classes changed shape`);
    }
    assert.equal(
      reserved,
      width + inset,
      "the reserved padding and the button's real footprint disagree — one of the two was changed alone"
    );
  });
});

/**
 * What the sidebar promotes, and what only the sidebar drops.
 *
 * `NAV` feeds three surfaces — the desktop sidebar, the mobile tab bar and the
 * mobile drawer — so "remove it from the sidebar" and "remove it" are
 * different edits with very different consequences, and the difference is not
 * visible from the list alone.
 */
describe("the sidebar hides rows without removing their route", () => {
  it("asks visibleNav WHICH surface is filtering", () => {
    // Without the surface argument the filter cannot tell the sidebar from the
    // mobile bar, and `sidebar: false` silently applies to both.
    assert.match(
      shell,
      /surface:\s*"sidebar"/,
      "the sidebar no longer identifies itself to visibleNav"
    );
    assert.match(
      shell,
      /surface:\s*"mobile"/,
      "the mobile nav no longer identifies itself to visibleNav"
    );
    assert.match(
      shell,
      /options\.surface !== "sidebar" \|\| item\.sidebar !== false/,
      "visibleNav stopped scoping `sidebar: false` to the sidebar"
    );
  });

  it("KEEPS notifications in NAV, because a phone has no other door to it", () => {
    // The desktop breadcrumb carries a bell; below md there is no breadcrumb
    // (`--ws-crumb-h` is 0) and the mobile header deliberately carries no bell
    // because this entry exists. Deleting the row — the obvious way to "finish"
    // hiding it — leaves a phone with no route to notifications and no unread
    // badge anywhere in the app.
    assert.match(
      NAV,
      /href:\s*"\/notifications"/,
      "the notifications entry was deleted from NAV, not just hidden from the sidebar"
    );
    assert.match(
      NAV,
      /"\/notifications"[\s\S]{0,400}?sidebar:\s*false/,
      "notifications is no longer hidden from the sidebar"
    );
  });

  it("puts gist rooms IN the sidebar, spelled the design's way", () => {
    // It was `sidebar: false` against the older file, on the argument that the
    // hallway at the top of Home was door enough. Node 496:13107 draws the row
    // third, between Explore and Chat — a summary needs somewhere to point, and
    // the hallway only ever showed the rooms open right now.
    assert.match(NAV, /label:\s*"Gistrooms"/, "the row lost the file's spelling");
    assert.doesNotMatch(
      NAV,
      /"\/gist-rooms"[^\n]*sidebar:\s*false/,
      "gist rooms is hidden from the sidebar again"
    );
    // A renamed row is not a moved route.
    assert.match(NAV, /href:\s*"\/gist-rooms"/, "the gist rooms route moved");
  });

  it("draws the rows on the FILE'S glyphs, not the app's nearest equivalents", () => {
    /*
      Three of these were not near-misses. Explore was a MAGNIFIER where
      496:13119 draws a GLOBE; Gistrooms was a house where 496:13126 draws a
      MICROPHONE; Live was our own play badge where 496:13139 draws a framed
      Video. A magnifier says "search" and a globe says "everything out there",
      and only one of those is what Explore became.

      Pinned by the icon a row is wired to, and by the glyph module being the
      exported one — `sidebar-icons.tsx` holds the file's vectors verbatim with
      the baked fills swapped for currentColor.
    */
    /*
      Matched WITHIN the row's own object literal, not on one line.

      These were `/"\/gist-rooms"[^\n]*icon:/` — `[^\n]*` forbids a newline, so
      the assertion held only while the whole entry fitted on one line. A
      formatter wrapping a single entry broke a suite about ICONS, which is the
      same brittleness as asserting `className="fixed ` by its position in a
      string. The invariant is "this row is wired to this glyph"; where the
      line breaks is not part of it.
    */
    const rowFor = (href: string) => {
      const at = NAV.indexOf(`href: "${href}"`);
      assert.notEqual(at, -1, `no NAV row for ${href}`);
      const end = NAV.indexOf("}", at);
      return NAV.slice(at, end === -1 ? undefined : end);
    };
    const wiredTo: Array<[string, string, string]> = [
      ["/", "IconSbHome", "Home is off the file's glyph"],
      ["/discover", "IconSbExplore", "Explore is not the file's globe"],
      ["/gist-rooms", "IconSbGistrooms", "Gistrooms is not the file's microphone"],
      ["/messages", "IconSbChat", "Chat is off the file's glyph"],
      ["/live", "IconSbLive", "Live is not the file's video"],
      ["/arkmarks", "IconSbLibrary", "Library is off the file's bookmark"],
    ];
    for (const [href, icon, why] of wiredTo) {
      assert.match(rowFor(href), new RegExp(`icon:\\s*${icon}\\b`), why);
    }
  });

  it("carries LIBRARY on the saved-posts route, not a new one", () => {
    // 496:13107 draws it sixth, on a bookmark. The design renamed the
    // DESTINATION; the act of saving is still the Arkmark and the route is
    // still /arkmarks — the same relationship "For Creators" has with /studio.
    assert.match(NAV, /label:\s*"Library"/, "the library row is gone");
    assert.match(NAV, /href:\s*"\/arkmarks"/, "library no longer points at /arkmarks");
  });
});

describe("the creators entry is node 225:3252", () => {
  it("says For Creators, on the file's own glyph", () => {
    assert.match(NAV, /label:\s*"For Creators"/, "the label is no longer the design's");
    // The glyph is the same MusicNotesPlus it always was — it now comes from
    // `sidebar-icons.tsx`, exported from 496:13153 with the rest of the rail's
    // set, rather than from the app's own copy of it.
    assert.match(NAV, /icon:\s*IconSbCreators/, "the entry is not on the design's icon");
  });

  it("still points at /studio — a renamed entry is not a moved route", () => {
    // Every link already sent to /studio has to keep working; the design
    // changed what the row says, not where it goes.
    assert.match(
      NAV,
      /href:\s*"\/studio"/,
      "the creators entry no longer points at /studio"
    );
    assert.doesNotMatch(NAV, /label:\s*"Studio"/, "the old label is back");
  });
});

/**
 * Two things that were CLIPPED or INERT, and could be again.
 *
 * Both failed silently. The partner card looked finished while its call to
 * action was cut in half, and the deck's follow badge looked like a control
 * while doing nothing at all — neither produces an error, a warning or a
 * failing test on its own.
 */
describe("the partner card cannot hide its own call to action", () => {
  it("uses a MINIMUM height, never a fixed one", () => {
    // `h-[156px]` is the height the file draws, and it holds only while the
    // headline is two lines. "One Platform. Every Currency. Every Asset."
    // wraps to three at the rail's real width.
    assert.doesNotMatch(
      rail,
      // Negative lookbehind, or this matches the `h-[156px]` inside
      // `min-h-[156px]` and fails on the fix itself.
      /(?<!min-)h-\[156px\]/,
      "the partner card is back on a fixed height — a longer headline will push Join now out of it"
    );
    assert.match(rail, /min-h-\[156px\]/, "the card lost its minimum height");
  });

  it("does not clip its overflow", () => {
    // With a floor and flowing children nothing should overflow; if something
    // does, it must be visible rather than quietly cut off.
    assert.doesNotMatch(
      rail,
      /overflow-hidden/,
      "overflow-hidden is back on the partner card — that is what made the clipped Join now invisible"
    );
  });

  it("lets the headline column shrink instead of pinning its width", () => {
    // Without min-w-0 a flex child refuses to go below its longest word, and
    // the text pushes into the logo again.
    assert.match(rail, /min-w-0/, "the headline column can no longer rewrap");
  });
});

describe("the friends deck offers a real Follow", () => {
  /*
    The CARD is `PalCard`, shared by the deck (Home and `/pals`) and the
    "Suggested Pals" rail (540:19351) — one object drawn at two sizes, because
    two copies of this markup is how a wink cooldown gets fixed on one surface
    and not the other. So the badge and the two controls are asserted here; the
    FAN — placement, tilt, scale, opacity — is asserted on the deck below.
  */
  const card = stripComments(read("components/layout/pal-card.tsx"));

  it("is a button, not a decorative glyph", () => {
    // It shipped as a bare <IconDeckAdd/>: pass and wink were real buttons and
    // the one control people actually reach for was an ornament.
    assert.match(
      card,
      /aria-label=\{isFollowing \? `Unfollow/,
      "the follow badge is not a labelled control any more"
    );
    assert.match(card, /follow\.mutate\(!isFollowing\)/, "the follow badge does nothing again");
  });

  it("sits INSIDE the card, as both files place it", () => {
    // The badge hung 8px off the right edge once, which is what made it read
    // as stuck onto the photo rather than part of the card. Node 844:23446 puts
    // it 23.27 in from the right and 20.59 from the top; the rail's 6.77.
    assert.doesNotMatch(card, /-right-2/, "the follow badge hangs outside the card again");
    assert.match(card, /right: node\.badge\.right/, "the deck badge lost the file's inset");
    assert.match(card, /right: 23\.27, top: 20\.59/, "the deck's own 23.27 / 20.59 inset is gone");
    assert.match(card, /right: g\.badge\.inset/, "the rail badge lost the file's inset");
    assert.match(card, /inset: 6\.77/, "the rail's own 6.77 inset is gone");
  });

  it("paints ABOVE the photo it overlaps", () => {
    // The badge is `absolute` and sits before the photo's own `relative`
    // wrapper in the markup. Two positioned elements at the same z-index paint
    // in DOM order, so without an explicit lift the photo covers the badge and
    // the control vanishes into the picture — not clipped, not mispositioned,
    // just underneath. Nothing else in the build can see that.
    assert.match(
      block(card, "aria-label={isFollowing ?", "</button>"),
      /\bz-10\b/,
      "the follow badge lost its z-index and is painted under the photo again"
    );
  });

  it("reads the follow edge rather than the raw field", () => {
    assert.match(card, /useIsFollowing\(profile\)/, "a missing isFollowing can now fabricate Following");
  });
});

describe("the wink write waits for the viewer, so its cooldown record is keyed", () => {
  // The server carries winkedByMe once auth has settled (fix/public-reads-wait-
  // for-auth), so follow/wink are right after a reload without a client bridge.
  // What the transport fix does NOT cover is the local same-browser cooldown:
  // its optimistic write is keyed per viewer, so the button must not fire before
  // /me resolves or the record lands under no reader and resets (2026-09-28).
  const profileHook = stripComments(read("features/profile/hooks/use-profile.ts"));

  it("holds the wink until the viewer profile has loaded, so the record is keyed", () => {
    // Winking before /me resolves recorded under no viewer and reset on reload.
    assert.match(profileHook, /const viewerResolving = authenticated && me\.isPending/);
    assert.match(profileHook, /if \(!eligibility\.ok \|\| throttled \|\| viewerResolving\) return/);
    assert.match(profileHook, /isPending: mutation\.isPending \|\| viewerResolving/);
  });
});

describe("the friends deck is node 844:18440's, on Home and on /pals", () => {
  const deck = stripComments(read("components/layout/friends-deck.tsx"));
  const layout = stripComments(read("lib/deck-layout.ts"));
  const card = stripComments(read("components/layout/pal-card.tsx"));

  /*
    A CARD BEHIND THE FRONT ONE IS A PICTURE, NOT A TARGET.

    The back cards were `aria-hidden` and fully tappable — hidden from anyone
    navigating by structure, live to everyone navigating by touch. The buttons
    on them were already `disabled`; the card FACE, the biggest target on
    screen, was a plain `<Link>` carrying `tabIndex={-1}` alone, which governs
    the tab order and nothing else. Tapping the blurred card at either edge of
    the fan opened that person.
  */
  it("takes no pointer on any card but the front one", () => {
    assert.match(
      deck,
      /!front && "pointer-events-none"/,
      "a back card must refuse pointers, not just hide from a screen reader",
    );
    assert.match(
      card,
      /!interactive && "pointer-events-none"/,
      "the card face is the largest target and must go inert with the card",
    );
    assert.match(card, /aria-disabled=\{interactive \? undefined : true\}/);
    assert.doesNotMatch(
      card,
      /tabIndex=\{interactive \? undefined : -1\}\s*\n\s*className="absolute block overflow-hidden"/,
      "tabIndex alone was the bug: it never refused a tap",
    );
  });

  /*
    BOTH SIDES BLUR, and that is a DEPARTURE from the file, asked for after
    looking at it running: the design softens only the next card so who is
    next stays a surprise, and the asymmetry read as a rendering fault. The
    card behind you is somebody already shown, so it gives nothing away.
  */
  it("blurs the card on each side, not only the one ahead", () => {
    assert.match(deck, /Math\.abs\(slot\) === 1 && "blur-\[7px\]"/);
    assert.doesNotMatch(
      deck,
      /slot === 1 && "blur-\[7px\]"/,
      "blurring only the next card leaves the fan lopsided",
    );
  });

  it("DIMS the two cards behind by the node's own opacity — 0.39 and 0.30", () => {
    // The file draws depth here with layer opacity on the whole back card,
    // photo and controls included; the front card alone is at full strength.
    assert.match(layout, /opacity: 0\.39/, "the left card lost the node's 0.39");
    assert.match(layout, /opacity: 0\.3\b/, "the right card lost the node's 0.30");
    assert.match(deck, /opacity: swipe\.committing \? 0 : place\.opacity/, "the node's opacity is no longer applied");
  });

  it("TILTS and SHRINKS them by the node's solved sizes, never its bounding boxes", () => {
    assert.match(layout, /rot: -6\.836/, "the left card lost its tilt");
    assert.match(layout, /rot: 13\.524/, "the right card lost its tilt");
    assert.match(layout, /scale: 0\.8171/, "the left card is no longer 444.01 wide");
    assert.match(layout, /scale: 0\.83\b/, "the right card is no longer 451.06 wide");
    assert.match(deck, /rotate\(\$\{place\.rot\}deg\) scale\(\$\{place\.scale \* k\}\)/, "tilt or scale is no longer applied");
  });

  it("scales the whole fan by ONE factor from lib/deck-layout, never inline", () => {
    assert.match(deck, /deckLayout\(\{ room/, "the deck computes its own scale again");
    assert.doesNotMatch(deck, /(left|right)-0 bg-(black|white)/, "a step disc is pinned to the column edge instead of the file's own position");
    assert.doesNotMatch(deck, /\/ 917|\/ 543/, "a file span is divided inline in the deck");
  });

  it("DECIDES on both decks, and never follows without the gate", () => {
    /*
      This read "BROWSES on Home and DECIDES on /pals" until 2026-09-18. The
      reason for the split was that a gesture which quietly followed somebody
      while a reader scrolled past Home would be an act nobody asked for.

      What changed: Home's card already carries the file's own ✕ and wink
      buttons, so it was ALREADY a deciding surface — the swipe was the only
      part of it that was not, and the verdict stamps (856:23668 / 856:23693)
      never appeared there. ogazboiz asked for them ("please show it in that
      red flag and green flag ... in that wink card in home"), so both decks
      now decide.

      The guard that mattered stays and is asserted below: a swipe can follow
      but can NEVER unfollow, and never without `useGate`.
    */
    assert.match(deck, /decide\n/, "Home's card browses again, so its gesture draws no verdict");
    assert.match(deck, /canCommit:/, "a swipe past either end flies out instead of springing back");
  });

  it("a swipe can follow but can never UNfollow, and never without the gate", () => {
    /*
      `mutate(!isFollowing)` would have made a right swipe on somebody you
      already follow toggle them OFF — the one gesture on the page that could
      undo an act the reader never asked to undo. And a follow is a real act,
      so a signed-out reader meets the sign-in invitation rather than a
      silent no-op.
    */
    assert.match(deck, /decision === "follow" && !isFollowing/, "a right swipe can now unfollow somebody");
    assert.match(deck, /gate\(\(\) => follow\.mutate\(true\)\)/, "the swipe follows without the sign-in gate, or with a toggle");
    assert.doesNotMatch(deck, /follow\.mutate\(!/, "the follow is a toggle again");
  });

  it("stamps the verdict only on the front card, and only where it decides", () => {
    // A stamp on a card being paged past would promise an act that is not
    // happening; on a card behind the front one it would label the wrong person.
    assert.match(
      deck,
      /\{decide && front && \(\s*<SwipeVerdict/,
      "the verdict stamp is drawn where the gesture does not decide, or on a back card"
    );
    const stamp = stripComments(read("components/layout/swipe-verdict.tsx"));
    // The red pill's stroke is a real weight at ZERO ALPHA — it paints nothing.
    assert.doesNotMatch(stamp, /border(?!-radius)|outline:/, "the red stamp grew a border the file does not draw");
    assert.match(stamp, /opacity: verdict/, "the stamp no longer brightens with the drag");
    assert.match(stamp, /pals\/green-flag\.svg|pals\/red-flag\.svg/, "the file's own glyphs were swapped for a repo icon");
  });

  it("shows the step discs and the page pills on a PHONE too", () => {
    /*
      Both were desktop-only and ogazboiz asked why. The discs were `wide`-
      gated on "on a phone the fan is browsed by hand", which was true while
      the gesture was navigation and wrong the moment /pals made it a decision:
      a swipe there only goes forward, so without the discs a mis-swipe on a
      phone cannot be taken back at all. The pills were dropped outright in the
      deck rewrite.

      Cost is why this is not a trade: `deckExtent` grows from 943 file units
      to 954 when the discs are counted, because the fan is already wider than
      the right disc. 1.2% of card width buys the only way back.
    */
    assert.doesNotMatch(deck, /\{wide && \(/, "the step discs are gated behind a breakpoint again");
    assert.match(deck, /arrows: true/, "the layout stopped reserving room for the discs, so they overhang the column");
    assert.match(deck, /<DeckDots count=\{3\}/, "the page pills are gone again — a fan cannot say there is more after this one");
    assert.doesNotMatch(
      deck,
      /DeckDots[\s\S]{0,160}(hidden md:|md:hidden)/,
      "the page pills are hidden on one size again"
    );
  });

  it("keeps the rail on its own drawing — the node geometry is a second KIND, not a fork", () => {
    assert.match(card, /kind: "node-844"/, "the node geometry lost its discriminator");
    assert.match(card, /export const RAIL_CARD: PalCardGeometry/, "the rail's RAIL_CARD changed shape");
    assert.match(card, /export const DECK_CARD: PalCardNodeGeometry/, "the deck's geometry is gone");
    assert.match(deck, /geometry=\{card\}/, "the deck is not drawing the node's card");
    assert.match(deck, /const card: PalCardNodeGeometry = /, "the deck's card is no longer a node-844 geometry");
  });

  it("is the ONE deck, on Home only: /pals draws the topic row over the following lane instead", () => {
    // The deck is already on Home, so ogazboiz took it off /pals
    // (2026-09-12: "the second section is already on home so no need for
    // that again") and asked for the topic row over the feed there. The
    // selection is the layout's — `/topics` is discovery's, `/feed` the
    // feed's — and goes down as `topics`.
    const pals = stripComments(read("components/layout/pals-screen.tsx"));
    assert.doesNotMatch(pals, /FriendsDeck/, "the wink deck is back on /pals");
    assert.match(pals, /<TopicTabs tabs=\{tabs\} active=\{topic\} onSelect=\{setTopic\} \/>/, "/pals lost its topic row");
    assert.match(pals, /useTopics\("home"\)/, "the row is not the shared vocabulary");
    assert.match(pals, /mode="pals"\n\s*topics=\{topics\}/, "the selection does not narrow the lane");
    assert.match(stripComments(read("components/layout/home-screen.tsx")), /friendsSlot=\{<FriendsDeck \/>\}/, "Home lost the deck");
    assert.ok(!existsSync(resolve("components/layout/make-some-friends.tsx")), "the older deck is back");
  });
});

/**
 * A room with no cover shows NO COVER.
 *
 * The design fills a 741x200 rectangle white because it is drawing a room that
 * HAS a picture. An empty tinted slab in its place is our stand-in for
 * something that does not exist, and it reads as an image that failed to load
 * rather than as a room that never had one — while pushing everything below it
 * 216px down the page to make room for nothing.
 */
describe("the gist room hides its cover rather than faking one", () => {
  const room = stripComments(read("features/houses/components/house-room.tsx"));

  it("renders the cover only when there is one", () => {
    assert.match(
      room,
      /\{stream\.thumbnailUrl && \(/,
      "the cover is no longer conditional on there being a cover"
    );
  });

  it("keeps no empty panel to stand in for it", () => {
    // The placeholder was `<div className="h-[200px] w-full rounded-3xl
    // bg-white/[0.06]" />`. Nothing should hold that space open.
    assert.doesNotMatch(
      room,
      /h-\[200px\][^"]*bg-white/,
      "the empty cover placeholder is back"
    );
  });
});

/**
 * A MENU OPENED IN A FEED ITEM MUST PAINT OVER THE ITEM BELOW IT.
 *
 * `ws-enter` animates a transform and holds it with `both`, so every feed item
 * carries one permanently — and a transform creates a stacking context. The
 * post's overflow menu is `z-20`, but that only orders it INSIDE its own post;
 * against the next post, a sibling stacking context, DOM order wins. The menu
 * opened in exactly the right place and the following post painted over it,
 * with the next author's Follow button sitting on top of "Scam or fraud".
 *
 * `Sheet` hit the same transform and was portalled, but that was a different
 * failure: a `position: fixed` overlay anchors to the transformed ancestor
 * rather than the viewport, which no z-index can repair. An absolute dropdown
 * is positioned correctly here — only its paint order is wrong.
 */
describe("a feed item that owns an open popover", () => {
  const css = read("app/globals.css");

  it("lifts above the items after it", () => {
    assert.match(
      css,
      /\.ws-enter:has\(\.ws-popover\)\s*\{[^}]*z-index:\s*\d+/,
      "a popover in a feed card can be painted over by the next card again"
    );
  });

  it("is POSITIONED, or the z-index does nothing", () => {
    // `ws-enter` is `position: static`, and z-index has no effect on a static
    // element outside a flex or grid parent — the feed is a plain block list.
    assert.match(
      css,
      /\.ws-enter:has\(\.ws-popover\)\s*\{[^}]*position:\s*relative/,
      "the lift lost its positioning and is inert"
    );
  });

  it("stays STRICTLY under the breadcrumb bar", () => {
    /*
      Read the breadcrumb's own z-index rather than hard-coding one, because
      this is a RELATIONSHIP and the number on either side may move.

      The first attempt set the lift to 30, which is exactly what the breadcrumb
      carries. Equal z-index is broken by DOM order and the feed comes later, so
      the post won: its author row, avatar and Follow button printed over
      "Ark Ecosystem / Market Square" and the search field.
    */
    const shell = read("components/layout/app-shell.tsx");
    const crumb = shell.match(
      /sticky top-0 z-(\d+)[^"]*h-\[var\(--ws-crumb-h\)\]|h-\[var\(--ws-crumb-h\)\][^"]*sticky top-0 z-(\d+)/
    );
    const crumbZ = Number(crumb?.[1] ?? crumb?.[2] ?? 0);
    assert.ok(crumbZ > 0, "could not find the breadcrumb bar's z-index in the shell");

    const lift = css.match(/\.ws-enter:has\(\.ws-popover\)\s*\{[^}]*\}/)?.[0] ?? "";
    const z = Number(lift.match(/z-index:\s*(\d+)/)?.[1] ?? 0);

    assert.ok(z > 0, "the lift must beat its sibling feed items");
    assert.ok(
      z < crumbZ,
      `the lift is z-${z} and the breadcrumb is z-${crumbZ}; a tie or a win means a post paints over the chrome`
    );
  });
});

/**
 * THE WELCOME SEQUENCE HAS TO FIT THE PHONE IT IS ON.
 *
 * Measured on a real device by ogazboiz and then reproduced here: on any
 * viewport shorter than ~750 — which is every ordinary phone once the browser's
 * own chrome is showing — the Skip button sat below the fold. 143px over at
 * 375x553, 85 at 390x664, 69 at 360x620, on all three carousel screens.
 *
 * The arithmetic lives in `lib/welcome-fit.ts` and is checked numerically in
 * its own tests. What is asserted here is the WIRING that lets it work at all,
 * because each piece is one careless edit from silently undoing the fix and
 * none of them looks load-bearing:
 */
describe("the welcome sequence fits a short phone", () => {
  const frame = stripComments(read("components/layout/welcome/welcome-art.tsx"));
  const flow = stripComments(read("components/layout/welcome/welcome-flow.tsx"));
  const css = read("app/globals.css");

  it("gives the reflowed frame a DEFINITE height", () => {
    /*
      `min-h-dvh` says "at least the viewport" and then lets the content push
      past it — which is exactly what it was doing. Flexbox can only take space
      away from a child when the container's height is definite, so this single
      word is what makes every other part of the fix function.
    */
    assert.match(
      frame,
      /@container relative flex h-dvh w-full flex-col/,
      "the reflowed frame is back on min-h-dvh, so nothing can shrink and Skip falls off the bottom again"
    );
  });

  it("lets the column shrink inside it", () => {
    /*
      A flex item defaults to `min-height: auto`, i.e. "never smaller than my
      content". Without `min-h-0` the column reports the room it WANTS rather
      than the room it has, the fit pass measures that inflated figure, and the
      band is sized against space that does not exist.
    */
    assert.match(
      flow,
      /ws-welcome-bottom[^"]*\bmin-h-0\b/,
      "the welcome column can grow past the frame again — the fit pass will measure room it does not have"
    );
  });

  it("measures the column rather than the artwork", () => {
    /*
      The distinction that keeps screen two intact: the file runs the fan of
      pals 188% of the stage wide ON PURPOSE. Fitting the PICTURE to the
      viewport turned that deliberate bleed into a row of thumbnails once
      before. The fit pass measures what the TEXT needs and gives the picture
      what is left.
    */
    assert.match(frame, /querySelector<HTMLElement>\("\.ws-welcome-bottom"\)/);
    assert.match(
      frame,
      /--ws-band-cap/,
      "the band is no longer capped by the room left, so a short phone overflows again"
    );
  });

  it("publishes the fit on :root, where the derived vars are computed", () => {
    /*
      A custom property resolves where it is USED. `--ws-stage-w`,
      `--ws-art-band-h` and `--ws-art-band-top` are all derived on `:root` in
      globals.css, so a value set on the frame — a descendant — would be
      invisible to that computation and every one of them would fall back.
    */
    assert.match(
      frame,
      /document\.documentElement\.style/,
      "the fit is being published somewhere the :root derivations cannot see it"
    );
  });

  it("re-fits after every render, not only on resize", () => {
    // Continuing to the finale swaps the whole branch away without changing
    // the frame's size, so no ResizeObserver entry is delivered.
    assert.match(
      frame,
      /useLayoutEffect\(\(\) => \{\s*if \(root\.current\) fitReflowedColumn\(root\.current\);\s*\}\);/,
      "a step change no longer re-fits — the finale inherits the previous screen's band"
    );
  });

  it("scales only GAPS, never type or tap targets", () => {
    /*
      `--ws-air` multiplies padding and margins. If it ever reaches a
      font-size, a button height or the lockup, the screen stops overflowing by
      becoming unreadable instead — which is not a fix.
    */
    const air = css.match(/\.ws-welcome-bottom \{[^}]*\}/g)?.join("\n") ?? "";
    assert.match(air, /padding-top: calc\(40px \* var\(--ws-air, 1\)\)/);
    for (const banned of ["font-size", "height:", "line-height"]) {
      assert.ok(
        !new RegExp(`${banned}[^;]*--ws-air`).test(css),
        `--ws-air reached ${banned}; it may only scale gaps`
      );
    }
  });

  it("leaves the phone the design was tuned for untouched", () => {
    // welcomeAir(844) === 1 is pinned in lib/welcome-fit.test.ts; this is the
    // other half of it — the stylesheet must still ask for the file's 130vw
    // whenever the cap is not the smaller number.
    assert.match(
      css,
      /--ws-stage-w:\s*max\(\s*60vw,\s*min\(calc\(100dvh \* 1440 \/ 1024\), 130vw, var\(--ws-band-cap, 200vw\)\)\s*\)/,
      "the stage no longer prefers the file's 130vw when there is room for it"
    );
  });
});

/**
 * THE GROUP PICKER STATES THE SIZE RULE IN ONE PLACE — THE SERVICE.
 *
 * `GROUP_MAX = 20` used to block the twenty-first selection and print "(max)"
 * on Continue. It is gone: the size of a group is the service's rule, and
 * stating it in two places is how the two disagree — which they already had,
 * the service refusing with "at most 20 other people" on create and "at most
 * 21 people" on add, two numbers for one rule.
 *
 * Removing it moves the refusal from tap-time to submit-time, which is only
 * safe because the refusal is now rendered. Both halves are asserted together
 * because shipping the first without the second is a silent failure after
 * somebody has picked members and named the group.
 */
describe("the group picker leaves the size rule to the service", () => {
  const flow = stripComments(read("components/layout/create-group-flow.tsx"));

  it("hardcodes no member cap", () => {
    assert.ok(
      !/GROUP_MAX/.test(flow),
      "a client-side group cap is back — it will disagree with the service the first time either number moves"
    );
    assert.ok(
      !/\(max\)/.test(flow),
      "the Continue button claims a maximum again, with nothing to read it off"
    );
  });

  it("never refuses a selection locally", () => {
    // Every tap toggles. A `>=` inside `toggle` is the cap wearing a different
    // name, so the shape is asserted rather than the constant.
    const toggle = flow.match(/const toggle = \(profile: Profile\) =>[\s\S]*?\n {4}\);/)?.[0] ?? "";
    assert.ok(toggle, "could not find the toggle handler");
    // Arrows first: `=>` is full of the very character a comparison uses, and
    // matching it made this fail on the correct code.
    const body = toggle.replace(/=>/g, "");
    assert.ok(
      !/[<>]=?|\.length\s*[!=]==?/.test(body),
      "the picker refuses a selection again — the service is meant to be the only authority on group size"
    );
  });

  it("shows the service's refusal instead of failing silently", () => {
    /*
      The mutation carried ONLY `onSuccess` before this. A 400 set the error
      and nothing rendered it — the spinner stopped and the sheet sat there.
      With no client cap that is now the path people actually reach.
    */
    assert.match(
      flow,
      /createGroup\.isError/,
      "the create sheet no longer renders a failed create — a refused group fails silently"
    );
    assert.match(
      flow,
      /errorMessage\(createGroup\.error,/,
      "the refusal is not going through errorMessage, so a raw code or a developer string can reach the screen"
    );
    assert.match(
      flow,
      /role="alert"[\s\S]{0,120}errorMessage\(createGroup\.error/,
      "the refusal is not announced — a screen reader gets nothing when the create fails"
    );
  });
});

/**
 * THE TOP BAR IS NODE 647:17439 — the live file, updated 2026-09-10 21:10.
 *
 * It replaced the "Ark Ecosystem / <page>" breadcrumb with the lockup and the
 * account cluster.
 *
 * ─── NO SEARCH IN THE CHROME ─────────────────────────────────────────────────
 * This bar has none, on every route. An early build added one from a CACHED
 * copy of the node dated 2026-09-08; a later one put the 2026-09-12 field
 * (1295:142737) here for room codes. The 2026-09-12 Home draws that field at
 * the HEAD OF THE COLUMN (1295:142736, `HomeTopRow`), as a link into Explore's
 * search, so the bar keeps the breadcrumb-less lockup, the bell and the
 * avatar and nothing else — and both stale shapes stay pinned out.
 *
 * Also pinned are the parts the file adds: the purple count badge on
 * the bell, the avatar and caret inside one 7%-white pill, and a bottom
 * hairline that runs the whole window while the bar itself stays capped
 * ("the border line should full the screen for point A to point B").
 */
describe("the top bar is node 647:17439", () => {
  const shell = stripComments(read("components/layout/app-shell.tsx"));
  const bar = shell.slice(shell.indexOf("function TopBar("), shell.indexOf("function TopBarActions"));
  const actions = shell.slice(shell.indexOf("function TopBarActions"), shell.indexOf("export function MobileBar"));

  it("no longer carries the breadcrumb", () => {
    assert.doesNotMatch(shell, /Ark Ecosystem/, "the breadcrumb root is back in the chrome");
    assert.doesNotMatch(shell, /function Breadcrumb\b/);
  });

  it("carries no search field, on any route", () => {
    // Neither the 2026-09-08 cached shape nor the room-code field that stood
    // in the bar for a morning: the field is the column's (1295:142736).
    assert.doesNotMatch(bar, /RoomSearchField|TopBarSearch|role="search"/);
    assert.doesNotMatch(shell, /function TopBarSearch\b|function RoomSearchField\b/);
    assert.doesNotMatch(shell, /looksLikeRoomCode/, "the bar is routing room codes again");
    assert.match(bar, /<TopBarActions \/>/);
  });

  it("draws the bottom hairline across the whole window, not just the capped frame", () => {
    assert.match(bar, /after:w-\[200vw\]/, "the hairline stops at the frame's edges again");
    assert.match(
      shell,
      /min-h-dvh w-full overflow-x-clip bg-chrome/,
      "the wrapper stopped clipping the wide hairline, which would add a horizontal scrollbar"
    );
  });

  it("puts the unread COUNT on the bell in the file's purple badge", () => {
    assert.match(actions, /<IconTopBell /);
    assert.match(actions, /bg-\[#9F5AFF\]/, "the badge lost the file's #9F5AFF");
    assert.match(actions, /notifications > 9 \? "9\+" : notifications/, "the badge no longer shows the count");
  });

  it("opens the account menu from one pill holding the avatar and caret", () => {
    assert.match(shell, /<RailMenu\s+label="Account"\s+align="below"/);
    assert.match(actions, /gap-\[23px\] rounded-\[36px\] bg-white\/\[0\.07\]/, "the avatar pill lost the file's geometry");
    assert.match(actions, /<IconTopCaret /);
    assert.match(shell, /function AccountMenuItems/);
  });

  it("shows the lockup only while the rail is off, so there is never a second logo", () => {
    assert.match(shell, /<TopBar showBrand=\{!railOn\} wide=\{wide\} \/>/);
  });

  it("lines its edges up with the content under it", () => {
    /*
      "it look as if the header is wider than the content". The design insets
      the lockup 54 and the cluster 44 from a 1438 frame, which on the app's
      capped, centred layout left both hanging past the column and the rail.
      The bar's content now takes the SAME width as that group — the 600
      column, plus the rail's width from lg — with the rail's own right padding,
      so the logo starts on the column's edge and the cluster ends on the rail
      cards' edge. Read from the rail rather than restated, so the two cannot
      drift.
    */
    const rail = read("components/layout/right-rail.tsx");
    const aside = rail.match(/<aside className="([^"]*)"/)?.[1] ?? "";
    const railWidth = Number(aside.match(/\bw-\[(\d+)px\]/)?.[1] ?? 0);
    assert.ok(railWidth > 0, "could not read the right rail's width");
    assert.match(aside, /\bpr-6\b/, "the rail's right padding changed; the bar mirrors it");
    // The column is 600; a FULL route (no rail, e.g. Settings) takes the
    // column AND the rail's width — the bar's own frame — so it lines up too.
    assert.ok(
      shell.includes(`!wide && (full ? "max-w-[600px] lg:max-w-[${600 + railWidth}px] lg:pr-6" : "max-w-[600px]")`),
      "the column is no longer 600 wide, or a full route no longer matches the bar's frame"
    );
    assert.ok(
      bar.includes(`mx-auto max-w-[600px] lg:max-w-[${600 + railWidth}px] lg:pr-6`),
      `the bar's content is not the column (600) plus the rail (${railWidth}) wide`
    );
  });
});

/**
 * THE BODY UNDER THE DOCK — "there is no vertical line border line so remove
 * that when it is on dock", and "the story... should be exactly below where
 * that logo... so everything will be starting the same line".
 *
 * With the dock in charge there is no sidebar for the column's LEFT hairline to
 * separate it from ("i meant in the left side"), so that one only belongs
 * while the rail is mounted; the right one still divides column from rail. And the
 * top bar's lockup starts on the column's edge, so Home's content drops its
 * left gutter from md up to start on that same line. Phones keep the gutter
 * (the top bar is desktop-only), and so does sidebar mode (no lockup there).
 */
describe("the body under the dock", () => {
  const shell = stripComments(read("components/layout/app-shell.tsx"));
  const feed = stripComments(read("features/feed/components/feed-page.tsx"));
  const css = read("app/globals.css");

  it("drops the column's LEFT hairline under the dock and keeps the right one", () => {
    // "i meant in the left side": the right hairline still divides the column
    // from the rail; the left one would cut down the line the logo starts on.
    const mainBase = shell.match(/"[^"]*min-h-\[calc\(var\(--ws-vvh,100dvh\)-var\(--ws-crumb-h\)\)\][^"]*"/)?.[0] ?? "";
    assert.ok(mainBase, "could not find the column's base classes");
    assert.doesNotMatch(mainBase, /border-x|border-l\b/, "the column's left hairline is unconditional again");
    assert.match(mainBase, /\bws-hair\b/);
    // The right one divides the column from the rail, which is shown from lg.
    assert.match(shell, /!full && "lg:border-r"/, "the hairline between the column and the rail is gone, or drawn where there is no rail");
    assert.match(shell, /railOn && "border-l"/);
  });

  it("starts Home's content on the logo's line while the dock is on", () => {
    assert.match(feed, /className="ws-align-logo relative px-4 py-4 lg:px-6"/);
    assert.match(
      css,
      /@media \(min-width: 48rem\) \{\s*\[data-rail="off"\] \.ws-align-logo \{\s*padding-left: 0;/,
      "Home's content no longer drops its left gutter under the dock"
    );
  });
});

/**
 * THE TOPIC ROW IS NODE 647:16266 — the live file, updated 2026-09-10.
 *
 * The row was first built from 225:3352. The live node keeps its pill (101 x
 * 38, full round, the 201deg #7E3BEB -> #472185 gradient while selected) and
 * adds one thing: the "For you" pill carries the file's wink glyph (677:18745,
 * exported), 3px before the label, tinted #D8BCFF while selected.
 *
 * It no longer heads HOME (ogazboiz, 2026-09-12) — the gist rooms screen and
 * the houses street carry it now, which is why the component and this test
 * stay.
 */
describe("The topic row is node 647:16266", () => {
  const tabs = stripComments(read("features/feed/components/topic-tabs.tsx"));

  it("gives For you the file's wink, tinted #D8BCFF while selected", () => {
    assert.match(
      tabs,
      /tab\.key === null && \(\s*<IconForYou className=\{cn\("h-6 w-6 shrink-0", on && "text-\[#D8BCFF\]"\)\} \/>/,
      "the For you pill lost the file's wink"
    );
    assert.match(tabs, /gap-\[3px\]/, "the 3px between the glyph and the label is gone");
    assert.match(tabs, /function IconForYou/);
  });

  it("keeps the file's pill: 101 x 38, round, and its gradient in PIXEL space", () => {
    assert.match(tabs, /h-\[38px\] min-w-\[101px\]/);
    assert.match(tabs, /bg-\[linear-gradient\(226deg,#7E3BEB_22\.4%,#472185_84\.9%\)\]/);
    assert.doesNotMatch(tabs, /201deg/, "the unit-square angle is back");
  });
});

/**
 * HOME'S BANNER IS THREE SLIDES — 1676:17254, 1682:17344, 1683:17370
 * (2026-09-16). They replaced 1305:149178's "Create your Gistroom now" card.
 */
describe("Home's banner is the three 2026-09-16 slides", () => {
  const banner = stripComments(read("components/layout/home-banner.tsx"));
  const feed = stripComments(read("features/feed/components/feed-page.tsx"));
  const home = stripComments(read("components/layout/home-screen.tsx"));

  it("draws each card at the file's 86, radius 15, on its own ground", () => {
    assert.equal((banner.match(/relative h-\[86px\] overflow-hidden rounded-\[15px\]/g) ?? []).length, 3);
    // House keeps the ramp; the other two paint a solid OVER the same ramp, and
    // the top fill is what shows.
    assert.match(banner, /bg-\[linear-gradient\(90deg,#AD46FF_-16\.5%,#682A99_82%\)\]/);
    assert.match(banner, /bg-\[#F84538\]/);
    assert.match(banner, /bg-\[#0DCF51\]/);
    assert.doesNotMatch(banner, /@container|cqw|scale\(/, "the composition is being scaled instead of drawn");
  });

  it("uses the file's words, type and line breaks", () => {
    assert.match(banner, /text-\[14px\] font-medium leading-\[18\.2px\]/);
    assert.equal((banner.match(/text-\[14px\] font-bold leading-\[22px\]/g) ?? []).length, 1);
    assert.match(banner, /left-4 top-\[28px\] flex h-\[40px\] w-\[210px\] items-center text-\[14px\] font-bold leading-\[20px\]/);
    assert.match(banner, /<em className="font-\[family-name:var\(--font-inter\)\] font-extrabold italic">house<\/em>/);
    assert.match(banner, /font-bold italic">people<\/em>/);
    assert.match(banner, /font-bold italic">community<\/em>/);
    assert.match(banner, /Vibe in gistrooms, and\s*<br \/>\s*make fresh connections\./);
    assert.match(banner, /Explore what’s trending and\s*<br \/>\s*join conversations that matter\./);
    assert.match(stripComments(read("app/layout.tsx")), /const inter = Inter\(\{\s*variable: "--font-inter",\s*weight: \["700", "800"\],\s*style: \["italic"\]/);
  });

  it("draws the art from the file's own exports", () => {
    for (const asset of ["house-arc-top.svg", "house-arc-bottom.svg", "house-chat-cube.svg", "gist-arc-short.svg", "gist-arc-loop.svg", "gist-faces.png", "explore-arc.svg", "explore-clouds.svg", "explore-paper.svg", "explore-people.png"]) {
      assert.match(banner, new RegExp(`asset\\("/home/slides/${asset.replace(".", "\\.")}"\\)`));
      assert.ok(existsSync(resolve(`public/home/slides/${asset}`)), `${asset} is missing`);
    }
    // A blend inside an <img> blends against nothing: the element carries it.
    assert.match(banner, /const SOFT = "pointer-events-none absolute max-w-none select-none mix-blend-soft-light";/);
  });

  it("rotates on its own, holds for the reader, and never under reduced motion", () => {
    assert.match(banner, /export const BANNER_AUTOPLAY_MS = 10000;/);
    assert.match(banner, /if \(held\.size > 0\) return;/);
    assert.match(banner, /if \(window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) return;/);
    assert.match(banner, /go\(\(index \+ 1\) % SLIDES\.length\)/, "the rotation no longer loops");
    assert.match(banner, /onPointerMove=\{\(event\) => event\.pointerType === "mouse" && hold\("hover", true\)\}/);
    assert.doesNotMatch(banner, /onPointerEnter/, "hover is bound to pointerenter, which fires under a cursor that never moved");
    assert.match(banner, /hold\("hidden", document\.hidden\)/);
    assert.match(banner, /onTouchStart=\{\(\) => hold\("touch", true\)\}/);
  });

  it("pages with the file's pills and invents no destination", () => {
    assert.match(banner, /<DeckDots variant="banner" count=\{SLIDES\.length\} active=\{index\} onSelect=\{go\}/);
    assert.match(stripComments(read("components/ui/deck-dots.tsx")), /banner: \{ row: "gap-\[2\.71px\]", pill: "h-1 rounded-\[13\.54px\]", on: "w-5", off: "w-2" \}/);
    assert.match(banner, /snap-x snap-mandatory overflow-x-auto/);
    // None of the three nodes has an interaction or a button.
    assert.doesNotMatch(banner, /<Link|href=|router\.push|<button/);
  });

  it("opens the column with the search row and the banner, above everything, for EVERYBODY", () => {
    // The head slot: the row (1295:142736), then the banner 11 under it, then
    // the column's 64 to the first section — drawn before anything else.
    // The row now carries Home's own query — the field answers HERE rather
    // than throwing the reader into Explore. The banner is part of the
    // RESTING page, so it steps aside with the sections while a search is
    // open instead of sitting on top of a list of results.
    assert.match(
      home,
      /headSlot=\{\s*<>\s*<HomeTopRow value=\{query\} onChange=\{setQuery\} \/>\s*\{!searching && \(\s*<div className="mt-4">\s*<HomeBanner \/>/
    );
    assert.match(feed, /\{headSlot && <div className="mb-10 flex flex-col gap-\[11px\]">\{headSlot\}<\/div>\}/);
    const head = feed.indexOf("{headSlot && ");
    const rooms = feed.indexOf("{roomsSlot}");
    assert.ok(head > 0 && rooms > head, "the head is not above everything else");
    // Trending is NOT in the column: Home answers a search now, and typing a
    // topic beats scanning four hashtags somebody else ranked. It stays in
    // the rail and on Explore, where it costs the column nothing.
    assert.doesNotMatch(feed, /<TrendingDiscussions/, "trending is back in Home's column");
    assert.match(stripComments(read("components/layout/right-rail.tsx")), /<TrendingDiscussions limit=\{5\} \/>/);
    assert.doesNotMatch(feed, /liveCtaSlot/, "the old under-the-tabs mount is back");
    // The topic row is gone from Home (ogazboiz, 2026-09-12).
    assert.doesNotMatch(feed, /TopicTabs/);
  });});

/**
 * HOME'S SUGGESTED GISTROOMS SECTION — the first block of the content column,
 * node 647:16288 (live file, updated 2026-09-10): the heading 1069:11814, View
 * more 1069:11818, the pager dots 647:16289 and the card row 647:17211 of
 * component 415:12668 (default variant 496:13802).
 */
describe("Home's Top GistRooms section is 647:16288's first block", () => {
  const rail = stripComments(read("components/layout/live-gist-rooms.tsx"));
  const card = stripComments(read("components/layout/gist-room-card.tsx"));
  const feed = stripComments(read("features/feed/components/feed-page.tsx"));
  const icons = stripComments(read("components/ui/topic-tags-field.tsx"));

  it("heads the carousel with the file's title and View more", () => {
    // "Top", not the file's "Suggested": these are the rooms actually live (ogazboiz, 2026-09-12).
    assert.match(rail, /lead="Top"/);
    assert.match(rail, /accent="GistRooms"/);
    assert.match(rail, /useStreamList\("live", \[\], "house", undefined, "listeners"\)/, "the carousel no longer asks for live rooms, busiest first");
    const api = stripComments(read("features/streams/lib/api.ts"));
    // A deployment without the busiest-first order must fall back, not empty the shelf.
    assert.match(api, /if \(!refusedListenerSort\(error\)\) throw error;/);
    assert.match(rail, /action=\{\{ label: "View more", href: sq\("\/gist-rooms"\) \}\}/);
    // The gradient half, the pill and the file's own arrow live in the one
    // heading component now — four copies of this markup is how one section
    // ends up a different size from its neighbours.
    const heading = stripComments(read("components/layout/section-heading.tsx"));
    assert.match(heading, /bg-\[linear-gradient\(90deg,#C196FD_0%,#7E3BEB_100%\)\] bg-clip-text/);
    assert.match(heading, /font-\[family-name:var\(--font-heading\)\] text-\[24px\] font-bold leading-\[28\.61px\]/);
    assert.match(heading, /\/home\/view-more-arrow\.svg/);
    // Manrope has to be LOADED or the heading silently falls back to Geist.
    assert.match(stripComments(read("app/layout.tsx")), /Manrope\(\{/);
    assert.match(stripComments(read("app/layout.tsx")), /variable: "--font-heading"/);
  });

  it("spaces it by 1305:149177: 16 to the rail, cards 17 apart, 63 to what follows", () => {
    assert.match(rail, /mb-10/);
    assert.match(rail, /className="mb-4"/);
    assert.match(rail, /gap-\[17px\] overflow-x-auto/);
    // The pager dots belong to the BANNER in this design, not here.
    assert.doesNotMatch(rail, /DeckDots/, "the old section's pager dots are back");
    assert.doesNotMatch(rail, /mt-\[85px\]|mb-\[78px\]|gap-\[8\.67px\]/, "647:16288's spacing is back");
    assert.doesNotMatch(feed, /\{roomsSlot && <div className="mb-6">/, "an empty rooms slot takes space again");
  });

  it("draws the card at node 1769:3670: 24 mic, 12/16 title, tiny chips, small Join", () => {
    assert.match(card, /flex items-center justify-between gap-4/);
    // The 24px mic badge and the Geist SemiBold 12/16 title.
    assert.match(card, /<IconRoomBadgeMic className="h-6 w-6 shrink-0" \/>/);
    assert.match(card, /line-clamp-2 min-w-0 flex-1 text-\[12px\] font-semibold leading-4 text-white/);
    // The tiny topic chip on a single clipped line.
    assert.match(card, /flex h-\[15px\] items-center gap-1 rounded-full bg-white\/10 px-1\.5 text-\[9px\]/);
    assert.match(card, /flex h-\[15px\] flex-wrap items-center gap-x-1 gap-y-4 overflow-hidden/);
    // Chips and Join indented under the title text; Join on the create ramp.
    assert.match(card, /flex flex-col gap-3 pl-\[30px\]/);
    assert.match(card, /ws-press flex h-7 w-fit items-center gap-1 rounded-full px-3 text-\[10px\]/);
    // The card's own metrics: 342 wide, 16.862 radius, 0.766 hairline, 5.365 blur.
    assert.match(card, /w-\[342px\] shrink-0/);
    assert.match(card, /rounded-\[16\.862px\] shadow-\[inset_0_0_0_0\.766px_rgba\(255,255,255,0\.18\)\] backdrop-blur-\[5\.365px\]/);
  });

  it("draws the face cluster and +count at node 1769:3695's geometry", () => {
    assert.match(card, /h-\[62px\] w-\[84px\]/);
    assert.match(card, /left: 14\.17, top: 0, size: 36\.821, rotate: 0/);
    assert.match(card, /left: 44\.04, top: 24\.7, size: 36\.821, rotate: -4/);
    assert.match(card, /left: 0, top: 24\.13, size: 36\.821, rotate: 4/);
    // The "+N" more-in-the-room count, nullable, never fabricated as 0.
    assert.match(card, /room\.viewerCount > 0/);
    assert.match(card, /\+\{room\.viewerCount\}/);
  });

  it("gives Religion and Food & Lifestyle the file's exported glyphs", () => {
    assert.match(icons, /religion: IconTopicChurch/);
    assert.match(icons, /food: IconTopicFood/);
  });
});

/**
 * HOME'S "MAKE SOME FRIENDS" — the second block of 647:16288 (live file,
 * updated 2026-09-10): the deck 647:16300, its front card 647:16329, the
 * pills 647:16296 and the rule 647:17210. Home draws its OWN deck; `/pals`
 * keeps 844:18440's.
 */
describe("Home's Make some friends is 647:16288's second block", () => {
  const deck = stripComments(read("components/layout/friends-deck.tsx"));
  const pal = stripComments(read("components/layout/pal-card.tsx"));
  const dots = stripComments(read("components/ui/deck-dots.tsx"));
  const feed = stripComments(read("features/feed/components/feed-page.tsx"));

  it("draws Home's own deck and card, not /pals' at another scale", () => {
    assert.match(deck, /heading === "home" \? HOME_DECK_NODE : DECK_NODE/);
    assert.match(deck, /heading === "home" \? HOME_DECK_CARD : DECK_CARD/);
    assert.match(pal, /export const HOME_DECK_CARD: PalCardNodeGeometry/);
    assert.match(pal, /controls: \{ size: 60\.55, gap: 15\.61, bottom: 25\.76, passGlyph: 35\.84, winkGlyph: 40\.32, lift: 5\.59 \}/);
  });

  it("spaces it by the file: 90 to the deck, 9.38 to five pills, then the column's 64 to Coming Soon", () => {
    assert.match(deck, /md:mt-22\.5/);
    assert.match(deck, /mt-\[9\.38px\]/);
    // The rule and its 67 are gone (ogazboiz, 2026-09-12): 1305:149185 runs
    // from the pills straight on to Coming Soon on its own 64.
    assert.doesNotMatch(deck, /mt-\[67px\] h-\[0\.5px\]/);
    assert.match(deck, /"mb-10"/);
    assert.match(deck, /<DeckDots variant="home" count=\{5\}/);
    assert.match(dots, /w-\[36\.29px\]/);
    assert.match(dots, /h-\[5\.81px\]/);
    assert.doesNotMatch(feed, /\{friendsSlot && <div className="mb-6">/, "an empty friends slot takes space again");
  });

  it("runs the rule to the window's left edge under the dock, with nothing in between cutting it", () => {
    const css = read("app/globals.css");
    const shell = stripComments(read("components/layout/app-shell.tsx"));
    const houses = stripComments(read("components/layout/join-a-community.tsx"));
    // The rule 647:17210 drew under the deck is GONE: 1305:149185 runs on to
    // the next section on the column's own gap (ogazboiz, 2026-09-12).
    assert.doesNotMatch(deck, /ws-rule-to-left-edge/);
    assert.match(css, /\[data-rail="off"\] \.ws-rule-to-left-edge::before \{[^}]*right: 100%;[^}]*width: 100vw;/, "the extension lies over the rule again, doubling it");
    const mainBase = shell.match(/"[^"]*min-h-\[calc\(var\(--ws-vvh,100dvh\)-var\(--ws-crumb-h\)\)\][^"]*"/)?.[0] ?? "";
    assert.ok(mainBase, "could not find the column's base classes");
    assert.doesNotMatch(mainBase, /overflow-x-clip/, "the column clips again, cutting the rule at its edge");
    assert.match(shell, /min-h-dvh w-full overflow-x-clip bg-chrome/, "nothing clips at the window, so the rule scrolls the page sideways");
    assert.match(houses, /-mr-4 overflow-x-auto/, "the houses rail scrolls within the column");
  });
});

describe("Trending discussions close the right rail", () => {
  it("renders the spotlight and partners first, the discussions last", () => {
    const rail = stripComments(read("components/layout/right-rail.tsx"));
    const order = ["<CitizenSpotlightRail", "<EcosystemPartnersRail", "<TrendingDiscussions"].map((tag) => rail.indexOf(tag));
    assert.ok(order.every((i) => i >= 0), "a rail block is missing");
    assert.deepEqual([...order].sort((a, b) => a - b), order, "trending discussions no longer sit last in the rail");
  });
});

/**
 * HOME'S TIMELINE — 647:16354 in the live file (647:16351, updated 2026-09-10).
 * Its cards are 496:13361 redrawn 1.151x larger, so every value here is the
 * live node's divided by 1.151, the scale the post card is built at.
 */
describe("Home's timeline follows 647:16354", () => {
  const feed = stripComments(read("features/feed/components/feed-page.tsx"));
  const post = stripComments(read("features/feed/components/post-card.tsx"));
  const badge = stripComments(read("components/ui/badge.tsx"));
  const css = read("app/globals.css");

  it("spaces the posts 73 / 1.151 apart", () => {
    assert.match(feed, /className="space-y-4 md:space-y-\[63\.42px\]"/);  });

  it("bottom-aligns the action row and sizes the more disc 44.16 / 1.151", () => {
    assert.match(post, /md:flex-row md:items-end md:gap-6/);
    assert.match(post, /ws-glass-pill flex h-\[38\.37px\] w-\[38\.37px\]/);
  });

  it("rings the card at 0.79 / 1.151", () => {
    assert.match(css, /@utility ws-post \{[^}]*border: 0\.69px solid rgba\(255, 255, 255, 0\.1\);/);
  });

  it("draws no org badge anywhere — the verified seal is the only badge (2026-09-16)", () => {
    // ogazboiz: "only verification badge will have now". MARKET went first,
    // then ARK and the admin picker that assigned them. The schema still
    // parses `orgBadge` so existing payloads load; nothing draws it.
    assert.doesNotMatch(post, /OrgBadgeChip|orgBadge/, "the post header draws an org badge again");
    assert.doesNotMatch(badge, /export function OrgBadgeChip|BadgeArkGlyph|BadgeMarketGlyph/, "the org badge component is back");
    assert.ok(!existsSync(resolve("components/ui/org-badge-glyphs.tsx")), "the lockup artwork is back");
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(resolve(dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
      });
    for (const file of [...walk("components"), ...walk("features"), ...walk("app")]) {
      if (/OrgBadgeChip|BadgePicker|setProfileOrgBadge/.test(stripComments(read(file)))) offenders.push(file);
    }
    assert.deepEqual(offenders, [], "an org badge or its admin picker is drawn again");
  });
});

describe("The verified badge is the supplied seal", () => {
  const badge = stripComments(read("components/ui/badge.tsx"));
  const seal = block(badge, "export function VerifiedBadge(", "\n}\n");

  it("draws the seal on its own gradient and ring, not the old silver check", () => {
    assert.match(seal, /viewBox="0 0 132 131"/);
    assert.match(seal, /stroke="#9E58FF"/);
    for (const stop of ["#A361FF", "#623A99", "#9F5AFF"]) assert.ok(seal.includes(stop), `the seal lost its ${stop} stop`);
    assert.doesNotMatch(seal, /IconCheck|bg-accent/, "the silver check is back");
  });

  it("gives every seal its own gradient id and still gates on verified alone", () => {
    assert.match(seal, /useId\(\)/, "a shared gradient id lets one seal paint the rest");
    assert.match(seal, /if \(verification !== "verified"\) return null;/);
  });
});

describe("A post answers the pointer in its acts' colours", () => {
  const post = stripComments(read("features/feed/components/post-card.tsx"));
  const css = read("app/globals.css");

  it("rings a hovered post in the brand purple", () => {
    assert.match(css, /\.ws-post:hover \{\s*border-color: var\(--color-create\);/);
  });

  it("colours reply blue, repost green and like red on hover, glyph and count together", () => {
    assert.match(css, /--color-reply: #1d9bf0;/);
    assert.match(post, /label="Comments"\s+count=\{post\.commentCount\}\s+hoverClass="group-hover:text-reply"/);
    assert.match(post, /label="Repost or quote"\s+count=\{post\.repostCount\}\s+hoverClass="group-hover:text-up"/);
    assert.match(post, /activeClass="text-like"\s+hoverClass="group-hover:text-like"/);
    assert.match(post, /<span className=\{cn\("tnum text-\[12px\] leading-4 text-white transition-colors", hoverClass\)\}>/, "the count no longer follows the glyph's hover colour");
  });

  it("colours share blue, the Arkmark purple and the more disc purple on hover", () => {
    assert.match(post, /<GlyphAction label="Share" hoverClass="hover:text-reply"/);
    assert.match(post, /hoverClass=\{bookmark\.unavailable \? undefined : "group-hover:text-create"\}/);
    assert.match(post, /!bookmark\.unavailable && "group-hover:text-create"/, "the Arkmark count no longer follows its glyph");
    assert.match(post, /ws-glass-pill flex h-\[38\.37px\] w-\[38\.37px\] items-center justify-center rounded-full text-grey-100 transition-colors hover:text-create/);
  });
});

describe("A friends card can be posted to Square with a caption", () => {
  const popup = stripComments(read("components/layout/friends-popup.tsx"));
  const composer = stripComments(read("features/feed/components/composer.tsx"));

  it("offers Post beside Download and Share, attaching the same card", () => {
    assert.match(popup, /aria-label="Post this card to Square"/);
    assert.match(popup, /await fetch\(cardImage\)/, "the posted picture is not the card Download saves");
    assert.match(popup, /caption: friendsMomentCaption\(moment\)/);
  });

  it("opens the composer with the card attached and the caption written, and posts nothing by itself", () => {
    assert.match(popup, /prefill=\{\{ link: null, label: null, text: draft\.caption \}\}/);
    assert.match(popup, /initialMedia=\{draft\.file\}/);
    assert.match(composer, /useState<Attachment\[\]>\(\(\) => \(initialMedia \? \[attach\(initialMedia\)\] : \[\]\)\)/);
    assert.doesNotMatch(popup, /create\.mutate|useCreatePost/, "the popup posts on its own instead of through the composer");
  });
});

describe("A wink or follow-back notification opens its card", () => {
  const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
  const popup = stripComments(read("components/layout/friends-popup.tsx"));

  it("opens the card from the row, leaving the row's own buttons alone", () => {
    assert.match(page, /friendsMomentFor\(\{ id: item\.id/);
    assert.match(page, /openFriendsCard\(moment\)/);
    assert.match(page, /closest\("button, a"\)\) return;/, "tapping Wink back or the unread dot also opens the card");
  });

  it("is the same popup, opened on demand", () => {
    assert.match(popup, /const request = useFriendsCardRequest\(\);/);
    assert.match(popup, /setFan\(\[request\.moment\]\)/);
  });
});

describe("Your Story works like WhatsApp's My status", () => {
  const rail = stripComments(read("features/feed/components/stories-row.tsx"));
  const creator = stripComments(read("features/feed/components/story-creator.tsx"));
  const count = (re: RegExp) => (rail.match(re) ?? []).length;

  it("plays your stories when you have some, and opens the creator when you don't or you tap +", () => {
    assert.doesNotMatch(rail, /href="\/\?compose=story"/, "Your Story is a link to the inline composer again");
    assert.equal(count(/const mine = groups\.findIndex\(\(group\) => group\.id === me\.data\?\.id\);/g), 2);
    assert.equal(count(/if \(mine >= 0 && !add\) setOpenAt\(mine\);\s*else setCreating\(true\);/g), 2);
    assert.equal(count(/\{creating && <StoryCreator onClose=\{\(\) => setCreating\(false\)\} \/>\}/g), 2);
    assert.equal(count(/if \(i === mine\) return null;/g), 2, "your own stories show twice in the rail");
  });

  it("posts a photo, video or text story through the ordinary upload and create path", () => {
    /* The call is multi-line now that a text story carries `storyStyle`; what
       this is about is that stories go through the ORDINARY create path, not
       how that call is spelled. */
    assert.match(creator, /create\.mutate\(\s*\{\s*kind: "story"/u);
    assert.match(creator, /upload\.mutateAsync\(stage\.file\)/);
    assert.match(creator, /validateUpload\(file, "media"\)/);
    assert.match(creator, /createPortal\(/);
  });
});

describe("The dock follows 964:24177", () => {
  const dock = stripComments(read("components/layout/bottom-dock.tsx"));

  it("carries Home, Pals and Chat, with the node's own glyphs", () => {
    for (const glyph of ["dock-home.svg", "dock-pals.svg", "dock-chat.svg"]) {
      assert.ok(dock.includes(`/notifications/${glyph}`), `${glyph} is not the dock's glyph`);
      assert.ok(existsSync(new URL(`../public/notifications/${glyph}`, import.meta.url)), `${glyph} is missing from public`);
    }
    assert.doesNotMatch(dock, /href: "\/discover"/, "Discover is back in the dock; people are met on Pals now");
  });

  it("is the file's bar and circle at 72/113", () => {
    // The height is a CSS variable — 58 on a phone, the file's 72 from md — and
    // every length is that height over 113, so the whole bar scales as one.
    assert.match(dock, /\[--ws-dock-h:58px\] md:\[--ws-dock-h:72px\]/);
    assert.match(dock, /calc\(var\(--ws-dock-h\) \* \$\{value\} \/ 113\)/);
    assert.match(dock, /style=\{\{ width: px\(286\), gap: px\(21\.6\) \}\}/);
    assert.match(dock, /bg-\[rgba\(20,20,22,0\.47\)\]/);
    assert.match(dock, /inset_0_0_0_1\.2px_rgba\(255,255,255,0\.12\)/);
    assert.match(dock, /<stop stopColor="#7E3BEB" \/>\s*<stop offset="1" stopColor="#C27AFF" \/>/);
    assert.match(dock, /strokeWidth="6\.00677"/);
  });
});


describe("The account dropdown follows 747:14001", () => {
  const shell = stripComments(read("components/layout/app-shell.tsx"));
  const items = block(shell, "function AccountMenuItems(", "\nfunction RailHandle(");

  it("offers Profile and Settings, and every row shuts the menu", () => {
    assert.match(items, /label="Profile"/);
    // By id since QA ("users can change their username"); the settings page redirects to the current username.
    assert.match(items, /go\(me\.data \? profileHref\(me\.data, "settings"\) : "\/auth"\)/, "Settings no longer opens the person's own settings");
    // Removed: the Gender row, its Male/Female sub-step and the Log out row
    // (ogazboiz, 2026-09-22). Gender is still set from Edit profile and
    // onboarding; the phone nav drawer still carries Sign out.
    assert.doesNotMatch(items, /"[Gg]ender"|setStep/, "the gender row or its sub-step is back in the account menu");
    assert.doesNotMatch(items, /Log out/, "Log out is back in the account menu");
    // A row that leaves the menu open leaves it hanging over the page it just
    // navigated to, so every row either calls `go` (which closes) or `close`.
    for (const row of items.split("<MenuRow").slice(1)) {
      assert.match(row, /onClick=\{(?:\(\) => )?(?:go\(|\{\s*close\(\))/, `an account menu row does not close the menu: ${row.slice(0, 120)}`);
    }
  });

  it("hangs in the 264 panel on every account menu", () => {
    // The file's 172 is its 74.46% scale; ogazboiz asked for both menus bigger
    // (2026-09-14) to 231, and QA asked for bigger again (2026-09-15): 264,
    // which is `MenuPanel` exactly. Three menus: the rail, the desktop top
    // bar and — since QA — the phone top bar.
    assert.equal((shell.match(/label="Account"\s+align="(?:above|below)"\s+panel="gist"/g) ?? []).length, 3);
    assert.match(shell, /const width = panel === "gist" \? 264 : panel === "explore" \? 347 : 224;/);
    // The clamp and the style must agree, or the clamp keeps a menu on screen
    // that is wider than the one it measured.
    assert.match(shell, /width: panel === "gist" \? 264 : panel === "explore" \? 347 : 224,/);
    assert.match(shell, /gap-2 rounded-\[11px\] border border-white\/\[0\.18\] bg-grey-800 p-4/);
  });

  it("draws both dropdowns in the design system's one row size", () => {
    // The shrunken `compact` row put an 8.935px label on a 23.83px row. It is
    // gone, so a menu cannot drift back to it without re-adding the variant.
    const filter = stripComments(read("components/layout/friends-filter.tsx"));
    const row = stripComments(read("components/ui/menu-row.tsx"));
    assert.doesNotMatch(row, /compact/);
    assert.doesNotMatch(shell, /size="compact"/);
    assert.doesNotMatch(filter, /size="compact"/);
    assert.match(row, /"h-10 gap-2\.5 rounded-xl px-2\.5 text-\[14px\] leading-5"/);
    assert.match(filter, /w-\[264px\] flex-col gap-2 rounded-\[11px\] border border-white\/\[0\.18\] bg-grey-800 p-4/);
  });
});


describe("Gender is one choice everywhere: Male or Female", () => {
  const places = [
    // Removed: components/layout/app-shell.tsx — the account menu no longer
    // sets gender at all (ogazboiz, 2026-09-22).
    "components/layout/onboarding-flow.tsx",
    "features/profile/components/edit-profile-sheet.tsx",
    "components/layout/friends-filter.tsx",
    "features/discovery/components/people-filters.tsx",
  ];

  it("reads the one list in lib/gender.ts wherever gender is set or filtered", () => {
    for (const path of places) {
      const code = stripComments(read(path));
      assert.match(code, /from "@\/lib\/gender"/, `${path} does not use the shared gender list`);
      assert.match(code, /GENDER_OPTIONS\.map\(/, `${path} draws its own gender options`);
    }
  });

  it("never asks anybody to type a gender", () => {
    const edit = stripComments(read("features/profile/components/edit-profile-sheet.tsx"));
    const explore = stripComments(read("features/discovery/components/people-filters.tsx"));
    const filter = stripComments(read("components/layout/friends-filter.tsx"));
    assert.doesNotMatch(edit, /onChange=\{\(e\) => setGender\(e\.target\.value\)\}/, "Edit profile has a gender text box again");
    assert.doesNotMatch(explore, /placeholder="Gender"/, "Explore has a gender text box again");
    assert.doesNotMatch(filter, /genders\.map/, "the friends filter lists typed spellings again");
  });
});

describe("Each surface asks for its own topics", () => {
  it("asks per surface, the house tag field for composer, and the key carries the surface", () => {
    const api = stripComments(read("features/discovery/lib/api.ts"));
    const hook = stripComments(read("features/discovery/hooks/use-discovery.ts"));
    assert.match(api, /msApi\.get\("\/topics", surface \? \{ surface \} : undefined\)/);
    assert.match(hook, /queryKey: \["ms", "topics", surface \?\? "all"\]/, "one surface's list could be served to another");
    // Home lost its topic row (ogazboiz, 2026-09-12), so it asks for no
    // vocabulary at all; the composer field is the surface-specific caller left.
    assert.doesNotMatch(stripComments(read("components/layout/home-screen.tsx")), /useTopics/);
    assert.match(stripComments(read("components/ui/topic-tags-field.tsx")), /useTopics\("composer"\)/);
  });
});

describe("The profile cover follows 1021:20229", () => {
  const cover = stripComments(read("features/profile/components/profile-cover.tsx"));
  const page = stripComments(read("features/profile/components/profile-page.tsx"));
  const chip = stripComments(read("components/layout/profile-kash-chip.tsx"));

  it("puts the camera button on your own avatar, 12 past its edge and 8 below", () => {
    assert.match(cover, /aria-label="Change profile photo"[\s\S]{0,80}absolute -bottom-2 -right-3 h-8 w-8/);
    assert.match(page, /onChangePhoto=\{isMe \? \(\) => setEditOpen\(true\) : undefined\}/);
    for (const asset of ["camera-button.svg", "icon-share.svg", "kash-chevron.svg"]) {
      assert.ok(existsSync(new URL(`../public/profile/${asset}`, import.meta.url)), `${asset} is missing`);
    }
  });

  it("draws the file's cover at 741 and scales it to the card, actions at the identity row's foot", () => {
    assert.match(cover, /md:items-end md:gap-4/);
    assert.match(cover, /relative block shrink-0 md:self-end/, "the avatar floats off the row's foot when the name wraps");
    assert.match(cover, /md:mb-\[5px\] md:gap-4/, "the actions left the identity row's foot, where the file puts them");
    assert.match(cover, /md:h-\[473px\] md:w-\[741px\] md:origin-top-left/, "the cover is no longer drawn at the file's 741x473");
    assert.match(cover, /Math\.min\(1, el\.clientWidth \/ 741\)/, "the file's cover no longer scales to the card");
    assert.match(page, /h-\[38\.37px\] w-\[38\.37px\][\s\S]{0,160}\/profile\/icon-share\.svg/);
    assert.match(page, /text-\[14\.94px\] leading-\[25\.61px\][^"]*md:w-\[129px\] md:gap-\[10\.1px\]/);
    assert.match(chip, /tracking-\[-0\.05px\]/);
    assert.match(chip, /\/profile\/kash-chevron\.svg/);
  });
});

describe("The profile's bio block follows 1021:20271", () => {
  const page = stripComments(read("features/profile/components/profile-page.tsx"));
  it("sits 40 under the cover, bio and labels at 400, counts in #F7F9F9, place and website 14/20 #A1A1AA", () => {
    assert.match(page, /flex flex-col gap-4 px-4 pt-6 md:px-8 md:pt-10/);
    assert.match(page, /"text-\[15px\] font-normal leading-5 text-white\/50"/);
    assert.equal((page.match(/font-semibold text-\[#F7F9F9\]/g) ?? []).length, 1);
    assert.equal((page.match(/<CountLabel count=\{data\.(followingCount|followerCount)\}/g) ?? []).length, 3);
    assert.match(page, /gap-y-2 text-\[14px\] font-normal leading-5 text-\[#A1A1AA\]/);
  });
});

describe("The profile draws no creator badge", () => {
  it("keeps the verified seal on the cover, and no RoleChip or org badge", () => {
    const cover = stripComments(read("features/profile/components/profile-cover.tsx"));
    assert.doesNotMatch(cover, /RoleChip/, "the creator badge is back on the profile");
    assert.match(cover, /<VerifiedBadge verification=\{profile\.verification\}/);
    assert.doesNotMatch(cover, /OrgBadgeChip/, "the org badge is back on the profile");
  });
});

describe("Pickers offer the types the service publishes", () => {
  it("builds the composer's and the story creator's accept list from the live limits", () => {
    for (const path of ["features/feed/components/composer.tsx", "features/feed/components/story-creator.tsx"]) {
      const code = stripComments(read(path));
      assert.match(code, /accept=\{acceptFor\("media", limits\)\}/, `${path} hard-codes its accepted types again`);
      assert.doesNotMatch(code, /ACCEPT_MEDIA/, `${path} still uses the compiled-in list`);
    }
  });
});

describe("The profile hides the Creator card for now", () => {
  it("does not render CreatorCard on the profile page, and keeps the verification card", () => {
    const page = stripComments(read("features/profile/components/profile-page.tsx"));
    assert.doesNotMatch(page, /<CreatorCard\b/, "the Creator / Open Studio card is back on the profile");
    assert.match(page, /<VerificationCard \/>/);
  });
});

describe("The profile's Photos row is 1021:20930", () => {
  const photos = stripComments(read("features/profile/components/profile-photos.tsx"));
  const api = stripComments(read("features/profile/lib/api.ts"));
  const page = stripComments(read("features/profile/components/profile-page.tsx"));

  it("reads the gallery, stays absent while it is not deployed, and ends your row in Upload more", () => {
    assert.match(api, /msApi\.get\(`\/profiles\/\$\{username\}\/photos`\)/);
    assert.match(api, /msApi\.post\("\/me\/photos", \{ url \}\)/);
    assert.match(photos, /if \(photos\.unavailable \|\| !photos\.data\) return null;/);
    assert.match(photos, /h-40 w-40 shrink-0 overflow-hidden rounded-\[20px\]/);
    assert.match(photos, /shadow-\[0_4px_25px_0_rgba\(107,107,107,0\.25\)\]/);
    assert.match(photos, /"Upload more"/);
    assert.ok(existsSync(new URL("../public/profile/gallery-add.svg", import.meta.url)));
    assert.match(page, /<ProfilePhotos username=\{data\.username\} isMe=\{isMe\} \/>/);
  });
});

describe("The profile's Houses and tabs follow 1021:20292 and 1021:21615", () => {
  const houses = stripComments(read("components/layout/profile-houses.tsx"));
  const tabs = stripComments(read("features/profile/components/account-tabs.tsx"));
  const page = stripComments(read("features/profile/components/profile-page.tsx"));
  const inbox = stripComments(read("features/messages/components/messages-page.tsx"));

  it("puts View All opposite Houses, opening the inbox on Houses", () => {
    assert.match(houses, /href=\{sq\("\/messages\?tab=houses"\)\}[^>]*>\s*View All/);
    assert.match(inbox, /useState<InboxTab>\(tabParam === "houses" \? "houses" : "all"\)/);
  });

  it("leads the strip with Posts on the For you gradient and shows the posts under it", () => {
    assert.match(page, /\{ value: "posts", label: "Posts" \}/);
    assert.match(page, /useState<AccountTab>\("posts"\)/);
    assert.match(page, /accountTab === "posts" && \(\s*<PostsTab/);
    assert.match(tabs, /bg-\[linear-gradient\(226deg,#7E3BEB_22\.4%,#472185_84\.9%\)\] text-grey-100/);
  });
});

describe("Profiles share like posts, and the posts sit off the tab strip", () => {
  it("opens the ProfileShareSheet card modal from the profile and the more menu", () => {
    // The profile shares through the designed card modal (node 1624:21811) now,
    // not the plain target list — the card IS the share, with Download/Share.
    const page = stripComments(read("features/profile/components/profile-page.tsx"));
    const menu = stripComments(read("features/profile/components/person-more-menu.tsx"));
    for (const code of [page, menu]) {
      assert.match(code, /from "@\/components\/ui\/profile-share-sheet"/);
      assert.match(code, /<ProfileShareSheet open onClose=\{[^}]+\} profile=\{[^}]+\} \/>/);
      assert.doesNotMatch(code, /navigator\.share\(/, "the profile shares through the bare device sheet again");
    }
    // The card is server-rendered so the preview and the saved file are one.
    assert.ok(existsSync(new URL("../components/ui/profile-share-sheet.tsx", import.meta.url)));
    assert.ok(existsSync(new URL("../app/api/profile-card/route.tsx", import.meta.url)));
  });

  it("keeps the posts 32 under the strip and 32 in, 24 apart", () => {
    const page = stripComments(read("features/profile/components/profile-page.tsx"));
    assert.match(page, /<ul className="flex flex-col gap-6 px-4 pt-8 md:px-8">/);
  });
});

describe("Profile pictures open full size", () => {
  it("opens the avatar, the cover and gallery photos in the one ImageViewer", () => {
    const cover = stripComments(read("features/profile/components/profile-cover.tsx"));
    const photos = stripComments(read("features/profile/components/profile-photos.tsx"));
    assert.match(cover, /aria-label="View cover photo"/);
    assert.match(cover, /aria-label="View profile picture"/);
    assert.match(cover, /<ImageViewer src=\{viewing\.src\}/);
    assert.match(cover, /pointer-events-none absolute inset-0 md:inset-auto/, "the furniture layer swallows taps on the cover again");
    assert.match(photos, /<ImageViewer src=\{open\}/);
  });
});

describe("Posts carry several photos — node 1029:22591", () => {
  it("rails two or more photos on the card and keeps the single frame for one", () => {
    const card = stripComments(read("features/feed/components/post-card.tsx"));
    assert.match(card, /const rail = postMediaList\(post\);/);
    assert.match(card, /rail\.length > 1 \? \(\s*<MediaRail items=\{rail\} \/>/);
  });

  it("only lets the composer pick several once the server has shown it takes lists", () => {
    const composer = stripComments(read("features/feed/components/composer.tsx"));
    assert.match(composer, /const multi = multiSupported && kind === "update";/);
    assert.match(composer, /multiple=\{multi\}/);
    assert.match(composer, /\.\.\.mediaFields\(attached\)/, "the composer must send media through mediaFields, never both fields");
    assert.doesNotMatch(composer, /mediaUrl,\n/);
    const schemas = stripComments(read("lib/api/schemas.ts"));
    assert.match(schemas, /media: z\.array\(PostMediaSchema\)\.optional\(\),/, "a default on media erases the server's answer");
  });
});


describe("A house can be shared with an invite link", () => {
  it("offers Share invite link to whoever may make one and opens the post share sheet", () => {
    const menu = stripComments(read("features/messages/components/thread-menu.tsx"));
    const thread = stripComments(read("features/messages/components/thread.tsx"));
    assert.match(menu, /\{actions\.onShareInvite && \(/);
    assert.doesNotMatch(menu, /label="Copy link"/, "the thread-address copy is back; nobody outside the house can use it");
    assert.match(thread, /const canShareInvite = group && canMakeInvite\(\{ visibility: conversation\.visibility, manages \}\);/);
    assert.match(thread, /onShareInvite: canShareInvite \? shareInvite : undefined,/);
    assert.match(thread, /<ShareSheet\s+open\s+onClose=\{\(\) => setInviteLink\(null\)\}\s+title="Share invite link"/);
  });

  it("lands the link on /join/<token>", () => {
    const route = read("app/join/[token]/page.tsx");
    assert.match(route, /<JoinPage token=\{decodeURIComponent\(token\)\} \/>/);
    const page = stripComments(read("features/messages/components/join-page.tsx"));
    assert.match(page, /const state = inviteState\(house, authenticated\);/);
  });
});

describe("Column pages sit on the chrome ground", () => {
  it("paints the sticky column header and empty states like the page, not black", () => {
    const css = read("app/globals.css");
    assert.match(css, /@utility ws-head \{\s*background: var\(--color-chrome\);/);
    const states = stripComments(read("components/ui/states.tsx"));
    assert.doesNotMatch(states.slice(states.indexOf("export function EmptyState"), states.indexOf("export function ErrorState")), /ws-inset/);
  });

  it("opens the profile picture on screen, the seeded mascot included", () => {
    const cover = stripComments(read("features/profile/components/profile-cover.tsx"));
    assert.match(cover, /const avatarSrc = profile\.avatarUrl \?\? artworkForSeed\(resolveSeed\(\{ id: profile\.id, name \}\)\);/);
    assert.match(cover, /disabled=\{!avatarSrc\}/);
  });
});

describe("Tapping a post's words opens the post", () => {
  const card = stripComments(read("features/feed/components/post-card.tsx"));

  it("opens /p/:id from the caption, leaving links, buttons and selections alone", () => {
    assert.match(card, /data-post-body/);
    assert.match(card, /onClick=\{full \? undefined : openPost\}/);
    assert.match(card, /target\.closest\("a, button, input, textarea, \[role='button'\]"\)\) return;/);
    assert.match(card, /if \(window\.getSelection\(\)\?\.toString\(\)\) return;/);
    assert.match(card, /router\.push\(sq\(`\/p\/\$\{post\.id\}`\)\);/);
  });

  it("makes the timestamp the post's link everywhere but the post's own page", () => {
    assert.match(card, /<Link href=\{sq\(`\/p\/\$\{post\.id\}`\)\} className="hover:text-white\/80 hover:underline">/);
  });
});

describe("Settings are the reader's own, and show real houses", () => {
  const screen = stripComments(read("components/layout/settings-screen.tsx"));
  const view = stripComments(read("components/layout/notifications-view.tsx"));

  it("sends /u/<someone-else>/settings to the reader's own settings and asks a signed-out visitor to sign in", () => {
    assert.match(screen, /router\.replace\(sq\(`\/u\/\$\{me\.data\.username\}\/settings`\)\);/);
    assert.match(screen, /if \(ready && !authenticated\) \{/);
  });

  it("lists the reader's houses from the inbox query, never invented ones", () => {
    assert.match(view, /const houses = useConversations\("houses"\);/);
    assert.doesNotMatch(view, /DEMO_HOUSES|Ark Gist Partners/);
  });

  it("keeps Upgrade visible and disabled until subscriptions exist", () => {
    assert.match(screen, /<button\s+type="button"\s+disabled\s+title="Subscriptions are coming soon"/);
  });
});

describe("Settings controls never pretend to save", () => {
  it("saves Notifications and Chat through /me/settings, and keeps the later stages disabled", () => {
    const copy = read("components/layout/settings-copy.ts");
    assert.doesNotMatch(copy, /HOUSE_SAVE_LIVE/, 'a house is live from its own query now');
    assert.doesNotMatch(copy, /PRIVACY_SAVE_LIVE/, "privacy is live from the settings payload now");
    const screen = stripComments(read("components/layout/settings-screen.tsx"));
    assert.match(screen, /const stage3 = Boolean\(privacy\);/);
    assert.match(screen, /onPrecisionChange=\{\(value\) => save\.mutate\(\{ privacy: \{ locationPrecision: value \} \}\)\}/);
    assert.match(screen, /onCountryChange=\{\(code\) => updateMe\.mutate\(\{ country: code \}\)\}/);
    assert.match(screen, /onVisibilityOnSpaceChange=\{\(value\) => save\.mutate\(\{ privacy: \{ showListening: value \} \}\)\}/);
    assert.doesNotMatch(screen, /locations you visit/, "the service only uses the place on the profile");
    assert.match(screen, /const settingsLive = settings\.isSuccess;/);
    assert.match(screen, /onFriendsRoomChange=\{\(value\) => save\.mutate\(\{ notifications: \{ friendsRooms: value \} \}\)\}/);
    assert.match(screen, /onMessagesFromChange=\{\(value\) => save\.mutate\(\{ chat: \{ messagesFrom: value \} \}\)\}/);
    assert.match(screen, /onMessagesFromChange=\{\(value\) => saveHouse\.mutate\(\{ messages: value \}\)\}/);
    assert.match(screen, /onGistroomsFromChange=\{\(value\) => saveHouse\.mutate\(\{ rooms: value \}\)\}/);
    assert.match(screen, /disabled=\{!houseSettings\.isSuccess\}/);
    assert.equal((screen.match(/<Toggle\s+disabled=\{(personalizeDisabled|visibilityDisabled)\}/g) ?? []).length, (screen.match(/<Toggle\b/g) ?? []).length);
    for (const file of ["chat-view", "house-notifications-view", "notifications-view"]) {
      const source = read(`components/layout/${file}.tsx`);
      // `row.disabled` is the per-bucket push switch: off while the master
      // switch is, and always for the bucket that cannot be declined.
      assert.equal((source.match(/<Toggle\s+disabled=\{(?:disabled|push\.disabled|emailDigest\.disabled|row\.disabled)\}/g) ?? []).length, (source.match(/<Toggle\b/g) ?? []).length, `${file}: a toggle ignores its disabled state`);
    }
  });

  it("names a chat refused by someone's Messages-from setting in the service's words", () => {
    const envelope = read("lib/api/envelope.ts");
    assert.match(envelope, /case "MESSAGES_RESTRICTED":\s+return err\.message \|\| "This person isn't accepting messages\.";/);
  });
});

describe("Settings sits in Home's column, under the shared header", () => {
  it("fills Home's frame without the right rail: not wide, but full", () => {
    const shell = stripComments(read("components/layout/app-shell.tsx"));
    assert.doesNotMatch(shell.slice(shell.indexOf("function isWide"), shell.indexOf("function isWide") + 400), /settings/);
    assert.ok(shell.includes("/^\\/u\\/[^/]+\\/settings$/,"), "settings is no longer a full route");
    assert.ok(shell.includes("/^\\/messages$/,"), "chat is no longer held to Home's frame");
    assert.doesNotMatch(shell, /const WIDE_EXACT = \[[^\]]*"\/messages"/, "chat spreads to the window's edges again");
    assert.match(shell, /!wide && \(full \? "max-w-\[600px\] lg:max-w-\[971px\] lg:pr-6" : "max-w-\[600px\]"\)/);
    assert.match(shell, /\{!wide && !full && <RightRail \/>\}/);
  });

  it("opens with ColumnHeader, whose back arrow climbs the settings levels", () => {
    const screen = stripComments(read("components/layout/settings-screen.tsx"));
    // Two panes from lg: the list beside the chosen setting, the design's layout.
    assert.match(screen, /lg:w-\[360px\] lg:shrink-0 lg:border-r/);
    // ONE pane until a row is tapped: the list spans the frame, and the second column exists only for a chosen setting.
    assert.match(screen, /active === null \? "w-full" : "hidden lg:block lg:w-\[360px\] lg:shrink-0 lg:border-r lg:border-white\/10"/);
    assert.match(screen, /\{active !== null && \(\s*<div className="min-w-0 flex-1">/);
    assert.doesNotMatch(screen, /Choose a setting to see it here/);
    assert.match(screen, /<PaneHeader title=\{title\} subtitle=\{subtitle\} onBack=\{subLevel \? stepBack : undefined\} \/>/);
    // One pane below lg, where the shared header's arrow walks back up.
    assert.match(screen, /<ColumnHeader title=\{title\} subtitle=\{subtitle\} back onBack=\{stepBack\} \/>/);
    assert.doesNotMatch(screen, /<h1|lg:max-w-\[600px\]|92dvh/, "settings draws its own heading or its own wide layout again");
    const header = stripComments(read("components/layout/column-header.tsx"));
    assert.match(header, /onClick=\{\(\) => \(onBack \? onBack\(\) : canGoBack\(\) \? router\.back\(\) : router\.push\(backFallback\)\)\}/);
  });
});

describe("House roles: owner, admin, member", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));
  const menu = stripComments(read("features/messages/components/thread-menu.tsx"));

  it("reads the reader's role from the roster, not from who made the house", () => {
    assert.match(thread, /const myRole = viewerRole\(members\.data\?\.items, me\.data\?\.id, conversation\.createdBy\);/);
    assert.doesNotMatch(thread, /conversation\.createdBy === me\.data\?\.id/, "ownership is inferred from createdBy again; it goes stale after a handover");
  });

  it("lets owners and admins rename the house, and offers member controls from the roles rules", () => {
    assert.match(thread, /canEdit=\{manages\}/);
    assert.match(menu, /\{\(canEdit \?\? isOwner\) && \(/);
    assert.match(thread, /memberActions\(\{ viewer: myRole, target: member\.role, isSelf: profile\.id === meId \}\)/);
    assert.match(thread, /setConfirming\(\{ kind: "owner", profile \}\)/);
    assert.match(thread, /setConfirming\(\{ kind: "remove", profile \}\)/);
  });
});

describe("A house's notification levels and the house_room notification", () => {
  it("sends the service's own level names, never the old local ones", () => {
    const view = read("components/layout/house-notifications-view.tsx");
    assert.doesNotMatch(view, /"admins"/);
    assert.equal((view.match(/"leaders_and_friends"/g) ?? []).length, 6);
  });

  it("names a gist room opened in a house instead of calling it a follow", () => {
    const types = read("features/notifications/lib/types.ts");
    const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
    assert.match(types, /"house_room",/);
    assert.equal((page.match(/case "house_room":/g) ?? []).length, 2);
  });
});

describe("A person's place respects how much they share", () => {
  it("draws the profile's place line from whichever halves arrived", () => {
    const page = stripComments(read("features/profile/components/profile-page.tsx"));
    assert.match(page, /\{placeLine\(data\)\}/);
    assert.doesNotMatch(page, /\[data\.city, data\.region\]\.filter\(Boolean\)/);
  });

  it("names the house on a gist-room notification when the service can", () => {
    const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
    assert.match(page, /item\.house\?\.title\s+\? `\$\{who\} opened a gist room in \$\{item\.house\.title\}\.`/);
  });
});

describe("Contact us opens a chat with support", () => {
  it("resolves the support account by username and opens a chat with it", () => {
    assert.match(read("lib/support.ts"), /export const SUPPORT_USERNAME = "tsionarksupport";/);
    const screen = stripComments(read("components/layout/settings-screen.tsx"));
    assert.match(screen, /const support = useProfile\(SUPPORT_USERNAME\);/);
    // The PROFILE is passed, not its id: `POST /conversations` answers a bare
    // ref with no peer, so the hook builds the thread from this profile. Passing
    // only the id is what sent a new support chat to the inbox instead of the
    // thread. See
    // lib/open-conversation.
    assert.match(screen, /openChat\.mutate\(support\.data, \{\s*onSuccess: \(conversation\) => router\.push\(sq\(`\/messages\?c=\$\{conversation\.id\}`\)\),/);
    assert.doesNotMatch(screen, /did:privy:/, "the support account's id is hard-coded; it differs per environment");
    // The email is the one the support account publishes in its own bio.
    assert.match(read("lib/support.ts"), /export const SUPPORT_EMAIL = "support@tsionark\.com";/);
    assert.match(screen, /href=\{`mailto:\$\{SUPPORT_EMAIL\}`\}/);
    assert.match(screen, /\{ label: "Contact us", view: "contact" \}/);
    // Push and a daily email summary exist now, so the row names them.
    assert.match(screen, /Customize push, email, and live room activity alerts\./);
    // The policy pages are written, not "Coming soon".
    assert.match(screen, /<LegalDocumentView doc=\{PRIVACY_POLICY\} \/>/);
    assert.match(screen, /<LegalDocumentView doc=\{COMMUNITY_GUIDELINES\} \/>/);
    assert.doesNotMatch(screen, /function HelpSubView/);
  });
});

describe("Square has a favicon and tagged share links", () => {
  it("serves the brand mark as the tab icon and a home-screen icon", () => {
    const icon = read("public/icon.svg");
    assert.match(icon, /viewBox="0 0 60 60"/);
    assert.ok(read("public/apple-icon.png").length > 0);
    // Through asset(), so inside Ark the tab icon is Square's, not WSWS's.
    const layout = stripComments(read("app/layout.tsx"));
    assert.match(layout, /icon: \[\{ url: asset\("\/icon\.svg"\), sizes: "any", type: "image\/svg\+xml" \}\]/);
    assert.match(layout, /apple: \[\{ url: asset\("\/apple-icon\.png"\), sizes: "180x180", type: "image\/png" \}\]/);
    assert.ok(!existsSync(resolve("app/icon.svg")), "the file convention is back and writes an unprefixed icon link");
  });

  it("tags every link the share sheet hands out with one short channel code", () => {
    // Three UTM tags were 62 of a shared post link's 128 characters. The
    // campaign is rebuilt from the landing path, so it no longer travels.
    const sheet = stripComments(read("components/ui/share-sheet.tsx"));
    assert.match(sheet, /withShareChannel\(payload\.url, "native_share"\)/);
    assert.match(sheet, /withShareChannel\(payload\.url, "copy_link"\)/);
    assert.match(sheet, /withShareChannel\(payload\.url, target\)/);
    assert.doesNotMatch(sheet, /withUtm|shareTags|campaign/);
    for (const file of [
      "features/feed/components/post-card.tsx",
      "features/profile/components/profile-page.tsx",
      "features/profile/components/person-more-menu.tsx",
      "features/messages/components/thread.tsx",
      "components/layout/upcoming-room-card.tsx",
    ]) {
      assert.doesNotMatch(read(file), /campaign="/, file);
    }
  });

  it("shares a post by its short id", () => {
    assert.match(
      stripComments(read("features/feed/components/post-card.tsx")),
      /url: `\$\{window\.location\.origin\}\$\{sq\(`\/p\/\$\{sharePostId\(post\.id\)\}`\)\}`/
    );
  });

  it("keeps where a visit came from, then takes the code off the address bar", () => {
    const analytics = stripComments(read("lib/analytics.ts"));
    assert.match(analytics, /const utm = captureVisitUtm\(\);/);
    assert.match(analytics, /readUtm\(window\.location\.search, window\.location\.pathname\)/);
    // `null`: passing history.state (which carries Next's marker) skips the router sync.
    assert.match(analytics, /window\.history\.replaceState\(null, "", clean\)/);
    assert.doesNotMatch(analytics, /replaceState\(window\.history\.state/);
    assert.match(stripComments(read("components/layout/app-shell.tsx")), /captureVisitUtm\(\);/);
  });
});

describe("One app, two addresses: square.tsionark.com untouched, Ark mounts it at /square", () => {
  const config = stripComments(read("next.config.ts"));

  it("keeps every route and file where the standalone site has them", () => {
    assert.ok(!existsSync(resolve("app/square")), "routes moved under app/square again, which changes the standalone site");
    assert.ok(!existsSync(resolve("public/square")), "files moved under public/square again");
    assert.ok(!existsSync(resolve("lib/legacy-routes.ts")), "redirects are back; the standalone site has nothing to redirect");
    assert.doesNotMatch(config, /redirects\(\)/);
  });

  it("rewrites /square onto the real routes only when the base is set", () => {
    assert.match(config, /const base = parseBase\(process\.env\.NEXT_PUBLIC_SQUARE_BASE_PATH\);/);
    assert.match(config, /if \(base === ""\) return \[\];/);
    assert.match(config, /beforeFiles: \[\s*\{ source: base, destination: "\/" \},\s*\{ source: `\$\{base\}\/:path\*`, destination: "\/:path\*" \},/);
    // Multi-Zones: WSWS rewrites /square/:path* here, so scripts, styles, fonts
    // and optimised images must all be requested under /square too.
    assert.match(config, /\.\.\.\(base \? \{ assetPrefix: base \} : \{\}\)/);
    assert.match(config, /\.\.\.\(base \? \{ images: \{ path: `\$\{base\}\/_next\/image` \} \} : \{\}\)/);
    assert.doesNotMatch(config, /withMicrofrontends/);
  });
});

describe("Inside Ark the Square leads back to Ark: a pill on phones, Ark's sections on desktop", () => {
  const shell = stripComments(read("components/layout/app-shell.tsx"));
  const nav = stripComments(read("components/layout/ark-nav.tsx"));

  it("renders only in the build Ark mounts, never on square.tsionark.com", () => {
    assert.match(shell, /\{SHOWS_ARK_NAV && <BackToArk \/>\}/, "the phone pill lost its gate");
    assert.match(shell, /\{SHOWS_ARK_NAV && \(\s*<div className="mr-5 flex h-\[76px\] shrink-0 items-center">\s*<ArkMenu \/>/, "the desktop menu lost its gate");
    assert.match(stripComments(read("lib/ark-links.ts")), /export const SHOWS_ARK_NAV = SQUARE_BASE !== "";/);
  });

  it("uses the mobile app's own pill and wordmark", () => {
    assert.match(nav, /h-\[30px\] shrink-0 items-center gap-1\.5 rounded-full border border-white\/15 px-2\.5/);
    assert.match(nav, /viewBox="0 0 40 8"/);
    assert.match(nav, /aria-label="Back to Ark"/);
  });

  it("leaves by full page loads: the other zone has those routes, this build does not", () => {
    assert.match(nav, /else leaveSquare\(ARK_BACK_FALLBACK\);/);
    assert.match(shell, /leaveSquare\(destination\.href\)/);
    assert.doesNotMatch(nav, /router\.push|<Link/);
  });
});

describe("The mini-player's Close it cannot drop its teardown", () => {
  it("awaits the end through mutateAsync, not a per-call onSuccess that dies with the unmounting chip", () => {
    const player = stripComments(read("components/layout/room-mini-player.tsx"));
    assert.doesNotMatch(player, /endRoom\.mutate\(streamId, \{/, "a per-call onSuccess is back on the host's close");
    assert.match(player, /endRoom\s*\.mutateAsync\(streamId\)\s*\.then\(\(\) => \{/);
  });
});

describe("A host approving a hand on a full stage is told why", () => {
  it("maps STAGE_FULL on approve to the stage copy, not a generic failure", () => {
    const hooks = stripComments(read("features/streams/hooks/use-streams.ts"));
    assert.match(hooks, /if \(action === "approve" && \(error as ApiErrorLike\)\?\.code === "STAGE_FULL"\) \{\s*toast\.error\("Every seat is taken\. Move someone down first\."\);/);
  });
  it("tells an invitee why an unanswered invitation went away", () => {
    const session = stripComments(read("components/layout/room-session.tsx"));
    assert.match(session, /const notice = endedInviteNotice\(heldInviteId\.current, mine\.data\);/);
  });
});

describe("A dropped speaker keeps the seat for the grace window, then joins the audience", () => {
  it("tells the speaker why, once, from the service's removedReason", () => {
    const session = stripComments(read("components/layout/room-session.tsx"));
    assert.match(session, /const notice = seatReleasedNotice\(heldSeat\.current, mine\.data\);/);
  });
  it("shows the host a seated speaker who is absent as reconnecting, counting seated and audience both", () => {
    const tray = stripComments(read("features/houses/components/hand-tray.tsx"));
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(tray, /seatPresence\(item\.userId, connected\) === "reconnecting"/);
    assert.match(room, /new Set\(\[\.\.\.presentIds, \.\.\.slots\.map\(\(slot\) => baseIdentity\(slot\.identity\)\)\]\)/);
  });
});

describe("The host finds a seated speaker's row in the approved read, not the pending queue", () => {
  // GET /streams/:id/speaker-requests answers PENDING only unless asked, so a
  // seat looked for in that list was never there: "Move down" said "Couldn't
  // find their seat." and the hand tray's Seated section was always empty.
  it("moves a speaker down using the approved rows", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /const seated = \(seatedRows\.data\?\.items \?\? \[\]\)\.find\(/, "Move down looks in the pending-only queue again");
  });
  it("draws the tray's Seated section from the approved read", () => {
    const tray = stripComments(read("features/houses/components/hand-tray.tsx"));
    assert.match(tray, /const seatedQuery = useSeatedSpeakers\(stream\.id, stream\.status === "live"\);/);
    assert.match(tray, /const seated = \(seatedQuery\.data\?\.items \?\? \[\]\)\.filter\(\(item\) => item\.status === "approved"\);/);
  });
});

describe("The phone's chat button says when somebody has spoken", () => {
  it("counts from the shared chat poll, against the last message the reader saw", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /const chatFeed = useChat\(stream\.id, here && phone && stream\.status === "live"\);/);
    assert.match(room, /const unreadChat = chatSheet \? 0 : unreadRoomChat\(chatItems, seenChat, me\.data\?\.id\);/);
    assert.match(room, /<RoomPhoneBar\s*unreadChat=\{unreadChat\}/);
  });
  it("draws the badge and speaks the count", () => {
    const bar = stripComments(read("features/houses/components/room-phone-bar.tsx"));
    assert.match(bar, /aria-label=\{roomChatLabel\(unreadChat\)\}/);
    assert.match(bar, /\{roomChatBadge\(unreadChat\) && \(/);
  });
});

describe("An open thread keeps acknowledging what lands in it", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));

  it("re-marks read when a new message arrives, not only on open", () => {
    // Fired once per thread once, so three snaps that landed while the reader
    // was sitting in the conversation stayed unread for ever.
    assert.match(thread, /const seenThrough = `\$\{conversation\.id\}:\$\{conversation\.lastMessageAt \?\? ""\}`;/);
    assert.match(thread, /if \(acknowledged\.current === seenThrough\) return;/);
    // The same pair is acknowledged once, so mark-read cannot loop on itself.
    assert.match(thread, /acknowledged\.current = seenThrough;/);
  });
});

describe("The camera is the second door, and it behaves differently", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));
  const camera = stripComments(read("features/messages/components/camera-sheet.tsx"));

  it("is offered only in a one-to-one, where a snap means something", () => {
    // The camera lives inside the composer's "+" tray now, but it is still a
    // one-to-one-only door — a house shows the file picker alone.
    assert.match(thread, /conversationKind === "direct" && \(\n\s*<button\n[\s\S]{0,240}?setCameraOpen\(true\)/);
    assert.match(thread, /<IconCamera[\s\S]{0,60}?Photo or video/);
  });

  it("marks what it produces as a capture, and arms View once from that", () => {
    assert.match(thread, /defaultViewOnce\(\{ source: "camera", conversationKind, mediaKind: uploaded\.kind \}\)/);
    assert.match(thread, /source: "camera",/);
    // A picked file is NOT armed: it was kept for a reason.
    assert.match(thread, /setAttachment\(\{ result, measured, fileName, previewUrl, source: "upload" \}\)/);
  });

  it("always puts the camera light out", () => {
    // Closed sheet, flipped camera, unmount — every path runs release().
    assert.match(camera, /stream\.current\?\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/);
    assert.match(camera, /return \(\) => \{\n\s*cancelled = true;\n\s*release\(\);/);
    // And a stream that arrived after the sheet closed is stopped too.
    assert.match(camera, /if \(cancelled\) \{\n\s*opened\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/);
  });

  it("uploads a clip as a type the service knows, codecs stripped", () => {
    // `video/webm;codecs=vp9,opus` is stored as a generic file, and the clip
    // arrives in the thread as a .txt row. It shipped exactly once.
    assert.match(camera, /const type = captureContentType\(node\.mimeType\);/);
    assert.match(camera, /captureFileName\("video", Date\.now\(\), type\)/);
  });

  it("refuses to record a clip the service would not accept, before recording it", () => {
    assert.match(camera, /if \(!type\) \{/);
    assert.match(camera, /getUploadLimits\(\)\.videoContentTypes/);
  });
});

describe("A gist room's chat can answer a particular message", () => {
  const panel = stripComments(read("features/streams/components/chat-panel.tsx"));

  it("carries the reply target and the people named, and omits them when there are none", () => {
    const api = stripComments(read("features/streams/lib/api.ts"));
    assert.match(api, /\.\.\.\(replyToId \? \{ replyToId \} : \{\}\)/);
    assert.match(api, /\.\.\.\(mentions && mentions\.length > 0 \? \{ mentions \} : \{\}\)/);
  });

  it("draws the quote only where the service sent one", () => {
    // A chat from before replies existed reads exactly as it did.
    assert.match(panel, /\{message\.replyTo && \(/);
    assert.match(panel, /Message deleted/);
  });

  it("offers the people IN THE ROOM when an @ is typed", () => {
    // The plumbing shipped without the picker, so typing @ did nothing at all.
    // The same hook and picker the DM composer uses, so a mention is one
    // behaviour in this product rather than two that drift.
    assert.match(panel, /const typing = useMentionTyping\(\{/);
    assert.match(panel, /<MentionPicker typing=\{typing\} heading="In this room"/);
    assert.match(panel, /mentionCandidates\(\{ found, members, query \}\)/);
    // And the room hands down who is present — stage and audience.
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /members=\{chatMentionables\}/);
  });

  it("closes the mention list once a name is chosen", () => {
    // The picker renders on the ANCHOR, so clearing only the token left the
    // list open with an empty query — which matches everybody.
    const hook = stripComments(read("hooks/use-mention-typing.ts"));
    assert.match(hook, /setAnchor\(found \? measureField\(\) : null\);/);
    assert.match(hook, /setToken\(null\);\n\s*setAnchor\(null\);/);
    // And a resize never opens one that was not showing.
    assert.match(hook, /const remeasure = \(\) => setAnchor\(token \? measureField\(\) : null\);/);
  });

  it("lets the picker win Enter while it is open", () => {
    // Choosing a name and sending the line are the same key; without this,
    // Enter sends "@pri".
    assert.match(panel, /if \(typing\.token && typing\.items\.length > 0\) \{/);
    assert.match(panel, /typing\.pick\(typing\.items\[0\]!\);/);
  });

  it("lets a phone answer a message by swiping it, like the thread does", () => {
    // The reply control appeared on HOVER, which on a phone is no control at
    // all. The rules come from lib/swipe-reply, shared with the DM thread, so
    // the two surfaces cannot disagree about what counts as a swipe.
    assert.match(panel, /import \{ isReplySwipe, SWIPE_TRIGGER, swipeCommits, swipeOffset \}/);
    assert.match(panel, /if \(swipeCommits\(dx, dy\)\) setReplyTo\(message\);/);
    // Committed on RELEASE: a reply firing under a moving finger is one
    // nobody chose to send.
    assert.match(panel, /const endDrag = \(message: ChatMessage, event: React\.PointerEvent\)/);
  });

  it("draws a reply control as well, for anyone who never finds the gesture", () => {
    assert.match(panel, /onClick=\{\(\) => onReply\(message\)\}/);
  });

  it("loves a single message, with the service's own tally", () => {
    // The count is everybody's, so it comes from the read rather than from
    // adding one to our own copy.
    assert.match(panel, /const love = useChatReaction\(stream\.id\);/);
    assert.match(panel, /love\.mutate\(\{ messageId: target\.id, emoji: DEFAULT_REACTION, loved \}\)/);
    assert.match(panel, /aria-pressed=\{loved\}/);
    // FILLED, not merely tinted: a coloured outline reads as a hover state
    // rather than as an act somebody took.
    assert.match(panel, /filled=\{loved\}/);
    /*
      AND THE EMPTY ONE IS A HOLE, NOT A SECOND SHAPE.

      The heart was two paths — an outer silhouette and an inner "cut" — both
      painted in `currentColor`, so the cut filled the middle straight back in
      and every unloved message carried a SOLID heart. An unloved message that
      looks loved is the one thing this control must never do.

      `fillRule="evenodd"` on a single path is what actually punches the
      middle out, and it is the only way that works here: the chat sits over a
      room, so there is no background colour to paint the inner shape with —
      it is whatever the last person's video happens to be.
    */
    const icons = stripComments(read("components/ui/room-icons.tsx"));
    const heart = icons.slice(icons.indexOf("export function IconRoomHeart"));
    const body = heart.slice(0, heart.indexOf("</svg>"));
    assert.match(body, /fillRule="evenodd"/, "the empty heart must be a hole, or it reads as loved");
    assert.ok(
      !/fillOpacity/.test(body),
      "opacity cannot stand in for an outline — a dimmed solid heart is still a solid heart"
    );
    const api = stripComments(read("features/streams/lib/api.ts"));
    // The emoji is a path segment and an emoji is several bytes.
    assert.match(api, /encodeURIComponent\(emoji\)/);
  });

  it("keeps the quote when the original was removed, without showing its words", () => {
    assert.match(panel, /message\.replyTo\.deleted \? "Message deleted" : message\.replyTo\.text/);
  });

  it("sends only the handles still written in the line", () => {
    // A name picked and then deleted is not a mention.
    assert.match(panel, /typing\.mentionsFor\(text\)/);
  });

  it("keeps the reply target out of the text field, where a backspace would eat it", () => {
    assert.match(panel, /Replying to /);
    assert.match(panel, /aria-label="Cancel reply"/);
  });
});

describe("A shared link posts as a post, and arrives as the thing it points at", () => {
  it("does NOT offer posting back into Square — the reader is already here", () => {
    // Removed 2026-09-28: sharing a post/profile into Square's own feed is
    // redundant inside the Square app. The sheet reaches people who are NOT
    // here (WhatsApp, X, …) plus Copy link; a re-added row fails this.
    const sheet = stripComments(read("components/ui/share-sheet.tsx"));
    assert.doesNotMatch(sheet, /Post to Square/);
    assert.doesNotMatch(sheet, /shareIntoPostText/);
  });

  it("draws one card per post, from the first Square link in its words", () => {
    const card = stripComments(read("features/feed/components/post-card.tsx"));
    assert.match(card, /const shared = firstSquareLink\(post\.text\);/);
    assert.match(card, /\{shared && <SharedLinkCard reference=\{shared\.ref\} href=\{shared\.href\} \/>\}/);
  });

  it("shares a gist room INTO Square, and draws it as the room's own card", () => {
    // "the share link I mean is like posting to Square for gist room".
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /Post to Square/);
    assert.match(room, /"\/\?compose=1&text=" \+ encodeURIComponent\(houseShareUrl\(shareOrigin, stream\.id\)\)/);
    // The SAME card the messages pane draws, so a room shared to the feed and
    // a room announced in a house are not two different objects — and it
    // carries the live state, so a morning post stops offering a closed room.
    const preview = stripComments(read("components/layout/shared-link-card.tsx"));
    assert.match(preview, /<GistRoomCard streamId=\{reference\.id\} fluid \/>/);
  });

  it("removes the card rather than inventing one it could not load", () => {
    const preview = stripComments(read("components/layout/shared-link-card.tsx"));
    // Gone, private, or the request failed: the link stays a link.
    assert.match(preview, /if \(!post\.data\) return null;/);
    assert.match(preview, /if \(!profile\.data\) return null;/);
  });
});

describe("The capture control is named for what it does, and safety is about other people", () => {
  it("says View once, never Streak — a streak is the consequence, not the control", () => {
    const bar = stripComments(read("features/messages/components/media-send-bar.tsx"));
    assert.match(bar, /View once/);
    assert.match(bar, /Keep in chat/);
    // A flame MEANS streak; it belongs where a streak is counted, not on the
    // control that arms one shot.
    assert.doesNotMatch(bar, /streak-flame/);
    const camera = stripComments(read("features/messages/components/camera-sheet.tsx"));
    assert.doesNotMatch(camera, /streak-flame/);
  });

  it("draws the view-once mark in ONE place, and the bubble reads it", () => {
    // The same mark was drawn three times — bubble, camera, composer — which
    // is how two of them end up different.
    const shared = stripComments(read("components/ui/view-once.tsx"));
    assert.match(shared, /export function ViewOnceMark\(/);
    const thread = stripComments(read("features/messages/components/thread.tsx"));
    assert.doesNotMatch(thread, /function SnapMark\(/);
    assert.match(thread, /<ViewOnceMark opened=/);
  });

  it("offers nothing to block, report or mute on the reader's own seat", () => {
    // Tapping yourself in a room offered Block and Report — actions about
    // somebody else, pointed at nobody.
    const sheet = stripComments(read("features/houses/components/person-sheet.tsx"));
    assert.match(sheet, /\{!isSelf &&/);
  });
});

describe("Recovery does not become the next outage", () => {
  it("lets ONE probe through, and shuts the door behind it", () => {
    // `onProbe` used to relabel the state and leave `retryAt` in the past, so
    // every queued request in every tab passed the moment the cooldown lapsed
    // — a fleet-wide burst aimed at a backend seconds into being alive.
    const circuit = stripComments(read("lib/api/circuit.ts"));
    assert.match(circuit, /state: "half-open", retryAt: now \+ options\.cooldownMs/);
  });

  it("decides a 429 on the service's flag, never on a list of its error codes", () => {
    // A wink cooldown and an invite cooldown are both 429s and neither is
    // back-pressure; a client-wide breaker on those would let winking somebody
    // twice degrade the app. The discriminator is one field the service sets —
    // enumerating its codes here is the version that rots silently the first
    // time somebody adds one.
    const circuit = stripComments(read("lib/api/circuit.ts"));
    assert.match(circuit, /status === 429\) return scope === "budget"/);
    assert.doesNotMatch(circuit, /WINK_COOLDOWN|INVITE_COOLDOWN/);
  });

  it("reads a body for the breaker on one status only", () => {
    // Every other failure decides on the number alone. Parsing each one would
    // put a JSON parse on the failing path of every request in the app.
    const client = stripComments(read("lib/api/client.ts"));
    assert.match(client, /if \(response\.status !== 429\) return null;/);
    // And the caller's own body must survive it.
    assert.match(client, /response\.clone\(\)\.json\(\)/);
  });

  it("does not refetch the whole tab when somebody presses Try now", () => {
    // Everybody sees that banner in the same outage and presses it within
    // seconds of each other; `states.tsx` disables thirty per-module retry
    // buttons for exactly this reason.
    const banner = stripComments(read("components/layout/connection-banner.tsx"));
    assert.doesNotMatch(banner, /refetchQueries/);
    assert.match(banner, /retryCircuitNow\(\);/);
  });
});

describe("A DM message can be edited and removed, by its author", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));

  it("offers the actions on the reader's OWN messages and nowhere else", () => {
    // Editing or removing somebody else's words is moderation: it reads
    // differently to everybody in the thread and is a separate feature.
    assert.match(thread, /\{mine && !removed && !invite && \(\n\s*<OwnMessageActions/);
  });

  it("asks before removing, and says the removal is for everyone", () => {
    assert.match(thread, /Remove this message for everyone in this chat\?/);
  });

  it("edits in the composer, not in the bubble", () => {
    // A field inside the river would move the conversation under the reader
    // while they type, and the composer already owns writing a message.
    assert.match(thread, /const \[editing, setEditing\] = useState<Message \| null>\(null\);/);
    assert.match(thread, /Editing your message/);
  });

  it("saves the edit with the same button that sends, and says which", () => {
    // Two buttons that look alike would make the reader work out which one
    // they are looking at every time.
    assert.match(thread, /if \(editing\) \{\n\s*const next = text\.trim\(\);/);
    assert.match(thread, /onSaveEdit\(next\);/);
  });

  it("says a message was edited, always", () => {
    assert.match(thread, /\{message\.editedAt && \(/);
  });

  it("tells the truth when the edit window has passed", () => {
    // "Not allowed" would suggest the message was never theirs.
    const hooks = stripComments(read("features/messages/hooks/use-messages.ts"));
    assert.match(hooks, /EDIT_WINDOW_PASSED/);
    assert.match(hooks, /Too late to edit/);
  });
});

describe("Media that will not load asks for a fresh link", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));

  it("triggers on the FAILURE, not on a deadline that has passed", () => {
    // A signed link can be refused for expiry OR for a signature that no
    // longer verifies, and neither the reader nor an <img> can tell those
    // apart. Firing only past urlExpiresAt left a thread of media broken on
    // screen after a restart rotated the secret under it (2026-09-21).
    assert.match(thread, /function useMediaRefreshOnError\(\)/);
    assert.doesNotMatch(thread, /mediaLinkExpired\(urlExpiresAt/);
  });

  it("asks once per bubble, so twenty broken images are twenty requests and not four hundred", () => {
    assert.match(thread, /if \(asked\.current\) return;\n\s*asked\.current = true;/);
  });

  it("covers a voice note and a clip, not only a photo", () => {
    // A refused link is a play button that does nothing, which reads as a
    // broken feature rather than a broken link.
    assert.match(thread, /onError=\{refreshLink\}/);
    const video = stripComments(read("components/ui/inline-video.tsx"));
    assert.match(video, /onError\?: \(\) => void;/);
  });
});

describe("A snap is seen once, and nothing in the client keeps a copy", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));
  const row = stripComments(read("features/messages/components/conversation-row.tsx"));

  it("draws a snap through its own bubble, before any branch that needs a url", () => {
    // A snap carries a media kind and NO url, so every other branch would read
    // it as a message with no attachment and draw an empty text bubble.
    assert.match(thread, /const snap = snapView\(message, \{ mine \}\);/);
    assert.match(thread, /snap && !removed \? \(\n\s*<SnapBubble/);
  });

  it("holds the opened url in the component and never in the cache", () => {
    assert.match(thread, /const \[showing, setShowing\] = useState<\{\n\s*url: string;/);
    // The hook invalidates; it must not write the response into a query.
    const hooks = stripComments(read("features/messages/hooks/use-messages.ts"));
    assert.match(hooks, /export function useOpenSnap\(conversationId: string\)/);
    assert.doesNotMatch(hooks, /setQueryData\(\["ms", "messages"/);
  });

  it("says which door a snap came through, and only where it was told", () => {
    assert.match(thread, /\{view\.sourceLabel && \(/);
    assert.match(thread, /source: attachment\.source,/);
    // TOP LEVEL on the message, because `media` is null once a snap is spent
    // and a field inside it could not outlive the thing it describes.
    const outgoing = stripComments(read("features/messages/lib/outgoing.ts"));
    assert.match(outgoing, /payload\.mediaSource = "camera";/);
    const types = stripComments(read("features/messages/lib/types.ts"));
    assert.match(types, /mediaSource: z\.enum\(\["camera", "upload"\]\)/);
  });

  it("offers no download for something that is about to be destroyed", () => {
    assert.match(thread, /downloadUrl=\{null\}/);
    // And the PLAYER does not offer one either: Chrome's own control menu
    // carries Download and Picture in Picture, three pixels from the Save we
    // deliberately withheld.
    const viewer = stripComments(read("components/ui/media-viewer.tsx"));
    assert.match(viewer, /controlsList: "nodownload noplaybackrate"/);
    assert.match(viewer, /disablePictureInPicture: true/);
  });

  it("parses a message whose media has no url, which is what a snap is", () => {
    // Required `url` made the send response throw on the first snap ever sent:
    // 201 from the service, "Couldn't send that message" in the composer.
    const types = stripComments(read("features/messages/lib/types.ts"));
    assert.match(types, /url: z\.string\(\)\.nullable\(\)\.optional\(\)\.default\(null\),/);
  });

  it("closes itself when the service deletes the file, rather than showing a dead picture", () => {
    assert.match(thread, /const timer = setTimeout\(\(\) => setShowing\(null\), left\);/);
    assert.match(thread, /const left = snapTimeLeft\(expiresAt, Date\.now\(\)\);/);
  });

  it("only offers View once where the service would accept it", () => {
    assert.match(thread, /const snapOffered = canSendSnap\(\{/);
    assert.match(thread, /\.\.\.\(attachment && snapOffered && asSnap \? \{ viewOnce: true \} : \{\}\)/);
    // Cleared with the attachment: view-once is chosen per photo, never a mode.
    assert.match(thread, /const dropAttachment = useCallback\(\(\) => \{\n\s*setAsSnap\(false\);/);
  });

  it("shows a streak from the first mutual day", () => {
    // Drawn from two once, which meant the day a habit forms showed nothing.
    assert.match(row, /conversation\.snapStreak > 0 && \(/);
  });
});

describe("The inbox says what arrived and whether it has been opened", () => {
  const row = stripComments(read("features/messages/components/conversation-row.tsx"));

  it("gives an attachment a status instead of one paperclip for everything", () => {
    assert.match(row, /const snap = snapStatus\(\{/);
    assert.match(row, /<SnapGlyph status=\{snap\} \/>/);
    assert.doesNotMatch(row, /Shared attachment/, "the same eleven characters for a photo, a clip and a PDF");
  });

  it("keeps text previews, which is the narrower change that was asked for", () => {
    // Snapchat hides message text in its list; people here rely on reading it,
    // and the ask was about uploaded and camera media.
    assert.match(row, /if \(!body && snap\) \{/);
  });

  it("marks it solid until it is opened, and hides the glyph from screen readers", () => {
    assert.match(row, /fill=\{status\.filled \? "currentColor" : "none"\}/);
    assert.match(row, /stroke=\{status\.filled \? "none" : "currentColor"\}/);
    assert.match(row, /aria-hidden/);
  });
});

describe("The friends deck asks about people the reader has not answered for", () => {
  const deck = stripComments(read("components/layout/friends-deck.tsx"));
  const filter = stripComments(read("lib/friends-filter.ts"));

  it("rests on people the reader does not follow, narrowed by the service", () => {
    assert.match(filter, /export const EMPTY_FRIENDS_FILTER: FriendsFilter = \{ city: "", gender: "", newOnly: true \};/);
    assert.match(filter, /\.\.\.\(filter\.newOnly \? \{ excludeFollowing: true \} : \{\}\)/);
  });

  it("drops anyone followed or winked, without trusting a missing edge", () => {
    assert.match(deck, /const items = deckCandidates\(people\.data\?\.pages\.flatMap\(\(page\) => page\.items\) \?\? \[\], \{/);
    assert.match(deck, /hideFollowed: filter\.newOnly,/);
    // The wink hides the card for the cooldown the wink itself lasts — the day
    // the service's `excludeWinked` covers — read against state, never a clock
    // call in the render body.
    assert.match(deck, /winkedHere: \(id\) => answered\.has\(id\) \|\| hasWinked\(winkedHere, id, now\),/);
    assert.match(deck, /const \[now, setNow\] = useState\(\(\) => Date\.now\(\)\);/);
    // EVERY answer closes the card, including the pass the service knows
    // nothing about — and it stays closed rather than lapsing with a cooldown.
    assert.match(deck, /const answered = decidedIds\(useDeckDecisions\(me\.data\?\.id \?\? null\)\);/);
    // The deck's ordering is named once, so switching to the service's ranked
    // `foryou` is one line rather than a hunt through call sites.
    assert.match(deck, /usePeople\("", DECK_SORT, true, friendsFilterFacets\(filter\)\)/);
    const filters = stripComments(read("lib/people-filters.ts"));
    assert.match(filters, /export const PEOPLE_SORTS = \["followers", "recent", "foryou"\] as const;/);
    // The service's ranked ordering, live since #267 deployed: people who
    // winked the reader first, then the ordinary order.
    assert.match(filters, /export const DECK_SORT: PeopleSort = "foryou";/);
    // A pass reaches the SERVICE, or it is only true in this browser.
    assert.match(deck, /pass\.mutate\(\{ profileId: profile\.id, passed: true \}\)/);
    // And every answer is asked of the service, in the query rather than after
    // paging — `excludeWinkedEver`, not the cooldown's `excludeWinked` alone.
    const friends = stripComments(read("lib/friends-filter.ts"));
    assert.match(friends, /excludeWinkedEver: true,/);
    assert.match(friends, /excludePassed: true,/);
    assert.match(deck, /remember\(decision === "follow" \? "followed" : "passed"\);/);
    assert.match(deck, /remember\("passed"\);/);
    assert.match(deck, /remember\("winked"\);/);
    assert.match(deck, /remember\("followed"\);/);
  });

  it("says why the strongest card is at the front", () => {
    // The service leads with people who winked the reader; unsaid, that card
    // looks like every other one and the reader answers a question they did
    // not know they had been asked.
    const card = stripComments(read("components/layout/pal-card.tsx"));
    assert.match(card, /\{profile\.winkedMe && \(/);
    assert.match(card, /Winked you/);
  });

  it("names the wink control's own state once it has been used", () => {
    const card = stripComments(read("components/layout/pal-card.tsx"));
    assert.match(card, /aria-label=\{wink\.winked \? `Already winked at \$\{name\}` : `Wink at \$\{name\}`\}/);
    // Disabled by the hook's refusal, which covers the per-person cooldown a
    // wink and a match both sit inside.
    assert.match(card, /!interactive \|\| wink\.isPending \|\| wink\.unavailable \|\| wink\.refusal !== null/);
  });

  it("carries the file's verdict stamps on Home as well as /pals", () => {
    assert.doesNotMatch(deck, /decide=\{heading === "pals"\}/, "Home's card browses again, with no green or red flag");
    assert.match(deck, /<SwipeVerdict progress=\{swipe\.progress\} verdict=\{swipe\.verdict\} k=\{1\} \/>/);
    assert.match(stripComments(read("components/layout/swipe-verdict.tsx")), /pals\/green-flag\.svg.*pals\/red-flag\.svg/s);
  });

  it("does not reserve a second row for a single community", () => {
    const community = stripComments(read("components/layout/join-a-community.tsx"));
    assert.match(community, /items\.length > 1 \? "grid-rows-2" : "grid-rows-1"/);
  });
});

describe("Web push", () => {
  it("shows a push with Square's icon and only ever opens a page on Square", () => {
    const sw = read("public/sw.js");
    assert.match(sw, /addEventListener\("push"/);
    assert.match(sw, /icon: SQUARE \+ "\/apple-icon\.png"/);
    // The prefix is the worker's own scope: "" standalone, "/square" inside Ark.
    assert.match(sw, /const SQUARE = new URL\(self\.registration\.scope\)\.pathname\.replace\(\/\\\/\$\/, ""\);/);
    assert.doesNotMatch(stripComments(sw), /"\/square/, "a /square path is hard-coded in the worker again");
    assert.match(sw, /if \(target\.origin !== self\.location\.origin\)/);
  });

  it("forgets this browser on sign-out and re-records it on load", () => {
    // Still called on sign-out, now best-effort so a dead session (401) can't
    // block the logout from completing.
    assert.match(stripComments(read("hooks/use-logout.ts")), /await Promise\.resolve\(unsubscribeThisBrowser\(\)\)\.catch/);
    assert.match(stripComments(read("components/layout/app-shell.tsx")), /if \(authenticated\) void refreshPushSubscription\(\);/);
  });

  it("offers the push row in Settings, disabled with its reason", () => {
    const view = stripComments(read("components/layout/notifications-view.tsx"));
    assert.match(view, /checked=\{push\.checked\}/);
    assert.match(view, /\{push\.description\}/);
    assert.match(stripComments(read("components/layout/settings-screen.tsx")), /const push = usePushNotifications\(\);/);
  });
});

describe("The daily email summary", () => {
  it("offers the switch in Settings → Notifications, from the service's own answer", () => {
    const view = stripComments(read("components/layout/notifications-view.tsx"));
    assert.match(view, /checked=\{emailDigest\.checked\}/);
    const screen = stripComments(read("components/layout/settings-screen.tsx"));
    assert.match(screen, /onChange: \(value\) => save\.mutate\(\{ notifications: \{ emailDigest: value \} \}\)/);
  });

  it("unsubscribes only when the button is pressed, never on page load", () => {
    const page = stripComments(read("features/settings/components/unsubscribe-page.tsx"));
    assert.match(page, /onClick=\{\(\) => unsubscribe\.mutate\(token\)\}/);
    assert.doesNotMatch(page, /useEffect/, "a mail link-scanner opening the page would switch summaries off");
    assert.match(read("app/unsubscribe/page.tsx"), /<UnsubscribePage \/>/);
  });

  it("lets the BFF pass exactly that one write through signed out", () => {
    const route = stripComments(read("app/api/market-square/[...path]/route.ts"));
    assert.match(route, /const needsAuth = method === "GET" \? !isPublicGet\(path\) : !\(method === "POST" && isPublicPost\(path\)\);/);
  });
});

describe("Home and the dock after Pals took the stories", () => {
  it("keeps stories off Home and Discover out of the navigation", () => {
    assert.doesNotMatch(stripComments(read("features/feed/components/feed-page.tsx")), /<StoriesRow/);
    assert.doesNotMatch(stripComments(read("components/layout/app-shell.tsx")), /aria-label="Explore"/);
  });
});

describe("A card whose children go full bleed draws its ring on TOP of them", () => {
  /*
    AN INSET BOX-SHADOW IS PAINTED BEFORE CHILD CONTENT.

    CSS paints an element's background and its inset shadows, and only then its
    children. So on a card with a full-bleed absolute child — a cover photo, an
    opaque scrim — the hairline is drawn and then buried, and the card loses the
    edge that separates it from the page. The class is invisible in review: the
    shadow IS in the className, it reads as correct, and nothing about the code
    says it never reaches a pixel.

    Both cards below had it. `ComingSoonCard` has a cover on the left AND a
    scrim at inset-0 that goes solid by 120, so it lost all four edges;
    `UpcomingRoomCard` has an h-40 banner, so it lost the top and the upper
    sides and kept the bottom (ogazboiz, 2026-09-23, on a Home rail where the
    live card and the house card either side of these had their rings).

    The fix is an overlay drawn LAST with the same radius and stroke. The root
    keeps its inset shadow too — it is the honest description of the node's
    INSIDE stroke, and it is what shows wherever no layer covers.
  */
  for (const [path, radius] of [
    ["components/layout/coming-soon-card.tsx", "16px"],
    ["components/layout/upcoming-room-card.tsx", "20px"],
  ] as const) {
    it(`${path.split("/").pop()} redraws its ring above the cover`, () => {
      const card = stripComments(read(path));
      const overlay = new RegExp(
        `pointer-events-none absolute inset-0 rounded-\\[${radius.replace("[", "\\[")}\\] shadow-\\[inset_0_0_0_[\\d.]+px_rgba\\(255,255,255,0\\.18\\)\\]`
      );
      assert.match(card, overlay, "the ring is only on the root, where the cover buries it");
      // ...and it is the LAST thing drawn, or something else covers it again.
      const at = card.search(overlay);
      const banner = card.indexOf("object-cover");
      assert.ok(at > banner, "the ring overlay is drawn before the cover it has to sit on top of");
    });
  }
});

describe("Gist rooms can be scheduled, and upcoming ones look like open ones", () => {
  it("offers Now or Later when opening a room, and refuses a past time", () => {
    const sheet = stripComments(read("features/houses/components/open-house-sheet.tsx"));
    assert.match(sheet, /<RadioPill text="Now" selected=\{!startsLater\}/);
    assert.match(sheet, /<RadioPill text="Later" selected=\{startsLater\}/);
    // The clock is read on submit, never during render (the purity rule).
    assert.match(sheet, /if \(startsLater && !\(Number\.isFinite\(startsAtMs\) && startsAtMs > Date\.now\(\)\)\) \{/);
    assert.doesNotMatch(sheet.slice(0, sheet.indexOf("const submit")), /Date\.now\(\)/, "the clock is read while rendering again");
    assert.match(sheet, /scheduledAt: new Date\(startsAt\)\.toISOString\(\)/);
  });

  it("draws the gist rooms page as 1317:158073: search row, two headings, two three-across grids", () => {
    const street = stripComments(read("features/houses/components/houses-street.tsx"));
    const screen = stripComments(read("components/layout/gist-rooms-screen.tsx"));
    // The artboard's own insets, and the FULL frame it sits in.
    assert.match(street, /pl-\[22px\] pr-\[21px\] pt-\[22px\]/);
    assert.match(stripComments(read("components/layout/app-shell.tsx")), /\/\^\\\/gist-rooms\$\/,/, "/gist-rooms is not a FULL-frame route");
    // Home's search row heads it; no page heading, no topic row, no circle.
    assert.match(screen, /headSlot=\{row\}/);
    assert.match(screen, /const row = <HomeTopRow value=\{query\} onChange=\{setQuery\} \/>;/);
    assert.doesNotMatch(street, /Happening|TopicTabs|tabsSlot|createSlot/);
    assert.doesNotMatch(screen, /TopicTabs|CreateFab/);
    // "Live GistRooms" and "Coming Soon" in the shared heading, WITHOUT View more.
    assert.match(screen, /<SectionHeading id="live-gistrooms" lead="Live" accent="GistRooms" \/>/);
    assert.match(screen, /<SectionHeading id="coming-soon-page" lead="Coming Soon" \/>/);
    // The live grid draws HOME'S OWN LIVE CARD (node 2078:19217), `fluid` so it
    // fills its cell instead of holding the rail's 342 — the same component the
    // Top GistRooms rail draws, because this page and that rail are the same
    // act. It was `GistRoomCard` (1769:3670), which is the card a DM and a
    // shared link draw, where a room is a reference to something mentioned
    // elsewhere rather than a door to walk through.
    // Still never CSS `zoom`: scaling into a 290 cell broke the mic badge's SVG
    // gradient, and an at-most-two-across grid of fluid cards is the answer.
    assert.doesNotMatch(screen, /ROOM_CARD_SCALE|zoom:/, "the card is scaled with CSS zoom again");
    assert.match(street, /aria-label="Gist rooms open now"[\s\S]{0,120}grid grid-cols-1 gap-4 lg:grid-cols-2/);
    assert.match(screen, /roomCardSlot=\{\(stream\) => <LiveRoomCard fluid stream=\{stream\} \/>\}/);
    assert.doesNotMatch(screen, /<GistRoomCard/, "the rooms page and Home's rail draw different cards again");
    // Coming Soon is a GRID here (1317:158179), 59 under the live grid — now at
    // most TWO across, because the cards are the wide horizontal ComingSoonCard.
    assert.match(street, /className=\{liveHouses\.length > 0 \? "mt-\[59px\]" : "mt-9"\}/);
    assert.match(street, /grid grid-cols-1 gap-4 lg:grid-cols-2/);
    assert.doesNotMatch(street, /overflow-x-auto|w-\[479px\]/, "upcoming rooms are a sideways rail again");
    assert.match(screen, /upcomingCardSlot=\{\(stream\) => <ComingSoonCard stream=\{stream\} \/>\}/);
    // `?open=1` still opens the composer on arrival.
    assert.match(street, /if \(openParam !== "1" \|\| autoOpened\.current\) return;/);
  });

  it("draws the houses directory as 1368:2270, where Popular Houses' View more lands", () => {
    const screen = stripComments(read("components/layout/houses-screen.tsx"));
    const row = stripComments(read("components/layout/home-top-row.tsx"));
    // The link, the route, the FULL frame.
    assert.match(stripComments(read("components/layout/popular-houses.tsx")), /action=\{\{ label: "View more", href: sq\("\/houses"\) \}\}/);
    assert.match(read("app/houses/page.tsx"), /<HousesScreen \/>/);
    assert.match(stripComments(read("components/layout/app-shell.tsx")), /\/\^\\\/houses\$\/,/, "/houses is not a FULL-frame route");
    // The artboard's insets; the row ends in the FILTER pill (1368:2275), a
    // real disabled control — the route takes cursor and limit only.
    assert.match(screen, /pl-\[22px\] pr-\[21px\] pt-\[22px\]/);
    assert.match(screen, /<HomeTopRow trailing="filter" value=\{query\} onChange=\{setQuery\} \/>/);
    assert.match(row, /disabled\n\s*aria-label="Filter houses"\n\s*title="Filtering houses needs a filter the directory doesn't offer yet"/);
    assert.match(row, /h-12 w-16 shrink-0 items-center justify-center gap-3 rounded-\[36px\] bg-\[rgba\(159,90,255,0\.09\)\] px-2 py-1/);
    // "Explore communities" (ogazboiz, 2026-09-12) over the file's pasted "Live GistRooms".
    assert.match(screen, /<SectionHeading id="explore-communities" lead="Explore" accent="communities" \/>/);
    assert.doesNotMatch(screen, /Live GistRooms/);
    /*
      ONE CARD FOR BOTH SURFACES. Home's rail and this directory were two
      copies of the same object and they had drifted: Home's was rebuilt at
      legible sizes, this one was left at node 1373:3367's 290 x 86 with a 10px
      title and an 8px Join pill, and only its PHONE variant was ever
      corrected. So the rail looked right and the page its own "View more"
      opens looked like a different product (ogazboiz, 2026-09-23).
      Home's shape survived, because it is the one designed against real
      content. Neither surface draws its own house markup any more.
    */
    assert.match(screen, /<HouseDirectoryCard\n\s*key=\{house\.id\}/);
    /*
      THE TRACK SIZES TO THE CARD, not the other way round. `lg:grid-cols-3`
      cut the row into three whatever the card needed, which at 1440 left each
      cell around 273 against Home's 400 — so the SAME component truncated its
      title to "Entitl…" and wrapped "1 member" onto two lines, and the two
      surfaces looked different again for a new reason (ogazboiz, 2026-09-23).
      `auto-fill` with a 360 floor gives as many columns as actually fit.
    */
    assert.match(screen, /grid-cols-\[repeat\(auto-fill,minmax\(360px,1fr\)\)\]/);
    assert.doesNotMatch(screen, /lg:grid-cols-3/, "a fixed column count is squeezing the card again");

    assert.doesNotMatch(screen, /h-\[86px\]|w-\[290px\]|text-\[8px\] font-semibold/, "the directory went back to its own micro card");
    assert.match(stripComments(read("components/layout/popular-houses.tsx")), /<HouseDirectoryCard/, "Home's rail stopped sharing the card");
    const houseCard = stripComments(read("components/layout/house-directory-card.tsx"));
    assert.match(houseCard, /h-\[80px\] w-\[74px\]/, "the picture shrank back");
    assert.match(houseCard, /text-\[15px\] font-semibold/);
    // The body opens the house; only the pill joins it — held by STRUCTURE
    // now rather than by cancelling an event. See the house-card invariant
    // below for why the anchor could not wrap the button in the first place.
    assert.match(houseCard, /aria-label=\{`View \$\{house\.title \?\? "house"\}`\}/);
    assert.match(houseCard, /className="absolute inset-0 z-10/, "the link must cover the card as an overlay");
    assert.match(screen, /max-lg:grid-cols-1 max-lg:justify-stretch/, "the phone's one column is gone");
    assert.doesNotMatch(screen, /max-lg:text-\[14px\]/, "the legible sizes went back to being phone-only");
    /*
      A HOUSE WITH NO PICTURE GETS THE FILE'S PLATE (1373:3990 — #D8D8D8 with
      the gist glyph), NEVER A SEEDED PERSON and never the node's sample photo
      (ogazboiz, 2026-09-12). Home's card passed imageUrl straight to `Avatar`,
      which falls back to a generated FACE, so a house with no photo wore a
      stranger's — and unifying the two cards on Home's would have carried that
      across. These now guard the shared card, which is where the picture is
      drawn for both surfaces.
    */
    assert.match(houseCard, /!house\.imageUrl && "flex items-center justify-center bg-\[#D8D8D8\]"/, "a house with no picture lost the file's default plate");
    assert.match(houseCard, /src=\{asset\("\/gist-rooms\/card-default-cover\.svg"\)\}[\s\S]{0,200}className="h-6 w-\[32\.78px\]"/, "the default plate lost its glyph");
    assert.doesNotMatch(houseCard, /<Avatar[\s\S]{0,140}src=\{house\.imageUrl\}/, "a house picture is being invented again");
    assert.ok(!existsSync(resolve("public/houses")), "the node's sample photo is back as a default");
    // The same directory Popular Houses reads, followed by cursor; never re-sorted, never "0 members".
    assert.match(screen, /useDiscoverHousesPages\(\)/);
    assert.match(screen, /useInfiniteScroll\(/);
    assert.doesNotMatch(screen, /\.sort\(/);
    // A null count means the payload does not count members, which is a
    // different claim from "none" — so it prints nothing, never "0 members".
    assert.match(houseCard, /house\.memberCount !== null && \(/);
  });

  it("gives the room card 415:12704's hover state, only where the file wires it", () => {
    const card = stripComments(read("components/layout/gist-room-card.tsx"));
    assert.match(card, /preview && "group\/room relative h-\[130px\] overflow-hidden"/);
    assert.match(card, /hidden group-hover\/room:block group-focus-within\/room:block/);
    // The file's numbers: the 16.79/17.16 title, the one 34.5 tile, Speaking Now, unmute, Join.
    assert.match(card, /text-\[16\.79px\] font-semibold leading-\[17\.16px\]/);
    assert.match(card, /left-\[16\.4px\] top-\[70\.4px\] h-\[34\.5px\] w-\[34\.5px\] rounded-\[11\.49px\]/);
    assert.match(card, /speaking-wave\.png/);
    assert.match(card, /left-\[165px\] top-\[85px\] flex h-5 w-\[65px\]/);
    assert.match(card, /left-\[232px\] top-\[85px\] flex h-5 w-\[88px\]/);
    // Home's rail does not opt in.
    assert.doesNotMatch(stripComments(read("components/layout/live-gist-rooms.tsx")), /preview/);
  });

  it("lets unmute LISTEN through the preview grant, and never heartbeats", () => {
    const card = stripComments(read("components/layout/gist-room-card.tsx"));
    const hook = stripComments(read("features/streams/hooks/use-room-preview.ts"));
    const api = stripComments(read("features/streams/lib/api.ts"));
    // POST /streams/:id/preview-token — on the served spec (2026-09-12), optional auth.
    assert.match(api, /msApi\.post\(`\/streams\/\$\{streamId\}\/preview-token`\)/);
    /*
      The allowlist no longer names `preview-token` on its own line: it names
      THREE stream actions, because `playback-token` and `heartbeat` are
      optional-auth in the production spec too and this proxy was refusing both
      — a signed-out visitor could not watch a public room at all.

      Asserted through the PREDICATE rather than by matching the source text.
      The old assertion pinned a particular spelling, so widening the list
      correctly broke a test that had nothing to say about the thing it broke on.
    */
    assert.equal(isPublicPost(["streams", "s1", "preview-token"]), true);
    // THE HARD RULE: a previewing card must not count itself as audience.
    assert.doesNotMatch(hook, /heartbeat|sendHeartbeat/i, "the preview sends heartbeats");
    // Subscribe side only, audio only, registered under its own key, torn down on leave.
    assert.match(hook, /autoSubscribe: true/);
    assert.match(hook, /if \(track\.kind !== Track\.Kind\.Audio\) return;/);
    assert.match(hook, /const key = `\$\{streamId\}#preview`;/);
    assert.match(hook, /RoomEvent\.ActiveSpeakersChanged/);
    assert.match(hook, /export const PREVIEW_BACKOFF_MS = 30_000;/);
    // The card: pressed on, off on mouse leave; refusals quiet the control with the reason.
    assert.match(card, /onMouseLeave=\{preview \? \(\) => setListening\(false\) : undefined\}/);
    assert.match(card, /useRoomPreview\(streamId, preview && listening,/);
    assert.match(card, /disabled=\{previewOff\}/);
    assert.match(card, /title=\{live\.reason \?\? undefined\}/);
    // The caption is the pure rule, fed by viewerCount and the SFU's speaker — no roster guess.
    assert.match(card, /previewCaption\(\{\n\s*connected: live\.state === "listening",\n\s*speaker: live\.speaker,\n\s*listening: room\?\.viewerCount \?\? null,/);
    assert.doesNotMatch(card, />\s*Speaking Now\s*</, "the card claims a speaker it cannot hear");
    // The name resolves the way the house room resolves it.
    assert.match(card, /participantName\(participant\.name\) \?\? parseParticipantMeta\(participant\.metadata\)\?\.username \?\? null/);
  });

  it("shows scheduled rooms on Home, under the friends deck, or not at all", () => {
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    // Order matters: the deck, then what is coming.
    assert.ok(
      feed.indexOf("{friendsSlot}") < feed.indexOf("{comingSoonSlot}"),
      "Coming soon moved above the friends deck"
    );
    const home = stripComments(read("components/layout/home-screen.tsx"));
    assert.match(home, /comingSoonSlot=\{<ComingSoonRooms \/>\}/);
    const soon = stripComments(read("components/layout/coming-soon-rooms.tsx"));
    // Nothing scheduled is no section — never an empty shelf or a spacer.
    assert.match(soon, /if \(items\.length === 0\) return null;/);
    assert.match(soon, /useStreamList\("scheduled"/);
    // The HORIZONTAL card (redesigned at node 2077:19030): its own component,
    // NOT the gist-rooms grid's vertical banner, in a sideways rail at the
    // node's own 342 on a 24 gap — the rail frame 2078:19117 is 1806 wide,
    // which is exactly 5 x 342 + 4 x 24.
    assert.match(soon, /<ComingSoonCard stream=\{room\} \/>/);
    assert.match(soon, /gap-6 overflow-x-auto/);
    // The node's own 342 on desktop, but never more than 95% of the column so
    // a second card always PEEKS in at the edge — on a phone especially, where
    // 100% would fill the column and hide the next one (ogazboiz).
    assert.match(soon, /w-\[342px\] max-w-\[95%\] shrink-0/);
    assert.doesNotMatch(soon, /UpcomingRoomCard/, "Home's Coming Soon fell back to the banner card");
    const soonCard = stripComments(read("components/layout/coming-soon-card.tsx"));
    /*
      106 tall at node 2077:19030, width fills its 342 wrapper. Plus the marks
      of the redesign: the 7px accent still hard on the left edge, the image
      bleeding full-height under the panel that starts 40 in, and the host line
      drawn as TWO runs — the file's per-character overrides flip the name to
      Geist 600 at 10 while the label stays 500 at 8, and the parent style says
      500/8 for the whole string and is wrong.
    */
    assert.match(soonCard, /h-\[106px\] w-full/, "the card lost its fixed height or fluid width");
    assert.match(soonCard, /w-\[7px\] bg-\[#7E3BEB\]/);
    assert.match(soonCard, /w-\[144\.507px\]/, "the cover stopped bleeding under the panel");
    /*
      THE SCRIM RUNS ACROSS, NOT DOWN, and is opaque by 120 — before the
      image's own 144.5 edge — so no cover ever ends against a wall. Built to
      the node instead (a flat panel starting at 40) it is a hard vertical
      line, which is invisible only because the file's sample cover is a dark
      photograph of a trading screen. A real cover is a face in daylight.
    */
    assert.match(soonCard, /linear-gradient\(to right, rgba\(16,16,18,0\) 0px[^"]*#101012 120px\)/);
    assert.doesNotMatch(soonCard, /left-\[40px\]/, "the scrim went back to a wall at x=40");
    /*
      The two columns are a FLEX ROW, not two absolutely placed boxes. The node
      fixes them at 64 and 259, which only holds at its own 342 — and the rail
      caps a card at 95% of its column so a second one peeks, so a narrow
      column brings the card in around 277 and the two absolute columns
      overlap, the schedule sliding under a long title. Invisible until
      somebody writes a real title.
    */
    assert.match(soonCard, /flex h-full items-start gap-\[35px\] pl-\[64px\] pr-\[16px\]/);
    assert.match(soonCard, /mt-\[16px\] flex min-w-0 flex-1 flex-col/, "the text column stopped being the one that gives");
    assert.match(soonCard, /mt-\[15px\] flex shrink-0 flex-col items-end/);
    assert.doesNotMatch(soonCard, /bg-\[#3C3C3C\]/, "the divider is gone in the redesign");
    /*
      Scaled 1.4 from the node at ogazboiz's word (2026-09-23): the file sets
      the title and the host's NAME at 10 and the "Hosted by" label at 8, which
      reads as small type on a card whose job is to sell the room. The file's
      own relationship is kept — title and name equal, label smaller — and the
      two runs stay two runs, because the node's per-character overrides make
      the name heavier and larger than the label it follows.
    */
    assert.match(soonCard, /line-clamp-2 text-\[14px\] font-semibold leading-\[16px\]/);
    assert.match(soonCard, /text-\[11px\] font-medium leading-\[14px\]">\s*Hosted by/);
    assert.match(soonCard, /text-\[14px\] font-semibold leading-\[14px\]/);
    /*
      "Starts in 27h 8m" WRAPPED TO TWO LINES, and the cause was a deviation
      rather than the node: the label is 5px in the file and is drawn at 8, so
      the file's 67-wide right column — which only ever fitted 5px text — was
      too narrow for a real countdown. Anchoring that column by its right inset
      instead of a left offset plus a fixed width lets it grow leftward into
      the slack the node leaves, and keeps the edge the design actually fixes.
    */
    assert.doesNotMatch(soonCard, /w-\[67px\]/, "the right column went back to a width that only fits 5px text");
    assert.match(soonCard, /whitespace-nowrap rounded-full bg-\[rgba\(159,90,255,0\.09\)\]/);
  });

  it("does not drop a host into the soundcheck for a room scheduled for later", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    // Backstage is the moment of OPENING. Scheduling for Saturday must not land
    // the host on a screen whose only action is "open the gist room" (ogazboiz:
    // "when i schedule a gistroom why is it telling me to open gist room").
    assert.match(room, /if \(!opened && !openNow && startsLater\(stream\)\) \{/);
    assert.match(room, /<HostWaiting\s+stream=\{stream\}\s+onOpenNow=/);
    // A room that has not opened is drawn as the product's own upcoming card,
    // NOT as eight dashed chairs — the ring drew eight absences and read as
    // broken (ogazboiz: "it is like a ring so follow our ui").
    assert.match(room, /\{upcomingCardSlot && <div className="px-4 pt-2">\{upcomingCardSlot\(stream\)\}<\/div>\}/);
    // The ring still belongs to the SKELETON, where the room's own shape is
    // the honest thing to hold the space with.
    assert.match(room, /function RoomSkeleton\(\)[\s\S]*?<EmptyRing \/>/);
    assert.match(
      stripComments(read("components/layout/house-room-screen.tsx")),
      /upcomingCardSlot=\{\(stream\) => <UpcomingRoomCard stream=\{stream\} \/>\}/
    );
    // A room with no time on it was opened with "Now" and still goes straight
    // to the soundcheck.
    assert.match(room, /if \(!stream\.scheduledAt\) return false;/);
    // Opening early stays available, but it is not the default.
    assert.match(room, /Open it now instead/);
  });

  it("closes Home with Popular Houses, on the directory that is already ranked", () => {
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    assert.ok(
      feed.indexOf("{comingSoonSlot}") < feed.indexOf("{housesSlot}"),
      "Popular Houses moved above Coming Soon"
    );
    assert.match(stripComments(read("components/layout/home-screen.tsx")), /housesSlot=\{<PopularHouses \/>\}/);
    const houses = stripComments(read("components/layout/popular-houses.tsx"));
    // The endpoint is ALREADY ordered by member count and excludes houses the
    // reader is in, so nothing is re-sorted and no second endpoint was added.
    assert.match(houses, /useDiscoverHouses\(/);
    assert.doesNotMatch(houses, /\.sort\(/, "one loaded page is being re-sorted");
    // Node 1302:148763: capped at 400 (w-100) so a second card peeks, max-w-95%
    // so it fits a narrow column. The card itself is no longer drawn here —
    // it is `HouseDirectoryCard`, the one the directory draws too.
    assert.match(houses, /w-100 max-w-\[95%\] shrink-0/);
    const shared = stripComments(read("components/layout/house-directory-card.tsx"));
    assert.match(shared, /rounded-\[17px\]/);
    assert.match(shared, /bg-\[linear-gradient\(90deg,#9f65fd_0%,#5b05e6_100%\)\]/);
    // Empty or undeployed is ABSENT, never an empty shelf.
    assert.match(houses, /if \(houses\.unavailable \|\| items\.length === 0\) return null;/);
  });

  it("schedules a room with the app's own picker, never the browser's", () => {
    const sheet = stripComments(read("features/houses/components/open-house-sheet.tsx"));
    // The native control paints its own dd/mm/yyyy chrome in the platform's
    // type, which no token in this app can reach.
    assert.doesNotMatch(sheet, /datetime-local/, "the browser's own date control is back");
    assert.match(sheet, /<DateTimeField/);
    // It still emits what the sheet already submits, so submit() is unchanged.
    const field = stripComments(read("components/ui/date-time-field.tsx"));
    assert.match(field, /composeLocal\(/);
    assert.match(field, /role="dialog"/);
    assert.match(field, /disabled=\{past\}/, "past days are selectable");
    // A grid cell stretches to its column: without a square ratio the selected
    // day renders as an oval rather than a disc.
    assert.match(field, /aspect-square/);
  });

  it("spaces every Home section by the shared rhythm, headings flush at x=0", () => {
    // 1305:149185's `itemSpacing` is 64 in the raw node, deliberately tightened
    // to 40 (mb-10) on request — the 64 gap read as too much vertical space
    // between sections. What matters is that EVERY home section shares the ONE
    // rhythm; their heading rows start at x=0, with no 5px inset.
    for (const file of [
      "components/layout/live-gist-rooms.tsx",
      "components/layout/coming-soon-rooms.tsx",
      "components/layout/popular-houses.tsx",
      "components/layout/post-for-you.tsx",
    ]) {
      const section = stripComments(read(file));
      assert.match(section, /mb-10/, `${file} is not on the column's rhythm`);
      assert.match(section, /className="mb-4"/, `${file} lost the 16 under its heading`);
      assert.doesNotMatch(section, /pl-\[5px\]/, `${file} still carries the old 5px inset`);
    }
  });

  it("heads Make some friends with 1305:149175's own type, deck untouched", () => {
    const deck = stripComments(read("components/layout/friends-deck.tsx"));
    // The one heading object, not a fourth copy of the markup.
    assert.match(deck, /<SectionHeading\n\s*id="make-some-friends"/);
    assert.match(deck, /lead="Make some"/);
    assert.match(deck, /accent="friends"/);
    assert.doesNotMatch(deck, /text-\[22px\] font-medium leading-7 text-white/, "the old hand-built heading is back");
    // The filter goes in as the live control it is, keeping ogazboiz's name.
    assert.match(deck, /actionSlot=\{filterPill\}/);
    assert.match(stripComments(read("components/layout/section-heading.tsx")), /actionSlot \?\? \(action && <SectionAction/);
    // The DECK stays 647:16288's: its pills and the left-edge rule were asked
    // for and the new node has nothing to replace them with.
    assert.match(deck, /<DeckDots variant="home" count=\{5\}/);
    // The rule 647:17210 drew under the deck is GONE: 1305:149185 runs on to
    // the next section on the column's own gap (ogazboiz, 2026-09-12).
    assert.doesNotMatch(deck, /ws-rule-to-left-edge/);
  });

  it("puts an announcement in its own band, never in the feed", () => {
    const shell = stripComments(read("components/layout/app-shell.tsx"));
    // Above what the route draws, inside the column — never inside the feed or
    // the Post For You rail, where "why am I seeing this" is unanswerable.
    assert.match(shell, /<AnnouncementBand \/>\n\s*\{children\}/);
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    assert.doesNotMatch(feed, /Announcement/, "an announcement reached the feed");
    const band = stripComments(read("components/layout/announcement-band.tsx"));
    // It never names the operator; on the shared-key path there is no name.
    assert.doesNotMatch(band, /createdBy/, "the band is naming an admin");
    // Trust `post`, never `postId`: the id outlives a post that cannot be shown.
    assert.doesNotMatch(band, /item\.postId/, "the band renders from postId");
    // A signed-out reader gets no close button — dismissal needs somebody.
    assert.match(band, /\{authenticated && \(/);
    const hook = stripComments(read("hooks/use-announcements.ts"));
    // Dismissed rows still arrive; the skipping is ours, so a dismissal on one
    // device holds on another.
    assert.match(hook, /item\.dismissedByMe !== true/);
    assert.match(hook, /Date\.parse\(item\.endsAt\) > now/);
    // (The render-time-clock rule itself is enforced by react-hooks/purity,
    // which is stricter and can tell a lazy initialiser from a render read.)
    // Absent means signed out, so no default may be added.
    assert.match(hook, /dismissedByMe: z\.boolean\(\)\.optional\(\),/);
  });

  it("pins a post without inventing one, and says nothing when it cannot be shown", () => {
    const schemas = stripComments(read("lib/api/schemas.ts"));
    // ABSENT, not null: presence is the test, so a pin that cannot be shown
    // renders nothing rather than "this post is unavailable".
    const pinnedField = schemas.slice(schemas.indexOf("  pinnedPost: z"));
    const outer = pinnedField.slice(0, pinnedField.indexOf(".optional(),") + ".optional(),".length);
    assert.match(outer, /pinnedPost: z\n?\s*\.object\(/);
    assert.match(outer, /\}\)\n\s*\.optional\(\),/, "the pinned post key stopped being optional");
    assert.doesNotMatch(
      outer.slice(outer.indexOf("})")),
      /\.default\(/,
      "an absent pin now defaults, which makes 'cannot be shown' look like 'has one'"
    );
    // The author's placement, not viewer state — it reads the same signed out.
    assert.match(schemas, /pinnedByAuthor: z\.boolean\(\)\.optional\(\)\.default\(false\)/);
    const profile = stripComments(read("features/profile/components/profile-page.tsx"));
    assert.match(profile, /\{pinned && <PinnedPost pinned=\{pinned\} \/>\}/);
    // A summary is NOT a post: it must never be fed to postSlot, which would
    // mean inventing an author, counts and the viewer's own state.
    assert.doesNotMatch(profile, /postSlot\(pinned/);
    const card = stripComments(read("features/feed/components/post-card.tsx"));
    assert.match(card, /\{post\.pinnedByAuthor && \(/);
    // One pin per profile, so pinning clears the previous label immediately.
    const feedHooks = stripComments(read("features/feed/hooks/use-feed.ts"));
    assert.match(feedHooks, /if \(pinned\) clearPinnedEverywhere\(queryClient\);/);
    assert.match(feedHooks, /errorCode\(error\) === "NOT_FOUND"/);
  });

  it("makes every card in the rail one height, on 1313:149186's own numbers", () => {
    // The file's cards are all 367 tall (the fourth is 365.39 at y=1.61, so its
    // bottom still lands at 367) and the row is bottom-aligned. Ours were
    // ragged because each card sized to its own content.
    const rail = stripComments(read("components/layout/post-for-you.tsx"));
    assert.match(rail, /h-\[367px\] w-113\.5 max-w-\[85vw\]/, "the cards size to their content again");
    const card = stripComments(read("features/feed/components/post-card.tsx"));
    assert.match(card, /compact \? "flex h-full flex-col p-3"/, "a compact card no longer fills its box");
    // The compact card is VERTICAL — the media FULL-WIDTH filling the box, the
    // caption clamped under it (node 1313:149187). The old side-tile shrank the
    // media, which is what read as "compressed on mobile".
    assert.match(card, /\{compact \? \(/);
    assert.match(card, /<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">/);
    assert.match(
      card,
      /className="absolute inset-0 h-full w-full object-contain"/,
      "the compact media is contained (whole frame), not cropped"
    );
    assert.match(card, /<MediaRail items=\{rail\} size="compact" \/>/);
    // 1313:152774's tiles, and the column's own geometry untouched beside them.
    const media = stripComments(read("lib/post-media.ts"));
    assert.match(media, /compact: \{\n\s*tile: 134\.3,\n\s*tileHeight: 188\.52,/);
    assert.match(media, /post: \{\n\s*tile: 250\.93,\n\s*tileHeight: 352\.22,/);
    // The caption under the media takes two lines; a text-only card gets ten.
    // It is clamped by class, never `clampLines` — that one brings a "Show more"
    // which expands in place, and the fixed-height card cannot grow.
    assert.match(card, /post\.mediaUrl\s*\?\s*"text-\[13\.8px\] leading-5\.75 line-clamp-2"\s*:\s*"text-\[15px\] leading-6 line-clamp-8"/);
    // A clip's URL in an <img> is a broken tile: a video shows its poster.
    assert.match(stripComments(read("features/feed/components/media-rail.tsx")), /const video = item\.kind === "video" \|\| isVideoUrl\(item\.url\);/);
    assert.match(stripComments(read("features/feed/components/media-rail.tsx")), /src=\{poster\}/);
    const strip = stripComments(read("features/feed/components/media-rail.tsx"));
    assert.match(strip, /size === "compact" && "min-h-0 flex-1"/);
    assert.match(strip, /size === "compact" && "h-full"/);
    // The column's card must NOT be dragged to a fixed height by any of this.
    assert.match(card, /"p-4 md:px-\[39px\] md:pb-4 md:pt-6"/);
  });

  it("shows the rail on Home after the houses, with the timeline on /feed", () => {
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    // Home draws the sections and the rail; the list is `feed` mode only, so
    // one lane is never on screen twice (ogazboiz, 2026-09-12).
    assert.ok(
      feed.indexOf("{housesSlot}") < feed.indexOf('{mode === "home" && postsSlot}'),
      "the rail is not after Popular Houses"
    );
    assert.match(feed, /\{mode === "feed" && \(\n\s*<div ref=\{listRef\}/, "the timeline is not behind feed mode");
    assert.match(stripComments(read("components/layout/home-screen.tsx")), /mode="home"/);
    assert.match(stripComments(read("components/layout/home-screen.tsx")), /postsSlot=\{<PostForYou/);
    // View more opens the page that actually scrolls.
    assert.match(stripComments(read("components/layout/post-for-you.tsx")), /href: sq\("\/feed"\)/);
    // Tapping a rail card — its BODY *or* its image/video — opens the feed with
    // that post pinned first. Without onOpenMedia the card's video is a bare
    // inline player with no tap target, so the clip did nothing (2026-09-28).
    const railSrc = stripComments(read("components/layout/post-for-you.tsx"));
    assert.match(railSrc, /onOpenPost=\{\(post\) => router\.push\(sq\(`\/feed\?post=\$\{post\.id\}`\)\)\}/);
    assert.match(railSrc, /onOpenMedia=\{\(post\) => router\.push\(sq\(`\/feed\?post=\$\{post\.id\}`\)\)\}/);
    // The rail keeps only media / long-text cards, so a page of 30 holds few —
    // it pages forward (bounded) to fill its ten, or it "becomes 1" as short
    // posts crowd the top of the lane on refocus (2026-09-28).
    assert.match(railSrc, /loadedPages < MAX_PAGES/);
    assert.match(railSrc, /void fetchNextPage\(\)/);
    // ONE component, so the composer and the viewer are never a second copy.
    const screen = stripComments(read("components/layout/feed-screen.tsx"));
    assert.match(screen, /<FeedPage\n\s*mode="feed"/);
    assert.match(feed, /<Composer/);
    assert.match(feed, /<VideoViewer/);
    // The pals rail closes Home's column. "Join a community" is GONE from Home
    // (ogazboiz, 2026-09-12: Popular Houses is that list); /feed still
    // interleaves it.
    assert.doesNotMatch(feed, /mode === "home" && communitySlot/, "Join a community is back on Home");
    assert.doesNotMatch(stripComments(read("components/layout/home-screen.tsx")), /JoinACommunity/);
    assert.match(stripComments(read("components/layout/feed-screen.tsx")), /communitySlot=\{<JoinACommunity \/>\}/);
    assert.match(feed, /\{mode === "home" && palsSlot\}/);
    // In feed mode they stay interleaved where the file puts them.
    assert.match(feed, /index === Math\.min\(BEFORE_COMMUNITY - 1/);
    // Pals is back to the deck and the stories strip alone.
    const pals = stripComments(read("components/layout/pals-screen.tsx"));
    assert.doesNotMatch(pals, /PostForYou/, "the rail is still on Pals");
  });

  it("heads every column with a search row that answers in place, and the settings pill", () => {
    const row = stripComments(read("components/layout/home-top-row.tsx"));
    /*
      EVERY PAGE THAT DRAWS THE ROW ANSWERS ITS OWN QUERY.

      It was a link into Explore everywhere but Home, so searching from /pals
      threw the reader off /pals (ogazboiz: "why is the pal search taking me
      to /discovery"). The link branch is gone rather than left unused — dead
      code that sends a reader somewhere else is exactly what caused that.

      The old worry, two live inputs over one string, does not apply across
      PAGES: these surfaces are never on screen together and each keeps its
      own query.
    */
    assert.doesNotMatch(row, /href=(\{sq\()?"\/discover"/, "the row can still throw a reader into Explore");
    assert.match(row, /<input/);
    assert.doesNotMatch(row, /<form/, "a form submits and navigates; this field answers in place");
    for (const screen of [
      "components/layout/pals-screen.tsx",
      "components/layout/houses-screen.tsx",
      "components/layout/gist-rooms-screen.tsx",
    ]) {
      const src = stripComments(read(screen));
      assert.match(src, /<HomeSearch query=\{query\} \/>/, screen + " does not answer its own search");
      assert.match(src, /onChange=\{setQuery\}/, screen + " does not own a query");
    }
    assert.match(row, /Search Gistrooms, houses, friends\.\.\./);
    // The node's leading space is a gap the width of a Geist space, not a
    // character in the copy.
    assert.doesNotMatch(row, /" Search Gistrooms/);
    assert.match(row, /flex h-12 min-w-0 flex-1 items-center gap-\[3\.78px\] rounded-2xl border-\[0\.68px\] border-white\/40 px-2/);
    // The file's type scale is unchanged. What the reader TYPES is white;
    // #7A7A7A is the placeholder, which is what the node actually draws.
    assert.match(row, /text-\[16px\] font-medium leading-\[22px\] tracking-\[-0\.112px\]/);
    assert.match(row, /placeholder:text-\[#7A7A7A\]/);
    assert.match(row, /<IconTopSearch className="h-4 w-4 shrink-0 text-\[#6D6D6D\]" \/>/);
    /*
      A 48 CIRCLE ON THE FIELD'S OWN EDGE, not the file's 67-wide pill.

      Built literally it read badly and the reasons are measurable: a 23 gap
      against a 24 gear (two things separated by the width of one of them), a
      24 gear against a 4px hairline caret, and a glass rim disagreeing with
      the field's crisp hairline 12px away. The caret carried nothing a gear
      does not — the menu appearing is the open state, and aria-expanded says
      so to anybody who cannot see it.
    */
    assert.match(row, /relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-\[0\.68px\]/);
    // The same 0.68 hairline the field uses, so the pair reads as one.
    assert.match(row, /border-white\/40/);
    // A FILTER glyph, not a gear — the pill narrows what the grid shows, and a
    // settings cog beside a search field read as account settings (ogazboiz,
    // 2026-09-28). Same mark the houses filter pill uses, so the two agree.
    assert.match(row, /<IconHomeFilter className=\{cn\("h-5 w-5 shrink-0", open \? "text-\[#9F65FD\]" : "text-\[#D9D9D9\]"\)\} \/>/);
    assert.doesNotMatch(row, /<IconHomeSettings/, "the search pill is a gear again");
    // The control draws no caret of its own any more.
    assert.doesNotMatch(row, /-scale-y-100/, "the settings caret is back");
    // It opens EXPLORE SETTINGS (1317:158022) in RailMenu's own panel — not the
    // account menu any more (ogazboiz, 2026-09-12) — for everyone.
    assert.match(row, /import \{ RailMenu \} from "@\/components\/layout\/app-shell";/);
    assert.doesNotMatch(row, /AccountMenuItems|useAuth/);
    assert.match(row, /panel="explore"/);
    assert.match(row, /<ExploreSettingsMenu close=\{close\} onLocation=\{\(\) => gate\(\(\) => setLocationOpen\(true\)\)\} \/>/);
    assert.match(row, /<LocationSheet open onClose=\{\(\) => setLocationOpen\(false\)\} \/>/);
    // The panel: 1317:158022's own box and rows.
    const shellSrc = stripComments(read("components/layout/app-shell.tsx"));
    assert.match(shellSrc, /panel === "explore" \? 347/);
    assert.match(shellSrc, /rounded-\[22px\] bg-\[#201F1F\] p-4 shadow-\[inset_0_0_0_1px_rgba\(255,255,255,0\.18\)\] backdrop-blur-\[7px\]/);
    const menu = stripComments(read("components/layout/explore-settings-menu.tsx"));
    assert.match(menu, /Explore Settings/);
    assert.match(menu, /h-\[34px\] w-full items-center justify-between rounded-xl bg-white\/\[0\.03\] px-2/);
    assert.match(menu, /height=\{59\}/);
    assert.match(menu, /height=\{62\}/);
    assert.match(menu, /title="Show content in this location"/);
    assert.match(menu, /title="Trends For You"/);
    // "Show content in this location" is the service's `privacy.personalizeByPlace`,
    // read and written through the settings slice's ONE owner, under `privacy`
    // exactly as the settings screen writes it; Trends stays a real disabled
    // control with its reason. The "13"s the render hides are not drawn.
    assert.match(menu, /import \{ useSettings, useUpdateSettings \} from "@\/features\/settings";/);
    assert.match(menu, /const byPlace = settings\.data\?\.privacy\?\.personalizeByPlace;/);
    assert.match(menu, /onChange=\{\(value\) => gate\(\(\) => save\.mutate\(\{ privacy: \{ personalizeByPlace: value \} \}\)\)\}/);
    assert.doesNotMatch(menu, /explore\./, "the preference is being written under a key the service does not have");
    assert.match(menu, /title="Trends For You"\n\s*body=[^\n]*\n\s*checked=\{false\}\n\s*disabledReason=\{MISSING\}/);
    assert.match(menu, /role="checkbox"\n\s*aria-checked=\{checked\}\n\s*aria-label=\{title\}\n\s*disabled=\{disabledReason !== null\}/);
    assert.doesNotMatch(menu, />\s*13\s*</);
    // The glyphs are the file's; the checkbox and caret are the existing exports.
    assert.match(menu, /IconExploreClose|IconExploreLocation|IconExploreTrends/);
    assert.match(menu, /checked \? <IconCheckboxChecked className="h-4 w-4" \/> : <IconCheckbox className="h-4 w-4" \/>/);
    const screen = stripComments(read("components/layout/room-code-screen.tsx"));
    // A private room shows the doorplate and never a join that would refuse.
    assert.match(screen, /This room is private/);
    const privateBranch = screen.slice(screen.indexOf("{shut && ("), screen.indexOf("{!over && !shut && ("));
    assert.doesNotMatch(privateBranch, /housePath/, "a refused join is offered on a private room");
    // An ended room resolves and says so, rather than reading as a typo.
    assert.match(screen, /That room has ended/);
    // One message for unknown AND malformed, so it cannot be used as an oracle.
    assert.match(screen, /That code doesn&apos;t match a room/);
  });

  it("shows a host their room code, grouped for the eye but never re-sent", () => {
    const schemas = stripComments(read("lib/api/schemas.ts"));
    // Null is ordinary — a broadcast, or a room older than codes.
    assert.match(schemas, /roomCode: z\.string\(\)\.nullable\(\)\.optional\(\)\.default\(null\)/);
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    // The visibility rule rides in on the same import (roomCodeVisible).
    assert.match(room, /import \{ groupRoomCode, roomCodeVisible \} from "@\/lib\/room-code";/);
    assert.match(room, /groupRoomCode\(stream\.roomCode\)/);
    // Rendered only when there is one; a room without a code is shared by link.
    assert.match(room, /\{stream\.roomCode && \(/);
    // Nothing rewrites what a person typed on its way to the server — the
    // client and the service must not each hold an opinion about what a code is.
    const codeLib = stripComments(read("lib/room-code.ts"));
    assert.match(codeLib, /export function looksLikeRoomCode/);
    assert.match(codeLib, /export function groupRoomCode/);
  });

  it("lists post_announced BEFORE the service sends it, so it can never read as a follow", () => {
    const types = stripComments(read("features/notifications/lib/types.ts"));
    // .catch("follow") has shipped as a lie three times (tip_received, wink,
    // then four kinds at once). An author whose post is being broadcast must
    // never be told somebody followed them.
    assert.match(types, /"post_announced",/);
    const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
    assert.match(page, /case "post_announced":/g);
    assert.match(page, /Your post is being shown to everyone on Market Square/);
    // No actor by design, so the row must not name one.
    assert.doesNotMatch(page, /\$\{who\} is showing your post/);
    // A glyph, or an actor-less row renders an empty disc.
    assert.match(page, /post_announced: /);
  });

  it("offers Remind me honestly: absent means signed out, never 'not asked'", () => {
    const schemas = stripComments(read("lib/api/schemas.ts"));
    // NO .default(false) — that would collapse "nobody is signed in" into
    // "you have not asked" and render a button that lies on arrival.
    assert.match(schemas, /remindedByMe: z\.boolean\(\)\.optional\(\),/);
    assert.doesNotMatch(schemas, /remindedByMe: z\.boolean\(\)\.optional\(\)\.default/);
    const card = stripComments(read("components/layout/upcoming-room-card.tsx"));
    assert.match(card, /const asked = stream\.remindedByMe === true;/);
    // Signed-out readers are gated into sign-in, not shown a false state.
    assert.match(card, /onClick=\{\(\) => gate\(\(\) => remind\.mutate\(!asked\)\)\}/);
    // A 404 is "not deployed": the control goes, rather than promising a
    // reminder nothing will send.
    assert.match(card, /!remind\.unavailable && \(/);
    const hook = stripComments(read("features/streams/hooks/use-streams.ts"));
    assert.match(hook, /errorCode\(error\) === "NOT_FOUND"/);
    assert.match(hook, /errorCode\(error\) === "CONFLICT"/, "a room already over is not reported");
  });

  it("builds the upcoming card with readable fixed type, not width-scaled to a phone", () => {
    const card = stripComments(read("components/layout/upcoming-room-card.tsx"));
    // It used to reproduce node 1295:140164 by scaling every size to a fraction
    // of its own width (--u = 100cqw/479). In the 356px rail that shrank the
    // date and countdown to ~5px. It is fixed, readable type now — NO width unit
    // anywhere, so the type does not shrink with the column.
    assert.doesNotMatch(card, /100cqw/);
    assert.doesNotMatch(card, /var\(--u\)/);
    assert.doesNotMatch(card, /max-w-\[479px\]/);
    // Readable fixed sizes: the title (over the banner) and the clock.
    assert.match(card, /text-\[15px\] font-semibold/);
    assert.match(card, /text-\[20px\] leading-none font-semibold/);
    // The title is laid over the image behind a legibility scrim.
    assert.match(card, /bg-linear-to-t from-black/);
    // Remind and Share ride the canonical button scale.
    assert.match(card, /ws-btn-sm/);
    // Every glyph is still the file's own export, never a repo icon stand-in.
    for (const glyph of ["card-mark", "card-calendar", "card-share", "card-topic-trading"]) {
      assert.match(card, new RegExp(`/gist-rooms/${glyph}\\.svg`), `${glyph} is not the exported node`);
    }
    // The title is clamped to two lines, never spilling.
    assert.match(card, /line-clamp-2/);
    // It never offers to join a room that has not opened.
    assert.doesNotMatch(card, /Join/);
  });

  it("says when an upcoming room opens, on the card", () => {
    assert.match(stripComments(read("components/layout/gist-room-card.tsx")), /opensAtLabel\(room\.scheduledAt\)/);
  });

  it("never lets somebody else's URL become an href or a new window unchecked", () => {
    // Both destinations are written by another person — an admin's
    // announcement link, a publisher's store listing — and `javascript:` in
    // either one runs on THIS origin, under our name, at the moment the
    // reader presses the thing. `isHttpUrl` is the single gate, and these
    // pin it to the sink rather than to a schema that can be relaxed later.
    const band = stripComments(read("components/layout/announcement-band.tsx"));
    assert.match(band, /isHttpUrl\(item\.linkUrl\)/, "the announcement link is unvalidated");
    const store = stripComments(read("features/store/components/store-item-page.tsx"));
    assert.match(store, /const openable = isHttpUrl\(item\.actionUrl\)/, "the store link is unvalidated");
    assert.doesNotMatch(store, /item\.actionUrl\.length > 0/, "a length check is not a scheme check");
  });

  it("lets an operator publish an announcement, and take it down", () => {
    const page = stripComments(read("features/admin/components/admin-page.tsx"));
    const section = stripComments(read("features/admin/components/admin-sections.tsx"));
    const api = stripComments(read("features/admin/lib/api.ts"));
    // The band could be READ long before anything could write one — the
    // console had no way to make an announcement at all.
    assert.match(page, /\{ value: "announcements", label: "Announcements" \}/);
    assert.match(page, /\{tab === "announcements" && <AnnouncementsSection \/>\}/);
    assert.match(api, /msApi\.post<unknown>\("\/admin\/announcements"/);
    assert.match(api, /"\/admin\/announcements\/" \+ id \+ "\/end"/);
    // EVERY ANNOUNCEMENT ENDS: the service requires it and the form does too,
    // rather than defaulting to an end nobody chose.
    assert.match(section, /"Choose when it ends"/);
    assert.match(section, /"The end has to be in the future"/);
    // An empty link would be a band that looks tappable and goes nowhere.
    assert.match(api, /\.\.\.\(input\.linkUrl \? \{ linkUrl: input\.linkUrl \} : \{\}\)/);
    // The console reads the SAME object the band renders — one shape, so an
    // operator's own console cannot disagree with what everybody else got.
    assert.match(
      stripComments(read("features/admin/lib/types.ts")),
      /items: z\.array\(AnnouncementSchema\)/
    );
    // The clock is ticked state, never read during render.
    assert.doesNotMatch(section, /endsAtMs <= Date\.now\(\)\n\s*\? "The end/);
  });

  it("never prints a profile id where a handle goes", () => {
    // `username` is a ROUTING key — it is in /u/{username} and in the
    // service's own paths — so the schema falls back to the profile id when
    // nobody has claimed one, and LINKS keep resolving. That fallback is
    // right for links and wrong for text: it printed forty characters of
    // Privy DID as if somebody could type it.
    const roots = ["features", "components"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = dir + "/" + entry.name;
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) {
          const src = fs.readFileSync(p, "utf8");
          // `@{x.username}` printed straight into JSX.
          if (/@\{[A-Za-z.?]*username\}/.test(src)) offenders.push(p);
        }
      }
    };
    for (const r of roots) walk(r);
    // The ONE legitimate case: the edit sheet's "you are currently @x" line,
    // which renders inside the CLAIMED branch and so always has a real name.
    const allowed = ["features/profile/components/edit-profile-sheet.tsx"];
    const unexpected = offenders.filter((p) => !allowed.includes(p));
    assert.deepEqual(unexpected, [], "a raw username is printed without atHandle: " + unexpected.join(", "));
  });

  it("builds the phone top bar as node 1285:94852, with no search in it", () => {
    const shell = stripComments(read("components/layout/app-shell.tsx"));
    // 72 = 16 + the node's 40 row + 16. It was 48 with the account on the
    // LEFT and the mark floated to the middle; the node puts the lockup left
    // and the account right, so the phone finally agrees with the desktop bar.
    assert.match(shell, /fixed inset-x-0 top-0 z-40 flex h-\[var\(--ws-topbar-h\)\] items-center justify-between border-b border-white\/10 px-6 pt-\[env\(safe-area-inset-top,0px\)\] md:hidden/);
    assert.match(read("app/globals.css"), /--ws-topbar-h: calc\(env\(safe-area-inset-top, 0px\) \+ 56px\);/);
    // The node's own 100 x 40 lockup box — WITHOUT the node's 0.53 hairline
    // under it (ogazboiz, 2026-09-16): on a phone it read as a stray short
    // line under the logo. The bar's full-width border-b above is the only one.
    // The box HUGS. The node fixes it at 100, but that is 100 at the FILE's
    // type; ours renders wider, and a fixed width narrower than its content is
    // exactly what wrapped the word under the mark. The lockup carries the
    // `flex` too, because BrandLockup renders bare inline content by design
    // and inline content wraps.
    assert.match(shell, /<span className="flex h-10 shrink-0 items-center gap-3">/);
    assert.doesNotMatch(shell, /border-b-\[0\.53px\]/, "the short hairline under the phone lockup came back");
    assert.match(shell, /<BrandLockup markHeight=\{24\} label="Square" className="flex" \/>/);
    // THE SEARCH GLYPH THE NODE DRAWS IS DELIBERATELY ABSENT (ogazboiz: "use
    // the header that they gave us but hide the search bar"), which also
    // keeps search out of the chrome. Every column already has its own row.
    assert.doesNotMatch(shell, /IconTopSearch/, "search came back into the chrome");
    // The avatar MOVED SIDES but is still the door: the dock's sidebar
    // control is md:grid, so on a phone this is the only way into the drawer.
    assert.match(shell, /aria-label="Open menu"/);
  });

  it("lets a phone reply by swiping, not only by knowing a trick", () => {
    const thread = stripComments(read("features/messages/components/thread.tsx"));
    // The reply disc is hidden on touch, so before this the only way to reply
    // from a phone was a 450ms hold on a control you could not see.
    assert.match(thread, /swipeCommits\(dx, dy\)/);
    assert.match(thread, /onReply\(message\)/);
    // Committed on RELEASE. A reply firing under a moving finger is one
    // nobody chose to send.
    assert.match(thread, /const endDrag = /);
    assert.doesNotMatch(thread, /moveDrag[\s\S]{0,200}onReply\(/, "a reply fires mid-drag");
    // The thread's main gesture is scrolling: vertical stays the browser's.
    assert.match(thread, /touch-pan-y/);
    // The long-press path is not replaced — both reach the same action.
    assert.match(thread, /startPress\(event\);/);
  });

  it("never lets iOS zoom the page when somebody taps a field", () => {
    const css = read("app/globals.css");
    // Safari zooms any field whose computed size is under 16px and leaves the
    // reader zoomed in and scrolled sideways. The trigger is the COMPUTED
    // size, so fixing it field by field misses every one that inherits.
    assert.match(css, /@media \(pointer: coarse\)/);
    assert.match(css, /font-size: 16px;/);
    // Not by forbidding pinch-zoom, which takes an accessibility affordance
    // from everybody to spare us a layout problem.
    assert.doesNotMatch(read("app/layout.tsx"), /maximum-scale|user-scalable/);
  });

  it("lets a group be edited after it is created, visibility included", () => {
    const sheet = stripComments(read("features/messages/components/group-settings-sheet.tsx"));
    const menu = stripComments(read("features/messages/components/thread-menu.tsx"));
    // Creating a group asks for a name, description, picture and visibility.
    // All four are editable afterwards, in one place, or the create form is
    // asking questions the product can never revisit.
    assert.match(menu, /label="Group settings"/);
    assert.match(sheet, /useUpdateGroup\(conversation\.id\)/);
    // VISIBILITY IS OWNER-ONLY — an admin may edit the rest and gets a 403
    // here, so the control is gated on the ROLE, never on "can edit".
    assert.match(sheet, /conversation\.viewerRole === "owner"/);
    assert.match(sheet, /disabled=\{!isOwner\}/);
    // Public carries BOTH promises: listed where people browse, and joinable.
    // The older, weaker wording understated what actually happens.
    assert.match(sheet, /Anyone can find this group and join it/);
    assert.doesNotMatch(sheet, /Anyone with the link can join/);
    // Private is not "nobody gets in" — an invite link never consulted
    // visibility, and going private does not revoke the ones already sent.
    assert.match(sheet, /already have an invite link/);
    // Only what changed is sent: an absent field is left alone, so saving a
    // name must not carry a description nobody touched.
    assert.match(sheet, /const changed = Object\.keys\(edit\)\.length > 0;/);
  });

  it("does not answer the same question twice on /pals", () => {
    const screen = stripComments(read("components/layout/pals-screen.tsx"));
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    // The FEED is scoped to mutual follows server-side, so a client-side
    // "Your pals" list above it was answering a question the page already
    // answered one section further down.
    assert.match(feed, /mode === "pals" \? "pals" : "for-you"/);
    assert.doesNotMatch(screen, /<YourPals/, "the duplicate pals list is back");
    // What stays is the part a timeline structurally cannot say.
    assert.match(screen, /<PalsInRooms \/>/);
  });

  it("leads Pals with who is in a room, and renders nothing when nobody is", () => {
    const rail = stripComments(read("components/layout/pals-in-rooms.tsx"));
    const pals = stripComments(read("components/layout/pals-screen.tsx"));
    // The one thing a people page can say that a timeline cannot.
    assert.match(rail, /useFollowingRooms\(\)/);
    assert.match(pals, /<PalsInRooms \/>/);
    // THE EMPTY STATE IS NO RAIL. A card announcing that nobody is around
    // advertises a dead product, and on a young graph this is the common case.
    // Not-deployed, signed-out, loading and genuinely-empty all render alike.
    assert.match(rail, /if \(rooms\.unavailable \|\| rooms\.isPending \|\| rooms\.isError\) return null;/);
    assert.match(rail, /if \(items\.length === 0\) return null;/);
    assert.doesNotMatch(rail, /EmptyState|nobody|No one|Nothing here/i, "the rail grew an empty state");
    // An absent viewer count is never drawn as a fabricated zero.
    assert.match(rail, /room\.viewerCount !== null/);
    assert.doesNotMatch(rail, /peakViewers/, "a peak is not a live audience");
  });

  it("puts the partners card under Coming Soon, on phones only", () => {
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    const home = stripComments(read("components/layout/home-screen.tsx"));
    assert.match(home, /partnersSlot=\{<EcosystemPartnersRail heading=\{false\} \/>\}/);
    // No title on the phone: in the column the card speaks for itself, and a
    // second heading there reads as another section of ours. The rail keeps
    // its title, where it names one module among several.
    const partnersCard = stripComments(read("components/layout/ecosystem-partners-rail.tsx"));
    assert.match(partnersCard, /\{heading && \(/);
    assert.match(partnersCard, /aria-label="Ecosystem Partners"/, "the label must survive for screen readers");
    // Under Coming Soon, above Popular Houses.
    const soon = feed.indexOf("{comingSoonSlot}");
    const partners = feed.indexOf("{mode === \"home\" && partnersSlot");
    const houses = feed.indexOf("{housesSlot}");
    assert.ok(soon > 0 && partners > soon && houses > partners, "the partners card moved out of place");
    // The rail already carries it from lg up; two on one screen is not a
    // placement, so the column's copy is phones only.
    assert.match(feed, /className="mb-10 lg:hidden">\{partnersSlot\}/);
    assert.match(stripComments(read("components/layout/right-rail.tsx")), /<EcosystemPartnersRail \/>/);
  });

  it("answers Home's search on Home, room codes included", () => {
    const home = stripComments(read("components/layout/home-screen.tsx"));
    const feed = stripComments(read("features/feed/components/feed-page.tsx"));
    const search = stripComments(read("components/layout/home-search.tsx"));
    // The query is answered here, and while it is open the sections give way
    // to the results rather than sitting above them.
    assert.match(home, /searchSlot=\{searching \? <HomeSearch query=\{query\} \/> : undefined\}/);
    assert.match(feed, /\{searchSlot \?\? \(/, "results no longer replace Home's sections");
    // Everything, in one list — that was the ask, so the type is not narrowed.
    assert.match(search, /useDiscovery\(trimmed, "all"\)/);
    // A spoken code names exactly one room, so it is OFFERED first and never
    // followed automatically — a well-formed typo would move the reader.
    assert.match(search, /looksLikeRoomCode\(trimmed\)/);
    assert.match(search, /href=\{sq\(`\/code\/\$\{code\}`\)\}/);
    // A person is the same row here as everywhere else, never a second style.
    assert.match(search, /<PersonRow key=\{item\.id\} profile=\{item\.profile\} \/>/);
  });

  it("draws no chip for a role nearly every author has", () => {
    // A badge everyone wears distinguishes nobody. Creator sat on almost
    // every author line, so it is mapped to null exactly as citizen is —
    // the ROLE still exists and still arrives, it just has no chip.
    const badge = stripComments(read("components/ui/badge.tsx"));
    assert.match(badge, /creator: null/);
    assert.doesNotMatch(badge, /creator: "Creator"/);
  });

  it("keeps the wink card's photo off our own network", () => {
    // That URL is FETCHED server-side, so its host is an SSRF target and a
    // scheme check alone is not enough — a private address serves https too.
    const wink = stripComments(read("lib/wink-card.ts"));
    assert.match(wink, /isPrivateHost\(url\.hostname\)/, "safePhoto no longer blocks private hosts");
  });
});


describe("the spoken room code is copyable and reaches the host while live", () => {
  const copyRow = stripComments(read("features/houses/components/copy-row.tsx"));
  const houseRoom = stripComments(read("features/houses/components/house-room.tsx"));

  it("copies the BARE code, never the grouped one", () => {
    // `lib/room-code.ts` is explicit that grouping is "display only; never
    // sent back" — the service matches unseparated. Copying `bcd-fghj-km`
    // would put a string in the clipboard that fails in the join field, which
    // is worse than showing no code at all because it looks like it worked.
    assert.match(copyRow, /writeText\(code\)/);
    assert.doesNotMatch(copyRow, /writeText\(groupRoomCode/);
    // And it still DISPLAYS the grouped form, which is the whole point of
    // having two strings.
    assert.match(copyRow, /\{groupRoomCode\(code\)\}/);
  });

  it("reaches the live room, not only the screen before it opens", () => {
    // The defect: the code rendered on exactly one screen, the host's waiting
    // screen, so it disappeared at the moment a host reads it down a phone.
    // The share sheet lives in the live room, so a reference there is the
    // proof that a live host can still find it.
    assert.match(houseRoom, /<CopyCodeRow/);
    // One rule for the sheet, the header line and the waiting screen: the host
    // always, everyone in a public room (ogazboiz, 2026-09-15).
    assert.equal((houseRoom.match(/roomCodeVisible\(stream, isHost\) && stream\.roomCode && \(/g) ?? []).length, 2);
    assert.match(houseRoom, /roomCodeVisible\(stream, false\) && stream\.roomCode && \(/);
    assert.doesNotMatch(houseRoom, /isHost && stream\.roomCode/);
  });

  it("says nothing at all when a room has no code", () => {
    // A broadcast is never given one, and neither is a room made before codes
    // shipped. Null is ordinary, so it must be guarded rather than rendered as
    // an empty or placeholder code.
    assert.match(houseRoom, /stream\.roomCode && \(/);
  });
});

describe("a profile's counts open X-style follow lists", () => {
  const page = stripComments(read("features/profile/components/profile-page.tsx"));
  const list = stripComments(read("features/profile/components/follow-list-page.tsx"));

  it("links each count to its own list", () => {
    // Plain text before: two numbers with no way to see the people behind them.
    assert.match(page, /href=\{profileHref\(data, "following"\)\}/);
    assert.match(page, /href=\{profileHref\(data, "followers"\)\}/);
  });

  it("keeps who you follow private: only your own profile links or lists it", () => {
    // "people should not be able to see the people you are following"
    assert.match(page, /\{isMe \? \(\s*<Link\s+href=\{profileHref\(data, "following"\)\}/, "another person's Following count links to their list again");
    assert.match(list, /useFollowingList\(tab === "following" && isMe \? id : undefined\)/, "the list is requested for somebody else's profile");
    assert.match(list, /\.\.\.\(isMe \? \[\{ value: "following" as FollowListTab, label: "Following" \}\] : \[\]\)/, "the Following tab shows on somebody else's profile");
    assert.match(list, /tab === "following" && profile\.isSuccess && readerKnown && !isMe/);
    assert.match(list, /title="Following is private"/);
  });

  it("has a route for each list", () => {
    for (const tab of ["followers", "following"]) {
      const route = read(`app/u/[username]/${tab}/page.tsx`);
      assert.match(route, new RegExp(`<FollowListPage username=\\{username\\} tab="${tab}" />`));
    }
  });

  it("lists people with the one PersonRow, paged by BrowseList", () => {
    // A second row for people is how two follow controls with two behaviours ship.
    assert.match(list, /<PersonRow key=\{person\.id\} profile=\{person\} \/>/);
    assert.match(list, /<BrowseList/);
  });

  it("switches tabs in place, so Back leaves the page in one step", () => {
    assert.match(list, /router\.replace\(sq\(`\/u\/\$\{handle\}\/\$\{next\}`\)/);
    assert.doesNotMatch(list, /router\.push\(/);
  });

  it("never re-sorts a page client-side", () => {
    // Re-sorting reorders rows already on screen as later pages arrive. The
    // order is the service's to fix.
    assert.doesNotMatch(list, /\.sort\(/);
  });
});


describe("link previews publish only what they should, where they should", () => {
  it("fetches post and profile data only on the two routes built for it", () => {
    for (const file of ["app/p/[id]/page.tsx", "app/u/[username]/page.tsx"]) {
      const route = stripComments(read(file));
      assert.match(route, /export async function generateMetadata/, file);
      // Bots and browsers render differently, so one cached response is wrong.
      assert.match(route, /export const dynamic = "force-dynamic";/, file);
      // Next already decoded the param; a second decode reopens traversal.
      assert.doesNotMatch(route, /decodeURIComponent/, file);
    }
    const post = stripComments(read("app/p/[id]/page.tsx"));
    assert.match(post, /const post = resolvePostParam\(id, \{ fixtureIds: FIXTURE_MODE \}\);\n\s*if \(!post\) notFound\(\);/);
    // Fixture ids only when there is no upstream at all.
    assert.match(post, /const FIXTURE_MODE = marketSquareBase\(\) === null;/);
    assert.match(post, /<PostScreen postId=\{post\.uuid\} \/>/);
  });

  it("gives houses, invites and room codes the generic card only", () => {
    // A private group's title or picture in a chat app's preview cache would
    // outlive a rename and a revoked invite.
    for (const file of [
      "app/gist-rooms/page.tsx",
      "app/live/page.tsx",
      "app/live/[id]/page.tsx",
      "app/houses/page.tsx",
      "app/join/[token]/page.tsx",
      "app/code/[code]/page.tsx",
    ]) {
      assert.doesNotMatch(stripComments(read(file)), /generateMetadata|openGraph/, file);
    }
  });

  it("a gist room gets its own card ONLY when the room is public", () => {
    /*
      THE PRIVACY RULE ABOVE SURVIVES THIS, and the reason it does is the
      gate. A chat app CACHES a preview: a private room's name and cover, once
      scraped, outlive a rename, a revoked invite and the room itself, sitting
      in a thread long after the people in it changed their minds.

      What was wrong was applying that to EVERY room. A public room's name and
      cover are already public — there is nothing for a cache to leak — and
      withholding them bought no privacy while making every shared link
      identical, which is what a room link actually looked like in Telegram.

      The gate is the same pair the service gates its own public behaviour on,
      and the same pair `maySignalRoomChat` reads. An ABSENT field is NOT
      public: a payload that does not say is one this must not guess about.
    */
    const meta = stripComments(read("lib/og-metadata.ts"));
    assert.match(
      meta,
      /return room\.visibility === "public" && room\.audience === "public";/,
      "the room card is no longer gated on the room being public"
    );
    assert.match(meta, /if \(!room \|\| !roomIsPublic\(room\)\) return generic\(roomPath\(id\), "Gist room"\);/);
    // And the page asks for it rather than hard-coding a title.
    assert.match(stripComments(read("app/gist-rooms/[id]/page.tsx")), /roomMetadataFor\(result, id, siteOrigin\(process\.env\)\)/);
  });

  it("never uses the opengraph-image file convention, which overrides generateMetadata", () => {
    for (const file of ["app/opengraph-image.tsx", "app/opengraph-image.png", "app/twitter-image.tsx"]) {
      assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), false, file);
    }
    assert.match(stripComments(read("app/share-card/route.tsx")), /export const dynamic = "force-static";/);
    assert.match(stripComments(read("lib/og-metadata.ts")), /url: sq\("\/share-card"\),/);
  });

  it("keeps Next's own preview-bot list and adds to it, rather than replacing it", () => {
    const config = stripComments(read("next.config.ts"));
    assert.match(config, /import \{ HTML_LIMITED_BOT_UA_RE \} from "next\/dist\/shared\/lib\/router\/utils\/html-bots";/);
    assert.match(config, /htmlLimitedBots: new RegExp\(`\$\{HTML_LIMITED_BOT_UA_RE\.source\}\|/);
  });

  it("sets metadataBase and the generic card in the root layout", () => {
    const layout = stripComments(read("app/layout.tsx"));
    assert.match(layout, /metadataBase: new URL\(siteOrigin\(process\.env\)\)/);
    assert.match(layout, /images: \[FALLBACK_OG_IMAGE\]/);
  });
});

describe("chat photos and clips open full screen and can be saved, like WhatsApp", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));
  const viewer = stripComments(read("components/ui/media-viewer.tsx"));

  it("opens a photo or a clip in the one full-screen viewer", () => {
    assert.match(thread, /aria-label="View photo full screen"/);
    assert.match(thread, /aria-label="Play video full screen"/);
    assert.match(thread, /\{viewing && \(\n\s*<MediaViewer/);
    // The clip's frame is a div: a button around the player's own sound
    // control is invalid markup and made "Tap for sound" open the clip.
    assert.match(thread, /<div\n\s*onClick=\{\(\) => setViewing\(true\)\}\n\s*className="absolute inset-0 cursor-pointer/);
  });

  it("offers a real download on the bubble and in the viewer, or none at all", () => {
    // The service's own signed download variant where there is one, and the
    // Cloudinary rewrite only for messages sent before signed links existed.
    assert.match(thread, /const downloadUrl = downloadLinkFor\(message, `square-\$\{kind\}-\$\{message\.id\.slice\(0, 8\)\}`\);/);
    assert.match(thread, /\{downloadUrl && \(\n\s*<a\n\s*href=\{downloadUrl\}/);
    assert.match(viewer, /\{downloadUrl && \(\n\s*<a\n\s*href=\{downloadUrl\}/);
  });

  it("never opens the photo at the end of a reply swipe or a long-press", () => {
    assert.match(thread, /if \(from && dragging\.current\) \{\n\s*swallowClick\.current = true;/);
    assert.match(thread, /press\.current = null;\n\s*swallowClick\.current = true;/);
    assert.match(thread, /onClickCapture=\{\(event\) => \{\n\s*if \(!swallowClick\.current\) return;/);
    // Cleared on every press, so a gesture that produced no click cannot eat a real tap.
    assert.match(thread, /onPointerDown=\{\(event\) => \{\n\s*swallowClick\.current = false;/);
  });

  it("pauses whatever else is playing while a clip is open", () => {
    assert.match(viewer, /mediaToSilence<HTMLMediaElement>\(/);
    assert.match(viewer, /stopped\.forEach\(\(media\) => media\.pause\(\)\);/);
  });

  it("keeps profile pictures on the same viewer", () => {
    assert.match(stripComments(read("components/ui/image-viewer.tsx")), /<MediaViewer kind="image"/);
  });
});

describe("recording a voice note: discard, pause/resume, stop to a player", () => {
  const thread = stripComments(read("features/messages/components/thread.tsx"));

  it("gives the recording row discard, pause/resume and stop", () => {
    // The recorder's acts, inside the composer row (ogazboiz, 2026-09-21).
    // Discard is its own quiet control, never the primary — the destructive one
    // is the hardest to hit.
    assert.match(thread, /onClick=\{voice\.cancel\}\n\s*aria-label="Discard recording"/);
    assert.match(thread, /onClick=\{voice\.paused \? voice\.resume : voice\.pause\}/);
    assert.match(thread, /aria-label=\{voice\.paused \? "Resume recording" : "Pause recording"\}/);
    // Stop opens a review; it does not fire the note.
    assert.match(thread, /onClick=\{\(\) => void stopForReview\(\)\}/);
    assert.doesNotMatch(thread, /const sendVoiceNow/);
  });

  it("stops to a PLAYER that plays back before sending, not a file row", () => {
    // ogazboiz, 2026-09-21: play the note before sending. The review is a
    // dedicated player (VoiceReview) — play/pause, waveform, then discard,
    // re-record and send — not the staged file chip.
    assert.match(thread, /<VoiceReview\b/);
    assert.match(thread, /function VoiceReview\(/);
    assert.match(thread, /aria-label="Record again"/);
    assert.match(thread, /onSend=\{\(\) => void sendVoicePreview\(\)\}/);
    // The take is NOT uploaded until Send — the preview holds the file itself.
    assert.match(thread, /voicePreviewFile\.current = result\.file;/);
  });

  it("keeps a staged file-audio preview playable too", () => {
    assert.match(thread, /attachment\.result\.kind === "audio" \? \(\n\s*<StagedVoicePreview/);
    assert.match(thread, /function StagedVoicePreview\(/);
  });

  it("says so when the send fails, instead of failing silently", () => {
    assert.match(thread, /toast\.error\("Couldn't send the voice note\."\)/);
  });

  /*
    A DM ATTACHMENT IS PRIVATE, WHICH IS A DECISION MADE AT UPLOAD TIME.

    `purpose: "message"` is what puts the bytes behind a signed link; it cannot
    be applied afterwards to an object already sitting in a public bucket. The
    message then identifies that object by KEY, because a private object has no
    URL the sender could hand back.
  */
  it("uploads a DM attachment privately and sends it by key", () => {
    const panel = stripComments(read("features/messages/components/attachment-panel.tsx"));
    assert.match(panel, /uploadFile\(file, setProgress, "attachment", "message"\)/);
    assert.match(thread, /uploadFile\(file, undefined, "attachment", "message"\)/);
    assert.match(thread, /key: attachment\.result\.key,/);
    const outgoing = stripComments(read("features/messages/lib/outgoing.ts"));
    assert.match(outgoing, /\.\.\.\(mediaKey \? \{ key: mediaKey \} : \{ url: body\.media\.url \}\)/);
  });

  it("previews a staged attachment from the bytes in hand, and frees them", () => {
    // The stored object is private: its URL is a signed link at best and
    // unreachable at worst, so the row draws the picked file itself.
    assert.match(thread, /src=\{attachment\.previewUrl\}/);
    assert.match(thread, /url=\{attachment\.previewUrl\}/);
    assert.match(thread, /if \(current\) URL\.revokeObjectURL\(current\.previewUrl\);/);
    // Freed on send as well as on remove, or a sent photo leaks for the life of the tab.
    assert.match(thread, /dropAttachment\(\);\n\s*onCancelReply\(\);/);
    // And NOTHING draws the stored object: for a private key that URL is not
    // just unreachable, it addresses an object storage refuses anonymously.
    assert.doesNotMatch(thread, /src=\{attachment\.result\.url\}/);
    assert.doesNotMatch(thread, /url=\{attachment\.result\.url\}/);
  });
});

describe("QA round, 2026-09-15", () => {
  const filter = stripComments(read("components/layout/friends-filter.tsx"));
  const row = stripComments(read("features/messages/components/conversation-row.tsx"));
  const thread = stripComments(read("features/messages/components/thread.tsx"));
  const page = stripComments(read("features/messages/components/messages-page.tsx"));
  const room = stripComments(read("features/houses/components/house-room.tsx"));
  const choice = stripComments(read("components/layout/create-choice-sheet.tsx"));
  const spotlight = stripComments(read("features/profile/components/spotlight-page.tsx"));

  it("1 · the filter pill hugs its label instead of parking the chevron at the far end", () => {
    assert.doesNotMatch(filter, /w-\[136px\] items-center justify-between/);
    assert.match(filter, /h-\[38px\] max-w-\[240px\] items-center gap-2 rounded-full/);
  });

  it("2 · the name of the person or gist room reads as a heading", () => {
    assert.match(row, /truncate text-\[15px\] font-bold leading-5 text-white">\{name\}/);
    assert.match(thread, /<h1 className="truncate text-\[16px\] font-bold leading-6 text-white">/);
  });

  it("4 · a header opens the thing it names — a person, or a house", () => {
    assert.match(thread, /sender\?\.username \? \(\n\s*<Link\n\s*href=\{profileHref\(sender\)\}/);
    assert.match(thread, /peer\?\.username \? \(\n\s*<Link\n\s*href=\{profileHref\(peer\)\}/);
    assert.match(thread, /\) : peer\?\.username \? \(\n\s*<Link href=\{profileHref\(peer\)\}/);
    /*
      A HOUSE'S NAME OPENS THE HOUSE. Only the person half was true: once you
      joined a house it lived in your inbox and there was no route back to its
      page at all — not the members, the description or the replays you looked
      at before deciding to join. The page existed and became unreachable the
      moment you used it (ogazboiz, 2026-09-23).
    */
    assert.match(thread, /\{group \? \(\n\s*<Link href=\{sq\(`\/houses\/\$\{conversation\.id\}`\)\}/);
  });

  it("5 · the thread column and the room's chat column end with a divider, like X", () => {
    assert.match(page, /flex min-h-0 min-w-0 flex-1 flex-col lg:border-r lg:border-white\/10/);
    assert.match(room, /xl:w-\[411px\] xl:border-x xl:border-t-0/);
  });

  it("7 · the dock's plus asks: a post, or a gist room", () => {
    assert.match(shell, /onCompose=\{canCompose && !guest \? \(\) => setChoosingCreate\(true\) : undefined\}/);
    assert.match(shell, /<CreateChoiceSheet\n\s*open=\{choosingCreate\}/);
    assert.match(choice, /onPost\(\);/);
    // The same address the sidebar's Start Gistroom uses.
    assert.match(choice, /router\.push\(sq\("\/gist-rooms\?open=1"\)\)/);
  });

  it("9 · spotlight's windows are all real, and the WEEK is what it opens on", () => {
    /*
      All three were drawn with two DISABLED, and that was honest: the service
      kept one running total and nothing reset, decayed or windowed it, so
      "This week" would have been a false claim about all-time numbers.

      The service keeps dated points now — `weekly` is a rolling 7 days and
      `monthly` a rolling 30 — so the control that said "coming soon" was
      describing a capability that had arrived.

      The WEEK leads because an all-time board stops being news: it rewards
      whoever was early, the same names sit at the top for ever, and a newcomer
      has nothing they can do that would show up in their lifetime.
    */
    assert.match(spotlight, /action=\{<SpotlightWindowMenu value=\{window\} onChange=\{setWindow\} \/>\}/);
    assert.match(spotlight, /\{ value: "weekly", label: "This week", live: true \}/);
    assert.match(spotlight, /\{ value: "monthly", label: "This month", live: true \}/);
    assert.match(spotlight, /\{ value: "all", label: "All time", live: true \}/);
    // The "coming soon" hint described a capability that now exists.
    assert.doesNotMatch(spotlight, /Coming soon: weekly and monthly ranking/);
    assert.match(spotlight, /useState<SpotlightWindow>\("weekly"\)/);
  });

  it("9b · spotlight asks for a window, so the board can actually turn over", () => {
    /*
      This used to assert the OPPOSITE — that no window was sent — and it was
      right at the time: the service knew only `weekly`, treated it as a name
      rather than a period, and would have refused `all`. Pinning `weekly` then
      would have blanked the board the day a real rolling week shipped.

      It shipped. `weekly | monthly | all` are all live, `all` is the service's
      documented default, and sending nothing is what kept every reader on an
      all-time board for ever. The window is passed now, and it defaults to the
      week.
    */
    const api = stripComments(read("features/profile/lib/api.ts"));
    assert.match(api, /window: "weekly" \| "monthly" \| "all" = "weekly"/);
    assert.match(api, /msApi\.get\(`\/spotlight\?window=\$\{window\}`\)/);
  });

  it("8 · the story viewer reports a view, so an author's viewer list can have anyone in it", () => {
    const stories = stripComments(read("features/feed/components/stories-row.tsx"));
    assert.match(stories, /import \{ reportView \} from "@\/features\/feed\/hooks\/use-record-view";/);
    assert.match(stories, /onSeen\(story\.id\);\n\s*reportView\(story\.id\);/);
  });

  it("10 · the phone avatar opens the desktop's account menu, and keeps a way to every page", () => {
    assert.match(shell, /\{\(close\) => <AccountMenuItems close=\{close\} onOpenNav=\{\(\) => setMenuOpen\(true\)\} \/>\}/);
    assert.match(shell, /\{onOpenNav && \(\n\s*<MenuRow\n\s*icon=\{<IconMore/);
    assert.match(shell, /label="All pages"/);
  });
});

describe("Seen by: the author sees who viewed their story", () => {
  const stories = stripComments(read("features/feed/components/stories-row.tsx"));
  const panel = stripComments(read("features/feed/components/story-viewers.tsx"));
  const hook = stripComments(read("features/feed/hooks/use-story-viewers.ts"));

  it("asks only on the reader's own story", () => {
    // The route is author-only; asking on anyone else's is a 404 on every story opened.
    assert.match(stories, /const mine = Boolean\(group && me\.data && group\.id === me\.data\.id\);/);
    assert.match(stories, /useStoryViewers\(story\?\.id, mine\)/);
    assert.match(hook, /enabled: enabled && Boolean\(storyId\),/);
  });

  it("draws nothing until the service answers, so a missing route leaves no broken entry", () => {
    assert.match(stories, /\{mine && viewerTotal !== null && \(/);
    assert.match(hook, /retry: shouldRetryViewers,/);
  });

  it("counts from total, never from the rows the list happens to hold", () => {
    assert.match(stories, /const viewerTotal = viewers\.data\?\.pages\[0\]\?\.total \?\? null;/);
    assert.match(stories, /\{seenByLabel\(viewerTotal\)\}/);
    assert.doesNotMatch(panel, /seenByLabel\(rows\.length\)/);
  });

  it("holds the story while the list is open, and closes it when the story changes", () => {
    assert.match(stories, /isHeld\(\{ pressing, hovering, hidden: hidden \|\| viewersFor !== null \}\)/);
    assert.match(stories, /const viewersOpen = Boolean\(story && viewersFor === story\.id\);/);
  });

  it("opens each viewer's profile", () => {
    assert.match(panel, /href=\{profileHref\(profile\)\}/);
  });
});

describe("links to a person go by id, not by a username they can change (QA)", () => {
  // Every in-app profile link is profileHref(profile). The files below are the
  // deliberate exceptions, each for a reason stated in lib/profile-href.ts or
  // at the call site: the canonical-address redirects themselves, callers that
  // only ever hold a username, and the SEO canonical.
  const ALLOWED = new Set([
    "components/layout/settings-screen.tsx",
    "features/profile/components/follow-list-page.tsx",
    "features/profile/components/claim-username-gate.tsx",
    "features/houses/components/room-roster-panel.tsx",
    "features/houses/components/person-sheet.tsx",
    "lib/og-metadata.ts",
  ]);
  const walk = (dir: string): string[] =>
    fs.readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
      return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
    });

  it("draws no in-app profile link from a username outside the known exceptions", () => {
    const offenders: string[] = [];
    for (const file of [...walk("features"), ...walk("components"), ...walk("lib"), ...walk("app")]) {
      if (ALLOWED.has(file)) continue;
      const code = stripComments(read(file));
      // A link built from a username that is NOT a share link (those keep the
      // short username on purpose and start with the page origin).
      for (const match of code.matchAll(/`\/u\/\$\{[^}`]*\.username\}/g)) {
        const before = code.slice(Math.max(0, (match.index ?? 0) - 40), match.index);
        if (!/window\.location\.origin\}(\$\{sq\()?$/.test(before)) offenders.push(file);
      }
    }
    assert.deepEqual([...new Set(offenders)], []);
  });

  it("builds the link from the id, and the profile page shows the current username", () => {
    assert.match(stripComments(read("lib/profile-href.ts")), /const key = SAFE_ID\.test\(profile\.id\)/);
    assert.match(stripComments(read("features/profile/components/profile-page.tsx")), /useCanonicalProfileAddress\(username, profile\.data\);/);
    assert.match(stripComments(read("features/profile/components/follow-list-page.tsx")), /useCanonicalProfileAddress\(username, profile\.data, tab\);/);
    assert.match(stripComments(read("features/profile/hooks/use-canonical-profile-address.ts")), /router\.replace\(/);
  });

  it("links a mention by the recorded profile id when there is one", () => {
    assert.match(stripComments(read("components/ui/post-text.tsx")), /segment\.id \? profileHref\(\{ id: segment\.id, username: segment\.handle \}\)/);
  });
});

describe("one room per tab, owned by the shell", () => {
  const code = (path: string) => stripComments(read(path));

  it("mounts exactly one RoomSessionProvider, inside app-shell.tsx", () => {
    const mounts: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(resolve(import.meta.dirname, "..", dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
        return /\.tsx$/.test(entry.name) ? [path] : [];
      });
    for (const file of [...walk("app"), ...walk("components"), ...walk("features")]) {
      const count = (code(file).match(/<RoomSessionProvider\b/g) ?? []).length;
      for (let i = 0; i < count; i += 1) mounts.push(file);
    }
    assert.deepEqual(mounts, ["components/layout/app-shell.tsx"]);
    // Around BOTH shells — the bare /live/:id branch included — or switching
    // between them unmounts it and hangs up.
    const shell = code("components/layout/app-shell.tsx");
    assert.match(shell, /<RoomSessionProvider>\s*<ShellFrame>\{children\}<\/ShellFrame>[\s\S]*?<\/RoomSessionProvider>/);
  });

  it("keeps the connection out of the room view (the connect-in-route regression)", () => {
    const room = code("features/houses/components/house-room.tsx");
    for (const name of ["useHouseConnection", "usePublisher", "RemoteAudio", "usePlaybackToken", "useStage("]) {
      assert.equal(room.includes(name), false, `house-room.tsx uses ${name} again`);
    }
    assert.match(room, /enterRoom\(/, "the view no longer asks the session to enter");
  });

  it("the provider owns the audio sinks and the one-Room registry", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /<HouseAudioSinks\b/);
    assert.match(provider, /register: registerRoom/);
    assert.match(provider, /unregister: unregisterRoom/);
    assert.doesNotMatch(provider, /consumeIntent/, "a gist room opens somebody's mic for them again");
  });

  it("the card preview never beats and never previews the room you are in", () => {
    const hook = code("features/streams/hooks/use-room-preview.ts");
    assert.doesNotMatch(hook, /sendHeartbeat/);
    assert.match(hook, /const active = requested && !connected;/);
  });

  it("logout hangs up first", () => {
    const logout = code("hooks/use-logout.ts");
    assert.ok(logout.indexOf("getRoomSession().logout()") < logout.indexOf("logout()).catch"));
  });

  it("the phone's Back minimises", () => {
    const header = code("features/houses/components/house-header.tsx");
    assert.match(header, /aria-label="Minimise room"/);
    // A back control is a left chevron on the phone (a down chevron reads as
    // "collapse"); the aria-label carries that it minimises the room.
    assert.match(header, /<IconChevronLeft className="w-4 h-4 shrink-0 md:hidden" \/>/);
  });

  it("a stream asks before it plays over a gist room", () => {
    assert.match(code("components/layout/stream-room-screen.tsx"), /Leave the gist room to watch\?/);
  });
});

describe("the minimised room, the zone-exit guard and the publisher's guards", () => {
  const code = (path: string) => stripComments(read(path));

  it("the mini-player is drawn by AppShell, never by a room route", () => {
    const shell = code("components/layout/app-shell.tsx");
    assert.match(shell, /<RoomMiniPlayer placement="phone" \/>/);
    assert.match(shell, /\{!railOn && <RoomMiniPlayer placement="card" \/>\}/);
    assert.match(shell, /<RoomMiniPlayer placement="rail" \/>/);
    for (const file of ["app/gist-rooms/[id]/page.tsx", "app/gist-rooms/page.tsx", "components/layout/house-room-screen.tsx", "features/houses/components/house-room.tsx"]) {
      assert.doesNotMatch(code(file), /RoomMiniPlayer/, `${file} draws the mini-player`);
    }
  });

  it("lifts the dock's row and the phone + offsets by the mini-player's height", () => {
    const shell = code("components/layout/app-shell.tsx");
    assert.match(shell, /data-mini-player=\{miniPlayer \? "on" : "off"\}/);
    const css = read("app/globals.css");
    const rule = block(css, '[data-mini-player="on"] {', "}");
    assert.match(rule, /--ws-nav-h: calc\([^;]*var\(--ws-mini-h\)\);/);
    assert.match(rule, /--ws-fab-bottom: calc\([^;]*var\(--ws-mini-h\)\);/);
    assert.match(rule, /--ws-fab-clearance: calc\([^;]*var\(--ws-mini-h\)\);/);
    // A room's own bar still zeroes the row: it comes AFTER, so it wins.
    assert.ok(css.indexOf('[data-mini-player="on"] {') < css.indexOf('[data-dock="room-bar"] {'));
    // The bar rings the shell itself, on show and off on unmount.
    assert.match(code("components/layout/room-mini-player.tsx"), /setMiniPlayer\(up\);\s*return \(\) => setMiniPlayer\(false\);/);
  });

  it("the publisher no longer confirms in-app links; beforeunload stays, the Studio keeps its own", () => {
    const publisher = code("features/streams/hooks/use-publisher.ts");
    assert.doesNotMatch(publisher, /addEventListener\("click"/, "use-publisher registers an anchor click listener again");
    assert.match(publisher, /window\.addEventListener\("beforeunload", onBeforeUnload\);/);
    assert.match(code("features/streams/components/live-cockpit.tsx"), /useInAppLeaveConfirm\(publisher\.state === "publishing"\);/);
  });

  it("the zone-exit guard asks only a host or a speaker, and only for a Square-leaving link", () => {
    const guard = code("components/layout/zone-exit-guard.tsx");
    assert.match(guard, /const speaking = session\.presence === "host" \|\| session\.presence === "speaker";/);
    assert.match(guard, /if \(!speaking\) return;/);
    assert.match(guard, /if \(!isZoneExit\(raw, \{ origin: window\.location\.origin \}\)\) return;/);
    assert.match(guard, /document\.addEventListener\("click", onClickCapture, true\);/);
    assert.ok(guard.indexOf("Open in new tab") < guard.indexOf("Leave and go"), "the safe choice is not first");
    assert.match(code("components/layout/app-shell.tsx"), /<ZoneExitGuard \/>/);
  });
});

describe("the room session's review fixes, pinned where no pure half exists", () => {
  const code = (path: string) => stripComments(read(path));

  it("the mic controls live only on the room the session is IN", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /const onStage = here && \(isHost \|\| session\.presence === "speaker" \|\| session\.micOn\);/);
    // Every publisher control, the M key included, reads that one flag.
    assert.match(room, /if \(key === "m" && onStage\)/);
    assert.doesNotMatch(room, /const onStage = isHost \|\|/);
  });

  it("an unanswered conflict question is cleared when the asking view goes away", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /if \(!askingToSwitch\) return;\s*return \(\) => dismissConflict\(stream\.id\);/);
    const provider = code("components/layout/room-session.tsx");
    // Stable, or the cleanup above dismisses the question on every render.
    assert.match(provider, /const dismissConflict = useCallback\(\(id\?: string\) => controller\.dismissConflict\(id\), \[controller\]\);/);
  });

  it("a host's 'Leave and join' says it CLOSES their room, and the end-stream call is wired", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /const hostingOther = askingToSwitch && session\.state\.target\?\.role === "host";/);
    assert.match(room, /Joining this room will close it for everyone\./);
    assert.match(room, /\{hostingOther \? "Close and join" : "Leave and join"\}/);
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /closeRoom: \(streamId\) => closeRoomCall\.current\(streamId\),/);
    assert.match(provider, /await endRoomAsync\(id\);/);
  });

  it("Backstage asks about a held room BEFORE go-live, never after", () => {
    const backstage = code("features/houses/components/backstage.tsx");
    const open = block(backstage, "const open = () => {", "\n  };\n");
    assert.ok(
      open.indexOf("backstageOpenStep(session.state, stream.id)") >= 0 &&
        open.indexOf("backstageOpenStep(session.state, stream.id)") < open.indexOf("openNow()"),
      "Backstage goes live before checking for a held room"
    );
    assert.doesNotMatch(open, /goLive\.mutate/);
    assert.equal((backstage.match(/goLive\s*\.mutate(?:Async)?\(/g) ?? []).length, 1);
    const leaveAndOpen = block(backstage, "const leaveAndOpen = async () => {", "\n  };\n");
    assert.ok(leaveAndOpen.indexOf("await session.vacate()") < leaveAndOpen.indexOf("openNow()"));
  });

  it("a signed-out reader is never entered into a room", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /const identityKnown = roomEntryReady\(\{/);
    assert.match(room, /authenticated: auth\.authenticated,/);
    assert.match(room, /if \(!identityKnown\) return;\s*enterRoom\(/);
    assert.match(room, /Sign in to listen to this gist room\./);
  });

  it("'Leave and join' frees the seat and the rejoin record like every other leave", () => {
    const provider = code("components/layout/room-session.tsx");
    const confirm = block(provider, "const confirmConflict = useCallback(", "]);");
    const release = confirm.indexOf("releaseSeat();");
    assert.ok(
      release !== -1 && release < confirm.indexOf("controller.confirmConflict()") && confirm.includes("writeRejoin(null)"),
      "confirmConflict skips the seat release"
    );
    assert.doesNotMatch(provider, /confirmConflict: \(\) => controller\.confirmConflict\(\)/);
  });

  it("any sign-out brings the room down, not only useLogout", () => {
    assert.doesNotMatch(code("features/profile/components/auth-page.tsx"), /\blogout\b[^\n]*=\s*useAuth\(\)|const \{[^}]*\blogout\b[^}]*\} = useAuth\(\)/);
    assert.match(code("features/profile/components/auth-page.tsx"), /const logout = useLogout\(\);/);
    const provider = code("components/layout/room-session.tsx");
    const backstop = block(provider, "const wasAuthenticated = useRef(false);", "}, [auth.ready, auth.authenticated, controller]);");
    assert.ok(backstop.indexOf("writeRejoin(null)") < backstop.indexOf("void controller.logout()"));
  });

  it("the OS media controls name a private room neutrally, and pause mutes an open mic", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /mediaSessionMetadata\(stream\.data\)/);
    assert.doesNotMatch(provider, /new MediaMetadata\(\{ title: topic/);
    assert.match(provider, /session\.setActionHandler\("pause", \(\) => void toggleMic\(\)\);/);
    assert.match(provider, /setMicrophoneActive\?\.\(micOn\)/);
    // The browser's own mic toggle (media hub, PiP) works both ways for anyone
    // with a mic to toggle, and the mute control follows the publication.
    assert.match(provider, /session\.setActionHandler\("togglemicrophone" as MediaSessionAction, \(\) => void toggleMic\(\)\);/);
    assert.match(provider, /const micControllable = holding && \(isHost \|\| presence === "speaker" \|\| stage\.micOn\);/);
    assert.match(provider, /const hotMic = holding && stage\.micOn;/);
  });

  it("a failed room retries when the network or the tab comes back", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /window\.addEventListener\("online", onOnline\);/);
    assert.match(provider, /document\.addEventListener\("visibilitychange", onVisible\);/);
    assert.match(provider, /controller\.onNetworkBack\(\)/);
    assert.match(provider, /setTimeout: \(callback, ms\) => window\.setTimeout\(callback, ms\),/);
  });
});

describe("the gist room's review fixes", () => {
  const code = (path: string) => stripComments(read(path));

  it("the duplicate panel on the room's own page is not a dead end: Use it here and Dismiss", () => {
    const room = code("features/houses/components/house-room.tsx");
    const panel = block(room, '{state === "duplicate" && (', "\n      )}");
    assert.match(panel, /session\.dismiss\(\);\s*enterRoom\(stream\.id, role\);/, "Use it here must clear the terminal state before entering");
    assert.match(panel, />\s*Use it here\s*</);
    assert.match(panel, /onClick=\{\(\) => session\.dismiss\(\)\}/);
    assert.match(panel, />\s*Dismiss\s*</);
  });

  it("the houses slice builds a host's Room without importing the streams slice", () => {
    const connection = code("features/houses/hooks/use-house-connection.ts");
    assert.doesNotMatch(connection, /@\/features\/streams/);
    assert.match(connection, /new RoomClass\(\{ \.\.\.hostRoomOptions\(livekit, preferredMic\), disconnectOnPageLeave: false \}\)/);
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /connectRoom\(target, \{ \.\.\.options, hostRoomOptions: publisherRoomOptions \}\)/);
  });

  it("a mic button's changing Mute/Unmute label is never paired with aria-pressed", () => {
    for (const path of [
      "components/layout/room-mini-player.tsx",
      "features/houses/components/room-dock.tsx",
      "features/houses/components/house-controls.tsx",
      "features/houses/components/room-phone-bar.tsx",
      "features/streams/components/guest-speaker-control.tsx",
    ]) {
      const source = code(path);
      assert.doesNotMatch(source, /aria-pressed=\{!?\s*[\w.]*(?:mic|cam)[\w.]*\}/i, path);
      assert.doesNotMatch(source, /pressed=\{!?\s*session\.micOn\}/, path);
    }
  });

  it("the controller carries no unused scaffolding", () => {
    const controller = code("lib/room-session/controller.ts");
    assert.doesNotMatch(controller, /onTokenRefreshed|upgradeToIdentified|requestMic|consumeMicIntent|micIntent/);
    assert.doesNotMatch(code("lib/room-session/reducer.ts"), /"anon"|switching/);
  });

  it("the heartbeat fires on connect, before the interval", () => {
    const controller = code("lib/room-session/controller.ts");
    assert.match(controller, /beat\(\);\s*this\.heartbeat = this\.deps\.clock\.setInterval\(beat, HEARTBEAT_MS\);/);
  });

  it("names the seat a passive sign-out cannot free as a backend dependency", () => {
    const provider = read("components/layout/room-session.tsx");
    assert.match(provider, /BACKEND B5: A SEAT HELD THROUGH A SIGN-OUT NOBODY PRESSED IS NOT FREED/);
  });
});

describe("the mini-player's reach, contrast and announcements", () => {
  const code = (path: string) => stripComments(read(path));
  const player = code("components/layout/room-mini-player.tsx");

  it("reads the connection through miniPlayerChrome, never status === \"live\"", () => {
    assert.match(player, /miniPlayerChrome\(\{/);
    assert.doesNotMatch(player, /status === "live"/);
    assert.doesNotMatch(player, /status === "failed"/);
  });

  it("keeps the room on screen, in every state, where the phone bar steps aside", () => {
    assert.match(player, /const chip = onPhone && phone && roomChipVisible\(where\);/);
    assert.doesNotMatch(player, /hotMicChipVisible|HotMicChip/, "the chip is gated on a hot mic again");
    assert.match(player, /if \(chip && streamId\) return <RoomChip/);
    const chip = block(player, "function RoomChip(", "\n}\n");
    assert.match(chip, /\{chrome\.publishing && <MicButton session=\{session\} \/>\}/);
    assert.match(chip, /\{chrome\.retry && \(/);
    assert.match(chip, /\{chrome\.finished \? <DismissButton session=\{session\} \/> : <HangUp session=\{session\} streamId=\{streamId\} \/>\}/);
    assert.match(chip, /\{chrome\.announcement\}/);
  });

  it("the bar and the chip share ONE hang-up, with its confirmations", () => {
    assert.equal((player.match(/<HangUp session=\{session\} streamId=\{streamId\} \/>/g) ?? []).length, 2);
    assert.equal((player.match(/title="Leave the stage\?"/g) ?? []).length, 1);
    assert.equal((player.match(/title="Close the gist room\?"/g) ?? []).length, 1);
  });

  it("gives every round control a 44px target on touch, and Listen/Retry a 44px height", () => {
    const button = block(player, "function RoundButton(", "\n}\n");
    assert.match(button, /grid h-11 w-11 shrink-0 place-items-center[^"]*pointer-fine:h-9 pointer-fine:w-9/);
    assert.match(button, /"grid h-9 w-9 place-items-center rounded-full/);
    assert.equal((player.match(/size="sm" variant="secondary"[^>]*pointer-coarse:h-11/g) ?? []).length, 2);
  });

  it("sets state copy in grey-400, never text-meta, which fails AA at 11px on the glass", () => {
    assert.doesNotMatch(player, /text-meta/);
  });

  it("asks a seated speaker before the red button gives up their seat", () => {
    assert.match(player, /presence === "speaker"\s*\? setConfirmLeaveStage\(true\)/);
    assert.match(player, /title="Leave the stage\?"/);
  });

  it("keeps Listen and Retry reachable in the icon rail, and the return link a real target", () => {
    assert.match(player, /label="Listen"[^>]*className="hidden group-data-\[rail=icon\]\/rail:grid"/);
    assert.match(player, /label="Retry the connection"[^>]*className="hidden group-data-\[rail=icon\]\/rail:grid"/);
    assert.match(
      player,
      /group-data-\[rail=icon\]\/rail:h-11 group-data-\[rail=icon\]\/rail:w-11 group-data-\[rail=icon\]\/rail:pointer-fine:h-10 group-data-\[rail=icon\]\/rail:pointer-fine:w-10/,
      "the icon rail's return link is under 44px on touch"
    );
    assert.doesNotMatch(player, /group-data-\[rail=icon\]\/rail:h-10 group-data-\[rail=icon\]\/rail:w-10/);
    // Hidden in the icon rail only as TEXT buttons; each has its icon twin there.
    const body = block(player, "function PlayerBody(", "\n}\n");
    for (const verb of ["startAudio", "retry"]) {
      assert.match(
        body,
        new RegExp(`onClick=\\{session\\.${verb}\\} className="shrink-0 pointer-coarse:h-11 group-data-\\[rail=icon\\]\\/rail:hidden"`),
        `${verb}: the text button is no longer the one hidden in the icon rail`
      );
      assert.match(
        body,
        new RegExp(`placement === "rail" && \\(\\s*<RoundButton label="[^"]+" onClick=\\{session\\.${verb}\\} className="hidden group-data-\\[rail=icon\\]\\/rail:grid"`),
        `${verb}: no icon control reaches it in the icon rail`
      );
    }
  });

  it("announces through one always-mounted live region, and the link carries the state", () => {
    const frame = block(player, "function Frame(", "\n}\n");
    assert.match(frame, /<p role="status" aria-live="polite" className="sr-only">\s*\{announcement\}/);
    assert.equal((frame.match(/\{live\}/g) ?? []).length, 3);
    assert.match(player, /aria-label=\{line \? `Return to \$\{title\}, \$\{line\}` : `Return to \$\{title\}`\}/);
  });

  it("moves the desktop card off the thread's composer while a chat is open", () => {
    const frame = block(player, "function Frame(", "\n}\n");
    assert.match(frame, /\{ top: "calc\(var\(--ws-crumb-h\) \+ 92px\)", right: "max\(24px, env\(safe-area-inset-right, 0px\)\)" \}/);
    assert.match(frame, /bottom: "calc\(var\(--ws-nav-h\) - var\(--ws-mini-card-h, 0px\) \+ 8px\)",\s*left: "max\(24px, env\(safe-area-inset-left, 0px\)\)",/);
  });

  it("puts the phone bar before the dock in the document, and focus somewhere stable on leave", () => {
    const shell = code("components/layout/app-shell.tsx");
    assert.ok(shell.indexOf('<RoomMiniPlayer placement="phone" />') < shell.indexOf("<BottomDock"));
    assert.match(player, /keepFocus\(\);\s*void session\.leave\(\);/);
    assert.match(player, /keepFocus\(\);\s*session\.dismiss\(\);/);
  });
});

describe("one live microphone per tab, and no stale question", () => {
  const code = (path: string) => stripComments(read(path));

  it("recording a voice note mutes an open gist-room mic first", () => {
    const recorder = code("features/messages/hooks/use-voice-recorder.ts");
    const mute = recorder.indexOf("if (room.micOn)");
    assert.notEqual(mute, -1, "the recorder no longer checks the room's mic");
    assert.match(recorder, /const room = getRoomSession\(\);\s*if \(room\.micOn\) \{\s*await room\.toggleMic\(\);/);
    assert.ok(mute < recorder.indexOf("getUserMedia({ audio: true })"), "the room mic is muted after the second capture opens");
  });

  it("the Studio asks before it broadcasts over a gist room", () => {
    const page = code("app/studio/[id]/page.tsx");
    assert.match(page, /<StudioRoomScreen streamId=\{id\} \/>/);
    const screen = code("components/layout/studio-room-screen.tsx");
    assert.match(screen, /<GistRoomGuard/);
    assert.match(screen, /Leave the gist room to go live\?/);
    assert.match(screen, /<StudioStreamScreen streamId=\{streamId\} \/>/);
    // The same one guard the stream room uses.
    assert.match(code("components/layout/stream-room-screen.tsx"), /<GistRoomGuard/);
    const guard = code("components/layout/gist-room-guard.tsx");
    assert.match(guard, /holding: isHolding\(session\.state\.connection\),/);
  });

  it("the zone-exit sheet forgets its link when the reader stops speaking", () => {
    const guard = code("components/layout/zone-exit-guard.tsx");
    assert.match(guard, /if \(!speaking && exit !== null\) setExit\(null\);/);
  });
});

describe("the room session's second review round", () => {
  const code = (path: string) => stripComments(read(path));

  it("a remounted provider adopts the page's one controller instead of starting idle beside a live Room", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /let sharedController: RoomSessionController<Room> \| null = null;/);
    assert.match(provider, /if \(typeof window === "undefined"\) return createController\(\);/);
    assert.match(provider, /const \[controller\] = useState\(sessionController\);/);
    assert.doesNotMatch(provider, /useState\(\s*\(\) =>\s*new RoomSessionController/);
  });

  it("the polls stop once the automatic retries have given up", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /const polling = holding && !state\.retriesExhausted;/);
    assert.match(provider, /useStream\(streamId, 10_000, Boolean\(streamId\) && polling\)/);
    assert.match(provider, /useMySpeakerRequest\(streamId, polling && !isHost\)/);
  });

  it("captions come from the live room only, and a new URL starts a new transcript", () => {
    assert.match(code("components/layout/room-session.tsx"), /captionUrl: controller\.captionUrl,/);
    assert.match(
      code("features/houses/components/house-room.tsx"),
      /<CaptionRail key=\{here \? \(session\.captionUrl \?\? "none"\) : "none"\} captionUrl=\{here \? session\.captionUrl : null\} \/>/
    );
  });

  it("a room page whose switch question vanished unanswered offers Join instead of Connecting forever", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /if \(askingToSwitch && !wasAsked\) setWasAsked\(true\);/);
    assert.match(room, /const gone = \(wasHere \|\| wasAsked\) && !here && !askingToSwitch;/);
  });
});

describe("a speaker's stage has a way back, and a mic banner that tells the truth", () => {
  const code = (path: string) => stripComments(read(path));

  it("presence counts a granted speaker as seated through a failed tap to talk", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /stagePresence\(\{/);
    assert.doesNotMatch(provider, /approved && stage\.state === "live"/);
  });

  it("the host's mic banner clears once the mic is open, and its Try again opens rather than toggles", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /if \(stage\.micOn && publishFailure\) setPublishFailure\(null\);/);
    assert.match(provider, /const retryMic = useCallback\(\(\) => \{\s*setPublishFailure\(null\);\s*stageRetry\(\);/);
    const room = code("features/houses/components/house-room.tsx");
    const banner = block(room, "{here && isHost && state === \"live\" && session.micFailure && (", "\n      )}");
    assert.match(banner, /onClick=\{\(\) => session\.stage\.retry\(\)\}/);
    assert.doesNotMatch(banner, /toggleMic/);
  });

  it("the room view draws the stage recovery panel and wires every remedy", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /roomStagePanel\(\{/);
    assert.match(room, /if \(action === "rejoin"\) return session\.stage\.rejoin\(\);/);
    assert.match(room, /if \(action === "retry"\) return session\.stage\.retry\(\);/);
  });

  it("never offers Ask to speak to somebody already approved, or already invited", () => {
    assert.match(
      code("features/houses/components/house-room.tsx"),
      /const canAsk = !isHost && !onStage && myRequestStatus !== "approved" && myRequestStatus !== "invited";/
    );
  });

  it("the voice recorder refuses to record while the room mic is still actually open", () => {
    const recorder = code("features/messages/hooks/use-voice-recorder.ts");
    assert.match(recorder, /room\.room\?\.localParticipant\.isMicrophoneEnabled/);
  });
});

describe("nothing inside the Square reloads the tab under a gist room", () => {
  const code = (path: string) => stripComments(read(path));

  it("a tapped push asks the open Square tab to navigate itself, and reloads only without an answer", () => {
    const sw = code("public/sw.js");
    assert.match(sw, /client\.postMessage\(\{ type: "ms:navigate", url: target\.href, deadline \}, \[channel\.port2\]\)/);
    const click = block(sw, 'self.addEventListener("notificationclick"', "\n});");
    assert.ok(click.indexOf("postMessage") < click.indexOf("client.navigate("), "navigate() is not the fallback");
    assert.match(click, /if \(!acknowledged && "navigate" in client\) await client\.navigate\(target\.href\);/);
    const listener = code("components/layout/push-navigation.tsx");
    assert.match(listener, /navigator\.serviceWorker\.addEventListener\("message", onMessage\);/);
    assert.match(listener, /router\.push\(path\);/);
    assert.match(listener, /event\.ports\[0\]\?\.postMessage\("ok"\);/);
    // Answered BEFORE anything that can block (a confirm), or the worker's
    // timer runs out and reloads the tab under the question.
    assert.ok(listener.indexOf('postMessage("ok")') < listener.indexOf("window.confirm("));
    assert.ok(listener.indexOf("window.confirm(") < listener.indexOf("router.push(path)"));
    assert.match(listener, /const guard = inAppLeaveGuard\(\);\s*if \(guard && !window\.confirm\(guard\)\) return;/);
    assert.match(listener, /now: Date\.now\(\)/);
    // A visible, focused tab gets time to answer; the deadline travels with the message.
    assert.match(sw, /const wait = client\.visibilityState === "visible" \? NAVIGATE_ACK_VISIBLE_MS : NAVIGATE_ACK_MS;/);
    assert.match(sw, /const deadline = Date\.now\(\) \+ wait;/);
    // The in-page broadcasts raise the guard.
    assert.match(code("features/streams/hooks/use-in-app-leave-confirm.ts"), /setInAppLeaveGuard\(message\)/);
    assert.match(code("features/streams/components/guest-speaker-control.tsx"), /useInAppLeaveGuard\(onStage, /);
    assert.match(code("components/layout/app-shell.tsx"), /<PushNavigation \/>/);
  });

  it("no layout component or the Gistroom banner leaves by a bare location.assign", () => {
    const layout = readdirSync(resolve(import.meta.dirname, "../components/layout")).filter((name) => /\.tsx?$/.test(name));
    for (const name of layout) {
      assert.doesNotMatch(code(`components/layout/${name}`), /window\.location\.assign\(/, name);
    }
    assert.doesNotMatch(code("features/streams/components/live-cta.tsx"), /location\.assign/);
    assert.match(code("features/streams/components/live-cta.tsx"), /router\.push\(sq\("\/gist-rooms\?open=1"\)\)/);
  });

  it("the rail's Ark menu and Back to Ark go through the zone-exit question", () => {
    const shell = code("components/layout/app-shell.tsx");
    const menu = block(shell, "function ArkMenu(", "\n}\n");
    assert.match(menu, /requestZoneExit\(\{ href: destination\.href, go: \(\) => leaveSquare\(destination\.href\) \}\)/);
    assert.match(menu, /goBackToArk\(\)/);
    assert.match(code("components/layout/ark-nav.tsx"), /requestZoneExit\(\{/);
    const guard = code("components/layout/zone-exit-guard.tsx");
    assert.match(guard, /setZoneExitHandler\(/);
  });

  it("the guard sends /live/:id and /studio/:id of the room you are in back to that room", () => {
    const guard = code("components/layout/gist-room-guard.tsx");
    assert.match(guard, /gistRoomGuard\(\{/);
    assert.match(guard, /router\.replace\(sq\(`\/gist-rooms\/\$\{streamId\}`\)\)/);
  });
});

describe("a private room's name stays off lock screens and other accounts' screens", () => {
  const code = (path: string) => stripComments(read(path));

  it("go-live and a stream update merge into the detail cache without dropping the doorplate", () => {
    const hooks = code("features/streams/hooks/use-streams.ts");
    const goLive = block(hooks, "export function useGoLive(", "\n}\n");
    assert.match(goLive, /mergeStreamDetail\(old, stream\)/);
    const update = block(hooks, "export function useUpdateStream(", "\n}\n");
    assert.match(update, /mergeStreamDetail\(old, stream\)/);
    // Ending a room writes its payload too — during a host's "Close and join"
    // the session is still holding it, and the lock screen reads this cache.
    const end = block(hooks, "export function useEndStream(", "\n}\n");
    assert.match(end, /mergeStreamDetail\(old, stream\)/);
    assert.doesNotMatch(end, /setQueryData\(\["ms", "stream", stream\.id\], stream\)/);
  });

  it("the rejoin record carries its owner and a neutral name, and is offered only to that account", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /writeRejoin\(\{ streamId, title: liveTitle, userId: meId \}\)/);
    assert.match(provider, /sharedSurfaceTitle\(stream\.data, houseTopic\(stream\.data\)\)/);
    assert.match(provider, /const rejoinOffer = rejoinOfferFor\(\{/);
    const backstop = block(provider, "const wasAuthenticated = useRef(false);", "}, [auth.ready, auth.authenticated, controller]);");
    assert.match(backstop, /if \(!auth\.authenticated\) writeRejoin\(null\);/);
  });
});

describe("the mini-player fits every frame it is drawn in", () => {
  const code = (path: string) => stripComments(read(path));
  const player = code("components/layout/room-mini-player.tsx");

  it("the labelled rail stacks the title over a wrapping control row, so hang-up is never clipped", () => {
    const frame = block(player, "function Frame(", "\n}\n");
    assert.doesNotMatch(frame, /rail=full\]\/rail:flex-row/, "the rail placement is one overflowing row again");
    const controls = block(player, "function Controls(", "\n}\n");
    assert.match(controls, /group-data-\[rail=full\]\/rail:flex-wrap/);
    assert.match(controls, /group-data-\[rail=full\]\/rail:justify-end/);
  });

  it("'You're live' is a badge in the state line, never a pill in the control row", () => {
    assert.match(player, /chrome\.liveBadge/);
    assert.doesNotMatch(player, /\{chrome\.hotMic && \(\s*<span/);
  });

  it("a phone and the icon rail get the icon form of Listen and Retry", () => {
    const body = block(player, "function PlayerBody(", "\n}\n");
    assert.match(body, /placement === "phone"/);
    assert.equal((player.match(/size="sm" variant="secondary"[^>]*pointer-coarse:h-11/g) ?? []).length, 2);
  });

  it("the icon rail frame fits its 48px column: no border, no side padding", () => {
    const frame = block(player, "function Frame(", "\n}\n");
    assert.match(frame, /group-data-\[rail=icon\]\/rail:border-0 group-data-\[rail=icon\]\/rail:px-0/);
    const offer = block(player, "if (offering && offer) {", "\n  }\n");
    assert.doesNotMatch(offer, /label="Dismiss"[^>]*rail=icon\]\/rail:hidden/, "the rejoin offer hides Dismiss in the icon rail again");
    assert.match(player, /title=\{line \? `Return to \$\{title\}, \$\{line\}` : `Return to \$\{title\}`\}/);
  });

  it("the phone chip sits under the other room's measured header, and names the room it leaves", () => {
    const chip = block(player, "function RoomChip(", "\n}\n");
    assert.match(chip, /calc\(var\(--ws-topbar-h\) \+ var\(--ws-house-head-h\) \+ 8px\)/);
    const hangUp = block(player, "function HangUp(", "\n}\n");
    assert.match(hangUp, /`Leave \$\{title\}`/);
    assert.match(hangUp, /`Close \$\{title\}`/);
  });

  it("destructive confirmations share one sheet: Stay focused, the act in danger red", () => {
    const sheet = code("components/ui/destructive-confirm-sheet.tsx");
    /*
      FOCUS LANDS ON THE SAFEST THING PRESENT, which is Stay when Stay is the
      only way not to do the irreversible act — and is the SECONDARY when one
      exists, because then it is the safe answer and Stay is merely retreat.

      The sheet grew that third door when a host with a moderator needed to
      leave a room without closing it. Before that, "leave" and "close" were
      the same act for a host, so two buttons were the whole truth.

      What must never change: focus is never on the destructive button, and
      the destructive button is the only one in danger red.
    */
    assert.match(sheet, /autoFocus=\{!secondary\}/, "Stay must yield focus only to a SAFER option, never to the destructive one");
    assert.doesNotMatch(sheet, /bg-danger[^>]*autoFocus/, "the destructive act must never take focus");
    assert.match(sheet, /bg-danger text-white/);
    for (const path of [
      "components/layout/room-mini-player.tsx",
      "features/houses/components/house-header.tsx",
      "features/houses/components/house-room.tsx",
    ]) {
      assert.match(code(path), /<DestructiveConfirmSheet\b/, path);
    }
    assert.equal((player.match(/<DestructiveConfirmSheet\b/g) ?? []).length, 2);
    assert.match(player, /useEndStream\(\{ successMessage: "Gist room closed" \}\)/);
    assert.match(code("features/streams/hooks/use-streams.ts"), /toast\.success\(options\?\.successMessage \?\? "Stream ended"\)/);
  });

  it("touch keeps 44px targets at every width; only a fine pointer shrinks them", () => {
    const button = block(player, "function RoundButton(", "\n}\n");
    assert.match(button, /h-11 w-11[^"]*pointer-fine:h-9 pointer-fine:w-9/);
    assert.doesNotMatch(player, /md:h-9|md:w-9|md:min-h-9/);
  });

  it("floating placements respect the horizontal safe-area insets", () => {
    assert.match(player, /max\(24px, env\(safe-area-inset-left, 0px\)\)/);
    assert.match(player, /max\(24px, env\(safe-area-inset-right, 0px\)\)/);
    assert.match(player, /max\(12px, env\(safe-area-inset-right, 0px\)\)/);
    assert.match(player, /max\(12px, env\(safe-area-inset-left, 0px\)\)/);
  });

  it("the rejoin offer does not pulse like a live connection", () => {
    const offer = block(player, "if (offering && offer) {", "\n  }\n");
    assert.doesNotMatch(offer, /ws-live-dot/);
  });

  it("the room page offers Tap to listen when the browser refused autoplay", () => {
    const room = code("features/houses/components/house-room.tsx");
    assert.match(room, /here && connection === "live" && !session\.canPlayAudio/);
    assert.match(room, /onClick=\{session\.startAudio\}/);
  });
});

describe("a host never walks out of their own room live", () => {
  const code = (path: string) => stripComments(read(path));

  it("the Stream/Studio door closes a host's room (vacate), never a bare leave", () => {
    const guard = code("components/layout/gist-room-guard.tsx");
    assert.doesNotMatch(guard, /session\.leave\(\)/, "the guard disconnects a host and leaves their room live");
    assert.match(guard, /session\.vacate\(\)/);
    assert.match(guard, /hosting \? hostConfirmLabel : confirmLabel/);
    for (const screen of ["components/layout/stream-room-screen.tsx", "components/layout/studio-room-screen.tsx"]) {
      assert.match(code(screen), /hostConfirmLabel="Close and /, screen);
    }
  });

  it("the Ark exit sheet's Leave and go closes a host's room, and goes only once it has", () => {
    const guard = code("components/layout/zone-exit-guard.tsx");
    assert.doesNotMatch(guard, /session\.leave\(\)/);
    assert.match(guard, /void session\.vacate\(\)\.then\(\s*\(\) => target\.go\(\),/);
    assert.match(guard, /\{hosting \? "Close room and go" : "Leave and go"\}/);
  });

  it("the OS media hang-up is registered for a listener only", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /const hangUpAllowed = osHangUpAllowed\(presence\);/);
    assert.match(provider, /if \(hangUpAllowed\) \{\s*try \{\s*session\.setActionHandler\("hangup" as MediaSessionAction, \(\) => void leave\(\)\);/);
  });

  it("an explicit sign-out closes a host's room first", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /return isHost \? controller\.signOut\(\) : leave\(\);/);
  });
});

describe("a host's fresh open reaches the session whichever branch renders next", () => {
  const code = (path: string) => stripComments(read(path));

  it("Backstage enters the session with the ingest itself, before the cache flip can unmount it", () => {
    const backstage = code("features/houses/components/backstage.tsx");
    const openNow = block(backstage, "const openNow = () => {", "\n  };\n");
    // A per-call mutate onSuccess is dropped once the observer unmounts, and
    // go-live's own cache write is what unmounts it. The promise is not.
    assert.doesNotMatch(openNow, /goLive\.mutate\(/);
    assert.match(openNow, /goLive\s*\.mutateAsync\(stream\.id\)/);
    const enter = openNow.indexOf("session.enter(stream.id, \"host\", {");
    assert.notEqual(enter, -1, "the fresh open still travels through component state that can unmount");
    assert.match(openNow, /token: \{ url: result\.ingest\.url, token: result\.ingest\.roomToken \},\s*fresh: true,/);
    assert.ok(enter < openNow.indexOf("onOpened("), "the session hears of the open after the view that may already be gone");
  });
});

describe("a publish never outlives the Room or the provider it belongs to", () => {
  const code = (path: string) => stripComments(read(path));

  it("the host's opening publish drops a stale outcome and turns a stale capture off", () => {
    const provider = code("components/layout/room-session.tsx");
    const after = block(provider, "afterConnect: async (room, target, { resumed, isCurrent }) => {", "\n    },\n");
    assert.match(after, /if \(!isCurrent\(\)\) \{\s*await releaseCapture\(room\.handle\);\s*return;\s*\}/);
    assert.ok(after.indexOf("isCurrent()") < after.indexOf("onPublishRef.current(null)"));
    const failure = after.slice(after.indexOf("catch (error)"));
    assert.match(failure, /if \(!isCurrent\(\)\) \{\s*await releaseCapture\(room\.handle\);\s*return;\s*\}/, "a stale failure raises the banner on the current room");
    // …and a banner never follows the reader into another room.
    assert.match(provider, /if \(publishFailureFor !== streamId\) \{\s*setPublishFailureFor\(streamId\);\s*setPublishFailure\(null\);/);
  });

  it("the stage's Try again turns the mic back off when its Room has gone", () => {
    const stage = code("features/streams/hooks/use-stage.ts");
    const retry = block(stage, "const retry = useCallback(() => {", "}, [room, cameraAllowed, streamId]);");
    assert.match(retry, /if \(getRoom\(streamId\) !== room\) \{\s*await releaseCapture\(room\);\s*return;\s*\}/);
  });

  it("a provider that unmounts (global-error) mutes the mic it can no longer show", () => {
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /useEffect\(\s*\(\) => \(\) => \{\s*const held = controller\.room;\s*if \(held\) void stopPublishing\(held\);\s*\},\s*\[controller\]\s*\);/);
  });
});

describe("the session, not the SDK, and not a stale flag, says what the mic is doing", () => {
  const code = (path: string) => stripComments(read(path));

  it("a gist room's Room never disconnects itself on beforeunload; tab close is the controller's pageHide", () => {
    const connection = code("features/houses/hooks/use-house-connection.ts");
    assert.equal((connection.match(/disconnectOnPageLeave: false/g) ?? []).length, 2, "the host's and the listener's Room both");
    assert.match(connection, /new RoomClass\(\{ adaptiveStream: true, disconnectOnPageLeave: false \}\)/);
    assert.match(code("components/layout/room-session.tsx"), /const onPageHide = \(\) => controller\.pageHide\(\);/);
  });

  it("micOn is false with no Room, and reset with the Room it described", () => {
    const stage = code("features/streams/hooks/use-stage.ts");
    const reset = block(stage, "if (phaseRoom.streamId !== streamId || phaseRoom.room !== room) {", "\n  }\n");
    assert.match(reset, /setMicOn\(false\);/);
    assert.match(reset, /setCamOn\(false\);/);
    const result = block(stage, "  return {\n    state,", "\n  };\n");
    assert.match(result, /micOn: room \? micOn : false,/);
  });
});

describe("the surfaces every page shows name a private room neutrally", () => {
  const code = (path: string) => stripComments(read(path));

  it("the mini-player, the room chip, the hang-up and both guard sheets never print a private topic", () => {
    for (const path of [
      "components/layout/room-mini-player.tsx",
      "components/layout/zone-exit-guard.tsx",
      "components/layout/gist-room-guard.tsx",
    ]) {
      const source = code(path);
      assert.match(source, /sharedSurfaceTitle\(/, path);
      // Every topic read goes through the rule, and nothing else prints one.
      const unguarded = source.replace(/sharedSurfaceTitle\(([\w.]+), houseTopic\(\1\)\)/g, "");
      assert.doesNotMatch(unguarded, /houseTopic\(/, `${path} prints the raw topic`);
    }
    const provider = code("components/layout/room-session.tsx");
    assert.match(provider, /sharedSurfaceTitle\(stream\.data, houseTopic\(stream\.data\)\)/);
  });
});

describe("no touch-only words on surfaces a mouse uses", () => {
  const code = (path: string) => stripComments(read(path));

  it("the mini-player, its chip and the room page say Listen and Rejoin, not Tap to", () => {
    for (const path of ["components/layout/room-mini-player.tsx", "features/houses/components/house-room.tsx", "lib/room-session/visibility.ts"]) {
      assert.doesNotMatch(code(path), /Tap to (listen|rejoin)/, path);
    }
    const player = code("components/layout/room-mini-player.tsx");
    assert.match(player, /aria-label=\{roomChipLabel\(\{ title, text, finished: chrome\.finished \}\)\}/);
    assert.match(player, /const label = rejoinLabel\(offer\.title\);/);
  });
});

describe("the desktop mini-player card takes its own room", () => {
  const code = (path: string) => stripComments(read(path));
  const player = code("components/layout/room-mini-player.tsx");

  it("rings the shell with where it sits, and the shell stamps it", () => {
    assert.match(player, /setMiniCard\(cardMode\);\s*return \(\) => setMiniCard\("off"\);/);
    assert.match(player, /miniPlayerCardPlacement\(\{ chatOpen, roomBarUp: roomBar \}\)/);
    assert.match(code("components/layout/app-shell.tsx"), /data-mini-card=\{miniCard\}/);
  });

  it("reserves the card's height at the foot of every page, and in a thread's scroll top", () => {
    const css = read("app/globals.css");
    const foot = block(css, '[data-mini-card="foot"] {', "}");
    assert.match(foot, /--ws-mini-card-h: 80px;/);
    assert.match(foot, /--ws-nav-h: calc\(112px \+ var\(--ws-mini-card-h\)\);/);
    assert.match(block(css, '[data-mini-card="thread"] {', "}"), /--ws-thread-top-inset: 80px;/);
    // Before the room bar's rule, which still zeroes the foot.
    assert.ok(css.indexOf('[data-mini-card="foot"] {') < css.indexOf('[data-dock="room-bar"] {'));
    assert.match(code("features/messages/components/thread.tsx"), /pt-\[calc\(40px\+var\(--ws-thread-top-inset,0px\)\)\]/);
  });

  it("the card's own offset does not climb by the room it reserves, and clears a room's control bar", () => {
    const frame = block(player, "function Frame(", "\n}\n");
    assert.match(frame, /bottom: "calc\(var\(--ws-nav-h\) - var\(--ws-mini-card-h, 0px\) \+ 8px\)"/);
    assert.match(frame, /bottom: "calc\(var\(--ws-nav-h\) \+ 96px\)"/);
  });
});

describe("invite to speak and the host's soft mute, wired where no pure half exists", () => {
  const code = (path: string) => stripComments(read(path));
  const room = code("features/houses/components/house-room.tsx");
  const player = code("components/layout/room-mini-player.tsx");
  const banner = code("features/houses/components/invite-banner.tsx");
  const sheet = code("features/houses/components/person-sheet.tsx");
  const tray = code("features/houses/components/hand-tray.tsx");
  const tools = code("features/houses/hooks/use-host-stage-tools.ts");

  it("the minimised room carries the invitation from ONE placement, off the room's own page", () => {
    const shell = code("components/layout/app-shell.tsx");
    assert.equal((shell.match(/<RoomInviteBanner \/>/g) ?? []).length, 1);
    assert.match(player, /inviteBannerVisible\(\{ pathname, streamId, hasInvite: invite !== null \}\)/);
    assert.match(room, /\{here && !isHost && session\.invite && \(/);
  });

  it("both banners answer through the session and never touch a microphone", () => {
    for (const surface of [player, room]) {
      assert.match(surface, /onAccept=\{\(\) => session\.answerInvite\("accept"\)\}/);
      assert.match(surface, /onReject=\{\(\) => session\.answerInvite\("reject"\)\}/);
    }
    assert.doesNotMatch(banner, /getUserMedia|setMicrophoneEnabled|toggleMic/);
    assert.match(banner, /inviteView\(/, "the countdown reads the server's expiresAt");
  });

  it("the host's rows are decided in lib/, and there is no lock and no host unmute", () => {
    assert.match(tools, /inviteControl\(\{/);
    assert.match(tools, /hostMuteControl\(\{/);
    assert.match(tools, /toast\(hostOutcomeLabel\(gone\.name\)\)/);
    for (const surface of [sheet, tray, room, tools, player]) {
      assert.doesNotMatch(surface, /Mute and lock|Unlock mic|Ask to unmute|muteHard|unmuteSpeaker/);
    }
    // The hard-lock leftovers are gone, not dormant: no lock icon on the mic,
    // no `hard` host mute, no muteHard on the speaker-request row.
    assert.doesNotMatch(player, /IconLock|"lock"/);
    assert.doesNotMatch(code("lib/api/schemas.ts"), /muteHard/);
    assert.doesNotMatch(code("lib/mic-consent.ts"), /"hard"/);
  });

  it("the countdown is the invitation's own clock, never the join token's expiresAt", () => {
    assert.match(code("components/layout/room-session.tsx"), /const inviteExpiresAt = invitedRow\?\.inviteExpiresAt \?\? null;/);
    for (const surface of [player, room, banner]) assert.doesNotMatch(surface, /[^e]expiresAt[=}]/);
  });

  it("asking to speak when the host already invited you says nothing about a request", () => {
    const hooks = code("features/streams/hooks/use-streams.ts");
    assert.match(hooks, /if \(request\.status === "invited"\) return;\s*toast\.success\("Request sent to the host"\);/);
  });

  it("the countdown starts from when the session first saw the invitation, on both surfaces", () => {
    assert.match(code("components/layout/room-session.tsx"), /if \(inviteSeen\.id !== inviteId\) setInviteSeen\(\{ id: inviteId, at: mine\.dataUpdatedAt, offset: serverClockOffset\(\) \}\);/);
    for (const surface of [player, room]) assert.match(surface, /seenAt=\{(session\.)?invite\.seenAt\}/);
  });

  it("the host's invitations are remembered per stream, outside the room page, and settled on approved rows", () => {
    assert.match(code("features/streams/lib/invite-memory.ts"), /const memories = new Map<string, InviteMemory>\(\);/);
    assert.match(tools, /const memoryFor = inviteMemoryFor;/);
    assert.match(tools, /const shown = visibleInvites\(step\.tracked, now\);/);
    assert.doesNotMatch(tools, /useRef<TrackedInvite/);
    assert.match(room, /const seatedRows = useSeatedSpeakers\(stream\.id, isHost && stream\.status === "live"\);/);
    assert.match(code("features/streams/lib/api.ts"), /\{ status: "approved" \}/);
  });

  it("an answer lands in the cache at once, and a closed invitation is not an error toast", () => {
    const hooks = code("features/streams/hooks/use-streams.ts");
    const answer = hooks.slice(hooks.indexOf("export function useAnswerInvite"), hooks.indexOf("export function useMuteSpeaker"));
    assert.match(answer, /resolveSpeakerRequest\(room, requestId, action\)/);
    assert.match(
      answer,
      /const landing = answerLanding\(\{ room, currentRoom: streamId, action, status: row\.status \}\);[\s\S]*?queryClient\.setQueryData\(\["ms", "stream", landing\.room, "speaker-request", "me"\], row\);[\s\S]*?if \(landing\.hint\) toast\(INVITE_ACCEPTED_HINT\);/
    );
    assert.doesNotMatch(answer, /\["ms", "stream", streamId,/, "an answer never lands under the session's current room");
    const resolve = hooks.slice(hooks.indexOf("export function useResolveSpeakerRequest"));
    assert.match(resolve, /if \(quietResolveError\(error as ApiErrorLike, action\)\) \{/);
  });

  it("the session latches an answer before sending it, so a double tap sends one", () => {
    const session = code("components/layout/room-session.tsx");
    assert.match(session, /const \[answerLatch\] = useState\(createAnswerLatch\);/);
    assert.match(
      session,
      /if \(!inviteId \|\| !streamId \|\| !answerLatch\.claim\(inviteId\)\) return;\s*setAnsweredInviteId\(inviteId\);[\s\S]*?const answer = inflightAnswers\.track\(inviteId, action, answerInviteAsync\(\{ requestId: inviteId, action, room: streamId \}\)\);\s*void answer\.settled\.then\(\(row\) => \{\s*if \(!row\) answerLatch\.release\(inviteId\);/
    );
    assert.match(session, /useEffect\(\(\) => \{\s*answerLatch\.follow\(inviteId\);\s*\}, \[answerLatch, inviteId\]\);/);
  });

  it("every leave releases the seat through releaseOnLeave, pinned to the room being left, so an accept in flight is not answered reject", () => {
    const session = code("components/layout/room-session.tsx");
    const release = block(session, "const releaseSeat = useCallback(", "]);");
    assert.match(release, /void releaseOnLeave\(\{\s*row: myRow,\s*inflight: inflightAnswers\.current\(\),/);
    assert.match(release, /send: \(requestId, action\) => resolveMutate\(\{ requestId, action, room \}\),/);
    assert.doesNotMatch(session, /releaseActionFor\(mine\.data/, "the stale row alone must not decide a leave");
    for (const verb of ["const leave = useCallback(", "const confirmConflict = useCallback(", "const vacate = useCallback("]) {
      assert.match(block(session, verb, "]);"), /releaseSeat\(\);/, verb);
    }
    assert.match(code("features/streams/hooks/use-streams.ts"), /resolveSpeakerRequest\(room \?\? streamId, requestId, action\)/);
  });

  it("a host's tap on an undeployed mute or invite is answered, not swallowed", () => {
    const hooks = code("features/streams/hooks/use-streams.ts");
    const mute = hooks.slice(hooks.indexOf("export function useMuteSpeaker"));
    assert.match(mute, /if \(failure\.unavailable\) \{[\s\S]*?setUnavailable\(true\);\s*toast\(failure\.message\);\s*return;/);
    const invite = hooks.slice(hooks.indexOf("export function useInviteToSpeak"), hooks.indexOf("export function useAnswerInvite"));
    assert.match(invite, /if \(outcome\.kind === "unavailable"\) \{[\s\S]*?setUnavailable\(true\);\s*toast\(outcome\.message\);\s*return;/);
  });

  it("the page's one socket carries the reader's token, or user:<did> is refused and no speaker signal arrives", () => {
    const shared = code("lib/ws-gateway-shared.ts");
    assert.match(shared, /import \{ getAccessToken \} from "@privy-io\/react-auth";/);
    assert.match(shared, /createGateway\([\s\S]*\{\s*getToken: \(\) => getAccessToken\(\),\s*\}\)/);
    // The token is a frame on the open socket, never a query string an access log would keep.
    const client = code("lib/ws-gateway.ts");
    assert.doesNotMatch(client, /searchParams\.set\("token"/);
    assert.match(client, /open\(url\);/);
    assert.match(client, /send\(\{ type: "authenticate", token \}\);/);
    const session = code("components/layout/room-session.tsx");
    assert.match(session, /sharedGateway\(\)\.subscribe\(myTopic,/);
  });

  it("the listener's own tool says it is theirs alone", () => {
    assert.match(sheet, /"Mute for me only"/);
    assert.match(code("features/profile/components/person-safety-rows.tsx"), /"Mute for me only"/);
  });

  it("the badge follows the seat's memory, not the attribute alone, and the toast reads the attribute's value", () => {
    const hook = code("features/streams/hooks/use-stage-slots.ts");
    assert.match(hook, /const badges = stepHostMuteBadges\(\s*hostMuteMemory\.get\(memoryKey\) \?\? new Map\(\),/);
    assert.match(code("components/layout/room-session.tsx"), /token: hostMuteToken\(local\.attributes\),/);
  });

  it("a listening house member opens the same person sheet, and shows the Invited ring", () => {
    const screen = code("components/layout/house-room-screen.tsx");
    assert.match(screen, /onOpen=\{stage\.onOpen\}/);
    assert.match(screen, /invitedIds=\{stage\.invitedIds\}/);
    assert.match(screen, /invited: invitedIds\.has\(profileId\),\s*onOpen: \(\) => onOpen\(profileId\),/);
    assert.match(room, /onOpen: openPresent,\s*invitedIds: isHost \? invitedIds : EMPTY_IDS,/);
  });

  it("the person sheet reads the live seat, not the snapshot it opened with", () => {
    assert.match(room, /<PersonSheet\s+person=\{livePerson\}/);
    assert.match(room, /hostActions=\{hostTools\.actionsFor\(livePerson\)\}/);
    assert.match(tools, /micMuted: seat \? seat\.isMuted : true,/);
  });

  it("the invitation is announced by the session alone, never by a surface that remounts", () => {
    const session = code("components/layout/room-session.tsx");
    assert.match(session, /<InviteAnnouncer\s/);
    assert.match(session, /const step = stepInviteAnnouncer\(spoken\.state, \{/);
    for (const surface of [player, room]) {
      assert.doesNotMatch(surface, /inviteAnnouncement/, "a surface is announcing the invitation again");
      assert.doesNotMatch(surface, /role="status"[^>]*>\s*\{visible \?/);
    }
  });

  it("the banner keeps focus in reach: busy is aria-disabled, focus is handed on to the page", () => {
    assert.doesNotMatch(banner, /(?<!aria-)disabled=\{busy\}/, "a disabled button drops its focus");
    assert.equal((banner.match(/aria-disabled=\{busy\}/g) ?? []).length, 2);
    assert.match(banner, /window\.setTimeout\(\(\) => returnFocus\(landing\), 0\)/);
    assert.match(banner, /handFocusOn\(document\.activeElement as HTMLElement \| null, document\.body, \[landing\]\)/);
  });

  it("someone the host blocked is never offered Invite to speak: hidden up front, not refused after a tap", () => {
    const screen = code("components/layout/house-room-screen.tsx");
    assert.match(screen, /inviteGateSlot=\{\(handle, row\) => <HideIfBlocked handle=\{handle\}>\{row\}<\/HideIfBlocked>\}/);
    const gate = code("features/profile/components/person-safety-rows.tsx");
    assert.match(gate, /export function HideIfBlocked\(/);
    assert.match(gate, /if \(!profile\.data \|\| profile\.data\.isBlocked\) return null;/);
    // Keyed on the account id when the token carried no username, so nobody the host blocked slips past the gate.
    assert.match(sheet, /const gateHandle = inviteGateHandle\(username, person\.identity\);/);
    assert.match(sheet, /gateHandle && inviteGateSlot \? inviteGateSlot\(gateHandle, inviteRow\) : inviteRow/);
    assert.ok((room.match(/inviteGateSlot=\{inviteGateSlot\}/g) ?? []).length >= 3, "the gate is not threaded to every LiveHouse and the sheet");
  });

  it("the sheet's host rows stay focusable, keep one invite toggle, and explain themselves at full contrast", () => {
    assert.doesNotMatch(sheet, /label="Cancel invitation"|label="Invite to speak"/, "invite and cancel are two elements again");
    assert.match(sheet, /\? "Cancel invitation" : "Invite to speak"/);
    const row = sheet.slice(sheet.indexOf("function HostRow"));
    assert.match(row, /aria-disabled=\{disabled\}/);
    assert.doesNotMatch(row, /(?<!aria-)disabled=\{disabled\}|disabled:opacity-50/);
    assert.match(row, /className="mt-0\.5 text-\[11px\] leading-4 text-grey-300"/);
    assert.match(row, /handFocusOn\(/);
  });

  it("the Invited rows: named, touch-sized, readable, and a Cancel hands focus on", () => {
    const group = code("features/houses/components/invited-group.tsx");
    assert.match(group, /aria-label=\{`Cancel invitation for \$\{name\}`\}/);
    assert.match(group, /aria-disabled=\{invited\.busy\}/);
    assert.match(group, /pointer-coarse:h-11 pointer-coarse:min-w-11/);
    assert.doesNotMatch(group, /text-meta/);
    assert.match(group, /handFocusOn\(/);
  });

  it("the tray's mute is named, touch-sized, and says why it is off in words, not a tooltip", () => {
    assert.match(tray, /aria-label=\{`Mute \$\{mute\.name\} for everyone`\}/);
    assert.doesNotMatch(tray, /title=\{mute\.control/);
    assert.match(tray, /\{mute\.control\.kind === "mute" && mute\.control\.disabled && \(\s*<span id=\{`mute-reason-\$\{item\.id\}`\} className="block text-\[11px\] leading-4 text-grey-300">\{mute\.control\.reason\}<\/span>/);
    assert.ok((tray.match(/pointer-coarse:h-11 pointer-coarse:min-w-11/g) ?? []).length >= 2, "Mute and Move down are not 44px on touch");
  });

  it("everyone sees who turned a mic off, straight from the seat", () => {
    assert.match(room, /mutedByHost: slot\.mutedByHost,/);
    assert.match(code("features/houses/components/room-people.tsx"), /person\.mutedByHost \? "Muted by host" : "Invited"/);
  });
});

describe("invite to speak and the soft mute, after review", () => {
  const code = (path: string) => stripComments(read(path));
  const room = code("features/houses/components/house-room.tsx");
  const player = code("components/layout/room-mini-player.tsx");
  const banner = code("features/houses/components/invite-banner.tsx");
  const sheet = code("features/houses/components/person-sheet.tsx");
  const tray = code("features/houses/components/hand-tray.tsx");
  const tools = code("features/houses/hooks/use-host-stage-tools.ts");
  const session = code("components/layout/room-session.tsx");
  const hooks = code("features/streams/hooks/use-streams.ts");
  const shell = code("components/layout/app-shell.tsx");

  it("every deadline the server writes is read on the server's clock, which the one transport records", () => {
    assert.match(code("lib/api/client.ts"), /recordServerDate\(response\.headers\.get\("date"\)\);/);
    assert.match(session, /offset: serverClockOffset\(\)/);
    assert.match(tools, /offsetMs: serverClockOffset\(\),/);
    for (const surface of [player, room]) {
      assert.match(surface, /createdAt=\{(session\.)?invite\.createdAt\}/);
      assert.match(surface, /clockOffsetMs=\{(session\.)?invite\.clockOffsetMs\}/);
    }
    assert.match(banner, /inviteView\(\{ id: requestId, status: "invited", inviteExpiresAt, createdAt \}, now, seenAt, clockOffsetMs\)/);
  });

  it("the invitation is drawn only off a row the session is still polling", () => {
    assert.match(session, /const invitedRow = liveInviteRow\(mine\.data, \{ polling, isHost \}\);/);
  });

  it("a failed Cancel brings the invitation back, even if the room page has gone", () => {
    assert.match(tools, /resolveMutateAsync\(\{ requestId, action: "cancel" \}\)\.catch\(/);
    assert.match(tools, /if \(cancelFailedForReal\(error as ApiErrorLike\)\) memoryFor\(streamId\)\.cancelled\.delete\(requestId\);/);
  });

  it("an invitation sent is tracked from the invite's own answer, and bans and cooldowns outlive the room page", () => {
    const invite = hooks.slice(hooks.indexOf("export function useInviteToSpeak"), hooks.indexOf("export function useAnswerInvite"));
    assert.match(invite, /held\.tracked = trackInvite\(/);
    assert.match(invite, /rememberBan\(inviteMemoryFor\(streamId\), userId\);/);
    assert.match(invite, /inviteMemoryFor\(streamId\)\.cooldowns\.set\(userId, until\);/);
    // Read live from the shared memory, never a copy taken at mount.
    assert.match(invite, /const refused: ReadonlySet<string> = memory\.refused;\s*const cooldowns: ReadonlyMap<string, number> = memory\.cooldowns;/);
    assert.doesNotMatch(invite, /new Set\(memory\.refused\)|new Map\(memory\.cooldowns\)/);
    // A chat ban hides the control before any tap; an ended invitation starts the cooldown the service started.
    const ban = hooks.slice(hooks.indexOf("export function useBanFromChat"), hooks.indexOf("const SPEAKER_POLL_MS"));
    assert.match(ban, /onSuccess: \(_result, userId\) => \{[\s\S]*?rememberBan\(inviteMemoryFor\(streamId\), userId\);/);
    assert.match(tools, /for \(const gone of step\.unavailable\) \{\s*memory\.ended\.add\(gone\.id\);[\s\S]*?rememberEndedInvite\(memory, gone\);\s*\}/);
    assert.doesNotMatch(tools, /const inviteMemory = new Map/);
  });

  it("a Not now on an ended invitation is quiet", () => {
    const answer = hooks.slice(hooks.indexOf("export function useAnswerInvite"), hooks.indexOf("export function useMuteSpeaker"));
    assert.match(answer, /answerErrorMessage\(error as ApiErrorLike, action\)/);
  });

  it("the Muted by host memory outlives a remount of the room page", () => {
    const slots = code("features/streams/hooks/use-stage-slots.ts");
    assert.doesNotMatch(slots, /useRef<ReadonlyMap<string, HostMuteBadgeState>>/);
    assert.match(slots, /hostMuteMemory\.get\(memoryKey\)/);
  });

  it("the invite row waits for a block check that succeeded, and is off for someone who left", () => {
    const gate = code("features/profile/components/person-safety-rows.tsx");
    assert.match(gate, /if \(!profile\.data \|\| profile\.data\.isBlocked\) return null;/);
    assert.match(room, /present: presentIds\.has\(base\)/);
    assert.match(tools, /present: person\.present,/);
  });

  it("the banner puts the question on its own line and the answers on theirs, and focus never lands on the mic", () => {
    assert.match(banner, /<p className="line-clamp-2 text-\[13px\] leading-5 text-heading">\s*<span className="font-bold">\{host\.name\}<\/span> invited you to speak\s*<\/p>/);
    assert.match(banner, /className="flex w-full items-center justify-end gap-2"/);
    assert.doesNotMatch(banner, /whitespace-pre|max-\[359px\]/);
    assert.doesNotMatch(banner, /data-room-mic/, "a held Enter on Join would open the mic");
    assert.match(banner, /handFocusOn\(document\.activeElement as HTMLElement \| null, document\.body, \[landing\]\)/);
  });

  it("the shell's invitation comes before <main> in reading order, above every sheet", () => {
    assert.match(shell, /<TopBar showBrand=\{!railOn\} wide=\{wide\} \/>\s*(\{\}\s*)?<RoomInviteBanner \/>/);
    assert.doesNotMatch(player, /placement === "phone" && <SessionInvite \/>/);
    // One placement rule for both surfaces (InviteBannerDock), over the sheet scrim's z-50.
    assert.match(banner, /className="fixed left-3 z-\[65\] md:left-auto md:w-\[400px\]"/);
    assert.match(code("components/ui/sheet.tsx"), /fixed inset-0 z-50 /);
    for (const surface of [player, room]) {
      assert.match(surface, /<InviteBannerDock\s/);
      assert.doesNotMatch(surface, /<InviteBanner\s|z-\[65\]/, "a second copy of the placement");
    }
    assert.match(room, /offset="var\(--ws-topbar-h\) \+ var\(--ws-crumb-h\) \+ var\(--ws-house-head-h\)"/);
    assert.match(player, /offset="var\(--ws-topbar-h\) \+ var\(--ws-crumb-h\)"/);
    // Clamped so the answers stay on a short screen (lib/speaker-invite.ts inviteDockStyle).
    assert.match(banner, /const place = inviteDockStyle\(offset\);/);
    assert.match(banner, /style=\{\{ top: place\.top, right: "max\(12px, env\(safe-area-inset-right, 0px\)\)" \}\}/);
    assert.match(banner, /style=\{\{ maxHeight: place\.maxHeight, overflowY: place\.overflowY \}\}/);
  });

  it("an open sheet never hides the invitation from assistive tech: it and its announcer render inside the dialog", () => {
    const sheetUi = code("components/ui/sheet.tsx");
    // The dialog is the full-screen layer, a column: the dock first, then the panel.
    assert.match(
      sheetUi,
      /<motion\.div\s+role="dialog"\s+aria-modal\s+aria-label=\{title\}\s+className="fixed inset-0 z-50 flex flex-col items-center justify-end outline-none sm:justify-center"/
    );
    assert.equal((sheetUi.match(/role="dialog"/g) ?? []).length, 1, "one dialog element, the layer");
    const layerStart = sheetUi.indexOf('role="dialog"');
    const dockAt = sheetUi.indexOf("<div ref={setDock}", layerStart);
    assert.ok(dockAt > layerStart, "the dock is inside the dialog");
    assert.ok(dockAt < sheetUi.indexOf("bg-black/70", layerStart), "first child: read and tabbed to before the sheet");
    assert.ok(dockAt < sheetUi.indexOf("<motion.div", layerStart + 1), "stacked above the panel, not over it");
    assert.match(sheetUi, /<div ref=\{setDock\} className="relative z-20 w-full shrink-0 sm:max-w-md" \/>/);
    assert.match(sheetUi, /useModalHost\(dock, open\);/);
    assert.match(sheetUi, /max-h-\[85dvh\] min-h-0 /, "the panel shrinks to make room for a docked banner");
    const layer = code("components/ui/modal-layer.tsx");
    assert.match(layer, /const content = typeof children === "function" \? children\(host !== null\) : children;/);
    assert.match(layer, /return host \? createPortal\(content, host\) : <>\{content\}<\/>;/);
    // Docked, the banner is in flow above the panel: no fixed position over the sheet's header.
    const dock = banner.slice(banner.indexOf("export function InviteBannerDock"), banner.indexOf("export function InviteBanner({"));
    assert.match(dock, /<AboveModals>\s*\{\(docked\) =>\s*docked \? \(\s*<div className="px-3 pb-2 pt-\[max\(12px,env\(safe-area-inset-top\)\)\] sm:px-0">\{body\}<\/div>/);
    assert.match(
      code("components/layout/room-session.tsx"),
      /<AboveModals>\s*<p role="status" aria-live="polite" className="sr-only">\s*\{spoken\.text\}\s*<\/p>\s*<\/AboveModals>/
    );
    // Answered inside a sheet, focus stays in that sheet rather than the inert page behind it.
    assert.match(banner, /dialog\.current = event\.currentTarget\.closest<HTMLElement>\('\[role="dialog"\]'\);/);
    assert.match(banner, /const landing = dialog\?\.isConnected \? dialog : main;/);
  });

  it("one tap on Invite to speak is announced once, by its toast: the sheet's hint is not a live region", () => {
    assert.doesNotMatch(sheet, /aria-live/);
    assert.match(code("features/streams/hooks/use-streams.ts"), /toast\(inviteSentMessage\(row\.status, name\)\);/);
  });

  it("the countdowns say what they count, and the answer on the wire shows and says so without disabling", () => {
    assert.match(banner, /<span className="tnum">\{inviteCountdownLabel\(view\.secondsLeft\)\}<\/span>/);
    assert.match(code("features/houses/components/invited-group.tsx"), /<span className="tnum">\{invitedCountdownLabel\(\(entry\.deadline - now\) \/ 1000\)\}<\/span>/);
    assert.match(banner, /<p role="status" className="sr-only">\s*\{sending\?\.status \?\? ""\}\s*<\/p>/);
    assert.match(banner, /busy && tapped === "accept" \? <BusyLabel label=\{answerBusyCopy\("accept"\)\.label\} \/>/);
    assert.match(banner, /busy && tapped === "reject" \? <BusyLabel label=\{answerBusyCopy\("reject"\)\.label\} \/>/);
    assert.doesNotMatch(banner, /\sdisabled=|loading=/, "a disabled button drops focus");
  });

  it("the tray's disabled mute is described by its reason, host rows are 44px, and the seat chip is readable", () => {
    assert.match(tray, /aria-describedby=\{mute\.control\.kind === "mute" && mute\.control\.disabled \? `mute-reason-\$\{item\.id\}` : undefined\}/);
    assert.match(tray, /<span id=\{`mute-reason-\$\{item\.id\}`\} className="block text-\[11px\] leading-4 text-grey-300">/);
    const row = sheet.slice(sheet.indexOf("function HostRow"));
    assert.match(row, /min-h-11 flex-col justify-center/);
    const people = code("features/houses/components/room-people.tsx");
    assert.doesNotMatch(people, /text-\[9px\]/);
    assert.match(people, /text-\[11px\] font-bold leading-4/);
  });
});

describe("A notification can reach a phone's lock screen", () => {
  /*
    Web push was built end to end on both sides and could not work on an
    iPhone, because iOS delivers a push only to a Home Screen app and a site
    with no manifest cannot be installed as one. These pin the two halves of
    that fix, and the reason each has to carry the build's prefix.
  */
  it("ships a manifest whose scope is the build's, not the origin's", () => {
    const manifest = stripComments(read("app/manifest.webmanifest/route.ts"));
    // Inside Ark the Square is a zone beside WSWS on one origin. A manifest
    // claiming "/" would let the installed app swallow WSWS's pages.
    assert.match(manifest, /scope: SQUARE_BASE === "" \? "\/" : `\$\{SQUARE_BASE\}\/`/);
    assert.match(manifest, /start_url: sq\("\/"\)/);
    assert.match(manifest, /id: sq\("\/"\)/);
    // `standalone` is what makes iOS hand the tile a notification permission.
    assert.match(manifest, /display: "standalone"/);
  });

  it("links the manifest through the prefix, not at the origin root", () => {
    /*
      Next's `app/manifest.ts` convention writes the link tag ITSELF, always as
      href="/manifest.webmanifest" and always winning over `metadata.manifest`.
      Inside Ark that is WSWS's origin root. The body was right and the link
      pointed elsewhere — invisible in the source, visible in the built HTML.
      A route handler serves the same URL and emits no tag.
    */
    assert.ok(
      !existsSync(new URL("../app/manifest.ts", import.meta.url)),
      "app/manifest.ts would re-add an unprefixed <link rel=manifest>"
    );
    assert.match(
      stripComments(read("app/manifest.webmanifest/route.ts")),
      /export function GET\(\): Response/
    );
    const layout = stripComments(read("app/layout.tsx"));
    assert.match(layout, /manifest: asset\("\/manifest\.webmanifest"\)/);
    assert.match(layout, /appleWebApp: \{\s*capable: true/);
  });

  it("draws the maskable icon separately from the square one", () => {
    // Android crops a maskable icon to the launcher's shape, so a mark sized
    // for a square tile loses its corners. One file cannot be both.
    const manifest = stripComments(read("app/manifest.webmanifest/route.ts"));
    assert.match(manifest, /icon-maskable-512\.png[\s\S]*purpose: "maskable"/);
    assert.doesNotMatch(manifest, /purpose: "any maskable"/);
  });

  it("tells an iPhone in a tab the step that unlocks push", () => {
    // Otherwise the row reads "this browser can't show push notifications",
    // which is untrue of the phone and names no way forward.
    const push = stripComments(read("lib/push.ts"));
    assert.match(push, /if \(!input\.supported && input\.ios && !input\.standalone\) return "needs-install";/);
    const hook = stripComments(read("features/settings/hooks/use-push.ts"));
    assert.match(hook, /navigator as Navigator & \{ standalone\?: boolean \}/);
  });
});

describe("A phone can be told what it may be woken for", () => {
  /*
    Fifteen kinds shared one switch, so a phone that buzzed for a comment
    buzzed for a DM — and the way people fix that is by revoking the
    permission in the OS, which they never grant again. These pin the shape of
    the fix, whose whole point is that it does NOT enumerate kinds.
  */
  it("never re-derives which bucket a kind belongs to", () => {
    // The service sets `group` on every row precisely so the client does not.
    // A map here would silently drop every kind added after it shipped, which
    // is the failure already shipped three times in the other direction.
    const groups = stripComments(read("lib/notification-groups.ts"));
    assert.doesNotMatch(groups, /tip_received|comment_reply|stream_live|speaker_invite/);
    const view = stripComments(read("components/layout/notifications-view.tsx"));
    assert.doesNotMatch(view, /tip_received|comment_reply|stream_live/);
  });

  it("keeps one list of buckets and one set of words for them", () => {
    // Two vocabularies is how the notifications page and Settings drift into
    // calling the same bucket different things.
    const types = stripComments(read("features/notifications/lib/types.ts"));
    assert.match(types, /export \{ NOTIFICATION_GROUPS, type NotificationGroup \} from "@\/lib\/notification-groups"/);
    assert.match(types, /z\.enum\(NOTIFICATION_GROUPS\)/);
    const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
    assert.doesNotMatch(page, /const GROUP_LABEL/, "the label map moved to the shared module");
    assert.match(page, /import \{ GROUP_LABEL \} from "@\/lib\/notification-groups"/);
  });

  it("treats the buckets as all-or-nothing, with no per-key default", () => {
    /*
      The service stores a boolean per group and always answers with all five.
      A partial object is a contract break; `?? true` would turn it into a
      switch reading ON while the service believed otherwise.
    */
    const settings = stripComments(read("features/settings/lib/types.ts"));
    const block = settings.slice(settings.indexOf("pushGroups"));
    assert.doesNotMatch(block.slice(0, 400), /\.optional\(\)[\s,]*\n?\s*(social|money|rooms|chat|account)/);
    for (const group of ["social", "money", "rooms", "chat", "account"]) {
      assert.match(block, new RegExp(`${group}: z\\.boolean\\(\\),`), `${group} must be required`);
    }
    const lib = stripComments(read("lib/notification-groups.ts"));
    assert.doesNotMatch(lib, /groups\[group\] \?\? true/);
    /*
      LOOSE, and it has to stay loose. This object is read and written back
      WHOLE, because the service refuses a partial one. A plain `z.object`
      strips a bucket it has not heard of, so a sixth would be read, dropped
      and then not sent — and every push-group save would 400 until the
      frontend caught up, arriving as "saving my notifications is broken".
    */
    assert.match(block, /pushGroups: z\s*\n?\s*\.looseObject\(/);
  });

  it("saves a bucket by replacing the whole set, never one key", () => {
    // A one-key patch would be the only partial `pushGroups` that ever
    // existed, and the optimistic merge would have to guess the other four.
    const hook = stripComments(read("features/settings/hooks/use-push.ts"));
    assert.match(hook, /pushGroups: \{ \.\.\.groups, \[group\]: next \}/);
  });
});

describe("Every notification kind has words of its own", () => {
  /*
    THE PROPERTY, NOT THE INSTANCE — the lesson three shipped bugs actually
    taught, kept in the suite rather than in a comment.

    `NotificationKindSchema` ends in `.catch("follow")`, so a kind this client
    has not heard of renders as "New Follower · X started following you". That
    is not hypothetical: `tip_received` shipped that way (a creator who had
    been PAID was told they had a new follower), then `wink`, then four kinds
    at once. Each was the service sending something our enum did not list.

    Listing a kind fixes the parse and leaves the SECOND half of the same bug
    open: a kind in the enum with no case in the copy falls to a default and
    reads as somebody else's event. This walks every kind in the enum and
    fails if either switch has nothing to say about it — so a kind added later
    fails here, rather than in somebody's notifications.
  */
  const kindsInEnum = () => {
    const types = stripComments(read("features/notifications/lib/types.ts"));
    const start = types.indexOf(".enum([");
    const end = types.indexOf("])", start);
    assert.ok(start > 0 && end > start, "the kind enum moved — this test must follow it");
    return [...types.slice(start, end).matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  };

  it("finds the kinds at all, so an empty list can never pass silently", () => {
    // A regex that matches nothing makes every assertion below vacuous. This
    // repo has shipped a find-and-replace that matched nothing and reported
    // success, past typecheck, lint, tests and build.
    const kinds = kindsInEnum();
    assert.ok(kinds.length >= 15, `expected the full enum, found ${kinds.length}`);
    for (const known of ["wink", "tip_received", "post_announced", "message"]) {
      assert.ok(kinds.includes(known), `${known} missing — the enum is not being read`);
    }
  });

  it("gives every kind a headline and a sentence", () => {
    const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
    const headline = page.slice(page.indexOf("function headline("), page.indexOf("function describe("));
    const describeFn = page.slice(page.indexOf("function describe("));
    for (const kind of kindsInEnum()) {
      assert.ok(headline.includes(`case "${kind}"`), `${kind} has no headline`);
      assert.ok(describeFn.includes(`case "${kind}"`), `${kind} has no sentence`);
    }
  });
});

describe("A house has its own page, the way a person does", () => {
  /*
    Tapping a house used to open a MODAL. A person's avatar goes to their
    profile, and ogazboiz asked for the same of a house (2026-09-23: "just
    like the way normal person avatar is taking me to his own profile") — a
    modal is a different gesture with a different meaning and no address you
    can send anybody.
  */
  it("navigates to the house rather than opening a sheet", () => {
    const card = stripComments(read("components/layout/house-directory-card.tsx"));
    assert.match(card, /href=\{sq\(`\/houses\/\$\{house\.id\}`\)\}/);
    assert.doesNotMatch(card, /role="button"/, "the card went back to being a modal trigger");
    /*
      JOINING IS A DECISION, NOT A LOOK — it must never also navigate. That was
      held by `stopPropagation` inside the anchor, which was the wrong tool
      twice over: an `<a>` may not contain a `<button>` at all (the browser
      rebuilds the tree, React reports a hydration mismatch), and
      stopPropagation halts React's synthetic bubbling rather than the anchor's
      own default navigation.

      It is now held STRUCTURALLY: the link is a transparent overlay and Join
      is its sibling painted above it, so the two controls never contain one
      another and no handler has to undo the other's behaviour.
    */
    assert.match(
      card,
      /<Link[\s\S]*?className="absolute inset-0 z-10/,
      "the card's link must be an overlay, not a wrapper around the Join button"
    );
    assert.ok(
      !card.includes("stopPropagation"),
      "Join is a sibling of the link now; cancelling propagation would be papering over nesting that is gone"
    );
    assert.ok(existsSync(resolve("app/houses/[id]/page.tsx")), "the house route is gone");
  });

  it("decides Join from View on the service's answer, never its own", () => {
    /*
      1285:36373 and 1285:36895 are ONE page in two states and the only
      difference is that button. `viewerIsMember` and `canJoin` come off the
      house read — a client that works out for itself who may join is a client
      that will eventually disagree with the service about it.
    */
    const screen = stripComments(read("components/layout/house-profile-screen.tsx"));
    assert.match(screen, /data\?\.viewerIsMember \?/);
    assert.match(screen, /disabled=\{!data\?\.canJoin \|\| join\.isPending\}/);
    assert.match(screen, /members !== null && \(/, '"0 members" can be claimed again');
  });

  it("leaves the sections it has no data for OUT, rather than empty", () => {
    /*
      The file also draws a members row, a website, a location, a
      gistrooms/week figure and a Replays rail. `GET /conversations/:id`
      carries none of them. A shelf captioned "Members" with nothing on it
      tells a reader the house has no members, which is a claim and a false
      one — so they are absent until the service ships the fields.
    */
    const screen = stripComments(read("components/layout/house-profile-screen.tsx"));
    // The weekly cap is still the one thing with no field behind it — and a
    // cap that displays but does not enforce is worse than no cap, so it waits
    // for the service rather than being drawn from a guess.
    assert.ok(!screen.includes("gistrooms/week"), "the cap is drawn with nothing behind it");
    /*
      REPLAYS DOES render, off `GET /streams?houseConversationId=&status=ended`
      — one house's history, server-side. The client-filtered version breaks on
      page two, which is exactly when a house has enough history for the rail
      to matter. Absent when the house has never opened a room: a heading over
      nothing says the house has no past, which is a claim.
    */
    assert.match(screen, /replays\.items\.length > 0 && \(/);
    /*
      AND ITS CONTROL IS DEAD. The file draws "Play now"; the media server runs
      the SFU alone with no egress, so no room that has ever ended here carries
      a `replayUrl`. A live-looking Play that cannot play is the promise the
      post card refuses to make, for the same reason.
    */
    assert.doesNotMatch(screen, />Play now</, "Replays offers a play that cannot play");
    /*
      Members DOES render, but only off a roster that was actually read.
      `GET /conversations/:id/members` is bearerAuth, so a signed-out reader
      and a stranger to a private house get nothing — and the section is then
      absent rather than an empty shelf, because "we may not see who is in
      here" and "nobody is in here" are different things.
    */
    /*
      ONE ROSTER, TWO SOURCES, AND THE MEMBERS ROUTE NOW WINS.

      This asserted the opposite — that the house read won — and the house read
      is the source that cannot carry a follow edge. Its roster is
      `.map(toSummary)` with no follow hydration, while `listMembers` calls
      `hydrateFollowState`, so a tile built from the house read renders
      "Follow" over somebody the reader already follows. It is also capped at
      four, a constant written for the inbox's avatar stack.

      So the route is preferred wherever it can answer, and the capped roster
      is the fallback for the one state the route cannot serve at all — a
      SIGNED-OUT or non-member reader of a public house, which is the state the
      design is drawn in. An empty array is still never read as "no members":
      a private house answers [] to everyone outside it and `memberCount`
      stays the truth.
    */
    assert.match(screen, /const fromHouse = house\.data\?\.members \?\? \[\];/);
    assert.match(
      screen,
      /fromRoute\.length > 0 \? fromRoute : fromHouse\.map/,
      "the members route must be preferred — it is the only source carrying isFollowing",
    );
    assert.match(
      screen,
      /viewerIsMember \|\| fromHouse\.length === 0/,
      "the route must be asked for a member, not only when the capped roster is empty",
    );
    assert.match(screen, /roster\.length > 0 && \(/);
    /*
      VIEW ALL IS GATED ON THE SERVICE'S TOTAL, NOT ON THE LIST WE HOLD.

      It was `roster.length > 12` against a roster the service caps at four, so
      on a 246-member house the control could never appear. `memberCount` is
      not capped, and it is the only number that can answer "is there more than
      this row shows".
    */
    assert.match(screen, /const memberTotal = house\.data\?\.memberCount \?\? null;/);
    assert.match(screen, /hiddenMembers > 0 && \(/);
    assert.doesNotMatch(
      screen,
      /roster\.length > 12/,
      "gating View all on the held list hides it behind the service's own cap",
    );
    /*
      The badges are the file's exported nodes, not hand-drawn look-alikes, and
      the wink disc is WHITE 20% with a white face — the follow badge's solid
      white and accent glyph is a different badge's colouring.
    */
    const tile = stripComments(read("components/layout/house-member-tile.tsx"));
    for (const glyph of ["wink-face", "profile-tick", "profile-add"]) {
      assert.match(
        tile,
        new RegExp(`icons/house-members/\\$\\{name\\}|${glyph}`),
        `${glyph} must be the exported node`,
      );
    }
    assert.doesNotMatch(tile, /<circle\s/u, "the glyphs must not be hand-drawn SVG again");
    assert.match(tile, /bg-white\/20/, "the wink disc is white at 20%, not solid white");
    assert.doesNotMatch(
      tile,
      /shadow-\[0_2px_8px/,
      "effects is empty on both badge frames — the drop shadow was invented",
    );
    /*
      The three fields the service is adding are parsed ahead of it, all
      optional, so each section appears the moment its field does and the
      release is a backend deploy rather than a coordinated pair — the ordering
      that has bitten this app twice.
    */
    const houseLib = stripComments(read("features/messages/lib/house.ts"));
    for (const field of ["members", "website", "weeklyRoomLimit"]) {
      assert.ok(houseLib.includes(`${field}:`), `${field} is not parsed yet`);
    }
    // A cap of null is UNCAPPED, so there is no number and no default.
    assert.match(screen, /data\?\.weeklyRoomLimit != null && \(/);
    // The service counts on a ROLLING window and stores no timezone, so "this
    // week" would promise a Monday reset that does not exist.
    assert.ok(screen.includes("in any 7 days"), "the cap claims a calendar week");
    assert.ok(!screen.includes("this week"), "the cap claims a calendar week");
    /*
      NO AVATAR BESIDE THE NAME. The node draws one because its cover and its
      mark are two different images; a house here has exactly one `imageUrl`,
      so the node's own layout prints the same picture twice a few pixels apart
      (ogazboiz, 2026-09-23).
    */
    assert.doesNotMatch(screen, /size-\[72px\]/, "the hero is printing the banner twice");
  });
});

describe("Onboarding asks for notifications, now that one can arrive", () => {
  /*
    The row was drawn and DISABLED for months, on a good reason: nothing
    consumed the grant, and a browser gives a site exactly ONE notification
    prompt — Chrome and Safari never re-prompt after a dismissal. Spending it
    on a promise the product could not keep would have burned the real ask for
    ever. All three things it was waiting on now exist.
  */
  const flow = () => stripComments(read("components/layout/onboarding-flow.tsx"));

  it("asks, rather than showing a dead row", () => {
    assert.match(flow(), /onAsk=\{askNotify\}/, "the notifications row went back to being disabled");
    assert.doesNotMatch(flow(), /Push notifications aren't wired up yet/);
  });

  it("reads the deployment's key BEFORE spending the prompt", () => {
    /*
      A deployment with no VAPID key cannot deliver a push, so asking there
      would burn the one prompt for nothing. The key is read first and the row
      reports unsupported when there is none — which is the same reason the
      Settings row refuses to offer a switch that saves nothing.
    */
    const code = flow();
    const ask = code.slice(code.indexOf("const askNotify"));
    assert.ok(
      ask.indexOf("fetchVapidPublicKey") < ask.indexOf("subscribeThisBrowser"),
      "it subscribes before checking the deployment can deliver"
    );
    assert.match(ask, /if \(!key\) return setNotify\("unsupported"\);/);
  });
});

describe("Nobody is put in a house they did not agree to", () => {
  /*
    The service's own spec summarises `POST /conversations/:id/members` as
    "Add people to a group (any member may)" — so any member of any house can
    add anybody, silently, and the person finds out because a house has
    appeared in their inbox (ogazboiz, 2026-09-23: "adding someone to a group
    without their approval is wrong").
  */
  const chat = () => stripComments(read("components/layout/chat-view.tsx"));

  it("offers a relationship, not a badge, as the middle choice", () => {
    /*
      `verified` is granted by the platform — it says somebody is who they
      claim to be, not that you know them. A verified stranger adding you to a
      house is exactly the complaint, so the circle that gates it is who YOU
      follow.
    */
    assert.match(chat(), /addToHousesFrom === "following"/);
    assert.doesNotMatch(
      stripComments(read("features/settings/lib/types.ts")),
      /addToHousesFrom: z\.enum\(\["no_one", "everyone", "verified"\]\)/,
      "the house gate went back to a badge"
    );
  });

  it("is absent until the service enforces it", () => {
    /*
      An option that says somebody is protected while anybody can still add
      them is worse than no option: they would stop watching for it. So the
      whole section is gated on the field arriving.
    */
    assert.match(chat(), /addToHousesFrom !== undefined && onAddToHousesFromChange && \(/);
    assert.match(
      stripComments(read("features/settings/lib/types.ts")),
      /addToHousesFrom: z\.enum\(\["no_one", "everyone", "following"\]\)\.optional\(\)/
    );
  });

  it("says what happens instead of the add", () => {
    // Without it, "No one" reads as "never hear about a house again" rather
    // than "it waits for you".
    assert.match(chat(), /Everyone else has to ask/);
  });

  it("asks who may skip the asking, not who may reach you", () => {
    /*
      ogazboiz ruled that "No one" still lets a REQUEST through (2026-09-23):
      somebody you have never met can ask, and you decline. That is the kinder
      setting — a true "no one" would stop a friend inviting you to their own
      house — but it makes the heading "Who can add you to houses / No one" a
      lie, because people CAN still reach you. The heading names what the
      setting actually governs, and "No one" then means what it says.
    */
    assert.match(chat(), /Who can add you to houses without asking/);
  });
});

describe("Declining a request cannot take a house down with it", () => {
  /*
    THE REQUESTS TAB HOLDS TWO ANIMALS, AND ONE OF THE DECLINES IS DESTRUCTIVE.

    A CHAT REQUEST is the conversation itself: `requestState` and `requestedBy`
    are columns on the CONVERSATION, which is right for a DM, where the whole
    thread IS the request. So its decline DELETES the thread and every message
    in it, deliberately.

    A HOUSE INVITE is not that. The house is ordinary and accepted; what is
    pending is one person's SEAT. It has its own accept and decline, and that
    decline removes the seat and only the seat.

    `requestState` DOES NOT SEPARATE THEM — on a house invite it reads
    `accepted`, because the house is accepted. A renderer that switches on it
    sends a house down the DM path, where one person declining an unwanted
    invite deletes the house, its history and everybody else's membership.
    `kind` is the discriminator; this pins that it stays the discriminator.

    The second assertion is the one that survives a bad deploy. A group
    carrying `requestState: "pending"` is not a seat invite — it is something
    older that the seat-level decline does not understand — so it is refused
    rather than answered into the route that would take the house down. That
    refusal is why the group branch is safe to ship before the service does.
  */
  it("separates the two by kind, and refuses a group that is not a seat invite", () => {
    const page = stripComments(read("features/messages/components/messages-page.tsx"));

    // The call site delegates. An inlined, kind-blind check is the bug.
    assert.match(
      page,
      /tab === "requests" && answerable\(conversation, me\.data\?\.id\)/,
      "the requests row must ask `answerable`, which knows a house from a DM"
    );

    const helper = page.slice(page.indexOf("function answerable"));
    assert.match(
      helper,
      /kind === "direct"[\s\S]*?requestState === "pending" && conversation\.requestedBy !== viewerId/,
      "a direct request is still only answerable while IT is pending and is not mine"
    );
    assert.match(
      helper,
      /return conversation\.requestState !== "pending";/,
      "a group carrying requestState 'pending' is not a seat invite and must not reach decline"
    );
  });
});

describe("Answering a house invite lands everywhere the house is read", () => {
  /*
    THE CONTROL IS IN THE INBOX; THE HOUSE IS READ SOMEWHERE ELSE.

    `["ms", "house", <id>]` carries `viewerIsMember`, `memberCount` and
    `canJoin` — every one of which accepting an invite flips. Invalidating only
    the conversation lists leaves that entry cached, so somebody who accepts an
    invite and then opens the house is shown the stranger's view of it: a Join
    House button on a house they are already in, and a member count one short.

    The key is the CONVERSATION id, which is the id being answered, so one call
    covers both kinds. For a DM nothing is cached under it and the invalidation
    costs nothing — which is why it is unconditional rather than branched.
  */
  it("invalidates the house entry, not just the conversation lists", () => {
    const hooks = stripComments(read("features/messages/hooks/use-messages.ts"));
    const settle = hooks.slice(hooks.indexOf("const settle ="), hooks.indexOf("const accept ="));
    assert.match(settle, /queryKey: \["ms", "conversations"\]/);
    assert.match(
      settle,
      /queryKey: \["ms", "house", conversationId\]/,
      "accepting an invite must not leave the house showing Join House"
    );
  });

  /*
    "Accept" is right for a chat request and wrong for a house. Accepting a
    house puts you in a room with strangers who can see you from then on, and a
    button that hides that is the consent problem the tab exists to fix. The
    label names the thing that actually happens.
  */
  it("asks to JOIN A HOUSE rather than to accept something unnamed", () => {
    const page = stripComments(read("features/messages/components/messages-page.tsx"));
    assert.match(
      page,
      /conversation\.kind === "group" \? "Join house" : "Accept"/,
      "a house invite must not be answered by a button reading only Accept"
    );
  });

  /*
    WHO ADDED YOU IS THE HALF THAT DECIDES THE ANSWER.

    Which house is on the row already. Whether you recognise the PERSON is why
    you join or do not, and it is the only thing that makes a decline informed —
    the gate exists because strangers were adding people, so a row that cannot
    name the stranger has not closed the gap it was built for.

    Two things are pinned. The name comes from `invitedBy` and is a LINK, since
    "who is this?" is answered by looking rather than by guessing from a name.
    And a null inviter still renders a sentence: null is a real answer (you
    joined a public house yourself, or the membership predates the gate), not a
    missing field, so the line says what happened without naming anybody rather
    than vanishing and leaving the controls unexplained.
  */
  it("names the inviter, links them, and still speaks when there is none", () => {
    const page = stripComments(read("features/messages/components/messages-page.tsx"));
    assert.match(
      page,
      /href=\{sq\(profileHref\(conversation\.invitedBy\)\)\}/,
      "the inviter's name must be a link — you check who they are BEFORE accepting"
    );
    assert.match(
      page,
      /"You were added to this house"/,
      "a null inviter must still explain why the row is there"
    );
  });

  /*
    AND IT IS NEVER THE HOUSE'S OWNER WEARING THE INVITER'S NAME.

    `createdBy` is on the same object and is tempting as a fallback. Whoever
    adds you is often not whoever made the house, so that fallback prints a real
    person's name against something they did not do — worse than no name,
    because it is believable. The field is a profile so the row never has to
    resolve an id into a face and be tempted to resolve the wrong one.
  */
  it("takes the inviter from invitedBy alone, as a whole profile", () => {
    const types = stripComments(read("features/messages/lib/types.ts"));
    assert.match(types, /invitedBy: ProfileSchema\.nullable\(\)\.optional\(\)\.default\(null\)/);

    const page = stripComments(read("features/messages/components/messages-page.tsx"));
    const line = page.slice(page.indexOf("conversation.kind === \"group\" && ("));
    const controls = line.slice(0, line.indexOf("requests.accept.mutate"));
    assert.ok(
      !controls.includes("createdBy"),
      "the inviter line must not fall back to the house's creator"
    );
  });
});

describe("An ended room says how many came, and never guesses", () => {
  /*
    NO DEFAULT ON `joined`, AND THAT IS THE ENTIRE DESIGN OF THE FIELD.

    It is carried on the single-room read of an ENDED room and nowhere else:
    absent while the room is live, where `viewerCount` is the honest field
    because the number is still moving, and absent on list rows, where a count
    per card is the query that read exists to avoid.

    Give it `.default(0)` and every one of those absences renders "0 joined" —
    a room nobody came to — on the two surfaces where the number is merely
    unavailable. That is a lie told confidently, and it is the same mistake
    `viewerCount` already carries a comment about: a default turns "we do not
    know" into a specific, wrong claim.
  */
  it("carries no default, so an absent count cannot read as nobody came", () => {
    const schemas = stripComments(read("lib/api/schemas.ts"));
    assert.match(schemas, /joined: z\.number\(\)\.optional\(\),/);
    assert.ok(
      !/joined: z\.number\(\)[^,\n]*\.default\(/.test(schemas),
      "defaulting `joined` prints 0 joined on every live room and every list row"
    );
  });

  /*
    And the card reads it as a NUMBER, not as a truth. A room nobody joined
    really is 0 and should say so; absent is the different case and draws
    nothing. `joined && ...` collapses those two into one, hiding the honest
    zero and keeping the card silent about a real measurement.
  */
  it("tells a measured zero from an absent count", () => {
    const card = stripComments(read("features/feed/components/room-post-card.tsx"));
    assert.match(
      card,
      /typeof data\?\.joined === "number"/,
      "a truthiness test would hide a room that genuinely had nobody join"
    );
  });

  /*
    IT IS STILL NOT `peakViewers`. Peak is the most people in the room at once;
    joined is how many came at all. Fifty people passing through in ones and
    twos peaks at three. The card went without this number for a release rather
    than print peak under the word "joined", and this holds that line.
  */
  it("never prints peakViewers under the word joined", () => {
    const card = stripComments(read("features/feed/components/room-post-card.tsx"));
    assert.ok(
      !card.includes("peakViewers"),
      "peak is not joined — they answer different questions and differ wildly"
    );
  });
});

describe("A room's chat reaches a post as COMMENTS, not as an overlay", () => {
  /*
    It used to be drawn beside the comments and labelled, because it was not
    one: no comment id, so nothing could reply, and after the room ended it sat
    frozen next to a live thread. ogazboiz overruled that — "it should be like
    normal comment even though it has ended they can reply" — and the label was
    the tell. It was me papering over second-class rows.

    The service now writes each line of a public room's chat as an ORDINARY
    comment on the announcement post. So replies nest, likes work, the count is
    right, and nothing outlives the room because nothing was tied to it.

    ─── WHICH MEANS THIS CLIENT HAS NOTHING TO SAY ABOUT IT ─────────────────────
    No component, no gate, no label. A comment is a comment. The judgement about
    whether a room's words may be public lives once, on the service, in the same
    `signalableRoom` that gates the socket topic — and a ticketed or private
    room writes nothing, so the four access rules survive because only what
    anyone could already read ever moves.

    This test exists to keep the deletion deleted. Re-adding a client-side
    overlay would put that judgement in two places, and the second one is the
    one that drifts.
  */
  it("draws no room-chat overlay of its own", () => {
    assert.equal(
      existsSync(resolve("features/feed/components/room-chat-excerpt.tsx")),
      false,
      "the overlay came back; a room's chat reaches a post as comments now"
    );
    for (const surface of [
      "features/feed/components/comments-sheet.tsx",
      "features/feed/components/post-detail-page.tsx",
      "features/feed/components/post-card.tsx",
      "features/feed/components/room-post-card.tsx",
    ]) {
      const source = stripComments(read(surface));
      assert.ok(!source.includes("RoomChatComments"), `${surface} draws the room's chat itself again`);
      assert.ok(
        !source.includes("mayShowRoomChat"),
        `${surface} re-decides what the service already decided`
      );
    }
  });

  /*
    The predicate itself STAYS, and its tests with it. It is the client's copy
    of the rule the service gates on, and it still answers the other question:
    whether a room may be announced on the public socket topic. Deleting it
    with the overlay would have taken that with it.
  */
  /*
    ONE RULE SURVIVES, AND ONLY ONE. `maySignalRoomChat` still answers whether
    a room may be ANNOUNCED on the public socket topic, which is live and has
    nothing to do with the overlay. Its twin went with the overlay: a reader
    with no caller is the exact shape this codebase has spent a day finding,
    and a test asserting the pair differed was protecting a function that
    existed only for the test.

    The sentence it was guarding — a member may READ a private house's chat
    and nobody may BROADCAST that it is busy — moved into the survivor's own
    comment, where the next person meets it rather than finding it in a test
    for something nothing calls.
  */
  it("keeps the one rule the socket topic still needs, and no twin", () => {
    const rules = stripComments(read("lib/room-chat-visibility.ts"));
    assert.ok(!rules.includes("mayShowRoomChat"), "a predicate with no caller came back");
    assert.match(rules, /export function maySignalRoomChat/);
    const signal = stripComments(read("features/streams/hooks/use-room-chat-signal.ts"));
    assert.match(signal, /maySignalRoomChat/, "the topic gate lost its rule");
  });
});

describe("A dead column is never rendered as a measurement", () => {
  /*
    `peakViewers` HAS NO WRITER. The column is created `NOT NULL DEFAULT 0`,
    set to 0 once when a stream is created, and never written again by any
    service, worker or sweeper — the only non-zero value in the repo is demo
    seed data. It is permanently 0 for every stream that has ever existed.

    It is not a field awaiting a feature. `total_view_seconds` sits in the SAME
    ROW, is read by the SAME route, is drawn in the SAME panel, and IS
    maintained on every heartbeat flush. One counter was kept and its
    neighbour forgotten. That is an omission, and until it is corrected the
    honest thing to draw is nothing.

    The host's post-live panel was the worst instance: `getStats` returns
    `stream.peakViewers` off the row while `uniqueViewers` is computed live, so
    hosts were shown peak 0 beside a real unique count — arithmetically
    impossible, on their own stream, where they are the one person positioned
    to know it is nonsense.
  */
  it("draws no Peak viewers tile while nothing writes the column", () => {
    const panel = stripComments(read("features/streams/components/post-live.tsx"));
    assert.ok(
      !/Peak viewers/.test(panel),
      "peakViewers has no writer — a tile for it states a measurement that was never taken"
    );
    assert.ok(
      !panel.includes("peakViewers"),
      "and it is not read at all here, so nobody can reintroduce the tile from a local variable"
    );
  });

  /*
    THE TWO FEED SITES STAY AS THEY ARE, and this pins WHY rather than freezing
    them by accident. Both guard with `> 0`, so against a permanently-zero
    column they render nothing and no wrong number has ever reached a feed.
    That guard was written because "peak 0 viewers" is silly copy, not because
    anyone knew the column was dead — but it is the correct behaviour either
    way, and it means both surfaces light up on their own the day something
    writes the column. Removing the guard would publish the zero.
  */
  it("keeps the feed's peak lines guarded, so a dead zero never prints", () => {
    for (const file of [
      "features/feed/components/featured-arena.tsx",
      "features/feed/components/feed-cards.tsx",
    ]) {
      const source = stripComments(read(file));
      assert.match(
        source,
        /peakViewers > 0/,
        `${file} must not print peak unguarded — the column is permanently 0`
      );
    }
  });
});

describe("Moving somebody down finishes the host's errand", () => {
  /*
    The triage sheet closes on Move down and STAYS OPEN on approve, and the
    asymmetry is about what the host came to do.

    Approve and decline are queue work: a list of raised hands the host is
    working through, so closing after each one would make them reopen the sheet
    for the next person. The sheet is the workspace.

    Move down is not queue work. It is one corrective act on somebody already
    seated, and it is the reason the sheet was opened — after it there is
    nothing else here, and a sheet still covering the room is standing between
    the host and the room they are running.

    ON SUCCESS, NOT ON CLICK. Closing on the click would hide a failure: the
    row disappears behind a closing sheet while the person is still seated and
    the host believes otherwise. The hook toasts the error either way, but the
    sheet staying open is what puts the error where the control was.
  */
  it("closes the tray when a seated person is moved down, and only then", () => {
    const tray = stripComments(read("features/houses/components/hand-tray.tsx"));
    assert.match(
      tray,
      /action === "remove" \? \{ onSuccess: \(\) => onClose\(\) \} : undefined/,
      "Move down must close the sheet on SUCCESS, and approve must not close it at all"
    );
  });
});

describe("A slot's wrapper accepts whatever the slot may hold", () => {
  /*
    `meta` on the room header is a SLOT: the caller decides what goes in it,
    and the live room puts a face pile there — an `AvatarStack` whose every
    avatar is a `div`. It was wrapped in a `<p>`.

    A `<p>` may contain only phrasing content, so the browser CLOSES it early
    when a `div` arrives. The server serialises one tree, the browser parses a
    different one, and React reports a hydration mismatch on a page that had
    nothing wrong with its data. The nesting was the cause; the mismatch was
    only where it surfaced.

    Nothing about that line was ever a paragraph — it is one line of meta
    beside a title — and Tailwind's reset already zeroes a `<p>`'s margins, so
    the two render identically and there is no reason to prefer the one that
    constrains its own children.

    The rule this pins is general: a component that renders a caller-supplied
    node must wrap it in an element that can legally contain anything. Every
    other `<p>{slot}</p>` in the app takes a STRING, which is why this was the
    only one that broke.
  */
  it("does not wrap the room header's meta slot in a paragraph", () => {
    const header = stripComments(read("features/houses/components/house-header.tsx"));
    assert.ok(
      !/<p[^>]*>\{meta\}<\/p>/.test(header),
      "`meta` can hold a face pile, and a <p> cannot legally contain one"
    );
    assert.match(header, /<div[^>]*>\{meta\}<\/div>/, "the meta slot needs a wrapper that accepts flow content");
  });
});

describe("The room's chat signal carries no words", () => {
  /*
    ADR-0009's rule, applied to the room: a frame is a REFETCH SIGNAL and never
    content. Only the stream id is read out of `roomChatChanged`; the messages
    come from `GET /streams/:id/chat` whether the socket spoke or the interval
    ticked. That is what makes a forged or replayed frame cost one extra read
    instead of putting words on somebody's screen — and it is why the payload
    is not carried even though carrying it would be faster.

    The topic is PUBLIC (`market-square:stream:<id>`) rather than personal.
    Everyone in the room needs the same signal and the chat read is anonymous
    anyway; `user:<id>` is for what concerns one reader — an invitation, their
    own mute — and a room's chat is not that.
  */
  it("reads only the stream id off a chat frame", () => {
    const gateway = stripComments(read("lib/ws-gateway.ts"));
    const signal = gateway.slice(gateway.indexOf("export function roomChatSignalOf"));
    const body = signal.slice(0, signal.indexOf("\n}"));
    for (const field of ["text", "author", "message", "body", "authorId"]) {
      assert.ok(
        !body.includes(field),
        `roomChatSignalOf reads \`${field}\` off the frame — the socket must carry no content`
      );
    }
    assert.match(body, /frame\.data\.streamId/);
  });

  /*
    AND THE POLL STAYS THE FLOOR. Every realtime piece in this app is layered
    over a read that still works alone, so an unconfigured gateway, a refused
    socket and a dropped one are all invisible. A signal that REPLACED the
    interval would make a socket outage look like a dead room.
  */
  it("layers the signal over the interval rather than replacing it", () => {
    const chat = stripComments(read("features/streams/hooks/use-chat.ts"));
    assert.match(chat, /refetchInterval: enabled \? pollMs : false/, "the chat interval is the floor and must remain");
    const hook = stripComments(read("features/streams/hooks/use-room-chat-signal.ts"));
    assert.match(hook, /MARKET_FLAGS\.wsGatewayUrl/, "an unconfigured gateway must opt out entirely");
    assert.match(hook, /invalidateQueries\(\{ queryKey: \["ms", "stream", streamId, "chat"\] \}\)/);
  });
});

describe("A host leaving is told the truth about what happens next", () => {
  /*
    The room's exit makes a PROMISE — "your moderators keep the room open" —
    and the service is what keeps it. Verified there, not assumed: exactly
    three paths end a room (the orphan reaper, an account suspension, and an
    explicit end by the host or a moderator holding `canEndRoom`), and NONE of
    them fires because the host left. The seat sweeper reacts to a disconnect
    but only releases seats; it never touches the stream's status.

    ─── THE WORDING IS LOAD BEARING, WHICH IS WHY IT IS PINNED ─────────────────
    The reaper's grace window is measured from the LAST SIGHTING OF ANY
    PUBLISHER, not from the host's departure. So "a few minutes after the last
    person stops talking" is exact, and "five minutes after you leave" would be
    wrong every time somebody else is still speaking — which is precisely the
    case a host uses this door for.

    And the two branches must stay two. Appointing somebody a moderator does
    NOT put them on a microphone, so a moderator in the audience holds nothing
    open. Collapsing these into one cheerful line would have a host walk out of
    an empty stage believing the room survives, and then blame the feature
    rather than the silence.
  */
  it("does not promise the room survives merely because a moderator exists", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    const hint = room.slice(room.indexOf("label: \"Leave it running\""));
    const body = hint.slice(0, hint.indexOf("onClick"));

    assert.match(body, /someModeratorOnStage/, "the promise must turn on PUBLISHING, not on appointment");
    /*
      AND IT SAYS WHAT IT GRANTS. Leaving the room running hands the
      moderators the power to CLOSE it, which is a bigger sentence than "you
      left" and must be read before it is confirmed. A permission that changes
      without being stated is not one the host gave.
    */
    assert.match(body, /close it when everyone's done|close the room when everyone's done/,
      "the host must be told the moderators gain the power to close the room");
    assert.match(body, /stops talking/, "the window runs from the last speech, not from the host's exit");
    assert.ok(
      !/after you leave/i.test(body),
      "the grace window is measured from the last publisher, so it is never counted from the host leaving"
    );
  });

  /*
    And the safe door only exists when somebody can actually hold the room.
    Offered with no moderator at all it would be a way to abandon a room that
    then dies quietly, which is worse than the honest binary it replaced.
  */
  it("offers the door only when there is somebody to leave it with", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /isHost && hasModerators/, "leaving it running needs a moderator to leave it TO");
    /*
      THE GRANT IS ITS OWN ROUTE, never a side effect of appointing. The
      service's appoint is `ON CONFLICT DO NOTHING`, so re-posting somebody
      cannot raise the flag — which is what stops a client escalating a
      moderator by accident while merely re-adding them. Raising it is a
      deliberate PATCH, and the host leaves whether or not it lands.
    */
    assert.match(room, /grantEndRoom\.mutate\(moderatorIds \?\? \[\], \{\s*\n?\s*onSettled: \(\) => void leaveNow\(\),/,
      "the host must leave even when the grant fails");
  });
});

describe("The room says who is running it when the host is not", () => {
  /*
    The host KEEPS the title when they leave — they can come back and resume,
    which is the whole reason moderators exist here. So nothing about the
    roster changes: their HOST pill stays, their tile stays, and to everybody
    else the room looks exactly as it did while they were steering it.

    That is the gap this closes. Not a handover of the title, which would lock
    a host out of their own room over a dropped connection — just saying out
    loud that somebody else is at the wheel.
  */
  it("tells the room the host stepped out, and who is covering", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /The host stepped out\. Moderators are running the room\./);
    assert.match(room, /hostAway && !isHost/, "the host must not be told they have left a room they are in");
  });

  /*
    ─── A RECONNECT IS NOT A DEPARTURE ──────────────────────────────────────────
    A host whose connection blips leaves the roster for seconds and returns.
    Announcing that the instant it happens flashes "the host stepped out" at
    everybody over a hiccup, which makes a working room look like a failing
    one — worse than saying nothing at all.

    So absence must PERSIST before it is reported, while presence clears it
    immediately: coming back is never news that needs settling.
  */
  it("waits before believing it, and stops believing it at once", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /HOST_AWAY_AFTER_MS/, "absence must be timed, not instant");
    /*
      The reset lives in the effect's CLEANUP, not its body — that is what runs
      the instant `hostOnStage` flips back, so a returning host clears the
      notice at once AND the next departure is timed afresh rather than firing
      immediately on a stale flag. It also keeps the effect free of a
      synchronous setState, which cascades renders.
    */
    assert.match(
      room,
      /return \(\) => \{\s*\n?\s*window\.clearTimeout\(timer\);\s*\n?\s*setHostAway\(false\);/,
      "the host returning must clear it without waiting, from cleanup"
    );
    const delay = /HOST_AWAY_AFTER_MS = (\d+)_000/.exec(room);
    assert.ok(delay && Number(delay[1]) >= 5, "shorter than a reconnect and the notice fires on a hiccup");
  });

  /*
    And it reads the STAGE, not the record. Every stream has an owner; the
    question the room is asking is whether that person is currently in it.
  */
  it("asks whether the host is on the stage, not whether the room has one", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    const probe = room.slice(room.indexOf("const hostOnStage"));
    assert.match(probe.slice(0, probe.indexOf("]);")), /slots\.some/);
  });
});

describe("A granted power has a control that reaches it", () => {
  /*
    The host hands the closing to their moderators on the way out. For a while
    that grant was real on the server and unreachable in the app: every end
    control here was gated on `isHost`, so a moderator holding `canEndRoom`
    still saw "Leave Room", and leaving just left.

    ogazboiz found it by using it — "when the host leaves the moderator cant
    end the live". It is the same failure as a column nothing writes and a
    card nothing feeds, one more time: a capability with nothing on the other
    side of it.

    So the end control follows `canCloseRoom` — the host, OR a moderator who
    was given it — and never `isHost` alone.
  */
  it("routes the close control on the POWER, not on the office", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(room, /const canCloseRoom = isHost \|\| iCanEndRoom;/);
    assert.match(room, /leaveLabel=\{canCloseRoom \? "Close Room" : "Leave Room"\}/);
    assert.match(room, /confirmLabel=\{canCloseRoom \? "Close it" : "Leave"\}/);
    assert.match(room, /if \(canCloseRoom\) \{\s*\n?\s*endHouse\.mutate/);
  });

  /*
    AND IT READS THE PERSON'S OWN ROW. `moderatorIds` says who holds an
    appointment; it says nothing about what any of them may do. `canEndRoom` is
    per person, so believing the id list would give every moderator the host's
    closing — the exact escalation the separate PATCH route exists to prevent.
  */
  it("asks whether THIS moderator was given it, not merely whether they are one", () => {
    const room = stripComments(read("features/houses/components/house-room.tsx"));
    assert.match(
      room,
      /moderatorRows\.items\.some\(\(row\) => row\.profileId === myId && row\.canEndRoom\)/,
      "being a moderator is not the same as holding the closing"
    );
  });
});

describe("A count tap shows what the count is counting", () => {
  /*
    A number beside a control is a promise that something is behind it, and
    tapping one has to show that thing.

    The comment tally used to decide on the INLINE FIELD'S GEOMETRY: if the
    composer happened to be laid out with height, open the thread; otherwise
    reveal the composer. So on a post that HAD comments the tap offered a box
    to type in and never showed the comment already sitting there. ogazboiz hit
    it twice on his own profile and both times reported it as the button doing
    nothing — which was an accurate description of what he got.

    Revealing the field stays right when there is nothing to read: at zero,
    "be the first" is the only sensible answer. The rule is what is BEHIND THE
    NUMBER, never where a div happened to land.
  */
  it("opens the thread when there is something in it, and offers the field when there is not", () => {
    const card = stripComments(read("features/feed/components/post-card.tsx"));
    const tally = card.slice(card.indexOf("const onCommentTally"));
    const body = tally.slice(0, tally.indexOf("\n  };"));
    assert.match(body, /post\.commentCount > 0/, "the tap must ask what is behind the number");
    assert.ok(
      !/getBoundingClientRect/.test(body),
      "a control's behaviour must not depend on whether another element got laid out"
    );
    assert.match(body, /setReplyOpen\(true\)/, "an empty post still offers the field");
  });
});

/*
  READING A NOTIFICATION IS SOMETHING YOU DO, NOT SOMETHING ARRIVING DOES.

  The page marked EVERYTHING read on mount — `markRead.mutate(undefined)`,
  where undefined means all of them — so a reader who glanced at the top of the
  list lost every row below the fold they had never seen, and the badge then
  said nothing was waiting. ogazboiz: "i also see the one that i've not
  actually read i've not actually clicked, just the way normal notification
  actually works".
*/
describe("Notifications are read by opening them, not by opening the list", () => {
  const page = stripComments(read("features/notifications/components/notifications-page.tsx"));

  it("never clears the list as a side effect of arriving at it", () => {
    assert.doesNotMatch(
      page,
      /useEffect\([^)]*markRead/s,
      "mark-on-mount is the bug: being on screen is not being read",
    );
    assert.doesNotMatch(
      page,
      /acknowledged\.current/,
      "the once-per-arrival guard went with the effect it guarded",
    );
  });

  /*
    With the bulk effect gone the ordinary act has to do the work, and it did
    NOT before — the row's `<Link>` navigated and acknowledged nothing. The
    effect was covering for it.
  */
  it("marks the row the reader actually opened", () => {
    assert.match(
      page,
      /<Link\s+href=\{href\}[\s\S]*?onClick=\{\(\) => \{\s*if \(unread\) onMarkRead\(item\.id\);/,
      "tapping a notification must clear that one",
    );
    // The per-row dot and the friends-card path keep acknowledging as before.
    assert.equal((page.match(/if \(unread\) onMarkRead\(item\.id\);/g) ?? []).length, 2);
  });

  /*
    Clearing everything is a real thing to want — it is just not something
    navigation should do on somebody's behalf. Without an explicit control the
    badge would have become unclearable, which is its own bug.
  */
  /*
    THE COUNT AND THE ACTION MUST HAVE THE SAME SCOPE.

    Raised by the backend against this very control: if the label counted the
    TAB while the call cleared EVERYTHING, "Mark all read (3)" would take 40 —
    the hazard the mount effect committed silently, moved into a button that
    states a number.

    Checked on their side rather than trusted: `listForUser` filters the list
    by `kindsInGroup(group)` and computes `unreadCount(userId)` with NO group
    argument, and `markRead(userId, ids?)` clears everything when ids are
    omitted. Both global, so they agree and the number is the disclosure.

    This pins the client half — that the label reads the SAME `unread` value
    the global action is gated on, and never a per-tab figure derived here.
  */
  it("counts what it will actually clear", () => {
    assert.match(
      page,
      /const unread = notifications\.data\?\.pages\[0\]\?\.unreadCount \?\? 0;/,
      "the label's number is the service's global count, not one derived per tab",
    );
    assert.match(page, /if \(unread > 0\) markRead\.mutate\(undefined\);/);
    assert.doesNotMatch(
      page,
      /items\.filter\([^)]*readAt[^)]*\)\.length/,
      "a count derived from the loaded page would describe the tab and clear everything",
    );
    // And it says so outright rather than leaving a filtered reader to infer
    // the scope from a label that does not match the rows under it.
    assert.match(page, /not only the ones in this filter/);
  });

  it("offers the bulk action as a control, with its count", () => {
    assert.match(page, /const markAllRead = \(\) => \{/);
    assert.match(page, /Mark all read \(\{unread\}\)/);
    assert.match(page, /\{authenticated && unread > 0 && \(/, "no control when there is nothing to clear");
  });
});

/*
  A GROUP MESSAGE IS NOT A DIRECT MESSAGE.

  Both are recorded as `kind: 'message'` carrying only an actor, so the row
  said "Ada sent you a message" for a room of forty people. "You" is the claim
  that nobody else saw it, and answering a group as though it were private is a
  real way to be embarrassed by an interface. The field is parsed ahead of the
  service, so this reads no worse today and better on their deploy alone.
*/
describe("A message notification says which kind of conversation it came from", () => {
  const page = stripComments(read("features/notifications/components/notifications-page.tsx"));
  const types = stripComments(read("features/notifications/lib/types.ts"));

  it("parses the conversation ahead of the backend, all optional", () => {
    assert.match(types, /conversation: z/);
    assert.match(types, /kind: z\.enum\(\["direct", "group"\]\)/);
    assert.match(types, /\.default\(null\)\s*\n?\s*\.catch\(null\)/);
  });

  /*
    THE SAME BUG ONE KIND OVER. `mention` covers a post, a comment, a stream
    AND a group chat, and printed one sentence for all four — so being named
    in a private room of forty read exactly like being named in a public post.
  */
  it("says when a mention happened inside a group", () => {
    assert.match(page, /\$\{who\} mentioned you in \$\{item\.conversation\.title\}\./);
    assert.match(page, /\$\{who\} mentioned you in a group you are in\./);
    assert.match(page, /\$\{who\} mentioned you\./, "the public sentence is unchanged");
  });

  it("names the group, and still speaks when it cannot", () => {
    assert.match(page, /item\.conversation\?\.kind === "group" \? "New group message" : "New message"/);
    assert.match(page, /\$\{who\} messaged \$\{item\.conversation\.title\}\./);
    assert.match(page, /\$\{who\} sent a message to a group you are in\./);
    assert.match(page, /\$\{who\} sent you a message\./, "the direct sentence is unchanged");
  });

  /*
    An unknown kind must NOT fall back to "direct": that is the claim that
    nobody else saw it, and saying nothing beats saying the wrong one.
  */
  it("never guesses direct", () => {
    assert.doesNotMatch(page, /conversation\?\.kind === "direct"/);
  });
});

/*
  A PICKER IS A PANEL. THE CALLER OWNS WHETHER IT IS ON SCREEN.

  `EmojiPicker` renders the panel and nothing else — no trigger, no open state.
  The feed composer rendered it UNCONDITIONALLY, so a 240px `fixed` panel sat
  over the post box from the moment the sheet opened and a phone could not see
  the field it was typing into. It hid above the toolbar on desktop, which is
  why it shipped.

  The room's composer had it right all along, so this pins the shape rather
  than the markup: every caller gates the panel, and both dismiss it.
*/
describe("Every emoji picker has a trigger", () => {
  const composer = stripComments(read("features/feed/components/composer.tsx"));
  const chat = stripComments(read("features/streams/components/chat-panel.tsx"));

  it("is never mounted unconditionally in the feed composer", () => {
    assert.match(composer, /\{emojiOpen && \(\s*<EmojiPicker/);
    /*
      ONE mount, and the assertion above already proves that one is gated. A
      negative regex over the whole file matched the fix itself — the same
      over-broad shape that has bitten this suite before — so the precise
      claim is the count.
    */
    assert.equal(
      (composer.match(/<EmojiPicker\b/g) ?? []).length,
      1,
      "a second mount would not be covered by the guard above",
    );
    assert.match(composer, /aria-expanded=\{emojiOpen\}/, "the trigger states its own state");
  });

  it("closes on click-away, Escape and after a pick", () => {
    for (const source of [composer, chat]) {
      assert.match(source, /if \(event\.key === "Escape"\) setEmojiOpen\(false\);/);
      assert.match(source, /document\.addEventListener\("pointerdown", onDown\)/);
    }
    // Only the composer types INTO a field the panel covers on a phone.
    assert.match(composer, /setEmojiOpen\(false\);\s*\n\s*window\.requestAnimationFrame/);
  });
});

/*
  `PostText` RENDERS ITS OWN BLOCK ELEMENT, so nothing may wrap it in a <p>.

  Two surfaces did, and both were hydration errors: "In HTML, <p> cannot be a
  descendant of <p>". The house one was worse than invalid — a browser closes
  the outer paragraph at the inner one, so `line-clamp-6` landed on an EMPTY
  element and the description was never clamped at all, leaving a "Read more"
  button with nothing to reveal.
*/
describe("Nothing wraps PostText in a paragraph", () => {
  for (const file of [
    "features/profile/components/profile-page.tsx",
    "components/layout/house-profile-screen.tsx",
  ]) {
    it(`${file} gives it a block container, not a <p>`, () => {
      const source = stripComments(read(file));
      for (const match of source.matchAll(/<PostText/g)) {
        const before = source.slice(0, match.index);
        const opened = (before.match(/<p[\s>]/g) ?? []).length;
        const closed = (before.match(/<\/p>/g) ?? []).length;
        assert.equal(opened, closed, `PostText sits inside an unclosed <p> in ${file}`);
      }
    });
  }
});

/*
  THE BALANCE IS THE ONE NUMBER ON THE EARNINGS CARD, AND IT WAS THE THING CUT.

  The file draws 432:25745 as a single 741-wide row: an 80 image, a 131 button
  and 48 of padding — about 275 before a word. Built literally, a 390 phone left
  roughly 99px for the text, so "Available balance" wrapped onto two lines and
  the 32px figure truncated to "0..". Reported on device.

  A desktop frame's row is not a layout; it is that row AT 741.
*/
describe("The earnings balance card fits a phone", () => {
  const card = stripComments(read("components/layout/profile-earnings.tsx"));

  it("stacks below sm and is the file's row from sm", () => {
    assert.match(
      card,
      /ws-kash-card flex flex-col gap-4 rounded-\[20px\] px-5 py-4 sm:flex-row sm:items-center sm:px-6/,
      "the card must stack before it squeezes the balance",
    );
    assert.doesNotMatch(
      card,
      /ws-kash-card flex items-center gap-4/,
      "one unconditional row is what cut the figure",
    );
  });

  it("gives the button its own line on a phone, the node's pill from sm", () => {
    assert.match(card, /h-\[34px\] w-full shrink-0 items-center justify-center/);
    assert.match(card, /sm:w-auto sm:justify-start/);
  });

  it("spends less of a phone on gutters than a 741 column does", () => {
    assert.match(card, /flex flex-col gap-6 px-4 py-6 sm:px-8/, "32 either side is a wide column's gutter");
    // The art is decoration and the balance is not, so the art gives up width.
    assert.match(card, /h-16 w-16 shrink-0 object-contain sm:h-20 sm:w-20/);
  });
});

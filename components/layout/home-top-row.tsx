"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useGate } from "@/hooks/use-gate";
import { RailMenu } from "@/components/layout/app-shell";
import { ExploreSettingsMenu } from "@/components/layout/explore-settings-menu";
import { LocationSheet } from "@/components/layout/location-sheet";
import { IconHomeFilter, IconHomeFilterCaret } from "@/components/ui/home-icons";
import { IconTopSearch } from "@/components/ui/topbar-icons";

/**
 * THE HEAD OF HOME'S COLUMN — node 1295:142736, the 2026-09-12 Home.
 *
 * A 574 x 48 row: the search field (1295:142737) flexing beside a 67-wide
 * settings pill (1295:142740), 12 apart. The row is as wide as the column's
 * content, so the field takes what the pill leaves.
 *
 * ─── THE FIELD IS A LINK, NOT AN INPUT ───────────────────────────────────────
 * It looks like a field and it goes to Explore's search. Explore owns the query
 * state (`?q=` on `/discover`, read by `discover-screen`), and a second live
 * input here would be a second owner of the same string — the rule the top bar
 * followed before the chrome lost its search. The destination is the one that
 * field used: `/discover`. A room's spoken code no longer has a typed entry on
 * this page; `/code/<code>` still resolves, and the gap is reported rather
 * than papered over with an input the design does not draw.
 *
 * The file's numbers: transparent fill, a 0.68 `#FFFFFF` at 40% INSIDE stroke
 * at a full radius, 8 of side padding, the two drop shadows
 * (`0 5.45 6.81 -4.09` and `0 13.62 17.02 -3.4`, both black at 10%), the 16px
 * `vuesax/linear/search-normal` in `#6D6D6D`, and the placeholder in Geist
 * Medium 16/22 at -0.112 tracking in `#7A7A7A`.
 *
 * The node's copy is " Search Gistrooms, houses, friends..." with a LEADING
 * SPACE: the glyph and the text box touch (glyph 8..24, text from 24), so the
 * space is the file's gap. It is rendered as a 3.78px gap — a Geist Medium
 * 16px space at the node's tracking, measured in Chrome — rather than as a
 * character, so the copy is the words and nothing else.
 *
 * ─── WHY IT IS A CIRCLE, AND NOT THE FILE'S 67-WIDE PILL WITH A CARET ───────
 * The file draws a 67 x 48 pill holding a 24px gear and an 8 x 4 caret 23
 * apart. Built literally it reads badly, and the reasons are measurable:
 *
 *   · the GAP is 23 against a gear of 24 — two elements separated by the
 *     width of one of them read as two unrelated things sharing a box;
 *   · a 24px gear against a 4px hairline caret is about three times the
 *     visual weight on one side, with a hole between;
 *   · its glass rim disagreed with the search field's crisp 0.68 hairline
 *     12px away.
 *
 * So it is a 48 circle carrying the gear alone, on the field's own edge.
 * The caret carried no information a gear does not already carry — the menu
 * appearing IS the open state, and `aria-expanded` still says so to anybody
 * who cannot see it. ogazboiz asked for this directly ("that dropdown icon it
 * doesnt look good at all"); the sizes are a judgement, and CLAUDE.md is
 * explicit that the frame gives the content box while the whitespace is ours.
 *
 * ─── THE FILTER PILL'S GLASS ─────────────────────────────────────────────────
 * The node says `#7A7A7A` at 5% with Figma's GLASS effect, whose parameters the
 * API does not publish. The RENDER is the truth: an opaque near-black lens
 * (17 at the top edge to 30 at the bottom, on a 0–255 scale) with a rim that is
 * brightest top-left and bottom-right and gone on the other diagonal — the same
 * lens the top bar's bell measured in the same file. So it is `ws-glass-pill`
 * for the body and `ws-glass-rim` for the rim, both already matched to that
 * render, rather than a border the file does not draw. Geometry is the node's:
 * radius 36, padding 3/4/3/8, the 24px gear in `#D9D9D9` and the 8 x 4 white
 * caret 23 apart.
 *
 * It opens EXPLORE SETTINGS — node 1317:158022 (`ExploreSettingsMenu`, in
 * `RailMenu`'s `explore` panel), which ogazboiz named as the pill's dropdown
 * on 2026-09-12. It used to open the account menu. The panel is exploration
 * preferences, not an account, so it opens for everyone; its one live row,
 * "Explore location", gates a signed-out reader into sign-in on the tap, since
 * the sheet behind it writes `PATCH /me`.
 *
 * ─── THE OPEN STATE ──────────────────────────────────────────────────────────
 * The gist rooms page (1317:158078) draws the same pill PURPLE: `#9F5AFF` at
 * 9% under the same GLASS, the gear and the caret in `#9F65FD`, and the caret
 * turned to point UP (its export, 1317:158082, is 747:14031's path mirrored).
 * Two frames of one control in two states, and up-caret-plus-tint is what an
 * opened menu looks like — so that drawing is the pill's `aria-expanded`
 * state here, on every page it appears on, rather than a per-page colour.
 *
 * ─── THE HOUSES PAGE'S ROW ENDS IN A FILTER, NOT THE ACCOUNT ────────────────
 * 1368:2271 is the same row with a 64 x 48 FILTER pill at its right
 * (1368:2275): `#9F5AFF` at 9% under the same GLASS, padding 4/8, the 20px
 * `hugeicons:filter` and an 8 x 4 white caret 12 apart. `GET
 * /conversations/discover` takes `cursor` and `limit` and nothing else, so
 * there is no dimension to filter on yet: the pill is a real `disabled`
 * control with the reason on it, per the flagged-capability rule — visible
 * and inert, never a button that does nothing.
 */
export function HomeTopRow({
  trailing = "account",
  value,
  onChange,
}: {
  trailing?: "account" | "filter";
  /**
   * THE FIELD IS A REAL INPUT ON EVERY PAGE THAT DRAWS IT.
   *
   * It used to be a link into Explore on every surface but Home, so searching
   * from /pals threw you off /pals (ogazboiz: "why is the pal search taking
   * me to /discovery"). The page that owns the row owns the query and answers
   * it in place.
   *
   * The old worry — two live inputs fighting over one string — does not apply
   * across PAGES: Home, /pals, /houses and /gist-rooms are never on screen
   * together, and each keeps its own query, which is cleared by leaving.
   */
  value: string;
  onChange: (value: string) => void;
}) {
  const gate = useGate();
  const [locationOpen, setLocationOpen] = useState(false);

  const pill = (open: boolean) => (
    <span
      className={cn(
        "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[0.68px] transition-colors",
        // The FIELD's edge, not a second one. The two controls sit 12px apart
        // and used to carry different treatments — the field a crisp 0.68
        // hairline, this a glass rim matched to a Figma render, which on a
        // flat dark ground reads soft and muddy beside it. Two edges that
        // disagree at that distance is what the eye catches first.
        open
          ? "border-white/40 bg-[rgba(159,90,255,0.09)]"
          : "border-white/40 hover:border-white/55"
      )}
    >
      {/* A FILTER glyph, not a gear. The pill opens exploration preferences
          that narrow what the grid shows — that is filtering, and a settings
          cog beside a search field read as account settings, which it is not
          (ogazboiz, 2026-09-28). `IconHomeFilter` is the same mark the houses
          row's filter pill already uses, so the two surfaces now agree. */}
      <IconHomeFilter className={cn("h-5 w-5 shrink-0", open ? "text-[#9F65FD]" : "text-[#D9D9D9]")} />
    </span>
  );

  return (
    <div className="flex h-12 items-center gap-3">
      <div className="ws-press flex h-12 min-w-0 flex-1 items-center gap-[3.78px] rounded-2xl border-[0.68px] border-white/40 px-2 shadow-[0_5.45px_6.81px_-4.09px_rgba(0,0,0,0.1),0_13.62px_17.02px_-3.4px_rgba(0,0,0,0.1)] transition-colors focus-within:border-white/55">
          <IconTopSearch className="h-4 w-4 shrink-0 text-[#6D6D6D]" />
          <input
            type="search"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            aria-label="Search Gistrooms, houses, friends"
            placeholder="Search Gistrooms, houses, friends..."
            className="min-w-0 flex-1 bg-transparent text-[16px] font-medium leading-[22px] tracking-[-0.112px] text-white outline-none placeholder:text-[#7A7A7A] [&::-webkit-search-cancel-button]:appearance-none"
          />
          {(value ?? "").length > 0 && (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Clear search"
              className="ws-press shrink-0 rounded-full px-2 text-[13px] text-meta hover:text-white"
            >
              Clear
            </button>
          )}
        </div>

      {trailing === "filter" ? (
        <button
          type="button"
          disabled
          aria-label="Filter houses"
          title="Filtering houses needs a filter the directory doesn't offer yet"
          className="ws-glass-rim relative flex h-12 w-16 shrink-0 items-center justify-center gap-3 rounded-[36px] bg-[rgba(159,90,255,0.09)] px-2 py-1 text-white disabled:cursor-not-allowed"
        >
          <IconHomeFilter className="h-5 w-5 shrink-0" />
          <span className="relative h-[4px] w-[8px] shrink-0">
            <IconHomeFilterCaret className="absolute -left-px -top-px h-[6px] w-[10px]" />
          </span>
        </button>
      ) : (
        <RailMenu
          label="Explore settings"
          align="below"
          panel="explore"
          trigger={({ open, toggle }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-haspopup="dialog"
              aria-label="Explore settings"
              className="ws-press block shrink-0"
            >
              {pill(open)}
            </button>
          )}
        >
          {(close) => (
            <ExploreSettingsMenu close={close} onLocation={() => gate(() => setLocationOpen(true))} />
          )}
        </RailMenu>
      )}

      {/* The location sheet lives OUTSIDE the panel: the panel closes when
          the row is chosen, and a sheet inside it would close with it. */}
      {trailing === "account" && locationOpen && (
        <LocationSheet open onClose={() => setLocationOpen(false)} />
      )}
    </div>
  );
}

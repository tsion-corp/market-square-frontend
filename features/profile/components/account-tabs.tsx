"use client";

import { cn } from "@/lib/cn";

export type AccountTab = "posts" | "earnings" | "badges" | "gifts" | "replays" | "viewers";

export interface AccountTabDef {
  value: AccountTab;
  label: string;
  /**
   * Visible and inert, with the reason as its tooltip.
   *
   * The standing rule for a capability that does not exist yet: never delete
   * the tab (that silently loses the roadmap) and never leave it live (that
   * tells the reader a lie). A real `disabled` button — unclickable,
   * untabbable, announced — is the third option, and it is the one the chat
   * inbox's three inert tabs already use.
   */
  disabledReason?: string;
}

/**
 * THE ACCOUNT STRIP ON A PROFILE — node 468:35620.
 *
 * Earnings / Badges / Gift Gallery / Replays, then a full-bleed hairline. It
 * is NOT the Posts/Media/Streams/Activities strip further down the page: those
 * tabs switch what CONTENT you are reading, these switch what part of your
 * ACCOUNT you are looking at. The file draws both, in that order.
 *
 * ─── GEOMETRY, WHICH IS NOT A `justify-between` ─────────────────────────────
 * The row is 32 in from the left and 32 BETWEEN each tab, each tab a fixed
 * 101x38 at a full round with its label centred. That is a packed row with a
 * fixed gap, not a spread — the four tabs occupy 564 of the 805 frame and the
 * remaining 241 is empty at the right, which is what the file draws.
 *
 * ─── THE ACTIVE PILL IS THE GRADIENT, THE REST ARE HOLES ────────────────────
 * An inactive tab's fill is `#FFFFFF` at alpha ZERO — a transparent rectangle,
 * not a tinted one — and its label is white at 40%. The active tab takes the
 * purple ramp and its label goes to `#F4F4F4`. So the only thing on this row
 * that has a surface is the one you are on.
 *
 * The rule under it is 2px of `#FFFFFF` at 8%, drawn 1086 wide against the
 * frame's 805: it is full-bleed by design, so it runs the width of the column
 * rather than stopping at the content inset.
 */
export function AccountTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: AccountTabDef[];
  value: AccountTab;
  onChange: (value: AccountTab) => void;
}) {
  return (
    /*
      NO BACKGROUND, AND NO PADDING — both were mine and both were wrong.

      The frame reports a `#0F0F0F` fill, which is the PAGE's own colour in
      that file: composited on its own ground it is invisible, and the file
      draws no band here at all. Our column sits on `--color-chrome` `#121214`,
      so painting the reported fill drew a darker strip across the page that
      the design does not have. Same trap as the post card's
      `#0F0F0F`-to-transparent plate, which is deliberately not drawn either —
      keep the layout a node contributes, drop a fill that only matches the
      ground it was measured against.

      The 48 height is exactly its contents: 38 of tabs, the 8 gap, the 2 rule.
      There is no slack in it to pad.
    */
    <div className="flex flex-col gap-2">
      {/* 468:35621 — 32 of left inset, 32 between. */}
      <div className="flex items-center gap-8 overflow-x-auto pl-4 md:pl-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              disabled={Boolean(tab.disabledReason)}
              title={tab.disabledReason}
              aria-current={active ? "page" : undefined}
              onClick={() => onChange(tab.value)}
              className={cn(
                "ws-press flex h-[38px] w-[101px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-4 transition-colors",
                active
                  ? // 1021:21618 — the same handles as Home's "For you" pill (647:16268).
                    "bg-[linear-gradient(226deg,#7E3BEB_22.4%,#472185_84.9%)] text-grey-100"
                  : "bg-transparent text-white/40 hover:text-white/70",
                // Not a dimmed control that still fires: `disabled` above is
                // the real thing, and this only says so visually.
                tab.disabledReason && "cursor-not-allowed opacity-40 hover:text-white/40"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 468:35631 — 2px at 8% white, full-bleed. */}
      <span aria-hidden className="block h-[2px] w-full bg-white/[0.08]" />
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { IconCollapseRight } from "@/components/ui/icons";
import { useUnread } from "@/hooks/use-unread";
import { asset, sq, stripSquare } from "@/lib/square-path";

/**
 * THE DESKTOP DOCK — node 748:15721, and there is no sidebar beside it.
 *
 * A translucent pill carrying three destinations, and a compose circle beside
 * it. It replaces the labelled sidebar outright on desktop, at ogazboiz's
 * instruction, with the consequence understood and accepted: the sidebar
 * carried ELEVEN destinations and this carries three.
 *
 * ─── WHAT IS NO LONGER LINKED FROM ANYWHERE ON DESKTOP ──────────────────────
 * Gistrooms, Notifications, Live, Library, Store, Studio, Admin and
 * Operations. Every one of those ROUTES still works and every deep link into
 * them still resolves — nothing was deleted — but nothing on a desktop screen
 * points at them any more. They remain reachable on a phone, where the tab
 * bar's More drawer still lists the whole nav.
 *
 * Written down because it is the kind of decision that looks like a bug to
 * whoever finds it next: the answer is that it was asked for, and the way to
 * reverse it is to put `Sidebar` back in `AppShell`.
 *
 * ─── NOW NODE 964:24177 ──────────────────────────────────────────────────────
 * The live file (updated 2026-09-11) redrew it: FOUR destinations — Home,
 * Discover, Pals, Chat — in a bar of a fixed 286 x 113, 21.6 between items, a
 * 1.886 inside ring at 12% white, and the compose circle 13.29 beside it on a
 * new ramp. Everything below is that node at the same 72/113 (0.6372) scale;
 * the icons, the home mark and the circle are the node's own exports.
 *
 * ─── THE FILE'S GEOMETRY IS A RESIZED GROUP ─────────────────────────────────
 * It is drawn 368.91 x 113 with a 63.147 home circle, a 39.88 icon and a 9.9px
 * label — fractions that come from a group somebody scaled, not from decisions.
 * So the PROPORTIONS are the file's and the size is ours: the dock is 72 tall
 * (the file's 113 would be an enormous bar on a laptop), everything else scaled
 * by the same 0.637, and the label kept at 10px rather than scaled down to the
 * 6px that ratio would give — a label nobody can read is not the design either.
 *
 * Colours and materials ARE the file's exactly: `#141416` at 47% behind a
 * backdrop blur, and the compose circle on `--color-spotlight` ->
 * `--color-spotlight-chip-ink`, which are the ramp's own two stops rather than
 * a new purple.
 */

/**
 * THE DOCK'S HEIGHT DRIVES EVERYTHING. The file draws the bar at 113; we render
 * it at 72 on a laptop, and on a phone that 72 is a tall pill — too big — so the
 * height drops there and the WHOLE bar scales with it: width, gaps and glyphs
 * are all this height over the file's 113. It is published as the CSS variable
 * `--ws-dock-h`, set responsively on the wrapper (`58px` on a phone, `72px` from
 * md), so ONE number moves the lot rather than re-deriving each length per
 * breakpoint — which inline pixel strings could not do. The active label and
 * the badge are the two fixed exceptions: a label scaled to the phone would be
 * the unreadable 6px the file itself refuses.
 */
const px = (value: number) => `calc(var(--ws-dock-h) * ${value} / 113)`;

/**
 * The GLYPHS and the active LABEL are drawn a step larger than the node's own
 * scale (ogazboiz: bigger icons and text). This grows the icon RELATIVE to the
 * bar; it is still a fraction of `--ws-dock-h`, so it shrinks with the bar on a
 * phone rather than fighting the smaller container. The stack (icon + 5px gap +
 * label) still clears the height at both sizes, so nothing overflows.
 */
const ICON_SCALE = 1.4;
const iconPx = (value: number) => px(value * ICON_SCALE);

interface DockItem {
  href: string;
  label: string;
  /** Exported from the node; drawn as a mask so the link's colour inks it. */
  glyph: string;
  /** The glyph's own drawn size in the file (its vector, not its frame). */
  size: { width: number; height: number };
  /** Live count, or null where we genuinely do not have one. */
  badge?: number | null;
  /**
   * Something is waiting, with no number — chat requests. See the sidebar's
   * `dot`: a stranger may say that there IS something for you and may not say
   * how much, or being added to houses becomes a way to run up somebody's nav.
   */
  dot?: boolean;
}

export function BottomDock({
  onCompose,
  onShowSidebar,
  guest = false,
  className,
}: {
  onCompose?: () => void;
  /**
   * Desktop only: the dock is standing in for a rail the reader tucked away
   * (lib/sidebar-pref-store), so it carries the switch that brings the rail
   * back. Absent on phones, where there is no rail to restore.
   */
  onShowSidebar?: () => void;
  /**
   * Only ever `md:hidden`, and only when `MARKET_FLAGS.sidebar` is on — the
   * rail takes desktop navigation back and the dock stays on phones. It lives
   * at the call site rather than here so this component has no opinion about
   * a flag it does not read.
   */
  className?: string;
  /**
   * Signed out. Chat is dropped rather than shown leading to a sign-in wall —
   * the same judgement the sidebar made when it hid itself entirely from
   * guests: a row that can only refuse you is not navigation.
   */
  guest?: boolean;
}) {
  // Logical route: nav `href`s are keys (see the matching below), so the
  // pathname is compared WITHOUT the /square prefix and prefixed only where rendered.
  const pathname = stripSquare(usePathname());
  const unread = useUnread();

  const gradient = `dock-create-${useId().replace(/:/g, "")}`;

  const all: DockItem[] = [
    /* 964:24181 — the home mark, 31.57 x 23.5, exported with its own ramp. */
    { href: "/", label: "Home", glyph: asset("/notifications/dock-home.svg"), size: { width: 31.57, height: 23.5 } },
    /* Discover left the dock (ogazboiz, 2026-09-11): people are met on Pals,
       whose first tab is Discover, and Explore is no longer a destination in
       the navigation. The bar keeps the file's 286 and centres what is left. */
    /*
      THE FILE DRAWS A "4" ON THIS ONE AND WE DO NOT DRAW ANYTHING.

      There is no count behind the people glyph: `GET /me/unread` answers
      messages and notifications, and neither is "pals". A badge is a promise
      that something is waiting, so an invented one is the worst kind of
      decoration — it sends somebody looking for news that does not exist.
      It appears the day a count does.

      IT POINTS AT THE DECK, NOT AT EXPLORE. The glyph promises deciding about
      one person at a time; Explore is a directory you scan. `/pals` is the
      same `FriendsDeck` the timeline carries, given a page of its own.
    */
    { href: "/pals", label: "Pals", glyph: asset("/notifications/dock-pals.svg"), size: { width: 37.39, height: 27.46 }, badge: null },
    {
      href: "/messages",
      label: "Chat",
      glyph: asset("/notifications/dock-chat.svg"),
      size: { width: 32.4, height: 29.91 },
      // The real global unread, the same number the bell reads.
      badge: unread.data?.messages ?? null,
      // A stranger's first message, or a house seat waiting to be accepted.
      // Never added into the badge above — see `dot`.
      dot: (unread.data?.chatRequests ?? 0) > 0,
    },
  ];

  // Home and Pals are public surfaces; Chat is not.
  const items = guest ? all.filter((item) => item.href !== "/messages") : all;

  return (
    /* EVERY WIDTH, not just desktop. It replaced the sidebar first and the
       phone's tab bar second, so it is the app's only bottom navigation now.
       The inset clears the home indicator on a phone and is the file's 24
       everywhere else. */
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 z-40 flex justify-center",
        // The whole bar is sized off `--ws-dock-h`: 58 on a phone, where 72 was
        // too tall a pill, and the file's 72 from md up. Every length inside —
        // width, gaps, glyphs — is a fraction of this, so the two values here
        // are the only thing that changes between mobile and desktop.
        "[--ws-dock-h:58px] md:[--ws-dock-h:72px]",
        className
      )}
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
    >
      {/* The row HUGS its contents and sits centred — the floating pill, not a
          bar spanning the screen. The nav's own `px(286)` width (below) is the
          knob: raise it to widen the pill, but it is never stretched to fill
          the screen. */}
      <div className="pointer-events-auto flex items-center" style={{ gap: px(13.29) }}>
        {/* 748:15722 — `#141416` at 47%, fully round, behind a heavy backdrop
            blur and the file's own deep shadow. */}
        {/* `ws-glass` — the app's own material, not a second one invented here.
            It is `rgba(20,20,22,0.7)` behind a 16px blur with a 10% white
            hairline and an inset top highlight, and `#141416` is exactly the
            colour the file gives this pill. The file's 47% against the
            utility's 70% is the one difference, and the utility wins: it is
            what every other floating surface in the app is made of, and a
            dock a shade more solid than the rest is a new material nobody
            asked for. */}
        {/* 964:24178 — the file's own material, not the app's glass utility:
            `#141416` at 47% behind its 93.18 background blur (46.59 in CSS),
            a 1.886 INSIDE ring at 12% white, and its 94.32 shadow 33.95 down
            with -30.18 spread. Fixed 286 wide, items centred 21.6 apart. */}
        <nav
          aria-label="Primary"
          // The horizontal padding keeps the end items (Home's label, Chat's
          // glyph) off the pill's rounded edges — scaled from the dock height
          // like every other length, so it holds its proportion as the bar
          // resizes. It lives in a class rather than the inline style so the
          // width/gap the design pins stay exactly as they are.
          className="flex h-(--ws-dock-h) items-center justify-around rounded-full bg-[rgba(20,20,22,0.47)] px-[calc(var(--ws-dock-h)*24/113)] backdrop-blur-[29.69px] shadow-[inset_0_0_0_1.2px_rgba(255,255,255,0.12),0_21.63px_60.1px_-19.23px_rgba(0,0,0,0.95)]"
          style={{ width: px(286), gap: px(21.6) }}
        >
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={sq(item.href)}
                aria-current={active ? "page" : undefined}
                /*
                  The label is drawn only on the ACTIVE item, so an inactive
                  glyph has no accessible name of its own — and the dot beside
                  it is `aria-hidden`, which is right visually and silent. Both
                  are said here instead: "requests waiting" rather than a count,
                  because the mark deliberately carries none.
                */
                aria-label={
                  typeof item.badge === "number" && item.badge > 0
                    ? `${item.label}, ${item.badge} unread`
                    : item.dot
                      ? `${item.label}, requests waiting`
                      : item.label
                }
                className={cn(
                  "ws-press relative flex flex-col items-center justify-center rounded-full transition-colors",
                  active ? "text-white" : "text-[#9B9B9B] hover:text-white"
                )}
                // 964:24188 sits 5 under the mark in the file.
                style={{ gap: px(5) }}
              >
                <span className="relative">
                  {item.href === "/" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the node's own export, fixed colours
                    <img
                      src={item.glyph}
                      alt=""
                      aria-hidden
                      className="block"
                      style={{ width: iconPx(item.size.width), height: iconPx(item.size.height) }}
                    />
                  ) : (
                    /*
                      MASKED, NOT AN <img>.

                      The exported glyphs carry the file's grey — but an SVG
                      loaded through `<img src>` is a SEPARATE DOCUMENT and
                      cannot see this page's `color`. Painting them as a mask
                      puts the colour under CSS's control: the shape comes from
                      the file, the ink from the link's own `text-…`, `#9B9B9B`
                      at rest and white when it is the current page.
                    */
                    <span
                      aria-hidden
                      className="block bg-current"
                      style={{
                        width: iconPx(item.size.width),
                        height: iconPx(item.size.height),
                        maskImage: `url(${item.glyph})`,
                        WebkitMaskImage: `url(${item.glyph})`,
                        maskSize: "contain",
                        WebkitMaskSize: "contain",
                        maskRepeat: "no-repeat",
                        WebkitMaskRepeat: "no-repeat",
                        maskPosition: "center",
                        WebkitMaskPosition: "center",
                      }}
                    />
                  )}
                {/* 748:15735 — the badge, drawn only when there is a real
                      number behind it. */}
                  {typeof item.badge === "number" && item.badge > 0 && (
                    <span className="tnum absolute -right-2 -top-1.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-spotlight px-1 text-[9px] font-bold leading-none text-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                  {/* The dot takes the badge's corner and never shares it: a
                      count already draws the eye, and two marks on one glyph
                      is noise rather than two pieces of news. */}
                  {!(typeof item.badge === "number" && item.badge > 0) && item.dot && (
                    <span
                      aria-hidden
                      className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-spotlight ring-2 ring-chrome"
                    />
                  )}
                </span>
                {/* 748:15732 — only the active item is labelled. Manrope in the
                    file; Geist here, since that is the app's face. */}
                {active ? (
                  <span className="text-[13px] font-bold leading-none">{item.label}</span>
                ) : (
                  <span className="sr-only">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {onShowSidebar && (
          <button
            type="button"
            onClick={onShowSidebar}
            aria-label="Show sidebar"
            title="Show sidebar"
            className="ws-glass ws-press hidden h-(--ws-dock-h) w-(--ws-dock-h) place-items-center rounded-full text-[#9B9B9B] shadow-[0_22px_60px_-19px_rgba(0,0,0,0.95)] transition-colors hover:text-white md:grid"
          >
            <IconCollapseRight className="h-6 w-6" />
          </button>
        )}

        {/* 964:24199 — the node's own export at 72: the circle on its ramp
            (`#7E3BEB` -> `#C27AFF`, light on the left) and the 6.007 plus. No
            shadow — the file gives this circle none. */}
        {onCompose && (
          <button
            type="button"
            onClick={onCompose}
            // It asks first — a post or a gist room (QA). See CreateChoiceSheet.
            aria-label="Create"
            className="ws-press block h-(--ws-dock-h) w-(--ws-dock-h) rounded-full transition-opacity hover:opacity-90"
          >
            <svg viewBox="0 0 113 113" className="block h-full w-full" fill="none" aria-hidden>
              <path
                d="M0 56.5C0 25.2959 25.2959 0 56.5 0C87.7041 0 113 25.2959 113 56.5C113 87.7041 87.7041 113 56.5 113C25.2959 113 0 87.7041 0 56.5Z"
                fill={`url(#${gradient})`}
              />
              <path
                d="M38.4792 56.5027H56.4995M56.4995 56.5027H74.5198M56.4995 56.5027V74.523M56.4995 56.5027V38.4824"
                stroke="white"
                strokeWidth="6.00677"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient id={gradient} x1="83.9109" y1="14.8684" x2="-1.12419" y2="45.7834" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#7E3BEB" />
                  <stop offset="1" stopColor="#C27AFF" />
                </linearGradient>
              </defs>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

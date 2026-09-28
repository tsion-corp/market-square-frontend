"use client";

import { useState } from "react";
import { REACTION_EMOJIS } from "@/lib/reactions";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { IconPlus } from "@/components/ui/icons";

/**
 * THE GIST ROOM'S REACTION PICKER — node 1775:20163.
 *
 * THE FILE'S NUMBERS: a glass bubble at `rgba(186,186,186,0.2)`, 12px padding,
 * 20px radius, under the shared `sm` drop-shadow (offset 0/4, blur 6, spread
 * -3, `#0A0A0A0F`); the six glyphs at 24px, 20px apart; then the two-dot tail —
 * a 12px disc and a 4px disc, both 13px in from the bubble's right edge — that
 * points the bubble down at the control it opened from.
 *
 * The QUICK SIX are the common reactions; a "+" beside them opens the full
 * emoji picker so a reaction can be ANY emoji (Slack/Meet/Discord's pattern).
 * The wire guard still refuses anything that reads as text (see lib/reactions).
 *
 * It is a PURE popover: it draws itself anchored above its (relative) parent
 * and reports a pick. Opening, dismissal and what a pick DOES belong to the
 * control that mounts it — here, the room's reaction button, whose pick flies
 * the glyph over the stage the way a call's reactions do.
 */
export function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [full, setFull] = useState(false);

  // "+" swaps the quick bar for the full picker in the same slot — one popover
  // at a time, so it never covers its own tail or overflows the small bubble.
  if (full) return <EmojiPicker onPick={onPick} />;

  return (
    <div
      role="menu"
      aria-label="Send a reaction"
      // Fixed and centred on a phone — anchored to the trigger it ran off the
      // screen's edge from a mid-row disc (ogazboiz, 2026-09-28, on-device).
      // From `md` it is the file's popover again, tail and all.
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+96px)] left-1/2 z-30 -translate-x-1/2 md:absolute md:bottom-full md:left-auto md:right-0 md:mb-3 md:translate-x-0"
      style={{ filter: "drop-shadow(0 4px 6px rgba(10,10,10,0.06))" }}
    >
      <div className="flex items-center gap-5 rounded-[20px] bg-[rgba(186,186,186,0.2)] p-3 backdrop-blur-md">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji.char}
            type="button"
            role="menuitem"
            aria-label={`Send ${emoji.label}`}
            onClick={() => onPick(emoji.char)}
            className="ws-press text-[24px] leading-none transition-transform hover:scale-125"
          >
            {emoji.char}
          </button>
        ))}
        {/* More options: opens the full emoji picker to react with any emoji. */}
        <button
          type="button"
          aria-label="More emoji"
          aria-haspopup="dialog"
          onClick={() => setFull(true)}
          className="ws-press flex size-6 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          <IconPlus className="h-4 w-4" />
        </button>
      </div>
      {/* Tooltip tail (1775:20172): two discs 13px in from the right edge,
          dropping toward the glyph the bubble points at. Hidden on a phone —
          centred on the screen, the bubble no longer points at its trigger. */}
      <div aria-hidden className="absolute right-3.25 top-full hidden md:block">
        <span className="absolute right-0 -top-1.5 block size-3 rounded-full bg-[rgba(186,186,186,0.2)] backdrop-blur-md" />
        <span className="absolute right-0 top-1.5 block size-1 rounded-full bg-[rgba(186,186,186,0.2)] backdrop-blur-md" />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A FULL emoji picker for a text field — the gist room's live chat composer.
 *
 * Distinct from `ReactionPicker` (the six-glyph call-reaction bar): here you are
 * writing a message, so the whole common set is offered in a scrollable grid by
 * category, with a search box, the way a chat keyboard's emoji tab works. A pick
 * is inserted into the draft; the panel stays open so several land in a row.
 *
 * Self-contained by design — no emoji library, no network. The list is a
 * curated set of the common glyphs; a name index backs the search so "heart" or
 * "fire" finds them. Purely presentational: opening, dismissal and where a pick
 * goes belong to the field that mounts it.
 */
interface EmojiEntry {
  char: string;
  keywords: string;
}

interface EmojiGroup {
  name: string;
  emojis: EmojiEntry[];
}

const e = (char: string, keywords: string): EmojiEntry => ({ char, keywords });

const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: "Smileys & people",
    emojis: [
      e("😀", "grin happy smile"), e("😃", "happy smile"), e("😄", "happy laugh"),
      e("😁", "grin beam"), e("😆", "laugh"), e("😅", "sweat laugh"),
      e("🤣", "rofl laughing"), e("😂", "joy laughing tears"), e("🙂", "slight smile"),
      e("🙃", "upside down"), e("😉", "wink"), e("😊", "blush smile"),
      e("😇", "innocent halo"), e("🥰", "love hearts"), e("😍", "heart eyes love"),
      e("🤩", "star struck"), e("😘", "kiss"), e("😗", "kiss"),
      e("😚", "kiss"), e("😙", "kiss"), e("😋", "yum tasty"),
      e("😛", "tongue"), e("😜", "wink tongue"), e("🤪", "zany"),
      e("😝", "tongue"), e("🤑", "money"), e("🤗", "hug"),
      e("🤭", "giggle"), e("🤫", "shush quiet"), e("🤔", "thinking"),
      e("🤐", "zipper mouth"), e("🤨", "raised eyebrow"), e("😐", "neutral"),
      e("😑", "expressionless"), e("😶", "no mouth"), e("😏", "smirk"),
      e("😒", "unamused"), e("🙄", "eye roll"), e("😬", "grimace"),
      e("🤥", "lying"), e("😌", "relieved"), e("😔", "pensive sad"),
      e("😪", "sleepy"), e("🤤", "drool"), e("😴", "sleep"),
      e("😷", "mask sick"), e("🤒", "sick thermometer"), e("🤕", "hurt bandage"),
      e("🥵", "hot"), e("🥶", "cold"), e("😵", "dizzy"),
      e("🤯", "mind blown"), e("🤠", "cowboy"), e("🥳", "party celebrate"),
      e("😎", "cool sunglasses"), e("🤓", "nerd"), e("🧐", "monocle"),
      e("😕", "confused"), e("😟", "worried"), e("🙁", "frown"),
      e("😮", "surprised"), e("😯", "surprised"), e("😲", "astonished"),
      e("😳", "flushed"), e("🥺", "pleading"), e("😦", "frown"),
      e("😧", "anguished"), e("😨", "fearful"), e("😰", "anxious"),
      e("😥", "sad"), e("😢", "cry"), e("😭", "sob crying"),
      e("😱", "scream"), e("😖", "confounded"), e("😣", "persevere"),
      e("😞", "disappointed"), e("😓", "downcast sweat"), e("😩", "weary"),
      e("😫", "tired"), e("🥱", "yawn"), e("😤", "triumph steam"),
      e("😡", "angry rage"), e("😠", "angry"), e("🤬", "cursing"),
      e("😈", "devil"), e("💀", "skull dead"), e("💩", "poop"),
      e("🤡", "clown"), e("👻", "ghost"), e("👽", "alien"),
      e("🤖", "robot"), e("🎃", "pumpkin halloween"),
    ],
  },
  {
    name: "Gestures & body",
    emojis: [
      e("👍", "thumbs up like"), e("👎", "thumbs down dislike"), e("👊", "fist bump"),
      e("✊", "fist"), e("🤛", "fist left"), e("🤜", "fist right"),
      e("👏", "clap applause"), e("🙌", "raise hands celebrate"), e("👐", "open hands"),
      e("🤲", "palms"), e("🤝", "handshake"), e("🙏", "pray thanks please"),
      e("✌️", "peace victory"), e("🤞", "fingers crossed"), e("🤟", "love you"),
      e("🤘", "rock horns"), e("👌", "ok"), e("🤌", "pinched"),
      e("🤏", "pinch small"), e("👈", "point left"), e("👉", "point right"),
      e("👆", "point up"), e("👇", "point down"), e("☝️", "index up"),
      e("✋", "raised hand stop"), e("🤚", "back hand"), e("🖐️", "hand"),
      e("🖖", "vulcan"), e("👋", "wave hello hi bye"), e("🤙", "call me"),
      e("💪", "muscle strong"), e("🦾", "mechanical arm"), e("✍️", "writing"),
      e("👀", "eyes look"), e("👁️", "eye"), e("🧠", "brain"),
      e("👅", "tongue"), e("👄", "lips"), e("🦷", "tooth"),
    ],
  },
  {
    name: "Hearts & symbols",
    emojis: [
      e("❤️", "red heart love"), e("🧡", "orange heart"), e("💛", "yellow heart"),
      e("💚", "green heart"), e("💙", "blue heart"), e("💜", "purple heart"),
      e("🖤", "black heart"), e("🤍", "white heart"), e("🤎", "brown heart"),
      e("💔", "broken heart"), e("❣️", "heart exclamation"), e("💕", "two hearts"),
      e("💞", "revolving hearts"), e("💓", "beating heart"), e("💗", "growing heart"),
      e("💖", "sparkling heart"), e("💘", "heart arrow"), e("💝", "heart gift"),
      e("💟", "heart decoration"), e("💯", "hundred perfect"), e("💢", "anger"),
      e("💥", "boom collision"), e("💫", "dizzy star"), e("💦", "sweat drops"),
      e("💨", "dash wind"), e("🕳️", "hole"), e("💬", "speech"),
      e("💭", "thought"), e("🗯️", "anger speech"), e("✨", "sparkles"),
      e("⭐", "star"), e("🌟", "glowing star"), e("💫", "shooting star"),
      e("⚡", "lightning fast"), e("🔥", "fire lit hot"), e("🎉", "party tada celebrate"),
      e("🎊", "confetti"), e("✅", "check yes done"), e("❌", "cross no wrong"),
      e("❓", "question"), e("❗", "exclamation"), e("⚠️", "warning"),
    ],
  },
  {
    name: "Animals & nature",
    emojis: [
      e("🐶", "dog puppy"), e("🐱", "cat"), e("🐭", "mouse"),
      e("🐹", "hamster"), e("🐰", "rabbit bunny"), e("🦊", "fox"),
      e("🐻", "bear"), e("🐼", "panda"), e("🐨", "koala"),
      e("🐯", "tiger"), e("🦁", "lion"), e("🐮", "cow"),
      e("🐷", "pig"), e("🐸", "frog"), e("🐵", "monkey"),
      e("🐔", "chicken"), e("🐧", "penguin"), e("🐦", "bird"),
      e("🦄", "unicorn"), e("🐝", "bee"), e("🦋", "butterfly"),
      e("🐢", "turtle"), e("🐙", "octopus"), e("🐠", "fish"),
      e("🐬", "dolphin"), e("🐳", "whale"), e("🌸", "blossom flower"),
      e("🌹", "rose"), e("🌻", "sunflower"), e("🌈", "rainbow"),
      e("☀️", "sun sunny"), e("⛅", "cloud sun"), e("🌧️", "rain"),
      e("❄️", "snow cold"), e("🌊", "wave ocean"), e("🌙", "moon night"),
    ],
  },
  {
    name: "Food & drink",
    emojis: [
      e("🍏", "apple"), e("🍎", "apple"), e("🍊", "orange"),
      e("🍋", "lemon"), e("🍌", "banana"), e("🍉", "watermelon"),
      e("🍓", "strawberry"), e("🍑", "peach"), e("🍒", "cherries"),
      e("🥑", "avocado"), e("🍕", "pizza"), e("🍔", "burger"),
      e("🍟", "fries"), e("🌭", "hotdog"), e("🍿", "popcorn"),
      e("🍩", "donut"), e("🍪", "cookie"), e("🎂", "cake birthday"),
      e("🍰", "cake"), e("🍫", "chocolate"), e("🍬", "candy"),
      e("🍦", "ice cream"), e("☕", "coffee"), e("🍵", "tea"),
      e("🍺", "beer"), e("🍻", "cheers beer"), e("🥂", "champagne cheers"),
      e("🍷", "wine"), e("🍹", "cocktail"), e("🥤", "drink"),
    ],
  },
  {
    name: "Activities & objects",
    emojis: [
      e("⚽", "soccer football"), e("🏀", "basketball"), e("🏈", "football"),
      e("⚾", "baseball"), e("🎾", "tennis"), e("🏐", "volleyball"),
      e("🎱", "pool 8ball"), e("🏓", "ping pong"), e("🏆", "trophy win"),
      e("🥇", "gold medal first"), e("🎯", "target bullseye"), e("🎮", "game controller"),
      e("🎲", "dice"), e("🎸", "guitar"), e("🎹", "piano"),
      e("🎧", "headphones music"), e("🎤", "mic sing"), e("🎬", "movie clapper"),
      e("📷", "camera photo"), e("📱", "phone"), e("💻", "laptop"),
      e("⌚", "watch"), e("💡", "idea bulb"), e("🔑", "key"),
      e("💰", "money bag"), e("💵", "dollar cash"), e("💎", "gem diamond"),
      e("🎁", "gift present"), e("🎈", "balloon"), e("🚀", "rocket launch"),
      e("✈️", "plane travel"), e("🚗", "car"), e("🏠", "house home"),
      e("⏰", "alarm clock time"), e("📌", "pin"), e("📎", "clip"),
      e("✏️", "pencil write"), e("📚", "books study"), e("🔒", "lock"),
    ],
  },
];

const ALL_EMOJIS = EMOJI_GROUPS.flatMap((group) => group.emojis);

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search on open so a keyboard user can filter straight away.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return ALL_EMOJIS.filter(
      (entry) => entry.keywords.includes(q) || entry.char === q
    );
  }, [query]);

  return (
    <div
      role="dialog"
      aria-label="Emoji picker"
      // An OPAQUE panel, not `ws-card`: this floats over the chat, and a 5%
      // white fill let every message behind it show through. `bg-chrome` is the
      // app's raised-surface token, with a border and a drop shadow so it reads
      // as lifted off the conversation.
      // On a PHONE the panel is fixed and centred on the screen: anchored to
      // its trigger (a mid-row disc in the room's bar) the 300px grid ran off
      // the screen's edge and half the emoji were unreachable (ogazboiz,
      // 2026-09-28, on-device). From `md` it goes back to the anchored popover.
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+96px)] left-1/2 z-30 flex w-75 max-w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-chrome shadow-[0_16px_48px_rgba(0,0,0,0.55)] md:absolute md:bottom-full md:left-auto md:right-0 md:mb-3 md:max-w-[80vw] md:translate-x-0"
      // Stop a click inside the panel from bubbling to the field's own handlers.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="shrink-0 border-b border-white/10 p-2">
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="h-8 w-full rounded-full bg-white/6 px-3 text-[13px] text-white outline-none placeholder:text-white/40"
        />
      </div>

      <div className="max-h-44 overflow-y-auto p-2 md:max-h-65">
        {matches ? (
          matches.length > 0 ? (
            <EmojiGrid emojis={matches} onPick={onPick} />
          ) : (
            <p className="px-1 py-6 text-center text-[13px] text-white/40">No emoji found</p>
          )
        ) : (
          EMOJI_GROUPS.map((group) => (
            <div key={group.name} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-white/40">
                {group.name}
              </p>
              <EmojiGrid emojis={group.emojis} onPick={onPick} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function EmojiGrid({ emojis, onPick }: { emojis: EmojiEntry[]; onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {emojis.map((entry) => (
        <button
          key={entry.char}
          type="button"
          aria-label={entry.keywords}
          onClick={() => onPick(entry.char)}
          className="ws-press flex h-8 w-8 items-center justify-center rounded-md text-[20px] leading-none transition-colors hover:bg-white/10"
        >
          {entry.char}
        </button>
      ))}
    </div>
  );
}

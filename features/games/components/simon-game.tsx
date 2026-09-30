"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_PADS,
  FIFTH_PAD_ROUND,
  MAX_PADS,
  MAX_GAME_MS,
  POINTS_PER_ROUND,
  darkMs,
  flashMs,
  judgePress,
  padsForRound,
  scoreForFailedRound,
  sequenceFor,
} from "@/lib/simon";
import {
  playPadTone,
  playWrongTone,
  primeTones,
} from "@/features/games/lib/tones";

/**
 * GameArena's Simon, played inside a Square thread.
 *
 * The rules, the timing and the scoring all come from `lib/simon.ts`, which is
 * pure and tested — this file is only the screen. Keeping the judgement out of
 * the component is what lets the rules be attacked by `node --test` instead of
 * being trusted because the game looked right when someone played it once.
 *
 * ─── THE FIFTH PAD HAS ITS PLACE FROM THE START ─────────────────────────────
 * Purple joins at round five. If it appeared then, the board would resize
 * under the player's thumb mid-game and the press they were already making
 * would land somewhere else. So the slot is held open from round one, dark and
 * unpressable, and it LIGHTS UP when it joins. The player sees it coming, and
 * nothing moves.
 *
 * ─── WHY REDUCED MOTION IS NOT HONOURED HERE ────────────────────────────────
 * The flashing is not decoration, it is the message — a Simon that does not
 * flash cannot be played. So the pads always flash, and the restraint is spent
 * elsewhere: nothing else on this screen animates.
 */

interface Props {
  /** The challenge's seed. Both players get this same sequence. */
  seed: string;
  /** The score being answered, when this game is a reply to a challenge. */
  targetScore?: number;
  /** Called once with the final score when the game ends. */
  onFinished: (score: number) => void;
  onClose: () => void;
  /**
   * Shown under the final score — the offer to make these scores count.
   *
   * A slot, so this screen stays a game: it knows the rules and nothing about
   * GameArena, wallets or what a player's standing is. Whoever mounts the game
   * decides whether there is anything to offer.
   */
  footerSlot?: React.ReactNode;
}

type Phase = "ready" | "showing" | "input" | "over";

/*
  THE PADS ARE GAMEARENA'S, TO THE HEX AND THE ORDER.

  Their Simon draws a gradient FACE over a dark wall and lights it with a glow;
  a flat colour at 20% reads as a disabled control, which is exactly how the
  first version looked — a board of dead squares. The order matters too: a
  player who knows their game should find the same colour in the same place.

  Red, cyan, yellow, green, and purple as the fifth, matching BASE_COLORS and
  BONUS_COLOR in their app/games/simon/page.tsx.
*/
const PADS = [
  {
    name: "red",
    face: "linear-gradient(160deg, #fecaca 0%, #ef4444 50%, #991b1b 100%)",
    wall: "#5e0000",
    glow: "rgba(239,68,68,0.85)",
  },
  {
    name: "cyan",
    face: "linear-gradient(160deg, #a5f3fc 0%, #06b6d4 50%, #155e75 100%)",
    wall: "#083a6b",
    glow: "rgba(6,182,212,0.85)",
  },
  {
    name: "yellow",
    face: "linear-gradient(160deg, #fde68a 0%, #eab308 50%, #854d0e 100%)",
    wall: "#5c3900",
    glow: "rgba(234,179,8,0.85)",
  },
  {
    name: "green",
    face: "linear-gradient(160deg, #86efac 0%, #10b981 50%, #14532d 100%)",
    wall: "#013220",
    glow: "rgba(16,185,129,0.85)",
  },
  {
    name: "purple",
    face: "linear-gradient(160deg, #e9d5ff 0%, #a855f7 50%, #6b21a8 100%)",
    wall: "#3a005c",
    glow: "rgba(168,85,247,0.9)",
  },
] as const;

/** Which corner each quadrant rounds, so the four together read as one disc —
    the shape that makes this Simon rather than a grid of buttons. */
const QUADRANT = [
  "rounded-tl-full",
  "rounded-tr-full",
  "rounded-bl-full",
  "rounded-br-full",
] as const;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function SimonGame({
  seed,
  targetScore,
  onFinished,
  onClose,
  footerSlot,
}: Props) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [round, setRound] = useState(1);
  const [lit, setLit] = useState<number | null>(null);
  const [pressed, setPressed] = useState<number[]>([]);
  const [score, setScore] = useState(0);

  /*
    THE PRESSES ARE JUDGED FROM A REF, NOT FROM STATE.

    Simon is played fast, and two taps inside one React tick both read the same
    `pressed` array from their render's closure — so both are judged against
    the SAME position in the sequence. The second correct press is compared to
    the pad that was already matched, comes back wrong, and ends the game. It
    would present as "it said I was wrong when I was right", get blamed on the
    touch handler, and be reproducible only by playing well.

    The ref is the authority for judging; the state exists so the screen can
    render how many are left.
  */
  const pressedRef = useRef<number[]>([]);

  /*
    A run token, not a boolean. Effects that play a sequence outlive the state
    that started them — React may run cleanup and setup in the same tick, and a
    plain `cancelled` flag captured by the previous run cannot tell "I was
    replaced" from "I am current". Comparing against a ref means a stale loop
    recognises itself and stops writing state.
  */
  const runRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  /** Guards `onFinished` against a double report — a game ends once. */
  const reportedRef = useRef(false);

  const finish = useCallback(
    (failedRound: number) => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      runRef.current += 1; // stop any sequence still in flight
      const final = scoreForFailedRound(failedRound);
      setScore(final);
      setPhase("over");
      playWrongTone();
      onFinished(final);
    },
    [onFinished],
  );

  /** Play the round's sequence, then hand control to the player. */
  useEffect(() => {
    if (phase !== "showing") return;
    const run = (runRef.current += 1);
    const sequence = sequenceFor(seed, round);
    const flash = flashMs(round);
    // The DARK stretch, not the interval — gapMs measures start-to-start.
    const dark = darkMs(round);

    void (async () => {
      // A beat before the first flash, so the round change registers as its
      // own moment rather than running into the previous round's last press.
      await wait(450);
      for (const pad of sequence) {
        if (runRef.current !== run) return;
        setLit(pad);
        playPadTone(pad, flash);
        await wait(flash);
        if (runRef.current !== run) return;
        setLit(null);
        await wait(dark);
      }
      if (runRef.current !== run) return;
      pressedRef.current = [];
      setPressed([]);
      setPhase("input");
    })();

    return () => {
      runRef.current += 1;
    };
  }, [phase, round, seed]);

  /*
    GameArena caps a single game at ten minutes. A Simon left open is not a
    game in progress, it is a tab somebody forgot, and a score submitted an
    hour later is one their session window would refuse anyway.
  */
  useEffect(() => {
    if (phase === "ready" || phase === "over") return;
    startedAtRef.current ??= Date.now();
    const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
    const timer = setTimeout(
      () => finish(round),
      Math.max(0, MAX_GAME_MS - elapsed),
    );
    return () => clearTimeout(timer);
  }, [phase, round, finish]);

  const start = useCallback(() => {
    primeTones(); // must happen inside the gesture, or the first round is silent
    reportedRef.current = false;
    startedAtRef.current = null;
    pressedRef.current = [];
    setScore(0);
    setRound(1);
    setPressed([]);
    setPhase("showing");
  }, []);

  const press = useCallback(
    (pad: number) => {
      if (phase !== "input") return;
      if (pad >= padsForRound(round)) return; // not in play yet

      const soFar = pressedRef.current;
      const verdict = judgePress(seed, round, soFar, pad);
      setLit(pad);
      setTimeout(
        () => setLit((current) => (current === pad ? null : current)),
        160,
      );

      if (verdict === "wrong") {
        finish(round);
        return;
      }
      playPadTone(pad, 160);
      if (verdict === "round-complete") {
        pressedRef.current = [];
        setPressed([]);
        setScore((current) => current + POINTS_PER_ROUND);
        setRound((current) => current + 1);
        setPhase("showing");
        return;
      }
      // Advance the authority FIRST, so a press landing in the same tick is
      // judged against a sequence that already includes this one.
      pressedRef.current = [...soFar, pad];
      setPressed(pressedRef.current);
    },
    [phase, round, seed, finish],
  );

  const padsInPlay = padsForRound(round);
  const beatTarget = targetScore !== undefined && score > targetScore;

  return (
    /*
      A SHEET OVER THE CONVERSATION, not a takeover.

      This is a game you play mid-chat, so the thread stays visible behind it
      — the iMessage grammar. A full-bleed black screen made a twenty-second
      game feel like leaving the app to go somewhere else.

      The ground is a deep radial wash rather than flat black, which is what
      lets the pads' glow read as light in a room instead of colour on a page.
    */
    <div className="fixed inset-0 z-[70] flex flex-col justify-end bg-black/55 backdrop-blur-[2px]">
      <div
        className="flex h-[94dvh] flex-col overflow-hidden rounded-t-[28px] border-t border-white/10 text-white shadow-[0_-8px_40px_rgba(0,0,0,0.6)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 42%, #1a0a5a 0%, #0c0430 38%, #05021a 72%, #010008 100%)",
        }}
      >
        {/* The grab handle every sheet on a phone has, so it reads as one. */}
        <div
          aria-hidden
          className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-white/25"
        />
        {/* Header: the round and the score, and a way out. Padded for the
          phone's status bar so it never sits under the clock. */}
        <div
          className="flex shrink-0 items-center justify-between px-4 pb-3"
          style={{ paddingTop: "max(12px, env(safe-area-inset-top, 0px))" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="ws-press rounded-full px-3 py-1.5 text-[14px] text-white/70 transition-colors hover:bg-white/10"
          >
            Close
          </button>
          {/* The score is the hero of the end screen, so the header stops
            repeating it there — two of the same number is not a hierarchy. */}
          <div className="text-center">
            {phase === "over" ? (
              <div className="text-[13px] font-medium text-white/50">Simon</div>
            ) : (
              <>
                <div className="text-[12px] uppercase tracking-wider text-white/40">
                  {`Round ${round}`}
                </div>
                <div className="text-[20px] font-semibold tabular-nums">
                  {score}
                </div>
              </>
            )}
          </div>
          <div className="w-[68px] text-right text-[13px] tabular-nums text-white/40">
            {targetScore !== undefined ? `Beat ${targetScore}` : ""}
          </div>
        </div>

        {/*
        THE BOARD IS A DISC, NOT A GRID.

        Four quadrants with their outer corners fully rounded read as the
        Simon everyone recognises; four rounded squares read as a generic
        memory game. The fifth pad is the CENTRE button, which is where a
        fifth pad belongs — and it solves the thing that looked broken, since
        a reserved slot under the board was just an empty rectangle.
      */}
        <div className="flex min-h-0 flex-1 items-center justify-center px-5">
          <div className="relative aspect-square w-full max-w-[min(86vw,46vh)]">
            <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-2.5">
              {PADS.slice(0, BASE_PADS).map((pad, index) => (
                <Pad
                  key={pad.name}
                  pad={pad}
                  index={index}
                  corner={QUADRANT[index]}
                  lit={lit === index}
                  live={phase === "input"}
                  inPlay
                  onPress={press}
                />
              ))}
            </div>

            {/*
            The centre. Dark and unlabelled until round five, so the board
            never resizes under a thumb already moving — it simply lights up
            when purple joins.
          */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="pointer-events-auto h-[34%] w-[34%]">
                <Pad
                  pad={PADS[BASE_PADS]}
                  index={BASE_PADS}
                  corner="rounded-full"
                  lit={lit === BASE_PADS}
                  live={phase === "input"}
                  inPlay={padsInPlay === MAX_PADS}
                  onPress={press}
                />
              </div>
            </div>
          </div>
        </div>

        {/* The one line of state, and the one action. */}
        <div
          className="shrink-0 px-6 pt-2 text-center"
          style={{
            paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))",
          }}
        >
          {phase === "ready" && (
            <>
              <p className="mb-4 text-[15px] text-white/60">
                {targetScore !== undefined
                  ? `Watch the pattern and repeat it. Beat ${targetScore} to win.`
                  : "Watch the pattern and repeat it. It gets one longer each round."}
              </p>
              <button
                type="button"
                onClick={start}
                className="ws-press w-full max-w-sm rounded-full bg-white px-6 py-3.5 text-[16px] font-semibold text-black"
              >
                {targetScore !== undefined ? "Beat it" : "Start"}
              </button>
            </>
          )}

          {phase === "showing" && (
            <p className="py-4 text-[15px] text-white/50" aria-live="polite">
              {round === FIFTH_PAD_ROUND
                ? "Purple is in play now — watch"
                : "Watch…"}
            </p>
          )}

          {phase === "input" && (
            <p className="py-4 text-[15px] text-white/50" aria-live="polite">
              Your turn — {round - pressed.length} to go
            </p>
          )}

          {phase === "over" && (
            <>
              {/*
              ONE RESULT, SAID ONCE, LARGE.

              The end screen used to stack four things: the score in the
              header, the score again as a sentence, a status line, a card,
              and a button. Nothing in that is the answer to "how did I do".
            */}
              <p
                className="text-[44px] font-bold leading-none tabular-nums"
                aria-live="polite"
              >
                {score}
              </p>
              <p className="mt-1.5 text-[15px] font-medium text-white/70">
                {targetScore === undefined
                  ? "Sent to the chat"
                  : beatTarget
                    ? `You beat ${targetScore}`
                    : `${targetScore} still stands`}
              </p>
              <div className="h-4" />
              {footerSlot && (
                <div className="mx-auto mb-3 w-full max-w-sm">{footerSlot}</div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="ws-press w-full max-w-sm rounded-full bg-white px-6 py-3.5 text-[16px] font-semibold text-black"
              >
                Back to the chat
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Pad({
  pad,
  index,
  corner,
  lit,
  live,
  inPlay,
  onPress,
}: {
  pad: (typeof PADS)[number];
  index: number;
  corner: string;
  lit: boolean;
  live: boolean;
  inPlay: boolean;
  onPress: (pad: number) => void;
}) {
  return (
    <button
      type="button"
      // A pad not yet in play is not a disabled control the player should try
      // — it is scenery, so it leaves the tab order and the accessibility
      // tree rather than being announced as unavailable.
      aria-hidden={!inPlay}
      tabIndex={inPlay && live ? 0 : -1}
      disabled={!inPlay || !live}
      aria-label={`${pad.name} pad`}
      onPointerDown={() => onPress(index)}
      className={[
        "h-full w-full touch-manipulation select-none border border-black/40",
        "transition-[filter,transform,opacity] duration-100",
        corner,
        lit ? "scale-[0.97]" : "",
        inPlay && live ? "cursor-pointer" : "cursor-default",
      ].join(" ")}
      style={{
        /*
          A GRADIENT FACE OVER A DARK WALL, and a glow when lit — GameArena's
          own treatment. A flat colour at low opacity reads as a disabled
          control, which is exactly how the first board looked: dead.

          An out-of-play pad keeps the wall alone, so it is visibly part of
          the board rather than a hole in it.
        */
        background: inPlay ? pad.face : pad.wall,
        opacity: inPlay ? 1 : 0.45,
        filter: lit ? "brightness(1.35) saturate(1.1)" : "brightness(0.82)",
        boxShadow: lit
          ? `0 0 28px 6px ${pad.glow}, inset 0 1px 0 rgba(255,255,255,0.35)`
          : "inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    />
  );
}

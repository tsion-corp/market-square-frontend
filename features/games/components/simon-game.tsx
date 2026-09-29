"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BASE_PADS,
  FIFTH_PAD_ROUND,
  MAX_PADS,
  MAX_GAME_MS,
  POINTS_PER_ROUND,
  flashMs,
  gapMs,
  judgePress,
  padsForRound,
  scoreForFailedRound,
  sequenceFor,
} from "@/lib/simon";
import { playPadTone, playWrongTone, primeTones } from "@/features/games/lib/tones";

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
}

type Phase = "ready" | "showing" | "input" | "over";

/** Pad colours: lit, and the dark resting state. Purple is the fifth. */
const PADS = [
  { name: "green", lit: "bg-emerald-400", rest: "bg-emerald-500/20" },
  { name: "red", lit: "bg-rose-400", rest: "bg-rose-500/20" },
  { name: "yellow", lit: "bg-amber-300", rest: "bg-amber-400/20" },
  { name: "blue", lit: "bg-sky-400", rest: "bg-sky-500/20" },
  { name: "purple", lit: "bg-violet-400", rest: "bg-violet-500/20" },
] as const;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function SimonGame({ seed, targetScore, onFinished, onClose }: Props) {
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
    const dark = gapMs(round);

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
    const timer = setTimeout(() => finish(round), Math.max(0, MAX_GAME_MS - elapsed));
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
      setTimeout(() => setLit((current) => (current === pad ? null : current)), 160);

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
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0B0B0D] text-white">
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
        <div className="text-center">
          <div className="text-[12px] uppercase tracking-wider text-white/40">
            {phase === "over" ? "Final" : `Round ${round}`}
          </div>
          <div className="text-[20px] font-semibold tabular-nums">{score}</div>
        </div>
        <div className="w-[68px] text-right text-[13px] tabular-nums text-white/40">
          {targetScore !== undefined ? `Beat ${targetScore}` : ""}
        </div>
      </div>

      {/* The board. Square, centred, and sized to whichever of width or height
          runs out first, so it fits a short phone in landscape as well as a
          tall one upright. */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="flex w-full max-w-[min(88vw,52vh)] flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {PADS.slice(0, BASE_PADS).map((pad, index) => (
              <Pad
                key={pad.name}
                pad={pad}
                index={index}
                lit={lit === index}
                live={phase === "input"}
                inPlay
                onPress={press}
              />
            ))}
          </div>
          {/* Held open from round one so the board never resizes mid-game. */}
          <Pad
            pad={PADS[BASE_PADS]}
            index={BASE_PADS}
            lit={lit === BASE_PADS}
            live={phase === "input"}
            inPlay={padsInPlay === MAX_PADS}
            wide
            onPress={press}
          />
        </div>
      </div>

      {/* The one line of state, and the one action. */}
      <div
        className="shrink-0 px-6 pt-2 text-center"
        style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom, 0px))" }}
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
            {round === FIFTH_PAD_ROUND ? "Purple is in play now — watch" : "Watch…"}
          </p>
        )}

        {phase === "input" && (
          <p className="py-4 text-[15px] text-white/50" aria-live="polite">
            Your turn — {round - pressed.length} to go
          </p>
        )}

        {phase === "over" && (
          <>
            <p className="mb-1 text-[17px] font-semibold" aria-live="polite">
              {targetScore === undefined
                ? `You scored ${score}`
                : beatTarget
                  ? `You got ${score} — you win`
                  : `You got ${score}`}
            </p>
            <p className="mb-4 text-[14px] text-white/50">
              {targetScore !== undefined && !beatTarget
                ? `${targetScore} still stands.`
                : "Sent to the chat."}
            </p>
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
  );
}

function Pad({
  pad,
  index,
  lit,
  live,
  inPlay,
  wide,
  onPress,
}: {
  pad: (typeof PADS)[number];
  index: number;
  lit: boolean;
  live: boolean;
  inPlay: boolean;
  wide?: boolean;
  onPress: (pad: number) => void;
}) {
  return (
    <button
      type="button"
      // A pad that is not in play yet is not a disabled control the player
      // should try — it is scenery, so it is removed from the tab order and
      // from the accessibility tree rather than announced as unavailable.
      aria-hidden={!inPlay}
      tabIndex={inPlay && live ? 0 : -1}
      disabled={!inPlay || !live}
      aria-label={`${pad.name} pad`}
      onPointerDown={() => onPress(index)}
      className={[
        "touch-manipulation select-none rounded-2xl transition-[background-color,transform] duration-100",
        wide ? "h-[18%] min-h-16" : "aspect-square",
        !inPlay ? "bg-white/[0.03]" : lit ? `${pad.lit} scale-[0.98]` : pad.rest,
        inPlay && live ? "cursor-pointer" : "cursor-default",
      ].join(" ")}
    />
  );
}

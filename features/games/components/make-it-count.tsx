"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlayerPass } from "@/features/games/hooks/use-player-pass";
import { useMe } from "@/hooks/use-me";
import { MARKET_FLAGS } from "@/lib/market-config";
import {
  checkName,
  type NameAvailability,
} from "@/features/games/lib/pass-chain";
import {
  USERNAME_MAX,
  nameProblem,
  nameProblemMessage,
  sanitiseName,
} from "@/lib/game-pass";

/**
 * Turning a played score into a counted one.
 *
 * ─── IT APPEARS AFTER THE GAME, NEVER BEFORE IT ─────────────────────────────
 * Nothing here is in anybody's way. A player arrives, plays, and sees their
 * score; only then is there any mention of a name or of proving they are a
 * person. Asking first would cost more players than the leaderboard is worth,
 * and their score already reached GameArena's board regardless.
 *
 * ─── NO CHAIN VOCABULARY, ANYWHERE ──────────────────────────────────────────
 * "Get your player name", "Prove you're a real person", "Your scores count."
 * Not wallet, not mint, not gas, not transaction, not Celo. The one screen
 * whose words we do not own is GoodDollar's own, and that is unavoidable
 * because it is their flow on their origin.
 */
export function MakeItCount({ returnTo }: { returnTo: string }) {
  const {
    loading,
    available,
    hasPass,
    username,
    verified,
    everVerified,
    startVerification,
    claimName,
  } = usePlayerPass();

  /*
    THE FIELD OPENS ON THEIR SQUARE HANDLE.

    Somebody who plays a game in Square and is then asked to invent a name has
    been handed a small puzzle for no reason — the name they want is almost
    always the one they already go by here. So the field is SEEDED with it and
    checked like anything else: free, and one tap takes it; taken, and they are
    asked for another exactly as before.

    A suggestion, never a claim. Nothing is minted until they press the button,
    and the name still binds to THEIR wallet — so this cannot hand anybody
    somebody else's name, which is the trap in matching handles across two
    systems.

    Stored as null-until-typed and DERIVED at read, rather than seeded through
    an effect: writing state from an effect body is a cascading render, and the
    suggestion is a pure function of the profile.
  */
  const me = useMe();
  const suggestion = sanitiseName(me.data?.username ?? "");
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? suggestion;
  const setName = setTyped;
  /*
    THE ANSWER IS STORED WITH THE NAME IT IS ABOUT, and read back only while
    the two still match.

    A bare verdict means a reply landing after another keystroke describes the
    PREVIOUS name — so somebody types past a taken name and the field tells
    them their new one is gone. Keying it makes a stale answer simply not
    apply: nothing to clear, and no setState in an effect to clear it with.
  */
  const [checked, setChecked] = useState<{
    name: string;
    result: NameAvailability;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availability = checked && checked.name === name ? checked.result : null;

  /*
    Availability is checked as they type, debounced, because finding out a
    name is taken only after committing to it is the single most annoying
    thing about claiming a name anywhere.
  */
  useEffect(() => {
    if (nameProblem(name) !== null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setChecking(true);
      void checkName(name).then((result) => {
        if (cancelled) return;
        setChecked({ name, result });
        setChecking(false);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name]);

  const onVerify = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await startVerification(returnTo);
    // On success the page is already navigating away, so `busy` deliberately
    // stays true — releasing it would flash an enabled button during the
    // handover.
    if (!result.ok) {
      setError(result.error ?? "Could not start.");
      setBusy(false);
    }
  }, [startVerification, returnTo]);

  const onClaim = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await claimName(name);
    if (!result.ok) {
      setError(result.error ?? "Could not claim that name.");
      // The name may have gone while they typed, so anything we hold about it
      // is no longer worth showing.
      setChecked(null);
    }
    setBusy(false);
  }, [claimName, name]);

  // Nothing while we genuinely do not know yet.
  if (loading) return null;

  /*
    UNREACHABLE IS SHOWN, NOT HIDDEN.

    This used to render nothing when the arena could not be reached, on the
    reasoning that an offer leading nowhere is worse than silence. That was
    wrong here, and this repo already says why: a capability that is off is
    VISIBLE and INERT, never deleted — deleting it silently loses the roadmap,
    and leaving it live tells a lie.

    Rendering nothing made "we cannot reach the arena" indistinguishable from
    "this was never built", which is exactly the confusion it caused: the flow
    was complete and committed, and looked absent. So the step is stated and
    the control is a real disabled button.
  */
  if (!available) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left">
        <p className="text-[14px] font-semibold text-white">
          Make your scores count
        </p>
        <p className="mt-1 text-[13px] leading-5 text-white/55">
          Prove you&rsquo;re a real person once and every game you play here
          counts on the leaderboard. Can&rsquo;t reach the arena right now —
          your score is saved in this chat either way.
        </p>
        <button
          type="button"
          disabled
          className="ws-press mt-2.5 w-full cursor-default rounded-full bg-white/10 px-4 py-2 text-[14px] font-semibold text-white/40"
        >
          Unavailable right now
        </button>
      </div>
    );
  }

  /*
    THE ORDER IS A FLAG, NOT A DECISION MADE HERE.

    In production verification is REQUIRED: a score only counts for GameArena
    when it belongs to a verified human, which is the whole point of the
    integration. `gamesVerifyOptional` reverses it for testing so the name
    claim can be exercised without standing through a face scan every time.

    Keeping it as a flag means switching production back is one variable, and
    nobody has to remember which branch the real rule lives on.
  */
  const verifyOffer = (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left">
      <p className="text-[14px] font-semibold text-white">
        {everVerified ? "Verify again" : "Make your scores count"}
      </p>
      {/*
        A LAPSE IS NOT A BLANK. GoodDollar's first window is three days, so
        somebody who verified last week is not verified now — and telling them
        to prove they are a real person "once" denies what they already did.
      */}
      <p className="mt-1 text-[13px] leading-5 text-white/55">
        {everVerified
          ? "Your check expired — GoodDollar asks again after a few days. One more and your games count."
          : MARKET_FLAGS.gamesVerifyOptional
            ? "Optional for now. Prove you're a real person and your games count on the leaderboard."
            : "Prove you're a real person once, and every game you play here counts on the leaderboard."}
      </p>
      {error && <p className="mt-2 text-[13px] text-rose-300">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => void onVerify()}
        className="ws-press mt-2.5 w-full rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black disabled:opacity-50"
      >
        {busy
          ? "Opening…"
          : everVerified
            ? "Verify again"
            : "Prove you're a real person"}
      </button>
    </div>
  );

  if (hasPass) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-white/45">
          {verified
            ? `Your scores count${username ? ` as ${username}` : ""}.`
            : `You're ${username ?? "set up"} — verify to make your scores count.`}
        </p>
        {!verified && verifyOffer}
      </div>
    );
  }

  // The production rule: no name until they are a verified human.
  if (!verified && !MARKET_FLAGS.gamesVerifyOptional) return verifyOffer;

  const problem = nameProblem(name);
  const canClaim = problem === null && availability === "available" && !busy;

  return (
    <div className="space-y-2">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left">
        <p className="text-[14px] font-semibold text-white">
          Get your player name
        </p>
        <p className="mt-1 text-[13px] leading-5 text-white/55">
          {typed === null && suggestion
            ? "We've put your Square name in. Each name can only be taken once — if it's gone, pick another."
            : "This is the name on the leaderboard. Each one can only be taken once."}
        </p>

        <input
          id="player-name"
          value={name}
          onChange={(event) => {
            // Shaped as they type, so the field can never hold a name that
            // would be refused — and a long paste is trimmed once, here, rather
            // than silently becoming a different name later.
            setName(sanitiseName(event.target.value));
            setError(null);
          }}
          maxLength={USERNAME_MAX}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="yourname"
          aria-label="Your player name"
          className="mt-2.5 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[15px] text-white outline-none placeholder:text-white/25 focus:border-white/25"
        />

        <p className="mt-1.5 min-h-5 text-[13px]">
          {error ? (
            <span className="text-rose-300">{error}</span>
          ) : name && problem ? (
            <span className="text-white/45">{nameProblemMessage(problem)}</span>
          ) : checking && !availability ? (
            <span className="text-white/35">Checking…</span>
          ) : availability === "available" ? (
            <span className="text-emerald-300">{name} is free</span>
          ) : availability === "taken" ? (
            <span className="text-amber-300">Taken — pick another</span>
          ) : availability === "unknown" ? (
            // Never claim a name is free when the check failed: that ends in a
            // refusal the player waited for and cannot learn anything from.
            <span className="text-white/45">
              Couldn&rsquo;t check that just now
            </span>
          ) : null}
        </p>

        <button
          type="button"
          disabled={!canClaim}
          onClick={() => void onClaim()}
          className="ws-press mt-1 w-full rounded-full bg-white px-4 py-2 text-[14px] font-semibold text-black disabled:opacity-50"
        >
          {busy ? "Getting it…" : "Get this name"}
        </button>
      </div>
      {!verified && verifyOffer}
    </div>
  );
}

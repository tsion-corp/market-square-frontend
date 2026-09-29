import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * THE RULES THE GAMES INTEGRATION RESTS ON, WRITTEN DOWN WHERE THEY BREAK.
 *
 * Every one of these was a decision with a reason, and every one of them is
 * the kind that survives a typecheck, a lint and a green build while being
 * quietly wrong — a credential that gains a NEXT_PUBLIC_ prefix, a verified
 * flag that starts being cached, a wallet read from a request body. Source
 * level, because none of it can be proved from rendered HTML: the game is
 * behind a client gate, and the credential is meant to never reach a browser
 * at all.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const scoreRoute = stripComments(read("app/api/gamearena/score/route.ts"));
const profileRoute = stripComments(read("app/api/gamearena/profile/route.ts"));
const serverConfig = stripComments(read("lib/server/gamearena.ts"));
const host = stripComments(read("features/games/components/challenge-host.tsx"));
const card = stripComments(read("components/ui/challenge-slot.tsx"));
const thread = stripComments(read("features/messages/components/thread.tsx"));
const messagesScreen = stripComments(read("components/layout/messages-screen.tsx"));
const passHook = stripComments(read("features/games/hooks/use-player-pass.ts"));
const makeItCount = stripComments(read("features/games/components/make-it-count.tsx"));
const reportClient = stripComments(read("features/games/lib/report-score.ts"));

/*
  THE PARTNER KEY IS THE WHOLE AUTHORITY UPSTREAM. Whoever holds it can write
  any score against any wallet, for as long as it lives. A NEXT_PUBLIC_ prefix
  on it would put it in every visitor's bundle, and nothing about the app would
  look different.
*/
describe("the partner key never leaves the server", () => {
  it("is read without a NEXT_PUBLIC_ prefix", () => {
    assert.match(serverConfig, /process\.env\.GAMEARENA_PARTNER_KEY/);
    assert.doesNotMatch(serverConfig, /NEXT_PUBLIC_GAMEARENA/);
  });

  it("is never named in a file the browser receives", () => {
    for (const [name, source] of [
      ["challenge-host", host],
      ["challenge-slot", card],
      ["use-player-pass", passHook],
      ["make-it-count", makeItCount],
      ["report-score", reportClient],
    ] as const) {
      assert.doesNotMatch(source, /GAMEARENA_PARTNER_KEY|x-partner-key/, name);
    }
  });

  it("is attached in exactly one place, so no call site can forget or log it", () => {
    assert.match(serverConfig, /"x-partner-key": KEY/);
    // The routes call the shared helper rather than building their own headers.
    assert.doesNotMatch(scoreRoute, /x-partner-key/);
    assert.doesNotMatch(profileRoute, /x-partner-key/);
    assert.match(scoreRoute, /gameArenaFetch\(/);
    assert.match(profileRoute, /gameArenaFetch\(/);
  });
});

/*
  UPSTREAM KEYS EVERYTHING ON THE WALLET IT IS HANDED — the same hazard the
  KASH proxy carries. A wallet taken from the request would let any signed-in
  player credit their plays to somebody else's address, or bury a rival's board
  under zeroes.
*/
describe("the wallet comes from the session, never the request", () => {
  it("resolves it from the verified session in both routes", () => {
    for (const [name, source] of [
      ["score", scoreRoute],
      ["profile", profileRoute],
    ] as const) {
      assert.match(source, /const claims = await verifyRequest\(req\)/, name);
      assert.match(source, /await getRequestWallet\(req, claims\)/, name);
    }
  });

  it("never reads a wallet out of the body", () => {
    assert.doesNotMatch(scoreRoute, /body\.wallet|report\.wallet|\bparsed\.wallet/);
  });

  it("sends upstream the wallet it resolved, not one it was given", () => {
    // `wallet` here is the const from getRequestWallet; a body-supplied one
    // would have to be a different identifier.
    assert.match(scoreRoute, /JSON\.stringify\(\{\s*wallet,/);
  });
});

/*
  A FIRST GOODDOLLAR VERIFICATION LAPSES AFTER THREE DAYS. Caching "verified"
  anywhere reproduces the exact complaint GameArena's own players made: they
  verified, and days later were told they had not. The pass is the opposite —
  soulbound and permanent — which is why scores keep counting when verification
  does not.
*/
describe("verification is never cached, at any layer", () => {
  it("is fetched no-store by the client", () => {
    // Whitespace-tolerant: prettier decides where this call wraps, and the
    // rule being pinned is "no-store on the profile fetch", not its formatting.
    assert.match(
      passHook,
      /fetch\(\s*api\("\/api\/gamearena\/profile"\),\s*\{\s*cache:\s*"no-store",?\s*\}\s*\)/,
    );
  });

  it("is answered no-store by the route", () => {
    assert.match(profileRoute, /"cache-control": "no-store, max-age=0, must-revalidate"/);
  });

  it("reads the flag fresh rather than remembering it across a session", () => {
    // No module-level cache of the answer: the state lives in the hook and is
    // reloaded, never stored outside React where it would outlive a mount.
    assert.doesNotMatch(passHook, /localStorage|sessionStorage/);
  });
});

/*
  A SCORE THAT REACHES A LEADERBOARD MUST COME FROM A GAME. A challenge message
  is text, and anybody can type one — so the number parsed out of a message may
  render on a card, and must never be reportable.
*/
describe("a reported score comes from play, never from a message", () => {
  it("is reported only where a game finished", () => {
    assert.match(host, /onFinished=\{\(score\) => \{/);
    assert.match(host, /void reportScore\(score\)/);
  });

  it("is never reported from the card that renders a parsed challenge", () => {
    assert.doesNotMatch(card, /reportScore/);
    assert.doesNotMatch(thread, /reportScore/);
  });

  it("does not let the parser feed the reporter", () => {
    // parseChallenge is for drawing and for the inbox line; it must not be a
    // source of numbers that travel anywhere.
    assert.doesNotMatch(reportClient, /parseChallenge/);
  });
});

/*
  THE GAME IS MOUNTED ABOVE THE MESSAGE LIST. Inside it, a fixed full-screen
  overlay is created and destroyed as the list virtualises — taking the round
  in progress with it.
*/
describe("the game outlives the list it was opened from", () => {
  it("is mounted by the layout, around the whole screen", () => {
    assert.match(messagesScreen, /<ChallengeHost>/);
    assert.match(messagesScreen, /<\/ChallengeHost>/);
  });

  it("is not mounted inside the thread", () => {
    assert.doesNotMatch(thread, /ChallengeHost/);
  });

  it("keeps the slices apart — messages never imports games", () => {
    assert.doesNotMatch(thread, /@\/features\/games/);
    assert.match(thread, /from "@\/components\/ui\/challenge-slot"/);
  });

  it("withdraws the thread's sender on the way out", () => {
    // Without this a game finished after the reader left posts into a thread
    // they are no longer in.
    assert.match(thread, /return \(\) => registerSender\(null\)/);
  });
});

/*
  NO CHAIN VOCABULARY, ANYWHERE A PLAYER READS. The one screen whose words we
  do not own is GoodDollar's own, unavoidably, because it is their flow on
  their origin.
*/
describe("the words are the player's, not the chain's", () => {
  const CHAIN_WORDS = /\b(wallet|mint|gas|blockchain|crypto|token|Celo|on-chain|transaction)\b/i;

  it("keeps them out of what the claim screen renders", () => {
    // Strings inside JSX text and button labels — the parts a player reads.
    const visible = makeItCount
      .split("\n")
      .filter((line) => /^\s*[A-Z"'{]|>/.test(line))
      .join("\n");
    const offenders = visible
      .split("\n")
      .filter((line) => /(?:^|>)[^<>{}]*[a-z]{3}/.test(line) && CHAIN_WORDS.test(line));
    assert.deepEqual(offenders, [], `chain vocabulary reached the player: ${offenders.join(" | ")}`);
  });

  it("says the three things it is supposed to say", () => {
    assert.match(makeItCount, /Make your scores count/);
    assert.match(makeItCount, /Prove you&rsquo;re a real person|Prove you're a real person/);
    assert.match(makeItCount, /Get your player name/);
  });
});

/*
  THE OFFER COMES AFTER THE GAME. Their score already reached GameArena's board
  either way, so asking for a name or a face scan first costs players for
  nothing.
*/
describe("nothing is asked before somebody has played", () => {
  it("is rendered as the end screen's footer, not beside the composer", () => {
    assert.match(host, /footerSlot=\{/);
    assert.match(host, /<MakeItCount/);
    // The tray opens a game; it must not open the claim flow.
    assert.doesNotMatch(thread, /MakeItCount/);
  });
});

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
const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const scoreRoute = stripComments(read("app/api/gamearena/score/route.ts"));
const profileRoute = stripComments(read("app/api/gamearena/profile/route.ts"));
const serverConfig = stripComments(read("lib/server/gamearena.ts"));
const host = stripComments(
  read("features/games/components/challenge-host.tsx"),
);
const card = stripComments(read("components/ui/challenge-slot.tsx"));
const thread = stripComments(read("features/messages/components/thread.tsx"));
const messagesScreen = stripComments(
  read("components/layout/messages-screen.tsx"),
);
const passHook = stripComments(read("features/games/hooks/use-player-pass.ts"));
const makeItCount = stripComments(
  read("features/games/components/make-it-count.tsx"),
);
const reportClient = stripComments(read("features/games/lib/report-score.ts"));
const faucetRoute = stripComments(read("app/api/gamearena/faucet/route.ts"));
const gaConfig = stripComments(read("lib/server/gamearena.ts"));
const readChain = read("features/games/lib/pass-chain.ts");
const providers = stripComments(read("app/providers.tsx"));
/*
  RAW, because stripComments deletes from "//" to end of line and a URL
  contains "//" — the stripped copy truncates "https://forno.celo.org" to
  "https:" and an assertion about an endpoint can never match it.
*/
const providersRaw = read("app/providers.tsx");
const gamePass = stripComments(read("lib/game-pass.ts"));
const evmSend = stripComments(read("hooks/use-evm-send.ts"));

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
    assert.doesNotMatch(
      scoreRoute,
      /body\.wallet|report\.wallet|\bparsed\.wallet/,
    );
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
  it("is read from the chain on every mount, not from a server that can fail", () => {
    /*
      The gating question used to travel through our BFF, which resolved the
      wallet from the session and asked GameArena. Each hop is a way to fail
      while the answer sits in public state the browser can read — and it DID
      fail: the session wallet lookup broke locally and the whole step reported
      itself unavailable with a working chain, a working partner API and a
      correct key. `isWhitelisted` is the live question, window included.
    */
    assert.match(passHook, /readIdentity\(address\)/);
    assert.match(passHook, /readPass\(address\)/);
    /*
      getWhitelistedRoot, NOT isWhitelisted. GoodDollar lets a wallet be linked
      to a root identity, and only the root lookup resolves through that link —
      so asking isWhitelisted about a linked wallet returns false and sends a
      genuinely verified human through a face scan they have already passed.
      This is how GameArena read it, and the reason is worth keeping.
    */
    assert.match(readChain, /functionName: "getWhitelistedRoot"/);
    assert.doesNotMatch(readChain, /functionName: "isWhitelisted"/);
  });

  it("never treats a failed verification read as unverified", () => {
    // Saying "not verified" when the read failed sends somebody who already
    // verified back through a face scan.
    assert.match(readChain, /A FAILED READ IS NOT "NOT VERIFIED"/);
  });

  it("is answered no-store by the route", () => {
    assert.match(
      profileRoute,
      /"cache-control": "no-store, max-age=0, must-revalidate"/,
    );
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
  const CHAIN_WORDS =
    /\b(wallet|mint|gas|blockchain|crypto|token|Celo|on-chain|transaction)\b/i;

  it("keeps them out of what the claim screen renders", () => {
    // Strings inside JSX text and button labels — the parts a player reads.
    const visible = makeItCount
      .split("\n")
      .filter((line) => /^\s*[A-Z"'{]|>/.test(line))
      .join("\n");
    const offenders = visible
      .split("\n")
      .filter(
        (line) =>
          /(?:^|>)[^<>{}]*[a-z]{3}/.test(line) && CHAIN_WORDS.test(line),
      );
    assert.deepEqual(
      offenders,
      [],
      `chain vocabulary reached the player: ${offenders.join(" | ")}`,
    );
  });

  it("says the three things it is supposed to say", () => {
    assert.match(makeItCount, /Make your scores count/);
    assert.match(
      makeItCount,
      /Prove you&rsquo;re a real person|Prove you're a real person/,
    );
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

/*
  THE VERIFICATION SIGNATURE IS HEX, AND NOTHING LOCAL CAN TELL YOU OTHERWISE.

  `personal_sign` takes its message as a hex string. Passing the raw text with
  a TypeScript cast to satisfy the type compiles, runs, and returns a perfectly
  well-formed signature — of the wrong thing. GoodDollar then recovers a
  different address, or none, and the only symptom is their own "Login
  information is missing" screen at the end of the flow, with no error raised
  anywhere in our code.

  It shipped exactly once, and was found by a person standing in front of that
  screen rather than by any check.
*/
describe("the GoodDollar signature is signed over hex", () => {
  it("hex-encodes the message before personal_sign", () => {
    assert.match(
      passHook,
      /params:\s*\[toHex\(fvMessage\(address\)\), address\]/,
    );
  });

  it("never passes the raw message with a cast instead", () => {
    assert.doesNotMatch(passHook, /fvMessage\(address\) as `0x\$\{string\}`/);
  });

  it("refuses a signature that is not 65 bytes rather than forwarding it", () => {
    // Sending a malformed signature moves the failure onto GoodDollar's screen,
    // where we can neither see it nor explain it to the player.
    assert.match(passHook, /\^0x\[0-9a-fA-F\]\{130\}\$/);
  });
});

/*
  A LAPSE IS NOT A BLANK.

  GoodDollar's FIRST window is three days. Somebody who verified last week is
  genuinely not verified now — and `isWhitelisted` collapses that into the same
  false as never having verified at all. Telling them to prove they are a real
  person "once" denies something they already did, which is how you lose the
  person who was nearly through.
*/
describe("an expired verification is said differently from a missing one", () => {
  it("distinguishes the two on chain rather than collapsing them", () => {
    assert.match(readChain, /everVerified/);
    assert.match(readChain, /reverifyDaysOptions/);
  });

  it("says verify AGAIN when they have been through it before", () => {
    assert.match(makeItCount, /everVerified/);
    assert.match(makeItCount, /Verify again/);
    assert.match(makeItCount, /Your check expired/);
  });

  it("does not trust authenticationPeriod, which is the documented trap", () => {
    // The contract stores it as unused_authenticationPeriod and its getter
    // returns the LAST schedule entry, so an authCount-0 wallet reads 180 days
    // when it really has three.
    assert.doesNotMatch(readChain, /functionName: "authenticationPeriod"/);
  });
});

/*
  THE NAME FIELD SUGGESTS; IT NEVER CLAIMS.

  Seeding the field with somebody's Square handle is a convenience. Claiming
  one on their behalf would be something else entirely — and matching handles
  across two systems is exactly how one person ends up holding a name that
  belongs to another. The claim stays behind a press, and the name still binds
  to the wallet that signs it.
*/
describe("the player name is suggested, not assumed", () => {
  it("opens the field on their Square handle", () => {
    assert.match(makeItCount, /useMe\(\)/);
    assert.match(makeItCount, /sanitiseName\(me\.data\?\.username \?\? ""\)/);
  });

  it("only ever claims from an explicit press", () => {
    // onClaim must be reachable from the button and from nothing else — no
    // effect, no auto-submit on a free name.
    assert.match(makeItCount, /onClick=\{\(\) => void onClaim\(\)\}/);
    const effects = makeItCount.match(/useEffect\(/g) ?? [];
    assert.equal(
      effects.length,
      1,
      "a second effect here would be the one that auto-claims",
    );
    assert.doesNotMatch(makeItCount, /useEffect\([\s\S]{0,400}?onClaim\(/);
  });

  it("still checks a suggested name like any other", () => {
    // A seeded name is not a trusted one: it goes through the same contract
    // check, so a taken handle is refused rather than attempted.
    assert.match(makeItCount, /availability === "available"/);
  });
});

/*
  THE SESSION MUST BE ALLOWED TO SIGN ON CELO.

  The chain set is declared when a wallet session opens, and a chain outside it
  cannot be signed for at all. Claiming a player name is a Celo transaction, so
  dropping 42220 from that list breaks the claim — and it fails with "Request
  exceeds defined limit", which reads like a spending cap rather than a missing
  chain, so nobody would look here.
*/
describe("the wallet session may sign on Celo", () => {
  it("declares 42220 alongside the chains Square actually spends on", () => {
    assert.match(providers, /"evm:42220"/);
    // Base must not be lost in the process — every payment in Square is there.
    assert.match(providers, /"evm:8453"/);
  });

  it("also gives it an endpoint, which declaring alone does not", () => {
    /*
      Decane carries its own RPC for the chains it ships with and refuses a
      chain it has none for — "No RPC URL for evm:42220" — rather than
      guessing. Declaring the chain and supplying its endpoint are two separate
      gates, and the claim failed at the second after passing the first.
    */
    assert.match(providersRaw, /rpcUrls:\s*\{\s*"evm:42220":\s*"https:\/\/[^"]+"/);
  });

  it("uses the same chain id the claim is actually built for", () => {
    // The claim is assembled in lib/game-pass.ts; a session allowed on one
    // chain while the transaction targets another fails at the wallet with a
    // message that names neither.
    assert.match(gamePass, /CELO_CHAIN_ID = 42220/);
    assert.match(gamePass, /chainId: CELO_CHAIN_ID/);
  });
});

/*
  THE OPT-OUT HAS TO BE HONOURED, NOT JUST DECLARED.

  mintCall asking to pay its own gas is worth nothing if the send path ignores
  it: the claim goes back onto Square's sponsored policy, spends Square's money
  on another product's players, and fails in our bundler proxy.
*/
describe("paying your own gas is actually honoured", () => {
  it("skips the sponsored path when the caller asks to", () => {
    assert.match(evmSend, /payOwnGas \? null : getSponsoredEvmChainById\(chainId\)/);
  });

  it("still sponsors by default, so Square's own payments are untouched", () => {
    // Every payment in Square is USDC on Base and MUST stay sponsored — an
    // embedded wallet funded with USDC alone has no ETH for gas.
    assert.match(evmSend, /const sponsored = payOwnGas \? null/);
    assert.doesNotMatch(evmSend, /const sponsored = null/);
  });
});

/*
  THE FAUCET MOVES MONEY, SO IT IS THE STRICTEST ROUTE IN THE SET.

  A wallet taken from the request body would let anyone signed in aim a drip at
  an address they do not own — a drain dressed as an onboarding step, repeatable
  as fast as accounts can be made.
*/
describe("asking for gas cannot be aimed at somebody else", () => {
  it("resolves the wallet from the session and reads nothing from the request", () => {
    assert.match(faucetRoute, /await getRequestWallet\(req, claims\)/);
    /*
      The hazard is the REQUEST body, not the upstream response — this route
      reads the latter to tell a refusal apart from a success. So the rule is
      that nothing is ever taken off `req`, which is what a caller could
      control.
    */
    assert.doesNotMatch(faucetRoute, /req\.json\(\)|req\.text\(\)|body\.wallet|body\.address/);
  });

  it("sends upstream only the wallet it resolved", () => {
    // Their faucet's field is `address`; the value is still the session's.
    assert.match(faucetRoute, /JSON\.stringify\(\{ address: wallet \}\)/);
  });

  it("refuses a signed-out caller outright", () => {
    assert.match(faucetRoute, /if \(!claims\) return NextResponse\.json\(\s*\{ error: "sign in first" \}/);
  });

  it("carries the partner key through the shared helper, never its own header", () => {
    assert.match(faucetRoute, /gameArenaFetch\(/);
    assert.doesNotMatch(faucetRoute, /x-partner-key/);
  });
});

/*
  A DRIP IS ONLY EVER REQUESTED BY A CLAIM THAT NEEDED ONE.

  The mint is attempted first: a wallet that cannot pay is refused by the node
  before anything is broadcast, so the attempt costs nothing and a player who
  already has gas never triggers a drip.
*/
describe("gas is asked for only when the claim actually failed for it", () => {
  it("attempts the mint before asking", () => {
    assert.ok(
      passHook.indexOf("attemptMint()") < passHook.indexOf("requestGas()"),
      "a drip must never be requested before the claim has been tried",
    );
  });

  it("waits for the money to land before minting again", () => {
    // The faucet answering means it SENT. Minting against a balance still in
    // flight fails exactly as before and reads as the top-up doing nothing.
    assert.ok(passHook.indexOf("waitForGas(") < passHook.lastIndexOf("attemptMint()"));
  });
});

/*
  THEIR FAUCET TAKES `address`. THEIR SCORE ROUTE TAKES `wallet`.

  Sending the wrong one is accepted as a request carrying no address rather
  than refused, so it would fail as "this player cannot be funded" instead of
  as a bad call — a wrong field wearing the costume of an empty wallet.
*/
describe("the faucet is called the way GameArena documented it", () => {
  it("sends the address field, not the wallet field", () => {
    assert.match(faucetRoute, /JSON\.stringify\(\{ address: wallet \}\)/);
    assert.doesNotMatch(faucetRoute, /JSON\.stringify\(\{ wallet \}\)/);
  });

  it("keeps every refusal distinct instead of collapsing them", () => {
    // Collapsing them tells a player to try again when what they need is to
    // verify — and they would try again forever, because it cannot work.
    for (const reason of ["unverified", "already_claimed", "daily_cap", "faucet_empty", "not_fresh"]) {
      assert.match(passHook + reportClient, new RegExp(reason), reason);
    }
  });

  it("does not wait for money that was never sent", () => {
    // not_fresh means the wallet already holds enough, so there is nothing in
    // flight — waiting would sit out the whole timeout for no reason.
    assert.match(passHook, /if \(gas\.outcome !== "not_fresh"\) \{[\s\S]{0,200}?waitForGas/);
  });

  it("never forwards an unknown upstream reason to a player as copy", () => {
    assert.match(reportClient, /KNOWN_OUTCOMES\.has\(reason\)/);
  });
});

/*
  A TIMEOUT SHORTER THAN THE WORK REPORTS A FAILURE THAT DID NOT HAPPEN.

  The faucet BROADCASTS a transfer — it submits a transaction and waits on a
  node — so it cannot answer within the timeout used for reads. It shipped at
  five seconds: the request succeeded, 0.1 CELO landed, and the player was told
  their account could not be funded while the money was arriving in it.
*/
describe("the faucet is given time to actually send", () => {
  it("uses a write-length timeout, not the read one", () => {
    assert.match(faucetRoute, /timeoutMs: GAMEARENA_WRITE_TIMEOUT_MS/);
    assert.match(gaConfig, /GAMEARENA_WRITE_TIMEOUT_MS = 45_000/);
  });

  it("keeps reads on the short timeout, so a slow board never holds a screen", () => {
    assert.match(gaConfig, /GAMEARENA_TIMEOUT_MS = 5000/);
    assert.doesNotMatch(scoreRoute, /timeoutMs/);
    assert.doesNotMatch(profileRoute, /timeoutMs/);
  });
});

/*
  A TIMED-OUT FAUCET CALL IS NOT A FAILED ONE.

  It broadcasts a transfer, so "slow" and "refused" are indistinguishable from
  the client. Treating them the same is what told a player their account could
  not be funded while 0.1 CELO was landing in it — and burned their one drip,
  since theirs is one per wallet ever.

  The reply decides only whether money COULD be coming. Whether it arrived is
  answered by the balance, which cannot be wrong.
*/
describe("whether the gas arrived is decided by the chain", () => {
  it("reads the balance BEFORE asking, so an arrival can be recognised", () => {
    assert.ok(
      passHook.indexOf("const before = await readBalance(address)") <
        passHook.indexOf("const gas = await requestGas()"),
      "the starting balance must be taken before the request, or a drip that lands fast is missed",
    );
  });

  it("still waits on the balance when the request itself was ambiguous", () => {
    // "refused" and "unreachable" include a request that went through and was
    // simply not heard, so neither may short-circuit the wait.
    assert.doesNotMatch(passHook, /outcome === "refused"[\s\S]{0,120}?return \{/);
    assert.doesNotMatch(passHook, /outcome === "unreachable"[\s\S]{0,120}?return \{/);
  });

  it("does not wait on a definitive no", () => {
    // Nothing was sent and nothing will arrive, so watching the balance would
    // just spend the timeout.
    for (const reason of ["unverified", "already_claimed", "daily_cap", "faucet_empty"]) {
      assert.match(passHook, new RegExp(`outcome === "${reason}"`), reason);
    }
  });
});

/*
  A CLAIM THAT WORKED MUST SAY SO.

  The first real mint succeeded and showed the player nothing: the card
  quietly became a different card, which nobody reads as "done". So they
  pressed again, the contract refused the duplicate, and the only visible
  feedback from the entire flow was an error over a name they already owned.
*/
describe("claiming a name has a visible success", () => {
  it("records the moment and names the name", () => {
    assert.match(makeItCount, /setJustClaimed\(name\)/);
    assert.match(makeItCount, /\{justClaimed\} is yours/);
  });

  it("treats a duplicate as done, not as a failure", () => {
    // The player holds the pass; reporting a failure over an accomplished
    // fact is how somebody presses a third time.
    assert.match(passHook, /already minted[\s\S]{0,300}?return \{ ok: true \}/);
  });
});

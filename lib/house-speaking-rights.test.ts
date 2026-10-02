import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

/*
  SPEAKING RIGHTS IN A HOUSE — MUTING, ANNOUNCEMENT MODE, AND MODERATION.

  Three settings that all take away WRITING and none of which touches READING.
  That distinction is the thing most likely to be eroded by a later edit — the
  obvious-looking "fix" for a muted member is to hide the thread, and it would
  be wrong: the service lets them read every word.

  The second thing pinned here is that the client never re-derives WHO MAY ACT
  ON WHOM. The ladder (an admin acts on members, the owner acts on admins,
  nobody acts on the owner or themselves) lives on the service and arrives as
  `canManage`. A client that recomputes it from two `role` values is a second
  copy of an authorisation rule, and the two drift silently.

  See `room-guests.test.ts` for why the URL is handed to readFileSync whole.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const thread = read("features/messages/components/thread.tsx");
const settings = read("features/messages/components/group-settings-sheet.tsx");
const types = read("features/messages/lib/types.ts");
const hooks = read("features/messages/hooks/use-messages.ts");

describe("being silenced in a house", () => {
  it("stops the composer and says which of the two reasons it is", () => {
    /*
      A mute is about this person; an announcement house is about everybody.
      Collapsing them into one message would leave a muted member thinking the
      house had been locked, and a member of an announcement house thinking they
      personally had been singled out.
    */
    assert.ok(
      thread.includes(`"You can't send messages in this group"`),
      "a muted member has to be told it is them"
    );
    assert.ok(
      thread.includes(`"Only admins can post in this group"`),
      "an admins-only house has to be told it is the house"
    );
    assert.match(
      thread,
      /const canSend = canSendMessage\(outgoing\) && !send\.isPending && !silenced/u,
      "nothing may be sent while silenced — the service answers 403"
    );
    assert.match(
      thread,
      /placeholder=\{\s*silenced \?\?/u,
      "the reason stands in the field, not beside a greyed box with no words"
    );
  });

  it("checks the mute BEFORE the house setting", () => {
    // Both can be true at once and the mute is the more specific fact.
    const muteFirst = thread.indexOf("You can't send messages in this group");
    const houseSecond = thread.indexOf("Only admins can post in this group");
    assert.ok(muteFirst > 0 && houseSecond > muteFirst, "the personal reason comes first");
  });

  it("never hides the thread from somebody who cannot write in it", () => {
    /*
      Reading is not restricted by either setting. If a future edit starts
      gating the thread on `silenced`, this is the line that should stop it.
    */
    assert.ok(
      !/silenced\s*\?\s*null\s*:\s*<Thread/u.test(thread),
      "a silenced reader still sees every message"
    );
  });

  it("silences nobody while the roster is still loading", () => {
    // A composer that greys itself out on a pending request accuses the reader
    // of something on the strength of not knowing yet.
    assert.match(
      thread,
      /const myMembership = \(members\.data\?\.items \?\? \[\]\)/u,
      "an absent roster must read as nobody muted"
    );
  });
});

describe("who may act on whom", () => {
  it("drives the mute control off the server's answer, not off a role", () => {
    assert.match(thread, /\{member\.canManage && \(/u, "the mute control reads canManage");
    assert.ok(
      !/member\.role !== "owner" && myRole === "admin"/u.test(thread),
      "the ladder must not be recomputed in the client"
    );
  });

  it("defaults canManage and muted to false, so an older service offers nothing", () => {
    assert.match(types, /canManage: z\.boolean\(\)\.optional\(\)\.default\(false\)\.catch\(false\)/u);
    assert.match(types, /muted: z\.boolean\(\)\.optional\(\)\.default\(false\)\.catch\(false\)/u);
  });

  it("keeps moderation separate from the author's own unsend", () => {
    /*
      Different acts, different rows on the service, different confirmations.
      Folding them together is how the milder copy ends up on the graver act.
    */
    assert.match(thread, /function ModerateMessageAction/u);
    assert.match(
      thread,
      /\{!mine && !removed && !invite && canModerate && \(/u,
      "moderation is offered only on somebody ELSE's message"
    );
  });

  it("tells a moderator's removal apart from an author's, and names them", () => {
    /*
      `status` is `removed` for both; `moderatedBy` is the only difference, and
      naming the person is the whole reason the field exists. "A moderator" in a
      house with three admins leaves "which one" as the question everybody then
      asks in the thread.
    */
    assert.ok(thread.includes("`Removed by ${moderatorName}`"), "name the leader who did it");
    assert.ok(thread.includes('"Removed by a moderator"'), "fall back when we cannot name them");
    assert.ok(thread.includes('"Message removed"'), "an author's own unsend stays unattributed");
    assert.match(types, /moderatedBy: z\.string\(\)\.nullable\(\)/u);
  });

  it("never prints the quote fallback as a moderator's name", () => {
    /*
      `nameOf` answers "Member" for an id it does not hold — fine inside a
      quote, and badly wrong here: "Removed by Member" reads as a bug, while
      "Removed by a moderator" is simply true. A moderator who has since left
      the house is exactly that case and becomes the common one over time.
    */
    assert.match(
      thread,
      /const moderatorNameOf = \(moderatorId: string \| null\): string \| null =>/u,
      "moderator names resolve through their own lookup, not through nameOf"
    );
    assert.ok(
      !/moderatorName=\{[^}]*nameOf\(/u.test(thread),
      "nameOf must not feed the tombstone — its fallback is a real name"
    );
  });
});

describe("the announcement-board switch", () => {
  it("is offered to leaders, which is wider than the owner-only fields", () => {
    assert.match(
      settings,
      /const isLeader = isOwner \|\| conversation\.viewerRole === "admin"/u,
      "the service lets an admin set it, so gating on the owner hides it from people who may use it"
    );
  });

  it("saves on the spot rather than with the rest of the form", () => {
    /*
      Everything else in that sheet is a draft the Save button commits. This one
      silences a hundred people, and it must not happen as a side effect of
      fixing a typo in the title.
    */
    assert.match(settings, /onClick=\{\(\) => whoCanPost\.mutate\(option\)\}/u);
  });

  it("says that reading is unaffected", () => {
    assert.ok(
      settings.includes("Everyone else still reads the whole conversation"),
      "the copy has to rule out the reading that people will assume is blocked"
    );
  });
});

describe("the moderate mutation", () => {
  it("invalidates rather than hand-patching a cache shape it does not have", () => {
    /*
      `useMessages` is a plain query, not an infinite one. A `{pages: [...]}`
      update would match nothing and silently do nothing, leaving the message
      looking un-moderated until something else refetched.
    */
    const hook = hooks.slice(hooks.indexOf("export function useModerateMessage"));
    const body = hook.slice(0, hook.indexOf("\n}"));
    assert.ok(!body.includes("setQueryData"), "do not patch a cache shape that is not there");
    assert.match(body, /invalidateQueries\(\{ queryKey: \["ms", "messages", conversationId\] \}\)/u);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGistRoomNotification, notificationHref } from "./notification-href.ts";

const ROOM_ID = "01a0a04d-c80c-7000-9afe-63d791f31488";

describe("a gist room notification never opens the broadcast player", () => {
  // The exact row ogazboiz reported: "Gist room opened — preach opened a gist
  // room in Square Talk", which landed on /live/<id> and rendered "This stream
  // has ended" under a header that still said HOUSE.
  it("routes the reported row to the room, not to /live/", () => {
    assert.equal(
      notificationHref({
        kind: "house_room",
        streamId: ROOM_ID,
        subject: { kind: "room" },
        house: { conversationId: "cv_square_talk" },
      }),
      `/gist-rooms/${ROOM_ID}`
    );
  });

  it("trusts the service's own subject.kind", () => {
    assert.equal(
      notificationHref({ kind: "speaker_request", streamId: ROOM_ID, subject: { kind: "room" } }),
      `/gist-rooms/${ROOM_ID}`
    );
  });

  it("still routes a room when the payload carries no subject at all", () => {
    // `subject` is served but undocumented, and deployed environments lag. A
    // row without it must not fall back to the wrong surface.
    assert.equal(
      notificationHref({ kind: "house_room", streamId: ROOM_ID }),
      `/gist-rooms/${ROOM_ID}`
    );
  });

  it("still routes a room when only the house is named", () => {
    assert.equal(
      notificationHref({
        kind: "unknown_future_room_kind",
        streamId: ROOM_ID,
        house: { conversationId: "cv_square_talk" },
      }),
      `/gist-rooms/${ROOM_ID}`
    );
  });
});

describe("a broadcast still opens the player", () => {
  it("sends a live stream to /live/", () => {
    assert.equal(
      notificationHref({ kind: "stream_live", streamId: "st_1", subject: { kind: "stream" } }),
      "/live/st_1"
    );
  });

  it("sends a speaker request on a VIDEO stream to /live/", () => {
    // Naming `speaker_request` as a room kind would break exactly this row.
    assert.equal(
      notificationHref({ kind: "speaker_request", streamId: "st_1", subject: { kind: "stream" } }),
      "/live/st_1"
    );
  });

  it("defaults an unclassified stream row to the player", () => {
    assert.equal(notificationHref({ kind: "stream_live", streamId: "st_1" }), "/live/st_1");
  });
});

describe("isGistRoomNotification", () => {
  it("accepts any one of the three signals on its own", () => {
    assert.equal(isGistRoomNotification({ kind: "x", subject: { kind: "room" } }), true);
    assert.equal(isGistRoomNotification({ kind: "house_room" }), true);
    assert.equal(isGistRoomNotification({ kind: "x", house: { conversationId: "c" } }), true);
  });

  it("is false for a broadcast and for a row about nothing", () => {
    assert.equal(isGistRoomNotification({ kind: "stream_live", subject: { kind: "stream" } }), false);
    assert.equal(isGistRoomNotification({ kind: "follow" }), false);
    assert.equal(isGistRoomNotification({ kind: "follow", house: null, subject: null }), false);
  });
});

describe("every other destination is unchanged", () => {
  it("sends chat events to the inbox, not to the sender's profile", () => {
    assert.equal(notificationHref({ kind: "message", actor: { id: "u1" } }), "/messages");
    assert.equal(notificationHref({ kind: "chat_request", actor: { id: "u1" } }), "/messages");
  });

  it("opens a post, and opens ON a comment when one is named", () => {
    assert.equal(notificationHref({ kind: "like", postId: "p1" }), "/p/p1");
    assert.equal(
      notificationHref({ kind: "comment", postId: "p1", commentId: "c 1/2" }),
      "/p/p1?comment=c%201%2F2"
    );
  });

  it("falls back to the actor by id, then to nothing", () => {
    assert.equal(notificationHref({ kind: "follow", actor: { id: "u1", username: "ada" } }), "/u/u1");
    assert.equal(notificationHref({ kind: "follow" }), null);
  });

  it("prefers the stream over the post when a row carries both", () => {
    // Order is load-bearing: a room announcement that also names a post is
    // still about the room.
    assert.equal(
      notificationHref({ kind: "house_room", streamId: ROOM_ID, postId: "p1" }),
      `/gist-rooms/${ROOM_ID}`
    );
  });
});

/*
  A MESSAGE ROW OPENS THE THREAD, ONCE THE SERVICE NAMES ONE.

  `conversation` is parsed ahead of the backend — today every `message`
  notification carries an actor and nothing else — so both halves have to hold:
  the thread when the id is there, the inbox when it is not, and never a
  fabricated path in between.
*/
describe("a message notification lands on the conversation, not the inbox root", () => {
  it("opens the thread when the service names one", () => {
    assert.equal(
      notificationHref({ kind: "message", conversation: { id: "c-1" } }),
      "/messages/c-1",
    );
  });

  it("still opens the inbox while the field is absent", () => {
    assert.equal(notificationHref({ kind: "message" }), "/messages");
    assert.equal(notificationHref({ kind: "message", conversation: null }), "/messages");
  });

  it("escapes the id rather than pasting it into a path", () => {
    assert.equal(
      notificationHref({ kind: "message", conversation: { id: "a/b?c" } }),
      "/messages/a%2Fb%3Fc",
    );
  });

  /*
    A REQUEST IS NOT YET A CONVERSATION, so there is no thread to open and it
    keeps the inbox even if an id ever rides along.
  */
  it("keeps a chat request on the inbox", () => {
    assert.equal(
      notificationHref({ kind: "chat_request", conversation: { id: "c-1" } }),
      "/messages",
    );
  });
});

/*
  A MENTION INSIDE A GROUP CHAT IS A CHAT EVENT TOO.

  `mention` is written from four places — a post, a comment, a stream and a
  group message — and only the first three carry a `postId` or a `streamId`.
  So a group mention fell through to `profileHref(actor)` and landed the reader
  on the profile of the person who named them, rather than the thread they were
  named in. The same bug was fixed for `message` one branch above and left here.
*/
describe("a mention in a group chat opens the thread, not the mentioner", () => {
  it("opens the thread when the row names a conversation", () => {
    assert.equal(
      notificationHref({
        kind: "mention",
        conversation: { id: "c-9" },
        actor: { id: "u1", username: "ada" },
      }),
      "/messages/c-9",
    );
  });

  it("still opens the post when the mention was in one", () => {
    assert.equal(notificationHref({ kind: "mention", postId: "p-1" }), "/p/p-1");
  });

  /*
    No conversation and no post is the pre-#331 group mention: the actor is
    still the honest fallback, because nothing on the row names the thread.
  */
  it("falls back to the actor when nothing names a place", () => {
    assert.equal(
      notificationHref({ kind: "mention", actor: { id: "u1", username: "ada" } }),
      // profileHref routes by the ID when it is a safe path segment, not the
      // handle — my first expectation here was wrong, not the code.
      "/u/u1",
    );
  });

  it("prefers the named thread over a post the row also carries", () => {
    assert.equal(
      notificationHref({ kind: "mention", conversation: { id: "c-9" }, postId: "p-1" }),
      "/messages/c-9",
    );
  });
});

import assert from "node:assert/strict";

/** Substring check, used where a regex would need an escaped newline. */
const s_includes = (haystack: string, needle: string) => haystack.includes(needle);
import { describe, it } from "node:test";
import {
  CROP_BUDGET,
  STAGE_LANDSCAPE_ASPECT,
  STAGE_PORTRAIT_ASPECT,
  baseIdentity,
  buildStage,
  isHostParticipant,
  chooseFit,
  cropLoss,
  remoteAudioSlots,
  stageFrameAspect,
  type StageParticipant,
  type StagePublication,
  type StageRoom,
} from "../features/streams/lib/stage.ts";

/**
 * The production bug: the host approves a guest, the guest's camera turns on
 * and they see their own face, but nobody else ever sees or hears them. Every
 * renderer resolved ONE video source, so the second publisher had no DOM node,
 * and the host cockpit had no remote path at all.
 *
 * These cases pin the replacement: the stage is a list derived from the publish
 * GRANT, audio is independent of video, and a slot with no media is still a
 * slot.
 */

const HOST = "host-user";

function publication(sid: string, muted = false): StagePublication {
  return { trackSid: sid, isMuted: muted, isSubscribed: true, track: {} };
}

function participant(
  identity: string,
  overrides: Partial<StageParticipant> = {}
): StageParticipant {
  return {
    identity,
    isLocal: false,
    permissions: { canPublish: false },
    videoTrackPublications: new Map(),
    audioTrackPublications: new Map(),
    ...overrides,
  };
}

function room(local: StageParticipant, ...remotes: StageParticipant[]): StageRoom {
  return {
    localParticipant: local,
    remoteParticipants: new Map(remotes.map((r) => [r.identity, r])),
  };
}

const publishing = (identity: string, extra: Partial<StageParticipant> = {}) =>
  participant(identity, {
    permissions: { canPublish: true },
    videoTrackPublications: new Map([["v", publication(`${identity}-v`)]]),
    audioTrackPublications: new Map([["a", publication(`${identity}-a`)]]),
    ...extra,
  });

describe("buildStage", () => {
  it("puts the host in slot 0", () => {
    const stage = buildStage(
      room(participant("viewer"), publishing("guest-1", { joinedAt: 2000 }), publishing(HOST, { joinedAt: 1000 })),
      HOST
    );
    assert.deepEqual(
      stage.map((slot) => slot.identity),
      [HOST, "guest-1"]
    );
    assert.equal(stage[0].role, "host");
    assert.equal(stage[1].role, "guest");
  });

  it("keeps the host in slot 0 even when a guest joined first", () => {
    const stage = buildStage(
      room(publishing(HOST, { joinedAt: 9999, isLocal: true }), publishing("guest-1", { joinedAt: 1 })),
      HOST
    );
    assert.equal(stage[0].identity, HOST);
  });

  it("keeps the host on stage before their own permissions have been read", () => {
    // The documented LiveKit race: permissions arrive after the first render.
    const stage = buildStage(room(participant(HOST, { isLocal: true, permissions: null })), HOST);
    assert.equal(stage.length, 1);
    assert.equal(stage[0].role, "host");
  });

  it("orders guests by join order, not map order", () => {
    const stage = buildStage(
      room(
        publishing(HOST, { isLocal: true }),
        publishing("later", { joinedAt: new Date(5000) }),
        publishing("earlier", { joinedAt: new Date(2000) })
      ),
      HOST
    );
    assert.deepEqual(stage.map((s) => s.identity), [HOST, "earlier", "later"]);
  });

  it("excludes plain viewers — membership is the publish grant", () => {
    const stage = buildStage(
      room(participant("me", { isLocal: true }), publishing(HOST), participant("lurker")),
      HOST
    );
    assert.deepEqual(stage.map((s) => s.identity), [HOST]);
  });

  it("gives an approved-but-not-yet-publishing guest a pending slot", () => {
    // The exact window the old 'has a video track' test dropped on the floor.
    const stage = buildStage(
      room(publishing(HOST, { isLocal: true }), participant("guest-1", { permissions: { canPublish: true } })),
      HOST
    );
    assert.equal(stage.length, 2);
    assert.equal(stage[1].state, "approved-pending");
    assert.equal(stage[1].cameraTrack, null);
    assert.equal(stage[1].audioTrack, null);
    assert.equal(stage[1].cameraOff, true);
  });

  it("gives a camera-off guest an avatar slot, never a dropped slot", () => {
    const stage = buildStage(
      room(
        publishing(HOST, { isLocal: true }),
        participant("guest-1", {
          permissions: { canPublish: true },
          videoTrackPublications: new Map([["v", publication("g-v", true)]]),
          audioTrackPublications: new Map([["a", publication("g-a")]]),
        })
      ),
      HOST
    );
    assert.equal(stage[1].cameraOff, true);
    assert.equal(stage[1].state, "live");
    assert.notEqual(stage[1].audioTrack, null);
  });

  it("gives an audio-only guest a slot with audio and no video", () => {
    const stage = buildStage(
      room(
        publishing(HOST, { isLocal: true }),
        participant("guest-1", {
          permissions: { canPublish: true },
          audioTrackPublications: new Map([["a", publication("g-a")]]),
        })
      ),
      HOST
    );
    assert.equal(stage.length, 2);
    assert.equal(stage[1].cameraTrack, null);
    assert.equal(stage[1].audioTrack?.trackSid, "g-a");
    assert.equal(stage[1].isMuted, false);
    assert.equal(stage[1].cameraOff, true);
  });

  it("treats a participant with no audio publication as muted", () => {
    const stage = buildStage(
      room(
        publishing(HOST, { isLocal: true }),
        participant("guest-1", {
          permissions: { canPublish: true },
          videoTrackPublications: new Map([["v", publication("g-v")]]),
        })
      ),
      HOST
    );
    assert.equal(stage[1].isMuted, true);
    assert.equal(stage[1].cameraOff, false);
  });

  it("removes the slot when the guest is demoted", () => {
    const guest = publishing("guest-1");
    const live = room(publishing(HOST, { isLocal: true }), guest);
    assert.equal(buildStage(live, HOST).length, 2);
    // Remove-from-stage is a server-side canPublish:false; LiveKit mutates
    // permissions in place and unpublishes the tracks.
    guest.permissions = { canPublish: false };
    guest.videoTrackPublications = new Map();
    guest.audioTrackPublications = new Map();
    assert.deepEqual(buildStage(live, HOST).map((s) => s.identity), [HOST]);
  });

  it("never lists the same identity twice", () => {
    const me = publishing(HOST, { isLocal: true });
    const stage = buildStage(
      { localParticipant: me, remoteParticipants: new Map([[HOST, me]]) },
      HOST
    );
    assert.equal(stage.length, 1);
  });

  it("marks the local participant so the renderer never plays our own mic back", () => {
    const stage = buildStage(
      room(publishing("guest-me", { isLocal: true }), publishing(HOST)),
      HOST
    );
    const mine = stage.find((slot) => slot.identity === "guest-me");
    assert.equal(mine?.isLocal, true);
    assert.deepEqual(
      remoteAudioSlots(stage).map((slot) => slot.identity),
      [HOST]
    );
  });

  it("carries every publisher's audio slot independently of video", () => {
    const stage = buildStage(
      room(
        participant("me", { isLocal: true }),
        publishing(HOST),
        participant("guest-1", {
          permissions: { canPublish: true },
          audioTrackPublications: new Map([["a", publication("g1-a")]]),
        })
      ),
      HOST
    );
    // Two audio elements are owed, even though only one participant has video.
    assert.equal(remoteAudioSlots(stage).length, 2);
    assert.equal(stage.filter((slot) => slot.cameraTrack).length, 1);
  });
});

/**
 * Structural assertions on the renderer.
 *
 * `buildStage` being right is not enough — the bug was in how the result was
 * consumed. These read the source and pin the two shapes that made the guest
 * invisible and inaudible, because both are easy to regress by "simplifying"
 * one map back into a lookup.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8");

const stageView = source("features/streams/components/live-stage.tsx");
const player = source("features/streams/components/livekit-player.tsx");
const slotsHook = source("features/streams/hooks/use-stage-slots.ts");
const guestStage = source("features/streams/hooks/use-stage.ts");
const cockpit = source("features/streams/components/live-cockpit.tsx");
const streamHooks = source("features/streams/hooks/use-streams.ts");
const reactions = source("features/streams/hooks/use-live-reactions.ts");
const giftSheet = source("components/ui/gift-sheet.tsx");

describe("the stage renderer, by construction", () => {
  it("maps over the slot list instead of picking one participant", () => {
    // The stage is now per-SOURCE, so it maps two tile lists (screens on the
    // main stage, faces in the strip) rather than one list of participants.
    // The rule is unchanged: map over a list, never resolve "the" participant.
    assert.match(stageView, /primary\.map\(/, "the main stage must be a map");
    assert.match(stageView, /secondary\.map\(/, "the camera strip must be a map");
    for (const antiPattern of [
      /remoteParticipants\[0\]/,
      /remoteParticipants\.values\(\)\)\[0\]/,
      /\.values\(\)\.next\(\)/,
      /const remote(Participant)? =/,
    ]) {
      assert.doesNotMatch(stageView, antiPattern, `single-source lookup: ${antiPattern}`);
    }
  });

  it("attaches audio from its own map, independent of any video element", () => {
    assert.match(stageView, /remoteAudioSlots\(/);
    assert.match(stageView, /audio\.map\(\(slot\) => \(\s*<RemoteAudio/);
    // The audio map must not be nested inside the tile map: audio for a guest
    // with no camera has to survive the tile rendering an avatar instead.
    const tileMap = stageView.indexOf("slots.map(");
    const audioMap = stageView.indexOf("audio.map(");
    assert.ok(audioMap > tileMap, "audio must be mounted outside the tile map");
    assert.ok(
      !stageView.slice(tileMap, audioMap).includes("<RemoteAudio"),
      "audio elements must not live inside a tile"
    );
    // And the video element must never be the thing carrying sound.
    assert.match(stageView, /element\.muted = true;/);
  });

  it("renders an avatar tile rather than a black rectangle when the camera is off", () => {
    assert.match(stageView, /hideVideo && \(/);
    assert.match(stageView, /<Avatar/);
  });

  it("offers a real user gesture for blocked autoplay", () => {
    assert.match(stageView, /startAudio\(\)/);
    assert.match(stageView, /Tap to turn on sound/);
  });

  it("enumerates the participants already in the room, not just events", () => {
    assert.match(slotsHook, /remoteParticipants\.values\(\)/);
    assert.match(slotsHook, /RoomEvent\.ParticipantPermissionsChanged/);
    // Every handler funnels into one rebuild, so adding an event can never
    // introduce a second, subtly different update path.
    assert.match(slotsHook, /for \(const event of events\) room\.on\(event, recompute\);/);
  });

  it("no longer renders from the viewer player's own track-subscribed handler", () => {
    assert.match(player, /<LiveStage/);
    assert.doesNotMatch(player, /RoomEvent\.TrackSubscribed/);
    // The terminal duplicate-identity handling and the registry claim stay.
    assert.match(player, /DisconnectReason\.DUPLICATE_IDENTITY/);
    assert.match(player, /registerRoom\(streamId, instance\)/);
    assert.match(player, /unregisterRoom\(streamId, room\)/);
  });

  it("gives the host cockpit a remote path at all", () => {
    // This was the whole bug on the host's side: the cockpit rendered one
    // element, its own preview, and attached nothing from anybody else.
    assert.match(cockpit, /<LiveStage/);
    assert.match(cockpit, /hostIdentity=\{stream\.ownerId\}/);
    assert.match(cockpit, /onRemoveGuest=\{removeGuest\}/);
    // The resolve itself moved into `useRemoveGuest` when the watch page grew
    // the same control — one implementation, two surfaces. The action is
    // pinned where it now lives, below.
    assert.match(cockpit, /useRemoveGuest\(stream\.id/);
  });

  it("sends a gift to the whole room, not just the sender's own screen", () => {
    // The bug: the burst was local state and nothing else, so the host — the
    // person the gift is aimed at — never saw it. A gift only the giver can
    // see is not a gift.
    const room = source("features/streams/components/stream-room.tsx");
    assert.match(room, /live\.gift\(gift\.id, quantity, from\)/);
    assert.match(room, /onGift: receiveGift/);
    // An id off the wire is resolved against our own catalogue; a peer must
    // never be able to hand every screen in the room an arbitrary image.
    assert.match(room, /LIVE_GIFTS\.find\(\(item\) => item\.id === giftId\)/);
    assert.match(reactions, /topic: GIFT_TOPIC/);
    // Reliable, unlike a heart: a dropped gift is the one thing that viewer
    // did all stream.
    assert.match(reactions, /\{ reliable: true, topic: GIFT_TOPIC \}/);
  });

  it("never prices a gift that nothing charges for", () => {
    // `POST /streams/{id}/gifts` settles a real amount now, but only where the
    // deployment can: `MARKET_FLAGS.liveGifts` remains the money switch, and a
    // free tray must not print a total, a coin glyph, or the gold token.
    //
    // ONE rule, asked in two places — the room draws prices from it and the
    // send path decides whether to take money from it. Two copies is how a
    // tray prints a price it never charges, or charges for a gift it showed
    // as free, so the shared helper is what is pinned here.
    const room = source("features/streams/components/stream-room.tsx");
    const gifts = source("lib/gifts.ts");
    assert.match(gifts, /status === "live" && MARKET_FLAGS\.liveGifts/);
    assert.match(room, /const giftsPriced = giftsArePriced\(data\.status\);/);
    // The money leg is never taken on an unpriced tray.
    assert.match(room, /if \(!giftsArePriced\(stream\.data\?\.status\)\) return;/);
    assert.match(room, /giftsPriced \? "bg-coin" : "bg-accent"/);
    assert.match(giftSheet, /showPrices=\{priced\}/);
    // The PRICED branch is the only one that may print a total, and the free
    // branch must not mention money at all. Pinned as two facts rather than as
    // one literal string: the label also names the recipient now ("Send a Rose
    // to Ada"), because a gist room lets you gift anybody in the room, and an
    // exact-string assertion would have failed for a change that cannot
    // possibly charge anyone.
    // The total is COINS now, not KASH — gifts are priced in Square coins and
    // the tray draws that unit. The rule this pins is unchanged: only the
    // PRICED branch may print a total, and the free branch may not mention
    // money at all.
    assert.ok(
      s_includes(giftSheet, "? `Send ${selected.name} · ${total.toLocaleString()}`"),
      "the priced label no longer prints a total"
    );
    const freeBranch = giftSheet.slice(giftSheet.indexOf("? `Send ${selected.name} · "));
    const freeLabel = freeBranch.slice(freeBranch.indexOf(": recipient"), freeBranch.indexOf("</Button>"));
    assert.doesNotMatch(freeLabel, /total|priceCoins|priceKash/, "the free tray prints a price");
  });

  it("removes a guest from ONE place, whichever surface the host is on", () => {
    // Two copies of "find the approved request, resolve it with remove" is how
    // the cockpit and the watch page quietly stop agreeing about moderation.
    assert.match(streamHooks, /export function useRemoveGuest\(/);
    assert.match(streamHooks, /item\.status === "approved"/);
    assert.match(streamHooks, /action: "remove"/);
    // The watch page only opens the request poll for the owner, so a viewer
    // never pays for a capability they do not have.
    const room = source("features/streams/components/stream-room.tsx");
    assert.match(room, /useRemoveGuest\(stream\.id, isHost && stream\.status === "live"\)/);
    assert.match(room, /onRemoveGuest=\{isHost \? guests\.remove : undefined\}/);
  });

  it("makes the guest publish only after the grant, idempotently, with one retry", () => {
    assert.match(guestStage, /RoomEvent\.ParticipantPermissionsChanged/);
    assert.match(guestStage, /localParticipant\.permissions\?\.canPublish === true/);
    assert.match(guestStage, /if \(!canPublish\) return;/);
    assert.match(guestStage, /enableOnce\(\(\) => room\.localParticipant\.setMicrophoneEnabled\(true\)\)/);
    assert.match(guestStage, /enableOnce\(\(\) => room\.localParticipant\.setCameraEnabled\(true\)\)/);
    // Exactly one retry — a loop here is how you get an eviction storm.
    assert.equal((guestStage.match(/await enable\(\);/g) ?? []).length, 2);
  });
});

describe("the stream room keeps Ark broadcasts watch-only", () => {
  const room = source("features/streams/components/stream-room.tsx");

  it("gates BOTH speaker-request entry points on the same flag", () => {
    // Desktop header and mobile rail. One of them keeping the control would
    // put a dead end back on exactly one breakpoint.
    const guarded = room.match(/!watchOnly && me\.data\?\.id !== data\.ownerId/g) ?? [];
    assert.equal(guarded.length, 2, "both GuestSpeakerControl sites must be gated");
  });

  it("derives the flag from the deep link, not from a game list", () => {
    assert.match(room, /const watchOnly = isArkOriginated\(data\.deepLink\)/);
    assert.doesNotMatch(room, /"chess"|"arkball"|"last-standing"/, "no game names in the room");
  });

  it("offers the way into Ark on both breakpoints", () => {
    // The header CTA is lg:block, so the mobile rail needs its own.
    assert.match(room, /Join the match in Ark/);
    assert.match(room, /aria-label="Join the match in Ark"/);
  });
});

/**
 * Fit selection.
 *
 * The reported bug: a host shares a wide source and viewers get its middle
 * third, because every tile filled its box. The decision is a pure function of
 * (source kind, intrinsic aspect, tile aspect) precisely so it can be argued
 * about here rather than inspected in a rendered DOM.
 */
const ASPECT = {
  ultrawide: 21 / 9, // 2.333
  desktop: 16 / 10, // 1.6 — a typical shared screen
  wide: 16 / 9, // 1.778
  classic: 4 / 3, // 1.333
  square: 1,
  portrait: 9 / 16, // 0.5625 — the mobile stage
};

describe("chooseFit", () => {
  const fit = (isScreenShare: boolean, sourceAspect: number | null, tileAspect: number | null) =>
    chooseFit({ isScreenShare, sourceAspect, tileAspect });

  it("never crops a screen share, whatever the tile shape", () => {
    for (const tile of Object.values(ASPECT)) {
      for (const source of Object.values(ASPECT)) {
        assert.equal(fit(true, source, tile), "contain", `screen ${source} in ${tile}`);
      }
    }
  });

  it("letterboxes a screen share even when it matches the tile exactly", () => {
    // Deliberate: `contain` at a matching aspect produces no bars anyway, and
    // making it conditional is how the rule quietly acquires an exception.
    assert.equal(fit(true, ASPECT.wide, ASPECT.wide), "contain");
  });

  it("fills when a camera's aspect matches its tile", () => {
    assert.equal(fit(false, ASPECT.wide, ASPECT.wide), "cover");
    assert.equal(fit(false, ASPECT.portrait, ASPECT.portrait), "cover");
    assert.equal(fit(false, ASPECT.square, ASPECT.square), "cover");
  });

  it("fills through a near-match, where the crop is only margin", () => {
    // 16:9 in 16:10 → ratio 1.11, ~10% lost: inside the title-safe convention.
    assert.equal(fit(false, ASPECT.wide, ASPECT.desktop), "cover");
    // 3:2 in 16:9 → ratio 1.19, ~16%: still under budget.
    assert.equal(fit(false, 3 / 2, ASPECT.wide), "cover");
  });

  it("letterboxes once the crop starts eating the subject", () => {
    // 4:3 in 16:9 → 25% gone.
    assert.equal(fit(false, ASPECT.classic, ASPECT.wide), "contain");
    // The headline case: a 16:9 camera in a 9:16 phone slot → 68% gone.
    assert.equal(fit(false, ASPECT.wide, ASPECT.portrait), "contain");
    // An ultrawide camera in a 16:9 tile → 24% gone.
    assert.equal(fit(false, ASPECT.ultrawide, ASPECT.wide), "contain");
  });

  it("is symmetric — a portrait source in a wide tile is cropped just as badly", () => {
    assert.equal(fit(false, ASPECT.portrait, ASPECT.wide), "contain");
    assert.equal(
      fit(false, ASPECT.wide, ASPECT.portrait),
      fit(false, ASPECT.portrait, ASPECT.wide)
    );
  });

  it("sits exactly on the documented budget", () => {
    assert.equal(CROP_BUDGET, 1.2);
    // At the budget, fill; a hair over it, letterbox.
    assert.equal(fit(false, CROP_BUDGET, 1), "cover");
    assert.equal(fit(false, CROP_BUDGET + 0.001, 1), "contain");
  });

  it("fills while the geometry is still unknown, so bars never flash in", () => {
    assert.equal(fit(false, null, ASPECT.wide), "cover");
    assert.equal(fit(false, ASPECT.wide, null), "cover");
    assert.equal(fit(false, null, null), "cover");
    // Degenerate measurements are 'unknown', not a divide-by-zero.
    assert.equal(fit(false, 0, ASPECT.wide), "cover");
    assert.equal(fit(false, ASPECT.wide, -1), "cover");
    // …but an unmeasured screen share is still never cropped.
    assert.equal(fit(true, null, null), "contain");
  });

  it("depends on nothing but its three inputs", () => {
    const once = fit(false, ASPECT.classic, ASPECT.portrait);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(fit(false, ASPECT.classic, ASPECT.portrait), once);
    }
  });
});

describe("cropLoss", () => {
  it("reports the fraction of the frame cover would discard", () => {
    assert.equal(cropLoss(ASPECT.wide, ASPECT.wide), 0);
    assert.ok(Math.abs(cropLoss(ASPECT.classic, ASPECT.wide) - 0.25) < 0.001);
    // The mobile case the host most needs warning about.
    assert.ok(cropLoss(ASPECT.wide, ASPECT.portrait) > 0.66);
  });

  it("is zero when nothing has been measured, so no hint is invented", () => {
    assert.equal(cropLoss(null, ASPECT.wide), 0);
    assert.equal(cropLoss(ASPECT.wide, null), 0);
    assert.equal(cropLoss(0, 0), 0);
  });

  it("agrees with chooseFit at the boundary", () => {
    // Anything chooseFit fills has lost at most 1 - 1/CROP_BUDGET of the frame.
    const ceiling = 1 - 1 / CROP_BUDGET;
    for (const source of Object.values(ASPECT)) {
      for (const tile of Object.values(ASPECT)) {
        if (chooseFit({ isScreenShare: false, sourceAspect: source, tileAspect: tile }) === "cover") {
          assert.ok(cropLoss(source, tile) <= ceiling + 1e-9, `${source} in ${tile}`);
        }
      }
    }
  });
});

describe("fit, by construction", () => {
  it("delegates the decision instead of hardcoding object-fit per tile kind", () => {
    // The bug was a policy baked into a className: screens contain, cameras
    // cover, regardless of shape. Both must now come from chooseFit.
    assert.match(stageView, /chooseFit\(\{ isScreenShare: isScreen, sourceAspect, tileAspect \}\)/);
    assert.doesNotMatch(stageView, /isScreen \? "object-contain" : "object-cover"/);
    assert.doesNotMatch(stageView, /object-cover/);
    // Applied to the live element, so a source that changes shape mid-call does
    // not force a detach/re-attach (which black-flashes the tile).
    assert.match(stageView, /video\.style\.objectFit = fit;/);
  });

  it("measures both aspects rather than assuming either", () => {
    assert.match(stageView, /new ResizeObserver/);
    assert.match(stageView, /addEventListener\("loadedmetadata", readAspect\)/);
    // Screen shares renegotiate when the host switches window; cameras flip on
    // rotation. Metadata alone would pin the first shape forever.
    assert.match(stageView, /addEventListener\("resize", readAspect\)/);
  });

  it("letterboxes onto the stage ground, not a lighter panel", () => {
    assert.match(stageView, /fit === "contain" && "bg-\[#0A0A0B\]"/);
  });

  it("tells the host what viewers are actually seeing", () => {
    assert.match(cockpit, /onLocalFit=\{setFits\}/);
    assert.match(cockpit, /function describeFraming/);
    assert.match(cockpit, /letterboxed/);
    assert.match(cockpit, /cropped view/);
  });
});

describe("the user behind a LiveKit identity", () => {
  /**
   * REGRESSION: a host could never remove a guest.
   *
   * An approved speaker rejoins as `<did>#speaker`, because LiveKit will not
   * let one identity hold two connections while the old one drains. The
   * remove control passed that identity into a lookup keyed on the speaker
   * request's `userId` — the bare DID — so it never matched, every attempt
   * said "couldn't find that guest's request", and the guest stayed on stage.
   */
  it("strips the speaker suffix so both sides agree", () => {
    assert.equal(baseIdentity("did:privy:abc123#speaker"), "did:privy:abc123");
    // Every role suffix, because this is what avatars are SEEDED with: a
    // person with no uploaded picture gets generated artwork keyed on the
    // seed, so a suffix that leaks through draws them as somebody else in the
    // room than the sidebar draws. The host is the visible case — theirs is
    // the identity that changes the moment they go live.
    assert.equal(baseIdentity("did:privy:abc123#broadcaster"), "did:privy:abc123");
    assert.equal(baseIdentity("did:privy:abc123#rtmp"), "did:privy:abc123");
    assert.equal(baseIdentity("did:privy:abc123"), "did:privy:abc123");
  });

  it("is idempotent — a bare id survives it unchanged", () => {
    const bare = "did:privy:abc123";
    assert.equal(baseIdentity(baseIdentity(bare)), bare);
  });

  it("leaves a non-DID identity alone", () => {
    assert.equal(baseIdentity("host"), "host");
    assert.equal(baseIdentity(""), "");
  });
});

describe("the host is the host, however they published", () => {
  /**
   * REGRESSION: the host was classified as a GUEST.
   *
   * They publish as `<did>#speaker` — the same suffix an approved guest gets,
   * because LiveKit will not let one identity hold two connections — while
   * `hostIdentity` is the stream's plain `ownerId`. Compared raw they never
   * matched, so the host's own tile carried no Host chip, offered a remove
   * button, and could reflow out from under the viewer.
   */
  const publication = (): StagePublication => ({
    trackSid: "t1",
    isMuted: false,
    source: "camera",
    track: {},
  });
  const participant = (identity: string): StageParticipant => ({
    identity,
    permissions: { canPublish: true },
    videoTrackPublications: new Map([["t1", publication()]]),
    audioTrackPublications: new Map(),
  });

  it("recognises a host publishing under the speaker suffix", () => {
    const room: StageRoom = {
      localParticipant: participant("did:privy:host#speaker"),
      remoteParticipants: new Map([["g", participant("did:privy:guest#speaker")]]),
    };
    const slots = buildStage(room, "did:privy:host");
    assert.equal(slots[0].role, "host");
    assert.equal(slots[0].identity, "did:privy:host#speaker");
    assert.equal(slots[1].role, "guest");
  });

  it("still recognises a host publishing under the bare id", () => {
    const room: StageRoom = {
      localParticipant: participant("did:privy:host"),
      remoteParticipants: new Map(),
    };
    assert.equal(buildStage(room, "did:privy:host")[0].role, "host");
  });

  it("does not promote a guest whose id merely starts the same", () => {
    const room: StageRoom = {
      localParticipant: participant("did:privy:hostile#speaker"),
      remoteParticipants: new Map(),
    };
    assert.equal(buildStage(room, "did:privy:host").length, 1);
    assert.equal(buildStage(room, "did:privy:host")[0].role, "guest");
  });
});

/**
 * The reported bug: the host's studio filled its tile with a landscape camera
 * while /live/:id showed the same camera as a strip in a tall black frame.
 *
 * Neither surface was individually wrong — they disagreed. The cockpit preview
 * is a landscape panel, so a 16:9 camera matched it and `chooseFit` filled. The
 * watch page hardcoded `aspect-[9/16]`, so the same camera was 3.16x off its
 * frame, over the crop budget, and correctly letterboxed down to a third of the
 * height. The frame was decided before anyone knew what shape the stream was.
 */
describe("the stage frame takes the shape of the stream", () => {
  const ASPECT = {
    ultrawide: 21 / 9,
    wide: 16 / 9,
    classic: 4 / 3,
    square: 1,
    portrait: 9 / 16,
    tall: 9 / 21,
  };

  it("keeps the portrait column while nothing has been measured", () => {
    // The shape the page lays out before the first frame arrives. Resolving to
    // anything else would visibly reshape the room a second after it opened.
    assert.equal(stageFrameAspect(null), STAGE_PORTRAIT_ASPECT);
    assert.equal(stageFrameAspect(undefined), STAGE_PORTRAIT_ASPECT);
  });

  it("treats junk geometry as unmeasured rather than shaping to it", () => {
    for (const junk of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(stageFrameAspect(junk), STAGE_PORTRAIT_ASPECT, `${junk}`);
    }
  });

  it("adopts a landscape source instead of posting it into a portrait hole", () => {
    assert.equal(stageFrameAspect(ASPECT.wide), ASPECT.wide);
    assert.equal(stageFrameAspect(ASPECT.classic), ASPECT.classic);
    assert.equal(stageFrameAspect(ASPECT.square), ASPECT.square);
  });

  it("never narrows past the portrait column", () => {
    // A phone camera is already the column's shape; anything TALLER than the
    // column would leave bars down the sides of a stage that has no width to
    // spare, so 9:16 is the floor.
    assert.equal(stageFrameAspect(ASPECT.portrait), STAGE_PORTRAIT_ASPECT);
    assert.equal(stageFrameAspect(ASPECT.tall), STAGE_PORTRAIT_ASPECT);
  });

  it("stops at 16:9, so an ultrawide share cannot flatten the room", () => {
    assert.equal(stageFrameAspect(ASPECT.ultrawide), STAGE_LANDSCAPE_ASPECT);
    assert.equal(stageFrameAspect(32 / 9), STAGE_LANDSCAPE_ASPECT);
  });

  it("closes the gap between the two surfaces", () => {
    // THE regression test. At the old fixed 9:16 the viewer's fit was
    // `contain` with two thirds of the picture in bars; at the frame the
    // source now gets, the very same camera fills — which is exactly what the
    // host was already seeing in their studio.
    const camera = 16 / 9;
    assert.equal(
      chooseFit({ isScreenShare: false, sourceAspect: camera, tileAspect: STAGE_PORTRAIT_ASPECT }),
      "contain"
    );
    assert.ok(cropLoss(camera, STAGE_PORTRAIT_ASPECT) > 0.66);
    assert.equal(
      chooseFit({
        isScreenShare: false,
        sourceAspect: camera,
        tileAspect: stageFrameAspect(camera),
      }),
      "cover"
    );
  });

  it("still fills for every source the frame can actually reach", () => {
    // Anything inside the clamp gets a frame of its own shape, so nothing in
    // that range is ever letterboxed on the watch page. Outside it (a source
    // taller than 9:16, wider than 16:9) bars are unavoidable — that is what
    // the blurred backdrop is for.
    for (const source of [ASPECT.wide, ASPECT.classic, ASPECT.square, ASPECT.portrait]) {
      assert.equal(
        chooseFit({ isScreenShare: false, sourceAspect: source, tileAspect: stageFrameAspect(source) }),
        "cover",
        `${source}`
      );
    }
  });

  it("is clamped, not rounded — a near-square source keeps its own shape", () => {
    assert.equal(stageFrameAspect(1.1), 1.1);
    assert.equal(stageFrameAspect(0.8), 0.8);
  });
});

describe("the watch page frame, by construction", () => {
  const room = source("features/streams/components/stream-room.tsx");
  const hls = source("features/streams/components/hls-player.tsx");

  it("no longer pins the desktop stage to 9:16", () => {
    // The single line that caused the report.
    assert.doesNotMatch(room, /aspect-\[9\/16\]/);
    assert.match(room, /lg:aspect-\[var\(--stage-aspect\)\]/);
    assert.match(room, /const frameAspect = stageFrameAspect\(sourceAspect\);/);
  });

  it("takes the shape from the player rather than from the stream record", () => {
    // `stream.orientation` would be a promise the backend does not keep; what
    // is on the wire is what the video element measures.
    assert.match(room, /onSourceAspect=\{setSourceAspect\}/);
    assert.match(player, /onSourceAspect=\{onSourceAspect\}/);
    assert.match(stageView, /announceAspect\.current\?\.\(soloAspect\)/);
    // HLS too: an Ark game feed is 16:9 and was letterboxed by the same frame.
    assert.match(hls, /videoWidth \/ videoHeight : null/);
    assert.match(hls, /addEventListener\("resize", read\)/);
  });

  it("keeps the phone stage full-bleed", () => {
    // The stage IS the viewport there, with the chrome floating over it, so
    // every shape override is behind `lg:` and the base stays h-full w-full.
    const frame = room.match(/className="h-full w-full bg-black lg:[^"]*"/);
    assert.ok(frame, "the stage frame's classes must still be readable here");
    for (const token of frame[0].slice('className="'.length, -1).split(/\s+/)) {
      if (token.startsWith("aspect-") || token.startsWith("w-auto") || token.startsWith("max-w-")) {
        assert.fail(`${token} must be behind a breakpoint — the phone stage is full-bleed`);
      }
    }
    assert.match(frame[0], /lg:w-auto/);
    // Without this a 16:9 frame overflows a column narrower than 16:9 of its
    // own height, and the room scrolls sideways.
    assert.match(frame[0], /lg:max-w-full/);
  });

  it("only reshapes for a SOLO publisher", () => {
    // Two people on stage is a grid, and `lib/stage-layout` stacks that grid
    // on the assumption the frame is the portrait column. A stage that widened
    // under a two-up grid would put both faces back in the slivers that layout
    // exists to prevent.
    assert.match(stageView, /const soloKey = primary\.length === 1 \? primary\[0\]\.key : null;/);
  });
});

describe("the letterbox is filled, not dead black", () => {
  it("puts a blurred blow-up behind a camera that cannot fill its tile", () => {
    // Bars are unavoidable on a phone: the stage is the 9:16 viewport and a
    // landscape camera is not, and `chooseFit` is right to refuse a 68% crop.
    // What made it read as broken was the bars being empty black.
    assert.match(stageView, /const backdrop = fit === "contain" && !hideVideo && !isScreen && track \? track : null;/);
    assert.match(stageView, /<TileBackdrop track=\{backdrop\} \/>/);
    assert.match(stageView, /blur-2xl/);
    // It IS the fill, so it always covers — this is not a `chooseFit` decision
    // and must not become one.
    assert.match(stageView, /element\.style\.objectFit = "cover";/);
  });

  it("never blurs a shared screen out into the margins", () => {
    // A defocused blow-up of code or slides reads as a rendering fault; every
    // other product letterboxes a screen onto black.
    assert.match(stageView, /!isScreen && track/);
  });

  it("keeps the real video first in the DOM", () => {
    // The room reaches into the stage with `querySelector("video")` for its
    // transport controls. A backdrop mounted ahead of the picture would take
    // play, pause, restart and picture-in-picture with it.
    const video = stageView.indexOf('<div ref={mountRef} className="relative z-10 h-full w-full" />');
    const backdrop = stageView.indexOf("<TileBackdrop");
    assert.ok(video > 0 && backdrop > video, "the backdrop must mount after the video");
    assert.match(stageView, /absolute inset-0 z-0 scale-110/);
  });

  it("still reports OUR fit only, to the host who can act on it", () => {
    // Every primary tile reports now — the viewer's frame is shaped by whoever
    // is on stage, and on the watch page that is never us — so the cockpit's
    // framing hint has to filter back down to our own tiles.
    assert.match(stageView, /onFit=\{\(report\) => handleFit\(report, tile\.key\)\}/);
    assert.match(stageView, /filter\(\(report\) => report\.isLocal\)/);
  });
});

describe("the host arriving on the publisher token", () => {
  // The service now mints the owner's roomToken with `<ownerId>#broadcaster`
  // (and the RTMP participant as `<ownerId>#rtmp`), so the host carries their
  // own id like everyone else. It used to be the bare literal `broadcaster` —
  // no user id at all — which made the host a guest in their own room: no Host
  // chip, a remove control on their own tile, and in a gist room they appeared
  // under Speakers and House Members at once, as two people.
  it("recognises the host on their publisher token", () => {
    assert.equal(isHostParticipant("did:privy:abc#broadcaster", "did:privy:abc"), true);
  });

  it("...and when they are pushing RTMP", () => {
    assert.equal(isHostParticipant("did:privy:abc#rtmp", "did:privy:abc"), true);
  });

  it("still recognises the host on their own viewer connection", () => {
    assert.equal(isHostParticipant("did:privy:abc", "did:privy:abc"), true);
    assert.equal(isHostParticipant("did:privy:abc#speaker", "did:privy:abc"), true);
  });

  it("does not promote a guest", () => {
    assert.equal(isHostParticipant("did:privy:zzz", "did:privy:abc"), false);
    assert.equal(isHostParticipant("did:privy:zzz#speaker", "did:privy:abc"), false);
    assert.equal(isHostParticipant("did:privy:zzz#broadcaster", "did:privy:abc"), false);
  });

  it("no longer trusts the bare `broadcaster` literal", () => {
    // The workaround this replaced matched it for EVERY stream, so anyone who
    // took that identity was the host of all of them. It is deleted rather
    // than kept beside the real check.
    assert.equal(isHostParticipant("broadcaster", "did:privy:abc"), false);
  });

  it("never guesses a host when the stream has no owner", () => {
    assert.equal(isHostParticipant("did:privy:abc#broadcaster", ""), false);
  });

  it("gives the publisher the host slot in buildStage", () => {
    const room = {
      localParticipant: {
        identity: "did:privy:abc#broadcaster",
        isLocal: true,
        permissions: { canPublish: true },
        videoTrackPublications: new Map(),
        audioTrackPublications: new Map(),
      },
      remoteParticipants: new Map(),
    };
    const slots = buildStage(room as never, "did:privy:abc");
    assert.equal(slots.length, 1);
    assert.equal(slots[0].role, "host");
  });
});

describe("the host's soft mute on a seat", () => {
  const guest = (muted: boolean, attributes: Record<string, string> | undefined) =>
    participant("did:privy:guest#speaker", {
      permissions: { canPublish: true },
      attributes,
      audioTrackPublications: new Map([["a", publication("guest-a", muted)]]),
    });

  it("marks a seat Muted by host while the attribute is set and the mic is muted", () => {
    const [, slot] = buildStage(room(publishing(HOST), guest(true, { hostMuted: "soft" })), HOST);
    assert.equal(slot.mutedByHost, true);
  });

  it("marks the seat for the value the service writes, 'true'", () => {
    const [, slot] = buildStage(room(publishing(HOST), guest(true, { hostMuted: "true" })), HOST);
    assert.equal(slot.mutedByHost, true);
  });

  it("drops the badge the moment the speaker unmutes themselves", () => {
    const [, slot] = buildStage(room(publishing(HOST), guest(false, { hostMuted: "soft" })), HOST);
    assert.equal(slot.mutedByHost, false);
  });

  it("never marks a self-muted speaker, and keeps a muted host-muted speaker SEATED", () => {
    const stage = buildStage(room(publishing(HOST), guest(true, undefined)), HOST);
    assert.equal(stage.length, 2);
    assert.equal(stage[1].mutedByHost, false);
  });
});

describe("Gifting anybody in a gist room", () => {
  /*
    The gist room had NO gift surface at all: the tray and the flying burst
    were built for broadcasts and lived inline in `stream-room`, so a room
    could only "Give a tip" — which moves money quietly and shows the room
    nothing. A gift is the opposite act; its whole point is that everybody sees
    it happen and sees who it was for.

    What is pinned here is the SAFETY of shipping it before the service can
    name a recipient, because that is the part that would cost somebody money
    if it drifted.
  */
  it("prices the room tray, and charges the person who was NAMED", () => {
    /*
      This test ran the other way for a week, and the reason it did is the
      point: `POST /streams/:id/gifts` hardcoded `recipientId = stream.ownerId`,
      so a priced gift aimed at a named person would have charged the sender
      and paid the HOST while the screen said somebody else's name.

      The service now carries `toProfileId` — verified in production against
      the served OpenAPI document, not taken on report — so the tray is priced
      and the money follows the name.

      WHAT MUST NOT DRIFT, and what this pins:
        · `toProfileId` is SENT, so the named person is paid rather than the
          host silently inheriting the money;
        · the burst and the data-channel packet go out BEFORE the payment and
          are never retracted — a gift the room has seen is not un-seen
          because a wallet refused;
        · a 409 is told apart from a refusal, because the sender did nothing
          wrong when somebody walks out mid-gift.
    */
    const room = source("features/houses/components/house-room.tsx");
    const tray = room.slice(room.indexOf("<GiftSheet"), room.indexOf("<GiftSheet") + 500);
    assert.match(tray, /recipients=\{giftRecipients\}/, "the room's tray offers nobody to gift");
    assert.match(tray, /priced=\{giftsArePriced\(stream\.status\)\}/, "the room tray is free again");

    // The money names the recipient, and the show is not conditional on it.
    assert.ok(s_includes(room, "toProfileId: to.id"), "the gift pays whoever the route defaults to");
    assert.ok(
      room.indexOf("giftBursts.spawn(") < room.indexOf("if (!giftsArePriced(stream.status)) return;"),
      "the burst is now gated on payment — a gift the room saw must not be un-seen"
    );
    assert.ok(
      s_includes(room, "recipientLeftTheRoom(error)"),
      "'they left' is reported as a refusal of the sender"
    );
  });

  it("never offers to gift yourself, and puts the host first", () => {
    /*
      SELF IS REMOVED, NOT DISABLED. The service refuses a self-gift outright
      ("You cannot tip yourself"), so drawing the row would be drawing a
      control whose only possible outcome is an error.

      HOST FIRST is what makes the picker safe to ship early: a sender who
      never looks at the row gifts the person today's route would have paid
      anyway, so the default cannot be wrong even while the route ignores the
      choice.
    */
    const room = source("features/houses/components/house-room.tsx");
    const build = room.slice(room.indexOf("const giftRecipients"), room.indexOf("const giftRecipients") + 900);
    assert.match(build, /id === myId/, "the roster can offer you yourself");
    assert.match(build, /if \(hostId\) add\(/, "the host is not added first, so the default is arbitrary");
    assert.match(build, /seen\.has\(id\)/, "a person seated AND in the audience is offered twice");
  });

  it("names both ends on the burst, because half the event is who it was for", () => {
    // On a broadcast there was only ever one person a gift could be for, so
    // the burst named the sender alone. In a room where anybody can be
    // gifted, the recipient is what the room — and the recipient — is
    // watching for.
    const room = source("features/houses/components/house-room.tsx");
    assert.match(room, /`You → \$\{to\.name\}`/);
    assert.match(room, /live\.gift\(gift\.id, quantity, to \?/);
  });

  it("names the recipient even when there is only one, and refuses when there are none", () => {
    /*
      The picker was drawn only at `> 1`, on the argument that a control with a
      single option is a label wearing a control's clothes. Wrong for this
      surface: the row is not only a chooser, it is the ANSWER to who the gift
      is going to, and hiding it at one left a sender pressing Send with no
      statement on screen of who receives it (ogazboiz, 2026-09-24: "how can we
      select the person we want to gift").

      And NOBODY TO GIFT IS A REAL STATE — a host opens a room and is alone in
      it until somebody walks in. Sending then would fly a gift addressed to no
      one, so the action has to refuse and say what is missing.
    */
    const sheet = source("components/ui/gift-sheet.tsx");
    assert.match(sheet, /\{people\.length > 0 && \(/, "the picker hides itself when there is one person");
    assert.ok(
      s_includes(sheet, "Boolean(recipients) && people.length === 0"),
      "the empty-room guard is gone"
    );
    // An empty room and an empty wallet are DIFFERENT answers, and only one
    // of them is a refusal. Nobody to gift is terminal; short of KASH hands
    // over to the top-up, so it only disables when there is no top-up to
    // offer — see the TikTok note in gift-sheet.
    assert.ok(
      s_includes(sheet, "(overBalance && !onTopUp)"),
      "being short of KASH refuses outright instead of offering the top-up"
    );
    assert.match(sheet, /"Nobody else is here yet"/);
    // A BROADCAST passes no `recipients` at all and must still send, to the
    // host, exactly as it always did — the guard is on the room shape only.
    assert.ok(
      sheet.includes('recipients && people.length === 0'),
      "the empty-room guard no longer keys on the room shape"
    );
  });

  it("tapping a person offers a gift, and only when they resolve", () => {
    /*
      The dock's gift button is "pick an object, then a person". Tapping
      somebody and saying send them a gift is how a person actually arrives at
      the thought (ogazboiz, 2026-09-24: "how do we give a person gift in a
      gist room"), so the room offers both doors into ONE tray.

      THE GUARD IS THE IMPORTANT HALF. A host's LiveKit identity is the literal
      string `broadcaster` and carries no account id, so the id must come from
      `stream.ownerId` — and anybody who does not resolve to a row the roster
      already knows is not offered the control at all. A row that quietly fell
      back to the host would pay the WRONG PERSON while naming another.
    */
    const room = source("features/houses/components/house-room.tsx");
    const sheet = source("features/houses/components/person-sheet.tsx");
    assert.match(room, /const giftablePersonId = useMemo/);
    assert.match(room, /livePerson\.isRoomHost \? stream\.ownerId : baseIdentity\(livePerson\.identity\)/);
    assert.match(room, /giftRecipients\.some\(\(row\) => row\.id === id\) \? id : null/);
    // Offered only when it resolves — `undefined` removes the row entirely.
    assert.ok(
      s_includes(room, "giftablePersonId"),
      "the gift row is no longer gated on the person resolving"
    );
    // Never on yourself: the service refuses a self-gift outright.
    assert.match(sheet, /\{!isSelf && onGift && \(/);
    // And the tray opens ON that person rather than on the host.
    assert.match(room, /initialRecipientId=\{giftTo\}/);
  });

  it("both rooms draw gift bursts from ONE component", () => {
    // It was inline in stream-room, which is exactly why the gist room had
    // none. A second copy is how one of them draws a different burst for the
    // same packet.
    const shared = source("features/streams/components/gift-bursts.tsx");
    assert.match(shared, /export function useGiftBursts\(/);
    assert.match(shared, /export function GiftBursts\(/);
    // The catalogue is the authority on artwork, never the wire — a gift this
    // build has not heard of must draw nothing rather than an empty frame.
    assert.match(shared, /LIVE_GIFTS\.find\(\(item\) => item\.id === giftId\)/);
    assert.match(shared, /if \(!gift\) return;/);
    assert.match(source("features/houses/components/house-room.tsx"), /<GiftBursts items=\{giftBursts\.items\}/);
  });
});

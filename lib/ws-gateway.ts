/**
 * THE WS-GATEWAY CLIENT — a realtime "something changed" signal, layered on
 * the feed's 30-second head check, which stays as the floor.
 *
 * One socket per page at `wss://<gateway>/`, every topic multiplexed over
 * it. Frames OUT are exactly four: `subscribe`, `unsubscribe`, `ping`, and
 * `authenticate` (a fresh token, only when a personal topic needs one — and
 * only ever as a frame, never on the upgrade URL, where logs would keep it).
 * Frames IN are `{ type, data, timestamp }`. The client reads `welcome` and
 * `authenticated` for who the gateway decided the socket is, `data.lane` on
 * a `feedHeadChanged` event, and `data.streamId` on the speaker signals —
 * every payload is a signal to refetch and is trusted for nothing else.
 *
 * ─── OFF UNLESS CONFIGURED ──────────────────────────────────────────────────
 * `MARKET_FLAGS.wsGatewayUrl` (from `NEXT_PUBLIC_MS_WS_GATEWAY_URL`) absent
 * means NO socket is ever constructed; the poll carries on alone. A socket
 * that is refused or drops is equally invisible: it reconnects with backoff
 * and jitter (capped at 30s) and resubscribes, and the poll never stopped.
 *
 * ─── THE PURE HALF ──────────────────────────────────────────────────────────
 * `laneTopic`, `parseFrame`, `laneOfFrame` and `backoffDelay` have no I/O in
 * them and are pinned by `lib/ws-gateway.test.ts`, together with the guard
 * that an unconfigured client constructs nothing. `createGateway` takes the
 * socket constructor and the token source so the test can hand it fakes.
 */

/**
 * The inbound event this client acts on. Fixed by the backend (its feed
 * head broadcast, built after service PR #199): the topic is the
 * subscription, the TYPE is the event — never route on the topic string.
 */
export const FEED_HEAD_CHANGED = "feedHeadChanged";

/** Lanes the gateway broadcasts. `following` is per-reader and has no topic. */
const PUBLIC_LANES = new Set(["for-you", "trending", "reels", "live"]);

/** The topic for a lane, or null for a lane that must keep the poll only. */
export function laneTopic(lane: string): string | null {
  return PUBLIC_LANES.has(lane) ? `market-square:feed:${lane}` : null;
}

export interface GatewayFrame {
  type: string;
  data: Record<string, unknown>;
  timestamp: number | null;
}

/** A frame, or null for anything that is not `{ type: string, data: object }`. */
export function parseFrame(raw: unknown): GatewayFrame | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") return null;
  const data =
    record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};
  return {
    type: record.type,
    data,
    timestamp: typeof record.timestamp === "number" ? record.timestamp : null,
  };
}

/**
 * The lane a `feedHeadChanged` frame is about — exactly the key GET /feed
 * takes, so it drops into the query key with no mapping — or null for any
 * other frame, or a lane this client does not know.
 */
export function laneOfFrame(frame: GatewayFrame | null): string | null {
  if (!frame || frame.type !== FEED_HEAD_CHANGED) return null;
  const lane = frame.data.lane;
  return typeof lane === "string" && PUBLIC_LANES.has(lane) ? lane : null;
}

/* ─── THE SPEAKER SIGNALS, on the reader's own topic ─────────────────────────
 * `user:<did>` carries three room events, each a REFETCH SIGNAL and nothing
 * more: an invitation to speak, a speaker request changing, and a host's mute.
 * Only the stream id is ever read out of one — to choose which queries to ask
 * again — and never a request id, a status or an expiry: the banner and the
 * queue render from `GET /speaker-requests/me` and the host's list, so a
 * forged or stale frame can cause at most one extra read, never a banner.
 */
export const SPEAKER_INVITED = "speakerInvited";
export const SPEAKER_REQUEST_CHANGED = "speakerRequestChanged";
export const SPEAKER_MUTED = "speakerMuted";

/** The reader's private topic, or null without an id. */
export function userTopic(userId: string | null | undefined): string | null {
  return userId ? `user:${userId}` : null;
}

export interface SpeakerSignal {
  /** `requests` — refetch the reader's own row and the host's queue; `mute` — look at the mic. */
  kind: "requests" | "mute";
  streamId: string;
}

/** The refetch a speaker frame asks for, or null for anything else. */
export function speakerSignalOf(frame: GatewayFrame | null): SpeakerSignal | null {
  if (!frame) return null;
  const streamId = frame.data.streamId;
  if (typeof streamId !== "string" || streamId.length === 0) return null;
  if (frame.type === SPEAKER_INVITED || frame.type === SPEAKER_REQUEST_CHANGED) return { kind: "requests", streamId };
  if (frame.type === SPEAKER_MUTED) return { kind: "mute", streamId };
  return null;
}

/* ─── THE ROOM'S CHAT SIGNAL, on the room's own public topic ─────────────────
 * `market-square:stream:<id>` says "this room's chat changed". Like every
 * other frame here it is a REFETCH SIGNAL and nothing more: only the stream id
 * is read out of it, never a message, an author or a body. The chat renders
 * from `GET /streams/:id/chat` exactly as it does on the poll, so a forged or
 * stale frame can cause at most one extra read — it can never put words in
 * somebody's mouth, which is the whole reason the payload is not carried.
 *
 * PUBLIC, not personal. A room's chat is read anonymously (the service answers
 * that route with no token), and every participant needs the same signal, so
 * one public topic per room serves them all. `user:<id>` is for things that
 * concern ONE reader — an invitation, their own mute — and a room's chat is
 * not one of those.
 *
 * The poll stays the floor. An unconfigured gateway, a refused socket and a
 * dropped one are all invisible: the chat keeps its own interval and the
 * signal only makes it feel immediate.
 */
export const ROOM_CHAT_CHANGED = "roomChatChanged";

/** A room's public topic, or null without an id. */
export function roomChatTopic(streamId: string | null | undefined): string | null {
  return streamId ? `market-square:stream:${streamId}` : null;
}

/** The stream whose chat changed, or null for anything else. */
export function roomChatSignalOf(frame: GatewayFrame | null): string | null {
  if (!frame || frame.type !== ROOM_CHAT_CHANGED) return null;
  const streamId = frame.data.streamId;
  return typeof streamId === "string" && streamId.length > 0 ? streamId : null;
}

export const PING_MS = 25_000;
export const BACKOFF_CAP_MS = 30_000;

/**
 * Reconnect delay for the n-th consecutive failure: 1s doubling to the 30s
 * cap, with ±25% jitter so a fleet of tabs does not reconnect in step.
 * `random` is injected so the schedule can be pinned.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_MS, 1_000 * 2 ** Math.max(0, attempt));
  const jitter = (random() * 2 - 1) * 0.25 * base;
  return Math.round(Math.min(BACKOFF_CAP_MS, Math.max(250, base + jitter)));
}

/** The subset of WebSocket this client touches, so a test can fake it. */
export type SocketLike = Pick<
  WebSocket,
  "readyState" | "send" | "close" | "onopen" | "onclose" | "onerror" | "onmessage"
>;
export type SocketFactory = (url: string) => SocketLike;

/**
 * The reader's access token, or null when signed out. The gateway verifies it
 * with the same Privy call every REST service makes; without one a socket is
 * anonymous and is refused every `user:<id>` topic.
 */
export type TokenSource = () => Promise<string | null>;

export interface GatewayOptions {
  /** Absent: an anonymous client, public topics only. */
  getToken?: TokenSource;
  /** Injected so the stability window can be pinned in a test. */
  now?: () => number;
}

/**
 * HOW LONG A CONNECTION MUST LAST TO COUNT AS A SUCCESS, before the backoff is
 * allowed to start over.
 *
 * Longer than `PING_MS`, so a socket only earns the reset by surviving at
 * least one ping — by which point it has actually carried traffic rather than
 * merely completed an upgrade.
 */
export const STABLE_MS = 30_000;

const OPEN = 1;
const PERSONAL_PREFIX = "user:";

/** The account a personal topic belongs to, or null for a public topic. */
export function personalTopicOwner(topic: string): string | null {
  if (!topic.startsWith(PERSONAL_PREFIX)) return null;
  const owner = topic.slice(PERSONAL_PREFIX.length);
  return owner.length > 0 ? owner : null;
}


export interface Gateway {
  /** Subscribe a listener to a topic. Returns the unsubscribe. */
  subscribe(topic: string, listener: (frame: GatewayFrame) => void): () => void;
  /**
   * Whether a socket is OPEN right now.
   *
   * Exposed so a caller can slow a poll down while the push is actually
   * arriving — and speed it back up the moment it is not. Nothing else should
   * read it as "realtime works": a socket can be open while a particular topic
   * has not been subscribed yet, which is why the poll slows rather than stops.
   */
  readonly connected: boolean;
  /**
   * Called on every open and every close, with the new state. Returns the
   * unsubscribe.
   *
   * A listener is NOT called on registration — React effects read `connected`
   * for the initial value and subscribe for the changes, and calling back
   * synchronously inside a subscribe would make that a double render for no
   * new information.
   */
  onConnectionChange(listener: (connected: boolean) => void): () => void;
  /** For tests and diagnostics: how many sockets were ever constructed. */
  readonly socketsOpened: number;
}

/**
 * Build a client. An empty `url` builds one that never opens a socket and
 * whose `subscribe` is a no-op that still returns a working unsubscribe —
 * so callers need no branch of their own.
 *
 * ─── AUTHENTICATION (ADR-0009) ──────────────────────────────────────────────
 * THE TOKEN NEVER GOES IN THE ADDRESS. The gateway would read `?token=` off
 * the upgrade, but a URL is written down by every proxy, load balancer and
 * access log it passes through, and a Privy access token there is a bearer
 * credential sitting in somebody's log retention. So the socket always opens
 * ANONYMOUS, and the token travels inside the connection as the gateway's own
 * `{ type: "authenticate", token }` frame.
 *
 * On open, public topics are subscribed at once. Personal topics (`user:<id>`)
 * are HELD: a subscribe sent before the gateway has verified the token is
 * judged against the anonymous identity and refused, and the gateway does not
 * remember a refusal. With a personal topic to carry, the open sends one
 * `authenticate` with a fresh token; once the gateway answers `authenticated`
 * as that account, the account's personal topics are subscribed. A personal
 * topic that arrives later on a socket not yet authenticated as its owner
 * sends `authenticate` the same way. A token that does not verify leaves the
 * socket anonymous: nothing is retried on its own until the next connect or
 * the next personal topic, and the poll stays the floor.
 */
export function createGateway(url: string, makeSocket: SocketFactory, options: GatewayOptions = {}): Gateway {
  const { getToken, now = Date.now } = options;
  const listeners = new Map<string, Set<(frame: GatewayFrame) => void>>();
  /*
    Who wants to know whether the socket is up.

    Separate from the topic listeners because it is a different question: a
    topic listener wants frames, these want to know whether frames are coming
    at all. Kept as a Set so a React effect's unsubscribe is exact, and
    notified only on a TRANSITION — a reconnect that re-opens is news, an open
    socket staying open is not.
  */
  const connectionListeners = new Set<(connected: boolean) => void>();
  let connected = false;

  /** Announce a transition, once, and never let one listener's throw stop the rest. */
  const setConnected = (next: boolean): void => {
    if (connected === next) return;
    connected = next;
    for (const listener of [...connectionListeners]) {
      try {
        listener(next);
      } catch {
        // A render that throws is the caller's problem, not the socket's. The
        // remaining listeners still need telling, and the connection itself
        // must not be taken down by a bad subscriber.
      }
    }
  };
  let socket: SocketLike | null = null;
  let opened = 0;
  let attempt = 0;
  /** When the live socket opened, or 0 when none is open. See `onopen`. */
  let openedAt = 0;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedOnPurpose = false;
  /** Who the gateway last said this socket is; null while anonymous. */
  let authedAs: string | null = null;
  /** An `authenticate` is out and not yet answered. */
  let authenticating = false;
  /** The gateway has answered an `authenticate` on this socket: a late `welcome` cannot undo it. */
  let answered = false;

  const send = (frame: Record<string, unknown>) => {
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(frame));
  };

  const stopTimers = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  /** Topics this socket can be heard on as it stands: every public one, and the personal ones it is authenticated for. */
  const hearable = () =>
    [...listeners.keys()].filter((topic) => {
      const owner = personalTopicOwner(topic);
      return owner === null || owner === authedAs;
    });

  /** Personal topics held that this socket's identity cannot hear. */
  const unheardPersonal = () =>
    [...listeners.keys()].filter((topic) => {
      const owner = personalTopicOwner(topic);
      return owner !== null && owner !== authedAs;
    });

  const authenticate = () => {
    if (!getToken || authenticating || !socket || socket.readyState !== OPEN) return;
    const current = socket;
    authenticating = true;
    void getToken()
      .catch(() => null)
      .then((token) => {
        if (socket !== current) return;
        if (!token) {
          // Signed out, or Privy has none to give: stay anonymous, quietly.
          authenticating = false;
          return;
        }
        send({ type: "authenticate", token });
      });
  };

  const onAuthenticated = (userId: string | null) => {
    authedAs = userId;
    authenticating = false;
    answered = true;
    if (!userId) return;
    // Held until now: a subscribe sent before the verification was refused.
    const mine = [...listeners.keys()].filter((topic) => personalTopicOwner(topic) === userId);
    if (mine.length > 0) send({ type: "subscribe", topics: mine });
  };

  const open = (address: string) => {
    opened += 1;
    const next = makeSocket(address);
    socket = next;
    authedAs = null;
    authenticating = false;
    answered = false;
    next.onopen = () => {
      /*
        THE BACKOFF RESET DOES NOT LIVE HERE ANY MORE, and that was the bug.

        An upgrade that SUCCEEDS is not the same thing as a connection that
        WORKS. A gateway under load — or one being restarted, or one shedding
        load on purpose — accepts the socket and drops it milliseconds later.
        Resetting `attempt` on open meant every one of those cycles started the
        ladder again, so the delay was `backoffDelay(0)` forever: about one
        second, for ever, per tab, with no escalation of any kind.

        Measured against a fake socket that accepts then drops: 37-57 upgrades
        per minute per visible tab, where the ladder's own steady state at the
        30s cap is 2.6. A 14-22x amplification, applied by every client at once,
        precisely while the gateway is least able to take it. The backoff was
        written to prevent this and could never fire.

        So `openedAt` is recorded here and the reset moved into `onclose`,
        where the connection's lifetime is known.
      */
      openedAt = now();
      setConnected(true);
      // Everything subscribed before or during the outage, again — the
      // personal topics once the gateway has verified who this is.
      const topics = hearable();
      if (topics.length > 0) send({ type: "subscribe", topics });
      if (unheardPersonal().length > 0) authenticate();
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ type: "ping" }), PING_MS);
    };
    next.onmessage = (event) => {
      const frame = parseFrame(event.data);
      if (!frame || frame.type === "pong") return;
      const userId = typeof frame.data.userId === "string" && frame.data.userId ? frame.data.userId : null;
      if (frame.type === "welcome") {
        // The upgrade carried no token, so this is anonymous; it can arrive
        // after an `authenticated` and must not wipe the identity that set.
        if (!answered) authedAs = frame.data.authenticated === true ? userId : null;
        return;
      }
      if (frame.type === "authenticated") {
        onAuthenticated(frame.data.ok === true ? userId : null);
        return;
      }
      // Frames carry no topic, so every listener hears every frame and
      // decides from the TYPE and its own lane — never from the topic.
      for (const set of listeners.values()) for (const listener of set) listener(frame);
    };
    next.onerror = () => {
      // The close that follows does the work; nothing to say here, nothing
      // to show — a down socket is invisible and the poll continues.
    };
    next.onclose = () => {
      /*
        A STALE socket's close, ignored — and a trap for whoever edits below it.

        `disconnect()` nulls `socket` BEFORE calling close(), so a DELIBERATE
        close always returns right here and nothing further down this handler
        runs. Today nothing is lost by that, because `disconnect` repeats by hand
        what this handler would have done. But it means anything added below is
        silently dead whenever the app closes the socket itself — it will work
        when you test it by pulling the network and do nothing when a component
        unmounts, which is the worst shape a latent bug has.

        So: add cleanup to BOTH, or add it to `disconnect` alone. Not here only.
      */
      if (socket !== next) return;
      socket = null;
      authedAs = null;
      authenticating = false;
      answered = false;
      /*
        An UNEXPECTED drop. Announced before the early return below, because a
        close with nothing subscribed stops there without scheduling a reconnect
        and still leaves the socket shut.

        A DELIBERATE close does not reach this line at all — `disconnect()` nulls
        `socket` before closing, so the stale-socket guard above returns first.
        That path announces for itself; see `disconnect`.
      */
      setConnected(false);
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
      if (closedOnPurpose || listeners.size === 0) return;
      // A connection that lasted counts as a success and earns a fresh ladder.
      // One that did not is another failure, whatever the upgrade reported.
      if (openedAt > 0 && now() - openedAt >= STABLE_MS) attempt = 0;
      openedAt = 0;
      const delay = backoffDelay(attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  };

  const connect = () => {
    if (!url || socket) return;
    closedOnPurpose = false;
    // Always the bare address: the token is a frame, never a query string.
    open(url);
  };

  const disconnect = () => {
    closedOnPurpose = true;
    stopTimers();
    const current = socket;
    socket = null;
    /*
      Announced HERE, not left to `onclose`, and the reason is the guard in it:
      `socket` is already null by the time the close fires, so the handler treats
      its own socket as stale and returns before saying anything. Without this a
      deliberate disconnect left `connected` true for ever, and a caller that had
      slowed its poll down kept the slow cadence over a socket that was gone.
      `setConnected` ignores a repeat, so the two paths cannot double-report.
    */
    setConnected(false);
    authedAs = null;
    authenticating = false;
    answered = false;
    current?.close();
  };

  return {
    get socketsOpened() {
      return opened;
    },
    get connected() {
      return connected;
    },
    onConnectionChange(listener) {
      connectionListeners.add(listener);
      return () => {
        connectionListeners.delete(listener);
      };
    },
    subscribe(topic, listener) {
      if (!url) return () => {};
      let set = listeners.get(topic);
      const fresh = !set;
      if (!set) {
        set = new Set();
        listeners.set(topic, set);
      }
      set.add(listener);
      const owner = personalTopicOwner(topic);
      if (fresh && (owner === null || owner === authedAs)) send({ type: "subscribe", topics: [topic] });
      // A personal topic on an open socket that is not yet this account: it
      // is subscribed once the gateway has verified the reader's token.
      else if (fresh) authenticate();
      connect();
      return () => {
        const current = listeners.get(topic);
        if (!current) return;
        current.delete(listener);
        if (current.size > 0) return;
        listeners.delete(topic);
        send({ type: "unsubscribe", topics: [topic] });
        // Last subscriber gone: the socket has nothing to carry.
        if (listeners.size === 0) disconnect();
      };
    },
  };
}

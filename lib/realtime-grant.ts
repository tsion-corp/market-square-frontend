import { msApi } from "@/lib/api/service";
import { errorCode } from "@/lib/api/envelope";

/**
 * The permit that lets a socket hear a private conversation topic.
 *
 * `GET /realtime/grant` mints a short-lived signed token naming exactly the
 * conversations this reader may subscribe to. The gateway refuses a conversation
 * topic without one, because the alternative is anybody subscribing to anybody's
 * thread.
 *
 * TWO THINGS A GRANT DOES NOT GIVE YOU, and both are reasons the thread poll
 * stays rather than being deleted:
 *
 *   1. It is CAPPED. The service fills it with the most recently active rooms, so
 *      a reader in more conversations than the cap has rooms it does not cover.
 *      Pinning the open thread with `conversationIds` fixes that one room —
 *      which matters because reading an old room does not make it recently
 *      active, so the recency fill can never reach it on its own.
 *   2. It may be UNAVAILABLE. The service answers SERVICE_UNAVAILABLE when
 *      realtime is not configured, and its own documentation calls that a
 *      working deployment where the client simply keeps polling. Not an error to
 *      report, and not a reason to retry hard.
 *
 * So the rule every caller follows: subscribe when the grant covers this
 * conversation, and poll when it does not. Never one or the other for everybody.
 */
export interface RealtimeGrant {
  token: string;
  /** Unix SECONDS, as the service sends it. Opaque token; this is the clock. */
  expiresAt: number;
  /** Exactly the conversations this grant covers. */
  conversationIds: string[];
}

/**
 * How long before expiry a grant counts as spent.
 *
 * A grant that expires mid-subscription leaves the reader on a topic the gateway
 * has stopped issuing, which looks like "messages stopped arriving" and nothing
 * else. Renewing a minute early costs one request and removes that window.
 */
const RENEW_BEFORE_SECONDS = 60;

/** Nothing is mintable: realtime is off, or the reader is not signed in. */
export const GRANT_UNAVAILABLE = "unavailable" as const;

export type GrantResult = RealtimeGrant | typeof GRANT_UNAVAILABLE;

export function grantCovers(grant: GrantResult | null, conversationId: string): boolean {
  if (grant === null || grant === GRANT_UNAVAILABLE) return false;
  return grant.conversationIds.includes(conversationId);
}

export function grantIsFresh(grant: RealtimeGrant, nowSeconds: number): boolean {
  return grant.expiresAt - RENEW_BEFORE_SECONDS > nowSeconds;
}

/**
 * Mint one, pinning the conversations the caller needs covered.
 *
 * Returns `GRANT_UNAVAILABLE` rather than throwing when realtime is off: that is
 * a working deployment and a caller's correct response is to keep polling, which
 * is not an error path. Any OTHER failure also lands there — a grant that cannot
 * be minted and a grant that is not offered are the same thing to a caller, and
 * the difference is not worth a second branch at every call site.
 */
export async function mintGrant(pinned: readonly string[] = []): Promise<GrantResult> {
  const query = pinned.length > 0 ? `?conversationIds=${pinned.join(",")}` : "";
  try {
    const grant = await msApi.get<RealtimeGrant>(`/realtime/grant${query}`);
    return {
      token: grant.token,
      expiresAt: grant.expiresAt,
      // Defensive: the contract says these are the rooms covered, and every
      // caller's decision to poll or subscribe reads this array. A malformed
      // body must mean "covers nothing", never "covers everything".
      conversationIds: Array.isArray(grant.conversationIds) ? grant.conversationIds : [],
    };
  } catch (error) {
    // SERVICE_UNAVAILABLE is the documented "realtime is not configured" answer.
    // It is not worth a console line: the client keeps its poll and the reader
    // sees no difference.
    if (errorCode(error) !== "SERVICE_UNAVAILABLE") {
      // Anything else is worth knowing about while developing, and still must
      // not be shown to the reader — they did not ask for a socket.
      if (process.env.NODE_ENV !== "production") {
        console.warn("realtime grant could not be minted", error);
      }
    }
    return GRANT_UNAVAILABLE;
  }
}

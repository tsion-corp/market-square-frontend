"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sharedGateway } from "@/lib/ws-gateway-shared";
import { chatSignalOf, conversationTopic } from "@/lib/ws-gateway";
import { MARKET_FLAGS } from "@/lib/market-config";
import { GRANT_UNAVAILABLE, grantCovers, grantIsFresh, mintGrant } from "@/lib/realtime-grant";

/**
 * An open thread hears `chatMessageArrived` instead of waiting for its next tick.
 *
 * The frame carries `{ conversationId, messageId }` and no body, so this only
 * ever invalidates — the thread still renders from
 * `GET /conversations/:id/messages` exactly as it does on the poll, and a forged
 * or stale frame costs at most one extra read.
 *
 * THE POLL DOES NOT MOVE YET, deliberately, and that is this file's own plan
 * rather than caution for its own sake: subscriber first, confirm frames in
 * production, relax only after. A slower interval with no subscriber behind it
 * is a straight downgrade for every reader, paid now for a benefit that does not
 * exist. The same order `useLaneSignal` and the room chat signal both used.
 *
 * WHEN THE POLL DOES MOVE, it cannot simply be deleted, for two reasons and only
 * the first is obvious:
 *
 *   1. The grant is CAPPED. It covers the most recently active rooms, so a reader
 *      in more conversations than the cap has threads it does not name. Pinning
 *      the open one fixes that thread and no others.
 *   2. A grant may be UNAVAILABLE. The service answers SERVICE_UNAVAILABLE when
 *      realtime is not configured and calls that a working deployment where the
 *      client keeps polling.
 *
 * So the condition is "this conversation is covered by a grant we hold", never
 * "the socket is up".
 */
export function useThreadSignal(conversationId: string, enabled: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !conversationId || !MARKET_FLAGS.wsGatewayUrl) return;
    const topic = conversationTopic(conversationId);
    if (!topic) return;

    let off: (() => void) | null = null;
    let renewTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const listen = (grant: string) => {
      off?.();
      /*
        Re-subscribing with a renewed token is how the gateway is told; it keeps
        whatever it was last given, so a grant that expires without being replaced
        stops the topic being issued, which looks like "messages stopped" and
        nothing else.
      */
      off = sharedGateway().subscribe(
        topic,
        (frame) => {
          if (chatSignalOf(frame) !== conversationId) return;
          void queryClient.invalidateQueries({ queryKey: ["ms", "messages", conversationId] });
        },
        { grant },
      );
    };

    const claim = async () => {
      // Pinned explicitly: reading an old thread does not make it recently
      // active, so the recency fill can never reach it on its own.
      const grant = await mintGrant([conversationId]);
      if (cancelled) return;
      if (grant === GRANT_UNAVAILABLE || !grantCovers(grant, conversationId)) {
        /*
          Not covered, or not offered. Nothing to subscribe to and nothing to
          retry — the poll is already carrying this thread, and hammering the
          grant endpoint because it said no would cost more than it saves. The
          next open of this thread asks again.
        */
        return;
      }
      listen(grant.token);
      // Renew a little before expiry rather than after: the gap between a spent
      // grant and a new one is a window where frames stop and nothing says so.
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!grantIsFresh(grant, nowSeconds)) return;
      const renewInMs = Math.max(1_000, (grant.expiresAt - 60 - nowSeconds) * 1_000);
      renewTimer = setTimeout(() => {
        void claim();
      }, renewInMs);
    };

    void claim();

    return () => {
      cancelled = true;
      if (renewTimer) clearTimeout(renewTimer);
      off?.();
    };
  }, [conversationId, enabled, queryClient]);
}

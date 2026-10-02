"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { sharedGateway } from "@/lib/ws-gateway-shared";
import { isUnreadSignal, userTopic } from "@/lib/ws-gateway";
import { MARKET_FLAGS } from "@/lib/market-config";

/**
 * Keeps the nav badge current from the reader's own topic.
 *
 * `GET /me/unread` is the most-polled endpoint in the product: three counts
 * behind one badge, asked by every open tab on every page, scoped to nothing the
 * way the thread and room signals are scoped to something on screen. The service
 * now says when a count moves, in both directions, so the timer does not have to
 * ask.
 *
 * THE FIRST PERSISTENT PERSONAL-TOPIC SUBSCRIPTION in the app, and the reason
 * this is a hook of its own rather than three lines in `useUnread`. The only
 * other `user:<id>` subscriber lives inside the room session: it exists only
 * while a room is held, and it discards any frame without a `streamId`. A badge
 * has to hear while the reader is anywhere, so this subscribes for as long as
 * they are signed in and reads a different frame.
 *
 * DELIBERATELY SAFE BEFORE THE SERVICE SHIPS IT. Until the publisher is
 * deployed no frame arrives, nothing is invalidated, and the poll in `useUnread`
 * carries the badge exactly as it does today — so this can land first and simply
 * start working. That is also why the poll is untouched here: subscriber first,
 * confirm frames in production, relax only after.
 */
/**
 * `badgeKey` is passed in rather than imported, because `useUnread` owns it and
 * calls this — importing it back would make the two files a cycle.
 */
export function useUnreadSignal(
  userId: string | null,
  enabled: boolean,
  badgeKey: readonly unknown[],
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || !userId || !MARKET_FLAGS.wsGatewayUrl) return;
    const topic = userTopic(userId);
    if (!topic) return;
    /*
      NOT gated on visibility, unlike the feed and room signals.

      Those drive something the reader is looking at, so a hidden tab has nothing
      to keep fresh. A badge is the opposite: its whole job is to be right the
      moment the tab is looked at again, and re-subscribing on every
      visibilitychange would re-authenticate the socket for a frame that costs
      one small read.
    */
    return sharedGateway().subscribe(topic, (frame) => {
      if (!isUnreadSignal(frame)) return;
      void queryClient.invalidateQueries({ queryKey: badgeKey });
    });
  }, [userId, enabled, queryClient, badgeKey]);
}

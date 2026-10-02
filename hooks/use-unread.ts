"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { msApi } from "@/lib/api/service";
import { useAuth } from "@/hooks/use-auth";
import { useMe } from "@/hooks/use-me";
import { useUnreadSignal } from "@/hooks/use-unread-signal";

/**
 * The primary nav's unread badges.
 *
 * `GET /me/unread` answers both counts in one call, and both are GLOBAL — the
 * whole point of the endpoint. Badge counts are never derived from a page of
 * the inbox or the notification list, which would undercount past page one.
 *
 * Cadence: 45s. It is two aggregate queries server-side, so a tighter loop
 * would cost more than it is worth for a number that only ever nudges a badge.
 * Anything that changes a count locally — sending a message, marking a thread
 * or the notification list read — invalidates this key immediately through
 * `useRefreshUnread`, so the poll is a backstop for *other people's* activity
 * rather than the path for your own.
 */
const UnreadSchema = z.object({
  messages: z.number().optional().default(0),
  notifications: z.number().optional().default(0),
  /**
   * CONVERSATIONS WAITING FOR THE READER'S ANSWER — a stranger's first DM, and
   * a house SEAT somebody added them to without being allowed to do it silently.
   *
   * Deliberately NOT part of `messages`: a stranger must not be able to put a
   * number on somebody's nav. So it badges the Gist Requests tab and the Chat
   * entry separately, and the two are never added together.
   *
   * It was returned by the service and read by NOTHING until now, which is why
   * a pending house seat landed in a tab with no indication anywhere that it
   * was there — indistinguishable, from the reader's side, from being put in a
   * house without being asked. Which is the complaint this whole feature
   * answers.
   */
  chatRequests: z.number().optional().default(0),
});

export const UNREAD_KEY = ["ms", "unread"] as const;
const UNREAD_POLL_MS = 45_000;

export function useUnread() {
  const { authenticated } = useAuth();
  const me = useMe();
  /*
    The service says when a count moves, in both directions, on the reader's own
    topic — so the timer below no longer has to be the only way to find out.

    The POLL IS UNCHANGED on purpose: subscriber first, confirm frames in
    production, relax only after. Until the publisher is deployed no frame
    arrives, nothing is invalidated, and the poll carries the badge exactly as it
    does today, which is what makes this safe to land first.
  */
  useUnreadSignal(me.data?.id ?? null, authenticated, UNREAD_KEY);
  return useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () => UnreadSchema.parse(await msApi.authedGet("/me/unread")),
    enabled: authenticated,
    refetchInterval: UNREAD_POLL_MS,
  });
}

/** Pull the counts forward after an action that just changed them. */
export function useRefreshUnread() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: UNREAD_KEY });
}

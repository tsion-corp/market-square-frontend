"use client";

import { useSyncExternalStore } from "react";
import { sharedGateway } from "@/lib/ws-gateway-shared";
import { MARKET_FLAGS } from "@/lib/market-config";

/*
  `useSyncExternalStore` rather than state in an effect, which is what this is
  for: the socket is an external mutable source, and reading it into state inside
  an effect means a render that reports the wrong answer before the effect runs
  and a tear if the value changes in between. The three functions are module
  level so their identity is stable — a `subscribe` rebuilt every render
  resubscribes every render.
*/

const subscribe = (onChange: () => void): (() => void) => {
  if (!MARKET_FLAGS.wsGatewayUrl) return () => {};
  return sharedGateway().onConnectionChange(onChange);
};

const getSnapshot = (): boolean => (MARKET_FLAGS.wsGatewayUrl ? sharedGateway().connected : false);

/**
 * The server has no socket, so it renders as disconnected — which is the safe
 * answer: a caller gating a poll keeps its full cadence until the client says
 * otherwise, rather than hydrating with a slow timer it never earned.
 */
const getServerSnapshot = (): boolean => false;

/**
 * Whether a gateway socket is open right now.
 *
 * For deciding how hard to poll, and nothing else. A caller may slow a timer
 * down while frames are arriving and speed it back up the moment they are not —
 * which is the whole saving, because the alternative people reach for is
 * deleting the timer, and a deleted timer is a frozen screen for anybody whose
 * socket died.
 *
 * Returns false when no gateway is configured, so an environment without one
 * keeps every poll at full cadence without the caller writing that branch.
 *
 * NOT a claim that realtime works. A socket can be open while a particular topic
 * has not been subscribed, or while the reader is on a lane nothing broadcasts —
 * so this answers "are frames possible", and the caller still has to know
 * whether its own lane has a publisher.
 */
export function useGatewayConnected(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

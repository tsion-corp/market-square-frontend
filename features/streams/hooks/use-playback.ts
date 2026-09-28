"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPlaybackToken, sendHeartbeat } from "@/features/streams/lib/api";
import { trackMarketEvent } from "@/lib/analytics";

// Playback token, re-requested 30 s before it expires so the player never
// holds a lapsed token. A 403 means "no ticket" and is surfaced, not retried.
export function usePlaybackToken(streamId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "stream", streamId, "playback"],
    queryFn: () => fetchPlaybackToken(streamId),
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const expiresAt = query.state.data?.expiresAt;
      if (!expiresAt) return false;
      const msLeft = Date.parse(expiresAt) - Date.now() - 30_000;
      return Math.max(msLeft, 5_000);
    },
  });
}

const HEARTBEAT_MS = 15_000;

// While playing, POST a heartbeat every 15 s and keep the returned sessionId
// so the backend can stitch one continuous view session.
export function useHeartbeat(streamId: string, mode: "live" | "replay", playing: boolean) {
  const sessionId = useRef<string | null>(null);
  const qualifiedSent = useRef(false);

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const result = await sendHeartbeat(streamId, sessionId.current, mode);
        if (!cancelled) {
          sessionId.current = result.sessionId;
          if (!qualifiedSent.current && result.watchSeconds >= 30) {
            qualifiedSent.current = true;
            trackMarketEvent("qualified_watch_time_reached", { surface: "stream_room", entityType: "stream", entityId: streamId, metadata: { accessType: mode, watchSeconds: result.watchSeconds } });
          }
        }
      } catch {
        // A missed heartbeat is not worth surfacing; the next one retries.
      }
    };
    void beat();
    const interval = setInterval(beat, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [streamId, mode, playing]);
}

"use client";

import { useEffect, useSyncExternalStore } from "react";
import { resolveFollowState } from "@/lib/follow-resolve";
import type { Profile } from "@/lib/api/schemas";
import { useMe } from "@/hooks/use-me";

/**
 * The viewer's follow state, PERSISTED per viewer, layered under the server's
 * `isFollowing`.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Only SOME payloads carry the follow edge. `GET /profiles/:username` (the
 * profile page) carries `isFollowing` for a signed-in reader; `GET /feed`,
 * `GET /spotlight` and the rails do NOT. So a follow made from a feed card was
 * correct on the profile page (the server told it) and wrong in the feed after
 * a reload (the feed tells it nothing) — "I followed White, refreshed, and the
 * Follow button came back" (2026-09-28). `resolveFollowState` already keeps the
 * two facts apart — "server said no" vs "server said nothing" — but its session
 * fallback was in memory, so a reload wiped it.
 *
 * ─── HOW IT WORKS NOW ────────────────────────────────────────────────────────
 * The fallback is now a per-viewer localStorage store, and it is written from
 * TWO sides:
 *
 *   - a CLICK writes the viewer's intent (optimistic), so every surface flips
 *     at once and it survives a reload; and
 *   - a payload that CARRIES the truth writes it too (see `useIsFollowing`) —
 *     so the profile page, which the server does answer, seeds the store, and
 *     the feed then reads the last-known answer instead of nothing.
 *
 * `resolveFollowState` still lets the server win wherever it has an opinion, so
 * this only ever supplies an answer where the payload is silent. It can only
 * render a "Following" the viewer asked for or the server confirmed — never a
 * fabricated one (no record and no server field is still `false`).
 *
 * ─── PERSISTENCE, AND ITS ONE TRADEOFF ───────────────────────────────────────
 * The old comment here said intents must stay in memory so they cannot outlive
 * a follow undone on another device. That tradeoff is now taken deliberately
 * (ogazboiz, 2026-09-28: "frontend bridge now"): the win is a Follow button
 * that stops resetting on the feed; the cost is that a follow you undo on
 * another device can look stale on this one UNTIL you open that profile, where
 * the server's `false` overwrites the record and it self-heals. A `TTL_MS`
 * backstop bounds even that. The real fix is the backend carrying `isFollowing`
 * on `/feed`; when it does, `resolveFollowState` uses it and this store goes
 * quiet on its own.
 *
 * KEYED PER VIEWER, and every storage access is try/caught — the same rules as
 * `wink-store.ts` next door, for the same reasons (two accounts in one browser;
 * Safari private mode throwing on localStorage).
 */

// A record untouched for this long stops bridging. Only a backstop: the profile
// page rewrites the truth on every visit, and a real follow does not expire.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

type FollowRecord = { following: boolean; at: number };

const EMPTY: Map<string, FollowRecord> = new Map();
const cache = new Map<string, Map<string, FollowRecord>>();
const listeners = new Set<() => void>();

function storageKey(viewerId: string): string {
  return `ms.follows.${viewerId}`;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function parse(raw: string | null): Map<string, FollowRecord> {
  const map = new Map<string, FollowRecord>();
  if (!raw) return map;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return map;
    const now = Date.now();
    for (const entry of parsed) {
      const row = entry as { profileId?: unknown; following?: unknown; at?: unknown };
      if (
        typeof row.profileId === "string" &&
        typeof row.following === "boolean" &&
        typeof row.at === "number" &&
        now - row.at < TTL_MS
      ) {
        map.set(row.profileId, { following: row.following, at: row.at });
      }
    }
  } catch {
    // Unreadable storage degrades to "nothing recorded" — the server's own
    // answer (and the follow mutation) still work; only the bridge is missing.
  }
  return map;
}

/** The records for a viewer, memoised so a re-read does not reparse storage. */
function read(viewerId: string | null | undefined): Map<string, FollowRecord> {
  if (!viewerId) return EMPTY;
  const cached = cache.get(viewerId);
  if (cached) return cached;
  let map: Map<string, FollowRecord>;
  try {
    map = parse(window.localStorage.getItem(storageKey(viewerId)));
  } catch {
    map = new Map();
  }
  cache.set(viewerId, map);
  return map;
}

function write(viewerId: string, map: Map<string, FollowRecord>) {
  cache.set(viewerId, map);
  try {
    const rows = [...map.entries()].map(([profileId, record]) => ({
      profileId,
      following: record.following,
      at: record.at,
    }));
    window.localStorage.setItem(storageKey(viewerId), JSON.stringify(rows));
  } catch {
    // Unwritable storage still gets the in-memory update, so the button settles
    // correctly for the rest of this page view.
  }
  emit();
}

/**
 * Record the follow state for a profile — a click's optimistic intent, or the
 * server's confirmed truth. Idempotent: a value that already matches is a
 * no-op, so the reconcile in `useIsFollowing` cannot loop.
 */
export function setFollowIntent(
  viewerId: string | null | undefined,
  profileId: string,
  following: boolean
) {
  if (!viewerId) return;
  const current = read(viewerId);
  if (current.get(profileId)?.following === following) return;
  const next = new Map(current);
  next.set(profileId, { following, at: Date.now() });
  write(viewerId, next);
}

/** Drop a record — a follow mutation failed, so its guess must not survive. */
export function clearFollowIntent(viewerId: string | null | undefined, profileId: string) {
  if (!viewerId) return;
  const current = read(viewerId);
  if (!current.has(profileId)) return;
  const next = new Map(current);
  next.delete(profileId);
  write(viewerId, next);
}

function getIntent(viewerId: string | null | undefined, profileId: string): boolean | undefined {
  return read(viewerId).get(profileId)?.following;
}

// Server render has nothing stored and no viewer resolved yet, so the first
// client render matches the HTML we served. A real record can only exist after
// a click or a field-carrying payload anyway.
function serverSnapshot(): boolean | undefined {
  return undefined;
}

/**
 * The follow state to render: the server's answer when it gave one, otherwise
 * the per-viewer record, otherwise `false`.
 *
 * It also SEEDS the store: when this payload carries `isFollowing` (the profile
 * page does), the truth is written so the silent surfaces — the feed, the rails
 * — read the last-known answer after a reload. `setFollowIntent` is idempotent,
 * so seeding an already-matching value writes nothing and cannot loop.
 */
export function useIsFollowing(profile: Pick<Profile, "id" | "isFollowing">): boolean {
  const me = useMe();
  const viewerId = me.data?.id ?? null;
  const intent = useSyncExternalStore(
    subscribe,
    () => getIntent(viewerId, profile.id),
    serverSnapshot
  );
  const fromServer = profile.isFollowing;

  useEffect(() => {
    if (fromServer !== undefined) setFollowIntent(viewerId, profile.id, fromServer);
  }, [viewerId, profile.id, fromServer]);

  return resolveFollowState(fromServer, intent);
}

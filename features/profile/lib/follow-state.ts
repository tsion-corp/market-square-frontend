"use client";

import { useEffect, useSyncExternalStore } from "react";
import { intentIsSettled, resolveFollowState } from "@/lib/follow-resolve";
import type { Profile } from "@/lib/api/schemas";

/**
 * The session's own follow intents, layered over the server's `isFollowing`.
 *
 * Some list payloads carry the follow edge and some do not — `GET /spotlight`
 * currently omits it altogether. That leaves two facts the UI has to keep
 * apart:
 *
 *   - the server said `false`  → the viewer really does not follow them
 *   - the server said nothing  → the server has no opinion to report
 *
 * `ProfileSchema` keeps the second case as `undefined` rather than
 * defaulting it to `false`, and this store supplies the missing answer from
 * what the viewer did in this session. So:
 *
 *   - a click records an intent and the button flips immediately
 *   - a refetch that carries the field wins and the intent is dropped —
 *     the server reconciles us, we never reconcile ourselves
 *   - a refetch that omits the field leaves the intent standing, so the
 *     button no longer snaps back to "Follow"
 *
 * Crucially it can only ever *add* a Following that the viewer themselves
 * asked for. With no intent and no server field the answer is `false`, so a
 * backend that never ships `isFollowing` shows "Follow" — never a fabricated
 * "Following". The moment the field lands, the server value takes over on the
 * first refetch with no further change here.
 *
 * Intents are per-session and in-memory on purpose: they are a bridge over a
 * missing response field, not a cache of the follow graph, and persisting
 * them would outlive a follow undone on another device.
 */
const intents = new Map<string, boolean>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Record what the viewer just asked for, so the control flips at once. */
export function setFollowIntent(profileId: string, following: boolean) {
  if (intents.get(profileId) === following) return;
  intents.set(profileId, following);
  emit();
}

/** Drop an intent — the mutation failed, or the server has now answered. */
export function clearFollowIntent(profileId: string) {
  if (!intents.has(profileId)) return;
  intents.delete(profileId);
  emit();
}

function getIntent(profileId: string): boolean | undefined {
  return intents.get(profileId);
}

// The server snapshot is always empty so the first client render matches the
// HTML we served; a real intent can only exist after a click anyway.
function getServerIntent(): boolean | undefined {
  return undefined;
}

/**
 * The follow state to render: the server's answer when it gave one, otherwise
 * this session's intent, otherwise `false`.
 *
 * Also performs the reconcile — once a payload carries `isFollowing`, the
 * matching intent is retired so the server is the only source of truth again.
 */
export function useIsFollowing(profile: Pick<Profile, "id" | "isFollowing">): boolean {
  const intent = useSyncExternalStore(
    subscribe,
    () => getIntent(profile.id),
    getServerIntent
  );
  const fromServer = profile.isFollowing;

  useEffect(() => {
    if (intentIsSettled(fromServer)) clearFollowIntent(profile.id);
  }, [profile.id, fromServer]);

  return resolveFollowState(fromServer, intent);
}

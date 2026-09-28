"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { setBroadcastLive, useBroadcastStatus } from "@/hooks/use-broadcast-status";
import { unsubscribeThisBrowser } from "@/lib/push-client";
import { getRoomSession } from "@/lib/room-session-store";
import { forgetLegacySession } from "@/lib/api/client";
import { clearDecaneSessionCookie } from "@/lib/decane-session-cookie";
import { sq } from "@/lib/square-path";

// One logout flow for every surface: confirm if a broadcast is on air, then
// session logout, drop every cached query (identity, tickets, feeds), clear the
// broadcast signal, wipe every credential the BFF would accept, and land on
// /auth with a HARD reload so nothing in the SPA rehydrates the dead session.
export function useLogout(): () => Promise<void> {
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const broadcast = useBroadcastStatus();

  return async () => {
    if (broadcast.live && !window.confirm("You're live — leaving stops your broadcast.")) {
      return;
    }
    // Forget this browser for push BEFORE the session ends (the request needs
    // it), so a shared browser never keeps getting the last person's pushes.
    // The gist room comes down FIRST, while the session that owns it can still
    // free a seat — the next person in this browser must not inherit the call.
    //
    // BOTH pre-steps are best-effort: they make network calls, and if the
    // session is already dead (401) they throw — which used to reject the whole
    // logout before it reached `logout()`, so the reader could not sign out at
    // all (ogazboiz: "i cant logout"). Swallow their failures; ending the
    // session and leaving is what must always happen.
    await Promise.resolve(getRoomSession().logout()).catch(() => {});
    await Promise.resolve(unsubscribeThisBrowser()).catch(() => {});
    setBroadcastLive(null);
    queryClient.clear();
    await Promise.resolve(logout()).catch(() => {});
    /*
      CLEAR EVERY CREDENTIAL THE BFF ACCEPTS, or the next request signs the same
      account back in. server/auth.ts reads: Bearer → `decane-token` cookie →
      legacy `privy-token` cookie. Disconnecting Decane drops the Bearer, but the
      legacy Privy cookie was never touched — which is why a legacy account "kept
      using the same account" and could not log out (ogazboiz). Wipe both cookies.
    */
    clearDecaneSessionCookie();
    forgetLegacySession();
    // HARD navigation, not router.push: a client-side push keeps the auth
    // provider mounted and it re-hydrates the session it still holds in memory.
    // A full load re-initialises with no cookies and no token — a clean guest.
    window.location.href = sq("/auth");
  };
}

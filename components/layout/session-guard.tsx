"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DEMO_AUTH } from "@/lib/auth-mode";
import { onSessionExpired, setAuthSnapshot, type SessionEndReason } from "@/lib/session";
import { forgetLegacySession } from "@/lib/api/client";
import { clearDecaneSessionCookie } from "@/lib/decane-session-cookie";
import { useAuth } from "@/hooks/use-auth";
import { useBroadcastStatus } from "@/hooks/use-broadcast-status";
import { sq, stripSquare } from "@/lib/square-path";

// Owns the "session expired" UX. Two triggers, one flow:
// - reactive: the api client discovered a missing session mid-request;
// - proactive: the session reports ready && !authenticated while we still hold
//   cached identity (the UI would otherwise keep rendering "logged in").
// The flow runs once per expiry: toast, drop cached identity, route to /auth
// with returnTo. An active broadcast is never silently killed — the redirect
// asks the same leave-confirmation first and stays put if declined.
export function SessionGuard() {
  const { ready, authenticated, logout } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const broadcast = useBroadcastStatus();
  const handled = useRef(false);
  // The current logout, read through a ref so the expiry subscription below
  // does not re-arm on every render (logout is a fresh closure each time).
  // Assigned in an effect, not during render — refs may not be written while
  // rendering (react-hooks/refs), and after-render is when it must be fresh.
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  });

  // Mirror session state for the non-hook api client.
  useEffect(() => {
    setAuthSnapshot({ ready, authenticated });
  }, [ready, authenticated]);

  // A fresh login re-arms the guard for the next expiry.
  useEffect(() => {
    if (authenticated) handled.current = false;
  }, [authenticated]);

  useEffect(() => {
    if (DEMO_AUTH) return;

    const expire = (reason: SessionEndReason) => {
      if (handled.current) return;
      // Declining the live-broadcast prompt ABORTS this expiry: the guard must
      // stay armed so the next one still fires. Marking it handled up front
      // disarmed it permanently the first time a streamer said "no", and the
      // session then sat expired forever with no further prompt.
      if (broadcast.live && !window.confirm("You're live — leaving stops your broadcast.")) {
        return; // stay on the cockpit; the user chose to keep streaming
      }
      handled.current = true;
      // ACTUALLY END THE SESSION, don't just redirect. The dead token lives on
      // the auth kit (`currentAccessToken` reads it), so without this the client
      // keeps sending it and the /me polls 401 forever while the reader is stuck
      // "logged in but broken" (ogazboiz: "i cant logout"). Fire-and-forget and
      // swallow errors — a logout that throws must not keep the guard from
      // clearing the cache and routing to /auth.
      void Promise.resolve(logoutRef.current()).catch(() => {});
      // Wipe every credential the BFF accepts — the Decane bearer cookie AND the
      // legacy Privy cookies — so the redirect below lands on a real guest and
      // the next poll cannot re-authenticate the same dead account.
      clearDecaneSessionCookie();
      forgetLegacySession();
      queryClient.clear();
      // An account that has MOVED did not expire, and "sign in again" would
      // point at the sign-in that was just refused. Say which door.
      toast.error(
        reason === "upgraded"
          ? "Your account has been upgraded — sign in with your new account."
          : "Session expired — sign in again."
      );
      // Logical route: usePathname() answers /square/auth since the move.
      if (stripSquare(pathname) !== "/auth") {
        const params = new URLSearchParams({ returnTo: pathname });
        if (reason === "upgraded") params.set("upgraded", "1");
        router.push(sq(`/auth?${params.toString()}`));
      }
    };

    // Reactive: fired by apiFetch.
    const unsubscribe = onSessionExpired(expire);

    // Proactive: the session settled as logged-out while we still show a profile.
    if (ready && !authenticated && queryClient.getQueryData(["ms", "me"])) {
      expire("expired");
    }

    return unsubscribe;
  }, [ready, authenticated, pathname, router, queryClient, broadcast.live]);

  return null;
}

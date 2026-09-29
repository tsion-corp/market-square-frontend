"use client";

import { useEffect, useRef } from "react";
import { useSocialAuth } from "decane-connect-kit";
import { readHandoff } from "@/lib/square-handoff";

// Adopts the session Market handed over in the URL (lib/square-handoff). Runs
// once per page load, inside <DecaneKit>, and renders nothing.
//
// The token leaves the address bar first, whatever happens next: it is a
// bearer credential for up to two hours and must not survive a refresh, a
// copied link or the history. A session the kit already resumed on its own
// (same origin, same tab) is left alone; only a reader who arrived signed
// out is signed in with the token. A token the backend refuses — expired,
// revoked, another project's — is dropped quietly and the sign-in card does
// what it always does.
export function SquareHandoff() {
  const social = useSocialAuth() as ReturnType<typeof useSocialAuth> & {
    // decane-connect-kit 2.24.0; absent on an older build, in which case the
    // token is only stripped and the reader signs in as before.
    signInWithAccessToken?: (token: string) => Promise<void>;
  };
  const taken = useRef(false);

  useEffect(() => {
    if (taken.current) return;
    taken.current = true;
    const handoff = readHandoff(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );
    if (!handoff) return;
    window.history.replaceState(window.history.state, "", handoff.cleanUrl);
    if (social.isConnected || !social.signInWithAccessToken) return;
    void social.signInWithAccessToken(handoff.token).catch((error: unknown) => {
      console.warn(
        "[square] the session Market handed over could not be used:",
        error,
      );
    });
    // Once: the token is consumed on first mount, and a later re-render must
    // not re-read a URL it has already cleaned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

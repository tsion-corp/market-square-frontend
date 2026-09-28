// The session Market hands over when its Square button is tapped.
//
// Both apps are one Decane identity. On one origin and in one tab the kit
// resumes Market's live session by itself (decane-connect-kit 2.24.0 keys
// what it persists by the app, not the API key), and nothing here runs. For
// every other way in — a new tab, another origin in staging or dev, a lapsed
// session — Market puts its access token in the URL as `decane_token`
// (wsws-frontend/lib/square-zone.ts), and the Square adopts it: signed in at
// once, the wallet unlocked at its first use like any sign-in here.
//
// The token is a bearer credential for its remaining lifetime, so it leaves
// the address bar before anything else happens and is never written to a
// log. Pure, so the parsing is tested without a window.

export const SQUARE_HANDOFF_PARAM = "decane_token";

export interface Handoff {
  token: string;
  /** The same URL with the token removed, for history.replaceState. */
  cleanUrl: string;
}

/** The token in a URL's query, and the URL without it; null when there is none. */
export function readHandoff(url: string): Handoff | null {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return null;
  const path = beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(beforeHash.slice(queryAt + 1));
  const token = params.get(SQUARE_HANDOFF_PARAM);
  if (!token) return null;
  params.delete(SQUARE_HANDOFF_PARAM);
  const rest = params.toString();
  return { token, cleanUrl: `${path}${rest ? `?${rest}` : ""}${hash}` };
}

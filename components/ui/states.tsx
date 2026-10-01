"use client";

import { cn } from "@/lib/cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { errorCode, errorMessage } from "@/lib/api/envelope";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useCircuit } from "@/lib/api/circuit-store";
import { sq } from "@/lib/square-path";

/**
 * Designed empty state: a mark in a soft disc, a line of copy, an optional way
 * forward.
 *
 * An OUTLINE on the page, like the post card — transparent, one 10% hairline,
 * the card's 16.5 radius. It was `ws-inset`, a black/35 fill, which on the
 * `#121214` page read as a black slab dropped into the column ("even the empty
 * state too"). Depth comes from the border, never a darker or lighter fill.
 */
export function EmptyState({
  glyph = "◇",
  icon,
  title,
  body,
  action,
  className,
}: {
  glyph?: string;
  /** A real glyph from the icon set; wins over `glyph`. */
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-[16.5px] border border-white/10 bg-transparent px-6 py-12 text-center",
        className
      )}
    >
      <span
        className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04] text-[20px] text-grey-400 ring-1 ring-inset ring-white/10"
        aria-hidden
      >
        {icon ?? glyph}
      </span>
      <p className="ws-display text-[15px] text-grey-100">{title}</p>
      {body && <p className="max-w-sm text-[13px] leading-5 text-grey-500">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  fallback = "Something went wrong.",
  onRetry,
  className,
  quiet = false,
}: {
  error: unknown;
  fallback?: string;
  onRetry?: () => void;
  className?: string;
  /**
   * A calm inline line instead of the bordered box, for a list that is already
   * populated or a surface where a full panel would read as alarming. Same copy
   * and the same retry, in the meta grey rather than the fault red.
   */
  quiet?: boolean;
}) {
  // Being signed out is not an error. Retrying a 401 just repeats it, so every
  // error surface in the app turns into the sign-in invitation instead — one
  // change rather than thirty-three call sites, and no gated read can leave a
  // signed-out visitor at a dead end.
  if (isAuthError(error)) return <SignInPrompt className={className} />;
  if (quiet) {
    return (
      <div className={cn("flex flex-col items-center gap-2 py-8 text-center", className)}>
        <p className="text-[13px] text-meta">{errorMessage(error, fallback)}</p>
        {onRetry && <RetryButton onRetry={onRetry} />}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-[16.5px] border border-white/10 bg-transparent px-6 py-10 text-center", className)}>
      <p className="text-sm text-down">{errorMessage(error, fallback)}</p>
      {onRetry && <RetryButton onRetry={onRetry} />}
    </div>
  );
}

/**
 * "Try again", except while the app already knows the backend is down.
 *
 * Thirty-odd surfaces render this button. During the outage each of them was
 * an invitation to re-ask a question that had just been answered — and a
 * reader who taps five of them has personally multiplied the load by five, at
 * exactly the moment the service can least afford it. So while the circuit is
 * open the button states what is actually happening and does nothing, and the
 * connection banner — one of it, not thirty — owns forcing the retry.
 */
function RetryButton({ onRetry }: { onRetry: () => void }) {
  const circuit = useCircuit();
  const down = circuit.state !== "closed";
  return (
    <Button variant="secondary" size="sm" onClick={onRetry} disabled={down}>
      {down ? "Reconnecting…" : "Try again"}
    </Button>
  );
}

// Inline error next to the action that caused it — never a raw code.
export function InlineError({ error, fallback, className }: { error: unknown; fallback: string; className?: string }) {
  // Inline space is too tight for the full prompt, so this stays one line —
  // but it must read as an invitation rather than a fault.
  if (isAuthError(error)) {
    return <SignInInline className={className} />;
  }
  return <p className={cn("text-xs text-down", className)}>{errorMessage(error, fallback)}</p>;
}

/**
 * A rail module that could not load, said in one quiet line.
 *
 * These modules used to return `null` when their query failed, so during an
 * outage the page did not look broken — it looked EMPTY, which is worse: the
 * reader concludes there is nothing here rather than that we could not fetch
 * it. This keeps the module's name on screen and admits the gap.
 *
 * Deliberately without a retry button. The connection banner owns retrying for
 * the whole app; a button per module is how a frustrated reader turns an
 * outage into a stampede, and it is also five buttons that all do the same
 * thing.
 */
export function ModuleUnavailable({ title, className }: { title: string; className?: string }) {
  return (
    <section className={cn("ws-panel p-4", className)}>
      <h2 className="mb-1 text-[14px] font-bold leading-5 text-white">{title}</h2>
      <p className="text-[12px] leading-4 text-meta">
        Couldn&apos;t load this — it&apos;ll come back on its own.
      </p>
    </section>
  );
}

/** One-line sign-in invitation, for spaces too tight for SignInPrompt. */
export function SignInInline({ className }: { className?: string }) {
  const { login } = useAuth();
  return (
    <p className={cn("text-xs text-grey-400", className)}>
      <button onClick={login} className="font-bold text-accent underline-offset-2 hover:underline">
        Sign in
      </button>{" "}
      to continue.
    </p>
  );
}

/**
 * The one "sign in to continue" affordance.
 *
 * A signed-out visitor browsing public content must never be shown an ERROR
 * caused solely by not being logged in. Hitting a gated action — joining a
 * ticketed stream, asking to speak, chatting, liking, following, buying — is
 * an invitation to sign in, not a failure, and it has to leave them exactly
 * where they were.
 *
 * `login()` opens the app's OWN sign-in card in place (see
 * `lib/signin-store.ts`), so the reader keeps their scroll position and the
 * page they were on, and never sees the auth vendor named. The `/auth` link
 * beside it is the full-page route to the same card, carrying returnTo so that
 * path lands back here too.
 */
export function SignInPrompt({
  title = "Sign in to continue",
  body,
  className,
}: {
  title?: string;
  /** Say what signing in unlocks HERE — generic copy teaches nothing. */
  body?: string;
  className?: string;
}) {
  const { login } = useAuth();
  const pathname = usePathname();

  return (
    <div
      className={cn(
        // An outline like the empty state and the post card — a black/35
        // slab read as a hole in the column.
        "flex flex-col items-center gap-3 rounded-[16.5px] border border-white/10 bg-transparent px-6 py-8 text-center",
        className
      )}
    >
      <p className="ws-display text-base text-grey-200">{title}</p>
      {body && <p className="max-w-sm text-sm text-grey-500">{body}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={login}
          className="ws-btn-silver ws-press ws-btn-md rounded-full font-bold"
        >
          Sign in
        </button>
        <Link
          href={sq(`/auth?returnTo=${encodeURIComponent(pathname)}`)}
          className="ws-press rounded-full border border-white/20 px-4 py-2 text-[13px] font-bold text-body transition-colors hover:bg-white/10"
        >
          More options
        </Link>
      </div>
    </div>
  );
}

/** True when this failure is only "you are not signed in". */
export function isAuthError(error: unknown): boolean {
  const code = errorCode(error);
  return (
    code === "UNAUTHORIZED" ||
    code === "SESSION_EXPIRED" ||
    code === "ACCOUNT_UPGRADED" ||
    code === "AUTH_NOT_READY"
  );
}

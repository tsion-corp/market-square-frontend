"use client";

import { errorCode, errorMessage } from "@/lib/api/envelope";
import { formatDate, formatKash } from "@/lib/format";
import { asset } from "@/lib/square-path";
import { Pill, VerifiedBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMyVerification, useRenewVerification } from "@/features/profile/hooks/use-profile";

/**
 * The owner's verification card.
 *
 * Market Square GRANTS verification — nobody applies for it and nobody buys
 * in. Month one is free; after that a recurring KASH payment keeps the badge
 * current. Letting it lapse pauses the check without touching the grant, so
 * paying restores it instantly with no re-approval.
 *
 * Everything here is billing state, which exists only on `/me/verification`.
 * This card renders on the owner's own profile and nowhere else.
 */

/** Renewal errors belong beside the button that caused them, never as a code. */
function renewalError(error: unknown): string {
  if (errorCode(error) === "PAYMENT_FAILED") {
    return "Not enough KASH to renew — top up and try again.";
  }
  return errorMessage(error, "Couldn't renew right now — try again shortly.");
}

/** The renewal action plus whatever went wrong last time, inline beneath it. */
function RenewAction({
  label,
  canRenew,
  pending,
  error,
  onRenew,
}: {
  label: string;
  canRenew: boolean;
  pending: boolean;
  error: unknown;
  onRenew: () => void;
}) {
  return (
    <div className="space-y-2">
      <Button size="sm" loading={pending} disabled={!canRenew} onClick={onRenew}>
        {label}
      </Button>
      {Boolean(error) && <p className="text-xs text-down">{renewalError(error)}</p>}
      {!canRenew && !error && (
        <p className="text-xs text-grey-500">Renewal isn&apos;t available on this account yet.</p>
      )}
    </div>
  );
}

function Shell({ children, tone }: { children: React.ReactNode; tone?: "premium" }) {
  return (
    <div className={tone === "premium" ? "ws-premium space-y-3 p-5" : "ws-card space-y-3 p-5"}>
      {children}
    </div>
  );
}

/**
 * The default (ungranted) state — Figma node 2110:18776. A dark glass banner
 * whose entire artwork — the translucent card ground, the purple hex-glow, the
 * verified seal, the sparkles and corner haze — is ONE image rendered straight
 * from the design's own vector layers with the text stripped out
 * (public/verify/verification-card.png; the seal alone is also in public/verify
 * as a clean SVG). Baking the whole thing keeps the seal's size and position
 * pixel-identical to the file; every text line is live so the pricing stays
 * dynamic.
 *
 * The card is sized off ITS OWN width (`container-type: inline-size`, so `cqw` =
 * 1% of the card): the Figma frame is 535 wide, so 1cqw = 5.35px there, and the
 * same proportions hold at any width — capped at the design's 535 so a desktop
 * column renders it pixel-for-pixel, fluid below that on a phone. The artwork's
 * 535/156 aspect is locked to the card, so it never crops or distorts.
 */
function VerificationInfoCard({
  trialDays,
  price,
  periodDays,
}: {
  trialDays: number;
  price: string;
  periodDays: number;
}) {
  return (
    <div
      // Radius is FIXED 22px (the file's, and ws-card's own): cqw units on the
      // element that IS the container resolve against the viewport, not the
      // card, which is how the corners briefly rendered ~60px on desktop.
      className="relative aspect-535/156 w-full max-w-133.75 overflow-hidden rounded-[22px]"
      style={{ containerType: "inline-size" }}
    >
      {/* The whole Figma artwork (card ground + glow + seal + sparkles), text
          removed — same 535/156 aspect as the card, so it fills with no crop. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- static decorative asset, no host */}
      <img
        src={asset("/verify/verification-card.png")}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
      />

      {/* Heading — Geist Bold 24px @535. */}
      <p className="absolute left-[3.551cqw] top-[7.477cqw] -translate-y-1/2 whitespace-nowrap font-bold leading-none text-grey-100 text-[4.486cqw]">
        Verification
      </p>

      {/* Body — Geist Medium 10px @535, wraps at 331px. */}
      <p className="absolute left-[3.551cqw] top-[13.084cqw] w-[61.87cqw] -translate-y-1/2 font-medium leading-[2.43cqw] text-white text-[1.869cqw]">
        {`Verification is granted by Square — there's nothing to apply for. We look for accounts that show up consistently and are worth following.`}
      </p>

      {/* Footer — Geist Regular 8px @535, the live trial/price line. */}
      {trialDays > 0 && (
        <p className="absolute left-[3.551cqw] top-[21.869cqw] w-[50.09cqw] -translate-y-1/2 font-normal leading-[2.243cqw] text-[#999] text-[1.495cqw]">
          {`If you're granted it, the first ${trialDays} days are free — after that it's `}
          <span className="font-bold text-create">{price} </span>
          {`every ${periodDays} days to keep it.`}
        </p>
      )}
    </div>
  );
}

export function VerificationCard() {
  const mine = useMyVerification();
  const renew = useRenewVerification();

  if (mine.isPending) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (mine.isError) return null;

  const {
    status,
    verifiedSince,
    daysRemaining,
    priceKash,
    periodDays,
    trialDays,
    canRenew,
    latestRequest,
  } = mine.data;

  // A legacy request still in review keeps its old surface.
  const pending = status === "pending" || latestRequest?.status === "pending";
  const price = formatKash(priceKash);

  // ---- lapsed: paused, not punished. The grant is intact. ----
  if (status === "lapsed") {
    return (
      <Shell tone="premium">
        <div className="flex items-center gap-2">
          <h2 className="ws-display text-base">Your badge is paused</h2>
          <Pill tone="premium">Paused</Pill>
        </div>
        <p className="text-sm text-grey-400">
          Your verification is still yours — the check is just hidden while the subscription is
          unpaid. Restoring it is instant and needs no re-approval.
          {verifiedSince && ` Verified since ${formatDate(verifiedSince)}.`}
        </p>
        <RenewAction
          label={`Restore for ${price}`}
          canRenew={canRenew}
          pending={renew.isPending}
          error={renew.isError ? renew.error : null}
          onRenew={() => renew.mutate()}
        />
      </Shell>
    );
  }

  // ---- verified: show the check plus where the subscription stands. ----
  if (status === "verified") {
    const onTrial = Boolean(daysRemaining !== null && verifiedSince && trialDays > 0 && !mine.data.paidThrough);
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <VerifiedBadge verification="verified" />
          <h2 className="ws-display text-base">Verified</h2>
          <Pill tone="accent">Active</Pill>
        </div>
        {verifiedSince && (
          <p className="text-sm text-grey-400">Verified since {formatDate(verifiedSince)}.</p>
        )}

        <div className="ws-inset px-4 py-3">
          {daysRemaining === null ? (
            <p className="text-sm text-grey-400">
              Your badge is active. Renewal details appear here once the first period starts.
            </p>
          ) : onTrial ? (
            <p className="text-sm text-white">
              <span className="tnum font-semibold">{daysRemaining} days</span> left in your free
              month, then {price} every {periodDays} days.
            </p>
          ) : (
            <p className="text-sm text-white">
              Next payment in <span className="tnum font-semibold">{daysRemaining} days</span> —{" "}
              {price} every {periodDays} days.
            </p>
          )}
          <p className="mt-1 text-xs text-grey-500">
            Renewing early adds to your balance rather than resetting it.
          </p>
        </div>

        <RenewAction
          label={`Renew now · ${price}`}
          canRenew={canRenew}
          pending={renew.isPending}
          error={renew.isError ? renew.error : null}
          onRenew={() => renew.mutate()}
        />
      </Shell>
    );
  }

  // ---- pending: a legacy request still in review. ----
  if (pending) {
    return (
      <Shell>
        <div className="flex items-center gap-2">
          <h2 className="ws-display text-base">Verification</h2>
          <Pill>In review</Pill>
        </div>
        <p className="text-sm text-grey-400">
          Your request is in review. You&apos;ll see the badge here the moment it&apos;s approved.
        </p>
      </Shell>
    );
  }

  // ---- none: granted, never requested. The design's info banner. ----
  return <VerificationInfoCard trialDays={trialDays} price={price} periodDays={periodDays} />;
}

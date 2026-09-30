"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { errorCode } from "@/lib/api/envelope";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useAcceptInvite, useInvitePreview } from "@/features/messages/hooks/use-messages";
import { inviteState } from "@/features/messages/lib/invites";
import { ogImageUrl } from "@/lib/og-metadata";
import { asset, sq } from "@/lib/square-path";

/**
 * THE INVITATION CARD — nodes 2225:20359 (with a house picture) and
 * 2225:20405 (without one), rebuilt for PIXEL PARITY with the Figma frame.
 *
 * ─── A FIXED 380×279 FRAME, EVERY LAYER AT ITS OWN COORDINATE ────────────────
 * The card is the file's frame exactly: `aspect-[380/279]`, a 24px (6.316cqw)
 * radius, and every child ABSOLUTELY positioned at the percentage the node sits
 * at, rather than flowed. Flowing it (the previous attempt) let the height and
 * the text positions drift from the design; anchoring each layer is what makes
 * the card a faithful, scaled copy at any width. The coordinates, straight from
 * the file:
 *   · decoration (2246:5459)  fills the frame            → inset-0
 *   · banner    (…20360)      x −33.48, y 0, 452 × 108   → top, 118.94% at −8.81%
 *   · content   (2230:2821)   x 93, y 123, 201 × 126.73  → 24.474% / 44.086% / 52.895%
 *
 * ─── TYPE IS PURE `cqw`, SO THE CARD IS A SCALED REPLICA ─────────────────────
 * Every size is a percentage of the card's own width (`@container`): 380 units
 * = 100cqw, so 8px is 2.105cqw, 20px is 5.263cqw, and so on. No pixel floors —
 * the whole card scales together, which is what "pixel parity at every width"
 * means. A readable size is a matter of the card's `max-w`, not per-element
 * clamps that would break the proportion the file draws.
 *
 * ─── THE ARTWORK IS THE FILE'S OWN EXPORT, NOT A REBUILD ─────────────────────
 * Two illustrations, each hundreds of vectors, are exported and clipped by the
 * card rather than redrawn:
 *   · `invite-card-decoration.svg` (2246:5459) — the card's ramp + star field +
 *     the clouds along the foot, behind everything.
 *   · `invite-default-banner.svg` (2225:20406) — the coverless banner: the
 *     doodle-icon field, the sunburst and the 3D mark. (The earlier stub had
 *     four paths and dropped the doodles entirely; this is the real node.)
 * Both live in `gist-rooms/`, never `public/houses` (a guarded directory — a
 * sample photo was once shipped there as a default and a house wore a
 * stranger's face).
 *
 * ─── WHAT THE FILE DOES NOT DRAW, AND THIS PAGE MUST ─────────────────────────
 * The frame shows one state: a house you can join. Already a member, signed
 * out, expired, used up and refused are five more, in no frame, and each only
 * swaps the last row. An invitation that cannot say "this link has expired" is
 * a prettier dead end. The TITLE is never uppercased: a house whose NAME is
 * uppercase is its own choice, not a rule to shout every lowercase name with.
 */

/** 2225:20412 — the silver "Join House" pill, the file's ramp and both shadows. */
const PILL =
  "ws-press flex w-full items-center justify-center rounded-full h-[8.613cqw] " +
  "bg-[linear-gradient(162deg,#FFFFFF_0%,#EDEDF0_38%,#CBCBD1_63%,#F5F5F8_100%)] " +
  "text-[2.364cqw] font-semibold leading-[3.684cqw] text-[#0A0A0A] " +
  "shadow-[0_0.338cqw_1.351cqw_#9F65FD,inset_0_0.169cqw_0_rgba(255,255,255,0.95)] " +
  "transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60";

/** Eyebrow, description and the terminal lines share the file's 8px body ramp. */
const BODY = "text-[2.105cqw] font-medium leading-[2.632cqw]";

/** A terminal state is a statement, not an action, so it takes the body grey. */
const TERMINAL = `${BODY} text-[#D9D9D9]`;

export function JoinPage({ token }: { token: string }) {
  const { authenticated, login } = useAuth();
  const router = useRouter();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();

  if (preview.isPending) {
    return (
      <div className="px-4 py-10 md:px-8">
        {/* The card's own silhouette while it loads — the reader opened a link
            somebody sent them, so the first paint is already the right shape. */}
        <div className="mx-auto aspect-[380/279] w-full max-w-[600px] animate-pulse rounded-[24px] bg-white/[0.06]" />
      </div>
    );
  }

  if (preview.isError) {
    return (
      <div className="px-4 py-10 md:px-8">
        {errorCode(preview.error) === "NOT_FOUND" ? (
          <EmptyState
            className="mx-auto max-w-[420px]"
            title="This invite link doesn't work"
            body="It may have been turned off, or the house has changed. Ask for a new link."
          />
        ) : (
          <ErrorState
            className="mx-auto max-w-[420px]"
            error={preview.error}
            fallback="Couldn't open this invite."
            onRetry={() => void preview.refetch()}
          />
        )}
      </div>
    );
  }

  const house = preview.data;
  const state = inviteState(house, authenticated);
  const name = house.title ?? "A house on Square";

  return (
    <div className="px-4 py-10 md:px-8">
      <section
        className="@container relative mx-auto aspect-[380/279] w-full max-w-[600px] overflow-hidden rounded-[24px] text-center
                   bg-[linear-gradient(171deg,#9F65FD_0%,#7E3BEB_100%)]"
      >
        {/* 2246:5459 — the ramp, star field and foot clouds, the file's export,
            filling the frame behind everything. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- inlining 128KB of vector defs into every render */}
        <img
          src={asset("/gist-rooms/invite-card-decoration.svg")}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />

        {/* The banner box — the file's 108-tall strip across the top. */}
        <div className="absolute inset-x-0 top-0 aspect-[380/108] overflow-hidden">
          {house.imageUrl ? (
            /* A real photo FILLS the strip, it does not bleed: the design's
               452-wide overflow is for the illustrated banner, and on a
               photograph it only magnifies the crop — "too zoomed in"
               (ogazboiz, 2026-09-30). `object-cover` with no over-scale is the
               least-cropped fit for the strip. */
            /* Served at the strip's size via Cloudinary (`g_auto` crop), so it
               is sharp instead of a small source upscaled and blurred; falls
               back to the raw URL for anything not on our cloud. */
            /* eslint-disable-next-line @next/next/no-img-element -- media hosts are unknown at build time */
            <img
              src={ogImageUrl(house.imageUrl, "banner") ?? house.imageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            /* 2225:20406 — the coverless banner's own vector, doodles and all. */
            /* eslint-disable-next-line @next/next/no-img-element -- inlining 96KB of vector defs into every render */
            <img
              src={asset("/gist-rooms/invite-default-banner.svg")}
              alt=""
              aria-hidden
              className="h-full w-full object-cover"
            />
          )}
        </div>

        {/* 2230:2821 — the content column (201 wide → 52.895%), CENTERED in the
            area below the banner (banner is 108/279 = 38.71% tall). Centering,
            rather than pinning to the top or the bottom, keeps the block
            balanced whatever the title/description length: a short invite does
            not drop to the card's foot and a long one does not push the button
            onto the edge — the button always keeps space beneath it (ogazboiz,
            2026-09-30). Its four blocks are 10 (2.632cqw) apart. */}
        <div className="absolute inset-x-0 bottom-0 top-[38.71%] flex flex-col items-center justify-center px-[4.5%]">
          <div className="flex w-[52.895%] flex-col items-center gap-[2.632cqw]">
          <div className="flex flex-col items-center">
            <p className={`${BODY} text-[#D9D9D9]`}>You&rsquo;re Invited to Join</p>
            {/* 2229:2810's NEGATIVE 2 itemSpacing: the title sits up against its
                eyebrow so the two read as one block. `gap` cannot go negative. */}
            <h1 className="mt-[-0.526cqw] text-[5.263cqw] font-bold leading-[6.842cqw] text-white">
              {name}
            </h1>
          </div>

          {house.description && (
            /* 185 of the 201 column, so it wraps a line before the card does. */
            <p className={`${BODY} line-clamp-2 w-[48.684cqw] text-[#D9D9D9]`}>{house.description}</p>
          )}

          {/* The file's separator is a BULLET. */}
          <p className={`${BODY} text-white`}>
            {house.memberCount !== null &&
              `${house.memberCount} ${house.memberCount === 1 ? "member" : "members"} • `}
            {house.visibility === "private" ? "Private house" : "Public house"}
          </p>

          <div className="w-full">
            {state === "member" && (
              <Link href={sq(`/messages?c=${house.id}`)} className={PILL}>
                Open Chat
              </Link>
            )}
            {state === "join" && (
              <button
                type="button"
                disabled={accept.isPending}
                onClick={() =>
                  accept.mutate(token, {
                    onSuccess: (joined) => router.push(sq(`/messages?c=${joined.id}`)),
                  })
                }
                className={PILL}
              >
                {accept.isPending ? "Joining…" : "Join House"}
              </button>
            )}
            {state === "sign-in" && (
              <button type="button" onClick={login} className={PILL}>
                Sign in to Join
              </button>
            )}
            {state === "expired" && (
              <p className={TERMINAL}>This link has expired. Ask for a new one.</p>
            )}
            {state === "used_up" && (
              <p className={TERMINAL}>This link has been used up. Ask for a new one.</p>
            )}
            {state === "refused" && (
              <p className={TERMINAL}>You can&apos;t join this house with this link.</p>
            )}
          </div>
          </div>
        </div>
      </section>
    </div>
  );
}

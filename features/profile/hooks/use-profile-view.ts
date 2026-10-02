"use client";

import { useEffect, useRef } from "react";
import { recordProfileView } from "@/features/profile/lib/api";

/**
 * HOW LONG SOMEBODY HAS TO STAY BEFORE IT COUNTS AS A VISIT.
 *
 * The service's own instruction is "send on DWELL, not on page load", and it
 * does not name a number, so this one is ours. Three seconds is long enough that
 * a mistyped handle, a back-button bounce or a tap meant for the next row does
 * not put somebody's name in a stranger's list, and short enough that anybody
 * actually reading a profile is counted.
 *
 * Appearing in "who viewed my profile" is a claim about a person's attention.
 * It should be true, and the cost of being wrong falls on the viewer, who never
 * finds out they were recorded.
 */
const DWELL_MS = 3000;

/**
 * Record a profile visit once the reader has actually stayed.
 *
 * ─── THE WRITER THAT WAS NEVER CALLED ───────────────────────────────────────
 * `POST /profiles/:id/views` has been live and called by nothing, so the table
 * is empty and `profileViewCount` reads zero for everybody. The read side alone
 * would have shipped a feature that is permanently empty and indistinguishable
 * from a broken one.
 *
 * ─── IT IS SILENT IN EVERY DIRECTION ────────────────────────────────────────
 * The service answers 204 whether it recorded anything or not — your own
 * profile, a viewer in private browsing, and either party having blocked the
 * other all look identical on purpose, so that a caller cannot detect a block or
 * somebody else's privacy setting. There is therefore nothing to branch on, and
 * a failure is swallowed: a measurement is never the reason something breaks.
 *
 * Fired ONCE per profile per mount. The ref is keyed on the id, so paging from
 * one profile to another inside the same component records the second one too,
 * while a re-render of the same profile does not.
 */
export function useRecordProfileView(profileId: string | undefined, ready: boolean) {
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !profileId || recorded.current === profileId) return;
    const timer = setTimeout(() => {
      recorded.current = profileId;
      void recordProfileView(profileId).catch(() => {
        /* See the header: never the reader's problem. */
      });
    }, DWELL_MS);
    // Leaving before the dwell is up is exactly the case this exists to ignore.
    return () => clearTimeout(timer);
  }, [profileId, ready]);
}

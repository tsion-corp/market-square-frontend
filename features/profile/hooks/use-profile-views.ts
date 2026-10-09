"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { errorCode } from "@/lib/api/envelope";
import { fetchProfileViews } from "@/features/profile/lib/api";

/**
 * WHO VIEWED MY PROFILE.
 *
 * ─── THREE OUTCOMES, AND ONLY ONE OF THEM IS AN ERROR ───────────────────────
 * This surface has a refusal that is not a fault, and flattening the three into
 * "loading / data / something went wrong" is what would make the feature read as
 * broken:
 *
 *   · `private`      the caller is browsing privately, so the service refuses
 *                    with 403. That is the reciprocal bargain working exactly as
 *                    designed — it has its own screen and its own way back, and
 *                    it must never be retried or shown as a failure.
 *   · `unavailable`  the route is not deployed in this environment (404). The
 *                    surface goes quiet rather than claiming nobody looked.
 *   · an error       anything else, which is retryable.
 *
 * ─── NEITHER REFUSAL IS RETRIED ─────────────────────────────────────────────
 * A 403 here cannot become a 200 by asking again — only the reader turning
 * private browsing off changes it — and a 404 is a fact about the deployment.
 * Retrying either spends requests to be told the same thing, and on the 403 it
 * would also keep a spinner on a screen that has a real answer to show.
 */
export function useProfileViews(enabled: boolean) {
  const query = useInfiniteQuery({
    queryKey: ["ms", "profile-views"],
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchProfileViews(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    retry: (_count, error) => {
      const code = errorCode(error);
      return code !== "FORBIDDEN" && code !== "NOT_FOUND";
    },
  });

  const code = query.isError ? errorCode(query.error) : null;
  /*
    `total` is read off the FIRST page, not from the rows.

    Every page carries it and it counts PEOPLE in the window, while the loaded
    rows are only as many as have been paged in. Counting what is on screen would
    make the heading shrink the moment somebody opened the list and grow as they
    scrolled, which is the behaviour the "never derive a count from a loaded
    page" rule exists to prevent.
  */
  return {
    entries: query.data?.pages.flatMap((page) => page.items) ?? [],
    total: query.data?.pages[0]?.total ?? null,
    isPending: query.isPending && enabled,
    /** The caller browses privately, so there is nothing to show them. */
    isPrivate: code === "FORBIDDEN",
    /** The route is not deployed here. */
    unavailable: code === "NOT_FOUND",
    /** A real failure, worth a retry control. */
    isError: query.isError && code !== "FORBIDDEN" && code !== "NOT_FOUND",
    refetch: query.refetch,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
}

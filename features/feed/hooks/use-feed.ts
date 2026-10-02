"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { errorCode, errorMessage } from "@/lib/api/envelope";
import { trackMarketEvent } from "@/lib/analytics";
import { isVideoPost } from "@/lib/media";
import { videoListKey } from "@/lib/video-context";
import {
  bookmarkPost,
  fetchBookmarks,
  createPost,
  fetchFeed,
  fetchPost,
  fetchStories,
  likePost,
  repostPost,
  uploadPostMedia,
  reportTarget,
  deletePost,
  editPost,
  pinPost,
} from "@/features/feed/lib/api";
import type { FeedPage, Lane, Post } from "@/features/feed/lib/types";
import { laneTopic } from "@/lib/ws-gateway";
import { useGatewayConnected } from "@/hooks/use-gateway-connected";
import { invalidateContentSurfaces } from "@/lib/api/invalidate";
import { clearPinnedEverywhere, invalidatePostLists, isInfiniteFeed, patchPostEverywhere, reconcilePost } from "@/features/feed/lib/cache";

/**
 * The timeline.
 *
 * `topics` narrows the lane to the shared vocabulary's keys — what the Home
 * design's tab row selects (node 225:3352: For you · Tech · Entertainment ·
 * Crypto & Web3 · …). `GET /feed?topics=` is a real parameter on the contract,
 * so the row filters SERVER-SIDE; the alternative — filtering one loaded page
 * in the client — is the thing this repo bans, because a page of thirty
 * mixed items yields almost nothing for a narrow topic.
 *
 * The topics are IN THE QUERY KEY, so each tab caches and pages independently.
 * Sharing one key would replay the previous tab's posts under the new tab's
 * name until the refetch landed, and page with a cursor minted for a different
 * filter.
 */
export function useFeed(lane: Lane, topics: readonly string[] = [], enabled = true) {
  const key = topics.join(",");
  return useInfiniteQuery({
    queryKey: ["ms", "feed", lane, key],
    queryFn: ({ pageParam }) => fetchFeed(lane, pageParam ?? undefined, [...topics]),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // The `following` lane is the reader's own edge, so `/pals` holds it back
    // until there is a reader: signed out it would be a 401 nobody sees.
    enabled,
  });
}

/**
 * THE HEAD CHECK — what X does every few seconds: ask for the top of the lane
 * again and see whether anything new sits above what the reader has.
 *
 * A separate, small query rather than a refetch interval on the timeline:
 * an infinite query refetches EVERY loaded page on each tick, so a reader
 * five pages deep would cost five requests every half minute to learn about
 * one new post. This asks for ten items, once every 30 seconds, only while
 * the tab is visible (`refetchIntervalInBackground: false`) and only once the
 * timeline itself has loaded. Its items are merged in front of the loaded
 * list by id (see the feed page), and the "N new posts" hold does the rest.
 *
 * Thirty seconds is the cadence the unread badge already polls at, so the
 * app makes no new promise about freshness it does not keep elsewhere.
 */
export const FEED_HEAD_INTERVAL_MS = 30_000;

/**
 * The cadence once the socket is carrying this lane: a FLOOR, not freshness.
 *
 * `useLaneSignal` already invalidates this exact query the moment the service
 * says the head moved, so while a socket is up this timer is not what makes the
 * feed fresh — it is what catches a frame that never arrived. The gateway's
 * replay buffer is bounded (a window of recent frames per topic, not forever),
 * so a socket down longer than that window can miss one permanently, and a
 * feed with no timer at all would then never recover.
 *
 * Five minutes against thirty seconds is a tenth of the requests for a worst
 * case of five minutes' staleness in the one situation where a push was lost.
 */
export const FEED_HEAD_IDLE_MS = 300_000;

export function useFeedHead(lane: Lane, topics: readonly string[] = [], enabled = true) {
  const key = topics.join(",");
  const connected = useGatewayConnected();
  /*
    SLOWED, NEVER STOPPED, and only for a lane something actually publishes.

    This timer was unconditional, so every open tab asked "anything new?" every
    thirty seconds whether or not the push had already told it — the most
    expensive read in the service, answered "no" almost every time.

    Two conditions, and dropping either one is a bug rather than a saving:

      - CONNECTED, not "a gateway is configured". A reader whose socket died
        gets nothing pushed, so they need the fast cadence back. Gating on
        configuration would freeze the feed for exactly the people already
        having the worst day.
      - A lane with a TOPIC. `laneTopic` is null for `following` (it is
        per-reader) and `platform` (not broadcast), so nothing will ever push
        them. Slowing those down would buy nothing and cost freshness.
  */
  const pushed = connected && laneTopic(lane) !== null;
  return useQuery({
    queryKey: ["ms", "feed", lane, key, "head"],
    queryFn: () => fetchFeed(lane, undefined, [...topics], undefined, 10),
    enabled,
    refetchInterval: pushed ? FEED_HEAD_IDLE_MS : FEED_HEAD_INTERVAL_MS,
    refetchIntervalInBackground: false,
    // The check is the freshness; nothing else should read this as current.
    staleTime: 0,
  });
}

/**
 * One discussion.
 *
 * The tag is part of the query key, or two discussions share a cache and
 * whichever opened first serves the other.
 */
export function useDiscussion(tag: string) {
  return useInfiniteQuery({
    queryKey: ["ms", "feed", "hashtag", tag],
    queryFn: ({ pageParam }) =>
      fetchFeed("for-you", pageParam ?? undefined, [], tag),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: tag.length > 0,
  });
}

/**
 * The Explore grid's media list — and the immersive viewer's scroll list.
 *
 * ONE query serves both: the grid renders the loaded pages as cards and the
 * viewer renders the video subset of the very same pages as slides, so opening
 * a video continues the grid's pagination rather than starting a second one.
 * That is why the key is derived from `videoListKey` and not from anything
 * view-specific.
 *
 * LANE: `for-you`, not `reels`. Explore's resting grid must show what we have
 * — pictures AND video — before the reader has chosen anything, and `reels` is
 * video-only. There is no media lane and no `mediaKind` filter on `/feed`
 * (the lane enum is fixed: for-you, following, live, platform, trending,
 * reels), so the media are selected from the general lane HERE. That is a
 * deliberate exception to "never filter a lane client-side", which exists to
 * stop a lane TAB being faked: this is not a lane, it is a grid composed from
 * one. The cost is real and handled by the caller — a page of 30 mixed items
 * can yield very few media, so the screen keeps paging until the grid is worth
 * showing. See the report: `?mediaKind=image,video` on /feed would make this
 * exact rather than approximate.
 *
 * LIVE streams are deliberately not here: a live card goes to the live room,
 * which is a different surface with chat, tickets and a stage.
 */
export function useMediaFeed(topics: string[], enabled = true) {
  const key = videoListKey(topics);
  return useInfiniteQuery({
    queryKey: ["ms", "feed", "media", key],
    queryFn: ({ pageParam }) => fetchFeed("for-you", pageParam ?? undefined, topics),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/**
 * The posts carrying media inside feed pages, in order.
 *
 * `isVideoPost` reads the backend's `mediaKind` first and only sniffs the URL
 * as a fallback — never the extension alone. An image is anything with a
 * `mediaUrl` that is not a video.
 */
export function mediaPostsOf(pages: FeedPage[] | undefined): Post[] {
  return (pages ?? []).flatMap((page) =>
    page.items.flatMap((item) => (item.post?.mediaUrl ? [item.post] : []))
  );
}

/** Just the clips — the immersive viewer scrolls through these only. */
export function videoPostsOf(pages: FeedPage[] | undefined): Post[] {
  return mediaPostsOf(pages).filter((post) => isVideoPost(post));
}

/**
 * Explore's Posts tab — the general lane, populated on arrival.
 *
 * Same principle as the media grid: a discovery tab that opens empty and asks
 * you to search first is not a discovery tab. Only the POST items are shown —
 * the lane also carries streams, activities and platform events, which have
 * their own tabs and surfaces.
 *
 * `/feed` takes no `q`, so a query on this tab falls through to `/search`
 * rather than narrowing this list. See the report: `q` on `/feed` would let
 * browse and search share one list and one cursor, as People does.
 */
export function useBrowsePosts(topics: string[], enabled = true) {
  const key = videoListKey(topics);
  return useInfiniteQuery({
    queryKey: ["ms", "feed", "browse-posts", key],
    queryFn: ({ pageParam }) => fetchFeed("for-you", pageParam ?? undefined, topics),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** The posts inside feed pages, in order — text and media alike. */
export function postsOf(pages: FeedPage[] | undefined): Post[] {
  return (pages ?? []).flatMap((page) =>
    page.items.flatMap((item) => (item.post ? [item.post] : []))
  );
}

/** One post by id, for the permalink at /p/[id]. */
export function usePost(postId: string) {
  return useQuery({
    queryKey: ["ms", "post", postId],
    queryFn: () => fetchPost(postId),
    enabled: postId.length > 0,
  });
}

export function useStories() {
  return useQuery({
    queryKey: ["ms", "stories"],
    queryFn: fetchStories,
    staleTime: 60_000,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createPost>[0]) => createPost(input),
    onSuccess: (post) => {
      /*
        POSTING IS THE PRODUCT, and it was measured nowhere — the event name
        existed in the vocabulary and no call site ever used it, so "what do
        people do here" could only ever have answered with streams and the
        store. Fired on SUCCESS, so a draft that failed to publish is not
        counted as a post.
      */
      trackMarketEvent("post_created", {
        surface: "feed",
        entityType: "post",
        entityId: post.id,
        metadata: {
          kind: post.kind,
          hasMedia: Boolean(post.mediaUrl || post.media?.length),
        },
      });
      // Two halves, and both are needed. The prepend puts the post on screen
      // instantly; the invalidation below reconciles it with the server, which
      // may reshape it (hydrated author, resolved deep link, moderation).
      // Relying on either one alone is what left readers reaching for reload.
      if (post.kind === "update") {
        queryClient.setQueriesData<InfiniteData<FeedPage>>(
          { queryKey: ["ms", "feed"] },
          (data) => {
            /*
              A SHAPE CHECK, NOT A NULL CHECK — see the note in cache.ts.

              `["ms","feed"]` also matches `useFeedHead`'s
              `["ms","feed",lane,key,"head"]`, whose value is a bare FeedPage
              with no `pages`. `if (!data)` passes it straight through to
              `data.pages[0]`, which threw "Cannot read properties of undefined
              (reading '0')" INSIDE onSuccess — so the post WAS created, the
              mutation then reported failure, and the composer stayed open
              inviting the reader to post it again.
            */
            if (!isInfiniteFeed(data)) return data;
            const first = data.pages[0];
            if (!first) return data;
            // Already reconciled by a refetch that beat us here.
            if (first.items.some((item) => item.post?.id === post.id)) return data;
            const item = {
              id: `local_${post.id}`,
              type: "post" as const,
              occurredAt: post.createdAt,
              repostedBy: null,
              deepLink: post.deepLink,
              post,
              stream: null,
              activity: null,
              platformEvent: null,
            };
            return {
              ...data,
              pages: [{ ...first, items: [item, ...first.items] }, ...data.pages.slice(1)],
            };
          }
        );
        // The author's own Posts tab renders from its own cache and used to
        // keep the pre-post list until it was remounted.
        queryClient.setQueriesData<{ items: Post[]; nextCursor?: string | null }>(
          { queryKey: ["ms", "profile-posts"] },
          (data) =>
            data && !data.items.some((item) => item.id === post.id)
              ? { ...data, items: [post, ...data.items] }
              : data
        );
      }
      // Freshly published, so it can be read back on its permalink at once.
      queryClient.setQueryData<Post>(["ms", "post", post.id], post);
      toast.success(post.kind === "story" ? "Story posted" : "Posted to the square");
    },
    // onSettled, not onSuccess: a request that errored may still have landed
    // server-side, so the lists reconcile either way.
    onSettled: (post, _error, input) => {
      invalidatePostLists(queryClient);
      if (input.kind === "story" || post?.kind === "story") {
        void queryClient.invalidateQueries({ queryKey: ["ms", "stories"] });
      }
      // A quote is a new post pointing at an existing one; refresh the
      // original so any server-side counter it keeps comes back current.
      if (input.quotedPostId) reconcilePost(queryClient, input.quotedPostId);
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't post right now.")),
  });
}

export function useRepostPost() {
  const queryClient = useQueryClient();
  // Every cache the post lives in, not just the timeline: the same card is
  // rendered on a profile tab, in Arkmarks and on its permalink.
  const patchCaches = (postId: string, reposted: boolean) =>
    patchPostEverywhere(queryClient, postId, (post) => ({
      ...post,
      repostedByMe: reposted,
      repostCount: Math.max(0, post.repostCount + (reposted ? 1 : -1)),
    }));
  return useMutation({
    mutationFn: ({ postId, repost }: { postId: string; repost: boolean }) => repostPost(postId, repost),
    onMutate: ({ postId, repost }) => patchCaches(postId, repost),
    onError: (error, { postId, repost }) => {
      patchCaches(postId, !repost);
      toast.error(errorMessage(error, "Couldn't update the repost."));
    },
    onSuccess: (result) => {
      // A repost inserts a NEW attributed row into followers' timelines, so
      // the lists genuinely have to refetch rather than just go stale.
      invalidatePostLists(queryClient);
      toast.success(result.reposted ? "Reposted to your followers" : "Repost removed");
    },
    onSettled: (_result, _error, { postId }) => reconcilePost(queryClient, postId),
  });
}

export function useUploadPostMedia() {
  return useMutation({
    mutationFn: uploadPostMedia,
    onError: (error) => toast.error(errorMessage(error, "Couldn't upload that file.")),
  });
}

// Shared with the chat composer; lives in `hooks/use-mention-search.ts`.
export { useMentionSearch } from "@/hooks/use-mention-search";

/**
 * Optimistic like.
 *
 * The flip lands in every cache the post appears in — timeline, Arkmarks, the
 * author's profile tab, the permalink — so navigating between surfaces after
 * a tap shows one consistent state instead of whichever version that surface
 * happened to have cached. `reconcilePost` then lines the count back up with
 * the server without refetching the world on every tap.
 */
export function useLikePost() {
  const queryClient = useQueryClient();

  const applyLike = (postId: string, liked: boolean) =>
    patchPostEverywhere(queryClient, postId, (post) => ({
      ...post,
      likedByMe: liked,
      likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
    }));

  return useMutation({
    mutationFn: ({ postId, like }: { postId: string; like: boolean }) => likePost(postId, like),
    onMutate: async ({ postId, like }) => {
      applyLike(postId, like);
    },
    /*
      ONLY THE LIKE, NEVER THE UNLIKE — an undo is not an engagement, and
      counting both would make a post somebody double-tapped and took back look
      busier than one they meant. Fired on success rather than optimistically:
      the tally moves instantly for the reader either way, but a like the
      service refused is not a like.
    */
    onSuccess: (_result, { postId, like }) => {
      if (like) {
        trackMarketEvent("post_liked", {
          surface: "feed",
          entityType: "post",
          entityId: postId,
        });
      }
    },
    onError: (error, { postId, like }) => {
      applyLike(postId, !like);
      toast.error(errorMessage(error, "Couldn't update your like."));
    },
    onSettled: (_result, _error, { postId }) => reconcilePost(queryClient, postId),
  });
}

/**
 * Arkmarks.
 *
 * The bookmark endpoints ship on their own cadence. Until they land the API
 * answers 404, and a 404 here is "not deployed", not "your save failed" — so
 * the mutation rolls the optimistic flag back and reports the feature as
 * unavailable instead of raising an error toast. `unavailable` is what the
 * button reads to go quiet; it never invents a saved state.
 */
/**
 * PIN ONE OF YOUR OWN POSTS to the top of your profile.
 *
 * Pinning REPLACES, so the optimistic patch clears the flag from whatever was
 * pinned before — otherwise two cards would wear the "Pinned" label until the
 * next refetch, which is a state the product never has.
 *
 * A 404 is "not deployed" here as everywhere (the routes ship on backend PR
 * #206), so the menu entry goes quiet rather than raising an error. It is ALSO
 * the answer for somebody else's post, which the menu already prevents by only
 * offering this on your own.
 */
export function usePinPost() {
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);

  const applyPin = (postId: string, pinned: boolean) => {
    // One pin per profile: clear every other card's flag as this one takes it.
    if (pinned) clearPinnedEverywhere(queryClient);
    patchPostEverywhere(queryClient, postId, (post) => ({ ...post, pinnedByAuthor: pinned }));
  };

  const mutation = useMutation({
    mutationFn: ({ postId, pin }: { postId: string; pin: boolean }) => pinPost(postId, pin),
    onMutate: ({ postId, pin }) => applyPin(postId, pin),
    onError: (error, { postId, pin }) => {
      applyPin(postId, !pin);
      if (errorCode(error) === "NOT_FOUND") {
        setUnavailable(true);
        return;
      }
      toast.error(errorMessage(error, "Couldn't change your pinned post."));
    },
    onSuccess: (_result, { pin }) => {
      // The profile carries the pinned post itself, so it refetches for real.
      queryClient.invalidateQueries({ queryKey: ["ms", "profile"] });
      toast.success(pin ? "Pinned to your profile" : "Unpinned");
    },
    onSettled: (_result, _error, { postId }) => reconcilePost(queryClient, postId),
  });

  return { ...mutation, unavailable };
}

export function useBookmarkPost() {
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);

  // The count moves with the flag — optimistically, and only when the
  // payload carries one, so a post without a count never gains a fabricated
  // "1". `reconcilePost` on settle replaces both with the service's truth.
  const applyBookmark = (postId: string, bookmarked: boolean) =>
    patchPostEverywhere(queryClient, postId, (post) => ({
      ...post,
      bookmarkedByMe: bookmarked,
      ...(post.bookmarkCount !== undefined && post.bookmarkedByMe !== bookmarked
        ? { bookmarkCount: Math.max(0, post.bookmarkCount + (bookmarked ? 1 : -1)) }
        : {}),
    }));

  const mutation = useMutation({
    mutationFn: ({ postId, bookmark }: { postId: string; bookmark: boolean }) =>
      bookmarkPost(postId, bookmark),
    onMutate: ({ postId, bookmark }) => applyBookmark(postId, bookmark),
    onError: (error, { postId, bookmark }) => {
      applyBookmark(postId, !bookmark);
      if (errorCode(error) === "NOT_FOUND") {
        setUnavailable(true);
        return;
      }
      toast.error(errorMessage(error, "Couldn't update your Arkmark."));
    },
    onSuccess: (_result, { bookmark }) => {
      // The Arkmarks list gains or loses a row, so it refetches for real.
      queryClient.invalidateQueries({ queryKey: ["ms", "bookmarks"] });
      toast.success(bookmark ? "Saved to Arkmarks" : "Removed from Arkmarks");
    },
    onSettled: (_result, _error, { postId }) => reconcilePost(queryClient, postId),
  });

  return { ...mutation, unavailable };
}

export function useBookmarks() {
  return useInfiniteQuery({
    queryKey: ["ms", "bookmarks"],
    queryFn: ({ pageParam }) => fetchBookmarks(pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // A missing endpoint is a deployment gap, not a transient fault — retrying
    // it just delays the quiet unavailable state.
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
}

/**
 * The comment thread moved to `use-comments.ts` when it grew replies and
 * likes; re-exported here so the card and the sheet keep their import.
 */
export { useAddComment, useComments } from "@/features/feed/hooks/use-comments";

export function useReport() {
  return useMutation({
    mutationFn: reportTarget,
    onSuccess: () => toast.success("Report received — thank you."),
    onError: (error) => toast.error(errorMessage(error, "Couldn't send the report.")),
  });
}

/**
 * Edit a post's text — `PATCH /posts/:id`.
 *
 * The answer is the WHOLE updated post, so it is written into every cache that
 * draws this post rather than only invalidated: a reader who edits a typo
 * should see the fix on the card they are looking at, not two seconds later.
 * `editedAt` comes back stamped, which is what turns the "edited" marker on.
 */
export function useEditPost(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => editPost(postId, { text }),
    onSuccess: (updated) => {
      patchPostEverywhere(queryClient, postId, () => updated as Post);
      toast.success("Post updated");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't save that edit.")),
    onSettled: () => reconcilePost(queryClient, postId),
  });
}

/**
 * Delete a post or story — `DELETE /posts/:id`.
 *
 * Every list that could carry it is invalidated rather than patched: a deleted
 * post has no shape to write back, and the timeline, the profile grid, the
 * stories rail and the bookmarks can each hold a copy.
 */
export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      invalidateContentSurfaces(queryClient);
      invalidatePostLists(queryClient);
      toast.success("Post deleted");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't delete that post.")),
  });
}

"use client";

import { trackMarketEvent } from "@/lib/analytics";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { errorCode, errorMessage } from "@/lib/api/envelope";
import { applyCommentLike, patchCommentIn } from "@/lib/comment-thread";
import {
  addComment,
  deleteComment,
  fetchComment,
  fetchComments,
  fetchReplies,
  likeComment,
} from "@/features/feed/lib/api";
import type { Comment, Mention } from "@/features/feed/lib/types";
import { patchPostEverywhere, reconcilePost } from "@/features/feed/lib/cache";

/**
 * A post's comment thread, the TikTok shape.
 *
 * ─── KEYS ───────────────────────────────────────────────────────────────────
 *   ["ms", "post", postId, "comments"]      the top-level page(s)
 *   ["ms", "comment", commentId, "replies"] one thread's replies
 *
 * The comments key sits UNDER the post's own key on purpose: `reconcilePost`
 * invalidates `["ms", "post", postId]` and the prefix match takes the thread
 * with it, so a like on the post and a reply to it settle through one path.
 *
 * ─── THE CONTRACT, LIVE ON :8080 2026-09-09 ─────────────────────────────────
 * `GET|POST /posts/:id/comments` (top-level only, newest first; `parentId` on
 * create), `GET /comments/:id`, `GET /comments/:id/replies` (oldest first),
 * `POST|DELETE /comments/:id/like` (idempotent), `DELETE /comments/:id`
 * (author or post author). The 404-quiet `unavailable` states stay because a
 * deployment that lags this one is a real state, not a hypothetical.
 *
 * A reply is posted with the TAPPED comment's id as `parentId`; the service
 * files it under the top-level parent and records who was answered. So the
 * mutation carries both the tapped id (what is sent) and the thread id (what
 * the client expects to change) — see `threadOf`.
 */
type CommentsPage = { items: Comment[]; nextCursor: string | null };

export const commentsKey = (postId: string) => ["ms", "post", postId, "comments"] as const;
export const commentKey = (commentId: string) => ["ms", "comment", commentId] as const;
export const repliesKey = (commentId: string) =>
  ["ms", "comment", commentId, "replies"] as const;

/** Apply `patch` to one comment wherever a thread page holds it. */
function patchCommentEverywhere(
  client: QueryClient,
  commentId: string,
  patch: (comment: Comment) => Comment
) {
  for (const prefix of [["ms", "post"], ["ms", "comment"]] as const) {
    client.setQueriesData<InfiniteData<CommentsPage>>({ queryKey: prefix }, (data) => {
      if (!data?.pages) return data;
      let touched = false;
      const pages = data.pages.map((page) => {
        const items = patchCommentIn(page.items, commentId, patch);
        if (items === page.items) return page;
        touched = true;
        return { ...page, items: items as Comment[] };
      });
      return touched ? { ...data, pages } : data;
    });
  }
}

export function useComments(postId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: commentsKey(postId),
    queryFn: ({ pageParam }) => fetchComments(postId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });
}

/** Every top-level comment loaded so far, in the server's order. */
export function commentsOf(data: InfiniteData<CommentsPage> | undefined): Comment[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/**
 * One thread's replies. `enabled` is the expander: nothing is fetched until
 * the reader opens the thread, so a page of thirty comments costs one request
 * rather than thirty-one.
 */
export function useReplies(commentId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: repliesKey(commentId),
    queryFn: ({ pageParam }) => fetchReplies(commentId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    // A missing route is a deployment gap, not a transient fault.
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
}

/**
 * One comment by id — the permalink opened ON a comment (`?comment=`) reads
 * this to learn which thread to expand before it can scroll.
 */
export function useComment(commentId: string | null, enabled = true) {
  return useQuery({
    queryKey: commentKey(commentId ?? ""),
    queryFn: () => fetchComment(commentId ?? ""),
    enabled: enabled && Boolean(commentId),
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
}

export interface AddCommentInput {
  text: string;
  /** The comment the reader tapped Reply on — sent as is; the server files it. */
  parentId?: string | null;
  /** The top-level thread it lands in — see `threadOf`. Bumped and refetched. */
  threadId?: string | null;
  /** Picked from the @-list; the service resolves typed handles as well. */
  mentions?: Mention[];
}

/**
 * Post a comment or a reply. Accepts a bare string for the existing callers
 * (the card's inline field, the sheet) that only ever post top-level.
 */
export function useAddComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | AddCommentInput) => {
      const { text, parentId, mentions } = typeof input === "string" ? { text: input } : input;
      return addComment(postId, text, parentId, mentions);
    },
    /*
      Replying is the other half of posting and was measured nowhere. A REPLY to
      a reply is marked as such, because "people are talking to each other" and
      "people are talking at a post" are different findings and the tally cannot
      tell them apart afterwards.
    */
    onSuccess: (_comment, input) => {
      trackMarketEvent("comment_created", {
        surface: "post_detail",
        entityType: "post",
        entityId: postId,
        metadata: { isReply: typeof input !== "string" && Boolean(input.parentId) },
      });
    },
    // The reply is visible at once and the tally moves with it, on every
    // surface that draws this post rather than only the one being looked at.
    onMutate: (input) => {
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        commentCount: post.commentCount + 1,
      }));
      const threadId = typeof input === "string" ? null : input.threadId;
      if (threadId) {
        patchCommentEverywhere(queryClient, threadId, (comment) => ({
          ...comment,
          replyCount: comment.replyCount + 1,
        }));
      }
    },
    onError: (error, input) => {
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        commentCount: Math.max(0, post.commentCount - 1),
      }));
      const threadId = typeof input === "string" ? null : input.threadId;
      if (threadId) {
        patchCommentEverywhere(queryClient, threadId, (comment) => ({
          ...comment,
          replyCount: Math.max(0, comment.replyCount - 1),
        }));
      }
      toast.error(errorMessage(error, "Couldn't add your comment."));
    },
    onSettled: (_result, _error, input) => {
      const threadId = typeof input === "string" ? null : input.threadId;
      // A reply refetches its thread; a comment refetches the page. Both go
      // through the post so the card's tally reconciles too.
      if (threadId) void queryClient.invalidateQueries({ queryKey: repliesKey(threadId) });
      reconcilePost(queryClient, postId);
    },
  });
}

/**
 * Like or unlike a comment, optimistically, wherever it is cached.
 *
 * `unavailable` flips on the first 404 and stays: the route is asked for and
 * not deployed, so the heart keeps its count and stops taking taps rather
 * than toasting an error on each one.
 */
export function useLikeComment() {
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);

  const mutation = useMutation({
    mutationFn: ({ commentId, like }: { commentId: string; like: boolean }) =>
      likeComment(commentId, like),
    onMutate: ({ commentId, like }) =>
      patchCommentEverywhere(queryClient, commentId, (comment) => applyCommentLike(comment, like)),
    onError: (error, { commentId, like }) => {
      patchCommentEverywhere(queryClient, commentId, (comment) =>
        applyCommentLike(comment, !like)
      );
      if (errorCode(error) === "NOT_FOUND") {
        setUnavailable(true);
        return;
      }
      toast.error(errorMessage(error, "Couldn't update your like."));
    },
    onSuccess: (result, { commentId }) =>
      // The server's tally wins the moment it answers.
      patchCommentEverywhere(queryClient, commentId, (comment) => ({
        ...comment,
        likedByMe: result.liked,
        likeCount: result.likeCount,
      })),
  });

  return { ...mutation, unavailable };
}

/**
 * Delete the reader's own comment. The row leaves at once; a 404 on the
 * ROUTE (as opposed to the comment) makes the control go quiet.
 */
export function useDeleteComment(postId: string) {
  const queryClient = useQueryClient();
  const [unavailable, setUnavailable] = useState(false);

  const mutation = useMutation({
    mutationFn: ({ commentId }: { commentId: string; parentId: string | null }) =>
      deleteComment(commentId),
    onSuccess: (_result, { commentId, parentId }) => {
      for (const prefix of [["ms", "post"], ["ms", "comment"]] as const) {
        queryClient.setQueriesData<InfiniteData<CommentsPage>>({ queryKey: prefix }, (data) =>
          data?.pages
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((item) => item.id !== commentId),
                })),
              }
            : data
        );
      }
      patchPostEverywhere(queryClient, postId, (post) => ({
        ...post,
        commentCount: Math.max(0, post.commentCount - 1),
      }));
      if (parentId) {
        patchCommentEverywhere(queryClient, parentId, (comment) => ({
          ...comment,
          replyCount: Math.max(0, comment.replyCount - 1),
        }));
      }
      toast.success("Comment deleted");
    },
    onError: (error) => {
      if (errorCode(error) === "NOT_FOUND") {
        setUnavailable(true);
        return;
      }
      toast.error(errorMessage(error, "Couldn't delete the comment."));
    },
    onSettled: () => reconcilePost(queryClient, postId),
  });

  return { ...mutation, unavailable };
}

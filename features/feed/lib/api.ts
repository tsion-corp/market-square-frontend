"use client";
import type { StoryStyle } from "@/lib/story-style";

import { msApi } from "@/lib/api/service";
import { uploadFile } from "@/lib/api/upload";
import { noteMediaContract } from "@/lib/media-contract";
import type { DeepLink } from "@/lib/api/schemas";
import { StoryViewersPageSchema } from "@/features/feed/lib/types";
import {
  BookmarkResultSchema,
  PinResultSchema,
  CommentSchema,
  CommentLikeResultSchema,
  CommentsPageSchema,
  FeedPageSchema,
  LikeResultSchema,
  RepostResultSchema,
  PostSchema,
  type Lane,
  type Post,
  type ReportReason,
  type Mention,
} from "@/features/feed/lib/types";

// `topics` filters the lane server-side (the same comma-joined parameter
// /search and /streams take). It is omitted entirely when nothing is chosen —
// an empty `topics=` would read as "match no topics" rather than "no filter".
export async function fetchFeed(
  lane: Lane,
  cursor?: string,
  topics: string[] = [],
  /** One discussion. Replaces the lane rather than narrowing it. */
  hashtag?: string,
  /** The timeline pages at 30; the head check that looks for new posts asks for fewer. */
  limit = 30
) {
  const page = FeedPageSchema.parse(
    await msApi.get("/feed", {
      lane,
      limit,
      cursor,
      ...(topics.length > 0 ? { topics: topics.join(",") } : {}),
      ...(hashtag ? { hashtag } : {}),
    })
  );
  noteMediaContract(page.items.map((item) => item.post));
  return page;
}

/**
 * Asks for ONE post, only to learn whether this server returns the `media`
 * list — the composer's question when nothing on the page has answered it.
 * Once per page load; a failed ask is forgotten so the next composer retries.
 */
let mediaProbe: Promise<void> | null = null;
export function probeMediaContract(): Promise<void> {
  mediaProbe ??= fetchFeed("for-you", undefined, [], undefined, 1).then(
    () => undefined,
    () => {
      mediaProbe = null;
    }
  );
  return mediaProbe;
}

// GET /stories returns FeedItems; the row only needs the posts inside them.
//
// scope=all, NOT following. On an account that follows nobody, `following`
// returns only the viewer's own stories, so the rail looked broken to every new
// user. `all` is server-ranked — own, then followed, then everyone, each
// newest-first — and that ORDER IS AUTHORITATIVE: the rail renders it as given
// and must not re-sort it (see the note on ordering in stories-row).
export async function fetchStories(): Promise<{ items: Post[] }> {
  const page = FeedPageSchema.parse(await msApi.get("/stories", { scope: "all", limit: 30 }));
  return { items: page.items.flatMap((item) => (item.post ? [item.post] : [])) };
}

export async function createPost(input: {
  kind: "update" | "story";
  text: string;
  mediaUrl?: string;
  /** Two or more photos, in order — sent INSTEAD of `mediaUrl` (`mediaFields`). */
  media?: { url: string; kind: "image" | "video" }[];
  /**
   * A TEXT STORY'S BACKGROUND AND FACE — `kind: "story"` only.
   *
   * Sending it on an update is a 400 rather than being ignored, and both fields
   * are required together when the object is present: it is all-or-nothing, not
   * a partial. The eight backgrounds are an allowlist and a ninth is a 400, so
   * it is typed off the shared list rather than as a string.
   *
   * Declared here because a spread bypasses TypeScript's excess-property check
   * — `guests` on stream create typechecked perfectly while being absent from
   * its own input type, and the type is what tells the next caller the field
   * exists at all.
   */
  storyStyle?: StoryStyle;
  deepLink?: DeepLink;
  quotedPostId?: string;
  mentions?: Mention[];
}) {
  const post = PostSchema.parse(await msApi.post("/posts", input));
  noteMediaContract([post]);
  return post;
}

// Single post, by id — the permalink's source. Public GET: a signed-out
// reader can open a shared link, and a signed-in one still gets likedByMe.
export async function fetchPost(postId: string) {
  const post = PostSchema.parse(await msApi.get(`/posts/${postId}`));
  noteMediaContract([post]);
  return post;
}

export async function repostPost(postId: string, repost: boolean) {
  const path = `/posts/${postId}/repost`;
  return RepostResultSchema.parse(repost ? await msApi.post(path) : await msApi.del(path));
}

/**
 * Post media goes through the service's own `POST /uploads`, which decides the
 * stored content type and extension server-side from the bytes, never from the
 * client's filename, and namespaces the key by the verified user.
 *
 * The BFF used to write these to `public/uploads/` using the client-supplied
 * extension, which let an `x.html` declared as `image/png` be served back as
 * same-origin HTML — stored XSS against the session cookie. That handler is
 * gone; do not reintroduce a local-disk upload path.
 */
export async function uploadPostMedia(file: File) {
  return uploadFile(file);
}

// The mention search is shared with the chat composer and lives in
// `lib/api/mentions.ts`; re-exported so this slice's imports are unchanged.
export { searchMentions } from "@/lib/api/mentions";

// Arkmarks. POST saves, DELETE unsaves; GET /me/bookmarks pages the saved
// posts back as feed items, so the Arkmarks tab reuses the timeline shape.
export async function bookmarkPost(postId: string, bookmark: boolean) {
  const path = `/posts/${postId}/bookmark`;
  return BookmarkResultSchema.parse(
    (bookmark ? await msApi.post(path) : await msApi.del(path)) ?? {}
  );
}

export async function fetchBookmarks(cursor?: string) {
  return FeedPageSchema.parse(await msApi.authedGet("/me/bookmarks", { limit: 30, cursor }));
}

export async function likePost(postId: string, like: boolean) {
  const path = `/posts/${postId}/like`;
  return LikeResultSchema.parse(like ? await msApi.post(path) : await msApi.del(path));
}

export async function fetchComments(postId: string, cursor?: string) {
  return CommentsPageSchema.parse(
    await msApi.get(`/posts/${postId}/comments`, cursor ? { cursor } : {})
  );
}

/**
 * A comment, or a REPLY when `parentId` names the comment the reader TAPPED
 * Reply on — top-level or reply alike; the service files it under the
 * top-level parent and records who was answered. `parentId` is only sent
 * when present.
 */
export async function addComment(
  postId: string,
  text: string,
  parentId?: string | null,
  mentions?: Mention[]
) {
  return CommentSchema.parse(
    await msApi.post(`/posts/${postId}/comments`, {
      text,
      ...(parentId ? { parentId } : {}),
      // Structured picks, so the service records exactly who was meant.
      ...(mentions && mentions.length > 0 ? { mentions } : {}),
    })
  );
}

/** `GET /comments/:id` — one comment, for a permalink opened ON it (`?comment=`). */
export async function fetchComment(commentId: string) {
  return CommentSchema.parse(await msApi.get(`/comments/${commentId}`));
}

/** `GET /comments/:id/replies` — a thread's replies, oldest first. */
export async function fetchReplies(commentId: string, cursor?: string) {
  return CommentsPageSchema.parse(
    await msApi.get(`/comments/${commentId}/replies`, cursor ? { cursor } : {})
  );
}

/** `POST|DELETE /comments/:id/like` — idempotent both ways. */
export async function likeComment(commentId: string, like: boolean) {
  const path = `/comments/${commentId}/like`;
  return CommentLikeResultSchema.parse(like ? await msApi.post(path) : await msApi.del(path));
}

/** `DELETE /comments/:id` — the comment's author, or the post's. */
export async function deleteComment(commentId: string) {
  await msApi.del(`/comments/${commentId}`);
}

export async function reportTarget(input: {
  targetType: "post" | "comment" | "profile" | "stream_message";
  targetId: string;
  reason: ReportReason;
  note?: string;
}) {
  return msApi.post<{ id: string; status: string }>("/reports", input);
}

/**
 * Edit a post — `PATCH /posts/:id`.
 *
 * TEXT AND TOPICS ONLY, and that is a product decision rather than a gap:
 * media, the quoted post and the deep link are not editable, because swapping
 * the picture under something people have already liked changes what they
 * endorsed. New media means delete and repost.
 *
 * Author only — 403 for anybody else, admins included: admins remove, they do
 * not rephrase. Same 2000-character cap as create, 400 on empty, 404 once
 * deleted. Works on a story too.
 */
export async function editPost(
  postId: string,
  input: { text: string; topics?: string[] }
) {
  return PostSchema.parse(
    await msApi.patch(`/posts/${postId}`, {
      text: input.text.trim(),
      ...(input.topics ? { topics: input.topics } : {}),
    })
  );
}

/**
 * Delete a post or a story — `DELETE /posts/:id`.
 *
 * ONE route for both, because a story IS a post (`kind: "story"`). A soft
 * remove by the author or an admin; the post then 404s.
 */
/**
 * Pin one of your own posts to the top of your profile, or take it down.
 *
 * Pinning REPLACES — one per profile, no unpin-first. Unpinning is idempotent
 * and does not require this to be the pinned post, so pressing it against a
 * stale view still answers cleanly. Somebody else's post is a 404, not a 403:
 * a 403 would confirm the post exists and is not yours.
 */
export async function pinPost(postId: string, pin: boolean) {
  const path = `/posts/${postId}/pin`;
  return PinResultSchema.parse((pin ? await msApi.post(path) : await msApi.del(path)) ?? {});
}

export async function deletePost(postId: string) {
  return msApi.del<unknown>(`/posts/${postId}`);
}

/**
 * `GET /posts/{id}/viewers` — the author's own story's viewers. Author only:
 * anybody else, a removed story or a service without the route answers 4xx,
 * and the caller draws nothing (see lib/story-viewers.ts).
 */
export async function fetchStoryViewers(storyId: string, cursor?: string) {
  return StoryViewersPageSchema.parse(
    await msApi.authedGet(`/posts/${encodeURIComponent(storyId)}/viewers`, { limit: 50, cursor })
  );
}

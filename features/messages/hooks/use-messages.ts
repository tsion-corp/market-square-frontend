"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorCode, errorMessage } from "@/lib/api/envelope";
import { inviteErrorCopy } from "@/features/messages/lib/invites";
import { useAuth } from "@/hooks/use-auth";
import { useRefreshUnread } from "@/hooks/use-unread";
import {
  acceptConversation,
  acceptInvite,
  createInvite,
  fetchInvitePreview,
  addGroupMembers,
  createGroup,
  joinGroup,
  declineConversation,
  deleteConversation,
  fetchConversationMembers,
  fetchConversations,
  fetchMessages,
  markConversationRead,
  openConversation,
  removeGroupMember,
  renameGroup,
  updateGroup,
  type GroupEdit,
  setMemberRole,
  transferOwnership,
  sendMessage,
  openSnap,
  removeMessage,
  editMessage,
  fetchHouseNotificationSettings,
  updateHouseNotificationSettings,
} from "@/features/messages/lib/api";
import type { HouseNotificationSettings, OutgoingMessage } from "@/features/messages/lib/types";
import { tabQuery, type InboxTab } from "@/features/messages/lib/filter";
import {
  conversationFromRef,
  openedConversationKey,
} from "@/features/messages/lib/open-conversation";
import type { Profile } from "@/lib/api/schemas";

/*
  THE SIGNAL EXISTS AND THIS CLIENT CANNOT HEAR IT YET.

  This comment used to say the service publishes `market-square.message.sent`
  and that the poll stood in "until that exists". Both halves were wrong, and
  wrongly reassuring. Corrected against the service on `origin/main`, not
  against a description of it:

   · `market-square.message.sent` was published once per RECIPIENT to the
     domain exchange, which no client-facing consumer reads. The worker's own
     wildcard binding matched it, found no handler and dropped it — a message
     in a 500-person group fired 500 publishes that reached nobody. The
     service's own record of this is `apps/market-square/src/ports/
     chat-signal.ts`, written by whoever replaced it.
   · What is live is `chatMessageArrived` on `market-square:conversation:<id>`,
     carrying `{ conversationId, messageId }` and no body — ONE publish per
     message, fanned out by the gateway, so the cost of speaking no longer
     grows with the number of people who will hear it. Published from
     `conversation-service.ts` on the send path. ADR-0009 Stage 2.

  So the blocker is on OUR side, and it is not a `useRoomChatSignal` copy.
  That topic looks public-shaped and is not: the gateway checks the
  `market-square:conversation:` prefix BEFORE its generic `<service>:<channel>`
  public rule, and refuses a subscribe without an authenticated socket AND a
  signed grant naming that conversation (`apps/ws-gateway/src/hub/topics.ts`).
  That ordering is deliberate — reaching the public branch would hand every
  private thread to anyone who opens a socket.

  `lib/ws-gateway-shared.ts` knows two modes: public topics subscribed on open,
  and personal `user:<id>` topics behind an `authenticate` frame. A grant is a
  THIRD mode — fetch `GET /realtime/grant`, present it, and re-present it when
  a socket reopens, because the grant is per conversation and not per session.

  Until that is built, this is the mechanism rather than a floor, and it stays
  at 5s. A slower interval with no subscriber behind it is a straight downgrade
  for every reader, paid now for a benefit that does not exist — subscriber
  first, confirm frames in prod, relax only after, which is the order ADR-0009
  and the room chat signal both used.

  What was actually costing the most here was never this poll: an open thread
  re-renders on every tick, and each re-render used to re-prefetch a profile
  page for every avatar on screen. See `lib/person-link-prefetch.test.ts`.
*/
const THREAD_POLL_MS = 5_000;

/**
 * One tab's conversations.
 *
 * The TAB IS IN THE QUERY KEY, so each of the four caches and pages
 * independently. Sharing one key would make switching tabs replay the previous
 * tab's rows under the new tab's name until the refetch landed, and paging
 * would carry a cursor minted for a different filter.
 */
export function useConversations(tab: InboxTab = "all") {
  const { authenticated } = useAuth();
  return useInfiniteQuery({
    queryKey: ["ms", "conversations", tab],
    queryFn: ({ pageParam }) => fetchConversations(pageParam ?? undefined, tabQuery(tab)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: authenticated,
    refetchInterval: 30_000,
  });
}

export function useMessages(conversationId: string, open: boolean) {
  return useQuery({
    queryKey: ["ms", "messages", conversationId],
    queryFn: () => fetchMessages(conversationId),
    enabled: open && Boolean(conversationId),
    refetchInterval: open ? THREAD_POLL_MS : false,
  });
}

/**
 * The thread's OLDER pages, driven by the reader scrolling up.
 *
 * A second query rather than turning useMessages into an infinite one: the
 * newest page polls every few seconds, and an infinite query refetches every
 * loaded page on each poll — a long history would cost a page per 5s for
 * every page the reader had opened. History does not change; it is fetched
 * once per page and kept. Keyed OUTSIDE the ["ms", "messages", id] prefix on
 * purpose, so the invalidations a send or a read receipt fire on the newest
 * page leave it alone.
 *
 * `startCursor` is the newest page's `nextCursor`: where history begins. Null
 * until that page has loaded, or when the thread is shorter than one page.
 */
export function useMessageHistory(conversationId: string, startCursor: string | null) {
  return useInfiniteQuery({
    queryKey: ["ms", "messages-history", conversationId],
    queryFn: ({ pageParam }) => fetchMessages(conversationId, pageParam ?? undefined),
    initialPageParam: startCursor,
    getNextPageParam: (last) => last.nextCursor,
    enabled: Boolean(conversationId) && startCursor !== null,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/**
 * The roster behind a group thread's avatars and its members sheet.
 *
 * ONE query for both, deliberately. The bubbles need it to turn a `senderId`
 * into a face, and the sheet needs it to list who is in the room; two queries
 * would poll the same route twice and could disagree about the membership
 * inside one render.
 *
 * `enabled` is the caller's answer to "is this a group", so a 1:1 thread never
 * issues the request at all. No `refetchInterval`: membership changes when
 * somebody adds or removes a person, which is a mutation this client makes or
 * a change the next open picks up — not something worth a 5s poll beside the
 * message poll that already runs.
 */
export function useConversationMembers(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ms", "conversation-members", conversationId],
    queryFn: () => fetchConversationMembers(conversationId),
    enabled: enabled && Boolean(conversationId),
    // A group of 75 does not change between two openings of the same thread.
    staleTime: 60_000,
  });
}

export function useSendMessage(conversationId: string) {
  const client = useQueryClient();
  const refreshUnread = useRefreshUnread();
  return useMutation({
    mutationFn: (body: OutgoingMessage) => sendMessage(conversationId, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "messages", conversationId] });
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
      refreshUnread();
    },
    onError: (error, body) => toast.error(sendErrorCopy(error, body)),
  });
}

/**
 * REMOVES THE READER'S OWN MESSAGE.
 *
 * The thread and the inbox are both invalidated: the row becomes a tombstone
 * in place, and the inbox preview shows the tombstone rather than falling back
 * to the message before it — a preview that reverts to older words reads as a
 * message arriving backwards.
 */
export function useRemoveMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => removeMessage(conversationId, messageId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "messages", conversationId] });
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't remove that message.")),
  });
}

/**
 * EDITS THE READER'S OWN WORDS, inside the service's window.
 *
 * A refusal past the window has its own code, so the toast says the true
 * thing: "too late to edit" rather than "not allowed", which would suggest
 * the message was never theirs.
 */
export function useEditMessage(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, text }: { messageId: string; text: string }) =>
      editMessage(conversationId, messageId, text),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "messages", conversationId] });
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
    },
    onError: (error) => toast.error(editErrorCopy(error)),
  });
}

function editErrorCopy(error: unknown): string {
  if (errorCode(error) === "EDIT_WINDOW_PASSED") {
    const minutes = (error as { details?: { windowMinutes?: unknown } } | null)?.details
      ?.windowMinutes;
    return typeof minutes === "number"
      ? `Too late to edit — messages can be changed for ${minutes} minutes after sending.`
      : "Too late to edit that message.";
  }
  return errorMessage(error, "Couldn't save that edit.");
}

/**
 * OPENS A SNAP, which SPENDS it.
 *
 * The response is the only copy of that file this reader will ever be handed,
 * so it is returned to the caller and deliberately NOT written into the
 * message cache: a cache is read back on a remount, and a snap that came back
 * when the thread re-rendered would not be view-once at all.
 *
 * The thread and the inbox are invalidated instead, so the bubble and the row
 * re-read the service's own `destroyedAt` and settle on "Opened" — the state
 * outlives this tab, which is the half that matters.
 */
export function useOpenSnap(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => openSnap(conversationId, messageId),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "messages", conversationId] });
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't open that.")),
  });
}

/**
 * A reply whose `replyToId` is not in this conversation answers 404 with the
 * service's own sentence ("That message is not in this conversation."). The
 * generic NOT_FOUND copy — "it may have been removed" — would be wrong here,
 * so the service's words are surfaced as they are, and nothing retries.
 */
function sendErrorCopy(error: unknown, body: OutgoingMessage): string {
  if (body.replyToId && errorCode(error) === "NOT_FOUND") {
    const said = (error as { message?: unknown } | null)?.message;
    return typeof said === "string" && said ? said : "That message is not in this conversation.";
  }
  return errorMessage(error, "Couldn't send that message.");
}

/** Opening a thread is the acknowledgement — the inbox refreshes after it. */
export function useMarkConversationRead() {
  const client = useQueryClient();
  const refreshUnread = useRefreshUnread();
  return useMutation({
    mutationFn: markConversationRead,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
      refreshUnread();
    },
  });
}

/**
 * Creates a group thread.
 *
 * Invalidates the inbox rather than writing the new row into it: the service
 * decides the group's shape (the creator's `owner` role, the capped member
 * preview, the member count) and a hand-built optimistic row would be a second
 * guess at all three that the next poll silently corrects.
 */
export function useCreateGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      title: string;
      memberIds: string[];
      description?: string;
      imageUrl?: string;
      /** Whether somebody holding the link may join themselves. */
      visibility?: "public" | "private";
    }) => createGroup(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ["ms", "conversations"] }),
    onError: (error) => toast.error(errorMessage(error, "Couldn't create that group.")),
  });
}

/**
 * Answer a request — a chat request, or an invitation to a house.
 *
 * Both invalidate every conversation list, not just the requests tab: accepting
 * MOVES a row from Gist Requests into All and Gists, so a tab that kept its
 * cached page would show the same conversation in two places at once.
 *
 * ─── AND THE HOUSE'S OWN CACHE, WHICH IS NOT A CONVERSATION LIST ─────────────
 * A house invite is answered here but READ somewhere else. `["ms", "house", id]`
 * carries `viewerIsMember`, `memberCount` and `canJoin`, and accepting flips all
 * three. Invalidate only the lists and somebody who accepts an invite and then
 * opens the house is shown the cached stranger's view — a Join House button on a
 * house they just joined, and a member count one short. It is keyed by the
 * conversation id, which is the id being answered, so the same call covers both
 * kinds; for a DM nothing is cached under that key and the invalidation is free.
 */
export function useAnswerRequest() {
  const client = useQueryClient();
  const refreshUnread = useRefreshUnread();
  const settle = (_result: unknown, conversationId: string) => {
    client.invalidateQueries({ queryKey: ["ms", "conversations"] });
    client.invalidateQueries({ queryKey: ["ms", "house", conversationId] });
    refreshUnread();
  };
  const accept = useMutation({
    mutationFn: acceptConversation,
    onSuccess: settle,
    onError: (error) => toast.error(errorMessage(error, "Couldn't accept that request.")),
  });
  const decline = useMutation({
    mutationFn: declineConversation,
    onSuccess: settle,
    onError: (error) => toast.error(errorMessage(error, "Couldn't decline that request.")),
  });
  return { accept, decline };
}

export function useOpenConversation() {
  const client = useQueryClient();
  return useMutation({
    // The PROFILE, not its id: the response is a bare ref with no peer, and the
    // thread needs one. See lib/open-conversation.
    mutationFn: (peer: Profile) => openConversation(peer.id),
    // Seeded HERE, in the hook's own callback, not in each caller's: a hook
    // option runs even when the calling component has unmounted, which is
    // exactly what happens when a popup closes itself on success.
    onSuccess: (ref, peer) => {
      client.setQueryData(openedConversationKey(ref.id), conversationFromRef(ref, peer));
      return client.invalidateQueries({ queryKey: ["ms", "conversations"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't open that conversation.")),
  });
}

/**
 * The three group-management mutations behind the thread's overflow menu
 * (nodes 78:8337 and 78:8525).
 *
 * They share one invalidation set because they change the same two things a
 * reader can see: the roster (`conversation-members`) and the inbox row that
 * names and counts it (`conversations`). Splitting them was how a rename
 * landed in the header and not in the list.
 */
function useConversationAction<TVariables>(
  conversationId: string,
  mutationFn: (variables: TVariables) => Promise<unknown>,
  message: string
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "conversation-members", conversationId] });
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
      toast.success(message);
    },
    onError: (error) => toast.error(errorMessage(error, "That didn't work.")),
  });
}

/** "Add gist partners" / "Invite gist partners" — any member may. */
export function useAddGroupMembers(conversationId: string) {
  return useConversationAction<string[]>(
    conversationId,
    (memberIds) => addGroupMembers(conversationId, memberIds),
    "Added to the group"
  );
}

/** "Edit group title" — owner only, enforced by the service. */
/**
 * Save a group edit. See `updateGroup` for why an absent field is untouched
 * rather than cleared, and why visibility is owner-only.
 */
export function useUpdateGroup(conversationId: string) {
  return useConversationAction<GroupEdit>(
    conversationId,
    (edit) => updateGroup(conversationId, edit),
    "Group updated"
  );
}

export function useRenameGroup(conversationId: string) {
  return useConversationAction<string>(
    conversationId,
    (title) => renameGroup(conversationId, title),
    "Group renamed"
  );
}

/**
 * "Leave group" — `DELETE /conversations/:id/members/:me`.
 *
 * The caller passes their OWN profile id. The same route removes somebody
 * else when the owner names them, so this hook does not hard-code "me": the
 * menu knows who is leaving and the roster sheet may one day know who is being
 * removed.
 */
export function useLeaveGroup(conversationId: string) {
  return useConversationAction<string>(
    conversationId,
    (profileId) => removeGroupMember(conversationId, profileId),
    "You left the group"
  );
}

/** Remove somebody from the house — owner (anyone but themself) or admin (members only). */
export function useRemoveGroupMember(conversationId: string) {
  return useConversationAction<string>(
    conversationId,
    (profileId) => removeGroupMember(conversationId, profileId),
    "Removed from the house"
  );
}

/** "Make admin" / "Remove admin" — owner only. */
export function useSetMemberRole(conversationId: string) {
  return useConversationAction<{ profileId: string; role: "admin" | "member" }>(
    conversationId,
    ({ profileId, role }) => setMemberRole(conversationId, profileId, role),
    "Role updated"
  );
}

/** "Make owner" — the owner hands the house over and stays on as an admin. */
export function useTransferOwnership(conversationId: string) {
  return useConversationAction<string>(
    conversationId,
    (profileId) => transferOwnership(conversationId, profileId),
    "Ownership handed over"
  );
}

const houseSettingsKey = (conversationId: string) =>
  ["ms", "house-notification-settings", conversationId] as const;

/**
 * One house's notification levels. A 404 means the route is not deployed here
 * (or the reader is not a member) — the screen reads it as "coming", never as
 * an error to retry.
 */
export function useHouseNotificationSettings(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: houseSettingsKey(conversationId),
    queryFn: () => fetchHouseNotificationSettings(conversationId),
    enabled: enabled && conversationId.length > 0,
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
}

/** Save a house's levels — optimistic, and put back with a toast when refused. */
export function useUpdateHouseNotificationSettings(conversationId: string) {
  const client = useQueryClient();
  const key = houseSettingsKey(conversationId);
  return useMutation({
    mutationFn: (patch: Partial<HouseNotificationSettings>) =>
      updateHouseNotificationSettings(conversationId, patch),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<HouseNotificationSettings>(key);
      if (previous) client.setQueryData<HouseNotificationSettings>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      toast.error(errorMessage(error, "Couldn't save that setting."));
    },
    onSuccess: (saved) => {
      client.setQueryData(key, saved);
      // The inbox rows carry the same levels; keep them in step.
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
    },
  });
}

/** "Join House" on Home's community grid — `POST /conversations/:id/join`. */
export function useJoinGroup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: joinGroup,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
      client.invalidateQueries({ queryKey: ["ms", "discover-houses"] });
      toast.success("You're in");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't join that house.")),
  });
}

/**
 * "Share invite link" — makes the token the share sheet carries.
 *
 * A 404 from a member's own thread means the route is not on this server yet,
 * so it says that rather than "not found".
 */
export function useCreateInvite() {
  return useMutation({
    mutationFn: createInvite,
    onError: (error) =>
      toast.error(
        errorCode(error) === "NOT_FOUND"
          ? "Invite links aren't available here yet."
          : errorMessage(error, "Couldn't make an invite link.")
      ),
  });
}

/**
 * The landing page's read. SIGNED-IN STATE IS IN THE KEY: `canJoin` answers
 * for the viewer, so signing in on the page has to ask again.
 */
export function useInvitePreview(token: string) {
  const { ready, authenticated } = useAuth();
  return useQuery({
    queryKey: ["ms", "invite", token, authenticated],
    queryFn: () => fetchInvitePreview(token),
    enabled: ready && token.length > 0,
    retry: (count, error) => errorCode(error) !== "NOT_FOUND" && count < 2,
  });
}

export function useAcceptInvite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: acceptInvite,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
      client.invalidateQueries({ queryKey: ["ms", "invite"] });
      toast.success("You're in");
    },
    onError: (error) =>
      toast.error(inviteErrorCopy(error as never) ?? errorMessage(error, "Couldn't join with this link.")),
  });
}

/** "Delete Chat" — removes the thread from YOUR inbox only. See the api note. */
export function useDeleteConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ms", "conversations"] });
      toast.success("Removed from your inbox");
    },
    onError: (error) => toast.error(errorMessage(error, "Couldn't remove that chat.")),
  });
}

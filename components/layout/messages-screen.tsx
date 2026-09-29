"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Sheet } from "@/components/ui/sheet";
import { Button, Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { RowSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useMe } from "@/hooks/use-me";
import { usePeople } from "@/features/discovery";
import { InboxSearch } from "@/features/messages/components/inbox-chrome";
import { conversationFromRef } from "@/features/messages/lib/open-conversation";
import { CreateGroupFlow } from "@/components/layout/create-group-flow";
import { GistRoomCard } from "@/components/layout/gist-room-card";
import { ThreadSafetyRows } from "@/components/layout/thread-safety-rows";
import { OpenHouseSheet } from "@/features/houses";
import {
  MessagesPage,
  useAddGroupMembers,
  useConversationMembers,
  useOpenConversation,
  type NewChatPickerProps,
} from "@/features/messages";
import { ChallengeHost } from "@/features/games/components/challenge-host";
import type { Profile } from "@/lib/api/schemas";

/**
 * Joins the messages and discovery slices, which never import each other.
 *
 * The inbox's `+` opens a menu, and both of its items mean choosing a PERSON —
 * which is the people directory, and that lives in discovery. So the page
 * takes the picker as a slot and this composes it, the same way
 * `profile-screen` composes messages' own Message button into a profile.
 */
export function MessagesScreen() {
  return (
    /*
      The game a thread can carry lives in the games slice, and messages never
      imports it — same rule as the people picker and the gist-room composer
      above. The host is mounted HERE, around the whole screen, for a reason
      beyond tidiness: the game is a full-screen overlay, and rendered inside
      the message list it would be destroyed and recreated as the list
      virtualises, taking a round in progress with it.

      The open thread registers how a finished score becomes a message, since
      only it knows which conversation that is.
    */
    <ChallengeHost>
      <MessagesPage
        // A GROUP thread's header offers "Create Gist Room" (node 76:8239). The
        // composer is node 59:7544 and lives in the houses slice, so it is
        // joined here rather than imported across slices — the same reason the
        // people picker is a slot.
        renderGistRoom={({ open, onClose, houseConversationId }) => (
          <OpenHouseSheet
            open={open}
            onClose={onClose}
            houseConversationId={houseConversationId}
          />
        )}
        // The announcement card a gist room posts into its house group
        // (node 225:3873). Composed here because it reads three slices at once —
        // the room, the topic vocabulary and this group's roster.
        renderRoomCard={({ streamId, conversationId }) => (
          <GistRoomCard streamId={streamId} conversationId={conversationId} />
        )}
        // Block and Report inside a 1:1's overflow menu (node 77:8287). Both
        // belong to the profile slice, so the rows are composed here and drawn
        // by the menu — see `ThreadSafetyRows`.
        renderThreadSafety={(peer) => <ThreadSafetyRows peer={peer} />}
        // "Add / Invite gist partners" (78:8527, 78:8345). Choosing a person is
        // the discovery slice's directory, exactly as the inbox's own `+` is.
        renderAddMembers={(props) => <AddMembersSheet {...props} />}
        renderNewChat={(props) =>
          // Two designs, two components. Create Group is a two-STEP flow (choose
          // people, then name and describe the room) and folding it into the
          // one-step gist picker as a mode was what made that picker start
          // growing a second personality.
          props.mode === "group" ? (
            <CreateGroupFlow {...props} />
          ) : (
            <NewChatSheet {...props} />
          )
        }
      />
    </ChallengeHost>
  );
}

/**
 * New Gist — node 36:7004.
 *
 * ─── THE FILE'S NUMBERS ──────────────────────────────────────────────────────
 * A 347 panel at `rgba(16,16,18,0.62)` behind a 7px backdrop blur, 1px
 * `white/18`, 22px radius, 16px padding and a 12px gap; then the 315x38 search
 * pill and a 12px-gap column of 54.5px rows, each `white/3` inside a 1px
 * `white/10` at a 12px radius, carrying a 38px avatar (`white/10` fill,
 * `white/20` ring), a 12/16 Bold name and an 11/16.5 line at 50% white.
 *
 * The search pill is `InboxSearch` rather than a second copy of it: node
 * 36:7089 is the inbox's own field at the same 315x38 with the same 0.68px
 * hairline, shadow and `#7A7A7A` placeholder. Restating it here is how one
 * field ends up drifting from the other.
 *
 * The file's rows show "8,750 followers" on two of them and "@handle" on the
 * other two. Both are drawn — followers where the directory reports any, the
 * handle otherwise — because a row reading "0 followers" says something less
 * useful about a person than their name does.
 *
 * The heading is the file's 14/20 Bold in GEIST, not the Roboto the style is
 * named for — the house face, per the type rule.
 *
 * `POST /conversations` is idempotent from either side, so picking somebody
 * you already have a thread with lands ON that thread rather than making a
 * second one — which is what makes this safe to press twice.
 */
function NewChatSheet({ open, onClose, onStarted }: NewChatPickerProps) {
  const [query, setQuery] = useState("");
  const me = useMe();
  const start = useOpenConversation();

  // Only fetch while the panel is actually open — a directory nobody is
  // looking at is a request nobody asked for.
  const people = usePeople(query, "followers", open);
  const sentinel = useInfiniteScroll(
    () => people.fetchNextPage(),
    Boolean(people.hasNextPage && !people.isFetchingNextPage),
  );

  const items = (people.data?.pages.flatMap((page) => page.items) ?? []).filter(
    // You are not someone you can message. Same rule the People directory
    // applies, and for the same reason: a row that cannot do the thing every
    // other row does reads as broken rather than deliberate.
    (profile) => !me.data || profile.id !== me.data.id,
  );

  const pick = (profile: Profile) => {
    start.mutate(profile, {
      onSuccess: (conversation) => {
        // Built from the ref and the person just chosen. This construction
        // started here and now lives in lib/open-conversation, so the linked
        // `?c=` path opens the identical thread rather than a second copy of
        // the rules for what a brand-new 1:1 is.
        onStarted(conversationFromRef(conversation, profile));
        setQuery("");
      },
    });
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      bare
      // The file's own surface: 347 wide, 62% woodsmoke behind a 7px blur,
      // 18% hairline, 22px radius.
      panelClassName="border border-white/[0.18] bg-[#101012]/[0.62] backdrop-blur-[7px] sm:max-w-[347px] sm:rounded-[22px]"
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-[14px] font-bold leading-5 text-white">New Gist</h2>

        <InboxSearch
          value={query}
          onChange={setQuery}
          id="new-chat-search"
          label="Search people"
        />

        <div className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto">
          {people.isPending && [0, 1, 2].map((i) => <RowSkeleton key={i} />)}

          {people.isError && (
            <ErrorState
              error={people.error}
              fallback="Couldn't load people."
              onRetry={() => people.refetch()}
            />
          )}

          {people.isSuccess && items.length === 0 && (
            <EmptyState
              glyph="◇"
              title={query.trim() ? "No matches" : "Nobody to show yet"}
              body={
                query.trim()
                  ? "No one here matches that name."
                  : "The directory is empty right now."
              }
            />
          )}

          {items.map((profile) => {
            const name = profile.displayName ?? profile.username;
            return (
              <button
                key={profile.id}
                type="button"
                // Disabled while a thread is being opened, so an impatient
                // double-tap cannot fire two creates.
                disabled={start.isPending}
                onClick={() => pick(profile)}
                // The file's 54.5px row: 3% fill, 10% hairline, 12px radius.
                className="ws-press flex h-[54.5px] items-center gap-[9px] rounded-xl border border-white/10 bg-white/[0.03] px-3 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-60"
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
                  <Avatar
                    name={name}
                    seed={profile.id}
                    src={profile.avatarUrl}
                    size={38}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-bold leading-4 text-white">
                    {name}
                  </span>
                  <span className="truncate text-[11px] leading-[16.5px] text-white/50">
                    {/* The file shows a follower count on the rows that have
                        one and a handle on the rest. "0 followers" tells a
                        reader less than the handle does. */}
                    {profile.followerCount > 0
                      ? `${profile.followerCount.toLocaleString()} followers`
                      : `@${profile.username}`}
                  </span>
                </span>
              </button>
            );
          })}

          <div ref={sentinel} />
          {people.isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-meta" />
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * "Add gist partners" / "Invite gist partners" — nodes 78:8527 and 78:8345.
 *
 * The SAME picker chrome as `NewChatSheet` and the same directory, differing in
 * three ways that all follow from adding to a group rather than starting a
 * chat:
 *
 *  1. it is MULTI-SELECT, because `POST /conversations/:id/members` takes up to
 *     twenty ids in one call, and twenty round trips is twenty chances to
 *     half-fail;
 *  2. people ALREADY IN the group are filtered out — a row that would be a
 *     no-op reads as broken, the same rule the directory applies to your own
 *     row;
 *  3. it closes on success rather than navigating, because you are already in
 *     the thread you just changed.
 *
 * ANY member may add people — the service says so explicitly — so this is
 * offered on both group menus rather than only the owner's.
 */
function AddMembersSheet({
  open,
  onClose,
  conversationId,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Profile[]>([]);
  const me = useMe();
  const members = useConversationMembers(conversationId, open);
  const add = useAddGroupMembers(conversationId);

  const people = usePeople(query, "followers", open);
  const sentinel = useInfiniteScroll(
    () => people.fetchNextPage(),
    Boolean(people.hasNextPage && !people.isFetchingNextPage),
  );

  const already = new Set(
    (members.data?.items ?? []).flatMap((row) =>
      row.profile ? [row.profile.id] : [],
    ),
  );
  const items = (people.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (profile) => profile.id !== me.data?.id && !already.has(profile.id),
  );

  const close = () => {
    setQuery("");
    setPicked([]);
    onClose();
  };

  const toggle = (profile: Profile) =>
    setPicked((current) =>
      current.some((entry) => entry.id === profile.id)
        ? current.filter((entry) => entry.id !== profile.id)
        : // The contract caps a single call at twenty.
          current.length >= 20
          ? current
          : [...current, profile],
    );

  return (
    <Sheet
      open={open}
      onClose={close}
      bare
      panelClassName="border border-white/[0.18] bg-[#101012]/[0.62] backdrop-blur-[7px] sm:max-w-[347px] sm:rounded-[22px]"
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-[14px] font-bold leading-5 text-white">
          Add gist partners
        </h2>

        <InboxSearch
          value={query}
          onChange={setQuery}
          id="add-members-search"
          label="Search people"
        />

        <div className="flex max-h-[46vh] flex-col gap-3 overflow-y-auto">
          {people.isPending && [0, 1, 2].map((i) => <RowSkeleton key={i} />)}

          {people.isError && (
            <ErrorState
              error={people.error}
              fallback="Couldn't load people."
              onRetry={() => people.refetch()}
            />
          )}

          {people.isSuccess && items.length === 0 && (
            <EmptyState
              glyph="◇"
              title={query.trim() ? "No matches" : "Everyone is already here"}
              body={
                query.trim()
                  ? "No one here matches that name."
                  : "Every person in the directory is already in this group."
              }
            />
          )}

          {items.map((profile) => {
            const name = profile.displayName ?? profile.username;
            const on = picked.some((entry) => entry.id === profile.id);
            return (
              <button
                key={profile.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(profile)}
                className={cn(
                  "ws-press flex h-[54.5px] items-center gap-[9px] rounded-xl border bg-white/[0.03] px-3 text-left transition-colors hover:bg-white/[0.06]",
                  on ? "border-white/40" : "border-white/10",
                )}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-[25%] border border-white/20 bg-white/10">
                  <Avatar
                    name={name}
                    seed={profile.id}
                    src={profile.avatarUrl}
                    size={38}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12px] font-bold leading-4 text-white">
                    {name}
                  </span>
                  <span className="truncate text-[11px] leading-[16.5px] text-white/50">
                    {profile.followerCount > 0
                      ? `${profile.followerCount.toLocaleString()} followers`
                      : `@${profile.username}`}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    on ? "border-white bg-white text-black" : "border-white/40",
                  )}
                >
                  {on && "✓"}
                </span>
              </button>
            );
          })}

          <div ref={sentinel} />
          {people.isFetchingNextPage && (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-meta" />
            </div>
          )}
        </div>

        <Button
          disabled={picked.length === 0}
          loading={add.isPending}
          onClick={() =>
            add.mutate(
              picked.map((profile) => profile.id),
              { onSuccess: close },
            )
          }
        >
          {picked.length === 0
            ? "Add to group"
            : `Add ${picked.length} ${picked.length === 1 ? "person" : "people"}`}
        </Button>
      </div>
    </Sheet>
  );
}

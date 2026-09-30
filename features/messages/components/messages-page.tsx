"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { skipToken, useQuery } from "@tanstack/react-query";
import { profileHref } from "@/lib/profile-href";
import { sq } from "@/lib/square-path";
import { setChatOpen } from "@/lib/chat-open-store";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/use-auth";
import { useQueryParam } from "@/hooks/use-query-param";
import { useMe } from "@/hooks/use-me";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { ColumnHeader } from "@/components/layout/column-header";
import { InboxFilters, InboxSearch } from "@/features/messages/components/inbox-chrome";
import { NewChatMenu } from "@/features/messages/components/new-chat-menu";
import { ConversationRow } from "@/features/messages/components/conversation-row";
import { Thread } from "@/features/messages/components/thread";
import { ThreadPlaceholder } from "@/features/messages/components/thread-placeholder";
import { visibleConversations, type InboxTab } from "@/features/messages/lib/filter";
import { openedConversationKey } from "@/features/messages/lib/open-conversation";
import type { Profile } from "@/lib/api/schemas";
import { Spinner } from "@/components/ui/button";
import { RowSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useCircuit } from "@/lib/api/circuit-store";
import { useAnswerRequest, useConversations } from "@/features/messages/hooks/use-messages";
import { type Conversation } from "@/features/messages/lib/types";

/**
 * The picker behind the column's `+`.
 *
 * Passed in rather than imported: starting a chat means choosing a PERSON, the
 * people directory lives in the discovery slice, and slices never import each
 * other. `components/layout/messages-screen.tsx` joins the two — the same
 * route-slot pattern `profile-screen` uses for this slice's own Message
 * button.
 */
export interface NewChatPickerProps {
  open: boolean;
  /**
   * Which of the `+` menu's two items opened this.
   *
   * One picker with a mode rather than two components: the panel, its search
   * field, its rows and its people query are identical, and only the selection
   * rule and the commit differ. Two copies would be two places to restyle when
   * node 36:7004 changes.
   */
  mode: NewChatMode;
  onClose: () => void;
  /** Called with a thread to open once a person has been chosen. */
  onStarted: (conversation: Conversation) => void;
}

export type NewChatMode = "gist" | "group";

function Inbox({
  onOpen,
  selectedId,
}: {
  onOpen: (conversation: Conversation) => void;
  selectedId?: string;
}) {
  // `?tab=houses` opens straight on Houses — the profile's "View All" (1021:20295).
  const tabParam = useQueryParam("tab");
  const [tab, setTab] = useState<InboxTab>(tabParam === "houses" ? "houses" : "all");
  const conversations = useConversations(tab);
  const requests = useAnswerRequest();
  const me = useMe();
  // A global outage is already announced once by the connection banner, so the
  // inbox does not repeat it — see the error block below.
  const circuit = useCircuit();
  const outage = circuit.state !== "closed";
  const [query, setQuery] = useState("");
  const sentinel = useInfiniteScroll(
    () => conversations.fetchNextPage(),
    Boolean(conversations.hasNextPage && !conversations.isFetchingNextPage)
  );

  const items = conversations.data?.pages.flatMap((page) => page.items) ?? [];
  // The TAB is server-side; only the search box narrows what came back.
  const shown = visibleConversations(items, "all", query);
  const answering = requests.accept.isPending || requests.decline.isPending;

  return (
    <>
      {/*
        NO ColumnHeader, and this is the one column surface that goes without
        one — the convention in CLAUDE.md is stated for the routes that need a
        title bar over a list, and node 15:1302 deliberately does not give the
        inbox one. The breadcrumb above already reads "Ark Ecosystem/ Chat"
        with the leaf in white, so a second "Messages" heading inside the
        column was the page saying its own name twice and cost 24px of the
        room the list wants.

        `ColumnHeader` is still imported by the signed-out branch below, which
        has no list to head and does need to say where you are.

        THE FILE'S VERTICAL RHYTHM, which is why the padding is spelled out
        rather than left to gap-6 everywhere: search at y=24, tabs at y=86,
        list at y=148 — 24px of air above the search and 24 between each of
        the three blocks, inside 24px gutters on a 464 column (416 of content).
      */}
      <div className="flex flex-col gap-6 px-6 pt-6">
        <InboxSearch value={query} onChange={setQuery} />
        <InboxFilters
          value={tab}
          onChange={(next) => {
            setTab(next);
            // A search typed against one tab means nothing in another, and
            // leaving it set makes the new tab look empty for no visible
            // reason.
            setQuery("");
          }}
          pendingCount={conversations.data?.pages[0]?.pendingRequests ?? 0}
        />
      </div>

      {/* 24 from the tabs, 16 between rows — the file's `gap: 16px` on the
          list frame. The bottom padding clears the `+` so the last row is
          never sitting underneath it. */}
      <div className="flex flex-col gap-4 px-6 pb-28 pt-6">
        {conversations.isPending && [0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}

        {/* On a GLOBAL outage the connection banner already says it — so the
            inbox stays quiet rather than stacking a second, alarming box in the
            middle of the list. Any OTHER failure gets one calm inline line, not
            the full bordered panel (ogazboiz, 2026-09-30). */}
        {conversations.isError && !outage && (
          <ErrorState
            quiet
            error={conversations.error}
            fallback="Couldn't load your messages."
            onRetry={() => conversations.refetch()}
          />
        )}

        {conversations.isSuccess && items.length === 0 && (
          // Each tab says what IT is empty of. "No conversations yet" under
          // Gist Requests would read as an inbox problem rather than the good
          // news that nobody is waiting on you.
          <EmptyState
            glyph="◇"
            title={
              tab === "requests"
                ? "No requests"
                : tab === "houses"
                  ? "No houses yet"
                  : tab === "gists"
                    ? "No gists yet"
                    : "No conversations yet"
            }
            body={
              tab === "requests"
                ? "Chats from people who don't follow you land here first."
                : tab === "houses"
                  ? "Press + and create a group to start one."
                  : "Press + to start one, or open someone's profile."
            }
          />
        )}

        {/* A filter or a search that matches nothing is NOT an empty inbox, and
            saying "no conversations yet" there would be a lie the user can
            disprove by clearing the box. */}
        {conversations.isSuccess && items.length > 0 && shown.length === 0 && (
          <EmptyState
            glyph="◇"
            title={query.trim() ? "No matches" : "Nothing unread"}
            body={
              query.trim()
                ? "No conversation matches that search."
                : "Every conversation here has been read."
            }
          />
        )}

        {shown.map((conversation) => (
          <div key={conversation.id} className="flex flex-col gap-2">
            <ConversationRow
              conversation={conversation}
              meId={me.data?.id}
              selected={conversation.id === selectedId}
              onOpen={() => onOpen(conversation)}
            />
            {/*
              A request you cannot answer is just a row. Accept and decline are
              the whole point of the tab, so they are ON the row rather than
              behind opening it — and only where the SERVICE says the caller may
              act: `requestedBy` is the person who asked, and only the other
              side may answer.
            */}
            {/*
              TWO DIFFERENT ANIMALS SHARE THIS TAB — see `answerable`.

              AND THE BUTTONS SAY WHICH ONE THEY ARE ON. "Accept" is right for a
              chat request, where accepting opens a thread with one person. It
              is wrong on a house: accepting there puts you IN a room with
              strangers who can see you from then on, and a label that hides
              that is the consent problem this whole tab exists to fix
              (ogazboiz, 2026-09-23: "so people wont just be added... maybe just
              like the way whatsapp does it"). "Join house" names the thing that
              actually happens, which is the whole point of asking first.
            */}
            {tab === "requests" && answerable(conversation, me.data?.id) && (
              <div className="flex flex-col gap-2 pl-16.5">
                {/*
                  WHO ADDED YOU, ON THE ROW, BEFORE YOU ANSWER.

                  Which house is already on the row above. This is the other
                  half of the question, and it is the half that decides the
                  answer: recognising the person is why you join, and not
                  recognising them is why the gate exists at all.

                  The name is a LINK, because "who is this?" is a question you
                  answer by looking, not by guessing from a name — and looking
                  before accepting is the entire point of being asked.

                  A null inviter is not an error and not a missing field: you
                  joined a public house yourself, or the membership predates the
                  gate. The line then says what happened without naming anybody,
                  rather than disappearing — it is still the sentence that
                  explains why this row is here.
                */}
                {conversation.kind === "group" && (
                  <p className="text-[12px] leading-4 text-white/55">
                    {conversation.invitedBy ? (
                      <>
                        <Link
                          href={sq(profileHref(conversation.invitedBy))} prefetch={false}
                          className="ws-press font-semibold text-white/80 hover:underline"
                        >
                          {conversation.invitedBy.displayName || conversation.invitedBy.username}
                        </Link>{" "}
                        added you to this house
                      </>
                    ) : (
                      "You were added to this house"
                    )}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={answering}
                    onClick={() => requests.accept.mutate(conversation.id)}
                    className="ws-press rounded-full bg-spotlight px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {conversation.kind === "group" ? "Join house" : "Accept"}
                  </button>
                  <button
                    type="button"
                    disabled={answering}
                    onClick={() => requests.decline.mutate(conversation.id)}
                    // One word, two outcomes, and each is the honest one for its
                    // kind: declining a DM DELETES the thread and tells the
                    // sender nothing, while declining a house gives back only
                    // the seat and leaves the house untouched. The title says
                    // which, because the button cannot.
                    title={
                      conversation.kind === "group"
                        ? "You won't join. Nobody in the house is told."
                        : "This removes the request. The sender isn't told."
                    }
                    className="ws-press rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-semibold text-white/70 transition-colors hover:text-white disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        <div ref={sentinel} />
        {conversations.isFetchingNextPage && (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6 text-meta" />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The inbox column's own create button.
 *
 * It is NOT the shell's `CreateFab`, and the difference is the point. The
 * shell's floating `+` writes a POST and holds the right edge of the VIEWPORT
 * — on this route that puts it over the thread pane, beside a composer, where
 * a `+` means "send this message". The file draws its `+` inside the 464
 * column instead (right edge flush with the column's border, 12px of padding
 * inside a 76.79 hit frame), and in a conversation list a `+` means one thing:
 * start a new one.
 *
 * `allowsCompose` therefore excludes `/messages`, so exactly one purple circle
 * is on screen and it does the thing its position implies.
 *
 * Geometry and paint are the file's, with one deliberate reuse: the circle is
 * 52.79487px inside 12px of padding as node 24:6372 draws it, but the gradient
 * comes from `ws-btn-fab` rather than this node's `201deg 13%→100%`. Both
 * describe the same object with the same two stops of the same purple ramp
 * (`--color-spotlight` → `--color-spotlight-chip-ink`); shipping a second
 * angle for the same button is how one control ends up with two paints.
 */
function NewChatFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="New chat"
      // ABSOLUTE against the column, and mounted as a SIBLING of the column's
      // scroller rather than inside it — an absolute child of a scroll box
      // scrolls away with the content, and `fixed` would put it back on the
      // viewport's edge, which is the placement this exists to avoid.
      //
      // 12px from the column's right border and 12 from its bottom: the file's
      // own inset, expressed there as 12px of padding on every side of the
      // 76.79 hit frame around the 52.79 circle.
      className="ws-btn-fab ws-press absolute bottom-3 right-3 z-20 flex h-[52.79487px] w-[52.79487px] items-center justify-center rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.6)] transition-opacity hover:opacity-90"
    >
        {/* The file's `ci:add-plus`: a 24px box with a 12px cross stroked at
            2px. Drawn rather than typed, because the glyph "+" is centred on
            its own metrics and lands high in a circle this size. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="h-6 w-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <path d="M12 6v12M6 12h12" />
      </svg>
    </button>
  );
}

/**
 * MAY THIS ROW BE ANSWERED HERE, AND IS IT SAFE TO?
 *
 * The requests tab now holds two different animals.
 *
 *   · A CHAT REQUEST — the CONVERSATION itself is pending. Accept flips the
 *     thread; decline DELETES it and every message in it, deliberately,
 *     because for a DM the whole thread is the request.
 *   · A HOUSE INVITE — the conversation is an ordinary, accepted group. What
 *     is pending is MY SEAT in it. Decline removes the seat and nothing else:
 *     the house, its history and everybody else stay exactly as they were.
 *
 * `requestState` DOES NOT TELL THEM APART. On a house invite it reads
 * `accepted`, because the house is accepted — so a renderer that switches on
 * it sends a house down the DM path, where decline deletes the house for
 * everyone. The discriminator is `kind`.
 *
 * ─── WHY THE GROUP BRANCH CANNOT FIRE BEFORE THE SERVICE IS READY ────────────
 * The seat-level accept and decline ship with the service's own change. Until
 * that deploys, its requests filter returns pending CONVERSATIONS only, so no
 * group can appear in this tab at all and this branch is unreachable. And a
 * group that somehow did arrive carrying `requestState: "pending"` is not a
 * seat invite — it is something older that the seat-level decline does not
 * understand — so it is refused here rather than answered into the route that
 * would take the house down. No deploy ordering, and no window where the
 * destructive path is reachable from a house.
 */
function answerable(
  conversation: { kind: string; requestState?: string; requestedBy?: string | null },
  viewerId: string | undefined
): boolean {
  if (conversation.kind === "direct") {
    return conversation.requestState === "pending" && conversation.requestedBy !== viewerId;
  }
  return conversation.requestState !== "pending";
}

export function MessagesPage({
  /** The people picker for the column's `+` — see NewChatPickerProps. */
  renderNewChat,
  /**
   * The gist-room composer, opened by a GROUP thread's "Create Gist Room".
   * Passed in for the same reason the picker is: it belongs to the houses
   * slice, and slices never import each other.
   */
  renderGistRoom,
  /**
   * The designed card for a gist-room announcement in a thread (node 225:3873).
   * It reads the room, the shared topic vocabulary and this group's roster —
   * three slices — so the layout composes it and hands it down.
   */
  renderRoomCard,
  /**
   * Block and Report inside a 1:1 thread's overflow menu (node 77:8287). The
   * profile slice owns both, so the layout draws the rows and this hands them
   * down.
   */
  renderThreadSafety,
  /**
   * The people picker behind "Add / Invite gist partners" (78:8527, 78:8345).
   * Choosing a person is the DISCOVERY slice's directory, which is the same
   * reason the inbox's own `+` takes a slot.
   */
  renderAddMembers,
}: {
  renderNewChat?: (props: NewChatPickerProps) => React.ReactNode;
  renderGistRoom?: (props: {
    open: boolean;
    onClose: () => void;
    /** The group the room is being opened from — what makes Private possible. */
    houseConversationId?: string;
  }) => React.ReactNode;
  renderRoomCard?: (props: { streamId: string; conversationId: string }) => React.ReactNode;
  renderThreadSafety?: (peer: Profile) => React.ReactNode;
  renderAddMembers?: (props: {
    open: boolean;
    onClose: () => void;
    conversationId: string;
  }) => React.ReactNode;
} = {}) {
  const { ready, authenticated, login } = useAuth();
  const [picked, setPicked] = useState<Conversation | null>(null);

  /*
    A THREAD CAN BE LINKED TO — `/messages?c=<id>`.

    Which thread is open was React state and nothing else, so nothing outside
    this component could ask for one. The profile's Message button therefore
    created the conversation and then sent the reader to `/messages`, the
    INBOX, leaving them to find the person they had just pressed Message on.
    That is what ogazboiz reported as the button "not opening a conversation":
    it did open one, and then showed a list.

    Read through `useQueryParam`, never `useSearchParams` — that one forces a
    Suspense boundary which delays hydration of this subtree.

    The conversation itself comes from the INBOX's own cache: the same query
    key, so this shares the list rather than fetching a second copy, and a
    thread just created by `POST /conversations` is at the head of it after the
    invalidation that mutation already does. There is no `GET /conversations/
    :id` on the contract, so the list is the only place to find it.
  */
  const wanted = useQueryParam("c");
  const inbox = useConversations("all");
  /*
    DERIVED, not set in an effect. Calling `setState` synchronously from an
    effect makes React render twice for one input and lint refuses it — so the
    linked thread is simply part of what "which thread is open" MEANS, rather
    than something copied into state after the fact.

    `picked` is a thread the reader tapped. The parameter supplies one until
    they have. Closing a linked thread sets `picked` to null and the parameter
    is already gone by then (see below), so it cannot spring back open.
  */
  /*
    The thread the reader JUST opened, from where `useOpenConversation` stored
    it. `skipToken` means this never fetches — there is no endpoint to fetch
    from — it only subscribes to what the mutation wrote.

    The inbox lookup above cannot be the only source: a thread you start with
    someone who does not follow you is created PENDING with you as the
    requester, and this lookup searches ALL, which is accepted-only. The thread
    is in the Gist Requests list — this link just does not search there. See
    lib/open-conversation.
    The inbox still wins when it has the thread, since its row is the fuller
    one — peer, preview and unread count.
  */
  const opened = useQuery<Conversation>({
    queryKey: openedConversationKey(wanted ?? ""),
    queryFn: skipToken,
  });
  const linked =
    wanted && !picked
      ? ((inbox.data?.pages.flatMap((page) => page.items) ?? []).find(
          (conversation) => conversation.id === wanted
        ) ??
        opened.data ??
        null)
      : null;
  const open = picked ?? linked;

  /*
    Drop the parameter once it has been used — and only then, or a reload
    before the inbox arrives would lose the thread. No state is touched here,
    so this cannot cascade.

    `replaceState`, not a push: the reader came from a profile, and Back
    should return them to that profile rather than to this page with the
    thread reopening under them.
  */
  useEffect(() => {
    if (!linked) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("c");
    window.history.replaceState(null, "", url.toString());
  }, [linked]);
  // Tell the shell a thread is open so the dock leaves the composer alone —
  // see lib/chat-open-store. Cleared on close and on leaving the page.
  useEffect(() => {
    setChatOpen(open !== null);
    return () => setChatOpen(false);
  }, [open]);
  // The `+` opens a MENU first — node 24:6403 — and the menu chooses which
  // picker. Null means neither is open.
  const [menuOpen, setMenuOpen] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [picking, setPicking] = useState<NewChatMode | null>(null);
  // The gist-room composer lives in the houses slice, so the layout supplies
  // it; this only owns whether it is open. Same slot pattern as the picker.
  const [gistRoomOpen, setGistRoomOpen] = useState(false);

  if (ready && !authenticated) {
    return (
      <>
        <ColumnHeader title="Chat" />
        <div className="p-4">
          <EmptyState
            glyph="◇"
            title="Sign in to read your messages"
            body="Conversations follow your account across the square."
            action={
              <button
                onClick={login}
                className="ws-btn-silver ws-press ws-btn-md rounded-full font-bold"
              >
                Sign in
              </button>
            }
          />
        </div>
      </>
    );
  }

  return (
    /*
      Two panes on a desktop, one at a time on a phone.

      The list is a fixed 464 because that is what node 15:1302 fixes it at —
      416 of content inside 24px gutters, widened from the 395/347 of the
      earlier frame — and a conversation list that reflows with the window
      makes the previews rewrap on every drag. The thread takes whatever is
      left.

      On a phone the list gives way to the thread entirely, which is why the
      route is only wide at its exact path.

      HEIGHT. Messages is the one route that does not scroll as a page. It
      claims exactly the room the shell leaves — the viewport less the mobile
      top strip, the mobile tab bar and the desktop breadcrumb bar — and then
      each pane scrolls inside itself. That is what lets the chat pane pin its
      header and its composer and move only the messages between them. Without
      the bound, both panes grow to fit their content and the whole document
      scrolls instead.

      `--ws-crumb-h` is the third term and was missing: the breadcrumb is 0 on
      a phone but 76px from md up, so on every desktop the two panes ran 76px
      past the bottom of the window and the document scrolled by exactly that
      much — which is also why the composer could not be reached without
      scrolling a pane that was supposed to be pinned.
    */
    <div
      className={cn(
        "flex overflow-hidden",
        // With a thread open the dock is hidden (lib/chat-open-store) and its
        // `--ws-nav-h` must NOT be subtracted, or the composer floats a dock's
        // height above the screen's foot. The inbox alone keeps the dock and
        // the reservation.
        // `--ws-vvh` is the visual viewport — literally what is on the glass,
        // with the URL bar AND the keyboard already accounted for. It replaces
        // `100dvh` rather than adjusting it: `dvh` tracks a URL bar that
        // slides, so a pane sized in it is short or long by the bar's height
        // between recomputations, which is the dead band under the composer
        // and the vertical scroll that should not exist. `100dvh` remains the
        // fallback for a browser with no visualViewport, where it is right
        // anyway. See hooks/use-keyboard-inset.ts.
        open
          ? "h-[calc(var(--ws-vvh,100dvh)-var(--ws-topbar-h)-var(--ws-crumb-h))]"
          : "h-[calc(var(--ws-vvh,100dvh)-var(--ws-topbar-h)-var(--ws-crumb-h)-var(--ws-nav-h))]"
      )}
    >
      <div
        className={cn(
          // `relative` so the `+` can be positioned against the COLUMN. It is
          // the wrapper that is relative, not the scroller, because an
          // absolute child of a scroll box scrolls with the content.
          "relative w-full shrink-0 lg:w-[464px] lg:border-r lg:border-white/10",
          open && "hidden lg:block"
        )}
      >
        <div
          // The scroller, so a long inbox does not drag the chat pane with it.
          // `--ws-topbar-h` is reset to 0 inside: it exists to hold sticky
          // children clear of the shell's FIXED top strip, and this box already
          // starts below that strip, so the offset would push the inbox header
          // 48px down its own scroll box on a phone.
          className="h-full overflow-y-auto [--ws-topbar-h:0px]"
        >
          <Inbox onOpen={setPicked} selectedId={open?.id} />
        </div>

        {renderNewChat && (
          <>
            <NewChatFab onClick={() => setMenuOpen((wasOpen) => !wasOpen)} />
            <NewChatMenu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              onNewGist={() => setPicking("gist")}
              onCreateGroup={() => setPicking("group")}
            />
          </>
        )}
      </div>

      {/* `min-h-0` so the chat pane can be shorter than its content and scroll
          internally rather than stretching this row. */}
      {/* QA: the composer's band stopped short with nothing marking where the
          column ends. X closes its conversation column with a hairline, so this
          one does too — from lg, where the page can be narrower than the screen. */}
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col lg:border-r lg:border-white/10", !open && "hidden lg:flex")}>
        {open ? (
          <Thread
            conversation={open}
            onBack={() => setPicked(null)}
            // Only offered when the layout actually supplied a composer.
            onCreateGistRoom={renderGistRoom ? () => setGistRoomOpen(true) : undefined}
            // The announcement card, bound to the thread it is being read in —
            // the card needs the group as well as the room.
            roomCardSlot={
              renderRoomCard
                ? (streamId) => renderRoomCard({ streamId, conversationId: open.id })
                : undefined
            }
            safetyRowsSlot={renderThreadSafety}
            onAddMembers={renderAddMembers ? () => setAddingMembers(true) : undefined}
          />
        ) : (
          <ThreadPlaceholder />
        )}
      </div>

      {open?.kind === "group" &&
        renderAddMembers?.({
          open: addingMembers,
          onClose: () => setAddingMembers(false),
          conversationId: open.id,
        })}

      {renderGistRoom?.({
        open: gistRoomOpen,
        onClose: () => setGistRoomOpen(false),
        // Only a GROUP thread offers the button, so this is always a house
        // group — which is exactly what a private room needs to be private to.
        houseConversationId: open?.kind === "group" ? open.id : undefined,
      })}

      {renderNewChat?.({
        open: picking !== null,
        // `gist` while closed is arbitrary and never read — the panel is only
        // rendered when `open`, and defaulting keeps the prop non-optional so
        // a caller cannot forget it.
        mode: picking ?? "gist",
        onClose: () => setPicking(null),
        onStarted: (conversation) => {
          setPicking(null);
          setPicked(conversation);
        },
      })}
    </div>
  );
}

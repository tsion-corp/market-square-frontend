"use client";

import { friendsMomentFor } from "@/lib/friends-popup";
import { notificationHref } from "@/lib/notification-href";
import { openFriendsCard } from "@/lib/friends-card-store";
import { useState } from "react";
import Link from "next/link";
import { inboxTime } from "@/lib/inbox-time";
import { cn } from "@/lib/cn";
import { useAuth } from "@/hooks/use-auth";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { Avatar } from "@/components/ui/avatar";
import { IconLive, IconMic, IconQuote } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/button";
import { RowSkeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import {
  useMarkNotificationsRead,
  useNotifications,
} from "@/features/notifications/hooks/use-notifications";
import {
  NOTIFICATION_GROUPS,
  type MarketNotification,
  type NotificationGroup,
} from "@/features/notifications/lib/types";
import { GROUP_LABEL } from "@/lib/notification-groups";
import { asset } from "@/lib/square-path";

/**
 * ONE GLYPH PER KIND, AND EVERY ONE IS THE FILE'S OWN — node 742:15341.
 *
 * The row does NOT lead with the actor's photograph. It leads with a 48px disc
 * on 10% white holding a KIND glyph, which is easy to miss because the disc's
 * layer in the file is named after a person ("Fatima Bello") while its only
 * child is a vector group. Checked the child rather than assuming a face went
 * there.
 *
 * These were dingbats — "◎", "♥", "⇄" — standing in for art nobody had
 * exported. They are exported now, from this node, as real SVGs in
 * `public/notifications/`. Multi-colour art keeps its own fills (the wink is a
 * two-tone gradient with `#7E3BEB` and `#6F23EB` accents), so these are files
 * rather than `currentColor` icon components.
 *
 * WHAT THE FILE DRAWS, AND WHAT IT DOES NOT. It gives five glyphs — a wink, a
 * follow, a trending mark, a mention and a post. Our contract has eleven kinds.
 * The extra ones are mapped to the file's own art by what they are ABOUT rather
 * than given invented glyphs: everything that happens to a post takes the post
 * mark, and the two money kinds take the coin already exported for the earnings
 * panel. The two admin resolutions get no glyph at all — there is none in the
 * file and none of the five means "an operator answered you" — so those rows
 * fall back to the actor's avatar, which is at least true.
 */
/**
 * The glyph beside a subject line, chosen by the SERVICE's `kind`.
 *
 * A gist room is a stream with category 'house', and the service draws that
 * distinction on purpose so the client does not infer it: a room is audio and
 * keeps the mic, a broadcast gets the live mark, and a post gets the quote
 * because a post's "title" IS its opening text.
 */
const SOURCE_ICON = { room: IconMic, stream: IconLive, post: IconQuote } as const;

const GLYPHS: Partial<Record<MarketNotification["kind"], string>> = {
  post_announced: asset("/notifications/notif-mention.svg"),
  wink: asset("/notifications/notif-wink.svg"),
  follow: asset("/notifications/notif-follow.svg"),
  stream_live: asset("/notifications/notif-trending.svg"),
  comment: asset("/notifications/notif-mention.svg"),
  // A reply to your comment is the same conversation mark as a comment.
  comment_reply: asset("/notifications/notif-mention.svg"),
  // The file's own "Mentioned in…" mark, on the event it was drawn for.
  mention: asset("/notifications/notif-mention.svg"),
  like: asset("/notifications/notif-post.svg"),
  // The same mark the post like row carries — a like is one identity.
  comment_like: asset("/notifications/notif-post.svg"),
  repost: asset("/notifications/notif-post.svg"),
  bookmark: asset("/notifications/notif-post.svg"),
  tip_received: asset("/gifts/coin-stack.svg"),
  // THE MONEY MARK, not a gift. The payload names no `giftId`, so any of
  // the fourteen gift images would be this row claiming a gift nobody
  // chose — the same rule the body copy follows.
  gift_received: asset("/gifts/coin-stack.svg"),
  ticket_purchased: asset("/gifts/coin-stack.svg"),
  // Chat-shaped events take the file's mention mark, which is the glyph it
  // draws on "Mentioned in Gistroom chat".
  message: asset("/notifications/notif-mention.svg"),
  chat_request: asset("/notifications/notif-mention.svg"),
  // Being added to a house is a fact about people, not about a post.
  group_added: asset("/notifications/notif-follow.svg"),
  // A raised hand belongs to a live room, so it takes the trending mark.
  speaker_request: asset("/notifications/notif-trending.svg"),
  // A room opening in a house is a live room, like a raised hand.
  house_room: asset("/notifications/notif-trending.svg"),
  // An invitation to a private room is a live room too, so it takes the same
  // mark rather than the follow glyph — being invited somewhere is not a fact
  // about people the way a follow or a house add is.
  room_invite: asset("/notifications/notif-trending.svg"),
};

/**
 * THE ROW IS A TITLE AND A BODY, not one sentence — 742:15859 and 742:15860.
 *
 * A bold 16/16 headline that says what KIND of thing happened, then a 14/16.5
 * line at 50% white that says who and what. The old row was a single "{name}
 * followed you" string, which is the same information with none of the
 * scanning value: the headline is what lets somebody read a column of these
 * without reading any of them.
 *
 * The file's own copy is used verbatim where it gives it — "Someone is
 * interested in you!", "New Follower", "Happening Now! 🔥" — because the
 * wording IS the design. The rest is written in the same voice, and the two
 * standing rules survive: a wink says what happened and never what it obliges,
 * and a tip says what arrived rather than what it was worth, because the
 * payload carries no amount.
 */
function headline(item: MarketNotification): string {
  switch (item.kind) {
    case "wink":
      return "Someone is interested in you!";
    case "follow":
      return "New Follower";
    case "stream_live":
      return "Happening Now! 🔥";
    case "comment":
      return "New comment";
    case "comment_reply":
      return "New reply";
    case "mention":
      return "Mentioned you";
    case "like":
    case "comment_like":
      return "New like";
    case "repost":
      return "Reposted";
    case "bookmark":
      return "Saved to Arkmarks";
    case "tip_received":
      return "You were tipped";
    case "gift_received":
      return "You were sent a gift";
    case "ticket_purchased":
      return "Ticket sold";
    case "verification_resolved":
      return "Verification resolved";
    case "role_resolved":
      return "Role resolved";
    case "message":
      /*
        A GROUP MESSAGE IS NOT A DIRECT MESSAGE, and the headline is where the
        difference is cheapest to read. Falls back to "New message" while the
        service sends no conversation — which is today — so this reads no worse
        than it did and better the moment the field lands.
      */
      return item.conversation?.kind === "group" ? "New group message" : "New message";
    case "chat_request":
      return "Message request";
    case "group_added":
      return "Added to a house";
    case "speaker_request":
      return "Speaker request";
    case "house_room":
      return "Gist room opened";
    case "room_invite":
      // "Invited" rather than "Room invite": the headline says what somebody
      // DID, the way every other line in this list does.
      return "Invited to a room";
    case "post_announced":
      // Present tense, and it says what is happening. "Featured" reads like a
      // prize and hides the thing the author most needs to understand: that it
      // is happening now, and to everybody.
      return "Your post is being shown to everyone on Market Square";
  }
}

// The service sends structured events, not prose — the copy lives here so it
// stays in the product's voice.
function describe(item: MarketNotification): string {
  const who = item.actor?.displayName || item.actor?.username || "Someone";
  switch (item.kind) {
    case "follow":
      return `${who} started following you on Square.`;
    case "like":
      return `${who} liked your post.`;
    case "comment_like":
      return `${who} liked your comment.`;
    case "comment":
      return `${who} commented on your post.`;
    case "comment_reply":
      return `${who} replied to your comment.`;
    case "mention":
      /*
        SAY WHERE, when the where is a private group.

        `mention` covers four surfaces — a post, a comment, a stream and a
        GROUP CHAT — and printed one sentence for all of them. Being named in
        a room of forty people and being named in a public post are not the
        same event, and the reader could not tell which had happened.

        Same three states as `message`, and the same reason: an absent
        conversation keeps the original sentence rather than guessing.
      */
      if (item.conversation?.kind === "group") {
        return item.conversation.title
          ? `${who} mentioned you in ${item.conversation.title}.`
          : `${who} mentioned you in a group you are in.`;
      }
      return `${who} mentioned you.`;
    case "repost":
      return `${who} reposted your post.`;
    case "bookmark":
      return `${who} saved your post to their Arkmarks.`;
    case "ticket_purchased":
      return `${who} bought a ticket to your stream.`;
    case "tip_received":
      // What ARRIVED, not what it was worth. The notification payload carries
      // no amount or gift, so this says the true general thing and the tips
      // list (Earnings) carries the detail.
      return `${who} sent you a tip.`;
    case "gift_received":
      // WHAT ARRIVED, NOT WHICH GIFT. The payload carries the sender, the
      // room and nothing else — no `giftId` and no amount — so naming a
      // gift here would be inventing one. Earnings carries the detail, the
      // way it does for a tip.
      return `${who} sent you a gift.`;
    case "wink":
      // Says what happened and nothing about what it obliges. A wink is an
      // opening, not a request, and copy that implies otherwise ("wants to
      // meet you") puts the recipient on a spot they did not step onto.
      return `${who} just winked at you. Wink back at them now to kick things off.`;
    case "stream_live":
      return `${who} is live right now. Tune in.`;
    case "verification_resolved":
      return "Your verification request has been resolved.";
    case "role_resolved":
      return "Your role request has been resolved.";
    case "message":
      /*
        NAME THE ROOM WHERE THERE IS ONE. "Ada sent you a message" printed for
        a room of forty people is not a small imprecision: "you" is the claim
        that nobody else saw it, and a reader answering a group as though it
        were private is a real way to be embarrassed by an interface.

        Three states, not two. A named group names itself; a group whose title
        the reader may no longer see still says it was a group; and no
        conversation at all keeps the original sentence rather than guessing.
      */
      if (item.conversation?.kind === "group") {
        return item.conversation.title
          ? `${who} messaged ${item.conversation.title}.`
          : `${who} sent a message to a group you are in.`;
      }
      return `${who} sent you a message.`;
    case "chat_request":
      // A request is not yet a conversation, and the copy must not imply the
      // reader has agreed to one.
      return `${who} wants to start a chat with you.`;
    case "group_added":
      return `${who} added you to a house.`;
    case "speaker_request":
      return `${who} asked to speak in your room.`;
    case "house_room":
      // The house's current name when the service can say it; otherwise the
      // copy does not guess which one.
      return item.house?.title
        ? `${who} opened a gist room in ${item.house.title}.`
        : `${who} opened a gist room in one of your houses.`;
    /*
      A PRIVATE ROOM IS REACHABLE ONLY BY ITS GUEST LIST, so this is not a
      courtesy — it is the only way the person learns they can go in at all.
      Twice tonight somebody was invited and found out over WhatsApp.

      It names WHO invited them, because that is the question somebody actually
      has about an invitation to somewhere private, and it is the difference
      between accepting because you recognise the person and accepting because
      the room looked fine.
    */
    case "room_invite":
      return `${who} invited you to a private room.`;
    case "post_announced":
      // No `who`: this row deliberately carries no actor, so naming one would
      // invent a person. It reads as coming from Market Square.
      return "An admin is showing your post to everyone on Square right now.";
  }
}

// Where a notification points. Nulls are real — a like on a deleted post has
// no post to open — so the row stays unclickable rather than linking nowhere.

/**
 * The destination is decided in `lib/notification-href.ts`, not here.
 *
 * It used to be inline, and being inline is why it shipped sending every
 * `house_room` row to `/live/` — a gist room IS a stream, so the one-line
 * `if (item.streamId)` swallowed rooms and broadcasts alike. A decision that
 * cannot be run without a browser is a decision nobody checks; `node --test`
 * pins this one.
 */
function hrefFor(item: MarketNotification): string | null {
  return notificationHref(item);
}

function Row({
  item,
  onMarkRead,
  actionSlot,
}: {
  item: MarketNotification;
  onMarkRead: (id: string) => void;
  actionSlot?: (item: MarketNotification) => React.ReactNode;
}) {
  const href = hrefFor(item);
  const unread = !item.readAt;
  const glyph = GLYPHS[item.kind];
  const action = actionSlot?.(item);

  const body = (
    <>
      {/* 742:15857 — 48 at a full round on 10% white. The glyph is the file's
          own art; where the file draws none, the actor's face stands in. */}
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10">
        {glyph ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={glyph} alt="" aria-hidden className="h-6 w-6" />
        ) : item.actor ? (
          <Avatar
            name={item.actor.displayName || item.actor.username}
            seed={item.actor.id}
            src={item.actor.avatarUrl}
            size={48}
          />
        ) : null}
      </span>

      {/* 742:15858 — 8 between the headline and the line under it. */}
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="truncate text-[16px] font-bold leading-4 text-white">
          {headline(item)}
        </span>
        <span className="line-clamp-2 text-[14px] leading-[16.5px] text-white/50">
          {describe(item)}
        </span>

        {/*
          742:27602 — what the row is ABOUT, when it is about a thing.

          Absent for a row about a PERSON (follow, wink, message), and absent
          when the thing has no words to show — a picture-only post, a room
          with no topic. Never a fallback to the id or to "a post": the file's
          line names the subject or it is not there. Already truncated to 140
          upstream, so `truncate` here is for the column, not the text.
        */}
        {item.subject?.title && (
          <span className="flex min-w-0 items-center gap-2">
            {(() => {
              const Glyph = SOURCE_ICON[item.subject.kind];
              return <Glyph className="h-3 w-3 shrink-0 text-white" />;
            })()}
            <span className="truncate text-[12px] leading-4 text-white/50">
              {item.subject.title}
            </span>
          </span>
        )}
      </span>

      {/* 742:15884 — the action and the stamp, 16 apart, held at the right.
          The stamp is `inboxTime`, not `relativeTime`: the file shows "11:39",
          "Yesterday", "2d", "3d" — a clock inside today and an age past it,
          which is exactly what that helper already produces for the inbox. */}
      <span className="flex shrink-0 items-center gap-4">
        {action}
        {item.createdAt && (
          <time
            dateTime={item.createdAt}
            className="shrink-0 text-[10px] leading-[15px] text-white/50"
          >
            {inboxTime(item.createdAt)}
          </time>
        )}
        {/* The unread dot is the per-row acknowledgement. `useMarkNotificationsRead`
            has always taken ids; the UI only ever passed `undefined`, so a reader
            could clear everything or nothing. */}
        {unread && (
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onMarkRead(item.id);
            }}
            aria-label="Mark as read"
            title="Mark as read"
            className="ws-press shrink-0 rounded-full p-1.5 transition-colors hover:bg-white/10"
          >
            <span className="block h-2 w-2 rounded-full bg-create" />
          </button>
        )}
      </span>
    </>
  );

  /* 742:15855 — 97 tall, 32 in from the left, 16 between the three groups, and
     NO divider: the rows are separated by an unread wash and nothing else. An
     unread row is `#FFFFFF` at 3%; a read one has no fill at all. */
  const className = cn(
    "flex min-h-[97px] items-center gap-4 px-8 py-6 transition-colors",
    unread ? "bg-white/[0.03] hover:bg-white/[0.06]" : "hover:bg-white/[0.03]"
  );

  /*
    A WINK OR A FOLLOW-BACK OPENS ITS CARD — the same card the popup shows on
    entering, read or not, rather than the person's profile. A tap on the row's
    own controls (Wink back, Follow back, the unread dot) stays theirs, which
    is why this is a div that ignores clicks from inside a button or a link
    rather than a button wrapped around buttons. A one-way follow is not a
    moment and still opens the profile.
  */
  const moment = item.actor
    ? friendsMomentFor({ id: item.id, kind: item.kind, readAt: item.readAt ?? null, actor: item.actor })
    : null;
  if (moment) {
    const open = () => {
      openFriendsCard(moment);
      if (unread) onMarkRead(item.id);
    };
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${headline(item)}: open the card`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a")) return;
          open();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        className={cn(className, "cursor-pointer")}
      >
        {body}
      </div>
    );
  }

  if (!href) return <div className={className}>{body}</div>;
  /*
    TAPPING THE ROW IS WHAT READS IT.

    This `<Link>` acknowledged nothing — it navigated and left the row unread,
    and the page-level effect that marked EVERYTHING read on mount was quietly
    covering for that. With the effect gone, the ordinary act of opening a
    notification has to be the thing that clears it, or nothing ever would.

    `onClick` rather than anything cleverer: it fires on a keyboard activation
    as well as a pointer one, and the mutation is fire-and-forget — the reader
    is already on their way to the destination and must never wait on it.
  */
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (unread) onMarkRead(item.id);
      }}
    >
      {body}
    </Link>
  );
}

export function NotificationsPage({
  actionSlot,
}: {
  /**
   * The per-row action — "Wink back" (742:15885) and "Follow back"
   * (742:15901). Both are the PROFILE slice's mutations, and slices never
   * import each other, so they arrive through a route slot composed in
   * `components/layout/notifications-screen.tsx`.
   */
  actionSlot?: (item: MarketNotification) => React.ReactNode;
} = {}) {
  const { ready, authenticated, login } = useAuth();
  /* Omitted entirely for "everything" — the enum has no `all`. */
  const [group, setGroup] = useState<NotificationGroup | "">("");
  /*
    READ / UNREAD is a CLIENT filter on `readAt`, not a query parameter.
    `GET /me/notifications` takes only `group`, `limit` and `cursor`; every row
    already carries `readAt` (null = unread), so the split is applied to the
    loaded rows here. If the service later grows a `status` parameter this should
    move onto the query for correct paging — same note as `group` before it
    shipped.
  */
  const [status, setStatus] = useState<"all" | "unread" | "read">("all");
  // POLLS, because this IS the list the reader is looking at — the one place
  // a 30s interval on notifications is the reader's own expectation rather
  // than a background cost they cannot see. See the hook.
  const notifications = useNotifications(group || undefined, true);
  const markRead = useMarkNotificationsRead();
  const sentinel = useInfiniteScroll(
    () => notifications.fetchNextPage(),
    Boolean(notifications.hasNextPage && !notifications.isFetchingNextPage)
  );

  const items = notifications.data?.pages.flatMap((page) => page.items) ?? [];
  // The read/unread split, applied to the loaded rows — see `status`.
  const shown = items.filter((item) =>
    status === "all" ? true : status === "unread" ? !item.readAt : Boolean(item.readAt)
  );
  /*
    GLOBAL, AND NOT THE COUNT FOR THIS TAB. `unreadCount` counts what is
    waiting for the person, not what is on screen — the service does not filter
    it by group, deliberately. It drives the mark-as-read effect below and
    must never be rendered as "N unread in Money", which would empty somebody's
    messages badge because they opened a different bucket.
  */
  const unread = notifications.data?.pages[0]?.unreadCount ?? 0;

  /*
    OPENING THE PAGE IS NOT READING IT.

    This marked EVERYTHING read the moment the surface mounted —
    `markRead.mutate(undefined)`, where undefined means "all of them". So a
    reader who glanced at the top of the list lost every row below the fold
    they had never seen, and the badge said nothing was waiting when plenty
    was. ogazboiz: "i also see the one that i've not actually read i've not
    actually clicked — just the way normal notification actually works".

    He is describing the platform convention, and it is the right one: a
    notification is read when you OPEN it, or when you say so. Arriving at the
    list is neither. Nothing about a row being on screen — or, worse, off it —
    means it was read.

    So mark-on-mount is gone and there are now three ways a row becomes read,
    all of them a deliberate act:
      · tapping the row, which is the ordinary case and did NOT do it before —
        the bulk effect was covering for a `<Link>` that acknowledged nothing;
      · the per-row dot, which has always been there;
      · "Mark all read", which is the bulk action made EXPLICIT rather than a
        side effect of navigation. Without it the badge would have become
        unclearable, which is its own bug.
  */
  const markAllRead = () => {
    if (unread > 0) markRead.mutate(undefined);
  };

  return (
    <>
      {/*
        742:15830 — the page's own head, not a `ColumnHeader`.

        It was `ColumnHeader` with the subtitle "Activity from across the
        square", which the file does not have: node 742:15830 is a
        SPACE_BETWEEN row carrying the title at Geist 500 24/31.2 and a filter
        pill opposite it, and nothing else. The subtitle was ours.
      */}
      <div className="flex items-center justify-between gap-4 px-8 pb-2 pt-6">
        <h1 className="text-[24px] font-medium leading-[31.2px] text-white">Notifications</h1>

        {/*
          THE BULK ACTION, MADE EXPLICIT.

          Clearing everything used to happen as a SIDE EFFECT of arriving at
          the page. It is a real thing to want — it is just not something
          navigation should do on your behalf — so it is a control you press.

          It appears only when there is something to clear, and it counts, so
          pressing it is a decision with a number attached rather than a blind
          sweep. `unreadCount` is global and deliberately not filtered by the
          group tab, so the label says what will actually happen even while a
          bucket is selected.
        */}
        {authenticated && unread > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={markRead.isPending}
            /*
              THE COUNT AND THE ACTION HAVE THE SAME SCOPE, and that is the
              whole safety of this control.

              `unreadCount` is GLOBAL — the service computes it with no group
              argument while filtering the list beside it — and
              `markRead(undefined)` is global too. So on a filtered tab the
              button reads "Mark all read (40)" above three visible rows, and
              it really does clear 40. The number IS the disclosure.

              The failure to avoid is the two drifting apart: a per-tab count
              on a global action would promise three and take forty, which is
              the hazard the mount effect committed silently. The title says
              the scope outright so a reader who has filtered does not have to
              infer it from the mismatch.
            */
            title={
              group
                ? `Clears all ${unread} unread notifications, not only the ones in this filter`
                : `Clears all ${unread} unread notifications`
            }
            className="ws-press ml-auto shrink-0 rounded-full px-3 py-1.5 text-[13px] leading-5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            Mark all read ({unread})
          </button>
        )}

        {/*
          742:15825 — 145x44 at a full round on `#979797` at 5%, the label at
          Geist 500 14/20 and the file's own chevron beside it.

          IT IS A REAL FILTER NOW. It shipped `disabled` because
          `GET /me/notifications` took only `limit` and `cursor`; the service
          has since added `group`, so there is something to switch between and
          the control does what it looks like it does.

          THE BUCKETS ARE THE SERVICE'S, NOT OURS. The client never maps a kind
          to a group — a client-composed mapping silently drops every kind
          added after it ships, which is exactly the failure we hit in the
          other direction when four kinds rendered as follows. The enum has no
          `all` member either: omitting the parameter IS everything, and a
          value meaning the same as sending nothing is a second way to say one
          thing.

          A native `<select>` rather than a popover: it is one control, it is
          keyboard-operable and screen-reader-announced for free, and on a
          phone it opens the platform's own picker. The pill is the styling
          around it.
        */}
        <label className="relative flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-[#979797]/5 px-4 text-[14px] font-medium leading-5 text-white">
          <span className="sr-only">Filter notifications</span>
          <select
            value={group}
            onChange={(event) => setGroup(event.target.value as NotificationGroup | "")}
            className="cursor-pointer appearance-none bg-transparent pr-1 outline-none [&>option]:bg-[#121214]"
          >
            <option value="">All notification</option>
            {NOTIFICATION_GROUPS.map((value) => (
              <option key={value} value={value}>
                {GROUP_LABEL[value]}
              </option>
            ))}
          </select>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/notifications/notif-chevron.svg")}
            alt=""
            aria-hidden
            className="pointer-events-none h-[3.5px] w-[7px] shrink-0"
          />
        </label>
      </div>

      {/*
        READ / UNREAD filter. A segmented control under the head, beside the
        group filter above it: All shows everything, Unread and Read split the
        loaded rows on `readAt`. Kept out of the header row so it does not crowd
        the title, the Mark-all-read count and the group pill already there.
      */}
      {authenticated && (
        <div className="flex items-center gap-1 px-8 pb-2">
          {(["all", "unread", "read"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={cn(
                "ws-press rounded-full px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors",
                status === value ? "bg-white text-ink" : "text-white/60 hover:bg-white/10 hover:text-white"
              )}
            >
              {value}
            </button>
          ))}
        </div>
      )}

      {ready && !authenticated && (
        <div className="p-4">
          <EmptyState
            glyph="○"
            title="Sign in to see your notifications"
            body="Follows, likes and replies land here."
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
      )}

      {authenticated && (
        <>
          {notifications.isPending && [0, 1, 2, 3].map((i) => <RowSkeleton key={i} />)}
          {notifications.isError && (
            <div className="p-4">
              <ErrorState
                error={notifications.error}
                fallback="Couldn't load notifications."
                onRetry={() => notifications.refetch()}
              />
            </div>
          )}
          {notifications.isSuccess && items.length === 0 && (
            <div className="p-4">
              <EmptyState
                glyph="○"
                title="You're all caught up"
                body="Follow creators, products and activities to see updates here."
              />
            </div>
          )}
          {/* There ARE notifications, just none in this read/unread filter — say
              that rather than the "all caught up" state, which would read as an
              empty inbox. */}
          {notifications.isSuccess && items.length > 0 && shown.length === 0 && (
            <div className="p-4">
              <EmptyState
                glyph="○"
                title={status === "unread" ? "No unread notifications" : "No read notifications"}
                body={
                  status === "unread"
                    ? "You're all caught up — nothing unread here."
                    : "Nothing you've read yet shows here."
                }
              />
            </div>
          )}

          {shown.map((item) => (
            <Row
              key={item.id}
              item={item}
              onMarkRead={(id) => markRead.mutate([id])}
              actionSlot={actionSlot}
            />
          ))}

          <div ref={sentinel} />
          {notifications.isFetchingNextPage && (
            <div className="flex justify-center py-6">
              <Spinner className="h-6 w-6 text-meta" />
            </div>
          )}
        </>
      )}
    </>
  );
}

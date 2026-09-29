"use client";

import { useState } from "react";
import type { Post } from "@/lib/api/schemas";
import { useRouter } from "next/navigation";
import { ProfilePage } from "@/features/profile";
import { ProfileHouses } from "@/components/layout/profile-houses";
import { ProfileKashChip } from "@/components/layout/profile-kash-chip";
import { ProfileEarnings } from "@/components/layout/profile-earnings";
import { PostCard, VideoViewer } from "@/features/feed";
import { useOpenConversation } from "@/features/messages";
import { ComposeSheet } from "@/components/layout/compose-sheet";
import { IconProfileSms } from "@/components/ui/profile-icons";
import { ProfileHousesOf } from "@/components/layout/profile-houses-of";
import { ProfileReplays } from "@/components/layout/profile-replays";
import type { Profile } from "@/lib/api/schemas";
import { sq } from "@/lib/square-path";

/**
 * Joins the profile and messages slices, which never import each other.
 *
 * Opening a conversation is idempotent on the service, so this is safe to hit
 * repeatedly — it lands on the existing thread when there is one.
 */
function MessageButton({ profile }: { profile: Profile }) {
  const open = useOpenConversation();
  const router = useRouter();
  return (
    /*
      545:47607 — a 38.37 disc with the file's `sms` glyph at 16. Its fill is
      white at alpha zero and its stroke white at weight ZERO, which renders
      nothing; the render shows Figma's GLASS effect over the photograph —
      translucent, rimmed — which is `ws-glass-clear` (see globals.css for the
      samples). It replaced a labelled secondary Button that the file does not
      draw.
    */
    <button
      type="button"
      aria-label={`Message ${profile.displayName || profile.username}`}
      title="Message"
      disabled={open.isPending}
      /*
        Navigate to the THREAD, not to the inbox. `POST /conversations` is
        idempotent and answers with the conversation either way, so pressing
        Message on somebody you already have a thread with lands on it rather
        than creating a second one. Sending the reader to `/messages` bare —
        which is what this did — showed them a list and left them to find the
        person they had just pressed the button on.
      */
      onClick={() =>
        open.mutate(profile, {
          onSuccess: (conversation) => router.push(sq(`/messages?c=${conversation.id}`)),
        })
      }
      className="ws-press flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white transition-colors hover:bg-white/10 disabled:opacity-50"
    >
      <IconProfileSms className="h-4 w-4" />
    </button>
  );
}

/**
 * The "you have no posts yet" CTA on your own profile.
 *
 * It used to link to `/?compose=1`, which threw you off your profile to write
 * a post. Same rule as the shell's compose controls: open it where you stand.
 * The composer lives in the feed slice, so it is joined here rather than
 * imported by profile.
 */
function ComposeCta() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ws-press inline-flex rounded-full border border-white/20 px-4 py-1.5 text-[13px] font-bold text-body transition-colors hover:bg-white/10"
      >
        Create a post
      </button>
      <ComposeSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Holds the active slide, so sliding changes which item is open. */
function ProfileMediaViewer({
  items,
  openId,
  onClose,
}: {
  items: Post[];
  openId: string;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(openId);
  return (
    <VideoViewer
      items={items}
      activeId={activeId}
      onActiveChange={setActiveId}
      onClose={onClose}
    />
  );
}

export function ProfileScreen({ username }: { username: string }) {
  return (
    <ProfilePage
      username={username}
      messageSlot={(profile) => <MessageButton profile={profile} />}
      /* 534:15577 — a house is a group CONVERSATION, so the rail reads the
         messages slice and is joined here rather than imported across. */
      housesSlot={<ProfileHouses />}
      /* 545:47653 and 545:47746 — the houses somebody ELSE belongs to and
         their ended gist rooms. Both read across slices (joining a house is
         the messages slice's, the topic vocabulary is discovery's), so both
         are composed here. */
      housesOfSlot={(profile) => <ProfileHousesOf username={profile.username} />}
      replaysSlot={(profile) => <ProfileReplays username={profile.username} />}
      earningsSlot={<ProfileEarnings />}
      /* 435:27523 — the balance chip on the cover. The kash slice's, and the
         profile may not import it. */
      kashSlot={<ProfileKashChip />}
      composeSlot={<ComposeCta />}
      // The same card the timeline and Explore render. The profile used to
      // draw its own stripped row, whose heart was a <span> with no handler,
      // so a like from a profile silently did nothing.
      postSlot={(post) => <PostCard post={post} />}
      /*
        The same full-screen viewer the timeline promotes a video into,
        composed in here because profile never imports the feed slice. It is
        given the gallery in grid order, so sliding moves through exactly what
        was on screen — which is the whole point of "go to their profile and
        slide".
      */
      mediaViewerSlot={(items, openId, onClose) => (
        <ProfileMediaViewer items={items} openId={openId} onClose={onClose} />
      )}
    />
  );
}

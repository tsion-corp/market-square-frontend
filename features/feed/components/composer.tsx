"use client";

import { useEffect, useRef, useState } from "react";
import { atHandle } from "@/lib/handle";
import { toast } from "sonner";
import { useGate } from "@/hooks/use-gate";
import { useMe } from "@/hooks/use-me";
import type { ComposePrefill } from "@/lib/compose-prefill";
import type { DeepLink } from "@/lib/api/schemas";
import { LinkTargetPicker } from "@/components/ui/link-target-picker";
import { Avatar } from "@/components/ui/avatar";
import { IconClock, IconEmoji, IconImage, IconLink, IconX } from "@/components/ui/icons";
import { SymbolPicker } from "@/components/ui/symbol-picker";
import { EmojiPicker } from "@/components/ui/emoji-picker";
import { cn } from "@/lib/cn";
import {
  ensureUploadLimits,
  formatBytes,
  getUploadLimits,
  readVideoDuration,
  uploadKind,
  validateUpload,
  validateVideoDuration,
  type UploadResult,
} from "@/lib/api/upload";
import { acceptFor } from "@/lib/upload-rules";
import { useMultiMediaSupported } from "@/lib/media-contract";
import { MAX_POST_MEDIA, attachmentKind, checkMediaSelection, mediaFields } from "@/lib/post-media";
import { probeMediaContract } from "@/features/feed/lib/api";
import { useCreatePost, useUploadPostMedia } from "@/features/feed/hooks/use-feed";
import { useMentionTyping } from "@/features/feed/hooks/use-mention-typing";
import { MentionPicker } from "@/features/feed/components/mention-picker";
import type { Post } from "@/features/feed/lib/types";

const MAX = 2000;

/** A chosen file and the local object URL that previews it. */
type Attachment = { file: File; url: string };

const attach = (file: File): Attachment => ({ file, url: URL.createObjectURL(file) });

/** Circular ring that fills as the post approaches the limit (X's counter). */
function CountRing({ used }: { used: number }) {
  const ratio = Math.min(1, used / MAX);
  const remaining = MAX - used;
  const circumference = 2 * Math.PI * 9;
  const near = remaining <= 200;
  return (
    <span className="flex items-center gap-2">
      {near && <span className="tnum text-xs text-meta">{remaining}</span>}
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
        <circle
          cx="11"
          cy="11"
          r="9"
          fill="none"
          stroke={remaining <= 0 ? "#f6a5a5" : "#d4d4d8"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform="rotate(-90 11 11)"
        />
      </svg>
    </span>
  );
}

// The always-present head of the timeline. Icons carry the affordances; the
// URL fields only unfold once you reach for one.
export function Composer({
  autoFocus = false,
  asStory = false,
  quoted = null,
  prefill,
  initialMedia = null,
  onDone,
}: {
  autoFocus?: boolean;
  /** Open already in story mode — the stories rail's "Your story" entry. */
  asStory?: boolean;
  /**
   * A draft handed in from a cross-product share (`/?compose=1&link=…`).
   *
   * A PREFILL, never an auto-post: it seeds the initial state and then gets
   * out of the way, so the sharer edits and publishes it themselves. It is
   * validated in `lib/compose-prefill.ts` before it reaches here — this
   * component must never receive a raw query parameter.
   */
  prefill?: ComposePrefill | null;
  /**
   * A picture handed in already attached — the friends card's "Post to
   * Square". Seeded once like `prefill`, and removable like any chosen file.
   */
  initialMedia?: File | null;
  /** The post being quoted, previewed above the field and sent as quotedPostId. */
  quoted?: Post | null;
  /**
   * Called once the post is live, with the created post — callers that are not
   * a feed (the shell's global composer) need its id to link to `/p/:id`,
   * since nothing on their surface will show the new post appearing.
   */
  onDone?: (created: Post) => void;
}) {
  const me = useMe();
  const gate = useGate();
  const create = useCreatePost();
  const upload = useUploadPostMedia();
  /*
    THE PICKER HAD NO TRIGGER AND NO OPEN STATE — it was mounted permanently.

    `EmojiPicker` is the PANEL, not a button; the caller owns whether it is on
    screen, which is what `chat-panel` does with `emojiOpen`. This composer
    rendered it unconditionally, so on a phone a 240px `fixed` panel sat over
    the post box from the moment the sheet opened: ogazboiz went to write a
    post and could not see the field. On desktop it hid above the toolbar,
    which is why it went unnoticed.

    Same shape as the room's composer rather than a second one — a toggle, a
    dismissal on click-away and Escape, and a close after a pick so the panel
    does not sit over the text somebody just added to.
  */
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!emojiOpen) return;
    const onDown = (event: PointerEvent) => {
      if (emojiWrap.current && !emojiWrap.current.contains(event.target as Node)) {
        setEmojiOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [emojiOpen]);

  const field = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Seeded once. Later renders must not clobber what the person has typed, so
  // this is an initial value rather than an effect that syncs on every change.
  // The text and the @-mention machinery live in one shared hook — the
  // comment boxes use the same one, so "@" behaves identically everywhere.
  const typing = useMentionTyping({ max: MAX, field, initial: prefill?.text ?? "" });
  const { text } = typing;
  const [media, setMedia] = useState<Attachment[]>(() => (initialMedia ? [attach(initialMedia)] : []));
  const [uploading, setUploading] = useState(false);
  // Attaching a link is a picker, not an id box — see LinkTargetPicker.
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState<DeepLink | null>(prefill?.link ?? null);
  const [linkLabel, setLinkLabel] = useState<string | null>(prefill?.label ?? null);
  const [kind, setKind] = useState<"update" | "story">(asStory && !quoted ? "story" : "update");
  /*
    SEVERAL PHOTOS, only where the server takes them — node 1029:22591.

    `media` on create is new, and a server without it would publish the post
    with none of the chosen photos. So the multi-pick switches on only once a
    post from this server has come back carrying the `media` list
    (`lib/media-contract.ts`); the composer asks for one post to find out if
    nothing on the page has said yet. A story is always one item.
  */
  const multiSupported = useMultiMediaSupported();
  const multi = multiSupported && kind === "update";
  useEffect(() => {
    if (!multiSupported) void probeMediaContract();
  }, [multiSupported]);
  // Height follows the CONTENT, measured from the element rather than counted
  // from newlines: a long unbroken line wraps into several visual rows that no
  // character count can predict. Reset to auto first, or scrollHeight only
  // ever reports the height it already has and the box can never shrink.
  useEffect(() => {
    const node = field.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [text]);


  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const deepLink: DeepLink | undefined =
    link ?? undefined;

  const clearMedia = () => {
    media.forEach((item) => URL.revokeObjectURL(item.url));
    setMedia([]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeMedia = (index: number) => {
    const item = media[index];
    if (item) URL.revokeObjectURL(item.url);
    setMedia(media.filter((_, at) => at !== index));
  };

  const submit = () => {
    const body = text.trim();
    if (!body && media.length === 0) return;
    const refused = checkMediaSelection(
      media.map((item) => uploadKind(item.file)),
      { story: kind === "story", max: MAX_POST_MEDIA }
    );
    if (refused) {
      toast.error(refused);
      return;
    }
    // Kept objects, filtered to whoever is still written in the body.
    const mentions = typing.mentionsFor(body);
    gate(() => void (async () => {
      let uploaded: UploadResult[];
      setUploading(true);
      try {
        // Every url sent is the one `/uploads/complete` returned for this
        // writer's own upload — the only address the service accepts.
        uploaded = await Promise.all(media.map((item) => upload.mutateAsync(item.file)));
      } catch {
        return;
      } finally {
        setUploading(false);
      }
      const attached = uploaded.map((result, index) => ({
        url: result.url,
        kind: attachmentKind(result.kind, uploadKind(media[index].file)),
      }));
      create.mutate(
        // The current post contract requires a non-empty text field. An
        // invisible separator preserves media-only posts without displaying
        // a synthetic caption to readers.
        {
          kind,
          text: body || "\u2063",
          ...mediaFields(attached),
          deepLink,
          ...(quoted ? { quotedPostId: quoted.id } : {}),
          ...(mentions.length > 0 ? { mentions } : {}),
        },
        { onSuccess: (created) => {
          // The service silently ignores fields it does not know. If the quote
          // did not come back attached, say so rather than letting the reader
          // believe they quoted something.
          if (quoted && !created.quotedPost) {
            toast.error("Posted, but quoting isn't available yet — it went out as a plain post.");
          }
          // The same honesty for the photos: fewer back than were sent means
          // the server kept only some of them.
          if (attached.length > 1 && (created.media?.length ?? 0) < attached.length) {
            toast.error("Posted, but not every photo went out with it.");
          }
          onDone?.(created);
          typing.reset();
          clearMedia();
          setLink(null);
          setLinkLabel(null);
          setLinkOpen(false);
        } }
      );
    })());
  };

  const chooseMedia = async (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    // Cleared so picking the same file again, or adding more, fires again.
    if (fileInput.current) fileInput.current.value = "";
    if (picked.length === 0) return;
    // One validator for the whole app, against limits the BACKEND publishes.
    // This used to carry its own rules — a "50 MB" cap matching neither the
    // image nor the video limit — so the composer rejected files the service
    // would have taken and accepted files it would not. Hard-coding the
    // service's numbers instead only moved the drift; now they are fetched.
    //
    // Awaited BEFORE the check, and the check still runs before any byte is
    // sent: the user gets an instant, specific error, and it is the right one.
    // The call is memoised, so only the first pick of a session pays for it,
    // and it falls back rather than failing.
    await ensureUploadLimits();
    for (const file of picked) {
      const invalid = validateUpload(file, "media");
      if (invalid) {
        toast.error(invalid);
        return;
      }
      // Clip length, checked here and nowhere else: the backend publishes
      // `maxVideoSeconds` but does not enforce it, because reading a duration
      // means demuxing the file and the presign path never sees the bytes. So
      // this is a courtesy — it stops the user spending a phone upload on a
      // clip the feed should not autoplay — not a control. An unreadable
      // duration lets the file through; the byte cap is the limit that bites.
      if (uploadKind(file) === "video") {
        const tooLong = validateVideoDuration(await readVideoDuration(file));
        if (tooLong) {
          toast.error(tooLong);
          return;
        }
      }
    }
    // Several photos ADD to what is attached; one file REPLACES it, as before.
    const next = multi ? [...media.map((item) => item.file), ...picked] : picked.slice(0, 1);
    const refused = checkMediaSelection(next.map((file) => uploadKind(file)), {
      story: kind === "story",
      max: MAX_POST_MEDIA,
    });
    if (refused) {
      toast.error(refused);
      return;
    }
    if (multi) {
      setMedia([...media, ...picked.map(attach)]);
    } else {
      media.forEach((item) => URL.revokeObjectURL(item.url));
      setMedia(next.map(attach));
    }
  };

  const single = media.length === 1 ? media[0] : null;
  const active = text.trim().length > 0 || media.length > 0;

  /**
   * The caps, shown BEFORE a file is chosen.
   *
   * They were only ever spoken as a rejection — pick a 40MB clip, wait, get
   * told. Saying them up front costs one line and turns a refusal into a
   * choice. Read from the published contract, never typed in here: the whole
   * point of `/uploads/limits` is that these numbers have one owner, and a
   * hint that drifts is worse than no hint.
   */
  const [limits, setLimits] = useState(getUploadLimits());
  useEffect(() => {
    let live = true;
    void ensureUploadLimits().then((fetched) => {
      if (live) setLimits(fetched);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="ws-row flex gap-3 px-4 py-3">
      <Avatar name={me.data?.displayName ?? "You"} seed={me.data?.id} src={me.data?.avatarUrl} size={40} />

      <div className="min-w-0 flex-1">
        {kind === "story" && (
          <button
            onClick={() => setKind("update")}
            className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-accent/40 px-3 py-0.5 text-xs font-semibold text-accent"
          >
            Posting as a story · 24h <IconX className="h-3 w-3" />
          </button>
        )}

        {/* The post being quoted, previewed so the writer sees what they are
            replying to. One level only — the preview never shows its own
            quoted card. */}
        {quoted && (
          <div className="ws-inset mb-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Avatar
                name={quoted.author?.displayName ?? "?"}
                seed={quoted.author?.id} src={quoted.author?.avatarUrl}
                size={20}
              />
              <span className="truncate text-[13px] font-bold text-heading">
                {quoted.author?.displayName ?? "Unknown"}
              </span>
              {atHandle(quoted.author?.username) && (
                <span className="truncate text-[12px] text-meta">{atHandle(quoted.author?.username)}</span>
              )}
            </div>
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-normal text-body">
              {quoted.text}
            </p>
          </div>
        )}

        {/* Grows with what is being written, then scrolls.
            `rows` alone cannot do this: a fixed count is either too small for a
            real thought or leaves a hole above the actions when the box is
            empty. It opened at one row, which clipped the placeholder itself.
            The cap keeps the send button on screen — a box that grows without
            limit pushes Post below the fold exactly when somebody is ready to
            press it, and on a phone that is the whole sheet. */}
        <textarea
          ref={field}
          value={text}
          onChange={(event) => typing.update(event.target.value, event.target.selectionStart)}
          onKeyDown={(event) => {
            if (event.key === "Escape") typing.dismiss();
          }}
          placeholder="What's happening on the square?"
          rows={1}
          className="min-h-[7.5rem] w-full resize-none overflow-y-auto bg-transparent py-2 text-xl leading-snug text-heading outline-none placeholder:text-meta sm:min-h-[6rem]"
          style={{ maxHeight: "38dvh" }}
        />

        {typing.token && <MentionPicker typing={typing} />}

        <input
          ref={fileInput}
          type="file"
          // Derived from the allowlist so the picker can never offer a type
          // we reject — it used to include video/quicktime, which guaranteed
          // a failure after the user had already chosen a file.
          // From the LIVE limits: a type appears here the moment the service
          // publishes it (`.mov` included), and never before.
          accept={acceptFor("media", limits)}
          multiple={multi}
          className="sr-only"
          onChange={(event) => void chooseMedia(event.target.files)}
        />

        {single && (
          <div className="mb-2">
            <div className="ws-hair relative mt-2 overflow-hidden rounded-2xl border">
                {single.file.type.startsWith("video/") ? (
                  <video src={single.url} controls className="max-h-80 w-full bg-black object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                  <img src={single.url} alt="Selected upload preview" className="max-h-80 w-full object-cover" />
                )}
                <button
                  onClick={clearMedia}
                  aria-label="Remove attached media"
                  className="ws-press absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                >
                  <IconX className="h-4 w-4" />
                </button>
                <div className="absolute bottom-2 left-2 rounded-full bg-black/75 px-2.5 py-1 text-[11px] text-grey-200 backdrop-blur-sm">
                  {single.file.name} · {(single.file.size / 1024 / 1024).toFixed(1)} MB
                </div>
              </div>
          </div>
        )}

        {/* Several photos preview as the row they will post as, each one
            removable on its own. */}
        {media.length > 1 && (
          <ul aria-label="Attached photos" className="mb-2 mt-2 flex gap-2 overflow-x-auto pb-1">
            {media.map((item, index) => (
              <li
                key={item.url}
                className="ws-hair relative h-[168px] w-[120px] shrink-0 overflow-hidden rounded-2xl border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                <img
                  src={item.url}
                  alt={`Photo ${index + 1} of ${media.length}`}
                  className="h-full w-full object-cover"
                />
                <button
                  onClick={() => removeMedia(index)}
                  aria-label={`Remove photo ${index + 1}`}
                  className="ws-press absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {(linkOpen || link) && (
          <div className="mb-2">
            <LinkTargetPicker
              value={link}
              label={linkLabel}
              onChange={(next, nextLabel) => {
                setLink(next);
                setLinkLabel(nextLabel);
                if (!next) setLinkOpen(false);
              }}
            />
          </div>
        )}

        {/* One strip, on a 360px phone too. Every control here is `shrink-0`
            — correct, since a squashed icon button is not a button — so the
            row's minimum width is the sum of its parts, and the sheet clips
            rather than scrolls: past that width the Post button simply left
            the screen. The fix is to make the parts smaller on small screens
            rather than to let them shrink or wrap. */}
        <div className="ws-hair flex min-w-0 flex-nowrap items-center gap-0.5 border-t pt-2.5 sm:gap-1">
          <button
            onClick={() => fileInput.current?.click()}
            disabled={multi && media.length >= MAX_POST_MEDIA}
            aria-label={multi ? "Upload pictures or a video from your device" : "Upload a picture or video from your device"}
            title={multi ? `Upload up to ${MAX_POST_MEDIA} pictures or one video` : "Upload picture or video"}
            className={cn(
              "shrink-0 rounded-full p-1.5 transition-colors hover:bg-white/10 disabled:opacity-40 sm:p-2",
              media.length > 0 ? "text-heading" : "text-accent"
            )}
          >
            <IconImage className="h-[18px] w-[18px]" />
          </button>

          {/* Deep links are the square's answer to a GIF picker: attach a
              stream, a store item or an external URL. The type is chosen
              inside the picker, so this is a single toggle rather than a menu
              of id-shaped options. */}
          <div className="relative shrink-0">
            <button
              onClick={() => setLinkOpen((open) => !open)}
              aria-label="Attach a link"
              aria-pressed={linkOpen || link !== null}
              title="Attach a link"
              className={cn(
                "rounded-full p-1.5 transition-colors hover:bg-white/10 sm:p-2",
                link ? "text-heading" : "text-accent"
              )}
            >
              <IconLink className="h-[18px] w-[18px]" />
            </button>
          </div>

          {/* The `$` and emoji tools are SIBLINGS of the other tools, not
              children of the link button's wrapper. Nested inside it they
              stacked vertically — that wrapper is a block box, so the row
              rendered as three ragged lines instead of one strip of controls.
              Each picker already owns the `relative` its popover anchors to,
              so none of them needs a wrapper here.

              The `$` tool matches Ark's composer: it inserts at the caret and
              only ever offers coins the platform can actually trade, so a
              chosen ticker always renders — a symbol typed from memory is
              silently plain text when it is wrong. */}
          <SymbolPicker
            onPick={(fragment) => {
              const node = field.current;
              const at = node?.selectionStart ?? text.length;
              const next = `${text.slice(0, at)}${fragment}${text.slice(at)}`;
              typing.update(next, at + fragment.length);
              // Typing continues where the insert ended, not at the end.
              const caret = at + fragment.length;
              window.requestAnimationFrame(() => {
                node?.focus();
                node?.setSelectionRange(caret, caret);
              });
            }}
          />

          {/* The panel is anchored to THIS wrapper on desktop (`md:absolute
              md:bottom-full`), so it needs the positioned parent; on a phone
              the panel is `fixed` and the wrapper only scopes the click-away. */}
          <div ref={emojiWrap} className="relative shrink-0">
            {emojiOpen && (
              <EmojiPicker
                onPick={(emoji) => {
                  const node = field.current;
                  const at = node?.selectionStart ?? text.length;
                  const next = `${text.slice(0, at)}${emoji}${text.slice(at)}`;
                  typing.update(next, at + emoji.length);
                  const caret = at + emoji.length;
                  // Closed on pick: the panel covers the field on a phone, and
                  // leaving it up hides the character it just inserted.
                  setEmojiOpen(false);
                  window.requestAnimationFrame(() => {
                    node?.focus();
                    node?.setSelectionRange(caret, caret);
                  });
                }}
              />
            )}
            <button
              type="button"
              aria-label="Add emoji"
              aria-haspopup="dialog"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((value) => !value)}
              className={cn(
                "ws-press flex text-white/50 transition-colors hover:text-white/80",
                emojiOpen && "text-white"
              )}
            >
              <IconEmoji className="h-5 w-5" />
            </button>
          </div>

          <button
            onClick={() => setKind(kind === "story" ? "update" : "story")}
            aria-label="Post as a story"
            title="Stories expire after 24 hours"
            aria-pressed={kind === "story"}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-2 text-[11px] font-bold transition-colors hover:bg-white/10 sm:px-2",
              kind === "story" ? "text-heading" : "text-accent"
            )}
          >
            {/* This toggles update/story. It used to wear a poll glyph, which
                promised a poll composer that does not exist. */}
            <IconClock className="h-[18px] w-[18px]" />
            {/* The glyph and the title carry the meaning where there is no
                room for the label; the aria-label is unchanged either way. */}
            <span className="hidden sm:inline">24h</span>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
            {active && <CountRing used={text.length} />}
            <button
              onClick={submit}
              disabled={!active || create.isPending || uploading}
              className="ws-press h-9 rounded-full bg-accent px-4 text-[15px] font-bold text-ink transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
            >
              {uploading ? "Uploading…" : create.isPending ? "Posting…" : "Post"}
            </button>
          </div>
        </div>

        {/* Quiet, and only while composing: a permanent line of limits above an
            empty box is noise, and the reader who has not reached for a file
            does not need it yet. */}
        {active && (
          <p className="mt-2 text-[11px] leading-4 text-meta">
            {multi && `Up to ${MAX_POST_MEDIA} photos or one video · `}
            Photos up to {formatBytes(limits.maxImageBytes)} · video up to{" "}
            {formatBytes(limits.maxVideoBytes)}, {limits.maxVideoSeconds}s
          </p>
        )}
      </div>
    </div>
  );
}

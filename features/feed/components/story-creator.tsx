"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useGate } from "@/hooks/use-gate";
import { cn } from "@/lib/cn";
import {
  STORY_BACKGROUNDS,
  STORY_FONTS,
  STORY_FONT_CLASS,
  type StoryBackground,
  type StoryFont,
} from "@/lib/story-style";
import { IconImage, IconSend, IconX } from "@/components/ui/icons";
import {
  ensureUploadLimits,
  getUploadLimits,
  readVideoDuration,
  uploadKind,
  validateUpload,
  validateVideoDuration,
} from "@/lib/api/upload";
import { acceptFor } from "@/lib/upload-rules";
import { useCreatePost, useUploadPostMedia } from "@/features/feed/hooks/use-feed";

/** A text story is a thought, not an essay. */
const MAX_TEXT = 700;

/** The brand's own purple ramp — the text story's ground. */
const STORY_GRADIENT = "bg-[linear-gradient(160deg,#9F65FD_0%,#5B05E6_100%)]";

type Stage =
  | { kind: "choose" }
  | { kind: "media"; file: File; preview: string }
  | { kind: "text" };

/**
 * ADDING TO YOUR STORY — WhatsApp's status flow, in Square's own look.
 *
 * "Your Story" used to be a link to `/?compose=story`, which only unfolded the
 * inline composer somewhere down Home, so a tap read as nothing happening. This
 * is the flow people already know from WhatsApp, full screen:
 *
 *   1. choose — a photo or video from the device, or a text story;
 *   2. a photo or video fills the screen with a caption bar and a send disc;
 *      a text story is typed large on the purple ramp;
 *   3. send uploads (when there is media) and publishes a `story` post through
 *      the same upload and create path the composer uses. Stories expire after
 *      24 hours on the service.
 *
 * Portalled to the body: the timeline's cards carry a transform (`ws-enter`),
 * and a fixed layer inside one anchors to it instead of the screen.
 */
export function StoryCreator({ onClose }: { onClose: () => void }) {
  const gate = useGate();
  const create = useCreatePost();
  const upload = useUploadPostMedia();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  /*
    WHAT THE STORY LOOKS LIKE. Defaulted to the service's first colour and a
    plain face, so somebody who touches nothing still sends a style rather than
    null — null means "the old default gradient", which is a real state and not
    the one a person who just opened a picker intends.
  */
  const [background, setBackground] = useState<StoryBackground>(STORY_BACKGROUNDS[0]);
  const [font, setFont] = useState<StoryFont>("sans");
  const [caption, setCaption] = useState("");
  const [text, setText] = useState("");
  const busy = upload.isPending || create.isPending;
  // The picker offers what the service publishes, `.mov` included once it does.
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

  // A chosen picture's preview URL is released when it is replaced or closed.
  useEffect(() => {
    return () => {
      if (stage.kind === "media") URL.revokeObjectURL(stage.preview);
    };
  }, [stage]);

  // Escape steps back, then closes; the page underneath does not scroll.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (stage.kind === "choose") onClose();
      else setStage({ kind: "choose" });
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [stage.kind, onClose]);

  // The same checks the composer runs, against the limits the service publishes.
  const choose = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    await ensureUploadLimits();
    const invalid = validateUpload(file, "media");
    if (invalid) {
      toast.error(invalid);
      return;
    }
    if (uploadKind(file) === "video") {
      const tooLong = validateVideoDuration(await readVideoDuration(file));
      if (tooLong) {
        toast.error(tooLong);
        return;
      }
    }
    setCaption("");
    setStage({ kind: "media", file, preview: URL.createObjectURL(file) });
  };

  const send = () => {
    const body = (stage.kind === "text" ? text : caption).trim();
    if (stage.kind === "choose" || (stage.kind === "text" && !body)) return;
    gate(() =>
      void (async () => {
        let mediaUrl: string | undefined;
        if (stage.kind === "media") {
          try {
            mediaUrl = (await upload.mutateAsync(stage.file)).url;
          } catch {
            return;
          }
        }
        // The post contract needs text; an invisible separator keeps a
        // picture-only story from showing a caption nobody wrote.
        create.mutate(
          {
            kind: "story",
            text: body || "\u2063",
            mediaUrl,
            /*
              A TEXT STORY ONLY. The service refuses `storyStyle` on anything
              else with a 400 rather than ignoring it, and a background behind a
              photo would be invisible anyway — the picture fills the frame.
            */
            ...(stage.kind === "text" ? { storyStyle: { background, font } } : {}),
          },
          { onSuccess: () => onClose() }
        );
      })()
    );
  };

  const sendButton = (disabled: boolean) => (
    <button
      type="button"
      onClick={send}
      disabled={disabled || busy}
      aria-label="Share to your story"
      className="ws-btn-welcome ws-press flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : (
        <IconSend className="h-5 w-5" />
      )}
    </button>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add to your story"
      className="fixed inset-0 z-[70] flex flex-col bg-[#0B0B0D] text-white"
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={stage.kind === "choose" ? onClose : () => setStage({ kind: "choose" })}
          aria-label={stage.kind === "choose" ? "Close" : "Back"}
          className="ws-glass-clear ws-press flex h-10 w-10 items-center justify-center rounded-full"
        >
          <IconX className="h-4 w-4" />
        </button>
        <p className="text-[15px] font-semibold leading-5">Your story</p>
        <span aria-hidden className="h-10 w-10" />
      </div>

      <input
        ref={fileInput}
        type="file"
        accept={acceptFor("media", limits)}
        className="sr-only"
        onChange={(event) => void choose(event.target.files?.[0])}
      />

      {stage.kind === "choose" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
          <div className="grid w-full max-w-sm grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="ws-press flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-[24px] bg-white/[0.04] px-3 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--color-create)]"
            >
              <span className="ws-btn-welcome flex h-14 w-14 items-center justify-center rounded-full">
                <IconImage className="h-6 w-6" />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold leading-5">Photo or video</span>
                <span className="text-[12px] leading-4 text-white/50">From your device</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setStage({ kind: "text" })}
              className={`ws-press flex aspect-[3/4] flex-col items-center justify-center gap-3 rounded-[24px] px-3 text-center ${STORY_GRADIENT}`}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-[22px] font-bold leading-none">
                Aa
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-[14px] font-semibold leading-5">Text</span>
                <span className="text-[12px] leading-4 text-white/70">Say something</span>
              </span>
            </button>
          </div>
          <p className="text-[12px] leading-4 text-white/40">Stories disappear after 24 hours</p>
        </div>
      )}

      {stage.kind === "media" && (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center px-4">
            {stage.file.type.startsWith("video/") ? (
              <video
                src={stage.preview}
                autoPlay
                loop
                playsInline
                controls
                className="max-h-full max-w-full rounded-[20px] bg-black object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={stage.preview} alt="Your story preview" className="max-h-full max-w-full rounded-[20px] object-contain" />
            )}
          </div>
          <div className="flex items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
              maxLength={MAX_TEXT}
              placeholder="Add a caption…"
              aria-label="Caption"
              className="h-12 min-w-0 flex-1 rounded-full bg-white/[0.08] px-5 text-[15px] text-white outline-none placeholder:text-white/40"
            />
            {sendButton(false)}
          </div>
        </>
      )}

      {stage.kind === "text" && (
        <>
          <div
            className="mx-3 flex min-h-0 flex-1 items-center justify-center rounded-[28px] px-6"
            style={{ background }}
          >
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_TEXT}
              rows={4}
              autoFocus
              placeholder="Type a status"
              aria-label="Story text"
              className={cn(
                "w-full resize-none bg-transparent text-center text-[28px] font-bold leading-tight text-white outline-none placeholder:text-white/60",
                STORY_FONT_CLASS[font]
              )}
            />
          </div>
          {/*
            THE EIGHT, AND THE FOUR. Driven off the service's own lists rather
            than a colour input: a ninth hex is a 400, so a free picker would
            offer colours that cannot be saved.

            Above the send row rather than beside it — the canvas is what they
            change and the eye should not have to leave it.
          */}
          <div className="flex items-center gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STORY_BACKGROUNDS.map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={`Background ${colour}`}
                aria-pressed={background === colour}
                onClick={() => setBackground(colour)}
                style={{ background: colour }}
                className={cn(
                  "ws-press h-7 w-7 shrink-0 rounded-full border transition-transform",
                  background === colour ? "scale-110 border-white" : "border-white/25"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto px-4 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STORY_FONTS.map((token) => (
              <button
                key={token}
                type="button"
                aria-pressed={font === token}
                onClick={() => setFont(token)}
                className={cn(
                  "ws-press shrink-0 rounded-full border px-3 py-1 text-[12px] capitalize transition-colors",
                  STORY_FONT_CLASS[token],
                  font === token
                    ? "border-white bg-white text-black"
                    : "border-white/25 text-white/80 hover:bg-white/10"
                )}
              >
                {token}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <span className="tnum text-[12px] text-white/40">
              {text.length}/{MAX_TEXT}
            </span>
            {sendButton(text.trim().length === 0)}
          </div>
        </>
      )}
    </div>,
    document.body
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { getUploadLimits } from "@/lib/api/upload";
import { MediaSendBar } from "@/features/messages/components/media-send-bar";
import { MediaEditor, type MediaEditorHandle } from "@/features/messages/components/media-editor";
import {
  CAMERA_HOLD_MS,
  CAMERA_MAX_CLIP_MS,
  cameraErrorCopy,
  captureContentType,
  captureFileName,
  flipFacing,
  pickClipType,
  pressIntent,
} from "@/features/messages/lib/camera-capture";

/**
 * THE CAMERA — a photo or a clip taken in the app, rather than chosen.
 *
 * ogazboiz asked for the two doors Snapchat has ("if it from media it will
 * show, if it from camera it will show", 2026-09-19): the gallery is for
 * something you kept, the camera is for the moment you are in. What comes out
 * of here is marked `camera`, which is what arms View once by default.
 *
 * ─── THE SHUTTER IS ONE BUTTON ───────────────────────────────────────────────
 * Tap for a photo, hold for a clip, release to stop — the gesture every camera
 * in a messenger uses. `pressIntent` decides which it turned out to be from how
 * long the finger stayed down, so a slow tap is never filed as a one-frame
 * video.
 *
 * ─── WHAT IS OPENED IS ALWAYS CLOSED ─────────────────────────────────────────
 * A live camera track keeps the device's light on until it is stopped. It is
 * stopped when the sheet closes, when the camera is flipped, when a capture is
 * taken and on unmount — every path, because the one that is forgotten is the
 * one where the reader's camera light stays on after they left the page.
 */
export function CameraSheet({
  open,
  onClose,
  onCaptured,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Handed the confirmed file, a local preview URL the caller owns and must
   * revoke, the caption typed under the shot, and whether it goes view-once.
   * The review IS the send screen; the caller uploads and sends.
   */
  onCaptured: (file: File, previewUrl: string, caption: string, viewOnce: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pressedAt = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The seconds counter. Held so it is cleared by whichever path stops the clip. */
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  /*
    AFTER A CAPTURE, THE CAMERA DOES NOT CLOSE — it freezes on the shot for
    review (ogazboiz, 2026-09-21): the picture stays on screen exactly as it was
    framed, and okay is a deliberate second tap that stages it in the composer.
    Retake drops back to the live camera (the acquire effect re-opens the device
    once `captured` is null again).

    `mirrored` remembers the front-camera flip: the live viewfinder is mirrored
    (that is what a mirror does while you frame), so the review must be mirrored
    too or the shot appears to jump sideways the instant it is taken.
  */
  const [captured, setCaptured] = useState<
    { file: File; url: string; kind: "photo" | "video"; mirrored: boolean } | null
  >(null);
  const [caption, setCaption] = useState("");
  // View-once is the default for a chat shot; the (1) mark on the send screen
  // toggles it — tap to keep the shot in the chat instead.
  const [viewOnce, setViewOnce] = useState(true);

  /** Stops the track AND drops the reference — the light goes out here. */
  const release = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  /* Opening and closing the device, keyed on the sheet, which way it faces, and
     whether a shot is under review — the live camera is stopped while the frozen
     preview is up, and re-opened the moment Retake clears it. */
  useEffect(() => {
    if (!open || captured) {
      release();
      return;
    }
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing }, audio: true })
      .then((opened) => {
        // The sheet may have closed while the permission prompt was up; a
        // stream nobody is going to show must still be stopped.
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = opened;
        if (video.current) video.current.srcObject = opened;
        // Cleared on SUCCESS rather than on open: a synchronous setState in an
        // effect is a cascading render, and a stale refusal that clears itself
        // the moment the camera works says the same thing more honestly.
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cameraErrorCopy(cause));
      });
    return () => {
      cancelled = true;
      release();
    };
  }, [open, facing, captured, release]);

  /* Timers are cleared on unmount, so a closed sheet cannot fire a capture. */
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (clipTimer.current) clearTimeout(clipTimer.current);
      if (tick.current) clearInterval(tick.current);
    },
    []
  );

  const takePhoto = () => {
    const node = video.current;
    if (!node || !node.videoWidth) return;
    // WYSIWYG — save the crop the viewfinder is SHOWING, not the full sensor.
    // The camera's native frame is usually landscape (e.g. 1280×720), but the
    // viewfinder is `object-cover` in a portrait box, so on a phone you frame a
    // portrait shot and, drawing the whole sensor, got a landscape photo back.
    // Re-run object-cover's own maths: fit the displayed box to the sensor,
    // centre-crop the rest, and the saved photo matches what was framed —
    // portrait when portrait, landscape when landscape.
    const vw = node.videoWidth;
    const vh = node.videoHeight;
    const dw = node.clientWidth || vw;
    const dh = node.clientHeight || vh;
    const cover = Math.max(dw / vw, dh / vh);
    const cropW = Math.min(vw, Math.round(dw / cover));
    const cropH = Math.min(vh, Math.round(dh / cover));
    const sx = Math.max(0, Math.round((vw - cropW) / 2));
    const sy = Math.max(0, Math.round((vh - cropH) / 2));
    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const context = canvas.getContext("2d");
    if (!context) return;
    // The FRONT camera is mirrored on screen, because that is what a mirror
    // does and what everybody expects while framing. The saved photo is not:
    // text in the picture would come out backwards.
    context.drawImage(node, sx, sy, cropW, cropH, 0, 0, cropW, cropH);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = captureFileName("photo", Date.now());
        const file = new File([blob], name, { type: "image/jpeg" });
        setCaptured({ file, url: URL.createObjectURL(file), kind: "photo", mirrored: facing === "user" });
      },
      "image/jpeg",
      0.92
    );
  };

  const startClip = () => {
    const live = stream.current;
    if (!live || recorder.current) return;
    const type = pickClipType(
      (mimeType) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType),
      getUploadLimits().videoContentTypes
    );
    // Said BEFORE anything is recorded: a clip in a type the service refuses is
    // a clip somebody shot and cannot send.
    if (!type) {
      setError("This browser can't record a clip Square accepts. Take a photo instead.");
      return;
    }
    chunks.current = [];
    const node = new MediaRecorder(live, { mimeType: type });
    node.ondataavailable = (event) => event.data.size > 0 && chunks.current.push(event.data);
    node.onstop = () => {
      const blob = new Blob(chunks.current, { type: node.mimeType });
      chunks.current = [];
      setRecording(false);
      setElapsed(0);
      if (blob.size === 0) return;
      // WITHOUT THE CODECS. `video/webm;codecs=vp9,opus` is not a type the
      // service recognises, and what it does not recognise it stores as a
      // generic file — which is how a recorded clip arrived in the thread as
      // a .txt row.
      const type = captureContentType(node.mimeType);
      const file = new File([blob], captureFileName("video", Date.now(), type), { type });
      setCaptured({ file, url: URL.createObjectURL(file), kind: "video", mirrored: facing === "user" });
    };
    recorder.current = node;
    node.start();
    setRecording(true);
    // COUNTED, not clocked. A second of wall time is what the reader is
    // watching, and reading the clock inside the component body is impure —
    // the React Compiler refuses it outright.
    let seconds = 0;
    tick.current = setInterval(() => {
      seconds += 1;
      setElapsed(seconds);
    }, 1_000);
    clipTimer.current = setTimeout(stopClip, CAMERA_MAX_CLIP_MS);
  };

  const stopClip = () => {
    if (clipTimer.current) clearTimeout(clipTimer.current);
    clipTimer.current = null;
    // Every stop clears the counter, not just the one that ran out of time.
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    const node = recorder.current;
    recorder.current = null;
    if (node?.state === "recording") node.stop();
    else setRecording(false);
  };

  const pressDown = () => {
    if (error) return;
    pressedAt.current = Date.now();
    // Recording begins at the hold threshold rather than on release, so the
    // clip contains the part the reader was holding the button for.
    holdTimer.current = setTimeout(startClip, CAMERA_HOLD_MS);
  };

  const pressUp = () => {
    const at = pressedAt.current;
    pressedAt.current = null;
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (at === null) return;
    if (pressIntent(Date.now() - at) === "clip") stopClip();
    else takePhoto();
  };

  // The photo editor (draw/text), asked for its baked result on send.
  const editorRef = useRef<MediaEditorHandle | null>(null);

  /* RETAKE — drop the shot and go back to the live camera. The preview URL is
     ours to revoke here; once a shot is CONFIRMED it passes to the caller, which
     revokes after upload. */
  const discard = useCallback(() => {
    setCaptured((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setCaption("");
    setViewOnce(true);
  }, []);

  /* Closing forgets the shot and the caption, so the next opening starts on the
     live camera rather than a stale preview — done here in the handler (not an
     effect) so React is not asked to setState mid-render. Every dismiss route
     (the X, the backdrop, Escape) is wired through it. */
  const closeAndReset = useCallback(() => {
    discard();
    onClose();
  }, [discard, onClose]);

  const send = async () => {
    const shot = captured;
    if (!shot) return;
    let file = shot.file;
    let url = shot.url;
    // Bake in any draw/text/sticker edits (photo or clip). An untouched shot
    // exports null and sends its original bytes; an edited one replaces them and
    // the original preview URL is ours to revoke here. A clip re-encode runs in
    // real time, so a longer press means a short wait before it sends.
    const edited = await editorRef.current?.exportImage();
    if (edited) {
      URL.revokeObjectURL(shot.url);
      file = edited.file;
      url = edited.url;
    }
    // The URL now belongs to the caller, so clear our state WITHOUT revoking it.
    onCaptured(file, url, caption.trim(), viewOnce);
    setCaptured(null);
    setCaption("");
    setViewOnce(true);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={closeAndReset}
      bare
      // A camera fills the screen on a phone: a FIXED, near-full-height panel so
      // the video can flex between a pinned header and pinned shutter, instead
      // of a content-sized sheet that grew taller than itself and pushed the
      // shutter out of reach. `max-h` is raised past the Sheet's default 85dvh
      // for the same reason. Desktop keeps the content-sized 420 card.
      panelClassName="h-[95dvh] max-h-[95dvh] bg-black sm:h-auto sm:max-h-[88dvh] sm:max-w-[420px] sm:rounded-2xl"
    >
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          {/* Once a shot is under review the left control is a labelled RETAKE —
              a bare chevron read as "back" and nobody found it. */}
          {captured ? (
            <button
              type="button"
              onClick={discard}
              aria-label="Retake"
              className="ws-press flex items-center gap-1.5 rounded-full py-1.5 pl-1.5 pr-3 text-[14px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3.5 5.5 8l4.5 4.5" />
              </svg>
              Retake
            </button>
          ) : (
            <h2 className="text-[14px] font-semibold text-white">Camera</h2>
          )}
          <button
            type="button"
            onClick={closeAndReset}
            aria-label="Close camera"
            className="ws-press rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="m3.5 3.5 9 9m0-9-9 9" />
            </svg>
          </button>
        </div>

        {captured ? (
          /* ─── REVIEW ─── the frozen shot, framed EXACTLY as the live camera
             showed it: same box, same object-cover, same front-camera mirror,
             so it does not jump the instant it is taken. Okay stages it. */
          <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-black sm:aspect-3/4 sm:flex-none">
            {/* Draw / text / stickers (and crop, photo-only) over the shot or
                clip before it sends; baked in on send. */}
            <MediaEditor
              ref={editorRef}
              src={captured.url}
              mirrored={captured.mirrored}
              kind={captured.kind === "video" ? "video" : "photo"}
              fileName={captured.file.name}
            />
          </div>
        ) : (
          /* Phone: the viewfinder takes all the room between the header and the
             shutter (`flex-1`). Desktop: the 420 card gives it a 3:4 frame. */
          <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-[#111] sm:aspect-3/4 sm:flex-none">
            <video
              ref={video}
              autoPlay
              playsInline
              muted
              className={cn("h-full w-full object-cover", facing === "user" && "-scale-x-100")}
            />
            {recording && (
              <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">
                <span className="h-2 w-2 rounded-full bg-live" />
                {elapsed}s
              </span>
            )}
            {error && (
              <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[13px] leading-[19px] text-white/80">
                {error}
              </p>
            )}
          </div>
        )}

        {captured ? (
          /* THE SEND SCREEN — the shared send bar (caption + view-once + send).
             A camera shot is always an image or clip in a 1:1, so view-once
             always applies here. */
          <MediaSendBar
            caption={caption}
            onCaptionChange={setCaption}
            viewOnce={viewOnce}
            onToggleViewOnce={() => setViewOnce((on) => !on)}
            showViewOnce
            onSend={send}
          />
        ) : (
          <div className="flex shrink-0 items-center justify-between px-6 py-5">
            <span className="w-10 text-[11px] leading-[15px] text-white/40">
              {recording ? "Release to send" : "Hold for video"}
            </span>
            {/* The shutter. One button: tap for a photo, hold for a clip. */}
            <button
              type="button"
              onPointerDown={pressDown}
              onPointerUp={pressUp}
              onPointerLeave={() => pressedAt.current !== null && pressUp()}
              disabled={Boolean(error)}
              aria-label={recording ? "Stop recording" : "Take a photo, or hold to record"}
              className={cn(
                "ws-press flex h-[68px] w-[68px] items-center justify-center rounded-full border-[3px] transition-colors disabled:opacity-40",
                recording ? "border-live" : "border-white"
              )}
            >
              <span className={cn("rounded-full transition-all", recording ? "h-6 w-6 bg-live" : "h-[54px] w-[54px] bg-white")} />
            </button>
            <button
              type="button"
              onClick={() => setFacing(flipFacing)}
              disabled={recording}
              aria-label="Switch camera"
              className="ws-press w-10 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8a7 7 0 0 1 11.9-4.9M17 12a7 7 0 0 1-11.9 4.9" />
                <path d="M3 3.5V8h4.5M17 16.5V12h-4.5" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { isShareCode, studioUrl } from "@/lib/arkplay-avatar";

/**
 * The ArkPlay avatar studio, opened over Square.
 *
 * The editor is somebody else's application on somebody else's origin, and it
 * stays that way: Square embeds it and listens. That is why none of the avatar
 * engine is in this bundle, why there is no renderer here, and why adding an
 * outfit to the studio needs no deploy of ours.
 *
 * ─── EVERY MESSAGE IS CHECKED BEFORE IT IS BELIEVED ─────────────────────────
 * A window with an iframe receives messages from anything that can reach it,
 * including other frames on the page and anything the reader has open. So the
 * origin is checked against the studio's own, the envelope must carry the
 * protocol's marker, and the code must look like a code before it is used. An
 * unchecked handler here would let any page set somebody's profile picture.
 */

/** The protocol's envelope marker — messages without it are not the studio's. */
const PROTOCOL_SOURCE = "arkplay-avatar-studio";

export function AvatarStudioSheet({
  open,
  code,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Reopen on an existing avatar, so editing continues rather than restarts. */
  code: string | null;
  onClose: () => void;
  /** The share code the person saved. */
  onSaved: (code: string) => void;
}) {
  const [height, setHeight] = useState(560);
  const [failed, setFailed] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  /*
    DERIVED, NOT STORED. The URL carries THIS page's origin, because the studio
    checks it before answering — so it cannot be decided on the server, where
    the page does not yet know where it is being served. It is a pure function
    of the origin and the code, and computing it in an effect would be a
    cascading render for a value that was never in doubt.

    Reading `window` during render is safe here precisely because the sheet
    renders nothing until it is opened, and opening is a client-side event: the
    server and the first client paint agree on nothing at all.
  */
  const src =
    open && typeof window !== "undefined"
      ? studioUrl(window.location.origin, code)
      : null;

  /** Closing clears the last failure, so reopening is not haunted by it. */
  const close = useCallback(() => {
    setFailed(null);
    onClose();
  }, [onClose]);

  const onMessage = useCallback(
    (event: MessageEvent) => {
      if (!src) return;
      // Origin first: everything else is attacker-controlled until this passes.
      if (event.origin !== new URL(src).origin) return;

      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object" || data.source !== PROTOCOL_SOURCE)
        return;

      if (data.type === "resize" && typeof data.height === "number") {
        // Bounded: a frame that asks for a screenful of nothing, or for one
        // pixel, is a frame this sheet should survive.
        setHeight(Math.min(900, Math.max(360, Math.round(data.height))));
        return;
      }
      if (data.type === "error" && typeof data.message === "string") {
        setFailed(data.message);
        return;
      }
      if (data.type === "cancel") {
        close();
        return;
      }
      if (data.type === "save") {
        const saved = typeof data.code === "string" ? data.code : null;
        // A malformed code would become a broken image with nothing to explain
        // it, so it is refused here rather than saved and rendered.
        if (!isShareCode(saved)) {
          setFailed(
            "That avatar didn't come back in one piece. Try saving again.",
          );
          return;
        }
        onSaved(saved);
        close();
      }
    },
    [src, onSaved, close],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, onMessage]);

  return (
    <Sheet open={open} onClose={close} title="Your avatar">
      {failed && (
        <p className="mb-2 text-[13px] text-down" role="alert">
          {failed}
        </p>
      )}
      {src && (
        <iframe
          ref={frameRef}
          src={src}
          title="Avatar studio"
          // The studio needs a camera for "from photo", and it writes a share
          // code to the clipboard on its own export screens. Nothing else.
          allow="camera; clipboard-write"
          className="w-full rounded-2xl border border-white/10 bg-black"
          style={{ height }}
        />
      )}
    </Sheet>
  );
}

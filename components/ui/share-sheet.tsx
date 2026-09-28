"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { IconShareFacebook, IconShareTelegram, IconShareWhatsApp, IconShareX } from "@/components/ui/share-icons";
import { IconMsShare } from "@/components/ui/design-icons";
import { IconDownload, IconLink } from "@/components/ui/icons";
import { shareCardImage } from "@/lib/share-card-image";
import { SHARE_TARGETS, shareUrl, type SharePayload, type ShareTarget } from "@/lib/share-targets";
import { withShareChannel } from "@/lib/utm";

/**
 * SHARE — a post, a profile — to WhatsApp, X, Facebook, Telegram, the
 * clipboard, or the device's own sheet. Shared UI, so every slice shares the
 * same way ("share in the profile should work just like the feed").
 *
 * It used to be one tap: the native sheet where the browser had one, else a
 * silent copy of the link. Desktop browsers mostly have no native sheet, so
 * on a laptop "share" meant "the link is on your clipboard now", and nobody
 * could put a post into a WhatsApp group the way every other social app lets
 * them. This sheet is that: each row hands the post's WORDS and its LINK to
 * the destination's share endpoint (`lib/share-targets`), so the reader lands
 * in that app's composer with both already in place.
 *
 * The native sheet is still offered, first, wherever the browser has one —
 * it reaches apps this list cannot name.
 */
const GLYPH: Record<ShareTarget, React.ComponentType<{ className?: string }>> = {
  whatsapp: IconShareWhatsApp,
  x: IconShareX,
  facebook: IconShareFacebook,
  telegram: IconShareTelegram,
};

export function ShareSheet({
  open,
  onClose,
  payload,
  title = "Share post",
  card,
}: {
  open: boolean;
  onClose: () => void;
  payload: SharePayload;
  /** The sheet's heading: "Share post", "Share profile". */
  title?: string;
  /**
   * A GENERATED PICTURE this thing can be shared AS — the scheduled room's
   * invite card, and anything that grows one later.
   *
   * Absent on a post or a profile, where there is nothing to attach and the
   * rows below are the whole story.
   *
   * ─── WHY THE CARD GETS ITS OWN ROWS ─────────────────────────────────────
   * The named destinations cannot carry it. WhatsApp, X, Facebook and
   * Telegram are reached by a web INTENT — a URL with the text and link in
   * its query — and an intent cannot attach a file. So those rows share the
   * link, as they always have, and the picture needs doors of its own:
   * the device sheet, which can attach it, and a save, which always can.
   *
   * Drawn FIRST, because when somebody has a card the card is the thing they
   * came to send.
   */
  card?: { imageUrl: string; fileName: string };
}) {
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const native = async () => {
    onClose();
    try {
      await navigator.share({ text: payload.text, url: withShareChannel(payload.url, "native_share") });
    } catch {
      /* dismissed share sheets are not errors */
    }
  };

  const copy = async () => {
    onClose();
    try {
      await navigator.clipboard.writeText(withShareChannel(payload.url, "copy_link"));
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  /*
    SHARE THE PICTURE, or save it. `shareCardImage` already owns the order —
    attach the file where the browser takes one, otherwise SAVE it, and only
    reach for the link when there is no picture at all.
  */
  const [busy, setBusy] = useState(false);
  const sendCard = async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const outcome = await shareCardImage({
        imageUrl: card.imageUrl,
        fileName: card.fileName,
        url: payload.url,
        title,
        text: payload.text,
      });
      if (outcome === "shared" || outcome === "downloaded") onClose();
      if (outcome === "downloaded") toast.success("Card saved — attach it to your message");
      if (outcome === "linked") toast.success("Link shared — the card couldn't be attached here");
      if (outcome === "failed") toast.error("Couldn't get the card ready — try again.");
    } finally {
      setBusy(false);
    }
  };

  /** Always a save, never a share — the row says what it does. */
  const saveCard = async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const response = await fetch(card.imageUrl);
      if (!response.ok) throw new Error(String(response.status));
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = card.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(href), 0);
      onClose();
      toast.success("Card saved");
    } catch {
      toast.error("Couldn't get the card ready — try again.");
    } finally {
      setBusy(false);
    }
  };

  const row =
    "ws-press flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] text-heading transition-colors hover:bg-white/[0.06]";

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-1">
        {/*
          THE CARD'S OWN ROWS, above everything, and only where there is one.
          "Preparing…" while the picture renders: it is generated on request
          and fetches a cover, and a row that sits there doing nothing reads
          as a dead control.
        */}
        {card && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendCard()}
              className={row + " disabled:opacity-60"}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white">
                <IconMsShare className="h-5 w-5" />
              </span>
              {busy ? "Preparing…" : "Share card"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveCard()}
              className={row + " disabled:opacity-60"}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white">
                <IconDownload className="h-5 w-5" />
              </span>
              Save card
            </button>
          </>
        )}
        {canNative && (
          <button type="button" onClick={() => void native()} className={row}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white">
              <IconMsShare className="h-5 w-5" />
            </span>
            Share link via…
          </button>
        )}
        {SHARE_TARGETS.map(({ target, label }) => {
          const Glyph = GLYPH[target];
          return (
            <a
              key={target}
              href={shareUrl(target, { ...payload, url: withShareChannel(payload.url, target) })}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className={row}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white">
                <Glyph className="h-5 w-5" />
              </span>
              {label}
            </a>
          );
        })}
        {/*
          NO "Post to Square" ROW. Sharing a post or profile back into Square's
          own feed is redundant when the reader is already inside the Square
          app — the outward destinations (WhatsApp, X, …) and Copy link are the
          whole point of this sheet, which is reaching people who are NOT here.
          (It was added on 2026-09-21 for X's behaviour and removed 2026-09-28
          on the same owner's call — "we are already on the square application,
          there's no need to share to square".) A Square link pasted into a
          post still renders as a card via `SharedLinkCard`; that path is
          unaffected. shell-invariants pins this row's ABSENCE so it cannot
          quietly return.
        */}
        <button type="button" onClick={() => void copy()} className={row}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-white">
            <IconLink className="h-5 w-5" />
          </span>
          Copy link
        </button>
      </div>
    </Sheet>
  );
}

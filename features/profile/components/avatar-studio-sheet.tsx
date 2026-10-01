"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { asset } from "@/lib/square-path";
import {
  AvatarCodecUnavailable,
  type AvatarDNA,
  type Catalog,
  type CatalogItem,
  type CatalogSlot,
  clearSlot,
  encodeDna,
  fetchCatalog,
  itemsForSlot,
  renderPreview,
  slotsFor,
  wearItem,
  wornInSlot,
} from "@/lib/arkplay-catalog";

/**
 * SQUARE'S OWN AVATAR STUDIO — node 1863:2412.
 *
 * It used to embed ArkPlay's editor in an iframe. It does not any more: the
 * studio is OUR surface and wears Square's design, and the service is used for
 * the two things only it can answer — what may be worn (`GET /catalog`) and
 * what a document looks like (`POST /render`). Both are public, so nothing
 * here carries a credential and none of their engine is in this bundle.
 *
 * ─── AN AVATAR IS EDITED AS PLAIN JSON ──────────────────────────────────────
 * Its DNA is an ordinary document; dressing it is an ordinary edit (see
 * lib/arkplay-catalog.ts). That is what makes a studio of our own possible
 * without the engine: we change the object, they draw it.
 *
 * ─── WHAT IS NOT FINISHED, AND WHY IT SAYS SO ───────────────────────────────
 * Saving needs the document turned into a share code, and the service has no
 * route that does it (`POST /codes` 404; `POST /me/avatars` 401 — it wants an
 * ArkPlay account a Square reader does not have). Asked for. Until it lands,
 * Save reports that plainly rather than failing silently or being hidden:
 * a control that is missing is indistinguishable from one that was never
 * built, and the person has just spent minutes dressing a character.
 */

/* ── The file's numbers ───────────────────────────────────────────────────── */

/** The preview card, 580x440 at a 12 radius. Everything inside is a % of it. */
const CARD = { w: 580, h: 440 };
const pctX = (px: number) => `${(px / CARD.w) * 100}%`;
const pctY = (px: number) => `${(px / CARD.h) * 100}%`;

/**
 * The three tabs, placed by their own x and set on ONE baseline.
 *
 * A judgement call, stated: the file puts the three at y 551, 557 and 547 and
 * leaves uneven gaps between them (80 then 54). Three baselines inside one
 * strip is hand-placement, not a system, and transcribing it literally reads
 * as a bug. Their x positions ARE the design and are kept exactly.
 */
const TABS = [
  { id: "fashion" as const, label: "fashion", left: 114, icon: "tab-fashion" },
  { id: "collections" as const, label: "Collections", left: 272, icon: null },
  { id: "avatar" as const, label: "Avatar", left: 401, icon: "tab-avatar" },
];

type TabId = (typeof TABS)[number]["id"];

interface Starter {
  id: string;
  label: string;
  dna: AvatarDNA;
}

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
  onSaved: (savedCode: string) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [dna, setDna] = useState<AvatarDNA | null>(null);
  const [tab, setTab] = useState<TabId>("fashion");
  const [slot, setSlot] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── What may be worn, and who we start as ─────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    (async () => {
      try {
        const [cat, starterRes] = await Promise.all([
          fetchCatalog(ac.signal),
          fetch(asset("/avatar-studio/starters.json"), { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;
        const starterBody = (await starterRes.json()) as { starters: Starter[] };
        setCatalog(cat);
        setStarters(starterBody.starters);
        /*
          Reopening on an existing avatar would start from THAT character, but
          recovering it needs `GET /codes/{code}`, which the service does not
          serve yet. Rather than silently restart somebody's avatar from
          scratch and let them discover it, this says so.
        */
        setDna((current) => current ?? starterBody.starters[0]?.dna ?? null);
        if (code) {
          setProblem(
            "Starting from a fresh character — the avatar service can't reopen a saved one yet.",
          );
        }
      } catch {
        if (!ac.signal.aborted) {
          setProblem("The avatar service didn't answer. Check your connection and try again.");
        }
      }
    })();
    return () => ac.abort();
  }, [open, code]);

  /*
    ── THE PICTURE ───────────────────────────────────────────────────────────
    A document being edited has no share code, so there is no URL to point an
    <img> at: the editor posts the document and gets a PNG back (about a
    second). Debounced, because dragging through a rail of hats would otherwise
    post once per hat, and every answer but the last is already stale.

    The object URL is revoked when it is replaced and when the sheet closes —
    a blob per edit, never released, is a leak that only shows up on the
    machines of the people who use this most.
  */
  const seq = useRef(0);
  useEffect(() => {
    if (!open || !dna) return;
    const mine = ++seq.current;
    const ac = new AbortController();
    const timer = setTimeout(async () => {
      setDrawing(true);
      try {
        const blob = await renderPreview(dna, { crop: "full", size: 512, signal: ac.signal });
        if (ac.signal.aborted || mine !== seq.current) return;
        const url = URL.createObjectURL(blob);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch {
        if (!ac.signal.aborted && mine === seq.current) {
          setProblem("Couldn't draw that look. Your last change may not be shown.");
        }
      } finally {
        if (mine === seq.current) setDrawing(false);
      }
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [open, dna]);

  useEffect(
    () => () => {
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
    },
    [],
  );

  const slots: CatalogSlot[] = useMemo(
    () => (catalog && dna ? slotsFor(catalog, dna.kind) : []),
    [catalog, dna],
  );
  /*
    DERIVED, NOT STORED IN AN EFFECT. Nobody has chosen a rail when the
    wardrobe first opens, and the grid must still have something in it — but
    "the first rail that holds anything" is a pure function of the catalog and
    the body. Writing it back as state in an effect would be a second render
    for a value that was never in doubt, which is the cascade this repo bans.
  */
  const activeSlot = useMemo(() => {
    if (slot) return slot;
    if (!catalog || !dna) return null;
    return slots.find((s) => itemsForSlot(catalog, s.id, dna.kind).length > 0)?.id ?? null;
  }, [slot, slots, catalog, dna]);

  const items: CatalogItem[] = useMemo(
    () => (catalog && dna && activeSlot ? itemsForSlot(catalog, activeSlot, dna.kind) : []),
    [catalog, dna, activeSlot],
  );
  const worn = catalog && dna && activeSlot ? wornInSlot(catalog, dna, activeSlot) : null;

  const save = useCallback(async () => {
    if (!dna) return;
    setSaving(true);
    setProblem(null);
    try {
      onSaved(await encodeDna(dna));
      onClose();
    } catch (e) {
      setProblem(
        e instanceof AvatarCodecUnavailable
          ? e.message
          : "Couldn't save that avatar. Try again in a moment.",
      );
    } finally {
      setSaving(false);
    }
  }, [dna, onSaved, onClose]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      bare
      panelClassName="w-full max-w-[616px] rounded-[20px] border border-white/10 bg-[#121214] p-0"
    >
      <div className="max-h-[85vh] overflow-y-auto px-[18px] pb-6">
        {/* 1951:25810 + 1951:25804 — the round back at 48, the title beside it. */}
        <div className="flex items-center gap-4 pb-[14px] pt-[29px]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            /* The file's 48 IS the scale's large icon button — no bespoke geometry needed. */
            className="ws-press ws-iconbtn-lg flex shrink-0 items-center justify-center rounded-full bg-white/[0.16]"
          >
            {/* The file draws a second, ringed 32 disc inside the 48 one. */}
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset("/avatar-studio/back.svg")} alt="" aria-hidden className="h-6 w-6" />
            </span>
          </button>
          {/* Manrope Bold 24/21.92 at -0.08em. */}
          <h2 className="font-[family-name:var(--font-heading)] text-[24px] font-bold leading-[21.92px] tracking-[-0.08em] text-white">
            Create Your Avatar
          </h2>
        </div>

        {problem && (
          <p className="mb-3 rounded-lg bg-white/[0.06] px-3 py-2 text-[13px] leading-5 text-white/80" role="alert">
            {problem}
          </p>
        )}

        {/* 1951:25801 — the 580x440 preview, radius 12, #1A1A1F. */}
        <div className="relative aspect-[580/440] w-full overflow-hidden rounded-[12px] bg-[#1A1A1F]">
          {/* The character. 341² at (120,60) in the card's own 580x440. */}
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={preview}
              alt="Your avatar"
              className="absolute object-contain transition-opacity"
              style={{
                left: pctX(120),
                top: pctY(60),
                width: pctX(341),
                height: pctY(341),
                opacity: drawing ? 0.55 : 1,
              }}
            />
          ) : (
            <span
              className="absolute animate-pulse rounded-2xl bg-white/[0.04]"
              style={{ left: pctX(120), top: pctY(60), width: pctX(341), height: pctY(341) }}
              aria-hidden
            />
          )}

          {/* 1966:25871 — the floor. 113 tall, and the stops really do run
              bottom-up: rgba(45,45,46,1) to a transparent rgba(145,145,148,0). */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(0deg,rgba(45,45,46,1)_0%,rgba(145,145,148,0)_100%)] opacity-[0.79]"
            style={{ height: pctY(113) }}
          />

          {/* 1972:26898 — the 44.12 close disc on white 10%. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ws-press absolute flex items-center justify-center rounded-full bg-white/10"
            style={{ left: pctX(14), top: pctY(7), width: 44.12, height: 44.12 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset("/avatar-studio/close.svg")}
              alt=""
              aria-hidden
              style={{ width: 20.77, height: 20.77 }}
            />
          </button>

          {/*
            1952:25836 and 1952:25833 — share and bookmark 8.72 apart, then the
            ringed 27.88 disc 12.35 on, and the 32 palette at the foot.

            DRAWN, NOT WIRED, AND NOT PRETENDING TO BE. Every node in this
            frame carries an empty `interactions` array — the file says what
            these look like and nothing about where they go. So they are the
            card's chrome rather than four controls that silently do nothing
            when pressed: inventing a destination for them would be worse than
            drawing them, and a dead button is indistinguishable from a broken
            one. They become buttons the moment the design says what they do.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute flex items-center"
            style={{ left: pctX(481), top: pctY(13.34), gap: 12.352 }}
          >
            <span className="flex items-center" style={{ gap: 8.719 }}>
              {(["share", "bookmark"] as const).map((n) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={n}
                  src={asset(`/avatar-studio/${n}.svg`)}
                  alt=""
                  style={{ width: 17.438, height: 17.438 }}
                />
              ))}
            </span>
            <span
              className="flex items-center justify-center rounded-full border border-white"
              style={{ width: 27.877, height: 27.877 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset("/avatar-studio/more.svg")}
                alt=""
                style={{ width: 17.606, height: 17.606 }}
              />
            </span>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset("/avatar-studio/palette.svg")}
            alt=""
            aria-hidden
            className="pointer-events-none absolute h-8 w-8"
            style={{ left: pctX(531), top: pctY(398) }}
          />
        </div>

        {/* The tab strip — their own x, one baseline. See TABS. */}
        <div className="relative mt-5 h-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id}
              className="absolute top-0 flex items-center gap-1"
              style={{ left: pctX(t.left) }}
            >
              {t.icon && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={asset(`/avatar-studio/${t.icon}.svg`)}
                  alt=""
                  aria-hidden
                  className="h-6 w-6"
                  style={{ opacity: tab === t.id ? 1 : 0.48 }}
                />
              )}
              {/* Manrope SemiBold 16/21.92 at -0.08em; #7A7A7A when resting. */}
              <span
                className={`font-[family-name:var(--font-heading)] text-[16px] font-semibold leading-[21.92px] tracking-[-0.08em] ${
                  tab === t.id ? "text-white" : "text-[#7A7A7A]"
                }`}
              >
                {t.label}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-[52px]">
          {tab === "fashion" && (
            <>
              {/* Which rail the tiles below belong to. The file draws the
                  tiles and not this, but eight tiles with nothing naming them
                  is a wardrobe nobody can navigate. */}
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {slots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSlot(s.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] leading-5 transition-colors ${
                      activeSlot === s.id ? "bg-white text-black" : "bg-white/[0.06] text-white/70"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* 1952:25826/25828 — 131x122 tiles at a 13.14 radius, 8.45
                  apart, four to a row. */}
              <div className="grid grid-cols-4" style={{ gap: 8.446 }}>
                {/* Wearing nothing is a choice the wardrobe has to offer. */}
                {activeSlot && (
                  <TileButton
                    selected={!worn}
                    onClick={() => catalog && dna && setDna(clearSlot(catalog, dna, activeSlot))}
                    label="None"
                  />
                )}
                {items.map((item) => (
                  <TileButton
                    key={item.id}
                    selected={worn === item.id}
                    onClick={() => catalog && dna && setDna(wearItem(catalog, dna, item))}
                    label={item.label}
                    badge={item.limited ? "Limited" : item.premium ? "Premium" : null}
                  />
                ))}
                {activeSlot && items.length === 0 && (
                  <p className="col-span-4 py-6 text-center text-[13px] text-white/50">
                    Nothing for this slot yet.
                  </p>
                )}
              </div>
            </>
          )}

          {tab === "avatar" && (
            <div className="grid grid-cols-4" style={{ gap: 8.446 }}>
              {starters.map((s) => (
                <TileButton
                  key={s.id}
                  selected={dna?.seed === s.dna.seed && dna?.kind === s.dna.kind}
                  onClick={() => {
                    setDna(s.dna);
                    setSlot(null);
                  }}
                  label={s.label}
                />
              ))}
            </div>
          )}

          {tab === "collections" && (
            /*
              VISIBLE AND INERT, WITH THE REASON. Saved outfits live on an
              ArkPlay account, and a Square reader has none — `/me/outfits`
              answers 401. Drawing nothing here would make a capability that
              is blocked look like one nobody built.
            */
            <p className="py-10 text-center text-[13px] leading-5 text-white/50">
              Your saved looks will live here.
              <br />
              They need an avatar-service account, which Square doesn&apos;t have yet.
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={!dna || saving}
            className="ws-press rounded-full bg-white px-5 py-2.5 text-[14px] font-semibold text-black disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save avatar"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** One wardrobe tile — the file's 131x122 at a 13.14 radius on #1A1A1F. */
function TileButton({
  selected,
  onClick,
  label,
  badge,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  badge?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative flex aspect-[131/122] flex-col items-center justify-end rounded-[13.138px] bg-[#1A1A1F] p-2 text-center transition-colors ${
        selected ? "ring-2 ring-white" : "hover:bg-white/[0.08]"
      }`}
    >
      {badge && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/80">
          {badge}
        </span>
      )}
      <span className="line-clamp-2 text-[11px] leading-4 text-white/70">{label}</span>
    </button>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMe } from "@/hooks/use-me";
import { useAuth } from "@/hooks/use-auth";
import { canGoBack } from "@/lib/nav-history";
import { useUpdateMe } from "@/features/profile/hooks/use-profile";
import { asset, sq } from "@/lib/square-path";
import { avatarImageUrl } from "@/lib/arkplay-avatar";
import { ENGINE_VERSION } from "@/vendor/arkplay-dna/version.ts";
import {
  AvatarCodecUnavailable,
  type AvatarDNA,
  type Catalog,
  type CatalogItem,
  type CatalogSlot,
  type CatalogParam,
  clearSlot,
  decodeCode,
  encodeDna,
  encodeMany,
  fetchCatalog,
  itemsForSlot,
  paramValue,
  randomiseDna,
  renderPreview,
  sectionsFor,
  setParam,
  slotsFor,
  visibleParams,
  toggleItem,
  wearItem,
  wornIdsInSlot,
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
 * ─── SAVING RUNS ON OUR OWN SERVER, FOR NOW ─────────────────────────────────
 * A profile stores a render URL, which needs the share code only the codec
 * makes, and the service publishes no route that makes one (`POST /codes`
 * 404s; the account route that would 401s for a sign-in a Square reader has no
 * way to hold). Asked for, and not waited on: Square runs the codec on its own
 * server at `/api/avatar/codes`, so saving and reopening both work today. The
 * day ArkPlay ships theirs it is a change of base URL — see
 * vendor/arkplay-dna/README.md.
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

/** How many notches a continuous parameter is offered as. See ParamControl. */
const STOPS = 7;

interface Starter {
  id: string;
  label: string;
  dna: AvatarDNA;
}

export function AvatarStudioScreen() {
  const router = useRouter();
  const meQuery = useMe();
  const me = meQuery.data;
  const { ready, authenticated } = useAuth();
  /*
    ─── WAIT FOR "ME" BEFORE PUTTING A FACE ON THE SCREEN ──────────────────────
    `useAuth().ready` is false on the first render and `/me` is not even
    requested until it turns true, so this screen's first pass ALWAYS saw a
    null code. Falling back to a starter there installed a stranger — and
    because the fallback is `current ?? opening`, the real character arriving a
    moment later was thrown away. The person then edited somebody else's face
    and Save wrote it over their own.

    Measured, so this is a race that really does turn the wrong way: the
    catalog fetch that gates the fallback took 2.2s/5.5s/2.2s from here, while
    `starters.json` is 1–11ms. Any cold load where auth hydration outlasts the
    catalog loses.
  */
  const identityKnown = !ready || !authenticated || !meQuery.isPending;
  const update = useUpdateMe();
  /* A page, not a dialog: there is nothing to open, so everything that used to
     wait on `open` runs once the route is mounted. */
  const open = true;
  /** Reopen on the character they already have — scene included, since it
      rides inside the same code. */
  const code = me?.avatarConfig ?? null;
  const [groundOpen, setGroundOpen] = useState(false);
  /*
    BACK TO WHERE THEY CAME FROM. Not a built `/u/<username>` link: this repo
    routes people by id because a username is theirs to change, and a test
    pins it. The studio is always reached from somewhere, so history is both
    the correct answer and the honest one.
  */
  const leave = useCallback(() => {
    if (canGoBack()) router.back();
    else router.push(sq("/"));
  }, [router]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  /*
    ─── UNDO IS AN ARRAY AND AN INDEX ──────────────────────────────────────────
    Every edit here already returns a NEW document, so keeping the last fifty
    costs nothing but the pointer. Of eight avatar editors surveyed, five have
    undo and the three most recent additions all landed in the last two years;
    the one product where every tap commits irreversibly is the one whose
    community's documented workaround is "save a copy before you change
    anything". Ours was that product.
  */
  const [hist, setHist] = useState<{
    past: AvatarDNA[];
    present: AvatarDNA | null;
    future: AvatarDNA[];
  }>({ past: [], present: null, future: [] });
  const dna = hist.present;

  /** Record an edit. Doing something new abandons the redo branch, as it must. */
  const setDna = useCallback((next: AvatarDNA) => {
    setHist((h) => ({
      past: h.present ? [...h.past, h.present].slice(-50) : h.past,
      present: next,
      future: [],
    }));
  }, []);

  const undo = useCallback(() => {
    setHist((h) =>
      h.past.length === 0
        ? h
        : {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: h.present ? [h.present, ...h.future] : h.future,
          },
    );
  }, []);

  const redo = useCallback(() => {
    setHist((h) =>
      h.future.length === 0
        ? h
        : {
            past: h.present ? [...h.past, h.present] : h.past,
            present: h.future[0],
            future: h.future.slice(1),
          },
    );
  }, []);
  const [tab, setTab] = useState<TabId>("fashion");
  const [slot, setSlot] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* ── What may be worn, and who we start as ─────────────────────────────── */
  useEffect(() => {
    if (!open || !identityKnown) return;
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
          THE GUARD ON A BORROWED CODEC. The wardrobe is fetched live, the
          encoder is a copy pinned at one engine version, and encoding walks
          the item schema — so if ArkPlay adds an item, the catalog would offer
          something our copy cannot write, and the failure would land at the
          end, on Save, after the work. Saying it up front is the difference
          between a known limitation and a lost outfit.
        */
        if (cat.engineVersion !== ENGINE_VERSION) {
          setProblem(
            `The wardrobe has moved on (${cat.engineVersion}) from the encoder here (${ENGINE_VERSION}). Newer items may not save.`,
          );
        }
        /*
          REOPEN ON THE AVATAR THEY HAVE, not a stranger. The code the profile
          already stores decodes straight back into the document, so coming
          back continues the character rather than starting a new one. If it
          cannot be read the studio says so and offers a starter, because
          silently handing somebody a different face is the one outcome they
          would not notice until after they had saved it.
        */
        let opening: AvatarDNA | null = null;
        if (code) {
          try {
            opening = await decodeCode(code, ac.signal);
          } catch {
            if (!ac.signal.aborted) {
              setProblem("Couldn't reopen your saved avatar — starting from a fresh character.");
            }
          }
        }
        if (ac.signal.aborted) return;
        // Installed, not recorded: there is nothing to undo back to yet.
        setHist((h) =>
          h.present
            ? h
            : { past: [], present: opening ?? starterBody.starters[0]?.dna ?? null, future: [] },
        );
      } catch {
        if (!ac.signal.aborted) {
          setProblem("The avatar service didn't answer. Check your connection and try again.");
        }
      }
    })();
    return () => ac.abort();
  }, [open, code, identityKnown]);

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
        /*
          `background: true` so the SCENE shows. It was false, which is why
          every one of the ten scene parameters edited nothing visible — the
          wallpaper was being rendered and then thrown away. A scene set to
          `none` still comes back transparent, so this costs nothing for
          somebody who has not chosen one.
        */
        const blob = await renderPreview(dna, {
          crop: "full",
          size: 512,
          background: true,
          signal: ac.signal,
        });
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
  /* A slot that holds three can have three on at once, so this is a SET. */
  const worn = catalog && dna && activeSlot ? wornIdsInSlot(catalog, dna, activeSlot) : [];

  /*
    ─── A WARDROBE HAS TO SHOW THE CLOTHES ─────────────────────────────────────
    A rail of labelled dark squares is a list, not a wardrobe: nobody can tell
    a crop top from a hoodie by reading it. Each tile is the character wearing
    that ONE thing, which also answers the question people actually have — what
    does this look like on ME.

    The variants are built here as plain documents (dressing is an object edit)
    and encoded in a single call; the pictures are then ordinary cacheable
    image URLs the browser fetches lazily on its own.
  */
  const variants = useMemo(() => {
    if (!catalog || !dna || !activeSlot) return [];
    return [clearSlot(catalog, dna, activeSlot), ...items.map((i) => wearItem(catalog, dna, i))];
  }, [catalog, dna, activeSlot, items]);

  const [tileCodes, setTileCodes] = useState<(string | null)[]>([]);
  const wardrobeOpen = tab === "fashion";
  const [starterCodes, setStarterCodes] = useState<(string | null)[]>([]);

  /* The starters are fixed, so their pictures are encoded once rather than
     with every edit the wardrobe makes. */
  useEffect(() => {
    if (starters.length === 0) return;
    const ac = new AbortController();
    encodeMany(
      starters.map((s) => s.dna),
      ac.signal,
    )
      .then((codes) => {
        if (!ac.signal.aborted) setStarterCodes(codes);
      })
      .catch(() => {
        if (!ac.signal.aborted) setStarterCodes([]);
      });
    return () => ac.abort();
  }, [starters]);
  /*
    DEBOUNCED, AND ONLY WHILE THE WARDROBE IS ON SCREEN.

    This hung off `dna` undebounced, so one drag of a slider in the Avatar tab
    fired one encode of the WHOLE rail per input event — measured at 50 posts
    and 1.85 MB for a single second of dragging, for pictures nobody was
    looking at. The preview was debounced; this was not.
  */
  useEffect(() => {
    if (!wardrobeOpen || variants.length === 0) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      encodeMany(variants, ac.signal)
        .then((codes) => {
          if (!ac.signal.aborted) setTileCodes(codes);
        })
        .catch(() => {
          /* The rail still works by name; a missing picture is not worth a
             banner over a studio the person is in the middle of using. */
          if (!ac.signal.aborted) setTileCodes([]);
        });
    }, 250);
    return () => {
      ac.abort();
      clearTimeout(timer);
    };
  }, [variants, wardrobeOpen]);

  const save = useCallback(async () => {
    if (!dna) return;
    setSaving(true);
    setProblem(null);
    try {
      const encoded = await encodeDna(dna);
      /*
        ITS OWN FIELD, AND NEITHER OF THE TWO IT COULD HAVE BEEN.

        Not `avatarUrl`: building a character must not replace somebody's
        profile picture, which is a separate choice they made. Not `coverUrl`
        either, and not for want of trying — the service runs that one through
        `verifyAttachment`, which demands a picture this person uploaded and
        refuses a foreign host or an appended query string outright (403).
        `avatarConfig` exists because of those two walls: opaque, never
        fetched, never rendered as a source.
      */
      const after = await update.mutateAsync({ avatarConfig: encoded });

      /*
        AN UNKNOWN FIELD IS STRIPPED, NOT REFUSED — which is the one failure
        that would look exactly like success. Until `avatarConfig` is deployed,
        the service drops it and answers 200 with the profile unchanged, and a
        person would walk away believing their character was kept. The write is
        only believed when the read-back carries it.
      */
      if (!after.avatarConfig) {
        setProblem(
          "Saved nothing — this server doesn't store avatars yet. Your character is still here; try again once it's deployed.",
        );
        return;
      }
      leave();
    } catch (e) {
      /*
        "Try again in a moment" was a lie for the failure people actually hit.
        An unknown field is STRIPPED, so a server without `avatarConfig` drops
        it, is left with an empty patch, and answers 400 — which no amount of
        retrying will change. The two cases read differently now: something
        that might pass later, and something that needs a deploy.
      */
      const contractGap = e instanceof Error && /\b400\b/.test(e.message);
      setProblem(
        e instanceof AvatarCodecUnavailable
          ? e.message
          : contractGap
            ? "This server can't store avatars yet — it needs the profile update that adds the field. Your character is still here."
            : "Couldn't save that avatar. Try again in a moment.",
      );
    } finally {
      setSaving(false);
    }
  }, [dna, update, me, leave]);

  /*
    A PAGE, NOT A DIALOG — and the frame says so. Node 1863:2412 is 951 wide by
    2238 tall with a border on its RIGHT EDGE ONLY and a backdrop blur: that is
    a full-height column standing beside the rest of the app, not a card
    floating on a backdrop. A dialog has four edges.
  */
  return (
    <div className="min-h-screen w-full border-r border-white/10 bg-[#121214] backdrop-blur-[12px] md:max-w-[951px]">
      <div className="px-[18px] pb-6">
        {/* 1951:25810 + 1951:25804 — the round back at 48, the title beside it. */}
        <div className="flex items-center gap-4 pb-[14px] pt-[29px]">
          <button
            type="button"
            onClick={leave}
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

        {/*
          1951:25801 — the 580x440 preview, radius 12, #1A1A1F.

          PINNED. Of eight avatar editors surveyed, eight keep the character on
          screen while you edit it, and one of them refuses even to let a
          palette cover it. Ours sat at the top of roughly 7,900px of controls,
          so by the time somebody reached "Nose width" the thing they were
          changing was four screens away.
        */}
        <div className="sticky top-0 z-20 -mx-[18px] bg-[#121214] px-[18px] pb-3 pt-1">
        <div className="relative aspect-[580/440] w-full overflow-hidden rounded-[12px] bg-[#1A1A1F]">
          {/* The character. 341² at (120,60) in the card's own 580x440. */}
          {preview ? (
            <>
              {/*
                FILLS THE CARD, like the cover. The square render is cropped
                rather than letterboxed: the figure sits 23%..97% down the
                square (74% of it) and this card shows 76%, so the whole
                character fits with nothing left over for bars. Anchored low so
                the head keeps sky above it.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="Your avatar"
                className="absolute inset-0 h-full w-full object-cover [object-position:center_85%] transition-opacity"
                style={{ opacity: drawing ? 0.55 : 1 }}
              />
            </>
          ) : (
            <span
              className="absolute inset-0 animate-pulse bg-white/[0.04]"
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
            onClick={leave}
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

          {/*
            THE PALETTE IS THE GROUND. The file draws it and says nothing about
            where it goes (every node in the frame has an empty `interactions`
            array), so this is a product decision rather than a transcription:
            of the four pieces of chrome on this card it is the one that looks
            like choosing a colour, and the ground is the only thing on the
            cover besides the character.
          */}
          <button
            type="button"
            onClick={() => setGroundOpen((v) => !v)}
            aria-pressed={groundOpen}
            aria-label="Change the background"
            className="ws-press absolute"
            style={{ left: pctX(531), top: pctY(398), width: 32, height: 32 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("/avatar-studio/palette.svg")} alt="" aria-hidden className="h-8 w-8" />
          </button>
        </div>

        {groundOpen && catalog && dna && (
          <div className="mt-3 max-h-[40vh] space-y-3 overflow-y-auto rounded-[12px] bg-[#1A1A1F] p-3">
            {/*
              THE WALLPAPER IS THE ENGINE'S OWN SCENE — 14 presets, six
              background modes, eleven patterns, two colours, a frame and a
              ring. It rides inside the share code, so choosing one needs no
              second field and no second picture, which is what six hand-drawn
              SVGs needed and never got.
            */}
            {sectionsFor(catalog, dna.kind)
              .filter((section) => section.tab === "scene")
              .map((section) =>
                visibleParams(catalog, dna, section).map((p) => (
                  <ParamControl
                    key={`${section.id}.${p.key}`}
                    param={p}
                    value={paramValue(dna, section, p)}
                    onChange={(v) => setDna(setParam(dna, section.id, p.key, v))}
                  />
                )),
              )}
          </div>
        )}

        {/*
          UNDO, REDO, START OVER — and an explicit way out that does not keep
          anything. Five of eight editors surveyed have undo; seven of eight
          have an explicit discard. We had neither, and a back arrow that threw
          the work away silently.
        */}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={hist.past.length === 0}
            className="ws-press ws-btn-sm rounded-full bg-white/[0.06] text-white/80 disabled:opacity-35"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={hist.future.length === 0}
            className="ws-press ws-btn-sm rounded-full bg-white/[0.06] text-white/80 disabled:opacity-35"
          >
            Redo
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={leave}
            className="ws-press ws-btn-sm rounded-full text-white/50 hover:text-white/80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dna || saving}
            className="ws-press ws-btn-sm rounded-full bg-white font-semibold text-black disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
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
                    selected={worn.length === 0}
                    onClick={() => catalog && dna && setDna(clearSlot(catalog, dna, activeSlot))}
                    label="None"
                    code={tileCodes[0] ?? null}
                  />
                )}
                {items.map((item, i) => (
                  <TileButton
                    key={item.id}
                    selected={worn.includes(item.id)}
                    onClick={() => catalog && dna && setDna(toggleItem(catalog, dna, item))}
                    label={item.label}
                    badge={item.limited ? "Limited" : item.premium ? "Premium" : null}
                    code={tileCodes[i + 1] ?? null}
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
            <>
            {/*
              ROLL THE WHOLE CHARACTER. Not the engine's own randomiser — that
              lives in a part of their source this repo does not carry — but
              the catalog publishes the ranges, the weighted options and the
              `random` hints the engine itself rolls against, so this rolls the
              same schema. See randomiseDna.
            */}
            <button
              type="button"
              onClick={() => catalog && dna && setDna(randomiseDna(catalog, dna))}
              disabled={!catalog || !dna}
              className="ws-press ws-btn-silver ws-btn-sm mb-3 w-full rounded-full font-semibold disabled:opacity-50"
            >
              Surprise me
            </button>
            <div className="grid grid-cols-4" style={{ gap: 8.446 }}>
              {starters.map((s, i) => (
                <TileButton
                  key={s.id}
                  selected={dna?.seed === s.dna.seed && dna?.kind === s.dna.kind}
                  onClick={() => {
                    setDna(s.dna);
                    setSlot(null);
                  }}
                  label={s.label}
                  /* Each is a DIFFERENT character, so each shows its own face.
                     Five labelled squares told nobody that Fox and Dragon are
                     not the same person in different clothes. */
                  code={starterCodes[i] ?? null}
                />
              ))}
            </div>

            {/*
              THE CHARACTER'S OWN PARAMETERS — 17 for a body, 17 for eyes, and
              so on down the schema. The wardrobe tab dresses somebody; this is
              where they are somebody in the first place, and a studio without
              it can only ever offer five faces.
            */}
            {catalog && dna && (
              <div className="mt-5 space-y-5">
                {sectionsFor(catalog, dna.kind).map((section) => {
                  const shown = visibleParams(catalog, dna, section);
                  if (!shown.length) return null;
                  return (
                    <section key={section.id}>
                      <h3 className="mb-2 text-[13px] font-semibold text-white/80">
                        {section.label}
                      </h3>
                      <div className="space-y-3">
                        {shown.map((p) => (
                          <ParamControl
                            key={p.key}
                            param={p}
                            value={paramValue(dna, section, p)}
                            onChange={(v) => setDna(setParam(dna, section.id, p.key, v))}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
            </>
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

      </div>
    </div>
  );
}

/** One wardrobe tile — the file's 131x122 at a 13.14 radius on #1A1A1F. */
function TileButton({
  selected,
  onClick,
  label,
  badge,
  code,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  badge?: string | null;
  /** The character wearing this one thing. Null until the rail is encoded. */
  code?: string | null;
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
      {/* The picture fills the tile and the name sits over its foot, so a
          garment is recognised by sight and confirmed by name. */}
      {code ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          /* `detail: low` halves the bytes of a 24-tile rail at no latency
             cost, and nobody is reading a hoodie's stitching at 82px. */
          src={avatarImageUrl(code, { crop: "full", size: 192, background: false, detail: "low" })}
          alt=""
          aria-hidden
          loading="lazy"
          className="absolute inset-0 h-full w-full object-contain p-1"
        />
      ) : (
        <span className="absolute inset-0 animate-pulse rounded-[13.138px] bg-white/[0.03]" aria-hidden />
      )}
      {badge && (
        <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/80">
          {badge}
        </span>
      )}
      <span className="relative z-10 line-clamp-2 bg-gradient-to-t from-[#1A1A1F] to-transparent text-[11px] leading-4 text-white/70">
        {label}
      </span>
    </button>
  );
}

/**
 * One of the character's own parameters.
 *
 * The schema has exactly four kinds and each wants a different control: a
 * slider whose ends are NAMED (the file says "Short"/"Tall", which is more use
 * than 0 and 1), a row of chips, a colour well, and a switch. Rendering them
 * all as text inputs would be the same amount of code and none of the meaning.
 */
function ParamControl({
  param,
  value,
  onChange,
}: {
  param: CatalogParam;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  /*
    ─── SEVEN STOPS, NOT A HUNDRED AND ONE ─────────────────────────────────────
    Of eight avatar editors surveyed, exactly one exposes continuous geometry
    sliders as a primary path, and it belongs to a company whose shipping apps
    contain no avatar editor. Bitmoji, Memoji, Mii, Ready Player Me, IMVU and
    ZEPETO all offer ZERO: every one of them is a short row of discrete
    choices. We had 61 continuous ranges at 101 notches each.

    The one product in that set that shares our architecture — a server-rendered
    preview — is the clearest precedent: its own API accepts steps of 0.01 and
    its editor ships 0.05, twenty times coarser, because each change costs a
    render. The quantisation IS the debounce. A drag across 101 notches gave no
    feedback at all (the debounce never fires mid-drag) and then one render on
    release; seven taps are seven renders into a finite, cacheable URL space.

    The file's own `ends` become the labels, which is why they get MORE useful
    here: "Short … Tall" beats 0 and 1.
  */
  if (param.type === "range") {
    const min = param.min ?? 0;
    const max = param.max ?? 1;
    const step = param.step ?? 0.01;
    const stops = Array.from({ length: STOPS }, (_, i) => {
      const raw = min + ((max - min) * i) / (STOPS - 1);
      return Number((Math.round(raw / step) * step).toFixed(4));
    });
    const current = typeof value === "number" ? value : ((param.default as number) ?? min);
    // Nearest stop, so a value saved before this existed still reads as chosen.
    const nearest = stops.reduce((best, v) =>
      Math.abs(v - current) < Math.abs(best - current) ? v : best,
    );
    return (
      <div>
        <span className="mb-1 flex items-baseline justify-between text-[12px] text-white/60">
          <span>{param.label}</span>
          {param.ends?.length === 2 && (
            <span className="text-[11px] text-white/35">
              {param.ends[0]} – {param.ends[1]}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label={param.label}>
          {stops.map((v, i) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={v === nearest}
              aria-label={`${param.label} ${i + 1} of ${STOPS}`}
              className={`h-7 flex-1 rounded-md transition-colors ${
                v === nearest ? "bg-white" : "bg-white/[0.08] hover:bg-white/[0.16]"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  /*
    A FREE-TEXT PARAMETER IS NOT A SWITCH. Items carry one — the slogan across
    a jersey or a hoodie — and with no branch for it the control fell through
    to the checkbox at the bottom of this function, which offered a tick box
    for a line of writing.
  */
  if (param.type === "text") {
    return (
      <label className="block">
        <span className="mb-1 block text-[12px] text-white/60">{param.label}</span>
        <input
          type="text"
          value={typeof value === "string" ? value : ((param.default as string) ?? "")}
          onChange={(e) => onChange(e.target.value)}
          maxLength={param.maxLength ?? 24}
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[13px] text-white outline-none focus:border-white/30"
        />
      </label>
    );
  }

  if (param.type === "choice") {
    return (
      <div>
        <span className="mb-1 block text-[12px] text-white/60">{param.label}</span>
        <div className="flex flex-wrap gap-1.5">
          {(param.options ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              aria-pressed={value === o.id}
              className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
                value === o.id ? "bg-white text-black" : "bg-white/[0.06] text-white/70"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (param.type === "color") {
    return (
      <label className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-white/60">{param.label}</span>
        <input
          type="color"
          value={typeof value === "string" ? value : ((param.default as string) ?? "#ffffff")}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
        />
      </label>
    );
  }

  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-white/60">{param.label}</span>
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-white"
      />
    </label>
  );
}

/*
  THE WARDROBE, AS SQUARE'S OWN STUDIO USES IT.

  Square draws its own avatar studio rather than embedding ArkPlay's, so it
  needs the two things an editor cannot invent: what may be worn, and what the
  result looks like. Both come from the service.

  ─── AN AVATAR IS A PLAIN JSON DOCUMENT ─────────────────────────────────────
  Its DNA is `{ v, kind, seed, sections, outfit, accessories }`: `outfit` and
  `accessories` are arrays of `{ id, params }`, and `sections` is one object of
  parameters per section. Dressing a character is therefore an ordinary edit to
  an ordinary object — no engine, no renderer, nothing of theirs in this
  bundle. The helpers below are pure functions over that document.

  ─── NOTHING HERE NEEDS A CREDENTIAL ────────────────────────────────────────
  `GET /catalog` and `POST /render` are both public; verified against the live
  service. The developer key ArkPlay issues is a SERVER-side secret and must
  never reach a browser.
*/

const ARKPLAY_ORIGIN = (
  process.env.NEXT_PUBLIC_ARKPLAY_URL ?? "https://game-server.tsionark.com"
).replace(/\/+$/, "");

const API = `${ARKPLAY_ORIGIN}/avatar/v1`;

/* ── The shapes, narrowed to what the studio reads ───────────────────────── */

export interface CatalogItemParam {
  type: string;
  key: string;
  label: string;
  default?: unknown;
}

export interface CatalogItem {
  id: string;
  label: string;
  /** Which slot it occupies — `top`, `shoes`, `head`… Items share a slot. */
  slot: string;
  /** `humanoid`, `creature`: an item is only offered to a body that can wear it. */
  kinds?: string[];
  params?: CatalogItemParam[];
  /** Paid, limited and NFT items exist in the schema; their art may not. */
  premium?: boolean;
  limited?: boolean;
  tier?: string;
}

export interface CatalogSlot {
  id: string;
  label: string;
  /** How many of this slot may be worn at once. Garment slots are 1. */
  capacity: number;
  kinds?: string[];
  kind?: string;
}

export interface Catalog {
  engineVersion: string;
  dnaVersion: number;
  slots: CatalogSlot[];
  items: CatalogItem[];
}

/** One worn thing. `params` carries its colours and options. */
export interface WornItem {
  id: string;
  params?: Record<string, unknown>;
}

export interface AvatarDNA {
  v: number;
  kind: string;
  seed: number;
  name?: string;
  sections?: Record<string, Record<string, unknown>>;
  outfit?: WornItem[];
  accessories?: WornItem[];
}

/* ── Reading the wardrobe ────────────────────────────────────────────────── */

/**
 * The schema the service is serving right now.
 *
 * Deliberately not baked into this bundle: ArkPlay adds items without asking
 * us, and a copied list would quietly stop offering the new ones.
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<Catalog> {
  const res = await fetch(`${API}/catalog`, { signal });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  return (await res.json()) as Catalog;
}

/** The slots a given body can actually wear, in the service's own order. */
export function slotsFor(catalog: Catalog, kind: string): CatalogSlot[] {
  return catalog.slots.filter((s) => !s.kinds?.length || s.kinds.includes(kind));
}

/** The items offered for one slot, for one kind of body. */
export function itemsForSlot(catalog: Catalog, slot: string, kind: string): CatalogItem[] {
  return catalog.items.filter(
    (i) => i.slot === slot && (!i.kinds?.length || i.kinds.includes(kind)),
  );
}

/* ── Dressing the character ──────────────────────────────────────────────── */

/** An item's own defaults, so a newly worn thing arrives in its intended colours. */
function defaultParams(item: CatalogItem): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of item.params ?? []) if (p.default !== undefined) out[p.key] = p.default;
  return out;
}

/** Which slot a worn id belongs to, according to the catalog. */
function slotOf(catalog: Catalog, id: string): string | null {
  return catalog.items.find((i) => i.id === id)?.slot ?? null;
}

/**
 * Wear an item, taking off whatever already held its slot.
 *
 * The slot is the rule, not the id: putting on a second pair of shoes means
 * taking the first pair off, and the catalog is what says the two are shoes.
 * Returns a NEW document — edits are immutable so undo stays a matter of
 * keeping the previous one.
 */
export function wearItem(catalog: Catalog, dna: AvatarDNA, item: CatalogItem): AvatarDNA {
  const list = dna.outfit ?? [];
  const kept = list.filter((w) => slotOf(catalog, w.id) !== item.slot);
  return { ...dna, outfit: [...kept, { id: item.id, params: defaultParams(item) }] };
}

/** Take off whatever is in a slot. Wearing nothing is a valid choice. */
export function clearSlot(catalog: Catalog, dna: AvatarDNA, slot: string): AvatarDNA {
  return { ...dna, outfit: (dna.outfit ?? []).filter((w) => slotOf(catalog, w.id) !== slot) };
}

/** What is worn in a slot right now, or null. */
export function wornInSlot(catalog: Catalog, dna: AvatarDNA, slot: string): string | null {
  return (dna.outfit ?? []).find((w) => slotOf(catalog, w.id) === slot)?.id ?? null;
}

/* ── Seeing the result ───────────────────────────────────────────────────── */

export interface PreviewOptions {
  crop?: "portrait" | "full" | "fit";
  size?: number;
  /** The service draws its own scene unless this is false. */
  background?: boolean;
  signal?: AbortSignal;
}

/**
 * A picture of a document that has no share code yet.
 *
 * `GET /render/{code}` needs a code, and an avatar being edited does not have
 * one — a code is only minted when it is saved. So the editor posts the
 * document itself and gets a PNG back. PNG rather than SVG on purpose:
 * measured against the live service, PNG answered in 1.15s against 3.1s, and
 * came back smaller.
 *
 * The caller owns the returned object URL and must revoke it.
 */
export async function renderPreview(
  dna: AvatarDNA,
  { crop = "full", size = 512, background = false, signal }: PreviewOptions = {},
): Promise<Blob> {
  const res = await fetch(`${API}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dna, format: "png", crop, size, background }),
    signal,
  });
  if (!res.ok) throw new Error(`render ${res.status}`);
  return res.blob();
}

/* ── Keeping the result ──────────────────────────────────────────────────── */

/**
 * ─── THE TWO ROUTES THAT DO NOT EXIST YET ───────────────────────────────────
 *
 * Square stores an avatar as a URL, and a render URL needs a SHARE CODE: the
 * ~250-character string that is the avatar's canonical form. Only the engine
 * makes one, and the engine is ArkPlay's — not on npm, not in this bundle.
 *
 * Probed against the live service, every candidate answers 404:
 *   POST /codes, /encode, /share, /dna        — DNA to code
 *   GET  /codes/{code}, /decode/{code}        — code back to DNA
 * and `POST /me/avatars`, which WOULD return a code, answers 401: it wants a
 * bearer token for an ArkPlay account, which a Square reader does not have.
 *
 * So these two call routes that are asked for and not yet shipped. They are
 * written against the agreed shape rather than worked around, because a
 * workaround here means either a copy of somebody else's proprietary engine
 * drifting out of step with their frozen defaults, or an avatar nobody can
 * reopen. The studio reports the failure plainly instead of pretending.
 */
export class AvatarCodecUnavailable extends Error {
  constructor(readonly status: number) {
    super(
      status === 404
        ? "Saving avatars is waiting on the avatar service — it cannot turn a look into a shareable code yet."
        : `The avatar service could not answer (${status}).`,
    );
    this.name = "AvatarCodecUnavailable";
  }
}

/** DNA to the share code Square stores. */
export async function encodeDna(dna: AvatarDNA, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API}/codes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dna }),
    signal,
  });
  if (!res.ok) throw new AvatarCodecUnavailable(res.status);
  const body = (await res.json()) as { code?: unknown };
  if (typeof body.code !== "string") throw new AvatarCodecUnavailable(res.status);
  return body.code;
}

/** A saved code back to the document, so editing continues rather than restarts. */
export async function decodeCode(code: string, signal?: AbortSignal): Promise<AvatarDNA> {
  const res = await fetch(`${API}/codes/${encodeURIComponent(code)}`, { signal });
  if (!res.ok) throw new AvatarCodecUnavailable(res.status);
  const body = (await res.json()) as { dna?: AvatarDNA };
  if (!body.dna) throw new AvatarCodecUnavailable(res.status);
  return body.dna;
}

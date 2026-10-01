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
  /** Relative likelihood when rolling at random. */
  weight?: number;
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
  sections?: CatalogSection[];
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

/**
 * The slots a given body can actually wear, in the service's own order.
 *
 * `custom` is excluded on purpose: the codec requires an uploaded image for it
 * ("A custom accessory had no usable image and was removed") and Square has no
 * way to upload one to that service. Offering the tile would be offering the
 * one item in the catalog that silently cannot be worn.
 */
export function slotsFor(catalog: Catalog, kind: string): CatalogSlot[] {
  return catalog.slots.filter(
    (s) => s.id !== "custom" && (!s.kinds?.length || s.kinds.includes(kind)),
  );
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

/*
  ─── A DOCUMENT HAS TWO WARDROBES, NOT ONE ──────────────────────────────────
  `outfit` holds GARMENTS and `accessories` holds everything else, and the
  codec sorts them by the catalog's own `slot.kind`, discarding anything found
  in the wrong list (vendor/arkplay-dna/dna/normalize.ts: `if (isGarment !==
  garment) continue`). Six of the 23 slots are garments.

  Writing everything to `outfit` therefore made 17 slots — hats, glasses,
  wings, necklaces, pets, every creature item — do NOTHING: the picture never
  changed, every tile in those rails was the same character, and the choice was
  dropped on save. 193 of the catalog's 256 items were unreachable, with 2650
  tests green over it.

  It also silently dropped GARMENTS: the codec reads only the first `max * 2`
  entries of a list, so accessories piling into `outfit` pushed the top someone
  picked last out of range and saved them with no top at all.
*/
function isGarmentSlot(catalog: Catalog, slot: string | null): boolean {
  if (!slot) return false;
  return catalog.slots.find((s) => s.id === slot)?.kind === "garment";
}

/** The list an item lives in, which the catalog decides and the codec enforces. */
function listFor(catalog: Catalog, slot: string): "outfit" | "accessories" {
  return isGarmentSlot(catalog, slot) ? "outfit" : "accessories";
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
  const key = listFor(catalog, item.slot);
  const kept = (dna[key] ?? []).filter((w) => slotOf(catalog, w.id) !== item.slot);
  return { ...dna, [key]: [...kept, { id: item.id, params: defaultParams(item) }] };
}

/** Take off whatever is in a slot. Wearing nothing is a valid choice. */
export function clearSlot(catalog: Catalog, dna: AvatarDNA, slot: string): AvatarDNA {
  /* BOTH lists, for the same reason wornInSlot reads both: a starter arrives
     with its glasses in `accessories`, and clearing only the slot's "proper"
     list left them on the face with None highlighted. */
  const strip = (list: WornItem[] | undefined) =>
    (list ?? []).filter((w) => slotOf(catalog, w.id) !== slot);
  return { ...dna, outfit: strip(dna.outfit), accessories: strip(dna.accessories) };
}

/**
 * What is worn in a slot right now, or null.
 *
 * Both lists are searched rather than the one the slot belongs to: a document
 * that arrived with an item on the other side (a starter, or anything saved
 * before this was understood) must still read as worn, or the editor shows
 * "None" selected over a character who is visibly wearing glasses.
 */
export function wornInSlot(catalog: Catalog, dna: AvatarDNA, slot: string): string | null {
  const found = [...(dna.outfit ?? []), ...(dna.accessories ?? [])].find(
    (w) => slotOf(catalog, w.id) === slot,
  );
  return found?.id ?? null;
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
 * ─── THE TWO ROUTES ARE OURS, FOR NOW ───────────────────────────────────────
 *
 * Square stores an avatar as a URL, and a render URL needs a SHARE CODE: the
 * ~250-character string that is the avatar's canonical form. The service has
 * no public route that makes one — probed, and `POST /codes`, `/encode`,
 * `/share`, `/dna` and `GET /codes/{code}`, `/decode/{code}` all 404, while
 * `POST /me/avatars` (which would return one) 401s for an ArkPlay sign-in a
 * Square reader has no way to hold.
 *
 * Asked for, and not waited on: Square runs the codec itself, server-side, at
 * `/api/avatar/codes`. The shapes below are deliberately the ones asked of
 * ArkPlay, so the day they ship theirs this becomes a change of base URL and
 * nothing else. See vendor/arkplay-dna/README.md for what is borrowed and how
 * it is kept honest.
 */
const CODEC = "/api/avatar/codes";

export class AvatarCodecUnavailable extends Error {
  /*
    A PLAIN FIELD, NOT A PARAMETER PROPERTY. This repo runs its .ts files
    directly under node, whose type stripping cannot execute
    `constructor(readonly status: number)` — the module throws
    ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX on import, so every test that touches it
    dies at load. tsc never says a word about it.
  */
  readonly status: number;

  constructor(status: number) {
    super(
      status === 400
        ? "That avatar couldn't be saved — it isn't a shape the encoder recognises."
        : "Couldn't reach the avatar encoder. Try again in a moment.",
    );
    this.name = "AvatarCodecUnavailable";
    this.status = status;
  }
}

/** DNA to the share code Square stores. */
export async function encodeDna(dna: AvatarDNA, signal?: AbortSignal): Promise<string> {
  const res = await fetch(CODEC, {
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
  const res = await fetch(`${CODEC}/${encodeURIComponent(code)}`, { signal });
  if (!res.ok) throw new AvatarCodecUnavailable(res.status);
  const body = (await res.json()) as { dna?: AvatarDNA };
  if (!body.dna) throw new AvatarCodecUnavailable(res.status);
  return body.dna;
}

/**
 * Share codes for a whole rail at once.
 *
 * A wardrobe has to show the garments, and a thumbnail is the character
 * wearing that one thing — so every tile needs a code. One call rather than
 * one per tile, because encoding is pure and cheap while a round trip is not,
 * and the pictures that follow are ordinary cacheable image URLs the browser
 * fetches lazily by itself.
 *
 * A garment that cannot be encoded answers null in its place rather than
 * failing the rail: one odd item should cost its own tile, not the screen.
 */
export async function encodeMany(
  dnas: AvatarDNA[],
  signal?: AbortSignal,
): Promise<(string | null)[]> {
  if (dnas.length === 0) return [];
  const res = await fetch(CODEC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dnas }),
    signal,
  });
  if (!res.ok) throw new AvatarCodecUnavailable(res.status);
  const body = (await res.json()) as { codes?: unknown };
  return Array.isArray(body.codes)
    ? body.codes.map((c) => (typeof c === "string" ? c : null))
    : dnas.map(() => null);
}

/* ── The character itself: body, face, hair, species ─────────────────────── */

export interface CatalogChoice {
  id: string;
  label: string;
  /** Relative likelihood when rolling at random. Absent means 1. */
  weight?: number;
}

export interface CatalogParam {
  type: "range" | "choice" | "color" | "toggle";
  key: string;
  label: string;
  default?: unknown;
  /** range */
  min?: number;
  max?: number;
  step?: number;
  /** range: what the two ends mean, e.g. ["Short", "Tall"]. */
  ends?: [string, string] | string[];
  /** choice */
  options?: CatalogChoice[];
  /** color: which family of colours this belongs to. */
  palette?: string;
  /**
   * Only offered when another parameter holds (or does not hold) one of these.
   *
   * THREE FORMS, and reading only the first one crashes: of the 19 conditions
   * in the live schema, 6 use `in`, 10 use `notIn`, and 3 name a `section`
   * other than their own. An implementation that assumed `in` threw
   * "Cannot read properties of undefined" on the ten `notIn` cases, which took
   * the whole editor down with it.
   */
  visibleIf?: { key: string; in?: unknown[]; notIn?: unknown[]; section?: string };
  /** How the engine rolls this one. */
  random?: { mode?: string; sd?: number; p?: number };
}

export interface CatalogSection {
  id: string;
  label: string;
  /** Which strip of the editor it belongs under. */
  tab: string;
  kinds?: string[];
  params: CatalogParam[];
}

/** The sections a given body has at all — a creature has no facial hair. */
export function sectionsFor(catalog: Catalog, kind: string): CatalogSection[] {
  return (catalog.sections ?? []).filter((s) => !s.kinds?.length || s.kinds.includes(kind));
}

/**
 * The parameters worth showing right now.
 *
 * `visibleIf` is the schema's own conditional: a prosthetic's colour means
 * nothing until a prosthetic is chosen. Drawing it anyway would offer a
 * control that changes the picture not at all, which reads as broken.
 *
 * The condition may point at a parameter in ANOTHER section, so the whole
 * document is resolved against, not just this section's own values.
 */
export function visibleParams(
  catalog: Catalog,
  dna: AvatarDNA,
  section: CatalogSection,
): CatalogParam[] {
  return section.params.filter((p) => {
    const cond = p.visibleIf;
    if (!cond) return true;
    const owner =
      cond.section && cond.section !== section.id
        ? (catalog.sections ?? []).find((s) => s.id === cond.section)
        : section;
    if (!owner) return true;
    const current =
      dna.sections?.[owner.id]?.[cond.key] ??
      owner.params.find((q) => q.key === cond.key)?.default;
    if (cond.in) return cond.in.includes(current);
    if (cond.notIn) return !cond.notIn.includes(current);
    return true;
  });
}

/** What a section's parameter is set to, falling back to the schema's default. */
export function paramValue(dna: AvatarDNA, section: CatalogSection, p: CatalogParam): unknown {
  return dna.sections?.[section.id]?.[p.key] ?? p.default;
}

/** Change one parameter. Immutable, like every edit here. */
export function setParam(
  dna: AvatarDNA,
  sectionId: string,
  key: string,
  value: unknown,
): AvatarDNA {
  return {
    ...dna,
    sections: {
      ...(dna.sections ?? {}),
      [sectionId]: { ...(dna.sections?.[sectionId] ?? {}), [key]: value },
    },
  };
}

/* ── Rolling a character at random ───────────────────────────────────────── */

/**
 * Every colour the designers actually chose, grouped by the family it belongs
 * to.
 *
 * Random hex is how a character ends up with mustard skin and lime hair: the
 * schema names a `palette` per colour but does not publish its swatches, so
 * the honest source of "a plausible colour for this" is the set of DEFAULTS
 * the catalog already uses for that same palette — each one picked by somebody.
 */
function palettes(catalog: Catalog): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (p: CatalogParam) => {
    if (p.type !== "color" || !p.palette || typeof p.default !== "string") return;
    const list = out.get(p.palette) ?? [];
    if (!list.includes(p.default)) list.push(p.default);
    out.set(p.palette, list);
  };
  for (const s of catalog.sections ?? []) s.params.forEach(add);
  for (const i of catalog.items) (i.params as CatalogParam[] | undefined)?.forEach(add);
  return out;
}

function pick<T>(list: T[], weight: (x: T) => number = () => 1): T | undefined {
  const total = list.reduce((sum, x) => sum + Math.max(0, weight(x)), 0);
  if (total <= 0) return list[Math.floor(Math.random() * list.length)];
  let roll = Math.random() * total;
  for (const x of list) {
    roll -= Math.max(0, weight(x));
    if (roll <= 0) return x;
  }
  return list[list.length - 1];
}

/** A number in range, clustered near the default when the schema says so. */
function rollRange(p: CatalogParam): number {
  const min = p.min ?? 0;
  const max = p.max ?? 1;
  const step = p.step ?? 0.01;
  let value: number;
  if (p.random?.mode === "normal" && typeof p.default === "number") {
    // Box–Muller, so a build or a nose lands near the middle far more often
    // than at an extreme — a uniform roll makes almost everybody a caricature.
    const u = Math.random() || 1e-9;
    const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    value = p.default + gauss * (p.random.sd ?? 0.2) * (max - min);
  } else {
    value = min + Math.random() * (max - min);
  }
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
}

/**
 * A whole character, rolled.
 *
 * Deliberately NOT the engine's own randomiser: that lives in a part of their
 * source this repo does not carry, and the catalog already publishes
 * everything needed — the ranges, the weighted options, and the `random` hints
 * the engine itself rolls against.
 *
 * The SEED changes too. It is what the engine varies the un-parameterised
 * details by, so leaving it alone makes every roll a variation on one face.
 */
export function randomiseDna(catalog: Catalog, dna: AvatarDNA): AvatarDNA {
  const swatches = palettes(catalog);
  let next: AvatarDNA = { ...dna, seed: Math.floor(Math.random() * 0xffffffff) };

  for (const section of sectionsFor(catalog, dna.kind)) {
    const values: Record<string, unknown> = { ...(next.sections?.[section.id] ?? {}) };
    for (const p of section.params) {
      /*
        `keep` MEANS KEEP. The schema marks 13 parameters this way — a
        creature's body plan and gait, and the house art style (outline, ink,
        shading, grade, detail). Rolling them turned a fox into an aquatic blob
        and re-drew Square's own look, which is the opposite of what a
        randomiser is for.
      */
      if (p.random?.mode === "keep") continue;
      if (p.type === "range") values[p.key] = rollRange(p);
      else if (p.type === "choice" && p.options?.length) {
        values[p.key] = pick(p.options, (o) => o.weight ?? 1)?.id ?? p.default;
      } else if (p.type === "toggle") {
        // These are rare on purpose — glowing eyes at p=0.03, not a coin flip.
        values[p.key] = Math.random() < (p.random?.p ?? 0.5);
      } else if (p.type === "color") {
        const choices = (p.palette && swatches.get(p.palette)) || [];
        if (choices.length) values[p.key] = pick(choices) ?? p.default;
      }
    }
    next = { ...next, sections: { ...(next.sections ?? {}), [section.id]: values } };
  }

  /*
    And dressed: one item per slot that has any, sometimes none — into the
    RIGHT list. Piling everything into `outfit` is what made 17 of the 23 slots
    silently vanish, and a rolled character came back wearing nothing it had
    been given but its clothes.
  */
  const outfit: WornItem[] = [];
  const accessories: WornItem[] = [];
  for (const slot of slotsFor(catalog, dna.kind)) {
    const choices = itemsForSlot(catalog, slot.id, dna.kind);
    if (!choices.length) continue;
    // An empty slot is a real look; without this everybody wears everything.
    if (Math.random() < 0.25) continue;
    const chosen = pick(choices, (i) => i.weight ?? 1);
    if (!chosen) continue;
    const params: Record<string, unknown> = {};
    for (const p of (chosen.params as CatalogParam[] | undefined) ?? []) {
      if (p.type === "color") {
        const choicesForPalette = (p.palette && swatches.get(p.palette)) || [];
        params[p.key] = choicesForPalette.length ? pick(choicesForPalette) : p.default;
      } else if (p.default !== undefined) params[p.key] = p.default;
    }
    (listFor(catalog, slot.id) === "outfit" ? outfit : accessories).push({
      id: chosen.id,
      params,
    });
  }
  return { ...next, outfit, accessories };
}

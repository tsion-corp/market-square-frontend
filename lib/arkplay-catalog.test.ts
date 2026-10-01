import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  AvatarCodecUnavailable,
  type AvatarDNA,
  type Catalog,
  clearSlot,
  itemsForSlot,
  randomiseDna,
  sectionsFor,
  slotsFor,
  wearItem,
  wornInSlot,
  setParam,
  visibleParams,
} from "./arkplay-catalog.ts";

/*
  THIS FILE EXISTING IS HALF THE POINT.

  The module once declared `constructor(readonly status: number)` — a
  TypeScript parameter property, which this repo's own runner cannot execute:
  node strips types rather than compiling them, so importing the module threw
  ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX before a single test ran. `tsc --noEmit`
  was perfectly happy. Nothing imported it from a test, so the suite stayed
  green over a module that could not be loaded at all.

  Importing it here is the guard: if that syntax comes back, this file fails to
  load and the suite says so.
*/

const catalog = JSON.parse(
  readFileSync(new URL("./fixtures/arkplay-catalog.json", import.meta.url), "utf8"),
) as Catalog;

const BASE: AvatarDNA = { v: 1, kind: "humanoid", seed: 1234, sections: {}, outfit: [] };

describe("the wardrobe schema", () => {
  it("loads under the runner that actually runs it", () => {
    assert.equal(typeof randomiseDna, "function");
    assert.equal(new AvatarCodecUnavailable(400).status, 400);
  });

  it("offers a body only the sections it can have", () => {
    const humanoid = sectionsFor(catalog, "humanoid").map((s) => s.id);
    const creature = sectionsFor(catalog, "creature").map((s) => s.id);
    assert.ok(humanoid.includes("hair"), "a person has hair");
    assert.ok(!creature.includes("facialHair"), "a creature has no beard");
  });

  /*
    A control that cannot change the picture reads as broken, so the schema's
    own condition decides what is drawn.

    THE SCHEMA USES THREE FORMS and reading only the first one crashes: of the
    19 conditions live, 6 are `in`, 10 are `notIn`, and 3 name a `section`
    other than their own. The first implementation here assumed `in` and threw
    "Cannot read properties of undefined" on every `notIn`, taking the whole
    editor down. This walks all of them against a default document.
  */
  it("resolves every form of condition the schema actually uses", () => {
    const seen = { in: 0, notIn: 0, crossSection: 0 };
    for (const kind of ["humanoid", "creature"]) {
      const doc: AvatarDNA = { ...BASE, kind };
      for (const section of sectionsFor(catalog, kind)) {
        const shown = new Set(visibleParams(catalog, doc, section).map((p) => p.key));
        for (const p of section.params) {
          const cond = p.visibleIf;
          if (!cond) continue;
          if (cond.in) seen.in++;
          if (cond.notIn) seen.notIn++;
          if (cond.section && cond.section !== section.id) seen.crossSection++;

          const owner =
            cond.section && cond.section !== section.id
              ? (catalog.sections ?? []).find((x) => x.id === cond.section)
              : section;
          const current = owner?.params.find((q) => q.key === cond.key)?.default;
          const expected = cond.in
            ? cond.in.includes(current)
            : cond.notIn
              ? !cond.notIn.includes(current)
              : true;
          assert.equal(
            shown.has(p.key),
            owner ? expected : true,
            `${section.id}.${p.key} visibility`,
          );
        }
      }
    }
    assert.ok(seen.in > 0 && seen.notIn > 0, `both forms exercised: ${JSON.stringify(seen)}`);
  });

  it("changes one parameter without disturbing the rest", () => {
    const once = setParam(BASE, "body", "height", 0.9);
    const twice = setParam(once, "body", "build", 0.2);
    assert.equal(twice.sections?.body?.height, 0.9, "the first edit survives the second");
    assert.equal(twice.sections?.body?.build, 0.2);
    assert.equal(BASE.sections?.body, undefined, "edits are immutable");
  });
});

describe("rolling a character", () => {
  /*
    Verified against the live service when this was written: six rolls encoded
    to six DISTINCT share codes and all six rendered 200. This pins the two
    properties that made that possible.
  */
  it("rolls a different character each time, seed included", () => {
    const rolls = Array.from({ length: 6 }, () => randomiseDna(catalog, BASE));
    assert.equal(new Set(rolls.map((r) => r.seed)).size, 6, "the seed varies");
    assert.ok(
      new Set(rolls.map((r) => JSON.stringify(r.sections))).size > 1,
      "and so does the character",
    );
  });

  it("stays inside the schema's own ranges and options", () => {
    const rolled = randomiseDna(catalog, BASE);
    for (const section of sectionsFor(catalog, "humanoid")) {
      for (const p of section.params) {
        // A `keep` parameter is left ABSENT, and absent means the default.
        if (p.random?.mode === "keep") continue;
        const v = rolled.sections?.[section.id]?.[p.key];
        if (p.type === "range" && typeof v === "number") {
          assert.ok(v >= (p.min ?? 0) && v <= (p.max ?? 1), `${section.id}.${p.key} in range`);
        }
        if (p.type === "choice" && p.options?.length) {
          assert.ok(
            p.options.some((o) => o.id === v),
            `${section.id}.${p.key} is one of the offered options`,
          );
        }
      }
    }
  });

  /* Random hex is how somebody ends up with mustard skin. Colours are sampled
     from the defaults the designers already chose. */
  it("only ever uses a colour the catalog itself uses", () => {
    const known = new Set<string>();
    for (const s of catalog.sections ?? [])
      for (const p of s.params) if (p.type === "color" && typeof p.default === "string") known.add(p.default);
    for (const i of catalog.items)
      for (const p of i.params ?? []) if (p.type === "color" && typeof p.default === "string") known.add(p.default);

    const rolled = randomiseDna(catalog, BASE);
    for (const section of sectionsFor(catalog, "humanoid")) {
      for (const p of section.params) {
        if (p.type !== "color") continue;
        const v = rolled.sections?.[section.id]?.[p.key];
        if (typeof v === "string") assert.ok(known.has(v), `${v} is a colour somebody chose`);
      }
    }
  });
});

/*
  ─── THE WARDROBE HAS TWO LISTS, AND WRITING TO ONE LOST THREE QUARTERS OF IT ──
  `outfit` holds garments and `accessories` holds everything else; the codec
  sorts by the catalog's own `slot.kind` and DISCARDS anything in the wrong
  list. Six of 23 slots are garments, so routing everything to `outfit` made
  hats, glasses, wings, necklaces, pets and every creature item do nothing:
  the picture never changed, every tile in those rails was the same character,
  and the choice was dropped on save. 193 of 256 items were unreachable with
  2650 tests green over it.
*/
describe("dressing a character", () => {
  const garmentSlots = new Set(
    catalog.slots.filter((s) => s.kind === "garment").map((s) => s.id),
  );

  it("puts every item in the list its slot belongs to", () => {
    for (const kind of ["humanoid", "creature"]) {
      const base: AvatarDNA = { ...BASE, kind, outfit: [], accessories: [] };
      for (const slot of slotsFor(catalog, kind)) {
        const item = itemsForSlot(catalog, slot.id, kind)[0];
        if (!item) continue;
        const worn = wearItem(catalog, base, item);
        const list = garmentSlots.has(slot.id) ? worn.outfit : worn.accessories;
        const other = garmentSlots.has(slot.id) ? worn.accessories : worn.outfit;
        assert.ok(
          list?.some((w) => w.id === item.id),
          `${kind}/${slot.id}/${item.id} lands in the right list`,
        );
        assert.ok(
          !other?.some((w) => w.id === item.id),
          `${kind}/${slot.id}/${item.id} is not in the wrong one`,
        );
      }
    }
  });

  /* A starter arrives with its glasses in `accessories`; clearing only the
     slot's "proper" list left them on the face with None highlighted. */
  it("reads and clears a slot whichever list the item arrived in", () => {
    const strays: AvatarDNA = {
      ...BASE,
      outfit: [{ id: "round-glasses" }],
      accessories: [{ id: "tshirt" }],
    };
    assert.equal(wornInSlot(catalog, strays, "eyes"), "round-glasses", "found in the wrong list");
    assert.equal(wornInSlot(catalog, strays, "top"), "tshirt");
    const bare = clearSlot(catalog, clearSlot(catalog, strays, "eyes"), "top");
    assert.equal(wornInSlot(catalog, bare, "eyes"), null, "and taken off from it");
    assert.equal(wornInSlot(catalog, bare, "top"), null);
  });

  /*
    The codec reads only the first `max * 2` entries of a list, so accessories
    piling into `outfit` pushed the garment picked LAST out of range — somebody
    who played with hats and then chose a top saved with no top at all.
  */
  it("keeps a garment picked after many accessories", () => {
    let dna: AvatarDNA = { ...BASE, outfit: [], accessories: [] };
    for (const slot of slotsFor(catalog, "humanoid")) {
      if (garmentSlots.has(slot.id)) continue;
      const item = itemsForSlot(catalog, slot.id, "humanoid")[0];
      if (item) dna = wearItem(catalog, dna, item);
    }
    const top = itemsForSlot(catalog, "top", "humanoid")[0];
    dna = wearItem(catalog, dna, top);
    assert.ok((dna.outfit?.length ?? 0) <= 6, "garments cannot crowd each other out");
    assert.equal(wornInSlot(catalog, dna, "top"), top.id);
  });

  /* The one slot the codec refuses without an uploaded image, which Square
     has no way to provide — so it is not offered rather than offered dead. */
  it("does not offer the slot that cannot be worn", () => {
    assert.ok(catalog.slots.some((s) => s.id === "custom"), "the catalog has it");
    assert.ok(!slotsFor(catalog, "humanoid").some((s) => s.id === "custom"), "we do not");
  });

  it("dresses a rolled character into both lists", () => {
    const rolled = randomiseDna(catalog, { ...BASE, outfit: [], accessories: [] });
    for (const w of rolled.outfit ?? []) {
      const slot = catalog.items.find((i) => i.id === w.id)?.slot;
      assert.ok(garmentSlots.has(slot!), `${w.id} is a garment`);
    }
    for (const w of rolled.accessories ?? []) {
      const slot = catalog.items.find((i) => i.id === w.id)?.slot;
      assert.ok(!garmentSlots.has(slot!), `${w.id} is not a garment`);
    }
  });
});

/* The schema marks 13 parameters never-random — a creature's body plan and
   gait, and the house art style. Rolling them turned a fox into an aquatic
   blob and re-drew Square's own look. */
describe("what a roll must leave alone", () => {
  it("never re-rolls a parameter the schema marks keep", () => {
    const fox: AvatarDNA = { ...BASE, kind: "creature", sections: { species: { plan: "quadruped" } } };
    for (let i = 0; i < 40; i++) {
      const rolled = randomiseDna(catalog, fox);
      assert.equal(rolled.sections?.species?.plan, "quadruped", "a fox stays a fox");
      for (const section of sectionsFor(catalog, "creature")) {
        for (const p of section.params) {
          if (p.random?.mode !== "keep") continue;
          /*
            The EFFECTIVE value, not the stored one: leaving a parameter absent
            is how "unchanged" is spelled, since absent resolves to the
            schema's default. Comparing raw storage would fail a roll that
            correctly touched nothing.
          */
          const was: unknown = fox.sections?.[section.id]?.[p.key] ?? p.default;
          const after: unknown = rolled.sections?.[section.id]?.[p.key] ?? p.default;
          assert.equal(after, was, `${section.id}.${p.key}`);
        }
      }
    }
  });
});

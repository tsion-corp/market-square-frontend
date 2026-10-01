import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  AvatarCodecUnavailable,
  type AvatarDNA,
  type Catalog,
  randomiseDna,
  sectionsFor,
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
    let seen = { in: 0, notIn: 0, crossSection: 0 };
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

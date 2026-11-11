import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../assets/codeinjection/itemExpansionManifest.json";

const tag = (bytes: Uint8Array, name: string) => {
  const code = [...name].map((c) => c.charCodeAt(0));
  for (let i = 0; i + 8 <= bytes.length; i += 4) if (code.every((c, n) => bytes[i + n] === c) && bytes[i + 4] === 1) return i;
  return -1;
};

describe("item expansion for Black / White", () => {
  it("ships the five Black and White DLLs matching the manifest", () => {
    for (const game of ["B", "W"] as const) {
      const dlls = (manifest.games as Record<string, { dlls: Record<string, { fileName: string; sha256: string; targets: unknown[] }> }>)[game]!.dlls;
      expect(Object.keys(dlls).sort()).toEqual(["bag", "battle", "battleBag", "core", "field"]);
      for (const part of Object.values(dlls)) {
        const bytes = readFileSync(new URL(`../assets/codeinjection/${part.fileName}`, import.meta.url));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(part.sha256);
      }
      const core = new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${dlls.core.fileName}`, import.meta.url)));
      const catalog = tag(core, "PWIC");
      expect(catalog).toBeGreaterThan(0);
      expect(core[catalog + 6] | (core[catalog + 7] << 8)).toBe(627); // first ID above the retail range
      expect(core[catalog + 8] | (core[catalog + 9] << 8)).toBe(1024 - 627);
      const pockets = tag(core, "PWIP");
      expect(core[pockets + 6] | (core[pockets + 7] << 8)).toBe(627);
    }
  });

  it("edits the same save and item-limit words in both games", () => {
    const literals = (game: string) => (manifest.games as Record<string, { dlls: { core: { literals: Array<{ retail: string; value: string }> } } }>)[game]!
      .dlls.core.literals.map(({ retail, value }) => `${retail}->${value}`);
    expect(literals("B")).toEqual(literals("W"));
    expect(literals("B")).toEqual(expect.arrayContaining(["0x00000d54->0x000006fc", "0x31053527->0x32495750", "0x01802027->0x03002001"]));
    expect(literals("B").filter((edit) => edit === "0x00000272->0x000003ff")).toHaveLength(5);
  });
});

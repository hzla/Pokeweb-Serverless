import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../assets/codeinjection/megaEvolutionManifest.json";
import { MEGA_ROUTE_CAPACITY, writeMegaEvolutionTable, type MegaEvolutionConfig } from "../pokeweb/megaEvolutionModel";
import { parseRpm } from "../pokeweb/rpm";

const dll = (game: "W2" | "B2") => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PokewebMega${game}.dll`, import.meta.url)));

const config: MegaEvolutionConfig = {
  version: 1,
  routes: [
    { species: 6, trigger: 660, sourceForm: 0, targetForm: 1 },
    { species: 6, trigger: 661, sourceForm: 0, targetForm: 2 },
    { species: 384, trigger: 620, sourceForm: 0, targetForm: 1, moveTrigger: true },
  ],
  messages: { reacting: 1153, evolved: 1156, wish: 1451 },
  animationMove: 737,
  revealFrame: 244,
  autoFoes: false,
};

describe("Mega Evolution runtime", () => {
  for (const game of ["W2", "B2"] as const) {
    it(`${game}: hooks only battle overlay 167 and carries one route table`, () => {
      const rpm = parseRpm(dll(game), { allowedMagics: ["DLXF"] });
      const modules = new Set(rpm.relocations.map((relocation) => relocation.target.module).filter((module) => module !== "base"));
      expect([...modules]).toEqual(["167"]);
      expect(rpm.metadata.PMCGameID).toBe(game);
      const targets = manifest.games[game].targets;
      expect(targets).toHaveLength(8);
      expect(targets.filter((target) => target.kind === "THUMB_BRANCH_LINK")).toHaveLength(3);
    });

    it(`${game}: writes routes, messages and options into the PWMG table`, () => {
      const source = dll(game);
      const out = writeMegaEvolutionTable(source, config);
      const at = manifest.games[game].tableOffset;
      const view = new DataView(out.buffer, out.byteOffset + at, 24 + MEGA_ROUTE_CAPACITY * 8);
      expect(view.getUint32(0, true)).toBe(0x474d5750);
      expect(view.getUint16(6, true)).toBe(3);
      expect([view.getUint16(8, true), view.getUint16(10, true), view.getUint16(12, true), view.getUint16(14, true)]).toEqual([1153, 1156, 1451, 737]);
      expect(view.getUint16(16, true)).toBe(1357); // the build's SE defaults are kept
      expect(view.getUint16(22, true)).toBe(0);
      expect([view.getUint16(24 + 8, true), view.getUint16(26 + 8, true), view.getUint8(28 + 8), view.getUint8(29 + 8)]).toEqual([6, 661, 0, 2]);
      expect(view.getUint8(30 + 16)).toBe(1);
      // Only the table changes.
      out.forEach((byte, index) => { if (index < at || index >= at + 24 + MEGA_ROUTE_CAPACITY * 8) expect(byte).toBe(source[index]); });
    });
  }

  it("refuses more routes than the runtime holds", () => {
    const routes = Array.from({ length: MEGA_ROUTE_CAPACITY + 1 }, (_, index) => ({ species: index + 1, trigger: 1, sourceForm: 0, targetForm: 1 }));
    expect(() => writeMegaEvolutionTable(dll("W2"), { ...config, routes })).toThrow(/192/);
  });
});

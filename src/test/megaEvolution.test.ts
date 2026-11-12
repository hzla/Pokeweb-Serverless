import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../assets/codeinjection/megaEvolutionManifest.json";
import { MEGA_ROUTE_CAPACITY, megaClassOf, writeMegaEvolutionTable, type MegaEvolutionConfig } from "../pokeweb/megaEvolutionModel";
import { parseRpm } from "../pokeweb/rpm";

const dll = (game: "W2" | "B2" | "B" | "W") => new Uint8Array(readFileSync(new URL(`../assets/codeinjection/PokewebMega${game}.dll`, import.meta.url)));

const config: MegaEvolutionConfig = {
  version: 1,
  routes: [
    { species: 6, trigger: 660, sourceForm: 0, targetForm: 1 },
    { species: 6, trigger: 661, sourceForm: 0, targetForm: 2 },
    { species: 384, trigger: 620, sourceForm: 0, targetForm: 1, moveTrigger: true },
  ],
  messages: { reacting: 1153, evolved: 1156, wish: 1451 },
  animationMove: 737,
  ringItem: 124,
  revealFrame: 244,
  autoFoes: false,
};

describe("Mega Evolution runtime", () => {
  for (const game of ["W2", "B2", "B", "W"] as const) {
    // Black 2 / White 2 hook three call sites; Black / White also the form change's two (its own are short thunks).
    const overlay = game.endsWith("2") ? "167" : "93";
    const callSites = game.endsWith("2") ? 3 : 5;
    it(`${game}: hooks only battle overlay ${overlay} and carries one route table`, () => {
      const rpm = parseRpm(dll(game), { allowedMagics: ["DLXF"] });
      const modules = new Set(rpm.relocations.map((relocation) => relocation.target.module).filter((module) => module !== "base"));
      expect([...modules]).toEqual([overlay]);
      expect(rpm.metadata.PMCGameID).toBe(game);
      const targets = manifest.games[game].targets;
      expect(targets).toHaveLength(8);
      expect(targets.filter((target) => target.kind === "THUMB_BRANCH_LINK")).toHaveLength(callSites);
    });

    it(`${game}: writes routes, messages and options into the PWMG table`, () => {
      const source = dll(game);
      const out = writeMegaEvolutionTable(source, config);
      const at = manifest.games[game].tableOffset;
      const view = new DataView(out.buffer, out.byteOffset + at, 28 + MEGA_ROUTE_CAPACITY * 8);
      expect(view.getUint32(0, true)).toBe(0x474d5750);
      expect(view.getUint16(4, true)).toBe(2); // version 2: the ring item, routes at +28
      expect(view.getUint16(24, true)).toBe(124);
      expect(view.getUint16(6, true)).toBe(3);
      expect([view.getUint16(8, true), view.getUint16(10, true), view.getUint16(12, true), view.getUint16(14, true)]).toEqual([1153, 1156, 1451, 737]);
      expect(view.getUint16(16, true)).toBe(1357); // the build's SE defaults are kept
      expect(view.getUint16(22, true)).toBe(0);
      expect([view.getUint16(28 + 8, true), view.getUint16(30 + 8, true), view.getUint8(32 + 8), view.getUint8(33 + 8)]).toEqual([6, 661, 0, 2]);
      expect(view.getUint8(34 + 16)).toBe(1);
      // Only the table changes.
      out.forEach((byte, index) => { if (index < at || index >= at + 28 + MEGA_ROUTE_CAPACITY * 8) expect(byte).toBe(source[index]); });
    });

    it(`${game}: writes the universal stones and each route's class`, () => {
      const routes = config.routes.map((route, index) => ({ ...route, megaClass: [2, 3, 1][index] }));
      const at = manifest.games[game].tableOffset;
      const read = (universalStones?: number) => {
        const view = new DataView(writeMegaEvolutionTable(dll(game), { ...config, routes, universalStones }).buffer, at, 28 + MEGA_ROUTE_CAPACITY * 8);
        return [view.getUint16(26, true), ...routes.map((_, index) => view.getUint8(28 + index * 8 + 7))];
      };
      expect(read(740)).toEqual([740, 2, 3, 1]);
      expect(read(undefined)).toEqual([0, 0, 0, 0]); // no universal stones: no classes
    });

    it(`${game}: still writes a version 1 table (a DLL staged before the Mega Ring) with routes at +24`, () => {
      const source = dll(game).slice();
      const at = manifest.games[game].tableOffset;
      new DataView(source.buffer, source.byteOffset + at, 8).setUint16(4, 1, true);
      const view = new DataView(writeMegaEvolutionTable(source, config).buffer, at, 24 + MEGA_ROUTE_CAPACITY * 8);
      expect([view.getUint16(24 + 8, true), view.getUint16(26 + 8, true)]).toEqual([6, 661]);
    });
  }

  it("Black and White hook the same battle code at their own addresses", () => {
    const kinds = (game: "B" | "W") => manifest.games[game].targets.map((target) => `${target.kind} ${target.segment}`);
    expect(kinds("B")).toEqual(kinds("W"));
    expect(manifest.games.B.targets.map((target) => target.address)).not.toEqual(manifest.games.W.targets.map((target) => target.address));
    expect(manifest.games.B.tableOffset).toBe(manifest.games.W.tableOffset);
  });

  it("reads a Mega form's universal stone class from its name", () => {
    expect(["Charizard-Mega-X", "Mega Charizard X", "Venusaur-Mega", "Mega Venusaur", "Venusaur-Mega-G", "Mega Absol Z", "Rayquaza-Mega",
      "Mega Mewtwo Y", "Rotom-Heat", "Charizard"].map(megaClassOf)).toEqual([2, 2, 1, 1, 5, 4, 1, 3, 0, 0]);
  });

  it("refuses more routes than the runtime holds", () => {
    const routes = Array.from({ length: MEGA_ROUTE_CAPACITY + 1 }, (_, index) => ({ species: index + 1, trigger: 1, sourceForm: 0, targetForm: 1 }));
    expect(() => writeMegaEvolutionTable(dll("W2"), { ...config, routes })).toThrow(/192/);
  });
});

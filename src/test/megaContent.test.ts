import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { GMAX_MEGAS, MEGA_CONTENT, MEGA_RING_ITEM, UNIVERSAL_STONES, megaSpriteCredits } from "../pokeweb/megaContentModel";
import { megaClassOf } from "../pokeweb/megaEvolutionModel";
import type { PwanLibraryManifest } from "../pokeweb/pwanLibraryModel";
import { detectSaveFormat, retailPocketItems } from "../pokeweb/itemSaveFormat";
import { rawSaveBytesFromDesmumeDsv } from "../pokeweb/testBattle";

const zip = new Uint8Array(readFileSync(new URL("../assets/mega/megaContent.zip", import.meta.url)));
const files = unzipSync(zip);

describe("Mega content package", () => {
  it("matches its manifest", () => {
    expect(createHash("sha256").update(zip).digest("hex")).toBe(MEGA_CONTENT.zipSha256);
  });

  it("has the 71 Megas of species 1-649, each with a stone or a move", () => {
    expect(MEGA_CONTENT.forms).toHaveLength(71);
    for (const form of MEGA_CONTENT.forms) {
      expect(form.species).toBeGreaterThan(0);
      expect(form.species).toBeLessThanOrEqual(649);
      expect(form.stats).toHaveLength(6);
      expect(form.types).toHaveLength(2);
      expect(Boolean(form.stone) !== Boolean(form.move)).toBe(true);
    }
    expect(MEGA_CONTENT.forms.find((form) => form.move)?.name).toBe("Mega Rayquaza");
    const charizardX = MEGA_CONTENT.forms.find((form) => form.key === "MEGA_CHARIZARD_X")!;
    expect(charizardX).toMatchObject({ species: 6, types: [9, 15], stats: [78, 130, 111, 100, 130, 85], stone: 659 });
  });

  it("gives every Mega a stone in the dedicated item range", () => {
    const stones = new Map(MEGA_CONTENT.stones.map((stone) => [stone.id, stone]));
    for (const form of MEGA_CONTENT.forms.filter((candidate) => candidate.stone)) {
      const stone = stones.get(form.stone!)!;
      expect(stone.forms).toContain(form.key);
      expect(stone.id).toBeGreaterThanOrEqual(657);
      expect(stone.id).toBeLessThanOrEqual(780);
    }
    expect(stones.get(659)?.name).toBe("Charizardite X");
  });

  it("ships every file it references", () => {
    const referenced = [
      MEGA_CONTENT.animation.script, ...Object.values(MEGA_CONTENT.animation.particles), MEGA_CONTENT.genericStoneIcon,
      ...MEGA_CONTENT.stones.flatMap((stone) => stone.icon ? [stone.icon] : []),
      ...MEGA_CONTENT.forms.flatMap((form) => [
        ...Object.values(form.sprites).flatMap((sprite) => sprite.source === "library" ? [] : [sprite.source]),
        ...(form.icon ? [form.icon.male, form.icon.female] : []),
      ]),
    ];
    for (const name of referenced) expect(files[name], name).toBeDefined();
    for (const name of Object.keys(files).filter((key) => key.endsWith(".rgba"))) expect(files[name]).toHaveLength(32 * 32 * 4);
  });

  it("takes every Mega's sprites from the PWAN library, each side credited", () => {
    const credits = megaSpriteCredits();
    expect(MEGA_CONTENT.forms.every((form) => form.library && Object.values(form.sprites).every((sprite) => sprite.source === "library"))).toBe(true);
    for (const credit of credits) {
      expect(credit.front).not.toBe("—");
      expect(credit.front).not.toBe("Unknown");
      expect(credit.back).not.toBe("Unknown");
    }
    expect(credits.find((credit) => credit.name === "Mega Venusaur")).toMatchObject({ front: "Smogon/Sprites Animados Contributors", back: "Smogon/Sprites Animados Contributors" });
    expect(credits.find((credit) => credit.name === "Mega Pidgeot")).toMatchObject({ front: "Aronousqui20", back: "Aronousqui20" });
    expect(credits.find((credit) => credit.name === "Mega Charizard X")).toMatchObject({ front: "Smogon Sprite Project; hexagonereal", back: "Smogon/Sprites Animados Contributors" });
    expect(MEGA_CONTENT.credits.map((credit) => credit.name)).toEqual(["Dararo", "Hibiki"]);
  });
});

describe("Mega Ring", () => {
  it("is in the Key Items of the bundled Black / White and Black 2 / White 2 test saves", () => {
    for (const [name, family] of [["test.sav", "BW2"], ["white.dsv", "BW1"]] as const) {
      const raw = rawSaveBytesFromDesmumeDsv(new Uint8Array(readFileSync(new URL(`../assets/testbattle/${name}`, import.meta.url))));
      expect(detectSaveFormat(raw, family), name).toBe("retail");
      expect(retailPocketItems(raw, family, 4), name).toContainEqual([MEGA_RING_ITEM, 1]);
    }
  });

  it("uses White2Upgrade's ID, an unused retail slot, and its icon", () => {
    expect(MEGA_RING_ITEM).toBe(124);
    expect(files[MEGA_CONTENT.genericStoneIcon]).toHaveLength(32 * 32 * 4);
  });
});

describe("G-Max Megas and universal stones", () => {
  const library = JSON.parse(readFileSync(new URL("../assets/pwan/library/manifest.json", import.meta.url), "utf8")) as PwanLibraryManifest;

  it("takes the 13 G-Max Megas of species 1-649 from the PWAN library, named -Mega-G where the species has a Mega", () => {
    const entries = library.entries.filter((entry) => entry.key.startsWith("GMAX_MEGA_") && entry.speciesId <= 649);
    expect(GMAX_MEGAS.map((gmax) => gmax.key).sort()).toEqual(entries.map((entry) => entry.key).sort());
    const hasMega = new Set(MEGA_CONTENT.forms.map((form) => form.species));
    for (const gmax of GMAX_MEGAS) {
      const entry = entries.find((candidate) => candidate.key === gmax.key)!;
      expect(entry).toMatchObject({ speciesId: gmax.species, hasFront: true, hasBack: true });
      expect(entry.icon).toBeTruthy();
      expect(megaClassOf(entry.name), entry.name).toBe(hasMega.has(gmax.species) ? 5 : 1);
      expect(gmax.stone.endsWith(" G")).toBe(hasMega.has(gmax.species));
      expect(gmax.stone.length).toBeLessThanOrEqual(16);
      if (gmax.iconOf) expect(files[MEGA_CONTENT.stones.find((stone) => stone.name === gmax.iconOf)!.icon!]).toBeTruthy();
    }
  });

  it("has a universal stone per class, Megite to Megite G, with descriptions that fit the bag", () => {
    expect(UNIVERSAL_STONES.map((stone) => stone.name)).toEqual(["Megite", "Megite X", "Megite Y", "Megite Z", "Megite G"]);
    for (const stone of UNIVERSAL_STONES) for (const line of stone.description.split("\\n")) expect(line.length).toBeLessThanOrEqual(34);
  });
});

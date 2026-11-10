import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { MEGA_CONTENT, megaSpriteCredits } from "../pokeweb/megaContentModel";

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

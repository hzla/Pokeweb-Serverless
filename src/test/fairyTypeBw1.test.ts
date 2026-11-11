import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readU32 } from "../nds/binary";
import { fairyTypePatchAvailable, parseGeneralPatch } from "../pokeweb/generalPatchModel";
import { detectFairyTypePatch } from "../pokeweb/romPatchModel";
import blackBindings from "../assets/data/abilityBindingsB1.json";
import whiteBindings from "../assets/data/abilityBindingsW1.json";
import blackMoveBindings from "../assets/data/moveRecipeBindingsB1.json";
import whiteMoveBindings from "../assets/data/moveRecipeBindingsW1.json";
import type { ProjectState } from "../pokeweb/projectStore";

const patch = (name: string) => parseGeneralPatch(new Uint8Array(readFileSync(new URL(`../assets/patches/${name}`, import.meta.url))));
const section = (sections: ReturnType<typeof patch>, name: string) => sections.find((entry) => entry.name === name)!.payload;
const spans = (payload: Uint8Array, start: number) => {
  const out: Array<{ address: number; bytes: Uint8Array }> = [];
  for (let at = start; at < payload.length;) {
    const address = readU32(payload, at), length = readU32(payload, at + 4);
    out.push({ address, bytes: payload.subarray(at + 8, at + 8 + length) });
    at += 8 + length;
  }
  return out;
};

describe("Fairy Type Support for Black / White", () => {
  const black = patch("fairy-b.bin"), white = patch("fairy-w.bin");

  it("ships Frost's Black patch and a White patch with the same sections", () => {
    expect(new TextDecoder().decode(section(black, "version"))).toBe("pokemon b");
    expect(new TextDecoder().decode(section(white, "version"))).toBe("pokemon w");
    expect(white.map((entry) => [entry.name, entry.payload.length])).toEqual(black.map((entry) => [entry.name, entry.payload.length]));
    for (const { name, payload } of black) if (name.startsWith("narc")) expect(section(white, name)).toEqual(payload);
  });

  it("moves overlay 93 down by its 0x2100-byte prefix, at White's addresses (0x20 above Black's)", () => {
    for (const [sections, base] of [[black, 0x021b6100], [white, 0x021b6120]] as const) {
      const ov93 = section(sections, "ov_93");
      expect([readU32(ov93, 0), readU32(ov93, 8)]).toEqual([base - 0x2100, base]);
      const y9 = section(sections, "y9");
      expect([readU32(y9, 8), readU32(y9, 12), readU32(y9, 16)]).toEqual([93, base - 0x2100, 0x3fb20]);
    }
  });

  it("relocates only the pointers: the move-handler table, the chart and Hall of Fame table references", () => {
    for (const name of ["ov_93", "ov_94", "ov_131", "ov_180", "ov_208"]) {
      const b = spans(section(black, name), 16), w = spans(section(white, name), 16);
      expect(w.map((span) => span.address)).toEqual(b.map((span) => span.address));
      b.forEach((span, index) => {
        const other = w[index]!.bytes;
        if (name === "ov_93" && span.address === 0) {
          // 258 (move, handler) pairs, then the routing helper and the 18x18 chart, unchanged.
          for (let i = 0; i < 258; i++) {
            expect(readU32(other, i * 8)).toBe(readU32(span.bytes, i * 8));
            expect(readU32(other, i * 8 + 4)).toBe(readU32(span.bytes, i * 8 + 4) + 0x20);
          }
          expect(other.subarray(258 * 8)).toEqual(span.bytes.subarray(258 * 8));
          return;
        }
        for (let k = 0; k + 4 <= span.bytes.length; k += 4) {
          const was = readU32(span.bytes, k), now = readU32(other, k);
          if (was !== now) {
            expect(now - was, `${name} 0x${span.address.toString(16)}+${k}`).toBe(0x20);
            expect(was >= 0x021b4000 && was < 0x021b8400).toBe(true);
          }
        }
      });
    }
    const prefix = spans(section(white, "ov_93"), 16).find((span) => span.address === 0)!.bytes;
    const chart = prefix.subarray(0x1f80, 0x1f80 + 18 * 18);
    expect(chart[17 * 18 + 15]).toBe(8); // Fairy is super effective on Dragon
    expect(chart[15 * 18 + 17]).toBe(0); // Dragon does nothing to Fairy
  });

  it("sets the Fairy type icon's palette in each game's table", () => {
    const b = spans(section(black, "arm9"), 1), w = spans(section(white, "arm9"), 1);
    expect(b.map((span) => span.address)).toEqual([0xfc4, 0x9bd09]);
    expect(w.map((span) => span.address)).toEqual([0xfc4, 0x9bd21]);
    expect(w[1]!.bytes[0]).toBe(2);
  });

  it("gives White's battle signatures the Fairy variants Black's have", () => {
    for (const [b, w] of [[blackBindings, whiteBindings], [blackMoveBindings, whiteMoveBindings]] as const) {
      const variants = (bindings: typeof b | typeof w) => Object.entries(bindings.functions as Record<string, { variants?: unknown[] }>)
        .filter(([, signature]) => signature.variants?.length).map(([name]) => name).sort();
      expect(variants(w)).toEqual(variants(b));
      expect(variants(w)).toEqual(expect.arrayContaining(["ServerControl_CheckMoveEffectiveness", "GetTypeEffectiveness", "BW1_HAND_WAZA_AddMoveHandler"]));
    }
  });

  it("is offered for Black and White", () => {
    for (const version of ["B", "W", "B2", "W2"] as const) expect(fairyTypePatchAvailable(version)).toBe(true);
    const project = { session: { baseVersion: "W", baseRom: "BW", fairy: false }, patches: { dirtyOverlayIds: [], applied: {} } } as unknown as ProjectState;
    expect(detectFairyTypePatch(project)).toBe("unpatched");
    project.session.fairy = true;
    expect(detectFairyTypePatch(project)).toBe("patched");
  });
});

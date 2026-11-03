import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { auditMoveAnimationShakes, getMoveAnimationShakeTicks, repairMoveAnimationShakes } from "../pokeweb/moveAnimationShakeAudit";
import { compileMoveAnimation, decompileMoveAnimationBytes, parseMoveAnimationScript } from "../pokeweb/moveAnimationModel";
import type { ProjectState } from "../pokeweb/projectStore";

const expectedMoves = [722, 759, 827, 829, 831, 832, 836, 837, 840, 843, 844, 846, 847, 851, 852, 854, 855, 859, 860, 861, 865, 869, 870, 872, 873, 880, 882, 884, 885, 886, 887, 888, 889, 890, 891, 895, 896, 897, 898, 900, 901, 904, 905, 906, 908, 909, 911, 912, 913, 927, 929, 937, 938, 941, 950, 954, 959, 961, 962, 963, 964, 965, 971, 976];

function assets(path: string) {
  const entries = unzipSync(new Uint8Array(readFileSync(new URL(path, import.meta.url))));
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as {
    moves: { sourceMoveId: number; targetMoveId: number; animation: string }[];
  };
  return manifest.moves.map(move => ({ ...move, bytes: entries[move.animation] }));
}

describe("bundled sprite shake cancellation audit", () => {
  it("uses native movement-step timing and distinguishes immediate position setters", () => {
    expect(getMoveAnimationShakeTicks([16, 2, 1229, 0, 2, 1, 3])).toBe(23);
    expect(getMoveAnimationShakeTicks([16, 2, 1229, 0, 2, 1, 1])).toBe(7);
    expect(getMoveAnimationShakeTicks([16, 2, 1229, 0, 2, 0, 3])).toBe(12);
    expect(getMoveAnimationShakeTicks([16, 3, 1229, 0, 2, 1, 1])).toBe(15);
    expect(getMoveAnimationShakeTicks([16, 6, 0, 0, 1, 1, 10])).toBe(0);
  });

  it("accounts for command ticks, actor independence and Pokémon completion waits", () => {
    const script = [
      "ShakeSprite DEFENDER, 2, 1229, 0, 2, 0, 3", // Twelve native ticks.
      "Wait 11", // One command tick plus twelve wait ticks safely spans it.
      "ShakeSprite DEFENDER, 2, 1229, 0, 2, 0, 3",
      "ShakeSprite ATTACKER, 2, 1229, 0, 2, 1, 10",
      "LetCMDsFinish POKEMON",
      "ShakeSprite DEFENDER, 2, 1229, 0, 2, 1, 10",
      "TerminateMoveScript",
    ].join("\n");
    expect(auditMoveAnimationShakes(script)).toEqual([]);
    expect(repairMoveAnimationShakes(script).script).toBe(script);
  });

  it("shortens a charge shake before a lunge and keeps a primary lunge over a conflicting shake", () => {
    const script = [
      "ShakeSprite ATTACKER, 2, 819, 0, 2, 1, 12",
      "Wait 12",
      "MoveSprite ATTACKER, ROUNDTRIP, 0, 0, -1px, 49152, 0, 4096, 0",
      "ShakeSprite ATTACKER, 2, 819, 0, 2, 1, 12",
      "LetCMDsFinish ALL",
      "TerminateMoveScript",
    ].join("\n");
    const fixed = repairMoveAnimationShakes(script);
    expect(fixed.repairs.map(repair => repair.action)).toEqual(["shorten", "omit"]);
    expect(fixed.script.split("\n")[0]).toBe("ShakeSprite 14, 2, 819, 0, 2, 1, 1");
    expect(fixed.script.split("\n")[3]).toBe("Wait 0");
    expect(auditMoveAnimationShakes(fixed.script)).toEqual([]);
  });

  it("audits all 285 scripts and 300 bodies, repairs the 64 affected moves, and preserves other commands", () => {
    const source = assets("./fixtures/move-expansion/overlapping-shake-scripts.zip");
    const shipped = assets("../assets/data/white2upgradeGen6MoveAnimations.zip");
    expect(source).toHaveLength(285);
    let bodies = 0, repairCount = 0;
    const affected: number[] = [];
    for (const move of source) {
      const original = decompileMoveAnimationBytes(move.bytes);
      const fixed = repairMoveAnimationShakes(original);
      const before = parseMoveAnimationScript(original), after = parseMoveAnimationScript(fixed.script);
      bodies += before.scripts.size; repairCount += fixed.repairs.length;
      if (fixed.repairs.length) affected.push(move.targetMoveId);
      expect(auditMoveAnimationShakes(fixed.script), `move ${move.targetMoveId}`).toEqual([]);
      expect(repairMoveAnimationShakes(fixed.script).repairs).toEqual([]);
      const a = [...before.scripts.values()], b = [...after.scripts.values()];
      expect(b).toHaveLength(a.length);
      for (let variant = 0; variant < a.length; variant += 1) {
        expect(b[variant]).toHaveLength(a[variant].length);
        for (let index = 0; index < a[variant].length; index += 1) {
          const old = a[variant][index], next = b[variant][index];
          if (old.name !== "ShakeSprite") {
            expect({ name: next.name, params: next.params }).toEqual({ name: old.name, params: old.params });
          } else if (next.name === "Wait") {
            expect(next.params).toEqual([0]);
          } else {
            expect(next.name).toBe("ShakeSprite");
            expect(next.params.slice(0, 6)).toEqual(old.params.slice(0, 6));
            if (JSON.stringify(next.params) !== JSON.stringify(old.params)) expect(next.params[6]).toBeGreaterThan(0);
            expect(next.params[6]).toBeLessThanOrEqual(old.params[6]);
          }
        }
      }
      const expected = fixed.repairs.length ? compileMoveAnimation({} as ProjectState, move.sourceMoveId, fixed.script) : move.bytes;
      expect(shipped.find(entry => entry.targetMoveId === move.targetMoveId)?.bytes).toEqual(expected);
    }
    expect(bodies).toBe(300);
    expect(affected).toEqual(expectedMoves);
    expect(repairCount).toBe(99);
  });
});

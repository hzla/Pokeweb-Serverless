import { describe, expect, it } from "vitest";
import { readU16, writeU16 } from "../nds/binary";
import { battleBranchTarget, battleRuntimeResolver } from "../pokeweb/battleRuntimeBindings";
import { inspectAbilityEffects } from "../pokeweb/abilityEffectsModel";
import { ITEM_NATIVE_FUNCTIONS } from "../pokeweb/itemNativeRuntime";
import { makeItemEffectsProject } from "./fixtures/itemEffectsProject";

const helpers = ["BattleEventVar_MulValue", "BattleEvent_AddItem", "BattleRandom", "DivideMaxHp", "DivideMaxHPZeroCheck"] as const;

describe("battle runtime bindings", () => {
  it.each([[0, 0], [0x1800, 0x3000]])("recognizes relocated ARM helper calls in ability services (%i, %i)", (shift, move) => {
    const { project, base, offsets, rom } = makeItemEffectsProject(shift, move, true, true);
    const overlay = project.overlays[167]!;
    const resolver = battleRuntimeResolver(overlay, base, project.arm9, rom.arm9RamAddress);
    // Model Black 2's changed overlay-to-ARM9 distances independently of the
    // ability catalog, which originally left these BLX operands unrelocated.
    for (const name of helpers) {
      const signature = ITEM_NATIVE_FUNCTIONS[name], offset = offsets.get(name)!;
      for (const call of signature.calls) {
        if ((readU16(Uint8Array.from(Buffer.from(signature.hex, "hex")), call.offset + 2) & 0xf800) !== 0xe800) continue;
        const target = rom.arm9RamAddress + 0xf000;
        const delta = target - ((base + offset + call.offset + 4) & ~3);
        writeU16(overlay, offset + call.offset, 0xf000 | (delta >> 12) & 0x7ff);
        writeU16(overlay, offset + call.offset + 2, 0xe800 | (delta >> 1) & 0x7ff);
        expect(battleBranchTarget(overlay, offset + call.offset, base)).toBe(target);
      }
      expect(resolver.resolve(name).address).toBe(base + offset);
    }
    expect(inspectAbilityEffects(project)).toMatchObject({ editable: true });
    overlay[offsets.get("BattleEventVar_MulValue")!] ^= 1;
    expect(inspectAbilityEffects(project).editable).toBe(false);
  });
});

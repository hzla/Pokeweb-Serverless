import { describe, expect, it } from "vitest";
import { readU16, writeU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { applyAbilityStorageFix, getAbilityStorageFixStatus } from "../pokeweb/abilityStorageFixModel";
import { exportModifiedRom } from "../pokeweb/exportRom";
import type { ProjectState } from "../pokeweb/projectStore";
import { makeTwlRom } from "./fixtures/dsiRom";

function fixture() {
  const battle = new Uint8Array(0x3a700);
  const effects = new Uint8Array(0x2b00);
  const ai = new Uint8Array(0x2400);
  const put = (data: Uint8Array, offset: number, hex: string) => data.set(Buffer.from(hex, "hex"), offset);
  put(battle, 0x21380, "407e7047");
  put(battle, 0x3a368, "0098311c0cf054fcf8bd");
  put(battle, 0x3a682, "301c211c0cf0c7faf8bd");
  put(effects, 0x1bc2, "201c002100f057ff10bd");
  put(effects, 0x2a78, "034a800012681218222000011150704780421f02");
  put(effects, 0x2a8c, "0349800009680918222000010858704780421f02");
  put(ai, 0x234a, "7c35381c5ef0cdfde855e85d00284ed1");

  const entries = [[167, 0x02199900, battle], [168, 0x021ddaa0, effects], [170, 0x0217f640, ai]] as const;
  const table = new Uint8Array(32 * entries.length);
  const files = entries.map(([id, base, bytes], fileId) => {
    [id, base, bytes.length, 0, 0, 0, fileId, 0].forEach((word, index) => writeU32(table, fileId * 32 + index * 4, word));
    return { fileId, bytes };
  });
  const rom = new NintendoDSRom(makeTwlRom("IRDO")).save({ arm9OverlayTable: table, insertedFiles: files });
  const project: ProjectState = {
    originalRomBytes: rom,
    session: { romName: "test", baseVersion: "W2", baseRom: "BW2", fairy: false, fileIds: {}, blacklist: [] },
    romInfo: { title: "test", idCode: "IRDO", fileName: "test.nds", size: rom.length },
    arm9: new NintendoDSRom(rom).arm9,
    overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [],
  };
  return { project, battle, effects, ai };
}

describe("Ability Storage Fix", () => {
  it("exports both popup edits and the matching AI lookup without PMC or losing a staged edit", async () => {
    const { project, battle } = fixture();
    project.overlays[167] = battle.slice();
    project.overlays[167][0] = 0xaa;
    project.patches = { dirtyOverlayIds: [167] };
    expect(getAbilityStorageFixStatus(project).state).toBe("ready");
    expect((await applyAbilityStorageFix(project)).status).toBe("applied");
    expect((await applyAbilityStorageFix(project)).status).toBe("already-applied");
    expect(project.patches.dirtyOverlayIds).toEqual([167, 168, 170]);
    expect(project.codeInjection).toBeUndefined();

    const exported = await exportModifiedRom(project);
    const overlays = new NintendoDSRom(exported).loadArm9Overlays([167, 168, 170]);
    expect(overlays.get(167)?.data[0]).toBe(0xaa);
    expect(readU16(overlays.get(167)!.data, 0x3a368)).toBe(0x1c20);
    expect(readU16(overlays.get(167)!.data, 0x3a682)).toBe(0x7b28);
    expect(readU16(overlays.get(168)!.data, 0x2a84)).toBe(0x5411);
    expect(readU16(overlays.get(168)!.data, 0x2a98)).toBe(0x5c08);
    expect(readU16(overlays.get(170)!.data, 0x234c)).toBe(0x7e70);
    expect(getAbilityStorageFixStatus({ ...project, originalRomBytes: exported, patches: undefined, overlays: {} }).state).toBe("installed");
  });

  it("leaves the project intact if a required instruction has been changed", async () => {
    const { project, ai } = fixture();
    project.overlays[170] = ai;
    project.patches = { dirtyOverlayIds: [170] };
    ai[0x234c] = 0;
    await expect(applyAbilityStorageFix(project)).rejects.toThrow("Battle code differs in overlay 170");
    expect(Object.keys(project.overlays)).toEqual(["170"]);
    expect(project.overlays[170]).toBe(ai);
    expect(project.patches.dirtyOverlayIds).toEqual([170]);
  });
});

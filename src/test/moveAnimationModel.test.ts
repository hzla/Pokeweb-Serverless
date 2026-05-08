import { describe, expect, it } from "vitest";
import type { NarcName } from "../pokeweb/constants";
import { compileMoveAnimation, decompileMoveAnimation, updateMoveAnimationScript } from "../pokeweb/moveAnimationModel";
import { updateMoveField } from "../pokeweb/moveItemModel";
import type { NarcStore, ProjectState } from "../pokeweb/projectStore";

const SINGLE_SCRIPT = `
.include "B2W2_MOVSCRCMD.s"
.align 4

.word 1 @ Count
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60
.word SCRIPT_60

SCRIPT_60:
     MoveCamera 1, 11, 16, 0, 9
     LoadSPA 165
     TerminateMoveScript
`;

const MULTI_SCRIPT = `
.word 2 @ Count
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_A
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B
.word SCRIPT_B

SCRIPT_A:
     LoadSPA 1
     TerminateMoveScript

SCRIPT_B:
     LoadSPA 2
     CallMoveAnimation 7
`;

describe("moveAnimationModel", () => {
  it("compiles and decompiles old assembly-like move animation scripts", () => {
    const project = makeProject();
    const bytes = compileMoveAnimation(project, 1, SINGLE_SCRIPT);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain(".word 1 @ Count");
    expect(text).toContain("MoveCamera 1, 11, 16, 0, 9");
    expect(text).toContain("LoadSPA 165");
    expect(text).toContain("TerminateMoveScript");
    expect([...compileMoveAnimation(project, 1, text)]).toEqual([...bytes]);
  });

  it("supports multi-script headers with repeated label references", () => {
    const project = makeProject();
    const bytes = compileMoveAnimation(project, 1, MULTI_SCRIPT);
    project.narcs.move_animations!.rawFiles[1] = bytes;
    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain(".word 2 @ Count");
    expect(text.match(/\.word SCRIPT_/gu)?.length).toBe(28);
    expect(text).toContain("LoadSPA 1");
    expect(text).toContain("LoadSPA 2");
    expect(text).toContain("CallMoveAnimation 7");
  });

  it("rejects invalid script text", () => {
    const project = makeProject();

    expect(() => compileMoveAnimation(project, 1, SINGLE_SCRIPT.replace("MoveCamera", "NopeCamera"))).toThrow(/Unknown animation command/u);
    expect(() => compileMoveAnimation(project, 1, SINGLE_SCRIPT.replace("MoveCamera 1, 11, 16, 0, 9", "MoveCamera 1"))).toThrow(/expects 5/u);
    expect(() => compileMoveAnimation(project, 1, SINGLE_SCRIPT.replace("SCRIPT_60:", "SCRIPT_61:"))).toThrow(/missing label/u);
    expect(() => compileMoveAnimation(project, 1, SINGLE_SCRIPT.replace("TerminateMoveScript", "CMD_5"))).toThrow(/terminating command/u);
  });

  it("updates and marks animation NARC subfiles dirty", () => {
    const project = makeProject();

    updateMoveAnimationScript(project, 1, SINGLE_SCRIPT);
    updateMoveAnimationScript(project, 673, SINGLE_SCRIPT);

    expect(project.narcs.move_animations?.dirty.has(1)).toBe(true);
    expect(project.narcs.battle_animations?.dirty.has(112)).toBe(true);
  });

  it("copies Animation ID scripts without dirtying the moves NARC", () => {
    const project = makeProject();
    const source = compileMoveAnimation(project, 1, SINGLE_SCRIPT);
    project.narcs.move_animations!.rawFiles[7] = source;

    updateMoveField(project, 1, "animation", "7");

    expect([...project.narcs.move_animations!.rawFiles[1]]).toEqual([...source]);
    expect(project.narcs.move_animations?.dirty.has(1)).toBe(true);
    expect(project.narcs.moves?.dirty.has(1)).toBe(false);
  });
});

function makeProject(): ProjectState {
  return {
    session: {
      romName: "test",
      baseVersion: "W2",
      baseRom: "BW2",
      fairy: false,
      fileIds: { moves: 1, move_animations: 2, battle_animations: 3 },
      blacklist: [],
    },
    romInfo: { title: "test", idCode: "TEST", fileName: "test.nds", size: 0 },
    arm9: new Uint8Array(),
    overlays: {},
    narcs: {
      moves: makeStore("moves", [new Uint8Array(32), new Uint8Array(32)]),
      move_animations: makeStore("move_animations", Array.from({ length: 16 }, () => compileMinimalScript())),
      battle_animations: makeStore("battle_animations", Array.from({ length: 128 }, () => compileMinimalScript())),
    } as Partial<Record<NarcName, NarcStore>>,
    texts: { banks: { moves: ["None", "Tackle"] } },
    formats: {
      moves: [
        [1, "type"],
        [1, "effect_category"],
        [1, "category"],
        [1, "power"],
        [1, "accuracy"],
        [1, "pp"],
        [1, "priority"],
        [1, "hits"],
        [2, "result_effect"],
        [1, "effect_chance"],
        [1, "status"],
        [1, "min_turns"],
        [1, "max_turns"],
        [1, "crit"],
        [1, "flinch"],
        [2, "effect"],
        [1, "recoil"],
        [1, "healing"],
        [1, "target"],
        [1, "stat_1"],
        [1, "stat_2"],
        [1, "stat_3"],
        [1, "magnitude_1"],
        [1, "magnitude_2"],
        [1, "magnitude_3"],
        [1, "stat_chance_1"],
        [1, "stat_chance_2"],
        [1, "stat_chance_3"],
        [2, "flag"],
        [2, "properties"],
      ],
    },
    trpokInfo: [],
  };
}

function makeStore(name: NarcName, rawFiles: Uint8Array[]): NarcStore {
  return {
    name,
    fileId: 1,
    sourcePath: "test",
    fileCount: rawFiles.length,
    rawFiles,
    records: new Map(),
    dirty: new Set(),
  };
}

function compileMinimalScript(): Uint8Array {
  const out = new Uint8Array(4 + 14 * 4 + 2);
  out[0] = 1;
  for (let offset = 4; offset < 4 + 14 * 4; offset += 4) out[offset] = 60;
  out[4 + 14 * 4] = 77;
  return out;
}

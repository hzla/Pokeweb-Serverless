import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { NarcName } from "../pokeweb/constants";
import {
  compileMoveAnimation,
  decompileMoveAnimation,
  decompileMoveAnimationBytes,
  formatMoveAnimationScriptParameters,
  getMoveAnimationTargetInfo,
  parseMoveAnimationScript,
  repairLegacyMoveAnimationArchives,
  repairMoveAnimationScriptBytes,
  updateMoveAnimationScript,
} from "../pokeweb/moveAnimationModel";
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
  it("decompiles uniform one-script animations as a simple body", () => {
    const project = makeProject();
    const bytes = compileMoveAnimation(project, 1, SINGLE_SCRIPT);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).not.toContain(".word 1 @ Count");
    expect(text).not.toContain("SCRIPT_60:");
    expect(text).toContain("MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9");
    expect(text).toContain("LoadSPA 165");
    expect(text).toContain("TerminateMoveScript");
    expect([...compileMoveAnimation(project, 1, text)]).toEqual([...bytes]);
  });

  it("compiles simple body scripts by inferring the standard one-script header", () => {
    const project = makeProject();
    const body = `
MoveCamera 1, 11, 16, 0, 9
LoadSPA 165
TerminateMoveScript
`;

    const bytes = compileMoveAnimation(project, 1, body);
    const parsed = parseMoveAnimationScript(body);

    expect(parsed.count).toBe(1);
    expect(parsed.headerLabels).toHaveLength(14);
    expect(new Set(parsed.headerLabels)).toEqual(new Set(["SCRIPT_60"]));
    expect(parsed.labelOrder).toEqual(["SCRIPT_60"]);
    expect([...bytes]).toEqual([...compileMoveAnimation(project, 1, SINGLE_SCRIPT)]);
  });

  it("accepts semantic enum parameters for BW2 animation scripts", () => {
    const project = makeProject();
    const friendly = `
MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9
LoadSPA 165
TerminateMoveScript
`;

    const bytes = compileMoveAnimation(project, 1, friendly);
    const text = decompileMoveAnimationBytes(bytes);

    expect([...bytes]).toEqual([...compileMoveAnimation(project, 1, SINGLE_SCRIPT)]);
    expect(text).toContain("MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9");
  });

  it("keeps legacy attack/defence selector aliases compile-compatible", () => {
    const project = makeProject();
    const legacy = `
MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENCE, 16, 0, 9
DoSPAAnimation 0, 1, SIDE_ATTACK, SIDE_DEFENCE, 0, 0, 0, 1x, 1x, 1x, 1x
FreezeSprite POKEMON_DEFENCE, ANIMATION_START
AudioContainer CONTROL_CONTINUE
TerminateMoveScript
`;

    const text = decompileMoveAnimationBytes(compileMoveAnimation(project, 1, legacy));

    expect(text).toContain("MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9");
    expect(text).toContain("Emit 0, 1, SIDE_ATTACKER, SIDE_DEFENDER, 0, 0, 0, 1x, 1x, 1x, 1x");
    expect(text).toContain("ToggleFreezeSprite POKEMON_DEFENDER, START");
    expect(text).toContain("AudioContainer CONTINUE");
  });

  it("accepts semantic particle selectors and FX32 multipliers", () => {
    const project = makeProject();
    const script = `
DoSPAAnimation 0, 1, SIDE_ATTACKER, SIDE_NONE, 2px, 0, 0, 1x, 0.5x, 2x, 1x
TerminateMoveScript
`;
    const parsed = parseMoveAnimationScript(script);
    const command = parsed.scripts.get("SCRIPT_60")?.[0];

    expect(command?.params).toEqual([0, 1, 9, 8, 8192, 0, 0, 4096, 2048, 8192, 4096]);
    expect(decompileMoveAnimationBytes(compileMoveAnimation(project, 1, script))).toContain("Emit 0, 1, SIDE_ATTACKER, SIDE_NONE, 2px, 0, 0, 1x, 0.5x, 2x, 1x");
  });

  it("uses ScaleSprite motion semantics for mode instead of axis semantics", () => {
    const project = makeProject();
    const script = `
ScaleSprite POKEMON_DEFENDER, MOVE_ROUNDTRIP, 205, -205, 2, 1, 8
TerminateMoveScript
`;
    const text = decompileMoveAnimationBytes(compileMoveAnimation(project, 1, script));

    expect(text).toContain("ScaleSprite POKEMON_DEFENDER, MOVE_ROUNDTRIP, 205, -205, 2, 1, 8");
    expect(text).not.toContain("AXIS_Y_LEFT");
    expect(() => compileMoveAnimation(project, 1, "ScaleSprite POKEMON_DEFENDER, AXIS_Y_LEFT, 205, -205, 2, 1, 8\nTerminateMoveScript")).toThrow(
      /ScaleSprite parameter 2 must be an integer or one of: .*MOVE_ROUNDTRIP/u,
    );
  });

  it("formats Emit-family world-unit params as px while keeping multiplier params as x", () => {
    const project = makeProject();
    const script = `
EmitProjectile 0, 0, EMITTER_CURVE, SIDE_ATTACKER, SIDE_DEFENDER, 5px, 81920, 12px, 1x, 2x, 0
EmitProjectileFromCoordinates 0, 1, EMITTER_STRAIGHT, -8px, 2px, 0.5px, SIDE_DEFENDER, 3px, 40960, 4px, 1x, 1x, 0
EmitOrthoProjectile 0, 2, EMITTER_CURVE, SIDE_ATTACKER, SIDE_DEFENDER, 6px, 81920, 14px, 1x, 1x, 0
EmitOrthoProjectileFromCoordinates 0, 3, EMITTER_STRAIGHT, -7px, 3px, 0.25px, SIDE_DEFENDER, 2px, 40960, 5px, 1x, 1x, 2x
EmitCircle 0, 4, CIRCLE_ATTACKER_LEFT, 24px, 12px, 2px, 16, 0, 1, 0
EmitOrthoCircle 0, 5, CIRCLE_DEFENDER_RIGHT, 30px, 16px, -1px, 16, 0, 1, 0
TerminateMoveScript
`;

    const text = decompileMoveAnimationBytes(compileMoveAnimation(project, 1, script));

    expect(text).toContain("EmitProjectile 0, 0, EMITTER_CURVE, SIDE_ATTACKER, SIDE_DEFENDER, 5px, 81920, 12px, 1x, 2x, 0");
    expect(text).toContain("EmitProjectileFromCoordinates 0, 1, EMITTER_STRAIGHT, -8px, 2px, 0.5px, SIDE_DEFENDER, 3px, 40960, 4px, 1x, 1x, 0");
    expect(text).toContain("EmitOrthoProjectile 0, 2, EMITTER_CURVE, SIDE_ATTACKER, SIDE_DEFENDER, 6px, 81920, 14px, 1x, 1x, 0");
    expect(text).toContain("EmitOrthoProjectileFromCoordinates 0, 3, EMITTER_STRAIGHT, -7px, 3px, 0.25px, SIDE_DEFENDER, 2px, 40960, 5px, 1x, 1x, 2x");
    expect(text).toContain("EmitCircle 0, 4, CIRCLE_ATTACKER_LEFT, 24px, 12px, 2px, 16, 0, 1, 0");
    expect(text).toContain("EmitOrthoCircle 0, 5, CIRCLE_DEFENDER_RIGHT, 30px, 16px, -1px, 16, 0, 1, 0");
  });

  it("toggles semantic parameters to numeric values and back without changing bytes", () => {
    const project = makeProject();
    const semantic = `
MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9 @ camera setup
Emit 0, 1, SIDE_ATTACKER, SIDE_NONE, 2px, 0, 0, 1x, 0.5x, 2x, 1x
ToggleFreezeSprite POKEMON_DEFENDER, START
AudioContainer SUSPEND
TerminateMoveScript
`;

    const numeric = formatMoveAnimationScriptParameters(semantic, "numeric");
    const restored = formatMoveAnimationScriptParameters(numeric, "semantic");

    expect(numeric).toContain("MoveCamera 1, 11, 16, 0, 9 @ camera setup");
    expect(numeric).toContain("Emit 0, 1, 9, 8, 8192, 0, 0, 4096, 2048, 8192, 4096");
    expect(numeric).toContain("ToggleFreezeSprite 16, 1");
    expect(numeric).toContain("AudioContainer 1");
    expect(restored).toContain("MoveCamera MOVE_INTERPOLATION, CAMERA_DEFENDER, 16, 0, 9 @ camera setup");
    expect(restored).toContain("Emit 0, 1, SIDE_ATTACKER, SIDE_NONE, 2px, 0, 0, 1x, 0.5x, 2x, 1x");
    expect(restored).toContain("ToggleFreezeSprite POKEMON_DEFENDER, START");
    expect(restored).toContain("AudioContainer SUSPEND");
    expect([...compileMoveAnimation(project, 1, semantic)]).toEqual([...compileMoveAnimation(project, 1, numeric)]);
  });

  it("reports valid symbols when a semantic enum token is invalid", () => {
    const project = makeProject();

    expect(() => compileMoveAnimation(project, 1, "MoveCamera MOVE_INTERPOLATION, CAMERA_NOPE, 16, 0, 9\nTerminateMoveScript")).toThrow(
      /MoveCamera parameter 2 must be an integer or one of: .*CAMERA_DEFENDER/u,
    );
  });

  it("decompiles raw move animation binary bytes for import/export flows", () => {
    const project = makeProject();
    const bytes = compileMoveAnimation(project, 1, SINGLE_SCRIPT);
    const text = decompileMoveAnimationBytes(bytes);

    expect(text).not.toContain(".word 1 @ Count");
    expect(text).toContain("LoadSPA 165");
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
    expect(() => compileMoveAnimation(project, 1, SINGLE_SCRIPT.replace("TerminateMoveScript", "CameraPosPush"))).toThrow(/terminating command/u);
  });

  it("decompiles formerly generic commands with recommended names", () => {
    const project = makeProject();
    const script = SINGLE_SCRIPT.replace("LoadSPA 165", "CameraMoveAngle 1, 2, 3, 4, 5, 6\n     DeleteSPA 165");
    const bytes = compileMoveAnimation(project, 1, script);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain("CameraMoveAngle MOVE_INTERPOLATION, 2, 3, 4, 5, 6");
    expect(text).toContain("DeleteParticle 165");
    expect(text).not.toContain("CMD_2");
    expect(text).not.toContain("CMD_b");
  });

  it("accepts friendly command names, legacy command names, and generic CMD aliases for the same opcodes", () => {
    const project = makeProject();
    const legacy = "DoSPAAnimation 0, 1, SIDE_ATTACKER, SIDE_NONE, 0, 0, 0, 1x, 1x, 1x, 1x\nCMD_b 0\nTerminateMoveScript";
    const friendly = "Emit 0, 1, SIDE_ATTACKER, SIDE_NONE, 0, 0, 0, 1x, 1x, 1x, 1x\nDeleteParticle 0\nTerminateMoveScript";
    const typoAlias = "EmitFromCordinates 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1x, 1x, 1x, 0\nTerminateMoveScript";

    expect([...compileMoveAnimation(project, 1, friendly)]).toEqual([...compileMoveAnimation(project, 1, legacy)]);
    expect(decompileMoveAnimationBytes(compileMoveAnimation(project, 1, typoAlias))).toContain("EmitFromCoordinates");
  });

  it("decompiles RGB555 packed color commands as editable RGB components", () => {
    const project = makeProject();
    const script = SINGLE_SCRIPT.replace(
      "LoadSPA 165",
      [
        "ChangeColor 0, 0, 16, 8, 31, 0, 0",
        "     ChangeBackgroundColor 0, 0, 16, 8, 0, 31, 0",
        "     ObjectPaletteFade 0, 0, 16, 8, 0, 0, 31",
      ].join("\n     "),
    );
    const bytes = compileMoveAnimation(project, 1, script);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain("ChangeSpriteColor POKEMON_AA, 0, 16, 8, 31, 0, 0");
    expect(text).toContain("ChangeBackgroundColor 0, 0, 16, 8, 0, 31, 0");
    expect(text).toContain("ObjectPaletteFade 0, 0, 16, 8, 0, 0, 31");
    expect([...compileMoveAnimation(project, 1, text)]).toEqual([...bytes]);
  });

  it("accepts legacy packed RGB values for color commands", () => {
    const project = makeProject();
    const script = SINGLE_SCRIPT.replace("LoadSPA 165", "ChangeColor 0, 0, 16, 8, 0x7c00");
    const bytes = compileMoveAnimation(project, 1, script);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain("ChangeSpriteColor POKEMON_AA, 0, 16, 8, 0, 0, 31");
    const headerLength = 4 + 14 * 4;
    const moveCameraLength = 2 + 5 * 4;
    expect(readU32(bytes, headerLength + moveCameraLength + 2 + 4 * 4)).toBe(0x7c00);
  });

  it("uses retail-accurate argument counts for BW2 effect VM commands", () => {
    const project = makeProject();
    const script = SINGLE_SCRIPT.replace(
      "LoadSPA 165",
      [
        "DoSPAOrthoCircleAnimation 0, 1, 2, 3, 4, 5, 6, 7, 8, 9",
        "     DistortBackground 10, 11, 12, 13, 14, 15",
        "     BackgroundPaletteAnimation 16, 17",
      ].join("\n     "),
    );
    const bytes = compileMoveAnimation(project, 1, script);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain("EmitOrthoCircle 0, 1, CIRCLE_DEFENDER_LEFT, 3, 4, 5, 6, 7, 8, 9");
    expect(text).toContain("DistortBackground 10, 11, 12, 13, 14, 15");
    expect(text).toContain("BackgroundPaletteAnimation 16, 17");
    expect(repairMoveAnimationScriptBytes(bytes)).toBe(bytes);
  });

  it("accepts legacy text forms from older Pokeweb command counts", () => {
    const project = makeProject();
    const script = SINGLE_SCRIPT.replace(
      "LoadSPA 165",
      [
        "DoSPAOrthoCircleAnimation 0, 1, 2, 3, 4, 5, 6",
        "     DistortBackground 7, 8, 9, 10",
        "     BackgroundPaletteAnimation 11, 12, 13, 14, 15",
      ].join("\n     "),
    );
    const bytes = compileMoveAnimation(project, 1, script);
    project.narcs.move_animations!.rawFiles[1] = bytes;

    const text = decompileMoveAnimation(project, 1);

    expect(text).toContain("EmitOrthoCircle 0, 1, CIRCLE_DEFENDER_LEFT, 3, 4, 5, 6, 0, 0, 0");
    expect(text).toContain("DistortBackground 7, 8, 9, 10, 0, 0");
    expect(text).toContain("BackgroundPaletteAnimation 11, 12");
  });

  it("repairs binary scripts exported with older Pokeweb command counts", () => {
    const legacyBytes = compileLegacyMinimalScript([
      { opcode: 17, params: [0, 1, 2, 3, 4, 5, 6] },
      { opcode: 77, params: [] },
    ]);

    const repaired = repairMoveAnimationScriptBytes(legacyBytes);
    const text = decompileMoveAnimationBytes(repaired);

    expect(repaired.length).toBe(legacyBytes.length + 12);
    expect(text).toContain("EmitOrthoCircle 0, 1, CIRCLE_DEFENDER_LEFT, 3, 4, 5, 6, 0, 0, 0");
  });

  it("repairs loaded move animation archives and marks changed files dirty", () => {
    const project = makeProject();
    project.narcs.move_animations!.rawFiles[1] = compileLegacyMinimalScript([{ opcode: 17, params: [1, 2, 3, 4, 5, 6, 7] }, { opcode: 77, params: [] }]);
    project.narcs.battle_animations!.rawFiles[3] = compileLegacyMinimalScript([{ opcode: 17, params: [8, 9, 10, 11, 12, 13, 14] }, { opcode: 77, params: [] }]);

    const summary = repairLegacyMoveAnimationArchives(project);

    expect(summary).toEqual({ moveAnimations: 1, battleAnimations: 1 });
    expect(project.narcs.move_animations?.dirty.has(1)).toBe(true);
    expect(project.narcs.battle_animations?.dirty.has(3)).toBe(true);
  });

  it("updates and marks animation NARC subfiles dirty", () => {
    const project = makeProject();

    updateMoveAnimationScript(project, 1, SINGLE_SCRIPT);
    updateMoveAnimationScript(project, 673, SINGLE_SCRIPT);

    expect(project.narcs.move_animations?.dirty.has(1)).toBe(true);
    expect(project.narcs.battle_animations?.dirty.has(112)).toBe(true);
  });

  it("uses White2Upgrade per-move archive slots for expanded move animations", () => {
    const project = makeProject();
    project.codeInjection = {
      modules: [{ path: "patches/White2Upgrade.dll", target: "patches", fileName: "White2Upgrade.dll" }],
    };
    project.narcs.move_animations = makeStore("move_animations", Array.from({ length: 700 }, () => compileMinimalScript()));
    project.narcs.battle_animations = makeStore("battle_animations", Array.from({ length: 128 }, () => compileMinimalScript()));
    project.narcs.move_animations.rawFiles[562] = compileMoveAnimation(project, 562, SINGLE_SCRIPT.replace("LoadSPA 165", "LoadSPA 562"));
    project.narcs.battle_animations.rawFiles[1] = compileMoveAnimation(project, 1, SINGLE_SCRIPT.replace("LoadSPA 165", "LoadSPA 1"));

    const target = getMoveAnimationTargetInfo(project, 562);
    const text = decompileMoveAnimation(project, 562);
    updateMoveAnimationScript(project, 562, SINGLE_SCRIPT.replace("LoadSPA 165", "LoadSPA 563"));

    expect(target).toMatchObject({ storeName: "move_animations", index: 562, white2UpgradeLayout: true });
    expect(text).toContain("LoadSPA 562");
    expect(project.narcs.move_animations.dirty.has(562)).toBe(true);
    expect(project.narcs.battle_animations.dirty.has(1)).toBe(false);
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

function compileLegacyMinimalScript(commands: Array<{ opcode: number; params: number[] }>): Uint8Array {
  const bodyLength = commands.reduce((sum, command) => sum + 2 + command.params.length * 4, 0);
  const headerLength = 4 + 14 * 4;
  const out = new Uint8Array(headerLength + bodyLength);
  writeU32(out, 0, 1);
  for (let offset = 4; offset < headerLength; offset += 4) writeU32(out, offset, headerLength);
  let cursor = headerLength;
  for (const command of commands) {
    writeU16(out, cursor, command.opcode);
    cursor += 2;
    for (const param of command.params) {
      writeU32(out, cursor, param);
      cursor += 4;
    }
  }
  return out;
}

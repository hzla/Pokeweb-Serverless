import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import {
  appendPlatinumMoveSpaFiles,
  compilePlatinumMoveAnimationScript,
  decompilePlatinumMoveAnimation,
  exportPlatinumMoveAnimationArchive,
  exportPlatinumMoveAnimationRom,
  getPlatinumCallFuncAliasDefinitions,
  getPlatinumMoveAnimationCommandDefinitions,
  loadPlatinumMoveAnimationRom,
  updatePlatinumMoveAnimationFile,
} from "../pokeweb/platinumMoveAnimationModel";

const SIMPLE_SCRIPT = `
.nds
.thumb

.include "asm/macros/btlanimcmd.inc"

.create "build/platinum/move_anim/pt_001", 0

pt_we_001:
    Delay 20
    PlaySoundEffect 1234
    LoadParticleSystem 0, 123
    CreateEmitter 0, 2, 3
    UnloadParticleSystem 0
    End

.close
`;

const BRANCH_SCRIPT = `
pt_we_057:
    Call _0048
    Jump _004C
    JumpIfEqual 2, 9, _0050
    JumpIfBattlerSide 0, _0054, _0058
    JumpIfWeather _005C, _0060, _0064, _0068, _006C
    JumpIfContest _0070
    JumpIfFriendlyFire _0074
_0048:
    Return
_004C:
    End
_0050:
    End
_0054:
    End
_0058:
    End
_005C:
    End
_0060:
    End
_0064:
    End
_0068:
    End
_006C:
    End
_0070:
    End
_0074:
    End
`;

describe("platinumMoveAnimationModel", () => {
  it("defines Platinum animation opcodes 0 through 84", () => {
    const opcodes = getPlatinumMoveAnimationCommandDefinitions().map((definition) => definition.opcode);

    expect(opcodes).toEqual(Array.from({ length: 85 }, (_value, index) => index));
  });

  it("defines representative fixed and variable parameter counts", () => {
    const definitions = new Map(getPlatinumMoveAnimationCommandDefinitions().map((definition) => [definition.name, definition]));

    expect(definitions.get("Delay")?.params).toEqual(["frames"]);
    expect(definitions.get("LoadParticleSystem")?.params).toEqual(["particleSystem", "narcMemberID"]);
    expect(definitions.get("CreateEmitterForMove")?.params).toHaveLength(8);
    expect(definitions.get("JumpIfWeather")?.branchParams).toEqual([0, 1, 2, 3, 4]);
    expect(definitions.get("CallFunc")?.variable).toEqual({ countParam: 1, fixedParams: 2, maxVariableParams: 10 });
    expect(definitions.get("SetExtraParams")?.variable).toEqual({ countParam: 0, fixedParams: 1, maxVariableParams: 8 });
    expect(definitions.get("AddSpriteWithFunc")?.variable).toEqual({ countParam: 8, fixedParams: 9, maxVariableParams: 10 });
  });

  it("defines named Platinum CallFunc aliases from script_func_tables.c", () => {
    const aliases = new Map(getPlatinumCallFuncAliasDefinitions().map((definition) => [definition.name, definition]));

    expect(aliases.has("Func_Shake")).toBe(true);
    expect(aliases.get("Func_Shake")?.opcode).toBe(45);
    expect(aliases.get("Func_Shake")?.params).toEqual(["extentX", "extentY", "interval", "amount", "targets"]);
    expect(aliases.get("Func_MoveEmitterA2BLinear")?.params).toEqual(["emitterID", "offsetX", "offsetY", "startDelay", "frames", "radius", "mode", "params", "curve"]);
    expect(aliases.get("Func_StatChangeMetal")?.params).toEqual(["mode"]);
  });

  it("accepts the optional source macro operand for RemovePokemonSpriteFromBg", () => {
    const implicit = compilePlatinumMoveAnimationScript("pt_we_001:\n    RemovePokemonSpriteFromBg\n    End\n", { archiveKind: "move", fileId: 1 });
    const explicit = compilePlatinumMoveAnimationScript("pt_we_001:\n    RemovePokemonSpriteFromBg 0\n    End\n", { archiveKind: "move", fileId: 1 });

    expect([...implicit]).toEqual([...explicit]);
    expect(decompilePlatinumMoveAnimation(implicit, { archiveKind: "move", fileId: 1 })).toContain("RemovePokemonSpriteFromBg 0");
  });

  it("round-trips simple Platinum macro assembly", () => {
    const bytes = compilePlatinumMoveAnimationScript(SIMPLE_SCRIPT, { archiveKind: "move", fileId: 1 });
    const text = decompilePlatinumMoveAnimation(bytes, { archiveKind: "move", fileId: 1 });

    expect(text).toContain('.create "build/platinum/move_anim/pt_001", 0');
    expect(text).toContain("pt_we_001:");
    expect(text).toContain("Delay 20");
    expect(text).toContain("LoadParticleSystem 0, 123");
    expect(text).toContain("CreateEmitter 0, 2, 3");
    expect([...compilePlatinumMoveAnimationScript(text, { archiveKind: "move", fileId: 1 })]).toEqual([...bytes]);
  });

  it("round-trips branch commands with relative label operands", () => {
    const bytes = compilePlatinumMoveAnimationScript(BRANCH_SCRIPT, { archiveKind: "move", fileId: 57 });
    const text = decompilePlatinumMoveAnimation(bytes, { archiveKind: "move", fileId: 57 });

    expect(text).toContain("Call _0058");
    expect(text).toContain("Jump _005C");
    expect(text).toContain("JumpIfEqual 2, 9, _0060");
    expect(text).toContain("JumpIfBattlerSide 0, _0064, _0068");
    expect(text).toContain("JumpIfWeather _006C, _0070, _0074, _0078, _007C");
    expect(text).toContain("JumpIfContest _0080");
    expect(text).toContain("JumpIfFriendlyFire _0084");
    expect([...compilePlatinumMoveAnimationScript(text, { archiveKind: "move", fileId: 57 })]).toEqual([...bytes]);

    expect(readU32(bytes, 4)).toBe(21);
    expect(readU32(bytes, 12)).toBe(20);
  });

  it("supports compact and decompiled variable command syntax", () => {
    const compact = compilePlatinumMoveAnimationScript(
      `
pt_we_001:
    CallFunc 36, 5, 1, 2, 3, 4, 5
    SetExtraParams 4, 6, 7, 8, 9
    AddSpriteWithFunc 0, 12, 1, 2, 3, 4, 0, 0, 3, 10, 11, 12
    End
`,
      { archiveKind: "move", fileId: 1 },
    );
    const full = compilePlatinumMoveAnimationScript(
      `
pt_we_001:
    CallFunc 36, 5, 1, 2, 3, 4, 5, "NaN", "NaN", "NaN", "NaN", "NaN"
    SetExtraParams 4, 6, 7, 8, 9, "NaN", "NaN", "NaN", "NaN"
    AddSpriteWithFunc 0, 12, 1, 2, 3, 4, 0, 0, 3, 10, 11, 12, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"
    End
`,
      { archiveKind: "move", fileId: 1 },
    );

    expect([...compact]).toEqual([...full]);
    const text = decompilePlatinumMoveAnimation(compact, { archiveKind: "move", fileId: 1 });
    expect(text).toContain("Func_Shake 1, 2, 3, 4, 5");
    expect(text).toContain('SetExtraParams 4, 6, 7, 8, 9, "NaN", "NaN", "NaN", "NaN"');
    expect(text).toContain('AddSpriteWithFunc 0, 12, 1, 2, 3, 4, 0, 0, 3, 10, 11, 12, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"');
  });

  it("round-trips named CallFunc aliases including macro-style argument shims", () => {
    const named = compilePlatinumMoveAnimationScript(
      `
pt_we_001:
    Func_Shake 1, 2, 3, 4, 5
    Func_MoveBattler 6, 7, 8, 9
    Func_BattlerPartialDraw 10, 11, 12
    Func_StatChangeMetal 13
    End
`,
      { archiveKind: "move", fileId: 1 },
    );
    const numeric = compilePlatinumMoveAnimationScript(
      `
pt_we_001:
    CallFunc 36, 5, 1, 2, 3, 4, 5
    CallFunc 57, 4, 9, 7, 8, 6
    CallFunc 67, 5, 10, 0, 0, 11, 12
    CallFunc 83, 2, 3, 13
    End
`,
      { archiveKind: "move", fileId: 1 },
    );

    expect([...named]).toEqual([...numeric]);
    const text = decompilePlatinumMoveAnimation(numeric, { archiveKind: "move", fileId: 1 });
    expect(text).toContain("Func_Shake 1, 2, 3, 4, 5");
    expect(text).toContain("Func_MoveBattler 6, 7, 8, 9");
    expect(text).toContain("Func_BattlerPartialDraw 10, 11, 12");
    expect(text).toContain("Func_StatChangeMetal 13");
    expect([...compilePlatinumMoveAnimationScript(text, { archiveKind: "move", fileId: 1 })]).toEqual([...numeric]);
  });

  it("loads Platinum move animation NARCs from a ROM and exports archive/ROM replacements", () => {
    const moveNarc = new NARC();
    moveNarc.files = [compilePlatinumMoveAnimationScript(SIMPLE_SCRIPT, { archiveKind: "move", fileId: 0 })];
    const spaNarc = new NARC();
    spaNarc.files = [makeSyntheticSpa()];
    const romBytes = makePlatinumRom([
      { path: "wazaeffect/we.arc", bytes: moveNarc.save() },
      { path: "wazaeffect/effectdata/waza_particle.narc", bytes: spaNarc.save() },
    ]);

    const state = loadPlatinumMoveAnimationRom(romBytes);
    expect(state.archives.move.narc.files.length).toBe(1);
    expect(state.archives.spa.narc.files.length).toBe(1);

    updatePlatinumMoveAnimationFile(state, "move", 0, "pt_we_000:\n    Delay 3\n    End\n");
    const appended = appendPlatinumMoveSpaFiles(state, [makeSyntheticSpa()]);
    expect(appended).toEqual([1]);
    const exportedMove = new NARC(exportPlatinumMoveAnimationArchive(state, "move"));
    expect(readU32(exportedMove.files[0], 0)).toBe(0);
    expect(readU32(exportedMove.files[0], 4)).toBe(3);

    const exportedRom = new NintendoDSRom(exportPlatinumMoveAnimationRom(state));
    const exportedMoveFromRom = new NARC(exportedRom.getFileByName("wazaeffect/we.arc"));
    const exportedSpaFromRom = new NARC(exportedRom.getFileByName("wazaeffect/effectdata/waza_particle.narc"));
    expect([...exportedMoveFromRom.files[0]]).toEqual([...exportedMove.files[0]]);
    expect(exportedSpaFromRom.files.length).toBe(2);
    expect([...exportedSpaFromRom.files[1]]).toEqual([...makeSyntheticSpa()]);
  });

  it("loads Platinum move names from pl_msg bank 647 when present", () => {
    const moveNarc = new NARC();
    moveNarc.files = [
      compilePlatinumMoveAnimationScript("pt_we_000:\n    End\n", { archiveKind: "move", fileId: 0 }),
      compilePlatinumMoveAnimationScript("pt_we_001:\n    End\n", { archiveKind: "move", fileId: 1 }),
    ];
    const spaNarc = new NARC();
    spaNarc.files = [makeSyntheticSpa()];
    const msgNarc = new NARC();
    msgNarc.files = Array.from({ length: 648 }, () => new Uint8Array());
    msgNarc.files[647] = makeHgMessageBank(["-", "Pound"]);
    const romBytes = makePlatinumRom([
      { path: "wazaeffect/we.arc", bytes: moveNarc.save() },
      { path: "wazaeffect/effectdata/waza_particle.narc", bytes: spaNarc.save() },
      { path: "msgdata/pl_msg.narc", bytes: msgNarc.save() },
    ]);

    const state = loadPlatinumMoveAnimationRom(romBytes);

    expect(state.moveNames.slice(0, 2)).toEqual(["-", "Pound"]);
  });
});

function makeSyntheticSpa(): Uint8Array {
  const out = new Uint8Array(32 + 88 + 32 + 16 + 8);
  writeU32(out, 0, 0x53504120);
  writeU32(out, 4, 0x315f3231);
  writeU16(out, 8, 1);
  writeU16(out, 10, 1);
  writeU32(out, 16, 88);
  writeU32(out, 20, 56);
  writeU32(out, 24, 32 + 88);

  const resource = 32;
  writeU32(out, resource + 16, 2 * 4096);
  writeU16(out, resource + 34, 0x001f);
  writeU32(out, resource + 44, 4096);
  writeU16(out, resource + 60, 30);
  writeU16(out, resource + 62, 45);
  writeU32(out, resource + 68, 0xff00);

  const texture = 32 + 88;
  writeU32(out, texture, 0x53505420);
  writeU32(out, texture + 4, 2 | (1 << 16));
  writeU32(out, texture + 8, 16);
  writeU32(out, texture + 12, 48);
  writeU32(out, texture + 16, 8);
  writeU32(out, texture + 20, 56);
  writeU32(out, texture + 24, 0);
  writeU32(out, texture + 28, 56);
  out.fill(0x55, texture + 32, texture + 48);
  writeU16(out, texture + 48, 0x0000);
  writeU16(out, texture + 50, 0x001f);
  writeU16(out, texture + 52, 0x03e0);
  writeU16(out, texture + 54, 0x7c00);
  return out;
}

function makePlatinumRom(files: Array<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const fileIds = new Map([
    ["wazaeffect/we.arc", 0],
    ["wazaeffect/effectdata/waza_particle.narc", 1],
    ["msgdata/pl_msg.narc", 2],
  ]);
  const filesById = new Map<number, { path: string; bytes: Uint8Array }>();
  files.forEach((file, index) => filesById.set(fileIds.get(file.path) ?? index, file));
  const fatFileCount = Math.max(1, ...filesById.keys()) + 1;
  const fnt = saveFnt(
    new Folder({
      folders: [
        [
          "wazaeffect",
          new Folder({
            files: ["we.arc"],
            firstId: 0,
            folders: [
              [
                "effectdata",
                new Folder({
                  files: ["waza_particle.narc"],
                  firstId: 1,
                }),
              ],
            ],
          }),
        ],
        [
          "msgdata",
          new Folder({
            files: ["pl_msg.narc"],
            firstId: 2,
          }),
        ],
      ],
    }),
  );
  const out = new Uint8Array(0x6000 + fatFileCount * 0x200 + files.reduce((sum, file) => sum + file.bytes.length, 0));
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x43, 0x50, 0x55, 0x45], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, fatFileCount * 8);
  writeU32(out, 0x50, 0x4a00);
  writeU32(out, 0x54, 0);
  writeU32(out, 0x58, 0x4c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  out.set(fnt, 0x5000);
  let cursor = 0x5400;
  for (let index = 0; index < fatFileCount; index += 1) {
    const file = filesById.get(index);
    cursor = align(cursor, 0x200);
    writeU32(out, 0x5200 + index * 8, cursor);
    if (file) {
      out.set(file.bytes, cursor);
      cursor += file.bytes.length;
    }
    writeU32(out, 0x5200 + index * 8 + 4, cursor);
  }
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
}

function makeHgMessageBank(messages: string[]): Uint8Array {
  const key = 0x1234;
  const encoded = messages.map((message, index) => encryptHgMessage(message, index + 1));
  const headerLength = 4 + messages.length * 8;
  const out = new Uint8Array(headerLength + encoded.reduce((sum, words) => sum + words.length * 2, 0));
  writeU32(out, 0, key << 16 | messages.length);
  let cursor = headerLength;
  encoded.forEach((words, index) => {
    const allocKey = ((765 * (index + 1) * key) & 0xffff) * 0x10001;
    writeU32(out, 4 + index * 8, (cursor - headerLength) ^ allocKey);
    writeU32(out, 8 + index * 8, words.length ^ allocKey);
    words.forEach((word, wordIndex) => writeU16(out, cursor + wordIndex * 2, word));
    cursor += words.length * 2;
  });
  return out;
}

function encryptHgMessage(message: string, index: number): number[] {
  const plain = [...message].map(hgCharCode).concat(0xffff);
  let key = (index * 596947) & 0xffff;
  return plain.map((word) => {
    const encrypted = word ^ key;
    key = (key + 18749) & 0xffff;
    return encrypted;
  });
}

function hgCharCode(char: string): number {
  if (char >= "0" && char <= "9") return 0x0121 + char.charCodeAt(0) - 48;
  if (char >= "A" && char <= "Z") return 0x012b + char.charCodeAt(0) - 65;
  if (char >= "a" && char <= "z") return 0x0145 + char.charCodeAt(0) - 97;
  if (char === " ") return 0x01de;
  if (char === "-") return 0x01be;
  throw new Error(`Unsupported test char: ${char}`);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

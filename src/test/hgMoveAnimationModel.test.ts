import { describe, expect, it } from "vitest";
import { readU32, writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { HG_MOVE_ANIMATION_HELPER_DEFINITIONS } from "../pokeweb/hgMoveAnimationDocs";
import {
  appendHgMoveSpaFiles,
  compileHgMoveAnimationScript,
  decodeHgMessageBank,
  decompileHgMoveAnimation,
  decompileHgMoveAnimationReadable,
  exportHgMoveAnimationArchive,
  exportHgMoveAnimationRom,
  getHgMoveAnimationCommandDefinitions,
  getHgMoveAnimationReadableCommandAliases,
  loadHgMoveAnimationRom,
  updateHgMoveAnimationFile,
} from "../pokeweb/hgMoveAnimationModel";

const SIMPLE_SCRIPT = `
.nds
.thumb

.include "armips/include/animscriptcmd.s"

.create "build/move/move_anim/0_001", 0

a010_001:
    wait 7
    playsepan 1827, PAN_RIGHT
    end

.close
`;

const BRANCH_SCRIPT = `
a010_057:
    call _0030
    checkturn _003C, _0048
    jumpifside 0, _0054, _0060
    jumpbasedonweather _006C, _0078, _0084, _0090, _009C
    jumpifcontest _00A8
    jumpifplayerattack _00B4
    end
_0030:
    return
_003C:
    end
_0048:
    end
_0054:
    end
_0060:
    end
_006C:
    end
_0078:
    end
_0084:
    end
_0090:
    end
_009C:
    end
_00A8:
    end
_00B4:
    end
`;

describe("hgMoveAnimationModel", () => {
  it("defines primitive HG animation opcodes 0x00 through 0x58", () => {
    const opcodes = getHgMoveAnimationCommandDefinitions().map((definition) => definition.opcode);

    expect(opcodes).toEqual(Array.from({ length: 0x59 }, (_value, index) => index));
  });

  it("round-trips simple HG-engine macro assembly", () => {
    const bytes = compileHgMoveAnimationScript(SIMPLE_SCRIPT, { archiveKind: "move", fileId: 1 });
    const text = decompileHgMoveAnimation(bytes, { archiveKind: "move", fileId: 1 });

    expect(text).toContain('.create "build/move/move_anim/0_001", 0');
    expect(text).toContain("a010_001:");
    expect(text).toContain("wait 7");
    expect(text).toContain("playsepan 1827, 117");
    expect([...compileHgMoveAnimationScript(text, { archiveKind: "move", fileId: 1 })]).toEqual([...bytes]);
  });

  it("round-trips branch commands with armips-relative label operands", () => {
    const bytes = compileHgMoveAnimationScript(BRANCH_SCRIPT, { archiveKind: "move", fileId: 57 });
    const text = decompileHgMoveAnimation(bytes, { archiveKind: "move", fileId: 57 });

    expect(text).toContain("call _0050");
    expect(text).toContain("checkturn _0054, _0058");
    expect(text).toContain("jumpifside 0, _005C, _0060");
    expect(text).toContain("jumpbasedonweather _0064, _0068, _006C, _0070, _0074");
    expect(text).toContain("jumpifcontest _0078");
    expect(text).toContain("jumpifplayerattack _007C");
    expect([...compileHgMoveAnimationScript(text, { archiveKind: "move", fileId: 57 })]).toEqual([...bytes]);

    expect(readU32(bytes, 4)).toBe(19);
    expect(readU32(bytes, 16)).toBe(18);
  });

  it("supports compact and HG-engine full variable command syntax", () => {
    const compact = compileHgMoveAnimationScript(
      `
a010_001:
    callfunction 34, 6, 2, 0, 1, 49930, 10, 10
    cmd36 5, 6, 7, 2, 8, 9
    cmd37 3, 4, 5, 6
    addsomething 0, 1, 2, 3, 4, 5, 6, 7, 2, 8, 9
    end
`,
      { archiveKind: "move", fileId: 1 },
    );
    const full = compileHgMoveAnimationScript(
      `
a010_001:
    callfunction 34, 6, 2, 0, 1, 49930, 10, 10, "NaN", "NaN", "NaN", "NaN"
    cmd36 5, 6, 7, 2, 8, 9, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"
    cmd37 3, 4, 5, 6, "NaN", "NaN", "NaN", "NaN", "NaN"
    addsomething 0, 1, 2, 3, 4, 5, 6, 7, 2, 8, 9, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"
    end
`,
      { archiveKind: "move", fileId: 1 },
    );

    expect([...compact]).toEqual([...full]);
    const text = decompileHgMoveAnimation(compact, { archiveKind: "move", fileId: 1 });
    expect(text).toContain('callfunction 34, 6, 2, 0, 1, 49930, 10, 10, "NaN", "NaN", "NaN", "NaN"');
    expect(text).toContain('cmd36 5, 6, 7, 2, 8, 9, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"');
  });

  it("decompiles to readable aliases while keeping HG-engine output round-trippable", () => {
    const bytes = compileHgMoveAnimationScript(
      `
a010_001:
    callfunction 36, 5, 6, 0, 1, 8, 264
    callfunction 34, 6, 2, 0, 1, 49930, 10, 10
    callfunction 40, 2, 2, 1
    callfunction 42, 8, 258, 100, 80, 100, 140, 100, 1, 327685
    callfunction 52, 3, 3, 24, 258
    callfunction 65, 6, 1, 0, 0, 0, 10, 64
    callfunction 72, 10, 3, 0, 360, 0, 360, 24, 24, 4, 1, 0
    callfunction 74, 1, 1
    callfunction 75, 7, 0, 80, 3, 0, 1, 255, 1
    cmd37 6, 0, 1, 6, 1, 0, 0
    cmd37 3, 4, 5, 6
    end
`,
      { archiveKind: "move", fileId: 1 },
    );
    const readable = decompileHgMoveAnimationReadable(bytes, { archiveKind: "move", fileId: 1 });

    expect(readable).toContain('actor_shake 5, 6, 0, 1, 8, 264, "NaN", "NaN", "NaN", "NaN", "NaN"');
    expect(readable).toContain('pokemon_tint 6, 2, 0, 1, 49930, 10, 10, "NaN", "NaN", "NaN", "NaN"');
    expect(readable).toContain('battler_sprite_vanish 2, 2, 1, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"');
    expect(readable).toContain('battler_sprite_scale_updown 8, 258, 100, 80, 100, 140, 100, 1, 327685, "NaN", "NaN"');
    expect(readable).toContain('battler_sprite_slide_x 3, 3, 24, 258, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"');
    expect(readable).toContain('particle_emitter_straight 6, 1, 0, 0, 0, 10, 64, "NaN", "NaN", "NaN", "NaN"');
    expect(readable).toContain("particle_emitter_rotation 10, 3, 0, 360, 0, 360, 24, 24, 4, 1, 0");
    expect(readable).toContain('battle_palette_grayscale 1, 1, "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN"');
    expect(readable).toContain('pokemon_oam_view 7, 0, 80, 3, 0, 1, 255, 1, "NaN", "NaN", "NaN"');
    expect(readable).toContain("moveaxistotarget 0, 1");
    expect(readable).toContain('particle_metadata 3, 4, 5, 6, "NaN", "NaN", "NaN", "NaN", "NaN"');
    expect([...compileHgMoveAnimationScript(readable, { archiveKind: "move", fileId: 1 })]).toEqual([...bytes]);
    expect(decompileHgMoveAnimation(bytes, { archiveKind: "move", fileId: 1 })).toContain("callfunction 36");
  });

  it("decompiles source-backed primitive opcodes to readable aliases", () => {
    const bytes = compileHgMoveAnimationScript(
      `
a010_001:
    cmd0C 4, 1
    cmd1F 1, 0
    cmd20 0
    cmd3E 0, 0
    cmd43
    cmd52 2, 0, 4
    cmd53 0
    cmd54
    cmd55 0
    cmd56 3, 0x800001, 3
    cmd57 119
    end
`,
      { archiveKind: "move", fileId: 1 },
    );
    const readable = decompileHgMoveAnimationReadable(bytes, { archiveKind: "move", fileId: 1 });

    expect(readable).toContain("work_set 4, 1");
    expect(readable).toContain("copy_battler_to_bg2 1, 0");
    expect(readable).toContain("clear_bg2_battler_copy 0");
    expect(readable).toContain("set_sprite_state_byte_a 0, 0");
    expect(readable).toContain("clear_scratch_params");
    expect(readable).toContain("start_managed_sprite_draw_task 2, 0, 4");
    expect(readable).toContain("stop_managed_sprite_draw_task 0");
    expect(readable).toContain("wait_for_input_gate");
    expect(readable).toContain("screen_brightness_pulse 0");
    expect(readable).toContain("animated_bg_effect_offset_task 3, 8388609, 3");
    expect(readable).toContain("branch_on_battle_flag 119");
    expect([...compileHgMoveAnimationScript(readable, { archiveKind: "move", fileId: 1 })]).toEqual([...bytes]);
  });

  it("exposes readable primitive aliases for editor command lookup", () => {
    expect(getHgMoveAnimationReadableCommandAliases()).toEqual(
      expect.arrayContaining([
        { alias: "work_set", command: "cmd0c" },
        { alias: "clear_scratch_params", command: "cmd43" },
        { alias: "animated_bg_effect_offset_task", command: "cmd56" },
      ]),
    );
  });

  it("names source-backed cmd37 EX_DATA records in readable output", () => {
    const bytes = compileHgMoveAnimationScript(
      `
a010_001:
    cmd37 6, 0, 2, 1, 3, 14, 0
    cmd37 5, 1, 1, -120, -41, 0
    cmd37 5, 1, 1, 64, 128, 0
    cmd37 5, 1, 1, 3, 0, 0
    cmd37 4, 1, 1720, -3440, 0
    end
`,
      { archiveKind: "move", fileId: 1 },
    );
    const readable = decompileHgMoveAnimationReadable(bytes, { archiveKind: "move", fileId: 1 });

    expect(readable).toContain("particle_operator 0, 2, 1, 3, 14, 0");
    expect(readable).toContain("particle_gravity_magnitude 1, 1, -120, -41, 0");
    expect(readable).toContain("particle_random_magnitude 1, 1, 64, 128, 0");
    expect(readable).toContain("particle_random_interval 1, 1, 3, 0, 0");
    expect(readable).toContain("particle_operator_offset 1, 1720, -3440, 0");
    expect([...compileHgMoveAnimationScript(readable, { archiveKind: "move", fileId: 1 })]).toEqual([...bytes]);
    expect(decompileHgMoveAnimation(bytes, { archiveKind: "move", fileId: 1 })).toContain("cmd37 6, 0, 2, 1, 3, 14, 0");
  });

  it("accepts HG-engine helper macros and constants", () => {
    const bytes = compileHgMoveAnimationScript(
      `
a010_553:
    loadparticlefromspa 0, 500
    shadeattackingmon 31, 0, 0
    shadetargetmon 0, 31, 0
    flashscreencolor 0, 0, 31
    shaketargetmon 4, 7
    shaketargetside 3, 2
    shakeallbutuser 5, 1
    slideattackingmon -16, 8
    shakescreen
    moveaxistotarget 0, 1
    shadescreencolor 1, 2, 3, 4, 5
    end
`,
      { archiveKind: "move", fileId: 553 },
    );
    const text = decompileHgMoveAnimation(bytes, { archiveKind: "move", fileId: 553 });

    expect(text).toContain("a010_553:");
    expect(text).toContain("loadparticle 0, 500");
    expect(text).toContain("callfunction 34, 6, 2, 0, 1, 31, 10, 10");
    expect(text).toContain("cmd37 6, 0, 1, 6, 1, 0, 0");
    expect([...compileHgMoveAnimationScript(text, { archiveKind: "move", fileId: 553 })]).toEqual([...bytes]);
  });

  it("matches hg-engine helper color expression semantics without clamping", () => {
    const bytes = compileHgMoveAnimationScript("a010_001:\n    shadetargetmon 255, 255, 0\n    end\n", { archiveKind: "move", fileId: 1 });
    const text = decompileHgMoveAnimation(bytes, { archiveKind: "move", fileId: 1 });

    expect(text).toContain("callfunction 34, 5, 8, 1, 1, 8191, 12");
  });

  it("keeps documented helper macro metadata compilable", () => {
    for (const helper of HG_MOVE_ANIMATION_HELPER_DEFINITIONS) {
      const params = helper.params.map((param, index) => helperParamValue(param, index)).join(", ");
      const script = `a010_001:\n    ${helper.name}${params ? ` ${params}` : ""}\n    end\n`;

      expect(() => compileHgMoveAnimationScript(script, { archiveKind: "move", fileId: 1 }), helper.name).not.toThrow();
    }
  });

  it("loads HG move animation NARCs from a ROM and exports archive/ROM replacements", () => {
    const moveNarc = new NARC();
    moveNarc.files = [compileHgMoveAnimationScript(SIMPLE_SCRIPT, { archiveKind: "move", fileId: 0 })];
    const subNarc = new NARC();
    subNarc.files = [compileHgMoveAnimationScript("a061_000:\n    end\n", { archiveKind: "sub", fileId: 0 })];
    const msgNarc = new NARC();
    const spaNarc = new NARC();
    spaNarc.files = [makeSyntheticSpa()];
    const romBytes = makeRom([
      { path: "a/0/1/0", bytes: moveNarc.save() },
      { path: "a/0/6/1", bytes: subNarc.save() },
      { path: "a/0/2/7", bytes: msgNarc.save() },
      { path: "a/0/2/9", bytes: spaNarc.save() },
    ]);

    const state = loadHgMoveAnimationRom(romBytes);
    expect(state.archives.move.narc.files.length).toBe(1);
    expect(state.archives.sub.narc.files.length).toBe(1);
    expect(state.archives.spa.narc.files.length).toBe(1);

    updateHgMoveAnimationFile(state, "sub", 0, "a061_000:\n    wait 3\n    end\n");
    const appended = appendHgMoveSpaFiles(state, [makeSyntheticSpa()]);
    expect(appended).toEqual([1]);
    const exportedSub = new NARC(exportHgMoveAnimationArchive(state, "sub"));
    expect(readU32(exportedSub.files[0], 0)).toBe(0);
    expect(readU32(exportedSub.files[0], 4)).toBe(3);

    const exportedRom = new NintendoDSRom(exportHgMoveAnimationRom(state));
    const exportedSubFromRom = new NARC(exportedRom.getFileByName("a/0/6/1"));
    const exportedSpaFromRom = new NARC(exportedRom.getFileByName("a/0/2/9"));
    expect([...exportedSubFromRom.files[0]]).toEqual([...exportedSub.files[0]]);
    expect(exportedSpaFromRom.files.length).toBe(2);
    expect([...exportedSpaFromRom.files[1]]).toEqual([...makeSyntheticSpa()]);
  });

  it("loads HG move names from a027 bank 750 when present", () => {
    const moveNarc = new NARC();
    moveNarc.files = [
      compileHgMoveAnimationScript("a010_000:\n    end\n", { archiveKind: "move", fileId: 0 }),
      compileHgMoveAnimationScript("a010_001:\n    end\n", { archiveKind: "move", fileId: 1 }),
    ];
    const subNarc = new NARC();
    subNarc.files = [compileHgMoveAnimationScript("a061_000:\n    end\n", { archiveKind: "sub", fileId: 0 })];
    const msgNarc = new NARC();
    msgNarc.files = Array.from({ length: 751 }, () => new Uint8Array());
    msgNarc.files[750] = makeHgMessageBank(["-", "Pound"]);
    const spaNarc = new NARC();
    const romBytes = makeRom([
      { path: "a/0/1/0", bytes: moveNarc.save() },
      { path: "a/0/6/1", bytes: subNarc.save() },
      { path: "a/0/2/7", bytes: msgNarc.save() },
      { path: "a/0/2/9", bytes: spaNarc.save() },
    ]);

    const state = loadHgMoveAnimationRom(romBytes);

    expect(state.moveNames.slice(0, 2)).toEqual(["-", "Pound"]);
    expect(decodeHgMessageBank(msgNarc.files[750])).toEqual(["-", "Pound"]);
  });
});

function helperParamValue(param: string, index: number): number {
  const lower = param.toLowerCase();
  if (lower === "count") return 10;
  if (lower === "cmd37count") return 8;
  if (lower === "red") return 31;
  if (lower === "green") return 12;
  if (lower === "blue") return 4;
  if (lower === "slot") return 0;
  if (lower === "spafile") return 500;
  if (lower === "emitter") return 1;
  if (lower === "times") return 2;
  if (lower === "magnitude") return 6;
  if (lower === "x") return -8;
  if (lower === "y") return 4;
  if (lower === "alpha0") return 0;
  if (lower === "alpha1") return 12;
  return index + 1;
}

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

function makeRom(files: Array<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const fnt = saveFnt(
    new Folder({
      folders: [
        [
          "a",
          new Folder({
            folders: [
              [
                "0",
                new Folder({
                  folders: [
                    ["1", new Folder({ files: ["0"], firstId: 0 })],
                    ["2", new Folder({ files: ["7", "9"], firstId: 2 })],
                    ["6", new Folder({ files: ["1"], firstId: 1 })],
                  ],
                }),
              ],
            ],
          }),
        ],
      ],
    }),
  );
  const out = new Uint8Array(0x6000 + files.reduce((sum, file) => sum + 0x200 + file.bytes.length, 0));
  out.set([0x54, 0x45, 0x53, 0x54], 0);
  out.set([0x54, 0x45, 0x53, 0x54], 12);
  writeU32(out, 0x20, 0x4000);
  writeU32(out, 0x2c, 4);
  writeU32(out, 0x30, 0x4800);
  writeU32(out, 0x3c, 4);
  writeU32(out, 0x40, 0x5000);
  writeU32(out, 0x44, fnt.length);
  writeU32(out, 0x48, 0x5200);
  writeU32(out, 0x4c, files.length * 8);
  writeU32(out, 0x50, 0x4a00);
  writeU32(out, 0x54, 0);
  writeU32(out, 0x58, 0x4c00);
  writeU32(out, 0x5c, 0);
  writeU32(out, 0x84, 0x4000);
  out.set([1, 2, 3, 4], 0x4000);
  out.set([5, 6, 7, 8], 0x4800);
  out.set(fnt, 0x5000);
  let cursor = 0x5400;
  files.forEach((file, index) => {
    cursor = align(cursor, 0x200);
    writeU32(out, 0x5200 + index * 8, cursor);
    out.set(file.bytes, cursor);
    cursor += file.bytes.length;
    writeU32(out, 0x5200 + index * 8 + 4, cursor);
  });
  writeU32(out, 0x80, cursor);
  return out.slice(0, align(cursor, 4));
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
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

import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, saveFnt } from "../nds/fnt";
import { NARC } from "../nds/narc";
import { compilePlatinumMoveAnimationScript, loadPlatinumMoveAnimationRom } from "../pokeweb/platinumMoveAnimationModel";
import { buildPlatinumMoveAnimationPreview } from "../pokeweb/platinumMoveAnimationPreviewModel";

describe("platinumMoveAnimationPreviewModel", () => {
  it("renders loaded Platinum particle emitters through the shared preview contract", async () => {
    const state = makePreviewState();
    const preview = await buildPlatinumMoveAnimationPreview(
      state,
      0,
      `
pt_we_000:
    LoadParticleSystem 0, 0
    CreateEmitter 0, 0, 3
    WaitForAllEmitters
    UnloadParticleSystem 0
    End
`,
    );

    expect(preview.rootLabel).toBe("pt_we_000");
    expect(preview.spaIds).toEqual([0]);
    expect(preview.spaArchives.has(0)).toBe(true);
    expect(preview.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "LoadParticleSystem", spaId: 0, status: "supported" }),
        expect.objectContaining({ command: "CreateEmitter", effectKind: "spa", spaId: 0, resourceId: 0, status: "supported" }),
        expect.objectContaining({ command: "WaitForAllEmitters", status: "supported" }),
      ]),
    );
  });

  it("executes calls, jumps, vars, side, weather, contest, and friendly-fire branches", async () => {
    const state = makePreviewState();
    const preview = await buildPlatinumMoveAnimationPreview(
      state,
      0,
      `
pt_we_000:
    SetVar 0, 5
    JumpIfEqual 0, 5, _equal
    Delay 99
_equal:
    Call _sub
    JumpIfBattlerSide 0, _enemy, _player
_enemy:
    Delay 11
    Jump _weather
_player:
    Delay 13
_weather:
    JumpIfWeather _none, _rain, _sand, _sun, _hail
_none:
    Delay 20
    Jump _contest
_rain:
    Delay 21
    Jump _contest
_sand:
    Delay 22
    Jump _contest
_sun:
    Delay 23
    Jump _contest
_hail:
    Delay 24
_contest:
    JumpIfContest _contest_on
    Delay 30
    Jump _friendly
_contest_on:
    Delay 31
_friendly:
    JumpIfFriendlyFire _friendly_on
    Delay 40
    End
_friendly_on:
    Delay 41
    End
_sub:
    Delay 7
    Return
`,
      { attackerSide: "player", checkturn: 0, weatherIndex: 3, contest: true, playerAttack: true },
    );

    const delayParams = preview.timeline.filter((event) => event.command === "Delay").map((event) => event.params[0]);
    expect(delayParams).toEqual([7, 13, 23, 31, 41]);
    expect(delayParams).not.toContain(99);
    expect(preview.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "Call" }),
        expect.objectContaining({ command: "Return" }),
        expect.objectContaining({ command: "JumpIfWeather", message: "Scenario chose weather branch 3" }),
        expect.objectContaining({ command: "JumpIfFriendlyFire", message: "Friendly fire on" }),
      ]),
    );
  });

  it("warns instead of crashing when an emitter references an unloaded particle system", async () => {
    const state = makePreviewState();
    const preview = await buildPlatinumMoveAnimationPreview(
      state,
      0,
      `
pt_we_000:
    CreateEmitter 0, 0, 3
    End
`,
    );

    expect(preview.timeline).toEqual(
      expect.arrayContaining([expect.objectContaining({ command: "CreateEmitter", status: "unsupported", message: expect.stringContaining("unloaded particle system") })]),
    );
    expect(preview.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("unloaded particle system") })]));
  });

  it("shows unsupported commands as timeline markers with warnings", async () => {
    const state = makePreviewState();
    const preview = await buildPlatinumMoveAnimationPreview(
      state,
      0,
      `
pt_we_000:
    BtlAnimCmd_068 3
    End
`,
    );

    expect(preview.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ command: "BtlAnimCmd_068", status: "unsupported" })]));
    expect(preview.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("BtlAnimCmd_068") })]));
  });

  it("loads and renders Platinum backgrounds from SwitchBg commands", async () => {
    const state = makePreviewState({ includeBackgrounds: true });
    const preview = await buildPlatinumMoveAnimationPreview(
      state,
      0,
      `
pt_we_000:
    SetVar 0, 2
    SetVar 1, 3
    SwitchBg 0, 0x20000
    WaitForBgSwitch
    RestoreBg 0, 0
    End
`,
    );

    expect(preview.backgrounds.get(0)?.width).toBe(16);
    expect(preview.backgrounds.get(0)?.height).toBe(16);
    expect(preview.backgrounds.get(0)?.frameImages).toHaveLength(3);
    expect(preview.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "LoadBackground", backgroundId: 0, backgroundFrameIndex: 0, status: "supported" }),
        expect.objectContaining({ command: "MoveBackground", params: [0, 2, 3, 600, 0, 0, 0, 0], status: "supported" }),
        expect.objectContaining({ command: "WaitForBgSwitch", frame: 0, status: "supported" }),
        expect.objectContaining({ command: "ApplyBackground", params: [0, 1], status: "supported" }),
      ]),
    );
  });

  it("uses Platinum background scenario variants for SwitchBgEx", async () => {
    const state = makePreviewState({ includeBackgrounds: true });
    const preview = await buildPlatinumMoveAnimationPreview(
      state,
      0,
      `
pt_we_000:
    SwitchBgEx 0, 1, 2
    End
`,
      { attackerSide: "player", checkturn: 0, weatherIndex: 0, contest: true, playerAttack: false },
    );

    expect(preview.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ command: "LoadBackground", backgroundId: 2, backgroundFrameIndex: 2 })]));
  });
});

function makePreviewState(options: { includeBackgrounds?: boolean } = {}) {
  const moveNarc = new NARC();
  moveNarc.files = [compilePlatinumMoveAnimationScript("pt_we_000:\n    End\n", { archiveKind: "move", fileId: 0 })];
  const spaNarc = new NARC();
  spaNarc.files = [makeSyntheticSpa()];
  const files = [
    { path: "wazaeffect/we.arc", bytes: moveNarc.save() },
    { path: "wazaeffect/effectdata/waza_particle.narc", bytes: spaNarc.save() },
  ];
  if (options.includeBackgrounds) files.push({ path: "battle/graphic/pl_batt_bg.narc", bytes: makeBattleBgNarc().save() });
  return loadPlatinumMoveAnimationRom(
    makePlatinumRom(files),
  );
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

function makePlatinumRom(files: Array<{ path: string; bytes: Uint8Array }>): Uint8Array {
  const fileIds = new Map([
    ["wazaeffect/we.arc", 0],
    ["wazaeffect/effectdata/waza_particle.narc", 1],
    ["battle/graphic/pl_batt_bg.narc", 2],
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
            folders: [["effectdata", new Folder({ files: ["waza_particle.narc"], firstId: 1 })]],
          }),
        ],
        [
          "battle",
          new Folder({
            folders: [["graphic", new Folder({ files: ["pl_batt_bg.narc"], firstId: 2 })]],
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

function makeBattleBgNarc(): NARC {
  const narc = new NARC();
  narc.files = Array.from({ length: 0x124 }, () => new Uint8Array());
  const [screen, characters, palette] = makeSyntheticBackgroundFiles();
  narc.files[0x3e] = screen;
  narc.files[0x3f] = screen;
  narc.files[0x40] = screen;
  narc.files[0x41] = characters;
  narc.files[0x123] = palette;
  return narc;
}

function makeSyntheticBackgroundFiles(): [Uint8Array, Uint8Array, Uint8Array] {
  const screen = new Uint8Array(44);
  writeAscii(screen, 0, "RCSN");
  writeU16(screen, 4, 0xfeff);
  writeU16(screen, 6, 0x0100);
  writeU32(screen, 8, screen.length);
  writeU16(screen, 12, 0x10);
  writeU16(screen, 14, 1);
  writeAscii(screen, 16, "NRCS");
  writeU32(screen, 20, 20);
  writeU16(screen, 24, 16);
  writeU16(screen, 26, 16);
  writeU32(screen, 32, 8);
  writeU16(screen, 36, 0);
  writeU16(screen, 38, 1);
  writeU16(screen, 40, 2);
  writeU16(screen, 42, 3);

  const characters = new Uint8Array(48 + 64);
  writeAscii(characters, 0, "RGCN");
  writeU16(characters, 4, 0xfeff);
  writeU16(characters, 6, 0x0100);
  writeU32(characters, 8, characters.length);
  writeU16(characters, 12, 0x10);
  writeU16(characters, 14, 1);
  writeAscii(characters, 16, "RAHC");
  writeU32(characters, 20, 48 + 64);
  writeU32(characters, 24, 64);
  writeU16(characters, 28, 3);
  writeU32(characters, 40, 64);
  for (let index = 48; index < characters.length; index += 1) characters[index] = index % 2 === 0 ? 0x11 : 0x22;

  const palette = new Uint8Array(48);
  writeAscii(palette, 0, "RLCN");
  writeU16(palette, 4, 0xfeff);
  writeU16(palette, 6, 0x0100);
  writeU32(palette, 8, palette.length);
  writeU16(palette, 12, 0x10);
  writeU16(palette, 14, 1);
  writeAscii(palette, 16, "TTLP");
  writeU32(palette, 20, palette.length - 16);
  writeU32(palette, 32, 8);
  writeU16(palette, 40, 0x0000);
  writeU16(palette, 42, 0x001f);
  writeU16(palette, 44, 0x03e0);
  writeU16(palette, 46, 0x7c00);
  return [screen, characters, palette];
}

function writeAscii(out: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) out[offset + index] = value.charCodeAt(index);
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

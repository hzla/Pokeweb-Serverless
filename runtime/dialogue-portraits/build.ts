import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendCutout256, outlineSilhouette } from "./cutout256";
import { addLeaderEvents, LEADER_PANEL_WIDTH, LEADER_PANEL_X, seedLeaderActors } from "./leaders";
import { PNG } from "pngjs";
import { readU16, readU32, writeU16, writeU32 } from "../../src/nds/binary";
import { NARC } from "../../src/nds/narc";
import { NintendoDSRom } from "../../src/nds/rom";
import { getTestBattleConfig, refreshTestBattleSaveBlockChecksum } from "../../src/pokeweb/testBattle";

const CLEAN_ROM_SHA256 = "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446";
const ZONE = 427, OVERWORLD = 163, NPC = 9, SCRIPT = 26, SCRIPT_FILE = 854, MESSAGE = 120;
const PLUGIN = 66, PLUGIN_BASE = 0x021e5840, PLUGIN_SIZE = 0x400, PLUGIN_LIMIT = 0x021e7600;
const NATIVE_TABLE = 0x021e5be0, TABLE_SIZE = 17 * 4;
const NEW_TABLE = PLUGIN_BASE + PLUGIN_SIZE, PAYLOAD = NEW_TABLE + 0x50;
const PLUGIN_REGISTRATION = 0x0216c1ec + 14 * 20;
const SET_PORTRAIT = 1000 + 17;
const EXPECTED_SCRIPT = "2e00a600470574003d00000478000000000032003e0030002f000200";
const sourceDir = dirname(fileURLToPath(import.meta.url));

const [input, output, presentation = "leaders"] = process.argv.slice(2);
if (!input || !output?.endsWith(".nds") || !["boxed", "cutout", "cutout256", "leaders"].includes(presentation)) {
  throw new Error("Usage: vite-node runtime/dialogue-portraits/build.ts CLEAN_WHITE2.nds PROTOTYPE.nds [leaders|cutout256|cutout|boxed]");
}
const romPath = resolve(output);
const savePath = romPath.replace(/\.nds$/, ".sav");
const manifestPath = romPath.replace(/\.nds$/, ".json");
const inputBuffer = await readFile(input);
const inputBytes = new Uint8Array(inputBuffer.buffer, inputBuffer.byteOffset, inputBuffer.byteLength);
assert.equal(createHash("sha256").update(inputBytes).digest("hex"), CLEAN_ROM_SHA256, "Expected clean US White 2 revision 0");
const rom = new NintendoDSRom(inputBytes, { fileData: "view" });
assert.equal(rom.idCode, "IRDO");

const headers = new NARC(rom.getFileByName("a/0/1/2")).files[0];
assert.equal(readU16(headers, ZONE * 48 + 6), SCRIPT_FILE);
assert.equal(readU16(headers, ZONE * 48 + 10), 169);
assert.equal(readU16(headers, ZONE * 48 + 22), OVERWORLD);
const overworldsId = rom.fileId("a/1/2/6");
const overworlds = new NARC(rom.files[overworldsId]);
const events = overworlds.files[OVERWORLD];
const npcBase = 8 + events[4] * 20;
const npcs = Array.from({ length: events[5] }, (_, i) => npcBase + i * 36).filter(at => readU16(events, at) === NPC);
assert.equal(npcs.length, 1);
const npc = npcs[0];
assert.equal(readU16(events, npc + 2), 24);
assert.equal(readU16(events, npc + 10), SCRIPT);
let gridX = readU16(events, npc + 28);
let gridZ = readU16(events, npc + 30) + 1;

const files = new Map<number, Uint8Array>();
const scriptsId = rom.fileId("a/0/5/6");
const scripts = new NARC(rom.files[scriptsId]);
const originalScript = scripts.files[SCRIPT_FILE];
const entry = (SCRIPT - 1) * 4;
const start = entry + 4 + (readU32(originalScript, entry) | 0);
assert.equal(Buffer.from(originalScript.subarray(start, start + EXPECTED_SCRIPT.length / 2)).toString("hex"), EXPECTED_SCRIPT);

// Keep the native script lock, speaker, message, input waits and window close.
// The 256-color portrait follows the original single dismissal. The earlier
// boxed and 4bpp test presentations still demonstrate their second pose.
const firstPortrait = presentation === "boxed" ? 1 : 3;
const staticPortrait = presentation === "cutout256";
const sequence = [
  0x2e, 0xa6, 0x0547, 0x74,
  SET_PORTRAIT, firstPortrait, 0x3d, 0x0400, MESSAGE, 2, 0,
  ...(staticPortrait ? [] : [0x32, SET_PORTRAIT, firstPortrait + 1, 0x32, SET_PORTRAIT, 0]),
  0x32, 0x3e,
  ...(staticPortrait ? [SET_PORTRAIT, 0] : []),
  0x30, 0x2f, 2,
];
const appended = (originalScript.length + 1) & ~1;
let editedScript = new Uint8Array(appended + sequence.length * 2);
editedScript.set(originalScript);
writeU32(editedScript, entry, appended - entry - 4);
sequence.forEach((word, i) => writeU16(editedScript, appended + 2 * i, word));
let leaders: ReturnType<typeof addLeaderEvents>["leaders"] | undefined;
if (presentation === "leaders") {
  const storyId = rom.fileId("a/0/0/3");
  const story = new NARC(rom.files[storyId]);
  const lineup = addLeaderEvents(events, originalScript, story.files[169], SET_PORTRAIT);
  editedScript = lineup.newScript;
  overworlds.files[OVERWORLD] = lineup.newEvents;
  files.set(overworldsId, overworlds.save());
  story.files[169] = lineup.newTextBank;
  files.set(storyId, story.save());
  leaders = lineup.leaders;
  gridX = leaders[0].gridX;
  gridZ = leaders[0].gridZ + 1;
}
scripts.files[SCRIPT_FILE] = editedScript;
files.set(scriptsId, scripts.save());

function cutoutTiles(image: PNG): string {
  assert.equal(image.width, 112);
  assert.equal(image.height, 80);
  const palette = [0], paletteLookup = new Map<number, number>();
  const pixels = new Uint8Array(image.width * image.height);
  for (let i = 0; i < pixels.length; ++i) {
    const [r, g, b, alpha] = image.data.subarray(i * 4, i * 4 + 4);
    if (alpha === 0) continue;
    assert.equal(alpha, 255, "DS portrait art requires binary transparency");
    const color = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
    let index = paletteLookup.get(color);
    if (index === undefined) {
      index = palette.length;
      assert(index < 16, "DS cutout has more than 15 visible colors");
      palette.push(color);
      paletteLookup.set(color, index);
    }
    pixels[i] = index;
  }

  const blank = Buffer.alloc(32);
  const tiles = [blank], map: number[] = [], tileLookup = new Map([[blank.toString("hex"), 0]]);
  for (let y = 0; y < image.height; y += 8) {
    for (let x = 0; x < image.width; x += 8) {
      const tile = Buffer.alloc(32);
      for (let b = 0; b < 32; ++b) {
        const pixel = (y + (b >> 2)) * image.width + x + (b % 4) * 2;
        tile[b] = pixels[pixel] | (pixels[pixel + 1] << 4);
      }
      const key = tile.toString("hex");
      let index = tileLookup.get(key);
      if (index === undefined) {
        index = tiles.length;
        tiles.push(tile);
        tileLookup.set(key, index);
      }
      map.push(index);
    }
  }
  // The field cell-actor loader assigns a native palette resource from NCLR.
  const nclr = new Uint8Array(72);
  nclr.set(Buffer.from("RLCN"), 0);
  writeU16(nclr, 4, 0xfeff);
  writeU16(nclr, 6, 0x0100);
  writeU32(nclr, 8, nclr.length);
  writeU16(nclr, 12, 16);
  writeU16(nclr, 14, 1);
  nclr.set(Buffer.from("TTLP"), 16);
  writeU32(nclr, 20, nclr.length - 16);
  writeU32(nclr, 24, 3);
  writeU32(nclr, 32, 32);
  writeU32(nclr, 36, 16);
  palette.forEach((color, i) => writeU16(nclr, 40 + 2 * i, color));
  const archive = new NARC();
  archive.files = [nclr];
  const paletteArchive = archive.save();
  const hex = (value: number) => `0x${value.toString(16)}`;
  return [
    `enum { CUTOUT_COLUMNS = ${image.width / 8}, CUTOUT_ROWS = ${image.height / 8} };`,
    `_Alignas(4) static const uint8_t cutout_palette_archive[] = { ${Array.from(paletteArchive, hex).join(", ")} };`,
    `static const uint8_t cutout_map[] = { ${map.join(", ")} };`,
    "static const uint8_t cutout_tiles[] = {",
    ...tiles.map(tile => `    ${Array.from(tile, hex).join(", ")},`),
    "};",
  ].join("\n") + "\n";
}

await mkdir(dirname(romPath), { recursive: true });
const buildDir = await mkdtemp(join(dirname(romPath), ".portrait-build-"));
try {
  const tool = (name: string) => process.env.ARM_TOOLCHAIN_BIN ? join(process.env.ARM_TOOLCHAIN_BIN, name) : name;
  const run = (name: string, args: string[]) => execFileSync(tool(name), args, { encoding: "utf8" });
  const object = join(buildDir, "portrait.o"), elf = join(buildDir, "portrait.elf"), binary = join(buildDir, "portrait.bin");
  let artInfo;
  if (staticPortrait || leaders) {
    const spritesId = rom.fileId("a/0/5/0");
    const spriteArchive = new NARC(rom.files[spritesId]);
    if (leaders) {
      const images = await Promise.all(leaders.map(async ({ name }) =>
        PNG.sync.read(await readFile(join(sourceDir, "leaders", name + ".png")))));
      const leaderArt = leaders.map((leader, index) => {
        const image = images[index];
        assert.equal(image.width, LEADER_PANEL_WIDTH);
        outlineSilhouette(image);
        return { ...leader, ...appendCutout256(spriteArchive, image) };
      });
      artInfo = { leaderArt, panelX: LEADER_PANEL_X };
    } else {
      const image = PNG.sync.read(await readFile(join(sourceDir, "gesture-upper-body.png")));
      outlineSilhouette(image);
      artInfo = appendCutout256(spriteArchive, image);
    }
    files.set(spritesId, spriteArchive.save());
    const leaderDefines = leaders ? `#define LEADER_COUNT ${leaders.length}\n#define LEADER_X ${LEADER_PANEL_X}\n` : "";
    const columns = (leaders ? LEADER_PANEL_WIDTH : 112) / 8;
    await writeFile(join(buildDir, "cutout_tiles.h"), `#define CUTOUT_256 1\n${leaderDefines}enum { CUTOUT_COLUMNS = ${columns}, CUTOUT_ROWS = 10 };\n`);
  } else {
    const cutout = PNG.sync.read(await readFile(join(sourceDir, "n-upper-body.png")));
    await writeFile(join(buildDir, "cutout_tiles.h"), cutoutTiles(cutout));
  }
  run("arm-none-eabi-gcc", [
    "-mcpu=arm946e-s", "-mthumb", "-Os", "-std=c11", "-ffreestanding", "-Wall", "-Wextra", "-Werror",
    "-fno-builtin", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables",
    "-I", buildDir, "-c", join(sourceDir, "portrait.c"), "-o", object,
  ]);
  run("arm-none-eabi-ld", ["-T", join(sourceDir, "link.ld"), object, "-o", elf]);
  run("arm-none-eabi-objcopy", ["-O", "binary", elf, binary]);
  const payload = await readFile(binary);
  const symbols = new Map(run("arm-none-eabi-nm", ["-n", elf]).trim().split("\n").map(line => {
    const [address, , name] = line.trim().split(/\s+/);
    return [name, Number.parseInt(address, 16)];
  }));
  const handler = symbols.get("ScriptCommand_SetPortrait")!, state = symbols.get("portrait_state")!;
  assert(handler >= PAYLOAD && state >= PAYLOAD && state + 56 <= PAYLOAD + payload.length);
  assert.equal(payload.subarray(state - PAYLOAD, state - PAYLOAD + 4).toString("ascii"), "WPRT");

  const overlays = rom.loadArm9Overlays([12, PLUGIN]);
  const plugin = overlays.get(PLUGIN)!, dispatch = overlays.get(12)!;
  assert.equal(plugin.ramAddress, PLUGIN_BASE);
  assert.equal(plugin.ramSize, PLUGIN_SIZE);
  assert.equal(plugin.bssSize, 0);
  const tableOffset = NATIVE_TABLE - PLUGIN_BASE;
  assert.equal(readU32(plugin.data, tableOffset + TABLE_SIZE), 0xffffffff);
  const registration = PLUGIN_REGISTRATION - dispatch.ramAddress;
  assert.equal(readU32(dispatch.data, registration), NATIVE_TABLE);
  assert.equal(readU32(dispatch.data, registration + 12), PLUGIN);
  const pluginSize = (PAYLOAD - PLUGIN_BASE + payload.length + 31) & ~31;
  assert(PLUGIN_BASE + pluginSize <= PLUGIN_LIMIT);
  const expanded = new Uint8Array(pluginSize);
  expanded.set(plugin.data);
  expanded.set(plugin.data.subarray(tableOffset, tableOffset + TABLE_SIZE), PLUGIN_SIZE);
  writeU32(expanded, PLUGIN_SIZE + TABLE_SIZE, handler | 1);
  writeU32(expanded, PLUGIN_SIZE + TABLE_SIZE + 4, 0xffffffff);
  expanded.set(payload, PAYLOAD - PLUGIN_BASE);
  writeU32(dispatch.data, registration, NEW_TABLE);

  const overlayTable = rom.arm9OverlayTable.slice();
  for (const [overlay, bytes] of [[dispatch, dispatch.data], [plugin, expanded]] as const) {
    const row = overlay.fileId * 32;
    assert.equal(readU32(overlayTable, row + 24), overlay.fileId);
    files.set(overlay.fileId, bytes);
    writeU32(overlayTable, row + 8, bytes.length);
    writeU32(overlayTable, row + 28, readU32(overlayTable, row + 28) & 0xfe000000);
  }

  const out = rom.save({ files, arm9OverlayTable: overlayTable });
  const reloaded = new NintendoDSRom(out, { fileData: "view" });
  const rebuilt = reloaded.loadArm9Overlays([12, PLUGIN]);
  assert.equal(readU32(rebuilt.get(12)!.data, registration), NEW_TABLE);
  assert.deepEqual(Buffer.from(rebuilt.get(PLUGIN)!.data.subarray(PAYLOAD - PLUGIN_BASE, PAYLOAD - PLUGIN_BASE + payload.length)), payload);
  const scriptArchive = new NARC(reloaded.files[scriptsId]);
  for (const [index, bytes] of scriptArchive.files.entries()) {
    assert.deepEqual(bytes, index === SCRIPT_FILE ? editedScript : scripts.files[index], `Script file ${index}`);
  }
  const rebuiltEvents = new NARC(reloaded.files[overworldsId]);
  for (const [index, bytes] of rebuiltEvents.files.entries()) {
    assert.deepEqual(bytes, overworlds.files[index], `Overworld file ${index}`);
  }

  // Reposition a copy of the bundled test fixture. This is never a user save.
  const save = await readFile(join(sourceDir, "../../src/assets/testbattle/test.sav"));
  const layout = getTestBattleConfig("BW2").saveLayout;
  for (const half of [0, layout.saveHalfOffset]) {
    const situation = half + 0x19500;
    assert.equal(readU16(save, situation + 4), ZONE);
    writeU16(save, situation + 8, 1); // Warp direction up, toward the NPC.
    writeU32(save, situation + 0x10, gridX * 0x10000 + 0x8000);
    writeU32(save, situation + 0x18, gridZ * 0x10000 + 0x8000);
    writeU32(save, situation + 0x84, gridX * 0x10000 + 0x8000);
    writeU32(save, situation + 0x8c, gridZ * 0x10000 + 0x8000);
    refreshTestBattleSaveBlockChecksum(save, layout, half, 0x19500, 0xa8, 0x195aa, 28);
    if (leaders) seedLeaderActors(save, layout, half, ZONE, leaders);
  }

  // Exclusive writes protect an existing ROM or save at the destination.
  await writeFile(romPath, out, { flag: "wx" });
  await writeFile(savePath, save, { flag: "wx" });
  const manifest = {
    zone: ZONE, overworld: OVERWORLD, ...(leaders ? {} : { npc: NPC, script: SCRIPT }),
    gridX, gridZ, state, presentation, staticPortrait: staticPortrait || !!leaders,
    ...artInfo, romSha256: createHash("sha256").update(out).digest("hex"),
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...manifest, bytes: out.length, romPath, savePath }));
} finally {
  await rm(buildDir, { recursive: true });
}

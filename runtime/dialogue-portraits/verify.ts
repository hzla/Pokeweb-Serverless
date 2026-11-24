import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { outlineSilhouette } from "./cutout256";
import { PNG } from "pngjs";
import { toDesmumeDsv } from "../../src/pokeweb/testBattle";

type LeaderArt = { name: string; npc: number; sprite: number; script: number; gridX: number; gridZ: number; portrait: number; visibleColors: number };
const path = process.argv[2];
if (!path?.endsWith(".nds")) throw new Error("Pass the prototype .nds produced by build.ts.");
const prefix = path.slice(0, -4);
const [rom, rawSave, manifest] = await Promise.all([
  readFile(path),
  readFile(prefix + ".sav"),
  readFile(prefix + ".json", "utf8").then(text => JSON.parse(text) as { state: number; romSha256: string; presentation?: string; visibleColors?: number; staticPortrait?: boolean; leaderArt?: LeaderArt[]; panelX?: number }),
]);
assert.equal(createHash("sha256").update(rom).digest("hex"), manifest.romSha256);
const extended = manifest.presentation === "cutout256";
const cutout = extended || manifest.presentation === "cutout";
const firstPortrait = cutout ? 3 : 1;

const corePath = fileURLToPath(new URL("../../public/desmond/desmond.js", import.meta.url));
const source = await readFile(corePath, "utf8");
let ready!: () => void;
const initialized = new Promise<void>(resolve => { ready = resolve; });
const fatal: string[] = [];
function log(...args: unknown[]) {
  const line = args.join(" ");
  if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(line)) fatal.push(line);
}
const context = vm.createContext({
  Module: { noInitialRun: true, onRuntimeInitialized: ready },
  require: createRequire(import.meta.url), process, Buffer, URL, TextDecoder, TextEncoder,
  setTimeout, clearTimeout, performance, wasmReady() {},
  __dirname: dirname(corePath), __filename: corePath,
  console: { log, warn: log, error: log, info: log, debug: log },
});
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), context);
await initialized;
const core = context.Module;
core._main(0, 0);
const size = Math.max(rom.length, 128 * 1024 * 2 ** rom[0x14]);
const cart = core._prepareRomBuffer(size);
core.HEAPU8.set(rom, cart);
core.HEAPU8.fill(0xff, cart + rom.length, cart + size);
const save = toDesmumeDsv(rawSave);
core.HEAPU8.set(save, core._savGetPointer(save.length));
core._savUpdateChangeFlag();
assert.equal(core._loadROM(size), 1, "Emulator rejected the prototype ROM");

const stateAt = manifest.state - 0x02000000;
const SCREEN = 256 * 192 * 4, A = 128, B = 64, START = 32;
const directions = [8, 4, 2, 1]; // Up, Down, Left, Right in native facing order.
let frame = 0;
function step(frames: number, keys = 0) {
  for (let i = 0; i < frames; ++i) {
    core._runFrame(1, keys, 0, 0, 0);
    ++frame;
    if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("\n")}`);
  }
}
function memory() {
  return Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
}
function state() {
  const ram = memory();
  const [magic, requested, applied, changes, panel, result] = Array.from({ length: 6 }, (_, i) => ram.readUInt32LE(stateAt + i * 4));
  return { magic, requested, applied, changes, panel, result };
}
async function capture(label: string) {
  const png = new PNG({ width: 256, height: 192 });
  png.data = Buffer.from(topScreen());
  await writeFile(`${prefix}-${label}.png`, PNG.sync.write(png));
  return png.data;
}
function topScreen() {
  const pointer = core._getSymbol(4) >>> 0;
  return core.HEAPU8.subarray(pointer, pointer + SCREEN) as Uint8Array;
}
function fieldVisible() {
  const pixels = topScreen();
  let colorful = 0;
  for (let i = 0; i < SCREEN; i += 4 * 32) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    colorful += Number(Math.max(r, g, b) - Math.min(r, g, b) > 24);
  }
  return colorful > 300;
}
function crop(image: Buffer, x: number, y: number, width: number, height: number) {
  return Buffer.concat(Array.from({ length: height }, (_, row) => {
    const offset = ((y + row) * 256 + x) * 4;
    return image.subarray(offset, offset + width * 4);
  }));
}
function changedPixels(before: Buffer, after: Buffer) {
  assert.equal(before.length, after.length);
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) changed += Number(before.readUInt32LE(i) !== after.readUInt32LE(i));
  return changed;
}
function press(key: number, settle = 30) {
  step(3, key);
  step(settle);
}
function fieldAddress(ram: Buffer) {
  const gsys = ram.readUInt32LE(0x02141134 - 0x02000000);
  return ram.readUInt32LE(gsys + 0x20 - 0x02000000);
}
function nativeDialogueWindow() {
  const ram = memory();
  const pointer = (address: number) => ram.readUInt32LE(address - 0x02000000);
  const messages = pointer(fieldAddress(ram) + 0x28);
  // The bottom ActorMsgWin owns talk slot 1 until the native close completes.
  const talk = pointer(messages + 0xc0 + 0x34 + 8);
  return talk ? pointer(talk + 0x18 + 0x64 + 0xc) : 0;
}
function actors(target: Pick<LeaderArt, "npc" | "sprite" | "script"> = { npc: 9, sprite: 24, script: 26 }) {
  const ram = memory();
  const index = (address: number) => address - 0x02000000;
  const pointer = (address: number) => ram.readUInt32LE(index(address));
  const halfword = (address: number) => ram.readUInt16LE(index(address));
  const system = pointer(fieldAddress(ram) + 0x40);
  const heap = pointer(system + 0x1c), capacity = halfword(system + 4);
  function actor(address: number) {
    return { x: halfword(address + 0x3c), z: halfword(address + 0x40), facing: halfword(address + 0x18) };
  }
  let player: ReturnType<typeof actor> | undefined, npc: ReturnType<typeof actor> | undefined;
  for (let i = 0; i < capacity; ++i) {
    const address = heap + i * 0x100, id = halfword(address + 8);
    if (id === 0xff) player = actor(address);
    if (id === target.npc && halfword(address + 0xa) === 427
      && halfword(address + 0xc) === target.sprite && halfword(address + 0x14) === target.script) npc = actor(address);
  }
  assert(player && npc, "Did not find the player and target NPC in the active field");
  return { player, npc };
}
async function startConversation(changes: number) {
  let before: Buffer | undefined;
  for (let attempt = 0; attempt < 16 && state().changes === changes; ++attempt) {
    const { player, npc } = actors();
    const dx = npc.x - player.x, dz = npc.z - player.z;
    const distance = Math.abs(dx) + Math.abs(dz);
    assert(distance <= 6, "The fixture is too far from the designated NPC");
    const facing = dx > 0 ? 3 : dx < 0 ? 2 : dz > 0 ? 1 : 0;
    if (distance === 1 && player.facing === facing) {
      if (changes === 0) before = await capture("before");
      press(A, 18);
    } else {
      step(distance <= 1 ? 3 : 12, directions[facing]);
      step(18);
    }
  }
  step(210);
  return before;
}
function checkPortrait(id: number, changes: number) {
  const current = state();
  assert.equal(current.magic, 0x54525057);
  assert.equal(current.requested, id);
  assert.equal(current.applied, id);
  assert.equal(current.changes, changes);
  assert.equal(current.result, 1);
  if (id) assert.ok(current.panel >= 0x02000000 && current.panel < 0x02400000);
  else assert.equal(current.panel, 0);
  return current;
}

async function checkStaticDialogue(priorBanks: Buffer, bankState: () => Buffer) {
  const asset = PNG.sync.read(await readFile(new URL("./gesture-upper-body.png", import.meta.url)));
  outlineSilhouette(asset);
  const panel = (screen: Buffer) => crop(screen, 8, 66, asset.width, asset.height);
  const text = (screen: Buffer) => crop(screen, 16, 154, 208, 34);
  for (const [run, key] of [A, B].entries()) {
    const before = await startConversation(run * 2);
    const active = checkPortrait(firstPortrait, run * 2 + 1);
    const window = nativeDialogueWindow();
    assert(window && bankState().readUInt16LE(16) === 32);
    const shown = run === 0 ? await capture("set") : Buffer.from(topScreen());
    step(90);
    assert.equal(checkPortrait(firstPortrait, run * 2 + 1).panel, active.panel);
    assert.equal(nativeDialogueWindow(), window);
    const held = Buffer.from(topScreen());
    assert.deepEqual(text(shown), text(held));
    const initial = panel(shown), later = panel(held);
    const colors = new Set<number>();
    for (let i = 0; i < asset.data.length; i += 4) {
      if (!asset.data[i + 3]) continue;
      for (let channel = 0; channel < 3; ++channel) {
        assert.equal(initial[i + channel] >> 3, asset.data[i + channel] >> 3, "On-screen portrait differs from the source");
      }
      assert.equal(initial.readUInt32LE(i), later.readUInt32LE(i), "Portrait moved while waiting for input");
      colors.add(initial.readUInt32LE(i));
    }
    assert.equal(colors.size, manifest.visibleColors);
    press(key, 90);
    checkPortrait(0, run * 2 + 2);
    assert.equal(nativeDialogueWindow(), 0, "A single press should close the native dialogue");
    assert.deepEqual(bankState(), priorBanks);
    const closed = await capture(run === 0 ? "closed" : "replay-closed");
    assert(changedPixels(text(held), text(closed)) >= 1000);
    assert(changedPixels(later, panel(closed)) >= 1000);
    if (before) assert(changedPixels(panel(before), panel(closed)) < 112 * 80 * 0.15);
  }
  console.log(JSON.stringify({ passed: true, runs: 2, singlePressClose: true, visibleColors: manifest.visibleColors }));
}

async function checkLeaderLineup(leaders: LeaderArt[], panelX: number, priorBanks: Buffer, bankState: () => Buffer) {
  const lines = new Set<string>();
  for (const [index, leader] of leaders.entries()) {
    for (let attempt = 0; attempt < 16; ++attempt) {
      const { player, npc } = actors(leader);
      assert.equal(npc.x, leader.gridX);
      assert.equal(npc.z, leader.gridZ);
      assert.equal(player.z, npc.z + 1, "Tester left the route below the leaders");
      if (player.x === npc.x) break;
      step(12, player.x < npc.x ? directions[3] : directions[2]);
      step(20);
    }
    for (let attempt = 0; attempt < 8 && actors(leader).player.facing !== 0; ++attempt) {
      step(12, directions[0]);
      step(18);
    }
    const { player, npc } = actors(leader);
    assert.deepEqual(player, { x: npc.x, z: npc.z + 1, facing: 0 }, `Could not reach ${leader.name}`);
    press(A, 180);
    const active = checkPortrait(leader.portrait, index * 2 + 1);
    const window = nativeDialogueWindow();
    assert(window && bankState().readUInt16LE(16) === 32);
    const shown = await capture(leader.name);
    const text = crop(shown, 14, 151, 75, 20);
    lines.add(createHash("sha256").update(text).digest("hex"));

    const asset = PNG.sync.read(await readFile(new URL(`./leaders/${leader.name}.png`, import.meta.url)));
    outlineSilhouette(asset);
    assert(panelX > 0 && panelX + asset.width < 256);
    for (let y = 0; y < asset.height; ++y) {
      const row = y * asset.width * 4;
      assert.equal(asset.data[row + 3], 0, `Left edge clips ${leader.name}`);
      assert.equal(asset.data[row + asset.width * 4 - 1], 0, `Right edge clips ${leader.name}`);
    }
    const panel = (screen: Buffer) => crop(screen, panelX, 66, asset.width, asset.height);
    const pixels = panel(shown);
    step(36);
    assert.equal(checkPortrait(leader.portrait, index * 2 + 1).panel, active.panel);
    assert.equal(nativeDialogueWindow(), window);
    assert.deepEqual(crop(Buffer.from(topScreen()), 14, 151, 75, 20), text);
    const later = panel(Buffer.from(topScreen()));
    const colors = new Set<number>();
    let bottom = 0;
    for (let i = 0; i < asset.data.length; i += 4) {
      if (!asset.data[i + 3]) continue;
      for (let channel = 0; channel < 3; ++channel) {
        assert.equal(pixels[i + channel] >> 3, asset.data[i + channel] >> 3, `Wrong portrait for ${leader.name}`);
      }
      assert.equal(pixels.readUInt32LE(i), later.readUInt32LE(i), `Portrait moved for ${leader.name}`);
      colors.add(pixels.readUInt32LE(i));
      if (i >= (asset.height - 1) * asset.width * 4) ++bottom;
    }
    assert.equal(colors.size, leader.visibleColors);
    assert(bottom >= 10, "Portrait does not reach the rim");
    press(index % 2 === 0 ? A : B, 55);
    checkPortrait(0, index * 2 + 2);
    assert.equal(nativeDialogueWindow(), 0);
    assert.deepEqual(bankState(), priorBanks);
    const cleared = panel(Buffer.from(topScreen()));
    assert(changedPixels(pixels, cleared) > 500);
  }
  assert.equal(lines.size, leaders.length, "Expected a different text raster for each leader");
  console.log(JSON.stringify({ passed: true, leaders: leaders.length, distinctLines: lines.size, frame, panelX, changes: state().changes }));
}

try {
  while (frame < 2400 && state().magic !== 0x54525057) {
    press(frame < 450 ? 0 : frame % 120 < 60 ? START : A, 27);
  }
  assert.equal(state().magic, 0x54525057, "Did not start Aspertia City");
  for (let i = 0; i < 40 && !fieldVisible(); ++i) step(15);
  assert(fieldVisible(), "Aspertia City never became visible");
  step(30);

  const bankState = () => Buffer.from(memory().subarray(0x14c0cc, 0x14c0cc + 26));
  const priorBanks = bankState();
  if (manifest.leaderArt && manifest.panelX !== undefined) {
    await checkLeaderLineup(manifest.leaderArt, manifest.panelX, priorBanks, bankState);
  } else if (manifest.staticPortrait) {
    await checkStaticDialogue(priorBanks, bankState);
  } else {
    const before = await startConversation(0);
    const first = checkPortrait(firstPortrait, 1);
    assert(before);
    const nativeWindow = nativeDialogueWindow();
    assert(nativeWindow >= 0x02000000 && nativeWindow < 0x02400000, "Missing native bottom dialogue window");
    if (extended) assert.equal(bankState().readUInt16LE(16), 32, "Missing extended OBJ palette in bank F");
    const set = await capture("set");
    press(A);
    assert.equal(checkPortrait(firstPortrait + 1, 2).panel, first.panel, "Swap allocated a different window");
    assert.equal(nativeDialogueWindow(), nativeWindow, "Swap replaced the dialogue window");
    const swap = await capture("swap");
    press(B);
    checkPortrait(0, 3);
    assert.equal(nativeDialogueWindow(), nativeWindow, "Clear replaced the dialogue window");
    if (extended) assert.deepEqual(bankState(), priorBanks, "VRAM banks changed after clear");
    const clear = await capture("clear");
    press(A, 90);
    assert.equal(nativeDialogueWindow(), 0, "The native window was not released");
    const closed = await capture("closed");

    const panel = (image: Buffer) => cutout ? crop(image, 8, 66, 112, 80) : crop(image, 16, 96, 48, 48);
    const text = (image: Buffer) => crop(image, 16, 154, 208, 34);
    assert(changedPixels(panel(set), panel(swap)) >= (cutout ? 1000 : 10), "Portrait did not change on screen");
    assert(changedPixels(panel(swap), panel(clear)) >= 1000, "Clearing did not uncover the scene");
    // The larger cutout can share screen space with the native speech tail,
    // which has appeared between the before and clear captures.
    const fieldChanges = changedPixels(panel(before), panel(clear));
    assert(fieldChanges < (cutout ? 112 * 80 * 0.15 : 150), "Portrait area did not return to the field");
    assert.deepEqual(text(set), text(swap), "Native dialogue pixels changed during the swap");
    assert.deepEqual(text(set), text(clear), "Native dialogue pixels changed during the clear");
    assert(changedPixels(text(clear), text(closed)) >= 1000, "The third press did not close the dialogue");
    if (cutout) {
      const asset = PNG.sync.read(await readFile(new URL(extended ? "./gesture-upper-body.png" : "./n-upper-body.png", import.meta.url)));
      const shown = panel(set), underneath = panel(clear);
      let transparent = 0, matching = 0;
      for (let i = 0; i < asset.data.length; i += 4) {
        if (asset.data[i + 3] !== 0) continue;
        ++transparent;
        matching += Number(shown.readUInt32LE(i) === underneath.readUInt32LE(i));
      }
      assert(transparent > 4000 && matching / transparent > 0.98, "Transparent cutout pixels did not expose the overworld");
      if (extended) {
        const rgb555 = (data: Buffer, p: number) =>
          (data[p] >> 3) | ((data[p + 1] >> 3) << 5) | ((data[p + 2] >> 3) << 10);
        for (const [image, mirrored] of [[shown, false], [panel(swap), true]] as const) {
          const colors = new Set<number>();
          let mismatches = 0;
          for (let y = 0; y < asset.height; ++y) {
            for (let x = 0; x < asset.width; ++x) {
              const src = (y * asset.width + x) * 4;
              if (!asset.data[src + 3]) continue;
              const dst = (y * asset.width + (mirrored ? asset.width - 1 - x : x)) * 4;
              const actual = rgb555(image, dst);
              colors.add(actual);
              if (actual !== rgb555(asset.data, src)) ++mismatches;
            }
          }
          assert.equal(mismatches, 0, "Opaque portrait pixels differ from the RGB555 source");
          assert.equal(colors.size, manifest.visibleColors, "Missing on-screen palette entries");
        }
      }
      const border = (image: Buffer) => crop(image, 8, 146, 112, 6);
      assert.deepEqual(border(set), border(clear), "Cutout touched the visible dialogue border");
      assert.deepEqual(border(swap), border(clear), "Mirrored cutout touched the visible dialogue border");
      for (const image of [set, swap]) {
        assert(changedPixels(crop(image, 8, 145, 112, 1), crop(clear, 8, 145, 112, 1)) >= 25,
          "The cutout does not reach the row immediately above the visible border");
      }
    }

    // Reopening also checks that the same slot and palette can be acquired again.
    await startConversation(3);
    checkPortrait(firstPortrait, 4);
    press(B);
    checkPortrait(firstPortrait + 1, 5);
    press(A);
    checkPortrait(0, 6);
    const replayDialogue = Buffer.from(topScreen());
    press(B, 90);
    const replayed = await capture("replay-closed");
    assert.equal(nativeDialogueWindow(), 0, "Replay left the native window allocated");
    assert(changedPixels(text(replayDialogue), text(replayed)) >= 1000, "Replay left the dialogue on screen");

    console.log(JSON.stringify({
      passed: true, frame, runs: 2, changes: state().changes, nativeTextIdentical: true,
      posePixelsChanged: changedPixels(panel(set), panel(swap)),
      clearedPanelPixelsChanged: changedPixels(panel(swap), panel(clear)),
    }));
  }
} catch (error) {
  await capture("failure");
  let positions;
  try { positions = actors(); } catch { /* The field may not have loaded. */ }
  console.error(JSON.stringify({ frame, state: state(), positions, fatal }));
  throw error;
}

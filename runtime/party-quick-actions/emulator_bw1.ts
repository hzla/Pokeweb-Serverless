// Candidate DS checks use copied bundled fixtures; retail inputs stay read-only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import toolbar from "../../src/assets/codeinjection/partyQuickActionsBw1Manifest.json";
import candy from "../../src/assets/codeinjection/infiniteCandyBw1Manifest.json";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { buildQuickLaunchDownloads } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerParty, decryptPk5Party, encryptPk5Party } from "../../src/pokeweb/testBattleTeam";
import { installPartyQuickActions, getPartyQuickActionsStatus } from "../../src/pokeweb/partyQuickActionsModel";
import { installBattleLog } from "../../src/pokeweb/battleLogModel";
import { installMenuEvolution } from "../../src/pokeweb/menuEvolutionModel";
import { installLearnsetViewer } from "../../src/pokeweb/learnsetViewerModel";
import { installSummaryStatViewer } from "../../src/pokeweb/summaryStatViewerModel";

const input = process.argv[2]; if (!input) throw new Error("Pass a clean US BW1 revision-0 ROM.");
const option = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const resume = option("--resume", ""), digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const scenario = option("--scenario", "hp"), frames = Number(option("--frames", "6500"));
const bagEntry = process.argv.includes("--entry-bag");
globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(input)), "bw1-toolbar.nds", { selectedNarcs: [] });
const game = project.session.baseVersion; if (game !== "B" && game !== "W") throw new Error("Only BW1 is supported by this runner.");
const runName = option("--name", `emulator-${game}-${scenario}${process.argv.includes("--companions") ? "-companions" : ""}${process.argv.includes("--power-on") ? "-on" : "-off"}`);
if (!/^[\w-]+$/.test(runName)) throw new Error("Invalid output directory name.");
const out = new URL(`./build/${runName}/`, import.meta.url);
await mkdir(out, { recursive: true });
const acceptance = [toolbar.games.B.dsAccepted, toolbar.games.W.dsAccepted, candy.games.B.dsAccepted, candy.games.W.dsAccepted];
const sectionKeys = ["candy", "heal", "hp", "exp", "statuses"] as const;
const sectionFlags = { candy: 0x600, heal: 0x601, hp: 0x602, exp: 0x603, statuses: 0x604 };
const hiddenSections = option("--sections", "").split(",").filter(Boolean);
if (hiddenSections.some(id => !sectionKeys.includes(id as typeof sectionKeys[number]))) throw new Error("Unknown section.");
let downloads: Awaited<ReturnType<typeof buildQuickLaunchDownloads>>;
try {
  toolbar.games.B.dsAccepted = toolbar.games.W.dsAccepted = candy.games.B.dsAccepted = candy.games.W.dsAccepted = true;
  if (process.argv.includes("--companions")) {
    await installBattleLog(project); await installMenuEvolution(project);
    await installLearnsetViewer(project); await installSummaryStatViewer(project);
  }
  await installPartyQuickActions(project, { hideFlag: scenario === "hidden" ? 0x5ee : undefined, sectionHideFlags: scenario === "sections" ? sectionFlags : undefined });
  if (!getPartyQuickActionsStatus(project).compatible) throw new Error("Candidate staging failed.");
  downloads = await buildQuickLaunchDownloads(project);
} finally {
  [toolbar.games.B.dsAccepted, toolbar.games.W.dsAccepted, candy.games.B.dsAccepted, candy.games.W.dsAccepted] = acceptance;
}
let team = "Oshawott\nLevel: 15\n- Tackle\n- Tail Whip\n- Water Gun\n- Water Sport\n\nMew\nLevel: 20\n- Pound\n\nPikachu\nLevel: 15\n- Tackle\n\nEevee\nLevel: 15\n- Tackle\n\nSnivy\nLevel: 15\n- Tackle\n\nTepig\nLevel: 15\n- Tackle";
if (scenario === "cancel-evolution") team = team.replace("Level: 15\n- Tackle\n- Tail Whip\n- Water Gun\n- Water Sport", "Level: 16\n- Tackle");
const fixturePath = option("--fixture-copy", "");
const fixture = fixturePath ? Buffer.from(await readFile(fixturePath)) : Buffer.from(patchTestBattleSavePlayerParty(downloads!.saveBytes, project, team, "BW"));
function crc(bytes: Uint8Array) { let n = 0xffff; for (const v of bytes) { n ^= v << 8; for (let i = 0; i < 8; i++) n = n & 0x8000 ? (n << 1) ^ 0x1021 : n << 1; n &= 0xffff; } return n; }
for (const half of [0, 0x24000]) {
  if (!fixturePath && (scenario === "heal" || process.argv.includes("--companions"))) {
    for (let i = 0; i < 6; i++) {
      const at = half + 0x18e08 + i * 220, pk = Buffer.from(decryptPk5Party(new Uint8Array(fixture.subarray(at, at + 220))));
      if (scenario === "heal") {
        pk.writeUInt16LE(i === 0 ? 0 : Math.max(1, pk.readUInt16LE(144) - i * 3), 142);
        pk.writeUInt32LE([8, 64, 32, 16, 3, 8][i], 136);
        if (i === 2) pk.writeUInt32LE((pk.readUInt32LE(56) | 0x40000000) >>> 0, 56);
      }
      if (process.argv.includes("--companions")) { pk[67] = 30; pk[94] = 5; }
      fixture.set(encryptPk5Party(pk), at);
    }
    const sum = crc(fixture.subarray(half + 0x18e00, half + 0x19334)); fixture.writeUInt16LE(sum, half + 0x19336); fixture.writeUInt16LE(sum, half + 0x23f34);
  }
  const start = half + 0x18400 + 0x4d8;
  if (bagEntry && !fixturePath) {
    fixture.fill(0, start, start + 83 * 4);
    const medicine = half + 0x18400 + 0x7d8;
    fixture.fill(0, medicine, medicine + 48 * 4); fixture.writeUInt16LE(50, medicine); fixture.writeUInt16LE(2, medicine + 2);
  }
  for (let i = 0; i < 83; i++) {
    const at = start + i * 4, item = fixture.readUInt16LE(at);
    if (item === 622 || item === 0) { fixture.writeUInt16LE(process.argv.includes("--no-candy") ? 0 : 622, at); fixture.writeUInt16LE(process.argv.includes("--no-candy") ? 0 : 1, at + 2); break; }
  }
  const sum = crc(fixture.subarray(half + 0x18400, half + 0x18dc0)); fixture.writeUInt16LE(sum, half + 0x18dc2); fixture.writeUInt16LE(sum, half + 0x23f32);
  if (scenario === "sections" || scenario === "hidden") {
    const flags = scenario === "hidden" ? [0x5ee] : hiddenSections.map(id => sectionFlags[id as typeof sectionKeys[number]]);
    if (scenario === "sections") for (const flag of Object.values(sectionFlags)) fixture[half + 0x20100 + 0x27c + (flag >> 3)] &= ~(1 << (flag & 7));
    for (const flag of flags) fixture[half + 0x20100 + 0x27c + (flag >> 3)] |= 1 << (flag & 7);
    const sum = crc(fixture.subarray(half + 0x20100, half + 0x204ec)); fixture.writeUInt16LE(sum, half + 0x204ee); fixture.writeUInt16LE(sum, half + 0x23f5a);
  }
  fixture.writeUInt16LE(crc(fixture.subarray(half + 0x23f00, half + 0x23f8c)), half + 0x23f9a);
}
const corePath = new URL("../../public/desmond/desmond.js", import.meta.url), source = await readFile(corePath, "utf8");
let ready!: () => void; const initialized = new Promise<void>(r => ready = r), fatal: string[] = [];
const log = (...args: unknown[]) => { if (/Undefined instruction|Assertion failed|Aborted\(/iu.test(args.join(" "))) fatal.push(args.join(" ")); };
const context = vm.createContext({ Module: { noInitialRun: true, onRuntimeInitialized: ready }, require: createRequire(import.meta.url), process, Buffer, URL,
  TextDecoder, TextEncoder, setTimeout, clearTimeout, performance, wasmReady() {}, __dirname: fileURLToPath(new URL("../../public/desmond", import.meta.url)),
  __filename: fileURLToPath(corePath), console: { log, warn: log, error: log, info: log, debug: log } });
vm.runInContext(source.slice(source.indexOf("var Module=typeof Module")), context); await initialized;
const core = context.Module; core._main(0, 0);
const rom = resume ? new Uint8Array(await readFile(join(dirname(resume), "test.nds"))) : downloads!.romBytes;
if (resume) {
  const parent = JSON.parse(await readFile(join(dirname(resume), "run.json"), "utf8"));
  if (parent.toolbarSha256 !== toolbar.games[game].sha256 || parent.candySha256 !== candy.games[game].sha256
    || parent.romSha256 !== digest(rom)) throw new Error("Checkpoint does not match the current candidate binaries.");
}
const size = Math.max(rom.length, 128 * 1024 * 2 ** rom[0x14]), ptr = core._prepareRomBuffer(size);
core.HEAPU8.set(rom, ptr); core.HEAPU8.fill(255, ptr + rom.length, ptr + size); core.HEAPU8.set(fixture, core._savGetPointer(fixture.length)); core._savUpdateChangeFlag();
if (core._loadROM(size) !== 1) throw new Error("Emulator rejected ROM.");
if (resume) {
  // Desmond's native state loader does not restore renderer callbacks in a
  // fresh process. Local checkpoints preserve the complete WASM memory.
  const state = gunzipSync(await readFile(resume));
  if (state.length !== core.HEAPU8.length) throw new Error("Checkpoint memory size differs.");
  core.HEAPU8.set(state);
}
const ram = () => Buffer.from(core.HEAPU8.buffer, core._getSymbol(7) >>> 0, 0x400000);
type Input = { frame: number; touch?: [number, number]; buttons?: number; duration?: number };
// Native BW1 boot, then X, first A shows the menu cursor, second A opens Party.
const boot: Input[] = [{ frame: 1500, buttons: 32 }, { frame: 1800, buttons: 128 }, { frame: 2000, buttons: 128 }, { frame: 2200, buttons: 128 },
  { frame: 2400, buttons: process.argv.includes("--power-on") ? 8 : 4 }, { frame: 2500, buttons: 128 },
  { frame: 4000, buttons: 512, duration: 30 }, { frame: 4800, buttons: 128 }, { frame: 5000, buttons: 128 }];
const scenarios: Record<string, Input[]> = {
  hp: [{ frame: 5200, touch: [53, 180] }, { frame: 5250, buttons: 1 }, { frame: 5270, buttons: 2 }, { frame: 5300, buttons: 2, duration: 30 },
    { frame: 5400, touch: [188, 40] }, { frame: 5500, buttons: 64 }, { frame: 5600, buttons: 64 }, { frame: 6000, buttons: 128 }],
  xp: [{ frame: 5200, touch: [73, 180] }, { frame: 5240, buttons: 64 }, { frame: 5300, touch: [73, 180] }, { frame: 5340, buttons: 128 }, { frame: 5400, buttons: 128 },
    { frame: 5480, buttons: 1024 }, { frame: 5520, buttons: 1 }, { frame: 5560, buttons: 1 }, { frame: 5600, buttons: 1 }, { frame: 5640, buttons: 128 }, { frame: 5700, buttons: 64 }],
  status: Array.from({ length: 5 }, (_, i) => [{ frame: 5200 + 120 * i, touch: [53, 180] }, { frame: 5220 + 120 * i, touch: [93 + 20 * i, 180] },
    { frame: 5240 + 120 * i, touch: [93 + 20 * i, 180] }, { frame: 5260 + 120 * i, touch: [53, 180] },
    { frame: 5280 + 120 * i, touch: [93 + 20 * i, 180] }, { frame: 5300 + 120 * i, touch: [93 + 20 * i, 180] }] as Input[]).flat(),
  heal: [{ frame: 5200, touch: [33, 180], duration: 24 }, { frame: 5240, buttons: 64 }, { frame: 5280, touch: [33, 180] }, { frame: 5320, touch: [111, 180] },
    { frame: 5400, touch: [33, 180] }, { frame: 5440, buttons: 128 }, { frame: 5500, buttons: 1024 }, { frame: 5540, buttons: 1 },
    { frame: 5580, buttons: 128 }, { frame: 5620, buttons: 64 }, { frame: 5700, buttons: 128 }, { frame: 5740, buttons: 128 }],
  hidden: [{ frame: 5200, buttons: 1024 }, { frame: 5300, touch: [33, 180] }],
  sections: [{ frame: 5200, buttons: 1024 }, { frame: 5240, buttons: 1 }, { frame: 5280, buttons: 1 }, { frame: 5320, buttons: 128 }, { frame: 5360, buttons: 64 }],
  candy: [{ frame: 5200, touch: [13, 180], duration: 24 }, { frame: 5400, buttons: 128 }, { frame: 5520, buttons: 128 }, { frame: 5640, buttons: 128 },
    { frame: 6000, touch: [13, 180] }, ...Array.from({ length: 24 }, (_, i) => ({ frame: 6200 + i * 160, buttons: 128 })),
    { frame: 12500, buttons: 4 }, { frame: 12560, buttons: 128 }],
  "cancel-evolution": [{ frame: 5200, touch: [13, 180] }, ...[5400, 5520, 5640, 5760, 5880, 6000].map(frame => ({ frame, buttons: 128 })),
    ...Array.from({ length: 12 }, (_, i) => ({ frame: 6120 + i * 160, buttons: 64 })), { frame: 8120, buttons: 128 }, { frame: 8320, buttons: 128 }],
  "bag-proof": [
    ...[5200, 5320, 5440, 5560].map(frame => ({ frame, touch: [132, 180] as [number, number] })),
    ...[5760, 5920, 6440, 7740, 7880, 8020].map(frame => ({ frame, buttons: 128 })),
    { frame: 8160, buttons: 64 }, ...[8500, 8640].map(frame => ({ frame, touch: [132, 180] as [number, number] })),
    ...[8800, 8960].map(frame => ({ frame, buttons: 128 })), { frame: 9500, touch: [185, 25] },
    ...[10760, 10900, 11040].map(frame => ({ frame, buttons: 128 })), { frame: 11200, buttons: 64 },
  ],
  "save-proof": [{ frame: 5200, touch: [53, 180] }, { frame: 5240, buttons: 2 }, { frame: 5280, buttons: 2, duration: 30 },
    { frame: 5400, buttons: 64 }, { frame: 5600, buttons: 64 },
    { frame: 6300, touch: [55, 140] }, { frame: 6660, buttons: 128 }, { frame: 6960, buttons: 128 }],
};
const actions: Input[] = [...boot, ...(scenarios[scenario] ?? [])];
if (process.argv.includes("--no-candy")) for (const action of actions) if (action.touch && action.touch[1] === 180 && [33, 53, 73, 93, 113, 133, 153, 173].includes(action.touch[0])) action.touch[0] -= 20;
const script = option("--input", ""); if (script) actions.splice(0, actions.length, ...JSON.parse(await readFile(script, "utf8")));
const trace: any[] = [], inputTrace: unknown[] = [], frameChecks: unknown[] = []; let found = false;
const partyTrace: unknown[] = [], nativeTrace: unknown[] = [];
let watchParty = Number(option("--watch-party", "0"));
function membersAt(memory: Buffer, party: number) {
  if (party <= 0 || party > memory.length - 1330 || memory[party + 4] !== 6) return [];
  return Array.from({ length: 6 }, (_, i) => {
    const pk = Buffer.from(decryptPk5Party(new Uint8Array(memory.subarray(party + 8 + i * 220, party + 8 + (i + 1) * 220))));
    const status = pk.readUInt32LE(136), condition = status & 7 ? 2 : status & 64 ? 1 : status & 32 ? 3 : status & 16 ? 4 : status & (8 | 128) ? 5 : 0;
    let checksum = 0; for (let at = 8; at < 136; at += 2) checksum = (checksum + pk.readUInt16LE(at)) & 65535;
    return { hp: pk.readUInt16LE(142), max: pk.readUInt16LE(144), level: pk[140], species: pk.readUInt16LE(8), status, condition,
      egg: !!(pk.readUInt32LE(56) & 0x40000000), exp: pk.readUInt32LE(16), pp: [...pk.subarray(48, 52)],
      moves: Array.from({ length: 4 }, (_, n) => pk.readUInt16LE(40 + n * 2)), checksumValid: checksum === pk.readUInt16LE(6),
      companionCounters: [pk[67], pk[94]] };
  });
}
let readyFrame = resume && scenario === "bag-proof" ? 0 : -1;
let pendingParty = -1;
let bagStage = resume && scenario === "bag-proof" ? 1 : 0, bagStepFrame = 0;
let bagLastBusy = -1;
const bagSteps: unknown[] = [];
function activeParty(m: Buffer) {
  let offset = m.length;
  while ((offset = m.lastIndexOf(Buffer.from([0x50, 0x41, 0x50, 0x53]), offset - 1)) >= 0) {
    const work = m.readUInt32LE(offset + 4) - 0x2000000;
    if (work > 0 && work < m.length - 0x284 && m[work + 12] === 2 && m[work + 14] === 1) return work;
  }
  return -1;
}
function nativeParty(m: Buffer) {
  let at = 0;
  while ((at = m.indexOf(Buffer.from([23, 0]), at + 1)) >= 0 && at < m.length - 0x284) {
    if (at % 4 || m[at + 12] !== 2 || m[at + 14] !== 1 || m.readUInt32LE(at + 0x2c) > 5) continue;
    const request = m.readUInt32LE(at + 0x280) - 0x2000000;
    if (request < 0 || request > m.length - 0x98 || m.readUInt32LE(request + 0x34) > 16) continue;
    const party = m.readUInt32LE(request) - 0x2000000;
    const prompt = m.readUInt32LE(at + 0x150) - 0x2000000;
    if (party > 0 && party < m.length - 1330 && m[party + 4] === 6 && prompt > 0 && prompt < m.length - 100) return at;
  }
  return -1;
}
function medicineParty(m: Buffer) {
  let at = 0;
  while ((at = m.indexOf(Buffer.from([23, 0]), at + 1)) >= 0 && at < m.length - 0x284) {
    if (at % 4 || m[at + 12] > 21 || m.readUInt32LE(at + 0x2c) > 5) continue;
    const request = m.readUInt32LE(at + 0x280) - 0x2000000;
    if (request < 0 || request > m.length - 0x98 || m.readUInt32LE(request + 0x34) !== 5) continue;
    const party = m.readUInt32LE(request) - 0x2000000, item = m.readUInt16LE(request + 0x44);
    if (party > 0 && party < m.length - 1330 && m[party + 4] === 6 && [50, 622].includes(item)) return { work: at, request, party, item, state: m[at + 12] };
  }
  return undefined;
}
function whiteControlsShown() {
  const fb = core._getSymbol(4) >>> 0; let white = 0;
  for (let y = 216; y < 350; y += 2) for (let x = 4; x < 252; x += 2) {
    const at = fb + (y * 256 + x) * 4;
    if (core.HEAPU8[at] > 220 && core.HEAPU8[at + 1] > 220 && core.HEAPU8[at + 2] > 220) white++;
  }
  return white > 300;
}
function fieldMenuShown() {
  const fb = core._getSymbol(4) >>> 0, bag = fb + (280 * 256 + 19) * 4, dex = fb + (235 * 256 + 148) * 4;
  return core.HEAPU8[bag] < 80 && core.HEAPU8[bag + 1] > 140 && core.HEAPU8[bag + 2] > 180
    && core.HEAPU8[dex] > 140 && core.HEAPU8[dex + 1] < 80 && core.HEAPU8[dex + 2] < 80;
}
for (let frame = 0; frame < frames; frame++) {
  const logicalFrame = !script && readyFrame >= 0 ? frame - readyFrame + 5100 : frame;
  let input = actions.find(v => logicalFrame >= v.frame && logicalFrame < v.frame + (v.duration ?? 4));
  if (!script) {
    if (frame < 2800) input = boot.slice(0, 6).find(v => frame >= v.frame && frame < v.frame + 12);
    else if (readyFrame < 0) {
      if (pendingParty >= 0) input = undefined;
      else if (frame % 120 < 4) input = fieldMenuShown() ? { frame, touch: [55, bagEntry ? 90 : 45] } : { frame, buttons: whiteControlsShown() ? 128 : 512 };
      else input = undefined;
    }
    else input = scenarios[scenario]?.find(v => logicalFrame >= v.frame && logicalFrame < v.frame + (v.duration ?? 4));
  }
  if (scenario === "bag-proof" && !script && readyFrame >= 0) {
    input = undefined;
    const memory = ram(), medicine = medicineParty(memory), age = frame - readyFrame;
    const advance = (stage: number) => { bagStage = stage; bagStepFrame = frame; bagLastBusy = -1; bagSteps.push({ frame, stage, medicine }); };
    if (medicine) watchParty = medicine.party;
    if (bagStage === 0) {
      input = [300, 480, 660, 840].some(n => age >= n && age < n + 4) ? { frame, touch: [132, 180] }
        : [1120, 1300, 1480].some(n => age >= n && age < n + 4) ? { frame, buttons: 128 } : undefined;
      if (medicine && [2, 4].includes(medicine.state) && medicine.item === 622) { input = { frame, touch: [55, 25] }; advance(1); }
    } else if (bagStage === 1 || bagStage === 3) {
      if (medicine && [7, 8, 13].includes(medicine.state)) { bagLastBusy = frame; if (frame % 120 < 4) input = { frame, buttons: 128 }; }
      if (medicine && [2, 4].includes(medicine.state) && frame > bagStepFrame + 40) {
        const members = membersAt(memory, medicine.party), index = bagStage === 1 ? 0 : 1, wanted = bagStage === 1 ? 16 : 21;
        if (members[index].level >= wanted) { if (bagLastBusy >= 0 && frame > bagLastBusy + 120) advance(bagStage === 1 ? 2 : 4); }
        else if (frame % 120 < 4) input = { frame, buttons: memory.readUInt32LE(medicine.work + 0x2c) === index ? 128 : 1 };
      }
    } else if (bagStage === 2 || bagStage === 4) {
      if (medicine && [2, 4].includes(medicine.state) && frame % 120 < 4) input = { frame, buttons: 64 };
      if (medicine && [19, 20, 21].includes(medicine.state)) advance(bagStage === 2 ? 5 : 6);
    } else if (bagStage === 5) {
      const elapsed = frame - bagStepFrame;
      input = [300, 440].some(n => elapsed >= n && elapsed < n + 4) ? { frame, touch: [132, 180] }
        : [660, 820, 980].some(n => elapsed >= n && elapsed < n + 4) ? { frame, buttons: 128 } : undefined;
      if (medicine && [2, 4].includes(medicine.state) && medicine.item === 50) { input = { frame, touch: [188, 40] }; advance(3); }
    }
  }
  core._runFrame(1, input?.buttons ?? 0, input?.touch ? 1 : 0, input?.touch?.[0] ?? 0, input?.touch?.[1] ?? 0);
  if (bagEntry && !script && readyFrame < 0 && input?.touch) readyFrame = frame;
  if (!bagEntry && !script && pendingParty < 0 && input?.touch) pendingParty = frame;
  if (fatal.length) throw new Error(`Frame ${frame}: ${fatal.join("; ")}`);
  if (!script && readyFrame < 0 && frame > 2800 && frame % 15 === 0) {
    const memory = ram(), work = scenario === "hidden" && pendingParty >= 0 && frame > pendingParty + 30 ? nativeParty(memory) : activeParty(memory);
    if (work >= 0) {
      readyFrame = frame;
      const request = memory.readUInt32LE(work + 0x280) - 0x2000000;
      watchParty = memory.readUInt32LE(request) - 0x2000000;
    }
  }
  if (input?.buttons) {
    const m = ram(), root = m.readUInt32LE(game === "B" ? 0x1469bc : 0x1469dc) - 0x2000000;
    if (root > 0 && root < m.length - 4) {
      const keys = m.readUInt32LE(root) - 0x2000000;
      if (keys > 0 && keys < m.length - 0x44) inputTrace.push({ frame, buttons: input.buttons, held: m.readUInt32LE(keys + 0x18), triggered: m.readUInt32LE(keys + 0x1c), inputMode: m[keys + 0x3d] });
    }
  }
  if (frame % 30 === 0 || actions.some(v => logicalFrame === v.frame + 4 || logicalFrame === v.frame + (v.duration ?? 4) + 4)) {
    const memory = ram(); let offset = memory.length;
    while ((offset = memory.lastIndexOf(Buffer.from([0x50, 0x41, 0x50, 0x53]), offset - 1)) >= 0) {
      const work = memory.readUInt32LE(offset + 4) - 0x2000000;
      if (work < 0 || work > memory.length - 0x284) continue;
      found = true;
      const request = memory.readUInt32LE(work + 0x280) - 0x2000000;
      if (request < 0 || request >= memory.length - 0x98) continue;
      const party = memory.readUInt32LE(request) - 0x2000000;
      const members = membersAt(memory, party);
      if (members.length === 6) watchParty = party;
      const text = memory.readUInt32LE(offset + 336) - 0x2000000;
      trace.push({ frame, logicalFrame, offset, work, request, party, members, fsm: [...memory.subarray(work + 12, work + 16)], slot: memory.readUInt32LE(work + 0x2c),
        mask: memory.readUInt16LE(offset + 468), visible: memory[offset + 125], error: memory[offset + 127], hpMode: memory[offset + 122],
        nav: memory[offset + 331], navItem: memory[offset + 332], confirm: memory[offset + 335], frameHidden: memory[offset + 329],
        message: text > 0 && text < memory.length - 72 ? memory.subarray(text + 8, text + 8 + memory.readUInt16LE(text + 2) * 2).toString("utf16le") : undefined,
        nativeShade: memory.readUInt16LE(work + 0xa8), toolbarShade: memory.readUInt16LE(offset + 390),
        mode: memory.readUInt32LE(request + 0x34), result: memory.readUInt32LE(request + 0x40) });
      break;
    }
  }
  if (watchParty && frame % 30 === 0) partyTrace.push({ frame, logicalFrame, members: membersAt(ram(), watchParty) });
  if (frame % 30 === 0 && readyFrame >= 0) {
    const memory = ram(), work = nativeParty(memory);
    if (work >= 0) {
      const request = memory.readUInt32LE(work + 0x280) - 0x2000000;
      nativeTrace.push({ frame, logicalFrame, work, mode: memory.readUInt32LE(request + 0x34), slot: memory.readUInt32LE(work + 0x2c) });
    }
  }
  if (frame > 2800) {
    const framebuffer = core._getSymbol(4) >>> 0; let white = 0;
    for (let y = 360; y < 384; y++) for (let x = 0; x < 184; x++) {
      const at = framebuffer + (y * 256 + x) * 4;
      if (core.HEAPU8[at] > 220 && core.HEAPU8[at + 1] > 220 && core.HEAPU8[at + 2] > 220) white++;
    }
    frameChecks.push({ frame, white });
  }
  if (frame % 120 === 0 || actions.some(v => logicalFrame === v.frame + 4)) {
    const png = new PNG({ width: 256, height: 384 }), fb = core._getSymbol(4) >>> 0;
    png.data = Buffer.from(core.HEAPU8.subarray(fb, fb + 256 * 384 * 4)); await writeFile(new URL(`frame-${frame}.png`, out), PNG.sync.write(png));
  }
}
await writeFile(new URL("trace.json", out), JSON.stringify(trace, null, 2)); await writeFile(new URL("ram.bin", out), ram());
await writeFile(new URL("input-trace.json", out), JSON.stringify(inputTrace, null, 2));
await writeFile(new URL("frame-checks.json", out), JSON.stringify(frameChecks, null, 2));
await writeFile(new URL("party-trace.json", out), JSON.stringify(partyTrace, null, 2));
await writeFile(new URL("native-trace.json", out), JSON.stringify(nativeTrace, null, 2));
await writeFile(new URL("bag-steps.json", out), JSON.stringify(bagSteps, null, 2));
await writeFile(new URL("test.nds", out), rom); await writeFile(new URL("test.sav", out), fixture);
const stateLength = core._saveState(1);
await writeFile(new URL("latest.dst", out), Buffer.from(core.HEAPU8.subarray(core._stateGetPointer(0), core._stateGetPointer(0) + stateLength)));
if (process.argv.includes("--checkpoint")) await writeFile(new URL("checkpoint.mem.gz", out), gzipSync(core.HEAPU8, { level: 1 }));
const saveLength = core._savGetSize(), saveAt = core._savGetPointer(saveLength);
await writeFile(new URL("saved.sav", out), Buffer.from(core.HEAPU8.subarray(saveAt, saveAt + saveLength)));
await writeFile(new URL("run.json", out), JSON.stringify({ game, scenario, readyFrame, frames, companions: process.argv.includes("--companions"),
  sourceRomSha256: digest(await readFile(input)), romSha256: digest(rom), fixtureSha256: digest(fixture),
  toolbarSha256: toolbar.games[game].sha256, archiveSha256: toolbar.games[game].archiveSha256, candySha256: candy.games[game].sha256,
  resumedFrom: resume || undefined, inputFile: script || undefined, found }, null, 2));
if (!resume && !bagEntry && scenario !== "hidden" && !found) throw new Error("Toolbar did not initialize; inspect screenshots and native RAM.");
console.log(game, scenario, "DS candidate run finished; acceptance assertions still required.");

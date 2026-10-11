import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import manifest from "../../src/assets/codeinjection/battleTypeHudManifest.json";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { getBattleTypeHudStatus, installBattleTypeHud, getMoveEffectivenessStatus, installMoveEffectiveness, type TypeIconVariant, type MoveHighlightColors } from "../../src/pokeweb/battleTypeHudModel";

const [input, output, variant = "letters", colorJson] = process.argv.slice(2);
assert(input && output && resolve(input) !== resolve(output) && ["letters", "circular", "solid", "moves"].includes(variant),
  "Usage: vite-node runtime/battle-type-hud/prepare_bw1_validation.ts INPUT.nds NEW-OUTPUT.nds [letters|circular|solid|moves] [COLORS-JSON]");
const moves = variant === "moves", profiles = moves ? manifest.moveGames : manifest.games;
const status = moves ? getMoveEffectivenessStatus : getBattleTypeHudStatus;
const colors = colorJson ? JSON.parse(colorJson) as MoveHighlightColors : undefined;
const install = (project: Parameters<typeof installBattleTypeHud>[0]) => moves
  ? installMoveEffectiveness(project, colors) : installBattleTypeHud(project, variant as TypeIconVariant);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array(await readFile(input)), sourceHash = hash(bytes);
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const game = rom.idCode === "IRBO" ? "B" : rom.idCode === "IRAO" ? "W" : undefined;
assert(game && rom.data[0x1e] === 0, "Expected US BW1 revision 0.");
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: [] });
assert.equal(status(project).supported, profiles.B.dsAccepted && profiles.W.dsAccepted);
const fetchOriginal = globalThis.fetch, acceptance = { B: profiles.B.dsAccepted, W: profiles.W.dsAccepted };
globalThis.fetch = async (url) => new Response(new Uint8Array(await readFile(new URL(`../../src/assets/codeinjection/${basename(new URL(String(url), "https://pokeweb.invalid").pathname)}`, import.meta.url))));
let exported: Uint8Array;
try {
  // Process-local validation override; the on-disk manifest is preserved.
  profiles.B.dsAccepted = profiles.W.dsAccepted = true;
  const installed = await install(project);
  assert.equal(installed.path, `patches/${moves ? "MoveEffectiveness" : "TypeIcons"}${game}.dll`);
  const settings = moves ? status(project).colors : status(project).iconVariant;
  if (!moves) assert.equal(settings, variant);
  exported = await exportModifiedRom(project);
  const reopened = await loadProjectFromRomBytes(exported, basename(output), { selectedNarcs: [] });
  assert.deepEqual([status(reopened).installed, status(reopened).compatible,
    status(reopened).canUninstall], [true, true, false]);
  assert.deepEqual(moves ? status(reopened).colors : status(reopened).iconVariant, settings);
  const result = new NintendoDSRom(exported, { fileData: "view" }), id = result.fileId(installed.path);
  await install(reopened);
  assert(reopened.fileSystem?.replacements[id], "Reinstall did not replace the original FAT entry.");
} finally {
  profiles.B.dsAccepted = acceptance.B; profiles.W.dsAccepted = acceptance.W;
  globalThis.fetch = fetchOriginal;
}
const result = new NintendoDSRom(exported!, { fileData: "view" });
for (const id of [93, 94]) assert.deepEqual(result.loadArm9Overlays([id]).get(id)!.data, rom.loadArm9Overlays([id]).get(id)!.data);
const source = new NARC(rom.getFileByName("a/0/1/1")), target = new NARC(result.getFileByName("a/0/1/1"));
assert.equal(source.files.length, target.files.length);
const expanded = new Set(moves ? [] : [165, 166, 168, 169, 171, 172, 174, 175]);
for (let i = 0; i < source.files.length; ++i) if (!expanded.has(i)) assert.deepEqual(target.files[i], source.files[i]);
assert.equal(hash(new Uint8Array(await readFile(input))), sourceHash, "Source ROM changed.");
await writeFile(output, exported!, { flag: "wx" });
console.log(`${game}/${variant}: normal installer validation export prepared; export alone does not certify gameplay.`);

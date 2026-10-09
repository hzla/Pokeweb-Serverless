import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import manifest from "../../src/assets/codeinjection/learnsetViewerManifest.json";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { getLearnsetViewerStatus, installLearnsetViewer, learnsetViewerPaths } from "../../src/pokeweb/learnsetViewerModel";
import { commitTextBank, getTextBank } from "../../src/pokeweb/textModel";

const [input, output] = process.argv.slice(2);
if (!input || !output || resolve(input) === resolve(output)) throw new Error("Usage: vite-node runtime/learnset-viewer/prepare_bw1_validation.ts INPUT.nds NEW-OUTPUT.nds");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytes = new Uint8Array(await readFile(input)), sourceHash = hash(bytes);
const rom = new NintendoDSRom(bytes, { fileData: "view" });
const game = rom.idCode === "IRBO" ? "B" : rom.idCode === "IRAO" ? "W" : undefined;
assert(game && rom.data[0x1e] === 0, "Expected US BW1 revision 0.");
const profile = manifest.games[game];
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["message_texts"] });
assert.equal(getLearnsetViewerStatus(project).supported, manifest.games.B.dsAccepted && manifest.games.W.dsAccepted);
const originalFetch = globalThis.fetch, acceptance = { B: manifest.games.B.dsAccepted, W: manifest.games.W.dsAccepted };
let exported: Uint8Array;
try {
  // This override exists only in the validation process; shipped flags are preserved.
  manifest.games.B.dsAccepted = manifest.games.W.dsAccepted = true;
  globalThis.fetch = async input => {
    const name = basename(new URL(String(input), "https://pokeweb.invalid").pathname);
    return new Response(new Uint8Array(await readFile(new URL(`../../src/assets/codeinjection/${name}`, import.meta.url))));
  };
  const oldText = structuredClone(getTextBank(project, "message_texts", profile.viewerBankId));
  const ids = await installLearnsetViewer(project), infoIds = project.codeInjection!.learnsetViewer!.infoMessageIds!.slice();
  assert.deepEqual(await installLearnsetViewer(project), ids);
  assert.deepEqual(project.codeInjection!.learnsetViewer!.infoMessageIds, infoIds);
  assert.deepEqual(getTextBank(project, "message_texts", profile.viewerBankId).slice(0, oldText.length), oldText);
  exported = await exportModifiedRom(project);
  const reopened = await loadProjectFromRomBytes(exported, basename(output), { selectedNarcs: ["message_texts"] });
  assert.deepEqual(getLearnsetViewerStatus(reopened).messageIds, ids);
  assert(getLearnsetViewerStatus(reopened).installed && getLearnsetViewerStatus(reopened).compatible);
  assert(!getLearnsetViewerStatus(reopened).canUninstall && !getLearnsetViewerStatus(reopened).updateAvailable);
  const result = new NintendoDSRom(exported, { fileData: "view" });
  const bank = getTextBank(reopened, "message_texts", profile.viewerBankId);
  bank[ids.error][1] = "Private edited validation text"; commitTextBank(reopened, "message_texts", profile.viewerBankId);
  assert.deepEqual(await installLearnsetViewer(reopened), ids);
  assert.equal(getTextBank(reopened, "message_texts", profile.viewerBankId)[ids.error][1], "Private edited validation text");
  for (const path of learnsetViewerPaths(game)) assert(reopened.fileSystem!.replacements[result.fileId(path)]);
  for (const id of [profile.partyOverlay, profile.dispatchOverlay, profile.tutorOverlay])
    assert.deepEqual(result.loadArm9Overlays([id]).get(id)!.data, rom.loadArm9Overlays([id]).get(id)!.data);
  for (const path of new Set(profile.resources.map(r => r.archive))) assert.deepEqual(new NARC(result.getFileByName(path)).files, new NARC(rom.getFileByName(path)).files);
} finally {
  manifest.games.B.dsAccepted = acceptance.B; manifest.games.W.dsAccepted = acceptance.W;
  globalThis.fetch = originalFetch;
}
assert.equal(hash(new Uint8Array(await readFile(input))), sourceHash, "Source ROM changed.");
await writeFile(output, exported!, { flag: "wx" });
console.log(`${game}: separately named BW1 Learnset validation export prepared; export alone does not certify gameplay.`);

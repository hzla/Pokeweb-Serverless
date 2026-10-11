/** Prepare a separately named W2 ROM using the verified Ruby companions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../../../src/nds/rom";
import { loadProjectFromRomBytes } from "../../../src/pokeweb/loader";
import { exportModifiedRom } from "../../../src/pokeweb/exportRom";
import { stageCodeInjectionDll } from "../../../src/pokeweb/pmcModel";
import { parseRpm } from "../../../src/pokeweb/rpm";
import { configureLearnsetViewerDll, configureLearnsetInfoDll, getLearnsetViewerStatus,
  installLearnsetViewer, learnsetViewerPaths } from "../../../src/pokeweb/learnsetViewerModel";

const [input, output] = process.argv.slice(2);
if (!input || !output || resolve(input) === resolve(output)) {
  throw new Error("Usage: vite-node runtime/ruby-patches/learnset/export_test_rom.ts INPUT.nds NEW-OUTPUT.nds");
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const receipt = JSON.parse(await readFile(new URL("./build/build-report.json", import.meta.url), "utf8"));
const verification = JSON.parse(await readFile(new URL("./build/verification.json", import.meta.url), "utf8"));
assert(verification.passed, "Verify the Ruby candidates before exporting");
assert.deepEqual(verification.inputs, receipt.inputs, "Verification is stale");
assert.deepEqual(verification.outputs, receipt.outputs, "Verified candidates changed");
for (const [path, digest] of Object.entries(receipt.inputs)) {
  assert.equal(hash(new Uint8Array(await readFile(new URL(`../../../${path}`, import.meta.url)))), digest,
    `Rebuild and verify after changing ${path}`);
}
const bytes = new Uint8Array(await readFile(input)), inputHash = hash(bytes);
const rom = new NintendoDSRom(bytes, { fileData: "view" });
assert(rom.idCode === "IRDO" && rom.data[0x1e] === 0, "Expected US White 2 revision 0");
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["message_texts"] });
const savedFetch = globalThis.fetch;
let exported: Uint8Array;
const configured: Uint8Array[] = [];
try {
  // The normal installer supplies PMC and allocates private text using the
  // trusted bundled companions. Replace those two staged files afterwards.
  globalThis.fetch = async input => {
    const name = basename(new URL(String(input), "https://pokeweb.invalid").pathname);
    try {
      return new Response(new Uint8Array(await readFile(new URL(`../../../src/assets/codeinjection/${name}`, import.meta.url))));
    } catch { return new Response(undefined, { status: 404 }); }
  };
  const ids = await installLearnsetViewer(project);
  const infoIds = project.codeInjection!.learnsetViewer!.infoMessageIds!;
  for (const [i, path] of learnsetViewerPaths("W2").entries()) {
    const name = basename(path);
    const candidate = new Uint8Array(await readFile(new URL(`./build/candidates/${name}`, import.meta.url)));
    assert.equal(hash(candidate), receipt.outputs[name].sha256);
    const rpm = parseRpm(candidate, { allowedMagics: ["DLXF"] });
    assert.equal(rpm.metadata.PMCGameID, "W2");
    let dll = configureLearnsetViewerDll(candidate, ids);
    if (i === 1) dll = configureLearnsetInfoDll(dll, infoIds);
    stageCodeInjectionDll(project, name, dll, "patches", bytes);
    stageCodeInjectionDll(project, name, dll, "patches", bytes);
    assert.deepEqual(project.fileSystem!.additions![path], dll);
    configured.push(dll);
  }
  assert(getLearnsetViewerStatus(project).installed && !getLearnsetViewerStatus(project).updateAvailable);
  exported = await exportModifiedRom(project);
} finally { globalThis.fetch = savedFetch; }
const result = new NintendoDSRom(exported!, { fileData: "view" });
for (const [i, path] of learnsetViewerPaths("W2").entries()) {
  assert.deepEqual(result.getFileByName(path), configured[i], "Export must contain the configured Ruby DLL");
}
for (const overlay of [12, 165, 258]) {
  assert.deepEqual(result.loadArm9Overlays([overlay]).get(overlay)!.data,
    rom.loadArm9Overlays([overlay]).get(overlay)!.data, "Native overlay changed before PMC activation");
}
for (const path of ["a/1/2/5", "a/0/1/6", "a/0/1/8", "a/0/1/9"]) {
  assert.deepEqual(result.getFileByName(path), rom.getFileByName(path), `ROM resource changed: ${path}`);
}
const reopened = await loadProjectFromRomBytes(exported!, basename(output), { selectedNarcs: ["message_texts"] });
const status = getLearnsetViewerStatus(reopened);
assert(status.installed && status.compatible && !status.updateAvailable, JSON.stringify(status));
assert.equal(hash(new Uint8Array(await readFile(input))), inputHash, "Source ROM changed");
await writeFile(output, exported!, { flag: "wx" });
await writeFile(new URL("./build/rom-export.json", import.meta.url), JSON.stringify({
  inputSha256: inputHash, output: resolve(output), outputSha256: hash(exported!),
  bytes: exported!.length, modules: configured.map(hash),
  exportReloadPassed: true, liveGameTest: false,
}, null, 2) + "\n");
console.log(`Created ${basename(output)} with the Ruby-generated Learnset pair; export/reload passed.`);

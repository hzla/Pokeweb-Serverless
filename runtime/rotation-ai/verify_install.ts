import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import manifest from "../../src/assets/codeinjection/rotationBattleAiManifest.json";
import { NintendoDSRom } from "../../src/nds/rom";
import { installCodeInjectionPatch } from "../../src/pokeweb/codeInjectionInstall";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { stageCodeInjectionDll } from "../../src/pokeweb/pmcModel";
import {
  getRotationBattleAiStatus, stageRotationBattleAi, uninstallRotationBattleAi,
} from "../../src/pokeweb/rotationBattleAiModel";
import {
  parseRpm, rpmCodeSegmentBase, setRpmBaseAddress, updateRpmCodeImageForBase, writeRelocationDataByType, writeRpm,
} from "../../src/pokeweb/rpm";

const input = process.argv[2];
assert(input, "Usage: vite-node runtime/rotation-ai/verify_install.ts retail.nds");
globalThis.fetch = async input => {
  const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.protocol, "file:");
  return new Response(new Uint8Array(await readFile(url)));
};

const bytes = new Uint8Array(await readFile(input));
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: [] });
const game = project.session.baseVersion;
assert(game === "B" || game === "W" || game === "B2" || game === "W2");
const profile = manifest.games[game];
const source = new NintendoDSRom(bytes, { fileData: "view" });
assert(getRotationBattleAiStatus(project).compatible);

const battleId = profile.hooks[0].overlay;
const aiSig = profile.signatures.find(signature => signature.overlay !== battleId)!;
const aiId = aiSig.overlay;
const overlay = source.loadArm9Overlays([battleId, aiId]);
const aiOverlay = overlay.get(aiId)!;
const altered = aiOverlay.data.slice();
altered[aiSig.address - aiOverlay.ramAddress] ^= 0xff;
const cached = project.overlays[aiId];
project.overlays[aiId] = altered;
await assert.rejects(installCodeInjectionPatch(project, stageRotationBattleAi), /Battle AI code differs/);
assert.equal(project.codeInjection, undefined);
if (cached) project.overlays[aiId] = cached;
else delete project.overlays[aiId];

await installCodeInjectionPatch(project, stageRotationBattleAi);
assert(getRotationBattleAiStatus(project).canUninstall);
project.originalRomBytes = undefined;
assert(getRotationBattleAiStatus(project).canUninstall);
await uninstallRotationBattleAi(project);
project.originalRomBytes = bytes;
assert(!getRotationBattleAiStatus(project).installed);

const bundled = await readFile(new URL(`../../src/assets/codeinjection/${profile.fileName}`, import.meta.url));
const otherModule = parseRpm(bundled, { allowedMagics: ["DLXF"] });
delete otherModule.metadata.PokewebRotationAI;
const conflict = stageCodeInjectionDll(project, "OtherRotationAi.dll", writeRpm(otherModule, { ident: "DLXF" }));
await assert.rejects(installCodeInjectionPatch(project, stageRotationBattleAi), /Conflicting battle AI module/);
delete project.fileSystem!.additions![conflict.path];

await installCodeInjectionPatch(project, stageRotationBattleAi);
await installCodeInjectionPatch(project, stageRotationBattleAi);

const output = await exportModifiedRom(project);
const exported = new NintendoDSRom(output, { fileData: "view" });
const installed = exported.getFileByName(`patches/${profile.fileName}`);
assert(installed && bundled.equals(installed));
const reopened = await loadProjectFromRomBytes(output, basename(input), { selectedNarcs: [] });
const status = getRotationBattleAiStatus(reopened);
assert(status.compatible && status.installed && !status.canUninstall, status.message);

// Relocate the exact exported DLL against the stock overlay for the ARM fixture.
const rpm = parseRpm(installed, { allowedMagics: ["DLXF"] });
setRpmBaseAddress(rpm, 0x02340000);
const image = updateRpmCodeImageForBase(rpm);
const battle = overlay.get(battleId)!;
for (const relocation of rpm.relocations) {
  if (relocation.target.module === "base") continue;
  assert.equal(relocation.target.module, String(battleId));
  writeRelocationDataByType(rpm, relocation, battle.data, relocation.target.address, battle.ramAddress);
}
await writeFile(new URL(`build/${game}-fixture.json`, import.meta.url), JSON.stringify({
  dispatchAddress: profile.hooks.find(hook => hook.type === "OFFSET")!.address,
  runtimeBase: rpmCodeSegmentBase(rpm),
  code: Buffer.from(image).toString("hex"),
  battleBase: battle.ramAddress,
  battle: Buffer.from(battle.data).toString("hex"),
  aiBase: aiOverlay.ramAddress,
  ai: Buffer.from(aiOverlay.data).toString("hex"),
}));
console.log(`${game} compatibility, rollback, stage/remove/reinstall, ROM export and module relocation passed.`);

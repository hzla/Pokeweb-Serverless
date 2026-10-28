import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../../src/nds/rom";
import { NARC } from "../../src/nds/narc";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";
import { getInfiniteCandyStatus, installInfiniteCandy } from "../../src/pokeweb/infiniteCandyModel";
import { getBattleTypeHudStatus, installBattleTypeHud, uninstallBattleTypeHud, type TypeIconVariant } from "../../src/pokeweb/battleTypeHudModel";
import { listCodeInjectionDlls } from "../../src/pokeweb/pmcModel";
import { getTextBank } from "../../src/pokeweb/textModel";
import { decompressNitro } from "../../src/pokeweb/pokemonSpriteModel";
import redux from "../../src/assets/codeinjection/battleTypeHudReduxManifest.json";

const [path, selected = "113", output] = process.argv.slice(2);
if (!path) throw new Error("Usage: vite-node runtime/battle-type-hud/verify_pokeweb_redux.ts INPUT.nds [ITEM_ID] [NEW_OUTPUT.nds]");
const itemId = Number(selected);
globalThis.fetch = async input => {
  const url = input instanceof URL ? input : new URL(String(input));
  if (url.protocol !== "file:") throw new Error("This verifier only loads local bundled assets.");
  return new Response(new Uint8Array(await readFile(url)));
};
const bytes = new Uint8Array(await readFile(path)), original = new NintendoDSRom(bytes);
const project = await loadProjectFromRomBytes(bytes, "redux.nds", { selectedNarcs: ["items", "message_texts"] });
const originals = listCodeInjectionDlls(project).map(m => ({ path: m.path, bytes: original.getFileByName(m.path).slice() }));
const itemNames = new Map(getTextBank(project, "message_texts", 64).map(e => [e[0], e[1]]));
assert.equal(getInfiniteCandyStatus(project, itemId).compatible, true);
assert.equal(getBattleTypeHudStatus(project).graphicsProfile, "redux");
await installInfiniteCandy(project, itemId);
const unpack = (data: Uint8Array) => data[0] === 0x10 || data[0] === 0x11 ? decompressNitro(data) : data;
const nativeBattle = new NARC(original.getFileByName(redux.graphicsArchive));
let exported: Uint8Array | undefined;
for (const variant of ["letters", "circular", "solid"] as TypeIconVariant[]) {
  await installBattleTypeHud(project, variant);
  const status = getBattleTypeHudStatus(project);
  assert.equal(status.graphicsProfile, "redux"); assert.equal(status.iconVariant, variant); assert.equal(status.updateAvailable, false);
  exported = await exportModifiedRom(project);
  const rom = new NintendoDSRom(exported), battle = new NARC(rom.getFileByName(redux.graphicsArchive));
  for (const module of originals) assert.deepEqual(rom.getFileByName(module.path), module.bytes);
  assert.deepEqual(rom.getFileByName("a/0/2/5"), original.getFileByName("a/0/2/5"));
  for (let i = 0; i < nativeBattle.files.length; ++i) {
    if (i === 438) {
      assert.deepEqual(unpack(battle.files[i]!).slice(48, 2096), unpack(nativeBattle.files[i]!).slice(48));
      assert.deepEqual(unpack(battle.files[i]!).slice(2096), new Uint8Array(256));
    } else if (i !== 439) assert.deepEqual(battle.files[i], nativeBattle.files[i]);
  }
  const beforeItems = new NARC(original.getFileByName("a/0/2/4")), afterItems = new NARC(rom.getFileByName("a/0/2/4"));
  for (let i = 0; i < beforeItems.files.length; ++i) if (i !== itemId) assert.deepEqual(afterItems.files[i], beforeItems.files[i]);
  const reimported = await loadProjectFromRomBytes(exported, "reimport.nds", { selectedNarcs: ["items", "message_texts"] });
  assert.deepEqual({ compatible: getInfiniteCandyStatus(reimported).compatible, installed: getInfiniteCandyStatus(reimported).installed, itemId: getInfiniteCandyStatus(reimported).itemId }, { compatible: true, installed: true, itemId });
  assert.equal(getBattleTypeHudStatus(reimported).graphicsProfile, "redux");
  assert.equal(getBattleTypeHudStatus(reimported).iconVariant, variant);
  for (const [id, name] of getTextBank(reimported, "message_texts", 64)) if (id !== `0_${itemId}`) assert.equal(name, itemNames.get(id));
  assert.equal(listCodeInjectionDlls(reimported).length, originals.length + 2);
  await installInfiniteCandy(reimported);
  await installBattleTypeHud(reimported, variant);
  assert.equal(listCodeInjectionDlls(reimported).length, originals.length + 2);
  console.log(`${variant}: install, export, reimport, reinstall and preservation verified`);
}
uninstallBattleTypeHud(project);
const restored = new NARC(new NintendoDSRom(await exportModifiedRom(project)).getFileByName(redux.graphicsArchive));
for (let i = 0; i < nativeBattle.files.length; ++i) assert.deepEqual(unpack(restored.files[i]!), unpack(nativeBattle.files[i]!));
assert.equal(getInfiniteCandyStatus(project).installed, true);
if (output) await writeFile(output, exported!, { flag: "wx" });
console.log(`Item ${itemId}, all existing DLLs, item 622, shared icons and reversible Redux panel edits verified.`);

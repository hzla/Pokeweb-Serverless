import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getInfiniteCandyStatus, installInfiniteCandy } from "../src/pokeweb/infiniteCandyModel";
import { getLevelCapsStatus, installLevelCaps } from "../src/pokeweb/levelCapsModel";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { parseRpm } from "../src/pokeweb/rpm";

const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error("Usage: npm run levelcaps:verify-rom -- cleanblack2.nds cleanwhite2.nds");
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
  if (url.protocol === "file:") return new Response(new Uint8Array(await readFile(url)));
  return originalFetch(input);
}) as typeof fetch;

try {
  for (const path of paths) {
    const source = new Uint8Array(await readFile(path));
    const original = new NintendoDSRom(source);
    if (original.idCode !== "IREO" && original.idCode !== "IRDO") throw new Error(`${path}: expected US BW2`);
    const version = original.idCode === "IREO" ? "B2" : "W2";
    const project = await loadProjectFromRomBytes(source, basename(path), { selectedNarcs: ["items", "message_texts"] });
    const before = getLevelCapsStatus(project);
    if (!before.compatible || before.installed) throw new Error(`${version}: ${before.message}`);
    const upgradePath = `patches/${version === "B2" ? "Black2Upgrade" : "White2Upgrade"}.dll`;
    const modules = (project.codeInjection ??= {}).modules ??= [];
    modules.push({ path: upgradePath, target: "patches", fileName: upgradePath.split("/").pop()! });
    if (getLevelCapsStatus(project).supported) throw new Error(`${version}: upgrade ROM reservation was not rejected`);
    modules.pop();

    const installed = await installLevelCaps(project);
    if (installed.path !== `patches/HardLevelCaps${version}.dll`) throw new Error(`${version}: wrong DLL path`);
    if (!getLevelCapsStatus(project).installed) throw new Error(`${version}: install not detected`);
    if (!getInfiniteCandyStatus(project).compatible) throw new Error(`${version}: Infinite Candy incorrectly conflicts with level caps`);
    await installInfiniteCandy(project);
    if (!getLevelCapsStatus(project).compatible || !getInfiniteCandyStatus(project).compatible) {
      throw new Error(`${version}: combined installation is incompatible`);
    }

    const exported = new NintendoDSRom(await exportModifiedRom(project));
    for (const id of [36, 165, 167]) {
      const prior = original.loadArm9Overlays([id]).get(id)!.data;
      const after = exported.loadArm9Overlays([id]).get(id)!.data;
      if (!same(prior, after)) throw new Error(`${version}: native overlay ${id} changed instead of using PMC`);
    }
    const rpm = parseRpm(exported.getFileByName(installed.path), { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PMCGameID !== version || rpm.relocations.filter(({ target }) => target.module !== "base").length !== 5) {
      throw new Error(`${version}: invalid Hard Level Caps runtime`);
    }
    const reimported = await loadProjectFromRomBytes(exported.data, `HardLevelCaps${version}.nds`, { selectedNarcs: ["items", "message_texts"] });
    if (!getLevelCapsStatus(reimported).installed || !getLevelCapsStatus(reimported).compatible
      || !getInfiniteCandyStatus(reimported).installed || !getInfiniteCandyStatus(reimported).compatible) {
      throw new Error(`${version}: combined ROM reimport failed`);
    }
    console.log(`${version}: Hard Level Caps and Infinite Candy install, export, and reimport passed`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

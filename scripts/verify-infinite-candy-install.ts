import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getInfiniteCandyStatus, installInfiniteCandy, INFINITE_CANDY_DESCRIPTION, INFINITE_CANDY_ITEM_ID } from "../src/pokeweb/infiniteCandyModel";
import { getTextBank, parseTextEntryId } from "../src/pokeweb/textModel";
import { parseRpm } from "../src/pokeweb/rpm";

const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error("Usage: npm run infinitecandy:verify-rom -- cleanblack2.nds cleanwhite2.nds");
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
    const beforeItem50 = project.narcs.items!.rawFiles[50]!.slice();
    const beforeItem622 = project.narcs.items!.rawFiles[INFINITE_CANDY_ITEM_ID]!.slice();
    const status = getInfiniteCandyStatus(project);
    if (!status.compatible || status.installed) throw new Error(`${version}: ${status.message}`);
    const reservedPath = `patches/${version === "W2" ? "White2Upgrade" : "Black2Upgrade"}.dll`;
    const modules = (project.codeInjection ??= {}).modules ??= [];
    modules.push({ path: reservedPath, target: "patches", fileName: reservedPath.split("/").pop()! });
    if (getInfiniteCandyStatus(project).supported) throw new Error(`${version}: upgrade reservation was not rejected`);
    modules.pop();
    const result = await installInfiniteCandy(project);
    if (result.path !== `patches/InfiniteCandy${version}.dll`) throw new Error(`${version}: wrong DLL path`);
    if (!getInfiniteCandyStatus(project).installed) throw new Error(`${version}: installation was not detected`);
    const stagedItem622 = project.narcs.items!.rawFiles[INFINITE_CANDY_ITEM_ID]!;
    if (stagedItem622[8] !== 0x3f || stagedItem622[9] !== 0x02 || stagedItem622[10] !== 1
      || stagedItem622[12] !== 1 || stagedItem622[17] !== 5 || stagedItem622[22] !== 0x1c) {
      throw new Error(`${version}: item 622 is not the adapted key-item Rare Candy effect`);
    }
    if (!same(project.narcs.items!.rawFiles[50]!, beforeItem50)) throw new Error(`${version}: Rare Candy item 50 changed`);
    if (same(stagedItem622, beforeItem622)) throw new Error(`${version}: item 622 was not changed`);
    const named = (bankId: number) => getTextBank(project, "message_texts", bankId)
      .find((entry) => parseTextEntryId(entry[0]).entry === INFINITE_CANDY_ITEM_ID)?.[1];
    if (named(64) !== "Infinite Candy" || named(63) !== INFINITE_CANDY_DESCRIPTION) throw new Error(`${version}: item text missing`);

    const exported = new NintendoDSRom(await exportModifiedRom(project));
    const icons = new NARC(exported.getFileByName("a/0/2/5"));
    if (!same(icons.files[827]!, icons.files[90]!) || !same(icons.files[828]!, icons.files[91]!)) {
      throw new Error(`${version}: item 622 did not receive Rare Candy's icon and palette`);
    }
    if (!same(exported.loadArm9Overlays([12]).get(12)!.data, original.loadArm9Overlays([12]).get(12)!.data)
      || !same(exported.loadArm9Overlays([165]).get(165)!.data, original.loadArm9Overlays([165]).get(165)!.data)) {
      throw new Error(`${version}: native overlays changed instead of using PMC hooks`);
    }
    const dll = exported.getFileByName(result.path);
    const rpm = parseRpm(dll, { allowedMagics: ["DLXF"] });
    if (rpm.metadata.PMCGameID !== version || rpm.relocations.length !== 3) throw new Error(`${version}: invalid exported DLL`);
    const reimported = await loadProjectFromRomBytes(exported.data, `InfiniteCandy${version}.nds`, { selectedNarcs: ["items", "message_texts"] });
    const imported = getInfiniteCandyStatus(reimported);
    if (!imported.installed || !imported.compatible) throw new Error(`${version}: reimport failed: ${imported.message}`);
    if (getTextBank(reimported, "message_texts", 64)
      .find((entry) => parseTextEntryId(entry[0]).entry === INFINITE_CANDY_ITEM_ID)?.[1] !== "Infinite Candy") {
      throw new Error(`${version}: item name was not retained in the exported ROM`);
    }
    if (getTextBank(reimported, "message_texts", 63)
      .find((entry) => parseTextEntryId(entry[0]).entry === INFINITE_CANDY_ITEM_ID)?.[1] !== INFINITE_CANDY_DESCRIPTION) {
      throw new Error(`${version}: item description line break was not retained in the exported ROM`);
    }
    console.log(`${version}: PMC, item 622, text, export and reimport verified`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

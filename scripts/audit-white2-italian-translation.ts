import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { readU16, readU32 } from "../src/nds/binary";
import type { Folder } from "../src/nds/fnt";
import { decodeGen5TextBank } from "../src/pokeweb/text";
import { decompressNitro } from "../src/pokeweb/pokemonSpriteModel";
import { transformBattleTypeHudPanel, battleTypeHudPanelExpansion } from "../src/pokeweb/battleTypeHudResources";
import summary from "../src/assets/codeinjection/summaryStatViewerManifest.json";
import hud from "../src/assets/codeinjection/battleTypeHudManifest.json";

const [sourcePath, donorPath, profilePath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error("Usage: audit-white2-italian-translation.ts US.nds IT.nds PROFILE.json REPORT.json");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const roms = await Promise.all([sourcePath, donorPath].map(async path => new NintendoDSRom(new Uint8Array(await readFile(path)), { fileData: "view" })));
const [source, donor] = roms;
assert.equal(sha(source.data), "3e50aec3db401332175a5d2b5fe2a68ac1a05ec63995dba9d1506b1b51837446");
assert.equal(sha(donor.data), "04c7ae9f697b09f0558c9a508fc8960531c6429e5341bd699955f5ff925d600a");
const alphabetBanks = Array.from({ length: 26 }, (_, i) => 113 + i);
const excluded = new Map([
  ["a/0/5/6", "Retain US event scripts, including member 298; code and script localization is outside the asset import."],
  ["a/1/6/3", "Retain US OT language metadata. This feature changes display language, not Pokémon origin language."],
]);
const archives: { path: string; members: number; changedMembers: number[]; kind: string }[] = [];
const inventory: unknown[] = [];
const shapes: unknown[] = [];
let textBanks = 0, textEntries = 0, variableDifferences = 0;
const kinds = [new Set<number>(), new Set<number>()];
const unpack = (raw: Uint8Array) => raw[0] === 0x10 || raw[0] === 0x11 ? decompressNitro(raw) : raw;
const namedFiles = new Map<number, string>();
function listNames(folder: Folder, prefix = ""): void {
  folder.files.forEach((name, index) => namedFiles.set(folder.firstId + index, prefix + name));
  folder.folders.forEach(([name, child]) => listNames(child, `${prefix}${name}/`));
}
listNames(source.filenames);
for (let id = 0; id < source.files.length; id++) {
  const path = namedFiles.get(id);
  if (!path) continue;
  if (path.endsWith(".srl")) {
    const regionalPath = path.replace(/_eng\.srl$/u, "_ita.srl");
    const regionalId = donor.filenames.idOf(regionalPath);
    assert.notEqual(regionalId, undefined, regionalPath);
    inventory.push({ path, donorPath: regionalPath, kind: "download-play-program", disposition: "Retain the US executable and original file path", sourceSha256: sha(source.files[id]), donorSha256: sha(donor.files[regionalId!]) });
    continue;
  }
  const targetId = donor.filenames.idOf(path);
  assert.notEqual(targetId, undefined, path);
  const a = source.files[id], b = donor.files[targetId!];
  if (sha(a) === sha(b)) continue;
  assert.equal(String.fromCharCode(...a.subarray(0, 4)), "NARC", path);
  const us = new NARC(a), it = new NARC(b);
  assert.equal(us.files.length, it.files.length, path);
  const changedMembers = us.files.flatMap((raw, member) => sha(raw) === sha(it.files[member]) ? [] : [member]);
  let kind = path === "a/0/0/2" || path === "a/0/0/3" ? "text"
    : path === "a/0/2/4" ? "item-sort-order"
      : path === "a/0/2/3" ? "font"
        : ["a/1/1/2", "a/1/1/3", "a/1/1/4", "a/1/1/5"].includes(path) ? "musical-text" : "graphics-and-layout";
  const members = changedMembers.map(member => {
    const x = us.files[member], y = it.files[member];
    if (kind === "item-sort-order") {
      assert.equal(x.length, y.length);
      for (let byte = 0; byte < x.length; byte++) if (byte !== 15) assert.equal(x[byte], y[byte], `Item ${member} byte ${byte}`);
    }
    const text = kind === "text" || kind === "musical-text";
    if (text) {
      const entries = [decodeGen5TextBank(x), decodeGen5TextBank(y)];
      textBanks++; textEntries += entries[1].length;
      if (readU16(x, 0) !== readU16(y, 0) || readU16(x, 2) !== readU16(y, 2)) {
        shapes.push({ path, member, sourceBlocks: readU16(x, 0), donorBlocks: readU16(y, 0), sourceEntries: readU16(x, 2), donorEntries: readU16(y, 2) });
        assert(path === "a/0/0/2" && alphabetBanks.includes(member) || path === "a/0/0/3" && member === 436);
      }
      entries.forEach((bank, index) => bank.forEach(([, value]) => {
        for (const match of value.matchAll(/VAR\((\d+)(?:, [^)]*)?\)/gu)) kinds[index].add(Number(match[1]));
      }));
      if (entries[0].length === entries[1].length) entries[0].forEach((entry, index) => {
        const vars = (s: string) => (s.match(/VAR\([^)]*\)/gu) ?? []).sort().join("|");
        if (vars(entry[1]) !== vars(entries[1][index][1])) variableDifferences++;
      });
    }
    // All compressed visual resources must decode successfully. Nitro resource
    // headers own their relative offsets; none are ARM overlays or code files.
    const decoded = text || excluded.has(path) || kind === "item-sort-order" || path === "a/1/7/0" || path === "a/1/2/0"
      ? y : unpack(y);
    return { member, sourceBytes: x.length, donorBytes: y.length, decodedBytes: decoded.length,
      magic: Array.from(decoded.subarray(0, 4)).map(n => n.toString(16).padStart(2, "0")).join(""),
      sourceSha256: sha(x), donorSha256: sha(y) };
  });
  inventory.push({ path, kind, disposition: excluded.get(path) ?? "Import donor members at the same IDs", members });
  if (!excluded.has(path)) archives.push({ path, members: us.files.length, changedMembers, kind });
}
const extraKinds = [...kinds[1]].filter(kind => !kinds[0].has(kind));
assert.equal(extraKinds.length, 0, "Italian text introduces unsupported control kinds");
const patchAssets: Record<string, Record<string, { nativeSha256: string; expandedSha256?: string }>> = {};
for (const [path, members] of [
  [summary.games.W2.graphicsArchive, summary.games.W2.resources.map(r => r.member)],
  [hud.games.W2.graphicsArchive, Object.keys(hud.games.W2.resources).map(Number)],
] as [string, number[]][]) {
  const us = new NARC(source.getFileByName(path)), it = new NARC(donor.getFileByName(path));
  for (const member of members) {
    const x = unpack(us.files[member]), y = unpack(it.files[member]);
    if (sha(x) === sha(y)) continue;
    assert.equal(x.length, y.length, `${path}/${member} resource dimensions`);
    assert.deepEqual(x.subarray(0, 16), y.subarray(0, 16), `${path}/${member} resource header`);
    const resource: { nativeSha256: string; expandedSha256?: string } = { nativeSha256: sha(y) };
    if (path === "a/0/1/1" && String(member) in battleTypeHudPanelExpansion) {
      const key = String(member) as keyof typeof battleTypeHudPanelExpansion;
      const expanded = transformBattleTypeHudPanel(y, key);
      assert.deepEqual(transformBattleTypeHudPanel(expanded, key, true), y);
      resource.expandedSha256 = sha(expanded);
    }
    (patchAssets[path] ??= {})[member] = resource;
  }
}
const profile = { schemaVersion: 1, id: "white2-us-italian", version: "0.1.0-alpha", sourceCode: "IRDO", donorCode: "IRDI", revision: 0,
  sourceSha256: sha(source.data), donorSha256: sha(donor.data), alphabetBanks, storyBankLimits: { "436": 592 }, archives, patchAssets };
await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n");
await writeFile(reportPath, JSON.stringify({ profile: profile.id, version: profile.version, sourceSha256: profile.sourceSha256, donorSha256: profile.donorSha256,
  inventory, textShapes: shapes, decodedChangedTextBanks: textBanks, decodedDonorEntries: textEntries, variableDifferences, unsupportedItalianControlKinds: extraKinds,
  policies: ["US executable sections, overlay tables, file IDs, banner and origin metadata are retained.",
    "System banks 113–138 retain US alphabetical search keys because the US lookup tables are retained.",
    "Story bank 436 is limited to the 592 US IDs; the eight extra Italian-only hints are not imported.",
    "Item byte 15 is name_order_id; all other item fields are byte-identical.",
    "Four Musical archives contain additional text banks, decoded and included.",
    "Patch resource alternatives are pinned to exact Italian hashes; the existing US panel transforms were checked forward and backward.",
    "Variable differences include regional date order, grammar, and repeated or omitted placeholders. Complete call-site binding and in-game layout acceptance remain emulator checks."],
  validation: { emulator: "pending", hardware: "not performed" } }, null, 2) + "\n");
console.log(JSON.stringify({ importedArchives: archives.length, excludedArchives: excluded.size, textBanks, textEntries, variableDifferences, patchAssets, shapes }));

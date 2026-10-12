import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { readU16 } from "../src/nds/binary";
import { decodeGen5TextBank } from "../src/pokeweb/text";
import { gen5ScriptCommandOffsets } from "../src/pokeweb/gen5ScriptCommands";
import { loadTranslationProfile, TRANSLATION_GAMES, TRANSLATION_LOCALES, translationSourceGame } from "../src/pokeweb/translationProfile";
import { loadTranslationScriptContracts, translationScriptContexts } from "../src/pokeweb/translationScripts";
import { planTranslationTransfers, translationSha256 } from "../src/pokeweb/translationTransfer";

const [sourcePath, donorFolder, italianPath, reportPath] = process.argv.slice(2);
if (!reportPath) throw new Error("Usage: audit-bw2-translation-locations.ts CLEAN_US.nds DONOR_FOLDER ITALIAN.nds REPORT.json");
const source = new NintendoDSRom(new Uint8Array(await readFile(sourcePath)), { fileData: "view" });
const game = translationSourceGame(source.idCode); assert(game);
assert.equal(await translationSha256(source.data), TRANSLATION_GAMES[game].sourceSha256);
const contracts = await loadTranslationScriptContracts(source.idCode);
const scripts = new NARC(source.getFileByName("a/0/5/6")), headers = new NARC(source.getFileByName("a/0/1/2")).files[0];
const names = new Map(decodeGen5TextBank(new NARC(source.getFileByName("a/0/0/2")).files[109]).filter(([id]) => id.startsWith("0_")).map(([id, text]) => [Number(id.slice(2)), text]));
const locations = Array.from({ length: headers.length / 48 }, (_, map) => {
  const at = map * 48, placeNameId = headers[at + 26] | (headers[at + 27] & 3) << 8;
  return { map, headerRow: map + 1, script: readU16(headers, at + 6), levelScript: readU16(headers, at + 8), bank: readU16(headers, at + 10), placeNameId, location: names.get(placeNameId) ?? `Location ${placeNameId}` };
});
// Known literal global calls only; native and dynamic entry calls remain outside this map.
const calls = new Map<number, Set<number>>();
for (let member = 0; member < scripts.files.length; member++) {
  const targets = new Set<number>();
  for (const context of translationScriptContexts(member, headers, headers, contracts)) {
    for (const at of gen5ScriptCommandOffsets(scripts.files[member], "BW2", { overlayId: context.overlay })) {
      if (![0x1b, 0x1c, 0x21].includes(readU16(scripts.files[member], at))) continue;
      const id = readU16(scripts.files[member], at + 2), range = contracts.globalRanges.find(range => id >= range.start && id <= range.end);
      if (range) targets.add(range.member);
    }
  }
  calls.set(member, targets);
}
const regions = [];
for (const locale of TRANSLATION_LOCALES) {
  const profile = await loadTranslationProfile(locale.id, game);
  const donor = new NintendoDSRom(new Uint8Array(await readFile(locale.id === "italian" ? italianPath : join(donorFolder, `${locale.region}.nds`))), { fileData: "view" });
  assert.equal(await translationSha256(donor.data), profile.donorSha256);
  const plan = await planTranslationTransfers(source, donor, profile);
  const rows = plan.scriptAudits.filter(audit => audit.status !== "unchanged").map(audit => {
    const directLocations = locations.filter(location => location.script === audit.member);
    const callers = new Set<number>([audit.member]);
    let changed = true;
    while (changed) { changed = false; for (const [member, targets] of calls) if (!callers.has(member) && [...targets].some(target => callers.has(target))) { callers.add(member); changed = true; } }
    return { member: audit.member, status: audit.status, directLocations,
      knownCallerLocations: directLocations.length ? [] : locations.filter(location => callers.has(location.script)),
      sharedRanges: contracts.globalRanges.filter(range => range.member === audit.member),
      blocked: audit.diagnostics.filter(diagnostic => diagnostic.severity === "blocked"),
      audit };
  });
  regions.push({ locale: locale.id, language: locale.language, rows });
  console.log(JSON.stringify({ game, language: locale.language, scripts: rows.map(row => ({ member: row.member, status: row.status, locations: row.directLocations.map(location => `${location.location} (map ${location.map}, header row ${location.headerRow})`), sharedBanks: row.sharedRanges.map(range => range.bank), knownCallerLocationNames: [...new Set(row.knownCallerLocations.map(location => location.location))] })) }));
}
await writeFile(reportPath, JSON.stringify({ game, sourceCode: source.idCode, regions, limits: [
  "Map IDs are zero-based native IDs. Pokeweb header row IDs are map ID + 1. Names are decoded from US message bank 109.",
  "Known caller locations follow decoded literal global calls in stock US scripts, including transitive shared calls. They are not an exhaustive runtime call graph; native/dynamic calls and undecoded paths can reach other locations.",
  "The transfer audit is static. These locations identify test targets, not confirmed gameplay failures.",
] }, null, 2) + "\n");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readU16, readU32 } from "../src/nds/binary";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeGen5TextBank } from "../src/pokeweb/text";
import { MAIN_MENU_LABEL_ADAPTATIONS, TRANSLATION_GAMES, TRANSLATION_LOCALES, TRANSLATION_VERSION, translationFileNames, type TranslationProfile, type TranslationFileBaseline, type TranslationGameId } from "../src/pokeweb/translationProfile";
import { decompressNitro } from "../src/pokeweb/pokemonSpriteModel";
import { transformBattleTypeHudPanel, battleTypeHudPanelExpansion } from "../src/pokeweb/battleTypeHudResources";
import summary from "../src/assets/codeinjection/summaryStatViewerManifest.json";
import hud from "../src/assets/codeinjection/battleTypeHudManifest.json";
import learnset from "../src/assets/codeinjection/learnsetViewerManifest.json";

const hashes: Record<string, string> = {
  italian: "04c7ae9f697b09f0558c9a508fc8960531c6429e5341bd699955f5ff925d600a",
  french: "a21dc750a0a0794d70f4298083a8359182f130bf3e20b805f21ff487f97a3498",
  german: "30ee695e4ea30b4eea63115e15ff9efbf4b1857809bb61cef2824d5126cfd15e",
  spanish: "1b0243fdb58acff6f043ab7b62535e97151a0baa92d5d2b4735653378ed7c360",
  korean: "c9e05e82ec314021eb584d75a537dadaf273a153269940dcfb9d44acc337ae30",
};
const black2Hashes: Record<string, string> = {
  italian: "5bbdab894552cffc71a9699a0875cd51f0dc3f6fec936d6ea2f0bcb6805b3e87",
  french: "693c009dc031e74d01e00385f7156386c457640ebf800e1a04629e1e07aa7d37",
  german: "afe5d5a679cdc8f98fa459647d4fb703b734ea8084b77f138db9cb276f8b80b9",
  spanish: "87ffdb8ee2aee97079e9852eab4ee7f50e389c05dbba337235c40eb7080a98bc",
  korean: "d4c8f16b229ed104a19c03a2627240ea0d4565438c8f30fb77f65a77b8a2021a",
};
const [sourcePath, donorFolder, italianPath, outputFolder, reportPath, gameArg = "white2"] = process.argv.slice(2);
if (!reportPath) throw new Error("Usage: audit-white2-translations.ts US.nds DONOR_FOLDER ITALIAN.nds PROFILE_FOLDER REPORT.json");
assert(gameArg === "white2" || gameArg === "black2");
const game = gameArg as TranslationGameId, title = TRANSLATION_GAMES[game], donorHashes = game === "black2" ? black2Hashes : hashes;
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const source = new NintendoDSRom(new Uint8Array(await readFile(sourcePath)), { fileData: "view" });
assert.equal(sha(source.data), title.sourceSha256); assert.equal(source.idCode, title.sourceCode);
const sourceNames = translationFileNames(source.filenames);
const variants: Record<string, Record<string, { nativeSha256: string; expandedSha256?: string }[]>> = {};
const reports: unknown[] = [];
const unpack = (data: Uint8Array) => data[0] === 0x10 || data[0] === 0x11 ? decompressNitro(data) : data;
for (const locale of TRANSLATION_LOCALES) {
  const donor = new NintendoDSRom(new Uint8Array(await readFile(locale.id === "italian" ? italianPath : join(donorFolder, `${locale.region}.nds`))), { fileData: "view" });
  assert.equal(donor.idCode, game === "black2" ? locale.black2GameCode : locale.gameCode); assert.equal(sha(donor.data), donorHashes[locale.id]);
  assert.equal(donor.data[30], 0);
  const donorNames = translationFileNames(donor.filenames);
  const alphabetBanks = Array.from({ length: locale.id === "korean" ? 27 : 26 }, (_, i) => 113 + i);
  const files: TranslationFileBaseline[] = [], native: Record<string, string> = {}, overlays: Record<string, string> = {};
  const textShapes: unknown[] = [], archiveShapes: unknown[] = [], changedArchives: string[] = [], retainedMenuTilemaps: unknown[] = [];
  let changedMembers = 0, decodedTextBanks = 0, variableDifferences = 0;
  for (const key of ["arm9", "arm7", "arm9OverlayTable", "arm7OverlayTable", "banner", "fntData"] as const) native[key] = sha(donor[key]);
  for (const [name, at, size] of [["arm9i", 0x1c0, 0x1cc], ["arm7i", 0x1d0, 0x1dc]] as const) native[name] = sha(donor.data.subarray(readU32(donor.data, at), readU32(donor.data, at) + readU32(donor.data, size)));
  for (const [cpu, table] of [["arm9", donor.arm9OverlayTable], ["arm7", donor.arm7OverlayTable]] as const) {
    for (let at = 0; at < table.length; at += 32) overlays[`${cpu}/${readU32(table, at)}`] = sha(donor.files[readU32(table, at + 24)]);
  }
  for (const [path, id] of sourceNames) {
    const donorPath = donorNames.has(path) ? path : [...donorNames.keys()].find(candidate => candidate.startsWith(path.replace(/eng\.srl$/u, "")) && candidate.endsWith(".srl"));
    assert(donorPath, path);
    const a = source.files[id], b = donor.files[donorNames.get(donorPath)!];
    const file: TranslationFileBaseline = { path, donorPath, sha256: sha(b) };
    if (String.fromCharCode(...a.subarray(0, 4)) === "NARC") {
      const x = new NARC(a), y = new NARC(b);
      file.members = y.files.length; file.sourceMembers = x.files.length;
      if (x.files.length !== y.files.length) {
        assert(locale.id === "korean" && path === "a/3/0/7" && x.files.length === 1 && y.files.length === 18);
        archiveShapes.push({ path, source: x.files.length, donor: y.files.length });
      }
      const changes = y.files.flatMap((member, index) => !x.files[index] || sha(member) !== sha(x.files[index]) ? [index] : []);
      if (changes.length) {
        changedArchives.push(path); changedMembers += changes.length;
        file.regionalMembers = Object.fromEntries(changes.map(index => [index, sha(y.files[index])]));
      }
      if (path === "a/0/5/6") file.retainedMembers = changes;
      const menuLabel = path === "a/0/0/2" ? MAIN_MENU_LABEL_ADAPTATIONS[locale.id] : undefined;
      if (menuLabel) assert.equal(decodeGen5TextBank(y.files[371]).find(entry => entry[0] === "0_3")?.[1], menuLabel.before);
      if (path === "a/0/3/4") {
        for (const member of [6, 7]) {
          const usMap = unpack(x.files[member]), donorMap = unpack(y.files[member]);
          const usSize = [readU16(usMap, 24), readU16(usMap, 26)], donorSize = [readU16(donorMap, 24), readU16(donorMap, 26)];
          if (JSON.stringify(usSize) !== JSON.stringify(donorSize)) {
            // These are button frames, sharing the US tile graphics; labels are separate text banks.
            assert.deepEqual(x.files[1], y.files[1]); assert.deepEqual(x.files[3], y.files[3]);
            retainedMenuTilemaps.push({ path, member, usSize, donorSize, reason: "US menu code uses a fixed row stride; retain the US button frame." });
          }
        }
      }
      if (path === "a/0/0/2" || path === "a/0/0/3" || ["a/1/1/2", "a/1/1/3", "a/1/1/4", "a/1/1/5"].includes(path)) {
        const banks = path.startsWith("a/1/") ? [1] : y.files.map((_, index) => index);
        for (const bank of banks) {
          const us = decodeGen5TextBank(x.files[bank]), regional = decodeGen5TextBank(y.files[bank]); decodedTextBanks++;
          if (readU16(x.files[bank], 0) !== readU16(y.files[bank], 0) || readU16(x.files[bank], 2) !== readU16(y.files[bank], 2)) {
            textShapes.push({ path, bank, sourceEntries: readU16(x.files[bank], 2), donorEntries: readU16(y.files[bank], 2) });
            assert(path === "a/0/0/2" && alphabetBanks.includes(bank) || path === "a/0/0/3" && bank === 436);
          }
          if (us.length === regional.length) us.forEach((entry, index) => {
            const vars = (value: string) => (value.match(/VAR\([^)]*\)/gu) ?? []).sort().join("|");
            if (vars(entry[1]) !== vars(regional[index][1])) variableDifferences++;
          });
        }
      }
    }
    files.push(file);
  }
  const patchChecks: unknown[] = [];
  for (const [path, members] of [
    [summary.games[title.version].graphicsArchive, summary.games[title.version].resources.map(resource => resource.member)],
    [hud.games[title.version].graphicsArchive, Object.keys(hud.games[title.version].resources).map(Number)],
    [learnset.games[title.version].graphicsArchive ?? "a/1/2/5", learnset.games[title.version].resources.map(resource => resource.member)],
  ] as [string, number[]][]) {
    const a = new NARC(source.getFileByName(path)), b = new NARC(donor.getFileByName(path));
    for (const member of members) {
      const x = unpack(a.files[member]), y = unpack(b.files[member]);
      if (sha(x) === sha(y)) continue;
      assert.equal(x.length, y.length, `${locale.id} ${path}/${member}`);
      assert.deepEqual(x.subarray(0, 16), y.subarray(0, 16), `${locale.id} ${path}/${member}`);
      const variant: { nativeSha256: string; expandedSha256?: string } = { nativeSha256: sha(y) };
      if (path === hud.games[title.version].graphicsArchive && String(member) in battleTypeHudPanelExpansion) {
        const key = String(member) as keyof typeof battleTypeHudPanelExpansion;
        const expanded = transformBattleTypeHudPanel(y, key);
        assert.deepEqual(transformBattleTypeHudPanel(expanded, key, true), y);
        variant.expandedSha256 = sha(expanded);
      }
      const list = (variants[path] ??= {})[member] ??= [];
      if (!list.some(item => item.nativeSha256 === variant.nativeSha256)) list.push(variant);
      patchChecks.push({ path, member, ...variant });
    }
  }
  const profile: TranslationProfile = { schemaVersion: 2, id: `${game}-us-${locale.id}`, locale: locale.id, language: locale.language, version: TRANSLATION_VERSION,
    sourceCode: title.sourceCode, donorCode: donor.idCode, revision: 0, sourceSha256: sha(source.data), donorSha256: donorHashes[locale.id], alphabetBanks, storyBankLimits: { "436": readU16(new NARC(source.getFileByName("a/0/0/3")).files[436], 2) }, files, native, overlays };
  await writeFile(join(outputFolder, `${game}-${locale.id}.json`), JSON.stringify(profile) + "\n");
  reports.push({ locale: locale.id, donorCode: donor.idCode, donorSha256: donorHashes[locale.id], changedArchives, changedMembers, textShapes, archiveShapes, decodedTextBanks, variableDifferences, retainedMenuTilemaps, mainMenuLabelAdaptation: MAIN_MENU_LABEL_ADAPTATIONS[locale.id], patchChecks });
  console.log(locale.id, changedArchives.length, "regional archives;", decodedTextBanks, "text banks decoded");
}
await writeFile(join(outputFolder, `${game}AssetVariants.json`), JSON.stringify(variants, null, 2) + "\n");
await writeFile(reportPath, JSON.stringify({ version: TRANSLATION_VERSION, locales: reports, validation: { emulator: "not performed by this audit script", hardware: "not performed" } }, null, 2) + "\n");

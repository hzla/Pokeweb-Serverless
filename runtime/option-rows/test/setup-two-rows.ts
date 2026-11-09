// Two-row layout check without Following Pokemon: Autorun plus a stand-in row that uses
// Following's text IDs and bit 11 with the always-visible gate.
import type { ProjectState } from "../../../src/pokeweb/projectStore";
import { installAutorun } from "../../../src/pokeweb/autorunModel";
import { configureOptionRowsDll, optionRowsDllPath, optionRowsVersion, OPTIONS_TEXT_PATH } from "../../../src/pokeweb/optionRowsModel";
import { stageCodeInjectionDll } from "../../../src/pokeweb/pmcModel";
import { parseRpm, writeRpm } from "../../../src/pokeweb/rpm";
import { NARC } from "../../../src/nds/narc";
import { NintendoDSRom } from "../../../src/nds/rom";
import { getRomFileBytes } from "../../../src/pokeweb/fileSystemModel";
import { decodeGen5TextBank, encodeGen5TextBank } from "../../../src/pokeweb/text";
import { readFile } from "node:fs/promises";
export default async function setup(project: ProjectState): Promise<void> {
  await installAutorun(project);
  const version = optionRowsVersion(project)!;
  const bytes = new Uint8Array(await readFile(new URL(`../../../src/assets/codeinjection/PokewebOptionRows${version}.dll`, import.meta.url)));
  const rpm = parseRpm(configureOptionRowsDll(bytes, ["following", "autorun"]), { allowedMagics: ["DLXF"] });
  const code = rpm.code.slice();
  for (let i = 0; i + 4 <= code.length; i += 4) if (code[i] === 0x50 && code[i + 1] === 0x57 && code[i + 2] === 0x4f && code[i + 3] === 0x52) { code[i + 12 + 2] = 0; }
  stageCodeInjectionDll(project, optionRowsDllPath(version).slice(8), writeRpm({ ...rpm, code }, { ident: "DLXF" }), "patches", project.originalRomBytes);
  const rom = new NintendoDSRom(project.originalRomBytes!, { fileData: "view" });
  const id = rom.filenames.idOf(OPTIONS_TEXT_PATH)!;
  const member = project.session.baseRom === "BW" ? 29 : 32;
  const store0 = project.narcs.message_texts;
  const archive = new NARC(project.fileSystem?.replacements?.[id] ?? getRomFileBytes(project, rom, id));
  if (store0?.dirty.has(member) && store0.rawFiles[member]) archive.files[member] = store0.rawFiles[member];
  const entries = decodeGen5TextBank(archive.files[member]);
  for (const [entry, text] of [[6, "FOLLOWERS"], [21, "ON"], [22, "OFF"], [30, "Choose whether Pokémon follow you."]] as const) entries[entry] = [entries[entry][0], text, entries[entry][2]];
  archive.files[member] = encodeGen5TextBank(entries);
  project.fileSystem = { ...project.fileSystem!, replacements: { ...project.fileSystem!.replacements, [id]: archive.save() } };
  const store = project.narcs.message_texts;
  if (store && store.sourcePath === OPTIONS_TEXT_PATH && store.container !== "file") {
    store.rawFiles = [...store.rawFiles]; store.rawFiles[member] = archive.files[member];
    store.dirty = new Set([...store.dirty, member]); store.records.delete(member);
  }
}

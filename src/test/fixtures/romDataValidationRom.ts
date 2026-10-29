import { writeU16, writeU32 } from "../../nds/binary";
import { addFilePath, Folder, saveFnt } from "../../nds/fnt";
import { NARC } from "../../nds/narc";
import { BW_NARCS, BW2_NARCS, type Gen5Version } from "../../pokeweb/constants";
import { encodeGen5TextBank } from "../../pokeweb/text";

/** Small real NARC/FNT/FAT fixture, with one valid example of each core record. */
export function coreDataFixture(version: Gen5Version = "B2") {
  const bw2 = version === "B2" || version === "W2", files: Record<string, Uint8Array[]> = {};
  const personal = () => {
    const b = new Uint8Array(bw2 ? 76 : 60); b.fill(50, 0, 6); b[8] = 200; b[18] = 127; b[19] = 15; b[20] = 70;
    b[22] = 1; b[23] = 1; b[24] = 1; b[25] = 2; b[26] = 1; b[32] = 1; writeU16(b, 34, 64); writeU16(b, 36, 10); writeU16(b, 38, 100); return b;
  };
  files.personal = [new Uint8Array(bw2 ? 76 : 60), personal(), personal()];
  const move = () => { const b = new Uint8Array(36); b[2] = 1; b[3] = 40; b[4] = 100; b[5] = 35; return b; };
  files.moves = [new Uint8Array(36), move(), move()];
  const item = () => { const b = new Uint8Array(36); writeU16(b, 0, 300); writeU16(b, 8, 31); return b; };
  files.items = [new Uint8Array(36), item(), item()];
  const terminated = (...values: number[]) => { const b = new Uint8Array(values.length * 2 + 4); values.forEach((v, i) => writeU16(b, i * 2, v)); writeU32(b, b.length - 4, 0xffffffff); return b; };
  files.learnsets = [terminated(), terminated(1, 1), terminated(2, 5)];
  const evo = new Uint8Array(42); writeU16(evo, 0, 4); writeU16(evo, 2, 16); writeU16(evo, 4, 2);
  files.evolutions = [new Uint8Array(42), evo, new Uint8Array(42)];
  files.egg_moves = [new Uint8Array(), Uint8Array.from([1, 0, 1, 0]), new Uint8Array(2)];
  const encounter = new Uint8Array(232); encounter[0] = 10;
  for (let slot = 0; slot < 12; slot++) { writeU16(encounter, 8 + slot * 4, 1); encounter[10 + slot * 4] = 5; encounter[11 + slot * 4] = 10; }
  files.encounters = [encounter];
  const trainer = new Uint8Array(20); trainer[0] = 3; trainer[3] = 1;
  files.trdata = [new Uint8Array(20), trainer];
  const party = new Uint8Array(18); party[0] = 255; party[2] = 10; writeU16(party, 4, 1); writeU16(party, 8, 1); writeU16(party, 10, 1);
  files.trpok = [new Uint8Array(), party];
  files.baby_species = [new Uint8Array(2), Uint8Array.from([1, 0]), Uint8Array.from([1, 0])];
  const trade = new Uint8Array(108); writeU32(trade, 4, 1); writeU32(trade, 12, 10); writeU32(trade, 92, 2);
  for (let n = 0; n < 6; n++) writeU32(trade, 16 + n * 4, 255);
  writeU32(trade, 44, 255); writeU32(trade, 96, 255);
  files.ingame_trades = [trade];
  if (bw2) { files.marts = [new Uint8Array(), Uint8Array.from([1, 0])]; files.mart_counts = [Uint8Array.from([0, 1])]; files.grottos = [new Uint8Array(220)]; }
  const text = (values: string[]) => encodeGen5TextBank(values.map((name, id) => [`0_${id}`, name, 0]));
  files.message_texts = Array.from({ length: bw2 ? 404 : 204 }, () => new Uint8Array(16));
  const bankIds = bw2 ? [90, 403, 64, 374, 398, 383] : [70, 203, 54, 182, 199, 191];
  for (const [n, bank] of bankIds.entries()) files.message_texts[bank] = text(n === 4 ? Array.from({ length: 17 }, (_, i) => `Type ${i}`) : ["None", "One", "Two"]);

  const paths = Object.fromEntries([...(bw2 ? BW2_NARCS : BW_NARCS), { name: "message_texts", path: "a/0/0/2" }, { name: "baby_species", path: "a/0/2/0" }].map(d => [d.name, d.path]));
  function rom(mutateArchive?: (name: string, bytes: Uint8Array) => Uint8Array): Uint8Array {
    const entries = Object.entries(files).map(([name, members]) => {
      const narc = new NARC(); narc.files = members; const bytes = narc.save();
      return { name, path: paths[name], bytes: mutateArchive?.(name, bytes) ?? bytes };
    }).sort((a, b) => a.path.localeCompare(b.path));
    let folder = new Folder(); entries.forEach((entry, id) => { folder = addFilePath(folder, entry.path, id); });
    const fnt = saveFnt(folder), fat = 0x4100, fntAt = 0x4400;
    let end = 0x5000; const locations = entries.map(entry => { const at = end; end = (end + entry.bytes.length + 3) & ~3; return at; });
    const bytes = new Uint8Array(end);
    const code = { B: "IRBO", W: "IRAO", B2: "IREO", W2: "IRDO" }[version]; bytes.set(new TextEncoder().encode(code), 12);
    writeU32(bytes, 0x20, 0x4000); writeU32(bytes, 0x2c, 4); writeU32(bytes, 0x30, 0x4020); writeU32(bytes, 0x3c, 4);
    writeU32(bytes, 0x40, fntAt); writeU32(bytes, 0x44, fnt.length); bytes.set(fnt, fntAt);
    writeU32(bytes, 0x48, fat); writeU32(bytes, 0x4c, entries.length * 8);
    entries.forEach((entry, id) => { writeU32(bytes, fat + id * 8, locations[id]); writeU32(bytes, fat + id * 8 + 4, locations[id] + entry.bytes.length); bytes.set(entry.bytes, locations[id]); });
    return bytes;
  }
  return { files, rom, paths };
}

import { readFileSync } from "node:fs";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { decodeGen5TextBank } from "../src/pokeweb/text";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: vite-node scripts/inspect-text-banks.ts <rom-or-bank> [bank ...]");
  process.exit(1);
}

const path = args[0];
const banks = args.slice(1).map((arg) => Number(arg));
const data = new Uint8Array(readFileSync(path));

function inspectBank(label: string, bytes: Uint8Array): void {
  try {
    const entries = decodeGen5TextBank(bytes);
    const sample = [1, 650, 721, 722, 748, 965, 1000, 1023, 1024, 1025]
      .filter((index) => index < entries.length)
      .map((index) => `${index}=${JSON.stringify(entries[index][1])}`)
      .join(" ");
    console.log(`${label}: ok entries=${entries.length} size=${bytes.length} ${sample}`);
  } catch (error) {
    console.log(`${label}: ERROR size=${bytes.length} ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (path.endsWith(".nds")) {
  const rom = new NintendoDSRom(data);
  const narc = new NARC(rom.getFileByName("a/0/0/2"));
  const wanted = banks.length > 0 ? banks : [90, 483, 486];
  console.log(`${path}: id=${rom.idCode} message_texts_files=${narc.files.length}`);
  for (const bank of wanted) {
    const file = narc.files[bank];
    if (!file) {
      console.log(`bank ${bank}: missing`);
      continue;
    }
    inspectBank(`bank ${bank}`, file);
  }
} else {
  inspectBank(path, data);
}

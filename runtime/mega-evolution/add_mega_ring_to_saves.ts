// Gives the bundled Black / White and Black 2 / White 2 test saves the Mega Ring (item 124, Key Items), so a test
// battle or quick launch of a ROM with Mega Evolution can Mega Evolve at once (the runtime needs the ring in the bag).
// The White 2 Upgrade / Black 2 Upgrade saves already hold it.
//
//     npx vite-node runtime/mega-evolution/add_mega_ring_to_saves.ts
import { readFileSync, writeFileSync } from "node:fs";
import { addRetailBagItem, type SaveFamily } from "../../src/pokeweb/itemSaveFormat";
import { MEGA_RING_ITEM } from "../../src/pokeweb/megaContentModel";
import { rawSaveBytesFromDesmumeDsv } from "../../src/pokeweb/testBattle";

const KEY_ITEMS = 4;
for (const [name, family] of [["test.sav", "BW2"], ["white.dsv", "BW1"]] as Array<[string, SaveFamily]>) {
  const path = new URL(`../../src/assets/testbattle/${name}`, import.meta.url);
  const file = new Uint8Array(readFileSync(path));
  const raw = rawSaveBytesFromDesmumeDsv(file);
  const { bytes, added } = addRetailBagItem(raw, family, KEY_ITEMS, MEGA_RING_ITEM);
  if (added) {
    const out = file.slice();
    out.set(bytes, 0); // a .dsv keeps its emulator footer after the raw save
    writeFileSync(path, out);
  }
  console.log(name, added ? "Mega Ring added" : "already holds the Mega Ring");
}

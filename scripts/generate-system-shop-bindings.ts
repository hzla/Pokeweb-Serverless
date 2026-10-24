import { writeFile } from "node:fs/promises";
import { pickerScript } from "../src/systemShops/compiler";
import { MAX_SHOPS } from "../src/systemShops/document";
import { fingerprint } from "../src/cgearButtons/compiler";
const scripts = Array.from({ length: MAX_SHOPS + 1 }, (_, n) =>
  pickerScript(n),
);
await writeFile(
  new URL(
    "../runtime/cgear-quick-actions/build/shop_picker.generated.h",
    import.meta.url,
  ),
  `#pragma once\nconstexpr u32 SHOP_PICKER_HASHES[]={${scripts.map((s) => `0x${fingerprint(s).toString(16)}`).join(",")}};\nconstexpr u16 SHOP_PICKER_SIZES[]={${scripts.map((s) => s.length).join(",")}};\n`,
);

if (process.argv.includes("--fixtures")) {
  const { readFile } = await import("node:fs/promises");
  const { NintendoDSRom } = await import("../src/nds/rom");
  const { NARC } = await import("../src/nds/narc");
  const { decodeGen5TextBank } = await import("../src/pokeweb/text");
  const { decompressCode } = await import("../src/nds/codeCompression");
  const { readU32 } = await import("../src/nds/binary");
  const { compile } = await import("../src/systemShops/compiler");
  const { defaults, tmTestShop, newShop } = await import(
    "../src/systemShops/document"
  );
  const rom = new NintendoDSRom(
    new Uint8Array(
      await readFile(new URL("../../cleanwhite2.nds", import.meta.url)),
    ),
    { fileData: "view" },
  );
  const arm = decompressCode(rom.arm9),
    pointer = readU32(arm, 0x20088f8 - rom.arm9RamAddress) - rom.arm9RamAddress;
  const iconPointer =
    readU32(arm, 0x202672c - rom.arm9RamAddress) - rom.arm9RamAddress;
  const assets = {
    icons: new NARC(rom.files[rom.fileId("a/0/2/5")]),
    iconMapping: arm.slice(iconPointer, iconPointer + 639 * 4),
    items: new NARC(rom.files[rom.fileId("a/0/2/4")]).files,
    pockets: arm.slice(pointer, pointer + 639),
    names: new Map(
      decodeGen5TextBank(
        new NARC(rom.files[rom.fileId("a/0/0/2")]).files[64],
      ).map((e) => [Number(e[0].split("_")[1]), e[1]]),
    ),
    messages: decodeGen5TextBank(
      new NARC(rom.files[rom.fileId("a/0/0/3")]).files[613],
    ),
  };
  {
    const document=defaults(),shop=tmTestShop(document);document.shops.push(shop);
    shop.inventory.forEach((row,i)=>row.condition={badges:i%9,...(i%3===0?{flag:{id:42,state:"set" as const}}:i%3===1?{flag:{id:42,state:"clear" as const}}:{})});
    await writeFile(new URL("../runtime/cgear-quick-actions/build/shop-fixture-conditions.narc",import.meta.url),compile({document,applied:document},assets));
  }
  for (const count of [0, 1, 16]) {
    const document = defaults();
    if (count) document.shops.push(tmTestShop(document));
    while (document.shops.length < count)
      document.shops.push(newShop(document));
    await writeFile(
      new URL(
        `../runtime/cgear-quick-actions/build/shop-fixture-${count}.narc`,
        import.meta.url,
      ),
      compile({ document, applied: document }, assets),
    );
  }
}

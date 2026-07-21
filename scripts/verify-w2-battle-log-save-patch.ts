import { readFileSync } from "node:fs";
import { parseRpm } from "../src/pokeweb/rpm";

const path = process.argv[2];
if (!path) throw new Error("Missing White2Upgrade.dll path.");
const rpm = parseRpm(new Uint8Array(readFileSync(path)), { allowedMagics: ["DLXF"] });
const matches = rpm.relocations.filter(
  (relocation) => relocation.target.module === "ARM9" && relocation.target.address === 0x02009f0d,
);
if (matches.length !== 1 || matches[0]?.target.type !== "FULL_COPY") {
  throw new Error("White2Upgrade.dll does not contain the expected static Wi-Fi List copy patch.");
}
const symbol = rpm.symbols[matches[0].sourceSymbolIndex];
if (symbol?.name !== "FULL_COPY_copyWifilist" || symbol.size !== 2) {
  throw new Error("The Wi-Fi List copy patch must be the two-byte FULL_COPY_copyWifilist stub.");
}
console.log("White2Upgrade.dll contains the static ARM9 Wi-Fi List copy patch.");

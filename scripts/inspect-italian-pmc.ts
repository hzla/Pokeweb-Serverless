import { readFile } from "node:fs/promises";
import { parseRpm } from "../src/pokeweb/rpm";

const rpm = parseRpm(new Uint8Array(await readFile(new URL("../src/assets/codeinjection/PMC_W2.rpm", import.meta.url))));
console.log(JSON.stringify({ metadata: rpm.metadata,
  imports: rpm.symbols.filter(symbol => symbol.attributes & 4).map(symbol => ({ name: symbol.name, address: symbol.address, type: symbol.type })),
  external: rpm.relocations.filter(relocation => relocation.target.module !== "base").map(relocation => ({ target: relocation.target, source: rpm.symbols[relocation.sourceSymbolIndex]?.name, size: rpm.symbols[relocation.sourceSymbolIndex]?.size })) }, null, 2));

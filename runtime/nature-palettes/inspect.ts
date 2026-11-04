import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseRpm } from "../../src/pokeweb/rpm";
import { estimateRpmMemory } from "../../src/pokeweb/rpmMemory";
const bytes = new Uint8Array(await readFile(process.argv[2]));
const rpm = parseRpm(bytes, { allowedMagics: ["DLXF"] });
const hooks = rpm.relocations.filter(r => r.target.module !== "base").map(r => ({ module: r.target.module, address: r.target.address, type: r.target.type }));
if (hooks.some(h => h.module === "ARM9" || h.module === "ARM7")) throw new Error("Nature palette modules must remain scoped to overlays.");
const relocations = rpm.relocations.map(({ target: t, sourceSymbolIndex: i }) => {
  const s = rpm.symbols[i]; return `${t.module}:${t.address}:${t.type}:${s.address}:${s.type}:${s.attributes}:${s.size}`;
}).sort();
await writeFile(process.argv[3], JSON.stringify({ sha256: createHash("sha256").update(bytes).digest("hex"), codeHex: Array.from(rpm.code, b => b.toString(16).padStart(2, "0")).join(""), bss: rpm.bssSize, relocations, hooks, memory: estimateRpmMemory(bytes) }, null, 2) + "\n");

/** Build opt-in derivatives from the retained, local PMC packages. */
import { readFile, writeFile } from "node:fs/promises";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";
import { buildExpandedPmcTemplate } from "../../src/pokeweb/pmcHeapRuntime";
for (const [game, cap] of [["B2", 200], ["W2", 200], ["W2I", 200], ["B2", 220], ["W2", 220]] as const) {
  const source = new URL(`../../src/assets/codeinjection/PMC_${game}.rpm`, import.meta.url);
  const output = new URL(`../../src/assets/codeinjection/PMC_${game}_${cap}.rpm`, import.meta.url);
  const rpm = buildExpandedPmcTemplate(parseRpm(new Uint8Array(await readFile(source))), cap);
  await writeFile(output, writeRpm(rpm));
  console.log(`Built PMC_${game}_${cap}.rpm`);
}

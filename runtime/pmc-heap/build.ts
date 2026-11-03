/** Build opt-in derivatives from the retained, local PMC packages. */
import { readFile, writeFile } from "node:fs/promises";
import { parseRpm, writeRpm } from "../../src/pokeweb/rpm";
import { buildExpandedPmcTemplate } from "../../src/pokeweb/pmcHeapRuntime";
for (const game of ["B2", "W2", "W2I"]) {
  const source = new URL(`../../src/assets/codeinjection/PMC_${game}.rpm`, import.meta.url);
  const output = new URL(`../../src/assets/codeinjection/PMC_${game}_200.rpm`, import.meta.url);
  const rpm = buildExpandedPmcTemplate(parseRpm(new Uint8Array(await readFile(source))));
  await writeFile(output, writeRpm(rpm));
  console.log(`Built PMC_${game}_200.rpm`);
}

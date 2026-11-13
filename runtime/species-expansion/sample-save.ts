// Sample saves for the species expansion (Black 2 / White 2): the bundled test save with the national Pokédex, every
// species (1-1023) seen and caught (the Pokédex extension's layout, runtime/species-expansion/src/species.c) and a party
// of added species.
// npx vite-node runtime/species-expansion/sample-save.ts /path/clean-white2-or-black2.nds
// Writes samples/SpeciesExpansion.sav (a raw 512 KiB save). The two games' saves are the same (the bundled test save
// loads in either, and the added species' numbers don't depend on the game), so one ROM of either game is enough.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { installCodeInjectionPatch, loadCodeInjectionNarcs } from "../../src/pokeweb/codeInjectionInstall";
import { NintendoDSRom } from "../../src/nds/rom";
import { installSpeciesExpansion } from "../../src/pokeweb/speciesExpansionModel";
import { getTestBattleConfigForProject, loadTestBattleSave } from "../../src/pokeweb/testBattle";
import { patchTestBattleSavePlayerParty } from "../../src/pokeweb/testBattleTeam";
import { adaptSaveForProject } from "../../src/pokeweb/itemExpansionModel";
import { decodeRecord } from "../../src/pokeweb/projectStore";
import { expansionSpeciesOf } from "../../src/pokeweb/speciesExpansionIds";
import { editPokedexSave, registerPokedexSpecies, setNationalPokedex } from "../../src/pokeweb/speciesExpansionSaveModel";

const TEAM = `Greninja
Level: 50
- Surf
- Night Slash
- Ice Beam
- Extrasensory

Decidueye
Level: 50
- Leaf Blade
- Shadow Sneak
- Brave Bird
- Swords Dance

Cinderace
Level: 50
- Flare Blitz
- Bounce
- Zen Headbutt
- Quick Attack

Sylveon
Level: 50
- Hyper Voice
- Calm Mind
- Wish
- Swift

Dragapult
Level: 50
- Dragon Pulse
- Shadow Ball
- U-turn
- Thunderbolt

Meowscrda
Level: 50
- Leaf Blade
- Night Slash
- U-turn
- Sucker Punch`;

globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(await readFile(new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const output = fileURLToPath(new URL("./samples/", import.meta.url));
await mkdir(output, { recursive: true });

{
  const romPath = process.argv[2]!;
  const project = await loadProjectFromRomBytes(new Uint8Array(await readFile(romPath)), basename(romPath), { selectedNarcs: [] });
  await installSpeciesExpansion(project, (stage) => installCodeInjectionPatch(project, stage));
  loadCodeInjectionNarcs(project, new NintendoDSRom(project.originalRomBytes!, { fileData: "view" }), ["personal", "moves"]); // the moves' PP
  const config = getTestBattleConfigForProject(project);
  const party = patchTestBattleSavePlayerParty((await loadTestBattleSave(config)).rawSaveBytes, project, TEAM, config.baseRom);
  const save = editPokedexSave(adaptSaveForProject(project, party), (dex) => {
    setNationalPokedex(dex);
    const last = 649 + project.codeInjection!.speciesExpansion!.count; // the package's last (Iron Crown, 1023)
    for (let national = 1; national <= last; national++) {
      const gender = Number(decodeRecord(project, "personal", expansionSpeciesOf(national)).raw!.gender);
      registerPokedexSpecies(dex, national, true, gender === 254);
    }
  });
  await writeFile(`${output}SpeciesExpansion.sav`, save);
  console.log(`${project.session.baseVersion}: ${output}SpeciesExpansion.sav`);
}

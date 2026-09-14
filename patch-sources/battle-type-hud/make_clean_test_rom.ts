// Local validation helper only. Uses existing PMC tooling without changing its
// catalog, bundled assets, project files, or the user's source ROM/save.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadProjectFromRomBytes } from '../../src/pokeweb/loader';
import { installPmcBytes, stageCodeInjectionDll } from '../../src/pokeweb/pmcModel';
import { exportModifiedRom } from '../../src/pokeweb/exportRom';
const root=new URL('../../',import.meta.url);
const source=process.argv[2];
if(!source) throw new Error('Supply a clean English BW2 ROM.');
const bytes=new Uint8Array(await readFile(source));
const project=await loadProjectFromRomBytes(bytes,'private-type-hud-test.nds',{selectedNarcs:[]});
const game=project.session.baseVersion;
if(game!=='B2'&&game!=='W2') throw new Error('Expected B2 or W2.');
installPmcBytes(project,new Uint8Array(await readFile(new URL(`src/assets/codeinjection/PMC_${game}.rpm`,root))),bytes);
const folder=new URL(`build/live-${game}${process.env.BTH_LIVE_SUFFIX ?? ""}/`,import.meta.url);await mkdir(folder,{recursive:true});
await writeFile(new URL('baseline.nds',folder),await exportModifiedRom(project));
for (const module of ["TypeIcons", "MoveEffectiveness"]) stageCodeInjectionDll(project,`${module}${game}.dll`,new Uint8Array(await readFile(new URL(`build/${module}${game}.dll`,import.meta.url))));
await writeFile(new URL('typehud.nds',folder),await exportModifiedRom(project));
console.log('Created private reset-boot test ROMs for '+game);

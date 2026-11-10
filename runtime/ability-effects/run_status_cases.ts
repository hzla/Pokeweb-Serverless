/** Cold-boot native BW/BW2 battles. The emulator-only log records actual applied
 * statuses, native power ratios, hit recipients and HP after damage. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {runLoggedBattle} from './battle_log_runner';
const [directory]=process.argv.slice(2);if(!directory)throw Error('Usage: FIXTURE_DIRECTORY [--only=labels]');
const manifest=JSON.parse(await readFile(`${directory}/cases.json`,'utf8')),evidence=`${directory}/status-evidence/`;await mkdir(evidence,{recursive:true});
const only=process.argv.find(x=>x.startsWith('--only='))?.slice(7).split(',');
const results=[];
for(const spec of manifest.cases){
 if(only&&!only.includes(spec.label.replace(/^\d+-/,'')))continue;
 const {entries,frames}=await runLoggedBattle(directory,spec,{tag:'CSTL',frames:12000,shots:false,evidence,logCapacity:128}),c=spec.checks.extension,errors:string[]=[];
 const starts=entries.filter(e=>e.event===3&&e.a===0),statuses=entries.filter(e=>(e.event===0x68||e.event===0x69)&&e.a===0&&e.value),powers=entries.filter(e=>e.event===0x38&&e.a===0),hits=entries.filter(e=>e.a===0&&(e.event===0x4b&&e.value>0||e.event===4&&e.d<24&&e.value>e.y));
 if(starts.length<(spec.menuCount??1))errors.push('Requested move sequence did not complete');
 for(const condition of c.statuses??[])if(!statuses.some(e=>e.x===condition))errors.push(`Condition ${condition} was not applied`);
 for(const condition of c.absent??[])if(statuses.some(e=>e.x===condition))errors.push(`Unexpected condition ${condition}`);
 if(c.firstType!==undefined&&powers[0]?.x!==c.firstType)errors.push('Converted move type not observed');
 if(c.ability!==undefined&&!starts.some(e=>e.value===c.ability))errors.push('Expected swapped/suppressed ability state not observed');
 if(c.playerStatus&&!entries.some(e=>(e.event===0x68||e.event===0x69)&&e.d===0&&e.x===c.playerStatus&&e.value))errors.push('Reflected status did not reach the holder');
 if(c.ratio!==undefined&&!powers.some(e=>e.value===c.ratio))errors.push(`Power ratio ${c.ratio} not observed`);
 if((c.ratio!==undefined||c.noRatio!==undefined)&&!hits.length)errors.push('No completed damaging move observed');
 if(c.noRatio!==undefined&&powers.some(e=>e.value===c.noRatio))errors.push(`Unexpected ratio ${c.noRatio}`);
 if(c.noPlayerHits&&hits.length)errors.push('Immune target took a hit');
 if(c.selectedTarget&&!hits.some(e=>e.d===entries.find(e=>e.event===0x2a&&e.a===0)?.d))errors.push('Selected recipient was not hit through redirection');
 if(c.target!==undefined&&!hits.some(e=>e.d===c.target))errors.push(`Selected target ${c.target} not hit`);
 results.push({label:spec.label,passed:!errors.length,errors,frames,entries});
 console.log(`${errors.length?'FAIL':'ok  '} ${spec.label}${errors.length?': '+errors.join('; '):''}`);
 await writeFile(`${evidence}results.json`,JSON.stringify(results,null,1));
}
console.log(`${results.filter(r=>r.passed).length}/${results.length} native cases passed`);if(results.some(r=>!r.passed))process.exitCode=1;

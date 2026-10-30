import { readFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../../src/pokeweb/loader";
import { installBundledPmc, loadBundledPmcBytes } from "../../../src/pokeweb/pmcModel";
import { parseRpm, setRpmBaseAddress, updateRpmCodeImageForBase, writeRelocationDataByType } from "../../../src/pokeweb/rpm";
import { sha256Hex } from "../../../src/nds/sha256";
import contract from "../../../src/assets/data/bw2TownMapNativeContract.json";
globalThis.fetch = (async input => new Response(new Uint8Array(await readFile(new URL(String(input)))))) as typeof fetch;
const bytes = new Uint8Array(await readFile(process.argv[2]));
const p = await loadProjectFromRomBytes(bytes, "fixture.nds", { selectedNarcs: ["headers"] });
await installBundledPmc(p);
const pmc = p.codeInjection!.pmc!, version = p.session.baseVersion as "B2" | "W2", root = 0x02004000;
const bundled = parseRpm(await loadBundledPmcBytes(version)); setRpmBaseAddress(bundled, pmc.overlayBaseAddress!); updateRpmCodeImageForBase(bundled);
const active = parseRpm(p.fileSystem!.additions![pmc.overlayPath]);
for (const range of contract[version].ranges.filter(r => "pmcPrefixHex" in r)) {
 const current = p.arm9.slice(range.address-root,range.address-root+range.size), original=current.slice();
 original.set(Uint8Array.from((range.pmcPrefixHex as string).match(/../g)!.map(b=>parseInt(b,16))));
 const hooks=bundled.relocations.filter(r=>r.target.module==="ARM9"&&r.target.address>=range.address&&r.target.address<range.address+range.size);
 console.log(JSON.stringify({address:range.address,originalHashMatches:sha256Hex(original)===range.sha256,hooks:hooks.map(h=>[h.target,bundled.symbols[h.sourceSymbolIndex]])}));
 for(const hook of hooks){const s=bundled.symbols[hook.sourceSymbolIndex];console.log({codeLength:[active.code.length,bundled.code.length],wrapperSize:s.size,wrapperDiff:[...bundled.code.subarray(s.address,s.address+s.size)].map((b,i)=>b!==active.code[s.address+i]?i:-1).filter(x=>x>=0).slice(0,20)});writeRelocationDataByType(bundled,hook,original,hook.target.address,range.address);}
 console.log({remainingDiff:[...original].map((b,i)=>b!==current[i]?i:-1).filter(x=>x>=0).slice(0,30)});
}

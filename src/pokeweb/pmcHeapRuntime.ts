import { readU16, writeU16, writeU32 } from "../nds/binary";
import { cloneRpm, type RpmModule } from "./rpm";
import budgetRuntime from "../assets/data/pmcHeapBudgetRuntime.json";

export const EXPANDED_PMC_HEAP_KIB = 200;
export const PMC_HEAP_REVISION = 1;

/** Derive an opt-in package without changing the retained loader bundles. */
export function buildExpandedPmcTemplate(input: RpmModule): RpmModule {
  const rpm = cloneRpm(input);
  if (!["13.2.4", "13.2.4-w2i"].includes(String(rpm.metadata.PMCVersion))) throw Error("Unrecognized PMC source version.");
  const allocator = rpm.symbols.find(s => s.name === "_ZN3pmc6System21CreateSystemAllocatorEv");
  if (!allocator || allocator.size !== 90) throw Error("Unrecognized PMC allocator.");
  const at = allocator.address + 32;
  const expected = [0x23a0, 0x1a8a, 0x029b, 0x429a, 0xd900, 0x001a];
  if (!expected.every((word, n) => readU16(rpm.code, at + n * 2) === word)) throw Error("Unrecognized PMC heap cap instructions.");
  writeU16(rpm.code, at, 0x2300 | EXPANDED_PMC_HEAP_KIB);
  const create = rpm.symbols.find(s => s.name === "_ZN3exl4heap8HeapArea8CreateInEPKcPvj");
  if (!create || create.size !== 44 || readU16(rpm.code, create.address + 10) !== 0x1ac1 || readU16(rpm.code, create.address + 12) !== 0x1a52) throw Error("Unrecognized PMC arena accounting.");
  // Subtract the context/alignment prefix from capacity. The retained build
  // subtracts a negative offset and consequently extends beyond its arena.
  writeU16(rpm.code, create.address + 10, 0x1a19); // subs r1, r3, r0
  rpm.metadata.PMCVersion = `${rpm.metadata.PMCVersion}-heap200`;
  rpm.metadata.PokewebPmcHeapKiB = EXPANDED_PMC_HEAP_KIB;
  rpm.metadata.PokewebPmcHeapRevision = PMC_HEAP_REVISION;
  return rpm;
}

/** Reserve before BW1 creates game heaps, but start patch DLLs afterwards.
 * Keep every existing exported code/data address stable for installed patches. */
export function adaptExpandedBw1PmcBoot(rpm: RpmModule, gflAppInitIndex: number, specs: Uint8Array, dsLiteral: number): void {
  const named = (name: string) => {
    const index = rpm.symbols.findIndex(s => s.name === name);
    if (index < 0) throw Error(`Missing expanded PMC service: ${name}`);
    return index;
  };
  const create = named("_ZN3pmc6System21CreateSystemAllocatorEv");
  const initialize = named("_ZN3pmc3fwk10InitializeEPN3exl4heap9AllocatorE");
  const system = rpm.symbols[named("_ZN3pmc6System4InitEv")];
  const start = named("_PMCSystemInit");
  const boot = rpm.relocations.find(r => r.target.module === "base" && r.target.address === 14);
  const calls = [create, initialize].map(index => rpm.relocations.filter(r => r.target.module === "base" && r.sourceSymbolIndex === index && r.target.address >= system.address && r.target.address + 4 <= system.address + system.size));
  if (!boot || calls.some(rows => rows.length !== 1) || calls[1][0].target.address !== calls[0][0].target.address + 4) throw Error("Unrecognized PMC initialization sequence.");
  for (const call of calls.flat()) {
    if ((readU16(rpm.code, call.target.address) & 0xf800) !== 0xf000) throw Error("Unrecognized PMC initialization call.");
    writeU16(rpm.code, call.target.address, 0x46c0);
    writeU16(rpm.code, call.target.address + 2, 0x46c0);
  }
  rpm.relocations = rpm.relocations.filter(r => !calls.flat().includes(r));

  // Materialize the existing BSS instead of moving its exported globals when
  // appending code. The overlay still reserves the same total address range.
  if(specs.length!==16)throw Error("Invalid BW1 startup heap specifications.");
  const wrapper = ((((rpm.code.length + 3) & ~3) + rpm.bssSize + 3) & ~3);
  const budget = wrapper + 72, table = (budget + budgetRuntime.code.length + 3) & ~3;
  const code = new Uint8Array(table + 16); code.set(rpm.code);
  code.set(budgetRuntime.code,budget);code.set(specs,table);
  // The native boot FULL_COPY has already pushed LR. Five more words
  // preserve native arguments and restore eight-byte call alignment.
  for(const[at,word]of [[0,0xb50f],[2,0x480e],[4,0x490e],[6,0x6809],[8,0x4a0e],[10,0x6812],[16,0x2800],[18,0xd009],[28,0xbc0f],[38,0xbd00],[40,0xbc0f],[58,0xbd00]])writeU16(code,wrapper+at,word);
  writeU32(code,wrapper+64,0x02fffda0);writeU32(code,wrapper+68,0x02fffdc4);
  rpm.code = code; rpm.bssSize = 0;
  const symbol = rpm.symbols.push({ name: "__PokewebBw1ExpandedHeapBoot", address: wrapper, size: 72, type: "FUNCTION_THM", attributes: 0 }) - 1;
  const planner = rpm.symbols.push({name:"__PokewebBw1HeapBudget",address:budget,size:budgetRuntime.code.length,type:"FUNCTION_THM",attributes:0})-1;
  const heapSpecs = rpm.symbols.push({name:"__PokewebBw1HeapSpecs",address:table,size:16,type:"SECTION",attributes:0})-1;
  for(const[at,sourceSymbolIndex]of [[12,planner],[20,create],[24,initialize],[30,gflAppInitIndex],[34,start],[42,gflAppInitIndex],[46,create],[50,initialize],[54,start]])rpm.relocations.push({target:{module:"base",address:wrapper+at,type:"THUMB_BRANCH_LINK"},sourceSymbolIndex});
  rpm.relocations.push({target:{module:"base",address:wrapper+60,type:"OFFSET"},sourceSymbolIndex:heapSpecs},{target:{module:"ARM9",address:dsLiteral,type:"OFFSET"},sourceSymbolIndex:heapSpecs});
  boot.sourceSymbolIndex = symbol;
}

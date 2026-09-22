// Validate spacing against delivered artwork. Does not execute a DS emulator.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { NARC } from "../src/nds/narc";
import { decodeFollowerRegistry, deriveFollowerSpacing, followerKey } from "../src/pokeweb/followingPokemonModel";
const [input,output]=process.argv.slice(2);
if(!input)throw new Error("Expected installed ROM and optional report path");
const rom=new NintendoDSRom(new Uint8Array(readFileSync(input)),{fileData:"view"});
const file=(name:string)=>rom.files[rom.filenames.idOf(name)!];
const binary=file("following/runtime-registry.bin"),registry=decodeFollowerRegistry(binary);
assert.ok(binary[4]===3||binary[4]===4,"Width metadata needs FWDB v3/v4");
const expected=structuredClone(registry);
deriveFollowerSpacing(expected,new NARC(file("a/0/4/8")).files);
assert.deepEqual(registry,expected,"Spacing must match installed artwork, including placeholders");
const distribution=Array.from({length:7},(_,gap)=>({gap,appearances:registry.entries.filter(e=>e.sideGap===gap).length}));
const examples=registry.entries.filter(e=>[1,25,561,644,650,722,810,1007,1023].includes(e.key.species)&&e.key.form===0&&!e.key.shiny)
  .map(e=>({appearance:followerKey(e.key),extra:e.sideGap,canvas:e.size,placeholder:e.placeholder}));
const report={appearances:registry.entries.length,registryBytes:binary.length,format:binary[4],distribution,examples,gameEmulatorRun:false};
if(output)writeFileSync(output,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));

import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { compileBw2Script, decompileBw2Script } from "./bw2ScriptCompiler";
import { gen5ScriptEntries } from "./gen5ScriptCommands";
import { buildQuickLaunchDownloads, getTestBattleConfigForProject, loadTestBattleSave } from "./testBattle";
import { loadNativeCutsceneLibrary } from "./nativeCutsceneModel";
import type { ProjectState } from "./projectStore";
import { FIELD_TEST_PREFIX } from './fieldScene';

export const NATIVE_CUTSCENE_TEST_SOURCE = `preserve_layout
script :custom_cutscene_test, entry: 1 do
  lock
  cmd_01a4
  cmd_01a7
  cmd_014b
  cmd_0154 27, 0
  cmd_014a
  cmd_009e
  cmd_01a3
  cmd_01a7
  unlock
  halt
end
`;

function cutsceneTestBody(sequenceId: number) {
  if (!Number.isInteger(sequenceId) || sequenceId < 1 || sequenceId > 63) throw new Error("Invalid native sequence ID.");
  const compiled = compileBw2Script(NATIVE_CUTSCENE_TEST_SOURCE.replace("cmd_0154 27, 0", `cmd_0154 ${sequenceId}, 0`)), body = compiled.bytes.subarray(compiled.entries[0].offset);
  if (!decompileBw2Script(compiled.bytes).editable) throw new Error("The cutscene launch script failed control-flow validation.");
  return body;
}
/** Insert one public slot; shifting the whole body by four preserves its relative references. */
export function appendCutsceneTestScript(bytes: Uint8Array, sequenceId = 27) {
  const body = cutsceneTestBody(sequenceId), entries = gen5ScriptEntries(bytes), end = entries.length * 4;
  if (!entries.length || readU16(bytes, end) !== 0xfd13 || entries.length >= 65534) throw new Error("The map script entry table cannot be extended safely.");
  const output = new Uint8Array(bytes.length + 4 + body.length);
  output.set(bytes.subarray(end), end + 4);
  for (let i = 0; i < entries.length; i++) writeU32(output, i * 4, readU32(bytes, i * 4) + 4);
  writeU32(output, end, bytes.length - end);
  output.set(body, bytes.length + 4);
  return { bytes: output, entryId: entries.length + 1 };
}

/** Add a one-tile grid trigger; existing actors and the save's cached actors are untouched. */
export function appendCutsceneTestTrigger(bytes: Uint8Array, entryId: number, position: { gridX: number; gridY: number; gridZ: number }) {
  if (bytes.length < 8) throw new Error("Truncated map events.");
  const end = 8 + bytes[4] * 20 + bytes[5] * 36 + bytes[6] * 20 + bytes[7] * 22;
  if (end > bytes.length || readU32(bytes, 0) + 4 < end || readU32(bytes, 0) + 4 > bytes.length || bytes[7] === 255 || bytes.length + 22 >= 0x984) throw new Error("The map event table cannot hold another test trigger.");
  const words = [entryId, 0, 0, 0, 0, position.gridX, position.gridZ + 1, 1, 1, position.gridY * 16, 0];
  if (words.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new Error("The test trigger is outside the native coordinate range.");
  const output = new Uint8Array(bytes.length + 22);
  output.set(bytes.subarray(0, end)); output.set(bytes.subarray(end), end + 22);
  words.forEach((n, i) => writeU16(output, end + i * 2, n));
  output[7]++; writeU32(output, 0, readU32(bytes, 0) + 22);
  return output;
}

/** Remove only this tool's exact temporary launch trigger, retaining its script entry. */
export function removeNativeCutsceneTestTriggers(scripts: Uint8Array, events: Uint8Array, position: {gridX:number;gridY:number;gridZ:number}) {
  const low = cutsceneTestBody(1), high = cutsceneTestBody(63), parameter = low.findIndex((n,i)=>n!==high[i]);
  if (parameter < 0 || low.some((n,i)=>i!==parameter&&n!==high[i])) throw new Error('Unsupported cutscene test layout.');
  const entries = gen5ScriptEntries(scripts);
  return filterTestTriggers(events, position, entryId => {
    const offset = entries[entryId - 1];
    return offset !== undefined && offset + low.length <= scripts.length && scripts[offset + parameter] >= 1 && scripts[offset + parameter] <= 63 && low.every((n,i)=>i===parameter||scripts[offset+i]===n);
  });
}

export function removeFieldSceneTestTriggers(scripts: Uint8Array, events: Uint8Array, position: {gridX:number;gridY:number;gridZ:number}) {
  const entries=gen5ScriptEntries(scripts);
  return filterTestTriggers(events,position,entryId=>{const at=entries[entryId-1];return at!==undefined&&at+FIELD_TEST_PREFIX.length<=scripts.length&&FIELD_TEST_PREFIX.every((n,i)=>scripts[at+i]===n);});
}

export function filterTestTriggers(events: Uint8Array, position: {gridX:number;gridY:number;gridZ:number}, owned: (entryId:number)=>boolean) {
  if (events.length < 8) throw new Error('Truncated map events.');
  const start = 8 + events[4]*20 + events[5]*36 + events[6]*20, end = start + events[7]*22;
  if (end > events.length || readU32(events,0)+4 < end || readU32(events,0)+4 > events.length) throw new Error('Truncated map events.');
  const expected = [0,0,0,0,0,position.gridX,position.gridZ+1,1,1,position.gridY*16,0], keep:number[] = [];
  for (let i=0;i<events[7];i++) { const at=start+i*22;if(!expected.every((n,j)=>j===0||readU16(events,at+j*2)===n)||!owned(readU16(events,at))) keep.push(i); }
  const removed = events[7]-keep.length, output = new Uint8Array(events.length-removed*22); output.set(events.subarray(0,start));
  keep.forEach((i,j)=>output.set(events.subarray(start+i*22,start+(i+1)*22),start+j*22));output.set(events.subarray(end),start+keep.length*22);
  output[7]=keep.length;writeU32(output,0,readU32(events,0)-removed*22);return output;
}

/** Re-exporting a test ROM must launch the new scene, not retain its older step trigger. */
export function installCutsceneTestFixture(scripts: Uint8Array, events: Uint8Array, sequenceId: number, position: {gridX:number;gridY:number;gridZ:number}) {
  events = removeFieldSceneTestTriggers(scripts,events,position);
  const body = cutsceneTestBody(sequenceId), low = cutsceneTestBody(1), high = cutsceneTestBody(63), entries = gen5ScriptEntries(scripts);
  const parameter = low.findIndex((n,i)=>n!==high[i]);
  if (parameter < 0 || low.some((n,i)=>i!==parameter&&n!==high[i])) throw new Error('Unsupported cutscene test command layout.');
  if (events.length<8) throw new Error('Truncated map events.');
  const start=8+events[4]*20+events[5]*36+events[6]*20,end=start+events[7]*22;
  if(end>events.length||readU32(events,0)+4<end||readU32(events,0)+4>events.length)throw new Error('Truncated map events.');
  const expected=[0,0,0,0,0,position.gridX,position.gridZ+1,1,1,position.gridY*16,0],matches:Array<{index:number;entryId:number;offset:number}>=[];
  for(let index=0;index<events[7];index++) {
    const at=start+index*22,entryId=readU16(events,at),offset=entries[entryId-1];
    if(!expected.every((n,i)=>i===0||readU16(events,at+i*2)===n)||offset===undefined||offset+body.length>scripts.length)continue;
    if(scripts[offset+parameter]<1||scripts[offset+parameter]>63||!low.every((n,i)=>i===parameter||scripts[offset+i]===n))continue;
    matches.push({index,entryId,offset});
  }
  if(!matches.length){const appended=appendCutsceneTestScript(scripts,sequenceId);return {scripts:appended.bytes,events:appendCutsceneTestTrigger(events,appended.entryId,position),entryId:appended.entryId};}
  const first=matches[0],removed=new Set(matches.slice(1).map(m=>m.index)),outScripts=scripts.slice(),outEvents=new Uint8Array(events.length-removed.size*22);
  outScripts.set(body,first.offset);outEvents.set(events.subarray(0,start));let cursor=start;
  for(let i=0;i<events[7];i++)if(!removed.has(i)){outEvents.set(events.subarray(start+i*22,start+(i+1)*22),cursor);cursor+=22;}
  outEvents.set(events.subarray(end),cursor);outEvents[7]-=removed.size;writeU32(outEvents,0,readU32(events,0)-removed.size*22);
  return {scripts:outScripts,events:outEvents,entryId:first.entryId};
}

/** Build an isolated launch ROM. The matching bundled fixture save is returned unchanged. */
export async function buildNativeCutsceneTestDownloads(project: ProjectState, sequenceId = 27) {
  const library = await loadNativeCutsceneLibrary(project);
  if (!library.definitions.some(d => d.id === sequenceId)) throw new Error(`Install native sequence ${sequenceId} before exporting its test ROM.`);
  const [download, save] = await Promise.all([buildQuickLaunchDownloads(project), loadTestBattleSave(getTestBattleConfigForProject(project))]);
  if (save.zoneId !== 427) throw new Error("The cutscene test fixture must start in Aspertia City.");
  const rom = new NintendoDSRom(download.romBytes, { fileData: "view" }), headers = new NARC(rom.getFileByName("a/0/1/2")).files[0];
  const field = rom.loadArm9Overlays([12]).get(12);
  for (const [opcode, pointer, signature] of [
    [0x154, 0x021578f1, "f8b582b00c1c051c201cfdf763fc061c"],
    [0x14a, 0x021574e5, "38b50d1c281cfdf76bfe041c281cfdf7"],
    [0x14b, 0x02157509, "38b50c1c201cfdf759fe051c201cfdf7"],
  ] as const) {
    const at = field ? (pointer & ~1) - field.ramAddress : -1;
    if (!field || at < 0 || readU32(field.data, 0x1b178 + opcode * 4) !== pointer ||
      !signature.match(/../g)!.every((n, i) => field.data[at + i] === parseInt(n, 16))) throw new Error("The native field/cutscene transition handlers have changed; this ROM's test trigger is unsupported.");
  }
  const scriptId = readU16(headers, save.zoneId * 48 + 6), eventId = readU16(headers, save.zoneId * 48 + 22);
  const scriptFile = rom.fileId("a/0/5/6"), eventFile = rom.fileId("a/1/2/6");
  const scripts = new NARC(rom.files[scriptFile]), events = new NARC(rom.files[eventFile]);
  const fixture = installCutsceneTestFixture(scripts.files[scriptId],events.files[eventId],sequenceId,save);
  scripts.files[scriptId] = fixture.scripts;events.files[eventId] = fixture.events;
  return {
    romBytes: rom.save({ files: new Map([[scriptFile, scripts.save()], [eventFile, events.save()]]), preserveOriginalLength: true }),
    saveBytes: new Uint8Array(save.rawSaveBytes), dsvBytes: download.saveBytes,
    trigger: { sequenceId, zoneId: save.zoneId, gridX: save.gridX, gridZ: save.gridZ + 1, scriptId, entryId: fixture.entryId, eventId },
  };
}

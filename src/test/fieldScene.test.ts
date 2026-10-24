import { describe, expect, it } from 'vitest';
import example from '../../examples/cutscenes/route13.field-scene.json';
import { readFieldScene, compileFieldScene, fieldScenePlayerPath, storeFieldScene } from '../pokeweb/fieldScene';
import { appendFieldSceneScript, validateFieldSceneGround, validateFieldSceneInterpolation } from '../pokeweb/fieldSceneTest';
import { compileBw2Script, decompileBw2Script } from '../pokeweb/bw2ScriptCompiler';
import { gen5ScriptEntries } from '../pokeweb/gen5ScriptCommands';
import { createProjectDocument } from '../pokeweb/projectDocument';
import { openProjectSession } from '../pokeweb/projectSession';
import { makeEditProject } from './fixtures/editProject';
import { appendCutsceneTestScript, appendCutsceneTestTrigger, removeNativeCutsceneTestTriggers, filterTestTriggers, installCutsceneTestFixture } from '../pokeweb/nativeCutsceneTest';
import { FIELD_TEST_PREFIX } from '../pokeweb/fieldScene';
const scene = () => readFieldScene(example);

describe('live field tours', () => {
  it('uses the actual player and returns to the final gameplay pose before releasing input', () => {
    const { compiled, source } = compileFieldScene(scene()), ops = compiled.instructions.map(i => i.opcode);
    expect(compiled.instructions.filter(i => i.opcode === 0x64).map(i => i.operands[0])).toEqual([255, 255]);
    expect(ops.slice(-6)).toEqual([0x147, 0x145, 0x142, 0x140, 0x2f, 2]);
    expect(ops).not.toContain(0x144); // saved start-pose return is wrong after player movement
    for (const opcode of [0x154, 0x14a, 0x14b, 0x1a3, 0x1a4, 0xc2]) expect(ops).not.toContain(opcode);
    expect(source).toContain('walk_down 10');
    expect(fieldScenePlayerPath(scene()).at(-1)).toEqual({ tileX: 697, tileZ: 249, facing: 'down' });
    const test = compileFieldScene(scene(), true).compiled;
    expect(test.instructions.find(i => i.opcode === 0xc2)?.operands).toEqual([370, 697, 239, 1]);
  });
  it('encodes camera coordinates as signed fx32 and angles as native turn units', () => {
    const instruction = compileFieldScene(scene()).compiled.instructions.find(i => i.opcode === 0x143)!;
    expect(instruction.operands).toEqual([9688, 0, 237 * 4096, 11128 * 4096, (-76 * 4096) >>> 0, 3720 * 4096, 120]);
    expect(()=>validateFieldSceneInterpolation(scene(),{chunks:[]},237)).not.toThrow();
    const far=scene();Object.assign(far.steps[0],{target:[30000,0,30000],durationFrames:1800});
    expect(()=>validateFieldSceneInterpolation(far,{chunks:[]},237)).toThrow('interpolation range');
  });
  it('requires a reachable final cleanup and rejects unsupported data instead of dropping it', () => {
    const bad = scene(); bad.steps.pop(); expect(() => readFieldScene(bad)).toThrow('Return control');
    const early = scene(); early.steps.unshift({ id: 'early', type: 'control.return', durationFrames: 30 }); expect(() => readFieldScene(early)).toThrow('Return control');
    expect(() => readFieldScene({ ...scene(), seamless: true })).toThrow('Unsupported property');
    const unknown = scene(); Object.assign(unknown.steps[0], { easing: 'smoothstep' }); expect(() => readFieldScene(unknown)).toThrow('Unsupported property');
    const duplicate = scene(); duplicate.steps[1].id = duplicate.steps[0].id; expect(() => readFieldScene(duplicate)).toThrow('unique');
    for (const n of [NaN, Infinity, 0, 1.5, 1801]) { const s = scene(); Object.assign(s.steps[0], { durationFrames: n }); expect(() => readFieldScene(s)).toThrow('Duration'); }
    const outside = scene(); outside.entry.tileZ = 2047; expect(() => readFieldScene(outside)).toThrow('leaves');
  });
  it('preserves existing script bodies and all appended relative movement references', () => {
    const original = compileBw2Script('preserve_layout\nscript :a, entry: 1 do\napply_movement 255, :walk\nhalt\nend\nmovement :walk do\nwalk_up 1\nend').bytes;
    const compiled = compileFieldScene(scene()).compiled, result = appendFieldSceneScript(original, compiled);
    const before = gen5ScriptEntries(original), after = gen5ScriptEntries(result.bytes);
    expect(result.entryId).toBe(2); expect(after[0]).toBe(before[0] + 4);
    expect(result.bytes.slice(after[0], original.length + 4)).toEqual(original.slice(before[0]));
    expect(result.bytes.slice(after[1])).toEqual(compiled.bytes.slice(compiled.entries[0].offset));
    expect(decompileBw2Script(result.bytes).source).toContain('walk_down 10');
    expect(() => appendFieldSceneScript(new Uint8Array(8), compiled)).toThrow('safely');
  });
  it('checks every traversed tile using matrix origins rather than centered mesh coordinates', () => {
    const s = scene(), tile = { tileClass: 25, flags: 0x88, height: 141, heightType: 0, slope: 0 };
    const chunk = { chunkId: 87, sourceChunkId: 87, matrixX: 21, matrixY: 7, worldX: 11008, worldZ: 3840, primitives: [], permissions: { chunkId: 87, width: 32, height: 32, tiles: Array.from({ length: 1024 }, () => ({ ...tile })) } };
    expect(() => validateFieldSceneGround(s, { chunks: [chunk] })).not.toThrow();
    chunk.permissions.tiles[(242 - 224) * 32 + (697 - 672)].flags |= 1;
    expect(() => validateFieldSceneGround(s, { chunks: [chunk] })).toThrow('697, 242');
    expect(() => validateFieldSceneGround(s, { chunks: [] })).toThrow('no loaded ground');
  });
  it('round trips independent sources through project autosave and rejects bad replacements atomically', () => {
    const project = makeEditProject(); storeFieldScene(project, scene());
    const restored = openProjectSession(structuredClone(createProjectDocument(project, false)));
    expect(restored.fieldScenes).toEqual(project.fieldScenes);
    const bad = scene(); bad.steps.pop(); expect(() => storeFieldScene(project, bad)).toThrow();
    expect(project.fieldScenes!.scenes[scene().id]).toEqual(scene());
    const second = scene(); second.id = 'second'; storeFieldScene(project, second);
    expect(Object.keys(project.fieldScenes!.scenes)).toHaveLength(2);
  });
  it('replaces owned launch triggers when opening an earlier native or field test ROM', () => {
    const origin = { gridX: 53, gridY: 1, gridZ: 730 }, original = compileBw2Script('preserve_layout\nscript :original, entry: 1 do\nhalt\nend').bytes;
    const native = appendCutsceneTestScript(original, 28);
    const empty = Uint8Array.of(4,0,0,0,0,0,0,0);
    const events = appendCutsceneTestTrigger(appendCutsceneTestTrigger(empty,1,origin),native.entryId,origin);
    const cleaned = removeNativeCutsceneTestTriggers(native.bytes,events,origin);
    expect(cleaned[7]).toBe(1); // The unowned user trigger is preserved.
    const compiled = compileFieldScene(scene(),true).compiled, field = appendFieldSceneScript(native.bytes,compiled), entries=gen5ScriptEntries(field.bytes);
    expect(field.bytes.slice(entries[2],entries[2]+FIELD_TEST_PREFIX.length)).toEqual(FIELD_TEST_PREFIX);
    const prior = appendCutsceneTestTrigger(empty,field.entryId,origin);
    expect(filterTestTriggers(prior,origin,id=>FIELD_TEST_PREFIX.every((n,i)=>field.bytes[entries[id-1]+i]===n))[7]).toBe(0);
    const backToNative=installCutsceneTestFixture(field.bytes,prior,27,origin);
    expect(backToNative.events[7]).toBe(1);
    expect(installCutsceneTestFixture(backToNative.scripts,backToNative.events,27,origin)).toEqual(backToNative);
    // A script edited outside this exact temporary native fixture remains untouched.
    native.bytes[gen5ScriptEntries(native.bytes)[1]+2]^=1;
    expect(removeNativeCutsceneTestTriggers(native.bytes,events,origin)[7]).toBe(2);
  });
});

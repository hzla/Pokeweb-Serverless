import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadNitroSdatFromProject, parseNitroSdat } from "../src/pokeweb/nitroSound";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { canRemoveStagedCodeInjectionDll, installBundledBgmToggleDll, readBgmRuntimeConfig } from "../src/pokeweb/pmcModel";
import { getStandaloneStreamConfigs } from "../src/pokeweb/projectStore";
import {
  appendStandaloneSdatStream,
  detectStreamedBgmStatus,
  encodeAdpcmStrm,
  installStreamedBgmInSdat,
  installStreamedBgm,
  installStandaloneStream,
  registerStandaloneTrainerSequence,
  removeLastStandaloneStream,
  removeFinalStandaloneSdatStream,
  removeStreamedBgm,
  removeStreamedBgmFromSdat,
  rebuildStreamedBgmMappings,
  sdatSequenceFileId,
  sdatStreamCount,
  sdatStreamFileId,
  STREAMED_BGM_SAMPLE_RATE,
  updateStreamedBgmRuntime,
} from "../src/pokeweb/streamedBgmModel";
import { assignTrainerEyeTheme, loadTrainerMusicModel } from "../src/pokeweb/trainerMusicModel";
import { assignTrainerBattleTheme, loadTrainerBattleMusicModel } from "../src/pokeweb/trainerBattleMusicModel";

globalThis.fetch = (async (input: RequestInfo | URL) => new Response(new Uint8Array(readFileSync(input instanceof URL ? input : new URL(input instanceof Request ? input.url : String(input)))))) as typeof fetch;
const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error("Pass one or more US Black / White / Black 2 / White 2 ROM paths.");

for (const path of paths) {
  const romBytes = readFileSync(path);
  const rom = new NintendoDSRom(romBytes, { fileData: "view" });
  if (!["IRBO", "IRAO", "IREO", "IRDO"].includes(rom.idCode)) throw new Error(`${path}: expected a US BW or BW2 ROM, found ${rom.idCode}.`);
  const namedSdatId = rom.filenames.idOf("swan_sound_data.sdat");
  const sdatId = namedSdatId ?? rom.files.findIndex((file) => file.length >= 4 && String.fromCharCode(...file.subarray(0, 4)) === "SDAT");
  if (sdatId < 0) throw new Error(`${path}: sound archive is missing.`);
  const original = rom.files[sdatId]!;
  const parsed = parseNitroSdat(original, path);
  const target = parsed.sequenceInfos.find((entry) => entry && entry.fileId !== 0xffff)?.id;
  if (target === undefined) throw new Error(`${path}: no usable sequence was found.`);
  const originalFileId = sdatSequenceFileId(original, target);
  const originalStreamCount = sdatStreamCount(original);
  const firstNativeStreamFileId = originalStreamCount ? sdatStreamFileId(original, 0) : undefined;
  const sampleCount = 2_000;
  const stream = encodeAdpcmStrm({
    sampleRate: STREAMED_BGM_SAMPLE_RATE,
    left: Float32Array.from({ length: sampleCount }, (_value, index) => Math.sin(index / 20) * 0.5),
    right: Float32Array.from({ length: sampleCount }, (_value, index) => Math.cos(index / 20) * 0.5),
  });
  const installed = installStreamedBgmInSdat(original, target, stream.bytes);
  const installedParsed = parseNitroSdat(installed.bytes, path);
  if (installedParsed.files.length !== parsed.files.length + 2) throw new Error(`${path}: appended file count is wrong.`);
  if (sdatStreamCount(installed.bytes) !== sdatStreamCount(original) + 1) throw new Error(`${path}: appended stream count is wrong.`);
  if (firstNativeStreamFileId !== undefined && sdatStreamFileId(installed.bytes, 0) !== firstNativeStreamFileId) throw new Error(`${path}: original stream 0 changed.`);
  if (sdatSequenceFileId(installed.bytes, target) !== installed.shadowFileId) throw new Error(`${path}: target sequence was not isolated.`);
  for (const file of parsed.files) {
    const rebuilt = installedParsed.files[file.id];
    if (!rebuilt || !Buffer.from(rebuilt.data).equals(Buffer.from(file.data))) throw new Error(`${path}: unrelated SDAT file ${file.id} changed.`);
  }
  for (const sequence of parsed.sequenceInfos) {
    if (!sequence || sequence.id === target) continue;
    if (installedParsed.sequenceInfos[sequence.id]?.fileId !== sequence.fileId) throw new Error(`${path}: unrelated sequence ${sequence.id} changed.`);
  }
  const restored = removeStreamedBgmFromSdat(installed.bytes, installed);
  if (sdatSequenceFileId(restored, target) !== originalFileId || sdatStreamCount(restored) !== sdatStreamCount(original)) {
    throw new Error(`${path}: uninstall did not restore the original references.`);
  }
  if (!Buffer.from(restored).equals(Buffer.from(original))) {
    const firstDifference = original.findIndex((byte, index) => byte !== restored[index]);
    throw new Error(`${path}: single replacement uninstall was not byte-exact (original ${original.length}, restored ${restored.length}, first difference 0x${firstDifference.toString(16)}).`);
  }
  console.log(`${rom.idCode}: verified ${parsed.sequenceInfos.length} sequences, ${parsed.files.length} files, ${stream.encoding} stream ${installed.streamId}, and byte-exact single uninstall.`);
  const standalone = appendStandaloneSdatStream(original, stream.bytes);
  if (standalone.streamId !== originalStreamCount) throw new Error(`${path}: standalone stream ID did not follow native streams.`);
  const removedStandalone = removeFinalStandaloneSdatStream(standalone.bytes, standalone.streamId, standalone.streamFileId);
  if (!Buffer.from(removedStandalone).equals(Buffer.from(original))) throw new Error(`${path}: standalone uninstall was not byte-exact.`);
  {
    const version = { IRBO: "B", IRAO: "W", IREO: "B2", IRDO: "W2" }[rom.idCode];
    const project = await loadProjectFromRomBytes(romBytes, `Verify-${version}.nds`, { selectedNarcs: [] });
    const pcm = {
      sampleRate: STREAMED_BGM_SAMPLE_RATE,
      left: Float32Array.from({ length: 2_000 }, (_, frame) => Math.sin(frame / 20) * 0.5),
      right: Float32Array.from({ length: 2_000 }, (_, frame) => Math.cos(frame / 20) * 0.5),
    };
    const installedTrack = await installStandaloneStream(project, {
      name: "Verification song", sourceName: "generated.wav", pcm, encoding: "adpcm", loop: true,
    });
    assert.equal(installedTrack.streamId, originalStreamCount);
    const before = await loadTrainerMusicModel(project);
    assert.equal(before.themes.find((theme) => theme.streamId === installedTrack.streamId)?.displayName, installedTrack.name);
    assert.ok((await loadTrainerBattleMusicModel(project, before.sdat)).themes.some((theme) => theme.streamId === installedTrack.streamId));
    const sequenceId = await registerStandaloneTrainerSequence(project, installedTrack.streamId);
    assert.equal(await registerStandaloneTrainerSequence(project, installedTrack.streamId), sequenceId);
    assert.equal(canRemoveStagedCodeInjectionDll(project, `patches/BgmToggle${version}.dll`), false);
    let music = await loadTrainerMusicModel(project);
    let battle = await loadTrainerBattleMusicModel(project, music.sdat);
    const battleKey = battle.classMusic ? "class-49" : "normal-fallback";
    const approachRow = music.assignments[49]!;
    const battleRow = battle.assignments.find((row) => row.key === battleKey)!;
    const oldApproach = approachRow.currentSequenceId!;
    const oldBattle = battleRow.currentSequenceId!;
    assignTrainerEyeTheme(project, music, approachRow, sequenceId);
    assignTrainerBattleTheme(project, battle, battleRow, sequenceId);
    await assert.rejects(() => removeLastStandaloneStream(project), /reassign/i);

    // Changing a replacement moves the alias SSEQ, while the upload and trainer IDs stay stable.
    await installStreamedBgm(project, { targetSequenceId: 1114, sourceName: "replacement.wav", pcm, shortcutEnabled: false });
    const linkedTargets = [1018, 1115];
    for (const targetSequenceId of linkedTargets) {
      await installStreamedBgm(project, { targetSequenceId, standaloneStreamId: installedTrack.streamId, shortcutEnabled: false });
    }
    const extra = await installStandaloneStream(project, {
      name: "Another song", sourceName: "generated.wav", pcm, encoding: "adpcm",
    });
    assert.equal(extra.streamId, installedTrack.streamId + 1);
    await removeLastStandaloneStream(project);
    await installBundledBgmToggleDll(project);
    await updateStreamedBgmRuntime(project);
    const bytes = await exportModifiedRom(project, { forDsi: false });
    const exported = new NintendoDSRom(bytes, { fileData: "view" });
    const dllId = exported.filenames.idOf(`patches/BgmToggle${version}.dll`)!;
    const alias = readBgmRuntimeConfig(exported.files[dllId])?.mappings?.find((entry) => entry.targetSequenceId === sequenceId);
    assert.equal(alias?.streamId, installedTrack.streamId);
    assert.equal(alias?.streamFileId, installedTrack.streamFileId);

    const reimported = await loadProjectFromRomBytes(bytes, `Verify-${version}-export.nds`, { selectedNarcs: [] });
    const reimportedMusic = await loadTrainerMusicModel(reimported);
    const reimportedBattle = await loadTrainerBattleMusicModel(reimported, reimportedMusic.sdat);
    assert.equal(sdatStreamCount(reimportedMusic.sdat.bytes), originalStreamCount + 2);
    assert.equal(getStandaloneStreamConfigs(reimported)[0]?.trainerSequenceId, sequenceId);
    const status = await detectStreamedBgmStatus(reimported);
    assert.ok(status.installed);
    assert.deepEqual(status.configs.filter((mapping) => mapping.standaloneStreamId === installedTrack.streamId)
      .map((mapping) => [mapping.targetSequenceId, mapping.streamFileId]), linkedTargets.map((target) => [target, installedTrack.streamFileId]));
    assert.equal(reimportedMusic.assignments[49]?.currentSequenceId, sequenceId);
    assert.equal(reimportedBattle.assignments.find((row) => row.key === battleKey)?.currentSequenceId, sequenceId);
    await assert.rejects(() => removeLastStandaloneStream(reimported), /reassign/i);
    await removeStreamedBgm(reimported, 1114);
    assert.equal(sdatStreamCount((await loadNitroSdatFromProject(reimported)).bytes), originalStreamCount + 1);

    for (const target of linkedTargets) await removeStreamedBgm(project, target);
    music = await loadTrainerMusicModel(project);
    battle = await loadTrainerBattleMusicModel(project, music.sdat);
    assignTrainerEyeTheme(project, music, music.assignments[49]!, oldApproach);
    await assert.rejects(() => removeLastStandaloneStream(project), /reassign/i);
    assignTrainerBattleTheme(project, battle, battle.assignments.find((row) => row.key === battleKey)!, oldBattle);
    await removeLastStandaloneStream(project);
    const final = await loadNitroSdatFromProject(project);
    assert.equal(final.sequenceInfos[sequenceId], undefined);
    assert.equal(sdatStreamCount(final.bytes), originalStreamCount + 1);
    console.log(`${rom.idCode}: shared BGM replacements, trainer music aliases, runtime updates, export/reimport, and assigned-song removal guards verified.`);
  }
  const targets = parsed.sequenceInfos.filter((entry) => entry && (entry.symbol ?? parsed.sequenceSymbols[entry.id])?.startsWith("SEQ_BGM_")).map((entry) => entry!.id);
  const many = rebuildStreamedBgmMappings(original, [], targets.map((targetSequenceId) => ({ targetSequenceId, bytes: stream.bytes })));
  const manyParsed = parseNitroSdat(many.bytes, path);
  for (const file of parsed.files) {
    if (!Buffer.from(manyParsed.files[file.id]!.data).equals(Buffer.from(file.data))) throw new Error(`${rom.idCode}: multi-install changed original file ${file.id}.`);
  }
  if (firstNativeStreamFileId !== undefined && sdatStreamFileId(many.bytes, 0) !== firstNativeStreamFileId) throw new Error(`${rom.idCode}: multi-install changed original stream 0.`);
  const survivors = targets.filter((_id, index) => index % 3 !== 1);
  const partial = rebuildStreamedBgmMappings(many.bytes, many.mappings, survivors.map((targetSequenceId) => ({ targetSequenceId, bytes: stream.bytes })));
  for (const id of targets) {
    const expected = partial.mappings.find((mapping) => mapping.targetSequenceId === id)?.shadowFileId ?? parsed.sequenceInfos[id]!.fileId;
    if (sdatSequenceFileId(partial.bytes, id) !== expected) throw new Error(`${rom.idCode}: partial removal lost target ${id}.`);
  }
  const fullyRestored = rebuildStreamedBgmMappings(partial.bytes, partial.mappings, []).bytes;
  if (!Buffer.from(fullyRestored).equals(Buffer.from(original))) throw new Error(`${rom.idCode}: multi-uninstall was not byte-exact.`);
  console.log(`${rom.idCode}: verified ${targets.length} simultaneous BGM mappings, partial removal to ${survivors.length}, standalone round-trip, and byte-exact uninstall (no emulator).`);
}

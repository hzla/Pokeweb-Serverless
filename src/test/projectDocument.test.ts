import { describe, expect, it, vi } from "vitest";
import { defaults as buttonDefaults } from "../cgearButtons/document";
import { newProject as newCustomUi } from "../customUi/document";
import { compileBw2Script } from "../pokeweb/bw2ScriptCompiler";
import { decompileBw2ProjectScript, replaceBw2ProjectScript, saveBw2ScriptDraft } from "../pokeweb/bw2ScriptModel";
import { createProjectDocument, readProjectDocument } from "../pokeweb/projectDocument";
import { openProjectSession, refreshProjectSessionIndexes } from "../pokeweb/projectSession";
import { getNarcFormats } from "../pokeweb/formats";
import { projectEditSession } from "../pokeweb/editSession";
import { getMoveRecord, updateMoveField } from "../pokeweb/moveItemModel";
import { undoActionChange } from "../pokeweb/actionUndo";
import { makeEditProject } from "./fixtures/editProject";
import type { BaseRom, BaseVersion } from "../pokeweb/constants";

describe("project document and editing session boundary", () => {
  it("retains applied System Shops and pending drafts through autosave documents",()=>{
    const project=makeEditProject();
    project.systemShops={document:{version:1,nextId:2,shops:[{id:1,name:'TM Shop',currency:93,inventory:[{item:328,cost:9}]}]},applied:{version:1,nextId:2,shops:[{id:1,name:'TM Shop',currency:93,inventory:[{item:328,cost:1}]}]}};
    const session=openProjectSession(structuredClone(createProjectDocument(project,false)));
    expect(session.systemShops).toEqual(project.systemShops);
    expect(session.systemShops!.document.shops[0].inventory[0].cost).toBe(9);
    expect(session.systemShops!.applied!.shops[0].inventory[0].cost).toBe(1);
  });
  it("excludes runtime fields at the root and within archives before serialization", () => {
    const project = makeEditProject();
    getMoveRecord(project, 1);
    project.originalRomBytes = new Uint8Array(1024 * 1024);
    project.bw2ScriptRuntimeContext = { fieldRamAddress: 0, fieldBytes: new Uint8Array(1024 * 1024), overlays: {} };
    project.texts.messageTexts = [[['0_0', 'Decoded text', 0]]];
    project.narcs.moves!.revision = 42;
    project.narcs.moves!.parseError = "session diagnostic";
    Object.assign(project, { futureRuntimeCache: new Uint8Array(1024 * 1024) });
    const clone = vi.spyOn(globalThis, "structuredClone").mockImplementation(() => { throw new Error("Unexpected clone"); });
    const slice = vi.spyOn(Uint8Array.prototype, "slice");
    try {
      const document = createProjectDocument(project, true);
      expect(document.format).toBe("pokeweb.project");
      expect(document.version).toBe(1);
      for (const key of ["originalRomBytes", "bw2ScriptRuntimeContext", "formats", "trpokInfo", "headers", "grottoOdds", "futureRuntimeCache", "session"])
        expect(document).not.toHaveProperty(key);
      for (const key of ["records", "revision", "parseError"]) expect(document.narcs.moves).not.toHaveProperty(key);
      expect(document.texts).not.toHaveProperty("messageTexts");
      expect(document.recovery).toBeUndefined();
      expect(clone).not.toHaveBeenCalled();
      expect(slice).not.toHaveBeenCalled();
    } finally { clone.mockRestore(); slice.mockRestore(); }
  });

  it("takes ownership of document buffers with fresh caches and commit state", () => {
    const project = makeEditProject();
    updateMoveField(project, 1, "power", "90");
    const document = structuredClone(createProjectDocument(project, false));
    const clone = vi.spyOn(globalThis, "structuredClone");
    const slice = vi.spyOn(Uint8Array.prototype, "slice");
    try {
      const session = openProjectSession(document);
      expect(session).not.toHaveProperty("document");
      expect(session.arm9).toBe(document.arm9);
      expect(session.narcs.moves!.rawFiles).toBe(document.narcs.moves!.rawFiles);
      expect(session.narcs.moves!.records.size).toBe(0);
      expect(session.narcs.moves!.revision).toBeUndefined();
      expect(projectEditSession(session).revision).toBe(0);
      expect(clone).not.toHaveBeenCalled(); expect(slice).not.toHaveBeenCalled();
      expect(getMoveRecord(session, 1).raw.power).toBe(90);
      const listener = vi.fn(); projectEditSession(session).subscribe(listener);
      updateMoveField(project, 1, "power", "91");
      expect(listener).not.toHaveBeenCalled();
    } finally { clone.mockRestore(); slice.mockRestore(); }
  });

  it("shares missing-source placeholders across large archives while preserving intentionally empty edits", () => {
    const project = makeEditProject();
    const emptyEdit = new Uint8Array();
    project.narcs.pokemon_sprites = { name: "pokemon_sprites", fileId: 8, sourcePath: "sprites", fileCount: 4096,
      rawFiles: Array.from({ length: 4096 }, () => Uint8Array.of(1)), records: new Map(), dirty: new Set([1]) };
    project.narcs.pokemon_sprites.rawFiles[1] = emptyEdit;
    const document = createProjectDocument(project, true), files = document.narcs.pokemon_sprites!.rawFiles;
    expect(new Set(files.filter((_file, id) => id !== 1)).size).toBe(1);
    expect(files[1]).toBe(emptyEdit);
    expect(files[1]).not.toBe(files[0]);
    const stored = structuredClone(document);
    expect(stored.narcs.pokemon_sprites!.rawFiles[0]).toBe(stored.narcs.pokemon_sprites!.rawFiles[4095]);
    expect(stored.narcs.pokemon_sprites!.dirty.has(1)).toBe(true);
  });

  it("detaches legacy ROM-backed animation caches even without a source store", () => {
    const project = makeEditProject(), backing = new Uint8Array(2 * 1024 * 1024);
    const source = backing.subarray(256, 320); source.fill(7);
    project.w2animAnimations = { fileId: 7, sourceBytes: source, editorOriginals: {}, editorTargets: {} };
    const session = openProjectSession(readProjectDocument(project).document);
    expect(session.w2animAnimations!.sourceBytes).toEqual(source);
    expect(session.w2animAnimations!.sourceBytes.buffer.byteLength).toBe(64);
    expect(session.w2animAnimations!.sourceBytes.buffer).not.toBe(backing.buffer);
    source.fill(1);
    expect(session.w2animAnimations!.sourceBytes.every(value => value === 7)).toBe(true);
  });

  it("materializes edits before dropping decoded dictionaries and preserves existing undo", () => {
    const project = makeEditProject();
    updateMoveField(project, 1, "power", "90");
    const session = openProjectSession(structuredClone(createProjectDocument(project, false)));
    expect(getMoveRecord(session, 1).raw.power).toBe(90);
    const entry = session.actionChangelog!.entries.at(-1)!;
    undoActionChange(session, entry);
    expect(getMoveRecord(session, 1).raw.power).toBe(40);
    expect(projectEditSession(session).revision).toBe(1);
  });

  it("migrates a legacy live-shaped save while preserving authored fields and source identity", () => {
    const legacy = makeEditProject();
    legacy.originalRomBytes = Uint8Array.of(1, 2, 3);
    updateMoveField(legacy, 1, "power", "90");
    const read = readProjectDocument(legacy);
    expect(read.originalRomBytes).toBe(legacy.originalRomBytes);
    expect(read.document.settings).toBe(legacy.session);
    expect(read.document).not.toHaveProperty("originalRomBytes");
    const session = openProjectSession(read.document);
    expect(getMoveRecord(session, 1).raw.power).toBe(90);
    expect(session.narcs.moves!.dirty.has(1)).toBe(true);
    expect(session.actionChangelog).toEqual(legacy.actionChangelog);
  });

  it.each([["BW", "B"], ["BW2", "W2"], ["DP", "D"], ["Pt", "Pt"], ["HGSS", "HG"]] as const)
    ("rebuilds %s formats and trainer metadata without caching all trainers", (baseRom: BaseRom, baseVersion: BaseVersion) => {
      const project = makeEditProject();
      project.session.baseRom = baseRom; project.session.baseVersion = baseVersion;
      project.formats = getNarcFormats(baseRom);
      project.narcs.trdata = { name: "trdata", fileId: 6, sourcePath: "trainers", fileCount: 2,
        rawFiles: [Uint8Array.of(3, 1, 0, 6), Uint8Array.of(1, 1, 0, 2)], records: new Map(), dirty: new Set() };
      const session = openProjectSession(createProjectDocument(project, false));
      expect(session.formats).toEqual(getNarcFormats(baseRom));
      expect(session.trpokInfo).toEqual([{ template: 3, numPokemon: 6 }, { template: 1, numPokemon: 2 }]);
      expect(session.narcs.trdata!.records.size).toBe(0);
      session.narcs.trdata!.records.set(0, { id: 0, bytes: session.narcs.trdata!.rawFiles[0], raw: { template: 1, num_pokemon: 4 } });
      refreshProjectSessionIndexes(session);
      expect(session.trpokInfo[0]).toEqual({ template: 1, numPokemon: 4 });
    });

  it("persists authored documentation and TM state while rebuilding generated labels and indexes", () => {
    const project = makeEditProject();
    project.tms = { offset: 8, byteLength: 2, raw: { tm_1: 1 }, readable: { tm_1: "stale cache" }, dirty: true };
    project.docs = { romTitle: "My ROM", mastersheetMarkdown: "my notes", mastersheetHighlights: { changed: { 1: 2 } },
      trainerLocations: { 1: ["generated"] }, trainerDiffs: { 1: 2 }, itemLocations: { 1: ["generated"] }, groundItemScriptMap: { 1: 2 } };
    const document = createProjectDocument(project, true);
    expect(document.tms).not.toHaveProperty("readable");
    expect(document.docs).not.toHaveProperty("trainerLocations");
    const session = openProjectSession(document);
    expect(session.tms!.raw.tm_1).toBe(1); expect(session.tms!.dirty).toBe(true);
    expect(session.tms!.readable.tm_1).toBe("Tackle");
    expect(session.docs!.romTitle).toBe("My ROM"); expect(session.docs!.mastersheetMarkdown).toBe("my notes");
    expect(session.docs!.mastersheetHighlights).toEqual({ changed: { 1: 2 } });
    expect(session.docs!.trainerLocations).toEqual({});
  });

  it("retains source-dependent recovery data only when a matching source is unavailable", () => {
    const project = makeEditProject();
    project.bw2ScriptRuntimeContext = { fieldRamAddress: 0, fieldBytes: Uint8Array.of(1), overlays: {} };
    project.koMoveLearnsetSource = { fileId: 8, bytes: Uint8Array.of(2) };
    project.trainerLocationTables = { stadium: { fileId: 9, bytes: Uint8Array.of(3) } };
    project.cascadePersonalSources = { marker: { fileId: 10, bytes: Uint8Array.of(4) } };
    expect(createProjectDocument(project, true).recovery).toBeUndefined();
    const document = createProjectDocument(project, false), session = openProjectSession(document);
    expect(session.bw2ScriptRuntimeContext).toBe(project.bw2ScriptRuntimeContext);
    expect(session.koMoveLearnsetSource).toBe(project.koMoveLearnsetSource);
    expect(session.trainerLocationTables).toBe(project.trainerLocationTables);
    expect(session.cascadePersonalSources).toBe(project.cascadePersonalSources);
  });

  it("keeps unapplied custom UI and C-Gear work", () => {
    const project = makeEditProject();
    project.customUi = newCustomUi(); project.customUi.files["image.bin"] = Uint8Array.of(1, 2);
    project.cgearButtons = { document: buttonDefaults(), applied: buttonDefaults(), enabled: true };
    project.cgearButtons.document.buttons[0].label = "Unapplied";
    const session = openProjectSession(structuredClone(createProjectDocument(project, true)));
    expect(session.customUi).toEqual(project.customUi);
    expect(session.cgearButtons).toEqual(project.cgearButtons);
    expect(session.cgearButtons!.document).not.toEqual(session.cgearButtons!.applied);
  });

  it("retains script drafts and verification baselines across saves, then safely applies edited source", () => {
    const project = makeEditProject();
    const bytes = compileBw2Script("script :main, entry: 1 do\n  nop\nend\n").bytes;
    project.narcs.scripts = { name: "scripts", fileId: 7, sourcePath: "scripts", fileCount: 1,
      rawFiles: [bytes], dirty: new Set(), records: new Map() };
    const imported = decompileBw2ProjectScript(project, 0, { overlayId: undefined });
    const edited = imported.source.replace("  nop", "  face_player\n  nop");
    saveBw2ScriptDraft(project, 0, edited);
    project.bw2ScriptEditor!.drafts[0].entryMapping = [0];
    project.bw2ScriptEditor!.drafts[0].entryMappingSignature = "pending mapping";
    const document = structuredClone(createProjectDocument(project, false));
    expect(document).not.toHaveProperty("bw2ScriptEditor");
    const session = openProjectSession(document);
    expect(session.bw2ScriptEditor!.selectedFileId).toBeUndefined();
    expect(session.bw2ScriptEditor!.drafts).toEqual(project.bw2ScriptEditor!.drafts);
    expect(session.narcs.scripts!.dirty.size).toBe(0);
    expect(replaceBw2ProjectScript(session, 0, edited).roundTrip?.verified).toBe(true);
    expect(session.narcs.scripts!.dirty.has(0)).toBe(true);
  });

  it("rejects unknown versions and malformed documents before opening a session", () => {
    const document = createProjectDocument(makeEditProject(), false);
    expect(() => readProjectDocument({ ...document, version: 99 })).toThrow(/version 99/);
    expect(() => readProjectDocument({ ...document, format: "unknown" })).toThrow(/unrecognized/);
    expect(() => readProjectDocument({ ...document, arm9: undefined })).toThrow(/incomplete/);
  });
});

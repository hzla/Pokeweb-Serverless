import { describe, expect, it } from "vitest";
import { findMapFolderImports, resolveMapFolderImport, type MapImportFile } from "../pokeweb/gen5MapImportFolder";
import { mapBin, mapModel, mapPermissions, mapTextures } from "./fixtures/gen5MapImport";
import { nitroBlocks, writeNitroFile } from "../pokeweb/nitroResourceWriter";
const file = (path: string, bytes: Uint8Array = new Uint8Array()): MapImportFile => ({ name: path.split("/").at(-1)!, webkitRelativePath: path, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer });
const model = () => writeNitroFile(mapModel(), [...nitroBlocks(mapModel()), ...nitroBlocks(mapTextures())]);
const metadata = (game: number) => new TextEncoder().encode(`gameindex\r\n${game}\r\ntileset\r\nSample.pdsts\r\n`);
describe("native map folder import", () => {
  it("finds the PDSMS model, both collision layers and game while ignoring source assets", async () => {
    const files = [file("hamesmap/Sample.nsbmd", model()), file("hamesmap/Sample_00_00.per", mapPermissions()), file("hamesmap/Sample2_00_00.per", mapPermissions()), file("hamesmap/Sample.pdsmap", metadata(7)), file("hamesmap/unused.png"), file("hamesmap/Sample.imd"), file("hamesmap/Sample_00_00.bdhc")];
    const choices = await findMapFolderImports(files); expect(choices).toHaveLength(1);
    const result = await resolveMapFolderImport(choices[0], files);
    expect(result.game).toBe("BW2"); expect(result.embeddedTextures).toBe(true); expect(result.files.model?.name).toBe("Sample.nsbmd");
    expect(result.files.permissions?.name).toBe("Sample_00_00.per"); expect(result.files.secondaryPermissions?.name).toBe("Sample2_00_00.per"); expect(result.files.textures).toBeUndefined(); expect(result.notes).toEqual([]);
  });
  it("distinguishes several chunks and never takes another chunk's secondary layer", async () => {
    const files = [file("Sample.nsbmd", model()), ...["Sample_00_00.per", "Sample_01_00.per", "Sample2_01_00.per"].map(p => file(p, mapPermissions()))];
    const choices = await findMapFolderImports(files); expect(choices).toHaveLength(2);
    const first = await resolveMapFolderImport(choices[0], files), second = await resolveMapFolderImport(choices[1], files);
    expect(first.files.secondaryPermissions).toBeUndefined(); expect(first.removeSecond).toBe(true); expect(second.files.secondaryPermissions?.name).toBe("Sample2_01_00.per");
  });
  it("matches coordinate-named models and shared texture banks", async () => {
    const files = [file("Town_01_02.nsbmd", mapModel()), file("Town_01_02.per", mapPermissions()), file("Town2_01_02.per", mapPermissions()), file("Town.nsbtx", mapTextures())];
    const result = await resolveMapFolderImport((await findMapFolderImports(files))[0], files);
    expect(result.files.textures?.name).toBe("Town.nsbtx"); expect(result.files.secondaryPermissions?.name).toBe("Town2_01_02.per");
  });
  it("keeps nested exports separate even when basenames repeat", async () => {
    const files = ["a", "b"].flatMap(d => [file(`${d}/Sample.nsbmd`, model()), file(`${d}/Sample.per`, mapPermissions())]);
    const choices = await findMapFolderImports(files); expect(choices).toHaveLength(2);
    expect(choices[0].files.permissions?.webkitRelativePath).toBe("a/Sample.per"); expect(choices[1].files.permissions?.webkitRelativePath).toBe("b/Sample.per");
  });
  it("does not guess among unrelated collision or texture files", async () => {
    const files = [file("Sample.nsbmd", mapModel()), file("a.per"), file("b.per"), file("a.nsbtx"), file("b.nsbtx")];
    const result = await resolveMapFolderImport((await findMapFolderImports(files))[0], files);
    expect(result.files.permissions).toBeUndefined(); expect(result.files.textures).toBeUndefined(); expect(result.notes).toHaveLength(2);
  });
  it("uses embedded textures instead of an unrelated texture file", async () => {
    const files = [file("Sample.nsbmd", model()), file("other.nsbtx")];
    expect((await resolveMapFolderImport((await findMapFolderImports(files))[0], files)).files.textures).toBeUndefined();
  });
  it("discovers Gen 5 BINs and ignores Gen 4 BIN exports and metadata files", async () => {
    const files = [file("map.bin", mapBin()), file("gen4.bin", new Uint8Array(16)), file(".__map.nsbmd"), file("__MACOSX/map.nsbmd")];
    expect((await findMapFolderImports(files)).map(c => c.files.bin?.name)).toEqual(["map.bin"]);
  });
  it("rejects Gen 4 project metadata before assigning the selected export", async () => {
    const files = [file("Sample.nsbmd", model()), file("Sample.pdsmap", metadata(3))];
    await expect(resolveMapFolderImport((await findMapFolderImports(files))[0], files)).rejects.toThrow("Gen 4");
  });
  it("does not load unrelated images or every model while discovering a folder", async () => {
    const never = { ...file("a.nsbmd"), arrayBuffer: async () => { throw new Error("Read too soon"); } };
    expect(await findMapFolderImports([never, { ...never, name: "b.nsbmd", webkitRelativePath: "b.nsbmd" }])).toHaveLength(2);
  });
  it("rejects ambiguous case collisions and authoring-only folders", async () => {
    await expect(findMapFolderImports([file("a.nsbmd"), file("A.nsbmd")])).rejects.toThrow("duplicate");
    await expect(findMapFolderImports([file("Sample.pdsmap")])).rejects.toThrow("native Gen 5");
  });
});

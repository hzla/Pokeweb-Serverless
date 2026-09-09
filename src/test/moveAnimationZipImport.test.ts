import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { writeU16, writeU32 } from "../nds/binary";
import { compileMoveAnimation } from "../pokeweb/moveAnimationModel";
import type { ProjectState } from "../pokeweb/projectStore";
import {
  generateImportedMoveAnimationAssets,
  inspectMoveAnimationZip,
  writeMoveAnimationZipWorkspace,
} from "../../scripts/lib/move-animation-zip-import";

describe("move animation zip importer", () => {
  it("scaffolds and regenerates a byte-exact animation with multiple SPAs", async () => {
    const script = [
      "LoadSPA 829",
      "LoadSPA 830",
      "Emit 829, 0, DEFENDER, NONE, 0, 0, 0, 1x, 1x, 1x, 1x",
      "Emit 830, 0, DEFENDER, NONE, 0, 0, 0, 1x, 1x, 1x, 1x",
      "TerminateMoveScript",
    ].join("\n");
    const animation = compileMoveAnimation({} as ProjectState, 914, script);
    const spa829 = makeSyntheticSpa(0x001f);
    const spa830 = makeSyntheticSpa(0x7c00);
    const zip = zipSync({
      "bundle/move_914_animation.bin": animation,
      "bundle/spa_829.spa": spa829,
      "bundle/spa_830.spa": spa830,
      "bundle/notes.md": new TextEncoder().encode("inert notes"),
    });

    const bundle = inspectMoveAnimationZip(zip, 914);

    expect(bundle.moveId).toBe(914);
    expect(bundle.loadSpas).toEqual([829, 830]);
    expect(bundle.spas.map((spa) => spa.id)).toEqual([829, 830]);
    expect(bundle.ignoredEntries).toEqual(["bundle/notes.md"]);

    const root = await mkdtemp(path.join(os.tmpdir(), "moveanim-zip-"));
    const outDir = path.join(root, "alluring-voice");
    const manifestPath = await writeMoveAnimationZipWorkspace({
      bundle,
      outDir,
      slug: "alluring-voice",
      sourceArchiveName: "/private/path/AlluringVoice.zip",
      sourceArchiveSha256: "archive-hash",
      generatorImportPath: "../../Pokeweb-Serverless/scripts/lib/move-animation-zip-import",
    });
    await generateImportedMoveAnimationAssets(outDir);

    const generatedScript = await readFile(path.join(outDir, "generated/5_00000914_alluring_voice.s"), "utf8");
    const generatedSpa829 = new Uint8Array(await readFile(path.join(outDir, "generated/6_00000829.bin")));
    const generatedSpa830 = new Uint8Array(await readFile(path.join(outDir, "generated/6_00000830.bin")));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { reservedSpaIds: number[] };
    const metadata = await readFile(path.join(outDir, "import.json"), "utf8");

    expect(compileMoveAnimation({} as ProjectState, 914, generatedScript)).toEqual(animation);
    expect(generatedSpa829).toEqual(spa829);
    expect(generatedSpa830).toEqual(spa830);
    expect(manifest.reservedSpaIds).toEqual([829, 830]);
    expect(metadata).toContain('"name": "AlluringVoice.zip"');
    expect(metadata).not.toContain("/private/path");
  });

  it("rejects missing and unused SPA files", () => {
    const needsSpa = compileMoveAnimation({} as ProjectState, 900, "LoadSPA 900\nTerminateMoveScript");
    expect(() => inspectMoveAnimationZip(zipSync({ "move_900_animation.bin": needsSpa }))).toThrow(/missing referenced SPA/u);

    const noSpa = compileMoveAnimation({} as ProjectState, 900, "TerminateMoveScript");
    expect(() => inspectMoveAnimationZip(zipSync({
      "move_900_animation.bin": noSpa,
      "spa_900.spa": makeSyntheticSpa(0x001f),
    }))).toThrow(/not loaded by the script/u);
  });

  it("cross-checks an explicitly requested move ID", () => {
    const animation = compileMoveAnimation({} as ProjectState, 914, "TerminateMoveScript");
    const zip = zipSync({ "move_914_animation.bin": animation });

    expect(() => inspectMoveAnimationZip(zip, 895)).toThrow(/filename identifies move 914/u);
  });
});

function makeSyntheticSpa(color: number): Uint8Array {
  const out = new Uint8Array(32 + 88 + 32 + 16 + 8);
  writeU32(out, 0, 0x53504120);
  writeU32(out, 4, 0x315f3231);
  writeU16(out, 8, 1);
  writeU16(out, 10, 1);
  writeU32(out, 16, 88);
  writeU32(out, 20, 56);
  writeU32(out, 24, 32 + 88);

  const resource = 32;
  writeU32(out, resource, 1 << 14);
  writeU32(out, resource + 16, 2 * 4096);
  writeU16(out, resource + 34, color);
  writeU32(out, resource + 44, 4096);
  writeU16(out, resource + 60, 30);
  writeU16(out, resource + 62, 45);
  writeU32(out, resource + 68, 0xff00);

  const texture = 32 + 88;
  writeU32(out, texture, 0x53505420);
  writeU32(out, texture + 4, 2 | (1 << 16));
  writeU32(out, texture + 8, 16);
  writeU32(out, texture + 12, 48);
  writeU32(out, texture + 16, 8);
  writeU32(out, texture + 20, 56);
  writeU32(out, texture + 24, 0);
  writeU32(out, texture + 28, 56);
  out.fill(0x55, texture + 32, texture + 48);
  writeU16(out, texture + 48, 0x0000);
  writeU16(out, texture + 50, 0x001f);
  writeU16(out, texture + 52, 0x03e0);
  writeU16(out, texture + 54, 0x7c00);
  return out;
}

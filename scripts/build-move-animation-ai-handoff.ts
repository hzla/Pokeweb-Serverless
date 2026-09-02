import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";

type BundleFile = {
  source: string;
  target: string;
  category: string;
};

type BundleManifestFile = {
  path: string;
  category: string;
  bytes: number;
  sha256: string;
};

const ROOT_DOCS = [
  "docs/move-animation-fresh-chat-prompt.md",
  "docs/move-animation-tooling-improvements.md",
  "docs/move-animation-workflow-review.md",
];

const POKEWEB_DOCS = [
  "docs/ai-move-animation-workflows.md",
  "docs/spa-editing-reference.md",
  "docs/move-animation-editor/README.md",
  "docs/move-animation-editor/ai-agent-orientation.md",
  "docs/move-animation-editor/command-reference.md",
  "docs/move-animation-editor/script-vs-spa.md",
  "docs/move-animation-editor/spa-particle-reference.md",
  "docs/move-animation-editor/workflow-guides.md",
];

const POKEWEB_TOOLS = [
  "package.json",
  "package-lock.json",
  "scripts/enable-test-battle-move-animations.ts",
  "scripts/generate-white2upgrade-gen6-animation-bundle.ts",
  "scripts/move-animation-helper.ts",
  "scripts/move-animation-index.ts",
  "scripts/move-animation-workflow.ts",
  "scripts/verify-move-expansion-install.ts",
  "src/assets/data/B2W2_MOVSCRCMD.s",
  "src/assets/data/moveAnimationCommandDocs.json",
  "src/assets/data/vanilla_moves.txt",
  "src/pokeweb/battleCameraSimulator.ts",
  "src/pokeweb/gen5BattleSceneLayout.ts",
  "src/pokeweb/gen5BattleSpriteSimulator.ts",
  "src/pokeweb/moveAnimationBattleEnvironment.ts",
  "src/pokeweb/moveAnimationCommandNames.ts",
  "src/pokeweb/moveAnimationCommandSummary.ts",
  "src/pokeweb/moveAnimationDiagnostics.ts",
  "src/pokeweb/moveAnimationDocumentation.ts",
  "src/pokeweb/moveAnimationModel.ts",
  "src/pokeweb/moveAnimationParamSemantics.ts",
  "src/pokeweb/moveAnimationPreviewModel.ts",
  "src/pokeweb/nitroSpa.ts",
  "src/pokeweb/splEmitterSimulator.ts",
  "src/test/moveAnimationCodeEditor.test.ts",
  "src/test/moveAnimationCommandSummary.test.ts",
  "src/test/moveAnimationDiagnostics.test.ts",
  "src/test/moveAnimationDocumentation.test.ts",
  "src/test/moveAnimationModel.test.ts",
  "src/test/moveAnimationPreviewModel.test.ts",
];

const REFERENCE_INDEX = [
  "move-animation-reference/background-reference.json",
  "move-animation-reference/move-animation-reference.json",
  "move-animation-reference/move-animation-reference.md",
  "move-animation-reference/spa-reference.json",
];

const W2U_FILES = [
  "BUILD_ROM.md",
  "docs/moveanimation-spanotes.md",
  "docs/pokeweb-migration-build.md",
  "docs/spa-editing-reference.md",
  "data/graphics/meson.build",
  "data/graphics/move_animations/README.md",
  "data/graphics/move_spas/README.md",
  "src/pokeweb_gameplay/meson.build",
  "src/pokeweb_gameplay/w2u_move_animation_hooks.s",
  "tools/import_move_animations_from_rom.py",
];

const SWAN_FILES = [
  "lib/gflib/include/particle.h",
  "lib/gflib/include/spl.h",
  "lib/gflib/include/spl_emitter.h",
  "lib/gflib/include/spl_field.h",
  "lib/gflib/include/spl_list.h",
  "lib/gflib/include/spl_manager.h",
  "lib/gflib/include/spl_particle.h",
  "lib/gflib/include/spl_random.h",
  "lib/gflib/include/spl_resource.h",
  "lib/gflib/include/spl_texture.h",
  "lib/gflib/include/spl_version.h",
  "prog/include/particle/wazaeffect/spa.naix",
  "prog/include/system/vm.h",
  "prog/include/system/vm_cmd.h",
  "prog/include/wazaeffect/waza_eff_gra.naix",
  "prog/src/battle/btlv/btlv_effect.c",
  "prog/src/battle/btlv/btlv_effect.h",
  "prog/src/battle/btlv/btlv_effect_def.h",
  "prog/src/battle/btlv/btlv_efftool.c",
  "prog/src/battle/btlv/btlv_efftool.h",
  "prog/src/battle/btlv/btlv_effvm.c",
  "prog/src/battle/btlv/btlv_effvm.h",
  "prog/src/battle/btlv/btlv_effvm_dat.h",
  "prog/src/battle/btlv/btlv_effvm_def.h",
  "prog/src/system/vm.c",
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pokewebRoot = path.resolve(option(args, "pokeweb") ?? path.resolve(import.meta.dirname, ".."));
  const workspaceRoot = path.resolve(option(args, "workspace") ?? path.resolve(pokewebRoot, ".."));
  const buildRepo = path.resolve(
    option(args, "build-repo") ?? path.resolve(workspaceRoot, "../White2Upgrade-Original-pokeweb"),
  );
  const swanExport = path.resolve(option(args, "swan-export") ?? path.join(workspaceRoot, "reference_repos/swan_export"));
  const outputDir = path.resolve(option(args, "out") ?? path.join(workspaceRoot, "output/move-animation-ai-handoff"));
  assertSafeOutput(outputDir, workspaceRoot);

  const descriptors: BundleFile[] = [
    ...handoffDocs(pokewebRoot),
    ...ROOT_DOCS.map((file) => mapped(workspaceRoot, file, `snapshot/${file}`, "workflow-docs")),
    ...POKEWEB_DOCS.map((file) => mapped(pokewebRoot, file, `snapshot/Pokeweb-Serverless/${file}`, "pokeweb-docs")),
    ...POKEWEB_TOOLS.map((file) => mapped(pokewebRoot, file, `snapshot/Pokeweb-Serverless/${file}`, "pokeweb-tooling")),
    ...REFERENCE_INDEX.map((file) => mapped(pokewebRoot, file, `snapshot/Pokeweb-Serverless/${file}`, "donor-index")),
    mapped(
      workspaceRoot,
      "moveanimationdocs/Move Animation Preview Reference.md",
      "snapshot/moveanimationdocs/Move Animation Preview Reference.md",
      "legacy-reference",
    ),
    ...W2U_FILES.map((file) => mapped(buildRepo, file, `snapshot/White2Upgrade/${file}`, "white2upgrade")),
    ...SWAN_FILES.map((file) => mapped(swanExport, file, `snapshot/swan-export/${file}`, "swan-excerpt")),
  ];

  const entries: Record<string, Uint8Array> = {};
  const manifestFiles: BundleManifestFile[] = [];
  for (const descriptor of descriptors.sort((left, right) => left.target.localeCompare(right.target))) {
    const sourceBytes = new Uint8Array(await readRequired(descriptor.source, descriptor.target));
    const bytes = sanitizePortablePaths(sourceBytes, descriptor.target);
    entries[descriptor.target] = bytes;
    manifestFiles.push({
      path: descriptor.target,
      category: descriptor.category,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }

  const manifest = {
    format: "pokeweb-ai-move-animation-handoff",
    version: 1,
    notes: [
      "This archive contains no ROMs, generated move binaries, or move-specific workspaces.",
      "Files under snapshot preserve workspace-relative paths and require the full repositories to run.",
      "The Swan excerpt is source-reading context and is not a standalone build.",
    ],
    files: manifestFiles,
  };
  entries["manifest.json"] = encode(`${JSON.stringify(manifest, null, 2)}\n`);
  entries["FILES.sha256"] = encode(
    `${manifestFiles.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
  );

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const [target, bytes] of Object.entries(entries)) {
    const outputPath = path.join(outputDir, target);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }

  const zipPath = `${outputDir}.zip`;
  await writeFile(zipPath, zipSync(entries, { level: 9, mtime: new Date("1980-01-02T00:00:00Z") }));
  const totalBytes = manifestFiles.reduce((sum, file) => sum + file.bytes, 0);
  console.log(`Wrote ${manifestFiles.length} source files (${formatBytes(totalBytes)}) to ${outputDir}`);
  console.log(`Wrote archive to ${zipPath}`);
}

function handoffDocs(pokewebRoot: string): BundleFile[] {
  const root = path.join(pokewebRoot, "docs/move-animation-ai-handoff");
  return ["README.md", "CONTENTS.md", "REFERENCE_REPOSITORIES.md"].map((file) =>
    mapped(root, file, file, "bundle-guide"),
  );
}

function mapped(root: string, source: string, target: string, category: string): BundleFile {
  return { source: path.join(root, source), target: target.replaceAll(path.sep, "/"), category };
}

async function readRequired(source: string, target: string): Promise<Buffer> {
  try {
    return await readFile(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot include ${target}; expected source ${source}: ${detail}`);
  }
}

function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) throw new Error(`Unexpected argument: ${token ?? ""}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
    args.set(token.slice(2), value);
    index += 1;
  }
  return args;
}

function option(args: Map<string, string>, name: string): string | undefined {
  return args.get(name);
}

function assertSafeOutput(outputDir: string, workspaceRoot: string): void {
  const root = path.parse(outputDir).root;
  if (outputDir === root || outputDir === workspaceRoot) {
    throw new Error(`Refusing unsafe output directory: ${outputDir}`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sanitizePortablePaths(bytes: Uint8Array, target: string): Uint8Array {
  if (!target.endsWith(".md")) return bytes;
  let text = new TextDecoder().decode(bytes);
  text = text
    .replace(/\/Users\/[^/\s`"']+\/Repos\/White2Upgrade-Original-pokeweb/gu, "/path/to/White2Upgrade-build")
    .replace(/\/Users\/[^/\s`"']+\/Repos\/Port-Pokeweb/gu, "/path/to/Port-Pokeweb")
    .replace(/\/Users\/[^/\s`"']+\/Repos\/White2Upgrade\.nds/gu, "/path/to/White2Upgrade.nds")
    .replace(/\/Users\/[^/\s`"']+\/Downloads\/anchor\.png/gu, "/path/to/anchor.png")
    .replace(/\/Users\/[^/\s`"']+/gu, "/path/to/user")
    .replace(/\/opt\/homebrew\/Cellar\/openjdk@[^/\s`"']+\/[^/\s`"']+\/bin\/java/gu, "/path/to/java")
    .replace(/https:\/\/github\.com\/[^/\s`"']+\/Pokeweb-Serverless\.git/gu, "https://github.com/PROJECT_OWNER/Pokeweb-Serverless.git");
  return encode(text);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

await main();

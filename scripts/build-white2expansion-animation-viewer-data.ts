import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { NARC } from "../src/nds/narc";
import { NintendoDSRom } from "../src/nds/rom";
import { readAscii } from "../src/nds/binary";
import { parseBattleBackgroundVariants } from "../src/pokeweb/battleBackgroundModel";
import { staticSpritePngBytes } from "../src/pokeweb/gen6SpritePipeline";
import {
  MOVE_PREVIEW_BACKGROUND_INDEX,
  MOVE_PREVIEW_PLATFORM_INDEX,
  selectMovePreviewBattleVariant,
} from "../src/pokeweb/moveAnimationBattleEnvironment";
import { parseBattlePlatformVariants } from "../src/pokeweb/battlePlatformModel";
import { parsePwanArchiveBytes, PWAN_ARCHIVE_PATH, pwanAssetIndex } from "../src/pokeweb/pwanAnimationModel";
import { parsePwanHeader, pwanFramesPerSecond } from "../src/pokeweb/pwanCompiler";
import { getPokemonSpriteImage } from "../src/pokeweb/pokemonSpriteModel";
import type { ProjectState, PwanAnimationOverride } from "../src/pokeweb/projectStore";

type TrackerMove = { id: number; key: string; name: string };
type TrackerPokemon = {
  id: number;
  key: string;
  name: string;
  kind: string;
  baseSpeciesId?: number;
  form?: number;
  spriteForm?: number;
  credits?: string;
};

type MegaPreviewRow = {
  previewSpecies: number;
  name: string;
  key: string;
  baseSpeciesId: number;
  form: number;
};

type MegaPreviewReport = { rows: MegaPreviewRow[] };

type ViewerPwanSide = {
  path: string;
  frames: number;
  timelineFrames: number;
  fps: number;
};

type ViewerSprite = {
  id: number;
  key: string;
  name: string;
  kind: string;
  speciesId: number;
  formIndex: number;
  assetIndex?: number;
  generation: number;
  credits: string;
  pwanChunk?: string;
  pwan: Partial<Record<"front" | "back", ViewerPwanSide>>;
  native: Partial<Record<"front" | "back", string>>;
};

type BuildSprite = ViewerSprite & {
  sourceSpeciesId: number;
  sourceFormIndex: number;
  nativeSpriteId: number;
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const w2uRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, "../../White2Upgrade-Original-pokeweb"));
const trackerRoot = path.resolve(process.argv[3] ?? path.join(repoRoot, "../White2Expansion"));
const romPath = path.resolve(process.argv[4] ?? path.join(repoRoot, "../../White2Upgrade.nds"));
const outputRoot = path.join(trackerRoot, "animation-viewer/data");

const MOVE_ANIMATION_PATH = "a/0/6/5";
const MOVE_SPA_PATH = "a/0/0/6";
const MOVE_BACKGROUND_PATH = "a/0/9/4";
const POKEMON_SPRITE_PATH = "a/0/0/4";
const BATTLE_GRAPHICS_PATH = "a/0/1/1";
const BATTLE_TABLE_PATHS = ["a/1/5/1", "a/1/5/2", "a/1/6/0"] as const;
const PWAN_CHUNK_SIZE = 24;
const GENERATED_ZIP_MTIME = new Date("1980-01-02T00:00:00.000Z");

async function main(): Promise<void> {
  const romBytes = new Uint8Array(await readFile(romPath));
  const rom = new NintendoDSRom(romBytes);
  const moves = JSON.parse(await readFile(path.join(trackerRoot, "data/moves.gen6.json"), "utf8")) as TrackerMove[];
  const pokemon = JSON.parse(await readFile(path.join(trackerRoot, "data/pokemon.gen6.json"), "utf8")) as TrackerPokemon[];
  const megaPreview = JSON.parse(
    await readFile(path.join(w2uRoot, "assets/pokeweb_pwan/mega_preview_low_ids_report.json"), "utf8"),
  ) as MegaPreviewReport;
  const megaPreviewByKey = new Map(megaPreview.rows.map((entry) => [entry.key, entry]));

  const stagedMoveIds = (await readdir(path.join(w2uRoot, "data/graphics/move_animations")))
    .map((name) => /^5_0*(\d+)\.bin$/u.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((left, right) => left - right);
  const moveById = new Map(moves.map((move) => [move.id, move]));
  const moveEntries = stagedMoveIds.flatMap((id) => {
    const move = moveById.get(id);
    if (!move) return [];
    return [{
      id,
      key: move.key,
      name: move.name,
      generation: id <= 621 ? 6 : 7,
    }];
  });

  await removeEditorOnlyBuildAssets(path.join(trackerRoot, "animation-viewer/assets"));
  await rm(outputRoot, { force: true, recursive: true });
  const nativeOutput = path.join(outputRoot, "native");
  const pwanOutput = path.join(outputRoot, "pwan");
  await mkdir(nativeOutput, { recursive: true });
  await mkdir(pwanOutput, { recursive: true });

  const overrides = parsePwanArchiveBytes(rom.getFileByName(PWAN_ARCHIVE_PATH));
  const trackerSprites = [...pokemon].sort((left, right) => {
      const leftSpecies = left.baseSpeciesId ?? left.id;
      const rightSpecies = right.baseSpeciesId ?? right.id;
      return generationForTracker(left) - generationForTracker(right)
        || leftSpecies - rightSpecies
        || Number(left.form ?? 0) - Number(right.form ?? 0)
        || left.id - right.id;
    });
  const sprites: BuildSprite[] = trackerSprites.map((entry) => {
    const speciesId = entry.baseSpeciesId ?? entry.id;
    const formIndex = Number(entry.form ?? 0);
    const mega = megaPreviewByKey.get(entry.key);
    const sourceSpeciesId = mega?.previewSpecies ?? speciesId;
    const sourceFormIndex = mega ? 0 : formIndex;
    const override = findPwanOverride(overrides, sourceSpeciesId, sourceFormIndex);
    return {
      id: entry.id,
      key: entry.key,
      name: entry.name,
      kind: entry.kind,
      speciesId,
      formIndex,
      assetIndex: override ? pwanAssetIndex(override) : undefined,
      generation: generationForTracker(entry),
      credits: entry.credits ?? "",
      pwan: {},
      native: {},
      sourceSpeciesId,
      sourceFormIndex,
      nativeSpriteId: mega?.previewSpecies ?? nativeSpriteId(entry),
    };
  });

  for (let chunkStart = 0; chunkStart < sprites.length; chunkStart += PWAN_CHUNK_SIZE) {
    const chunkSprites = sprites.slice(chunkStart, chunkStart + PWAN_CHUNK_SIZE);
    const chunkFiles: Record<string, [Uint8Array, { mtime: Date }]> = {};
    const chunkName = `chunk-${String(chunkStart / PWAN_CHUNK_SIZE).padStart(3, "0")}.zip`;
    for (const sprite of chunkSprites) {
      const override = findPwanOverride(overrides, sprite.sourceSpeciesId, sprite.sourceFormIndex);
      if (!override) continue;
      for (const side of ["front", "back"] as const) {
        const pwanBytes = override[side]?.pwanBytes;
        if (!pwanBytes) continue;
        const header = parsePwanHeader(pwanBytes);
        const memberPath = `${sprite.id}/${side}.pwan`;
        chunkFiles[memberPath] = [pwanBytes, { mtime: GENERATED_ZIP_MTIME }];
        sprite.pwan[side] = {
          path: memberPath,
          frames: header.frameCount,
          timelineFrames: header.timelineCount,
          fps: pwanFramesPerSecond(pwanBytes),
        };
      }
      if (Object.keys(sprite.pwan).length > 0) sprite.pwanChunk = `data/pwan/${chunkName}`;
    }
    if (Object.keys(chunkFiles).length > 0) {
      await writeFile(path.join(pwanOutput, chunkName), zipSync(chunkFiles, { level: 9 }));
    }
  }

  const nativeSpriteArchive = new NARC(rom.getFileByName(POKEMON_SPRITE_PATH));
  const nativeProject = {
    session: { baseRom: "BW2" },
    narcs: { pokemon_sprites: { rawFiles: nativeSpriteArchive.files } },
  } as unknown as ProjectState;
  for (const sprite of sprites) {
    for (const side of ["front", "back"] as const) {
      if (sprite.pwan[side]) continue;
      const fileName = `${sprite.id}-${side}.png`;
      const image = getPokemonSpriteImage(nativeProject, sprite.nativeSpriteId, { kind: "sprite", side, gender: "male" }, "normal");
      await writeFile(path.join(nativeOutput, fileName), staticSpritePngBytes(image));
      sprite.native[side] = `data/native/${fileName}`;
    }
  }

  const archives = [
    { key: "moveAnimations", sourcePath: MOVE_ANIMATION_PATH, fileName: "move-animations.narc" },
    { key: "moveSpas", sourcePath: MOVE_SPA_PATH, fileName: "move-spas.narc" },
    { key: "moveBackgrounds", sourcePath: MOVE_BACKGROUND_PATH, fileName: "move-backgrounds.narc" },
  ] as const;
  const archiveManifest: Record<string, { path: string; sha256: string; bytes: number }> = {};
  for (const archive of archives) {
    const bytes = rom.getFileByName(archive.sourcePath);
    await writeFile(path.join(outputRoot, archive.fileName), bytes);
    archiveManifest[archive.key] = {
      path: `data/${archive.fileName}`,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
  }

  const battleEnvironment = extractBattleEnvironment(rom);
  await writeFile(path.join(outputRoot, "battle-background.nsbmd"), battleEnvironment.background.bytes);
  await writeFile(path.join(outputRoot, "battle-platform.nsbmd"), battleEnvironment.platform.bytes);

  const publishedSprites: ViewerSprite[] = sprites.map(({ sourceSpeciesId: _sourceSpeciesId, sourceFormIndex: _sourceFormIndex, nativeSpriteId: _nativeSpriteId, ...sprite }) => sprite);
  const manifest = {
    format: "white2expansion-animation-viewer",
    version: 3,
    sourceRomSha256: sha256(romBytes),
    moves: moveEntries,
    sprites: publishedSprites,
    archives: archiveManifest,
    battleEnvironment: {
      backgroundIndex: battleEnvironment.background.tableIndex,
      backgroundSeasonIndex: battleEnvironment.background.seasonIndex,
      background: fileManifest("data/battle-background.nsbmd", battleEnvironment.background.resourceId, battleEnvironment.background.bytes),
      platformIndex: battleEnvironment.platform.tableIndex,
      platformSeasonIndex: battleEnvironment.platform.seasonIndex,
      platform: fileManifest("data/battle-platform.nsbmd", battleEnvironment.platform.resourceId, battleEnvironment.platform.bytes),
    },
  };
  await writeFile(path.join(outputRoot, "viewer-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const pwanCount = sprites.filter((entry) => Object.keys(entry.pwan).length > 0).length;
  const nativeSideCount = sprites.reduce((count, entry) => count + Object.keys(entry.native).length, 0);
  console.log(`Wrote ${sprites.length} sprite sets (${pwanCount} PWAN, ${nativeSideCount} native fallback sides) and ${moveEntries.length} move animations to ${outputRoot}`);
}

function extractBattleEnvironment(rom: NintendoDSRom): {
  background: { tableIndex: number; seasonIndex: number; resourceId: number; bytes: Uint8Array };
  platform: { tableIndex: number; seasonIndex: number; resourceId: number; bytes: Uint8Array };
} {
  const graphics = new NARC(rom.getFileByName(BATTLE_GRAPHICS_PATH));
  let selected: {
    backgrounds: ReturnType<typeof parseBattleBackgroundVariants>;
    platforms: ReturnType<typeof parseBattlePlatformVariants>;
  } | undefined;
  for (const tablePath of BATTLE_TABLE_PATHS) {
    try {
      const table = new NARC(rom.getFileByName(tablePath));
      const backgrounds = parseBattleBackgroundVariants(table.files[1] ?? new Uint8Array(), graphics.files, rom.idCode);
      const platforms = parseBattlePlatformVariants(table.files[2] ?? new Uint8Array(), graphics.files, rom.idCode);
      if (table.files.length === 3 && backgrounds.length >= 5) {
        selected = { backgrounds, platforms };
        break;
      }
    } catch {
      // ROM revisions do not all use the same battle lookup path.
    }
  }
  if (!selected) {
    for (const file of rom.files) {
      if (readAscii(file, 0, Math.min(4, file.length)) !== "NARC") continue;
      try {
        const table = new NARC(file);
        if (table.files.length !== 3) continue;
        const backgrounds = parseBattleBackgroundVariants(table.files[1] ?? new Uint8Array(), graphics.files, rom.idCode);
        if (backgrounds.length < 5) continue;
        selected = {
          backgrounds,
          platforms: parseBattlePlatformVariants(table.files[2] ?? new Uint8Array(), graphics.files, rom.idCode),
        };
        break;
      } catch {
        // Keep scanning malformed or unrelated NARCs.
      }
    }
  }
  if (!selected) throw new Error("Could not locate the battle background/platform lookup table.");
  const background = selectMovePreviewBattleVariant(selected.backgrounds, MOVE_PREVIEW_BACKGROUND_INDEX);
  const platform = selectMovePreviewBattleVariant(selected.platforms, MOVE_PREVIEW_PLATFORM_INDEX);
  if (!background || !platform) {
    throw new Error(
      `The default move-preview battle environment is unavailable (backgrounds: ${selected.backgrounds.map((entry) => entry.tableIndex).join(",")}; platforms: ${selected.platforms.map((entry) => entry.tableIndex).join(",")}).`,
    );
  }
  const backgroundBytes = graphics.files[background.resourceId];
  const platformBytes = graphics.files[platform.resourceId];
  if (!backgroundBytes || !platformBytes) throw new Error("The default move-preview battle models are missing.");
  return {
    background: { ...background, bytes: backgroundBytes },
    platform: { ...platform, bytes: platformBytes },
  };
}

function fileManifest(pathname: string, resourceId: number, bytes: Uint8Array): {
  path: string;
  resourceId: number;
  sha256: string;
  bytes: number;
} {
  return { path: pathname, resourceId, sha256: sha256(bytes), bytes: bytes.length };
}

async function removeEditorOnlyBuildAssets(assetsRoot: string): Promise<void> {
  for (const entry of await readdir(assetsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || /\.(?:css|js)$/u.test(entry.name)) continue;
    await rm(path.join(assetsRoot, entry.name));
  }
}

function findPwanOverride(overrides: PwanAnimationOverride[], speciesId: number, formIndex: number): PwanAnimationOverride | undefined {
  return overrides.find((override) => override.speciesId === speciesId && Number(override.formIndex ?? 0) === formIndex);
}

function generationForSpecies(speciesId: number): number {
  if (speciesId <= 721) return 6;
  if (speciesId <= 809) return 7;
  if (speciesId <= 905) return 8;
  return 9;
}

function generationForTracker(entry: TrackerPokemon): number {
  if (entry.kind.includes("mega")) return 6;
  if (entry.key.includes("ALOLA")) return 7;
  if (entry.key.includes("GALAR") || entry.key.includes("HISUI")) return 8;
  if (entry.key.includes("PALDEA")) return 9;
  return generationForSpecies(entry.baseSpeciesId ?? entry.id);
}

function nativeSpriteId(entry: TrackerPokemon): number {
  if (entry.baseSpeciesId !== undefined) {
    if (entry.spriteForm === undefined) throw new Error(`${entry.name} is missing its native sprite form index.`);
    return 724 + entry.spriteForm;
  }
  if (entry.id <= 721) return entry.id;
  if (entry.id <= 809) return 950 + entry.id - 722;
  return 1200 + entry.id - 810;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

await main();

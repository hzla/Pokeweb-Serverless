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
import { resolvePokemonSpriteId } from "../src/pokeweb/pokemonSpriteModel";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { parseW2Anim, W2ANIM_PATH } from "../src/pokeweb/w2animCodec";
import { extractRomPwan, readNclrPalette } from "./lib/pwan-sprite-refresh";
import { readBundledPwanArchive } from "./lib/pwan-library-payload";
import type { ProjectState, PwanAnimationOverride } from "../src/pokeweb/projectStore";

type TrackerMove = { id: number; key: string; name: string; credits?: string; animationId?: number; defaultProgress?: {animation?:boolean} };
type TrackerPokemon = {
  id: number;
  key: string;
  name: string;
  kind: string;
  baseSpeciesId?: number;
  form?: number;
  spriteForm?: number;
  credits?: string;
  spriteSources?: Array<{side: "front" | "back"; credits: string; source: string; creditBasis: string}>;
};

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
  spriteSources?: TrackerPokemon["spriteSources"];
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
  const rom = new NintendoDSRom(romBytes, {fileData:"view"});
  const moves = JSON.parse(await readFile(path.join(trackerRoot, "data/moves.gen6.json"), "utf8")) as TrackerMove[];
  const pokemon = JSON.parse(await readFile(path.join(trackerRoot, "data/pokemon.gen6.json"), "utf8")) as TrackerPokemon[];
  const animations = new NARC(rom.getFileByName(MOVE_ANIMATION_PATH));
  const moveEntries = moves.filter(move => move.defaultProgress?.animation).map(move => {
    const animationId = move.animationId ?? move.id;
    if (!animations.files[animationId]?.length) throw new Error(`Missing current-ROM animation for ${move.name}`);
    return {
      id:move.id, animationId, credits:move.credits ?? "",
      key: move.key,
      name: move.name,
      generation: generationForMove(move.id),
    };
  }).sort((a,b) => a.id-b.id);

  await removeEditorOnlyBuildAssets(path.join(trackerRoot, "animation-viewer/assets"));
  await rm(outputRoot, { force: true, recursive: true });
  const nativeOutput = path.join(outputRoot, "native");
  const pwanOutput = path.join(outputRoot, "pwan");
  await mkdir(nativeOutput, { recursive: true });
  await mkdir(pwanOutput, { recursive: true });

  const streamId = rom.filenames.idOf(W2ANIM_PATH);
  const streams = streamId === undefined ? undefined : parseW2Anim(rom.files[streamId]!);
  const streamEntries = new Map(streams?.entries.filter(e=>e.arc===4).map(e=>[e.sheetFile,e]));
  const libraryRoot = path.join(repoRoot,"src/assets/pwan/library");
  const library = JSON.parse(await readFile(path.join(libraryRoot,"manifest.json"),"utf8"));
  const libraryBytes = await readBundledPwanArchive(libraryRoot);
  const libraryArchive = new NARC(libraryBytes);
  const libraryEntries = new Map<string, {assetIndex:number}>(library.entries.map((e: any)=>[`${e.speciesId}:${e.formIndex}`,e]));
  const overrides = streams ? [] : parsePwanArchiveBytes(rom.getFileByName(PWAN_ARCHIVE_PATH));
  const project = await loadProjectFromRomBytes(romBytes, path.basename(romPath), {selectedNarcs:["personal","pokemon_sprites"]});
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
    const sourceSpeciesId = speciesId;
    const sourceFormIndex = formIndex;
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
      spriteSources: entry.spriteSources,
      pwan: {},
      native: {},
      sourceSpeciesId,
      sourceFormIndex,
      nativeSpriteId: resolvePokemonSpriteId(project, speciesId, formIndex),
    };
  });

  for (let chunkStart = 0; chunkStart < sprites.length; chunkStart += PWAN_CHUNK_SIZE) {
    const chunkSprites = sprites.slice(chunkStart, chunkStart + PWAN_CHUNK_SIZE);
    const chunkFiles: Record<string, [Uint8Array, { mtime: Date }]> = {};
    const chunkName = `chunk-${String(chunkStart / PWAN_CHUNK_SIZE).padStart(3, "0")}.zip`;
    for (const sprite of chunkSprites) {
      const override = findPwanOverride(overrides, sprite.sourceSpeciesId, sprite.sourceFormIndex);
      const bundled = libraryEntries.get(`${sprite.speciesId}:${sprite.formIndex}`);
      if (bundled) sprite.assetIndex = bundled.assetIndex;
      for (const side of ["front", "back"] as const) {
        const stream = streamEntries.get(sprite.nativeSpriteId * 20 + (side === "front" ? 2 : 11));
        const bundledBytes = bundled && libraryArchive.files[bundled.assetIndex*2+(side==="front"?1:2)];
        const pwanBytes = bundledBytes?.length ? bundledBytes : streams && stream
          ? extractRomPwan(streams, stream, readNclrPalette(project.narcs.pokemon_sprites!.rawFiles[sprite.nativeSpriteId * 20 + 18]!))
          : override?.[side]?.pwanBytes;
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
    generatedAt: new Date().toISOString(),
    animationBackend: streams ? "w2anim" : "pwan",
    previewEncoding: "PWAN (lossless browser representation; not the ROM runtime)",
    pokemonSource: "Current Pokeweb bundled animation library; native ROM fallback for unbundled sides",
    pokemonSourceSha256: sha256(libraryBytes),
    moveSource: "Current integration ROM, including particle and background archives",
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
  const files = (await readdir(assetsRoot, {withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.name);
  const live = new Set<string>();
  const pending = [await readFile(path.join(assetsRoot,"../index.html"),"utf8")];
  while (pending.length) {
    const source = pending.pop()!;
    for (const match of source.matchAll(/[\w.-]+\.(?:js|css)\b/g)) {
      const name = match[0];
      if (!files.includes(name) || live.has(name)) continue;
      live.add(name);
      pending.push(await readFile(path.join(assetsRoot,name),"utf8"));
    }
  }
  for (const name of files) {
    if (/\.(?:css|js)$/u.test(name) && live.has(name)) continue;
    await rm(path.join(assetsRoot,name));
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

function generationForMove(moveId: number): number {
  if (moveId <= 621) return 6;
  if (moveId <= 742) return 7;
  if (moveId <= 850) return 8;
  return 9;
}

function generationForTracker(entry: TrackerPokemon): number {
  if (entry.kind.includes("mega")) return 6;
  if (entry.key.includes("ALOLA")) return 7;
  if (entry.key.includes("GALAR") || entry.key.includes("HISUI")) return 8;
  if (entry.key.includes("PALDEA")) return 9;
  return generationForSpecies(entry.baseSpeciesId ?? entry.id);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

await main();

import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import type { NitroPaletteData } from "./nitroBg";
import { loadActiveRomBytes } from "./persistence";
import { createNarcStore, type ProjectState } from "./projectStore";
import type { RgbaImageData } from "./pokemonSpriteModel";
import {
  decodeTrainerSpriteAnimation,
  decodeTrainerSpritePalette,
  decodeTrainerSpriteRigAtlas,
  decodeTrainerSpriteStaticGraphic,
  type TrainerSpriteAnimation,
} from "./trainerSpriteModel";

const ARCHIVE_PATH = "a/0/7/2";
const FILES_PER_GRAPHIC = 8;

export const PLAYER_BACK_APPEARANCES = [
  { index: 0, label: "Nate (male)" },
  { index: 1, label: "Rosa (female)" },
] as const;

export type PlayerTrainerBackSpritePreview = {
  appearanceIndex: 0 | 1;
  animation: TrainerSpriteAnimation;
  staticGraphic: RgbaImageData;
  rigAtlas: RgbaImageData;
  palette: NitroPaletteData;
};

export async function ensurePlayerTrainerBackSpriteStore(project: ProjectState): Promise<boolean> {
  if (project.session.baseRom !== "BW2") return false;
  if (project.narcs.trainer_back_sprites?.rawFiles.some((file) => file.length > 0)) return true;

  const bytes = project.originalRomBytes ?? (await loadActiveRomBytes());
  if (!bytes) return false;
  const rom = new NintendoDSRom(bytes, { fileData: "view" });
  const fileId = rom.fileId(ARCHIVE_PATH);
  const replacement = project.fileSystem?.replacements[fileId];
  const archive = new NARC(replacement ?? rom.files[fileId]);
  if (archive.files.length < 2 * FILES_PER_GRAPHIC) throw new Error("Player back-sprite archive is missing playable appearances");
  project.session.fileIds.trainer_back_sprites = fileId;
  project.narcs.trainer_back_sprites = createNarcStore("trainer_back_sprites", ARCHIVE_PATH, fileId, archive);
  return true;
}

export function getPlayerTrainerBackSpritePreview(project: ProjectState, appearanceIndex: number): PlayerTrainerBackSpritePreview {
  if (project.session.baseRom !== "BW2") throw new Error("Player back-sprite preview supports Black 2 and White 2 ROMs");
  if (appearanceIndex !== 0 && appearanceIndex !== 1) throw new Error(`Unsupported player appearance ${appearanceIndex}`);
  const store = project.narcs.trainer_back_sprites;
  if (!store) throw new Error("Player back-sprite archive is not loaded");
  const files = store.rawFiles.slice(appearanceIndex * FILES_PER_GRAPHIC, (appearanceIndex + 1) * FILES_PER_GRAPHIC);
  return {
    appearanceIndex,
    // BW2 uses sequence 0 for the idle pose and sequence 1 for the send-out throw.
    animation: decodeTrainerSpriteAnimation(files, 1),
    staticGraphic: decodeTrainerSpriteStaticGraphic(files),
    rigAtlas: decodeTrainerSpriteRigAtlas(files),
    palette: decodeTrainerSpritePalette(files),
  };
}

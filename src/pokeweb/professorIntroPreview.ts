import { NARC } from "../nds/narc";
import { NintendoDSRom } from "../nds/rom";
import { getRomFileBytes } from "./fileSystemModel";
import { parseNitroBackground } from "./nitroBg";
import { activeRomMatchesProject, loadActiveRomBytes } from "./persistence";
import { decompressNitro, type RgbaImageData } from "./pokemonSpriteModel";
import type { ProjectState } from "./projectStore";
import { decodeTrainerSpriteAnimation } from "./trainerSpriteModel";

export type ProfessorIntroPreview = {
  background: RgbaImageData;
  professor: RgbaImageData & { x: number; y: number };
};

/** Read the main-screen background and Juniper's standing send-out pose. */
export async function loadProfessorIntroPreview(project: ProjectState): Promise<ProfessorIntroPreview> {
  if (project.session.baseRom !== "BW2" || !["IREO", "IRDO"].includes(project.romInfo.idCode)) {
    throw new Error("Intro preview supports US Black 2 and White 2.");
  }
  if (!project.originalRomBytes && !await activeRomMatchesProject(project)) {
    throw new Error("Reconnect this project's ROM to load the intro preview.");
  }
  const source = project.originalRomBytes ?? await loadActiveRomBytes();
  if (!source) throw new Error("Reload the ROM to load the intro preview.");
  const rom = new NintendoDSRom(source, { fileData: "view" });
  const fileId = rom.fileId("a/1/6/8");
  return decodeProfessorIntroPreview(new NARC(getRomFileBytes(project, rom, fileId)).files, project.romInfo.idCode === "IREO");
}

export function decodeProfessorIntroPreview(files: Uint8Array[], black2: boolean): ProfessorIntroPreview {
  const file = (id: number) => {
    const bytes = files[id];
    if (!bytes?.length) throw new Error(`Intro preview graphic ${id} is missing.`);
    return bytes[0] === 0x10 || bytes[0] === 0x11 ? decompressNitro(bytes) : bytes;
  };
  // BG3 is the top screen (map 4). Map 3 belongs to the bottom screen.
  const background = parseNitroBackground(4, file(4), file(0), file(black2 ? 2 : 1));
  // The professor uses the same MCSS format as trainer graphics. Sequence 1
  // is the standing/talking pose used after the ball has opened.
  const frame = decodeTrainerSpriteAnimation([25, 25, 27, 24, 30, 29, 26, 28].map(file), 1).frames[0];
  if (!frame) throw new Error("Intro preview professor pose is missing.");
  return {
    background: { width: background.width, height: background.height, pixels: background.rgba },
    professor: { width: frame.width, height: frame.height, pixels: frame.rgba, x: frame.x - 128, y: frame.y - 128 },
  };
}

/** MCSS keeps the sprite's pixel size while projecting its world-space anchor. */
export function professorIntroScreenAnchor(x: number, y: number, z: number): [number, number] {
  const cameraY = 0.043, cameraZ = 70, targetY = 1;
  const length = Math.hypot(targetY - cameraY, cameraZ);
  const tiltSin = (targetY - cameraY) / length, tiltCos = cameraZ / length;
  const depth = (y - cameraY) * tiltSin - (z - cameraZ) * tiltCos;
  const vertical = (y - cameraY) * tiltCos + (z - cameraZ) * tiltSin;
  const focal = 96 / Math.tan(20 * Math.PI / 180);
  return [Math.ceil(128 + x * focal / depth), Math.ceil(96 - vertical * focal / depth)];
}

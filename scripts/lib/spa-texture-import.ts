import { PNG } from "pngjs";
import { replaceSpaTextureRgba, type SpaTextureQuantizationReport } from "../../src/pokeweb/spaTransform";
import type { SpaArchive, SpaTextureImportFormat } from "../../src/pokeweb/nitroSpa";

export function importSpaTexturePng(
  archive: SpaArchive,
  textureIndex: number,
  pngBytes: Uint8Array,
  format: SpaTextureImportFormat,
): SpaTextureQuantizationReport {
  const image = PNG.sync.read(Buffer.from(pngBytes));
  return replaceSpaTextureRgba(archive, textureIndex, {
    width: image.width,
    height: image.height,
    rgba: new Uint8ClampedArray(image.data),
  }, format);
}

import { readU16, readU32 } from "./binary";

export type DsiExportWarning = { code: "previous-exporter-dsi" | "damaged-dsi"; message: string };

export function damagedDsiExportWarning(source: Uint8Array): DsiExportWarning {
  const arm9i = readU32(source, 0x1c0), size9i = readU32(source, 0x1cc);
  const arm7i = readU32(source, 0x1d0), size7i = readU32(source, 0x1dc);
  // The old serializer packed just the two programs, without moving the
  // digest tables or preserving the original TWL span and encryption ranges.
  // Only attribute the damage when this specific layout is recognizable.
  const previousExporter = arm9i > 0 && size9i > 0 && size7i > 0
    && arm9i === readU16(source, 0x92) * 0x80000
    && arm7i === Math.ceil((arm9i + size9i) / 0x200) * 0x200
    && readU32(source, 0x210) === Math.ceil((arm7i + size7i) / 4) * 4
    && (readU32(source, 0x1f8) + readU32(source, 0x1fc) > source.length
      || readU32(source, 0x1e8) !== arm9i);
  return {
    code: previousExporter ? "previous-exporter-dsi" : "damaged-dsi",
    message: `${previousExporter
      ? "This ROM's DSi headers were affected by a previous version of the Pokeweb exporter."
      : "This ROM's DSi headers or data are damaged or missing. A previous version of the Pokeweb exporter could have caused this."} Your edited ROM will still be exported for DS mode, but DSi mode will not work. Use DSi ROM Repair on the homepage with a matching clean Black 2 or White 2 ROM to restore DSi support.`,
  };
}

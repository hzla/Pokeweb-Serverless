export type MapGlbObject = {
  id: string;
  kind: "terrain" | "building";
  exported: boolean;
  chunkId: number;
  sourceChunkId: number;
  matrixX: number;
  matrixY: number;
  placementIndex?: number;
  uid?: number;
  resourceIndex?: number;
};

export type MapGlbManifest = {
  version: 1;
  game: string;
  zoneId: number;
  season: string;
  matrixId: number;
  matrixCell?: { matrixId: number; x: number; y: number };
  areaId: number;
  areaMetadata: string;
  bundleKind: "exterior" | "interior";
  bundleId: number;
  /** Entire loaded chunk containers: geometry and placement edits share a baseline. */
  chunks: Array<{ id: number; hash: string }>;
  bundleHash: string;
  textures?: { terrainId: number; terrainHash: string; buildingHash: string };
  terrain: MapGlbObject[];
  buildings: MapGlbObject[];
  /** False when the GLB was exported without buildings: importing it leaves every placement and building model as it
   * is (absent buildings are not deletions). Missing in older exports, which always include buildings. */
  buildingsIncluded?: false;
};

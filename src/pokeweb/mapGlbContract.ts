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
};

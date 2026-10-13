export type Bw2RoutineSummary = {
  offset: number;
  kind: "script" | "helper" | "block" | "movement" | "undecoded";
  entries?: number[];
  summary: string;
  confidence: "reviewed" | "inferred" | "partial";
  fingerprint?: string;
};
export type Bw2ScriptSummaryFile = {
  sha256: string;
  byteLength: number;
  kind: "field" | "activation-table" | "unrecognized";
  description: string;
  variants: { overlay: number | null; editable: boolean; fingerprintVersion?: number; routines: Bw2RoutineSummary[] }[];
};
export type Bw2ScriptSummaryCatalog = {
  version: 1 | 2;
  gameCode: string;
  sourceRomSha256: string;
  archive: string;
  files: Record<string, Bw2ScriptSummaryFile>;
};

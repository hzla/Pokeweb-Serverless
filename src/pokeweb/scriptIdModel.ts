import type { ProjectState } from "./projectStore";

/*
 * Where a script ID runs: FieldScript_ResolveSCRID (BW2 ov012 script_sys.c; BW ov010) checks the global ranges from
 * the top down, and a script ID in one runs entry (ID - range start) of that range's file. Below them, IDs 1-1999 run
 * entry (ID - 1) of the zone's own script file, the header's script file.
 * Ranges as [first ID, last ID, script file], read from each game's GLOBAL_SCRIPT_TABLE.
 */
type GlobalRange = readonly [number, number, number];

const BW2_GLOBAL_SCRIPTS: readonly GlobalRange[] = [
  [10885, 10914, 1288], [10865, 10884, 1287], [10860, 10864, 1286], [10850, 10859, 1285], [10815, 10834, 1284],
  [10795, 10814, 1283], [10785, 10794, 1282], [10735, 10784, 1281], [10685, 10734, 1280], [10675, 10684, 1279],
  [10665, 10674, 1278], [10655, 10664, 1277], [10635, 10654, 1276], [10535, 10634, 1275], [10530, 10534, 1274],
  [10520, 10529, 1273], [10510, 10519, 1272], [10490, 10509, 1271], [10480, 10489, 1270], [10470, 10479, 1269],
  [10450, 10469, 1268], [10445, 10449, 1267], [10440, 10444, 1266], [10435, 10439, 1265], [10405, 10434, 1264],
  [10400, 10404, 1263], [10395, 10399, 1262], [10390, 10394, 1261], [10380, 10389, 1260], [10350, 10379, 1259],
  [10330, 10349, 1258], [10325, 10329, 1257], [10315, 10324, 1256], [10310, 10314, 1255], [10290, 10309, 1254],
  [10280, 10289, 1253], [10270, 10279, 1252], [10260, 10269, 1251], [10250, 10259, 1250], [10200, 10249, 1249],
  [10130, 10149, 1248], [10110, 10119, 1247], [10105, 10109, 1246], [10100, 10104, 1245], [10090, 10099, 1244],
  [10000, 10089, 1243], [9600, 9699, 1242], [8000, 8799, 1241], [7000, 7799, 1240], [5000, 6999, 1239],
  [3000, 4999, 1239], [2800, 2819, 1238], [2500, 2799, 1237], [2280, 2299, 1236], [2260, 2279, 1235],
  [2250, 2259, 1234], [2225, 2249, 1233], [2200, 2224, 1232], [2100, 2199, 1231], [2000, 2099, 1230],
];

const BW_GLOBAL_SCRIPTS: readonly GlobalRange[] = [
  [10520, 10524, 898], [10510, 10519, 897], [10500, 10509, 896], [10480, 10499, 895], [10470, 10479, 894],
  [10460, 10469, 893], [10440, 10459, 892], [10435, 10439, 891], [10430, 10434, 890], [10425, 10429, 889],
  [10405, 10424, 888], [10400, 10404, 887], [10395, 10399, 886], [10390, 10394, 885], [10380, 10389, 884],
  [10350, 10379, 883], [10330, 10349, 882], [10325, 10329, 881], [10315, 10324, 880], [10310, 10314, 879],
  [10290, 10309, 878], [10280, 10289, 877], [10270, 10279, 876], [10260, 10269, 875], [10250, 10259, 874],
  [10200, 10249, 873], [10130, 10149, 872], [10110, 10119, 871], [10105, 10109, 870], [10100, 10104, 869],
  [10090, 10099, 868], [10000, 10089, 867], [9600, 9699, 866], [8000, 8799, 865], [7000, 7799, 864],
  [5000, 6999, 863], [3000, 4999, 863], [2800, 2819, 862], [2500, 2799, 861], [2280, 2299, 860],
  [2260, 2279, 859], [2250, 2259, 858], [2225, 2249, 857], [2200, 2224, 856], [2100, 2199, 855], [2000, 2099, 854],
];

export type ScriptTarget = {
  fileId: number;
  /** The entry number as the script editor counts them, from 1. */
  entry: number;
  /** "zone" for the map's own script file, "global" for a shared one. */
  kind: "zone" | "global";
};

/** The script file and entry a script ID runs, given the zone script file of the map it is used on. */
export function resolveScriptId(project: ProjectState, scriptId: number, zoneScriptFile: number | undefined): ScriptTarget | undefined {
  if (!Number.isInteger(scriptId) || scriptId < 1) return undefined;
  const table = project.session.baseRom === "BW2" ? BW2_GLOBAL_SCRIPTS : project.session.baseRom === "BW" ? BW_GLOBAL_SCRIPTS : undefined;
  if (!table) return undefined;
  const range = table.find(([first]) => scriptId >= first);
  if (range) return scriptId <= range[1] ? { fileId: range[2], entry: scriptId - range[0] + 1, kind: "global" } : undefined;
  if (zoneScriptFile === undefined || zoneScriptFile === 0xffff) return undefined;
  return { fileId: zoneScriptFile, entry: scriptId, kind: "zone" };
}

/** The zone script file of an overworld: its header's, preferring the header the editor was opened from. */
export function overworldZoneScriptFile(project: ProjectState, overworldId: number, headerRowId?: number): number | undefined {
  const rows = project.headers?.rows ?? {};
  const preferred = headerRowId === undefined ? undefined : rows[headerRowId];
  const usesOverworld = (row: Record<string, unknown> | undefined) => row !== undefined && Number(row.overworlds_id ?? row.map_id) === overworldId;
  const row = usesOverworld(preferred) ? preferred : Object.values(rows).find((candidate) => usesOverworld(candidate));
  const file = Number(row?.script_id);
  return Number.isInteger(file) ? file : undefined;
}

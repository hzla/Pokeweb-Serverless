export const MUSIC_REFERENCE_CATEGORIES = {
  cities: "Cities & towns",
  routes: "Routes",
  buildings: "Buildings & facilities",
  areas: "Dungeons & landmarks",
  travel: "Travel",
  battles: "Battles",
  battleEvents: "Battle changes & victory",
} as const;

export type MusicReferenceCategory = keyof typeof MUSIC_REFERENCE_CATEGORIES;
export type MusicReferenceFilter = MusicReferenceCategory | "all";
export type MusicReferenceTrack = { symbol: string; label: string };
export type MusicReferenceDefinition = {
  category: MusicReferenceCategory;
  title: string;
  description: string;
  tracks: MusicReferenceTrack[];
};
export type MusicReferenceEntry = Omit<MusicReferenceDefinition, "tracks"> & {
  tracks: Array<MusicReferenceTrack & { id: number }>;
};

const track = (suffix: string, label = ""): MusicReferenceTrack => ({ symbol: `SEQ_BGM_${suffix}`, label });
const seasons = (prefix: string): MusicReferenceTrack[] => [
  track(`${prefix}_SP`, "Spring"), track(`${prefix}_SU`, "Summer"),
  track(`${prefix}_AU`, "Autumn"), track(`${prefix}_WI`, "Winter"),
];
const entry = (category: MusicReferenceCategory, title: string, description: string, ...tracks: MusicReferenceTrack[]): MusicReferenceDefinition => ({
  category, title, description, tracks,
});

// Default BW2 uses, keyed by SDAT symbol rather than an assumed numeric index.
// This is a quick reference, not a complete analysis of a modified ROM's scripts.
export const BW2_MUSIC_REFERENCE: readonly MusicReferenceDefinition[] = [
  entry("cities", "Aspertia City", "City overworld theme.", track("SW_C_12")),
  entry("cities", "Floccesy Town", "Town overworld theme; the ranch uses other tracks.", track("SW_T_06")),
  entry("cities", "Virbank City", "City theme; also used around Virbank Complex. The complex interior has its own track.", track("SW_C_13")),
  entry("cities", "Castelia City", "City overworld theme; also used by the Medal Office.", track("C_03")),
  entry("cities", "Nimbasa City", "City overworld theme.", track("C_04")),
  entry("cities", "Driftveil City", "City overworld theme; also used outside the PWT.", track("SW_C_5_NEW")),
  entry("cities", "Mistralton City", "City overworld theme.", track("C_06")),
  entry("cities", "Lentimas Town", "Town overworld theme.", track("SW_T_07")),
  entry("cities", "Undella Town", "Separate sequence IDs for each season.", ...seasons("T_05")),
  entry("cities", "Lacunosa Town", "Town overworld theme.", track("T_04")),
  entry("cities", "Opelucid City", "Choose the version you are editing: White 2 substitutes its own theme at runtime.", track("C_08_B", "Black 2"), track("C_08_W", "White 2")),
  entry("cities", "Humilau City", "City overworld theme.", track("SW_C_14")),
  entry("cities", "Icirrus City", "City overworld theme.", track("C_07")),
  entry("cities", "Nacrene City", "City overworld theme.", track("C_02")),
  entry("cities", "Striaton City", "City overworld theme.", track("C_01")),
  entry("cities", "Accumula Town", "Town overworld theme.", track("T_02")),
  entry("cities", "Nuvema Town", "Town overworld theme; the laboratory has its own track.", track("T_01")),
  entry("cities", "Anville Town", "Town overworld theme.", track("T_03")),
  entry("cities", "Black City / White Forest", "Area themes. Both areas can be available through the Key System; these are not the tower/treehollow interior tracks.", track("C_10_B", "Black City"), track("C_10_W", "White Forest")),

  entry("routes", "Route 1", "Route overworld theme.", track("R_A")),
  entry("routes", "Routes 2 / 3", "Seasonal tracks shared with parts of Pinwheel Forest and Bridge Gate.", ...seasons("R_B")),
  entry("routes", "Routes 4 / 5 / 16", "Seasonal tracks shared with parts of Desert Resort and Unity Tower.", ...seasons("R_C")),
  entry("routes", "Routes 6 / 7 / 8 / 9 / 17 / 18", "Also used around Chargestone Cave, Twist Mountain, Dragonspiral Tower, Liberty Garden and P2 Laboratory; retained Route 10 maps also reference these tracks.", ...seasons("R_D")),
  entry("routes", "Routes 11 / 12 / 13 / 14 / 15", "Seasonal tracks shared with Undella Bay and parts of Giant Chasm.", ...seasons("R_E")),
  entry("routes", "Routes 19 / 20", "Seasonal tracks also used around Floccesy Ranch; the ranch has a separate interior-area theme.", ...seasons("SW_R_19")),
  entry("routes", "Routes 21 / 22", "Shared seasonal route tracks.", ...seasons("SW_R_22")),
  entry("routes", "Route 23", "Route overworld theme.", track("SW_R_23")),

  entry("buildings", "Pokémon Center", "Shared Pokémon Center interior music across towns and cities; not the healing jingle.", track("POKECEN")),
  entry("buildings", "Gates / gatehouses", "Shared gate interior theme, including route and bridge gates.", track("GATE")),
  entry("buildings", "Professor Juniper's laboratory", "Laboratory interior in Nuvema Town.", track("LABO")),
  entry("buildings", "Shopping Mall Nine", "Shopping Mall interior theme on Route 9.", track("FS")),
  entry("buildings", "Aspertia Gym", "Cheren's Gym interior; separate from Gym Leader battle music.", track("GYM")),
  entry("buildings", "Virbank Gym", "Roxie's Gym interior and band variants; separate from battle music.", track("POISONE_GYM_00", "Variant 00"), track("POISONE_GYM_01", "Variant 01")),
  entry("buildings", "Castelia Gym", "Burgh's Gym interior.", track("INSECT_GYM_01")),
  entry("buildings", "Nimbasa Gym", "Elesa's Gym interior variants.", track("ERECTRIC_GYM_01", "Variant 01"), track("ERECTRIC_GYM_02", "Variant 02")),
  entry("buildings", "Driftveil Gym", "Clay's Gym interior.", track("GROUND_GYM_01")),
  entry("buildings", "Mistralton Gym", "Skyla's Gym interior.", track("FLIGHT_GYM_01")),
  entry("buildings", "Opelucid Gym", "Drayden's Gym interior.", track("DRAGON_GYM_01")),
  entry("buildings", "Humilau Gym", "Marlon's Gym interior.", track("WATER_GYM_01")),
  entry("buildings", "Gear Station / Battle Subway", "Station and train interior music; battles use separate sequences.", track("GEAR_STATION", "Station"), track("BATTLE_SUBWAY", "Subway")),
  entry("buildings", "Pokémon League", "League area themes; not Elite Four or Champion battle music.", track("POKEMON_LEAGUE", "Main"), track("POKEMON_LEAGUE2", "Variant")),
  entry("buildings", "Pokémon World Tournament (PWT)", "Lobby and tournament arena music; battle themes are listed under Battles.", track("WBT_LOBBY", "Lobby"), track("WBT_GROUND", "Arena")),
  entry("buildings", "Musical Theater", "Theater lobby, not the musical performance tracks.", track("MSL_FIELD")),
  entry("buildings", "Pokéstar Studios", "Studios grounds; movie/battle scenario tracks are separate.", track("PW_LAND")),
  entry("buildings", "Join Avenue", "Avenue theme.", track("REZO_RIZO")),
  entry("buildings", "Poké Transfer Lab", "Transfer facility music.", track("PALPARK")),
  entry("buildings", "Unity Tower", "Tower interior theme.", track("UNITED_NATIONS")),
  entry("buildings", "Royal Unova", "Cruise ship music.", track("PLEASURE_BOAT")),

  entry("areas", "Dreamyard / Pinwheel Forest / Moor of Icirrus", "Shared with Rumination Field and Pledge Grove. Not every exterior or event in these areas uses this track.", track("D_01")),
  entry("areas", "Chargestone / Wellspring / Mistralton / Seaside Caves", "Shared with Guidance Chamber, Relic Passage, parts of Desert Resort and retained Challenger's Cave maps.", track("D_02")),
  entry("areas", "Twist Mountain / Clay Tunnel", "Shared with Liberty Garden and P2 Laboratory interiors.", track("D_03")),
  entry("areas", "Relic Castle", "Dungeon theme.", track("D_04")),
  entry("areas", "Dragonspiral Tower / Celestial Tower / Giant Chasm", "Shared dungeon theme; Giant Chasm story events may override it.", track("D_05")),
  entry("areas", "Abundant Shrine / Lostlorn Forest / Nature Preserve", "Shared area theme.", track("D_06")),
  entry("areas", "Victory Road", "Dungeon theme; not the wild-battle music used here.", track("D_CHAMPROAD")),
  entry("areas", "Floccesy Ranch", "Ranch area theme; some surrounding maps use the Routes 19/20 tracks.", track("SW_D_22")),
  entry("areas", "Virbank Complex", "Complex interior-area theme; surrounding maps share Virbank City music.", track("SW_D_23")),
  entry("areas", "Castelia Sewers", "Sewer dungeon theme.", track("SW_D_GESUI")),
  entry("areas", "Reversal Mountain", "Exterior and version-specific cave themes.", track("SW_KAZAN", "Exterior"), track("SW_D_24_B", "Black 2 cave"), track("SW_D_24_W", "White 2 cave")),
  entry("areas", "Strange House", "Haunted-house interior theme.", track("SW_D_25")),
  entry("areas", "Plasma Frigate", "Three area/event variants; the ship's battle music is separate.", track("SW_D_27_F_AJITO", "F variant"), track("SW_D_27_L_AJITO", "L variant"), track("SW_D_27_G_AJITO", "G variant")),
  entry("areas", "Underground Ruins / Regi chambers", "Rock Peak, Iceberg and Iron chambers; not the Regi battle theme.", track("SW_D_REGI")),
  entry("areas", "Cave of Being", "Cave theme; not the lake guardians' battle theme.", track("SW_D_UMA")),
  entry("areas", "N's Castle / N's room", "Castle and room themes; N's battle music is separate.", track("SW_D_N_CASTLE", "Castle"), track("SW_D_N_ROOM", "Room")),
  entry("areas", "Black Tower / White Treehollow", "Facility lobby and interior tracks. Key System settings determine the available facility.", track("MUGEN_lobby_B", "Black Tower lobby"), track("MUGEN_D_B", "Black Tower"), track("MUGEN_lobby_W", "White Treehollow lobby"), track("MUGEN_D_W", "White Treehollow")),
  entry("areas", "Hidden Grotto", "Hidden Grotto overworld theme.", track("KEMONOMICHI")),
  entry("areas", "Entralink / Entree Forest", "Shared area theme.", track("PALACE")),
  entry("areas", "Skyarrow Bridge", "Bridge theme.", track("H_01")),
  entry("areas", "Driftveil Drawbridge", "Bridge theme.", track("H_02")),
  entry("areas", "Tubeline Bridge", "Bridge theme.", track("H_03")),
  entry("areas", "Village Bridge", "Bridge theme; live instrument/vocal layers are not recreated by a mixed stream.", track("H_04")),
  entry("areas", "Marvelous Bridge", "Bridge theme.", track("H_05")),
  entry("areas", "Marine Tube", "Underwater tunnel theme.", track("SW_H_06")),

  entry("travel", "Bicycle", "Cycling music where enabled; can override the area's normal theme.", track("BICYCLE")),
  entry("travel", "Surfing", "Surf music where enabled; not the wild-battle theme for water encounters.", track("NAMINORI")),
  entry("travel", "Diving / Abyssal Ruins", "Underwater exploration music.", track("DIVING")),

  entry("battles", "Wild Pokémon — regular", "Ordinary wild encounters, including most grass, cave, surfing and fishing battles. Special encounters can select other tracks.", track("VS_NORAPOKE")),
  entry("battles", "Wild Pokémon — special / strong", "Double wild battles in dark grass, phenomenon encounters (rustling grass, dust clouds, rippling water), Victory Road wild battles, and certain special encounters such as Volcarona, Latias/Latios, Cresselia and Haxorus.", track("VS_TSUYOPOKE")),
  entry("battles", "Trainer — regular", "Most ordinary trainer battles, including early Colress encounters. Single, double, triple or rotation format alone does not select a unique theme.", track("VS_TRAINER")),
  entry("battles", "Hugh — rival", "Black 2 / White 2 rival battles against Hugh.", track("VS_HUE")),
  entry("battles", "Cheren / Bianca — Memory Link", "Original rival theme used for the returning rivals; Hugh has his own track, and Gym Leader Cheren uses the Gym Leader theme.", track("VS_RIVAL")),
  entry("battles", "Gym Leader", "Unova Gym Leader battles. The last-Pokémon theme is a different sequence.", track("VS_GYMLEADER")),
  entry("battles", "Elite Four", "Shauntal, Grimsley, Caitlin and Marshal.", track("VS_SHITENNO")),
  entry("battles", "Champion Iris", "The Black 2 / White 2 Champion battle.", track("VS_IRIS")),
  entry("battles", "Team Plasma — grunts / Shadow Triad", "Neo Team Plasma battles; Zinzolin, Colress and Ghetsis have separate themes.", track("VS_NEO_PLASMA")),
  entry("battles", "Zinzolin", "Team Plasma sage battle theme.", track("VS_ELITE_PLASMA")),
  entry("battles", "Colress — Plasma boss / postgame", "Boss and postgame Colress battles; early encounters use the regular trainer theme.", track("VS_ACHROMA")),
  entry("battles", "Ghetsis", "Black 2 / White 2 Ghetsis boss battle.", track("VS_NEW_G_CIS")),
  entry("battles", "N", "Black 2 / White 2 battles against N.", track("VS_SWAN_N")),
  entry("battles", "Cynthia", "Cynthia's Undella Town battle; her PWT arrangement is separate.", track("VS_SHIRONA")),
  entry("battles", "Benga", "Black Tower / White Treehollow boss battle.", track("VS_BANJIROU")),
  entry("battles", "Battle Subway", "Regular Battle Subway opponents; Subway Bosses use the original Champion theme.", track("VS_SUBWAY_TRAINER")),
  entry("battles", "Alder / Subway Bosses", "Original Unova Champion theme, also used for Ingo and Emmet. Iris uses a different track.", track("VS_CHAMP")),
  entry("battles", "Cobalion / Terrakion / Virizion", "Unova stationary legendary battle theme; also assigned to the Victini/Keldeo encounter branches.", track("VS_SETPOKE")),
  entry("battles", "Reshiram / Zekrom", "Legendary dragon battle variants.", track("VS_SHIN", "Reshiram"), track("VS_MU", "Zekrom")),
  entry("battles", "Kyurem", "Normal Kyurem and the two fused forms use different sequences.", track("VS_RAI", "Normal"), track("VS_KYUROMU", "Black Kyurem"), track("VS_KYURAMU", "White Kyurem")),
  entry("battles", "Regirock / Regice / Registeel / Regigigas", "Regi legendary battles.", track("VS_REGI")),
  entry("battles", "Uxie / Mesprit / Azelf", "Lake guardian legendary battles.", track("VS_UMA")),
  entry("battles", "Heatran", "Sinnoh legendary battle theme used for Heatran.", track("VS_DPLEGEND")),
  entry("battles", "Tornadus / Thundurus / Landorus — retained theme", "Assigned by the encounter-selection logic, but these are not ordinary catchable overworld encounters in retail BW2.", track("VS_MOVEPOKE")),
  entry("battles", "PWT — tournament / finals", "Generic tournament opponents and non-Champions tournament finals. Named opponents can use their own themes in earlier rounds.", track("VS_WBT")),
  entry("battles", "PWT — Kanto", "Kanto Gym Leaders and Champion Blue arrangements.", track("VS_RG_LEADER", "Gym Leaders"), track("VS_RG_CHAMP", "Blue")),
  entry("battles", "PWT — Johto", "Johto Gym Leaders and Champion Lance arrangements.", track("VS_GS_LEADER", "Gym Leaders"), track("VS_GS_CHAMP", "Lance")),
  entry("battles", "PWT — Hoenn", "Hoenn Gym Leaders and Champions Steven / Wallace arrangements.", track("VS_RS_LEADER", "Gym Leaders"), track("VS_RS_CHAMP", "Champions")),
  entry("battles", "PWT — Sinnoh", "Sinnoh Gym Leaders and Champion Cynthia arrangements.", track("VS_DP_LEADER", "Gym Leaders"), track("VS_DP_CHAMP", "Cynthia")),
  entry("battles", "Link / Wi-Fi battles", "Communication-battle variants; the local link host and guest use different sequences (not single versus multi battle formats).", track("VS_TRAINER_M", "Link host"), track("VS_TRAINER_S", "Link guest"), track("VS_TRAINER_WIFI", "Wi-Fi")),
  entry("battles", "World Championships", "Championship / specially configured download tournament battle music.", track("VS_WCS")),

  entry("battleEvents", "Low HP", "Danger / low-health music can take over during a battle. Replacing the main battle theme does not replace this sequence.", track("BATTLEPINCH")),
  entry("battleEvents", "Gym Leader — last Pokémon", "Victory Is Right Before Your Eyes! Triggered by the Gym Leader's last-Pokémon phase; separate from the opening battle theme.", track("BATTLESUPERIOR")),
  entry("battleEvents", "Victory — wild / trainer", "Post-battle victory music, not the active battle theme.", track("WIN1", "Wild"), track("WIN2", "Trainer")),
  entry("battleEvents", "Victory — Gym Leader / Elite Four", "Victory against Unova Gym Leaders and Elite Four members.", track("WIN3")),
  entry("battleEvents", "Victory — Plasma bosses", "Victory against Ghetsis and boss Colress.", track("WIN4")),
  entry("battleEvents", "Victory — Champion / Subway Boss", "Champion and Subway Boss victory music.", track("WIN5")),
  entry("battleEvents", "Victory — Team Plasma", "Team Plasma and Zinzolin victory music.", track("WIN6")),
  entry("battleEvents", "Victory — PWT", "Tournament battle victory music.", track("WIN_WBT")),
];

export function buildMusicReference(sequences: ReadonlyArray<{ id: number; symbol: string }>): MusicReferenceEntry[] {
  const bySymbol = new Map(sequences.map((sequence) => [sequence.symbol, sequence.id]));
  return BW2_MUSIC_REFERENCE.flatMap((definition) => {
    const tracks = definition.tracks.flatMap((item) => {
      const id = bySymbol.get(item.symbol);
      return id === undefined ? [] : [{ ...item, id }];
    });
    return tracks.length ? [{ ...definition, tracks }] : [];
  });
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function filterMusicReference(entries: readonly MusicReferenceEntry[], search: string, category: MusicReferenceFilter): MusicReferenceEntry[] {
  const terms = normalizeSearch(search).trim().split(/\s+/u).filter(Boolean);
  return entries.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    const text = normalizeSearch([
      item.title, item.description, MUSIC_REFERENCE_CATEGORIES[item.category],
      ...item.tracks.flatMap((part) => [String(part.id), part.label, part.symbol]),
    ].join(" "));
    return terms.every((term) => text.includes(term));
  });
}

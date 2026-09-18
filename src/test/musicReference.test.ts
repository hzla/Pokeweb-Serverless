import { describe, expect, it } from "vitest";
import {
  buildMusicReference, BW2_MUSIC_REFERENCE, filterMusicReference, MUSIC_REFERENCE_CATEGORIES,
} from "../pokeweb/musicReference";
import { renderMusicReferenceRows } from "../ui/musicEditor";

const sequences = [
  { id: 1060, symbol: "SEQ_BGM_POKECEN" },
  { id: 1104, symbol: "SEQ_BGM_SW_C_12" },
  { id: 1128, symbol: "SEQ_BGM_VS_NORAPOKE" },
  { id: 1129, symbol: "SEQ_BGM_VS_TSUYOPOKE" },
  { id: 1130, symbol: "SEQ_BGM_VS_TRAINER" },
  { id: 1132, symbol: "SEQ_BGM_VS_GYMLEADER" },
  { id: 1146, symbol: "SEQ_BGM_BATTLEPINCH" },
  { id: 1147, symbol: "SEQ_BGM_BATTLESUPERIOR" },
  { id: 1176, symbol: "SEQ_BGM_SW_R_19_SP" },
  { id: 1177, symbol: "SEQ_BGM_SW_R_19_SU" },
  { id: 1178, symbol: "SEQ_BGM_SW_R_19_AU" },
  { id: 1179, symbol: "SEQ_BGM_SW_R_19_WI" },
  { id: 1260, symbol: "SEQ_BGM_VS_IRIS" },
  { id: 1262, symbol: "SEQ_BGM_VS_HUE" },
];

describe("BW2 music reference", () => {
  it("uses unique BGM symbols and includes every category", () => {
    const symbols = BW2_MUSIC_REFERENCE.flatMap((entry) => entry.tracks.map((track) => track.symbol));
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols.every((symbol) => symbol.startsWith("SEQ_BGM_"))).toBe(true);
    expect(new Set(BW2_MUSIC_REFERENCE.map((entry) => entry.category))).toEqual(new Set(Object.keys(MUSIC_REFERENCE_CATEGORIES)));
    expect(BW2_MUSIC_REFERENCE.every((entry) => entry.title && entry.description && entry.tracks.length)).toBe(true);
  });

  it("resolves IDs from the loaded SDAT, including shifted IDs and ID zero", () => {
    const entries = buildMusicReference([
      { id: 4000, symbol: "SEQ_BGM_POKECEN" },
      { id: 0, symbol: "SEQ_BGM_VS_HUE" },
      { id: 1128, symbol: "SEQ_PV001" },
    ]);
    expect(entries.map((entry) => [entry.title, entry.tracks[0].id])).toEqual([
      ["Pokémon Center", 4000], ["Hugh — rival", 0],
    ]);
  });

  it("omits missing symbols and keeps only available seasonal variants", () => {
    expect(buildMusicReference([])).toEqual([]);
    const entries = buildMusicReference([{ id: 1179, symbol: "SEQ_BGM_SW_R_19_WI" }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].tracks).toEqual([{ id: 1179, label: "Winter", symbol: "SEQ_BGM_SW_R_19_WI" }]);
  });

  it("groups seasons in spring / summer / autumn / winter order", () => {
    const entries = filterMusicReference(buildMusicReference(sequences), "route 19", "routes");
    expect(entries).toHaveLength(1);
    expect(entries[0].tracks.map((track) => [track.label, track.id])).toEqual([
      ["Spring", 1176], ["Summer", 1177], ["Autumn", 1178], ["Winter", 1179],
    ]);
  });

  it("labels version-specific Opelucid music separately", () => {
    const entries = buildMusicReference([
      { id: 1033, symbol: "SEQ_BGM_C_08_B" }, { id: 1034, symbol: "SEQ_BGM_C_08_W" },
    ]);
    expect(entries[0].tracks.map((track) => [track.label, track.id])).toEqual([["Black 2", 1033], ["White 2", 1034]]);
    expect(entries[0].description).toContain("runtime");
  });

  it("searches names without case or accent sensitivity", () => {
    expect(filterMusicReference(buildMusicReference(sequences), "  POKEMON center  ", "all")[0].tracks[0].id).toBe(1060);
  });

  it("searches IDs, symbols, variant labels and battle descriptions", () => {
    const entries = buildMusicReference(sequences);
    for (const search of ["1129", "seq_bgm_vs_tsuyopoke", "double wild", "Volcarona"]) {
      expect(filterMusicReference(entries, search, "all")[0].tracks[0].id).toBe(1129);
    }
    expect(filterMusicReference(entries, "route 19 winter", "all")[0].tracks.at(-1)?.id).toBe(1179);
  });

  it("combines the category and search filters without changing the input", () => {
    const entries = buildMusicReference(sequences);
    const snapshot = JSON.stringify(entries);
    expect(filterMusicReference(entries, "", "battles").every((entry) => entry.category === "battles")).toBe(true);
    expect(filterMusicReference(entries, "pokemon center", "battles")).toEqual([]);
    expect(filterMusicReference(entries, "not a real track", "all")).toEqual([]);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });

  it("keeps wild, trainer, boss and mid-battle music separate", () => {
    const entries = buildMusicReference(sequences);
    const byId = (id: number) => entries.find((entry) => entry.tracks.some((track) => track.id === id))!;
    expect(byId(1128).title).toBe("Wild Pokémon — regular");
    expect(byId(1129).description).toContain("Victory Road");
    expect(byId(1130).description).toContain("triple");
    expect(byId(1132).title).toBe("Gym Leader");
    expect(byId(1260).title).toBe("Champion Iris");
    expect(byId(1262).title).toBe("Hugh — rival");
    expect(byId(1146).category).toBe("battleEvents");
    expect(byId(1147).title).toContain("last Pokémon");
  });

  it("renders accessible selection buttons and an empty state", () => {
    const html = renderMusicReferenceRows(buildMusicReference([{ id: 1128, symbol: "SEQ_BGM_VS_NORAPOKE" }]), 1128);
    expect(html).toContain('scope="row"');
    expect(html).toContain('data-music-reference-id="1128" aria-pressed="true"');
    expect(html).toContain('aria-label="Use 1128 for Wild Pokémon — regular"');
    expect(renderMusicReferenceRows([], 0)).toContain("No matching tracks");
  });

  it("escapes reference content in text and attributes", () => {
    const html = renderMusicReferenceRows([{
      category: "battles", title: '<img src=x onerror="bad">', description: "A & B",
      tracks: [{ id: 123, label: '" onclick="bad', symbol: "<script>" }],
    }], 0);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("&quot; onclick=&quot;bad");
  });
});

import type { Assets, Image } from "./assets";
import type { Diagnostic, Element, GameData, SummaryPage } from "./document";
import { STATS } from "./document";
import { selectedPokemon, viewInfo, type Interaction } from "./interaction";
import { blank, blit, fill, text } from "./raster";
import { composeSummary, type SummaryArt } from "./summaryAssets";

export type CompiledSummaryPreview = {
  regions: Record<string, Element>;
  layers: Record<string, string>;
  sprites: Record<string, { key: string; x: number; y: number }>;
} & Pick<SummaryArt, "palette" | "platePalette" | "hpPalette" | "typeNames">;
const NATURES = ["Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax", "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash", "Calm", "Gentle", "Sassy", "Careful", "Quirky"];
const NATURE_STATS = ["attack", "defense", "speed", "spAttack", "spDefense"];

/** Native actors stay clipped to their editable allocation. Resizing a window
 * reallocates space; it never stretches the font or Pokémon artwork. */
export function drawSummaryRegion(target: Image, e: Element, art: CompiledSummaryPreview, image: (key: string) => Image | undefined, assets: Assets, data: GameData, session: Interaction, diagnostics: Diagnostic[], screenId: string): void {
  const [, page, key] = e.native!.split(".") as [string, SummaryPage, string], state = session.stack.at(-1)!, rawPokemon = selectedPokemon(data, state), p = rawPokemon && (assets.summaryPokemon?.(rawPokemon) ?? rawPokemon);
  const local = blank(e.width, e.height), palette = art.palette, info = viewInfo(data, state);
  const sprite = (name: string, x: number, y: number) => {
    const s = art.sprites[name], resource = s && image(s.key); if (resource) blit(local, resource, { x: x + s.x, y: y + s.y, width: resource.width, height: resource.height });
  };
  const words = (value: string | number | undefined, x: number, y: number, width: number, color = 1, align: Element["align"] = "left", shadow = 2, colors = palette, wrap = false) => {
    if (value === undefined || value === "") return;
    const allocation = { ...e, id: e.id, x, y, width: Math.max(0, Math.min(width, local.width - x)), height: Math.max(0, local.height - y + 1), font: 0, align, wrap, paint: { ...e.paint, foreground: colors[color], shadow: colors[shadow] } };
    if (allocation.width && allocation.height) text(local, allocation, String(value), assets, diagnostics, screenId, 16);
  };
  const type = (name: string | undefined, x: number, y: number) => { const index = art.typeNames.findIndex(t => t.toLowerCase() === name?.toLowerCase()); if (index >= 0) sprite(`type-${index}`, x, y); };
  if (key.endsWith("-art")) {
    const physical = key.startsWith("top") ? "top" : "bottom", prefix = `summary:${page}:${physical}`, layers: Record<string, Image> = {};
    for (const suffix of ["grid", "plate", "title"]) { const resource = image(art.layers[`${prefix}:${suffix}`]); if (resource) layers[suffix] = resource; }
    if (layers.grid && layers.plate) blit(local, composeSummary(layers, session.frame), { x: 0, y: 0, width: 256, height: 192 });
    if (physical === "bottom") {
      const footer = image(art.layers.footer); if (footer) blit(local, footer, { x: 0, y: 0, width: footer.width, height: footer.height });
      const selected = page === "info" ? 0 : page === "ribbons" ? 2 : 1;
      for (let i = 0; i < (page === "ribbons" ? 3 : 2); i++) sprite(`page-${i + (i === selected ? 3 : 0)}`, i * 40, 168);
      sprite("check", 124, 172); sprite("up", 144, 168); sprite("down", 168, 168); sprite("exit", 200, 168); sprite("back", 232, 168);
      if (p && !p.egg) for (let i = 0; i < 6; i++) sprite(`mark-${i * 2 + Number(!!p.markings?.[i])}`, 179 + i * 11, 127);
    }
  } else if (p) {
    if (key === "nickname") {
      words(p.nickname, 25, 1, e.width - 40);
      if (!p.egg) { sprite(`ball-${p.ball ?? 3}`, 16, 8); if (p.gender && p.gender !== "none") words(p.gender === "female" ? "♀" : "♂", 89, 1, 15, p.gender === "female" ? 3 : 5, "left", p.gender === "female" ? 4 : 6); }
    } else if (key === "pokemon") {
      const resource = assets.pokemonSprite?.(p);
      if (resource) blit(local, resource, { x: Math.floor((e.width - resource.width) / 2), y: e.height - resource.height, width: resource.width, height: resource.height });
      else diagnostics.push({ severity: "warning", code: "summary-sprite", screen: screenId, element: e.id, message: p.egg ? "Egg artwork is not available in this Summary preview." : "This Pokémon's static front sprite is unavailable in the loaded ROM." });
    } else if (key === "memo") {
      words(p.memo, 0, 0, e.width, 1, "left", 2, palette, true);
    } else if (!p.egg) {
      if (key === "level") words(`Lv. ${p.level}`, 9, 1, e.width - 9);
      else if (key === "item") { words("Item", 9, 1, e.width - 9); words(p.heldItem || "None", 5, 17, e.width - 5); }
      else if (page === "stats" && STATS.includes(key as typeof STATS[number])) {
        if (key === "hp") {
          words("HP", 25, 1, 40, 15); words(p.hp, 49, 1, 40, 1, "right"); words("/", 89, 1, 8); words(p.maxHp, 97, 1, 24, 1, "right");
        } else {
          const label = { attack: "Attack", defense: "Defense", spAttack: "Sp. Atk", spDefense: "Sp. Def", speed: "Speed" }[key];
          const nature = NATURES.findIndex(n => n.toLowerCase() === p.nature?.toLowerCase()), up = Math.floor(nature / 5), down = nature % 5;
          const shadow = nature >= 0 && up !== down ? key === NATURE_STATS[up] ? 9 : key === NATURE_STATS[down] ? 10 : 2 : 2;
          words(label, 1, 1, 72, 15, "left", shadow); words(p.stats?.[key as keyof typeof p.stats], 73, 1, Math.max(0, e.width - 80), 1, "right");
        }
      } else if (key === "hp-bar") {
        sprite("hp-frame", 39, 4);
        const width = Math.min(48, Math.max(0, Math.floor(48 * p.hp / Math.max(1, p.maxHp)))), color = p.hp * 5 <= p.maxHp ? 7 : p.hp * 2 <= p.maxHp ? 9 : 5;
        fill(local, { x: 16, y: 3, width, height: 1 }, art.hpPalette[color + 1]); fill(local, { x: 16, y: 4, width, height: 1 }, art.hpPalette[color]);
      } else if (key === "ability") {
        words("Ability", 5, 1, 56, 15); words(p.ability, 65, 1, e.width - 65);
        words(p.abilityDescription, 5, 17, e.width - 5, 1, "left", 2, palette, true);
      } else if (key.startsWith("move-")) {
        const row = Number(key.slice(5)), m = p.moves[row], dy = row === 0 ? 8 : 0;
        if (m) {
          sprite(`move-${page === "moves" && row === (state.moveSelection?.index ?? 0) ? "selected-" : ""}${row}`, 0, dy);
          type(m.type, 24, 8 + dy);
          words(m.name, 41, 1 + dy, e.width - 41, 1, "left", 2, art.platePalette);
          words("PP", 53, 17 + dy, 24, 1, "left", 2, art.platePalette);
          words(m.pp, 73, 17 + dy, 24, 1, "right", 2, art.platePalette); words("/", 97, 17 + dy, 8, 1, "left", 2, art.platePalette);
          words(m.maxPp ?? m.pp, 101, 17 + dy, e.width - 101, 1, "left", 2, art.platePalette);
        }
      } else if (page === "moves") {
        const m = p.moves[state.moveSelection?.index ?? 0];
        if (m) {
          if (key === "category") { words("Category", 1, 1, 64, 15); sprite(`category-${m.category.toLowerCase() === "physical" ? 1 : m.category.toLowerCase() === "special" ? 2 : 0}`, 92, 8); }
          else if (key === "power" || key === "accuracy") { words(key === "power" ? "Power" : "Accuracy", 1, 1, 72, 15); const absent = m[key] <= (key === "power" ? 1 : 0) || key === "accuracy" && m[key] > 100; words(absent ? "---" : String(m[key]).padStart(3, " "), absent ? 87 : 81, 1, e.width - (absent ? 87 : 81)); }
          else if (key === "description") words(m.description, 1, 1, e.width - 1, 1, "left", 2, palette, true);
        }
      } else if (page === "info") {
        const labels: Record<string, string> = { dex: "Dex No.", species: "Name", type: "Type", ot: "OT", id: "ID No.", experience: "Exp. Points", "next-level": "To Next Lv." };
        const values: Record<string, string | number | undefined> = { dex: p.dexNumber ?? String(p.species).padStart(3, "0"), species: p.speciesName ?? info?.name, ot: p.ot, id: p.trainerId };
        if (labels[key]) words(labels[key], 1, 1, 80, 15);
        if (key === "type") { type(p.types[0], 80, 8); if (p.types[1]) type(p.types[1], 112, 8); }
        else if (values[key] !== undefined) words(values[key], 65, 1, e.width - 65, key === "ot" ? 3 : 1, "left", key === "ot" ? 4 : 2);
        else if (key === "experience" || key === "next-level") words(key === "experience" ? p.experience : p.nextLevelExperience, 65, 17, e.width - 65, 1, "right");
        else if (key === "exp-bar" && p.experienceProgress !== undefined) fill(local, { x: 0, y: 3, width: Math.floor(Math.max(0, Math.min(1, p.experienceProgress)) * e.width), height: 2 }, "#2828ff");
      }
    }
  }
  blit(target, local, e);
}

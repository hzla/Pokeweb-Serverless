import messages from "../../runtime/learnset-viewer/info_messages.json";
import { readU16 } from "../nds/binary";
import { getPokemonExportRecord } from "../pokeweb/pokemonModel";
import { getMoveRecord } from "../pokeweb/moveItemModel";
import { getTextBank } from "../pokeweb/textModel";
import type { ProjectState } from "../pokeweb/projectStore";
import type { GameData, SpeciesInfo } from "./document";

/** Preview reads edited ROM records. It never fabricates stats or learnsets. */
export function withLearnsetData(project: ProjectState, sample: GameData): GameData {
  const result = structuredClone(sample); result.catalog = {};
  const personal = project.narcs.personal, evolutions = project.narcs.evolutions;
  if (!personal || !evolutions || !project.narcs.learnsets || !project.narcs.moves) return result;
  const identities = new Map<number, { species: number; form: number }>(), parents = new Map<number, number>(), children = new Map<number, number[]>();
  for (let i = 1; i < personal.rawFiles.length; i++) if (personal.rawFiles[i]?.length >= 33) identities.set(i, { species: i, form: 0 });
  for (const [i, identity] of identities) {
    if (identity.form) continue; const raw = personal.rawFiles[i], first = readU16(raw, 28), count = raw[32];
    if (first && count > 1 && count <= 32 && first + count - 1 <= personal.rawFiles.length) for (let f = 1; f < count; f++) if (identities.has(first + f - 1)) identities.set(first + f - 1, { species: i, form: f });
  }
  const resolve = (species: number, form: number) => { const raw = personal.rawFiles[species]; return form && raw?.length >= 33 && raw[32] > form && readU16(raw, 28) ? readU16(raw, 28) + form - 1 : species; };
  for (let i = 1; i < evolutions.rawFiles.length; i++) {
    const bytes = evolutions.rawFiles[i], out: number[] = [];
    if (!bytes || bytes.length % 6) continue;
    for (let j = 0; j + 6 <= bytes.length; j += 6) { const method = readU16(bytes, j), target = readU16(bytes, j + 4); if (method && identities.has(target)) { if (!out.includes(target)) out.push(target); if (!parents.has(target)) parents.set(target, i); } }
    children.set(i, out);
  }
  const pending = sample.party.filter(p => !p.egg).map(p => resolve(p.species, p.form)), seen = new Set<number>();
  const templates = Object.fromEntries(messages);
  const descriptions = getTextBank(project, "message_texts", 402);
  while (pending.length && seen.size < 128) {
    const id = pending.shift()!; if (seen.has(id) || !identities.has(id)) continue; seen.add(id);
    const identity = identities.get(id)!, record = getPokemonExportRecord(project, id), raw = record.rawPersonal, p = record.personal;
    const abilities: SpeciesInfo["abilities"] = [], used = new Set<number>();
    for (let slot = 1; slot <= 3; slot++) { const ability = Number(raw[`ability_${slot}`]); if (!ability || used.has(ability)) continue; used.add(ability); abilities.push({ name: String(p[`ability_${slot}`] ?? ability), hidden: slot === 3 }); }
    const chain: number[] = [id]; let parent = parents.get(id); const cycle = new Set([id]);
    while (parent && chain.length < 3 && !cycle.has(parent)) { chain.unshift(parent); cycle.add(parent); parent = parents.get(parent); }
    let next = children.get(id)?.[0]; while (next && chain.length < 3 && !cycle.has(next)) { chain.push(next); cycle.add(next); next = children.get(next)?.[0]; }
    // Keep the selected stage in a three-icon window; siblings are queued too.
    pending.push(...chain, ...(children.get(id) ?? [])); if (parents.has(id)) pending.push(parents.get(id)!);
    const name = String(p.name ?? project.texts.banks.pokedex?.[identity.species] ?? `#${identity.species}`);
    const own = record.evolutions.filter(e => e.methodId && identities.has(e.targetId));
    const evolutionPages = own.map(e => ({ title: `${name} → ${e.target}`, text: (templates[`Method${e.methodId}`] ?? templates.Unknown).replace("{0}", String(e.methodId <= 31 ? e.param : e.methodId)).replace("{1}", String(e.paramRaw)) }));
    if (!evolutionPages.length && parents.has(id)) {
      const previous = getPokemonExportRecord(project, parents.get(id)!); const e = previous.evolutions.filter(e => e.targetId === id && e.methodId).at(-1);
      if (e) evolutionPages.push({ title: templates.NoFurtherEvolution, text: `From ${previous.personal.name}: ${(templates[`Method${e.methodId}`] ?? templates.Unknown).replace("{0}", String(e.methodId <= 31 ? e.param : e.methodId)).replace("{1}", String(e.paramRaw))}` });
    }
    if (!evolutionPages.length) evolutionPages.push({ title: parents.has(id) ? templates.NoFurtherEvolution : templates.NoEvolution, text: "" });
    result.catalog[`${identity.species}:${identity.form}`] = { ...identity, name, types: [String(p.type_1), ...(p.type_1 === p.type_2 ? [] : [String(p.type_2)])], abilities,
      stats: ["base_hp", "base_atk", "base_def", "base_spatk", "base_spdef", "base_speed"].map(k => Number(raw[k])), family: chain.map(i => identities.get(i)!), evolutionPages,
      learnset: record.learnset.map(move => { const detail = getMoveRecord(project, move.moveId); return { name: move.moveName, type: move.type, category: move.category, level: move.level, power: Number(move.power) || 0, accuracy: Number(move.accuracy) || 0, pp: Number(detail.raw.pp), description: descriptions[move.moveId]?.[1]?.replace(/\\n/g, "\n") ?? "" }; }),
    };
  }
  return result;
}

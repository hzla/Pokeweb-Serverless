import { STATS, type Action, Document, Element, GameData, Pokemon, Screen, TextSource } from "./document";
export type Direction = "up" | "down" | "left" | "right";
export type FrameState = { screen: string; focus?: string; selectedParty: number; lists: Record<string, { index: number; scroll: number }>; view?: { species: number; form: number }; evolutionPage?: number; moveSelection?: { source: "moves" | "learnset"; index: number } };
export type Interaction = { stack: FrameState[]; closed: boolean; frame: number; pressed?: string; nativeRequest?: "summary" | "learnset"; sound?: "cursor" | "confirm" | "cancel" };
export function selectedPokemon(data: GameData, state: FrameState): Pokemon | undefined { return data.party[state.selectedParty]; }
export function viewInfo(data: GameData, state: FrameState) { const p = state.view ?? selectedPokemon(data, state); return p && data.catalog?.[`${p.species}:${p.form}`]; }
export function listMoves(source: "moves" | "learnset", data: GameData, state: FrameState) { return source === "learnset" ? viewInfo(data, state)?.learnset ?? [] : selectedPokemon(data, state)?.egg ? [] : selectedPokemon(data, state)?.moves ?? []; }
export function resolveText(source: TextSource, data: GameData, state: FrameState, row?: { pokemon?: Pokemon; move?: Pokemon["moves"][number] }): string {
  if ("literal" in source) return source.literal;
  const pokemon = row?.pokemon ?? selectedPokemon(data, state), info = viewInfo(data, state), move = row?.move ?? listMoves(state.moveSelection?.source ?? "learnset", data, state)[state.moveSelection?.index ?? 0];
  const page = info?.evolutionPages[(state.evolutionPage ?? 0) % (info.evolutionPages.length || 1)];
  const values: Record<string, string | number | undefined> = {
    "trainer.name": data.trainer.name, "trainer.playTime": data.trainer.playTime, "trainer.badges": data.trainer.badges,
    "location.name": data.location.name, "party.count": data.party.length, "party.selected": pokemon ? state.selectedParty + 1 : "",
    "party.position": pokemon ? `< ${state.selectedParty + 1}/${data.party.length} >` : "",
    "pokemon.nickname": pokemon?.nickname, "pokemon.species": pokemon?.species, "pokemon.form": pokemon?.form,
    "pokemon.level": pokemon?.egg ? "" : pokemon?.level, "pokemon.hp": pokemon?.egg ? "" : pokemon?.hp, "pokemon.maxHp": pokemon?.egg ? "" : pokemon?.maxHp,
    "pokemon.status": pokemon?.egg ? "Egg" : pokemon?.status, "pokemon.type1": pokemon?.egg ? "" : pokemon?.types[0], "pokemon.type2": pokemon?.egg ? "" : pokemon?.types[1],
    ...Object.fromEntries(Object.entries(move ?? {}).map(([k, v]) => [`move.${k}`, v])),
    "view.name": info?.name, "view.type1": info?.types[0], "view.type2": info?.types[1],
    "view.ability1": info?.abilities[0]?.name, "view.ability2": info?.abilities[1]?.name, "view.ability3": info?.abilities[2]?.name,
    ...Object.fromEntries(["hp", "attack", "defense", "spAttack", "spDefense", "speed"].map((k, i) => [`view.${k}`, info?.stats[i]])),
    "view.evolutionTitle": page?.title, "view.evolutionText": page?.text,
    "view.evolutionPage": (info?.evolutionPages.length ?? 0) > 1 ? `A ${(state.evolutionPage ?? 0) + 1}/${info!.evolutionPages.length}` : "",
  };
  for (const stat of STATS) {
    values[`pokemon.ev.${stat}`] = pokemon?.egg ? undefined : pokemon?.evs?.[stat];
    values[`pokemon.iv.${stat}`] = pokemon?.egg ? undefined : pokemon?.ivs?.[stat];
    values[`pokemon.stat.${stat}`] = pokemon?.egg ? undefined : pokemon?.stats?.[stat];
  }
  values["pokemon.ev.total"] = !pokemon?.egg && pokemon?.evs && STATS.every(s => pokemon.evs?.[s] !== undefined) ? STATS.reduce((sum, s) => sum + pokemon.evs![s]!, 0) : undefined;
  for (const key of ["ability", "abilityDescription", "nature", "ot", "trainerId", "experience", "nextLevelExperience", "memo", "heldItem"] as const) values[`pokemon.${key}`] = pokemon?.egg ? undefined : pokemon?.[key];
  if (/^pokemon\.(ev|iv|stat)\./.test(source.binding) && values[source.binding] === undefined) return "";
  let value = String(values[source.binding] ?? ""); if (source.transform === "upper") value = value.toUpperCase(); if (source.transform === "title") value = value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return `${source.prefix ?? ""}${value}${source.suffix ?? ""}`;
}
export function actionAvailable(action: Action, data: GameData, state: FrameState): boolean {
  const p = selectedPokemon(data, state);
  if (action.type === "summary") return !!p;
  if (action.type === "learnset") return !!p && !p.egg && data.learnsetInstalled;
  if (action.type === "selectParty") return !!data.party[action.index];
  return true;
}
export function controls(screen: Screen, data: GameData, state: FrameState): Element[] {
  return screen.elements.filter(e => !e.hidden && !e.disabled && (e.kind === "button" && actionAvailable(e.action, data, state) || e.kind === "list" && listLength(e, data, state) > 0));
}
export function listLength(e: Element, data: GameData, state: FrameState): number { return e.list.source === "party" ? data.party.length : listMoves(e.list.source, data, state).length; }
function enter(screen: Screen, data: GameData, selectedParty: number): FrameState {
  const state: FrameState = { screen: screen.id, selectedParty, lists: {} };
  for (const e of screen.elements.filter(e => e.kind === "list")) state.lists[e.id] = { index: e.list.source === "party" ? selectedParty : 0, scroll: 0 };
  state.focus = controls(screen, data, state)[0]?.id; return state;
}
export function start(doc: Document, data: GameData, launcher: "field" | "party", partySlot = 0): Interaction {
  const id = doc.launchers[launcher], screen = doc.screens.find(s => s.id === id);
  if (!screen) throw new Error(`Assign a starting screen to the ${launcher} launcher.`);
  let selected = launcher === "field" ? data.party.findIndex(p => !p.egg && p.species > 0) : partySlot;
  if (selected < 0 || selected >= data.party.length) selected = data.party.length ? 0 : -1;
  return { stack: [enter(screen, data, selected)], closed: false, frame: 0 };
}
export function focusNeighbors(screen: Screen, data: GameData, state: FrameState): Record<string, Partial<Record<Direction, string>>> {
  const items = controls(screen, data, state), output: Record<string, Partial<Record<Direction, string>>> = {};
  for (const item of items) {
    const neighbors: Partial<Record<Direction, string>> = {};
    for (const direction of ["up", "down", "left", "right"] as const) {
      const override = item.neighbors[direction]; if (override && items.some(e => e.id === override)) { neighbors[direction] = override; continue; }
      let score = Infinity;
      for (const target of items) {
        if (target === item) continue;
        const dx = target.x + target.width / 2 - item.x - item.width / 2;
        const dy = target.y + target.height / 2 + (target.screen === "bottom" ? 208 : 0) - item.y - item.height / 2 - (item.screen === "bottom" ? 208 : 0);
        const along = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
        const across = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        if (along <= 0) continue;
        const value = along + across * 4; if (value < score) { score = value; neighbors[direction] = target.id; }
      }
    }
    output[item.id] = neighbors;
  }
  return output;
}
export function activate(action: Action, doc: Document, data: GameData, session: Interaction): void {
  const state = session.stack.at(-1)!; if (session.closed || session.nativeRequest || !actionAvailable(action, data, state)) return;
  session.sound = "confirm";
  switch (action.type) {
    case "open": { const target = doc.screens.find(s => s.id === action.screen); if (target && session.stack.length < 16) session.stack.push(enter(target, data, state.selectedParty)); break; }
    case "back": if (session.stack.length > 1) session.stack.pop(); else session.closed = true; session.sound = "cancel"; break;
    case "close": session.closed = true; break;
    case "summary": case "learnset": session.nativeRequest = action.type; break;
    case "selectParty": state.selectedParty = action.index; state.lists = {}; state.view = undefined; state.evolutionPage = 0; state.moveSelection = undefined; break;
    case "cycleParty": { let n = state.selectedParty; for (let i = 1; i < data.party.length; i++) { n = (n + action.delta + data.party.length) % data.party.length; if (data.party[n].species && !data.party[n].egg) break; } if (data.party[n] && !data.party[n].egg && data.party[n].species) { state.selectedParty = n; state.view = undefined; state.evolutionPage = 0; state.lists = {}; state.moveSelection = undefined; } break; }
    case "family": { const info = viewInfo(data, state), p = state.view ?? selectedPokemon(data, state); if (!info || !p) break; const i = info.family.findIndex(f => f.species === p.species && f.form === p.form), next = info.family[i + action.delta]; if (next && data.catalog?.[`${next.species}:${next.form}`]) { state.view = next; state.lists = {}; state.moveSelection = undefined; state.evolutionPage = 0; } break; }
    case "nextEvolution": { const pages = viewInfo(data, state)?.evolutionPages.length ?? 0; if (pages) state.evolutionPage = ((state.evolutionPage ?? 0) + 1) % pages; break; }
    case "selectList": { const e = doc.screens.find(s => s.id === state.screen)?.elements.find(e => e.id === action.list); if (e) changeList(e, action.delta, data, state); break; }
    case "sound": session.sound = action.sound; break;
  }
}
function changeList(e: Element, delta: number, data: GameData, state: FrameState): void {
  const list = state.lists[e.id] ??= { index: 0, scroll: 0 }; list.index = Math.max(0, Math.min(listLength(e, data, state) - 1, list.index + delta));
  list.scroll = Math.max(0, Math.min(list.scroll, list.index)); if (list.index >= list.scroll + e.list.rows) list.scroll = list.index - e.list.rows + 1;
  if (e.list.source === "party" && data.party[list.index]) { state.selectedParty = list.index; }
  else if (e.list.source !== "party") state.moveSelection = { source: e.list.source, index: list.index };
}
export function input(doc: Document, data: GameData, session: Interaction, event: Direction | "a" | "b" | "l" | "r" | { x: number; y: number }): void {
  if (session.closed || session.nativeRequest) return;
  const state = session.stack.at(-1)!, screen = doc.screens.find(s => s.id === state.screen)!;
  const items = controls(screen, data, state);
  if (event === "b") return activate({ type: "back" }, doc, data, session);
  if (typeof event === "string" && event !== "up" && event !== "down") { const action = screen.shortcuts?.[event]; if (action) return activate(action, doc, data, session); if (event === "l" || event === "r") return; }
  let focused = items.find(e => e.id === state.focus);
  if (typeof event === "object") {
    focused = [...items].reverse().find(e => e.screen === "bottom" && event.x >= e.x && event.y >= e.y && event.x < e.x + e.width && event.y < e.y + e.height);
    if (!focused) return;
    state.focus = focused.id;
    if (focused.kind === "list") {
      const l = state.lists[focused.id] ??= { index: 0, scroll: 0 }, row = Math.floor((event.y - focused.y) * focused.list.rows / focused.height);
      if (l.scroll + row >= listLength(focused, data, state)) return;
      changeList(focused, l.scroll + row - l.index, data, state);
    }
  } else if (event !== "a") {
    if (focused?.kind === "list" && (event === "up" || event === "down")) {
      const l = state.lists[focused.id] ??= { index: 0, scroll: 0 }, delta = event === "up" ? -1 : 1;
      if (l.index + delta >= 0 && l.index + delta < listLength(focused, data, state)) { changeList(focused, delta, data, state); session.sound = "cursor"; return; }
    }
    state.focus = focused ? focusNeighbors(screen, data, state)[focused.id]?.[event] ?? focused.id : items[0]?.id; session.sound = "cursor"; return;
  }
  if (focused) { session.pressed = focused.id; if (focused.kind === "button") activate(focused.action, doc, data, session); }
}
/** Native requests pause the custom application; owned state remains intact. */
export function completeNative(session: Interaction): void { session.nativeRequest = undefined; session.pressed = undefined; }

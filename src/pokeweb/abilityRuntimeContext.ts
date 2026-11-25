import blackBindings from "../assets/data/abilityBindingsB1.json";
import whiteBindings from "../assets/data/abilityBindingsW1.json";
import bindings from "../assets/data/abilityBindings.json";
import environmentBindings from "../assets/data/abilityEnvironmentBindings.json";
import formConversionBindings from "../assets/data/abilityFormConversionBindings.json";
import statusBindings from "../assets/data/abilityStatusBindings.json";
import strikeBindings from "../assets/data/abilityStrikeBindings.json";
import { equalBytes, readU32 } from "../nds/binary";
import { NintendoDSRom } from "../nds/rom";
import { expandedMoveDllDefaults, validateMoveClassOverrides } from "./abilityMoveClasses";
import type { NativeAbilityProfile } from "./abilityNativeRuntime";
import { battleBranchTarget, battleRuntimeResolver, BATTLE_RUNTIME_SIGNATURES, type BattleRuntimeSignature } from "./battleRuntimeBindings";
import { emptyCustomMoveFlags, validateCustomMoveFlags, type CustomMoveFlagRegistry } from "./customMoveFlags";
import type { ProjectState } from "./projectStore";
import { parseRpm } from "./rpm";

export const ABILITY_EFFECTS_DLL_PATH = "patches/AbilityEffects.dll";

export const RETIRED_ABILITY_DLL = Uint8Array.of(80, 87, 65, 82);

type Source = {
    base: number;
    armBase: number;
    game: string;
    revision: number;
    files: Map<string, Uint8Array>;
    ids: Map<string, number>;
};
const sources = new WeakMap<ProjectState, Source>();
export function supportsAbilityEditor(project: ProjectState): boolean {
    return project.session.baseRom === "BW2" || project.session.baseRom === "BW" && ["B", "W"].includes(project.session.baseVersion);
}
export function hydrateAbilityEffectsSource(project: ProjectState, rom: NintendoDSRom): void {
    if (!supportsAbilityEditor(project))
        return;
    const overlayId = project.session.baseRom === "BW" ? 93 : 167;
    const table = project.patches?.arm9OverlayTable ?? rom.arm9OverlayTable;
    for (let at = 0; at + 32 <= table.length; at += 32)
        if (readU32(table, at) === overlayId) {
            const files = new Map<string, Uint8Array>(), ids = new Map<string, number>();
            for (const directory of ["patches", "lib"])
                for (const name of rom.filenames.folders.find(([folder]) => folder === directory)?.[1].files ?? []) {
                    if (!name.toLowerCase().endsWith(".dll"))
                        continue;
                    const path = `${directory}/${name}`, id = rom.filenames.idOf(path);
                    if (id !== undefined) {
                        files.set(path, rom.files[id].slice());
                        ids.set(path, id);
                    }
                }
            sources.set(project, { base: readU32(table, at + 4), armBase: rom.arm9RamAddress, game: rom.idCode, revision: rom.data[30], files, ids });
            return;
        }
}
/** Collect the battle code, verified handler addresses, and DLLs visible to this build or read. */
export function getAbilityRuntimeContext(project: ProjectState) {
    if (!supportsAbilityEditor(project))
        throw new Error("Ability effects require US Black, White, Black 2 or White 2.");
    const isBw1 = project.session.baseRom === "BW";
    const overlayId = isBw1 ? 93 : 167;
    const catalog = isBw1 ? project.session.baseVersion === "W" ? whiteBindings : blackBindings : bindings;
    const profiles = catalog.profiles as NativeAbilityProfile[];
    const signatures: Record<string, BattleRuntimeSignature> = {...(isBw1 ? catalog.functions : BATTLE_RUNTIME_SIGNATURES), ...statusBindings.profiles[isBw1 ? project.session.baseVersion as "B"|"W" : "BW2"], ...environmentBindings.profiles[isBw1 ? project.session.baseVersion as "B"|"W" : "BW2"], ...strikeBindings.profiles[isBw1 ? project.session.baseVersion as "B"|"W" : "BW2"]};
    if (!isBw1) Object.assign(signatures, formConversionBindings);
    if (!sources.has(project) && project.originalRomBytes)
        hydrateAbilityEffectsSource(project, new NintendoDSRom(project.originalRomBytes, { fileData: "view" }));
    const original = sources.get(project);
    if (!original)
        throw new Error("Reload the ROM with Pokémon selected.");
    const source = { ...original }, table = project.patches?.arm9OverlayTable;
    if (table)
        for (let at = 0; at + 32 <= table.length; at += 32)
            if (readU32(table, at) === overlayId)
                source.base = readU32(table, at + 4);
    if (!(isBw1 ? [project.session.baseVersion === "W" ? "IRAO" : "IRBO"] : ["IRDO", "IREO"]).includes(source.game) || source.revision !== 0)
        throw new Error("Ability effects currently require a recognized US revision-0 Black, White, Black 2 or White 2 ROM.");
    const overlay = project.overlays[overlayId];
    if (!overlay?.length)
        throw new Error("Reload the ROM with Pokémon selected to load the battle overlay.");
    const resolver = battleRuntimeResolver(overlay, source.base, project.arm9, source.armBase, signatures);
    const dispatcher = resolver.resolve("AbilityEvent_AddItem");
    const pointers = catalog.tableRefs.map(ref => readU32(dispatcher.code, ref.offset) - ref.column);
    if (pointers[0] !== pointers[1])
        throw new Error("Unrecognized native ability assignment table.");
    const at = pointers[0] - source.base;
    if (at < 0 || at + catalog.rows.length * 8 > overlay.length || !catalog.rows.every((id, i) => readU32(overlay, at + i * 8) === id))
        throw new Error("Unrecognized native ability assignment table.");
    const availableNative = new Set<number>();
    const fromHex = (s: string) => Uint8Array.from(s.match(/../gu) ?? [], v => Number.parseInt(v, 16));
    for (const profile of profiles) {
        const index = catalog.rows.indexOf(profile.id), factory = (readU32(overlay, at + index * 8 + 4) & ~1) - source.base;
        const expected = fromHex(profile.factoryHex), mask = fromHex(profile.factoryMask);
        if (factory < 0 || factory + expected.length > overlay.length || !expected.every((v, i) => (overlay[factory + i] & mask[i]) === (v & mask[i])))
            continue;
        if (!(profile.factoryCalls??[]).every(call => resolver.matches(call.target, battleBranchTarget(overlay, factory + call.offset, source.base)))) continue;
        const table = readU32(overlay, factory + profile.tableRefOffset) - source.base;
        if (table < 0 || table + profile.events.length * 8 > overlay.length)
            continue;
        if (!profile.events.every((e, i) => readU32(overlay, table + i * 8) === e.event && resolver.matches(e.handler, readU32(overlay, table + i * 8 + 4) & ~1)))
            continue;
        availableNative.add(profile.id);
        profile.events.forEach((e, i) => resolver.seed(e.handler, readU32(overlay, table + i * 8 + 4) & ~1));
    }
    const files = new Map(source.files);
    for (const [path, id] of source.ids)
        if (project.fileSystem?.replacements?.[id])
            files.set(path, project.fileSystem.replacements[id]);
    for (const [path, bytes] of Object.entries(project.fileSystem?.additions ?? {}))
        if (path.toLowerCase().endsWith(".dll"))
            files.set(path, bytes);
    return { project, source, overlay, resolver, dispatcher, files, availableNative, signatures, profiles, overlayModule: String(overlayId) };
}
export type AbilityRuntimeContext = ReturnType<typeof getAbilityRuntimeContext>;

/** Check the loaded ROM without resolving battle services or opening its DLL. */
export function hasOriginalAbilityDll(project: ProjectState): boolean {
    return sources.get(project)?.files.has(ABILITY_EFFECTS_DLL_PATH) ?? false;
}


export function readMoveClassOverrides(c: AbilityRuntimeContext): Map<number, number> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    if (!bytes || equalBytes(bytes, RETIRED_ABILITY_DLL)) return new Map();
    const metadata = parseRpm(bytes, { allowedMagics: ["DLXF"] }).metadata;
    if (metadata.PokewebAbilityMoveClasses === undefined && metadata.PokewebMoveClassOverrides === undefined && metadata.PokewebAbilityPowerRatio === undefined) return new Map();
    if (metadata.PokewebAbilityMoveClasses !== 1 || metadata.PokewebAbilityPowerRatio !== 1 || typeof metadata.PokewebMoveClassOverrides !== "string") throw Error("Unrecognized expanded move flag data.");
    return validateMoveClassOverrides(JSON.parse(metadata.PokewebMoveClassOverrides), new Map(), metadata.PokewebMoveClassDefaults !== undefined);
}
/** Snapshot defaults separately from user overrides. Verification must not depend
 * on mutable move names; refreshing keeps classifications after a user renames a move. */
export function readAutomaticMoveClasses(c: AbilityRuntimeContext, refresh = false): Map<number, number> {
    const bytes = c.files.get(ABILITY_EFFECTS_DLL_PATH);
    const value = bytes && !equalBytes(bytes, RETIRED_ABILITY_DLL) ? parseRpm(bytes, {allowedMagics:["DLXF"]}).metadata.PokewebMoveClassDefaults : undefined;
    if (value !== undefined && typeof value !== "string") throw Error("Invalid expanded move flag defaults.");
    const result = value === undefined ? new Map<number,number>() : validateMoveClassOverrides(JSON.parse(value as string));
    if (refresh) for (const [id,mask] of expandedMoveDllDefaults(c.project)) result.set(id,mask);
    return result;
}
export function readCustomMoveFlagRegistry(c: AbilityRuntimeContext): CustomMoveFlagRegistry {
    const bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes||equalBytes(bytes,RETIRED_ABILITY_DLL))return emptyCustomMoveFlags();
    const metadata=parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata;
    if(metadata.PokewebAbilityCustomMoveFlags===undefined&&metadata.PokewebCustomMoveFlags===undefined)return emptyCustomMoveFlags();
    if(metadata.PokewebAbilityCustomMoveFlags!==1||typeof metadata.PokewebCustomMoveFlags!=="string")throw Error("Unrecognized custom move flag data.");
    return validateCustomMoveFlags(JSON.parse(metadata.PokewebCustomMoveFlags));
}

export function readAbilityBlockMessage(c: AbilityRuntimeContext): number | undefined {
    const bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes||equalBytes(bytes,RETIRED_ABILITY_DLL))return;
    const value=parseRpm(bytes,{allowedMagics:["DLXF"]}).metadata.PokewebAbilityBlockMessage;
    if(value===undefined)return;
    if(typeof value!=="number"||!Number.isInteger(value)||value<0||value>65532)throw Error("Invalid ability block message.");
    return value;
}
export function readAbilityPresentationMessages(c:AbilityRuntimeContext): number[] | undefined {
    const bytes=c.files.get(ABILITY_EFFECTS_DLL_PATH);if(!bytes||equalBytes(bytes,RETIRED_ABILITY_DLL))return;
    const { metadata } = parseRpm(bytes,{allowedMagics:["DLXF"]});
    const value=metadata.PokewebAbilityPresentationMessages;
    if(value===undefined)return;
    if(typeof value!=="string")throw Error("Invalid ability presentation messages.");
    const ids:unknown=JSON.parse(value);
    const lengths = metadata.PokewebAbilityZenModeMessages === 1 ? [15,33,34,35] : metadata.PokewebAbilityActionResults === 1 ? [15,33,34] : [15];
    if(!Array.isArray(ids)||!lengths.includes(ids.length)||ids.some(id=>!Number.isInteger(id)||id<0||id>65532))throw Error("Invalid ability presentation messages.");
    return ids;
}

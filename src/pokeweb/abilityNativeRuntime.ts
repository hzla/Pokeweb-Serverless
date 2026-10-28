import bindings from "../assets/data/abilityBindings.json";
import { readU16, readU32, writeU16, writeU32 } from "../nds/binary";
import { battleBranchTarget, BATTLE_RUNTIME_SIGNATURES } from "./battleRuntimeBindings";
import type { AbilityRuleEffect, AbilityRuleSet } from "./abilityRules";
import type { RpmModule } from "./rpm";
import { abilityArgumentAdapter, abilityHpPercentAdapter, abilityHpAtLeastAdapter, abilityResultMapAdapter, applyAbilityImmediate, type NativeAbilityParameter } from "./abilityNativeParameters";
export type NativeAbilityProfile = {
    priority?: number;
    factoryCalls?: Array<{offset:number;target:string}>;
    parameters?: NativeAbilityParameter[];
    eventGates?: Array<{handler:string;anyOf:Array<{key:string;original:number;equals:number}>}>;
    id: number;
    factorySize: number;
    tableRefOffset: number;
    factoryHex: string;
    factoryMask: string;
    events: Array<{
        event: number;
        handler: string;
    }>;
    weather?: Array<{
        handler: string;
        offset: number;
        original: number;
    }>;
    multipliers?: Array<{
        handler: string;
        mov: number;
        shift: number;
        original: number;
    }>;
    chances?: Array<{
        handler: string;
        offset: number;
        original: number;
    }>;
    stats?: Array<{
        handler: string;
        offset: number;
        original: number;
    }>;
};
export const NATIVE_ABILITY_PROFILES = bindings.profiles as NativeAbilityProfile[];
export function nativeAbilityProfile(kind: string): NativeAbilityProfile | undefined { return kind.startsWith("nativeAbility:") ? NATIVE_ABILITY_PROFILES.find(p => p.id === Number(kind.slice(14))) : undefined; }
export function linkNativeAbilities(rpm: RpmModule, rules: ReadonlyMap<number, AbilityRuleSet>, dataOffset: number, resolve: (name: string) => {
    address: number;
    code: Uint8Array;
}, check: (name: string, address: number, size: number, copied?: boolean) => void): void {
    const append = (bytes: Uint8Array, type: "FUNCTION_THM" | "SECTION") => { const at = (rpm.code.length + 3) & ~3, next = new Uint8Array(at + bytes.length); next.set(rpm.code); next.set(bytes, at); rpm.code = next; rpm.symbols.push({ name: null, address: at, size: bytes.length, type, attributes: 0 }); return rpm.symbols.length - 1; };
    const copies = new Map<string, number>();
    function editedSites(effect: AbilityRuleEffect, profile: NativeAbilityProfile) {
        const mapped=(profile.parameters??[]).some(p=>effect.parameters?.[p.key]!==undefined&&p.sites.some(s=>s.mode==="resultMap"));
        return (profile.parameters ?? []).flatMap(p => p.sites.filter(s=>effect.parameters?.[p.key]!==undefined||mapped&&s.mode==="resultMap").map(site=>({site,value:effect.parameters?.[p.key]??p.original})));
    }
    function needsCopy(name: string, effect: AbilityRuleEffect, profile: NativeAbilityProfile, seen = new Set<string>()): boolean {
        if (seen.has(name)) return false;
        seen.add(name);
        return editedSites(effect, profile).some(e => e.site.handler === name) || [...(BATTLE_RUNTIME_SIGNATURES[name]?.calls ?? []), ...(BATTLE_RUNTIME_SIGNATURES[name]?.tails ?? [])].some(c => needsCopy(c.target, effect, profile, seen));
    }
    function copy(name: string, effect: AbilityRuleEffect, profile: NativeAbilityProfile): number {
        const key = JSON.stringify([name, effect.value, effect.weather ?? -1, effect.chance ?? -1, effect.stat ?? -1, effect.parameters ?? {}]);
        if (copies.has(key))
            return copies.get(key)!;
        const source = resolve(name);
        check(name, source.address, source.code.length, true);
        const code = source.code.slice(), s = BATTLE_RUNTIME_SIGNATURES[name];
        const edits = editedSites(effect, profile).filter(e => e.site.handler === name);
        // A relative branch outside the copied function needs a dedicated adapter.
        let end = code.length;
        for (let at = 0; at + 2 <= code.length; at += 2) {
            const ins = readU16(code, at);
            if ((ins & 0xf800) === 0x4800) {
                const literal = ((source.address + at + 4) & ~3) + (ins & 255) * 4 - source.address;
                if (literal > at && literal < end)
                    end = literal;
            }
        }
        for (let at = 0; at + 2 <= end; at += 2) {
            const ins = readU16(code, at);
            if ((ins & 0xf800) !== 0xe000)
                continue;
            let d = (ins & 0x7ff) << 1;
            if (d & 0x800)
                d -= 0x1000;
            if (at + 4 + d < 0 || at + 4 + d >= code.length)
                throw new Error(`Native handler needs a branch adapter: ${name}`);
        }
        for (let at = 0; at + 4 <= end; at += 2) {
            const hi = readU16(code, at), lo = readU16(code, at + 2);
            if ((hi & 0xf800) === 0xf000 && [0xf800, 0xe800].includes(lo & 0xf800) && !s.calls.some(call => call.offset === at))
                throw new Error(`Native handler needs a call adapter: ${name}`);
        }
        for (const control of profile.weather ?? [])
            if (control.handler === name && effect.weather !== undefined)
                code[control.offset] = effect.weather;
        for (const control of profile.chances ?? [])
            if (control.handler === name && effect.chance !== undefined)
                code[control.offset] = effect.chance;
        for (const control of profile.multipliers ?? [])
            if (control.handler === name && effect.value !== -1) {
                const ratio = Math.round(effect.value * 4096);
                let shift = 0;
                while (ratio / 2 ** shift > 255 || !Number.isInteger(ratio / 2 ** shift)) {
                    if (++shift > 15)
                        throw new Error("Native multiplier cannot be encoded.");
                }
                code[control.mov] = ratio / 2 ** shift;
                writeU16(code, control.shift, (readU16(code, control.shift) & ~0x7c0) | shift << 6);
            }
        for (const {site, value} of edits) if (["immediate", "smallImmediate", "shiftMultiplier"].includes(site.mode)) applyAbilityImmediate(code, site, value);
        const symbol = append(code, "FUNCTION_THM");
        copies.set(key, symbol);
        for (const control of profile.stats ?? []) {
            if (control.handler !== name || effect.stat === undefined || effect.stat === control.original)
                continue;
            // Intimidate's r2=1 also supplies the drop and its native flag. Replace
            // only the stat store and the following -1 calculation with a helper.
            if (control.original !== 1 || readU16(code, control.offset - 2) !== 0x2201
                || readU16(code, control.offset) !== 0x604a || readU16(code, control.offset + 2) !== 0x1e90)
                throw new Error("Unrecognized native ability stat assignment.");
            const helper = new Uint8Array(8);
            [0x2000 | effect.stat, 0x6048, 0x1e90, 0x4770].forEach((ins, i) => writeU16(helper, i * 2, ins));
            const helperSymbol = append(helper, "FUNCTION_THM");
            writeU16(rpm.code, rpm.symbols[symbol].address + control.offset, 0xf000);
            writeU16(rpm.code, rpm.symbols[symbol].address + control.offset + 2, 0xf800);
            rpm.relocations.push({ target: { module: "base", address: rpm.symbols[symbol].address + control.offset, type: "THUMB_BRANCH_LINK" }, sourceSymbolIndex: helperSymbol });
        }
        for (const call of [...s.calls.map(c => ({...c, tail:false})), ...(s.tails ?? []).map(c => ({...c, tail:true}))]) {
            const callEdits = edits.filter(e => e.site.offset === call.offset && ["argument", "store", "hpPercent", "hpAtLeast", "resultMap"].includes(e.site.mode));
            const ownDependency = needsCopy(call.target, effect, profile);
            if (call.tail && !callEdits.length && !ownDependency) continue; // Preserve earlier canonical exports exactly.
            const target = call.tail ? readU32(source.code, call.offset) & ~1 : battleBranchTarget(source.code, call.offset, source.address), dependency = resolve(call.target);
            if (target !== dependency.address)
                throw new Error(`Changed native ability call: ${call.target}`);
            check(call.target, target, dependency.code.length, ownDependency);
            let dependencySymbol: number;
            if (ownDependency) dependencySymbol = copy(call.target, effect, profile);
            else { rpm.symbols.push({ name: null, address: target, size: 0, type: BATTLE_RUNTIME_SIGNATURES[call.target].thumb === false ? "FUNCTION_ARM" : "FUNCTION_THM", attributes: 4 }); dependencySymbol = rpm.symbols.length - 1; }
            const percentage = callEdits.find(e => e.site.mode === "hpPercent");
            if (percentage) dependencySymbol = append(abilityHpPercentAdapter(percentage.value, percentage.site.minimum ?? 0), "FUNCTION_THM");
            else if(callEdits.some(e=>e.site.mode==="hpAtLeast"))dependencySymbol=append(abilityHpAtLeastAdapter(callEdits[0].value),"FUNCTION_THM");
            else if(callEdits.some(e=>e.site.mode==="resultMap"))dependencySymbol=append(abilityResultMapAdapter(rpm,callEdits,dependencySymbol),"FUNCTION_THM");
            else if (callEdits.length) dependencySymbol = append(abilityArgumentAdapter(rpm, callEdits, dependencySymbol), "FUNCTION_THM");
            rpm.relocations.push({ target: { module: "base", address: rpm.symbols[symbol].address + call.offset, type: call.tail ? "OFFSET" : "THUMB_BRANCH_LINK" }, sourceSymbolIndex: dependencySymbol });
        }
        return symbol;
    }
    for (const [id, rule] of [...rules].sort(([a], [b]) => a - b)) {
        const at = dataOffset + (rpm.code[dataOffset + id * 2] | rpm.code[dataOffset + id * 2 + 1] << 8), start = at + 4 + rpm.code[at + 1] * 4;
        rule.effects.forEach((effect, index) => {
            const profile = nativeAbilityProfile(effect.kind);
            if (!profile)
                return;
            const events = profile.events.filter(e => (profile.eventGates??[]).filter(g=>g.handler===e.handler).every(g=>g.anyOf.some(c=>(effect.parameters?.[c.key]??c.original)===c.equals)));
            const callbacks = events.map(e => copy(e.handler, effect, profile)), table = new Uint8Array(events.length * 8);
            events.forEach((e, i) => writeU32(table, i * 8, e.event));
            const symbol = append(table, "SECTION");
            events.forEach((_, i) => rpm.relocations.push({ target: { module: "base", address: rpm.symbols[symbol].address + i * 8 + 4, type: "OFFSET" }, sourceSymbolIndex: callbacks[i] }));
            rpm.relocations.push({ target: { module: "base", address: start + index * 16 + 8, type: "OFFSET" }, sourceSymbolIndex: symbol });
            rpm.code[start + index * 16 + 14] = events.length;
        });
    }
}

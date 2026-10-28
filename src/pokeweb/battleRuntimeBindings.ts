import recipe from "../assets/data/abilityRecipeBindings.json";
import native from "../assets/data/itemNativeBindings.json";
import item from "../assets/data/itemRuleBindings.json";
import ability from "../assets/data/abilityBindings.json";
import { readU16, readU32 } from "../nds/binary";
type Signature = {
    thumb?: boolean;
    variants?:Array<{hex:string;mask:string}>;
    hex: string;
    mask: string;
    module: string;
    calls: Array<{
        offset: number;
        target: string;
    }>;
    tails?: Array<{offset: number; target: string}>;
};
export const BATTLE_RUNTIME_SIGNATURES: Record<string, Signature> = { ...native.functions, ...item.functions, ...ability.functions,...recipe.functions };
const hex = (s: string) => Uint8Array.from(s.match(/../gu) ?? [], v => Number.parseInt(v, 16));
const patterns = new Map(Object.entries(BATTLE_RUNTIME_SIGNATURES).map(([name,s])=>[name,[s,...s.variants??[]].map(p=>({bytes:hex(p.hex),mask:hex(p.mask)}))]));
export function battleBranchTarget(code: Uint8Array, at: number, base: number): number {
    const hi = readU16(code, at), lo = readU16(code, at + 2);
    if ((hi & 0xf800) !== 0xf000 || ![0xf800, 0xe800].includes(lo & 0xf800))
        throw new Error("Unrecognized battle service call.");
    let delta = (hi & 0x7ff) << 12 | (lo & 0x7ff) << 1;
    if (delta & 0x400000)
        delta -= 0x800000;
    const target = base + at + 4 + delta;
    return (lo & 0xf800) === 0xe800 ? target & ~3 : target;
}
/** Resolve moved code through signatures and calls from verified callers. */
export function battleRuntimeResolver(overlay: Uint8Array, overlayBase: number, arm9: Uint8Array, armBase: number) {
    const found = new Map<string, number>(), scanned = new Map<string, number[]>();
    const source = (name: string) => BATTLE_RUNTIME_SIGNATURES[name]?.module === "ARM9" ? { bytes: arm9, base: armBase } : { bytes: overlay, base: overlayBase };
    function matches(name: string, address: number): boolean {
        const p = patterns.get(name);
        if (!p)
            return false;
        const { bytes, base } = source(name), at = address - base;
        return at >= 0 && p.some(p=>at + p.bytes.length <= bytes.length && p.bytes.every((v, i) => (bytes[at + i] & p.mask[i]) === (v & p.mask[i])));
    }
    function candidates(name: string): number[] {
        if (scanned.has(name))
            return scanned.get(name)!;
        const p = patterns.get(name);
        if (!p)
            throw new Error(`Missing battle service signature: ${name}`);
        const { bytes, base } = source(name), result: number[] = [];
        for (let at = 0; at + p[0].bytes.length <= bytes.length; at += 2)
            if (matches(name, base + at))
                result.push(base + at);
        scanned.set(name, result);
        return result;
    }
    function seed(name: string, address: number, depth = 0): void {
        if (!matches(name, address))
            throw new Error(`Unrecognized battle service: ${name}`);
        if (found.has(name) || depth > 8)
            return;
        found.set(name, address);
        const { bytes, base } = source(name);
        for (const call of BATTLE_RUNTIME_SIGNATURES[name].calls)
            if (patterns.has(call.target)) {
                const target = battleBranchTarget(bytes, address - base + call.offset, base);
                if (matches(call.target, target))
                    seed(call.target, target, depth + 1);
            }
        for (const tail of BATTLE_RUNTIME_SIGNATURES[name].tails ?? []) {
            const target = readU32(bytes, address - base + tail.offset) & ~1;
            if (matches(tail.target, target)) seed(tail.target, target, depth + 1);
        }
    }
    function resolve(name: string): {
        address: number;
        code: Uint8Array;
    } {
        if (!found.has(name)) {
            const all = candidates(name);
            if (all.length === 1)
                seed(name, all[0]);
            else {
                for (const [caller, s] of Object.entries(BATTLE_RUNTIME_SIGNATURES))
                    if (s.calls.some(call => call.target === name)) {
                        const options = candidates(caller);
                        if (options.length === 1)
                            seed(caller, options[0]);
                        if (found.has(name))
                            break;
                    }
            }
        }
        const address = found.get(name);
        if (address === undefined)
            throw new Error(`Battle service is missing or ambiguous: ${name}`);
        const { bytes, base } = source(name);
        return { address, code: bytes.slice(address - base, address - base + patterns.get(name)![0].bytes.length) };
    }
    return { resolve, matches, seed };
}

import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";
import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../assets/codeinjection/partyQuickActionsManifest.json";
import { writeU16, writeU32 } from "../nds/binary";
import { Folder, addFilePath } from "../nds/fnt";
import { NARC } from "../nds/narc";
import * as pmc from "../pokeweb/pmcModel";
import { NintendoDSRom } from "../nds/rom";
import { exportModifiedRom } from "../pokeweb/exportRom";
import { getPartyQuickActionsStatus, installPartyQuickActions, disablePartyQuickActions, parsePartyToolbarHideFlag } from "../pokeweb/partyQuickActionsModel";
import { listCodeInjectionDlls } from "../pokeweb/pmcModel";
import { getInfiniteCandyStatus } from "../pokeweb/infiniteCandyModel";
import { encodeGen5TextBank } from "../pokeweb/text";
import type { ProjectState } from "../pokeweb/projectStore";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function assets(fail = false) { vi.stubGlobal("fetch", vi.fn(async (input: URL) => fail ? new Response(null, { status: 404 }) : new Response(new Uint8Array(readFileSync(new URL(`../assets/codeinjection/${input.pathname.split("/").pop()}`, import.meta.url)))))); }
function project(v: "W2" | "B2", bytes?: Uint8Array): ProjectState {
    if (!bytes) {
        const r = new NintendoDSRom(new Uint8Array(0x200));
        r.data.set(new TextEncoder().encode(manifest.games[v].idCode), 12);
        r.arm9RamAddress = 0x2004000;
        writeU32(r.data, 0x28, r.arm9RamAddress);
        r.arm9 = new Uint8Array(0xa0000);
        r.arm7 = new Uint8Array(4);
        r.files = Array.from({ length: 344 }, () => new Uint8Array(4));
        r.filenames = new Folder();
        r.arm9OverlayTable = new Uint8Array(344 * 32);
        for (let id = 0; id < 344; id++) {
            writeU32(r.arm9OverlayTable, id * 32, id);
            writeU32(r.arm9OverlayTable, id * 32 + 24, id);
        }
        for (const mod of [12, 165]) {
            const ss = manifest.games[v].signatures.filter(s => s.module === String(mod));
            const candyOpen = v === "W2" ? 0x215b8ac : 0x215b86c;
            const base = Math.min(...ss.map(s => s.address), ...(mod === 12 ? [candyOpen] : [])) & ~255;
            r.files[mod] = new Uint8Array(Math.max(...ss.map(s => s.address + s.expectedHex.length / 2)) - base);
            writeU32(r.arm9OverlayTable, mod * 32 + 4, base);
            writeU32(r.arm9OverlayTable, mod * 32 + 8, r.files[mod].length);
            for (const s of ss)
                r.files[mod].set(Buffer.from(s.expectedHex, "hex"), s.address - base);
            if (mod === 12) r.files[mod].set(Buffer.from("ac308742", "hex"), candyOpen - base);
        }
        for (const s of manifest.games[v].signatures.filter(s => s.module === "ARM9"))
            r.arm9.set(Buffer.from(s.expectedHex, "hex"), s.address - r.arm9RamAddress);
        r.arm9[(v === "W2" ? 0x208f4fc : 0x208f4d0) - r.arm9RamAddress + 622] = 4;
        const icons = (v === "W2" ? 0x2090d7c : 0x2090d50) - r.arm9RamAddress;
        for (const [id, char, palette] of [[50, 90, 91], [622, 827, 828]]) {
            writeU16(r.arm9, icons + id * 4, char); writeU16(r.arm9, icons + id * 4 + 2, palette);
        }
        const itemNarc = new NARC(); itemNarc.files = Array.from({ length: 623 }, () => new Uint8Array(36));
        itemNarc.files[622] = new Uint8Array(Buffer.from("00000000000000001f020000000000ff0000000000000000000000000000000000000000", "hex"));
        const texts = new NARC(); texts.files = Array.from({ length: 65 }, () => encodeGen5TextBank([["0_0", "", 0]]));
        for (const bank of [63, 64]) texts.files[bank] = encodeGen5TextBank(Array.from({ length: 623 }, (_, id) => [`0_${id}`, `Item ${id}`, 0]));
        r.files[0] = texts.save(); r.files[1] = itemNarc.save();
        r.files[2] = new Uint8Array(readFileSync(new URL("./fixtures/party-quick-actions-dependency-icons.narc", import.meta.url)));
        for (const [path, id] of [["a/0/0/2", 0], ["a/0/2/4", 1], ["a/0/2/5", 2]] as const) r.filenames = addFilePath(r.filenames, path, id);
        bytes = r.save({ filenames: r.filenames });
    }
    const r = new NintendoDSRom(bytes);
    return { originalRomBytes: bytes, session: { romName: "fixture.nds", baseRom: "BW2", baseVersion: v }, romInfo: { idCode: r.idCode }, arm9: r.arm9.slice(), arm9Dirty: false, overlays: {}, narcs: {}, texts: { banks: {} }, formats: {}, trpokInfo: [], files: {}, fileSystem: { replacements: {} }, patches: {}, codeInjection: { dlls: [] }, actionChangelog: { entries: [] } } as unknown as ProjectState;
}
for (const v of ["B2", "W2"] as const)
    describe(`Party toolbar ${v}`, () => {
        it("defaults to on without a flag, persists a chosen flag through updates/export, and clears it explicitly", async () => {
            const p = project(v); assets(); await installPartyQuickActions(p);
            expect(getPartyQuickActionsStatus(p)).toMatchObject({ enabled: true, hideFlag: null });
            await installPartyQuickActions(p, { hideFlag: 0x05ee });
            const reopened = project(v, await exportModifiedRom(p));
            expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ enabled: true, hideFlag: 0x05ee });
            disablePartyQuickActions(reopened);
            expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ enabled: false, hideFlag: 0x05ee });
            await installPartyQuickActions(reopened);
            expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ enabled: true, hideFlag: 0x05ee });
            await installPartyQuickActions(reopened, { hideFlag: null });
            expect(getPartyQuickActionsStatus(project(v, await exportModifiedRom(reopened)))).toMatchObject({ enabled: true, hideFlag: null });
        });
        it("rejects invalid hide flags atomically and accepts saved flag boundaries", async () => {
            const p = project(v); assets(); await installPartyQuickActions(p, { hideFlag: 1 });
            expect(getPartyQuickActionsStatus(p).hideFlag).toBe(1);
            await installPartyQuickActions(p, { hideFlag: 3059 });
            expect(getPartyQuickActionsStatus(p).hideFlag).toBe(3059);
            const before = structuredClone(p);
            for (const hideFlag of [0, -1, 3060, 0x4000, 2.5, NaN]) {
                await expect(installPartyQuickActions(p, { hideFlag })).rejects.toThrow(/saved flag/);
                deepStrictEqual(structuredClone(p), before);
            }
        });
        it("installs the required Infinite Candy data once and rejects a conflicting slot atomically", async () => {
            const p = project(v); assets(); await installPartyQuickActions(p);
            expect(getInfiniteCandyStatus(p)).toMatchObject({ installed: true, compatible: true });
            expect(getPartyQuickActionsStatus(p)).toMatchObject({ candyInstalled: true, candyCompatible: true });
            await installPartyQuickActions(p);
            expect(listCodeInjectionDlls(p).filter(e => e.fileName.startsWith("InfiniteCandy"))).toHaveLength(1);
            p.narcs.items!.rawFiles[622]![0] = 1;
            const before = structuredClone(p);
            await expect(installPartyQuickActions(p)).rejects.toThrow(/Requires Infinite Rare Candy.*custom data/);
            deepStrictEqual(structuredClone(p), before);
            disablePartyQuickActions(p);
            expect(getPartyQuickActionsStatus(p).enabled).toBe(false);
        });
        it("rolls back item, icon and text edits if toolbar staging fails after installing the dependency", async () => {
            const p = project(v), before = structuredClone(p); assets();
            const stage = pmc.stageCodeInjectionDll;
            vi.spyOn(pmc, "stageCodeInjectionDll").mockImplementation((...args) => {
                if (args[1].startsWith("PartyQuickActions")) throw new Error("Simulated toolbar staging failure");
                return stage(...args);
            });
            await expect(installPartyQuickActions(p)).rejects.toThrow(/Simulated toolbar staging failure/);
            deepStrictEqual(structuredClone(p), before);
        });
        for (const prior of ["0.1.0", "0.1.1", "0.1.2", "0.1.3", "0.1.4"]) it(`updates toolbar ${prior} in place after export`, async () => {
            const p = project(v); assets(); await installPartyQuickActions(p);
            const entry = listCodeInjectionDlls(p).find(e => e.fileName.startsWith("PartyQuickActions"))!;
            const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/party-quick-actions-v${prior}/${name}`, import.meta.url)));
            p.fileSystem!.additions![entry.path] = fixture(`PartyQuickActions${v}.dll`);
            p.fileSystem!.additions![manifest.archivePath] = fixture("partyQuickActions.narc");
            const reopened = project(v, await exportModifiedRom(p));
            expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ installed: true, enabled: true, compatible: true, updateAvailable: true });
            disablePartyQuickActions(reopened);
            expect(getPartyQuickActionsStatus(reopened).enabled).toBe(false);
            await installPartyQuickActions(reopened);
            expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ installed: true, enabled: true, compatible: true, updateAvailable: false, dllPath: entry.path });
            expect(listCodeInjectionDlls(reopened).filter(e => e.fileName.startsWith("PartyQuickActions"))).toHaveLength(1);
            expect(getPartyQuickActionsStatus(project(v, await exportModifiedRom(reopened)))).toMatchObject({ installed: true, compatible: true, updateAvailable: false });
        });
        it("installs once, disables, and recovers through export", async () => { const p = project(v); assets(); expect(getPartyQuickActionsStatus(p).compatible).toBe(true); await installPartyQuickActions(p); await installPartyQuickActions(p); expect(listCodeInjectionDlls(p).filter(e => e.fileName.startsWith("PartyQuickActions"))).toHaveLength(1); expect(getPartyQuickActionsStatus(p)).toMatchObject({ installed: true, enabled: true }); disablePartyQuickActions(p); const reopened = project(v, await exportModifiedRom(p)); expect(getPartyQuickActionsStatus(reopened)).toMatchObject({ installed: true, enabled: false, compatible: true }); await installPartyQuickActions(reopened); expect(getPartyQuickActionsStatus(reopened).enabled).toBe(true); });
        it("rejects changed native hooks without staging", async () => { const p = project(v); const s = manifest.games[v].signatures.find(s => s.patchSize)!; const r = new NintendoDSRom(p.originalRomBytes!); const mod = Number(s.module), base = new DataView(r.arm9OverlayTable.buffer).getUint32(mod * 32 + 4, true); p.overlays[mod] = r.files[mod].slice(); p.overlays[mod]![s.address - base] ^= 1; const before = structuredClone(p); assets(); await expect(installPartyQuickActions(p)).rejects.toThrow(/Unrecognized/); deepStrictEqual(structuredClone(p), before); });
        it("preserves the project when bundled loading fails", async () => { const p = project(v), before = structuredClone(p); assets(true); await expect(installPartyQuickActions(p)).rejects.toThrow(/Could not load/); deepStrictEqual(structuredClone(p), before); });
        it("rejects altered private graphics without changing the installation", async () => {
            const p = project(v); assets(); await installPartyQuickActions(p);
            const archive = new NARC(p.fileSystem!.additions![manifest.archivePath]);
            archive.files[4]![0] ^= 1;
            p.fileSystem!.additions![manifest.archivePath] = archive.save();
            const before = structuredClone(p);
            expect(getPartyQuickActionsStatus(p).message).toMatch(/graphics are altered/);
            await expect(installPartyQuickActions(p)).rejects.toThrow(/graphics are altered/);
            deepStrictEqual(structuredClone(p), before);
        });
        it("rejects conflicting modules before staging", async () => {
            const p = project(v); assets(); await installPartyQuickActions(p);
            const entry = listCodeInjectionDlls(p).find(e => e.fileName.startsWith("PartyQuickActions"))!;
            const modified = p.fileSystem!.additions![entry.path]!.slice();
                        // Alter owned code while preserving the module's hook table.
            const header = new DataView(modified.buffer).getUint32(8, true);
            const info = header + new DataView(modified.buffer).getUint32(header + 8, true);
            const codeStart = new DataView(modified.buffer).getUint32(info + 16, true);
            modified[codeStart] ^= 1;
            p.fileSystem!.additions![entry.path] = modified;
            const before = structuredClone(p);
            await expect(installPartyQuickActions(p)).rejects.toThrow(/Conflicting Party toolbar/);
            deepStrictEqual(structuredClone(p), before);
        });
        it("rolls back a staging failure after PMC was prepared", async () => {
            const p = project(v), before = structuredClone(p); assets();
            vi.spyOn(pmc, "stageCodeInjectionDll").mockImplementation(() => { throw new Error("Simulated staging failure"); });
            await expect(installPartyQuickActions(p)).rejects.toThrow(/Simulated staging failure/);
            deepStrictEqual(structuredClone(p), before);
        });
    });
describe("Party toolbar flag input", () => {
    it("accepts blank, decimal and hexadecimal values", () => {
        expect(parsePartyToolbarHideFlag("  ")).toBeNull();
        expect(parsePartyToolbarHideFlag("1518")).toBe(1518);
        expect(parsePartyToolbarHideFlag(" 0x05EE ")).toBe(1518);
        expect(parsePartyToolbarHideFlag("0XBF3")).toBe(3059);
    });
    it("rejects invalid saved flags and malformed input", () => {
        for (const input of ["0", "-1", "3060", "0x4000", "1.5", "1e2", "flag", "0x", "NaN"])
            expect(() => parsePartyToolbarHideFlag(input)).toThrow();
    });
});

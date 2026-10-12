import { describe, expect, it } from "vitest";
import { readU16, writeU16, writeU32 } from "../nds/binary";
import { auditTranslationScript, loadTranslationScriptContracts, translationScriptContexts, translationScriptContracts, translationScriptLocations } from "../pokeweb/translationScripts";
import { renderTranslationScriptAudit } from "../ui/translation";
import type { TranslationReport } from "../pokeweb/translationModel";

const cmd = (opcode: number, ...args: number[]) => { const bytes = new Uint8Array(2 + args.length * 2); [opcode, ...args].forEach((value, index) => writeU16(bytes, index * 2, value)); return bytes; };
const item = (slot: number, id: number, extended = false) => { const bytes = new Uint8Array(extended ? 8 : 5); writeU16(bytes, 0, extended ? 0x4e : 0x4d); bytes[2] = slot; writeU16(bytes, 3, id); if (extended) writeU16(bytes, 5, 1); return bytes; };
const number = (slot: number, value: number) => { const bytes = new Uint8Array(7); writeU16(bytes, 0, 0x5c); bytes[2] = slot; writeU16(bytes, 3, value); writeU16(bytes, 5, 2); return bytes; };
type Part = Uint8Array | { label: string } | { branch: number; target: string };
function script(parts: Part[], entries = ["main"]): Uint8Array {
  const labels = new Map<string, number>(), start = entries.length * 4 + 2;
  let length = start; labels.set("main", start);
  for (const part of parts) { if (!(part instanceof Uint8Array) && "label" in part) labels.set(part.label, length); else length += part instanceof Uint8Array ? part.length : part.branch === 0x1f || part.branch === 0x20 ? 7 : 6; }
  const bytes = new Uint8Array(length); entries.forEach((entry, i) => writeU32(bytes, i * 4, labels.get(entry)! - (i * 4 + 4))); writeU16(bytes, entries.length * 4, 0xfd13);
  let at = start;
  for (const part of parts) {
    if (part instanceof Uint8Array) { bytes.set(part, at); at += part.length; }
    else if ("branch" in part) { const size = part.branch === 0x1f || part.branch === 0x20 ? 7 : 6; writeU16(bytes, at, part.branch); if (size === 7) bytes[at + 2] = 1; writeU32(bytes, at + size - 4, labels.get(part.target)! - (at + size)); at += size; }
  }
  return bytes;
}
const say = (id: number) => cmd(0x34, id, 0);
const halt = () => cmd(2);
function check(original: Uint8Array, incoming: Uint8Array, extra: Partial<Parameters<typeof auditTranslationScript>[0]> = {}) {
  return auditTranslationScript({ member: 0, original, incoming, contexts: [{ bank: 0, sourceBank: 0, map: 0 }],
    sourceText: (bank, id) => bank === 0 && id < 4 ? ["One", "Two", "Three", "Four"][id] : undefined,
    donorText: (bank, id) => bank === 0 && id < 4 ? ["Uno", "Due", "Tre", "Quattro"][id] : undefined,
    outputText: (bank, id) => bank === 0 && id < 4 ? ["Uno", "Due", "Tre", "Quattro"][id] : undefined,
    globalEntryCount: () => 2, dataCounts: { items: 700, moves: 560, species: 700 }, ...extra });
}
const codes = (result: ReturnType<typeof check>) => result.audit.diagnostics.filter(diagnostic => diagnostic.severity === "blocked").map(diagnostic => diagnostic.code);

describe("US White 2 script translation contracts", () => {
  it("uses Black 2's own native addresses rather than White 2's", async () => {
    const black2 = await loadTranslationScriptContracts("IREO");
    expect(black2.handlers[0].address).toBe(translationScriptContracts.handlers[0].address - 0x40);
    expect(black2.globalRanges).toEqual(translationScriptContracts.globalRanges);
    await expect(loadTranslationScriptContracts("IREJ")).rejects.toThrow("Unsupported");
  });
  it("keeps every map location and distinguishes native map IDs from Pokeweb header rows", () => {
    const headers = new Uint8Array(96); writeU16(headers, 6, 298); writeU16(headers, 54, 298);
    headers[26] = 12; headers[27] = 1; headers[74] = 13;
    expect(translationScriptLocations(298, headers, id => id === 268 ? "Unity Tower" : "Other")).toEqual([
      { map: 0, headerRow: 1, placeNameId: 268, locationName: "Unity Tower" },
      { map: 1, headerRow: 2, placeNameId: 13, locationName: "Other" },
    ]);
    expect(translationScriptLocations(298, headers.slice(1), () => "Unknown")).toEqual([]);
  });
  it("imports a literal dialogue edit and reads all three referenced texts", () => {
    const original = script([say(0), halt()]), incoming = script([say(1), halt()]);
    const result = check(original, incoming);
    expect(result.bytes).toEqual(incoming); expect(result.audit.status).toBe("imported");
    expect(result.audit.references).toContainEqual(expect.objectContaining({ bank: 0, messageId: 1, sourceText: "One", donorText: "Due", outputText: "Due", status: "resolved" }));
  });
  it("validates references against retained output banks rather than the donor's entry count", () => {
    const original = script([say(0), halt()]), incoming = script([say(3), halt()]);
    const result = check(original, incoming, { outputText: (bank, id) => bank === 0 && id < 2 ? "Kept" : undefined });
    expect(result.bytes).toEqual(original); expect(codes(result)).toContain("text-reference-missing");
    expect(result.audit.references[0]).toMatchObject({ messageId: 3, donorText: "Quattro", status: "unresolved" });
  });
  it("resolves copied work variables and an explicit bank variable containing the default-bank marker", () => {
    const original = script([say(0), halt()]);
    const incoming = script([cmd(0x28, 0x8000, 1), cmd(0x29, 0x8001, 0x8000), cmd(0x28, 0x8002, 1024), cmd(0x3d, 0x8002, 0x8001, 0, 0), halt()]);
    const result = check(original, incoming);
    expect(codes(result)).toEqual([]); expect(result.audit.references[0]).toMatchObject({ bank: 0, messageId: 1, status: "resolved" });
  });
  it("carries values back from an internal call without treating return as fall-through", () => {
    const original = script([say(0), halt()]);
    const incoming = script([{ branch: 4, target: "sub" }, say(0x8000), halt(), { label: "sub" }, cmd(0x28, 0x8000, 1), cmd(5)]);
    const result = check(original, incoming);
    expect(codes(result)).toEqual([]); expect(result.audit.references[0].messageId).toBe(1);
  });
  it("blocks unresolved branch values instead of choosing one branch's message ID", () => {
    const original = script([say(0), halt()]);
    const incoming = script([{ branch: 0x1f, target: "other" }, cmd(0x28, 0x8000, 0), { branch: 0x1e, target: "say" },
      { label: "other" }, cmd(0x28, 0x8000, 1), { label: "say" }, say(0x8000), halt()]);
    const result = check(original, incoming);
    expect(result.bytes).toEqual(original); expect(codes(result)).toContain("dynamic-text-reference");
  });
  it("does not reuse a constant after a native output command may have overwritten it", () => {
    const original = script([cmd(0x28, 0x8000, 0), cmd(0x22, 0x8000), say(0x8000), halt()]);
    const incoming = script([cmd(0x28, 0x8000, 1), cmd(0x22, 0x8000), say(0x8000), halt()]);
    const result = check(original, incoming);
    expect(codes(result)).toContain("dynamic-text-reference"); expect(result.bytes).toEqual(original);
  });
  it("logs an unaffected inherited US runtime reference while allowing an independent work edit", () => {
    const original = script([cmd(0x22, 0x8000), cmd(0x28, 0x8001, 0), say(0x8000), halt()]);
    const incoming = script([cmd(0x22, 0x8000), cmd(0x28, 0x8001, 1), say(0x8000), halt()]);
    const result = check(original, incoming);
    expect(result.bytes).toEqual(incoming); expect(codes(result)).toEqual([]);
    expect(result.audit.references[0].status).toBe("inherited");
    expect(result.audit.diagnostics).toContainEqual(expect.objectContaining({ code: "dynamic-text-reference", severity: "warning", variable: 0x8000 }));
  });
  it("requires a producer for a new word slot in decrypted dialogue", () => {
    const original = script([say(0), halt()]), incoming = script([say(1), halt()]);
    const result = check(original, incoming, { outputText: (_bank, id) => id === 1 ? "Item: VAR(265, 1)" : "Plain" });
    expect(codes(result)).toContain("word-binding-unresolved"); expect(result.bytes).toEqual(original);
  });
  it("does not trust an old word slot when its producer was deleted", () => {
    const original = script([item(1, 1), say(0), halt()]), incoming = script([say(0), halt()]);
    const lookup = () => "VAR(265, 1)";
    const result = check(original, incoming, { sourceText: lookup, donorText: lookup, outputText: lookup });
    expect(codes(result)).toContain("word-binding-unresolved");
  });
  it("imports an ordinary item-name replacement for an extended formatting command", () => {
    const original = script([item(1, 1, true), say(0), halt()]), incoming = script([item(1, 1), say(0), halt()]);
    const lookup = () => "Item: VAR(265, 1)";
    const result = check(original, incoming, { sourceText: lookup, donorText: lookup, outputText: lookup });
    expect(codes(result)).toEqual([]); expect(result.bytes).toEqual(incoming);
  });
  it("rejects item IDs outside the output item archive", () => {
    const original = script([item(1, 1), halt()]), incoming = script([item(1, 700), halt()]);
    expect(codes(check(original, incoming))).toContain("native-data-reference");
  });
  it("remaps only the verified appended negative-floor variant", () => {
    const original = script([number(0, 3), cmd(0x28, 0x8001, 0), say(512), halt()]);
    const incoming = script([number(0, 3), cmd(0x28, 0x8001, 1), say(592), halt()]);
    const result = check(original, incoming, { contexts: [{ bank: 436, sourceBank: 436 }], sourceText: (_bank, id) => id === 512 ? "Floor VAR(514, 0)" : undefined,
      donorText: (_bank, id) => id === 512 ? "Piano VAR(514, 0)" : id === 592 ? "Piano -VAR(514, 0)" : undefined,
      outputText: (_bank, id) => id === 512 ? "Piano VAR(514, 0)" : undefined });
    expect(result.audit.status).toBe("adapted"); expect(result.audit.rewrites).toHaveLength(1);
    expect(readU16(result.bytes, result.audit.rewrites[0].offset)).toBe(512);
  });
  it("retains a hack's appended text when it is not the audited counterpart", () => {
    const original = script([say(512), halt()]), incoming = script([say(592), halt()]);
    const result = check(original, incoming, { contexts: [{ bank: 436, sourceBank: 436 }], donorText: (_bank, id) => id === 592 ? "Custom extra dialogue" : "Existing",
      outputText: (_bank, id) => id === 512 ? "Existing" : undefined });
    expect(result.audit.rewrites).toEqual([]); expect(codes(result)).toContain("text-reference-missing");
  });
  it("logs the unresolved regional sign-renderer dependency", () => {
    const original = script([cmd(0x43, 0, 0), halt()]), incoming = script([cmd(0x230, 0x1000, 0), halt()]);
    const result = check(original, incoming, { locale: "korean" });
    expect(codes(result)).toContain("regional-text-renderer"); expect(codes(result)).toContain("text-reference-missing");
  });
  it("retains new unaudited native commands and names their module", () => {
    const original = script([halt()]), incoming = script([cmd(0x6b, 1), halt()]);
    const result = check(original, incoming);
    expect(result.bytes).toEqual(original); expect(result.audit.diagnostics).toContainEqual(expect.objectContaining({ code: "native-contract-unresolved", opcode: 0x6b, dependency: expect.any(String) }));
  });
  it("retains changed scripts when the donor edited the native VM", () => {
    const original = script([say(0), halt()]), incoming = script([say(1), halt()]);
    const result = check(original, incoming, { nativeChanges: new Set(["arm9"]) });
    expect(result.bytes).toEqual(original); expect(codes(result)).toContain("donor-native-dependency");
  });
  it("blocks edited values flowing into an opaque native argument or an implicit global-script argument", () => {
    const original = script([cmd(0x28, 0x8000, 0), cmd(0x6b, 0x8000), halt()]);
    const incoming = script([cmd(0x28, 0x8000, 1), cmd(0x6b, 0x8000), halt()]);
    expect(codes(check(original, incoming))).toContain("native-argument-unresolved");
    const before = script([cmd(0x28, 0x8008, 1), cmd(0x1c, 7000), halt()]);
    const after = script([cmd(0x28, 0x8008, 2), cmd(0x1c, 7000), halt()]);
    expect(codes(check(before, after))).toContain("native-argument-unresolved");
  });
  it("does not reuse a constant after stack-pop or bitwise work writes", () => {
    const before = script([cmd(0x28, 0x8000, 0), say(0x8000), halt()]);
    const after = script([cmd(0x28, 0x8000, 0), cmd(0xa, 0x8000), say(0x8000), halt()]);
    expect(codes(check(before, after))).toContain("dynamic-text-reference");
    const bitwise = script([cmd(0x28, 0x8000, 0), cmd(0x13, 0x8000, 1), say(0x8000), halt()]);
    expect(check(before, bitwise).audit.references[0]).toMatchObject({ messageId: 1, status: "resolved" });
  });
  it("logs new word contracts even when the selected entry comes from an inherited runtime value", () => {
    const before = script([cmd(0x22, 0x8000), cmd(0x28, 0x8001, 0), say(0x8000), halt()]);
    const after = script([cmd(0x22, 0x8000), cmd(0x28, 0x8001, 1), say(0x8000), halt()]);
    expect(codes(check(before, after, { addedBankWordSlot: () => ({ entry: 1, slot: 2 }) }))).toContain("dynamic-word-bank-contract");
  });
  it("rejects direct and mutual recursion introduced by internal call changes", () => {
    const before = script([halt()]);
    expect(codes(check(before, script([{ branch: 4, target: "main" }, halt()])))).toContain("script-call-recursion");
    const after = script([{ branch: 4, target: "a" }, halt(), { label: "a" }, { branch: 4, target: "b" }, cmd(5), { label: "b" }, { branch: 4, target: "a" }, cmd(5)]);
    expect(codes(check(before, after))).toContain("script-call-recursion");
  });
  it("shows script diagnostics and decrypted text without treating ROM text as HTML", () => {
    const before = script([say(0), halt()]), after = script([say(1), halt()]);
    const result = check(before, after, { donorText: () => "<script>alert(1)</script>", outputText: () => "<img src=x onerror=alert(1)>" });
    const report = { scripts: { imported: 1, adapted: 0, retained: 0, unchanged: 0, audits: [result.audit] } } as unknown as TranslationReport;
    const html = renderTranslationScriptAudit(report);
    expect(html).toContain("Script compatibility · 1 imported"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;img"); expect(html).not.toContain("<script>");
  });
  it("rejects unknown or truncated instructions and pointers into operands", () => {
    const original = script([halt()]);
    const unknown = check(original, script([cmd(0xffff), halt()])); expect(codes(unknown)).toContain("overlay-command-layout");
    const truncated = check(original, script([cmd(0x3c)])); expect(codes(truncated)).toContain("script-command-layout");
    const bad = script([{ branch: 0x1f, target: "end" }, say(0), { label: "end" }, halt()]); writeU32(bad, 9, 1);
    expect(codes(check(original, bad))).toContain("script-target");
  });
  it("rejects changed entry counts and nonzero unparsed data", () => {
    const original = script([halt()]), extraEntry = script([halt(), { label: "other" }, halt()], ["main", "other"]);
    expect(codes(check(original, extraEntry))).toContain("script-entry-count");
    expect(codes(check(original, script([halt(), Uint8Array.of(0x99)])))).toContain("unparsed-script-data");
  });
  it("uses the native shared-script table and native map-overlay bindings", () => {
    expect(translationScriptContexts(1238, undefined)).toContainEqual({ bank: 437, sourceBank: 437, overlay: undefined });
    expect(translationScriptContexts(1280, undefined)).toContainEqual({ bank: 609, sourceBank: 609, overlay: 58 });
    expect(translationScriptContracts.handlers[0x4d].address).toBe(0x21a7815);
    expect(translationScriptContracts.movementOpcodes).toContain(0x9a);
  });
});

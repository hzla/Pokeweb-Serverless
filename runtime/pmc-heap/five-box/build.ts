import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readU16, readU32, writeU16, writeU32 } from "../../../src/nds/binary";
import { setArm9CompressedStaticEnd } from "../../../src/nds/arm9ModuleParams";
import { compressCode, decompressCode } from "../../../src/nds/codeCompression";
import { NintendoDSRom } from "../../../src/nds/rom";
import { parseRpm } from "../../../src/pokeweb/rpm";

const [input, output, mode, manifestPath] = process.argv.slice(2);
assert(input && output && [undefined, "--arena-control", "--reclaim-arm7-staging"].includes(mode),
  "Expected BASELINE_220.nds OUTPUT.nds [--arena-control | --reclaim-arm7-staging [MANIFEST.json]]");
const control = mode === "--arena-control";
const reclaimArm7Staging = mode === "--reclaim-arm7-staging";
assert(!manifestPath || reclaimArm7Staging, "The installer manifest requires --reclaim-arm7-staging");
const rom = new NintendoDSRom(new Uint8Array(await readFile(input)), { fileData: "view" });
assert.equal(rom.idCode, "IRDO");
assert.equal(rom.data[30], 0);
const arm = decompressCode(rom.arm9).slice();
const originalArm = arm.slice();
const at = (address: number) => address - rom.arm9RamAddress;
const row = 344 * 32;
const table = rom.arm9OverlayTable.slice();
assert.equal(table.length, row + 32);
const base = readU32(table, row + 4);
assert.equal(readU32(table, row + 8), 0x3000);
assert.equal(readU32(table, row + 12), 0);
const fileId = readU32(table, row + 24);
const overlay = rom.files[fileId];
const symbols = parseRpm(rom.getFileByName("codeinjection/RPMSYM-PMC.rpm"));
assert.equal(symbols.metadata.PMCVersion, "13.2.4-heap220");
assert.equal(overlay.length, 0x3000);
assert.equal(readU32(overlay, 0x2ff0), 0x304c564f);
assert.equal(readU32(overlay, 0x2ff4), base);
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
assert.equal(hash(arm), "3dc3816f6eaa3f4b34d6ad797b43a371d94d4fba7ed4600f757e13696d9d64f8",
  "Expected unmodified US White 2 ARM9 with the compact PMC installation");
assert.equal(hash(overlay), "04fb42055b7024c40542a48e6551dac7586834c680fbf1b4bd948b684a029f95",
  "Expected the supported compact PMC overlay");
if (reclaimArm7Staging) {
  assert.equal(readU32(rom.data, 0x34), 0x02380000);
  assert.equal(readU32(rom.data, 0x38), 0x02380000);
  assert.equal(hash(rom.arm7), "fea30d7fb24ff1cf24306a5aff971593bab5ff7925d0d0fe49237b96ce6dbdae",
    "The staging reclaim requires the verified US White 2 ARM7 binary");
}

const files = new Map<number, Uint8Array>();
const nextOverlay = new Uint8Array(control ? overlay.length : 0x4000);
nextOverlay.set(overlay);
files.set(fileId, nextOverlay);

// Read the code offset from the loaded RPM header. The exported symbol file
// uses offsets relative to the code, rather than relative to the overlay.
const allocator = symbols.symbols.find(s => s.name === "_ZN3pmc6System21CreateSystemAllocatorEv");
assert(allocator);
const capPattern = [0x23dc, 0x1a8a, 0x029b, 0x429a, 0xd900, 0x001a];
const caps = Array.from({ length: 32 }, (_, i) => allocator.address + 32 + i * 2)
  .filter(offset => capPattern.every((word, i) => readU16(overlay, offset + i * 2) === word));
assert.equal(caps.length, 1);
const cap = caps[0];
writeU16(nextOverlay, cap, 0x2350); // 80 × 4096 = 320 KiB, above the DS arena available here.
writeU16(nextOverlay, cap + 4, 0x031b);

const native = {
  heap_alloc: 0x0203a229, heap_free: 0x0203a279,
  copy16: 0x02078668, clear32: 0x02078684, compare: 0x02043ec5, crc16: 0x02077a3d,
  read_flash: 0x0203c025, write_flash: 0x0203c0a9, set_status: 0x0203bde9,
  fill_status: 0x0203beb9, clear_status: 0x0203bea1, init_native: 0x0203c291,
  init_box: 0x02007df1, init_pkm: 0x0201c459, get_pkm_param: 0x0201cdb5,
  terminate: 0x0207c7a1, load_backup_native: 0x0203b19d,
  get_box: 0x02007e15, print_create: 0x0203cbdd, print_message: 0x0203ccd1,
  print_commit: 0x0203cd11, display_on: 0x02074901,
};

if (!control) {
  const payload = base + 0x3000;
  assert.equal(readU32(arm, at(0x0207b41c)), payload);
  writeU32(arm, at(0x0207b41c), base + nextOverlay.length);
  writeU32(table, row + 8, nextOverlay.length);
  nextOverlay.set(overlay.subarray(0x2ff0), 0x3ff0);

  const boxOverlayId = 255;
  const box = rom.loadArm9Overlays([boxOverlayId]).get(boxOverlayId);
  assert(box && box.data.length === box.ramSize && box.ramAddress === 0x021bb740);
  assert.equal(hash(rom.files[box.fileId]), "d0bc60d186a514dfc71e8f0dfd5e18309870c6557164a5c896d714c2c2c3732c");
  // The native unlock loop only initializes its counter for 8 or 16 boxes.
  assert.equal(readU16(box.data, 0x44), 0xd01c);
  const originalBoxHash = hash(box.data);
  writeU16(box.data, 0x44, 0xe01c);
  writeU32(table, boxOverlayId * 32 + 28, 0);
  files.set(box.fileId, box.data);

  const work = await mkdtemp(join(tmpdir(), "five-box-"));
  try {
    const hookSites: Array<[number, number]> = [];
    const run = (tool: string, args: string[]) => execFileSync(`arm-none-eabi-${tool}`, args, { cwd: work, encoding: "utf8" });
    const c = fileURLToPath(new URL("storage.c", import.meta.url));
    const arm7StagingEntry = reclaimArm7Staging ? [
      ".p2align 2", ".global call_pmc_floor", ".thumb_func", "call_pmc_floor:",
      "push {r0, r1, r4, lr}", "movs r1, r3", "movs r2, r4", "bl enter_pmc_floor",
      "movs r2, r0", "pop {r0, r1, r4, pc}",
      ".p2align 2", ".thumb_func", "enter_pmc_floor:", "bx pc", "nop", ".arm", "b select_pmc_floor", ".thumb",
    ] : [];
    await writeFile(join(work, "entry.S"), [
      ".syntax unified", ".section .entry,\"ax\"", ".thumb", ".p2align 2",
      ...["allocate_save", "load_backup"].flatMap(name => [
        `.global call_${name}`, ".thumb_func", `call_${name}:`, "bx pc", "nop", ".arm", `b ${name}`, ".thumb",
      ]),
      ...arm7StagingEntry,
      // Save state zero has the Save pointer in r4. Replay its two displaced instructions.
      ".p2align 2", ".global call_prepare_save", ".thumb_func", "call_prepare_save:",
      "push {r0, r1, r3, lr}", "movs r0, r4", "bl enter_prepare_save",
      "movs r2, #82", "lsls r2, r2, #2", "pop {r0, r1, r3, pc}",
      ".p2align 2", ".thumb_func", "enter_prepare_save:", "bx pc", "nop", ".arm", "b prepare_save", ".thumb",
      ".arm", ".p2align 2",
      ...Object.entries(reclaimArm7Staging ? { ...native, pxi_ready: 0x0207ca75 } : native).flatMap(([name, address]) => [
        `.global ${name}`, `.type ${name}, %function`, `${name}:`, "ldr ip, [pc, #0]", "bx ip",
        `.word 0x${address.toString(16)}`,
      ]),
    ].join("\n") + "\n");
    await writeFile(join(work, "layout.ld"), [
      "card = 0x0214189c;",
      `SECTIONS { . = 0x${payload.toString(16)};`,
      ".payload : { *(.entry) *(.text*) *(.rodata*) *(.data*) . = ALIGN(4); *(.bss*) *(COMMON) BYTE(0) }",
      "/DISCARD/ : { *(.ARM.attributes) *(.comment) *(.note*) } }",
    ].join("\n"));
    // Native Thumb callers guarantee four-byte stack alignment. ARMv4T code
    // generation avoids the ARMv5 doubleword load/store alignment constraint.
    const cFlags = ["-c", "-Os", "-march=armv4t", "-marm", "-ffreestanding", "-Wall", "-Wextra", "-Werror"];
    const objects = ["entry.o", "storage.o"];
    run("gcc", [...cFlags, c, "-o", "storage.o"]);
    if (reclaimArm7Staging) {
      run("gcc", [...cFlags, fileURLToPath(new URL("arm7_staging.c", import.meta.url)), "-o", "arm7_staging.o"]);
      objects.push("arm7_staging.o");
    }
    run("gcc", ["-c", "-march=armv5te", "entry.S", "-o", "entry.o"]);
    run("ld", ["-T", "layout.ld", "-o", "payload.elf", ...objects]);
    run("objcopy", ["-O", "binary", "payload.elf", "payload.bin"]);
    const code = await readFile(join(work, "payload.bin"));
    assert(code.length < 0xff0, "Five-box code exceeds its overlay reservation");
    nextOverlay.set(code, 0x3000);
    const entries = new Map(run("nm", ["-n", "payload.elf"]).trim().split("\n").map(line => {
      const [address, , name] = line.trim().split(/\s+/u);
      return [name, parseInt(address, 16)];
    }));
    function symbol(name: string) {
      const address = entries.get(name);
      assert(address && address >= payload && address < payload + code.length, name);
      return address;
    }
    function hook(address: number, name: string) {
      assert.equal(address % 4, 0);
      hookSites.push([address, 8]);
      writeU16(arm, at(address), 0x4778); // bx pc, transitioning to ARM without clobbering arguments
      writeU16(arm, at(address + 2), 0x46c0);
      writeU32(arm, at(address + 4), 0xea000000 | (((symbol(name) - address - 12) >> 2) & 0xffffff));
    }
    function call(image: Uint8Array, imageBase: number, address: number, name: string) {
      const displacement = symbol(name) - address - 4;
      assert(displacement >= -0x400000 && displacement < 0x400000 && displacement % 2 === 0);
      const offset = address - imageBase;
      if (image === arm) hookSites.push([address, 4]);
      writeU16(image, offset, 0xf000 | ((displacement >> 12) & 0x7ff));
      writeU16(image, offset + 2, 0xf800 | ((displacement >> 1) & 0x7ff));
    }
    if (reclaimArm7Staging) {
      const selectFloor = [0x68a2, 0x68e4, 0x1912, 0x429a, 0xd200, 0x001a];
      const offset = cap - selectFloor.length * 2;
      assert(selectFloor.every((word, i) => readU16(nextOverlay, offset + i * 2) === word));
      call(nextOverlay, base, base + offset, "call_pmc_floor");
      for (let at = offset + 4; at < cap; at += 2) writeU16(nextOverlay, at, 0x46c0);
    }
    for (const [address, name] of [
      [0x0203ada8, "upload_data"], [0x0203adb0, "block_ptr"], [0x0203adc0, "init_blocks"],
      [0x0203b0f4, "block_crcs"], [0x0203b740, "write_footer_head"], [0x0203b774, "write_footer_last"],
      [0x0203b958, "write_block"], [0x0203bd74, "increment_block"], [0x020078d4, "swap_boxes"],
    ] as const) hook(address, name);
    call(arm, rom.arm9RamAddress, 0x0203ad0e, "call_allocate_save");
    call(arm, rom.arm9RamAddress, 0x0203ae96, "call_load_backup");
    call(arm, rom.arm9RamAddress, 0x0203b064, "call_load_backup");
    assert.equal(readU32(arm, at(0x0203ba22)), 0x00922252);
    call(arm, rom.arm9RamAddress, 0x0203ba22, "call_prepare_save");

    // Leave the native unlocked-box metadata intact on disk. Restrict the
    // box selector, automatic deposits, free-slot counts and direct writes.
    for (const [addr, before, after] of [
      [0x0200551c, 0x2227, 0x2215], [0x020077b8, 0x5c29, 0x2105], [0x020077c6, 0x2918, 0x2905],
      [0x02007804, 0x5c40, 0x2005], [0x0200788a, 0x5c40, 0x2005], [0x02007942, 0x2d18, 0x2d05],
      [0x02007968, 0xb508, 0x2005], [0x0200796a, 0xf7ff, 0x4770],
      [0x02007978, 0xb508, 0x2005], [0x0200797a, 0xf7ff, 0x4770],
      [0x020079fc, 0x5c09, 0x2105], [0x02007a10, 0x2918, 0x2905], [0x02007a72, 0x2818, 0x2805],
    ]) {
      assert.equal(readU16(arm, at(addr)), before, `Native instruction ${addr.toString(16)}`);
      hookSites.push([addr, 2]);
      writeU16(arm, at(addr), after);
    }
    assert.equal(readU32(arm, at(0x0208ee9c)), 0x1a3e00);
    hookSites.push([0x0208ee9c, 4]);
    writeU32(arm, at(0x0208ee9c), 0x1a3e00 - 0x12000);
    if (manifestPath) {
      const hex = (image: Uint8Array, offset: number, length: number) => Buffer.from(image.subarray(offset, offset + length)).toString("hex");
      const allocatorOffset = cap - 12;
      const nativeRanges = [[0x020054b8, 0x19c], [0x02007710, 0x710], [0x0203ac30, 0x17e0], [0x0207ca74, 0x24]];
      const manifest = {
        base, arm7Sha256: hash(rom.arm7), payload: code.toString("base64"),
        allocator: { offset: allocatorOffset, before: hex(overlay, allocatorOffset, 24), after: hex(nextOverlay, allocatorOffset, 24) },
        arm9: hookSites.sort((a, b) => a[0] - b[0]).map(([address, size]) => ({
          address, before: hex(originalArm, at(address), size), after: hex(arm, at(address), size),
        })),
        nativeRanges: nativeRanges.map(([address, size]) => ({ address, size, sha256: hash(originalArm.subarray(at(address), at(address) + size)) })),
        pc: { id: boxOverlayId, address: box.ramAddress, offset: 0x44, before: 0xd01c, after: 0xe01c,
          beforeSha256: originalBoxHash, afterSha256: hash(box.data) },
      };
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }
    console.log(JSON.stringify({ codeBytes: code.length, entries: Object.fromEntries(entries) }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
if (output === "-") {
  assert(manifestPath, "Use - only when generating the installer manifest");
} else {
  const compressed = compressCode(arm, { isArm9: true });
  assert(setArm9CompressedStaticEnd(compressed, rom.arm9RamAddress + compressed.length));
  await writeFile(output, rom.save({ forDsi: false, arm9: compressed, arm9OverlayTable: table, files,
    preserveBw2PmcLayout: true }), { flag: "wx" });
}

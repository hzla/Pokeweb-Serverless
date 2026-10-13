"""Extract encoding facts and retain corrections verified in native US White 2."""
import argparse
import pathlib
import re

parser = argparse.ArgumentParser()
parser.add_argument("source", type=pathlib.Path, help="FrostsGen5Editor Data/NARCTypes/ScriptNARC.cs")
parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("src/pokeweb/bw2ScriptCompiler/commandLayouts.ts"))
args = parser.parse_args()
text = args.source.read_text(encoding="utf-8-sig")
command = re.compile(r'\{(0x[\dA-Fa-f]+), new CommandType\("([^"]+)", (\d+)((?:, [124])*)\)\}')

def layouts(section):
    result = []
    for opcode, name, count, operands in command.findall(section):
        widths = [int(n) for n in re.findall(r"[124]", operands)]
        if len(widths) != int(count):
            raise ValueError(f"Invalid layout for {opcode}")
        name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
        name = re.sub(r"([a-z\d])([A-Z])", r"\1_\2", name).lower()
        result.append((int(opcode, 16), name, widths))
    if len({row[0] for row in result}) != len(result):
        raise ValueError("Duplicate opcode")
    return result

base = layouts(text.split("bw2BeaterScriptCommandList =", 1)[1].split("internal static Dictionary", 1)[0])
overlays = text.split("bw2OverlayCommands =", 1)[1].split("internal static Dictionary", 1)[0]
overlay_rows = {int(overlay): layouts(section) for overlay, section in re.findall(
    r"\{ (\d+), new Dictionary<int, CommandType>\(\) \{(.*?)\} \},", overlays, re.S)}
if len(base) != 660 or len(overlay_rows) != 15:
    raise ValueError("Unexpected command inventory; review changed source")

# Native handlers establish operand boundaries, including adjacent words whose
# old combined width happened to give the same total size. Keep these corrections
# when refreshing the upstream inventory. Independent sizes live in
# src/pokeweb/gen5ScriptOverlayCommands.ts; hand-encoded regression cases cover
# the corrected callbacks and the command-table switch.
native_widths = {
    50: {0x03eb: [2, 2, 2, 2]},
    55: {0x03fe: [2, 2], 0x040a: [1, 2], 0x0415: [1]},
    58: {0x040c: []},
}
for overlay, corrections in native_widths.items():
    if not corrections.keys() <= {row[0] for row in overlay_rows[overlay]}:
        raise ValueError("Corrected opcode missing from upstream inventory")
    overlay_rows[overlay] = [(opcode, name, corrections.get(opcode, widths))
                             for opcode, name, widths in overlay_rows[overlay]]
# Join Avenue temporarily selects the shop table (overlay 60). Its only field
# callback is 1011 with eight words, distinct from 1011 in the common table.
overlay_rows[60] = [(0x03f3, "join_avenue_shop_menu", [2] * 8)]

lines = ["// Generated command encoding facts from FrostsGen5Editor ScriptNARC.cs with native US White 2 corrections.",
         "// Regenerate with scripts/generate-bw2-command-layouts.py; sizes are checked independently.",
         'import type { CommandDefinition } from "./commands";',
         'type Layout = Pick<CommandDefinition, "widths"> & { name: string };',
         "export const BW2_BASE_LAYOUTS: Readonly<Record<number, Layout>> = {"]
for opcode, name, widths in base:
    lines.append(f'  0x{opcode:04x}: {{ name: "{name}", widths: {widths} }},')
lines += ["};", "", "export const BW2_OVERLAY_LAYOUTS: Readonly<Record<number, Readonly<Record<number, Layout>>>> = {"]
for overlay, rows in sorted(overlay_rows.items()):
    lines.append(f"  {overlay}: {{")
    for opcode, name, widths in rows:
        spelling = name if overlay == 60 else f"cmd_{opcode:04x}"
        lines.append(f'    0x{opcode:04x}: {{ name: "{spelling}", widths: {widths} }},')
    lines.append("  },")
lines += ["};", ""]
args.out.write_text("\n".join(lines))

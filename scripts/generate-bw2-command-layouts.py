"""Extract encoding facts from FrostsGen5Editor; no C# implementation is copied."""
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
lines = ["// Generated command encoding facts from FrostsGen5Editor ScriptNARC.cs.",
         "// Regenerate with scripts/generate-bw2-command-layouts.py; sizes are checked independently.",
         'import type { CommandDefinition } from "./commands";',
         'type Layout = Pick<CommandDefinition, "widths"> & { name: string };',
         "export const BW2_BASE_LAYOUTS: Readonly<Record<number, Layout>> = {"]
for opcode, name, widths in base:
    lines.append(f'  0x{opcode:04x}: {{ name: "{name}", widths: {widths} }},')
lines += ["};", "", "export const BW2_OVERLAY_LAYOUTS: Readonly<Record<number, Readonly<Record<number, Layout>>>> = {"]
for overlay, section in re.findall(r"\{ (\d+), new Dictionary<int, CommandType>\(\) \{(.*?)\} \},", overlays, re.S):
    lines.append(f"  {overlay}: {{")
    for opcode, _, widths in layouts(section):
        lines.append(f'    0x{opcode:04x}: {{ name: "cmd_{opcode:04x}", widths: {widths} }},')
    lines.append("  },")
lines += ["};", ""]
if len(base) != 660 or sum(line.endswith(": {") for line in lines) != 15:
    raise ValueError("Unexpected command inventory; review changed source")
args.out.write_text("\n".join(lines))

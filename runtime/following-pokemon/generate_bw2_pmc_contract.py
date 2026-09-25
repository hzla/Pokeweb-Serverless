"""Pin the bundled US BW2 PMC loader's write sites and imported ARM9 entries."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import ndspy.codeCompression
import ndspy.rom

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def profile(path: Path, game_code: str, contract_name: str, rpm_name: str) -> dict:
    raw = path.read_bytes()
    contract = json.loads((HERE / contract_name).read_text())
    if raw[12:16].decode('ascii') != game_code or raw[30] != 0 or hashlib.sha256(raw).hexdigest() != contract['target']['sha256']:
        raise ValueError(f'{path} is not the pinned clean {game_code} revision-0 ROM')
    rom = ndspy.rom.NintendoDSRom(raw)
    arm9 = ndspy.codeCompression.decompress(rom.arm9)
    base = rom.arm9RamAddress
    symbols = json.loads(subprocess.check_output(
        ['npx', 'vite-node', 'scripts/inspect-pmc.ts', f'src/assets/codeinjection/{rpm_name}'], cwd=ROOT, text=True))

    def signature(address: int, length: int) -> str:
        at = address - base
        if at < 0 or at + length > len(arm9):
            raise ValueError(f'PMC address {address:#x} is outside ARM9')
        return bytes(arm9[at:at + length]).hex()

    hooks = []
    for item in symbols['external']:
        target = item['target']
        if target['module'] != 'ARM9':
            raise ValueError('Unexpected non-ARM9 PMC boot hook')
        length = item['size'] if target['type'] == 'FULL_COPY' else 16 if target['type'] == 'THUMB_BRANCH_SAFESTACK' else 8 if target['type'] == 'THUMB_BRANCH' else 4
        hooks.append({'id': item['source'], 'address': target['address'], 'expectedHex': signature(target['address'] & ~1, length)})
    imports = []
    for item in symbols['imports']:
        address = item['address'] & ~1
        if base <= address < base + len(arm9):
            imports.append({'id': item['name'], 'address': address, 'expectedHex': signature(address, 16)})
    return {'gameCode': game_code, 'revision': 0, 'sourceSha256': contract['target']['sha256'],
            'pmcVersion': symbols['metadata']['PMCVersion'], 'hooks': hooks, 'imports': imports}


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: generate_bw2_pmc_contract.py CLEAN_W2.nds CLEAN_B2.nds')
    result = {'schemaVersion': 1, 'profiles': {
        'IRDO': profile(Path(sys.argv[1]), 'IRDO', 'contract.json', 'PMC_W2.rpm'),
        'IREO': profile(Path(sys.argv[2]), 'IREO', 'black2-contract.json', 'PMC_B2.rpm'),
    }}
    output = HERE / 'bw2-pmc-contract.json'
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'Pinned {sum(len(p["hooks"]) + len(p["imports"]) for p in result["profiles"].values())} PMC sites in {output}')

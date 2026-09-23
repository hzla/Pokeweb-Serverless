"""Capture the inspected expansion's required runtime fingerprints; never edits inputs."""
import argparse, hashlib, json
from pathlib import Path
import ndspy.rom, ndspy.codeCompression

def generate(rom_path,output):
 data=rom_path.read_bytes();rom=ndspy.rom.NintendoDSRom(data)
 names=['White2Upgrade','White2UpgradeField','White2UpgradePokedex','White2UpgradeUI']
 modules=[dict(path=f'patches/{name}.dll',sha256=hashlib.sha256(rom.getFileByName(f'patches/{name}.dll')).hexdigest()) for name in names]
 arm9=ndspy.codeCompression.decompress(rom.arm9)
 adapters=[]
 for name,address,end,abi in [('upgrade-registry-free-space',0x02039f8c,0x02039fbc,'Thumb; r0 heap ID; returns total free bytes in r0, including zero without asserting; no allocation.'),('upgrade-registry-allocation',0x02039dc8,0x02039e58,'Thumb; r0 heap ID, r1 byte count; returns allocation or NULL in r0; non-asserting core allocator; caller preserves 8-byte SP alignment.'),('upgrade-registry-free',0x02039e58,0x02039edc,'Thumb; r0 owned non-NULL block from core allocator; release once before module unload; no return value.')]:
  adapters.append(dict(id=name,segment='ARM9',address=address,expectedHex=bytes(arm9[address-rom.arm9RamAddress:end-rom.arm9RamAddress]).hex(),abi=abi))
 value=dict(schemaVersion=1,profile='white2upgrade',speciesMax=1023,maxRows=6144,gameCode='IRDO',revision=0,sourceRomSha256=hashlib.sha256(data).hexdigest(),requiredModules=modules,nativeAdapters=adapters,
            notes=['Shared hook/native-adapter contract must match exactly.', 'Every installed patch is independently checked for overlap before mutation.', 'Species 1024 and 1025 are reserved Egg IDs, not supported species.'])
 output.write_text(json.dumps(value,indent=2)+'\n')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('rom',type=Path);p.add_argument('--output',type=Path,default=Path(__file__).with_name('upgrade-contract.json'));a=p.parse_args();generate(a.rom,a.output)

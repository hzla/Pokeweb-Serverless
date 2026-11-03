"""Run shipped Thumb budget and arena-accounting code with isolated memory."""
from pathlib import Path
import json, struct, subprocess, tempfile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC

root = Path(__file__).resolve().parents[2]
base, data, stop = 0x02200000, 0x02280000, 0x02300000
def machine(code):
    vm = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    vm.mem_map(0x02000000, 0x400000)
    vm.mem_write(base, code)
    vm.reg_write(UC_ARM_REG_SP, 0x02380000)
    vm.reg_write(UC_ARM_REG_LR, stop | 1)
    return vm
def words(vm, address, count):
    return struct.unpack('<' + 'I' * count, vm.mem_read(address, count * 4))

code = bytes(json.loads((root/'src/assets/data/pmcHeapBudgetRuntime.json').read_text())['code'])
cases = [
    (0x02221180, 0x023e0000, 0x199500, 1, 0x180e80),
    (0x02200000, 0x023e0000, 0x199500, 1, 0x199500),
    (0x02208b00, 0x023e0000, 0x199500, 1, 0x199500),
    (0x023a0000, 0x023e0000, 0x199500, 0, 0x199500),
    (0x023d0000, 0x023e0000, 0x199500, 0, 0x199500),
    (0x02700000, 0x02f80000, 0x199500, 1, 0x199500),
]
for lo, hi, parent, allowed, expected in cases:
    vm = machine(code)
    vm.mem_write(data, struct.pack('<4I', 0x6000, 0, parent, 0))
    for reg, value in [(UC_ARM_REG_R0,data),(UC_ARM_REG_R1,lo),(UC_ARM_REG_R2,hi)]:vm.reg_write(reg,value)
    vm.emu_start(base|1, stop, count=1000)
    assert vm.reg_read(UC_ARM_REG_R0)==allowed,(lo,hi)
    assert words(vm,data,4)==(0x6000,0,expected,0),(lo,hi,words(vm,data,4))

# Extract the generated DLL's actual code segment; no ROM input is required.
rpm = (root/'src/assets/codeinjection/PMC_W2_200.rpm').read_bytes()
header = struct.unpack_from('<I',rpm,8)[0]
info = header + struct.unpack_from('<I',rpm,header+8)[0]
offset, size = struct.unpack_from('<II',rpm,info+16)
code = rpm[offset:offset+size]
# The retained profile exposes CreateIn at the same offset in all variants.
factory = 2124
for heap_base in (0x02280000,0x02280008):
    vm = machine(code)
    for reg,value in [(UC_ARM_REG_R0,0),(UC_ARM_REG_R1,heap_base),(UC_ARM_REG_R2,200*1024)]:vm.reg_write(reg,value)
    vm.emu_start((base+factory)|1,stop,count=1000)
    assert vm.reg_read(UC_ARM_REG_R0)==heap_base
    _, start, capacity, free = words(vm,heap_base,4)
    assert start+capacity==heap_base+200*1024,(start,capacity)
    assert free==start and words(vm,free,1)[0]==capacity-16
with tempfile.TemporaryDirectory(prefix='pmc-boot-abi-') as tmp:
    path = Path(tmp)/'fixture.json'
    subprocess.run([str(root/'node_modules/.bin/vite-node'),str(root/'runtime/pmc-heap/test_fixture.ts'),str(path)],cwd=root,check=True)
    fixture = json.loads(path.read_text())
for lo,hi,expected in [(0x02221180,0x023e0000,['create','initialize','game','start']),(0x023a0000,0x023e0000,['game','create','initialize','start']),(0x02700000,0x02f80000,['create','initialize','game','start'])]:
    vm = machine(b'\x70\x47'); vm.mem_write(fixture['base'],bytes(fixture['code']))
    vm.mem_map(0x02fff000,0x1000);vm.mem_write(0x02fffda0,struct.pack('<I',lo));vm.mem_write(0x02fffdc4,struct.pack('<I',hi))
    initial=[1,0x221ad20,0x2217d20,0];registers=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
    for reg,value in zip(registers,initial):vm.reg_write(reg,value)
    vm.reg_write(UC_ARM_REG_SP,0x02380004);calls=[]
    def service(vm,address,size,unused):
        for name,target in fixture['services'].items():
            if address!=target:continue
            assert vm.reg_read(UC_ARM_REG_SP)&7==0,(name,hex(vm.reg_read(UC_ARM_REG_SP)))
            calls.append(name)
            if name=='game':assert [vm.reg_read(reg)for reg in registers]==initial
            if name=='initialize':assert vm.reg_read(UC_ARM_REG_R0)==0x02290000
            vm.reg_write(UC_ARM_REG_R0,0x02290000 if name=='create'else 0xf00d)
            for reg in registers[1:]:vm.reg_write(reg,0xdead)
            vm.reg_write(UC_ARM_REG_PC,vm.reg_read(UC_ARM_REG_LR));return
    vm.hook_add(UC_HOOK_CODE,service)
    vm.emu_start(fixture['entry']|1,stop,count=3000)
    assert calls==expected,calls
    assert vm.reg_read(UC_ARM_REG_SP)==0x02380004
print('11 shipped ARM cases passed: bounded budgets, fallback, DSi, arena bounds and startup ABI/call ordering.')

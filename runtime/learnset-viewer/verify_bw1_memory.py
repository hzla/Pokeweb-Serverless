"""Compiled info allocations in DS and extended DSi RAM fixtures.

The actual retail mode getter executes; the heap and filesystem boundaries
are instrumented. This does not establish live DSi acceptance or native heap
capacity. The runtime adds no upper bound to native allocation pointers.
"""
import hashlib
import json
import struct
from configure_bw1 import HERE, PROFILES
from verify_info import Harness, WORK, REQUEST

checks=[]
for game in ('B','W'):
    h=Harness(game)
    getter=PROFILES[game]['isDsi']
    state=struct.unpack('<I',h.c.mem_read(getter+68,4))[0]
    for extended in (False,True):
        h.reset();h.w32(state+28,1);h.w32(state+4,int(extended))
        assert h.call(getter)==int(extended),'Retail mode getter did not match fixture'
        h.arena=0x02800000 if extended else 0x02270000
        h.species=30;h.start();h.check_type_uploads()
        assert all((0x02800000<=p<0x03000000 if extended else 0x02000000<=p<0x02400000) for p in h.allocations)
        h.navigate(True,(31,0));h.navigate(False,(30,0));h.end()
        assert not h.allocations and not h.opened
        checks.append({'game':game,'extendedRam':extended,'nativeModeGetter':getter,'passed':True,
                       'viewerSha256':hashlib.sha256((HERE/f'build/LearnsetViewer{game}.dll').read_bytes()).hexdigest(),
                       'liveDsiAccepted':False})
        print(game,'extended DSi fixture' if extended else 'DS fixture','native mode, allocation-pointer access, navigation and cleanup passed; gameplay acceptance pending',flush=True)
(HERE/'build/bw1-memory-verification.json').write_text(json.dumps({'checks':checks,'limitations':__doc__.strip()},indent=2)+'\n')

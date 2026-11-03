"""Compare real encoded records through the compiled Thumb interpreter."""
import json,sys
from test_runtime import Harness,CONFIG
from test_history_runtime import HistoryHarness
for case in json.load(open(sys.argv[1])):
    results=[]
    for encoded in case['versions']:
        h=HistoryHarness() if case.get('method')=='persistent' else Harness()
        h.selectedMove=case.get('count',1);h.u.mem_write(CONFIG,bytes(encoded))
        if case.get('method')=='persistent':
            h.invoke('MoveHistoryInit');h.vars.update({3:0,4:1,0x32:10,0x46:0})
            for move in (1,2):
                h.selectedMove=move;h.call('MoveEvent_4b',move=move)
            h.vars[2]=1;h.event(0x77);value=h.stats[(1,13)]
        elif case.get('method')=='matchup':
            value=h.matchup(hook=True)
        else:
            h.call(case.get('event','MoveEvent_37'),move=case.get('count',1))
            value=h.vars[0x22 if case.get('method')=='prerequisite' else 0x30]
        assert value==case['expected'],(case['name'],value)
        assert h.queries==case['queries'],(case['name'],h.queries)
        results.append((value,h.queries,h.work))
    assert results[0]==results[1],case['name']
    print(case['name']+': v1/v2 equivalent')

"""Verify the current expansion streaming runtime. Historical allocation tests are superseded."""
import json,sys
from pathlib import Path
from verify_registry_stream import verify
result=verify(Path(sys.argv[1]))
assert result['speciesMax']==1023
print(json.dumps(result,indent=2))

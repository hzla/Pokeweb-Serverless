"""Keep BW1 DS acceptance tied to the tested native profile and exact DLLs."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ACCEPTANCE = HERE / 'bw1-ui-acceptance.json'
PACKAGING_FIELDS = {
    'dsAccepted', 'liveDsiAccepted', 'version', 'dllSha256', 'sha256',
    'codeFingerprint', 'bssSize', 'symbols', 'relocations', 'builds',
    'previousBuilds', 'variants', 'fileName', 'dllFilename', 'modules',
    'implementation',
}


def profile_digest(profile):
    native = {key: value for key, value in profile.items() if key not in PACKAGING_FIELDS}
    return hashlib.sha256(json.dumps(native, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def ds_accepted(component, game, profile, artifacts, acceptance=None):
    """Changed bindings or artifacts require fresh acceptance; DSi is separate."""
    if acceptance is None:
        acceptance = json.loads(ACCEPTANCE.read_text()) if ACCEPTANCE.exists() else {}
    if acceptance.get('format') != 1:
        return False
    pair = acceptance.get('components', {}).get(component, {}).get('games', {})
    if game not in ('B', 'W') or any(pair.get(g, {}).get('dsAccepted') is not True for g in ('B', 'W')):
        return False
    record = pair[game]
    expected_id = {'B': 'IRBO', 'W': 'IRAO'}[game]
    if profile.get('idCode', profile.get('rom_code')) != expected_id or profile.get('revision') != 0:
        return False
    if record.get('idCode') != expected_id or record.get('revision') != 0:
        return False
    digests = {name: hashlib.sha256(data).hexdigest() for name, data in artifacts.items()}
    return (record.get('nativeProfileSha256') == profile_digest(profile)
            and record.get('artifacts') == digests)

"""Check bundled BW1 DS release records and fail-closed rebuild behavior."""
import copy
import json
from pathlib import Path
from bw1_release import ACCEPTANCE, ds_accepted

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / 'src/assets/codeinjection'
COMPONENTS = {
    'summary-stat-viewer': ('summaryStatViewerManifest.json', 'games', 'summary-stat-viewer/profile-{game}.json', ['SummaryStatViewer']),
    'type-icons': ('battleTypeHudManifest.json', 'games', 'battle-type-hud/profile-TypeIcons-{game}.json', ['TypeIcons', 'TypeIconsCircular', 'TypeIconsSolid']),
    'move-effectiveness': ('battleTypeHudManifest.json', 'moveGames', 'battle-type-hud/profile-MoveEffectiveness-{game}.json', ['MoveEffectiveness']),
    'learnset-viewer': ('learnsetViewerManifest.json', 'games', 'learnset-viewer/profile-{game}.json', ['LearnsetMenu', 'LearnsetViewer']),
    'enhanced-party-menu': ('menuEvolutionBw1Manifest.json', 'games', None, ['MenuEvolution']),
}


def inputs(component, game):
    manifest_name, key, profile_name, prefixes = COMPONENTS[component]
    shipped = json.loads((ASSETS / manifest_name).read_text())[key][game]
    profile = json.loads((HERE / profile_name.format(game=game)).read_text()) if profile_name else shipped
    if component == 'summary-stat-viewer':
        profile = {**profile, 'signatures': shipped['signatures'], 'resources': shipped['resources']}
    artifacts = {f'{prefix}{game}.dll': (ASSETS / f'{prefix}{game}.dll').read_bytes() for prefix in prefixes}
    if component == 'enhanced-party-menu':
        title = {'B': 'Black1', 'W': 'White1'}[game]
        for suffix in ('BattleLog', 'BattleCounters', 'BattleLogSummary'):
            name = title + suffix + '.dll'
            artifacts[name] = (ASSETS / name).read_bytes()
    return shipped, profile, artifacts


def main():
    acceptance = json.loads(ACCEPTANCE.read_text())
    for component in COMPONENTS:
        for game in ('B', 'W'):
            shipped, profile, artifacts = inputs(component, game)
            assert shipped['dsAccepted'] is True and ds_accepted(component, game, profile, artifacts)
            assert acceptance['components'][component]['games'][game]['liveDsiAccepted'] is False
            changed = dict(artifacts)
            name = next(iter(changed)); changed[name] += b'\0'
            assert not ds_accepted(component, game, profile, changed), 'Changed DLL inherited acceptance'
            assert not ds_accepted(component, game, {**profile, 'revision': 1}, artifacts)
            assert not ds_accepted(component, game, {**profile, 'idCode': 'IRXX'}, artifacts)
            assert not ds_accepted(component, game, {**profile, 'unverifiedBinding': 1}, artifacts)
            assert not ds_accepted(component, game, profile, artifacts, {})
            assert not ds_accepted(component, game, profile, artifacts, {**acceptance, 'format': 0})
            missing_pair = copy.deepcopy(acceptance)
            missing_pair['components'][component]['games']['W']['dsAccepted'] = False
            assert not ds_accepted(component, game, profile, artifacts, missing_pair)
            print(component, game, 'accepted artifacts/profile match; changed inputs and incomplete pair remain disabled; live DSi pending')


if __name__ == '__main__':
    main()

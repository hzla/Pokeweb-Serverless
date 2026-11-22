"""Host tests only: these do not claim native field or game-emulator coverage."""
import os
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
BUILD=Path(os.environ.get('FOLLOWING_BUILD_DIR',HERE/'build'))
BUILD.mkdir(parents=True,exist_ok=True)
subprocess.run([os.environ.get('CC','cc'),'-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',
    str(HERE/'following.c'),str(HERE/'object_codes.c'),str(HERE/'registry.c'),str(HERE/'tests/logic.c'),'-o',str(BUILD/'logic-test')],check=True)
subprocess.run([str(BUILD/'logic-test')],check=True)
subprocess.run([os.environ.get('CC','cc'),'-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I',str(HERE),str(HERE/'tests/field_layout.c'),'-o',str(BUILD/'field-layout-test')],check=True)
subprocess.run([str(BUILD/'field-layout-test')],check=True)
subprocess.run([os.environ.get('PYTHON','python3'),'-m','unittest','discover','-s',str(HERE/'tests'),'-p','test_*.py'],check=True)

subprocess.run([os.environ.get('CC','cc'),'-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',str(HERE/'reactions.c'),str(HERE/'tests/reactions.c'),'-o',str(BUILD/'reactions-test')],check=True)
reaction_args=[str(HERE.parents[1]/'src/assets/following/interactions.bin'),str(HERE.parents[1]/'src/assets/following/contextual-dialogues.narc'),str(HERE.parents[1]/'src/assets/following/contextual-items.narc')]
subprocess.run([str(BUILD/'reactions-test'),*reaction_args],check=True)

# The expansion must not retain the stock 649-species conversation limit.
subprocess.run([os.environ.get('CC','cc'),'-DFW_UPGRADE=1','-std=c11','-Wall','-Wextra','-Werror','-fsanitize=address,undefined',str(HERE/'reactions.c'),str(HERE/'tests/reactions.c'),'-o',str(BUILD/'reactions-upgrade-test')],check=True)
subprocess.run([str(BUILD/'reactions-upgrade-test'),*reaction_args],check=True)

for name, sources in [
    ('native-anchor', ['render_math.c', 'tests/native_anchor.c']),
    ('native-animation', ['render_math.c', 'tests/native_animation.c']),
    ('native-route', ['following.c', 'native_route.c', 'tests/native_route.c']),
    ('shadow-metrics', ['shadow_metrics.c', 'tests/shadow_metrics.c']),
]:
    executable=BUILD/(name+'-test')
    subprocess.run([os.environ.get('CC','cc'),'-DFW_NATIVE_BEHAVIOR=1','-std=c11','-Wall','-Wextra','-Werror',
        '-fsanitize=address,undefined','-I',str(HERE),*[str(HERE/source) for source in sources],'-lm','-o',str(executable)],check=True)
    arguments=[str(HERE.parents[1]/'src/assets/following/gen5-followers.narc')] if name=='shadow-metrics' else []
    subprocess.run([str(executable),*arguments],check=True)

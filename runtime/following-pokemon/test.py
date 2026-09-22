"""Host tests only: these do not claim native field or game-emulator coverage."""
import os
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
BUILD=HERE/'build'
BUILD.mkdir(exist_ok=True)
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

"""Audited US revision-0 native address profiles (addresses use W2 as keys)."""
from pathlib import Path
import os

WS = Path(__file__).resolve().parents[3]
PROFILES = {'W2': 'IRDO', 'B2': 'IREO'}

def address(value, game):
    if game == 'W2': return value
    if game != 'B2': raise ValueError(game)
    # The bound ARM9 file services shift by 44 bytes; battle overlay 167
    # shifts by 64 bytes. Overlay 169 and its side-condition storage do not.
    if 0x020191d8 <= value < 0x02100000: return value - 44
    if 0x02199900 <= value < 0x021e0000: return value - 64
    return value

def rom_path(game):
    return Path(os.environ.get(f'TRAINER_FIELDS_{game}_ROM', WS / ('cleanwhite2.nds' if game == 'W2' else 'cleanblack2.nds')))

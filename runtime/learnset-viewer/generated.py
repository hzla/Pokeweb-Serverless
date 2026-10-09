"""Shared private-message configuration generator for all Learnset companions."""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent

def write_info_messages(build):
    BUILD=build
    messages=json.loads((HERE/'info_messages.json').read_text())
    assert len({key for key,text in messages})==len(messages)
    header=['#pragma once', '#include "runtime.h"', 'enum class InfoMessage : u16 {']
    header += [f'    {key},' for key,text in messages]
    header += ['};',f'constexpr u32 InfoMessageCount={len(messages)};',
               'struct InfoConfig { u8 magic[8]; u16 version,count; u16 ids[InfoMessageCount][2]; };',
               'extern "C" { __attribute__((used,section(".learnset_info_config"))) volatile InfoConfig learnsetInfoConfig = {',
               "    {'L','S','V','I','N','F','1',0},1,InfoMessageCount,{",
               *['        {0xffff,0},' for _ in messages], '    }}; }']
    (BUILD/'info_messages.generated.h').write_text('\n'.join(header)+'\n')

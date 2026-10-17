#pragma once
#include "logic.h"
namespace nuzlocke {
// No save data is owned or modified. This snapshot is shared by the encounter
// filter and the optional Pokenav launcher, compiled independently into each.
bool snapshot(void* game,u8* excluded);
bool preventAll();
}

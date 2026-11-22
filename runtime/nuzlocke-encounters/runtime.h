#pragma once
#include "logic.h"
namespace nuzlocke {
// Read the live Pokédex without modifying the save. The encounter filter
// retains its family table for frequent rolls. A preview owns its table only
// for the duration of this call.
bool snapshotPreview(void* game,u8* excluded,bool& prevent);
bool snapshot(void* game,u8* excluded);
bool preventAll();
}

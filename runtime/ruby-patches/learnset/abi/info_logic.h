#pragma once
#include "logic.generated.h"
namespace learnset {
constexpr u32 MaxPersonal = 4096;
struct Evolution { u16 method, parameter, target; };
struct Evolutions { Evolution entries[8]; u8 count; bool valid; };

struct InfoNode { u16 species, form, parent, next; bool valid, evolutionValid; };
struct Chain { u16 ids[3]; u8 count, selected; bool before, after; };
struct Abilities { u8 ids[3]; bool hidden[3]; u8 count; };

struct FamilyStep { u16 target,parent; };

// Forward visits the selected target's descendants before moving to its next
// sibling. Backward visits previous siblings, then their source. No repeated
// identity is followed inside a traversal; deliberate presses can browse cycles.

// Word wrap with a guaranteed advance even for a single over-wide glyph.
// Offsets identify continuation pages without copying/losing text.

// DS 4bpp tiles, 32 tiles per row for the full upper screen.

}

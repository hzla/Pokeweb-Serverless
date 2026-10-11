#pragma once
#include <stdint.h>
namespace learnset {
using u8 = uint8_t;
using u16 = uint16_t;
using u32 = uint32_t;
constexpr u32 MaxEntries = 32;
constexpr u16 End = 0xffff;
constexpr u16 Command = 0x4c53;
constexpr u32 Transition = 0x4c535631;
constexpr u32 RequestMagic = 0x3156534c;
constexpr u16 RequestVersion = 3;
constexpr u8 BrowseFamily = 0xfe;
struct ViewIdentity { u16 species,form; };
struct ViewSelection { ViewIdentity identity,parent; };
struct Entry { u16 moveId; u16 level; };
enum class Status : u16 { Ready, Empty, Unavailable };
struct List { Entry entries[MaxEntries]; u16 count; Status status; };
// D-pad Right advances in party order; Left goes backwards. One bounded
// pass skips Eggs/empty slots and returns the current slot if it is alone.

// Bounded NARC lookup, without the retail archive reader's fatal assertions.
// Read must return false on a short read; all arithmetic is checked first.

// No filtering by the Pokemon's level or known moves. Exact duplicates only.

// Check the unexpanded *main* menu as well as the already-expanded count.
// Item/mail submenus and Egg menus have different prefixes.

// The caller supplies PRINTSYS_GetStrWidth; host tests use a deterministic font.

}

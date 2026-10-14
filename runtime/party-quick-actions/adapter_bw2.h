#pragma once
// US revision-0 BW2 bindings. These are pinned by build.py in both ROMs.
inline u32 nativeAddress(u32 a) {
#ifdef GAME_B2
 return a==0x214197c?0x214193c:a>=0x20191d8?a-44:a;
#else
 return a;
#endif
}
inline u32 nativeEntry(u32 a) { return nativeAddress(a)|1; }
inline u32 overlayAddress(u32 a) {
#ifdef GAME_B2
 return a-64;
#else
 return a;
#endif
}
inline u32 overlayEntry(u32 a) { return overlayAddress(a)|1; }
namespace Profile {
constexpr u32 Request=0x28c, Slot=0x30, Pokemon=0x3c, Message=0x13c,
 Prompt=0x154, Plates=0x164, CancelFirst=0x1e8, CancelLast=0x1ec,
 Mode=0x44, Selected=0x4c, Result=0x50, Item=0x54, SelectorColor=0xac,
 MaxSaveFlag=3059, DecideSound=1356, MoveSound=1352, RecoverySound=1391;
constexpr bool hideSelectionFrame(u32) { return true; }
}

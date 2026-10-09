#pragma once
#if defined(GAME_B) || defined(GAME_W)
constexpr u32 PartyRequestOffset=0x280, PartyCommandOffset=0x3c, PartySlotOffset=0x2c;
constexpr u32 PartyMessageOffset=0x134, RequestModeOffset=0x34, RequestSlotOffset=0x3c, RequestResultOffset=0x40;
constexpr u32 TutorOverlay=173, PersonalRecordSize=60;
constexpr u32 messageBank(u32 bank) {
    switch(bank) {
        case 401:return 204;
        case 90:return 284;
        case 64:return 54;
        case 403:return 286;
        case 487:case 374:return 285;
        default:return bank;
    }
}
#else
constexpr u32 PartyRequestOffset=0x28c, PartyCommandOffset=0x40, PartySlotOffset=0x30;
constexpr u32 PartyMessageOffset=0x138, RequestModeOffset=0x44, RequestSlotOffset=0x4c, RequestResultOffset=0x50;
constexpr u32 TutorOverlay=258, PersonalRecordSize=76;
constexpr u32 messageBank(u32 bank) {return bank;}
#endif

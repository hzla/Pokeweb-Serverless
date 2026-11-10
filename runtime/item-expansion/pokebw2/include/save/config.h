#ifndef POKEBW2_SAVE_CONFIG_H
#define POKEBW2_SAVE_CONFIG_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"

// The options, which a save keeps at the start of the block that getTrainerDataBlkAddress returns, so a pointer to one
// is that block's. The field names are guessed, apart from kanji and cgearOn, which the code's use shows
struct Config {
    u16 textSpeed : 4;
    u16 soundFlags : 2;
    u16 unk6 : 1;
    u16 unk7 : 1;
    // The kana or kanji text of the Japanese version, which also sets the message language
    u16 kanji : 1;
    u16 unk9 : 1;
    // Whether the C-Gear is on, which a continue sets from the answer to the start menu's question
    u16 cgearOn : 1;
    u16 : 5;
    u16 unk2;
};

// Points the key remaps at the game's table
void initKeyBlk(void);
Config *Config_Create(u32 heapId);
// Copies a config into the save's
void initConfig(const Config *config, Config *dest);
void Config_Init(Config *config);
u32 Config_GetTextSpeed(const Config *config);
void Config_SetTextSpeed(Config *config, u32 value);
u32 getSoundFlags(const Config *config);
void Config_SetSoundFlags(Config *config, u32 value);
BOOL Config_GetBattleScene(const Config *config);
void Config_SetBattleScene(Config *config, u32 value);
BOOL Config_GetBattleStyle(const Config *config);
void Config_SetBattleStyle(Config *config, u32 value);
// Also sets the message language
void Config_SetKanji(Config *config, u32 value);
u32 Config_GetKanji(const Config *config);
void Config_ApplyMsgLanguage(const Config *config);
u32 Config_GetSaveBeforeIR(const Config *config);
void Config_SetSaveBeforeIR(Config *config, u32 value);
u32 Config_GetCGearOn(const Config *config);
void Config_SetCGearOn(Config *config, u32 value);

#endif // POKEBW2_SAVE_CONFIG_H

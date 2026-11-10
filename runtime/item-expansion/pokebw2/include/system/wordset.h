#ifndef POKEBW2_SYSTEM_WORDSET_H
#define POKEBW2_SYSTEM_WORDSET_H

#include "types.h"
#include "gfl/heap.h"
#include "struct_decls.h"
#include "system/str_tool.h"

// Word sets (wordset.c): the words that fill the placeholders in messages

WordSet *GFL_WordSetSystemCreateDefault(HeapID heapId);
// A word set of count words of up to length characters
WordSet *GFL_WordSetSystemCreate(u32 count, u32 length, HeapID heapId);
void GFL_WordSetSystemFree(WordSet *wordSet);
void GFL_WordSetClearAll(WordSet *wordSet);
void GFL_WordSetFormatStrbuf(WordSet *wordSet, StrBuf *dest, const StrBuf *src);
void GFL_WordSetLoadStr(WordSet *wordSet, u32 index, const u16 *str);
void WordSet_LoadSpeciesName(WordSet *wordSet, u32 index, u32 species);
void loadCountryToStrbuf(WordSet *wordSet, u32 index, u32 country);
void loadCountryAreaToStrbuf(WordSet *wordSet, u32 index, u32 country, u32 area);
void loadJobAnswerToStrbuf(WordSet *wordSet, u32 index, u8 job);
void loadHobbyNameToStrbuf(WordSet *wordSet, u32 index, u8 hobby);
// Puts a Pokémon's species name in a word set
void setPartyPokemonSpeciesNameToStrbuf(WordSet *wordSet, u32 index, PartyPkm *pkm);
void loadPokemonNicknameToStrbuf(WordSet *wordSet, u32 index, PartyPkm *pkm);
void loadPokemonTextNameToStrbuf(WordSet *wordSet, u32 index, u32 species);
void loadPokemonSpeciesTextNameToStrbuf(WordSet *wordSet, u32 index, PartyPkm *pkm);
void loadMoveNameToStrbuf(WordSet *wordSet, u32 index, u32 move);
void loadItemNameToStrbuf(WordSet *wordSet, u32 index, u32 item);
void loadPassPowerToStrbuf(WordSet *wordSet, u32 index, u32 passPower);
void WordSet_LoadFestivalMission(WordSet *wordSet, u32 index, u8 value, s32 arg3);
// An item's name: the plural when plural is set, else the one in message file 481 when a4 is set
void loadItemText(WordSet *wordSet, u32 index, u32 item, BOOL plural, BOOL a4);
void loadBagPocketNameToStrbuf(WordSet *wordSet, u32 index, u32 pocket);
// Puts the player's name in a word set
void copyVarForText(WordSet *wordSet, u32 index, PlayerInfo *playerInfo);
// Puts a place name, from the place names' message file, in a word set
void loadLocationNameToStrbuf(WordSet *wordSet, u32 index, u32 placeNameId);
void loadMonthToStrbuf(WordSet *wordSet, u32 index, u32 month);
void GFL_WordSetSetStrbuf(WordSet *wordSet, u32 index, const StrBuf *strbuf, u32 gender, u32 singular, u32 language);

// Formats a number as GFL_WordSetFormatNumber does
void WordSetNumber(WordSet *wordSet, u32 index, s32 number, u32 digits, u32 pad, BOOL ascii);

void setBoxPokemonSpeciesNameToStrbuf(WordSet *wordSet, u32 index, BoxPkm *pkm);
void loadBoxPokemonNameToStrbuf(WordSet *wordSet, u32 index, BoxPkm *pkm);
void loadItemTextNameToStrbuf(WordSet *wordSet, u32 index, u32 item);
void loadItemsNameToStrbuf(WordSet *wordSet, u32 index, u32 item);
void loadAbilityNameToStrbuf(WordSet *wordSet, u32 index, u32 ability);
void loadNatureToStrbuf(WordSet *wordSet, u32 index, u32 nature);
void loadSayingForDisplay(WordSet *wordSet, u32 index, u16 saying);
void func_02024574(WordSet *wordSet, u32 index, u32 value);
void loadTypeTextToStrbuf(WordSet *wordSet, u32 index, u32 type);
void loadTrainerTypeText(WordSet *wordSet, u32 index, u8 trainerType);
void loadTrainerTypeToStrbuf(WordSet *wordSet, u32 index, u32 trainerId);
void loadTrainerTypeWithArticleToStrbuf(WordSet *wordSet, u32 index, u8 trainerType);
void loadTrainerNamesToStrbuf(WordSet *wordSet, u32 index, u32 trainerId);
void loadStatNameToStrbuf(WordSet *wordSet, u32 index, u8 stat);
void loadBoxNameForDisplay(WordSet *wordSet, u32 index, void *boxData, u32 box);
void loadQuestionnaireAnswerToStrbuf(WordSet *wordSet, u32 index, u8 answer);
void loadBattleInstituteMsgForDisplay(WordSet *wordSet, u32 index, u32 rank);
void loadMedalNameToStrbuf(WordSet *wordSet, u32 index, u8 medal);
void loadMedalRankToStrbuf(WordSet *wordSet, u32 index, u8 rank, u32 medalType);
void loadFromEmptyFile(WordSet *wordSet, u32 index, u8 messageId);
void loadPokewoodLineToStrbuf(WordSet *wordSet, u32 index, u32 line);
void WordSet_LoadPWTTournamentType(WordSet *wordSet, u32 index, u32 tournament);

#endif // POKEBW2_SYSTEM_WORDSET_H

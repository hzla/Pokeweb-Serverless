#ifndef POKEBW2_FIELD_GAME_BEACON_SET_H
#define POKEBW2_FIELD_GAME_BEACON_SET_H

// Overlay 12's game_beacon_set.c (a descriptive name): the field's messages to nearby players, which it puts in the
// beacon that ARM9 main's g_GameBeaconSys broadcasts. Each message has a public function, which checks that the
// message may be sent, and a function that fills the beacon in

#include "types.h"
#include "pml/item.h"
#include "struct_decls.h"
#include "system/game_beacon.h"

void GameBeacon_BroadcastWildBattleStart(u16 value);
void GameBeacon_BroadcastWildBattleWin(u16 value);
void GameBeacon_BroadcastTrainerBattleStart(u16 itemId);
void GameBeacon_BroadcastTrainerBattleWin(u16 itemId);
void GameBeacon_BroadcastLeaderBattleStart(u16 itemId);
void GameBeacon_BroadcastLeaderBattleWin(u16 itemId);
void GameBeacon_BroadcastSpecialTrainerBattleStart(u16 itemId);
void GameBeacon_BroadcastSpecialTrainerBattleWin(u16 itemId);
void GameBeacon_BroadcastPassPower(u32 passPower);
void GameBeacon_BroadcastFoundItem(u16 value);
void GameBeacon_BroadcastPokedexComplete(void);
void GameBeacon_BroadcastThankedCount(u32 value);
void GameBeacon_BroadcastUnionRoomReception(void);
void GameBeacon_BroadcastBattleEscape(u16 value);
void GameBeacon_BroadcastLowHP(u16 value, const StrBuf *name);
void GameBeacon_BroadcastLowPP(u16 value, const StrBuf *name);
void GameBeacon_BroadcastFainted(u16 value, const StrBuf *name);
void GameBeacon_BroadcastStatusCondition(const StrBuf *name);
void GameBeacon_BroadcastFieldMove(u16 value);
void GameBeacon_BroadcastEggReceived(void);
void GameBeacon_BroadcastEggHatched(u16 species);
void GameBeacon_BroadcastShopping(void);
void GameBeacon_BroadcastBattleSubwayChallenge(void);
void GameBeacon_BroadcastBattleSubwayWinStreak(u32 value);
void GameBeacon_BroadcastBattleSubwayTrophy(void);
void GameBeacon_BroadcastBattleInstituteChallenge(void);
void GameBeacon_BroadcastBattleInstituteRank(u8 value);
void GameBeacon_BroadcastFerrisWheel(void);
void GameBeacon_BroadcastPokeTransfer(void);
// That the player is in a musical with the Pokémon of that name
void GameBeacon_BroadcastMusical(const StrBuf *name);
void GameBeacon_BroadcastReceivedPassPower(u32 passPower);
void GameBeacon_BroadcastThanks(GameData *gameData, u16 value);
void GameBeacon_BroadcastPokestarShooting(u8 value);
void GameBeacon_BroadcastPokestarWatching(u8 value);
void GameBeacon_BroadcastTournamentChallenge(u16 value);
void GameBeacon_BroadcastTournamentWin(u16 value, u8 kind);
void GameBeacon_BroadcastTournamentLoss(u16 value, u8 extra);
// Sends a beacon of type 0x39, if GameBeaconSys_CanSendType allows it
void GameBeacon_BroadcastJoinAvenueShopping(void);
void GameBeacon_BroadcastAreaChallenge(u8 extra, u16 value);
void GameBeacon_BroadcastAreaCleared(u8 extra, u16 value);
void GameBeacon_BroadcastBattleLostMission(void);
void GameBeacon_BroadcastMission(u8 type, u16 value);

#endif // POKEBW2_FIELD_GAME_BEACON_SET_H

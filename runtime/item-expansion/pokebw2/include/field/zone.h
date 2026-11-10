#ifndef POKEBW2_FIELD_ZONE_H
#define POKEBW2_FIELD_ZONE_H

// Names, layouts and constants from swan (https://github.com/ds-pokemon-hacking/swan, GPL-3.0)

#include "types.h"
#include "gfl/heap.h"
#include "nitro/fx.h"
#include "struct_decls.h"

struct RailPosition {
    u16 componentId;
    u8 componentIsLine;
    u8 railDirection;
    s16 posSide;
    u16 posFront;
};

typedef union {
    VecFx32 vec;
    RailPosition rail;
} FieldPosition;

struct ZoneSpawnInfo {
    u32 changeType;
    s16 zoneId;
    s16 warpId;
    s16 warpDir;
    u16 posWeightBits;
    BOOL isRail;
    FieldPosition pos;
};

struct RespawnZoneInfo {
    u16 discoveryFlagId;
    u16 canReturnHere : 1;
    u16 discoverOnVisit : 1;
    u16 unkFlags : 14;
    u16 zoneId;
    u16 x : 8;
    u16 z : 8;
    u16 mainZoneId;
    u16 unk0A;
    u16 unk0C;
    u16 unk0E;
    u16 unk10;
    u16 unk12;
};

struct ZoneWarpGridPosition {
    u16 x;
    u16 y;
    u16 z;
    u16 width;
    u16 height;
    u16 unk0a;
};

struct ZoneWarpRailPosition {
    u16 componentId;
    u16 posFront;
    s16 posSide;
    u16 frontSpan;
    u16 sideSpan;
    u16 param;
};

// Field names from swan's ZoneFurniture. The struct is halfword-aligned (the festival missions copy it as a loop
// of 10 halfwords), so a grid entity's s32 x, y and z are read through a cast of its position.
struct ZoneBGEntity {
    u16 scrId;
    u16 condition;
    u16 direction;
    u16 isRail;
    union {
        // s32 x, y and z
        u16 grid[6];
        struct {
            u16 componentId;
            u16 posFront;
            // Signed; read through a cast where its sign matters
            u16 posSide;
        } rail;
    } pos;
};

// A trigger's rectangle of the grid
struct ZoneTriggerGridPosition {
    u16 x;
    u16 z;
    u16 width;
    u16 height;
    s16 y;
};

// Field names from swan.
struct ZoneTrigger {
    u16 scrId;
    u16 workValue;
    u16 workId;
    u16 type;
    u16 isRail;
    union {
        ZoneTriggerGridPosition grid;
        struct {
            u16 componentId;
            u16 posFront;
            s16 posSide;
            u16 frontSpan;
            u16 sideSpan;
        } rail;
    } pos;
    u16 unk14;
};

struct ZoneWarp {
    u16 unk0;
    u16 destId;
    u8 unk4;
    u8 transitionType;
    u16 isRail;
    union {
        ZoneWarpGridPosition grid;
        ZoneWarpRailPosition rail;
    } pos;
};

extern const RespawnZoneInfo RESPAWN_ZONE_INFO[82];
// Tables of zonedata.c that no code of the ROM reads
extern const u16 BC_WF_ZONES[9];
extern const u16 GEAR_STATION_PLATFORM_ZONES[9];

// What GetRailIDForZone and GetCameraIDForZone return for a zone without one
#define ZONE_RAIL_NONE 0xffffffff
#define ZONE_CAMERA_NONE 0xffff

// Spawns at a position instead of a warp, warpId is -1
#define ZONE_SPAWN_CHANGE_TYPE_POSITION 1
#define ZONE_SPAWN_CHANGE_TYPE_3 3

#define WARP_DIR_UP 1
#define WARP_DIR_DOWN 2
#define WARP_DIR_LEFT 3
#define WARP_DIR_RIGHT 4

// With a map replace event set, each version allows its own area
#define VERSION_AREA_BLACK2 0
#define VERSION_AREA_WHITE2 1
#define VERSION_AREA_2 2
#ifdef BLACK2
#define VERSION_AREA_OWN VERSION_AREA_BLACK2
#else
#define VERSION_AREA_OWN VERSION_AREA_WHITE2
#endif

u16 ConvDirToWarpDir(u16 dir);
u32 ConvDirToRailDir(u32 direction);
u32 ConvDirToTriggerDir(u32 dir);
s16 GetDirectionVectorCompX(u16 direction);
s16 GetDirectionVectorCompZ(u16 direction);
void VecGPosToWPos(s32 x, s32 y, s32 z, VecFx32 *position);
u16 GetInverseDirection(u32 direction);
u16 GetDirFromPosToPos(s32 x1, s32 z1, s32 x2, s32 z2);
u8 RotateDirByAngle(u32 direction, u16 angle);
BOOL CheckWarpPositionMatch(const ZoneWarp *warp, const VecFx32 *position);
BOOL CheckWarpPositionMatchRail(const ZoneWarp *warp, const RailPosition *position);
BOOL CheckBGPositionMatchRail(const ZoneBGEntity *entity, const RailPosition *position);
BOOL CheckBGPositionMatchGrid(const ZoneBGEntity *entity, const VecFx32 *position);
void GetBGEntityCenterPosGrid(const ZoneBGEntity *entity, VecFx32 *position);
void GetBGEntityPosRail(const ZoneBGEntity *entity, RailPosition *position);
void GetTriggerCenterPos(const ZoneTrigger *trigger, VecFx32 *position);
void SetBGEntityLocation(EventData *data, u32 index, u16 x, u16 z, u16 y);
u16 ZoneWarp_CalcPosWeightBitsGrid_(ZoneWarp *warp, const VecFx32 *position);
u16 ZoneWarp_CalcPosWeightBitsRail_(ZoneWarp *warp, const RailPosition *position);
u16 ZoneWarp_CalcPosWeightBitsGrid(ZoneWarp *warp, const VecFx32 *position);
u16 ZoneWarp_CalcPosWeightBitsRail(ZoneWarp *warp, const RailPosition *position);
void GetBGEntityPosGrid_(const ZoneBGEntity *entity, VecFx32 *position);
void GetBGEntityPosRail_(const ZoneBGEntity *entity, RailPosition *position);
void GetTriggerCenterPos_(const ZoneTrigger *trigger, VecFx32 *position);
BOOL CheckTriggerPositionMatchRail(const ZoneTrigger *trigger, const RailPosition *position);
BOOL CheckTriggerPositionMatchXYZ(const ZoneTrigger *trigger, const VecFx32 *position);
BOOL CheckTriggerPositionMatchXZ(const ZoneTrigger *trigger, const VecFx32 *position);
BOOL CheckWarpDirectionMatch(const ZoneWarp *warp, u16 direction);
BOOL IsWarpZoneOrWarpID0xFFFF(const ZoneWarp *warp);
void SetZoneWarpLocation(EventData *eventData, u16 warpId, u16 x, u16 y, u16 z);
u32 ZoneWarp_GetDirection(const ZoneWarp *warp);
void GetGridWarpOutPos(ZoneWarp *warp, u32 direction, VecFx32 *position);
void GetRailWarpOutPos(const ZoneWarp *warp, u32 direction, RailPosition *position);
u16 CalcWarpTransferAddend(u32 posWeightBits, u32 warpDirection, BOOL isRail, u32 railParam, u16 span);
void CreateZoneChangeData(ZoneSpawnInfo *spawn, u32 zoneId, s16 warpDir, s32 x, s32 y, s32 z);
void CreateZoneChangeDataRail(ZoneSpawnInfo *spawn, u16 zoneId, s16 warpDir, u16 componentId, u16 posFront,
                              s16 posSide);
void SetupZoneSpawnInfoWarp(ZoneSpawnInfo *spawn, u16 zoneId, u16 warpId, u32 posWeightBits);
void SetupWarpParamByWarp(ZoneWarp *warp, ZoneSpawnInfo *spawn, u32 direction);
u32 GetInTransitionTypeBetweenZones(u16 fromZone, u16 toZone);
BOOL GetIsZoneMatrix0(u16 zoneId);
u32 GetOutTransitionTypeBetweenZones(u16 fromZone, u16 toZone);
u32 GetRespawnLocationIndexForRespawnZone(s32 zoneId);
u16 GetRespawnZoneMainZone(u16 index);
u32 GetLeaguePokeCenReturnLocationIdx(void);
BOOL IsReturnLocationNonLeaguePokeCen(GameData *gameData);
BOOL RangeCheckTeleportZone(s32 index);
u32 GetActualRespawnZoneIdx(u32 index);
void CreateRespawnZoneChangeData(ZoneSpawnInfo *spawn, u16 zoneId, u32 unused, u16 x, u16 z);
u32 GetWarpTransitionType(ZoneWarp *warp);
BOOL GetZoneFlagsEnableEscapeRope(u16 zoneId);
BOOL GetZoneFlagsEnableEntralinkWarp(u16 zoneId);
BOOL GetZoneFlagsEnableFlyFrom(u16 zoneId);
BOOL GetZoneIsEntralinkAny(u16 zoneId);
// Whether the zone is the Hidden Grotto's
BOOL GetZoneIsHiddenGroto(u16 zoneId);
ZoneTrigger *FindCollidingZoneTriggerAtLocation(EventData *eventData, EventWork *eventWork, const VecFx32 *position);
ZoneTrigger *FindTriggerAtPosGrid(EventData *eventData, EventWork *eventWork, const VecFx32 *position, u32 direction);
ZoneTrigger *FindTriggerAtPosRail(EventData *eventData, EventWork *eventWork, const RailPosition *position);
u16 GetTriggerSCRIDAtPosGrid(EventData *eventData, EventWork *eventWork, const VecFx32 *position, u32 direction);
u16 GetSCRIDOfCollidingTriggerAtLocation(EventData *eventData, EventWork *eventWork, const VecFx32 *position);
u16 GetTriggerSCRIDAtPosRail(EventData *eventData, EventWork *eventWork, const RailPosition *position);
u32 GetZoneFlashFlags(u16 zoneId);
BOOL GetZoneIsMusicalTheater(u16 zoneId);
BOOL GetZoneIsPWTBattleStage(u16 zoneId);
BOOL GetZoneIsUnionRoom(u16 zoneId);
u16 GetZoneMatrixId(u16 zoneId);
BOOL GetZoneSpawnInfoIsRail(ZoneSpawnInfo *spawn);
ZoneWarp *GetZoneWarpByID(const EventData *eventData, u16 warpId);
BOOL IsWarpDestId256(ZoneWarp *warp);
BOOL IsZone150Or151(u16 zoneId);
BOOL IsZoneAbyssalRuinsOutside(u16 zoneId);
BOOL IsZoneNimbasaStadium(u16 zoneId);
BOOL IsZoneAbyssalRuinsInside(u16 zoneId);
BOOL IsZoneAbyssalRuinsFlashRock(u16 zoneId);
BOOL IsZoneAbyssalRuinsStrengthRock(u16 zoneId);
// Whether a place name is one of the Entralink's
BOOL IsMetLocationEntralink(u16 location);
BOOL GetIsZoneRoute14Or15(u16 zoneId);
// Whether the zone is a normal field zone: not the Union Room, Entralink or the like
BOOL IsZoneNormal(u16 zoneId);
BOOL IsZoneEntralinkHub(u16 zoneId);
BOOL GetZoneIsEntreeForest(u16 zoneId);
BOOL IsZoneGameCommDisabled(u16 zoneId);
BOOL IsZoneInVictoryRoad(u16 zoneId);
BOOL IsZoneJoinAvenue(u16 zoneId);
BOOL IsZoneJoinAvenueSubZone(u16 zoneId);
BOOL IsZoneRoyalUnova(u16 zoneId);
BOOL IsZoneBlackTowerOrWhiteTreehollow(u16 zoneId);
void LoadAspertiaCitySpawnInfo(ZoneSpawnInfo *spawn);
void LoadZoneSpawnInfoCheckRail(ZoneSpawnInfo *spawn, u16 zoneId);
void SetAllowVersionSpecificArea(u32 area, BOOL allow);
void SetTeleportZoneDiscover(GameData *gameData, s32 zoneId);
void SetupTeleportZoneChange(u16 returnLocation, ZoneSpawnInfo *spawn);
BOOL SetupZoneWarpArrival(const EventData *eventData, ZoneSpawnInfo *spawn, u16 warpId, u16 posWeightBits);
u16 ZoneData_GetAreaID(u16 zoneId);
u16 GetZoneEntitiesID(u16 zoneId);
u16 GetZoneEncID(u16 zoneId);
u32 GetZoneBattleBGID(u16 zoneId);
void InitZoneSpawnInfo(ZoneSpawnInfo *spawn);
void SetupZoneWarpArrivalGrid(ZoneSpawnInfo *spawn, u16 zoneId, s16 warpId, s16 warpDir, u16 posWeightBits, s32 x,
                              s32 y, s32 z);
void SetupZoneWarpArrivalRail(ZoneSpawnInfo *spawn, u16 zoneId, s16 warpId, s16 warpDir, u16 posWeightBits,
                              u16 componentId, u16 posFront, s16 posSide);
u16 ZoneData_GetScriptDatID(u16 zoneId);
u16 ZoneData_GetTextDatID(u16 zoneId);
// The zone data, which the functions that read it need loaded
void InitZoneDataSystem(HeapID heapId);
void FreeZoneDataSystem(void);
u16 ZoneData_GetPlaceNameID(u16 zoneId);

// The zone in the other version for a zone that differs, in the main module
u16 GetVersionedMapChangeZoneNum2(u16 zoneId);
u16 GetZoneMatrixCamBoundIdx(u16 zoneId);
u32 GetZoneDefaultCameraIndex(u16 zoneId);
BOOL GetZoneFlagsEnableCycling(u16 zoneId);
// The zone's BGM for the season
u16 DecideZoneHeaderBGMID(u16 zoneId, u8 season);
// Whether the cycling and surfing BGM play in the zone
BOOL GetZoneFlagsEnableCycleSurfBGM(u16 zoneId);
u16 GetZoneEnvFlagsWeather(u16 zoneId);
// The zone a zone belongs to, such as the town of a building
u16 GetZoneParentZone(u16 zoneId);
BOOL GetZoneHasRailSystem(u16 zoneId);
u32 GetRailIDForZone(u16 zoneId);
BOOL IsZoneEntralinkEdgeColorTable(u16 zoneId);
BOOL IsZoneFlashbackMemoryPostFX(u16 zoneId);
BOOL IsZoneBlackCityOrWhiteForestLobby(u16 zoneId);
u32 GetZoneStaticLightDataIndex(u16 zoneId);
u16 GetCameraIDForZone(u16 zoneId);
// The position Fly lands at
void LoadZoneFlyPosToVecFx32(u16 zoneId, VecFx32 *position);
void LoadZoneFlyPosRailCoords(u16 zoneId, VecFx32 *position);
// Whether Fly lands on a rail in the zone
BOOL IsZonesWithRailsArrayHasZoneID(u16 zoneId);
// Whether the zone is one of the Battle Subway's two
BOOL IsZoneLEQ76(u16 zoneId);
// The zone's place name for a game of the given version
u16 GetZoneLocationNameIdx(u16 zoneId, u32 version);
u32 GetZoneLocNameDispType(u16 zoneId);
u32 GetZoneEasyChallengeModeLevelAdjust(u16 zoneId);
u16 GetZoneNameIcon(u16 zoneId);
u32 GetMapTransitionEffectType(u16 zoneId);
void GetPlayerZoneStateWPos(const ZoneSpawnInfo *spawn, VecFx32 *pos);
void SetPlayerZoneStateWPos(ZoneSpawnInfo *spawn, const VecFx32 *pos);

#endif // POKEBW2_FIELD_ZONE_H

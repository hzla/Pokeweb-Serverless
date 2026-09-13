#include "nds/fs.h"
#include "swan/swantypes.h"

namespace {

constexpr u16 kFirstCustomWeatherId = 15;
constexpr u16 kMaximumZoneWeatherId = 63;
constexpr u16 kCustomWeatherCount = 49;
constexpr u16 kStockWeatherCount = 15;
constexpr u16 kClearWeatherId = 0;
constexpr u16 kUnusedResource = 0xFFFF;
constexpr u16 kRegistryVersion = 4;
constexpr u16 kRegistryHeaderSize = 16;
constexpr u16 kRegistryEntrySize = 72;
constexpr u32 kRegistryMagic = 0x48545750; // "PWTH", little-endian.
constexpr u32 kWeatherOverlayTableAddress = 0x021CFBA0;
constexpr const char *kRegistryPath = "weather/pwth.bin";
constexpr const char *kWeatherArchivePath = "a/0/5/5";
constexpr const char *kWeatherLightArchivePath = "a/0/6/1";

// Call the stock White 2 ARM9 filesystem routines by their verified absolute
// addresses. Importing them through RPM would add ARM9 to the module's extern
// list, which makes PMC classify the weather DLL as permanently resident.
// Keeping overlay 36 as its only extern lets PMC release the DLL before battle
// overlays load, then reload it on the next return to the field.
constexpr u32 kFinitAddress = 0x02070CA9;
constexpr u32 kRomfsFcloseAddress = 0x02070DE1;
constexpr u32 kRomfsFgetsizeAddress = 0x02070DED;
constexpr u32 kRomfsFreadAddress = 0x02070E6D;
constexpr u32 kRomfsFopenAddress = 0x02070ECD;

// Verified stock US White 2 (IRDO) overlay 36 functions.
constexpr u32 kWeatherTaskGetWorkDataAddress = 0x02199825;
constexpr u32 kWeatherTaskFogClearAddress = 0x02199989;
constexpr u32 kWeatherTaskFogSetAddress = 0x0219994D;
constexpr u32 kWeatherTaskFogFadeInInitAddress = 0x02199999;
constexpr u32 kWeatherTaskFogFadeOutInitAddress = 0x021999FD;
constexpr u32 kWeatherTaskFogFadeIsFadeAddress = 0x02199A1D;
constexpr u32 kFieldFogSetColorAddress = 0x02197635;
constexpr u32 kFieldFogSetTableAddress = 0x02197645;
constexpr u32 kFieldLightChangeExAddress = 0x02197A21;
constexpr u32 kFieldLightReloadDefaultAddress = 0x02197A69;
constexpr s32 kFogDepthStart = 32735;
constexpr s32 kMapFogDepthStart = 32767;
constexpr u32 kFieldWeatherLightArchiveId = 66;
constexpr u32 kWeatherLightFadeFrames = 60;
constexpr u32 kMapFogFadeInFrames = 160;

enum PwthChannelFlags {
  PWTH_CHANNEL_PARTICLE_OAM = 1u << 0,
  PWTH_CHANNEL_BG_FRONT = 1u << 1,
  PWTH_CHANNEL_BG_BACK = 1u << 2,
  PWTH_CHANNEL_FOG = 1u << 3,
  PWTH_CHANNEL_LIGHTING = 1u << 4,
  PWTH_CHANNEL_SOUND = 1u << 5,
  PWTH_CHANNEL_KNOWN_MASK = 0x003F,
};

enum WeatherTaskResult {
  WEATHER_TASK_CONTINUE = 0,
  WEATHER_TASK_FINISH = 1,
};

enum PwthLightingMode {
  PWTH_LIGHTING_DONOR = 0,
  PWTH_LIGHTING_CUSTOM = 1,
  PWTH_LIGHTING_AREA = 2,
};

enum PwthFogMode {
  PWTH_FOG_WEATHER = 0,
  PWTH_FOG_MAP = 1,
};

enum WeatherTaskFogMode {
  WEATHER_TASK_FOG_NONE = 0,
};

constexpr u16 kDonorGraphicsChannels[kStockWeatherCount] = {
    0,
    PWTH_CHANNEL_PARTICLE_OAM,
    PWTH_CHANNEL_PARTICLE_OAM,
    PWTH_CHANNEL_PARTICLE_OAM,
    PWTH_CHANNEL_PARTICLE_OAM | PWTH_CHANNEL_BG_FRONT,
    PWTH_CHANNEL_PARTICLE_OAM,
    PWTH_CHANNEL_PARTICLE_OAM | PWTH_CHANNEL_BG_FRONT,
    PWTH_CHANNEL_PARTICLE_OAM | PWTH_CHANNEL_BG_FRONT | PWTH_CHANNEL_BG_BACK,
    PWTH_CHANNEL_PARTICLE_OAM,
    0,
    0,
    0,
    PWTH_CHANNEL_PARTICLE_OAM | PWTH_CHANNEL_BG_FRONT,
    0,
    0,
};

constexpr u16 kDonorLightingMembers[kStockWeatherCount] = {
    kUnusedResource, 8, 7, 9, 8, 8, 6, 0, 8, 1, 4, 2, 9, 5, 3,
};

struct WeatherTask;
typedef s32 (*WeatherTaskCallback)(WeatherTask *, s32, u16);
typedef void (*WeatherObjectCallback)(void *);

struct Field3dBgWriteData {
  u16 nsbtexId;
  u8 textureSizeS;
  u8 textureSizeT;
  u8 repeat;
  u8 flip;
  u8 textureFormat;
  u8 paletteColor0;
  u8 alpha;
  u8 reserved[3];
};

struct WeatherTaskData {
  u16 archiveId;
  u16 useOam;
  u16 useBg;
  u16 oamCharacter;
  u16 oamPalette;
  u16 oamCell;
  u16 oamAnimation;
  Field3dBgWriteData bg[2];
  u32 workBytes;
  WeatherTaskCallback init;
  WeatherTaskCallback fadeIn;
  WeatherTaskCallback noFade;
  WeatherTaskCallback main;
  WeatherTaskCallback initFadeOut;
  WeatherTaskCallback fadeOut;
  WeatherTaskCallback destroy;
  WeatherObjectCallback objectMove;
};

typedef char WeatherTaskDataSizeMustBe0x4c[(sizeof(WeatherTaskData) == 0x4c) ? 1 : -1];
typedef char Field3dBgWriteDataSizeMustBe12[(sizeof(Field3dBgWriteData) == 12) ? 1 : -1];

struct WeatherOverlayEntry {
  const WeatherTaskData *descriptor;
  u32 overlayId;
};

extern "C" {
WeatherOverlayEntry PWW_WeatherDispatchTable[kMaximumZoneWeatherId + 1] = {};
}

struct __attribute__((packed)) PwthRegistryHeader {
  u32 magic;
  u16 formatVersion;
  u16 entrySize;
  u8 firstCustomId;
  u8 entryCount;
  u16 headerSize;
  u32 flags;
};

struct __attribute__((packed)) PwthRegistryEntry {
  u8 enabled;
  u8 donorBehaviorId;
  u16 channelFlags;
  u16 animationMemberId;
  u16 cellMemberId;
  u16 characterMemberId;
  u16 paletteMemberId;
  u16 auxiliaryMemberIds[2];
  u16 particleDensityQ8_8;
  u16 movementSpeedQ8_8;
  u16 fogOffset;
  u8 fogRed5;
  u8 fogGreen5;
  u8 fogBlue5;
  u8 fogSlope;
  s16 screenScrollSpeedQ8_8;
  u16 fogFadeInFrames;
  u16 fogFadeOutFrames;
  u32 entryFlags;
  u8 fogTable[32];
  u16 lightingMemberId;
  u8 lightingMode;
  u8 fogMode;
};

struct __attribute__((packed)) PwthRegistryFile {
  PwthRegistryHeader header;
  PwthRegistryEntry entries[kCustomWeatherCount];
};

typedef char PwthHeaderSizeMustBe16[(sizeof(PwthRegistryHeader) == kRegistryHeaderSize) ? 1 : -1];
typedef char PwthEntrySizeMustBe72[(sizeof(PwthRegistryEntry) == kRegistryEntrySize) ? 1 : -1];
typedef char PwthFileSizeMustBe3544[(sizeof(PwthRegistryFile) == 3544) ? 1 : -1];

struct GenericFogWork {
  s32 fadeStarted;
};

struct PreserveMapFogWork {
  s32 fadeStarted;
};

struct ZoneFogData {
  s32 offset;
  u32 slope;
};

struct FieldZoneFog {
  u8 status;
  s8 loadWait;
  u16 loadDataId;
  const ZoneFogData *data;
};

typedef void *(*GetWorkDataFn)(WeatherTask *);
typedef FSFile *(*FinitFn)(FSFile *);
typedef b32 (*RomfsFopenFn)(FSFile *, const char *);
typedef b32 (*RomfsFcloseFn)(FSFile *);
typedef u32 (*RomfsFgetsizeFn)(FSFile *);
typedef u32 (*RomfsFreadFn)(FSFile *, void *, u32);
typedef void (*FogSetFn)(WeatherTask *, s32, s32, s32);
typedef void (*FogFadeInInitFn)(WeatherTask *, s32, s32, s32, s32);
typedef void (*FogFadeOutInitFn)(WeatherTask *, s32, s32, s32);
typedef s32 (*FogFadeIsFadeFn)(WeatherTask *);
typedef void (*FogClearFn)(WeatherTask *, s32);
typedef void (*FieldFogSetColorFn)(void *, u16);
typedef void (*FieldFogSetTableFn)(void *, const u8 *);
typedef void (*FieldLightChangeExFn)(void *, u32, u32, u32);
typedef void (*FieldLightReloadDefaultFn)(void *);

template <typename T>
inline T ThumbFunction(u32 address) {
  return reinterpret_cast<T>(address);
}

volatile WeatherOverlayEntry *StockWeatherTable() {
  return reinterpret_cast<volatile WeatherOverlayEntry *>(kWeatherOverlayTableAddress);
}

void CopyBytes(void *destination, const void *source, u32 size) {
  u8 *out = static_cast<u8 *>(destination);
  const u8 *in = static_cast<const u8 *>(source);
  for (u32 index = 0; index < size; ++index) out[index] = in[index];
}

PwthRegistryFile sRegistry = {};
u8 sRegistryState = 0; // 0 not read, 1 valid, 2 missing/invalid.
u8 sEntryValid[kCustomWeatherCount] = {};
u16 sWeatherArchiveMemberCount = 0;
u16 sWeatherLightArchiveMemberCount = 0;
WeatherTaskData sCustomDescriptors[kCustomWeatherCount] = {};
const WeatherTaskData *sDonorDescriptors[kCustomWeatherCount] = {};

// PMC's first-fit system heap is fragmented in large expansion builds. Keep
// this field-only module's expanded allocation at least 0x3000 bytes so unloading it
// with overlay 36 leaves a single reusable slot larger than the observed
// 0x2ea0 battle-module request. The bytes are BSS and cost no ROM space.
__attribute__((used)) u8 sBattleTransitionReuseReserve[0x300] = {};

bool ReadExactFile(const char *path, void *destination, u32 expectedSize) {
  FSFile file;
  ThumbFunction<FinitFn>(kFinitAddress)(&file);
  if (!ThumbFunction<RomfsFopenFn>(kRomfsFopenAddress)(&file, path)) return false;
  const bool validSize = ThumbFunction<RomfsFgetsizeFn>(kRomfsFgetsizeAddress)(&file) == expectedSize;
  const bool read = validSize &&
                    ThumbFunction<RomfsFreadFn>(kRomfsFreadAddress)(&file, destination, expectedSize) == expectedSize;
  ThumbFunction<RomfsFcloseFn>(kRomfsFcloseAddress)(&file);
  return read;
}

bool ReadNarcMemberCount(const char *path, u16 *memberCount) {
  struct __attribute__((packed)) NarcPrefix {
    u32 narcMagic;
    u16 byteOrder;
    u16 version;
    u32 fileSize;
    u16 headerSize;
    u16 chunkCount;
    u32 fatMagic;
    u32 fatSize;
    u16 fileCount;
    u16 reserved;
  } prefix;
  FSFile file;
  ThumbFunction<FinitFn>(kFinitAddress)(&file);
  if (!ThumbFunction<RomfsFopenFn>(kRomfsFopenAddress)(&file, path)) return false;
  const bool read = ThumbFunction<RomfsFreadFn>(kRomfsFreadAddress)(&file, &prefix, sizeof(prefix)) == sizeof(prefix);
  ThumbFunction<RomfsFcloseFn>(kRomfsFcloseAddress)(&file);
  if (!read || prefix.narcMagic != 0x4352414E || prefix.byteOrder != 0xFFFE ||
      prefix.headerSize != 16 || prefix.chunkCount != 3 || prefix.fatMagic != 0x46415442) {
    return false;
  }
  *memberCount = prefix.fileCount;
  return true;
}

bool ResourceIsValid(u16 memberId) {
  return memberId != kUnusedResource && memberId < sWeatherArchiveMemberCount;
}

bool LightingResourceIsValid(u16 memberId) {
  return memberId != kUnusedResource && memberId < sWeatherLightArchiveMemberCount;
}

bool RegistryEntryIsValid(const PwthRegistryEntry &entry) {
  if (entry.enabled != 1 || entry.donorBehaviorId >= kStockWeatherCount) return false;
  if ((entry.channelFlags & ~PWTH_CHANNEL_KNOWN_MASK) != 0 || entry.entryFlags != 0) return false;
  const u16 graphics = entry.channelFlags &
                       (PWTH_CHANNEL_PARTICLE_OAM | PWTH_CHANNEL_BG_FRONT | PWTH_CHANNEL_BG_BACK);
  if ((graphics & ~kDonorGraphicsChannels[entry.donorBehaviorId]) != 0) return false;
  if ((entry.channelFlags & PWTH_CHANNEL_BG_BACK) != 0 && (entry.channelFlags & PWTH_CHANNEL_BG_FRONT) == 0) return false;
  if ((entry.channelFlags & PWTH_CHANNEL_PARTICLE_OAM) != 0 &&
      (!ResourceIsValid(entry.animationMemberId) || !ResourceIsValid(entry.cellMemberId) ||
       !ResourceIsValid(entry.characterMemberId) || !ResourceIsValid(entry.paletteMemberId))) {
    return false;
  }
  if ((entry.channelFlags & PWTH_CHANNEL_BG_FRONT) != 0 && !ResourceIsValid(entry.auxiliaryMemberIds[0])) return false;
  if ((entry.channelFlags & PWTH_CHANNEL_BG_BACK) != 0 && !ResourceIsValid(entry.auxiliaryMemberIds[1])) return false;
  if (entry.particleDensityQ8_8 > 0x0400 || entry.movementSpeedQ8_8 > 0x0400 ||
      entry.fogOffset > 32767 || entry.fogRed5 > 31 || entry.fogGreen5 > 31 ||
      entry.fogBlue5 > 31 || entry.fogSlope > 10 || entry.screenScrollSpeedQ8_8 < -0x0400 ||
      entry.screenScrollSpeedQ8_8 > 0x0400 || entry.fogFadeInFrames < 1 || entry.fogFadeInFrames > 600 ||
      entry.fogFadeOutFrames < 1 || entry.fogFadeOutFrames > 600) {
    return false;
  }
  for (u16 index = 0; index < sizeof(entry.fogTable); ++index) {
    if (entry.fogTable[index] > 127) return false;
  }
  if (entry.lightingMode > PWTH_LIGHTING_AREA || entry.fogMode > PWTH_FOG_MAP) return false;
  if (entry.lightingMode == PWTH_LIGHTING_CUSTOM) {
    if ((entry.channelFlags & PWTH_CHANNEL_LIGHTING) == 0 || !LightingResourceIsValid(entry.lightingMemberId)) return false;
  } else if ((entry.channelFlags & PWTH_CHANNEL_LIGHTING) != 0 || entry.lightingMemberId != kUnusedResource) {
    return false;
  }
  return true;
}

void InitializeDispatchTableToClear();

bool LoadRegistry() {
  if (sRegistryState != 0) return sRegistryState == 1;
  sRegistryState = 2;
  InitializeDispatchTableToClear();
  if (!ReadNarcMemberCount(kWeatherArchivePath, &sWeatherArchiveMemberCount) ||
      !ReadNarcMemberCount(kWeatherLightArchivePath, &sWeatherLightArchiveMemberCount)) return false;
  if (!ReadExactFile(kRegistryPath, &sRegistry, sizeof(sRegistry))) return false;
  const PwthRegistryHeader &header = sRegistry.header;
  if (header.magic != kRegistryMagic || header.formatVersion != kRegistryVersion ||
      header.entrySize != kRegistryEntrySize || header.firstCustomId != kFirstCustomWeatherId ||
      header.entryCount != kCustomWeatherCount || header.headerSize != kRegistryHeaderSize || header.flags != 0) {
    return false;
  }

  volatile WeatherOverlayEntry *stock = StockWeatherTable();
  for (u16 index = 0; index < kCustomWeatherCount; ++index) {
    const PwthRegistryEntry &entry = sRegistry.entries[index];
    if (!RegistryEntryIsValid(entry)) continue;
    sEntryValid[index] = 1;
    const u16 weatherId = kFirstCustomWeatherId + index;
    PWW_WeatherDispatchTable[weatherId].descriptor = &sCustomDescriptors[index];
    PWW_WeatherDispatchTable[weatherId].overlayId = stock[entry.donorBehaviorId].overlayId;
  }
  sRegistryState = 1;
  return true;
}

void InitializeDispatchTableToClear() {
  volatile WeatherOverlayEntry *stock = StockWeatherTable();
  for (u16 weatherId = 0; weatherId < kStockWeatherCount; ++weatherId) {
    PWW_WeatherDispatchTable[weatherId].descriptor = stock[weatherId].descriptor;
    PWW_WeatherDispatchTable[weatherId].overlayId = stock[weatherId].overlayId;
  }
  for (u16 weatherId = kFirstCustomWeatherId; weatherId <= kMaximumZoneWeatherId; ++weatherId) {
    PWW_WeatherDispatchTable[weatherId] = PWW_WeatherDispatchTable[kClearWeatherId];
  }
}

s32 CustomDescriptorIndex(const WeatherTaskData *descriptor) {
  for (u16 index = 0; index < kCustomWeatherCount; ++index) {
    if (descriptor == &sCustomDescriptors[index]) return index;
  }
  return -1;
}

const WeatherTaskData *TaskDescriptor(const WeatherTask *task) {
  return *reinterpret_cast<const WeatherTaskData *const *>(reinterpret_cast<const u8 *>(task) + 32);
}

const PwthRegistryEntry *EntryForTask(const WeatherTask *task) {
  const s32 index = CustomDescriptorIndex(TaskDescriptor(task));
  return index >= 0 && sEntryValid[index] != 0 ? &sRegistry.entries[index] : 0;
}

GenericFogWork *FogWork(WeatherTask *task) {
  return static_cast<GenericFogWork *>(ThumbFunction<GetWorkDataFn>(kWeatherTaskGetWorkDataAddress)(task));
}

void SetFogVisuals(WeatherTask *task, const PwthRegistryEntry &entry) {
  void *fog = *(reinterpret_cast<void **>(task) + 1);
  const u16 rgb555 = entry.fogRed5 | (static_cast<u16>(entry.fogGreen5) << 5) |
                     (static_cast<u16>(entry.fogBlue5) << 10);
  ThumbFunction<FieldFogSetTableFn>(kFieldFogSetTableAddress)(fog, entry.fogTable);
  ThumbFunction<FieldFogSetColorFn>(kFieldFogSetColorAddress)(fog, rgb555);
}

void SetFogColor(WeatherTask *task, const PwthRegistryEntry &entry) {
  void *fog = *(reinterpret_cast<void **>(task) + 1);
  const u16 rgb555 = entry.fogRed5 | (static_cast<u16>(entry.fogGreen5) << 5) |
                     (static_cast<u16>(entry.fogBlue5) << 10);
  ThumbFunction<FieldFogSetColorFn>(kFieldFogSetColorAddress)(fog, rgb555);
}

void ApplyWeatherLighting(WeatherTask *task, u32 archiveId, u32 donorMemberId, u32 fadeFrames) {
  const PwthRegistryEntry *entry = EntryForTask(task);
  void *light = *(reinterpret_cast<void **>(task) + 2);
  if (entry && entry->lightingMode == PWTH_LIGHTING_AREA) {
    ThumbFunction<FieldLightReloadDefaultFn>(kFieldLightReloadDefaultAddress)(light);
    return;
  }
  const u32 memberId = entry && entry->lightingMode == PWTH_LIGHTING_CUSTOM
                           ? entry->lightingMemberId
                           : donorMemberId;
  ThumbFunction<FieldLightChangeExFn>(kFieldLightChangeExAddress)(light, archiveId, memberId, fadeFrames);
}

s32 GenericFogInit(WeatherTask *task, s32 fogMode, u16) {
  const PwthRegistryEntry *entry = EntryForTask(task);
  if (!entry) return WEATHER_TASK_FINISH;
  FogWork(task)->fadeStarted = 0;
  ThumbFunction<FogSetFn>(kWeatherTaskFogSetAddress)(task, entry->fogSlope, kFogDepthStart, fogMode);
  SetFogVisuals(task, *entry);
  return WEATHER_TASK_FINISH;
}

s32 GenericFogFadeIn(WeatherTask *task, s32 fogMode, u16) {
  const PwthRegistryEntry *entry = EntryForTask(task);
  if (!entry) return WEATHER_TASK_FINISH;
  GenericFogWork *work = FogWork(task);
  if (work->fadeStarted == 0) {
    ThumbFunction<FogFadeInInitFn>(kWeatherTaskFogFadeInInitAddress)(
        task, entry->fogSlope, entry->fogOffset, entry->fogFadeInFrames, fogMode);
    SetFogVisuals(task, *entry);
    ApplyWeatherLighting(task, kFieldWeatherLightArchiveId,
                         kDonorLightingMembers[entry->donorBehaviorId], kWeatherLightFadeFrames);
    work->fadeStarted = 1;
  }
  SetFogColor(task, *entry);
  return ThumbFunction<FogFadeIsFadeFn>(kWeatherTaskFogFadeIsFadeAddress)(task)
             ? WEATHER_TASK_FINISH
             : WEATHER_TASK_CONTINUE;
}

s32 GenericFogNoFade(WeatherTask *task, s32 fogMode, u16) {
  const PwthRegistryEntry *entry = EntryForTask(task);
  if (!entry) return WEATHER_TASK_FINISH;
  ThumbFunction<FogSetFn>(kWeatherTaskFogSetAddress)(task, entry->fogSlope, entry->fogOffset, fogMode);
  SetFogVisuals(task, *entry);
  ApplyWeatherLighting(task, kFieldWeatherLightArchiveId,
                       kDonorLightingMembers[entry->donorBehaviorId], 1);
  return WEATHER_TASK_FINISH;
}

s32 GenericFogMain(WeatherTask *task, s32, u16) {
  const PwthRegistryEntry *entry = EntryForTask(task);
  if (entry) SetFogColor(task, *entry);
  return WEATHER_TASK_CONTINUE;
}

s32 GenericFogInitFadeOut(WeatherTask *task, s32 fogMode, u16) {
  const PwthRegistryEntry *entry = EntryForTask(task);
  if (!entry) return WEATHER_TASK_FINISH;
  ThumbFunction<FogFadeOutInitFn>(kWeatherTaskFogFadeOutInitAddress)(
      task, kFogDepthStart, entry->fogFadeOutFrames, fogMode);
  return WEATHER_TASK_FINISH;
}

s32 GenericFogFadeOut(WeatherTask *task, s32, u16) {
  return ThumbFunction<FogFadeIsFadeFn>(kWeatherTaskFogFadeIsFadeAddress)(task)
             ? WEATHER_TASK_FINISH
             : WEATHER_TASK_CONTINUE;
}

s32 GenericFogDestroy(WeatherTask *task, s32 fogMode, u16) {
  ThumbFunction<FogClearFn>(kWeatherTaskFogClearAddress)(task, fogMode);
  void *light = *(reinterpret_cast<void **>(task) + 2);
  ThumbFunction<FieldLightReloadDefaultFn>(kFieldLightReloadDefaultAddress)(light);
  return WEATHER_TASK_FINISH;
}

const WeatherTaskData *DonorDescriptorForTask(const WeatherTask *task) {
  const s32 index = CustomDescriptorIndex(TaskDescriptor(task));
  return index >= 0 ? sDonorDescriptors[index] : 0;
}

const FieldZoneFog *TaskZoneFog(const WeatherTask *task) {
  return *reinterpret_cast<const FieldZoneFog *const *>(reinterpret_cast<const u8 *>(task) + 16);
}

PreserveMapFogWork *MapFogWork(WeatherTask *task) {
  u8 *work = static_cast<u8 *>(ThumbFunction<GetWorkDataFn>(kWeatherTaskGetWorkDataAddress)(task));
  return reinterpret_cast<PreserveMapFogWork *>(work + TaskDescriptor(task)->workBytes - sizeof(PreserveMapFogWork));
}

bool MapFogIsLoading(const WeatherTask *task) {
  const FieldZoneFog *zoneFog = TaskZoneFog(task);
  return zoneFog && zoneFog->status == 1;
}

void SetMapFogAtStart(WeatherTask *task, s32 fogMode) {
  const FieldZoneFog *zoneFog = TaskZoneFog(task);
  if (zoneFog && zoneFog->data) {
    ThumbFunction<FogSetFn>(kWeatherTaskFogSetAddress)(task, zoneFog->data->slope, kMapFogDepthStart, fogMode);
  } else {
    ThumbFunction<FogClearFn>(kWeatherTaskFogClearAddress)(task, fogMode);
  }
}

void SetMapFogWithoutFade(WeatherTask *task, s32 fogMode) {
  const FieldZoneFog *zoneFog = TaskZoneFog(task);
  if (zoneFog && zoneFog->data) {
    ThumbFunction<FogSetFn>(kWeatherTaskFogSetAddress)(task, zoneFog->data->slope, zoneFog->data->offset, fogMode);
  } else {
    ThumbFunction<FogClearFn>(kWeatherTaskFogClearAddress)(task, fogMode);
  }
}

void StartMapFogFadeIn(WeatherTask *task, s32 fogMode) {
  const FieldZoneFog *zoneFog = TaskZoneFog(task);
  if (zoneFog && zoneFog->data) {
    ThumbFunction<FogFadeInInitFn>(kWeatherTaskFogFadeInInitAddress)(
        task, zoneFog->data->slope, zoneFog->data->offset, kMapFogFadeInFrames, fogMode);
  } else {
    ThumbFunction<FogClearFn>(kWeatherTaskFogClearAddress)(task, fogMode);
  }
}

s32 PreserveMapFogInit(WeatherTask *task, s32 fogMode, u16 heapId) {
  if (MapFogIsLoading(task)) return WEATHER_TASK_CONTINUE;
  const WeatherTaskData *donor = DonorDescriptorForTask(task);
  const s32 result = donor && donor->init
                         ? donor->init(task, WEATHER_TASK_FOG_NONE, heapId)
                         : WEATHER_TASK_FINISH;
  if (result == WEATHER_TASK_FINISH) {
    MapFogWork(task)->fadeStarted = 0;
    SetMapFogAtStart(task, fogMode);
  }
  return result;
}

s32 PreserveMapFogFadeIn(WeatherTask *task, s32 fogMode, u16 heapId) {
  if (MapFogIsLoading(task)) return WEATHER_TASK_CONTINUE;
  const WeatherTaskData *donor = DonorDescriptorForTask(task);
  const s32 donorResult = donor && donor->fadeIn
                              ? donor->fadeIn(task, WEATHER_TASK_FOG_NONE, heapId)
                              : WEATHER_TASK_FINISH;
  PreserveMapFogWork *work = MapFogWork(task);
  if (work->fadeStarted == 0) {
    StartMapFogFadeIn(task, fogMode);
    work->fadeStarted = 1;
  }
  const s32 mapFogFinished = ThumbFunction<FogFadeIsFadeFn>(kWeatherTaskFogFadeIsFadeAddress)(task);
  return donorResult == WEATHER_TASK_FINISH && mapFogFinished
             ? WEATHER_TASK_FINISH
             : WEATHER_TASK_CONTINUE;
}

s32 PreserveMapFogNoFade(WeatherTask *task, s32 fogMode, u16 heapId) {
  const WeatherTaskData *donor = DonorDescriptorForTask(task);
  const s32 result = donor && donor->noFade
                         ? donor->noFade(task, WEATHER_TASK_FOG_NONE, heapId)
                         : WEATHER_TASK_FINISH;
  SetMapFogWithoutFade(task, fogMode);
  return result;
}

s32 PreserveMapFogMain(WeatherTask *task, s32, u16 heapId) {
  const WeatherTaskData *donor = DonorDescriptorForTask(task);
  return donor && donor->main
             ? donor->main(task, WEATHER_TASK_FOG_NONE, heapId)
             : WEATHER_TASK_CONTINUE;
}

bool IsGenericFogDonor(const PwthRegistryEntry &entry) {
  const bool fogDonor = entry.donorBehaviorId == 9 || entry.donorBehaviorId == 10 ||
                        entry.donorBehaviorId == 11 || entry.donorBehaviorId == 13 ||
                        entry.donorBehaviorId == 14;
  const u16 graphics = PWTH_CHANNEL_PARTICLE_OAM | PWTH_CHANNEL_BG_FRONT | PWTH_CHANNEL_BG_BACK;
  return fogDonor && (entry.channelFlags & PWTH_CHANNEL_FOG) != 0 && (entry.channelFlags & graphics) == 0;
}

void ApplyEntryToDescriptor(WeatherTaskData *descriptor, const PwthRegistryEntry &entry) {
  if (entry.fogMode == PWTH_FOG_WEATHER && IsGenericFogDonor(entry)) {
    descriptor->useOam = 0;
    descriptor->useBg = 0;
    descriptor->workBytes = sizeof(GenericFogWork);
    descriptor->init = GenericFogInit;
    descriptor->fadeIn = GenericFogFadeIn;
    descriptor->noFade = GenericFogNoFade;
    descriptor->main = GenericFogMain;
    descriptor->initFadeOut = GenericFogInitFadeOut;
    descriptor->fadeOut = GenericFogFadeOut;
    descriptor->destroy = GenericFogDestroy;
    descriptor->objectMove = 0;
    return;
  }

  if ((entry.channelFlags & PWTH_CHANNEL_PARTICLE_OAM) != 0) {
    descriptor->useOam = 1;
    descriptor->oamAnimation = entry.animationMemberId;
    descriptor->oamCell = entry.cellMemberId;
    descriptor->oamCharacter = entry.characterMemberId;
    descriptor->oamPalette = entry.paletteMemberId;
  } else {
    descriptor->useOam = 0;
  }

  if ((entry.channelFlags & PWTH_CHANNEL_BG_BACK) != 0) {
    descriptor->useBg = 2;
    descriptor->bg[0].nsbtexId = entry.auxiliaryMemberIds[0];
    descriptor->bg[1].nsbtexId = entry.auxiliaryMemberIds[1];
  } else if ((entry.channelFlags & PWTH_CHANNEL_BG_FRONT) != 0) {
    descriptor->useBg = 1;
    descriptor->bg[0].nsbtexId = entry.auxiliaryMemberIds[0];
  } else {
    descriptor->useBg = 0;
  }

  if (entry.fogMode == PWTH_FOG_MAP) {
    descriptor->workBytes += sizeof(PreserveMapFogWork);
    descriptor->init = PreserveMapFogInit;
    descriptor->fadeIn = PreserveMapFogFadeIn;
    descriptor->noFade = PreserveMapFogNoFade;
    descriptor->main = PreserveMapFogMain;
  }
}

} // namespace

extern "C" {

extern const u32 PWW_OverworldWeatherRuntimeAbi = 5;
extern const u32 PWW_OverworldWeatherRegistryFormat = kRegistryVersion;
extern const char PWW_OverworldWeatherRuntimeVersion[] = "5.0.0";
extern const char PWW_OverworldWeatherRuntimeSignature[] = "PWTH-W2-RUNTIME-ABI5";
extern const char PWW_OverworldWeatherRegistryPath[] = "weather/pwth.bin";

u16 PWW_PrepareWeatherId(u16 weatherId) {
  LoadRegistry();
  if (weatherId < kStockWeatherCount) return weatherId;
  if (weatherId <= kMaximumZoneWeatherId && sEntryValid[weatherId - kFirstCustomWeatherId] != 0) return weatherId;
  return kClearWeatherId;
}

const WeatherTaskData *PWW_MaterializeWeatherDescriptor(const WeatherTaskData *descriptor) {
  const s32 index = CustomDescriptorIndex(descriptor);
  if (index < 0 || sEntryValid[index] == 0) return descriptor;
  const PwthRegistryEntry &entry = sRegistry.entries[index];
  const WeatherTaskData *donor = StockWeatherTable()[entry.donorBehaviorId].descriptor;
  if (!donor) return PWW_WeatherDispatchTable[kClearWeatherId].descriptor;
  sDonorDescriptors[index] = donor;
  CopyBytes(&sCustomDescriptors[index], donor, sizeof(WeatherTaskData));
  ApplyEntryToDescriptor(&sCustomDescriptors[index], entry);
  return &sCustomDescriptors[index];
}

u32 PWW_ReloadWeatherRegistry() {
  sRegistryState = 0;
  sWeatherArchiveMemberCount = 0;
  sWeatherLightArchiveMemberCount = 0;
  volatile u8 *entryValid = sEntryValid;
  for (u16 index = 0; index < kCustomWeatherCount; ++index) entryValid[index] = 0;
  return LoadRegistry() ? 1 : 0;
}

void PWW_WeatherLightChange(WeatherTask *task, u32 archiveId, u32 donorMemberId) {
  ApplyWeatherLighting(task, archiveId, donorMemberId, kWeatherLightFadeFrames);
}

void PWW_WeatherLightSet(WeatherTask *task, u32 archiveId, u32 donorMemberId) {
  ApplyWeatherLighting(task, archiveId, donorMemberId, 1);
}

} // extern "C"

#ifndef FW_REACTIONS_H
#define FW_REACTIONS_H
#include "following.h"
#define FWR_CAPACITY 8192u
#define FWR_TEXT_CAPACITY 192u
#define FWR_CONTEXT_CAPACITY 4096u
typedef struct { const uint8_t *bytes; uint32_t length,rules,motions,messages,bubbles,emoteBytes,emoteCrc; uint16_t ruleCount,motionCount,messageCount,bubbleCount; } FwrData;
typedef struct { FwPokemon pokemon; uint32_t status; uint16_t zone; uint8_t friendship,direction,type1,type2; uint16_t nickname[12],playerName[9]; } FwrSnapshot;
typedef struct { const uint8_t *bytes; uint32_t length; uint16_t ruleCount; } FwrContext;
typedef struct { const uint8_t *bytes; uint32_t length; uint16_t ruleCount; } FwrItems;
typedef struct { uint8_t slot,quantity; uint16_t item; unsigned rule; } FwrItemChoice;
typedef struct { uint16_t action,message,cry; uint8_t bubble,wait; } FwrStep;
uint16_t fwr_u16(const uint8_t *p);
uint32_t fwr_u32(const uint8_t *p);
uint32_t fwr_crc(const uint8_t *p,unsigned n);
int fwr_validate(FwrData *out,const void *bytes,unsigned size);
unsigned fwr_hp(const FwrSnapshot *p);
unsigned fwr_status(uint32_t condition);
int fwr_friend(unsigned code,unsigned value);
int fwr_choose(const FwrData *d,const FwrSnapshot *p,uint32_t *rng);
int fwr_context_validate(FwrContext *out,const void *bytes,unsigned size);
int fwr_context_choose(const FwrContext *d,const FwrSnapshot *p,uint32_t *rng);
int fwr_items_validate(FwrItems *out,const void *bytes,unsigned size);
int fwr_item_choose(const FwrItems *d,const FwrSnapshot *p,uint16_t claims,FwrItemChoice *out);
unsigned fwr_item_text(const FwrItems *d,unsigned rule,const FwrSnapshot *p,uint16_t *out,unsigned capacity);
unsigned fwr_item_name(const FwrItems *d,unsigned rule,uint16_t *out,unsigned capacity);
int fwr_step(const FwrData *d,unsigned rule,unsigned step,FwrStep *out);
unsigned fwr_text(const FwrData *d,unsigned message,const FwrSnapshot *p,uint16_t *out,unsigned capacity);
unsigned fwr_context_text(const FwrContext *d,unsigned rule,const FwrSnapshot *p,uint16_t *out,unsigned capacity);
/* Snapshot-relative visual motion; one frame per call, no world/grid changes. */
typedef struct { unsigned index,age; int32_t x,y,z; uint8_t face; } FwrMotion;
int fwr_motion_tick(const FwrData *d,unsigned action,FwrMotion *motion,int grounded,int *cry);
#endif

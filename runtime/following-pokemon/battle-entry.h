#ifndef FOLLOWING_BATTLE_ENTRY_H
#define FOLLOWING_BATTLE_ENTRY_H
/* Transient setup flag, consumed by the opening presentation. Retail setup
 * flags use bits 0..16. This is never a save option or a party modification. */
#define FWB_PRESENT 0x80000000u
#define FWB_STATUS 0x9cu
static inline int fwb_local_single(void *setup){
 return setup&&U32(setup,0)<2&&U32(setup,4)==0
  &&!U32(setup,0x1c)&&!U32(setup,0x20);
}
#endif
